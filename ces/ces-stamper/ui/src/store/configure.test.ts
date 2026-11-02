// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { baselineEnabled, baselineStreamUrl, fileMeta, pathHint, useConfigureStore } from './configure';
import { currentRunLog, useTenantStore } from './tenant';
import { useWorkflowStore } from './workflow';
import { useTranslateStore } from './translate';
import { useExecuteStore } from './execute';
import { changeTenant } from '../screens/tenant/flow';
import { TENANT_CONFIG, consoleMessages, flush, installHarness, on, resetStores, statusBar } from '../screens/tenant/testUtils';
import type { Harness } from '../screens/tenant/testUtils';

let h: Harness;

const FILES = [
  { name: 'manual-mission-plan-ridgeline-2.json', path: 'C:\\plan-data\\ridgeline\\plans\\manual-mission-plan-ridgeline-2.json', size: 20480, modified: '2026-10-28T10:00:00.000Z' },
  { name: 'manual-mission-plan-ridgeline-1.json', path: 'C:\\plan-data\\ridgeline\\plans\\manual-mission-plan-ridgeline-1.json', size: 1024, modified: '2026-10-20T10:00:00.000Z' },
];

const routes = [
  on('GET', '/api/tenants/ridgeline', { ok: true, config: TENANT_CONFIG }),
  on('PUT', '/api/tenants/ridgeline', { ok: true }),
  on('GET', '/api/last-translate', {
    ok: true,
    paths: {
      missionPlan: 'C:\\plan-data\\ridgeline\\plans\\manual-mission-plan-ridgeline-2.json',
      manifest: 'C:\\plan-data\\ridgeline\\plans\\tenant-manifest-ridgeline.json',
      output: 'C:\\plan-data\\ridgeline\\plans\\executable-plan-ridgeline.json',
    },
  }),
  on('GET', '/api/validate-file', { ok: true, exists: true }),
  on('GET', '/api/browse', { ok: true, dir: 'C:\\plan-data\\ridgeline\\plans', files: FILES }),
  on('DELETE', '/api/browse-cleanup', { ok: true, deleted: 1, kept: FILES[0]!.name }),
];

beforeEach(async () => {
  resetStores();
  h = installHarness(routes);
  await changeTenant('ridgeline');
  h.calls.length = 0;
});
afterEach(() => {
  h.restore();
  vi.restoreAllMocks();
});

describe('path hints and helpers', () => {
  it('shows the file name of a path, like updatePathHint', () => {
    expect(pathHint('C:\\plan-data\\a\\plans\\tenant-manifest-a.json')).toBe('tenant-manifest-a.json');
    expect(pathHint('plan-data/x.json')).toBe('x.json');
    expect(pathHint('')).toBe('');
    expect(fileMeta(FILES[0]!)).toBe('20.0 KB · 2026-10-28');
    expect(baselineEnabled('connected', 'ridgeline', false)).toBe(true);
    expect(baselineEnabled('connected', 'dev', false)).toBe(false);
    expect(baselineEnabled('error', 'ridgeline', false)).toBe(false);
    expect(baselineEnabled('connected', 'ridgeline', true)).toBe(false);
  });
});

describe('tenant paths (PC-04)', () => {
  it('fills the paths from last-translate and unlocks Execute when the EP exists', () => {
    // W8-SPAW: one owner for the plan paths, the translate store that cards 3 and 4 read.
    const s = useTranslateStore.getState();
    expect(s.missionPlan).toMatch(/manual-mission-plan-ridgeline-2\.json$/);
    expect(s.manifest).toMatch(/tenant-manifest-ridgeline\.json$/);
    expect(s.outputPath).toMatch(/executable-plan-ridgeline\.json$/);
    expect(useWorkflowStore.getState().steps.execute).toBe('ready');
    // The execute store's EP check ran (badge and EP display follow), with one validate-file.
    expect(useExecuteStore.getState().epDisplay).toEqual({ text: 'executable-plan-ridgeline.json', title: s.outputPath });
    expect(useExecuteStore.getState().badge).toEqual({ text: 'Pending', cls: 'status-default' });
  });

  it('typing a path GETs the tenant config and PUTs it back with last_session.translate_paths', async () => {
    useConfigureStore.getState().setPath('infraManifest', 'C:\\plan-data\\ridgeline\\plans\\infrastructure-manifest-ridgeline.json');
    await flush();
    await flush();
    expect(h.calls.map((c) => `${c.method} ${c.url}`)).toEqual(['GET /api/tenants/ridgeline', 'PUT /api/tenants/ridgeline']);
    const put = h.calls[1]!.body as { json: string };
    expect(Object.keys(put)).toEqual(['json']);
    const cfg = JSON.parse(put.json);
    expect(cfg.last_session.translate_paths.infraManifest).toBe('C:\\plan-data\\ridgeline\\plans\\infrastructure-manifest-ridgeline.json');
    expect(cfg.auth.app_id).toBe(TENANT_CONFIG.auth.app_id);
  });

  it('dev mode does not persist paths', async () => {
    await changeTenant('dev');
    h.calls.length = 0;
    useConfigureStore.getState().setPath('missionPlan', 'plan-data/dev/x.json');
    await flush();
    expect(h.calls).toEqual([]);
  });
});

