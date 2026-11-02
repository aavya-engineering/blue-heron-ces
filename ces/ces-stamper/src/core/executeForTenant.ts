// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Gap closure API-6: the one execute preparation path. `stamper execute` and `stamper resume`
 * (mode `cli`) and GET /api/execute (mode `gui`) all call executeForTenant() to load the plan
 * for a tenant and put its variables and secrets in place. Each caller then runs the plan its
 * own way (the CLI through StamperTUI / engine.execute, the GUI through the route's task loop)
 * and publishes results its own way; manual-gate crediting (FG-6) stays in those run paths.
 *
 * Steps, in order: (1) muster-api secret references (FLOW-5), when `primeMusterSecrets`;
 * (2) engine.loadPlan with the tenant slug and the session option; (3) the tenant's saved
 * variables.json under the plan variables, when `restoreTenantVariables`; (4) plan variables
 * over VARIABLE_DEFAULTS into the ExecutionContext; (5) allow-listed environment secrets;
 * (6) the P3 forced failures. Log lines go to `log` at the step that produces them.
 *
 * The session option is the one difference in how commands run: `persistent` hands the
 * GUI's connected SessionManager to the engine (one session per type for the whole run);
 * `per-command` hands none (each command runs in its own process, as the CLI always has).
 */
import * as fs from 'fs';
import * as path from 'path';
import type { StamperEngine } from './StamperEngine.js';
import type { ExecutionContext } from './ExecutionContext.js';
import type { SessionManager } from './SessionManager.js';
import type { EvidenceStorageConfig } from '../config/ClientConfig.js';
import type { ExecutablePlan } from '../types/schema.types.js';
import { primeMusterSecrets } from './SecretResolver.js';
import { tenantBaseDir } from './EvidenceReadinessAnalyzer.js';
import { loadPlanVariablesIntoContext, applyCliEnvSecrets, ENV_SECRET_VARIABLES } from '../cli/cliExecutionContext.js';

export type ExecuteMode = 'cli' | 'gui';

export type ExecuteSession =
  | { kind: 'per-command' }
  | { kind: 'persistent'; sessionManager?: SessionManager };

export interface ExecuteForTenantInput {
  mode: ExecuteMode;
  /** Built by the caller (the CLI from its .env, the GUI from the tenant record). */
  engine: StamperEngine;
  planPath: string;
  /** Slug for engine.loadPlan (undefined = the "dev" folder). */
  tenantSlug?: string;
  /** Present for live runs only. */
  executionContext?: ExecutionContext;
  session: ExecuteSession;
  /** GUI: the tenant's evidence storage, when blob upload is on. */
  evidenceStorage?: EvidenceStorageConfig;
  /** GUI: the engine's load log. */
  loadLog?: (msg: string) => void;
  /** FLOW-5: resolve muster-api secret references before the plan loads. */
  primeMusterSecrets: boolean;
  /** GUI: restore captured variables from the tenant's variables.json (non-dev tenants only). */
  restoreTenantVariables: boolean;
  /** P3 `--force-fail` entry ids (already guarded by the caller). */
  forceFail?: string[];
  /** Where the log-safe secret lines go. */
  log: (line: string) => void;
}

export interface ExecuteForTenantOutput {
  plan: ExecutablePlan;
}

export async function executeForTenant(input: ExecuteForTenantInput): Promise<ExecuteForTenantOutput> {
  const { engine } = input;

  // Gap closure FLOW-5 (a): muster-api-issued secret references resolve before the plan loads.
  if (input.primeMusterSecrets) {
    for (const line of await primeMusterSecrets(input.planPath, input.tenantSlug)) input.log(line);
  }

  const sessionManager = input.session.kind === 'persistent' ? input.session.sessionManager : undefined;
  await engine.loadPlan(input.planPath, input.tenantSlug, sessionManager, input.executionContext, input.evidenceStorage, input.loadLog);

  // The mode changes only the error text (each path's message as it always was).
  const plan = engine.getPlan();
  if (!plan) throw new Error(input.mode === 'gui' ? 'Plan not loaded after loadPlan()' : 'Plan not loaded');

  // Restore previously-captured runtime variables from tenant variables.json.
  // variables.json is incrementally updated during execution (saveTenantVariables),
  // while the plan file is only updated at the end. If a prior run was interrupted,
  // captured variables (breakGlassUserId, cuiGroupId, etc.) survive here.
  if (input.restoreTenantVariables && input.tenantSlug) {
    try {
      const varsPath = path.join(tenantBaseDir(input.tenantSlug), 'variables.json');
      if (fs.existsSync(varsPath)) {
        const savedVars = JSON.parse(fs.readFileSync(varsPath, 'utf-8'));
        plan.variables = { ...savedVars, ...(plan.variables || {}) };
      }
    } catch { /* non-fatal — first run won't have variables.json */ }
  }

  // W8-STX (3): plan variables (over VARIABLE_DEFAULTS) and the allow-listed environment
  // secrets reach the ExecutionContext through the CLI's helpers (cliExecutionContext.ts).
  loadPlanVariablesIntoContext(input.executionContext, plan.variables);
  for (const name of applyCliEnvSecrets(engine, input.executionContext, plan.variables)) {
    input.log(`Secret input ${name}: supplied from ${ENV_SECRET_VARIABLES[name]} (held in memory only)`);
  }
  if (input.forceFail && input.forceFail.length > 0) engine.setForcedFailures(input.forceFail);

  return { plan };
}
