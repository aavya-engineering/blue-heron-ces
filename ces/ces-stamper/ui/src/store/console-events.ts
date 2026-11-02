// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W8-SPA2: the execute stream (SSE /api/execute) turned into console rows, terminal blocks,
// ledger rows, run-log entries and card-4 counts. Pure functions, ported from the legacy
// console (ces-stamper/public/index.html):
//   handleEvent            L8193-8348  -> reduceExecEvent
//   accumulateRunLog       L5304-5414  -> RunLogBuilder.accumulate
//   classifyResourceFromEvent, inferResourceType, extractResourcePath, stdoutContainsData,
//   addToResourceLedger    L5472-5614  -> ledgerEntryFromEvent
//   execProgressTracker, normalizeExecStatus, updateExecProgress, updateExecActionProgress
//                          L5174-5283  -> grid helpers
//   appendConnectionLog    L6133-6159  -> logItem
// Rendering lives in screens/console; the kit panels take the rows as props.

import { escId } from 'ces-ui-kit';
import type { ControlResult, ExecutionSummary, LedgerEntry, LogLevel, TerminalBlock, TerminalPhase } from 'ces-ui-kit';

// ---- Stream events (execute.routes.ts `send({...})` shapes, every field optional) ----

export interface ExecVerification {
  confidence?: string;
  score?: number;
  reason?: string;
  details?: { exit_code_check?: boolean; set_output_check?: boolean; evidence_check?: boolean };
}

export interface ExecEvent {
  type: string;
  message?: string;
  taskId?: string;
  subId?: string;
  label?: string;
  engine?: string;
  directive?: string;
  idempotency?: string;
  subCommandCount?: number;
  controls?: string[];
  layer?: number;
  index?: number;
  total?: number;
  command?: string;
  phase?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  durationMs?: number;
  evidenceFile?: string;
  captures?: Record<string, unknown>;
  verification?: ExecVerification;
  status?: string;
  outcome?: string;
  outcomeRationale?: string;
  preCheck?: { alreadyApplied?: boolean; output?: string };
  taskCount?: number;
  downstreamImpact?: Array<{ taskId: string; variables: string[] }>;
  pass?: number;
  fail?: number;
  skip?: number;
  accomplished?: number;
  dryRunLog?: string;
  reportJson?: string;
  reportMd?: string;
  data?: { results?: Array<Partial<ControlResult>> };
  before?: string;
  after?: string;
  controlsInScope?: number;
  controlsOutOfScope?: number;
  stepsTotal?: number;
  actionsTotal?: number;
  totalControls?: number;
}

// ---- View model ----

/** A legacy status element: `class="<cls>"` and its text. */
export interface Badge {
  cls: string;
  text: string;
}

export type SubLine =
  /** `.sub-cmd-stream-line` with a phase badge, the command, duration, output and stderr. */
  | {
      kind: 'stream';
      badgeCls: string;
      badge: string;
      command: string;
      durationMs?: number;
      stdout: string;
      stderr: string;
      savePath?: string;
      verboseOnly: boolean;
    }
  /** PRE-ACCOMPLISHED, SKIP and QUERY notes (`.stream-phase-badge <cls>` + text). */
  | { kind: 'note'; badgeCls: string; badge: string; text: string; output?: string; verboseOnly: boolean }
  /** `.sub-cmd-captures`: CAPTURE key=value pairs. */
  | { kind: 'captures'; pairs: Array<[string, string]>; verboseOnly: boolean }
  /** `.sub-cmd-verification`: confidence, score, checks, reason. */
  | { kind: 'verify'; confCls: string; confidence: string; score: string; checks: string; reason: string };

/** The legacy "Verbose Log" panel of one sub-command (buildVerboseLogPanel L7974). */
export type VlpItem =
  | { kind: 'phase'; cls: string; label: string; command?: string; stdout?: string; stderr?: string }
  | { kind: 'chunk'; text: string; live: boolean };

export interface VlpVerdict {
  /** Badge class (`verdict-pass` ...); absent for the plain PASS/SKIP/FAIL label. */
  badgeCls?: string;
  label: string;
  detail?: string;
}

export interface VerbosePanel {
  controls: string[];
  items: VlpItem[];
  verdicts: VlpVerdict[];
}

export interface SubApproval {
  preCheck?: { alreadyApplied?: boolean; output?: string };
  idempotency?: string;
}

export interface SubView {
  key: string;
  taskId: string;
  subId: string;
  label: string;
  /** `.sub-cmd-tag .tag-index` "i/n" before the sub id (sub_command rows only). */
  tagIndex: string | null;
  engine?: string;
  /** Present for sub_command rows (the `.sub-cmd-command-line`). */
  command?: string;
  status: Badge | null;
  verdict: Badge | null;
  awaiting: boolean;
  approval: SubApproval | null;
  lines: SubLine[];
  liveOut: string | null;
  hadLiveChunks: boolean;
  vlp: VerbosePanel | null;
}

export interface StepView {
  taskId: string;
  label: string;
  engine?: string;
  directive?: string;
  idempotency?: string;
  countLabel: string;
  status: Badge;
  expanded: boolean;
  controls: string[];
  subKeys: string[];
  approval: { idempotency?: string } | null;
  impact: string | null;
  stateDiffs: Array<{ before: string; after: string }>;
}

export type ConsoleItem =
  | { kind: 'log'; key: string; time: string; level: LogLevel; message: string; end?: boolean }
  | { kind: 'step'; key: string; taskId: string }
  /** task_approve_request with no step row: legacy appends the buttons to #taskList. */
  | { kind: 'task-approval'; key: string; taskId: string; idempotency?: string }
  | { kind: 'layer'; key: string; layer: number; taskCount: number }
  | { kind: 'banner'; key: string; success: boolean; text: string };

