// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-30: pure view helpers for the request flow. Every rule here is a port of the legacy page
// (ces-ao/public/index.html) so the SPA shows what the server decided, nothing more (ADR addendum
// rule 3: no business logic in a UI). Line refs are to that page as of 2026-10-31.

import type { AoCommand, AoParameter, CostAck, ExecuteReply } from '../api/types';

/** Legacy isEvidenceLost (L1100): the server says this run's evidence row was NOT persisted. */
export function isEvidenceLost(r: Pick<ExecuteReply, 'evidencePersisted' | 'evidenceLost'> | null | undefined): boolean {
  return !!r && (r.evidencePersisted === false || r.evidenceLost === true);
}

/** Legacy evidenceLostText (L1103). */
export function evidenceLostText(r: Pick<ExecuteReply, 'evidenceWarning' | 'evidenceError'>): string {
  return (
    (r.evidenceWarning || 'EVIDENCE NOT PERSISTED — this run has NO audit evidence row.') +
    (r.evidenceError ? `\nCause: ${r.evidenceError}` : '')
  );
}

/** AO-UI-TEST-HOOKS.md `result-panel[data-state]`. */
export type ResultState = 'idle' | 'blocked' | 'executed' | 'dry_run' | 'denied' | 'pending_approval' | 'failed';

export interface ResultView {
  state: ResultState;
  badge: string;
  badgeClass: 'success' | 'refused' | 'failed';
  output: string;
  refusal?: string;
  evidenceLost?: string;
  correlationId: string;
  outcome?: string;
  verdict?: string;
  approvalId?: string;
  pendingMessage?: string;
  evidence?: { outcome: string; verdictText: string; sat: boolean };
}

export const NO_TENANT_MESSAGE =
  'No tenant selected. Choose a tenant from the tenant list before executing — AdminOps never picks a default tenant.';

/** Legacy showBlocked (L1083): a client-side block, no API call made. */
export function blockedView(message: string, badge = 'BLOCKED'): ResultView {
  return { state: 'blocked', badge, badgeClass: 'refused', output: '', refusal: message, correlationId: '' };
}

/** Legacy displayExecutionResult (L1552-1671): the result panel for one execute reply. */
export function resultView(reply: ExecuteReply, sentCorrelationId: string): ResultView {
  const correlationId = reply.correlationId || sentCorrelationId || '';
  const lost = isEvidenceLost(reply) ? evidenceLostText(reply) : undefined;

  if (reply.status === 'pending_approval') {
    return {
      state: 'pending_approval',
      badge: 'PENDING APPROVAL',
      badgeClass: 'failed',
      output: '',
      evidenceLost: lost,
      correlationId,
      outcome: 'blocked_pending_approval',
      approvalId: reply.approvalId,
      pendingMessage: reply.message,
    };
  }

  const ev = reply.evidence;
  const outcome0 = ev?.outcome;
  const serverError = reply.result?.error || reply.error || '';
  const refused = !reply.success && (/^denied_/.test(outcome0 || '') || (!reply.result && !!reply.error));

  let badge = 'FAILED';
  let badgeClass: ResultView['badgeClass'] = 'failed';
  let refusal: string | undefined;
  if (reply.success) {
    badge = 'SUCCESS';
    badgeClass = 'success';
  } else if (refused) {
    badge = 'REFUSED';
    badgeClass = 'refused';
    refusal =
      (outcome0 === 'denied_sim_only' ? 'Refused by the server (sim-only rail): ' : 'Refused by the server: ') +
      (serverError || 'no reason given');
  }

  const output = reply.result?.stdout ? reply.result.stdout : serverError ? serverError : 'No output available';
  const verdict = ev?.complianceVerdict || ev?.verdict || '';
  const evidence = ev
    ? {
        outcome: ev.outcome || 'UNKNOWN',
        verdictText: verdict ? verdict + (ev.verdictRationale ? ` — ${ev.verdictRationale}` : '') : 'No verdict available',
        sat: verdict === 'SAT',
      }
    : undefined;
  const meta = ev?.metadata ?? {};
  const state: ResultState = refused
    ? 'denied'
    : !reply.success
      ? 'failed'
      : meta.dryRun || meta.mode === 'dry_run'
        ? 'dry_run'
        : 'executed';

  return {
    state,
    badge,
    badgeClass,
    output,
    refusal,
    evidenceLost: lost,
    correlationId,
    outcome: ev?.outcome,
    verdict: verdict || undefined,
    evidence,
  };
}

