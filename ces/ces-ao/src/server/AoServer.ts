// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import express, { Router, type Express } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import open from 'open';
import { fileURLToPath } from 'node:url';
import type { AoCommand } from '../types/AoCommand.js';
import { createHealthRouter, type AoAuthPosture } from './routes/health.routes.js';
import { createTenantRouter } from './routes/tenant.routes.js';
import { createCommandsRouter } from './routes/commands.routes.js';
import { createExecuteRouter } from './routes/execute.routes.js';
import { createApprovalsRouter } from './routes/approvals.routes.js';
import { createLeaverConfirmRouter, createLeaverRouter, startLeaverTimer } from './routes/leaver.routes.js';
import { LeaverFlowService } from '../leaver/LeaverFlowService.js';
import { executeLeaverOp, readLeaveSignal, resolveLeaverTenant } from '../leaver/leaverSignal.js';
import { getStamperPlanDataRoot } from 'ces-shared/storage';
import { validateRegistryAtLoad } from '../registry/RegistryBridge.js';
import { quietRequestLogger } from './middleware/quietRequestLogger.js';
import { createBearerAuthMiddleware, authPostureLine } from 'ces-shared/http';
import { principalPostureLine } from 'ces-shared/http/principal';
import { initModuleSecrets, secretEnv, moduleSecretsPostureLine } from 'ces-shared/secrets';
import { aoPrincipalOptionsFromEnv } from './principal.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * SEC-4 (revised 10-30, founder: no loopback-only default): AO listens on every interface, as before,
 * unless CES_AO_BIND names one address. Network callers are gated by the bearer token, not the bind.
 */
export const AO_BIND_ALL = 'all';
export function resolveAoBindHost(env: NodeJS.ProcessEnv = process.env): string {
  const bind = env['CES_AO_BIND'];
  return typeof bind === 'string' && bind.length > 0 ? bind : AO_BIND_ALL;
}

/** SEC-4: "ENFORCED" when a bearer token is configured, else "LOOPBACK_TRUSTED". */
export function aoAuthPosture(token: string | undefined): AoAuthPosture {
  return typeof token === 'string' && token.length > 0 ? 'ENFORCED' : 'LOOPBACK_TRUSTED';
}

/**
 * FIN-30: the AO SPA (ces-ao/ui, built by Vite into ces-ao/ui/dist) is served at /app/. The legacy
 * page stays at / until the flip (FIN-34). /app/<route> with no file extension serves the SPA's
 * index.html (history fallback); assets are static files. Mounted where the legacy static root is:
 * pages are open, and the bearer gate covers /api/* (the data). With no build present, /app/ falls
 * through (404), and / is unaffected.
 */
export const AO_SPA_BASE_PATH = '/app/';
export const AO_SPA_DIR = path.resolve(__dirname, '..', '..', 'ui', 'dist');

export function createAoUiRouter(spaDir: string = AO_SPA_DIR): Router {
  const router = Router();
  const spaIndex = path.join(spaDir, 'index.html');
  const noCache = (res: express.Response) => res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  router.get(/^\/app$/, (_req, res) => res.redirect(302, AO_SPA_BASE_PATH));
  router.get(/^\/app\/(?:.*\/)?[^./]*$/, (_req, res, next) => {
    noCache(res);
    res.sendFile(spaIndex, (err) => {
      if (err) next();
    });
  });
  router.use('/app', express.static(spaDir, {
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) noCache(res);
    },
  }));
  return router;
}

export class AoServer {
  private static cachedRegistry: AoCommand[] | null = null;

  /**
   * Load and cache ao-commands.registry.json at startup
   */
  private static loadRegistry(): AoCommand[] {
    if (this.cachedRegistry) {
      return this.cachedRegistry;
    }

    const regPath = path.resolve(__dirname, '..', 'registry', 'ao-commands.registry.json');
    const srcPath = path.resolve(__dirname, '..', '..', 'src', 'registry', 'ao-commands.registry.json');
    const registryPath = fs.existsSync(regPath) ? regPath : srcPath;

    if (!fs.existsSync(registryPath)) {
      console.warn('[AoServer] Registry not found, returning empty registry');
      this.cachedRegistry = [];
      return this.cachedRegistry;
    }

    const data = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
    this.cachedRegistry = Array.isArray(data) ? data : [];
    // G-AO-CMMC-BOUND-1 M4: validate cmmcPractices against the CMMC reference
    // catalog at server startup (same check the CLI/MCP path runs on first load).
    validateRegistryAtLoad(this.cachedRegistry);
    return this.cachedRegistry;
  }

  /**
   * Mount all route handlers
   */
  private static setupRouters(app: Express, leaver: LeaverFlowService): void {
    const registry = this.loadRegistry();

    app.use(createTenantRouter());
    app.use(createCommandsRouter(registry));
    app.use('/api', createExecuteRouter(registry));
    app.use('/api', createApprovalsRouter());
    // PH-13 P13-LV: the leaver flow's operator routes (behind the bearer gate).
    app.use('/api', createLeaverRouter(leaver));
  }

