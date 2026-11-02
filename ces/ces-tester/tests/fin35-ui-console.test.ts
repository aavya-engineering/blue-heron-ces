// FIN-35 (finishing plan PH-3 harness): the watched AO, EO and Muster console runs (EU-AO, EU-EO, EU-MU): the scenario
// loader and files, the twin comparisons, the runner with injected legs, the AO console flow on a fake page, and the
// V73 x4 Stamper scenario files. Temp folders and fakes only; no browser, server or simulator is started.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { consoleSurfaceOf, loadUiConsoleFile, validateUiConsole, UI_CONSOLE_STEPS } from '../src/flow/ui-console-file.js';
import {
  compareAoRun,
  compareEoRun,
  compareMusterRun,
  comparePushSets,
  consoleRecordPass,
  normaliseFileName,
  pushedList,
  statusMap,
} from '../src/flow/ui-console-compare.js';
import { aoConsoleOps, consoleSkipReason, eoFactsFromSpec, eoProbeTarget, playwrightCliFor, readConsoleTwin, runUiConsole, twinEoSprs, uiConsolePaths, writeCompileFiles, type ConsoleLeg } from '../src/flow/ui-console-run.js';
import { cliShapeOf, driveAoConsoleOp, AO_KIT } from '../src/demo/ao-console-driver.js';
import { consoleVariants } from '../src/flow/ui-e2e-run.js';
import { loadUiE2eFile } from '../src/scenarios/uiE2eFile.js';
import { HEADLESS_MODE } from '../src/demo/watch-mode.js';
import type { ConsolePage } from '../src/demo/console-window.js';

const SCEN = path.resolve(__dirname, '..', 'scenarios', 'ui');
const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'fin35-'));

describe('FIN-35 scenario files', () => {
  it('the console scenarios load on S1-S3 (mp has no reviewer and no answers file), kit variants with a build marker', async () => {
    const files = fs.readdirSync(SCEN).filter((f) => /-(ao|eo|muster)-ui-e2e\.json$/.test(f)).sort();
    expect(files).toHaveLength(9);
    expect(files.some((f) => f.startsWith('muster-partial'))).toBe(false);
    for (const f of files) {
      const sc = await loadUiConsoleFile(path.join(SCEN, f));
      expect(sc.steps).toEqual([...UI_CONSOLE_STEPS[sc.surface]]);
      expect(sc.variants.every((v) => v.id === 'kit' && !!v.requires_built)).toBe(true);
      expect(f.startsWith(sc.sim_scenario)).toBe(true);
    }
    expect(files.filter((f) => f.includes('-ao-'))).toEqual(['s1-mach-ao-ui-e2e.json', 's2-eng-ao-ui-e2e.json', 's3-def-ao-ui-e2e.json']);
  });

  it('V73 x4: a Stamper UI scenario for every scenario, no plan-variable seed (FD-13), the twin named', async () => {
    for (const s of ['s1-mach', 's2-eng', 's3-def', 'muster-partial']) {
      const sc = await loadUiE2eFile(path.join(SCEN, `${s}-stamper-ui-e2e.json`));
      expect(sc.sim_scenario).toBe(s);
      expect(sc.twin).toBe(`${s}-e2e`);
      expect(sc.execute_mode).toBe('incremental');
      expect(consoleSurfaceOf(sc)).toBeNull();
    }
    // runStamperVariant passes planVariables: false (LOG-FIN-33 §5 item 3): the GUI seeds no variables the CLI twin lacks.
    expect(fs.readFileSync(path.resolve(__dirname, '..', 'src', 'flow', 'ui-e2e-run.ts'), 'utf8')).toMatch(/planVariables: false/);
  });

  it('the validator refuses wrong steps, a duplicate variant and an unknown surface', () => {
    const ok = { type: 'ui-e2e', scenario_id: 'x-ao-ui-e2e', surface: 'ao', sim_scenario: 'x', stance: 'm365_azure', twin: 'x-e2e', variants: [{ id: 'kit', base_path: '/app/' }], steps: [...UI_CONSOLE_STEPS.ao] };
    expect(validateUiConsole(ok).surface).toBe('ao');
    expect(() => validateUiConsole({ ...ok, steps: ['open'] })).toThrow(/steps must be/);
    expect(() => validateUiConsole({ ...ok, variants: [ok.variants[0], ok.variants[0]] })).toThrow(/duplicate variant/);
    expect(() => validateUiConsole({ ...ok, surface: 'stamper' })).toThrow(/schema/);
    expect(consoleSurfaceOf({ surface: 'eo' })).toBe('eo');
    expect(consoleSurfaceOf({ surface: 'stamper' })).toBeNull();
    expect(consoleVariants(['--variant', 'kit', '--variant', 'spa'])).toEqual(['kit']);
  });
});