/** Legacy setTwoPersonMode triggers (L1673-1676): what one reply says about the switch, or null. */
export function twoPersonFromReply(reply: ExecuteReply): boolean | null {
  if (reply.status === 'pending_approval') return true;
  const mode = reply.evidence?.metadata?.twoPersonApproval?.mode;
  if (mode === 'on' || mode === 'off') return mode === 'on';
  return null;
}

export interface CostNotice {
  opId: string;
  ackHash: string;
  monthlyUsd: number;
  priceDate?: string;
  costKey?: string;
}

/** Legacy L1677-1681: a dry run's cost notice for a recurring op, or null. */
export function costNoticeFromReply(reply: ExecuteReply, commandId: string): CostNotice | null {
  const cg = reply.evidence?.metadata?.costGate;
  if (cg && cg.classification === 'recurring' && cg.ackHash && typeof cg.monthlyUsd === 'number') {
    return { opId: commandId, ackHash: cg.ackHash, monthlyUsd: cg.monthlyUsd, priceDate: cg.priceDate, costKey: cg.costKey };
  }
  return null;
}

export function isRecurring(cmd: AoCommand | null | undefined): boolean {
  return !!cmd?.cost_gate?.recurring;
}

export function isTier3(cmd: AoCommand | null | undefined): boolean {
  return (cmd?.sodTier || '').includes('3');
}

export function isFirewall(cmd: AoCommand | null | undefined): boolean {
  return cmd?.id === 'F-11' || cmd?.id === 'F-12';
}

/** The DP-2 text the operator must type: `"<op id> <monthly figure to 2 places>"` (COST-GATE-SPEC §3.5). */
export function dp2Text(notice: CostNotice): string {
  return `${notice.opId} ${Number(notice.monthlyUsd).toFixed(2)}`;
}

/** Legacy updateCostPanel text (L938-963). */
export function costNoticeText(cmd: AoCommand, notice: CostNotice | null): string {
  if (!notice || notice.opId !== cmd.id) return 'Recurring cost: run a DRY RUN first to see the monthly estimate.';
  const cg = cmd.cost_gate!;
  const fig = Number(notice.monthlyUsd).toFixed(2);
  const alts = Array.isArray(cg.standard_alternative) ? cg.standard_alternative : [];
  return (
    `Recurring cost: about $${fig} a month (price date ${notice.priceDate}, key ${notice.costKey || '?'}).` +
    (cg.last_resort ? ` Last resort: standard alternatives exist (${alts.join(', ')}).` : '') +
    ` To run it live, tick DP-1 and type "${dp2Text(notice)}".`
  );
}

/** Legacy costFields (L966-988): DP-1 and DP-2 for a live request of a recurring op, or {}. */
export function costFields(
  cmd: AoCommand,
  notice: CostNotice | null,
  form: { ackChecked: boolean; noOtherMeans: string; confirmCost: string; operator?: string },
  now: () => string = () => new Date().toISOString(),
): { costAck?: CostAck; confirmCost?: string } {
  if (!isRecurring(cmd)) return {};
  const out: { costAck?: CostAck; confirmCost?: string } = {};
  if (notice && notice.opId === cmd.id && form.ackChecked) {
    const nom = form.noOtherMeans.trim();
    out.costAck = {
      opId: cmd.id,
      ackHash: notice.ackHash,
      monthlyUsd: notice.monthlyUsd,
      priceDate: notice.priceDate,
      ...(form.operator ? { operator: form.operator } : {}),
      at: now(),
      ...(nom ? { noOtherMeans: nom } : {}),
    };
  }
  const typed = form.confirmCost.trim();
  if (typed) out.confirmCost = typed;
  return out;
}

/** The parameters the legacy form renders an input for (L1238-1264): text, readonly and select. */
export function formParameters(cmd: AoCommand): AoParameter[] {
  return cmd.parameters.filter((p) => {
    const t = p.type || (p.source ? 'readonly' : 'text');
    return t === 'text' || t === 'readonly' || t === 'select';
  });
}

