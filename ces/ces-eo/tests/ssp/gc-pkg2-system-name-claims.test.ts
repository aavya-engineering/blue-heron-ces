// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * GC-PKG-2 (gap closure, assessor package slice 2): the SSP system name comes from the tenant identity
 * (no "Sim Tenant" placeholder, no doubled "X - X"), and a control that is not met never claims to be
 * implemented or continuously verified. Text only: no control status changes (AR5).
 * GC-PKG-1: the SSP records the snapshotId it was generated from.
 */
import { describe, test, expect, jest, beforeAll } from '@jest/globals';

jest.mock('ces-shared/blob', () => ({
  uploadEvidenceBlob: jest.fn(),
  downloadBlob: jest.fn(),
}), { virtual: true });
jest.mock('ces-shared/storage', () => ({
  getStamperPlanDataRoot: jest.fn(() => '/tmp/golden-plan-data'),
}), { virtual: true });

import { createRequire } from 'node:module';
import { buildGoldenAssessment, buildGoldenManifests } from './golden-fixtures.js';

const _require = createRequire(__filename);
const controlsRefPath = _require.resolve('ces-shared/data/cmmc-l2-controls');
const sprsWeightsPath = _require.resolve('ces-shared/data/sprs-weights');

type Mod = typeof import('../../src/eo/ssp/SspGenerator.js');
let mod: Mod;
let Resolver: typeof import('../../src/eo/ssp/SnippetDataResolver.js').SnippetDataResolver;

beforeAll(async () => {
  mod = await import('../../src/eo/ssp/SspGenerator.js');
  Resolver = (await import('../../src/eo/ssp/SnippetDataResolver.js')).SnippetDataResolver;
});

const claimHits = (text: string) => mod.IMPLEMENTATION_CLAIM_PATTERNS.filter((re) => new RegExp(re.source, 'i').test(text));

/** The golden manifests with a chosen tenant identity and (optionally) an assertion-only required state on every control. */
function manifestsWith(identity: Record<string, unknown>, assertions = false) {
  const m = buildGoldenManifests() as any;
  m.tenantManifest.tenant_identity = identity;
  if (assertions) {
    // The golden IM and MP are too thin for the snippet resolver (no control_ids / how_to_verify); the TM alone is used.
    delete m.infraManifest;
    delete m.missionPlan;
    const assessment = buildGoldenAssessment(controlsRefPath);
    m.tenantManifest.normative_controls = assessment.controls.map((c) => ({
      control_id: c.control_id,
      required_state: `Control ${c.control_id} — implemented and continuously verified`,
      verification: [],
      evidence_artifacts: [],
    }));
  }
  return m;
}

function generate(identity: Record<string, unknown>, assertions = false) {
  const generator = new mod.SspGenerator(controlsRefPath, sprsWeightsPath, assertions ? new Resolver() : undefined);
  return generator.generate({ assessment: buildGoldenAssessment(controlsRefPath), manifests: manifestsWith(identity, assertions) });
}

describe('GC-PKG-2 helpers', () => {
  test('placeholder names: empty, Sim Tenant, Tenant (any case or spacing)', () => {
    for (const n of ['', '  ', 'Sim Tenant', 'sim  tenant', 'TENANT', 'Test Tenant', 'Default Directory', undefined, null]) {
      expect(mod.isPlaceholderSystemName(n as string)).toBe(true);
    }
    for (const n of ['Hollinford Precision Machining LLC (FICTIONAL)', 'Sim Tenant Holdings', 'contoso.example.test']) {
      expect(mod.isPlaceholderSystemName(n)).toBe(false);
    }
  });

  test('doubled "X - X" collapses to X; other names are kept', () => {
    expect(mod.undoubledName('Acme Co (FICTIONAL) - Acme Co (FICTIONAL)')).toBe('Acme Co (FICTIONAL)');
    expect(mod.undoubledName('Acme Co - Plant 2')).toBe('Acme Co - Plant 2');
    expect(mod.undoubledName(' Acme ')).toBe('Acme');
  });

  test('claims are restated; negated statements are left alone', () => {
    const real = 'Required state (Tenant Manifest): Physical Access Limitation (PE.L1-3.10.1) — implemented and continuously verified.\n\nProcedure (Mission Plan step).';
    const out = mod.withoutImplementationClaims(real);
    expect(out).toBe('Required state (Tenant Manifest): Physical Access Limitation (PE.L1-3.10.1) — required; not yet shown to be in place.\n\nProcedure (Mission Plan step).');
    expect(claimHits(out)).toEqual([]);
    expect(mod.withoutImplementationClaims('MFA is implemented for all users.')).toBe('MFA is planned for all users.');
    expect(mod.withoutImplementationClaims('Logs are continuously verified.')).toBe('Logs are not yet verified.');
    for (const negated of ['MFA is not implemented.', 'MFA has not been implemented.', 'MFA is not yet implemented.', 'Never implemented.']) {
      expect(mod.withoutImplementationClaims(negated)).toBe(negated);
    }
  });
});

describe('GC-PKG-2 system name from the tenant identity', () => {
  test('a real display name is used as is', () => {
    const ssp = generate({ display_name: 'Golden Reference Defense Co.', primary_domain: 'golden.example.test' });
    expect(ssp.systemName).toBe('Golden Reference Defense Co.');
    expect(ssp.systemNameSource).toBe('tenant_manifest');
  });

  test('"Sim Tenant" yields to the tenant primary domain (still from the Tenant Manifest)', () => {
    const ssp = generate({ display_name: 'Sim Tenant', primary_domain: 'muster-partial.simtenant.example.test' });
    expect(ssp.systemName).toBe('muster-partial.simtenant.example.test');
    expect(ssp.systemNameSource).toBe('tenant_manifest');
  });

  test('a doubled display name is printed once', () => {
    const ssp = generate({ display_name: 'Acme Co (FICTIONAL) - Acme Co (FICTIONAL)' });
    expect(ssp.systemName).toBe('Acme Co (FICTIONAL)');
  });

  test('GC-PKG-1: the SSP records the snapshotId it was generated from', () => {
    const ssp = generate({ display_name: 'Golden Reference Defense Co.' }) as any;
    expect(ssp.snapshotId).toBe('snap-golden-fixture');
  });
});

describe('GC-PKG-2 non-met narratives make no implementation claim (text only)', () => {
  test('every non-met control is clean; met controls keep their text; no status changes', () => {
    const assessment = buildGoldenAssessment(controlsRefPath);
    const ssp = generate({ display_name: 'Golden Reference Defense Co.' }, true);
    const nonMet = ssp.controlImplementations.filter((c) => c.status !== 'met');
    expect(nonMet.length).toBeGreaterThan(0);
    for (const c of nonMet) expect({ id: c.control_id, hits: claimHits(c.implementationNarrative).map(String) }).toEqual({ id: c.control_id, hits: [] });
    expect(nonMet.some((c) => c.implementationNarrative.includes('— required; not yet shown to be in place.'))).toBe(true);
    const met = ssp.controlImplementations.filter((c) => c.status === 'met');
    expect(met.some((c) => c.implementationNarrative.includes('implemented and continuously verified'))).toBe(true);
    const byId = new Map(assessment.controls.map((c) => [c.control_id, c.status]));
    const changed = ssp.controlImplementations.filter((c) => byId.has(c.control_id) && c.status !== byId.get(c.control_id) && !(byId.get(c.control_id) === 'partial'));
    expect(changed.map((c) => c.control_id)).toEqual([]);
  });
});
