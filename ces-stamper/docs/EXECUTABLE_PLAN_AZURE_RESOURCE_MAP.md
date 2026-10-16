# Executable Plan — Azure Resource Creation Map
Generated from: executable-plan-2026-03-19T03-26-08-209Z.json

**Generation Date:** 2026-03-21
## Summary
- **Total Azure operations:** 70
- **Creates:** 37 (New-Az* commands)
- **Configures:** 24 (Set-Az*, Enable-*, Add-* on existing resources)
- **Evidence-only:** 9 (Get-Az* queries)
- **Layers spanned:** L1 through L7
## Execution Order (All Azure Operations)
| Order | Layer | Entry ID | Label | Action | Resource Type | Tier | Captures | Dependencies |
|-------|-------|----------|-------|--------|---------------|------|----------|--------------|
| 2 | L1 | AZ-ID-005 | PIM Eligible Role Assignment for Operator | EVIDENCE | PIM Eligibility | none | — | **operatorUserId** |
| 0 | L1 | AZ-BAS-001 | Create Bastion Public IP | CREATE | Public IP | full | — | resourceGroup, location |
| 1 | L1 | AZ-BAS-002 | Create Azure Bastion Host | CREATE | Bastion Host | full | — | resourceGroup, vnetName |
| 8 | L4 | AZ-SEN-001 | Onboard Sentinel to Log Analytics Workspace | CREATE | Sentinel Onboarding | sentinel | — | subscriptionId, resourceGroup, lawWorkspaceName |
| 9 | L4 | AZ-SEN-002 | Enable Sentinel Azure Activity Data Connector | CREATE | Sentinel Data Connector | sentinel | — | resourceGroup, subscriptionId, lawWorkspaceName |
| 10 | L4 | AZ-SEN-003 | Enable Sentinel Microsoft Defender for Cloud Data Connector | CREATE | Sentinel Data Connector | sentinel | — | resourceGroup, lawWorkspaceName |
| 11 | L4 | AZ-SEN-004 | Enable Sentinel Azure Key Vault Data Connector | CREATE | Sentinel Data Connector | sentinel | — | resourceGroup, lawWorkspaceName |
| 12 | L4 | AZ-SEN-005 | Create Sentinel CMMC Analytics Rule — Privileged Identity Changes | CREATE | Sentinel Alert Rule | sentinel | — | resourceGroup, lawWorkspaceName |
| 13 | L4 | AZ-SEN-006 | Create Sentinel CMMC Analytics Rule — Malware Detection | CREATE | Sentinel Alert Rule | sentinel | — | resourceGroup, lawWorkspaceName |
| 4 | L4 | AZ-FOUND-004 | Resource Group CanNotDelete Lock | CREATE | Resource Lock | foundation | — | resourceGroup |
| 6 | L4 | AZ-FOUND-003 | Enable Microsoft Defender for Cloud (P2) | CONFIGURE | Defender for Cloud | foundation | — | — |
| 14 | L4 | AZ-SEN-007 | Create Sentinel CMMC Analytics Rule — Excessive Failed Logins | CREATE | Sentinel Alert Rule | sentinel | — | resourceGroup, lawWorkspaceName |
| 15 | L4 | AZ-SEN-008 | Create Sentinel CMMC Analytics Rule — Unauthorized Resource Deletion | CREATE | Sentinel Alert Rule | sentinel | — | resourceGroup, lawWorkspaceName |
| 16 | L4 | AZ-SEN-009 | Sentinel CMMC 2.0 Content Hub Solution | EVIDENCE | Sentinel Content Hub | sentinel | — | subscriptionId, resourceGroup, lawWorkspaceName |
| 3 | L4 | AZ-VM-002 | Enable VM Disk Encryption (CMK via Key Vault) | CONFIGURE | VM Disk Encryption | full | — | resourceGroup, vmName, **kvUri, kvResourceId** |
| 5 | L4 | AZ-VM-003 | Assign DISA STIG Policy to VM | CREATE | Policy Assignment | full | — | subscriptionId, resourceGroup, vmName |
| 7 | L4 | AZ-VM-004 | Install Microsoft Defender for Endpoint VM Extension | CONFIGURE | VM Extension | full | — | resourceGroup, vmName, lawWorkspaceName, **lawWorkspaceId** |
| 17 | L6 | AZ-BOUNDARY-001 | Verify Network Security Group Boundary Rules | EVIDENCE | NSG Verification | foundation | — | resourceGroup |
| 18 | L6 | AZ-CTX-001 | Set Azure Subscription Context | CONFIGURE | Unknown | foundation | — | subscriptionId |
| 46 | L6 | AZ-SUBNET-001 | Verify VNet Subnet Segmentation | EVIDENCE | Virtual Network | foundation | — | resourceGroup |
| 47 | L6 | AZ-LOG-002a | Assign System Managed Identity to Storage Account | CONFIGURE | Storage Account Identity | sentinel | storageMiPrincipalId | resourceGroup, storageAccountName |
| 19 | L6 | AZ-PREFLIGHT-001 | Register Required Azure Resource Providers | CREATE | Unknown | foundation | — | — |
| 23 | L6 | AZ-KV-001 | Create Key Vault (purge-protection enabled) | CREATE | Key Vault | sentinel | kvResourceId, kvUri | resourceGroup, location, keyVaultName |
| 20 | L6 | AZ-FOUND-001 | Create Azure Resource Group | CREATE | Resource Group | foundation | — | resourceGroup, location |
| 48 | L6 | AZ-KV-002 | Assign Key Vault Crypto Officer Role to EO Service Principal | CREATE | RBAC Role Assignment | sentinel | — | resourceGroup, keyVaultName, **eoSpObjectId** |
| 21 | L6 | AZ-FOUND-002 | Assign CMMC L2 Azure Policy Initiative | CREATE | Policy Assignment | foundation | — | subscriptionId |
| 49 | L6 | AZ-KV-003 | Create CMK Key in Key Vault (RSA-HSM 4096) | CREATE | Key Vault Key | sentinel | cmkKeyVersion | keyVaultName, cmkKeyName |
| 50 | L6 | AZ-LOG-002b | Grant Storage MI Key Vault Crypto Service Encryption User Role | CREATE | RBAC Role Assignment | sentinel | — | **storageMiPrincipalId, kvResourceId** |
| 51 | L6 | AZ-LOG-002c | Enable CMK Encryption on Storage Account | CONFIGURE | Storage Account Encryption | sentinel | — | resourceGroup, storageAccountName, cmkKeyName, **kvUri** |
| 52 | L6 | AZ-KV-004 | Restrict Key Vault Network Access to Azure Services Only | CONFIGURE | Key Vault Network ACL | sentinel | — | keyVaultName |
| 24 | L6 | AZ-NET-001 | Create Virtual Network | CREATE | Virtual Network | full | — | resourceGroup, location, vnetName, vnetCidr |
| 25 | L6 | AZ-NET-002 | Create Management Subnet | CONFIGURE | VNet Subnet | full | — | resourceGroup, vnetName, mgmtSubnetCidr |
| 22 | L6 | AZ-ID-003 | EO Automation Service Principal | EVIDENCE | Entra ID Service Principal | none | eoSpObjectId | appId |
| 26 | L6 | AZ-NET-003 | Create Workload Subnet | CONFIGURE | VNet Subnet | full | — | resourceGroup, vnetName, workloadSubnetCidr |
| 27 | L6 | AZ-NET-004 | Create AzureBastionHost Subnet | CONFIGURE | VNet Subnet | full | — | resourceGroup, vnetName, bastionSubnetCidr |
| 28 | L6 | AZ-NET-005 | Create AzureFirewall Subnet | CONFIGURE | VNet Subnet | full | — | resourceGroup, vnetName, firewallSubnetCidr |
| 29 | L6 | AZ-NSG-001 | Create Network Security Group | CREATE | Network Security Group | full | — | resourceGroup, location |
| 30 | L6 | AZ-NSG-002 | Add NSG Rule — Deny All Inbound | CONFIGURE | NSG Rule | full | — | resourceGroup |
| 31 | L6 | AZ-NSG-003 | Add NSG Rule — Deny All Outbound | CONFIGURE | NSG Rule | full | — | resourceGroup |
| 32 | L6 | AZ-NSG-004 | Add NSG Rule — Allow Bastion Inbound | CONFIGURE | NSG Rule | full | — | resourceGroup, bastionSubnetCidr |
| 33 | L6 | AZ-NSG-005 | Associate NSG with Workload Subnet | CONFIGURE | NSG Association | full | — | resourceGroup, vnetName |
| 34 | L6 | AZ-NW-001 | Create Network Watcher | CREATE | Network Watcher | full | — | resourceGroup, location |
| 35 | L6 | AZ-DNS-001 | Private DNS Zone: Key Vault | CREATE | Private DNS Zone | foundation | — | resourceGroup |
| 36 | L6 | AZ-DNS-002 | Private DNS Zone: Blob Storage | CREATE | Private DNS Zone | foundation | — | resourceGroup |
| 37 | L6 | AZ-FW-000 | Create Azure Firewall Policy with Threat Intel Deny Mode | CREATE | Firewall Policy | full | fwPolicyId | resourceGroup, location |
| 38 | L6 | AZ-FW-001 | Create Firewall Public IP | CREATE | Public IP | full | — | resourceGroup, location |
| 39 | L6 | AZ-FW-002 | Create Azure Firewall | CREATE | Azure Firewall | full | — | resourceGroup, location, vnetName |
| 40 | L6 | AZ-PE-001 | Create Private Endpoint for Key Vault | CREATE | Private Endpoint | full | — | resourceGroup, location, keyVaultName, vnetName |
| 41 | L6 | AZ-PE-002 | Create Private Endpoint for Storage Account | CREATE | Private Endpoint | full | — | resourceGroup, location, storageAccountName, vnetName |
| 42 | L6 | AZ-AUTO-001 | Create Automation Account | CREATE | Automation Account | full | — | automationAccountName, resourceGroup, location |
| 43 | L6 | AZ-AUTO-002 | Assign System Managed Identity to Automation Account | CONFIGURE | Automation Identity | full | automationMiPrincipalId | subscriptionId, resourceGroup, automationAccountName |
| 44 | L6 | AZ-AUTO-003 | Grant Automation MI RBAC Roles (Security Reader, LAR on LAW, SBDC on Storage, KV Crypto User on KV) | CREATE | RBAC Role Assignment | full | — | subscriptionId, **automationMiPrincipalId, lawResourceId, storageResourceId, kvResourceId** |
| 45 | L6 | AZ-VM-001 | Create Workload VM (no public IP, system managed identity) | CREATE | Virtual Machine | full | — | resourceGroup, location, vnetName, vmName, vmImage, vmSize, keyVaultName |
| 56 | L7 | AZ-LOG-001 | Create Log Analytics Workspace (365-day retention) | CREATE | Log Analytics Workspace | sentinel | lawWorkspaceId, lawResourceId | resourceGroup, location, lawWorkspaceName |
| 57 | L7 | AZ-LOG-002 | Create Immutable Log Storage Account | CREATE | Storage Account | sentinel | storageResourceId | resourceGroup, location, storageAccountName |
| 60 | L7 | AZ-DIAG-007 | Entra ID Diagnostic Settings | EVIDENCE | Diagnostic Setting | full | — | — |
| 58 | L7 | AZ-LOG-003 | Set Storage Container Immutability Policy (WORM) | CREATE | Storage Container | sentinel | — | resourceGroup, storageAccountName |
| 61 | L7 | AZ-DIAG-001 | Set Diagnostic Setting — Resource Group Activity Log | CONFIGURE | Diagnostic Setting | full | — | subscriptionId, resourceGroup, lawWorkspaceName |
| 53 | L7 | AZ-ID-001 | Break-Glass Emergency Account | EVIDENCE | Entra ID User | none | breakGlassUserId | breakGlassUPN |
| 54 | L7 | AZ-ID-002 | Operator Admin Account | EVIDENCE | Entra ID User | none | operatorUserId | operatorUPN |
| 62 | L7 | AZ-DIAG-002 | Set Diagnostic Setting — Key Vault | CONFIGURE | Diagnostic Setting | full | — | resourceGroup, keyVaultName, lawWorkspaceName |
| 69 | L7 | AZ-SEN-010 | Enable Sentinel UEBA for Anomalous Behavior Detection | CONFIGURE | Sentinel UEBA | sentinel | — | subscriptionId, resourceGroup, lawWorkspaceName |
| 55 | L7 | AZ-ID-004 | Security Defaults Disabled | EVIDENCE | Security Defaults | none | — | — |
| 63 | L7 | AZ-DIAG-003 | Set Diagnostic Setting — Network Security Group | CONFIGURE | Diagnostic Setting | full | — | resourceGroup, lawWorkspaceName |
| 67 | L7 | AZ-MON-001 | Create Azure Monitor Action Group for CISO Alerts | CREATE | Action Group | sentinel | — | cisoEmail, resourceGroup |
| 64 | L7 | AZ-DIAG-004 | Set Diagnostic Setting — Storage Account | CONFIGURE | Diagnostic Setting | full | — | resourceGroup, storageAccountName, lawWorkspaceName |
| 68 | L7 | AZ-LOG-004 | Apply CanNotDelete Lock to Sentinel Log Analytics Workspace | CONFIGURE | Resource Lock | sentinel | — | subscriptionId, resourceGroup, lawWorkspaceName |
| 65 | L7 | AZ-DIAG-005 | Set Diagnostic Setting — Virtual Machine | CONFIGURE | Diagnostic Setting | full | — | resourceGroup, vmName, lawWorkspaceName |
| 66 | L7 | AZ-DIAG-006 | Set Diagnostic Setting — Subscription Activity Log | CREATE | Diagnostic Setting | full | — | **lawResourceId** |
| 59 | L7 | AZ-NW-002 | Enable NSG Flow Logs to Log Analytics | CONFIGURE | NSG Flow Logs | full | — | resourceGroup, location, storageAccountName |

