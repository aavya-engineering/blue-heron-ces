// FIN-29 (Blue Heron Defense, CES team; finishing plan PH-2 harness): the EO and Muster checks V89, V119, V120, V121,
// V128, V129, V130 (FINISH-PLAN.md §1.3; V89 GAP-CLOSURE-PLAN.md §5). Called by verify-fin29.mjs (the hub) with vctx.
// The records are written by ces-tester src/flow/fin29-eo-muster.ts:
//   step E9E -> out/eo-continuous.json (V119, V120), out/eo-routes.json (V128)
//   step E9M -> out/muster-engagement.json (V121), out/muster-surfaces.json (V130)
// Judges are pure (inputs passed in); fin29EoMusterChecks does the reading. A producer slice that has not landed reads
// "slice not landed: <what>" in the detail, never an exception.
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

export const SCHEMAS = {
  eoContinuous: 'ces-tester/eo-continuous@1',
  eoRoutes: 'ces-tester/eo-routes@1',
  musterEngagement: 'ces-tester/muster-engagement@1',
  musterSurfaces: 'ces-tester/muster-surfaces@1',
};
export const FILES = {
  eoContinuous: 'eo-continuous.json',
  eoRoutes: 'eo-routes.json',
  musterEngagement: 'muster-engagement.json',
  musterSurfaces: 'muster-surfaces.json',
};
const ms = (v) => Date.parse(String(v ?? ''));
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const notTester = (harness, what) => (harness !== 'tester' ? { pass: true, detail: `not run here: ${what} is a ces-tester step (mx-e2e.ps1 -Harness tester); this run used the ${harness} harness` } : null);
const recordGate = (rec, stale, file, step) => {
  if (!rec) return `no out/${file} (step ${step} did not run or did not write it)`;
  if (stale) return stale;
  return null;
};
// E9E runs on a private pipeline root (out/e9/pl); the scenario tenant's rows in the REAL pl/ces.db must not change.
// cont: out/eo-continuous.json. Returns a reason or null.
export function realDbGate(cont) {
  const r = cont?.real_db;
  if (!r) return 'E9E recorded no real-ces.db row counts (real_db)';
  if (!r.before || !r.after) return `the real ces.db was not counted (${r.before ? 'after' : 'before'} missing)`;
  if (!Array.isArray(r.changed)) return 'the real ces.db count comparison is missing';
  if (r.changed.length) return `E9E wrote to the REAL pl/ces.db for this tenant: ${r.changed.join(', ')}`;
  if (!cont.private_root?.copied?.includes('ces.db (online backup)')) return 'E9E did not run on its private pipeline root (no ces.db backup recorded)';
  return null;
}

