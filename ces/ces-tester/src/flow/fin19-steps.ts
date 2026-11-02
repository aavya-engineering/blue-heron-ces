// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * FIN-19 (finishing plan PH-1 harness, FINISH-PLAN.md §3.2 row FIN-19; checks V110-V114 in §1.3): the harness parts
 * the PH-1 slices need, kept out of muster-e2e-run.ts so each is testable with a fake fetch / CLI runner.
 *
 * - V114 (FIN-17): the push-gate and slug probes after E4 (`runPushProbes`), and the `mu plan compile` twin of E3's
 *   API compile (`runMuCompile`). Muster's own EO calls are real because EO now starts at E3 (muster-e2e-run.ts).
 * - V112 (FIN-12): step E8.5b, one upload through EO's own upload route (`postEoRouteUpload`), and step E8.6b, a
 *   supersede pair through the `eo review` CLI plus `eo review list --history` (`runCliReviewPair`).
 * - V113 (FIN-13 + FD-1): step E7C, the cost-gate traversal of one recurring-cost AO op on the simulated tenant
 *   (`runCostTraversal`): dry run (price shown), apply without DP-1, apply with a wrong DP-2, apply with DP-1 and the
 *   correct DP-2. Runs after E8F, so no assessment ever sees the write (AR5: no score can move).
 * - V110 (FIN-10): `scanGateRecords` finds the Stamper GUI's approved manual-gate records (EU run) and
 *   `runEuEoProbe` has EO assess the EU run's own pipeline root (no reviews, no records stores), so a gate record
 *   that credits a non-stack control would show as met there.
 *
 * Tokens never reach a file, a log or argv: principal and approver tokens travel in headers or the child env.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildPushBody, readSse } from './mx-io.js';
import { jsonCall } from './eo-reviews.js';
import { parseAoJson, type AoCliRunner } from './ao-step.js';

const field = (b: unknown, k: string): unknown => (b && typeof b === 'object' ? (b as Record<string, unknown>)[k] : undefined);
const sha256 = (b: Buffer | string): string => crypto.createHash('sha256').update(b).digest('hex');

// ---------- the 28 non-stack controls (AUDIT-NONSTACK.md §1, "Result: 28 controls with 73 objectives") ----------

export const NON_STACK_CONTROLS: readonly string[] = [
  'AT.L2-3.2.1', 'AT.L2-3.2.2', 'AT.L2-3.2.3', 'AU.L2-3.3.8', 'AU.L2-3.3.9', 'IR.L2-3.6.2', 'IR.L2-3.6.3',
  'MA.L2-3.7.1', 'MA.L2-3.7.2', 'MA.L2-3.7.3', 'MA.L2-3.7.6', 'MP.L1-3.8.3', 'MP.L2-3.8.4', 'MP.L2-3.8.9',
  'PE.L1-3.10.1', 'PE.L2-3.10.2', 'PE.L1-3.10.3', 'PE.L1-3.10.4', 'PE.L1-3.10.5', 'PE.L2-3.10.6',
  'PS.L2-3.9.1', 'PS.L2-3.9.2', 'RA.L2-3.11.1', 'CA.L2-3.12.1', 'CA.L2-3.12.2', 'CA.L2-3.12.3', 'CA.L2-3.12.4', 'CM.L2-3.4.4',
];

// ---------- V114: Muster's push-gate and slug probes (after E4) ----------

export const MUSTER_PROBES_SCHEMA = 'ces-tester/muster-probes@1';
/** A control id no Mission Plan covers (not a `btc_gate_*` id, which the gate downgrades to a warning). */
export const PROBE_CONTROL_ID = 'ZZ.L9-9.9.99-v114-probe';
/** The second Muster tenant that must not see a slug another tenant claimed. */
export const PROBE_OTHER_TENANT = 'mx-v114-other-tenant';

/**
 * The cross-file probe body: the E4 push body with one extra normative control in the Tenant Manifest that the
 * Mission Plan does not cover, and no `validationOverride`. muster-api's push gate must answer 409. Null when the TM
 * has no normative_controls to copy (the probe cannot be built without typing a new shape).
 */
export function crossFileProbeBody(body: Record<string, unknown>): Record<string, unknown> | null {
  const clone = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
  delete clone.validationOverride;
  const tm = clone.tenantManifest as Record<string, unknown> | undefined;
  const block = (tm?.tenant_manifest ?? tm) as { normative_controls?: Array<Record<string, unknown>> } | undefined;
  const nc = block?.normative_controls;
  if (!Array.isArray(nc) || nc.length === 0) return null;
  nc.push({ ...nc[0], control_id: PROBE_CONTROL_ID });
  return clone;
}

