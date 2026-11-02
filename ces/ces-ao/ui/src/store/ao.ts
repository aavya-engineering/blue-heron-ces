// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-30: the AO console's client state (zustand, ADR 2026-10-29). It holds what AO's API returned
// and what the operator typed; the server decides every outcome. The request flow is DRY RUN, then
// APPLY: APPLY unlocks only after a dry run of the same tenant, command and inputs has come back
// from the server (the CLI twin, ces-tester ao-step.ts, also runs `exec` then `exec --apply`).

import { create } from 'zustand';
import type { ApprovalRecord, ApprovalStatus, TwoPersonDecisionRequest } from 'ces-ui-kit';
import { aoApi } from '../api';
import type { AoCommand, ExecuteBody, ExecuteReply, TenantRow } from '../api';
import {
  NO_TENANT_MESSAGE,
  blockedView,
  costFields,
  costNoticeFromReply,
  firewallState,
  initialInputs,
  isEvidenceLost,
  evidenceLostText,
  isRecurring,
  isTier3,
  newCorrelationId,
  objectiveGroups,
  requestKey,
  resultView,
  twoPersonFromReply,
} from './result';
import type { CostNotice, FirewallState, ObjectiveGroup, ResultView } from './result';

/** One evidence row from this session's requests, with the command's objectives (display only, AR5). */
export interface EvidenceRow {
  seq: number;
  at: string;
  commandId: string;
  title: string;
  tenant: string;
  mode: 'dry_run' | 'apply';
  state: ResultView['state'];
  outcome: string;
  verdict: string;
  correlationId: string;
  evidencePath?: string;
  evidenceLost: boolean;
  objectives: ObjectiveGroup[];
}

export interface AoState {
  loaded: boolean;
  loadError: string;
  tenants: TenantRow[];
  liveAllowed: boolean;
  stacksimModeActive: boolean;
  tenant: string;
  commands: AoCommand[];
  domains: { id: string; name: string }[];
  search: string;

  /** Inferred from the server's own replies; no API reports CES_TWO_PERSON_APPROVAL (open item). */
  twoPersonOn: boolean;
  pendingCount: number;

  openId: string | null;
  bindings: Record<string, string>;
  inputs: Record<string, string>;
  /** requestKey() of the last dry run that came back from the server; APPLY needs it to match. */
  dryRunKey: string | null;
  costNotice: CostNotice | null;
  costAck: boolean;
  noOtherMeans: string;
  confirmCost: string;
  requestorUpn: string;
  approvalId: string;
  busy: boolean;
  result: ResultView | null;
  precheck: FirewallState | null;
  confirmOpen: boolean;

  evidence: EvidenceRow[];

  approvalsOpen: boolean;
  approvalsStatus: ApprovalStatus;
  approvals: ApprovalRecord[];
  approvalsLoading: boolean;
  approvalsError: string;
  approverUpn: string;
  approverToken: string;
  approvalsBanner: string;
  approvalsNotice: string;
}

const INITIAL: AoState = {
  loaded: false,
  loadError: '',
  tenants: [],
  liveAllowed: false,
  stacksimModeActive: false,
  tenant: '',
  commands: [],
  domains: [],
  search: '',
  twoPersonOn: false,
  pendingCount: 0,
  openId: null,
  bindings: {},
  inputs: {},
  dryRunKey: null,
  costNotice: null,
  costAck: false,
  noOtherMeans: '',
  confirmCost: '',
  requestorUpn: '',
  approvalId: '',
  busy: false,
  result: null,
  precheck: null,
  confirmOpen: false,
  evidence: [],
  approvalsOpen: false,
  approvalsStatus: 'pending',
  approvals: [],
  approvalsLoading: false,
  approvalsError: '',
  approverUpn: '',
  approverToken: '',
  approvalsBanner: '',
  approvalsNotice: '',
};

export const useAoStore = create<AoState>(() => ({ ...INITIAL }));

const get = () => useAoStore.getState();
const set = (patch: Partial<AoState>) => useAoStore.setState(patch);

export function resetAoStore(): void {
  useAoStore.setState({ ...INITIAL }, true);
  evidenceSeq = 0;
}

let evidenceSeq = 0;

export function openCommand(): AoCommand | null {
  const s = get();
  return s.commands.find((c) => c.id === s.openId) ?? null;
}

export function currentKey(): string | null {
  const s = get();
  return s.openId ? requestKey(s.tenant, s.openId, s.inputs) : null;
}

/** APPLY is unlocked: a tenant is chosen and this exact request has had its dry run. */
export function applyUnlocked(s: AoState = get()): boolean {
  return !!s.openId && !!s.tenant && s.dryRunKey !== null && s.dryRunKey === requestKey(s.tenant, s.openId, s.inputs);
}

// ── load ──────────────────────────────────────────────────────────────────────

