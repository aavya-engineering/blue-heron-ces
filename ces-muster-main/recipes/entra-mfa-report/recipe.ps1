<#
  SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
  SPDX-License-Identifier: LicenseRef-BHD-Proprietary
  CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
  Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
  Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
  Submitting a change to this repository means you accept TERMS.md.
  Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
  See LICENSE and TERMS.md.
#>

<#
.SYNOPSIS
  Read-only capture of Entra ID conditional access policies and MFA registration.

.DESCRIPTION
  Emits a single JSON object to stdout. No writes, deletions, or configuration changes.

  Output schema:
    {
      "conditionalAccessPolicies": [
        { "id": string, "displayName": string, "state": string, "grantControls": object | null }
      ],
      "mfaRegistrationSummary": {
        "usersRegistered": number,
        "usersNotRegistered": number
      }
    }

  Maps to question: iam-001 (MFA enforcement)
    Positive condition: any conditionalAccessPolicies entry where
      state == "enabled" AND grantControls.builtInControls includes "mfa"

  Required read-only Microsoft Graph PowerShell cmdlets:
    Get-MgIdentityConditionalAccessPolicy     (Microsoft.Graph.Identity.SignIns)
    Get-MgReportAuthenticationMethodUserRegistrationDetail (Microsoft.Graph.Reports)

  Required permissions (delegated or application, read-only):
    Policy.Read.All, Reports.Read.All

  [validate with BHD]: Confirm Microsoft.Graph.Identity.SignIns and
  Microsoft.Graph.Reports are installed in target tenant environments and
  Reports.Read.All permission is granted.
#>

$ErrorActionPreference = 'Stop'

$policies = Get-MgIdentityConditionalAccessPolicy -All | ForEach-Object {
    [PSCustomObject]@{
        id            = $_.Id
        displayName   = $_.DisplayName
        state         = $_.State
        grantControls = $_.GrantControls
    }
}

$regDetails    = Get-MgReportAuthenticationMethodUserRegistrationDetail -All
$registered    = ($regDetails | Where-Object { $_.IsMfaRegistered -eq $true }).Count
$notRegistered = ($regDetails | Where-Object { $_.IsMfaRegistered -eq $false }).Count

[PSCustomObject]@{
    conditionalAccessPolicies = @($policies)
    mfaRegistrationSummary    = [PSCustomObject]@{
        usersRegistered    = [int]$registered
        usersNotRegistered = [int]$notRegistered
    }
} | ConvertTo-Json -Depth 10
