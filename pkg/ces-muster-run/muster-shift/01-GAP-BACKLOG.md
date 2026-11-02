# Muster gap backlog: parity with Planner

**Audience:** contractor developers working in `ces-mono` and `ces-muster` (read `00-PREAMBLE.md` and `ces-onboarding/`
first).
**Baseline:** `ces-muster` `main` @ `1b6f0f6` (v2.2.3); Planner in `ces-mono` under `ces-planner/` @ `6c8148c`.
**Revision:** 2026-10-21, with BHD's scope decisions applied (see `02-DECISIONS.md`).

## 1. Purpose and how to use this list

Muster is generation 2 of Planner. **Parity = same outputs, fewer questions:** for a given customer Muster must emit
Planner's in-scope artifacts with equivalent content, but get there through tenant discovery, inference and defaults
instead of Planner's ~316 typed prompts.

- **An unasked Planner question is not a gap.** It is a gap only when the information it feeds into an output is
  **neither asked nor derived** (nor safely defaulted).
- **Planner bugs are not targets** (section 5). Muster-only features (contracts, rollup, portal, nudges, coach) are not
  part of this work. Pricing outputs are out of scope (section 4).
- **Using the list:** work by wave (section 6), P0 first. "Done when" is the acceptance test, ideally a content diff
  against Planner's output via the MG-04 harness. `ces-planner/...`, `ces-stamper/...` and `ces-shared/...` paths are
  in `ces-mono`; `ces-onboarding/` is the onboarding guide; all other paths are in `ces-muster`; `:N` = line at the baseline commit.
- **BHD input** in Depends-on means the item waits on content or a resource BHD supplies (see `00-PREAMBLE.md`).
- The **reference customer (withheld)** backed earlier checks; its data is not in the repos, so parity runs on scrubbed
  fixture customers (MG-04).

## 2. Output parity matrix

Status (today) values: **pushed** = produced and pushed to Stamper; **download** = produced, download only;
**partial** = produced but content is incomplete or diverges; **missing** = not produced; **out of scope** = not to be
produced by Muster. The V1 target column is what Muster must deliver.

| Planner output | Planner producer (`ces-planner/src/features/`) | Consumer | Muster status today | V1 target | Gap IDs |
|---|---|---|---|---|---|
| Manual Mission Plan (MP) | `mpt/services/manualPlanGenerator.ts` | Stamper | **pushed**, but partial: no CUI/BTC input, mode fixed to `harden_existing`, compiled from an unemitted posture | pushed, parity content; the inline `cost_proposal_sow` block is omitted (out of scope) | MG-03, MG-08, MG-09, MG-10 |
| Tenant Manifest (TM) | `mpt/services/manifestGenerator.ts` | Stamper | **pushed**, but partial: no `boundary_zones` input; `tenant_identity` comes from a mostly defaulted TCP | pushed, parity content | MG-08, MG-14 |
| Infrastructure Manifest (IM) | `mpt/services/infraManifestGenerator.ts` | Stamper | **pushed**, but over-produced (almost every session builds one) | pushed only when the infrastructure model needs one | MG-05 |
| SI Baseline | `sit/services/baselineGenerator.ts` | every later stage, Stamper | **download** (only 7 of 26 fields derived) | **pushed** to Stamper | MG-13, MG-12, MG-27 |
| Tenant Config Profile (TCP) | `tcp/services/tcpProfileGenerator.ts` | TM, IM, tasks, policy context, Stamper | **download**, partial: 7 asked, the rest are bank defaults, not the tenant's real config | **pushed** to Stamper | MG-14, MG-12, MG-27 |
| RR Question Set | `sit/services/questionSetGenerator.ts` | RRT, exclusions report | **missing** as an artifact (25 static nodes stand in for 165 filtered activities) | produced, all 165 activities filtered per scenario | MG-07 |
| Readiness Posture | `rrt/services/postureGenerator.ts` | MP, tech-ref, control assessment, Stamper | **partial**: two different postures, neither schema-checked | one posture, **pushed** to Stamper | MG-03, MG-07, MG-12, MG-27 |
| CUI Boundary output | `cui/services/cuiBoundaryGenerator.ts` | BTC, RR boosts, gaps, TM zones, MP boundary context | **missing** (3 boundary answers collected, then `null` passed to the compile) | produced | MG-08 |
| BTC Confirmation | `btc/services/btcOutputGenerator.ts` | posture, gaps, tasks, validator | **missing** | produced (BTC-lite) | MG-09 |
| Policy Inputs | `policy/services/policyProfileGenerator.ts` | policy rendering | **missing** | produced | MG-16 |
| Policy documents (all 20) + DOCX | `mpt/services/policyRenderer.ts`, `policyDocxExporter.ts` | customer | **missing** (templates copied, no renderer) | all 20 rendered, DOCX download | MG-16 |
| Exclusions report | `mpt/services/exclusionsReportGenerator.ts` | customer, assessor | **missing** | download | MG-11 |
| Traceability report | `mpt/services/traceabilityReportGenerator.ts` | customer, assessor | **missing** | download | MG-11 |
| Control assessment report | `mpt/services/controlAssessmentReportGenerator.ts` | customer, assessor | **missing** | download | MG-11 |
| Tech-ref implementation guide | `ces-planner/src/shared/utils/exportTechRefPlan.ts` | implementer | **missing** | download | MG-18 |
| Cross-artifact validation | `mpt/services/validator.ts` | release gate | **missing** (Muster has Zod checks on MP/TM/IM only) | blocking check with audited override | MG-15 |
| Proposal + SOW | `mpt/services/proposalGenerator.ts` | customer | missing | **out of scope** | MG-17 |
| Proposal LOE CSV | `ces-planner/src/shared/utils/exportProposalCsv.ts` | customer | missing | **out of scope** | MG-17 |
| Cost estimate | `cost-estimator/services/g5CostCalculator.ts` | sales | missing | **out of scope** | MG-26 |

