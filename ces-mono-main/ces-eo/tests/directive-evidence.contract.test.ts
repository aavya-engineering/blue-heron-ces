// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Contract tests: Stamper -> EO directive evidence boundary.
 * Validates that directive metadata is correctly parsed, validated,
 * and mapped to SPRS values across all six directive types.
 */

import { isValidDirective, toExtendedDirectiveMetadata } from '../src/shared/types/directive.types';
import { DirectiveSprsCalculator } from '../src/eo/ssp/DirectiveSprsCalculator';
import { DirectivePoamGenerator } from '../src/eo/poam/DirectivePoamGenerator';
import { EligibilityChecker } from '../src/eo/submission/EligibilityChecker';
import type { ExtendedDirectiveMetadata } from '../src/shared/types/directive.types';
import type { CmmcControl } from 'ces-shared/types/controls';
import type { DirectiveControlImplementation } from '../src/shared/types/ssp.types';

// Test fixtures

function makeControl(controlId: string, nistRef?: string): CmmcControl {
  return {
    control_id: controlId,
    family: controlId.split('.')[0],
    cmmc_level: 2,
    nist_ref: nistRef || '3.1.1',
    practice: `Practice for ${controlId}`,
  };
}

function makeMetadata(overrides: Partial<ExtendedDirectiveMetadata> = {}): ExtendedDirectiveMetadata {
  return {
    control_id: 'AC.L2-3.1.1',
    directive: 'implement',
    readiness: 'met',
    platform_inherited: false,
    evidence_artifacts: ['artifact-001'],
    enforcement_verified: true,
    narrative_stub: 'Test narrative stub',
    reasoning_trace: 'Test reasoning',
    ...overrides,
  };
}

function makeControlImpl(overrides: Partial<DirectiveControlImplementation> = {}): DirectiveControlImplementation {
  return {
    control_id: 'AC.L2-3.1.1',
    nist_ref: '3.1.1',
    family: 'AC',
    practice: 'Access Control',
    status: 'not_met',
    classification: 'automated',
    weight: 5,
    implementationNarrative: '',
    technologyUsed: [],
    responsibleRole: '',
    evidenceReferences: [],
    relatedPolicies: [],
    odpValues: [],
    assessmentObjectives: [],
    ...overrides,
  };
}

// ── Test 1: Valid directive metadata parsing ──

describe('Test 1: Valid directive metadata parsing', () => {
  const directives = [
    'implement', 'validate', 'manual',
    'document-absence', 'document-prohibition', 'skip',
  ];

  for (const dir of directives) {
    it(`should parse valid directive: ${dir}`, () => {
      const raw = {
        control_id: 'AC.L2-3.1.1',
        directive: dir,
        readiness: 'met',
        platform_inherited: false,
        enforcement_verified: true,
        narrative_stub: 'test',
        reasoning_trace: 'test',
        evidence_artifacts: ['art-1'],
      };

      const result = toExtendedDirectiveMetadata(raw);
      expect(result.directive).toBe(dir);
      expect(result.control_id).toBe('AC.L2-3.1.1');
      expect(result.evidence_artifacts).toEqual(['art-1']);
    });
  }
});

// ── Test 2: Backward compatibility (missing directive) ──

describe('Test 2: Backward compatibility', () => {
  it('isValidDirective returns false for empty string', () => {
    expect(isValidDirective('')).toBe(false);
  });

  it('isValidDirective returns false for undefined-like values', () => {
    expect(isValidDirective('undefined')).toBe(false);
    expect(isValidDirective('null')).toBe(false);
  });
});

// ��─ Test 3: Invalid directive value halts ──

