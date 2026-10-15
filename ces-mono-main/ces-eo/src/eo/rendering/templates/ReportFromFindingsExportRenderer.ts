// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Template for EO_RENDER_VULN_SCAN_REPORT.
 * Input source: defender_for_cloud.vulnerability_findings[last_30_days] (resolver stub for MVP).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { BaseDocxRenderer } from './BaseDocxRenderer.js';
import { describeResolvedData } from '../InputSourceResolver.js';
import { DIRECTIVE_CODES } from '../../../shared/types/render.types.js';
import type { RenderDirective, RenderResult, RenderContext, ResolverResponse } from '../../../shared/types/render.types.js';
import { VariableSubstitutionEngine } from '../VariableSubstitutionEngine.js';

export class ReportFromFindingsExportRenderer extends BaseDocxRenderer {
  readonly directiveCodes = [DIRECTIVE_CODES.VULN_SCAN_REPORT];

  async render(
    directive: RenderDirective,
    resolvedInputs: Map<string, ResolverResponse>,
    context: RenderContext,
  ): Promise<RenderResult> {
    try {
      const children: any[] = [];

      children.push(...this.renderSection('Vulnerability Scan Report'));
      children.push(this.textParagraph(`Generated: ${context.date}`));
      children.push(this.textParagraph(`Tenant: ${context.tenantName}`));
      children.push(this.emptyParagraph());

      // Check input sources
      let hasData = false;
      for (const inputPath of directive.input_sources) {
        const response = resolvedInputs.get(inputPath);
        if (response && response.resolved) {
          hasData = true;
          children.push(this.textParagraph('Vulnerability Findings', { bold: true }));
          children.push(this.emptyParagraph());
          children.push(this.textParagraph(describeResolvedData(response.data)));
        } else {
          children.push(this.dataUnavailableNotice(inputPath));
        }
      }

      if (!hasData) {
        children.push(this.emptyParagraph());
        children.push(this.textParagraph(
          'Vulnerability scan report requires Defender for Cloud findings export. Data source not yet available.',
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
