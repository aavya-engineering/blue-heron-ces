// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODULE_MANIFEST, type ModuleManifestEntry } from './moduleManifest.js';
import { graphResolvers } from '../resolvers/graphResolvers.js';
import { azureResolvers } from '../resolvers/azureResolvers.js';
import { exoResolvers } from '../resolvers/exoResolvers.js';
import type { NamedCmdletResolverEntry } from '../resolvers/types.js';

/**
 * Cmdlets with hand-written stateful definitions in each module body. The
 * derivation engine can mint resolver-backed wrappers with the same names
 * (e.g. Connect-ExchangeOnline appears in real inventory scripts); a derived
 * wrapper emitted AFTER the manual definition silently wins PowerShell's
 * last-definition-wins rule and drops the connect-time state the manual
 * version records (Get-MgContext/Get-ConnectionInformation would then
 * return nothing — Stamper's SessionManager identity probes need it). Keep
 * the manual definitions authoritative by never emitting a derived twin.
 *
 * Deliberately NOT filtered: Set-AzContext — its derived resolver-backed
 * wrapper has shadowed the manual no-op since M3 and the G-STACKSIM-2
 * coverage baseline (503/523) was proven against that behavior.
 */
const MANUAL_GRAPH_FNS = new Set(['Connect-MgGraph', 'Get-MgContext', 'Invoke-MgGraphRequest']);
const MANUAL_AZ_FNS = new Set(['Connect-AzAccount']);
const MANUAL_EXO_FNS = new Set(['Connect-ExchangeOnline', 'Connect-IPPSSession', 'Get-ConnectionInformation']);

function namedCmdletEntries(): NamedCmdletResolverEntry[] {
  return graphResolvers.filter(
    (e): e is NamedCmdletResolverEntry => e.kind === 'cmdlet' && !MANUAL_GRAPH_FNS.has(e.cmdlet),
  );
}

/** M3: same pattern as namedCmdletEntries(), for the Az.Accounts module. */
function azNamedCmdletEntries(): NamedCmdletResolverEntry[] {
  return azureResolvers.filter(
    (e): e is NamedCmdletResolverEntry => e.kind === 'cmdlet' && !MANUAL_AZ_FNS.has(e.cmdlet),
  );
}

/** G-STACKSIM-2 iteration 2: same pattern, for the ExchangeOnlineManagement module (EXO/IPPS/SPO/misc). */
function exoNamedCmdletEntries(): NamedCmdletResolverEntry[] {
  return exoResolvers.filter(
    (e): e is NamedCmdletResolverEntry => e.kind === 'cmdlet' && !MANUAL_EXO_FNS.has(e.cmdlet),
  );
}

/**
 * Shared HTTP-client helper functions (POST to `stacksim serve`'s /resolve),
 * duplicated verbatim into every resolver-carrying module's .psm1 (M3:
 * Microsoft.Graph.Authentication and Az.Accounts) since PowerShell modules
 * do not share private function scope across separate module files.
 */
