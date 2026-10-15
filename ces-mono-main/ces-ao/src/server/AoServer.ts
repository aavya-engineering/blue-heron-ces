// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import express, { type Express } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import open from 'open';
import { fileURLToPath } from 'node:url';
import type { AoCommand } from '../types/AoCommand.js';
import { createHealthRouter } from './routes/health.routes.js';
import { createTenantRouter } from './routes/tenant.routes.js';
import { createCommandsRouter } from './routes/commands.routes.js';
import { createExecuteRouter } from './routes/execute.routes.js';
import { createApprovalsRouter } from './routes/approvals.routes.js';
import { getStamperPlanDataRoot } from 'ces-shared/storage';
import { validateRegistryAtLoad } from '../registry/RegistryBridge.js';
import { quietRequestLogger } from './middleware/quietRequestLogger.js';
import { createBearerAuthMiddleware, authPostureLine } from 'ces-shared/http';
import { principalPostureLine } from 'ces-shared/http/principal';
import { aoPrincipalOptionsFromEnv } from './principal.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  private static setupRouters(app: Express): void {
    const registry = this.loadRegistry();
    const registryLoaded = registry.length > 0;

    app.use(createHealthRouter(registryLoaded));
    app.use(createTenantRouter());
    app.use(createCommandsRouter(registry));
    app.use('/api', createExecuteRouter(registry));
    app.use('/api', createApprovalsRouter());
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
   * Main entry point
   */
  static async start(port: number): Promise<void> {
    const app = express();

    // Middleware — request-id + structured request logging (observability floor, G-ENG-6).
    // Quiet by default: only failures (>=400) and slow (>=1s) requests log; AO_LOG_REQUESTS=all for everything.
    app.use(quietRequestLogger('adminops'));
    app.use(express.json({ limit: '5mb' }));

    // Auth (G-ENG-4): loopback trusted, network requires a bearer token. Zero-friction local dev;
    // never silently exposed on the network. Set CES_AO_AUTH_TOKEN to enable remote access.
    const authOpts = { token: process.env['CES_AO_AUTH_TOKEN'], service: 'adminops' };
    app.use(createBearerAuthMiddleware(authOpts));

    // Create plan-data directory if it doesn't exist
    const planDataDir = getStamperPlanDataRoot();
    if (!fs.existsSync(planDataDir)) {
      fs.mkdirSync(planDataDir, { recursive: true });
    }

    // Serve static files
    this.serveStatic(app);

    // Mount routers
    this.setupRouters(app);

    // Start server
    app.listen(port, () => {
      console.log(`AdminOps GUI running at http://localhost:${port}`);
      console.log(authPostureLine(authOpts));
      // W4-AO3: approval decisions require an authenticated principal (fail closed when unset).
      console.log(principalPostureLine(aoPrincipalOptionsFromEnv()));
      if (process.env.CES_NO_OPEN !== '1') this.openBrowser(port);
    });
  }
}
