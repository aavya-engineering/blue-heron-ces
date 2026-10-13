# CES Module Map — ready-access reference for SCRE code queries

**Purpose:** Consult this before any code-related query about CES/Planner. CES lives at
`C:/Users/mhsut/DevProjects/ces` and is **READ-ONLY reference** — never edit it. All SCRE
work output goes in `C:/Users/mhsut/DevProjects/scre`. (See memory `ces-readonly-scre-focus`.)

**Status:** Paths verified 2026-06-13 against the live tree. Note the repo was mid-`npm install`
and had recently changed directory names (older `cse-*` → current `ces-*`); always re-verify a
path before citing it if results look stale. Line numbers below are from an Explore pass and are
approximate — verify before quoting an exact line.

---

## 0. What CES is

The **Compliance Engine System (CES)** — an npm monorepo (`cmmc-workspace`) of 5 TypeScript
packages that take an organization from compliance *intent* → readiness assessment → M365/GCC-High
implementation plan → execution → evidence → audit artifacts (SSP/POA&M/SPRS). Built out for
**CMMC L2 on Microsoft 365 / GCC High**, but the assessment spine is vendor-pluggable by design.

**The pipeline spine:**
`SIT → CUI Boundary → BTC → TCP → Policy Inputs → RRT (readiness) → MPT (mission plan + policies)
→ Stamper (execution/evidence) → EvidenceOps (SSP/POA&M/SPRS) + AdminOps (85 use-case commands)`

---

## 1. Workspaces (real directory names)

`package.json` workspaces: `ces-shared`, `ces-stamper`, `ces-eo`, `ces-ao`, `ces-planner`.
Also present: `ces-strategy/` (docs), `docs/` (ADRs/context), `scripts/`, legacy `shared/`.

| Dir | Role | Stack | Counts |
|---|---|---|---|
| **`ces-planner`** | **Planner** — the assessment/plan UI. SIT authoring → readiness → mission plan. **This is the SCRE-relevant core.** | React 18 + Vite + TS, browser SPA, Dexie/IndexedDB | ~198 ts/tsx |
| `ces-stamper` | Executes the mission plan against an M365 tenant; collects structured evidence | Node CLI + Express GUI; adapter routing (PowerShell/CLI/Bicep/IPP/Terraform) | ~164 |
| `ces-eo` | EvidenceOps — ingest evidence → assess controls → generate SSP / POA&M / SPRS; drift monitoring | Node + Express + Azure SDK | ~266 |
| `ces-ao` | AdminOps — 85 CMMC use-case commands (audit/config/remediate) with SOD gates | Node CLI + Express API | ~74 |
| `ces-shared` | Shared types, storage-path contract, tenant config, CMMC reference data | Node ESM lib | ~77 |
| `ces-strategy` | Knowledge banks + product-analysis docs (no code) | docs | — |

**Planner entry:** `ces-planner/src/main.tsx` → `App.tsx`. Features under
`ces-planner/src/features/`: `sit`, `cui`, `btc`, `tcp`, `policy`, `rrt`, `mpt`, `cost-estimator`,
`customer`, `landing`.

---

## 2. Strategic Intent (SIT) — the canonical definition of "intent"

> Per the user, **"intent" = the Strategic Intent object in Planner.** It is the single input that
> shapes which questions matter and how every downstream artifact is derived.

- **Type:** `ces-planner/src/shared/types/artifacts.ts` → `SIBaseline` interface (~lines 49–118).
- **Form/UI types:** `ces-planner/src/features/sit/types.ts` (`SITAnswer`, `SITState`, `QuestionDefinition`).
- **Store:** `ces-planner/src/features/sit/stores/sitStore.ts` (Zustand `useSITStore()`).
- **Authoring UI:** `ces-planner/src/features/sit/components/SITWizard.tsx`.
- **Services:** `sit/services/questionSetGenerator.ts` (generates prompts),
  `baselineGenerator.ts` (assembles SIT from answers), `baselineValidator.ts` (schema validation).
- **Persistence:** Dexie store `si_baselines` + file `…/Planner/customers/{name}/inputs/si-baseline-*.json`.

**`SIBaseline` shape (the intent specification):**
- `ces` — metadata: `artifact`, `version`, `generated_on`, **`intent`** (user intent name), `cesId?`.
- `si_baseline.target` — `target_cmmc_level` (L1/L2/L3), `cui_presence`, `cui_types[]`, notes.
- `si_baseline.assessment` — `assessment_route` (self/certification/unknown), `assessment_body`,
  `certification_timing_goal`, `affirmation_obligations[]`.
