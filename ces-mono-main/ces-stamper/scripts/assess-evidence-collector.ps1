<#
  SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
  SPDX-License-Identifier: LicenseRef-BHD-Proprietary
  CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
  Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
  Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
  Submitting a change to this repository means you accept TERMS.md.
  Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
  See LICENSE and TERMS.md.
#>

#Requires -Modules Microsoft.Graph, ExchangeOnlineManagement, MicrosoftTeams, PnP.PowerShell
<#
.SYNOPSIS
    Stamper Registry Evidence Collector — GCC High
    Auto-generated from CMMC L2 + Infrastructure command registries.
    Tenant: vfsgov-xtra (vfsgov.us)
    Total: 186 GET commands across 6 engines

.DESCRIPTION
    Connects to all M365/Azure services and runs each registry entry's
    GET command to collect evidence. Press SPACEBAR to advance, S to skip, Q to quit.

.PARAMETER SkipConnect
    Skip module connections (if already connected).
.PARAMETER NoPrompt
    Run all commands without pausing.
.PARAMETER FilterEngine
    Only run commands for this engine (mgraph, exchange, ipps, teams, spo, az).
.PARAMETER FilterControl
    Only run commands matching this control ID prefix (e.g. "AC.L2-3.1").
#>

param(
    [switch]$SkipConnect,
    [switch]$NoPrompt,
    [string]$FilterEngine,
    [string]$FilterControl
)

$ErrorActionPreference = 'Continue'
$global:entryIndex = 0
$global:passCount = 0
$global:failCount = 0
$global:skipCount = 0
$global:totalEntries = 186

# ─── Helpers ────────────────────────────────────────────────────

function Write-EntryHeader {
    param([string]$Id, [string]$Label, [string]$Controls, [string]$Engine, [int]$Index, [int]$Total)
    Write-Host ""
    Write-Host ("=" * 80) -ForegroundColor DarkGray
    Write-Host "[$Index/$Total] " -NoNewline -ForegroundColor Cyan
    Write-Host "$Id" -NoNewline -ForegroundColor Yellow
    Write-Host " ($Engine)" -ForegroundColor DarkGray
    if ($Label) { Write-Host "  $Label" -ForegroundColor White }
    if ($Controls) { Write-Host "  Controls: $Controls" -ForegroundColor DarkGray }
    Write-Host ("-" * 80) -ForegroundColor DarkGray
}

function Wait-ForSpace {
    if ($NoPrompt) { return $true }
    Write-Host ""
    Write-Host "  Press: [SPACE] run  |  [S] skip  |  [Q] quit" -ForegroundColor DarkCyan
    while ($true) {
        $key = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
        switch ($key.Character) {
            ' '  { return $true }
            's'  { return $false }
            'S'  { return $false }
            'q'  {
                Write-Host "`nAborted by user." -ForegroundColor Red
                Show-Summary
                exit 0
            }
            'Q'  {
                Write-Host "`nAborted by user." -ForegroundColor Red
                Show-Summary
                exit 0
            }
        }
    }
}

function Invoke-RegistryGet {
    param([string]$Command, [string]$EntryId)
    Write-Host "  > $Command" -ForegroundColor Gray
    try {
        $result = Invoke-Expression $Command
        if ($null -eq $result -or ($result -is [array] -and $result.Count -eq 0)) {
            Write-Host "  RESULT: (empty / not found)" -ForegroundColor DarkYellow
            $global:failCount++
        } else {
            Write-Host "  RESULT:" -ForegroundColor Green
            $result | Format-List | Out-String -Width 120 | ForEach-Object { Write-Host "  $_" -ForegroundColor White }
            $global:passCount++
        }
    } catch {
        Write-Host "  ERROR: $($_.Exception.Message)" -ForegroundColor Red
        $global:failCount++
    }
}

function Show-Summary {
    Write-Host ""
    Write-Host ("=" * 80) -ForegroundColor Cyan
    Write-Host "  EVIDENCE COLLECTION SUMMARY" -ForegroundColor Cyan
    Write-Host ("=" * 80) -ForegroundColor Cyan
    Write-Host "  Passed:  $($global:passCount)" -ForegroundColor Green
    Write-Host "  Failed:  $($global:failCount)" -ForegroundColor Red
    Write-Host "  Skipped: $($global:skipCount)" -ForegroundColor Yellow
    Write-Host "  Total:   $($global:entryIndex) / $($global:totalEntries)" -ForegroundColor White
    Write-Host ("=" * 80) -ForegroundColor Cyan
}

# ─── Connections (GCC High) ─────────────────────────────────────

if (-not $SkipConnect) {
    Write-Host "`n  Connecting to GCC High services...`n" -ForegroundColor Cyan

    # 1. Microsoft Graph
    Write-Host "  [1/6] Microsoft Graph..." -ForegroundColor Yellow
    Connect-MgGraph -TenantId 'bbe08772-8fde-4e55-961a-8a43779e7d58' -Scopes 'User.Read.All','Group.Read.All','Policy.Read.All','RoleManagement.Read.All','Directory.Read.All','DeviceManagementConfiguration.Read.All','Agreement.Read.All' -Environment USGov
    Write-Host "  Done." -ForegroundColor Green

    # 2. Exchange Online
    Write-Host "  [2/6] Exchange Online..." -ForegroundColor Yellow
    Connect-ExchangeOnline -ExchangeEnvironmentName O365USGovGCCHigh -ShowBanner:$false
    Write-Host "  Done." -ForegroundColor Green

    # 3. Security & Compliance (IPPS)
    Write-Host "  [3/6] Security & Compliance..." -ForegroundColor Yellow
    Connect-IPPSSession -ConnectionUri 'https://ps.compliance.protection.office365.us/powershell-liveid/' -AzureADAuthorizationEndpointUri 'https://login.microsoftonline.us/common'
    Write-Host "  Done." -ForegroundColor Green

    # 4. Microsoft Teams
    Write-Host "  [4/6] Microsoft Teams..." -ForegroundColor Yellow
    Connect-MicrosoftTeams -TeamsEnvironmentName TeamsGCCH
    Write-Host "  Done." -ForegroundColor Green

    # 5. SharePoint Online (PnP)
    Write-Host "  [5/6] SharePoint Online..." -ForegroundColor Yellow
    Connect-PnPOnline -Url 'https://vfsgov.us-admin.sharepoint.us' -Interactive
    Write-Host "  Done." -ForegroundColor Green

    # 6. Azure
    Write-Host "  [6/6] Azure..." -ForegroundColor Yellow
    Connect-AzAccount -Environment AzureUSGovernment -TenantId 'bbe08772-8fde-4e55-961a-8a43779e7d58' -SubscriptionId '668a730f-12a1-4c80-9734-89c621e98115'
    Write-Host "  Done." -ForegroundColor Green

    Write-Host "`n  All services connected.`n" -ForegroundColor Green
}


# ======================================================================
#  MICROSOFT GRAPH — 82 entries
# ======================================================================

