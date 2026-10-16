#!/usr/bin/env python3
# SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
# SPDX-License-Identifier: LicenseRef-BHD-Proprietary
# CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
# Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
# Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
# Submitting a change to this repository means you accept TERMS.md.
# Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
# See LICENSE and TERMS.md.

"""Generate PowerShell evidence collector script from Stamper registries."""
import json, re, os
from collections import defaultdict

STAMPER_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TENANT_SLUG = 'vfsgov-xtra'
TENANT_CONFIG = os.path.expanduser(f'~/.stamper/tenants/{TENANT_SLUG}.json')
TENANT_VARS = os.path.expanduser(f'~/.stamper/tenants/{TENANT_SLUG}/variables.json')
CMMC_REG = os.path.join(STAMPER_ROOT, 'src', 'registry', 'cmmc-l2-commands.registry.json')
INFRA_REG = os.path.join(STAMPER_ROOT, 'src', 'registry', 'infra-cmmc-l2-commands.registry.json')
OUTPUT = os.path.join(STAMPER_ROOT, 'scripts', 'assess-evidence-collector.ps1')

# ─── Load data ───────────────────────────────────────────────────

with open(CMMC_REG, encoding='utf-8') as f:
    cmmc = json.load(f)
with open(INFRA_REG, encoding='utf-8') as f:
    infra = json.load(f)

def extract_entries(data):
    if isinstance(data, list): return data
    if isinstance(data, dict):
        for k, v in data.items():
            if isinstance(v, list) and len(v) > 0 and isinstance(v[0], dict):
                return v
    return []

cmmc_entries = extract_entries(cmmc)
infra_entries = extract_entries(infra)

with open(TENANT_CONFIG, encoding='utf-8') as f:
    cfg = json.load(f)
with open(TENANT_VARS, encoding='utf-8') as f:
    vars_data = json.load(f)

all_vars = {
    'tenantId': cfg.get('tenant_id', ''),
    'appId': cfg.get('app_id', ''),
    'certThumbprint': cfg.get('cert_thumbprint', ''),
    'primaryDomain': cfg.get('primary_domain', cfg.get('domain', '')),
    'tenantName': cfg.get('domain', '').replace('.onmicrosoft.us', '').replace('.onmicrosoft.com', ''),
    'subscriptionId': cfg.get('subscription_id', ''),
    'resourceGroup': cfg.get('resource_group', ''),
    'location': cfg.get('location', ''),
}
all_vars.update(vars_data)

# ─── Resolve variables ────────────────────────────────────────────

def resolve(cmd):
    def replace_var(m):
        var_name = m.group(1)
        val = all_vars.get(var_name, '')
        if not val or str(val).startswith('[object') or str(val) == 'tbd':
            return '<' + var_name + '>'
        return str(val)
    return re.sub(r'\{(\w+)\}', replace_var, cmd)

# ─── Group by engine ──────────────────────────────────────────────

by_engine = defaultdict(list)
for entry in cmmc_entries + infra_entries:
    gc = entry.get('get_command', '').strip()
    if not gc:
        continue
    engine = entry.get('engine', 'unknown')
    by_engine[engine].append({
        'id': entry.get('entry_id', '?'),
        'cmd': resolve(gc),
        'label': entry.get('label', ''),
        'controls': ', '.join(entry.get('control_ids', [])),
        'layer': entry.get('layer_hint', 99),
        'seq': entry.get('sequence_hint', 99),
    })

for engine in by_engine:
    by_engine[engine].sort(key=lambda e: (e['layer'], e['seq']))

# ─── PowerShell escape ────────────────────────────────────────────

def ps_str(s):
    """Escape for single-quoted PowerShell string."""
    return s.replace("'", "''")

# ─── Build script ─────────────────────────────────────────────────

engine_order = ['mgraph', 'exchange', 'ipps', 'teams', 'spo', 'az']
engine_labels = {
    'mgraph': 'Microsoft Graph',
    'exchange': 'Exchange Online',
    'ipps': 'Security & Compliance',
    'teams': 'Microsoft Teams',
    'spo': 'SharePoint Online (PnP)',
    'az': 'Azure',
}
total_cmds = sum(len(entries) for entries in by_engine.values())
tenant_name = all_vars.get('tenantName', 'TENANT')
tenant_id = all_vars.get('tenantId', '')
sub_id = all_vars.get('subscriptionId', '')