- `si_baseline.scope` — `boundary_strategy`, **`deployment_posture`** (cloud_only/hybrid/on_prem),
  `external_service_providers[]`, `specialized_assets_present`, `in_scope_users_estimate`,
  `in_scope_endpoints_estimate`.
- `si_baseline.operations` — collaboration_mode, byod_posture, mobile/wireless/removable-media/
  remote-access/maintenance/cui-endpoint postures, `devops_touches_cui`.
- `si_baseline.evidence` — `evidence_posture_target`, `evidence_collection_mode`, `retention_target_days`.
- `si_baseline.dependencies` — **`tenant_model_preference`** (commercial/gcc/gcc_high/dod_il5),
  **`infrastructure_model`** (m365_only/m365_sentinel/m365_azure), `license_tier`, `user_count`,
  `fedramp_package_ids[]`, budget/schedule constraints.
- `si_baseline.risk_acceptance` — `poam_policy_intent`, `risk_acceptance_authority`, tolerances.
- `si_baseline.governance` — affirming_official, evidence_owner_roles[], change/audit owners.
- `validation_warnings?[]`.

**SIT drives downstream:** CUI derivation (`cui/services/cuiSIDerivation.ts`), RRT bulk derivation
(scope/license gates), Stamper execution context, AdminOps command scoping.

---

## 3. Planner artifact chain (types in `ces-planner/src/shared/types/artifacts.ts`)

| Artifact | Type | Dexie store | File |
|---|---|---|---|
| SI Baseline | `SIBaseline` | `si_baselines` | `inputs/si-baseline-*.json` |
| CUI Boundary | `CUIBoundaryOutput` | `cui_boundaries` | `outputs/cui-boundary-*.json` |
| BTC Confirmation | `BTCConfirmationOutput` | `btc_confirmations` | `outputs/btc-confirmation-*.json` |
| Tenant Config Profile | `TenantConfigProfileOutput` | `tenant_config_profiles` | `outputs/tenant-config-profile-*.json` |
| Policy Inputs | `PolicyInputsRecord` | `policy_inputs` | `inputs/policy-inputs-*.json` |
| Readiness Posture | `ReadinessPosture` | `readiness_postures` | `outputs/readiness-posture-*.json` |
| Manual Mission Plan / Manifests / Proposal | `ManualMissionPlan`, `TenantManifest`, `InfrastructureManifest`, `Proposal` | (MPT) | `outputs/*-*.json` |

**Wizards:** `{cui,btc,tcp}/components/*Wizard.tsx`, `rrt/components/RRTWizard.tsx`,
`mpt/components/MPTGenerator.tsx`. TCP autofill queries Stamper: `tcp/services/autofillService.ts`.

---

## 4. The assessment engine — RRT Bulk Answer Derivation

**The accuracy core.** `ces-planner/src/features/rrt/services/bulkAnswerDerivation.ts`
→ `deriveActionStatuses(patterns, playbook, preamble, siBaseline, techRefIndex?, btcRiskFlags?)`.

**RRT Preamble (5 questions)** — `license_tier`, `security_archetype`, `endpoint_management`,
`monitoring_siem`, `policy_doc_state` (see `rrt/hooks/useRRTQuestions.ts`, `RRTPreamble.tsx`).

**6-step first-match-wins cascade:** ① license gate (E5-gated → N/A on E3/G3) → ② scope gate
(level/CUI domains) → ③ inherent check (platform-inherent → implemented) → ④ SIT overrides
(cloud-only → PE N/A; BYOD-off → mobile N/A; CSP-managed → implemented) → ④.5 BTC risk-flag
downgrade → ⑤ preamble overrides (endpoint/monitoring/policy) → ⑥ archetype default fallback.

**Output:** `DerivedActionStatus[]` (`action_id`, `practice_id`, `signal: configure|customize|manual`,
`status: implemented|partial|not_implemented|not_applicable`, `derivation_source`, `derivation_reason`,
`overridden`, `mapped_requirements[]`). Types in `rrt/types.ts`. Review/override UI: `BulkReviewTable.tsx`.
Result → Dexie `readiness_postures`. SPRS-style number computed downstream (EO `sprs/SprsCalculator.ts`).

**MPT compilers:** `mpt/services/gapCompiler.ts` (gaps), `taskCompiler.ts` (→ Stamper tasks),
`infraManifestGenerator.ts`, `inlineCostBuilder.ts`; policies under `features/policy/`.