export interface PushProbeRow {
  status: number | null;
  code?: unknown;
  error?: unknown;
  note?: string;
}
export interface MusterProbesRecord {
  schema: typeof MUSTER_PROBES_SCHEMA;
  taken: string;
  tenant_slug: string;
  cross_file: PushProbeRow;
  other_tenant: PushProbeRow & { tenant_id: string };
}

/** Both probes return before muster-api writes or claims anything (409 at the gate, 404 at the slug check). Never throws. */
export async function runPushProbes(o: {
  apiBase: string;
  token: string;
  otherTenantToken: string | null;
  plansDir: string;
  slug: string;
  fetchImpl?: typeof fetch;
  now?: () => string;
}): Promise<MusterProbesRecord> {
  const f = o.fetchImpl ?? fetch;
  const rec: MusterProbesRecord = {
    schema: MUSTER_PROBES_SCHEMA,
    taken: (o.now ?? (() => new Date().toISOString()))(),
    tenant_slug: o.slug,
    cross_file: { status: null },
    other_tenant: { status: null, tenant_id: PROBE_OTHER_TENANT },
  };
  let body: Record<string, unknown>;
  try {
    body = buildPushBody(o.plansDir, o.slug);
  } catch (err) {
    rec.cross_file.note = rec.other_tenant.note = `no push body: ${err instanceof Error ? err.message : String(err)}`;
    return rec;
  }
  const auth = (t: string): Record<string, string> => ({ Authorization: `Bearer ${t}` });
  const probe = crossFileProbeBody(body);
  if (!probe) rec.cross_file.note = 'not run: the Tenant Manifest has no normative_controls to extend';
  else {
    const r = await jsonCall('POST', `${o.apiBase}/api/plan/push`, probe, auth(o.token), f);
    rec.cross_file = { status: r.status, code: field(r.body, 'code') ?? null, error: field(r.body, 'error') ?? (typeof r.body === 'string' ? r.body : null) };
  }
  if (!o.otherTenantToken) rec.other_tenant.note = 'not run: no token for the second tenant';
  else {
    const r = await jsonCall('POST', `${o.apiBase}/api/plan/push`, body, auth(o.otherTenantToken), f);
    rec.other_tenant = { ...rec.other_tenant, status: r.status, error: field(r.body, 'error') ?? (typeof r.body === 'string' ? r.body : null) };
  }
  return rec;
}

// ---------- V114: `mu plan compile` (FIN-17) ----------

export const MU_COMPILE_SCHEMA = 'ces-tester/mu-plan-compile@1';
export interface MuCompileRecord {
  schema: typeof MU_COMPILE_SCHEMA;
  taken: string;
  argv: string[];
  rc: number | null;
  /** Where the files came from: the `--out` folder mu wrote, or the `files[]` of the JSON mu printed. */
  source: 'out-dir' | 'stdout' | null;
  files: Array<{ name: string; bytes: number; sha256: string }>;
  error?: string;
}

/** The files under `dir` (relative names, forward slashes) with their sha256. */
export function filesUnder(dir: string): Array<{ name: string; bytes: number; sha256: string }> {
  if (!fs.existsSync(dir)) return [];
  const walk = (rel: string): string[] =>
    fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => {
      const r = rel ? `${rel}/${e.name}` : e.name;
      return e.isDirectory() ? walk(r) : e.isFile() ? [r] : [];
    });
  return walk('').map((name) => {
    const buf = fs.readFileSync(path.join(dir, name));
    return { name, bytes: buf.length, sha256: sha256(buf) };
  });
}

/** Writes compile `files[]` ({name, content, encoding?}) under outDir; refuses names that leave it. */
export function writeFilesUnder(outDir: string, files: unknown): number {
  const root = path.resolve(outDir);
  let n = 0;
  for (const x of Array.isArray(files) ? files : []) {
    const name = String(field(x, 'name') ?? '');
    const dest = path.resolve(root, name);
    if (!name || (dest !== root && !dest.startsWith(root + path.sep))) throw new Error(`refused file name outside the plan folder: ${name}`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Buffer.from(String(field(x, 'content') ?? ''), field(x, 'encoding') === 'base64' ? 'base64' : 'utf8'));
    n++;
  }
  return n;
}