const STACKSIM_RESOLVE_HELPERS = `function Get-StacksimServerUrl {
    if ($env:STACKSIM_SERVER_URL) { return $env:STACKSIM_SERVER_URL }
    return 'http://127.0.0.1:4390'
}

function Invoke-StacksimResolve {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][ValidateSet('cmdlet', 'uri')][string]$Kind,
        [string]$Cmdlet,
        [string]$Method,
        [string]$Uri,
        $Body,
        $RequestArgs
    )
    $requestBody = @{ kind = $Kind }
    if ($Kind -eq 'cmdlet') {
        $requestBody.cmdlet = $Cmdlet
        if ($null -ne $RequestArgs) { $requestBody.args = $RequestArgs }
    } else {
        $requestBody.method = $Method
        $requestBody.uri = $Uri
        if ($null -ne $Body) {
            # Real callers pass -Body either as a raw hashtable (AO's
            # TemplateRegistry.ts, e.g. A-18) or as a pre-serialized JSON
            # string (ces-stamper's registry, e.g. IA.L2-3.5.3.fido2-enable's
            # "-Body (@{...} | ConvertTo-Json)"). Normalize a string body back
            # into an object before nesting it in $requestBody, so the outer
            # ConvertTo-Json below does not double-encode it.
            if ($Body -is [string]) {
                try { $requestBody.body = ($Body | ConvertFrom-Json) } catch { $requestBody.body = $Body }
            } else {
                $requestBody.body = $Body
            }
        }
    }
    # SIMFIX FIX-S1 (2026-09-27): a real cmdlet honors its own -ErrorAction.
    # The generated wrappers are bare functions, so -ErrorAction arrives in
    # $args instead of setting the preference; read it back here. A failed
    # resolve (e.g. the sim's honest 404 for a -UserId that names no user)
    # then behaves like the real cmdlet: silent under SilentlyContinue/Ignore,
    # terminating under Stop, a non-terminating error otherwise - carrying the
    # sim's own error text (Request_ResourceNotFound: ...), not just "(404)".
    $ea = $null
    if ($Kind -eq 'cmdlet' -and $null -ne $RequestArgs) {
        for ($i = 0; $i -lt @($RequestArgs).Count; $i++) {
            $a = @($RequestArgs)[$i]
            if ($a -is [string] -and $a -match '^-ErrorAction:?$' -and ($i + 1) -lt @($RequestArgs).Count) { $ea = [string]@($RequestArgs)[$i + 1] }
            elseif ($a -is [string] -and $a -match '^-ErrorAction:(.+)$') { $ea = $Matches[1] }
        }
    }
    $json = $requestBody | ConvertTo-Json -Depth 10
    $base = Get-StacksimServerUrl
    try {
        $response = Invoke-RestMethod -Uri "$base/resolve" -Method Post -Body $json -ContentType 'application/json'
    } catch {
        $msg = $_.Exception.Message
        $ed = $_.ErrorDetails
        if ($null -ne $ed -and $ed.Message) { try { $detail = ($ed.Message | ConvertFrom-Json).error; if ($detail) { $msg = "$msg $detail" } } catch { } }
        if ($ea -eq 'SilentlyContinue' -or $ea -eq 'Ignore') { return }
        if ($ea -eq 'Stop') { throw $msg }
        Write-Error -Message $msg
        return
    }
    return $response.data
}

# SIMFIX FIX-S2 (2026-09-27): the real Graph SDK cmdlets (and PnP's
# FieldValues) return TYPED [DateTime] values for *DateTime / *Date
# properties; ConvertFrom-Json in Windows PowerShell 5.1 leaves ISO strings.
# A caller comparing '$_.EndDateTime -lt (Get-Date)' then compares a string
# to a date (always false) - AO's C-01/C-02/C-08/G-06/G-08 filters saw
# nothing. Convert those properties back to DateTime, recursively, in place.
function ConvertTo-StacksimTypedDate {
    param($InputObject)
    if ($null -eq $InputObject) { return }
    if ($InputObject -is [System.Management.Automation.PSCustomObject]) {
        foreach ($p in @($InputObject.PSObject.Properties)) {
            $v = $p.Value
            if ($v -is [string]) {
                if ($p.Name -match '(DateTime|Date)$' -and $v -match '^\\d{4}-\\d{2}-\\d{2}(T\\d{2}:\\d{2}(:\\d{2}(\\.\\d+)?)?(Z|[+-]\\d{2}:\\d{2})?)?$') {
                    $p.Value = [DateTime]::Parse($v, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AdjustToUniversal -bor [Globalization.DateTimeStyles]::AssumeUniversal)
                }
            } elseif ($null -ne $v -and -not ($v -is [ValueType])) {
                ConvertTo-StacksimTypedDate $v
            }
        }
        return
    }
    if (($InputObject -is [System.Collections.IEnumerable]) -and -not ($InputObject -is [string])) {
        foreach ($i in $InputObject) { ConvertTo-StacksimTypedDate $i }
    }
}

# G-STACKSIM-2 iteration 3: the REAL Microsoft.Graph.Authentication SDK's
# Invoke-MgGraphRequest has its own compiled JSON deserializer and genuinely
# honors "-OutputType HashTable" (recursively - nested objects/arrays all
# become real [hashtable]/arrays too), which AO's TemplateRegistry.ts (e.g.
# A-19) relies on: a genuinely-mutable dictionary lets a caller assign a
# BRAND NEW nested key like "$cond.users.excludeUsers = @(...)" without
# error, something a plain deserialized [pscustomobject] cannot do (Windows
# PowerShell 5.1's own ConvertFrom-Json has no "-AsHashtable" flag - that
# only exists in PowerShell 6+ - so this sim needs its own recursive
# converter to reproduce the real cmdlet's -OutputType HashTable behavior).
function ConvertTo-StacksimHashtable {
    param($InputObject)
    if ($null -eq $InputObject) { return $null }
    if ($InputObject -is [System.Collections.IDictionary]) {
        $ht = @{}
        foreach ($key in @($InputObject.Keys)) { $ht[$key] = ConvertTo-StacksimHashtable $InputObject[$key] }
        return $ht
    }
    if ($InputObject -is [System.Management.Automation.PSCustomObject]) {
        $ht = @{}
        foreach ($p in $InputObject.PSObject.Properties) { $ht[$p.Name] = ConvertTo-StacksimHashtable $p.Value }
        return $ht
    }
    if (($InputObject -is [System.Collections.IEnumerable]) -and -not ($InputObject -is [string])) {
        $arr = @()
        foreach ($item in $InputObject) { $arr += , (ConvertTo-StacksimHashtable $item) }
        return , $arr
    }
    return $InputObject
}`;

