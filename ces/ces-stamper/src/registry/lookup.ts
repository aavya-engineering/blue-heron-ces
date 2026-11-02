// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// synthetic-customer W5 cycle 3 (Stamper part 2): the equivalence lookup of a get-then-set entry.
// - lookupGetCommand: the entry's GET, generated from the block: CES's own object by name OR a
//   tenant object whose effect meets every by_effect condition; the name match sorts first; one object.
// - evaluateEffect / matchesByName / selectLookupMatch: the same semantics over parsed JSON, used by the
//   exists path (an equivalent is verified against the block, with org-value bounds) and by the tests.
import type { LookupBlock, LookupCondition, LookupEffect, LookupMatch, OrgValueDecision } from '../types/schema.types.js';
import { OutputVerificationEngine } from '../core/OutputVerificationEngine.js';
import type { VerificationResult } from '../core/OutputVerificationEngine.js';
import { placeholderInRead, placeholderRationale } from '../shared/musterPlaceholders.js';

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** `$.a.b['@odata.type']`-free dot path -> `$_.a.b` (a segment that is not an identifier is quoted). */
export function psPath(path: string): string {
  const parts = path.replace(/^\$\./, '').split('.');
  return '$_' + parts.map(p => (IDENT.test(p) ? `.${p}` : `.'${p.replace(/'/g, "''")}'`)).join('');
}

function psLiteral(v: string | number | boolean): string {
  if (typeof v === 'boolean') return v ? '$true' : '$false';
  if (typeof v === 'number') return String(v);
  return `'${v.replace(/'/g, "''")}'`;
}

const asList = (v: LookupCondition['value']): Array<string | number> =>
  (Array.isArray(v) ? v : v === undefined ? [] : [v as string | number]) as Array<string | number>;

function psCondition(c: LookupCondition): string {
  const p = psPath(c.path);
  const scalar = c.value as string | number | boolean;
  switch (c.op) {
    case 'equals': return `${p} -eq ${psLiteral(scalar)}`;
    case 'not_equals': return `${p} -ne ${psLiteral(scalar)}`;
    case 'in': return `@(${asList(c.value).map(psLiteral).join(',')}) -contains ${p}`;
    case 'contains': return `@(${p}) -contains ${psLiteral(scalar)}`;
    case 'all_in': return `@(${p} | Where-Object { $_ }).Count -gt 0 -and @(${p} | Where-Object { @(${asList(c.value).map(psLiteral).join(',')}) -notcontains $_ }).Count -eq 0`;
    case 'lte': return `$null -ne ${p} -and [double]${p} -le ${Number(c.value)}`;
    case 'gte': return `$null -ne ${p} -and [double]${p} -ge ${Number(c.value)}`;
    case 'not_empty': return `@(${p} | Where-Object { $_ }).Count -gt 0`;
    case 'empty': return `@(${p} | Where-Object { $_ }).Count -eq 0`;
  }
}

function psEffect(e: LookupEffect): string {
  if ('any_of' in e) return `(${e.any_of.map(c => `(${psCondition(c)})`).join(' -or ')})`;
  return `(${psCondition(e)})`;
}

/** The GET an entry with a lookup block carries (registry get_command must equal it). */
const odataTypes = (lookup: LookupBlock): string[] =>
  lookup.odata_type === undefined ? [] : Array.isArray(lookup.odata_type) ? lookup.odata_type : [lookup.odata_type];

export function lookupGetCommand(lookup: LookupBlock): string {
  const name = `${psPath(lookup.by_name.path)} -eq ${psLiteral(lookup.by_name.equals)}`;
  const notName = `${psPath(lookup.by_name.path)} -ne ${psLiteral(lookup.by_name.equals)}`;
  const types = odataTypes(lookup);
  const typeClause = types.length > 0 ? [`(@(${types.map(psLiteral).join(',')}) -contains $_.'@odata.type')`] : [];
  const effect = [...typeClause, ...lookup.by_effect.map(psEffect)].join(' -and ');
  return `${lookup.source} | Where-Object { (${name}) -or (${effect}) } | Sort-Object { ${notName} } | Select-Object -First 1 | ConvertTo-Json -Depth 10`;
}

// ---- the same semantics over parsed JSON ----

const engine = new OutputVerificationEngine();
const valueAt = (obj: unknown, path: string): unknown => engine.extractJsonPath(obj, path);
const eq = (a: unknown, b: unknown): boolean =>
  a !== undefined && a !== null && typeof a !== 'object' && String(a).toLowerCase() === String(b).toLowerCase();
const truthy = (x: unknown): boolean => x !== undefined && x !== null && x !== false && x !== 0 && x !== '';
const toArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
const toNum = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);

export type Resolve = (s: string) => string;
const identity: Resolve = s => s;

function resolveValue(v: LookupCondition['value'], resolve: Resolve): LookupCondition['value'] {
  if (typeof v === 'string') return resolve(v);
  if (Array.isArray(v)) return v.map(x => (typeof x === 'string' ? resolve(x) : x));
  return v;
}

/** One condition on one object (value placeholders resolved by `resolve`). */
export function evaluateCondition(obj: unknown, c: LookupCondition, resolve: Resolve = identity): boolean {
  const actual = valueAt(obj, c.path);
  const value = resolveValue(c.value, resolve);
  switch (c.op) {
    case 'equals': return eq(actual, value);
    case 'not_equals': return !eq(actual, value);
    case 'in': return asList(value).some(x => eq(actual, x));
    case 'contains': return toArray(actual).some(x => eq(x, value));
    case 'all_in': {
      const items = toArray(actual).filter(truthy);
      return items.length > 0 && items.every(x => asList(value).some(y => eq(x, y)));
    }
    case 'lte': { const n = toNum(actual); return actual !== null && actual !== undefined && Number.isFinite(n) && n <= Number(value); }
    case 'gte': { const n = toNum(actual); return actual !== null && actual !== undefined && Number.isFinite(n) && n >= Number(value); }
    case 'not_empty': return toArray(actual).filter(truthy).length > 0;
    case 'empty': return toArray(actual).filter(truthy).length === 0;
  }
}

