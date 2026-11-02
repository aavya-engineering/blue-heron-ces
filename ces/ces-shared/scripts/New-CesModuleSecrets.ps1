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

<#
.SYNOPSIS
  SP-4 (SECRETS-PLAN.md section 3): install-time generator for the CES module-secret store.

.DESCRIPTION
  Makes every CES module secret with a CSPRNG (cryptographically secure random number generator)
  on this machine, protects the set with DPAPI (Windows Data Protection API) and writes the store
  file that ces-shared/src/secrets/moduleSecrets.ts reads. Values are never printed, logged or
  put on a command line; only the secret NAMES are reported.

  Scope:
    CurrentUser (default) - DPAPI user scope of the account that RUNS this script. For a service,
    run it as that service's virtual account (NT SERVICE\<name>) or gMSA, not as a local user, so
    an administrator password reset cannot orphan the key (spike SP-0(b), options paper O1).
    LocalMachine - any process on this machine can unprotect; the file ACL is the only guard.

  The store fails closed if the service is renamed or re-created, its profile is deleted, the VM is
  restored from a sysprep'd image, or the file is copied to another VM. Recovery: re-run this
  script with -Force (then restart the modules; old tokens stop working).

.PARAMETER Path
  Store file. Default: %ProgramData%\CES\secrets\module-secrets.dpapi.

.PARAMETER ServiceAccount
  Account granted read on the store (with Administrators and SYSTEM). Default: NT SERVICE\CES.