// ---------- V119: continuous collection (FIN-24) ----------
// rec: out/eo-continuous.json; ticksDb / noticesDb: this tenant's eo_collection_ticks / eo_collection_notices rows
// (ces.db, parsed data) or null.
export function judgeV119({ rec = null, stale = null, harness = 'tester', ticksDb = null, noticesDb = null }) {
  const nt = notTester(harness, 'E9E');
  if (nt) return nt;
  const gate = recordGate(rec, stale, FILES.eoContinuous, 'E9E');
  if (gate) return { pass: false, detail: gate };
  if (rec.schema !== SCHEMAS.eoContinuous) return { pass: false, detail: `schema ${rec.schema}` };
  const problems = [];
  const notes = [];
  const real = realDbGate(rec);
  if (real) problems.push(real);
  if (!rec.eo2?.up) problems.push('the second EO did not come up');
  const statusErr = rec.status && typeof rec.status === 'object' && rec.status.status === 503;
  if (statusErr || /not configured/i.test(JSON.stringify(rec.status ?? ''))) return { pass: false, detail: `slice not landed: FIN-24 collection scheduler (GET /api/collect/schedule answered ${JSON.stringify(rec.status).slice(0, 160)})` };
  if (rec.error) problems.push(`E9E: ${rec.error}`);
  const ticks = Array.isArray(rec.ticks) ? rec.ticks : [];
  const mine = ticks.filter((t) => t.tenantSlug === rec.slug);
  // (a) at least one tick per registered tenant (the scheduler's own status lists every tenant it ticked).
  const reg = Array.isArray(rec.registered_tenants) ? rec.registered_tenants : [];
  if (!reg.includes(rec.slug)) problems.push(`(a) the scheduler's status lists no tick for ${rec.slug} (tenants: ${reg.join(', ') || 'none'})`);
  const tenants = rec.status?.tenants ?? {};
  const untick = reg.filter((s) => !tenants[s]?.lastTickAt);
  if (untick.length) problems.push(`(a) registered tenant(s) with no tick: ${untick.join(', ')}`);
  // (b) assess ticks: the first one wrote a snapshot.
  const assess = mine.filter((t) => t.mode === 'assess').sort((x, y) => ms(x.at) - ms(y.at));
  if (!assess.length) problems.push('(b) no assess tick for this tenant');
  else if (!assess[0].assess?.ok || !assess[0].assess?.snapshotId) problems.push(`(b) the first assess tick wrote no snapshot (${assess[0].assess?.error ?? 'no snapshotId'})`);
  // (c) collect ticks: collectors run only when due; every not-due collector's next due time is after the tick.
  const collect = mine.filter((t) => t.mode === 'collect');
  const badDue = [];
  for (const t of collect) {
    for (const n of t.notDue ?? []) {
      const next = ms(n.nextDueAt);
      const last = ms(n.lastCollectedAt);
      if (!(next > ms(t.at))) badDue.push(`${t.tickId}: ${n.planId} listed not due but due at ${n.nextDueAt}`);
      if (Number.isFinite(last) && Number.isFinite(next) && Math.abs(next - last - Number(n.cadenceMinutes) * 60000) > 60000) badDue.push(`${t.tickId}: ${n.planId} next due ${n.nextDueAt} is not last ${n.lastCollectedAt} + ${n.cadenceMinutes} min`);
    }
  }
  if (badDue.length) problems.push(`(c) cadence: ${badDue.slice(0, 3).join('; ')}`);
  if (!collect.length) notes.push('no collect tick between the assess ticks');
  // (d) drift seeded between ticks is detected by the next assess tick, with a drift notice.
  if (!rec.seed) problems.push(`(d) no drift seed (${rec.seed_note ?? 'none chosen'})`);
  else {
    if (rec.seed.apply_error) problems.push(`(d) the seed write failed: ${rec.seed.apply_error}`);
    if (!rec.seed.reverted) problems.push(`(d) the seed was NOT reverted (${rec.seed.revert_error ?? 'no revert'}): the sim still has policy ${rec.seed.policy_id} ${rec.seed.to}`);
    const later = assess.filter((t) => ms(t.at) >= ms(rec.seed.applied_at));
    const prev = assess.filter((t) => ms(t.at) < ms(rec.seed.applied_at)).pop();
    const hit = later.find((t) => (t.assess?.drift?.drifted ?? []).length > 0);
    if (!later.length) problems.push('(d) no assess tick after the seed');
    else if (!hit) problems.push(`(d) the assess tick after the seed found no drift (seeded: policy ${rec.seed.display_name ?? rec.seed.policy_id} ${rec.seed.from} -> ${rec.seed.to})`);
    else {
      if (prev && hit.assess.drift.previousSnapshotId !== prev.assess?.snapshotId) notes.push(`drift baseline ${hit.assess.drift.previousSnapshotId} is not the previous tick's snapshot ${prev.assess?.snapshotId}`);
      const notices = [...(rec.notices ?? []), ...(noticesDb ?? [])];
      const n = notices.find((x) => x.kind === 'drift' && x.tickId === hit.tickId);
      if (!n) problems.push(`(d) no drift notice for tick ${hit.tickId}`);
      else if (!/Stamper or AdminOps/i.test(n.action ?? '')) problems.push('(d) the drift notice names no operator action (no silent auto-fix)');
      notes.push(`drifted ${hit.assess.drift.drifted.map((x) => `${x.controlId} ${x.from}->${x.to}`).join(', ')}`);
    }
  }
  // (e) no silent auto-fix: the only sim writes in the window are the harness's seed and revert.
  const w = rec.sim_window ?? {};
  if (w.writes === null || w.writes === undefined) problems.push(`(e) sim ledger not read (${w.error ?? 'no count'})`);
  else if (w.writes > w.harness_writes) problems.push(`(e) ${w.writes} sim write(s) in the window, the harness made ${w.harness_writes}: something wrote to the tenant`);
  // The private ces.db (out/e9/pl/ces.db) mirrors the tick records (write-once collection).
  if (ticksDb === null) problems.push('the private ces.db (out/e9/pl/ces.db) is not readable');
  else if (!mine.every((t) => ticksDb.some((r) => r.tickId === t.tickId))) problems.push('tick records missing from the private ces.db eo_collection_ticks');
  if (problems.length) return { pass: false, detail: problems.join('; ') };
  return { pass: true, detail: `scheduler ticked ${reg.length} registered tenant(s); ${mine.length} tick(s) for ${rec.slug} (${assess.length} assess, ${collect.length} collect, cadence consistent); first assess snapshot ${assess[0].assess.snapshotId}; ${notes.join('; ')}; drift notice raised; sim writes in window ${w.writes} = the harness's seed and revert (no auto-fix); private pipeline root, real ces.db unchanged for this tenant` };
}

// ---------- V120: EC write-once and HASH_DRIFT (FIN-24) ----------
// worm: the built ces-shared DEFAULT_WORM_COLLECTIONS (or null); probe: collectV120Probe's result; live: { items, history }
// rows of this tenant ({ created_at, updated_at }) or null; integrityDb: eo_integrity_findings rows of the tenant or null.
export function judgeV120({ rec = null, stale = null, harness = 'tester', worm = null, probe = null, live = null, integrityDb = null }) {
  const problems = [];
  const parts = [];
  if (!worm) problems.push('ces-shared dist not readable (DEFAULT_WORM_COLLECTIONS)');
  else {
    const miss = ['ec_items', 'ec_ledger_history'].filter((c) => !worm.includes(c));
    if (miss.length) return { pass: false, detail: `slice not landed: FIN-24 write-once EC (DEFAULT_WORM_COLLECTIONS lacks ${miss.join(', ')}; ces-shared rebuilt?)` };
  }
  if (!probe || probe.error) problems.push(`overwrite probe not run (${probe?.error ?? 'no probe'})`);
  else {
    for (const p of probe.rows) {
      const allowed = ['put', 'update', 'delete'].filter((k) => p[k] !== true);
      if (allowed.length) problems.push(`${p.collection} ${p.id}: ${allowed.join(', ')} NOT refused (CesWormError)`);
      if (!p.intact) problems.push(`${p.collection} ${p.id} changed by the probe`);
    }
    if (!probe.rows.length) problems.push('no ec_items / ec_ledger_history row of this tenant to probe');
    else parts.push(`overwrite probe on a fresh repository refused put, update and delete for ${probe.rows.map((p) => p.collection).join(' and ')}`);
  }
  if (live) {
    const changed = [...live.items, ...live.history].filter((r) => r.created_at !== r.updated_at);
    if (changed.length) problems.push(`${changed.length} EC write-once row(s) changed after they were written (created_at != updated_at)`);
    else parts.push(`${live.items.length} item and ${live.history.length} ledger-history row(s) unchanged since written`);
  }
  const nt = notTester(harness, 'E9E (the tamper leg)');
  if (nt) parts.push(nt.detail);
  else {
    const gate = recordGate(rec, stale, FILES.eoContinuous, 'E9E') ?? realDbGate(rec);
    if (gate) problems.push(gate);
    else {
      const t = rec.tamper ?? {};
      if (!t.item_id) problems.push(`tamper: ${t.note ?? 'no EC item'}`);
      else {
        if (t.index_status !== 200) problems.push(`tamper: EC index pass HTTP ${t.index_status}`);
        const hd = (t.new_findings ?? []).filter((f) => f.checkId === 'HASH_DRIFT');
        if (!hd.length) problems.push('tamper: EC raised no HASH_DRIFT finding for the changed blob');
        if (!(t.eo_finding_ids ?? []).length) problems.push('tamper: EO recorded no integrity finding for the HASH_DRIFT (GET /api/collect/integrity)');
        else if (integrityDb === null) problems.push('tamper: the private ces.db (out/e9/pl/ces.db) is not readable');
        else if (!t.eo_finding_ids.every((id) => integrityDb.some((r) => r.findingId === id))) problems.push('tamper: the EO integrity finding is not in the private ces.db eo_integrity_findings');
        const notice = (rec.notices ?? []).find((n) => n.kind === 'hash_drift');
        if (!notice) problems.push('tamper: no hash_drift notice');
        if (!t.restored) problems.push(`tamper: the blob bytes were NOT restored (${t.blob})`);
        if (!problems.length) parts.push(`tampered ${t.blob}: EC HASH_DRIFT ${hd.map((f) => f.findingId).join(', ')} -> EO integrity finding ${t.eo_finding_ids.join(', ')} and a hash_drift notice; bytes restored`);
      }
    }
  }
  if (problems.length) return { pass: false, detail: problems.join('; ') };
  return { pass: true, detail: parts.join('; ') };
}

