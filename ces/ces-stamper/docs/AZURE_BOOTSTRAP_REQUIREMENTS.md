# Azure Bootstrap Requirements — Enclave Models

This document describes the three infrastructure deployment models (enclaves) supported by Stamper for CMMC L2 compliance. Each enclave represents a different level of Azure infrastructure investment, allowing organizations to scope their compliance automation to match their actual deployment footprint.

## Overview

Stamper's infrastructure registry contains 70 Azure-related entries organized into four tiers:

- **none** (5 entries) — Entra ID / identity baseline (no Azure subscription required)
- **foundation** (10 entries) — Minimal Azure bootstrap (subscription, resource group, DNS, networking foundation)
- **sentinel** (30 entries) — Security telemetry stack (Log Analytics, Key Vault, Sentinel, monitoring, automation, diagnostics)
- **full** (25 entries) — Complete Azure IaaS (VNets, NSGs, Firewall, Bastion, VMs)

Organizations select one of three enclave models in their tenant configuration, which controls which infrastructure entries are assessed, translated, and executed.

## Enclave Models

### 1. M365 Only (`m365_only`)

**Use Case:** Organizations using M365 GCC High for collaboration and compliance workloads without any Azure subscription. All compliance controls are met through M365 configuration and Entra ID.

**Infrastructure Scope:**
- Entra ID configuration (identity tier)
- No Azure subscription required
- No Azure infrastructure provisioned

**Included Tiers:** `none` (5 entries)

**Registry Entries:**
- AZ-ID-001 — Enable MFA enforcement policy
- AZ-ID-002 — Configure password policies
- AZ-ID-003 — Enable security defaults
- AZ-ID-004 — Configure conditional access policies
- AZ-ID-005 — Enable identity protection

**CMMC Impact:**
- Controls exclusively requiring Azure infrastructure are marked as `out_of_scope`
- Controls with M365 implementations remain applicable and evaluated normally
- Mixed controls (M365 + Azure entries) are satisfied if M365 entries exist

**Limitations:**
- No Azure-based logging aggregation (Log Analytics)
- No Sentinel SIEM integration
- No Azure Key Vault for secret management
- No Azure IaaS workloads

### 2. M365 + Sentinel (`m365_sentinel`)

**Use Case:** Organizations using M365 GCC High with Azure subscription for security telemetry and SIEM. Provides centralized logging, secret management, and Sentinel-based threat detection without full IaaS deployment.

**Infrastructure Scope:**
- Entra ID configuration (identity tier)
- Azure subscription with minimal compute footprint
- Log Analytics workspace for centralized logging
- Key Vault for secret/certificate management
- Sentinel workspace for SIEM and threat detection
- Monitoring and alerting infrastructure

**Included Tiers:** `none` (5) + `foundation` (10) + `sentinel` (30) = 45 entries

**Registry Entries:**

| Tier | Entry IDs |
|------|-----------|
| **none** | AZ-ID-001, AZ-ID-002, AZ-ID-003, AZ-ID-004, AZ-ID-005 |
| **foundation** | AZ-PREFLIGHT-001, AZ-CTX-001, AZ-FOUND-001, AZ-FOUND-002, AZ-FOUND-003, AZ-FOUND-004, AZ-DNS-001, AZ-DNS-002, AZ-BOUNDARY-001, AZ-SUBNET-001 |
| **sentinel** | AZ-LOG-001, AZ-LOG-002, AZ-LOG-002a, AZ-LOG-002b, AZ-LOG-002c, AZ-LOG-003, AZ-LOG-004, AZ-KV-001, AZ-KV-002, AZ-KV-003, AZ-KV-004, AZ-AUTO-001, AZ-AUTO-002, AZ-AUTO-003, AZ-SEN-001, AZ-SEN-002, AZ-SEN-003, AZ-SEN-004, AZ-SEN-005, AZ-SEN-006, AZ-SEN-007, AZ-SEN-008, AZ-SEN-009, AZ-SEN-010, AZ-MON-001, AZ-DIAG-001, AZ-DIAG-002, AZ-DIAG-004, AZ-DIAG-006, AZ-DIAG-007 |

