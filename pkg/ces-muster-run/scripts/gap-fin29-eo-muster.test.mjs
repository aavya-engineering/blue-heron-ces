// FIN-29 (PH-2 harness): the EO and Muster checks of verify-fin29-eo-muster.mjs (V89, V119-V121, V128-V130).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  judgeV119, judgeV120, judgeV121, judgeV128, judgeV129, judgeV130, judgeV89, collectV89, deciderOf, v129MatrixGaps,
  V129_MATRIX, V121_CALLS, V121_COLLECTIONS, V128_ROUTES, CA_SELF_RECORD_TIER, CA_SELF_RECORD_UNMET, fin29EoMusterChecks,
} from './verify-fin29-eo-muster.mjs';

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const t = (s) => new Date(Date.parse('2026-10-31T10:00:00Z') + s * 1000).toISOString();

function contRecord(over = {}) {
  return {
    schema: 'ces-tester/eo-continuous@1', slug: 's1-mach', eo2: { up: true },
    private_root: { pl: 'out/e9/pl', copied: ['ces.db (online backup)', 'EvidenceCollector'] },
    real_db: { tenant_id: 'sim-tenant-s1-mach', before: { eo_assessments: 5 }, after: { eo_assessments: 5 }, changed: [] },
    status: { enabled: true, tenants: { 's1-mach': { lastTickAt: t(100) } } }, registered_tenants: ['s1-mach'],
    ticks: [
      { tickId: 'a1', tenantSlug: 's1-mach', at: t(0), mode: 'assess', assess: { ok: true, snapshotId: 'S0', drift: null } },
      { tickId: 'c1', tenantSlug: 's1-mach', at: t(40), mode: 'collect', notDue: [{ planId: 'C1', cadenceMinutes: 15, lastCollectedAt: t(0), nextDueAt: t(900) }], integrity: { newHashDrift: 1 } },
      { tickId: 'a2', tenantSlug: 's1-mach', at: t(70), mode: 'assess', assess: { ok: true, snapshotId: 'S1', drift: { previousSnapshotId: 'S0', drifted: [{ controlId: 'IA.L2-3.5.3', from: 'met', to: 'not_met' }] } } },
    ],
    notices: [{ kind: 'drift', tickId: 'a2', action: 'operator action: re-apply the setting through Stamper or AdminOps; EO never changes the tenant' }, { kind: 'hash_drift', tickId: 'c1' }],
    seed: { policy_id: 'p1', display_name: 'MFA', from: 'enabled', to: 'disabled', applied_at: t(30), reverted: true },
    sim_window: { started: t(30), ended: t(80), writes: 2, harness_writes: 2 },
    tamper: { item_id: 'eci-1', blob: 'pl/x.bin', index_status: 200, new_findings: [{ findingId: 'f1', checkId: 'HASH_DRIFT' }], eo_finding_ids: ['eoif-f1'], restored: true },
    ...over,
  };
}

const ticksDb = contRecord().ticks;
test('V119 passes on a complete record and names each failure', () => {
  const good = judgeV119({ rec: contRecord(), ticksDb });
  assert.equal(good.pass, true, good.detail);
  assert.match(judgeV119({ rec: contRecord(), ticksDb: null }).detail, /private ces.db/);
  assert.match(judgeV119({ rec: contRecord({ real_db: { before: { a: 1 }, after: { a: 2 }, changed: ['eo_assessments 1 -> 2'] } }), ticksDb }).detail, /wrote to the REAL pl\/ces.db/);
  assert.match(judgeV119({ rec: contRecord({ real_db: { before: null, after: null, changed: null } }), ticksDb }).detail, /not counted/);
  const noDrift = contRecord();
  noDrift.ticks[2].assess.drift.drifted = [];
  assert.match(judgeV119({ rec: noDrift }).detail, /found no drift/);
  assert.match(judgeV119({ rec: contRecord({ sim_window: { writes: 3, harness_writes: 2 } }) }).detail, /something wrote to the tenant/);
  assert.match(judgeV119({ rec: contRecord({ seed: { ...contRecord().seed, reverted: false } }) }).detail, /NOT reverted/);
  const badCad = contRecord();
  badCad.ticks[1].notDue[0].nextDueAt = t(20);
  assert.match(judgeV119({ rec: badCad }).detail, /cadence/);
  assert.match(judgeV119({ rec: contRecord({ status: { status: 503, body: 'collection scheduler is not configured' } }) }).detail, /slice not landed: FIN-24/);
  assert.match(judgeV119({ rec: null }).detail, /no out\/eo-continuous.json/);
  assert.equal(judgeV119({ rec: null, harness: 'mx' }).pass, true);
});