## Resource Creation Chain
This section shows CREATE operations grouped by resource type, highlighting the dependency chain.
### Foundation Layer (L0-L6)
**Order of resource creation (dependencies resolved):**
1. **Resource Providers** (AZ-PREFLIGHT-001) — Must run first
2. **Subscription Context** (AZ-CTX-001) — Required for all subsequent operations
3. **Resource Group** (AZ-FOUND-001) — Container for all resources
4. **Policy Assignments** (AZ-FOUND-002) — CMMC L2 baseline
5. **Key Vault** (AZ-KV-001) → *Captures: kvResourceId, kvUri*
6. **CMK Key** (AZ-KV-003) → *Requires: keyVaultName* → *Captures: cmkKeyVersion*
7. **Virtual Network** (AZ-NET-001) → *Requires: resourceGroup, location*
8. **VNet Subnets** (AZ-NET-002/003/004/005) → *Requires: vnetName*
9. **Network Security Group** (AZ-NSG-001) → *Requires: resourceGroup, location*
10. **NSG Rules** (AZ-NSG-002/003/004) → *Requires: NSG exists*
11. **Private DNS Zones** (AZ-DNS-001/002) → *Requires: resourceGroup*
12. **Firewall Policy** (AZ-FW-000) → *Captures: fwPolicyId*
13. **Public IPs** (AZ-FW-001, AZ-BAS-001) → *Requires: resourceGroup, location*
14. **Azure Firewall** (AZ-FW-002) → *Requires: vnetName, pip-fw-cmmc, fwPolicyId*
15. **Bastion Host** (AZ-BAS-002) → *Requires: vnetName, pip-bastion-cmmc*
16. **Network Watcher** (AZ-NW-001) → *Requires: resourceGroup, location*
17. **Private Endpoints** (AZ-PE-001/002) → *Requires: Key Vault + Storage Account + VNet*
18. **Automation Account** (AZ-AUTO-001) → *Requires: resourceGroup, location*
19. **Automation Identity** (AZ-AUTO-002) → *Requires: AZ-AUTO-001* → *Captures: automationMiPrincipalId*
20. **Virtual Machine** (AZ-VM-001) → *Requires: vnetName, snet-workload, keyVaultName*
### Logging & Monitoring Layer (L7)
**Order of logging resource creation:**
1. **Log Analytics Workspace** (AZ-LOG-001) → *Captures: lawWorkspaceId, lawResourceId*
2. **Storage Account** (AZ-LOG-002) → *Captures: storageResourceId*
3. **Storage Account Identity** (AZ-LOG-002a) → *Requires: AZ-LOG-002* → *Captures: storageMiPrincipalId*
4. **CMK Encryption on Storage** (AZ-LOG-002c) → *Requires: storageMiPrincipalId, kvUri (runtime)*
5. **Storage Container WORM** (AZ-LOG-003) → *Requires: AZ-LOG-002*
6. **Sentinel Onboarding** (AZ-SEN-001) → *Requires: lawWorkspaceName*
7. **Sentinel Data Connectors** (AZ-SEN-002/003/004) → *Requires: Sentinel onboarded*
8. **Sentinel Alert Rules** (AZ-SEN-005/006/007/008) → *Requires: lawWorkspaceName*
9. **Action Group** (AZ-MON-001) → *Requires: resourceGroup, cisoEmail*
### Runtime Dependency Chain (Key Variables)
**These variables are captured at runtime and fed into downstream operations:**
- **kvResourceId** (from AZ-KV-001) → Used by: AZ-LOG-002b, AZ-AUTO-003
- **kvUri** (from AZ-KV-001) → Used by: AZ-LOG-002c, AZ-VM-002
- **lawResourceId** (from AZ-LOG-001) → Used by: AZ-AUTO-003, AZ-DIAG-006
- **eoSpObjectId** (from AZ-ID-003) → Used by: AZ-KV-002
- **storageResourceId** (from AZ-LOG-002) → Used by: AZ-AUTO-003
- **storageMiPrincipalId** (from AZ-LOG-002a) → Used by: AZ-LOG-002b
- **automationMiPrincipalId** (from AZ-AUTO-002) → Used by: AZ-AUTO-003
- **lawWorkspaceId** (from AZ-LOG-001) → Used by: AZ-VM-004
## Layer-by-Layer Breakdown
### Layer 1: Identity Objects
**Total operations:** 3
**Creates (2):**
- `AZ-BAS-001`: Create Bastion Public IP (Public IP)
- `AZ-BAS-002`: Create Azure Bastion Host (Bastion Host)
**Evidence/Queries (1):**
- `AZ-ID-005`: PIM Eligible Role Assignment for Operator

