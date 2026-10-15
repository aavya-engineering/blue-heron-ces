// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import { loadClientConfigFromTenantJson, resolveTenantJsonPath } from '../../config/ClientConfig.js';
import { PrerequisiteChecker, MODULE_PREREQUISITES } from 'ces-shared/prereq';
import { SessionManager } from '../../core/SessionManager.js';

interface TenantConfigFile {
  client?: { name?: string; slug?: string };
  tenant?: { tenant_id?: string; domain?: string; environment?: string };
  auth?: { app_id?: string; cert_thumbprint?: string; cert_path?: string };
  endpoints?: Record<string, string>;
}

export function createConnectRouter(): Router {
  const router = Router();

  // GET /api/connect — SSE connection flow (prereqs + session connect)
  router.get('/api/connect', async (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (data: object): void => {
      res.write('data: ' + JSON.stringify(data) + '\n\n');
    };

    try {
      const tenant = req.query['tenant'] as string | undefined;
      console.log(`[ConnectRouter] Connect request — tenant=${tenant ?? '(none)'}`);

      if (!tenant || tenant === 'dev') {
        console.log(`[ConnectRouter] Rejected — no real tenant selected`);
        send({ type: 'error', message: 'Connect requires a real tenant. Select a tenant from the dropdown.' });
        res.end();
        return;
      }

      // Load tenant config
      const tenantJsonPath = await resolveTenantJsonPath(tenant);
      if (!fs.existsSync(tenantJsonPath)) {
        console.log(`[ConnectRouter] Tenant config not found: ${tenantJsonPath}`);
        send({ type: 'error', message: `Tenant config not found: ${tenantJsonPath}` });
        res.end();
        return;
      }

      const clientConfig = loadClientConfigFromTenantJson(tenantJsonPath);
      const tenantRaw: TenantConfigFile = JSON.parse(fs.readFileSync(tenantJsonPath, 'utf-8'));
      console.log(`[ConnectRouter] Config loaded — name=${tenantRaw.client?.name ?? tenant}, env=${tenantRaw.tenant?.environment ?? 'unknown'}, domain=${tenantRaw.tenant?.domain ?? 'n/a'}`);

      send({
        type: 'connection_log',
        phase: 'config_loaded',
        message: `Tenant config loaded: ${tenantRaw.client?.name ?? tenant} (${tenantRaw.tenant?.environment ?? 'unknown'})`,
        tenant,
        detail: `Domain: ${tenantRaw.tenant?.domain ?? 'n/a'} | Environment: ${tenantRaw.tenant?.environment ?? 'n/a'}`
      });

      // ---- Prerequisite check phase ----
      console.log(`[ConnectRouter] Starting prerequisite checks...`);
      const checker = new PrerequisiteChecker();
      const psVersion = await checker.getPSVersion();
      console.log(`[ConnectRouter] PowerShell version: ${psVersion ?? 'NOT FOUND'}`);
      send({
        type: 'prereq_check',
        module: 'PowerShell',
        installed: !!psVersion,
        version: psVersion,
        required: true,
      });

      // Certificate check
      const thumbprint = tenantRaw.auth?.cert_thumbprint || '';
      const certPath = tenantRaw.auth?.cert_path || '';
      let certMissing = false;
      console.log(`[ConnectRouter] Certificate check — thumbprint=${thumbprint ? thumbprint.substring(0, 8) + '...' : '(none)'}`);
      if (thumbprint) {
        const certResult = await checker.checkCertificate(thumbprint);
        if (certResult.found && certResult.expired) {
          send({
            type: 'prereq_check',
            module: 'Certificate',
            installed: false,
            version: certResult.subject,
            required: true,
            detail: `Expired: ${certResult.expiry}`,
          });
          certMissing = true;
        } else if (certResult.found) {
          send({
            type: 'prereq_check',
            module: 'Certificate',
            installed: true,
            version: certResult.subject,
            required: true,
            detail: `Expires: ${certResult.expiry}`,
          });
        } else {
          send({
            type: 'prereq_check',
            module: 'Certificate',
            installed: false,
            version: null,
            required: true,
            detail: `Thumbprint ${thumbprint.substring(0, 8)}... not in Cert:\\CurrentUser\\My`,
          });
          certMissing = true;
        }
      }

      // Module checks
      console.log(`[ConnectRouter] Checking module prerequisites...`);
      const prereqResults = await checker.checkAll();
      const missingRequired: string[] = [];
      for (const r of prereqResults) {
        send({
          type: 'prereq_check',
          module: r.name,
          session: r.session,
          installed: r.installed,
          version: r.version,
          required: r.required,
        });
        if (r.required && !r.installed) {
          missingRequired.push(r.name);
        }
      }

      if (certMissing || missingRequired.length > 0) {
        const parts: string[] = [];
        if (certMissing) parts.push('Certificate not found in cert store');
        if (missingRequired.length > 0) parts.push(`Missing modules: ${missingRequired.join(', ')}`);
        send({
          type: 'prereq_blocked',
          missing: missingRequired,
          cert_missing: certMissing,
          cert_path: certPath,
          thumbprint,
          message: parts.join(' | '),
        });
        res.end();
        return;
      }

      console.log(`[ConnectRouter] All prerequisites satisfied — ${prereqResults.length} modules checked`);
      send({ type: 'connection_log', phase: 'prereqs_ok', message: 'All prerequisites satisfied', tenant });

      console.log(`[ConnectRouter] Creating SessionManager for tenant=${tenant}`);
      const sessionManager = new SessionManager(clientConfig, false);

      // Connect graph
      console.log(`[ConnectRouter] Connecting graph session...`);
      send({ type: 'connection_log', phase: 'connecting_graph', message: 'Connecting to Microsoft Graph...', tenant });
      try {
        await sessionManager.ensureConnected('graph');
        console.log(`[ConnectRouter] Graph session connected`);
        send({ type: 'connection_log', phase: 'connected_graph', message: 'Graph session connected', tenant });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`[ConnectRouter] Graph connection FAILED: ${msg.substring(0, 200)}`);
        send({ type: 'connection_log', phase: 'error_graph', message: `Graph connection failed: ${msg}`, tenant });
      }

      // Connect exchange
      console.log(`[ConnectRouter] Connecting exchange session...`);
      send({ type: 'connection_log', phase: 'connecting_exchange', message: 'Connecting to Exchange Online...', tenant });
      try {
        await sessionManager.ensureConnected('exchange');
        console.log(`[ConnectRouter] Exchange session connected`);
        send({ type: 'connection_log', phase: 'connected_exchange', message: 'Exchange session connected', tenant });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`[ConnectRouter] Exchange connection FAILED: ${msg.substring(0, 200)}`);
        send({ type: 'connection_log', phase: 'error_exchange', message: `Exchange connection failed: ${msg}`, tenant });
      }

      console.log(`[ConnectRouter] Connection check complete`);
      send({ type: 'connection_log', phase: 'done', message: 'Connection check complete', tenant });
      res.end();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      send({ type: 'error', message: msg });
      res.end();
    }
  });

  // GET /api/prereqs — standalone SSE prereq check (outside connect flow)
  router.get('/api/prereqs', async (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (data: object): void => {
      res.write('data: ' + JSON.stringify(data) + '\n\n');
    };

    try {
      const checker = new PrerequisiteChecker();
      const psVersion = await checker.getPSVersion();
      send({ type: 'prereq_check', module: 'PowerShell', installed: !!psVersion, version: psVersion, required: true });

      const results = await checker.checkAll();
      for (const r of results) {
        send({ type: 'prereq_check', module: r.name, session: r.session, installed: r.installed, version: r.version, required: r.required });
      }

      send({ type: 'prereq_done' });
      res.end();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      send({ type: 'error', message: msg });
      res.end();
    }
  });

  // GET /api/prereqs/install?module=<name> — SSE stream for module installation
  router.get('/api/prereqs/install', (req: Request, res: Response) => {
    const moduleName = req.query['module'] as string | undefined;
    if (!moduleName) {
      res.status(400).json({ error: 'module query parameter required' });
      return;
    }

    const valid = MODULE_PREREQUISITES.find(m => m.name === moduleName);
    if (!valid) {
      res.status(400).json({ error: `Unknown module: ${moduleName}` });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (data: object): void => {
      res.write('data: ' + JSON.stringify(data) + '\n\n');
    };

    const checker = new PrerequisiteChecker();
    const { promise, kill } = checker.installModule(moduleName, (line) => {
      send({ type: 'install_progress', module: moduleName, message: line });
    });

    req.on('close', () => {
      kill();
    });

    promise.then((exitCode) => {
      send({ type: 'install_done', module: moduleName, success: exitCode === 0 });
      res.end();
    });
  });

  // POST /api/prereqs/import-cert — SSE stream for certificate import
  router.post('/api/prereqs/import-cert', (req: Request, res: Response) => {
    const { certPath: pfxPath, password } = req.body as { certPath?: string; password?: string };
    if (!pfxPath || !password) {
      res.status(400).json({ error: 'certPath and password are required' });
      return;
    }

    if (!fs.existsSync(pfxPath)) {
      res.status(400).json({ error: `Certificate file not found: ${pfxPath}` });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (data: object): void => {
      res.write('data: ' + JSON.stringify(data) + '\n\n');
    };

    const checker = new PrerequisiteChecker();
    const { promise, kill } = checker.importCertificate(pfxPath, password, (line) => {
      send({ type: 'install_progress', module: 'Certificate', message: line });
    });

    req.on('close', () => {
      kill();
    });

    promise.then((exitCode) => {
      send({ type: 'install_done', module: 'Certificate', success: exitCode === 0 });
      res.end();
    });
  });

  return router;
}