test('V120 judges the WORM list, the probe, live rows and the tamper leg', () => {
  const probe = { rows: [{ collection: 'ec_items', id: 'i', put: true, update: true, delete: true, intact: true }, { collection: 'ec_ledger_history', id: 'h', put: true, update: true, delete: true, intact: true }] };
  const base = { rec: contRecord(), worm: ['ec_items', 'ec_ledger_history'], probe, live: { items: [{ created_at: 'a', updated_at: 'a' }], history: [] }, integrityDb: [{ findingId: 'eoif-f1' }] };
  assert.equal(judgeV120(base).pass, true, judgeV120(base).detail);
  assert.match(judgeV120({ ...base, worm: ['ec_items'] }).detail, /slice not landed: FIN-24/);
  assert.match(judgeV120({ ...base, probe: { rows: [{ ...probe.rows[0], update: false }] } }).detail, /update NOT refused/);
  assert.match(judgeV120({ ...base, live: { items: [{ created_at: 'a', updated_at: 'b' }], history: [] } }).detail, /changed after they were written/);
  assert.match(judgeV120({ ...base, rec: contRecord({ tamper: { ...contRecord().tamper, restored: false } }) }).detail, /NOT restored/);
  assert.match(judgeV120({ ...base, rec: contRecord({ tamper: { ...contRecord().tamper, eo_finding_ids: [] } }) }).detail, /EO recorded no integrity finding/);
});

function engRecord(over = {}) {
  return {
    schema: 'ces-tester/muster-engagement@1', slug: 's1-mach', probe: { tenant_id: 'tp1', hil_item_id: 'h1' },
    calls: V121_CALLS.map((name) => ({ name, status: 200, want: '200', ok: true })), sprs: { muster: 80, eo: 80, snapshot_id: 's', requirements: 110 }, ...over,
  };
}
const msg = (kind) => {
  const m = { from: 'muster-noreply@ces.invalid', to: [], subject: 's', body: 'b', kind, source: { type: 'nudge_event', id: 'n1' }, transport: 'simulated', delivered: false };
  return { ...m, sha256: sha(JSON.stringify({ from: m.from, to: m.to, subject: m.subject, body: m.body, kind: m.kind, source: m.source })) };
};
test('V121 wants every call, rows in every collection, a simulated outbox and equal SPRS', () => {
  const rows = Object.fromEntries(V121_COLLECTIONS.map((c) => [c, [{ id: c === 'muster_hil_items' ? 'h1' : 'x', resolved_at: 'now' }]]));
  const outbox = [msg('nudge_manual'), msg('reassessment_due')];
  assert.equal(judgeV121({ rec: engRecord(), rows, outbox }).pass, true, judgeV121({ rec: engRecord(), rows, outbox }).detail);
  assert.match(judgeV121({ rec: engRecord({ sprs: { muster: 79, eo: 80 } }), rows, outbox }).detail, /SPRS route 79 != EO 80/);
  assert.match(judgeV121({ rec: engRecord(), rows, outbox: [{ ...msg('nudge_t3'), sha256: 'x' }] }).detail, /sha256 does not match/);
  assert.match(judgeV121({ rec: engRecord(), rows, outbox: [msg('nudge_t3')] }).detail, /reassessment_due/);
  assert.match(judgeV121({ rec: engRecord(), rows: { ...rows, muster_contracts: [] }, outbox }).detail, /muster_contracts/);
  assert.match(judgeV121({ rec: engRecord({ calls: [{ name: 'login', status: 500, ok: false, detail: { body: 'DATABASE_URL missing' } }] }), rows, outbox }).detail, /slice not landed: FIN-25/);
});

