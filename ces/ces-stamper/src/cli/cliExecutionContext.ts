// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FX-02: the command-line execute paths build the same inputs the server execute route
 * builds (`src/server/routes/execute.routes.ts`): a tenant slug and, for a live run, an
 * ExecutionContext loaded with the client config and the plan variables merged over
 * VARIABLE_DEFAULTS. With a context, required placeholders are checked, captures reach
 * later sub-commands, and evidence goes to the tenant folder.
 */
import * as fs from 'fs';
import { ExecutionContext } from '../core/ExecutionContext.js';
import { resolveResultsTenantSlug } from '../core/ExecutionResultsPublisher.js';
import { loadClientConfigFromTenantJson, resolveTenantJsonPath } from '../config/ClientConfig.js';
import { VARIABLE_DEFAULTS } from '../shared/variable-map.js';
import { secretSentinel, isSecretSentinel } from '../core/secretSentinel.js';
import { gateResultControls } from '../core/gateCredit.js';
import type { ResultsPlanTask } from '../core/ExecutionResultsPublisher.js';

/**
 * W1: the allow-list of secret-class manifest variables the command line may take from the
 * process environment, and the variable each one is read from. Every key is in ces-shared's
 * SECRET_VARIABLE_NAMES. Only these names; any other unresolved variable still stops its task.
 */
export const ENV_SECRET_VARIABLES: Readonly<Record<string, string>> = {
  initialPassword: 'STAMPER_INITIAL_PASSWORD',
};

export interface EnvSecretResolution {
  /** variable -> sentinel, for the ExecutionContext (what every logged/persisted command carries). */
  contextVars: Record<string, string>;
  /** variable -> value, for the in-memory secret overlay only. */
  overlay: Record<string, string>;
}

/**
 * W1: for each allow-listed variable that the plan leaves unresolved (absent, empty, or a
 * sentinel) and whose environment variable is set and non-empty, return the sentinel for the
 * context and the value for the overlay. No environment value means no entry (no default).
 */
export function resolveEnvSecrets(
  planVariables: Record<string, unknown> | undefined,
  env: Record<string, string | undefined>,
): EnvSecretResolution {
  const contextVars: Record<string, string> = {};
  const overlay: Record<string, string> = {};
  for (const [name, envName] of Object.entries(ENV_SECRET_VARIABLES)) {
    const planValue = planVariables?.[name];
    const unresolved = planValue === undefined || planValue === null || planValue === '' || isSecretSentinel(planValue);
    const value = env[envName];
    if (!unresolved || !value) continue;
    contextVars[name] = secretSentinel(name);
    overlay[name] = value;
  }
  return { contextVars, overlay };
}

/**
 * W1: the execute and resume commands' wiring: the sentinel goes into the context, the value
 * into the engine's overlay. Returns the names supplied from the environment (never values).
 */
export function applyCliEnvSecrets(
  engine: { applyEnvSecrets(overlay: Record<string, string>): string[] },
  executionContext: ExecutionContext | undefined,
  planVariables: Record<string, unknown> | undefined,
  env: Record<string, string | undefined> = process.env,
): string[] {
  const { contextVars, overlay } = resolveEnvSecrets(planVariables, env);
  if (Object.keys(overlay).length === 0) return [];
  const supplied = engine.applyEnvSecrets(overlay);
  if (executionContext) {
    const vars: Record<string, string> = {};
    for (const name of supplied) vars[name] = contextVars[name];
    executionContext.loadManifestVariables(vars);
  }
  return supplied;
}

export interface CliExecutionInputs {
  /** Tenant slug for engine.loadPlan (undefined = the "dev" folder, as on the server). */
  tenantSlug?: string;
  /** Present for live runs only — the server builds none in dev / dry-run mode either. */
  executionContext?: ExecutionContext;
  warnings: string[];
}

/**
 * Slug: `--tenant`, else the plan (`ces.tenantSlug`, `variables.tenant_slug`), else TENANT_SLUG.
 * Context: only when not a dry run. Client config is loaded from the tenant record when the
 * slug has one; a missing record is a warning (the CLI still runs from its .env credentials).
 */
