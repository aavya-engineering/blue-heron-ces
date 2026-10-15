// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Template for EO_RENDER_SIA.
 *
 * EO-19: the class name and this comment used to describe an `adminops.change_log` input
 * source, but `adminops.change_log` was never a valid AdminOps collection (only `evidence`/
 * `executions` are — see InputSourceResolver.adminOpsResolver) and no Stamper directive has
 * ever named it. ces-stamper's live EO_RENDER_DIRECTIVES for CM.L2-3.4.4
 * (ces-stamper/src/evidence/eoRenderDirective.ts) names `input_sources: ['entra_audit_logs']`,
 * which InputSourceResolver aliases to `entra.audit_logs` (STAMPER_INPUT_ALIASES) and resolves
 * from real Stamper discovery evidence (W4-EO3). This renderer's `render()` never hardcoded the
 * change_log path — it only ever read `resolvedInputs.get(inputPath)` for whatever
 * `directive.input_sources` named — so no functional change was needed once the input source
 * was corrected; see tests/unit/rendering/render-pipeline.test.ts's "EO-19: RenderOrchestrator
 * end-to-end" suite for the real end-to-end proof against `entra_audit_logs`.
 * Renders Security Impact Analysis DOCX with CUI markings.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { BaseDocxRenderer } from './BaseDocxRenderer.js';
import { DIRECTIVE_CODES } from '../../../shared/types/render.types.js';
import type { RenderDirective, RenderResult, RenderContext, ResolverResponse } from '../../../shared/types/render.types.js';
import { VariableSubstitutionEngine } from '../VariableSubstitutionEngine.js';

export class SiaFromChangeLogRenderer extends BaseDocxRenderer {
  readonly directiveCodes = [DIRECTIVE_CODES.SIA];

  async render(
    directive: RenderDirective,
    resolvedInputs: Map<string, ResolverResponse>,
    context: RenderContext,
  ): Promise<RenderResult> {
    try {
      const children: any[] = [];

      children.push(...this.renderSection('Security Impact Analysis'));
      children.push(this.textParagraph(`Generated: ${context.date}`));
      children.push(this.textParagraph(`Tenant: ${context.tenantName}`));
      children.push(this.emptyParagraph());

      // Check input sources
      let hasData = false;
      for (const inputPath of directive.input_sources) {
        const response = resolvedInputs.get(inputPath);
        if (response && response.resolved) {
          hasData = true;
          const data = response.data as Record<string, unknown>;
          children.push(this.textParagraph('Change Details', { bold: true }));
          children.push(this.emptyParagraph());

          // Render change log entry fields as table
          const rows: string[][] = Object.entries(data).map(([key, val]) => [key, String(val)]);
          if (rows.length > 0) {
            children.push(this.renderTable(['Field', 'Value'], rows));
          }
        } else {
          children.push(this.dataUnavailableNotice(inputPath));
        }
      }

      if (!hasData) {
        children.push(this.emptyParagraph());
        children.push(this.textParagraph(
          'Security Impact Analysis requires change log data. Data source not yet available.',
          { italics: true, color: 'FF0000' },
        ));
      }

      // Impact Assessment section
      children.push(this.emptyParagraph());
      children.push(...this.renderSection('Impact Assessment'));
      children.push(this.textParagraph(
        hasData
          ? 'Impact assessment based on change log entry data above.'
          : 'Impact assessment pending data source availability.',
      ));

      const buffer = await this.createDocxBuffer(children);

      // Resolve output path
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