describe('V123 AO comparison', () => {
  const call = (k: 'dry_run' | 'apply', extra: Record<string, unknown> = {}) => ({ call: k, ok: true, mode: k === 'dry_run' ? 'dry_run' : 'live', outcome: 'success', verdict: 'SAT', state_changed: k === 'apply', evidence_persisted: true, ...extra });
  const op = (id: string, extra: Record<string, unknown> = {}) => ({ op: id, ok: true, calls: [call('dry_run'), call('apply', { evidence_row_id: `r-${id}`, evidence_objectives: ['AC.L1-3.1.1[a]'] })], confirm: { pass: true, actual: 'enabled' }, ...extra });
  it('equal ops, calls, confirms and objectives pass; each difference names its clause', () => {
    const twin = [op('A-11'), op('A-02')];
    const c = compareAoRun(twin, [op('A-11'), op('A-02')], () => ['AC.L1-3.1.1[a]']);
    expect(Object.values(c).every((x) => x.pass)).toBe(true);
    expect(compareAoRun(twin, [op('A-02'), op('A-11')]).a_ops.pass).toBe(false);
    const changed = op('A-02', { calls: [call('dry_run'), call('apply', { state_changed: false })] });
    expect(compareAoRun(twin, [op('A-11'), changed]).b_calls.detail).toMatch(/A-02: calls twin/);
    expect(compareAoRun(twin, [op('A-11'), op('A-02', { confirm: { pass: false, actual: 'disabled' } })]).c_confirm.pass).toBe(false);
    expect(compareAoRun(twin, [op('A-11'), op('A-02')], () => ['AC.L1-3.1.1[b]']).d_objectives.pass).toBe(false);
    expect(compareAoRun(null, [])).toEqual({ a_ops: { pass: false, detail: 'no twin out/adminops-e7a.json' } });
  });
  it('aoConsoleOps reads parameters from the record and names what is missing', () => {
    const rec = { resources: { breakglass_user_id: 'u-2' } };
    const r = aoConsoleOps([{ op: 'A-19', tier: 'T3', kind: 'write', params: { userId: 'resources.breakglass_user_id', policy: 'resources.ca_policy_id' } }], rec);
    expect(r.ops[0].params).toEqual([{ name: 'userId', value: 'u-2' }, { name: 'policy', value: '' }]);
    expect(r.missing).toEqual(['A-19 policy <- resources.ca_policy_id']);
  });
  it('cliShapeOf unwraps the web route body so the CLI summariser reads it', () => {
    expect(cliShapeOf({ success: true, result: { success: true, evidence: { outcome: 'success' } }, evidencePersisted: true, evidencePath: 'x/y' })).toEqual({ success: true, evidence: { outcome: 'success' }, evidencePersisted: true, evidencePath: 'x/y' });
  });
});

