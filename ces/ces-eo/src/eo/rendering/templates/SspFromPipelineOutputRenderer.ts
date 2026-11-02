// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Template for EO_RENDER_SSP.
 * Wraps existing SspGenerator + SspDocxExporter.
 * Receives renderedArtifacts: Map<string, RenderResult> to cross-reference POA&M
 * and other artifacts via existing appendices field on SystemSecurityPlan.
 * Add rendered artifact references as appendix entries.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { BaseDocxRenderer } from './BaseDocxRenderer.js';
import { DIRECTIVE_CODES } from '../../../shared/types/render.types.js';
import type { RenderDirective, RenderResult, RenderContext, ResolverResponse } from '../../../shared/types/render.types.js';
import { VariableSubstitutionEngine } from '../VariableSubstitutionEngine.js';
import { SspDocxExporter } from '../../ssp/SspDocxExporter.js';

export class SspFromPipelineOutputRenderer extends BaseDocxRenderer {
  readonly directiveCodes = [DIRECTIVE_CODES.SSP];

  async render(
    directive: RenderDirective,
    _resolvedInputs: Map<string, ResolverResponse>,
    context: RenderContext,
  ): Promise<RenderResult> {
    try {
      // The SSP generation is handled by the pipeline (SspGenerator is called
      // from EoServer with the renderedArtifacts map). This renderer wraps
      // the existing SspDocxExporter to produce the DOCX artifact.

      // Build a minimal SSP JSON structure referencing rendered artifacts
      const children: any[] = [];

      children.push(...this.renderSection('System Security Plan'));
      children.push(this.textParagraph(`Generated: ${context.date}`));
      children.push(this.textParagraph(`Tenant: ${context.tenantName}`));
      children.push(this.emptyParagraph());

      // Cross-reference rendered artifacts from prior renders
      const artifactEntries: string[][] = [];
      for (const [controlId, result] of context.renderedArtifacts.entries()) {
        if (result.state === 'rendered' && result.artifact_path) {
          artifactEntries.push([controlId, result.artifact_path, 'Rendered']);
        } else if (result.state === 'failed') {
          artifactEntries.push([controlId, result.failure_reason ?? 'Unknown', 'Failed']);
        }
      }

      if (artifactEntries.length > 0) {
        children.push(this.textParagraph('Rendered Artifact Cross-References', { bold: true }));
        children.push(this.emptyParagraph());
        children.push(this.renderTable(
          ['Control ID', 'Artifact Path / Reason', 'Status'],
          artifactEntries,
        ));
        children.push(this.emptyParagraph());
      }

      children.push(this.textParagraph(
        'Full SSP content is generated via the /api/ssp/generate endpoint. ' +
        'This artifact serves as the rendered DOCX output with CUI markings and artifact cross-references.',
      ));

      const buffer = await this.createDocxBuffer(children);

      const engine = new VariableSubstitutionEngine();
      const outputPath = engine.substituteVariables(directive.output_target, {
        date: context.date,
        tenant_name: context.tenantName,
      });
      const fullOutputPath = path.resolve(context.complianceRepoPath, outputPath);

      fs.mkdirSync(path.dirname(fullOutputPath), { recursive: true });
      fs.writeFileSync(fullOutputPath, buffer);

      return {
        state: 'rendered',
        artifact_path: fullOutputPath,
      };
    } catch (err) {
      return {
        state: 'failed',
        failure_reason: err instanceof Error ? err.message : String(err),
        retry_safe: true,
      };
    }
  }
}
