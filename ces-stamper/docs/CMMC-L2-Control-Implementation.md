# CMMC Level 2 — Control Implementation Summary

**Tenant:** vfsgov-xtra
**Execution Date:** 2026-04-10T05:46:45.234Z
**Status:** completed — 132 tasks (129 completed, 3 skipped, 0 failed)
**Controls:** 110 across 14 families

| Directive | Controls |
|-----------|----------|
| Automated | 67 |
| Non-Stack | 22 |
| Excluded | 21 |
| **Total** | **110** |

---

## AUTOMATED — Registry-backed commands with get/set/evidence lifecycle (67)

### AC — Access Control

#### AC.L1-3.1.1 — Limit information system access to authorized users, processes acting on behalf of authorized users or devices (including other information systems).

- **Gap Classifications:** manual, configure
- **mgraph** — Discover Operator User ID: Verifies via `Get-MgUser -Filter "userPrincipalName eq '{operatorUPN}'"`
- **mgraph** — Create CUI Security Group: Verifies via `Get-MgGroup -Filter "displayName eq '{cuiGroupName}'"`; Configures via `New-MgGroup -DisplayName "{cuiGroupName}" -MailEnabled:$false -MailNickname "{cuiGroupName}" -Securi`
- **mgraph** — Add User to CUI Security Group: Verifies via `Get-MgGroupMember -GroupId {cuiGroupId}`; Configures via `New-MgGroupMemberByRef -GroupId {cuiGroupId} -BodyParameter @{'@odata.id'='https://graph.microsoft.u`
- **mgraph** — Verify Conditional Access Policies Enforce Authorized Access: Verifies via `Get-MgIdentityConditionalAccessPolicy`
- **az** — NSG Boundary Protection Rules: Verifies via `Get-AzNetworkSecurityGroup -ResourceGroupName 'rg-eo-prod'`
- **az** — Assign Key Vault Crypto Officer Role to EO Service Principal: Verifies via `Get-AzRoleAssignment -Scope (Get-AzKeyVault -ResourceGroupName {resourceGroup} -VaultName {keyVaultName}).ResourceId`; Configures via `$assignment = New-AzRoleAssignment -ObjectId {eoSpObjectId} -RoleDefinitionName 'Key Vault Crypto Officer' -Scope (Get-A`
- **az** — Grant Automation MI RBAC Roles (Security Reader, LAR on LAW, SBDC on Storage, KV Crypto User on KV): Verifies via `$assignments = Get-AzRoleAssignment -ObjectId {automationMiPrincipalId}; @{ hasSubScope = ($assignments`; Configures via `New-AzRoleAssignment -ObjectId {automationMiPrincipalId} -RoleDefinitionName 'Security Reader' -Scope '/subscriptions/{s`
- **mgraph** — Break-Glass Emergency Account: Verifies via `Get-MgUser -Filter "userPrincipalName eq '{breakGlassUPN}'"`
- **mgraph** — Operator Admin Account: Verifies via `Get-MgUser -Filter "userPrincipalName eq '{operatorUPN}'"`
- **mgraph** — EO Automation Service Principal: Verifies via `Get-MgServicePrincipal -Filter "appId eq '{appId}'"`
- **mgraph** — Security Defaults Disabled: Verifies via `Get-MgPolicyIdentitySecurityDefaultEnforcementPolicy`

#### AC.L1-3.1.2 — Limit information system access to the types of transactions and functions that authorized users are permitted to execute.

- **Gap Classifications:** customize, configure
- **mgraph** — Discover Operator User ID: Verifies via `Get-MgUser -Filter "userPrincipalName eq '{operatorUPN}'"`
- **mgraph** — Verify Directory Role Assignments Limit Functions: Verifies via `Get-MgDirectoryRole`

#### AC.L2-3.1.3 — Control the flow of CUI in accordance with approved authorizations.

- **Gap Classifications:** manual, configure
- **ipps** — Create Information Barrier Segment: Verifies via `Get-OrganizationSegment`; Configures via `$existing = Get-OrganizationSegment -ErrorAction SilentlyContinue | Where-Object Name -eq 'CUI-Segme`
- **ipps** — Create Information Barrier Policy: Verifies via `Get-InformationBarrierPolicy` *(evidence-only)*
- **mgraph** — Service Principal Account Evidence for CUI Flow Control: Verifies via `Get-MgServicePrincipal -Filter "displayName eq '{eoAppDisplayName}'" -All`

#### AC.L2-3.1.4 — Separate the duties of individuals to reduce the risk of malevolent activity without collusion.

- **Gap Classifications:** manual, configure
- **mgraph** — Get PIM Policy for Compliance Admin Role: Verifies via `$roleId = (Get-MgRoleManagementDirectoryRoleDefinition -Filter "displayName eq 'Compliance Administr`
- **mgraph** — PIM Separation of Duties - Require Approval: Verifies via `$roleId=(Get-MgRoleManagementDirectoryRoleDefinition -Filter "displayName eq 'Compliance Administrat`; Configures via `$roleId=(Get-MgRoleManagementDirectoryRoleDefinition -Filter "displayName eq 'Compliance Administrat`

#### AC.L2-3.1.5 — Employ the principle of least privilege, including for specific security functions and privileged accounts.

- **Gap Classifications:** manual, customize, configure
- **mgraph** — PIM JIT Eligible Role Assignment: Verifies via `Get-MgRoleManagementDirectoryRoleEligibilitySchedule -All`; Configures via `New-MgRoleManagementDirectoryRoleEligibilityScheduleRequest -BodyParameter @{action='adminAssign'`
- **mgraph** — Operator Admin Account: Verifies via `Get-MgUser -Filter "userPrincipalName eq '{operatorUPN}'"`
- **mgraph** — PIM Eligible Role Assignment for Operator: Verifies via `Get-MgRoleManagementDirectoryRoleEligibilitySchedule -All`

#### AC.L2-3.1.7 — Prevent non-privileged users from executing privileged functions and capture the execution of such functions in audit logs.

- **Gap Classifications:** configure
- **mgraph** — Discover Operator User ID: Verifies via `Get-MgUser -Filter "userPrincipalName eq '{operatorUPN}'"`
- **mgraph** — PIM JIT Eligible Role Assignment: Verifies via `Get-MgRoleManagementDirectoryRoleEligibilitySchedule -All`; Configures via `New-MgRoleManagementDirectoryRoleEligibilityScheduleRequest -BodyParameter @{action='adminAssign'`
- **mgraph** — PIM Eligible Role Assignments for Privileged Users: Verifies via `Get-MgRoleManagementDirectoryRoleEligibilitySchedule -All`
- **mgraph** — Verify No Permanent Privileged Role Assignments: Verifies via `Get-MgRoleManagementDirectoryRoleAssignmentSchedule -All`
- **mgraph** — PIM Eligible Role Assignment for Operator: Verifies via `Get-MgRoleManagementDirectoryRoleEligibilitySchedule -All`

#### AC.L2-3.1.8 — Limit unsuccessful logon attempts.

- **Gap Classifications:** configure
- **mgraph** — Smart Lockout Configuration Evidence: Verifies via `Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/policies/authenticationMethodsPolicy'`

#### AC.L2-3.1.9 — Provide privacy and security notices consistent with applicable Controlled Unclassified Information (CUI) rules.

- **Gap Classifications:** manual, customize
- **mgraph** — Create CUI Terms of Use Agreement: Verifies via `Get-MgAgreement -Filter "displayName eq 'CUI System Access Notice'"`; Configures via `New-MgAgreement -BodyParameter @{displayName='CUI System Access Notice'`

#### AC.L2-3.1.11 — Terminate (automatically) user sessions after a defined condition.

- **Gap Classifications:** configure
- **mgraph** — Conditional Access - Session Timeout and No Persistent Browser: Verifies via `Get-MgIdentityConditionalAccessPolicy -Filter "displayName eq 'CMMC-SessionTimeout'"`; Configures via `New-MgIdentityConditionalAccessPolicy -BodyParameter @{displayName='CMMC-SessionTimeout'`

#### AC.L2-3.1.15 — Authorize remote execution of privileged commands and remote access to security-relevant information.

- **Gap Classifications:** customize
- **mgraph** — Conditional Access - Admin MFA Phishing-Resistant: Verifies via `Get-MgIdentityConditionalAccessPolicy -Filter "displayName eq 'CMMC-AdminMFA-PhishingResistant'"`; Configures via `New-MgIdentityConditionalAccessPolicy -BodyParameter @{displayName='CMMC-AdminMFA-PhishingResistant'`

#### AC.L1-3.1.20 — Verify and control/limit connections to and use of external information systems.

- **Gap Classifications:** customize, configure
- **mgraph** — Restrict Guest Invitations via Authorization Policy: Verifies via `Get-MgPolicyAuthorizationPolicy`; Configures via `Update-MgPolicyAuthorizationPolicy -BodyParameter @{allowInvitesFrom='adminsAndGuestInviters'`
- **mgraph** — Disable SharePoint External Sharing at Tenant Level: Verifies via `(Invoke-MgGraphRequest -Method GET -Uri 'https://graph.microsoft.us/beta/admin/sharepoint/settings')`; Configures via `Invoke-MgGraphRequest -Method PATCH -Uri 'https://graph.microsoft.us/beta/admin/sharepoint/settings'`
- **mgraph** — Verify Cross-Tenant Access Restrictions: Verifies via `Get-MgPolicyCrossTenantAccessPolicyDefault`

#### AC.L2-3.1.21 — Limit use of portable storage devices on external systems.

- **Gap Classifications:** customize
- **mgraph** — Block Removable Storage via Intune Device Configuration: Verifies via `(Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/deviceManagement/deviceConfigurations')`; Configures via `Invoke-MgGraphRequest -Method POST -Uri 'https://graph.microsoft.us/v1.0/deviceManagement/deviceConf`

#### AC.L1-3.1.22 — Control information posted or processed on publicly accessible

- **Gap Classifications:** manual, configure
- **mgraph** — Verify SharePoint Site Sharing Restricted (tenant-level 'disabled' covers site-level): Verifies via `(Invoke-MgGraphRequest -Method GET -Uri 'https://graph.microsoft.us/beta/admin/sharepoint/settings' `
- **mgraph** — Verify SharePoint External Sharing Controls: Verifies via `Invoke-MgGraphRequest -Method GET -Uri 'https://graph.microsoft.us/beta/admin/sharepoint/settings'`

### AU — Audit and Accountability

#### AU.L2-3.3.1 — Create and retain system audit logs and records to the extent needed to enable the monitoring, analysis, investigation, and reporting of unlawful or unauthorized system activity.

