# TCP Question Flow Analysis

**Generated:** 2026-03-28 | **Source:** CES-FE v1.0.0 codebase trace

---

## Overview

The Tenant Configuration Profile (TCP) wizard collects **37 answers** across **9 sections** that parameterize all M365/Azure tenant configuration in the CMMC compliance pipeline. TCP answers flow through: **Question -> TenantConfigProfile artifact -> 7 downstream consumers** (tenant manifest, infrastructure manifest, task enrichment, proposal, policy documents, manual plan, cross-artifact validation).

TCP profiles are scoped to a **customer + SI baseline** pair. 5 of 37 questions are auto-derived from SI baseline answers.

---

## 1. Question Catalog

### TCP-01: Tenant Identity (5 questions)

| ID | Field | Type | Values | SI Derived? |
|----|-------|------|--------|:-----------:|
| TCP.TI.001 | `identity.tenant_id` | guid | Free GUID | -- |
| TCP.TI.002 | `identity.primary_domain` | text | Free text | -- |
| TCP.TI.003 | `identity.custom_domains` | list | One per line | -- |
| TCP.TI.004 | `identity.cloud_environment` | single_select | Commercial, GCC, GCC High, DoD | **SI** |
| TCP.TI.005 | `identity.display_name` | text | Free text | -- |

### TCP-02: Licensing (4 questions)

| ID | Field | Type | Values | SI Derived? |
|----|-------|------|--------|:-----------:|
| TCP.LIC.001 | `licensing.primary_sku` | single_select | M365 G5/G3/E5/E3, O365 G5/G3, Other | -- |
| TCP.LIC.002 | `licensing.license_count` | number | Integer | **SI** |
| TCP.LIC.003 | `licensing.addon_skus` | list | One per line | -- |
| TCP.LIC.004 | `licensing.service_activations` | multi_select | Exchange, SharePoint, Teams, Intune, MDE, MDO, MDI, MDCA, AIP, Purview, Sentinel | -- |

### TCP-03: Identity Architecture (5 questions)

| ID | Field | Type | Values | SI Derived? |
|----|-------|------|--------|:-----------:|
| TCP.IA.001 | `identity_architecture.break_glass_accounts` | upn_list | One UPN per line | -- |
| TCP.IA.002 | `identity_architecture.admin_naming_convention` | text | Free text | -- |
| TCP.IA.003 | `identity_architecture.service_account_naming_convention` | text | Free text | -- |
| TCP.IA.004 | `identity_architecture.identity_provider` | single_select | Entra ID native, Hybrid AD Connect, Hybrid Cloud Sync, External IdP | **SI** |
| TCP.IA.005 | `identity_architecture.directory_sync_enabled` | boolean | Yes/No | **SI** |

### TCP-04: Privileged Access (5 questions)

| ID | Field | Type | Values | SI Derived? |
|----|-------|------|--------|:-----------:|
| TCP.PA.001 | `privileged_access.global_admins` | upn_list | One UPN per line | -- |
| TCP.PA.002 | `privileged_access.security_admins` | upn_list | One UPN per line | -- |
| TCP.PA.003 | `privileged_access.compliance_admins` | upn_list | One UPN per line | -- |
| TCP.PA.004 | `privileged_access.pim_enabled` | boolean | Yes/No | -- |
| TCP.PA.005 | `privileged_access.break_glass_exclusion_group` | text | Free text | -- |

### TCP-05: Group Architecture (4 questions)

| ID | Field | Type | Values | SI Derived? |
|----|-------|------|--------|:-----------:|
| TCP.GA.001 | `group_architecture.security_group_convention` | text | Free text | -- |
| TCP.GA.002 | `group_architecture.key_groups` | list | Name=Role per line | -- |
| TCP.GA.003 | `group_architecture.distribution_group_convention` | text | Free text | -- |
| TCP.GA.004 | `group_architecture.group_strategy` | single_select | Dynamic, Assigned, Mixed | -- |