describe('Test 3: Invalid directive value halts', () => {
  it('should throw error with valid directives listed', () => {
    const raw = {
      control_id: 'AC.L2-3.1.1',
      directive: 'invalid-value',
      readiness: 'met',
      platform_inherited: false,
      enforcement_verified: true,
      narrative_stub: 'test',
      reasoning_trace: 'test',
      evidence_artifacts: [],
    };

    expect(() => toExtendedDirectiveMetadata(raw)).toThrow(
      /Invalid directive value 'invalid-value'/
    );
    expect(() => toExtendedDirectiveMetadata(raw)).toThrow(
      /implement, validate, manual, document-absence, document-prohibition, skip/
    );
  });
});

// ── Test 4: All six directives map to correct SPRS values ──

describe('Test 4: Six directives map to correct SPRS values', () => {
  const calc = new DirectiveSprsCalculator();
  const control = makeControl('AC.L2-3.1.1');
  const artifactMap = new Map([['artifact-001', true], ['artifact-002', true]]);

  it('implement + enforcement_verified=true -> MET', () => {
    const metadata = makeMetadata({ directive: 'implement', enforcement_verified: true });
    const result = calc.calculateSprsValue(control, metadata, artifactMap);
    expect(result).not.toBeNull();
    expect(result!.value).toBe('MET');
  });

  it('implement + enforcement_verified=false -> NOT_MET', () => {
    const metadata = makeMetadata({ directive: 'implement', enforcement_verified: false });
    const result = calc.calculateSprsValue(control, metadata, artifactMap);
    expect(result).not.toBeNull();
    expect(result!.value).toBe('NOT_MET');
  });

  it('validate + artifact present -> MET', () => {
    const metadata = makeMetadata({ directive: 'validate', evidence_artifacts: ['artifact-001'] });
    const result = calc.calculateSprsValue(control, metadata, artifactMap);
    expect(result).not.toBeNull();
    expect(result!.value).toBe('MET');
  });

  it('validate + artifact missing -> NOT_MET', () => {
    const metadata = makeMetadata({ directive: 'validate', evidence_artifacts: ['missing-artifact'] });
    const noArtifactMap = new Map<string, boolean>();
    const result = calc.calculateSprsValue(control, metadata, noArtifactMap);
    expect(result).not.toBeNull();
    expect(result!.value).toBe('NOT_MET');
  });

  it('manual + non-inherited + artifact present -> MET', () => {
    const metadata = makeMetadata({
      directive: 'manual',
      platform_inherited: false,
      evidence_artifacts: ['artifact-001'],
    });
    const result = calc.calculateSprsValue(control, metadata, artifactMap);
    expect(result).not.toBeNull();
    expect(result!.value).toBe('MET');
  });

  it('manual + platform_inherited + CRM/FedRAMP present -> MET', () => {
    const metadata = makeMetadata({
      directive: 'manual',
      platform_inherited: true,
      crm_reference: 'CRM-2026',
      fedramp_package_id: 'F1603046498',
    });
    const result = calc.calculateSprsValue(control, metadata, artifactMap);
    expect(result).not.toBeNull();
    expect(result!.value).toBe('MET');
  });

  it('document-absence -> N/A (unconditional)', () => {
    const metadata = makeMetadata({ directive: 'document-absence' });
    const result = calc.calculateSprsValue(control, metadata, artifactMap);
    expect(result).not.toBeNull();
    expect(result!.value).toBe('N/A');
  });

  it('document-prohibition + enforcement_verified + both artifacts -> MET', () => {
    const metadata = makeMetadata({
      directive: 'document-prohibition',
      enforcement_verified: true,
      evidence_artifacts: ['artifact-001', 'artifact-002'],
    });
    const result = calc.calculateSprsValue(control, metadata, artifactMap);
    expect(result).not.toBeNull();
    expect(result!.value).toBe('MET');
  });

  it('skip -> null (omit from score)', () => {
    const metadata = makeMetadata({ directive: 'skip' });
    const result = calc.calculateSprsValue(control, metadata, artifactMap);
    expect(result).toBeNull();
  });
});

// ��─ Test 5: document-prohibition without enforcement -> NOT_MET ──

