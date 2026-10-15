// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Orchestrator that detects render directives in evidence, builds dependency graph
 * (POA&M before SSP), topologically sorts renders, executes in order,
 * returns Map<string, RenderResult> keyed by control_id.
 * Execution order: AFTER evidence loading, BEFORE SPRS calculation.
 */

import type {
  RenderDirective,
  RenderResult,
  RenderContext,
  IRenderTemplate,
  ResolverResponse,
} from '../../shared/types/render.types.js';
import type { AdminOpsReadResult } from '../adminops/AdminOpsEvidenceReader.js';
import { DIRECTIVE_CODES } from '../../shared/types/render.types.js';
import { InputSourceResolver } from './InputSourceResolver.js';
import { EvidenceFileWriter } from './EvidenceFileWriter.js';
import type { RenderStatus } from '../../shared/types/render.types.js';
import { PolicyFromTenantConfigRenderer } from './templates/PolicyFromTenantConfigRenderer.js';
import { SiaFromChangeLogRenderer } from './templates/SiaFromChangeLogRenderer.js';
import { ReportFromWorkbookOutputRenderer } from './templates/ReportFromWorkbookOutputRenderer.js';
import { PoamFromPlanOutputRenderer } from './templates/PoamFromPlanOutputRenderer.js';
import { SspFromPipelineOutputRenderer } from './templates/SspFromPipelineOutputRenderer.js';
import { ReportFromFindingsExportRenderer } from './templates/ReportFromFindingsExportRenderer.js';
import { PersonnelPolicyRenderer } from './templates/PersonnelPolicyRenderer.js';
import { RiskAssessmentRenderer } from './templates/RiskAssessmentRenderer.js';

interface RenderJob {
  controlId: string;
  directive: RenderDirective;
  evidenceFilePath?: string;
}

export class RenderOrchestrator {
  private readonly templates: Map<string, IRenderTemplate>;
  private readonly resolver: InputSourceResolver;
  private readonly writer: EvidenceFileWriter;

  constructor(stamperRoot: string, tenantSlug: string) {
    this.resolver = new InputSourceResolver({ tenantSlug }); // W4-EO3: real providers need the tenant
    this.writer = new EvidenceFileWriter(stamperRoot, tenantSlug);

    // Register all template modules
    this.templates = new Map<string, IRenderTemplate>();
    const renderers: IRenderTemplate[] = [
      new PolicyFromTenantConfigRenderer(),
      new SiaFromChangeLogRenderer(),
      new ReportFromWorkbookOutputRenderer(),
      new PoamFromPlanOutputRenderer(),
      new SspFromPipelineOutputRenderer(),
      new ReportFromFindingsExportRenderer(),
      new PersonnelPolicyRenderer(),
      new RiskAssessmentRenderer(),
    ];

    for (const renderer of renderers) {
      for (const code of renderer.directiveCodes) {
        this.templates.set(code, renderer);
      }
    }
  }

  setAdminOpsData(data: AdminOpsReadResult): void {
    this.resolver.setAdminOpsData(data);
  }