/**
 * G-STACKSIM-2 iteration 2: every generated named-cmdlet wrapper is a bare
 * (non-advanced) PowerShell function - no `[CmdletBinding()]`, no `param()`.
 * A function with neither collects ALL caller arguments, including named
 * ones (`-Filter "x"`, `-All`), into the automatic `$args` array without
 * attempting strict parameter binding - real callers pass a wide variety of
 * cmdlet-specific flags (Get-MgUser -Filter/-All/-Property, etc.) that this
 * sim does not need to interpret (Read cmdlets return a valid empty/seeded
 * result regardless of filter args - PLAN.md-successor task instructions),
 * so binding strictly would only produce spurious "parameter cannot be
 * found" errors for flags this generated wrapper never needs to inspect.
 */
function cmdletWrapperFn(cmdlet: string): string {
  if (/^Get-Mg[A-Z]/.test(cmdlet) || cmdlet === 'Get-PnPListItem') {
    // SIMFIX FIX-S2: typed dates, like the real SDK/PnP objects (see ConvertTo-StacksimTypedDate).
    return `
function ${cmdlet} {
    $result = Invoke-StacksimResolve -Kind 'cmdlet' -Cmdlet '${cmdlet}' -RequestArgs $args
    if ($null -ne $result) { ConvertTo-StacksimTypedDate $result }
    return $result
}`;
  }
  if (/^Set-Az[A-Z]/.test(cmdlet) && !/Config$/.test(cmdlet)) {
    // SIMFIX FIX-S2: forward pipeline input ($nsg | Set-AzNetworkSecurityGroup)
    // as -InputObject so the sim persists THAT object (ResolverTable azObjectArg).
    return `
function ${cmdlet} {
    $callArgs = @($args)
    $piped = @($input)
    if ($piped.Count -gt 0) { $callArgs += '-InputObject'; $callArgs += ,($piped[0]) }
    Invoke-StacksimResolve -Kind 'cmdlet' -Cmdlet '${cmdlet}' -RequestArgs $callArgs
}`;
  }
  return `
function ${cmdlet} {
    Invoke-StacksimResolve -Kind 'cmdlet' -Cmdlet '${cmdlet}' -RequestArgs $args
}`;
}

/**
 * G-STACKSIM-2 iteration 3: Get-AzFirewall is the one cmdlet in this sim
 * whose real-world return value carries live script methods
 * (`.Deallocate()`/`.Allocate($vnet, $pip)` - Stamper's AZ-FW-003/004 and
 * AO's F-11/F-12 both call them directly on the object Get-AzFirewall
 * returns). JSON has no function type, so `/resolve`'s plain-data response
 * cannot carry them across the wire - this wrapper attaches them client-side
 * via `Add-Member -MemberType ScriptMethod` after deserializing, mirroring
 * what the real Az.Network SDK's compiled type already carries. Both methods
 * mutate the LOCAL in-memory `$IpConfigurations` copy only (consistent with
 * every other named-cmdlet mutation in this codebase never threading a
 * caller's actual argument values through to the store - see
 * ResolverTable.ts's resolveMutation() doc comment); the follow-on
 * `Set-AzFirewall` call is what produces the real store mutation + ledger
 * entry.
 */
function azFirewallWrapperFn(): string {
  return `
function Get-AzFirewall {
    $result = Invoke-StacksimResolve -Kind 'cmdlet' -Cmdlet 'Get-AzFirewall' -RequestArgs $args
    if ($null -ne $result) {
        $result | Add-Member -MemberType ScriptMethod -Name 'Deallocate' -Value { $this.IpConfigurations = @() } -Force
        $result | Add-Member -MemberType ScriptMethod -Name 'Allocate' -Value {
            param($VirtualNetwork, $PublicIpAddress)
            $this.IpConfigurations = @([pscustomobject]@{ Name = 'ipconfig1' })
        } -Force
    }
    return $result
}`;
}

/**
 * SIMFIX FIX-S2: the real Az.Network *Config cmdlets are CLIENT-SIDE object
 * editors - Add-AzRouteConfig / Add-AzNetworkSecurityRuleConfig /
 * Add-/Set-/Get-AzVirtualNetworkSubnetConfig change (or read) the in-memory
 * resource object they are handed and return it; nothing reaches Azure until
 * the caller pipes that object to Set-AzRouteTable / Set-AzNetworkSecurityGroup
 * / Set-AzVirtualNetwork. The sim used to POST each one as its own mutation
 * onto a singleton (nsg-1 / vnet-1) and return that, so the piped Set-* never
 * saw the rule/route/subnet (AO F-13's deny-by-default baseline could not
 * land). These wrappers reproduce the client-side behaviour.
 */
