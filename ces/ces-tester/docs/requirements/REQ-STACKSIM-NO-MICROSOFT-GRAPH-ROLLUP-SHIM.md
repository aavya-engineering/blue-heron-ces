# REQ-STACKSIM-NO-MICROSOFT-GRAPH-ROLLUP-SHIM

**Filed by:** ces-tester (GP-DEMO-3, M0 drivability spike — FD-5)
**Date:** 2026-08-29
**Against:** `tenant-stacksim`
**Severity:** MEDIUM — blocks the Stamper GUI end-to-end under stacksim. Worked around inside
ces-tester; the sibling fix is optional but would remove the workaround.
**Status:** OPEN — worked around, not patched (write boundary).

## Summary

`tenant-stacksim/psmodules/` ships the Microsoft Graph **sub-modules** but no bare
`Microsoft.Graph` **rollup**. `ces-shared`'s `PrerequisiteChecker` lists `Microsoft.Graph`
as `required: true` and probes it with `Get-Module -ListAvailable Microsoft.Graph`, which
runs under the stacksim-shadowed `PSModulePath`. The probe therefore fails, Stamper's GUI
`/api/connect` emits `prereq_blocked` and never reaches `phase:'done'`, the client never
sets `tenantConnectionState = 'connected'`, and **Execute is permanently refused**.

## Evidence (measured)

The exact five `MODULE_PREREQUISITES.testCommand` strings, run under the stacksim
`PSModulePath` (`<stacksim>/psmodules` + `$PSHOME\Modules`):

```
  [required] Microsoft.Graph                          MISSING
  [required] ExchangeOnlineManagement                 INSTALLED v1.0.0
  [required] Az (Az.Accounts)                         INSTALLED v1.0.0
  [optional] Microsoft.Online.SharePoint.PowerShell   INSTALLED v1.0.0
  [optional] MicrosoftTeams                           INSTALLED v1.0.0
```

Only the rollup is missing. Directory listing of `tenant-stacksim/psmodules/` confirms it:
`Az.Accounts`, `Az.Monitor`, `Az.Storage`, `ExchangeOnlineManagement`,
`Microsoft.Graph.Applications`, `.Authentication`, `.DeviceManagement`, `.DirectoryObjects`,
`.Domains`, `.Groups`, `.Identity.Authentication`, `.Identity.ConditionalAccess`,
`.Identity.DirectoryManagement`, `.Identity.Governance`, `.Identity.SignIns`, `.Reports`,
`.Users`, `Microsoft.Online.SharePoint.PowerShell`, `MicrosoftTeams` — **no
`Microsoft.Graph`**.

Live confirmation in the Stamper GUI's own connection console, before the workaround:

```
✓ PowerShell v5.1 — installed
✗ Certificate — not found
✗ Certificate not found in cert store
MISSING PREREQUISITES
```

...and the `Microsoft.Graph` row was absent from the satisfied list.

## Code path

| File | Line | Detail |
|---|---|---|
| `ces-shared/src/prereq/PrerequisiteChecker.ts` | 30-37 | `Microsoft.Graph`, `required: true`, `Get-Module -ListAvailable Microsoft.Graph` |
| `ces-stamper/src/server/routes/connect.routes.ts` | 130-144 | bails with `prereq_blocked`; no `done` event |
| `ces-stamper/public/index.html` | 6384-6397 | `phase:'done'` + zero error rows is the ONLY path to `connected` |
| `ces-stamper/public/index.html` | 7703-7708, 7739-7742 | `executeFromMatrix()` / `doExecute()` refuse unless `connected` |
| `ces-tenant/src/impl/stacksim.ts` | 144-145 | `enableStacksimMode` **replaces** `PSModulePath` wholesale |

## Workaround shipped in ces-tester (FD-5 Option B, founder-ruled 2026-08-29)

`ces-tester/assets/psmodules-shim/Microsoft.Graph/Microsoft.Graph.psd1` — a presence-only
stub manifest (exports nothing), **APPENDED** to `PSModulePath` when ces-tester spawns a GUI
server. Appending, never replacing, keeps `tenant-stacksim/psmodules` first so the sim's own
shims still win every name collision. Verified: with the shim appended,
`Microsoft.Graph.Authentication` still resolves from
`tenant-stacksim\psmodules\Microsoft.Graph.Authentication`.

Result, in the live Stamper GUI:

```
✓ Microsoft.Graph v2.0.0 — installed        <- the shim
✓ ExchangeOnlineManagement v1.0.0 — installed
✓ Az v1.0.0 — installed
✓ All prerequisites satisfied
✓ Graph session connected
✓ Exchange session connected
✓ Tenant connection complete — all sessions active
```

`tenantConnectionState = connected`, **zero error rows**. Execute then ran live (74 stacksim
ledger mutations).

**Note:** `stamper gui --stacksim` is NOT usable here — it calls `enableStacksimMode`, which
replaces `PSModulePath` wholesale and would clobber the appended shim. ces-tester arms the
GUI with env-only injection (`mergeSimLaunchEnv`) instead.

## Suggested fix (for tenant-stacksim to apply — NOT applied by ces-tester)

Add `tenant-stacksim/psmodules/Microsoft.Graph/Microsoft.Graph.psd1`, a presence-only
manifest matching the existing shim convention. That makes the sim self-sufficient for any
consumer running `PrerequisiteChecker` — Stamper's GUI today, anything else tomorrow — and
lets ces-tester drop `assets/psmodules-shim/`.

## Cross-reference

- `docs/demo/PLAN-E2E-AO-DEMO.md` FD-5 (Option A = this REQ; Option B = the shipped workaround)
- `docs/context/IMPLEMENTATION_LOG.md` — GP-DEMO-3 M0, spike (b)
- Evidence: `runs/m0-spike/m0-001/stamper/connect-transcript.txt`, `.../spike-log.txt`
