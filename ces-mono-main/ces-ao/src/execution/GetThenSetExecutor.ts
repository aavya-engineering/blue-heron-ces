// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Module: Get-Then-Set Executor
// Idempotency-safe execution for state-changing (write) commands.
//
// Guarantees:
//  1. The current state is ALWAYS read (get_command) before any write.
//  2. In dryRun mode the set_command is NEVER run — the caller gets a preview
//     of the planned change plus the REAL captured pre-state.
//  3. On live execution (dryRun=false) we run get → set → get, capturing both
//     the real pre-state and the real resulting post-state for evidence, and
//     `stateChanged` is a real comparison of the two snapshots.
//
// W4-AO1 (2026-09-27): the get-halves are real reads. Before this change both
// reads were issued with the adapter's dryRun flag set, so the adapter returned
// its dry-run placeholder ("[dry-run] PowerShell commands validated") and every
// persisted pre/post state was that placeholder. The reads now go through a
// `reader` adapter executed with dryRun=false:
//  - live runs: the reader is the live adapter itself;
//  - dry runs: the caller supplies a reader built from a non-dry execution
//    context (so the session actually connects), and ONLY the read runs — the
//    set_command is never sent.
// Because a dry run now performs network I/O, every state read passes a
// read-only guard first (`assertReadOnlyStateCommand`): a get_command that
// contains a mutating cmdlet/verb or a non-GET REST method is refused and no
// read is issued.
//
// State snapshots are captured as compact JSON (`ConvertTo-Json -Depth 8
// -Compress`) between explicit markers, so the comparison is not defeated by
// Format-Table truncation ("@{allowedToCreate...=Fals...") and is independent
// of session banner noise and the adapter's success marker.

import type { CommandEntry } from 'ces-shared/types/registry';
import type { ExecutionResult } from '../types/StamperTypes.js';

export interface GetThenSetResult {
  /** The execution result used to build evidence (the set result on live, the get/preview on dryRun). */
  result: ExecutionResult;
  /** Real pre-write state snapshot (JSON), or undefined when the read could not be performed. */
  preStateOutput?: string;
  /** Real post-write state snapshot (live only; undefined in dryRun or when the read failed). */
  postStateOutput?: string;
  /** Why a state read produced no snapshot (read refused, reader unavailable, read failed). */
  stateReadError?: string;
  /** Whether the set_command was actually executed successfully. */
  applied: boolean;
  /**
   * Real comparison of the two snapshots: true when pre !== post. Undefined
   * when either snapshot is missing (dry run, or a failed read) — never guessed.
   */
  stateChanged?: boolean;
  /** The set_command that was (or would be) run. */
  plannedCommand: string;
}

export interface AdapterLike {
  execute: (task: any, variables: Record<string, string>, dryRun: boolean) => Promise<ExecutionResult>;
}

export const STATE_BEGIN_MARKER = '<<AO-STATE-BEGIN>>';
export const STATE_END_MARKER = '<<AO-STATE-END>>';

function buildTask(entry: CommandEntry, command: string): any {
  return {
    id: entry.entry_id,
    action: { command, engine: entry.engine, args: {} },
    controls: entry.control_ids,
    idempotency: entry.idempotency,
  };
}

/** Error thrown when a state read is refused by the read-only guard. */
export class StateReadRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StateReadRefusedError';
  }
}

