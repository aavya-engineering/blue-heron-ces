// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// discoveryLookup.ts — synthetic-customer W5c4: discovery verdicts from the
// Stamper registry's equivalence `lookup` block (ces-stamper
// src/registry/lookup.ts; LOG-W5c3-stamper2.md §2). Read AS DATA: Muster never
// imports Stamper code (tool boundary), so the eight ops and `any_of` are
// re-implemented here with the same semantics.
//
// The walk reads the block's `source` (the candidate list), not the generated
// get_command: that GET keeps at most one object (CES's by name, or the first
// equivalent), so "objects exist but none is equivalent" would look the same
// as "no objects". Over the list:
//   - any object meets every by_effect condition          -> met
//   - objects exist and every one fails a condition        -> not_met
//   - the read is empty, not JSON, or the only objects that do not fail
//     depend on an unresolved {variable}                   -> unknown
// The by-name clause plays no part: CES's own object must meet the same effect
// (Stamper pins that in its tests), and before Stamper runs it does not exist.
//
// Values may carry registry `{variables}` (cuiGroupId, wifiSsid,
// phishingResistantStrengthId), filled from discoveryVariables.ts. A condition
// whose value is still a placeholder is undecidable (never false), so a missing
// variable can never produce not_met.
//
// Answered bounds: where the entry carries an `org_value_bindings` row on the
// same path and op as a condition and the organisation answered a value for
// that binding's TM path (`tm_path`, else `path`; ANSWER_BOUND_QUESTIONS), the
// condition takes the answer, never weaker than the registry bound (lte: the
// smaller; gte: the larger). A binding with `exists_bound: 'registry'` keeps the
// registry bound, because discovery judges existing objects (Stamper's exists
// path). This is Stamper's boundEffect over the W5c2 "never weaken" rule.
//
// W5c5: op `empty` (absent, null or no truthy item) and the block field
// `odata_type` (the object's exact `@odata.type` is one of the listed types)
// follow Stamper's lookup.ts.

export type LookupOp =
  | 'equals'
  | 'not_equals'
  | 'in'
  | 'contains'
  | 'all_in'
  | 'lte'
  | 'gte'
  | 'not_empty'
  | 'empty'
  /**
   * W5c7, discovery-only (never in the registry): the value is an NTP server
   * list (`host[,0xN]`, space separated); the object's list names the same
   * hosts, case-insensitive, with the ,0xN flags ignored. Added by
   * boundLookupEffect for an answered `equals` binding ($.timeServer).
   */
  | 'servers_equal';
type Scalar = string | number | boolean;

export interface LookupCondition {
  path: string;
  op: LookupOp;
  value?: Scalar | Scalar[];
}
export type LookupEffect = LookupCondition | { any_of: LookupCondition[] };

export interface LookupBlock {
  source: string;
  by_name: { path: string; equals: string };
  by_effect: LookupEffect[];
  /**
   * W5c5 (Stamper "Run 50 fixes"): the object's `@odata.type`, one or a list.
   * Stamper tests it as an extra condition before by_effect: the object's
   * exact `@odata.type` key must be one of these strings (case-sensitive, as
   * Stamper's lookup.ts `types.includes(t)`).
   */
  odata_type?: string | string[];
}

export interface OrgValueBinding {
  path: string;
  op: string;
  default?: unknown;
  /** W5c5: the TM / answered path when it differs from the read path. */
  tm_path?: string;
  /** W5c5: 'registry' = on an existing object the registry bound holds (no answered value). */
  exists_bound?: string;
}

/** Answered bound per dot path (lower-cased), e.g. screen-lock minutes. */
/** Answered bound per dot path (lower-cased): a number (lte / gte bindings) or, W5c7, a string (an equals binding). */
export type AnswerBounds = Record<string, number | string>;

/** W5c7: a plain NTP server list, as Stamper's binding guard accepts (`host[,0xN]`, space separated). */
export const PLAIN_SERVER_LIST = /^[A-Za-z0-9.-]+(,0x[0-9A-Fa-f]+)?( [A-Za-z0-9.-]+(,0x[0-9A-Fa-f]+)?)*$/;
const serverHosts = (v: unknown): string[] =>
  typeof v === 'string'
    ? v.trim().split(/\s+/).filter(Boolean).map((x) => x.split(',')[0].toLowerCase()).sort()
    : [];

type Tri = boolean | null;
const PLACEHOLDER = /\{[A-Za-z][A-Za-z0-9]*\}/;

/** The read discovery runs for a lookup entry: the candidate list as JSON. */
export function lookupSourceCommand(lookup: LookupBlock): string {
  return `${lookup.source} | ConvertTo-Json -Depth 10`;
}