/** The last JSON object a CLI printed on stdout (one-line or pretty). */
export function lastJson(stdout: string): Record<string, unknown> | null {
  const t = stdout.trim();
  if (!t) return null;
  const lines = t.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const v = JSON.parse(lines.slice(i).join('\n')) as unknown;
      if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

export interface CliResult {
  rc: number;
  stdout: string;
  stderr: string;
}
/** Runs one CLI call (the run step spawns; tests fake it). `env` carries tokens; argv never does. */
export type CliRunner = (args: string[], env: NodeJS.ProcessEnv) => Promise<CliResult>;

/**
 * `mu plan compile <compile flags> --out <dir>` against E3's muster-api (MU_API_URL / MU_TOKEN in the env). FIN-17's
 * flags: --slug, --discovery <file>, [--org-content <file>] [--answers <file>] [--max-reads <1-3>]. The files come from
 * `--out` (mu writes them there), else from a `files[]` in the printed JSON. Never throws.
 */
export function muCompileArgs(o: { slug: string; discovery: string; orgContent?: string | null; answers?: string | null; maxReads?: number }): string[] {
  return [
    '--slug', o.slug, '--discovery', o.discovery,
    ...(o.orgContent ? ['--org-content', o.orgContent] : []),
    ...(o.answers ? ['--answers', o.answers] : []),
    '--max-reads', String(o.maxReads ?? 2),
  ];
}
export async function runMuCompile(o: { run: CliRunner; args: string[]; outDir: string; env: NodeJS.ProcessEnv; now?: () => string }): Promise<MuCompileRecord> {
  const argv = ['plan', 'compile', ...o.args, '--out', o.outDir];
  const rec: MuCompileRecord = { schema: MU_COMPILE_SCHEMA, taken: (o.now ?? (() => new Date().toISOString()))(), argv, rc: null, source: null, files: [] };
  try {
    fs.rmSync(o.outDir, { recursive: true, force: true });
    const r = await o.run(argv, o.env);
    rec.rc = r.rc;
    if (r.rc !== 0) {
      rec.error = (r.stderr || r.stdout).trim().split(/\r?\n/).slice(-3).join(' ').slice(0, 500);
      return rec;
    }
    let files = filesUnder(o.outDir);
    if (files.length) rec.source = 'out-dir';
    else {
      const j = lastJson(r.stdout);
      if (j && Array.isArray(j.files)) {
        writeFilesUnder(o.outDir, j.files);
        files = filesUnder(o.outDir);
        rec.source = 'stdout';
      }
    }
    rec.files = files;
    if (!files.length) rec.error = 'mu printed no files[] and wrote no --out folder';
  } catch (err) {
    rec.error = err instanceof Error ? err.message : String(err);
  }
  return rec;
}

// ---------- V112: E8.5b, one upload through EO's own upload route (FIN-12) ----------

export const EO_ROUTE_UPLOAD_SCHEMA = 'ces-tester/eo-route-upload@1';
/** The upload's control and the objective of the supersede pair: a multi-objective non-stack control that no scenario
 * reviews on this objective ([b] has no record in any customer file), so one met review leaves the control at partial
 * coverage (not_assessed) and no score moves (AR5). Not the V80 probe (CA.L2-3.12.4). */
export const EO_ROUTE_UPLOAD_CONTROL = 'PE.L2-3.10.2';
export const CLI_REVIEW_OBJECTIVE = 'PE.L2-3.10.2[b]';

/** The upload's bytes: a fictional, synthetic text file (no customer data). */
export function eoRouteUploadContent(slug: string): Buffer {
  return Buffer.from(
    `FICTIONAL / SYNTHETIC test artifact (CES harness, FIN-19 step E8.5b).\n` +
      `Tenant: ${slug}. Uploaded through EO's own upload route (POST /api/ec/ingest).\n` +
      `Visitor log extract for the simulated facility; reviewed only for ${CLI_REVIEW_OBJECTIVE}.\n`,
    'utf8',
  );
}

export interface EoRouteUploadRecord {
  schema: typeof EO_ROUTE_UPLOAD_SCHEMA;
  taken: string;
  url: string;
  tenant: string;
  control_ids: string[];
  filename: string;
  sha256: string;
  form_id: string | null;
  emx_ids: string[];
  uploader_upn: string | null;
  http_status: number | null;
  item_id: string | null;
  uploaded_by: string | null;
  response?: unknown;
  note?: string;
}

/** POST /api/ec/ingest (multipart) with the uploader's principal header beside EO's bearer. Never throws. */
export async function postEoRouteUpload(o: {
  eoUrl: string;
  slug: string;
  headers: Record<string, string>;
  principalToken: string | null;
  uploaderUpn: string | null;
  submittedByRole: string;
  formId?: string;
  emxIds?: string[];
  fetchImpl?: typeof fetch;
  now?: () => string;
}): Promise<EoRouteUploadRecord> {
  const f = o.fetchImpl ?? fetch;
  const content = eoRouteUploadContent(o.slug);
  const filename = `fin19-eo-route-upload-${o.slug}.txt`;
  const rec: EoRouteUploadRecord = {
    schema: EO_ROUTE_UPLOAD_SCHEMA,
    taken: (o.now ?? (() => new Date().toISOString()))(),
    url: `${o.eoUrl}/api/ec/ingest`,
    tenant: o.slug,
    control_ids: [EO_ROUTE_UPLOAD_CONTROL],
    filename,
    sha256: sha256(content),
    form_id: o.formId ?? null,
    emx_ids: o.emxIds ?? [],
    uploader_upn: o.uploaderUpn,
    http_status: null,
    item_id: null,
    uploaded_by: null,
  };
  if (!o.principalToken) {
    rec.note = 'not run: no uploader principal (no review plan)';
    return rec;
  }
  try {
    const fd = new FormData();
    fd.append('file', new Blob([content], { type: 'text/plain' }), filename);
    fd.append('tenantSlug', o.slug);
    fd.append('controlIds', EO_ROUTE_UPLOAD_CONTROL);
    fd.append('source', 'manual_upload');
    fd.append('submittedByRole', o.submittedByRole);
    if (o.formId) fd.append('form_id', o.formId);
    if (o.emxIds?.length) fd.append('emx_ids', o.emxIds.join(','));
    const r = await f(rec.url, { method: 'POST', headers: { ...o.headers, 'x-ces-principal': o.principalToken }, body: fd, signal: AbortSignal.timeout(120000) });
    rec.http_status = r.status;
    const text = await r.text();
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* text */ }
    rec.response = body;
    const item = (field(body, 'item') ?? body) as Record<string, unknown>;
    rec.item_id = (field(item, 'itemId') ?? field(item, 'id') ?? null) as string | null;
    const ub = field(item, 'uploadedBy');
    rec.uploaded_by = (typeof ub === 'string' ? ub : (field(ub, 'upn') as string | undefined)) ?? null;
  } catch (err) {
    rec.note = `error: ${err instanceof Error ? err.message : String(err)}`;
  }
  return rec;
}

