// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { Router, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { loadClientConfigFromTenantJson, resolveTenantJsonPath } from '../../config/ClientConfig.js';
import { tenantBaseDir } from '../../core/EvidenceReadinessAnalyzer.js';
import { StamperConfig } from '../../config/StamperConfig.js';
import { SessionManager } from '../../core/SessionManager.js';
import { ExecutionContext } from '../../core/ExecutionContext.js';
import { PowerShellAdapter } from '../../adapters/PowerShellAdapter.js';
import { ResourceFallbackResolver } from '../../core/ResourceFallbackResolver.js';
import { RESOLVABLE_VARIABLES, VARIABLE_MAPPING } from '../../shared/variable-map.js';
import { classifyVariable } from '../../utils/variableClassifier.js';
import { GuiServer } from '../GuiServer.js';
import { writeJsonArtifact } from 'ces-shared/persistence/files';

/**
 * After fallback resolution discovers resource values, persist them back to the
 * tenant JSON file so they become defaults for all future runs.
 * Only fills empty fields — never overwrites operator-provided values.
 */
function persistResolvedToTenantJson(tenantJsonPath: string, resolved: Record<string, string>): boolean {
  const raw = JSON.parse(fs.readFileSync(tenantJsonPath, 'utf-8'));
  if (!raw.resources) raw.resources = {};

  let updated = false;
  for (const [varName, value] of Object.entries(resolved)) {
    const field = VARIABLE_MAPPING[varName];
    if (field && !raw.resources[field]) {
      raw.resources[field] = value;
      updated = true;
    }
  }

  if (updated) {
    writeJsonArtifact(tenantJsonPath, raw, { trailingNewline: true });
  }

  return updated;
}

function getTenantVariablesPath(slug: string): string {
  return path.join(tenantBaseDir(slug), 'variables.json');
}

/**
 * Persist runtime-captured variables to tenant variables.json.
 * Dev mode (tenant='dev') returns immediately without writing — session-only for testing.
 */
export function saveTenantVariables(tenant: string, variables: Record<string, any>): void {
  // Dev mode: session-only — do NOT persist to filesystem
  if (tenant === 'dev') return;

  const varsPath = getTenantVariablesPath(tenant);
  writeJsonArtifact(varsPath, variables);
}

