// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * Synthetic-customer W1 (PLAN §2.3): the E6 overrides step, now conditional, and the per-run `initialPassword`.
 *
 * Mirrors the run package's `scripts/overrides-gate.mjs` (same twelve keys, same presence rule, same log format), so
 * `verify.mjs` V54 reads `logs/E6-overrides.json` the same way from either harness.
 * - All twelve keys present in the pushed TM `tenant_identity`: the overrides file is not read ("overrides: not needed").
 * - Any missing: E6 fails with the sorted list, unless `MX_ALLOW_OVERRIDES=1` (transition aid: the missing keys are merged
 *   from the overrides file into the plan's variables, never `initialPassword`).
 * Gap closure FLOW-5 (a): the e2e run no longer mints `initialPassword` (muster-api issues it as a secret reference that
 * Stamper resolves), so no key is harness-generated. `mintInitialPassword` / `withInitialPassword` stay for the watched
 * UI run (ui-e2e-run.ts, step EU), which still hands the Stamper GUI server its own per-run value.
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** PLAN §2.3: the twelve keys Muster supplies after W1. Keep equal to the package's overrides-gate.mjs. */
export const TENANT_IDENTITY_KEYS = [
  'operatorUPN', 'breakGlassUPN', 'breakGlassUserId', 'subscriptionId', 'baselineTemplateId',
  'complianceRoleId', 'roleDefId',
  'approverUPN', 'adminUserName', 'approvedIpRange', 'touFileName', 'touFileBase64',
] as const;
/** FLOW-5 (a): none since muster-api issues initialPassword (was ['initialPassword']). Keep equal to overrides-gate.mjs. */
export const HARNESS_GENERATED_KEYS: readonly string[] = [];
export const OVERRIDES_NOT_NEEDED_LINE = 'overrides: not needed';
export const E6_OVERRIDES_SCHEMA = 'ces-muster-run/e6-overrides@2';
/** The Stamper child-env variable that carries the minted value. */
export const INITIAL_PASSWORD_ENV = 'STAMPER_INITIAL_PASSWORD';
const SIM_ONLY_SCOPE = 'simulator only; never load against a live tenant';

const TOKEN = /^\{[A-Za-z][A-Za-z0-9_]*\}$/;
/** Present = a non-empty scalar that is not an unresolved `{name}` token. */
export function isPresent(v: unknown): boolean {
  if (typeof v === 'number' || typeof v === 'boolean') return true;
  return typeof v === 'string' && v.trim() !== '' && !TOKEN.test(v.trim());
}

export function missingTenantIdentityKeys(tenantIdentity: Record<string, unknown> | null | undefined): string[] {
  return TENANT_IDENTITY_KEYS.filter((k) => !isPresent(tenantIdentity?.[k])).sort();
}

export type OverridesMode = 'not-needed' | 'refused' | 'transition';
export function decideOverrides(tenantIdentity: Record<string, unknown> | null | undefined, allowOverrides: boolean): { mode: OverridesMode; missing: string[] } {
  const missing = missingTenantIdentityKeys(tenantIdentity);
  if (missing.length === 0) return { mode: 'not-needed', missing };
  return { mode: allowOverrides ? 'transition' : 'refused', missing };
}

export interface OverridesLog {
  schema: typeof E6_OVERRIDES_SCHEMA;
  mode: OverridesMode;
  keys_checked: string[];
  missing: string[];
  applied: string[];
  overrides_consulted: boolean;
  overrides_file: string | null;
  mx_allow_overrides: boolean;
  harness_generated: string[];
}

export interface OverridesGateResult {
  rc: number;
  line: string;
  log: OverridesLog;
}

const readJson = (p: string): any => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));

/**
 * The gate. Reads the pushed TM; in transition mode only, reads the overrides file and rewrites the plan. Writes
 * `<logsDir>/E6-overrides.json` and `<logsDir>/E6-overrides.out` (key names only, never values).
 */
export function runOverridesGate(opts: { planPath: string; tmPath: string; overridesPath: string; logsDir: string; allowOverrides: boolean }): OverridesGateResult {
  const tm = readJson(opts.tmPath);
  const ti = (tm?.tenant_manifest ?? tm)?.tenant_identity ?? {};
  const d = decideOverrides(ti, opts.allowOverrides);
  const log: OverridesLog = {
    schema: E6_OVERRIDES_SCHEMA, mode: d.mode, keys_checked: [...TENANT_IDENTITY_KEYS], missing: d.missing, applied: [],
    overrides_consulted: false, overrides_file: null, mx_allow_overrides: opts.allowOverrides, harness_generated: [...HARNESS_GENERATED_KEYS],
  };
  let line: string;
  let rc = 0;
  if (d.mode === 'not-needed') line = OVERRIDES_NOT_NEEDED_LINE;
  else if (d.mode === 'refused') {
    line = `overrides: REFUSED: the pushed Tenant Manifest tenant_identity lacks ${d.missing.length} of ${TENANT_IDENTITY_KEYS.length} keys: ${d.missing.join(', ')} (set MX_ALLOW_OVERRIDES=1 only as a transition aid)`;
    rc = 4;
  } else if (!fs.existsSync(opts.overridesPath)) {
    line = `overrides: REFUSED: MX_ALLOW_OVERRIDES=1 but no overrides file; missing: ${d.missing.join(', ')}`;
    rc = 4;
  } else {
    const ov = readJson(opts.overridesPath);
    if (ov._scope !== SIM_ONLY_SCOPE) {
      line = 'overrides: REFUSED: the overrides file is not marked simulator-only';
      rc = 3;
    } else {
      const plan = readJson(opts.planPath);
      plan.variables ??= {};
      for (const k of d.missing) {
        if ((HARNESS_GENERATED_KEYS as readonly string[]).includes(k)) continue;
        const v = ov.variables?.[k];
        if (v === undefined || isPresent(plan.variables[k])) continue;
        plan.variables[k] = v;
        log.applied.push(k);
      }
      fs.writeFileSync(opts.planPath, JSON.stringify(plan, null, 2) + '\n');
      log.overrides_consulted = true;
      log.overrides_file = path.basename(opts.overridesPath);
      line = `overrides: TRANSITION (MX_ALLOW_OVERRIDES=1): applied ${log.applied.length} of ${d.missing.length} missing keys from ${log.overrides_file}: ${log.applied.join(', ')}`;
    }
  }
  fs.writeFileSync(path.join(opts.logsDir, 'E6-overrides.json'), JSON.stringify(log, null, 2) + '\n');
  fs.writeFileSync(path.join(opts.logsDir, 'E6-overrides.out'), line + '\n');
  return { rc, line, log };
}

/** 24 characters over A-Z a-z 0-9 and `-_.`, at least one of each class (CSPRNG). Safe inside `Password='...'`. */
export const PASSWORD_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.';
export function mintInitialPassword(length = 24): string {
  for (;;) {
    let pw = '';
    for (let i = 0; i < length; i++) pw += PASSWORD_ALPHABET[crypto.randomInt(PASSWORD_ALPHABET.length)];
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw) && /[0-9]/.test(pw) && /[-_.]/.test(pw)) return pw;
  }
}

/** The Stamper child env: the sim env plus the per-run password. Only the Stamper launches get this. */
export function withInitialPassword(env: NodeJS.ProcessEnv, password: string): NodeJS.ProcessEnv {
  return { ...env, [INITIAL_PASSWORD_ENV]: password };
}