### TCP-06: Conditional Access (3 questions)

| ID | Field | Type | Values | SI Derived? |
|----|-------|------|--------|:-----------:|
| TCP.CA.001 | `conditional_access.ca_naming_convention` | text | Free text | -- |
| TCP.CA.002 | `conditional_access.named_locations` | list | Name\|Type\|Value per line | -- |
| TCP.CA.003 | `conditional_access.existing_policy_count` | number | Integer | -- |

### TCP-07: Device Management (4 questions)

| ID | Field | Type | Values | SI Derived? |
|----|-------|------|--------|:-----------:|
| TCP.DM.001 | `device_management.enrollment_type` | single_select | Azure AD Join, Hybrid Join, Enroll Only, None | **SI** |
| TCP.DM.002 | `device_management.device_naming_convention` | text | Free text | -- |
| TCP.DM.003 | `device_management.compliance_policy_convention` | text | Free text | -- |
| TCP.DM.004 | `device_management.platforms_in_scope` | multi_select | Windows, macOS, iOS/iPadOS, Android, Linux | -- |

### TCP-08: Data Protection (4 questions)

| ID | Field | Type | Values | SI Derived? |
|----|-------|------|--------|:-----------:|
| TCP.DP.001 | `data_protection.sensitivity_label_convention` | text | Free text | -- |
| TCP.DP.002 | `data_protection.cui_sharepoint_sites` | list | One URL per line | -- |
| TCP.DP.003 | `data_protection.cui_teams_channels` | list | Team/Channel per line | -- |
| TCP.DP.004 | `data_protection.dlp_policy_convention` | text | Free text | -- |

### TCP-09: Monitoring & SIEM (5 questions)

| ID | Field | Type | Values | SI Derived? |
|----|-------|------|--------|:-----------:|
| TCP.MON.001 | `monitoring.sentinel_workspace_name` | text | Free text | -- |
| TCP.MON.002 | `monitoring.sentinel_resource_group` | text | Free text | -- |
| TCP.MON.003 | `monitoring.log_analytics_workspace_id` | guid | Free GUID | -- |
| TCP.MON.004 | `monitoring.data_connectors` | multi_select | Azure AD, M365, MDE, MDO, MDI, MDCA, Azure Activity, Office 365, AIP, Windows Security Events, Syslog | -- |
| TCP.MON.005 | `monitoring.alert_rule_convention` | text | Free text | -- |

---

## 2. SI Derivation Chain (5 auto-populated questions)

| TCP Question | SI Field | Transform | Provenance |
|-------------|----------|-----------|------------|
| TCP.TI.004 (cloud_environment) | `dependencies.tenant_model_preference` | gcc_high/dod_il5/dod_il6 -> "GCC High"; gcc -> "GCC"; commercial_only -> "Commercial" | `operator_inference` |
| TCP.IA.004 (identity_provider) | `scope.deployment_posture` | cloud_only -> "Entra ID native"; hybrid -> "Hybrid with AD Connect" | `operator_inference` |
| TCP.IA.005 (directory_sync) | `scope.deployment_posture` | hybrid -> true; else -> false | `operator_inference` |
| TCP.DM.001 (enrollment_type) | `operations.byod_posture` | not_allowed/allowed_vdi_only -> "Azure AD Join"; allowed_mdm -> "Enroll Only" | `operator_inference` |
| TCP.LIC.002 (license_count) | `scope.in_scope_users_estimate` | Direct pass-through (number) | `operator_inference` |

**Source:** `tcpSIDerivation.ts`

SI-derived answers are automatically skipped in wizard navigation. They appear with an "SI" badge in the section progress sidebar.

---

## 3. Risk Flags

The question bank defines risk flags that trigger advisor warnings:

| Question | Risk Flag | Trigger |
|----------|-----------|---------|
| TCP.TI.004 | `commercial_tenant_for_cui` | Commercial tenant selected (not GCC/GCC High) |
| TCP.LIC.001 | `g3_may_lack_compliance_features` | G3/E3 license selected |
| TCP.IA.001 | `no_break_glass_accounts` | Empty break-glass list |
| TCP.IA.004 | `external_idp_requires_federation_review` | External IdP selected |
| TCP.PA.001 | `too_many_global_admins` | Too many Global Admins |
| TCP.PA.004 | `pim_not_enabled` | PIM is disabled |
| TCP.CA.003 | `zero_ca_policies` | Zero CA policies exist |
| TCP.DM.001 | `no_device_enrollment` | "None" enrollment selected |

---

## 4. Downstream Consumers

### 4.1 Tenant Manifest Generator

**File:** `manifestGenerator.ts` | **Most fields consumed** (~30 of 37)

The tenant manifest is the primary consumer of TCP data. It produces:

**Tenant Identity Section** — direct passthrough of all identity + licensing fields.

**Assets** — enumerated from TCP lists:
| TCP Field | Asset Type |
|-----------|-----------|
| `break_glass_accounts` | `break_glass_account` per UPN |
| `global_admins` | `admin_account` per UPN |
| `security_admins` | `admin_account` per UPN |
| `compliance_admins` | `admin_account` per UPN |
| `key_groups` | `security_group` per group |
| `named_locations` | `network_location` per location |
| `cui_sharepoint_sites` | `data_boundary` per site |
| `cui_teams_channels` | `data_boundary` per channel |

**Config Intents** — CMMC-control-mapped configuration recipes:
| Config Intent | CMMC Control | Key TCP Fields |
|--------------|-------------|----------------|
| Conditional Access policies | AC.L2-3.1.1 | `ca_naming_convention`, `named_locations`, `tenant_id`, `break_glass_exclusion_group` |
| Device compliance | AC.L2-3.1.18 | `enrollment_type`, `compliance_policy_convention`, `platforms_in_scope` |
| Group architecture | AC.L2-3.1.2 | `security_group_convention`, `key_groups`, `group_strategy` |
| Data protection | SC.L2-3.13.1 | `sensitivity_label_convention`, `dlp_policy_convention`, `cui_sharepoint_sites`, `cui_teams_channels` |
| Identity provider | IA.L2-3.5.1 | `identity_provider`, `directory_sync_enabled`, `admin_naming_convention` |
| Privileged access | AC.L2-3.1.5 | `pim_enabled`, `security_admins`, `compliance_admins`, `service_account_naming_convention` |
| CA policy baseline | AC.L2-3.1.1 | `existing_policy_count` |
| Sentinel remediation | AU.L2-3.3.x | `sentinel_workspace_name`, `sentinel_resource_group` (conditional on connector gap) |

**Evidence Monitors** — ongoing compliance signals:
| Monitor | Control | TCP Fields |
|---------|---------|------------|
| Sentinel workspace | AU.L2-3.3.1 | `sentinel_workspace_name`, `sentinel_resource_group`, `log_analytics_workspace_id` |
| Data connector completeness | AU.L2-3.3.x | `data_connectors` + `isSentinelConnectorGap()` |
| Data protection | SC.L2-3.13.1 | `sensitivity_label_convention` |
| Privileged access | AC.L2-3.1.5 | `pim_enabled`, admin counts |
| Alert rules | AU.L2-3.3.1 | `alert_rule_convention` |

### 4.2 Infrastructure Manifest Generator

**File:** `infraManifestGenerator.ts` | **5 fields consumed**

| TCP Field | Usage |
|-----------|-------|
| `identity.primary_domain` | Derives naming prefix for all Azure resources |
| `identity.cloud_environment` | Determines Azure region (usgovvirginia vs eastus) and DNS suffix |
| `monitoring.sentinel_resource_group` | Resource group name for all Azure resources |
| `identity_architecture.break_glass_accounts[0]` | CA policy exclusion naming |
| `monitoring.sentinel_workspace_name` | Log Analytics Workspace name |

