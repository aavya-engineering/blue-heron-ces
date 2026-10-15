// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { loadTenantConfig } from 'ces-shared/config';
import { getStamperPlanDataRoot, getModuleStorageRoot } from 'ces-shared/storage';
import { writeTextArtifact } from 'ces-shared/persistence/files';
import { FileTenantRegistry, getRegistryRoot, registryRecordPath } from 'ces-tenant';

const EoConfigSchema = z.object({
  port: z.coerce.number().default(4002),
  tenantSlug: z.string().optional(),
  tenantConfigPath: z.string().optional(),
  registryPath: z.string().min(1),
  infraRegistryPath: z.string().optional(),
  missionPlanPath: z.string().optional(),
  tenantManifestPath: z.string().optional(),
  infraManifestPath: z.string().optional(),
  storageRoot: z.string().default(() => getModuleStorageRoot('EvidenceOps')),
  graphScopes: z.array(z.string()).default(['https://graph.microsoft.us/.default']),
  complianceRepoPath: z.string().default('./compliance-repo'),
  signalCaptureIntervalHours: z.coerce.number().optional(),
  enableScheduledSignalCapture: z.coerce.boolean().default(false),
  /** M4a: base URL of the standalone Evidence Collector (EC) service. */
  ecUrl: z.string().default('http://127.0.0.1:4001'),
  /** M4a: bearer secret for EC's authenticated routes (/api/items, /api/ingest, /api/index).
   *  Unset => EO's EC-authenticated reads/writes are refused (never sent open). */
  evidenceOpsSecret: z.string().optional(),
});

export type EoConfig = z.infer<typeof EoConfigSchema>;

const LAST_TENANT_FILE = '.last-tenant';

/**
 * Resolve the canonical tenant-config path for a slug through `ces-tenant`'s
 * registry (G-TENANT-M2 gate 2: this module no longer constructs the legacy
 * Stamper tenant-directory path itself -- resolution goes through the
 * registry, which owns back-compat reads of the deprecated locations and the
 * one-time forward migration into the neutral registry root).
 *
 * Kept synchronous because existing call sites (EoServer, config-router) use
 * it synchronously: `FileTenantRegistry.get()` is file-backed with no awaits,
 * so invoking it performs the whole back-compat lookup + forward migration
 * before its promise is even inspected; afterwards any record that exists is
 * present under the registry root and `registryRecordPath()` (the registry's
 * own canonical-path API) locates it.
 */
export function stamperTenantConfigPath(slug: string): string {
  const registry = new FileTenantRegistry();
  // Side effect (runs synchronously, see doc comment): back-compat read of
  // deprecated locations + one-time forward migration into the registry root.
  void registry.get(slug).catch(() => { /* resolution errors surface when the caller loads the path */ });

  const root = getRegistryRoot();
  const livePath = registryRecordPath(root, 'live', slug);
  if (fs.existsSync(livePath)) return livePath;
  const simPath = registryRecordPath(root, 'sim', slug);
  if (fs.existsSync(simPath)) return simPath;
  // Not registered anywhere: report the canonical (live) location so error
  // messages point at where the record is expected to be created.
  return livePath;
}

/** List all registered tenant slugs (live + sim) via the registry API. */
async function listAvailableTenantSlugs(registry: FileTenantRegistry): Promise<string[]> {
  const [live, sim] = await Promise.all([registry.listByKind('live'), registry.listByKind('sim')]);
  return [...live, ...sim].map(r => r.tenantSlug);
}

/** Save last-used tenant slug to {storageRoot}/.last-tenant */
export function saveLastTenant(storageRoot: string, slug: string): void {
  writeTextArtifact(path.join(storageRoot, LAST_TENANT_FILE), slug);
}

/** Load last-used tenant slug from {storageRoot}/.last-tenant */
async function loadLastTenant(registry: FileTenantRegistry, storageRoot: string): Promise<string | undefined> {
  const filePath = path.join(storageRoot, LAST_TENANT_FILE);
  if (!fs.existsSync(filePath)) return undefined;
  try {
    const slug = fs.readFileSync(filePath, 'utf-8').trim();
    // Verify the tenant is still registered
    if (slug && (await registry.get(slug))) {
      return slug;
    }
  } catch { /* ignore */ }
  return undefined;
}

