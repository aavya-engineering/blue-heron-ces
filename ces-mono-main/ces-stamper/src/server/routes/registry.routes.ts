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
import { CommandEntry, CommandEntrySchema, CommandRegistryData } from '../../registry/command-registry.types.js';
import { loadClientConfigFromTenantJson, resolveTenantJsonPath } from '../../config/ClientConfig.js';
import { resolveTemplate } from '../../utils/templateResolver.js';
import { fileURLToPath } from 'node:url';
import { writeJsonArtifact } from 'ces-shared/persistence/files';

/**
 * Registry routes for CRUD operations on M365 and infra registries.
 * GET /api/registry/:type — return all entries for m365 or infra
 * GET /api/registry/:type/:entryId — return single entry
 * PUT /api/registry/:type/:entryId — validate, write .bak, save, invalidate cache
 * POST /api/registry/resolve — resolve command variables using tenant config
 */

// Module-level cache invalidation callback (injected by GuiServer)

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let cacheInvalidator: ((type: 'm365' | 'infra') => void) | null = null;

/**
 * Get the absolute path to a registry file by type.
 */
function getRegistryFilePath(type: 'm365' | 'infra'): string {
  const fileName = type === 'm365'
    ? 'cmmc-l2-commands.registry.json'
    : 'infra-cmmc-l2-commands.registry.json';

  // Try dist path first, fall back to src
  const distPath = path.resolve(__dirname, '..', '..', 'registry', fileName);
  const srcPath = path.resolve(__dirname, '..', '..', '..', 'src', 'registry', fileName);

  return fs.existsSync(distPath) ? distPath : srcPath;
}

/**
 * Write updated entries to a registry file.
 * Wraps entries in the expected registry file structure with metadata.
 */
function writeRegistryFile(type: 'm365' | 'infra', entries: CommandEntry[]): void {
  const filePath = getRegistryFilePath(type);

  // Read existing file to preserve metadata
  const existing = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as CommandRegistryData;

  // Update entries while preserving version/generated_on/description
  existing.entries = entries;

  // Write atomically via .bak
  const backupPath = `${filePath}.bak`;
  writeJsonArtifact(backupPath, existing);
  fs.copyFileSync(backupPath, filePath);
}

/**
 * Invalidate the global registry cache after writes.
 * Triggers GuiServer to reload the registry from disk.
 */
function invalidateRegistryCache(type: 'm365' | 'infra'): void {
  if (cacheInvalidator) {
    cacheInvalidator(type);
  }
}