**CMMC Impact:**
- Controls requiring full IaaS (VMs, Firewall, Bastion, Network Security Groups) are marked as `out_of_scope`
- Log aggregation and monitoring controls are satisfied via Log Analytics and Sentinel
- Secret management controls are satisfied via Key Vault

**Limitations:**
- No Azure IaaS workloads (VMs, virtual networks, firewalls)
- No network segmentation via NSGs/Firewall
- No private endpoints or Bastion access
- No VM-level diagnostics or automation

### 3. M365 + Full Azure (`m365_azure`)

**Use Case:** Organizations using M365 GCC High with full Azure IaaS deployment. Supports all CMMC L2 infrastructure controls including network segmentation, VM workloads, firewall rules, and Bastion access.

**Infrastructure Scope:**
- All capabilities from M365 + Sentinel enclave
- Virtual networks with subnet segmentation
- Network Security Groups (NSGs) for micro-segmentation
- Azure Firewall for perimeter security
- Azure Bastion for secure VM access
- Private Endpoints for service lockdown
- Virtual machines with diagnostics and automation
- Complete monitoring and diagnostics coverage

**Included Tiers:** `none` (5) + `foundation` (10) + `sentinel` (30) + `full` (25) = 70 entries

**Registry Entries:** All 70 infrastructure entries (full registry coverage)

**CMMC Impact:**
- All infrastructure controls are in scope
- No controls are marked as `out_of_scope` due to infrastructure tier exclusions
- Maximum compliance posture with full infrastructure automation

## Configuration

Set the `infrastructure_model` field in your tenant JSON configuration:

```json
{
  "client": { "name": "Example Corp", "slug": "example" },
  "tenant": { "tenant_id": "...", "domain": "example.onmicrosoft.us" },
  "infrastructure_model": "m365_sentinel",
  "subscription": {
    "subscription_id": "...",
    "resource_group": "rg-example-cmmc",
    "location": "usgovvirginia"
  }
}
```

**Valid values:**
- `"m365_only"` — Identity only (5 entries)
- `"m365_sentinel"` — Identity + security telemetry (37 entries)
- `"m365_azure"` — Full stack (70 entries) [default]

If `infrastructure_model` is not specified, Stamper defaults to `"m365_azure"` for backward compatibility.

## Migration Guidance

### From M365 Only to M365 + Sentinel

**Prerequisites:**
- Provision Azure subscription in GCC High
- Create resource group and Log Analytics workspace
- Provision Key Vault
- Deploy Sentinel workspace

**Steps:**
1. Update tenant JSON: set `infrastructure_model` to `"m365_sentinel"`
2. Add `subscription` block with Azure subscription details
3. Add `resources` block with `law_name`, `kv_name` values
4. Run Assess workflow to discover newly in-scope infrastructure
5. Generate and execute plan to provision Sentinel stack (37 entries)

**Expected Changes:**
- 40 additional entries move from `out_of_scope` to `wont_be_satisfied` or `satisfied`
- Controls related to logging (AU family), secret management (IA family), and automation become satisfied

### From M365 + Sentinel to Full Azure

**Prerequisites:**
- Existing Sentinel deployment
- Network architecture plan (subnets, NSG rules, firewall policies)
- VM sizing and image selection
- Bastion configuration

**Steps:**
1. Update tenant JSON: set `infrastructure_model` to `"m365_azure"`
2. Add additional resource values: `vnet_name`, `nsg_name`, `vm_name`, etc.
3. Run Assess workflow to discover full infrastructure scope (70 entries)
4. Generate and execute plan to provision full IaaS stack

**Expected Changes:**
- 25 additional entries move from `out_of_scope` to in-scope
- Controls related to network security (SC family) and system configuration (CM family) become satisfied
- Total infrastructure entry count increases from 45 to 70

