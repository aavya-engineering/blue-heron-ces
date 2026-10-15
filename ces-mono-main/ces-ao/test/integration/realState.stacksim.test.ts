// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W4-AO1 acceptance (stacksim-backed, opt-in AO_STACKSIM_IT=1 on Windows).
//
// Runs real write ops through the PRODUCTION executor (executeAoCommand ->
// GetThenSetExecutor -> Stamper PowerShellAdapter -> powershell.exe -> stacksim
// shims -> in-process stacksim server) and reads the persisted rows back from
// the temp ces.db. Asserts, per domain that has a working write op:
//  - the persisted pre/post state are REAL snapshots (never the adapter's dry-run placeholder);
//  - pre != post and stateChanged=true where the op changes the state its read observes;
//  - pre == post and stateChanged=false where it doesn't (idempotent re-run);
//  - the stacksim store itself changed (the read is not echoing a cache);
//  - a dry run reads the real current state and sends no write (store unchanged).
//
// Tenant record: stacksim's own emitted tenant object plus two keys proposed in
// docs/requirements/REQ-tenant-stacksim-ao-source-keys.md, so B-09 and E-01 can
// bind. audit_log_retention_days is a plain value; the MAM policy ids are NOT
// seeded objects — the sim materialises a stub object on B-09's write, and that
// is the change B-09's read observes. (Binding coverage against the tenant object
// AS EMITTED is W4-AO2's test, not this one.)
//
// Domains without a state-changing write op on stacksim today (C, G) are listed
// in docs/FLOW-THROUGH-REPORT-2026-09.md (wave 4) with their REQs.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startAoStacksim, STACKSIM_IT_ENABLED, logSkipIfDisabled, type AoStacksimEnv } from './stacksimHarness.js';
import { inputsFor } from './opInputs.js';

logSkipIfDisabled('W4-AO1 realState.stacksim');

export const REQ_PROPOSED_KEYS_FOR_THIS_TEST: Record<string, string> = {
  audit_log_retention_days: '365',
  android_app_protection_policy_id: 'sim-mam-android-1',
  ios_app_protection_policy_id: 'sim-mam-ios-1',
};

const PLACEHOLDER = /\[dry-run\] PowerShell commands validated|DRY RUN: PowerShell execution skipped/;

describe.skipIf(!STACKSIM_IT_ENABLED)('W4-AO1 real before/after state against stacksim', () => {
  let env: AoStacksimEnv;
  let exec: (id: string, dryRun: boolean) => Promise<any>;
  let rows: () => any[];

  beforeAll(async () => {
    env = await startAoStacksim({ slug: 'ao-w4-realstate', extraResources: REQ_PROPOSED_KEYS_FOR_THIS_TEST });
    const { executeAoCommand } = await import('../../src/execution/CommandExecutor.js');
    const { getCommand } = await import('../../src/execution/invokeCommand.js');
    const { loadTenantConfigBySlug } = await import('../../src/tenant/aoTenants.js');
    const { getCesRepository } = await import('ces-shared/persistence/node');
    const tenant = await loadTenantConfigBySlug(env.slug);
    exec = async (id, dryRun) => {
      const cmd = getCommand(id)!;
      return executeAoCommand(cmd, tenant, inputsFor(cmd), dryRun, { requestorUPN: 'operator@ao-w4.sim', correlationId: `w4-ao1-${id}-${Date.now()}` });
    };
    rows = () => getCesRepository().listAll<any>('adminops_evidence');
  }, 180_000);

  afterAll(async () => {
    const { closeAllCesRepositories } = await import('ces-shared/persistence/node');
    closeAllCesRepositories();
    await env?.stop();
  });

  const storeSnapshot = async (collection: string): Promise<string> => JSON.stringify(await env.store.list(collection));

  function assertReal(res: any) {
    expect(res.success, `${res.error ?? ''} ${res.stderr ?? ''}`).toBe(true);
    const md = res.evidence.metadata;
    expect(md.stateReadError).toBeUndefined();
    expect(typeof md.preStateOutput).toBe('string');
    expect(md.preStateOutput).not.toMatch(PLACEHOLDER);
    if (md.postStateOutput !== undefined) expect(md.postStateOutput).not.toMatch(PLACEHOLDER);
    return md;
  }

  // Domain -> op, and whether that op changes the state its paired read observes.
  const CHANGING: Array<[string, string]> = [
    ['A', 'A-18'], // default user permissions locked down
    ['B', 'B-09'], // MAM app protection policy created
    ['D', 'D-06'], // CUI encryption transport rule created
    ['E', 'E-01'], // audit log retention configured
    ['F', 'F-08'], // drift alert moved to in-progress
    ['H', 'H-01'], // incident intake recorded
  ];

  it('dry run: pre-state is the REAL current state, and nothing is written', async () => {
    const before = await storeSnapshot('authorizationPolicy');
    const res: any = await exec('A-18', true);
    const md = assertReal(res);
    expect(md.preStateOutput).toContain('"allowedToCreateApps":true'); // the seeded, not-yet-locked-down value
    expect(md.postStateOutput).toBeUndefined();
    expect(md.setApplied).toBe(false);
    expect(await storeSnapshot('authorizationPolicy')).toBe(before);
  }, 120_000);

  it('dry run of a READ-ONLY op performs the real read (no placeholder as raw response)', async () => {
    const res: any = await exec('A-13', true);
    expect(res.success).toBe(true);
    expect(res.evidence.metadata.mode).toBe('dry_run');
    expect(res.evidence.complianceVerdict).not.toBe('SAT');
    expect(res.evidence.rawResponse).toContain('caPolicy-1'); // seeded CA policy, read for real
    expect(res.evidence.rawResponse).not.toMatch(PLACEHOLDER);
  }, 120_000);

  for (const [domain, id] of CHANGING) {
    it(`domain ${domain} (${id}): live write records pre != post and stateChanged=true`, async () => {
      const res: any = await exec(id, false);
      const md = assertReal(res);
      expect(md.setApplied).toBe(true);
      expect(typeof md.postStateOutput).toBe('string');
      expect(md.postStateOutput).not.toBe(md.preStateOutput);
      expect(md.stateChanged).toBe(true);
    }, 120_000);
  }

  for (const id of ['A-18', 'F-08']) {
    it(`${id} re-run (already in the target state): pre == post and stateChanged=false`, async () => {
      const res: any = await exec(id, false);
      const md = assertReal(res);
      expect(md.setApplied).toBe(true);
      expect(md.postStateOutput).toBe(md.preStateOutput);
      expect(md.stateChanged).toBe(false);
    }, 120_000);
  }

  it('A-18 post-state reflects the store: the lockdown is visible in stacksim itself', async () => {
    expect(await storeSnapshot('authorizationPolicy')).toContain('"allowedToCreateApps":false');
  });

  it('no persisted evidence row carries the dry-run placeholder as state', () => {
    const all = rows();
    expect(all.length).toBeGreaterThanOrEqual(CHANGING.length + 3);
    for (const r of all) {
      const text = JSON.stringify(r.data);
      expect(text, `row ${r.id}`).not.toMatch(PLACEHOLDER);
    }
    const written = all.filter((r) => r.data?.metadata?.preStateOutput !== undefined);
    expect(written.length).toBeGreaterThanOrEqual(CHANGING.length + 3);
  });
});
