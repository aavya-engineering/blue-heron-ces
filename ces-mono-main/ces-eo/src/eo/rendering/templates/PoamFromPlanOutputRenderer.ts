// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Template for EO_RENDER_POAM.
 * Wraps existing DirectivePoamGenerator at src/eo/poam/DirectivePoamGenerator.ts.
 * Input source: assessment snapshot controls (already classified MET/NOT_MET
 * via Stamper readiness field). DirectivePoamGenerator reads NOT_MET controls
 * from snapshot, NOT from SPRS output.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { BaseDocxRenderer } from './BaseDocxRenderer.js';
import { DIRECTIVE_CODES } from '../../../shared/types/render.types.js';
import type { RenderDirective, RenderResult, RenderContext, ResolverResponse } from '../../../shared/types/render.types.js';
import { VariableSubstitutionEngine } from '../VariableSubstitutionEngine.js';
import { DirectivePoamGenerator } from '../../poam/DirectivePoamGenerator.js';
import type { DirectiveControlImplementation } from '../../../shared/types/ssp.types.js';
import type { AssessmentSnapshot } from 'ces-shared/types/controls';

export class PoamFromPlanOutputRenderer extends BaseDocxRenderer {
  readonly directiveCodes = [DIRECTIVE_CODES.POAM];

  async render(
    directive: RenderDirective,
    _resolvedInputs: Map<string, ResolverResponse>,
    context: RenderContext,
  ): Promise<RenderResult> {
    try {
      const children: any[] = [];

      children.push(...this.renderSection('Plan of Action and Milestones (POA&M)'));
      children.push(this.textParagraph(`Generated: ${context.date}`));
      children.push(this.textParagraph(`Tenant: ${context.tenantName}`));
      children.push(this.emptyParagraph());

      // Build directive controls from assessment snapshot
      const snapshot = context.assessmentSnapshot as AssessmentSnapshot;
      const directiveControls: DirectiveControlImplementation[] = snapshot.controls
        .filter(c => c.directiveMetadata)
        .map(c => ({
          control_id: c.control_id,
          nist_ref: c.nist_ref,
          family: '',
          practice: '',
          status: c.status,
          classification: c.classification,
          weight: 0,
          implementationNarrative: '',
          technologyUsed: [],
          responsibleRole: '',
          evidenceReferences: [],
          relatedPolicies: [],
          odpValues: [],
          assessmentObjectives: [],
          sprsValue: c.status === 'not_met' ? 'NOT_MET' as const : c.status === 'met' ? 'MET' as const : undefined,
          sprsRationale: undefined,
          directiveMetadata: c.directiveMetadata as unknown as DirectiveControlImplementation['directiveMetadata'],
          directive: (c.directiveMetadata as unknown as Record<string, unknown>)?.directive as DirectiveControlImplementation['directive'],
        }));

      const poamGen = new DirectivePoamGenerator();
      const poamResult = poamGen.buildPoamList(directiveControls);

      if (poamResult.total_items === 0) {
        children.push(this.textParagraph('No open POA&M items', { bold: true }));
        children.push(this.emptyParagraph());
        children.push(this.textParagraph(
          'All assessed controls meet their requirements. No corrective actions are required at this time.',
        ));
      } else {
        // Blocking items
        if (poamResult.blocking_items.length > 0) {
          children.push(this.textParagraph('Blocking Items (POA&M Ineligible)', { bold: true }));
          children.push(this.emptyParagraph());
          const blockingRows = poamResult.blocking_items.map(item => [
            item.control_id,
            item.reason_not_met,
            item.closure_date.split('T')[0],
            item.required_artifacts.join('; '),
          ]);
          children.push(this.renderTable(
            ['Control ID', 'Reason Not Met', 'Closure Date', 'Required Artifacts'],
            blockingRows,
          ));
          children.push(this.emptyParagraph());
        }

        // Eligible items
        if (poamResult.eligible_items.length > 0) {
          children.push(this.textParagraph('Eligible Items', { bold: true }));
          children.push(this.emptyParagraph());
          const eligibleRows = poamResult.eligible_items.map(item => [
            item.control_id,
            item.reason_not_met,
            item.closure_date.split('T')[0],
            item.required_artifacts.join('; '),
          ]);
          children.push(this.renderTable(
            ['Control ID', 'Reason Not Met', 'Closure Date', 'Required Artifacts'],
            eligibleRows,
          ));
          children.push(this.emptyParagraph());
        }

        // Summary
        children.push(this.textParagraph(`Total POA&M Items: ${poamResult.total_items}`));
        children.push(this.textParagraph(`Blocking: ${poamResult.blocking_items.length}`));
        children.push(this.textParagraph(`Eligible: ${poamResult.eligible_items.length}`));
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