export type GridGroup = 'l03' | 'l47' | 'l8';
export type GridRow = 'pass' | 'fail' | 'excluded' | 'nonstack';
export const GRID_GROUPS: readonly GridGroup[] = ['l03', 'l47', 'l8'];
export const GRID_ROWS: readonly GridRow[] = ['pass', 'fail', 'excluded', 'nonstack'];

export interface Tracker {
  pass: number;
  fail: number;
  skip: number;
  accomplished: number;
  excluded: number;
  nonstack: number;
}

export interface ExecGrid {
  visible: boolean;
  steps: Record<GridGroup, Tracker>;
  actions: Record<GridGroup, Tracker>;
}

export interface ExecutionScope {
  controlsInScope: number;
  controlsOutOfScope: number;
  stepsTotal: number;
  actionsTotal: number;
  totalControls: number;
}

export interface TaskMeta {
  label: string;
  layer: number | '';
  engine: string;
  controls: string[];
  directive: string;
}

/** Legacy showStatus types; `running` and `done` are the ones cards 0-2 also use. */
export type StatusTone = 'info' | 'success' | 'error' | 'running' | 'done';

export interface StatusLine {
  text: string;
  tone: StatusTone;
}

export interface ConsoleState {
  items: ConsoleItem[];
  steps: Record<string, StepView>;
  subs: Record<string, SubView>;
  activeStepId: string | null;
  terminal: TerminalBlock[];
  termBuffers: Record<string, TerminalBlock[]>;
  ledger: LedgerEntry[];
  taskMeta: Record<string, TaskMeta>;
  scope: ExecutionScope | null;
  /** `#executeCounter` text ('' until the first action). */
  counter: { steps: number; actions: number; text: string };
  grid: ExecGrid;
  summary: ExecutionSummary | null;
  controlResults: ControlResult[] | null;
  /** `#statusBar` (legacy showStatus / clearStatus). */
  status: StatusLine | null;
  seq: number;
}

export interface ReduceContext {
  now: Date;
  /** Legacy `verboseMode` at the time of the event. */
  verbose: boolean;
  /** Legacy `verboseLogPanelEnabled` (the "Log Panel" toggle). */
  logPanel: boolean;
}

function emptyTracker(): Tracker {
  return { pass: 0, fail: 0, skip: 0, accomplished: 0, excluded: 0, nonstack: 0 };
}

export function emptyGrid(): ExecGrid {
  return {
    visible: false,
    steps: { l03: emptyTracker(), l47: emptyTracker(), l8: emptyTracker() },
    actions: { l03: emptyTracker(), l47: emptyTracker(), l8: emptyTracker() },
  };
}

export function initialConsoleState(): ConsoleState {
  return {
    items: [],
    steps: {},
    subs: {},
    activeStepId: null,
    terminal: [],
    termBuffers: {},
    ledger: [],
    taskMeta: {},
    scope: null,
    counter: { steps: 0, actions: 0, text: '' },
    grid: emptyGrid(),
    summary: null,
    controlResults: null,
    status: null,
    seq: 0,
  };
}

/** Legacy `HH:MM:SS` (local time), as appendConnectionLog and the terminal separator print it. */
export function clockTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function subKey(taskId: string, subId: string): string {
  return `${taskId}::${subId}`;
}

/** Legacy DOM id suffix for a sub-command row: `escId(taskId) + '-' + escId(subId)`. */
export function safeSubId(taskId: string, subId: string): string {
  return `${escId(taskId)}-${escId(subId)}`;
}

/** A console log row (appendConnectionLog). */
export function logItem(state: ConsoleState, message: string, level: LogLevel, now: Date, end = false): ConsoleState {
  const seq = state.seq + 1;
  const item: ConsoleItem = { kind: 'log', key: `log-${seq}`, time: clockTime(now), level, message, ...(end ? { end } : {}) };
  return { ...state, seq, items: [...state.items, item] };
}

// ---- Resource ledger (L5472-5614) ----

export function inferResourceType(cmdlet: string | undefined): string {
  if (!cmdlet) return 'Unknown';
  const firstLine = cmdlet.split('\n')[0];
  const cmdletName = firstLine.trim().split(' ')[0];
  const rtMatch = cmdlet.match(/-ResourceType\s+['"]?([^'" ]+)/);
  if (rtMatch && rtMatch[1]) {
    const segments = rtMatch[1].split('/');
    if (segments.length > 1) return segments[segments.length - 1];
    return rtMatch[1];
  }
  const dashIndex = cmdletName.indexOf('-');
  if (dashIndex > 0) return cmdletName.substring(dashIndex + 1);
  return cmdletName || 'Unknown';
}

export function extractResourcePath(command: string | undefined, subId: string | undefined, taskId: string | undefined): string {
  if (!command) return taskId || 'unknown';
  if (subId && subId !== 'default' && subId.length > 0) return subId;
  const patterns = [
    /-Identity\s+['"]([^'"]+)['"]/,
    /-Name\s+['"]([^'"]+)['"]/,
    /-DisplayName\s+['"]([^'"]+)['"]/,
    /-ResourceName\s+['"]([^'"]+)['"]/,
  ];
  for (const pattern of patterns) {
    const match = command.match(pattern);
    if (match && match[1]) return match[1];
  }
  return taskId || 'unknown';
}

export function stdoutContainsData(stdout: string | undefined): boolean {
  if (!stdout || stdout.trim().length === 0) return false;
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (parsed && (Array.isArray(parsed) ? parsed.length > 0 : Object.keys(parsed as object).length > 0)) return true;
  } catch {
    // not JSON: heuristics below
  }
  const lower = stdout.toLowerCase();
  for (const keyword of ['error', 'exception', 'failed', 'not found']) {
    if (lower.indexOf(keyword) >= 0) return false;
  }
  const lines = stdout.split('\n');
  if (lines.length > 1) return true;
  if (lines.length === 1 && lines[0].trim().length > 50) return true;
  return false;
}

export function classifyResourceFromEvent(d: ExecEvent): 'discovered' | 'created' | null {
  if (!d || !d.command) return null;
  const cmdlet = d.command.trim();
  const isCreateCommand =
    cmdlet.startsWith('New-Mg') || cmdlet.startsWith('New-Az') || cmdlet.startsWith('Set-Organization') || cmdlet.startsWith('Set-Spo');
  if (d.phase === 'idempotent_skip') return 'discovered';
  if (d.phase === 'get_command' && d.exitCode === 0 && stdoutContainsData(d.stdout)) return 'discovered';
  if (d.phase === 'capture_resolved' && d.captures && Object.keys(d.captures).length > 0) {
    for (const key of Object.keys(d.captures)) {
      const val = String(d.captures[key]);
      if (
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val) ||
        val.indexOf('/subscriptions/') >= 0 ||
        val.indexOf('://') >= 0
      ) {
        return 'discovered';
      }
    }
  }
  if (d.phase === 'set_command' && d.exitCode === 0 && isCreateCommand) return 'created';
  return null;
}