### 4.3 Task Compiler — TCP Enrichment

**File:** `taskCompiler.ts:enrichTaskWithTCP()` | **~25 fields consumed**

Injects `[TCP Context]` and `[TCP Verification]` into task `what_to_do` and `how_to_verify` fields, per CMMC control domain:

| Control Pattern | TCP Section Used |
|----------------|-----------------|
| AC.L2-3.1.1 (access control) | Conditional Access (convention, locations, count, break-glass group) |
| AC.L2-3.1.2 (least privilege) | Group Architecture (conventions, key groups, strategy) |
| AC.L2-3.1.5 (privileged access) | Privileged Access (PIM, admins, service accounts) |
| AC.L2-3.1.18/19 (device mgmt) | Device Management (enrollment, conventions, platforms) |
| IA.L2-3.5.x (identification) | Identity Architecture (provider, sync, admin convention) |
| SC.L2-3.13.x (system protection) | Data Protection (labels, DLP, SharePoint sites, Teams channels) |
| AU.L2-3.3.x (audit) | Monitoring (Sentinel workspace, connectors, alert convention) |

### 4.4 Proposal Generator

**File:** `proposalGenerator.ts` | **~10 fields consumed**

**Assumptions block:**
| TCP Field | Assumption Generated |
|-----------|---------------------|
| `cloud_environment` | "Cloud environment: GCC High" |
| `primary_sku` + `license_count` | "Licensing: G5 (50 seats)" |
| `identity_provider` | "Identity model: Entra ID native" |
| `pim_enabled` | "PIM: Enabled" |
| `cui_sharepoint_sites` + `cui_teams_channels` | "CUI data locations: 3 sites, 2 channels" |

**Boundary compliance:**
| TCP Field | Compliance Check |
|-----------|-----------------|
| `cloud_environment` | Tenant environment compliance |
| `pim_enabled` | PIM status |
| `sensitivity_label_convention` + `dlp_policy_convention` | Data protection readiness |
| `identity_provider` | Identity model |
| admin counts | Admin account count |
| `sentinel_workspace_name` | Sentinel configured flag |

### 4.5 Policy Context Compiler

**File:** `policyContextCompiler.ts` | **13 fields -> `tenant.*` namespace**

| Template Variable | TCP Field |
|-------------------|-----------|
| `tenant.tenant_id` | `identity.tenant_id` |
| `tenant.primary_domain` | `identity.primary_domain` |
| `tenant.cloud_environment` | `identity.cloud_environment` |
| `tenant.primary_sku` | `licensing.primary_sku` |
| `tenant.pim_enabled` | `privileged_access.pim_enabled` |
| `tenant.sentinel_workspace` | `monitoring.sentinel_workspace_name` |
| `tenant.data_connectors` | `monitoring.data_connectors` |
| `tenant.enrollment_type` | `device_management.enrollment_type` |
| `tenant.sensitivity_labels` | `data_protection.sensitivity_label_convention` |
| `tenant.dlp_convention` | `data_protection.dlp_policy_convention` |
| `tenant.identity_provider` | `identity_architecture.identity_provider` |
| `tenant.ca_naming` | `conditional_access.ca_naming_convention` |
| `tenant.has_tenant` | `!!tcp.identity` (boolean) |

These feed into 17 Handlebars Markdown policy document templates.

### 4.6 Manual Plan Generator

**File:** `manualPlanGenerator.ts` | **~8 fields consumed**

- Adds `tcp_ref` to plan inputs (artifact metadata)
- Injects assets: break-glass accounts, admin accounts, CUI SharePoint sites, CUI Teams channels

### 4.7 Cross-Artifact Validator

**File:** `validator.ts` | **4 consistency checks**

