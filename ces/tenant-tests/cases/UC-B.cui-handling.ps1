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

# UC-B - "I open, label, email, and store CUI documents."
# The daily work of P1/P2. Exercises CUI access boundaries, media protection
# (labels/markings), and cryptographic protection of CUI in transit and at rest.
$CaseDef = @{
    Id = 'UC-B'; Name = 'Handling CUI (files, email, labels)'
    Personas = @('P1','P2')
    Practices = @('AC.L2-3.1.1','AC.L2-3.1.3','MP.L2-3.8.1','SC.L2-3.13.8')
    Tests = @(
        @{ Name='CUI-authorized group gates access'; Tier='T1'; Controls=@('AC-3.1.1'); Script={ param($ctx)
            try { $name=$ctx.Config.resources.cui_group_name
                $g=@(Get-EutGraphValue "/v1.0/groups?`$filter=displayName eq '$name'")
                if(-not $g.Count){ $near=@(Get-EutGraphValue '/v1.0/groups?$top=999&$select=displayName' | Where-Object { $_.displayName -match '(?i)cui' } | ForEach-Object { $_.displayName })
                    return New-EutVerdict FAIL "CUI group '$name' not found$(if($near.Count){" - near-match: '$($near -join "', '")' (config drift)"})" -Evidence @{ nearMatches=$near } }
                $m=@(Get-EutGraphValue "/v1.0/groups/$($g[0].id)/members?`$top=999")
                if($m.Count){ New-EutVerdict PASS "CUI group '$name' populated ($($m.Count) members)" } else { New-EutVerdict FAIL "CUI group '$name' has no members" } } catch { Resolve-EutProbeError $_ -What 'CUI group read' } } }
        @{ Name='Transaction/function control (default user restrictions)'; Tier='T1'; Controls=@('AC-3.1.2'); Script={ param($ctx)
            try { $r=Invoke-EutGraph '/v1.0/policies/authorizationPolicy'
                $du=$r.defaultUserRolePermissions
                $restricted = ($du.allowedToCreateApps -eq $false) -or ($du.allowedToCreateSecurityGroups -eq $false)
                if($restricted){ New-EutVerdict PASS "default users restricted from privileged transactions (createApps=$($du.allowedToCreateApps), createSecurityGroups=$($du.allowedToCreateSecurityGroups))" -Evidence $du }
                else { New-EutVerdict FAIL 'default users can create apps/groups - transaction/function control weak' -Evidence $du } } catch { Resolve-EutProbeError $_ -What 'authorization policy read' } } }
        # (DLP information-flow / sensitivity-label probes moved to UC-G via the IPPS channel.)
        @{ Name='External systems connection controlled'; Tier='T1'; Controls=@('AC-3.1.20'); Script={ param($ctx)
            try { $r=Invoke-EutGraph '/v1.0/admin/sharepoint/settings'
                if($r.sharingCapability -in @('disabled','existingExternalUserSharingOnly')){ New-EutVerdict PASS "external sharing = '$($r.sharingCapability)'" -Evidence @{ sharingCapability=$r.sharingCapability } }
                else { New-EutVerdict FAIL "external sharing too open: '$($r.sharingCapability)'" } } catch { Resolve-EutProbeError $_ -What 'SharePoint settings read' } } }
        @{ Name='Public information posting controlled (no anon links)'; Tier='T1'; Controls=@('AC-3.1.22'); Script={ param($ctx)
            try { $r=Invoke-EutGraph '/v1.0/admin/sharepoint/settings'
                if($r.sharingCapability -ne 'externalUserAndGuestSharing'){ New-EutVerdict PASS "anonymous 'Anyone' links impossible at '$($r.sharingCapability)'" }
                else { New-EutVerdict FAIL 'anonymous links possible - public posting of CUI not prevented' } } catch { Resolve-EutProbeError $_ -What 'SharePoint settings read' } } }
        # (sensitivity-label media/access/marking probes moved to UC-G via the IPPS channel.)
        @{ Name='CUI encrypted in transit (transport protection)'; Tier='T1'; Controls=@('SC-3.13.8'); Script={ param($ctx)
            try { $rules=@(Invoke-EutExo -Cmdlet 'Get-TransportRule')
                $protect=@($rules | Where-Object { $_.State -eq 'Enabled' -and ($_.ApplyRightsProtectionTemplate -or $_.ApplyOME -or ($_.Description -match '(?i)encrypt|rights|OME|IRM')) })
                if($protect.Count){ New-EutVerdict PASS "$($protect.Count) enabled protection transport rule(s)" -Evidence ($protect | Select-Object Name,State) }
                elseif(@($rules | Where-Object { $_.State -eq 'Enabled' }).Count){ New-EutVerdict FAIL 'transport rules exist but none applies IRM/OME protection' }
                else { New-EutVerdict FAIL 'no enabled transport rules' } } catch { Resolve-EutProbeError $_ -What 'transport rule read (EXO)' } } }
        @{ Name='FIPS-validated cryptography for CUI (Key Vault HSM)'; Tier='T1'; Controls=@('SC-3.13.11'); Script={ param($ctx)
            try { $kv=Invoke-EutArm -Cmdlet 'Get-AzKeyVault' -Params @{ VaultName=$ctx.Config.resources.kv_name }
                $sku="$($kv.Sku)"
                if($sku -match '(?i)premium'){ New-EutVerdict PASS "Key Vault '$($kv.VaultName)' is Premium (FIPS 140-2 Level 2 HSM-backed keys)" -Evidence @{ sku=$sku } }
                else { New-EutVerdict INCONCLUSIVE "Key Vault SKU '$sku' (Standard) - software-protected; M365 service crypto is still FIPS-validated" -Evidence @{ sku=$sku } } } catch { Resolve-EutProbeError $_ -What 'Key Vault read (ARM)' } } }
        @{ Name='CUI encrypted at rest'; Tier='T1'; Controls=@('SC-3.13.16'); Script={ param($ctx)
            try { $sa=Invoke-EutArm -Cmdlet 'Get-AzStorageAccount' -Params @{ ResourceGroupName=$ctx.Config.subscription.resource_group; Name=$ctx.Config.resources.storage_account_name }
                $enc = $sa.Encryption.Services.Blob.Enabled
                if($enc){ New-EutVerdict PASS "evidence storage '$($sa.StorageAccountName)' encrypted at rest (CMK: $($sa.Encryption.KeySource))" -Evidence @{ keySource="$($sa.Encryption.KeySource)" } }
                else { New-EutVerdict INCONCLUSIVE 'storage encryption flag not readable; M365 SharePoint/Exchange encrypt CUI at rest by default (platform)' } } catch { Resolve-EutProbeError $_ -What 'storage read (ARM)' } } }
    )
}
