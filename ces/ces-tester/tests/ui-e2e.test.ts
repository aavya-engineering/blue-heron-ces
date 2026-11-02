// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

// W8-UIT1: the ui-e2e scenario type (loader, schema), the comparison (a)-(c), the runner's composition with
// injected variant runs (no browser, no server, no simulator), the CLI dispatch, and demo:acts-test --watch.
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isUiE2eFile, loadUiE2eFile, validateUiE2e, UI_E2E_STAMPER_STEPS } from '../src/scenarios/uiE2eFile.js';
import {
  compareFailedSet,
  compareLedgerRows,
  compareProjection,
  compareVariant,
  endStateOf,
  failedSet,
  mutatedLedgerRows,
  mutatedObjects,
  recordPass,
  type SimStoreLike,
  type VariantRecord,
} from '../src/flow/ui-e2e-compare.js';
import {
  readTwin,
  resolveUiE2eWatch,
  runUiE2e,
  selectedVariants,
  uiE2ePaths,
  variantSkipReason,
  UI_RUN_PORTS,
  elStoreOf,
  type VariantRunContext,
  type VariantRunOutput,
} from '../src/flow/ui-e2e-run.js';
import { SIM_STORE_EL } from '../src/flow/muster-e2e-run.js';
import { runRunScenarioCommand } from '../src/cli/index.js';
import { parseActsTestArgs, watchPaneDeps } from '../src/cli/acts-test-command.js';
import { WATCHED_MODE, HEADLESS_MODE } from '../src/demo/watch-mode.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const testerRoot = path.resolve(here, '..');
const UI_FILE = path.join(testerRoot, 'scenarios', 'ui', 's1-mach-stamper-ui-e2e.json');
const MUSTER_FILE = path.join(testerRoot, 'scenarios', 'muster', 's1-mach-e2e.json');
const SLUG = 's1-mach';

describe('ui-e2e scenario file (schema + loader)', () => {
  it('the S1 Stamper scenario loads: type, surface, twin, variants legacy then spa, the six steps, incremental', async () => {
    const sc = await loadUiE2eFile(UI_FILE);
    expect(sc.type).toBe('ui-e2e');
    expect(sc.surface).toBe('stamper');
    expect(sc.sim_scenario).toBe(SLUG);
    expect(sc.twin).toBe('s1-mach-e2e');
    expect(sc.variants.map((v) => [v.id, v.base_path])).toEqual([
      ['legacy', '/'],
      ['spa', '/app/'],
    ]);
    expect(sc.variants[1].requires_built).toBe('public/app/screens-ready.json');
    expect(sc.steps).toEqual([...UI_E2E_STAMPER_STEPS]);
    expect(sc.execute_mode).toBe('incremental');
    expect(fs.existsSync(path.join(testerRoot, 'scenarios', 'muster', `${sc.twin}.json`))).toBe(true);
  });

  it('dispatch detection: the ui file is ui-e2e, the muster twin is not', async () => {
    expect(await isUiE2eFile(UI_FILE)).toBe(true);
    expect(await isUiE2eFile(MUSTER_FILE)).toBe(false);
    expect(await isUiE2eFile(path.join(os.tmpdir(), 'no-such-ui-e2e-7f.json'))).toBe(false);
  });

  it('rejects unknown keys, a bad base path, duplicate variants and steps out of order', async () => {
    const good = JSON.parse(fs.readFileSync(UI_FILE, 'utf8'));
    expect(() => validateUiE2e({ ...good, extra: 1 })).toThrow(/schema/);
    expect(() => validateUiE2e({ ...good, variants: [{ id: 'legacy', base_path: 'app' }] })).toThrow(/schema/);
    expect(() => validateUiE2e({ ...good, variants: [good.variants[0], good.variants[0]] })).toThrow(/duplicate variant/);
    expect(() => validateUiE2e({ ...good, steps: ['translate', 'tenant', 'approve', 'execute', 'ledger', 'evidence'] })).toThrow(/in that order/);
    expect(() => validateUiE2e({ ...good, surface: 'muster' })).toThrow(/schema/);
  });
});

