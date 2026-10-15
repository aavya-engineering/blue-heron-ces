// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Template for EO_RENDER_POLICY_PERSONNEL_SCREENING (VFS-POL-009)
 * and EO_RENDER_POLICY_PERSONNEL_TERMINATION (VFS-POL-010).
 *
 * Generates personnel security policy DOCX from PersonnelConfig + tenant context.
 * Extends BaseDocxRenderer for CUI markings and DOCX primitives.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { BaseDocxRenderer } from './BaseDocxRenderer.js';
import { DIRECTIVE_CODES } from '../../../shared/types/render.types.js';
import type { RenderDirective, RenderResult, RenderContext, ResolverResponse } from '../../../shared/types/render.types.js';
import { VariableSubstitutionEngine } from '../VariableSubstitutionEngine.js';
import { PersonnelConfigSchema, TrainingCatalogSchema } from '../../../shared/types/personnel.types.js';
import type { PersonnelConfig, TrainingCatalog } from '../../../shared/types/personnel.types.js';

// EO-19: named `_require`, not `require` -- avoids colliding with the CJS module wrapper's own
// `require` (see BaseDocxRenderer.ts).
const _require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const docx: any = _require('docx');
const { HeadingLevel } = docx;

export class PersonnelPolicyRenderer extends BaseDocxRenderer {
  readonly directiveCodes = [
    DIRECTIVE_CODES.PERSONNEL_SCREENING_POLICY,
    DIRECTIVE_CODES.PERSONNEL_TERMINATION_POLICY,
    DIRECTIVE_CODES.PERSONNEL_TRAINING_POLICY,
  ];

