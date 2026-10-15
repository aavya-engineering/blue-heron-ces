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

# UC-F - vfsgov mission-specific controls (G-EUT-4).
# Tests the tenant-specific implementations the mission plan actually relies on, which the
# generic suite missed: break-glass group exclusion, security-group naming, ADFS->Entra
# federation, M365 audit org settings, VDI/Cloud-PC CUI gating, and baseline configuration.
# Grounded in docs/tenant-tests/vfsgov-mission-profile.md.
$CaseDef = @{
    Id = 'UC-F'; Name = 'Mission-specific (vfsgov VDI/GCC-High model)'
    Personas = @('P6','P1')
    Practices = @('AC.L2-3.1.7','CM.L2-3.4.1','CM.L2-3.4.2','AU.L2-3.3.1')
    Tests = @(
        @{ Name='Break-glass emergency access excluded from blocking CA'; Tier='T1'; Controls=@('AC-3.1.7'); Objectives=@(); Script={ param($ctx)
            try {
                $bgUpn = $ctx.Config.resources.breakglass_upn
                # NOTE: do NOT use `$x = if (...) { @(Get-EutGraphValue ...) }` here - under Windows
                # PowerShell 5.1 that statement-assignment returned an array of nulls in this probe
                # context (bgId ended up $null, failing every policy). Plain assignment is reliable.
                $bgAcct = @()
                if ($bgUpn) { $bgAcct = @(Get-EutGraphValue "/v1.0/users?`$filter=userPrincipalName eq '$bgUpn'") }
                $eadmin = @(Get-EutGraphValue "/v1.0/groups?`$filter=displayName eq 'eadmin'")
                $pols = @(Get-EutGraphValue '/v1.0/identity/conditionalAccess/policies' | Where-Object {
                    $_.state -eq 'enabled' -and (@($_.grantControls.builtInControls) -contains 'block') -and $_.displayName -notmatch '^Microsoft-managed' })
                if (-not $bgAcct.Count) { return New-EutVerdict FAIL "break-glass account '$bgUpn' not found" }
                $bgId = $bgAcct[0].id
                if (-not $pols.Count) { return New-EutVerdict INCONCLUSIVE 'no enabled tenant-authored blocking CA policies to check exclusion against' }
                if (-not $bgId) { return New-EutVerdict INCONCLUSIVE "break-glass account '$bgUpn' resolved without an object id - cannot evaluate exclusions" }
                $bad = @($pols | Where-Object { @($_.conditions.users.excludeUsers) -notcontains $bgId })
                $eadminNote = ''
                if ($eadmin.Count) {
                    $gid = $eadmin[0].id
                    $badG = @($pols | Where-Object { @($_.conditions.users.excludeGroups) -notcontains $gid })
                    if ($badG.Count) { $bad += $badG }
                    $eadminNote = " + 'eadmin' group checked"
                } else { $eadminNote = " (mission plan references 'eadmin' group but it is not provisioned; break-glass account is the effective emergency path - config-drift note)" }
                # unique by policy id - Select-Object -Unique on hashtables compares ToString() and collapses distinct policies
                $bad = @($bad | Sort-Object { $_.id } -Unique)
                if (-not $bad.Count) { New-EutVerdict PASS "break-glass excluded from all $($pols.Count) blocking CA polic(ies)$eadminNote" }
                else { New-EutVerdict FAIL "break-glass NOT excluded from: $(@($bad|ForEach-Object{$_.displayName}) -join '; ') - lockout risk$eadminNote" }
            } catch { Resolve-EutProbeError $_ -What 'break-glass exclusion read' } } }

        @{ Name='Baseline configuration established (CM-3.4.1, non-Autopilot)'; Tier='T1'; Controls=@('CM-3.4.1'); Script={ param($ctx)
            try {
                $ca = @(Get-EutGraphValue '/v1.0/identity/conditionalAccess/policies' | Where-Object { $_.state -eq 'enabled' })
                $cfg = @(Get-EutGraphValue '/v1.0/deviceManagement/deviceConfigurations')
                $cmmcCa = @($ca | Where-Object { $_.displayName -match '(?i)CMMC|CUI|MFA|compliant|location' })
                if ($cmmcCa.Count -ge 2 -or ($ca.Count -ge 2 -and $cfg.Count -ge 1)) {
                    New-EutVerdict PASS "baseline established in config: $($ca.Count) enabled CA polic(ies) + $($cfg.Count) device config profile(s) (Entra/Intune baseline, not Autopilot)" }
                else { New-EutVerdict FAIL "insufficient baseline config ($($ca.Count) CA, $($cfg.Count) device configs)" }
            } catch { Resolve-EutProbeError $_ -What 'baseline config read' } } }

        @{ Name='System inventory established (CM-3.4.1[d][e])'; Tier='T1'; Controls=@('CM-3.4.1'); Objectives=@('CM.L2-3.4.1[d]','CM.L2-3.4.1[e]'); Script={ param($ctx)
            try {
                $devices=@(Get-EutGraphValue '/v1.0/devices?$top=999&$select=deviceId,operatingSystem,displayName')
                $managed=@(Get-EutGraphValue '/v1.0/deviceManagement/managedDevices?$top=999&$select=id,operatingSystem,deviceName')
                $apps=@(Get-EutGraphValue '/v1.0/applications?$top=999&$select=appId,displayName')
                $total=$devices.Count + $managed.Count
                if($total -gt 0 -or $apps.Count -gt 0){ New-EutVerdict PASS "system inventory maintained in Entra/Intune: $($devices.Count) registered device(s), $($managed.Count) managed device(s), $($apps.Count) app registration(s) (hardware+software inventory [d][e])" -Evidence @{ entraDevices=$devices.Count; managedDevices=$managed.Count; apps=$apps.Count } }
                else { New-EutVerdict INCONCLUSIVE 'no devices/apps enumerated yet (VDI/Cloud-PC registers on first sign-in); inventory endpoint reachable but empty' }
            } catch { Resolve-EutProbeError $_ -What 'inventory read' } } }
        @{ Name='VDI/Cloud-PC CUI access gated by Conditional Access (CM-3.4.2 reframe)'; Tier='T1'; Controls=@('CM-3.4.2'); Script={ param($ctx)
            try {
                $pols = @(Get-EutGraphValue '/v1.0/identity/conditionalAccess/policies' | Where-Object {
                    $_.state -eq 'enabled' -and (
                        (@($_.grantControls.builtInControls) -contains 'compliantDevice') -or
                        (@($_.grantControls.builtInControls) -contains 'domainJoinedDevice') -or
                        $_.conditions.devices ) })
                if ($pols.Count) { New-EutVerdict PASS "$($pols.Count) CA polic(ies) gate access by device/compliance (VDI/Cloud-PC enforcement model): $(@($pols|ForEach-Object{$_.displayName}) -join '; ')" }
                else { New-EutVerdict FAIL 'no device/compliance-gating CA policy - VDI-only CUI access not enforced' }
            } catch { Resolve-EutProbeError $_ -What 'CA read' } } }

        @{ Name='ADFS -> Entra federation configured'; Tier='T1'; Controls=@('IA-3.5.1'); Objectives=@(); Script={ param($ctx)
            try {
                $doms = @(Get-EutGraphValue '/v1.0/domains')
                $fed = @($doms | Where-Object { $_.authenticationType -eq 'Federated' })
                if ($fed.Count) { New-EutVerdict PASS "$($fed.Count) federated domain(s): $(@($fed|ForEach-Object{$_.id}) -join ', ')" }
                else { New-EutVerdict INCONCLUSIVE "no federated domain found ($($doms.Count) domain(s) all managed) - gov ADFS federation may not be configured yet, or auth is cloud-native" }
            } catch { Resolve-EutProbeError $_ -What 'domains read' } } }

        @{ Name='Security-group naming convention in use'; Tier='T1'; Controls=@('AC-3.1.1'); Script={ param($ctx)
            try {
                $g = @(Get-EutGraphValue '/v1.0/groups?$top=999&$select=displayName,securityEnabled' | Where-Object { $_.securityEnabled })
                if (-not $g.Count) { return New-EutVerdict INCONCLUSIVE 'no security groups found' }
                $names = @($g | ForEach-Object { $_.displayName })
                New-EutVerdict INCONCLUSIVE "$($g.Count) security group(s) present (e.g. $(@($names | Select-Object -First 4) -join ', ')) - naming convention '<project><role><UPN>' requires manual confirmation against the mission plan"
            } catch { Resolve-EutProbeError $_ -What 'groups read' } } }

        @{ Name='M365 unified audit / org settings enabled'; Tier='T1'; Controls=@('AU-3.3.1'); Script={ param($ctx)
            try {
                $cfg = @(Invoke-EutExo -Cmdlet 'Get-AdminAuditLogConfig')
                if ($cfg.Count -and $cfg[0].UnifiedAuditLogIngestionEnabled) { New-EutVerdict PASS 'unified audit log ingestion enabled (M365 org audit on)' }
                elseif ($cfg.Count) { New-EutVerdict FAIL 'unified audit log ingestion DISABLED - tenant-wide audit not capturing' }
                else { New-EutVerdict INCONCLUSIVE 'audit config not returned' }
            } catch { Resolve-EutProbeError $_ -What 'audit config read (EXO)' } } }
    )
}