| Check | TCP Fields | Assertion |
|-------|-----------|-----------|
| 9a | (TCP exists) | Manifest must have `tenant_identity` section |
| 9b | `sensitivity_label_convention`, `dlp_policy_convention`, `cui_sharepoint_sites`, `cui_teams_channels` | Manifest must have `SC.L2-3.13.1` config intent |
| 9c | `data_connectors` | Manifest must have `AU.L2-3.3.x` evidence monitor |
| 9d | `pim_enabled`, `security_admins`, `compliance_admins` | Manifest must have `AC.L2-3.1.5` config intent |

---

## 5. Data Persistence

| Layer | Location | Details |
|-------|----------|---------|
| Wizard state | localStorage `ces-tcp-store` | Zustand persisted: answers, section progress, cursor position |
| Artifact | IndexedDB `tenant_config_profiles` | Index: `[customerId+baselineId]`, auto-increment ID |
| Disk (dev) | `customers/{name}/inputs/tenant-config-profile-{id}.json` | Via Vite dev server API |
| App store | localStorage `ces-app-store` | `selectedTenantConfigId` — reset on customer/baseline change |

Cascade: baseline deletion cascades to all TCP profiles with that baselineId.

---

## 6. Data Flow Diagram

```
SI Baseline (5 derived answers)
  |
  v
YAML Question Bank (37 questions, 9 sections)  +  Help Overlay (guidance)
  |                                                    |
  +----------------------------------------------------+
  |
  v
TCPWizard (orchestration)
  |-- SI Derivation (5 questions: TI.004, IA.004, IA.005, DM.001, LIC.002)
  |-- YAML Recommendations (all questions with `recommended` values)
  |-- Previous Run Hydration (reverseMapProfile from existing DB record)
  |-- Autofill Service (recommendations + SI derivation + type defaults)
  |
  v
TCPStore (Zustand, persisted to localStorage)
  |
  v
tcpProfileGenerator (normalize enums, parse structures)
  |
  v
TenantConfigProfileOutput (9-section structured artifact)
  |
  v
Save to IndexedDB + disk -> selectedTenantConfigId in AppStore
  |
  v
useMissionPlanGenerator (loads from DB, passes to ALL generators)
  |
  +-> Tenant Manifest       (tenant_identity, assets, config_intents, evidence_monitors)
  +-> Infrastructure Manifest (naming prefix, Azure region, resource group, LAW name)
  +-> Task Compiler          (enrichTaskWithTCP per CMMC control)
  +-> Proposal               (assumptions, boundary compliance)
  +-> Manual Plan            (input refs, inline assets)
  +-> Policy Context         (tenant.* namespace for 17 Handlebars templates)
  +-> Validator              (4 cross-artifact consistency checks)
```

---

## 7. Impact Summary Matrix

