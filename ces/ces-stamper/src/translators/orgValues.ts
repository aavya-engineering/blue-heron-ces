// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// synthetic-customer W5 cycle 2: a registry SET that hard-codes a numeric value configures the
// organisation's value instead, when the Tenant Manifest (TM) carries it as a verification row's
// `expected_value` ({ path, op: lte|gte, value }) on one of the entry's controls. The entry declares
// which values qualify (`org_value_bindings`). Never weaker than the registry default: a weaker
// organisation value keeps the default and the decision carries a note. No TM row: unchanged.
import type { CommandEntry } from '../registry/command-registry.types.js';
import type { OrgValueDecision, OrgValueCheck, VerificationCriteria } from '../types/schema.types.js';
import { OutputVerificationEngine, withinNumericBounds } from '../core/OutputVerificationEngine.js';
import { parseExpectedValue } from './ManifestReader.js';
import type { ManifestReader } from './ManifestReader.js';

export const ORG_VALUE_WEAKER_NOTE = 'organisation value weaker than CES baseline';

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const samePath = (a: string | undefined, b: string): boolean =>
  typeof a === 'string' && a.trim().toLowerCase() === b.trim().toLowerCase();

const toNumber = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

/** The set_command with `token=<from>` replaced by `token=<to>`; undefined when the literal is absent. */
function rewriteToken(setCommand: string, token: string, from: number, to: number): string | undefined {
  const re = new RegExp(`(\\b${escapeRe(token)}['"]?\\s*=\\s*)${escapeRe(String(from))}(?![\\w.])`, 'g');
  if (!re.test(setCommand)) return undefined;
  re.lastIndex = 0;
  return setCommand.replace(re, `$1${to}`);
}

// W5c7: a string binding (op 'equals') configures the answered value only when it is an NTP server list
// (`host[,0xN]`, space separated): it is written into the SET text at translate, so it never carries a
// quote or a PowerShell metacharacter (the adapter's G-ENG-1 guard does not see translate-time text).
export const ORG_VALUE_UNSAFE_NOTE = 'organisation value is not a plain server list';
const SAFE_STRING_VALUE = /^[A-Za-z0-9.-]+(,0x[0-9A-Fa-f]{1,2})?( [A-Za-z0-9.-]+(,0x[0-9A-Fa-f]{1,2})?)*$/;
const psQuote = (s: string): string => `'${s.replace(/'/g, "''")}'`;

/** W5c7: the set_command with `$token='<from>'` replaced by `$token='<to>'`; undefined when the literal is absent. */
function rewriteStringToken(setCommand: string, token: string, from: string, to: string): string | undefined {
  const re = new RegExp(`(\\$${escapeRe(token)}\\s*=\\s*)${escapeRe(psQuote(from))}`, 'g');
  if (!re.test(setCommand)) return undefined;
  re.lastIndex = 0;
  return setCommand.replace(re, (_m, head: string) => `${head}${psQuote(to)}`);
}

/** The verification with every rule on `path` asserting `equals: configured` (a rule is added if none reads it). */
function assertConfigured(verification: CommandEntry['verification'], path: string, configured: number | string): CommandEntry['verification'] {
  const value = String(configured);
  const evidence = { ...(verification?.evidence ?? {}) };
  let covered = false;
  if (samePath(evidence.jsonpath, path)) {
    // PH-13 (LOG-PH13-REG STOP-2): a registry range (min..max) on the path is superseded too, as a regex is.
    delete evidence.regex;
    delete evidence.min;
    delete evidence.max;
    evidence.equals = value;
    covered = true;
  }
  const checks = (evidence.checks ?? []).map((c) => {
    if (!samePath(c.jsonpath, path)) return c;
    covered = true;
    const { regex: _regex, min: _min, max: _max, ...rest } = c;
    return { ...rest, equals: value };
  });
  if (!covered) checks.push({ jsonpath: path, equals: value });
  if (checks.length > 0) evidence.checks = checks;
  return { ...(verification ?? {}), evidence };
}

