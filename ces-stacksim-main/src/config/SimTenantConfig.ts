// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { TenantStance } from '../gating/StackShapeGate.js';
import { G5_IDS, G5_LICENSING, BUILTIN_ROLES } from '../seed/sets/gccHighG5.js';

/** tenant-stacksim package root (works from src/ and from dist/src/). */
function packageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

/** The fictional roster G-01/G-05 read with Import-Csv (fixtures/training-roster.csv). */
export function trainingRosterPath(): string {
  return path.join(packageRoot(), 'fixtures', 'training-roster.csv');
}

/**
 * Obviously-fake terms-of-use document (Stamper REQ sim-tenant-secret-variables):
 * base64 of a tiny fixed text stub matching resources.tou_file_name.
 */
export const SIM_TOU_TEXT = 'SIMULATED TERMS OF USE - tenant-stacksim test data only. Not a real agreement.';

export const DEFAULT_SIM_PORT = 4390;

export interface SimTenantConfigOptions {
  slug: string;
  tenantStance: TenantStance;
  port?: number;
}

/**
 * Raw JSON shape consumed by ces-shared's TenantConfig.ts loadTenantConfig()
 * (client.slug, tenant.tenant_id/domain, auth.app_id/cert_path/
 * cert_thumbprint, endpoints, subscription, infrastructure_model). Emitted
 * as plain JSON, not imported from ces-shared — tenant-stacksim stays
 * standalone with zero cross-package dependency (Architecture Decisions).
 */
export interface SimTenantConfigJson {
  client: { slug: string; name: string; engagement_id: string };
  tenant: { tenant_id: string; domain: string; environment: string };
  auth: { app_id: string; cert_path: string; cert_thumbprint: string };
  endpoints: {
    graph: string;
    login: string;
    compliance_uri: string;
    exchange_env: string;
    azure_auth?: string;
    arm?: string;
  };
  subscription?: { subscription_id: string; resource_group: string; location: string };
  /**
   * Stack-concept-aligned resource names (2026-07-10). Stamper's GuiServer
   * derives the tenant's variables.json from `subscription` + `resources`
   * (tenant.routes.ts migrateToVariablesFile), and registry commands fill
   * their {placeholders} from those variables — without this block a
   * GUI-driven run against the sim has empty variables. Values point at
   * REAL SEEDED sim objects wherever one exists (SeedEngine generators:
   * sim-law-1, simstorage1, sim-kv-1, sim-vnet-1, sim-nsg-1,
   * sim.user1@…, 'Sim Group 1', sp-1, sim-storage-key-1) and use the
   * coverage harness's `sim-<name>` convention where nothing is seeded —
   * the same value universe the 503/523 coverage baseline was proven with.
   * Tiered per stance: identity/M365 keys always; law_* from
   * m365_sentinel; kv/storage/network/automation only at m365_azure.
   */
  resources?: Record<string, string>;
  onboarding?: { bootstrapped_at: string; bootstrapped_by: string; cert_expires: string };
  infrastructure_model: TenantStance;
}

/**
 * Builds the sim tenant config, pointing every endpoint at the sim server
 * (M2's `stacksim serve`, not yet running at M1 — the emitted content/paths
 * are correct ahead of that milestone).
 *
 * Per the plan's note under Core Design (e): m365_only omits
 * endpoints.arm/azure_auth and subscription entirely, so real
 * SessionManager/TenantProbe code fails even earlier (missing endpoint
 * config) before reaching the sim at all on a profile with no Azure
 * surface — StackShapeGate remains the authoritative backstop for calls
 * that do reach the resolver layer.
 */
