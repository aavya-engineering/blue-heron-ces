# Acceptance: definition of done and sign-off

This file says when the contractor's CES build counts as done, who signs it off, and when shared access ends. Every check below is a script with a pass/fail result; the sign-off cites the scripts' output files by SHA-256 hash, not by description. Refreshed 2026-11-01 by H1 (handoff agent 1) for the PH-13 code (PH-13 = BHD's last fix wave) and the one-repository ("monorepo") delivery.

`<Root>` is the folder the contractor monorepo is cloned to. Use `C:\ces-nb`: it is short (KNOWN-ISSUES KI-08) and matches the paths in BHD's scripts. `<PKG>` is the run package, `<Root>\pkg\ces-muster-run`.

## The acceptance test: one proof round

A **proof round** runs all four synthetic customer scenarios end to end against the simulator (tenant-stacksim), exactly as BHD's own rounds do:

| Scenario | Slug | What it is |
|---|---|---|
| S1 | `s1-mach` | a 45-person CNC machining subcontractor on GCC High G5, cloud-only (fictional) |
| S2 | `s2-eng` | a 29-person engineering services firm on GCC High G5 with hybrid identity (fictional) |
| S3 | `s3-def` | a deliberately deficient 56-person defense manufacturer on GCC High G3 + E5 Security (fictional) |
| mp | `muster-partial` | a partly configured tenant: device compliance exists, but no Conditional Access policy enforces MFA |

Each scenario runs Muster (questions, discovery, plan) -> Stamper (apply the plan to the simulated tenant) -> AdminOps (admin commands, including the leaver flow) -> EvidenceOps (collect, assess, SSP, POA&M, SPRS), then the verify checks (V-checks, listed below). `verify\round.ps1` drives it: the unit gate once, then `verify\acceptance.ps1` once per scenario, which compares the results with `verify\expected-results.md`.

## Definition of done

The build is done when **all** of the following hold, in this order, on one machine:

| # | Check | How | Pass means |
|---|---|---|---|
| 1 | Clean machine | A fresh Windows VM (Windows PowerShell 5.1 present) with only the toolchain from `handoff.manifest.yaml` installed. No earlier CES folders (`C:\CES_Pipeline`, `%USERPROFILE%\.ces`, `%USERPROFILE%\.stamper`, `%LOCALAPPDATA%\CES`). | stated by the contractor in the sign-off |
| 2 | Code from the source | The monorepo comes from the private GitHub org through the link BHD sent (`git clone <link> C:\ces-nb`); never from an emailed script or zip. | stated by the contractor |
| 3 | Release is pinned | `release.status` in `handoff\handoff.manifest.yaml` is `pinned`, every component `commit` is a full 40-character sha, and each equals that folder's commit in `SOURCES.json`. A draft release cannot be accepted. | `bootstrap.ps1` prints no draft warning |
| 4 | Bootstrap | `powershell -NoProfile -ExecutionPolicy Bypass -File C:\ces-nb\handoff\bootstrap.ps1 -Root C:\ces-nb` | exit 0; `<Root>\out\bootstrap\bootstrap.json` has `"ok": true` |
| 5 | Kit is current | `node C:\ces-nb\pkg\ces-muster-run\scripts\handoff\check.mjs` (it finds `<Root>\handoff`, `<Root>\ces` and `SOURCES.json` itself) | exit 0: no drift between the manifest, contracts, config schema, secrets inventory, generated files and the code; no secret value or identity string in the kit |
| 6 | Smoke | `powershell -NoProfile -ExecutionPolicy Bypass -File C:\ces-nb\handoff\verify\smoke.ps1 -Root C:\ces-nb` | exit 0; every server in `<Root>\out\smoke\smoke.json` has `"pass": true` |
| 7 | Proof round | `powershell -NoProfile -ExecutionPolicy Bypass -File C:\ces-nb\handoff\verify\round.ps1 -Root C:\ces-nb` (about 2 hours; a browser window opens for the watched UI steps unless `-UiHeadless`) | exit 0; `<Root>\out\round\round.json` has `"pass": true`, and so does each `<Root>\out\round\<slug>\acceptance.json` |
| 8 | Known issues | Every open entry in `KNOWN-ISSUES.md` with severity **high** is fixed, or waived in writing in the waiver table below. | the waiver table covers every open high entry |

The round's UI steps drive a visible browser by default (BHD's rule: UI runs are watchable, paced and captioned, with video and trace); `-UiHeadless` is fine for a rerun. Live GCC High work is outside this definition of done: acceptance is on the simulator. At the cut (a draft release) some checks are known red; KNOWN-ISSUES KI-06 and KI-19 and `PUNCH-LIST.md` ("R-F11 results") say which.

