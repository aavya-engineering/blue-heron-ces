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
  Read-only capture of Microsoft Defender Antivirus status.

.DESCRIPTION
  Emits a single JSON object to stdout. No writes, deletions, or configuration changes.

  Output schema:
    {
      "AMRunningMode": string,
      "AMServiceEnabled": boolean,
      "AntivirusEnabled": boolean,
      "RealTimeProtectionEnabled": boolean,
      "AMProductVersion": string,
      "ComputerID": string
    }

  Maps to question: ep-002 (endpoint protection)
    Positive condition: AntivirusEnabled == true AND RealTimeProtectionEnabled == true

  Required read-only cmdlet:
    Get-MpComputerStatus (Windows Defender / Microsoft Defender module)

  [validate with BHD]: Confirm Get-MpComputerStatus is available on target
  Windows endpoints. Requires Windows 10/11 or Windows Server with Defender.
  Not available on Windows Server Core without Desktop Experience.
#>

$ErrorActionPreference = 'Stop'

$status = Get-MpComputerStatus

[PSCustomObject]@{
    AMRunningMode             = $status.AMRunningMode
    AMServiceEnabled          = [bool]$status.AMServiceEnabled
    AntivirusEnabled          = [bool]$status.AntivirusEnabled
    RealTimeProtectionEnabled = [bool]$status.RealTimeProtectionEnabled
    AMProductVersion          = $status.AMProductVersion
    ComputerID                = $status.ComputerID
} | ConvertTo-Json -Depth 3