/** One ledger row for a stream event, keys in the legacy order (the JSON export hashes them). */
export function ledgerEntryFromEvent(d: ExecEvent, now: Date): LedgerEntry | null {
  const category = classifyResourceFromEvent(d);
  if (!category) return null;
  return {
    category,
    type: inferResourceType(d.command),
    path: extractResourcePath(d.command, d.subId, d.taskId),
    step: d.taskId || 'unknown',
    timestamp: now.toISOString(),
    cmdlet: d.command as string,
  };
}

// ---- Card-4 progress grid (L5174-5283) ----

export function normalizeExecStatus(s: string | undefined): string | undefined {
  if (s === 'document-absence' || s === 'document-prohibition') return 'excluded';
  if (s === 'inherit-fedramp') return 'pass';
  if (s === 'validated' || s === 'accomplished') return 'pass';
  if (s === 'manual') return 'nonstack';
  if (s === 'eo-tooled') return 'nonstack';
  return s;
}

const TRACKED = ['pass', 'fail', 'skip', 'accomplished', 'excluded', 'nonstack'];

function groupOf(layer: unknown): GridGroup {
  const n = parseInt(String(layer), 10) || 0;
  return n <= 3 ? 'l03' : n <= 7 ? 'l47' : 'l8';
}

function bump(grid: ExecGrid, which: 'steps' | 'actions', layer: unknown, rawStatus: string | undefined): ExecGrid {
  const status = normalizeExecStatus(rawStatus);
  if (!status || !TRACKED.includes(status)) return grid;
  const group = groupOf(layer);
  const key = status as keyof Tracker;
  const table = grid[which];
  return {
    ...grid,
    visible: true,
    [which]: { ...table, [group]: { ...table[group], [key]: table[group][key] + 1 } },
  };
}

/** `val_<group>_<row>` for steps. */
export function gridStepCell(grid: ExecGrid, group: GridGroup | 'total', row: GridRow): number {
  if (group === 'total') return GRID_GROUPS.reduce((sum, g) => sum + grid.steps[g][row], 0);
  return grid.steps[group][row];
}

/** `val_act_<row>`: the pass row sums pass, skip and accomplished actions (legacy L5272). */
export function gridActionCell(grid: ExecGrid, row: GridRow): number {
  const sum = (k: keyof Tracker) => GRID_GROUPS.reduce((total, g) => total + grid.actions[g][k], 0);
  return row === 'pass' ? sum('pass') + sum('skip') + sum('accomplished') : sum(row);
}

// ---- Status and verdict maps ----

const PASS_OUTCOMES = new Set([
  'automated_success',
  'policy_compliance',
  'manual_action',
  'outside_action',
  'inherited',
  'not_applicable',
  'exception_granted',
]);

/** The sub-command verdict badge (four badge types, L8855-8877). */
export function outcomeBadge(outcome: string): Badge {
  if (PASS_OUTCOMES.has(outcome)) return { cls: 'verdict-pass', text: 'PASS' };
  if (outcome === 'failed_remediation_available' || outcome === 'failed_no_remediation') return { cls: 'verdict-fail', text: 'FAIL' };
  if (outcome === 'partial_success') return { cls: 'verdict-error', text: 'PARTIAL' };
  if (outcome === 'verification_pending') return { cls: 'verdict-error', text: 'PENDING' };
  if (outcome === 'unknown_legacy') return { cls: 'verdict-unknown', text: 'LEGACY' };
  return { cls: 'verdict-unknown', text: 'UNKNOWN' };
}

const OUTCOME_LABELS: Record<string, string> = {
  automated_success: 'SAT (automated)',
  policy_compliance: 'SAT (policy compliance)',
  manual_action: 'SAT (manual action)',
  outside_action: 'SAT (outside action)',
  inherited: 'SAT (inherited)',
  not_applicable: 'N/A',
  exception_granted: 'SAT (exception)',
  failed_remediation_available: 'NOT_SAT (remediation available)',
  failed_no_remediation: 'NOT_SAT (no remediation)',
  partial_success: 'PARTIAL',
  verification_pending: 'PENDING',
  unknown_legacy: 'LEGACY',
};