- **Gap Classifications:** customize, configure
- **exchange** — Enable Organization Customization (Pre-requisite for Audit): Verifies via `Get-OrganizationConfig`; Configures via `Enable-OrganizationCustomization`
- **exchange** — Enable Unified Audit Log Ingestion: Verifies via `Get-AdminAuditLogConfig`; Configures via `Set-AdminAuditLogConfig -UnifiedAuditLogIngestionEnabled $true`
- **ipps** — Create Audit Log Retention Policy (1 Year): Verifies via `Get-UnifiedAuditLogRetentionPolicy`; Configures via `New-UnifiedAuditLogRetentionPolicy -Name 'CMMC-1Year-Retention' -Description 'CMMC AU retention 1 ye`
- **az** — NSG Boundary Protection Rules: Verifies via `Get-AzNetworkSecurityGroup -ResourceGroupName 'rg-eo-prod'`
- **az** — Enable Microsoft Defender for Cloud (P2): Verifies via `Get-AzSecurityPricing`; Configures via `Set-AzSecurityPricing -Name 'VirtualMachines' -PricingTier 'Standard'`
- **az** — Create Log Analytics Workspace (365-day retention): Verifies via `Get-AzOperationalInsightsWorkspace -ResourceGroupName {resourceGroup} -Name {lawWorkspaceName}`; Configures via `New-AzOperationalInsightsWorkspace -ResourceGroupName {resourceGroup} -Name {lawWorkspaceName} -Location {location} -Sku`
- **az** — Create Immutable Log Storage Account: Verifies via `Get-AzStorageAccount -ResourceGroupName {resourceGroup} -Name {storageAccountName}`; Configures via `New-AzStorageAccount -ResourceGroupName {resourceGroup} -Name {storageAccountName} -Location {location} -SkuName 'Standa`
- **az** — Assign System Managed Identity to Storage Account: Verifies via `Get-AzStorageAccount -ResourceGroupName {resourceGroup} -Name {storageAccountName}`; Configures via `Set-AzStorageAccount -ResourceGroupName {resourceGroup} -Name {storageAccountName} -AssignIdentity`
- **az** — Grant Storage MI Key Vault Crypto Service Encryption User Role: Verifies via `Get-AzRoleAssignment -ObjectId {storageMiPrincipalId} -Scope {kvResourceId}`; Configures via `New-AzRoleAssignment -RoleDefinitionName 'Key Vault Crypto Service Encryption User' -ObjectId {storageMiPrincipalId} -Sc`
- **az** — Enable CMK Encryption on Storage Account: Verifies via `Get-AzStorageAccount -ResourceGroupName {resourceGroup} -Name {storageAccountName}`; Configures via `Set-AzStorageAccount -ResourceGroupName {resourceGroup} -Name {storageAccountName} -KeyvaultEncryption -KeyName {cmkKeyN`
- **az** — Set Storage Container Immutability Policy (WORM): Verifies via `Get-AzRmStorageContainerImmutabilityPolicy -ResourceGroupName {resourceGroup} -StorageAccountName {storageAccountName} -`; Configures via `$ctx = (Get-AzStorageAccount -ResourceGroupName {resourceGroup} -Name {storageAccountName}).Context`
- **az** — Associate NSG with Workload Subnet: Verifies via `(Get-AzVirtualNetwork -ResourceGroupName {resourceGroup} -Name {vnetName}`; Configures via `$vnet = Get-AzVirtualNetwork -ResourceGroupName {resourceGroup} -Name {vnetName}`
- **az** — Create Network Watcher: Verifies via `Get-AzNetworkWatcher`; Configures via `$existing = Get-AzNetworkWatcher | Where-Object {$_.Location -eq 'usgovvirginia'}`
- **az** — Enable NSG Flow Logs to Log Analytics: Verifies via `$flowLog = Get-AzNetworkWatcherFlowLogStatus -NetworkWatcher (Get-AzNetworkWatcher`; Configures via `$nsg = Get-AzNetworkSecurityGroup -ResourceGroupName {resourceGroup} -Name 'nsg-workload-cmmc'`
- **az** — Create Automation Account: Verifies via `Get-AzAutomationAccount -ResourceGroupName {resourceGroup} -Name {automationAccountName}`; Configures via `New-AzAutomationAccount -Name {automationAccountName} -ResourceGroupName {resourceGroup} -Location {location}`
- **az** — Assign System Managed Identity to Automation Account: Verifies via `$acct = Get-AzAutomationAccount -ResourceGroupName {resourceGroup} -Name {automationAccountName}; if ($acct.Subscription`; Configures via `Invoke-AzRestMethod -Method PATCH -Uri '/subscriptions/{subscriptionId}/resourceGroups/{resourceGroup}/providers/Microso`
- **az** — Grant Automation MI RBAC Roles (Security Reader, LAR on LAW, SBDC on Storage, KV Crypto User on KV): Verifies via `$assignments = Get-AzRoleAssignment -ObjectId {automationMiPrincipalId}; @{ hasSubScope = ($assignments`; Configures via `New-AzRoleAssignment -ObjectId {automationMiPrincipalId} -RoleDefinitionName 'Security Reader' -Scope '/subscriptions/{s`
- **az** — Onboard Sentinel to Log Analytics Workspace: Verifies via `az rest --method GET --url 'https://management.usgovcloudapi.net/subscriptions/{subscriptionId}/resourceGroups/{resource`; Configures via `az rest --method PUT --url 'https://management.usgovcloudapi.net/subscriptions/{subscriptionId}/resourceGroups/{resource`
- **az** — Enable Sentinel Azure Activity Data Connector: Verifies via `$connector = Get-AzSentinelDataConnector -ResourceGroupName {resourceGroup} -WorkspaceName {lawWorkspaceName}`; Configures via `New-AzSentinelDataConnector -ResourceGroupName {resourceGroup} -WorkspaceName {lawWorkspaceName} -Kind 'AzureActivity' -`
- **az** — Enable Sentinel Microsoft Defender for Cloud Data Connector: Verifies via `Get-AzSentinelDataConnector -ResourceGroupName {resourceGroup} -WorkspaceName {lawWorkspaceName}`; Configures via `New-AzSentinelDataConnector -ResourceGroupName {resourceGroup} -WorkspaceName {lawWorkspaceName} -Kind 'MicrosoftDefende`
- **az** — Enable Sentinel Azure Key Vault Data Connector: Verifies via `Get-AzSentinelDataConnector -ResourceGroupName {resourceGroup} -WorkspaceName {lawWorkspaceName}`; Configures via `New-AzSentinelDataConnector -ResourceGroupName {resourceGroup} -WorkspaceName {lawWorkspaceName} -Kind 'AzureKeyVault'`
- **az** — Create Sentinel CMMC Analytics Rule - Unauthorized Resource Deletion: Verifies via `Get-AzSentinelAlertRule -ResourceGroupName {resourceGroup} -WorkspaceName {lawWorkspaceName} -ErrorAction SilentlyContin`; Configures via `$existing = Get-AzSentinelAlertRule -ResourceGroupName {resourceGroup} -WorkspaceName {lawWorkspaceName} -ErrorAction Si`
- **az** — Set Diagnostic Setting — Subscription Activity Log: Verifies via `$diag = Get-AzSubscriptionDiagnosticSetting -Name 'activitylog-to-law' -WarningAction SilentlyContinue; if ($diag.Worksp` *(evidence-only)*
- **az** — Set Diagnostic Setting — Key Vault: Verifies via `$diag = Get-AzDiagnosticSetting -ResourceId (Get-AzKeyVault -ResourceGroupName {resourceGroup} -VaultName {keyVaultName}`; Configures via `$law = Get-AzOperationalInsightsWorkspace -ResourceGroupName {resourceGroup} -Name {lawWorkspaceName}`
- **az** — Set Diagnostic Setting — Network Security Group: Verifies via `$diag = Get-AzDiagnosticSetting -ResourceId (Get-AzNetworkSecurityGroup -ResourceGroupName {resourceGroup} -Name 'nsg-wo`; Configures via `$law = Get-AzOperationalInsightsWorkspace -ResourceGroupName {resourceGroup} -Name {lawWorkspaceName}`
- **az** — Set Diagnostic Setting — Storage Account: Verifies via `$sa = Get-AzStorageAccount -ResourceGroupName {resourceGroup} -Name {storageAccountName} -ErrorAction SilentlyContinue; `; Configures via `$law = Get-AzOperationalInsightsWorkspace -ResourceGroupName {resourceGroup} -Name {lawWorkspaceName} -ErrorAction Stop`
- **az** — Set Diagnostic Setting — Virtual Machine: Verifies via `$diag = Get-AzDiagnosticSetting -ResourceId (Get-AzVM -ResourceGroupName {resourceGroup} -Name {vmName}).Id -Name 'diag-`; Configures via `$law = Get-AzOperationalInsightsWorkspace -ResourceGroupName {resourceGroup} -Name {lawWorkspaceName}`
- **az** — Set Diagnostic Setting — Subscription Activity Log: Verifies via `$diag = Get-AzSubscriptionDiagnosticSetting -ErrorAction SilentlyContinue -WarningAction SilentlyContinue`; Configures via `$law = Get-AzOperationalInsightsWorkspace -ResourceGroupName {resourceGroup} -Name {lawWorkspaceName} -ErrorAction Stop`
- **az** — Resource Group CanNotDelete Lock: Verifies via `$locks = Get-AzResourceLock -ResourceGroupName {resourceGroup} -ErrorAction SilentlyContinue; $match = $locks`; Configures via `New-AzResourceLock -LockName 'DoNotDelete' -LockLevel CanNotDelete -ResourceGroupName {resourceGroup} -Force`
- **az** — Entra ID Diagnostic Settings: Verifies via `az rest --method GET --url 'https://management.usgovcloudapi.net/providers/microsoft.aadiam/diagnosticSettings?api-versi`
- **az** — Create Entra ID Diagnostic Settings: Verifies via `az rest --method GET --url 'https://management.usgovcloudapi.net/providers/microsoft.aadiam/diagnosticSettings?api-versi` *(evidence-only)*
- **az** — Sentinel CMMC 2.0 Content Hub Solution: Verifies via `$json = az rest --method GET --url "https://management.usgovcloudapi.net/subscriptions/{subscriptionId}/resourceGroups/{`

#### AU.L2-3.3.2 — Ensure that the actions of individual system users can be uniquely traced to those users so they can be held accountable for their actions.

- **Gap Classifications:** configure
- **mgraph** — Sign-In and Directory Audit Log Evidence: Verifies via `Get-MgAuditLogSignIn -Filter "createdDateTime ge $((Get-Date).AddDays(-30).ToString('yyyy-MM-ddTHH:m`
- **az** — NSG Boundary Protection Rules: Verifies via `Get-AzNetworkSecurityGroup -ResourceGroupName 'rg-eo-prod'`
- **az** — Enable Microsoft Defender for Cloud (P2): Verifies via `Get-AzSecurityPricing`; Configures via `Set-AzSecurityPricing -Name 'VirtualMachines' -PricingTier 'Standard'`
- **az** — Create Log Analytics Workspace (365-day retention): Verifies via `Get-AzOperationalInsightsWorkspace -ResourceGroupName {resourceGroup} -Name {lawWorkspaceName}`; Configures via `New-AzOperationalInsightsWorkspace -ResourceGroupName {resourceGroup} -Name {lawWorkspaceName} -Location {location} -Sku`
- **az** — Create Immutable Log Storage Account: Verifies via `Get-AzStorageAccount -ResourceGroupName {resourceGroup} -Name {storageAccountName}`; Configures via `New-AzStorageAccount -ResourceGroupName {resourceGroup} -Name {storageAccountName} -Location {location} -SkuName 'Standa`
- **az** — Enable NSG Flow Logs to Log Analytics: Verifies via `$flowLog = Get-AzNetworkWatcherFlowLogStatus -NetworkWatcher (Get-AzNetworkWatcher`; Configures via `$nsg = Get-AzNetworkSecurityGroup -ResourceGroupName {resourceGroup} -Name 'nsg-workload-cmmc'`
- **az** — Create Sentinel CMMC Analytics Rule - Excessive Failed Logins: Verifies via `Get-AzSentinelAlertRule -ResourceGroupName {resourceGroup} -WorkspaceName {lawWorkspaceName} -ErrorAction SilentlyContin`; Configures via `$existing = Get-AzSentinelAlertRule -ResourceGroupName {resourceGroup} -WorkspaceName {lawWorkspaceName} -ErrorAction Si`
- **az** — Set Diagnostic Setting — Subscription Activity Log: Verifies via `$diag = Get-AzSubscriptionDiagnosticSetting -Name 'activitylog-to-law' -WarningAction SilentlyContinue; if ($diag.Worksp` *(evidence-only)*
- **az** — Set Diagnostic Setting — Key Vault: Verifies via `$diag = Get-AzDiagnosticSetting -ResourceId (Get-AzKeyVault -ResourceGroupName {resourceGroup} -VaultName {keyVaultName}`; Configures via `$law = Get-AzOperationalInsightsWorkspace -ResourceGroupName {resourceGroup} -Name {lawWorkspaceName}`
- **az** — Set Diagnostic Setting — Network Security Group: Verifies via `$diag = Get-AzDiagnosticSetting -ResourceId (Get-AzNetworkSecurityGroup -ResourceGroupName {resourceGroup} -Name 'nsg-wo`; Configures via `$law = Get-AzOperationalInsightsWorkspace -ResourceGroupName {resourceGroup} -Name {lawWorkspaceName}`
- **az** — Set Diagnostic Setting — Storage Account: Verifies via `$sa = Get-AzStorageAccount -ResourceGroupName {resourceGroup} -Name {storageAccountName} -ErrorAction SilentlyContinue; `; Configures via `$law = Get-AzOperationalInsightsWorkspace -ResourceGroupName {resourceGroup} -Name {lawWorkspaceName} -ErrorAction Stop`
- **az** — Set Diagnostic Setting — Virtual Machine: Verifies via `$diag = Get-AzDiagnosticSetting -ResourceId (Get-AzVM -ResourceGroupName {resourceGroup} -Name {vmName}).Id -Name 'diag-`; Configures via `$law = Get-AzOperationalInsightsWorkspace -ResourceGroupName {resourceGroup} -Name {lawWorkspaceName}`
- **az** — Set Diagnostic Setting — Subscription Activity Log: Verifies via `$diag = Get-AzSubscriptionDiagnosticSetting -ErrorAction SilentlyContinue -WarningAction SilentlyContinue`; Configures via `$law = Get-AzOperationalInsightsWorkspace -ResourceGroupName {resourceGroup} -Name {lawWorkspaceName} -ErrorAction Stop`
- **az** — Entra ID Diagnostic Settings: Verifies via `az rest --method GET --url 'https://management.usgovcloudapi.net/providers/microsoft.aadiam/diagnosticSettings?api-versi`
- **az** — Create Entra ID Diagnostic Settings: Verifies via `az rest --method GET --url 'https://management.usgovcloudapi.net/providers/microsoft.aadiam/diagnosticSettings?api-versi` *(evidence-only)*