describe('Test 5: document-prohibition without enforcement', () => {
  const calc = new DirectiveSprsCalculator();
  const control = makeControl('SC.L2-3.13.8');

  it('should return NOT_MET when enforcement_verified=false', () => {
    const metadata = makeMetadata({
      directive: 'document-prohibition',
      enforcement_verified: false,
      evidence_artifacts: ['artifact-001', 'artifact-002'],
    });
    const artifactMap = new Map([['artifact-001', true], ['artifact-002', true]]);
    const result = calc.calculateSprsValue(control, metadata, artifactMap);
    expect(result).not.toBeNull();
    expect(result!.value).toBe('NOT_MET');
    expect(result!.rationale).toContain('enforcement not verified');
  });
});

// ── Test 6: document-absence produces N/A (only directive that does) ──

describe('Test 6: document-absence is only N/A directive', () => {
  const calc = new DirectiveSprsCalculator();
  const control = makeControl('AC.L2-3.1.1');
  const artifactMap = new Map([['artifact-001', true]]);

  it('document-absence produces N/A', () => {
    const metadata = makeMetadata({ directive: 'document-absence' });
    const result = calc.calculateSprsValue(control, metadata, artifactMap);
    expect(result).not.toBeNull();
    expect(result!.value).toBe('N/A');
  });

  it('no other directive produces N/A when well-formed', () => {
    const otherDirectives = ['implement', 'validate', 'manual', 'document-prohibition'] as const;
    for (const dir of otherDirectives) {
      const metadata = makeMetadata({
        directive: dir,
        enforcement_verified: true,
        evidence_artifacts: ['artifact-001', 'artifact-002'],
        crm_reference: 'CRM-2026',
        fedramp_package_id: 'F1603046498',
      });
      const result = calc.calculateSprsValue(control, metadata, artifactMap);
      if (result) {
        expect(result.value).not.toBe('N/A');
      }
    }
  });
});

// ── Test 7: Full pipeline directive-specific narratives ──
// (Integration-level test, validates that directive metadata would produce specific narrative language)

describe('Test 7: Directive-specific narrative language', () => {
  // Import DirectiveNarrativeBuilder for direct testing
  const { DirectiveNarrativeBuilder } = require('../src/eo/generation/DirectiveNarrativeBuilder');

  it('document-absence narrative includes "not applicable to the assessment boundary"', () => {
    const control = makeControl('AC.L2-3.1.1');
    const metadata = makeMetadata({
      directive: 'document-absence',
      baseline_date: '2026-03-15',
    });
    const narrative = DirectiveNarrativeBuilder.buildDocumentAbsenceNarrative(control, metadata);
    expect(narrative).toContain('not applicable to the assessment boundary');
  });

  it('document-prohibition narrative includes "implemented by prohibiting"', () => {
    const control = makeControl('SC.L2-3.13.8');
    const metadata = makeMetadata({
      directive: 'document-prohibition',
      policy_reference: 'USB Policy v2.1',
      enforcement_mechanism: 'Intune Device Configuration',
      configuration_reference: 'Block-USB-MassStorage',
      verification_date: '2026-04-15',
      monitoring_mechanism: 'Microsoft Defender for Endpoint',
    });
    const narrative = DirectiveNarrativeBuilder.buildDocumentProhibitionNarrative(control, metadata);
    expect(narrative).toContain('implemented by prohibiting');
    expect(narrative).toContain('USB Policy v2.1');
    expect(narrative).toContain('Intune Device Configuration');
  });

  it('manual+platform_inherited narrative cites Microsoft CRM', () => {
    const control = makeControl('PE.L1-3.10.1');
    const metadata = makeMetadata({
      directive: 'manual',
      platform_inherited: true,
      service_line: 'Microsoft 365 GCC High',
      crm_reference: 'CRM-2026-GovCloud',
      fedramp_package_id: 'F1603046498',
    });
    const narrative = DirectiveNarrativeBuilder.buildPlatformInheritedNarrative(control, metadata);
    expect(narrative).toContain('Microsoft Customer Responsibility Matrix');
    expect(narrative).toContain('F1603046498');
  });
});