function vlpOutcomeClass(outcome: string): string {
  if (PASS_OUTCOMES.has(outcome)) return 'verdict-pass';
  if (outcome === 'failed_remediation_available' || outcome === 'failed_no_remediation') return 'verdict-fail';
  if (outcome === 'partial_success' || outcome === 'verification_pending') return 'verdict-error';
  return 'verdict-unknown';
}

/** Step status after task_result (L9100-9127). */
export function taskResultBadge(status: string | undefined, engine: string | undefined): Badge {
  if (status === 'pass') return engine === 'manual_gate' ? { cls: 'manual_gate', text: 'MANUAL_GATE' } : { cls: 'pass', text: 'PASS' };
  if (status === 'accomplished') return { cls: 'pass', text: 'PASS' };
  if (status === 'fail') return { cls: 'fail', text: 'FAIL' };
  if (status === 'excluded' || status === 'document-absence' || status === 'document-prohibition') {
    return { cls: 'excluded', text: status === 'document-absence' ? 'ABSENT' : status === 'document-prohibition' ? 'PROHIBITED' : 'EXCLUDED' };
  }
  if (status === 'inherit-fedramp') return { cls: 'pass', text: 'INHERITED' };
  if (status === 'nonstack') return { cls: 'nonstack', text: 'NON-STACK' };
  return { cls: 'skip', text: 'SKIP' };
}

/** Sub-command status after sub_command_result (L8834-8852). */
export function subResultBadge(status: string | undefined, engine: string | undefined): Badge {
  if (status === 'pass') return engine === 'manual_gate' ? { cls: 'manual_gate', text: '⚐' } : { cls: 'pass', text: '✓' };
  if (status === 'accomplished') return { cls: 'pass', text: '✓' };
  if (status === 'skip') return { cls: 'skip', text: '—' };
  return { cls: 'fail', text: '✗' };
}

// ---- Terminal (L8423-8526, L8797-8829) ----

const TERM_PHASE: Record<string, TerminalPhase> = {
  get_command: 'get',
  set_command: 'set',
  post_set_get: 'postset',
  evidence_command: 'evidence',
  verification: 'verify',
};
const TERM_LABEL: Record<string, string> = {
  get_command: 'GET',
  set_command: 'SET',
  post_set_get: 'VERIFY',
  evidence_command: 'EVIDENCE',
  verification: 'VERIFY',
};

/** The Graph / OData error message legacy pulls out of a failed command's JSON stdout. */
export function jsonErrorMessage(stdout: string): string | null {
  const trimmed = stdout.trim();
  if (trimmed.charAt(0) !== '{' && trimmed.charAt(0) !== '[') return null;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, any>;
    if (parsed.error && parsed.error.message) return (parsed.error.code ? parsed.error.code + ': ' : '') + parsed.error.message;
    if (parsed['odata.error'] && parsed['odata.error'].message) {
      const od = parsed['odata.error'].message;
      return typeof od === 'string' ? od : od.value || JSON.stringify(od);
    }
  } catch {
    // not valid JSON: raw stdout only
  }
  return null;
}

function appendToLastLine(blocks: TerminalBlock[], chunk: string): TerminalBlock[] | null {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.kind === 'line') {
      const next = blocks.slice();
      next[i] = { ...b, stdout: (b.stdout ?? '') + chunk };
      return next;
    }
  }
  return null;
}

function terminalOnStream(state: ConsoleState, d: ExecEvent): ConsoleState {
  const key = subKey(d.taskId ?? '', d.subId ?? '');
  const buffer = state.termBuffers[key];
  if (d.phase === 'stdout_chunk') {
    if (buffer && buffer.length > 0) {
      const next = appendToLastLine(buffer, d.stdout ?? '');
      return next ? { ...state, termBuffers: { ...state.termBuffers, [key]: next } } : state;
    }
    const next = appendToLastLine(state.terminal, d.stdout ?? '');
    return next ? { ...state, terminal: next } : state;
  }
  const phase = d.phase ? TERM_PHASE[d.phase] : undefined;
  if (!phase || !d.phase) return state;
  const out = d.stdout || '';
  const errors: string[] = [];
  if (d.exitCode !== 0 && out.trim()) {
    const msg = jsonErrorMessage(out);
    if (msg) errors.push(msg);
  }
  if (d.stderr && d.stderr.trim()) errors.push(d.stderr);
  const line: TerminalBlock = {
    kind: 'line',
    phase,
    label: TERM_LABEL[d.phase],
    ...(d.command ? { command: d.command } : {}),
    stdout: out,
    ...(errors.length ? { errors } : {}),
  };
  if (buffer) return { ...state, termBuffers: { ...state.termBuffers, [key]: [...buffer, line] } };
  return { ...state, terminal: [...state.terminal, line] };
}

function terminalStartBuffer(state: ConsoleState, d: ExecEvent): ConsoleState {
  const key = subKey(d.taskId ?? '', d.subId ?? '');
  const header: TerminalBlock = {
    kind: 'action',
    index: Number(d.index),
    total: Number(d.total),
    subId: d.subId ?? '',
    label: d.label || '',
  };
  return { ...state, termBuffers: { ...state.termBuffers, [key]: [header] } };
}

