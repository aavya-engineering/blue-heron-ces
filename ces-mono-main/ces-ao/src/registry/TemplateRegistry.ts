// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Module: Template Registry
// PowerShell get_command templates for all AUDIT-trigger commands across domains A–H
// A-09 and A-11 retain existing templates (pilot commands)
// Returns null for non-AUDIT / non-wired commands to preserve stub behavior

interface CommandTemplates {
  set_command: string;
  get_command: string;
}

/**
 * Get PowerShell command templates for a specific command ID.
 * Supports all ~40 AUDIT-trigger commands across domains A–H.
 * Returns null for unmapped (write/config/incident) commands.
 */
export function getCommandTemplates(commandId: string): CommandTemplates | null {
  const templates: Record<string, CommandTemplates> = {

    // ─── Domain A: Identity & Access Management ───────────────────────────────

    /** A-08: MFA Method Audit — enumerate all auth methods per user, flag SMS/voice */
    'A-08': {
      set_command: '',
      get_command: [
        "Get-MgUser -All -Property Id,DisplayName,UserPrincipalName -ErrorAction SilentlyContinue |",
        "ForEach-Object {",
        "  $methods = Get-MgUserAuthenticationMethod -UserId $_.Id -ErrorAction SilentlyContinue;",
        "  [PSCustomObject]@{",
        "    UPN     = $_.UserPrincipalName;",
        "    Methods = ($methods | Select-Object -ExpandProperty AdditionalProperties |",
        "               ForEach-Object { $_['@odata.type'] }) -join ',';",
        "    HasSms  = ($methods.AdditionalProperties.'@odata.type' -contains",
        "               '#microsoft.graph.phoneAuthenticationMethod');",
        "  }",
        "} | Select-Object UPN, Methods, HasSms",
      ].join(' '),
    },

    /** A-09: Privileged Role Review — existing pilot template retained */
    'A-09': {
      set_command: '',
      get_command: "Get-MgRoleManagementDirectoryRoleEligibilitySchedule -All | Where-Object { $_.RoleDefinitionId -in @('{globalAdminRoleDefId}', '{privilegedRoleAdminDefId}', '{securityAdminRoleDefId}') } | Select-Object PrincipalId,RoleDefinitionId,Status,DirectoryScopeId",
    },

    /** A-10: Standing Privilege Elimination — convert a standing GA to PIM-eligible (JIT). REST via Invoke-MgGraphRequest (module-version-proof). */
    'A-10': {
      // W4-AO4: the role definition id is tenant-derived (SourceBindings: tenant key, else the
      // built-in Global Administrator template id) instead of a hardcoded GUID.
      get_command: "Invoke-MgGraphRequest -Method GET -Uri \"/v1.0/roleManagement/directory/roleAssignments?`$filter=roleDefinitionId eq '{globalAdminRoleDefId}'\" -OutputType PSObject | Select-Object -ExpandProperty value",
      set_command: [
        "$ga='{globalAdminRoleDefId}';",
        "$u=Invoke-MgGraphRequest -Method GET -Uri '/v1.0/users/{targetUPN}' -OutputType PSObject;",
        "Invoke-MgGraphRequest -Method POST -Uri '/v1.0/roleManagement/directory/roleEligibilityScheduleRequests' -Body @{ action='adminAssign'; principalId=$u.id; roleDefinitionId=$ga; directoryScopeId='/'; justification='CMMC AC.L2-3.1.5 convert standing GA to eligible'; scheduleInfo=@{ startDateTime=((Get-Date).ToUniversalTime().ToString('o')); expiration=@{ type='noExpiration' } } } | Out-Null;",
        "$flt=[uri]::EscapeDataString(\"principalId eq '$($u.id)' and roleDefinitionId eq '$ga'\");",
        "$act=Invoke-MgGraphRequest -Method GET -Uri \"/v1.0/roleManagement/directory/roleAssignments?`$filter=$flt\" -OutputType PSObject;",
        "foreach ($a in $act.value) { Invoke-MgGraphRequest -Method DELETE -Uri \"/v1.0/roleManagement/directory/roleAssignments/$($a.id)\" | Out-Null }",
      ].join(' '),
    },

    /** A-18: Default User Permission Lockdown — block app/group/tenant creation by default users (AC.L2-3.1.2). REST. */
    'A-18': {
      get_command: "Invoke-MgGraphRequest -Method GET -Uri '/v1.0/policies/authorizationPolicy' -OutputType PSObject | Select-Object -ExpandProperty defaultUserRolePermissions",
      set_command: "Invoke-MgGraphRequest -Method PATCH -Uri '/v1.0/policies/authorizationPolicy' -Body @{ defaultUserRolePermissions=@{ allowedToCreateApps=$false; allowedToCreateSecurityGroups=$false; allowedToCreateTenants=$false } }",
    },

    /** A-19: Break-Glass CA Exclusion — exclude the emergency-access account from a blocking CA policy (AC.L2-3.1.7 resilience). Get-then-set REST; idempotent (skips the PATCH entirely when already excluded). A CA PATCH replaces conditions wholesale, so the full conditions object is round-tripped — but Graph rejects (error 1007) null-valued condition keys AND empty risk-level arrays on write, so both are stripped and the body is sent as a JSON string (live-verified shape). */
    'A-19': {
      get_command: "$pols=(Invoke-MgGraphRequest -Method GET -Uri '/v1.0/identity/conditionalAccess/policies' -OutputType PSObject).value; $pols | Where-Object { $_.displayName -eq '{policyDisplayName}' } | Select-Object displayName, state, @{n='excludeUsers';e={ @($_.conditions.users.excludeUsers) -join ',' }}, @{n='excludeGroups';e={ @($_.conditions.users.excludeGroups) -join ',' }}",
      set_command: [
        "function CleanCond($c){ $risk=@('userRiskLevels','signInRiskLevels','servicePrincipalRiskLevels','insiderRiskLevels'); $o=@{}; foreach($k in @($c.Keys)){ $v=$c[$k]; if($null -eq $v){ continue }; if($risk -contains $k -and @($v).Count -eq 0){ continue }; if($v -is [System.Collections.IDictionary]){ $s=@{}; foreach($sk in @($v.Keys)){ if($null -ne $v[$sk]){ $s[$sk]=$v[$sk] } }; $o[$k]=$s } else { $o[$k]=$v } }; return $o };",
        "$bg=Invoke-MgGraphRequest -Method GET -Uri '/v1.0/users/{breakglassUPN}' -OutputType PSObject;",
        "$pols=(Invoke-MgGraphRequest -Method GET -Uri '/v1.0/identity/conditionalAccess/policies' -OutputType HashTable).value;",
        "$p=$pols | Where-Object { $_.displayName -eq '{policyDisplayName}' } | Select-Object -First 1;",
        "if(-not $p){ throw \"CA policy '{policyDisplayName}' not found\" };",
        "$ex=@(@($p.conditions.users.excludeUsers) | Where-Object { $_ });",
        "if($ex -contains $bg.id){ \"Break-glass {breakglassUPN} already excluded from '{policyDisplayName}' ($($ex.Count) user exclusion(s)) - no change\" }",
        "else { $cond=CleanCond $p.conditions; $cond.users.excludeUsers=@($ex + $bg.id); $body=@{ conditions=$cond } | ConvertTo-Json -Depth 10;",
        "Invoke-MgGraphRequest -Method PATCH -Uri \"/v1.0/identity/conditionalAccess/policies/$($p.id)\" -Body $body -ContentType 'application/json' | Out-Null;",
        "\"Break-glass {breakglassUPN} excluded from '{policyDisplayName}' ($($ex.Count + 1) user exclusion(s) total)\" }",
      ].join(' '),
    },

    /** A-20: Conditional Access Duplicate Policy Cleanup — delete duplicate CA policies sharing one displayName, keeping the oldest. Get-then-set; idempotent (no-op at <=1 match). SAFETY: an ENABLED duplicate is never deleted (reported for manual review) so enforcement cannot change. Throttle-aware (200ms between DELETEs). */
    'A-20': {
      get_command: "$pols=(Invoke-MgGraphRequest -Method GET -Uri '/v1.0/identity/conditionalAccess/policies' -OutputType PSObject).value; $m=@($pols | Where-Object { $_.displayName -eq '{policyDisplayName}' } | Sort-Object createdDateTime); \"$($m.Count) policy(ies) named '{policyDisplayName}': $(@($m | ForEach-Object { \"$($_.id) [$($_.state)]\" }) -join '; ')\"",
      set_command: [
        "$pols=(Invoke-MgGraphRequest -Method GET -Uri '/v1.0/identity/conditionalAccess/policies' -OutputType PSObject).value;",
        "$m=@($pols | Where-Object { $_.displayName -eq '{policyDisplayName}' } | Sort-Object createdDateTime);",
        "if($m.Count -le 1){ \"no duplicates: $($m.Count) policy(ies) named '{policyDisplayName}' - no change\" }",
        "else { $keep=$m[0]; $dupes=@($m | Select-Object -Skip 1);",
        "$deletable=@($dupes | Where-Object { $_.state -ne 'enabled' }); $skipped=@($dupes | Where-Object { $_.state -eq 'enabled' });",
        "foreach($d in $deletable){ Invoke-MgGraphRequest -Method DELETE -Uri \"/v1.0/identity/conditionalAccess/policies/$($d.id)\" | Out-Null; Start-Sleep -Milliseconds 200 };",
        "$note=''; if($skipped.Count){ $note=\"; $($skipped.Count) ENABLED duplicate(s) NOT deleted - manual review required\" };",
        "\"kept oldest $($keep.id) [$($keep.state), created $($keep.createdDateTime)]; deleted $($deletable.Count) duplicate(s) of '{policyDisplayName}'$note\" }",
      ].join(' '),
    },

    /** B-13: Device Compliance Baseline Enforcement — create a Windows compliance policy (CM.L2-3.4.2). REST. */
    'B-13': {
      get_command: "Invoke-MgGraphRequest -Method GET -Uri '/v1.0/deviceManagement/deviceCompliancePolicies' -OutputType PSObject | Select-Object -ExpandProperty value",
      set_command: "Invoke-MgGraphRequest -Method POST -Uri '/v1.0/deviceManagement/deviceCompliancePolicies' -Body @{ '@odata.type'='#microsoft.graph.windows10CompliancePolicy'; displayName='{policyName}'; description='CMMC CM.L2-3.4.2 baseline'; passwordRequired=$true; bitLockerEnabled=$true; secureBootEnabled=$true; osMinimumVersion='10.0.19045.0'; scheduledActionsForRule=@(@{ ruleName='PasswordRequired'; scheduledActionConfigurations=@(@{ actionType='block'; gracePeriodHours=24 }) }) }",
    },

    /** B-14: Autopilot Profile Provisioning — create a Windows Autopilot deployment profile (CM.L2-3.4.1). Beta endpoint via REST. */
    'B-14': {
      get_command: "Invoke-MgGraphRequest -Method GET -Uri '/beta/deviceManagement/windowsAutopilotDeploymentProfiles' -OutputType PSObject | Select-Object -ExpandProperty value",
      set_command: "Invoke-MgGraphRequest -Method POST -Uri '/beta/deviceManagement/windowsAutopilotDeploymentProfiles' -Body @{ '@odata.type'='#microsoft.graph.azureADWindowsAutopilotDeploymentProfile'; displayName='{profileName}'; description='CMMC CM.L2-3.4.1 baseline provisioning'; deviceNameTemplate='CMMC-%SERIAL%'; language='os-default'; outOfBoxExperienceSettings=@{ '@odata.type'='microsoft.graph.outOfBoxExperienceSettings'; hidePrivacySettings=$true; hideEULA=$true; userType='standard'; deviceUsageType='singleUser'; skipKeyboardSelectionPage=$true; hideEscapeLink=$true } }",
    },

    /**
     * A-11: Stale Account Detection — READ-ONLY in this AUDIT slice.
     * The destructive set_command (bulk Update-MgUser -AccountEnabled:$false) is
     * intentionally removed: state-changing remediation is deferred Tier-2 work and
     * must not live in the evidence-only slice. Restore it only alongside the
     * get-then-set idempotency diff + ManualGate workflow (see PLAN.md Deferred).
     */
    'A-11': {
      set_command: '',
      get_command: "Get-MgUser -Filter 'accountEnabled eq true' -All -Property DisplayName,UserPrincipalName,SignInActivity -ErrorAction SilentlyContinue | Select-Object DisplayName,UserPrincipalName,SignInActivity",
    },

    /** A-12: Guest / External User Audit — inventory B2B guest accounts */
    'A-12': {
      set_command: '',
      get_command: [
        "Get-MgUser -Filter \"userType eq 'Guest'\" -All",
        "-Property DisplayName,UserPrincipalName,SignInActivity,CreatedDateTime,ExternalUserState",
        "| Select-Object DisplayName,UserPrincipalName,CreatedDateTime,ExternalUserState,SignInActivity",
      ].join(' '),
    },

    /** A-13: CA Policy Review — export all Conditional Access policies */
    'A-13': {
      set_command: '',
      get_command: [
        "Get-MgIdentityConditionalAccessPolicy -All",
        "| Select-Object Id,DisplayName,State,Conditions,GrantControls,SessionControls",
        "| ConvertTo-Json -Depth 10",
      ].join(' '),
    },

    // ─── Domain A: Identity & Access Management — WRITE commands ──────────────

    /** A-01: New User Provisioning — create account, assign license, add to base groups */
    'A-01': {
      get_command: [
        "Get-MgUser -Filter \"userPrincipalName eq '{upn}'\" -ErrorAction SilentlyContinue",
        "-Property DisplayName,UserPrincipalName,AccountEnabled,AssignedLicenses",
        "| Select-Object DisplayName,UserPrincipalName,AccountEnabled,AssignedLicenses",
      ].join(' '),
      set_command: [
        "$passwordProfile = @{ Password = (New-Guid).ToString() + 'A1!'; ForceChangePasswordNextSignIn = $true };",
        "$newUser = New-MgUser -DisplayName '{displayName}' -UserPrincipalName '{upn}'",
        "  -MailNickname ('{upn}'.Split('@')[0]) -AccountEnabled:$true",
        "  -PasswordProfile $passwordProfile -UsageLocation 'US';",
        "Set-MgUserLicense -UserId $newUser.Id",
        "  -AddLicenses @(@{ SkuId = '{m365LicenseSkuId}' }) -RemoveLicenses @();",
        "New-MgGroupMember -GroupId '{baseGroupId}' -DirectoryObjectId $newUser.Id",
      ].join(' '),
    },

    /** A-02: User Offboarding–Disable — disable account, revoke sessions, convert mailbox */
    'A-02': {
      get_command: [
        "Get-MgUser -Filter \"userPrincipalName eq '{upn}'\"",
        "-Property DisplayName,UserPrincipalName,AccountEnabled,AssignedLicenses",
        "| Select-Object DisplayName,UserPrincipalName,AccountEnabled,AssignedLicenses",
      ].join(' '),
      set_command: [
        "Update-MgUser -UserId '{upn}' -AccountEnabled:$false;",
        "Revoke-MgUserSignInSession -UserId '{upn}';",
        "Set-Mailbox -Identity '{upn}' -Type Shared -ErrorAction SilentlyContinue;",
        "Set-Mailbox -Identity '{upn}' -LitigationHoldEnabled:$true -ErrorAction SilentlyContinue",
      ].join(' '),
    },

    /** A-04: Role Change/Transfer — audit memberships, reassign PIM roles */
    'A-04': {
      get_command: [
        "Get-MgUserMemberOf -UserId '{targetUPN}' -All",
        "| Select-Object -ExpandProperty AdditionalProperties",
        "| Select-Object displayName,id;",
        "Get-MgRoleManagementDirectoryRoleEligibilitySchedule -All",
        "| Where-Object { $_.PrincipalId -eq (Get-MgUser -UserId '{targetUPN}').Id }",
        "| Select-Object RoleDefinitionId,Status,DirectoryScopeId",
      ].join(' '),
      set_command: [
        "$userId = (Get-MgUser -UserId '{targetUPN}').Id;",
        "Remove-MgGroupMemberByRef -GroupId '{oldGroupId}' -DirectoryObjectId $userId",
        "  -ErrorAction SilentlyContinue;",
        "New-MgGroupMember -GroupId '{newGroupId}' -DirectoryObjectId $userId;",
        "Update-MgUser -UserId $userId -Department '{newDepartment}'",
      ].join(' '),
    },

    /** A-05: LOA–Suspend — disable account without license removal, add to LOA group */
    'A-05': {
      get_command: [
        "Get-MgUser -Filter \"userPrincipalName eq '{targetUPN}'\"",
        "-Property DisplayName,UserPrincipalName,AccountEnabled,Department,AssignedLicenses",
        "| Select-Object DisplayName,UserPrincipalName,AccountEnabled,Department,AssignedLicenses",
      ].join(' '),
      set_command: [
        "Update-MgUser -UserId '{targetUPN}' -AccountEnabled:$false;",
        "Revoke-MgUserSignInSession -UserId '{targetUPN}';",
        "$userId = (Get-MgUser -UserId '{targetUPN}').Id;",
        "New-MgGroupMember -GroupId '{loaGroupId}' -DirectoryObjectId $userId",
      ].join(' '),
    },

    /** A-06: LOA Return–Restore — re-enable account, restore roles, force MFA re-registration */
    'A-06': {
      get_command: [
        "Get-MgUser -Filter \"userPrincipalName eq '{targetUPN}'\"",
        "-Property DisplayName,UserPrincipalName,AccountEnabled,Department,AssignedLicenses",
        "| Select-Object DisplayName,UserPrincipalName,AccountEnabled,Department,AssignedLicenses",
      ].join(' '),
      set_command: [
        "Update-MgUser -UserId '{targetUPN}' -AccountEnabled:$true;",
        "$userId = (Get-MgUser -UserId '{targetUPN}').Id;",
        "Remove-MgGroupMemberByRef -GroupId '{loaGroupId}' -DirectoryObjectId $userId",
        "  -ErrorAction SilentlyContinue;",
        "Invoke-MgInvalidateAllUserRefreshToken -UserId '{targetUPN}'",
      ].join(' '),
    },

    /** A-07: MFA Enrollment Enforcement — require phishing-resistant MFA via auth methods policy */
    'A-07': {
      // FC-AO-2 (tenant-stacksim REQ-ces-ao-paired-reads, A-07): the set enables the Microsoft
      // Authenticator method configuration and enforces per-user MFA; it adds no auth METHODS, so the
      // old methods read could never observe it. The paired read now reads the Authenticator
      // configuration state the set changes (Graph v1.0). The per-user requirement lives on the beta
      // endpoint /users/{id}/authentication/requirements, which the sim does not serve yet
      // (docs/requirements/REQ-tenant-stacksim-ao-paired-read-endpoints.md).
      get_command: [
        "Invoke-MgGraphRequest -Method GET",
        "-Uri '/v1.0/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/MicrosoftAuthenticator'",
        "-OutputType PSObject | Select-Object id,state",
      ].join(' '),
      set_command: [
        "Update-MgPolicyAuthenticationMethodPolicyAuthenticationMethodConfiguration",
        "  -AuthenticationMethodConfigurationId 'MicrosoftAuthenticator'",
        "  -State 'enabled' -ErrorAction SilentlyContinue;",
        "Set-MgUserAuthenticationMethodRequirement -UserId '{upn}'",
        "  -PerUserMfaState Enforced -ErrorAction SilentlyContinue",
      ].join(' '),
    },

    /** A-14: Named Location Update — update trusted IP ranges for Conditional Access */
    'A-14': {
      get_command: [
        "Get-MgIdentityConditionalAccessNamedLocation -NamedLocationId '{namedLocationId}'",
        "| Select-Object Id,DisplayName,IsTrusted,",
        "  @{N='IpRanges';E={($_.AdditionalProperties.ipRanges | ConvertTo-Json -Compress)}}",
      ].join(' '),
      set_command: [
        "$ipRanges = @( @{'@odata.type'='#microsoft.graph.iPv4CidrRange';cidrAddress='{trustedCidr}'} );",
        "Update-MgIdentityConditionalAccessNamedLocation -NamedLocationId '{namedLocationId}'",
        "  -IsTrusted:$true",
        "  -AdditionalProperties @{ ipRanges = $ipRanges }",
      ].join(' '),
    },

    /** A-16: Suspicious Sign-In Response — confirm risky user, revoke sessions */
    'A-16': {
      get_command: [
        "Get-MgRiskyUser -Filter \"userPrincipalName eq '{targetUPN}'\"",
        "| Select-Object Id,UserPrincipalName,RiskLevel,RiskState,RiskLastUpdatedDateTime;",
        "Get-MgAuditLogSignIn -Filter \"userPrincipalName eq '{targetUPN}'\"",
        "-Top 10 | Select-Object CreatedDateTime,RiskLevelDuringSignIn,IpAddress,Location",
      ].join(' '),
      set_command: [
        "Revoke-MgUserSignInSession -UserId '{targetUPN}';",
        "Update-MgUser -UserId '{targetUPN}' -AccountEnabled:$false;",
        "Confirm-MgRiskyUser -UserIds @((Get-MgUser -UserId '{targetUPN}').Id)",
      ].join(' '),
    },

    /** A-17: Admin Account Separation — create cloud-only admin account with no mailbox */
    'A-17': {
      get_command: [
        "Get-MgUser -Filter \"userPrincipalName eq '{adminUPN}'\" -ErrorAction SilentlyContinue",
        "-Property DisplayName,UserPrincipalName,AccountEnabled,OnPremisesSyncEnabled",
        "| Select-Object DisplayName,UserPrincipalName,AccountEnabled,OnPremisesSyncEnabled",
      ].join(' '),
      set_command: [
        "$passwordProfile = @{ Password = (New-Guid).ToString() + 'Aa1!'; ForceChangePasswordNextSignIn = $true };",
        "$adminUser = New-MgUser -DisplayName '{adminDisplayName}' -UserPrincipalName '{adminUPN}'",
        "  -MailNickname ('{adminUPN}'.Split('@')[0]) -AccountEnabled:$true",
        "  -PasswordProfile $passwordProfile -UsageLocation 'US';",
        "New-MgGroupMember -GroupId '{adminGroupId}' -DirectoryObjectId $adminUser.Id",
      ].join(' '),
    },

    // ─── Domain A: Identity & Access Management — TIER 3 commands ─────────────

    /** A-03: User Offboarding–Hard Delete — permanently remove user (Tier 3 gated) */
    'A-03': {
      get_command: [
        "Get-MgUser -Filter \"userPrincipalName eq '{targetUPN}'\"",
        "-Property Id,DisplayName,UserPrincipalName,AccountEnabled,AssignedLicenses,CreatedDateTime",
        "| Select-Object Id,DisplayName,UserPrincipalName,AccountEnabled,AssignedLicenses,CreatedDateTime",
      ].join(' '),
      set_command: [
        "Remove-MgUser -UserId '{targetUPN}' -ErrorAction Stop",
      ].join(' '),
    },

    /** A-15: Break-Glass Validation — verify break-glass account sign-in and CA exclusions */
    'A-15': {
      set_command: '',
      get_command: [
        "$bg = Get-MgUser -Filter \"userPrincipalName eq '{breakGlassUPN}'\"",
        "-Property DisplayName,UserPrincipalName,SignInActivity,AccountEnabled;",
        "$caPolicies = Get-MgIdentityConditionalAccessPolicy -All",
        "| Where-Object { $_.Conditions.Users.ExcludeUsers -contains $bg.Id };",
        "[PSCustomObject]@{",
        "  BreakGlassUPN       = $bg.UserPrincipalName;",
        "  AccountEnabled      = $bg.AccountEnabled;",
        "  LastSignIn          = $bg.SignInActivity.LastSignInDateTime;",
        "  ExcludedFromPolicies= ($caPolicies | Measure-Object).Count;",
        "} | ConvertTo-Json",
      ].join(' '),
    },

    // ─── Domain B: Device & Endpoint Management ────────────────────────────────

    /** B-02: Compliance Policy Gap Report — device inventory by compliance status */
    'B-02': {
      set_command: '',
      get_command: [
        "Get-MgDeviceManagementManagedDevice -All",
        "-Property DeviceName,OperatingSystem,ComplianceState,LastSyncDateTime,UserPrincipalName",
        "| Select-Object DeviceName,OperatingSystem,ComplianceState,LastSyncDateTime,UserPrincipalName",
        "| Sort-Object ComplianceState",
      ].join(' '),
    },

    /** B-03: OS Patch Currency Audit — OS version inventory */
    'B-03': {
      set_command: '',
      get_command: [
        "Get-MgDeviceManagementManagedDevice -All",
        "-Property DeviceName,OperatingSystem,OsVersion,LastSyncDateTime,ComplianceState",
        "| Select-Object DeviceName,OperatingSystem,OsVersion,LastSyncDateTime,ComplianceState",
        "| Sort-Object OsVersion",
      ].join(' '),
    },

    /** B-04: Security Baseline Drift — device compliance policy statuses */
    'B-04': {
      set_command: '',
      get_command: [
        "Get-MgDeviceManagementDeviceCompliancePolicy -All",
        "| ForEach-Object {",
        "  $pol = $_;",
        "  Get-MgDeviceManagementDeviceCompliancePolicyDeviceStatus -DeviceCompliancePolicyId $pol.Id -All",
        "  | Select-Object @{N='PolicyName';E={$pol.DisplayName}},DeviceDisplayName,Status,LastReportedDateTime",
        "} | Sort-Object Status",
      ].join(' '),
    },

    /** B-10: Hardware Inventory Reconciliation — full Intune device inventory */
    'B-10': {
      set_command: '',
      get_command: [
        "Get-MgDeviceManagementManagedDevice -All",
        "-Property Id,DeviceName,SerialNumber,Manufacturer,Model,OperatingSystem,EnrolledDateTime,UserPrincipalName",
        "| Select-Object Id,DeviceName,SerialNumber,Manufacturer,Model,OperatingSystem,EnrolledDateTime,UserPrincipalName",
        "| Sort-Object EnrolledDateTime",
      ].join(' '),
    },

    /** B-11: EDR Coverage Gap Detection — Intune vs Defender for Endpoint inventory */
    'B-11': {
      set_command: '',
      get_command: [
        "Get-MgDeviceManagementManagedDevice -All",
        "-Property DeviceName,AzureAdDeviceId,OperatingSystem,ManagedDeviceOwnerType",
        "-Filter \"operatingSystem eq 'Windows'\"",
        "| Select-Object DeviceName,AzureAdDeviceId,OperatingSystem,ManagedDeviceOwnerType",
      ].join(' '),
    },

    /** B-12: Autopilot Profile Review — audit Autopilot deployment profiles */
    'B-12': {
      set_command: '',
      get_command: [
        "Get-MgDeviceManagementWindowsAutopilotDeploymentProfile -All",
        "| Select-Object Id,DisplayName,Description,OutOfBoxExperienceSettings,CreatedDateTime",
        "| ConvertTo-Json -Depth 5",
      ].join(' '),
    },

    // ─── Domain B: Device & Endpoint Management — WRITE commands ──────────────

    /** B-01: New Device Enrollment — assign Autopilot profile and compliance policy */
    'B-01': {
      get_command: [
        "Get-MgDeviceManagementManagedDevice -Filter \"deviceName eq '{deviceName}'\"",
        "-Property Id,DeviceName,ComplianceState,EnrolledDateTime,UserPrincipalName",
        "| Select-Object Id,DeviceName,ComplianceState,EnrolledDateTime,UserPrincipalName",
      ].join(' '),
      set_command: [
        "$device = Get-MgDeviceManagementManagedDevice",
        "  -Filter \"serialNumber eq '{deviceSerialNumber}'\" | Select-Object -First 1;",
        "Set-MgDeviceManagementManagedDeviceName -ManagedDeviceId $device.Id",
        "  -ManagedDeviceName '{deviceName}' -ErrorAction SilentlyContinue;",
        "Invoke-MgDeviceManagementManagedDeviceSyncDevice -ManagedDeviceId $device.Id",
      ].join(' '),
    },

    /** B-05: Terminated-User Device Wipe — full wipe corporate, selective wipe BYOD */
    'B-05': {
      // FC-AO-2 (REQ-ces-ao-paired-reads, B-05): wipe/retire are QUEUED — Intune keeps the device
      // record until check-in and records the pending action in managementState. Project it, or the
      // paired read can never observe the write.
      get_command: [
        "Get-MgDeviceManagementManagedDevice -Filter \"userPrincipalName eq '{targetUPN}'\" -All",
        "-Property Id,DeviceName,OperatingSystem,ManagedDeviceOwnerType,ComplianceState,ManagementState",
        "| Select-Object Id,DeviceName,OperatingSystem,ManagedDeviceOwnerType,ComplianceState,ManagementState",
      ].join(' '),
      set_command: [
        "$devices = Get-MgDeviceManagementManagedDevice",
        "  -Filter \"userPrincipalName eq '{targetUPN}'\" -All;",
        "$devices | ForEach-Object {",
        "  if ($_.ManagedDeviceOwnerType -eq 'company')",
        "    { Clear-MgDeviceManagementManagedDevice -ManagedDeviceId $_.Id }",
        "  else",
        "    { Invoke-MgDeviceManagementManagedDeviceRetireDevice -ManagedDeviceId $_.Id }",
        "}",
      ].join(' '),
    },

    /** B-06: Lost/Stolen Device Wipe — immediate full wipe and lost mode */
    'B-06': {
      get_command: [
        "Get-MgDeviceManagementManagedDevice -ManagedDeviceId '{deviceId}'",
        "-Property Id,DeviceName,OperatingSystem,ComplianceState,UserPrincipalName,LostModeState",
        "| Select-Object Id,DeviceName,OperatingSystem,ComplianceState,UserPrincipalName,LostModeState",
      ].join(' '),
      set_command: [
        "Enable-MgDeviceManagementManagedDeviceLostMode -ManagedDeviceId '{deviceId}'",
        "  -Message 'Device reported lost/stolen. Contact IT immediately.'",
        "  -PhoneNumber '{itHelpDeskPhone}' -ErrorAction SilentlyContinue;",
        "Clear-MgDeviceManagementManagedDevice -ManagedDeviceId '{deviceId}'",
        "  -KeepEnrollmentData:$false",
      ].join(' '),
    },

    /** B-07: Non-Compliant Device CA Block — enable require-compliant-device CA policy */
    'B-07': {
      get_command: [
        "Get-MgIdentityConditionalAccessPolicy -All",
        "| Where-Object { $_.DisplayName -like '*Compliant Device*' -or $_.DisplayName -like '*Device Compliance*' }",
        "| Select-Object Id,DisplayName,State,Conditions,GrantControls",
      ].join(' '),
      set_command: [
        "Update-MgIdentityConditionalAccessPolicy -ConditionalAccessPolicyId '{caPolicyId}'",
        "  -State 'enabled'",
      ].join(' '),
    },

    /** B-08: CUI App Allowlist/Blocklist — update Intune App Protection Policy allowed apps */
    'B-08': {
      // FC-AO-2 (REQ-ces-ao-paired-reads, B-08): the set adds an app to the Android policy's apps;
      // the old read (policy headers) could not see it. Read the policy's apps (Graph:
      // androidManagedAppProtections/{id}/apps). The sim does not serve this read yet
      // (docs/requirements/REQ-tenant-stacksim-ao-paired-read-endpoints.md).
      get_command: [
        "Get-MgDeviceAppManagementAndroidManagedAppProtectionApp",
        "-AndroidManagedAppProtectionId '{appProtectionPolicyId}' -All",
        "| Select-Object Id,MobileAppIdentifier",
      ].join(' '),
      set_command: [
        "$appRef = @{ '@odata.type' = '#microsoft.graph.managedMobileApp'; mobileAppIdentifier = @{",
        "  '@odata.type' = '#microsoft.graph.androidMobileAppIdentifier';",
        "  packageId = '{appPackageId}' } };",
        "New-MgDeviceAppManagementAndroidManagedAppProtectionApp",
        "  -AndroidManagedAppProtectionId '{appProtectionPolicyId}'",
        "  -BodyParameter $appRef",
      ].join(' '),
    },

    /** B-09: BYOD Separation (MAM) — configure MAM policy with data transfer restrictions */
    'B-09': {
      get_command: [
        "Get-MgDeviceAppManagementAndroidManagedAppProtection -All",
        "| Select-Object Id,DisplayName,DataBackupBlocked,DeviceComplianceRequired,",
        "  AllowedDataStorageLocations | ConvertTo-Json -Depth 3",
      ].join(' '),
      set_command: [
        "Update-MgDeviceAppManagementAndroidManagedAppProtection",
        "  -AndroidManagedAppProtectionId '{appProtectionPolicyId}'",
        "  -DataBackupBlocked:$true -SendOrgDataToOtherApps 'none'",
        "  -ReceiveDataFromOtherApps 'none' -SaveAsBlocked:$true;",
        "Update-MgDeviceAppManagementIosManagedAppProtection",
        "  -IosManagedAppProtectionId '{iosAppProtectionPolicyId}'",
        "  -DataBackupBlocked:$true -SendOrgDataToOtherApps 'none'",
        "  -ReceiveDataFromOtherApps 'none' -SaveAsBlocked:$true",
      ].join(' '),
    },

    // ─── Domain C: Credential & Key Lifecycle ──────────────────────────────────

    /** C-01: App Secret/Cert Expiry Alert — scan app registrations for expiring credentials */
    'C-01': {
      set_command: '',
      get_command: [
        "$threshold = (Get-Date).AddDays(30);",
        "Get-MgApplication -All -Property DisplayName,AppId,PasswordCredentials,KeyCredentials",
        "| ForEach-Object {",
        "  $app = $_;",
        "  $app.PasswordCredentials | Where-Object { $_.EndDateTime -lt $threshold }",
        "  | Select-Object @{N='AppName';E={$app.DisplayName}},",
        "    @{N='AppId';E={$app.AppId}},",
        "    @{N='CredType';E={'Secret'}},",
        "    DisplayName,StartDateTime,EndDateTime;",
        "  $app.KeyCredentials | Where-Object { $_.EndDateTime -lt $threshold }",
        "  | Select-Object @{N='AppName';E={$app.DisplayName}},",
        "    @{N='AppId';E={$app.AppId}},",
        "    @{N='CredType';E={'Certificate'}},",
        "    DisplayName,StartDateTime,EndDateTime",
        "} | Sort-Object EndDateTime",
      ].join(' '),
    },

    /** C-04: Key Vault RBAC Audit — enumerate RBAC role assignments on Key Vaults */
    'C-04': {
      set_command: '',
      get_command: [
        "Get-MgRoleManagementDirectoryRoleAssignment -All",
        "-Property PrincipalId,RoleDefinitionId,DirectoryScopeId",
        "| Where-Object { $_.DirectoryScopeId -like '*/providers/Microsoft.KeyVault/*' }",
        "| Select-Object PrincipalId,RoleDefinitionId,DirectoryScopeId",
        "| ConvertTo-Json",
      ].join(' '),
    },

    /** C-05: TLS/SSL Certificate Expiry — scan Key Vault for expiring certs */
    'C-05': {
      set_command: '',
      get_command: [
        "$vault = '{keyVaultName}';",
        "$threshold = (Get-Date).AddDays(30);",
        "az keyvault certificate list --vault-name $vault --query",
        "\"[].{name:name, expires:attributes.expires, enabled:attributes.enabled}\"",
        "--output json 2>&1",
      ].join(' '),
    },

    /** C-07: Managed Identity Adoption — inventory service principals (managed vs app) */
    'C-07': {
      set_command: '',
      get_command: [
        "Get-MgServicePrincipal -All",
        "-Property DisplayName,ServicePrincipalType,AppId,SignInAudience",
        "| Group-Object ServicePrincipalType",
        "| Select-Object Name,Count",
      ].join(' '),
    },

    /** C-08: Orphaned App/SPN Cleanup — apps with no owner, expired creds, or no sign-in */
    'C-08': {
      set_command: '',
      get_command: [
        "Get-MgApplication -All -Property DisplayName,AppId,SignInAudience,PasswordCredentials,KeyCredentials",
        "| ForEach-Object {",
        "  $owners = (Get-MgApplicationOwner -ApplicationId $_.Id -ErrorAction SilentlyContinue | Measure-Object).Count;",
        "  $expiredCreds = (($_.PasswordCredentials + $_.KeyCredentials)",
        "    | Where-Object { $_.EndDateTime -lt (Get-Date) } | Measure-Object).Count;",
        "  [PSCustomObject]@{",
        "    AppName      = $_.DisplayName;",
        "    AppId        = $_.AppId;",
        "    OwnerCount   = $owners;",
        "    ExpiredCreds = $expiredCreds;",
        "  }",
        "} | Where-Object { $_.OwnerCount -eq 0 -or $_.ExpiredCreds -gt 0 }",
      ].join(' '),
    },

    // ─── Domain C: Credential & Key Lifecycle — WRITE commands ────────────────

    /** C-02: App Secret Rotation — remove expired secret, add new secret on app registration */
    'C-02': {
      get_command: [
        "Get-MgApplication -Filter \"appId eq '{appId}'\"",
        "-Property DisplayName,AppId,PasswordCredentials,KeyCredentials",
        "| Select-Object DisplayName,AppId,PasswordCredentials",
      ].join(' '),
      set_command: [
        "$app = Get-MgApplication -Filter \"appId eq '{appId}'\";",
        "$expiredSecretId = ($app.PasswordCredentials",
        "  | Where-Object { $_.EndDateTime -lt (Get-Date) }",
        "  | Select-Object -First 1).KeyId;",
        "if ($expiredSecretId) {",
        "  Remove-MgApplicationPassword -ApplicationId $app.Id -KeyId $expiredSecretId",
        "};",
        "$newSecret = Add-MgApplicationPassword -ApplicationId $app.Id",
        "  -PasswordCredential @{",
        "    DisplayName = 'Rotated-{rotationReason}';",
        "    EndDateTime = (Get-Date).AddDays('{secretValidityDays}') };",
        "Write-Output \"New secret ID: $($newSecret.KeyId) Expires: $($newSecret.EndDateTime)\"",
      ].join(' '),
    },

    /** C-03: Key Vault Key Rotation — rotate HSM-backed key in Key Vault */
    'C-03': {
      get_command: [
        "az keyvault key show --vault-name '{keyVaultName}' --name '{keyName}'",
        "--query '{id:key.kid, enabled:attributes.enabled, expires:attributes.expires,",
        "  created:attributes.created}' --output json 2>&1",
      ].join(' '),
      set_command: [
        "az keyvault key rotate --vault-name '{keyVaultName}' --name '{keyName}'",
        "--output json 2>&1",
      ].join(' '),
    },

    /** C-06: Service Account Password Rotation — reset service account password */
    'C-06': {
      get_command: [
        "Get-MgUser -Filter \"userPrincipalName eq '{serviceAccountUPN}'\"",
        "-Property DisplayName,UserPrincipalName,AccountEnabled,LastPasswordChangeDateTime",
        "| Select-Object DisplayName,UserPrincipalName,AccountEnabled,LastPasswordChangeDateTime",
      ].join(' '),
      set_command: [
        // W4-AO4: System.Web is not loaded by default in Windows PowerShell 5.1
        // ("Unable to find type [System.Web.Security.Membership]") — load it first.
        "Add-Type -AssemblyName System.Web;",
        "$newPassword = [System.Web.Security.Membership]::GeneratePassword(24, 6);",
        "Update-MgUser -UserId '{serviceAccountUPN}'",
        "  -PasswordProfile @{ Password = $newPassword; ForceChangePasswordNextSignIn = $false };",
        "Write-Output \"Password rotated for '{serviceAccountUPN}' at $(Get-Date -Format u)\"",
      ].join(' '),
    },

    /** C-09: Password Policy Compliance — update custom banned password list and Smart Lockout */
    'C-09': {
      // FC-AO-2 (REQ-ces-ao-paired-reads, C-09): the set changes the 'Password Rule Settings'
      // directory setting values (BannedPasswordList, LockoutThreshold); read exactly those values.
      get_command: [
        "Get-MgDirectorySetting | Where-Object { $_.DisplayName -eq 'Password Rule Settings' }",
        "| Select-Object -ExpandProperty Values",
        "| Where-Object { $_.Name -in @('BannedPasswordList','LockoutThreshold') }",
        "| Select-Object Name,Value",
      ].join(' '),
      set_command: [
        "Update-MgDirectorySettingTemplate -ErrorAction SilentlyContinue;",
        "$settings = Get-MgDirectorySetting | Where-Object { $_.DisplayName -eq 'Password Rule Settings' };",
        "if ($settings) {",
        "  $settings.Values | Where-Object { $_.Name -eq 'BannedPasswordList' } |",
        "    ForEach-Object { $_.Value = '{bannedPasswordList}' };",
        "  $settings.Values | Where-Object { $_.Name -eq 'LockoutThreshold' } |",
        "    ForEach-Object { $_.Value = '{lockoutThreshold}' };",
        "  Update-MgDirectorySetting -DirectorySettingId $settings.Id -Values $settings.Values",
        "}",
      ].join(' '),
    },

    /** C-10: Leaked Credential Response — remediate risky user, force password reset */
    'C-10': {
      get_command: [
        "Get-MgRiskyUser -Filter \"userPrincipalName eq '{targetUPN}'\"",
        "| Select-Object Id,UserPrincipalName,RiskLevel,RiskState,RiskDetail,RiskLastUpdatedDateTime",
      ].join(' '),
      set_command: [
        "Revoke-MgUserSignInSession -UserId '{targetUPN}';",
        "Update-MgUser -UserId '{targetUPN}'",
        "  -PasswordProfile @{ Password = (New-Guid).ToString() + 'Aa1!';",
        "    ForceChangePasswordNextSignIn = $true };",
        "Confirm-MgRiskyUser -UserIds @((Get-MgUser -UserId '{targetUPN}').Id)",
      ].join(' '),
    },

    // ─── Domain D: Data Protection & CUI Boundary ──────────────────────────────

    /** D-01: Sensitivity Label Coverage — audit label usage via content search */
    'D-01': {
      set_command: '',
      get_command: [
        "Search-UnifiedAuditLog -StartDate (Get-Date).AddDays(-30) -EndDate (Get-Date)",
        "-RecordType SharePointFileOperation",
        "-Operations FileSensitivityLabelApplied,FileSensitivityLabelChanged,FileSensitivityLabelRemoved",
        "-ResultSize 5000",
        "| Select-Object CreationDate,UserIds,Operations,AuditData",
      ].join(' '),
    },

    /** D-02: DLP Policy Effectiveness — review DLP policy matches */
    'D-02': {
      set_command: '',
      // FC-AO-2 (tenant-stacksim REQ-ces-ao-matrix-inputs, D-02): each statement emits its own
      // output. Before, the IPPS connection object (Organization / ConnectionUri) was the first
      // object in the pipeline, fixed the table columns, and the DLP policies / audit rows
      // rendered under those columns as blanks — the data was returned but never captured.
      get_command: [
        "Get-DlpCompliancePolicy -All",
        "| Select-Object Name,Mode,Enabled,Priority,Workload",
        "| ConvertTo-Json -Depth 4 -Compress",
        ";",
        "Search-UnifiedAuditLog -StartDate (Get-Date).AddDays(-30) -EndDate (Get-Date)",
        "-RecordType ComplianceDLPExchange,ComplianceDLPSharePoint",
        "-ResultSize 5000",
        "| Select-Object CreationDate,UserIds,Operations,AuditData",
        "| ConvertTo-Json -Depth 4 -Compress",
      ].join(' '),
    },

    /** D-04: External Sharing Audit — SharePoint external sharing events */
    'D-04': {
      set_command: '',
      get_command: [
        "Search-UnifiedAuditLog -StartDate (Get-Date).AddDays(-30) -EndDate (Get-Date)",
        "-RecordType SharePointSharingOperation",
        "-Operations SharingInvitationCreated,AnonymousLinkCreated,AddedToSecureLink",
        "-ResultSize 5000",
        "| Select-Object CreationDate,UserIds,Operations,AuditData",
        ";",
        "Get-SPOTenant | Select-Object SharingCapability,DefaultSharingLinkType,ExternalServicesEnabled",
      ].join(' '),
    },

    /** D-05: CUI Site Membership Recertification — CUI site group membership */
    'D-05': {
      set_command: '',
      get_command: [
        "Get-SPOSite -Identity '{cuiSiteId}' | Select-Object Url,Title,SharingCapability,LockState;",
        "Get-SPOUser -Site '{cuiSiteId}' -Limit All",
        "| Select-Object LoginName,DisplayName,Groups,IsHiddenInUI",
      ].join(' '),
    },

    /** D-07: Retention Policy & Legal Hold — audit compliance retention policies */
    'D-07': {
      set_command: '',
      get_command: [
        "Get-RetentionCompliancePolicy -All",
        "| Select-Object Name,Mode,Enabled,WorkloadFormat,RetentionDuration;",
        "Get-HoldCompliancePolicy -All",
        "| Select-Object Name,Mode,Enabled,Workload",
      ].join(' '),
    },

    /** D-08: Public Teams Detection — enumerate public Teams */
    'D-08': {
      set_command: '',
      get_command: [
        "Get-MgGroup -Filter \"groupTypes/any(c:c eq 'Unified')\" -All",
        "-Property DisplayName,Visibility,MailNickname,CreatedDateTime",
        "| Where-Object { $_.Visibility -eq 'Public' }",
        "| Select-Object DisplayName,Visibility,MailNickname,CreatedDateTime",
      ].join(' '),
    },

    /** D-10: Oversharing Risk Report — broad sharing analysis */
    'D-10': {
      set_command: '',
      get_command: [
        "Search-UnifiedAuditLog -StartDate (Get-Date).AddDays(-30) -EndDate (Get-Date)",
        "-RecordType SharePointSharingOperation",
        "-ResultSize 5000",
        "| Select-Object CreationDate,UserIds,Operations,AuditData",
        "| Group-Object Operations",
        "| Select-Object Name,Count",
        "| Sort-Object Count -Descending",
      ].join(' '),
    },

    // ─── Domain D: Data Protection & CUI Boundary — WRITE commands ────────────

    /** D-06: Email Encryption & Transport Rules — create OME transport rule for CUI email */
    'D-06': {
      get_command: [
        "Get-TransportRule | Where-Object { $_.Name -like '*CUI*' -or $_.Name -like '*Encrypt*' }",
        "| Select-Object Name,State,Priority,Description;",
        "Get-OMEConfiguration | Select-Object Identity,OTPEnabled,SocialIdSignIn",
      ].join(' '),
      set_command: [
        "New-TransportRule -Name '{transportRuleName}'",
        "  -SubjectContainsWords 'CUI','CONTROLLED UNCLASSIFIED'",
        "  -ApplyRightsProtectionTemplate '{omeTemplateName}'",
        "  -Enabled:$true -Priority 0",
      ].join(' '),
    },

    /** D-11: CUI Label Protection Enablement — enable encryption + auto content-marking on the CUI
     *  sensitivity label (Security & Compliance PS / Set-Label). Remediates FINDING F-LABEL so
     *  MP-3.8.2 (label access) + MP-3.8.4 (markings) are directly enforced. Get-then-set, idempotent. */
    'D-11': {
      get_command: "Get-Label | Where-Object { $_.DisplayName -eq '{labelDisplayName}' } | Select-Object DisplayName, Guid, Priority, ContentType, @{n='EncryptionEnabled';e={$_.EncryptionEnabled}}, @{n='ContentMarking';e={ [bool]($_.ApplyContentMarkingHeaderEnabled -or $_.ApplyContentMarkingFooterEnabled -or $_.ApplyWaterMarkingEnabled) }}",
      set_command: [
        "$l = Get-Label | Where-Object { $_.DisplayName -eq '{labelDisplayName}' } | Select-Object -First 1;",
        "if (-not $l) { throw \"CUI label '{labelDisplayName}' not found\" };",
        "Set-Label -Identity $l.Guid",
        "  -EncryptionEnabled $true -EncryptionProtectionType 'Template'",
        "  -EncryptionRightsDefinitions '{cuiGroupEmail}:VIEW,VIEWRIGHTSDATA,DOCEDIT,EDIT,PRINT,EXTRACT,REPLY,REPLYALL,FORWARD,OBJMODEL'",
        "  -EncryptionContentExpiredOnDateInDaysOrNever 'Never' -EncryptionOfflineAccessDays 30",
        "  -ApplyContentMarkingHeaderEnabled $true -ApplyContentMarkingHeaderText 'CUI' -ApplyContentMarkingHeaderAlignment 'Center' -ApplyContentMarkingHeaderFontColor '#D40000'",
        "  -ApplyContentMarkingFooterEnabled $true -ApplyContentMarkingFooterText 'CUI//SP-CTI' -ApplyContentMarkingFooterAlignment 'Center' -ApplyContentMarkingFooterFontColor '#D40000'",
        "  -ApplyWaterMarkingEnabled $true -ApplyWaterMarkingText 'CUI' | Out-Null;",
        "\"CUI label '{labelDisplayName}' protection enabled: encryption (rights to {cuiGroupEmail}) + header/footer/watermark markings\"",
      ].join(' '),
    },

    /** D-09: CUI Repository Onboarding — create CUI SharePoint site with restricted sharing */
    'D-09': {
      get_command: [
        "Get-SPOSite -Identity '{cuiSiteUrl}' -ErrorAction SilentlyContinue",
        "| Select-Object Url,Title,SharingCapability,LockState,ConditionalAccessPolicy",
      ].join(' '),
      set_command: [
        "Set-SPOSite -Identity '{cuiSiteUrl}'",
        "  -SharingCapability Disabled",
        "  -ConditionalAccessPolicy AllowLimitedAccess",
        "  -DefaultLinkPermission View;",
        "Set-SPOSite -Identity '{cuiSiteUrl}' -DenyAddAndCustomizePages 0;",
        "Set-MgGroupVisibility -GroupId '{cuiGroupId}' -Visibility 'Private'",
        "  -ErrorAction SilentlyContinue",
      ].join(' '),
    },

    /** D-03: DLP Incident–CUI Exfiltration — containment: hold + block sharing (Tier 3 gated) */
    'D-03': {
      // FC-AO-2 (REQ-ces-ao-paired-reads, D-03): the set opens a compliance case + hold, revokes
      // sessions and disables the user; the old read (the DLP audit search) observes none of that.
      // Read the containment state the set creates: the case, its hold, and the user's AccountEnabled.
      get_command: [
        "Get-ComplianceCase -Identity 'CUI-Exfil-{incidentId}' -ErrorAction SilentlyContinue",
        "| Select-Object Name,CaseType,Status;",
        "Get-CaseHoldPolicy -Case 'CUI-Exfil-{incidentId}' -ErrorAction SilentlyContinue",
        "| Select-Object Name,Enabled,ExchangeLocation;",
        "Get-MgUser -UserId '{targetUPN}' -Property UserPrincipalName,AccountEnabled",
        "| Select-Object UserPrincipalName,AccountEnabled",
      ].join(' '),
      set_command: [
        // FC-AO-2: real EXO case type is eDiscovery (was misspelled eDscovery).
        "New-ComplianceCase -Name 'CUI-Exfil-{incidentId}' -CaseType eDiscovery",
        "  -Description 'DLP CUI exfiltration containment — Incident {incidentId}';",
        "$case = Get-ComplianceCase -Identity 'CUI-Exfil-{incidentId}';",
        "New-CaseHoldPolicy -Name 'Hold-{incidentId}' -Case $case.Name",
        "  -ExchangeLocation '{targetUPN}' -Enabled:$true;",
        "Revoke-MgUserSignInSession -UserId '{targetUPN}';",
        "Update-MgUser -UserId '{targetUPN}' -AccountEnabled:$false",
      ].join(' '),
    },

    // ─── Domain E: Audit, Logging & Monitoring ─────────────────────────────────
    // All 10 Domain E commands are pure read-only. E-01 is CONFIG trigger but
    // included here because it is read-only in get_command form (audit config only).

    /** E-01: Audit Log Retention — read current config; set_command configures retention */
    'E-01': {
      get_command: [
        "Get-AdminAuditLogConfig",
        "| Select-Object UnifiedAuditLogIngestionEnabled,AdminAuditLogEnabled,AdminAuditLogAgeLimit",
      ].join(' '),
      set_command: [
        "Set-AdminAuditLogConfig -UnifiedAuditLogIngestionEnabled:$true",
        "  -AdminAuditLogEnabled:$true",
        "  -AdminAuditLogAgeLimit '{auditLogRetentionDays}';",
        "az monitor log-analytics workspace update",
        "  --workspace-name '{sentinelWorkspaceName}'",
        "  --resource-group '{resourceGroupName}'",
        "  --retention-time '{auditLogRetentionDays}' 2>&1",
      ].join(' '),
    },

    /** E-02: Unified Audit Log Health — verify event flow over past 24 hours */
    'E-02': {
      set_command: '',
      get_command: [
        "Search-UnifiedAuditLog -StartDate (Get-Date).AddDays(-1) -EndDate (Get-Date)",
        "-ResultSize 10",
        "| Select-Object CreationDate,UserIds,RecordType,Operations",
        ";",
        "Get-AdminAuditLogConfig | Select-Object UnifiedAuditLogIngestionEnabled",
      ].join(' '),
    },

    /** E-03: Diagnostic Settings Coverage — enumerate diagnostic settings across resources */
    'E-03': {
      set_command: '',
      get_command: [
        "az monitor diagnostic-settings list --resource-group '' --output json 2>&1;",
        "Search-UnifiedAuditLog -StartDate (Get-Date).AddDays(-7) -EndDate (Get-Date)",
        "-RecordType AzureActiveDirectory",
        "-ResultSize 100",
        "| Select-Object CreationDate,RecordType,Operations,UserIds",
      ].join(' '),
    },

    /** E-04: Sentinel Analytics Rule Review — rule inventory with MITRE mapping */
    'E-04': {
      set_command: '',
      get_command: [
        "Search-UnifiedAuditLog -StartDate (Get-Date).AddDays(-30) -EndDate (Get-Date)",
        "-RecordType SecurityComplianceAlerts",
        "-ResultSize 5000",
        "| Select-Object CreationDate,Operations,AuditData",
        "| Group-Object Operations",
        "| Select-Object Name,Count",
        "| Sort-Object Count -Descending",
      ].join(' '),
    },

    /** E-05: Alert Fatigue Analysis — false positive rate from alert activity */
    'E-05': {
      set_command: '',
      get_command: [
        "Search-UnifiedAuditLog -StartDate (Get-Date).AddDays(-30) -EndDate (Get-Date)",
        "-RecordType SecurityComplianceAlerts",
        "-ResultSize 5000",
        "| Select-Object CreationDate,UserIds,Operations,AuditData",
      ].join(' '),
    },

    /** E-06: Log Export to SIEM Validation — validate connector ingestion */
    'E-06': {
      set_command: '',
      get_command: [
        "Search-UnifiedAuditLog -StartDate (Get-Date).AddDays(-1) -EndDate (Get-Date)",
        "-RecordType AzureActiveDirectory",
        "-ResultSize 100",
        "| Measure-Object",
        "| Select-Object Count;",
        "Get-AdminAuditLogConfig | Select-Object UnifiedAuditLogIngestionEnabled",
      ].join(' '),
    },

    /** E-07: Privileged Action Audit — role changes and PIM activations */
    'E-07': {
      set_command: '',
      get_command: [
        "Search-UnifiedAuditLog -StartDate (Get-Date).AddDays(-30) -EndDate (Get-Date)",
        // FC-AO-2: directory role changes and PIM activations are audited under the
        // AzureActiveDirectory record type (AzureActiveDirectoryAccountLogon is sign-ins; Teams is
        // unrelated), so the old filter could never match a role change.
        "-RecordType AzureActiveDirectory",
        // FC-AO-2 (tenant-stacksim REQ-ces-ao-matrix-inputs, E-07): quoted — unquoted, PowerShell binds
        // -Operations 'Add' and the rest as positional arguments (real EXO rejects them).
        "-Operations 'Add member to role.','Activate role'",
        "-ResultSize 5000",
        "| Select-Object CreationDate,UserIds,Operations,AuditData",
      ].join(' '),
    },

    /** E-08: Sign-In Log Anomaly Sweep — risky sign-ins from Identity Protection */
    'E-08': {
      set_command: '',
      get_command: [
        "Get-MgRiskyUser -All -Filter \"riskState eq 'atRisk'\"",
        "-Property Id,UserPrincipalName,RiskLevel,RiskState,RiskLastUpdatedDateTime",
        "| Select-Object UserPrincipalName,RiskLevel,RiskState,RiskLastUpdatedDateTime",
        ";",
        "Search-UnifiedAuditLog -StartDate (Get-Date).AddDays(-7) -EndDate (Get-Date)",
        "-RecordType AzureActiveDirectoryAccountLogon",
        "-ResultSize 1000",
        "| Where-Object { $_.AuditData -like '*riskEventTypes*' }",
        "| Select-Object CreationDate,UserIds,AuditData",
      ].join(' '),
    },

    /** E-09: C3PAO Evidence Package Assembly — audit log coverage check */
    'E-09': {
      set_command: '',
      get_command: [
        "Search-UnifiedAuditLog -StartDate (Get-Date).AddDays(-90) -EndDate (Get-Date)",
        "-RecordType AzureActiveDirectory,SharePoint,Exchange",
        "-ResultSize 10",
        "| Select-Object CreationDate,RecordType,Operations,UserIds",
        ";",
        "Get-AdminAuditLogConfig | Select-Object UnifiedAuditLogIngestionEnabled,AdminAuditLogAgeLimit",
      ].join(' '),
    },

    /** E-10: POA&M Evidence Closure — per-finding remediation evidence check */
    'E-10': {
      set_command: '',
      get_command: [
        "Search-UnifiedAuditLog -StartDate (Get-Date).AddDays(-90) -EndDate (Get-Date)",
        "-RecordType SecurityComplianceCenterEOPCmdlet",
        "-ResultSize 5000",
        "| Select-Object CreationDate,UserIds,Operations,AuditData",
        "| Where-Object { $_.Operations -match 'New-ComplianceCase|Set-ComplianceCase|Close-ComplianceCase' }",
      ].join(' '),
    },

    // ─── Domain F: Security Configuration & Posture ────────────────────────────

    /** F-01: Secure Score Trend Report — weekly trend from Graph API */
    'F-01': {
      set_command: '',
      get_command: [
        "Get-MgSecuritySecureScore -Top 10",
        "| Select-Object CreatedDateTime,CurrentScore,MaxScore,",
        "  @{N='Percentage';E={[math]::Round(($_.CurrentScore/$_.MaxScore)*100,1)}}",
        "| Sort-Object CreatedDateTime",
      ].join(' '),
    },

    /** F-02: Defender Recommendation Sprint — top recommendations */
    'F-02': {
      set_command: '',
      get_command: [
        "Get-MgSecuritySecureScoreControlProfile -All",
        "| Where-Object { $_.ImplementationStatus -ne 'implemented' }",
        "| Select-Object Title,ControlCategory,MaxScore,ImplementationStatus,Threats",
        "| Sort-Object MaxScore -Descending",
        "| Select-Object -First 10",
      ].join(' '),
    },

    /** F-03: ASR Rule Audit — Attack Surface Reduction rule status */
    'F-03': {
      set_command: '',
      get_command: [
        "Get-MgDeviceManagementDeviceConfiguration -All",
        "-Property DisplayName,ODataType,LastModifiedDateTime",
        "| Where-Object { $_.ODataType -like '*endpointProtection*' }",
        "| Select-Object DisplayName,ODataType,LastModifiedDateTime",
        "| ConvertTo-Json -Depth 3",
      ].join(' '),
    },

    /** F-04: Legacy Auth Block Validation — CA policy and sign-in log check */
    'F-04': {
      set_command: '',
      get_command: [
        "Get-MgIdentityConditionalAccessPolicy -All",
        "| Where-Object { $_.Conditions.ClientAppTypes -contains 'exchangeActiveSync' -or",
        "  $_.Conditions.ClientAppTypes -contains 'other' }",
        "| Select-Object Id,DisplayName,State,Conditions",
        ";",
        "Search-UnifiedAuditLog -StartDate (Get-Date).AddDays(-7) -EndDate (Get-Date)",
        "-RecordType AzureActiveDirectoryAccountLogon",
        "-ResultSize 1000",
        "| Where-Object { $_.AuditData -like '*legacyAuth*' }",
        "| Select-Object CreationDate,UserIds,AuditData",
      ].join(' '),
    },

    /** F-05: Azure Security Benchmark Report — Defender for Cloud compliance */
    'F-05': {
      set_command: '',
      get_command: [
        "Get-MgSecuritySecureScore -Top 1",
        "| Select-Object CreatedDateTime,CurrentScore,MaxScore,AzureTenantId",
        ";",
        "Get-MgSecuritySecureScoreControlProfile -All",
        "| Where-Object { $_.ControlCategory -eq 'AzureResourceManager' }",
        "| Select-Object Title,MaxScore,ImplementationStatus",
        "| Sort-Object ImplementationStatus",
      ].join(' '),
    },

    /** F-06: Resource Firewall/NSG Audit — network security group rules */
    'F-06': {
      set_command: '',
      get_command: [
        "az network nsg list --output json 2>&1",
        ";",
        "az network nsg rule list --nsg-name '' --resource-group '' --output json 2>&1",
      ].join(' '),
    },

    /** F-09: CIS Benchmark Hardening — secure score control profiles */
    'F-09': {
      set_command: '',
      get_command: [
        "Get-MgSecuritySecureScoreControlProfile -All",
        "| Select-Object Title,ControlCategory,MaxScore,ImplementationStatus,Tier",
        "| Sort-Object ControlCategory,ImplementationStatus",
        "| ConvertTo-Json -Depth 3",
      ].join(' '),
    },

    /** F-10: Third-Party App Consent Audit — permission inventory */
    'F-10': {
      set_command: '',
      get_command: [
        "Get-MgServicePrincipal -All",
        "-Property DisplayName,AppId,ServicePrincipalType,AppRoles",
        "| Where-Object { $_.ServicePrincipalType -eq 'Application' }",
        "| ForEach-Object {",
        "  $sp = $_;",
        "  $grants = Get-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $sp.Id -ErrorAction SilentlyContinue;",
        "  [PSCustomObject]@{",
        "    AppName     = $sp.DisplayName;",
        "    AppId       = $sp.AppId;",
        "    GrantCount  = ($grants | Measure-Object).Count;",
        "  }",
        "} | Sort-Object GrantCount -Descending",
      ].join(' '),
    },

    // ─── Domain F: Security Configuration & Posture — WRITE commands ──────────

    /** F-07: Admin Portal IP Restriction — enforce CA policy restricting admin portal to trusted IPs */
    'F-07': {
      get_command: [
        "Get-MgIdentityConditionalAccessPolicy -All",
        "| Where-Object { $_.DisplayName -like '*Admin Portal*' -or $_.DisplayName -like '*Admin IP*' }",
        "| Select-Object Id,DisplayName,State,Conditions,GrantControls",
        "| ConvertTo-Json -Depth 5",
      ].join(' '),
      set_command: [
        "Update-MgIdentityConditionalAccessPolicy -ConditionalAccessPolicyId '{adminPortalCaPolicyId}'",
        "  -State 'enabled'",
        "  -Conditions @{",
        "    Locations = @{",
        "      IncludeLocations = @('All');",
        "      ExcludeLocations = @('{namedLocationId}') } };",
        "Write-Output \"Admin Portal CA policy '{adminPortalCaPolicyId}' enabled with IP restriction at $(Get-Date -Format u)\"",
      ].join(' '),
    },

    /** F-08: Config Drift Alert Response — investigate Sentinel alert, revert unauthorized change */
    'F-08': {
      get_command: [
        "Get-MgSecurityAlert -AlertId '{alertId}'",
        "| Select-Object Id,Title,Severity,Status,Description,CreatedDateTime,RecommendedActions;",
        "Search-UnifiedAuditLog",
        "-StartDate (Get-Date).AddHours(-4) -EndDate (Get-Date)",
        "-RecordType AzureActiveDirectory,ExchangeAdmin",
        "-ResultSize 200",
        "| Where-Object { $_.AuditData -like '*{driftResourceId}*' }",
        "| Select-Object CreationDate,UserIds,Operations,AuditData",
      ].join(' '),
      set_command: [
        "Update-MgSecurityAlert -AlertId '{alertId}' -Status 'inProgress'",
        "  -AssignedTo '{operatorUPN}';",
        "az resource update --ids '{driftResourceId}'",
        "  --set properties.{driftProperty}='{expectedValue}' 2>&1",
      ].join(' '),
    },

    // ─── Domain G: Personnel Security & Training Compliance ────────────────────

    /** G-01: Annual Security Training Audit — training roster from CSV/SharePoint */
    'G-01': {
      set_command: '',
      get_command: [
        "Import-Csv -Path '{trainingRosterPath}' -ErrorAction SilentlyContinue",
        "| Select-Object EmployeeId,Name,Email,TrainingCompleted,CompletionDate,ExpiryDate",
        "| Where-Object { $_.ExpiryDate -lt (Get-Date).ToString('yyyy-MM-dd') -or $_.TrainingCompleted -ne 'Yes' }",
      ].join(' '),
    },

    /** G-03: Role-Based CUI Training — CUI group membership vs training roster */
    'G-03': {
      set_command: '',
      get_command: [
        "Get-MgGroupMember -GroupId '{cuiGroupId}' -All",
        "-Property DisplayName,UserPrincipalName",
        "| Select-Object DisplayName,UserPrincipalName",
      ].join(' '),
    },

    /** G-04: Phishing Simulation Report — Attack Simulator campaign results */
    'G-04': {
      set_command: '',
      get_command: [
        "Search-UnifiedAuditLog -StartDate (Get-Date).AddDays(-90) -EndDate (Get-Date)",
        "-RecordType AttackSim",
        "-ResultSize 5000",
        "| Select-Object CreationDate,UserIds,Operations,AuditData",
      ].join(' '),
    },

    /** G-05: Personnel Screening Sync — HR clearance CSV import */
    'G-05': {
      set_command: '',
      get_command: [
        "Import-Csv -Path '{trainingRosterPath}' -ErrorAction SilentlyContinue",
        "| Select-Object EmployeeId,Name,Email,ClearanceLevel,ScreeningDate,ClearanceExpiry",
        "| Sort-Object ClearanceExpiry",
      ].join(' '),
    },

    /** G-06: NDA/AUP Acknowledgment — SharePoint list of acknowledgments */
    'G-06': {
      set_command: '',
      get_command: [
        "Get-PnPListItem -List 'NDA_AUP_Acknowledgments' -Fields Title,AcknowledgedBy,AcknowledgedDate,ExpiryDate",
        "-ErrorAction SilentlyContinue",
        "| Select-Object -ExpandProperty FieldValues",
        "| Select-Object Title,AcknowledgedBy,AcknowledgedDate,ExpiryDate",
        "| Where-Object { $_.ExpiryDate -lt (Get-Date) }",
      ].join(' '),
    },

    /** G-07: Insider Threat Indicator Report — Purview Insider Risk Management */
    'G-07': {
      set_command: '',
      get_command: [
        "Search-UnifiedAuditLog -StartDate (Get-Date).AddDays(-30) -EndDate (Get-Date)",
        "-RecordType ComplianceDLPExchange,ComplianceDLPSharePoint",
        "-ResultSize 5000",
        "| Where-Object { $_.AuditData -like '*insiderRisk*' -or $_.Operations -like '*Exfiltration*' }",
        "| Select-Object CreationDate,UserIds,Operations,AuditData",
      ].join(' '),
    },

    /** G-08: Contractor Access Recertification — guest and contractor account review */
    'G-08': {
      set_command: '',
      get_command: [
        "Get-MgUser -Filter \"userType eq 'Guest'\" -All",
        "-Property DisplayName,UserPrincipalName,SignInActivity,CreatedDateTime",
        "| Where-Object { $_.CreatedDateTime -lt (Get-Date).AddDays(-90) }",
        "| Select-Object DisplayName,UserPrincipalName,CreatedDateTime,SignInActivity",
        "| Sort-Object CreatedDateTime",
      ].join(' '),
    },

    // ─── Domain G: Personnel Security & Training Compliance — WRITE commands ───

    /** G-02: New Hire Training Enforcement — enroll new user in LMS group, apply CA block */
    'G-02': {
      get_command: [
        "Get-MgUser -Filter \"userPrincipalName eq '{targetUPN}'\"",
        "-Property DisplayName,UserPrincipalName,AccountEnabled,CreatedDateTime",
        "| Select-Object DisplayName,UserPrincipalName,AccountEnabled,CreatedDateTime;",
        "Get-MgUserMemberOf -UserId '{targetUPN}' -All",
        "| Where-Object { $_.AdditionalProperties.displayName -like '*Training*' }",
        "| Select-Object -ExpandProperty AdditionalProperties | Select-Object displayName,id",
      ].join(' '),
      set_command: [
        "$userId = (Get-MgUser -UserId '{targetUPN}').Id;",
        "New-MgGroupMember -GroupId '{trainingEnforcementGroupId}' -DirectoryObjectId $userId;",
        "Write-Output \"User '{targetUPN}' enrolled in training enforcement group at $(Get-Date -Format u)\"",
      ].join(' '),
    },

    // ─── Domain H: Incident Response & Recovery Operations ─────────────────────

    /** H-05: IR Tabletop/Drill Evidence — exercise attendance from audit log */
    'H-05': {
      set_command: '',
      get_command: [
        "Search-UnifiedAuditLog -StartDate (Get-Date).AddDays(-365) -EndDate (Get-Date)",
        "-RecordType SecurityComplianceCenterEOPCmdlet",
        "-Operations New-ComplianceCase,Set-ComplianceCase",
        "-ResultSize 1000",
        "| Select-Object CreationDate,UserIds,Operations,AuditData",
      ].join(' '),
    },

    /** H-07: Backup Integrity Verification — Azure Backup job status */
    'H-07': {
      set_command: '',
      get_command: [
        // W4-AO4: the vault and resource group were literal empty strings (the command could not
        // succeed on any tenant); they are now tenant-sourced (SourceBindings).
        "az backup job list --vault-name '{backupVaultName}' --resource-group '{resourceGroupName}' --output json 2>&1",
        ";",
        "Get-MgSecurityAlert -All",
        "-Filter \"category eq 'Backup'\"",
        "-Property Id,Title,Severity,Status,CreatedDateTime",
        "| Select-Object Title,Severity,Status,CreatedDateTime",
        "| Sort-Object CreatedDateTime -Descending",
        "| Select-Object -First 10",
      ].join(' '),
    },

    /** H-08: BCP/DR Contact List & Runbook — contact list validation */
    'H-08': {
      set_command: '',
      get_command: [
        "Get-MgSecurityAlert -All",
        "-Filter \"category eq 'BusinessContinuity'\"",
        "-Property Id,Title,Severity,Status,CreatedDateTime",
        "| Select-Object Title,Severity,Status,CreatedDateTime",
        "| Sort-Object CreatedDateTime -Descending",
        "| Select-Object -First 20",
        ";",
        "Get-MgUser -Filter \"jobTitle eq 'Business Continuity Officer'\" -All",
        "-Property DisplayName,UserPrincipalName,Mail",
        "| Select-Object DisplayName,UserPrincipalName,Mail",
      ].join(' '),
    },

    // ─── Domain H: Incident Response & Recovery Operations — WRITE commands ────

    /** H-01: Security Incident Intake — triage Sentinel incident, assign and classify */
    'H-01': {
      get_command: [
        "Get-MgSecurityIncident -IncidentId '{incidentId}'",
        "-Property Id,DisplayName,Severity,Status,Classification,CreatedDateTime,AssignedTo",
        "| Select-Object Id,DisplayName,Severity,Status,Classification,CreatedDateTime,AssignedTo",
      ].join(' '),
      set_command: [
        "Update-MgSecurityIncident -IncidentId '{incidentId}'",
        "  -Status 'active'",
        "  -Severity '{incidentSeverity}'",
        "  -Classification '{incidentClassification}'",
        "  -AssignedTo '{operatorUPN}';",
        "Write-Output \"Incident '{incidentId}' triaged and assigned to '{operatorUPN}' at $(Get-Date -Format u)\"",
      ].join(' '),
    },

    /** H-03: Malware/Ransomware Isolation — isolate device via Defender for Endpoint */
    'H-03': {
      get_command: [
        "Get-MgDeviceManagementManagedDevice -ManagedDeviceId '{deviceId}'",
        "-Property Id,DeviceName,OperatingSystem,ComplianceState,UserPrincipalName;",
        "Get-MgSecurityAlert -All",
        "-Filter \"deviceId eq '{deviceId}'\"",
        "| Select-Object Id,Title,Severity,Status,CreatedDateTime",
        "| Sort-Object CreatedDateTime -Descending | Select-Object -First 5",
      ].join(' '),
      set_command: [
        "Invoke-MgDeviceManagementManagedDeviceIsolateDevice -ManagedDeviceId '{deviceId}' 2>&1;",
        "Invoke-MgDeviceManagementManagedDeviceRequestRemoteAssistance -ManagedDeviceId '{deviceId}'",
        "  -ErrorAction SilentlyContinue;",
        "Write-Output \"Device '{deviceId}' isolated at $(Get-Date -Format u) by {operatorUPN}\"",
      ].join(' '),
    },

    /** H-04: Timeline & Evidence Preservation — create eDiscovery case and hold */
    'H-04': {
      get_command: [
        "Get-ComplianceCase -Identity 'IR-{incidentId}' -ErrorAction SilentlyContinue",
        "| Select-Object Name,Status,CreatedDateTime,ClosedDateTime;",
        "Get-CaseHoldPolicy -Case 'IR-{incidentId}' -ErrorAction SilentlyContinue",
        "| Select-Object Name,Enabled,Status,ExchangeLocation",
      ].join(' '),
      set_command: [
        "New-ComplianceCase -Name 'IR-{incidentId}' -CaseType eDiscovery",
        "  -Description 'Evidence preservation for incident {incidentId}';",
        "New-CaseHoldPolicy -Name 'Hold-IR-{incidentId}' -Case 'IR-{incidentId}'",
        "  -ExchangeLocation '{targetUPN}' -Enabled:$true;",
        "New-CaseHoldRule -Name 'Rule-IR-{incidentId}' -Policy 'Hold-IR-{incidentId}'",
        "  -ContentMatchQuery 'incident:{incidentId}'",
      ].join(' '),
    },

    /** H-06: Post-Incident Review Package — create compliance case for RCA and POA&M */
    'H-06': {
      get_command: [
        "Get-ComplianceCase -Identity 'PIR-{incidentId}' -ErrorAction SilentlyContinue",
        "| Select-Object Name,Status,CreatedDateTime;",
        "Search-UnifiedAuditLog -StartDate '{incidentStartDate}' -EndDate '{incidentEndDate}'",
        "-ResultSize 5000",
        "| Where-Object { $_.AuditData -like '*{incidentId}*' }",
        "| Select-Object CreationDate,UserIds,Operations,AuditData",
        "| Measure-Object | Select-Object Count",
      ].join(' '),
      set_command: [
        "New-ComplianceCase -Name 'PIR-{incidentId}' -CaseType eDiscovery",
        "  -Description 'Post-Incident Review — {incidentId}' -ErrorAction SilentlyContinue;",
        "Write-Output \"PIR case created for incident {incidentId} at $(Get-Date -Format u)\";",
        "New-ComplianceTag -Name 'PIR-Evidence-{incidentId}'",
        "  -RetentionDuration 1095 -RetentionAction Keep -IsRecordLabel:$true",
        "  -ErrorAction SilentlyContinue",
      ].join(' '),
    },

    /** H-02: Compromised Account Containment — disable + revoke sessions (Tier 3 gated) */
    'H-02': {
      get_command: [
        "Get-MgUser -Filter \"userPrincipalName eq '{targetUPN}'\"",
        "-Property Id,DisplayName,UserPrincipalName,AccountEnabled,SignInActivity;",
        "Get-MgRiskyUser -Filter \"userPrincipalName eq '{targetUPN}'\"",
        "| Select-Object UserPrincipalName,RiskLevel,RiskState,RiskLastUpdatedDateTime",
      ].join(' '),
      set_command: [
        "Update-MgUser -UserId '{targetUPN}' -AccountEnabled:$false;",
        "Revoke-MgUserSignInSession -UserId '{targetUPN}';",
        "Confirm-MgRiskyUser -UserIds @((Get-MgUser -UserId '{targetUPN}').Id);",
        "Update-MgUser -UserId '{targetUPN}'",
        "  -PasswordProfile @{ Password = (New-Guid).ToString() + 'Aa1!';",
        "    ForceChangePasswordNextSignIn = $true };",
        "Write-Output \"Account '{targetUPN}' contained at $(Get-Date -Format u) by {operatorUPN}\"",
      ].join(' '),
    },

    // ─── Domain F: Network Boundary — firewall write commands (CONFIG) ─────────
    // NOTE: firewall variable placeholders use ${name} (dollar-brace) to match
    // Stamper PowerShellAdapter.interpolateVariables() which substitutes ${key}.
    // The bare-brace { } that remain are literal PowerShell (hashtable / scriptblock),
    // not template variables, and must stay as-is.
    'F-11': {
      set_command: "$fw = Get-AzFirewall -ResourceGroupName ${resourceGroup} -Name ${firewallName}; $fw.Deallocate(); Set-AzFirewall -AzureFirewall $fw",
      get_command: "Get-AzFirewall -ResourceGroupName ${resourceGroup} -Name ${firewallName} | Select-Object Name,ProvisioningState,@{Name='AllocationState';Expression={if($_.IpConfigurations.Count -eq 0){'Deallocated'}else{'Allocated'}}} | ConvertTo-Json -Depth 3"
    },
    'F-12': {
      set_command: "$fw = Get-AzFirewall -ResourceGroupName ${resourceGroup} -Name ${firewallName}; $vnet = Get-AzVirtualNetwork -ResourceGroupName ${resourceGroup} -Name ${vnetName}; $pip = Get-AzPublicIpAddress -ResourceGroupName ${resourceGroup} -Name ${publicIpName}; $fw.Allocate($vnet, $pip); Set-AzFirewall -AzureFirewall $fw",
      get_command: "Get-AzFirewall -ResourceGroupName ${resourceGroup} -Name ${firewallName} | Select-Object Name,ProvisioningState,@{Name='AllocationState';Expression={if($_.IpConfigurations.Count -eq 0){'Deallocated'}else{'Allocated'}}} | ConvertTo-Json -Depth 3"
    },

    /** F-13: Enclave Subnet Deny-by-Default Baseline (G-FW-ALT Phase 1) — per non-platform subnet: NSG (created if missing) with Allow-VNet@4000 + Deny-All@4096 in/out, blackhole route table, privateEndpointNetworkPolicies Enabled. Subnet properties are mutated IN PLACE (never Set-AzVirtualNetworkSubnetConfig, which clears omitted properties like service endpoints). Idempotent. */
    'F-13': {
      get_command: "$vnet=Get-AzVirtualNetwork -ResourceGroupName {resourceGroup} -Name {vnetName}; $vnet.Subnets | ForEach-Object { [pscustomobject]@{ subnet=$_.Name; nsg=if($_.NetworkSecurityGroup){($_.NetworkSecurityGroup.Id -split '/')[-1]}else{'NONE'}; routeTable=if($_.RouteTable){($_.RouteTable.Id -split '/')[-1]}else{'NONE'}; pePolicies=$_.PrivateEndpointNetworkPolicies } } | ConvertTo-Json -Depth 3",
      set_command: [
        "$platform='^(AzureBastionSubnet|GatewaySubnet|AzureFirewallSubnet|AzureFirewallManagementSubnet)$';",
        "$vnet=Get-AzVirtualNetwork -ResourceGroupName {resourceGroup} -Name {vnetName}; $loc=$vnet.Location; $changed=@(); $notes=@();",
        "$rt=Get-AzRouteTable -ResourceGroupName {resourceGroup} -Name '{vnetName}-rt-blackhole' -ErrorAction SilentlyContinue;",
        "if(-not $rt){ $rt=New-AzRouteTable -ResourceGroupName {resourceGroup} -Name '{vnetName}-rt-blackhole' -Location $loc; $changed+='created route table {vnetName}-rt-blackhole' };",
        "if(-not @($rt.Routes | Where-Object { $_.AddressPrefix -eq '0.0.0.0/0' -and $_.NextHopType -eq 'None' }).Count){ $null=($rt | Add-AzRouteConfig -Name 'blackhole-internet' -AddressPrefix '0.0.0.0/0' -NextHopType None | Set-AzRouteTable); $rt=Get-AzRouteTable -ResourceGroupName {resourceGroup} -Name '{vnetName}-rt-blackhole'; $changed+='added 0.0.0.0/0->None blackhole route' };",
        "foreach($sn in $vnet.Subnets){ if($sn.Name -match $platform){ continue };",
        "$nsg=$null; if($sn.NetworkSecurityGroup){ $nsgName=($sn.NetworkSecurityGroup.Id -split '/')[-1]; $nsg=Get-AzNetworkSecurityGroup -ResourceGroupName {resourceGroup} -Name $nsgName -ErrorAction SilentlyContinue };",
        "if(-not $nsg){ $nsgName='{vnetName}-nsg-'+$sn.Name; $nsg=Get-AzNetworkSecurityGroup -ResourceGroupName {resourceGroup} -Name $nsgName -ErrorAction SilentlyContinue; if(-not $nsg){ $nsg=New-AzNetworkSecurityGroup -ResourceGroupName {resourceGroup} -Name $nsgName -Location $loc; $changed+=\"created NSG $nsgName\" } };",
        "$want=@(@{n='Allow-VNet-Inbound';p=4000;d='Inbound';a='Allow';s='VirtualNetwork';t='VirtualNetwork'},@{n='Allow-VNet-Outbound';p=4000;d='Outbound';a='Allow';s='VirtualNetwork';t='VirtualNetwork'},@{n='Deny-All-Inbound';p=4096;d='Inbound';a='Deny';s='*';t='*'},@{n='Deny-All-Outbound';p=4096;d='Outbound';a='Deny';s='*';t='*'});",
        "$dirty=$false; foreach($r in $want){ if(-not @($nsg.SecurityRules | Where-Object { $_.Name -eq $r.n }).Count){ $p=$r.p; if($r.a -eq 'Deny'){ while(@($nsg.SecurityRules | Where-Object { $_.Direction -eq $r.d -and $_.Priority -eq $p }).Count){ $p-- } } else { while(@($nsg.SecurityRules | Where-Object { $_.Direction -eq $r.d -and $_.Priority -eq $p }).Count){ $p++ } }; $null=($nsg | Add-AzNetworkSecurityRuleConfig -Name $r.n -Priority $p -Direction $r.d -Access $r.a -Protocol '*' -SourceAddressPrefix $r.s -SourcePortRange '*' -DestinationAddressPrefix $r.t -DestinationPortRange '*'); $dirty=$true; $changed+=\"$($nsg.Name): rule $($r.n)@$p\" } };",
        "if($dirty){ $nsg=($nsg | Set-AzNetworkSecurityGroup) };",
        "if(-not $sn.NetworkSecurityGroup -or $sn.NetworkSecurityGroup.Id -ne $nsg.Id){ $sn.NetworkSecurityGroup=$nsg; $changed+=\"$($sn.Name): NSG attached\" };",
        "if(-not $sn.RouteTable -or $sn.RouteTable.Id -ne $rt.Id){ $sn.RouteTable=$rt; $changed+=\"$($sn.Name): blackhole route table attached\" };",
        "if($sn.PrivateEndpointNetworkPolicies -ne 'Enabled'){ if(@($sn.PrivateEndpoints).Count){ $notes+=\"$($sn.Name): privateEndpointNetworkPolicies left Disabled (Azure refuses enabling on a subnet already holding private endpoints - documented residual)\" } else { $sn.PrivateEndpointNetworkPolicies='Enabled'; $changed+=\"$($sn.Name): privateEndpointNetworkPolicies Enabled\" } } };",
        "if($changed.Count){ $null=($vnet | Set-AzVirtualNetwork) };",
        "$noteText=''; if($notes.Count){ $noteText=\" [notes: $($notes -join '; ')]\" };",
        "if($changed.Count){ \"deny-by-default baseline applied to '{vnetName}': $($changed -join '; ')$noteText\" } else { \"'{vnetName}' already carries the deny-by-default baseline - no change$noteText\" }",
      ].join(' '),
    },

    /** F-14: VNet Flow Logs + Sentinel Flow Analytics (G-FW-ALT Phase 1) — VNet flow log (Traffic Analytics -> LAW, NTANetAnalytics table) + Sentinel scheduled rule for denied flows. Idempotent. */
    'F-14': {
      get_command: "$vnet=Get-AzVirtualNetwork -ResourceGroupName {resourceGroup} -Name {vnetName}; $nw=Get-AzNetworkWatcher -Location $vnet.Location; $fl=@(Get-AzNetworkWatcherFlowLog -NetworkWatcher $nw | Where-Object { $_.TargetResourceId -eq $vnet.Id }); [pscustomobject]@{ vnet=$vnet.Name; flowLogs=$fl.Count; enabled=@($fl | Where-Object { $_.Enabled }).Count } | ConvertTo-Json",
      set_command: [
        "$vnet=Get-AzVirtualNetwork -ResourceGroupName {resourceGroup} -Name {vnetName};",
        "$nw=Get-AzNetworkWatcher -Location $vnet.Location; $changed=@();",
        "$fl=@(Get-AzNetworkWatcherFlowLog -NetworkWatcher $nw | Where-Object { $_.TargetResourceId -eq $vnet.Id -and $_.Enabled }) | Select-Object -First 1;",
        "if(-not $fl){ $sa=Get-AzStorageAccount -ResourceGroupName {resourceGroup} -Name {storageAccountName}; $ws=Get-AzOperationalInsightsWorkspace -ResourceGroupName {resourceGroup} -Name {workspaceName};",
        "$null=New-AzNetworkWatcherFlowLog -NetworkWatcher $nw -Name '{vnetName}-flowlog' -TargetResourceId $vnet.Id -StorageId $sa.Id -Enabled $true -EnableTrafficAnalytics -TrafficAnalyticsWorkspaceId $ws.ResourceId -TrafficAnalyticsInterval 60 -Force; $changed+='VNet flow log enabled (Traffic Analytics -> {workspaceName}, 60m)' };",
        "$rules=@(Get-AzSentinelAlertRule -ResourceGroupName {resourceGroup} -WorkspaceName {workspaceName});",
        "if(-not @($rules | Where-Object { \"$($_.Query)\" -match 'NTANetAnalytics' }).Count){",
        "$q='NTANetAnalytics | where TimeGenerated > ago(1h) | where FlowType in (\"MaliciousFlow\", \"ExternalPublic\") or DeniedInFlows > 0 or DeniedOutFlows > 0';",
        "$null=New-AzSentinelAlertRule -ResourceGroupName {resourceGroup} -WorkspaceName {workspaceName} -Kind Scheduled -DisplayName 'CMMC - Denied or anomalous network flow (enclave VNet)' -Query $q -QueryFrequency (New-TimeSpan -Hours 1) -QueryPeriod (New-TimeSpan -Hours 1) -TriggerOperator 'GreaterThan' -TriggerThreshold 0 -Severity 'Medium' -Enabled;",
        "$changed+='Sentinel NTANetAnalytics analytics rule created' };",
        "if($changed.Count){ \"flow monitoring applied to '{vnetName}': $($changed -join '; ')\" } else { \"'{vnetName}' flow logging + NTANetAnalytics rule already in place - no change\" }",
      ].join(' '),
    }
  };

  return templates[commandId] || null;
}
