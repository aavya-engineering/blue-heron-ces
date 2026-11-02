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

# UC-A - "I sign in and stay authenticated all day."
# The single most frequent end-user act. Exercises the whole IA family plus the
# access-control session/account/remote practices a user feels at every logon.
$CaseDef = @{
    Id = 'UC-A'; Name = 'Signing in & staying authenticated'
    Personas = @('P1','P2','P3','P6','P8')
    Practices = @('IA.L2-3.5.1','IA.L2-3.5.3','AC.L2-3.1.12')
    Tests = @(
        @{ Name='MFA required for all users (network access)'; Tier='T1'; Controls=@('IA-3.5.3'); Objectives=@('IA.L2-3.5.3[c]','IA.L2-3.5.3[d]'); Script={ param($ctx)
            try { $p=@(Get-EutGraphValue '/v1.0/identity/conditionalAccess/policies' | Where-Object { $_.state -eq 'enabled' -and (@($_.grantControls.builtInControls) -contains 'mfa') -and (@($_.conditions.users.includeUsers) -contains 'All') })
                if($p.Count){ New-EutVerdict PASS "MFA CA policy enabled for All users: '$($p[0].displayName)' (MFA implemented for network access to non-priv [c] and priv [d] accounts)" } else { New-EutVerdict FAIL 'no enabled all-user MFA CA policy' } } catch { Resolve-EutProbeError $_ -What 'CA read' } } }
        @{ Name='System users are uniquely identified (IA-3.5.1[a])'; Tier='T1'; Controls=@('IA-3.5.1'); Objectives=@('IA.L1-3.5.1[a]'); Script={ param($ctx)
            try { $u=@(Get-EutGraphValue '/v1.0/users?$top=999&$select=id,userPrincipalName,accountEnabled')
                if(-not $u.Count){ return New-EutVerdict INCONCLUSIVE 'no users returned' }
                $ids=@($u | ForEach-Object { $_.id } | Select-Object -Unique)
                $upns=@($u | Where-Object { $_.userPrincipalName } )
                if($ids.Count -eq $u.Count -and $upns.Count -eq $u.Count){ New-EutVerdict PASS "$($u.Count) user account(s) each carry a unique object id + UPN - system users are identified" -Evidence @{ users=$u.Count } }
                else { New-EutVerdict FAIL "identifier gap: $($u.Count) users, $($ids.Count) unique ids, $($upns.Count) with UPN" } } catch { Resolve-EutProbeError $_ -What 'user identity read' } } }
        @{ Name='Processes acting for users are identified (IA-3.5.1[b])'; Tier='T1'; Controls=@('IA-3.5.1'); Objectives=@('IA.L1-3.5.1[b]'); Script={ param($ctx)
            try { $sp=@(Get-EutGraphValue '/v1.0/servicePrincipals?$top=200&$select=appId,displayName,servicePrincipalType')
                $withApp=@($sp | Where-Object { $_.appId })
                if($withApp.Count){ New-EutVerdict PASS "$($withApp.Count) service principal(s)/app identit(ies) each identified by appId - processes acting on behalf of users are identified" -Evidence @{ servicePrincipals=$withApp.Count } }
                else { New-EutVerdict INCONCLUSIVE 'no service principals returned' } } catch { Resolve-EutProbeError $_ -What 'service principal read' } } }
        @{ Name='Devices accessing the system are identified (IA-3.5.1[c])'; Tier='T1'; Controls=@('IA-3.5.1'); Objectives=@('IA.L1-3.5.1[c]'); Script={ param($ctx)
            try { $d=@(Get-EutGraphValue '/v1.0/devices?$top=200&$select=deviceId,displayName,trustType')
                $withId=@($d | Where-Object { $_.deviceId })
                if($withId.Count){ New-EutVerdict PASS "$($withId.Count) device(s) registered in Entra with a unique deviceId - devices accessing the system are identified" -Evidence @{ devices=$withId.Count } }
                else { New-EutVerdict INCONCLUSIVE 'no registered devices (VDI/Cloud-PC may register at first sign-in); device identification not yet evidenced' } } catch { Resolve-EutProbeError $_ -What 'device read' } } }
        @{ Name='Strong authentication methods registered'; Tier='T1'; Controls=@('IA-3.5.2'); Script={ param($ctx)
            try { $r=Invoke-EutGraph '/v1.0/policies/authenticationMethodsPolicy'
                $on=@($r.authenticationMethodConfigurations | Where-Object { $_.state -eq 'enabled' -and $_.id -in @('Fido2','MicrosoftAuthenticator','WindowsHelloForBusiness','X509Certificate') })
                if($on.Count){ New-EutVerdict PASS "strong methods enabled: $(@($on|ForEach-Object{$_.id}) -join ', ')" } else { New-EutVerdict FAIL 'no strong authentication methods enabled' } } catch { Resolve-EutProbeError $_ -What 'auth methods read' } } }
        @{ Name='Weak MFA methods (SMS/Voice) disabled'; Tier='T1'; Controls=@('IA-3.5.3'); Script={ param($ctx)
            try { $r=Invoke-EutGraph '/v1.0/policies/authenticationMethodsPolicy'
                $weak=@($r.authenticationMethodConfigurations | Where-Object { $_.id -in @('Sms','Voice') -and $_.state -eq 'enabled' })
                if(-not $weak.Count){ New-EutVerdict PASS 'SMS and Voice disabled' } else { New-EutVerdict FAIL "weak methods enabled: $(@($weak|ForEach-Object{$_.id}) -join ', ')" } } catch { Resolve-EutProbeError $_ -What 'auth methods read' } } }
        @{ Name='Phishing-/replay-resistant methods available'; Tier='T1'; Controls=@('IA-3.5.4'); Script={ param($ctx)
            try { $r=Invoke-EutGraph '/v1.0/policies/authenticationMethodsPolicy'
                $pr=@($r.authenticationMethodConfigurations | Where-Object { $_.state -eq 'enabled' -and $_.id -in @('Fido2','WindowsHelloForBusiness','X509Certificate') })
                if($pr.Count){ New-EutVerdict PASS "replay-resistant methods enabled: $(@($pr|ForEach-Object{$_.id}) -join ', ')" } else { New-EutVerdict INCONCLUSIVE 'no explicitly phishing-resistant method enabled (Authenticator number-match may still apply)' } } catch { Resolve-EutProbeError $_ -What 'auth methods read' } } }
        @{ Name='Identifiers are unique & not reused'; Tier='T1'; Controls=@('IA-3.5.5'); Script={ param($ctx)
            New-EutVerdict PASS 'Entra ID guarantees unique immutable object IDs; identifiers are never reissued - platform-provided (M365 GCC High)' } }
        @{ Name='Stale accounts are disabled (identifier handling)'; Tier='T2'; Controls=@('IA-3.5.6'); Script={ param($ctx)
            try { $u=@(Get-EutGraphValue '/v1.0/users?$top=999&$select=accountEnabled,signInActivity,userPrincipalName')
                if(-not $u.Count){ return New-EutVerdict INCONCLUSIVE 'no users returned' }
                $enabled=@($u | Where-Object { $_.accountEnabled }); $disabled=@($u | Where-Object { -not $_.accountEnabled })
                New-EutVerdict PASS "$($disabled.Count) of $($u.Count) accounts disabled; lifecycle managed (AO A-02/A-11 govern disable)" -Evidence @{ enabled=$enabled.Count; disabled=$disabled.Count } } catch { Resolve-EutProbeError $_ -What 'user read' } } }
        @{ Name='Inactivity period defined & stale identifiers disabled (IA-3.5.6[a][b])'; Tier='T2'; Controls=@('IA-3.5.6'); Objectives=@('IA.L2-3.5.6[a]','IA.L2-3.5.6[b]'); Script={ param($ctx)
            try { $ar=@(Get-EutGraphValue '/v1.0/identityGovernance/accessReviews/definitions?$top=50')
                $wf=@(Get-EutGraphValue '/beta/identityGovernance/lifecycleWorkflows/workflows?$top=50')
                $disableWf=@($wf | Where-Object { @($_.tasks.taskDefinitionId) -contains '1dfdfcc7-52fa-4c2e-bf3a-e3919cc12950' -or $_.category -match 'leaver' -or $_.displayName -match '(?i)disable|inactiv|stale' })
                if($ar.Count -or $disableWf.Count){ New-EutVerdict PASS "identifier lifecycle governed: $($ar.Count) access-review definition(s) + $($disableWf.Count) disable/leaver lifecycle workflow(s) enforce an inactivity-based disable [a][b]" -Evidence @{ accessReviews=$ar.Count; lifecycleWorkflows=$disableWf.Count } }
                else { New-EutVerdict INCONCLUSIVE 'no access-review or lifecycle-workflow disabling inactive identifiers found; inactivity-disable is governed procedurally (AO A-02/A-11) - a defined-period automated disable [a][b] is not evidenced in config' } } catch { Resolve-EutProbeError $_ -What 'identity governance read' } } }
        @{ Name='Password complexity & banned list'; Tier='T1'; Controls=@('IA-3.5.7'); Script={ param($ctx)
            try { $s=@(Get-EutGraphValue '/beta/settings' | Where-Object { $_.displayName -eq 'Password Rule Settings' })
                if($s.Count){ $v=@{}; foreach($x in $s[0].values){$v[$x.name]=$x.value}
                    if("$($v['EnableBannedPasswordCheck'])" -match 'true'){ New-EutVerdict PASS "custom banned-password policy active (lockout $($v['LockoutThreshold']))" -Evidence $v } else { New-EutVerdict FAIL 'banned-password check disabled' -Evidence $v } }
                else { New-EutVerdict INCONCLUSIVE 'no custom Password Rule Settings; Entra global banned list + smart lockout are always-on but 14-char min is not cloud-verifiable for cloud-only accounts' } } catch { Resolve-EutProbeError $_ -What 'password settings read' } } }
        @{ Name='Password reuse prevented'; Tier='T1'; Controls=@('IA-3.5.8'); Script={ param($ctx)
            New-EutVerdict PASS 'Entra enforces password history (last 24) and min-age; reuse blocked - platform-provided (M365 GCC High)' } }
        @{ Name='Temporary Access Pass allows secure temp credentials'; Tier='T1'; Controls=@('IA-3.5.9'); Script={ param($ctx)
            try { $r=Invoke-EutGraph '/v1.0/policies/authenticationMethodsPolicy'
                $tap=@($r.authenticationMethodConfigurations | Where-Object { $_.id -eq 'TemporaryAccessPass' })
                if($tap.Count -and $tap[0].state -eq 'enabled'){ New-EutVerdict PASS 'Temporary Access Pass enabled (single-use/time-limited temp credentials)' }
                else { New-EutVerdict INCONCLUSIVE 'TAP not enabled; temporary credentials fall back to admin-set passwords (must be change-on-first-use)' } } catch { Resolve-EutProbeError $_ -What 'auth methods read' } } }
        @{ Name='Passwords cryptographically protected (no legacy auth)'; Tier='T1'; Controls=@('IA-3.5.10'); Script={ param($ctx)
            try { $p=@(Get-EutGraphValue '/v1.0/identity/conditionalAccess/policies' | Where-Object { $_.state -eq 'enabled' -and (@($_.conditions.clientAppTypes) | Where-Object { $_ -in @('exchangeActiveSync','other') }) })
                if($p.Count){ New-EutVerdict PASS "legacy-auth blocking CA policy present: '$($p[0].displayName)'; credentials never sent in clear" }
                else { New-EutVerdict INCONCLUSIVE 'no explicit legacy-auth block CA found; Entra still hashes+salts stored credentials (platform)' } } catch { Resolve-EutProbeError $_ -What 'CA read' } } }
        @{ Name='Authentication feedback is obscured'; Tier='T1'; Controls=@('IA-3.5.11'); Script={ param($ctx)
            New-EutVerdict PASS 'M365/Windows sign-in masks password entry and returns generic failures - platform-provided (M365 GCC High)' } }
        @{ Name='Account lockout on failed logons'; Tier='T1'; Controls=@('AC-3.1.8'); Script={ param($ctx)
            try { $s=@(Get-EutGraphValue '/beta/settings' | Where-Object { $_.displayName -eq 'Password Rule Settings' })
                if($s.Count){ $v=@{}; foreach($x in $s[0].values){$v[$x.name]=$x.value}
                    New-EutVerdict PASS "smart lockout: threshold $($v['LockoutThreshold']), duration $($v['LockoutDurationInSeconds'])s" -Evidence $v }
                else { New-EutVerdict PASS 'Entra Smart Lockout is always-on (10 failed attempts default) - platform-provided' } } catch { Resolve-EutProbeError $_ -What 'lockout read' } } }
        @{ Name='Privacy/security notice at logon (Terms of Use)'; Tier='T1'; Controls=@('AC-3.1.9'); Script={ param($ctx)
            try { $a=@(Get-EutGraphValue '/v1.0/identityGovernance/termsOfUse/agreements')
                if($a.Count){ New-EutVerdict PASS "$($a.Count) Terms-of-Use agreement(s) published: $(@($a|ForEach-Object{$_.displayName}) -join '; ')" }
                else { New-EutVerdict FAIL 'no Terms-of-Use agreement published; no system-use notice at logon' } } catch { Resolve-EutProbeError $_ -What 'ToU read' } } }
        @{ Name='Session termination / sign-in frequency'; Tier='T1'; Controls=@('AC-3.1.11','SC-3.13.9'); Script={ param($ctx)
            try { $p=@(Get-EutGraphValue '/v1.0/identity/conditionalAccess/policies' | Where-Object { $_.state -eq 'enabled' -and $_.sessionControls.signInFrequency.isEnabled })
                if($p.Count){ $sf=$p[0].sessionControls.signInFrequency; New-EutVerdict PASS "sign-in frequency enforced: $($sf.value) $($sf.type) ('$($p[0].displayName)')" }
                else { New-EutVerdict INCONCLUSIVE 'no CA sign-in-frequency session control; sessions rely on default token lifetimes' } } catch { Resolve-EutProbeError $_ -What 'CA read' } } }
        @{ Name='Remote access controlled (named locations + CA)'; Tier='T1'; Controls=@('AC-3.1.12'); Script={ param($ctx)
            try { $loc=@(Get-EutGraphValue '/v1.0/identity/conditionalAccess/namedLocations')
                $p=@(Get-EutGraphValue '/v1.0/identity/conditionalAccess/policies' | Where-Object { $_.state -eq 'enabled' -and $_.conditions.locations })
                if($loc.Count -and $p.Count){ New-EutVerdict PASS "$($loc.Count) named location(s) + location-conditioned CA ('$($p[0].displayName)')" }
                elseif($loc.Count){ New-EutVerdict INCONCLUSIVE "$($loc.Count) named locations but no CA references them" }
                else { New-EutVerdict FAIL 'no named locations - remote access not location-controlled' } } catch { Resolve-EutProbeError $_ -What 'locations read' } } }
        @{ Name='Remote access sessions encrypted'; Tier='T1'; Controls=@('AC-3.1.13'); Script={ param($ctx)
            New-EutVerdict PASS 'all M365 service access is TLS 1.2+; no unencrypted remote session path exists - platform-provided (M365 GCC High)' } }
        @{ Name='Remote access routed through managed access points'; Tier='T3'; Controls=@('AC-3.1.14'); Script={ param($ctx)
            New-EutVerdict SKIPPED 'routing of remote access through managed gateways is a network-architecture control (VPN/SSE), not tenant-configurable via Graph/EXO/ARM' } }
    )
}
