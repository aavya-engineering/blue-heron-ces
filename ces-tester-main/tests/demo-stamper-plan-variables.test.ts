// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  PLAN_VARIABLE_MANIFEST_NAMES,
  PLAN_VARIABLE_RUNTIME_NAMES,
  PLAN_VARIABLE_SEED_NAMES,
  TOU_NOTICE_TEXT,
  buildPlanVariableSeed,
  mergePlanVariables,
  seedPlanVariables,
  tenantVariablesPath,
  type FetchLike,
  type HttpResponseLike,
} from '../src/demo/stamper-plan-variables.js';

/**
 * GP-DEMO-3 M4 — the seed fixture and its merge semantics.
 *
 * The name list started as the one M2 measured from the live GUI execute
 * (`docs/context/M2-ENTRY-FINDINGS.md`): 18 unresolved manifest variables plus
 * the 2 runtime names with no producer capture anywhere in the plan.
 *
 * **GP-DEMO-3 M7 extended it from the FIRST post-seed live execute** (run
 * `m7-run1b`, 91/110): two more manifest names the plan needs and nothing
 * supplies (`keyVaultName`, `mgmtSubnetCidr`), and two runtime names whose
 * producers are structurally skipped — `operator-discover` is evidence-only and
 * `group-create`'s SET is skipped on an already-seeded tenant, so neither
 * capture ever runs (REQ-STAMPER-SUBCOMMAND-CAPTURES-NOT-RUN).
 */
const M2_MISSING_MANIFEST_NAMES = [
  'approverUPN',
  'roleDefId',
  'operatorUPN',
  'breakGlassUPN',
  'subscriptionId',
  'resourceGroup',
  'location',
  'vmName',
  'vnetName',
  'vnetCidr',
  'storageAccountName',
  'lawWorkspaceName',
  'securityEmail',
  'cisoEmail',
  'cuiGroupName',
  'approvedIpRange',
  'touFileName',
  'touFileBase64',
];

/** The manifest names M7 measured on top of M2's 18, in two live layers:
 * `m7-run1b` surfaced the first two, and `m7-run2` reached the next three only
 * once those resolved. */
const M7_ADDITIONAL_MANIFEST_NAMES = [
  'keyVaultName',
  'mgmtSubnetCidr',
  'workloadSubnetCidr',
  'vmImage',
  'vmSize',
  // Enumerated from the two Stamper registries (required, produced by no
  // capture, interpolated by this plan) rather than discovered a layer per run.
  'appId',
  'tenantId',
  'tenantName',
  'primaryDomain',
  'eoAppDisplayName',
  'automationAccountName',
  'firewallName',
  'publicIpName',
  'cmkKeyName',
  'bastionSubnetCidr',
  'firewallSubnetCidr',
  'globalAdminRoleDefId',
  'privilegedRoleAdminDefId',
  'securityAdminRoleDefId',
  'complianceRoleId',
];

/** In the same registry gap, but NOT referenced by this plan — and a demo seed
 * has no business inventing a credential. */
const DELIBERATELY_UNSEEDED_REGISTRY_NAMES = ['adminUserName', 'initialPassword', 'wifiSsid'];

function jsonResponse(body: unknown, ok = true, status = 200): HttpResponseLike {
  return { ok, status, json: async () => body };
}