// ---------- V112: E8.6b, the supersede pair through `eo review` (FIN-12) ----------

export const EO_REVIEW_CLI_SCHEMA = 'ces-tester/eo-review-cli@1';
export interface EoReviewCliRecord {
  schema: typeof EO_REVIEW_CLI_SCHEMA;
  taken: string;
  tenant: string;
  control_id: string;
  objective_id: string;
  artifact_sha256: string | null;
  reviewer_upn: string | null;
  mint_status: number | null;
  calls: Array<{ argv: string[]; rc: number; review_id: string | null; supersedes: string[]; error?: string }>;
  list: { rc: number | null; live: Array<{ review_id: string; objective_id: string }>; history: Array<{ review_id: string; objective_id: string; superseded_by: string | null }> } | null;
  note?: string;
}

/**
 * Mints an approver token for the plan's reviewer (EO's /api/approver-tokens, the operator's principal), then
 * `eo review` twice on one objective (both met; the second must supersede the first) and `eo review list --history`.
 * The token goes to the CLI as CES_EO_APPROVER_TOKEN (env), never on argv. Never throws.
 */
export async function runCliReviewPair(o: {
  eoUrl: string;
  slug: string;
  reviewerUpn: string | null;
  artifactSha256: string | null;
  baseHeaders: Record<string, string>;
  operatorToken: string;
  run: CliRunner;
  env: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  now?: () => string;
}): Promise<{ rc: number; record: EoReviewCliRecord }> {
  const rec: EoReviewCliRecord = {
    schema: EO_REVIEW_CLI_SCHEMA,
    taken: (o.now ?? (() => new Date().toISOString()))(),
    tenant: o.slug,
    control_id: EO_ROUTE_UPLOAD_CONTROL,
    objective_id: CLI_REVIEW_OBJECTIVE,
    artifact_sha256: o.artifactSha256,
    reviewer_upn: o.reviewerUpn,
    mint_status: null,
    calls: [],
    list: null,
  };
  if (!o.reviewerUpn) {
    rec.note = 'not run: the review plan has no reviewer';
    return { rc: 0, record: rec };
  }
  if (!o.artifactSha256) {
    rec.note = 'not run: E8.5b stored no upload to review';
    return { rc: 1, record: rec };
  }
  const mint = await jsonCall('POST', `${o.eoUrl}/api/approver-tokens?tenant=${encodeURIComponent(o.slug)}`, { approverUpn: o.reviewerUpn }, { ...o.baseHeaders, 'x-ces-principal': o.operatorToken }, o.fetchImpl ?? fetch);
  rec.mint_status = mint.status;
  if (mint.status !== 201) {
    rec.note = `approver-token mint HTTP ${mint.status}`;
    return { rc: 1, record: rec };
  }
  const env = { ...o.env, CES_EO_URL: o.eoUrl, CES_EO_APPROVER_TOKEN: String(field(mint.body, 'token') ?? '') };
  for (const notes of ['FIN-19 E8.6b first review (to be superseded)', 'FIN-19 E8.6b superseding review']) {
    const argv = ['review', '--tenant', o.slug, '--control', EO_ROUTE_UPLOAD_CONTROL, '--objective', CLI_REVIEW_OBJECTIVE, '--hash', o.artifactSha256, '--verdict', 'met', '--notes', notes];
    const r = await o.run(argv, env);
    const j = lastJson(r.stdout);
    rec.calls.push({
      argv,
      rc: r.rc,
      review_id: (field(j, 'reviewId') as string | undefined) ?? null,
      supersedes: Array.isArray(field(j, 'supersedes')) ? (field(j, 'supersedes') as string[]) : [],
      ...(r.rc !== 0 ? { error: (r.stderr || r.stdout).trim().slice(0, 300) } : {}),
    });
  }
  const largv = ['review', 'list', '--tenant', o.slug, '--control', EO_ROUTE_UPLOAD_CONTROL, '--history'];
  const l = await o.run(largv, env);
  const lj = lastJson(l.stdout);
  const rows = (k: string): Array<Record<string, unknown>> => (Array.isArray(field(lj, k)) ? (field(lj, k) as Array<Record<string, unknown>>) : []);
  rec.list = {
    rc: l.rc,
    live: rows('reviews').map((x) => ({ review_id: String(x.reviewId ?? ''), objective_id: String(x.objectiveId ?? '') })),
    history: rows('history').map((x) => ({ review_id: String(x.reviewId ?? ''), objective_id: String(x.objectiveId ?? ''), superseded_by: typeof x.supersededBy === 'string' ? x.supersededBy : null })),
  };
  const ok = rec.calls.length === 2 && rec.calls.every((c) => c.rc === 0 && c.review_id) && l.rc === 0;
  return { rc: ok ? 0 : 1, record: rec };
}