test('V128 accepts the "not run" training legs only on muster-partial', () => {
  const calls = V128_ROUTES.map((route) => ({ route, method: 'POST', status: 200, want: '200', ok: true }));
  assert.equal(judgeV128({ rec: { calls, eo_url: 'u', outbox: { note: 'n' } }, slug: 's1-mach', cont: contRecord() }).pass, true);
  const nr = calls.map((c) => (c.route.includes('training') ? { ...c, ok: false, status: null, note: 'not run here: no personnel record for muster-partial' } : c));
  assert.equal(judgeV128({ rec: { calls: nr, eo_url: 'u' }, slug: 'muster-partial', cont: contRecord() }).pass, true);
  assert.equal(judgeV128({ rec: { calls: nr, eo_url: 'u' }, slug: 's1-mach' }).pass, false);
  assert.match(judgeV128({ rec: { calls: calls.slice(1), eo_url: 'u' }, slug: 's1-mach' }).detail, /not called: \/api\/evidence-explorer\/capture/);
  assert.equal(judgeV128({ rec: { calls, eo_url: 'u', outbox: { note: 'n' } }, slug: 's1-mach', cont: contRecord() }).pass, true);
  assert.match(judgeV128({ rec: { calls, eo_url: 'u' }, slug: 's1-mach', cont: contRecord({ real_db: { before: { a: 1 }, after: { a: 3 }, changed: ['risk 1 -> 3'] } }) }).detail, /REAL pl\/ces.db/);
});

test('V129: deciders, matrix completeness, per-scenario agreement', () => {
  assert.equal(deciderOf(`${CA_SELF_RECORD_TIER}1 prior`), 'eo_records');
  assert.equal(deciderOf(`${CA_SELF_RECORD_UNMET} x`), 'eo_records_unmet');
  assert.equal(deciderOf('GD-b (document review of every objective; no stack source has an opinion) decides: x'), 'review');
  assert.equal(deciderOf('Store precedence (personnel store, ledger precedence): y'), 'store');
  assert.equal(deciderOf('Tier 2 (live read) decides: z; store precedence (training store) agrees'), 'tier2+store');
  assert.equal(deciderOf('Tier 3 (state-verified execution verdict) decides: q'), 'tier3');
  assert.equal(deciderOf('No source has an opinion (every source is unread or display-only)'), 'none');
  assert.deepEqual(v129MatrixGaps(), []);
  assert.equal(Object.keys(V129_MATRIX).length, 28);
  // a snapshot equal to the matrix's S1 column, each decided by its own path
  const why = { review: 'GD-b (document review) decides: x', store: 'Store precedence (personnel store): x', tier3: 'Tier 3 (state-verified execution verdict) decides: x', 'tier2+store': 'Tier 2 (live read) decides: x; store precedence (training store) agrees', eo_records: `${CA_SELF_RECORD_TIER}x` };
  const controls = Object.entries(V129_MATRIX).map(([id, m]) => {
    const status = [].concat(m.expect['s1-mach'])[0];
    return { control_id: id, status, statusRationale: status === 'not_assessed' ? 'No source has an opinion' : why[m.own[0]] };
  });
  const good = judgeV129({ snapshot: { controls }, slug: 's1-mach' });
  assert.equal(good.pass, true, good.detail);
  const moved = controls.map((c) => (c.control_id === 'PE.L2-3.10.2' ? { ...c, status: 'not_assessed', statusRationale: 'No source has an opinion' } : c));
  assert.match(judgeV129({ snapshot: { controls: moved }, slug: 's1-mach' }).detail, /PE.L2-3.10.2 not_assessed \(none\), predicted met/);
  const wrongPath = controls.map((c) => (c.control_id === 'PE.L1-3.10.1' ? { ...c, statusRationale: 'Tier 3 (state-verified execution verdict) decides: gate' } : c));
  assert.match(judgeV129({ snapshot: { controls: wrongPath }, slug: 's1-mach' }).detail, /not its own path/);
  const unwired = controls.map((c) => (c.control_id === 'CA.L2-3.12.1' ? { ...c, status: 'not_assessed', statusRationale: `${CA_SELF_RECORD_UNMET} x: the records were not supplied to the assessor` } : c));
  assert.match(judgeV129({ snapshot: { controls: unwired }, slug: 's1-mach' }).detail, /router wiring not landed/);
});