describe('plan-variable seed fixture', () => {
  it('covers the 18 manifest names M2 measured plus the 20 M7 enumerated', () => {
    expect([...PLAN_VARIABLE_MANIFEST_NAMES].sort()).toEqual(
      [...M2_MISSING_MANIFEST_NAMES, ...M7_ADDITIONAL_MANIFEST_NAMES].sort(),
    );
  });

  it('seeds only runtime names whose capture provably cannot run', () => {
    expect([...PLAN_VARIABLE_RUNTIME_NAMES].sort()).toEqual([
      'baselineTemplateId',
      'breakGlassUserId',
      'cuiGroupId',
      'operatorUserId',
    ]);
  });

  // The honesty line: these two objects are CREATED at runtime by the plan, so a
  // seeded id could name an object that does not exist. Their consuming controls
  // are pinned as known-false FAILs instead (REQ-STAMPER-SUBCOMMAND-CAPTURES-NOT-RUN).
  it('never seeds a credential or a name this plan does not use', () => {
    for (const name of DELIBERATELY_UNSEEDED_REGISTRY_NAMES) {
      expect(PLAN_VARIABLE_SEED_NAMES).not.toContain(name);
    }
  });

  it('reports the tenant identity the sim itself reports, not an invented one', () => {
    const seed = buildPlanVariableSeed({ slug: 'demo-dib-small' });
    expect(seed.appId).toBe('sim-app-demo-dib-small');
    expect(seed.tenantId).toBe('sim-tenant-demo-dib-small');
    expect(seed.primaryDomain).toBe('ridgelinefab.onmicrosoft.us');
  });

  it('never seeds an id for an object the plan creates at runtime', () => {
    for (const runtimeCreated of ['namedLocationId', 'phishingResistantStrengthId', 'eoSpObjectId']) {
      expect(PLAN_VARIABLE_SEED_NAMES).not.toContain(runtimeCreated);
    }
  });

  // Both values are READ from the sim's own seed data, never invented.
  it('grounds the two M7 runtime ids in the sim seed', () => {
    const seed = buildPlanVariableSeed({ slug: 'demo-dib-small' });
    expect(seed.operatorUserId).toBe('user-12'); // scenario: /v1.0/users/user-12 = Ray Dominguez
    expect(seed.cuiGroupId).toBe('group-1'); // generateGroups: first group = CUI-Authorized-Users
    expect(seed.operatorUPN).toContain('ray.dominguez');
    expect(seed.cuiGroupName).toBe('CUI-Authorized-Users');
  });

  it('builds a value for all 42 names, non-empty, no leftover placeholder braces', () => {
    const seed = buildPlanVariableSeed({ slug: 'demo-dib-small' });
    expect(Object.keys(seed)).toHaveLength(42);
    for (const name of PLAN_VARIABLE_SEED_NAMES) {
      expect(seed[name], name).toBeTruthy();
      expect(seed[name]).not.toMatch(/[{}]/);
    }
  });

  it('derives the Azure names from the slug, sim-convention style', () => {
    const seed = buildPlanVariableSeed({ slug: 'eval-decoys' });
    expect(seed.subscriptionId).toBe('sim-sub-eval-decoys');
    expect(seed.resourceGroup).toBe('sim-rg-eval-decoys');
    expect(seed.location).toBe('usgovvirginia');
  });

  it('points every UPN/mail at the seeded scenario domain', () => {
    const seed = buildPlanVariableSeed({ slug: 'demo-dib-small' });
    for (const name of ['approverUPN', 'operatorUPN', 'breakGlassUPN', 'securityEmail', 'cisoEmail']) {
      expect(seed[name]).toMatch(/^[a-z.]+@ridgelinefab\.onmicrosoft\.us$/);
    }
    // Operator and break-glass must be different accounts — the stale-account
    // review command filters on both at once.
    expect(seed.operatorUPN).not.toBe(seed.breakGlassUPN);
  });

  it('honours a custom domain and explicit overrides', () => {
    const seed = buildPlanVariableSeed({
      slug: 's',
      userDomain: 'contoso.onmicrosoft.us',
      overrides: { cuiGroupName: 'Other-Group' },
    });
    expect(seed.approverUPN).toBe('dana.okafor@contoso.onmicrosoft.us');
    expect(seed.cuiGroupName).toBe('Other-Group');
  });

  it('encodes touFileBase64 as real base64 of the notice text', () => {
    const seed = buildPlanVariableSeed({ slug: 'demo-dib-small' });
    expect(Buffer.from(seed.touFileBase64, 'base64').toString('utf8')).toBe(TOU_NOTICE_TEXT);
  });

  it('names the CUI group the sim generator actually seeds', () => {
    expect(buildPlanVariableSeed({ slug: 'x' }).cuiGroupName).toBe('CUI-Authorized-Users');
  });
});

describe('mergePlanVariables', () => {
  it('fills only missing names and never overwrites an existing value', () => {
    const { merged, added, kept } = mergePlanVariables(
      { approverUPN: 'operator.authored@x.us', other: 1 },
      { approverUPN: 'seed@x.us', cisoEmail: 'ciso@x.us' },
    );
    expect(merged.approverUPN).toBe('operator.authored@x.us');
    expect(merged.cisoEmail).toBe('ciso@x.us');
    expect(merged.other).toBe(1);
    expect(added).toEqual(['cisoEmail']);
    expect(kept).toEqual(['approverUPN']);
  });

  it('treats an empty-string store value as missing', () => {
    const { merged, added } = mergePlanVariables({ vmName: '' }, { vmName: 'sim-vm-1' });
    expect(merged.vmName).toBe('sim-vm-1');
    expect(added).toEqual(['vmName']);
  });

  it('preserves every pre-existing key (the 168-key mirror must not shrink)', () => {
    const existing = Object.fromEntries(Array.from({ length: 168 }, (_, i) => [`k${i}`, i]));
    const { merged } = mergePlanVariables(existing, buildPlanVariableSeed({ slug: 's' }));
    expect(Object.keys(merged)).toHaveLength(168 + 42);
  });
});

