# REQ-tenant-stacksim-ao-source-keys — tenant-object keys for AO's tenant-sourced parameters

- **From:** ces-ao (W4-AO2, 2026-09-27)
- **To:** tenant-stacksim (owner of `buildSimTenantConfig`, `src/config/SimTenantConfig.ts`, and of the AO scenario seed)
- **Related:** `../../tenant-stacksim/GOAL-AO-SIM-COVERAGE-2026-09-26.md` M1 ("variable values live in the Stamper tenant object"); `INSTRUCTIONS-FROM-TESTER-2026-09-26.md` §2 update (founder decisions 2026-09-26). The `REQ-ao-source-paths.md` table that stacksim was to publish has not landed; this file proposes the keys instead, per that instruction ("If you need a key before it lands, propose it in a REQ file").
- **Status:** MET (2026-09-28, FC-AO-2) — the 95-op matrix on the fixed sim shows 0 ops open against this REQ (`docs/AO-95-OP-MATRIX.md`: PASS 94 · HONEST-OPEN 1 · FAILING 0; the one open op, B-08, is `REQ-tenant-stacksim-ao-paired-read-endpoints`)

## What

AO binds every registry `parameter.source` through one table, `ces-ao/src/execution/SourceBindings.ts`
(`SOURCE_BINDINGS`). Each source reads, in order: the literal source path, then canonical Stamper
tenant-object keys (`resources.<snake_case>` / `subscription.*`), then — only for built-in Entra role
template ids — a platform constant. A required value that none of these supply fails with a named
error (`UnboundSourceError`) and an evidenced `failed` row; nothing is sent to the tenant.

Against the tenant object stacksim emits today (`buildSimTenantConfig`, stance `m365_azure`), the keys
below are **absent**, so the listed AO commands cannot bind. Please emit them in the tenant object
(`resources` block, snake_case, deterministic sim-style values) and **seed the matching objects** so
the value names something that exists in the sim.

## Keys requested (resources.*)

| Key | AO source | Blocks | Value must name (seed) |
|---|---|---|---|
| `m365_license_sku_id` | `m365LicenseSkuId` | A-01 | the G5 GCC High SKU in `subscribedSkus` (OD-6: sim-style id, e.g. `sim-sku-g5`) |
| `base_group_id` | `baseGroupId` | A-01 | a security group every new hire joins |
| `loa_group_id` | `loaGroupId` | A-05, A-06 | a "leave of absence" block group |
| `admin_group_id` | `adminGroupId` | A-17 | the privileged-admin group |
| `cui_group_id` | `cuiGroupId` | D-09, G-03 | the CUI-authorized group (seed has `group-1` "CUI-Authorized-Users"; `resources.cui_group_name` today is "Sim Group 1", which matches no seeded group — please align) |
| `training_enforcement_group_id` | `trainingEnforcementGroupId` | G-02 | the "training not complete" restriction group |
| `named_location_id` | `namedLocationId` | A-14, F-07 | a trusted named location (seed has `namedLocation-1`) |
| `device_compliance_ca_policy_id` | `deviceComplianceCaPolicyId` | B-07 | the "require compliant device" CA policy |
| `admin_portal_ca_policy_id` | `adminPortalCaPolicyId` | F-07 | the admin-portal IP-restriction CA policy |
| `android_app_protection_policy_id` | `androidAppProtectionPolicyId` | B-08, B-09 | an Android MAM app protection policy (no MAM collection is seeded today) |
| `ios_app_protection_policy_id` | `iosAppProtectionPolicyId` | B-09 | an iOS MAM app protection policy |
| `cui_site_id` | `cuiSiteId` | D-05 | the CUI SharePoint site (no SPO site collection is seeded today) |
| `firewall_name` | `resources.firewallName` | F-11, F-12 | the seeded Azure Firewall (seed has `firewall-1` named `sim-fw-1`) |
| `public_ip_name` | `resources.publicIpName` | F-12 | the firewall's public IP (not seeded today) |
| `audit_log_retention_days` | `auditLogRetentionDays` | E-01 | the tenant's required retention (e.g. `365`) |
| `it_helpdesk_phone` | `itHelpDeskPhone` | B-06 | a helpdesk number shown on a wiped device |
| `training_roster_path` | `trainingRosterPath` | G-01, G-05 | a sim-safe roster the command can read (a local CSV path; G-01/G-05 use `Import-Csv`) |
| `backup_vault_name` | `backupVaultName` | H-07 | a Recovery Services vault with backup jobs (none is seeded today; H-07's vault/RG were empty literals before W4) |

Optional (AO falls back to the built-in Entra role template ids, which are identical in every tenant):
`global_admin_role_def_id`, `privileged_role_admin_role_def_id`, `security_admin_role_def_id` (A-09).
For A-09/A-10 to *find* anything in the sim, seed PIM eligibility schedules / role assignments whose
`roleDefinitionId` is the real built-in id (`62e90394-69f5-4237-9190-012177145e10` etc.), not `role-1`.

Keys AO already binds from the stacksim tenant object (no action): `operator_upn`, `breakglass_upn`,
`kv_name`, `law_name`, `vnet_name`, `storage_account_name`, `subscription.resource_group`, `tenantId`.

## Evidence

`ces-ao/test/sourceBindings.test.ts` builds the real stacksim tenant object (`buildSimTenantConfig`,
`m365_azure`), parses it through ces-tenant's registry like production, and enumerates every AO command
with a tenant-sourced parameter. Each either binds, or fails with `UnboundSourceError` whose missing keys
are all listed in the table above (the test reads this file).

## Acceptance test

With the keys emitted: `AO_STACKSIM_IT=1 npx vitest run test/integration` in ces-ao — the
`sourceBindings` enumeration reports zero unbound commands, and the rows for the listed ops in
`docs/AO-95-OP-MATRIX.md` move from HONEST-OPEN to PASS.
