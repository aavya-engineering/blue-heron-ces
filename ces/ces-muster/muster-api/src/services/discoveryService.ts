// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// discoveryService.ts — G-MUSTER-DISCOVERY-1: the read-only discovery executor
// (muster-api lane, FD-DISCOVERY-OWNER: "that is what Muster does").
//
// Walks Stamper's command registries AS DATA, runs each entry's get_command
// READ-ONLY through an injected ces-tenant session, and emits
// readiness-result.v1 observations[]. Structurally read-only: this module has
// NO code path that touches a set_command — it only ever reads get_command /
// evidence_commands. Live/sim parity is free (the injected session is opened
// per tenant kind by the caller, exactly as ces-tenant prescribes).
//
// The engine is PURE + dependency-injected (session + capture sink + registry
// entries as params), so it is fully unit-testable with a mock session and the
// real ces-tenant PersistentSessionFactory wires in unchanged at the call site.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  capturedValues,
  lookupMatchObject,
  lookupSourceCommand,
  lookupValueVariables,
  lookupVerdict,
  type AnswerBounds,
  type LookupBlock,
  type OrgValueBinding,
  type RegistryCapture,
} from './discoveryLookup.js';

/** The subset of a Stamper registry entry the discovery walk consumes. */
export interface RegistryGetEntry {
  entry_id: string;
  control_ids: string[];
  engine: string;
  /** Absent/empty for entries with no readable surface. */
  get_command?: string;
  manual_only?: boolean;
  /** W5c4: the registry's equivalence lookup block (read as data; discoveryLookup.ts). */
  lookup?: LookupBlock;
  /** W5c4: the registry's org-value bindings (the paths an answered value may tighten). */
  org_value_bindings?: OrgValueBinding[];
  /** W5c6: the registry's captures (a policy entry captures the found policy's name for its rule entry). */
  captures?: RegistryCapture[];
}

/** PSResult, narrowed to what the executor reads (matches ces-tenant PSResult). */
export interface DiscoveryExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

/**
 * The narrow session surface the executor needs — satisfied by ces-tenant's
 * TenantSessionFactory (execute). Injected so the engine never hand-rolls
 * session/auth (the surviving must-NOT) and stays testable.
 */
export interface DiscoverySession {
  execute(engine: string, command: string): Promise<DiscoveryExecResult>;
}

/** Persists raw command output off-line and returns a raw_capture_ref pointer;
 * raw output is NEVER inlined into the observation (schema rule). */
export interface CaptureSink {
  write(entryId: string, stdout: string): Promise<string> | string;
}

export type DerivedPosture = 'met' | 'not_met' | 'partial' | 'unknown';

export interface DiscoveryObservation {
  control_id: string;
  objective_ids: string[];
  confidence: 'high' | 'medium' | 'low' | 'unknown';
  ran_entry_ids: string[];
  raw_capture_ref?: string;
  derived_posture: DerivedPosture;
}

/**
 * The recorded fact-status for a degraded command — the literal wording is
 * normative (residual-elicitation-ladder: record "unavailable at this auth
 * tier" as a fact-status rather than silently skipping).
 */
export const AUTH_TIER_UNAVAILABLE = 'unavailable at this auth tier';

export type EntryStatus =
  | 'ok'
  | 'empty'
  | 'manual_only'
  | 'no_get_command'
  | 'failed'
  /**
   * W5c6: the read succeeded, but the entry's block names a value another
   * entry captures (an Exchange rule on its policy's name) and that entry
   * found no equivalent: CES will create the policy and then the rule, so the
   * rule cannot be judged before Stamper runs. Posture unknown; `awaits` names
   * the capturing entry. Not a permanent "unsure": the pair's control is
   * decided by the policy entry's not_met, and a discovery re-run after
   * Stamper judges the rule on CES's policy name.
   */
  | 'awaiting_create'
  /**
   * W7-MX1 part 2: the read failed with a not-found signature (404) and the
   * entry's predicate declares `on_not_found`: the optional service is absent
   * (e.g. Sentinel not onboarded), so the predicate's verdict is recorded.
   */
  | 'not_found'
  | typeof AUTH_TIER_UNAVAILABLE;