/** Copies this tenant's newest ec_items and ec_ledger_history rows into a FRESH in-memory repository (built ces-shared)
 * and tries to overwrite each: put over the id, update, delete must each throw CesWormError. The live ces.db is only read. */
export async function collectV120Probe({ db, cesRoot, slug }) {
  if (!db) return { error: 'ces.db not readable' };
  const f = path.join(cesRoot, 'ces-shared', 'dist', 'persistence', 'CesRepository.js');
  if (!fs.existsSync(f)) return { error: `no ${f}` };
  const mod = await import(pathToFileURL(f).href);
  const repo = new mod.CesRepository(':memory:');
  try {
    const rows = [];
    for (const coll of ['ec_items', 'ec_ledger_history']) {
      const r = db.prepare('SELECT id, tenant_slug, data FROM ces_records WHERE collection = ? AND tenant_slug = ? ORDER BY created_at DESC LIMIT 1').get(coll, slug);
      if (!r) continue;
      const scope = { tenantSlug: slug };
      const data = JSON.parse(r.data);
      repo.put(coll, { id: r.id, ces: scope, data });
      const refused = (fn) => { try { fn(); return false; } catch (e) { return e?.name === 'CesWormError'; } };
      const p = {
        collection: coll, id: r.id,
        put: refused(() => repo.put(coll, { id: r.id, ces: scope, data: { tampered: 'V120 probe' } })),
        update: refused(() => repo.update(coll, r.id, scope, { tampered: 'V120 probe' })),
        delete: refused(() => repo.delete(coll, r.id, scope)),
      };
      p.intact = JSON.stringify(repo.get(coll, r.id, scope)?.data ?? null) === JSON.stringify(data);
      rows.push(p);
    }
    return { rows, worm: Array.isArray(mod.DEFAULT_WORM_COLLECTIONS) ? [...mod.DEFAULT_WORM_COLLECTIONS] : null };
  } finally {
    repo.close?.();
  }
}

// ---------- V121: Muster's engagement layer on ces.db (FIN-25) ----------
export const V121_CALLS = ['login', 'me', 'engagement create', 'party create', 'session sync', 'session read', 'hil flag', 'hil queue', 'hil resolve', 'contract create', 'contract read', 'contract update', 'party action send-nudge-now', 'touch event', 'touch report', 'nudge tick', 'reassessment tick', 'delivery artifact', 'delivery grant', 'sprs score'];
export const V121_COLLECTIONS = ['muster_tenants', 'muster_users', 'muster_engagements', 'muster_parties', 'muster_interview_sessions', 'muster_contracts', 'muster_hil_items', 'muster_touch_events', 'muster_delivery_artifacts', 'muster_delivery_grants'];
// rows: { [collection]: data[] } of the probe tenant (ces.db, tenant_id = probe tenant) or null; outbox: muster_mail_outbox data[].
export function judgeV121({ rec = null, stale = null, harness = 'tester', rows = null, outbox = null, prismaDirPresent = false }) {
  const nt = notTester(harness, 'E9M');
  if (nt) return nt;
  const gate = recordGate(rec, stale, FILES.musterEngagement, 'E9M');
  if (gate) return { pass: false, detail: gate };
  const problems = [];
  if (rec.schema !== SCHEMAS.musterEngagement) problems.push(`schema ${rec.schema}`);
  const login = (rec.calls ?? []).find((c) => c.name === 'login');
  if (!login || (login.status === 500 && /DATABASE_URL|prisma|postgres/i.test(JSON.stringify(login.detail ?? '')))) return { pass: false, detail: `slice not landed: FIN-25 engagement layer on ces.db (login ${login?.status ?? 'not called'}${rec.error ? `; ${rec.error}` : ''})` };
  if (rec.error) problems.push(`E9M: ${rec.error}`);
  const byName = new Map((rec.calls ?? []).map((c) => [c.name, c]));
  const missing = V121_CALLS.filter((n) => !byName.has(n));
  const bad = (rec.calls ?? []).filter((c) => !c.ok);
  if (missing.length) problems.push(`not called: ${missing.join(', ')}`);
  if (bad.length) problems.push(`failed: ${bad.map((c) => `${c.name} HTTP ${c.status ?? 'none'} (want ${c.want})${c.note ? ` ${c.note}` : ''}`).join('; ')}`);
  if (rec.sprs?.muster === null || rec.sprs?.eo === null || rec.sprs?.muster !== rec.sprs?.eo) problems.push(`SPRS route ${rec.sprs?.muster} != EO ${rec.sprs?.eo} (snapshot ${rec.sprs?.snapshot_id}, ${rec.sprs?.requirements} requirement(s))`);
  if (!rows) problems.push('ces.db not readable');
  else {
    const empty = V121_COLLECTIONS.filter((c) => !(rows[c] ?? []).length);
    if (empty.length) problems.push(`no ces.db row under the probe tenant in ${empty.join(', ')}`);
    const hil = (rows.muster_hil_items ?? []).find((h) => h.id === rec.probe?.hil_item_id);
    if (rec.probe?.hil_item_id && hil && !(hil.resolved_at || hil.status === 'resolved' || hil.resolved === true)) problems.push('the HIL item is not resolved in ces.db');
  }
  const ob = outbox ?? [];
  if (outbox === null) problems.push('muster_mail_outbox not readable');
  else if (!ob.length) problems.push('no message in the simulated mail outbox (muster_mail_outbox) for the probe tenant');
  else {
    const notSim = ob.filter((m) => m.transport !== 'simulated' || m.delivered !== false);
    if (notSim.length) problems.push(`${notSim.length} outbox message(s) not simulated/undelivered`);
    const badHash = ob.filter((m) => m.sha256 !== sha256(JSON.stringify({ from: m.from, to: m.to, subject: m.subject, body: m.body, kind: m.kind, source: m.source })));
    if (badHash.length) problems.push(`${badHash.length} outbox message(s) whose sha256 does not match the message`);
    const kinds = new Set(ob.map((m) => m.kind));
    if (![...kinds].some((k) => String(k).startsWith('nudge_'))) problems.push('no nudge message in the outbox');
    if (!kinds.has('reassessment_due')) problems.push('no reassessment_due reminder in the outbox');
  }
  if (prismaDirPresent) problems.push('muster-api/prisma/ still present');
  if (problems.length) return { pass: false, detail: problems.join('; ') };
  return { pass: true, detail: `probe tenant ${rec.probe.tenant_id}: ${rec.calls.length} calls ok (login, engagement, party, session sync, HIL flag and resolve, contracts, party action, touch, nudge and reassessment ticks, delivery grant); rows in ${V121_COLLECTIONS.length} ces.db collections; outbox ${ob.length} simulated message(s) (${[...new Set(ob.map((m) => m.kind))].join(', ')}), hashes verified; SPRS route ${rec.sprs.muster} = EO ${rec.sprs.eo}` };
}

