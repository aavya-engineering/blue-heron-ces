// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * _add-infra-notes.cjs
 * Adds SSP-useful `notes` to infra registry entries that are missing them.
 * Run: node scripts/_add-infra-notes.cjs
 */
const fs = require('fs');
const path = require('path');

const REGISTRY_PATH = path.resolve(__dirname, '../src/registry/infra-cmmc-l2-commands.registry.json');

// Notes keyed by entry_id. Only entries that currently lack notes are included.
const NOTES_MAP = {
  'AZ-PREFLIGHT-001':
    'Registers 11 Azure resource providers required for the CMMC L2 infrastructure stack (Sentinel, Key Vault, Storage, Network, Compute, etc.). Idempotent — re-registration of already-registered providers is a no-op. Evidence proves the subscription is ready for resource provisioning.',

  'AZ-CTX-001':
    'Sets the Az PowerShell session to the target Azure Gov subscription. Evidence confirms the operator is working in the correct subscription boundary, satisfying SC.L1-3.13.1 boundary monitoring requirements.',

  'AZ-FOUND-001':
    'Creates the primary resource group with CMMC L2 tags (environment=cmmc-l2, managed_by=bhd-stamper). All subsequent infrastructure resources are deployed into this resource group. Evidence proves a dedicated, tagged container exists for CUI-scoped resources.',

  'AZ-LOG-001':
    'Creates the centralized Log Analytics workspace with 365-day retention, satisfying AU.L2-3.3.1 audit record retention requirements. Captures lawWorkspaceId and lawResourceId for downstream Sentinel onboarding and diagnostic settings. The PerGB2018 SKU is the only option available in Azure Gov.',

  'AZ-LOG-002':
    'Creates an immutable log storage account with TLS 1.2 minimum, HTTPS-only traffic, and no public blob access. Serves as the secondary audit log store for WORM-locked evidence containers. Captures storageResourceId for downstream RBAC and diagnostic settings.',

  'AZ-LOG-002a':
    'Assigns a system-managed identity to the log storage account so it can authenticate to Key Vault for CMK encryption without storing credentials. Captures storageMiPrincipalId for the RBAC role assignment in AZ-LOG-002b. Evidence proves identity-based access is configured per SC.L2-3.13.10.',

  'AZ-LOG-002b':
    'Grants the storage account managed identity the Key Vault Crypto Service Encryption User role, enabling customer-managed key (CMK) envelope encryption. This RBAC assignment must propagate before AZ-LOG-002c can apply CMK encryption. Evidence proves least-privilege cryptographic key access.',

  'AZ-LOG-002c':
    'Enables customer-managed key (CMK) encryption on the log storage account using an RSA-HSM key in Key Vault. Satisfies SC.L2-3.13.10 cryptographic key management and SC.L2-3.13.16 CUI-at-rest protection. Evidence proves KeySource is Microsoft.Keyvault rather than Microsoft-managed.',

  'AZ-KV-001':
    'Creates an Azure Key Vault with Premium SKU (HSM-backed), purge protection enabled, RBAC authorization mode, and deployment disabled. Captures kvResourceId and kvUri for downstream CMK encryption and RBAC assignments. Evidence proves cryptographic key storage meets FIPS 140-2 Level 2 requirements.',

  'AZ-KV-002':
    'Assigns the EO service principal the Key Vault Crypto Officer role for automated key lifecycle management. Includes a 300-second propagation delay for Azure RBAC to replicate. Evidence proves the automation identity has least-privilege cryptographic access per AC.L1-3.1.1.',

  'AZ-NET-001':
    'Creates the primary VNet in Azure Gov with the specified CIDR range. This VNet provides the network boundary for all CUI-scoped workloads, satisfying SC.L1-3.13.1 boundary protection and SC.L1-3.13.5 subnet segmentation requirements.',

  'AZ-NET-002':
    'Creates the management subnet (snet-mgmt) within the VNet for administrative access paths. Segmentation from workload and bastion subnets satisfies SC.L1-3.13.5 network segmentation. Evidence proves the subnet exists with the correct CIDR range.',

  'AZ-NET-003':
    'Creates the workload subnet (snet-workload) for CUI-processing resources. This subnet receives the NSG association (AZ-NSG-005) enforcing deny-all-by-default traffic rules per SC.L2-3.13.6. Evidence proves the subnet exists with the correct CIDR range.',

  'AZ-NET-004':
    'Creates the AzureBastionSubnet, which is a required named subnet for Azure Bastion deployment. Bastion provides secure RDP/SSH access without exposing VMs to public IPs, satisfying SC.L1-3.13.1 boundary protection. The subnet name "AzureBastionSubnet" is mandated by Azure.',

  'AZ-NET-005':
    'Creates the AzureFirewallSubnet, a required named subnet for Azure Firewall deployment. Azure Firewall provides centralized network egress filtering with threat intelligence. The subnet name "AzureFirewallSubnet" is mandated by Azure and requires a minimum /26 CIDR.',

  'AZ-NSG-001':
    'Creates the primary Network Security Group (nsg-workload-cmmc) for the workload subnet. NSGs enforce layer-4 traffic filtering at the subnet level. Evidence proves the NSG resource exists and is ready for rule configuration (AZ-NSG-002 through AZ-NSG-004).',

  'AZ-NSG-002':
    'Adds a DenyAllInbound rule at the lowest priority (4096) to enforce deny-by-default inbound traffic per SC.L2-3.13.6. Only explicitly allowed rules at higher priority (lower number) can override this baseline deny. Evidence proves the deny-all-inbound posture is in place.',

  'AZ-NSG-003':
    'Adds a DenyAllOutbound rule at priority 4096 to enforce deny-by-default outbound traffic per SC.L1-3.13.1 boundary protection. All outbound traffic must be explicitly allowed by higher-priority rules. Evidence proves egress traffic is controlled at the NSG layer.',

  'AZ-NSG-004':
    'Adds an AllowBastionInbound rule at priority 100 permitting TCP 22/3389 from the Bastion subnet only. This is the sole inbound access path to workload VMs, ensuring all remote access routes through Azure Bastion per SC.L1-3.13.1. Evidence proves no direct public inbound access exists.',

  'AZ-NSG-005':
    'Associates the nsg-workload-cmmc NSG with the snet-workload subnet, activating the deny-by-default rules (AZ-NSG-002/003) and Bastion allow rule (AZ-NSG-004). Without this association, NSG rules are not enforced. Evidence proves the workload subnet has active boundary protection.',

  'AZ-NW-001':
    'Creates a Network Watcher in the usgovvirginia region for network diagnostics and NSG flow log capture. Azure Gov requires one Network Watcher per region. Evidence proves the watcher is provisioned and ready for flow log configuration (AZ-NW-002).',

  'AZ-NW-002':
    'Enables NSG flow logs in JSON v2 format, directing traffic metadata to the immutable log storage account. Flow logs provide the raw network traffic data needed for AU.L2-3.3.1 audit logging and AU.L2-3.3.2 user-traceable activity. Evidence proves flow logging is active on the workload NSG.',

  'AZ-FW-001':
    'Creates a zone-redundant Standard SKU public IP for the Azure Firewall. The static allocation and zone redundancy (1,2,3) ensure high availability for the centralized egress point. This IP must exist before the firewall (AZ-FW-002) can be deployed.',

  'AZ-FW-002':
    'Deploys Azure Firewall Premium with a threat-intelligence-deny policy. Firewall Premium provides IDPS, TLS inspection, and URL filtering for centralized egress control per SC.L2-3.13.6 deny-by-exception and SC.L1-3.13.1 boundary monitoring. Evidence proves the firewall is provisioned and active.',

  'AZ-BAS-001':
    'Creates a Standard SKU static public IP for the Azure Bastion host. This IP is the only public-facing endpoint in the architecture and is locked down by Bastion service requirements. Evidence proves the public IP resource exists for Bastion deployment.',

  'AZ-BAS-002':
    'Deploys an Azure Bastion Standard host for secure, browser-based RDP/SSH access to VMs without exposing public IPs. Bastion satisfies SC.L1-3.13.1 by routing all administrative remote access through a managed access control point. Evidence proves Bastion is deployed on the correct VNet.',

  'AZ-PE-001':
    'Creates a private endpoint for Key Vault on the workload subnet, removing public network exposure for cryptographic key operations. Private endpoints satisfy SC.L2-3.13.6 deny-by-default by restricting Key Vault access to the VNet only. Evidence proves the private endpoint is provisioned.',

  'AZ-PE-002':
    'Creates a private endpoint for the blob storage account on the workload subnet, ensuring audit log writes traverse the private network only. This satisfies SC.L2-3.13.6 by eliminating public blob access to the immutable log store. Evidence proves the storage private endpoint is provisioned.',

  'AZ-AUTO-001':
    'Creates an Azure Automation account for scheduled compliance runbooks (evidence collection, drift detection, key rotation). The automation account is the execution host for recurring CMMC compliance tasks. Evidence proves the account exists and is provisioned in the correct resource group.',

  'AZ-AUTO-002':
    'Assigns a system-managed identity to the Automation account via REST API (Az PowerShell does not expose the identity property directly). Captures automationMiPrincipalId for RBAC grants in AZ-AUTO-003. Evidence proves identity-based authentication is configured for automation runbooks.',

  'AZ-AUTO-003':
    'Grants the Automation account managed identity four RBAC roles: Security Reader (subscription-wide), Log Analytics Reader (LAW), Storage Blob Data Contributor (storage), and Key Vault Crypto User (KV). These are the minimum permissions for compliance runbooks per AC.L1-3.1.1 least privilege.',

  'AZ-SEN-003':
    'Enables the Microsoft Defender for Cloud data connector in Sentinel, ingesting Defender alerts and security recommendations into the SIEM. Provides unified threat detection and incident correlation for SI.L1-3.14.1 flaw identification and AU.L2-3.3.1 centralized audit logging.',

  'AZ-SEN-004':
    'Enables the Azure Key Vault data connector in Sentinel, streaming Key Vault audit events (key access, secret reads, policy changes) into the SIEM. Evidence proves cryptographic key operations are monitored for SI.L1-3.14.1 flaw identification and AU.L2-3.3.1 centralized logging.',

  'AZ-SEN-005':
    'Creates a scheduled Sentinel analytics rule that detects privileged role assignments outside approved PIM workflows. Queries AuditLogs every hour for "Add member to role" events. Satisfies SI.L2-3.14.6 inbound/outbound monitoring and SI.L1-3.14.1 flaw identification for identity-based threats.',

  'AZ-SEN-006':
    'Creates a scheduled Sentinel analytics rule that detects malware events from Defender for Endpoint via the DeviceEvents table. Queries every 15 minutes for AntivirusDetection actions. Satisfies SI.L2-3.14.6 attack detection and SI.L1-3.14.1 malware identification.',

  'AZ-SEN-007':
    'Creates a scheduled Sentinel analytics rule that detects brute-force login attempts by aggregating failed sign-ins (>10 per 5-minute window). Satisfies AU.L2-3.3.2 user-traceable activity and SI.L1-3.14.1 flaw identification for credential-based attacks.',

  'AZ-SEN-008':
    'Creates a scheduled Sentinel analytics rule that detects unauthorized deletion of Azure resources by monitoring AzureActivity for successful delete operations. Satisfies AU.L2-3.3.1 audit logging and SI.L1-3.14.1 flaw identification for unauthorized configuration changes.',

  'AZ-VM-001':
    'Creates a workload VM with no public IP, system-managed identity, and admin credentials stored in Key Vault. The VM is placed on the snet-workload subnet behind the NSG deny-all rules. Evidence proves the VM exists with identity-based access and no direct internet exposure.',

  'AZ-VM-002':
    'Enables Azure Disk Encryption on the workload VM using the customer-managed key in Key Vault. Satisfies SC.L2-3.13.10 cryptographic key management and SC.L2-3.13.16 CUI-at-rest protection. Evidence proves disk encryption is active with Key Vault-backed keys.',

  'AZ-VM-004':
    'Installs the Microsoft Monitoring Agent VM extension to forward VM telemetry to the Log Analytics workspace. Connects the VM to the centralized SIEM pipeline for SI.L1-3.14.1 flaw detection and CM.L2-3.4.1 baseline configuration monitoring. Evidence proves the extension is installed and connected.',

  'AZ-DIAG-001':
    'Configures subscription-level diagnostic settings to forward Azure Activity Logs (Administrative, Security, ServiceHealth, Alert, Policy, etc.) to the Log Analytics workspace. Satisfies AU.L2-3.3.1 audit logging for all subscription-level operations. Marked manual_only due to Azure Gov portal requirements.',

  'AZ-DIAG-002':
    'Configures diagnostic settings on the Key Vault resource to forward all audit logs (allLogs category group) to the Log Analytics workspace. Evidence proves cryptographic key operations and access attempts are centrally logged for AU.L2-3.3.1 audit accountability.',

  'AZ-DIAG-003':
    'Configures diagnostic settings on the workload NSG to forward all log categories to the Log Analytics workspace. Captures NSG rule hits, flow decisions, and security events. Evidence proves network boundary enforcement actions are centrally logged for AU.L2-3.3.1 audit accountability.',

  'AZ-DIAG-004':
    'Configures diagnostic settings on the log storage account to forward Transaction metrics to the Log Analytics workspace. Evidence proves storage access patterns (reads, writes, deletes) are centrally monitored for AU.L2-3.3.1 audit logging and AU.L2-3.3.2 user-traceable activity.',

  'AZ-DIAG-005':
    'Configures diagnostic settings on the workload VM to forward all log categories to the Log Analytics workspace. Satisfies AU.L2-3.3.1 audit logging for VM-level events. This entry is conditional on AZ-VM-001 deploying a VM; for cloud-native architectures see AZ-FOUND-003.',

  'AZ-DIAG-006':
    'Configures subscription-level Activity Log diagnostic settings forwarding Administrative, Security, and Policy categories to the Log Analytics workspace. Provides the subscription-level audit trail required by AU.L2-3.3.1 and AU.L2-3.3.2 for user-traceable activity.',

  'AZ-FOUND-004':
    'Applies a CanNotDelete resource lock to the primary resource group, preventing accidental or unauthorized deletion of CMMC L2 infrastructure resources. Satisfies CM.L2-3.4.2 security configuration enforcement and AU.L2-3.3.1 by preserving audit log sources.',

  'AZ-DNS-001':
    'Creates the Private DNS Zone for Key Vault (privatelink.vaultcore.usgovcloudapi.net). Azure Gov uses the usgovcloudapi.net domain suffix instead of azure.net. This zone resolves Key Vault private endpoint connections to private IPs within the VNet per SC.L2-3.13.6.',

  'AZ-DNS-002':
    'Creates the Private DNS Zone for Blob Storage (privatelink.blob.core.usgovcloudapi.net). Azure Gov uses the usgovcloudapi.net domain suffix. This zone resolves storage private endpoint connections to private IPs within the VNet, eliminating public blob access per SC.L2-3.13.6.',

  'AZ-MON-001':
    'Creates an Azure Monitor Action Group that sends CMMC-related alerts to the CISO email address. Satisfies AU.L2-3.3.4 by establishing an automated notification path for audit logging process failures and security-critical events. Evidence proves the action group is configured with the correct email receiver.',

  'AZ-LOG-004':
    'Applies a CanNotDelete lock to the Sentinel Log Analytics workspace via ARM REST API, preventing accidental deletion of the audit log store. Satisfies AU.L2-3.3.8 protection of audit information from unauthorized modification or deletion. Uses Invoke-AzRestMethod because New-AzResourceLock does not support nested provider scopes.',

  'AZ-FW-000':
    'Creates the Azure Firewall Policy with ThreatIntelMode set to Deny, blocking known-malicious IPs/domains at the network layer. This policy is referenced by the firewall (AZ-FW-002). Captures fwPolicyId for firewall association. Satisfies SC.L2-3.13.6 deny-by-exception network controls.',

  'AZ-KV-004':
    'Restricts Key Vault network access to Azure services only by setting DefaultAction to Deny and Bypass to AzureServices. This ensures cryptographic key operations are only accessible from within Azure, not from the public internet. Satisfies SC.L2-3.13.10 cryptographic key management.',

  'AZ-SEN-010':
    'Enables Sentinel User and Entity Behavior Analytics (UEBA) with AuditLogs, SigninLogs, and SecurityEvent data sources. UEBA uses machine learning to detect anomalous user behavior patterns. Satisfies SI.L2-3.14.7 identification of unauthorized system use via behavioral baselines.'
};

// --- Main ---
const raw = fs.readFileSync(REGISTRY_PATH, 'utf-8');
const registry = JSON.parse(raw);

let added = 0;
let alreadyHadNotes = 0;
let notInMap = 0;

for (const entry of registry.entries) {
  const id = entry.entry_id;
  const hasNote = entry.notes && entry.notes.trim().length > 0;

  if (hasNote) {
    alreadyHadNotes++;
    continue;
  }

  if (NOTES_MAP[id]) {
    entry.notes = NOTES_MAP[id];
    added++;
  } else {
    notInMap++;
    console.warn(`WARNING: No note defined for entry ${id}`);
  }
}

fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + '\n', 'utf-8');

console.log(`\nDone.`);
console.log(`  Entries already with notes: ${alreadyHadNotes}`);
console.log(`  Notes added:               ${added}`);
console.log(`  Missing from map:          ${notInMap}`);
console.log(`  Total entries:             ${registry.entries.length}`);
