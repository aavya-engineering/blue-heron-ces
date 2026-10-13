# Muster — Tenant Readiness Mechanisms (survey)

**Surveyed repo:** sibling `ces-muster` (read-only), branch `g-muster-p1`, commit
`0685ad4 "mu discovery: anchor sibling-root defaults to module location (cwd-independence, part 2)"`.
Survey date 2026-09-02. All file paths below are repo-relative under `ces-muster/`.

**Scope:** every major way Muster currently attempts to determine TENANT READINESS —
i.e., any mechanism that assesses whether/how ready a customer tenant is for CMMC.
Muster is two halves: a zero-network SPA (`src/`) and a Node API platform
(`muster-api/`); readiness evidence flows from four acquisition lanes (discovery
walk, harvest probes, recipe capture, human interview) through one provenance/fact
model into two scoring calculators, and out as artifacts other CES tools consume.

## Legend (coined shorthand used below)

| Term | Meaning |
|---|---|
| RR | Readiness Review — Muster's interview/question-bank flow |
| SPRS | Supplier Performance Risk System score (DoD 110-point NIST 800-171 methodology) |
| FCA | "Fail-Conservative Assessment" discipline used throughout the repo: unknown/absent evidence never counts as a pass |
| HIL | Human-In-the-Loop escalation queue (advisor review) |
| A / C / B | Provenance classes in the fact router: A = `auto_detected` (machine-harvested), C = `captured` (recipe point-in-time evidence), B = everything else (interview answers). Precedence A > C > B |
| Rungs 1–4 | The "residual elicitation ladder" of draft resolvers: 1 = discovery-inferred, 2 = document/script-extracted, 3 = archetype defaults, 4 = interview-extracted |
| DISCOVERY-1, GO-2, PLAN-2, READINESS-1 | Internal goal codes stamped in file headers (G-MUSTER-…) identifying which project milestone built each module |
| CUI | Controlled Unclassified Information |
| RAG | Red/Amber/Green status color |
| SIT / SI Baseline | Situation answers / Situation-Informed Baseline artifact (ces-planner shape) |
| stacksim | The sibling `tenant-stacksim` simulated M365/Azure tenant used by `--sim` runs |
| Stamper registry | ces-stamper's CMMC command registries (`get_command`/`set_command` per control) read as data |

---

## 1. Live tenant discovery walk — `mu discovery --sim` (DISCOVERY-1 executor)

**What it is.** Muster's flagship machine assessment: a structurally read-only walk
of the Stamper command registries against a live (currently sim-only) tenant,
emitting per-control posture observations and a schema-validated
`readiness-result.v1` envelope. This is the lane ces-tester's eval harness drives
(`ces-tester/src/demo/eval-run.ts` spawns `mu discovery --sim --slug … --out …`).

**How it works.**
- CLI entry: `muster-api/src/cli/discoveryCli.ts` (`runDiscoveryCli`). Refuses to
  run without `--sim` (lines 119–125, "FD-LIVE-SMOKE safety, non-negotiable") —
  today there is no live-tenant discovery CLI path.
- Prereq probes: `liveSimSession.ts` `ledgerReachable()` (POST `/ledger` on
  `http://127.0.0.1:4390`) — the CLI never boots/seeds the sim, it fails loud if
  absent (discoveryCli.ts:130–138). Registry entries must load
  (`discoveryWiring.loadRegistryGetEntries`, from sibling
  `ces-stamper/src/registry/*.registry.json`, env-overridable via
  `STAMPER_REGISTRY_ROOT`) or the run aborts (lines 140–146).
- Engine: `muster-api/src/services/discoveryService.ts` `runDiscovery()` — walks
  each registry entry, executes only `get_command` (there is *no* set_command code
  path in the module), one observation per covered `control_id`.