function valueAt(obj: unknown, dotted: string): unknown {
  let cur: unknown = obj;
  for (const seg of dotted.replace(/^\$\.?/, '').split('.').filter(Boolean)) {
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return undefined;
    const key = Object.keys(cur as Record<string, unknown>).find((k) => k.toLowerCase() === seg.toLowerCase());
    if (key === undefined) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

const eq = (a: unknown, b: unknown): boolean =>
  a !== undefined && a !== null && typeof a !== 'object' && String(a).toLowerCase() === String(b).toLowerCase();
const truthy = (x: unknown): boolean => x !== undefined && x !== null && x !== false && x !== 0 && x !== '';
const toArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
const toNum = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);

function fill(v: Scalar, variables: Record<string, string>): { value: Scalar; resolved: boolean } {
  if (typeof v !== 'string') return { value: v, resolved: true };
  const out = v.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(variables, name) && variables[name] !== '' ? variables[name] : whole
  );
  return { value: out, resolved: !PLACEHOLDER.test(out) };
}

/** One condition on one object: true / false, or null when it depends on an unresolved variable. */
export function evaluateLookupCondition(obj: unknown, c: LookupCondition, variables: Record<string, string> = {}): Tri {
  const actual = valueAt(obj, c.path);
  const list = (Array.isArray(c.value) ? c.value : c.value === undefined ? [] : [c.value]).map((x) => fill(x, variables));
  const resolved = list.filter((x) => x.resolved).map((x) => x.value);
  const anyUnresolved = list.some((x) => !x.resolved);
  switch (c.op) {
    case 'equals':
    case 'not_equals': {
      if (anyUnresolved) return null;
      const same = eq(actual, resolved[0]);
      return c.op === 'equals' ? same : !same;
    }
    case 'in':
      if (resolved.some((x) => eq(actual, x))) return true;
      return anyUnresolved ? null : false;
    case 'contains':
      if (anyUnresolved) return null;
      return toArray(actual).some((x) => eq(x, resolved[0]));
    case 'all_in': {
      const items = toArray(actual).filter(truthy);
      if (items.length === 0) return false;
      if (items.every((x) => resolved.some((y) => eq(x, y)))) return true;
      return anyUnresolved ? null : false;
    }
    case 'lte':
    case 'gte': {
      if (anyUnresolved) return null;
      const n = toNum(actual);
      if (actual === null || actual === undefined || !Number.isFinite(n)) return false;
      const bound = Number(resolved[0]);
      return c.op === 'lte' ? n <= bound : n >= bound;
    }
    case 'not_empty':
      return toArray(actual).filter(truthy).length > 0;
    case 'empty':
      return toArray(actual).filter(truthy).length === 0;
    case 'servers_equal': {
      if (anyUnresolved) return null;
      const want = serverHosts(resolved[0]);
      const have = serverHosts(actual);
      return have.length > 0 && have.length === want.length && have.every((h, i) => h === want[i]);
    }
  }
}

/** W5c5: the block's `@odata.type` condition (absent block field: no condition). */
export function odataTypeCondition(obj: unknown, lookup: Pick<LookupBlock, 'odata_type'>): boolean | undefined {
  const types = lookup.odata_type === undefined ? [] : Array.isArray(lookup.odata_type) ? lookup.odata_type : [lookup.odata_type];
  if (types.length === 0) return undefined;
  const t = obj && typeof obj === 'object' ? (obj as Record<string, unknown>)['@odata.type'] : undefined;
  return typeof t === 'string' && types.includes(t);
}

function and(parts: Tri[]): Tri {
  if (parts.some((p) => p === false)) return false;
  if (parts.some((p) => p === null)) return null;
  return true;
}

/** Every by_effect item on one object (all must hold; any_of holds when one of its conditions does). */
export function evaluateLookupEffect(obj: unknown, effect: LookupEffect[], variables: Record<string, string> = {}): Tri {
  return and(
    effect.map((e): Tri => {
      if (!('any_of' in e)) return evaluateLookupCondition(obj, e, variables);
      const parts = e.any_of.map((c) => evaluateLookupCondition(obj, c, variables));
      if (parts.some((p) => p === true)) return true;
      return parts.some((p) => p === null) ? null : false;
    })
  );
}

/**
 * The by_effect conditions with the answered bounds applied: only on a path
 * and op the entry's org_value_bindings name, and never weaker than the
 * registry's own bound.
 */
