# KNOWN-ISSUES KI-02 workaround (Blue Heron Defense, CES team). Windows PowerShell 5.1.
#   powershell -ExecutionPolicy Bypass -File handoff\lib\Set-MusterSecretsToken.ps1 -Path <store> -Ces <Root>\ces [-TenantId <id>] [-ExpiresIn 8h]
# Since PH-7 (2026-11-01) New-CesModuleSecrets.ps1 itself mints CES_MUSTER_SECRETS_TOKEN as this JWT, so this script is
# now the RENEWAL step: the JWT expires (default 8 h) and this re-mints it in place. Background (the original KI-02):
# ces-shared\scripts\New-CesModuleSecrets.ps1 used to fill CES_MUSTER_SECRETS_TOKEN with random bytes, but Stamper sends that
# value to muster-api's POST /api/plan/secrets/resolve as a bearer JWT, and muster-api only accepts a JWT signed with
# its JWT_SECRET and carrying role bhd_operator (ces-muster\muster-api\src\routes\plan.ts, route /secrets/resolve).
# This script replaces the random value with such a JWT, signed with the JWT_SECRET already in the same store:
#   1. unprotects the store (DPAPI, same entropy and scope as New-CesModuleSecrets.ps1; run it as the same account);
#   2. mints { sub, tenant_id, party_id: null, role: 'bhd_operator' } with muster-api's own jsonwebtoken package
#      (JWT_SECRET reaches the one node call through its environment only, never argv, a file or a log);
#   3. re-protects the store and replaces the file atomically, keeping the file's ACL.
# Only names and the expiry time are printed; no value is ever printed or written outside the store.
# The JWT expires (-ExpiresIn, default 8h, muster-api's own default): rerun this before each operating session.
# -TenantId must be the tenant_id of the operator token that compiled the plan: muster-api releases an issued secret
# only to the tenant that it was issued to.
param(
  [Parameter(Mandatory = $true)][string]$Path,
  [Parameter(Mandatory = $true)][string]$Ces,
  [string]$TenantId = 'mx-sim-tenant',
  [string]$Subject = 'ces-stamper',
  [string]$ExpiresIn = '8h'
)
$ErrorActionPreference = 'Stop'
$Entropy = 'CES-MODULE-SECRETS-v1'     # must match ces-shared/src/secrets (dpapi.ts DPAPI_ENTROPY)
$Format = 'ces-module-secrets/1'       # must match moduleSecrets.ts MODULE_SECRETS_FORMAT
if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "no module-secret store at $Path (make it with ces-shared\scripts\New-CesModuleSecrets.ps1)" }
$apiPkg = Join-Path $Ces 'ces-muster\muster-api\package.json'
if (-not (Test-Path (Join-Path $Ces 'ces-muster\muster-api\node_modules\jsonwebtoken'))) { throw "muster-api is not installed under $Ces (run bootstrap.ps1 first)" }

$doc = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
if ($doc.format -ne $Format) { throw "$Path : format is '$($doc.format)', expected '$Format'" }
if (@('CurrentUser', 'LocalMachine') -notcontains $doc.scope) { throw "$Path : scope must be CurrentUser or LocalMachine" }
Add-Type -AssemblyName System.Security
$scope = [System.Security.Cryptography.DataProtectionScope]::($doc.scope)
$ent = [System.Text.Encoding]::UTF8.GetBytes($Entropy)
try { $plain = [System.Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($doc.protected), $ent, $scope) }
catch { throw "$Path : cannot unprotect the store (made for another account or machine, or tampered). Regenerate it with New-CesModuleSecrets.ps1 -Force, then rerun." }
$obj = [System.Text.Encoding]::UTF8.GetString($plain) | ConvertFrom-Json
[Array]::Clear($plain, 0, $plain.Length)
$values = [ordered]@{}
foreach ($p in $obj.PSObject.Properties) { $values[$p.Name] = [string]$p.Value }
$obj = $null
if (-not $values['JWT_SECRET']) { throw "$Path : the store holds no JWT_SECRET; regenerate it with JWT_SECRET in -Names" }

$mint = @'
const { createRequire } = require('node:module');
const r = createRequire(process.env.CES_MINT_PKG);
const jwt = r('jsonwebtoken');
process.stdout.write(jwt.sign({ sub: process.env.CES_MINT_SUB, tenant_id: process.env.CES_MINT_TENANT, party_id: null, role: 'bhd_operator' },
  process.env.JWT_SECRET, { expiresIn: process.env.CES_MINT_EXPIRES }));
'@
$prior = [Environment]::GetEnvironmentVariable('JWT_SECRET', 'Process')
try {
  $env:JWT_SECRET = $values['JWT_SECRET']; $env:CES_MINT_PKG = $apiPkg; $env:CES_MINT_SUB = $Subject
  $env:CES_MINT_TENANT = $TenantId; $env:CES_MINT_EXPIRES = $ExpiresIn
  $token = [string](& node -e $mint)
  $rc = $LASTEXITCODE
} finally {
  [Environment]::SetEnvironmentVariable('JWT_SECRET', $prior, 'Process')
  Remove-Item Env:CES_MINT_PKG, Env:CES_MINT_SUB, Env:CES_MINT_TENANT, Env:CES_MINT_EXPIRES -ErrorAction SilentlyContinue
}
if ($rc -ne 0 -or $token -notmatch '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$') { throw 'minting the muster-api token failed (node exit ' + $rc + ')' }
$values['CES_MUSTER_SECRETS_TOKEN'] = $token
$token = $null

$names = @(@($doc.names) + 'CES_MUSTER_SECRETS_TOKEN' | Sort-Object -Unique)
$bytes = [System.Text.Encoding]::UTF8.GetBytes(($values | ConvertTo-Json -Compress))
$values.Clear()
$blob = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $ent, $scope)
[Array]::Clear($bytes, 0, $bytes.Length)
$out = [ordered]@{ format = $Format; scope = $doc.scope; created = $doc.created; names = $names; protected = [Convert]::ToBase64String($blob) }
$tmp = "$Path.tmp-$PID"
[System.IO.File]::WriteAllText($tmp, ($out | ConvertTo-Json -Depth 3), (New-Object System.Text.UTF8Encoding($false)))
Set-Acl -LiteralPath $tmp -AclObject (Get-Acl -LiteralPath $Path)
Move-Item -LiteralPath $tmp -Destination $Path -Force
Write-Output ("CES_MUSTER_SECRETS_TOKEN replaced in {0} (tenant_id {1}, role bhd_operator, expires in {2}); names: {3}" -f $Path, $TenantId, $ExpiresIn, ($names -join ', '))
