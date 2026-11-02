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
import { writeJsonArtifact } from 'ces-shared/persistence/files';
import type { SystemSecurityPlan, ControlImplementation } from 'ces-shared/types/ssp';
import type { PlanOfActionMilestones } from 'ces-shared/types/poam';
import type { EoBoundarySection, EoPoamSummary } from '../../shared/types/ssp.types.js';
import { NarrativeNegationGuard } from './NarrativeNegationGuard.js';

/**
 * W5.1: one Stamper evidence pointer per file (planned by W3.1; not yet on the EO-local type).
 * Read structurally; `sha256` is the hash of the evidence file.
 */
interface EvidenceDetailLike {
  sha256?: string;
}

/** W5.1: paragraphs the generator appends after the W1.4 negation guard ran; they are disclosures, not narrative. */
const APPENDED_DISCLOSURE = /\n\n(Evidence disagreement|Presence only): [\s\S]*?(?=\n\n(Evidence disagreement|Presence only): |$)/g;

/** W5.1: the narrative the W1.4 guard saw (appended disclosures removed). */
function guardedNarrative(narrative: string): string {
  return narrative.replace(APPENDED_DISCLOSURE, '');
}

/** W5.1: placeholder categories (single-brace {name} tokens are URL parameters / naming conventions, as in V16 / V18). */
const PLACEHOLDER_PATTERNS: Array<{ category: string; re: RegExp }> = [
  { category: 'unresolved {{token}}', re: /\{\{[^}]+\}\}/g },
  { category: '[MANUAL INPUT REQUIRED]', re: /\[MANUAL INPUT REQUIRED\]/g },
  { category: 'REQUIRES MANUAL INPUT', re: /REQUIRES MANUAL INPUT/g },
  { category: '[Definition not resolved', re: /\[Definition not resolved/g },
  { category: 'dangling "managed by ."', re: /managed by \./g },
  { category: '[object Object]', re: /\[object Object\]/g },
];

/** W5.1: questionnaire-key shape (snake_case), as V12 uses it. */
const QUESTIONNAIRE_KEY = /^[a-z0-9]+(_[a-z0-9]+)+$/;

/** W5.1: DOCX status labels allowed per status (legacy checkbox and directive paths of SspDocxExporter). */
const ALLOWED_STATUS_LABELS: Record<string, string[]> = {
  met: ['Implemented', 'Implemented Through Prohibition', 'Inherited from Microsoft FedRAMP High', 'Inherited from FedRAMP High CSP'],
  partial: ['Partially Implemented'],
  not_met: ['Not Implemented (see POA&M)', 'Not Yet Implemented — See POA&M'],
  not_assessed: ['Not Yet Assessed'],
};

/**
 * Extended Shared Responsibility Matrix with FedRAMP reference
 */
interface ExtendedSharedResponsibilityMatrix {
  totalControls: number;
  inherited: number;
  shared: number;
  customer: number;
  byFamily: Array<{ family: string; inherited: number; shared: number; customer: number }>;
  fedRampReference?: string;
  controlDetails?: Array<{ controlId: string; responsibility: string; rationale: string }>;
}

/**
 * Result for a single validation metric
 */
export interface MetricResult {
  metricId: number;
  metricName: string;
  score: number;
  threshold: number;
  passed: boolean;
  failureDetails?: string[];
}

/**
 * Complete validation report for an SSP
 */
export interface ValidationReport {
  timestamp: string;
  sspSystemName: string;
  overallPass: boolean;
  metricsPassedCount: number;
  metricsTotalCount: number;
  metrics: MetricResult[];
  /**
   * W5.1: warn-only metrics 9-13. They never change overallPass or the metric counts above;
   * they are reported in the saved validation JSON.
   */
  warnMetrics: MetricResult[];
  warnMetricsPassedCount: number;
}

/**
 * Tool catalog for Metric 1 specificity scoring
 */
const TOOL_CATALOG = [
  'Microsoft Authenticator',
  'Azure AD',
  'Entra ID',
  'Conditional Access',
  'Microsoft Defender',
  'Sentinel',
  'Intune',
  'CrowdStrike',
  'Splunk',
  'Log Analytics',
  'Azure Policy',
  'Microsoft Graph',
  'PIM',
  'Exchange Online Protection',
  'OneDrive',
  'SharePoint',
  'Teams',
  'Purview',
  'Azure Key Vault',
  'BitLocker',
  'Windows Hello',
  'FIDO2',
  'Autopilot',
  'Defender for Endpoint',
  'Defender for Identity',
  'Defender for Cloud Apps',
  'Azure Information Protection',
  'Microsoft 365',
  'Office 365',
  'Power Automate',
  'Azure DevOps',
  'GitHub Advanced Security',
  'Qualys',
  'Tenable',
  'Nessus',
  'CrowdStrike Falcon',
  'ServiceNow',
  'Jira',
  'Azure Monitor',
  'Application Insights',
  'Azure Firewall',
  'Network Security Group',
  'Azure Front Door',
  'Azure WAF',
  'Azure DDoS Protection',
  'Azure Bastion',
  'Azure Private Link',
  'Azure ExpressRoute',
  'Azure VPN Gateway',
  'Privileged Identity Management',
];

