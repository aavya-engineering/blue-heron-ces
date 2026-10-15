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
import { resolveTenantJsonPath } from '../../config/ClientConfig.js';
import { tenantBaseDir } from '../../core/EvidenceReadinessAnalyzer.js';
import { writeJsonArtifact, writeTextArtifact } from 'ces-shared/persistence/files';
import { listTenantRecordsWithPaths } from '../../tenant/stamperTenants.js';
import { getRegistryRoot, registryRecordPath } from 'ces-tenant';
import { SecretStore } from '../../core/SecretStore.js';

interface TenantConfigFile {
  client?: { name?: string; slug?: string; engagement_id?: string };
  tenant?: { tenant_id?: string; domain?: string; environment?: string };
  auth?: { app_id?: string; cert_thumbprint?: string; cert_path?: string };
  endpoints?: {
    graph?: string;
    login?: string;
    compliance_uri?: string;
    azure_auth?: string;
    exchange_env?: string;
    arm?: string;
  };
  subscription?: {
    subscription_id?: string;
    resource_group?: string;
    location?: string;
  };
  resources?: Record<string, any>;
  onboarding?: { bootstrapped_at?: string; bootstrapped_by?: string; cert_expires?: string };
}

// ========================================
// Variables Helper
// ========================================

function getTenantVariablesPath(slug: string): string {
  return path.join(tenantBaseDir(slug), 'variables.json');
}

function migrateToVariablesFile(slug: string, clientConfig: any): void {
  const tenantDir = tenantBaseDir(slug);
  const sentinelPath = path.join(tenantDir, '.variables-migrated');

  // Skip if already migrated
  if (fs.existsSync(sentinelPath)) {
    return;
  }

  // Derive variables from tenant config (Sources B+C)
  const variables: Record<string, any> = {};

  // Source B: subscription fields
  if (clientConfig.subscription) {
    if (clientConfig.subscription.subscription_id) variables.subscriptionId = clientConfig.subscription.subscription_id;
    if (clientConfig.subscription.resource_group) variables.resourceGroup = clientConfig.subscription.resource_group;
    if (clientConfig.subscription.location) variables.location = clientConfig.subscription.location;
  }

  // Source C: resources fields (snake_case → camelCase)
  if (clientConfig.resources) {
    const r = clientConfig.resources;
    const resourceMap: Record<string, string | undefined> = {
      lawWorkspaceName: r.law_name,
      workspaceName: r.law_name,
      lawWorkspaceId: r.law_workspace_id,
      lawResourceId: r.law_resource_id,
      keyVaultName: r.kv_name,
      kvUri: r.kv_uri,
      kvResourceId: r.kv_resource_id,
      storageAccountName: r.storage_account_name,
      storageResourceId: r.storage_resource_id,
      storageMiPrincipalId: r.storage_mi_principal_id,
      automationAccountName: r.automation_account_name,
      automationResourceId: r.automation_resource_id,
      automationMiPrincipalId: r.automation_mi_principal_id,
      vnetName: r.vnet_name,
      nsgName: r.nsg_name,
      eoSpObjectId: r.eo_sp_object_id,
      cmkKeyName: r.cmk_key_name,
      cmkKeyVersion: r.cmk_key_version,
      cuiGroupName: r.cui_group_name,
      breakGlassUPN: r.breakglass_upn,
      operatorUPN: r.operator_upn,
      adminUserName: r.admin_username,
      primaryDomain: r.primary_domain,
      complianceRoleId: r.compliance_role_id,
      vmName: r.vm_name,
      cisoEmail: r.ciso_email,
      securityEmail: r.security_email,
      approvedIpRange: r.approved_ip_range,
      initialPassword: r.initial_password,
      touFileName: r.tou_file_name,
      touFileBase64: r.tou_file_base64,
      wifiSsid: r.wifi_ssid,
      roleDefId: r.role_def_id,
    };

    // First-write-wins: only set if value exists and variable is not already set
    for (const [key, val] of Object.entries(resourceMap)) {
      if (val && !variables[key]) {
        variables[key] = val;
      }
    }
  }

  // Write variables.json
  const varsPath = getTenantVariablesPath(slug);
  writeJsonArtifact(varsPath, variables);

  // Create sentinel
  writeTextArtifact(sentinelPath, new Date().toISOString());
}