if (-not $FilterEngine -or $FilterEngine -eq 'mgraph') {
Write-Host "`n>>> Microsoft Graph (82 entries) <<<`n" -ForegroundColor Magenta


$global:entryIndex++
if (-not $FilterControl -or 'AC.L1-3.1.1, AC.L1-3.1.2, AC.L2-3.1.7' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AC.L2-3.1.1.operator-discover' -Label 'Discover Operator User ID' -Controls 'AC.L1-3.1.1, AC.L1-3.1.2, AC.L2-3.1.7' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-MgUser -Filter "userPrincipalName eq ''operator@vfsgov.us''"' -EntryId 'AC.L2-3.1.1.operator-discover'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AC.L2-3.1.7' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AC.L2-3.1.7.pim-roles-eligible' -Label 'PIM Eligible Role Assignments for Privileged Users' -Controls 'AC.L2-3.1.7' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-MgRoleManagementDirectoryRoleEligibilitySchedule -All | Where-Object { $_.RoleDefinitionId -in @(''<globalAdminRoleDefId>'', ''<privilegedRoleAdminDefId>'', ''<securityAdminRoleDefId>'') } | Select-Object PrincipalId,RoleDefinitionId,Status,DirectoryScopeId' -EntryId 'AC.L2-3.1.7.pim-roles-eligible'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AC.L2-3.1.7' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AC.L2-3.1.7.pim-roles-permanent' -Label 'Verify No Permanent Privileged Role Assignments' -Controls 'AC.L2-3.1.7' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-MgRoleManagementDirectoryRoleAssignmentSchedule -All | Where-Object { $_.RoleDefinitionId -in @(''<globalAdminRoleDefId>'', ''<privilegedRoleAdminDefId>'', ''<securityAdminRoleDefId>'') -and $_.ScheduleInfo.Expiration.Type -eq ''noExpiration'' } | Select-Object PrincipalId,RoleDefinitionId,Status,DirectoryScopeId' -EntryId 'AC.L2-3.1.7.pim-roles-permanent'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AC.L1-3.1.1' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AC.L1-3.1.1.ca-policy-evidence' -Label 'Verify Conditional Access Policies Enforce Authorized Access' -Controls 'AC.L1-3.1.1' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-MgIdentityConditionalAccessPolicy | Where-Object {$_.State -eq ''enabled''} | Select-Object DisplayName,State' -EntryId 'AC.L1-3.1.1.ca-policy-evidence'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AC.L1-3.1.2' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AC.L1-3.1.2.rbac-evidence' -Label 'Verify Directory Role Assignments Limit Functions' -Controls 'AC.L1-3.1.2' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-MgDirectoryRole | Select-Object DisplayName,Id' -EntryId 'AC.L1-3.1.2.rbac-evidence'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AC.L1-3.1.20' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AC.L1-3.1.20.cross-tenant-evidence' -Label 'Verify Cross-Tenant Access Restrictions' -Controls 'AC.L1-3.1.20' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-MgPolicyCrossTenantAccessPolicyDefault | Select-Object B2BCollaborationInbound,B2BCollaborationOutbound' -EntryId 'AC.L1-3.1.20.cross-tenant-evidence'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AC.L2-3.1.17' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AC.L2-3.1.17.wireless-profile-evidence' -Label 'Verify Intune Wi-Fi Configuration Profiles Enforce WPA2/3' -Controls 'AC.L2-3.1.17' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-MgDeviceManagementDeviceConfiguration | Where-Object {''#microsoft.graph.windowsWifiConfiguration'' -eq $_.AdditionalProperties.''@odata.type'' -or ''#microsoft.graph.iosWiFiConfiguration'' -eq $_.AdditionalProperties.''@odata.type''} | Select-Object DisplayName,Id' -EntryId 'AC.L2-3.1.17.wireless-profile-evidence'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AU.L2-3.3.7' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AU.L2-3.3.7.time-source' -Label 'Authoritative Time Source Verification (Platform Inherited)' -Controls 'AU.L2-3.3.7' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command '(Invoke-MgGraphRequest -Uri ''https://graph.microsoft.us/v1.0/organization'').value | Select-Object displayName,createdDateTime,verifiedDomains' -EntryId 'AU.L2-3.3.7.time-source'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'CM.L2-3.4.3' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'CM.L2-3.4.3.change-tracking' -Label 'Configuration Change Tracking Evidence via Intune Audit Log' -Controls 'CM.L2-3.4.3' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-MgAuditLogDirectoryAudit -Filter "loggedByService eq ''Intune''" -All -Top 200 | Select-Object ActivityDisplayName,ActivityDateTime,InitiatedBy' -EntryId 'CM.L2-3.4.3.change-tracking'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AC.L1-3.1.1' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-ID-001' -Label 'Break-Glass Emergency Account' -Controls 'AC.L1-3.1.1' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-MgUser -Filter "userPrincipalName eq ''breakglass@vfsgov.us''" | Select-Object Id,DisplayName,UserPrincipalName,AccountEnabled | ConvertTo-Json -Depth 10' -EntryId 'AZ-ID-001'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'IA.L1-3.5.1' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'IA.L1-3.5.1.identity-evidence' -Label 'Verify User and Device Identity Management' -Controls 'IA.L1-3.5.1' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-MgUser -Top 1 -Property Id,DisplayName,UserPrincipalName,AccountEnabled | Select-Object Id' -EntryId 'IA.L1-3.5.1.identity-evidence'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AC.L1-3.1.1, AC.L2-3.1.5' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-ID-002' -Label 'Operator Admin Account' -Controls 'AC.L1-3.1.1, AC.L2-3.1.5' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-MgUser -Filter "userPrincipalName eq ''operator@vfsgov.us''" | Select-Object Id,DisplayName,UserPrincipalName,AccountEnabled | ConvertTo-Json -Depth 10' -EntryId 'AZ-ID-002'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'IA.L1-3.5.2' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'IA.L1-3.5.2.auth-methods-evidence' -Label 'Verify Authentication Methods Policy' -Controls 'IA.L1-3.5.2' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-MgPolicyAuthenticationMethodPolicy | Select-Object Id,Description' -EntryId 'IA.L1-3.5.2.auth-methods-evidence'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AC.L1-3.1.1, SC.L1-3.13.1' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-ID-003' -Label 'EO Automation Service Principal' -Controls 'AC.L1-3.1.1, SC.L1-3.13.1' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-MgServicePrincipal -Filter "appId eq ''<appId>''" | Select-Object Id,DisplayName,AppId | ConvertTo-Json -Depth 10' -EntryId 'AZ-ID-003'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'IA.L2-3.5.11' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'IA.L2-3.5.11.branding' -Label 'Login Page Branding Evidence (Password Obscured by Platform)' -Controls 'IA.L2-3.5.11' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-MgOrganizationBranding -OrganizationId ''bbe08772-8fde-4e55-961a-8a43779e7d58''' -EntryId 'IA.L2-3.5.11.branding'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AC.L1-3.1.1' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-ID-004' -Label 'Security Defaults Disabled' -Controls 'AC.L1-3.1.1' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-MgPolicyIdentitySecurityDefaultEnforcementPolicy | Select-Object IsEnabled' -EntryId 'AZ-ID-004'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AC.L2-3.1.5, AC.L2-3.1.7' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-ID-005' -Label 'PIM Eligible Role Assignment for Operator' -Controls 'AC.L2-3.1.5, AC.L2-3.1.7' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-MgRoleManagementDirectoryRoleEligibilitySchedule -All | Select-Object PrincipalId,RoleDefinitionId,Status' -EntryId 'AZ-ID-005'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'MA.L2-3.7.4' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'MA.L2-3.7.4.media-check' -Label 'Media Malware Check via Defender AV Evidence' -Controls 'MA.L2-3.7.4' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command '(Invoke-MgGraphRequest -Uri ''https://graph.microsoft.us/v1.0/deviceManagement/deviceCompliancePolicies'').value | Where-Object displayName -like ''*Defender*'' | Select-Object displayName,createdDateTime' -EntryId 'MA.L2-3.7.4.media-check'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'MP.L2-3.8.5, SC.L2-3.13.4' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'MP.L2-3.8.5.media-access' -Label 'CUI Media Access Control via Intune Removable Storage Policy' -Controls 'MP.L2-3.8.5, SC.L2-3.13.4' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command '(Invoke-MgGraphRequest -Uri ''https://graph.microsoft.us/v1.0/deviceManagement/deviceConfigurations'').value | Where-Object { $_.displayName -like ''*Removable*'' -or $_.displayName -like ''*Storage*'' } | Select-Object displayName,createdDateTime' -EntryId 'MP.L2-3.8.5.media-access'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'MP.L2-3.8.7' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'MP.L2-3.8.7.removable-media-intune' -Label 'Verify Intune Removable Storage Restriction Policy' -Controls 'MP.L2-3.8.7' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-MgDeviceManagementDeviceConfiguration | Where-Object {$_.AdditionalProperties.''@odata.type'' -like ''*deviceRestriction*''} | Where-Object { $_.displayName -like ''*Removable*'' -or $_.displayName -like ''CMMC*'' } | Select-Object DisplayName,Id' -EntryId 'MP.L2-3.8.7.removable-media-intune'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'MP.L2-3.8.8' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'MP.L2-3.8.8.unowned-storage-intune' -Label 'Verify Intune Policy Prohibiting Unidentified Portable Storage' -Controls 'MP.L2-3.8.8' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-MgDeviceManagementDeviceConfiguration | Where-Object {$_.AdditionalProperties.''@odata.type'' -like ''*deviceRestriction*''} | Select-Object DisplayName,Id' -EntryId 'MP.L2-3.8.8.unowned-storage-intune'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'PS.L2-3.9.2' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'PS.L2-3.9.2.termination' -Label 'Personnel Termination and Transfer Account Disable Evidence' -Controls 'PS.L2-3.9.2' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-MgUser -Filter ''accountEnabled eq false'' -All | Select-Object DisplayName,UserPrincipalName,DeletedDateTime' -EntryId 'PS.L2-3.9.2.termination'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SI.L1-3.14.1' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'SI.L1-3.14.1.flaw-remediation-evidence' -Label 'Verify Defender Vulnerability Management Configuration' -Controls 'SI.L1-3.14.1' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-MgDeviceManagementDeviceCompliancePolicy | Where-Object {$_.AdditionalProperties.''@odata.type'' -like ''*windows10*''} | Select-Object DisplayName,Id' -EntryId 'SI.L1-3.14.1.flaw-remediation-evidence'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SI.L1-3.14.2' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'SI.L1-3.14.2.malware-protection-evidence' -Label 'Verify Defender Antimalware Policy Configuration' -Controls 'SI.L1-3.14.2' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-MgDeviceManagementDeviceConfiguration | Where-Object {$_.AdditionalProperties.''@odata.type'' -like ''*endpointProtection*'' -or $_.AdditionalProperties.''@odata.type'' -like ''*antivirus*''} | Where-Object displayName -like ''CMMC*'' | Select-Object DisplayName,Id' -EntryId 'SI.L1-3.14.2.malware-protection-evidence'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L1-3.13.1' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'SC.L1-3.13.1.conditional-access-boundary' -Label 'Collect Conditional Access Policies for Boundary Protection' -Controls 'SC.L1-3.13.1' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-MgIdentityConditionalAccessPolicy | Where-Object {$_.State -eq ''enabled''} | Select-Object DisplayName,Id' -EntryId 'SC.L1-3.13.1.conditional-access-boundary'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SI.L1-3.14.4' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'SI.L1-3.14.4.av-update-evidence' -Label 'Verify Defender Automatic Update Configuration' -Controls 'SI.L1-3.14.4' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-MgDeviceManagementDeviceConfiguration | Where-Object {$_.AdditionalProperties.''@odata.type'' -like ''*windowsUpdateForBusiness*''} | Select-Object DisplayName,Id' -EntryId 'SI.L1-3.14.4.av-update-evidence'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SI.L1-3.14.5' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'SI.L1-3.14.5.scan-schedule-evidence' -Label 'Verify Defender Scheduled and Real-Time Scan Configuration' -Controls 'SI.L1-3.14.5' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-MgDeviceManagementDeviceConfiguration | Where-Object {$_.AdditionalProperties.''@odata.type'' -like ''*endpointProtection*''} | Select-Object DisplayName,Id' -EntryId 'SI.L1-3.14.5.scan-schedule-evidence'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AC.L1-3.1.1' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AC.L2-3.1.1.group-create' -Label 'Create CUI Security Group' -Controls 'AC.L1-3.1.1' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-MgGroup -Filter "displayName eq ''cui-users-sg''"' -EntryId 'AC.L2-3.1.1.group-create'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AC.L1-3.1.1' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AC.L2-3.1.1.member-add' -Label 'Add User to CUI Security Group' -Controls 'AC.L1-3.1.1' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-MgGroupMember -GroupId <cuiGroupId> | Where-Object { $_.Id -eq ''<operatorUserId>'' }' -EntryId 'AC.L2-3.1.1.member-add'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AC.L2-3.1.6' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AC.L2-3.1.6.admin-account' -Label 'Create Dedicated Admin Account' -Controls 'AC.L2-3.1.6' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-MgUser -Filter "displayName eq ''Admin-admin@vfsgov.us''"' -EntryId 'AC.L2-3.1.6.admin-account'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'IA.L2-3.5.5, IA.L2-3.5.6' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'IA.L2-3.5.5.disable-inactive' -Label 'Disable Inactive Accounts Inactive 90+ Days' -Controls 'IA.L2-3.5.5, IA.L2-3.5.6' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-MgUser -Filter ''accountEnabled eq true'' -All | Select-Object DisplayName,UserPrincipalName,SignInActivity' -EntryId 'IA.L2-3.5.5.disable-inactive'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AC.L2-3.1.3' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AC.L2-3.1.3.service-account' -Label 'Service Principal Account Evidence for CUI Flow Control' -Controls 'AC.L2-3.1.3' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-MgServicePrincipal -Filter "displayName eq ''EvidenceOps-Automation''" -All | Select-Object DisplayName,AppId,ServicePrincipalType,AccountEnabled | ConvertTo-Json -Depth 2' -EntryId 'AC.L2-3.1.3.service-account'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AC.L2-3.1.4' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AC.L2-3.1.4.pim-policy-get' -Label 'Get PIM Policy for Compliance Admin Role' -Controls 'AC.L2-3.1.4' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command '$roleId = (Get-MgRoleManagementDirectoryRoleDefinition -Filter "displayName eq ''Compliance Administrator''").Id; $assignment = Get-MgPolicyRoleManagementPolicyAssignment -Filter "scopeId eq ''/'' and scopeType eq ''DirectoryRole'' and roleDefinitionId eq ''$roleId''" | Select-Object -First 1; Get-MgPolicyRoleManagementPolicy -UnifiedRoleManagementPolicyId $assignment.PolicyId | Select-Object Id,DisplayName | ConvertTo-Json -Depth 10' -EntryId 'AC.L2-3.1.4.pim-policy-get'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AC.L2-3.1.2' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AC.L2-3.1.2.role-assign' -Label 'RBAC Role Assignment' -Controls 'AC.L2-3.1.2' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-MgRoleManagementDirectoryRoleAssignment -Filter "principalId eq ''<operatorUserId>'' and roleDefinitionId eq ''194ae4cb-b126-40b2-bd5b-6091b380977d''"' -EntryId 'AC.L2-3.1.2.role-assign'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AC.L2-3.1.4' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AC.L2-3.1.4.pim-approval' -Label 'PIM Separation of Duties - Require Approval' -Controls 'AC.L2-3.1.4' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-MgPolicyRoleManagementPolicyRule -UnifiedRoleManagementPolicyId <pimPolicyId>' -EntryId 'AC.L2-3.1.4.pim-approval'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AU.L2-3.3.8, AU.L2-3.3.9' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AU.L2-3.3.8.audit-protect' -Label 'Audit Log Access Restriction - Compliance Admin Role Evidence' -Controls 'AU.L2-3.3.8, AU.L2-3.3.9' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-MgRoleManagementDirectoryRoleAssignment -Filter "roleDefinitionId eq ''<complianceRoleId>''" -All' -EntryId 'AU.L2-3.3.8.audit-protect'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'CM.L2-3.4.5' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'CM.L2-3.4.5.access-restrict' -Label 'Access Restriction for Configuration Changes Evidence' -Controls 'CM.L2-3.4.5' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-MgRoleManagementDirectoryRoleDefinition -Filter "displayName eq ''Intune Administrator''" | ForEach-Object { Get-MgRoleManagementDirectoryRoleAssignment -Filter "roleDefinitionId eq ''$($_.Id)''" -All }' -EntryId 'CM.L2-3.4.5.access-restrict'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AC.L2-3.1.5, AC.L2-3.1.7, SC.L2-3.13.3' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AC.L2-3.1.5.pim-eligible' -Label 'PIM JIT Eligible Role Assignment' -Controls 'AC.L2-3.1.5, AC.L2-3.1.7, SC.L2-3.13.3' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-MgRoleManagementDirectoryRoleEligibilitySchedule -All | Select-Object PrincipalId,RoleDefinitionId,Status,DirectoryScopeId' -EntryId 'AC.L2-3.1.5.pim-eligible'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AC.L2-3.1.12' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AC.L2-3.1.12.named-location' -Label 'Create Approved CUI Named Location (IP Range)' -Controls 'AC.L2-3.1.12' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-MgIdentityConditionalAccessNamedLocation -Filter "displayName eq ''Approved-CUI-Networks''"' -EntryId 'AC.L2-3.1.12.named-location'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AC.L2-3.1.8' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AC.L2-3.1.8.smart-lockout' -Label 'Smart Lockout Configuration Evidence' -Controls 'AC.L2-3.1.8' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Invoke-MgGraphRequest -Uri ''https://graph.microsoft.us/v1.0/policies/authenticationMethodsPolicy'' | ConvertTo-Json -Depth 10' -EntryId 'AC.L2-3.1.8.smart-lockout'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AC.L2-3.1.9' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AC.L2-3.1.9.terms-of-use' -Label 'Create CUI Terms of Use Agreement' -Controls 'AC.L2-3.1.9' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-MgAgreement -Filter "displayName eq ''CUI System Access Notice''"' -EntryId 'AC.L2-3.1.9.terms-of-use'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'IA.L1-3.5.1, IA.L1-3.5.2' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'IA.L2-3.5.1.user-identify' -Label 'User and Device Identification Evidence' -Controls 'IA.L1-3.5.1, IA.L1-3.5.2' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-MgUser -Filter ''accountEnabled eq true'' -All | Select-Object DisplayName,UserPrincipalName' -EntryId 'IA.L2-3.5.1.user-identify'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'IA.L2-3.5.3' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'IA.L2-3.5.3.mfa-authenticator' -Label 'Enable Microsoft Authenticator Authentication Method' -Controls 'IA.L2-3.5.3' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Invoke-MgGraphRequest -Uri ''https://graph.microsoft.us/v1.0/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/MicrosoftAuthenticator'' | ConvertTo-Json -Depth 10' -EntryId 'IA.L2-3.5.3.mfa-authenticator'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'IA.L2-3.5.8' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'IA.L2-3.5.8.password-reuse' -Label 'Password Reuse Prevention Evidence' -Controls 'IA.L2-3.5.8' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-MgDomain -DomainId ''vfsgov.us'' | Select-Object PasswordValidityPeriodInDays' -EntryId 'IA.L2-3.5.8.password-reuse'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'MA.L2-3.7.5' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'MA.L2-3.7.5.remote-mfa' -Label 'MFA for Remote Maintenance via Conditional Access' -Controls 'MA.L2-3.7.5' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-MgIdentityConditionalAccessPolicy | Where-Object DisplayName -like ''CMMC-RemoteMaintenance*'' | Select-Object DisplayName,State,CreatedDateTime' -EntryId 'MA.L2-3.7.5.remote-mfa'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AC.L2-3.1.11' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AC.L2-3.1.11.session-timeout' -Label 'Conditional Access - Session Timeout and No Persistent Browser' -Controls 'AC.L2-3.1.11' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-MgIdentityConditionalAccessPolicy -Filter "displayName eq ''CMMC-SessionTimeout''"' -EntryId 'AC.L2-3.1.11.session-timeout'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'IA.L2-3.5.3' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'IA.L2-3.5.3.fido2-enable' -Label 'Enable FIDO2 Security Key Authentication Method' -Controls 'IA.L2-3.5.3' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Invoke-MgGraphRequest -Uri ''https://graph.microsoft.us/v1.0/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/Fido2'' | ConvertTo-Json -Depth 10' -EntryId 'IA.L2-3.5.3.fido2-enable'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AC.L2-3.1.14, SC.L2-3.13.7' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AC.L2-3.1.14.block-untrusted' -Label 'Conditional Access - Block Untrusted Network Locations' -Controls 'AC.L2-3.1.14, SC.L2-3.13.7' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-MgIdentityConditionalAccessPolicy -Filter "displayName eq ''CMMC-BlockUntrustedLocations''"' -EntryId 'AC.L2-3.1.14.block-untrusted'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'IA.L2-3.5.4' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'IA.L2-3.5.4.auth-strength' -Label 'Create Phishing-Resistant Authentication Strength Policy' -Controls 'IA.L2-3.5.4' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-MgPolicyAuthenticationStrengthPolicy -All | Where-Object DisplayName -like ''CMMC-Phishing*''' -EntryId 'IA.L2-3.5.4.auth-strength'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AC.L2-3.1.15' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AC.L2-3.1.15.admin-mfa' -Label 'Conditional Access - Admin MFA Phishing-Resistant' -Controls 'AC.L2-3.1.15' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-MgIdentityConditionalAccessPolicy -Filter "displayName eq ''CMMC-AdminMFA-PhishingResistant''"' -EntryId 'AC.L2-3.1.15.admin-mfa'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'IA.L2-3.5.7' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'IA.L2-3.5.7.password-protection' -Label 'Enable Azure AD Password Protection and Banned Password List' -Controls 'IA.L2-3.5.7' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Invoke-MgGraphRequest -Uri ''https://graph.microsoft.us/v1.0/policies/authenticationMethodsPolicy'' | ConvertTo-Json -Depth 10' -EntryId 'IA.L2-3.5.7.password-protection'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AC.L2-3.1.18' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AC.L2-3.1.18.mobile-ca' -Label 'Conditional Access - Mobile Device Compliance Requirement' -Controls 'AC.L2-3.1.18' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-MgIdentityConditionalAccessPolicy -Filter "displayName eq ''CMMC-MobileDeviceAccess''"' -EntryId 'AC.L2-3.1.18.mobile-ca'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'IA.L2-3.5.9' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'IA.L2-3.5.9.tap-config' -Label 'Configure Temporary Access Pass (One-Time Use, 60 Minutes)' -Controls 'IA.L2-3.5.9' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Invoke-MgGraphRequest -Uri ''https://graph.microsoft.us/v1.0/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/TemporaryAccessPass'' | ConvertTo-Json -Depth 10' -EntryId 'IA.L2-3.5.9.tap-config'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AC.L1-3.1.20' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AC.L2-3.1.20.guest-restrict' -Label 'Restrict Guest Invitations via Authorization Policy' -Controls 'AC.L1-3.1.20' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-MgPolicyAuthorizationPolicy | Select-Object AllowInvitesFrom' -EntryId 'AC.L2-3.1.20.guest-restrict'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'IA.L2-3.5.10' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'IA.L2-3.5.10.cert-auth' -Label 'Enable Certificate-Based Authentication Method' -Controls 'IA.L2-3.5.10' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Invoke-MgGraphRequest -Uri ''https://graph.microsoft.us/v1.0/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/x509Certificate'' | ConvertTo-Json -Depth 10' -EntryId 'IA.L2-3.5.10.cert-auth'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L2-3.13.4' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'SC.L2-3.13.4.remote-access' -Label 'Conditional Access Policy for Remote Access Sessions' -Controls 'SC.L2-3.13.4' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-MgPolicyConditionalAccessPolicy -All | Where-Object { $_.DisplayName -like ''*Remote*'' -or $_.DisplayName -like ''*VPN*'' } | Select-Object DisplayName,State,Conditions,GrantControls | ConvertTo-Json -Depth 3' -EntryId 'SC.L2-3.13.4.remote-access'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L2-3.13.2' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'SC.L2-3.13.2.session-lock' -Label 'Intune Screen Lock / Session Lock Policy Evidence' -Controls 'SC.L2-3.13.2' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Invoke-MgGraphRequest -Uri ''https://graph.microsoft.us/v1.0/deviceManagement/deviceConfigurations?$filter=displayName eq ''''CMMC-Screen-Lock-Policy'''''' | ConvertTo-Json -Depth 5' -EntryId 'SC.L2-3.13.2.session-lock'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AC.L2-3.1.10, SC.L2-3.13.9' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AC.L2-3.1.10.screen-lock' -Label 'Deploy Screen Lock / Session Timeout Intune Policy' -Controls 'AC.L2-3.1.10, SC.L2-3.13.9' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command '(Invoke-MgGraphRequest -Uri ''https://graph.microsoft.us/v1.0/deviceManagement/deviceConfigurations'').value | Where-Object displayName -like ''CMMC-ScreenLock*''' -EntryId 'AC.L2-3.1.10.screen-lock'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AC.L2-3.1.16' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AC.L2-3.1.16.wifi-profile' -Label 'Deploy WPA2-Enterprise WiFi Profile via Intune' -Controls 'AC.L2-3.1.16' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command '(Invoke-MgGraphRequest -Uri ''https://graph.microsoft.us/v1.0/deviceManagement/deviceConfigurations'').value | Where-Object { $_.displayName -eq ''CMMC-WiFi-Secure'' }' -EntryId 'AC.L2-3.1.16.wifi-profile'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'CM.L2-3.4.7' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'CM.L2-3.4.7.wdac' -Label 'WDAC Application Control Policy via Intune' -Controls 'CM.L2-3.4.7' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command '(Invoke-MgGraphRequest -Uri ''https://graph.microsoft.us/v1.0/deviceManagement/deviceConfigurations'').value | Where-Object displayName -like ''CMMC-AppControl*'' | Select-Object displayName,createdDateTime' -EntryId 'CM.L2-3.4.7.wdac'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'CM.L2-3.4.8' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'CM.L2-3.4.8.detected-apps' -Label 'Detected Applications Inventory Evidence via Intune' -Controls 'CM.L2-3.4.8' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command '(Invoke-MgGraphRequest -Uri ''https://graph.microsoft.us/v1.0/deviceManagement/detectedApps'').value | Select-Object displayName,version,deviceCount' -EntryId 'CM.L2-3.4.8.detected-apps'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'CM.L2-3.4.9' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'CM.L2-3.4.9.install-control' -Label 'User Software Installation Control via Intune' -Controls 'CM.L2-3.4.9' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command '(Invoke-MgGraphRequest -Uri ''https://graph.microsoft.us/v1.0/deviceManagement/deviceConfigurations'').value | Where-Object displayName -like ''CMMC-InstallControl*'' | Select-Object displayName,createdDateTime' -EntryId 'CM.L2-3.4.9.install-control'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'RA.L2-3.11.3' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'RA.L2-3.11.3.vuln-remediation' -Label 'Vulnerability Remediation via Windows Update for Business Rings' -Controls 'RA.L2-3.11.3' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command '(Invoke-MgGraphRequest -Uri ''https://graph.microsoft.us/v1.0/deviceManagement/deviceConfigurations'').value | Where-Object ''@odata.type'' -eq ''#microsoft.graph.windowsUpdateForBusinessConfiguration'' | Select-Object displayName,createdDateTime' -EntryId 'RA.L2-3.11.3.vuln-remediation'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L2-3.13.11' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'SC.L2-3.13.11.fips' -Label 'FIPS 140-2 Compliance Verification (Platform Inherited)' -Controls 'SC.L2-3.13.11' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command '(Invoke-MgGraphRequest -Uri ''https://graph.microsoft.us/v1.0/organization'').value | Select-Object displayName,tenantType' -EntryId 'SC.L2-3.13.11.fips'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SI.L1-3.14.4' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'SI.L2-3.14.4.av-signatures' -Label 'Antivirus Signature Currency Evidence via Intune' -Controls 'SI.L1-3.14.4' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command '(Invoke-MgGraphRequest -Uri ''https://graph.microsoft.us/v1.0/deviceManagement/managedDevices'').value | Select-Object deviceName,antivirusSignatureUpdateOverdue' -EntryId 'SI.L2-3.14.4.av-signatures'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SI.L1-3.14.5' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'SI.L2-3.14.5.scan-schedule' -Label 'Scheduled Malware Scan Evidence via Intune Managed Devices' -Controls 'SI.L1-3.14.5' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command '(Invoke-MgGraphRequest -Uri ''https://graph.microsoft.us/v1.0/deviceManagement/managedDevices?$select=deviceName,lastSyncDateTime,complianceState'').value' -EntryId 'SI.L2-3.14.5.scan-schedule'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AC.L2-3.1.19' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AC.L2-3.1.19.ios-mam' -Label 'Deploy iOS MAM App Protection Policy' -Controls 'AC.L2-3.1.19' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Invoke-MgGraphRequest -Uri ''https://graph.microsoft.us/v1.0/deviceAppManagement/iosManagedAppProtections'' | ConvertTo-Json -Depth 10' -EntryId 'AC.L2-3.1.19.ios-mam'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AC.L2-3.1.21' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AC.L2-3.1.21.block-storage' -Label 'Block Removable Storage via Intune Device Configuration' -Controls 'AC.L2-3.1.21' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command '(Invoke-MgGraphRequest -Uri ''https://graph.microsoft.us/v1.0/deviceManagement/deviceConfigurations'').value | Where-Object displayName -eq ''CMMC-BlockRemovableStorage''' -EntryId 'AC.L2-3.1.21.block-storage'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'CM.L2-3.4.1' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'CM.L2-3.4.1.security-baseline' -Label 'Deploy Windows Security Baseline via Intune Template' -Controls 'CM.L2-3.4.1' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command '(Invoke-MgGraphRequest -Uri ''https://graph.microsoft.us/beta/deviceManagement/intents'').value | Where-Object displayName -eq ''CMMC-Win11-Baseline''' -EntryId 'CM.L2-3.4.1.security-baseline'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'CM.L2-3.4.2' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'CM.L2-3.4.2.asr-rules' -Label 'Deploy Attack Surface Reduction Rules via Intune Configuration Policy' -Controls 'CM.L2-3.4.2' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command '(Invoke-MgGraphRequest -Uri ''https://graph.microsoft.us/beta/deviceManagement/configurationPolicies'').value | Where-Object name -like ''CMMC-ASR*''' -EntryId 'CM.L2-3.4.2.asr-rules'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'CM.L2-3.4.6' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'CM.L2-3.4.6.least-functionality' -Label 'Enforce Least Functionality - Disable Cortana and MSIA' -Controls 'CM.L2-3.4.6' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command '(Invoke-MgGraphRequest -Uri ''https://graph.microsoft.us/v1.0/deviceManagement/deviceConfigurations'').value | Where-Object displayName -eq ''CMMC-LeastFunctionality''' -EntryId 'CM.L2-3.4.6.least-functionality'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'MA.L2-3.7.1, MA.L2-3.7.2' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'MA.L2-3.7.1.update-ring' -Label 'Deploy Windows Update for Business Ring via Intune' -Controls 'MA.L2-3.7.1, MA.L2-3.7.2' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command '(Invoke-MgGraphRequest -Uri ''https://graph.microsoft.us/v1.0/deviceManagement/deviceConfigurations'').value | Where-Object ''@odata.type'' -like ''*UpdateForBusiness*''' -EntryId 'MA.L2-3.7.1.update-ring'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'MP.L2-3.8.6' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'MP.L2-3.8.6.bitlocker' -Label 'Deploy BitLocker Drive Encryption Policy via Intune' -Controls 'MP.L2-3.8.6' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command '(Invoke-MgGraphRequest -Uri ''https://graph.microsoft.us/v1.0/deviceManagement/managedDevices?$filter=operatingSystem eq ''''Windows'''''').value | Select-Object deviceName,isEncrypted,complianceState' -EntryId 'MP.L2-3.8.6.bitlocker'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L2-3.13.12' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'SC.L2-3.13.12.camera-block' -Label 'Block Camera and Collaborative Devices via Intune Policy' -Controls 'SC.L2-3.13.12' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command '(Invoke-MgGraphRequest -Uri ''https://graph.microsoft.us/v1.0/deviceManagement/deviceConfigurations'').value | Where-Object displayName -eq ''CMMC-CollaborativeDeviceBlock''' -EntryId 'SC.L2-3.13.12.camera-block'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L2-3.13.16' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'SC.L2-3.13.16.data-at-rest' -Label 'CUI Data-at-Rest Protection Evidence (Labels + BitLocker)' -Controls 'SC.L2-3.13.16' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command '(Invoke-MgGraphRequest -Uri ''https://graph.microsoft.us/v1.0/deviceManagement/managedDevices'').value | Select-Object deviceName,isEncrypted,complianceState' -EntryId 'SC.L2-3.13.16.data-at-rest'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AU.L2-3.3.2' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AU.L2-3.3.2.signin-logs' -Label 'Sign-In and Directory Audit Log Evidence' -Controls 'AU.L2-3.3.2' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-MgAuditLogSignIn -Filter "createdDateTime ge $((Get-Date).AddDays(-30).ToString(''yyyy-MM-ddTHH:mm:ssZ''))" -All | Select-Object UserDisplayName,UserPrincipalName,AppDisplayName,Status' -EntryId 'AU.L2-3.3.2.signin-logs'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'IR.L2-3.6.3' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'IR.L2-3.6.3.attack-sim' -Label 'Launch Attack Simulation for Incident Response Testing' -Controls 'IR.L2-3.6.3' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command '(Invoke-MgGraphRequest -Uri ''https://graph.microsoft.us/v1.0/security/alerts_v2?$top=5&$orderby=createdDateTime desc'').value | Select-Object title,severity,status,createdDateTime' -EntryId 'IR.L2-3.6.3.attack-sim'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'RA.L2-3.11.1' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'RA.L2-3.11.1.secure-score' -Label 'Microsoft Secure Score Risk Assessment Evidence' -Controls 'RA.L2-3.11.1' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command '(Invoke-MgGraphRequest -Uri ''https://graph.microsoft.us/v1.0/security/secureScores'').value | Select-Object currentScore,maxScore,createdDateTime' -EntryId 'RA.L2-3.11.1.secure-score'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'RA.L2-3.11.2' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'RA.L2-3.11.2.vuln-scan' -Label 'Vulnerability Scan Results Evidence via Defender' -Controls 'RA.L2-3.11.2' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command '(Invoke-MgGraphRequest -Uri ''https://graph.microsoft.us/v1.0/deviceManagement/managedDevices?$select=deviceName,complianceState'').value | Select-Object deviceName,complianceState' -EntryId 'RA.L2-3.11.2.vuln-scan'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SI.L2-3.14.6' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'SI.L2-3.14.6.security-alerts' -Label 'Security Alert Monitoring Evidence via Defender' -Controls 'SI.L2-3.14.6' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command '(Invoke-MgGraphRequest -Uri ''https://graph.microsoft.us/v1.0/security/alerts_v2'').value | Select-Object id,title,severity,status,createdDateTime' -EntryId 'SI.L2-3.14.6.security-alerts'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'CA.L2-3.12.1, CA.L2-3.12.3' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'CA.L2-3.12.1.compliance-assess' -Label 'Compliance Assessment Evidence via Compliance Manager' -Controls 'CA.L2-3.12.1, CA.L2-3.12.3' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command '(Invoke-MgGraphRequest -Uri ''https://graph.microsoft.us/v1.0/security/secureScores?$top=1'').value | Select-Object currentScore,maxScore,createdDateTime' -EntryId 'CA.L2-3.12.1.compliance-assess'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'CA.L2-3.12.2' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'CA.L2-3.12.2.poam' -Label 'POA&M Improvement Actions Evidence via Compliance Manager' -Controls 'CA.L2-3.12.2' -Engine 'mgraph' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command '(Invoke-MgGraphRequest -Uri ''https://graph.microsoft.us/v1.0/security/secureScoreControlProfiles'').value | Select-Object id,title,implementationStatus,score,maxScore' -EntryId 'CA.L2-3.12.2.poam'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}

}


# ======================================================================
#  EXCHANGE ONLINE — 20 entries
# ======================================================================

if (-not $FilterEngine -or $FilterEngine -eq 'exchange') {
Write-Host "`n>>> Exchange Online (20 entries) <<<`n" -ForegroundColor Magenta


$global:entryIndex++
if (-not $FilterControl -or 'AU.L2-3.3.1' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AU.L2-3.3.1.org-customization' -Label 'Enable Organization Customization (Pre-requisite for Audit)' -Controls 'AU.L2-3.3.1' -Engine 'exchange' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-OrganizationConfig | Select-Object IsDehydrated' -EntryId 'AU.L2-3.3.1.org-customization'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AU.L2-3.3.1' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AU.L2-3.3.1.audit-enable' -Label 'Enable Unified Audit Log Ingestion' -Controls 'AU.L2-3.3.1' -Engine 'exchange' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AdminAuditLogConfig | Select-Object UnifiedAuditLogIngestionEnabled' -EntryId 'AU.L2-3.3.1.audit-enable'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SI.L2-3.14.6' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'SI.L2-3.14.6.spam-protection' -Label 'Anti-Spam Hosted Content Filter Policy Evidence' -Controls 'SI.L2-3.14.6' -Engine 'exchange' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-HostedContentFilterPolicy -Identity ''Default'' | Select-Object Name,IsDefault,HighConfidenceSpamAction,SpamAction,BulkThreshold | ConvertTo-Json' -EntryId 'SI.L2-3.14.6.spam-protection'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AU.L2-3.3.5' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AU.L2-3.3.5.audit-search' -Label 'Audit Log Search Evidence (Reduce/Review Capability)' -Controls 'AU.L2-3.3.5' -Engine 'exchange' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Search-UnifiedAuditLog -StartDate (Get-Date).AddDays(-7) -EndDate (Get-Date) -RecordType ExchangeAdmin -ResultSize 5000 -SessionCommand ReturnLargeSet | Select-Object CreationDate,UserIds,Operations' -EntryId 'AU.L2-3.3.5.audit-search'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'IR.L2-3.6.1' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'IR.L2-3.6.1.atp-enable' -Label 'Enable Defender for Office 365 ATP for SharePoint, Teams, and OneDrive' -Controls 'IR.L2-3.6.1' -Engine 'exchange' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AtpPolicyForO365 | Select-Object EnableATPForSPOTeamsODB' -EntryId 'IR.L2-3.6.1.atp-enable'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L2-3.13.8, AC.L2-3.1.13' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'SC.L2-3.13.8.tls-enforce' -Label 'Disable Legacy TLS Client Connections in Exchange Transport' -Controls 'SC.L2-3.13.8, AC.L2-3.1.13' -Engine 'exchange' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-TransportConfig | Select-Object AllowLegacyTLSClients' -EntryId 'SC.L2-3.13.8.tls-enforce'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'IR.L2-3.6.1' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'IR.L2-3.6.1.malware-filter' -Label 'Enable File Type Filtering in Default Malware Filter Policy' -Controls 'IR.L2-3.6.1' -Engine 'exchange' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-MalwareFilterPolicy -Identity Default | Select-Object EnableFileFilter' -EntryId 'IR.L2-3.6.1.malware-filter'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L2-3.13.13' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'SC.L2-3.13.13.safe-attach' -Label 'Create Safe Attachments Policy with Dynamic Delivery' -Controls 'SC.L2-3.13.13' -Engine 'exchange' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-SafeAttachmentPolicy -Identity ''CMMC-SafeAttach''' -EntryId 'SC.L2-3.13.13.safe-attach'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L2-3.13.13' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'SC.L2-3.13.13.safe-attach-rule' -Label 'Create Safe Attachments Rule for Primary Domain' -Controls 'SC.L2-3.13.13' -Engine 'exchange' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-SafeAttachmentRule -Identity ''CMMC-SafeAttach-Rule''' -EntryId 'SC.L2-3.13.13.safe-attach-rule'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L2-3.13.15' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'SC.L2-3.13.15.dkim' -Label 'Enable DKIM Signing for Primary Domain' -Controls 'SC.L2-3.13.15' -Engine 'exchange' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-DkimSigningConfig | Select-Object Domain,Enabled,Status' -EntryId 'SC.L2-3.13.15.dkim'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L2-3.13.15' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'SC.L2-3.13.15.anti-phish' -Label 'Create Anti-Phishing Policy with Mailbox Intelligence' -Controls 'SC.L2-3.13.15' -Engine 'exchange' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AntiPhishPolicy -Identity ''CMMC-AntiPhish''' -EntryId 'SC.L2-3.13.15.anti-phish'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L2-3.13.15' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'SC.L2-3.13.15.anti-phish-rule' -Label 'Create Anti-Phishing Rule for Primary Domain' -Controls 'SC.L2-3.13.15' -Engine 'exchange' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AntiPhishRule -Identity ''CMMC-AntiPhish-Rule''' -EntryId 'SC.L2-3.13.15.anti-phish-rule'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SI.L1-3.14.2' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'SI.L2-3.14.2.anti-malware' -Label 'Create CMMC Malware Filter Policy with File Type Rejection' -Controls 'SI.L1-3.14.2' -Engine 'exchange' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-MalwareFilterPolicy -Identity ''CMMC-Malware''' -EntryId 'SI.L2-3.14.2.anti-malware'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SI.L1-3.14.2' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'SI.L2-3.14.2.malware-rule' -Label 'Create Malware Filter Rule for Primary Domain' -Controls 'SI.L1-3.14.2' -Engine 'exchange' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-MalwareFilterRule -Identity ''CMMC-Malware-Rule''' -EntryId 'SI.L2-3.14.2.malware-rule'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SI.L2-3.14.3' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'SI.L2-3.14.3.safe-links' -Label 'Create Safe Links Policy with URL Scanning' -Controls 'SI.L2-3.14.3' -Engine 'exchange' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-SafeLinksPolicy -Identity ''CMMC-SafeLinks''' -EntryId 'SI.L2-3.14.3.safe-links'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SI.L2-3.14.3' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'SI.L2-3.14.3.safe-links-rule' -Label 'Create Safe Links Rule for Primary Domain' -Controls 'SI.L2-3.14.3' -Engine 'exchange' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-SafeLinksRule -Identity ''CMMC-SafeLinks-Rule''' -EntryId 'SI.L2-3.14.3.safe-links-rule'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L2-3.13.15' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'SC.L2-3.13.15.anti-spam' -Label 'Create Anti-Spam Inbound Content Filter Policy' -Controls 'SC.L2-3.13.15' -Engine 'exchange' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-HostedContentFilterPolicy -Identity ''CMMC-AntiSpam''' -EntryId 'SC.L2-3.13.15.anti-spam'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L2-3.13.15' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'SC.L2-3.13.15.anti-spam-rule' -Label 'Create Anti-Spam Inbound Filter Rule for Primary Domain' -Controls 'SC.L2-3.13.15' -Engine 'exchange' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-HostedContentFilterRule -Identity ''CMMC-AntiSpam-Rule''' -EntryId 'SC.L2-3.13.15.anti-spam-rule'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L2-3.13.15' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'SC.L2-3.13.15.outbound-spam' -Label 'Create Outbound Spam Filter Policy with User Block on Threshold' -Controls 'SC.L2-3.13.15' -Engine 'exchange' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-HostedOutboundSpamFilterPolicy -Identity ''CMMC-OutboundSpam''' -EntryId 'SC.L2-3.13.15.outbound-spam'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L2-3.13.15' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'SC.L2-3.13.15.outbound-spam-rule' -Label 'Create Outbound Spam Filter Rule for Primary Domain' -Controls 'SC.L2-3.13.15' -Engine 'exchange' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-HostedOutboundSpamFilterRule -Identity ''CMMC-OutboundSpam-Rule''' -EntryId 'SC.L2-3.13.15.outbound-spam-rule'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}

}


# ======================================================================
#  SECURITY & COMPLIANCE — 9 entries
# ======================================================================

if (-not $FilterEngine -or $FilterEngine -eq 'ipps') {
Write-Host "`n>>> Security & Compliance (9 entries) <<<`n" -ForegroundColor Magenta


$global:entryIndex++
if (-not $FilterControl -or 'AT.L2-3.2.3' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AT.L2-3.2.3.insider-threat' -Label 'Insider Threat Awareness Program Evidence' -Controls 'AT.L2-3.2.3' -Engine 'ipps' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-InsiderRiskPolicy | Where-Object { $_.Name -like ''CMMC*'' -or $_.Name -like ''*Departing*'' } | Select-Object Name,InsiderRiskScenario,Enabled' -EntryId 'AT.L2-3.2.3.insider-threat'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AU.L2-3.3.1' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AU.L2-3.3.1.audit-retention' -Label 'Create Audit Log Retention Policy (1 Year)' -Controls 'AU.L2-3.3.1' -Engine 'ipps' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-UnifiedAuditLogRetentionPolicy | Where-Object Name -like ''CMMC*'' | Select-Object Name,RetentionDuration' -EntryId 'AU.L2-3.3.1.audit-retention'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AC.L2-3.1.3' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AC.L2-3.1.3.ib-segment' -Label 'Create Information Barrier Segment' -Controls 'AC.L2-3.1.3' -Engine 'ipps' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-OrganizationSegment | Where-Object Name -eq ''CUI-Segment'' | Select-Object Name,UserGroupFilter' -EntryId 'AC.L2-3.1.3.ib-segment'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AC.L2-3.1.3' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AC.L2-3.1.3.ib-policy' -Label 'Create Information Barrier Policy' -Controls 'AC.L2-3.1.3' -Engine 'ipps' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-InformationBarrierPolicy | Where-Object { $_.Name -like ''CMMC*'' -or $_.Name -like ''*CUI*'' } | Select-Object Name,State' -EntryId 'AC.L2-3.1.3.ib-policy'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'MP.L2-3.8.1, MP.L2-3.8.2, MP.L2-3.8.4' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'MP.L2-3.8.1.cui-label' -Label 'Create CUI Sensitivity Label with Encryption' -Controls 'MP.L2-3.8.1, MP.L2-3.8.2, MP.L2-3.8.4' -Engine 'ipps' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-Label -Identity ''CUI''' -EntryId 'MP.L2-3.8.1.cui-label'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'MP.L2-3.8.1' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'MP.L2-3.8.1.label-policy' -Label 'Publish CUI Sensitivity Label Policy to All Workloads' -Controls 'MP.L2-3.8.1' -Engine 'ipps' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-LabelPolicy -Identity ''CMMC-CUI-Policy''' -EntryId 'MP.L2-3.8.1.label-policy'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'MP.L2-3.8.9' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'MP.L2-3.8.9.dlp-policy' -Label 'Create DLP Compliance Policy to Enforce CUI Blocking' -Controls 'MP.L2-3.8.9' -Engine 'ipps' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-DlpCompliancePolicy -Identity ''CMMC-CUI-Block''' -EntryId 'MP.L2-3.8.9.dlp-policy'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'MP.L2-3.8.9' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'MP.L2-3.8.9.dlp-rule' -Label 'Create DLP Compliance Rule to Block CUI and Notify Owner' -Controls 'MP.L2-3.8.9' -Engine 'ipps' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-DlpComplianceRule -Policy ''CMMC-CUI-Block''' -EntryId 'MP.L2-3.8.9.dlp-rule'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AU.L2-3.3.6' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AU.L2-3.3.6.audit-reduction' -Label 'Audit Reduction via Compliance Search' -Controls 'AU.L2-3.3.6' -Engine 'ipps' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-ComplianceSearch -Identity ''CMMC-AuditReduction-vfsgov.us'' | Select-Object Name,Status,Items,CreatedTime' -EntryId 'AU.L2-3.3.6.audit-reduction'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}

}


# ======================================================================
#  MICROSOFT TEAMS — 1 entries
# ======================================================================

if (-not $FilterEngine -or $FilterEngine -eq 'teams') {
Write-Host "`n>>> Microsoft Teams (1 entries) <<<`n" -ForegroundColor Magenta


$global:entryIndex++
if (-not $FilterControl -or 'SC.L2-3.13.14' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'SC.L2-3.13.14.teams-external' -Label 'Disable Teams Federation and Public Cloud External Access' -Controls 'SC.L2-3.13.14' -Engine 'teams' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-CsExternalAccessPolicy | Select-Object EnableFederationAccess,EnableTeamsConsumerAccess,EnableTeamsConsumerInbound' -EntryId 'SC.L2-3.13.14.teams-external'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}

}


# ======================================================================
#  SHAREPOINT ONLINE (PNP) — 3 entries
# ======================================================================

if (-not $FilterEngine -or $FilterEngine -eq 'spo') {
Write-Host "`n>>> SharePoint Online (PnP) (3 entries) <<<`n" -ForegroundColor Magenta


$global:entryIndex++
if (-not $FilterControl -or 'AC.L1-3.1.22' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AC.L1-3.1.22.public-sharing-evidence' -Label 'Verify SharePoint External Sharing Controls' -Controls 'AC.L1-3.1.22' -Engine 'spo' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-PnPTenant | Select-Object SharingCapability,ShowAllUsersClaim,ShowPeoplePickerSuggestionsForGuestUsers' -EntryId 'AC.L1-3.1.22.public-sharing-evidence'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AC.L1-3.1.20' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AC.L2-3.1.20.spo-sharing' -Label 'Disable SharePoint External Sharing at Tenant Level' -Controls 'AC.L1-3.1.20' -Engine 'spo' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-PnPTenant | Select-Object SharingCapability' -EntryId 'AC.L2-3.1.20.spo-sharing'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AC.L1-3.1.22' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AC.L2-3.1.22.spo-site-sharing' -Label 'Restrict SharePoint Site Sharing to Existing External Users Only' -Controls 'AC.L1-3.1.22' -Engine 'spo' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-PnPTenantSite -Url ''https://vfsgov.us.sharepoint.us'' | Select-Object Url,SharingCapability' -EntryId 'AC.L2-3.1.22.spo-site-sharing'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}

}


# ======================================================================
#  AZURE — 71 entries
# ======================================================================

if (-not $FilterEngine -or $FilterEngine -eq 'az') {
Write-Host "`n>>> Azure (71 entries) <<<`n" -ForegroundColor Magenta


$global:entryIndex++
if (-not $FilterControl -or 'SC.L1-3.13.1' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-BOUNDARY-001' -Label 'Verify Network Security Group Boundary Rules' -Controls 'SC.L1-3.13.1' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AzNetworkSecurityGroup -ResourceGroupName rg-eo-prod | Select-Object Name,SecurityRules' -EntryId 'AZ-BOUNDARY-001'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L1-3.13.1' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-CTX-001' -Label 'Set Azure Subscription Context' -Controls 'SC.L1-3.13.1' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AzContext | Select-Object -ExpandProperty Subscription | Where-Object { $_.Id -eq ''668a730f-12a1-4c80-9734-89c621e98115'' }' -EntryId 'AZ-CTX-001'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L1-3.13.5' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-SUBNET-001' -Label 'Verify VNet Subnet Segmentation' -Controls 'SC.L1-3.13.5' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AzVirtualNetwork -ResourceGroupName rg-eo-prod | Select-Object Name,Subnets' -EntryId 'AZ-SUBNET-001'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L1-3.13.1' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-PREFLIGHT-001' -Label 'Register Required Azure Resource Providers' -Controls 'SC.L1-3.13.1' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AzResourceProvider -ListAvailable | Where-Object { $_.ProviderNamespace -in @(''Microsoft.OperationalInsights'',''Microsoft.SecurityInsights'',''Microsoft.Security'',''Microsoft.Automation'',''Microsoft.KeyVault'',''Microsoft.Storage'',''Microsoft.Network'',''Microsoft.Compute'',''microsoft.insights'',''Microsoft.AlertsManagement'',''Microsoft.OperationsManagement'') } | Select-Object ProviderNamespace,RegistrationState' -EntryId 'AZ-PREFLIGHT-001'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L1-3.13.1' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-FOUND-001' -Label 'Create Azure Resource Group' -Controls 'SC.L1-3.13.1' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AzResourceGroup -Name rg-eo-prod' -EntryId 'AZ-FOUND-001'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L1-3.13.1, CM.L2-3.4.1' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-FOUND-002' -Label 'Assign CMMC L2 Azure Policy Initiative' -Controls 'SC.L1-3.13.1, CM.L2-3.4.1' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AzPolicyAssignment -Name ''CMMC-L2-Initiative'' -Scope ''/subscriptions/668a730f-12a1-4c80-9734-89c621e98115''' -EntryId 'AZ-FOUND-002'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'CM.L2-3.4.2, AU.L2-3.3.1' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-FOUND-004' -Label 'Resource Group CanNotDelete Lock' -Controls 'CM.L2-3.4.2, AU.L2-3.3.1' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AzResourceLock -ResourceGroupName rg-eo-prod | Where-Object { $_.Properties.Level -eq ''CanNotDelete'' }' -EntryId 'AZ-FOUND-004'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L1-3.13.1, SI.L1-3.14.1' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-FOUND-003' -Label 'Enable Microsoft Defender for Cloud (P2)' -Controls 'SC.L1-3.13.1, SI.L1-3.14.1' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AzSecurityPricing | Select-Object Name,PricingTier' -EntryId 'AZ-FOUND-003'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AU.L2-3.3.1, AU.L2-3.3.2, AU.L2-3.3.3' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-LOG-001' -Label 'Create Log Analytics Workspace (365-day retention)' -Controls 'AU.L2-3.3.1, AU.L2-3.3.2, AU.L2-3.3.3' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AzOperationalInsightsWorkspace -ResourceGroupName rg-eo-prod -Name vfsgov-law-prod | ConvertTo-Json -Depth 10' -EntryId 'AZ-LOG-001'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L2-3.13.2' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'SC.L2-3.13.2.advisor' -Label 'Azure Advisor Security Recommendations Evidence' -Controls 'SC.L2-3.13.2' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'az advisor recommendation list --output json' -EntryId 'SC.L2-3.13.2.advisor'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AU.L2-3.3.1, AU.L2-3.3.2' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-LOG-002' -Label 'Create Immutable Log Storage Account' -Controls 'AU.L2-3.3.1, AU.L2-3.3.2' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AzStorageAccount -ResourceGroupName rg-eo-prod -Name vfsgoevops01 | ConvertTo-Json -Depth 10' -EntryId 'AZ-LOG-002'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AU.L2-3.3.1, SC.L2-3.13.10' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-LOG-002a' -Label 'Assign System Managed Identity to Storage Account' -Controls 'AU.L2-3.3.1, SC.L2-3.13.10' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AzStorageAccount -ResourceGroupName rg-eo-prod -Name vfsgoevops01 | Select-Object -ExpandProperty Identity | ConvertTo-Json -Depth 10' -EntryId 'AZ-LOG-002a'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L2-3.13.10, SC.L1-3.13.1' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-KV-001' -Label 'Create Key Vault (purge-protection enabled)' -Controls 'SC.L2-3.13.10, SC.L1-3.13.1' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AzKeyVault -ResourceGroupName rg-eo-prod -VaultName vfsgov-kv-prod | ConvertTo-Json -Depth 10' -EntryId 'AZ-KV-001'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L2-3.13.10, AC.L1-3.1.1' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-KV-002' -Label 'Assign Key Vault Crypto Officer Role to EO Service Principal' -Controls 'SC.L2-3.13.10, AC.L1-3.1.1' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AzRoleAssignment -Scope (Get-AzKeyVault -ResourceGroupName rg-eo-prod -VaultName vfsgov-kv-prod).ResourceId | Where-Object ObjectId -eq 6baa1e3f-f5b3-4c02-b40d-2105b18ea676' -EntryId 'AZ-KV-002'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L2-3.13.10' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-KV-003' -Label 'Create CMK Key in Key Vault (RSA-HSM 4096)' -Controls 'SC.L2-3.13.10' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AzKeyVaultKey -VaultName vfsgov-kv-prod -Name eo-storage-cmk | ConvertTo-Json -Depth 10' -EntryId 'AZ-KV-003'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AU.L2-3.3.1, SC.L2-3.13.10' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-LOG-002b' -Label 'Grant Storage MI Key Vault Crypto Service Encryption User Role' -Controls 'AU.L2-3.3.1, SC.L2-3.13.10' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AzRoleAssignment -ObjectId ca2ed215-708c-44cf-b61c-96ba5ae7034d -Scope /subscriptions/668a730f-12a1-4c80-9734-89c621e98115/resourceGroups/rg-eo-prod/providers/Microsoft.KeyVault/vaults/vfsgov-kv-prod | Where-Object RoleDefinitionName -eq ''Key Vault Crypto Service Encryption User''' -EntryId 'AZ-LOG-002b'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AU.L2-3.3.1, SC.L2-3.13.10' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-LOG-002c' -Label 'Enable CMK Encryption on Storage Account' -Controls 'AU.L2-3.3.1, SC.L2-3.13.10' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AzStorageAccount -ResourceGroupName rg-eo-prod -Name vfsgoevops01 | Select-Object -ExpandProperty Encryption | Where-Object { $_.KeySource -eq ''Microsoft.Keyvault'' }' -EntryId 'AZ-LOG-002c'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L2-3.13.10' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-KV-004' -Label 'Restrict Key Vault Network Access to Azure Services Only' -Controls 'SC.L2-3.13.10' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AzKeyVault -VaultName vfsgov-kv-prod | Select-Object NetworkAcls' -EntryId 'AZ-KV-004'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AU.L2-3.3.1' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-LOG-003' -Label 'Set Storage Container Immutability Policy (WORM)' -Controls 'AU.L2-3.3.1' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AzStorageContainerImmutabilityPolicy -ResourceGroupName rg-eo-prod -StorageAccountName vfsgoevops01 -ContainerName ''logs''' -EntryId 'AZ-LOG-003'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L1-3.13.1, SC.L2-3.13.6, SC.L1-3.13.5' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-NET-001' -Label 'Create Virtual Network' -Controls 'SC.L1-3.13.1, SC.L2-3.13.6, SC.L1-3.13.5' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AzVirtualNetwork -ResourceGroupName rg-eo-prod -Name vfsgov-vnet-eo' -EntryId 'AZ-NET-001'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L1-3.13.1, SC.L2-3.13.6, SC.L1-3.13.5' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-NET-002' -Label 'Create Management Subnet' -Controls 'SC.L1-3.13.1, SC.L2-3.13.6, SC.L1-3.13.5' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AzVirtualNetwork -ResourceGroupName rg-eo-prod -Name vfsgov-vnet-eo | Select-Object -ExpandProperty Subnets | Where-Object Name -eq ''snet-mgmt''' -EntryId 'AZ-NET-002'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L1-3.13.1, SC.L2-3.13.6' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-NET-003' -Label 'Create Workload Subnet' -Controls 'SC.L1-3.13.1, SC.L2-3.13.6' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AzVirtualNetwork -ResourceGroupName rg-eo-prod -Name vfsgov-vnet-eo | Select-Object -ExpandProperty Subnets | Where-Object Name -eq ''snet-workload''' -EntryId 'AZ-NET-003'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L1-3.13.1, SC.L2-3.13.6' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-NET-004' -Label 'Create AzureBastionHost Subnet' -Controls 'SC.L1-3.13.1, SC.L2-3.13.6' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AzVirtualNetwork -ResourceGroupName rg-eo-prod -Name vfsgov-vnet-eo | Select-Object -ExpandProperty Subnets | Where-Object Name -eq ''AzureBastionSubnet''' -EntryId 'AZ-NET-004'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L1-3.13.1, SC.L2-3.13.6' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-NET-005' -Label 'Create AzureFirewall Subnet' -Controls 'SC.L1-3.13.1, SC.L2-3.13.6' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AzVirtualNetwork -ResourceGroupName rg-eo-prod -Name vfsgov-vnet-eo | Select-Object -ExpandProperty Subnets | Where-Object Name -eq ''AzureFirewallSubnet''' -EntryId 'AZ-NET-005'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L1-3.13.1, SC.L1-3.13.5' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-NSG-001' -Label 'Create Network Security Group' -Controls 'SC.L1-3.13.1, SC.L1-3.13.5' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AzNetworkSecurityGroup -ResourceGroupName rg-eo-prod -Name ''nsg-workload-cmmc''' -EntryId 'AZ-NSG-001'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L1-3.13.1, SC.L1-3.13.5, SC.L2-3.13.6' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-NSG-002' -Label 'Add NSG Rule — Deny All Inbound' -Controls 'SC.L1-3.13.1, SC.L1-3.13.5, SC.L2-3.13.6' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AzNetworkSecurityGroup -ResourceGroupName rg-eo-prod -Name ''nsg-workload-cmmc'' | Select-Object -ExpandProperty SecurityRules | Where-Object Name -eq ''DenyAllInbound''' -EntryId 'AZ-NSG-002'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L1-3.13.1, SC.L1-3.13.5' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-NSG-003' -Label 'Add NSG Rule — Deny All Outbound' -Controls 'SC.L1-3.13.1, SC.L1-3.13.5' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AzNetworkSecurityGroup -ResourceGroupName rg-eo-prod -Name ''nsg-workload-cmmc'' | Select-Object -ExpandProperty SecurityRules | Where-Object Name -eq ''DenyAllOutbound''' -EntryId 'AZ-NSG-003'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L1-3.13.1, SC.L1-3.13.5' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-NSG-004' -Label 'Add NSG Rule — Allow Bastion Inbound' -Controls 'SC.L1-3.13.1, SC.L1-3.13.5' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AzNetworkSecurityGroup -ResourceGroupName rg-eo-prod -Name ''nsg-workload-cmmc'' | Select-Object -ExpandProperty SecurityRules | Where-Object Name -eq ''AllowBastionInbound''' -EntryId 'AZ-NSG-004'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L1-3.13.1, AU.L2-3.3.1' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-NSG-005' -Label 'Associate NSG with Workload Subnet' -Controls 'SC.L1-3.13.1, AU.L2-3.3.1' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command '(Get-AzVirtualNetwork -ResourceGroupName rg-eo-prod -Name vfsgov-vnet-eo | Select-Object -ExpandProperty Subnets | Where-Object Name -eq ''snet-workload'').NetworkSecurityGroup' -EntryId 'AZ-NSG-005'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AU.L2-3.3.1, SC.L1-3.13.1' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-NW-001' -Label 'Create Network Watcher' -Controls 'AU.L2-3.3.1, SC.L1-3.13.1' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AzNetworkWatcher -ResourceGroupName rg-eo-prod -Name ''nw-usgovvirginia''' -EntryId 'AZ-NW-001'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L1-3.13.1, SC.L2-3.13.6' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-DNS-001' -Label 'Private DNS Zone: Key Vault' -Controls 'SC.L1-3.13.1, SC.L2-3.13.6' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AzPrivateDnsZone -ResourceGroupName rg-eo-prod -Name ''privatelink.vaultcore.usgovcloudapi.net''' -EntryId 'AZ-DNS-001'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AU.L2-3.3.1, AU.L2-3.3.2' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-NW-002' -Label 'Enable NSG Flow Logs to Log Analytics' -Controls 'AU.L2-3.3.1, AU.L2-3.3.2' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command '$flowLog = Get-AzNetworkWatcherFlowLogStatus -NetworkWatcher (Get-AzNetworkWatcher -ResourceGroupName rg-eo-prod -Name ''nw-usgovvirginia'') -TargetResourceId (Get-AzNetworkSecurityGroup -ResourceGroupName rg-eo-prod -Name ''nsg-workload-cmmc'').Id; if ($flowLog.StorageId -like ''*/vfsgoevops01'') { $flowLog } else { $null }' -EntryId 'AZ-NW-002'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L1-3.13.1, SC.L2-3.13.6' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-DNS-002' -Label 'Private DNS Zone: Blob Storage' -Controls 'SC.L1-3.13.1, SC.L2-3.13.6' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AzPrivateDnsZone -ResourceGroupName rg-eo-prod -Name ''privatelink.blob.core.usgovcloudapi.net''' -EntryId 'AZ-DNS-002'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L1-3.13.1' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-FW-000' -Label 'Create Azure Firewall Policy with Threat Intel Deny Mode' -Controls 'SC.L1-3.13.1' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AzFirewallPolicy -ResourceGroupName rg-eo-prod -Name ''cmmc-fw-policy'' | ConvertTo-Json -Depth 10' -EntryId 'AZ-FW-000'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L1-3.13.1, SC.L2-3.13.6' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-FW-001' -Label 'Create Firewall Public IP' -Controls 'SC.L1-3.13.1, SC.L2-3.13.6' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AzPublicIpAddress -ResourceGroupName rg-eo-prod -Name ''pip-fw-cmmc''' -EntryId 'AZ-FW-001'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L1-3.13.1, SC.L2-3.13.6' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-FW-002' -Label 'Create Azure Firewall' -Controls 'SC.L1-3.13.1, SC.L2-3.13.6' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AzFirewall -ResourceGroupName rg-eo-prod -Name ''fw-cmmc''' -EntryId 'AZ-FW-002'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L1-3.13.1' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-BAS-001' -Label 'Create Bastion Public IP' -Controls 'SC.L1-3.13.1' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AzPublicIpAddress -ResourceGroupName rg-eo-prod -Name ''pip-bastion-cmmc''' -EntryId 'AZ-BAS-001'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L1-3.13.1' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-BAS-002' -Label 'Create Azure Bastion Host' -Controls 'SC.L1-3.13.1' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command '$bastion = Get-AzBastion -ResourceGroupName rg-eo-prod -Name ''bastion-cmmc''; if ($bastion.IpConfigurations.Subnet.Id -like ''*/virtualNetworks/vfsgov-vnet-eo/*'') { $bastion } else { $null }' -EntryId 'AZ-BAS-002'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L1-3.13.1, SC.L2-3.13.6' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-PE-001' -Label 'Create Private Endpoint for Key Vault' -Controls 'SC.L1-3.13.1, SC.L2-3.13.6' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command '$pe = Get-AzPrivateEndpoint -ResourceGroupName rg-eo-prod -Name ''pe-kv-cmmc''; if ($pe.Subnet.Id -like ''*/virtualNetworks/vfsgov-vnet-eo/*'' -and $pe.PrivateLinkServiceConnections.PrivateLinkServiceId -like ''*/vaults/vfsgov-kv-prod'') { $pe } else { $null }' -EntryId 'AZ-PE-001'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L1-3.13.1, SC.L2-3.13.6' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-PE-002' -Label 'Create Private Endpoint for Storage Account' -Controls 'SC.L1-3.13.1, SC.L2-3.13.6' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command '$pe = Get-AzPrivateEndpoint -ResourceGroupName rg-eo-prod -Name ''pe-sa-cmmc''; if ($pe.Subnet.Id -like ''*/virtualNetworks/vfsgov-vnet-eo/*'' -and $pe.PrivateLinkServiceConnections.PrivateLinkServiceId -like ''*/storageAccounts/vfsgoevops01'') { $pe } else { $null }' -EntryId 'AZ-PE-002'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L1-3.13.1, AU.L2-3.3.1' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-AUTO-001' -Label 'Create Automation Account' -Controls 'SC.L1-3.13.1, AU.L2-3.3.1' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AzAutomationAccount -ResourceGroupName rg-eo-prod -Name vfsgov-automation-eo' -EntryId 'AZ-AUTO-001'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L1-3.13.1, AU.L2-3.3.1' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-AUTO-002' -Label 'Assign System Managed Identity to Automation Account' -Controls 'SC.L1-3.13.1, AU.L2-3.3.1' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command '$acct = Get-AzAutomationAccount -ResourceGroupName rg-eo-prod -Name vfsgov-automation-eo; if ($acct.SubscriptionId -eq ''668a730f-12a1-4c80-9734-89c621e98115'' -and $acct.Identity.Type -eq ''SystemAssigned'') { $acct.Identity | ConvertTo-Json -Depth 10 } else { $null }' -EntryId 'AZ-AUTO-002'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L1-3.13.1, AC.L1-3.1.1, AU.L2-3.3.1' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-AUTO-003' -Label 'Grant Automation MI RBAC Roles (Security Reader, LAR on LAW, SBDC on Storage, KV Crypto User on KV)' -Controls 'SC.L1-3.13.1, AC.L1-3.1.1, AU.L2-3.3.1' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command '$assignments = Get-AzRoleAssignment -ObjectId 1503913b-d878-49c6-92a7-2ced799822f4; @{ hasSubScope = ($assignments | Where-Object { $_.Scope -eq ''/subscriptions/668a730f-12a1-4c80-9734-89c621e98115'' -and $_.RoleDefinitionName -eq ''Security Reader'' }) -ne $null; hasLawScope = ($assignments | Where-Object { $_.Scope -like ''*/workspaces/vfsgov-law-prod'' -and $_.RoleDefinitionName -eq ''Log Analytics Reader'' }) -ne $null; hasStorageScope = ($assignments | Where-Object { $_.Scope -like ''*/storageAccounts/vfsgoevops01'' -and $_.RoleDefinitionName -eq ''Storage Blob Data Contributor'' }) -ne $null; hasKvScope = ($assignments | Where-Object { $_.Scope -like ''*/vaults/vfsgov-kv-prod'' -and $_.RoleDefinitionName -eq ''Key Vault Crypto User'' }) -ne $null } | ConvertTo-Json -Compress' -EntryId 'AZ-AUTO-003'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L1-3.13.1, CM.L2-3.4.1' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-VM-001' -Label 'Create Workload VM (no public IP, system managed identity)' -Controls 'SC.L1-3.13.1, CM.L2-3.4.1' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AzVM -ResourceGroupName rg-eo-prod -Name az-vm-enclave-01' -EntryId 'AZ-VM-001'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L2-3.13.10, SC.L2-3.13.16' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-VM-002' -Label 'Enable VM Disk Encryption (CMK via Key Vault)' -Controls 'SC.L2-3.13.10, SC.L2-3.13.16' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AzVMDiskEncryptionStatus -ResourceGroupName rg-eo-prod -VMName az-vm-enclave-01' -EntryId 'AZ-VM-002'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'CM.L2-3.4.1, CM.L2-3.4.2' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-VM-003' -Label 'Assign DISA STIG Policy to VM' -Controls 'CM.L2-3.4.1, CM.L2-3.4.2' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AzPolicyAssignment -Name ''DISA-STIG-VM-az-vm-enclave-01''' -EntryId 'AZ-VM-003'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SI.L1-3.14.1, CM.L2-3.4.1' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-VM-004' -Label 'Install Microsoft Defender for Endpoint VM Extension' -Controls 'SI.L1-3.14.1, CM.L2-3.4.1' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command '$ext = Get-AzVMExtension -ResourceGroupName rg-eo-prod -VMName az-vm-enclave-01 -Name ''MicrosoftMonitoringAgent''; if ($ext.PublicSettings -match ''vfsgov-law-prod'' -or $ext.Settings.workspaceId -eq ''0e3841cc-8ff2-416f-b186-79b762b4a7bf'') { $ext } else { $null }' -EntryId 'AZ-VM-004'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SC.L1-3.13.1' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'SC.L1-3.13.1.nsg-boundary-rules' -Label 'Collect NSG Rules for Network Boundary Protection' -Controls 'SC.L1-3.13.1' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AzNetworkSecurityGroup | Select-Object Name,ResourceGroupName' -EntryId 'SC.L1-3.13.1.nsg-boundary-rules'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SI.L2-3.14.7' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'SI.L2-3.14.7.threat-intel' -Label 'Sentinel Threat Intelligence Data Connectors' -Controls 'SI.L2-3.14.7' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'az sentinel data-connector list --resource-group rg-eo-prod --workspace-name vfsgov-law-prod --query "[?kind==''ThreatIntelligence'']" -o json' -EntryId 'SI.L2-3.14.7.threat-intel'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SI.L1-3.14.1, AU.L2-3.3.1, AU.L2-3.3.3' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-SEN-001' -Label 'Onboard Sentinel to Log Analytics Workspace' -Controls 'SI.L1-3.14.1, AU.L2-3.3.1, AU.L2-3.3.3' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'az rest --method GET --url ''https://management.usgovcloudapi.net/subscriptions/668a730f-12a1-4c80-9734-89c621e98115/resourceGroups/rg-eo-prod/providers/Microsoft.OperationalInsights/workspaces/vfsgov-law-prod/providers/Microsoft.SecurityInsights/onboardingStates/default?api-version=2023-11-01''' -EntryId 'AZ-SEN-001'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SI.L1-3.14.1, AU.L2-3.3.1' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-SEN-002' -Label 'Enable Sentinel Azure Activity Data Connector' -Controls 'SI.L1-3.14.1, AU.L2-3.3.1' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command '$connector = Get-AzSentinelDataConnector -ResourceGroupName rg-eo-prod -WorkspaceName vfsgov-law-prod | Where-Object Kind -eq ''AzureActivity''; if ($connector -and $connector.SubscriptionId -eq ''668a730f-12a1-4c80-9734-89c621e98115'') { $connector } else { $null }' -EntryId 'AZ-SEN-002'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SI.L1-3.14.1, AU.L2-3.3.1' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-SEN-003' -Label 'Enable Sentinel Microsoft Defender for Cloud Data Connector' -Controls 'SI.L1-3.14.1, AU.L2-3.3.1' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AzSentinelDataConnector -ResourceGroupName rg-eo-prod -WorkspaceName vfsgov-law-prod | Where-Object Kind -eq ''MicrosoftDefenderAdvancedThreatProtection''' -EntryId 'AZ-SEN-003'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SI.L1-3.14.1, AU.L2-3.3.1' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-SEN-004' -Label 'Enable Sentinel Azure Key Vault Data Connector' -Controls 'SI.L1-3.14.1, AU.L2-3.3.1' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AzSentinelDataConnector -ResourceGroupName rg-eo-prod -WorkspaceName vfsgov-law-prod | Where-Object Kind -eq ''AzureKeyVault''' -EntryId 'AZ-SEN-004'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'IR.L2-3.6.2' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'IR.L2-3.6.2.incident-track' -Label 'Sentinel Incident Tracking and Response Evidence' -Controls 'IR.L2-3.6.2' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AzSentinelIncident -ResourceGroupName rg-eo-prod -WorkspaceName vfsgov-law-prod | Select-Object Title,Severity,Status,CreatedTimeUtc' -EntryId 'IR.L2-3.6.2.incident-track'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SI.L1-3.14.1, SI.L2-3.14.6' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-SEN-005' -Label 'Create Sentinel CMMC Analytics Rule — Privileged Identity Changes' -Controls 'SI.L1-3.14.1, SI.L2-3.14.6' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AzSentinelAlertRule -ResourceGroupName rg-eo-prod -WorkspaceName vfsgov-law-prod | Where-Object DisplayName -eq ''CMMC L2 — Privileged Identity Changes''' -EntryId 'AZ-SEN-005'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SI.L1-3.14.1, SI.L2-3.14.6' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-SEN-006' -Label 'Create Sentinel CMMC Analytics Rule — Malware Detection' -Controls 'SI.L1-3.14.1, SI.L2-3.14.6' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AzSentinelAlertRule -ResourceGroupName rg-eo-prod -WorkspaceName vfsgov-law-prod | Where-Object DisplayName -eq ''CMMC L2 — Malware Detection''' -EntryId 'AZ-SEN-006'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AU.L2-3.3.1, AU.L2-3.3.2' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-DIAG-007' -Label 'Entra ID Diagnostic Settings' -Controls 'AU.L2-3.3.1, AU.L2-3.3.2' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'az rest --method GET --url ''https://management.usgovcloudapi.net/providers/microsoft.aadiam/diagnosticSettings?api-version=2017-04-01'' | ConvertFrom-Json | Where-Object { $_.value } | ConvertTo-Json' -EntryId 'AZ-DIAG-007'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AU.L2-3.3.2, SI.L1-3.14.1, AU.L2-3.3.3' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-SEN-007' -Label 'Create Sentinel CMMC Analytics Rule — Excessive Failed Logins' -Controls 'AU.L2-3.3.2, SI.L1-3.14.1, AU.L2-3.3.3' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AzSentinelAlertRule -ResourceGroupName rg-eo-prod -WorkspaceName vfsgov-law-prod | Where-Object DisplayName -eq ''CMMC L2 — Excessive Failed Logins''' -EntryId 'AZ-SEN-007'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AU.L2-3.3.1, AU.L2-3.3.2' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-DIAG-008' -Label 'Create Entra ID Diagnostic Settings' -Controls 'AU.L2-3.3.1, AU.L2-3.3.2' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'az rest --method GET --url ''https://management.usgovcloudapi.net/providers/microsoft.aadiam/diagnosticSettings/aad-diag-to-law?api-version=2017-04-01''' -EntryId 'AZ-DIAG-008'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AU.L2-3.3.1, SI.L1-3.14.1' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-SEN-008' -Label 'Create Sentinel CMMC Analytics Rule — Unauthorized Resource Deletion' -Controls 'AU.L2-3.3.1, SI.L1-3.14.1' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AzSentinelAlertRule -ResourceGroupName rg-eo-prod -WorkspaceName vfsgov-law-prod | Where-Object DisplayName -eq ''CMMC L2 — Unauthorized Resource Deletion''' -EntryId 'AZ-SEN-008'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AU.L2-3.3.1, AU.L2-3.3.2' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-DIAG-001' -Label 'Set Diagnostic Setting — Resource Group Activity Log' -Controls 'AU.L2-3.3.1, AU.L2-3.3.2' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command '$diag = Get-AzDiagnosticSetting -ResourceId ''/subscriptions/668a730f-12a1-4c80-9734-89c621e98115/resourceGroups/rg-eo-prod'' -Name ''diag-rg-to-law''; if ($diag.WorkspaceId -like ''*/workspaces/vfsgov-law-prod'') { $diag } else { $null }' -EntryId 'AZ-DIAG-001'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SI.L1-3.14.1, AU.L2-3.3.1' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-SEN-009' -Label 'Sentinel CMMC 2.0 Content Hub Solution' -Controls 'SI.L1-3.14.1, AU.L2-3.3.1' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'az rest --method GET --url ''https://management.usgovcloudapi.net/subscriptions/668a730f-12a1-4c80-9734-89c621e98115/resourceGroups/rg-eo-prod/providers/Microsoft.OperationsManagement/solutions/SecurityInsights(vfsgov-law-prod)?api-version=2015-11-01-preview''' -EntryId 'AZ-SEN-009'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AU.L2-3.3.1, AU.L2-3.3.2' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-DIAG-002' -Label 'Set Diagnostic Setting — Key Vault' -Controls 'AU.L2-3.3.1, AU.L2-3.3.2' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command '$diag = Get-AzDiagnosticSetting -ResourceId (Get-AzKeyVault -ResourceGroupName rg-eo-prod -VaultName vfsgov-kv-prod).ResourceId -Name ''diag-kv-to-law''; if ($diag.WorkspaceId -like ''*/workspaces/vfsgov-law-prod'') { $diag } else { $null }' -EntryId 'AZ-DIAG-002'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AU.L2-3.3.3' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AU.L2-3.3.3.sentinel-connector' -Label 'Connect Office 365 Data Connector to Sentinel' -Controls 'AU.L2-3.3.3' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AzSentinelDataConnector -ResourceGroupName rg-eo-prod -WorkspaceName vfsgov-law-prod' -EntryId 'AU.L2-3.3.3.sentinel-connector'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'SI.L2-3.14.7' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-SEN-010' -Label 'Enable Sentinel UEBA for Anomalous Behavior Detection' -Controls 'SI.L2-3.14.7' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Invoke-AzRestMethod -Method GET -Path ''/subscriptions/668a730f-12a1-4c80-9734-89c621e98115/resourceGroups/rg-eo-prod/providers/Microsoft.OperationalInsights/workspaces/vfsgov-law-prod/providers/Microsoft.SecurityInsights/settings/Ueba?api-version=2023-02-01''' -EntryId 'AZ-SEN-010'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AU.L2-3.3.1, AU.L2-3.3.2' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-DIAG-003' -Label 'Set Diagnostic Setting — Network Security Group' -Controls 'AU.L2-3.3.1, AU.L2-3.3.2' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command '$diag = Get-AzDiagnosticSetting -ResourceId (Get-AzNetworkSecurityGroup -ResourceGroupName rg-eo-prod -Name ''nsg-workload-cmmc'').Id -Name ''diag-nsg-to-law''; if ($diag.WorkspaceId -like ''*/workspaces/vfsgov-law-prod'') { $diag } else { $null }' -EntryId 'AZ-DIAG-003'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AU.L2-3.3.4' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-MON-001' -Label 'Create Azure Monitor Action Group for CISO Alerts' -Controls 'AU.L2-3.3.4' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Get-AzActionGroup -ResourceGroupName rg-eo-prod -Name ''CMMC-AlertGroup''' -EntryId 'AZ-MON-001'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AU.L2-3.3.1, AU.L2-3.3.2' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-DIAG-004' -Label 'Set Diagnostic Setting — Storage Account' -Controls 'AU.L2-3.3.1, AU.L2-3.3.2' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command '$diag = Get-AzDiagnosticSetting -ResourceId (Get-AzStorageAccount -ResourceGroupName rg-eo-prod -Name vfsgoevops01).Id -Name ''diag-sa-to-law''; if ($diag.WorkspaceId -like ''*/workspaces/vfsgov-law-prod'') { $diag } else { $null }' -EntryId 'AZ-DIAG-004'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AU.L2-3.3.8' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-LOG-004' -Label 'Apply CanNotDelete Lock to Sentinel Log Analytics Workspace' -Controls 'AU.L2-3.3.8' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command 'Invoke-AzRestMethod -Method GET -Path ''/subscriptions/668a730f-12a1-4c80-9734-89c621e98115/resourceGroups/rg-eo-prod/providers/Microsoft.OperationalInsights/workspaces/vfsgov-law-prod/providers/Microsoft.Authorization/locks?api-version=2016-09-01''' -EntryId 'AZ-LOG-004'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AU.L2-3.3.1, AU.L2-3.3.2' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-DIAG-005' -Label 'Set Diagnostic Setting — Virtual Machine' -Controls 'AU.L2-3.3.1, AU.L2-3.3.2' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command '$diag = Get-AzDiagnosticSetting -ResourceId (Get-AzVM -ResourceGroupName rg-eo-prod -Name az-vm-enclave-01).Id -Name ''diag-vm-to-law''; if ($diag.WorkspaceId -like ''*/workspaces/vfsgov-law-prod'') { $diag } else { $null }' -EntryId 'AZ-DIAG-005'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}


$global:entryIndex++
if (-not $FilterControl -or 'AU.L2-3.3.1, AU.L2-3.3.2' -like "*$FilterControl*") {
    Write-EntryHeader -Id 'AZ-DIAG-006' -Label 'Set Diagnostic Setting — Subscription Activity Log' -Controls 'AU.L2-3.3.1, AU.L2-3.3.2' -Engine 'az' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {
        Invoke-RegistryGet -Command '$diag = Get-AzSubscriptionDiagnosticSetting -Name ''activitylog-to-law''; if ($diag.WorkspaceId -eq ''0e3841cc-8ff2-416f-b186-79b762b4a7bf'') { $diag } else { $null }' -EntryId 'AZ-DIAG-006'
    } else {
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }
}

}


# ═══════════════════════════════════════════════════════════════════
#  DONE
# ═══════════════════════════════════════════════════════════════════
Show-Summary