Muster also produces outputs Planner lacks: SPRS score, readiness-result v1.1.0, evidence package and status payload.
Keep them.

## 3. Gap backlog

Priority: **P0** = blocks correct outputs or is a correctness risk; **P1** = output parity; **P2** = automation and
question reduction; **P3** = polish.

**The question rule (applies to every item).** No item has a fixed question-count target. Every input follows
**discover → infer → default → ask**. A value is asked only when an output needs it and it cannot be derived or
safely defaulted. Every question Muster asks must appear in the question register (MG-28) with the output field it
feeds and why it can't be derived. Where a "Done when" below says "register-justified", it means: every question the
item leaves asked has a register row, and the parity diff still passes.

### P0: correctness and enablers

| ID | Area | Gap | Automation approach | Starting points | Done when | Size | Depends-on |
|---|---|---|---|---|---|---|---|
| MG-01 | Discovery to scoring | **An empty discovery read scores as met.** It gets confidence `low`; the join maps any non-`unknown` confidence to `yes`, class A (outranks the interview); posture is dropped on import; re-export marks it `met`. Readiness and SPRS are overstated. | Empty read → no fact (node stays asked). Carry `posture` through import/join; class A only when posture is `met`. | `muster-api/src/services/discoveryService.ts:186-192`; `src/features/discovery/discoveryRunService.ts:82`; `src/features/discovery/importReadinessResult.ts:67-73`; `src/features/discovery/BoundaryConfirmPanel.tsx:59`; `src/features/interview/discoveryFactJoin.ts:41-48`; `src/features/scoring/factRouter.ts:47`; `src/features/export/readinessResultService.ts:89` | Sim fixture with one empty read: node stays asked, requirement not `met`, SPRS equals the no-discovery score, re-export not `met`. Tests in SPA and API. | S | none |
| MG-02 | Discovery verdict | **Discovery `met` = "the read returned output"**, not "compliant" (a disabled CA policy counts as met). Planner got this judgement from a human. | Per registry entry, an expected-value predicate (e.g. `state == enabled`) → `met`/`not_met`/`unknown`; no predicate → `unknown`, node asked. | `muster-api/src/services/discoveryService.ts`; `src/features/interview/discoveryFactJoin.ts`; `src/features/interview/factCoveragePruner.ts:40-60`; the Stamper registry entry shape `RegistryGetEntry` (`muster-api/src/services/discoveryService.ts:15-16`); predicates can live beside it in Muster | Every pruning entry has a predicate with positive and negative sim tests; a non-compliant sim tenant yields `not_met` and prunes nothing. Proven live on the BHD test tenant once MG-19 lands. | L | MG-01 (MG-19 for the live proof) |
| MG-03 | Posture | **Two postures.** The MP compiles from a bridged posture that is never emitted (1970 dates, empty `evidence_refs`); the Result screen shows a different one built over a stack-only SI stub. | One posture from the real SI Baseline, real dates, `evidence_refs` kept; emit it and pass the same object to `compileGapSet`. | `src/features/plan/tenantManifestAdapter.ts:115-135`; `src/features/scoring/scoringService.ts:87-96`; Planner `ces-planner/src/features/rrt/services/postureGenerator.ts` | MP's posture ref hash = emitted posture hash; Result screen and MP agree on every requirement status; no 1970 dates. | M | MG-01 |
| MG-04 | Parity harness | No test compares Muster's MP/TM/IM/SI *content* with Planner's for the same customer. Existing tests prove structure and generator faithfulness only, and pass-with-warning when the reference customer (withheld) is absent. | Commit 4+ **scrubbed fixture customers** (synthetic names and tenant IDs): (a) GCC High + CUI, `harden_existing`; (b) no CUI; (c) `m365_only`; (d) `build_new`. Each = Planner inputs + Planner golden outputs (generated in `ces-mono`) + matching Muster session/discovery fixture. Normalize IDs/timestamps; diff MP directives, TM intents/controls/zones, IM resources, SI fields, TCP, posture and tasks. **Exclude pricing:** the MP `cost_proposal_sow` block and any LOE/rate fields are out of scope and sit in the allow-list with that reason. Planner has no headless export, so the golden generator is a script that calls the Planner generators directly, replicating `ces-planner/src/features/mpt/hooks/useMissionPlanGenerator.ts:62-334`. | `src/features/plan/__tests__/planParity.test.ts`, `siEquivalence.test.ts`, `generateFixtures.test.ts`, `fixtureInputs.ts`; `scripts/generate-plan-fixtures.ts`; `src/features/plan/__fixtures__/`; Planner generators under `ces-planner/src/features/{sit,tcp,mpt}/services/` | `npm test` parity suite **fails** on any content diff not in a reviewed allow-list (reason per entry); fixtures hold no real customer data; runs in CI without sibling repos. | L | none |
| MG-05 | IM inference | SIT-020 derives `m365_azure` for **any** cloud stack, so nearly every session pushes an Azure IM that Stamper may provision unasked. VM image/size hard-coded. | Infer from discovery: no Azure subscription → `m365_only` (no IM); Sentinel workspace only → `m365_sentinel`; workloads → `m365_azure`. No signal → one register-justified confirm question; never default `m365_azure`. | `src/features/plan/siDerivation.ts:194-203`; `src/features/plan/tcpAdapter.ts:298-320`; `src/features/plan/planCompileService.ts:274`; Planner `ces-planner/src/features/mpt/services/infraManifestGenerator.ts:92` | Fixture (c) pushes no IM. Fixture (a) produces the same resource set as Planner's golden IM. Each inferred model carries a provenance row. | S | MG-04 |
| MG-06 | Tenant isolation | RLS unproven on a live DB; `001_init` sets `postgres` BYPASSRLS, so connecting as `postgres` exposes every tenant; no role/grant bootstrap. | Bootstrap a non-superuser app role; startup check refuses a BYPASSRLS role; run RLS tests in CI against Postgres. | `muster-api/prisma/migrations/001_init/migration.sql:110-114`; `muster-api/src/lib/prisma.ts:26-36`; `muster-api/tests/rls.test.ts`; `.github/workflows/ci.yml` | The CI job runs the 3 RLS tests (not skipped). The API refuses to start as a BYPASSRLS role. | M | MG-20 |
| MG-28 | Question register | There is no single list of what Muster asks, what each answer feeds, or why it can't be derived. Without it, "fewer questions" can't be measured or reviewed. | Generate a register from the question graph and plan-input nodes: one row per asked question, with node ID, the output field(s) it feeds, the discovery/inference sources tried, and the reason it can't be derived (or "candidate for derivation: MG-nn"). Keep it in the repo next to the graph; a test fails when a question node has no register row. | `src/features/interview/questionGraph.ts`; `src/features/interview/siPlanInputNodes.ts`; `src/features/interview/tcpPlanInputNodes.ts`; `src/features/plan/planCompileService.ts:142-155` (provenance and `defaultedInputs`) | The register covers every question asked today (about 80); CI fails on an unregistered question node; each later item updates it, and every row names an output field. | M | none |