### Layer 4: Device Policies
**Total operations:** 14
**Creates (10):**
- `AZ-SEN-001`: Onboard Sentinel to Log Analytics Workspace (Sentinel Onboarding)
- `AZ-SEN-002`: Enable Sentinel Azure Activity Data Connector (Sentinel Data Connector)
- `AZ-SEN-003`: Enable Sentinel Microsoft Defender for Cloud Data Connector (Sentinel Data Connector)
- `AZ-SEN-004`: Enable Sentinel Azure Key Vault Data Connector (Sentinel Data Connector)
- `AZ-SEN-005`: Create Sentinel CMMC Analytics Rule — Privileged Identity Changes (Sentinel Alert Rule)
- `AZ-SEN-006`: Create Sentinel CMMC Analytics Rule — Malware Detection (Sentinel Alert Rule)
- `AZ-FOUND-004`: Resource Group CanNotDelete Lock (Resource Lock)
- `AZ-SEN-007`: Create Sentinel CMMC Analytics Rule — Excessive Failed Logins (Sentinel Alert Rule)
- `AZ-SEN-008`: Create Sentinel CMMC Analytics Rule — Unauthorized Resource Deletion (Sentinel Alert Rule)
- `AZ-VM-003`: Assign DISA STIG Policy to VM (Policy Assignment)
**Configures (3):**
- `AZ-FOUND-003`: Enable Microsoft Defender for Cloud (P2)
- `AZ-VM-002`: Enable VM Disk Encryption (CMK via Key Vault)
- `AZ-VM-004`: Install Microsoft Defender for Endpoint VM Extension
**Evidence/Queries (1):**
- `AZ-SEN-009`: Sentinel CMMC 2.0 Content Hub Solution