out = []
out.append(f"""#Requires -Modules Microsoft.Graph, ExchangeOnlineManagement, MicrosoftTeams, PnP.PowerShell
<#
.SYNOPSIS
    Stamper Registry Evidence Collector — GCC High
    Auto-generated from CMMC L2 + Infrastructure command registries.
    Tenant: {TENANT_SLUG} ({all_vars.get('primaryDomain', '')})
    Total: {total_cmds} GET commands across {len(by_engine)} engines

.DESCRIPTION
    Connects to all M365/Azure services and runs each registry entry's
    GET command to collect evidence. Press SPACEBAR to advance, S to skip, Q to quit.

.PARAMETER SkipConnect
    Skip module connections (if already connected).
.PARAMETER NoPrompt
    Run all commands without pausing.
.PARAMETER FilterEngine
    Only run commands for this engine (mgraph, exchange, ipps, teams, spo, az).
.PARAMETER FilterControl
    Only run commands matching this control ID prefix (e.g. "AC.L2-3.1").
#>

param(
    [switch]$SkipConnect,
    [switch]$NoPrompt,
    [string]$FilterEngine,
    [string]$FilterControl
)

$ErrorActionPreference = 'Continue'
$global:entryIndex = 0
$global:passCount = 0
$global:failCount = 0
$global:skipCount = 0
$global:totalEntries = {total_cmds}

# ─── Helpers ────────────────────────────────────────────────────

function Write-EntryHeader {{
    param([string]$Id, [string]$Label, [string]$Controls, [string]$Engine, [int]$Index, [int]$Total)
    Write-Host ""
    Write-Host ("=" * 80) -ForegroundColor DarkGray
    Write-Host "[$Index/$Total] " -NoNewline -ForegroundColor Cyan
    Write-Host "$Id" -NoNewline -ForegroundColor Yellow
    Write-Host " ($Engine)" -ForegroundColor DarkGray
    if ($Label) {{ Write-Host "  $Label" -ForegroundColor White }}
    if ($Controls) {{ Write-Host "  Controls: $Controls" -ForegroundColor DarkGray }}
    Write-Host ("-" * 80) -ForegroundColor DarkGray
}}

function Wait-ForSpace {{
    if ($NoPrompt) {{ return $true }}
    Write-Host ""
    Write-Host "  Press: [SPACE] run  |  [S] skip  |  [Q] quit" -ForegroundColor DarkCyan
    while ($true) {{
        $key = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
        switch ($key.Character) {{
            ' '  {{ return $true }}
            's'  {{ return $false }}
            'S'  {{ return $false }}
            'q'  {{
                Write-Host "`nAborted by user." -ForegroundColor Red
                Show-Summary
                exit 0
            }}
            'Q'  {{
                Write-Host "`nAborted by user." -ForegroundColor Red
                Show-Summary
                exit 0
            }}
        }}
    }}
}}

function Invoke-RegistryGet {{
    param([string]$Command, [string]$EntryId)
    Write-Host "  > $Command" -ForegroundColor Gray
    try {{
        $result = Invoke-Expression $Command
        if ($null -eq $result -or ($result -is [array] -and $result.Count -eq 0)) {{
            Write-Host "  RESULT: (empty / not found)" -ForegroundColor DarkYellow
            $global:failCount++
        }} else {{
            Write-Host "  RESULT:" -ForegroundColor Green
            $result | Format-List | Out-String -Width 120 | ForEach-Object {{ Write-Host "  $_" -ForegroundColor White }}
            $global:passCount++
        }}
    }} catch {{
        Write-Host "  ERROR: $($_.Exception.Message)" -ForegroundColor Red
        $global:failCount++
    }}
}}

function Show-Summary {{
    Write-Host ""
    Write-Host ("=" * 80) -ForegroundColor Cyan
    Write-Host "  EVIDENCE COLLECTION SUMMARY" -ForegroundColor Cyan
    Write-Host ("=" * 80) -ForegroundColor Cyan
    Write-Host "  Passed:  $($global:passCount)" -ForegroundColor Green
    Write-Host "  Failed:  $($global:failCount)" -ForegroundColor Red
    Write-Host "  Skipped: $($global:skipCount)" -ForegroundColor Yellow
    Write-Host "  Total:   $($global:entryIndex) / $($global:totalEntries)" -ForegroundColor White
    Write-Host ("=" * 80) -ForegroundColor Cyan
}}

# ─── Connections (GCC High) ─────────────────────────────────────

if (-not $SkipConnect) {{
    Write-Host "`n  Connecting to GCC High services...`n" -ForegroundColor Cyan

    # 1. Microsoft Graph
    Write-Host "  [1/6] Microsoft Graph..." -ForegroundColor Yellow
    Connect-MgGraph -TenantId '{tenant_id}' -Scopes 'User.Read.All','Group.Read.All','Policy.Read.All','RoleManagement.Read.All','Directory.Read.All','DeviceManagementConfiguration.Read.All','Agreement.Read.All' -Environment USGov
    Write-Host "  Done." -ForegroundColor Green

    # 2. Exchange Online
    Write-Host "  [2/6] Exchange Online..." -ForegroundColor Yellow
    Connect-ExchangeOnline -ExchangeEnvironmentName O365USGovGCCHigh -ShowBanner:$false
    Write-Host "  Done." -ForegroundColor Green

    # 3. Security & Compliance (IPPS)
    Write-Host "  [3/6] Security & Compliance..." -ForegroundColor Yellow
    Connect-IPPSSession -ConnectionUri 'https://ps.compliance.protection.office365.us/powershell-liveid/' -AzureADAuthorizationEndpointUri 'https://login.microsoftonline.us/common'
    Write-Host "  Done." -ForegroundColor Green

    # 4. Microsoft Teams
    Write-Host "  [4/6] Microsoft Teams..." -ForegroundColor Yellow
    Connect-MicrosoftTeams -TeamsEnvironmentName TeamsGCCH
    Write-Host "  Done." -ForegroundColor Green

    # 5. SharePoint Online (PnP)
    Write-Host "  [5/6] SharePoint Online..." -ForegroundColor Yellow
    Connect-PnPOnline -Url 'https://{tenant_name}-admin.sharepoint.us' -Interactive
    Write-Host "  Done." -ForegroundColor Green

    # 6. Azure
    Write-Host "  [6/6] Azure..." -ForegroundColor Yellow
    Connect-AzAccount -Environment AzureUSGovernment -TenantId '{tenant_id}' -SubscriptionId '{sub_id}'
    Write-Host "  Done." -ForegroundColor Green

    Write-Host "`n  All services connected.`n" -ForegroundColor Green
}}
""")

