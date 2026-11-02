// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Template for EO_RENDER_PASSWORD_REUSE_POLICY and EO_RENDER_DENY_BY_EXCEPTION_POLICY.
 * Input source: planner.tenant_config.password_policy, planner.tenant_config.deny_exception_policy.
 * Detects stub resolver { resolved: false } and emits partial artifact with
 * "Data unavailable" notice in DOCX body.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { BaseDocxRenderer } from './BaseDocxRenderer.js';
import { describeResolvedData } from '../InputSourceResolver.js';
import { DIRECTIVE_CODES } from '../../../shared/types/render.types.js';
import type { RenderDirective, RenderResult, RenderContext, ResolverResponse } from '../../../shared/types/render.types.js';
import { VariableSubstitutionEngine } from '../VariableSubstitutionEngine.js';

export class PolicyFromTenantConfigRenderer extends BaseDocxRenderer {
  readonly directiveCodes = [
    DIRECTIVE_CODES.PASSWORD_REUSE_POLICY,
    DIRECTIVE_CODES.DENY_BY_EXCEPTION_POLICY,
  ];

  async render(
    directive: RenderDirective,
    resolvedInputs: Map<string, ResolverResponse>,
    context: RenderContext,
  ): Promise<RenderResult> {
    try {
      const children: any[] = [];

      // Title based on directive code
      const isPasswordPolicy = directive.directive_code === DIRECTIVE_CODES.PASSWORD_REUSE_POLICY;
      const title = isPasswordPolicy
        ? 'Password Reuse Policy'
        : 'Deny-by-Exception Policy';

      children.push(...this.renderSection(title));
      children.push(this.textParagraph(`Generated: ${context.date}`));
      children.push(this.textParagraph(`Tenant: ${context.tenantName}`));
      children.push(this.emptyParagraph());

      // Check if input sources resolved
      let hasData = false;
      for (const inputPath of directive.input_sources) {
        const response = resolvedInputs.get(inputPath);
        if (response && response.resolved) {
          hasData = true;
          children.push(this.textParagraph('Policy Content', { bold: true }));
          children.push(this.textParagraph(describeResolvedData(response.data)));
        } else {
          children.push(this.dataUnavailableNotice(inputPath));
        }
      }

      if (!hasData) {
        children.push(this.emptyParagraph());
        children.push(this.textParagraph(
          'This policy document requires manual input. Data sources are not yet available.',
          { italics: true, color: 'FF0000' },
        ));
      }

      const buffer = await this.createDocxBuffer(children);

      // Resolve output path
      const engine = new VariableSubstitutionEngine();
      const outputPath = engine.substituteVariables(directive.output_target, {
        date: context.date,
        tenant_name: context.tenantName,
      });
      const fullOutputPath = path.resolve(context.complianceRepoPath, outputPath);

      // Ensure directory exists and write
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
