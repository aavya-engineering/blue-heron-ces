// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import express from 'express';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import open from 'open';
import { CommandRegistry } from '../registry/CommandRegistry.js';
import { CommandEntry } from '../registry/command-registry.types.js';
import { ReadinessResult, tenantBaseDir } from '../core/EvidenceReadinessAnalyzer.js';

// Import router factories
import { createBearerAuthMiddleware, authPostureLine } from 'ces-shared/http';
import { requestLogger, structuredLog } from 'ces-shared/observability';
import { randomUUID } from 'node:crypto';
import { createHealthRouter } from './routes/health.routes.js';
import { createTenantRouter } from './routes/tenant.routes.js';
import { createVariablesRouter } from './routes/variables.routes.js';
import { createAssessRouter } from './routes/assess.routes.js';
import { createTranslateRouter } from './routes/translate.routes.js';
import { createExecuteRouter } from './routes/execute.routes.js';
import { createConnectRouter } from './routes/connect.routes.js';
import { createEvidenceRouter } from './routes/evidence.routes.js';
import { createUtilityRouter } from './routes/utility.routes.js';
import { createRegistryRouter } from './routes/registry.routes.js';
import { createGapsRouter } from './routes/gaps.routes.js';
import { createBaselineRouter } from './routes/baseline.routes.js';
import { checkEcAutostart } from './ecAutostart.js';
import { getPlanDataRoot } from '../config/paths.js';
import { getCesRepository } from 'ces-shared/persistence/node';
import { writeJsonArtifact, writeTextArtifact } from 'ces-shared/persistence/files';
import { fileURLToPath } from 'node:url';

// ---- Shared state for execution (approvals, abort signal) ----

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const approvalGate = new Map<string, (decision: 'approve' | 'skip' | 'accomplish') => void>();
let abortRequested = false;

// ---- Readiness result for translate to mark pre-accomplished items ----
let lastReadinessResult: ReadinessResult | null = null;

// ---- FC-ST-3 step 1 (ST-16): last Evidence Collector auto-start result, surfaced on /health ----
let lastEcAutostartResult: string = 'not_checked';

// Quiet variant of ces-shared's requestLogger: identical request-ID correlation (G-ENG-6 floor),
// but the operator console only carries failures — successful requests would drown the startup
// banner and any real signal. Duplicated here rather than changed in ces-shared because other
// CES servers may want the full stream.
function quietRequestLogger(service: string) {
  return (req: express.Request, res: express.Response, next: express.NextFunction): void => {
    const inbound = req.headers['x-request-id'];
    const requestId = (Array.isArray(inbound) ? inbound[0] : inbound) || randomUUID();
    (req as express.Request & { requestId?: string }).requestId = requestId;
    res.setHeader('x-request-id', requestId);
    const start = Date.now();
    res.on('finish', () => {
      if (res.statusCode >= 400) {
        structuredLog('warn', 'request', {
          service,
          requestId,
          method: req.method,
          path: req.originalUrl ?? req.url,
          status: res.statusCode,
          ms: Date.now() - start,
        });
      }
    });
    next();
  };
}

// ---- State persistence helpers ----
// G2: assess-state is DERIVED STATE read downstream (gaps.routes computes from it), so it lives in
// the unified tuple/tenant-keyed CesRepository rather than as a raw assess-state.json on disk.
// One record per tenant: collection 'stamper_assess_state', scope { tenantSlug: slug }, id = slug.
const ASSESS_STATE_COLLECTION = 'stamper_assess_state';

function saveAssessState(slug: string, data: object): void {
  getCesRepository().put(ASSESS_STATE_COLLECTION, {
    id: slug,
    ces: { tenantSlug: slug },
    data,
  });
}

function loadAssessState(slug: string): Record<string, any> | null {
  const rec = getCesRepository().get<Record<string, any>>(
    ASSESS_STATE_COLLECTION,
    slug,
    { tenantSlug: slug },
  );
  return rec ? rec.data : null;
}

// ---- One-time startup migration: ~/.stamper/tenants/ -> ./plan-data/<slug>/ ----