/** Per-command run record: every entry gets exactly one status row, in walk order. */
export interface DiscoveryEntryStatus {
  entry_id: string;
  status: EntryStatus;
  /** W5c6 (awaiting_create): the entry whose capture this one needs. */
  awaits?: string;
}

export interface DiscoveryRunResult {
  observations: DiscoveryObservation[];
  /** One status row per entry — degradation is recorded, never silent. */
  statuses: DiscoveryEntryStatus[];
  /** Bookkeeping for the run summary (not part of the payload). */
  stats: {
    entries: number;
    ran: number;
    manual_only_skipped: number;
    degraded: number;
    /** W5c6: entries recorded awaiting_create (see EntryStatus). */
    awaiting_create?: number;
    /** W7-MX1 part 2: entries recorded not_found (see EntryStatus). */
    not_found?: number;
    failed: number;
  };
}

export interface DiscoveryOptions {
  /**
   * When true (a restricted auth tier), execution errors are recorded as
   * per-command degradation ("unavailable at this auth tier") — confidence
   * 'unknown', posture 'unknown' — instead of failing the walk. Degradation is
   * ALWAYS per-command regardless of this flag; the flag only labels intent.
   */
  restrictedTier?: boolean;
  /**
   * MG-02: the verdict predicates, keyed by registry entry_id. Defaults to
   * src/features/discovery/verdictPredicates.json (loadVerdictPredicates).
   */
  predicates?: Record<string, VerdictPredicate>;
  /**
   * W5c3 (P-2): values for the registry's `{variable}` placeholders, resolved
   * before the walk from reads Muster already makes (discoveryVariables.ts).
   * A placeholder with no value stays literal, as before.
   */
  variables?: Record<string, string>;
  /**
   * W5c4: answered bounds by dot path (lower-cased), applied to a lookup
   * block's condition on a path the entry's org_value_bindings name (never
   * weaker than the registry bound). discoveryVariables.answerBoundsFromFacts.
   */
  bounds?: AnswerBounds;
}

/** W5c3 (P-2): replace each `{name}` that has a value; others stay literal. */
export function substituteVariables(command: string, variables: Record<string, string> = {}): string {
  return command.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(variables, name) && variables[name] !== '' ? variables[name] : whole
  );
}

// ── MG-02: verdict predicates ───────────────────────────────────────────────
// A read that returned output is not a pass. Each registry entry Muster prunes
// with carries an expected-value predicate (Muster-side data, never Stamper's
// registry): true -> met, false -> not_met, undecidable -> unknown. No
// predicate (or `expect: null`) -> unknown, so the question stays asked.

/** One check over a get_command's stdout (see verdictPredicates.json `note`). */
export type VerdictCheck =
  | {
      json: string;
      equals?: string | number | boolean;
      in?: Array<string | number | boolean>;
      not_empty?: boolean;
      min_items?: number;
      regex?: string;
      match?: 'all' | 'any';
    }
  | {
      table: string;
      equals?: string | number | boolean;
      in?: Array<string | number | boolean>;
      not_empty?: boolean;
      regex?: string;
      match?: 'all' | 'any';
    }
  | {
      regex: string;
      flags?: string;
      /**
       * W5c3: with `equals` / `in`, the regex's first capture group is the value
       * tested (no match = undecidable), so a setting read from a name/value
       * list can be judged without a match deciding "not met" when the setting
       * is simply absent. Without them, the regex itself is the verdict.
       */
      equals?: string | number | boolean;
      in?: Array<string | number | boolean>;
    }
  | { all: VerdictCheck[] }
  /**
   * W5c4: judge the registry entry's own `lookup` block over its source read
   * (discoveryLookup.ts). Only runDiscovery has the block; anywhere else this
   * check is undecidable.
   */
  | { lookup_effect: true };