### Layer 6: Infrastructure
**Total operations:** 36
**Creates (20):**
- `AZ-PREFLIGHT-001`: Register Required Azure Resource Providers (Unknown)
- `AZ-KV-001`: Create Key Vault (purge-protection enabled) (Key Vault)
- `AZ-FOUND-001`: Create Azure Resource Group (Resource Group)
- `AZ-KV-002`: Assign Key Vault Crypto Officer Role to EO Service Principal (RBAC Role Assignment)
- `AZ-FOUND-002`: Assign CMMC L2 Azure Policy Initiative (Policy Assignment)
- `AZ-KV-003`: Create CMK Key in Key Vault (RSA-HSM 4096) (Key Vault Key)
- `AZ-LOG-002b`: Grant Storage MI Key Vault Crypto Service Encryption User Role (RBAC Role Assignment)
- `AZ-NET-001`: Create Virtual Network (Virtual Network)
- `AZ-NSG-001`: Create Network Security Group (Network Security Group)
- `AZ-NW-001`: Create Network Watcher (Network Watcher)
- `AZ-DNS-001`: Private DNS Zone: Key Vault (Private DNS Zone)
- `AZ-DNS-002`: Private DNS Zone: Blob Storage (Private DNS Zone)
- `AZ-FW-000`: Create Azure Firewall Policy with Threat Intel Deny Mode (Firewall Policy)
- `AZ-FW-001`: Create Firewall Public IP (Public IP)
- `AZ-FW-002`: Create Azure Firewall (Azure Firewall)
- `AZ-PE-001`: Create Private Endpoint for Key Vault (Private Endpoint)
- `AZ-PE-002`: Create Private Endpoint for Storage Account (Private Endpoint)
- `AZ-AUTO-001`: Create Automation Account (Automation Account)
- `AZ-AUTO-003`: Grant Automation MI RBAC Roles (Security Reader, LAR on LAW, SBDC on Storage, KV Crypto User on KV) (RBAC Role Assignment)
- `AZ-VM-001`: Create Workload VM (no public IP, system managed identity) (Virtual Machine)
**Configures (13):**
- `AZ-CTX-001`: Set Azure Subscription Context
- `AZ-LOG-002a`: Assign System Managed Identity to Storage Account
- `AZ-LOG-002c`: Enable CMK Encryption on Storage Account
- `AZ-KV-004`: Restrict Key Vault Network Access to Azure Services Only
- `AZ-NET-002`: Create Management Subnet
- `AZ-NET-003`: Create Workload Subnet
- `AZ-NET-004`: Create AzureBastionHost Subnet
- `AZ-NET-005`: Create AzureFirewall Subnet
- `AZ-NSG-002`: Add NSG Rule — Deny All Inbound
- `AZ-NSG-003`: Add NSG Rule — Deny All Outbound
- `AZ-NSG-004`: Add NSG Rule — Allow Bastion Inbound
- `AZ-NSG-005`: Associate NSG with Workload Subnet
- `AZ-AUTO-002`: Assign System Managed Identity to Automation Account
**Evidence/Queries (3):**
- `AZ-BOUNDARY-001`: Verify Network Security Group Boundary Rules
- `AZ-SUBNET-001`: Verify VNet Subnet Segmentation
- `AZ-ID-003`: EO Automation Service Principal