/** Flush the buffered tenant I/O on failure, discard it on success. */
function terminalOnResult(state: ConsoleState, d: ExecEvent, now: Date): ConsoleState {
  const key = subKey(d.taskId ?? '', d.subId ?? '');
  const buffer = state.termBuffers[key];
  if (!buffer) return state;
  const isFail = d.status !== 'pass' && d.status !== 'accomplished' && d.status !== 'skip';
  const { [key]: _flushed, ...rest } = state.termBuffers;
  let terminal = state.terminal;
  if (isFail && buffer.length > 0) {
    const blocks: TerminalBlock[] = [{ kind: 'separator', time: clockTime(now), id: d.subId || '', label: d.label || '' }, ...buffer];
    if (blocks.length <= 2 && d.message) blocks.push({ kind: 'error', text: 'Task failed: ' + d.message });
    blocks.push({ kind: 'verdict', pass: false });
    terminal = [...terminal, ...blocks];
  }
  return { ...state, terminal, termBuffers: rest };
}

// ---- Console rows ----

function counterText(state: ConsoleState, steps: number, actions: number): string {
  const scopeSteps = state.scope ? state.scope.stepsTotal : '?';
  const scopeActions = state.scope ? state.scope.actionsTotal : '?';
  return `${steps}/${scopeSteps} steps · ${actions}/${scopeActions} actions`;
}

function withStep(state: ConsoleState, taskId: string, fn: (s: StepView) => StepView): ConsoleState {
  const step = state.steps[taskId];
  if (!step) return state;
  return { ...state, steps: { ...state.steps, [taskId]: fn(step) } };
}

function withSub(state: ConsoleState, key: string, fn: (s: SubView) => SubView): ConsoleState {
  const sub = state.subs[key];
  if (!sub) return state;
  return { ...state, subs: { ...state.subs, [key]: fn(sub) } };
}

function capturePairs(captures: Record<string, unknown>): Array<[string, string]> {
  return Object.keys(captures).map((k) => [k, String(captures[k])]);
}

function addSub(state: ConsoleState, d: ExecEvent, ctx: ReduceContext, withCommandLine: boolean): ConsoleState {
  const taskId = d.taskId ?? '';
  const subId = d.subId ?? '';
  const step = state.steps[taskId];
  if (!step) return state;
  const key = subKey(taskId, subId);
  if (state.subs[key]) return state;
  const sub: SubView = {
    key,
    taskId,
    subId,
    label: withCommandLine ? d.label ?? '' : d.label || subId,
    tagIndex: withCommandLine ? `${d.index}/${d.total}` : null,
    ...(withCommandLine ? { engine: d.engine, command: d.command ?? '' } : {}),
    status: null,
    verdict: null,
    awaiting: false,
    approval: null,
    lines: [],
    liveOut: null,
    hadLiveChunks: false,
    vlp: ctx.logPanel ? { controls: step.controls, items: [], verdicts: [] } : null,
  };
  return {
    ...state,
    subs: { ...state.subs, [key]: sub },
    steps: { ...state.steps, [taskId]: { ...step, subKeys: [...step.subKeys, key] } },
  };
}

function bumpActionCounter(state: ConsoleState): ConsoleState {
  const actions = state.counter.actions + 1;
  return { ...state, counter: { ...state.counter, actions, text: counterText(state, state.counter.steps, actions) } };
}

const VLP_PHASES: Record<string, [string, string]> = {
  get_command: ['precheck', 'PRE-CHECK'],
  set_command: ['set', 'COMMAND SENT'],
  post_set_get: ['postset', 'TENANT RESPONSE'],
  verification: ['verify', 'STAMPER DETERMINATION'],
  evidence_command: ['evidence', 'EVIDENCE'],
  evidence_save: ['save', 'SAVE'],
};

const STREAM_BADGES: Record<string, [string, string]> = {
  get_command: ['precheck', 'PRE-CHECK'],
  set_command: ['set', 'SET'],
  evidence_command: ['evidence', 'EVIDENCE'],
  evidence_save: ['save', 'SAVE'],
};

function vlpOnStream(vlp: VerbosePanel, d: ExecEvent): VerbosePanel {
  if (d.phase === 'stdout_chunk') {
    const items = vlp.items.slice();
    const last = items[items.length - 1];
    if (last && last.kind === 'chunk' && last.live) items[items.length - 1] = { ...last, text: last.text + (d.stdout ?? '') };
    else items.push({ kind: 'chunk', text: d.stdout ?? '', live: true });
    return { ...vlp, items };
  }
  const meta = d.phase ? VLP_PHASES[d.phase] : undefined;
  if (!meta) return vlp;
  const items: VlpItem[] = vlp.items.map((it) => (it.kind === 'chunk' && it.live ? { ...it, live: false } : it));
  items.push({
    kind: 'phase',
    cls: meta[0],
    label: meta[1],
    ...(d.command ? { command: d.command } : {}),
    ...((d.stdout || '').trim() ? { stdout: d.stdout } : {}),
    ...(d.stderr && d.stderr.trim() ? { stderr: d.stderr } : {}),
  });
  return { ...vlp, items };
}