export async function buildCliExecutionInputs(
  planPath: string,
  explicitTenant: string | undefined,
  dryRun: boolean,
): Promise<CliExecutionInputs> {
  const warnings: string[] = [];
  let planRaw: any = {};
  try {
    planRaw = JSON.parse(fs.readFileSync(planPath, 'utf-8'));
  } catch { /* loadPlan reports an unreadable plan */ }

  const slug = resolveResultsTenantSlug(planRaw ?? {}, explicitTenant);
  const tenantSlug = slug !== 'dev' ? slug : undefined;

  if (dryRun) return { tenantSlug, warnings };

  const executionContext = new ExecutionContext(false);
  if (tenantSlug) {
    try {
      const tenantJsonPath = await resolveTenantJsonPath(tenantSlug);
      executionContext.loadClientConfig(loadClientConfigFromTenantJson(tenantJsonPath));
    } catch (err) {
      warnings.push(`Tenant config for "${tenantSlug}" not loaded (${err instanceof Error ? err.message : String(err)}); continuing with plan variables only`);
    }
  }
  return { tenantSlug, executionContext, warnings };
}

/** Same merge as execute.routes.ts: plan variables over VARIABLE_DEFAULTS. */
export function loadPlanVariablesIntoContext(
  executionContext: ExecutionContext | undefined,
  planVariables: Record<string, unknown> | undefined,
): void {
  if (!executionContext) return;
  executionContext.loadManifestVariables({ ...VARIABLE_DEFAULTS, ...(planVariables || {}) });
}

/** P3 test flag `--force-fail <entryId>`: the decision whether it may run. */
export interface ForceFailDecision {
  allowed: boolean;
  /** The refusal (or acceptance) message the CLI prints. */
  message: string;
}

/**
 * P3: `--force-fail` runs only against a simulator tenant (registry record `kind: 'sim'`)
 * or with the explicit `--i-know-this-is-a-test` companion flag. No entries = nothing to decide.
 */
export function decideForceFail(input: {
  entryIds: string[];
  acknowledged: boolean;
  tenantSlug?: string;
  tenantKind?: string;
}): ForceFailDecision {
  const slug = input.tenantSlug ?? 'dev';
  if (input.entryIds.length === 0) return { allowed: true, message: '' };
  const list = input.entryIds.join(', ');
  if (input.tenantKind === 'sim') {
    return { allowed: true, message: `--force-fail (test flag) active for ${list} on simulator tenant "${slug}"` };
  }
  if (input.acknowledged) {
    return { allowed: true, message: `--force-fail (test flag) active for ${list} on tenant "${slug}" (kind: ${input.tenantKind ?? 'unknown'}), acknowledged with --i-know-this-is-a-test` };
  }
  return {
    allowed: false,
    message: `Refused: --force-fail is a test flag. Tenant "${slug}" is not a simulator (registry kind: ${input.tenantKind ?? 'no record'}). Use a kind:'sim' tenant or add --i-know-this-is-a-test.`,
  };
}

/** P3: the tenant's kind from the ces-tenant registry (`undefined` when there is no record or the lookup fails). */
export async function lookupTenantKind(tenantSlug: string | undefined): Promise<string | undefined> {
  if (!tenantSlug) return undefined;
  try {
    const { getTenantRegistry } = await import('../tenant/stamperTenants.js');
    const record = await getTenantRegistry().get(tenantSlug);
    return record?.kind;
  } catch {
    return undefined;
  }
}

/**
 * W9 FG-6 (founder gate, 2026-10-30): the CLI credits a manual gate only to its own entries'
 * controls, the same rule as the server route (`gateCreditedControls`, W8-STX): a
 * `manual_gate` task's controls become its `_sub_commands` entries' control_ids ∩ task.controls;
 * a gate whose entries carry no control_ids keeps all of task.controls. Other tasks unchanged.
 * D-5 (2026-10-31): the same set applies to a REJECTED (failed) gate's NOT_SAT. The helper is
 * `gateResultControls` in `src/core/gateCredit.ts`, shared with the server route.
 */
export function cliResultsTasks(
  tasks: Array<{ id: string; controls?: string[]; action?: { engine?: string; args?: Record<string, unknown> } }>,
): ResultsPlanTask[] {
  return tasks.map((task) => {
    if (task.action?.engine !== 'manual_gate') return task;
    return { id: task.id, controls: gateResultControls(task) };
  });
}