const proj = (ids: string[], extra: Record<string, unknown> = {}) => ({
  tasks: ids.map((id) => ({ id, engine: 'powershell', directive: 'automated', controls: [id.split('_')[2] ?? id], sub_commands: [], ...extra })),
  variables: { tenantDomain: 'fabrikam-machining.onmicrosoft.us' },
});

describe('ui-e2e-compare (a) projection, variables excluded', () => {
  it('equal tasks pass even when variables differ; key order is not a difference', () => {
    const ui = proj(['step_task_AC.L2-3.1.1_a', 'step_task_AC.L2-3.1.2_a']);
    const twin = { ...proj(['step_task_AC.L2-3.1.1_a', 'step_task_AC.L2-3.1.2_a']), variables: { other: 'x' } };
    const reordered = { tasks: twin.tasks.map((t) => Object.fromEntries(Object.entries(t).reverse())), variables: {} };
    expect(compareProjection(ui, twin)).toEqual({ pass: true, detail: '(a) UI translate projection = twin projection, 2 tasks, variables excluded' });
    expect(compareProjection(ui, reordered).pass).toBe(true);
  });

  it('a differing field, a different id order and a missing task each fail with the first difference', () => {
    const twin = proj(['t1', 't2']);
    expect(compareProjection(proj(['t1', 't2'], { engine: 'graph' }), twin).detail).toMatch(/task 0 \(t1\): field engine/);
    expect(compareProjection(proj(['t2', 't1']), twin).detail).toMatch(/task 0: ui id t2, twin id t1/);
    expect(compareProjection(proj(['t1']), twin).detail).toMatch(/task counts: ui 1, twin 2/);
    expect(compareProjection(null, twin).pass).toBe(false);
    expect(compareProjection(twin, null).pass).toBe(false);
  });
});

describe('ui-e2e-compare (b) failed set', () => {
  it('is the sorted unique failed_tasks task ids', () => {
    expect(failedSet({ failed_tasks: [{ task_id: 'b' }, { task_id: 'a' }, { task_id: 'b' }, { error: 'no id' }] })).toEqual(['a', 'b']);
    expect(failedSet(null)).toEqual([]);
  });

  it('equal sets pass; a difference names both sides; a missing report fails', () => {
    expect(compareFailedSet({ failed_tasks: [{ task_id: 'a' }] }, { failed_tasks: [{ task_id: 'a' }] })).toEqual({ pass: true, detail: '(b) failed set equal: 1 task(s)' });
    const d = compareFailedSet({ failed_tasks: [{ task_id: 'a' }, { task_id: 'c' }] }, { failed_tasks: [{ task_id: 'a' }, { task_id: 'b' }] });
    expect(d.pass).toBe(false);
    expect(d.detail).toContain('UI only [c]');
    expect(d.detail).toContain('twin only [b]');
    expect(compareFailedSet(null, { failed_tasks: [] }).pass).toBe(false);
    expect(compareFailedSet({ failed_tasks: [] }, null).pass).toBe(false);
  });
});

const W = { started: '2026-10-29T10:00:00.000Z', ended: '2026-10-29T10:10:00.000Z' };
const W2 = { started: '2026-10-29T12:00:00.000Z', ended: '2026-10-29T12:30:00.000Z' };
const entry = (ts: string, type: string, objectType: string, objectId: string, sessionType = 'operator') => ({ ts, type, objectType, objectId, sessionType });
const store = (collections: Record<string, Record<string, Record<string, unknown>>>): SimStoreLike => ({ collections });
const STORE_U1 = { collections: { users: { u1: { id: 'u1', displayName: 'Leaver One', accountEnabled: false } } } };

