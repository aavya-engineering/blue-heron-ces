// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Template for EO_RENDER_AUDIT_REDUCTION_REPORT.
 * Input source: sentinel.workbook_run_output[most_recent].
 * Renders audit reduction report DOCX.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { BaseDocxRenderer } from './BaseDocxRenderer.js';
import { describeResolvedData } from '../InputSourceResolver.js';
import { DIRECTIVE_CODES } from '../../../shared/types/render.types.js';
import type { RenderDirective, RenderResult, RenderContext, ResolverResponse } from '../../../shared/types/render.types.js';
import { VariableSubstitutionEngine } from '../VariableSubstitutionEngine.js';

export class ReportFromWorkbookOutputRenderer extends BaseDocxRenderer {
  readonly directiveCodes = [DIRECTIVE_CODES.AUDIT_REDUCTION_REPORT];

  async render(
    directive: RenderDirective,
    resolvedInputs: Map<string, ResolverResponse>,
    context: RenderContext,
  ): Promise<RenderResult> {
    try {
      const children: any[] = [];

      children.push(...this.renderSection('Audit Reduction Report'));
      children.push(this.textParagraph(`Generated: ${context.date}`));
      children.push(this.textParagraph(`Tenant: ${context.tenantName}`));
      children.push(this.emptyParagraph());

      // Check input sources
      let hasData = false;
      for (const inputPath of directive.input_sources) {
        const response = resolvedInputs.get(inputPath);
        if (response && response.resolved) {
          hasData = true;
          children.push(this.textParagraph('Workbook Output Data', { bold: true }));
          children.push(this.emptyParagraph());
          children.push(this.textParagraph(describeResolvedData(response.data)));
        } else {
          children.push(this.dataUnavailableNotice(inputPath));
        }
      }

      if (!hasData) {
        children.push(this.emptyParagraph());
        children.push(this.textParagraph(
          'Audit reduction report requires Sentinel workbook run output. Data source not yet available.',
          { italics: true, color: 'FF0000' },
        ));
      }

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