// ---------- V113: E7C, the cost-gate traversal (FIN-13 + FD-1) ----------

export const ADMINOPS_COST_SCHEMA = 'ces-tester/adminops-cost@1';
/** The recurring-cost op each scenario traverses (sim only). E-01 = Audit Log Retention (recurring above 90 days); the
 * simulator applies it (stacksim coverage-ao: "paired read observes the write"). S1 only: one traversal proves it. */
export const COST_PROBES: Readonly<Record<string, { op: string }>> = { 's1-mach': { op: 'E-01' } };

export type CostCallKind = 'dry_run' | 'apply_no_dp1' | 'apply_wrong_dp2' | 'apply_dp1_dp2';
export interface CostCallRecord {
  call: CostCallKind;
  argv: string[];
  rc: number;
  success: boolean | null;
  outcome: string | null;
  cost_outcome: string | null;
  cost_reason: string | null;
  monthly_usd: number | null;
  price_date: string | null;
  ack_hash: string | null;
  evidence_row_id: string | null;
  typed?: string;
  detail?: string;
}
export interface AdminOpsCostRecord {
  schema: typeof ADMINOPS_COST_SCHEMA;
  tenant_slug: string;
  op: string | null;
  requestor_upn: string | null;
  started: string;
  ended: string;
  calls: CostCallRecord[];
  ok: boolean;
  note?: string;
}

