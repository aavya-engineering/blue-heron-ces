<#
  SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
  SPDX-License-Identifier: LicenseRef-BHD-Proprietary
  CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
  Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
  Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
  Submitting a change to this repository means you accept TERMS.md.
  Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
  See LICENSE and TERMS.md.
#>

# G-STACKSIM-2 iteration 4: fake `az` CLI shim.
#
# Routes every recognized `az` invocation to `stacksim serve`'s /resolve
# endpoint (the exact same {kind:'uri', method, uri, body} request shape and
# ResolverTable.resolveUri() dispatch path generatePsModule.ts's
# Invoke-MgGraphRequest wrapper already uses - see
# src/resolvers/azCliResolvers.ts for the resolver entries this shim's
# synthetic /azcli/... paths and real ARM `az rest` paths match against).
#
# Never falls through to the real Azure CLI: an unrecognized az subcommand
# shape is a hard failure (stderr message + non-zero exit), not a silent
# success and not a delegated call to the real `az` (which stays installed
# on this box but is only reachable when azshim\ is NOT first on PATH).

$ErrorActionPreference = 'Stop'

function Get-StacksimServerUrl {
    if ($env:STACKSIM_SERVER_URL) { return $env:STACKSIM_SERVER_URL }
    return 'http://127.0.0.1:4390'
}

function Invoke-AzShimResolve {
    param(
        [Parameter(Mandatory = $true)][string]$Method,
        [Parameter(Mandatory = $true)][string]$Uri,
        $Body
    )
    $requestBody = @{ kind = 'uri'; method = $Method; uri = $Uri }
    if ($null -ne $Body) { $requestBody.body = $Body }
    $json = $requestBody | ConvertTo-Json -Depth 10
    $base = Get-StacksimServerUrl
    $response = Invoke-RestMethod -Uri "$base/resolve" -Method Post -Body $json -ContentType 'application/json'
    return $response.data
}

function Resolve-AzRestBody {
    param($RawBody)
    if ($null -eq $RawBody) { return $null }
    $text = $RawBody.ToString()
    if ($text.StartsWith('@')) {
        # Real `az rest` convention: "@<path>" reads the request body from a
        # file (e.g. Stamper's AU.L2-3.3.3.sentinel-connector:set writes a
        # temp JSON file via Set-Content, then passes "--body `"@$f`"").
        $filePath = $text.Substring(1)
        $text = Get-Content -Path $filePath -Raw
    }
    if ([string]::IsNullOrWhiteSpace($text)) { return $null }
    try { return ($text | ConvertFrom-Json) } catch { return $text }
}

function Normalize-AzRestMethod {
    param([string]$Method)
    # ResolverTable's MutationVerb union is 'POST' | 'PATCH' | 'DELETE' - no
    # 'PUT'. Real `az rest --method PUT` is an idempotent create-or-replace
    # call; ResolverTable's PATCH path already does a create-or-merge-patch
    # (ObjectStore.upsert), the closest honest equivalent this sim's
    # mutation model supports without widening ResolverTable's verb union
    # for one CLI caller (see IMPLEMENTATION_LOG.md G-STACKSIM-2 iteration 4
    # Deviations).
    $upper = $Method.ToUpper()
    if ($upper -eq 'PUT') { return 'PATCH' }
    return $upper
}

# ---- argv parsing: leading non-flag tokens are the "verb path"
# (e.g. "keyvault key rotate"), everything after the first "-..." token is
# --flag/value pairs (last-wins). This mirrors how every az command this
# shim needs to support is actually shaped (verb tokens, then flags) - see
# each `switch` branch below for the exact verb paths Stamper/AO reference.
$argv = $args
$verbTokens = @()
$i = 0
while ($i -lt $argv.Count -and -not ($argv[$i].ToString().StartsWith('-'))) {
    $verbTokens += $argv[$i].ToString()
    $i++
}
$verbPath = $verbTokens -join ' '