### P1: output parity

| ID | Area | Gap | Automation approach | Starting points | Done when | Size | Depends-on |
|---|---|---|---|---|---|---|---|
| MG-07 | Readiness coverage | Planner filters **all 165** RR activities per scenario and records the exclusions. Muster hand-picked 25 static nodes, so the posture covers fewer requirements and there is no question-set artifact. | Vendor `questionSetGenerator` to select activities from the RR bank already copied. Derive statuses from discovery plus the vendored bulk cascade (`bulkAnswerDerivation`). Ask only the residue the cascade can't settle. | `src/features/interview/questionGraph.ts:1-3`; `src/features/interview/questionGraphService.ts:41-57`; `public/knowledge/` (RR bank); Planner `ces-planner/src/features/sit/services/questionSetGenerator.ts:312`, `rrt/services/bulkAnswerDerivation.ts:237` | For each fixture, the selected and excluded activity sets equal Planner's across all 165 activities. Residual asked activities are register-justified. | L | MG-02, MG-04, MG-28 |
| MG-08 | CUI boundary | The `bnd-001..003` drafts are collected, but `compileGapSet`, `generateTenantManifest` and `generateManualPlan` get `null` for CUI. As a result, TM `boundary_zones` and MP `boundary_context` are empty. | Build a `cui_boundary_output` from the confirmed `bnd-*` answers, the footprints from `boundaryInference`, and SI defaults (vendor `cuiSIDerivation`, including the no-CUI skip). Ask only bindings still unresolved. Don't port the 24-question wizard. | `src/features/plan/tenantManifestAdapter.ts:188-189,253-254,286-287`; `src/features/interview/boundaryInference.ts:23-97`; Planner `ces-planner/src/features/cui/services/{cuiSIDerivation,cuiBoundaryGenerator}.ts` | For fixture (a), TM zones and MP boundary context match Planner's golden. For fixture (b), the boundary is skipped exactly as in Planner. Any boundary question asked is register-justified. | M | MG-04 |
| MG-09 | BTC | There is no BTC confirmation. Planner uses BTC evidence to raise unknown to partial and to feed gaps, tasks and the validator. | BTC-lite from discovery: map each `raw_capture_ref` to `evidence_refs`, vendor `runlistEngine` (9 rules) and `btcSICUIDerivation`, and evaluate gates. Ask only gates that have no evidence. | `muster-api/src/services/discoveryService.ts` (`raw_capture_ref`); `src/features/plan/tenantManifestAdapter.ts`; Planner `ces-planner/src/features/btc/services/{runlistEngine,btcSICUIDerivation,btcOutputGenerator}.ts`, `rrt/services/postureGenerator.ts:27-42` | Activated rules, risk flags and gate results match Planner's golden for fixture (a). Requirements with captured evidence move from unknown to partial in the emitted posture. | L | MG-03, MG-08 |
| MG-10 | Plan mode | `planMode` is always `harden_existing`. V1 needs `harden_existing` **and** `build_new`. `migrate` and `hybrid` are deferred. | Derive from discovery: no target tenant (or an empty one) → `build_new`; an established target tenant → `harden_existing`. The operator confirms with one register-justified question. If discovery sees migrate/hybrid signals (directory sync or on-prem AD; a commercial source tenant with a GCC High target), flag "deferred mode" in the plan and raise it with BHD rather than building it. | `src/features/plan/tenantManifestAdapter.ts:212`; Planner `ces-planner/src/features/mpt/hooks/useMissionPlanGenerator.ts:339-344` | Fixtures (a) and (d) yield MPs whose milestones and steps match Planner's golden for `harden_existing` and `build_new` respectively. A migrate/hybrid signal produces the deferred-mode flag. | M | MG-04 |
| MG-11 | Reports | The exclusions, traceability and control-assessment reports are missing. All three are pure derivations from the gap set, tasks and posture. | Vendor the three generators unchanged. Add them to `vendor-manifest.json` and offer them as **downloads** (also included in the evidence package). Styling is P3. | Planner `ces-planner/src/features/mpt/services/{exclusions,traceability,controlAssessment}ReportGenerator.ts`; `vendor-manifest.json`; `src/features/plan/PlanTab.tsx` | For each fixture, the report content equals Planner's golden and each report downloads from the Plan tab. `check:drift` covers the new files. | M | MG-03, MG-07 (exclusions report only) |
| MG-12 | SI/TCP/posture hand-off | The SI Baseline and TCP are download-only and the posture isn't sent, so Stamper and the evidence trail can't see the inputs that shaped the plan. | **Push** the SI Baseline, TCP and Readiness Posture to Stamper with every plan push, each with its `cesId`, validated against the MG-27 contracts; reference their hashes from the MP. Persist them alongside MP/TM/IM in Muster. Persist-and-reference is an acceptable interim step while MG-27 lands, but it is not "done". | `muster-api/src/routes/plan.ts:164-180`; `src/features/plan/siBaselineAdapter.ts`; `src/features/plan/tcpAdapter.ts`; Stamper intake under `ces-stamper/` | A plan push delivers SI, TCP and posture to Stamper alongside MP/TM/IM; Stamper accepts them under the MG-27 contract and lists them in browse; the MP refs resolve to them; a cross-module test (like `plan.push.stamperBrowse`) covers it. | M | MG-27, MG-03 |
| MG-13 | SI derivation | Only 7 of 26 SI fields are derived, and several derivations only move the question to another tab. Fields neither asked nor derived silently use defaults. | Derive from discovery: license tier (SKUs), user count, tenant model (cloud instance), remote access / nonlocal maintenance / removable media (CA, Intune, device config), mobile (enrollment). Show as overridable pre-fills; archetype prior where discovery is silent. | `src/features/plan/siDerivation.ts:132-220`; `src/features/interview/siPlanInputNodes.ts`; `src/features/plan/planCompileService.ts:142-159`; `muster-api/src/services/harvestService.ts:74-128` | For fixture (a), the derived SI Baseline equals Planner's golden. Remaining SI questions are register-justified. `defaultedInputs` lists no field that feeds an output without a register or provenance entry. | L | MG-04, MG-21, MG-28 (MG-19 for live) |
| MG-14 | TCP from tenant | Of the 32 unasked TCP fields, 5 are SI-derived and the rest are bank *recommendations*, not the tenant's actual config, so for `harden_existing` the TM can contradict the real tenant. Planner typed real values. | Fill from discovery (domains, cloud, sync, privileged roles, CA, groups, enrollment, DLP, audit, Sentinel); archetype or bank default only where silent, marked `defaulted`. | `src/features/plan/tcpAdapter.ts:119-190`; `src/features/interview/tcpPlanInputNodes.ts:36-100`; Planner `ces-planner/src/features/tcp/services/tcpProfileGenerator.ts:107` | For fixture (a), the TCP equals Planner's golden. Each field carries provenance (`discovered` / `asked` / `archetype` / `defaulted`). Remaining TCP questions are register-justified. | L | MG-02, MG-21, MG-28 (MG-19 for live) |
| MG-15 | Validation | Muster lacks Planner's cross-artifact alignment check. The SI, TCP and posture are not schema-checked at runtime. | Vendor `validator.ts` and run it before push. **Drop its proposal checks** (it errors on a missing proposal block, and pricing is out of scope). Make structural errors and MP↔TM control mismatches **blocking**; warn on the rest. Add an **operator override**: requires a reason, and records user, time, reason and the overridden errors in the muster-api audit log; the pushed plan carries an override flag. Validate SI, TCP and posture against their copied schemas before compile. | Planner `ces-planner/src/features/mpt/services/validator.ts` (proposal checks at `:28-58`); `muster-api/src/routes/plan.ts:146-158`; `src/features/plan/missionPlanContract.ts`; `public/schemas/planner/` | A push with a misaligned MP/TM is refused with a named error. An override with a reason succeeds and leaves an audit record. Each fixture passes validation with zero warnings beyond the allow-list. | M | MG-04 |
| MG-16 | Policy | Muster has no policy-inputs profile and renders none of Planner's policy documents. Scope is **all 20** policy, SSP, POA&M and IR templates Planner can generate. | Org metadata from Graph `/organization` plus the organisation identifiers already in the engagement profile; personnel drafted from directory role holders (confirmed by a human); the 15 ODPs default to recommended values; governance dates from milestones; policy context from the SI Baseline and TCP. Vendor `policyRenderer` + DOCX exporter. The vendoring can start in wave 2 against defaulted inputs. | `public/templates/policies/` (20 templates + `registry.yaml`); `src/features/assessment/AssessmentPage.tsx:671-880`; Planner `ces-planner/src/features/policy/services/policyProfileGenerator.ts:22`, `mpt/services/{policyRenderer,policyDocxExporter}.ts` | For fixture (a), all 20 documents render, singly and all-at-once as DOCX, with completeness ≥ Planner's for the same inputs. Policy questions are register-justified. BHD has reviewed the rendered set. | L | MG-04, MG-13, MG-14, MG-21, MG-28, BHD input (review) |
| MG-18 | Tech-ref | The per-control tech-ref implementation guide is missing. The tech-ref JSON is already copied. | Vendor `exportTechRefPlan`, driven by the single posture from MG-03; offer it as a download. | Planner `ces-planner/src/shared/utils/exportTechRefPlan.ts:80`; `src/features/plan/compilerBanks.ts:22-23` | The output equals Planner's golden per fixture and downloads from the Plan tab. | S | MG-03 |
| MG-19 | Live tenant | Live discovery/harvest have never run on a real tenant: the SPA sends sim only; 75 of 201 live reads have unfilled `{placeholders}`; consents and jobs are in memory. MG-02, 05, 09, 10, 13 and 14 need it for live proof. **In scope, read-only**, alongside the simulator. | Resolve placeholders from earlier reads; persist consents/jobs in the DB; SPA `live` toggle behind the engagement flag. Prove on the BHD-owned test tenant before any customer tenant. | `src/features/discovery/discoveryRunService.ts:62-65`; `src/features/assessment/harvestRunService.ts:19`; `muster-api/src/routes/discovery.ts:71-79`; `muster-api/src/services/liveAccess.ts:382`; `docs/backlog/REQ-muster-live-{discovery,harvest,variable-resolution}.md`; `ces-onboarding/` chapter 08 | A run against the consented BHD test tenant completes with no unresolved placeholders and no write calls. Consents survive an API restart. The simulator path still passes. | L | BHD input (test tenant) |
| MG-27 | Stamper intake contract | Stamper has no contract for receiving the SI Baseline, TCP or Readiness Posture. This is a cross-module change in `ces-mono`. | Add Zod contracts for the three artifacts to `ces-shared` (from the Planner schemas already copied); extend Stamper's plan intake to accept, store and list them; version the contract. The contractor team owns both sides (D11); keep existing MP/TM/IM intake unchanged. | `ces-shared/` (existing MP/TM/IM contracts); `ces-stamper/` (plan intake and browse); `public/schemas/planner/` in `ces-muster`; `muster-api/src/routes/plan.ts` | `ces-shared` exports the three contracts; Stamper accepts, stores and lists all three; contract tests pass in both repos. | M | — |

