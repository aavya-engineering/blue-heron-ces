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

# session-host.ps1 — Persistent PowerShell host for Stamper SessionManager.
# Reads commands from stdin (delimited by STAMPER_CMD_END), executes them,
# and writes results to stdout/stderr with unique markers.
#
# Protocol:
#   IN:  <command lines>\nSTAMPER_CMD_END\n
#   OUT: <stdout>\nSTAMPER_STDOUT_END\n
#         <stderr on stderr stream>\nSTAMPER_STDERR_END\n
#         STAMPER_EXIT:<exitCode>\n

$ErrorActionPreference = "Continue"

# Flush stdout helper — ensures Node sees output immediately
function Flush-StdOut {
    [Console]::Out.Flush()
    [Console]::Error.Flush()
}

# Signal ready
Write-Output "STAMPER_HOST_READY"
Flush-StdOut

while ($true) {
    # Accumulate command lines until marker
    $cmdLines = [System.Collections.Generic.List[string]]::new()
    while ($true) {
        $line = [Console]::In.ReadLine()
        if ($null -eq $line) {
            # stdin closed — exit cleanly
            exit 0
        }
        if ($line -eq "STAMPER_CMD_END") {
            break
        }
        $cmdLines.Add($line)
    }

    $script = $cmdLines -join "`n"
    $exitCode = 0
    $stderrText = ""

    # Reset $LASTEXITCODE so stale values from prior native-exe calls
    # don't leak into the current command's exit code.
    $global:LASTEXITCODE = 0

    try {
        # Execute the accumulated script, splitting stdout vs stderr.
        # Do NOT assign to a variable — let stdout flow directly to the pipeline/console.
        Invoke-Expression $script 2>&1 | ForEach-Object {
            if ($_ -is [System.Management.Automation.ErrorRecord]) {
                $stderrText += $_.ToString() + "`n"
            } elseif ($null -ne $_) {
                # Write to stdout in real-time for streaming (guard against null from 204 No Content)
                [Console]::Out.WriteLine($_.ToString())
            }
        }
    } catch {
        $stderrText += $_.Exception.Message + "`n"
        $exitCode = 1
    }

    # If the last command set $LASTEXITCODE (native exe), propagate it
    if ($LASTEXITCODE -and $LASTEXITCODE -ne 0 -and $exitCode -eq 0) {
        $exitCode = $LASTEXITCODE
    }

    # Write markers
    Write-Output "STAMPER_STDOUT_END"

    # Stderr goes to stderr stream
    if ($stderrText) {
        [Console]::Error.Write($stderrText)
    }
    [Console]::Error.WriteLine("STAMPER_STDERR_END")

    Write-Output "STAMPER_EXIT:$exitCode"
    Flush-StdOut
}