export async function loadConsole(): Promise<void> {
  try {
    const [t, c] = await Promise.all([aoApi.tenants(), aoApi.commands()]);
    const domains = (c.body.domains ?? []).map((d) => ({ id: d.id, name: d.name }));
    set({
      loaded: true,
      tenants: Array.isArray(t.body.tenants) ? t.body.tenants : [],
      liveAllowed: t.body.liveAllowed === true,
      stacksimModeActive: t.body.stacksimModeActive === true,
      commands: (c.body.domains ?? []).flatMap((d) => d.commands),
      domains,
      loadError: c.ok ? '' : `Failed to load the command registry (HTTP ${c.status}).`,
    });
  } catch (err) {
    set({ loaded: true, loadError: `Failed to load the console: ${(err as Error).message}` });
  }
  // Legacy L1801-1807: pending approvals on load show the count and mean two-person is on.
  try {
    const p = await aoApi.approvals('pending');
    const n = (p.body.approvals ?? []).length;
    if (n) set({ pendingCount: n, twoPersonOn: true });
  } catch {
    /* legacy ignores */
  }
}

async function loadBindings(tenant: string, commandId: string): Promise<Record<string, string>> {
  if (!tenant) return {};
  try {
    const r = await aoApi.bindings(tenant, commandId);
    return r.ok ? (r.body.bindings ?? {}) : {};
  } catch {
    return {};
  }
}

export async function selectTenant(slug: string): Promise<void> {
  set({ tenant: slug });
  const cmd = openCommand();
  if (!cmd) return;
  const bindings = await loadBindings(slug, cmd.id);
  const inputs = { ...get().inputs };
  for (const p of cmd.parameters) if (p.source && p.name in inputs) inputs[p.name] = bindings[p.name] || '';
  set({ bindings, inputs });
}

export async function selectCommand(id: string): Promise<void> {
  const cmd = get().commands.find((c) => c.id === id);
  if (!cmd) return;
  // A fresh form per open: no dry run, no cost notice, no result (legacy openCommandForm L1216-1325).
  set({
    openId: id,
    bindings: {},
    inputs: initialInputs(cmd, {}),
    dryRunKey: null,
    costNotice: null,
    costAck: false,
    noOtherMeans: '',
    confirmCost: '',
    approvalId: '',
    result: null,
    precheck: null,
    confirmOpen: false,
  });
  const bindings = await loadBindings(get().tenant, id);
  if (get().openId !== id) return;
  set({ bindings, inputs: initialInputs(cmd, bindings) });
}

export function closeCommand(): void {
  set({ openId: null, inputs: {}, result: null, precheck: null, dryRunKey: null, search: '' });
}

export function setInput(name: string, value: string): void {
  set({ inputs: { ...get().inputs, [name]: value } });
}

// ── execute ───────────────────────────────────────────────────────────────────

function recordEvidence(cmd: AoCommand, mode: EvidenceRow['mode'], reply: ExecuteReply, view: ResultView): void {
  if (!reply.evidence && !reply.evidencePath && !isEvidenceLost(reply)) return;
  const row: EvidenceRow = {
    seq: ++evidenceSeq,
    at: new Date().toISOString(),
    commandId: cmd.id,
    title: cmd.title,
    tenant: get().tenant,
    mode,
    state: view.state,
    outcome: reply.evidence?.outcome || view.outcome || '',
    verdict: reply.evidence?.complianceVerdict || reply.evidence?.verdict || '',
    correlationId: view.correlationId,
    evidencePath: reply.evidencePath,
    evidenceLost: isEvidenceLost(reply),
    objectives: objectiveGroups(cmd),
  };
  set({ evidence: [row, ...get().evidence] });
}

function learnFromReply(cmd: AoCommand, reply: ExecuteReply): void {
  const tp = twoPersonFromReply(reply);
  if (tp !== null) set({ twoPersonOn: tp });
  const notice = costNoticeFromReply(reply, cmd.id);
  if (notice) set({ costNotice: notice });
}

function buildBody(cmd: AoCommand, dryRun: boolean, correlationId: string): ExecuteBody {
  const s = get();
  const requestorUPN = s.requestorUpn.trim() || undefined;
  const approvalId = s.approvalId.trim() || undefined;
  return {
    tenant: s.tenant,
    inputs: { ...s.inputs },
    dryRun,
    // W4-AO5 web apply guard: a live request confirms by naming the command.
    ...(dryRun ? {} : { confirmApply: cmd.id }),
    // FIN-13: DP-1 + DP-2 for a recurring-cost op (the server refuses a live run without them).
    ...(dryRun
      ? {}
      : costFields(cmd, s.costNotice, { ackChecked: s.costAck, noOtherMeans: s.noOtherMeans, confirmCost: s.confirmCost, operator: requestorUPN })),
    requestorUPN,
    approvalId,
    correlationId,
  };
}

