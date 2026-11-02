// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * Gap closure NS-4t: the tester-harness port of three run-package steps (mx-e2e.ps1, package commit a626e49).
 *
 * 1. E8.5 / E8.6 (NS-4, rule GD-b, verify V80): the review plan of customers/<slug>/document-reviews.json (built and
 *    checked by the package's build-customer-records.mjs loadDocumentReviews). E8.5 uploads its artifacts to EC with the
 *    uploader's signed principal; E8.6 has EO mint an approver token for the reviewer (this harness is EO's loopback dev
 *    operator), posts one document review per plan row citing the sha256 EC returned, then checks that a token minted
 *    for the uploader is refused 403 `reviewer_is_uploader`. out/eo-reviews.json has the mx shape (mx-e2e/eo-reviews@1).
 * 2. E8F (V78 stale-build clause, PKG-1 gate): one POST /api/package/build between the forced assess and the forced
 *    ssp/generate; forced.json gets `stale_build_status` / `stale_build_reason`, which verify.mjs judgeV78Stale reads.
 * 3. E7 (V81, NS-2): the interview records muster-api's buildInterviewRecords makes from the customer's answers, posted
 *    to EO's POST /api/interviews after EO is up. out/eo-interviews.json records EO's receipt and its list count.
 *
 * Tokens never reach a file or a log: the records hold statuses, ids and UPNs only.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { RecordUploadRequest, RecordUploadResult } from './ec-records.js';

export const EO_REVIEWS_SCHEMA = 'mx-e2e/eo-reviews@1';
export const EO_INTERVIEWS_SCHEMA = 'ces-tester/eo-interviews@1';
/** The interviewer on every record: the principal E3's muster-api token names (package scripts/mint-token.mjs). Stable across runs, so a rerun's records keep their recordIds and EO skips them. */
export const HARNESS_INTERVIEWER = { subjectId: 'mx-operator', role: 'bhd_operator' } as const;

// ---------- the review plan (package build-customer-records.mjs, schema mx-e2e/review-plan@1) ----------

export interface ReviewPlanUpload {
  id: string;
  file: string;
  sha256: string;
  control_ids: string[];
  body: Record<string, unknown> & { controlIds: string[] };
}
export interface ReviewPlanRow {
  control_id: string;
  objective_id: string;
  artifact: string;
  verdict: 'met' | 'not_met';
  notes: string;
}
export interface ReviewPlan {
  schema: string;
  slug: string;
  uploader: { upn: string };
  reviewer: { upn: string } | null;
  operatorUpn: string;
  uploads: ReviewPlanUpload[];
  reviews: ReviewPlanRow[];
  notReviewed: unknown[];
  probe: { artifact: string; control_id: string };
}

/** The package's loader (throws on any defect, null when the customer has no document-reviews.json). */
export type LoadDocumentReviews = (pkgRoot: string, slug: string, opts: { objectivesRef: unknown }) => ReviewPlan | null;

// ---------- principal tokens (ces-shared dist signPrincipalToken, as mx-e2e.ps1 New-PrincipalToken) ----------

export interface PrincipalClaims {
  sub: string;
  upn: string;
  roles?: string[];
}
export type PrincipalSigner = (claims: PrincipalClaims, secret: string) => string;

/** ces-shared's HS256 signer, loaded from its dist (`<ces>/ces-shared/dist/http/requestPrincipal.js`); 1 h tokens. */
export async function loadPrincipalSigner(cesRoot: string): Promise<PrincipalSigner> {
  const mod = (await import(pathToFileURL(path.join(cesRoot, 'ces-shared', 'dist', 'http', 'requestPrincipal.js')).href)) as {
    signPrincipalToken: (claims: Record<string, unknown>, opts: { secret: string; ttlSeconds: number }) => string;
  };
  return (claims, secret) => mod.signPrincipalToken({ ...claims }, { secret, ttlSeconds: 3600 });
}

/** The uploader's claims (no roles), as mx-e2e.ps1 E8.5. */
export const uploaderClaims = (upn: string): PrincipalClaims => ({ sub: `uploader:${upn.toLowerCase()}`, upn });
/** The dev operator's claims (role bhd-operator), as mx-e2e.ps1 E8.6. */
export const operatorClaims = (upn: string): PrincipalClaims => ({ sub: `bhd-operator:${upn.toLowerCase()}`, upn, roles: ['bhd-operator'] });