describe('ui-e2e-compare (c) mutated ledger rows', () => {
  it('keeps writes inside the window only (reads, seed rows and out-of-window writes dropped), as a sorted multiset', () => {
    const rows = mutatedLedgerRows(
      [
        entry('2026-10-29T10:01:00.000Z', 'mutate', 'users', 'u1'),
        entry('2026-10-29T10:02:00.000Z', 'read', 'users', 'u1'),
        entry('2026-10-29T10:03:00.000Z', 'mutate', 'users', 'u0', 'seed'),
        entry('2026-10-29T11:00:00.000Z', 'mutate', 'users', 'u9'),
        entry('2026-10-29T10:04:00.000Z', 'create', 'conditionalAccessPolicies', 'ca1'),
        entry('2026-10-29T10:05:00.000Z', 'mutate', 'users', 'u1'),
      ],
      W,
    );
    expect(rows).toEqual(['create conditionalAccessPolicies/ca1', 'mutate users/u1', 'mutate users/u1']);
  });

  it('equal objects across different windows pass; a write-count difference fails; missing inputs fail', () => {
    const twin = [entry('2026-10-29T10:01:00.000Z', 'mutate', 'users', 'u1')];
    const ui = [entry('2026-10-29T12:01:00.000Z', 'mutate', 'users', 'u1')];
    const st = store({ users: { u1: { id: 'u1', displayName: 'Leaver One', accountEnabled: false } } });
    expect(compareLedgerRows(ui, W2, twin, W, st, st)).toEqual({
      pass: true,
      detail: '(c) mutated objects equal: 1 object(s), 1 row(s), same end state (keyed by natural identity)',
    });
    const ui2 = [...ui, entry('2026-10-29T12:02:00.000Z', 'mutate', 'users', 'u1')];
    const d = compareLedgerRows(ui2, W2, twin, W, st, st);
    expect(d.pass).toBe(false);
    expect(d.detail).toContain('writes differ [users/Leaver One (UI 2, twin 1)]');
    expect(compareLedgerRows(null, W2, twin, W, st, st).pass).toBe(false);
    expect(compareLedgerRows(ui, null, twin, W, st, st).pass).toBe(false);
    expect(compareLedgerRows(ui, W2, twin, null, st, st).detail).toMatch(/no twin E6 window/);
    expect(compareLedgerRows(ui, W2, twin, W, null, st).detail).toBe('(c) no UI sim store snapshot');
    expect(compareLedgerRows(ui, W2, twin, W, st, null).detail).toBe('(c) no twin sim store snapshot');
  });

  // W8-UIT3: the S1 finding. The sim mints a fresh GUID on createInstance; the same intent must compare equal.
  const intent = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    displayName: 'CMMC-Win11-Baseline',
    templateId: '5ec0ba5e-0000-4000-8000-000000000001',
    isAssigned: true,
    lastModifiedDateTime: id === 'gu-1' ? '2026-10-30T09:58:13.564Z' : '2026-10-30T10:12:54.020Z',
    ...extra,
  });
  const tw = [entry('2026-10-29T10:01:00.000Z', 'mutate', 'deviceManagementIntents', 'gu-1')];
  const us = [entry('2026-10-29T12:01:00.000Z', 'mutate', 'deviceManagementIntents', 'gu-2')];

  it('W8-UIT3: the same object under a fresh server id is equal (natural key, timestamps and id dropped)', () => {
    const r = compareLedgerRows(us, W2, tw, W, store({ deviceManagementIntents: { 'gu-2': intent('gu-2') } }), store({ deviceManagementIntents: { 'gu-1': intent('gu-1') } }));
    expect(r.pass).toBe(true);
    expect(mutatedObjects(us, W2, store({ deviceManagementIntents: { 'gu-2': intent('gu-2') } }))[0].identity).toBe('deviceManagementIntents/CMMC-Win11-Baseline');
  });

  it('W8-UIT3: a genuine difference still fails: another end-state field, another name, an object on one side only', () => {
    const twinStore = store({ deviceManagementIntents: { 'gu-1': intent('gu-1') } });
    const field = compareLedgerRows(us, W2, tw, W, store({ deviceManagementIntents: { 'gu-2': intent('gu-2', { isAssigned: false }) } }), twinStore);
    expect(field.pass).toBe(false);
    expect(field.detail).toContain('end state differs [deviceManagementIntents/CMMC-Win11-Baseline (field isAssigned)]');
    const nested = compareLedgerRows(us, W2, tw, W, store({ deviceManagementIntents: { 'gu-2': intent('gu-2', { settings: [{ v: 2 }] }) } }), store({ deviceManagementIntents: { 'gu-1': intent('gu-1', { settings: [{ v: 1 }] }) } }));
    expect(nested.detail).toContain('(field settings)');
    const named = compareLedgerRows(us, W2, tw, W, store({ deviceManagementIntents: { 'gu-2': intent('gu-2', { displayName: 'Other-Baseline' }) } }), twinStore);
    expect(named.detail).toContain('UI only [deviceManagementIntents/Other-Baseline]; twin only [deviceManagementIntents/CMMC-Win11-Baseline]');
    const extra = [...us, entry('2026-10-29T12:03:00.000Z', 'mutate', 'caPolicies', 'CMMC-X')];
    expect(compareLedgerRows(extra, W2, tw, W, store({ deviceManagementIntents: { 'gu-2': intent('gu-2') } }), twinStore).detail).toContain('UI only [caPolicies/CMMC-X]');
  });

  it('W8-UIT3: no natural key, or one two objects share, keys by id; an object absent from both stores compares as absent', () => {
    const rows = [
      entry('2026-10-29T10:01:00.000Z', 'mutate', 'groupMember', 'group-1|user-48'),
      entry('2026-10-29T10:02:00.000Z', 'mutate', 'transportConfig', 'transportConfig'),
      entry('2026-10-29T10:03:00.000Z', 'create', 'deviceConfigurations', 'dc-4'),
      entry('2026-10-29T10:04:00.000Z', 'create', 'deviceConfigurations', 'dc-5'),
    ];
    const st = store({
      transportConfig: { transportConfig: { id: 'transportConfig', SmtpClientAuthenticationDisabled: true } },
      deviceConfigurations: { 'dc-4': { id: 'dc-4', displayName: 'Same' }, 'dc-5': { id: 'dc-5', displayName: 'Same' } },
    });
    expect(mutatedObjects(rows, W, st).map((o) => [o.identity, o.state === null])).toEqual([
      ['deviceConfigurations/dc-4', false],
      ['deviceConfigurations/dc-5', false],
      ['groupMember/group-1|user-48', true],
      ['transportConfig/transportConfig', false],
    ]);
    expect(compareLedgerRows(rows, W, rows, W, st, st).pass).toBe(true);
    expect(endStateOf({ id: 'x', createdDateTime: 'a', nested: { WhenChangedUTC: 'b', keep: 1 } })).toBe('{"nested":{"keep":1}}');
  });

  it('compareVariant passes only when (a), (b) and (c) all pass', () => {
    const base = {
      variant: 'legacy',
      uiProjection: proj(['t1']),
      twinProjection: proj(['t1']),
      uiReport: { failed_tasks: [] },
      twinReport: { failed_tasks: [] },
      uiLedger: [],
      uiWindow: W2,
      twinLedger: [],
      twinWindow: W,
      uiStore: store({}),
      twinStore: store({}),
    };
    expect(compareVariant(base).pass).toBe(true);
    expect(compareVariant({ ...base, uiReport: { failed_tasks: [{ task_id: 't1' }] } }).pass).toBe(false);
  });

  it('recordPass: legacy must run and pass; a not-run SPA is fine; a run SPA must pass', () => {
    const v = (variant: string, ran: boolean, pass: boolean): VariantRecord => ({ variant, base_path: '/', ran, pass });
    expect(recordPass([v('legacy', true, true), v('spa', false, false)])).toBe(true);
    expect(recordPass([v('legacy', true, true), v('spa', true, false)])).toBe(false);
    expect(recordPass([v('legacy', false, false), v('spa', true, true)])).toBe(false);
    expect(recordPass([v('spa', true, true)])).toBe(false);
  });
});