# ─── Commands by engine ───────────────────────────────────────────

for engine in engine_order:
    if engine not in by_engine:
        continue
    entries = by_engine[engine]
    label = engine_labels.get(engine, engine)

    out.append(f"""
# {"=" * 70}
#  {label.upper()} — {len(entries)} entries
# {"=" * 70}

if (-not $FilterEngine -or $FilterEngine -eq '{engine}') {{
Write-Host "`n>>> {label} ({len(entries)} entries) <<<`n" -ForegroundColor Magenta
""")

    for e in entries:
        cmd_esc = ps_str(e['cmd'])
        label_esc = ps_str(e['label'])
        controls_esc = ps_str(e['controls'])
        out.append(f"""
$global:entryIndex++
if (-not $FilterControl -or '{controls_esc}' -like "*$FilterControl*") {{
    Write-EntryHeader -Id '{e["id"]}' -Label '{label_esc}' -Controls '{controls_esc}' -Engine '{engine}' -Index $global:entryIndex -Total $global:totalEntries
    if (Wait-ForSpace) {{
        Invoke-RegistryGet -Command '{cmd_esc}' -EntryId '{e["id"]}'
    }} else {{
        Write-Host "  (skipped)" -ForegroundColor Yellow
        $global:skipCount++
    }}
}}
""")

    out.append("}\n")  # close FilterEngine if

out.append("""
# ═══════════════════════════════════════════════════════════════════
#  DONE
# ═══════════════════════════════════════════════════════════════════
Show-Summary
""")

script = '\n'.join(out)
os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
with open(OUTPUT, 'w', encoding='utf-8-sig') as f:  # BOM for PowerShell
    f.write(script)

print(f'Script written to: {OUTPUT}')
print(f'Total commands: {total_cmds}')
print(f'Lines: {len(script.splitlines())}')
print(f'Engines: {", ".join(f"{e} ({len(by_engine[e])})" for e in engine_order if e in by_engine)}')
