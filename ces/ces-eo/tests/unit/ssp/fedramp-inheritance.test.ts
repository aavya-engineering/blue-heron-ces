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
import { FedRampInheritanceGenerator } from '../../../src/eo/ssp/FedRampInheritanceGenerator';
import { SharedResponsibilityMatrixGenerator } from '../../../src/eo/ssp/SharedResponsibilityMatrixGenerator';
import { DirectiveSprsCalculator } from '../../../src/eo/ssp/DirectiveSprsCalculator';
import { DirectivePoamGenerator } from '../../../src/eo/poam/DirectivePoamGenerator';
import { NarrativeLanguageGuard } from '../../../src/eo/ssp/NarrativeLanguageGuard';
import type { ExtendedDirectiveMetadata } from '../../../src/shared/types/directive.types';
import type { DirectiveControlImplementation } from '../../../src/shared/types/ssp.types';

// ---------- helpers ----------

function makeMeta(overrides: Partial<ExtendedDirectiveMetadata> = {}): ExtendedDirectiveMetadata {
  return {
    directive: 'inherit-fedramp',
    readiness: 'met',
    evidence_artifacts: ['art-1', 'art-2'],
    platform_inherited: true,
    fedramp_package_id: 'FR-PKG-001',
    tenant_variant_confirmed: 'GCC High',
    crm_reference: 'CRM-M365-2024',
    ...overrides,
  } as ExtendedDirectiveMetadata;
}

function makeControl(
  id: string,
  meta: ExtendedDirectiveMetadata,
  sprsOverrides: Partial<DirectiveControlImplementation> = {}
): DirectiveControlImplementation {
  return {
    control_id: id,
    nist_ref: 'AC-17',
    family: 'AC',
    practice: 'Remote Access',
    status: 'met',
    classification: 'automated',
    weight: 5,
    implementationNarrative: 'Narrative for ' + id,
    technologyUsed: ['M365 GCC High'],
    responsibleRole: 'ISSO',
    evidenceReferences: ['art-1'],
    relatedPolicies: ['Policy A'],
    odpValues: [],
    assessmentObjectives: [],
    directive: 'inherit-fedramp',
    directiveMetadata: meta,
    ...sprsOverrides,
  } as DirectiveControlImplementation;
}

// ---------- FedRampInheritanceGenerator ----------

describe('FedRampInheritanceGenerator', () => {
  const generator = new FedRampInheritanceGenerator();

  it('returns null when no inherit-fedramp controls', () => {
    const controls = [makeControl('AC.L2-3.1.1', makeMeta(), { directive: 'implement' })];
    const meta = new Map([['AC.L2-3.1.1', makeMeta()]]);
    const result = generator.generateInheritanceSection(controls, meta);
    expect(result).toBeNull();
  });

  it('returns null when metadata is missing for first inherit control', () => {
    const controls = [makeControl('AC.L2-3.1.1', makeMeta())];
    const meta = new Map<string, ExtendedDirectiveMetadata>(); // empty
    const result = generator.generateInheritanceSection(controls, meta);
    expect(result).toBeNull();
  });

  it('generates section with valid inherit-fedramp controls', () => {
    const m = makeMeta();
    const controls = [
      makeControl('AC.L2-3.1.1', m),
      makeControl('AC.L2-3.1.2', m),
    ];
    const meta = new Map([
      ['AC.L2-3.1.1', m],
      ['AC.L2-3.1.2', m],
    ]);
    const result = generator.generateInheritanceSection(controls, meta);
    expect(result).not.toBeNull();
    expect(result!.parentNarrative).toBeTruthy();
    expect(result!.controlEntries).toHaveLength(2);
    expect(result!.controlEntries[0].control_id).toBe('AC.L2-3.1.1');
    expect(result!.controlEntries[1].control_id).toBe('AC.L2-3.1.2');
  });

  it('preserves classification field in control entries', () => {
    const m = makeMeta();
    const controls = [makeControl('AC.L2-3.1.1', m)];
    const meta = new Map([['AC.L2-3.1.1', m]]);
    const result = generator.generateInheritanceSection(controls, meta);
    expect(result!.controlEntries[0].classification).toBe('automated');
  });

  it('warns when multiple fedramp_package_ids detected', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    const m1 = makeMeta({ fedramp_package_id: 'FR-PKG-001' });
    const m2 = makeMeta({ fedramp_package_id: 'FR-PKG-002' });
    const controls = [
      makeControl('AC.L2-3.1.1', m1),
      makeControl('AC.L2-3.1.2', m2),
    ];
    const meta = new Map([
      ['AC.L2-3.1.1', m1],
      ['AC.L2-3.1.2', m2],
    ]);
    generator.generateInheritanceSection(controls, meta);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Multiple FedRAMP packages detected')
    );
    warnSpy.mockRestore();
  });
});

