# PLANNER_V2_PLAN — Planner v2 / Supply-Chain Readiness Evaluation

**Date:** 2026-07-05 · **Goal:** G-PLANNER-2 (`ces-planner/docs/_goal-planner-v2.md`)
**Status:** APPROVED — brutal-critic PASS 7.5/10 (DONE-WHEN #13) and explicit user approval 2026-07-05 (DONE-WHEN #15). G-PLANNER-2 COMPLETE.
**Grounding (read-only):** six SCRE files under `C:/Users/mhsut/DevProjects/scre/`, `ces-planner/` source, `ces-strategy/pricing/PRICING_CONTEXT.md`, `ces-planner/docs/context/VAULT.md`

---

## 1. Architecture decision (DONE-WHEN #1)

**Decision: Option B.** The `ces-planner/` assessment spine (SIT-lite → CUI Boundary → RRT → Readiness Posture) becomes a **vendored library** consumed by a new **`scre-muster/`** repo; the build spine (TCP → MPT → Stamper handoff, policy rendering, cost estimator) **stays in ces-planner unchanged**. "Planner v2" is a **product-line version, not a repo version**: v2 = ces-planner (the unchanged deliverable factory) + Muster (the new readiness-evaluation and engagement surface). This resolves the §5 architecture tension in the goal: `SCRE-Build-Plan.md §1`'s standalone-Muster decision **stands**, and the "v2 as a ces-planner version" framing is satisfied at the product level, not by modifying the ces-planner codebase.

**Plain-language statement for a co-founder:** *We are building a new planner application for the supply-chain readiness work, and keeping — not rewriting — the existing planner for everything it already does. The new app borrows the existing planner's assessment brain as a pinned, copied library, so a readiness score computed in the new app is the same score the old planner would compute. The existing planner keeps producing every deliverable — plans, proposals, manifests, policy documents, TCO reports — exactly as it does today, byte-for-byte in schema and export format. Why not extend the existing planner? Because it was deliberately built offline, single-browser, single-advisor, and the new work needs the opposite: hosted, multi-party, always-on. Bolting a backend onto an offline tool puts every existing deliverable at refactor risk to gain nothing; building the multi-party surface where multi-party is native costs less and risks nothing we already ship.*

**Rationale, grounded in the four required inputs:**

1. **Offline/single-browser constraint (`ces-planner/CLAUDE.md`):** ces-planner is an offline-first SPA — no backend API, IndexedDB persistence, disk save only in dev mode. Modes (a) and (c) below require hosting, auth, and an LLM connection. Option A (extend in place) would force a deployment-model break onto the existing advisor tool and its build spine; Option B confines the break to the new repo and preserves the offline advisor tool intact for the build/Tier-2 use case.
2. **Multi-tenancy gap (`BHD-Planner-as-SCRE.md §5`):** Planner has no production persistence and no multi-user backend, *by deliberate design* — the single biggest lift. Retrofitting multi-tenancy into an SPA architected against it (Option A) is the most expensive way to close that gap; `SCRE-Build-Plan.md` already specifies the backend (Prisma + PostgreSQL + JWT RBAC + Postgres RLS) in a repo designed for it.
3. **Assessment/build spine split (`BHD-Planner-as-SCRE.md §1`):** the documented product boundary is: assessment spine = the SCRE product; build spine = Tier-2-only remediation outputs. Option B aligns the repo boundary with that product boundary. Option C (archive ces-planner, migrate wholesale) would force the entire build spine — which Muster's reuse inventory explicitly excludes ("Do NOT reuse: TCP wizard, MPT/Mission Plan generator, Stamper handoff…") — to migrate for zero user benefit, and puts every preserved deliverable at maximum risk.
4. **Muster Phase-0-not-started status:** nothing is built beyond mockups and the READY FOR IMPLEMENTATION build plan. There is zero sunk code to migrate or reconcile — Option B starts from a fully specified, unencumbered plan. Phase-0-not-started is *not* an argument for Option A: the design work (data model, router, nudge engine, phase gates, risk register) is done and is the single largest de-risking asset this plan inherits.

**Vendoring discipline (from `SCRE-Build-Plan.md §5.4`):** `deriveActionStatuses()`, knowledge banks, schemas, and the StackProvider seam are **vendored copies at a pinned CES commit** with `DERIVATION_VERSION.md` / `KNOWLEDGE_VERSION.md` stamps, a parity checklist, and CI drift monitors. No live imports from `ces/`; ces-planner is never edited by Muster work.

## 2. Persistence / backend strategy (DONE-WHEN #2)

Offline is **not sufficient**: the sub roster, sub status, prime roll-up, nudging, and mode (a) all require multi-party access, which a single-browser IndexedDB store cannot provide (`BHD-Planner-as-SCRE.md §5`).

- **Technology:** Node + Express `muster-api`, **Prisma + PostgreSQL** (party-scoped rows, Postgres RLS keyed to `party_id + tenant_id`), **JWT + RBAC** (roles: prime / sub / bhd_operator / assessor read-only), Azure Blob Storage for evidence artifacts. Deployment: Azure App Service + Static Web Apps + PostgreSQL Flexible Server, US East, encryption at rest.
- **Who builds it:** the BHD/CES engineering team (same team, new repo `scre-muster/`); no third party.
- **Which phase:** **Phase 1** (§6). Phase 0 is deliberately zero-backend (concierge MVP: Dexie session-only, manual StatusPayload JSON export, static roll-up page) so the assessment UX and confidence calibration are proven before the backend investment. Mode (a) and mode (c) are therefore **unavailable in Phase 0** — only mode (b) operates until the backend ships.

## 3. Readiness-evaluation domain model (DONE-WHEN #3, #4, #5)

### 3.1 Session-start intake mechanism — the gate (DONE-WHEN #4)

Engagement kind is determined by a **required intake question in the engagement-setup wizard (U1/U3), persisted as a profile field** `Engagement.engagement_kind: 'prime_and_subs' | 'individual_contractor'`, set at engagement creation and immutable thereafter (a change requires a new engagement). The question, first screen of setup: *"Is this engagement a prime contractor assessing its subcontractor tier, or a single contractor assessing its own readiness?"* All seven readiness functions **branch on this field**:

| Function | `prime_and_subs` | `individual_contractor` |
|---|---|---|
| Engagement kind | set at intake | set at intake |
| Contracts involved | per Prime and per Sub | per the contractor party directly |
| Contract details | full Contract entity (§3.2) | full Contract entity (§3.2) |
| Subs roster | required (U2 import/discovery) | **not rendered** — no roster UI |
| Sub POC | Contact per Sub | single party Contact set |
| Sub status | lifecycle + readiness per Sub (§3.3) | own lifecycle + readiness only |
| Sub management | prime + BHD act on subs (§3.3) | self-management only; no roll-up |

**Individual-Contractor is a first-class flow, not a degenerate cohort of one:** it renders a distinct navigation (no Cohort/Wave, no RollUp, no RiskRegister, no nudge engine), its Engagement holds exactly one assessed party, its result screen is the sub-facing "score + what moves you up" view, and its Contract records attach to the contractor party rather than to a Prime→Sub pair. It reuses the same assessment run and StatusPayload; what differs is the Program layer around it.

### 3.2 Contract entity — net-new (DONE-WHEN #3)

The SCRE domain model (`BHD-SCRE-UseCases-DomainModel.md`) carries `Prime.programs[]` and `TriageResult.value_at_risk` but no Contract node. Define:

```
Contract {
  contract_id        string        // internal
  contract_number    string        // e.g. FA8675-26-C-0031
  award_date         ISO 8601 date
  pop_start          ISO 8601 date // performance period start
  pop_end            ISO 8601 date // performance period end
  party_cage         string        // performing party CAGE
  party_uei          string        // performing party UEI
  dfars_clauses      string[]      // e.g. 252.204-7012 / -7019 / -7020 / -7021
  cui_flowdown       boolean       // does this contract flow CUI down
  status             'pending' | 'active' | 'option_year' | 'expired' | 'closed'
  value_at_risk      number        // USD, feeds RiskRegisterEntry
  prime_ref          string | null // owning Prime (null in individual_contractor)
  sub_ref            string | null // performing Sub (null when the prime itself performs)
  engagement_ref     string
}
```

(14 fields — exceeds the ≥ 6 minimum; the field set is a lean default **[validate with BHD]** — see assumption (f), §9.) **Relationships:** Engagement 1—\* Contract (contracts in scope for the engagement); Prime 1—\* Contract (contracts it holds); Sub 0—\* Contract (contracts it performs under, prime-and-subs kind); in `individual_contractor`, Contract attaches directly to the contractor party via `party_cage/party_uei` with `prime_ref = null`. `Contract.value_at_risk` becomes the auditable source that `TriageResult.value_at_risk` and `RiskRegisterEntry` aggregate from — replacing today's free-standing number with a sum over tracked contracts.

### 3.3 Subs roster / POC / status / management — entity mapping (DONE-WHEN #5)

| Readiness function | Mapped entity/field | Read or write | Notes |
|---|---|---|---|
| Subs roster | **`Sub`** (name, UEI, CAGE, domain, declared_stack) within Engagement; built via U2 (CSV import, SAM UEI lookup) | Read-only view | Existing SCRE entity; no new field needed |
| Sub POC | **`Contact`** (name, role, email; belongs to Sub) | Read + write (edit contact) | Existing SCRE entity; `SubEngagementRecord.contact_email` snapshots the invite-time address |
| Sub status | **Two named fields:** lifecycle = **`SubEngagementRecord.state`** (8-value taxonomy: invited / opened / in_progress / stalled_unopened / stalled_in_progress / escalated / complete / reassessment_due); readiness = **`SubReadinessRecord.rag`** + `sprs_score` + `method` + `confidence` + `next_due` | Read-only display | Both exist in `SCRE-Build-Plan.md §4.1`; status taxonomy is a default **[validate with BHD]** — assumption (e), §9 |
| Sub management | **Writable actions on `SubEngagementRecord` + `Disposition` + `NudgeEvent`**: send-nudge-now, mark-abandoned, disposition (ready / validate / convert-to-enclave), schedule reassessment, opt-out handling | **Write** | Existing entities; management = the action surface over them |

**No new entity is proposed for these four functions — justification:** the SCRE model already separates the *directory* (Sub + Contact), the *process state* (SubEngagementRecord), and the *outcome* (SubReadinessRecord + Disposition); inventing a "SubManagement" entity would duplicate that split. **Read-only roster vs. writable management is an RBAC distinction, not an entity distinction:** primes read roster and summaries and may nudge/dispose; subs read only themselves; BHD operators hold full write; assessors are read-only. Contract (§3.2) is the **only** net-new entity in v2.

## 4. Deliverable preservation (DONE-WHEN #6)

Preservation bar for every artifact: **AJV schema unchanged / export format unchanged.** Under Option B this holds **by construction** — the generators below live in ces-planner, which Muster never edits. Source of the artifact list: the embedded CONTEXT list in `_goal-planner-v2.md` (authoritative for this goal).

| # | Deliverable | Generator (unchanged in ces-planner) | Preservation bar |
|---|---|---|---|
| 1 | SI Baseline | `src/features/sit/services/baselineGenerator.ts` | AJV schema unchanged / export format unchanged |
| 2 | CUI Boundary | `src/features/cui/services/cuiBoundaryGenerator.ts` | AJV schema unchanged / export format unchanged |
| 3 | BTC output | `src/features/btc/services/btcOutputGenerator.ts` | AJV schema unchanged / export format unchanged |
| 4 | TCP profile | `src/features/tcp/services/tcpProfileGenerator.ts` | AJV schema unchanged / export format unchanged |
| 5 | Policy Inputs profile | `src/features/policy/services/policyProfileGenerator.ts` | AJV schema unchanged / export format unchanged |
| 6 | RR Question Set | `src/features/rrt/services/bulkAnswerDerivation.ts` | AJV schema unchanged / export format unchanged |
| 7 | Readiness Posture | `src/features/rrt/services/postureGenerator.ts` | AJV schema unchanged / export format unchanged |
| 8 | Manual Plan | `src/features/mpt/services/manualPlanGenerator.ts` | AJV schema unchanged / export format unchanged |
| 9 | Exec Plan | MPT plan services (Exec Plan output of the MPT artifact set) | AJV schema unchanged / export format unchanged |
| 10 | Proposal | `src/features/mpt/services/proposalGenerator.ts` | AJV schema unchanged / export format unchanged |
| 11 | Tenant Manifest | `src/features/mpt/services/manifestGenerator.ts` | AJV schema unchanged / export format unchanged |
| 12 | Infrastructure Manifest | `src/features/mpt/services/infraManifestGenerator.ts` | AJV schema unchanged / export format unchanged |
| 13 | Policy DOCX documents | `src/features/mpt/services/policyRenderer.ts` + `policyDocxExporter.ts` | AJV schema unchanged / export format unchanged (DOCX) |
| 14 | Customer TCO report | `src/features/cost-estimator/services/tenantCost.ts` | AJV schema unchanged / export format unchanged |

For the assessment-spine artifacts Muster also produces (rows 1, 2, 6, 7 via the vendored derivation), the parity checklist in `DERIVATION_VERSION.md` is the enforcement mechanism: identical `SIBaseline` input shape, identical `ReadinessPosture` field layout, Planner's derivation unit tests passing against the vendored copy, validated against the **same** AJV schemas copied into `muster-knowledge/` at a pinned commit with CI drift monitoring.

## 5. Minimal-touch operating modes (DONE-WHEN #7, #8, #9)

Mode (b) is a scheduled, synchronous, per-sub session; mode (c) is asynchronous self-serve with exception-based escalation — they are costed differently (per sub vs. per escalation) and are not mergeable.

### Mode (a) — client-independent. Budget: **0 hours BHD touch post-onboarding per assessment cycle** [validate with BHD]

Enabling feature set (all Phase 1, because mode (a) requires the backend — the current Planner is single-browser/IndexedDB and cannot support multi-party access): (1) hosted multi-tenant Muster Web + API with self-service **JWT invite-link auth** and save/resume session tokens; (2) **built-in guidance rails** — adaptive interview with plain-language questions, progressive disclosure, "I'm not sure" handling, provenance/confidence badges, conservative-score display; (3) **service-inventory-first collection** (`SCRE-Data-Collection-Goal.md`) so naming/absenting a tile prunes question clusters (150 → 29 in the GCC High demo) without an advisor explaining scope; (4) **automated nudge engine** (T+3/7/14 reminders, stall detection, escalation digests) replacing the phone/email loop; (5) optional **Approach A OAuth harvest** pre-filling tiles with machine facts; (6) self-serve result screen with FCA-safe disclaimer and posture PDF download. "Post-onboarding" means after the one-time engagement setup (roster, data rights, cadence); HIL escalations that a client triggers are accounted under mode (c), not silently absorbed here.

### Mode (b) — live-session assist. Budget: **≤ 2 hours BHD touch per sub per assessment cycle** [validate with BHD]

BHD-specific tasks (enumerated, ≥ 3):

1. **Drive the concierge session** — scope-lite + engagement-kind intake + interview with the sub, advisor keying/overriding answers (~60–90 min).
2. **Advisor verification of low-confidence facts** — the §5.5 CalibrationRecord pass: independently verify interview-derived facts against evidence (~15–20 min).
3. **Result review + StatusPayload handling** — review the score with the sub before release; in Phase 0, manually import the exported JSON into the static roll-up (~15–20 min).
4. **Session prep** — confirm stack/lane from triage, pre-load the question graph (~10 min).

**Self-serve remainder:** the sub answers between-session follow-ups, uploads evidence, uses save/resume, and reads its own result screen — none of it on BHD's clock. **Concierge tooling requirement:** a live-call operator dashboard per **`SCRE-LiveCall-Dashboard.html`** (scre repo) — question-graph state, remaining-question counter, per-fact source/confidence badges, and a flag-for-review control — is the Phase 0 tooling that makes the ≤ 2-hour budget achievable; without it the historical 2–4 hr/sub estimate (`BHD-Planner-as-SCRE.md §4`) applies.

### Mode (c) — chat-first coaching escalating to live. Budget: **≤ 30 minutes BHD touch per escalation instance** [validate with BHD]

- **LLM dependency, declared:** the chat coach and AI config interpreter run on the **Claude API (Anthropic SDK)** per `SCRE-Build-Plan.md §2.2`, surfaced as an in-app chat panel beside the interview [validate with BHD — assumption (g), §9]. **Connectivity is required. This is a breaking change in deployment model:** the current Planner is fully offline; mode (c) exists only in hosted Muster, never in the offline ces-planner.
- **HIL escalation threshold, stated as a specific condition:** an interview-derived `ConfigFact` with **`confidence === 'low'` AND `weight >= 3`** auto-routes to the BHD advisor queue (SCRE Approach B Provisional HIL, `SCRE-Build-Plan.md §5.5`); additionally, any sub-initiated "Flag for advisor review" escalates regardless of weight. Threshold criteria are a default **[validate with BHD]** — assumption (d), §9.
- **Offline fallback:** *Trigger:* the client detects Claude API unavailability — three consecutive failed/timeout calls or a browser offline event — and activates degraded mode automatically. *Degraded-mode behavior:* chat coaching and AI interpretation are disabled; the sub continues on the pre-computed static QuestionGraph (the Phase-0 fixed-graph experience) with structured answer options, "I'm not sure" recording `unknown`, and all answers queued locally in the Dexie session store. *Resync path:* on connectivity restoration, queued answers post to `muster-api`, the AI interpreter runs retroactively over free-text answers to assign confidence, and any resulting low-confidence/high-weight facts route to the HIL queue before the score is released.
- **Source-ordering caveat:** the A + B v1 composition is **not hard-coded** — per the SCRE decision rule, **if >~30% of cohort-1 subs carry CUI on on-prem/OT, Approach C promotes into v1** and the full A → C → B router follows; the scope-lite on-prem/OT intake question is the measurement instrument.

## 6. Build phasing (DONE-WHEN #10)

| Phase | Scope boundary (in) | Explicitly out | Go/no-go gate |
|---|---|---|---|
| **Phase 0 — Concierge MVP** (~4–6 wks) | `scre-muster/` repo; Muster Web SPA (Dexie session only); engagement-kind intake (§3.1); scope-lite incl. on-prem/OT question; static QuestionGraph interview; vendored `deriveActionStatuses()` + M365 playbook; StatusPayload JSON export; `StaticRollup.tsx` + pending-subs CSV; Contract entity in types + roster CSV import. **Mode (b) only.** | Backend, auth, AI copilot, API harvest, snippets, nudging, modes (a)/(c) | **GO to Phase 1 iff:** ≥ 5 real subs and ≥ 50 interview facts assessed; confidence calibration high ≥ 85% / medium ≥ 65% correct; on-prem/OT share measured; mode (b) actuals ≤ 2 hrs/sub confirmed against the budget [validate with BHD]. Any miss → tighten guardrails/tooling and re-measure; do not start the backend. |
| **Phase 1 — Backend + A + B + chat** (~8–12 wks) | `muster-api` (Prisma/PostgreSQL/JWT RBAC/RLS); Claude-API adaptive interview + chat coach with offline fallback (§5c); GCC High Graph probes + OAuth consent; nudge engine + EngagementProgress; full Contract CRUD; sub-management action surface (§3.3); Individual-Contractor flow first-class; SPRS calc standalone. **Modes (a) and (c) go live.** | Approach C, full router, continuous assurance, non-M365 playbooks | **GO to Phase 2 iff:** cohort-1 on-prem/OT share measured from ≥ 20 sub records — **> ~30% "yes/unsure" promotes Approach C**, otherwise C defers; mode (a) pilot engagement completes with 0 BHD hours post-onboarding; HIL queue volume within advisor capacity. NO-GO on a calibration regression below the Phase-0 bars. |
| **Phase 2 — C + full router + assurance** (~6–10 wks, gated) | CaptureRecipe library (signed read-only scripts) + ingestion; A → C → B router; evidence package export; continuous re-assessment + drift alerts (the Tier-3 annuity engine) | Additional intent packs / vendor playbooks (Phase 3 content work) | **GO iff** the Phase-1 C-gate fired (or a strategic moat decision overrides it, recorded); snippet acceptance validated concierge-assisted before self-serve rollout. |

## 7. Pricing alignment (DONE-WHEN #11)

v2 sells into the **three SCRE tiers, by name: Tier 1 assess → Tier 2 enclave → Tier 3 annuity** (prime-pays, $25–100K/sub, $500K–2M per 20-sub cohort — `PRICING_CONTEXT.md`). **CRS/SCRE boundary, restated:** the CRS posture memo (rough SPRS range, verdict, top-3 risk flags) is **not** the CYT gap report and does not substitute for it — it is **not quote-bindable**; the dated EO gap report remains exclusive to the CYT gap phase, and a sub assessed in a SCRE cohort within 12 months does not buy CRS (the Tier 1 report substitutes). Nothing in v2's readiness functions may blur that boundary: Muster's readiness outputs are Tier-1 SCRE deliverables, never CRS memos and never quote-binding gap reports. **LOE is assisted-not-automatic:** v2 computes scores and gap merges automatically, but labor estimation and quoting remain advisor-assisted — there is no NOT_MET→hours calculator, and v2 does not add one. Two-rate labor discipline applies: $150/hr loaded floor (COGS, never quoted) vs. $200/hr billing (`ces-planner/src/shared/types/loeRates.ts`); mode budgets in §5 are COGS-side touch caps, not billing commitments.

## 8. Risks (DONE-WHEN #12)

1. **LLM connectivity (mode c):** Claude API outage degrades to the static-graph fallback (§5c) — mode (c)'s coaching value drops to Phase-0-level UX until resync; sustained outages push touch back toward mode (b) economics. Mitigation: fallback + resync path designed in from Phase 1; SLA monitoring.
2. **Multi-tenancy path:** the backend is the #1 engineering lift and modes (a)/(c) are blocked behind it. Mitigation: Phase 0 proves the product with zero backend; the Phase-1 stack (Prisma/PostgreSQL/RLS/JWT) is fully specified in the Muster build plan; RLS breach is a named risk with database-layer enforcement.
3. **SCRE score weights are directional and unvalidated:** the A/B/C base scores (90.4 / 82.5 / 77.4) and the stack-coverage ordering are vendor-sourced, session-derived, and pending independent verification — this plan treats them as supporting color, not load-bearing sequencing facts.
4. **>~30% on-prem trigger (Approach C):** if >~30% of cohort-1 subs carry CUI on on-prem/OT, Approach C promotes into v1 and Phase 2 pulls forward — budget and staffing must survive that re-ordering. Conversely, hard-coding A+B and ignoring the trigger silently abandons the manufacturing moat.
5. **Muster built independently before v2 ships:** Option B *is* the Muster plan under the Planner-v2 product umbrella — a parallel Muster effort would be the same repo and plan; governance risk (two owners), mitigated by making this document the single plan of record AND by committing a minimal interface contract to the repo at Phase 0 kickoff: the Contract entity JSON schema (§3.2), the `engagement_kind` enum (`prime_and_subs` | `individual_contractor`), and the sub lifecycle-state taxonomy (the 8 states in §9(e)). Any parallel team builds against those committed artifacts, so the v2-net-new surface cannot silently diverge; the assessment-spine vendor parity checklist already pins the existing derivation.
6. **Individual-Contractor becomes the majority kind:** the flow is first-class (§3.1) with no roster/roll-up dependency, so the product degrades gracefully to a self-assessment SaaS; pricing would need a per-party (non-cohort) package — flagged to BHD.
7. **FCA/score-accuracy liability** (top risk inherited from the Muster plan): mitigated by the self-assessed-indicator disclaimer, conservative score, unknown-is-never-a-pass, and HIL review of low-confidence/high-weight facts.

## 9. BHD assumptions register (DONE-WHEN #14)

All tagged at point of use above; consolidated for the validation sweep:

- **(a)** Mode (a) touch budget **= 0 hours post-onboarding per assessment cycle** — is this a firm commercial commitment or an internal target? [validate with BHD]
- **(b)** Mode (b) touch budget **≤ 2 hours per sub per assessment cycle** (lean default, user-selected 2026-07-05) [validate with BHD]
- **(c)** Mode (c) touch budget **≤ 30 minutes per escalation instance** (lean default, user-selected 2026-07-05) [validate with BHD]
- **(d)** HIL escalation threshold: `confidence === 'low' AND weight >= 3` plus sub-initiated flags — confirm criteria and advisor-queue capacity [validate with BHD]
- **(e)** Sub-status taxonomy: the 8 lifecycle states (invited / opened / in_progress / stalled_unopened / stalled_in_progress / escalated / complete / reassessment_due) + RAG readiness — complete and correctly named for prime-facing display? [validate with BHD]
- **(f)** Contract-detail field set (§3.2, 14 fields) — complete for BHD's contract-tracking needs (options, CLINs, mod tracking omitted deliberately)? [validate with BHD]
- **(g)** Chat-coaching tooling: Claude API via Anthropic SDK, in-app chat panel beside the interview — confirm LLM vendor, interface placement, and data-handling posture for sub answers [validate with BHD]

## 10. Open questions (≥ 5)

1. Is mode (a)'s 0-hour budget a contractual SLA or a design target — and what onboarding scope is inside the "post-onboarding" boundary? [validate with BHD]
2. What is the actual cohort-1 stack distribution — specifically the on-prem/OT share that decides the >~30% Approach-C promotion — and when can the nominated sub roster be pulled to measure it?
3. Should Contract track CLINs, option years as separate records, and modifications, or is the flat 11-field record sufficient for readiness purposes? [validate with BHD]
4. For Individual-Contractor engagements, what is the pricing package (no prime payer, no cohort) — a CRS-adjacent front door, a Tier-1 single-party rate, or out of scope for v2 GTM? [validate with BHD]
5. What data-handling terms govern sending sub interview answers to the Claude API (DFARS/CUI adjacency, no-training guarantees, US-region processing) — and does that require a Claude for Government/FedRAMP-authorized endpoint before mode (c) ships? [validate with BHD]
6. Does BHD want the concierge live-call dashboard (mode b tooling) built in Phase 0 as specced, or is the static roll-up + manual worklist acceptable for the first ~5 concierge subs?
7. Who owns knowledge-bank sync governance (the vendored-copy drift reviews) once Muster and ces-planner evolve on different cadences?

## Critic verdict

PASS — 2026-07-05 — independent brutal-critic (separate agent), summary: all DONE-WHEN #1–#12 and #14 bars met; two non-blocking defects logged (field-count typo in §3.2, thin parallel-team mitigation in §8 Risk 5), see docs/context/CRITIQUE.md. Both defects fixed in this document post-critique (§3.2 count corrected to 14; §8 Risk 5 mitigation now names the Phase-0 interface contract).

## HIL approval (DONE-WHEN #15)

APPROVED — 2026-07-05 — explicit user approval recorded after review of the full plan (architecture decision, touch budgets, phasing, critic verdict). G-PLANNER-2 COMPLETE-WHEN satisfied.

---

## P0.x Addendum — Programmatic Drive + Dual Test Suites (2026-07-05)

Executed under Phase 0 scope discipline after HIL approval. Commit `b8bfb33` on branch `master` in `scre-muster`.

**What was added:**
- `src/driver/sessionDriver.ts` — Node-callable session driver reusing real production services (`createEngagement`, `executeExport`, `db`); no logic reimplemented; runs in Vitest Node environment via `environmentMatchGlobs`.
- `e2e/` — 7 Playwright specs (EU-1 through EU-7) targeting `vite preview` on `localhost:4173`. Chromium only. 6/7 pass; EU-3 (resume after reload) is an expected failure — Phase-0 `InterviewRunner` uses React state, not Dexie index persistence.
- `src/driver/__tests__/sessionDriver.test.ts` — SE-2 through SE-6 (AJV valid, score parity, individual_contractor, all-unsure=0, fetch-never-called).
- SE-1 appended to `statusPayload.test.ts` (AJV rejects corrupted required field).
- `@vitest/coverage-v8` with baseline-first thresholds: lines 47 / statements 47 / functions 67 / branches 74 (baseline was 47.41/47.41/67.08/74.91).
- CI: `npm test` replaced by `npm run test:coverage`; `playwright install chromium` + `test:e2e` appended.

**Results:** Vitest 55/55, Playwright 6/7 (EU-3 expected), drift 20/20 OK. Vendored files untouched.

**Phase 0 boundaries held:** no backend, no auth, no AI, no cross-browser, `src/vendored/**` byte-identical to pinned SHA `4a00bee5`.