  async render(
    directive: RenderDirective,
    resolvedInputs: Map<string, ResolverResponse>,
    context: RenderContext,
  ): Promise<RenderResult> {
    try {
      const children: any[] =
        directive.directive_code === DIRECTIVE_CODES.PERSONNEL_SCREENING_POLICY
          ? this.buildScreeningPolicy(context, resolvedInputs)
          : directive.directive_code === DIRECTIVE_CODES.PERSONNEL_TRAINING_POLICY
            ? this.buildTrainingPolicy(context, resolvedInputs)
            : this.buildTerminationPolicy(context, resolvedInputs);

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

  private resolveConfig(resolvedInputs: Map<string, ResolverResponse>): PersonnelConfig {
    for (const [, response] of resolvedInputs) {
      if (response.resolved && response.data) {
        try {
          return PersonnelConfigSchema.parse(response.data);
        } catch { /* fall through to defaults */ }
      }
    }
    return PersonnelConfigSchema.parse({});
  }

  private buildScreeningPolicy(context: RenderContext, resolvedInputs: Map<string, ResolverResponse>): any[] {
    const config = this.resolveConfig(resolvedInputs);
    const children: any[] = [];

    // Header
    children.push(...this.renderSection('VFS-POL-009: Personnel Security Screening Policy'));
    children.push(this.textParagraph(`Organization: ${context.tenantName}`));
    children.push(this.textParagraph(`Effective Date: ${context.date}`));
    children.push(this.textParagraph(`Version: 1.0`));
    children.push(this.emptyParagraph());

    // Purpose
    children.push(...this.renderSection('1. Purpose', HeadingLevel.HEADING_2));
    children.push(this.textParagraph(
      `Ensure individuals with access to ${context.tenantName} systems containing Controlled Unclassified Information (CUI) ` +
      `are screened prior to authorization, in accordance with NIST SP 800-171 Rev 2, Control 3.9.1.`,
    ));
    children.push(this.emptyParagraph());

    // Scope
    children.push(...this.renderSection('2. Scope', HeadingLevel.HEADING_2));
    children.push(this.textParagraph(
      `This policy applies to all personnel, contractors, and service accounts with access to ` +
      `${context.tenantName} tenant systems and any system processing, storing, or transmitting CUI.`,
    ));
    children.push(this.emptyParagraph());

    // Screening Criteria
    children.push(...this.renderSection('3. Screening Criteria', HeadingLevel.HEADING_2));
    children.push(this.textParagraph('All individuals must complete the following screening prior to receiving CUI system access:'));
    children.push(this.emptyParagraph());

    children.push(this.textParagraph('3.1 Identity Verification', { bold: true }));
    children.push(this.textParagraph('Government-issued photo identification must be verified in person or via secure remote verification.'));
    children.push(this.emptyParagraph());

    children.push(this.textParagraph('3.2 Professional Reference Verification', { bold: true }));
    children.push(this.textParagraph('A minimum of two (2) professional references must be verified.'));
    children.push(this.emptyParagraph());

    children.push(this.textParagraph('3.3 Background Check', { bold: true }));
    children.push(this.textParagraph(
      'Background checks must include: criminal history (federal and state for states of residence in the last 7 years), ' +
      'sex offender registry, OFAC/sanctions screening, and adverse public records review.',
    ));
    children.push(this.emptyParagraph());

    children.push(this.textParagraph('3.4 Citizenship/Immigration Verification', { bold: true }));
    children.push(this.textParagraph('Citizenship or immigration status verification is required for CUI/ITAR access.'));
    children.push(this.emptyParagraph());

    children.push(this.textParagraph('3.5 CUI Acknowledgment', { bold: true }));
    children.push(this.textParagraph(
      `Each screened individual must sign a CUI handling acknowledgment referencing 32 CFR Part 2002. ` +
      `Template available at: ${config.cuiAcknowledgmentSource}`,
    ));
    children.push(this.emptyParagraph());

    // Authorization Gate
    children.push(...this.renderSection('4. Authorization Gate', HeadingLevel.HEADING_2));
    children.push(this.textParagraph(
      'Tenant account provisioning requires documented completion of all screening criteria per this procedure. ' +
      'No access to CUI systems shall be granted until screening is complete and authorized by the designated official.',
    ));
    children.push(this.emptyParagraph());

    // Review Cycle
    children.push(...this.renderSection('5. Review Cycle', HeadingLevel.HEADING_2));
    children.push(this.textParagraph(
      `Personnel screening is reassessed every ${config.reviewCycleYears} years, or upon significant life event ` +
      `(role change with new access requirements, arrest or legal event affecting trustworthiness, organizational change).`,
    ));
    children.push(this.emptyParagraph());

    // Documentation Retention
    children.push(...this.renderSection('6. Documentation Retention', HeadingLevel.HEADING_2));
    children.push(this.textParagraph(
      `Screening records are retained for ${config.docRetentionYears} years in accordance with ` +
      `CMMC evidence retention requirements per 32 CFR 170.16.`,
    ));
    children.push(this.emptyParagraph());

    // Vendor Guidance
    children.push(...this.renderSection('7. Screening Vendor Guidance', HeadingLevel.HEADING_2));
    children.push(this.textParagraph(
      'Screening may be conducted via any reputable background check service meeting the criteria in Section 3. ' +
      'Currently supported vendors:',
    ));
    children.push(this.emptyParagraph());

    const vendorHeaders = ['Vendor', 'Package', 'Cost', 'Turnaround'];
    const vendorRows = config.vendors.map(v => [
      v.name,
      v.package,
      v.priceRange ?? 'Contact vendor',
      v.turnaround ?? 'Contact vendor',
    ]);
    children.push(this.renderTable(vendorHeaders, vendorRows));
    children.push(this.emptyParagraph());

    // Record-Keeping
    children.push(...this.renderSection('8. Record-Keeping', HeadingLevel.HEADING_2));
    children.push(this.textParagraph(
      'Each screening produces a record stored in the compliance repository containing: ' +
      'completion date, items verified checklist, background check report reference (vendor and order ID), ' +
      'signed CUI agreement, and authorization to access CUI systems signed by the authorizing official.',
    ));
    children.push(this.emptyParagraph());

    // Revision History
    children.push(...this.renderSection('9. Revision History', HeadingLevel.HEADING_2));
    children.push(this.renderTable(
      ['Version', 'Date', 'Description'],
      [['1.0', context.date, 'Initial policy generation']],
    ));

    return children;
  }

  private buildTerminationPolicy(context: RenderContext, resolvedInputs: Map<string, ResolverResponse>): any[] {
    const config = this.resolveConfig(resolvedInputs);
    const children: any[] = [];

    // Header
    children.push(...this.renderSection('VFS-POL-010: Personnel Termination and Transfer Procedure'));
    children.push(this.textParagraph(`Organization: ${context.tenantName}`));
    children.push(this.textParagraph(`Effective Date: ${context.date}`));
    children.push(this.textParagraph(`Version: 1.0`));
    children.push(this.emptyParagraph());

    // Purpose
    children.push(...this.renderSection('1. Purpose', HeadingLevel.HEADING_2));
    children.push(this.textParagraph(
      `Ensure that ${context.tenantName} systems containing CUI are protected during and after ` +
      `personnel actions such as terminations and transfers, in accordance with NIST SP 800-171 Rev 2, Control 3.9.2.`,
    ));
    children.push(this.emptyParagraph());

    // Scope
    children.push(...this.renderSection('2. Scope', HeadingLevel.HEADING_2));
    children.push(this.textParagraph(
      'This procedure applies to all personnel departures (voluntary, involuntary, contractor end-of-engagement) ' +
      'and role transfers affecting CUI system access.',
    ));
    children.push(this.emptyParagraph());

    // Termination Steps
    children.push(...this.renderSection('3. Termination Checklist', HeadingLevel.HEADING_2));
    children.push(this.textParagraph('The following steps must be completed within 24 hours of termination notification:'));
    children.push(this.emptyParagraph());

    const steps = [
      ['3.1', 'Disable Entra ID Account', 'Disable the user account in Microsoft Entra ID to prevent authentication.'],
      ['3.2', 'Revoke Active Sessions', 'Revoke all active authentication sessions and refresh tokens.'],
      ['3.3', 'Revoke Device Access', 'Remove device compliance assignments and revoke managed device access.'],
      ['3.4', 'Remove Group Memberships', 'Remove the user from all security groups, distribution lists, and CUI-access groups.'],
      ['3.5', 'Unassign Licenses', 'Remove all Microsoft 365 and Azure license assignments.'],
      ['3.6', 'CUI Access Review', 'Complete an access review of the departing individual\'s recent CUI access for the preceding 30 days.'],
    ];

    children.push(this.renderTable(['Step', 'Action', 'Description'], steps));
    children.push(this.emptyParagraph());

    // Transfer Procedure
    children.push(...this.renderSection('4. Transfer Procedure', HeadingLevel.HEADING_2));
    children.push(this.textParagraph(
      'For role transfers, review current access rights against new role requirements. ' +
      'Remove access no longer required by the new role. Add access required by the new role only after ' +
      'verification that the individual\'s screening status remains valid for the new access level.',
    ));
    children.push(this.emptyParagraph());

    // Documentation Retention
    children.push(...this.renderSection('5. Documentation Retention', HeadingLevel.HEADING_2));
    children.push(this.textParagraph(
      `Termination and transfer records are retained for ${config.docRetentionYears} years. ` +
      `Records include: date of action, checklist completion evidence, CUI access review results, ` +
      `and confirmation of account deprovisioning.`,
    ));
    children.push(this.emptyParagraph());

    // Revision History
    children.push(...this.renderSection('6. Revision History', HeadingLevel.HEADING_2));
    children.push(this.renderTable(
      ['Version', 'Date', 'Description'],
      [['1.0', context.date, 'Initial procedure generation']],
    ));

    return children;
  }

  private resolveCatalog(resolvedInputs: Map<string, ResolverResponse>): TrainingCatalog {
    for (const [, response] of resolvedInputs) {
      if (response.resolved && response.data) {
        try {
          return TrainingCatalogSchema.parse(response.data);
        } catch { /* fall through to defaults */ }
      }
    }
    // Return default catalog with the 5 standard courses
    return TrainingCatalogSchema.parse({
      courses: [
        { id: 'dod-cyber-awareness-challenge-2026', title: 'DoD Cyber Awareness Challenge', provider: 'DoD Cyber Exchange', duration: '90min', targetRoles: ['*'], required_for_roles: ['all_users'], satisfies_controls: ['AT.L2-3.2.1', 'AT.L2-3.2.2'], refresh_cycle_days: 365 },
        { id: 'dod-cui-mandatory-training', title: 'DoD CUI Mandatory Training', provider: 'DCSA', duration: '45min', targetRoles: ['cui_access'], required_for_roles: ['cui_access'], satisfies_controls: ['AT.L2-3.2.1'], refresh_cycle_days: 730 },
        { id: 'cdse-insider-threat-int101', title: 'CDSE Insider Threat Awareness (INT101)', provider: 'CDSE', duration: '75min', targetRoles: ['*'], required_for_roles: ['all_users'], satisfies_controls: ['AT.L2-3.2.3'], refresh_cycle_days: 365 },
        { id: 'cisa-learning-admin-track', title: 'CISA Cybersecurity Learning - Admin Track', provider: 'CISA Learning', duration: '120min', targetRoles: ['system_administrator'], required_for_roles: ['system_administrator'], satisfies_controls: ['AT.L2-3.2.2'], refresh_cycle_days: 365 },
        { id: 'cdse-cybersecurity-fundamentals', title: 'CDSE Cybersecurity Fundamentals', provider: 'CDSE', duration: '180min', targetRoles: ['system_administrator'], required_for_roles: ['system_administrator'], satisfies_controls: ['AT.L2-3.2.2'], refresh_cycle_days: 365 },
      ],
    });
  }

  private buildTrainingPolicy(context: RenderContext, resolvedInputs: Map<string, ResolverResponse>): any[] {
    const config = this.resolveConfig(resolvedInputs);
    const catalog = this.resolveCatalog(resolvedInputs);
    const children: any[] = [];

    // Header
    children.push(...this.renderSection('VFS-POL-012: Personnel Training and Awareness Policy'));
    children.push(this.textParagraph(`Organization: ${context.tenantName}`));
    children.push(this.textParagraph(`Effective Date: ${context.date}`));
    children.push(this.textParagraph(`Version: 1.0`));
    children.push(this.emptyParagraph());

    // Purpose
    children.push(...this.renderSection('1. Purpose', HeadingLevel.HEADING_2));
    children.push(this.textParagraph(
      `Establish training and awareness requirements for ${context.tenantName} personnel with access to systems ` +
      `processing, storing, or transmitting Controlled Unclassified Information (CUI), in accordance with ` +
      `NIST SP 800-171 Rev 2 Controls 3.2.1 (Security Awareness), 3.2.2 (Role-Based Training), and 3.2.3 (Insider Threat Awareness).`,
    ));
    children.push(this.emptyParagraph());

    // Scope
    children.push(...this.renderSection('2. Scope', HeadingLevel.HEADING_2));
    children.push(this.textParagraph(
      `This policy applies to all personnel, contractors, and service account owners with access to ` +
      `${context.tenantName} tenant systems and any system processing, storing, or transmitting CUI.`,
    ));
    children.push(this.emptyParagraph());

    // Required Training Courses
    children.push(...this.renderSection('3. Required Training Courses', HeadingLevel.HEADING_2));
    children.push(this.textParagraph('The following training courses are required for applicable personnel:'));
    children.push(this.emptyParagraph());

    const courseHeaders = ['Title', 'Provider', 'Duration', 'Target Roles', 'Controls Satisfied', 'Refresh Cycle'];
    const courseRows = catalog.courses.map(c => [
      c.title,
      c.provider,
      c.duration,
      c.required_for_roles.join(', '),
      c.satisfies_controls.join(', '),
      `${c.refresh_cycle_days} days`,
    ]);
    children.push(this.renderTable(courseHeaders, courseRows));
    children.push(this.emptyParagraph());

    // Completion Tracking
    children.push(...this.renderSection('4. Completion Tracking', HeadingLevel.HEADING_2));
    children.push(this.textParagraph(
      'Personnel must upload completion certificates to the Evidence Ops Personnel Card upon course completion. ' +
      'Certificates must be in PDF format and include the trainee name, course title, completion date, and issuing organization.',
    ));
    children.push(this.emptyParagraph());

    // Refresh Cycle
    children.push(...this.renderSection('5. Refresh Cycle', HeadingLevel.HEADING_2));
    children.push(this.textParagraph(
      `Training refreshment is required per the schedule in Section 3. General awareness training refreshes annually. ` +
      `CUI-specific training refreshes biennially. A grace period of ${config.trainingGracePeriodDays} days is provided ` +
      `before training is marked overdue.`,
    ));
    children.push(this.emptyParagraph());

    // Documentation Retention
    children.push(...this.renderSection('6. Documentation Retention', HeadingLevel.HEADING_2));
    children.push(this.textParagraph(
      `Training records and completion certificates are retained for ${config.docRetentionYears} years ` +
      `in accordance with CMMC evidence retention requirements per 32 CFR 170.16.`,
    ));
    children.push(this.emptyParagraph());

    // Revision History
    children.push(...this.renderSection('7. Revision History', HeadingLevel.HEADING_2));
    children.push(this.renderTable(
      ['Version', 'Date', 'Description'],
      [['1.0', context.date, 'Initial policy generation']],
    ));

    return children;
  }
}