### P2/P3: automation, hardening, polish

| ID | Area | Gap | Automation approach | Starting points | Done when | Size | Depends-on |
|---|---|---|---|---|---|---|---|
| MG-20 | CI (P2) | muster-api is not in CI, and e2e intercepts every API call, so SPA↔API is proven only by contract tests. | Add an API job (Postgres service, stacksim) and one unmocked e2e path: plan compile → push → Stamper browse. | `.github/workflows/ci.yml`; `e2e/plan-send-stamper.spec.ts` | CI runs the API suite and one real e2e path. | M | none |
| MG-21 | Archetypes (P2) | Archetype priors are fixture placeholders (M-14), so there is no fallback default when discovery is silent. | **Build the mechanism; BHD supplies the content.** Apply archetypes after discovery, before asking; leave content slots for the archetypes BHD provides. Don't invent archetype content. | `src/__fixtures__/archetypes.ts:1-6` | The mechanism pre-fills fields with provenance `archetype` using a test archetype; once BHD content lands, each real archetype pre-fills its fields. | M | BHD input (archetype content, before wave 3) |
| MG-22 | Consistency (P2) | Planner's 8 staleness and consistency rules have no Muster equivalent (for example, a plan compiled from discovery older than the latest run). | Port the applicable rules (SI vs. CUI on BYOD, DevOps and sharing; CUI/BTC vs. discovery run date; BTC gate vs. posture) as pre-push checks, feeding MG-15's warnings. | Planner `ces-planner/src/shared/services/consistencyChecker.ts:237-255` | A stale or conflicting fixture produces the named warning. | S | MG-08, MG-09, MG-15 |
| MG-23 | Traceability (P2) | `ran_entry_ids` is a TODO, so the readiness result doesn't say which reads ran. | Populate it from the discovery job's statuses. | `src/features/export/readinessResultService.ts:99` | The exported payload lists the entries that ran, and passes ajv. | S | MG-01 |
| MG-24 | Domain markers (P3) | 29 `[validate with BHD]` markers remain across `src/` and `muster-api/src/`. | Triage them into a list in wave 1 and send it to BHD, so the answers arrive before wave 3. Don't guess. Apply the answers when they land. | `grep -rn "validate with BHD" src muster-api/src` | Each marker has an owner and a resolution, or is removed. | S | BHD input (marker answers) for resolution; none for triage |
| MG-25 | Help (P3) | The glossary and guidance help files are copied but unused. | Wire them as tooltips on derived-answer rows, so the operator sees why a value was inferred. | `public/knowledge/` (help YAMLs); Planner `ces-planner/src/shared/components/Display/GlossaryText.tsx` | Tooltips render on SI, TCP and boundary nodes. | S | none |