### Layer 7: Monitoring
**Total operations:** 17
**Creates (5):**
- `AZ-LOG-001`: Create Log Analytics Workspace (365-day retention) (Log Analytics Workspace)
- `AZ-LOG-002`: Create Immutable Log Storage Account (Storage Account)
- `AZ-LOG-003`: Set Storage Container Immutability Policy (WORM) (Storage Container)
- `AZ-MON-001`: Create Azure Monitor Action Group for CISO Alerts (Action Group)
- `AZ-DIAG-006`: Set Diagnostic Setting — Subscription Activity Log (Diagnostic Setting)
**Configures (8):**
- `AZ-DIAG-001`: Set Diagnostic Setting — Resource Group Activity Log
- `AZ-DIAG-002`: Set Diagnostic Setting — Key Vault
- `AZ-SEN-010`: Enable Sentinel UEBA for Anomalous Behavior Detection
- `AZ-DIAG-003`: Set Diagnostic Setting — Network Security Group
- `AZ-DIAG-004`: Set Diagnostic Setting — Storage Account
- `AZ-LOG-004`: Apply CanNotDelete Lock to Sentinel Log Analytics Workspace
- `AZ-DIAG-005`: Set Diagnostic Setting — Virtual Machine
- `AZ-NW-002`: Enable NSG Flow Logs to Log Analytics
**Evidence/Queries (4):**
- `AZ-DIAG-007`: Entra ID Diagnostic Settings
- `AZ-ID-001`: Break-Glass Emergency Account
- `AZ-ID-002`: Operator Admin Account
- `AZ-ID-004`: Security Defaults Disabled

