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
        odpValues: [{ parameter: 'PI.ODP.001 test_parameter', value: '5', source: 'test' }],
        assessmentObjectives: [],
        evidenceDetails: [{ path: 'evidence/test/x.json', sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', timestamp: '2026-10-27T00:00:00Z', entryId: 'X.test', verdict: 'SAT', mode: 'state-verified' }],
      } as ControlImplementation,
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
        odpValues: [{ parameter: 'PI.ODP.001 test_parameter', value: '5', source: 'test' }],
        assessmentObjectives: [],
        evidenceDetails: [{ path: 'evidence/test/x.json', sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', timestamp: '2026-10-27T00:00:00Z', entryId: 'X.test', verdict: 'SAT', mode: 'state-verified' }],
      } as ControlImplementation,
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
        odpValues: [{ parameter: 'PI.ODP.001 test_parameter', value: '5', source: 'test' }],
        assessmentObjectives: [],
        evidenceDetails: [{ path: 'evidence/test/x.json', sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', timestamp: '2026-10-27T00:00:00Z', entryId: 'X.test', verdict: 'SAT', mode: 'state-verified' }],
      } as ControlImplementation,
    ];

    return {
      sspId: 'test-ssp-001',
      generatedAt: new Date().toISOString(),
      tenantId: 'test-tenant',
      systemName: 'Test System',
      systemDescription: 'Test system for SSP validation',
      authorizationBoundary: { description: 'Test boundary', zones: ['Microsoft 365 GCC High tenant'], boundaryFacts: [{ key: 'cui_storage_locations', value: 'SharePoint Online', type: 'list' }] } as any,
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
      poamSummary: {
        poamId: 'test-poam-001',
        generatedAt: new Date().toISOString(),
        sprsScore: 85,
        totalItems: 0,
        totalWeightOnPoam: 0,
        projectedScoreAfterPoam: 85,
        certificationPath: 'full',
        eligible: true,
        scoreThresholdMet: true,
        weightRuleMet: true,
        prohibitedControlsMet: true,
        items: [],
        blockers: [],
      },
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
    const poam = createPoam([]);

    const report = scorecard.validate(ssp, tenantManifest, infraManifest, poam, 85);

    expect(report.overallPass).toBe(true);
    expect(report.metricsPassedCount).toBe(8);
    expect(report.metricsTotalCount).toBe(8);
    expect(report.sspSystemName).toBe('Test System');
    expect(report.metrics).toHaveLength(8);

    // All metrics should pass
    for (const metric of report.metrics) {
      expect(metric.passed).toBe(true);
    }

    // W5.1: the five warn-only metrics pass too
    expect(report.warnMetrics.map(m => m.metricId)).toEqual([9, 10, 11, 12, 13]);
    for (const metric of report.warnMetrics) {
      expect({ id: metric.metricId, passed: metric.passed, details: metric.failureDetails }).toEqual({ id: metric.metricId, passed: true, details: undefined });
    }
    expect(report.warnMetricsPassedCount).toBe(5);
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

  it('should fail Metric 5 when ODP controls carry no odpValues (narrative numbers do not count)', () => {
    const ssp = createWellFormedSsp();

    // W5.1: the narratives still hold numbers and mechanisms; only odpValues counts now
    ssp.controlImplementations[0].odpValues = [];
    ssp.controlImplementations[1].odpValues = [{ parameter: 'PI.ODP.002 retention', value: '', source: 'test' }];

    const report = scorecard.validate(ssp, {}, {}, undefined);

    const metric5 = report.metrics.find(m => m.metricId === 5);
    expect(metric5).toBeDefined();
    expect(metric5!.passed).toBe(false);
    expect(metric5!.score).toBeLessThan(80);
    expect(metric5!.failureDetails).toEqual([
      'AC.L2-3.1.1: no odpValues',
      'AU.L2-3.3.1: 1 of 1 odpValues without a parameter or value',
    ]);
  });

  it('should match Metric 5 ODP controls by NIST reference (Level 1 keys count)', () => {
    const ssp = createWellFormedSsp();
    ssp.controlImplementations[0].control_id = 'AC.L1-3.1.1';
    ssp.controlImplementations[0].odpValues = [];

    const metric5 = scorecard.validate(ssp, {}, {}, undefined).metrics.find(m => m.metricId === 5)!;
    expect(metric5.failureDetails).toEqual(['AC.L1-3.1.1: no odpValues']);
  });

  it('should fail Metric 6 with missing evidence linkage', () => {
    const ssp = createWellFormedSsp();

    // W5.1: references, blob paths and narrative hashes no longer count; only hashed evidenceDetails do
    (ssp.controlImplementations[0] as any).evidenceDetails = [];
    (ssp.controlImplementations[1] as any).evidenceDetails = [{ path: 'evidence/a.json', sha256: 'evidence_store' }];
    delete (ssp.controlImplementations[2] as any).evidenceDetails;

    const report = scorecard.validate(ssp, {}, {}, undefined);

    const metric6 = report.metrics.find(m => m.metricId === 6);
    expect(metric6).toBeDefined();
    expect(metric6!.passed).toBe(false);
    expect(metric6!.score).toBeLessThan(80);
    expect(metric6!.failureDetails).toHaveLength(3);
  });

  it('should leave not-assessed controls out of the Metric 6 denominator', () => {
    const ssp = createWellFormedSsp();
    ssp.controlImplementations[2].status = 'not_assessed';
    delete (ssp.controlImplementations[2] as any).evidenceDetails;

    const metric6 = scorecard.validate(ssp, {}, {}, undefined).metrics.find(m => m.metricId === 6)!;
    expect(metric6.passed).toBe(true);
    expect(metric6.score).toBe(100);
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

  it('should fail Metric 8 without a POA&M even when no control is Partial', () => {
    const ssp = createWellFormedSsp();

    const metric8 = scorecard.validate(ssp, {}, {}, undefined).metrics.find(m => m.metricId === 8)!;
    expect(metric8.passed).toBe(false);
    expect(metric8.failureDetails![0]).toContain('No POA&M provided');

    const stub = { items: [] } as unknown as PlanOfActionMilestones;
    expect(scorecard.validate(ssp, {}, {}, stub).metrics.find(m => m.metricId === 8)!.passed).toBe(false);
    expect(scorecard.validate(ssp, {}, {}, createPoam([])).metrics.find(m => m.metricId === 8)!.passed).toBe(true);
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
    delete (ssp.controlImplementations[1] as any).evidenceDetails;
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

    const report = scorecard.validate(ssp, tenantManifest, {}, createPoam([]));

    expect(report.metricsPassedCount).toBe(7);
    expect(report.metricsTotalCount).toBe(8);
    expect(report.overallPass).toBe(false);
  });

  // ---------- W5.1: warn-only metrics 9-13, each failing on a crafted bad SSP ----------

  const warn = (report: ReturnType<SspQualityScorecard['validate']>, id: number) => report.warnMetrics.find(m => m.metricId === id)!;

  it('warn metrics never change overallPass or the 8-metric counts', () => {
    const ssp = createWellFormedSsp();
    ssp.authorizationBoundary.zones = ['cui_storage_locations'];
    const report = scorecard.validate(ssp, createTenantManifest(), {}, createPoam([]), 85);
    expect(warn(report, 12).passed).toBe(false);
    expect(report.overallPass).toBe(true);
    expect(report.metricsPassedCount).toBe(8);
    expect(report.warnMetricsPassedCount).toBe(4);
  });

  it('Metric 9 fails a met control whose narrative hits the negation lexicon, flagged or not', () => {
    const ssp = createWellFormedSsp();
    ssp.controlImplementations[0].implementationNarrative += ' Conditional Access policies are not yet configured.';
    (ssp.controlImplementations[0] as any).consistencyFlags = [{ kind: 'narrative-negation', phrase: 'not yet configured', excerpt: 'x' }];
    ssp.controlImplementations[1].implementationNarrative += ' 0 managed devices reported.';

    const m9 = warn(scorecard.validate(ssp, {}, {}, createPoam([])), 9);
    expect(m9.passed).toBe(false);
    expect(m9.failureDetails).toEqual([
      'AC.L2-3.1.1: met but narrative says "not yet configured" (flagged)',
      'AU.L2-3.3.1: met but narrative says "0 managed devices" (UNFLAGGED)',
    ]);
  });

  it('Metric 9 ignores appended disclosures and non-met controls', () => {
    const ssp = createWellFormedSsp();
    ssp.controlImplementations[0].implementationNarrative += "\n\nPresence only: this met status rests on a live read that confirms only that 'x' was read and returned 0 objects.";
    ssp.controlImplementations[1].status = 'not_met';
    ssp.controlImplementations[1].implementationNarrative += ' MFA has not been configured.';

    expect(warn(scorecard.validate(ssp, {}, {}, createPoam([])), 9).passed).toBe(true);
  });

  it('Metric 10 fails a not-assessed control rendered Not Applicable and an off-vocabulary directive label', () => {
    const ssp = createWellFormedSsp();
    ssp.controlImplementations[0].status = 'not_assessed';
    ssp.controlImplementations[0].implementationNarrative += ' Status: Not Applicable.';
    Object.assign(ssp.controlImplementations[1], { status: 'not_assessed', sprsValue: 'N/A', directive: 'document-absence' });
    (ssp.controlImplementations[2] as any).status = 'planned';

    const m10 = warn(scorecard.validate(ssp, {}, {}, createPoam([])), 10);
    expect(m10.passed).toBe(false);
    expect(m10.score).toBe(0);
    expect(m10.failureDetails).toEqual([
      'AC.L2-3.1.1: not assessed but the narrative says Not Applicable / N/A',
      'AU.L2-3.3.1: status not_assessed would print "Not Applicable to This Environment"',
      'IA.L2-3.5.6: status "planned" is not met / partial / not_met / not_assessed',
    ]);
  });

  it('Metric 11 fails on placeholders anywhere in the SSP, by category', () => {
    const ssp = createWellFormedSsp();
    ssp.controlImplementations[0].implementationNarrative += ' Owner: {{system_owner}}. Access is managed by .';
    ssp.systemDescription = 'Hosted by [MANUAL INPUT REQUIRED].';
    (ssp as any).appendices.push({ id: 'M', documentId: 'AUTO', title: 'Glossary', summary: '**SPRS** — [Definition not resolved - see glossary]' });

    const m11 = warn(scorecard.validate(ssp, {}, {}, createPoam([])), 11);
    expect(m11.passed).toBe(false);
    expect(m11.score).toBeCloseTo(66.67, 1);
    expect(m11.failureDetails).toEqual([
      '[MANUAL INPUT REQUIRED]: 1 hit(s), e.g. systemDescription',
      'unresolved {{token}}: 1 hit(s), e.g. controlImplementations[0].implementationNarrative',
      'dangling "managed by .": 1 hit(s), e.g. controlImplementations[0].implementationNarrative',
      '[Definition not resolved: 1 hit(s), e.g. appendices[3].summary',
    ]);
  });

  it('Metric 11 does not count single-brace URL parameters or naming conventions', () => {
    const ssp = createWellFormedSsp();
    ssp.controlImplementations[0].implementationNarrative += ' Graph PATCH /users/{userId}. Alert rule convention: AR-{Severity}-{Source}.';
    expect(warn(scorecard.validate(ssp, {}, {}, createPoam([])), 11).passed).toBe(true);
  });

  it('Metric 12 fails on no zones, a snake_case zone, and a zone equal to a boundary fact key', () => {
    const ssp = createWellFormedSsp();
    (ssp.authorizationBoundary as any).zones = [];
    expect(warn(scorecard.validate(ssp, {}, {}, createPoam([])), 12).failureDetails).toEqual(['the authorization boundary lists no zones']);

    (ssp.authorizationBoundary as any).zones = ['Microsoft 365 GCC High tenant', 'tenant_separation'];
    (ssp.authorizationBoundary as any).zoneDetails = [{ name: 'cui_storage_locations', type: 'tm_assets', description: '', components: [] }];
    (ssp.authorizationBoundary as any).boundaryFacts.push({ key: 'Retention', value: 'x' });
    (ssp.authorizationBoundary as any).zones.push('Retention');
    const m12 = warn(scorecard.validate(ssp, {}, {}, createPoam([])), 12);
    expect(m12.passed).toBe(false);
    expect(m12.failureDetails).toEqual([
      'zone "tenant_separation" is named like a questionnaire key',
      'zone "Retention" is named like a questionnaire key',
      'zone "cui_storage_locations" is named like a questionnaire key',
    ]);
  });

  it('Metric 13 fails when §14 is missing', () => {
    const ssp = createWellFormedSsp();
    delete (ssp as any).poamSummary;
    expect(warn(scorecard.validate(ssp, {}, {}, createPoam([])), 13).failureDetails).toEqual(['SSP has no §14 poamSummary with items']);
  });

  it('Metric 13 fails on posture that disagrees across §14, the POA&M, the SPRS score and the statuses', () => {
    const ssp = createWellFormedSsp();
    Object.assign((ssp as any).poamSummary, {
      poamId: 'other-poam',
      totalItems: 2,
      items: [{ control_id: 'AC.L2-3.1.1', nist_ref: '3.1.1', weight: 5, deficiencyDescription: '', plannedCorrectiveAction: '', responsibleParty: '', estimatedCompletionDate: '', status: 'open' }],
      totalWeightOnPoam: 5,
      projectedScoreAfterPoam: 99,
      ledgerReconciliation: { ledgerDeficiencies: 4, deficientControls: 3, asItems: 1, asBlockers: 0, noPoam: 0, controls: [] },
    });

    const m13 = warn(scorecard.validate(ssp, {}, {}, createPoam([]), 46), 13);
    expect(m13.passed).toBe(false);
    expect(m13.failureDetails).toEqual([
      'AC.L2-3.1.1: on the POA&M (§14) but met in the SSP',
      '§14 totalItems 2 != 1 items',
      '§14 SPRS 85 + POA&M weight 5 != projected 99',
      'ledger reconciliation: 1 items + 0 blockers + 0 no_poam != 3 deficient controls',
      '§14 poamId other-poam != POA&M test-poam-001',
      '§14 SPRS 85 != assessed SPRS 46',
    ]);
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