// ---------- V128: EO extra routes ----------
export const V128_ROUTES = ['/api/evidence-explorer/capture', '/api/collect', '/api/policies/import', '/api/risk-assessment/ingest', '/api/risk-assessment/auto-score', '/api/risk-assessment/annual-review/one-click', '/api/risk-assessment/render/report', '/api/personnel/:id/training/email', '/api/personnel/:id/training/certificate', '/api/screening/element6-form'];
export function judgeV128({ rec = null, stale = null, harness = 'tester', slug = '', cont = null }) {
  const nt = notTester(harness, 'E9E');
  if (nt) return nt;
  const gate = recordGate(rec, stale, FILES.eoRoutes, 'E9E');
  if (gate) return { pass: false, detail: gate };
  if (rec.error && !(rec.calls ?? []).length) return { pass: false, detail: rec.error };
  const problems = [];
  const real = realDbGate(cont);
  if (real) problems.push(real);
  const by = new Map((rec.calls ?? []).map((c) => [c.route, c]));
  const missing = V128_ROUTES.filter((r) => !by.has(r));
  if (missing.length) problems.push(`not called: ${missing.join(', ')}`);
  const notRun = (rec.calls ?? []).filter((c) => !c.ok && /^not run here/.test(c.note ?? ''));
  // PH-5 (R-EO diff B): muster-partial and s3-def have no records catalog (no personnel): the training legs are "not run"
  // there and nowhere else.
  const notRunBad = notRun.filter(() => !['muster-partial', 's3-def'].includes(slug));
  if (notRunBad.length) problems.push(`not run: ${notRunBad.map((c) => `${c.route} (${c.note})`).join('; ')}`);
  const bad = (rec.calls ?? []).filter((c) => !c.ok && !/^not run here/.test(c.note ?? ''));
  if (bad.length) problems.push(bad.map((c) => `${c.method} ${c.route} HTTP ${c.status ?? 'none'} (want ${c.want})${c.note ? ` ${c.note}` : ''}${c.detail?.body ? `: ${String(c.detail.body).slice(0, 100)}` : ''}`).join('; '));
  if (problems.length) return { pass: false, detail: problems.join('; ') };
  return { pass: true, detail: `${rec.calls.length - notRun.length} route call(s) ok on ${rec.eo_url} (manual capture, collect, idempotent policy re-import, risk ingest / auto-score / annual review / render, training email and certificate, screening PDF)${notRun.length ? `; ${notRun.length} not run (${notRun[0].note})` : ''}; outbox: ${rec.outbox?.note ?? 'n/a'}` };
}

// ---------- V129: the non-stack coverage matrix (AUDIT-NONSTACK.md §1/§3) ----------
// FIN-27's exact rationale strings (ces-eo ControlAssessor.ts CA_SELF_RECORD_TIER / CA_SELF_RECORD_UNMET).
export const CA_SELF_RECORD_TIER = "Tier 3 (EO's own assessment and POA&M records) decides: eo_assessment/exists: ";
export const CA_SELF_RECORD_UNMET = "not_assessed: EO's own assessment and POA&M records do not yet show";
/** The decider of a snapshot control, from its statusRationale. */
export function deciderOf(rationale) {
  const r = String(rationale ?? '');
  if (r.startsWith(CA_SELF_RECORD_TIER)) return 'eo_records';
  if (r.startsWith(CA_SELF_RECORD_UNMET)) return 'eo_records_unmet';
  if (/^GD-b\b/.test(r)) return 'review';
  if (/^Store precedence/i.test(r)) return 'store';
  const t = /^Tier (\d)/.exec(r);
  if (t) return /store precedence[^;]*agrees/i.test(r) ? `tier${t[1]}+store` : `tier${t[1]}`;
  if (/pending[_ ]review/i.test(r)) return 'gate_pending';
  if (/No source has an opinion|^not_assessed/i.test(r)) return 'none';
  return 'other';
}
const ALL = ['s1-mach', 's2-eng', 's3-def', 'muster-partial'];
const st = (s1, s2, s3, mp) => ({ 's1-mach': s1, 's2-eng': s2, 's3-def': s3, 'muster-partial': mp });
const NA = 'not_assessed';
/**
 * The pinned matrix (prediction for R-F2, with FIN-10, FIN-26, FIN-27 and the FD-17 customer files). Per control:
 *   own: the deciders that are this control's own path (a met or not_met decided by anything else is red);
 *   expect: the status per scenario (an array = any of these; FIN-26 / FIN-27 moves still pending);
 *   reason: the D-4-style reason when a side (met, or not_met / not_assessed) is reached in no scenario.
 */