/** A fake console page: records actions; attributes and responses scripted per selector. */
function fakePage(o: { attrs?: Record<string, Record<string, string | null>>; values?: Record<string, string>; counts?: Record<string, number>; responses?: Array<{ status: number; json: unknown }> } = {}) {
  const log: string[] = [];
  const responses = [...(o.responses ?? [])];
  const values: Record<string, string> = { ...(o.values ?? {}) };
  const page: ConsolePage = {
    goto: async (u) => { log.push(`goto ${u}`); },
    click: async (s) => { log.push(`click ${s}`); },
    fill: async (s, v) => { values[s] = v; log.push(`fill ${s}=${v}`); },
    check: async (s) => { log.push(`check ${s}`); },
    selectOption: async (s, v) => { values[s] = v; log.push(`select ${s}=${v}`); },
    setInputFiles: async (s, p) => { log.push(`files ${s}=${p}`); },
    waitForDownload: async () => 'x',
    inputValue: async (s) => values[s] ?? '',
    textContent: async () => 'SUCCESS',
    getAttribute: async (s, n) => o.attrs?.[s]?.[n] ?? null,
    texts: async () => [],
    count: async (s) => o.counts?.[s] ?? 1,
    isVisible: async () => true,
    waitForSelector: async () => undefined,
    waitForResponse: async () => undefined,
    getJson: async () => undefined,
    screenshot: async () => undefined,
    attrs: async () => [],
    waitForResponseFull: async (u, action) => { await action(); log.push(`response ${u}`); return { ...(responses.shift() ?? { status: 200, json: {} }), url: u }; },
    caption: async (t) => { log.push(`caption ${t}`); },
  };
  return { page, log };
}

describe('the AO console flow (fake page)', () => {
  it('opens, picks the tenant, fills only editable parameters, DRY RUN then APPLY, and records both bodies', async () => {
    const { page, log } = fakePage({ attrs: { [AO_KIT.param('ro')]: { readonly: '' } }, values: { [AO_KIT.param('ro')]: 'bound' }, responses: [{ status: 200, json: { a: 1 } }, { status: 200, json: { b: 2 } }] });
    const r = await driveAoConsoleOp(page, 's1-mach', { op: 'A-02', tier: 'T2', params: [{ name: 'ro', value: 'bound' }, { name: 'free', value: 'v' }] });
    expect(r.error).toBeUndefined();
    expect(r.calls.map((c) => [c.call, c.http])).toEqual([['dry_run', 200], ['apply', 200]]);
    const order = log.filter((l) => /^(select|fill|click|response)/.test(l));
    expect(order).toEqual([
      `fill ${AO_KIT.search}=A-02`, `click ${AO_KIT.searchResult('A-02')}`, `select ${AO_KIT.tenantSelect}=s1-mach`, `fill ${AO_KIT.param('free')}=v`,
      `click ${AO_KIT.dryRun}`, 'response /api/execute/A-02', `click ${AO_KIT.apply}`, 'response /api/execute/A-02', `click ${AO_KIT.cancel}`,
    ]);
  });
  it('a tenant-sourced parameter that disagrees with the record, or a failed dry run, stops the op with a reason', async () => {
    const bad = fakePage({ attrs: { [AO_KIT.param('ro')]: { readonly: '' } }, values: { [AO_KIT.param('ro')]: 'other' } });
    expect((await driveAoConsoleOp(bad.page, 's', { op: 'A-1', tier: 'T2', params: [{ name: 'ro', value: 'bound' }] })).error).toMatch(/tenant-sourced/);
    const refused = fakePage({ responses: [{ status: 403, json: {} }] });
    const r = await driveAoConsoleOp(refused.page, 's', { op: 'A-1', tier: 'T2', params: [] });
    expect(r.error).toMatch(/dry run HTTP 403/);
    expect(r.calls).toHaveLength(1);
  });
});