#### AU.L2-3.3.3 — Review and update logged events.

- **Gap Classifications:** customize
- **az** — Connect Office 365 Data Connector to Sentinel: Verifies via `az rest --method GET --url 'https://management.usgovcloudapi.net/subscriptions/{subscriptionId}/reso`; Configures via `$f = Join-Path $env:TEMP 'stamper-sentinel-body.json'`
- **az** — NSG Boundary Protection Rules: Verifies via `Get-AzNetworkSecurityGroup -ResourceGroupName 'rg-eo-prod'`
- **az** — Enable Microsoft Defender for Cloud (P2): Verifies via `Get-AzSecurityPricing`; Configures via `Set-AzSecurityPricing -Name 'VirtualMachines' -PricingTier 'Standard'`
- **az** — Create Log Analytics Workspace (365-day retention): Verifies via `Get-AzOperationalInsightsWorkspace -ResourceGroupName {resourceGroup} -Name {lawWorkspaceName}`; Configures via `New-AzOperationalInsightsWorkspace -ResourceGroupName {resourceGroup} -Name {lawWorkspaceName} -Location {location} -Sku`
- **az** — Onboard Sentinel to Log Analytics Workspace: Verifies via `az rest --method GET --url 'https://management.usgovcloudapi.net/subscriptions/{subscriptionId}/resourceGroups/{resource`; Configures via `az rest --method PUT --url 'https://management.usgovcloudapi.net/subscriptions/{subscriptionId}/resourceGroups/{resource`
- **az** — Create Sentinel CMMC Analytics Rule - Excessive Failed Logins: Verifies via `Get-AzSentinelAlertRule -ResourceGroupName {resourceGroup} -WorkspaceName {lawWorkspaceName} -ErrorAction SilentlyContin`; Configures via `$existing = Get-AzSentinelAlertRule -ResourceGroupName {resourceGroup} -WorkspaceName {lawWorkspaceName} -ErrorAction Si`

#### AU.L2-3.3.4 — Alert in the event of an audit logging process failure.

- **Gap Classifications:** customize
- **az** — Create Azure Monitor Action Group for CISO Alerts: Verifies via `Get-AzActionGroup -ResourceGroupName {resourceGroup} -Name 'CMMC-AlertGroup'`; Configures via `$emailReceiver = New-AzActionGroupEmailReceiverObject -Name 'CISO' -EmailAddress '{cisoEmail}' -UseCommonAlertSchema $tr`

#### AU.L2-3.3.5 — Correlate audit record review, analysis and reporting processes for investigation and response to indications of unlawful, unauthorized, suspicious or unusual activity.

- **Gap Classifications:** configure
- **exchange** — Audit Log Search Evidence (Reduce/Review Capability): Verifies via `Search-UnifiedAuditLog -StartDate (Get-Date).AddDays(-7) -EndDate (Get-Date) -RecordType ExchangeAdm`

#### AU.L2-3.3.8 — Protect audit information and audit logging tools from unauthorized access, modification, and deletion.

- **Gap Classifications:** configure
- **mgraph** — Audit Log Access Restriction - Compliance Admin Role Evidence: Verifies via `Get-MgRoleManagementDirectoryRoleAssignment -Filter "roleDefinitionId eq '{complianceRoleId}'" -All`
- **az** — Apply CanNotDelete Lock to Sentinel Log Analytics Workspace: Verifies via `Invoke-AzRestMethod -Method GET -Path '/subscriptions/{subscriptionId}/resourceGroups/{resourceGroup}/providers/Microsof`; Configures via `Invoke-AzRestMethod -Method PUT -Path '/subscriptions/{subscriptionId}/resourceGroups/{resourceGroup}/providers/Microsof`

#### AU.L2-3.3.9 — Limit management of audit logging functionality to a subset of privileged users.

- **Gap Classifications:** configure
- **mgraph** — Audit Log Access Restriction - Compliance Admin Role Evidence: Verifies via `Get-MgRoleManagementDirectoryRoleAssignment -Filter "roleDefinitionId eq '{complianceRoleId}'" -All`

### CM — Configuration Management

#### CM.L2-3.4.1 — Establish and maintain baseline configurations and inventories of organizational systems (including hardware, software, firmware, and documentation) throughout the respective system development life cycles.

- **Gap Classifications:** manual, configure
- **mgraph** — Deploy Windows Security Baseline via Intune Template: Verifies via `(Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/beta/deviceManagement/intents').value`; Configures via `Invoke-MgGraphRequest -Method POST -Uri 'https://graph.microsoft.us/beta/deviceManagement/templates/`
- **az** — NSG Boundary Protection Rules: Verifies via `Get-AzNetworkSecurityGroup -ResourceGroupName 'rg-eo-prod'`
- **az** — Assign CMMC L2 Azure Policy Initiative: Verifies via `Get-AzPolicyAssignment -Name 'CMMC-L2-Initiative' -Scope '/subscriptions/{subscriptionId}' -ErrorAction SilentlyContinue`; Configures via `$policySetDef = Get-AzPolicySetDefinition -Id '/providers/Microsoft.Authorization/policySetDefinitions/4e50fd13-098b-320`
- **az** — Enable Microsoft Defender for Cloud (P2): Verifies via `Get-AzSecurityPricing`; Configures via `Set-AzSecurityPricing -Name 'VirtualMachines' -PricingTier 'Standard'`
- **az** — Create Workload VM (no public IP, system managed identity): Verifies via `Get-AzVM -ResourceGroupName {resourceGroup} -Name {vmName}`; Configures via `$vnet = Get-AzVirtualNetwork -ResourceGroupName {resourceGroup} -Name {vnetName}`
- **az** — Assign DISA STIG Policy to VM: Verifies via `Get-AzPolicyAssignment -Name 'DISA-STIG-VM-{vmName}'`; Configures via `New-AzPolicyAssignment -Name 'DISA-STIG-VM-{vmName}' -DisplayName 'DISA STIG for Windows Server 2022 — {vmName}' -Policy`
- **az** — Install Microsoft Defender for Endpoint VM Extension: Verifies via `$ext = Get-AzVMExtension -ResourceGroupName {resourceGroup} -VMName {vmName} -Name 'MicrosoftMonitoringAgent'; if ($ext.`; Configures via `Set-AzVMExtension -ResourceGroupName {resourceGroup} -VMName {vmName} -Name 'MicrosoftMonitoringAgent' -Publisher 'Micro`

#### CM.L2-3.4.2 — Establish and enforce security configuration settings for information technology products employed in organizational systems.

- **Gap Classifications:** configure
- **mgraph** — Deploy Attack Surface Reduction Rules via Intune Configuration Policy: Verifies via `(Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/beta/deviceManagement/configurationPolicies'`; Configures via `Invoke-MgGraphRequest -Method POST -Uri 'https://graph.microsoft.us/beta/deviceManagement/configurat`
- **az** — Assign DISA STIG Policy to VM: Verifies via `Get-AzPolicyAssignment -Name 'DISA-STIG-VM-{vmName}'`; Configures via `New-AzPolicyAssignment -Name 'DISA-STIG-VM-{vmName}' -DisplayName 'DISA STIG for Windows Server 2022 — {vmName}' -Policy`
- **az** — Resource Group CanNotDelete Lock: Verifies via `$locks = Get-AzResourceLock -ResourceGroupName {resourceGroup} -ErrorAction SilentlyContinue; $match = $locks`; Configures via `New-AzResourceLock -LockName 'DoNotDelete' -LockLevel CanNotDelete -ResourceGroupName {resourceGroup} -Force`

#### CM.L2-3.4.3 — Track, review, approve or disapprove and log changes to organizational systems.

- **Gap Classifications:** customize, configure
- **mgraph** — Configuration Change Tracking via Intune Audit Log: Verifies via `Get-MgDeviceManagementAuditEvent -All -Property ActivityDateTime,ActivityType,ActivityOperationType,`

#### CM.L2-3.4.5 — Define, document, approve and enforce physical and logical access restrictions associated with changes to organizational systems.

- **Gap Classifications:** configure
- **mgraph** — Access Restriction for Configuration Changes via Role Assignments: Verifies via `Get-MgDirectoryRole`

#### CM.L2-3.4.7 — Restrict, disable or prevent the use of nonessential programs, functions, ports, protocols and services.

- **Gap Classifications:** customize
- **mgraph** — WDAC Application Control Policy via Intune: Verifies via `(Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/deviceManagement/deviceConfigurations')`; Configures via `Invoke-MgGraphRequest -Method POST -Uri 'https://graph.microsoft.us/v1.0/deviceManagement/deviceConf`

#### CM.L2-3.4.9 — Control and monitor user-installed software.

- **Gap Classifications:** configure
- **mgraph** — User Software Installation Control via Intune: Verifies via `(Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/deviceManagement/deviceConfigurations')`; Configures via `Invoke-MgGraphRequest -Method POST -Uri 'https://graph.microsoft.us/v1.0/deviceManagement/deviceConf`

### IA — Identification and Authentication

#### IA.L1-3.5.1 — Identify information system users, processes acting on behalf of users or devices.

- **Gap Classifications:** configure
- **mgraph** — User and Device Identification Evidence: Verifies via `Get-MgUser -Filter 'accountEnabled eq true' -All`
- **mgraph** — Verify User and Device Identity Management: Verifies via `Get-MgUser -Top 1 -Property Id,DisplayName,UserPrincipalName,AccountEnabled`

#### IA.L1-3.5.2 — Authenticate (or verify) the identities of those users, processes, or devices, as a prerequisite to allowing access to organizational information systems.

- **Gap Classifications:** configure
- **mgraph** — User and Device Identification Evidence: Verifies via `Get-MgUser -Filter 'accountEnabled eq true' -All`
- **mgraph** — Verify Authentication Methods Policy: Verifies via `Get-MgPolicyAuthenticationMethodPolicy`

#### IA.L2-3.5.3 — Use multi-factor authentication for local and network access to privileged accounts and for network access to non-privileged accounts.

- **Gap Classifications:** manual, configure
- **mgraph** — Enable Microsoft Authenticator Authentication Method: Verifies via `Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/policies/authenticationMethodsPolicy/aut`; Configures via `Invoke-MgGraphRequest -Method PATCH -Uri 'https://graph.microsoft.us/v1.0/policies/authenticationMet`
- **mgraph** — Enable FIDO2 Security Key Authentication Method: Verifies via `Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/policies/authenticationMethodsPolicy/aut`; Configures via `Invoke-MgGraphRequest -Method PATCH -Uri 'https://graph.microsoft.us/v1.0/policies/authenticationMet`

#### IA.L2-3.5.4 — Employ replay-resistant authentication mechanisms for network access to privileged and non-privileged accounts.

- **Gap Classifications:** configure
- **mgraph** — Create Phishing-Resistant Authentication Strength Policy: Verifies via `Get-MgPolicyAuthenticationStrengthPolicy -All`; Configures via `Invoke-MgGraphRequest -Method POST -Uri 'https://graph.microsoft.us/v1.0/policies/authenticationStre`

#### IA.L2-3.5.5 — Prevent the reuse of identifiers for a defined period.

- **Gap Classifications:** configure
- **mgraph** — Disable Inactive Accounts Inactive 90+ Days: Verifies via `Get-MgUser -Filter 'accountEnabled eq true' -All -Property DisplayName,UserPrincipalName,SignInActiv`; Configures via `Get-MgUser -Filter 'accountEnabled eq true' -All -Property DisplayName,UserPrincipalName,SignInActiv`

#### IA.L2-3.5.6 — Disable identifiers after a defined period of inactivity.

- **Gap Classifications:** configure
- **mgraph** — Disable Inactive Accounts Inactive 90+ Days: Verifies via `Get-MgUser -Filter 'accountEnabled eq true' -All -Property DisplayName,UserPrincipalName,SignInActiv`; Configures via `Get-MgUser -Filter 'accountEnabled eq true' -All -Property DisplayName,UserPrincipalName,SignInActiv`