export const V129_MATRIX = {
  'AT.L2-3.2.1': { own: ['tier2+store', 'tier2', 'store'], expect: st('met', 'met', 'not_met', NA) },
  'AT.L2-3.2.2': { own: ['review', 'store'], expect: st([NA, 'met'], [NA, 'met'], 'not_met', NA), reason: 'met only once FIN-26 lets the training store decide the role population (FD-9); until then no scenario reaches met' },
  'AT.L2-3.2.3': { own: ['tier2+store', 'tier2', 'store'], expect: st('met', 'met', 'not_met', NA) },
  'AU.L2-3.3.8': { own: ['review'], expect: st(NA, NA, NA, NA), reason: 'D-4: objective [b] has nothing reviewable in any synthetic customer file, so no scenario reaches met' },
  'AU.L2-3.3.9': { own: ['review'], expect: st('met', 'met', NA, NA) },
  'IR.L2-3.6.2': { own: ['review'], expect: st(NA, NA, NA, NA), reason: 'D-4: objective [e] (authority report records) has nothing reviewable in any synthetic customer file, so no scenario reaches met' },
  'IR.L2-3.6.3': { own: ['review'], expect: st('met', 'met', NA, NA) },
  'MA.L2-3.7.1': { own: ['review'], expect: st('met', 'met', NA, NA) }, // FIN-35 / DEPTH-11: the update-ring proxy no longer counts; S1/S2 GD-b reviews of [a]; S3/mp not_assessed (NON_STACK_PROXY_PARTIAL)
  'MA.L2-3.7.2': { own: ['review'], expect: st('met', 'met', NA, NA) }, // FIN-35 / DEPTH-11: S1/S2 GD-b reviews of [a]-[d]
  'MA.L2-3.7.3': { own: ['review'], expect: st('met', 'met', NA, NA) },
  'MA.L2-3.7.6': { own: ['review'], expect: st('met', 'met', NA, NA) },
  'MP.L1-3.8.3': { own: ['review'], expect: st(NA, 'met', NA, NA) },
  'MP.L2-3.8.4': { own: ['review'], expect: st('met', 'met', NA, NA) }, // FIN-35 / DEPTH-11: the CUI-label proxy no longer counts; S1/S2 GD-b reviews of [a]-[b]
  'MP.L2-3.8.9': { own: ['review'], expect: st('met', 'met', NA, NA) }, // FIN-35 / DEPTH-11: the DLP proxies no longer count; S1/S2 GD-b review of [a]
  'PE.L1-3.10.1': { own: ['review'], expect: st('met', 'met', NA, NA) },
  'PE.L2-3.10.2': { own: ['review'], expect: st('met', 'met', NA, NA) },
  'PE.L1-3.10.3': { own: ['review'], expect: st('met', 'met', NA, NA) },
  'PE.L1-3.10.4': { own: ['review'], expect: st('met', 'met', NA, NA) },
  'PE.L1-3.10.5': { own: ['review'], expect: st('met', 'met', NA, NA) },
  'PE.L2-3.10.6': { own: ['review'], expect: st('met', 'met', NA, NA) },
  'PS.L2-3.9.1': { own: ['store'], expect: st('met', 'met', NA, NA) },
  'PS.L2-3.9.2': { own: ['store', 'tier1', 'tier2', 'tier3'], expect: st('not_met', 'not_met', 'not_met', 'not_met'), reason: 'the founder accepted the honest drop (A-1031-44): every synthetic customer has an open leaver account-disable step, so no scenario reaches met; met needs a completed offboarding in the records store' },
  'RA.L2-3.11.1': { own: ['review'], expect: st('met', 'met', NA, NA) },
  'CA.L2-3.12.1': { own: ['eo_records', 'review'], expect: st('met', 'met', 'met', 'met'), reason: 'FD-4: EO\'s own records hold on every scenario (ces.db keeps earlier assessments); not_assessed shows only on a fresh tenant\'s first assess' },
  // The Stamper POA&M entry (Tier 3/4) credits it today; FIN-27 open item 1 / the orchestrator's note move it to EO's
  // own POA&M record (mp n/a -> met, +3, pending a founder call): both accepted until that lands.
  'CA.L2-3.12.2': { own: ['eo_records', 'tier3', 'tier4', 'review'], expect: st('met', 'met', 'met', [NA, 'met']) },
  'CA.L2-3.12.3': { own: ['eo_records', 'review'], expect: st('met', 'met', 'met', 'met'), reason: 'FD-4: as CA.L2-3.12.1 (needs two prior assessments)' },
  'CA.L2-3.12.4': { own: ['review'], expect: st('met', NA, NA, NA) },
  'CM.L2-3.4.4': { own: ['review'], expect: st('met', 'met', NA, NA) },
};
const asList = (v) => (Array.isArray(v) ? v : [v]);
/** Static completeness of the matrix: every control reaches met and (not_met or not_assessed) somewhere, or has a reason. */
export function v129MatrixGaps(matrix = V129_MATRIX, controls = Object.keys(V129_MATRIX)) {
  const gaps = [];
  for (const c of controls) {
    const m = matrix[c];
    if (!m) { gaps.push(`${c}: not in the matrix`); continue; }
    const vals = ALL.flatMap((s) => asList(m.expect[s]));
    const met = vals.includes('met');
    const unmet = vals.some((v) => v === 'not_met' || v === NA);
    if ((!met || !unmet) && !m.reason) gaps.push(`${c}: reaches ${met ? 'only met' : 'never met'} and carries no reason`);
  }
  return gaps;
}
// snapshot: the EO package's latest-snapshot.json (the scored E7B snapshot); nonStack: the 28 control ids.
export function judgeV129({ snapshot = null, slug = '', nonStack = Object.keys(V129_MATRIX), matrix = V129_MATRIX }) {
  if (!snapshot) return { pass: false, detail: 'no EO package snapshot (out/eo-package/<latest>/assessments/latest-snapshot.json)' };
  if (!ALL.includes(slug)) return { pass: true, detail: `not judged: ${slug} is not one of the four scenarios` };
  const problems = [];
  const gaps = v129MatrixGaps(matrix, nonStack);
  if (gaps.length) problems.push(`matrix: ${gaps.join('; ')}`);
  const by = new Map((snapshot.controls ?? []).map((c) => [c.control_id, c]));
  const rows = [];
  for (const id of nonStack) {
    const c = by.get(id);
    const m = matrix[id];
    if (!c) { problems.push(`${id} missing from the snapshot`); continue; }
    const dec = deciderOf(c.statusRationale);
    rows.push(`${id} ${c.status} (${dec})`);
    if (!m) continue;
    const want = asList(m.expect[slug]);
    if (!want.includes(c.status)) problems.push(`${id} ${c.status} (${dec}), predicted ${want.join(' or ')}`);
    if (c.status !== NA && !m.own.includes(dec)) problems.push(`${id} ${c.status} decided by ${dec}, not its own path (${m.own.join(' / ')})`);
    if (c.status === NA && id.startsWith('CA.L2-3.12.') && ['CA.L2-3.12.1', 'CA.L2-3.12.3'].includes(id) && /records were not supplied/.test(c.statusRationale ?? '')) problems.push(`${id}: FIN-27 router wiring not landed (the records were not supplied to the assessor)`);
  }
  if (problems.length) return { pass: false, detail: `${problems.join('; ')} | ${slug}: ${rows.join(', ')}` };
  const withReason = nonStack.filter((c) => matrix[c]?.reason).length;
  return { pass: true, detail: `${nonStack.length} non-stack controls on ${slug} equal the pinned matrix, each decided by its own path; the matrix covers met and not_met / not_assessed for ${nonStack.length - withReason} control(s) across the four scenarios and gives a written reason for ${withReason}; cross-scenario coverage holds when V129 is green on all four | ${rows.join(', ')}` };
}

