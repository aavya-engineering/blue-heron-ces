// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { Router } from 'express';
import { tenantLoader } from '../middleware/tenantLoader.js';
import { getTenantRegistry } from '../../tenant/aoTenants.js';
import { ALLOW_LIVE_ENV, isStacksimModeActive } from '../../execution/SimOnlyRail.js';
import { getCommand } from '../../execution/invokeCommand.js';
import { resolveSource } from '../../execution/SourceBindings.js';

/**
 * FX-AO7: whether this server process will run a non-sim tenant at all. Mirrors the
 * SimOnlyRail decision order for non-sim records (CES_AO_SIM_ONLY=1 lockdown beats the
 * CES_AO_ALLOW_LIVE=1 opt-in; no opt-in = sim-only). Informational only — the rail in the
 * executor remains the enforcement point.
 */
export function isLiveAllowed(env: Record<string, string | undefined> = process.env): boolean {
  if (env.CES_AO_SIM_ONLY === '1') return false;
  return env[ALLOW_LIVE_ENV] === '1';
}

export function createTenantRouter() {
  const router = Router();

  router.get('/api/tenant', tenantLoader, (req, res) => {
    res.json((req as any).tenantConfig);
  });

  /**
   * AO-03 (2026-09-27, FC-AO): resolved values for a command's tenant-sourced
   * (`param.source`) parameters — request-input-free, same resolution the server
   * uses at execution time (SourceBindings.resolveSource, the table
   * ParameterMapper.mapAoParametersToVariables is built on). Exists so the GUI's
   * readonly-field auto-fill can bind through the SAME table the server does,
   * instead of reading the raw tenant object with the literal `source` string as a
   * key — which only works for the (few) sources that happen to match a top-level
   * tenant field, and renders blank for every snake_case-bound / resolution-table
   * source (13 commands: A-09/10/11, C-03/05, F-08/13/14, H-01/02/03 — see
   * VERIFY-ao.md AO-03).
   *
   * Unlike mapAoParametersToVariables, an unresolved source is simply omitted
   * (not thrown): this endpoint is a display preview, not an execution gate — the
   * real fail-closed check still runs at POST /api/execute/:commandId.
   */
  router.get('/api/tenant/bindings', tenantLoader, (req, res) => {
    const tenantConfig = (req as any).tenantConfig;
    const commandId = String(req.query.commandId || '');
    const command = getCommand(commandId);
    if (!command) {
      res.status(404).json({ error: `Command not found: ${commandId}` });
      return;
    }
    const bindings: Record<string, string> = {};
    for (const param of command.parameters) {
      if (!param.source) continue;
      const resolved = resolveSource(tenantConfig, param.source);
      if (resolved.value !== undefined) bindings[param.name] = resolved.value;
    }
    res.json({ bindings });
  });

  /**
   * FX-AO7: the tenant list the web UI must choose from (no implicit default tenant).
   * Returns slug + kind only — never secrets or connection details.
   *
   * AO-20 (2026-09-27, FC-AO): `stacksimModeActive` surfaces whether THIS SERVER
   * PROCESS is actually routed to stacksim right now (isStacksimModeActive — checks
   * STACKSIM_SERVER_URL loopback + a PSModulePath stacksim shim dir), a process-level
   * fact independent of which tenant is selected. When false, any 'sim'-kind tenant
   * will be refused by the executor (CommandExecutor.ts) regardless of its own
   * kind/endpoints — the GUI shows this so the operator isn't surprised by the refusal.
   */
  router.get('/api/tenants', async (_req, res) => {
    try {
      const registry = getTenantRegistry();
      const [sims, lives] = await Promise.all([registry.listByKind('sim'), registry.listByKind('live')]);
      const tenants = [...sims, ...lives]
        .map((r) => ({ slug: r.tenantSlug, kind: r.kind }))
        .sort((a, b) => (a.kind === b.kind ? a.slug.localeCompare(b.slug) : a.kind === 'sim' ? -1 : 1));
      res.json({ tenants, liveAllowed: isLiveAllowed(), stacksimModeActive: isStacksimModeActive() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Failed to list tenants: ${msg}`, tenants: [], liveAllowed: false, stacksimModeActive: isStacksimModeActive() });
    }
  });

  return router;
}
