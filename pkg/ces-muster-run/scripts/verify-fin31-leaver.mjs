// PH-13 P13-LV (Blue Heron Defense, CES team): V131, the AdminOps leaver flow (founder decision 2026-11-01 for CMMC
// PS.L2-3.9.2[b]: approve first, then act). Called by the hub (verify-fin29.mjs runFin29Checks) with its vctx.
// Step EL (ces-tester, after E5 and before E6) -> out/leaver-flow.json; AO's rows in ces.db are the authority:
//   adminops_leaver_flows, adminops_mail_outbox, adminops_leaver_escalations (AO's own collections),
//   adminops_evidence (the A-22 row, matched by correlationId 'leaver-flow:<flowId>'), eo_leaver_findings (EO's).
// Pure judge (judgeV131) plus the reader (fin31LeaverChecks).
import { createHash } from 'node:crypto';
import * as path from 'node:path';

export const LEAVER_FLOW_SCHEMA = 'ces-tester/leaver-flow@1';
export const V131_OBJECTIVE = 'PS.L2-3.9.2[b]';
export const V131_OP = 'A-22';
// confirm: the harness confirms through the token-gated link; bhd: the customer opted in to BHD's done notice.
// unconfirmed: nobody confirms; the window is set to 0 so one AO tick reminds and escalates.
export const V131_SCENARIOS = {
  's1-mach': { mode: 'confirm', bhd: false },
  's2-eng': { mode: 'confirm', bhd: true },
  's3-def': { mode: 'unconfirmed', bhd: false },
};

const ms = (v) => Date.parse(String(v ?? ''));
/** Muster's and AO's outbox hash rule (muster-api mailOutbox.ts outboxHash; ces-ao leaverStore.ts outboxHash). */
export function outboxHash(m) {
  return createHash('sha256').update(JSON.stringify({ from: m.from, to: m.to, subject: m.subject, body: m.body, kind: m.kind, source: m.source }), 'utf-8').digest('hex');
}