describe('ui-e2e-run argv (Watchable default)', () => {
  it('is headed and paced by default; headless only on --headless', () => {
    expect(resolveUiE2eWatch([])).toEqual(WATCHED_MODE);
    expect(resolveUiE2eWatch(['--root', 'x'])).toEqual(WATCHED_MODE);
    expect(resolveUiE2eWatch(['--headless'])).toEqual(HEADLESS_MODE);
    expect(WATCHED_MODE.headless).toBe(false);
    expect(WATCHED_MODE.slowMo).toBeGreaterThan(0);
  });

  it('--variant narrows (repeatable), unknown ids ignored', () => {
    expect(selectedVariants([])).toEqual([]);
    expect(selectedVariants(['--variant', 'spa', '--variant', 'legacy', '--variant', 'nope'])).toEqual(['spa', 'legacy']);
  });

  it('binds the sim and Stamper GUI ports only', () => {
    expect(UI_RUN_PORTS).toEqual([4390, 3000]);
  });
});

/** A synthetic workspace with the twin's outputs (fictional names; no real tenant). */
function makeWorkspace(opts: { spaBuilt?: boolean; twin?: boolean } = {}) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-e2e-ws-'));
  const pkg = path.join(ws, 'pkg');
  const P = uiE2ePaths(ws, pkg, SLUG);
  fs.mkdirSync(P.out, { recursive: true });
  fs.mkdirSync(P.stamper, { recursive: true });
  fs.mkdirSync(P.simTenantDir, { recursive: true });
  fs.writeFileSync(path.join(P.simTenantDir, 'store.json'), JSON.stringify({ twin: true, ...STORE_U1 }));
  if (opts.spaBuilt) {
    fs.mkdirSync(path.join(P.stamper, 'public', 'app'), { recursive: true });
    fs.writeFileSync(path.join(P.stamper, 'public', 'app', 'index.html'), '<!doctype html>');
    fs.writeFileSync(path.join(P.stamper, 'public', 'app', 'screens-ready.json'), '{"ready":true}');
  }
  if (opts.twin !== false) {
    fs.mkdirSync(P.plansPushed, { recursive: true });
    fs.writeFileSync(path.join(P.plansPushed, 'manual-mission-plan-2026-10-29.json'), '{}');
    fs.writeFileSync(path.join(P.plansPushed, 'tenant-manifest-2026-10-29.json'), '{}');
    fs.writeFileSync(path.join(P.plansPushed, 'infrastructure-manifest-2026-10-29.json'), '{}');
    fs.writeFileSync(P.exe, JSON.stringify({ execution_graph: [{ id: 't1' }, { id: 't2' }] }));
    fs.writeFileSync(P.twinReport, JSON.stringify({ failed_tasks: [{ task_id: 't2' }] }));
    fs.writeFileSync(P.twinLedger, JSON.stringify({ data: [entry('2026-10-29T10:01:00.000Z', 'mutate', 'users', 'u1')] }));
    fs.writeFileSync(P.stepsFile, JSON.stringify({ E6: { rc: 0, ...W } }));
  }
  return { ws, pkg, P };
}