#### IA.L2-3.5.7 — Enforce a minimum password complexity and change of characters when new passwords are created.

- **Gap Classifications:** configure
- **mgraph** — Enable Azure AD Password Protection and Banned Password List: Verifies via `Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/policies/authenticationMethodsPolicy'`

#### IA.L2-3.5.9 — Allow temporary password use for system logons with an immediate change to a permanent password.

- **Gap Classifications:** configure
- **mgraph** — Configure Temporary Access Pass (One-Time Use, 60 Minutes): Verifies via `(Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/policies/authenticationMethodsPolicy/au`; Configures via `$body = '{"@odata.type":"#microsoft.graph.temporaryAccessPassAuthenticationMethodConfiguration","sta`

### IR — Incident Response

#### IR.L2-3.6.1 — Establish an operational incident-handling capability for organizational systems that includes preparation, detection, analysis, containment, recovery, and user response activities.

- **Gap Classifications:** manual, configure
- **exchange** — Enable Defender for Office 365 ATP for SharePoint, Teams, and OneDrive: Verifies via `Get-AtpPolicyForO365`; Configures via `Set-AtpPolicyForO365 -EnableATPForSPOTeamsODB $true`
- **exchange** — Enable File Type Filtering in Default Malware Filter Policy: Verifies via `Get-MalwareFilterPolicy -Identity Default`; Configures via `Set-MalwareFilterPolicy -Identity Default -EnableFileFilter $true`

#### IR.L2-3.6.2 — Track, document and report incidents to designated officials and/or authorities both internal and external to the organization.

- **Gap Classifications:** customize
- **az** — Sentinel Incident Tracking and Response Evidence: Verifies via `Get-AzSentinelIncident -ResourceGroupName {resourceGroup} -WorkspaceName {lawWorkspaceName}`

### MA — Maintenance

#### MA.L2-3.7.5 — Require multifactor authentication to establish non-local maintenance sessions via external network connections and terminate such connections when nonlocal maintenance is complete.

- **Gap Classifications:** configure
- **mgraph** — MFA for Remote Maintenance via Conditional Access: Verifies via `Get-MgIdentityConditionalAccessPolicy`; Configures via `New-MgIdentityConditionalAccessPolicy -DisplayName 'CMMC-RemoteMaintenance-MFA' -State 'enabledForRe`

### MP — Media Protection

#### MP.L2-3.8.1 — Protect (i.e., physically control and securely store) system media containing CUI, both paper and digital.

- **Gap Classifications:** customize
- **ipps** — Create CUI Sensitivity Label with Encryption: Verifies via `Get-Label -Identity 'CUI'`; Configures via `New-Label -Name 'CUI' -DisplayName 'CUI - Controlled Unclassified Information' -Tooltip 'Contains CU`
- **ipps** — Publish CUI Sensitivity Label Policy to All Workloads: Verifies via `Get-LabelPolicy -Identity 'CMMC-CUI-Policy'`; Configures via `New-LabelPolicy -Name 'CMMC-CUI-Policy' -Labels 'CUI' -ExchangeLocation All`

#### MP.L2-3.8.2 — Limit access to CUI on system media to authorized users.

- **Gap Classifications:** customize
- **ipps** — Create CUI Sensitivity Label with Encryption: Verifies via `Get-Label -Identity 'CUI'`; Configures via `New-Label -Name 'CUI' -DisplayName 'CUI - Controlled Unclassified Information' -Tooltip 'Contains CU`

#### MP.L1-3.8.3 — Sanitize or destroy information system media containing Federal Contract Information (FCI) before disposal or release for reuse.

- **Gap Classifications:** manual, customize
- **manual_gate** — Media Sanitization Before Disposal (Manual Gate):  *(evidence-only)*
- **manual_gate** — Sanitize or Destroy Media Before Disposal or Reuse:  *(evidence-only)*

#### MP.L2-3.8.4 — Mark media with necessary CUI markings and distribution limitations.

- **Gap Classifications:** configure
- **ipps** — Create CUI Sensitivity Label with Encryption: Verifies via `Get-Label -Identity 'CUI'`; Configures via `New-Label -Name 'CUI' -DisplayName 'CUI - Controlled Unclassified Information' -Tooltip 'Contains CU`

#### MP.L2-3.8.8 — Prohibit the use of portable storage devices when such devices have no identifiable owner.

- **Gap Classifications:** customize
- **manual_gate** — Portable Storage Device Ownership and Accountability (Manual Gate):  *(evidence-only)*
- **mgraph** — Verify Intune Policy Prohibiting Unidentified Portable Storage: Verifies via `Get-MgDeviceManagementDeviceConfiguration`

#### MP.L2-3.8.9 — Protect the confidentiality of backup CUI at storage locations.

- **Gap Classifications:** configure
- **ipps** — Create DLP Compliance Policy to Enforce CUI Blocking: Verifies via `Get-DlpCompliancePolicy -Identity 'CMMC-CUI-Block'`; Configures via `New-DlpCompliancePolicy -Name 'CMMC-CUI-Block' -ExchangeLocation All -SharePointLocation All -OneDri`
- **ipps** — Create DLP Compliance Rule to Block CUI and Notify Owner: Verifies via `Get-DlpComplianceRule -Policy 'CMMC-CUI-Block'`; Configures via `New-DlpComplianceRule -Name 'CMMC-CUI-Block-Rule' -Policy 'CMMC-CUI-Block' -BlockAccess $true -Notif`

### CA — Security Assessment

#### CA.L2-3.12.1 — Periodically assess the security controls in organizational systems to determine if the controls are effective in their application.

- **Gap Classifications:** configure
- **mgraph** — Compliance Assessment Evidence via Compliance Manager: Verifies via `(Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/security/secureScores?$top=1').value`

#### CA.L2-3.12.3 — Monitor security controls on an ongoing basis to ensure the continued effectiveness of the controls.

- **Gap Classifications:** configure
- **mgraph** — Compliance Assessment Evidence via Compliance Manager: Verifies via `(Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/security/secureScores?$top=1').value`

### SC — Systems and Communications Protection

#### SC.L1-3.13.1 — Monitor, control and protect organizational communications (e.g., information transmitted or received by organizational information systems) at the external boundaries and key internal boundaries of the information systems.

- **Gap Classifications:** configure
- **mgraph** — Deploy Windows Defender Firewall Policy via Intune Endpoint Security: Verifies via `(Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/beta/deviceManagement/configurationPolicies'`; Configures via `Invoke-MgGraphRequest -Method POST -Uri 'https://graph.microsoft.us/beta/deviceManagement/configurat`
- **mgraph** — Collect Conditional Access Policies for Boundary Protection: Verifies via `Get-MgIdentityConditionalAccessPolicy`
- **az** — NSG Boundary Protection Rules: Verifies via `Get-AzNetworkSecurityGroup -ResourceGroupName 'rg-eo-prod'`
- **az** — Register Required Azure Resource Providers: Verifies via `Get-AzResourceProvider -ListAvailable`; Configures via `@('Microsoft.OperationalInsights','Microsoft.SecurityInsights','Microsoft.Security','Microsoft.Automation','Microsoft.Ke`
- **az** — Set Azure Subscription Context: Verifies via `Get-AzContext`; Configures via `Set-AzContext -Subscription {subscriptionId}`
- **az** — Create Azure Resource Group: Verifies via `Get-AzResourceGroup -Name {resourceGroup}`; Configures via `New-AzResourceGroup -Name {resourceGroup} -Location {location} -Tag @{environment='cmmc-l2'`
- **az** — Assign CMMC L2 Azure Policy Initiative: Verifies via `Get-AzPolicyAssignment -Name 'CMMC-L2-Initiative' -Scope '/subscriptions/{subscriptionId}' -ErrorAction SilentlyContinue`; Configures via `$policySetDef = Get-AzPolicySetDefinition -Id '/providers/Microsoft.Authorization/policySetDefinitions/4e50fd13-098b-320`
- **az** — Enable Microsoft Defender for Cloud (P2): Verifies via `Get-AzSecurityPricing`; Configures via `Set-AzSecurityPricing -Name 'VirtualMachines' -PricingTier 'Standard'`
- **az** — Create Key Vault (purge-protection enabled): Verifies via `Get-AzKeyVault -ResourceGroupName {resourceGroup} -VaultName {keyVaultName}`; Configures via `New-AzKeyVault -ResourceGroupName {resourceGroup} -VaultName {keyVaultName} -Location {location} -EnablePurgeProtection `
- **az** — Create Virtual Network: Verifies via `Get-AzVirtualNetwork -ResourceGroupName {resourceGroup} -Name {vnetName}`; Configures via `New-AzVirtualNetwork -ResourceGroupName {resourceGroup} -Name {vnetName} -Location {location} -AddressPrefix {vnetCidr}`
- **az** — Create Management Subnet: Verifies via `Get-AzVirtualNetwork -ResourceGroupName {resourceGroup} -Name {vnetName} -ErrorAction SilentlyContinue`; Configures via `$vnet = Get-AzVirtualNetwork -ResourceGroupName {resourceGroup} -Name {vnetName}`
- **az** — Create Workload Subnet: Verifies via `Get-AzVirtualNetwork -ResourceGroupName {resourceGroup} -Name {vnetName} -ErrorAction SilentlyContinue`; Configures via `$vnet = Get-AzVirtualNetwork -ResourceGroupName {resourceGroup} -Name {vnetName}`
- **az** — Create AzureBastionHost Subnet: Verifies via `Get-AzVirtualNetwork -ResourceGroupName {resourceGroup} -Name {vnetName} -ErrorAction SilentlyContinue`; Configures via `$vnet = Get-AzVirtualNetwork -ResourceGroupName {resourceGroup} -Name {vnetName}`
- **az** — Create AzureFirewall Subnet: Verifies via `Get-AzVirtualNetwork -ResourceGroupName {resourceGroup} -Name {vnetName} -ErrorAction SilentlyContinue`; Configures via `$vnet = Get-AzVirtualNetwork -ResourceGroupName {resourceGroup} -Name {vnetName}`
- **az** — Create Network Security Group: Verifies via `Get-AzNetworkSecurityGroup -ResourceGroupName {resourceGroup} -Name 'nsg-workload-cmmc'`; Configures via `New-AzNetworkSecurityGroup -ResourceGroupName {resourceGroup} -Name 'nsg-workload-cmmc' -Location {location}`
- **az** — Add NSG Rule — Deny All Inbound: Verifies via `Get-AzNetworkSecurityGroup -ResourceGroupName {resourceGroup} -Name 'nsg-workload-cmmc'`; Configures via `$nsg = Get-AzNetworkSecurityGroup -ResourceGroupName {resourceGroup} -Name 'nsg-workload-cmmc'`
- **az** — Add NSG Rule — Deny All Outbound: Verifies via `Get-AzNetworkSecurityGroup -ResourceGroupName {resourceGroup} -Name 'nsg-workload-cmmc'`; Configures via `$nsg = Get-AzNetworkSecurityGroup -ResourceGroupName {resourceGroup} -Name 'nsg-workload-cmmc'`
- **az** — Add NSG Rule — Allow Bastion Inbound: Verifies via `Get-AzNetworkSecurityGroup -ResourceGroupName {resourceGroup} -Name 'nsg-workload-cmmc'`; Configures via `$nsg = Get-AzNetworkSecurityGroup -ResourceGroupName {resourceGroup} -Name 'nsg-workload-cmmc'`
- **az** — Associate NSG with Workload Subnet: Verifies via `(Get-AzVirtualNetwork -ResourceGroupName {resourceGroup} -Name {vnetName}`; Configures via `$vnet = Get-AzVirtualNetwork -ResourceGroupName {resourceGroup} -Name {vnetName}`
- **az** — Create Network Watcher: Verifies via `Get-AzNetworkWatcher`; Configures via `$existing = Get-AzNetworkWatcher | Where-Object {$_.Location -eq 'usgovvirginia'}`
- **az** — Create Firewall Public IP: Verifies via `Get-AzPublicIpAddress -ResourceGroupName {resourceGroup} -Name 'pip-fw-cmmc'`; Configures via `New-AzPublicIpAddress -ResourceGroupName {resourceGroup} -Name 'pip-fw-cmmc' -Location {location} -Sku 'Standard' -Alloc`
- **az** — Create Azure Firewall: Verifies via `Get-AzFirewall -ResourceGroupName {resourceGroup} -Name 'fw-cmmc' -ErrorAction SilentlyContinue -WarningAction SilentlyC`; Configures via `$policy = Get-AzFirewallPolicy -ResourceGroupName {resourceGroup} -Name 'cmmc-fw-policy' -ErrorAction SilentlyContinue`
- **az** — Create Bastion Public IP: Verifies via `Get-AzPublicIpAddress -ResourceGroupName {resourceGroup} -Name 'pip-bastion-cmmc' -ErrorAction SilentlyContinue`; Configures via `New-AzPublicIpAddress -ResourceGroupName {resourceGroup} -Name 'pip-bastion-cmmc' -Location {location} -Sku 'Standard' -`
- **az** — Create Azure Bastion Host: Verifies via `$bastion = Get-AzBastion -ResourceGroupName {resourceGroup} -Name 'bastion-cmmc'; if ($bastion.IpConfigurations.Subnet.I`; Configures via `$vnet = Get-AzVirtualNetwork -ResourceGroupName {resourceGroup} -Name {vnetName}`
- **az** — Create Private Endpoint for Key Vault: Verifies via `Get-AzPrivateEndpoint -ResourceGroupName 'rg-eo-prod' -ErrorAction SilentlyContinue -WarningAction SilentlyContinue`; Configures via `$existing = Get-AzPrivateEndpoint -ResourceGroupName 'rg-eo-prod' | Where-Object {$_.Name -like 'pe-kv*'}`
- **az** — Create Private Endpoint for Storage Account: Verifies via `Get-AzPrivateEndpoint -ResourceGroupName 'rg-eo-prod' -ErrorAction SilentlyContinue -WarningAction SilentlyContinue`; Configures via `$existing = Get-AzPrivateEndpoint -ResourceGroupName 'rg-eo-prod' | Where-Object {$_.Name -like 'pe-storage*' -or $_.Nam`
- **az** — Create Automation Account: Verifies via `Get-AzAutomationAccount -ResourceGroupName {resourceGroup} -Name {automationAccountName}`; Configures via `New-AzAutomationAccount -Name {automationAccountName} -ResourceGroupName {resourceGroup} -Location {location}`
- **az** — Assign System Managed Identity to Automation Account: Verifies via `$acct = Get-AzAutomationAccount -ResourceGroupName {resourceGroup} -Name {automationAccountName}; if ($acct.Subscription`; Configures via `Invoke-AzRestMethod -Method PATCH -Uri '/subscriptions/{subscriptionId}/resourceGroups/{resourceGroup}/providers/Microso`
- **az** — Grant Automation MI RBAC Roles (Security Reader, LAR on LAW, SBDC on Storage, KV Crypto User on KV): Verifies via `$assignments = Get-AzRoleAssignment -ObjectId {automationMiPrincipalId}; @{ hasSubScope = ($assignments`; Configures via `New-AzRoleAssignment -ObjectId {automationMiPrincipalId} -RoleDefinitionName 'Security Reader' -Scope '/subscriptions/{s`
- **az** — Create Workload VM (no public IP, system managed identity): Verifies via `Get-AzVM -ResourceGroupName {resourceGroup} -Name {vmName}`; Configures via `$vnet = Get-AzVirtualNetwork -ResourceGroupName {resourceGroup} -Name {vnetName}`
- **mgraph** — EO Automation Service Principal: Verifies via `Get-MgServicePrincipal -Filter "appId eq '{appId}'"`
- **az** — Private DNS Zone: Key Vault: Verifies via `Get-AzPrivateDnsZone -ResourceGroupName {resourceGroup} -Name 'privatelink.vaultcore.usgovcloudapi.net'`; Configures via `New-AzPrivateDnsZone -ResourceGroupName {resourceGroup} -Name 'privatelink.vaultcore.usgovcloudapi.net' | ConvertTo-Json`
- **az** — Private DNS Zone: Blob Storage: Verifies via `Get-AzPrivateDnsZone -ResourceGroupName {resourceGroup} -Name 'privatelink.blob.core.usgovcloudapi.net'`; Configures via `New-AzPrivateDnsZone -ResourceGroupName {resourceGroup} -Name 'privatelink.blob.core.usgovcloudapi.net' | ConvertTo-Json`
- **az** — Verify Network Security Group Boundary Rules: Verifies via `Get-AzNetworkSecurityGroup -ResourceGroupName {resourceGroup} -ErrorAction SilentlyContinue`
- **az** — Create Azure Firewall Policy with Threat Intel Deny Mode: Verifies via `Get-AzFirewallPolicy -ResourceGroupName {resourceGroup} -Name 'cmmc-fw-policy'`; Configures via `New-AzFirewallPolicy -Name 'cmmc-fw-policy' -ResourceGroupName {resourceGroup} -Location {location} -ThreatIntelMode 'De`

