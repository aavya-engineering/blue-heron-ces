// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Headless invocation surface for AdminOps commands.
// Mirrors POST /api/execute/:commandId (execute.routes.ts) exactly so the CLI and
// the MCP server drive the SAME governed engine — SoD gate, dryRun, evidence — with
// no HTTP server. dryRun defaults to true; a live write requires an explicit dryRun=false.

import * as path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import type { AoCommand } from '../types/AoCommand.js';
import { loadTenantConfig } from 'ces-shared/config';
import { loadTenantConfigBySlug } from '../tenant/aoTenants.js';
import { executeAoCommand } from './CommandExecutor.js';
import { validateRegistryAtLoad } from '../registry/RegistryBridge.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// registry ships in src/ (build is tsc-only, no copy step) — resolve relative to dist/execution
const REGISTRY_PATH = path.resolve(__dirname, '../../src/registry/ao-commands.registry.json');

// G-AO-CMMC-BOUND-1 M4: registry cmmcPractices are validated against the CMMC
// reference catalog on first load (CLI + MCP both come through here).
let registryValidated = false;

export function loadRegistry(): AoCommand[] {
  const commands = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8')) as AoCommand[];
  if (!registryValidated) {
    registryValidated = true;
    validateRegistryAtLoad(commands);
  }
  return commands;
}

export interface CommandFilter { domain?: string; sodTier?: string; cmmc?: string; trigger?: string; }

export function listCommands(filter: CommandFilter = {}): AoCommand[] {
  let cmds = loadRegistry();
  if (filter.domain) cmds = cmds.filter(c => c.domain === filter.domain || c.domainName === filter.domain);
  if (filter.sodTier) cmds = cmds.filter(c => c.sodTier === filter.sodTier);
  if (filter.trigger) cmds = cmds.filter(c => c.trigger === filter.trigger);
  if (filter.cmmc) cmds = cmds.filter(c => (c.cmmcPractices || []).some(p => p.includes(filter.cmmc!)));
  return cmds;
}

export function getCommand(id: string): AoCommand | undefined {
  return loadRegistry().find(c => c.id === id);
}

export interface InvokeInput {
  commandId: string;
  tenant: string;
  inputs?: Record<string, any>;
  dryRun?: boolean;
  requestorUPN?: string;
  approvalId?: string;
  tenantConfigPath?: string;   // explicit operator-supplied config file; else ces-tenant registry
  /** CLI --strict-cmmc thread: fail closed on tenants lacking CMMC scoping fields (G-AO-CMMC-BOUND-1 M4). */
  strictCmmc?: boolean;
}

/**
 * Load tenant config, validate required params, and execute via the governed engine.
 * Returns the executor result (ExecutionResult+evidence, or a PendingApprovalResult for Tier-3).
 */
export async function invokeAoCommand(input: InvokeInput) {
  const { commandId, tenant, inputs = {}, dryRun = true, requestorUPN, approvalId, tenantConfigPath, strictCmmc } = input;

  const aoCommand = getCommand(commandId);
  if (!aoCommand) throw new Error(`Command ${commandId} not found in registry`);

  // G-TENANT-M5: tenant resolution goes through the ces-tenant registry
  // exclusively (the old override → cwd-resolver → flat ~/.stamper chain is
  // deleted; the flat probe was the A9 collision path). `tenantConfigPath`
  // remains ONLY as an explicit operator-supplied file — no path construction,
  // no probing — for configs deliberately kept outside the registry.
  const tenantConfig = tenantConfigPath
    ? loadTenantConfig(tenantConfigPath)
    : await loadTenantConfigBySlug(tenant);

  // required params that are not sourced from tenant config must be supplied
  const missing = aoCommand.parameters
    .filter(p => p.required && !p.source)
    .filter(p => inputs[p.name] === undefined || inputs[p.name] === null || inputs[p.name] === '');
  if (missing.length) {
    throw new Error(`Missing required parameter(s): ${missing.map(p => p.name).join(', ')}`);
  }

  return executeAoCommand(aoCommand, tenantConfig, inputs, dryRun, {
    requestorUPN,
    approvalId,
    ...(strictCmmc !== undefined ? { strictCmmc } : {}),
  });
}