const fakeProjector = async () => (plan: unknown) => ({
  tasks: ((plan as { execution_graph?: Array<{ id: string }> }).execution_graph ?? []).map((t) => ({ id: t.id })),
});

function matchingVariant(calls: string[], P: ReturnType<typeof uiE2ePaths>) {
  return async (ctx: VariantRunContext): Promise<VariantRunOutput> => {
    calls.push(ctx.variant.id);
    // The run moved the twin's sim tenant aside before the first variant (a copy exists).
    expect(fs.existsSync(P.simTenantBackup)).toBe(true);
    fs.writeFileSync(path.join(P.simTenantDir, 'store.json'), `{"ui":"${ctx.variant.id}"}`);
    expect(ctx.watch).toEqual(WATCHED_MODE);
    expect(ctx.initialPassword.length).toBeGreaterThanOrEqual(24);
    expect(path.basename(ctx.twin.pMP!)).toBe('manual-mission-plan-2026-10-29.json');
    expect(path.basename(ctx.twin.pTM!)).toBe('tenant-manifest-2026-10-29.json');
    expect(path.basename(ctx.twin.pIM!)).toBe('infrastructure-manifest-2026-10-29.json');
    return {
      executablePlan: { execution_graph: [{ id: 't1' }, { id: 't2' }] },
      report: { failed_tasks: [{ task_id: 't2' }] },
      ledger: [entry('2026-10-29T12:01:00.000Z', 'mutate', 'users', 'u1')],
      store: STORE_U1,
      executeWindow: W2,
      approvals: 7,
      files: { ledger: `ui/${ctx.variant.id}/ledger.json`, sim_store: `ui/${ctx.variant.id}/sim-store.json` },
    };
  };
}