describe('V124 EO comparison', () => {
  const twin = { snapStatuses: { 'PE.L2-3.10.2': 'met', 'AC.L1-3.1.1': 'met' }, sspStatuses: { 'PE.L2-3.10.2': 'met', 'AC.L1-3.1.1': 'met' }, sprs: 92, docx: true };
  const target = eoProbeTarget({ uploader: { upn: 'up@x.invalid' }, reviewer: { upn: 'rv@x.invalid' }, operatorUpn: 'op@x.invalid' });
  const api = { assessment: { controls: [{ control_id: 'PE.L2-3.10.2', status: 'met' }, { control_id: 'AC.L1-3.1.1', status: 'met' }] }, sprs: { score: 92 }, ssp: { controlImplementations: [{ control_id: 'PE.L2-3.10.2', status: 'met' }, { control_id: 'AC.L1-3.1.1', status: 'met' }] } };
  const rec = { docx: 'SSP-1.docx', upload: 'Uploaded item i-1 by up@x.invalid', review: 'Review recorded for PE.L2-3.10.2[b]', assessorRow: 'PE.L2-3.10.2 met' };
  it('the FIN-31 spec record and the API reads give five passing clauses', () => {
    const c = compareEoRun(twin, eoFactsFromSpec(rec, api, target));
    expect(Object.entries(c).filter(([, x]) => !x.pass)).toEqual([]);
    expect(c.c_upload.detail).toMatch(/by up@x\.invalid/);
  });
  it('a status difference, no DOCX, no uploader, an unrecorded review or no assessor row each fail their clause', () => {
    const f = eoFactsFromSpec(rec, { ...api, assessment: { controls: [{ control_id: 'PE.L2-3.10.2', status: 'not_assessed' }] } }, target);
    expect(compareEoRun(twin, f).a_assess.pass).toBe(false);
    expect(compareEoRun(twin, f).d_review.detail).toMatch(/after the UI review not_assessed/);
    expect(compareEoRun(twin, eoFactsFromSpec({ ...rec, docx: null }, api, target)).b_ssp_docx.pass).toBe(false);
    expect(compareEoRun(twin, eoFactsFromSpec({ ...rec, upload: 'failed' }, api, target)).c_upload.pass).toBe(false);
    expect(compareEoRun(twin, eoFactsFromSpec({ ...rec, review: 'refused' }, api, target)).d_review.pass).toBe(false);
    expect(compareEoRun(twin, eoFactsFromSpec({ ...rec, assessorRow: '' }, api, target)).e_assessor.pass).toBe(false);
    expect(statusMap(null)).toBeNull();
  });
  it('PH12-UI: the twin SPRS is the authoritative E7B assess (S3: 20, not the E7 passes 18), else summary.json', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ph12ui-sprs-'));
    const summary = path.join(d, 'summary.json');
    const a7b = path.join(d, 'eo-assess-7b.json');
    expect(twinEoSprs(summary, a7b)).toBeNull();
    fs.writeFileSync(summary, JSON.stringify({ eo_assess: { sprs_score: 18 } }));
    expect(twinEoSprs(summary, a7b)).toBe(18);
    fs.writeFileSync(a7b, JSON.stringify([{ type: 'assess_start' }, { type: 'assess_summary', sprs_score: 20 }, { type: 'assess_done' }]));
    expect(twinEoSprs(summary, a7b)).toBe(20);
    fs.writeFileSync(a7b, '{ not json');
    expect(twinEoSprs(summary, a7b)).toBe(18);
    fs.rmSync(summary);
    expect(twinEoSprs(summary, a7b)).toBeNull();
    fs.rmSync(d, { recursive: true, force: true });
  });
});

describe('PH12-UI runSpec Playwright CLI', () => {
  it('uses the module own @playwright/test when it has one, else the mono root one', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ph12ui-pw-'));
    const root = path.join(d, 'ces');
    const mod = path.join(root, 'mod-own');
    const bare = path.join(root, 'mod-bare', 'ui');
    for (const [dir, ver] of [[path.join(root, 'node_modules', '@playwright', 'test'), '1.64.1'], [path.join(mod, 'node_modules', '@playwright', 'test'), '1.61.1']] as const) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: '@playwright/test', version: ver, exports: { '.': './index.js', './cli': './cli.js', './package.json': './package.json' } }));
      fs.writeFileSync(path.join(dir, 'cli.js'), '');
      fs.writeFileSync(path.join(dir, 'index.js'), '');
    }
    fs.mkdirSync(bare, { recursive: true });
    expect(path.relative(root, playwrightCliFor(mod, root))).toBe(path.join('mod-own', 'node_modules', '@playwright', 'test', 'cli.js'));
    expect(path.relative(root, playwrightCliFor(bare, root))).toBe(path.join('node_modules', '@playwright', 'test', 'cli.js'));
    fs.rmSync(d, { recursive: true, force: true });
  });
});