/**
 * The entry as translate should emit it for this TM, plus one decision per binding a TM row matched.
 * Rows count when their control is one of the entry's control_ids, their path equals the binding's
 * path and their op equals the binding's op, with a numeric value. Several rows: the strictest
 * (lowest for lte, highest for gte).
 */
export function applyOrganisationValues(
  entry: CommandEntry,
  manifest: Pick<ManifestReader, 'getControl'>,
): { entry: CommandEntry; decisions: OrgValueDecision[] } {
  const bindings = entry.org_value_bindings ?? [];
  if (bindings.length === 0 || !entry.set_command.trim()) return { entry, decisions: [] };

  let out: CommandEntry = entry;
  const decisions: OrgValueDecision[] = [];
  for (const b of bindings) {
    if (b.op === 'equals') {
      // W5c7: a string value (the NTP server). The first answered row on the entry's controls; no bound.
      let row: { control_id: string; value: string; source?: string } | undefined;
      for (const cid of entry.control_ids) {
        for (const v of manifest.getControl(cid)?.verification ?? []) {
          const ev = parseExpectedValue((v as { expected_value?: unknown }).expected_value);
          if (row || !ev || !samePath(ev.path, b.tm_path ?? b.path) || ev.op !== 'equals' || ev.source !== 'answered') continue;
          if (typeof ev.value === 'string' && ev.value.trim() !== '') row = { control_id: cid, value: ev.value.trim(), source: ev.source };
        }
      }
      if (!row || typeof b.default !== 'string') continue;
      const unsafe = !SAFE_STRING_VALUE.test(row.value);
      const configured = unsafe ? b.default : row.value;
      const setCommand = rewriteStringToken(out.set_command, b.token, b.default, configured);
      if (setCommand === undefined) continue;
      out = { ...out, set_command: setCommand, verification: assertConfigured(out.verification, b.path, configured) };
      decisions.push({
        path: b.path, token: b.token, op: b.op, control_ids: [row.control_id],
        ...(row.source ? { source: row.source } : {}),
        organisation_value: row.value, registry_value: b.default, configured_value: configured,
        basis: unsafe ? 'registry' : 'organisation',
        ...(unsafe ? { note: ORG_VALUE_UNSAFE_NOTE } : {}),
      });
      continue;
    }
    const registryDefault = Number(b.default);
    const rows: Array<{ control_id: string; value: number; source?: string }> = [];
    for (const cid of entry.control_ids) {
      for (const v of manifest.getControl(cid)?.verification ?? []) {
        const ev = parseExpectedValue((v as { expected_value?: unknown }).expected_value);
        if (!ev || !samePath(ev.path, b.tm_path ?? b.path) || ev.op !== b.op) continue;
        // Orchestrator decision 2026-10-28: only a value the organisation answered may change a command;
        // bank / requirement defaults are provenance-marked fallbacks for verification, not configuration.
        if (ev.source !== 'answered') continue;
        const n = toNumber(ev.value);
        if (n !== undefined) rows.push({ control_id: cid, value: n, ...(ev.source ? { source: ev.source } : {}) });
      }
    }
    if (rows.length === 0) continue;

    const organisation = b.op === 'lte' ? Math.min(...rows.map((r) => r.value)) : Math.max(...rows.map((r) => r.value));
    const weaker = b.op === 'lte' ? organisation > registryDefault : organisation < registryDefault;
    const configured = weaker ? registryDefault : organisation;
    const setCommand = rewriteToken(out.set_command, b.token, registryDefault, configured);
    if (setCommand === undefined) continue; // the registry literal is not in the SET: nothing to configure

    const sources = Array.from(new Set(rows.map((r) => r.source).filter((s): s is string => !!s)));
    out = { ...out, set_command: setCommand, verification: assertConfigured(out.verification, b.path, configured) };
    decisions.push({
      path: b.path,
      token: b.token,
      op: b.op,
      control_ids: Array.from(new Set(rows.map((r) => r.control_id))),
      ...(sources.length > 0 ? { source: sources.join(',') } : {}),
      organisation_value: organisation,
      registry_value: registryDefault,
      configured_value: configured,
      basis: weaker ? 'registry' : 'organisation',
      ...(weaker ? { note: ORG_VALUE_WEAKER_NOTE } : {}),
      ...(b.exists_bound ? { exists_bound: b.exists_bound } : {}),
    });
  }
  return { entry: out, decisions };
}

