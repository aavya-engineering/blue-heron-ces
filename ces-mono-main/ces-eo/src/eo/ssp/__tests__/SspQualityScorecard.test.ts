// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { describe, it, expect, beforeEach } from '@jest/globals';
import { SspQualityScorecard } from '../SspQualityScorecard.js';
import type { SystemSecurityPlan, ControlImplementation } from 'ces-shared/types/ssp';
import type { PlanOfActionMilestones, PoamItem } from 'ces-shared/types/poam';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('SspQualityScorecard', () => {
  let scorecard: SspQualityScorecard;

  beforeEach(() => {
    scorecard = new SspQualityScorecard();
  });

  /**
   * Helper: Create well-formed SSP with all metrics passing
   */
  function createWellFormedSsp(): SystemSecurityPlan {
    const controls: ControlImplementation[] = [
      {
        control_id: 'AC.L2-3.1.1',
        nist_ref: '3.1.1',
        family: 'AC',
        practice: 'Limit system access to authorized users',
        status: 'met',
        classification: 'automated',
        weight: 5,
        implementationNarrative:
          'Control: AC.L2-3.1.1. ' +
          'Access control is implemented using Azure AD Conditional Access policies. ' +
          'Policy ID AC-001 enforces MFA for all CUI access. ' +
          'Session timeout is set to 30 days per organizational policy. ' +
          'Responsible Role: System Administrator manages access controls. ' +
          'Evidence: Access control logs are retained for 365 days in Log Analytics. ' +
          'Status: Implemented and verified. ' +
          'Organization-defined parameter: Maximum failed login attempts set to 5 attempts. ' +
          'Enforcement mechanism configured via Conditional Access policy CA-MFA-001.',
        technologyUsed: ['Azure AD', 'Conditional Access'],
        responsibleRole: 'System Administrator',
        evidenceReferences: ['EV-2024-001', 'blob://evidence/ac-logs.json'],
        relatedPolicies: [],
        odpValues: [],
        assessmentObjectives: [],
      },
      {
        control_id: 'AU.L2-3.3.1',
        nist_ref: '3.3.1',
        family: 'AU',
        practice: 'Create and retain system audit logs',
        status: 'met',
        classification: 'automated',
        weight: 5,
        implementationNarrative:
          'Control: AU.L2-3.3.1. ' +
          'Audit logging is implemented using Microsoft Sentinel and Log Analytics. ' +
          'Policy ID AU-001 defines audit event types. ' +
          'Log retention period is 365 days per NIST SP 800-53 guidance. ' +
          'Responsible Role: ISSO reviews audit logs weekly. ' +
          'Evidence: Audit logs stored in Azure blob storage with SHA-256 checksums. ' +
          'Status: Implemented. ' +
          'Organization-defined parameter: Audit record retention set to 365 days. ' +
          'Enforcement mechanism: Log Analytics workspace with immutable storage.',
        technologyUsed: ['Sentinel', 'Log Analytics'],
        responsibleRole: 'ISSO',
        evidenceReferences: ['EV-2024-002'],
        relatedPolicies: [],
        odpValues: [],
        assessmentObjectives: [],
      },
      {
        control_id: 'IA.L2-3.5.6',
        nist_ref: '3.5.6',
        family: 'IA',
        practice: 'Use multi-factor authentication',
        status: 'met',
        classification: 'automated',
        weight: 5,
        implementationNarrative:
          'Control: IA.L2-3.5.6. ' +
          'Multi-factor authentication is enforced using Microsoft Authenticator and FIDO2 security keys. ' +
          'Policy ID IA-006 mandates MFA for all CUI access within 30 days of provisioning. ' +
          'MFA reset lockout period is 24 hours. ' +
          'Responsible Role: Identity Administrator configures MFA policies. ' +
          'Evidence: MFA enrollment status tracked in Azure AD logs with retention period of 730 days. ' +
          'Status: Fully implemented across all user accounts. ' +
          'Organization-defined parameter: MFA timeout set to 8 hours for trusted devices. ' +
          'Enforcement mechanism: Conditional Access policy requiring MFA for all cloud apps.',
        technologyUsed: ['Microsoft Authenticator', 'FIDO2'],
        responsibleRole: 'Identity Administrator',
        evidenceReferences: ['EV-2024-003', 'blob://evidence/mfa-enrollment.json'],
        relatedPolicies: [],
        odpValues: [],
        assessmentObjectives: [],
      },
    ];

    return {
      sspId: 'test-ssp-001',
      generatedAt: new Date().toISOString(),
      tenantId: 'test-tenant',
      systemName: 'Test System',
      systemDescription: 'Test system for SSP validation',
      authorizationBoundary: { description: 'Test boundary', zones: [] },
      systemComponents: { sections: [] },
      networkTopology: { description: 'Test network', topology: [] },
      interconnections: [],
      rolesAndResponsibilities: [],
      hostingModel: { model: 'Cloud', environment: 'Azure Gov', techStack: 'M365 GCC High' },
      controlImplementations: controls,
      version: '1.0',
      lastUpdatedBy: 'Test',
      sourceArtifacts: [],
      sharedResponsibilityMatrix: {
        totalControls: 110,
        inherited: 48,
        shared: 42,
        customer: 20,
        byFamily: [
          { family: 'AC', inherited: 5, shared: 10, customer: 7 },
          { family: 'AU', inherited: 4, shared: 3, customer: 2 },
        ],
        fedRampReference: 'Inherited controls based on Microsoft FedRAMP High Authorization Package, ATO date 2024-01-01',
      } as any,
      appendices: [
        { id: 'A', documentId: 'AUTO-GENERATED', title: 'Network Architecture Diagram', summary: 'Rendered network diagram (no Mermaid code)' },
        { id: 'B', documentId: 'AUTO-GENERATED', title: 'Data Flow Diagrams', summary: 'Rendered data flow diagram (no Mermaid code)' },
        { id: 'C', documentId: 'AUTO-GENERATED', title: 'Authorization Boundary', summary: 'Rendered authorization boundary (no Mermaid code)' },
      ],
    } as SystemSecurityPlan;
  }

  /**
   * Helper: Create tenant manifest with categorized assets
   */
  function createTenantManifest(): Record<string, unknown> {
    return {
      assets: [
        { name: 'M365 Tenant', category: 'CUI' },
        { name: 'SharePoint Site', category: 'CUI' },
        { name: 'Azure Subscription', category: 'SPA' },
      ],
    };
  }

  /**
   * Helper: Create POA&M with matching control IDs
   */
  function createPoam(controlIds: string[]): PlanOfActionMilestones {
    const items: PoamItem[] = controlIds.map(controlId => ({
      itemId: `POAM-${controlId}`,
      control_id: controlId,
      nist_ref: '3.1.1',
      practice: 'Test practice',
      weight: 5,
      deficiencyDescription: `Deficiency for ${controlId}`,
      plannedCorrectiveAction: 'Implement corrective action',
      responsibleParty: 'System Owner',
      estimatedCompletionDate: '2024-12-31',
      resourcesRequired: 'Staff time',
      status: 'open' as const,
      milestones: [],
    }));

    return {
      poamId: 'test-poam-001',
      generatedAt: new Date().toISOString(),
      tenantId: 'test-tenant',
      sprsScore: 85,
      items,
      summary: {
        totalItems: controlIds.length,
        openItems: controlIds.length,
        totalWeightOnPoam: 0,
        projectedScoreAfterPoam: 0,
      },
      eligibility: {
        eligible: true,
        certificationPath: 'full',
        blockers: [],
        scoreThresholdMet: true,
        weightRuleMet: true,
        prohibitedControlsMet: true,
      },
    };
  }

  it('should pass all metrics with well-formed SSP', () => {
    const ssp = createWellFormedSsp();
    const tenantManifest = createTenantManifest();
    const infraManifest = {};
    const poam = undefined;

    const report = scorecard.validate(ssp, tenantManifest, infraManifest, poam);

    expect(report.overallPass).toBe(true);
    expect(report.metricsPassedCount).toBe(8);
    expect(report.metricsTotalCount).toBe(8);
    expect(report.sspSystemName).toBe('Test System');
    expect(report.metrics).toHaveLength(8);

    // All metrics should pass
    for (const metric of report.metrics) {
      expect(metric.passed).toBe(true);
    }
  });

  it('should fail Metric 1 with short narratives (<400 chars)', () => {
    const ssp = createWellFormedSsp();

    // Shorten first control narrative
    ssp.controlImplementations[0].implementationNarrative = 'Short narrative with Azure AD and Admin role.';

    const report = scorecard.validate(ssp, {}, {}, undefined);

    const metric1 = report.metrics.find(m => m.metricId === 1);
    expect(metric1).toBeDefined();
    expect(metric1!.passed).toBe(false);
    expect(metric1!.score).toBeLessThan(95);
    expect(metric1!.failureDetails).toBeDefined();
    expect(metric1!.failureDetails![0]).toContain('AC.L2-3.1.1');
    expect(metric1!.failureDetails![0]).toContain('narrative too short');
  });

  it('should fail Metric 2 with missing dimensions', () => {
    const ssp = createWellFormedSsp();

    // Remove dimensions from first control
    ssp.controlImplementations[0].implementationNarrative =
      'This is a long narrative with 400 characters that lacks specific dimension keywords. ' +
      'It describes the control implementation in general terms without referencing specific tools, ' +
      'roles, evidence artifacts, or status indicators. This narrative is intentionally vague to test ' +
      'the 5-dimension completeness metric. The narrative continues to reach the minimum length requirement ' +
      'of 400 characters to avoid failing the narrative specificity check while still failing the dimension check.';
    ssp.controlImplementations[0].responsibleRole = '';
    ssp.controlImplementations[0].evidenceReferences = [];

    const report = scorecard.validate(ssp, {}, {}, undefined);

    const metric2 = report.metrics.find(m => m.metricId === 2);
    expect(metric2).toBeDefined();
    expect(metric2!.passed).toBe(false);
    expect(metric2!.failureDetails).toBeDefined();
    expect(metric2!.failureDetails!.some(f => f.includes('AC.L2-3.1.1'))).toBe(true);
  });

  it('should fail Metric 3 with uncategorized assets', () => {
    const ssp = createWellFormedSsp();
    const tenantManifest = {
      assets: [
        { name: 'M365 Tenant', category: 'CUI' },
        { name: 'Uncategorized Asset', category: 'Uncategorized' },
        { name: 'Null Category Asset', category: null },
      ],
    };

    const report = scorecard.validate(ssp, tenantManifest, {}, undefined);

    const metric3 = report.metrics.find(m => m.metricId === 3);
    expect(metric3).toBeDefined();
    expect(metric3!.passed).toBe(false);
    expect(metric3!.score).toBeLessThan(95);
    expect(metric3!.failureDetails).toBeDefined();
    expect(metric3!.failureDetails!.some(f => f.includes('Uncategorized Asset'))).toBe(true);
    expect(metric3!.failureDetails!.some(f => f.includes('Null Category Asset'))).toBe(true);
  });

  it('should fail Metric 4 with Mermaid code blocks', () => {
    const ssp = createWellFormedSsp();

    // Add Mermaid code block to Appendix A
    ssp.appendices![0].summary = '```mermaid\ngraph TD\nA-->B\n```';

    const report = scorecard.validate(ssp, {}, {}, undefined);

    const metric4 = report.metrics.find(m => m.metricId === 4);
    expect(metric4).toBeDefined();
    expect(metric4!.passed).toBe(false);
    expect(metric4!.score).toBe(0);
    expect(metric4!.failureDetails).toBeDefined();
    expect(metric4!.failureDetails![0]).toContain('Appendix A');
    expect(metric4!.failureDetails![0]).toContain('not rendered');
  });

  it('should fail Metric 5 with missing ODP documentation', () => {
    const ssp = createWellFormedSsp();

    // Remove numeric values and enforcement mechanisms from ODP controls
    for (const control of ssp.controlImplementations) {
      if (['AC.L2-3.1.1', 'AU.L2-3.3.1', 'IA.L2-3.5.6'].includes(control.control_id)) {
        control.implementationNarrative =
          'This control is implemented using organizational policies and procedures. ' +
          'The responsible role manages the implementation. Evidence is documented in artifacts. ' +
          'The implementation status is complete. This narrative lacks specific numeric values ' +
          'and enforcement mechanism references required for ODP controls. The narrative is ' +
          'sufficiently long to pass other metrics but intentionally omits ODP-specific details.';
      }
    }

    const report = scorecard.validate(ssp, {}, {}, undefined);

    const metric5 = report.metrics.find(m => m.metricId === 5);
    expect(metric5).toBeDefined();
    expect(metric5!.passed).toBe(false);
    expect(metric5!.score).toBeLessThan(80);
    expect(metric5!.failureDetails).toBeDefined();
  });

  it('should fail Metric 6 with missing evidence linkage', () => {
    const ssp = createWellFormedSsp();

    // Remove evidence references from all controls
    for (const control of ssp.controlImplementations) {
      control.evidenceReferences = [];
      control.implementationNarrative = control.implementationNarrative.replace(
        /Evidence:.*?(\.|$)/g,
        ''
      );
    }

    const report = scorecard.validate(ssp, {}, {}, undefined);

    const metric6 = report.metrics.find(m => m.metricId === 6);
    expect(metric6).toBeDefined();
    expect(metric6!.passed).toBe(false);
    expect(metric6!.score).toBeLessThan(80);
    expect(metric6!.failureDetails).toBeDefined();
  });

  it('should fail Metric 7 with hardcoded CRM (inherited=12)', () => {
    const ssp = createWellFormedSsp();

    // Use old hardcoded inherited value
    ssp.sharedResponsibilityMatrix!.inherited = 12;

    const report = scorecard.validate(ssp, {}, {}, undefined);

    const metric7 = report.metrics.find(m => m.metricId === 7);
    expect(metric7).toBeDefined();
    expect(metric7!.passed).toBe(false);
    expect(metric7!.score).toBe(0);
    expect(metric7!.failureDetails).toBeDefined();
    expect(metric7!.failureDetails![0]).toContain('hardcoded inherited count');
  });

  it('should fail Metric 7 without FedRAMP reference', () => {
    const ssp = createWellFormedSsp();

    // Remove FedRAMP reference by creating new CRM without it
    (ssp as any).sharedResponsibilityMatrix = {
      totalControls: 110,
      inherited: 48,
      shared: 42,
      customer: 20,
      byFamily: [
        { family: 'AC', inherited: 5, shared: 10, customer: 7 },
        { family: 'AU', inherited: 4, shared: 3, customer: 2 },
      ],
      fedRampReference: 'Generic reference to cloud services',
    };

    const report = scorecard.validate(ssp, {}, {}, undefined);

    const metric7 = report.metrics.find(m => m.metricId === 7);
    expect(metric7).toBeDefined();
    expect(metric7!.passed).toBe(false);
    expect(metric7!.failureDetails).toBeDefined();
    expect(metric7!.failureDetails!.some(f => f.toLowerCase().includes('fedramp'))).toBe(true);
  });

  it('should fail Metric 8 with Partial controls missing POA&M entries', () => {
    const ssp = createWellFormedSsp();

    // Set one control to partial (correct ControlStatus type)
    ssp.controlImplementations[0].status = 'partial';

    // No POA&M provided
    const report = scorecard.validate(ssp, {}, {}, undefined);

    const metric8 = report.metrics.find(m => m.metricId === 8);
    expect(metric8).toBeDefined();
    expect(metric8!.passed).toBe(false);
    expect(metric8!.score).toBe(0);
    expect(metric8!.failureDetails).toBeDefined();
    expect(metric8!.failureDetails![0]).toContain('Partial controls');
  });

  it('should pass Metric 8 with matching POA&M entries', () => {
    const ssp = createWellFormedSsp();

    // Set controls to partial (correct ControlStatus type)
    ssp.controlImplementations[0].status = 'partial';
    ssp.controlImplementations[1].status = 'partial';

    // Provide matching POA&M
    const poam = createPoam(['AC.L2-3.1.1', 'AU.L2-3.3.1']);

    const report = scorecard.validate(ssp, {}, {}, poam);

    const metric8 = report.metrics.find(m => m.metricId === 8);
    expect(metric8).toBeDefined();
    expect(metric8!.passed).toBe(true);
    expect(metric8!.score).toBe(100);
  });

  it('should generate validation report JSON', () => {
    const ssp = createWellFormedSsp();
    const report = scorecard.validate(ssp, {}, {}, undefined);

    expect(report.timestamp).toBeDefined();
    expect(report.sspSystemName).toBe('Test System');
    expect(report.overallPass).toBeDefined();
    expect(report.metricsPassedCount).toBeGreaterThanOrEqual(0);
    expect(report.metricsTotalCount).toBe(8);
    expect(report.metrics).toHaveLength(8);
  });

  it('should save validation report to output/validation/', () => {
    const ssp = createWellFormedSsp();
    const report = scorecard.validate(ssp, {}, {}, undefined);

    const tempDir = path.join(process.cwd(), 'temp-test-output');
    const filepath = scorecard.saveValidationReport(report, tempDir);

    expect(fs.existsSync(filepath)).toBe(true);
    expect(filepath).toContain('output');
    expect(filepath).toContain('validation');
    expect(filepath).toContain('ssp-validation-');

    const savedReport = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    expect(savedReport.sspSystemName).toBe('Test System');
    expect(savedReport.metrics).toHaveLength(8);

    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should include per-control failure details in report', () => {
    const ssp = createWellFormedSsp();

    // Create multiple failures
    ssp.controlImplementations[0].implementationNarrative = 'Short narrative';
    ssp.controlImplementations[1].evidenceReferences = [];
    ssp.controlImplementations[1].implementationNarrative =
      'Long narrative without evidence references or artifact patterns. This narrative is ' +
      'intentionally long to avoid failing the narrative specificity check while failing the ' +
      'evidence linkage metric. The narrative continues to reach the minimum length requirement.';

    const report = scorecard.validate(ssp, {}, {}, undefined);

    expect(report.overallPass).toBe(false);

    // Check Metric 1 failure details
    const metric1 = report.metrics.find(m => m.metricId === 1);
    expect(metric1!.failureDetails).toBeDefined();
    expect(metric1!.failureDetails!.some(f => f.includes('AC.L2-3.1.1'))).toBe(true);

    // Check Metric 6 failure details
    const metric6 = report.metrics.find(m => m.metricId === 6);
    expect(metric6!.failureDetails).toBeDefined();
    expect(metric6!.failureDetails!.some(f => f.includes('AU.L2-3.3.1'))).toBe(true);
  });

  it('should require all 8 metrics passing for overall pass', () => {
    const ssp = createWellFormedSsp();
    const tenantManifest = createTenantManifest();

    // Fail just one metric (Metric 4: Diagram Readiness)
    ssp.appendices![0].summary = '```mermaid\ngraph TD\n```';

    const report = scorecard.validate(ssp, tenantManifest, {}, undefined);

    expect(report.metricsPassedCount).toBe(7);
    expect(report.metricsTotalCount).toBe(8);
    expect(report.overallPass).toBe(false);
  });

  it('should handle SSP with no appendices for Metric 4', () => {
    const ssp = createWellFormedSsp();
    ssp.appendices = undefined;

    const report = scorecard.validate(ssp, {}, {}, undefined);

    const metric4 = report.metrics.find(m => m.metricId === 4);
    expect(metric4).toBeDefined();
    expect(metric4!.passed).toBe(false);
    expect(metric4!.failureDetails).toBeDefined();
    expect(metric4!.failureDetails![0]).toContain('No appendices found');
  });

  it('should pass Metric 3 when no assets are defined', () => {
    const ssp = createWellFormedSsp();
    const tenantManifest = { assets: [] };
    const infraManifest = {};

    const report = scorecard.validate(ssp, tenantManifest, infraManifest, undefined);

    const metric3 = report.metrics.find(m => m.metricId === 3);
    expect(metric3).toBeDefined();
    expect(metric3!.passed).toBe(true);
    expect(metric3!.score).toBe(100);
  });

  it('should detect POA&M control ID mismatches for Metric 8', () => {
    const ssp = createWellFormedSsp();
    ssp.controlImplementations[0].status = 'partial';

    // POA&M references non-existent control
    const poam = createPoam(['AC.L2-3.1.1', 'NONEXISTENT.L2-9.9.9']);

    const report = scorecard.validate(ssp, {}, {}, poam);

    const metric8 = report.metrics.find(m => m.metricId === 8);
    expect(metric8).toBeDefined();
    expect(metric8!.passed).toBe(false);
    expect(metric8!.failureDetails).toBeDefined();
    expect(metric8!.failureDetails!.some(f => f.includes('NONEXISTENT.L2-9.9.9'))).toBe(true);
  });
});
