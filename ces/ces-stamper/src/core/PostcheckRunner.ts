// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as https from 'https';
import { Check } from '../types/schema.types.js';
import { StateManager } from '../state/StateManager.js';
import { EvidenceCollector } from '../evidence/EvidenceCollector.js';
import { StamperConfig } from '../config/StamperConfig.js';
import type { EntryStateRecord } from '../adapters/PowerShellAdapter.js';

export interface CheckResult {
  check_id: string;
  passed: boolean;
  actual?: string;
  error?: string;
  dry_run?: boolean;
  skipped?: boolean;
  // synthetic-customer W3: what kind of check this was. 'state' compares a value; 'presence'
  // proves only that evidence exists; 'manual' needs a human.
  mode?: 'state' | 'presence' | 'manual';
  basis?: 'tm' | 'registry';
  outcome?: 'pass' | 'fail' | 'not_assessed';
  control_id?: string;
  expected?: string;
  entry_id?: string;
  missing_path?: string;
  // DEPTH-8 (depth plan §4): the objective the check verifies (DEPTH-7 spec row), the expected value it
  // compared, what this run's read held (absent = no read was evaluated), which entry and control the read
  // came from, and for a presence check the controls whose evidence was counted (only its own).
  objective_id?: string;
  expected_value?: ExpectedValue;
  observed_value?: unknown;
  read_entry_id?: string;
  read_control_id?: string;
  evidence_control_ids?: string[];
}

/**
 * DEPTH-7/8: a postcheck as Muster's per-objective spec writes it. `objective_id` reaches the plan only once
 * Stamper's CheckSchema and ManifestReader.generatePostchecks carry it (diffs in LOG-DEPTH-78.md).
 */
export type ObjectiveCheck = Check & { objective_id?: string };

/** synthetic-customer W3: the entry records of this run (PowerShellAdapter.getEntryStateRecords). */
export type StateRecordSource = () => EntryStateRecord[];

type ExpectedValue = NonNullable<Check['expected_value']>;

/**
 * DEPTH-8 (known false fail, AU.L2-3.3.7): Windows `w32tm` lists an NTP peer as `<host>,0x<flags>`
 * (e.g. `time.windows.com,0x9`); the flags are not part of the server name. Other values are unchanged.
 */
export function normalizeNtpPeer(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const m = v.trim().match(/^([^\s,]+),0x[0-9a-f]+$/i);
  return m ? m[1] : v;
}

/** One step of a JSONPath-ish path: a key, `[*]`, `[n]` or `[?(@.key=='value')]`. */
type PathStep = { key: string } | { all: true } | { index: number } | { filterKey: string; filterValue: string };