export interface VerdictPredicate {
  expect: VerdictCheck | null;
  basis: string;
  live_validation: boolean;
  live_reason?: string;
  /**
   * W5: the verdict when the read succeeded and returned nothing. Only for an
   * unfiltered read, where an empty list is the tenant's state (e.g. no
   * enabled DLP policy). Absent: an empty read stays 'unknown'.
   */
  on_empty?: 'not_met';
  /**
   * W5: judge `expect` over ANOTHER entry's output from the same walk (the
   * entry whose read carries the evidence, e.g. the PIM eligibility schedules
   * for the PIM policy read). This entry's own read must still succeed. The
   * referenced read empty -> `on_empty` (else unknown); failed or not run ->
   * unknown. Kept beside `expect`, not inside it, so an evaluator without this
   * field judges `expect` over the entry's own output (undecidable there).
   */
  from_entry?: string;
  /**
   * W7-MX1 part 2: the verdict when the read FAILED with a not-found signature
   * (404 / ResourceNotFound) on a command with no unresolved
   * `{variable}`: an optional service that is absent is an honest not met, not
   * a failed read. Absent: a not-found failure stays failed (unknown).
   */
  on_not_found?: 'not_met';
}

export type Verdict = 'met' | 'not_met' | 'unknown';

let defaultPredicates: Record<string, VerdictPredicate> | null = null;

/** The predicate file beside the SPA's discovery feature (data, read in place). */
export function verdictPredicatesPath(): string {
  return (
    process.env.MUSTER_VERDICT_PREDICATES ??
    path.resolve(__dirname, '..', '..', '..', 'src', 'features', 'discovery', 'verdictPredicates.json')
  );
}

/** Load (once) the predicates keyed by entry_id. A missing file yields none: every verdict unknown. */
export function loadVerdictPredicates(file: string = verdictPredicatesPath()): Record<string, VerdictPredicate> {
  if (defaultPredicates && file === verdictPredicatesPath()) return defaultPredicates;
  const loaded = fs.existsSync(file)
    ? ((JSON.parse(fs.readFileSync(file, 'utf8')) as { predicates?: Record<string, VerdictPredicate> }).predicates ?? {})
    : {};
  if (file === verdictPredicatesPath()) defaultPredicates = loaded;
  return loaded;
}

type Tri = boolean | null; // null = undecidable

function getPath(value: unknown, dotted: string): { found: boolean; value: unknown } {
  let cur: unknown = value;
  for (const seg of dotted.split('.').filter(Boolean)) {
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return { found: false, value: undefined };
    const key = Object.keys(cur as Record<string, unknown>).find((k) => k.toLowerCase() === seg.toLowerCase());
    if (key === undefined) return { found: false, value: undefined };
    cur = (cur as Record<string, unknown>)[key];
  }
  return { found: true, value: cur };
}

function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v as object).length === 0;
  return false;
}

function sameValue(actual: unknown, expected: string | number | boolean): boolean {
  if (actual === null || actual === undefined || typeof actual === 'object') return false;
  return String(actual).trim().toLowerCase() === String(expected).toLowerCase();
}

function testValue(
  v: unknown,
  c: { equals?: string | number | boolean; in?: Array<string | number | boolean>; not_empty?: boolean; min_items?: number; regex?: string }
): boolean {
  if (c.min_items !== undefined) return Array.isArray(v) && v.length >= c.min_items;
  if (c.not_empty) return !isEmptyValue(v);
  if (c.equals !== undefined) return sameValue(v, c.equals);
  if (c.in) return c.in.some((x) => sameValue(v, x));
  if (c.regex !== undefined) return typeof v === 'string' && new RegExp(c.regex).test(v);
  return false;
}

function quantify(results: boolean[], match: 'all' | 'any' = 'all'): Tri {
  if (results.length === 0) return null;
  return match === 'any' ? results.some(Boolean) : results.every(Boolean);
}