| TCP Field | Tenant Manifest | Infra Manifest | Task Enrichment | Proposal | Policy | Manual Plan | Validator |
|-----------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| `identity.tenant_id` | Identity + CA intent | -- | -- | -- | Yes | -- | -- |
| `identity.primary_domain` | Identity | Naming prefix | -- | -- | Yes | -- | -- |
| `identity.custom_domains` | Identity | -- | -- | -- | -- | -- | -- |
| `identity.cloud_environment` | Identity | Azure region | -- | Assumption + compliance | Yes | -- | -- |
| `identity.display_name` | Identity | -- | -- | -- | -- | -- | -- |
| `licensing.primary_sku` | Identity + gap detect | -- | -- | Assumption | Yes | -- | -- |
| `licensing.license_count` | Identity | -- | -- | Assumption | -- | -- | -- |
| `licensing.addon_skus` | Identity | -- | -- | -- | -- | -- | -- |
| `licensing.service_activations` | Identity + gap detect | -- | -- | -- | -- | -- | -- |
| `break_glass_accounts` | Assets | CA exclusion | -- | -- | -- | Assets | -- |
| `admin_naming_convention` | IdP intent | -- | IA.L2-3.5.x | -- | -- | -- | -- |
| `service_account_naming_convention` | PA intent | -- | AC.L2-3.1.5 | -- | -- | -- | -- |
| `identity_provider` | IdP intent | -- | IA.L2-3.5.x | Assumption + compliance | Yes | -- | -- |
| `directory_sync_enabled` | IdP intent | -- | IA.L2-3.5.x | -- | -- | -- | -- |
| `global_admins` | Assets + monitor | -- | AC.L2-3.1.5 | Admin count | -- | Assets | -- |
| `security_admins` | Assets + PA intent + monitor | -- | AC.L2-3.1.5 | Admin count | -- | Assets | Check 9d |
| `compliance_admins` | Assets + PA intent + monitor | -- | AC.L2-3.1.5 | Admin count | -- | Assets | Check 9d |
| `pim_enabled` | PA intent + monitor | -- | AC.L2-3.1.5 | Assumption + compliance | Yes | -- | Check 9d |
| `break_glass_exclusion_group` | CA intent | -- | AC.L2-3.1.1 | -- | -- | -- | -- |
| `security_group_convention` | Group intent | -- | AC.L2-3.1.2 | -- | -- | -- | -- |
| `key_groups` | Assets + group intent | -- | AC.L2-3.1.2 | -- | -- | -- | -- |
| `distribution_group_convention` | Group intent | -- | AC.L2-3.1.2 | -- | -- | -- | -- |
| `group_strategy` | Group intent | -- | AC.L2-3.1.2 | -- | -- | -- | -- |
| `ca_naming_convention` | CA intent | -- | AC.L2-3.1.1 | -- | Yes | -- | -- |
| `named_locations` | Assets + CA intent | -- | AC.L2-3.1.1 | -- | -- | -- | -- |
| `existing_policy_count` | CA baseline intent | -- | AC.L2-3.1.1 | -- | -- | -- | -- |
| `enrollment_type` | Device intent | -- | AC.L2-3.1.18/19 | -- | Yes | -- | -- |
| `device_naming_convention` | Device intent | -- | AC.L2-3.1.18/19 | -- | -- | -- | -- |
| `compliance_policy_convention` | Device intent | -- | AC.L2-3.1.18/19 | -- | -- | -- | -- |
| `platforms_in_scope` | Device intent | -- | AC.L2-3.1.18/19 | -- | -- | -- | -- |
| `sensitivity_label_convention` | DP intent + monitor | -- | SC.L2-3.13.x | Compliance | Yes | -- | Check 9b |
| `cui_sharepoint_sites` | Assets + DP intent | -- | SC.L2-3.13.x | Location count | -- | Assets | Check 9b |
| `cui_teams_channels` | Assets + DP intent | -- | SC.L2-3.13.x | Location count | -- | Assets | Check 9b |
| `dlp_policy_convention` | DP intent | -- | SC.L2-3.13.x | Compliance | Yes | -- | -- |
| `sentinel_workspace_name` | Remediation + monitor | LAW name | AU.L2-3.3.x | Configured flag | Yes | -- | -- |
| `sentinel_resource_group` | Remediation + monitor | Resource group | AU.L2-3.3.x | -- | -- | -- | -- |
| `log_analytics_workspace_id` | Monitor | -- | AU.L2-3.3.x | -- | -- | -- | -- |
| `data_connectors` | Gap detect + monitor | -- | AU.L2-3.3.x | -- | Yes | -- | Check 9c |
| `alert_rule_convention` | Monitor | -- | AU.L2-3.3.x | -- | -- | -- | -- |

**Total downstream touchpoints:** Every TCP field reaches at least 1 consumer. The tenant manifest is the most comprehensive consumer (~30 fields). Task enrichment covers ~25 fields across 7 CMMC control domains.