const AZ_CLIENT_SIDE_CONFIG_FNS: Record<string, string> = {
  'Add-AzRouteConfig': `
function Add-AzRouteConfig {
    $rt = Get-StacksimArg $args 'RouteTable'; $p = @($input); if ($p.Count -gt 0) { $rt = $p[0] }
    if ($null -eq $rt) { throw 'Add-AzRouteConfig: -RouteTable is required' }
    $route = [pscustomobject]@{ Name = (Get-StacksimArg $args 'Name'); AddressPrefix = (Get-StacksimArg $args 'AddressPrefix'); NextHopType = (Get-StacksimArg $args 'NextHopType'); NextHopIpAddress = (Get-StacksimArg $args 'NextHopIpAddress') }
    Set-StacksimListProp $rt 'Routes' $route
    return $rt
}`,
  'Add-AzNetworkSecurityRuleConfig': `
function Add-AzNetworkSecurityRuleConfig {
    $nsg = Get-StacksimArg $args 'NetworkSecurityGroup'; $p = @($input); if ($p.Count -gt 0) { $nsg = $p[0] }
    if ($null -eq $nsg) { throw 'Add-AzNetworkSecurityRuleConfig: -NetworkSecurityGroup is required' }
    $rule = [pscustomobject]@{}
    foreach ($n in @('Name','Description','Protocol','SourcePortRange','DestinationPortRange','SourceAddressPrefix','DestinationAddressPrefix','Access','Priority','Direction')) {
        $v = Get-StacksimArg $args $n
        if ($n -eq 'Priority' -and $null -ne $v) { $v = [int]$v }
        $rule | Add-Member -NotePropertyName $n -NotePropertyValue $v
    }
    Set-StacksimListProp $nsg 'SecurityRules' $rule
    return $nsg
}`,
  'Add-AzVirtualNetworkSubnetConfig': `
function Add-AzVirtualNetworkSubnetConfig {
    $vnet = Get-StacksimArg $args 'VirtualNetwork'; $p = @($input); if ($p.Count -gt 0) { $vnet = $p[0] }
    if ($null -eq $vnet) { throw 'Add-AzVirtualNetworkSubnetConfig: -VirtualNetwork is required' }
    $name = Get-StacksimArg $args 'Name'
    if (@($vnet.Subnets | Where-Object { $_.Name -eq $name }).Count) { throw "Subnet with the specified name $name already exists" }
    $sn = [pscustomobject]@{ Name = $name; AddressPrefix = (Get-StacksimArg $args 'AddressPrefix'); NetworkSecurityGroup = (Get-StacksimArg $args 'NetworkSecurityGroup'); RouteTable = (Get-StacksimArg $args 'RouteTable'); PrivateEndpointNetworkPolicies = 'Disabled'; PrivateEndpoints = @() }
    Set-StacksimListProp $vnet 'Subnets' $sn
    return $vnet
}`,
  'Set-AzVirtualNetworkSubnetConfig': `
function Set-AzVirtualNetworkSubnetConfig {
    $vnet = Get-StacksimArg $args 'VirtualNetwork'; $p = @($input); if ($p.Count -gt 0) { $vnet = $p[0] }
    if ($null -eq $vnet) { throw 'Set-AzVirtualNetworkSubnetConfig: -VirtualNetwork is required' }
    $name = Get-StacksimArg $args 'Name'
    $sn = @($vnet.Subnets | Where-Object { $_.Name -eq $name }) | Select-Object -First 1
    if ($null -eq $sn) { throw "Subnet $name not found in virtual network" }
    foreach ($n in @('AddressPrefix','NetworkSecurityGroup','RouteTable')) {
        if (Test-StacksimArg $args $n) {
            $v = Get-StacksimArg $args $n
            if ($sn.PSObject.Properties[$n]) { $sn.$n = $v } else { $sn | Add-Member -NotePropertyName $n -NotePropertyValue $v }
        }
    }
    return $vnet
}`,
  'Get-AzVirtualNetworkSubnetConfig': `
function Get-AzVirtualNetworkSubnetConfig {
    $vnet = Get-StacksimArg $args 'VirtualNetwork'; $p = @($input); if ($p.Count -gt 0) { $vnet = $p[0] }
    if ($null -eq $vnet) { throw 'Get-AzVirtualNetworkSubnetConfig: -VirtualNetwork is required' }
    $name = Get-StacksimArg $args 'Name'
    if ($name) { return @($vnet.Subnets | Where-Object { $_.Name -eq $name }) | Select-Object -First 1 }
    return $vnet.Subnets
}`,
};