// ── Test 8: SPRS score calculation matches manual calculation ──

describe('Test 8: SPRS score calculation', () => {
  const calc = new DirectiveSprsCalculator();

  it('should calculate correct score from 10 controls', () => {
    const controls: DirectiveControlImplementation[] = [
      makeControlImpl({ control_id: 'AC.L2-3.1.1', sprsValue: 'MET', directive: 'implement' }),
      makeControlImpl({ control_id: 'AC.L2-3.1.2', sprsValue: 'MET', directive: 'implement' }),
      makeControlImpl({ control_id: 'AC.L2-3.1.3', sprsValue: 'NOT_MET', directive: 'implement', weight: 5 }),
      makeControlImpl({ control_id: 'AC.L2-3.1.4', sprsValue: 'NOT_MET', directive: 'validate', weight: 3 }),
      makeControlImpl({ control_id: 'AC.L2-3.1.5', sprsValue: 'MET', directive: 'manual' }),
      makeControlImpl({ control_id: 'AC.L2-3.1.6', sprsValue: 'N/A', directive: 'document-absence' }),
      makeControlImpl({ control_id: 'AC.L2-3.1.7', sprsValue: 'MET', directive: 'document-prohibition' }),
      makeControlImpl({ control_id: 'AC.L2-3.1.8', sprsValue: 'NOT_MET', directive: 'implement', weight: 1 }),
      makeControlImpl({ control_id: 'AC.L2-3.1.9', sprsValue: 'MET', directive: 'validate' }),
      makeControlImpl({ control_id: 'AC.L2-3.1.10', directive: 'skip' }),
    ];

    const weights = new Map<string, number>([
      ['AC.L2-3.1.3', 5],
      ['AC.L2-3.1.4', 3],
      ['AC.L2-3.1.8', 1],
    ]);

    const result = calc.calculateScore(controls, weights);

    // 110 - 5 - 3 - 1 = 101
    expect(result.score).toBe(101);
    expect(result.metCount).toBe(5);
    expect(result.notMetCount).toBe(3);
    expect(result.naCount).toBe(1);
    expect(result.skippedCount).toBe(1); // skip directive only
  });

  it('score cannot go below 0', () => {
    const controls: DirectiveControlImplementation[] = [];
    for (let i = 0; i < 120; i++) {
      controls.push(makeControlImpl({
        control_id: `AC.L2-3.1.${i}`,
        sprsValue: 'NOT_MET',
        directive: 'implement',
        weight: 5,
      }));
    }

    const weights = new Map<string, number>();
    for (const c of controls) {
      weights.set(c.control_id, 5);
    }

    const result = calc.calculateScore(controls, weights);
    expect(result.score).toBe(0);
  });
});

// ── Test 9: POA&M generated for all NOT MET controls ──

