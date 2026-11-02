# What one end-to-end run does: the scenario steps

One run (`pkg\ces-muster-run\scripts\mx-e2e.ps1 -Harness tester -Scenario <slug>`) takes one simulated customer from an empty tenant to a scored SSP and judges every V-check. Each step below is written `module.action`, in run order.

The step ids (E0, E1 ... E9, EL, EX, EU, AO, AUTH, TESTER) appear in `out\steps.json` and in the step logs `out\logs\<step>.*`. They are defined in the tester flow (`ces\ces-tester\src\flow\*.ts`) and the harness (`mx-e2e.ps1`).

## The three main scenarios
- **S1 `s1-mach`**: a small machine shop on Microsoft 365 GCC High with Intune.
- **S2 `s2-eng`**: an engineering firm with an Azure enclave (its key-vault and Azure entries run).
- **S3 `s3-def`**: a defense supplier on the E5 and Intune stack, with drift injected after Stamper runs.

The fourth scenario, **mp `muster-partial`**, runs the same backbone with a partly answered Muster interview. All four are fictional customers in the simulator (tenant-stacksim).

## The steps

### Set up the tenant and collect (Stamper, simulator, Muster)
1. **E0** `stamper.tenant-init`: bootstrap the clean G5 simulated tenant, run the preflight, the baseline (one injected failure, the cost gate DP-1 and DP-2) and the licence check.
2. **E1** `simulator.reseed-and-serve`: reset the scenario's customer and start the simulated tenant.
3. **E2** `muster.discovery`: the read-only discovery walk (`mu discovery --sim`). Every registry read is judged met, not met or unknown.
4. **E3** `muster.plan-compile`: compile the Mission Plan, Tenant Manifest and Infrastructure Manifest (`POST /api/plan/compile`). muster-api issues the secret references.
5. **E4** `muster.plan-push`: push the plan envelopes to Stamper and EvidenceOps, through the push gate.

### Translate and configure (Stamper, AdminOps)
6. **E5** `tenant.register` + `stamper.translate`: register the simulated tenant and translate each directive into registry commands. Cost-gated items are dropped unless DP-1 is given.
7. **EL** `adminops.leaver-flow`: detect a leaver, email the tenant admin (simulated outbox), confirm through the token link, run A-22 (disable, revoke sessions, remove groups, licences and MFA) and send the done notice. On some scenarios nobody confirms, which proves the reminder and escalation path.
8. **E6** `stamper.execute`: get-then-set every planned command on the simulator, with evidence per objective and the manual gates.
9. **E6X** `simulator.drift-reinject` **(S3 only)**: re-break settings after Stamper, so EvidenceOps must catch the drift.

### Evidence and assessment (Evidence Collector, EvidenceOps, AdminOps)
10. **E8.5** `ec.start` + `ec.upload`: start the Evidence Collector and make one catalog-tagged upload, plus the customer's organisation records.
11. **E8.6** `eo.document-review`: a reviewer approves the customer's documents, using an approver token minted by EO.
12. **E8.5b** `eo.upload`: one upload through EO's own upload route, with the uploader and the catalog ids.
13. **E8.6b** `eo.review-supersede`: a second review supersedes the first on that upload (the `eo review` CLI).
14. **E7** `eo.connect` + `eo.assess` (three passes): assess all 110 practices and 320 objectives, three times (drift check).
15. **E7A** `adminops.governed-ops`: the scenario's AdminOps operations (for example A-02, A-10), governed, simulator only.
16. **E7B** `eo.reassess`: re-assess after AdminOps. This pass is the authoritative SPRS score.
17. **E8** `eo.ssp` + `eo.poam` + `eo.evidence-package`: the SSP (JSON and DOCX), the POA&M, the ledger and the evidence package, plus the simulator write-ledger snapshot.
18. **EX** `tester.compare`: compare the readiness facts, the tenant state after Stamper and the simulator ledger with the twin.
19. **E8B** `harness.evidence-bundle`: the raw and shared evidence bundle, its manifest and the identity scan.

### Failure, lifecycle and cost-gate legs (Stamper, AdminOps)
20. **E8F** `stamper.forced-failure`: a run with one forced failure, then one EO assess and SSP. The failure must show honestly.
21. **E7C** `adminops.cost-gate` **(S1 only)**: a dry run; apply refused without DP-1; a wrong DP-2 refused; DP-1 plus DP-2 applies.
22. **E8R** `stamper.lifecycle`: validate, report, a halted run then resume, rollback, tenants list and validate.
23. **E8T** `stamper.cli-terminal` **(S2 only)**: a real terminal session. DP-1 typed, one gate approved, one rejected, DP-2 refused then accepted.
24. **E8G** `stamper.gui-cost-gate` **(S3 only)**: the GUI's priced opt-in list, translate drops without DP-1, the DP-2 dialog on an incremental run.

### Secondary surfaces (AdminOps, EvidenceOps, Muster)
25. **E9A** `adminops.surfaces`: the MCP tool server, the CLI (list, show, approvals), the simulator-only rail, the CMMC scope gate, the web apply guard (428).
26. **E9E** `eo.continuous-collection` + `ec.integrity` + `eo.extra-routes`: the scheduler ticks and catches drift; the write-once EC with tamper detection; EO's other routes.
27. **E9M** `muster.engagement` + `muster.secondary-surfaces`: the engagement layer (login, parties, contracts, HIL, reminders to the simulated mailbox), harvest, the collector kit, recipes, the readiness import and its refusals.
28. **E7S** `adminops.sweep` **(S1 only)**: every AdminOps command dry-run, then applied where the simulator and the cost gate allow.
29. **AO** `simulator.coverage-ao`: the AdminOps coverage report (96 commands), after the run's servers stop.

### Watched screen runs (headed browser, paced, with video and trace)
30. **EU** `stamper.ui-run`: the Stamper console run on the legacy page and on the SPA, compared with its twin.
31. **EU-AO** `adminops.ui-run`: the watched AdminOps run, which must equal its twin.
32. **EU-EO** `eo.ui-run`: assess, SSP, upload, review and assessor view through EO's screens.
33. **EU-MU** `muster.ui-run`: typed answers, discovery, CUI boundary, compile and push through Muster's screens.

### Close out (harness)
34. **AUTH** `harness.auth-probe`: AdminOps and EO refuse calls without a token and accept them with one.
35. **TESTER** `tester.run-record`: write the run record the checks read (`out\tester-run.json`).
36. **E9** `harness.verify`: judge every V-check (V1-V131) against the baseline and the prediction (`out\verify.json`).

## How the three differ
| Scenario | Steps only it runs |
|---|---|
| S1 | E7C AdminOps cost gate; E7S full AdminOps sweep |
| S2 | E8T Stamper terminal leg |
| S3 | E6X drift re-injection; E8G Stamper GUI cost leg |

## Legend
- **SSP / POA&M / SPRS**: System Security Plan; Plan of Action and Milestones; the DoD's Supplier Performance Risk System score (maximum 110).
- **DP-1 / DP-2**: the cost gate's plan-time opt-in and its run-time typed confirmation, for anything with a recurring Azure cost.
- **A-02, A-10, A-22**: AdminOps operation ids (`ces\ces-ao\src\registry\ao-commands.registry.json`). A-22 is the leaver.
- **Twin**: the headless API run that a watched screen run must match.
- **HIL**: human-in-the-loop flags in Muster.
- **V-check**: a numbered verification in `pkg\ces-muster-run\scripts\verify*.mjs`; the set is listed in `ACCEPTANCE.md`.
