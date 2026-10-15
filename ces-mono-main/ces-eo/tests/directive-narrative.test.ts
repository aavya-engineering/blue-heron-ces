// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Narrative template tests for directive-specific SSP narratives.
 * Verifies that each directive template produces the correct language
 * and handles missing placeholders gracefully.
 */

import { DirectiveNarrativeBuilder } from '../src/eo/generation/DirectiveNarrativeBuilder';
import type { ExtendedDirectiveMetadata } from '../src/shared/types/directive.types';
import type { CmmcControl } from 'ces-shared/types/controls';

function makeControl(controlId: string): CmmcControl {
  return {
    control_id: controlId,
    family: controlId.split('.')[0],
    cmmc_level: 2,
    nist_ref: '3.1.1',
    practice: `Practice for ${controlId}`,
  };
}

function makeMetadata(overrides: Partial<ExtendedDirectiveMetadata> = {}): ExtendedDirectiveMetadata {
  return {
    control_id: 'AC.L2-3.1.1',
    directive: 'implement',
    readiness: 'met',
    platform_inherited: false,
    evidence_artifacts: [],
    enforcement_verified: false,
    narrative_stub: 'Test narrative stub',
    reasoning_trace: 'Test reasoning',
    ...overrides,
  };
}

// ── document-absence narrative tests ──

describe('document-absence narrative', () => {
  it('should include "not applicable to the assessment boundary"', () => {
    const control = makeControl('AC.L2-3.1.1');
    const metadata = makeMetadata({
      directive: 'document-absence',
      baseline_date: '2026-03-15T00:00:00Z',
      narrative_stub: 'wireless access points',
    });

    const narrative = DirectiveNarrativeBuilder.buildDocumentAbsenceNarrative(control, metadata);
    expect(narrative).toContain('not applicable to the assessment boundary');
    expect(narrative).toContain('wireless access points');
    expect(narrative).toContain('2026-03-15T00:00:00Z');
  });

  it('should handle missing baseline_date gracefully', () => {
    const control = makeControl('AC.L2-3.1.1');
    const metadata = makeMetadata({
      directive: 'document-absence',
      // baseline_date intentionally omitted
    });

    const narrative = DirectiveNarrativeBuilder.buildDocumentAbsenceNarrative(control, metadata);
    expect(narrative).toContain('not applicable to the assessment boundary');
    expect(narrative).toContain('baseline date not recorded');
  });

  it('should use practice text when narrative_stub is empty', () => {
    const control = makeControl('AC.L2-3.1.1');
    const metadata = makeMetadata({
      directive: 'document-absence',
      narrative_stub: '',
      baseline_date: '2026-01-01',
    });

    const narrative = DirectiveNarrativeBuilder.buildDocumentAbsenceNarrative(control, metadata);
    expect(narrative).toContain(control.practice);
  });
});

// ── document-prohibition narrative tests ──

describe('document-prohibition narrative', () => {
  it('should include "implemented by prohibiting" and cite policy + enforcement', () => {
    const control = makeControl('SC.L2-3.13.8');
    const metadata = makeMetadata({
      directive: 'document-prohibition',
      narrative_stub: 'removable media',
      policy_reference: 'Removable Media Policy v2.1',
      enforcement_mechanism: 'Microsoft Intune Device Configuration Profile',
      configuration_reference: 'Block-USB-MassStorage-Profile',
      verification_date: '2026-04-15T10:30:00Z',
      monitoring_mechanism: 'Microsoft Defender for Endpoint alerts',
    });

    const narrative = DirectiveNarrativeBuilder.buildDocumentProhibitionNarrative(control, metadata);
    expect(narrative).toContain('implemented by prohibiting');
    expect(narrative).toContain('removable media');
    expect(narrative).toContain('Removable Media Policy v2.1');
    expect(narrative).toContain('Microsoft Intune Device Configuration Profile');
    expect(narrative).toContain('Block-USB-MassStorage-Profile');
    expect(narrative).toContain('2026-04-15T10:30:00Z');
    expect(narrative).toContain('Microsoft Defender for Endpoint alerts');
  });

  it('should use placeholder for missing required fields', () => {
    const control = makeControl('SC.L2-3.13.8');
    const metadata = makeMetadata({
      directive: 'document-prohibition',
      // All optional fields intentionally omitted
    });

    const narrative = DirectiveNarrativeBuilder.buildDocumentProhibitionNarrative(control, metadata);
    expect(narrative).toContain('[value not recorded]');
    expect(narrative).toContain('implemented by prohibiting');
  });
});

// ── manual + platform_inherited narrative tests ──

