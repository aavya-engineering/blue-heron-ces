// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * PH-13 (P13-LV design, LOG-PH13-LV.md §6.2; P13-INT wiring): step EL, the AdminOps leaver flow for CMMC PS.L2-3.9.2[b]
 * (founder decision 2026-11-01: approve first, then act). It runs after E5 (E5's offboard_upn discoverer must still see
 * the leaver enabled) and before E6 (so Stamper's PS.L2-3.9.2.leaver-access-terminated read judges A-22's real result).
 *
 * On its own AO server (`ao gui`, a free port, the E7A sim env plus a run-only bearer), the step:
 *   1. PUT  /api/leaver/settings  the tenant administrators (the sim's operator and approver principals), the BHD opt-in
 *      (S2 only), reminder 0 min, confirm window (S3 0 min, else 4320);
 *   2. POST /api/leaver/scan      Graph employeeLeaveDateTime read; one flow per enabled past leaver;
 *   3. GET  /api/leaver/outbox    the simulated messages; the confirm link from one leaver_confirm_request;
 *   4. S1 / S2 (confirm): GET the link (200), POST /leaver/confirm/<flowId> {t, decision: 'confirm'} WITHOUT a bearer
 *      (200), the same POST again (409: single use);
 *      S3 (unconfirmed): POST /api/leaver/tick (a reminder, then the escalation);
 *   5. GET  /api/leaver/flows/<flowId>.
 * It records out/leaver-flow.json (schema ces-tester/leaver-flow@1), which V131 (<PKG> verify-fin31-leaver.mjs) judges
 * with AO's ces.db rows. The record never holds a confirm token: links are written `?t=<redacted>`.
 * muster-partial runs no AdminOps op, so EL is skipped there. EL is not fatal and not in REQUIRED_STEPS: V131 judges it.
 */

export const LEAVER_FLOW_SCHEMA = 'ces-tester/leaver-flow@1';
/** The fictional BHD role mailbox the step configures (CES_BHD_NOTICE_MAILBOX); never a person. */
export const EL_BHD_MAILBOX = 'ces-notices@bhd.invalid';

/** The scenarios EL runs on, with the mode V131 expects (verify-fin31-leaver.mjs V131_SCENARIOS). */
export const EL_SCENARIOS: Record<string, { mode: 'confirm' | 'unconfirmed'; bhd: boolean }> = {
  's1-mach': { mode: 'confirm', bhd: false },
  's2-eng': { mode: 'confirm', bhd: true },
  's3-def': { mode: 'unconfirmed', bhd: false },
};

export interface HttpResult { status: number; json: unknown; text: string }
export type HttpFn = (method: 'GET' | 'PUT' | 'POST', url: string, body: unknown, bearer: string | null) => Promise<HttpResult>;

/** A real HTTP call (JSON in, JSON or text out). Never throws: a transport error is status 0. */
export const fetchHttp: HttpFn = async (method, url, body, bearer) => {
  try {
    const r = await fetch(url, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(600000),
    });
    const text = await r.text();
    let json: unknown = null;
    try { json = JSON.parse(text); } catch { /* not JSON (the confirm page is HTML) */ }
    return { status: r.status, json, text };
  } catch (err) {
    return { status: 0, json: null, text: err instanceof Error ? err.message : String(err) };
  }
};

