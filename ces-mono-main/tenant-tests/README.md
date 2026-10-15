# tenant-tests — CES End-User Tenant Test Suite (G-EUT-1)

Proves a CES-hardened GCC High tenant enforces the CMMC 2.0 L2 controls it claims, from the
end-user's perspective. Source catalog: `../docs/tenant-tests/END-USER-USE-CASES.md` · Plan:
`../docs/G-EUT-1-plan.md`.

## Run

```powershell
powershell -File tenant-tests\run.ps1 -TenantSlug vfsgov        # full suite
powershell -File tenant-tests\run.ps1 -TenantSlug vfsgov -Case UC-01   # one case
```

No `-TenantSlug` (or `CES_EUT_TENANT` env var) → prints usage, exits 0, touches nothing.
**Not part of `npm test`** — the offline CI contract is unaffected.

Reports land in `../docs/tenant-tests/results/run-<stamp>.{md,json}`.

## Verdicts

| Verdict | Meaning |
|---|---|
| PASS | control verifiably enforced |
| FAIL | probe ran; enforcement absent/misscoped → a **finding about the tenant**, never a probe bug |
| INCONCLUSIVE | probe ran; evidence insufficient (quiet logs, permission gap, endpoint limit) |
| SKIPPED | prerequisite missing (channel down, T3 stub) — always carries a reason |

A failing probe is never "fixed" by weakening it; harness-defect fixes are logged in the run
report appendix (see plan AC#3).

## Read-only guarantee

All tenant access flows through three choke points in `lib/TenantProbe.psm1`:
`Invoke-EutGraph` (GET only), `Invoke-EutExo` (`Get-*` cmdlets only), `Invoke-EutArm`
(`Get-Az*` only). `run.ps1` statically scans `cases/` for direct API/connect calls before
executing and aborts on any hit. Runner is Pester-free by design (Windows ships Pester 3.4; the
four-verdict model doesn't map to it).

## Adding a case

Create `cases/UC-NN.name.ps1` defining `$CaseDef = @{ Id; Name; Personas; Practices; Tests }`
where each test is `@{ Name; Tier ('T1'|'T2'|'T3'); Script = { param($ctx) ... } }` returning
`New-EutVerdict`. Use only the choke-point helpers; wrap probes in
`try { } catch { Resolve-EutProbeError $_ -What '...' }`.
