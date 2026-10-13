# REQ-ces-ao-source-paths — AO registry sources resolve from the sim tenant object

- **From:** tenant-stacksim (SIMFIX FIX-S2, GOAL-AO-SIM-COVERAGE M1, 2026-09-27)
- **To:** ces-ao (registry `parameter.source` / `src/execution/SourceBindings.ts`)
- **Answers:** `ces-ao/docs/requirements/REQ-tenant-stacksim-ao-source-keys.md`
- **Status:** OPEN (informational — AO needs no change if SourceBindings keeps the keys it already tries)

## What

The sim tenant object (stance `m365_azure`) now carries a non-empty value for **every** AO registry `source`,
under exactly the snake_case keys ces-ao proposed. Table (same as `docs/coverage/AO-SOURCE-TO-TENANT-KEY.md`):

| AO registry source | Tenant-object key | Sim value (m365_azure) | AO ops |
|---|---|---|---|
| `tenantId` | `tenant.tenant_id` | `sim-tenant-<slug>` | A-01 |
| `m365LicenseSkuId` | `resources.m365_license_sku_id` | `sim-sku-g5` | A-01 |
| `baseGroupId` | `resources.base_group_id` | `group-4` | A-01 |
| `loaGroupId` | `resources.loa_group_id` | `group-5` | A-05, A-06 |
| `adminGroupId` | `resources.admin_group_id` | `group-6` | A-17 |
| `cuiGroupId` | `resources.cui_group_id` | `group-1` | D-09, G-03 |
| `trainingEnforcementGroupId` | `resources.training_enforcement_group_id` | `group-7` | G-02 |
| `namedLocationId` | `resources.named_location_id` | `namedLocation-1` | A-14, F-07 |
| `deviceComplianceCaPolicyId` | `resources.device_compliance_ca_policy_id` | `caPolicy-4` | B-07 |
| `adminPortalCaPolicyId` | `resources.admin_portal_ca_policy_id` | `caPolicy-5` | F-07 |
| `androidAppProtectionPolicyId` | `resources.android_app_protection_policy_id` | `androidManagedAppProtection-1` | B-08, B-09 |
| `iosAppProtectionPolicyId` | `resources.ios_app_protection_policy_id` | `iosManagedAppProtection-1` | B-09 |
| `cuiSiteId` | `resources.cui_site_id` | `https://simtenant.sharepoint.us/sites/cui` | D-05 |
| `globalAdminRoleDefId` | `resources.global_admin_role_def_id` | `62e90394-69f5-4237-9190-012177145e10` | A-09, A-10 |
| `privilegedRoleAdminDefId` | `resources.privileged_role_admin_role_def_id` | `e8611ab8-c189-46e8-94e1-60213ab1f814` | A-09 |
| `securityAdminRoleDefId` | `resources.security_admin_role_def_id` | `194ae4cb-b126-40b2-bd5b-6091b380977d` | A-09 |
| `operatorUPN` | `resources.operator_upn` | `sim.user1@simtenant.onmicrosoft.us` | A-11, F-08, H-01, H-02, H-03 |
| `breakGlassUPN` | `resources.breakglass_upn` | `sim.user2@simtenant.onmicrosoft.us` | A-11, A-15 |
| `resources.breakglass_upn` | `resources.breakglass_upn` | `sim.user2@simtenant.onmicrosoft.us` | A-19 |
| `itHelpDeskPhone` | `resources.it_helpdesk_phone` | `+1-555-0100` | B-06 |
| `keyVaultName` | `resources.kv_name` | `sim-kv-1` | C-03, C-05 |
| `auditLogRetentionDays` | `resources.audit_log_retention_days` | `365` | E-01 |
| `sentinelWorkspaceName` | `resources.law_name` | `sim-law-1` | E-01 |
| `resourceGroupName` | `subscription.resource_group` | `sim-rg-<slug>` | E-01, H-07 |
| `resources.resourceGroup` | `subscription.resource_group` | `sim-rg-<slug>` | F-11, F-12 |
| `resources.firewallName` | `resources.firewall_name` | `sim-fw-1` | F-11, F-12 |
| `resources.vnetName` | `resources.vnet_name` | `sim-vnet-1` | F-12 |
| `resources.publicIpName` | `resources.public_ip_name` | `sim-fw-pip-1` | F-12 |
| `subscription.resource_group` | `subscription.resource_group` | `sim-rg-<slug>` | F-13, F-14 |
| `resources.vnet_name` | `resources.vnet_name` | `sim-vnet-1` | F-13, F-14 |
| `resources.storage_account_name` | `resources.storage_account_name` | `simstorage1` | F-14 |
| `resources.law_name` | `resources.law_name` | `sim-law-1` | F-14 |
| `trainingRosterPath` | `resources.training_roster_path` | `<tenant-stacksim>/fixtures/training-roster.csv (absolute path)` | G-01, G-05 |
| `backupVaultName` | `resources.backup_vault_name` | `sim-rsv-1` | H-07 |

## Asks
1. Keep SourceBindings' current key list (it already tries these keys); if AO's GOAL M3 re-points registry
   `source` paths directly, use the tenant-object key column above.
2. Rebuild against tenant-stacksim `master` (dist) and re-run the matrix; the REQ-tenant-stacksim-ao-source-keys
   rows should all bind.

## Proof on the sim side
`tenant-stacksim/src/config/aoSourceKeys.test.ts` (reads ces-ao's registry read-only).