/** PowerShell Format-Table text -> rows keyed by header (positions from the dash line). */
export function parseFormatTable(stdout: string): Array<Record<string, string>> | null {
  const lines = stdout.replace(/\r/g, '').split('\n');
  const dashIdx = lines.findIndex((l, i) => i > 0 && /^\s*-+(\s+-+)*\s*$/.test(l) && lines[i - 1].trim() !== '');
  if (dashIdx < 1) return null;
  // W5c5: a narrow console wraps a long header onto the next line(s) (run-51 S1
  // sign-in logs: "stat" / "us"). The header is every non-blank line above the
  // dash line; each column's name is its slices joined.
  let top = dashIdx - 1;
  while (top > 0 && lines[top - 1].trim() !== '') top--;
  const headers = lines.slice(top, dashIdx);
  const starts: number[] = [];
  const re = /-+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(lines[dashIdx])) !== null) starts.push(m.index);
  const names = starts.map((s, i) =>
    headers.map((h) => h.slice(s, i + 1 < starts.length ? starts[i + 1] : undefined).trim()).join('')
  );
  const rows: Array<Record<string, string>> = [];
  for (const line of lines.slice(dashIdx + 1)) {
    if (line.trim() === '') continue;
    const row: Record<string, string> = {};
    starts.forEach((s, i) => {
      row[names[i]] = line.slice(s, i + 1 < starts.length ? starts[i + 1] : undefined).trim();
    });
    rows.push(row);
  }
  return rows;
}

function evalCheck(check: VerdictCheck, stdout: string): Tri {
  if ('lookup_effect' in check) return null; // needs the entry's block (runDiscovery)
  if ('all' in check) {
    const parts = check.all.map((c) => evalCheck(c, stdout));
    if (parts.some((p) => p === false)) return false;
    if (parts.some((p) => p === null)) return null;
    return parts.length > 0;
  }
  if ('json' in check) {
    let root: unknown;
    try {
      root = JSON.parse(stdout);
    } catch {
      return null; // expected JSON, got something else: undecidable
    }
    if (check.json === '' && check.min_items !== undefined) return testValue(root, check);
    const items = Array.isArray(root) ? root : [root];
    const values = items.map((it) => getPath(it, check.json)).filter((r) => r.found);
    return quantify(values.map((r) => testValue(r.value, check)), check.match);
  }
  if ('table' in check) {
    const rows = parseFormatTable(stdout);
    if (!rows || rows.length === 0) return null;
    const key = Object.keys(rows[0]).find((k) => k.toLowerCase() === check.table.toLowerCase());
    if (key === undefined) return null;
    return quantify(rows.map((r) => testValue(r[key], check)), check.match);
  }
  if (check.equals !== undefined || check.in !== undefined) {
    const m = new RegExp(check.regex, check.flags).exec(stdout);
    if (!m || m[1] === undefined) return null; // the value is not in the output: undecidable
    return testValue(m[1], { equals: check.equals, in: check.in });
  }
  return new RegExp(check.regex, check.flags).test(stdout);
}

/**
 * MG-02: the verdict for one entry's non-empty output. No predicate, or an
 * explicit `expect: null`, is 'unknown' (never 'met' just because output came back).
 */
export function evaluateVerdict(predicate: VerdictPredicate | undefined, stdout: string): Verdict {
  if (!predicate || !predicate.expect) return 'unknown';
  const r = evalCheck(predicate.expect, stdout.trim());
  return r === null ? 'unknown' : r ? 'met' : 'not_met';
}

/**
 * Is a session/auth-shaped failure (degradation) rather than a hard error?
 * Cmdlet-not-recognized, auth/permission, and connection failures are the
 * degradation signatures (per the residual-elicitation-ladder). Everything is
 * degradation-tolerant here anyway — the walk never throws — but this decides
 * the recorded status wording.
 */
function isDegradation(r: DiscoveryExecResult): boolean {
  // W7-MX1: a successful read's content is data, not an error signal (a sign-in banner reads
  // "Unauthorized use ..."): stderr always, stdout only when the command failed.
  const hay = `${r.stderr} ${r.exitCode !== 0 ? r.stdout : ''}`.toLowerCase();
  return (
    /is not recognized as the name of a cmdlet|is not recognized|authentication needed|unauthorized|forbidden|access denied|token|not connected|could not connect|insufficient privileges|authorization_requestdenied/.test(
      hay
    )
  );
}

/** W7-MX1 part 2: a failed read that says the resource does not exist (never a 400 or an auth failure). */
function isNotFound(r: DiscoveryExecResult): boolean {
  return /\b404\b|resourcenotfound/.test(`${r.stderr} ${r.stdout}`.toLowerCase());
}

