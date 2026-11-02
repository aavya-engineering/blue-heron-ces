// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { describe, it, expect, beforeEach } from '@jest/globals';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SharedResponsibilityMatrixGenerator, nistRefOf } from '../SharedResponsibilityMatrixGenerator.js';

/**
 * Unit tests for SharedResponsibilityMatrixGenerator (Phase 05, re-baselined for W3.4).
 *
 * W3.4 (founder decision B10): the data file now carries one authored row per control (110), keyed to the
 * ces-shared reference ids, matched by numeric reference, with `excluded_ids` for the seven SP 800-53 rows and
 * Muster's facility/equipment gates on PE/MA. Expectations that encoded the old 52-row file are amended below,
 * each with a one-line reason.
 */

const REFERENCE_PATH = path.resolve(process.cwd(), '../ces-shared/src/data/cmmc-l2-controls.reference.json');
const DATA_PATH = path.resolve(process.cwd(), 'data/fedramp-gcc-high-inheritance.json');

interface RefControl { control_id: string; nist_ref: string; practice: string; cmmc_level: number; family: string }
const reference: RefControl[] = JSON.parse(fs.readFileSync(REFERENCE_PATH, 'utf-8')).controls;
const referenceIds = reference.map(c => c.control_id);
const dataFile = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));

const ZERO_FACTS = { physicalFacilityCount: 0, customerEquipmentCount: 0 };

