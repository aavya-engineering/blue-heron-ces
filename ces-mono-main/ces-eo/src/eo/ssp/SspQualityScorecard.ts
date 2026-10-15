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

    return {
      timestamp: new Date().toISOString(),
      sspSystemName: sspJson.systemName,
      overallPass,
      metricsPassedCount,
      metricsTotalCount: metrics.length,
      metrics,
    };
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
   * 28 ODP controls must have narratives with:
   * - Numeric value (organization-defined parameter)
   * - Enforcement mechanism reference
   */
  private validateOdpDocumentation(sspJson: SystemSecurityPlan): MetricResult {
    const controls = sspJson.controlImplementations;
    const failures: string[] = [];
    let passCount = 0;

    const odpControls = controls.filter(c => ODP_CONTROLS.includes(c.control_id));

    for (const control of odpControls) {
      const narrative = control.implementationNarrative;

      // Check for numeric value
      const hasNumeric = /\d+/.test(narrative);

      // Check for enforcement mechanism reference
      const hasMechanism = this.hasEnforcementMechanism(narrative);

      if (hasNumeric && hasMechanism) {
        passCount++;
      } else {
        const missing: string[] = [];
        if (!hasNumeric) missing.push('numeric value');
        if (!hasMechanism) missing.push('enforcement mechanism');
        failures.push(`${control.control_id}: missing ${missing.join(', ')}`);
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

  private hasEnforcementMechanism(narrative: string): boolean {
    const patterns = [
      /policy/i,
      /procedure/i,
      /mechanism/i,
      /enforcement/i,
      /configured/i,
      /implemented/i,
    ];
    const hasPattern = patterns.some(p => p.test(narrative));
    const hasTool = TOOL_CATALOG.some(tool =>
      narrative.toLowerCase().includes(tool.toLowerCase())
    );
    return hasPattern || hasTool;
  }

  /**
   * Metric 6: Evidence Linkage Rate (80% threshold)
   *
   * Controls must reference evidence artifacts with:
   * - Artifact IDs
   * - SHA-256 hashes
   * - Storage locations
   * - Retention periods
   */
  private validateEvidenceLinkage(sspJson: SystemSecurityPlan): MetricResult {
    const controls = sspJson.controlImplementations;
    const failures: string[] = [];
    let passCount = 0;

    for (const control of controls) {
      const narrative = control.implementationNarrative;
      const hasReferences = control.evidenceReferences && control.evidenceReferences.length > 0;
      const hasArtifactPattern = this.hasArtifactPattern(narrative);

      if (hasReferences || hasArtifactPattern) {
        passCount++;
      } else {
        failures.push(`${control.control_id}: no evidence linkage found`);
      }
    }

    const score = (passCount / controls.length) * 100;
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

  private hasArtifactPattern(narrative: string): boolean {
    // Artifact ID pattern (e.g., EV-2024-001)
    const artifactIdPattern = /[A-Z]{2,4}-\d{4}-\d{3}/;

    // SHA-256 hash pattern
    const sha256Pattern = /[a-f0-9]{64}/i;

    // Storage location pattern (e.g., blob storage, SharePoint)
    const storagePattern = /(blob|sharepoint|onedrive|s3|bucket)/i;

    // Retention period pattern
    const retentionPattern = /retention.*\d+\s*(day|month|year)s?/i;

    return artifactIdPattern.test(narrative) ||
           sha256Pattern.test(narrative) ||
           storagePattern.test(narrative) ||
           retentionPattern.test(narrative);
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

    // If no Partial controls, pass
    if (partialOrPlannedControls.length === 0) {
      return {
        metricId: 8,
        metricName: 'Cross-Reference Integrity',
        score: 100,
        threshold: 100,
        passed: true,
      };
    }

    // If no POA&M provided but Partial controls exist, fail
    if (!poamJson) {
      failures.push(`${partialOrPlannedControls.length} Partial controls found but no POA&M provided`);
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
   * Save validation report to output/validation/ directory as JSON.
   *
   * @param report Validation report
   * @param outputDir Base output directory (default: current working directory)
   * @returns Path to saved JSON file
   */
  public saveValidationReport(report: ValidationReport, outputDir: string = process.cwd()): string {
    const validationDir = path.join(outputDir, 'output', 'validation');

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