describe('manual + platform_inherited narrative', () => {
  it('should cite Microsoft Customer Responsibility Matrix and FedRAMP package ID', () => {
    const control = makeControl('PE.L1-3.10.1');
    const metadata = makeMetadata({
      directive: 'manual',
      platform_inherited: true,
      service_line: 'Microsoft 365 GCC High',
      crm_reference: 'CRM-M365-GCCHigh-2026-v3',
      fedramp_package_id: 'F1603046498',
    });

    const narrative = DirectiveNarrativeBuilder.buildPlatformInheritedNarrative(control, metadata);
    expect(narrative).toContain('Microsoft Customer Responsibility Matrix');
    expect(narrative).toContain('CRM-M365-GCCHigh-2026-v3');
    expect(narrative).toContain('F1603046498');
    expect(narrative).toContain('Microsoft 365 GCC High');
    expect(narrative).toContain('FedRAMP Marketplace');
  });

  it('should use placeholder for missing service_line, crm_reference, fedramp_package_id', () => {
    const control = makeControl('PE.L1-3.10.1');
    const metadata = makeMetadata({
      directive: 'manual',
      platform_inherited: true,
      // All optional fields intentionally omitted
    });

    const narrative = DirectiveNarrativeBuilder.buildPlatformInheritedNarrative(control, metadata);
    expect(narrative).toContain('[value not recorded]');
    expect(narrative).toContain('FedRAMP High authorization');
  });
});

// ── Placeholder resolution tests ──

describe('placeholder resolution', () => {
  it('document-absence resolves baseline_date correctly', () => {
    const control = makeControl('AC.L2-3.1.1');
    const metadata = makeMetadata({
      directive: 'document-absence',
      baseline_date: '2026-01-15T08:00:00Z',
    });

    const narrative = DirectiveNarrativeBuilder.buildDocumentAbsenceNarrative(control, metadata);
    expect(narrative).toContain('2026-01-15T08:00:00Z');
    expect(narrative).not.toContain('baseline date not recorded');
  });

  it('document-prohibition resolves all five fields', () => {
    const control = makeControl('SC.L2-3.13.8');
    const metadata = makeMetadata({
      directive: 'document-prohibition',
      policy_reference: 'POL-001',
      enforcement_mechanism: 'Intune',
      configuration_reference: 'CFG-USB-BLOCK',
      verification_date: '2026-04-01',
      monitoring_mechanism: 'Sentinel',
    });

    const narrative = DirectiveNarrativeBuilder.buildDocumentProhibitionNarrative(control, metadata);
    expect(narrative).toContain('POL-001');
    expect(narrative).toContain('Intune');
    expect(narrative).toContain('CFG-USB-BLOCK');
    expect(narrative).toContain('2026-04-01');
    expect(narrative).toContain('Sentinel');
    expect(narrative).not.toContain('[value not recorded]');
  });

  it('platform_inherited resolves all three fields', () => {
    const control = makeControl('PE.L1-3.10.1');
    const metadata = makeMetadata({
      directive: 'manual',
      platform_inherited: true,
      service_line: 'Azure Gov',
      crm_reference: 'CRM-123',
      fedramp_package_id: 'F999',
    });

    const narrative = DirectiveNarrativeBuilder.buildPlatformInheritedNarrative(control, metadata);
    expect(narrative).toContain('Azure Gov');
    expect(narrative).toContain('CRM-123');
    expect(narrative).toContain('F999');
    expect(narrative).not.toContain('[value not recorded]');
  });
});

// ── Narrative length verification ──

describe('narrative length', () => {
  it('document-absence narrative is reasonable length (> 100 chars)', () => {
    const control = makeControl('AC.L2-3.1.1');
    const metadata = makeMetadata({
      directive: 'document-absence',
      baseline_date: '2026-01-01',
    });
    const narrative = DirectiveNarrativeBuilder.buildDocumentAbsenceNarrative(control, metadata);
    expect(narrative.length).toBeGreaterThan(100);
  });

  it('document-prohibition narrative is reasonable length (> 100 chars)', () => {
    const control = makeControl('SC.L2-3.13.8');
    const metadata = makeMetadata({
      directive: 'document-prohibition',
      policy_reference: 'Test Policy',
      enforcement_mechanism: 'Test Mechanism',
    });
    const narrative = DirectiveNarrativeBuilder.buildDocumentProhibitionNarrative(control, metadata);
    expect(narrative.length).toBeGreaterThan(100);
  });

  it('platform_inherited narrative is reasonable length (> 100 chars)', () => {
    const control = makeControl('PE.L1-3.10.1');
    const metadata = makeMetadata({
      directive: 'manual',
      platform_inherited: true,
      service_line: 'M365',
      crm_reference: 'CRM',
      fedramp_package_id: 'F123',
    });
    const narrative = DirectiveNarrativeBuilder.buildPlatformInheritedNarrative(control, metadata);
    expect(narrative.length).toBeGreaterThan(100);
  });
});