describe('SharedResponsibilityMatrixGenerator', () => {
  let generator: SharedResponsibilityMatrixGenerator;

  beforeEach(() => {
    generator = new SharedResponsibilityMatrixGenerator();
  });

  describe('computeControlOwnership', () => {
    it('should mark PE.L1-3.10.1 as Inherited when the facility count is 0 (full inheritance, no customer implementation)', () => {
      // W3.4: id re-keyed to the reference (PE.L1-*), facts now required for the PE gate.
      const result = generator.computeControlOwnership('PE.L1-3.10.1', 'azure-gov', false, ZERO_FACTS);

      expect(result.controlId).toBe('PE.L1-3.10.1');
      expect(result.responsibility).toBe('Inherited');
      expect(result.conditionStatus).toBe('met');
      expect(result.rationale).toContain('Fully inherited from Microsoft FedRAMP High');
    });

    it('should resolve the legacy L2 key PE.L2-3.10.1 to the same row (B4-neutral numeric match)', () => {
      const result = generator.computeControlOwnership('PE.L2-3.10.1', 'azure-gov', false, ZERO_FACTS);
      expect(result.responsibility).toBe('Inherited');
      expect(result.nistRef).toBe('3.10.1');
    });

    it('should mark AC.L1-3.1.2 as Shared (partial inheritance)', () => {
      // W3.4: AC 3.1.2 is a Level 1 practice; the row is keyed AC.L1-3.1.2 and the Placemat says Shared Coverage.
      const result = generator.computeControlOwnership('AC.L1-3.1.2', 'azure-gov', false);

      expect(result.controlId).toBe('AC.L1-3.1.2');
      expect(result.responsibility).toBe('Shared');
      expect(result.rationale).toContain('Microsoft:');
      expect(result.rationale).toContain('Customer:');
    });

    it('should mark AT.L2-3.2.1 as Shared with a data-file row (Placemat: Shared Coverage)', () => {
      // W3.4: every control now has a row; AT.L2-3.2.1 reads Shared per the Placemat, not "not inherited".
      const result = generator.computeControlOwnership('AT.L2-3.2.1', 'azure-gov', false);

      expect(result.controlId).toBe('AT.L2-3.2.1');
      expect(result.responsibility).toBe('Shared');
      expect(result.placematCoverage).toBe('Shared Coverage');
    });

    it('should mark CM.L2-3.4.8 as Customer (Placemat: Customer Responsibility)', () => {
      const result = generator.computeControlOwnership('CM.L2-3.4.8', 'azure-gov', false);
      expect(result.responsibility).toBe('Customer');
      expect(result.placematCoverage).toBe('Customer Responsibility');
    });

    it('should mark inherited control as Shared if AdminOps knowledge bank exists', () => {
      const result = generator.computeControlOwnership('PE.L1-3.10.1', 'azure-gov', true, ZERO_FACTS);

      expect(result.controlId).toBe('PE.L1-3.10.1');
      expect(result.responsibility).toBe('Shared');
      expect(result.rationale).toContain('Microsoft:');
    });

    it('should mark a control as Customer for the hybrid architecture (no row lists hybrid)', () => {
      // W3.4: rows list azure-gov and byod; the BYOD/Azure-only split of the old file had no sourced basis.
      const result = generator.computeControlOwnership('SC.L1-3.13.1', 'hybrid', false);

      expect(result.controlId).toBe('SC.L1-3.13.1');
      expect(result.responsibility).toBe('Customer');
      expect(result.rationale).toContain('but not hybrid');
    });

    it('should mark a Microsoft-covered control as Inherited for the BYOD architecture', () => {
      // W3.4: IA.L2-3.5.11 (obscured authentication feedback) is the one unconditional full-inheritance row.
      const result = generator.computeControlOwnership('IA.L2-3.5.11', 'byod', false);

      expect(result.controlId).toBe('IA.L2-3.5.11');
      expect(result.responsibility).toBe('Inherited');
      expect(result.rationale).toContain('Fully inherited');
    });

    it('should mark AU.L2-3.3.7 (time stamps) as Shared per founder decision B10', () => {
      const result = generator.computeControlOwnership('AU.L2-3.3.7', 'azure-gov', false, ZERO_FACTS);
      expect(result.responsibility).toBe('Shared');
      expect(result.requirement).toContain('synchronizes internal system clocks');
      expect(result.customerResponsibility).toMatch(/customer-deployed resources/i);
      expect(result.note).toMatch(/Muster/);
    });

    it('should treat excluded ids as Customer with the exclusion reason', () => {
      for (const ex of dataFile.excluded_ids as Array<{ id: string; reason: string }>) {
        const result = generator.computeControlOwnership(ex.id, 'azure-gov', false, ZERO_FACTS);
        expect(result.responsibility).toBe('Customer');
        expect(result.rationale).toContain('Excluded from the inheritance data');
        expect(result.requirement).toBeUndefined();
      }
    });
  });

  describe('PE/MA gating on Muster facts', () => {
    it('reads PE as Shared with "pending facts" when the counts are not recorded', () => {
      const noFacts = generator.computeControlOwnership('PE.L1-3.10.3', 'azure-gov', false);
      expect(noFacts.responsibility).toBe('Shared');
      expect(noFacts.conditionStatus).toBe('pending');
      expect(noFacts.rationale).toContain('Pending facts');

      const nullFacts = generator.computeControlOwnership('PE.L1-3.10.3', 'azure-gov', false, { physicalFacilityCount: null, customerEquipmentCount: null });
      expect(nullFacts.responsibility).toBe('Shared');
      expect(nullFacts.conditionStatus).toBe('pending');
    });

    it('reads PE as Shared when the organization reports a facility', () => {
      const result = generator.computeControlOwnership('PE.L2-3.10.2', 'azure-gov', false, { physicalFacilityCount: 2, customerEquipmentCount: 0 });
      expect(result.responsibility).toBe('Shared');
      expect(result.conditionStatus).toBe('not_met');
      expect(result.rationale).toContain('not met');
    });

    it('reads PE as Inherited only when the facility count is 0', () => {
      const result = generator.computeControlOwnership('PE.L1-3.10.4', 'azure-gov', false, { physicalFacilityCount: 0 });
      expect(result.responsibility).toBe('Inherited');
    });

    it('gates MA.L2-3.7.1/2/3/6 on the equipment count and keeps MA.L2-3.7.4/5 Shared', () => {
      for (const id of ['MA.L2-3.7.1', 'MA.L2-3.7.2', 'MA.L2-3.7.3', 'MA.L2-3.7.6']) {
        expect(generator.computeControlOwnership(id, 'azure-gov', false, { customerEquipmentCount: 0 }).responsibility).toBe('Inherited');
        expect(generator.computeControlOwnership(id, 'azure-gov', false, { customerEquipmentCount: 3 }).responsibility).toBe('Shared');
        expect(generator.computeControlOwnership(id, 'azure-gov', false).conditionStatus).toBe('pending');
      }
      for (const id of ['MA.L2-3.7.4', 'MA.L2-3.7.5']) {
        const r = generator.computeControlOwnership(id, 'azure-gov', false, ZERO_FACTS);
        expect(r.responsibility).toBe('Shared');
        expect(r.conditionStatus).toBe('none');
      }
    });

    it('extractFacts reads the Mission Plan si_key_facts and dependencies paths', () => {
      expect(SharedResponsibilityMatrixGenerator.extractFacts(undefined)).toEqual({});
      const mp = { outputs: { human_readable_mission_plan: { disposition_summary: { si_key_facts: { physical_facility_count: null, customer_equipment_count: 0 } } } } };
      expect(SharedResponsibilityMatrixGenerator.extractFacts(mp)).toEqual({ physicalFacilityCount: null, customerEquipmentCount: 0 });
      const mp2 = { inputs: { si_baseline: { si_baseline: { dependencies: { physical_facility_count: 1 } } } } };
      expect(SharedResponsibilityMatrixGenerator.extractFacts(mp2).physicalFacilityCount).toBe(1);
      expect(SharedResponsibilityMatrixGenerator.extractFacts(mp2).customerEquipmentCount).toBeUndefined();
    });
  });

  describe('generateCrmTable', () => {
    it('should resolve all 110 reference ids to data-file rows for the Azure-backed architecture', () => {
      // W3.4: was "52 inherited controls"; now every reference id has an authored row.
      const result = generator.generateCrmTable(referenceIds, 'azure-gov', new Set(), ZERO_FACTS);

      expect(result.totalControls).toBe(110);
      expect(result.controlDetails!.every(d => typeof d.requirement === 'string' && d.requirement.length > 0)).toBe(true);
      expect(result.inherited).toBe(10); // PE x5 + MA x4 (counts 0) + IA.L2-3.5.11
      expect(result.customer).toBe(1); // CM.L2-3.4.8
      expect(result.inherited + result.shared + result.customer).toBe(110);
      expect(result.fedRampReference).toContain('FedRAMP High');
      expect(result.fedRampReference).not.toMatch(/\b20\d\d-\d\d-\d\d\b.*ATO date/); // no unverified ATO date printed
      expect(result.fedRampReference).toContain('Placemat');
    });

    it('should count conditional rows as Shared (pending facts) when no facts are supplied', () => {
      const result = generator.generateCrmTable(referenceIds, 'azure-gov', new Set());
      expect(result.inherited).toBe(1); // IA.L2-3.5.11 only
      expect(result.controlDetails!.filter(d => d.conditionStatus === 'pending')).toHaveLength(9);
    });

    it('should return the same inheritance for BYOD as for Azure-backed (service-side rows apply to both)', () => {
      // W3.4: was "6 fewer for BYOD"; the old Azure-only/BYOD split had no sourced basis.
      const azureResult = generator.generateCrmTable(referenceIds, 'azure-gov', new Set(), ZERO_FACTS);
      const byodResult = generator.generateCrmTable(referenceIds, 'byod', new Set(), ZERO_FACTS);

      expect(byodResult.totalControls).toBe(110);
      expect(byodResult.inherited).toBe(azureResult.inherited);
      expect(byodResult.inherited + byodResult.shared + byodResult.customer).toBe(110);
    });

    it('should return 14-family breakdown with correct family names', () => {
      const result = generator.generateCrmTable(referenceIds, 'azure-gov', new Set());

      expect(result.byFamily).toHaveLength(14);
      const familyNames = result.byFamily.map(f => f.family);
      for (const f of ['AC', 'AT', 'AU', 'CA', 'CM', 'IA', 'IR', 'MA', 'MP', 'PE', 'PS', 'RA', 'SC', 'SI']) {
        expect(familyNames).toContain(f);
      }
    });

    it('should return per-control details array', () => {
      const result = generator.generateCrmTable(referenceIds, 'azure-gov', new Set());

      expect(result.controlDetails).toBeDefined();
      expect(result.controlDetails!.length).toBe(110);
      expect(result.controlDetails![0]).toHaveProperty('controlId');
      expect(result.controlDetails![0]).toHaveProperty('responsibility');
      expect(result.controlDetails![0]).toHaveProperty('rationale');
      expect(result.excludedIds!.map(e => e.id)).toContain('SC.L2-3.13.17');
      expect(result.musterTableNotes!.join(' ')).toContain('AU.L2-3.3.7');
    });

    it('should mark controls as Shared when AdminOps knowledge banks exist', () => {
      const adminOpsKnowledgeBanks = new Set(['PE.L1-3.10.1', 'PE.L2-3.10.2']); // Normally inherited

      const result = generator.generateCrmTable(referenceIds, 'azure-gov', adminOpsKnowledgeBanks, ZERO_FACTS);

      const pe1 = result.controlDetails!.find(c => c.controlId === 'PE.L1-3.10.1');
      const pe2 = result.controlDetails!.find(c => c.controlId === 'PE.L2-3.10.2');

      expect(pe1?.responsibility).toBe('Shared');
      expect(pe2?.responsibility).toBe('Shared');
    });

    it('should never list an excluded id in controlDetails', () => {
      const result = generator.generateCrmTable(referenceIds, 'azure-gov', new Set(), ZERO_FACTS);
      const excluded = new Set((dataFile.excluded_ids as Array<{ id: string }>).map(e => e.id));
      expect(result.controlDetails!.some(d => excluded.has(d.controlId))).toBe(false);
    });
  });

  describe('data file integrity (W3.4)', () => {
    const rows: Array<Record<string, any>> = dataFile.inherited_controls;

    it('has exactly one row per reference id, keyed exactly as ces-shared keys it', () => {
      const ids = rows.map(r => r.controlId);
      expect(ids).toHaveLength(110);
      expect(new Set(ids).size).toBe(110);
      expect([...ids].sort()).toEqual([...referenceIds].sort());
    });

    it('keeps every row requirement verbatim from the reference, by id', () => {
      const byId = new Map(reference.map(c => [c.control_id, c]));
      for (const r of rows) {
        const ref = byId.get(r.controlId)!;
        expect(ref).toBeDefined();
        expect(r.requirement).toBe(ref.practice);
        expect(r.nistRef).toBe(ref.nist_ref);
        expect(nistRefOf(r.controlId)).toBe(ref.nist_ref);
      }
    });

    it('lists the seven SP 800-53 ids in excluded_ids and nowhere else', () => {
      const excluded = (dataFile.excluded_ids as Array<{ id: string; reason: string }>).map(e => e.id);
      expect(excluded.sort()).toEqual(['SC.L2-3.13.17', 'SI.L2-3.14.10', 'SI.L2-3.14.11', 'SI.L2-3.14.12', 'SI.L2-3.14.13', 'SI.L2-3.14.14', 'SI.L2-3.14.9'].sort());
      for (const e of dataFile.excluded_ids) expect(e.reason).toMatch(/SP 800-53/);
      expect(rows.some(r => excluded.includes(r.controlId))).toBe(false);
    });

    it('carries source, sourceUrl, verified, placematCoverage and basis on every row', () => {
      for (const r of rows) {
        expect(typeof r.source).toBe('string');
        expect(r.sourceUrl).toMatch(/^https:\/\//);
        expect(r.verified).toBe(true);
        expect(['Microsoft Coverage', 'Shared Coverage', 'Customer Responsibility']).toContain(r.placematCoverage);
        expect(['full', 'partial', 'none']).toContain(r.inheritance);
        expect(r.microsoftResponsibility.length).toBeGreaterThan(20);
        expect(r.customerResponsibility.length).toBeGreaterThan(10);
        if (r.basis === 'BHD assessment') expect(r.note).toBeTruthy();
        if (r.inheritance === 'full') expect(r.placematCoverage).toBe('Microsoft Coverage');
        if (r.inheritance === 'none') expect(r.placematCoverage).toBe('Customer Responsibility');
      }
    });

    it('fixes the rows that described a different control (F2)', () => {
      const text = (id: string) => rows.find(r => r.controlId === id)!;
      // SC.L2-3.13.13 is mobile code; SC.L2-3.13.16 is CUI at rest (the old file had them swapped / wrong).
      expect(text('SC.L2-3.13.13').microsoftResponsibility + text('SC.L2-3.13.13').customerResponsibility).toMatch(/mobile code/i);
      expect(text('SC.L2-3.13.13').microsoftResponsibility).not.toMatch(/known secure state|fails? in/i);
      expect(text('SC.L2-3.13.16').microsoftResponsibility).toMatch(/at rest/i);
      expect(text('SC.L2-3.13.16').microsoftResponsibility).not.toMatch(/mobile code/i);
      // SI.L2-3.14.6 is monitoring for attacks (not spam); SI.L2-3.14.7 is unauthorized use (not input validation).
      expect(text('SI.L2-3.14.6').customerResponsibility).toMatch(/monitor/i);
      expect(text('SI.L2-3.14.6').microsoftResponsibility).not.toMatch(/spam/i);
      expect(text('SI.L2-3.14.7').customerResponsibility).toMatch(/unauthorized use/i);
      expect(text('SI.L2-3.14.7').microsoftResponsibility).not.toMatch(/validate information input/i);
      // SC.L2-3.13.5 is public-access subnetworks (not collaborative computing); SC.L2-3.13.12 is collaborative devices (not session time-out).
      expect(text('SC.L1-3.13.5').customerResponsibility).toMatch(/subnetwork/i);
      expect(text('SC.L2-3.13.12').customerResponsibility).toMatch(/collaborative computing/i);
      // AC.L2-3.1.13 is remote-session cryptography (not key management); AC.L1-3.1.20 is external systems (not CDN).
      expect(text('AC.L2-3.1.13').microsoftResponsibility).toMatch(/TLS|encrypt/i);
      expect(text('AC.L1-3.1.20').customerResponsibility).toMatch(/external systems/i);
      // MA.L2-3.7.3 is sanitizing equipment for off-site maintenance (not maintenance tools); MP.L2-3.8.9 is backup confidentiality.
      expect(text('MA.L2-3.7.3').microsoftResponsibility).toMatch(/sanitiz/i);
      expect(text('MP.L2-3.8.9').customerResponsibility).toMatch(/backup/i);
    });

    it('each row text names the control it describes (keyword per control)', () => {
      // One distinctive keyword from each reference practice must appear in the row's Microsoft or customer text.
      const keywords: Record<string, RegExp> = {
        'AC.L2-3.1.4': /separat/i, 'AC.L2-3.1.5': /least privilege/i, 'AC.L2-3.1.9': /notice/i, 'AC.L2-3.1.10': /session lock/i,
        'AC.L2-3.1.16': /wireless/i, 'AC.L2-3.1.17': /wireless/i, 'AC.L2-3.1.18': /mobile device/i, 'AC.L2-3.1.21': /portable storage/i,
        'AU.L2-3.3.7': /clock|time/i, 'AU.L2-3.3.8': /audit/i, 'CM.L2-3.4.8': /blacklist|whitelist|deny-by-exception/i,
        'IA.L2-3.5.3': /MFA|multifactor/i, 'IA.L2-3.5.11': /feedback/i, 'IR.L2-3.6.3': /test/i, 'MA.L2-3.7.5': /MFA|multifactor/i,
        'MP.L1-3.8.3': /sanitiz|destroy/i, 'PE.L1-3.10.3': /visitor/i, 'PE.L2-3.10.6': /alternate work site/i, 'PS.L2-3.9.1': /screen/i,
        'RA.L2-3.11.2': /scan/i, 'CA.L2-3.12.4': /System Security Plan|SSP/i, 'SC.L2-3.13.7': /split tunnel/i, 'SC.L2-3.13.14': /VoIP/i,
        'SI.L1-3.14.4': /updat/i,
      };
      for (const [id, re] of Object.entries(keywords)) {
        const r = rows.find(x => x.controlId === id)!;
        expect(`${r.microsoftResponsibility} ${r.customerResponsibility}`).toMatch(re);
      }
    });
  });

  describe('generateCrmNarrative', () => {
    it('should generate narrative text with percentage breakdown and no unverified ATO date', () => {
      const crm = generator.generateCrmTable(referenceIds, 'azure-gov', new Set(), ZERO_FACTS);

      const narrative = generator.generateCrmNarrative(crm);

      expect(narrative).toContain('Microsoft FedRAMP High Authorization Package');
      expect(narrative).not.toContain('2017-07-28'); // W3.4: the old ATO date was never verified; none is printed
      expect(narrative).toContain('110 CMMC Level 2 controls');
      expect(narrative).toContain('| Family | Inherited | Shared | Customer |');
      expect(narrative).toContain('Placemat');
    });
  });

  describe('detectArchitectureType', () => {
    it('should detect BYOD architecture from tenant manifest', () => {
      const tenantManifest = { byodArchitectureMetadata: { architecture_declared: 'session_controlled_byod' } };

      const result = generator.detectArchitectureType(tenantManifest, undefined);

      expect(result).toBe('byod');
    });

    it('should detect Azure-Gov architecture from infrastructure manifest', () => {
      const infraManifest = { azureGovResources: [{ type: 'vnet', name: 'vnet-gcc-high' }] };

      const result = generator.detectArchitectureType(undefined, infraManifest);

      expect(result).toBe('azure-gov');
    });

    it('should return hybrid for empty manifests', () => {
      const result = generator.detectArchitectureType(undefined, undefined);

      expect(result).toBe('hybrid');
    });

    it('should prioritize BYOD over Azure-Gov if both present', () => {
      const tenantManifest = { byodArchitectureMetadata: { architecture_declared: 'session_controlled_byod' } };
      const infraManifest = { azureGovResources: [{ type: 'vnet', name: 'vnet-gcc-high' }] };

      const result = generator.detectArchitectureType(tenantManifest, infraManifest);

      expect(result).toBe('byod');
    });
  });
});