#### SC.L2-3.13.2 — Employ architectural designs, software development techniques and systems engineering principles that promote effective information security within organizational systems.

- **Gap Classifications:** customize
- **az** — Azure Advisor Security Recommendations Evidence: Verifies via `az advisor recommendation list --output json`
- **mgraph** — Intune Screen Lock / Session Lock Policy Evidence: Verifies via `Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/deviceManagement/deviceConfigurations?$f`

#### SC.L2-3.13.3 — Separate user functionality from system management functionality.

- **Gap Classifications:** configure
- **mgraph** — PIM JIT Eligible Role Assignment: Verifies via `Get-MgRoleManagementDirectoryRoleEligibilitySchedule -All`; Configures via `New-MgRoleManagementDirectoryRoleEligibilityScheduleRequest -BodyParameter @{action='adminAssign'`

#### SC.L2-3.13.4 — Prevent unauthorized and unintended information transfer via shared system resources.

- **Gap Classifications:** configure
- **mgraph** — CUI Media Access Control via Intune Removable Storage Policy: Verifies via `(Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/deviceManagement/deviceConfigurations')`
- **mgraph** — Conditional Access Policy for Remote Access Sessions: Verifies via `Get-MgIdentityConditionalAccessPolicy -All`

#### SC.L1-3.13.5 — Implement subnetworks for publicly accessible system components that are physically or logically separated from internal networks.

- **Gap Classifications:** configure
- **mgraph** — Deploy Windows Defender Firewall Policy via Intune Endpoint Security: Verifies via `(Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/beta/deviceManagement/configurationPolicies'`; Configures via `Invoke-MgGraphRequest -Method POST -Uri 'https://graph.microsoft.us/beta/deviceManagement/configurat`
- **az** — NSG Boundary Protection Rules: Verifies via `Get-AzNetworkSecurityGroup -ResourceGroupName 'rg-eo-prod'`
- **az** — Create Virtual Network: Verifies via `Get-AzVirtualNetwork -ResourceGroupName {resourceGroup} -Name {vnetName}`; Configures via `New-AzVirtualNetwork -ResourceGroupName {resourceGroup} -Name {vnetName} -Location {location} -AddressPrefix {vnetCidr}`
- **az** — Create Management Subnet: Verifies via `Get-AzVirtualNetwork -ResourceGroupName {resourceGroup} -Name {vnetName} -ErrorAction SilentlyContinue`; Configures via `$vnet = Get-AzVirtualNetwork -ResourceGroupName {resourceGroup} -Name {vnetName}`
- **az** — Create Network Security Group: Verifies via `Get-AzNetworkSecurityGroup -ResourceGroupName {resourceGroup} -Name 'nsg-workload-cmmc'`; Configures via `New-AzNetworkSecurityGroup -ResourceGroupName {resourceGroup} -Name 'nsg-workload-cmmc' -Location {location}`
- **az** — Add NSG Rule — Deny All Inbound: Verifies via `Get-AzNetworkSecurityGroup -ResourceGroupName {resourceGroup} -Name 'nsg-workload-cmmc'`; Configures via `$nsg = Get-AzNetworkSecurityGroup -ResourceGroupName {resourceGroup} -Name 'nsg-workload-cmmc'`
- **az** — Add NSG Rule — Deny All Outbound: Verifies via `Get-AzNetworkSecurityGroup -ResourceGroupName {resourceGroup} -Name 'nsg-workload-cmmc'`; Configures via `$nsg = Get-AzNetworkSecurityGroup -ResourceGroupName {resourceGroup} -Name 'nsg-workload-cmmc'`
- **az** — Add NSG Rule — Allow Bastion Inbound: Verifies via `Get-AzNetworkSecurityGroup -ResourceGroupName {resourceGroup} -Name 'nsg-workload-cmmc'`; Configures via `$nsg = Get-AzNetworkSecurityGroup -ResourceGroupName {resourceGroup} -Name 'nsg-workload-cmmc'`
- **az** — Verify VNet Subnet Segmentation: Verifies via `Get-AzVirtualNetwork -ResourceGroupName {resourceGroup}`

#### SC.L2-3.13.6 — Deny network communications traffic by default and allow network communications traffic by exception (e.g., deny all, permit by exception).

- **Gap Classifications:** configure
- **mgraph** — Deploy Windows Defender Firewall Policy via Intune Endpoint Security: Verifies via `(Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/beta/deviceManagement/configurationPolicies'`; Configures via `Invoke-MgGraphRequest -Method POST -Uri 'https://graph.microsoft.us/beta/deviceManagement/configurat`
- **az** — NSG Boundary Protection Rules: Verifies via `Get-AzNetworkSecurityGroup -ResourceGroupName 'rg-eo-prod'`
- **az** — Create Virtual Network: Verifies via `Get-AzVirtualNetwork -ResourceGroupName {resourceGroup} -Name {vnetName}`; Configures via `New-AzVirtualNetwork -ResourceGroupName {resourceGroup} -Name {vnetName} -Location {location} -AddressPrefix {vnetCidr}`
- **az** — Create Management Subnet: Verifies via `Get-AzVirtualNetwork -ResourceGroupName {resourceGroup} -Name {vnetName} -ErrorAction SilentlyContinue`; Configures via `$vnet = Get-AzVirtualNetwork -ResourceGroupName {resourceGroup} -Name {vnetName}`
- **az** — Create Workload Subnet: Verifies via `Get-AzVirtualNetwork -ResourceGroupName {resourceGroup} -Name {vnetName} -ErrorAction SilentlyContinue`; Configures via `$vnet = Get-AzVirtualNetwork -ResourceGroupName {resourceGroup} -Name {vnetName}`
- **az** — Create AzureBastionHost Subnet: Verifies via `Get-AzVirtualNetwork -ResourceGroupName {resourceGroup} -Name {vnetName} -ErrorAction SilentlyContinue`; Configures via `$vnet = Get-AzVirtualNetwork -ResourceGroupName {resourceGroup} -Name {vnetName}`
- **az** — Create AzureFirewall Subnet: Verifies via `Get-AzVirtualNetwork -ResourceGroupName {resourceGroup} -Name {vnetName} -ErrorAction SilentlyContinue`; Configures via `$vnet = Get-AzVirtualNetwork -ResourceGroupName {resourceGroup} -Name {vnetName}`
- **az** — Add NSG Rule — Deny All Inbound: Verifies via `Get-AzNetworkSecurityGroup -ResourceGroupName {resourceGroup} -Name 'nsg-workload-cmmc'`; Configures via `$nsg = Get-AzNetworkSecurityGroup -ResourceGroupName {resourceGroup} -Name 'nsg-workload-cmmc'`
- **az** — Create Firewall Public IP: Verifies via `Get-AzPublicIpAddress -ResourceGroupName {resourceGroup} -Name 'pip-fw-cmmc'`; Configures via `New-AzPublicIpAddress -ResourceGroupName {resourceGroup} -Name 'pip-fw-cmmc' -Location {location} -Sku 'Standard' -Alloc`
- **az** — Create Azure Firewall: Verifies via `Get-AzFirewall -ResourceGroupName {resourceGroup} -Name 'fw-cmmc' -ErrorAction SilentlyContinue -WarningAction SilentlyC`; Configures via `$policy = Get-AzFirewallPolicy -ResourceGroupName {resourceGroup} -Name 'cmmc-fw-policy' -ErrorAction SilentlyContinue`
- **az** — Create Private Endpoint for Key Vault: Verifies via `Get-AzPrivateEndpoint -ResourceGroupName 'rg-eo-prod' -ErrorAction SilentlyContinue -WarningAction SilentlyContinue`; Configures via `$existing = Get-AzPrivateEndpoint -ResourceGroupName 'rg-eo-prod' | Where-Object {$_.Name -like 'pe-kv*'}`
- **az** — Create Private Endpoint for Storage Account: Verifies via `Get-AzPrivateEndpoint -ResourceGroupName 'rg-eo-prod' -ErrorAction SilentlyContinue -WarningAction SilentlyContinue`; Configures via `$existing = Get-AzPrivateEndpoint -ResourceGroupName 'rg-eo-prod' | Where-Object {$_.Name -like 'pe-storage*' -or $_.Nam`
- **az** — Private DNS Zone: Key Vault: Verifies via `Get-AzPrivateDnsZone -ResourceGroupName {resourceGroup} -Name 'privatelink.vaultcore.usgovcloudapi.net'`; Configures via `New-AzPrivateDnsZone -ResourceGroupName {resourceGroup} -Name 'privatelink.vaultcore.usgovcloudapi.net' | ConvertTo-Json`
- **az** — Private DNS Zone: Blob Storage: Verifies via `Get-AzPrivateDnsZone -ResourceGroupName {resourceGroup} -Name 'privatelink.blob.core.usgovcloudapi.net'`; Configures via `New-AzPrivateDnsZone -ResourceGroupName {resourceGroup} -Name 'privatelink.blob.core.usgovcloudapi.net' | ConvertTo-Json`
- **az** — Create Azure Firewall Policy with Threat Intel Deny Mode: Verifies via `Get-AzFirewallPolicy -ResourceGroupName {resourceGroup} -Name 'cmmc-fw-policy'`; Configures via `New-AzFirewallPolicy -Name 'cmmc-fw-policy' -ResourceGroupName {resourceGroup} -Location {location} -ThreatIntelMode 'De`