/**
 * Run the read-only discovery walk over the given registry entries.
 * - manual_only OR no get_command  -> skipped, recorded as posture 'unknown'
 *   (no readable surface), NEVER omitted.
 * - get_command success (exit 0, non-empty) -> MG-02 verdict predicate:
 *   met / not_met, or unknown when there is no predicate or the output is
 *   undecidable. Confidence stays 'high' (the read succeeded); only the posture
 *   carries the verdict, and only a 'met' posture prunes (discoveryFactJoin).
 * - get_command empty/exit0        -> posture 'unknown' (read succeeded, nothing there),
 *   unless the predicate's on_empty decides it (W5: an unfiltered read's empty list).
 * - a from_entry predicate (W5)     -> judged after the walk over the referenced entry's output.
 * - get_command error              -> per-command degradation, posture 'unknown'.
 * - get_command not-found failure   -> the predicate's on_not_found (W7-MX1 part 2), status
 *   not_found, when the command has no unresolved {variable}; else as any error.
 * The walk NEVER throws and NEVER runs a set_command (there is no such path here).
 */
export async function runDiscovery(
  entries: RegistryGetEntry[],
  session: DiscoverySession,
  capture: CaptureSink,
  opts: DiscoveryOptions = {}
): Promise<DiscoveryRunResult> {
  // The restrictedTier flag labels intent only — degradation is per-command
  // always (see DiscoveryOptions); the recorded statuses are identical either way.
  void opts.restrictedTier;
  const predicates = opts.predicates ?? loadVerdictPredicates();
  const observations: DiscoveryObservation[] = [];
  const statuses: DiscoveryEntryStatus[] = [];
  const stats = { entries: entries.length, ran: 0, manual_only_skipped: 0, degraded: 0, failed: 0, awaiting_create: 0, not_found: 0 };
  // W5: each successful read's output (for from_entry predicates), and the
  // observations of the entries judged on another entry's read, settled after the walk.
  const readOutputs = new Map<string, string>();
  const deferred: Array<{ predicate: VerdictPredicate; from: number; to: number }> = [];
  // W5c6: which lookup-judged entry in this walk captures each variable (first wins),
  // the values captured so far, each lookup entry's verdict, and the lookup entries
  // that need a captured value (judged after the walk, once their producer is judged).
  const isLookupJudged = (e: RegistryGetEntry) => {
    const p = predicates[e.entry_id];
    return Boolean(e.lookup && p?.expect && 'lookup_effect' in p.expect && !p.from_entry);
  };
  const producerOf = new Map<string, string>();
  for (const e of entries) {
    if (!isLookupJudged(e)) continue;
    for (const c of e.captures ?? []) if (!producerOf.has(c.variable)) producerOf.set(c.variable, e.entry_id);
  }
  const captured: Record<string, string> = {};
  const lookupVerdicts = new Map<string, DerivedPosture>();
  const capturedNeeds = (e: RegistryGetEntry): string[] =>
    e.lookup
      ? lookupValueVariables(e.lookup).filter((v) => producerOf.has(v) && producerOf.get(v) !== e.entry_id && !opts.variables?.[v])
      : [];
  const deferredLookups: Array<{ entry: RegistryGetEntry; out: string; from: number; to: number; status: number }> = [];

  for (const entry of entries) {
    const controlIds = entry.control_ids ?? [];

    // No readable surface: manual_only or missing get_command. Recorded, not omitted.
    if (entry.manual_only || !entry.get_command || entry.get_command.trim() === '') {
      if (entry.manual_only) stats.manual_only_skipped++;
      statuses.push({
        entry_id: entry.entry_id,
        status: entry.manual_only ? 'manual_only' : 'no_get_command',
      });
      pushForEntry(observations, entry, controlIds, {
        confidence: 'unknown',
        posture: 'unknown',
      });
      continue;
    }

    // W5c4: a lookup-judged entry reads the block's candidate list instead of its one-object GET.
    const entryPredicate = predicates[entry.entry_id];
    const byLookup = Boolean(entry.lookup && entryPredicate?.expect && 'lookup_effect' in entryPredicate.expect);
    const command = byLookup ? lookupSourceCommand(entry.lookup!) : entry.get_command;
    let result: DiscoveryExecResult;
    const resolved = substituteVariables(command, opts.variables);
    try {
      result = await session.execute(entry.engine, resolved);
    } catch (e) {
      // A thrown session error is treated as degradation, never a walk failure.
      stats.degraded++;
      statuses.push({ entry_id: entry.entry_id, status: AUTH_TIER_UNAVAILABLE });
      pushForEntry(observations, entry, controlIds, { confidence: 'unknown', posture: 'unknown' });
      void e;
      continue;
    }

    stats.ran++;
    const strippedOut = result.stdout?.trim() ?? '';

    if (result.exitCode !== 0 || isDegradation(result)) {
      const degraded = isDegradation(result);
      const notFoundVerdict = entryPredicate?.expect ? entryPredicate.on_not_found : undefined;
      if (
        !degraded &&
        notFoundVerdict &&
        isNotFound(result) &&
        !/\{[A-Za-z][A-Za-z0-9]*\}/.test(resolved)
      ) {
        stats.not_found++;
        statuses.push({ entry_id: entry.entry_id, status: 'not_found' });
        pushForEntry(observations, entry, controlIds, { confidence: 'high', posture: notFoundVerdict });
        continue;
      }
      if (degraded) stats.degraded++;
      else stats.failed++;
      statuses.push({
        entry_id: entry.entry_id,
        status: degraded ? AUTH_TIER_UNAVAILABLE : 'failed',
      });
      pushForEntry(observations, entry, controlIds, { confidence: 'unknown', posture: 'unknown' });
      continue;
    }

    // Read succeeded. MG-02: non-empty output is judged by the entry's verdict
    // predicate (met / not_met); without one it is 'unknown' — output alone is not a pass.
    // W5: an empty read is decisive only where the predicate says so (on_empty).
    const ref = strippedOut ? await capture.write(entry.entry_id, result.stdout) : undefined;
    statuses.push({ entry_id: entry.entry_id, status: strippedOut ? 'ok' : 'empty' });
    readOutputs.set(entry.entry_id, strippedOut);
    const predicate = predicates[entry.entry_id];
    const needsCapture = byLookup && capturedNeeds(entry).length > 0;
    const verdict: DerivedPosture = predicate?.from_entry || needsCapture
      ? 'unknown'
      : byLookup
        ? lookupVerdict(entry.lookup!, strippedOut, {
            variables: opts.variables,
            bindings: entry.org_value_bindings,
            bounds: opts.bounds,
          })
        : strippedOut
          ? evaluateVerdict(predicate, result.stdout)
          : (predicate?.expect && predicate.on_empty) || 'unknown';
    const from = observations.length;
    pushForEntry(observations, entry, controlIds, {
      // confidence describes the read (output came back); the verdict is the posture.
      confidence: strippedOut ? 'high' : 'low',
      posture: verdict,
      raw_capture_ref: ref,
    });
    if (predicate?.from_entry) deferred.push({ predicate, from, to: observations.length });
    if (needsCapture) deferredLookups.push({ entry, out: strippedOut, from, to: observations.length, status: statuses.length - 1 });
    else if (byLookup) {
      lookupVerdicts.set(entry.entry_id, verdict);
      if (verdict === 'met' && entry.captures?.length) {
        const ctx = { variables: opts.variables, bindings: entry.org_value_bindings, bounds: opts.bounds };
        for (const [k, v] of Object.entries(capturedValues(lookupMatchObject(entry.lookup!, strippedOut, ctx), entry.captures))) {
          if (!(k in captured)) captured[k] = v;
        }
      }
    }
  }

  // W5c6: the lookups that need a captured value. Producer met: judged with the
  // captured value. Producer read but not met (no equivalent, so CES will
  // create): awaiting_create. Producer unread or unknown: unknown, as any read.
  for (const d of deferredLookups) {
    const missing = capturedNeeds(d.entry).filter((v) => !(v in captured));
    let verdict: DerivedPosture = 'unknown';
    if (missing.length === 0) {
      verdict = lookupVerdict(d.entry.lookup!, d.out, {
        variables: { ...(opts.variables ?? {}), ...captured },
        bindings: d.entry.org_value_bindings,
        bounds: opts.bounds,
      });
    } else {
      const producer = producerOf.get(missing[0])!;
      if (lookupVerdicts.get(producer) === 'not_met') {
        statuses[d.status] = { entry_id: d.entry.entry_id, status: 'awaiting_create', awaits: producer };
        stats.awaiting_create++;
      }
    }
    for (let i = d.from; i < d.to; i++) {
      observations[i] = { ...observations[i], derived_posture: verdict, ...(verdict !== 'unknown' ? { confidence: 'high' } : {}) };
    }
  }

  // W5: the entries judged on another entry's read, once every read is in.
  const byId = new Map(entries.map((e) => [e.entry_id, e]));
  for (const d of deferred) {
    const verdict = fromEntryVerdict(d.predicate, readOutputs, {
      entries: byId,
      variables: opts.variables,
      bounds: opts.bounds,
    });
    for (let i = d.from; i < d.to; i++) {
      observations[i] = { ...observations[i], derived_posture: verdict, ...(verdict !== 'unknown' ? { confidence: 'high' } : {}) };
    }
  }

  return { observations, statuses, stats };
}

