# Handoff kit helpers (Blue Heron Defense, CES team). Windows PowerShell 5.1. Dot-source it:
#   . (Join-Path $PSScriptRoot 'lib\HandoffManifest.ps1')
#   $m = Read-HandoffManifest -Path <KIT>\handoff.manifest.yaml
# Used by bootstrap.ps1, verify\smoke.ps1 and verify\acceptance.ps1. No external modules.
#
# The YAML subset (enough for handoff.manifest.yaml; anything else is a parse error with the line number):
#   - comments: '#' at line start or after whitespace, outside quotes
#   - block mappings (key: value), block sequences (- item), a sequence item that starts a mapping (- id: x)
#   - a sequence under a key at the same indent as the key (key:\n- a)
#   - flow mappings { a: 1, b: "x" } and flow sequences [a, b, { c: 1 }], nested, may span lines
#   - scalars: "double" (escapes \" \\ \n \t \uXXXX), 'single' ('' = '), plain;
#     plain true/false -> bool, null/~ -> null, -?digits -> int, -?digits.digits -> double, else string
#   - NOT supported: anchors/aliases, tags, block scalars (| and >), multi-document streams, tabs for indent
#
# Version specs (toolchain[].version), matched by Test-HandoffVersion:
#   exact "24.11.1"; prefix "24" or "24.11" (or "24.x", "24.11.x"); comparators >= > <= < = ;
#   caret "^24.11.1" (same major, not lower); tilde "~24.11.1" (same major.minor, not lower);
#   clauses separated by spaces or commas are ANDed; "||" separates alternatives.

class HandoffYamlLine {
  [int]$Indent
  [string]$Text
  [int]$No
  HandoffYamlLine([int]$indent, [string]$text, [int]$no) { $this.Indent = $indent; $this.Text = $text; $this.No = $no }
}

class HandoffYaml {
  [System.Collections.Generic.List[HandoffYamlLine]]$Lines
  [int]$Pos
  [string]$Source

  HandoffYaml([string]$text, [string]$source) {
    $this.Source = $source
    $this.Pos = 0
    $this.Lines = [System.Collections.Generic.List[HandoffYamlLine]]::new()
    $raw = $text -split "`r?`n"
    $i = 0
    while ($i -lt $raw.Count) {
      $no = $i + 1
      $line = [HandoffYaml]::StripComment($raw[$i])
      $i++
      if ($line.Trim() -eq '' -or $line.Trim() -eq '---') { continue }
      $lead = $line.Length - $line.TrimStart().Length
      if ($line.Substring(0, $lead).Contains("`t")) { $this.Fail($no, 'tab in indentation') }
      $content = $line.Trim()
      # a flow collection may span lines: join until the brackets balance
      while ([HandoffYaml]::FlowDepth($content) -gt 0 -and $i -lt $raw.Count) {
        $content = $content + ' ' + ([HandoffYaml]::StripComment($raw[$i])).Trim()
        $i++
      }
      if ([HandoffYaml]::FlowDepth($content) -ne 0) { $this.Fail($no, 'unbalanced [ ] or { }') }
      $this.Lines.Add([HandoffYamlLine]::new($lead, $content, $no))
    }
  }

  [void] Fail([int]$no, [string]$msg) { throw "$($this.Source):$($no): YAML subset: $msg" }