describe('Test 9: POA&M generation for NOT_MET controls', () => {
  it('should generate POA&M items for all NOT_MET controls', () => {
    const gen = new DirectivePoamGenerator();

    const controls: DirectiveControlImplementation[] = [
      makeControlImpl({
        control_id: 'CM.L2-3.4.1',
        sprsValue: 'NOT_MET',
        directive: 'implement',
        directiveMetadata: makeMetadata({ directive: 'implement', control_id: 'CM.L2-3.4.1' }),
      }),
      makeControlImpl({
        control_id: 'CM.L2-3.4.2',
        sprsValue: 'NOT_MET',
        directive: 'validate',
        directiveMetadata: makeMetadata({ directive: 'validate', control_id: 'CM.L2-3.4.2' }),
      }),
      makeControlImpl({
        control_id: 'CM.L2-3.4.3',
        sprsValue: 'MET',
        directive: 'implement',
        directiveMetadata: makeMetadata({ directive: 'implement', control_id: 'CM.L2-3.4.3' }),
      }),
    ];

    const result = gen.buildPoamList(controls);
    expect(result.total_items).toBe(2); // Only NOT_MET controls
    const allIds = [...result.blocking_items, ...result.eligible_items].map(i => i.control_id);
    expect(allIds).toContain('CM.L2-3.4.1');
    expect(allIds).toContain('CM.L2-3.4.2');
    expect(allIds).not.toContain('CM.L2-3.4.3');
  });

  it('should flag ineligible controls as blocking', () => {
    const gen = new DirectivePoamGenerator();

    const controls: DirectiveControlImplementation[] = [
      makeControlImpl({
        control_id: 'AC.L2-3.1.1', // In ineligible list
        sprsValue: 'NOT_MET',
        directive: 'implement',
        directiveMetadata: makeMetadata({ directive: 'implement', control_id: 'AC.L2-3.1.1' }),
      }),
    ];

    const result = gen.buildPoamList(controls);
    expect(result.blocking_items.length).toBe(1);
    expect(result.blocking_items[0].control_id).toBe('AC.L2-3.1.1');
    expect(result.blocking_items[0].eligibility.eligible).toBe(false);
  });
});

// ── Test 10: Submission eligibility checker flags score < 88 ──

describe('Test 10: Submission eligibility checker', () => {
  const checker = new EligibilityChecker();

  it('should flag score < 88 as not eligible', () => {
    const ssp = { controlImplementations: [] } as any;
    const report = checker.checkEligibility(ssp, 87);
    expect(report.eligible).toBe(false);
    expect(report.blockingIssues.some(i => i.includes('below conditional threshold of 88'))).toBe(true);
  });

  it('should mark score >= 88 as conditionally eligible (with warning)', () => {
    const ssp = { controlImplementations: [] } as any;
    const report = checker.checkEligibility(ssp, 88);
    expect(report.eligible).toBe(true);
    expect(report.warnings.some(w => w.includes('conditional threshold'))).toBe(true);
  });

  it('should mark score = 110 as eligible with no warnings', () => {
    const ssp = { controlImplementations: [] } as any;
    const report = checker.checkEligibility(ssp, 110);
    expect(report.eligible).toBe(true);
    expect(report.blockingIssues.length).toBe(0);
  });

  it('should flag blocking POA&M items', () => {
    const ssp = { controlImplementations: [] } as any;
    const poamList = {
      generated_at: new Date().toISOString(),
      total_items: 2,
      blocking_items: [{
        control_id: 'AC.L2-3.1.1',
        control_title: 'Access Control',
        reason_not_met: 'test',
        eligibility: { eligible: false, reason: 'Foundational requirement' },
        closure_date: '2026-10-15',
        required_artifacts: [],
        directive: 'implement' as const,
      }],
      eligible_items: [{
        control_id: 'CM.L2-3.4.1',
        control_title: 'Config Mgmt',
        reason_not_met: 'test',
        eligibility: { eligible: true },
        closure_date: '2026-10-15',
        required_artifacts: [],
        directive: 'validate' as const,
      }],
    };

    const report = checker.checkEligibility(ssp, 100, poamList);
    expect(report.eligible).toBe(false);
    expect(report.poam_summary.blocking_count).toBe(1);
    expect(report.poam_summary.eligible_count).toBe(1);
  });

  it('should generate blocked report text', () => {
    const report = checker.checkEligibility(
      { controlImplementations: [] } as any,
      70
    );
    const text = checker.generateSubmissionBlockedReport(report);
    expect(text).toContain('SUBMISSION ELIGIBILITY REPORT');
    expect(text).toContain('70/110');
    expect(text).toContain('NO');
    expect(text).toContain('REMEDIATION GUIDANCE');
  });
});