export function boundLookupEffect(
  lookup: LookupBlock,
  bindings: OrgValueBinding[] | undefined,
  bounds: AnswerBounds | undefined
): LookupEffect[] {
  if (!bindings || bindings.length === 0 || !bounds) return lookup.by_effect;
  const key = (p: string) => p.trim().toLowerCase();
  const effect = lookup.by_effect.map((e): LookupEffect => {
    if ('any_of' in e || (e.op !== 'lte' && e.op !== 'gte')) return e;
    const binding = bindings.find((b) => key(b.path) === key(e.path) && b.op === e.op);
    // W5c5: discovery reads an existing object, so an exists_bound 'registry' binding keeps the registry value (Stamper boundEffect).
    if (!binding || binding.exists_bound === 'registry') return e;
    const answered = bounds[key(binding.tm_path ?? binding.path)];
    const registry = Number(e.value);
    if (typeof answered !== 'number' || !Number.isFinite(answered) || !Number.isFinite(registry)) return e;
    return { ...e, value: e.op === 'lte' ? Math.min(registry, answered) : Math.max(registry, answered) };
  });
  // W5c7: an `equals` binding with an answered plain server list (the time-sync
  // entry's $.timeServer, PI.ODP.016) adds the condition that the object's servers
  // are the organisation's. Stricter than Stamper's exists path, which accepts any
  // server on a customer equivalent (LOG-W5c7-stamper.md §2.2): discovery asks
  // whether the tenant meets the organisation's stated parameter.
  for (const b of bindings) {
    if (b.op !== 'equals' || b.exists_bound === 'registry') continue;
    const answered = bounds[key(b.tm_path ?? b.path)];
    if (typeof answered === 'string' && PLAIN_SERVER_LIST.test(answered.trim())) {
      effect.push({ path: b.path, op: 'servers_equal', value: answered.trim() });
    }
  }
  return effect;
}

/** The candidate objects in a source read (ConvertTo-Json gives an object for one item, an array for several). */
export function lookupCandidates(stdout: string): unknown[] | null {
  const text = stdout.trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) return parsed.filter((x) => x && typeof x === 'object');
    return parsed && typeof parsed === 'object' ? [parsed] : null;
  } catch {
    return null;
  }
}

/** met / not_met / unknown over the source read (see the header). */
export function lookupVerdict(
  lookup: LookupBlock,
  stdout: string,
  ctx: { variables?: Record<string, string>; bindings?: OrgValueBinding[]; bounds?: AnswerBounds } = {}
): 'met' | 'not_met' | 'unknown' {
  const objects = lookupCandidates(stdout);
  if (!objects || objects.length === 0) return 'unknown';
  const effect = boundLookupEffect(lookup, ctx.bindings, ctx.bounds);
  const results = objects.map((o): Tri =>
    odataTypeCondition(o, lookup) === false ? false : evaluateLookupEffect(o, effect, ctx.variables ?? {})
  );
  if (results.some((r) => r === true)) return 'met';
  return results.every((r) => r === false) ? 'not_met' : 'unknown';
}

// ── W5c6: cross-entry captures (Exchange policy / rule pairs) ────────────────
// A policy entry captures the found policy's name (registry `captures`
// json_field, e.g. safeLinksPolicyName <- $.Name); its rule entry's block
// names `{safeLinksPolicyName}`. Discovery reproduces that within one walk: the
// policy's verdict object (the equivalent it met on) supplies the captured
// value, and the rule is judged after it with that value filled.

export interface RegistryCapture {
  variable: string;
  from: string;
  json_path?: string;
}

/**
 * The object a met lookup selects, as Stamper's selectLookupMatch does among
 * the objects that meet the effect: CES's own by name first (by_name resolved
 * with the variables), else the first. undefined when none meets the effect.
 */
export function lookupMatchObject(
  lookup: LookupBlock,
  stdout: string,
  ctx: { variables?: Record<string, string>; bindings?: OrgValueBinding[]; bounds?: AnswerBounds } = {}
): unknown {
  const objects = lookupCandidates(stdout) ?? [];
  const effect = boundLookupEffect(lookup, ctx.bindings, ctx.bounds);
  const vars = ctx.variables ?? {};
  const meeting = objects.filter(
    (o) => odataTypeCondition(o, lookup) !== false && evaluateLookupEffect(o, effect, vars) === true
  );
  const name = fill(lookup.by_name.equals, vars).value;
  return meeting.find((o) => eq(valueAt(o, lookup.by_name.path), name)) ?? meeting[0];
}

/** The json_field captures read off a matched object (values that are non-empty strings or numbers). */
export function capturedValues(obj: unknown, captures: RegistryCapture[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of captures ?? []) {
    if (c.from !== 'json_field' || !c.json_path) continue;
    const v = valueAt(obj, c.json_path);
    if ((typeof v === 'string' && v.trim() !== '') || typeof v === 'number') out[c.variable] = String(v);
  }
  return out;
}

/** The `{variables}` a block's condition values name (not its source or by_name). */
export function lookupValueVariables(lookup: LookupBlock): string[] {
  const names = new Set<string>();
  for (const m of JSON.stringify(lookup.by_effect).matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)) names.add(m[1]);
  return [...names];
}
