# Expected results: the four-scenario acceptance round

**Status: DRAFT.** The rows below are the targets for a draft release, taken from the R-F9 re-baseline (`<PKG>\expected-outputs\<slug>\summary.json`, 2026-11-01; muster-partial: `<PKG>\expected-outputs\summary.json`). Proof round R-F10 and the PH-13 fixes have moved the scores since (KNOWN-ISSUES KI-06), so a correct build can miss a summary row until the BHD owner refreshes this file from the pinned release's round (R-F11 or later) and records its SHA-256 in `ACCEPTANCE.md`. Until then a red row is a finding, not a contractor error: check `KNOWN-ISSUES.md` and `PUNCH-LIST.md` ("R-F11 results") first.

`<PKG>` is the run package `ces-muster-run` (in the contractor monorepo: `<Root>\pkg\ces-muster-run`).

## How this file is used

`verify\round.ps1` runs `verify\acceptance.ps1` once per scenario (S1 `s1-mach`, S2 `s2-eng`, S3 `s3-def`, mp `muster-partial`). Each call runs the unit gate (first scenario only), one simulator scenario end to end with `-Harness tester`, then checks the rows between the `acceptance:begin` and `acceptance:end` markers. A marker with no scenario name applies to every scenario; `acceptance:begin <slug>` applies to that scenario only. A row has a **key**, an **expected** value and a note.

| Key form | Read from | Expected value |
|---|---|---|
| `gate:unit` | exit code of `<PKG>\scripts\run-tests.ps1` (or `unit-gate.json` under `-SkipUnitGate`) | an integer exit code |
| `gate:e2e` | exit code of `<PKG>\scripts\mx-e2e.ps1` | an integer exit code |
| `verify:pass`, `verify:scenario` | top level of `<Root>\out\verify.json` | `true` / the scenario slug |
| `verify:V<n>` | one check in `verify.json` | `pass` (passed, or "not run" under the chosen harness), `ran-pass`, `fail`, `not-run`, `any` |
| `verify:*` | every check not listed by id | as above |
| `summary:<dotted.path>` | `<Root>\out\summary.json` | an exact value, `>=n`, `<=n`, `>n`, `<n`, or a range `a..b` |

V-checks (V1, V2, ...) are the verify checks; `ACCEPTANCE.md` lists every id with its title, and each one's rule is in `<PKG>\scripts\verify.mjs` or a `verify-*.mjs` file it loads. E-steps (E1-E9 and the lettered ones) are the steps of the end-to-end run, listed in the header of `<PKG>\scripts\mx-e2e.ps1`.

## Rows for every scenario

<!-- acceptance:begin -->
| key | expected | note |
|---|---|---|
| gate:unit | 0 | every unit failure must be listed in known-failures.json (the list is empty) |
| gate:e2e | 0 | every E-step exit code 0, then E9 verify passes |
| verify:pass | true | verify.json overall verdict |
| verify:V1 | ran-pass | all E-step exit codes are 0 |
| verify:V10 | ran-pass | nothing written outside the workspace |
| verify:* | pass | every other check passes, or is "not run" for this scenario |
| summary:directives_total | 110 | control directives in the mission plan (one per CMMC Level 2 practice) |
<!-- acceptance:end -->

## Rows per scenario (R-F9 baseline)

<!-- acceptance:begin s1-mach -->
| key | expected | note |
|---|---|---|
| verify:scenario | s1-mach | S1 |
| summary:requirement_results.total | 130 | requirement results in the plan posture |
| summary:stamper.total_tasks | 101 | Stamper tasks executed |
| summary:eo_assess.controls_met | 103 | EO assessment, controls met |
| summary:eo_assess.sprs_score | 91 | SPRS score from the EO assessment |
<!-- acceptance:end -->

<!-- acceptance:begin s2-eng -->
| key | expected | note |
|---|---|---|
| verify:scenario | s2-eng | S2 |
| summary:requirement_results.total | 134 | requirement results in the plan posture |
| summary:stamper.total_tasks | 101 | Stamper tasks executed |
| summary:eo_assess.controls_met | 103 | EO assessment, controls met |
| summary:eo_assess.sprs_score | 96 | SPRS score from the EO assessment |
<!-- acceptance:end -->

<!-- acceptance:begin s3-def -->
| key | expected | note |
|---|---|---|
| verify:scenario | s3-def | S3 (compiled with MX_STACKS=m365_e5_gcc,microsoft_intune; acceptance.ps1 sets it) |
| summary:requirement_results.total | 129 | requirement results in the plan posture |
| summary:stamper.total_tasks | 101 | Stamper tasks executed |
| summary:eo_assess.controls_met | 73 | EO assessment at E7, controls met |
| summary:eo_assess.sprs_score | 18 | SPRS at E7; the E7B re-assessment reads 20 by design (AdminOps fixes land between them) |
<!-- acceptance:end -->

<!-- acceptance:begin muster-partial -->
| key | expected | note |
|---|---|---|
| verify:scenario | muster-partial | mp (a partly configured tenant: no Conditional Access policy enforces MFA) |
| summary:requirement_results.total | 134 | requirement results in the plan posture |
| summary:stamper.total_tasks | 101 | Stamper tasks executed |
| summary:eo_assess.controls_met | 79 | EO assessment, controls met |
| summary:eo_assess.sprs_score | 36 | SPRS score from the EO assessment |
<!-- acceptance:end -->

## What was red at the last recorded round

Round R-F10 (2026-11-01, PH-12 code) was red on V8, V11, V17, V21, V22, V27, V29, V43b, V85, V94, V98, V108, V109, V124 and V125 on S1 and S2, plus V75 on S1 and V59 on S3; the mp result was still running. V11, V21, V22, V29 and V109 were red only because that round's unit gate was red. KNOWN-ISSUES KI-19 lists the reds expected at the cut. The rows above do not mark any check as allowed to fail: a row changes to `any` only when the BHD owner records the reason in `KNOWN-ISSUES.md` and signs it in `ACCEPTANCE.md`.

## Legend

- **S1 / S2 / S3 / mp**: the four synthetic customer scenarios of the simulator (`tenant-stacksim\scenarios\<slug>.json`).
- **R-Fn**: BHD proof round n (all four scenarios end to end). **PH-n**: a BHD fix wave.
- **SPRS**: Supplier Performance Risk System score, the DoD (Department of Defense) self-assessment score that EO computes (`summary.eo_assess.sprs_score`).
- **EO**: EvidenceOps, the CES evidence and assessment server (`ces-eo`). **Stamper**: applies the configuration plan (`ces-stamper`). **Muster**: data collection and plan writing (`ces-muster`).
- **V-check (V1, V2, ...)**: a verify check, listed in `ACCEPTANCE.md`. **E-step (E1, E7, E7B, ...)**: a step of `<PKG>\scripts\mx-e2e.ps1`.
- **harness tester / mx**: who drives the E-steps: `ces-tester` (`tester`, the default and what BHD's rounds use) or the package script (`mx`).
- **KI-nn**: a known issue in `KNOWN-ISSUES.md`.
