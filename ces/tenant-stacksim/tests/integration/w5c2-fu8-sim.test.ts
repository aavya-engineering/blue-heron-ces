// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScenario, applyScenario } from '../../src/scenarios/ScenarioEngine.js';
import { ObjectStore } from '../../src/store/ObjectStore.js';
import { Ledger } from '../../src/ledger/Ledger.js';
import { SeedEngine } from '../../src/seed/SeedEngine.js';
import { loadProfile, resolveProfilePath } from '../../src/profiles/ProfileLoader.js';
import { StackShapeGate } from '../../src/gating/StackShapeGate.js';
import { ResolverTable } from '../../src/resolvers/ResolverTable.js';

/**
 * synthetic-customer W5 cycle 2, follow-up 8 (2026-10-28): Entra's built-in
 * "Phishing-resistant MFA" authentication strength on every scenario, found
 * by Stamper's IA.L2-3.5.4.auth-strength lookup (LOG-W5c3-stamper2.md §2.3:
 * `Get-MgPolicyAuthenticationStrengthPolicy -All`, by name
 * 'CMMC-PhishingResistant' or by effect: AllowedCombinations all in
 * [fido2, windowsHelloForBusiness, x509CertificateMultiFactor]).
 */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BUILTIN_ID = '00000000-0000-0000-0000-000000000004';
const PR = ['fido2', 'windowsHelloForBusiness', 'x509CertificateMultiFactor'];

type Row = Record<string, any>;
const asList = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : v ? [v as Row] : []);

/** The registry get_command's Where-Object / Sort-Object / Select-Object -First 1, in TypeScript. */
function stamperLookup(policies: Row[]): Row | undefined {
  const combos = (p: Row): string[] => (p.allowedCombinations ?? p.AllowedCombinations ?? []).filter(Boolean);
  const hits = policies.filter((p) => p.displayName === 'CMMC-PhishingResistant' || (combos(p).length > 0 && combos(p).every((c) => PR.includes(c))));
  return [...hits].sort((a, b) => Number(a.displayName !== 'CMMC-PhishingResistant') - Number(b.displayName !== 'CMMC-PhishingResistant'))[0];
}

for (const slug of ['s1-mach', 'muster-partial']) {
  describe(`W5c2 follow-up 8: built-in phishing-resistant strength on ${slug}`, () => {
    let dir: string;
    let table: ResolverTable;
    beforeAll(async () => {
      dir = await fs.mkdtemp(path.join(os.tmpdir(), `stacksim-w5c2-fu8-${slug}-`));
      const scenario = await loadScenario(path.join(SIM_ROOT, 'scenarios', `${slug}.json`));
      await applyScenario(scenario, { profilesDir: path.join(SIM_ROOT, 'profiles'), tenantRoot: path.join(dir, 'tenant') });
      table = new ResolverTable(new ObjectStore(path.join(dir, 'tenant', 'store.json')), new StackShapeGate('m365_azure'));
    }, 60_000);
    afterAll(async () => {
      await fs.rm(dir, { recursive: true, force: true });
    });

    it("Stamper's IA.L2-3.5.4 lookup finds the built-in strength (by effect), and the v1.0 URI lists it", async () => {
      const all = asList(await table.resolveCmdlet('Get-MgPolicyAuthenticationStrengthPolicy', ['-All']));
      const found = stamperLookup(all)!;
      expect(found).toMatchObject({ id: BUILTIN_ID, displayName: 'Phishing-resistant MFA', policyType: 'builtIn' });
      expect([...found.allowedCombinations].sort()).toEqual([...PR].sort());
      // The verification regex Stamper applies to allowedCombinations (joined) holds.
      expect(found.allowedCombinations.join(',')).toMatch(/^(fido2|windowsHelloForBusiness|x509CertificateMultiFactor)(,(fido2|windowsHelloForBusiness|x509CertificateMultiFactor))*$/);
      const viaUri = ((await table.resolveUri('GET', 'https://graph.microsoft.us/v1.0/identity/conditionalAccess/authenticationStrength/policies')) as { value: Row[] }).value;
      expect(viaUri.map((p) => p.id)).toEqual(all.map((p) => p.id));
      expect(viaUri.filter((p) => p.id === BUILTIN_ID)).toHaveLength(1);
    });

    if (slug === 's1-mach') {
      it('S1-CA02 references the built-in strength by its id', async () => {
        const ca = ((await table.resolveUri('GET', '/v1.0/identity/conditionalAccess/policies')) as { value: Row[] }).value;
        const ca02 = ca.find((p) => /^S1-CA02/.test(p.displayName))!;
        expect(ca02.grantControls.authenticationStrength.id).toBe(BUILTIN_ID);
      });
    }
  });
}

describe('W5c2 follow-up 8: profile-only seeds carry it too (base seed)', () => {
  it('the m365_azure profile seed lists the built-in strength once', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-w5c2-fu8-profile-'));
    try {
      const store = new ObjectStore(path.join(dir, 'store.json'));
      await new SeedEngine(store, new Ledger(path.join(dir, 'ledger.jsonl'))).seed(await loadProfile(resolveProfilePath('m365_azure', path.join(SIM_ROOT, 'profiles'))));
      expect((await store.list('authenticationStrengthPolicies')).filter((p) => p.id === BUILTIN_ID)).toHaveLength(1);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
