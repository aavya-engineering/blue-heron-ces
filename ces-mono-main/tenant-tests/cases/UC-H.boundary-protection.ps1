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

# UC-H - Boundary protection without a firewall (G-FW-ALT Phase 2).
# Examines the IaaS network boundary: NSG deny-by-default, Private Endpoints + UDR blackhole,
# VNet flow logs -> Sentinel. vfsgov has NO customer VNets today - every probe detects that and
# returns INCONCLUSIVE with a named gap (never silent, never vacuously PASS); the probes light up
# when enclave compute lands (G-FW-ALT Phase 1). Today's boundary is the identity/data plane -
# see docs/tenant-tests/boundary-architecture.md. Read-only Get-Az* via the Invoke-EutArm choke point.
$CaseDef = @{
    Id = 'UC-H'; Name = 'Boundary protection (no-firewall IaaS posture)'
    Personas = @('P6')
    Practices = @('SC.L2-3.13.1','SC.L2-3.13.6','SI.L2-3.14.6')
    Tests = @(
        @{ Name='NSG deny-by-default on all subnets (SC-3.13.6[a][b], SC-3.13.1[e][f][h])'; Tier='T1'; Controls=@('SC-3.13.6','SC-3.13.1'); Objectives=@('SC.L2-3.13.6[a]','SC.L2-3.13.6[b]','SC.L2-3.13.1[e]','SC.L2-3.13.1[f]','SC.L2-3.13.1[h]'); Script={ param($ctx)
            try {
                $vnets = @(Invoke-EutArm -Cmdlet 'Get-AzVirtualNetwork')
                if (-not $vnets.Count) { return New-EutVerdict INCONCLUSIVE 'no customer VNets exist yet - the IaaS boundary activates with enclave compute (G-FW-ALT Phase 1); today the boundary is the identity/data plane (see boundary-architecture.md)' }
                $nsgs = @(Invoke-EutArm -Cmdlet 'Get-AzNetworkSecurityGroup')
                $bad = @()
                foreach ($v in $vnets) {
                    foreach ($sn in @($v.Subnets)) {
                        # Azure prohibits NSG association on these platform subnets
                        if ($sn.Name -match '^AzureBastionSubnet$|^GatewaySubnet$|^AzureFirewallSubnet$|^AzureFirewallManagementSubnet$') { continue }
                        $nsgId = $null; if ($sn.NetworkSecurityGroup) { $nsgId = $sn.NetworkSecurityGroup.Id }
                        if (-not $nsgId) { $bad += "$($v.Name)/$($sn.Name): no NSG attached"; continue }
                        $nsg = $nsgs | Where-Object { $_.Id -eq $nsgId } | Select-Object -First 1
                        if (-not $nsg) { $bad += "$($v.Name)/$($sn.Name): NSG not readable"; continue }
                        $denyIn  = @($nsg.SecurityRules | Where-Object { $_.Access -eq 'Deny' -and $_.Direction -eq 'Inbound'  -and $_.SourceAddressPrefix -eq '*' -and $_.DestinationAddressPrefix -eq '*' -and $_.Priority -ge 4000 })
                        $denyOut = @($nsg.SecurityRules | Where-Object { $_.Access -eq 'Deny' -and $_.Direction -eq 'Outbound' -and $_.SourceAddressPrefix -eq '*' -and $_.DestinationAddressPrefix -eq '*' -and $_.Priority -ge 4000 })
                        if (-not $denyIn.Count)  { $bad += "$($v.Name)/$($sn.Name): NSG '$($nsg.Name)' lacks explicit deny-all INBOUND (priority >= 4000)" }
                        if (-not $denyOut.Count) { $bad += "$($v.Name)/$($sn.Name): NSG '$($nsg.Name)' lacks explicit deny-all OUTBOUND (priority >= 4000)" }
                    }
                }
                $pips = @(Invoke-EutArm -Cmdlet 'Get-AzPublicIpAddress')
                $attached = @($pips | Where-Object { $_.IpConfiguration })
                if ($attached.Count) { $bad += "public IP(s) attached to NIC(s): $(@($attached | ForEach-Object { $_.Name }) -join ', ')" }
                if (-not $bad.Count) { New-EutVerdict PASS "deny-by-default enforced: $($vnets.Count) VNet(s), every subnet NSG carries explicit deny-all in+out; no attached public IPs" -Evidence @{ vnets=$vnets.Count; nsgs=$nsgs.Count } }
                else { New-EutVerdict FAIL "deny-by-default gaps: $($bad -join '; ')" }
            } catch { Resolve-EutProbeError $_ -What 'NSG/VNet read (ARM)' } } }

        @{ Name='Private Endpoints + UDR blackhole (SC-3.13.1[e][f])'; Tier='T1'; Controls=@('SC-3.13.1'); Objectives=@('SC.L2-3.13.1[e]','SC.L2-3.13.1[f]'); Script={ param($ctx)
            try {
                $vnets = @(Invoke-EutArm -Cmdlet 'Get-AzVirtualNetwork')
                if (-not $vnets.Count) { return New-EutVerdict INCONCLUSIVE 'no customer VNets exist yet - Private Endpoint / UDR posture activates with enclave compute (G-FW-ALT Phase 1)' }
                $pes = @(Invoke-EutArm -Cmdlet 'Get-AzPrivateEndpoint')
                $rts = @(Invoke-EutArm -Cmdlet 'Get-AzRouteTable')
                $blackholes = @($rts | ForEach-Object { @($_.Routes) } | Where-Object { $_.AddressPrefix -eq '0.0.0.0/0' -and $_.NextHopType -eq 'None' })
                $gaps = @()
                if (-not $pes.Count) { $gaps += 'no Private Endpoints - PaaS resources reached over public endpoints' }
                if (-not $blackholes.Count) { $gaps += 'no 0.0.0.0/0 -> None blackhole route on any route table' }
                if (-not $gaps.Count) { New-EutVerdict PASS "$($pes.Count) Private Endpoint(s) + internet blackhole UDR present - egress control is private-by-design" -Evidence @{ privateEndpoints=$pes.Count; routeTables=$rts.Count } }
                else { New-EutVerdict FAIL "private-connectivity gaps: $($gaps -join '; ')" }
            } catch { Resolve-EutProbeError $_ -What 'PE/UDR read (ARM)' } } }

        @{ Name='VNet flow logs -> Sentinel (SC-3.13.1[c][d][g], SI-3.14.6[a][b][c])'; Tier='T1'; Controls=@('SC-3.13.1','SI-3.14.6'); Objectives=@('SC.L2-3.13.1[c]','SC.L2-3.13.1[d]','SC.L2-3.13.1[g]','SI.L2-3.14.6[a]','SI.L2-3.14.6[b]','SI.L2-3.14.6[c]'); Script={ param($ctx)
            try {
                $vnets = @(Invoke-EutArm -Cmdlet 'Get-AzVirtualNetwork')
                if (-not $vnets.Count) { return New-EutVerdict INCONCLUSIVE 'no customer VNets exist yet - VNet flow logging activates with enclave compute (G-FW-ALT Phase 1); M365-plane comms monitoring is examined by UC-E (Sentinel/ID Protection/unified audit)' }
                $loc = $vnets[0].Location
                $flow = @(Invoke-EutArm -Cmdlet 'Get-AzNetworkWatcherFlowLog' -Params @{ NetworkWatcherName = "NetworkWatcher_$loc"; ResourceGroupName = 'NetworkWatcherRG' })
                $vnetIds = @($vnets | ForEach-Object { $_.Id })
                $active = @($flow | Where-Object { $_.Enabled -and ($vnetIds -contains $_.TargetResourceId) })
                $rules = @(Invoke-EutArm -Cmdlet 'Get-AzSentinelAlertRule' -Params @{ ResourceGroupName = $ctx.Config.subscription.resource_group; WorkspaceName = $ctx.Config.resources.law_name })
                $flowRules = @($rules | Where-Object { "$($_.Query)" -match 'NTANetAnalytics' })
                $gaps = @()
                if (-not $active.Count) { $gaps += "no enabled VNet flow log targets any of the $($vnets.Count) VNet(s) (NSG flow logs retired Jun 2025 - use VNet flow logs)" }
                if (-not $flowRules.Count) { $gaps += 'no Sentinel analytics rule queries NTANetAnalytics' }
                if (-not $gaps.Count) { New-EutVerdict PASS "$($active.Count) VNet flow log(s) enabled + $($flowRules.Count) Sentinel NTANetAnalytics rule(s) - inbound, outbound, and internal flows monitored" -Evidence @{ flowLogs=$active.Count; flowRules=$flowRules.Count } }
                else { New-EutVerdict FAIL "flow-monitoring gaps: $($gaps -join '; ')" }
            } catch { Resolve-EutProbeError $_ -What 'flow log / Sentinel read (ARM)' } } }
    )
}