#### SC.L2-3.13.7 — Prevent remote devices from simultaneously establishing non-remote connections with organizational systems and communicating via some other connection to resources in external networks (i.e., split tunneling).

- **Gap Classifications:** configure
- **mgraph** — Conditional Access - Block Untrusted Network Locations: Verifies via `Get-MgIdentityConditionalAccessPolicy -Filter "displayName eq 'CMMC-BlockUntrustedLocations'"`; Configures via `New-MgIdentityConditionalAccessPolicy -BodyParameter @{displayName='CMMC-BlockUntrustedLocations'`

#### SC.L2-3.13.8 — Implement cryptographic mechanisms to prevent unauthorized disclosure of CUI during transmission unless otherwise protected by alternative physical safeguards.

- **Gap Classifications:** configure
- **exchange** — Disable Legacy TLS Client Connections in Exchange Transport: Verifies via `Get-TransportConfig`; Configures via `Set-TransportConfig -AllowLegacyTLSClients $false`

#### SC.L2-3.13.9 — Terminate network connections associated with communications sessions at the end of the sessions or after a defined period of inactivity.

- **Gap Classifications:** customize
- **mgraph** — Deploy Screen Lock / Session Timeout Intune Policy: Verifies via `(Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/deviceManagement/deviceConfigurations')`; Configures via `Invoke-MgGraphRequest -Method POST -Uri 'https://graph.microsoft.us/v1.0/deviceManagement/deviceConf`

#### SC.L2-3.13.10 — Establish and manage cryptographic keys for cryptography employed in organizational systems.

- **Gap Classifications:** configure
- **az** — NSG Boundary Protection Rules: Verifies via `Get-AzNetworkSecurityGroup -ResourceGroupName 'rg-eo-prod'`
- **az** — Assign System Managed Identity to Storage Account: Verifies via `Get-AzStorageAccount -ResourceGroupName {resourceGroup} -Name {storageAccountName}`; Configures via `Set-AzStorageAccount -ResourceGroupName {resourceGroup} -Name {storageAccountName} -AssignIdentity`
- **az** — Grant Storage MI Key Vault Crypto Service Encryption User Role: Verifies via `Get-AzRoleAssignment -ObjectId {storageMiPrincipalId} -Scope {kvResourceId}`; Configures via `New-AzRoleAssignment -RoleDefinitionName 'Key Vault Crypto Service Encryption User' -ObjectId {storageMiPrincipalId} -Sc`
- **az** — Enable CMK Encryption on Storage Account: Verifies via `Get-AzStorageAccount -ResourceGroupName {resourceGroup} -Name {storageAccountName}`; Configures via `Set-AzStorageAccount -ResourceGroupName {resourceGroup} -Name {storageAccountName} -KeyvaultEncryption -KeyName {cmkKeyN`
- **az** — Create Key Vault (purge-protection enabled): Verifies via `Get-AzKeyVault -ResourceGroupName {resourceGroup} -VaultName {keyVaultName}`; Configures via `New-AzKeyVault -ResourceGroupName {resourceGroup} -VaultName {keyVaultName} -Location {location} -EnablePurgeProtection `
- **az** — Assign Key Vault Crypto Officer Role to EO Service Principal: Verifies via `Get-AzRoleAssignment -Scope (Get-AzKeyVault -ResourceGroupName {resourceGroup} -VaultName {keyVaultName}).ResourceId`; Configures via `$assignment = New-AzRoleAssignment -ObjectId {eoSpObjectId} -RoleDefinitionName 'Key Vault Crypto Officer' -Scope (Get-A`
- **az** — Create CMK Key in Key Vault (RSA-HSM 4096): Verifies via `Get-AzKeyVaultKey -VaultName {keyVaultName} -Name {cmkKeyName} -ErrorAction SilentlyContinue -WarningAction SilentlyCont`; Configures via `Add-AzKeyVaultKey -VaultName {keyVaultName} -Name {cmkKeyName} -Destination HSM -KeyType RSA -Size 4096 -KeyOps @('wrapK`
- **az** — Enable VM Disk Encryption (CMK via Key Vault): Verifies via `Get-AzVMDiskEncryptionStatus -ResourceGroupName {resourceGroup} -VMName {vmName}`; Configures via `Set-AzVMDiskEncryptionExtension -ResourceGroupName {resourceGroup} -VMName {vmName} -DiskEncryptionKeyVaultUrl {kvUri} -`
- **az** — Restrict Key Vault Network Access to Azure Services Only: Verifies via `$vault = Get-AzKeyVault -VaultName {keyVaultName} -ErrorAction SilentlyContinue -WarningAction SilentlyContinue; if ($va`; Configures via `Update-AzKeyVaultNetworkRuleSet -VaultName {keyVaultName} -DefaultAction Deny -Bypass AzureServices`

#### SC.L2-3.13.11 — Employ FIPS-validated cryptography when used to protect the confidentiality of CUI.

- **Gap Classifications:** manual, configure
- **mgraph** — FIPS 140-2 Compliance Verification (Platform Inherited): Verifies via `(Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/organization').value`

#### SC.L2-3.13.12 — Prohibit remote activation of collaborative computing devices and provide indication of devices in use to users present at the device.

- **Gap Classifications:** configure
- **mgraph** — Block Camera and Collaborative Devices via Intune Policy: Verifies via `(Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/deviceManagement/deviceConfigurations')`; Configures via `Invoke-MgGraphRequest -Method POST -Uri 'https://graph.microsoft.us/v1.0/deviceManagement/deviceConf`

#### SC.L2-3.13.13 — Control and monitor the use of mobile code.

- **Gap Classifications:** customize
- **exchange** — Create Safe Attachments Policy with Dynamic Delivery: Verifies via `Get-SafeAttachmentPolicy -Identity 'CMMC-SafeAttach'`; Configures via `New-SafeAttachmentPolicy -Name 'CMMC-SafeAttach' -Action DynamicDelivery -Enable $true`
- **exchange** — Create Safe Attachments Rule for Primary Domain: Verifies via `Get-SafeAttachmentRule -Identity 'CMMC-SafeAttach-Rule'`; Configures via `New-SafeAttachmentRule -Name 'CMMC-SafeAttach-Rule' -SafeAttachmentPolicy 'CMMC-SafeAttach' -Recipie`

#### SC.L2-3.13.14 — Control and monitor the use of Voice over Internet Protocol (VoIP) technologies.

- **Gap Classifications:** configure
- **teams** — Disable Teams Federation and Public Cloud External Access: Verifies via `Get-CsExternalAccessPolicy -Identity Global`; Configures via `Set-CsExternalAccessPolicy -Identity Global -EnableFederationAccess $false -EnableTeamsConsumerAcces`

#### SC.L2-3.13.15 — Protect the authenticity of communications sessions.

- **Gap Classifications:** configure
- **exchange** — Enable DKIM Signing for Primary Domain: Verifies via `Get-DkimSigningConfig`; Configures via `try { New-DkimSigningConfig -DomainName '{primaryDomain}' -Enabled $true } catch { Set-DkimSigningCo`
- **exchange** — Create Anti-Phishing Policy with Mailbox Intelligence: Verifies via `Get-AntiPhishPolicy -Identity 'CMMC-AntiPhish'`; Configures via `try { New-AntiPhishPolicy -Name 'CMMC-AntiPhish' -EnableMailboxIntelligence $true -EnableMailboxInte`
- **exchange** — Create Anti-Phishing Rule for Primary Domain: Verifies via `Get-AntiPhishRule -Identity 'CMMC-AntiPhish-Rule'`; Configures via `try { New-AntiPhishRule -Name 'CMMC-AntiPhish-Rule' -AntiPhishPolicy 'CMMC-AntiPhish' -RecipientDoma`
- **exchange** — Create Anti-Spam Inbound Content Filter Policy: Verifies via `Get-HostedContentFilterPolicy -Identity 'CMMC-AntiSpam'`; Configures via `try { New-HostedContentFilterPolicy -Name 'CMMC-AntiSpam' -SpamAction MoveToJmf -HighConfidenceSpamA`
- **exchange** — Create Anti-Spam Inbound Filter Rule for Primary Domain: Verifies via `Get-HostedContentFilterRule -Identity 'CMMC-AntiSpam-Rule'`; Configures via `try { New-HostedContentFilterRule -Name 'CMMC-AntiSpam-Rule' -HostedContentFilterPolicy 'CMMC-AntiSp`
- **exchange** — Create Outbound Spam Filter Policy with User Block on Threshold: Verifies via `Get-HostedOutboundSpamFilterPolicy -Identity 'CMMC-OutboundSpam'`; Configures via `try { New-HostedOutboundSpamFilterPolicy -Name 'CMMC-OutboundSpam' -ActionWhenThresholdReached Block`
- **exchange** — Create Outbound Spam Filter Rule for Primary Domain: Verifies via `Get-HostedOutboundSpamFilterRule -Identity 'CMMC-OutboundSpam-Rule'`; Configures via `try { New-HostedOutboundSpamFilterRule -Name 'CMMC-OutboundSpam-Rule' -HostedOutboundSpamFilterPolic`

### SI — System and Information Integrity

#### SI.L1-3.14.1 — Identify, report and correct information and information system flaws in a timely manner.

