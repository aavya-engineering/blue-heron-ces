// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// W7-MX1 part 2: PS.L2-3.9.2 judged on the Stamper leaver lifecycle workflow
// inventory (W7-ST), and on_not_found for optional-service reads (AU.L2-3.3.3,
// Sentinel). The registry is the sibling ces-stamper checkout (read only); the
// tenant shapes are the simulator's S1/S2 (fictional ids and names).
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  loadVerdictPredicates,
  runDiscovery,
  toGetEntries,
  type CaptureSink,
  type DiscoverySession,
  type RegistryGetEntry,
} from '../src/services/discoveryService.js';
import { lookupSourceCommand } from '../src/services/discoveryLookup.js';

const REGISTRY = path.resolve(__dirname, '..', '..', '..', 'ces-stamper', 'src', 'registry', 'cmmc-l2-commands.registry.json');
const HAVE_REGISTRY = fs.existsSync(REGISTRY);
const ENTRIES: RegistryGetEntry[] = HAVE_REGISTRY
  ? toGetEntries((JSON.parse(fs.readFileSync(REGISTRY, 'utf8')) as { entries: unknown[] }).entries)
  : [];
const capture: CaptureSink = { write: (id) => `captures/${id}.json` };
const PREDICATES = loadVerdictPredicates();
const session = (r: { stdout: string; stderr: string; exitCode: number }): DiscoverySession & { execute: ReturnType<typeof vi.fn> } => ({
  execute: vi.fn(async () => ({ ...r, durationMs: 1 })),
});

const LEAVER_ID = 'PS.L2-3.9.2.leaver-workflow';
const DISABLE_TASK = '1dfdfcc7-52fa-4c2e-bf3a-e3919cc12950';
const workflow = (id: string, category: string, scheduled: boolean) => ({
  id,
  displayName: `S1 ${category} workflow`,
  category,
  isEnabled: true,
  isSchedulingEnabled: scheduled,
  accountRemovalTask: category === 'leaver',
  tasks: category === 'leaver' ? [{ taskDefinitionId: DISABLE_TASK, displayName: 'Disable user account', isEnabled: true }] : [],
});
/** The inventory object the entry's lookup source emits (LOG-W7-ST.md). */
const inventory = (workflows: Array<ReturnType<typeof workflow>>) => {
  const q = workflows.filter((w) => w.category === 'leaver' && w.isEnabled && w.isSchedulingEnabled && w.accountRemovalTask);
  return JSON.stringify({
    displayName: 'CES lifecycle workflow inventory',
    workflowCount: workflows.length,
    qualifyingLeaverWorkflowCount: q.length,
    qualifyingLeaverWorkflowIds: q.map((w) => w.id),
    workflows,
  });
};
const S1_BEFORE_A21 = [
  workflow('51510000-001f-4000-8000-000000000001', 'joiner', true),
  workflow('51510000-001f-4000-8000-000000000002', 'mover', true),
  workflow('51510000-001f-4000-8000-000000000003', 'leaver', false),
];
const S1_AFTER_A21 = S1_BEFORE_A21.map((w) => (w.category === 'leaver' ? { ...w, isSchedulingEnabled: true } : w));

describe.skipIf(!HAVE_REGISTRY)('W7-MX1 part 2 — PS.L2-3.9.2 on the leaver lifecycle workflow inventory', () => {
  const entries = () => ENTRIES.filter((e) => e.entry_id === LEAVER_ID);
  const walk = async (r: { stdout: string; stderr: string; exitCode: number }) => {
    const s = session(r);
    const out = await runDiscovery(entries(), s, capture, { predicates: PREDICATES });
    return { ...out, command: s.execute.mock.calls[0]?.[1] as string };
  };

  it('the entry is in the registry with a block, and its row is a lookup_effect predicate', () => {
    expect(entries()).toHaveLength(1);
    expect(entries()[0].lookup).toBeDefined();
    expect(PREDICATES[LEAVER_ID].expect).toEqual({ lookup_effect: true });
    expect(PREDICATES[LEAVER_ID].on_not_found).toBeUndefined();
  });

  it('a scheduled leaver with a disable task (count 1, S1 after A-21) is met; the walk reads the block source', async () => {
    const { observations, statuses, command } = await walk({ stdout: inventory(S1_AFTER_A21), stderr: '', exitCode: 0 });
    expect(command).toBe(lookupSourceCommand(entries()[0].lookup!));
    expect(statuses[0].status).toBe('ok');
    expect(observations.map((o) => [o.control_id, o.derived_posture, o.confidence])).toEqual([['PS.L2-3.9.2', 'met', 'high']]);
  });

  it('a leaver on demand (count 0, S1/S2 before A-21) is not met', async () => {
    const { observations } = await walk({ stdout: inventory(S1_BEFORE_A21), stderr: '', exitCode: 0 });
    expect(observations[0].derived_posture).toBe('not_met');
  });

  it('no workflows at all (S3: workflowCount 0) is not met, never unknown', async () => {
    const { observations, statuses } = await walk({ stdout: inventory([]), stderr: '', exitCode: 0 });
    expect(statuses[0].status).toBe('ok');
    expect(observations[0].derived_posture).toBe('not_met');
  });

  it('a failed read is unknown (failed), and a 404 is not a "no" for this entry (no on_not_found)', async () => {
    const failed = await walk({ stdout: '', stderr: 'Invoke-MgGraphRequest: the request failed', exitCode: 1 });
    expect(failed.statuses[0].status).toBe('failed');
    expect(failed.observations[0].derived_posture).toBe('unknown');
    const notFound = await walk({ stdout: '', stderr: 'Response status code does not indicate success: 404 (Not Found).', exitCode: 1 });
    expect(notFound.statuses[0].status).toBe('failed');
    expect(notFound.observations[0].derived_posture).toBe('unknown');
  });
});

