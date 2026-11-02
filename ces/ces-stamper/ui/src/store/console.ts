// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W8-SPA2: the legacy right column's state (Console / Terminal tabs, status bar, Save Log,
// Execution Results, Error Log, Resource Ledger) as one app-wide store. The execute store feeds
// it stream events; any screen may append console rows (`appendLog`, the legacy
// appendConnectionLog) so connect, assess and preflight logs land in the same #taskList.
// W8-SPAW: this is the one console, status bar and run log for every card (0-4); cards 0-2
// write through `appendLog`, `clearLog`, `setStatus` and the run-log functions below.

import { create } from 'zustand';
import type { LogLevel, RunLogEntry } from 'ces-ui-kit';
import { initialConsoleState, logItem, reduceExecEvent, RunLogBuilder } from './console-events';
import type { ConsoleState, ExecEvent, ReduceContext, RunLog, StatusTone } from './console-events';

export type ConsoleTab = 'console' | 'terminal';

/** Which approval row a decision removes (legacy approval-*, sub-approval-*, layer-approval-*). */
export type ApprovalTargetKey =
  | { scope: 'task'; taskId: string }
  | { scope: 'sub'; taskId: string; subId: string }
  | { scope: 'layer'; layer: number };

export interface SaveMessage {
  text: string;
  tone: 'ok' | 'warn' | 'error';
}

export interface ConsoleStore extends ConsoleState {
  activeTab: ConsoleTab;
  /** `#termVerboseHint` "(verbose forced)". */
  verboseForced: boolean;
  /** `#rlogSaveMsg`. */
  saveMessage: SaveMessage | null;
  /** Error Log panel input (renderErrorLogPanel snapshot); null hides the panel. */
  errorLog: RunLogEntry[] | null;
  /** `#results` is hidden from the start of a run until its summary arrives (legacy L7870). */
  resultsHidden: boolean;
  ledgerOpen: boolean;
  /** Bumped whenever #taskList is cleared; card 2 tags its assess rows with it (W8-SPAW). */
  logEpoch: number;
  appendLog: (message: string, level?: LogLevel) => void;
  /** Legacy `taskList.innerHTML = ''` at the start of connect, assess, baseline and preflight. */
  clearLog: () => void;
  /** Legacy appendEndMessage: a bold success row after a run. */
  appendEndMessage: (text: string) => void;
  appendCompletionBanner: () => void;
  setStatus: (text: string, tone: StatusTone) => void;
  clearStatus: () => void;
  setTab: (tab: ConsoleTab) => void;
  setVerboseForced: (on: boolean) => void;
  setSaveMessage: (msg: SaveMessage | null) => void;
  setErrorLog: (entries: RunLogEntry[] | null) => void;
  toggleStep: (taskId: string) => void;
  toggleLedger: () => void;
  removeApproval: (target: ApprovalTargetKey) => void;
  /** Clears the console and run state at the start of an execute (legacy doExecute L7859-7871). */
  resetForRun: () => void;
  applyEvent: (event: ExecEvent, ctx: ReduceContext) => void;
  reset: () => void;
}

let now: () => Date = () => new Date();

/** Test seam: the clock used for row times, ledger timestamps and the run log. */
export function setConsoleClock(next: () => Date): () => Date {
  const previous = now;
  now = next;
  return previous;
}

export function consoleNow(): Date {
  return now();
}

function initialStore(): Omit<ConsoleStore, keyof ConsoleActions> {
  return {
    ...initialConsoleState(),
    activeTab: 'console',
    verboseForced: false,
    saveMessage: null,
    errorLog: null,
    resultsHidden: false,
    ledgerOpen: false,
    logEpoch: 0,
  };
}

type ConsoleActions = Pick<
  ConsoleStore,
  | 'appendLog'
  | 'clearLog'
  | 'appendEndMessage'
  | 'appendCompletionBanner'
  | 'setStatus'
  | 'clearStatus'
  | 'setTab'
  | 'setVerboseForced'
  | 'setSaveMessage'
  | 'setErrorLog'
  | 'toggleStep'
  | 'toggleLedger'
  | 'removeApproval'
  | 'resetForRun'
  | 'applyEvent'
  | 'reset'
>;