export function matchesByName(obj: unknown, lookup: LookupBlock, resolve: Resolve = identity): boolean {
  // W5c5: a name may carry a registry variable ('Admin-{adminUserName}', '{keyVaultName}').
  return eq(valueAt(obj, lookup.by_name.path), resolve(lookup.by_name.equals));
}

/** Every by_effect condition on one object, with what was read. */
export function evaluateEffect(obj: unknown, lookup: LookupBlock, resolve: Resolve = identity): NonNullable<LookupMatch['conditions']> {
  const out: NonNullable<LookupMatch['conditions']> = [];
  const types = odataTypes(lookup);
  if (types.length > 0) {
    const t = obj && typeof obj === 'object' ? (obj as Record<string, unknown>)['@odata.type'] : undefined;
    out.push({ path: '@odata.type', op: 'in', expected: types, observed: t ?? null, pass: typeof t === 'string' && types.includes(t) });
  }
  for (const e of lookup.by_effect) {
    if ('any_of' in e) {
      const pass = e.any_of.some(c => evaluateCondition(obj, c, resolve));
      out.push({
        path: e.any_of.map(c => c.path).join(' | '), op: 'any_of',
        expected: e.any_of.map(c => ({ path: c.path, op: c.op, value: resolveValue(c.value, resolve) })),
        observed: e.any_of.map(c => valueAt(obj, c.path) ?? null), pass,
      });
    } else {
      out.push({ path: e.path, op: e.op, expected: resolveValue(e.value, resolve), observed: valueAt(obj, e.path) ?? null, pass: evaluateCondition(obj, e, resolve) });
    }
  }
  return out;
}

/** What the generated GET selects from a list: the name match first, else the first effect match. */
export function selectLookupMatch<T>(objects: T[], lookup: LookupBlock, resolve: Resolve = identity): T | undefined {
  return objects.find(o => matchesByName(o, lookup, resolve))
    ?? objects.find(o => evaluateEffect(o, lookup, resolve).every(c => c.pass));
}

/** The by_effect conditions with each org-value bound applied: a condition on a bound path reads [1, configured] (lte) or >= configured (gte). */
export function boundEffect(lookup: LookupBlock, decisions: OrgValueDecision[] | undefined): LookupBlock {
  if (!decisions || decisions.length === 0) return lookup;
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const by_effect = lookup.by_effect.map((e): LookupEffect => {
    if ('any_of' in e) return e;
    const d = decisions.find(x => same(x.path, e.path) && x.op === e.op);
    if (d?.exists_bound === 'registry') return e; // Run 50 fixes: held to the registry value (already in the block)
    return d ? { ...e, value: d.configured_value } : e;
  });
  return { ...lookup, by_effect };
}

const objectName = (obj: unknown, lookup: LookupBlock): string => {
  const v = valueAt(obj, lookup.by_name.path) ?? valueAt(obj, '$.id');
  return v === undefined || v === null ? '(unnamed)' : String(v);
};

/**
 * The exists-path check of a tenant equivalent (the GET found an object that is not CES's by-name
 * object): every by_effect condition, with the org-value bounds applied. Returns undefined when the read is CES's own object (the entry's own
 * verification applies, as before) or is not one JSON object.
 */
export function verifyEquivalent(
  read: string,
  lookup: LookupBlock,
  decisions: OrgValueDecision[] | undefined,
  resolve: Resolve = identity,
  placeholderIgnore: readonly string[] = [],
): { verification: VerificationResult; match: LookupMatch } | undefined {
  let parsed: unknown;
  try { parsed = JSON.parse(read); } catch { return undefined; }
  const obj = Array.isArray(parsed) ? (parsed.length === 1 ? parsed[0] : undefined) : parsed;
  if (obj === undefined || obj === null || typeof obj !== 'object') return undefined;
  if (matchesByName(obj, lookup, resolve)) return undefined;

  const conditions = evaluateEffect(obj, boundEffect(lookup, decisions), resolve);
  const failed = conditions.filter(c => !c.pass);
  const name = objectName(obj, lookup);
  // PL-121 (founder ruling 2026-11-01): an equivalent built from an unanswered Muster placeholder never counts.
  const placeholder = placeholderInRead(read, placeholderIgnore);
  const passed = failed.length === 0 && placeholder === undefined;
  const reason = placeholder !== undefined
    ? `existing equivalent '${name}': ${placeholderRationale(placeholder)}`
    : passed
    ? `existing equivalent '${name}' verified by effect (${conditions.length} conditions)`
    : `existing equivalent '${name}' does not meet ${failed.map(c => `${c.path} ${c.op} ${JSON.stringify(c.expected)} (observed ${JSON.stringify(c.observed)})`).join('; ')}`;
  return {
    verification: {
      passed,
      confidence: passed ? 'HIGH' : 'FAILED',
      score: passed ? 100 : 25, // the engine's score for exit 0 + a failed evidence check
      details: { exit_code_check: true, set_output_check: null, evidence_check: passed },
      reason,
      ...(placeholder !== undefined ? { placeholder } : {}),
    },
    match: { basis: 'effect', object: name, conditions },
  };
}
