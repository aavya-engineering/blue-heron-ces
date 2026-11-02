// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// apiCompile.ts — FIN-32 (FLOW-7, V125): the Plan tab compiles and pushes through muster-api,
// the same two calls the headless round makes.
//   E2  POST /api/discovery/run  {tenant_slug, answers}          (read-only discovery, sim)
//   E3  POST /api/plan/compile   {tenant_slug, discovery, interview_answers, org_content?}
//   E4  POST /api/plan/push      MP + TM + IM + the six hand-off envelopes + policies
// The push body is built from the compiled files exactly as `mx-helpers.mjs push` and
// ces-tester's `pushPlans` build it (newest file per prefix; policy texts matched to the
// policy-set manifest's entries), so a UI push sends the same file set as the API push.
//
// The typed answers leave the browser in the interview-answers file shape
// (headless/answersImport.ts parseInterviewAnswers): only the operator's own answers
// (provenance operator_interview), seven keys, source `synthetic-interview:<slug>`.
// That source is the runner's binding rule for a simulator customer, so this path is
// sim-only; a live tenant keeps the in-browser compile (API-3b moves the rest).
//
// Muster sends; it never reads results back (founder ruling: data collection and the plan).
import { api, type ApiResult } from '@/shared/api/musterApi';
import type { InterviewFact } from '@/shared/types/engagement';
import { ANSWERS_PROVENANCE, answersSource } from './headless/answersImport';
import { runDiscoveryOnApi, type DiscoveryRunOptions } from '@/features/discovery/discoveryRunService';

/** One compiled file, as POST /api/plan/compile returns it (planCompileService.CompiledFile). */
export interface ApiCompiledFile {
  name: string;
  encoding: 'utf8' | 'base64';
  content: string;
}

/** The 200 body of POST /api/plan/compile (the parts the UI reads). */
export interface ApiCompileResponse {
  tenant_slug: string;
  summary: string | null;
  cost_notice_lines?: string[];
  files: ApiCompiledFile[];
  initial_password_ref: string | null;
  recurring_cost_notice: unknown | null;
  eo_interviews?: unknown;
}

/** An answers-file row (the seven keys parseInterviewAnswers accepts). */
export interface AnswerRow {
  question_id: string;
  question_text: string;
  answer: string;
  provenance: typeof ANSWERS_PROVENANCE;
  confidence: InterviewFact['confidence'];
  recorded_at: string;
  source: string;
}

/** The compile and push wait on a child-process compile and EO's intake; allow minutes, not seconds. */
export const API_COMPILE_TIMEOUT_MS = 10 * 60_000;
export const API_PUSH_TIMEOUT_MS = 2 * 60_000;

/**
 * The session's typed answers as an interview-answers file. Only operator_interview facts
 * (typed, or a corrected draft); discovery and harvest facts reach the compile through the
 * discovery read, not as answers. The last fact per question wins (record order).
 */
export function answersFileFromFacts(facts: InterviewFact[], slug: string): AnswerRow[] {
  const byId = new Map<string, AnswerRow>();
  for (const f of facts) {
    if (f.provenance !== ANSWERS_PROVENANCE) continue;
    if (typeof f.answer !== 'string' || f.answer.trim() === '') continue;
    byId.delete(f.question_id);
    byId.set(f.question_id, {
      question_id: f.question_id,
      question_text: f.question_text,
      answer: f.answer,
      provenance: ANSWERS_PROVENANCE,
      confidence: f.confidence,
      recorded_at: f.recorded_at,
      source: answersSource(slug),
    });
  }
  return [...byId.values()];
}

/** muster-api's stack-id rule (planCompileService STACK_RE). */
const STACK_ID = /^[a-z0-9_]{1,64}$/;

/** The E3 request body (same keys as `plan-compile.mjs compileBody`). */
export function apiCompileBody(args: {
  slug: string;
  discovery: unknown;
  answers: AnswerRow[];
  orgContentText?: string;
  /** The session's selected services (stack tiles); absent or empty = the runner's default. */
  stacks?: string[];
}): Record<string, unknown> {
  const stacks = (args.stacks ?? []).filter((st) => st !== 'none' && STACK_ID.test(st));
  return {
    tenant_slug: args.slug,
    discovery: args.discovery,
    interview_answers: args.answers,
    ...(stacks.length > 0 ? { stacks } : {}),
    ...(args.orgContentText !== undefined && args.orgContentText.trim() !== '' ? { org_content: args.orgContentText } : {}),
  };
}

/** The top-level plan files (the plans folder, not policies/ or reports/). */
function topLevel(files: ApiCompiledFile[]): ApiCompiledFile[] {
  return files.filter((f) => !f.name.includes('/'));
}

/** The newest top-level JSON file with this prefix (names end in -<ts>, so the sort is by time). */
export function pickFile(files: ApiCompiledFile[], prefix: string): ApiCompiledFile | undefined {
  return topLevel(files)
    .filter((f) => f.name.startsWith(prefix) && f.name.endsWith('.json') && f.encoding === 'utf8')
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .pop();
}

const json = (f: ApiCompiledFile | undefined): unknown => (f ? JSON.parse(f.content) : undefined);

/** mx-helpers.mjs push: the body key for each hand-off envelope and its file prefix. */
export const PUSH_HANDOFF_PREFIXES: Readonly<Record<string, string>> = {
  si_baseline: 'si-baseline-',
  tcp: 'tcp-',
  readiness_posture: 'readiness-posture-',
  policy_inputs_profile: 'policy-inputs-profile-',
  policy_set_manifest: 'policy-set-manifest-',
  cui_boundary: 'cui-boundary-',
};