  /**
   * PH-13 P13-LV: the leaver flow with its production dependencies. CES_AO_PUBLIC_URL is the base of the
   * confirm links tenant administrators receive (default http://localhost:<CES_AO_PORT or 3001>);
   * CES_BHD_NOTICE_MAILBOX is BHD's role mailbox for opted-in done notices (unset: such a notice is
   * recorded undeliverable).
   */
  static createLeaverService(env: NodeJS.ProcessEnv = process.env): LeaverFlowService {
    return new LeaverFlowService({
      resolveTenant: resolveLeaverTenant,
      readSignal: readLeaveSignal,
      execute: executeLeaverOp,
      publicBaseUrl: env['CES_AO_PUBLIC_URL'] || `http://localhost:${env['CES_AO_PORT'] || '3001'}`,
      ...(env['CES_BHD_NOTICE_MAILBOX'] ? { bhdMailbox: env['CES_BHD_NOTICE_MAILBOX'] } : {}),
    });
  }

  /**
   * Serve static files from public/
   */
  private static serveStatic(app: Express): void {
    const publicDir = path.resolve(__dirname, '..', '..', 'public');
    app.use(express.static(publicDir, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
      }
    }));
  }

  /**
   * Open browser to the GUI
   */
  private static openBrowser(port: number): void {
    open(`http://localhost:${port}`).catch(() => {
      console.log('Could not open browser automatically. Navigate to the URL above.');
    });
  }

  /**
   * SEC-4: build the app (middleware + routes) without listening; start() and test/auth.test.ts use it.
   */
  static createApp(env: NodeJS.ProcessEnv = process.env, opts: { leaverService?: LeaverFlowService } = {}): Express {
    const app = express();
    const leaver = opts.leaverService ?? this.createLeaverService(env);

    // Middleware — request-id + structured request logging (observability floor, G-ENG-6).
    // Quiet by default: only failures (>=400) and slow (>=1s) requests log; AO_LOG_REQUESTS=all for everything.
    app.use(quietRequestLogger('adminops'));
    app.use(express.json({ limit: '5mb' }));

    // Auth (G-ENG-4): loopback trusted, network requires a bearer token. Zero-friction local dev;
    // never silently exposed on the network. Set CES_AO_AUTH_TOKEN to enable remote access.
    const authOpts = { token: env['CES_AO_AUTH_TOKEN'], service: 'adminops' };
    // SEC-4: /api/health is mounted before the bearer gate so launchers can poll it with a token set.
    app.use(createHealthRouter(this.loadRegistry().length > 0, { auth: aoAuthPosture(authOpts.token), bind: resolveAoBindHost(env) }));
    // PH-13 P13-LV: the leaver confirm link is gated by its own single-use token (a tenant administrator
    // holds no AO bearer token), so it is mounted before the bearer gate, like /api/health.
    app.use(createLeaverConfirmRouter(leaver));
    app.use(createBearerAuthMiddleware(authOpts));

    // Create plan-data directory if it doesn't exist
    const planDataDir = getStamperPlanDataRoot();
    if (!fs.existsSync(planDataDir)) {
      fs.mkdirSync(planDataDir, { recursive: true });
    }

    // FIN-30: the kit SPA at /app/ (static mount only; the legacy page stays at /).
    app.use(createAoUiRouter());

    // Serve static files
    this.serveStatic(app);

    // Mount routers
    this.setupRouters(app, leaver);

    return app;
  }

  /**
   * Main entry point
   */
  static async start(port: number): Promise<void> {
    // FIN-42 (SP-4): load the DPAPI module-secret store before any secret read (fail closed on a
    // present-but-unreadable store). The store never writes process.env; secretEnv() is the
    // read-only view (store value wins per name; no store = the environment itself).
    initModuleSecrets();
    const env = secretEnv();
    const leaverEnv = { ...env, CES_AO_PORT: env['CES_AO_PORT'] || String(port) };
    const leaver = this.createLeaverService(leaverEnv);
    const app = this.createApp(leaverEnv, { leaverService: leaver });
    // PH-13 P13-LV: optional scan + tick timer (CES_AO_LEAVER_TICK_MIN, CES_AO_LEAVER_TENANTS); off by default.
    startLeaverTimer(leaver, env);
    const host = resolveAoBindHost(env);
    const authOpts = { token: env['CES_AO_AUTH_TOKEN'], service: 'adminops' };

    // Start server
    const onListen = () => {
      console.log(`AdminOps GUI running at http://localhost:${port} (bind ${host})`);
      console.log(authPostureLine(authOpts));
      // W4-AO3: approval decisions require an authenticated principal (fail closed when unset).
      console.log(principalPostureLine(aoPrincipalOptionsFromEnv(env)));
      console.log(moduleSecretsPostureLine());
      if (process.env.CES_NO_OPEN !== '1') this.openBrowser(port);
    };
    if (host === AO_BIND_ALL) app.listen(port, onListen);
    else app.listen(port, host, onListen);
  }
}
