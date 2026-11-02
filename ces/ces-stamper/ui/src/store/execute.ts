// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W8-SPA2: Execute (legacy card 4) and the actions that span cards 3 and 4, ported from
// ces-stamper/public/index.html:
//   doTranslate L7651, doTranslateAndExecute L7729 (dev quick run), executeFromMatrix L7808,
//   executeRetry L7822, doExecute L7838, haltExecution L7948, approve / approveSubCmd /
//   approveLayer L9355-9413, tryUnlockExecuteFromEP L6733, saveRunLog / autoSaveRunLog
//   L5427-5468, exportResourceLedger L5807, saveResourceLedgerToServer L5960, and the side
//   effects of the done / execution_halted / error events (L9223-9347).
//
// FG-4 (PLAN §9, founder ruling: fix, do not reproduce) changes two legacy behaviours:
//   1. Target stuck on Dry Run. Legacy force-sets #execTargetSelect to "dryrun" when `dev` is
//      chosen and never restores it. Here the target follows the tenant on every tenant change:
//      `dev` -> Dry Run, any other tenant -> Tenant (targetForTenant).
//   2. "Complete" badge on a partial report. Legacy writes "Complete" on `done` whatever the
//      summary said. Here the badge follows the summary the way the execution report's status
//      does (StamperEngine: failed 0 -> completed, nothing passed -> failed, else partial):
//      doneBadge.
// W8-SPAW (founder-side ruling, behaviour clarity, not scoring): after Halt, or a stream
// `execution_halted`, the card-4 badge reads "Halted" (legacy: "Error"). HALTED_BADGE.

import { create } from 'zustand';
import { buildLedgerExport, ledgerSha256, ledgerToJson } from 'ces-ui-kit';
import type { ApprovalDecision, ExecutionSummary, LedgerEntry, LedgerExportFormat } from 'ces-ui-kit';
import { ApiError, apiRequest, stamperApi, stamperStreams } from '../api';
import type { ApproveBody } from '../api';
import { useWorkflowStore } from './workflow';
import {
  accumulateRunLog,
  claimStreamSlot,
  closeStreamSlot,
  consoleNow,
  currentRunLog,
  errorLogSnapshot,
  finishRunLog,
  initRunLog,
  onVerboseSync,
  releaseStreamSlot,
  streamInSlot,
  syncVerbose,
  useConsoleStore,
} from './console';
import type { ApprovalTargetKey } from './console';
import type { ExecEvent } from './console-events';
import { LOCKED_BADGE, quickRunBody, requestTranslate, translateBody, translateSuccessMessage, useTranslateStore } from './translate';
import type { CardBadge } from './translate';

export type ExecMode = 'manual' | 'batch' | 'auto';
export type ExecTarget = 'dryrun' | 'tenant';
export type QuickMode = 'auto' | 'manual';

export const EXEC_MODES: ReadonlyArray<{ value: ExecMode; label: string }> = [
  { value: 'manual', label: 'Incremental' },
  { value: 'batch', label: 'Batch' },
  { value: 'auto', label: 'Automatic' },
];

export const EXEC_TARGETS: ReadonlyArray<{ value: ExecTarget; label: string }> = [
  { value: 'dryrun', label: 'Dry Run' },
  { value: 'tenant', label: 'Tenant' },
];

export const QUICK_LABELS: Record<QuickMode, string> = {
  auto: 'Translate & Execute (Auto)',
  manual: 'Translate & Execute (Manual)',
};

export const NOT_CONNECTED_MESSAGE = 'Tenant not connected. Set the Connection gate to Allow before executing.';
export const OPERATOR_STORAGE_KEY = 'stamper_resourceTracker_operator';

/** FG-4 fix 1: the execute target a tenant starts with. */
export function targetForTenant(slug: string | null): ExecTarget {
  return slug === 'dev' ? 'dryrun' : 'tenant';
}

/**
 * FG-4 fix 2: the card-4 badge when the stream ends with `done`. "Complete" only when nothing
 * failed; otherwise "Partial (n failed)" or "Failed (n failed)", both matching the demo
 * driver's terminal pattern /complete|failed|error|halted/i. No summary: "Complete" (legacy).
 */