export function paramType(p: AoParameter): 'text' | 'readonly' | 'select' {
  const t = p.type || (p.source ? 'readonly' : 'text');
  return t === 'select' ? 'select' : t === 'readonly' ? 'readonly' : 'text';
}

/** Initial inputs: tenant bindings for sourced params, the first option for a select, else ''. */
export function initialInputs(cmd: AoCommand, bindings: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of formParameters(cmd)) {
    if (p.source) out[p.name] = bindings[p.name] || '';
    else if (paramType(p) === 'select') out[p.name] = p.options?.[0]?.value ?? '';
    else out[p.name] = '';
  }
  return out;
}

/** The dry run that unlocks APPLY is for this exact tenant, command and inputs. */
export function requestKey(tenant: string, commandId: string, inputs: Record<string, string>): string {
  const sorted = Object.keys(inputs)
    .sort()
    .map((k) => [k, inputs[k]]);
  return JSON.stringify([tenant, commandId, sorted]);
}

/** Legacy newCorrelationId (L1003-1016): one fresh `ao-ui-` id per request. */
export function newCorrelationId(): string {
  const c: Crypto | null = typeof crypto !== 'undefined' ? crypto : null;
  if (c && typeof c.randomUUID === 'function') return 'ao-ui-' + c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `ao-ui-${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export interface ObjectiveGroup {
  control: string;
  objectives: string[];
}

/**
 * The command's assessment objectives (AO-1 `evidence_objectives`) grouped under its practices.
 * Display only (AR5): objectives never score. An objective id is `<control>[<letter>]`.
 */
export function objectiveGroups(cmd: AoCommand): ObjectiveGroup[] {
  const groups = new Map<string, string[]>();
  for (const p of cmd.cmmcPractices ?? []) groups.set(p, []);
  for (const o of cmd.evidence_objectives ?? []) {
    const control = o.includes('[') ? o.slice(0, o.indexOf('[')) : o;
    if (!groups.has(control)) groups.set(control, []);
    groups.get(control)!.push(o);
  }
  return [...groups.entries()].map(([control, objectives]) => ({ control, objectives }));
}

export interface FirewallState {
  badge: string;
  stateClass?: 'allocated' | 'deallocated';
  prov?: string;
  warning?: string;
}

/** Legacy checkFirewallState (L1360-1453): AllocationState / ProvisioningState from a dry run reply. */
export function firewallState(cmdId: string, ok: boolean, reply: ExecuteReply): FirewallState {
  if (!ok && (reply.error || reply.result?.error)) {
    return { badge: 'REFUSED', warning: `Server refused the pre-check: ${reply.error || reply.result?.error}` };
  }
  const text = reply.result?.stdout || '';
  let state: string | null = null;
  let prov: string | null = null;
  try {
    let parsed: unknown = JSON.parse(text);
    if (typeof parsed === 'string') parsed = JSON.parse(parsed);
    const o = parsed as { AllocationState?: string; ProvisioningState?: string };
    state = (o.AllocationState || '').toLowerCase();
    prov = (o.ProvisioningState || '').toLowerCase();
  } catch {
    const m = /Allocation[^a-z]*State["':\s]+([A-Za-z]+)/i.exec(text);
    if (m) state = m[1].toLowerCase();
    const p = /Provisioning[^a-z]*State["':\s]+([A-Za-z]+)/i.exec(text);
    if (p) prov = p[1].toLowerCase();
  }
  let warning: string | undefined;
  if (prov === 'failed') warning = 'Firewall ProvisioningState is FAILED — investigate before changing allocation.';
  if (state === 'allocated' || state === 'deallocated') {
    const target = cmdId === 'F-11' ? 'deallocated' : 'allocated';
    if (state === target && prov !== 'failed') warning = `Firewall is already ${state.toUpperCase()} — proceeding may error.`;
    return { badge: state.toUpperCase(), stateClass: state, prov: prov ? prov.toUpperCase() : undefined, warning };
  }
  return {
    badge: 'STATE UNKNOWN',
    prov: prov ? prov.toUpperCase() : undefined,
    warning: 'Could not determine AllocationState from the pre-check response.',
  };
}