const CONFIRM_LINK = /(https?:\/\/[^\s"'<>]+\/leaver\/confirm\/([^\s"'<>?]+)\?t=([A-Za-z0-9_-]+))/;

/** The confirm link in a message body: { url, flowId, token }, or null. */
export function parseConfirmLink(body: string): { url: string; flowId: string; token: string } | null {
  const m = CONFIRM_LINK.exec(String(body ?? ''));
  return m ? { url: m[1], flowId: decodeURIComponent(m[2]), token: m[3] } : null;
}

/** Every `?t=<token>` in a text, redacted (the record and logs never hold a confirm token). */
export function redactTokens(text: string): string {
  return String(text ?? '').replace(/([?&]t=)[A-Za-z0-9_-]+/g, '$1<redacted>');
}

/** The tenant administrators EL configures: the sim's operator and approver principals, distinct, lower-case. */
export function elAdminRecipients(resources: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const k of ['operator_upn', 'approver_upn']) {
    const v = resources[k];
    if (typeof v === 'string' && /^[^@\s]+@[^@\s]+$/.test(v) && !out.includes(v.toLowerCase())) out.push(v.toLowerCase());
  }
  return out;
}

export interface LeaverFlowRecord {
  schema: string;
  slug: string;
  taken: string;
  started: string;
  ended: string;
  mode: 'confirm' | 'unconfirmed';
  ao_url: string;
  bhd_mailbox: string;
  settings: { status: number; adminRecipients: string[]; notifyBhdOnDone: boolean; reminderAfterMinutes: number; confirmWindowMinutes: number };
  scan: { status: number; pastLeavers: number | null; enabledPastLeavers: number | null; started: string[] };
  flow_id: string | null;
  outbox: { status: number; messages: number; confirm_requests: number };
  confirm?: { link: string | null; get_status: number | null; post_status: number | null; post_without_bearer: true; reuse_status: number | null; body: unknown };
  tick?: { status: number; body: unknown };
  flow_after: { status: number; flow: unknown };
  problems: string[];
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const get = (o: unknown, k: string): unknown => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined);
const nowIso = (): string => new Date().toISOString();

/**
 * The step's calls against a running AO server. `register` receives each confirm token (V101's leak scan); the returned
 * record holds none.
 */
export async function runLeaverFlow(o: {
  aoUrl: string;
  bearer: string;
  slug: string;
  admins: string[];
  bhdMailbox?: string;
  http?: HttpFn;
  register?: (name: string, value: string) => void;
}): Promise<LeaverFlowRecord> {
  const sc = EL_SCENARIOS[o.slug];
  if (!sc) throw new Error(`EL does not run on ${o.slug}`);
  const http = o.http ?? fetchHttp;
  const q = `?tenant=${encodeURIComponent(o.slug)}`;
  const started = nowIso();
  const problems: string[] = [];
  const bhdMailbox = o.bhdMailbox ?? EL_BHD_MAILBOX;
  const settingsBody = {
    adminRecipients: o.admins,
    notifyBhdOnDone: sc.bhd,
    reminderAfterMinutes: 0,
    confirmWindowMinutes: sc.mode === 'unconfirmed' ? 0 : 4320,
  };
  if (!o.admins.length) problems.push('no tenant administrator UPN (resources.operator_upn / approver_upn) to configure');

  const s = await http('PUT', `${o.aoUrl}/api/leaver/settings${q}`, settingsBody, o.bearer);
  if (s.status !== 200) problems.push(`settings PUT ${s.status}: ${s.text.slice(0, 200)}`);

  const scan = await http('POST', `${o.aoUrl}/api/leaver/scan${q}`, {}, o.bearer);
  const startedFlows = (Array.isArray(get(scan.json, 'started')) ? (get(scan.json, 'started') as unknown[]) : []).map((f) => String(get(f, 'flowId') ?? '')).filter(Boolean);
  if (scan.status !== 200) problems.push(`scan POST ${scan.status}: ${scan.text.slice(0, 200)}`);
  else if (!startedFlows.length) problems.push(`the scan started no flow (past leavers ${String(get(scan.json, 'pastLeavers'))}, enabled ${String(get(scan.json, 'enabledPastLeavers'))}` +
    `; already tracked: ${JSON.stringify(get(scan.json, 'alreadyTracked') ?? []).slice(0, 300)})`);
  const flowId = startedFlows[0] ?? null;

  const ob = await http('GET', `${o.aoUrl}/api/leaver/outbox${q}`, undefined, o.bearer);
  const msgs = (Array.isArray(ob.json) ? ob.json : []).filter((m) => get(m, 'flow_id') === flowId);
  const requests = msgs.filter((m) => get(m, 'kind') === 'leaver_confirm_request');
  let link: ReturnType<typeof parseConfirmLink> = null;
  for (const m of requests) {
    link = parseConfirmLink(String(get(m, 'body') ?? ''));
    if (link) break;
  }
  for (const m of requests) {
    const l = parseConfirmLink(String(get(m, 'body') ?? ''));
    if (l) o.register?.(`leaver_confirm_token_${l.flowId}_${requests.indexOf(m)}`, l.token);
  }
  if (flowId && !requests.length) problems.push('no leaver_confirm_request in the outbox for the flow');
  if (flowId && requests.length && !link) problems.push('the confirm request carries no confirm link');

  const rec: LeaverFlowRecord = {
    schema: LEAVER_FLOW_SCHEMA, slug: o.slug, taken: '', started, ended: '', mode: sc.mode, ao_url: o.aoUrl, bhd_mailbox: bhdMailbox,
    settings: { status: s.status, ...settingsBody },
    scan: { status: scan.status, pastLeavers: num(get(scan.json, 'pastLeavers')), enabledPastLeavers: num(get(scan.json, 'enabledPastLeavers')), started: startedFlows },
    flow_id: flowId,
    outbox: { status: ob.status, messages: msgs.length, confirm_requests: requests.length },
    flow_after: { status: 0, flow: null },
    problems,
  };

  if (sc.mode === 'confirm') {
    let getStatus: number | null = null;
    let postStatus: number | null = null;
    let reuse: number | null = null;
    let body: unknown = null;
    if (link && flowId) {
      // The administrator's browser: no AO bearer token anywhere on these three calls.
      getStatus = (await http('GET', `${o.aoUrl}/leaver/confirm/${encodeURIComponent(flowId)}?t=${link.token}`, undefined, null)).status;
      const post = await http('POST', `${o.aoUrl}/leaver/confirm/${encodeURIComponent(flowId)}`, { t: link.token, decision: 'confirm' }, null);
      postStatus = post.status;
      body = post.json ?? redactTokens(post.text).slice(0, 500);
      reuse = (await http('POST', `${o.aoUrl}/leaver/confirm/${encodeURIComponent(flowId)}`, { t: link.token, decision: 'confirm' }, null)).status;
      if (getStatus !== 200) problems.push(`confirm page GET ${getStatus}`);
      if (postStatus !== 200) problems.push(`confirm POST ${postStatus}: ${redactTokens(post.text).slice(0, 300)}`);
      if (reuse !== 409) problems.push(`reused confirm link answered ${reuse}, expected 409`);
    }
    rec.confirm = { link: link ? redactTokens(link.url) : null, get_status: getStatus, post_status: postStatus, post_without_bearer: true, reuse_status: reuse, body };
  } else {
    const t = await http('POST', `${o.aoUrl}/api/leaver/tick${q}`, {}, o.bearer);
    rec.tick = { status: t.status, body: t.json ?? t.text.slice(0, 300) };
    if (t.status !== 200) problems.push(`tick POST ${t.status}`);
  }

  if (flowId) {
    const f = await http('GET', `${o.aoUrl}/api/leaver/flows/${encodeURIComponent(flowId)}`, undefined, o.bearer);
    rec.flow_after = { status: f.status, flow: f.json };
    const status = get(f.json, 'status');
    if (sc.mode === 'confirm' && status !== 'done') problems.push(`flow status ${String(status)}, expected done`);
    if (sc.mode === 'unconfirmed' && status !== 'awaiting_confirmation') problems.push(`flow status ${String(status)}, expected awaiting_confirmation`);
  }
  rec.ended = nowIso();
  rec.taken = rec.ended;
  return rec;
}
