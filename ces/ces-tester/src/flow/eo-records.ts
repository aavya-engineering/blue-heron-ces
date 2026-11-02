// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * Gap closure NS-3 (GAP-CLOSURE-PLAN.md section 4, V81): the customer's organisation records also reach EvidenceOps'
 * own stores through EO's routes: personnel (POST /api/personnel, then PUT the screening state), training
 * completions (POST /api/personnel/:id/training/complete), risk register entries (POST
 * /api/risk-assessment/register/entries) and the offboarding wizard (start, every step, finalize for a completed
 * leaver; start only for an open one). The bodies come from the run package's build-customer-records.mjs
 * (eoRecordPosts); this module only sends them and reads the stores back for verify V81 (out/eo-records.json).
 * Idempotent: a person (by e-mail), a risk (by sourceReference) or an offboarding already in the store is reused, so
 * a rerun over the shared ces.db adds no duplicate. Policies: none (the customer files hold none; the posts say why).
 */

export const EO_RECORDS_SCHEMA = 'ces-tester/eo-records@1';
/** NS-3 posts run by default (founder decision D-7, LOG-GC-PKG-C1.md); "0" turns them off. They feed EO's PS / AT ledger readiness. */
export const NS3_ENABLE_ENV = 'CES_NS3_EO_RECORDS';

export interface EoRecordPosts {
  schema: string;
  slug: string;
  personnel: Array<{ person_id: string; body: { displayName: string; email: string; role: string; entraObjectId?: string }; screening: { screeningState: string; lastScreenedDate: string } | null }>;
  training: Array<{ person_id: string; email: string; file: string; body: { courseId: string; completedDate: string } }>;
  risks: Array<{ risk_id: string; body: Record<string, unknown> & { sourceReference: string; threatEvent: string } }>;
  offboarding: Array<{ person_id: string; email: string; complete: boolean; attestor: string; notes: string }>;
  policies: unknown[];
  policy_note: string;
  unresolved: string[];
}

export interface EoCallResult {
  status: number;
  json: unknown;
}
/** One EO call: path includes the query; body is JSON-encoded when given. */
export type EoCall = (method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown) => Promise<EoCallResult>;

/** A fetch-based EoCall against baseUrl with the given extra headers (EO's bearer token). */
export function eoCaller(baseUrl: string, headers: Record<string, string>, fetchImpl: typeof fetch = fetch): EoCall {
  return async (method, p, body) => {
    const r = await fetchImpl(`${baseUrl}${p}`, {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(60000),
    });
    const text = await r.text();
    let json: unknown = text;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* keep text */
    }
    return { status: r.status, json };
  };
}

interface PersonnelRow {
  id: string;
  email: string;
  displayName?: string;
  role?: string;
  screeningState?: string;
  lastScreenedDate?: string;
  offboardedDate?: string;
  evidenceArtifacts?: Array<{ type?: string }>;
}
interface RunStep {
  id: string;
  completed?: boolean;
}
interface OffboardingRunLike {
  currentStepIndex: number;
  steps: RunStep[];
}

export interface EoRecordsResult {
  schema: string;
  taken: string;
  tenant_slug: string;
  posted: Record<string, number>;
  errors: Array<{ what: string; status: number | null; body?: unknown }>;
  policies: { posted: number; note: string };
  unresolved: string[];
  stores: {
    personnel: Array<{ id: string; email: string; displayName?: string; role?: string; screeningState?: string; lastScreenedDate?: string; offboardedDate?: string; artifactTypes: string[] }>;
    training: Record<string, Array<{ courseId: string; completedDate: string }>>;
    risks: Array<{ id: string; sourceReference?: string; threatEvent?: string }>;
  };
}