/** Arg helpers for the client-side Az *Config wrappers (bare functions receive raw $args). */
const AZ_CLIENT_SIDE_HELPERS = `
function Get-StacksimArg {
    param($ArgList, [string]$Name)
    $a = @($ArgList)
    for ($i = 0; $i -lt $a.Count; $i++) {
        $x = $a[$i]
        if ($x -is [string] -and $x -match ('^-' + $Name + ':?$')) { if (($i + 1) -lt $a.Count) { return $a[$i + 1] } else { return $true } }
        if ($x -is [string] -and $x -match ('^-' + $Name + ':(.+)$')) { return $Matches[1] }
    }
    return $null
}
function Test-StacksimArg {
    param($ArgList, [string]$Name)
    foreach ($x in @($ArgList)) { if ($x -is [string] -and $x -match ('^-' + $Name + '(:.*)?$')) { return $true } }
    return $false
}
function Set-StacksimListProp {
    param($Obj, [string]$Prop, $Item)
    $cur = @()
    if ($Obj.PSObject.Properties[$Prop] -and $null -ne $Obj.$Prop) { $cur = @($Obj.$Prop) }
    $next = @($cur) + @($Item)
    if ($Obj.PSObject.Properties[$Prop]) { $Obj.$Prop = $next } else { $Obj | Add-Member -NotePropertyName $Prop -NotePropertyValue $next }
}`;

function azCmdletWrapperFn(cmdlet: string): string {
  if (AZ_CLIENT_SIDE_CONFIG_FNS[cmdlet]) return AZ_CLIENT_SIDE_CONFIG_FNS[cmdlet];
  return cmdlet === 'Get-AzFirewall' ? azFirewallWrapperFn() : cmdletWrapperFn(cmdlet);
}

function psd1Content(entry: ModuleManifestEntry, functionsToExport: string[]): string {
  const lines: string[] = [
    '@{',
    `    RootModule = '${entry.name}.psm1'`,
    `    ModuleVersion = '${entry.moduleVersion ?? '1.0.0'}'`,
    `    GUID = '${entry.guid}'`,
    `    Author = 'CES Tenant Stack Simulator (tenant-stacksim, generated)'`,
    `    Description = '${entry.description.replace(/'/g, "''")}'`,
    `    PowerShellVersion = '5.1'`,
    `    FunctionsToExport = @(${functionsToExport.map((f) => `'${f}'`).join(', ')})`,
    `    CmdletsToExport = @()`,
    `    VariablesToExport = @()`,
    `    AliasesToExport = @()`,
    '}',
    '',
  ];
  return lines.join('\n');
}

/**
 * Fake Microsoft.Graph.Authentication module body. All wrapper functions
 * POST `{cmdlet or uri, method, args}` to `stacksim serve`'s `/resolve`
 * endpoint and return the JSON result (Core Design (d)).
 */
function authenticationPsm1(functionsToExport: string[]): string {
  const wrapperFns = namedCmdletEntries()
    .map((e) => cmdletWrapperFn(e.cmdlet))
    .join('\n');

  return `# Generated by tenant-stacksim/src/codegen/generatePsModule.ts - do not edit by hand.
# Fake Microsoft.Graph.Authentication module (tenant-stacksim). Carries
# Connect-MgGraph, Invoke-MgGraphRequest, and all generated Get-Mg*
# wrapper functions (Core Design (d)) - PowerShell function export is
# global regardless of which module technically defines a function name,
# and this module is guaranteed to load first per SessionManager.ts's
# import order.

${STACKSIM_RESOLVE_HELPERS}

function Connect-MgGraph {
    [CmdletBinding()]
    param(
        [string]$ClientId,
        [string]$TenantId,
        [string]$CertificateThumbprint,
        [string[]]$Scopes,
        [string]$Environment,
        [switch]$NoWelcome,
        [switch]$Identity
    )
    # No-op: the sim has no real auth surface (PLAN.md Out of Scope).
    # Stamper-integration: remember what the caller connected as, so the
    # SessionManager identity probe (Get-MgContext | Select ClientId,
    # TenantId, AppName) reports the same principal a real session would.
    $script:StacksimMgContext = [pscustomobject]@{
        ClientId    = $ClientId
        TenantId    = $TenantId
        Environment = $Environment
        AppName     = 'tenant-stacksim'
        Scopes      = $Scopes
    }
}

function Get-MgContext {
    [CmdletBinding()]
    param()
    # Mirrors the real SDK: $null before Connect-MgGraph, context after.
    if ($null -ne $script:StacksimMgContext) { return $script:StacksimMgContext }
    return $null
}

function Invoke-MgGraphRequest {
    [CmdletBinding()]
    param(
        # G-STACKSIM-2 iteration 2: the real cmdlet defaults -Method to GET
        # when omitted (several real Stamper commands, e.g.
        # AC.L2-3.1.8.smart-lockout:get, rely on that default) - this
        # wrapper previously made -Method mandatory, which is the sim
        # behavioral gap the iteration-1 baseline's cluster #2 (45 items)
        # surfaced as "missing mandatory parameter".
        [string]$Method = 'GET',
        [Parameter(Mandatory = $true)][string]$Uri,
        $Body,
        [string]$OutputType,
        [string]$ContentType
    )
    $result = Invoke-StacksimResolve -Kind 'uri' -Method $Method -Uri $Uri -Body $Body
    # G-STACKSIM-2 iteration 3: mirror the real cmdlet's "-OutputType
    # HashTable" behavior (see ConvertTo-StacksimHashtable's doc comment) -
    # AO's A-19 template relies on the result being genuinely mutable
    # (assigning a brand-new nested key), which a deserialized
    # [pscustomobject] does not allow.
    if ($OutputType -eq 'HashTable' -and $null -ne $result) {
        return ConvertTo-StacksimHashtable $result
    }
    return $result
}
${wrapperFns}

Export-ModuleMember -Function ${functionsToExport.join(', ')}
`;
}