export function createRegistryRouter(
  getCachedM365Entries: () => CommandEntry[],
  getCachedInfraEntries: () => CommandEntry[],
  onCacheInvalidate: (type: 'm365' | 'infra') => void
): Router {
  const router = Router();

  // Store the cache invalidation callback
  cacheInvalidator = onCacheInvalidate;

  /**
   * GET /api/registry/:type
   * Return all entries for m365 or infra registry.
   */
  router.get('/api/registry/:type', (req: Request, res: Response) => {
    try {
      const { type } = req.params;

      if (type !== 'm365' && type !== 'infra') {
        res.status(400).json({ error: 'Invalid registry type. Must be "m365" or "infra".' });
        return;
      }

      const entries = type === 'm365' ? getCachedM365Entries() : getCachedInfraEntries();
      res.json({ entries });
    } catch (error: any) {
      console.error('[registry] Error fetching entries:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/registry/:type/:entryId
   * Return single entry by entry_id.
   */
  router.get('/api/registry/:type/:entryId', (req: Request, res: Response) => {
    try {
      const { type, entryId } = req.params;

      if (type !== 'm365' && type !== 'infra') {
        res.status(400).json({ error: 'Invalid registry type. Must be "m365" or "infra".' });
        return;
      }

      const entries = type === 'm365' ? getCachedM365Entries() : getCachedInfraEntries();
      const entry = entries.find(e => e.entry_id === entryId);

      if (!entry) {
        res.status(404).json({ error: `Entry not found: ${entryId}` });
        return;
      }

      res.json(entry);
    } catch (error: any) {
      console.error('[registry] Error fetching entry:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * PUT /api/registry/:type/:entryId
   * Update a single entry with validation.
   * Creates .bak backup, validates with CommandEntrySchema, writes to disk, invalidates cache.
   */
  router.put('/api/registry/:type/:entryId', (req: Request, res: Response) => {
    try {
      const { type, entryId } = req.params;
      const updatedEntry = req.body;

      if (type !== 'm365' && type !== 'infra') {
        res.status(400).json({ error: 'Invalid registry type. Must be "m365" or "infra".' });
        return;
      }

      // Validate with Zod schema
      const parsed = CommandEntrySchema.parse(updatedEntry);

      // Ensure entry_id matches URL
      if (parsed.entry_id !== entryId) {
        res.status(400).json({ error: 'Entry ID mismatch between URL and body.' });
        return;
      }

      // Load current entries from cache
      const entries = type === 'm365' ? getCachedM365Entries() : getCachedInfraEntries();
      const index = entries.findIndex(e => e.entry_id === entryId);

      if (index === -1) {
        res.status(404).json({ error: `Entry not found: ${entryId}` });
        return;
      }

      // Replace entry
      entries[index] = parsed;

      // Write to disk (creates .bak automatically)
      writeRegistryFile(type, entries);

      // Invalidate cache to force reload
      invalidateRegistryCache(type);

      res.json({ success: true, entry: parsed });
    } catch (error: any) {
      console.error('[registry] Error updating entry:', error);

      // Zod validation errors have structured info
      if (error.name === 'ZodError') {
        res.status(400).json({
          error: 'Validation failed',
          details: error.errors
        });
        return;
      }

      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/registry/resolve
   * Resolve {variable} placeholders in a command using tenant config.
   * Body: { command: string, tenant: string }
   * Returns: { resolved: string, unresolved: string[] }
   */
  router.post('/api/registry/resolve', async (req: Request, res: Response) => {
    try {
      const { command, tenant } = req.body;

      if (!command || !tenant) {
        res.status(400).json({ error: 'Missing required fields: command, tenant' });
        return;
      }

      // Load tenant config from ./plan-data/<slug>/<slug>.json
      const tenantJsonPath = await resolveTenantJsonPath(tenant);
      if (!fs.existsSync(tenantJsonPath)) {
        res.status(404).json({ error: `Tenant config not found: ${tenant}` });
        return;
      }

      const clientConfig = loadClientConfigFromTenantJson(tenantJsonPath);

      // Build variables map (same logic as assess route L202-265)
      const variables: Record<string, any> = {};

      // Auth vars
      variables.tenantId = clientConfig.tenantId;
      variables.appId = clientConfig.appId;
      variables.certThumbprint = clientConfig.certThumbprint;
      variables.certPath = clientConfig.certPath;

      if (clientConfig.targetTenantDomain) {
        variables.tenantName = clientConfig.targetTenantDomain.split('.')[0];
      }

      // Subscription vars
      if (clientConfig.subscription) {
        variables.subscriptionId = clientConfig.subscription.subscription_id;
        variables.resourceGroup = clientConfig.subscription.resource_group;
        variables.location = clientConfig.subscription.location;
      }

      // Resource vars
      if (clientConfig.resources) {
        const r = clientConfig.resources;
        if (r.law_name) variables.lawWorkspaceName = r.law_name;
        if (r.law_resource_id) variables.lawResourceId = r.law_resource_id;
        if (r.kv_name) variables.keyVaultName = r.kv_name;
        if (r.kv_uri) variables.kvUri = r.kv_uri;
        if (r.kv_resource_id) variables.kvResourceId = r.kv_resource_id;
        if (r.storage_account_name) variables.storageAccountName = r.storage_account_name;
        if (r.storage_resource_id) variables.storageResourceId = r.storage_resource_id;
        if (r.automation_account_name) variables.automationAccountName = r.automation_account_name;
        if (r.vnet_name) variables.vnetName = r.vnet_name;
        if (r.nsg_name) variables.nsgName = r.nsg_name;
        if (r.eo_sp_object_id) variables.eoSpObjectId = r.eo_sp_object_id;
        if (r.cmk_key_name) variables.cmkKeyName = r.cmk_key_name;
        if (r.cmk_key_version) variables.cmkKeyVersion = r.cmk_key_version;
        if (r.cui_group_name) variables.cuiGroupName = r.cui_group_name;
        if (r.breakglass_upn) variables.breakGlassUPN = r.breakglass_upn;
        if (r.operator_upn) variables.operatorUPN = r.operator_upn;
        if (r.law_workspace_id) variables.lawWorkspaceId = r.law_workspace_id;
        if (r.law_name) variables.workspaceName = r.law_name;
        if (r.storage_mi_principal_id) variables.storageMiPrincipalId = r.storage_mi_principal_id;
        if (r.automation_resource_id) variables.automationResourceId = r.automation_resource_id;
        if (r.automation_mi_principal_id) variables.automationMiPrincipalId = r.automation_mi_principal_id;
        if (r.admin_username) variables.adminUserName = r.admin_username;
        if (r.primary_domain) variables.primaryDomain = r.primary_domain;
        if (r.compliance_role_id) variables.complianceRoleId = r.compliance_role_id;
        if (r.vm_name) variables.vmName = r.vm_name;
        if (r.ciso_email) variables.cisoEmail = r.ciso_email;
        if (r.security_email) variables.securityEmail = r.security_email;
        if (r.approved_ip_range) variables.approvedIpRange = r.approved_ip_range;
        if (r.initial_password) variables.initialPassword = r.initial_password;
        if (r.tou_file_name) variables.touFileName = r.tou_file_name;
        if (r.tou_file_base64) variables.touFileBase64 = r.tou_file_base64;
        if (r.wifi_ssid) variables.wifiSsid = r.wifi_ssid;
        if (r.role_def_id) variables.roleDefId = r.role_def_id;
      }

      // Resolve template
      const resolved = resolveTemplate(command, variables);

      // Extract unresolved variables (remaining {varName} patterns)
      const unresolvedMatches = resolved.match(/\{([^}]+)\}/g) || [];
      const unresolved = unresolvedMatches.map(m => m.slice(1, -1)); // strip braces

      res.json({ resolved, unresolved });
    } catch (error: any) {
      console.error('[registry] Error resolving command:', error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