export function createTenantRouter(): Router {
  const router = Router();

  // GET /api/tenants — list available tenants from the ces-tenant registry
  router.get('/api/tenants', async (_req: Request, res: Response) => {
    try {
      const devEntry = {
        slug: 'dev',
        client_name: 'Dev Mode (no credentials)',
        environment: 'dev',
        cert_expires: undefined as string | undefined
      };

      const entries = await listTenantRecordsWithPaths();
      const tenants = entries.map(({ record, path: cfgPath }) => {
        try {
          const cfg: TenantConfigFile = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
          return {
            slug: cfg.client?.slug ?? record.tenantSlug,
            client_name: cfg.client?.name ?? 'Unknown',
            environment: cfg.tenant?.environment ?? 'unknown',
            cert_expires: cfg.onboarding?.cert_expires
          };
        } catch {
          return null;
        }
      }).filter((t): t is NonNullable<typeof t> => t !== null);

      res.json([devEntry, ...tenants]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // GET /api/tenants/:slug — return the full raw config for a specific tenant
  router.get('/api/tenants/:slug', async (req: Request, res: Response) => {
    try {
      const { slug } = req.params;
      if (!slug || slug === 'dev') {
        res.status(400).json({ ok: false, error: 'Invalid tenant slug' });
        return;
      }
      const tenantPath = await resolveTenantJsonPath(slug);
      if (!fs.existsSync(tenantPath)) {
        res.status(404).json({ ok: false, error: `Tenant config not found: ${slug}` });
        return;
      }
      const raw = fs.readFileSync(tenantPath, 'utf-8');
      const config = JSON.parse(raw);

      // Run one-time migration to variables.json if not yet migrated
      try {
        migrateToVariablesFile(slug, config);
      } catch {
        // Non-fatal: migration failure doesn't block tenant load
      }

      res.json({ ok: true, slug, path: tenantPath, config });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  // PUT /api/tenants/:slug — overwrite an existing tenant config
  router.put('/api/tenants/:slug', async (req: Request, res: Response) => {
    try {
      const { slug } = req.params;
      const { json } = req.body as { json: string };
      if (!json) {
        res.status(400).json({ ok: false, error: 'json field is required' });
        return;
      }

      let cfg: TenantConfigFile;
      try {
        cfg = JSON.parse(json);
      } catch {
        res.status(400).json({ ok: false, error: 'Invalid JSON' });
        return;
      }

      if (!cfg.tenant?.tenant_id) {
        res.status(400).json({ ok: false, error: 'Missing required field: tenant.tenant_id' });
        return;
      }
      if (!cfg.auth?.app_id) {
        res.status(400).json({ ok: false, error: 'Missing required field: auth.app_id' });
        return;
      }
      if (cfg.client?.slug && cfg.client.slug !== slug) {
        res.status(400).json({ ok: false, error: `client.slug "${cfg.client.slug}" does not match URL slug "${slug}"` });
        return;
      }

      const tenantPath = await resolveTenantJsonPath(slug);
      if (!fs.existsSync(tenantPath)) {
        res.status(404).json({ ok: false, error: `Tenant config not found: ${slug}` });
        return;
      }

      // Preserve the registry's `kind` stamp on overwrite — a record in a
      // kind namespace without a matching `kind` field is a stamping bug the
      // ces-tenant registry refuses to serve.
      try {
        const existing = JSON.parse(fs.readFileSync(tenantPath, 'utf-8'));
        if (existing?.kind === 'live' || existing?.kind === 'sim') {
          (cfg as Record<string, any>).kind = existing.kind;
        }
      } catch { /* fall through — write what we were given */ }

      writeJsonArtifact(tenantPath, cfg);
      res.json({ ok: true, slug, path: tenantPath });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  // POST /api/tenants — save a new tenant config from pasted JSON
  router.post('/api/tenants', (req: Request, res: Response) => {
    try {
      const { json } = req.body as { json: string };
      if (!json) {
        res.status(400).json({ ok: false, error: 'json field is required (paste the tenant config JSON)' });
        return;
      }

      let cfg: TenantConfigFile;
      try {
        cfg = JSON.parse(json);
      } catch {
        res.status(400).json({ ok: false, error: 'Invalid JSON — could not parse tenant config' });
        return;
      }

      // Validate required fields
      const slug = cfg.client?.slug;
      if (!slug) {
        res.status(400).json({ ok: false, error: 'Missing required field: client.slug' });
        return;
      }

      if (!/^[a-zA-Z0-9_-]+$/.test(slug)) {
        res.status(400).json({ ok: false, error: 'client.slug must contain only letters, numbers, hyphens, and underscores' });
        return;
      }

      if (!cfg.tenant?.tenant_id) {
        res.status(400).json({ ok: false, error: 'Missing required field: tenant.tenant_id' });
        return;
      }

      if (!cfg.auth?.app_id) {
        res.status(400).json({ ok: false, error: 'Missing required field: auth.app_id' });
        return;
      }

      // Write the tenant record into the ces-tenant registry (kind-namespaced,
      // stamped) — tenant-config storage is registry-owned post-G-TENANT-M1.
      const kind: 'live' | 'sim' =
        (cfg as Record<string, any>).kind === 'sim' || cfg.tenant?.environment === 'gcc-high-sim'
          ? 'sim'
          : 'live';
      const stamped = { ...(cfg as Record<string, any>), kind };
      const tenantPath = registryRecordPath(getRegistryRoot(), kind, slug);
      writeJsonArtifact(tenantPath, stamped);

      res.json({
        ok: true,
        slug,
        path: tenantPath,
        client_name: cfg.client?.name ?? slug,
        environment: cfg.tenant?.environment ?? 'unknown'
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  // GET /api/tenants-browse — list tenant config files (ces-tenant registry records) with metadata
  router.get('/api/tenants-browse', async (_req: Request, res: Response) => {
    try {
      const entries = await listTenantRecordsWithPaths();
      const files: { name: string; path: string; size: number; modified: string }[] = [];
      for (const { record, path: cfgPath } of entries) {
        if (!fs.existsSync(cfgPath)) continue;
        const stat = fs.statSync(cfgPath);
        files.push({
          name: `${record.tenantSlug}.json`,
          path: cfgPath,
          size: stat.size,
          modified: stat.mtime.toISOString(),
        });
      }
      files.sort((a, b) => b.modified.localeCompare(a.modified));

      res.json({ ok: true, dir: getRegistryRoot(), files });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  // POST /api/tenants/:slug/secrets — FC-ST-3 step 2 (REQ-ces-stamper-secret-reference-resolution):
  // the operator supplies a `one_time_operator_held` secret value (e.g. initialPassword) at
  // Configure time. Held only in server memory (SecretStore) for this process's lifetime — never
  // written to a tenant config file, variables.json, or any log line. The value is deliberately
  // never echoed back in the response.
  router.post('/api/tenants/:slug/secrets', (req: Request, res: Response) => {
    try {
      const { slug } = req.params;
      const { variable, value } = req.body as { variable?: string; value?: string };
      if (!slug || slug === 'dev') {
        res.status(400).json({ ok: false, error: 'Invalid tenant slug' });
        return;
      }
      if (!variable || typeof variable !== 'string') {
        res.status(400).json({ ok: false, error: 'variable field is required' });
        return;
      }
      if (!value || typeof value !== 'string') {
        res.status(400).json({ ok: false, error: 'value field is required' });
        return;
      }
      SecretStore.set(slug, variable, value);
      res.json({ ok: true, slug, variable });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  return router;
}