export function doneBadge(summary: ExecutionSummary | null): CardBadge {
  if (!summary || !summary.fail) return { text: 'Complete', cls: 'status-done' };
  const passed = (summary.pass || 0) + (summary.accomplished || 0);
  if (passed === 0) return { text: `Failed (${summary.fail} failed)`, cls: 'status-error' };
  return { text: `Partial (${summary.fail} failed)`, cls: 'status-partial' };
}

/** The card-4 badge after an operator halt (W8-SPAW; legacy shows "Error"). Matches the demo driver's /halted/i. */
export const HALTED_BADGE: CardBadge = { text: 'Halted', cls: 'status-error' };

/** Minimal EventSource surface (the browser's, or a test double). */
export interface ExecEventSource {
  onmessage: ((e: { data: string }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  close(): void;
}

export type ExecEventSourceFactory = (url: string) => ExecEventSource;

let createSource: ExecEventSourceFactory = (url) => new EventSource(url) as unknown as ExecEventSource;
// FIN-33: the execute stream sits in the console store's one slot, shared with connect, assess,
// baseline and preflight (legacy one `activeEventSource`).

/** Test seam: replace the EventSource constructor (returns the previous factory). */
export function setExecEventSourceFactory(next: ExecEventSourceFactory): ExecEventSourceFactory {
  const previous = createSource;
  createSource = next;
  return previous;
}

/** Legacy doExecute / haltExecution: close whatever stream is open (L7854, L7950). */
function closeSource() {
  closeStreamSlot('execute');
}

/** Legacy `evtSource.close(); activeEventSource = null;` in the execute stream's own handlers. */
function closeOwnSource() {
  const own = streamInSlot('execute');
  if (own) releaseStreamSlot(own);
}

/** Test seam: the stream an execute opened, if it is still open. */
export function activeExecSource(): ExecEventSource | null {
  return streamInSlot('execute') as ExecEventSource | null;
}

export interface ExecuteState {
  mode: ExecMode;
  target: ExecTarget;
  /** Legacy `verboseMode` (#verboseExecute). */
  verbose: boolean;
  /** Legacy `verboseLogPanelEnabled` (#verboseLogPanelToggle, on by default). */
  logPanel: boolean;
  /** #uploadToExecute (on by default). */
  upload: boolean;
  /** The tenant connection gate (legacy `tenantConnectionState === 'connected'`), set by the tenant screen. */
  connected: boolean;
  badge: CardBadge;
  running: boolean;
  retryVisible: boolean;
  /** #execEpDisplay text and title. */
  epDisplay: { text: string; title: string };
  /** The two dev quick-run buttons: label and disabled state. */
  quick: Record<QuickMode, { label: string; busy: boolean }>;
  setMode: (mode: ExecMode) => void;
  setTarget: (target: ExecTarget) => void;
  setVerbose: (on: boolean) => void;
  setLogPanel: (on: boolean) => void;
  setUpload: (on: boolean) => void;
  setConnected: (on: boolean) => void;
  setBadge: (badge: CardBadge) => void;
  reset: () => void;
}

const INITIAL = {
  mode: 'auto' as ExecMode,
  target: 'tenant' as ExecTarget,
  verbose: false,
  logPanel: true,
  upload: true,
  connected: false,
  badge: LOCKED_BADGE,
  running: false,
  retryVisible: false,
  epDisplay: { text: 'No EP loaded', title: '' },
  quick: {
    auto: { label: QUICK_LABELS.auto, busy: false },
    manual: { label: QUICK_LABELS.manual, busy: false },
  },
};

export const useExecuteStore = create<ExecuteState>()((set) => ({
  ...INITIAL,
  setMode: (mode) => set({ mode }),
  setTarget: (target) => set({ target }),
  // FIN-33: one verbose flag; #verboseAssess follows (legacy syncVerbose).
  setVerbose: (verbose) => {
    set({ verbose });
    syncVerbose(verbose);
  },
  setLogPanel: (logPanel) => set({ logPanel }),
  setUpload: (upload) => set({ upload }),
  setConnected: (connected) => set({ connected }),
  setBadge: (badge) => set({ badge }),
  reset: () => set(INITIAL),
}));

// FIN-33: mirror the one verbose flag (console.ts syncVerbose).
onVerboseSync((on) => {
  if (useExecuteStore.getState().verbose !== on) useExecuteStore.setState({ verbose: on });
});

const consoleApi = () => useConsoleStore.getState();
const workflow = () => useWorkflowStore.getState();
const exec = () => useExecuteStore.getState();
const translateState = () => useTranslateStore.getState();
const tenantValue = () => workflow().tenant ?? '';

function errorText(err: unknown, fallback = 'unknown'): string {
  if (err instanceof ApiError) {
    const p = err.payload as { error?: string } | null;
    return (p && typeof p === 'object' && p.error) || err.message;
  }
  return err instanceof Error ? err.message : fallback;
}

function setQuick(mode: QuickMode, label: string, busy: boolean) {
  useExecuteStore.setState((s) => ({ quick: { ...s.quick, [mode]: { label, busy } } }));
}

function markAssessStale() {
  // Legacy also sets card 2's badge to "Stale" (W8-SPA1's card).
  workflow().setStepState('assess', 'ready');
}

function recordExecutedAt() {
  const tenant = tenantValue();
  if (!tenant || tenant === 'dev') return;
  try {
    window.localStorage.setItem(`executedAt_${tenant}`, consoleNow().toISOString());
  } catch {
    // storage unavailable: nothing else depends on it here
  }
}

function hideHalt() {
  useExecuteStore.setState({ running: false });
}

function failExecute(badge: CardBadge = { text: 'Error', cls: 'status-error' }) {
  workflow().failStep('execute');
  exec().setBadge(badge);
}

// ---- Card 4: validate the executable plan path ----

export async function tryUnlockExecuteFromEP(): Promise<void> {
  const epPath = translateState().outputPath.trim();
  if (!epPath) {
    useExecuteStore.setState({ epDisplay: { text: 'No EP loaded', title: '' } });
    return;
  }
  let valid = false;
  try {
    const data = (await stamperApi.validateFile(epPath)) as { ok?: boolean; exists?: boolean };
    valid = Boolean(data && data.ok && data.exists);
  } catch {
    valid = false;
  }
  if (valid) {
    workflow().setStepState('execute', 'ready');
    exec().setBadge({ text: 'Pending', cls: 'status-default' });
    useExecuteStore.setState({ epDisplay: { text: epPath.split(/[/\\]/).pop() || epPath, title: epPath } });
  } else {
    useExecuteStore.setState({ epDisplay: { text: 'EP not found', title: epPath } });
  }
}

// ---- Card 3: translate ----

export async function doTranslate(): Promise<void> {
  const t = translateState();
  if (!t.missionPlan.trim() || !t.manifest.trim()) {
    consoleApi().setStatus('Mission plan and manifest paths are required for translation.', 'error');
    return;
  }
  const body = translateBody(t, workflow().tenant);
  workflow().startStep('translate');
  t.setBadge({ text: 'Translating...', cls: 'status-running' });
  consoleApi().setStatus('Translating...', 'info');
  try {
    const data = await requestTranslate(body);
    translateState().setLastReply(data);
    if (data.success) {
      if (data.planDataPaths && data.planDataPaths.output) translateState().setOutputPath(data.planDataPaths.output);
      consoleApi().setStatus(translateSuccessMessage(data), 'success');
      workflow().completeStep('translate');
      translateState().setBadge({ text: 'Translated', cls: 'status-done' });
      workflow().setStepState('execute', 'ready');
      exec().setBadge({ text: 'Pending', cls: 'status-default' });
      await tryUnlockExecuteFromEP();
    } else {
      consoleApi().setStatus(`Translation failed: ${data.error}`, 'error');
      workflow().failStep('translate');
      translateState().setBadge({ text: 'Error', cls: 'status-error' });
    }
  } catch (err) {
    consoleApi().setStatus(`Translation error: ${errorText(err)}`, 'error');
    workflow().failStep('translate');
    translateState().setBadge({ text: 'Error', cls: 'status-error' });
  }
}

/** Dev quick run: translate, then execute on Dry Run in the given mode (legacy L7729-7804). */
export async function doTranslateAndExecute(mode: QuickMode = 'auto'): Promise<void> {
  const label = QUICK_LABELS[mode];
  setQuick(mode, 'Translating...', true);
  const t = translateState();
  if (!t.missionPlan.trim() || !t.manifest.trim()) {
    consoleApi().setStatus('Mission plan and manifest paths are required.', 'error');
    setQuick(mode, label, false);
    return;
  }
  const body = quickRunBody(t, workflow().tenant);
  workflow().startStep('translate');
  t.setBadge({ text: 'Translating...', cls: 'status-running' });
  consoleApi().setStatus('Step 1/2: Translating...', 'info');
  let data;
  try {
    data = await requestTranslate(body);
  } catch (err) {
    consoleApi().setStatus(`Translation error: ${errorText(err)}`, 'error');
    workflow().failStep('translate');
    translateState().setBadge({ text: 'Error', cls: 'status-error' });
    setQuick(mode, label, false);
    return;
  }
  translateState().setLastReply(data);
  if (!data.success) {
    consoleApi().setStatus(`Translation failed: ${data.error}`, 'error');
    workflow().failStep('translate');
    translateState().setBadge({ text: 'Error', cls: 'status-error' });
    setQuick(mode, label, false);
    return;
  }
  if (data.planDataPaths) {
    if (data.planDataPaths.output) translateState().setOutputPath(data.planDataPaths.output);
    if (data.planDataPaths.variables) translateState().setVariablesPath(data.planDataPaths.variables);
  }
  workflow().completeStep('translate');
  translateState().setBadge({ text: 'Translated', cls: 'status-done' });
  await tryUnlockExecuteFromEP();
  exec().setBadge({ text: 'Pending', cls: 'status-default' });
  workflow().startStep('execute');
  exec().setBadge({ text: 'Executing...', cls: 'status-running' });
  consoleApi().setStatus(`Translated: ${data.totalTasks} tasks. Executing in ${mode} mode...`, 'info');
  setQuick(mode, 'Executing...', true);
  runExecute(mode, { dryRun: true });
  setQuick(mode, label, false);
}

// ---- Card 4: execute ----

/** The Execute button (legacy executeFromMatrix). */
export function executeFromMatrix(): void {
  const tenant = tenantValue();
  if (tenant !== 'dev' && !exec().connected) {
    consoleApi().setStatus(NOT_CONNECTED_MESSAGE, 'error');
    return;
  }
  workflow().startStep('execute');
  exec().setBadge({ text: 'Executing...', cls: 'status-running' });
  runExecute(exec().mode);
}

/** "Retry Skipped/Failed" (legacy executeRetry). */
export function executeRetry(): void {
  const tenant = tenantValue();
  if (tenant !== 'dev' && !exec().connected) {
    consoleApi().setStatus(NOT_CONNECTED_MESSAGE, 'error');
    return;
  }
  workflow().startStep('execute');
  exec().setBadge({ text: 'Retrying...', cls: 'status-running' });
  runExecute(exec().mode, { retry: true });
}

/** Opens SSE /api/execute (legacy doExecute). `dryRun` defaults to the target select. */
export function runExecute(mode: ExecMode | QuickMode, opts: { retry?: boolean; dryRun?: boolean } = {}): void {
  const plan = translateState().outputPath.trim();
  const tenant = tenantValue();
  const dryRun = opts.dryRun ?? exec().target === 'dryrun';

  if (tenant !== 'dev' && !exec().connected) {
    consoleApi().setStatus(NOT_CONNECTED_MESSAGE, 'error');
    return;
  }
  if (!plan) {
    consoleApi().setStatus('Provide the executable plan output path to execute.', 'error');
    return;
  }
  closeSource();

  consoleApi().resetForRun();
  initRunLog({ planPath: plan, tenant: tenant || 'dev', mode, dryRun });
  consoleApi().clearStatus();
  workflow().startStep('execute');
  exec().setBadge({ text: 'Executing...', cls: 'status-running' });
  consoleApi().setStatus('Connecting to execution stream...', 'info');
  useExecuteStore.setState({ running: true, retryVisible: false });

  // Legacy forces verbose on when the Terminal tab is showing.
  if (consoleApi().activeTab === 'terminal' && !exec().verbose) {
    exec().setVerbose(true);
    consoleApi().setVerboseForced(true);
  }

  const url = stamperStreams.execute({
    plan,
    mode,
    dryRun,
    tenant: tenant || 'dev',
    verbose: exec().verbose,
    uploadToBlob: exec().upload,
    ...(opts.retry ? { retry: 'true' } : {}),
  });
  const source = createSource(url);
  claimStreamSlot('execute', source, onExecPreempted);

  source.onmessage = (e) => {
    let d: ExecEvent;
    try {
      d = JSON.parse(e.data) as ExecEvent;
    } catch {
      return; // ignore parse errors, as legacy
    }
    handleExecEvent(d);
  };
  source.onerror = () => {
    consoleApi().setStatus('Connection to execution stream lost.', 'error');
    failExecute();
    releaseStreamSlot(source);
    hideHalt();
    finishRunLog();
  };
}

/**
 * FIN-33: another operation (connect, assess, baseline or preflight) closed the execute stream.
 * Legacy left card 4 reading "Executing..."; here it reads "Halted" and the run log is closed.
 */
function onExecPreempted(): void {
  consoleApi().setStatus('Execution stream closed: another operation started.', 'error');
  failExecute(HALTED_BADGE);
  hideHalt();
  finishRunLog();
}

/** One stream event: run log, console view model, then the card and rail side effects. */
export function handleExecEvent(d: ExecEvent): void {
  accumulateRunLog(d);
  consoleApi().applyEvent(d, { now: consoleNow(), verbose: exec().verbose, logPanel: exec().logPanel });

  if (d.type === 'done') {
    consoleApi().setStatus('Execution complete.', 'success');
    workflow().completeStep('execute');
    const summary = consoleApi().summary;
    exec().setBadge(doneBadge(summary));
    closeOwnSource();
    hideHalt();
    consoleApi().appendCompletionBanner();
    useExecuteStore.setState({ retryVisible: Boolean(summary && ((summary.fail || 0) > 0 || (summary.skip || 0) > 0)) });
    consoleApi().setErrorLog(errorLogSnapshot());
    void autoSaveRunLog();
    void saveLedgerToServer();
    workflow().setStepState('evidence', 'ready');
    const tenant = tenantValue();
    // Legacy auto-runs the evidence scan here (doEvidenceScan); its card is W8-SPA3's.
    if (tenant) void stamperApi.evidenceScan(tenant).catch(() => undefined);
    markAssessStale();
    recordExecutedAt();
  } else if (d.type === 'execution_halted') {
    consoleApi().setStatus('Execution halted by operator', 'error');
    failExecute(HALTED_BADGE);
    closeOwnSource();
    hideHalt();
    finishRunLog();
    consoleApi().setErrorLog(errorLogSnapshot());
    void autoSaveRunLog();
    markAssessStale();
    recordExecutedAt();
  } else if (d.type === 'error') {
    consoleApi().setStatus(`Error: ${d.message}`, 'error');
    failExecute();
    closeOwnSource();
    hideHalt();
    finishRunLog();
  }
}

/** #btnHalt: close the stream (server `closed` flag), then POST /api/abort (best effort). */
export async function haltExecution(): Promise<void> {
  closeSource();
  try {
    await stamperApi.abort();
  } catch {
    // best-effort
  }
  consoleApi().setStatus('Execution halted by operator', 'error');
  failExecute(HALTED_BADGE);
  hideHalt();
  finishRunLog();
  consoleApi().setErrorLog(errorLogSnapshot());
  await autoSaveRunLog();
}

/** POST /api/approve with the legacy body for the row; the row goes away on `ok`. */
export async function approveRow(target: ApprovalTargetKey, decision: ApprovalDecision): Promise<void> {
  const body: ApproveBody =
    target.scope === 'layer'
      ? { layer: target.layer, decision }
      : target.scope === 'sub'
        ? { taskId: target.taskId, subId: target.subId, decision }
        : { taskId: target.taskId, decision };
  const prefix = target.scope === 'layer' ? 'Layer approval failed: ' : 'Approval failed: ';
  try {
    const result = (await stamperApi.approve(body)) as { ok?: boolean; error?: string };
    if (!result || !result.ok) {
      consoleApi().setStatus(prefix + ((result && result.error) || 'unknown'), 'error');
      return;
    }
    consoleApi().removeApproval(target);
  } catch (err) {
    consoleApi().setStatus(prefix + errorText(err), 'error');
  }
}

// ---- Run log and ledger persistence ----

/** "Save Log" (POST /api/save-run-log { log }). Resolves the saved path, or null. */
export async function saveRunLog(): Promise<string | null> {
  const log = currentRunLog();
  if (!log) {
    consoleApi().setSaveMessage({ text: 'No execution data to save', tone: 'warn' });
    return null;
  }
  try {
    const tenant = tenantValue();
    if (tenant && tenant !== 'dev') log.tenant = tenant;
    const result = (await stamperApi.saveRunLog(log)) as { ok?: boolean; path?: string; error?: string };
    if (result && result.ok) {
      consoleApi().setSaveMessage({ text: `Saved: ${result.path}`, tone: 'ok' });
      return result.path ?? '';
    }
    consoleApi().setSaveMessage({ text: `Save failed: ${(result && result.error) || 'unknown'}`, tone: 'error' });
  } catch (err) {
    consoleApi().setSaveMessage({ text: `Save failed: ${errorText(err)}`, tone: 'error' });
  }
  return null;
}

export async function autoSaveRunLog(): Promise<void> {
  if (!currentRunLog()) return;
  finishRunLog();
  const saved = await saveRunLog();
  if (saved !== null) consoleApi().appendEndMessage(`Run log saved: ${saved}`);
}

function ledgerPlanId(): string {
  const log = currentRunLog() as (ReturnType<typeof currentRunLog> & { executionId?: string; planId?: string }) | null;
  return (log && (log.executionId || log.planId)) || 'unknown';
}

function readOperator(): string | null {
  try {
    return window.sessionStorage.getItem(OPERATOR_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** The operator name for ledger metadata: cached, else asked once (legacy prompt). */
export function ledgerOperator(): string {
  const cached = readOperator();
  if (cached) return cached;
  const answer = typeof window.prompt === 'function' ? window.prompt('Enter your name for ledger metadata:') : null;
  if (!answer) return 'unknown';
  try {
    window.sessionStorage.setItem(OPERATOR_STORAGE_KEY, answer);
  } catch {
    // not cached; asked again next time
  }
  return answer;
}

function download(content: string, mimeType: string, filename: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** The ledger's Markdown / JSON / CSV buttons (legacy exportResourceLedger). */
export async function exportLedger(format: LedgerExportFormat, entries: LedgerEntry[]): Promise<void> {
  const operator = ledgerOperator();
  const file = await buildLedgerExport(format, entries, {
    planId: ledgerPlanId(),
    tenant: tenantValue() || 'dev',
    timestamp: consoleNow().toISOString(),
    operator,
  });
  download(file.content, file.mimeType, file.filename);
}

/** After `done`: POST /api/save-run-log { log, filename, isResourceLedger }; download on failure. */
export async function saveLedgerToServer(): Promise<void> {
  const ledger = consoleApi().ledger;
  if (ledger.length === 0) return;
  const operator = readOperator() || 'unknown';
  const planId = ledgerPlanId();
  const tenant = tenantValue() || 'dev';
  const timestamp = consoleNow().toISOString();
  const sha256Hash = await ledgerSha256(ledger);
  const filename = `resource-ledger-${planId}.json`;
  try {
    await apiRequest('POST', '/api/save-run-log', {
      body: {
        log: { executionMetadata: { planId, tenant, timestamp, operator, sha256Hash }, resources: ledger },
        filename,
        isResourceLedger: true,
      },
    });
  } catch {
    download(ledgerToJson(ledger, { planId, tenant, timestamp, operator }, sha256Hash), 'application/json', filename);
  }
}

// ---- Tenant changes (legacy onTenantChange L6190-6240, cards 3-4 part) ----

/**
 * What cards 3 and 4 do when the tenant changes: both badges back to Locked, the connection
 * gate closed, and the target set for the tenant (FG-4 fix 1). The path load that follows in
 * legacy (/api/last-translate, then /api/validate-file) is card 1's, in W8-SPA1.
 */
export function onTenantChanged(slug: string): void {
  translateState().setBadge(LOCKED_BADGE);
  useExecuteStore.setState({ badge: LOCKED_BADGE, connected: false, target: targetForTenant(slug) });
}

let unwatch: (() => void) | null = null;

/** Follows the workflow store's tenant (idempotent; the screens call it on import). */
export function watchTenant(): void {
  if (unwatch) return;
  unwatch = useWorkflowStore.subscribe((state, prev) => {
    if (state.tenant && state.tenant !== prev.tenant) onTenantChanged(state.tenant);
  });
}

/** Test seam. */
export function unwatchTenant(): void {
  if (unwatch) unwatch();
  unwatch = null;
}

/** Test seam: closes any stream and resets the three stores this slice owns. */
export function resetExecution(): void {
  closeSource();
  useExecuteStore.getState().reset();
  useTranslateStore.getState().reset();
  useConsoleStore.getState().reset();
}