/**
 * ODP controls requiring organization-defined parameters (28 controls)
 */
const ODP_CONTROLS = [
  'AC.L2-3.1.1',
  'AC.L2-3.1.2',
  'AC.L2-3.1.3',
  'AC.L2-3.1.8',
  'AC.L2-3.1.11',
  'AC.L2-3.1.18',
  'AC.L2-3.1.19',
  'AC.L2-3.1.20',
  'AC.L2-3.1.22',
  'AU.L2-3.3.1',
  'AU.L2-3.3.2',
  'AU.L2-3.3.6',
  'CM.L2-3.4.2',
  'CM.L2-3.4.5',
  'CM.L2-3.4.8',
  'IA.L2-3.5.6',
  'IA.L2-3.5.7',
  'IA.L2-3.5.8',
  'IA.L2-3.5.11',
  'IR.L2-3.6.1',
  'IR.L2-3.6.2',
  'MA.L2-3.7.1',
  'MA.L2-3.7.5',
  'MP.L2-3.8.3',
  'PE.L2-3.10.1',
  'PS.L2-3.9.1',
  'RA.L2-3.11.2',
  'SC.L2-3.13.8',
];

/**
 * P1.7: where SSP validation reports go when no directory is passed.
 * 1. `EO_VALIDATION_REPORT_DIR` when set;
 * 2. else `<CES_PIPELINE_ROOT>/EvidenceOps/validation` when `CES_PIPELINE_ROOT` is set, so a
 *    pipeline run writes nothing inside the clone;
 * 3. else the historical `<cwd>/output/validation`.
 */
export function resolveValidationReportDir(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.EO_VALIDATION_REPORT_DIR?.trim();
  if (explicit) return path.resolve(explicit);
  const pipelineRoot = env.CES_PIPELINE_ROOT?.trim();
  if (pipelineRoot) return path.join(path.resolve(pipelineRoot), 'EvidenceOps', 'validation');
  return path.join(process.cwd(), 'output', 'validation');
}

/**
 * SspQualityScorecard: Pre-export validation gate for CMMC L2 SSP generation.
 *
 * Implements 8 validation metrics:
 * 1. Narrative Specificity Score (95% threshold)
 * 2. 5-Dimension Completeness (95% threshold)
 * 3. CMMC Asset Coverage (95% threshold)
 * 4. Diagram Readiness (100% threshold, binary)
 * 5. ODP Documentation Rate (80% threshold)
 * 6. Evidence Linkage Rate (80% threshold)
 * 7. Shared Responsibility Accuracy (100% threshold, binary)
 * 8. Cross-Reference Integrity (100% threshold, binary)
 *
 * W5.1 warn-only metrics (reported in `warnMetrics`, never in overallPass):
 * 9. Status vs Narrative (shared negation lexicon)
 * 10. DOCX Status Vocabulary (JSON-side proxy)
 * 11. Placeholders
 * 12. Boundary Semantics
 * 13. Posture Consistency
 *
 * SSPs failing to meet thresholds block DOCX generation and produce a JSON
 * validation report with control-level failure details.
 */
export class SspQualityScorecard {
  /**
   * Validate SSP against all 8 quality metrics.
   *
   * @param sspJson SSP JSON object
   * @param tenantManifest Tenant manifest for asset categorization
   * @param infraManifest Infrastructure manifest for asset categorization
   * @param poamJson POA&M JSON for cross-reference validation
   * @param sprsScore SPRS score for additional context (optional)
   * @returns ValidationReport with per-metric results and overall pass/fail
   */
  public validate(
    sspJson: SystemSecurityPlan,
    tenantManifest: Record<string, unknown> | undefined,
    infraManifest: Record<string, unknown> | undefined,
    poamJson: PlanOfActionMilestones | undefined,
    sprsScore?: number
  ): ValidationReport {
    const metrics: MetricResult[] = [];

    // Metric 1: Narrative Specificity Score
    metrics.push(this.validateNarrativeSpecificity(sspJson));

    // Metric 2: 5-Dimension Completeness
    metrics.push(this.validateFiveDimensionCompleteness(sspJson));

    // Metric 3: CMMC Asset Coverage
    metrics.push(this.validateAssetCoverage(sspJson, tenantManifest, infraManifest));

    // Metric 4: Diagram Readiness
    metrics.push(this.validateDiagramReadiness(sspJson));

    // Metric 5: ODP Documentation Rate
    metrics.push(this.validateOdpDocumentation(sspJson));

    // Metric 6: Evidence Linkage Rate
    metrics.push(this.validateEvidenceLinkage(sspJson));

    // Metric 7: Shared Responsibility Accuracy
    metrics.push(this.validateSharedResponsibilityAccuracy(sspJson));

    // Metric 8: Cross-Reference Integrity
    metrics.push(this.validateCrossReferenceIntegrity(sspJson, poamJson));

    const metricsPassedCount = metrics.filter(m => m.passed).length;
    const overallPass = metricsPassedCount === metrics.length;

    // W5.1: warn-only metrics.
    const warnMetrics: MetricResult[] = [
      this.validateStatusVsNarrative(sspJson),
      this.validateDocxStatusVocabulary(sspJson),
      this.validatePlaceholders(sspJson),
      this.validateBoundarySemantics(sspJson),
      this.validatePostureConsistency(sspJson, poamJson, sprsScore),
    ];

    return {
      timestamp: new Date().toISOString(),
      sspSystemName: sspJson.systemName,
      overallPass,
      metricsPassedCount,
      metricsTotalCount: metrics.length,
      metrics,
      warnMetrics,
      warnMetricsPassedCount: warnMetrics.filter(m => m.passed).length,
    };
  }