// ---------- FedRampInheritanceGenerator.buildInheritanceTable (W3.4, section 2.4) ----------

describe('FedRampInheritanceGenerator.buildInheritanceTable (W3.4)', () => {
  const referencePath = path.resolve(process.cwd(), '../ces-shared/src/data/cmmc-l2-controls.reference.json');
  const reference: Array<{ control_id: string; practice: string }> = JSON.parse(fs.readFileSync(referencePath, 'utf-8')).controls;
  const referenceIds = reference.map(c => c.control_id);
  const dataFile = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'data/fedramp-gcc-high-inheritance.json'), 'utf-8'));
  const excludedIds: string[] = dataFile.excluded_ids.map((e: { id: string }) => e.id);
  const srm = new SharedResponsibilityMatrixGenerator();

  it('returns null without a CRM', () => {
    expect(FedRampInheritanceGenerator.buildInheritanceTable(undefined)).toBeNull();
    expect(FedRampInheritanceGenerator.buildInheritanceTable({ totalControls: 0, inherited: 0, shared: 0, customer: 0, byFamily: [] })).toBeNull();
  });

  it('prints one row per control with the authored text, the Placemat value and a source footnote', () => {
    const crm = srm.generateCrmTable(referenceIds, 'azure-gov', new Set(), { physicalFacilityCount: 0, customerEquipmentCount: 0 });
    const table = FedRampInheritanceGenerator.buildInheritanceTable(crm)!;
    expect(table).not.toBeNull();
    expect(table.rows).toHaveLength(110);
    expect(table.rows.map(r => r.controlId).sort()).toEqual([...referenceIds].sort());
    for (const r of table.rows) {
      expect(r.requirement.length).toBeGreaterThan(0);
      expect(r.microsoftResponsibility.length).toBeGreaterThan(0);
      expect(r.customerResponsibility.length).toBeGreaterThan(0);
      expect(['Microsoft Coverage', 'Shared Coverage', 'Customer Responsibility']).toContain(r.placematCoverage);
      expect(r.footnote).toMatch(/^\[1\](\[2\])?$/);
      if (r.basis === 'BHD assessment') expect(r.footnote).toBe('[1][2]');
    }
    expect(table.footnotes[0].text).toMatch(/Placemat/);
    expect(table.footnotes[0].text).toMatch(/https:\/\//);
    expect(table.counts).toEqual({ inherited: 10, shared: 99, customer: 1, pending: 0 });
  });

  it('every row requirement matches the reference text by id', () => {
    const crm = srm.generateCrmTable(referenceIds, 'azure-gov', new Set());
    const table = FedRampInheritanceGenerator.buildInheritanceTable(crm)!;
    const byId = new Map(reference.map(c => [c.control_id, c.practice]));
    for (const r of table.rows) expect(r.requirement).toBe(byId.get(r.controlId));
  });

  it('never lists an excluded id and prints the exclusions and the Muster note', () => {
    const crm = srm.generateCrmTable([...referenceIds, ...excludedIds], 'azure-gov', new Set());
    const table = FedRampInheritanceGenerator.buildInheritanceTable(crm)!;
    // Excluded ids passed in resolve to Customer rows without requirement text; the table flags them, never as inherited.
    for (const id of excludedIds) {
      const row = table.rows.find(r => r.controlId === id)!;
      expect(row.responsibility).toBe('Customer');
      expect(row.requirement).toBe('');
      expect(row.placematCoverage).toBe('not in data file');
    }
    expect(table.excludedIds.map(e => e.id).sort()).toEqual([...excludedIds].sort());
    expect(table.musterNote.join(' ')).toMatch(/AU\.L2-3\.3\.7/);
    expect(table.musterNote.join(' ')).toMatch(/PE\.L1/);
  });

  it('gates PE on the facility count and prints pending facts when the count is not recorded', () => {
    const pending = FedRampInheritanceGenerator.buildInheritanceTable(srm.generateCrmTable(referenceIds, 'azure-gov', new Set()))!;
    const pe = pending.rows.find(r => r.controlId === 'PE.L1-3.10.1')!;
    expect(pe.responsibility).toBe('Shared');
    expect(pe.conditionStatus).toBe('pending');
    expect(pe.conditionText).toMatch(/Pending facts/);
    expect(pending.counts.pending).toBe(9);
    expect(pending.factsNote).toContain('physical_facility_count = not recorded');

    const met = FedRampInheritanceGenerator.buildInheritanceTable(srm.generateCrmTable(referenceIds, 'azure-gov', new Set(), { physicalFacilityCount: 0, customerEquipmentCount: 1 }))!;
    expect(met.rows.find(r => r.controlId === 'PE.L1-3.10.1')!.responsibility).toBe('Inherited');
    expect(met.rows.find(r => r.controlId === 'MA.L2-3.7.1')!.responsibility).toBe('Shared');
    expect(met.rows.find(r => r.controlId === 'MA.L2-3.7.1')!.conditionStatus).toBe('not_met');
  });

  it('records AU.L2-3.3.7 as Shared with the time-synchronisation split', () => {
    const table = FedRampInheritanceGenerator.buildInheritanceTable(srm.generateCrmTable(referenceIds, 'azure-gov', new Set()))!;
    const au7 = table.rows.find(r => r.controlId === 'AU.L2-3.3.7')!;
    expect(au7.responsibility).toBe('Shared');
    expect(au7.microsoftResponsibility).toMatch(/clock|time/i);
    expect(au7.customerResponsibility).toMatch(/customer-deployed resources/i);
    expect(au7.note).toMatch(/B10/);
  });

  it('no row text names a different control (mobile code / CUI at rest swap fixed)', () => {
    const table = FedRampInheritanceGenerator.buildInheritanceTable(srm.generateCrmTable(referenceIds, 'azure-gov', new Set()))!;
    const row = (id: string) => table.rows.find(r => r.controlId === id)!;
    expect(row('SC.L2-3.13.13').microsoftResponsibility).toMatch(/mobile code/i);
    expect(row('SC.L2-3.13.13').microsoftResponsibility).not.toMatch(/secure state/i);
    expect(row('SC.L2-3.13.16').microsoftResponsibility).toMatch(/at rest/i);
    expect(row('SC.L2-3.13.16').microsoftResponsibility).not.toMatch(/mobile code/i);
    expect(row('SI.L2-3.14.6').microsoftResponsibility).not.toMatch(/spam/i);
    expect(row('SI.L2-3.14.7').microsoftResponsibility).not.toMatch(/input/i);
  });

  it('renders markdown with the table, exclusions, Muster note and sources', () => {
    const table = FedRampInheritanceGenerator.buildInheritanceTable(srm.generateCrmTable(referenceIds, 'azure-gov', new Set()))!;
    const md = FedRampInheritanceGenerator.renderInheritanceTableMarkdown(table);
    expect(md).toContain('## 2.4 FedRAMP Inherited Controls');
    expect(md).toContain('| AU.L2-3.3.7 |');
    expect(md).toContain('SC.L2-3.13.17');
    expect(md).toContain('Muster inheritance table');
    expect(md).toContain('[1] Microsoft Product Placemat');
    expect(md.split('\n').filter(l => l.startsWith('| ')).length).toBe(111); // header + 110 rows
    const crmCheck = NarrativeLanguageGuard.validateNoGenericCrm(md);
    expect(crmCheck.valid).toBe(true);
  });
});

