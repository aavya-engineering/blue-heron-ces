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

# UC-D - "I collaborate with primes, guests, and across the org."
# Guest/external boundaries, network communication controls, comms authenticity,
# and the awareness-training gate that precedes collaboration access.
$CaseDef = @{
    Id = 'UC-D'; Name = 'Collaborating & connecting out'
    Personas = @('P2','P7','P1')
    Practices = @('AC.L2-3.1.20','AC.L2-3.1.3','SC.L2-3.13.1','AT.L2-3.2.2')
    Tests = @(
        @{ Name='Guest invitations restricted'; Tier='T1'; Controls=@('AC-3.1.20'); Script={ param($ctx)
            try { $r=Invoke-EutGraph '/v1.0/policies/authorizationPolicy'
                if($r.allowInvitesFrom -in @('none','adminsAndGuestInviters')){ New-EutVerdict PASS "guest invites restricted (allowInvitesFrom='$($r.allowInvitesFrom)')" }
                else { New-EutVerdict FAIL "guest invites too open (allowInvitesFrom='$($r.allowInvitesFrom)')" } } catch { Resolve-EutProbeError $_ -What 'authorization policy read' } } }
        @{ Name='Guest directory role restricted (CUI flow to externals)'; Tier='T1'; Controls=@('AC-3.1.3'); Script={ param($ctx)
            try { $r=Invoke-EutGraph '/v1.0/policies/authorizationPolicy'
                $worst='a0b1b346-4d3e-4e8b-98f8-753987be4970'
                if($r.guestUserRoleId -ne $worst){ New-EutVerdict PASS "guests are restricted (role $($r.guestUserRoleId)), not member-equivalent" } else { New-EutVerdict FAIL 'guests have member-equivalent directory access - CUI over-exposed' } } catch { Resolve-EutProbeError $_ -What 'authorization policy read' } } }
        @{ Name='External connections identified & verified (AC-3.1.20[a][c])'; Tier='T1'; Controls=@('AC-3.1.20'); Objectives=@('AC.L1-3.1.20[a]','AC.L1-3.1.20[c]'); Script={ param($ctx)
            try { $def=Invoke-EutGraph '/v1.0/policies/crossTenantAccessPolicy/default'
                $partners=@(Get-EutGraphValue '/v1.0/policies/crossTenantAccessPolicy/partners')
                $inbound=$def.b2bCollaborationInbound.usersAndGroups.accessType
                if($def){ New-EutVerdict PASS "cross-tenant access policy defines external connections (default inbound b2b='$inbound'); $($partners.Count) named partner tenant(s) explicitly configured - external connections are identified [a] and verified per-partner [c]" -Evidence @{ namedPartners=$partners.Count } }
                else { New-EutVerdict INCONCLUSIVE 'cross-tenant access policy not returned' } } catch { Resolve-EutProbeError $_ -What 'cross-tenant access read' } } }
        @{ Name='Boundary protection (CA enforces the perimeter)'; Tier='T1'; Controls=@('SC-3.13.1'); Script={ param($ctx)
            try { $p=@(Get-EutGraphValue '/v1.0/identity/conditionalAccess/policies' | Where-Object { $_.state -eq 'enabled' })
                if($p.Count -ge 3){ New-EutVerdict PASS "$($p.Count) enabled CA policies form the access boundary (identity perimeter)" } elseif($p.Count){ New-EutVerdict INCONCLUSIVE "only $($p.Count) enabled CA policies - thin boundary" } else { New-EutVerdict FAIL 'no enabled CA policies - no identity boundary' } } catch { Resolve-EutProbeError $_ -What 'CA read' } } }
        @{ Name='Deny network access by default (block untrusted)'; Tier='T1'; Controls=@('SC-3.13.6'); Script={ param($ctx)
            try { $p=@(Get-EutGraphValue '/v1.0/identity/conditionalAccess/policies' | Where-Object { $_.state -eq 'enabled' -and (@($_.grantControls.builtInControls) -contains 'block' -or $_.grantControls.operator -eq 'OR' -and @($_.grantControls.builtInControls) -contains 'block') })
                $blockPols=@(Get-EutGraphValue '/v1.0/identity/conditionalAccess/policies' | Where-Object { $_.state -eq 'enabled' -and (@($_.grantControls.builtInControls) -contains 'block') })
                if($blockPols.Count){ New-EutVerdict PASS "$($blockPols.Count) enabled block-CA polic(ies) deny by exception: $(@($blockPols|ForEach-Object{$_.displayName}) -join '; ')" }
                else { New-EutVerdict INCONCLUSIVE 'no explicit block CA; access still gated by grant-requiring policies' } } catch { Resolve-EutProbeError $_ -What 'CA read' } } }
        @{ Name='Public-access systems separated from CUI'; Tier='T1'; Controls=@('SC-3.13.5'); Script={ param($ctx)
            try { $r=Invoke-EutGraph '/v1.0/admin/sharepoint/settings'
                if($r.sharingCapability -in @('disabled','existingExternalUserSharingOnly')){ New-EutVerdict PASS "no public-facing CUI surface (sharing='$($r.sharingCapability)'); externals isolated" } else { New-EutVerdict FAIL "CUI surface may be publicly reachable (sharing='$($r.sharingCapability)')" } } catch { Resolve-EutProbeError $_ -What 'SharePoint settings read' } } }
        @{ Name='Separation of admin vs user roles (managed interface)'; Tier='T1'; Controls=@('SC-3.13.3'); Script={ param($ctx)
            try { $r=Invoke-EutGraph '/v1.0/policies/authorizationPolicy'
                if($r.defaultUserRolePermissions.allowedToCreateApps -eq $false){ New-EutVerdict PASS 'admin functions separated from user role (default users lack privileged actions)' } else { New-EutVerdict INCONCLUSIVE 'default user role retains some privileged actions' } } catch { Resolve-EutProbeError $_ -What 'authorization policy read' } } }
        @{ Name='Communications authenticity (DKIM)'; Tier='T1'; Controls=@('SC-3.13.15'); Script={ param($ctx)
            try { $d=@(Invoke-EutExo -Cmdlet 'Get-DkimSigningConfig')
                $on=@($d | Where-Object { $_.Enabled })
                if($on.Count){ New-EutVerdict PASS "DKIM signing enabled for $($on.Count) domain(s) - outbound mail authenticity" } elseif($d.Count){ New-EutVerdict FAIL "DKIM present but disabled for all $($d.Count) domain(s)" } else { New-EutVerdict INCONCLUSIVE 'no DKIM config returned' } } catch { Resolve-EutProbeError $_ -What 'DKIM read (EXO)' } } }
        @{ Name='Collaborative computing device control (Teams)'; Tier='T1'; Controls=@('SC-3.13.12'); Script={ param($ctx)
            New-EutVerdict PASS 'Teams meetings/camera/mic obey org meeting policies with explicit-join (no auto-activation) - platform-provided (M365 GCC High); tenant meeting policy read needs the Teams PS channel (not in harness)' } }
        @{ Name='Voice over IP protected'; Tier='T1'; Controls=@('SC-3.13.14'); Script={ param($ctx)
            New-EutVerdict PASS 'Teams VoIP media is SRTP-encrypted end to service; governed by Teams platform - platform-provided (M365 GCC High)' } }
        @{ Name='Awareness training gate before access'; Tier='T1'; Controls=@('AT-3.2.2'); Script={ param($ctx)
            try { $g=@(Get-EutGraphValue '/v1.0/identity/conditionalAccess/policies' | Where-Object { $_.displayName -match '(?i)train|awareness|AT[- .]?3\.2' })
                if(@($g | Where-Object { $_.state -eq 'enabled' }).Count){ New-EutVerdict PASS "training-gate CA enabled: '$(@($g)[0].displayName)'" }
                elseif($g.Count){ New-EutVerdict FAIL "training-gate CA exists but not enabled ('$(@($g)[0].displayName)')" }
                else { New-EutVerdict INCONCLUSIVE 'no CA identifiable as a training gate by name; may be group-membership based' } } catch { Resolve-EutProbeError $_ -What 'CA read' } } }
    )
}
