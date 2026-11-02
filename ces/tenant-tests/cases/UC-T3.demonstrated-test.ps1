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

# UC-T3 - the demonstrated-Test tier (G-EUT-5 Phase 4).
# Closes the NIST SP 800-171A "Test" method for the objectives that allow it: a real or
# synthetic persona walks a path and we look for the demonstration in the tenant's own logs
# (read-only, evidence-of-Test - we never perform the destructive action ourselves).
#
# Requires test personas provisioned in the tenant config under resources.t3:
#   t3.licensed_user_upn     - a licensed P1-like test user (for weak-password / MFA demos)
#   t3.unenrolled_device_id  - a non-compliant/unenrolled device identity (for CA-block demos)
#   t3.external_address       - an external email/domain (for blocked-share / DLP demos)
# Absent inputs render as BLOCKED:<input> (non-failing, visibly incomplete) - never a hollow PASS.
$CaseDef = @{
    Id = 'UC-T3'; Name = 'Demonstrated-Test tier (persona-driven)'
    Personas = @('P1','P7','P8')
    Practices = @('IA.L2-3.5.7','AC.L2-3.1.18','AC.L2-3.1.3','SC.L2-3.13.5')
    Tests = @(
        @{ Name='Non-compliant device sign-in is denied (Test: AC-3.1.18[b])'; Tier='T3'; Controls=@('AC-3.1.18'); Objectives=@('AC.L2-3.1.18[b]'); Script={ param($ctx)
            try {
                $dev=$ctx.Config.resources.t3.unenrolled_device_id
                if(-not $dev){ return New-EutVerdict BLOCKED 'BLOCKED: needs T3 test persona (unenrolled/non-compliant device identity) to demonstrate a denied non-compliant sign-in' }
                $s=@(Get-EutGraphValue "/v1.0/auditLogs/signIns?`$top=50&`$filter=deviceDetail/deviceId eq '$dev'")
                $blocked=@($s | Where-Object { $_.conditionalAccessStatus -eq 'failure' -or $_.status.errorCode -ne 0 })
                if($blocked.Count){ New-EutVerdict PASS "demonstrated: $($blocked.Count) sign-in(s) from the non-compliant test device were blocked by CA - Test method satisfied" -Evidence @{ blockedSignIns=$blocked.Count } }
                elseif($s.Count){ New-EutVerdict INCONCLUSIVE "test device has $($s.Count) sign-in(s) but none blocked in window - run the demonstration (attempt access from the non-compliant device) to generate Test evidence" }
                else { New-EutVerdict INCONCLUSIVE 'test device configured but no sign-ins in window - run the demonstration to generate Test evidence' }
            } catch { Resolve-EutProbeError $_ -What 'T3 device sign-in read' } } }

        @{ Name='Weak password is rejected (Test: IA-3.5.7[a])'; Tier='T3'; Controls=@('IA-3.5.7'); Objectives=@('IA.L2-3.5.7[a]'); Script={ param($ctx)
            try {
                $u=$ctx.Config.resources.t3.licensed_user_upn
                if(-not $u){ return New-EutVerdict BLOCKED 'BLOCKED: needs T3 test persona (licensed test user) to demonstrate a rejected weak/banned password' }
                # Read-only cannot force a password reset; look for the audit trail of a self-service
                # password change that was rejected by policy for the test user.
                $a=@(Get-EutGraphValue "/v1.0/auditLogs/directoryAudits?`$top=25&`$filter=activityDisplayName eq 'Reset password (self-service)'")
                $mine=@($a | Where-Object { @($_.targetResources.userPrincipalName) -contains $u })
                $rejected=@($mine | Where-Object { $_.result -ne 'success' })
                if($rejected.Count){ New-EutVerdict PASS "demonstrated: $($rejected.Count) weak/banned password attempt(s) for the test user were rejected by policy - Test method satisfied" -Evidence @{ rejected=$rejected.Count } }
                else { New-EutVerdict INCONCLUSIVE 'test user configured but no rejected-password audit in window - run the demonstration (attempt a banned password) to generate Test evidence' }
            } catch { Resolve-EutProbeError $_ -What 'T3 password audit read' } } }

        @{ Name='External CUI share is blocked (Test: SC-3.13.5[b])'; Tier='T3'; Controls=@('SC-3.13.5','AC-3.1.3'); Objectives=@('SC.L1-3.13.5[b]'); Script={ param($ctx)
            try {
                $ext=$ctx.Config.resources.t3.external_address
                if(-not $ext){ return New-EutVerdict BLOCKED 'BLOCKED: needs T3 test persona (external email/domain) to demonstrate a blocked CUI share to an external recipient' }
                # Evidence-of-Test: a DLP/sharing block event naming the external address. IPPS/Purview
                # channel is not in the harness, so this facet stays BLOCKED on the channel, not faked.
                New-EutVerdict BLOCKED "BLOCKED: needs Security & Compliance PS (IPPS) channel to read the DLP/sharing block event for '$ext' - external-share demonstration cannot be evidenced via Graph/EXO alone"
            } catch { Resolve-EutProbeError $_ -What 'T3 external-share read' } } }

        @{ Name='MFA challenge enforced for test persona (Test: IA-3.5.3[c])'; Tier='T3'; Controls=@('IA-3.5.3'); Objectives=@('IA.L2-3.5.3[c]'); Script={ param($ctx)
            try {
                $u=$ctx.Config.resources.t3.licensed_user_upn
                if(-not $u){ return New-EutVerdict BLOCKED 'BLOCKED: needs T3 test persona (licensed test user) to demonstrate an enforced MFA challenge' }
                $s=@(Get-EutGraphValue "/v1.0/auditLogs/signIns?`$top=50&`$filter=userPrincipalName eq '$u'")
                $mfa=@($s | Where-Object { @($_.authenticationRequirement) -contains 'multiFactorAuthentication' -or ($_.mfaDetail -and $_.mfaDetail.authMethod) })
                if($mfa.Count){ New-EutVerdict PASS "demonstrated: $($mfa.Count) sign-in(s) for the test user were MFA-challenged - Test method satisfied" -Evidence @{ mfaSignIns=$mfa.Count } }
                elseif($s.Count){ New-EutVerdict INCONCLUSIVE "test user has $($s.Count) sign-in(s) but none show an MFA requirement in window - run the demonstration (sign in as the test user) to generate Test evidence" }
                else { New-EutVerdict INCONCLUSIVE 'test user configured but no sign-ins in window - run the demonstration to generate Test evidence' }
            } catch { Resolve-EutProbeError $_ -What 'T3 MFA sign-in read' } } }
    )
}