// ---------- DirectiveSprsCalculator — inherit-fedramp ----------

describe('DirectiveSprsCalculator inherit-fedramp', () => {
  const calc = new DirectiveSprsCalculator();
  const control = { control_id: 'PE.L1-3.10.3', nist_ref: 'PE-3', family: 'PE', practice: 'Physical Access', weight: 5 } as any;
  const emptyArtifactMap = new Map<string, boolean>();

  it('returns MET when readiness=met', () => {
    const meta = makeMeta({ readiness: 'met' });
    const result = calc.calculateSprsValue(control, meta, emptyArtifactMap);
    expect(result!.value).toBe('MET');
    expect(result!.rationale).toContain('FedRAMP inheritance verified');
    expect(result!.rationale).toContain('FR-PKG-001');
  });

  it('returns NOT_MET when readiness=not-met', () => {
    const meta = makeMeta({ readiness: 'not-met' });
    const result = calc.calculateSprsValue(control, meta, emptyArtifactMap);
    expect(result!.value).toBe('NOT_MET');
    expect(result!.rationale).toContain('requirements unsatisfied');
  });

  it('returns NOT_MET when readiness=unknown', () => {
    const meta = makeMeta({ readiness: 'unknown' });
    const result = calc.calculateSprsValue(control, meta, emptyArtifactMap);
    expect(result!.value).toBe('NOT_MET');
    expect(result!.rationale).toContain('status unknown');
  });

  it('includes tenant_variant_confirmed in MET rationale', () => {
    const meta = makeMeta({ readiness: 'met', tenant_variant_confirmed: 'GCC High' });
    const result = calc.calculateSprsValue(control, meta, emptyArtifactMap);
    expect(result!.rationale).toContain('GCC High');
  });

  it('shows [not recorded] for missing fields in MET rationale', () => {
    const meta = makeMeta({
      readiness: 'met',
      fedramp_package_id: undefined,
      tenant_variant_confirmed: undefined,
    });
    const result = calc.calculateSprsValue(control, meta, emptyArtifactMap);
    expect(result!.value).toBe('MET');
    expect(result!.rationale).toContain('[not recorded]');
  });
});