## 4. Out of scope

Pricing in any form is out of scope for Muster. Don't vendor, wire or extend these.

| ID | Was | Note |
|---|---|---|
| MG-17 | Fixed-price proposal, SOW, LOE rate card and LOE CSV (`proposalGenerator`, `exportProposalCsv`) | The existing `src/vendored/ces-planner/shared/config/loeRatesProvider.ts` shim stays as is, unwired. The MP's inline `cost_proposal_sow` block is omitted; MG-04 allow-lists it and MG-15 drops the validator's proposal checks. |
| MG-26 | Tenant cost estimate (`g5CostCalculator`) | Not produced. |

## 5. Planner defects Muster should not inherit

These are **not** parity targets. Muster should do it right; some items are already fixed and only need a regression test.

| Planner defect | Muster target | Status in Muster |
|---|---|---|
| The SI generator drops SIT-020/021/022 (infrastructure model, license tier, user count) from `dependencies`. Downstream defaults then disagree (`m365_azure`/`g5` in the gap compiler, `m365_sentinel` in the IM generator). | Carry all three fields; use one default source. | **Fixed** by a post-generation patch (`src/features/plan/siBaselineAdapter.ts:197-219`). Add a regression test to MG-04. |
| No SPRS computation. | Compute SPRS. | **Done** (ces-spine scoring). Keep it, and keep it fed by the corrected posture (MG-01, MG-03). |
| Plan, TM, TCP and tech-ref schema validators exist but are never called; the IM schema is never loaded. | Validate every emitted artifact before push or download. | Partial: Zod covers MP/TM/IM. MG-15 and MG-27 add the rest. |
| Cross-artifact misalignment only warns; BTC gates and the consistency checker never block. | Block a push on structural and control misalignment (audited override); show gate failures as a plan risk. | MG-15, MG-22. |
| Governance owners, evidence mode, retention and budget have no question and are silently defaulted. | Derive or ask anything that feeds an output; list every default in `defaultedInputs`; register every question. | Partial; MG-13, MG-28. |
| Save, mirror, Stamper hand-off and autofill work only in `vite dev`. The Stamper target path hard-codes a tenant identifier. | Server-side push to the tenant's folder, keyed by tenant id. | **Done** (`/api/plan/push`). |
| There are no tests for the TCP, CUI, BTC or PI generators, the question-set filter, the RRT cascade, the manifest generator or policy rendering. | Cover every vendored producer with fixture tests. | MG-04 plus each item's Done-when. |