---

## 5. Vendor playbook binding & multi-stack abstraction (the SCRE differentiator)

- **Vendor-neutral spine:** Capability Taxonomy, Implementation Patterns, Tech Stack Compliance
  Mapping, CMMC Requirements Store — all keyed to *capability*, not vendor.
- **Pluggable binding:** `deriveActionStatuses()` takes the **vendor playbook as a parameter** — swap
  the playbook to derive for another stack. Engine is generic; only content is Microsoft.
- **Only Microsoft authored:** `ces-planner/public/data/vendor playbook Microsoft 365.yaml`
  (schema: `public/schemas/domain CES Vendor Playbook.schema.json`; TS type `VendorPlaybook` in
  `shared/types/domain.ts`). Generation guide: `public/data/playbook-generation-prompt.md`.
- **Schemas/knowledge banks:** `ces-planner/public/schemas/*.schema.json` (Capability Taxonomy,
  Implementation Patterns, RRT Readiness Posture, etc.); loaded via
  `ces-planner/src/shared/services/schemaLoader.ts` and `shared/services/techRefIndex.ts` (TechRefIndex:
  E5-service + CSP-managed sets). CMMC reference data in `ces-shared/src/data/*.reference.json`.
- **Stack provider seam:** `ces-shared/src/stack/StackProvider.ts` + `providers/microsoftGccHigh.ts`
  + `exampleStub.ts`. See ADR-003 (`docs/adr/ADR-003-stack-provider-seam.md`).

> **SCRE implication:** assessing *any* stack is design-native. Authoring a per-stack playbook
> (~$10–50K content effort) restores 60–80% auto-derivation for that stack. Build/remediation
> outputs (TCP, manifests, Stamper) are intrinsically M365/GCC-High and only matter on conversion.

---

## 6. Persistence & state

- **Browser (Planner only):** Dexie/IndexedDB DB `'CMMCComplianceTool'` v6, 6 stores (see §3).
  Schema: `ces-planner/src/shared/db/schema.ts`. Contract pinned in
  `ces-shared/src/storage/DexieContract.ts` (`PLANNER_DEXIE_DB_NAME`, store→FS path map).
- **Filesystem (Node modules):** root `CES_PIPELINE_ROOT` (default `C:\CES_Pipeline`). Path
  resolvers in `ces-shared/src/storage/node.ts` (FE-safe contract in `contract.ts`). Layout:
  `Planner/customers/{name}/{inputs,outputs}/`, `Stamper/{plan-data,storage}/`,
  `EvidenceOps/storage/`, `AdminOps/evidence-store/{domain}/{useCase}/{year}/{month}/`.
- **No multi-tenancy, no auth, no production backend** — single-customer-in-browser by deliberate
  design. **This is the #1 gating dependency for productizing SCRE** (cohort + prime roll-up +
  re-assessment need persistence + multi-user). Concierge MVP (run per-sub, export, aggregate
  manually) avoids it; productization requires building it.

---

## 7. Key docs (read these for deeper detail; all under `ces/`)

- `ces-strategy/analysis/product-analysis-planner.md` — Planner feature inventory & roadmap (large).
- `ces-strategy/analysis/product-analysis-{stamper,evidenceops,adminops,ces-system}.md`.
- `ces-strategy/ces-dataflow-objects.md` — persistent artifact flow diagram.
- `ces-strategy/SSP-Generation-Formula.md` — SSP assembly spec.
- `ces/PLAN.md` (current), `PLAN_V2.md` (superseded), `DESIGN.md` (design system),
  `CES-FOUNDER-TENANT-HANDOFF.md` (VFSgov GCC High onboarding).
- `ces/docs/adr/ADR-00{1,2,3}-*.md` — identity model, unified persistence, stack-provider seam.
- `ces-planner/{README.md,PRODUCT_STORY.md,NEXT_STEPS.md,CLAUDE.md,AGENTS.md}`.

---

## 8. Known gaps / deferred (relevant to SCRE planning)

- Multi-tenancy / multi-user backend — not implemented (gating for cohort + roll-up).
- Self-serve / low-expertise mode — Planner UX is advisor-oriented today.
- Cross-customer / cohort console — no aggregate view exists.
- Non-Microsoft vendor playbooks — only M365 authored (content gap, not architecture).
- AdminOps live execution — Domain E (read-only) is the first live-execution proof target; Tier 3
  destructive commands deferred (no two-person `ManualGateAdapter` yet).