async function migrateToTenantTree(): Promise<void> {
  const sentinelPath = path.join(os.homedir(), '.stamper', '.migrated-tenant-tree');
  if (fs.existsSync(sentinelPath)) return;

  const oldTenantsDir = path.join(os.homedir(), '.stamper', 'tenants');
  if (!fs.existsSync(oldTenantsDir)) {
    // No old tenants directory — write sentinel and return
    writeTextArtifact(sentinelPath, new Date().toISOString());
    return;
  }

  const entries = fs.readdirSync(oldTenantsDir, { withFileTypes: true })
    .filter(d => d.isDirectory());

  for (const entry of entries) {
    const slug = entry.name;
    const srcDir = path.join(oldTenantsDir, slug);
    const destDir = tenantBaseDir(slug);

    try {
      // <slug>.json may be inside subdir OR at parent level (flat layout)
      let srcConfig = path.join(srcDir, `${slug}.json`);
      if (!fs.existsSync(srcConfig)) {
        // Check parent-level flat config: ~/.stamper/tenants/<slug>.json
        const flatConfig = path.join(oldTenantsDir, `${slug}.json`);
        if (fs.existsSync(flatConfig)) {
          srcConfig = flatConfig;
        } else {
          console.warn(`[migration] Skipping tenant "${slug}" — missing ${slug}.json`);
          continue;
        }
      }

      // Ensure destination directory exists
      fs.mkdirSync(destDir, { recursive: true });

      // Copy required config
      fs.copyFileSync(srcConfig, path.join(destDir, `${slug}.json`));

      // Copy optional flat files (skip if missing)
      for (const optFile of ['assess-state.json', 'variables.json', '.variables-migrated']) {
        const src = path.join(srcDir, optFile);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(destDir, optFile));
        }
      }

      // Copy optional subdirectories (evidence/, plans/, logs/, state/)
      for (const subdir of ['evidence', 'plans', 'logs', 'state']) {
        const srcSub = path.join(srcDir, subdir);
        if (fs.existsSync(srcSub) && fs.statSync(srcSub).isDirectory()) {
          fs.cpSync(srcSub, path.join(destDir, subdir), { recursive: true });
        }
      }

      // Rewrite last_session.translate_paths from old ~/.stamper/ to new ./plan-data/
      const destConfig = path.join(destDir, `${slug}.json`);
      try {
        const cfgRaw = JSON.parse(fs.readFileSync(destConfig, 'utf-8'));
        const tp = cfgRaw?.last_session?.translate_paths;
        if (tp && typeof tp === 'object') {
          let rewritten = false;
          for (const key of Object.keys(tp)) {
            if (typeof tp[key] === 'string' && tp[key].includes('.stamper')) {
              // Rewrite: replace old tenant plans path with new plan-data path
              const basename = path.basename(tp[key]);
              tp[key] = path.join(destDir, 'plans', basename);
              rewritten = true;
            }
          }
          if (rewritten) {
            writeJsonArtifact(destConfig, cfgRaw, { trailingNewline: true });
          }
        }
      } catch { /* non-fatal: proceed without path rewrite */ }

      console.log(`[migration] Migrated tenant "${slug}" to ${destDir}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[migration] Error migrating tenant "${slug}": ${msg}`);
      continue;
    }
  }

  // Write sentinel AFTER all tenants attempted
  writeTextArtifact(sentinelPath, new Date().toISOString());
  console.log('[migration] Tenant tree migration complete — sentinel written');
}

export class GuiServer {
  // Cached registries loaded once at startup to avoid per-request disk I/O
  private static cachedM365Registry: CommandRegistry | null = null;
  private static cachedInfraRegistry: CommandRegistry | null = null;
  private static cachedMergedRegistry: CommandRegistry | null = null;

  /**
   * Initialize registry cache at server startup.
   * Loads both M365 and infra registries from disk and merges them.
   */
  private static initializeRegistries(): void {
    const m365RegPath = path.resolve(__dirname, '..', 'registry', 'cmmc-l2-commands.registry.json');
    const m365SrcPath = path.resolve(__dirname, '..', '..', 'src', 'registry', 'cmmc-l2-commands.registry.json');
    const infraRegPath = path.resolve(__dirname, '..', 'registry', 'infra-cmmc-l2-commands.registry.json');
    const infraSrcPath = path.resolve(__dirname, '..', '..', 'src', 'registry', 'infra-cmmc-l2-commands.registry.json');

    const m365Path = fs.existsSync(m365RegPath) ? m365RegPath : m365SrcPath;
    const infraPath = fs.existsSync(infraRegPath) ? infraRegPath : infraSrcPath;

    if (fs.existsSync(m365Path)) {
      this.cachedM365Registry = CommandRegistry.load(m365Path);
    }
    if (fs.existsSync(infraPath)) {
      this.cachedInfraRegistry = CommandRegistry.load(infraPath);
    }

    // Merge registries for translation endpoints
    const regs: CommandRegistry[] = [];
    if (this.cachedM365Registry) regs.push(this.cachedM365Registry);
    if (this.cachedInfraRegistry) regs.push(this.cachedInfraRegistry);
    this.cachedMergedRegistry = regs.length > 0 ? CommandRegistry.merge(...regs) : null;
  }