describe('runUiE2e (injected variant runs)', () => {
  it('legacy equal to the twin, SPA not built: PASS, SPA "not run", record written, twin sim store restored', async () => {
    const { ws, pkg, P } = makeWorkspace();
    const calls: string[] = [];
    const sc = await loadUiE2eFile(UI_FILE);
    const rec = await runUiE2e({
      scenario: sc,
      wsRoot: ws,
      packageRoot: pkg,
      testerRoot,
      watch: WATCHED_MODE,
      log: () => undefined,
      deps: { runVariant: matchingVariant(calls, P), loadProjector: fakeProjector, heldPorts: async () => [] },
    });
    expect(calls).toEqual(['legacy']);
    expect(rec.pass).toBe(true);
    expect(rec.schema).toBe('ces-tester/ui-e2e-stamper@1');
    expect(rec.twin.e6_window).toEqual(W);
    expect(rec.variants[0]).toMatchObject({ variant: 'legacy', ran: true, pass: true, approvals: 7, headed: true, execute_window: W2 });
    expect(rec.variants[1]).toMatchObject({ variant: 'spa', ran: false, pass: false });
    expect(rec.variants[1].reason).toMatch(/not run: \/app\/ is not built/);
    expect(JSON.parse(fs.readFileSync(P.record, 'utf8')).pass).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(P.simTenantDir, 'store.json'), 'utf8')).twin).toBe(true);
    expect(fs.existsSync(P.simTenantBackup)).toBe(false);
    // W8-UIT3: the twin's store was snapshotted before the first reset and the record names it.
    expect(rec.twin.sim_store).toBe('ui/twin-sim-store.json');
    expect(JSON.parse(fs.readFileSync(P.twinSimStore, 'utf8')).twin).toBe(true);
    expect(rec.variants[0].comparison?.c_ledger_rows.detail).toMatch(/mutated objects equal: 1 object/);
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it('SPA built: both variants run in order legacy then spa; a differing SPA fails the record', async () => {
    const { ws, pkg, P } = makeWorkspace({ spaBuilt: true });
    const calls: string[] = [];
    const legacyOk = matchingVariant(calls, P);
    const rec = await runUiE2e({
      scenario: await loadUiE2eFile(UI_FILE),
      wsRoot: ws,
      packageRoot: pkg,
      testerRoot,
      watch: WATCHED_MODE,
      log: () => undefined,
      deps: {
        runVariant: async (ctx) => {
          const out = await legacyOk(ctx);
          return ctx.variant.id === 'spa' ? { ...out, report: { failed_tasks: [] } } : out;
        },
        loadProjector: fakeProjector,
        heldPorts: async () => [],
      },
    });
    expect(calls).toEqual(['legacy', 'spa']);
    expect(rec.variants.map((v) => [v.variant, v.ran, v.pass])).toEqual([
      ['legacy', true, true],
      ['spa', true, false],
    ]);
    expect(rec.variants[1].comparison?.b_failed_set.detail).toContain('twin only [t2]');
    expect(rec.pass).toBe(false);
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it('a variant that throws is ran-with-error (never a pass), and the twin sim store is still restored', async () => {
    const { ws, pkg, P } = makeWorkspace();
    const rec = await runUiE2e({
      scenario: await loadUiE2eFile(UI_FILE),
      wsRoot: ws,
      packageRoot: pkg,
      testerRoot,
      watch: HEADLESS_MODE,
      only: ['legacy'],
      log: () => undefined,
      deps: {
        runVariant: async () => {
          fs.writeFileSync(path.join(P.simTenantDir, 'store.json'), '{"ui":"half"}');
          throw new Error('timed out after 180000ms waiting for #tenantSelect option[value="s1-mach"]');
        },
        loadProjector: fakeProjector,
        heldPorts: async () => [],
      },
    });
    expect(rec.variants).toHaveLength(1);
    expect(rec.variants[0]).toMatchObject({ variant: 'legacy', ran: true, pass: false, headed: false });
    expect(rec.variants[0].error).toMatch(/tenantSelect/);
    expect(rec.pass).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(P.simTenantDir, 'store.json'), 'utf8')).twin).toBe(true);
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it('no twin outputs, or a held port: nothing runs and every variant says why', async () => {
    const noTwin = makeWorkspace({ twin: false });
    let ran = 0;
    const deps = { runVariant: async () => { ran++; throw new Error('must not run'); }, loadProjector: fakeProjector, heldPorts: async () => [] };
    const sc = await loadUiE2eFile(UI_FILE);
    const r1 = await runUiE2e({ scenario: sc, wsRoot: noTwin.ws, packageRoot: noTwin.pkg, testerRoot, watch: WATCHED_MODE, log: () => undefined, deps });
    expect(r1.pass).toBe(false);
    expect(r1.variants.every((v) => !v.ran && /no headless twin/.test(v.reason ?? ''))).toBe(true);
    expect(readTwin(noTwin.P).missing).toContain('out/executable-plan.json');

    const held = makeWorkspace();
    const r2 = await runUiE2e({ scenario: sc, wsRoot: held.ws, packageRoot: held.pkg, testerRoot, watch: WATCHED_MODE, log: () => undefined, deps: { ...deps, heldPorts: async () => [3000] } });
    expect(r2.variants[0].reason).toMatch(/ports in use: 3000/);
    expect(ran).toBe(0);
    for (const w of [noTwin, held]) fs.rmSync(w.ws, { recursive: true, force: true });
  });

  it('variantSkipReason: no requirement runs; a missing build is "not run"', () => {
    expect(variantSkipReason({ id: 'legacy', base_path: '/' }, 'C:\\st', () => false)).toBeNull();
    expect(variantSkipReason({ id: 'spa', base_path: '/app/', requires_built: 'public/app/index.html' }, 'C:\\st', () => true)).toBeNull();
    expect(variantSkipReason({ id: 'spa', base_path: '/app/', requires_built: 'public/app/index.html' }, 'C:\\st', () => false)).toMatch(/^not run:/);
  });
});