// ---------- DirectiveSprsCalculator — verifyEvidenceRequirements ----------

describe('DirectiveSprsCalculator verifyEvidenceRequirements', () => {
  const calc = new DirectiveSprsCalculator();

  it('satisfied when all fields present', () => {
    const meta = makeMeta();
    const result = calc.verifyEvidenceRequirements('inherit-fedramp', meta);
    expect(result.satisfied).toBe(true);
    expect(result.missingFields).toEqual([]);
  });

  it('reports missing fedramp_package_id', () => {
    const meta = makeMeta({ fedramp_package_id: undefined });
    const result = calc.verifyEvidenceRequirements('inherit-fedramp', meta);
    expect(result.satisfied).toBe(false);
    expect(result.missingFields).toContain('fedramp_package_id');
  });

  it('reports missing tenant_variant_confirmed', () => {
    const meta = makeMeta({ tenant_variant_confirmed: undefined });
    const result = calc.verifyEvidenceRequirements('inherit-fedramp', meta);
    expect(result.satisfied).toBe(false);
    expect(result.missingFields).toContain('tenant_variant_confirmed');
  });

  it('reports missing crm_reference', () => {
    const meta = makeMeta({ crm_reference: undefined });
    const result = calc.verifyEvidenceRequirements('inherit-fedramp', meta);
    expect(result.satisfied).toBe(false);
    expect(result.missingFields).toContain('crm_reference');
  });

  it('reports all three missing fields', () => {
    const meta = makeMeta({
      fedramp_package_id: undefined,
      tenant_variant_confirmed: undefined,
      crm_reference: undefined,
    });
    const result = calc.verifyEvidenceRequirements('inherit-fedramp', meta);
    expect(result.satisfied).toBe(false);
    expect(result.missingFields).toHaveLength(3);
  });
});

// ---------- DirectivePoamGenerator — inherit-fedramp ----------