describe.skipIf(!HAVE_REGISTRY)('W7-MX1 part 2 — on_not_found: an absent optional service is an honest not met', () => {
  const SENTINEL_ID = 'AU.L2-3.3.3.sentinel-connector';
  const entries = () => ENTRIES.filter((e) => e.entry_id === SENTINEL_ID);
  const VARS = { subscriptionId: 'sub-s2', resourceGroup: 'rg-s2-enclave', lawWorkspaceName: 'law-s2' };
  // The simulator's az shim on S2 (no Sentinel): Invoke-RestMethod's 404, written to stderr, exit 1.
  const S2_404 = { stdout: '', stderr: 'az-shim error: Response status code does not indicate success: 404 (Not Found).', exitCode: 1 };
  const S1_CONNECTOR = JSON.stringify({
    id: 'office365',
    name: 'office365',
    kind: 'Office365',
    properties: { dataTypes: { exchange: { state: 'enabled' }, sharePoint: { state: 'enabled' }, teams: { state: 'enabled' } } },
  });
  const walk = async (r: { stdout: string; stderr: string; exitCode: number }, variables: Record<string, string> = VARS, predicates = PREDICATES) => {
    const s = session(r);
    const out = await runDiscovery(entries(), s, capture, { predicates, variables });
    return { ...out, command: s.execute.mock.calls[0]?.[1] as string };
  };

  it('the Sentinel row declares on_not_found not_met', () => {
    expect(entries()).toHaveLength(1);
    expect(PREDICATES[SENTINEL_ID].on_not_found).toBe('not_met');
  });

  it('S2: a 404 on the resolved connector URL is not_found, judged not met with confidence high; not counted as failed', async () => {
    const { observations, statuses, stats, command } = await walk(S2_404);
    expect(command).toContain('/workspaces/law-s2/');
    expect(statuses[0].status).toBe('not_found');
    expect(stats.not_found).toBe(1);
    expect(stats.failed).toBe(0);
    expect(observations.map((o) => [o.control_id, o.derived_posture, o.confidence])).toEqual([['AU.L2-3.3.3', 'not_met', 'high']]);
    expect(observations[0].raw_capture_ref).toBeUndefined();
  });

  it('real Azure CLI not-found wording (ResourceNotFound) is also not_found', async () => {
    const { statuses, observations } = await walk({ stdout: '', stderr: "ERROR: (ResourceNotFound) The Resource 'office365' was not found.", exitCode: 1 });
    expect(statuses[0].status).toBe('not_found');
    expect(observations[0].derived_posture).toBe('not_met');
  });

  it('S1: the connector read still answers met', async () => {
    const { observations, statuses } = await walk({ stdout: S1_CONNECTOR, stderr: '', exitCode: 0 });
    expect(statuses[0].status).toBe('ok');
    expect(observations[0].derived_posture).toBe('met');
  });

  it('a 404 with a workspace variable unresolved stays failed (unknown): the placeholder URL proves nothing', async () => {
    const { observations, statuses, command } = await walk(S2_404, { subscriptionId: 'sub-s2', resourceGroup: 'rg-s2-enclave' });
    expect(command).toContain('{lawWorkspaceName}');
    expect(statuses[0].status).toBe('failed');
    expect(observations[0].derived_posture).toBe('unknown');
  });

  it('a 400, or an auth failure that mentions 404, is never not_found', async () => {
    const bad = await walk({ stdout: '', stderr: 'az-shim error: Response status code does not indicate success: 400 (Bad Request).', exitCode: 1 });
    expect(bad.statuses[0].status).toBe('failed');
    expect(bad.observations[0].derived_posture).toBe('unknown');
    const auth = await walk({ stdout: '', stderr: 'AuthorizationFailed: access denied (404 masked)', exitCode: 1 });
    expect(auth.statuses[0].status).not.toBe('not_found');
    expect(auth.observations[0].derived_posture).toBe('unknown');
    const noCli = await walk({ stdout: '', stderr: 'az: command not found', exitCode: 127 });
    expect(noCli.statuses[0].status).toBe('failed');
    expect(noCli.observations[0].derived_posture).toBe('unknown');
  });

  it('without on_not_found (the part-1 row), the same 404 stays failed (unknown)', async () => {
    const { on_not_found: _drop, ...rest } = PREDICATES[SENTINEL_ID];
    void _drop;
    const { observations, statuses } = await walk(S2_404, VARS, { ...PREDICATES, [SENTINEL_ID]: rest });
    expect(statuses[0].status).toBe('failed');
    expect(observations[0].derived_posture).toBe('unknown');
  });
});