  /**
   * Get cached registries as array (for CMMC analysis).
   * Returns both M365 and infra registries.
   */
  private static getCachedRegistries(): CommandRegistry[] {
    const regs: CommandRegistry[] = [];
    if (this.cachedM365Registry) regs.push(this.cachedM365Registry);
    if (this.cachedInfraRegistry) regs.push(this.cachedInfraRegistry);
    return regs;
  }

  /**
   * Get cached merged registry (for translation).
   */
  private static getCachedMergedRegistry(): CommandRegistry | null {
    return this.cachedMergedRegistry;
  }

  /**
   * Get all cached registry entries (for assess readiness checks).
   */
  private static getCachedEntries(): CommandEntry[] {
    const entries: CommandEntry[] = [];
    if (this.cachedInfraRegistry) entries.push(...this.cachedInfraRegistry.allEntries);
    if (this.cachedM365Registry) entries.push(...this.cachedM365Registry.allEntries);
    return entries;
  }

  /**
   * Get M365 registry entries only (for registry editor).
   */
  private static getCachedM365Entries(): CommandEntry[] {
    return this.cachedM365Registry ? this.cachedM365Registry.allEntries : [];
  }

  /**
   * Get infra registry entries only (for registry editor).
   */
  private static getCachedInfraEntries(): CommandEntry[] {
    return this.cachedInfraRegistry ? this.cachedInfraRegistry.allEntries : [];
  }

  /**
   * Get all cached registry entries (for variable validation).
   */
  public static getCachedAllEntries(): CommandEntry[] {
    const entries: CommandEntry[] = [];
    if (this.cachedInfraRegistry) entries.push(...this.cachedInfraRegistry.allEntries);
    if (this.cachedM365Registry) entries.push(...this.cachedM365Registry.allEntries);
    return entries;
  }

  /**
   * Invalidate and reload a specific registry cache after edits.
   * Called by registry routes after successful PUT operations.
   */
  private static invalidateRegistryCache(type: 'm365' | 'infra'): void {
    const m365RegPath = path.resolve(__dirname, '..', 'registry', 'cmmc-l2-commands.registry.json');
    const m365SrcPath = path.resolve(__dirname, '..', '..', 'src', 'registry', 'cmmc-l2-commands.registry.json');
    const infraRegPath = path.resolve(__dirname, '..', 'registry', 'infra-cmmc-l2-commands.registry.json');
    const infraSrcPath = path.resolve(__dirname, '..', '..', 'src', 'registry', 'infra-cmmc-l2-commands.registry.json');

    if (type === 'm365') {
      const m365Path = fs.existsSync(m365RegPath) ? m365RegPath : m365SrcPath;
      if (fs.existsSync(m365Path)) {
        this.cachedM365Registry = CommandRegistry.load(m365Path);
      }
    } else {
      const infraPath = fs.existsSync(infraRegPath) ? infraRegPath : infraSrcPath;
      if (fs.existsSync(infraPath)) {
        this.cachedInfraRegistry = CommandRegistry.load(infraPath);
      }
    }

    // Rebuild merged registry
    const regs: CommandRegistry[] = [];
    if (this.cachedM365Registry) regs.push(this.cachedM365Registry);
    if (this.cachedInfraRegistry) regs.push(this.cachedInfraRegistry);
    this.cachedMergedRegistry = regs.length > 0 ? CommandRegistry.merge(...regs) : null;
  }