  private result(metricId: number, metricName: string, score: number, threshold: number, failures: string[]): MetricResult {
    return {
      metricId,
      metricName,
      score: Math.round(score * 100) / 100,
      threshold,
      passed: failures.length === 0 && score >= threshold,
      failureDetails: failures.length > 0 ? failures : undefined,
    };
  }

  /**
   * Metric 9 (W5.1, warn-only): Status vs Narrative (100% threshold).
   * A met control fails when the narrative the W1.4 guard saw (appended "Evidence disagreement" /
   * "Presence only" paragraphs removed) hits the shared negation lexicon
   * (`data/narrative-negation-lexicon.json`). A consistencyFlags entry does not excuse it; the detail says
   * whether the hit is flagged.
   */
  private validateStatusVsNarrative(sspJson: SystemSecurityPlan): MetricResult {
    const met = sspJson.controlImplementations.filter(c => c.status === 'met');
    const failures: string[] = [];
    for (const control of met) {
      const hits = NarrativeNegationGuard.check('met', guardedNarrative(control.implementationNarrative));
      if (hits.length === 0) continue;
      const flagged = new Set(((control as { consistencyFlags?: Array<{ phrase: string }> }).consistencyFlags ?? []).map(f => f.phrase));
      failures.push(`${control.control_id}: met but narrative says ${hits.map(h => `"${h.phrase}"${flagged.has(h.phrase) ? ' (flagged)' : ' (UNFLAGGED)'}`).join(', ')}`);
    }
    const score = met.length > 0 ? ((met.length - failures.length) / met.length) * 100 : 100;
    return this.result(9, 'Status vs Narrative', score, 100, failures);
  }

  /**
   * Metric 10 (W5.1, warn-only): DOCX Status Vocabulary, a JSON-side proxy (100% threshold).
   * The scorecard runs before the DOCX exists, so it checks what the exporter will print: the status is one
   * of the four values; the status label (directive path when `sprsValue` is set, else the checkbox) is in
   * the allowed set for that status; a not-assessed narrative never says "Not Applicable" / "N/A"; no
   * narrative states a status of Not Applicable / N/A / Planned. The DOCX itself is checked by V31.
   */
  private validateDocxStatusVocabulary(sspJson: SystemSecurityPlan): MetricResult {
    const controls = sspJson.controlImplementations;
    const failures: string[] = [];
    for (const control of controls) {
      const allowed = ALLOWED_STATUS_LABELS[control.status];
      if (!allowed) {
        failures.push(`${control.control_id}: status "${control.status}" is not met / partial / not_met / not_assessed`);
        continue;
      }
      const ctrl = control as { sprsValue?: string; directive?: string; directiveMetadata?: Record<string, unknown> };
      if (ctrl.sprsValue && ctrl.directive) {
        const md = ctrl.directiveMetadata ?? {};
        const directiveLabel: Record<string, string> = {
          'implement': md.enforcement_verified ? 'Implemented' : 'Not Yet Implemented — See POA&M',
          'validate': 'Implemented',
          'manual': md.platform_inherited ? 'Inherited from Microsoft FedRAMP High' : 'Implemented',
          'document-absence': 'Not Applicable to This Environment',
          'document-prohibition': md.enforcement_verified ? 'Implemented Through Prohibition' : 'Not Yet Implemented — See POA&M',
          'inherit-fedramp': md.readiness === 'met' ? 'Inherited from FedRAMP High CSP' : 'Pending FedRAMP Inheritance Review',
        };
        const label = directiveLabel[ctrl.directive] ?? control.status;
        if (!allowed.includes(label)) failures.push(`${control.control_id}: status ${control.status} would print "${label}"`);
      }
      const narrative = control.implementationNarrative ?? '';
      if (control.status === 'not_assessed' && /Not Applicable|\bN\/A\b/i.test(narrative)) {
        failures.push(`${control.control_id}: not assessed but the narrative says Not Applicable / N/A`);
      } else if (/(Status|Implementation State):\s*\**\s*(Not Applicable|N\/A|Planned)\b/i.test(narrative) || /☒\s*(Not Applicable|Planned)/.test(narrative)) {
        failures.push(`${control.control_id}: narrative states a status outside the vocabulary (Not Applicable / N/A / Planned)`);
      }
    }
    const failedIds = new Set(failures.map(f => f.split(':')[0]));
    const score = controls.length > 0 ? ((controls.length - failedIds.size) / controls.length) * 100 : 100;
    return this.result(10, 'DOCX Status Vocabulary', score, 100, failures);
  }