- Posture derivation rules (discoveryService.ts:121–193):
  - `manual_only` or no `get_command` → posture `unknown`, recorded not omitted;
  - exit 0 + non-empty stdout → posture `met`, confidence `high`, raw stdout
    persisted via a CaptureSink and referenced by `raw_capture_ref` (never inlined);
  - exit 0 + empty output → `unknown`, confidence `low` ("read succeeded, nothing there");
  - error or auth-shaped failure (`isDegradation`, lines 111–118: cmdlet-not-
    recognized / unauthorized / not-connected regexes) → per-command degradation,
    status literal `"unavailable at this auth tier"`, posture `unknown`. The walk
    never throws.
- Session: `muster-api/src/services/liveSimSession.ts` — per-command
  `powershell.exe` spawn with PSModulePath stripped to the sim's `psmodules` only
  and `Connect-MgGraph` shimmed, so the walk can never reach real Graph.
- Safety gate: after the walk the CLI re-queries the sim ledger and asserts ZERO
  create/mutate entries occurred (discoveryCli.ts:156–164) — a write during
  "read-only" discovery fails the run.
- Envelope: `muster-api/src/services/discoveryEnvelope.ts`
  `buildDiscoveryReadinessResult()` — aggregates duplicate control rows
  worst-posture-wins (lines 42–53), runs the real SPRS calculator over them,
  emits `derived.sprs_now` / `gaps[]` (all conservatively `fixable: 'manual'`) /
  `sprs_after`, stamps provenance (registry versions, engine, coverage dataset),
  and Ajv-validates against `public/schemas/readiness-result.schema.json` before
  writing the file.

**What "ready" means to it.** Per control: observable evidence exists on the
tenant right now (`met`) vs. nothing observable (`unknown`) — the executor never
emits `not_met` itself (that rank exists but no rule assigns it); readiness is
then summarized as the SPRS score computed from those postures.

**Limits / blind spots.** Evidence-presence heuristic: *any* non-empty stdout is
`met`/high — it does not parse output to check the setting is actually compliant.
Sim-only by CLI policy. Controls with no `get_command` are permanently `unknown`
here. `objective_ids` are left empty (control-level, not objective-level).

## 2. Self-serve discovery imports — collector kit, results file, readiness-result payload

**What it is.** Rung-2 of the elicitation ladder: when CES has no tenant access,
a customer admin runs a signed read-only script themselves and uploads the output;
the SPA also accepts a full `readiness-result.v1` payload or its canned demo
fixture. All three land on ONE import seam — no second format.

**How it works.**
- Kit generator: `muster-api/src/services/collectorKitService.ts` — generates a
  signed (sha256 manifest, `lib/recipeSigning.ts`), human-readable PowerShell
  collector from the same `RegistryGetEntry` shape (a type with no `set_command`
  field, so a mutating command "cannot even reach the emitter"). Confidence rule
  identical to the executor: output ⇒ high, empty ⇒ low, error ⇒ unknown.
- Bare results file: `src/features/discovery/importResultsFile.ts`
  `parseDiscoveryResultsFile()` — accepts `DiscoveryResult[]` or
  `{ results: [...] }`; malformed uploads fail loudly, never partially ingest.
- Full payload: `src/features/discovery/importReadinessResult.ts` — Ajv-validates
  `readiness-result/1.0.0`, reduces `observations[]` to the same
  `DiscoveryResult` shape, and stages `facts[]` (with attestations preserved)
  last so a payload fact wins prefill over a synthesized row.
- Fixture path: `src/features/discovery/DiscoverySubTab.tsx` renders the canned
  `DISCOVERY_RESULTS_FIXTURE` (zero network) and hands off to the boundary
  confirm step.
- Downstream, all of them ride `synthesizeFactsFromDiscovery`
  (`src/features/interview/discoveryFactJoin.ts`): each discovery row joins to
  question-graph nodes by `mapped_requirements === control_id` and becomes an
  `auto_detected` InterviewFact — answer `yes` for non-unknown confidence,
  answer `unsure` for unknown confidence (so an unknown row can never score met).
  Boundary-cluster questions are explicitly excluded from this join (machine may
  never assert CUI-boundary intent, discoveryFactJoin.ts:32–39).

