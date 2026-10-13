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
  Read-only capture of BitLocker volume encryption status.

.DESCRIPTION
  Emits a JSON array to stdout. No writes, deletions, or configuration changes.

  Output schema:
    [
      {
        "MountPoint": string,
        "VolumeStatus": string,      // "FullyEncrypted" | "FullyDecrypted" | "EncryptionInProgress" | ...
        "ProtectionStatus": string,  // "On" | "Off" | "Unknown"
        "EncryptionMethod": string
      }
    ]

  Maps to question: dp-001 (media encryption)
    Positive condition: array is non-empty AND every entry has
      VolumeStatus == "FullyEncrypted" AND ProtectionStatus == "On"

  Required read-only cmdlet:
    Get-BitLockerVolume (BitLocker module; Windows only)

  [validate with BHD]: Confirm BitLocker module is available on target endpoints.
  Requires Windows 10/11 Pro/Enterprise or Windows Server with BitLocker feature
  installed. Script runner account requires read access to BitLocker volume status.
#>

$ErrorActionPreference = 'Stop'

$volumes = Get-BitLockerVolume | ForEach-Object {
    [PSCustomObject]@{
        MountPoint       = $_.MountPoint
        VolumeStatus     = $_.VolumeStatus.ToString()
        ProtectionStatus = $_.ProtectionStatus.ToString()
        EncryptionMethod = $_.EncryptionMethod.ToString()
    }
}

@($volumes) | ConvertTo-Json -Depth 3