describe('file picker and cleanup', () => {
  it('browses with tenant and pattern, lists files and picks one', async () => {
    await useConfigureStore.getState().openFilePicker('missionPlan');
    expect(h.calls[0]!.url).toBe('/api/browse?tenant=ridgeline&pattern=manual-mission-plan');
    let s = useConfigureStore.getState();
    expect(s.picker.open).toBe(true);
    expect(s.picker.title).toBe('Select Mission Plan');
    expect(s.picker.dir).toBe('C:\\plan-data\\ridgeline\\plans');
    expect(s.picker.files).toHaveLength(2);
    useConfigureStore.getState().pickFile(FILES[1]!.path);
    s = useConfigureStore.getState();
    expect(s.picker.open).toBe(false);
    expect(useTranslateStore.getState().missionPlan).toBe(FILES[1]!.path);
    expect(window.localStorage.getItem('stamper_configMissionPlanPath')).toBe(FILES[1]!.path);
    await flush();
    await flush();
    expect(h.calls.map((c) => `${c.method} ${c.url.split('?')[0]}`)).toEqual(['GET /api/browse', 'GET /api/tenants/ridgeline', 'PUT /api/tenants/ridgeline']);
  });

  it('shows the server error from a 404 browse', async () => {
    h.restore();
    h = installHarness([on('GET', '/api/browse', { ok: false, error: 'No plan directories found' }, 404)]);
    await useConfigureStore.getState().openFilePicker('manifest');
    expect(useConfigureStore.getState().picker.error).toBe('No plan directories found');
  });

  it('cleanup previews, confirms, then DELETEs; cancelling sends nothing', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await useConfigureStore.getState().deleteOldFiles('mp');
    expect(confirmSpy).toHaveBeenCalledWith('Delete all but most recent Mission Plans?\n\nThis will permanently remove 1 file.');
    expect(h.calls.map((c) => c.method)).toEqual(['GET']);
    confirmSpy.mockReturnValue(true);
    await useConfigureStore.getState().deleteOldFiles('mp');
    expect(h.calls.at(-1)).toMatchObject({ method: 'DELETE', url: '/api/browse-cleanup?tenant=ridgeline&pattern=manual-mission-plan' });
    expect(useConfigureStore.getState().toast?.message).toBe(`Deleted 1 old file, kept: ${FILES[0]!.name}`);
  });
});

describe('launchers and scan variables', () => {
  it('opens the SPA variables and registry windows with the legacy names', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    useConfigureStore.getState().launchVariables();
    useConfigureStore.getState().launchRegistry();
    expect(open.mock.calls).toEqual([
      ['/app/variables?tenant=ridgeline', 'unifiedVariables', 'width=850,height=750,resizable=yes,scrollbars=yes'],
      ['/app/registry?tenant=ridgeline&type=m365', 'registryEditor', 'width=950,height=750,resizable=yes,scrollbars=yes'],
    ]);
  });

  it('scan variables posts { tenant } and lists the missing ones', async () => {
    h.restore();
    h = installHarness([
      on('POST', '/api/validate-variables', {
        ok: true,
        missingCount: 1,
        missing: [{ variable: 'kvName', resolvable: true, controlCount: 2, entryCount: 3, controlIds: ['SC.L2-3.13.11', 'SC.L2-3.13.16'] }],
      }),
    ]);
    await useConfigureStore.getState().scanVariables();
    expect(h.calls[0]).toEqual({ method: 'POST', url: '/api/validate-variables', body: { tenant: 'ridgeline' } });
    expect(useConfigureStore.getState().scan?.count).toBe(1);
    expect(statusBar()?.message).toBe('Variable scan complete: 1 missing');
  });
});