function subOnStream(sub: SubView, d: ExecEvent, verbose: boolean): SubView {
  const next: SubView = sub.vlp ? { ...sub, vlp: vlpOnStream(sub.vlp, d) } : sub;
  if (d.phase === 'stdout_chunk') {
    if (!verbose) return next;
    return { ...next, liveOut: (next.liveOut ?? '') + (d.stdout ?? ''), hadLiveChunks: true };
  }
  if (d.phase === 'capture_resolved' && d.captures) {
    if (!verbose) return next;
    return { ...next, lines: [...next.lines, { kind: 'captures', pairs: capturePairs(d.captures), verboseOnly: true }] };
  }
  if (d.phase === 'pre_accomplished') {
    if (!verbose) return next;
    const lines: SubLine[] = [
      ...next.lines,
      { kind: 'note', badgeCls: 'pass', badge: '✓ PRE-ACCOMPLISHED', text: 'Verified by evidence assessment', verboseOnly: true },
    ];
    if (d.captures && Object.keys(d.captures).length > 0) lines.push({ kind: 'captures', pairs: capturePairs(d.captures), verboseOnly: false });
    return { ...next, lines };
  }
  if (d.phase === 'idempotent_skip') {
    if (!verbose) return next;
    const lines: SubLine[] = [
      ...next.lines,
      {
        kind: 'note',
        badgeCls: 'skip',
        badge: 'SKIP',
        text: 'Resource already exists',
        ...(d.stdout && d.stdout.trim() ? { output: d.stdout.substring(0, 500) } : {}),
        verboseOnly: true,
      },
    ];
    if (d.captures && Object.keys(d.captures).length > 0) lines.push({ kind: 'captures', pairs: capturePairs(d.captures), verboseOnly: false });
    return { ...next, lines };
  }
  if (d.phase === 'verification' && d.verification) {
    if (!verbose) return next;
    const v = d.verification;
    const confCls =
      v.confidence === 'HIGH' ? 'conf-high' : v.confidence === 'MEDIUM' ? 'conf-medium' : v.confidence === 'LOW' ? 'conf-low' : 'conf-failed';
    const det = v.details ?? {};
    const checks: string[] = [];
    if (det.exit_code_check) checks.push('exit:PASS');
    if (det.set_output_check === true) checks.push('output:PASS');
    else if (det.set_output_check === false) checks.push('output:FAIL');
    if (det.evidence_check === true) checks.push('evidence:PASS');
    else if (det.evidence_check === false) checks.push('evidence:FAIL');
    return {
      ...next,
      lines: [
        ...next.lines,
        {
          kind: 'verify',
          confCls,
          confidence: String(v.confidence ?? ''),
          score: `(${v.score}%)`,
          checks: `[${checks.join(' ')}]`,
          reason: String(v.reason ?? ''),
        },
      ],
    };
  }
  if (!verbose) return next;
  const [badgeCls, badge] = (d.phase && STREAM_BADGES[d.phase]) || ['set', d.phase ?? ''];
  return {
    ...next,
    lines: [
      ...next.lines,
      {
        kind: 'stream',
        badgeCls,
        badge,
        command: d.command ?? '',
        durationMs: d.durationMs,
        stdout: d.phase === 'set_command' && next.hadLiveChunks ? '' : d.stdout || '',
        stderr: d.stderr || '',
        ...(d.phase === 'evidence_save' && d.evidenceFile && d.exitCode === 0 ? { savePath: d.evidenceFile } : {}),
        verboseOnly: d.phase === 'get_command',
      },
    ],
  };
}

const DIRECTIVE_DETAIL: Record<string, string> = {
  excluded: 'Excluded per scope',
  nonstack: 'Non-stack — out-of-band evidence required',
};

/**
 * Applies one execute-stream event to the console view model (legacy handleEvent, minus the
 * side effects the execute store owns: rail, card badge, stream close, saves and scans).
 */