export const useConsoleStore = create<ConsoleStore>()((set) => ({
  ...initialStore(),
  appendLog: (message, level = 'info') => set((s) => logItem(s, message, level, now())),
  clearLog: () => set((s) => ({ items: [], steps: {}, subs: {}, activeStepId: null, logEpoch: s.logEpoch + 1 })),
  appendEndMessage: (text) => set((s) => logItem(s, text, 'success', now(), true)),
  appendCompletionBanner: () =>
    set((s) => {
      const sum = s.summary;
      const pass = (sum?.pass || 0) + (sum?.accomplished || 0);
      const fail = sum?.fail || 0;
      const skip = sum?.skip || 0;
      const total = sum?.total || 0;
      const seq = s.seq + 1;
      const text = `${pass} passed / ${fail} failed / ${skip} skipped / ${total} total`;
      return { seq, items: [...s.items, { kind: 'banner', key: `banner-${seq}`, success: fail === 0, text }] };
    }),
  setStatus: (text, tone) => set({ status: { text, tone } }),
  clearStatus: () => set({ status: null }),
  setTab: (activeTab) => set({ activeTab }),
  setVerboseForced: (verboseForced) => set({ verboseForced }),
  setSaveMessage: (saveMessage) => set({ saveMessage }),
  setErrorLog: (errorLog) => set({ errorLog }),
  toggleStep: (taskId) =>
    set((s) => (s.steps[taskId] ? { steps: { ...s.steps, [taskId]: { ...s.steps[taskId], expanded: !s.steps[taskId].expanded } } } : {})),
  toggleLedger: () => set((s) => ({ ledgerOpen: !s.ledgerOpen })),
  removeApproval: (target) =>
    set((s) => {
      if (target.scope === 'layer') return { items: s.items.filter((it) => !(it.kind === 'layer' && it.layer === target.layer)) };
      if (target.scope === 'sub') {
        const key = `${target.taskId}::${target.subId}`;
        const sub = s.subs[key];
        return sub ? { subs: { ...s.subs, [key]: { ...sub, approval: null } } } : {};
      }
      const step = s.steps[target.taskId];
      return {
        items: s.items.filter((it) => !(it.kind === 'task-approval' && it.taskId === target.taskId)),
        ...(step ? { steps: { ...s.steps, [target.taskId]: { ...step, approval: null } } } : {}),
      };
    }),
  resetForRun: () =>
    set((s) => ({
      ...initialConsoleState(),
      seq: s.seq,
      // The ledger is cleared by the stream's execution_start event, as in legacy.
      ledger: s.ledger,
      activeTab: s.activeTab,
      verboseForced: s.verboseForced,
      saveMessage: null,
      errorLog: null,
      resultsHidden: true,
      ledgerOpen: s.ledgerOpen,
      logEpoch: s.logEpoch + 1,
    })),
  applyEvent: (event, ctx) =>
    set((s) => {
      const next = reduceExecEvent(s, event, ctx);
      return event.type === 'summary' ? { ...next, resultsHidden: false } : next;
    }),
  reset: () => set(initialStore()),
}));

// ---- FIN-33: the one active event stream (legacy `activeEventSource`, index.html L4678) ----
// Connect, assess, baseline, preflight (owner 'tenant') and execute (owner 'execute') share one
// slot, as legacy does: starting any of them closes whatever stream is open (L6340, L7854).
// When a stream is closed by another owner, its `onPreempt` runs so its card does not stay
// "running" (legacy left it stuck; this is the one intended difference).

export type StreamOwner = 'tenant' | 'execute';

export interface ClosableStream {
  close(): void;
}

interface StreamSlot {
  owner: StreamOwner;
  source: ClosableStream;
  onPreempt?: () => void;
}

let streamSlot: StreamSlot | null = null;

function closeSlot(by: StreamOwner): void {
  const prev = streamSlot;
  if (!prev) return;
  streamSlot = null;
  prev.source.close();
  if (prev.owner !== by && prev.onPreempt) prev.onPreempt();
}

/** Puts `source` in the one slot; a different stream already there is closed first. */
export function claimStreamSlot(owner: StreamOwner, source: ClosableStream, onPreempt?: () => void): void {
  if (streamSlot && streamSlot.source !== source) closeSlot(owner);
  streamSlot = { owner, source, ...(onPreempt ? { onPreempt } : {}) };
}

/** Legacy `if (activeEventSource) { activeEventSource.close(); activeEventSource = null; }`. */
export function closeStreamSlot(by: StreamOwner): void {
  closeSlot(by);
}

/** Legacy `evtSource.close(); activeEventSource = null;` from inside a stream's own handler. */
export function releaseStreamSlot(source: ClosableStream): void {
  source.close();
  if (streamSlot && streamSlot.source === source) streamSlot = null;
}

/** The stream in the slot, if `owner` holds it (any owner when omitted). */
export function streamInSlot(owner?: StreamOwner): ClosableStream | null {
  if (!streamSlot) return null;
  if (owner && streamSlot.owner !== owner) return null;
  return streamSlot.source;
}

// ---- FIN-33: one verbose flag (legacy `verboseMode` and syncVerbose, L4685, L4699) ----
// #verboseAssess and #verboseExecute follow one flag. The assess and execute stores register
// here and mirror it; neither imports the other (tenant.ts imports execute.ts).

type VerboseListener = (on: boolean) => void;
const verboseListeners = new Set<VerboseListener>();

/** Registers a mirror of the verbose flag; returns the unregister function. */
export function onVerboseSync(listener: VerboseListener): () => void {
  verboseListeners.add(listener);
  return () => verboseListeners.delete(listener);
}

/** Legacy syncVerbose(src): every verbose box and flag takes the new value. */
export function syncVerbose(on: boolean): void {
  for (const listener of verboseListeners) listener(on);
}

// ---- Run log (one per execute; legacy `_runLog`) ----

let runLog: RunLogBuilder | null = null;

export function initRunLog(init: { planPath: string; tenant: string; mode: string; dryRun: boolean }): RunLogBuilder {
  runLog = new RunLogBuilder({ startedAt: now().toISOString(), ...init });
  return runLog;
}

export function currentRunLog(): RunLog | null {
  return runLog ? runLog.log : null;
}

export function accumulateRunLog(event: ExecEvent): void {
  if (runLog) runLog.accumulate(event, now());
}

export function finishRunLog(): void {
  if (runLog) runLog.log.finishedAt = runLog.log.finishedAt || now().toISOString();
}

/** Test seam. */
export function resetRunLog(): void {
  runLog = null;
}

/** Legacy renderErrorLogPanel: the panel is built from the run log's entries. */
export function errorLogSnapshot(): RunLogEntry[] | null {
  const log = currentRunLog();
  if (!log) return null;
  return log.entries.map((e) => ({
    status: e.status ?? '',
    taskId: e.taskId,
    subId: e.subId,
    controls: e.controls,
    command: e.command,
    streams: e.streams,
    ...(e.outcome ? { outcome: e.outcome } : {}),
    ...(e.outcomeRationale ? { outcomeRationale: e.outcomeRationale } : {}),
    message: e.message,
  }));
}