function parsePath(pathText: string): PathStep[] | null {
  const steps: PathStep[] = [];
  let rest = pathText.trim().replace(/^\$/, '');
  while (rest.length > 0) {
    let m: RegExpMatchArray | null;
    if ((m = rest.match(/^\.([^.[\]]+)/))) { steps.push({ key: m[1] }); rest = rest.slice(m[0].length); continue; }
    if ((m = rest.match(/^\[\*\]/))) { steps.push({ all: true }); rest = rest.slice(m[0].length); continue; }
    if ((m = rest.match(/^\[(\d+)\]/))) { steps.push({ index: Number(m[1]) }); rest = rest.slice(m[0].length); continue; }
    if ((m = rest.match(/^\[\?\(@\.([^=\s]+)\s*==\s*(['"])(.*?)\2\)\]/))) { steps.push({ filterKey: m[1], filterValue: m[3] }); rest = rest.slice(m[0].length); continue; }
    if ((m = rest.match(/^\[(['"])(.*?)\1\]/))) { steps.push({ key: m[2] }); rest = rest.slice(m[0].length); continue; }
    return null;
  }
  return steps;
}

/** Case-insensitive property read (PowerShell and Graph casings differ, as in OutputVerificationEngine). */
function readKey(obj: unknown, key: string): unknown {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return undefined;
  const rec = obj as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(rec, key)) return rec[key];
  const k = Object.keys(rec).find(x => x.toLowerCase() === key.toLowerCase());
  return k === undefined ? undefined : rec[k];
}

/** Every value the path reaches. A key step on an array applies to each element (a read may be a list). */
export function selectPath(doc: unknown, pathText: string): unknown[] | null {
  const steps = parsePath(pathText);
  if (!steps) return null;
  let current: unknown[] = [doc];
  for (const step of steps) {
    const next: unknown[] = [];
    for (const node of current) {
      if ('key' in step) {
        if (Array.isArray(node)) { for (const el of node) { const v = readKey(el, step.key); if (v !== undefined) next.push(v); } }
        else { const v = readKey(node, step.key); if (v !== undefined) next.push(v); }
      } else if ('all' in step) {
        if (Array.isArray(node)) next.push(...node);
        else if (node && typeof node === 'object') next.push(...Object.values(node as Record<string, unknown>));
      } else if ('index' in step) {
        if (Array.isArray(node) && step.index < node.length) next.push(node[step.index]);
      } else if (Array.isArray(node)) {
        for (const el of node) if (String(readKey(el, step.filterKey) ?? '').toLowerCase() === step.filterValue.toLowerCase()) next.push(el);
      }
    }
    current = next;
  }
  return current;
}

const scalarEquals = (a: unknown, b: unknown): boolean =>
  String(a).toLowerCase() === String(b).toLowerCase() || String(normalizeNtpPeer(a)).toLowerCase() === String(b).toLowerCase();
const asNumber = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);

/**
 * synthetic-customer W3: compare a TM expected value against one read (JSON text).
 * found = the path reached at least one value. equals: one value equals (case-insensitive, as
 * PowerShell -eq); contains: one value is (or is an array holding) the value, or a string holding
 * it; gte / lte: every value is numeric and in range (Graph returns some numbers as strings);
 * exists: found (value false = must be absent); count-gte: the number of values, arrays counted
 * by length, is at least the value.
 */
export function evaluateExpectedValue(readText: string, ev: ExpectedValue): { found: boolean; passed: boolean; values: unknown[] } {
  let doc: unknown;
  try {
    doc = JSON.parse(readText);
  } catch {
    return { found: false, passed: false, values: [] };
  }
  const values = selectPath(doc, ev.path) ?? [];
  const found = values.length > 0 && values.some(v => v !== null);
  const flat = values.flatMap(v => (Array.isArray(v) ? v : [v]));
  let passed = false;
  switch (ev.op) {
    case 'equals': passed = values.some(v => !Array.isArray(v) && scalarEquals(v, ev.value)); break;
    case 'contains': passed = flat.some(v => scalarEquals(v, ev.value)) || values.some(v => typeof v === 'string' && v.toLowerCase().includes(String(ev.value).toLowerCase())); break;
    case 'gte': passed = found && values.every(v => asNumber(v) >= asNumber(ev.value)); break;
    case 'lte': passed = found && values.every(v => asNumber(v) <= asNumber(ev.value)); break;
    case 'exists': passed = ev.value === false ? !found : found; break;
    case 'count-gte': passed = flat.length >= asNumber(ev.value); break;
  }
  // 'exists: false' and 'count-gte' answer even when the path reaches nothing.
  const answered = found || (ev.op === 'exists' && ev.value === false) || ev.op === 'count-gte';
  return { found: answered, passed, values };
}

export class PostcheckRunner {
  private stateManager: StateManager;
  private evidenceCollector: EvidenceCollector;
  private config?: StamperConfig;
  private stateRecords?: StateRecordSource;
  /** synthetic-customer W3: every result of this run, in order (written by the CLI next to the results manifest). */
  private results: CheckResult[] = [];

  constructor(stateManager: StateManager, evidenceCollector: EvidenceCollector, config?: StamperConfig, stateRecords?: StateRecordSource) {
    this.stateManager = stateManager;
    this.evidenceCollector = evidenceCollector;
    this.config = config;
    this.stateRecords = stateRecords;
  }

  /** synthetic-customer W3: the results of the postchecks run so far. */
  getResults(): CheckResult[] {
    return [...this.results];
  }

  async runPostchecks(
    postchecks: Check[],
    planId: string,
    dryRun: boolean
  ): Promise<{
    passed: boolean;
    results: CheckResult[];
  }> {
    const results: CheckResult[] = [];

    for (const check of postchecks) {
      const result = await this.runCheck(check, planId, dryRun);
      results.push(result);
    }

    const passed = results.every(r => r.passed);

    return {
      passed,
      results
    };
  }

  // Phase 6.1: Replace keyword dispatch with check.method switch.
  public async runCheck(check: Check, planId: string, dryRun: boolean): Promise<CheckResult> {
    const dispatched = await this.dispatchCheck(check, planId, dryRun);
    // DEPTH-8: the objective and expected value travel with the result (the per-objective verdicts).
    const objectiveId = (check as ObjectiveCheck).objective_id;
    const result: CheckResult = {
      ...dispatched,
      ...(objectiveId ? { objective_id: objectiveId } : {}),
      ...(check.expected_value && dispatched.expected_value === undefined ? { expected_value: check.expected_value } : {}),
      ...(dispatched.control_id === undefined && check.control_id !== undefined ? { control_id: check.control_id } : {}),
    };
    this.results.push(result);
    if (!dryRun) recordRunPostcheck(planId, result);
    return result;
  }

  private async dispatchCheck(check: Check, planId: string, dryRun: boolean): Promise<CheckResult> {
    switch (check.method) {
      case 'api_query':
        return this.runApiQuery(check, dryRun);
      case 'config_export':
        return this.runConfigExport(check, planId, dryRun);
      case 'log_query':
        return this.runLogQuery(check, dryRun);
      case 'manual':
        return this.runManualGate(check);
      default:
        return {
          check_id: check.id,
          passed: false,
          error: `Unknown method: ${(check as Check).method}`
        };
    }
  }

  // Phase 6.2: runApiQuery issues a GET against the Graph endpoint.
  // In dry-run, returns a skipped stub — not a fabricated pass.
  private async runApiQuery(check: Check, dryRun: boolean): Promise<CheckResult> {
    if (dryRun) {
      return {
        check_id: check.id,
        passed: true,
        dry_run: true,
        skipped: true,
        actual: '[dry-run] api_query postcheck skipped'
      };
    }

    const graphBase = this.config?.graphEndpoint ?? 'https://graph.microsoft.us';
    const target = check.target ?? '/v1.0/organization';
    const url = `${graphBase}${target}`;

    try {
      const responseBody = await this.httpGet(url);
      const response = JSON.parse(responseBody) as Record<string, unknown>;

      // Compare expected_field if specified
      if (check.expected_field) {
        const fieldValue = response[check.expected_field];
        const actual = String(fieldValue ?? '');
        const passed = actual === check.expected;
        return {
          check_id: check.id,
          passed,
          actual,
          error: passed ? undefined : check.on_fail
        };
      }

      // Default: treat a 200 OK with a body as passing
      return {
        check_id: check.id,
        passed: true,
        actual: `GET ${url} returned OK`
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (check.on_fail === 'halt') {
        throw new Error(`Postcheck ${check.id} failed: ${errorMsg}`);
      }
      return {
        check_id: check.id,
        passed: false,
        error: errorMsg
      };
    }
  }

  /**
   * synthetic-customer W3: a config_export postcheck.
   * - The TM row carries `expected_value` {path, op, value}: mode 'state'. The path is applied to
   *   the reads of this run's entry records for the row's control (scope rule: each record's
   *   post-SET read, else its GET, else an evidence-only entry's read). PASS when one read holds
   *   the expected value; FAIL when the path is present and no read holds it; NOT ASSESSED when
   *   no read has the path (the missing path is recorded) or there is no read for the control.
   *   Not assessed is never a pass.
   * - No expected value, but the control's SET-path entries carry registry state assertions that
   *   were evaluated in this run: mode 'state' (basis 'registry'); PASS when all of them passed.
   * - Otherwise: mode 'presence' (any evidence collected for the plan), labelled as such.
   */
  private runConfigExport(check: Check, planId: string, dryRun: boolean): CheckResult {
    if (dryRun) {
      return {
        check_id: check.id,
        passed: true,
        dry_run: true,
        skipped: true,
        actual: '[dry-run] config_export postcheck skipped',
        mode: check.expected_value ? 'state' : 'presence',
      };
    }

    const records = (this.stateRecords?.() ?? []).filter(r => check.control_id !== undefined && r.controlIds.includes(check.control_id));

    if (check.expected_value) {
      const ev = check.expected_value;
      const want = `${ev.path} ${ev.op}${ev.value !== undefined ? ` ${JSON.stringify(ev.value)}` : ''}`;
      const reads = records.filter(r => r.stateOutput !== undefined && r.stateOutput.trim() !== '');
      if (reads.length === 0) {
        return { check_id: check.id, passed: false, mode: 'state', basis: 'tm', outcome: 'not_assessed', control_id: check.control_id, expected: want,
          actual: `not assessed: no read for ${check.control_id ?? '(no control)'} in this run` };
      }
      let pathSeen = false;
      const seen: string[] = [];
      let firstSeen: { entryId: string; values: unknown[] } | undefined;
      for (const r of reads) {
        const res = evaluateExpectedValue(r.stateOutput as string, ev);
        if (res.found) pathSeen = true;
        if (res.passed) {
          return { check_id: check.id, passed: true, mode: 'state', basis: 'tm', outcome: 'pass', control_id: check.control_id, expected: want, entry_id: r.entryId,
            actual: `${r.entryId}: ${JSON.stringify(res.values)}`,
            observed_value: res.values, read_entry_id: r.entryId, read_control_id: check.control_id };
        }
        if (res.found) {
          seen.push(`${r.entryId}: ${JSON.stringify(res.values)}`);
          if (firstSeen === undefined) firstSeen = { entryId: r.entryId, values: res.values };
        }
      }
      if (!pathSeen) {
        // DEPTH-8: the read was evaluated and held nothing at the path: observed null (not "no read").
        return { check_id: check.id, passed: false, mode: 'state', basis: 'tm', outcome: 'not_assessed', control_id: check.control_id, expected: want, missing_path: ev.path,
          actual: `not assessed: ${ev.path} is not in the read of ${reads.map(r => r.entryId).join(', ')}`,
          observed_value: null, read_entry_id: reads[0].entryId, read_control_id: check.control_id };
      }
      return { check_id: check.id, passed: false, mode: 'state', basis: 'tm', outcome: 'fail', control_id: check.control_id, expected: want,
        actual: seen.join('; '), error: check.on_fail,
        observed_value: firstSeen?.values, read_entry_id: firstSeen?.entryId, read_control_id: check.control_id };
    }

    const stateEntries = records.filter(r => r.postcheckMode === 'state');
    if (stateEntries.length > 0) {
      const failed = stateEntries.filter(r => !r.statePassed);
      return {
        check_id: check.id,
        passed: failed.length === 0,
        mode: 'state',
        basis: 'registry',
        outcome: failed.length === 0 ? 'pass' : 'fail',
        control_id: check.control_id,
        actual: failed.length === 0
          ? `registry state assertions passed: ${stateEntries.map(r => r.entryId).join(', ')}`
          : `registry state assertions failed: ${failed.map(r => r.entryId).join(', ')}`,
        error: failed.length === 0 ? undefined : check.on_fail,
      };
    }

    // DEPTH-8: presence counts only this control's evidence (its entry records in this run and the plan
    // artifacts tagged with it), never any evidence anywhere in the plan.
    const own = check.control_id === undefined
      ? []
      : this.evidenceCollector.getPlanEvidence(planId).filter(a => Array.isArray(a?.control_ids) && a.control_ids.includes(check.control_id as string));
    const count = own.length + records.length;
    const scope = check.control_id !== undefined ? [check.control_id] : [];

    if (count === 0) {
      return {
        check_id: check.id,
        passed: false,
        mode: 'presence',
        outcome: 'fail',
        control_id: check.control_id,
        evidence_control_ids: scope,
        actual: `presence-only: no evidence collected for ${check.control_id ?? '(no control)'}`,
        error: 'Expected evidence for this control but none was collected'
      };
    }

    return {
      check_id: check.id,
      passed: true,
      mode: 'presence',
      outcome: 'pass',
      control_id: check.control_id,
      evidence_control_ids: scope,
      actual: `presence-only: ${records.length} entry record(s) and ${own.length} evidence artifact(s) for ${check.control_id}`
    };
  }

  private runLogQuery(check: Check, dryRun: boolean): CheckResult {
    if (dryRun) {
      return {
        check_id: check.id,
        passed: true,
        dry_run: true,
        skipped: true,
        actual: '[dry-run] log_query postcheck skipped'
      };
    }

    // Verify task completion as a proxy for log query in MVP
    const summary = this.stateManager.getSummary();
    const passed = summary.failed === 0;

    return {
      check_id: check.id,
      passed,
      actual: passed
        ? `All ${summary.total} tasks completed successfully`
        : `${summary.failed} task(s) failed`,
      error: passed ? undefined : check.on_fail
    };
  }

  private runManualGate(check: Check): CheckResult {
    // Manual review postchecks always require human review.
    // In all modes (including dry-run), we cannot fabricate a pass.
    return {
      check_id: check.id,
      passed: false,
      mode: 'manual',
      outcome: 'not_assessed',
      control_id: check.control_id,
      actual: 'Manual review required — human review pending',
      error: check.on_fail
    };
  }

  private httpGet(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      }).on('error', reject);
    });
  }
}

// ---- DEPTH-8: per-objective verdicts for the local results manifest ----

/** One postcheck as the results manifest records it under its objective. */
export interface ObjectivePostcheckRecord {
  check_id: string;
  mode: 'state' | 'presence' | 'manual';
  outcome: 'pass' | 'fail' | 'not_assessed';
  expected_value?: ExpectedValue;
  observed_value?: unknown;
  read_entry_id?: string;
  read_control_id?: string;
  evidence_control_ids?: string[];
}

/**
 * Objective verdict: 'fail' if any of its postchecks failed; else 'not_assessed' if any was not assessed
 * (a missing read, or a manual check no one has reviewed); else 'pass'. Stamper reports it; EO holds status.
 */
export type ObjectiveVerdictWord = 'pass' | 'fail' | 'not_assessed';

export interface ObjectiveVerdict {
  objective_id: string;
  verdict: ObjectiveVerdictWord;
  postchecks: ObjectivePostcheckRecord[];
}

const outcomeOf = (r: CheckResult): 'pass' | 'fail' | 'not_assessed' =>
  r.outcome ?? (r.mode === 'manual' ? 'not_assessed' : r.passed ? 'pass' : 'fail');

/** Group this run's results by control, then objective. Results without an objective id are left out. */
export function objectiveVerdictsByControl(results: CheckResult[]): Map<string, ObjectiveVerdict[]> {
  const byControl = new Map<string, Map<string, ObjectivePostcheckRecord[]>>();
  for (const r of results) {
    if (!r.objective_id || !r.control_id || r.dry_run) continue;
    const rec: ObjectivePostcheckRecord = {
      check_id: r.check_id,
      mode: r.mode ?? 'presence',
      outcome: outcomeOf(r),
      ...(r.expected_value ? { expected_value: r.expected_value } : {}),
      ...(r.observed_value !== undefined ? { observed_value: r.observed_value } : {}),
      ...(r.read_entry_id ? { read_entry_id: r.read_entry_id } : {}),
      ...(r.read_control_id ? { read_control_id: r.read_control_id } : {}),
      ...(r.evidence_control_ids ? { evidence_control_ids: r.evidence_control_ids } : {}),
    };
    const objectives = byControl.get(r.control_id) ?? new Map<string, ObjectivePostcheckRecord[]>();
    objectives.set(r.objective_id, [...(objectives.get(r.objective_id) ?? []), rec]);
    byControl.set(r.control_id, objectives);
  }
  const out = new Map<string, ObjectiveVerdict[]>();
  for (const [cid, objectives] of byControl) {
    const list: ObjectiveVerdict[] = [...objectives.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([objective_id, postchecks]) => ({
        objective_id,
        verdict: postchecks.some(p => p.outcome === 'fail') ? 'fail' : postchecks.some(p => p.outcome === 'not_assessed') ? 'not_assessed' : 'pass',
        postchecks,
      }));
    out.set(cid, list);
  }
  return out;
}

/**
 * DEPTH-8: the last non-dry-run postcheck results per plan id, so the results-manifest writer
 * (ExecutionResultsPublisher) can add the per-objective verdicts without its callers passing them.
 */
const RUN_POSTCHECKS = new Map<string, Map<string, CheckResult>>();
function recordRunPostcheck(planId: string, result: CheckResult): void {
  const byCheck = RUN_POSTCHECKS.get(planId) ?? new Map<string, CheckResult>();
  byCheck.set(result.check_id, result); // a re-run of the same check (resume) replaces the earlier result
  RUN_POSTCHECKS.set(planId, byCheck);
}
/** This process's postcheck results for a plan (empty when none ran). */
export function runPostcheckResults(planId: string): CheckResult[] {
  return [...(RUN_POSTCHECKS.get(planId)?.values() ?? [])];
}
/** Test support: forget the recorded results. */
export function clearRunPostcheckResults(): void {
  RUN_POSTCHECKS.clear();
}