- **Gap Classifications:** configure
- **mgraph** — System Flaw Identification via Defender Vulnerability Management: Verifies via `(Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/security/alerts_v2?$top=10&$orderby=cre`
- **mgraph** — Verify Defender Vulnerability Management Configuration: Verifies via `$scores = Get-MgSecuritySecureScore -Top 1 -ErrorAction SilentlyContinue; if ($scores) { @{ secureSc`
- **az** — NSG Boundary Protection Rules: Verifies via `Get-AzNetworkSecurityGroup -ResourceGroupName 'rg-eo-prod'`
- **az** — Enable Microsoft Defender for Cloud (P2): Verifies via `Get-AzSecurityPricing`; Configures via `Set-AzSecurityPricing -Name 'VirtualMachines' -PricingTier 'Standard'`
- **az** — Onboard Sentinel to Log Analytics Workspace: Verifies via `az rest --method GET --url 'https://management.usgovcloudapi.net/subscriptions/{subscriptionId}/resourceGroups/{resource`; Configures via `az rest --method PUT --url 'https://management.usgovcloudapi.net/subscriptions/{subscriptionId}/resourceGroups/{resource`
- **az** — Enable Sentinel Azure Activity Data Connector: Verifies via `$connector = Get-AzSentinelDataConnector -ResourceGroupName {resourceGroup} -WorkspaceName {lawWorkspaceName}`; Configures via `New-AzSentinelDataConnector -ResourceGroupName {resourceGroup} -WorkspaceName {lawWorkspaceName} -Kind 'AzureActivity' -`
- **az** — Enable Sentinel Microsoft Defender for Cloud Data Connector: Verifies via `Get-AzSentinelDataConnector -ResourceGroupName {resourceGroup} -WorkspaceName {lawWorkspaceName}`; Configures via `New-AzSentinelDataConnector -ResourceGroupName {resourceGroup} -WorkspaceName {lawWorkspaceName} -Kind 'MicrosoftDefende`
- **az** — Enable Sentinel Azure Key Vault Data Connector: Verifies via `Get-AzSentinelDataConnector -ResourceGroupName {resourceGroup} -WorkspaceName {lawWorkspaceName}`; Configures via `New-AzSentinelDataConnector -ResourceGroupName {resourceGroup} -WorkspaceName {lawWorkspaceName} -Kind 'AzureKeyVault'`
- **az** — Create Sentinel CMMC Analytics Rule - Privileged Identity Changes: Verifies via `Connect-AzAccount -ServicePrincipal -TenantId 'bbe08772-8fde-4e55-961a-8a43779e7d58' -ApplicationId '830b3c2a-4cb3-415a-`; Configures via `$existing = Get-AzSentinelAlertRule -ResourceGroupName rg-eo-prod -WorkspaceName vfsgov-law-prod -ErrorAction SilentlyCo`
- **az** — Create Sentinel CMMC Analytics Rule - Malware Detection: Verifies via `Get-AzSentinelAlertRule -ResourceGroupName {resourceGroup} -WorkspaceName {lawWorkspaceName} -ErrorAction SilentlyContin`; Configures via `$existing = Get-AzSentinelAlertRule -ResourceGroupName {resourceGroup} -WorkspaceName {lawWorkspaceName} -ErrorAction Si`
- **az** — Create Sentinel CMMC Analytics Rule - Excessive Failed Logins: Verifies via `Get-AzSentinelAlertRule -ResourceGroupName {resourceGroup} -WorkspaceName {lawWorkspaceName} -ErrorAction SilentlyContin`; Configures via `$existing = Get-AzSentinelAlertRule -ResourceGroupName {resourceGroup} -WorkspaceName {lawWorkspaceName} -ErrorAction Si`
- **az** — Create Sentinel CMMC Analytics Rule - Unauthorized Resource Deletion: Verifies via `Get-AzSentinelAlertRule -ResourceGroupName {resourceGroup} -WorkspaceName {lawWorkspaceName} -ErrorAction SilentlyContin`; Configures via `$existing = Get-AzSentinelAlertRule -ResourceGroupName {resourceGroup} -WorkspaceName {lawWorkspaceName} -ErrorAction Si`
- **az** — Install Microsoft Defender for Endpoint VM Extension: Verifies via `$ext = Get-AzVMExtension -ResourceGroupName {resourceGroup} -VMName {vmName} -Name 'MicrosoftMonitoringAgent'; if ($ext.`; Configures via `Set-AzVMExtension -ResourceGroupName {resourceGroup} -VMName {vmName} -Name 'MicrosoftMonitoringAgent' -Publisher 'Micro`
- **az** — Sentinel CMMC 2.0 Content Hub Solution: Verifies via `$json = az rest --method GET --url "https://management.usgovcloudapi.net/subscriptions/{subscriptionId}/resourceGroups/{`

#### SI.L1-3.14.2 — Provide protection from malicious code at appropriate locations within organizational information systems.

- **Gap Classifications:** configure
- **exchange** — Create CMMC Malware Filter Policy with File Type Rejection: Verifies via `Get-MalwareFilterPolicy -Identity 'CMMC-Malware'`; Configures via `New-MalwareFilterPolicy -Name 'CMMC-Malware' -EnableFileFilter $true -FileTypeAction Reject -EnableI`
- **exchange** — Create Malware Filter Rule for Primary Domain: Verifies via `Get-MalwareFilterRule -Identity 'CMMC-Malware-Rule'`; Configures via `New-MalwareFilterRule -Name 'CMMC-Malware-Rule' -MalwareFilterPolicy 'CMMC-Malware' -RecipientDomain`
- **mgraph** — Verify Defender Antimalware Policy Configuration: Verifies via `Get-MgDeviceManagementDeviceConfiguration`

#### SI.L2-3.14.3 — Monitor system security alerts and advisories and take action in response.

- **Gap Classifications:** customize
- **exchange** — Create Safe Links Policy with URL Scanning: Verifies via `Get-SafeLinksPolicy -Identity 'CMMC-SafeLinks'`; Configures via `New-SafeLinksPolicy -Name 'CMMC-SafeLinks' -EnableSafeLinksForEmail $true -ScanUrls $true -EnableFor`
- **exchange** — Create Safe Links Rule for Primary Domain: Verifies via `Get-SafeLinksRule -Identity 'CMMC-SafeLinks-Rule'`; Configures via `New-SafeLinksRule -Name 'CMMC-SafeLinks-Rule' -SafeLinksPolicy 'CMMC-SafeLinks' -RecipientDomainIs '`

#### SI.L1-3.14.4 — Update malicious code protection mechanisms when new releases are available.

- **Gap Classifications:** configure
- **mgraph** — Antivirus Signature Currency via Intune: Verifies via `Get-MgDeviceManagementDeviceConfiguration -DeviceConfigurationId 'a9c376e2-8763-49e1-9c96-e1f548a628`
- **mgraph** — Verify Defender Automatic Update Configuration: Verifies via `Get-MgDeviceManagementDeviceConfiguration`

#### SI.L1-3.14.5 — Perform periodic scans of the information system and real-time scans of files from external sources as files are downloaded, opened or executed.

- **Gap Classifications:** configure
- **mgraph** — Scheduled Malware Scan Configuration via Intune: Verifies via `Get-MgDeviceManagementDeviceConfiguration -All`
- **mgraph** — Create/Verify CMMC Defender Antivirus Policy via Intune: Verifies via `Get-MgDeviceManagementDeviceConfiguration -All`; Configures via `$existing = Get-MgDeviceManagementDeviceConfiguration -All | Where-Object {$_.DisplayName -eq 'CMMC-`

#### SI.L2-3.14.6 — Monitor organizational systems, including inbound and outbound communications traffic, to detect attacks and indicators of potential attacks.

- **Gap Classifications:** customize
- **mgraph** — Security Alert Monitoring Evidence via Defender: Verifies via `$secInfo = Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/security/secureScores?$top=1'`
- **exchange** — Anti-Spam Hosted Content Filter Policy Evidence: Verifies via `Get-HostedContentFilterPolicy -Identity 'Default'`
- **az** — NSG Boundary Protection Rules: Verifies via `Get-AzNetworkSecurityGroup -ResourceGroupName 'rg-eo-prod'`
- **az** — Enable Microsoft Defender for Cloud (P2): Verifies via `Get-AzSecurityPricing`; Configures via `Set-AzSecurityPricing -Name 'VirtualMachines' -PricingTier 'Standard'`
- **az** — Create Sentinel CMMC Analytics Rule - Privileged Identity Changes: Verifies via `Connect-AzAccount -ServicePrincipal -TenantId 'bbe08772-8fde-4e55-961a-8a43779e7d58' -ApplicationId '830b3c2a-4cb3-415a-`; Configures via `$existing = Get-AzSentinelAlertRule -ResourceGroupName rg-eo-prod -WorkspaceName vfsgov-law-prod -ErrorAction SilentlyCo`
- **az** — Create Sentinel CMMC Analytics Rule - Malware Detection: Verifies via `Get-AzSentinelAlertRule -ResourceGroupName {resourceGroup} -WorkspaceName {lawWorkspaceName} -ErrorAction SilentlyContin`; Configures via `$existing = Get-AzSentinelAlertRule -ResourceGroupName {resourceGroup} -WorkspaceName {lawWorkspaceName} -ErrorAction Si`

#### SI.L2-3.14.7 — Identify unauthorized use of organizational systems.

- **Gap Classifications:** customize
- **az** — Sentinel Threat Intelligence Data Connectors: Verifies via `az sentinel data-connector list --resource-group {resourceGroup} --workspace-name {lawWorkspaceName}`
- **az** — Enable Sentinel UEBA for Anomalous Behavior Detection: Verifies via `Invoke-AzRestMethod -Method GET -Path '/subscriptions/{subscriptionId}/resourceGroups/{resourceGroup}/providers/Microsof`; Configures via `Invoke-AzRestMethod -Method PUT -Path '/subscriptions/{subscriptionId}/resourceGroups/{resourceGroup}/providers/Microsof`

## NON-STACK — Process, policy, or physical controls requiring manual attestation (22)

### AT — Awareness and Training

#### AT.L2-3.2.1 — Ensure that managers, system administrators and users of organizational systems are made aware of the security risks associated with their activities and of the applicable policies, standards and procedures related to the security of those systems.

- **Gap Classifications:** manual
- **manual_gate** — Security Awareness Training Evidence Collection:  *(evidence-only)*

#### AT.L2-3.2.2 — Ensure that personnel are trained to carry out their assigned information security- related duties and responsibilities.

- **Gap Classifications:** manual
- **manual_gate** — Security Awareness Training Evidence Collection:  *(evidence-only)*

#### AT.L2-3.2.3 — Provide security awareness training on recognizing and reporting potential indicators of insider threat.

- **Gap Classifications:** manual
- **ipps** — Insider Threat Awareness Program Evidence: Verifies via `Get-InsiderRiskPolicy`

### AU — Audit and Accountability

#### AU.L2-3.3.6 — Provide audit record reduction and report generation to support on-demand analysis and reporting.

- **Gap Classifications:** manual
- **ipps** — Audit Reduction via Compliance Search: Verifies via `Get-ComplianceSearch -Identity 'CMMC-AuditReduction-{tenantName}'`; Configures via `New-ComplianceSearch -Name 'CMMC-AuditReduction-{tenantName}' -ExchangeLocation All -ContentMatchQue`

#### AU.L2-3.3.7 — Provide a system capability that compares and synchronizes internal system clocks with an authoritative source to generate time stamps for audit records.

- **Gap Classifications:** manual
- **mgraph** — Authoritative Time Source Verification (Platform Inherited): Verifies via `(Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/organization').value`

### CM — Configuration Management

#### CM.L2-3.4.4 — Analyze the security impact of changes prior to implementation.

- **Gap Classifications:** manual
- **manual_gate** — Security Impact Analysis of Changes (Manual Process Gate):  *(evidence-only)*

#### CM.L2-3.4.8 — Apply deny-by-exception (blacklisting) policy to prevent the use of unauthorized software or deny-all, permit-by-exception (whitelisting) policy to allow the execution of authorized software.

- **Gap Classifications:** manual
- **mgraph** — Detected Applications Inventory Evidence via Intune: Verifies via `(Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/deviceManagement/detectedApps').value`

### IA — Identification and Authentication

#### IA.L2-3.5.8 — Prohibit password reuse for a specified number of generations.

- **Gap Classifications:** manual
- **mgraph** — Password Reuse Prevention Evidence: Verifies via `Get-MgDomain -DomainId '{primaryDomain}'`

#### IA.L2-3.5.10 — Store and transmit only cryptographically protected passwords.

- **Gap Classifications:** manual
- **mgraph** — Enable Certificate-Based Authentication Method: Verifies via `Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/policies/authenticationMethodsPolicy/aut`; Configures via `Invoke-MgGraphRequest -Method PATCH -Uri 'https://graph.microsoft.us/v1.0/policies/authenticationMet`

#### IA.L2-3.5.11 — Obscure feedback of authentication information.

- **Gap Classifications:** manual
- **mgraph** — Login Page Branding Evidence (Password Obscured by Platform): Verifies via `Get-MgOrganizationBranding -OrganizationId '{tenantId}'`

### IR — Incident Response

#### IR.L2-3.6.3 — Test the organizational incident response capability.

- **Gap Classifications:** manual
- **mgraph** — Launch Attack Simulation for Incident Response Testing: Verifies via `(Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/security/alerts_v2?$top=5&$orderby=crea`

### MA — Maintenance

#### MA.L2-3.7.1 — Perform maintenance on organizational systems.

- **Gap Classifications:** manual
- **mgraph** — Deploy Windows Update for Business Ring via Intune: Verifies via `(Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/deviceManagement/deviceConfigurations')`; Configures via `Invoke-MgGraphRequest -Method POST -Uri 'https://graph.microsoft.us/v1.0/deviceManagement/deviceConf`

#### MA.L2-3.7.2 — Provide controls on the tools, techniques, mechanisms, and personnel used to conduct system maintenance.

- **Gap Classifications:** manual
- **mgraph** — Deploy Windows Update for Business Ring via Intune: Verifies via `(Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/deviceManagement/deviceConfigurations')`; Configures via `Invoke-MgGraphRequest -Method POST -Uri 'https://graph.microsoft.us/v1.0/deviceManagement/deviceConf`