## Evidence to attach

Attach these files from `<Root>\out` and record their SHA-256 (`Get-FileHash -Algorithm SHA256 <file>`). None holds a secret value: the runs use throwaway tokens that live only in process memory, and V101 checks that no run secret reached any output.

| File | SHA-256 |
|---|---|
| `bootstrap\bootstrap.json` | |
| `smoke\smoke.json` | |
| `round\round.json` | |
| `round\s1-mach\acceptance.json` | |
| `round\s2-eng\acceptance.json` | |
| `round\s3-def\acceptance.json` | |
| `round\muster-partial\acceptance.json` | |
| `round\s1-mach\unit-gate.json` (the round's unit gate) | |
| `handoff\verify\expected-results.md` used (its hash is inside each `acceptance.json`) | |

## The V-check set at the cut

The verify checks are the acceptance criteria inside each scenario. This list was read from `<PKG>\scripts\verify*.mjs` at the cut (2026-11-01; ids V1 to V131). V24 is its own script, run on a fresh root and not in a round. V86 is retired (the results loop back into Muster was removed by design: Muster only collects data and writes the plan). V102 is reserved and not written yet. V118 is named in BHD's finish plan but has no verify row in the run package. A check that cannot apply to a scenario reports "not run" and counts as a pass. Titles are quoted from the code, so they use BHD's internal labels (legend at the end).

| Id | What it checks | File |
|---|---|---|
| V1 | All E-step exit codes are 0 | verify.mjs |
| V2 | MP and TM parse with the ces-shared schemas | verify.mjs |
| V3 | The MP has 110 control directives | verify.mjs |
| V4 | Provenance: the plan came from discovery | verify.mjs |
| V5 | Stamper's picker regex matches all pushed files; MP hand-off refs resolve with matching hashes (the three EO-only envelopes against EO's intake, FIN-35 S-1) | verify.mjs |
| V6 | Translate exit 0; execute report exists; every MP directive planned or folded by objective credit; counts within baseline +/-2 | verify.mjs |
| V7 | Only the scenario build (E1), Stamper (E6), the S3 injection (E6X) and AdminOps (E7A) wrote to the sim ledger, each in its own window; discovery added zero writes | verify.mjs |
| V8 | SSP sections, implementation count, TM and MP loaded | verify.mjs |
| V9 | The SSP's MP is the pushed MP | verify.mjs |
| V10 | Nothing written outside the workspace (C:\CES_Pipeline, ~/.ces, ~/.stamper, %LOCALAPPDATA%\CES) | verify.mjs |
| V11 | Unit-suite failures are a subset of known-failures.json | verify.mjs |
| V12 | SSP system name from the TM; every TM boundary definition a boundary fact; no zone named like a questionnaire key | verify.mjs |
| V13 | Forced-failure run: the forced control's SSP status differs; no failed/blocked control is met | verify.mjs |
| V14 | Three back-to-back EO assessments give identical counts | verify.mjs |
| V15 | Stamper evidence in the tenant folder, one record per task, found by EO, failures recorded | verify.mjs |
| V16 | No leftover {name} placeholders reached the sim; inactive-account task disabled only stale users | verify.mjs |
| V17 | Exact Stamper failed-task set equals expected-outputs; completed = total - failed | verify.mjs |
| V18 | 22 policy documents (markdown + DOCX) with zero unresolved tokens | verify.mjs |
| V19 | Three assessor reports and the tech-ref guide present and non-empty | verify.mjs |
| V20 | POA&M covers every not-met, not-assessed, failed or blocked control (item or eligibility blocker) | verify.mjs |
| V21 | Question register present, every row names an output field, register test green | verify.mjs |
| V22 | MG-04 parity suite green against the reviewed allow-list | verify.mjs |
| V23 | Tester run record: muster-e2e PASS, including the ledger comparison | verify.mjs |
| V24 | Self-containment of a fresh root bootstrapped from the origin (its own script, run on a fresh root; not part of a round) | verify-v24.mjs |
| V25 | Shared evidence bundle: items 1-13 present (12 = evidence index), hashes match, identity scan = 0 | verify.mjs |
| V26 | stacksim coverage-ao (AO, 96 commands): pass, run by the tester | verify.mjs |
| V27 | EC upload: catalog ids validated, in EO's package and ledger, statuses unchanged | verify.mjs |
| V28 | MP requirement text = ces-shared reference; collect rows catalog-sourced or marked placeholder | verify.mjs |
| V29 | Evidence catalog: release log hash matches, release 0 complete, loader tests green | verify.mjs |
| V30 | Met-control narratives vs the negation lexicon: every hit flagged, every flag a hit; lexicon = EO's | verify.mjs |
| V31 | No not-assessed control shows "Not Applicable" in the DOCX text | verify.mjs |
| V32 | evidenceDetails cover the bundle's Stamper-evidenced controls; hashes match the files | verify.mjs |
| V33 | §2.4 rows = CRM shared rows; no excluded id present | verify.mjs |
| V34 | SSP components = IM resources | verify.mjs |
| V35 | §14 = poam.json; every ledger-deficient control is an item, a blocker or no_poam | verify.mjs |
| V36 | Exactly one assessed SPRS in the bundle (EO's); the POA&M number labelled projection | verify.mjs |
| V37 | Freshness: every store-backed ledger objective is fresh; none stale or demoted | verify.mjs |
| V38 | Provenance: every store-backed detail resolves to a record with a collector identity | verify.mjs |
| V39 | No positive source rests on an empty payload | verify.mjs |
| V40 | Tenant-scoped sources: no record, ref or ledger objective from another tenant | verify.mjs |
| V41 | Watermarks monotonic; passes 2-3 collect nothing new; E7B collects exactly the E7A writes; E8F collects exactly its forced rows | verify.mjs |
| V42 | Hash chain intact: records, links and payloads recompute; manifest head and count match | verify.mjs |
| V43a | Regression: E8F regressions = exactly SC.L2-3.13.15 (plus the scenario allowed_reverts controls); the auto-reconcile added or reopened >= 1 | verify.mjs |
| V43b | Drift: no drift across the E7 passes (2 and 3 empty; pass 1 no regression) | verify.mjs |
| V44 | Date filter honoured: collected rows inside their window; seeded rows older than the window never collected | verify.mjs |
| V45 | AdminOps: every E7A op has a result and its AO evidence rows (T2 dry_run + executed; T3 blocked_pending_approval + executed, approver != requestor, or with two-person approval OFF dry_run + executed, no approver) on the registry tenant; E7B reads exactly this run's rows (run window = E1 start); every row has a C10 (collect.adminOps) record with its hash, when C10 is built | verify.mjs |
| V46 | AdminOps writes: each write op's confirming sim read shows the new state; AO writes and AO evidence rows fall in the E7A window only | verify.mjs |
| V47 | E7B drift: improvements = the scenario expected_improvements exactly; no regression; drift baseline = E7 pass 3; nothing new opens on the POA&M | verify.mjs |
| V48 | Overlap: no Stamper (E6 or E8F) write and no E8F revert on an AdminOps-touched object outside allowed_reverts | verify.mjs |
| V49 | Identity scan of the synthetic-customer scope = 0 hits; org ids match the fictional patterns | verify.mjs |
| V50 | Scorecard computed and written (out/scorecard-<slug>.json; every row computed or exempt) | verify-w4.mjs |
| V51 | Every scorecard row within its scenario threshold (PLAN §1, B21) | verify-w4.mjs |
| V52 | GAPS written: >= 1 row per not-met / not-assessed control and per presence-only met control; one row per documentary item | verify-w4.mjs |
| V53 | SC-1 / SC-2 predicates evaluated: 7 P0 and 11 P1 rows, each with a verdict | verify-w4.mjs |
| V54 | Overrides retired: the twelve keys come from Muster with provenance; only initialPassword is generated | verify.mjs |
| V55 | Postchecks assert state: every executed SET-path record carries postcheckMode; presence-only SATs <= threshold; no-action gates <= threshold; no SAT without an action | verify.mjs |
| V56 | Scorecard SC-4 = the SSP's presenceOnly count / met (recounted from out/ssp.json) | verify-w4.mjs |
| V57 | GAPS row count monotonic non-increasing across proof runs for the slug (newest archived GAPS; first run passes) | verify-w4.mjs |
| V58 | Every SSP, DOCX, POA&M, policy and report of a synthetic customer carries "SIMULATED CUSTOMER (FICTIONAL): ..." | verify.mjs |
| V59 | Every seeded deficiency (customers/<slug>/deficiencies.json) is surfaced in GAPS or fixed by its named fixer (report-only without the file) | verify-w4.mjs |
| V60 | CUI Boundary: exactly one cui-boundary-<slug>-*.json pushed; its hash = canonicalSha256(artifact) = MP inputs.cui_boundary_ref (ids equal); Stamper recorded it verified; or skipped with a reason in plan-trace.json | verify.mjs |
| V61 | BTC Confirmation: 01-plans/persisted/btc-confirmation-<slug>-*.json parses as the vendored type; failed gates = the plan's BTC warnings | verify.mjs |
| V62 | Hand-off envelopes: the six envelopes (SI Baseline, TCP, Readiness Posture in EO intake; policy-inputs profile, policy-set manifest, CUI Boundary in the Stamper plans folder) are MP-referenced with the same id and hash; none unreferenced; no EO-only envelope in the plans folder | verify.mjs |
| V63 | E7A: no AdminOps op ends "not run"; every resources.* key and op parameter has a provenance | verify.mjs |
| V64 | S3 after E7A: every customer CA policy excludes resources.breakglass_user_id; both A-19 runs T3 (approver != requestor; with two-person approval OFF, dry run + apply, no approver), confirms passed; V59 counts S3-D04 fixed | verify.mjs |
| V65 | S1, S2: A-21 ran, wrote and confirmed; the bound leaver workflow is enabled, scheduled, with a disable task at E7B; PS.L2-3.9.2 stays not_met, decided by the personnel records store (honest drop) | verify.mjs |
| V66 | No positive source for SC.L2-3.13.15 / SI.L1-3.14.2 names a built-in Exchange policy; discovery never answers "yes" from built-ins alone | verify.mjs |
| V67 | Sign-in frequency weaker than 8 h: CMMC-SessionTimeout written at <= 8 h, no credit on the weaker policy, a GAPS reconciliation row naming both values | verify.mjs |
| V68 | The E7 passes and eo-assess-7b.json end with a terminal event; every EO-log respawn is followed by a retried fetch | verify.mjs |
| V69 | S1, S2: SC-8a within threshold, or the FQ-1 disposition applied (default; --exclude-honest-nulls off disables it), each excluded control listed with its reason | verify.mjs |
| V70 | Every IA.L1-3.5.1 not met cites a corroborating signal; name-only shared-login hits are GAPS review rows only | verify.mjs |
| V71 | After E6, Muster and EO agree on AC.L1-3.1.1, or GAPS holds a reconciliation row naming both bases | verify.mjs |
| V72 | S1: translateForTenant cli and gui projections are equal; the cli projection equals E6's executable plan (variables excluded) | verify.mjs |
| V73 | All four scenarios (FIN-33 / FIN-35): the Stamper UI run (legacy console; SPA once /app/ is built) equals its headless twin on (a) the executable plan projection without variables, (b) the failed set, (c) the mutated objects' end state, keyed by natural identity | verify.mjs |
| V74 | Every AO template and every executable-plan command, rendered with 40+ breakout payloads by the built guard: single-quoted spots keep the payload inside one single-quoted literal, double-quoted and bare spots reject it; zero passes | verify.mjs |
| V75 | AO and EO ran with tokens: tokenless /api calls got 401, E7A with the tokens succeeded, AO /api/health shows auth "ENFORCED" (bind reported, not judged) | verify.mjs |
| V76 | Every AO evidence row names at least one existing objective of its command's controls: the AO registry, this run's E7A rows in ces.db, and the EO package's adminops rows | verify.mjs |
| V77 | AO sweep (E7S, S1): every AO command dry-run with no guard or binding error, applies at or above the floor, Tier 3 by the two-person mode, every row in ces.db | verify-fin29-ao.mjs |
| V78 | The cover's snapshotId equals the SSP's, the POA&M's and E7B's; SSP and POA&M inside the age limit; both DOCX in the package; E8F's stale build was refused with 409 | verify.mjs |
| V79 | The EO package has policies/ (count = pushed policy envelopes), personnel/, stamper-evidence/ (= EO's Stamper chain) and an EO-built evidence-index.json whose every row resolves to a zip file with a matching hash; the integrity manifest covers them | verify.mjs |
| V80 | Every non-stack control met by document review has a review per objective from an approver-token holder who is not the uploader; an upload with no review stays uncredited (not_assessed unless a stack tier or, for PS / AT, EO's store decides; the designated probe stays not_assessed) | verify.mjs |
| V81 | EO's personnel, training, risk and offboarding stores match the customer files, the SSP's PS / AT narratives cite them, and EO holds the interview records (policies reported, not judged) | verify.mjs |
| V82 | Muster WORM rows (muster_plan_push, muster_discovery) exist for this run, their hashes equal the pushed files and discovery-result.json, and an overwrite probe on a copy of ces.db is refused | verify.mjs |
| V83 | Every Stamper evidence file of this run has a WORM stamper_evidence_metadata row whose latest attempt carries the file's sha256; no row changed after it was written; an overwrite probe on a copy of ces.db is refused | verify.mjs |
| V84 | EO intake receipt hashes equal the pushed files; the EO policy store count equals the pushed policies; the SSP boundary section cites the CUI Boundary envelope hash | verify.mjs |
| V85 | Every Stamper evidence file EO assesses from and every stamper_evidence_metadata row is in EO's hash chain with the same hash; statuses unchanged from the baseline; the rows sit under EO's tenant id | verify.mjs |
| V86 | Muster results loop (retired) | verify.mjs |
| V87 | `eo package build` gives the same package (file set and contents minus run-variant values) as the API build of the same snapshot | verify.mjs |
| V88 | E3 compiled through POST /api/plan/compile and its plan equals the retired runner's minus run-variant values; no harness-generated initialPassword; the pushed TM / IM holds muster-api's secret reference, which Stamper's E6 log shows resolved; the reference allows exactly the E6 and E8F reads | verify.mjs |
| V89 | One database (GD-a): no Postgres connection string and no database file but ces.db in the run's roots; package-file rows reported (DB-2/DB-5, PH-5) | verify-fin29-eo-muster.mjs |
| V90 | Both assessor KBs cover the 110 practices and all 320 objectives resolve; the SSP has an assessment approach for every practice; the EO evidence index has a row per met control | verify.mjs |
| V91 | Objective coverage: every in-scope objective has exactly one coverage record of a named type; configure names a configuring entry with that objective id; inherited / not_applicable carry a basis; uncovered <= the DEPTH-0 floor (warn) or zero (fail mode) | verify-depth.mjs |
| V92 | No implement-directive task whose sub-commands are all reads; no executed comment or placeholder; no report-only policy credited to an enforce objective | verify-depth.mjs |
| V93 | Credit by objective: task controls[] = its step’s controls; cross-credit only in credits[] with objective ids; no registry entry executes twice in one run | verify-depth.mjs |
| V94 | One postcheck per in-scope objective with an existing objective id; no boilerplate rows; no control outside the 110; every configure objective’s postcheck has expected_value | verify-depth.mjs |
| V95 | Azure entries: not m365_only => the plan holds the AZ-* entries the enclave filter allows; m365_only => none; CLI plan = GUI plan (V72) | verify-depth.mjs |
| V96 | Manual-directive tasks keep their non-manual-only entries; no manual-only entry yields SAT; no platform_inherited on RA/CA | verify-depth.mjs |
| V97 | Each expected-value postcheck was evaluated against this run’s read for its control, observed value recorded; presence checks use only that control’s evidence; a verdict per objective | verify-depth.mjs |
| V98 | Every planned entry has resolving objective_ids and a source; the quoting lint passes; the simulator answered every command | verify-depth.mjs |
| V99 | Each scoring slice’s predicted statuses and SPRS equal the observed ones, or the run is marked awaiting founder acceptance and the baseline is not replaced | verify-depth.mjs |
| V100 | Muster holds no execution results: E6 ran without CES_MUSTER_API_URL, no muster-results.json, no directive-status file; the EO-read results manifest still exists | verify.mjs |
| V101 | Run-secret leak scan (SP-11): no run secret appears in out/, the EO and EC stores or Stamper evidence; the record holds counts only | verify-fin29.mjs |
| V102 | Reserved, not authored yet: every module answers /api/health over https (secrets plan SP-5) | (comment in verify.mjs) |
| V103 | No recurring SET ran: the key-vault entry is cost_gated_off in the executable plan, nothing is acked, no recurring entry is in the plan, no accepted DP-2 record, no AO recurring op enabled | verify.mjs |
| V104 | The Mission Plan carries the recurring-cost notice; items_hash is the canonical SHA-256 of items; the compile 200 body carries the same notice; all four (m365_azure) list at least 1 item; MX_SUMMARY recurring_items and the push COST_RECURRING line agree | verify.mjs |
| V105 | Cost data is sound: CG-lint items 1-4 and 6 over both Stamper registries, no catalogue drift for registry_entry rows, price_date at most 180 days old | verify.mjs |
| V106 | The firewall is a last resort: no firewall entry in the executable plan; F-12 is Tier 3, recurring and last_resort with a standard alternative; E7A ran no F-12 | verify.mjs |
| V107 | Muster defaults are off: the m365_azure Infrastructure Manifest has Free Defender plans, a Standard vault, RSA keys, 90-day workspace retention, no AzureFirewallSubnet, private endpoint or private DNS zone; all four push one | verify.mjs |
| V108 | The cost gate is score-neutral: every control status and SPRS equal the baseline except SC.L2-3.13.10 (unchanged, or met -> not_met without a BitLocker-escrow resolver); the key-escrow evidence is written and the key-vault evidence is not | verify.mjs |
| V109 | Unit gate fresh: out/unit-gate.json is newer than the newest commit in every workspace repo | verify.mjs |
| V110 | A GUI-approved manual gate never credits a non-stack control: the twin's snapshot has no non-stack control met by a gate record, and EO's assess over the EU run's own root leaves every gate-approved non-stack control uncredited | verify.mjs |
| V111 | SSP truthfulness: no affirmative claim on a not_met / not_assessed control; PS.L2-3.9.2 on terminations and transfers; held resolved where the source exists; EC counts agree with the finding; "Non-Technology Stack" only on the non-stack set | verify.mjs |
| V112 | An upload through EO's own upload route records its uploader and catalog ids; `eo review` posts a review that counts under GD-b; a superseding review replaces the earlier one | verify.mjs |
| V113 | An AO op that starts a recurring cost shows its price in the dry run, is refused without DP-1 and on a wrong DP-2, and runs with DP-1 plus the correct DP-2 on the simulated tenant; every call evidenced | verify.mjs |
| V114 | Muster's own EO intake call at push returned 201 with the push hashes; the interview-record send is recorded; `mu plan compile` equals the API compile; a cross-file push without an override gets 409; a second tenant gets 404 on a claimed slug | verify.mjs |
| V115 | Stamper GUI cost gate: the opt-in list shows the recurring item unticked with its price; without DP-1 it is dropped; with DP-1 and the typed DP-2 in the dialog it runs; both confirmations evidenced (simulated tenant) | verify-fin29-stamper.mjs |
| V116 | Stamper CLI at a terminal (pseudo-terminal): one manual gate approved, one rejected (narrowed to its own control, D-5), one DP-2 typed correctly and one refused | verify-fin29-stamper.mjs |
| V117 | Step E0 on a clean simulated tenant: bootstrap writes the record with a non-exportable key and the grants (held ones held); preflight reports the held items and break-glass; baseline reports an injected failure and stops (title shortened; full text in the file) | verify-fin29-stamper.mjs |
| V118 | Session-family lint (named in the finish plan; no verify row in the run package at the cut) | - |
| V119 | EO's collection scheduler ticked every registered tenant, ran collectors on their cadence, wrote a snapshot and detected a drift the simulator seeded between ticks, with a notice and no write to the tenant | verify-fin29-eo-muster.mjs |
| V120 | EC items and ledger history are write-once (overwrite probe refused); a tampered EC file becomes an EO HASH_DRIFT finding with a notice | verify-fin29-eo-muster.mjs |
| V121 | Muster's engagement layer on ces.db: login, engagement, parties, contracts, HIL flag and resolve, session sync, reassessment and nudge ticks to the simulated mail outbox, touch, delivery grant; the SPRS route equals EO's SPRS | verify-fin29-eo-muster.mjs |
| V122 | Planner is gone: no <ces>/ces-planner, no ces-planner workspace or script, no ces-planner suite in the unit gate; (c) GD-e: no EO-only envelope in the Stamper plans folder and the EO intake names all six kinds (FIN-28) | verify-fin29.mjs |
| V123 | Watched AO UI run (S1, S2, S3) equals the twin's out/adminops-e7a.json: the same ops, calls, outcomes and state changes, the same confirming reads, apply rows naming the same objectives | verify-fin35.mjs |
| V124 | Watched EO UI run equals the twin: assess statuses and SPRS, SSP JSON and DOCX, an upload through the UI with its uploader and catalog ids, a UI review (reviewer != uploader) that leaves its control at the API path's status, the assessor view | verify-fin35.mjs |
| V125 | Watched Muster UI run (FLOW-7): answers typed, discovery, boundary, compile and push through the UI; the pushed plan equals the API compile run with the UI's own inputs (V88 projection), the push file set equals E4, and the answers the UI did not send are reported | verify-fin35.mjs |
| V126 | Stamper validate, report, resume (on a halted run), rollback and tenants list/validate run in step E8R with the expected outputs | verify-fin29-stamper.mjs |
| V127 | AO surfaces (E9A): MCP stdio lists commands and runs a dry run; CLI list, show, approvals; the sim-only rail, the CMMC scope gate and the web apply guard (428) refuse, each evidenced with the two-person mode | verify-fin29-ao.mjs |
| V128 | EO extra routes: manual capture, POST /api/collect, POST /api/policies/import, risk ingest / auto-score / annual review / render, training email and certificate, screening PDF | verify-fin29-eo-muster.mjs |
| V129 | Non-stack coverage matrix over the 28 controls: this scenario equals the pinned matrix, each control decided by its own path; the matrix reaches met and not_met / not_assessed for each control or gives a written reason | verify-fin29-eo-muster.mjs |
| V130 | Muster secondary surfaces: discovery through the API route, the harvest route, collector kit and manifest, recipe ingest, readiness-file import through the compile route and its refusals, the AI gate (collector-kit results import and the SPA import clicks: watched UI run) | verify-fin29-eo-muster.mjs |
| V131 | Leaver flow (PS.L2-3.9.2[b]): detect -> tenant-admin email -> confirm through the token link -> A-22 evidenced -> done notice (+BHD only when the customer opted in); unconfirmed escalates | verify-fin31-leaver.mjs |

## Waivers (open high-severity known issues)

| KI id | Why it is acceptable for this release | Fix due | Waived by (role) | Date |
|---|---|---|---|---|
| | | | | |

## Sign-off

Sign-off is by role. Each signer writes their own name at signing; this kit never names a person.

| Role | Responsibility | Name | Date | Signature |
|---|---|---|---|---|
| Contractor lead engineer | Ran checks 1-8 on a clean machine; the attached files are that run's output. | | | |
| BHD engineering reviewer | Re-ran `check.mjs` (check 5) and spot-checked the attached files against the hashes. | | | |
| BHD owner | Accepts the build for release `<release.id>`; signs any waiver above. | | | |

Release id: `____________`  Release cut date: `____________`  Acceptance date: `____________`

## Secret rotation and access revocation

BHD shares access, never secret values (`secrets.inventory.yaml`, the entries with `sharedByBHD: true`). The contractor creates every other credential on their own machines and tenant.

**Rotation and revocation date:** `____________` (set by the BHD owner at handoff; the work below is done on or before this date, whether or not acceptance has happened).

| Action | Done by (role) | Done on |
|---|---|---|
| Remove or downgrade the contractor's access to the private GitHub org (keep read access only if a support term says so) | BHD owner | |
| Remove the scoped guest account in the BHD GCC High tenant, if one was granted | BHD owner | |
| Rotate anything BHD created for the contractor during the engagement (as listed in `secrets.inventory.yaml`) | BHD engineering | |
| Regenerate the module-secret store on every contractor machine that will keep running CES (`New-CesModuleSecrets.ps1 -Force`; RUNBOOK.md "Secrets rotation") | contractor | |
| Remove the tenant app certificate and app registration from any tenant used only for the engagement | contractor | |
| Delete simulator workspaces that will not be kept (`<Root>\out`, `<Root>\pl`, `<Root>\tenants`) | contractor | |

## Legend
- **S1 / S2 / S3 / mp**: the four synthetic customer scenarios (table at the top). **R-Fn**: BHD proof round n (R-F11 runs at the cut). **PH-n**: a BHD fix wave. **H1**: the handoff agent that refreshed this file.
- **V-nn**: a verify check (table above). **E-step (E0, E1 ... E9, E6X, E7A, E7B, E7S, E8F, E8R, E9A, EU)**: a step of `<PKG>\scripts\mx-e2e.ps1` or of the tester harness, listed in the script header. **T2 / T3, Tier 3**: AdminOps risk tiers (T3 waits for an approver only when two-person approval is on; it is off by default).
- **KI-nn**: a known issue in `KNOWN-ISSUES.md`.
- **MP / TM / IM**: Mission Plan (Muster's plan), Tenant Manifest and Infrastructure Manifest (Muster's other outputs). **SSP**: system security plan. **POA&M**: plan of action and milestones. **SPRS**: the DoD Supplier Performance Risk System score. **GAPS**: the per-scenario gap list (`<Root>\out\GAPS-<slug>.md`). **CUI**: Controlled Unclassified Information. **BTC**: Muster's boundary-and-tenant confirmation. **TCP**: Muster's tenant configuration profile envelope. **CRM**: customer responsibility matrix. **KB**: knowledge base (the assessor guides). **HIL**: human in the loop. **SPA**: single-page app. **CA**: Conditional Access. **DP-1 / DP-2**: the two cost-gate confirmations (opt-in, then a typed confirmation). **WORM**: write once, read many. **twin**: the same scenario run headless, which a watched UI run must equal.
- **FIN-nn, SP-n, GD-x, FQ-n, D-n, DB-n, PH-5, FLOW-7, MG-04, SC-n, CG, B21, DEPTH-0**: labels of BHD plan items quoted in check titles (finish-plan slices, secrets-plan slices, gap-closure decisions, founder questions and decisions, database moves, flows, a parity suite, scorecard measures, the cost gate, plan rows, the depth floor). They are defined in BHD's planning documents and need no action from the contractor.
- **check.mjs**: the kit's drift check in `<PKG>\scripts\handoff\check.mjs`. **GCC High**: Microsoft 365 Government Community Cloud High. **SHA-256**: the hash `Get-FileHash` prints.