async function send(cmd: AoCommand, dryRun: boolean): Promise<{ ok: boolean; reply: ExecuteReply; view: ResultView } | null> {
  if (!get().tenant) {
    set({ result: blockedView(NO_TENANT_MESSAGE, 'NO TENANT') });
    return null;
  }
  const key = currentKey();
  const correlationId = newCorrelationId();
  set({ busy: true });
  try {
    const r = await aoApi.execute(cmd.id, buildBody(cmd, dryRun, correlationId));
    const view = resultView(r.body, correlationId);
    learnFromReply(cmd, r.body);
    recordEvidence(cmd, dryRun ? 'dry_run' : 'apply', r.body, view);
    const patch: Partial<AoState> = { result: view };
    if (dryRun) patch.dryRunKey = key;
    if (view.state === 'pending_approval' && view.approvalId) patch.approvalId = view.approvalId;
    set(patch);
    return { ok: r.ok, reply: r.body, view };
  } catch (err) {
    set({ result: blockedView(`Execution error: ${(err as Error).message}`, 'ERROR') });
    return null;
  } finally {
    set({ busy: false });
  }
}

/** Step 1: DRY RUN (dryRun:true). Its return unlocks APPLY for this exact request. */
export async function dryRun(): Promise<void> {
  const cmd = openCommand();
  if (cmd) await send(cmd, true);
}

/** F-11 / F-12: CHECK CURRENT STATE is the read-only dry run with the state badge (legacy L1360). */
export async function firewallPrecheck(): Promise<void> {
  const cmd = openCommand();
  if (!cmd) return;
  if (!get().tenant) {
    set({ precheck: { badge: 'NO TENANT', warning: NO_TENANT_MESSAGE } });
    return;
  }
  set({ precheck: { badge: 'CHECKING…' } });
  const out = await send(cmd, true);
  if (!out) {
    set({ precheck: { badge: 'CHECK FAILED', warning: 'Pre-check error.' } });
    return;
  }
  set({ precheck: firewallState(cmd.id, out.ok, out.reply) });
}

/** Step 2: APPLY (dryRun:false + confirmApply). F-11 / F-12 first ask for confirmation. */
export async function requestApply(): Promise<void> {
  const cmd = openCommand();
  if (!cmd || !applyUnlocked()) return;
  if (cmd.id === 'F-11' || cmd.id === 'F-12') {
    set({ confirmOpen: true });
    return;
  }
  await send(cmd, false);
}

export async function confirmFirewall(ok: boolean): Promise<void> {
  set({ confirmOpen: false });
  const cmd = openCommand();
  if (ok && cmd && applyUnlocked()) await send(cmd, false);
}

/** Show the requestor / operator field: two-person Tier 3, or a recurring op (DP-1 records the operator, spec §3.9). */
export function needsRequestor(cmd: AoCommand | null, twoPersonOn: boolean): { kitFields: boolean; operatorField: boolean } {
  const kitFields = !!cmd && isTier3(cmd) && twoPersonOn;
  return { kitFields, operatorField: !!cmd && !kitFields && isRecurring(cmd) };
}

// ── approvals (rendered only while two-person is on) ─────────────────────────

export async function loadApprovals(status: ApprovalStatus = get().approvalsStatus): Promise<void> {
  set({ approvalsStatus: status, approvalsLoading: true, approvalsError: '' });
  try {
    const r = await aoApi.approvals(status);
    const rows = r.body.approvals ?? [];
    const patch: Partial<AoState> = { approvals: rows, approvalsLoading: false };
    if (status === 'pending') patch.pendingCount = rows.length;
    set(patch);
  } catch (err) {
    set({ approvalsLoading: false, approvalsError: (err as Error).message, approvals: [] });
  }
}

export async function openApprovals(): Promise<void> {
  set({ approvalsOpen: true, approvalsNotice: '' });
  await loadApprovals();
}

export function closeApprovals(): void {
  set({ approvalsOpen: false });
}

export async function decideApproval(req: TwoPersonDecisionRequest): Promise<void> {
  const s = get();
  try {
    const r = await aoApi.decide(req.approvalId, req.decision, req.reason, s.approverToken.trim());
    if (r.status === 401) {
      set({ approvalsNotice: 'Sign-in required: approval decisions need an authenticated approver (x-ces-principal token). Nothing was recorded.' });
      return;
    }
    if (!r.body.success) {
      set({ approvalsNotice: `Decision failed: ${r.body.error ?? 'no reason given'}` });
      return;
    }
    set({
      approvalsBanner: isEvidenceLost(r.body)
        ? `Decision ${req.decision.toUpperCase()} recorded for ${req.approvalId}, but ` + evidenceLostText(r.body)
        : '',
      approvalsNotice: req.decision === 'approve' ? `APPROVED. Re-run the command with APPLY and approvalId ${req.approvalId}.` : '',
    });
    await loadApprovals();
  } catch (err) {
    set({ approvalsNotice: `Decision error: ${(err as Error).message}` });
  }
}

export { set as patchAoStore };