function passthroughPsm1(name: string): string {
  return `# Generated by tenant-stacksim/src/codegen/generatePsModule.ts - do not edit by hand.
# Empty pass-through fake module for "${name}" (tenant-stacksim). All
# resolver-backed cmdlets live in the Microsoft.Graph.Authentication fake
# module (Core Design (d)) - this module exists only so its
# -ErrorAction SilentlyContinue import succeeds instead of falling through
# to a real install.
`;
}

/**
 * Fake Az.Accounts module body (M3, PLAN.md Milestone Ladder row M3).
 * Carries Connect-AzAccount/Set-AzContext no-ops (returning plausible
 * AzContext-shaped objects, matching real cmdlet output shape) and all
 * generated Get-Az* wrapper functions, mirroring authenticationPsm1's
 * pattern for the Az.* surface - Az.Accounts loads first per
 * TenantProbe.psm1:Invoke-EutArm (Import-Module Az.Accounts precedes any
 * Get-Az* call).
 */
function azAccountsPsm1(functionsToExport: string[]): string {
  const wrapperFns = azNamedCmdletEntries()
    .map((e) => azCmdletWrapperFn(e.cmdlet))
    .join('\n');

  return `# Generated by tenant-stacksim/src/codegen/generatePsModule.ts - do not edit by hand.
# Fake Az.Accounts module (tenant-stacksim). Carries Connect-AzAccount,
# Set-AzContext no-ops and all generated Get-Az* wrapper functions.

${STACKSIM_RESOLVE_HELPERS}
${AZ_CLIENT_SIDE_HELPERS}

function Connect-AzAccount {
    [CmdletBinding()]
    param(
        [switch]$ServicePrincipal,
        [string]$ApplicationId,
        [string]$CertificateThumbprint,
        # Real Az.Accounts declares -Tenant with a TenantId alias; Stamper's
        # SessionManager.buildConnectCommand passes -TenantId and
        # -Subscription, so both must bind here (strict [CmdletBinding()]
        # errors on unknown parameter names).
        [Alias('TenantId')][string]$Tenant,
        [string]$Subscription,
        [string]$Environment,
        [switch]$Identity
    )
    # No-op: the sim has no real auth surface (PLAN.md Out of Scope).
    [pscustomobject]@{
        Context = [pscustomobject]@{
            Account      = [pscustomobject]@{ Id = $ApplicationId; Type = 'ServicePrincipal' }
            Tenant       = [pscustomobject]@{ Id = $Tenant }
            Subscription = [pscustomobject]@{ Id = $Subscription }
            Environment  = [pscustomobject]@{ Name = $Environment }
        }
    }
}

function Set-AzContext {
    [CmdletBinding()]
    param(
        [string]$Subscription,
        [string]$Tenant
    )
    # No-op: returns a plausible AzContext-shaped object.
    [pscustomobject]@{
        Subscription = [pscustomobject]@{ Id = $Subscription }
        Tenant       = [pscustomobject]@{ Id = $Tenant }
    }
}
${wrapperFns}

Export-ModuleMember -Function ${functionsToExport.join(', ')}
`;
}