## 6. Suggested sequencing

| Wave | Goal | Items |
|---|---|---|
| 1. Make it correct and measurable | Stop overstated readiness and unwanted Azure builds, lock tenant isolation, and stand up both yardsticks: the parity harness and the question register. Send the domain-marker list to BHD. | MG-01, MG-03, MG-04, MG-05, MG-06, MG-20, MG-23, MG-28, MG-24 (triage) |
| 2. Cheap parity from data already held | Pure derivations and inputs already collected; no new questions. Start the cross-module Stamper contract and the archetype mechanism. | MG-08, MG-10, MG-11 (exclusions report follows MG-07), MG-15, MG-18, MG-27, MG-12, MG-21 (mechanism) |
| 3. Discovery-driven automation | Replace defaults and typed answers with tenant facts. Needs BHD's archetype content, marker answers and test tenant. | MG-19, MG-02, MG-21 (content), MG-24 (apply answers), MG-07, MG-09, MG-22, MG-13, MG-14 |
| 4. Policy documents and polish | All 20 policy documents on real SI/TCP inputs, BHD review, help tooltips. | MG-16, MG-25 |

Notes:

- MG-19 is the enabler for most of wave 3. It can start in wave 2 as soon as the BHD test tenant is available.
- MG-02 can start in wave 1 against the simulator; its live proof needs MG-19.
- MG-16 is P1 but sits in wave 4 because it needs MG-13 and MG-14. Vendoring the renderer can start in wave 2.
- MG-12 can ship persist-and-reference in wave 2 while MG-27 is agreed; it is done only when the push lands in Stamper.