describe('DirectivePoamGenerator inherit-fedramp', () => {
  const poamGen = new DirectivePoamGenerator();

  it('generates POA&M for NOT_MET inherit-fedramp controls', () => {
    const meta = makeMeta({ readiness: 'not-met' });
    const control = makeControl('PE.L1-3.10.3', meta, {
      sprsValue: 'NOT_MET',
      sprsRationale: 'NOT_MET: FedRAMP inheritance requirements unsatisfied. Missing fields or CRM review incomplete.',
    });
    const result = poamGen.buildPoamList([control]);
    expect(result.total_items).toBe(1);
    expect(result.blocking_items.length + result.eligible_items.length).toBe(1);
  });

  it('parses fedramp_package_id failure reason', () => {
    const meta = makeMeta({ readiness: 'not-met' });
    const control = makeControl('AC.L2-3.1.5', meta, {
      sprsValue: 'NOT_MET',
      sprsRationale: 'NOT_MET: Missing fedramp_package_id for AC.L2-3.1.5.',
    });
    const result = poamGen.buildPoamList([control]);
    const item = [...result.blocking_items, ...result.eligible_items][0];
    expect(item.reason_not_met).toContain('FedRAMP authorization package');
    expect(item.required_artifacts).toEqual(
      expect.arrayContaining(['FedRAMP authorization package document ID'])
    );
  });

  it('parses tenant_variant_confirmed failure reason', () => {
    const meta = makeMeta({ readiness: 'not-met' });
    const control = makeControl('AC.L2-3.1.5', meta, {
      sprsValue: 'NOT_MET',
      sprsRationale: 'NOT_MET: Missing tenant_variant_confirmed for AC.L2-3.1.5.',
    });
    const result = poamGen.buildPoamList([control]);
    const item = [...result.blocking_items, ...result.eligible_items][0];
    expect(item.reason_not_met).toContain('tenant variant');
  });

  it('parses crm_reference failure reason', () => {
    const meta = makeMeta({ readiness: 'not-met' });
    const control = makeControl('AC.L2-3.1.5', meta, {
      sprsValue: 'NOT_MET',
      sprsRationale: 'NOT_MET: Missing crm_reference for AC.L2-3.1.5.',
    });
    const result = poamGen.buildPoamList([control]);
    const item = [...result.blocking_items, ...result.eligible_items][0];
    expect(item.reason_not_met).toContain('Customer Responsibility Matrix');
  });

  it('falls back to generic remediation for unknown failure', () => {
    const meta = makeMeta({ readiness: 'not-met' });
    const control = makeControl('AC.L2-3.1.5', meta, {
      sprsValue: 'NOT_MET',
      sprsRationale: 'NOT_MET: some other issue.',
    });
    const result = poamGen.buildPoamList([control]);
    const item = [...result.blocking_items, ...result.eligible_items][0];
    expect(item.reason_not_met).toContain('Verify FedRAMP inheritance');
  });

  it('skips MET controls in POA&M generation', () => {
    const meta = makeMeta({ readiness: 'met' });
    const control = makeControl('PE.L1-3.10.3', meta, { sprsValue: 'MET' });
    const result = poamGen.buildPoamList([control]);
    expect(result.total_items).toBe(0);
  });
});

// ---------- NarrativeLanguageGuard — date fabrication ----------