export function reduceExecEvent(state: ConsoleState, d: ExecEvent, ctx: ReduceContext): ConsoleState {
  const taskId = d.taskId ?? '';
  const subId = d.subId ?? '';
  const key = subKey(taskId, subId);

  // Task metadata first, as accumulateRunLog runs before the row handling (L8194).
  if (d.type === 'task_start') {
    state = {
      ...state,
      taskMeta: {
        ...state.taskMeta,
        [taskId]: {
          label: d.label || taskId,
          layer: d.layer != null ? d.layer : '',
          engine: d.engine || '',
          controls: d.controls || [],
          directive: d.directive || 'automated',
        },
      },
    };
  }

  switch (d.type) {
    case 'execution_start':
      return { ...state, ledger: [] };

    case 'execution_scope':
      return {
        ...state,
        scope: {
          controlsInScope: d.controlsInScope || 0,
          controlsOutOfScope: d.controlsOutOfScope || 0,
          stepsTotal: d.stepsTotal || 0,
          actionsTotal: d.actionsTotal || 0,
          totalControls: d.totalControls || 0,
        },
      };

    case 'log':
      return logItem(state, d.message ?? '', 'info', ctx.now);

    case 'task_start': {
      if (state.steps[taskId]) return state;
      const subCount = d.subCommandCount || 0;
      const step: StepView = {
        taskId,
        label: d.label ?? '',
        engine: d.engine,
        directive: d.directive,
        idempotency: d.idempotency,
        countLabel: subCount > 0 ? `(${subCount} cmds)` : '',
        status: { cls: 'running', text: 'RUNNING' },
        expanded: true,
        controls: d.controls || [],
        subKeys: [],
        approval: null,
        impact: null,
        stateDiffs: [],
      };
      const steps = { ...state.steps, [taskId]: step };
      const prev = state.activeStepId;
      if (!ctx.verbose && prev && prev !== taskId && steps[prev]) steps[prev] = { ...steps[prev], expanded: false };
      const seq = state.seq + 1;
      return {
        ...state,
        seq,
        steps,
        items: [...state.items, { kind: 'step', key: `step-${seq}`, taskId }],
        activeStepId: taskId,
        status: { text: 'Executing...', tone: 'info' },
      };
    }

    case 'sub_command':
      return addSub(bumpActionCounter(terminalStartBuffer(state, d)), d, ctx, true);

    case 'sub_command_start':
      return addSub(bumpActionCounter(terminalStartBuffer(state, d)), d, ctx, false);

    case 'sub_command_complete':
      return withSub(state, key, (sub) => {
        const st = d.status || 'accomplished';
        const status: Badge = { cls: st === 'accomplished' ? 'pass' : st === 'skip' ? 'skip' : 'fail', text: st.toUpperCase() };
        if (!sub.vlp) return { ...sub, status };
        const verdict: VlpVerdict = {
          badgeCls: d.status === 'accomplished' ? 'verdict-pass' : 'verdict-unknown',
          label: (d.status || 'accomplished').toUpperCase(),
          ...(d.directive ? { detail: DIRECTIVE_DETAIL[d.directive] ?? d.directive } : {}),
        };
        return { ...sub, status, vlp: { ...sub.vlp, verdicts: [...sub.vlp.verdicts, verdict] } };
      });

    case 'sub_command_stream': {
      const entry = ledgerEntryFromEvent(d, ctx.now);
      let next = entry ? { ...state, ledger: [...state.ledger, entry] } : state;
      next = terminalOnStream(next, d);
      return withSub(next, key, (sub) => subOnStream(sub, d, ctx.verbose));
    }

    case 'sub_command_result': {
      let next = terminalOnResult(state, d, ctx.now);
      const engine = next.steps[taskId]?.engine;
      next = withSub(next, key, (sub) => {
        const updated: SubView = {
          ...sub,
          status: subResultBadge(d.status, engine),
          verdict: d.outcome ? outcomeBadge(d.outcome) : sub.verdict,
          awaiting: false,
        };
        if (!sub.vlp) return updated;
        const verdict: VlpVerdict = d.outcome
          ? { badgeCls: vlpOutcomeClass(d.outcome), label: OUTCOME_LABELS[d.outcome] || d.outcome }
          : { label: d.status === 'pass' ? 'PASS' : d.status === 'skip' ? 'SKIP' : 'FAIL' };
        const detail = d.outcomeRationale || d.message || '';
        if (detail) verdict.detail = detail;
        return { ...updated, vlp: { ...sub.vlp, verdicts: [...sub.vlp.verdicts, verdict] } };
      });
      const layer = next.taskMeta[taskId]?.layer ?? 0;
      return { ...next, grid: bump(next.grid, 'actions', layer, d.status || 'fail') };
    }

    case 'sub_command_approve_request': {
      if (!state.subs[key]) return state;
      let next = withSub(state, key, (sub) => ({
        ...sub,
        awaiting: true,
        approval: { ...(d.preCheck ? { preCheck: d.preCheck } : {}), ...(d.idempotency ? { idempotency: d.idempotency } : {}) },
      }));
      next = withStep(next, taskId, (s) => ({ ...s, status: { cls: 'waiting', text: 'WAITING' }, expanded: true }));
      return next;
    }

    case 'task_approve_request': {
      if (state.steps[taskId]) {
        return withStep(state, taskId, (s) => ({
          ...s,
          status: { cls: 'waiting', text: 'WAITING' },
          approval: d.idempotency ? { idempotency: d.idempotency } : {},
        }));
      }
      const seq = state.seq + 1;
      return {
        ...state,
        seq,
        items: [...state.items, { kind: 'task-approval', key: `appr-${seq}`, taskId, ...(d.idempotency ? { idempotency: d.idempotency } : {}) }],
      };
    }

    case 'layer_approve_request': {
      const seq = state.seq + 1;
      return {
        ...state,
        seq,
        items: [...state.items, { kind: 'layer', key: `layer-${seq}`, layer: Number(d.layer), taskCount: Number(d.taskCount) }],
      };
    }

    case 'task_result': {
      let next = withStep(state, taskId, (s) => ({ ...s, status: taskResultBadge(d.status, s.engine) }));
      const meta = next.taskMeta[taskId];
      const layer = meta && meta.layer !== undefined ? meta.layer : d.layer !== undefined ? d.layer : 0;
      next = { ...next, grid: bump(next.grid, 'steps', layer, d.status) };
      const steps = next.counter.steps + 1;
      next = { ...next, counter: { ...next.counter, steps, text: counterText(next, steps, next.counter.actions) } };
      if (d.status === 'fail' && d.downstreamImpact && d.downstreamImpact.length > 0) {
        const parts = d.downstreamImpact.map((dep) => `${dep.taskId} (${dep.variables.join(', ')})`);
        const n = d.downstreamImpact.length;
        const impact = `⚠ Affects ${n} downstream task${n > 1 ? 's' : ''}: ${parts.join(', ')}`;
        next = withStep(next, taskId, (s) => ({ ...s, impact, expanded: true }));
      } else if (!ctx.verbose) {
        next = withStep(next, taskId, (s) => ({ ...s, expanded: false }));
      }
      if (next.activeStepId === taskId) next = { ...next, activeStepId: null };
      return next;
    }

    case 'summary':
      return {
        ...state,
        summary: {
          total: Number(d.total ?? 0),
          pass: Number(d.pass ?? 0),
          accomplished: Number(d.accomplished || 0),
          fail: Number(d.fail ?? 0),
          skip: Number(d.skip ?? 0),
          ...(d.dryRunLog ? { dryRunLog: d.dryRunLog } : {}),
          ...(d.reportJson ? { reportJson: d.reportJson } : {}),
          ...(d.reportMd ? { reportMd: d.reportMd } : {}),
        },
      };

    case 'execution_results_manifest':
      return {
        ...state,
        controlResults: (d.data?.results ?? []).map((r) => ({
          controlId: String(r.controlId ?? ''),
          directive: String(r.directive ?? ''),
          verdict: String(r.verdict ?? ''),
          outcome: String(r.outcome ?? ''),
          ...(r.evidencePath ? { evidencePath: r.evidencePath } : {}),
        })),
      };

    case 'accomplished_query':
      return withSub(state, key, (sub) => {
        const lines: SubLine[] = [...sub.lines, { kind: 'note', badgeCls: 'query', badge: 'QUERY', text: d.command || '', verboseOnly: false }];
        if (d.captures && Object.keys(d.captures).length > 0) lines.push({ kind: 'captures', pairs: capturePairs(d.captures), verboseOnly: false });
        return { ...sub, lines };
      });

    case 'state_diff':
      return withStep(state, taskId, (s) => ({ ...s, stateDiffs: [...s.stateDiffs, { before: d.before || '', after: d.after || '' }] }));

    default:
      return state;
  }
}