// ---------- one JSON call that never throws ----------

export interface JsonCallResult {
  status: number | null;
  body: unknown;
}
export async function jsonCall(
  method: 'GET' | 'POST',
  url: string,
  body: unknown,
  headers: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<JsonCallResult> {
  try {
    const r = await fetchImpl(url, {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(600000),
    });
    const text = await r.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* keep text */
    }
    return { status: r.status, body: parsed };
  } catch (err) {
    return { status: null, body: err instanceof Error ? err.message : String(err) };
  }
}
const field = (b: unknown, k: string): unknown => (b && typeof b === 'object' ? (b as Record<string, unknown>)[k] : undefined);

// ---------- E8.5: the review uploads ----------

/** One row of out/ec-upload-reviews.json (the mx shape: one per plan artifact, probe included). */
export interface ReviewUploadRow {
  id: string;
  file: string;
  control_ids: string[];
  http_status: number | null;
  item_id: string | null;
  sha256: string | null;
  sha256_match: boolean;
  uploaded_by: string | null;
  /** Set when the artifact is a records/ file the catalog upload (same bytes, same principal) already sent. */
  via_catalog_upload?: true;
}

/**
 * Splits the plan's uploads: a `records/<f>` artifact whose catalog upload this run already made (same file, same
 * sha256) reuses that row, so EC holds one item per document; every other artifact (review-artifacts/, the probe) is
 * uploaded with the uploader's principal.
 */
export function splitReviewUploads(plan: ReviewPlan, catalogRows: RecordUploadResult[]): { reused: ReviewUploadRow[]; toUpload: ReviewPlanUpload[] } {
  const reused: ReviewUploadRow[] = [];
  const toUpload: ReviewPlanUpload[] = [];
  for (const u of plan.uploads) {
    const f = u.file.startsWith('records/') ? u.file.slice('records/'.length) : null;
    const row = f ? catalogRows.find((r) => r.file === f && r.sha256 === u.sha256) : undefined;
    if (row) {
      reused.push({ id: u.id, file: u.file, control_ids: [...u.control_ids], http_status: row.http_status, item_id: row.item_id, sha256: row.sha256_match ? row.sha256 : null, sha256_match: row.sha256_match, uploaded_by: row.uploaded_by ?? null, via_catalog_upload: true });
    } else toUpload.push(u);
  }
  return { reused, toUpload };
}

/** The plan uploads as EC ingest requests (for ec-records.ts uploadRecords). */
export function reviewUploadRequests(uploads: ReviewPlanUpload[]): RecordUploadRequest[] {
  return uploads.map((u) => ({ file: u.file, recordKind: 'review-artifact', sha256: u.sha256, body: u.body as unknown as RecordUploadRequest['body'] }));
}

/** EC's answers to the uploaded artifacts, in the mx row shape. */
export function reviewUploadRows(uploads: ReviewPlanUpload[], results: RecordUploadResult[]): ReviewUploadRow[] {
  return uploads.map((u, k) => {
    const r = results[k];
    return { id: u.id, file: u.file, control_ids: [...u.control_ids], http_status: r?.http_status ?? null, item_id: r?.item_id ?? null, sha256: r?.sha256_match ? u.sha256 : null, sha256_match: !!r?.sha256_match, uploaded_by: r?.uploaded_by ?? null };
  });
}

/** E8.5 fails when an artifact was not stored (201), its hash differs from the plan, or EC recorded no uploader. */
export const badReviewUploads = (rows: ReviewUploadRow[]): ReviewUploadRow[] => rows.filter((r) => r.http_status !== 201 || !r.sha256_match || !r.uploaded_by);

// ---------- E8.6: the document reviews ----------

export interface EoReviewsRecord {
  schema: typeof EO_REVIEWS_SCHEMA;
  taken: string;
  tenant: string;
  reviews_planned: number;
  posted_201: number;
  posted: Array<{ control_id: string; objective_id: string; artifact: string; verdict: string; http_status: number | null; review_id: unknown; error: unknown }>;
  uploader_upn?: string;
  reviewer_upn?: string;
  operator_upn?: string;
  mint_status?: number | null;
  mint_id?: unknown;
  mint_operator_auth?: unknown;
  mint_error?: unknown;
  self_mint_status?: number | null;
  self_review_status?: number | null;
  self_review_error?: unknown;
  note?: string;
  error?: string;
}

