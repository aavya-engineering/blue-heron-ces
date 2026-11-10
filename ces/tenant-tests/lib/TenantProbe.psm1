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

# TenantProbe.psm1 ??? shared harness for the CES end-user tenant test suite (G-EUT-1).
# READ-ONLY BY CONSTRUCTION: all tenant access flows through the four choke-point
# helpers below (Invoke-EutGraph / Invoke-EutExo / Invoke-EutArm / Invoke-EutIpps).
# Cases must never call Graph/EXO/ARM/IPPS directly - run.ps1 statically audits and aborts.

$script:EutContext = $null

function Get-EutTenantConfig {
    param([Parameter(Mandatory)][string]$TenantSlug)
    $path = Join-Path $HOME ".stamper\tenants\$TenantSlug.json"
    if (-not (Test-Path $path)) { throw "Tenant config not found: $path" }
    Get-Content $path -Raw | ConvertFrom-Json
}

function Connect-EutTenant {
    <# Connects the Graph channel eagerly; EXO/ARM connect lazily on first use. #>
    param([Parameter(Mandatory)][string]$TenantSlug)
    $cfg = Get-EutTenantConfig -TenantSlug $TenantSlug
    Import-Module Microsoft.Graph.Authentication -ErrorAction Stop
    Connect-MgGraph -ClientId $cfg.auth.app_id -TenantId $cfg.tenant.tenant_id `
        -CertificateThumbprint $cfg.auth.cert_thumbprint -Environment USGov -NoWelcome -ErrorAction Stop
    $script:EutContext = [pscustomobject]@{
        Slug          = $TenantSlug
        Config        = $cfg
        ExoConnected  = $false
        ArmConnected  = $false
        IppsConnected = $false
        ArmFailed     = $null   # remember a failed ARM connect so we don't retry per-case
        ExoFailed     = $null
        IppsFailed    = $null
    }
    return $script:EutContext
}

function Get-EutContext {
    if ($null -eq $script:EutContext) { throw "Connect-EutTenant has not been called" }
    $script:EutContext
}

# response cache: read-only means a URI's result is stable within a run, so ~80 probes
# that share big objects (CA policies, Intune configs, auth methods) fetch each once.
$script:EutCache = @{}

# ---------- choke point 1: Microsoft Graph (GET only, throttle-aware, cached) ----------
function Invoke-EutGraph {
    param(
        [Parameter(Mandatory)][string]$Uri,          # absolute or /v1.0|/beta relative
        [string]$Method = 'GET'
    )
    if ($Method -ne 'GET') { throw "READ-ONLY VIOLATION: Invoke-EutGraph only permits GET (got $Method)" }
    if ($script:EutCache.ContainsKey($Uri)) { return $script:EutCache[$Uri] }
    $attempt = 0
    while ($true) {
        $attempt++
        try {
            $res = Invoke-MgGraphRequest -Method GET -Uri $Uri -ErrorAction Stop
            $script:EutCache[$Uri] = $res
            return $res
        } catch {
            $resp = $_.Exception.Response
            $status = $null
            if ($resp -and $resp.StatusCode) { $status = [int]$resp.StatusCode }
            if ($status -eq 429 -and $attempt -le 3) {
                $wait = 5 * [math]::Pow(2, $attempt)
                try { $ra = $resp.Headers['Retry-After']; if ($ra) { $wait = [int]$ra } } catch {}
                Start-Sleep -Seconds $wait
                continue
            }
            throw
        }
    }
}

# ---------- choke point 2: Exchange Online PS (Get-* cmdlets only) ----------
function Invoke-EutExo {
    param(
        [Parameter(Mandatory)][string]$Cmdlet,
        [hashtable]$Params = @{}
    )
    if ($Cmdlet -notmatch '^Get-') { throw "READ-ONLY VIOLATION: Invoke-EutExo only permits Get-* cmdlets (got $Cmdlet)" }
    $ctx = Get-EutContext
    if ($ctx.ExoFailed) { throw "EXO channel unavailable: $($ctx.ExoFailed)" }
    if (-not $ctx.ExoConnected) {
        try {
            Import-Module ExchangeOnlineManagement -ErrorAction Stop
            Connect-ExchangeOnline -AppId $ctx.Config.auth.app_id `
                -CertificateThumbprint $ctx.Config.auth.cert_thumbprint `
                -Organization $ctx.Config.tenant.domain `
                -ExchangeEnvironmentName $ctx.Config.endpoints.exchange_env `
                -ShowBanner:$false -ErrorAction Stop
            $ctx.ExoConnected = $true
        } catch {
            $ctx.ExoFailed = $_.Exception.Message
            throw "EXO channel unavailable: $($ctx.ExoFailed)"
        }
    }
    & $Cmdlet @Params
}

# ---------- choke point 4: Security & Compliance PS / IPPS (Get-* cmdlets only) ----------
# Covers Purview sensitivity labels + DLP (MP-3.8.1/2/4 media protection, AC-3.1.3 CUI flow).
# App-only cert auth; GCC High compliance endpoint. Read-only: Get-* cmdlets only.
function Invoke-EutIpps {
    param(
        [Parameter(Mandatory)][string]$Cmdlet,
        [hashtable]$Params = @{}
    )
    if ($Cmdlet -notmatch '^Get-') { throw "READ-ONLY VIOLATION: Invoke-EutIpps only permits Get-* cmdlets (got $Cmdlet)" }
    $ctx = Get-EutContext
    if ($ctx.IppsFailed) { throw "IPPS channel unavailable: $($ctx.IppsFailed)" }
    if (-not $ctx.IppsConnected) {
        try {
            Import-Module ExchangeOnlineManagement -ErrorAction Stop
            # GCC High Security & Compliance endpoints (overridable via config.endpoints.*).
            $ippsUri = if ($ctx.Config.endpoints.ipps_connection_uri) { $ctx.Config.endpoints.ipps_connection_uri } else { 'https://ps.compliance.protection.office365.us/powershell-liveid/' }
            $aadUri  = if ($ctx.Config.endpoints.aad_authorization_uri) { $ctx.Config.endpoints.aad_authorization_uri } else { 'https://login.microsoftonline.us/organizations' }
            Connect-IPPSSession -AppId $ctx.Config.auth.app_id `
                -CertificateThumbprint $ctx.Config.auth.cert_thumbprint `
                -Organization $ctx.Config.tenant.domain `
                -ConnectionUri $ippsUri `
                -AzureADAuthorizationEndpointUri $aadUri `
                -ShowBanner:$false -ErrorAction Stop
            $ctx.IppsConnected = $true
        } catch {
            $ctx.IppsFailed = $_.Exception.Message
            throw "IPPS channel unavailable: $($ctx.IppsFailed)"
        }
    }
    & $Cmdlet @Params
}