// ---------- V130: Muster secondary surfaces ----------
export function judgeV130({ rec = null, stale = null, harness = 'tester' }) {
  const nt = notTester(harness, 'E9M');
  if (nt) return nt;
  const gate = recordGate(rec, stale, FILES.musterSurfaces, 'E9M');
  if (gate) return { pass: false, detail: gate };
  const problems = [];
  const d = rec.discovery ?? {};
  if (d.run_status !== 202 && d.run_status !== 200 && d.run_status !== 201) problems.push(`discovery run HTTP ${d.run_status}`);
  if (d.status !== 'done') problems.push(`discovery job ${d.status ?? 'none'}${d.error ? `: ${d.error}` : ''}`);
  else if (!d.envelope_sha256) problems.push('discovery done without an envelope');
  if (!(d.live_refused_status >= 400 && d.live_refused_status < 500)) problems.push(`discovery live: true was not refused (HTTP ${d.live_refused_status})`);
  const h = rec.harvest ?? {};
  if (h.status !== 200 || !(h.facts > 0)) problems.push(`harvest sim HTTP ${h.status}, ${h.facts ?? 'no'} fact(s)`);
  if (h.token_refused_status !== 403) problems.push(`harvest with a bare access token HTTP ${h.token_refused_status} (want 403)`);
  const k = rec.collector_kit ?? {};
  if (k.rc !== 0) problems.push(`mu collector-kit rc ${k.rc}${k.error ? `: ${k.error}` : ''}`);
  else {
    if (!k.sha256 || k.sha256 !== k.file_sha256) problems.push(`collector kit file sha ${k.file_sha256} != printed ${k.sha256}`);
    if (k.header_sha256 && k.header_sha256 !== k.sha256) problems.push('collector kit header sha differs');
    if (k.manifest_rc !== 0 || k.manifest_sha256 !== k.sha256) problems.push(`collector kit manifest rc ${k.manifest_rc}, sha ${k.manifest_sha256} != kit ${k.sha256}`);
  }
  const r = rec.recipe ?? {};
  if (r.rc !== 0) problems.push(`mu recipes ingest rc ${r.rc}${r.error ? `: ${r.error}` : ''}`);
  else {
    const facts = Array.isArray(r.facts) ? r.facts : Array.isArray(r.facts?.facts) ? r.facts.facts : r.facts?.fact ? [r.facts.fact] : r.facts?.question_id ? [r.facts] : [];
    const f = facts.find((x) => x?.question_id === 'iam-001');
    if (!f) problems.push('recipe ingest gave no iam-001 fact');
    else if (f.answer !== r.expected_answer) problems.push(`recipe iam-001 = ${f.answer}, the sim's policies say ${r.expected_answer}`);
    else if (f.provenance !== 'captured') problems.push(`recipe fact provenance ${f.provenance}`);
  }
  if (r.no_concierge_rc === 0) problems.push('recipe ingest without the concierge header was accepted (self-serve must be off)');
  problems.push(...v130ImportProblems(rec.imports));
  if (problems.length) return { pass: false, detail: problems.join('; ') };
  const im = rec.imports;
  return { pass: true, detail: `discovery API run done (envelope ${d.envelope_sha256.slice(0, 12)}…), live refused HTTP ${d.live_refused_status}; harvest ${h.facts} fact(s), bare token refused 403; collector kit ${k.sha256.slice(0, 12)}… = manifest; recipe ingest iam-001 = ${r.expected_answer} (captured), refused without concierge; readiness-file import through POST /api/plan/compile (E3 HTTP 200, ${im.readiness_import.e3_files} file(s), ${im.readiness_import.disc_schema_version}, ${im.readiness_import.disc_observations} observation(s), sha ${im.readiness_import.disc_sha256.slice(0, 12)}…); compile refuses a collector-kit results file and a schema-invalid readiness file (422 "Import failed"); AI gate ${im.ai.gate}${im.ai.gate === 'off' ? ' (adaptive and coach 503 degraded, retro-confidence all low)' : ' (empty bodies refused 400; no model call)'}; not run here: ${(rec.not_run_here ?? []).map((x) => x.surface).join(', ')} (watched Muster UI run, V125)` };
}