  /**
   * Metric 11 (W5.1, warn-only): Placeholders (100% threshold).
   * Every string in the SSP JSON is scanned for the PLACEHOLDER_PATTERNS categories. The score is the share
   * of controls whose narrative is free of them; any hit anywhere fails. Details: one line per category with
   * its count and up to five locations.
   */
  private validatePlaceholders(sspJson: SystemSecurityPlan): MetricResult {
    const hits = new Map<string, string[]>();
    const walk = (value: unknown, where: string): void => {
      if (typeof value === 'string') {
        for (const { category, re } of PLACEHOLDER_PATTERNS) {
          const n = (value.match(re) ?? []).length;
          for (let i = 0; i < n; i++) (hits.get(category) ?? hits.set(category, []).get(category)!).push(where);
        }
      } else if (Array.isArray(value)) {
        value.forEach((v, i) => walk(v, `${where}[${i}]`));
      } else if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) walk(v, where ? `${where}.${k}` : k);
      }
    };
    walk(sspJson, '');
    const controls = sspJson.controlImplementations;
    const dirty = controls.filter(c => PLACEHOLDER_PATTERNS.some(({ re }) => new RegExp(re.source).test(c.implementationNarrative ?? '')));
    const failures = [...hits.entries()].map(([category, where]) => {
      const locations = [...new Set(where)];
      return `${category}: ${where.length} hit(s), e.g. ${locations.slice(0, 5).join(', ')}${locations.length > 5 ? ', ...' : ''}`;
    });
    const score = controls.length > 0 ? ((controls.length - dirty.length) / controls.length) * 100 : 100;
    return this.result(11, 'Placeholders', score, 100, failures);
  }

  /**
   * Metric 12 (W5.1, warn-only): Boundary Semantics (100% threshold, binary).
   * The boundary lists at least one zone, and no zone (`zones[]` or `zoneDetails[].name`) is named like a
   * questionnaire key: snake_case, or equal to a `boundaryFacts[].key`.
   */
  private validateBoundarySemantics(sspJson: SystemSecurityPlan): MetricResult {
    const boundary = sspJson.authorizationBoundary as EoBoundarySection | undefined;
    const failures: string[] = [];
    const names = [...new Set([...(boundary?.zones ?? []), ...(boundary?.zoneDetails ?? []).map(z => z.name)].map(String))];
    const factKeys = new Set((boundary?.boundaryFacts ?? []).map(f => String(f.key)));
    if (names.length === 0) failures.push('the authorization boundary lists no zones');
    for (const name of names) {
      if (factKeys.has(name) || QUESTIONNAIRE_KEY.test(name)) failures.push(`zone "${name}" is named like a questionnaire key`);
    }
    return this.result(12, 'Boundary Semantics', failures.length === 0 ? 100 : 0, 100, failures);
  }

  /**
   * Metric 13 (W5.1, warn-only): Posture Consistency (100% threshold, binary).
   * §14 (`poamSummary`) must exist and agree with itself and with the SSP: no item or blocker is a met
   * control; sprsScore + totalWeightOnPoam = projectedScoreAfterPoam; totalItems = items; when the ledger
   * reconciliation is present, items + blockers + no_poam = deficient controls. When a POA&M is passed, its
   * poamId and sprsScore equal §14's; when an SPRS score is passed, it equals §14's sprsScore.
   * The W4.1 posture block is not read (pending W4.1).
   */
  private validatePostureConsistency(
    sspJson: SystemSecurityPlan,
    poamJson: PlanOfActionMilestones | undefined,
    sprsScore: number | undefined
  ): MetricResult {
    const summary = (sspJson as { poamSummary?: EoPoamSummary }).poamSummary;
    const failures: string[] = [];
    if (!summary || !Array.isArray(summary.items)) {
      failures.push('SSP has no §14 poamSummary with items');
      return this.result(13, 'Posture Consistency', 0, 100, failures);
    }
    const status = new Map(sspJson.controlImplementations.map(c => [c.control_id, c.status]));
    for (const entry of [...summary.items, ...(summary.blockers ?? [])]) {
      if (status.get(entry.control_id) === 'met') failures.push(`${entry.control_id}: on the POA&M (§14) but met in the SSP`);
    }
    if (summary.totalItems !== summary.items.length) failures.push(`§14 totalItems ${summary.totalItems} != ${summary.items.length} items`);
    if (typeof summary.sprsScore === 'number' && summary.sprsScore + summary.totalWeightOnPoam !== summary.projectedScoreAfterPoam) {
      failures.push(`§14 SPRS ${summary.sprsScore} + POA&M weight ${summary.totalWeightOnPoam} != projected ${summary.projectedScoreAfterPoam}`);
    }
    const rec = summary.ledgerReconciliation;
    if (rec && rec.asItems + rec.asBlockers + rec.noPoam !== rec.deficientControls) {
      failures.push(`ledger reconciliation: ${rec.asItems} items + ${rec.asBlockers} blockers + ${rec.noPoam} no_poam != ${rec.deficientControls} deficient controls`);
    }
    if (poamJson) {
      if (summary.poamId !== poamJson.poamId) failures.push(`§14 poamId ${summary.poamId} != POA&M ${poamJson.poamId}`);
      if (summary.sprsScore !== poamJson.sprsScore) failures.push(`§14 SPRS ${summary.sprsScore} != POA&M SPRS ${poamJson.sprsScore}`);
    }
    if (sprsScore !== undefined && summary.sprsScore !== sprsScore) failures.push(`§14 SPRS ${summary.sprsScore} != assessed SPRS ${sprsScore}`);
    return this.result(13, 'Posture Consistency', failures.length === 0 ? 100 : 0, 100, failures);
  }

  /**
   * Metric 1: Narrative Specificity Score (95% threshold)
   *
   * Pass criteria per control:
   * - Narrative length >= 400 chars
   * - Contains >= 3 of 4 specificity elements:
   *   - Tool name from catalog
   *   - Policy ID pattern (/[A-Z]{2,6}-\d{3,6}/)
   *   - Retention period (/\d+\s*(day|month|year)s?/)
   *   - Role name (Admin, Operator, ISSO, System Owner, etc.)
   */
  private validateNarrativeSpecificity(sspJson: SystemSecurityPlan): MetricResult {
    const controls = sspJson.controlImplementations;
    const failures: string[] = [];
    let passCount = 0;

    for (const control of controls) {
      const narrative = control.implementationNarrative;

      if (narrative.length < 400) {
        failures.push(`${control.control_id}: narrative too short (${narrative.length} chars)`);
        continue;
      }

      const specificityCount = this.countSpecificityElements(narrative);

      if (specificityCount >= 3) {
        passCount++;
      } else {
        failures.push(`${control.control_id}: insufficient specificity (${specificityCount}/4 elements)`);
      }
    }

    const score = (passCount / controls.length) * 100;
    const threshold = 95;

    return {
      metricId: 1,
      metricName: 'Narrative Specificity Score',
      score: Math.round(score * 100) / 100,
      threshold,
      passed: score >= threshold,
      failureDetails: failures.length > 0 ? failures : undefined,
    };
  }

  /**
   * Count specificity elements in narrative text.
   * Returns count of elements found (0-4).
   */
  private countSpecificityElements(narrative: string): number {
    let count = 0;

    // Element 1: Tool name from catalog
    const hasToolName = TOOL_CATALOG.some(tool =>
      narrative.toLowerCase().includes(tool.toLowerCase())
    );
    if (hasToolName) count++;

    // Element 2: Policy ID pattern
    const policyIdPattern = /[A-Z]{2,6}-\d{3,6}/;
    if (policyIdPattern.test(narrative)) count++;

    // Element 3: Retention period
    const retentionPattern = /\d+\s*(day|month|year)s?/i;
    if (retentionPattern.test(narrative)) count++;

    // Element 4: Role name (SoD tiers)
    const rolePatterns = [
      'Admin',
      'Operator',
      'ISSO',
      'System Owner',
      'Authorizing Official',
      'ISSM',
      'System Administrator',
      'Network Administrator',
      'Security Operations',
      'CUI Program Manager',
    ];
    const hasRole = rolePatterns.some(role =>
      narrative.includes(role)
    );
    if (hasRole) count++;

    return count;
  }

  /**
   * Metric 2: 5-Dimension Completeness (95% threshold)
   *
   * Each control must include 5 dimensions:
   * 1. WHAT: Requirement/Control/Practice keywords or control ID pattern
   * 2. HOW: Implementation/Using/Via keywords or tool names
   * 3. WHO: Responsible Role keywords or role names
   * 4. EVIDENCE: Evidence/Artifacts/Logs keywords or artifact patterns
   * 5. STATUS: Status keywords or Implemented/Partial/Planned
   */
  private validateFiveDimensionCompleteness(sspJson: SystemSecurityPlan): MetricResult {
    const controls = sspJson.controlImplementations;
    const failures: string[] = [];
    let passCount = 0;

    for (const control of controls) {
      const narrative = control.implementationNarrative;
      const missingDimensions: string[] = [];

      // WHAT dimension
      if (!this.hasWhatDimension(narrative)) {
        missingDimensions.push('WHAT');
      }

      // HOW dimension
      if (!this.hasHowDimension(narrative)) {
        missingDimensions.push('HOW');
      }

      // WHO dimension
      if (!this.hasWhoDimension(narrative, control)) {
        missingDimensions.push('WHO');
      }

      // EVIDENCE dimension
      if (!this.hasEvidenceDimension(narrative, control)) {
        missingDimensions.push('EVIDENCE');
      }

      // STATUS dimension
      if (!this.hasStatusDimension(narrative, control)) {
        missingDimensions.push('STATUS');
      }

      if (missingDimensions.length === 0) {
        passCount++;
      } else {
        failures.push(`${control.control_id}: missing dimensions: ${missingDimensions.join(', ')}`);
      }
    }

    const score = (passCount / controls.length) * 100;
    const threshold = 95;

    return {
      metricId: 2,
      metricName: '5-Dimension Completeness',
      score: Math.round(score * 100) / 100,
      threshold,
      passed: score >= threshold,
      failureDetails: failures.length > 0 ? failures : undefined,
    };
  }

  private hasWhatDimension(narrative: string): boolean {
    const patterns = [
      /Requirement:/i,
      /Control:/i,
      /Practice:/i,
      /[A-Z]{2}\.L2-3\.\d+\.\d+/,
    ];
    return patterns.some(p => p.test(narrative));
  }

  private hasHowDimension(narrative: string): boolean {
    const keywords = [
      /Implementation:/i,
      /Using:/i,
      /Via:/i,
    ];
    const hasKeyword = keywords.some(k => k.test(narrative));
    const hasTool = TOOL_CATALOG.some(tool =>
      narrative.toLowerCase().includes(tool.toLowerCase())
    );
    return hasKeyword || hasTool;
  }

  private hasWhoDimension(narrative: string, control: ControlImplementation): boolean {
    const keywords = [
      /Responsible Role:/i,
      /Performed by:/i,
      /Managed by:/i,
    ];
    const hasKeyword = keywords.some(k => k.test(narrative));
    const hasRole = Boolean(control.responsibleRole && control.responsibleRole.length > 0);
    return hasKeyword || hasRole;
  }

  private hasEvidenceDimension(narrative: string, control: ControlImplementation): boolean {
    const keywords = [
      /Evidence:/i,
      /Artifacts:/i,
      /Logs:/i,
      /Documented in:/i,
    ];
    const hasKeyword = keywords.some(k => k.test(narrative));
    const hasArtifact = Boolean(control.evidenceReferences && control.evidenceReferences.length > 0);
    return hasKeyword || hasArtifact;
  }

  private hasStatusDimension(narrative: string, control: ControlImplementation): boolean {
    const keywords = [
      /Status:/i,
      /Implementation State:/i,
      /Implemented/i,
      /Partial/i,
      /Planned/i,
    ];
    const hasKeyword = keywords.some(k => k.test(narrative));
    const hasStatus = Boolean(control.status && control.status !== 'not_assessed');
    return hasKeyword || hasStatus;
  }

  /**
   * Metric 3: CMMC Asset Coverage (95% threshold)
   *
   * Assets from tenant + infra manifests must have valid assetCategory:
   * - Pass: CUI, SPA, CRMA, Specialized, OutOfScope
   * - Fail: null, undefined, "Uncategorized"
   */
  private validateAssetCoverage(
    sspJson: SystemSecurityPlan,
    tenantManifest: Record<string, unknown> | undefined,
    infraManifest: Record<string, unknown> | undefined
  ): MetricResult {
    const failures: string[] = [];
    const assets: Array<{ name: string; category?: string }> = [];

    // Extract assets from tenant manifest
    if (tenantManifest?.assets && Array.isArray(tenantManifest.assets)) {
      assets.push(...(tenantManifest.assets as Array<{ name: string; category?: string }>));
    }

    // Extract assets from infra manifest
    if (infraManifest?.assets && Array.isArray(infraManifest.assets)) {
      assets.push(...(infraManifest.assets as Array<{ name: string; category?: string }>));
    }

    // If no assets defined, pass (no uncategorized assets)
    if (assets.length === 0) {
      return {
        metricId: 3,
        metricName: 'CMMC Asset Coverage',
        score: 100,
        threshold: 95,
        passed: true,
      };
    }

    const validCategories = ['CUI', 'SPA', 'CRMA', 'Specialized', 'OutOfScope'];
    let passCount = 0;

    for (const asset of assets) {
      const category = asset.category;
      if (!category || category === 'Uncategorized') {
        failures.push(`${asset.name}: uncategorized or null category`);
      } else if (validCategories.includes(category)) {
        passCount++;
      } else {
        failures.push(`${asset.name}: invalid category "${category}"`);
      }
    }

    const score = (passCount / assets.length) * 100;
    const threshold = 95;

    return {
      metricId: 3,
      metricName: 'CMMC Asset Coverage',
      score: Math.round(score * 100) / 100,
      threshold,
      passed: score >= threshold,
      failureDetails: failures.length > 0 ? failures : undefined,
    };
  }

  /**
   * Metric 4: Diagram Readiness (100% threshold, binary)
   *
   * Network architecture + data flow diagrams must be rendered (not Mermaid strings).
   * Fail if appendices A/B/C contain ```mermaid code blocks.
   */
  private validateDiagramReadiness(sspJson: SystemSecurityPlan): MetricResult {
    const failures: string[] = [];
    const appendices = sspJson.appendices;

    if (!appendices || appendices.length === 0) {
      failures.push('No appendices found in SSP');
      return {
        metricId: 4,
        metricName: 'Diagram Readiness',
        score: 0,
        threshold: 100,
        passed: false,
        failureDetails: failures,
      };
    }

    // Check Appendix A (Network Architecture)
    const appendixA = appendices.find(a => a.id === 'A');
    if (appendixA && appendixA.summary.includes('```mermaid')) {
      failures.push('Appendix A: Network architecture diagram not rendered (Mermaid code block found)');
    }

    // Check Appendix B (Data Flow Diagrams)
    const appendixB = appendices.find(a => a.id === 'B');
    if (appendixB && appendixB.summary.includes('```mermaid')) {
      failures.push('Appendix B: Data flow diagram not rendered (Mermaid code block found)');
    }

    // Check Appendix C (Authorization Boundary)
    const appendixC = appendices.find(a => a.id === 'C');
    if (appendixC && appendixC.summary.includes('```mermaid')) {
      failures.push('Appendix C: Authorization boundary diagram not rendered (Mermaid code block found)');
    }

    const passed = failures.length === 0;

    return {
      metricId: 4,
      metricName: 'Diagram Readiness',
      score: passed ? 100 : 0,
      threshold: 100,
      passed,
      failureDetails: failures.length > 0 ? failures : undefined,
    };
  }

  /**
   * Metric 5: ODP Documentation Rate (80% threshold)
   *
   * W5.1: the 28 ODP controls must carry `odpValues` (each entry with a parameter and a non-empty value);
   * narrative text no longer counts. Controls are matched by NIST reference, because ces-shared keys the
   * Level 1 practices as `L1-` while the list keys them `L2-`.
   */
  private validateOdpDocumentation(sspJson: SystemSecurityPlan): MetricResult {
    const controls = sspJson.controlImplementations;
    const failures: string[] = [];
    let passCount = 0;

    const nistOf = (id: string): string => id.replace(/^[A-Z]{2}\.L[123]-/, '');
    const odpNistRefs = new Set(ODP_CONTROLS.map(nistOf));
    const odpControls = controls.filter(c => odpNistRefs.has(c.nist_ref ?? nistOf(c.control_id)));

    for (const control of odpControls) {
      const values = Array.isArray(control.odpValues) ? control.odpValues : [];
      const filled = values.filter(v => String(v?.parameter ?? '').trim() !== '' && String(v?.value ?? '').trim() !== '');

      if (values.length > 0 && filled.length === values.length) {
        passCount++;
      } else {
        failures.push(`${control.control_id}: ${values.length === 0 ? 'no odpValues' : `${values.length - filled.length} of ${values.length} odpValues without a parameter or value`}`);
      }
    }

    const score = odpControls.length > 0 ? (passCount / odpControls.length) * 100 : 100;
    const threshold = 80;

    return {
      metricId: 5,
      metricName: 'ODP Documentation Rate',
      score: Math.round(score * 100) / 100,
      threshold,
      passed: score >= threshold,
      failureDetails: failures.length > 0 ? failures : undefined,
    };
  }

  /**
   * Metric 6: Evidence Linkage Rate (80% threshold)
   *
   * W5.1: a control is linked when its `evidenceDetails` (W3.1) holds at least one entry with a 64-hex
   * `sha256`. Narrative patterns and `evidenceReferences` tokens no longer count. The denominator is the
   * controls that are not `not_assessed` (an off-tenant control has no Stamper evidence to point at).
   */
  private validateEvidenceLinkage(sspJson: SystemSecurityPlan): MetricResult {
    const controls = sspJson.controlImplementations.filter(c => c.status !== 'not_assessed');
    const failures: string[] = [];
    let passCount = 0;

    for (const control of controls) {
      const details = (control as { evidenceDetails?: EvidenceDetailLike[] }).evidenceDetails;
      const hashed = Array.isArray(details) ? details.filter(d => /^[a-f0-9]{64}$/i.test(String(d?.sha256 ?? ''))).length : 0;

      if (hashed > 0) {
        passCount++;
      } else {
        failures.push(`${control.control_id}: no hashed evidenceDetails`);
      }
    }

    const score = controls.length > 0 ? (passCount / controls.length) * 100 : 100;
    const threshold = 80;

    return {
      metricId: 6,
      metricName: 'Evidence Linkage Rate',
      score: Math.round(score * 100) / 100,
      threshold,
      passed: score >= threshold,
      failureDetails: failures.length > 0 ? failures : undefined,
    };
  }

  /**
   * Metric 7: Shared Responsibility Accuracy (100% threshold, binary)
   *
   * CRM must:
   * - Reference FedRAMP
   * - Have inherited count != 12 (old hardcoded value)
   * - Expected inherited count: 46-52 range
   */
  private validateSharedResponsibilityAccuracy(sspJson: SystemSecurityPlan): MetricResult {
    const failures: string[] = [];
    const crm = sspJson.sharedResponsibilityMatrix as ExtendedSharedResponsibilityMatrix | undefined;

    if (!crm) {
      failures.push('Shared Responsibility Matrix not found in SSP');
      return {
        metricId: 7,
        metricName: 'Shared Responsibility Accuracy',
        score: 0,
        threshold: 100,
        passed: false,
        failureDetails: failures,
      };
    }

    // Check for FedRAMP reference
    const hasFedRampReference = crm.fedRampReference && crm.fedRampReference.includes('FedRAMP');
    if (!hasFedRampReference) {
      failures.push('CRM does not reference FedRAMP authorization package');
    }

    // Check for hardcoded inherited count (12)
    if (crm.inherited === 12) {
      failures.push('CRM uses hardcoded inherited count (12) instead of dynamic calculation');
    }

    // Validate inherited count is in expected range (46-52)
    if (crm.inherited < 46 || crm.inherited > 52) {
      failures.push(`CRM inherited count (${crm.inherited}) outside expected range (46-52)`);
    }

    const passed = failures.length === 0;

    return {
      metricId: 7,
      metricName: 'Shared Responsibility Accuracy',
      score: passed ? 100 : 0,
      threshold: 100,
      passed,
      failureDetails: failures.length > 0 ? failures : undefined,
    };
  }

  /**
   * Metric 8: Cross-Reference Integrity (100% threshold, binary)
   *
   * - W5.1: a real POA&M must be passed (no POA&M fails, whatever the statuses)
   * - Partial controls must have POA&M references
   * - POA&M control IDs must match SSP control IDs
   */
  private validateCrossReferenceIntegrity(
    sspJson: SystemSecurityPlan,
    poamJson: PlanOfActionMilestones | undefined
  ): MetricResult {
    const failures: string[] = [];
    const controls = sspJson.controlImplementations;

    // Find Partial controls (correct ControlStatus type)
    const partialOrPlannedControls = controls.filter(c =>
      c.status === 'partial'
    );

    // W5.1: a real POA&M (a poamId and an items array) is required, even with no Partial controls.
    if (!poamJson || !poamJson.poamId || !Array.isArray(poamJson.items)) {
      failures.push(partialOrPlannedControls.length > 0
        ? `${partialOrPlannedControls.length} Partial controls found but no POA&M provided`
        : 'No POA&M provided (a POA&M with a poamId and items is required)');
      return {
        metricId: 8,
        metricName: 'Cross-Reference Integrity',
        score: 0,
        threshold: 100,
        passed: false,
        failureDetails: failures,
      };
    }

    // Extract POA&M control IDs
    const poamControlIds = new Set<string>();
    for (const item of poamJson.items) {
      poamControlIds.add(item.control_id);
    }

    // Check each Partial control has POA&M entry
    for (const control of partialOrPlannedControls) {
      if (!poamControlIds.has(control.control_id)) {
        failures.push(`${control.control_id}: status=${control.status} but no POA&M entry found`);
      }
    }

    // Check all POA&M control IDs match SSP controls
    const sspControlIds = new Set(controls.map(c => c.control_id));
    for (const poamControlId of poamControlIds) {
      if (!sspControlIds.has(poamControlId)) {
        failures.push(`POA&M references ${poamControlId} which is not in SSP`);
      }
    }

    const passed = failures.length === 0;

    return {
      metricId: 8,
      metricName: 'Cross-Reference Integrity',
      score: passed ? 100 : 0,
      threshold: 100,
      passed,
      failureDetails: failures.length > 0 ? failures : undefined,
    };
  }

  /**
   * Save validation report as JSON.
   *
   * @param report Validation report
   * @param outputDir Base output directory; the report goes to `<outputDir>/output/validation/`.
   *   When omitted, the directory comes from resolveValidationReportDir() (P1.7).
   * @returns Path to saved JSON file
   */
  public saveValidationReport(report: ValidationReport, outputDir?: string): string {
    const validationDir = outputDir !== undefined
      ? path.join(outputDir, 'output', 'validation')
      : resolveValidationReportDir();

    // Create directory if it doesn't exist
    if (!fs.existsSync(validationDir)) {
      fs.mkdirSync(validationDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    const filename = `ssp-validation-${timestamp}.json`;
    const filepath = path.join(validationDir, filename);

    writeJsonArtifact(filepath, report, { pretty: true });

    return filepath;
  }
}