export interface ReviewStepOptions {
  eoUrl: string;
  slug: string;
  plan: ReviewPlan | null;
  /** plan artifact id -> the sha256 EC returned at E8.5. */
  hashOf: Record<string, string | null>;
  /** The run's EO bearer (eoAuthHeaders) for every call; the principal goes in x-ces-principal beside it. */
  baseHeaders: Record<string, string>;
  /** Signs the operator token (claims from operatorClaims) with the run's CES_EO_OPERATOR_SECRET. */
  operatorToken: (upn: string) => string;
  fetchImpl?: typeof fetch;
  now?: () => string;
}

/** E8.6: rc 0 = no plan / no review in the plan, or every review 201 and the self-review 403. Never throws. */
export async function runReviewStep(o: ReviewStepOptions): Promise<{ rc: number; record: EoReviewsRecord }> {
  const f = o.fetchImpl ?? fetch;
  const rec: EoReviewsRecord = { schema: EO_REVIEWS_SCHEMA, taken: (o.now ?? (() => new Date().toISOString()))(), tenant: o.slug, reviews_planned: 0, posted_201: 0, posted: [] };
  let rc = 1;
  try {
    const plan = o.plan;
    if (!plan) {
      rec.note = 'no review plan (no customers/<slug>/document-reviews.json, or E8.5 did not make one)';
      return { rc: 0, record: rec };
    }
    rec.uploader_upn = plan.uploader.upn;
    rec.reviewer_upn = plan.reviewer?.upn;
    rec.operator_upn = plan.operatorUpn;
    rec.reviews_planned = plan.reviews.length;
    if (!plan.reviews.length) {
      rec.note = 'the plan has no review (probe upload only)';
      return { rc: 0, record: rec };
    }
    const q = `tenant=${encodeURIComponent(o.slug)}`;
    const opTok = o.operatorToken(plan.operatorUpn);
    const as = (tok: string): Record<string, string> => ({ ...o.baseHeaders, 'x-ces-principal': tok });
    const mint = await jsonCall('POST', `${o.eoUrl}/api/approver-tokens?${q}`, { approverUpn: plan.reviewer!.upn }, as(opTok), f);
    rec.mint_status = mint.status;
    rec.mint_id = field(mint.body, 'mintId');
    rec.mint_operator_auth = field(mint.body, 'operatorAuth');
    if (mint.status !== 201) {
      rec.mint_error = mint.body;
      return { rc, record: rec };
    }
    const revTok = String(field(mint.body, 'token') ?? '');
    for (const r of plan.reviews) {
      const b = { tenant: o.slug, controlId: r.control_id, objectiveId: r.objective_id, artifactHash: o.hashOf[r.artifact] ?? null, verdict: r.verdict, notes: r.notes };
      const res = await jsonCall('POST', `${o.eoUrl}/api/reviews`, b, as(revTok), f);
      rec.posted.push({ control_id: r.control_id, objective_id: r.objective_id, artifact: r.artifact, verdict: r.verdict, http_status: res.status, review_id: field(res.body, 'reviewId') ?? null, error: res.status === 201 ? null : res.body });
    }
    // GD-b: nobody reviews their own upload. A review with a token minted for the uploader must get 403 reviewer_is_uploader.
    const first = plan.reviews[0];
    const selfMint = await jsonCall('POST', `${o.eoUrl}/api/approver-tokens?${q}`, { approverUpn: plan.uploader.upn }, as(opTok), f);
    rec.self_mint_status = selfMint.status;
    if (selfMint.status === 201) {
      const sb = { tenant: o.slug, controlId: first.control_id, objectiveId: first.objective_id, artifactHash: o.hashOf[first.artifact] ?? null, verdict: 'met', notes: 'self-review probe (must be refused)' };
      const self = await jsonCall('POST', `${o.eoUrl}/api/reviews`, sb, as(String(field(selfMint.body, 'token') ?? '')), f);
      rec.self_review_status = self.status;
      rec.self_review_error = field(self.body, 'error');
    }
    rec.posted_201 = rec.posted.filter((p) => p.http_status === 201).length;
    if (rec.posted_201 === rec.reviews_planned && rec.self_review_status === 403) rc = 0;
  } catch (err) {
    rec.error = err instanceof Error ? err.message : String(err);
  }
  return { rc, record: rec };
}

// ---------- E8F: the stale package build (V78) ----------