/**
 * P12-MU: the `imports` block ces-tester's E9M adds (muster-e2e-run.ts runV130Imports; same rules as its
 * v130ImportsProblems). "Results import" is the collector-kit results file (planning input), not Stamper results.
 */
export function v130ImportProblems(im) {
  if (!im) return ['no imports block (readiness-file import, compile refusals, AI gate): the record predates P12-MU'];
  const p = [];
  const ri = im.readiness_import ?? {};
  if (ri.e3_http_status !== 200 || !(ri.e3_files > 0)) p.push(`readiness import: E3 compile HTTP ${ri.e3_http_status}, ${ri.e3_files ?? 0} file(s)`);
  if (!ri.disc_sha256 || !/^readiness-result\/1\.[01]\.0$/.test(ri.disc_schema_version ?? '') || !(ri.disc_observations > 0)) p.push(`readiness import: discovery file ${ri.disc_file ?? 'missing'} (${ri.disc_schema_version ?? 'no schema_version'}, ${ri.disc_observations ?? 'no'} observation(s))`);
  if (!ri.plan_readiness_file) p.push('readiness import: the compile wrote no readiness-result file');
  for (const name of ['collector-kit results file', 'schema-invalid readiness file']) {
    const x = (im.refusals ?? []).find((y) => y.name === name);
    if (!x) p.push(`${name}: not probed`);
    else if (x.status !== 422 || !x.import_failed) p.push(`${name}: compile HTTP ${x.status} (want 422 "Import failed")`);
  }
  if (im.ai?.gate !== 'off' && im.ai?.gate !== 'on') p.push(`AI gate unclear: adaptive ${im.ai?.adaptive_status}, coach ${im.ai?.coach_status}, retro ${im.ai?.retro_status}`);
  if (im.error) p.push(im.error);
  return p;
}