test('PL-120: AU.L2-3.3.8 not_met by Tier 1 is the pin on S3 and mp; on S1 / S2 it stays not_assessed', () => {
  const why = { review: 'GD-b (document review) decides: x', store: 'Store precedence (personnel store): x', tier1: 'Tier 1 (state-verified) decides: x', tier3: 'Tier 3 (state-verified execution verdict) decides: x', 'tier2+store': 'Tier 2 (live read) decides: x; store precedence (training store) agrees', eo_records: `${CA_SELF_RECORD_TIER}x`, eo_records_unmet: `${CA_SELF_RECORD_UNMET} x` };
  const column = (slug) => Object.entries(V129_MATRIX).map(([id, m]) => {
    const status = [].concat(m.expect[slug])[0];
    const dec = id === 'AU.L2-3.3.8' && status === 'not_met' ? 'tier1' : m.own[0];
    return { control_id: id, status, statusRationale: status === 'not_assessed' ? 'No source has an opinion' : why[dec] };
  });
  for (const slug of ['s3-def', 'muster-partial']) {
    const cs = column(slug);
    assert.equal(cs.find((c) => c.control_id === 'AU.L2-3.3.8').status, 'not_met');
    const r = judgeV129({ snapshot: { controls: cs }, slug });
    assert.doesNotMatch(r.detail, /AU\.L2-3\.3\.8 not_met \(tier1\), predicted/, slug);
    assert.doesNotMatch(r.detail, /AU\.L2-3\.3\.8 not_met decided by tier1/, slug);
  }
  const s1 = column('s1-mach').map((c) => (c.control_id === 'AU.L2-3.3.8' ? { ...c, status: 'not_met', statusRationale: why.tier1 } : c));
  assert.match(judgeV129({ snapshot: { controls: s1 }, slug: 's1-mach' }).detail, /AU\.L2-3\.3\.8 not_met \(tier1\), predicted not_assessed/);
});

test('V129 on a saved real snapshot: every decider is classified (no "other")', (t) => {
  const pkg = 'C:/ces-nb/out/eo-package';
  const dir = fs.existsSync(pkg) ? fs.readdirSync(pkg).sort().pop() : null;
  const f = dir ? path.join(pkg, dir, 'assessments', 'latest-snapshot.json') : null;
  if (!f || !fs.existsSync(f)) return t.skip('no saved snapshot');
  const s = JSON.parse(fs.readFileSync(f, 'utf8'));
  const other = s.controls.filter((c) => V129_MATRIX[c.control_id] && deciderOf(c.statusRationale) === 'other');
  assert.deepEqual(other.map((c) => c.control_id), []);
});

