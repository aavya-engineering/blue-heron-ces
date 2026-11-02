// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * FIN-29 (finishing plan PH-2 harness): the EO and Muster legs. Two steps, both `fatal: false`, outside REQUIRED_STEPS,
 * placed after every scored step (after E8F, E7C, E7S, E8R, E8T) and before the run's finally block stops the servers.
 *
 * E9E (V119, V120, V128). A SECOND EO process (port 4012) and a SECOND EC (port 4013) on a PRIVATE pipeline root
 * (out/e9/pl: an online backup of ces.db, copies of the EC store and this tenant's Stamper folder) and a copy of the
 * run's EO storage (out/e9/eo), against the same sim, with the FIN-24 collection scheduler set to tick within the step (first tick 30 s, later ticks every
 * 15 s, full assess every 60 s). The run's own EO (E7, port 4002) keeps the default schedule (first tick after 24 h),
 * so no scheduler assess ever lands between the scored passes. The step:
 *   1. waits for the scheduler's first assess tick of this tenant (timer-driven, not an operator trigger);
 *   2. seeds a drift in the sim (one enabled MFA conditional-access policy set to disabled) and tampers one EC blob
 *      (E8.5's upload) on disk, then asks EC for an index pass (HASH_DRIFT);
 *   3. waits for the tick that records the EO integrity finding and the next assess tick (drift + notice);
 *   4. reverts the sim write and restores the blob bytes (always, in a finally);
 *   5. drives the EO extra routes on the same second EO (V128): manual capture, POST /api/collect, a policy re-import
 *      (one policy EO already holds, unchanged, so the store does not grow), risk ingest / auto-score / annual review /
 *      render, training email and certificate, the screening PDF.
 *   Records: out/eo-continuous.json (V119, V120), out/eo-routes.json (V128). Counts the sim's writes in the window:
 *   only the harness's seed and revert may appear (the scheduler never writes to a tenant: no silent auto-fix).
 *
 * E9M (V121, V130). Against E3's muster-api (still up):
 *   - V121: a probe tenant and user seeded with muster-api's own scripts/seed.ts (password in the child env only),
 *     login, engagement, party, session sync and HIL flag (sub token), HIL resolve, contract create/read/update,
 *     a party action (send-nudge-now), touch, a nudge tick and a reassessment tick (the simulated mail outbox, FD-6),
 *     a delivery artifact and grant, and POST /api/sprs/score over the scored snapshot (must equal EO's SPRS).
 *     The probe tenant's rows are its own; no scenario data is touched. Record: out/muster-engagement.json.
 *   - V130: discovery through POST /api/discovery/run (sim; a `live: true` request must be refused), the harvest route
 *     (sim; a bare access token must be refused), `mu collector-kit` and `--manifest` (hashes agree), `mu recipes ingest`
 *     of an entra-mfa-report output built from the sim's own policies (and refused without the concierge header).
 *     Results and readiness file import are the watched UI run's (PH-3): recorded as not run here.
 *     Record: out/muster-surfaces.json.
 *
 * Every token or password minted here is registered with ctx.registerSecret (V101) and never written to a file, a log
 * or argv. All names and addresses are fictional (`*.ces.invalid`).
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { resolve as simResolveDefault, queryLedger as queryLedgerDefault } from '../stacksim-client/http.js';
import type { ResolveRequestBody } from '../stacksim-client/types.js';
import { isWrite, type LedgerEntryLike } from './muster-e2e-compare.js';
import { readSse } from './mx-io.js';
import { FIN29_FILES, FIN29_SCHEMAS, type Fin29StepCtx, type Fin29StepDef, type Fin29StepOutcome } from './fin29-common.js';

// ---------- context additions (the runner provides these two getters) ----------

export interface Fin29EoMusterCtx extends Fin29StepCtx {
  /** E7's EO child env (muster-e2e-run.ts eoChildEnv(simEnv)); undefined before E5. */
  eoEnv: () => NodeJS.ProcessEnv | undefined;
  /** The run's EC bearer secret (EVIDENCE_OPS_SECRET). */
  ecSecret: () => string | undefined;
}

// ---------- constants ----------

export const E9_EO_PORT_DEFAULT = 4012;
export const E9_EO_PORT_ENV = 'CES_E9_EO_PORT';
/** The second EO's scheduler: first tick, later ticks, full assess period (FIN-24 env names). */
export const E9_SCHEDULER_ENV = {
  ENABLE_SCHEDULED_SIGNAL_CAPTURE: '1',
  CES_EO_COLLECT_FIRST_TICK_SEC: '30',
  CES_EO_COLLECT_TICK_MIN: '0.25',
  // 60 s: the scheduler's floor for the assess period (readSchedulerOptions clamps at 60 000 ms).
  SIGNAL_CAPTURE_INTERVAL_HOURS: String(60 / 3600),
} as const;
export const V120_TAMPER_SUFFIX = '\nV120 tamper probe (harness): these bytes were changed after ingest\n';
export const E9_FICTIONAL_DOMAIN = 'ces.invalid';

// ---------- small helpers ----------

export interface HttpResult {
  status: number | null;
  text: string;
  json: unknown;
  headers: Record<string, string>;
  error?: string;
}
export type HttpCall = (method: string, url: string, o?: { headers?: Record<string, string>; json?: unknown; body?: RequestInit["body"]; timeoutMs?: number }) => Promise<HttpResult>;

export const fetchCall: HttpCall = async (method, url, o = {}) => {
  try {
    const headers: Record<string, string> = { ...(o.headers ?? {}) };
    let body: RequestInit["body"] | undefined = o.body;
    if (o.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(o.json);
    }
    const r = await fetch(url, { method, headers, ...(body !== undefined ? { body } : {}), signal: AbortSignal.timeout(o.timeoutMs ?? 120000) });
    const buf = Buffer.from(await r.arrayBuffer());
    const ct = r.headers.get('content-type') ?? '';
    const text = /json|text|javascript|xml/i.test(ct) || ct === '' ? buf.toString('utf8') : `<${buf.length} bytes ${ct}>`;
    let json: unknown = null;
    if (/json/i.test(ct)) try { json = JSON.parse(buf.toString('utf8')); } catch { json = null; }
    const hs: Record<string, string> = {};
    r.headers.forEach((v, k) => { hs[k] = v; });
    if (/pdf|octet/i.test(ct)) hs['x-fin29-head'] = buf.subarray(0, 5).toString('latin1');
    return { status: r.status, text, json, headers: hs };
  } catch (e) {
    return { status: null, text: '', json: null, headers: {}, error: e instanceof Error ? e.message : String(e) };
  }
};

const sha256 = (b: Buffer | string): string => crypto.createHash('sha256').update(b).digest('hex');
const get = (o: unknown, k: string): unknown => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const sleepMs = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
function rowsOfData(data: unknown): Array<Record<string, unknown>> {
  const v = data && typeof data === 'object' && Array.isArray((data as { value?: unknown }).value) ? (data as { value: unknown[] }).value : data;
  return Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as Array<Record<string, unknown>>) : [];
}
/** A short, value-free view of a response for the record (never a token). */
export function brief(r: HttpResult, keep: string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = { status: r.status };
  if (r.error) out.error = r.error.slice(0, 200);
  if (r.json && typeof r.json === 'object' && !Array.isArray(r.json)) for (const k of keep) if (k in (r.json as object)) out[k] = (r.json as Record<string, unknown>)[k];
  if (Array.isArray(r.json)) out.items = r.json.length;
  if ((r.status ?? 0) >= 400) out.body = r.text.slice(0, 240);
  return out;
}

// ---------- V119: the drift seed ----------

export interface DriftSeed {
  kind: 'ca_policy_state';
  policy_id: string;
  display_name: string | null;
  from: string;
  to: 'disabled';
  why: string;
  /** PH-5: every policy the seed disables (and reverts); the first is policy_id / display_name. */
  policies: Array<{ policy_id: string; display_name: string | null }>;
}

/**
 * PH-5 (R-F2 V119, R-EO diff C): a CA policy that AC.L1-3.1.1's evaluator credits: enabled, grant mfa AND
 * compliantDevice, and it targets All users or at least one group.
 */
export function creditsAcL1(p: Record<string, unknown>): boolean {
  const b = get(get(p, 'grantControls'), 'builtInControls');
  if (!(Array.isArray(b) && b.includes('mfa') && b.includes('compliantDevice'))) return false;
  const users = get(get(p, 'conditions'), 'users');
  const inc = get(users, 'includeUsers');
  const groups = get(users, 'includeGroups');
  return (Array.isArray(inc) && inc.includes('All')) || (Array.isArray(groups) && groups.length > 0);
}

/**
 * The enabled conditional-access policies to disable. PH-5: every one that AC.L1-3.1.1's evaluator credits, so that
 * met control drifts (one is not enough when two credit it); none of those: the old rule, one enabled policy with an
 * MFA grant, else the first enabled one. Null when no policy is enabled.
 */
export function pickDriftSeed(policies: Array<Record<string, unknown>>): DriftSeed | null {
  const enabled = policies.filter((p) => get(p, 'state') === 'enabled' && typeof get(p, 'id') === 'string');
  const credited = enabled.filter(creditsAcL1);
  const mfa = enabled.find((p) => {
    const b = get(get(p, 'grantControls'), 'builtInControls');
    return Array.isArray(b) && b.includes('mfa');
  });
  const chosen = credited.length ? credited : [mfa ?? enabled[0]].filter((x): x is Record<string, unknown> => !!x);
  if (!chosen.length) return null;
  const list = chosen.map((p) => ({ policy_id: String(get(p, 'id')), display_name: str(get(p, 'displayName')) }));
  const why = credited.length ? `every enabled policy AC.L1-3.1.1 credits (mfa + compliantDevice, all users or a group): ${list.length}` : mfa ? 'enabled policy with an MFA grant' : 'first enabled policy (no MFA grant found)';
  return { kind: 'ca_policy_state', policy_id: list[0]!.policy_id, display_name: list[0]!.display_name, from: 'enabled', to: 'disabled', why, policies: list };
}
export function seedRequest(seed: Pick<DriftSeed, 'policy_id'>, state: string): ResolveRequestBody {
  return { kind: 'uri', method: 'PATCH', uri: `/v1.0/identity/conditionalAccess/policies/${seed.policy_id}`, body: { state } } as unknown as ResolveRequestBody;
}
/** PH-5: write `state` to every seeded policy; each write is one harness write (V119 (e)). Throws on the first failure. */
async function writeSeed(D: { simResolve: (url: string, req: ResolveRequestBody) => Promise<unknown> }, sim: string, seed: DriftSeed, state: string, counted: () => void): Promise<void> {
  for (const p of seed.policies) {
    await D.simResolve(sim, seedRequest(p, state));
    counted();
  }
}
export const CA_POLICIES_REQUEST = { kind: 'uri', method: 'GET', uri: '/v1.0/identity/conditionalAccess/policies' } as unknown as ResolveRequestBody;

/** The sim's write entries inside [fromIso, toIso]. */
export function writesInWindow(entries: LedgerEntryLike[], fromIso: string, toIso: string): LedgerEntryLike[] {
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  return entries.filter((e) => isWrite(e) && Date.parse(e.ts) >= a && Date.parse(e.ts) <= b);
}

// ---------- V119 tick reading ----------

export interface TickLike {
  tickId?: string;
  tenantSlug?: string;
  at?: string;
  mode?: string;
  assess?: { ok?: boolean; snapshotId?: string | null; drift?: { previousSnapshotId?: string | null; drifted?: Array<{ controlId: string }> } | null } | null;
  integrity?: { reachable?: boolean; newHashDrift?: number };
  noticeIds?: string[];
  collectors?: unknown[];
  notDue?: unknown[];
}
export function assessTicks(ticks: TickLike[]): TickLike[] {
  return ticks.filter((t) => t.mode === 'assess').sort((x, y) => String(x.at).localeCompare(String(y.at)));
}

// ---------- V128: policy re-import body ----------

/** The first policy EO already holds, as a PolicyDocument (EO's import schema), unchanged: the import is idempotent. */
export function policyReimportBody(slug: string, held: unknown): { tenantSlug: string; policies: Array<Record<string, unknown>> } | null {
  const list = Array.isArray(held) ? held : rowsOfData(get(held, 'policies') ?? held);
  const p = (list as Array<Record<string, unknown>>).find((x) => str(get(x, 'template_id')) && str(get(x, 'title')) && str(get(x, 'markdown')) && str(get(x, 'domain')));
  if (!p) return null;
  const keys = ['template_id', 'title', 'markdown', 'completeness', 'domain', 'nist_controls', 'documentId', 'approvalDate', 'approverName', 'version', 'nistControlSummary'];
  const doc: Record<string, unknown> = {};
  for (const k of keys) if (p[k] !== undefined && p[k] !== null) doc[k] = p[k];
  return { tenantSlug: slug, policies: [doc] };
}

// ---------- V130: the recipe output and its expected fact ----------

/** An entra-mfa-report recipe output built from the sim's own policies, and the answer muster-api must derive. */
export function entraMfaRecipe(policies: Array<Record<string, unknown>>): { body: { recipe_name: string; output: Record<string, unknown> }; expectedAnswer: 'yes' | 'no' } {
  const conditionalAccessPolicies = policies.map((p) => ({ id: get(p, 'id'), displayName: get(p, 'displayName'), state: get(p, 'state'), grantControls: get(p, 'grantControls') ?? null }));
  const yes = conditionalAccessPolicies.some((p) => {
    const b = get(p.grantControls, 'builtInControls');
    return p.state === 'enabled' && Array.isArray(b) && b.includes('mfa');
  });
  return { body: { recipe_name: 'entra-mfa-report', output: { conditionalAccessPolicies } }, expectedAnswer: yes ? 'yes' : 'no' };
}

/** The last JSON value a CLI printed (pretty or one line); null when none parses. */
export function lastJson(stdout: string): unknown {
  const t = stdout.trim();
  for (let i = t.indexOf('{'); i >= 0 && i < t.length; i = t.indexOf('{', i + 1)) {
    try { return JSON.parse(t.slice(i)); } catch { /* try the next brace */ }
  }
  try { return JSON.parse(t.split(/\r?\n/).pop() ?? ''); } catch { return null; }
}

// ---------- V121: requirement results of the scored snapshot ----------

export function requirementResults(snapshot: unknown): Array<{ requirement_id: string; status: string }> {
  const cs = get(snapshot, 'controls');
  return Array.isArray(cs) ? cs.filter((c) => str(get(c, 'control_id')) && str(get(c, 'status'))).map((c) => ({ requirement_id: String(get(c, 'control_id')), status: String(get(c, 'status')) })) : [];
}

/** The newest package snapshot (out/eo-package/<dir>/assessments/latest-snapshot.json), or null. */
export function latestPackageSnapshot(outDir: string): { file: string; snapshot: unknown } | null {
  const root = path.join(outDir, 'eo-package');
  if (!fs.existsSync(root)) return null;
  const dir = fs.readdirSync(root).filter((d) => fs.statSync(path.join(root, d)).isDirectory()).sort().pop();
  const f = dir ? path.join(root, dir, 'assessments', 'latest-snapshot.json') : null;
  if (!f || !fs.existsSync(f)) return null;
  return { file: f, snapshot: JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')) };
}

/** A muster-api JWT (same payload shape as mint-token.mjs), signed with muster-api's own jsonwebtoken copy. */
export function mintMusterToken(musterApiDir: string, secret: string, claims: { sub: string; tenant_id: string; party_id: string | null; role: string }): string {
  const req = createRequire(path.join(musterApiDir, 'package.json'));
  const jwt = req('jsonwebtoken') as { sign: (p: object, s: string, o: object) => string };
  return jwt.sign(claims, secret, { expiresIn: '1h' });
}

// ---------- deps (tests inject fakes) ----------

// ---------- E9E's private pipeline root (no write may reach the real pl/ces.db or EC store) ----------

/** Collections refreshed by the run's own EC index timer (every 15 min, by design): recorded, not compared. */
export const E9_COUNT_EXCLUDED = ['ec_runs', 'ec_ledger_state'];
export type RowCounts = Record<string, number>;

/** Row counts per collection for the scenario tenant (tenant_slug or tenant_id), read-only. Null when unreadable. */
export function countTenantRows(cesRoot: string, dbFile: string, slug: string, tenantId: string): RowCounts | null {
  try {
    if (!fs.existsSync(dbFile)) return null;
    const Database = createRequire(path.join(cesRoot, 'package.json'))('better-sqlite3') as new (f: string, o: object) => { prepare(s: string): { all(...a: unknown[]): Array<{ collection: string; n: number }> }; close(): void };
    const db = new Database(dbFile, { readonly: true, fileMustExist: true });
    try {
      const rows = db.prepare('SELECT collection, COUNT(*) AS n FROM ces_records WHERE tenant_slug = ? OR tenant_id = ? GROUP BY collection').all(slug, tenantId);
      return Object.fromEntries(rows.map((r) => [r.collection, Number(r.n)]));
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

/** Online backup of a live SQLite file (EO and EC still hold it open, so never a raw file copy). */
export async function backupDb(cesRoot: string, src: string, dest: string): Promise<void> {
  const Database = createRequire(path.join(cesRoot, 'package.json'))('better-sqlite3') as new (f: string, o: object) => { backup(d: string): Promise<unknown>; close(): void };
  const db = new Database(src, { readonly: true, fileMustExist: true });
  try {
    await db.backup(dest);
  } finally {
    db.close();
  }
}

/** The collections whose count changed (excluded ones aside). */
export function countDiff(before: RowCounts | null, after: RowCounts | null, excluded: string[] = E9_COUNT_EXCLUDED): string[] | null {
  if (!before || !after) return null;
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => !excluded.includes(k)).sort();
  return keys.filter((k) => (before[k] ?? 0) !== (after[k] ?? 0)).map((k) => `${k} ${before[k] ?? 0} -> ${after[k] ?? 0}`);
}

export const E9_EC_PORT_DEFAULT = 4013;
export const E9_EC_PORT_ENV = 'CES_E9_EC_PORT';

export interface Fin29EoMusterDeps {
  /** Tests: the online backup and the row counter. */
  backupDb?: (src: string, dest: string) => Promise<void>;
  countRows?: (dbFile: string, slug: string, tenantId: string) => RowCounts | null;
  http?: HttpCall;
  simResolve?: (url: string, body: ResolveRequestBody) => Promise<unknown>;
  queryLedger?: (url: string) => Promise<LedgerEntryLike[]>;
  sleep?: (ms: number) => Promise<void>;
  /** Poll budget multiplier (tests: 0 = one poll). */
  pollScale?: number;
  connectSse?: (url: string, outFile: string, headers: Record<string, string>) => Promise<{ rc: number }>;
}

function depsOf(d: Fin29EoMusterDeps = {}) {
  return {
    backupDb: d.backupDb,
    countRows: d.countRows,
    http: d.http ?? fetchCall,
    simResolve: d.simResolve ?? ((u: string, b: ResolveRequestBody) => simResolveDefault(u, b)),
    queryLedger: d.queryLedger ?? (async (u: string) => (await queryLedgerDefault(u, {})) as unknown as LedgerEntryLike[]),
    sleep: d.sleep ?? sleepMs,
    pollScale: d.pollScale ?? 1,
    connectSse: d.connectSse ?? (async (url: string, outFile: string, headers: Record<string, string>) => readSse({ url, stop: 'connection_log:done', outFile, timeoutMs: 120000, headers })),
  };
}

// =====================================================================================================================
// E9E
// =====================================================================================================================

export interface EoContinuousRecord {
  schema: typeof FIN29_SCHEMAS.eoContinuous;
  taken: string;
  ended?: string;
  slug: string;
  eo2: { port: number; storage_root: string; scheduler_env: Record<string, string>; up: boolean; connect_rc: number | null };
  /** The private pipeline root E9E's EO and EC run on (out/e9/pl: an online backup of ces.db plus EC and Stamper copies). */
  private_root: { pl: string; db: string; copied: string[]; ec_port: number; ec_up: boolean; error?: string };
  /** The scenario tenant's rows per collection in the REAL pl/ces.db before and after E9E (must not change). */
  real_db: { tenant_id: string; before: RowCounts | null; after: RowCounts | null; changed: string[] | null; excluded: string[] };
  status: unknown;
  registered_tenants: string[];
  ticks: TickLike[];
  notices: unknown[];
  integrity: unknown[];
  seed: (DriftSeed & { applied_at: string | null; apply_error?: string; reverted: boolean; revert_error?: string }) | null;
  seed_note?: string;
  sim_window: { started: string | null; ended: string | null; writes: number | null; harness_writes: number; error?: string };
  tamper: {
    item_id: string | null; blob: string | null; original_sha256: string | null; tampered_sha256: string | null;
    index_status: number | null; new_findings: Array<{ findingId: string; checkId: string }>; eo_finding_ids: string[];
    restored: boolean; restored_sha256: string | null; note?: string;
  };
  waits: Record<string, number>;
  error?: string;
}

export interface EoRouteCall { route: string; method: string; status: number | null; want: string; ok: boolean; note?: string; detail?: Record<string, unknown> }
export interface EoRoutesRecord {
  schema: typeof FIN29_SCHEMAS.eoRoutes;
  taken: string;
  slug: string;
  eo_url: string;
  personnel_id: string | null;
  course_id: string | null;
  calls: EoRouteCall[];
  outbox: { present: boolean; note: string };
  error?: string;
}

export function e9eStep(ctx: Fin29EoMusterCtx, d: Fin29EoMusterDeps = {}): Fin29StepDef {
  const port = Number(process.env[E9_EO_PORT_ENV] ?? E9_EO_PORT_DEFAULT);
  const ecPort = Number(process.env[E9_EC_PORT_ENV] ?? E9_EC_PORT_DEFAULT);
  const eo2 = `http://127.0.0.1:${port}`;
  const ec2 = `http://127.0.0.1:${ecPort}`;
  const dir = path.join(ctx.P.out, 'e9');
  const storage = path.join(dir, 'eo');
  const pl2 = path.join(dir, 'pl');
  const contFile = path.join(ctx.P.out, FIN29_FILES.eoContinuous);
  const routesFile = path.join(ctx.P.out, FIN29_FILES.eoRoutes);
  return {
    id: 'E9E',
    title: `EO continuous collection (V119), EC integrity (V120) and extra routes (V128) on a second EO (port ${port}) and EC (port ${ecPort}) over a private pipeline root (out/e9/pl)`,
    fatal: false,
    commands: [
      `private root ${ctx.rel(pl2)}: online backup (better-sqlite3 db.backup) of ${ctx.rel(path.join(ctx.P.pl, 'ces.db'))}, copies of pl/EvidenceCollector and pl/Stamper/plan-data/${ctx.slug}; copy ${ctx.rel(path.join(ctx.P.out, 'eo'))} -> ${ctx.rel(storage)}; the scenario tenant's row counts in the REAL ces.db before and after (must not change)`,
      `(cwd ${ctx.rel(path.join(ctx.P.ces, 'ces-ec'))}, sim env + CES_PIPELINE_ROOT=${ctx.rel(pl2)} EC_PORT=${ecPort} EVIDENCE_OPS_SECRET=<run-only>) node ${ctx.rel(ctx.P.tsx)} src/index.ts`,
      `(cwd ${ctx.rel(ctx.P.eoRoot)}, E7's EO env + CES_PIPELINE_ROOT=${ctx.rel(pl2)} EC_URL=${ec2} EO_PORT=${port} STORAGE_ROOT=${ctx.rel(storage)} ${Object.entries(E9_SCHEDULER_ENV).map(([k, v]) => `${k}=${v}`).join(' ')}) node ${ctx.rel(ctx.P.tsx)} src/eo/index.ts`,
      `SSE ${eo2}/api/connect?tenant=${ctx.slug}; poll GET ${eo2}/api/collect/schedule?tenant=${ctx.slug} until the scheduler's first assess tick`,
      `seed: POST ${ctx.urls.sim}/resolve PATCH /v1.0/identity/conditionalAccess/policies/<enabled MFA policy> {state: disabled}; tamper ${ctx.rel(pl2)}/EvidenceCollector/storage/${ctx.slug}/items/<E8.5 item>.bin (the copy); POST ${ec2}/api/index?tenant=${ctx.slug}`,
      `wait: the tick that records the EO integrity finding, then the next assess tick (drift + notice); revert the policy state; restore the blob bytes`,
      `V128 on ${eo2}: POST /api/evidence-explorer/capture, POST /api/collect, POST /api/policies/import (one held policy, unchanged), POST /api/risk-assessment/{ingest,auto-score,annual-review/one-click,render/report}, POST /api/personnel/<id>/training/{email,certificate}, GET /api/screening/element6-form -> ${ctx.rel(routesFile)}`,
      `-> ${ctx.rel(contFile)}`,
    ],
    run: async () => runE9e(ctx, depsOf(d), { port, eo2, ecPort, ec2, dir, storage, pl2, contFile, routesFile }),
  };
}

async function runE9e(ctx: Fin29EoMusterCtx, D: ReturnType<typeof depsOf>, o: { port: number; eo2: string; ecPort: number; ec2: string; dir: string; storage: string; pl2: string; contFile: string; routesFile: string }): Promise<Fin29StepOutcome> {
  for (const f of [o.contFile, o.routesFile]) fs.rmSync(f, { force: true });
  const slug = ctx.slug;
  const rec: EoContinuousRecord = {
    schema: FIN29_SCHEMAS.eoContinuous, taken: ctx.nowIso(), slug,
    eo2: { port: o.port, storage_root: ctx.rel(o.storage), scheduler_env: { ...E9_SCHEDULER_ENV }, up: false, connect_rc: null },
    private_root: { pl: ctx.rel(o.pl2), db: ctx.rel(path.join(o.pl2, 'ces.db')), copied: [], ec_port: o.ecPort, ec_up: false },
    real_db: { tenant_id: '', before: null, after: null, changed: null, excluded: [...E9_COUNT_EXCLUDED] },
    status: null, registered_tenants: [], ticks: [], notices: [], integrity: [], seed: null,
    sim_window: { started: null, ended: null, writes: null, harness_writes: 0 },
    tamper: { item_id: null, blob: null, original_sha256: null, tampered_sha256: null, index_status: null, new_findings: [], eo_finding_ids: [], restored: false, restored_sha256: null },
    waits: {},
  };
  const routes: EoRoutesRecord = { schema: FIN29_SCHEMAS.eoRoutes, taken: ctx.nowIso(), slug, eo_url: o.eo2, personnel_id: null, course_id: null, calls: [], outbox: { present: false, note: '' } };
  const save = (): void => {
    fs.mkdirSync(path.dirname(o.contFile), { recursive: true });
    fs.writeFileSync(o.contFile, JSON.stringify(rec, null, 2));
    fs.writeFileSync(o.routesFile, JSON.stringify(routes, null, 2));
  };
  const base = ctx.eoEnv();
  if (!base || !ctx.simUp()) {
    rec.error = routes.error = 'E9E needs the sim and E7\'s EO env (E5/E7 did not run)';
    save();
    return { rc: 1, detail: rec.error };
  }
  const held: number[] = [];
  for (const p of [o.port, o.ecPort]) if (await ctx.portHeld(p)) held.push(p);
  if (held.length) {
    rec.error = routes.error = `port ${held.join(', ')} in use (set ${E9_EO_PORT_ENV} / ${E9_EC_PORT_ENV} to free ports)`;
    save();
    return { rc: 1, detail: rec.error };
  }
  const H = ctx.eoAuthHeaders();
  const call = (method: string, p: string, x: Parameters<HttpCall>[2] = {}) => D.http(method, `${o.eo2}${p}`, { ...x, headers: { ...H, ...(x.headers ?? {}) } });
  const realDb = path.join(ctx.P.pl, 'ces.db');
  rec.real_db.tenant_id = (() => {
    try { return String((JSON.parse(fs.readFileSync(ctx.P.registryRecord, 'utf8')) as { tenant?: { tenant_id?: string } }).tenant?.tenant_id ?? `sim-tenant-${slug}`); } catch { return `sim-tenant-${slug}`; }
  })();
  const counter = D.countRows ?? ((f: string, s: string, t: string) => countTenantRows(ctx.P.ces, f, s, t));
  rec.real_db.before = counter(realDb, slug, rec.real_db.tenant_id);
  let proc: ReturnType<Fin29StepCtx['startBg']> | undefined;
  let ecProc: ReturnType<Fin29StepCtx['startBg']> | undefined;
  let blobOrig: Buffer | null = null;
  let blobPath: string | null = null;
  let seedApplied = false;
  try {
    fs.rmSync(o.dir, { recursive: true, force: true });
    fs.mkdirSync(o.dir, { recursive: true });
    const src = path.join(ctx.P.out, 'eo');
    if (fs.existsSync(src)) fs.cpSync(src, o.storage, { recursive: true });
    // The private pipeline root: ces.db by online backup (EO and EC hold the live file open), EC's store and this
    // tenant's Stamper folder by copy. Nothing E9E writes reaches the real pl/.
    try {
      fs.mkdirSync(o.pl2, { recursive: true });
      await (D.backupDb ?? ((a: string, b: string) => backupDb(ctx.P.ces, a, b)))(realDb, path.join(o.pl2, 'ces.db'));
      rec.private_root.copied.push('ces.db (online backup)');
      for (const rel of ['EvidenceCollector', path.join('Stamper', 'plan-data', slug)]) {
        const from = path.join(ctx.P.pl, rel);
        if (fs.existsSync(from)) { fs.cpSync(from, path.join(o.pl2, rel), { recursive: true }); rec.private_root.copied.push(rel.split(path.sep).join('/')); }
      }
    } catch (e) {
      rec.private_root.error = e instanceof Error ? e.message : String(e);
      throw new Error(`private pipeline root not made: ${rec.private_root.error}`);
    }
    // A second EC on the private root: the tamper leg's HASH_DRIFT is recorded in the copy.
    ecProc = ctx.startBg('E9E-ec', ctx.node, [ctx.P.tsx, 'src/index.ts'], path.join(ctx.P.ces, 'ces-ec'), {
      ...(ctx.simEnv() ?? base), CES_PIPELINE_ROOT: o.pl2, EC_PORT: String(o.ecPort), EVIDENCE_OPS_SECRET: ctx.ecSecret() ?? '',
    });
    rec.private_root.ec_up = await ctx.waitHttp(`${o.ec2}/api/health`, 'GET', 60);
    if (!rec.private_root.ec_up) throw new Error(`the second EC did not answer ${o.ec2}/api/health`);
    const env: NodeJS.ProcessEnv = { ...base, ...E9_SCHEDULER_ENV, CES_PIPELINE_ROOT: o.pl2, EC_URL: o.ec2, EO_PORT: String(o.port), STORAGE_ROOT: o.storage, COMPLIANCE_REPO_PATH: path.join(o.dir, 'eo-repo') };
    delete env.CES_EO_COLLECT_TENANTS; // every registered tenant (V119: per registered tenant)
    proc = ctx.startBg('E9E-eo', ctx.node, [ctx.P.tsx, 'src/eo/index.ts'], ctx.P.eoRoot, env);
    rec.eo2.up = await ctx.waitHttp(`${o.eo2}/api/health`, 'GET', 120);
    if (!rec.eo2.up) throw new Error(`the second EO did not answer ${o.eo2}/api/health`);
    const c = await D.connectSse(`${o.eo2}/api/connect?tenant=${slug}`, path.join(o.dir, 'eo2-connect.json'), H);
    rec.eo2.connect_rc = c.rc;

    const ticksNow = async (): Promise<TickLike[]> => {
      const r = await call('GET', `/api/collect/schedule?tenant=${slug}`);
      rec.status = r.json && typeof r.json === 'object' ? { ...(r.json as Record<string, unknown>), ticks: undefined } : { status: r.status, body: r.text.slice(0, 200) };
      const t = get(r.json, 'ticks');
      return Array.isArray(t) ? (t as TickLike[]) : [];
    };
    const waitFor = async (label: string, seconds: number, pred: (t: TickLike[]) => boolean): Promise<TickLike[]> => {
      const t0 = Date.now();
      const tries = Math.max(1, Math.ceil(seconds / 2 * D.pollScale));
      let t: TickLike[] = [];
      for (let i = 0; i < tries; i++) {
        t = await ticksNow();
        if (pred(t)) break;
        await D.sleep(2000);
      }
      rec.waits[label] = Math.round((Date.now() - t0) / 1000);
      return t;
    };
    // 1. the scheduler's first assess tick (timer-driven).
    let ticks = await waitFor('first_assess_s', 240, (t) => assessTicks(t).some((a) => a.assess?.ok));
    const first = assessTicks(ticks).find((a) => a.assess?.ok);
    if (!first) throw new Error('the scheduler wrote no successful assess tick for this tenant within 240 s');

    // 2. the drift seed and the EC tamper.
    rec.sim_window.started = ctx.nowIso();
    const pols = rowsOfData(await D.simResolve(ctx.urls.sim, CA_POLICIES_REQUEST));
    const seed = pickDriftSeed(pols);
    if (seed) {
      rec.seed = { ...seed, applied_at: null, reverted: false };
      try {
        seedApplied = true; // a partial seed is reverted too
        await writeSeed(D, ctx.urls.sim, seed, seed.to, () => { rec.sim_window.harness_writes++; });
        rec.seed.applied_at = ctx.nowIso();
      } catch (e) {
        rec.seed.apply_error = e instanceof Error ? e.message : String(e);
      }
    } else rec.seed_note = `no enabled conditional-access policy in the sim (${pols.length} policies)`;
    const up = (() => { try { return JSON.parse(fs.readFileSync(path.join(ctx.P.out, 'ec-upload.json'), 'utf8')) as Record<string, unknown>; } catch { return null; } })();
    rec.tamper.item_id = str(up?.itemId);
    if (rec.tamper.item_id) {
      blobPath = path.join(o.pl2, 'EvidenceCollector', 'storage', slug, 'items', `${rec.tamper.item_id}.bin`);
      rec.tamper.blob = ctx.rel(blobPath);
      if (fs.existsSync(blobPath)) {
        blobOrig = fs.readFileSync(blobPath);
        rec.tamper.original_sha256 = sha256(blobOrig);
        const tampered = Buffer.concat([blobOrig, Buffer.from(V120_TAMPER_SUFFIX, 'utf8')]);
        fs.writeFileSync(blobPath, tampered);
        rec.tamper.tampered_sha256 = sha256(tampered);
        const ix = await D.http('POST', `${o.ec2}/api/index?tenant=${slug}`, { headers: { Authorization: `Bearer ${ctx.ecSecret() ?? ''}` }, timeoutMs: 300000 });
        rec.tamper.index_status = ix.status;
        const nf = get(ix.json, 'newFindings');
        rec.tamper.new_findings = Array.isArray(nf) ? nf.map((f) => ({ findingId: String(get(f, 'findingId')), checkId: String(get(f, 'checkId')) })) : [];
      } else rec.tamper.note = 'the E8.5 upload blob is not on disk';
    } else rec.tamper.note = 'no E8.5 upload record (out/ec-upload.json)';

    // 3. the integrity tick, then the next assess tick.
    const driftIds = new Set(rec.tamper.new_findings.filter((f) => f.checkId === 'HASH_DRIFT').map((f) => f.findingId));
    if (driftIds.size) {
      await waitFor('integrity_s', 90, (t) => t.some((x) => (x.integrity?.newHashDrift ?? 0) > 0 && Date.parse(String(x.at)) >= Date.parse(rec.sim_window.started!)));
      const ig = await call('GET', `/api/collect/integrity?tenant=${slug}`);
      rec.tamper.eo_finding_ids = (Array.isArray(ig.json) ? ig.json : []).filter((f) => driftIds.has(String(get(f, 'ecFindingId')))).map((f) => String(get(f, 'findingId')));
    }
    if (blobPath && blobOrig) {
      fs.writeFileSync(blobPath, blobOrig);
      rec.tamper.restored_sha256 = sha256(fs.readFileSync(blobPath));
      rec.tamper.restored = rec.tamper.restored_sha256 === rec.tamper.original_sha256;
      blobOrig = null;
    }
    ticks = await waitFor('second_assess_s', 240, (t) => assessTicks(t).some((a) => a.assess?.ok && Date.parse(String(a.at)) > Date.parse(String(first.at)) && Date.parse(String(a.at)) >= Date.parse(rec.seed?.applied_at ?? rec.sim_window.started!)));
    // 4. revert the seed (the finally block retries on an error).
    if (seedApplied && rec.seed) {
      try {
        await writeSeed(D, ctx.urls.sim, rec.seed, rec.seed.from, () => { rec.sim_window.harness_writes++; });
        rec.seed.reverted = true;
        seedApplied = false;
      } catch (e) {
        rec.seed.revert_error = e instanceof Error ? e.message : String(e);
      }
    }
    rec.sim_window.ended = ctx.nowIso();
    try {
      rec.sim_window.writes = writesInWindow(await D.queryLedger(ctx.urls.sim), rec.sim_window.started, rec.sim_window.ended).length;
    } catch (e) {
      rec.sim_window.error = e instanceof Error ? e.message : String(e);
    }
    rec.ticks = ticks;
    rec.registered_tenants = Object.keys((get(rec.status, 'tenants') as Record<string, unknown> | undefined) ?? {}).sort();
    const nt = await call('GET', `/api/collect/notices?tenant=${slug}`);
    rec.notices = Array.isArray(nt.json) ? nt.json : [];
    const ig2 = await call('GET', `/api/collect/integrity?tenant=${slug}`);
    rec.integrity = Array.isArray(ig2.json) ? ig2.json : [];

    // 5. V128 on the same second EO.
    await runEoRoutes(ctx, call, routes);
  } catch (e) {
    rec.error = e instanceof Error ? e.message : String(e);
  } finally {
    if (blobPath && blobOrig) {
      try { fs.writeFileSync(blobPath, blobOrig); rec.tamper.restored_sha256 = sha256(fs.readFileSync(blobPath)); rec.tamper.restored = rec.tamper.restored_sha256 === rec.tamper.original_sha256; } catch { /* recorded as not restored */ }
    }
    if (seedApplied && rec.seed) {
      try { await writeSeed(D, ctx.urls.sim, rec.seed, rec.seed.from, () => { rec.sim_window.harness_writes++; }); rec.seed.reverted = true; } catch (e) { rec.seed.revert_error = e instanceof Error ? e.message : String(e); }
    }
    ctx.stopTree(proc);
    ctx.stopTree(ecProc);
    rec.real_db.after = counter(realDb, slug, rec.real_db.tenant_id);
    rec.real_db.changed = countDiff(rec.real_db.before, rec.real_db.after);
    if (rec.real_db.changed === null || rec.real_db.changed.length > 0) {
      rec.error = rec.error ?? `the real ces.db ${rec.real_db.changed === null ? 'was not counted' : `changed: ${rec.real_db.changed.join(', ')}`}`;
    }
    rec.ended = ctx.nowIso();
    save();
  }
  const okCont = !rec.error && assessTicks(rec.ticks).length >= 2;
  const okRoutes = !routes.error && routes.calls.length > 0 && routes.calls.every((c) => c.ok || c.note?.startsWith('not run'));
  return {
    rc: okCont && okRoutes ? 0 : 1,
    ...(okCont && okRoutes ? {} : { detail: [rec.error, routes.error, !okCont ? `${assessTicks(rec.ticks).length} assess tick(s)` : null, !okRoutes ? `routes not ok: ${routes.calls.filter((c) => !c.ok).map((c) => `${c.method} ${c.route} ${c.status}`).join(', ')}` : null].filter(Boolean).join('; ') }),
    extra: { assess_ticks: assessTicks(rec.ticks).length, seed: rec.seed?.policy_id ?? null, tamper_findings: rec.tamper.new_findings.length, eo_integrity: rec.tamper.eo_finding_ids.length, routes: routes.calls.length, files: [FIN29_FILES.eoContinuous, FIN29_FILES.eoRoutes] },
  };
}

/** V128: EO's extra routes on the second EO (scenario tenant, after every scored step). */
export async function runEoRoutes(ctx: Pick<Fin29StepCtx, 'slug'>, call: (m: string, p: string, x?: Parameters<HttpCall>[2]) => Promise<HttpResult>, rec: EoRoutesRecord): Promise<void> {
  const slug = ctx.slug;
  const q = `tenant=${encodeURIComponent(slug)}`;
  const push = (route: string, method: string, r: HttpResult, want: number[], ok: boolean, note?: string, keep: string[] = []): void => {
    rec.calls.push({ route, method, status: r.status, want: want.join('|'), ok: ok && r.status !== null && want.includes(r.status), ...(note ? { note } : {}), detail: brief(r, keep) });
  };
  // manual capture and on-demand collect
  const cap = await call('POST', `/api/evidence-explorer/capture?${q}`, { json: {}, timeoutMs: 600000 });
  push('/api/evidence-explorer/capture', 'POST', cap, [200], typeof get(cap.json, 'capturedCount') === 'number', undefined, ['capturedCount', 'liveSignals']);
  const col = await call('POST', `/api/collect?${q}`, { json: {}, timeoutMs: 600000 });
  push('/api/collect', 'POST', col, [200], !!col.json);
  // policy re-import (idempotent: one policy EO holds, unchanged)
  const held = await call('GET', `/api/policies?${q}`);
  const body = policyReimportBody(slug, held.json);
  const before = Array.isArray(held.json) ? held.json.length : rowsOfData(get(held.json, 'policies')).length;
  if (body) {
    const imp = await call('POST', '/api/policies/import', { json: body });
    const after = await call('GET', `/api/policies?${q}`);
    const n = Array.isArray(after.json) ? after.json.length : rowsOfData(get(after.json, 'policies')).length;
    push('/api/policies/import', 'POST', imp, [201], get(imp.json, 'imported') === 1 && n === before, `store ${before} -> ${n} (idempotent re-import of ${String(body.policies[0].domain)})`, ['imported']);
  } else rec.calls.push({ route: '/api/policies/import', method: 'POST', status: held.status, want: '201', ok: false, note: `no held policy to re-import (GET /api/policies HTTP ${held.status})` });
  // risk assessment
  const ing = await call('POST', `/api/risk-assessment/ingest?${q}`, { json: {}, timeoutMs: 600000 });
  push('/api/risk-assessment/ingest', 'POST', ing, [200], !!ing.json, undefined, ['totalNew', 'totalUpdated', 'totalErrors']);
  const sc = await call('POST', `/api/risk-assessment/auto-score?${q}`, { json: {} });
  push('/api/risk-assessment/auto-score', 'POST', sc, [200], !!sc.json, undefined, ['scored', 'skipped']);
  const year = new Date().getUTCFullYear();
  const snapBefore = await call('GET', `/api/risk-assessment/snapshots/${year}?${q}`);
  const one = await call('POST', `/api/risk-assessment/annual-review/one-click?${q}`, { json: { reviewedBy: 'harness (V128, fictional)', reviewNotes: 'V128 probe' }, timeoutMs: 600000 });
  if (snapBefore.status === 200) {
    // An earlier run this year already wrote the immutable annual snapshot: the refusal is the designed outcome.
    push('/api/risk-assessment/annual-review/one-click', 'POST', one, [500, 409], /immutable|already exists/i.test(one.text), `the ${year} snapshot already exists (immutable): refused as designed`);
  } else push('/api/risk-assessment/annual-review/one-click', 'POST', one, [200], get(one.json, 'success') === true, `the first ${year} annual review`);
  const ren = await call('POST', `/api/risk-assessment/render/report?${q}`, { json: {}, timeoutMs: 300000 });
  push('/api/risk-assessment/render/report', 'POST', ren, [200], get(ren.json, 'state') === 'rendered', undefined, ['state']);
  // training email and certificate (needs a person and a course)
  const ppl = await call('GET', `/api/personnel?${q}`);
  const people = Array.isArray(ppl.json) ? (ppl.json as Array<Record<string, unknown>>) : [];
  const person = people.find((p) => /^[0-9a-f-]{36}$/i.test(String(p.id ?? '')) && p.status !== 'offboarded') ?? people.find((p) => /^[0-9a-f-]{36}$/i.test(String(p.id ?? '')));
  const cat = await call('GET', `/api/training/catalog?${q}`);
  const courses = rowsOfData(get(cat.json, 'courses'));
  const course = courses.find((c) => str(get(c, 'id')));
  rec.personnel_id = person ? String(person.id) : null;
  rec.course_id = course ? String(get(course, 'id')) : null;
  if (person && course) {
    const em = await call('POST', `/api/personnel/${person.id}/training/email?${q}`, { json: { courseIds: [rec.course_id] } });
    push('/api/personnel/:id/training/email', 'POST', em, [200], typeof get(em.json, 'emailText') === 'string' && String(get(em.json, 'emailText')).length > 0);
    const fd = new FormData();
    fd.append('courseId', rec.course_id!);
    // PH-5 (R-F2 V128, R-EO diff A): EO's certificate upload takes PDF / image types (a refused type answers 400 JSON).
    fd.append('file', new Blob([Buffer.from('%PDF-1.4\nSIMULATED CUSTOMER (FICTIONAL): V128 training certificate probe\n', 'utf8')], { type: 'application/pdf' }), 'v128-certificate.pdf');
    const ce = await call('POST', `/api/personnel/${person.id}/training/certificate?${q}`, { body: fd });
    push('/api/personnel/:id/training/certificate', 'POST', ce, [200], !!str(get(ce.json, 'id')), undefined, ['id', 'type']);
  } else {
    const why = `not run here: ${person ? '' : 'no personnel record'}${!person && !course ? ' and ' : ''}${course ? '' : 'no training course'} for ${slug}`;
    rec.calls.push({ route: '/api/personnel/:id/training/email', method: 'POST', status: null, want: '200', ok: false, note: why });
    rec.calls.push({ route: '/api/personnel/:id/training/certificate', method: 'POST', status: null, want: '200', ok: false, note: why });
  }
  // EO composes the assignment email and returns it; it has no outbox of its own (Muster's simulated outbox is FD-6's).
  rec.outbox = { present: false, note: 'EO returns the email text (POST /api/personnel/:id/training/email); EO has no mail outbox, so nothing is "sent" (FD-6: no real sender in V1)' };
  const pdf = await call('GET', `/api/screening/element6-form?name=${encodeURIComponent('Fictional Person')}&org=${encodeURIComponent('Fictional Org (FICTIONAL)')}`);
  push('/api/screening/element6-form', 'GET', pdf, [200], /pdf/i.test(pdf.headers['content-type'] ?? '') && (pdf.headers['x-fin29-head'] ?? '').startsWith('%PDF'), undefined);
}

// =====================================================================================================================
// E9M
// =====================================================================================================================

export interface MusterCall { name: string; method: string; route: string; status: number | null; want: string; ok: boolean; note?: string; detail?: Record<string, unknown> }
export interface MusterEngagementRecord {
  schema: typeof FIN29_SCHEMAS.musterEngagement;
  taken: string;
  ended?: string;
  slug: string;
  api_url: string;
  probe: { tenant_name: string; tenant_id: string | null; user_email: string; user_id: string | null; role: string; engagement_id: string | null; party_id: string | null; contract_id: string | null; hil_item_id: string | null; session_id: string | null; grant_id: string | null };
  seed_rc: number | null;
  calls: MusterCall[];
  sprs: { muster: number | null; eo: number | null; snapshot_id: string | null; requirements: number };
  error?: string;
}
export interface MusterSurfacesRecord {
  schema: typeof FIN29_SCHEMAS.musterSurfaces;
  taken: string;
  ended?: string;
  slug: string;
  discovery: { run_status: number | null; job_id: string | null; status: string | null; stats: unknown; postures: number | null; envelope_schema: string | null; envelope_sha256: string | null; live_refused_status: number | null; live_refused_error: string | null; error?: string };
  harvest: { status: number | null; facts: number | null; token_refused_status: number | null; token_refused_error: string | null };
  collector_kit: { rc: number | null; file: string | null; sha256: string | null; header_sha256: string | null; file_sha256: string | null; manifest_rc: number | null; manifest_sha256: string | null; error?: string };
  recipe: { rc: number | null; facts: unknown; expected_answer: 'yes' | 'no' | null; no_concierge_rc: number | null; no_concierge_error: string | null; error?: string };
  not_run_here: Array<{ surface: string; why: string }>;
  error?: string;
}

export const V130_NOT_RUN_HERE = [
  { surface: 'results import', why: 'through the watched Muster UI run (FIN-32 / FIN-35, PH-3); not run in this headless round' },
  { surface: 'readiness file import', why: 'through the watched Muster UI run (FIN-32 / FIN-35, PH-3); not run in this headless round' },
];

export function e9mStep(ctx: Fin29EoMusterCtx, d: Fin29EoMusterDeps = {}): Fin29StepDef {
  const engFile = path.join(ctx.P.out, FIN29_FILES.musterEngagement);
  const surfFile = path.join(ctx.P.out, FIN29_FILES.musterSurfaces);
  return {
    id: 'E9M',
    title: 'Muster engagement layer on ces.db (V121, probe tenant) and secondary surfaces (V130) against E3\'s muster-api',
    fatal: false,
    commands: [
      `(cwd ${ctx.rel(ctx.P.musterApi)}, SEED_PASSWORD=<run-only>) node ${ctx.rel(ctx.P.tsx)} scripts/seed.ts --email v121.operator@v121-${ctx.slug}.${E9_FICTIONAL_DOMAIN} --tenant "V121 probe (FICTIONAL) ${ctx.slug}" --role prime`,
      `${ctx.urls.api}: POST /auth/login; GET /auth/me; POST /api/engagements; POST /api/engagements/<id>/parties; POST /api/sessions/sync + POST /api/hil/flag (sub token); POST /api/hil/queue/<id>/resolve; POST/GET/PUT /api/contracts; POST /api/parties/<id>/actions/send-nudge-now; POST /api/touch/events; POST /api/nudges/tick, POST /api/sessions/sync status complete (sub token), POST /api/reassessment/tick (operator token); POST /api/delivery/{artifacts,grants}; POST /api/sprs/score (scored snapshot) -> ${ctx.rel(engFile)}`,
      `V130: POST /api/discovery/run {tenant_slug: ${ctx.slug}} (+ live: true, must be refused); POST /api/harvest/run {sim: true} (+ a bare access_token, must be refused); (MU_API_URL, MU_TOKEN in env) node dist/cli/bin.js collector-kit --out <out/e9>/muster-collector-kit.ps1, collector-kit --manifest, recipes ingest --file <entra-mfa-report output from the sim> --concierge (and without) -> ${ctx.rel(surfFile)}`,
    ],
    run: async () => runE9m(ctx, depsOf(d), { engFile, surfFile }),
  };
}

async function runE9m(ctx: Fin29EoMusterCtx, D: ReturnType<typeof depsOf>, o: { engFile: string; surfFile: string }): Promise<Fin29StepOutcome> {
  for (const f of [o.engFile, o.surfFile]) fs.rmSync(f, { force: true });
  const slug = ctx.slug;
  const api = ctx.urls.api;
  const dir = path.join(ctx.P.out, 'e9');
  fs.mkdirSync(dir, { recursive: true });
  const email = `v121.operator@v121-${slug}.${E9_FICTIONAL_DOMAIN}`;
  const eng: MusterEngagementRecord = {
    schema: FIN29_SCHEMAS.musterEngagement, taken: ctx.nowIso(), slug, api_url: api,
    probe: { tenant_name: `V121 probe (FICTIONAL) ${slug}`, tenant_id: null, user_email: email, user_id: null, role: 'prime', engagement_id: null, party_id: null, contract_id: null, hil_item_id: null, session_id: null, grant_id: null },
    seed_rc: null, calls: [], sprs: { muster: null, eo: null, snapshot_id: null, requirements: 0 },
  };
  const surf: MusterSurfacesRecord = {
    schema: FIN29_SCHEMAS.musterSurfaces, taken: ctx.nowIso(), slug,
    discovery: { run_status: null, job_id: null, status: null, stats: null, postures: null, envelope_schema: null, envelope_sha256: null, live_refused_status: null, live_refused_error: null },
    harvest: { status: null, facts: null, token_refused_status: null, token_refused_error: null },
    collector_kit: { rc: null, file: null, sha256: null, header_sha256: null, file_sha256: null, manifest_rc: null, manifest_sha256: null },
    recipe: { rc: null, facts: null, expected_answer: null, no_concierge_rc: null, no_concierge_error: null },
    not_run_here: V130_NOT_RUN_HERE,
  };
  const save = (): void => {
    fs.writeFileSync(o.engFile, JSON.stringify(eng, null, 2));
    fs.writeFileSync(o.surfFile, JSON.stringify(surf, null, 2));
  };
  const jwtSecret = ctx.musterJwt();
  const opToken = ctx.musterToken();
  if (!ctx.musterApiUp() || !jwtSecret || !opToken) {
    eng.error = surf.error = 'E9M needs E3\'s muster-api (up through the run), its JWT secret and operator token';
    eng.ended = surf.ended = ctx.nowIso();
    save();
    return { rc: 1, detail: eng.error };
  }
  const bearer = (t: string): Record<string, string> => ({ Authorization: `Bearer ${t}` });
  const add = (name: string, method: string, route: string, r: HttpResult, want: number[], extraOk = true, note?: string, keep: string[] = []): HttpResult => {
    eng.calls.push({ name, method, route, status: r.status, want: want.join('|'), ok: extraOk && r.status !== null && want.includes(r.status), ...(note ? { note } : {}), detail: brief(r, keep) });
    return r;
  };
  try {
    // ---------- V121 ----------
    const password = crypto.randomBytes(24).toString('base64url');
    ctx.registerSecret('muster_probe_password', password);
    const seed = await ctx.runCapture('E9M-seed', ctx.node, [ctx.P.tsx, 'scripts/seed.ts', '--email', email, '--tenant', eng.probe.tenant_name, '--role', eng.probe.role], ctx.P.musterApi, { ...process.env, SEED_PASSWORD: password });
    eng.seed_rc = seed.rc;
    const seeded = lastJson(seed.stdout);
    eng.probe.tenant_id = str(get(get(seeded, 'tenant'), 'id'));
    eng.probe.user_id = str(get(get(seeded, 'user'), 'id'));
    const login = add('login', 'POST', '/auth/login', await D.http('POST', `${api}/auth/login`, { json: { email, password } }), [200]);
    const userTok = str(get(login.json, 'token'));
    ctx.registerSecret('muster_probe_login_token', userTok);
    if (!userTok || !eng.probe.tenant_id) throw new Error(`login gave no token (seed rc ${seed.rc}${seed.rc !== 0 ? `: ${(seed.stderr || seed.stdout).trim().slice(0, 200)}` : ''})`);
    const me = add('me', 'GET', '/auth/me', await D.http('GET', `${api}/auth/me`, { headers: bearer(userTok) }), [200]);
    if (str(get(me.json, 'tenant_id')) !== eng.probe.tenant_id) eng.calls[eng.calls.length - 1].note = `me.tenant_id ${String(get(me.json, 'tenant_id'))} != seeded ${eng.probe.tenant_id}`;
    const U = bearer(userTok);
    const e = add('engagement create', 'POST', '/api/engagements', await D.http('POST', `${api}/api/engagements`, { headers: U, json: { engagement_kind: 'prime_and_subs' } }), [201]);
    eng.probe.engagement_id = str(get(e.json, 'id'));
    if (!eng.probe.engagement_id) throw new Error('no engagement id');
    const pr = add('party create', 'POST', '/api/engagements/:id/parties', await D.http('POST', `${api}/api/engagements/${eng.probe.engagement_id}/parties`, { headers: U, json: { name: 'Fictional Subcontractor Co (FICTIONAL)', on_prem_ot: 'no' } }), [201]);
    eng.probe.party_id = str(get(pr.json, 'id'));
    if (!eng.probe.party_id) throw new Error('no party id');
    const subTok = mintMusterToken(ctx.P.musterApi, jwtSecret, { sub: 'v121-sub', tenant_id: eng.probe.tenant_id, party_id: eng.probe.party_id, role: 'sub' });
    const opProbeTok = mintMusterToken(ctx.P.musterApi, jwtSecret, { sub: 'v121-operator', tenant_id: eng.probe.tenant_id, party_id: null, role: 'bhd_operator' });
    ctx.registerSecret('muster_probe_sub_token', subTok);
    ctx.registerSecret('muster_probe_operator_token', opProbeTok);
    eng.probe.session_id = `v121-sess-${crypto.randomUUID().slice(0, 12)}`;
    add('session sync', 'POST', '/api/sessions/sync', await D.http('POST', `${api}/api/sessions/sync`, { headers: bearer(subTok), json: { id: eng.probe.session_id, party_id: eng.probe.party_id, facts: {}, timing_segments: [], selected_stacks: ['m365'], status: 'in_progress' } }), [200, 201]);
    add('session read', 'GET', '/api/sessions/:id', await D.http('GET', `${api}/api/sessions/${eng.probe.session_id}`, { headers: U }), [200]);
    const fl = add('hil flag', 'POST', '/api/hil/flag', await D.http('POST', `${api}/api/hil/flag`, { headers: bearer(subTok), json: { session_id: eng.probe.session_id, question_id: 'v121-probe-question', fact: { answer: 'unsure', confidence: 'low', weight: 1 } } }), [201]);
    eng.probe.hil_item_id = str(get(fl.json, 'id'));
    const qu = add('hil queue', 'GET', '/api/hil/queue', await D.http('GET', `${api}/api/hil/queue`, { headers: U }), [200]);
    const inQueue = Array.isArray(qu.json) && (qu.json as unknown[]).some((x) => get(x, 'id') === eng.probe.hil_item_id);
    if (!inQueue) eng.calls[eng.calls.length - 1].note = 'the flagged item is not in the queue';
    if (eng.probe.hil_item_id) add('hil resolve', 'POST', '/api/hil/queue/:id/resolve', await D.http('POST', `${api}/api/hil/queue/${eng.probe.hil_item_id}/resolve`, { headers: U, json: { advisor_minutes: 5 } }), [200]);
    const ct = add('contract create', 'POST', '/api/contracts', await D.http('POST', `${api}/api/contracts`, { headers: U, json: { party_id: eng.probe.party_id, engagement_id: eng.probe.engagement_id, contract_number: 'FICT-V121-0001', program_name: 'Fictional Program (FICTIONAL)', cmmc_level_required: 2, cui_categories: ['CTI'] } }), [201]);
    eng.probe.contract_id = str(get(ct.json, 'id'));
    if (eng.probe.contract_id) {
      add('contract read', 'GET', '/api/contracts/:id', await D.http('GET', `${api}/api/contracts/${eng.probe.contract_id}`, { headers: U }), [200]);
      add('contract update', 'PUT', '/api/contracts/:id', await D.http('PUT', `${api}/api/contracts/${eng.probe.contract_id}`, { headers: U, json: { program_name: 'Fictional Program, renamed (FICTIONAL)' } }), [200]);
    }
    add('party action send-nudge-now', 'POST', '/api/parties/:id/actions/send-nudge-now', await D.http('POST', `${api}/api/parties/${eng.probe.party_id}/actions/send-nudge-now`, { headers: U, json: {} }), [200, 201]);
    add('touch event', 'POST', '/api/touch/events', await D.http('POST', `${api}/api/touch/events`, { headers: U, json: { mode: 'a', engagement_id: eng.probe.engagement_id, kind: 'v121-probe', minutes: 5 } }), [200, 201]);
    add('touch report', 'GET', '/api/touch/report', await D.http('GET', `${api}/api/touch/report?engagement_id=${eng.probe.engagement_id}`, { headers: U }), [200]);
    const OP = bearer(opProbeTok);
    const day = 86400000;
    add('nudge tick', 'POST', '/api/nudges/tick', await D.http('POST', `${api}/api/nudges/tick`, { headers: OP, json: { now: new Date(Date.now() + 15 * day).toISOString(), engagement_id: eng.probe.engagement_id } }), [200], true, undefined, []);
    // PH-5 (R-F2 V121 red): the reassessment tick flips only a party whose interview is complete (lifecycle complete /
    // ready / validate and a session with completed_at). The probe completes its session here, after the nudge tick (which
    // nudges only unfinished parties) and before the reassessment tick; muster-api's sync moves the party to 'complete'.
    add('session complete', 'POST', '/api/sessions/sync', await D.http('POST', `${api}/api/sessions/sync`, { headers: bearer(subTok), json: { id: eng.probe.session_id, party_id: eng.probe.party_id, facts: {}, timing_segments: [], selected_stacks: ['m365'], status: 'complete', completed_at: new Date().toISOString() } }), [200, 201]);
    const rt = await D.http('POST', `${api}/api/reassessment/tick`, { headers: OP, json: { now: new Date(Date.now() + 400 * day).toISOString(), engagement_id: eng.probe.engagement_id } });
    const flipped = Array.isArray(get(rt.json, 'flipped')) ? (get(rt.json, 'flipped') as unknown[]).map((f) => get(f, 'party_id')) : [];
    const flippedProbe = flipped.includes(eng.probe.party_id);
    add('reassessment tick', 'POST', '/api/reassessment/tick', rt, [200], flippedProbe, flippedProbe ? undefined : `the probe party was not flipped to reassessment_due (flipped ${flipped.length})`, ['flipped']);
    const art = add('delivery artifact', 'POST', '/api/delivery/artifacts', await D.http('POST', `${api}/api/delivery/artifacts`, { headers: OP, json: { engagement_id: eng.probe.engagement_id, kind: 'readiness_report', filename: 'v121-probe-report.txt', content_base64: Buffer.from('SIMULATED CUSTOMER (FICTIONAL): V121 delivery probe\n').toString('base64') } }), [200, 201]);
    void art;
    const gr = add('delivery grant', 'POST', '/api/delivery/grants', await D.http('POST', `${api}/api/delivery/grants`, { headers: OP, json: { engagement_id: eng.probe.engagement_id, grantee_name: 'Fictional Grantee (FICTIONAL)', grantee_email: `grantee@v121-${slug}.${E9_FICTIONAL_DOMAIN}`, expires_in_days: 1 } }), [201]);
    eng.probe.grant_id = str(get(gr.json, 'id')) ?? str(get(get(gr.json, 'grant'), 'id'));
    for (const k of ['token', 'capability_token', 'portal_token']) ctx.registerSecret(`muster_probe_grant_${k}`, str(get(gr.json, k)) ?? str(get(get(gr.json, 'grant'), k)));
    // the grant reply may carry a capability token: keep only its id in the record
    const last = eng.calls[eng.calls.length - 1];
    if (last.detail) delete last.detail.body;
    // SPRS: muster-api's route over the scored snapshot must equal EO's figure.
    const snap = latestPackageSnapshot(ctx.P.out);
    const reqs = requirementResults(snap?.snapshot);
    eng.sprs.requirements = reqs.length;
    eng.sprs.snapshot_id = str(get(snap?.snapshot, 'snapshotId'));
    eng.sprs.eo = typeof get(snap?.snapshot, 'sprs_score') === 'number' ? (get(snap?.snapshot, 'sprs_score') as number) : null;
    if (reqs.length) {
      const sp = add('sprs score', 'POST', '/api/sprs/score', await D.http('POST', `${api}/api/sprs/score`, { headers: U, json: { requirement_results: reqs } }), [200]);
      eng.sprs.muster = typeof get(sp.json, 'sprs') === 'number' ? (get(sp.json, 'sprs') as number) : null;
    }
  } catch (err) {
    eng.error = err instanceof Error ? err.message : String(err);
  }
  eng.ended = ctx.nowIso();

  // ---------- V130 ----------
  const T = bearer(opToken);
  try {
    const run = await D.http('POST', `${api}/api/discovery/run`, { headers: T, json: { tenant_slug: slug } });
    surf.discovery.run_status = run.status;
    surf.discovery.job_id = str(get(run.json, 'id')) ?? str(get(run.json, 'job_id'));
    if (surf.discovery.job_id) {
      const tries = Math.max(1, Math.ceil(300 / 3 * D.pollScale));
      for (let i = 0; i < tries; i++) {
        const j = await D.http('GET', `${api}/api/discovery/run/${surf.discovery.job_id}`, { headers: T });
        const st = str(get(j.json, 'status'));
        surf.discovery.status = st;
        if (st && st !== 'running') {
          surf.discovery.stats = get(j.json, 'stats') ?? null;
          const pz = get(j.json, 'postures');
          surf.discovery.postures = Array.isArray(pz) ? pz.length : pz && typeof pz === 'object' ? Object.keys(pz).length : null;
          const env = get(j.json, 'envelope');
          surf.discovery.envelope_schema = str(get(env, 'schema')) ?? str(get(env, 'schema_version')) ?? str(get(env, 'contract_version'));
          surf.discovery.envelope_sha256 = env ? sha256(JSON.stringify(env)) : null;
          if (st === 'failed') surf.discovery.error = `${String(get(j.json, 'code'))}: ${String(get(j.json, 'error')).slice(0, 200)}`;
          break;
        }
        await D.sleep(3000);
      }
    }
    const live = await D.http('POST', `${api}/api/discovery/run`, { headers: T, json: { tenant_slug: slug, live: true } });
    surf.discovery.live_refused_status = live.status;
    surf.discovery.live_refused_error = str(get(live.json, 'error')) ?? live.text.slice(0, 120);
  } catch (err) {
    surf.discovery.error = err instanceof Error ? err.message : String(err);
  }
  const hv = await D.http('POST', `${api}/api/harvest/run`, { headers: T, json: { sim: true }, timeoutMs: 300000 });
  surf.harvest.status = hv.status;
  const facts = get(hv.json, 'facts');
  surf.harvest.facts = Array.isArray(facts) ? facts.length : null;
  const hvTok = await D.http('POST', `${api}/api/harvest/run`, { headers: T, json: { access_token: 'v130-not-a-real-token' } });
  surf.harvest.token_refused_status = hvTok.status;
  surf.harvest.token_refused_error = str(get(hvTok.json, 'error')) ?? hvTok.text.slice(0, 120);
  const muEnv: NodeJS.ProcessEnv = { ...process.env, MU_API_URL: api, MU_TOKEN: opToken };
  try {
    const kitFile = path.join(dir, 'muster-collector-kit.ps1');
    fs.rmSync(kitFile, { force: true });
    const k = await ctx.runCapture('E9M-mu-collector-kit', ctx.node, ['dist/cli/bin.js', 'collector-kit', '--out', kitFile], ctx.P.musterApi, muEnv);
    const kj = lastJson(k.stdout);
    surf.collector_kit.rc = k.rc;
    surf.collector_kit.file = fs.existsSync(kitFile) ? ctx.rel(kitFile) : null;
    surf.collector_kit.sha256 = str(get(kj, 'sha256'));
    surf.collector_kit.header_sha256 = str(get(kj, 'header_sha256'));
    surf.collector_kit.file_sha256 = fs.existsSync(kitFile) ? sha256(fs.readFileSync(kitFile, 'utf8')) : null;
    const m = await ctx.runCapture('E9M-mu-collector-kit-manifest', ctx.node, ['dist/cli/bin.js', 'collector-kit', '--manifest'], ctx.P.musterApi, muEnv);
    surf.collector_kit.manifest_rc = m.rc;
    surf.collector_kit.manifest_sha256 = str(get(lastJson(m.stdout), 'sha256'));
    if (k.rc !== 0) surf.collector_kit.error = (k.stderr || k.stdout).trim().slice(0, 200);
  } catch (err) {
    surf.collector_kit.error = err instanceof Error ? err.message : String(err);
  }
  try {
    const pols = rowsOfData(await D.simResolve(ctx.urls.sim, CA_POLICIES_REQUEST));
    const rec = entraMfaRecipe(pols);
    surf.recipe.expected_answer = rec.expectedAnswer;
    const f = path.join(dir, 'recipe-entra-mfa-report.json');
    fs.writeFileSync(f, JSON.stringify(rec.body, null, 2));
    const r = await ctx.runCapture('E9M-mu-recipes-ingest', ctx.node, ['dist/cli/bin.js', 'recipes', 'ingest', '--file', f, '--concierge'], ctx.P.musterApi, muEnv);
    surf.recipe.rc = r.rc;
    surf.recipe.facts = lastJson(r.stdout);
    if (r.rc !== 0) surf.recipe.error = (r.stderr || r.stdout).trim().slice(0, 200);
    const n = await ctx.runCapture('E9M-mu-recipes-ingest-no-concierge', ctx.node, ['dist/cli/bin.js', 'recipes', 'ingest', '--file', f], ctx.P.musterApi, muEnv);
    surf.recipe.no_concierge_rc = n.rc;
    surf.recipe.no_concierge_error = (n.stderr || n.stdout).trim().slice(0, 200);
  } catch (err) {
    surf.recipe.error = err instanceof Error ? err.message : String(err);
  }
  surf.ended = ctx.nowIso();
  save();
  const okEng = !eng.error && eng.calls.every((c) => c.ok);
  const okSurf = surf.discovery.status === 'done' && surf.harvest.status === 200 && surf.collector_kit.rc === 0 && surf.recipe.rc === 0;
  return {
    rc: okEng && okSurf ? 0 : 1,
    ...(okEng && okSurf ? {} : { detail: [eng.error, ...eng.calls.filter((c) => !c.ok).map((c) => `${c.name} HTTP ${c.status ?? 'none'}`), !okSurf ? `surfaces: discovery ${surf.discovery.status ?? 'none'}, harvest ${surf.harvest.status ?? 'none'}, kit rc ${surf.collector_kit.rc ?? 'none'}, recipe rc ${surf.recipe.rc ?? 'none'}` : null].filter(Boolean).join('; ').slice(0, 600) }),
    extra: { calls: eng.calls.length, probe_tenant: eng.probe.tenant_id, sprs: eng.sprs, files: [FIN29_FILES.musterEngagement, FIN29_FILES.musterSurfaces] },
  };
}