.PARAMETER MusterTenantId
  PH7-SEC (KI-02, known issue 02 in the handoff kit's KNOWN-ISSUES.md): CES_MUSTER_SECRETS_TOKEN is
  not random. It is a muster-api login token: a JWT (JSON Web Token) signed HS256 with the JWT_SECRET
  made in the same run, carrying role bhd_operator, the way muster-api's POST
  /api/plan/secrets/resolve requires (ces-muster/muster-api/src/routes/plan.ts). Same claims as the
  kit helper handoff/lib/Set-MusterSecretsToken.ps1. This is the token's tenant_id: it must be the
  tenant_id of the operator token that compiled the plan (muster-api releases an issued secret only
  to that tenant). Default: mx-sim-tenant (the kit helper's default, the simulator run).

.PARAMETER MusterTokenSubject
  The token's sub claim. Default: ces-stamper.

.PARAMETER MusterTokenHours
  Token lifetime in whole hours. Default 8 (muster-api's own default). After it expires, renew the
  token with the kit helper Set-MusterSecretsToken.ps1 (re-running this script with -Force rotates
  every secret).

.PARAMETER NoAcl
  Skip the ACL step (tests on temp folders only).

.PARAMETER Force
  Replace an existing store.
#>
[CmdletBinding()]
param(
  [string]$Path = (Join-Path $env:ProgramData 'CES\secrets\module-secrets.dpapi'),
  [ValidateSet('CurrentUser', 'LocalMachine')]
  [string]$Scope = 'CurrentUser',
  [string[]]$Names = @(
    'CES_AO_AUTH_TOKEN',
    'CES_EO_AUTH_TOKEN',
    'CES_STAMPER_AUTH_TOKEN',
    'CES_AO_PRINCIPAL_SECRET',
    'CES_EC_PRINCIPAL_SECRET',
    'CES_EO_OPERATOR_SECRET',
    'EVIDENCE_OPS_SECRET',
    'JWT_SECRET',
    'CES_MUSTER_SECRETS_TOKEN'
  ),
  [string]$ServiceAccount = 'NT SERVICE\CES',
  [string]$MusterTenantId = 'mx-sim-tenant',
  [string]$MusterTokenSubject = 'ces-stamper',
  [ValidateRange(1, 8760)]
  [int]$MusterTokenHours = 8,
  [switch]$NoAcl,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2

# Must match ces-shared/src/secrets (dpapi.ts DPAPI_ENTROPY, moduleSecrets.ts MODULE_SECRETS_FORMAT).
$Entropy = 'CES-MODULE-SECRETS-v1'
$Format = 'ces-module-secrets/1'

function Test-ModuleSecretName([string]$n) {
  return ($n -cmatch '^CES_[A-Z0-9_]+_AUTH_TOKEN$') -or
         ($n -cmatch '^CES_[A-Z0-9_]+_PRINCIPAL_SECRET$') -or
         (@('EVIDENCE_OPS_SECRET', 'JWT_SECRET', 'CES_MUSTER_SECRETS_TOKEN', 'CES_EO_OPERATOR_SECRET', 'DATABASE_URL', 'ANTHROPIC_API_KEY') -ccontains $n)
}

$unique = @($Names | Sort-Object -Unique)
foreach ($n in $unique) {
  if (-not (Test-ModuleSecretName $n)) { throw "'$n' is not a CES module secret name" }
}
if ($unique -ccontains 'DATABASE_URL' -or $unique -ccontains 'ANTHROPIC_API_KEY') {
  throw 'DATABASE_URL and ANTHROPIC_API_KEY are not generated; they are supplied, not random'
}
$mintMuster = $unique -ccontains 'CES_MUSTER_SECRETS_TOKEN'
if ($mintMuster -and -not ($unique -ccontains 'JWT_SECRET')) {
  throw 'CES_MUSTER_SECRETS_TOKEN is a muster-api login token signed with JWT_SECRET; include JWT_SECRET in -Names'
}
if ((Test-Path -LiteralPath $Path) -and -not $Force) {
  throw "store already exists at $Path (use -Force to replace it)"
}

Add-Type -AssemblyName System.Security
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$values = [ordered]@{}
foreach ($n in $unique) {
  $bytes = New-Object byte[] 32
  $rng.GetBytes($bytes)
  # base64url, no padding: 43 chars, safe in headers and JSON.
  $values[$n] = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
  [Array]::Clear($bytes, 0, $bytes.Length)
}
$rng.Dispose()

function ConvertTo-Base64Url([byte[]]$b) {
  return [Convert]::ToBase64String($b).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

# PH7-SEC: replace the random CES_MUSTER_SECRETS_TOKEN with a muster-api JWT (HS256, signed with the
# JWT_SECRET just made). Plain .NET HMACSHA256, so no muster-api install is needed at this step.
if ($mintMuster) {
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $claims = [ordered]@{
    sub       = $MusterTokenSubject
    tenant_id = $MusterTenantId
    party_id  = $null
    role      = 'bhd_operator'
    iat       = $now
    exp       = $now + (3600 * [int64]$MusterTokenHours)
  }
  $head = ConvertTo-Base64Url ($utf8.GetBytes('{"alg":"HS256","typ":"JWT"}'))
  $body = ConvertTo-Base64Url ($utf8.GetBytes(($claims | ConvertTo-Json -Compress)))
  $key = $utf8.GetBytes($values['JWT_SECRET'])
  $hmac = New-Object System.Security.Cryptography.HMACSHA256 -ArgumentList (, $key)
  $sig = ConvertTo-Base64Url ($hmac.ComputeHash($utf8.GetBytes("$head.$body")))
  $hmac.Dispose()
  [Array]::Clear($key, 0, $key.Length)
  $values['CES_MUSTER_SECRETS_TOKEN'] = "$head.$body.$sig"
  $sig = $null
}

$plain = [System.Text.Encoding]::UTF8.GetBytes(($values | ConvertTo-Json -Compress))
$values.Clear()
$scopeEnum = [System.Security.Cryptography.DataProtectionScope]::$Scope
$blob = [System.Security.Cryptography.ProtectedData]::Protect($plain, [System.Text.Encoding]::UTF8.GetBytes($Entropy), $scopeEnum)
[Array]::Clear($plain, 0, $plain.Length)

$doc = [ordered]@{
  format    = $Format
  scope     = $Scope
  created   = (Get-Date).ToUniversalTime().ToString('o')
  names     = $unique
  protected = [Convert]::ToBase64String($blob)
}
$json = $doc | ConvertTo-Json -Depth 3

$dir = Split-Path -Parent $Path
if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }

$tmp = "$Path.tmp-$PID"
[System.IO.File]::WriteAllText($tmp, $json, (New-Object System.Text.UTF8Encoding($false)))

if (-not $NoAcl) {
  $acl = New-Object System.Security.AccessControl.FileSecurity
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($id in @('BUILTIN\Administrators', 'NT AUTHORITY\SYSTEM')) {
    $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($id, 'FullControl', 'Allow')))
  }
  $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($ServiceAccount, 'Read', 'Allow')))
  Set-Acl -LiteralPath $tmp -AclObject $acl
}

Move-Item -LiteralPath $tmp -Destination $Path -Force
$musterNote = if ($mintMuster) { "; CES_MUSTER_SECRETS_TOKEN is a muster-api JWT (tenant_id $MusterTenantId, role bhd_operator, expires in $MusterTokenHours h)" } else { '' }
Write-Output ("module-secret store written: {0} (scope {1}; names: {2}){3}" -f $Path, $Scope, ($unique -join ', '), $musterNote)