// ---- Run log (L5285-5414) ----

export interface RunLogStreamRecord {
  phase: string;
  command: string;
  stdout: string;
  stderr: string;
  exitCode?: number;
  durationMs?: number;
  evidenceFile: string | null;
  captures: Record<string, unknown> | null;
}

export interface RunLogRecord {
  taskId: string;
  stepLabel: string;
  layer: number | '';
  subId: string;
  subLabel: string;
  engine: string;
  command: string;
  index?: number;
  total?: number;
  status: string | null;
  message: string;
  streams: RunLogStreamRecord[];
  controls: string[];
  outcome?: string;
  outcomeRationale?: string;
}

export interface RunLog {
  startedAt: string;
  finishedAt: string | null;
  planPath: string;
  tenant: string;
  mode: string;
  dryRun: boolean;
  summary: { total?: number; pass?: number; fail?: number; skip?: number; accomplished: number } | null;
  entries: RunLogRecord[];
  consoleLog: Array<{ ts: string; type: string; raw: ExecEvent }>;
}

/** The legacy `_runLog` and its index; mutable, as in legacy (it is saved, not rendered). */
export class RunLogBuilder {
  readonly log: RunLog;
  private readonly index = new Map<string, number>();
  private readonly meta = new Map<string, { stepLabel: string; layer: number | ''; engine: string; controls: string[] }>();

  constructor(init: { startedAt: string; planPath: string; tenant: string; mode: string; dryRun: boolean }) {
    this.log = { ...init, finishedAt: null, summary: null, entries: [], consoleLog: [] };
  }

  accumulate(d: ExecEvent, now: Date): void {
    const log = this.log;
    log.consoleLog.push({ ts: now.toISOString(), type: d.type, raw: d });
    const taskId = d.taskId ?? '';
    if (d.type === 'task_start') {
      this.meta.set(taskId, { stepLabel: d.label || taskId, layer: d.layer != null ? d.layer : '', engine: d.engine || '', controls: d.controls || [] });
    } else if (d.type === 'sub_command' || d.type === 'sub_command_start') {
      const m = this.meta.get(taskId);
      log.entries.push({
        taskId,
        stepLabel: (m && m.stepLabel) || taskId,
        layer: m && m.layer != null ? m.layer : '',
        subId: d.subId ?? '',
        subLabel: d.label || d.subId || '',
        engine: d.engine || (m && m.engine) || '',
        command: d.command || '',
        index: d.index,
        total: d.total,
        status: null,
        message: '',
        streams: [],
        controls: (m && m.controls) || [],
      });
      this.index.set(subKey(taskId, d.subId ?? ''), log.entries.length - 1);
    } else if (d.type === 'sub_command_stream' || d.type === 'accomplished_query') {
      const i = this.index.get(subKey(taskId, d.subId ?? ''));
      const entry = i != null ? log.entries[i] : undefined;
      if (!entry) return;
      if (d.type === 'sub_command_stream') {
        entry.streams.push({
          phase: d.phase ?? '',
          command: d.command || '',
          stdout: d.stdout || '',
          stderr: d.stderr || '',
          exitCode: d.exitCode,
          durationMs: d.durationMs,
          evidenceFile: d.evidenceFile || null,
          captures: d.captures || null,
        });
      } else {
        entry.streams.push({
          phase: 'accomplished_query',
          command: d.command || '',
          stdout: '',
          stderr: '',
          exitCode: 0,
          durationMs: 0,
          evidenceFile: null,
          captures: d.captures || null,
        });
      }
    } else if (d.type === 'sub_command_result' || d.type === 'sub_command_complete') {
      const i = this.index.get(subKey(taskId, d.subId ?? ''));
      const entry = i != null ? log.entries[i] : undefined;
      if (!entry) return;
      entry.status = d.status ?? null;
      entry.message = d.message || '';
      if (d.outcome) entry.outcome = d.outcome;
      if (d.outcomeRationale) entry.outcomeRationale = d.outcomeRationale;
    } else if (d.type === 'task_result') {
      let hasSubs = false;
      for (const entry of log.entries) {
        if (entry.taskId !== taskId) continue;
        hasSubs = true;
        if (entry.status === null || entry.status === undefined) {
          entry.status = d.status ?? null;
          if (d.message && !entry.message) entry.message = d.message;
        }
      }
      if (!hasSubs) {
        const m = this.meta.get(taskId);
        log.entries.push({
          taskId,
          stepLabel: (m && m.stepLabel) || taskId,
          layer: m && m.layer != null ? m.layer : '',
          subId: '(task)',
          subLabel: (m && m.stepLabel) || taskId,
          engine: (m && m.engine) || '',
          command: '',
          index: 1,
          total: 1,
          status: d.status ?? null,
          message: d.message || '',
          streams: [],
          controls: (m && m.controls) || [],
        });
      }
    } else if (d.type === 'summary') {
      log.summary = { total: d.total, pass: d.pass, fail: d.fail, skip: d.skip, accomplished: d.accomplished || 0 };
      log.finishedAt = now.toISOString();
    }
  }
}