describe('run-scenario dispatch on type ui-e2e', () => {
  it('reaches the ui-e2e CLI glue, which requires --root and --package-root (exit 2, nothing launched)', async () => {
    const errs: string[] = [];
    const orig = console.error;
    console.error = (m: unknown) => errs.push(String(m));
    try {
      expect(await runRunScenarioCommand([UI_FILE])).toBe(2);
    } finally {
      console.error = orig;
    }
    expect(errs.join('\n')).toContain('run-scenario (ui-e2e)');
  });
});

describe('demo:acts-test --watch (UI-TRACK §4)', () => {
  it('--watch is accepted and selects the watched mode; absent stays headless', () => {
    const watched = parseActsTestArgs(['--act', 'stamper', '--watch'], testerRoot);
    expect(watched.errors).toEqual([]);
    expect(watched.watch).toEqual(WATCHED_MODE);
    expect(parseActsTestArgs(['--act', 'stamper'], testerRoot).watch).toEqual(HEADLESS_MODE);
  });

  it('watchPaneDeps: headless adds nothing; watched opens the show-layer pane headed with the watch slow motion', async () => {
    expect(watchPaneDeps(HEADLESS_MODE)).toEqual({});
    const seen: unknown[] = [];
    const deps = watchPaneDeps(WATCHED_MODE, async () => ({
      BACKSTAGE_GEOMETRY: { width: 1280, height: 900, x: 0, y: 0 },
      openAppPane: async (o) => {
        seen.push(o);
        return 'pane';
      },
    }));
    expect(await deps.openPane!(true)).toBe('pane');
    expect(seen).toEqual([{ geometry: { width: 1280, height: 900, x: 0, y: 0 }, headless: false, slowMo: WATCHED_MODE.slowMo }]);
  });
});