  static async start(port: number, opts: { verbose?: boolean } = {}): Promise<void> {
    const app = express();

    // FC-ST-3 step 1 (ST-16, EC milestone M4b): always health-check EC; only spawn it when
    // CES_EC_AUTOSTART=1 (not gated on EVIDENCE_OPS_SECRET — that's EC's own bearer-auth secret
    // for its ingest/index routes, unrelated to whether Stamper should launch it). The previous
    // hardcoded `../eo` cwd never existed — ensureEcRunning()'s own default (`../ces-ec`, the real
    // module root) is used instead, or CES_EC_CWD to override.
    console.log('Evidence Collector check...');
    lastEcAutostartResult = await checkEcAutostart();
    console.log(`  EC autostart: ${lastEcAutostartResult}`);

    // Initialize registry cache at startup
    this.initializeRegistries();

    // Middleware
    app.use(express.json({ limit: '5mb' }));

    // Auth (G-ENG-4): loopback trusted, network requires a bearer token. Zero-friction local dev;
    // never silently exposed on the network. Set CES_STAMPER_AUTH_TOKEN to enable remote access.
    const authOpts = { token: process.env['CES_STAMPER_AUTH_TOKEN'], service: 'stamper' };
    app.use(createBearerAuthMiddleware(authOpts));
    // G-ENG-6: request-ID correlation + structured request logging (observability floor).
    // Quiet by default for the operator console: every request still gets a correlation id,
    // but only failures (status >= 400) are logged. --verbose restores full per-request lines.
    app.use(opts.verbose ? requestLogger('stamper') : quietRequestLogger('stamper'));

    // Serve static files (no-cache for HTML to avoid stale browser cache)
    app.use(express.static(path.resolve(__dirname, '..', '..', 'public'), {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
      }
    }));

    // Serve CMMC reference JSON for GUI _cmmcControlMap init
    app.use('/src/registry', express.static(path.resolve(__dirname, '..', 'registry')));

    // Mount routers
    app.use(createHealthRouter(
      this.cachedM365Registry,
      this.cachedInfraRegistry,
      this.cachedMergedRegistry,
      () => lastEcAutostartResult
    ));

    app.use(createTenantRouter());

    app.use(createVariablesRouter());

    app.use(createAssessRouter(
      () => this.getCachedEntries(),
      () => this.getCachedRegistries(),
      () => lastReadinessResult,
      (result: ReadinessResult | null) => { lastReadinessResult = result; },
      saveAssessState,
      loadAssessState
    ));

    app.use(createGapsRouter(
      () => this.getCachedRegistries(),
      saveAssessState,
      loadAssessState
    ));

    app.use(createBaselineRouter(
      () => this.getCachedRegistries(),
      () => abortRequested,
      (value: boolean) => { abortRequested = value; }
    ));

    app.use(createTranslateRouter(
      () => this.getCachedMergedRegistry(),
      () => lastReadinessResult
    ));

    app.use(createExecuteRouter(
      approvalGate,
      () => abortRequested,
      (value: boolean) => { abortRequested = value; }
    ));

    app.use(createConnectRouter());

    app.use(createEvidenceRouter(() => this.getCachedMergedRegistry()));

    app.use(createUtilityRouter());

    app.use(createRegistryRouter(
      () => this.getCachedM365Entries(),
      () => this.getCachedInfraEntries(),
      (type: 'm365' | 'infra') => this.invalidateRegistryCache(type)
    ));


    // ---- Startup: create plan-data/ dir, migrate loose artifacts, migrate tenant tree ----
    const planDataDir = getPlanDataRoot();
    fs.mkdirSync(planDataDir, { recursive: true });

    // Move loose ./plan-data/*.json artifacts to ./plan-data/dev/plans/
    try {
      const looseFiles = fs.readdirSync(planDataDir)
        .filter(f => f.endsWith('.json') && fs.statSync(path.join(planDataDir, f)).isFile());
      if (looseFiles.length > 0) {
        const devPlansDir = path.join(planDataDir, 'dev', 'plans');
        fs.mkdirSync(devPlansDir, { recursive: true });
        for (const f of looseFiles) {
          try {
            fs.renameSync(path.join(planDataDir, f), path.join(devPlansDir, f));
          } catch {}
        }
      }
    } catch {}

    // Run one-time tenant tree migration
    await migrateToTenantTree();

    // Start server
    app.listen(port, () => {
      console.log(`Stamper GUI running at http://localhost:${port}`);
      console.log(authPostureLine(authOpts));
      if (process.env.CES_NO_OPEN !== '1') {
        open(`http://localhost:${port}`).catch(() => {
          console.log('Could not open browser automatically. Navigate to the URL above.');
        });
      }
    });
  }
}