/** Run 50 fixes: on the exists path a decision marked exists_bound 'registry' is held to the registry default. */
export function existsDecisions(decisions: OrgValueDecision[] | undefined): OrgValueDecision[] | undefined {
  return decisions?.map((d) => (d.exists_bound === 'registry' ? { ...d, configured_value: d.registry_value } : d));
}

/** W5c3: the bound an existing resource must meet on a binding's path: lte = [1, configured]; gte = >= configured. */
export function orgValueBound(d: Pick<OrgValueDecision, 'op' | 'configured_value'>): { min: number; max?: number } {
  const v = Number(d.configured_value);
  return d.op === 'lte' ? { min: 1, max: v } : { min: v };
}

/** W5c7: the numeric decisions (lte / gte); a string decision (equals) keeps its exact rule on every path. */
const bounded = (decisions: OrgValueDecision[]): Array<OrgValueDecision & { op: 'lte' | 'gte' }> =>
  decisions.filter((d): d is OrgValueDecision & { op: 'lte' | 'gte' } => d.op !== 'equals');

/**
 * synthetic-customer W5 cycle 3: the verification for the "already exists" path (the GET found the
 * resource, no SET is sent). Each rule on a decision's path asserts the bound instead of the exact
 * configured value, so a stricter existing policy (5 minutes when the organisation answered 10) is
 * met. The exact rule (`equals: configured`) stays for the read after Stamper's own SET.
 */
export function existingStateCriteria(
  verification: VerificationCriteria | undefined,
  decisions: OrgValueDecision[] | undefined,
): VerificationCriteria | undefined {
  if (!verification?.evidence || !decisions || decisions.length === 0) return verification;
  const evidence = { ...verification.evidence };
  for (const d of bounded(existsDecisions(decisions)!)) {
    const bound = orgValueBound(d);
    if (samePath(evidence.jsonpath, d.path)) {
      delete evidence.equals;
      delete evidence.regex;
      evidence.min = bound.min;
      if (bound.max !== undefined) evidence.max = bound.max; else delete evidence.max;
    }
    if (evidence.checks) {
      evidence.checks = evidence.checks.map((c) => {
        if (!samePath(c.jsonpath, d.path)) return c;
        const { equals: _equals, regex: _regex, max: _max, ...rest } = c;
        return { ...rest, min: bound.min, ...(bound.max !== undefined ? { max: bound.max } : {}) };
      });
    }
  }
  return { ...verification, evidence };
}

/** W5c3: per decision, the value an existing resource's read carries on the path and whether it meets the bound. */
export function checkExistingOrgValues(read: string, decisions: OrgValueDecision[] | undefined): OrgValueCheck[] {
  if (!decisions || decisions.length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(read);
  } catch {
    parsed = undefined;
  }
  const engine = new OutputVerificationEngine();
  return bounded(existsDecisions(decisions)!).map((d) => {
    const bound = orgValueBound(d);
    const raw = parsed === undefined ? undefined : engine.extractJsonPath(parsed, d.path);
    const observed = toNumber(raw) ?? null;
    return {
      path: d.path, token: d.token, op: d.op, configured_value: Number(d.configured_value), bound,
      observed_value: observed,
      within_bound: observed !== null && withinNumericBounds(observed, bound.min, bound.max),
      basis: 'existing' as const,
    };
  });
}

/** W5c3: "passwordMinutes... observed 5, bound [1, 10]" for a rationale. */
export function describeOrgValueCheck(c: OrgValueCheck): string {
  const bound = c.bound.max !== undefined ? `[${c.bound.min}, ${c.bound.max}]` : `>= ${c.bound.min}`;
  return `existing ${c.token} observed ${c.observed_value ?? 'none'}, bound ${bound} (organisation configured ${c.configured_value})`;
}
