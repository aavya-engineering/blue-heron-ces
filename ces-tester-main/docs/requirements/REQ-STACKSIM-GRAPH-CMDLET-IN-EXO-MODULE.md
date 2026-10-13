# REQ-STACKSIM-GRAPH-CMDLET-IN-EXO-MODULE — filed against tenant-stacksim codegen (from ces-tester, 2026-07-28)

**Boundary note:** requirement doc with live evidence, not a patch.

## Finding (live, GP-DEMO-2 gate attempt 3)

`Get-MgPolicyAuthorizationPolicy` — a Microsoft.Graph cmdlet — is codegen'd into the
**ExchangeOnlineManagement** shim module (`psmodules/ExchangeOnlineManagement.psm1`),
not a Microsoft.Graph.* module. During Muster's discovery walk, both `AC.L2-3.1.20`
entries (`guest-restrict` via that cmdlet, `spo-sharing` via a beta sharepoint URI)
produced **no observation at all** — the control is silently absent from the readiness
result (vs. an honest `unknown`), while the sim DOES seed the `authorizationPolicy`
singleton (its own `verify-doc` asserts ledger entries for it).

## Two asks

1. **tenant-stacksim codegen:** place Graph-verb cmdlets in a Graph shim module (or
   verify the EXO psd1 exports them so module auto-discovery finds them) so
   `Get-MgPolicyAuthorizationPolicy` executes against the seeded singleton.
2. **DISCOVERY-1 (muster):** entries whose execution fails/never-runs should surface as
   an `unknown`-posture observation (or an explicit per-entry status in the envelope),
   not silence — silence is indistinguishable from "control not in scope," which
   weakens evaluation-mode claims.

## Impact on the GP-DEMO-2 gate

`AC.L2-3.1.20` dropped from the 5-config probe set until either ask lands
(`AC.L1-3.1.20` cross-tenant discriminates correctly and remains).