$flags = @{}
while ($i -lt $argv.Count) {
    $tok = $argv[$i].ToString()
    if ($tok.StartsWith('-')) {
        $name = $tok.TrimStart('-')
        if ($name -eq 'o') { $name = 'output' }
        if ($i + 1 -lt $argv.Count) {
            $flags[$name] = $argv[$i + 1]
            $i += 2
        } else {
            $flags[$name] = $true
            $i += 1
        }
    } else {
        $i += 1
    }
}

try {
    $result = $null
    switch ($verbPath) {
        'rest' {
            if (-not $flags.ContainsKey('method') -or -not $flags.ContainsKey('url')) {
                throw "az-shim: 'az rest' requires --method and --url"
            }
            $method = Normalize-AzRestMethod -Method $flags['method'].ToString()
            $body = Resolve-AzRestBody -RawBody $flags['body']
            $result = Invoke-AzShimResolve -Method $method -Uri $flags['url'].ToString() -Body $body
        }
        'advisor recommendation list' {
            $result = Invoke-AzShimResolve -Method 'GET' -Uri '/azcli/advisor/recommendations'
        }
        'sentinel data-connector list' {
            $result = Invoke-AzShimResolve -Method 'GET' -Uri '/azcli/sentinel/dataConnectors'
        }
        'keyvault certificate list' {
            $vault = $flags['vault-name']
            $result = Invoke-AzShimResolve -Method 'GET' -Uri "/azcli/keyvault/$vault/certificates"
        }
        'keyvault key rotate' {
            $vault = $flags['vault-name']
            $name = $flags['name']
            $result = Invoke-AzShimResolve -Method 'PATCH' -Uri "/azcli/keyvault/$vault/keys/$name" -Body @{ rotated = $true }
        }
        'keyvault key show' {
            $vault = $flags['vault-name']
            $name = $flags['name']
            $result = Invoke-AzShimResolve -Method 'GET' -Uri "/azcli/keyvault/$vault/keys/$name"
        }
        'ad auth password-policy show' {
            $result = Invoke-AzShimResolve -Method 'GET' -Uri '/azcli/ad/authPasswordPolicy'
        }
        'monitor log-analytics workspace update' {
            $workspace = $flags['workspace-name']
            $retention = $flags['retention-time']
            $result = Invoke-AzShimResolve -Method 'PATCH' -Uri "/azcli/monitor/logAnalyticsWorkspace/$workspace" -Body @{ retentionInDays = $retention }
        }
        'monitor diagnostic-settings list' {
            $result = Invoke-AzShimResolve -Method 'GET' -Uri '/azcli/monitor/diagnosticSettings'
        }
        'network nsg list' {
            $result = Invoke-AzShimResolve -Method 'GET' -Uri '/azcli/network/nsgs'
        }
        'network nsg rule list' {
            $nsg = $flags['nsg-name']
            $result = Invoke-AzShimResolve -Method 'GET' -Uri "/azcli/network/nsgs/$nsg/rules"
        }
        'resource update' {
            $ids = $flags['ids']
            $setArg = $flags['set']
            $body = @{}
            if ($setArg) {
                $parts = $setArg.ToString().Split('=', 2)
                $propName = $parts[0] -replace '^properties\.', ''
                $propValue = if ($parts.Count -gt 1) { $parts[1].Trim("'", '"') } else { $null }
                $body[$propName] = $propValue
            }
            # SIMFIX: a real --ids value is a full ARM resource id (it contains
            # '/'); escape it into ONE path segment so the sim can address it.
            $idSeg = [uri]::EscapeDataString([string]$ids)
            $result = Invoke-AzShimResolve -Method 'PATCH' -Uri "/azcli/resource/$idSeg" -Body $body
        }
        'backup job list' {
            $result = Invoke-AzShimResolve -Method 'GET' -Uri '/azcli/backup/jobs'
        }
        default {
            throw "az-shim: unsupported az subcommand shape 'az $verbPath' - no route mapped (never falls through to the real az CLI)."
        }
    }
    if ($null -ne $result) {
        $result | ConvertTo-Json -Depth 10 -Compress
    }
    exit 0
} catch {
    [Console]::Error.WriteLine("az-shim error: $($_.Exception.Message)")
    exit 1
}
