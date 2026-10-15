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

# Clone the five CES repositories into the required layout, install, build and test.
# Usage: pwsh scripts/bootstrap.ps1 [-Root <dir>]   (default: .\ces)
param([string]$Root = (Join-Path (Get-Location) 'ces'))

$ErrorActionPreference = 'Continue'
$Org = 'https://github.com/blue-heron-defense-CES'

function Clone-Repo([string]$Repo, [string]$Dir) {
  if (Test-Path (Join-Path $Dir '.git')) { Write-Host "exists: $Dir"; return }
  git clone "$Org/$Repo.git" $Dir
  if ($LASTEXITCODE -ne 0) { throw "clone failed: $Repo" }
}

Clone-Repo 'ces-mono' $Root
Clone-Repo 'ces-tenant' (Join-Path $Root 'ces-tenant')
Clone-Repo 'ces-muster' (Join-Path $Root 'ces-muster')
Clone-Repo 'ces-tester' (Join-Path $Root 'ces-tester')
Clone-Repo 'ces-stacksim' (Join-Path $Root 'tenant-stacksim')

$RootAbs = (Resolve-Path $Root).Path
$Failed = @()

function Step([string]$Label, [string]$Dir, [string[]]$Cmd) {
  Write-Host "==> $Label"
  Push-Location (Join-Path $RootAbs $Dir)
  try {
    & $Cmd[0] $Cmd[1..($Cmd.Length - 1)]
    if ($LASTEXITCODE -eq 0) { Write-Host "OK   $Label" } else { Write-Host "FAIL $Label"; $script:Failed += $Label }
  } finally { Pop-Location }
}

Step 'install ces-tenant' 'ces-tenant' @('npm', 'install')
Step 'build ces-tenant' 'ces-tenant' @('npm', 'run', 'build')
Step 'install ces-mono' '.' @('npm', 'install')
Step 'build ces-shared' '.' @('npm', 'run', 'build:shared')
Step 'build ces-stamper' '.' @('npm', 'run', 'build:stamper')
Step 'install tenant-stacksim' 'tenant-stacksim' @('npm', 'install')
Step 'install ces-tester' 'ces-tester' @('npm', 'install')
Step 'install ces-muster' 'ces-muster' @('npm', 'install')
Step 'install muster-api' 'ces-muster/muster-api' @('npm', 'install')

Step 'test ces-tenant' 'ces-tenant' @('npm', 'test')
Step 'test ces-shared' '.' @('npm', 'run', 'test:shared')
Step 'test ces-stamper' '.' @('npm', 'run', 'test:stamper')
Step 'test ces-eo' '.' @('npm', 'run', 'test:eo')
Step 'test ces-ao' '.' @('npm', 'run', 'test:ao')
Step 'test ces-ec' '.' @('npm', 'run', 'test:ec')
Step 'test ces-planner' 'ces-planner' @('npx', 'vitest', 'run')
Step 'test tenant-stacksim' 'tenant-stacksim' @('npm', 'test')
Step 'test ces-tester' 'ces-tester' @('npm', 'test')
Step 'test ces-muster' 'ces-muster' @('npm', 'test')
Step 'test muster-api' 'ces-muster/muster-api' @('npm', 'test')

if ($Failed.Count -gt 0) { Write-Host "Failed steps: $($Failed -join ', ')"; exit 1 }
Write-Host 'All steps passed.'