## 7. Legend

| Term | Meaning |
|---|---|
| MG-nn | Item IDs in this backlog |
| MP / TM / IM | Manual Mission Plan / Tenant Manifest / Infrastructure Manifest (the three artifacts Stamper consumes today) |
| SI / SIT | Strategic Intent Baseline / the Strategic Intent Tool and its question IDs (`G-`, `S-`, `SIT-`) |
| TCP | Tenant Config Profile |
| CUI | Controlled Unclassified Information; also the CUI Boundary output and stage |
| BTC | Boundary Topology Confirmation (Planner's source does not expand the acronym) |
| BTC-lite | This backlog's term for a BTC output built from discovery evidence instead of a 22-question wizard |
| RR / RRT | Readiness Recon question bank (165 activities) / Readiness Recon Tool, which produces the Readiness Posture |
| MPT | Mission Planning Tool, Planner's final stage that compiles the MP, TM, IM and reports |
| PI | Policy Inputs (organization, personnel, ODPs, governance, physical security) |
| ODP | Organization-defined parameter (NIST SP 800-171 Rev 3) |
| SPRS | Supplier Performance Risk System score |
| LOE | Level of effort (hours) |
| SOW | Statement of work |
| SKU | Microsoft license product ID |
| DLP | Data loss prevention (Microsoft Purview) |
| GCC / GCC High | Microsoft 365 US Government Community Cloud tiers (GCC High for CUI/ITAR) |
| ITAR | International Traffic in Arms Regulations |
| SSP / POA&M / IR | System Security Plan / Plan of Action and Milestones / Incident Response |
| DOCX | Microsoft Word document format |
| cesId | Per-baseline artifact ID that ties all artifacts of one engagement together |
| ces-spine / ces-shared | Vendored scoring library (SPRS, posture) / shared contracts package (Zod schemas) |
| Vendor (verb) | Copy Planner source into `src/vendored/` with hash pins in `vendor-manifest.json` |
| CA | Conditional Access (Entra ID) |
| AD | Active Directory |
| BYOD | Bring your own device |
| VM | Virtual machine (Azure) |
| RLS | PostgreSQL row-level security |
| BYPASSRLS | PostgreSQL role attribute that skips row-level security |
| SPA | Muster's React web app |
| e2e | End-to-end test |
| sim / stacksim | The local tenant simulator (tenant-stacksim) |
| Class A | `auto_detected` fact provenance, the highest precedence in `factRouter.ts` |
| M-14 | Muster capability "derive answers from archetypes", currently a fixture stub |
| Golden | Planner's output for a fixture customer, committed as the expected result |
| Fixtures (a)–(d) | The scrubbed fixture customers defined in MG-04 |
| Question register | The MG-28 list of every question Muster asks, the output field it feeds and why it can't be derived |
| Register-justified | Every question the item leaves asked has a register row (see section 3) |
| Reference customer (withheld) | The real customer behind earlier parity checks; its data is not in the repos |
| BHD / BHD input | The company that owns CES / content or a resource BHD supplies |
| P0–P3 | Priority bands, defined at the top of section 3 |
