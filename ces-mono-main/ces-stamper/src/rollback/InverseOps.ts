// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * W4-ST3 — inverse operations for run-level rollback.
 *
 * When a sub-command's SET runs, the adapter already captures the resource state
 * before (pre-SET GET) and after (post-SET GET). From that pair we derive the
 * operation that returns the resource to its pre-run state and record it with the
 * task's execution state, so a failed run can later be reversed task by task.
 *
 * Ops covered (inverse derived automatically):
 *   - graph-patch: `Invoke-MgGraphRequest -Method PATCH -Uri <uri> ...` whose GET
 *     returns JSON. Inverse = PATCH <uri> with the pre-run values of every top-level
 *     property the SET changed (pre/post diff).
 * Everything else is recorded as `uncovered` with a reason and surfaces in the
 * rollback report as manual guidance — never silently skipped.
 */

export type AppliedOpKind = 'graph-patch' | 'noop' | 'uncovered';

export interface AppliedOp {
  /** Monotonic sequence within the plan's execution state (assigned by StateManager). */
  seq?: number;
  task_id?: string;
  sub_command_id: string;
  engine: string;
  /** The resolved SET command that was applied. */
  applied_command: string;
  kind: AppliedOpKind;
  /** Command that restores the pre-run state (graph-patch only). */
  inverse_command?: string;
  /** Pre-run values of the properties the SET changed (graph-patch only). */
  restore_values?: Record<string, unknown>;
  /** Why no inverse could be derived (uncovered) or none is needed (noop). */
  reason?: string;
  applied_at?: string;
  reversed_at?: string;
  reverse_error?: string;
}

const SENTINEL_RE = /\r?\n?STAMPER_EXECUTION_SUCCESS\s*$/;
const IGNORED_KEYS = new Set(['id', '@odata.context', '@odata.type', '@odata.etag', 'lastModifiedDateTime', 'modifiedDateTime']);

/** Parse a GET's stdout as a JSON object (tolerates warnings before the JSON and the session sentinel). */
export function parseStateJson(stdout: string | undefined): Record<string, unknown> | undefined {
  if (!stdout) return undefined;
  const cleaned = stdout.replace(SENTINEL_RE, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

/** Extract the -Uri argument of an Invoke-MgGraphRequest PATCH, or undefined when the command is not one. */
export function graphPatchUri(command: string): string | undefined {
  if (!/Invoke-MgGraphRequest\b/i.test(command)) return undefined;
  if (!/-Method\s+['"]?PATCH\b/i.test(command)) return undefined;
  const m = command.match(/-Uri\s+(?:'([^']+)'|"([^"]+)"|(\S+))/i);
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
}

/** PowerShell single-quoted literal. */
function psQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

export function buildGraphPatchCommand(uri: string, body: Record<string, unknown>): string {
  return `Invoke-MgGraphRequest -Method PATCH -Uri ${psQuote(uri)} -Body ${psQuote(JSON.stringify(body))} -ContentType 'application/json'`;
}

/**
 * Derive the inverse of an applied SET from its pre/post GET output.
 */
export function deriveInverseOp(input: {
  sub_command_id: string;
  engine: string;
  applied_command: string;
  pre_state?: string;
  post_state?: string;
}): AppliedOp {
  const base = { sub_command_id: input.sub_command_id, engine: input.engine, applied_command: input.applied_command };
  const uri = graphPatchUri(input.applied_command);
  if (!uri) {
    return { ...base, kind: 'uncovered', reason: 'no automatic inverse for this operation type (covered: Graph PATCH)' };
  }
  const pre = parseStateJson(input.pre_state);
  const post = parseStateJson(input.post_state);
  if (!pre || !post) {
    return { ...base, kind: 'uncovered', reason: 'pre/post state was not captured as JSON — cannot compute the restore body' };
  }
  const restore: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(pre), ...Object.keys(post)])) {
    if (IGNORED_KEYS.has(key) || key.startsWith('@odata')) continue;
    if (JSON.stringify(pre[key]) !== JSON.stringify(post[key])) {
      restore[key] = key in pre ? pre[key] : null;
    }
  }
  if (Object.keys(restore).length === 0) {
    return { ...base, kind: 'noop', reason: 'SET did not change the resource state' };
  }
  return { ...base, kind: 'graph-patch', inverse_command: buildGraphPatchCommand(uri, restore), restore_values: restore };
}

/**
 * Sim-only guard: automatic reverse execution is allowed only when PowerShell is
 * shadowed onto a loopback tenant-stacksim server (STACKSIM_SERVER_URL on
 * 127.0.0.1 / localhost / ::1). Real tenants get guidance, never automatic writes.
 */
export function simRollbackTarget(env: NodeJS.ProcessEnv = process.env): { allowed: boolean; reason: string } {
  const url = env.STACKSIM_SERVER_URL;
  if (!url) return { allowed: false, reason: 'automatic rollback is sim-only: STACKSIM_SERVER_URL is not set' };
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return { allowed: false, reason: `automatic rollback is sim-only: STACKSIM_SERVER_URL is not a URL (${url})` };
  }
  if (host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1') {
    return { allowed: true, reason: `stacksim at ${url}` };
  }
  return { allowed: false, reason: `automatic rollback is sim-only: STACKSIM_SERVER_URL host "${host}" is not loopback` };
}