export function buildSimTenantConfig(opts: SimTenantConfigOptions): SimTenantConfigJson {
  const port = opts.port ?? DEFAULT_SIM_PORT;
  const base = `http://localhost:${port}`;
  const domain = `${opts.slug}.simtenant.onmicrosoft.us`;
  const subscriptionId = `sim-sub-${opts.slug}`;
  const resourceGroup = `sim-rg-${opts.slug}`;
  const armPrefix = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers`;

  // Identity/M365-side resources — every stance has these (see the
  // SimTenantConfigJson.resources doc comment for value provenance).
  const resources: Record<string, string> = {
    primary_domain: domain,
    operator_upn: 'sim.user1@simtenant.onmicrosoft.us',
    breakglass_upn: 'sim.user2@simtenant.onmicrosoft.us',
    admin_username: 'sim.user1',
    // SIMFIX (REQ-tenant-stacksim-ao-source-keys): aligned with the seeded
    // group-1 displayName; the old value 'Sim Group 1' named no seeded group.
    cui_group_name: G5_IDS.cuiGroupName,
    eo_sp_object_id: 'sp-1',
    compliance_role_id: 'sim-complianceRoleId',
    role_def_id: 'sim-roleDefId',
    ciso_email: `ciso@${domain}`,
    security_email: `security@${domain}`,
    approved_ip_range: '10.10.0.0/24',
    tou_file_name: 'sim-terms-of-use.pdf',
    wifi_ssid: 'SIM-CUI-WLAN',
    // SIMFIX (REQ ces-stamper sim-tenant-secret-variables): three Stamper
    // variables no other artifact produces - sim-generated, clearly fake.
    approver_upn: G5_IDS.approverUpn,
    initial_password: 'Sim-Only-Initial-Pa55!-NOT-A-SECRET',
    tou_file_base64: Buffer.from(SIM_TOU_TEXT, 'utf8').toString('base64'),
    // Built-in Entra role template ids (platform constants, same in every
    // tenant) under both Stamper's and AO's key spellings.
    global_admin_role_def_id: BUILTIN_ROLES.globalAdministrator,
    privileged_role_admin_def_id: BUILTIN_ROLES.privilegedRoleAdministrator,
    privileged_role_admin_role_def_id: BUILTIN_ROLES.privilegedRoleAdministrator,
    security_admin_role_def_id: BUILTIN_ROLES.securityAdministrator,
  };

  if (opts.tenantStance === 'm365_sentinel' || opts.tenantStance === 'm365_azure') {
    resources.law_name = 'sim-law-1';
    resources.law_workspace_id = 'sim-law-workspace-id-1';
    resources.law_resource_id = `${armPrefix}/Microsoft.OperationalInsights/workspaces/sim-law-1`;
  }

  if (opts.tenantStance === 'm365_azure') {
    resources.kv_name = 'sim-kv-1';
    resources.kv_uri = 'https://sim-kv-1.vault.usgovcloudapi.net/';
    resources.kv_resource_id = `${armPrefix}/Microsoft.KeyVault/vaults/sim-kv-1`;
    resources.storage_account_name = 'simstorage1';
    resources.storage_resource_id = `${armPrefix}/Microsoft.Storage/storageAccounts/simstorage1`;
    resources.storage_mi_principal_id = 'sim-mi-1';
    resources.automation_account_name = 'sim-automation-1';
    resources.automation_resource_id = `${armPrefix}/Microsoft.Automation/automationAccounts/sim-automation-1`;
    resources.automation_mi_principal_id = 'sim-mi-2';
    resources.vnet_name = 'sim-vnet-1';
    resources.nsg_name = 'sim-nsg-1';
    resources.cmk_key_name = 'sim-storage-key-1';
    resources.vm_name = 'sim-vm-1';

    // SIMFIX FIX-S2 / GOAL M1 (REQ-tenant-stacksim-ao-source-keys): every AO
    // registry `source` the m365_azure seed (gcc-high-g5 seed set) can
    // answer, named from the SAME constants the seed creates its objects
    // with (src/seed/sets/gccHighG5.ts G5_IDS) - never parallel literals.
    // Map: docs/coverage/AO-SOURCE-TO-TENANT-KEY.md.
    resources.m365_license_sku_id = G5_IDS.m365LicenseSkuId;
    resources.m365_primary_sku = G5_LICENSING.primarySku;
    resources.m365_license_count = String(G5_LICENSING.licenseCount);
    resources.base_group_id = G5_IDS.baseGroupId;
    resources.loa_group_id = G5_IDS.loaGroupId;
    resources.admin_group_id = G5_IDS.adminGroupId;
    resources.cui_group_id = G5_IDS.cuiGroupId;
    resources.training_enforcement_group_id = G5_IDS.trainingEnforcementGroupId;
    resources.named_location_id = G5_IDS.namedLocationId;
    resources.device_compliance_ca_policy_id = G5_IDS.deviceComplianceCaPolicyId;
    resources.admin_portal_ca_policy_id = G5_IDS.adminPortalCaPolicyId;
    resources.android_app_protection_policy_id = G5_IDS.androidAppProtectionPolicyId;
    resources.ios_app_protection_policy_id = G5_IDS.iosAppProtectionPolicyId;
    // SharePoint Online's -Identity for a site is its URL.
    resources.cui_site_id = G5_IDS.cuiSiteUrl;
    resources.cui_site_url = G5_IDS.cuiSiteUrl;
    resources.firewall_name = G5_IDS.firewallName;
    resources.public_ip_name = G5_IDS.publicIpName;
    resources.backup_vault_name = G5_IDS.backupVaultName;
    resources.audit_log_retention_days = G5_IDS.auditLogRetentionDays;
    resources.it_helpdesk_phone = G5_IDS.itHelpDeskPhone;
    resources.training_roster_path = trainingRosterPath();
    resources.operator_user_id = G5_IDS.operatorUserId;
    resources.break_glass_user_id = G5_IDS.breakGlassUserId;
  }

  const config: SimTenantConfigJson = {
    client: {
      slug: opts.slug,
      name: `Sim Tenant (${opts.tenantStance})`,
      engagement_id: `sim-engagement-${opts.slug}`,
    },
    tenant: {
      tenant_id: `sim-tenant-${opts.slug}`,
      domain,
      environment: 'gcc-high-sim',
    },
    auth: {
      app_id: `sim-app-${opts.slug}`,
      cert_path: `sim/${opts.slug}.pfx`,
      cert_thumbprint: 'SIMTHUMBPRINT0000000000000000000000000',
    },
    endpoints: {
      graph: `${base}/graph`,
      login: `${base}/login`,
      compliance_uri: `${base}/compliance`,
      exchange_env: 'O365USGovGCCHighSim',
    },
    resources,
    // Fixed literals (not new Date()) so emitted configs are deterministic —
    // same rationale as the seed generators' fixed timestamps.
    onboarding: {
      bootstrapped_at: '2026-01-01T00:00:00.000Z',
      bootstrapped_by: 'tenant-stacksim',
      cert_expires: '2028-01-01T00:00:00.000Z',
    },
    infrastructure_model: opts.tenantStance,
  };

  if (opts.tenantStance !== 'm365_only') {
    config.endpoints.azure_auth = `${base}/azure-auth`;
    config.endpoints.arm = `${base}/arm`;
    config.subscription = {
      subscription_id: subscriptionId,
      resource_group: resourceGroup,
      location: 'usgovvirginia',
    };
  }

  return config;
}

/** Flat path — TenantProbe.psm1:Get-EutTenantConfig convention. */
export function flatTenantConfigPath(slug: string, homeDir: string = os.homedir()): string {
  return path.join(homeDir, '.stamper', 'tenants', `${slug}.json`);
}

/** Nested path — loadTenantConfig() modern convention. */
export function planDataTenantConfigPath(slug: string, projectRoot: string): string {
  return path.join(projectRoot, 'plan-data', slug, `${slug}.json`);
}

export interface WriteSimTenantConfigOptions {
  emitPlanData?: boolean;
  projectRoot?: string;
  homeDir?: string;
  /**
   * backlog-S3: opt IN to writing the flat `~/.stamper/tenants/<slug>.json`
   * file. That is the REAL Stamper config directory (TenantProbe.psm1 reads
   * it with no override, and Stamper's GuiServer migrates it into plan-data
   * at startup), so sim configs land there only when a TenantProbe-compat
   * flow explicitly asks — and that flow owns cleaning its file up per run.
   */
  emitFlat?: boolean;
}

export interface WriteSimTenantConfigResult {
  config: SimTenantConfigJson;
  /** Present only when writeOpts.emitFlat was set (backlog-S3). */
  flatPath?: string;
  planDataPath?: string;
}

/**
 * Writes the sim tenant config at the nested plan-data path when
 * --emit-plan-data is set, and at the flat TenantProbe path only when
 * emitFlat is set (backlog-S3: sim configs stay out of the real
 * `~/.stamper/tenants/` by default).
 */
export async function writeSimTenantConfig(
  opts: SimTenantConfigOptions,
  writeOpts: WriteSimTenantConfigOptions = {},
): Promise<WriteSimTenantConfigResult> {
  const config = buildSimTenantConfig(opts);
  const json = JSON.stringify(config, null, 2);

  let flatPath: string | undefined;
  if (writeOpts.emitFlat) {
    flatPath = flatTenantConfigPath(opts.slug, writeOpts.homeDir);
    await fs.mkdir(path.dirname(flatPath), { recursive: true });
    await fs.writeFile(flatPath, json, 'utf8');
  }

  let planDataPath: string | undefined;
  if (writeOpts.emitPlanData) {
    planDataPath = planDataTenantConfigPath(opts.slug, writeOpts.projectRoot ?? process.cwd());
    await fs.mkdir(path.dirname(planDataPath), { recursive: true });
    await fs.writeFile(planDataPath, json, 'utf8');
  }

  return { config, flatPath, planDataPath };
}