function surfRecord(over = {}) {
  return {
    schema: 'ces-tester/muster-surfaces@1',
    discovery: { run_status: 202, status: 'done', envelope_sha256: 'e'.repeat(64), live_refused_status: 403 },
    harvest: { status: 200, facts: 12, token_refused_status: 403 },
    collector_kit: { rc: 0, sha256: 'k'.repeat(64), file_sha256: 'k'.repeat(64), header_sha256: 'k'.repeat(64), manifest_rc: 0, manifest_sha256: 'k'.repeat(64) },
    recipe: { rc: 0, facts: { facts: [{ question_id: 'iam-001', answer: 'yes', provenance: 'captured' }] }, expected_answer: 'yes', no_concierge_rc: 1 },
    imports: v130Imports(),
    not_run_here: [{ surface: 'collector-kit results import (muster-results.json)' }, { surface: 'readiness file import through the SPA import button' }], ...over,
  };
}
// P12-MU: the E9M imports block (ces-tester muster-e2e-run.ts runV130Imports).
function v130Imports(over = {}) {
  return {
    readiness_import: { route: 'POST /api/plan/compile (E3)', e3_http_status: 200, e3_files: 64, disc_file: 'discovery-result.json', disc_sha256: 'd'.repeat(64), disc_schema_version: 'readiness-result/1.1.0', disc_observations: 295, plan_readiness_file: 'readiness-result-s1-mach.json' },
    refusals: [
      { name: 'collector-kit results file', probe_slug: 'v130-import-probe', status: 422, error: 'plan compile failed', import_failed: true, detail_head: 'Import failed: not a readiness-result payload' },
      { name: 'schema-invalid readiness file', probe_slug: 'v130-import-probe', status: 422, error: 'plan compile failed', import_failed: true, detail_head: 'Import failed: the payload does not validate' },
    ],
    ai: { gate: 'off', adaptive_status: 503, adaptive_degraded: true, coach_status: 503, coach_degraded: true, retro_status: 200, retro_all_low: true },
    ...over,
  };
}
test('V130 judges discovery, harvest, kit and recipe, and their refusals', () => {
  assert.equal(judgeV130({ rec: surfRecord() }).pass, true, judgeV130({ rec: surfRecord() }).detail);
  assert.match(judgeV130({ rec: surfRecord({ discovery: { ...surfRecord().discovery, live_refused_status: 202 } }) }).detail, /live: true was not refused/);
  assert.match(judgeV130({ rec: surfRecord({ harvest: { status: 200, facts: 3, token_refused_status: 200 } }) }).detail, /bare access token/);
  assert.match(judgeV130({ rec: surfRecord({ collector_kit: { ...surfRecord().collector_kit, manifest_sha256: 'x' } }) }).detail, /manifest/);
  assert.match(judgeV130({ rec: surfRecord({ recipe: { ...surfRecord().recipe, expected_answer: 'no' } }) }).detail, /the sim's policies say no/);
  assert.match(judgeV130({ rec: surfRecord({ recipe: { ...surfRecord().recipe, no_concierge_rc: 0 } }) }).detail, /self-serve/);
});

test('V130 (P12-MU) judges the readiness-file import, the compile refusals and the AI gate', () => {
  const ok = judgeV130({ rec: surfRecord() });
  assert.equal(ok.pass, true, ok.detail);
  assert.match(ok.detail, /readiness-file import through POST \/api\/plan\/compile \(E3 HTTP 200, 64 file/);
  assert.match(ok.detail, /AI gate off/);
  assert.match(ok.detail, /not run here: collector-kit results import/);
  const noBlock = judgeV130({ rec: surfRecord({ imports: undefined }) });
  assert.equal(noBlock.pass, false);
  assert.match(noBlock.detail, /no imports block/);
  const ingested = v130Imports({ refusals: [{ ...v130Imports().refusals[0], status: 200, import_failed: false }, v130Imports().refusals[1]] });
  assert.match(judgeV130({ rec: surfRecord({ imports: ingested }) }).detail, /collector-kit results file: compile HTTP 200/);
  const noE3 = v130Imports({ readiness_import: { ...v130Imports().readiness_import, e3_http_status: 422, e3_files: 0 } });
  assert.match(judgeV130({ rec: surfRecord({ imports: noE3 }) }).detail, /E3 compile HTTP 422/);
  const unclear = v130Imports({ ai: { ...v130Imports().ai, gate: 'unclear', coach_status: 500 } });
  assert.match(judgeV130({ rec: surfRecord({ imports: unclear }) }).detail, /AI gate unclear/);
  const on = judgeV130({ rec: surfRecord({ imports: v130Imports({ ai: { gate: 'on', adaptive_status: 400, coach_status: 400 } }) }) });
  assert.equal(on.pass, true, on.detail);
  assert.match(on.detail, /no model call/);
});

test('V89 finds Postgres strings and stray database files in the run roots', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v89-'));
  const ces = path.join(root, 'ces');
  fs.mkdirSync(path.join(root, 'out', 'logs'), { recursive: true });
  fs.mkdirSync(path.join(root, 'pl'), { recursive: true });
  fs.mkdirSync(path.join(ces, 'ces-muster', 'muster-api'), { recursive: true });
  fs.writeFileSync(path.join(root, 'pl', 'ces.db'), 'x');
  fs.writeFileSync(path.join(root, 'out', 'logs', 'a.out'), 'ok');
  const listFiles = (d) => fs.readdirSync(d, { recursive: true }).map((f) => path.join(d, f)).filter((f) => fs.statSync(f).isFile());
  assert.equal(judgeV89({ c: collectV89({ root, ces, listFiles }) }).pass, true);
  fs.writeFileSync(path.join(root, 'out', 'logs', 'b.out'), 'url postgresql://u:p@h/db');
  fs.writeFileSync(path.join(root, 'out', 'legacy.sqlite'), 'x');
  const r = judgeV89({ c: collectV89({ root, ces, listFiles }) });
  assert.match(r.detail, /Postgres connection string in out\/logs\/b.out/);
  assert.match(r.detail, /out\/legacy.sqlite/);
  fs.mkdirSync(path.join(ces, 'ces-muster', 'muster-api', 'prisma'));
  assert.match(judgeV89({ c: collectV89({ root, ces, listFiles }) }).detail, /slice not landed: FIN-25/);
});

test('fin29EoMusterChecks returns all seven rows and never throws', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v119-'));
  fs.mkdirSync(path.join(root, 'out'), { recursive: true });
  const rows = await fin29EoMusterChecks({
    root, out: path.join(root, 'out'), ces: path.join(root, 'ces'), slug: 's1-mach', harness: 'tester', steps: {},
    readJson: (f) => JSON.parse(fs.readFileSync(f, 'utf8')), exists: (f) => fs.existsSync(f), staleOf: () => null,
    listFiles: () => [], db: () => null, snapshot: null,
  });
  assert.deepEqual(rows.map((r) => r.id), ['V89', 'V119', 'V120', 'V121', 'V128', 'V129', 'V130']);
  assert.ok(rows.every((r) => typeof r.detail === 'string'));
});