## Enclave Impact
This table shows which operations apply to each enclave model:
| Enclave Model | Operations | Description |
|---------------|------------|-------------|
| **m365_only** | 5 | Only tier=none entries (Entra ID/PIM operations) |
| **m365_sentinel** | 37 | none + foundation + sentinel entries |
| **m365_azure** | 70 | All entries (full Azure infrastructure) |
**Breakdown by tier:**
- **none:** 5 operations (Entra ID, PIM)
- **foundation:** 10 operations (Core Azure: RG, policies, Defender)
- **sentinel:** 22 operations (LAW, Sentinel, Storage)
- **full:** 33 operations (VNet, VM, Firewall, Bastion)
## Runtime-Produced Variables
These 5 variables are captured at runtime (not from manifest) and consumed by downstream operations:
| Variable | Produced By | Consumed By | Description |
|----------|-------------|-------------|-------------|
| `kvResourceId` | AZ-KV-001 | AZ-LOG-002b, AZ-AUTO-003 | Key Vault ARM resource ID |
| `kvUri` | AZ-KV-001 | AZ-LOG-002c, AZ-VM-002 | Key Vault URI (vault.usgovcloudapi.net) |
| `lawResourceId` | AZ-LOG-001 | AZ-AUTO-003, AZ-DIAG-006 | Log Analytics Workspace ARM resource ID |
| `eoSpObjectId` | AZ-ID-003 | AZ-KV-002 | Execution Operator Service Principal Object ID |
| `storageResourceId` | AZ-LOG-002 | AZ-AUTO-003 | Storage Account ARM resource ID |
**Additional runtime captures (used for later operations):**
- `lawWorkspaceId` (AZ-LOG-001) → Used by: AZ-VM-004
- `storageMiPrincipalId` (AZ-LOG-002a) → Used by: AZ-LOG-002b
- `automationMiPrincipalId` (AZ-AUTO-002) → Used by: AZ-AUTO-003
- `fwPolicyId` (AZ-FW-000) → Used by: AZ-FW-002
- `cmkKeyVersion` (AZ-KV-003) → Reserved for key rotation tracking
---
**Note:** This document is generated from the executable plan and reflects the current state of registry entries and infrastructure manifest inputs. M365-only operations (non-AZ entries) are excluded from this resource map.