const rowIdOf = (p: unknown): string | null => (typeof p === 'string' && p.includes('/') ? p.slice(p.indexOf('/') + 1) : null);

export function summarizeCostCall(call: CostCallKind, argv: string[], r: { rc: number; stdout: string; stderr: string }, typed?: string): CostCallRecord {
  const j = parseAoJson(r.stdout);
  const ev = (j?.evidence ?? {}) as Record<string, any>;
  const cg = (ev.metadata?.costGate ?? {}) as Record<string, any>;
  return {
    call,
    argv,
    rc: r.rc,
    success: typeof j?.success === 'boolean' ? j.success : null,
    outcome: typeof ev.outcome === 'string' ? ev.outcome : null,
    cost_outcome: typeof cg.outcome === 'string' ? cg.outcome : null,
    cost_reason: typeof cg.reason === 'string' ? cg.reason : typeof j?.error === 'string' ? j.error : null,
    monthly_usd: typeof cg.monthlyUsd === 'number' ? cg.monthlyUsd : null,
    price_date: typeof cg.priceDate === 'string' ? cg.priceDate : null,
    ack_hash: typeof cg.ackHash === 'string' ? cg.ackHash : null,
    evidence_row_id: rowIdOf(j?.evidencePath),
    ...(typed !== undefined ? { typed } : {}),
    ...(r.rc !== 0 || !j ? { detail: `rc ${r.rc}${j ? '' : ', no JSON result'}: ${(r.stderr || r.stdout).trim().split(/\r?\n/).slice(-1)[0] ?? ''}`.slice(0, 300) } : {}),
  };
}