### Downgrading (Reducing Scope)

**Warning:** Changing from a higher enclave to a lower one (e.g., `m365_azure` → `m365_sentinel`) does NOT deprovision existing Azure resources. It only changes which controls Stamper considers in-scope.

**Steps:**
1. Manually deprovision out-of-scope resources (or retain for other purposes)
2. Update tenant JSON: set `infrastructure_model` to lower tier
3. Run Assess workflow to confirm new scope
4. Review CMMC analysis: previously satisfied controls may now show as `out_of_scope`

**CMMC Impact:**
- Controls exclusively satisfied by deprovisioned resources move to `out_of_scope`
- Controls with M365 fallbacks remain satisfied
- Compliance posture dashboard reflects reduced infrastructure scope

## Tier Assignment Reference

### None Tier (5 entries)
Entra ID identity baseline — no Azure subscription required

### Foundation Tier (10 entries)
Minimal Azure bootstrap: subscription setup, resource group, DNS zone, networking foundation

**Entry IDs:** AZ-PREFLIGHT-001, AZ-CTX-001, AZ-FOUND-001, AZ-FOUND-002, AZ-FOUND-003, AZ-FOUND-004, AZ-DNS-001, AZ-DNS-002, AZ-BOUNDARY-001, AZ-SUBNET-001

### Sentinel Tier (30 entries)
Security telemetry stack: Log Analytics, Key Vault, Sentinel, monitoring, automation, diagnostics for sentinel resources

**Entry IDs:** AZ-LOG-001, AZ-LOG-002, AZ-LOG-002a, AZ-LOG-002b, AZ-LOG-002c, AZ-LOG-003, AZ-LOG-004, AZ-KV-001, AZ-KV-002, AZ-KV-003, AZ-KV-004, AZ-AUTO-001, AZ-AUTO-002, AZ-AUTO-003, AZ-SEN-001, AZ-SEN-002, AZ-SEN-003, AZ-SEN-004, AZ-SEN-005, AZ-SEN-006, AZ-SEN-007, AZ-SEN-008, AZ-SEN-009, AZ-SEN-010, AZ-MON-001, AZ-DIAG-001, AZ-DIAG-002, AZ-DIAG-004, AZ-DIAG-006, AZ-DIAG-007

### Full Tier (25 entries)
Complete Azure IaaS: VNets, NSGs, Firewall, Bastion, Private Endpoints, VMs, IaaS diagnostics

**Entry IDs:** AZ-NET-001, AZ-NET-002, AZ-NET-003, AZ-NET-004, AZ-NET-005, AZ-NSG-001, AZ-NSG-002, AZ-NSG-003, AZ-NSG-004, AZ-NSG-005, AZ-NW-001, AZ-NW-002, AZ-FW-000, AZ-FW-001, AZ-FW-002, AZ-BAS-001, AZ-BAS-002, AZ-PE-001, AZ-PE-002, AZ-VM-001, AZ-VM-002, AZ-VM-003, AZ-VM-004, AZ-DIAG-003, AZ-DIAG-005

## Architecture Notes

- **Tier field:** Each registry entry has an `azure_tier` field with values `'none'`, `'foundation'`, `'sentinel'`, or `'full'`
- **M365 registry:** All M365 entries have `azure_tier = 'none'` by default and are included in all enclave models
- **Filtering logic:** Enclave filtering happens at consumption points (assess, translate) rather than registry load — the central registry always contains all 70 entries for audit and reporting purposes
- **Mixed controls:** Controls mapped to both M365 and Azure entries are partially filtered — Azure entries may be excluded while M365 entries remain, allowing the control to still be satisfied if M365 implementation exists
- **Out of scope category:** Controls where ALL implementing entries are excluded by enclave filter are marked as `out_of_scope` in CMMC analysis, distinguishing them from `wont_be_satisfied` (applicable but not implemented)