export function createVariablesRouter(): Router {
  const router = Router();

  // GET /api/tenants/:slug/variables — load variables from tenant variables.json file
  router.get('/api/tenants/:slug/variables', (req: Request, res: Response) => {
    try {
      const { slug } = req.params;
      if (!slug || slug === 'dev') {
        res.json({ ok: true, variables: {} });
        return;
      }

      const varsPath = getTenantVariablesPath(slug);
      if (!fs.existsSync(varsPath)) {
        res.json({ ok: true, variables: {} });
        return;
      }

      const vars = JSON.parse(fs.readFileSync(varsPath, 'utf-8'));
      res.json({ ok: true, variables: vars });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  // PUT /api/tenants/:slug/variables — save variables to tenant variables.json file
  router.put('/api/tenants/:slug/variables', (req: Request, res: Response) => {
    try {
      const { slug } = req.params;
      const { variables } = req.body as { variables: Record<string, any> };

      if (!slug || slug === 'dev') {
        res.status(400).json({ ok: false, error: 'Invalid tenant slug' });
        return;
      }

      if (!variables || typeof variables !== 'object') {
        res.status(400).json({ ok: false, error: 'variables object is required' });
        return;
      }

      const varsPath = getTenantVariablesPath(slug);
      writeJsonArtifact(varsPath, variables);
      res.json({ ok: true, variables });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  // GET /api/plan-variables — extract and classify variables from executable plan
  router.get('/api/plan-variables', (req: Request, res: Response) => {
    try {
      const planPath = req.query['plan'] as string | undefined;
      let varsFile = req.query['varsFile'] as string | undefined;

      // Redirect to tenant variables file if varsFile is tenant:<slug>
      if (varsFile && varsFile.startsWith('tenant:')) {
        const slug = varsFile.substring(7);
        varsFile = getTenantVariablesPath(slug);
      }

      if (!planPath) {
        res.status(400).json({ ok: false, error: 'plan query parameter is required' });
        return;
      }

      // Read variables from standalone file if provided, otherwise extract from plan
      let vars: Record<string, unknown>;
      if (varsFile && fs.existsSync(varsFile)) {
        vars = JSON.parse(fs.readFileSync(varsFile, 'utf-8'));
      } else {
        if (!fs.existsSync(planPath)) {
          res.status(404).json({ ok: false, error: `Plan file not found: ${planPath}` });
          return;
        }
        const raw = fs.readFileSync(planPath, 'utf-8');
        const plan = JSON.parse(raw);
        vars = plan.variables ?? {};
      }

      // Classify variables using centralized utility
      type VarEntry = { name: string; value: unknown; category: 'si' | 'cui' | 'tcp'; missing: boolean; resolvable: boolean };
      const entries: VarEntry[] = [];

      for (const [key, value] of Object.entries(vars)) {
        // Skip system/internal variables and namespaced config_intent objects
        if (key.startsWith('_') || key.startsWith('config_intent.')) continue;
        // Skip non-scalar values (objects, arrays)
        if (typeof value === 'object' && value !== null) continue;

        const category = classifyVariable(key);
        const missing = value === '' || value === null || value === undefined;
        entries.push({ name: key, value, category, missing, resolvable: RESOLVABLE_VARIABLES.has(key) });
      }

      // Sort: missing first within each category, then alphabetical
      entries.sort((a, b) => {
        if (a.category !== b.category) {
          const order = { cui: 0, tcp: 1, si: 2 };
          return order[a.category] - order[b.category];
        }
        if (a.missing !== b.missing) return a.missing ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      const counts = {
        cui: entries.filter(e => e.category === 'cui').length,
        tcp: entries.filter(e => e.category === 'tcp').length,
        si: entries.filter(e => e.category === 'si').length,
        missing: entries.filter(e => e.missing).length,
        total: entries.length
      };

      res.json({ ok: true, variables: entries, counts });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  // POST /api/plan-variables — save edited variables back to executable plan AND standalone vars file
  // @deprecated Use PUT /api/tenants/:slug/variables for new workflows. Kept for backward compat.
  router.post('/api/plan-variables', (req: Request, res: Response) => {
    try {
      const { plan: planPath, variables, varsFile } = req.body as {
        plan: string;
        variables: Record<string, unknown>;
        varsFile?: string;
      };

      if (!planPath) {
        res.status(400).json({ ok: false, error: 'plan path is required' });
        return;
      }

      if (!variables || typeof variables !== 'object') {
        res.status(400).json({ ok: false, error: 'variables object is required' });
        return;
      }

      if (!fs.existsSync(planPath)) {
        res.status(404).json({ ok: false, error: `Plan file not found: ${planPath}` });
        return;
      }

      const raw = fs.readFileSync(planPath, 'utf-8');
      const plan = JSON.parse(raw);

      // Merge edited variables — only update scalar values, preserve system/_/config_intent keys
      for (const [key, value] of Object.entries(variables)) {
        if (key.startsWith('_') || key.startsWith('config_intent.')) continue;
        plan.variables[key] = value;
      }

      writeJsonArtifact(planPath, plan);

      // Also update standalone variables file if provided
      if (varsFile && fs.existsSync(varsFile)) {
        const varsRaw = JSON.parse(fs.readFileSync(varsFile, 'utf-8'));
        for (const [key, value] of Object.entries(variables)) {
          if (key.startsWith('_') || key.startsWith('config_intent.')) continue;
          varsRaw[key] = value;
        }
        writeJsonArtifact(varsFile, varsRaw);
      }

      res.json({ ok: true, updated: Object.keys(variables).length });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  // GET /api/resolvable-variables — static list of auto-discoverable variable names
  router.get('/api/resolvable-variables', (_req: Request, res: Response) => {
    try {
      res.json({ ok: true, variables: Array.from(RESOLVABLE_VARIABLES) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  // POST /api/resolve-variable — query tenant for a single resolvable variable
  router.post('/api/resolve-variable', async (req: Request, res: Response) => {
    try {
      const { variable, tenant, plan: planPath, varsFile } = req.body as {
        variable: string;
        tenant: string;
        plan?: string;
        varsFile?: string;
      };

      if (!variable || !tenant) {
        res.status(400).json({ ok: false, error: 'variable and tenant are required' });
        return;
      }

      if (!RESOLVABLE_VARIABLES.has(variable)) {
        res.status(400).json({ ok: false, error: `Variable "${variable}" is not resolvable via tenant lookup` });
        return;
      }

      // Load tenant config
      const tenantJsonPath = await resolveTenantJsonPath(tenant);
      if (!fs.existsSync(tenantJsonPath)) {
        res.status(404).json({ ok: false, error: `Tenant config not found: ${tenant}` });
        return;
      }
      const clientConfig = loadClientConfigFromTenantJson(tenantJsonPath);

      // Build variables from plan + tenant config (same pattern as discover)
      const variables: Record<string, any> = {};

      // Load plan variables if available
      if (planPath && fs.existsSync(planPath)) {
        const planRaw = JSON.parse(fs.readFileSync(planPath, 'utf-8'));
        Object.assign(variables, planRaw.variables ?? {});
      } else if (varsFile && fs.existsSync(varsFile)) {
        Object.assign(variables, JSON.parse(fs.readFileSync(varsFile, 'utf-8')));
      }

      // Overlay tenant config variables (auth, subscription, resources)
      variables.tenantId = clientConfig.tenantId;
      variables.appId = clientConfig.appId;
      variables.certThumbprint = clientConfig.certThumbprint;
      variables.certPath = clientConfig.certPath;
      if (clientConfig.targetTenantDomain) variables.tenantName = clientConfig.targetTenantDomain.split('.')[0];

      if (clientConfig.subscription) {
        variables.subscriptionId = clientConfig.subscription.subscription_id;
        variables.resourceGroup = clientConfig.subscription.resource_group;
        variables.location = clientConfig.subscription.location;
      }

      if (clientConfig.resources) {
        const r = clientConfig.resources;
        for (const [camelKey, snakeKey] of Object.entries(VARIABLE_MAPPING)) {
          const value = (r as any)[snakeKey];
          if (value !== undefined) variables[camelKey] = value;
        }
      }

      // Build session infrastructure — use fromTenantConfig to avoid requiring process.env
      const tenantRaw = JSON.parse(fs.readFileSync(tenantJsonPath, 'utf-8'));
      const stamperConfig = StamperConfig.fromTenantConfig({ ...tenantRaw, dryRun: false });
      const sessionManager = new SessionManager(clientConfig, false);
      const executionContext = new ExecutionContext(false);
      executionContext.loadClientConfig(clientConfig);
      const adapter = new PowerShellAdapter(stamperConfig, sessionManager, executionContext, clientConfig.evidenceStorage, tenant);

      // Collect SSE-style events to determine outcome
      let result: { type: string; [k: string]: any } | null = null;
      const send = (data: object) => { result = data as any; };

      const discoverFn: import('../../core/ResourceFallbackResolver.js').DiscoverFn = (eng, cmd, captures, vars) =>
        adapter.discoverSubCommand(eng, cmd, captures as any, vars, false, [], []);
      const resolver = new ResourceFallbackResolver(discoverFn, variables, send);
      const resolved = await resolver.resolveByFallback([variable]);

      if (Object.keys(resolved).length > 0) {
        // Persist to tenant JSON
        persistResolvedToTenantJson(tenantJsonPath, resolved);
        res.json({ ok: true, resolved });
      } else if (result && (result as any).type === 'fallback_ambiguous') {
        res.json({ ok: true, ambiguous: true, candidates: (result as any).candidates || [] });
      } else {
        res.json({ ok: false, error: `No ${variable} found in tenant` });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  // POST /api/resolve-all-variables — batch resolution endpoint
  router.post('/api/resolve-all-variables', async (req: Request, res: Response) => {
    try {
      const { variables, tenant } = req.body as {
        variables: string[];
        tenant: string;
      };

      if (!variables || !Array.isArray(variables)) {
        res.status(400).json({ ok: false, error: 'variables array is required' });
        return;
      }

      if (!tenant) {
        res.status(400).json({ ok: false, error: 'tenant is required' });
        return;
      }

      // Load tenant config
      const tenantJsonPath = await resolveTenantJsonPath(tenant);
      if (!fs.existsSync(tenantJsonPath)) {
        res.status(404).json({ ok: false, error: `Tenant config not found: ${tenant}` });
        return;
      }
      const clientConfig = loadClientConfigFromTenantJson(tenantJsonPath);

      // Build variables from tenant config (no plan file in unified variables workflow)
      const contextVars: Record<string, any> = {};

      // Auth + subscription variables
      contextVars.tenantId = clientConfig.tenantId;
      contextVars.appId = clientConfig.appId;
      contextVars.certThumbprint = clientConfig.certThumbprint;
      contextVars.certPath = clientConfig.certPath;
      if (clientConfig.targetTenantDomain) contextVars.tenantName = clientConfig.targetTenantDomain.split('.')[0];

      if (clientConfig.subscription) {
        contextVars.subscriptionId = clientConfig.subscription.subscription_id;
        contextVars.resourceGroup = clientConfig.subscription.resource_group;
        contextVars.location = clientConfig.subscription.location;
      }

      // Existing resources from tenant JSON
      if (clientConfig.resources) {
        const r = clientConfig.resources;
        for (const [camelKey, snakeKey] of Object.entries(VARIABLE_MAPPING)) {
          const value = (r as any)[snakeKey];
          if (value !== undefined) contextVars[camelKey] = value;
        }
      }

      // Build session infrastructure
      const tenantRaw = JSON.parse(fs.readFileSync(tenantJsonPath, 'utf-8'));
      const stamperConfig = StamperConfig.fromTenantConfig({ ...tenantRaw, dryRun: false });
      const sessionManager = new SessionManager(clientConfig, false);
      const executionContext = new ExecutionContext(false);
      executionContext.loadClientConfig(clientConfig);
      const adapter = new PowerShellAdapter(stamperConfig, sessionManager, executionContext, clientConfig.evidenceStorage, tenant);

      // Collect SSE-style events
      const ambiguousResults: Record<string, string[]> = {};
      const notFoundVars: string[] = [];
      const send = (data: object) => {
        const event = data as any;
        if (event.type === 'fallback_ambiguous') {
          ambiguousResults[event.variable] = event.candidates || [];
        } else if (event.type === 'fallback_not_found') {
          notFoundVars.push(event.variable);
        }
      };

      const discoverFn: import('../../core/ResourceFallbackResolver.js').DiscoverFn = (eng, cmd, captures, vars) =>
        adapter.discoverSubCommand(eng, cmd, captures as any, vars, false, [], []);
      const resolver = new ResourceFallbackResolver(discoverFn, contextVars, send);
      const resolved = await resolver.resolveByFallback(variables);

      // Persist resolved values to tenant JSON atomically
      if (Object.keys(resolved).length > 0) {
        persistResolvedToTenantJson(tenantJsonPath, resolved);
      }

      res.json({
        ok: true,
        resolved,
        ambiguous: ambiguousResults,
        notFound: notFoundVars
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  // POST /api/validate-variables — scan registry entries for missing required variables
  router.post('/api/validate-variables', async (req: Request, res: Response) => {
    try {
      const { tenant } = req.body as { tenant: string };

      if (!tenant || tenant === 'dev') {
        res.status(400).json({ ok: false, error: 'Invalid tenant' });
        return;
      }

      // Load tenant config and variables
      const tenantJsonPath = await resolveTenantJsonPath(tenant);
      if (!fs.existsSync(tenantJsonPath)) {
        res.status(404).json({ ok: false, error: 'Tenant config not found' });
        return;
      }

      const clientConfig = loadClientConfigFromTenantJson(tenantJsonPath);
      const varsPath = getTenantVariablesPath(tenant);
      const loadedVars = fs.existsSync(varsPath)
        ? JSON.parse(fs.readFileSync(varsPath, 'utf-8'))
        : {};

      // Build variable map from tenant config (resources, auth, subscription)
      const allVars: Record<string, any> = { ...loadedVars };
      allVars.tenantId = clientConfig.tenantId;
      allVars.appId = clientConfig.appId;
      if (clientConfig.subscription) {
        allVars.subscriptionId = clientConfig.subscription.subscription_id;
        allVars.resourceGroup = clientConfig.subscription.resource_group;
        allVars.location = clientConfig.subscription.location;
      }
      if (clientConfig.resources) {
        const r = clientConfig.resources;
        for (const [camelKey, snakeKey] of Object.entries(VARIABLE_MAPPING)) {
          const value = (r as any)[snakeKey];
          if (value !== undefined) allVars[camelKey] = value;
        }
      }

      // Use cached registries from GuiServer (no disk reload per request)
      const allEntries = GuiServer.getCachedAllEntries();

      // Scan entries for REQUIRED variables only (exclude variables_runtime)
      const missingByVar: Record<string, { entryIds: string[]; controlIds: Set<string> }> = {};

      for (const entry of allEntries) {
        const requiredVars = entry.variables_required || [];

        for (const varName of requiredVars) {
          const value = allVars[varName];
          const isMissing = value === undefined || value === null || value === '';

          if (isMissing) {
            if (!missingByVar[varName]) {
              missingByVar[varName] = { entryIds: [], controlIds: new Set() };
            }
            missingByVar[varName].entryIds.push(entry.entry_id);
            if (entry.control_ids) {
              entry.control_ids.forEach((c: string) => missingByVar[varName].controlIds.add(c));
            }
          }
        }
      }

      // Convert Set to Array for JSON serialization
      const missingVars = Object.entries(missingByVar).map(([varName, data]) => ({
        variable: varName,
        entryCount: data.entryIds.length,
        entryIds: data.entryIds,
        controlIds: Array.from(data.controlIds),
        controlCount: data.controlIds.size,
        resolvable: RESOLVABLE_VARIABLES.has(varName)
      }));

      // Sort by control count descending (most impactful first)
      missingVars.sort((a, b) => b.controlCount - a.controlCount);

      res.json({
        ok: true,
        totalVariables: Object.keys(allVars).length,
        missingCount: missingVars.length,
        missing: missingVars
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  return router;
}
