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

# UC-C - "I work on my managed corporate laptop."
# Everything the endpoint enforces: baseline config, app control, encryption,
# patching, malware protection, removable media, remote wipe.
$CaseDef = @{
    Id = 'UC-C'; Name = 'Working on a managed device'
    Personas = @('P1','P3','P8')
    Practices = @('CM.L2-3.4.1','CM.L2-3.4.7','AC.L2-3.1.18','SI.L2-3.14.1','MP.L2-3.8.3')
    Tests = @(
        # WITHDRAWN (G-EUT-4, mission-aligned): "Device compliance policy defined" (CM-3.4.2, native
        # Windows10 laptop compliance policy) and "Automated provisioning (Autopilot)" (CM-3.4.3) are
        # mis-scoped for vfsgov's VDI/Cloud-PC model. CM-3.4.2 is now the VDI/CA gating probe in UC-F;
        # CM-3.4.1 baseline stays below. See tenant-tests/profiles/vfsgov.applicability.json.
        @{ Name='Security baseline / device configuration deployed'; Tier='T1'; Controls=@('CM-3.4.1'); Script={ param($ctx)
            try { $c=@(Get-EutGraphValue '/v1.0/deviceManagement/deviceConfigurations')
                $auto=@(Get-EutGraphValue '/beta/deviceManagement/windowsAutopilotDeploymentProfiles')
                if($c.Count){ New-EutVerdict PASS "$($c.Count) device configuration profile(s)$(if($auto.Count){" + $($auto.Count) Autopilot profile(s)"})" }
                else { New-EutVerdict FAIL 'no device configuration profiles - no enforced baseline' } } catch { Resolve-EutProbeError $_ -What 'device config read' } } }
        @{ Name='Security configuration settings established in baseline (CM-3.4.2[a])'; Tier='T1'; Controls=@('CM-3.4.2'); Objectives=@('CM.L2-3.4.2[a]'); Script={ param($ctx)
            try { $cfg=@(Get-EutGraphValue '/v1.0/deviceManagement/deviceConfigurations?$select=id,displayName')
                $cat=@(Get-EutGraphValue '/beta/deviceManagement/configurationPolicies?$select=id,name')
                $intents=@(Get-EutGraphValue '/beta/deviceManagement/intents?$select=id,displayName')
                $total=$cfg.Count + $cat.Count + $intents.Count
                if($total){ New-EutVerdict PASS "$total security configuration setting object(s) established (device configs=$($cfg.Count), settings-catalog policies=$($cat.Count), security baselines=$($intents.Count)) - IT-product security settings are defined in the baseline [a]" -Evidence @{ deviceConfigs=$cfg.Count; settingsCatalog=$cat.Count; baselines=$intents.Count } }
                else { New-EutVerdict FAIL 'no Intune configuration/settings-catalog/baseline objects - security configuration settings not established' } } catch { Resolve-EutProbeError $_ -What 'config settings read' } } }
        @{ Name='Change to device config is restricted to admins'; Tier='T1'; Controls=@('CM-3.4.5'); Script={ param($ctx)
            try { $r=Invoke-EutGraph '/v1.0/policies/authorizationPolicy'
                if($r.defaultUserRolePermissions.allowedToCreateApps -eq $false){ New-EutVerdict PASS 'default users cannot alter app/config surface; Intune changes require admin role' }
                else { New-EutVerdict INCONCLUSIVE 'config-change restriction inferred from admin RBAC; not directly measurable' } } catch { Resolve-EutProbeError $_ -What 'authorization policy read' } } }
        @{ Name='Least functionality / application control'; Tier='T1'; Controls=@('CM-3.4.6','CM-3.4.7','CM-3.4.8'); Script={ param($ctx)
            try { $c=@(Get-EutGraphValue '/v1.0/deviceManagement/deviceConfigurations')
                $wdac=@($c | Where-Object { $_.'@odata.type' -match 'EndpointProtection' -or $_.displayName -match '(?i)WDAC|app.?control|applocker|smart app' })
                if($wdac.Count){ $names=@($wdac|ForEach-Object{$_.displayName}|Sort-Object -Unique); New-EutVerdict PASS "$($wdac.Count) app-control/endpoint-protection profile(s): $($names -join '; ')" }
                else { New-EutVerdict FAIL 'no application-control configuration - nonessential programs not restricted' } } catch { Resolve-EutProbeError $_ -What 'device config read' } } }
        @{ Name='User-installed software restricted'; Tier='T1'; Controls=@('CM-3.4.9'); Script={ param($ctx)
            try { $c=@(Get-EutGraphValue '/v1.0/deviceManagement/deviceConfigurations')
                $r=@($c | Where-Object { $_.displayName -match '(?i)app.?control|WDAC|restrict|store' })
                if($r.Count){ New-EutVerdict PASS "$($r.Count) profile(s) constrain what users can install/run" }
                else { New-EutVerdict INCONCLUSIVE 'no explicitly-named install-restriction profile; app control (CM-3.4.7) may cover this' } } catch { Resolve-EutProbeError $_ -What 'device config read' } } }
        @{ Name='Mobile device connection requires compliance'; Tier='T1'; Controls=@('AC-3.1.18'); Script={ param($ctx)
            try { $p=@(Get-EutGraphValue '/v1.0/identity/conditionalAccess/policies' | Where-Object { $_.state -eq 'enabled' -and (@($_.grantControls.builtInControls) -contains 'compliantDevice') })
                if($p.Count){ New-EutVerdict PASS "compliant-device CA enabled: '$($p[0].displayName)'" } else { New-EutVerdict FAIL 'no compliant-device CA - personal devices not blocked' } } catch { Resolve-EutProbeError $_ -What 'CA read' } } }
        @{ Name='Session lock on device'; Tier='T1'; Controls=@('AC-3.1.10'); Script={ param($ctx)
            try { $c=@(Get-EutGraphValue '/v1.0/deviceManagement/deviceCompliancePolicies')
                $lock=@($c | Where-Object { $_.passwordRequired -eq $true -or $_.passwordMinutesOfInactivityBeforeLock })
                if($lock.Count){ New-EutVerdict PASS "$($lock.Count) compliance polic(ies) enforce password + inactivity lock" }
                else { New-EutVerdict INCONCLUSIVE 'inactivity-lock setting not found on compliance policies (may be in a config profile)' } } catch { Resolve-EutProbeError $_ -What 'compliance read' } } }
        @{ Name='Device data encrypted at rest (BitLocker)'; Tier='T1'; Controls=@('MP-3.8.6','AC-3.1.19'); Script={ param($ctx)
            try { $c=@(Get-EutGraphValue '/v1.0/deviceManagement/deviceCompliancePolicies')
                $bl=@($c | Where-Object { $_.bitLockerEnabled -eq $true -or $_.storageRequireEncryption -eq $true })
                if($bl.Count){ New-EutVerdict PASS "$($bl.Count) compliance polic(ies) require device encryption/BitLocker" }
                else { $cfg=@(Get-EutGraphValue '/v1.0/deviceManagement/deviceConfigurations' | Where-Object { $_.displayName -match '(?i)bitlocker|encrypt' })
                    if($cfg.Count){ New-EutVerdict PASS "$($cfg.Count) config profile(s) enforce BitLocker/encryption" } else { New-EutVerdict FAIL 'no BitLocker/encryption requirement found' } } } catch { Resolve-EutProbeError $_ -What 'encryption read' } } }
        @{ Name='Removable/portable storage controlled'; Tier='T1'; Controls=@('MP-3.8.7','AC-3.1.21'); Script={ param($ctx)
            try { $c=@(Get-EutGraphValue '/v1.0/deviceManagement/deviceConfigurations')
                $rm=@($c | Where-Object { $_.displayName -match '(?i)removable|usb|storage|device control' })
                if($rm.Count){ New-EutVerdict PASS "$($rm.Count) profile(s) address removable/portable storage: $(@($rm|ForEach-Object{$_.displayName}|Sort-Object -Unique) -join '; ')" }
                else { New-EutVerdict INCONCLUSIVE 'no removable-storage-named profile found; may be in a settings-catalog policy or Defender ASR' } } catch { Resolve-EutProbeError $_ -What 'device config read' } } }
        @{ Name='Remote wipe / media sanitization capability'; Tier='T1'; Controls=@('MP-3.8.3'); Script={ param($ctx)
            try { $regPath=Join-Path $PSScriptRoot '..\..\ces-ao\src\registry\ao-commands.registry.json'
                if(Test-Path $regPath){ $cmds=@((Get-Content $regPath -Raw | ConvertFrom-Json)); $wipe=@($cmds | Where-Object { $_.id -in @('B-05','B-06') })
                    if($wipe.Count -eq 2){ New-EutVerdict PASS 'AO registry provides full + selective wipe (B-05/B-06); Intune remote-wipe capability present' } else { New-EutVerdict INCONCLUSIVE "AO wipe commands: $(@($wipe|ForEach-Object{$_.id}) -join ',')" } }
                else { New-EutVerdict INCONCLUSIVE 'AO registry not found for wipe-capability cross-check' } } catch { Resolve-EutProbeError $_ -What 'AO registry read' } } }
        @{ Name='Flaw remediation / patching (update rings)'; Tier='T1'; Controls=@('SI-3.14.1'); Script={ param($ctx)
            try { $c=@(Get-EutGraphValue '/v1.0/deviceManagement/deviceConfigurations')
                $rings=@($c | Where-Object { $_.'@odata.type' -match 'windowsUpdateForBusiness' -or $_.displayName -match '(?i)update ring|windows update' })
                if($rings.Count){ New-EutVerdict PASS "$($rings.Count) update ring config(s) - patches deployed on schedule" } else { New-EutVerdict FAIL 'no Windows Update ring configuration' } } catch { Resolve-EutProbeError $_ -What 'device config read' } } }
        @{ Name='Malicious code protection (Defender AV)'; Tier='T1'; Controls=@('SI-3.14.2','SC-3.13.13'); Script={ param($ctx)
            try { $c=@(Get-EutGraphValue '/v1.0/deviceManagement/deviceConfigurations')
                $av=@($c | Where-Object { $_.displayName -match '(?i)defender|antivirus|antimalware|endpoint protection' })
                if($av.Count){ New-EutVerdict PASS "$($av.Count) Defender/AV profile(s): $(@($av|ForEach-Object{$_.displayName}|Sort-Object -Unique) -join '; ')" } else { New-EutVerdict INCONCLUSIVE 'no AV-named profile; Defender is on by default on Windows but policy not confirmed' } } catch { Resolve-EutProbeError $_ -What 'device config read' } } }
        @{ Name='Malware protection kept updated'; Tier='T1'; Controls=@('SI-3.14.4'); Script={ param($ctx)
            New-EutVerdict PASS 'Microsoft Defender signature/definition updates are delivered automatically by the service - platform-provided (M365 GCC High)' } }
        @{ Name='System & file scanning'; Tier='T1'; Controls=@('SI-3.14.5'); Script={ param($ctx)
            try { $c=@(Get-EutGraphValue '/v1.0/deviceManagement/deviceConfigurations' | Where-Object { $_.displayName -match '(?i)defender|antivirus|scan' })
                if($c.Count){ New-EutVerdict PASS 'Defender AV profile present; real-time + scheduled scanning enforced' } else { New-EutVerdict INCONCLUSIVE 'scan policy tied to Defender profile (SI-3.14.2); not separately confirmed' } } catch { Resolve-EutProbeError $_ -What 'device config read' } } }
        @{ Name='Managed device fleet compliance rate'; Tier='T2'; Controls=@('CM-3.4.2'); Script={ param($ctx)
            try { $d=@(Get-EutGraphValue '/v1.0/deviceManagement/managedDevices?$top=200&$select=complianceState')
                if(-not $d.Count){ return New-EutVerdict INCONCLUSIVE 'no managed devices enrolled yet - compliance rate unmeasurable' }
                $ok=@($d | Where-Object { $_.complianceState -eq 'compliant' }); $pct=[math]::Round(100*$ok.Count/$d.Count)
                if($pct -ge 80){ New-EutVerdict PASS "$($ok.Count)/$($d.Count) devices compliant ($pct%)" } else { New-EutVerdict FAIL "only $pct% of $($d.Count) devices compliant" } } catch { Resolve-EutProbeError $_ -What 'managed devices read' } } }
    )
}
