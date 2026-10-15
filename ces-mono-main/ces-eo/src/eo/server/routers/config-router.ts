// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import express, { type Request, type Response } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { EoConfig } from '../../config/EoConfig.js';
import { saveLastTenant, stamperTenantConfigPath } from '../../config/EoConfig.js';
import { loadTenantConfig } from 'ces-shared/config';
import { getRegistryRoot } from 'ces-tenant';
import { SessionManager } from '../../core/SessionManager.js';
import type { TenantConfig } from 'ces-shared/config';
import type { TenantSessionRegistry } from '../TenantSessionRegistry.js';
import {
  sendError,
  resolveTenantJsonPath,
  loadRegistry,
  type TenantSummary,
} from '../eo-router-utils.js';

export interface ConfigRouterDeps {
  config: EoConfig;
  stamperRoot: string;
  startedAt: string;
  /** FX2-EO1: per-tenant Graph sessions — /api/connect registers the session under the requested tenant only. */
  sessions: TenantSessionRegistry;
  /** Session factory seam (default: a real `SessionManager`); tests inject a sim spawn seam. */
  createSessionManager?: (tenantConfig: TenantConfig, tenantSlug: string) => SessionManager;
}

export function createConfigRouter(deps: ConfigRouterDeps): express.Router {
  const { config, stamperRoot, startedAt, sessions } = deps;
  const createSessionManager = deps.createSessionManager
    ?? ((tc: TenantConfig, slug: string) => new SessionManager(tc, { tenantSlug: slug }));

  const router = express.Router();

  // GET /api/tenants — list available tenant configs
  router.get('/api/tenants', (_req: Request, res: Response) => {
    try {
      // stamperRoot resolved at module scope
      const tenants: TenantSummary[] = [];

      // Try plan-data layout first
      const planDataDir = path.join(stamperRoot, 'plan-data');
      if (fs.existsSync(planDataDir)) {
        const slugDirs = fs.readdirSync(planDataDir).filter(d => {
          try { return fs.statSync(path.join(planDataDir, d)).isDirectory(); } catch { return false; }
        });
        for (const slug of slugDirs) {
          const configPath = path.join(planDataDir, slug, `${slug}.json`);
          if (!fs.existsSync(configPath)) continue;
          try {
            const raw = fs.readFileSync(configPath, 'utf-8');
            const cfg = JSON.parse(raw);
            tenants.push({
              slug: cfg.client?.slug ?? slug,
              client_name: cfg.client?.name ?? 'Unknown',
              environment: cfg.tenant?.environment ?? 'unknown',
              cert_expires: cfg.onboarding?.cert_expires,
              configPath,
              source: 'plan-data',
            });
          } catch { /* skip invalid files */ }
        }
      }

      // G-EO-STAB-1 M3: also list ces-tenant REGISTRY tenants (sim + live) — the
      // ephemeral sim tenants the deprecated ~/.stamper scan never saw. Records
      // live flat at <registryRoot>/<kind>/<slug>.json. The deprecated reader is
      // retired.
      const registryRoot = getRegistryRoot();
      for (const kind of ['sim', 'live'] as const) {
        const kindDir = path.join(registryRoot, kind);
        if (!fs.existsSync(kindDir)) continue;
        const files = fs.readdirSync(kindDir).filter((f) => f.endsWith('.json'));
        for (const file of files) {
          const slug = file.replace(/\.json$/, '');
          if (tenants.some((t) => t.slug === slug)) continue; // plan-data already listed it
          const configPath = path.join(kindDir, file);
          try {
            const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            tenants.push({
              slug: cfg.client?.slug ?? cfg.slug ?? slug,
              client_name: cfg.client?.name ?? cfg.client_name ?? 'Unknown',
              environment: cfg.tenant?.environment ?? cfg.kind ?? kind,
              cert_expires: cfg.onboarding?.cert_expires,
              configPath,
              source: 'registry',
            });
          } catch { /* skip invalid files */ }
        }
      }

      res.json(tenants);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendError(res, 500, msg);
    }
  });

  // POST /api/tenant-config — set tenant by slug or explicit path
  router.post('/api/tenant-config', (req: Request, res: Response) => {
    const { path: configPath, slug } = req.body;

    // Accept either { slug: "vfsgov" } or { path: "/full/path.json" }
    let resolvedPath = configPath;
    if (!resolvedPath && slug && typeof slug === 'string') {
      resolvedPath = stamperTenantConfigPath(slug);
    }

    if (!resolvedPath || typeof resolvedPath !== 'string') {
      sendError(res, 400, 'slug or path is required');
      return;
    }

    try {
      const tc = loadTenantConfig(resolvedPath);
      config.tenantConfigPath = resolvedPath;
      config.tenantSlug = tc.tenantSlug;
      saveLastTenant(config.storageRoot, tc.tenantSlug);
      res.json({
        loaded: true,
        tenantSlug: tc.tenantSlug,
        tenantId: tc.tenantId,
        path: resolvedPath,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendError(res, 400, msg);
    }
  });

  // GET /api/tenant-config — return current tenant config info
  router.get('/api/tenant-config', (_req: Request, res: Response) => {
    res.json({
      tenantConfigPath: config.tenantConfigPath ?? null,
      tenantSlug: config.tenantSlug ?? null,
    });
  });

  // GET /api/registry — return command registry for task-action detail view
  router.get('/api/registry', (_req: Request, res: Response) => {
    try {
      const registry = loadRegistry(config.registryPath);
      if (config.infraRegistryPath) {
        const infra = loadRegistry(config.infraRegistryPath);
        registry.entries.push(...infra.entries);
      }
      res.json(registry);
    } catch (err) {
      sendError(res, 500, (err as Error).message);
    }
  });

  // GET /api/connect — SSE: connect to tenant Graph session
  router.get('/api/connect', async (req: Request, res: Response) => {
    // SSE setup
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (data: object): void => {
      res.write('data: ' + JSON.stringify(data) + '\n\n');
    };

    try {
      const tenant = typeof req.query.tenant === 'string' ? req.query.tenant.trim() : '';
      if (!tenant) {
        send({ type: 'error', message: 'tenant query param required' });
        res.end();
        return;
      }

      // Load and validate tenant config
      // stamperRoot resolved at module scope
      const tenantJsonPath = resolveTenantJsonPath(tenant, stamperRoot, os.homedir());
      if (!tenantJsonPath) {
        send({ type: 'connection_log', phase: 'error', message: `Tenant config not found: ${tenant}` });
        res.end();
        return;
      }

      let tenantConfig;
      try {
        tenantConfig = loadTenantConfig(tenantJsonPath);
      } catch (err) {
        send({ type: 'connection_log', phase: 'error', message: `Invalid tenant config: ${err instanceof Error ? err.message : String(err)}` });
        res.end();
        return;
      }

      send({ type: 'connection_log', phase: 'config_loaded', message: `Tenant config loaded: ${tenant}`, tenant });

      // Update server config to use this tenant
      config.tenantConfigPath = tenantJsonPath;
      config.tenantSlug = tenantConfig.tenantSlug;
      saveLastTenant(config.storageRoot, tenantConfig.tenantSlug);

      // FX2-EO1: create/replace the session for THIS tenant only. Other tenants' sessions are
      // untouched, and no other tenant's live-signal read can ever reach this one.
      const newSessionManager = createSessionManager(tenantConfig, tenant);
      const replaced = sessions.set(tenant, newSessionManager);
      if (replaced) {
        replaced.disconnectAll().catch(err => console.warn('[connect] old session disconnect failed:', err instanceof Error ? err.message : String(err)));
      }

      // Connect Graph
      send({ type: 'connection_log', phase: 'connecting_graph', message: 'Connecting to Microsoft Graph...', tenant });
      try {
        await newSessionManager.ensureConnected();
        send({ type: 'connection_log', phase: 'connected_graph', message: 'Graph session connected', tenant });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        send({ type: 'connection_log', phase: 'error_graph', message: `Graph connection failed: ${msg}`, tenant });
      }

      send({ type: 'connection_log', phase: 'done', message: 'Connection check complete', tenant });
    } catch (err) {
      send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }

    res.end();
  });

  // GET /api/health — EO health
  router.get('/api/health', async (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'evidence-ops',
      startedAt,
      version: '0.1.0',
    });
  });

  return router;
}