// Verbs that change tenant state when they appear in COMMAND position.
const MUTATING_VERBS = [
  'Set', 'New', 'Remove', 'Update', 'Add', 'Enable', 'Disable', 'Grant', 'Revoke', 'Clear',
  'Start', 'Stop', 'Restart', 'Register', 'Unregister', 'Reset', 'Install', 'Uninstall',
  'Move', 'Rename', 'Send', 'Publish', 'Suspend', 'Resume', 'Block', 'Unblock', 'Confirm',
  'Approve', 'Deny', 'Close', 'Restore', 'Lock', 'Unlock', 'Submit', 'Complete',
];
const MUTATING_CMDLET = new RegExp(
  `(^|[;|{(=&]\\s*)(${MUTATING_VERBS.join('|')})-[A-Za-z]`,
  'i',
);
// Invoke-Mg<Action> cmdlets are Graph actions (dismiss, revoke, ...). Invoke-MgGraphRequest is the REST client.
const INVOKE_MG_ACTION = /(^|[;|{(=&]\s*)Invoke-Mg(?!GraphRequest\b)[A-Za-z]/i;
const REST_CLIENT = /\b(Invoke-MgGraphRequest|Invoke-AzRestMethod|Invoke-RestMethod|Invoke-WebRequest)\b/i;
const REST_METHOD = /-Method\s+['"]?(\w+)/gi;

function stripQuotedLiterals(command: string): string {
  // Single-quoted literals never expand; double-quoted ones without a subexpression don't either.
  return command.replace(/'[^']*'/g, "''").replace(/"[^"$]*"/g, '""');
}

/**
 * Read-only guard for state reads (W4-AO1). Returns the reason a command is
 * NOT safe to issue as a read, or undefined when it is.
 */
export function readOnlyViolation(command: string): string | undefined {
  if (!command || !command.trim()) return 'empty get_command';
  const code = stripQuotedLiterals(command);
  const verb = code.match(MUTATING_CMDLET);
  if (verb) return `get_command contains a mutating cmdlet (${verb[2]}-...)`;
  if (INVOKE_MG_ACTION.test(code)) return 'get_command contains a Graph action cmdlet (Invoke-Mg<Action>)';
  if (REST_CLIENT.test(code)) {
    for (const m of command.matchAll(REST_METHOD)) {
      if (m[1].toUpperCase() !== 'GET') return `get_command issues a non-GET REST call (-Method ${m[1]})`;
    }
  }
  return undefined;
}

export function assertReadOnlyStateCommand(command: string): void {
  const violation = readOnlyViolation(command);
  if (violation) throw new StateReadRefusedError(`state read refused: ${violation}`);
}

/** Wrap a get_command so its output is a marker-delimited compact-JSON snapshot. */
export function buildStateCaptureCommand(getCommand: string): string {
  return (
    `Write-Output '${STATE_BEGIN_MARKER}'; ` +
    `& { ${getCommand} } | ConvertTo-Json -Depth 8 -Compress; ` +
    `Write-Output '${STATE_END_MARKER}'`
  );
}

/** Extract the snapshot between the markers; undefined when the markers are absent. */
export function extractStateSnapshot(stdout: string): string | undefined {
  const b = stdout.indexOf(STATE_BEGIN_MARKER);
  const e = stdout.indexOf(STATE_END_MARKER, b + 1);
  if (b < 0 || e < 0) return undefined;
  return stdout
    .slice(b + STATE_BEGIN_MARKER.length, e)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

async function readState(
  reader: AdapterLike | undefined,
  entry: CommandEntry,
  variables: Record<string, string>,
): Promise<{ snapshot?: string; error?: string; raw?: ExecutionResult }> {
  if (!reader) return { error: 'no state reader available (execution context for reads could not be built)' };
  const getCommand = entry.get_command || '';
  assertReadOnlyStateCommand(getCommand);
  const raw = await reader.execute(buildTask(entry, buildStateCaptureCommand(getCommand)), variables, false);
  const snapshot = extractStateSnapshot(raw.stdout || '');
  if (snapshot === undefined) {
    const why = raw.error || raw.stderr || 'state markers missing from read output';
    return { error: `state read failed: ${String(why).trim().slice(0, 500)}`, raw };
  }
  return { snapshot, raw };
}

/**
 * Execute a write command using the get-then-set safety pattern.
 *
 * @param adapter   the adapter for the set (built with the request's dryRun)
 * @param entry     the translated CommandEntry (must have get_command + set_command)
 * @param variables resolved variable dictionary
 * @param dryRun    when true, the set_command is NOT executed
 * @param reader    adapter used for the real (dryRun=false) state reads; defaults
 *                  to `adapter` on live runs. On dry runs pass a reader built from
 *                  a non-dry context, or undefined to record the pre-state as unavailable.
 */
export async function executeGetThenSet(
  adapter: AdapterLike,
  entry: CommandEntry,
  variables: Record<string, string>,
  dryRun: boolean,
  reader: AdapterLike | undefined = dryRun ? undefined : adapter,
): Promise<GetThenSetResult> {
  const plannedCommand = entry.set_command || '';

  // Phase 1 — always read the real current state first (read-only guard applies).
  const pre = await readState(reader, entry, variables);
  const preStateOutput = pre.snapshot;

  if (dryRun) {
    // Preview only — the set_command is never sent.
    return {
      result: {
        success: true,
        stdout: preStateOutput ?? '',
        stderr: pre.raw?.stderr || '',
        exit_code: 0,
      },
      preStateOutput,
      stateReadError: pre.error,
      applied: false,
      plannedCommand,
    };
  }

  // Never blind-write: without a real pre-state snapshot the set is not sent.
  if (preStateOutput === undefined) {
    return {
      result: {
        success: false,
        error: `get-then-set aborted before the write: ${pre.error}`,
        stdout: pre.raw?.stdout || '',
        stderr: pre.raw?.stderr || '',
        exit_code: pre.raw?.exit_code || 1,
      },
      stateReadError: pre.error,
      applied: false,
      plannedCommand,
    };
  }

  // Phase 2 — live write.
  const setResult = await adapter.execute(buildTask(entry, plannedCommand), variables, false);

  // Phase 3 — read the resulting state for evidence.
  let post: { snapshot?: string; error?: string };
  try {
    post = await readState(reader, entry, variables);
  } catch (err) {
    post = { error: err instanceof Error ? err.message : String(err) };
  }
  const postStateOutput = post.snapshot;

  return {
    result: setResult,
    preStateOutput,
    postStateOutput,
    stateReadError: pre.error ?? post.error,
    applied: !!setResult.success,
    stateChanged:
      preStateOutput !== undefined && postStateOutput !== undefined
        ? preStateOutput !== postStateOutput
        : undefined,
    plannedCommand,
  };
}