// FIX-EL (R-F11): step EL runs A-22 on the confirmed leaver before E6, so the twin's E6 starts from the post-EL store.
// The UI run starts each execute from that same store (out/sim-store-el.json), never from a looser comparison.
describe('ui-e2e-run: the EL precondition (FIX-EL)', () => {
  it('elStoreOf takes this run\'s post-EL snapshot only', () => {
    const at = (ms: number) => () => ({ mtimeMs: ms });
    const EL = { started: '2026-11-01T10:00:00.000Z' };
    const t0 = Date.parse(EL.started);
    expect(elStoreOf('x/sim-store-el.json', EL, at(t0 + 5000))).toBe('x/sim-store-el.json');
    expect(elStoreOf('x/sim-store-el.json', EL, at(t0 - 1))).toBeNull();
    expect(elStoreOf('x/sim-store-el.json', undefined, at(t0 + 5000))).toBeNull();
    expect(elStoreOf('x/sim-store-el.json', EL, () => null)).toBeNull();
    expect(SIM_STORE_EL).toBe('sim-store-el.json');
  });

  it('readTwin and runUiE2e hand the post-EL store to every variant and name it in the record', async () => {
    const { ws, pkg, P } = makeWorkspace();
    fs.writeFileSync(P.stepsFile, JSON.stringify({ EL: { rc: 0, started: '2000-01-01T00:00:00.000Z', ended: '2000-01-01T00:00:05.000Z' }, E6: { rc: 0, ...W } }));
    const elFile = path.join(P.out, SIM_STORE_EL);
    fs.writeFileSync(elFile, JSON.stringify({ el: true }));
    expect(readTwin(P).elStore).toBe(elFile);
    const seen: Array<string | null | undefined> = [];
    const calls: string[] = [];
    const inner = matchingVariant(calls, P);
    const rec = await runUiE2e({
      scenario: await loadUiE2eFile(UI_FILE), wsRoot: ws, packageRoot: pkg, testerRoot, watch: WATCHED_MODE, log: () => undefined,
      deps: { runVariant: async (ctx) => { seen.push(ctx.twin.elStore); return inner(ctx); }, loadProjector: fakeProjector, heldPorts: async () => [] },
    });
    expect(seen).toEqual([elFile]);
    expect(rec.twin.pre_execute_store).toBe(SIM_STORE_EL);
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it('without an EL step (muster-partial) the twin has no post-EL store and nothing is restored', () => {
    const { ws, P } = makeWorkspace();
    fs.writeFileSync(path.join(P.out, SIM_STORE_EL), '{}');
    expect(readTwin(P).elStore).toBeNull();
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it('wiring (by text): EL snapshots the store after its record; the Stamper variant restores it after the reset, before serving', () => {
    const src = (f: string) => fs.readFileSync(path.join(testerRoot, 'src', 'flow', f), 'utf8');
    const mu = src('muster-e2e-run.ts');
    expect(mu).toMatch(/fs\.writeFileSync\(path\.join\(P\.out, 'leaver-flow\.json'\)[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*snapshotStoreTo\(SIM_STORE_EL\);/);
    expect(mu).toMatch(/\/\^sim-store-el\\.json\$\//);
    const ui = src('ui-e2e-run.ts');
    const reset = ui.indexOf("['bin/stacksim.mjs', 'scenario', slug]");
    const restore = ui.indexOf("fs.copyFileSync(twin.elStore, path.join(P.simTenantDir, 'store.json'))");
    const serve = ui.indexOf('serve = await startServe(', reset);
    expect(reset).toBeGreaterThan(0);
    expect(restore).toBeGreaterThan(reset);
    expect(serve).toBeGreaterThan(restore);
  });
});