/** ces-tester eo-intake.manifestPolicyTexts: each manifest entry's text from policies/<basename>. */
export function policyTextsFor(
  manifest: unknown,
  files: ApiCompiledFile[]
): { policies: Array<{ name: string; markdown: string }>; missing: string[] } {
  const docs = (manifest as { artifact?: { documents?: Array<{ name: string }> } } | undefined)?.artifact?.documents ?? [];
  const byName = new Map(files.filter((f) => f.name.startsWith('policies/')).map((f) => [f.name.slice('policies/'.length), f]));
  const policies: Array<{ name: string; markdown: string }> = [];
  const missing: string[] = [];
  for (const d of docs) {
    const base = d.name.split(/[\\/]/).pop() ?? d.name;
    const f = byName.get(base);
    if (f && f.encoding === 'utf8') policies.push({ name: d.name, markdown: f.content });
    else missing.push(d.name);
  }
  return { policies, missing };
}

/** The E4 push body from the compiled files (mx-helpers.mjs push + ces-tester's `policies` extra). */
export function apiPushBody(
  files: ApiCompiledFile[],
  slug: string,
  override?: { reason: string }
): Record<string, unknown> {
  const mp = pickFile(files, 'manual-mission-plan-');
  const tm = pickFile(files, 'tenant-manifest-');
  if (!mp || !tm) throw new Error('the compile returned no Mission Plan or Tenant Manifest');
  const im = pickFile(files, 'infrastructure-manifest-');
  const body: Record<string, unknown> = {
    tenant_slug: slug,
    missionPlan: json(mp),
    tenantManifest: json(tm),
    ...(im ? { infraManifest: json(im) } : {}),
  };
  for (const [key, prefix] of Object.entries(PUSH_HANDOFF_PREFIXES)) {
    const f = pickFile(files, prefix);
    if (f) body[key] = json(f);
  }
  if (body.policy_set_manifest) body.policies = policyTextsFor(body.policy_set_manifest, files).policies;
  if (override && override.reason.trim() !== '') body.validationOverride = { reason: override.reason.trim() };
  return body;
}

/** The file names a push body sends (for the screen and the run record). */
export function pushedParts(body: Record<string, unknown>): string[] {
  return Object.keys(body).filter((k) => k !== 'tenant_slug' && k !== 'validationOverride');
}

export type ApiStepOutcome<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

function failure(r: Extract<ApiResult<unknown>, { ok: false }>, what: string): { ok: false; status: number; message: string } {
  if (r.status === 0) return { ok: false, status: 0, message: 'muster-api is not reachable (not running, blocked, or timed out)' };
  if (r.status === 401) return { ok: false, status: 401, message: 'muster-api rejected the request: sign in to muster-api first' };
  if (r.status === 403) return { ok: false, status: 403, message: `this role cannot ${what} (operator or prime only)` };
  return { ok: false, status: r.status, message: r.error ? `muster-api returned ${r.status}: ${r.error}` : `muster-api returned ${r.status}` };
}

/**
 * E2 + E3 through muster-api: a fresh read-only discovery with the typed answers, then the
 * compile from that discovery and the same answers.
 */
export async function compileOnApi(args: {
  slug: string;
  answers: AnswerRow[];
  orgContentText?: string;
  stacks?: string[];
  discovery?: DiscoveryRunOptions;
}): Promise<ApiStepOutcome<ApiCompileResponse> & { discoveryEnvelope?: unknown }> {
  const disc = await runDiscoveryOnApi({ ...(args.discovery ?? {}), tenantSlug: args.slug, answers: args.answers });
  if (!disc.ok) return { ok: false, status: 0, message: `discovery: ${disc.message}` };
  const r = await api.post<ApiCompileResponse>(
    '/plan/compile',
    apiCompileBody({
      slug: args.slug,
      discovery: disc.envelope,
      answers: args.answers,
      orgContentText: args.orgContentText,
      stacks: args.stacks,
    }),
    API_COMPILE_TIMEOUT_MS
  );
  if (!r.ok) return { ...failure(r, 'compile a plan'), discoveryEnvelope: disc.envelope };
  return { ok: true, data: r.data, discoveryEnvelope: disc.envelope };
}

/** The 201 body of POST /api/plan/push (the parts the UI reads). */
export interface ApiPushResponse {
  pushed?: string[];
  plansDir?: string;
  blocking?: string[];
}

/** E4 through muster-api. A 409 is the push gate: the operator may override with a reason. */
export async function pushCompiledOnApi(
  files: ApiCompiledFile[],
  slug: string,
  override?: { reason: string }
): Promise<ApiStepOutcome<ApiPushResponse> & { blocking?: boolean; sent: string[] }> {
  const body = apiPushBody(files, slug, override);
  const sent = pushedParts(body);
  const r = await api.post<ApiPushResponse>('/plan/push', body, API_PUSH_TIMEOUT_MS);
  if (!r.ok) return { ...failure(r, 'push a plan'), ...(r.status === 409 ? { blocking: true } : {}), sent };
  return { ok: true, data: r.data, sent };
}

/** A compiled file as a download (base64 files decode to bytes). */
export function compiledFileBlob(f: ApiCompiledFile): Blob {
  if (f.encoding === 'base64') {
    const bin = atob(f.content);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: 'application/octet-stream' });
  }
  const mime = f.name.endsWith('.json')
    ? 'application/json'
    : f.name.endsWith('.html')
      ? 'text/html;charset=utf-8'
      : 'text/plain;charset=utf-8';
  return new Blob([f.content], { type: mime });
}

/** A stable testid suffix for a compiled file (the -<ts> suffix dropped). */
export function fileTestId(name: string): string {
  return name
    .replace(/-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z/, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}