describe('V125 Muster comparison', () => {
  const run = { typed: ['bnd-001'], kept_discovery: ['TCP.TI.002'], not_shown: [], defaulted: ['RR.1'], boundary: [{ question_id: 'bnd-001', decision: 'confirmed' }], pushed: 'manual-mission-plan-s1-2026-10-31T10-00-00-000Z.json, tenant-manifest-s1-2026-10-31T10-00-00-000Z.json' };
  const e4 = ['manual-mission-plan-s1-2026-10-30T09-00-00-000Z.json', 'tenant-manifest-s1-2026-10-30T09-00-00-000Z.json'];
  it('the push set compares with the <ts> suffix normalised; the not-sent clause only reports', () => {
    expect(normaliseFileName('cui-boundary-s1-2026-10-31T10-00-00-000Z.json')).toBe('cui-boundary-s1-<ts>.json');
    expect(comparePushSets(e4, pushedList(run.pushed)).pass).toBe(true);
    const c = compareMusterRun({ planCompare: { compared: 2, onlyApi: [], onlyScript: [], differing: [] }, twinPushed: e4, uiPushed: pushedList(run.pushed), run, notSent: ['PI.ODP.001', 'PI.ODP.002'], boundary: { ui_hash: 'a'.repeat(64), api_hash: 'a'.repeat(64) } });
    expect(Object.entries(c).filter(([, x]) => !x.pass)).toEqual([]);
    expect(c.e_not_sent.detail).toMatch(/2 answers-file row\(s\) the UI did not send \(PI\.ODP\.001; PI\.ODP\.002\); 1 defaulted/);
  });
  it('a plan difference, a different push set, nothing typed or a boundary hash difference fail', () => {
    const base = { planCompare: { compared: 2, onlyApi: [], onlyScript: [], differing: [] }, twinPushed: e4, uiPushed: pushedList(run.pushed), run, notSent: [], boundary: { ui_hash: null, api_hash: null } };
    expect(compareMusterRun({ ...base, planCompare: { compared: 2, onlyApi: [], onlyScript: [], differing: [{ name: 'manual-mission-plan-s1-<ts>.json', where: '$.tasks[0]' }] } }).a_plan.pass).toBe(false);
    expect(compareMusterRun({ ...base, uiPushed: [e4[0]] }).b_push_set.pass).toBe(false);
    expect(compareMusterRun({ ...base, run: { ...run, typed: [] } }).c_typed.pass).toBe(false);
    expect(compareMusterRun({ ...base, boundary: { ui_hash: 'a', api_hash: 'b' } }).d_boundary.pass).toBe(false);
  });
  it('writeCompileFiles writes the 200 body and refuses a name outside the folder', () => {
    const d = path.join(tmp(), 'plan');
    expect(writeCompileFiles(d, [{ name: 'a.json', content: '{}' }, { name: 'reports/b.docx', content: Buffer.from('x').toString('base64'), encoding: 'base64' }])).toEqual(['a.json', 'reports/b.docx']);
    expect(fs.readFileSync(path.join(d, 'reports', 'b.docx'), 'utf8')).toBe('x');
    expect(() => writeCompileFiles(d, [{ name: '../x.json', content: '' }])).toThrow(/outside the plan folder/);
  });
});

