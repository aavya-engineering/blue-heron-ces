// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Template for EO_RENDER_POLICY_RISK_ASSESSMENT (VFS-POL-011)
 * and EO_RENDER_DOC_RISK_ASSESSMENT_REPORT (VFS-DOC-001).
 *
 * Generates risk assessment procedure policy and risk assessment report DOCX
 * from RiskAssessmentStore data. Extends BaseDocxRenderer for CUI markings
 * and DOCX primitives.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { BaseDocxRenderer } from './BaseDocxRenderer.js';
import { DIRECTIVE_CODES } from '../../../shared/types/render.types.js';
import type { RenderDirective, RenderResult, RenderContext, ResolverResponse } from '../../../shared/types/render.types.js';
import { RiskAssessmentStore } from '../../risk-assessment/RiskAssessmentStore.js';
import { NIST_SP_800_30_SCALE, computeCompositeRisk } from '../../risk-assessment/NistScoringMatrix.js';
import type {
  RiskAssessmentConfig,
  RiskRegister,
  RiskEntry,
  NistQualitativeScore,
} from '../../../shared/types/risk-assessment.types.js';

// EO-19: named `_require`, not `require` -- avoids colliding with the CJS module wrapper's own
// `require` (see BaseDocxRenderer.ts).
const _require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const docx: any = _require('docx');
const { HeadingLevel } = docx;

const SCALE_LABELS: Record<NistQualitativeScore, string> = {
  very_low: 'Very Low',
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
  very_high: 'Very High',
};

const SCALE_ORDER: NistQualitativeScore[] = ['very_low', 'low', 'moderate', 'high', 'very_high'];

export class RiskAssessmentRenderer extends BaseDocxRenderer {
  readonly directiveCodes = [
    DIRECTIVE_CODES.RISK_ASSESSMENT_POLICY,
    DIRECTIVE_CODES.RISK_ASSESSMENT_REPORT,
  ];