describe('seedPlanVariables — API route', () => {
  it('GETs, merges, then PUTs the {variables} envelope', async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    const fake: FetchLike = async (url, init) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : undefined });
      if (!init || init.method === undefined) return jsonResponse({ ok: true, variables: { existing: 'keep' } });
      return jsonResponse({ ok: true });
    };

    const result = await seedPlanVariables({
      slug: 'demo-dib-small',
      seed: buildPlanVariableSeed({ slug: 'demo-dib-small' }),
      baseUrl: 'http://127.0.0.1:3000/',
      fetchImpl: fake,
    });

    expect(calls.map((c) => c.method)).toEqual(['GET', 'PUT']);
    expect(calls[0].url).toBe('http://127.0.0.1:3000/api/tenants/demo-dib-small/variables');
    const put = calls[1].body as { variables: Record<string, unknown> };
    expect(put.variables.existing).toBe('keep');
    expect(put.variables.approverUPN).toBe('dana.okafor@ridgelinefab.onmicrosoft.us');
    expect(result.route).toBe('api');
    expect(result.added).toHaveLength(42);
    expect(result.total).toBe(43);
  });

  it('falls back to the file route (recording the API error) when the API fails', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-vars-'));
    const varsPath = path.join(dir, 'Stamper', 'plan-data', 'demo-dib-small', 'variables.json');
    const failing: FetchLike = async () => jsonResponse({ ok: false }, false, 500);

    const result = await seedPlanVariables({
      slug: 'demo-dib-small',
      seed: { approverUPN: 'a@b.us' },
      baseUrl: 'http://127.0.0.1:3000',
      variablesPath: varsPath,
      fetchImpl: failing,
    });

    expect(result.route).toBe('file');
    expect(result.apiError).toContain('500');
    expect(JSON.parse(fs.readFileSync(varsPath, 'utf8'))).toEqual({ approverUPN: 'a@b.us' });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('throws when the API fails and no file fallback was configured', async () => {
    const failing: FetchLike = async () => jsonResponse({}, false, 404);
    await expect(
      seedPlanVariables({ slug: 's', seed: {}, baseUrl: 'http://127.0.0.1:3000', fetchImpl: failing }),
    ).rejects.toThrow(/404/);
  });
});

describe('seedPlanVariables — file route', () => {
  it('merges into an existing store without losing keys', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-vars-'));
    const varsPath = path.join(dir, 'variables.json');
    fs.writeFileSync(varsPath, JSON.stringify({ approverUPN: 'kept@x.us', unrelated: 'v' }), 'utf8');

    return seedPlanVariables({
      slug: 'demo-dib-small',
      seed: buildPlanVariableSeed({ slug: 'demo-dib-small' }),
      variablesPath: varsPath,
    }).then((result) => {
      const written = JSON.parse(fs.readFileSync(varsPath, 'utf8')) as Record<string, unknown>;
      expect(written.approverUPN).toBe('kept@x.us');
      expect(written.unrelated).toBe('v');
      expect(written.baselineTemplateId).toBe('sim-baseline-template-1');
      expect(result.kept).toEqual(['approverUPN']);
      expect(result.route).toBe('file');
      fs.rmSync(dir, { recursive: true, force: true });
    });
  });

  it('creates the file (and its directories) when the store does not exist yet', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-vars-'));
    const varsPath = tenantVariablesPath(dir, 'demo-dib-small');
    await seedPlanVariables({ slug: 'demo-dib-small', seed: { vmName: 'sim-vm-1' }, variablesPath: varsPath });
    expect(JSON.parse(fs.readFileSync(varsPath, 'utf8'))).toEqual({ vmName: 'sim-vm-1' });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('tenantVariablesPath follows Stamper plan-data layout', () => {
    expect(tenantVariablesPath(path.join('C:', 'run', 'pipeline'), 'demo-dib-small')).toBe(
      path.join('C:', 'run', 'pipeline', 'Stamper', 'plan-data', 'demo-dib-small', 'variables.json'),
    );
  });

  it('rejects a call with neither route configured', async () => {
    await expect(seedPlanVariables({ slug: 's', seed: {} })).rejects.toThrow(/baseUrl or a variablesPath/);
  });
});