  /**
   * Main entry point. Detects render directives, builds dependency graph,
   * sorts topologically, executes renders in order.
   */
  async orchestrateRenders(
    jobs: RenderJob[],
    context: RenderContext,
    onProgress?: (event: object) => void,
  ): Promise<Map<string, RenderResult>> {
    const results = new Map<string, RenderResult>();

    if (jobs.length === 0) {
      return results;
    }

    // W4-EO3: eo.* sources read this run's snapshot; its tenantId joins the Planner profile.
    this.resolver.setAssessmentSnapshot(context.assessmentSnapshot);

    // Build dependency graph and topological sort
    const sorted = this.topologicalSort(jobs);

    for (const job of sorted) {
      const template = this.templates.get(job.directive.directive_code);

      if (!template) {
        const result: RenderResult = {
          state: 'failed',
          failure_reason: `No template registered for directive code: ${job.directive.directive_code}`,
          retry_safe: false,
        };
        results.set(job.controlId, result);
        this.writeRenderStatus(job, result);
        continue;
      }

      // Check template version compatibility
      if (job.directive.artifact_version !== '1.0') {
        const result: RenderResult = {
          state: 'failed',
          failure_reason: `Template version mismatch: directive specifies ${job.directive.artifact_version}, EO template supports 1.0`,
          retry_safe: false,
        };
        results.set(job.controlId, result);
        this.writeRenderStatus(job, result);
        continue;
      }

      // Resolve input sources
      const resolvedInputs = new Map<string, ResolverResponse>();
      for (const inputPath of job.directive.input_sources) {
        resolvedInputs.set(inputPath, this.resolver.resolveInputSource(inputPath));
      }

      // Update context with current rendered artifacts for cross-referencing
      const renderContext: RenderContext = {
        ...context,
        renderedArtifacts: results,
      };

      if (onProgress) {
        onProgress({
          type: 'render_start',
          controlId: job.controlId,
          directiveCode: job.directive.directive_code,
        });
      }

      const result = await template.render(job.directive, resolvedInputs, renderContext);
      results.set(job.controlId, result);

      // Write render status back to evidence file
      this.writeRenderStatus(job, result);

      if (onProgress) {
        onProgress({
          type: 'render_complete',
          controlId: job.controlId,
          directiveCode: job.directive.directive_code,
          state: result.state,
        });
      }
    }

    return results;
  }

  /**
   * Build dependency graph from render directives.
   * SSP depends on POA&M completion.
   */
  buildDependencyGraph(jobs: RenderJob[]): Map<string, string[]> {
    const graph = new Map<string, string[]>();

    for (const job of jobs) {
      const deps: string[] = [];

      // SSP depends on POA&M
      if (job.directive.directive_code === DIRECTIVE_CODES.SSP) {
        const poamJob = jobs.find(j => j.directive.directive_code === DIRECTIVE_CODES.POAM);
        if (poamJob) {
          deps.push(poamJob.controlId);
        }
      }

      // Also respect explicit depends_on from directive
      for (const depCode of job.directive.depends_on) {
        const depJob = jobs.find(j => j.directive.directive_code === depCode);
        if (depJob) {
          deps.push(depJob.controlId);
        }
      }

      graph.set(job.controlId, deps);
    }

    return graph;
  }

  /**
   * Topological sort of render jobs based on dependency graph.
   * Ensures POA&M renders before SSP.
   */
  topologicalSort(jobs: RenderJob[]): RenderJob[] {
    const graph = this.buildDependencyGraph(jobs);
    const jobMap = new Map<string, RenderJob>();
    for (const job of jobs) {
      jobMap.set(job.controlId, job);
    }

    const sorted: RenderJob[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (controlId: string): void => {
      if (visited.has(controlId)) return;
      if (visiting.has(controlId)) return; // Skip circular (not expected)

      visiting.add(controlId);
      const deps = graph.get(controlId) ?? [];
      for (const dep of deps) {
        visit(dep);
      }
      visiting.delete(controlId);
      visited.add(controlId);

      const job = jobMap.get(controlId);
      if (job) {
        sorted.push(job);
      }
    };

    for (const job of jobs) {
      visit(job.controlId);
    }

    return sorted;
  }

  /**
   * Execute the render queue (called internally by orchestrateRenders).
   */
  executeRenderQueue(
    sorted: RenderJob[],
    context: RenderContext,
  ): Promise<Map<string, RenderResult>> {
    return this.orchestrateRenders(sorted, context);
  }

  private writeRenderStatus(job: RenderJob, result: RenderResult): void {
    if (!job.evidenceFilePath) return;

    try {
      const status: RenderStatus = {
        directive_code: job.directive.directive_code,
        state: result.state,
        artifact_path: result.artifact_path,
        failure_reason: result.failure_reason,
        rendered_at: new Date().toISOString(),
        artifact_version: job.directive.artifact_version,
      };
      this.writer.appendRenderStatus(job.evidenceFilePath, status);
    } catch {
      // Non-fatal: render status write-back failure should not block assessment
      console.warn(`[RenderOrchestrator] Failed to write render status for ${job.controlId}`);
    }
  }
}