describe('the console runner (injected legs)', () => {
  const scenario = (surface: 'ao' | 'eo' | 'muster', requires?: string) => validateUiConsole({ type: 'ui-e2e', scenario_id: `s1-mach-${surface}-ui-e2e`, surface, sim_scenario: 's1-mach', stance: 'm365_azure', twin: 's1-mach-e2e', variants: [{ id: 'kit', base_path: '/app/', ...(requires ? { requires_built: requires } : {}) }], steps: [...UI_CONSOLE_STEPS[surface]] });
  const ws = (): { ws: string; pkg: string } => {
    const w = tmp();
    const out = path.join(w, 'out');
    fs.mkdirSync(path.join(out, 'plan'), { recursive: true });
    fs.writeFileSync(path.join(out, 'push-response.json'), '{"pushed":[]}');
    fs.writeFileSync(path.join(out, 'discovery-result.json'), '{}');
    fs.writeFileSync(path.join(out, 'sim-registry-record.json'), '{"kind":"sim"}'); // PH-6 R-UI: the twin's record snapshot
    return { ws: w, pkg: path.join(w, 'pkg') };
  };
  it('a missing twin makes every variant not run, with the missing files named; the record fails', async () => {
    const w = ws();
    const rec = await runUiConsole({ scenario: scenario('eo'), wsRoot: w.ws, packageRoot: w.pkg, watch: HEADLESS_MODE, log: () => undefined, deps: { heldPorts: async () => [] } });
    expect(rec.pass).toBe(false);
    expect(rec.variants[0].reason).toMatch(/missing ssp, snapshot, sim_store, db, eo_storage, review_plan$/);
    expect(fs.existsSync(path.join(w.ws, 'out', 'ui-e2e-eo.json'))).toBe(true);
  });
  it('a twin present and a leg that equals it writes a passing record with the clauses; a not-built kit is reported', async () => {
    const w = ws();
    const leg: ConsoleLeg = async () => ({ facts: { pushed: [] }, clauses: { a_plan: { pass: true, detail: 'ok' } }, files: { video: 'ui/muster/kit/playwright/v.webm' }, window: { started: 't0', ended: 't1' } });
    const rec = await runUiConsole({ scenario: scenario('muster'), wsRoot: w.ws, packageRoot: w.pkg, watch: HEADLESS_MODE, log: () => undefined, deps: { heldPorts: async () => [], legs: { muster: leg } } });
    expect(rec.pass).toBe(true);
    expect(rec.step_id).toBe('EU-MU');
    expect(rec.variants[0]).toMatchObject({ ran: true, pass: true, headed: false });
    const notBuilt = await runUiConsole({ scenario: scenario('muster', 'dist/index.html'), wsRoot: w.ws, packageRoot: w.pkg, watch: HEADLESS_MODE, log: () => undefined, deps: { heldPorts: async () => [], legs: { muster: leg }, exists: () => false } });
    expect(notBuilt.variants[0].reason).toMatch(/not built/);
    expect(notBuilt.pass).toBe(false); // nothing ran
    expect(consoleSkipReason({ id: 'kit', base_path: '/app/', requires_built: 'ui/dist/index.html' }, 'X', () => true)).toBeNull();
  });
  it('a held port refuses the run without killing anything; a throwing leg is recorded as failed', async () => {
    const w = ws();
    const held = await runUiConsole({ scenario: scenario('muster'), wsRoot: w.ws, packageRoot: w.pkg, watch: HEADLESS_MODE, log: () => undefined, deps: { heldPorts: async (p) => [p[0]] } });
    expect(held.variants[0].reason).toMatch(/ports in use: 4390/);
    const boom: ConsoleLeg = async () => { throw new Error('the spec exited 1'); };
    const r = await runUiConsole({ scenario: scenario('muster'), wsRoot: w.ws, packageRoot: w.pkg, watch: HEADLESS_MODE, log: () => undefined, deps: { heldPorts: async () => [], legs: { muster: boom } } });
    expect(r.variants[0]).toMatchObject({ ran: true, pass: false, error: 'the spec exited 1' });
    expect(consoleRecordPass(r.variants)).toBe(false);
  });
  it('readConsoleTwin names the twin files each surface needs', () => {
    const w = ws();
    const P = uiConsolePaths(w.ws, w.pkg, 's1-mach', 'muster');
    expect(readConsoleTwin(P, 'muster').missing).toEqual([]);
    expect(readConsoleTwin(P, 'ao').missing).toEqual(['e7a', 'sim_store', 'scenario']);
  });
  it('PH-6 R-UI (V123-V125): the record is the live one while it exists, else the twin snapshot; with neither, record is missing on every surface', () => {
    const w = ws();
    const P = uiConsolePaths(w.ws, w.pkg, 's1-mach', 'muster');
    expect(readConsoleTwin(P, 'muster').files.record).toBe(P.registryRecordSnapshot);
    fs.mkdirSync(path.dirname(P.registryRecord), { recursive: true });
    fs.writeFileSync(P.registryRecord, '{"kind":"sim"}');
    expect(readConsoleTwin(P, 'ao').files.record).toBe(P.registryRecord);
    fs.rmSync(P.registryRecord);
    fs.rmSync(P.registryRecordSnapshot);
    for (const s of ['ao', 'eo', 'muster'] as const) expect(readConsoleTwin(uiConsolePaths(w.ws, w.pkg, 's1-mach', s), s).missing).toContain('record');
  });
});