// ---------- V89: one database (GD-a; DB-3 under FIN-25) ----------
export const V89_PG = /postgres(?:ql)?:\/\/[^\s"'`]+/i;
const DB_EXT = /\.(db|sqlite|sqlite3|db3|mdb|accdb)$/i;
/** Walks the run's roots (out/, pl/, tenants/) and muster-api's env files; reads text files up to 8 MB. */
export function collectV89({ root, ces, listFiles }) {
  const roots = ['out', 'pl', 'tenants'].map((r) => path.join(root, r)).filter((d) => fs.existsSync(d));
  const dbFiles = [];
  const pgHits = [];
  let scanned = 0;
  for (const d of roots) {
    for (const f of listFiles(d)) {
      const base = path.basename(f);
      if (DB_EXT.test(base) && base.toLowerCase() !== 'ces.db') dbFiles.push(path.relative(root, f).split(path.sep).join('/'));
      if (/\.(zip|docx|pdf|bin|png|db|db-wal|db-shm|psd1|psm1|dll|exe)$/i.test(base) || /ces\.db/i.test(base)) continue;
      let size = 0;
      try { size = fs.statSync(f).size; } catch { continue; }
      if (size > 8 * 1024 * 1024) continue;
      scanned++;
      const t = fs.readFileSync(f, 'utf8');
      if (V89_PG.test(t)) pgHits.push(path.relative(root, f).split(path.sep).join('/'));
    }
  }
  const envHits = [];
  for (const f of ['.env', '.env.local'].map((n) => path.join(ces, 'ces-muster', 'muster-api', n))) {
    if (fs.existsSync(f) && /^\s*DATABASE_URL\s*=\s*\S/m.test(fs.readFileSync(f, 'utf8'))) envHits.push(path.relative(ces, f).split(path.sep).join('/'));
  }
  return { dbFiles, pgHits, envHits, scanned, prismaDir: fs.existsSync(path.join(ces, 'ces-muster', 'muster-api', 'prisma')) };
}
export function judgeV89({ c = null, pkgFiles = null }) {
  if (!c) return { pass: false, detail: 'roots not scanned' };
  const problems = [];
  if (c.pgHits.length) problems.push(`Postgres connection string in ${c.pgHits.slice(0, 5).join(', ')}`);
  if (c.envHits.length) problems.push(`DATABASE_URL set in ${c.envHits.join(', ')}`);
  if (c.dbFiles.length) problems.push(`database file(s) other than ces.db: ${c.dbFiles.slice(0, 5).join(', ')}`);
  if (c.prismaDir) problems.push('slice not landed: FIN-25 (muster-api/prisma/ still present)');
  const report = `every package file has a ces.db row with its hash: reported, not judged (DB-2 / DB-5, PH-5)${pkgFiles !== null ? `: ${pkgFiles} package file(s)` : ''}`;
  if (problems.length) return { pass: false, detail: `${problems.join('; ')}; ${report}` };
  return { pass: true, detail: `no Postgres connection string in ${c.scanned} text file(s) of out/, pl/, tenants/ or muster-api's env; no database file but ces.db; muster-api/prisma/ removed; ${report}` };
}

// ---------- the area entry point ----------
const NON_STACK = Object.keys(V129_MATRIX);

export async function fin29EoMusterChecks(vctx) {
  const rows = [];
  const fileOf = (n) => path.join(vctx.out, n);
  const read = (n) => (vctx.exists(fileOf(n)) ? vctx.readJson(fileOf(n)) : null);
  const safe = async (id, title, fn) => {
    try { rows.push({ id, title, ...(await fn()) }); } catch (e) { rows.push({ id, title, pass: false, detail: `error: ${e instanceof Error ? e.message : String(e)}` }); }
  };
  const db = (() => { try { return vctx.db?.() ?? null; } catch { return null; } })();
  const rowsIn = (h, sql, ...args) => { try { return h ? h.prepare(sql).all(...args).map((r) => ({ ...JSON.parse(r.data), ...(r.created_at ? { _created_at: r.created_at, _updated_at: r.updated_at } : {}) })) : null; } catch { return null; } };
  const rowsWhere = (sql, ...args) => rowsIn(db, sql, ...args);
  // E9E's private ces.db (out/e9/pl/ces.db), opened read-only here; vctx.db is the real one.
  const privDb = (() => {
    try {
      const f = path.join(vctx.out, 'e9', 'pl', 'ces.db');
      if (!fs.existsSync(f)) return null;
      const Database = createRequire(path.join(vctx.ces, 'package.json'))('better-sqlite3');
      return new Database(f, { readonly: true, fileMustExist: true });
    } catch { return null; }
  })();
  const privRows = (sql, ...args) => rowsIn(privDb, sql, ...args);
  const cont = read(FILES.eoContinuous);
  const harness = vctx.harness ?? 'tester';

  await safe('V89', 'One database (GD-a): no Postgres connection string and no database file but ces.db in the run\'s roots; package-file rows reported (DB-2/DB-5, PH-5)', () => {
    const c = collectV89({ root: vctx.root, ces: vctx.ces, listFiles: vctx.listFiles });
    const pkgRoot = path.join(vctx.out, 'eo-package');
    const pkgFiles = fs.existsSync(pkgRoot) ? vctx.listFiles(pkgRoot).length : null;
    return judgeV89({ c, pkgFiles });
  });
  await safe('V119', 'EO\'s collection scheduler ticked every registered tenant, ran collectors on their cadence, wrote a snapshot and detected a drift the simulator seeded between ticks, with a notice and no write to the tenant', () => judgeV119({
    rec: cont, stale: vctx.staleOf(fileOf(FILES.eoContinuous)), harness,
    ticksDb: privRows("SELECT data FROM ces_records WHERE collection = 'eo_collection_ticks' AND tenant_slug = ?", vctx.slug),
    noticesDb: privRows("SELECT data FROM ces_records WHERE collection = 'eo_collection_notices' AND tenant_slug = ?", vctx.slug),
  }));
  await safe('V120', 'EC items and ledger history are write-once (overwrite probe refused); a tampered EC file becomes an EO HASH_DRIFT finding with a notice', async () => {
    const probe = await collectV120Probe({ db, cesRoot: vctx.ces, slug: vctx.slug }).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
    const liveRows = (coll) => { try { return db ? db.prepare('SELECT created_at, updated_at FROM ces_records WHERE collection = ? AND tenant_slug = ?').all(coll, vctx.slug) : null; } catch { return null; } };
    const items = liveRows('ec_items');
    const history = liveRows('ec_ledger_history');
    return judgeV120({
      rec: cont, stale: vctx.staleOf(fileOf(FILES.eoContinuous)), harness, worm: probe?.worm ?? null, probe,
      live: items && history ? { items, history } : null,
      integrityDb: privRows("SELECT data FROM ces_records WHERE collection = 'eo_integrity_findings' AND tenant_slug = ?", vctx.slug),
    });
  });
  await safe('V121', 'Muster\'s engagement layer on ces.db: login, engagement, parties, contracts, HIL flag and resolve, session sync, reassessment and nudge ticks to the simulated mail outbox, touch, delivery grant; the SPRS route equals EO\'s SPRS', () => {
    const rec = read(FILES.musterEngagement);
    const tid = rec?.probe?.tenant_id ?? null;
    let byColl = null;
    let outbox = null;
    if (db && tid) {
      byColl = {};
      for (const c of [...new Set([...['muster_tenants', 'muster_users'], ...V121_COLLECTIONS])]) byColl[c] = rowsWhere('SELECT data FROM ces_records WHERE collection = ? AND tenant_id = ?', c, tid) ?? [];
      // the tenant row is keyed by its own id
      if (!byColl.muster_tenants.length) byColl.muster_tenants = rowsWhere("SELECT data FROM ces_records WHERE collection = 'muster_tenants' AND id = ?", tid) ?? [];
      outbox = rowsWhere("SELECT data FROM ces_records WHERE collection = 'muster_mail_outbox' AND tenant_id = ?", tid);
    }
    return judgeV121({ rec, stale: vctx.staleOf(fileOf(FILES.musterEngagement)), harness, rows: byColl, outbox, prismaDirPresent: fs.existsSync(path.join(vctx.ces, 'ces-muster', 'muster-api', 'prisma')) });
  });
  await safe('V128', 'EO extra routes: manual capture, POST /api/collect, POST /api/policies/import, risk ingest / auto-score / annual review / render, training email and certificate, screening PDF', () => judgeV128({ rec: read(FILES.eoRoutes), stale: vctx.staleOf(fileOf(FILES.eoRoutes)), harness, slug: vctx.slug, cont }));
  await safe('V129', 'Non-stack coverage matrix over the 28 controls: this scenario equals the pinned matrix, each control decided by its own path; the matrix reaches met and not_met / not_assessed for each control or gives a written reason', () => judgeV129({ snapshot: vctx.snapshot, slug: vctx.slug, nonStack: NON_STACK }));
  try { privDb?.close(); } catch { /* read-only handle */ }
  await safe('V130', 'Muster secondary surfaces: discovery through the API route, the harvest route, collector kit and manifest, recipe ingest, readiness-file import through the compile route and its refusals, the AI gate (collector-kit results import and the SPA import clicks: watched UI run)', () => judgeV130({ rec: read(FILES.musterSurfaces), stale: vctx.staleOf(fileOf(FILES.musterSurfaces)), harness }));
  return rows;
}
