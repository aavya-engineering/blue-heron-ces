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

# run.ps1 ??? CES end-user tenant test suite runner (G-EUT-1).
# Usage: powershell -File tenant-tests\run.ps1 -TenantSlug vfsgov [-Case UC-01]
# No slug (arg or CES_EUT_TENANT env) => prints usage, exits 0. Never part of `npm test`.
param(
    [string]$TenantSlug = $env:CES_EUT_TENANT,
    [string]$Case = ''            # optional: run a single case id, e.g. UC-01
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not $TenantSlug) {
    Write-Host "G-EUT-1 tenant test suite. Usage: run.ps1 -TenantSlug <slug> [-Case UC-NN]"
    Write-Host "No tenant slug provided (arg or CES_EUT_TENANT env var). Nothing executed."
    exit 0
}

# ---------- pre-execution static self-audit: cases must use choke-point helpers only ----------
$forbidden = 'Invoke-MgGraphRequest|Connect-MgGraph|Connect-ExchangeOnline|Connect-AzAccount|' +
             'Connect-IPPSSession|Invoke-RestMethod|Invoke-WebRequest|New-Mg|Update-Mg|Remove-Mg|' +
             'Set-Az|New-Az|Remove-Az|Set-Mg'
$violations = @()
Get-ChildItem (Join-Path $root 'cases') -Filter *.ps1 | ForEach-Object {
    $hits = Select-String -Path $_.FullName -Pattern $forbidden
    if ($hits) { $violations += $hits }
}
if ($violations.Count -gt 0) {
    Write-Host "ABORT: read-only self-audit failed. Direct API calls found in cases/:" -ForegroundColor Red
    $violations | ForEach-Object { Write-Host "  $($_.Path):$($_.LineNumber): $($_.Line.Trim())" }
    exit 2
}

Import-Module (Join-Path $root 'lib\TenantProbe.psm1') -Force

Write-Host "Connecting to tenant '$TenantSlug' (read-only)..." -ForegroundColor Cyan
$ctx = Connect-EutTenant -TenantSlug $TenantSlug

# ---------- load + execute cases ----------
$caseFiles = Get-ChildItem (Join-Path $root 'cases') -Filter *.ps1 | Sort-Object Name
if ($Case) { $caseFiles = $caseFiles | Where-Object { $_.BaseName -like "$Case*" } }

$results = @()
$startedAt = [DateTime]::UtcNow
foreach ($file in $caseFiles) {
    $CaseDef = $null
    . $file.FullName          # case file defines $CaseDef
    if ($null -eq $CaseDef) { Write-Host "WARN: $($file.Name) defined no `$CaseDef, skipping"; continue }
    Write-Host ("[{0}] {1}" -f $CaseDef.Id, $CaseDef.Name) -ForegroundColor Yellow
    foreach ($test in $CaseDef.Tests) {
        $verdict = $null
        try {
            $verdict = & $test.Script $ctx
        } catch {
            if ($_.Exception.Message -match 'READ-ONLY VIOLATION') { throw }
            $verdict = New-EutVerdict -Verdict INCONCLUSIVE -Detail "unhandled probe error: $($_.Exception.Message)"
        }
        if ($null -eq $verdict -or -not $verdict.Verdict) {
            $verdict = New-EutVerdict -Verdict INCONCLUSIVE -Detail 'test returned no verdict object'
        }
        $color = switch ($verdict.Verdict) {
            'PASS' { 'Green' } 'FAIL' { 'Red' } 'INCONCLUSIVE' { 'DarkYellow' } default { 'Gray' }
        }
        Write-Host ("    {0,-13} {1} [{2}] {3}" -f $verdict.Verdict, $test.Name, $test.Tier, $verdict.Detail) -ForegroundColor $color
        $results += [pscustomobject]@{
            CaseId    = $CaseDef.Id
            CaseName  = $CaseDef.Name
            Personas  = $CaseDef.Personas
            Practices = $CaseDef.Practices
            Test      = $test.Name
            Tier      = $test.Tier
            Controls  = @($test.Controls)
            Objectives = @($test.Objectives)
            Verdict   = $verdict.Verdict
            Detail    = $verdict.Detail
            Evidence  = $verdict.Evidence
        }
    }
}

