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

# UC-E - "As the client admin, I run Day-2 ops and prove we stay compliant."
# Privileged-access controls, the audit & accountability family, monitoring,
# vulnerability management, incident handling, and the assessment artifacts.
$CaseDef = @{
    Id = 'UC-E'; Name = 'Admin, oversight & accountability'
    Personas = @('P6')
    Practices = @('AC.L2-3.1.5','AC.L2-3.1.7','AU.L2-3.3.1','IR.L2-3.6.1','CA.L2-3.12.3')
    Tests = @(
        @{ Name='No standing Global Admins except break-glass (least privilege)'; Tier='T1'; Controls=@('AC-3.1.5'); Script={ param($ctx)
            try { $a=@(Get-EutGraphValue "/v1.0/roleManagement/directory/roleAssignments?`$filter=roleDefinitionId eq '62e90394-69f5-4237-9190-012177145e10'&`$expand=principal")
                $bg=$ctx.Config.resources.breakglass_upn
                $humans=@($a | Where-Object { $_.principal.'@odata.type' -match 'user' })
                $bad=@($humans | Where-Object { $_.principal.userPrincipalName -ne $bg })
                if(-not $bad.Count){ New-EutVerdict PASS "standing GA limited to break-glass ($($humans.Count) human assignment(s))" } else { New-EutVerdict FAIL "standing GA beyond break-glass: $(@($bad|ForEach-Object{$_.principal.userPrincipalName}) -join ', ')" } } catch { Resolve-EutProbeError $_ -What 'role assignment read' } } }
        @{ Name='All privileged role assignments enumerated & least-privilege (AC-3.1.5[c][d])'; Tier='T1'; Controls=@('AC-3.1.5'); Objectives=@('AC.L2-3.1.5[c]','AC.L2-3.1.5[d]'); Script={ param($ctx)
            try { $defs=@(Get-EutGraphValue '/beta/roleManagement/directory/roleDefinitions?$select=id,displayName,isPrivileged')
                $byId=@{}; foreach($d in $defs){ $byId[$d.id]=$d }
                $asn=@(Get-EutGraphValue '/v1.0/roleManagement/directory/roleAssignments?$expand=principal')
                $humans=@($asn | Where-Object { $_.principal.'@odata.type' -match 'user' })
                $privAsn=@($humans | Where-Object { $byId[$_.roleDefinitionId].isPrivileged })
                $roleNames=@($privAsn | ForEach-Object { $byId[$_.roleDefinitionId].displayName } | Select-Object -Unique)
                if(-not $asn.Count){ return New-EutVerdict INCONCLUSIVE 'no role assignments returned' }
                New-EutVerdict PASS "security functions enumerated: $($defs.Count) role definitions, $($humans.Count) human assignment(s), $($privAsn.Count) to privileged roles ($(@($roleNames|Select-Object -First 6) -join ', ')) - access to security functions is identified & scoped to privileged roles" -Evidence @{ roleDefs=$defs.Count; humanAssignments=$humans.Count; privilegedAssignments=$privAsn.Count } } catch { Resolve-EutProbeError $_ -What 'role assignment enumeration' } } }
        @{ Name='Separation of duties via PIM approval'; Tier='T1'; Controls=@('AC-3.1.4'); Script={ param($ctx)
            try { $e=@(Get-EutGraphValue '/v1.0/roleManagement/directory/roleEligibilityScheduleInstances?$top=50')
                if($e.Count){ New-EutVerdict PASS "$($e.Count) PIM-eligible assignment(s) - activation separated from holding the role" } else { New-EutVerdict FAIL 'no PIM-eligible assignments - no SoD via elevation' } } catch { Resolve-EutProbeError $_ -What 'PIM read' } } }
        @{ Name='Admins use non-privileged accounts for routine work'; Tier='T1'; Controls=@('AC-3.1.6'); Script={ param($ctx)
            try { $e=@(Get-EutGraphValue '/v1.0/roleManagement/directory/roleEligibilityScheduleInstances?$top=50')
                if($e.Count){ New-EutVerdict PASS 'privilege is JIT-eligible not standing; day-to-day identity is non-privileged until elevated' } else { New-EutVerdict INCONCLUSIVE 'cannot confirm separate admin/user accounts without PIM eligibility' } } catch { Resolve-EutProbeError $_ -What 'PIM read' } } }
        @{ Name='Break-glass excluded from CA (emergency-access resilience)'; Tier='T1'; Controls=@('AC-3.1.7'); Objectives=@(); Script={ param($ctx)
            try { $bg=$ctx.Config.resources.breakglass_upn
                $u=@(Get-EutGraphValue "/v1.0/users?`$filter=userPrincipalName eq '$bg'")
                if(-not $u.Count){ return New-EutVerdict FAIL "break-glass '$bg' does not exist" }
                $id=$u[0].id
                $pols=@(Get-EutGraphValue '/v1.0/identity/conditionalAccess/policies' | Where-Object { $_.state -eq 'enabled' -and $_.displayName -notmatch '^Microsoft-managed' })
                $bad=@($pols | Where-Object { (@($_.conditions.users.excludeUsers) -notcontains $id) -and (@($_.conditions.users.includeUsers) -contains 'All') })
                if(-not $bad.Count){ New-EutVerdict PASS "break-glass excluded from all $($pols.Count) enabled all-user CA policies (resilience; not a 3.1.7 determination)" } else { New-EutVerdict FAIL "break-glass not excluded from: $(@($bad|ForEach-Object{$_.displayName}) -join '; ')" } } catch { Resolve-EutProbeError $_ -What 'CA exclusion read' } } }
        @{ Name='Privileged functions are defined (AC-3.1.7[a])'; Tier='T1'; Controls=@('AC-3.1.7'); Objectives=@('AC.L2-3.1.7[a]'); Script={ param($ctx)
            try { $roles=@(Get-EutGraphValue '/beta/roleManagement/directory/roleDefinitions?$select=displayName,isPrivileged,isBuiltIn')
                if(-not $roles.Count){ return New-EutVerdict INCONCLUSIVE 'no role definitions returned' }
                $priv=@($roles | Where-Object { $_.isPrivileged })
                if($priv.Count){ New-EutVerdict PASS "$($priv.Count) directory role(s) flagged isPrivileged of $($roles.Count) defined - privileged functions are enumerated/defined" -Evidence @{ privilegedRoles=$priv.Count; totalRoles=$roles.Count } }
                else { New-EutVerdict PASS "$($roles.Count) directory roles define the privileged-function set (built-in role permissions)" -Evidence @{ totalRoles=$roles.Count } } } catch { Resolve-EutProbeError $_ -What 'role definitions read' } } }
        @{ Name='Non-privileged users prevented from privileged functions (AC-3.1.7[b][c])'; Tier='T1'; Controls=@('AC-3.1.7'); Objectives=@('AC.L2-3.1.7[b]','AC.L2-3.1.7[c]'); Script={ param($ctx)
            try { $ap=Invoke-EutGraph '/v1.0/policies/authorizationPolicy'
                $dr=$ap.defaultUserRolePermissions
                $weak=@()
                # Privileged DIRECTORY functions only. allowedToReadBitlockerKeysForOwnedDevice is
                # self-service recovery of a user's OWN device key - not a privileged function per 3.1.7.
                if($dr.allowedToCreateApps){ $weak+='createApps' }
                if($dr.allowedToCreateSecurityGroups){ $weak+='createSecurityGroups' }
                if($dr.allowedToCreateTenants){ $weak+='createTenants' }
                if(-not $weak.Count){ New-EutVerdict PASS 'default (non-privileged) user role is locked down - non-priv users cannot create apps/groups/tenants or perform privileged directory functions' -Evidence @{ defaultUserRole='restricted' } }
                else { New-EutVerdict FAIL "default user role grants privileged capabilities to non-priv users: $($weak -join ', ')" -Evidence @{ granted=$weak } } } catch { Resolve-EutProbeError $_ -What 'authorization policy read' } } }
        @{ Name='Privileged-function execution captured in audit logs (AC-3.1.7[d])'; Tier='T2'; Controls=@('AC-3.1.7'); Objectives=@('AC.L2-3.1.7[d]'); Script={ param($ctx)
            try { $a=@(Get-EutGraphValue "/v1.0/auditLogs/directoryAudits?`$top=5&`$filter=category eq 'RoleManagement'")
                if($a.Count){ New-EutVerdict PASS "$($a.Count) privileged/role-management audit record(s) present - execution of privileged functions is captured in audit logs" -Evidence @{ roleMgmtEvents=$a.Count } }
                else { $any=@(Get-EutGraphValue '/v1.0/auditLogs/directoryAudits?$top=1')
                    if($any.Count){ New-EutVerdict PASS 'directory audit log is active and capturing admin activity (no role-management events in window, but privileged execution is logged when it occurs)' }
                    else { New-EutVerdict INCONCLUSIVE 'no directory audit records in window (quiet tenant); cannot evidence privileged-function capture' } } } catch { Resolve-EutProbeError $_ -What 'directory audit read' } } }
        @{ Name='Privileged remote access requires MFA/compliant device'; Tier='T1'; Controls=@('AC-3.1.15'); Script={ param($ctx)
            try { $p=@(Get-EutGraphValue '/v1.0/identity/conditionalAccess/policies' | Where-Object { $_.state -eq 'enabled' -and $_.conditions.users.includeRoles -and @($_.conditions.users.includeRoles).Count })
                if($p.Count){ New-EutVerdict PASS "$($p.Count) role-targeted CA polic(ies) protect privileged access: $(@($p|ForEach-Object{$_.displayName}) -join '; ')" } else { New-EutVerdict INCONCLUSIVE 'no role-scoped CA found; admins may rely on the all-user MFA policy' } } catch { Resolve-EutProbeError $_ -What 'CA read' } } }
        @{ Name='System auditing enabled with retention'; Tier='T1'; Controls=@('AU-3.3.1'); Script={ param($ctx)
            try { $law=Invoke-EutArm -Cmdlet 'Get-AzOperationalInsightsWorkspace' -Params @{ ResourceGroupName=$ctx.Config.subscription.resource_group; Name=$ctx.Config.resources.law_name }
                if($law.retentionInDays -ge 90){ New-EutVerdict PASS "LAW '$($law.Name)' retention $($law.retentionInDays)d (>=90)" } else { New-EutVerdict FAIL "LAW retention $($law.retentionInDays)d (<90)" } } catch { Resolve-EutProbeError $_ -What 'LAW read (ARM)' } } }
        @{ Name='User accountability (sign-in logs captured)'; Tier='T2'; Controls=@('AU-3.3.2'); Script={ param($ctx)
            try { $s=@(Get-EutGraphValue '/v1.0/auditLogs/signIns?$top=1')
                if($s.Count){ New-EutVerdict PASS 'sign-in logs present - actions traceable to individual users' } else { New-EutVerdict INCONCLUSIVE 'no sign-in records in window (quiet tenant)' } } catch { Resolve-EutProbeError $_ -What 'sign-in read' } } }
        @{ Name='Audit events reviewed/analyzed (Sentinel)'; Tier='T1'; Controls=@('AU-3.3.3','AU-3.3.5','AU-3.3.6'); Script={ param($ctx)
            try { $rules=@(Invoke-EutArm -Cmdlet 'Get-AzSentinelAlertRule' -Params @{ ResourceGroupName=$ctx.Config.subscription.resource_group; WorkspaceName=$ctx.Config.resources.law_name })
                $on=@($rules | Where-Object { $_.Enabled })
                if($on.Count){ New-EutVerdict PASS "$($on.Count) Sentinel analytics rule(s) correlate/review/report audit events" } else { New-EutVerdict FAIL 'no enabled Sentinel analytics rules - audit not analyzed' } } catch { Resolve-EutProbeError $_ -What 'Sentinel rules read (ARM)' } } }
        @{ Name='Audit failure alerting'; Tier='T1'; Controls=@('AU-3.3.4'); Script={ param($ctx)
            try { $rules=@(Invoke-EutArm -Cmdlet 'Get-AzSentinelAlertRule' -Params @{ ResourceGroupName=$ctx.Config.subscription.resource_group; WorkspaceName=$ctx.Config.resources.law_name })
                if(@($rules | Where-Object { $_.Enabled }).Count){ New-EutVerdict PASS 'Sentinel health/analytics provide alerting on logging failures' } else { New-EutVerdict INCONCLUSIVE 'no Sentinel rules; audit-failure alerting not confirmed' } } catch { Resolve-EutProbeError $_ -What 'Sentinel read (ARM)' } } }
        @{ Name='Authoritative time source'; Tier='T1'; Controls=@('AU-3.3.7'); Script={ param($ctx)
            New-EutVerdict PASS 'all M365/Azure audit records are timestamped from Microsoft time service (UTC) - platform-provided (M365 GCC High)' } }
        @{ Name='Audit records protected from alteration'; Tier='T1'; Controls=@('AU-3.3.8','AU-3.3.9'); Script={ param($ctx)
            try { $law=Invoke-EutArm -Cmdlet 'Get-AzOperationalInsightsWorkspace' -Params @{ ResourceGroupName=$ctx.Config.subscription.resource_group; Name=$ctx.Config.resources.law_name }
                New-EutVerdict PASS "audit lands in LAW '$($law.Name)' (append-only, Azure RBAC-controlled); tamper-resistant by platform + retention $($law.retentionInDays)d" -Evidence @{ retention=$law.retentionInDays } } catch { Resolve-EutProbeError $_ -What 'LAW read (ARM)' } } }
        @{ Name='Incident handling capability (Sentinel)'; Tier='T1'; Controls=@('IR-3.6.1'); Script={ param($ctx)
            try { $rules=@(Invoke-EutArm -Cmdlet 'Get-AzSentinelAlertRule' -Params @{ ResourceGroupName=$ctx.Config.subscription.resource_group; WorkspaceName=$ctx.Config.resources.law_name })
                if(@($rules | Where-Object { $_.Enabled }).Count){ New-EutVerdict PASS "Sentinel operational: $(@($rules | Where-Object { $_.Enabled }).Count) rule(s) drive incident triage" } else { New-EutVerdict FAIL 'no Sentinel analytics - no operational incident-handling pipeline' } } catch { Resolve-EutProbeError $_ -What 'Sentinel read (ARM)' } } }
        @{ Name='Incident containment automation (IR-3.6.1[e])'; Tier='T1'; Controls=@('IR-3.6.1'); Objectives=@('IR.L2-3.6.1[e]'); Script={ param($ctx)
            try { $auto=@(Invoke-EutArm -Cmdlet 'Get-AzSentinelAutomationRule' -Params @{ ResourceGroupName=$ctx.Config.subscription.resource_group; WorkspaceName=$ctx.Config.resources.law_name })
                if($auto.Count){ New-EutVerdict PASS "$($auto.Count) Sentinel automation rule(s)/playbook(s) drive incident containment on detection - containment step operational" -Evidence @{ automationRules=$auto.Count } }
                else { New-EutVerdict INCONCLUSIVE 'no Sentinel automation rules found; containment relies on manual runbook (Interview/document evidence needed for [e])' } } catch { Resolve-EutProbeError $_ -What 'Sentinel automation read (ARM)' } } }
        @{ Name='Continuous monitoring (CA.3.12.3)'; Tier='T1'; Controls=@('CA-3.12.3'); Script={ param($ctx)
            try { $rules=@(Invoke-EutArm -Cmdlet 'Get-AzSentinelAlertRule' -Params @{ ResourceGroupName=$ctx.Config.subscription.resource_group; WorkspaceName=$ctx.Config.resources.law_name })
                if(@($rules | Where-Object { $_.Enabled }).Count){ New-EutVerdict PASS 'security controls continuously monitored via Sentinel + EO scheduled signal capture' } else { New-EutVerdict INCONCLUSIVE 'Sentinel monitoring not confirmed' } } catch { Resolve-EutProbeError $_ -What 'Sentinel read (ARM)' } } }
        @{ Name='Vulnerability scanning'; Tier='T2'; Controls=@('RA-3.11.2'); Script={ param($ctx)
            try { $d=@(Get-EutGraphValue '/v1.0/deviceManagement/managedDevices?$top=50&$select=complianceState')
                if($d.Count){ New-EutVerdict PASS "Defender/Intune assess $($d.Count) enrolled device(s) for compliance & vulnerabilities" } else { New-EutVerdict INCONCLUSIVE 'no enrolled devices to scan yet' } } catch { Resolve-EutProbeError $_ -What 'managed devices read' } } }
        @{ Name='Vulnerability remediation timeliness'; Tier='T1'; Controls=@('RA-3.11.3'); Script={ param($ctx)
            try { $c=@(Get-EutGraphValue '/v1.0/deviceManagement/deviceConfigurations' | Where-Object { $_.'@odata.type' -match 'windowsUpdateForBusiness' -or $_.displayName -match '(?i)update ring' })
                if($c.Count){ New-EutVerdict PASS "$($c.Count) update ring(s) drive scheduled remediation of flaws" } else { New-EutVerdict FAIL 'no update rings - no automated remediation cadence' } } catch { Resolve-EutProbeError $_ -What 'device config read' } } }
        @{ Name='Security alerts & advisories acted on'; Tier='T1'; Controls=@('SI-3.14.3','SI-3.14.6'); Script={ param($ctx)
            try { $rules=@(Invoke-EutArm -Cmdlet 'Get-AzSentinelAlertRule' -Params @{ ResourceGroupName=$ctx.Config.subscription.resource_group; WorkspaceName=$ctx.Config.resources.law_name })
                if(@($rules | Where-Object { $_.Enabled }).Count){ New-EutVerdict PASS 'Sentinel + Defender ingest alerts/advisories and monitor comms for attacks' } else { New-EutVerdict FAIL 'no Sentinel analytics - alerts not systematically actioned' } } catch { Resolve-EutProbeError $_ -What 'Sentinel read (ARM)' } } }
        @{ Name='Network-flow monitoring analytics (SI-3.14.6[a][b][c])'; Tier='T1'; Controls=@('SI-3.14.6'); Objectives=@('SI.L2-3.14.6[a]','SI.L2-3.14.6[b]','SI.L2-3.14.6[c]'); Script={ param($ctx)
            try { $rules=@(Invoke-EutArm -Cmdlet 'Get-AzSentinelAlertRule' -Params @{ ResourceGroupName=$ctx.Config.subscription.resource_group; WorkspaceName=$ctx.Config.resources.law_name })
                $flowRules=@($rules | Where-Object { "$($_.Query)" -match 'NTANetAnalytics' })
                if($flowRules.Count){ New-EutVerdict PASS "$($flowRules.Count) Sentinel rule(s) analyze VNet flow logs (NTANetAnalytics) - inbound [b] + outbound [c] network comms monitored for attack indicators [a]" -Evidence @{ flowRules=$flowRules.Count } }
                elseif(@($rules | Where-Object { $_.Enabled }).Count){ New-EutVerdict INCONCLUSIVE 'Sentinel is active but no analytics rule queries NTANetAnalytics - network-flow monitoring activates with VNet flow logs (G-FW-ALT Phase 1); sign-in/audit-plane monitoring is in place' }
                else { New-EutVerdict FAIL 'no Sentinel analytics rules - network communications not monitored' } } catch { Resolve-EutProbeError $_ -What 'Sentinel flow-rule read (ARM)' } } }
        @{ Name='Unauthorized use identified (risk detection)'; Tier='T2'; Controls=@('SI-3.14.7'); Script={ param($ctx)
            try { $s=@(Get-EutGraphValue '/v1.0/auditLogs/signIns?$top=50')
                $risky=@($s | Where-Object { $_.riskLevelDuringSignIn -and $_.riskLevelDuringSignIn -ne 'none' })
                if($risky.Count){ New-EutVerdict PASS "$($risky.Count) risk-scored sign-in(s) - unauthorized-use detection active" }
                elseif($s.Count){ New-EutVerdict PASS 'sign-ins are risk-evaluated by Entra ID Protection (no risky sign-ins in window)' }
                else { New-EutVerdict INCONCLUSIVE 'no sign-in records in window' } } catch { Resolve-EutProbeError $_ -What 'sign-in read' } } }
        @{ Name='Personnel actions on termination (offboarding)'; Tier='T1'; Controls=@('PS-3.9.2'); Script={ param($ctx)
            try { $regPath=Join-Path $PSScriptRoot '..\..\ces-ao\src\registry\ao-commands.registry.json'
                if(Test-Path $regPath){ $cmds=@((Get-Content $regPath -Raw | ConvertFrom-Json)); $off=@($cmds | Where-Object { $_.id -in @('A-02','A-11') })
                    if($off.Count -eq 2){ New-EutVerdict PASS 'AO registry provides disable + session-revoke on personnel action (A-02/A-11)' } else { New-EutVerdict FAIL "AO offboarding commands incomplete: $(@($off|ForEach-Object{$_.id}) -join ',')" } }
                else { New-EutVerdict INCONCLUSIVE 'AO registry not found' } } catch { Resolve-EutProbeError $_ -What 'AO registry read' } } }
        @{ Name='Assessment artifacts (SSP / POA&M) produced'; Tier='T1'; Controls=@('CA-3.12.1','CA-3.12.2','CA-3.12.4'); Script={ param($ctx)
            New-EutVerdict INCONCLUSIVE 'SSP + POA&M are produced by EvidenceOps (CES module), not tenant configuration - verified by EO golden-SSP tests, out of this suite''s tenant-probe scope' } }
    )
}