/**
 * W5: a from_entry predicate's verdict. The referenced entry's read must have
 * succeeded in this walk: non-empty -> `expect` over its output; empty ->
 * `on_empty` (else unknown); failed, degraded or not run -> unknown.
 */
export function fromEntryVerdict(
  predicate: VerdictPredicate,
  readOutputs: ReadonlyMap<string, string>,
  ctx: { entries?: ReadonlyMap<string, RegistryGetEntry>; variables?: Record<string, string>; bounds?: AnswerBounds } = {}
): Verdict {
  if (!predicate.from_entry || !predicate.expect) return 'unknown';
  const out = readOutputs.get(predicate.from_entry);
  if (out === undefined) return 'unknown';
  // W5c5: `lookup_effect` with from_entry judges the REFERENCED entry's lookup
  // block over its source read (the same verdict that entry gets).
  if ('lookup_effect' in predicate.expect) {
    const ref = ctx.entries?.get(predicate.from_entry);
    if (!ref?.lookup) return 'unknown';
    return lookupVerdict(ref.lookup, out, { variables: ctx.variables, bindings: ref.org_value_bindings, bounds: ctx.bounds });
  }
  if (out === '') return predicate.on_empty ?? 'unknown';
  return evaluateVerdict(predicate, out);
}

function pushForEntry(
  out: DiscoveryObservation[],
  entry: RegistryGetEntry,
  controlIds: string[],
  o: { confidence: DiscoveryObservation['confidence']; posture: DerivedPosture; raw_capture_ref?: string }
): void {
  // One observation per covered control; ran_entry_ids records provenance.
  const ids = controlIds.length > 0 ? controlIds : [entry.entry_id];
  for (const controlId of ids) {
    out.push({
      control_id: controlId,
      objective_ids: [],
      confidence: o.confidence,
      ran_entry_ids: [entry.entry_id],
      ...(o.raw_capture_ref ? { raw_capture_ref: o.raw_capture_ref } : {}),
      derived_posture: o.posture,
    });
  }
}

/** Filter a raw registry entries array to the get-walkable subset shape. */
export function toGetEntries(rawEntries: unknown[]): RegistryGetEntry[] {
  return (rawEntries as Array<Record<string, unknown>>)
    .filter((e) => e && typeof e === 'object' && typeof e.entry_id === 'string')
    .map((e) => ({
      entry_id: e.entry_id as string,
      control_ids: Array.isArray(e.control_ids) ? (e.control_ids as string[]) : [],
      engine: typeof e.engine === 'string' ? (e.engine as string) : 'mgraph',
      get_command: typeof e.get_command === 'string' ? (e.get_command as string) : undefined,
      manual_only: e.manual_only === true,
      ...(e.lookup && typeof e.lookup === 'object' ? { lookup: e.lookup as LookupBlock } : {}),
      ...(Array.isArray(e.org_value_bindings) ? { org_value_bindings: e.org_value_bindings as OrgValueBinding[] } : {}),
      ...(Array.isArray(e.captures) && e.captures.length > 0 ? { captures: e.captures as RegistryCapture[] } : {}),
    }));
}