export async function loadEoConfig(): Promise<EoConfig> {
  const tenantConfigPath = process.env.TENANT_CONFIG;
  const storageRoot = process.env.STORAGE_ROOT ?? getModuleStorageRoot('EvidenceOps');
  const registry = new FileTenantRegistry();

  let tenantSlug = process.env.TENANT_SLUG ?? '';

  if (tenantConfigPath) {
    const tc = loadTenantConfig(tenantConfigPath);
    tenantSlug = tenantSlug || tc.tenantSlug;
  }

  // Validate activeTenantSlug if ACTIVE_TENANT_SLUG is set
  const activeTenantSlug = process.env.ACTIVE_TENANT_SLUG;
  if (activeTenantSlug) {
    const record = await registry.get(activeTenantSlug);
    if (!record) {
      const available = await listAvailableTenantSlugs(registry);
      throw new Error(
        `No active tenant configured. Use POST /api/tenant-config or set ACTIVE_TENANT_SLUG in .env. ` +
        `Available tenants: [${available.join(', ')}]`
      );
    }
    tenantSlug = tenantSlug || activeTenantSlug;
  }

  // Fall back to last-used tenant
  if (!tenantSlug) {
    tenantSlug = (await loadLastTenant(registry, storageRoot)) ?? '';
  }

  // Auto-resolve tenantConfigPath through the ces-tenant registry
  let resolvedConfigPath = tenantConfigPath;
  if (!resolvedConfigPath && tenantSlug) {
    const record = await registry.get(tenantSlug);
    if (record) {
      resolvedConfigPath = registryRecordPath(getRegistryRoot(), record.kind, tenantSlug);
    }
  }

  // Auto-discover manifest paths from Stamper plan-data
  let infraManifestPath = process.env.INFRA_MANIFEST_PATH;
  let tenantManifestPath = process.env.TENANT_MANIFEST_PATH;
  let missionPlanPath = process.env.MISSION_PLAN_PATH;

  if (tenantSlug) {
    const planDataRoot = process.env.STAMPER_PLAN_DATA_ROOT ?? getStamperPlanDataRoot();

    // Auto-discover infrastructure manifest (ISO 8601 timestamp: infrastructure-manifest-YYYY-MM-DDTHH-MM-SS-MMMZ.json)
    if (!infraManifestPath) {
      const plansDir = path.join(planDataRoot, tenantSlug, 'plans');
      if (fs.existsSync(plansDir)) {
        try {
          const files = fs.readdirSync(plansDir)
            .filter(f => f.startsWith('infrastructure-manifest-') && f.endsWith('.json'))
            .sort();
          if (files.length > 0) {
            infraManifestPath = path.join(plansDir, files[files.length - 1]);
            console.log(`Auto-discovered infrastructure manifest: ${infraManifestPath}`);
          }
        } catch { /* ignore */ }
      }
    }

    // Auto-discover mission plan (ISO 8601 timestamp: manual-mission-plan-YYYY-MM-DDTHH-MM-SS-MMMZ.json)
    if (!missionPlanPath) {
      const plansDir = path.join(planDataRoot, tenantSlug, 'plans');
      if (fs.existsSync(plansDir)) {
        try {
          const files = fs.readdirSync(plansDir)
            .filter(f => f.startsWith('manual-mission-plan-') && f.endsWith('.json'))
            .sort();
          if (files.length > 0) {
            missionPlanPath = path.join(plansDir, files[files.length - 1]);
            console.log(`Auto-discovered mission plan: ${missionPlanPath}`);
          }
        } catch { /* ignore */ }
      }
    }

    // Auto-discover tenant manifest (static filename, no timestamp variant)
    if (!tenantManifestPath) {
      const tmPath = path.join(planDataRoot, tenantSlug, 'tenant-manifest.json');
      if (fs.existsSync(tmPath)) {
        tenantManifestPath = tmPath;
        console.log(`Auto-discovered tenant manifest: ${tenantManifestPath}`);
      }
    }
  }

  const raw = {
    port: process.env.EO_PORT,
    tenantSlug: tenantSlug || undefined,
    tenantConfigPath: resolvedConfigPath || undefined,
    registryPath: process.env.REGISTRY_PATH,
    infraRegistryPath: process.env.INFRA_REGISTRY_PATH,
    missionPlanPath: missionPlanPath || undefined,
    tenantManifestPath: tenantManifestPath || undefined,
    infraManifestPath: infraManifestPath || undefined,
    storageRoot,
    graphScopes: process.env.GRAPH_SCOPES ? process.env.GRAPH_SCOPES.split(',') : undefined,
    complianceRepoPath: process.env.COMPLIANCE_REPO_PATH,
    signalCaptureIntervalHours: process.env.SIGNAL_CAPTURE_INTERVAL_HOURS || undefined,
    enableScheduledSignalCapture: process.env.ENABLE_SCHEDULED_SIGNAL_CAPTURE || undefined,
    ecUrl: process.env.EC_URL || undefined,
    evidenceOpsSecret: process.env.EVIDENCE_OPS_SECRET || undefined,
  };

  const result = EoConfigSchema.safeParse(raw);
  if (!result.success) {
    const errors = result.error.errors.map(e => `  ${e.path.join('.')}: ${e.message}`);
    throw new Error(`Evidence Ops config validation failed:\n${errors.join('\n')}`);
  }

  // Persist the tenant slug for next startup
  if (tenantSlug) {
    saveLastTenant(result.data.storageRoot, tenantSlug);
  }

  return result.data;
}