#### MA.L2-3.7.3 — Ensure equipment removed for off-site maintenance is sanitized of any CUI.

- **Gap Classifications:** manual
- **manual_gate** — Sanitize Equipment Removed for Off-Site Maintenance:  *(evidence-only)*

#### MA.L2-3.7.6 — Supervise the maintenance activities of personnel without required access authorization.

- **Gap Classifications:** manual
- **manual_gate** — Supervised Maintenance by Authorized Personnel (Manual Gate):  *(evidence-only)*

### PS — Personnel Security

#### PS.L2-3.9.1 — Screen individuals prior to authorizing access to organizational systems containing CUI.

- **Gap Classifications:** manual
- **manual_gate** — Personnel Background Screening Process (Manual Gate):  *(evidence-only)*

#### PS.L2-3.9.2 — Ensure that organizational systems containing CUI are protected during and after personnel actions such as terminations and transfers.

- **Gap Classifications:** manual, configure
- **mgraph** — Personnel Termination and Transfer Account Disable Evidence: Verifies via `Get-MgUser -Filter 'accountEnabled eq false' -All`

### RA — Risk Assessment

#### RA.L2-3.11.1 — Periodically assess the risk to organizational operations (including mission, functions, image or reputation), organizational assets and individuals, resulting from the operation of organizational systems and the associated processing, storage or transmission of CUI.

- **Gap Classifications:** manual
- **mgraph** — Microsoft Secure Score Risk Assessment Evidence: Verifies via `(Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/security/secureScores').value`

#### RA.L2-3.11.2 — Scan for vulnerabilities in organizational systems and applications periodically and when new vulnerabilities affecting those systems and applications are identified.

- **Gap Classifications:** manual
- **mgraph** — Vulnerability Scan Results Evidence via Defender: Verifies via `(Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/deviceManagement/managedDevices?$select`

#### RA.L2-3.11.3 — Remediate vulnerabilities in accordance with risk assessments.

- **Gap Classifications:** manual
- **mgraph** — Vulnerability Remediation via Windows Update for Business Rings: Verifies via `(Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/deviceManagement/deviceConfigurations')`; Configures via `Invoke-MgGraphRequest -Method POST -Uri 'https://graph.microsoft.us/v1.0/deviceManagement/deviceConf`

### CA — Security Assessment

#### CA.L2-3.12.2 — Develop and implement plans of action (e.g., POA&M) designed to correct deficiencies and reduce or eliminate vulnerabilities in organizational systems.

- **Gap Classifications:** manual
- **mgraph** — POA&M Improvement Actions Evidence via Compliance Manager: Verifies via `(Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/security/secureScoreControlProfiles').v`

#### CA.L2-3.12.4 — Develop, document and periodically update System Security Plans (SSPs) that describe system boundaries, system environments of operation, how security requirements are implemented and the relationships with or connections to other systems.

- **Gap Classifications:** manual
- **manual_gate** — System Security Plan Documentation (Manual Gate):  *(evidence-only)*

## EXCLUDED — Out of scope per Strategic Intent baseline (21)

### AC — Access Control

#### AC.L2-3.1.6 — Use non-privileged accounts or roles when accessing non-security functions.

- **Exclusion Reason:** Removable media prohibited by policy and technical control per Strategic Intent baseline
- **mgraph** — Create Dedicated Admin Account: Verifies via `Get-MgUser -Filter "displayName eq 'Admin-{adminUserName}'"`; Configures via `New-MgUser -DisplayName "Admin-{adminUserName}" -UserPrincipalName "admin-{adminUserName}@{tenantNam`

#### AC.L2-3.1.10 — Use session lock with pattern-hiding displays to prevent access and viewing of data after a period of inactivity.

- **Exclusion Reason:** CUI accessible via browser only with endpoint downloads blocked per Strategic Intent baseline
- **mgraph** — Deploy Screen Lock / Session Timeout Intune Policy: Verifies via `(Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/deviceManagement/deviceConfigurations')`; Configures via `Invoke-MgGraphRequest -Method POST -Uri 'https://graph.microsoft.us/v1.0/deviceManagement/deviceConf`

#### AC.L2-3.1.12 — Monitor and control remote access sessions.

- **Exclusion Reason:** No remote access to CUI systems per Strategic Intent baseline
- **mgraph** — Create Approved CUI Named Location (IP Range): Verifies via `Get-MgIdentityConditionalAccessNamedLocation -Filter "displayName eq 'Approved-CUI-Networks'"`; Configures via `New-MgIdentityConditionalAccessNamedLocation -BodyParameter @{'@odata.type'='#microsoft.graph.ipName`

#### AC.L2-3.1.13 — Employ cryptographic mechanisms to protect the confidentiality of remote access sessions.

- **Exclusion Reason:** No remote access to CUI systems per Strategic Intent baseline
- **exchange** — Disable Legacy TLS Client Connections in Exchange Transport: Verifies via `Get-TransportConfig`; Configures via `Set-TransportConfig -AllowLegacyTLSClients $false`

#### AC.L2-3.1.14 — Route remote access via managed access control points.

- **Exclusion Reason:** No wireless networks in CUI enclave per Strategic Intent baseline
- **mgraph** — Conditional Access - Block Untrusted Network Locations: Verifies via `Get-MgIdentityConditionalAccessPolicy -Filter "displayName eq 'CMMC-BlockUntrustedLocations'"`; Configures via `New-MgIdentityConditionalAccessPolicy -BodyParameter @{displayName='CMMC-BlockUntrustedLocations'`

#### AC.L2-3.1.16 — Authorize wireless access prior to allowing such connections.

- **Exclusion Reason:** No wireless networks in CUI enclave per Strategic Intent baseline
- **mgraph** — Deploy WPA2-Enterprise WiFi Profile via Intune: Verifies via `(Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/deviceManagement/deviceConfigurations')`; Configures via `Invoke-MgGraphRequest -Method POST -Uri 'https://graph.microsoft.us/v1.0/deviceManagement/deviceConf`

#### AC.L2-3.1.17 — Protect wireless access using authentication and encryption.

- **Exclusion Reason:** Removable media prohibited by policy and technical control per Strategic Intent baseline
- **mgraph** — Verify Intune Wi-Fi Configuration Profiles Enforce WPA2/3: Verifies via `Get-MgDeviceManagementDeviceConfiguration`

#### AC.L2-3.1.18 — Control connection of mobile devices.

- **Exclusion Reason:** No mobile devices in CUI enclave per Strategic Intent baseline
- **mgraph** — Conditional Access - Mobile Device Compliance Requirement: Verifies via `Get-MgIdentityConditionalAccessPolicy -Filter "displayName eq 'CMMC-MobileDeviceAccess'"`; Configures via `New-MgIdentityConditionalAccessPolicy -BodyParameter @{displayName='CMMC-MobileDeviceAccess'`

#### AC.L2-3.1.19 — Encrypt CUI on mobile devices and mobile computing platforms.

- **Exclusion Reason:** No mobile devices in CUI enclave per Strategic Intent baseline
- **mgraph** — Deploy iOS MAM App Protection Policy: Verifies via `Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/deviceAppManagement/iosManagedAppProtect`; Configures via `Invoke-MgGraphRequest -Method POST -Uri 'https://graph.microsoft.us/v1.0/deviceAppManagement/iosMana`

### CM — Configuration Management

#### CM.L2-3.4.6 — Employ the principle of least functionality by configuring organizational systems to provide only essential capabilities.

- **Exclusion Reason:** CUI accessible via browser only with endpoint downloads blocked per Strategic Intent baseline
- **mgraph** — Enforce Least Functionality - Disable Cortana and MSIA: Verifies via `(Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/deviceManagement/deviceConfigurations')`; Configures via `Invoke-MgGraphRequest -Method POST -Uri 'https://graph.microsoft.us/v1.0/deviceManagement/deviceConf`

### MA — Maintenance

#### MA.L2-3.7.4 — Check media containing diagnostic and test programs for malicious code before the media are used in organizational systems.

- **Exclusion Reason:** No nonlocal maintenance performed per Strategic Intent baseline
- **mgraph** — Media Malware Check via Defender AV Evidence: Verifies via `(Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/deviceManagement/deviceCompliancePolici`

### MP — Media Protection

#### MP.L2-3.8.5 — Control access to media containing CUI and maintain accountability for media during transport outside of controlled areas.

- **Exclusion Reason:** Removable media prohibited by policy and technical control per Strategic Intent baseline
- **mgraph** — CUI Media Access Control via Intune Removable Storage Policy: Verifies via `(Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/deviceManagement/deviceConfigurations')`

#### MP.L2-3.8.6 — Implement cryptographic mechanisms to protect the confidentiality of CUI stored on digital media during transport unless otherwise protected by alternative physical safeguards.

- **Exclusion Reason:** Removable media prohibited by policy and technical control per Strategic Intent baseline
- **mgraph** — Deploy BitLocker Drive Encryption Policy via Intune: Verifies via `(Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/deviceManagement/managedDevices?$filter`; Configures via `Invoke-MgGraphRequest -Method POST -Uri 'https://graph.microsoft.us/v1.0/deviceManagement/deviceConf`

#### MP.L2-3.8.7 — Control the use of removable media on system components.

- **Exclusion Reason:** CUI accessible via browser only with endpoint downloads blocked per Strategic Intent baseline
- **manual_gate** — Removable Media Identification and Marking (Manual Gate):  *(evidence-only)*
- **mgraph** — Verify Intune Removable Storage Restriction Policy: Verifies via `Get-MgDeviceManagementDeviceConfiguration`

### PE — Physical Protection

#### PE.L1-3.10.1 — Limit physical access to organizational information systems, equipment, and the respective operating environments to authorized individuals.

- **Exclusion Reason:** Physical security inherited from FedRAMP High cloud service provider per SI baseline cloud-only deployment posture
- **manual_gate** — Physical Access Authorization and Control (Manual Gate):  *(evidence-only)*
- **manual_gate** — Limit Physical Access to Organizational Systems:  *(evidence-only)*

#### PE.L2-3.10.2 — Protect and monitor the physical facility and support infrastructure for organizational systems.

- **Exclusion Reason:** Physical security inherited from FedRAMP High cloud service provider per SI baseline cloud-only deployment posture
- **manual_gate** — Physical Facility Monitoring and Visitor Escort (Manual Gate):  *(evidence-only)*

#### PE.L1-3.10.3 — Escort visitors and monitor visitor activity.

- **Exclusion Reason:** Physical security inherited from FedRAMP High cloud service provider per SI baseline cloud-only deployment posture
- **manual_gate** — Physical Access Log Audit (Manual Gate):  *(evidence-only)*
- **manual_gate** — Escort Visitors and Monitor Visitor Activity:  *(evidence-only)*

#### PE.L1-3.10.4 — Maintain audit logs of physical access.

- **Exclusion Reason:** Physical security inherited from FedRAMP High cloud service provider per SI baseline cloud-only deployment posture
- **manual_gate** — Physical Safeguarding of CUI Systems (Manual Gate):  *(evidence-only)*
- **manual_gate** — Maintain Audit Logs of Physical Access:  *(evidence-only)*

#### PE.L1-3.10.5 — Control and manage physical access devices.

- **Exclusion Reason:** Physical security inherited from FedRAMP High cloud service provider per SI baseline cloud-only deployment posture
- **manual_gate** — Physical Protection of CUI Output (Manual Gate):  *(evidence-only)*
- **manual_gate** — Control and Manage Physical Access Devices:  *(evidence-only)*

#### PE.L2-3.10.6 — Enforce safeguarding measures for CUI at alternate work sites.

- **Exclusion Reason:** No remote access to CUI systems per Strategic Intent baseline
- **manual_gate** — Alternative Work Site Physical Controls (Manual Gate):  *(evidence-only)*

### SC — Systems and Communications Protection

#### SC.L2-3.13.16 — Protect the confidentiality of CUI at rest.

- **mgraph** — CUI Data-at-Rest Protection Evidence (Labels + BitLocker): Verifies via `(Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/deviceManagement/managedDevices').value`
- **az** — Enable VM Disk Encryption (CMK via Key Vault): Verifies via `Get-AzVMDiskEncryptionStatus -ResourceGroupName {resourceGroup} -VMName {vmName}`; Configures via `Set-AzVMDiskEncryptionExtension -ResourceGroupName {resourceGroup} -VMName {vmName} -DiskEncryptionKeyVaultUrl {kvUri} -`