const q = (slug: string): string => `tenant=${encodeURIComponent(slug)}`;
const asArray = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** Send the posts, then read EO's personnel, training and risk stores back. Never throws on an HTTP error. */
export async function postEoRecords(call: EoCall, slug: string, posts: EoRecordPosts, now: () => string = () => new Date().toISOString()): Promise<EoRecordsResult> {
  const posted: Record<string, number> = {
    personnel_created: 0, personnel_existing: 0, screening_updated: 0, training_posted: 0,
    risks_created: 0, risks_existing: 0, offboarding_started: 0, offboarding_steps: 0, offboarding_completed: 0, offboarding_existing: 0,
  };
  const errors: EoRecordsResult['errors'] = [];
  const ok = (what: string, r: EoCallResult, want: number[]): boolean => {
    if (want.includes(r.status)) return true;
    errors.push({ what, status: r.status, body: r.json });
    return false;
  };
  const listPersonnel = async (): Promise<PersonnelRow[]> => {
    const r = await call('GET', `/api/personnel?${q(slug)}`);
    return ok('GET /api/personnel', r, [200]) ? asArray<PersonnelRow>(r.json) : [];
  };

  // personnel + screening state
  const byEmail = new Map((await listPersonnel()).map((p) => [p.email.toLowerCase(), p]));
  for (const p of posts.personnel) {
    let rec = byEmail.get(p.body.email.toLowerCase());
    if (rec) posted.personnel_existing++;
    else {
      const r = await call('POST', `/api/personnel?${q(slug)}`, p.body);
      if (!ok(`POST /api/personnel ${p.person_id}`, r, [201])) continue;
      rec = r.json as PersonnelRow;
      byEmail.set(p.body.email.toLowerCase(), rec);
      posted.personnel_created++;
    }
    const offboardingState = rec.screeningState === 'offboarded' || rec.screeningState === 'offboarding-in-progress';
    if (p.screening && !offboardingState && (rec.screeningState !== p.screening.screeningState || rec.lastScreenedDate !== p.screening.lastScreenedDate)) {
      const r = await call('PUT', `/api/personnel/${rec.id}?${q(slug)}`, p.screening);
      if (ok(`PUT /api/personnel/${p.person_id} screening`, r, [200])) posted.screening_updated++;
    }
  }

  // training completions (EO keeps one completion per course and person)
  for (const t of posts.training) {
    const rec = byEmail.get(t.email.toLowerCase());
    if (!rec) continue;
    const r = await call('POST', `/api/personnel/${rec.id}/training/complete?${q(slug)}`, t.body);
    if (ok(`POST training ${t.person_id} ${t.file}`, r, [200])) posted.training_posted++;
  }

  // risk register
  const regR = await call('GET', `/api/risk-assessment/register?${q(slug)}`);
  const haveRisk = new Set(ok('GET /api/risk-assessment/register', regR, [200])
    ? asArray<{ sourceReference?: string }>((regR.json as { entries?: unknown } | null)?.entries).map((e) => e.sourceReference) : []);
  for (const k of posts.risks) {
    if (haveRisk.has(k.risk_id)) { posted.risks_existing++; continue; }
    const r = await call('POST', `/api/risk-assessment/register/entries?${q(slug)}`, k.body);
    if (ok(`POST risk ${k.risk_id}`, r, [201])) posted.risks_created++;
  }

  // offboarding wizard
  for (const o of posts.offboarding) {
    const rec = byEmail.get(o.email.toLowerCase());
    if (!rec) continue;
    if (rec.screeningState === 'offboarded' || (!o.complete && rec.screeningState === 'offboarding-in-progress')) { posted.offboarding_existing++; continue; }
    const base = `/api/personnel/${rec.id}/offboarding`;
    let run: OffboardingRunLike | null = null;
    const cur = await call('GET', `${base}?${q(slug)}`);
    if (cur.status === 200) run = cur.json as OffboardingRunLike;
    else {
      const r = await call('POST', `${base}?${q(slug)}`, {});
      if (!ok(`POST offboarding start ${o.person_id}`, r, [201])) continue;
      run = r.json as OffboardingRunLike;
      posted.offboarding_started++;
    }
    if (!o.complete) continue;
    for (let guard = 0; run && run.currentStepIndex < run.steps.length && guard <= run.steps.length; guard++) {
      const step = run.steps[run.currentStepIndex];
      const r = await call('PUT', `${base}/step/${encodeURIComponent(step.id)}?${q(slug)}`, { attestor: o.attestor, notes: o.notes });
      if (!ok(`PUT offboarding step ${o.person_id} ${step.id}`, r, [200])) { run = null; break; }
      run = r.json as OffboardingRunLike;
      posted.offboarding_steps++;
    }
    if (!run) continue;
    const r = await call('POST', `${base}/complete?${q(slug)}`, { attestor: o.attestor });
    if (ok(`POST offboarding complete ${o.person_id}`, r, [200])) posted.offboarding_completed++;
  }

  // read the stores back (V81)
  const personnel = (await listPersonnel()).map((p) => ({
    id: p.id, email: p.email, displayName: p.displayName, role: p.role, screeningState: p.screeningState,
    ...(p.lastScreenedDate ? { lastScreenedDate: p.lastScreenedDate } : {}),
    ...(p.offboardedDate ? { offboardedDate: p.offboardedDate } : {}),
    artifactTypes: asArray<{ type?: string }>(p.evidenceArtifacts).map((x) => String(x.type)),
  }));
  const training: EoRecordsResult['stores']['training'] = {};
  for (const p of personnel) {
    const r = await call('GET', `/api/personnel/${p.id}/training?${q(slug)}`);
    if (!ok(`GET training ${p.email}`, r, [200])) continue;
    const comps = asArray<{ courseId: string; completedDate: string }>((r.json as { state?: { completions?: unknown } } | null)?.state?.completions);
    if (comps.length) training[p.email] = comps.map((c) => ({ courseId: c.courseId, completedDate: c.completedDate }));
  }
  const reg2 = await call('GET', `/api/risk-assessment/register?${q(slug)}`);
  const risks = ok('GET /api/risk-assessment/register (read back)', reg2, [200])
    ? asArray<{ id: string; sourceReference?: string; threatEvent?: string }>((reg2.json as { entries?: unknown } | null)?.entries).map((e) => ({ id: e.id, sourceReference: e.sourceReference, threatEvent: e.threatEvent }))
    : [];
  return {
    schema: EO_RECORDS_SCHEMA,
    taken: now(),
    tenant_slug: slug,
    posted,
    errors,
    policies: { posted: 0, note: posts.policy_note },
    unresolved: posts.unresolved,
    stores: { personnel, training, risks },
  };
}