# ---------- choke point 3: ARM via Az modules (Get-Az* cmdlets only) ----------
function Invoke-EutArm {
    param(
        [Parameter(Mandatory)][string]$Cmdlet,
        [hashtable]$Params = @{}
    )
    if ($Cmdlet -notmatch '^Get-Az') { throw "READ-ONLY VIOLATION: Invoke-EutArm only permits Get-Az* cmdlets (got $Cmdlet)" }
    $ctx = Get-EutContext
    if ($ctx.ArmFailed) { throw "ARM channel unavailable: $($ctx.ArmFailed)" }
    if (-not $ctx.ArmConnected) {
        try {
            Import-Module Az.Accounts -ErrorAction Stop
            $null = Connect-AzAccount -ServicePrincipal -ApplicationId $ctx.Config.auth.app_id `
                -CertificateThumbprint $ctx.Config.auth.cert_thumbprint `
                -Tenant $ctx.Config.tenant.tenant_id -Environment AzureUSGovernment -ErrorAction Stop
            $null = Set-AzContext -Subscription $ctx.Config.subscription.subscription_id -ErrorAction Stop
            $ctx.ArmConnected = $true
        } catch {
            $ctx.ArmFailed = $_.Exception.Message
            throw "ARM channel unavailable: $($ctx.ArmFailed)"
        }
    }
    & $Cmdlet @Params
}

# convenience: return the .value array of a Graph collection (cached), always an array.
function Get-EutGraphValue {
    param([Parameter(Mandatory)][string]$Uri)
    $r = Invoke-EutGraph -Uri $Uri
    return @($r.value)
}

# ---------- verdicts ----------
function New-EutVerdict {
    <# The only way a test reports. Verdict semantics per docs/G-EUT-1-plan.md. #>
    param(
        [Parameter(Mandatory)][ValidateSet('PASS','FAIL','INCONCLUSIVE','SKIPPED','BLOCKED')][string]$Verdict,
        [Parameter(Mandatory)][string]$Detail,
        $Evidence = $null
    )
    [pscustomobject]@{ Verdict = $Verdict; Detail = $Detail; Evidence = $Evidence }
}

function Resolve-EutProbeError {
    <# Uniform disposition for probe exceptions: channel-missing/403/404 => INCONCLUSIVE
       or SKIPPED (never FAIL ??? a FAIL must mean the control is verifiably not enforced). #>
    param([Parameter(Mandatory)]$ErrorRecord, [string]$What = 'probe')
    $msg = $ErrorRecord.Exception.Message
    if ($msg -match 'READ-ONLY VIOLATION') { throw $ErrorRecord }
    if ($msg -match 'channel unavailable') {
        return New-EutVerdict -Verdict SKIPPED -Detail "$What skipped - $msg"
    }
    if ($msg -match '(?i)403|Forbidden|Authorization_RequestDenied') {
        return New-EutVerdict -Verdict INCONCLUSIVE -Detail "$What denied (missing permission): $msg"
    }
    if ($msg -match '(?i)404|ResourceNotFound|Request_ResourceNotFound') {
        return New-EutVerdict -Verdict INCONCLUSIVE -Detail "$What endpoint/resource not found: $msg"
    }
    return New-EutVerdict -Verdict INCONCLUSIVE -Detail "$What error: $msg"
}

Export-ModuleMember -Function Get-EutTenantConfig, Connect-EutTenant, Get-EutContext, `
    Invoke-EutGraph, Get-EutGraphValue, Invoke-EutExo, Invoke-EutArm, Invoke-EutIpps, New-EutVerdict, Resolve-EutProbeError