// rec: out/leaver-flow.json; stale: staleOf(file); steps: steps.json; rows: { flows, outbox, escalations, evidence, eoFindings }
// (parsed data[] from ces.db, or null when unreadable; evidence is unfiltered: AO evidence rows are tenantId-scoped).
export function judgeV131({ slug, rec = null, stale = null, steps = {}, rows = null, harness = 'tester' }) {
  const sc = V131_SCENARIOS[slug];
  if (!sc) return { pass: true, detail: `not run here: the leaver flow runs on ${Object.keys(V131_SCENARIOS).join(', ')} (muster-partial runs no AdminOps op)` };
  if (harness !== 'tester') return { pass: true, detail: 'not run here: step EL is the tester\'s (mx-e2e.ps1 -Harness tester)' };
  if (!rec) return { pass: false, detail: 'no out/leaver-flow.json (step EL did not run or did not write it)' };
  if (stale) return { pass: false, detail: stale };
  if (!rows) return { pass: false, detail: 'ces.db not readable (the leaver flow\'s rows are judged there)' };
  const problems = [];
  if (rec.schema !== LEAVER_FLOW_SCHEMA) problems.push(`schema ${rec.schema}`);
  if (rec.mode !== sc.mode) problems.push(`mode ${rec.mode}, expected ${sc.mode}`);
  if (steps?.E5?.ended && !(ms(rec.started) >= ms(steps.E5.ended))) problems.push(`EL started ${rec.started}, before E5 ended (offboard_upn must be discovered first)`);
  // The ordering fix: Stamper's E6 read (PS.L2-3.9.2.leaver-access-terminated) must judge A-22's real result.
  if (steps?.E6?.started && !(ms(rec.ended) <= ms(steps.E6.started))) problems.push(`EL ended ${rec.ended}, after E6 started (Stamper's check would not see A-22's result)`);

  // 1. detect
  const flows = (rows.flows ?? []).filter((f) => f.tenantSlug === slug);
  const flow = flows.find((f) => f.flowId === rec.flow_id);
  if (!flow) return { pass: false, detail: [...problems, `flow ${rec.flow_id ?? '(none)'} not in adminops_leaver_flows`].join('; ') };
  if (!(Number(rec.scan?.enabledPastLeavers) >= 1)) problems.push(`scan found ${rec.scan?.enabledPastLeavers ?? '?'} enabled past leaver(s); expected >= 1`);
  if (flow.source?.kind !== 'graph_employeeLeaveDateTime') problems.push(`flow source ${flow.source?.kind}, expected graph_employeeLeaveDateTime`);
  if (!(flow.source?.sourceUrls ?? []).some((u) => /^https:\/\/learn\.microsoft\.com\//.test(u))) problems.push('flow carries no Microsoft Learn source URL for the leave signal');

  // 2. admin email (simulated outbox, hash-verified, a link per recipient)
  const outbox = (rows.outbox ?? []).filter((m) => m.flow_id === flow.flowId);
  const badHash = outbox.filter((m) => m.sha256 !== outboxHash(m));
  if (badHash.length) problems.push(`${badHash.length} outbox message(s) whose sha256 does not match`);
  const notSim = outbox.filter((m) => m.transport !== 'simulated' || m.delivered !== false);
  if (notSim.length) problems.push(`${notSim.length} outbox message(s) not simulated/undelivered`);
  const requests = outbox.filter((m) => m.kind === 'leaver_confirm_request');
  if (!requests.length) problems.push('no leaver_confirm_request in the outbox');
  if (requests.some((m) => !/\/leaver\/confirm\/\S+\?t=/.test(m.body))) problems.push('a confirm request without its confirm link');
  if (!(flow.recipients ?? []).length) problems.push('the flow has no tenant administrator recipient (settings not set by EL)');
  // Identity: every recipient is a tenant administrator the step set, or exactly the configured BHD role mailbox.
  const admins = new Set((flow.recipients ?? []).map((r) => String(r).toLowerCase()));
  const bhdBox = String(rec.bhd_mailbox ?? '').toLowerCase();
  const strangers = outbox.flatMap((m) => m.to ?? []).map((t) => String(t).toLowerCase()).filter((t) => !admins.has(t) && !(bhdBox && t === bhdBox));
  if (strangers.length) problems.push(`${strangers.length} outbox recipient(s) neither a tenant administrator of the flow nor the configured BHD role mailbox`);
  if (outbox.some((m) => m.audience === 'bhd' && (m.to ?? []).some((t) => String(t).toLowerCase() !== bhdBox))) problems.push('a BHD-audience message to an address other than the configured role mailbox');

  const corr = `leaver-flow:${flow.flowId}`;
  const evRows = (rows.evidence ?? []).filter((r) => r?.metadata?.correlationId === corr);
  const bhdMsgs = outbox.filter((m) => m.audience === 'bhd');

  if (sc.mode === 'confirm') {
    // 3. confirm through the token-gated route, as a human would, then A-22 evidenced
    if (rec.confirm?.get_status !== 200) problems.push(`confirm page GET ${rec.confirm?.get_status ?? 'not called'}`);
    if (rec.confirm?.post_status !== 200) problems.push(`confirm POST ${rec.confirm?.post_status ?? 'not called'}`);
    if (rec.confirm?.post_without_bearer !== true) problems.push('the confirm POST must carry no AO bearer token (the link\'s own token is the gate)');
    if (rec.confirm?.reuse_status !== 409) problems.push(`a reused confirm link answered ${rec.confirm?.reuse_status ?? 'not tried'}, expected 409`);
    if (flow.status !== 'done') problems.push(`flow status ${flow.status}, expected done`);
    if (!admins.has(String(flow.confirmedBy ?? '').toLowerCase())) problems.push(`confirmedBy ${flow.confirmedBy ?? '(none)'} is not one of the flow's administrators`);
    const live = evRows.filter((r) => r.metadata?.commandId === V131_OP && r.metadata?.mode === 'live' && r.metadata?.dryRun === false);
    if (!live.length) problems.push(`no live ${V131_OP} evidence row with correlationId ${corr} in adminops_evidence`);
    else {
      const r = live[0];
      if (r.metadata.outcome !== 'executed') problems.push(`${V131_OP} outcome ${r.metadata.outcome}`);
      if (r.metadata.verdict !== 'SAT') problems.push(`${V131_OP} verdict ${r.metadata.verdict}`);
      if (String(r.metadata.requestorUPN ?? '').toLowerCase() !== String(flow.confirmedBy ?? '').toLowerCase()) problems.push(`${V131_OP} requestor ${r.metadata.requestorUPN} is not the confirming administrator`);
      if (!(r.evidenceObjectives ?? []).includes(V131_OBJECTIVE)) problems.push(`${V131_OP} row does not carry ${V131_OBJECTIVE}`);
      if (!String(r.metadata.postStateOutput ?? '').includes('"accountEnabled":false')) problems.push(`${V131_OP} post-state does not show the account disabled`);
    }
    // 4. done notice; BHD only when opted in
    if (!outbox.some((m) => m.kind === 'leaver_done' && m.audience === 'tenant_admins' && (m.to ?? []).length)) problems.push('no leaver_done notice to the tenant administrators');
    if (sc.bhd) {
      if (rec.settings?.notifyBhdOnDone !== true) problems.push('the BHD opt-in was not set on this scenario');
      if (!bhdBox) problems.push('no BHD role mailbox configured (CES_BHD_NOTICE_MAILBOX) for the opted-in scenario');
      if (bhdMsgs.length !== 1 || bhdMsgs[0].kind !== 'leaver_done_bhd' || bhdMsgs[0].undeliverable) problems.push(`BHD opted in: expected exactly one deliverable leaver_done_bhd, got ${bhdMsgs.length}`);
    } else if (bhdMsgs.length) problems.push(`BHD not opted in, but ${bhdMsgs.length} BHD-audience message(s) were recorded`);
    if (problems.length) return { pass: false, detail: problems.join('; ') };
    return { pass: true, detail: `${slug}: detected ${flow.leaver?.upn} (employeeLeaveDateTime ${flow.leaver?.employeeLeaveDateTime}); ${requests.length} admin confirm request(s) (hash-verified, simulated); confirmed through the token link without a bearer by ${flow.confirmedBy}; ${V131_OP} live SAT with ${V131_OBJECTIVE} (correlation ${corr}); done notice to the administrators${sc.bhd ? '; BHD role mailbox notified (customer opt-in)' : '; no BHD notice (not opted in)'}; link reuse refused (409); EL ended before E6` };
  }

  // unconfirmed: nothing acts; one reminder; an escalation (AO record) that EO records as a finding
  if (evRows.some((r) => r.metadata?.mode === 'live')) problems.push(`a live AO row with correlationId ${corr}: something acted without a confirm`);
  if (flow.status !== 'awaiting_confirmation') problems.push(`flow status ${flow.status}, expected awaiting_confirmation (nobody confirmed)`);
  if (!flow.remindedAt) problems.push('no reminder recorded on the flow');
  if (!flow.escalatedAt) problems.push('no escalation recorded on the flow');
  if (!outbox.some((m) => m.kind === 'leaver_reminder')) problems.push('no leaver_reminder in the outbox');
  if (!outbox.some((m) => m.kind === 'leaver_escalation')) problems.push('no leaver_escalation in the outbox');
  const esc = (rows.escalations ?? []).filter((e) => e.flowId === flow.flowId && e.reason === 'unconfirmed_in_window' && e.objectiveId === V131_OBJECTIVE);
  if (!esc.length) problems.push(`no unconfirmed_in_window escalation for ${V131_OBJECTIVE} in adminops_leaver_escalations`);
  if (bhdMsgs.length) problems.push(`${bhdMsgs.length} BHD-audience message(s) on an unconfirmed flow`);
  let eoNote = 'EO finding not checked (no EO collection tick after the escalation in this run)';
  if (rec.eo_tick?.status === 200) {
    const f = (rows.eoFindings ?? []).filter((x) => esc.some((e) => e.escalationId === x.aoEscalationId));
    if (!f.length) problems.push('EO ticked after the escalation but recorded no eo_leaver_findings row for it');
    else eoNote = `EO finding ${f[0].findingId} (${f[0].code})`;
  }
  if (problems.length) return { pass: false, detail: problems.join('; ') };
  return { pass: true, detail: `${slug}: detected ${flow.leaver?.upn}; ${requests.length} admin confirm request(s); nobody confirmed: reminder, then escalation ${esc[0].escalationId} (${V131_OBJECTIVE}); no AO write; ${eoNote}` };
}

// ---------- the area entry point ----------
export async function fin31LeaverChecks(vctx) {
  const rows = [];
  const file = path.join(vctx.out, 'leaver-flow.json');
  const title = 'Leaver flow (PS.L2-3.9.2[b], founder 2026-11-01): detect -> admin email -> confirm through the token link -> A-22 evidenced -> done notice (+BHD only when opted in); unconfirmed escalates';
  try {
    const rec = vctx.exists(file) ? vctx.readJson(file) : null;
    const get = (c, all = false) => vctx.dbRows?.(c, all ? null : vctx.slug) ?? null;
    const flows = get('adminops_leaver_flows');
    const db = flows === null ? null : {
      flows, outbox: get('adminops_mail_outbox') ?? [], escalations: get('adminops_leaver_escalations') ?? [],
      evidence: get('adminops_evidence', true) ?? [], eoFindings: get('eo_leaver_findings') ?? [],
    };
    rows.push({ id: 'V131', title, ...judgeV131({ slug: vctx.slug, rec, stale: rec ? vctx.staleOf(file) : null, steps: vctx.steps ?? {}, rows: db, harness: vctx.harness ?? 'tester' }) });
  } catch (e) {
    rows.push({ id: 'V131', title, pass: false, detail: `error: ${e instanceof Error ? e.message : String(e)}` });
  }
  return rows;
}