**What "ready" means to it.** Same evidence-presence semantics as mechanism 1,
but attested by the customer's own admin session instead of a CES-held session.

**Limits / blind spots.** Trusts the uploaded file's content (signature covers
the script CES shipped, not the results file it produced). Same
evidence-presence-not-compliance heuristic. Confidence collapses to the
script's three-way rule.

## 3. Microsoft Graph harvest probes (OAuth lane)

**What it is.** muster-api's direct Graph API probe table: a small set of live
checks against a real tenant via delegated OAuth consent, producing high-
confidence `auto_detected` facts for specific interview questions.

**How it works.**
- `muster-api/src/services/harvestService.ts` — three probes (lines 69–132):
  `/identity/conditionalAccess/policies` → iam-001 (MFA) + iam-004 (remote
  access): `yes` iff an enabled CA policy grants `mfa`; `/deviceManagement/managedDevices`
  → ep-001 (MDM): `yes` iff ≥1 enrolled device; `/deviceManagement/deviceCompliancePolicies`
  → ep-002 (endpoint protection): `yes` iff ≥1 policy.
- FCA guardrails in the header and `runHarvest()` (lines 146–169): a failed probe
  yields NO fact (absence, not `no`); absence never scores as pass. Documented
  not-probeable questions (mon-004 Sentinel — ARM not Graph; dp-002 TLS) must be
  self-reported.