/**
 * Fake ExchangeOnlineManagement module body (M3 no-ops; G-STACKSIM-2
 * iteration 2 adds every derived EXO/IPPS/SPO/misc wrapper function -
 * exoResolvers.ts is no longer empty, see that file's doc comment).
 * TenantProbe.psm1's Invoke-EutExo and Invoke-EutIpps choke points both
 * `Import-Module ExchangeOnlineManagement` before calling into this surface.
 */
function exchangeOnlineManagementPsm1(functionsToExport: string[]): string {
  const wrapperFns = exoNamedCmdletEntries()
    .map((e) => cmdletWrapperFn(e.cmdlet))
    .join('\n');

  return `# Generated by tenant-stacksim/src/codegen/generatePsModule.ts - do not edit by hand.
# Fake ExchangeOnlineManagement module (tenant-stacksim). Carries
# Connect-ExchangeOnline, Connect-IPPSSession no-ops plus every derived
# EXO/IPPS/SPO/misc wrapper function (G-STACKSIM-2 iteration 2).

${STACKSIM_RESOLVE_HELPERS}

function Connect-ExchangeOnline {
    [CmdletBinding()]
    param(
        [string]$AppId,
        [string]$CertificateThumbprint,
        [string]$Organization,
        [string]$ExchangeEnvironmentName,
        [switch]$ShowBanner
    )
    # No-op: the sim has no real auth surface (PLAN.md Out of Scope).
    # Stamper-integration: remember the connection so the SessionManager
    # identity probe (Get-ConnectionInformation) reports it.
    $script:StacksimExoConnection = [pscustomobject]@{
        UserPrincipalName = "$AppId@$Organization"
        Organization      = $Organization
        ConnectionUri     = 'https://stacksim.local/exchange'
        State             = 'Connected'
    }
    [pscustomobject]@{ Organization = $Organization; ExchangeEnvironmentName = $ExchangeEnvironmentName }
}

function Connect-IPPSSession {
    [CmdletBinding()]
    param(
        [string]$AppId,
        [string]$CertificateThumbprint,
        [string]$Organization,
        [string]$ConnectionUri,
        [string]$AzureADAuthorizationEndpointUri,
        [switch]$ShowBanner
    )
    # No-op: the sim has no real auth surface (PLAN.md Out of Scope).
    $script:StacksimExoConnection = [pscustomobject]@{
        UserPrincipalName = "$AppId@$Organization"
        Organization      = $Organization
        ConnectionUri     = $ConnectionUri
        State             = 'Connected'
    }
    [pscustomobject]@{ Organization = $Organization; ConnectionUri = $ConnectionUri }
}

function Get-ConnectionInformation {
    [CmdletBinding()]
    param()
    # Mirrors the real module: nothing before a Connect-* call, the
    # connection record after.
    if ($null -ne $script:StacksimExoConnection) { return $script:StacksimExoConnection }
    return $null
}
${wrapperFns}

Export-ModuleMember -Function ${functionsToExport.join(', ')}
`;
}

/**
 * Fake MicrosoftTeams module body (2026-07-10, Stamper --stacksim session
 * coverage). Parameters transcribed from SessionManager.buildConnectCommand
 * ('teams'): -TenantId -ApplicationId -CertificateThumbprint
 * -TeamsEnvironmentName TeamsGCCH. The registry's Cs* cmdlets
 * (Set/Get-CsExternalAccessPolicy) already live in the
 * ExchangeOnlineManagement fake and auto-load from there.
 */
function microsoftTeamsPsm1(functionsToExport: string[]): string {
  return `# Generated by tenant-stacksim/src/codegen/generatePsModule.ts - do not edit by hand.
# Fake MicrosoftTeams module (tenant-stacksim). Carries the
# Connect-MicrosoftTeams no-op only - Cs* cmdlets are exported by the
# ExchangeOnlineManagement fake and resolve via function auto-loading.

function Connect-MicrosoftTeams {
    [CmdletBinding()]
    param(
        [string]$TenantId,
        [string]$ApplicationId,
        [string]$CertificateThumbprint,
        [string]$TeamsEnvironmentName,
        [switch]$Identity
    )
    # No-op: the sim has no real auth surface (PLAN.md Out of Scope).
    [pscustomobject]@{
        TenantId    = $TenantId
        Account     = [pscustomobject]@{ Id = $ApplicationId; Type = 'ServicePrincipal' }
        Environment = $TeamsEnvironmentName
    }
}

Export-ModuleMember -Function ${functionsToExport.join(', ')}
`;
}

/**
 * Fake Microsoft.Online.SharePoint.PowerShell connect surface (backlog-S4).
 * Parameters transcribed from SessionManager.buildConnectCommand
 * ('sharepoint') AFTER the owner-approved thumbprint change: -Url -ClientId
 * -TenantId -CertificateThumbprint -Region. The old inline
 * `Get-ChildItem Cert:\` fetch is gone from Stamper, so nothing here ever
 * touches a real certificate store.
 */
