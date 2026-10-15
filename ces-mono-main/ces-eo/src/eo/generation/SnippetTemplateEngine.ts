// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import Handlebars from 'handlebars';
import type { ControlAssessment, CmmcControl } from 'ces-shared/types/controls';
import type { SignalResult } from 'ces-shared/types/signal';
import { SIGNAL_REGISTRY } from './SignalRegistry.js';
import type { ExtendedDirectiveMetadata } from '../../shared/types/directive.types.js';
import { DirectiveNarrativeBuilder } from './DirectiveNarrativeBuilder.js';

const TEMPLATES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../data/snippet-templates'
);

/**
 * Generates control implementation narratives using Handlebars templates.
 * Falls back to a simple text narrative if no template exists for the control.
 */
export class SnippetTemplateEngine {
  private readonly templateCache = new Map<string, HandlebarsTemplateDelegate>();
  private readonly templatesDir: string;

  constructor(templatesDir?: string) {
    this.templatesDir = templatesDir ?? TEMPLATES_DIR;
    if (!fs.existsSync(this.templatesDir)) throw new Error(`Templates directory not found: ${this.templatesDir}`);

    // Register formatting helpers
    Handlebars.registerHelper('formatRetention', (days: number) => `${days} days`);
    Handlebars.registerHelper('formatDate', (iso: string) => {
      const d = new Date(iso);
      return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    });
    Handlebars.registerHelper('policyLink', (title: string, policyPath: string) => `[${title}](${policyPath})`);
  }

  renderControlNarrative(
    controlId: string,
    assessment: ControlAssessment,
    signals: SignalResult[],
    variables?: Record<string, string>,
    registryNotes?: string[],
    infraResources?: Array<{ resourceType: string; name: string; properties: Record<string, unknown> }>,
    evidenceArtifacts?: Array<{ path: string; source: string }>,
  ): string {
    const template = this.loadTemplate(controlId);
    if (!template) {
      return this.fallbackNarrative(controlId, assessment);
    }

    const context = this.buildContext(controlId, assessment, signals, variables, registryNotes, infraResources, evidenceArtifacts);
    return template(context);
  }

  private loadTemplate(controlId: string): HandlebarsTemplateDelegate | null {
    if (this.templateCache.has(controlId)) {
      return this.templateCache.get(controlId)!;
    }

    const templatePath = path.join(this.templatesDir, `${controlId}.hbs`);
    if (!fs.existsSync(templatePath)) {
      return null;
    }

    const source = fs.readFileSync(templatePath, 'utf-8');
    const compiled = Handlebars.compile(source);
    this.templateCache.set(controlId, compiled);
    return compiled;
  }

  private buildContext(
    controlId: string,
    assessment: ControlAssessment,
    signals: SignalResult[],
    variables?: Record<string, string>,
    registryNotes?: string[],
    infraResources?: Array<{ resourceType: string; name: string; properties: Record<string, unknown> }>,
    evidenceArtifacts?: Array<{ path: string; source: string }>,
  ): Record<string, unknown> {
    const context: Record<string, unknown> = {
      controlId,
      status: assessment.status,
      evidenceArtifactUrl: assessment.evidenceArtifactIds[0] ?? 'No artifacts captured',
    };

    // Build signal-specific context via SignalRegistry
    for (const signal of signals) {
      if (signal.status !== 'success' || !signal.rawData) continue;

      const entry = SIGNAL_REGISTRY.find(e => e.signalId === signal.signalId);
      if (entry) {
        Object.assign(context, entry.transform(signal));
      }
    }

    // Merge ODP variables for template access (e.g., {{tenantName}}, {{primaryDomain}})
    // Wrap in variables object for template access as {{variables.key}}
    if (variables) {
      context.variables = variables;
      Object.assign(context, variables);
    }

    // Merge registry notes as implementationGuidance for template access
    if (registryNotes && registryNotes.length > 0) {
      context.implementationGuidance = registryNotes.join('\n\n');
    }

    // Add infrastructure resources for template iteration
    if (infraResources && infraResources.length > 0) {
      context.infraResources = infraResources;
    }

    // Add formatted evidence artifacts with human-readable labels
    if (evidenceArtifacts && evidenceArtifacts.length > 0) {
      context.evidenceArtifacts = evidenceArtifacts.map(e => ({
        label: this.formatEvidenceLabel(e.path, e.source),
        path: e.path,
        source: e.source,
      }));
    }

    return context;
  }

  private fallbackNarrative(controlId: string, assessment: ControlAssessment): string {
    return `## Control ${controlId}\n\n**Implementation Status:** ${assessment.status}\n\n${assessment.implementation_narrative ?? 'Implementation details not available.'}\n\n**Evidence:** ${assessment.evidenceArtifactIds.join(', ') || 'No artifacts captured'}`;
  }

  /**
   * Attempt to render a directive-specific narrative. Returns the narrative string
   * if the directive has a special template (document-absence, document-prohibition,
   * manual+platform_inherited), or null to fall through to existing template logic.
   */
  renderDirectiveNarrative(
    control: CmmcControl,
    directiveMetadata: ExtendedDirectiveMetadata
  ): string | null {
    switch (directiveMetadata.directive) {
      case 'document-absence':
        return DirectiveNarrativeBuilder.buildDocumentAbsenceNarrative(control, directiveMetadata);
      case 'document-prohibition':
        return DirectiveNarrativeBuilder.buildDocumentProhibitionNarrative(control, directiveMetadata);
      case 'manual':
        if (directiveMetadata.platform_inherited) {
          return DirectiveNarrativeBuilder.buildPlatformInheritedNarrative(control, directiveMetadata);
        }
        // Fall through to existing manual template
        return null;
      case 'implement':
      case 'validate':
      case 'skip':
        // Fall through to existing templates
        return null;
      default:
        return null;
    }
  }

  private formatEvidenceLabel(evidencePath: string, source: string): string {
    if (source === 'missionPlan') {
      return `Mission Plan artifact: ${evidencePath.split('/').pop() ?? evidencePath}`;
    } else if (source === 'infraManifest') {
      const parts = evidencePath.replace('infra://', '').split('/');
      return `${parts[0]} "${parts[1]}" - ${parts[2]}`;
    }
    return evidencePath;
  }
}