  static [string] StripComment([string]$s) {
    $q = [char]0
    for ($k = 0; $k -lt $s.Length; $k++) {
      $c = $s[$k]
      if ($q -eq [char]'"') { if ($c -eq [char]'\') { $k++ } elseif ($c -eq [char]'"') { $q = [char]0 }; continue }
      if ($q -eq [char]"'") { if ($c -eq [char]"'") { $q = [char]0 }; continue }
      if (($c -eq [char]'"' -or $c -eq [char]"'") -and ($k -eq 0 -or ' ,[{:'.IndexOf($s[$k - 1]) -ge 0)) { $q = $c; continue }
      if ($c -eq [char]'#' -and ($k -eq 0 -or [char]::IsWhiteSpace($s[$k - 1]))) { return $s.Substring(0, $k) }
    }
    return $s
  }

  static [int] FlowDepth([string]$s) {
    $d = 0; $q = [char]0
    for ($k = 0; $k -lt $s.Length; $k++) {
      $c = $s[$k]
      if ($q -eq [char]'"') { if ($c -eq [char]'\') { $k++ } elseif ($c -eq [char]'"') { $q = [char]0 }; continue }
      if ($q -eq [char]"'") { if ($c -eq [char]"'") { $q = [char]0 }; continue }
      if (($c -eq [char]'"' -or $c -eq [char]"'") -and ($k -eq 0 -or ' ,[{:'.IndexOf($s[$k - 1]) -ge 0)) { $q = $c; continue }
      if ($c -eq [char]'[' -or $c -eq [char]'{') { $d++ } elseif ($c -eq [char]']' -or $c -eq [char]'}') { $d-- }
    }
    return $d
  }

  # Index of the key separator ':' (followed by space or end), outside quotes and flow brackets; -1 if none.
  static [int] FindColon([string]$s) {
    if ($s.Length -eq 0 -or $s[0] -eq [char]'[' -or $s[0] -eq [char]'{') { return -1 }
    $q = [char]0; $d = 0
    for ($k = 0; $k -lt $s.Length; $k++) {
      $c = $s[$k]
      if ($q -eq [char]'"') { if ($c -eq [char]'\') { $k++ } elseif ($c -eq [char]'"') { $q = [char]0 }; continue }
      if ($q -eq [char]"'") { if ($c -eq [char]"'") { $q = [char]0 }; continue }
      if (($c -eq [char]'"' -or $c -eq [char]"'") -and $k -eq 0) { $q = $c; continue }
      if ($c -eq [char]'[' -or $c -eq [char]'{') { $d++; continue }
      if ($c -eq [char]']' -or $c -eq [char]'}') { $d--; continue }
      if ($c -eq [char]':' -and $d -eq 0 -and ($k + 1 -eq $s.Length -or $s[$k + 1] -eq [char]' ')) { return $k }
    }
    return -1
  }

  static [bool] IsSeqItem([string]$s) { return ($s -eq '-' -or $s.StartsWith('- ')) }

  [object] Run() {
    if ($this.Lines.Count -eq 0) { return $null }
    $v = $this.ParseBlock($this.Lines[0].Indent)
    if ($this.Pos -lt $this.Lines.Count) { $this.Fail($this.Lines[$this.Pos].No, 'unexpected indentation') }
    return $v
  }

  [object] ParseBlock([int]$indent) {
    if ([HandoffYaml]::IsSeqItem($this.Lines[$this.Pos].Text)) { return $this.ParseSeq($indent) }
    if ([HandoffYaml]::FindColon($this.Lines[$this.Pos].Text) -ge 0) { return $this.ParseMap($indent) }
    $ln = $this.Lines[$this.Pos]; $this.Pos++
    return $this.ParseInline($ln.Text, $ln.No)
  }

  [object] ParseSeq([int]$indent) {
    $list = [System.Collections.Generic.List[object]]::new()
    while ($this.Pos -lt $this.Lines.Count) {
      $ln = $this.Lines[$this.Pos]
      if ($ln.Indent -lt $indent) { break }
      if ($ln.Indent -gt $indent) { $this.Fail($ln.No, 'bad indentation in a sequence') }
      if (-not [HandoffYaml]::IsSeqItem($ln.Text)) { break }
      $rest = $ln.Text.Substring(1).TrimStart()
      $offset = $ln.Text.Length - $rest.Length
      if ($rest -eq '') {
        $this.Pos++
        if ($this.Pos -lt $this.Lines.Count -and $this.Lines[$this.Pos].Indent -gt $indent) { $list.Add($this.ParseBlock($this.Lines[$this.Pos].Indent)) }
        else { $list.Add($null) }
      } elseif ([HandoffYaml]::IsSeqItem($rest) -or [HandoffYaml]::FindColon($rest) -ge 0) {
        # "- key: v" starts a mapping whose keys sit at the column after "- "
        $this.Lines[$this.Pos] = [HandoffYamlLine]::new($indent + $offset, $rest, $ln.No)
        $list.Add($this.ParseBlock($indent + $offset))
      } else {
        $this.Pos++
        $list.Add($this.ParseInline($rest, $ln.No))
      }
    }
    return $list.ToArray()
  }

  [object] ParseMap([int]$indent) {
    $map = [ordered]@{}
    while ($this.Pos -lt $this.Lines.Count) {
      $ln = $this.Lines[$this.Pos]
      if ($ln.Indent -lt $indent) { break }
      if ($ln.Indent -gt $indent) { $this.Fail($ln.No, 'bad indentation in a mapping') }
      if ([HandoffYaml]::IsSeqItem($ln.Text)) { break }
      $ci = [HandoffYaml]::FindColon($ln.Text)
      if ($ci -lt 0) { $this.Fail($ln.No, "expected 'key: value', got '$($ln.Text)'") }
      $key = [string]$this.ParseInline($ln.Text.Substring(0, $ci).Trim(), $ln.No)
      $val = $ln.Text.Substring($ci + 1).Trim()
      if ($map.Contains($key)) { $this.Fail($ln.No, "duplicate key '$key'") }
      $this.Pos++
      if ($val -eq '') {
        if ($this.Pos -lt $this.Lines.Count -and $this.Lines[$this.Pos].Indent -gt $indent) { $map[$key] = $this.ParseBlock($this.Lines[$this.Pos].Indent) }
        elseif ($this.Pos -lt $this.Lines.Count -and $this.Lines[$this.Pos].Indent -eq $indent -and [HandoffYaml]::IsSeqItem($this.Lines[$this.Pos].Text)) { $map[$key] = $this.ParseSeq($indent) }
        else { $map[$key] = $null }
      } elseif ($val -match '^[|>][-+]?$') {
        $this.Fail($ln.No, "block scalars ('|', '>') are not in the subset; quote the value on one line")
      } elseif ($val.StartsWith('&') -or $val.StartsWith('*') -or $val.StartsWith('!')) {
        $this.Fail($ln.No, 'anchors, aliases and tags are not in the subset')
      } else {
        $map[$key] = $this.ParseInline($val, $ln.No)
      }
    }
    return $map
  }

  # ---------- inline values (scalars and flow collections) ----------
  [string]$S
  [int]$P
  [int]$LineNo

  [object] ParseInline([string]$s, [int]$no) {
    $this.S = $s; $this.P = 0; $this.LineNo = $no
    $v = $this.FlowValue($false)
    $this.SkipWs()
    if ($this.P -lt $this.S.Length) { $this.Fail($no, "unexpected text after a value: '$($this.S.Substring($this.P))'") }
    return $v
  }

  [void] SkipWs() { while ($this.P -lt $this.S.Length -and [char]::IsWhiteSpace($this.S[$this.P])) { $this.P++ } }

  [object] FlowValue([bool]$inFlow) {
    $this.SkipWs()
    if ($this.P -ge $this.S.Length) { return $null }
    $c = $this.S[$this.P]
    if ($c -eq [char]'{') {
      $this.P++
      $map = [ordered]@{}
      while ($true) {
        $this.SkipWs()
        if ($this.P -ge $this.S.Length) { $this.Fail($this.LineNo, "unclosed '{'") }
        if ($this.S[$this.P] -eq [char]'}') { $this.P++; break }
        $key = [string]$this.FlowKey()
        $this.SkipWs()
        if ($this.P -ge $this.S.Length -or $this.S[$this.P] -ne [char]':') { $this.Fail($this.LineNo, "expected ':' after '$key' in a flow mapping") }
        $this.P++
        if ($map.Contains($key)) { $this.Fail($this.LineNo, "duplicate key '$key'") }
        $map[$key] = $this.FlowValue($true)
        $this.SkipWs()
        if ($this.P -lt $this.S.Length -and $this.S[$this.P] -eq [char]',') { $this.P++; continue }
        if ($this.P -lt $this.S.Length -and $this.S[$this.P] -eq [char]'}') { $this.P++; break }
        $this.Fail($this.LineNo, "expected ',' or '}' in a flow mapping")
      }
      return $map
    }
    if ($c -eq [char]'[') {
      $this.P++
      $list = [System.Collections.Generic.List[object]]::new()
      while ($true) {
        $this.SkipWs()
        if ($this.P -ge $this.S.Length) { $this.Fail($this.LineNo, "unclosed '['") }
        if ($this.S[$this.P] -eq [char]']') { $this.P++; break }
        $list.Add($this.FlowValue($true))
        $this.SkipWs()
        if ($this.P -lt $this.S.Length -and $this.S[$this.P] -eq [char]',') { $this.P++; continue }
        if ($this.P -lt $this.S.Length -and $this.S[$this.P] -eq [char]']') { $this.P++; break }
        $this.Fail($this.LineNo, "expected ',' or ']' in a flow sequence")
      }
      return $list.ToArray()
    }
    if ($c -eq [char]'"' -or $c -eq [char]"'") { return $this.Quoted() }
    $start = $this.P
    if ($inFlow) { while ($this.P -lt $this.S.Length -and ',]}'.IndexOf($this.S[$this.P]) -lt 0) { $this.P++ } }
    else { $this.P = $this.S.Length }
    return [HandoffYaml]::Plain($this.S.Substring($start, $this.P - $start).Trim())
  }

  [object] FlowKey() {
    $this.SkipWs()
    if ($this.P -lt $this.S.Length -and ($this.S[$this.P] -eq [char]'"' -or $this.S[$this.P] -eq [char]"'")) { return $this.Quoted() }
    $start = $this.P
    while ($this.P -lt $this.S.Length -and ':,}'.IndexOf($this.S[$this.P]) -lt 0) { $this.P++ }
    return $this.S.Substring($start, $this.P - $start).Trim()
  }

  [string] Quoted() {
    $q = $this.S[$this.P]; $this.P++
    $sb = [System.Text.StringBuilder]::new()
    while ($this.P -lt $this.S.Length) {
      $c = $this.S[$this.P]
      if ($q -eq [char]"'") {
        if ($c -eq [char]"'") {
          if ($this.P + 1 -lt $this.S.Length -and $this.S[$this.P + 1] -eq [char]"'") { [void]$sb.Append("'"); $this.P += 2; continue }
          $this.P++; return $sb.ToString()
        }
        [void]$sb.Append($c); $this.P++; continue
      }
      if ($c -eq [char]'"') { $this.P++; return $sb.ToString() }
      if ($c -eq [char]'\' -and $this.P + 1 -lt $this.S.Length) {
        $n = $this.S[$this.P + 1]
        switch -CaseSensitive ($n) {
          'n' { [void]$sb.Append("`n"); $this.P += 2 }
          't' { [void]$sb.Append("`t"); $this.P += 2 }
          'u' {
            if ($this.P + 5 -ge $this.S.Length) { $this.Fail($this.LineNo, 'short \u escape') }
            [void]$sb.Append([char][Convert]::ToInt32($this.S.Substring($this.P + 2, 4), 16)); $this.P += 6
          }
          default { [void]$sb.Append($n); $this.P += 2 }
        }
        continue
      }
      [void]$sb.Append($c); $this.P++
    }
    $this.Fail($this.LineNo, 'unclosed quoted string')
    return $null
  }

  static [object] Plain([string]$t) {
    if ($t -eq '' -or $t -eq '~' -or $t -ceq 'null' -or $t -ceq 'Null' -or $t -ceq 'NULL') { return $null }
    if ($t -ceq 'true' -or $t -ceq 'True') { return $true }
    if ($t -ceq 'false' -or $t -ceq 'False') { return $false }
    if ($t -match '^-?\d{1,9}$') { return [int]$t }
    if ($t -match '^-?\d+$') { return [long]$t }
    if ($t -match '^-?\d+\.\d+$') { return [double]::Parse($t, [System.Globalization.CultureInfo]::InvariantCulture) }
    return $t
  }
}

function ConvertFrom-HandoffYaml([string]$Text, [string]$Source = '<text>') {
  $p = [HandoffYaml]::new($Text, $Source)
  return , $p.Run()
}

$script:HandoffRepoIds = @('ces-mono', 'ces-muster', 'ces-tester', 'tenant-stacksim', 'ces-tenant', 'ces-muster-run')
$script:HandoffKinds = @('library', 'server', 'ui', 'cli', 'simulator', 'test-harness')

# Parse and shape-check the manifest (format fixed in docs\context\build-handoff\AGENT-BRIEF-KIT.md).
# Throws one error listing every problem found.
function Read-HandoffManifest([Parameter(Mandatory = $true)][string]$Path) {
  if (-not (Test-Path $Path -PathType Leaf)) { throw "manifest not found: $Path" }
  $m = ConvertFrom-HandoffYaml -Text ([System.IO.File]::ReadAllText($Path)) -Source $Path
  $bad = [System.Collections.Generic.List[string]]::new()
  if (-not ($m -is [System.Collections.IDictionary])) { throw "${Path}: the top level must be a mapping" }
  if ($m['schemaVersion'] -ne 1) { $bad.Add("schemaVersion must be 1 (found '$($m['schemaVersion'])')") }
  $rel = $m['release']
  if (-not ($rel -is [System.Collections.IDictionary])) { $bad.Add('release must be a mapping { id, cut, status }') }
  else {
    if (-not $rel['id']) { $bad.Add('release.id is missing') }
    if (@('draft', 'pinned') -notcontains [string]$rel['status']) { $bad.Add("release.status must be draft or pinned (found '$($rel['status'])')") }
  }
  foreach ($t in @($m['toolchain'])) {
    if ($null -eq $t) { continue }
    foreach ($k in @('name', 'version', 'check')) { if (-not $t[$k]) { $bad.Add("toolchain entry '$($t['name'])': $k is missing") } }
  }
  $ids = @{}
  $comps = @($m['components'] | Where-Object { $null -ne $_ })
  if ($comps.Count -eq 0) { $bad.Add('components is empty') }
  foreach ($c in $comps) {
    $id = [string]$c['id']
    if (-not $id) { $bad.Add('a component has no id'); continue }
    if ($id -notmatch '^[a-z0-9]+(-[a-z0-9]+)*$') { $bad.Add("component '$id': id is not kebab-case") }
    if ($ids.ContainsKey($id)) { $bad.Add("component '$id': duplicate id") }
    $ids[$id] = $c
    if ($script:HandoffRepoIds -notcontains [string]$c['repo']) { $bad.Add("component '$id': repo '$($c['repo'])' is not one of $($script:HandoffRepoIds -join ', ')") }
    if ($null -eq $c['path']) { $bad.Add("component '$id': path is missing") }
    if (-not $c['commit']) { $bad.Add("component '$id': commit is missing") }
    elseif ($rel -is [System.Collections.IDictionary] -and $rel['status'] -eq 'pinned' -and [string]$c['commit'] -notmatch '^[0-9a-f]{40}$') {
      $bad.Add("component '$id': a pinned release needs a full 40-character commit sha (found '$($c['commit'])')")
    }
    if ($script:HandoffKinds -notcontains [string]$c['kind']) { $bad.Add("component '$id': kind '$($c['kind'])' is not one of $($script:HandoffKinds -join ', ')") }
    foreach ($p in @($c['ports'] | Where-Object { $null -ne $_ })) {
      if (-not ($p['port'] -is [int])) { $bad.Add("component '$id': a port entry has no integer port") }
    }
  }
  foreach ($c in $comps) {
    foreach ($d in @($c['deps'] | Where-Object { $null -ne $_ })) {
      if (-not $ids.ContainsKey([string]$d)) { $bad.Add("component '$($c['id'])': dep '$d' is not a component id") }
    }
  }
  if ($bad.Count) { throw "${Path}: manifest problems:`n  - $($bad -join "`n  - ")" }
  return $m
}

# Kahn topological sort over components[].deps; ties keep manifest order. Throws on a cycle, naming its members.
function Get-HandoffBuildOrder($Manifest) {
  $comps = @($Manifest['components'] | Where-Object { $null -ne $_ })
  $indeg = [ordered]@{}; $users = @{}
  foreach ($c in $comps) { $indeg[[string]$c['id']] = 0; $users[[string]$c['id']] = [System.Collections.Generic.List[string]]::new() }
  foreach ($c in $comps) {
    foreach ($d in @($c['deps'] | Where-Object { $null -ne $_ })) { $indeg[[string]$c['id']]++; $users[[string]$d].Add([string]$c['id']) }
  }
  $order = [System.Collections.Generic.List[object]]::new()
  $done = @{}
  while ($order.Count -lt $comps.Count) {
    $next = $null
    foreach ($c in $comps) { $id = [string]$c['id']; if (-not $done.ContainsKey($id) -and $indeg[$id] -eq 0) { $next = $c; break } }
    if ($null -eq $next) {
      $left = @($comps | Where-Object { -not $done.ContainsKey([string]$_['id']) } | ForEach-Object { $_['id'] })
      throw "dependency cycle among components: $($left -join ', ')"
    }
    $done[[string]$next['id']] = $true
    $order.Add($next)
    foreach ($u in $users[[string]$next['id']]) { $indeg[$u]-- }
  }
  return , $order.ToArray()
}

function ConvertTo-HandoffVersionParts([string]$v) {
  $parts = @(($v -split '\.') | ForEach-Object { if ($_ -match '^\d+$') { [int]$_ } else { 0 } })
  while ($parts.Count -lt 3) { $parts += 0 }
  return , $parts[0..2]
}

function Compare-HandoffVersion([string]$a, [string]$b) {
  $x = ConvertTo-HandoffVersionParts $a; $y = ConvertTo-HandoffVersionParts $b
  for ($k = 0; $k -lt 3; $k++) { if ($x[$k] -ne $y[$k]) { return [Math]::Sign($x[$k] - $y[$k]) } }
  return 0
}

# The first dotted number in a tool's --version output ("v24.11.1" -> "24.11.1").
function Get-HandoffVersionNumber([string]$Text) {
  $mt = [regex]::Match([string]$Text, '\d+(\.\d+){0,3}')
  if ($mt.Success) { return $mt.Value } else { return $null }
}

# Every dotted number in the output, in order ("2.35.1, 2.20.0" -> 2.35.1, 2.20.0).
function Get-HandoffVersionNumbers([string]$Text) {
  [regex]::Matches([string]$Text, '\d+(\.\d+){0,3}') | ForEach-Object { $_.Value }
}

function Test-HandoffVersion([string]$Actual, [string]$Spec) {
  if (-not $Actual) { return $false }
  foreach ($alt in ($Spec -split '\|\|')) {
    $clauses = @($alt.Trim() -split '[\s,]+' | Where-Object { $_ })
    if ($clauses.Count -eq 0) { continue }
    $ok = $true
    foreach ($cl in $clauses) {
      $mt = [regex]::Match($cl, '^(>=|<=|>|<|=|\^|~)?v?(\d+(?:\.(?:\d+|x|\*)){0,2})$')
      if (-not $mt.Success) { throw "version spec '$Spec': cannot read clause '$cl'" }
      $op = $mt.Groups[1].Value; $ver = $mt.Groups[2].Value
      $a = ConvertTo-HandoffVersionParts $Actual
      switch ($op) {
        '>=' { if ((Compare-HandoffVersion $Actual $ver) -lt 0) { $ok = $false } }
        '>' { if ((Compare-HandoffVersion $Actual $ver) -le 0) { $ok = $false } }
        '<=' { if ((Compare-HandoffVersion $Actual $ver) -gt 0) { $ok = $false } }
        '<' { if ((Compare-HandoffVersion $Actual $ver) -ge 0) { $ok = $false } }
        '^' { $b = ConvertTo-HandoffVersionParts $ver; if ($a[0] -ne $b[0] -or (Compare-HandoffVersion $Actual $ver) -lt 0) { $ok = $false } }
        '~' { $b = ConvertTo-HandoffVersionParts $ver; if ($a[0] -ne $b[0] -or $a[1] -ne $b[1] -or (Compare-HandoffVersion $Actual $ver) -lt 0) { $ok = $false } }
        default {
          # exact when all three parts are given, else a prefix match ("24", "24.11", "24.x")
          $given = @(($ver -split '\.') | Where-Object { $_ -match '^\d+$' })
          $al = @($Actual -split '\.')
          for ($k = 0; $k -lt $given.Count; $k++) { if ($k -ge $al.Count -or [int]$al[$k] -ne [int]$given[$k]) { $ok = $false } }
        }
      }
      if (-not $ok) { break }
    }
    if ($ok) { return $true }
  }
  return $false
}

# Repo id (manifest) -> remote repository name in the org and directory under the workspace <Root>\ces.
# The manifest format has no field for this; it lives here. ces-muster-run is this package: verified, never cloned.
$script:HandoffRepoMap = [ordered]@{
  'ces-mono'        = @{ remote = 'ces-mono'; dir = '.' }
  'ces-tenant'      = @{ remote = 'ces-tenant'; dir = 'ces-tenant' }
  'ces-muster'      = @{ remote = 'ces-muster'; dir = 'ces-muster' }
  'ces-tester'      = @{ remote = 'ces-tester'; dir = 'ces-tester' }
  'tenant-stacksim' = @{ remote = 'ces-stacksim'; dir = 'tenant-stacksim' }
  'ces-muster-run'  = @{ remote = 'ces-muster-run'; dir = $null }
}

# Absolute repo root for a manifest repo id. $Workspace = <Root>\ces; $Package = the ces-muster-run checkout.
function Get-HandoffRepoRoot([string]$Repo, [string]$Workspace, [string]$Package) {
  $r = $script:HandoffRepoMap[$Repo]
  if (-not $r) { throw "unknown repo id '$Repo'" }
  if ($null -eq $r.dir) { return $Package }
  if ($r.dir -eq '.') { return $Workspace }
  return (Join-Path $Workspace $r.dir)
}

function Get-HandoffComponentDir($Component, [string]$Workspace, [string]$Package) {
  $root = Get-HandoffRepoRoot ([string]$Component['repo']) $Workspace $Package
  $p = [string]$Component['path']
  if ($p -eq '' -or $p -eq '.') { return $root }
  return (Join-Path $root ($p -replace '/', '\'))
}

# H1 (2026-11-01), contractor monorepo. In the module repos the kit is <pkg>\handoff; in the monorepo it is
# <root>\handoff, next to <root>\pkg\ces-muster-run (which then has no handoff folder). Returns the run package folder.
function Get-HandoffPackageDir([string]$Kit) {
  $parent = Split-Path -Parent $Kit
  $mono = Join-Path $parent 'pkg\ces-muster-run'
  if (Test-Path (Join-Path $mono 'scripts')) { return $mono }
  return $parent
}

# H1 (2026-11-01): the monorepo's provenance file <root>\SOURCES.json (written by scripts\handoff\build-monorepo.mjs:
# { repos: [ { repo, commit, path } ] }). Returns a hashtable repo id -> commit, or $null when there is no such file.
function Read-HandoffSources([string]$RootDir) {
  $f = Join-Path $RootDir 'SOURCES.json'
  if (-not (Test-Path $f -PathType Leaf)) { return $null }
  $doc = Get-Content -Raw -Path $f | ConvertFrom-Json
  $m = @{}
  foreach ($e in @($doc.repos)) { if ($e -and $e.repo -and $e.commit) { $m[[string]$e.repo] = [string]$e.commit } }
  return $m
}