function sharePointPsm1(functionsToExport: string[]): string {
  return `# Generated by tenant-stacksim/src/codegen/generatePsModule.ts - do not edit by hand.
# Fake Microsoft.Online.SharePoint.PowerShell module (tenant-stacksim).
# Carries the Connect-SPOService no-op only - SPO data cmdlets
# (Get-SPOTenant etc.) are exported by the ExchangeOnlineManagement fake
# and resolve via function auto-loading.

function Connect-SPOService {
    [CmdletBinding()]
    param(
        [string]$Url,
        [string]$ClientId,
        [string]$TenantId,
        [string]$CertificateThumbprint,
        [string]$Region,
        [System.Management.Automation.PSCredential]$Credential
    )
    # No-op: the sim has no real auth surface (PLAN.md Out of Scope; the
    # backlog-S4 sign-in leg is satisfied by executing the real connect
    # command shape, not by real authentication).
}

Export-ModuleMember -Function ${functionsToExport.join(', ')}
`;
}

/** SIMFIX FIX-S2 (OD-5): minimal PnP.PowerShell shim. */
function pnpPsm1(functionsToExport: string[]): string {
  return `# Generated by tenant-stacksim/src/codegen/generatePsModule.ts - do not edit by hand.
# Fake PnP.PowerShell module (tenant-stacksim): Connect-PnPOnline (no-op)
# and Get-PnPListItem backed by the sim store (founder decision OD-5).

${STACKSIM_RESOLVE_HELPERS}

function Connect-PnPOnline {
    [CmdletBinding()]
    param(
        [string]$Url,
        [string]$ClientId,
        [string]$Tenant,
        [string]$Thumbprint,
        [string]$AzureEnvironment,
        [switch]$Interactive,
        [switch]$ManagedIdentity
    )
    # No-op: the sim has no real auth surface.
    $script:StacksimPnPConnection = [pscustomobject]@{ Url = $Url }
}
${cmdletWrapperFn('Get-PnPListItem')}

Export-ModuleMember -Function ${functionsToExport.join(', ')}
`;
}

/** Emits one real-named psmodules/<ModuleName>/<ModuleName>.psd1+.psm1 per moduleManifest.ts entry. */
export async function generateAllModules(psmodulesDir: string): Promise<void> {
  const cmdletNames = namedCmdletEntries().map((e) => e.cmdlet);
  const azCmdletNames = azNamedCmdletEntries().map((e) => e.cmdlet);
  const exoCmdletNames = exoNamedCmdletEntries().map((e) => e.cmdlet);

  for (const entry of MODULE_MANIFEST) {
    const dir = path.join(psmodulesDir, entry.name);
    await fs.mkdir(dir, { recursive: true });

    let functionsToExport: string[];
    let psm1: string;

    if (entry.carriesResolvers) {
      functionsToExport = ['Connect-MgGraph', 'Get-MgContext', 'Invoke-MgGraphRequest', ...cmdletNames];
      psm1 = authenticationPsm1(functionsToExport);
    } else if (entry.carriesAzResolvers) {
      functionsToExport = ['Connect-AzAccount', 'Set-AzContext', ...azCmdletNames];
      psm1 = azAccountsPsm1(functionsToExport);
    } else if (entry.isExchangeOnlineManagement) {
      functionsToExport = ['Connect-ExchangeOnline', 'Connect-IPPSSession', 'Get-ConnectionInformation', ...exoCmdletNames];
      psm1 = exchangeOnlineManagementPsm1(functionsToExport);
    } else if (entry.isMicrosoftTeams) {
      functionsToExport = ['Connect-MicrosoftTeams'];
      psm1 = microsoftTeamsPsm1(functionsToExport);
    } else if (entry.isSharePoint) {
      functionsToExport = ['Connect-SPOService'];
      psm1 = sharePointPsm1(functionsToExport);
    } else if (entry.isPnP) {
      functionsToExport = ['Connect-PnPOnline', 'Get-PnPListItem'];
      psm1 = pnpPsm1(functionsToExport);
    } else {
      functionsToExport = [];
      psm1 = passthroughPsm1(entry.name);
    }

    await fs.writeFile(path.join(dir, `${entry.name}.psd1`), psd1Content(entry, functionsToExport), 'utf8');
    await fs.writeFile(path.join(dir, `${entry.name}.psm1`), psm1, 'utf8');
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const outDir = process.argv[2] ?? path.join(process.cwd(), 'psmodules');
  generateAllModules(outDir)
    .then(() => {
      console.log(`Generated PowerShell modules under ${outDir}`);
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
}