describe('NarrativeLanguageGuard validateNoFabricatedDates', () => {
  it('returns valid when no dates present', () => {
    const result = NarrativeLanguageGuard.validateNoFabricatedDates(
      'This control is inherited from FedRAMP.',
      []
    );
    expect(result.valid).toBe(true);
  });

  it('returns valid for allowed dates', () => {
    const result = NarrativeLanguageGuard.validateNoFabricatedDates(
      'Authorized on 2026-04-21.',
      ['2026-04-21']
    );
    expect(result.valid).toBe(true);
  });

  it('detects fabricated ISO date', () => {
    const result = NarrativeLanguageGuard.validateNoFabricatedDates(
      'Package authorized 2023-06-15.',
      ['2026-04-21']
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toContain('2023-06-15');
  });

  it('detects fabricated Month DD YYYY date', () => {
    const result = NarrativeLanguageGuard.validateNoFabricatedDates(
      'Authorized on January 15, 2023.',
      ['2026-04-21']
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toContain('January 15, 2023');
  });

  it('deduplicates violations', () => {
    const result = NarrativeLanguageGuard.validateNoFabricatedDates(
      'First on 2023-06-15 and again 2023-06-15.',
      []
    );
    expect(result.violations).toHaveLength(1);
  });
});

// ---------- NarrativeLanguageGuard — generic CRM ----------

describe('NarrativeLanguageGuard validateNoGenericCrm', () => {
  it('returns valid for specific narrative', () => {
    const result = NarrativeLanguageGuard.validateNoGenericCrm(
      'This control is inherited from Microsoft 365 GCC High per CRM-M365-2024.'
    );
    expect(result.valid).toBe(true);
  });

  it('detects "customer is responsible for"', () => {
    const result = NarrativeLanguageGuard.validateNoGenericCrm(
      'The customer is responsible for configuring access policies.'
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toContain('customer is responsible for');
  });

  it('detects "refer to CRM"', () => {
    const result = NarrativeLanguageGuard.validateNoGenericCrm(
      'Please refer to CRM for details.'
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toContain('refer to CRM');
  });

  it('detects "inherited from CSP"', () => {
    const result = NarrativeLanguageGuard.validateNoGenericCrm(
      'This control is inherited from CSP.'
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toContain('inherited from CSP');
  });

  it('detects "contact your CSP"', () => {
    const result = NarrativeLanguageGuard.validateNoGenericCrm(
      'For details, contact your CSP.'
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toContain('contact your CSP');
  });

  it('detects multiple generic phrases', () => {
    const result = NarrativeLanguageGuard.validateNoGenericCrm(
      'The customer is responsible for compliance. Refer to CRM for details.'
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(2);
  });

  it('case-insensitive detection', () => {
    const result = NarrativeLanguageGuard.validateNoGenericCrm(
      'CUSTOMER IS RESPONSIBLE FOR everything.'
    );
    expect(result.valid).toBe(false);
  });
});

// ---------- DirectiveSprsCalculator.calculateScore with mixed directives ----------

describe('DirectiveSprsCalculator calculateScore with inherit-fedramp', () => {
  const calc = new DirectiveSprsCalculator();

  it('includes inherit-fedramp MET in score', () => {
    const controls: DirectiveControlImplementation[] = [
      makeControl('PE.L1-3.10.3', makeMeta({ readiness: 'met' }), { sprsValue: 'MET' }),
      makeControl('PE.L1-3.10.4', makeMeta({ readiness: 'met' }), { sprsValue: 'MET' }),
    ];
    const weights = new Map([['PE.L1-3.10.3', 5], ['PE.L1-3.10.4', 5]]);
    const result = calc.calculateScore(controls, weights);
    expect(result.metCount).toBe(2);
    expect(result.notMetCount).toBe(0);
    expect(result.score).toBe(110);
  });

  it('deducts weight for inherit-fedramp NOT_MET', () => {
    const controls: DirectiveControlImplementation[] = [
      makeControl('PE.L1-3.10.3', makeMeta({ readiness: 'not-met' }), { sprsValue: 'NOT_MET' }),
    ];
    const weights = new Map([['PE.L1-3.10.3', 5]]);
    const result = calc.calculateScore(controls, weights);
    expect(result.notMetCount).toBe(1);
    expect(result.score).toBe(105);
  });

  it('handles mixed inherit-fedramp and regular directives', () => {
    const controls: DirectiveControlImplementation[] = [
      makeControl('PE.L1-3.10.3', makeMeta({ readiness: 'met' }), { sprsValue: 'MET' }),
      makeControl('AC.L2-3.1.1', makeMeta({ directive: 'implement', readiness: 'met' } as any), {
        directive: 'implement',
        sprsValue: 'MET',
      }),
      makeControl('MP.L2-3.8.1', makeMeta({ directive: 'document-absence' } as any), {
        directive: 'document-absence',
        sprsValue: 'N/A',
      }),
    ];
    const weights = new Map([['PE.L1-3.10.3', 5], ['AC.L2-3.1.1', 5], ['MP.L2-3.8.1', 1]]);
    const result = calc.calculateScore(controls, weights);
    expect(result.metCount).toBe(2);
    expect(result.naCount).toBe(1);
    expect(result.score).toBe(110);
  });
});