# ---------- mission-plan applicability (G-EUT-4): emit non-failing dispositions ----------
# Loads profiles/<slug>.applicability.json and appends a disposition row per control so
# out-of-scope / attested / inherited / deferred controls show a cited disposition instead
# of appearing as FAIL or NOT_COVERED. Self-check: every such entry MUST carry an ssp_ref.
$NONFAILING = @('NOT_APPLICABLE','ATTEST','INHERITED','IN_SCOPE_DEFERRED','CES_PRODUCED')
$applPath = Join-Path $root "profiles\$TenantSlug.applicability.json"
if (Test-Path $applPath) {
    $appl = Get-Content $applPath -Raw | ConvertFrom-Json
    $missing = @($appl.dispositions | Where-Object { $_.disposition -in $NONFAILING -and -not $_.ssp_ref })
    if ($missing.Count -gt 0) {
        Write-Host "ABORT: applicability self-check failed. Entries missing ssp_ref:" -ForegroundColor Red
        $missing | ForEach-Object { Write-Host "  $($_.control) [$($_.disposition)]" }
        exit 3
    }
    Write-Host "[SCOPE] mission-plan applicability ($TenantSlug): $(@($appl.dispositions).Count) dispositioned control(s)" -ForegroundColor Cyan
    foreach ($d in $appl.dispositions) {
        $results += [pscustomobject]@{
            CaseId='SCOPE'; CaseName='Mission-plan applicability'; Personas=@(); Practices=@($d.control);
            Test="Disposition: $($d.disposition)"; Tier='scope'; Controls=@($d.control); Objectives=@($d.objectives);
            Verdict=$d.disposition; Detail="$($d.reason) [SSP: $($d.ssp_ref)]"; Evidence=@{ ssp_ref=$d.ssp_ref; reassess_when=$d.reassess_when }
        }
        Write-Host ("    {0,-16} {1} {2}" -f $d.disposition, $d.control, $d.reason) -ForegroundColor Gray
    }
}

# ---------- report ----------
$stamp = $startedAt.ToString('yyyy-MM-dd-HHmmss')
$outDir = Join-Path (Split-Path $root -Parent) "docs\tenant-tests\results"
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Force $outDir | Out-Null }

$summary = $results | Group-Object Verdict | ForEach-Object { "$($_.Name)=$($_.Count)" }
$json = [pscustomobject]@{
    tenant    = $TenantSlug
    startedAt = $startedAt.ToString('o')
    summary   = ($summary -join ' ')
    results   = $results
}
$jsonPath = Join-Path $outDir "run-$stamp.json"
$json | ConvertTo-Json -Depth 12 | Out-File $jsonPath -Encoding utf8

$md = @()
$md += "# G-EUT-1 run - tenant ``$TenantSlug`` - $($startedAt.ToString('u'))"
$md += ""
$md += "**Summary:** $($summary -join ' | ') (total $($results.Count) tests)"
$md += ""
$md += "| Case | Test | Tier | Verdict | Detail |"
$md += "|---|---|---|---|---|"
foreach ($r in $results) {
    $md += "| $($r.CaseId) | $($r.Test) | $($r.Tier) | **$($r.Verdict)** | $(($r.Detail -replace '\|', '/')) |"
}
$md += ""
$md += "## Per-persona rollup"
$md += ""
$md += "| Persona | PASS | FAIL | INCONCLUSIVE | SKIPPED |"
$md += "|---|---|---|---|---|"
$personaIds = $results | ForEach-Object { $_.Personas } | Sort-Object -Unique
foreach ($p in $personaIds) {
    $mine = $results | Where-Object { $_.Personas -contains $p }
    $c = @{}
    foreach ($v in 'PASS','FAIL','INCONCLUSIVE','SKIPPED') { $c[$v] = @($mine | Where-Object Verdict -eq $v).Count }
    $md += "| $p | $($c.PASS) | $($c.FAIL) | $($c.INCONCLUSIVE) | $($c.SKIPPED) |"
}
$mdPath = Join-Path $outDir "run-$stamp.md"
$md -join "`n" | Out-File $mdPath -Encoding utf8

Write-Host ""
Write-Host "Report: $mdPath" -ForegroundColor Cyan
Write-Host "JSON:   $jsonPath" -ForegroundColor Cyan
Write-Host ("Summary: " + ($summary -join ' | '))
if (@($results | Where-Object Verdict -eq 'FAIL').Count -gt 0) { exit 1 } else { exit 0 }