  async render(
    directive: RenderDirective,
    resolvedInputs: Map<string, ResolverResponse>,
    context: RenderContext,
  ): Promise<RenderResult> {
    try {
      const store = new RiskAssessmentStore(context.complianceRepoPath);
      const config = store.loadConfig(context.tenantSlug);

      const children: any[] =
        directive.directive_code === DIRECTIVE_CODES.RISK_ASSESSMENT_POLICY
          ? this.buildProcedureDocument(config, context)
          : this.buildReportDocument(store, config, context, resolvedInputs);

      const buffer = await this.createDocxBuffer(children);

      const outputDir = path.resolve(
        context.complianceRepoPath,
        'risk-assessment',
        context.tenantSlug,
        'rendered',
      );
      fs.mkdirSync(outputDir, { recursive: true });

      const filename =
        directive.directive_code === DIRECTIVE_CODES.RISK_ASSESSMENT_POLICY
          ? 'VFS-POL-011-risk-assessment-procedure.docx'
          : `VFS-DOC-001-${new Date().getFullYear()}.docx`;

      const fullOutputPath = path.join(outputDir, filename);
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

  // ── VFS-POL-011: Risk Assessment Procedure ──

  private buildProcedureDocument(config: RiskAssessmentConfig, context: RenderContext): any[] {
    const children: any[] = [];

    // 1. Header
    children.push(...this.renderSection('VFS-POL-011: Risk Assessment Procedure'));
    children.push(this.textParagraph(`Organization: ${context.tenantName}`));
    children.push(this.textParagraph(`Effective Date: ${context.date}`));
    children.push(this.textParagraph(`Version: 1.0`));
    children.push(this.emptyParagraph());

    // 2. Purpose
    children.push(...this.renderSection('1. Purpose', HeadingLevel.HEADING_2));
    children.push(this.textParagraph(
      `Define the procedure for conducting risk assessments of ${context.tenantName} information systems ` +
      `processing, storing, or transmitting Controlled Unclassified Information (CUI), in accordance with ` +
      `NIST SP 800-171 Rev 2, Control 3.11.1 (Risk Assessment) and NIST SP 800-30 Rev 1.`,
    ));
    children.push(this.emptyParagraph());

    // 3. Scope
    children.push(...this.renderSection('2. Scope', HeadingLevel.HEADING_2));
    children.push(this.textParagraph(
      config.scopeStatement ||
      `This procedure applies to all information systems, applications, and services within the ` +
      `${context.tenantName} CMMC Level 2 assessment boundary that process, store, or transmit CUI.`,
    ));
    children.push(this.emptyParagraph());

    // 4. Methodology
    children.push(...this.renderSection('3. Methodology', HeadingLevel.HEADING_2));
    children.push(this.textParagraph(
      `Risk assessments follow the NIST SP 800-30 Rev 1 methodology (${config.methodology}). ` +
      `The assessment uses a qualitative 5-level scoring scale for both likelihood and impact:`,
    ));
    children.push(this.emptyParagraph());

    const scaleHeaders = ['Level', 'Label', 'Description'];
    const scaleRows: string[][] = [
      ['1', 'Very Low', 'Negligible probability or negligible adverse effect'],
      ['2', 'Low', 'Low probability or limited adverse effect'],
      ['3', 'Moderate', 'Moderate probability or serious adverse effect'],
      ['4', 'High', 'High probability or severe adverse effect'],
      ['5', 'Very High', 'Near certainty or catastrophic adverse effect'],
    ];
    children.push(this.renderTable(scaleHeaders, scaleRows));
    children.push(this.emptyParagraph());

    children.push(this.textParagraph(
      'Composite risk is calculated using the NIST SP 800-30 Appendix I matrix combining ' +
      'likelihood and impact scores.',
    ));
    children.push(this.emptyParagraph());

    // 5. Roles and Responsibilities
    children.push(...this.renderSection('4. Roles and Responsibilities', HeadingLevel.HEADING_2));
    const aoName = config.authorizingOfficial?.displayName || '[Authorizing Official TBD]';
    const aoRole = config.authorizingOfficial?.role || 'Authorizing Official';
    children.push(this.textParagraph(`Authorizing Official: ${aoName}`, { bold: true }));
    children.push(this.textParagraph(`Role: ${aoRole}`));
    children.push(this.emptyParagraph());

    const roleHeaders = ['Role', 'Responsibility'];
    const roleRows: string[][] = [
      ['Authorizing Official (AO)', 'Accepts residual risk, signs off on annual review, approves risk treatment decisions'],
      ['Risk Assessment Lead', 'Conducts assessments, maintains risk register, coordinates threat identification'],
      ['System Owner', 'Provides system context, identifies assets and operations affected by risks'],
      ['Security Engineer', 'Provides technical vulnerability data, implements mitigations'],
    ];
    children.push(this.renderTable(roleHeaders, roleRows));
    children.push(this.emptyParagraph());

    // 6. Frequency
    children.push(...this.renderSection('5. Assessment Frequency', HeadingLevel.HEADING_2));
    children.push(this.textParagraph(
      `Full risk assessments are conducted every ${config.frequencyMonths} months. ` +
      `Interim assessments are triggered by:`,
    ));
    children.push(this.emptyParagraph());
    children.push(this.textParagraph('- Significant system changes or new system deployments'));
    children.push(this.textParagraph('- New threat intelligence indicating elevated risk'));
    children.push(this.textParagraph('- Security incidents requiring root cause analysis'));
    children.push(this.textParagraph('- Changes to the CUI boundary or data flows'));
    children.push(this.textParagraph('- Discovery of new vulnerabilities with high/very high severity'));
    children.push(this.emptyParagraph());

    // 7. Review Process
    children.push(...this.renderSection('6. Review and Approval Process', HeadingLevel.HEADING_2));
    children.push(this.textParagraph(
      'The annual review process follows a 6-step workflow:',
    ));
    children.push(this.emptyParagraph());

    const reviewHeaders = ['Step', 'Activity', 'Output'];
    const reviewRows: string[][] = [
      ['1', 'Threat Identification', 'Updated threat catalog with current adversarial and non-adversarial sources'],
      ['2', 'Vulnerability Assessment', 'Consolidated vulnerability list from automated and manual sources'],
      ['3', 'Likelihood Determination', 'Likelihood score assigned to each risk entry'],
      ['4', 'Impact Analysis', 'Impact score assigned based on affected assets and operations'],
      ['5', 'Risk Determination', 'Composite risk calculated; treatment recommendations assigned'],
      ['6', 'AO Sign-Off', 'Authorizing Official reviews and accepts/rejects residual risk posture'],
    ];
    children.push(this.renderTable(reviewHeaders, reviewRows));
    children.push(this.emptyParagraph());

    children.push(this.textParagraph(
      `Upon completion, the risk register is frozen as an annual snapshot and the report artifact ` +
      `(VFS-DOC-001) is generated for the assessment year.`,
    ));
    children.push(this.emptyParagraph());

    // Revision History
    children.push(...this.renderSection('7. Revision History', HeadingLevel.HEADING_2));
    children.push(this.renderTable(
      ['Version', 'Date', 'Description'],
      [['1.0', context.date, 'Initial procedure generation']],
    ));

    return children;
  }

  // ── VFS-DOC-001: Risk Assessment Report ──

  private buildReportDocument(
    store: RiskAssessmentStore,
    config: RiskAssessmentConfig,
    context: RenderContext,
    resolvedInputs: Map<string, ResolverResponse>,
  ): any[] {
    // Determine data source: snapshot year from resolvedInputs or live register
    let reportYear: number = new Date().getFullYear();
    let fromSnapshot = false;
    let register: RiskRegister = store.loadRegister(context.tenantSlug);

    // Check if year was passed via resolvedInputs
    const yearResponse = resolvedInputs.get('year');
    if (yearResponse && yearResponse.resolved && yearResponse.data) {
      const yearVal = Number(yearResponse.data);
      if (!isNaN(yearVal)) {
        const snapshot = store.loadSnapshot(context.tenantSlug, yearVal);
        if (snapshot) {
          register = snapshot.registerSnapshot;
          reportYear = yearVal;
          fromSnapshot = true;
        }
      }
    }

    const children: any[] = [];

    // 1. Executive Summary
    children.push(...this.renderSection(`VFS-DOC-001: Risk Assessment Report — ${reportYear}`));
    children.push(this.textParagraph(`Organization: ${context.tenantName}`));
    children.push(this.textParagraph(`Report Date: ${context.date}`));
    children.push(this.textParagraph(`Assessment Year: ${reportYear}`));
    children.push(this.textParagraph(`Data Source: ${fromSnapshot ? 'Annual Snapshot' : 'Current Register'}`));
    children.push(this.emptyParagraph());

    children.push(...this.renderSection('1. Executive Summary', HeadingLevel.HEADING_2));
    const totalEntries = register.entries.length;
    const scoredEntries = register.entries.filter(e => e.compositeRisk);
    const riskCounts = this.countByCompositeRisk(register.entries);
    children.push(this.textParagraph(`Total Risk Entries: ${totalEntries}`));
    children.push(this.textParagraph(`Scored Entries: ${scoredEntries.length}`));
    children.push(this.textParagraph(`Very High Risk: ${riskCounts.very_high}`));
    children.push(this.textParagraph(`High Risk: ${riskCounts.high}`));
    children.push(this.textParagraph(`Moderate Risk: ${riskCounts.moderate}`));
    children.push(this.textParagraph(`Low Risk: ${riskCounts.low}`));
    children.push(this.textParagraph(`Very Low Risk: ${riskCounts.very_low}`));
    children.push(this.emptyParagraph());

    const treatmentCounts = this.countByTreatmentStatus(register.entries);
    children.push(this.textParagraph('Treatment Status Summary:', { bold: true }));
    children.push(this.textParagraph(`Recommended: ${treatmentCounts.recommended}`));
    children.push(this.textParagraph(`In Progress: ${treatmentCounts.in_progress}`));
    children.push(this.textParagraph(`Mitigated: ${treatmentCounts.mitigated}`));
    children.push(this.textParagraph(`Accepted (Residual): ${treatmentCounts.accepted_residual}`));
    children.push(this.textParagraph(`Transferred: ${treatmentCounts.transferred}`));
    children.push(this.emptyParagraph());
    children.push(this.pageBreak());

    // 2. Scope and Methodology
    children.push(...this.renderSection('2. Scope and Methodology', HeadingLevel.HEADING_2));
    children.push(this.textParagraph(
      config.scopeStatement ||
      `This assessment covers all information systems within the ${context.tenantName} CMMC Level 2 boundary.`,
    ));
    children.push(this.emptyParagraph());
    children.push(this.textParagraph(
      `Methodology: ${config.methodology} (NIST SP 800-30 Rev 1 qualitative approach). ` +
      `Assessment frequency: every ${config.frequencyMonths} months.`,
    ));
    children.push(this.emptyParagraph());
    children.push(this.pageBreak());

    // 3. Threat Identification
    children.push(...this.renderSection('3. Threat Identification', HeadingLevel.HEADING_2));
    children.push(this.textParagraph('Threats are grouped by source category:'));
    children.push(this.emptyParagraph());

    // Group entries by threatSource
    const threatGroups = this.groupByField(register.entries, 'threatSource');
    for (const [source, entries] of Object.entries(threatGroups)) {
      children.push(this.textParagraph(`${source.replace(/_/g, ' ').toUpperCase()} (${entries.length} entries)`, { bold: true }));
      const threatEvents = [...new Set(entries.map(e => e.threatEvent))];
      for (const event of threatEvents.slice(0, 20)) {
        children.push(this.textParagraph(`  - ${event}`));
      }
      if (threatEvents.length > 20) {
        children.push(this.textParagraph(`  ... and ${threatEvents.length - 20} more`, { italics: true }));
      }
      children.push(this.emptyParagraph());
    }
    if (register.entries.length === 0) {
      children.push(this.textParagraph('No threat entries identified in the current register.', { italics: true }));
      children.push(this.emptyParagraph());
    }
    children.push(this.pageBreak());

    // 4. Vulnerability Assessment
    children.push(...this.renderSection('4. Vulnerability Assessment', HeadingLevel.HEADING_2));
    children.push(this.textParagraph('Vulnerabilities are grouped by source type:'));
    children.push(this.emptyParagraph());

    const vulnGroups = this.groupBySourceType(register.entries);
    for (const [sourceType, entries] of Object.entries(vulnGroups)) {
      children.push(this.textParagraph(`${sourceType.replace(/_/g, ' ').toUpperCase()} (${entries.length} entries)`, { bold: true }));
      for (const entry of entries.slice(0, 15)) {
        children.push(this.textParagraph(`  - ${entry.vulnerability.description}`));
      }
      if (entries.length > 15) {
        children.push(this.textParagraph(`  ... and ${entries.length - 15} more`, { italics: true }));
      }
      children.push(this.emptyParagraph());
    }
    if (register.entries.length === 0) {
      children.push(this.textParagraph('No vulnerability entries identified in the current register.', { italics: true }));
      children.push(this.emptyParagraph());
    }
    children.push(this.pageBreak());

    // 5. Risk Analysis (5x5 Matrix)
    children.push(...this.renderSection('5. Risk Analysis — Likelihood x Impact Matrix', HeadingLevel.HEADING_2));
    children.push(this.textParagraph(
      'The following 5x5 matrix shows the count of risk entries at each likelihood/impact intersection:',
    ));
    children.push(this.emptyParagraph());

    children.push(this.buildRiskMatrix(register.entries));
    children.push(this.emptyParagraph());
    children.push(this.pageBreak());

    // 6. Risk Register (Full Table)
    children.push(...this.renderSection('6. Risk Register', HeadingLevel.HEADING_2));
    if (register.entries.length === 0) {
      children.push(this.textParagraph('No entries in the risk register.', { italics: true }));
    } else {
      const regHeaders = ['ID', 'Threat Event', 'Vulnerability', 'L', 'I', 'CR', 'Treatment', 'Status'];
      const regRows: string[][] = register.entries.map(e => [
        e.id.substring(0, 8),
        e.threatEvent.substring(0, 40),
        e.vulnerability.description.substring(0, 40),
        e.likelihood ? SCALE_LABELS[e.likelihood] : 'N/A',
        e.impact ? SCALE_LABELS[e.impact] : 'N/A',
        e.compositeRisk ? SCALE_LABELS[e.compositeRisk] : 'N/A',
        e.treatmentRecommendation,
        e.treatmentStatus.replace(/_/g, ' '),
      ]);
      children.push(this.renderTable(regHeaders, regRows));
    }
    children.push(this.emptyParagraph());
    children.push(this.pageBreak());

    // 7. Treatment Recommendations
    children.push(...this.renderSection('7. Treatment Recommendations', HeadingLevel.HEADING_2));
    children.push(this.textParagraph(
      'Entries sorted by composite risk (highest first) with treatment recommendations:',
    ));
    children.push(this.emptyParagraph());

    const sortedByRisk = this.sortByCompositeRisk(register.entries);
    if (sortedByRisk.length === 0) {
      children.push(this.textParagraph('No entries requiring treatment.', { italics: true }));
    } else {
      const treatHeaders = ['Priority', 'Threat Event', 'Composite Risk', 'Recommendation', 'Status', 'Reference'];
      const treatRows: string[][] = sortedByRisk.map((e, i) => [
        String(i + 1),
        e.threatEvent.substring(0, 40),
        e.compositeRisk ? SCALE_LABELS[e.compositeRisk] : 'N/A',
        e.treatmentRecommendation,
        e.treatmentStatus.replace(/_/g, ' '),
        e.treatmentReference || '-',
      ]);
      children.push(this.renderTable(treatHeaders, treatRows));
    }
    children.push(this.emptyParagraph());
    children.push(this.pageBreak());

    // 8. AO Sign-Off
    children.push(...this.renderSection('8. Authorizing Official Sign-Off', HeadingLevel.HEADING_2));
    children.push(this.emptyParagraph());
    const aoName = config.authorizingOfficial?.displayName || '[Authorizing Official Name]';
    const aoRole = config.authorizingOfficial?.role || 'Authorizing Official';
    children.push(this.textParagraph(
      'I have reviewed the risk assessment findings presented in this report and accept ' +
      'the residual risk posture for the assessment period.',
    ));
    children.push(this.emptyParagraph());
    children.push(this.emptyParagraph());
    children.push(this.textParagraph('_________________________________'));
    children.push(this.textParagraph(`Name: ${aoName}`));
    children.push(this.textParagraph(`Title: ${aoRole}`));
    children.push(this.textParagraph('Date: _______________'));
    children.push(this.emptyParagraph());

    return children;
  }

  // ── Helpers ──

  private countByCompositeRisk(entries: RiskEntry[]): Record<NistQualitativeScore, number> {
    const counts: Record<NistQualitativeScore, number> = {
      very_low: 0, low: 0, moderate: 0, high: 0, very_high: 0,
    };
    for (const e of entries) {
      if (e.compositeRisk) {
        counts[e.compositeRisk]++;
      }
    }
    return counts;
  }

  private countByTreatmentStatus(entries: RiskEntry[]): Record<string, number> {
    const counts: Record<string, number> = {
      recommended: 0, in_progress: 0, mitigated: 0, accepted_residual: 0, transferred: 0,
    };
    for (const e of entries) {
      if (counts[e.treatmentStatus] !== undefined) {
        counts[e.treatmentStatus]++;
      }
    }
    return counts;
  }

  private groupByField(entries: RiskEntry[], field: 'threatSource'): Record<string, RiskEntry[]> {
    const groups: Record<string, RiskEntry[]> = {};
    for (const e of entries) {
      const key = e[field];
      if (!groups[key]) groups[key] = [];
      groups[key].push(e);
    }
    return groups;
  }

  private groupBySourceType(entries: RiskEntry[]): Record<string, RiskEntry[]> {
    const groups: Record<string, RiskEntry[]> = {};
    for (const e of entries) {
      const key = e.source.type;
      if (!groups[key]) groups[key] = [];
      groups[key].push(e);
    }
    return groups;
  }

  private sortByCompositeRisk(entries: RiskEntry[]): RiskEntry[] {
    const riskOrder: Record<string, number> = {
      very_high: 5, high: 4, moderate: 3, low: 2, very_low: 1,
    };
    return [...entries].sort((a, b) => {
      const aVal = a.compositeRisk ? riskOrder[a.compositeRisk] : 0;
      const bVal = b.compositeRisk ? riskOrder[b.compositeRisk] : 0;
      return bVal - aVal;
    });
  }

  private buildRiskMatrix(entries: RiskEntry[]): any {
    // Build 5x5 count matrix: rows = likelihood (top=very_high), cols = impact
    const matrix: number[][] = SCALE_ORDER.map(() => SCALE_ORDER.map(() => 0));

    for (const e of entries) {
      if (e.likelihood && e.impact) {
        const row = SCALE_ORDER.indexOf(e.likelihood);
        const col = SCALE_ORDER.indexOf(e.impact);
        if (row >= 0 && col >= 0) {
          matrix[row][col]++;
        }
      }
    }

    // Table header: empty corner + impact labels
    const headers = ['Likelihood \\ Impact', ...SCALE_ORDER.map(s => SCALE_LABELS[s])];

    // Rows from very_high (top) to very_low (bottom)
    const rows: string[][] = [];
    for (let i = SCALE_ORDER.length - 1; i >= 0; i--) {
      const row: string[] = [SCALE_LABELS[SCALE_ORDER[i]]];
      for (let j = 0; j < SCALE_ORDER.length; j++) {
        row.push(String(matrix[i][j]));
      }
      rows.push(row);
    }

    return this.renderTable(headers, rows);
  }
}