- Routes: `muster-api/src/routes/harvest.ts` — consent-url / callback / run;
  tenant credentials resolve via `tenantKeysService` through the sibling
  `ces-tenant` package (the ONLY tenant surface per `TENANT-CONNECTION.md`:
  "the Muster SPA never touches a tenant; muster-api reaches tenants only
  through ces-tenant"). Missing GRAPH_* env → 503 `{degraded:true}`.
- SPA consumption: `src/features/assessment/assessmentHelpers.ts` reads
  `muster-harvest-facts` from localStorage and prefills answers with provenance
  `auto_detected` (class A).

**What "ready" means to it.** A handful of key controls verified live: MFA
enforced, MDM enrolled, compliance policies exist — binary yes/no with high
confidence.

**Limits / blind spots.** Only 3 probes / 4 question ids today — tiny coverage.
Threshold heuristics ("≥1 device enrolled" ⇒ yes for *all* devices). A probed
negative *is* recorded as `no` (unlike discovery, this lane can produce
fail evidence).

## 4. Recipe capture lane (ConfigFacts, provenance class C)

**What it is.** Point-in-time evidence ingestion: signed "CaptureRecipes" run
outside Muster produce output that muster-api verifies and converts into
`captured`-provenance ConfigFacts.

**How it works.**
- `muster-api/src/services/recipeIngestService.ts` — signature verification
  (sha256 via `lib/recipeSigning.ts`) ALWAYS runs first; a tampered recipe
  yields zero facts. Emission rules (header, lines 1–14): section absent →
  NO fact (absence, not `no`); probed-negative → `no`; probed-positive → `yes`;
  unknown/unsure is forbidden as a ConfigFact answer. Facts are structurally
  validated against `muster-api/schemas/config-fact.schema.json` (closed
  object: exactly six keys).
- Facts carry `provenance: 'captured'`, `confidence: 'high'`,
  `source: 'recipe:<name>@<version>'` — class C in the fact router, ranked
  below live machine evidence (A) but above interview answers (B).
- Routes: `muster-api/src/routes/recipes.ts`; re-ingestion of the same recipe
  later is one of the two triggers for drift detection (mechanism 10).

**What "ready" means to it.** The captured configuration evidenced the control
at capture time — a documentary snapshot, deliberately outranked by fresher
machine-harvested state.

**Limits / blind spots.** Point-in-time only (goes stale); depends on recipe
coverage; binary yes/no per question.

## 5. RR interview — question graph, pruning, adaptive sequencing

**What it is.** The human lane: a static ~28-node CMMC question bank asked of
the customer, with stack-based filtering, coverage-based pruning (don't ask what
machines already answered), and optional Claude-powered adaptive question
ordering.

**How it works.**
- Bank: `src/features/interview/questionGraph.ts` — static TS constant (no YAML,
  no network; DW#5 CI asserts zero API calls during an interview run). 25
  cluster questions (identity / endpoint / policy / monitoring / data-protection
  / incident-response) + 3 CUI-boundary questions, each with
  `mapped_requirements` (CMMC control ids) and optional `applicable_stacks`.
- Stack filter: `src/features/interview/questionGraphService.ts`
  `loadQuestionGraph(declaredStacks, facts?)` — questions gated on stacks
  (e.g. `microsoft_intune`, `microsoft_sentinel`) are only asked when declared;
  the Situation tab's on_prem_ot answer folds into the same dimension.
- Pruning: `src/features/interview/factCoveragePruner.ts` `pruneByCoverage()` —
  a question is skipped iff a non-`unknown`-confidence fact covers it;
  confidence-tiered (only the highest-ranked facts govern); FCA clause: an
  `unknown` fact NEVER prunes its question.
- Adaptive mode: `muster-api/src/services/adaptiveInterviewService.ts` — Claude
  (`claude-opus-4-8` default) picks the next most informative question from the
  remaining bank given prior facts + stacks; it may ONLY select ids from the
  provided bank (validated, falls back to first remaining). It "NEVER converts
  an 'unknown'/'unsure' answer into a pass and NEVER scores readiness" (header).
  `retroConfidence()` assigns confidence+weight to offline-resynced answers;
  degraded (no API key / SDK error) defaults to `low`+3 — exactly the HIL
  routing threshold, so every degraded fact gets human review.
- Degradation: `src/features/assessment/adaptiveEngine.ts` — three consecutive
  failures or browser-offline flips the session permanently to the static graph;
  answers queue in Dexie and `canFinish()` blocks finishing with unsynced
  answers.

**What "ready" means to it.** The customer attests yes/no per question; `yes`
maps toward `met` on the question's `mapped_requirements`, `no` to not_met,
unsure/unknown to unknown (see mechanism 8's `requirementStatuses`).

**Limits / blind spots.** Self-reported. Coverage is 28 questions over a subset
of the 110 controls. No OT/on-prem-specific questions exist yet (documented
no-op in questionGraph.ts:6–28).

## 6. Draft resolvers + provenance/attestation model (boundary inference, archetype priors, fact routing)

**What it is.** The trust architecture that decides which evidence counts: four
draft "rungs" that pre-fill answers without letting machines or priors score,
plus the A>C>B fact router that merges mixed-provenance facts conservatively.

**How it works.**
- Boundary inference (rung 1): `src/features/interview/boundaryInference.ts` —
  auditable one-line rules infer the CUI boundary from discovery footprints
  (e.g. AC./IA. rows ⇒ "CUI-handling users identified"), drafting `yes` answers
  to bnd-001..003 with provenance `discovery-inferred`, confidence = weakest
  contributing evidence, NO attestation. Unknown-confidence rows never draft.
- Confirm/correct: `src/features/discovery/boundaryConfirm.ts` — leave (stays a
  draft), confirm (named-human attestation via `confirmFact`), or correct
  (becomes an ordinary `operator_interview` fact). Blank names are rejected at
  the pure layer.
- Archetype priors (rung 3): `src/features/assessment/archetypePrefill.ts` —
  archetype defaults fill unanswered questions as `archetype-default` drafts,
  confidence `low`; existing answers always win.
- Draft semantics: `src/features/scoring/draftSemantics.ts` — the two pinned
  invariants: (1) drafts PRUNE but NEVER PASS — `scorableFacts()` excludes
  unconfirmed drafts before any scoring, so a drafts-only session scores
  identically to a facts-absent one; (2) unknown never prunes, never passes.
  `confirmFact()` is the single choke point requiring a non-blank human name.
- Fact router: `src/features/scoring/factRouter.ts` — groups facts by
  question_id; winner drawn from the highest provenance class present
  (A `auto_detected` > C `captured` > B interview); within class, most
  conservative answer wins (`no` > `unknown`/`unsure` > `yes`), then recency.
  Attestation upgrades a draft's class (`discovery-inferred` → A,
  `document-extracted` → C, lines 64–77).

**What "ready" means to it.** Nothing directly — this mechanism decides *whose
claim of readiness is believed* when machine, document, and human disagree.

**Limits / blind spots.** A `yes` from live machine evidence outranks a human's
`no` from interview (A beats B by class before conservatism applies — flagged
`[validate with BHD]` in factRouter.ts:14–15). Boundary rules are coarse prefix
heuristics.

## 7. Scoring path 1 — vendored cascade → Readiness Posture → conservative %

**What it is.** The SPA's production scoring pipeline: interview facts + stack
declarations run through the vendored ces-planner/spine derivation cascade to a
full ReadinessPosture artifact and a conservative percentage score.

**How it works.**
- `src/features/scoring/scoringService.ts` `scoreFacts()`: (1) `scorableFacts`
  strips unconfirmed drafts; (2) `preambleMapper.ts` maps stacks+facts →
  PreambleAnswers and a minimal SI Baseline (Phase-0 assumptions hardcoded: CUI
  present, L2 target, cloud_only vs hybrid inferred from `on_prem_ad`);
  (3) vendored `deriveActionStatuses` 6-step cascade + `convertToRRTAnswers`
  (`src/vendored/ces-spine/services/bulkAnswerDerivation.ts`) derive statuses
  from the stack/license profile; (4) interview answers override cascade answers
  per action id; (5) vendored `generateReadinessPosture`
  (`src/vendored/ces-spine/services/postureGenerator.ts`) emits the posture with
  `control_status_summary` {met, partial, not_met, unknown}.
- `computeConservativeScore()` (scoringService.ts:29–34) = round(met / total ×
  100) — unknown counts against, never for.

**What "ready" means to it.** Percentage of assessed controls fully met, where
anything not fully met (partial/unknown/not_met) counts as not ready.

**Limits / blind spots.** Phase-0 baseline assumptions are hardcoded (always
"has_cui", always L2). The cascade derives from declared stacks/licenses — a
declared-but-misconfigured stack can seed optimistic action statuses (though
interview answers override).

## 8. Scoring path 2 — SPRS calculator (+ gaps, fix paths, projections)

**What it is.** The DoD-methodology score: 110-point SPRS with per-control
weights, computed identically in the SPA and muster-api from ONE vendored weight
table, plus the gap/fix-path/projection layer around it.

**How it works.**
- Calculators: `src/features/scoring/sprsCalc.ts` (SPA) and
  `muster-api/src/services/sprsCalc.ts` — both consume vendored
  `ces-shared/data/sprs-weights.json` (sprs-weights/2.0.0); a cross-copy parity
  test holds by construction. Start 110, subtract full weight for every
  requirement whose status ≠ `met` (FCA: partial and unknown deduct fully),
  floor −203. Also exposed as `POST /sprs/score`
  (`muster-api/src/routes/sprs.ts`) and `mu sprs` CLI.
- Requirement aggregation: `src/features/export/readinessResultService.ts`
  `requirementStatuses()` (lines 50–68) — routed scorable facts map to
  requirements: met only when every contributing answer is `yes`; any `no` ⇒
  not_met sticks; anything else ⇒ unknown ("most conservative sticks").
- Gaps + fix paths: `src/features/export/registryFixPaths.ts` — static extract
  of Stamper registry `set_command`s per control ("the registry set_command IS
  the fix path"); gaps with fix entries are `fixable: 'registry'`.
- Projection: `sprs_after` = the SAME calculator re-run with registry-fixable
  gaps flipped to met — an explicitly labeled projection of "score if Stamper
  ran its fixes".
- Documentary residuals: `src/features/export/residualMustHave.ts` — per-control
  lists of documents/attestations no command can produce (EMX archetype names),
  for the customer collect-list.

**What "ready" means to it.** The number a defense contractor actually reports:
SPRS 110 = fully ready; each unmet/unknown control deducts its DoD weight.

**Limits / blind spots.** Only assessed requirements count (`assessed_count`);
requirements never touched by any fact don't deduct — a sparse assessment can
look better than a thorough one. Weights/fix-path extracts are static snapshots
that must be regenerated when the upstream registry/dataset versions bump.

## 9. Readiness result export & report (the readiness verdict artifact)

**What it is.** The `readiness-result.v1` builder — the single artifact that
packages manifest + observations + facts + SPRS into Muster's exportable verdict,
rendered on-screen by the Readiness tab and consumed downstream by plan mode and
ces-tester.

**How it works.**
- `src/features/export/readinessResultService.ts` `buildReadinessResult()`:
  hard precondition — the session must carry the Situation-tab
  `readiness_manifest` capture (mode, auth tier, operator, tenant; enum'd in
  `src/shared/types/engagement.ts:77–78` — mode
  self-hosted/independent/collaborative-bhd; auth_tier
  device-code/script-upload/lite/cert-app-only). No manifest ⇒ throw
  (lines 112–117): you cannot claim readiness without declaring how you assessed.
- Observations seam (lines 80–104): prefer the discovery executor's real rows
  (`session.discovery_observations`), else synthesize from thin
  `discovery_results` (fixture/file sessions) with unknown-confidence ⇒ posture
  unknown.
- FCA invariants in the header: `sprs_now` counts ONLY attested/observed
  non-draft facts; `facts[]` is the transparency surface carrying every fact
  INCLUDING drafts with provenance and attestation records; the payload is
  Ajv-validated against `public/schemas/readiness-result.schema.json` before it
  may download.
- Render: `src/features/readiness/ReadinessTab.tsx` — same build path as the
  download "so screen and file can never disagree"; SPRS via the one
  `computeSprs`.

**What "ready" means to it.** The complete, schema-valid verdict: who assessed,
what was observed, what was answered, SPRS now, gaps with fix paths, SPRS after.

**Limits / blind spots.** Only as good as its inputs; manifest fields are
operator-declared.

## 10. Plan-mode adapters — readiness posture as the gate to plans/manifests

**What it is.** PLAN-2: Muster turns its readiness posture into ces-planner
artifacts (SI Baseline, Tenant Manifest, Infrastructure Manifest, Manual Mission
Plan) via the vendored, unforked Planner compiler chain — readiness here is the
*input precondition* for planning remediation.

**How it works.**
- `src/features/plan/siBaselineAdapter.ts` — maps Muster's Situation answers
  (target level, CUI presence, boundary strategy, deployment posture) onto
  SITAnswers and calls the vendored `generateSIBaseline`; only genuinely known
  fields are asserted, everything else left to generator defaults — "never
  invented".
- `src/features/plan/tenantManifestAdapter.ts` — `bridgePosture()` reduces
  Muster's `requirement_results` {met|partial|not_met|unknown} into the Planner
  ReadinessPosture shape (lines 66–87), then ONE shared compile pass
  (`compilePlan`, lines 112–147): SI Baseline + posture → `compileGapSet` →
  `compileTaskCatalog` → `generateTenantManifest` / `generateManualPlan`.
  Infrastructure Manifest is generated only when an Azure `tenantConfig` is
  supplied (lines 170–172); absent ⇒ null (the common m365_only case).
- Input can also arrive as an imported `readiness-result.v1` payload
  (mechanism 2's `importReadinessResult.ts`).

**What "ready" means to it.** Inverted: everything NOT met becomes a gap, gaps
become tasks, tasks become the mission plan ces-tester drives Stamper with —
readiness determines how much work the plan contains.

**Limits / blind spots.** Posture bridge carries only requirement statuses (no
evidence refs); plan quality inherits every upstream blind spot.

## 11. Continuous readiness — drift, reassessment cadence, HIL, lifecycle & rollup

**What it is.** Readiness over time and across parties: machine-evidence drift
alerts, an annual reassessment ticker, the human escalation queue, per-party
lifecycle states, and the prime's multi-sub RAG rollup.

**How it works.**
- Drift: `muster-api/src/services/driftService.ts` — compares previous vs
  current facts, machine provenance only (`auto_detected`/`captured`, line 24);
  `yes`→`no` is an ALERT routed to the HIL queue (confidence low, weight 3 —
  the exact routing rule) + a touch event; `no`→`yes` is a logged improvement,
  no alert. Interview-answer changes are NOT drift.
- Reassessment: `muster-api/src/services/reassessmentService.ts` — parties in
  states complete/ready/validate whose last completed session is older than
  `REASSESS_DAYS` (default 365) flip to `reassessment_due`.
- HIL: `muster-api/src/services/hilService.ts` — routing rule "(confidence ===
  'low' AND weight >= 3) OR sub_flagged" ⇒ advisor queue; low-confidence
  readiness evidence gets human review before score release.
- Lifecycle/progress: `muster-api/src/services/lifecycleService.ts` (8-state
  PartyLifecycle: invited → in_progress → … → ready → validate →
  convert_to_enclave / reassessment_due) and `progressService.ts` (per-
  engagement state counts; abandoned/opted_out dispositions override display).
- Rollup: `src/features/rollup/StaticRollup.tsx` — imports subs' StatusPayload
  files (schema-validated) and shows RAG per party over
  `posture_summary.conservative_score`: ≥70 green, ≥40 amber, else red;
  CSV export. `src/features/export/statusPayloadService.ts` defines the payload
  (conservative score + control_status_summary + facts, drafts excluded).

**What "ready" means to it.** Readiness is a state that decays: still-ready =
no failing drift, within cadence, nothing stuck in HIL; and at engagement level,
a green (≥70) conservative score per sub.

**Limits / blind spots.** Drift only sees what harvest/recipes re-measure (3
probes today). RAG thresholds (70/40) are display heuristics over the
conservative %, not SPRS. Cadence flip depends on session records.

## 12. Environment & connectivity prerequisite checks

**What it is.** The cross-cutting "can we even assess?" gates — each lane checks
its own prerequisites and degrades loudly rather than silently.

**How it works.**
- Sim reachability + zero-writes gate: mechanism 1's `ledgerReachable` probe and
  post-walk create/mutate assertion (`discoveryCli.ts:130–138, 156–164`);
  `liveSimSession.simAvailable()` gates on Windows + a real sibling
  `tenant-stacksim` checkout with generated psmodules.
- Registry availability: discovery aborts when zero Stamper get-entries load
  (`discoveryCli.ts:140–146`); `discoveryWiring.ts` resolves the sibling
  `ces-stamper` checkout (env-overridable).
- Graph configuration: harvest routes return 503 `{degraded:true}` when GRAPH_*
  env is unset; tenant credentials resolve only through ces-tenant
  (`tenantKeysService.ts`, `TENANT-CONNECTION.md` — the SPA never touches a
  tenant, muster-api only via ces-tenant; hand-rolled credential resolution is
  banned repo-wide).
- AI availability: adaptive interview throws `{degraded:true, 503}` with no
  Claude key and the SPA permanently falls back to the static graph
  (mechanism 5); degraded retro-confidence routes everything to HIL.
- Per-command auth-tier degradation: discovery records
  `"unavailable at this auth tier"` per command rather than failing the walk —
  the auth tier itself (manifest `auth_tier`, ladder: device-code /
  script-upload / lite / cert-app-only) determines how much of the tenant is
  assessable at all.

**What "ready" means to it.** Whether the assessment machinery can reach the
tenant at the declared auth tier — a meta-readiness that bounds every other
mechanism's coverage.

**Limits / blind spots.** Degradation produces `unknown`s, and unknowns deduct
in SPRS — a connectivity problem is indistinguishable from a compliance gap in
the final score (deliberately conservative, but worth knowing).