describe('Bring to Baseline', () => {
  it('needs a connected tenant', () => {
    useConfigureStore.getState().runBaseline();
    expect(statusBar()?.message).toBe('Connect to a tenant before running baseline.');
    expect(h.streams).toHaveLength(0);
  });

  it('streams /api/baseline with the posture and reports progress and completion', async () => {
    h.restore();
    h = installHarness([on('POST', '/api/save-run-log', { ok: true, path: 'C:\\runs\\baseline.json' })]);
    useTenantStore.getState().setConnectionState('connected', 'ridgeline');
    useConfigureStore.getState().setPosture('m365_foundation');
    useConfigureStore.getState().runBaseline();
    const s = h.streams[0]!;
    expect(s.url).toBe('/api/baseline?tenant=ridgeline&posture=m365_foundation');
    expect(useConfigureStore.getState().baselineRunning).toBe(true);
    s.emit({ type: 'discovery_progress', resourceType: 'KeyVault', resourceName: 'kv-ridgeline', exists: true, durationMs: 12 });
    s.emit({ type: 'discovery_progress', resourceType: 'Storage', resourceName: 'stridgeline', exists: false });
    expect(useConfigureStore.getState().baselineStatus).toBe('Discovering 2 resources (1 existing, 1 missing)');
    s.emit({ type: 'gap_summary', total: 2, existing: 1, missing: 1, byResourceType: { Storage: 1 } });
    s.emit({ type: 'baseline_complete', duration: 4200, succeeded: 1, failed: 0, skipped: 0 });
    await flush();
    const st = useConfigureStore.getState();
    expect(st.baselineRunning).toBe(false);
    expect(st.baselineStatus).toBe('Complete: 1 succeeded, 0 failed, 0 skipped (4.2s)');
    expect(consoleMessages()).toEqual([
      '✓ [KeyVault] kv-ridgeline exists [12ms]',
      '✗ [Storage] stridgeline missing',
      '--- Gap Summary ---',
      'Total: 2 | Existing: 1 | Missing: 1 resources',
      'By resource type: Storage:1',
      '--- Baseline Complete ---',
      'Duration: 4.2s | Succeeded: 1 | Failed: 0 | Skipped: 0',
      'Run log saved: C:\\runs\\baseline.json',
    ]);
    expect(currentRunLog()?.planPath).toMatch(/executable-plan-ridgeline\.json$/);
  });

  it('halt closes the stream and posts /api/abort', async () => {
    h.restore();
    h = installHarness([on('POST', '/api/abort', { ok: true })]);
    useTenantStore.getState().setConnectionState('connected', 'ridgeline');
    useConfigureStore.getState().runBaseline();
    useConfigureStore.getState().haltBaseline();
    await flush();
    expect(h.streams[0]!.closed).toBe(true);
    expect(h.calls.map((c) => `${c.method} ${c.url}`)).toEqual(['POST /api/abort']);
    expect(useConfigureStore.getState().baselineStatus).toBe('Halted by operator');
  });
});