/** The four calls. DP-1 is built from the dry run's own notice (nothing typed but the DP-2 text). Never throws. */
export async function runCostTraversal(o: {
  op: string;
  slug: string;
  requestor: string | null;
  env: NodeJS.ProcessEnv;
  runCli: AoCliRunner;
  now?: () => string;
}): Promise<AdminOpsCostRecord> {
  const now = o.now ?? (() => new Date().toISOString());
  const rec: AdminOpsCostRecord = { schema: ADMINOPS_COST_SCHEMA, tenant_slug: o.slug, op: o.op, requestor_upn: o.requestor, started: now(), ended: '', calls: [], ok: false };
  try {
    if (!o.requestor) {
      rec.note = 'not run: the registry record lacks resources.operator_upn';
      return rec;
    }
    const base = ['exec', o.op, '--tenant', o.slug, '--requestor', o.requestor];
    const run = async (call: CostCallKind, extra: string[], typed?: string): Promise<CostCallRecord> => {
      const argv = [...base, ...extra, '--json'];
      const c = summarizeCostCall(call, argv, await o.runCli(argv, o.env, `${o.op}-cost-${call}`), typed);
      rec.calls.push(c);
      return c;
    };
    const d = await run('dry_run', []);
    if (d.monthly_usd === null || !d.ack_hash) {
      rec.note = `the dry run showed no price (cost gate ${d.cost_outcome ?? 'absent'}${d.cost_reason ? `: ${d.cost_reason}` : ''}); DP-1 cannot be built`;
      return rec;
    }
    const ack = JSON.stringify({ opId: o.op, ackHash: d.ack_hash, monthlyUsd: d.monthly_usd, priceDate: d.price_date, operator: o.requestor, at: now() });
    await run('apply_no_dp1', ['--apply']);
    const wrong = `${o.op} ${(d.monthly_usd + 1).toFixed(2)}`;
    await run('apply_wrong_dp2', ['--apply', '--cost-ack', ack, '--confirm-cost', wrong], wrong);
    const right = `${o.op} ${d.monthly_usd.toFixed(2)}`;
    await run('apply_dp1_dp2', ['--apply', '--cost-ack', ack, '--confirm-cost', right], right);
    const by = (k: CostCallKind) => rec.calls.find((c) => c.call === k);
    rec.ok =
      by('apply_no_dp1')?.success === false && /dp1_missing/.test(by('apply_no_dp1')?.cost_reason ?? '') &&
      by('apply_wrong_dp2')?.success === false && /dp2_mismatch/.test(by('apply_wrong_dp2')?.cost_reason ?? '') &&
      by('apply_dp1_dp2')?.success === true && by('apply_dp1_dp2')?.cost_outcome === 'enabled';
  } catch (err) {
    rec.note = `error: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    rec.ended = now();
  }
  return rec;
}

// ---------- V110: the EU run's manual-gate records and EO's view of them (FIN-10, FD-2) ----------

export interface GateRecord {
  file: string;
  /** PH-5 (V110): the Stamper task the record belongs to (its raw response's task_id, else the evidence-by-task folder). */
  task_id: string | null;
  entry_id: string | null;
  controls: string[];
  gate_action: string | null;
  verdict: string | null;
}

/** Every Stamper evidence JSON under `dirs` that is a manual-gate record (metadata.gate 'manual'). */
export function scanGateRecords(dirs: string[]): GateRecord[] {
  const out: GateRecord[] = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const rel of fs.readdirSync(dir, { recursive: true }) as string[]) {
      if (!rel.endsWith('.json')) continue;
      const p = path.join(dir, rel);
      let j: Record<string, any>;
      try { j = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, any>; } catch { continue; }
      if (j?.metadata?.gate !== 'manual') continue;
      const controls = [...new Set<string>([...(j.metadata?.controlIds ?? []), ...(j.registryEntry?.control_ids ?? [])])];
      const relFile = path.relative(dir, p).split(path.sep).join('/');
      let rawTask: unknown = null;
      try { rawTask = typeof j.rawResponse === 'string' ? (JSON.parse(j.rawResponse) as Record<string, unknown>)?.task_id : null; } catch { rawTask = null; }
      const task_id = typeof rawTask === 'string' ? rawTask : path.basename(dir) === 'evidence-by-task' && relFile.includes('/') ? relFile.split('/')[0]! : null;
      out.push({ file: relFile, task_id, entry_id: j.registryEntry?.entry_id ?? null, controls, gate_action: j.metadata?.gateAction ?? null, verdict: j.complianceVerdict ?? null });
    }
  }
  return out;
}

/** The Stamper console's row-id form of a task id (public/index.html escId; the SPA kit's is the same). */
export const consoleEscId = (s: string): string => String(s).replace(/[^a-zA-Z0-9_-]/g, '-');

/**
 * PH-5 (R-F2 V110 red): the gate records whose task the console approved. In Incremental mode the operator approves
 * at step level (`approval-<task>`) and the task's manual-gate sub-command then runs without a terminal, so its record
 * says gateAction "none" although the console approved it; a sub-command row is `sub-approval-<task>-<sub>`.
 */
export function consoleApprovedGates(gates: GateRecord[], rows: readonly string[]): GateRecord[] {
  const ids = new Set(rows);
  return gates.filter((g) => {
    if (!g.task_id) return false;
    const t = consoleEscId(g.task_id);
    return ids.has(`approval-${t}`) || rows.some((r) => r.startsWith(`sub-approval-${t}-`));
  });
}

export const EU_EO_PROBE_SCHEMA = 'ces-tester/eu-eo-probe@1';
export interface EuEoProbeRecord {
  schema: typeof EU_EO_PROBE_SCHEMA;
  taken: string;
  variant: string;
  tenant: string;
  gates: GateRecord[];
  /** PH-5: the approval rows the console run clicked (StamperUiDriveResult.approvedRows), when known. */
  console_approved_rows?: string[];
  approved_non_stack: string[];
  assess_rc: number | null;
  snapshot_id: string | null;
  controls: Array<{ control_id: string; status: string | null; statusRationale: string | null; sources: Array<{ type: string | null; result: string | null }> }>;
  note?: string;
}

/**
 * After an EU drive (sim still up): EO on port 4002 over the EU run's own pipeline root (CES_PIPELINE_ROOT = the
 * variant's pl, no document reviews and no records stores there), one assess, then GET /api/assessment. Records each
 * non-stack control the GUI approved a gate for, as EO decided it. The caller ensures port 4002 is free. Never throws.
 */
export async function runEuEoProbe(o: {
  variant: string;
  slug: string;
  cesRoot: string;
  tsx: string;
  pipelineRoot: string;
  twinPlansDir: string;
  workDir: string;
  baseEnv: NodeJS.ProcessEnv;
  /** PH-5: the approval rows the console run clicked; their gate records count as approved (see consoleApprovedGates). */
  approvedRows?: readonly string[];
  log?: (l: string) => void;
}): Promise<EuEoProbeRecord> {
  const eoUrl = 'http://127.0.0.1:4002';
  const tenantPl = path.join(o.pipelineRoot, 'Stamper', 'plan-data', o.slug);
  const gates = scanGateRecords([path.join(tenantPl, 'evidence'), path.join(tenantPl, 'evidence-by-task')]);
  const nonStack = new Set(NON_STACK_CONTROLS);
  const approvedGates = [...gates.filter((g) => g.gate_action === 'approved'), ...consoleApprovedGates(gates, o.approvedRows ?? [])];
  const approved = [...new Set(approvedGates.flatMap((g) => g.controls).filter((c) => nonStack.has(c)))].sort();
  const rec: EuEoProbeRecord = { schema: EU_EO_PROBE_SCHEMA, taken: new Date().toISOString(), variant: o.variant, tenant: o.slug, gates, ...(o.approvedRows ? { console_approved_rows: [...o.approvedRows] } : {}), approved_non_stack: approved, assess_rc: null, snapshot_id: null, controls: [] };
  let eo: ChildProcess | undefined;
  try {
    // EO finds the pushed Tenant Manifest under <pipeline root>/Stamper/plan-data/<slug>/plans: the twin's push.
    const plans = path.join(tenantPl, 'plans');
    if (!fs.existsSync(plans) && fs.existsSync(o.twinPlansDir)) fs.cpSync(o.twinPlansDir, plans, { recursive: true });
    fs.mkdirSync(o.workDir, { recursive: true });
    const env: NodeJS.ProcessEnv = {
      ...o.baseEnv,
      CES_PIPELINE_ROOT: o.pipelineRoot,
      REGISTRY_PATH: path.join(o.cesRoot, 'ces-stamper', 'src', 'registry', 'cmmc-l2-commands.registry.json'),
      STORAGE_ROOT: path.join(o.workDir, 'eo'),
      COMPLIANCE_REPO_PATH: path.join(o.workDir, 'eo-repo'),
      TENANT_SLUG: o.slug,
      EO_PORT: '4002',
    };
    delete env.TENANT_MANIFEST_PATH;
    const lo = fs.openSync(path.join(o.workDir, 'eu-eo.out'), 'w');
    const le = fs.openSync(path.join(o.workDir, 'eu-eo.err'), 'w');
    eo = spawn(process.execPath, [o.tsx, 'src/eo/index.ts'], { cwd: path.join(o.cesRoot, 'ces-eo'), env, stdio: ['ignore', lo, le], windowsHide: true });
    fs.closeSync(lo);
    fs.closeSync(le);
    let up = false;
    for (let i = 0; i < 120 && !up; i++) {
      try {
        await fetch(`${eoUrl}/api/health`, { signal: AbortSignal.timeout(3000) });
        up = true;
      } catch {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    if (!up) {
      rec.note = 'EO did not answer /api/health';
      return rec;
    }
    const a = await readSse({ url: `${eoUrl}/api/assess?tenant=${o.slug}`, stop: 'assess_done', outFile: path.join(o.workDir, 'eu-eo-assess.json'), timeoutMs: 900000 });
    rec.assess_rc = a.rc;
    rec.snapshot_id = (a.events.find((e) => (e as { type?: string }).type === 'assess_summary') as { snapshotId?: string } | undefined)?.snapshotId ?? null;
    const s = await jsonCall('GET', `${eoUrl}/api/assessment?tenant=${encodeURIComponent(o.slug)}`, undefined, {});
    const controls = (Array.isArray(field(s.body, 'controls')) ? field(s.body, 'controls') : []) as Array<Record<string, any>>;
    rec.controls = controls
      .filter((c) => nonStack.has(String(c.control_id)))
      .map((c) => ({
        control_id: String(c.control_id),
        status: typeof c.status === 'string' ? c.status : null,
        statusRationale: typeof c.statusRationale === 'string' ? c.statusRationale : null,
        sources: (Array.isArray(c.sources) ? c.sources : []).map((x: Record<string, unknown>) => ({ type: typeof x.type === 'string' ? x.type : null, result: typeof x.result === 'string' ? x.result : null })),
      }));
    if (s.status !== 200) rec.note = `GET /api/assessment HTTP ${s.status}`;
  } catch (err) {
    rec.note = `error: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    if (eo?.pid && eo.exitCode === null) {
      const { spawnSync } = await import('node:child_process');
      spawnSync('taskkill.exe', ['/PID', String(eo.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    }
    o.log?.(`  [${o.variant}] V110 EU probe: ${rec.gates.length} gate record(s), ${approved.length} approved non-stack control(s), EO assess rc ${rec.assess_rc ?? 'n/a'}${rec.note ? ` (${rec.note})` : ''}`);
  }
  return rec;
}
