# Muster — Feature State Inventory (2026-07-10)

Snapshot of every user-facing/product feature and its implementation state, grounded in the
tree on branch `g-muster-p1`. Goals: **P0** (2026-07-05), **P1**/**P2** (2026-07-07),
**GO-1** (2026-07-10, complete), **GO-2** (written 2026-07-10, **not yet executed**).
**All 2026-07-10 work (GO-1 + this doc's surroundings) is uncommitted** under the standing
commit hold; earlier phases are committed through `cb368fd`/`28911a3`.

**States:** SHIPPED (implemented + tested) · SHIPPED-WS (walking skeleton — works end-to-end
on fixtures/canned data) · PARTIAL · DESIGNED-NOT-BUILT · DEFERRED/BLOCKED.

**Test board (GO-1 final verification, 2026-07-10):** web Vitest **226 tests** green
(33 test files under `src/`), api **250 passed / 3 env-skips** (20 files, `muster-api/tests/`),
e2e **9/9** (8 specs, `e2e/*.spec.ts`), drift check **32/32**, build + lint exit 0.

## Engagement flow tabs (shell & navigation)

| Feature | What it does | Where | Goal | State |
|---|---|---|---|---|
| GO Flow shell rail | 5-tab outer rail: Help / Situation / Discovery / Readiness via `nav-tab-*` | `src/features/app/ShellNav.tsx`, `e2e/five-tabs.spec.ts` | GO-1 M1 | SHIPPED |
| MusterNav header | Quick Session / Contracts / kind-gated Rollup buttons + theme toggle | `src/features/app/App.tsx` (MusterNav, ThemeToggle) | P0 | SHIPPED |
| Engagement-kind intake | Declares prime_and_subs vs individual_contractor; immutable; IC hides roster/rollup | `src/features/intake/engagementService.ts`, `AssessmentPage.tsx` | P0 | SHIPPED |
| Scope-lite intake | Scoping questions incl. on-prem/OT (feeds Approach-C gate) | `src/features/assessment/AssessmentPage.tsx` | P0 | SHIPPED |
| Session resume | In-progress Dexie session resumed on boot, mid-interview | `App.tsx` checkResume, `e2e/resume-mid-interview.spec.ts` | P0/P1 | SHIPPED |
| Quick Session | Lightweight field-session capture form | `src/features/quick/QuickSession.tsx` | P0 | SHIPPED |
| Help tab | Static discovery-first orientation copy | `App.tsx` help view | GO-1 | SHIPPED |

## Interview & adaptive answering

| Feature | What it does | Where | Goal | State |
|---|---|---|---|---|
| Static QuestionGraph interview | Tile-pruned interview; "I'm not sure" → unknown | `src/features/interview/questionGraph*.ts` | P0 | SHIPPED |
| Adaptive interview (Claude API) | AI question adaptation, structured outputs, provenance/confidence badges, degraded-503 seam | `muster-api/src/services/adaptiveInterviewService.ts`, routes `interview.ts`; badges in `AssessmentPage.tsx` | P1 | SHIPPED |
| Offline fallback + resync | 3 failures/offline → static graph + Dexie queue; resync retro-confidence, HIL before score release | P1 engine + `muster-api/tests/resync.contract.test.ts` | P1 | SHIPPED |
| Coach panel | Advisor guidance panel alongside the interview | `src/features/coach/CoachPanel.tsx`, api `coachService.ts` | P1 | SHIPPED |
| Harvest prefill in interview | Graph/OAuth-harvested facts prefill answers with `auto_detected` provenance (localStorage staging) | `assessmentHelpers.ts`, `harvestPrefill.test.ts` | P1 | SHIPPED-WS — mock-tenant only; GCC High endpoints `[validate with BHD]` |
| Fact-coverage pruning | External facts prune the SAME graph via `loadQuestionGraph(stacks, facts?)`; operator's own in-flight answers excluded | `src/features/interview/factCoveragePruner.ts`, `discoveryFactJoin.ts` | GO-1 M4/M5 | SHIPPED |
| Zero-network SPA guardrail | SPA interview surfaces make no network calls | `src/features/interview/__tests__/noNetworkCalls.test.ts` | P0/GO-1 | SHIPPED |

## Discovery

| Feature | What it does | Where | Goal | State |
|---|---|---|---|---|
| Discovery offer | Pros/cons + Run/Skip; computed figures (41.6%/87.3%/150/37) drift-guarded verbatim | `src/features/discovery/DiscoveryOffer.tsx`, `discoveryOfferCopy.ts` | GO-1 M2 | SHIPPED |
| Discovery run sub-tab | Runs "discovery" and shows results table, Continue → assessment | `DiscoverySubTab.tsx` | GO-1 M3 | SHIPPED-WS — canned `DISCOVERY_RESULTS_FIXTURE` (13 rows, 2 unknown); no live engine exists in ces-muster |
| Discovery→facts synthesis | Fixture rows → session facts; unknown-confidence → `unsure` sentinel (never prunes, never passes); prunes manual interview measurably | `discoveryFactJoin.ts` (`synthesizeFactsFromDiscovery`), `five-tabs.spec.ts` two-context delta | GO-1 M4 (critic rev-2 wiring) | SHIPPED |
| Skip-to-manual parity | Skip path ≡ untouched manual branch (`pruneByCoverage(graph, [])` identity) | `App.tsx` onSkip, `pruneByCoverage.emptyFacts.test.ts` | GO-1 M5 | SHIPPED |
| Live discovery execution | Real tenant sweep replacing the fixture (GO-1 M7 stretch) | — | GO-1→GO-2 | DEFERRED/BLOCKED — sibling discovery engine (ces-stamper/ces-eo) |

## Scoring & readiness

| Feature | What it does | Where | Goal | State |
|---|---|---|---|---|
| Conservative scoring + FCA disclaimer | Vendored `generateReadinessPosture`; unknown never passes | `src/features/scoring/scoringService.ts`, `src/vendored/ces-spine/` | P0 | SHIPPED |
| `deriveActionStatuses` cascade wiring | **Wired into the runtime path** — called from `scoringService.ts:84` (verified 2026-08-07). This row previously read "NOT in the runtime path / wire-up deferred"; that was stale and understated shipped capability. | `src/features/scoring/scoringService.ts:84`, `src/vendored/ces-spine/`, `cascadeParity.test.ts` | P0 | SHIPPED |
| SPRS calculator | Standalone SPRS matching the vendored calculator (fixture −102) | `src/features/scoring/sprsCalc.ts`, api `sprsCalc.ts` + `sprs.parity.test.ts` | P1 | SHIPPED |
| Fact router A > C > B | Provenance precedence, conservative within-class merge, fall-through; only-unknown never passes | `src/features/scoring/factRouter.ts` + 2 test suites | P2 | SHIPPED |
| Readiness tab | Renders `computeSprs` output + results matrix mapped over the `ResultsMatrixArtifact` contract | `src/features/readiness/ReadinessTab.tsx` | GO-1 M6 | SHIPPED-WS — matrix artifact is a commented fixture stand-in, never recomputed |
| FCA guardrail suite | unknown never prunes / never passes across AI, harvest, SPRS, discovery paths | `fcaGuardrails.test.ts` + per-path tests | P0–GO-1 | SHIPPED |

## Export & rollup

| Feature | What it does | Where | Goal | State |
|---|---|---|---|---|
| StatusPayload JSON export | AJV-validated export with timing segments + on-prem/OT answer | `src/features/export/statusPayloadService.ts`, `exportPipeline.ts` | P0 | SHIPPED |
| Evidence package export | Self-contained package; manifest schema REQUIRES embedded FCA disclaimer; validate-or-throw before download | `src/features/export/evidencePackageService.ts` | P2 | SHIPPED |
| Static rollup RAG board | Prime-and-subs RAG board + pending-subs CSV export | `src/features/rollup/StaticRollup.tsx` | P0 | SHIPPED |
| Roster CSV import + Contract type | 14-field Contract, malformed-roster handling | `src/features/rollup/rosterImport.ts`, `e2e/malformed-roster.spec.ts` | P0 | SHIPPED |
| Contracts page (UI + CRUD) | Contract CRUD for both kinds; kind immutability; IC flow | `src/features/contracts/`, api `contracts.ts` + `contractsService.ts` | P1 | SHIPPED |
| Session timing | Timer bar + timing segments instrumentation | `src/features/timer/` | P0 | SHIPPED |

## Backend (muster-api)

| Feature | What it does | Where | Goal | State |
|---|---|---|---|---|
| Auth: JWT + RBAC | Role matrix, one test per role | routes `auth.ts`; `rbac.matrix.test.ts`, `jwt.test.ts` | P1 | SHIPPED |
| Multi-tenant Postgres + RLS | 10 Prisma models (Tenant…TouchEvent); fail-closed RLS, tenant-scoped pipeline, seed | `muster-api/prisma/schema.prisma`, `rls.test.ts`, `tenantKeysService.ts` | P1 + T8 (`cb368fd`) | SHIPPED — live RLS test env-gated on DATABASE_URL (skips w/o live PG) |
| Engagement/party/session APIs | Core CRUD + lifecycle | routes `engagements.ts`, `parties.ts`, `sessions.ts`; `lifecycleService.ts` | P1 | SHIPPED |
| HIL queue + threshold routing | low-conf + weight-3 routes; low+w2 does not; sub-flag always | routes `hil.ts`, `hilService.ts`, `hil.threshold.test.ts` | P1 | SHIPPED |
| Graph/OAuth harvest | Tenant harvest → prefill facts, auto-detected provenance | routes `harvest.ts`, `harvestService.ts` | P1 | SHIPPED-WS — mock-tenant integration tests only |
| Nudges + progress | T+3/7/14 nudges, stall detection, digest, EngagementProgress | `nudgeService.ts`, `progressService.ts`, `nudge.engine.test.ts` | P1 | SHIPPED — simulated clock |
| Signed recipes → ConfigFacts | ≥3 sha256-signed recipes, tamper rejection, read-only token lint, provenance-captured ingestion | `recipeIngestService.ts`, `recipes/`, `schemas/config-fact.schema.json` | P2 | SHIPPED — structural validator in place of ajv (logged deviation) |
| Recipes self-serve mode | Snippet self-serve behind `RECIPES_SELF_SERVE` flag | `recipes.ts` x-concierge-session gate | P2 | DEFERRED/BLOCKED — flag OFF pending concierge validation sessions (field obligation) |
| Reassessment + drift alerts | Cadence scheduler flips `reassessment_due`; drift alert on contradiction | `reassessmentService.ts`, `driftService.ts` | P2 | SHIPPED — simulated clock |
| Touch instrumentation | Mode-a/c touch events, HIL resolve timing, `/api/touch/report` | `touchService.ts`, routes `touch.ts` | P1/P2 | SHIPPED |

## Cross-cutting guardrails

| Feature | What it does | Where | Goal | State |
|---|---|---|---|---|
| Vendored spine + drift check | 19-file hash-manifested vendored ces-spine; CI drift check 32/32; characterization parity | `src/vendored/ces-spine/`, `npm run check:drift` | P0 | SHIPPED |
| e2e regression board | 8 Playwright specs (9 tests) covering both kinds, resume, export, FCA display, malformed roster, five tabs | `e2e/*.spec.ts` | P0–GO-1 | SHIPPED |

## GO-2 "The Answer Engine" — designed today, NOT yet executed (`docs/goals/G-MUSTER-GO-2.md`)

| Feature | What it will do | Rung | State |
|---|---|---|---|
| M1 Infer + confirm | Boundary draft from GO-1's discovery fixture; confirm/correct UI; `discovery-inferred, unattested` provenance | 1 | DESIGNED-NOT-BUILT |
| M2 Archetype selection | Fixture archetype set prefills `archetype-default` fields, individually overridable | 3 (mechanism) | DESIGNED-NOT-BUILT |
| M3 Import-file / script-upload | Upload path ≡ fixture path into the same fact store (auth-ladder tier 2) | feeds 1 | DESIGNED-NOT-BUILT |
| M4 Draft rendering + attestation | Drafts render as drafts everywhere incl. readiness math; "drafted by X, confirmed by [name] on [date]" | cross-cutting | DESIGNED-NOT-BUILT |
| M5 Never-passes draft guardrail | Drafts prune but never count as met; drafts-only session scores ≡ facts-absent | cross-cutting | DESIGNED-NOT-BUILT |
| M6 Interview-parsing fixture (stretch) | Canned transcript → `interview-extracted` facts in the M4 UI | 4 | DESIGNED-NOT-BUILT — explicitly deferrable |
| Rung 5 VOI ranker | Ask only what changes the plan | 5 | DEFERRED/BLOCKED — plan generator (sibling, ces-eo/ces-planner) does not exist |
| Live extraction / AI parsing | Real rung-2/rung-4 engines | 2, 4 | DEFERRED/BLOCKED — gov-cloud-safe engine choice (Q2), sibling dependency |
| Auth-ladder tiers 1/3/4 + archetype content | Device-code, Secure-Score-lite, cert app-only; the real 4–6 archetypes | — | DEFERRED/BLOCKED — non-goals; content founder-blocked (Q3) |

## Today's delta (2026-07-10)

GO-1 executed and completed (founder HIL approval): 5-tab GO Flow shell, Discovery
offer/sub-tab on canned fixture, discovery→fact synthesis production-wired (critic rev-2
fix), fact-coverage pruning at the graph seam, Readiness tab, e2e `five-tabs.spec.ts`
(board: web 226 / api 250 / e2e 9/9 / drift 32/32). Successor goal G-MUSTER-GO-2 written
(`docs/goals/G-MUSTER-GO-2.md`), including the resolver-chain provenance mapping onto the
existing A>C>B router. All of it uncommitted under the standing commit hold.

**Next up:** execute G-MUSTER-GO-2 M1–M5 (M6 stretch) — awaiting pipeline execution.