// FIN-15: the cost gate on Bring to Baseline (DP-1 opt-in, DP-2 typed for the run; COST-GATE-SPEC §3.4-§3.5).
describe('Bring to Baseline cost gate (FIN-15)', () => {
  const ITEMS = [
    { entry_id: 'baseline.StorageAccount', resourceType: 'StorageAccount', label: 'Bring to Baseline: storage', cost_key: 'azure.storage.baseline_account', estimate: '$0.5-$2', estimate_basis: 'LRS', price_date: '2026-10-31', standard_alternative: [], acked: true, expected_dp2: 'baseline.StorageAccount $0.5-$2' },
    { entry_id: 'baseline.KeyVault', resourceType: 'KeyVault', label: 'Bring to Baseline: vault', cost_key: 'azure.keyvault.operations', estimate: '$0-$0.5', estimate_basis: 'ops', price_date: '2026-10-31', standard_alternative: [], acked: false, expected_dp2: 'baseline.KeyVault $0-$0.5' },
  ];

  it('the stream URL is unchanged until an operator or a DP-2 text is given', () => {
    expect(baselineStreamUrl('ridgeline', 'm365_foundation', '', {})).toBe('/api/baseline?tenant=ridgeline&posture=m365_foundation');
    expect(baselineStreamUrl('ridgeline', 'm365_foundation', '', { 'baseline.KeyVault': '  ' })).toBe('/api/baseline?tenant=ridgeline&posture=m365_foundation');
    const url = baselineStreamUrl('ridgeline', 'm365_foundation', ' op-1 ', { 'baseline.StorageAccount': 'baseline.StorageAccount $0.5-$2' });
    const q = new URLSearchParams(url.split('?')[1]);
    expect(q.get('operator')).toBe('op-1');
    expect(JSON.parse(q.get('dp2')!)).toEqual({ 'baseline.StorageAccount': 'baseline.StorageAccount $0.5-$2' });
  });

  it('loads the posture items, gives DP-1 by POST, and reloads', async () => {
    h.restore();
    h = installHarness([
      on('GET', '/api/baseline/cost-items', { tenant: 'ridgeline', posture: 'm365_foundation', price_date: '2026-10-31', items: ITEMS }),
      on('POST', '/api/baseline/cost-ack', { ok: true, estimate: '$0-$0.5', price_date: '2026-10-31' }),
    ]);
    useTenantStore.getState().setConnectionState('connected', 'ridgeline');
    useConfigureStore.getState().setPosture('m365_foundation');
    await useConfigureStore.getState().loadBaselineCost();
    expect(h.calls[0]).toEqual({ method: 'GET', url: '/api/baseline/cost-items?tenant=ridgeline&posture=m365_foundation', body: undefined });
    expect(useConfigureStore.getState().baselineCost?.items).toHaveLength(2);

    useConfigureStore.getState().setBaselineOperator('op-1');
    useConfigureStore.getState().setBaselineDp1Typed('baseline.KeyVault', 'baseline.KeyVault');
    await useConfigureStore.getState().ackBaselineCost('baseline.KeyVault');
    expect(h.calls[1]).toEqual({ method: 'POST', url: '/api/baseline/cost-ack', body: { tenant: 'ridgeline', entryId: 'baseline.KeyVault', typed: 'baseline.KeyVault', operator: 'op-1' } });
    expect(h.calls[2]!.method).toBe('GET');
    expect(statusBar()?.message).toBe('DP-1 recorded for baseline.KeyVault (about $0-$0.5 a month).');
  });

  it('a refused DP-1 shows the reason', async () => {
    h.restore();
    h = installHarness([on('POST', '/api/baseline/cost-ack', { error: 'DP-1 refused: type the entry id baseline.KeyVault to opt in' }, 400)]);
    useTenantStore.getState().setConnectionState('connected', 'ridgeline');
    await useConfigureStore.getState().ackBaselineCost('baseline.KeyVault');
    expect(statusBar()?.message).toBe('DP-1 refused: type the entry id baseline.KeyVault to opt in');
  });

  it('the run carries operator and DP-2 and logs cost-gate outcomes and the gated count', async () => {
    h.restore();
    h = installHarness([on('POST', '/api/save-run-log', { ok: true, path: 'C:\runs\baseline.json' })]);
    useTenantStore.getState().setConnectionState('connected', 'ridgeline');
    useConfigureStore.getState().setPosture('m365_foundation');
    useConfigureStore.getState().setBaselineOperator('op-1');
    useConfigureStore.getState().setBaselineDp2Typed('baseline.StorageAccount', 'baseline.StorageAccount $0.5-$2');
    useConfigureStore.getState().runBaseline();
    const s = h.streams[0]!;
    const q = new URLSearchParams(s.url.split('?')[1]);
    expect(q.get('tenant')).toBe('ridgeline');
    expect(q.get('operator')).toBe('op-1');
    expect(JSON.parse(q.get('dp2')!)).toEqual({ 'baseline.StorageAccount': 'baseline.StorageAccount $0.5-$2' });
    s.emit({ type: 'cost_gate', entryId: 'baseline.StorageAccount', resourceType: 'StorageAccount', resourceName: 'stridgeline', allowed: true, estimate: '$0.5-$2' });
    s.emit({ type: 'cost_gate', entryId: 'baseline.KeyVault', resourceType: 'KeyVault', resourceName: 'kv-ridgeline', allowed: false, reason: 'cost_gated_off: no DP-1' });
    s.emit({ type: 'baseline_complete', duration: 1000, succeeded: 2, failed: 0, skipped: 1, cost_gated_off: 1 });
    await flush();
    expect(consoleMessages()).toEqual([
      '[StorageAccount] stridgeline: recurring cost confirmed (about $0.5-$2 a month)',
      '[KeyVault] kv-ridgeline: not built, cost_gated_off: no DP-1',
      '--- Baseline Complete ---',
      'Duration: 1.0s | Succeeded: 2 | Failed: 0 | Skipped: 1 | Cost-gated off: 1',
      'Run log saved: C:\runs\baseline.json',
    ]);
  });

  it('changing the posture clears the list and the typed texts', () => {
    useConfigureStore.getState().setBaselineDp2Typed('baseline.KeyVault', 'x');
    useConfigureStore.getState().setPosture('m365_full_infra');
    expect(useConfigureStore.getState().baselineDp2Typed).toEqual({});
    expect(useConfigureStore.getState().baselineCost).toBeNull();
  });
});
