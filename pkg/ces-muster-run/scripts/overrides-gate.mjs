// overrides-gate.mjs (Blue Heron Defense, CES team). Synthetic-customer W1: the E6 overrides step, now conditional.
//   node overrides-gate.mjs --plan <executable-plan.json> --tm <pushed tenant-manifest.json> --overrides <sim-overrides.json> --out <log.json>
// Muster supplies the twelve operator keys in the Tenant Manifest's `tenant_identity` (camelCase), each with a provenance.
// - All twelve present: the overrides file is NOT read. Prints "overrides: not needed"; log mode "not-needed"; exit 0.
// - Any missing: prints "overrides: REFUSED ..." with the sorted list; log mode "refused"; exit 4. The run fails, so a
//   regression back to overrides is loud.
// - Missing and env MX_ALLOW_OVERRIDES=1 (transition aid only): the missing keys are merged from the overrides file into the
//   plan's `variables` (only where the plan has no value), never `initialPassword` (the harness mints it per run into the
//   Stamper environment). Log mode "transition"; exit 0.
// The key list and the presence rule are exported for verify.mjs (V54). ces-tester mirrors them in src/flow/overrides-gate.ts;
// the log format is the same from both harnesses. The log carries key names only, never values.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** PLAN §2.3: the twelve keys Muster supplies after W1 (discovered, derived or answered). */
export const TENANT_IDENTITY_KEYS = [
  'operatorUPN', 'breakGlassUPN', 'breakGlassUserId', 'subscriptionId', 'baselineTemplateId',
  'complianceRoleId', 'roleDefId',
  'approverUPN', 'adminUserName', 'approvedIpRange', 'touFileName', 'touFileBase64',
];
/** Gap closure FLOW-5 (a): no key is harness-generated any more (was ['initialPassword']; muster-api now issues it as a
 *  secret reference that Stamper resolves). ces-tester src/flow/overrides-gate.ts mirrors this. */
export const HARNESS_GENERATED_KEYS = [];
export const ALLOWED_PROVENANCE = ['discovered', 'derived', 'answered', 'asked']; // Muster writes an answered value's provenance as 'asked' (LOG-W1-muster.md)
export const OVERRIDES_NOT_NEEDED_LINE = 'overrides: not needed';
export const E6_OVERRIDES_SCHEMA = 'ces-muster-run/e6-overrides@2';

const TOKEN = /^\{[A-Za-z][A-Za-z0-9_]*\}$/;
/** Present = a non-empty scalar that is not an unresolved `{name}` token. */
export function isPresent(v) {
  if (typeof v === 'number' || typeof v === 'boolean') return true;
  return typeof v === 'string' && v.trim() !== '' && !TOKEN.test(v.trim());
}
/** The TM body (`tenant_manifest` inside the MG-12 envelope, or the bare manifest). */
export function tmBody(tm) { return tm?.tenant_manifest ?? tm ?? null; }
export function missingTenantIdentityKeys(tenantIdentity) {
  return TENANT_IDENTITY_KEYS.filter((k) => !isPresent(tenantIdentity?.[k])).sort();
}

/**
 * Where a key's provenance is read, in order (assumption until docs/context/synthetic-customer/LOG-W1-muster.md names the
 * place): the TM's `tenant_identity.operator_value_provenance.values` map (the shape the runner writes today), then a
 * `tenant_identity.provenance` map, then a `provenance` / `operator_value_provenance.values` map in the pushed TCP and SI
 * bodies. A value is a string or an object with `provenance`.
 */
export function provenanceFor(key, { tm, tcp, si } = {}) {
  const ti = tmBody(tm)?.tenant_identity ?? {};
  const tcpB = tcp?.artifact ?? tcp?.tenant_config ?? tcp ?? {};
  const siB = si?.artifact ?? si?.si_baseline ?? si ?? {};
  const maps = [
    ti.operator_value_provenance?.values, ti.provenance,
    tcpB.operator_value_provenance?.values, tcpB.provenance,
    siB.operator_value_provenance?.values, siB.provenance,
  ];
  for (const m of maps) {
    const v = m?.[key];
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object' && typeof v.provenance === 'string') return v.provenance;
  }
  return null;
}

/** The decision, without I/O. */
export function decideOverrides(tenantIdentity, allowOverrides) {
  const missing = missingTenantIdentityKeys(tenantIdentity);
  if (missing.length === 0) return { mode: 'not-needed', missing };
  return { mode: allowOverrides ? 'transition' : 'refused', missing };
}

function main() {
  const a = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, arr) => (v.startsWith('--') ? [...acc, [v.slice(2), arr[i + 1]]] : acc), []));
  if (!a.plan || !a.tm) { console.error('usage: --plan <file> --tm <file> [--overrides <file>] [--out <log>]'); process.exit(2); }
  const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));
  const ti = tmBody(readJson(a.tm))?.tenant_identity ?? {};
  const allow = process.env.MX_ALLOW_OVERRIDES === '1';
  const d = decideOverrides(ti, allow);
  const log = {
    schema: E6_OVERRIDES_SCHEMA, mode: d.mode, keys_checked: TENANT_IDENTITY_KEYS, missing: d.missing, applied: [],
    overrides_consulted: false, overrides_file: null, mx_allow_overrides: allow, harness_generated: HARNESS_GENERATED_KEYS,
  };
  let line; let rc = 0;
  if (d.mode === 'not-needed') line = OVERRIDES_NOT_NEEDED_LINE;
  else if (d.mode === 'refused') {
    line = `overrides: REFUSED: the pushed Tenant Manifest tenant_identity lacks ${d.missing.length} of ${TENANT_IDENTITY_KEYS.length} keys: ${d.missing.join(', ')} (set MX_ALLOW_OVERRIDES=1 only as a transition aid)`;
    rc = 4;
  } else {
    if (!a.overrides || !fs.existsSync(a.overrides)) { line = `overrides: REFUSED: MX_ALLOW_OVERRIDES=1 but no overrides file; missing: ${d.missing.join(', ')}`; rc = 4; }
    else {
      const ov = readJson(a.overrides);
      if (ov._scope !== 'simulator only; never load against a live tenant') { line = 'overrides: REFUSED: the overrides file is not marked simulator-only'; rc = 3; }
      else {
      const plan = readJson(a.plan);
      plan.variables ??= {};
      for (const k of d.missing) {
        if (HARNESS_GENERATED_KEYS.includes(k)) continue;
        const v = ov.variables?.[k];
        if (v === undefined || isPresent(plan.variables[k])) continue;
        plan.variables[k] = v;
        log.applied.push(k);
      }
      fs.writeFileSync(a.plan, JSON.stringify(plan, null, 2) + '\n');
      log.overrides_consulted = true;
      log.overrides_file = path.basename(a.overrides);
      line = `overrides: TRANSITION (MX_ALLOW_OVERRIDES=1): applied ${log.applied.length} of ${d.missing.length} missing keys from ${log.overrides_file}: ${log.applied.join(', ')}`;
      }
    }
  }
  if (a.out) fs.writeFileSync(a.out, JSON.stringify(log, null, 2) + '\n');
  if (rc === 0) console.log(line); else { console.log(line); console.error(line); }
  process.exit(rc);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