test('V120 probe on a fresh repository with the built ces-shared (skips when that dist predates FIN-24)', async (t) => {
  const { collectV120Probe } = await import('./verify-fin29-eo-muster.mjs');
  const { fileURLToPath, pathToFileURL } = await import('node:url');
  const cesRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'ces');
  const distFile = path.join(cesRoot, 'ces-shared', 'dist', 'persistence', 'CesRepository.js');
  if (!fs.existsSync(distFile)) return t.skip('no ces-shared dist');
  const mod = await import(pathToFileURL(distFile).href);
  if (!mod.DEFAULT_WORM_COLLECTIONS.includes('ec_items')) return t.skip('ces-shared dist predates FIN-24 (rebuild)');
  const { createRequire } = await import('node:module');
  const Database = createRequire(path.join(cesRoot, 'package.json'))('better-sqlite3');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v120-'));
  const dbFile = path.join(dir, 'ces.db');
  const live = new mod.CesRepository(dbFile);
  live.put('ec_items', { id: 'eci-1', ces: { tenantSlug: 's1-mach' }, data: { itemId: 'eci-1', sha256: 'a' } });
  live.put('ec_ledger_history', { id: 'h-1', ces: { tenantSlug: 's1-mach' }, data: { path: 'x', sha256: 'a' } });
  live.close();
  const db = new Database(dbFile, { readonly: true });
  const p = await collectV120Probe({ db, cesRoot, slug: 's1-mach' });
  db.close();
  assert.equal(p.rows.length, 2);
  assert.ok(p.rows.every((r) => r.put && r.update && r.delete && r.intact), JSON.stringify(p.rows));
});