export interface StaleBuildExtra {
  stale_build_status: number | null;
  stale_build_reason: string;
  stale_build_zip_removed?: true;
}

/**
 * POST /api/package/build while the forced assess's snapshot and POA&M are newer than the SSP: EO must refuse it (409
 * "Package build refused: ..."). On a 200 (gate broken) the zip it wrote is removed, so E8's package stays the newest.
 */
export async function attemptStaleBuild(eoUrl: string, slug: string, headers: Record<string, string>, fetchImpl: typeof fetch = fetch): Promise<StaleBuildExtra> {
  const r = await jsonCall('POST', `${eoUrl}/api/package/build`, { tenant: slug }, headers, fetchImpl);
  const out: StaleBuildExtra = { stale_build_status: r.status, stale_build_reason: typeof r.body === 'string' ? r.body : String(field(r.body, 'error') ?? '') };
  const zip = field(r.body, 'filePath');
  if (r.status === 200 && typeof zip === 'string' && zip && fs.existsSync(zip)) {
    fs.rmSync(zip, { force: true });
    out.stale_build_zip_removed = true;
  }
  return out;
}

// ---------- E7: interview records (V81, NS-2) ----------

/** muster-api's builder (dist/services/interviewRecordService.js). */
export interface InterviewRecordModule {
  buildInterviewRecords: (answers: string, opts: { tenantSlug: string; interviewer: { subjectId: string; role: string }; questionControls?: unknown }) => { records: unknown[]; skipped: unknown[] };
  readQuestionControlMap: (root?: string) => unknown;
}
export async function loadInterviewRecordModule(musterApiRoot: string): Promise<InterviewRecordModule> {
  const m = (await import(pathToFileURL(path.join(musterApiRoot, 'dist', 'services', 'interviewRecordService.js')).href)) as Partial<InterviewRecordModule> & { default?: InterviewRecordModule };
  return m.buildInterviewRecords && m.readQuestionControlMap ? (m as InterviewRecordModule) : m.default!;
}

export interface EoInterviewsRecord {
  schema: typeof EO_INTERVIEWS_SCHEMA;
  taken: string;
  tenant: string;
  answers_file: string | null;
  built: number;
  skipped_facts: number;
  interviewer: { subjectId: string; role: string };
  http_status: number | null;
  stored: number | null;
  skipped: number | null;
  /** GET /api/interviews?tenant= count after the post. */
  listed: number | null;
  note?: string;
  error?: unknown;
}

/** Posts the batch ({tenant, records}; EO takes it all or nothing) and reads EO's list back. Never throws. */
export async function postInterviewRecords(
  eoUrl: string,
  slug: string,
  built: { records: unknown[]; skipped: unknown[] } | null,
  answersFile: string | null,
  headers: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
  now: () => string = () => new Date().toISOString(),
): Promise<{ ok: boolean; record: EoInterviewsRecord }> {
  const rec: EoInterviewsRecord = {
    schema: EO_INTERVIEWS_SCHEMA, taken: now(), tenant: slug, answers_file: answersFile, built: built?.records.length ?? 0, skipped_facts: built?.skipped.length ?? 0,
    interviewer: { ...HARNESS_INTERVIEWER }, http_status: null, stored: null, skipped: null, listed: null,
  };
  if (!built || !built.records.length) {
    rec.note = built ? 'no answered question in the answers file' : 'no customers/<slug>/interview-answers.json';
    return { ok: true, record: rec };
  }
  const q = `tenant=${encodeURIComponent(slug)}`;
  const r = await jsonCall('POST', `${eoUrl}/api/interviews`, { tenant: slug, records: built.records }, headers, fetchImpl);
  rec.http_status = r.status;
  if (r.status === 201) {
    const n = (k: string): number | null => (typeof field(r.body, k) === 'number' ? (field(r.body, k) as number) : null);
    rec.stored = n('stored');
    rec.skipped = n('skipped');
  } else rec.error = r.body;
  const list = await jsonCall('GET', `${eoUrl}/api/interviews?${q}`, undefined, headers, fetchImpl);
  if (list.status === 200) {
    const b = list.body;
    const rows = Array.isArray(b) ? b : Array.isArray(field(b, 'records')) ? (field(b, 'records') as unknown[]) : null;
    rec.listed = rows ? rows.length : null;
  }
  return { ok: r.status === 201, record: rec };
}
