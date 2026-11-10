# MX identity gate (Blue Heron Defense, CES team). Windows PowerShell 5.1.
#   powershell -ExecutionPolicy Bypass -File identity-scan.ps1 -Path <folder or .zip> [-Path ...]
#   powershell -ExecutionPolicy Bypass -File identity-scan.ps1 -Root <WS> -Scenario <slug> [-Report <file>]
# Scans every file, and every entry inside .zip/.docx/.xlsx/.pptx files, for personal identifiers
# and local machine paths. Prints each hit and exits 1 if there is any; exits 0 when clean.
# The banned-name list is passed in by the packager with -Extra (one regex per entry), so this
# file itself carries no names.
# Synthetic-customer W0 (V49): -Root/-Scenario scans the V49 scope that v49-scope.mjs lists (the shared bundle, the
# simulator scenario and seed files for the slug, customers\<slug>\, the AdminOps shared-database rows for the tenant,
# the EvidenceOps store records and payloads) with the V49 tokens (nb-tools\scan-tokens.txt, the
# workstation user name); verify.mjs V49 passes the same scope as -Path (then -Scenario only labels the report).
# -NoContext (implied by -Root/-Scenario) prints file and hit count only, never the matched text; -Report writes the
# same as JSON (file, count, pattern numbers); -Root also shortens file labels to <WS>\....
param(
  [string[]]$Path = @(),
  [string[]]$Extra = @(),
  [string]$Root = '',
  [string]$Scenario = '',
  [switch]$NoContext,
  [string]$Report = ''
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

if ($Root -and $Scenario -and -not $Path.Count) {
  $scopeJson = & node (Join-Path $PSScriptRoot 'v49-scope.mjs') --root $Root --scenario $Scenario
  if ($LASTEXITCODE -ne 0) { throw "v49-scope.mjs failed (exit $LASTEXITCODE)" }
  $scope = ($scopeJson -join "`n") | ConvertFrom-Json
  $Path = @($Path) + @($scope.roots)
  $Extra = @($Extra) + @($scope.tokens)
  $NoContext = $true
} elseif (-not $Path.Count) { throw 'identity-scan: -Path <folder or file> (or -Root <WS> -Scenario <slug>) is required' }

$patterns = @(
  # FIN-29 (W8-IDS): one or more backslashes, so a path inside embedded JSON (doubled: C:\\Users\\...) is caught too;
  # the slash form also catches JSON's escaped slash (C:\/Users\/); all three are case-insensitive.
  '(?i)[A-Z]:\\+Users\\+',          # local user profile paths (backslash form, single or doubled)
  '(?i)[A-Z]:(?:\\?/)+Users(?:\\?/)+', # local user profile paths (slash form, plain or JSON-escaped)
  '(?i)/[a-z]/Users/',           # Git Bash form
  'AppData[\\/]+Local[\\/]+Temp', # scratch / temp paths
  'scratchpad',
  '(?i)blueherondefense\.com',   # company mailbox handles
  '(?m)^From: ',                 # format-patch headers
  '(?m)^Author: '
) + $Extra
$rx = $patterns | ForEach-Object { New-Object System.Text.RegularExpressions.Regex($_) }
$zipExt = @('.zip', '.docx', '.xlsx', '.pptx')
$hits = New-Object System.Collections.Generic.List[string]
$perFile = [ordered]@{}

function Label-Of([string]$Full) {
  if ($Root -and $Full.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase)) { return '<WS>' + $Full.Substring($Root.TrimEnd('\').Length) }
  return $Full
}
function Scan-Text([string]$Label, [string]$Text) {
  for ($i = 0; $i -lt $rx.Count; $i++) {
    $r = $rx[$i]
    foreach ($m in $r.Matches($Text)) {
      if ($NoContext) {
        if (-not $perFile.Contains($Label)) { $perFile[$Label] = [ordered]@{ hits = 0; patterns = New-Object System.Collections.Generic.List[int] } }
        $perFile[$Label].hits++
        if (-not $perFile[$Label].patterns.Contains($i + 1)) { $perFile[$Label].patterns.Add($i + 1) }
        $hits.Add($Label)
        continue
      }
      $start = [Math]::Max(0, $m.Index - 30); $len = [Math]::Min($Text.Length - $start, $m.Length + 60)
      $ctx = $Text.Substring($start, $len) -replace '\s+', ' '
      $hits.Add("$Label :: /$($r.ToString())/ :: ...$ctx...")
    }
  }
}
function Scan-Zip([string]$Label, [System.IO.Stream]$Stream) {
  $zip = New-Object System.IO.Compression.ZipArchive($Stream, [System.IO.Compression.ZipArchiveMode]::Read)
  try {
    foreach ($e in $zip.Entries) {
      if ($e.FullName.EndsWith('/')) { continue }
      Scan-Text "$Label!$($e.FullName) (name)" $e.FullName
      $s = $e.Open()
      try {
        $ms = New-Object System.IO.MemoryStream; $s.CopyTo($ms); $ms.Position = 0
        if ($zipExt -contains [IO.Path]::GetExtension($e.FullName).ToLower()) { Scan-Zip "$Label!$($e.FullName)" $ms }
        else { Scan-Text "$Label!$($e.FullName)" ([Text.Encoding]::UTF8.GetString($ms.ToArray())) }
      } finally { $s.Dispose() }
    }
  } finally { $zip.Dispose() }
}

$n = 0
foreach ($p in $Path) {
  if (-not (Test-Path $p)) { continue }
  $items = if (Test-Path $p -PathType Container) { Get-ChildItem $p -Recurse -File } else { Get-Item $p }
  foreach ($f in $items) {
    $n++
    $lbl = if ($NoContext) { Label-Of $f.FullName } else { $f.Name }
    Scan-Text "$(if ($NoContext) { $lbl } else { $f.FullName }) (name)" $f.Name
    if ($zipExt -contains $f.Extension.ToLower()) {
      $fs = [IO.File]::OpenRead($f.FullName)
      try { Scan-Zip $lbl $fs } finally { $fs.Dispose() }
    } else {
      $bytes = [IO.File]::ReadAllBytes($f.FullName)
      $text = if ($bytes.Length -ge 2 -and $bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE) { [Text.Encoding]::Unicode.GetString($bytes) } else { [Text.Encoding]::UTF8.GetString($bytes) }
      Scan-Text $lbl $text
    }
  }
}
if ($Report) {
  $files = @($perFile.Keys | ForEach-Object { [ordered]@{ file = $_; hits = $perFile[$_].hits; patterns = @($perFile[$_].patterns) } })
  $rep = [ordered]@{ schema = 'ces-muster-run/identity-scan@1'; scenario = $Scenario; files_scanned = $n; patterns = $patterns.Count; hits_total = $hits.Count; files = $files }
  New-Item -ItemType Directory -Force (Split-Path -Parent $Report) | Out-Null
  [IO.File]::WriteAllText($Report, ($rep | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding $false))
}
if ($hits.Count -gt 0) {
  Write-Host "identity scan: $($hits.Count) hit(s) in $n file(s)"
  if ($NoContext) { foreach ($k in $perFile.Keys) { Write-Host "  $k :: $($perFile[$k].hits) hit(s), pattern(s) $(@($perFile[$k].patterns) -join ',')" } }
  else { $hits | ForEach-Object { Write-Host "  $_" } }
  exit 1
}
Write-Host "identity scan: clean ($n files, $($patterns.Count) patterns)"
exit 0
