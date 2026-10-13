# SCRE Build Plan — Muster Platform
**Date:** 2026-06-21
**Status:** READY FOR IMPLEMENTATION
**Codename:** Muster
**Working directory:** `C:\Users\mhsut\DevProjects\scre\`

---

## 1. Concept Summary

Muster is a **new, standalone module** — not a modification to CES Planner — that repackages Planner's
proven assessment spine into a **prime-facing, multi-tenant platform** for assessing an entire
subcontractor tier at once. Where Planner is a single-advisor browser tool that builds one tenant,
Muster is a multi-tenant SaaS product in which a prime "musters" its sub-tier, each sub completes a
self-service adaptive collection experience (AI-guided interview + signed read-only code snippets +
optional API harvest), every collected fact carries provenance + confidence, and a compact status
payload is shipped home and aggregated into a prime roll-up board with continuous re-assessment as
the annuity.

**Key differences from Planner:**

| Dimension | Planner | Muster |
|---|---|---|
| Scope | 1 tenant, 1 advisor | N subs, prime-managed cohort |
| Auth / tenancy | None — single-browser, offline | Multi-tenant backend (party-scoped) |
| Data collection | Advisor-filled wizard | Adaptive AI interview + API harvest + snippets |
| Per-fact tracking | Implicit | Explicit: source + confidence on every fact |
| Output audience | BHD advisor | Sub (score), prime (roll-up), assessor (evidence) |
| Build spine | Full (TCP / MPT / Stamper) | Assessment half only; build spine deferred to enclave |
| Stack coverage | M365 / GCC High (authored) | Router across all stacks; B is universal day-1 fallback |
| Persistence | Dexie / IndexedDB (session) | Production backend (PostgreSQL + object store) |

---

## 2. Target Architecture

### 2.1 Module structure

```
scre-muster/                       ← new top-level repo / monorepo root
├── apps/
│   ├── muster-web/                ← React 18 + Vite + TS SPA (reuse Planner's tech stack)
│   │   ├── src/
│   │   │   ├── features/
│   │   │   │   ├── engage/        ← engagement setup + roster (U1–U5)
│   │   │   │   ├── triage/        ← cohort triage + lane/mode routing (U6–U8)
│   │   │   │   ├── collection/    ← adaptive collection experience (U9–U16)
│   │   │   │   │   ├── interview/ ← Approach B: question graph + AI copilot
│   │   │   │   │   ├── harvest/   ← Approach A: Graph/API consent + probe runner
│   │   │   │   │   └── capture/   ← Approach C: snippet generator + ingestion
│   │   │   │   ├── rollup/        ← prime roll-up board + heatmap + engagement progress (U17–U22)
│   │   │   │   │   ├── ReadinessBoard.tsx    ← existing RAG/heatmap/risk-register view
│   │   │   │   │   └── EngagementProgress.tsx ← process dashboard: state counts, worklist, metrics
│   │   │   │   ├── disposition/   ← per-sub decision + enclave bridge (U23–U25)
│   │   │   │   └── assurance/     ← continuous re-assessment scheduler (U26–U29)
│   │   │   ├── shared/
│   │   │   │   ├── types/         ← Muster domain types (see §5)
│   │   │   │   ├── services/      ← knowledge loader, schema validator, SPRS calc
│   │   │   │   └── db/            ← Dexie schema (session-only, per sub run)
│   │   │   └── main.tsx
│   └── muster-api/                ← Node / Express (or Fastify) backend
│       ├── src/
│       │   ├── auth/              ← JWT + party-role middleware
│       │   ├── routes/            ← REST endpoints (engagements, subs, assessments, rollup)
│       │   ├── services/
│       │   │   ├── intentCompiler.ts        ← Generalized Intent → minimum question set (see §5.5)
│       │   │   ├── router.ts                ← per-objective A/B/C routing decision
│       │   │   ├── factLedger.ts            ← provenance + confidence merge
│       │   │   ├── derivation.ts            ← vendored copy of deriveActionStatuses() (see §5.4)
│       │   │   ├── DERIVATION_VERSION.md    ← pinned CES commit + copy date + parity checklist
│       │   │   ├── sprsCalc.ts              ← standalone SPRS score (DoD methodology; no ces-eo import)
│       │   │   ├── probeRunner.ts           ← Approach A: Graph/API connector SDK
│       │   │   ├── snippetEngine.ts         ← Approach C: recipe authoring + output ingestion
│       │   │   ├── rollupAggregator.ts      ← SubReadinessRecord → RollUp
│       │   │   ├── nudgeWorker.ts           ← scheduled job: stall detection + nudge dispatch (§7.1.2)
│       │   │   └── notificationService.ts   ← injected email/notification provider interface (Phase 1: SendGrid)
│       │   └── db/                ← Prisma schema (PostgreSQL)
│       └── prisma/
│           └── schema.prisma      ← Engagement, Sub, Assessment, ConfigFact, Artifact…
├── packages/
│   ├── muster-shared/             ← shared TS types used by both web and api
│   │   └── src/stack/             ← vendored StackProvider + microsoftGccHigh provider
│   └── muster-knowledge/          ← vendored copies of read-only knowledge banks (no symlinks)
│       ├── data/                  ← vendor playbook YAMLs, copied from ces-planner/public/data/
│       ├── schemas/               ← JSON schemas, copied from ces-planner/public/schemas/
│       ├── src/services/          ← vendored schemaLoader.ts + techRefIndex.ts
│       └── KNOWLEDGE_VERSION.md   ← pinned CES commit + sync date
└── package.json                   ← pnpm workspace
```

### 2.2 Tech stack

| Layer | Technology | Rationale |
|---|---|---|
| Front end | React 18 + Vite + TypeScript | Identical to Planner — reuse component patterns |
| State management | Zustand (session) | Same as Planner; server state via TanStack Query |
| Session persistence | Dexie / IndexedDB | Per-sub collection run only; final state persisted to backend |
| Backend | Node + Express (or Fastify) | Consistent with CES ecosystem (ces-eo, ces-ao) |
| ORM / DB | Prisma + PostgreSQL | Multi-tenancy, party-scoped rows, audit log |
| Object store | Azure Blob Storage (or S3) | Evidence artifacts, snippet output, signed files |
| Auth | JWT + RBAC middleware | Roles: prime / sub / bhd_operator / assessor (read-only) |
| AI copilot | Claude API (Anthropic) via Anthropic SDK | Config interpreter, next-question selection, snippet drafting |
| Knowledge layer | Vendored copies in `packages/muster-knowledge/` | No fork; synced from CES at explicit intervals; drift-monitored by CI |
| Connector SDK | Custom Capability Probe SDK (TypeScript) | Maps API responses → capability-taxonomy facts |

### 2.3 Concierge-MVP path (defer backend)

Run Muster Web per-sub as a local-first SPA (Dexie only), export each StatusPayload JSON manually.
The Phase 0 prime roll-up deliverable is a **static React page** (`muster-web/src/features/rollup/StaticRollup.tsx`)
that loads an array of exported StatusPayload JSON files from a local directory and renders the
prime board (RAG by sub, family heatmap, risk register). The BHD operator imports each JSON manually
and opens the page locally. No script/spreadsheet aggregate; one canonical deliverable. The
multi-tenant backend is Phase 1.

---

## 3. Reuse-from-Planner Inventory

| Asset | CES path | How Muster uses it |
|---|---|---|
| `deriveActionStatuses()` | `ces-planner/src/features/rrt/services/bulkAnswerDerivation.ts` | **Vendored copy** into `muster-api/src/services/derivation.ts` at a pinned CES commit (recorded in `muster-api/src/services/DERIVATION_VERSION.md`). No live import from `ces/` at runtime. See §5.4 for copy/drift policy. |
| `SIBaseline` type | `ces-planner/src/shared/types/artifacts.ts` L49–118 | Extended → `GeneralizedIntent`; CMMC L2 intent pack maps to this schema so derivation is unchanged |
| `ReadinessPosture` type + Dexie contract | `ces-planner/src/shared/types/artifacts.ts`; `ces-shared/src/storage/DexieContract.ts` | Reused as the per-sub assessment output type; wrapped by `SubReadinessRecord` |
| Vendor Playbook YAML + schema | `ces-planner/public/data/vendor playbook Microsoft 365.yaml`; `ces-planner/public/schemas/domain CES Vendor Playbook.schema.json` | **Vendored copy** into `packages/muster-knowledge/data/` and `packages/muster-knowledge/schemas/` at a pinned CES commit recorded in `packages/muster-knowledge/KNOWLEDGE_VERSION.md`. A CI job diffs against the CES source on each build and fails with a drift warning if any file has changed. Sync procedure: pull updated files from CES, review semantic changes, bump `KNOWLEDGE_VERSION.md`, commit. No symlinks (cross-platform/CI fragility). |
| Capability Taxonomy / Implementation Patterns / CMMC Reference | `ces-planner/public/schemas/*.schema.json`; `ces-shared/src/data/*.reference.json` | Same vendored-copy policy as above; included in `packages/muster-knowledge/`. |
| `schemaLoader.ts` + `techRefIndex.ts` | `ces-planner/src/shared/services/` | Vendored copy into `packages/muster-knowledge/src/services/`; no live import |
| `StackProvider` seam | `ces-shared/src/stack/StackProvider.ts` + `providers/microsoftGccHigh.ts` | **Vendored copy** of `StackProvider.ts` + `microsoftGccHigh.ts` into `packages/muster-shared/src/stack/`; new stacks add a provider file in the same directory. No live import from `ces-shared/` at runtime. |
| `SprsCalculator` | `ces-eo/src/sprs/SprsCalculator.ts` | **Reimplemented standalone** in `muster-api/src/services/sprsCalc.ts` using the published DoD SPRS methodology (NIST SP 800-171 DoD Assessment Methodology v1.2.1). `ces-eo` carries Azure SDK transitive dependencies that cannot be tree-shaken; a clean standalone implementation avoids that coupling entirely. The implementation is validated against the same SPRS input vectors as `ces-eo` tests. |
| SIT wizard UX patterns | `ces-planner/src/features/sit/components/SITWizard.tsx` | Reference for the scope-lite wizard pattern; do not import — replicate the pattern |
| RRT preamble questions | `ces-planner/src/features/rrt/hooks/useRRTQuestions.ts`; `RRTPreamble.tsx` | Adapt the 5 preamble questions into the Intent Compiler's initial seed |
| BTC risk-flag downgrade logic | `ces-planner/src/features/rrt/services/bulkAnswerDerivation.ts` step ④.5 | Carried through `deriveActionStatuses()` — no change needed |
| CSS design language | `ces-planner` + existing SCRE dashboard HTML | Reuse `--navy`, `--amber`, `--teal` etc. for Muster Web |

**Do NOT reuse:** TCP wizard, MPT/Mission Plan generator, Stamper handoff, `infraManifestGenerator`,
`taskCompiler`, policy generation — these belong to the build spine and are deferred to enclave
conversion (Tier 2).

---

## 4. Data Model

### 4.1 Core types (new in `muster-shared/src/types/`)

```typescript
// ── Generalized Intent (replaces SIBaseline as the framework-agnostic input) ──
interface GeneralizedIntent {
  intent_id: string;
  framework: 'cmmc_l2' | 'fedramp' | 'nist_800_53' | 'soc2' | string;  // intent pack key
  target_posture: string;          // e.g. 'level_2'
  scope: IntentScope;              // boundary, CUI presence, cui_types
  stack: StackDescriptor[];        // detected or declared stacks
  obligations: string[];           // DFARS clauses, flow-downs
  governance: GovernanceBlock;     // affirming official, data rights
  // For CMMC L2: maps onto SIBaseline fields so deriveActionStatuses() receives a compatible input
}

// ── ConfigFact: one atomic config truth with full provenance ──
interface ConfigFact {
  fact_id: string;
  objective_ref: string;           // e.g. 'AC.L2-3.1.1[a]'
  value: unknown;                  // the raw fact value
  derived_status: 'met' | 'partial' | 'not_met' | 'unknown' | 'insufficient_evidence';
  source: 'machine' | 'artifact' | 'interview';
  confidence: 'high' | 'medium' | 'low';
  weight: 1 | 2 | 3 | 4 | 5;      // objective importance: derived from CMMC practice weight table
                                   //   (5 = highest; drives HIL routing and information-gain ordering)
  evidence_ref?: string;           // sha256 of the artifact, if artifact-backed
  collected_at: string;            // ISO 8601
  collector: string;               // probe_id, snippet_id, or question_id
}

// ── StatusPayload: compact wire format emitted on discovery completion ──
interface StatusPayload {
  sub_ref: string;                 // UEI:ABC123
  engagement_ref: string;
  framework: string;
  readiness_path: 'final_ready' | 'conditional_ready' | 'not_ready' | 'insufficient_evidence';
  sprs_score: number;              // –203 to 110
  conservative_score: number;      // unknowns assumed to fail
  control_rollup: { met: number; partial: number; not_met: number; not_assessed: number };
  source_mix: { machine: number; artifact: number; interview: number };
  confidence_profile: { high: number; medium: number; low: number };
  facts: ConfigFact[];
  generated_at: string;
}

// ── SubReadinessRecord: the canonical Muster unit (wraps ReadinessPosture) ──
interface SubReadinessRecord {
  record_id: string;
  sub_ref: string;
  engagement_ref: string;
  sprs_score: number;
  conservative_score: number;
  rag: 'green' | 'amber' | 'red';
  score_pct: number;
  control_rollup: StatusPayload['control_rollup'];
  family_scores: FamilyScore[];
  poam_items: POAMItem[];
  source_mix: StatusPayload['source_mix'];
  confidence_profile: StatusPayload['confidence_profile'];
  method: 'self_serve' | 'concierge' | 'validated';
  assessed_at: string;
  next_due?: string;
  validation?: ValidationRecord;
  disposition?: Disposition;
}

// ── QuestionGraph: the computed, prunable interrogatory per sub ──
interface QuestionGraph {
  graph_id: string;
  intent_ref: string;
  nodes: QuestionNode[];           // one per objective or branch
  edges: GraphEdge[];              // branching / pruning rules
  pruned: string[];                // node IDs pruned by answered facts
  next_by_info_gain: string;       // node ID of the next highest-information question
  completion_state: 'in_progress' | 'complete' | 'abandoned';
}

// ── SubEngagementRecord: per-sub engagement lifecycle + nudge state ──
// Additive to SubReadinessRecord; does not break existing types.
type EngagementState =
  | 'invited'
  | 'opened'
  | 'in_progress'
  | 'stalled_unopened'       // invited but not opened within N_open days
  | 'stalled_in_progress'    // in_progress/opened with no activity within N_active days
  | 'escalated'              // stalled past N_escalate days; flagged to prime + BHD
  | 'complete'               // StatusPayload received; assessment done
  | 'reassessment_due';      // cadence elapsed; new invite cycle triggered

interface SubEngagementRecord {
  engagement_record_id: string;
  sub_ref: string;                 // UEI:ABC123 — foreign key to SubReadinessRecord
  engagement_ref: string;
  state: EngagementState;
  // Lifecycle timestamps (all ISO 8601; null until the event occurs)
  invited_at: string;
  opened_at: string | null;
  last_activity_at: string | null; // updated on every session heartbeat or answer submission
  completed_at: string | null;
  // Nudge tracking
  last_nudge_at: string | null;
  next_nudge_at: string | null;    // computed by nudgeWorker; null when complete or opted_out
  nudge_count: number;             // total automated nudges sent this cycle
  stalled_since: string | null;    // ISO 8601 timestamp when stall threshold first breached
  opted_out: boolean;              // true → no further automated nudges; manual also blocked
  contact_email: string;           // address used for nudges (from invite; never derived)
}

// ── NudgeEvent: immutable log entry per nudge dispatch or manual action ──
interface NudgeEvent {
  event_id: string;
  engagement_record_id: string;   // FK to SubEngagementRecord
  event_type:
    | 'automated_reminder'
    | 'manual_nudge'              // prime or BHD operator triggered
    | 'escalation_digest'
    | 'opt_out_received'
    | 'state_transition';
  timestamp: string;              // ISO 8601
  channel: 'email' | 'in_app' | 'digest';
  outcome: 'sent' | 'delivered' | 'failed' | 'opted_out_blocked' | 'cap_blocked';
  triggered_by: string;           // 'system:nudgeWorker' | 'user:<party_id>'
  // No email body content stored — least-data principle
}

// ── NudgeCadenceConfig: per-engagement nudge schedule (set at U3–U5 scope definition) ──
interface NudgeCadenceConfig {
  engagement_ref: string;
  nudge_days: number[];           // days after invited_at to send reminders (default: [3, 7, 14])
  quiet_hours_start: string;      // HH:MM local prime time (default: '20:00')
  quiet_hours_end: string;        // HH:MM local prime time (default: '08:00')
  quiet_hours_tz: string;         // IANA timezone string
  max_nudges: number;             // hard cap per sub per cycle (default: 3)
  stall_open_days: number;        // N_open threshold (default: 3)
  stall_active_days: number;      // N_active threshold (default: 7)
  escalate_days: number;          // N_escalate threshold (default: 14)
}
```

### 4.2 Artifact alignment to Planner schemas

| Muster artifact | Planner type | Relationship |
|---|---|---|
| `GeneralizedIntent` | `SIBaseline` | Superset; CMMC L2 pack maps 1-to-1 to `SIBaseline` fields so `deriveActionStatuses()` receives unchanged input |
| `ConfigFact[]` (merged) | RRT preamble answers | Replaces the manual preamble; facts feed the same 6-step cascade |
| `ReadinessPosture` | `ReadinessPosture` | Identical type; produced by `deriveActionStatuses()`, wrapped by `SubReadinessRecord` |
| `StatusPayload` | (new) | Wire format; normalized into `SubReadinessRecord` on ingest |
| `SubReadinessRecord` | (new wrapper) | The hinge object; references `ReadinessPosture` + SPRS score + RAG |
| `POAMItem[]` | `gapCompiler.ts` output | Derived by Muster's `rollupAggregator` from the ReadinessPosture gaps |
| Evidence artifacts | `EvidenceItem` | Same type; signed artifact stored in object store, hash in `ConfigFact.evidence_ref` |

---

## 5. The Acquisition Router

### 5.1 Per-objective decision logic

```
for each CMMC objective in the IntentPack:
  1. Is an A-probe registered for this objective AND the sub's stack?
       AND has the sub granted API consent?
     → A path: run probe → emit ConfigFact(source=machine, confidence=high)

  2. Else: does a CaptureRecipe exist for this objective AND the sub's stack?
       AND is the recipe's capture-effort below the dropout threshold?
     → C path: present snippet to sub → ingest output
             → emit ConfigFact(source=artifact, confidence=high|medium)

  3. Else:
     → B path: emit QuestionNode into the QuestionGraph
             → interview answer → AI config interpreter → emit ConfigFact(source=interview, confidence=computed)

After all objectives have a fact (or explicit 'unknown'):
  → merge facts into FactLedger (de-dup by objective_ref; highest-source wins on tie)
  → call deriveActionStatuses(patterns, playbook, intent, techRefIndex, btcRiskFlags)
  → produce ReadinessPosture → wrap in SubReadinessRecord → emit StatusPayload
  → route facts where confidence=low AND weight≥3 to human-in-the-loop queue
```

### 5.2 v1 build order (A + B; C gated by cohort data)

- **v1 ships:** A (Microsoft GCC High Graph probes) + B (adaptive interview, universal fallback).
- **C gate:** if >~30% of cohort-1 subs carry CUI on on-prem/OT, C moves into v1; otherwise C is Phase 2.
- **Full routing** follows C (little to route between until a second high-truth source exists).
- **Decision timing:** measure real sub roster before Phase 2 kickoff.

### 5.3 Provenance + confidence merge rules

- A fact is **immutable** once recorded (source + value + evidence_ref + collected_at are write-once).
- If the same objective has facts from multiple sources: source rank is machine > artifact > interview.
  On tie in source rank, higher confidence wins. The lower-ranked fact is retained with its provenance
  for audit; only the winning fact drives `derived_status`. Example: if machine returns `partial` and
  interview returns `met`, `partial` wins (machine > interview). Both records are stored.
- A missing fact is never silently turned into a pass — it records as `unknown` / `insufficient_evidence`.
- Every merge produces an audit log entry.

### 5.4 Derivation vendoring policy

`deriveActionStatuses()` is a **vendored copy**, not a live import from `ces/`.

- **Source:** `ces-planner/src/features/rrt/services/bulkAnswerDerivation.ts` (plus all types it
  transitively requires from `ces-planner/src/shared/types/artifacts.ts` and
  `ces-shared/src/data/*.reference.json`).
- **Version stamp:** the exact CES git commit hash is recorded in
  `muster-api/src/services/DERIVATION_VERSION.md` at copy time. Re-copy is a deliberate, reviewed action.
- **Parity checklist** (recorded in `DERIVATION_VERSION.md`):
  - [ ] All 6 cascade steps preserved (preamble → lookup → pattern match → gap fill → BTC downgrade → status emit)
  - [ ] BTC risk-flag downgrade logic at step ④.5 intact
  - [ ] `SIBaseline` input shape accepted unchanged (CMMC L2 `GeneralizedIntent` maps to it 1-to-1)
  - [ ] Output type is `ReadinessPosture` with identical field layout
  - [ ] Unit tests from Planner's derivation test suite pass against the vendored copy
- **Drift monitoring:** a CI job runs `git diff <pinned-commit> HEAD -- ces-planner/src/features/rrt/services/bulkAnswerDerivation.ts`
  (or equivalent file hash comparison if repos are separate) on every build and emits a warning if the
  upstream file has changed. A developer must explicitly review the diff, update the vendored copy if
  needed, re-run the parity checklist, and bump `DERIVATION_VERSION.md`.

### 5.5 Confidence calibration for Approach B

The AI config interpreter assigns `confidence: 'high' | 'medium' | 'low'` to each interview-derived
`ConfigFact`. Calibration ensures those labels are accurate.

**Prompt-level guardrails (Phase 0 → onward):**
- System prompt explicitly forbids asserting `confidence: 'high'` on any objective where the sub's
  verbatim answer does not contain a specific, named configuration value (e.g. a policy name, a setting
  value, a product name).
- `confidence: 'medium'` is assigned when the answer is directionally consistent but lacks specifics.
- `confidence: 'low'` is assigned for vague, hedged, or self-contradictory answers, or when the
  interpreter cannot map the answer to a known configuration state.

**Calibration baseline (produced in Phase 0):**
- Each Phase-0 concierge run produces a `CalibrationRecord`: for every `ConfigFact(source=interview)`,
  the concierge advisor independently verifies the fact against evidence (e.g. a screenshot, a policy
  doc) and records `advisor_verdict: 'correct' | 'incorrect' | 'insufficient_evidence'`.
- After Phase 0 (minimum 5 subs, minimum 50 interview facts), calibration is computed as:
  precision(high) = correct_high / total_high facts;
  precision(medium) = correct_medium / total_medium facts.
- **Phase 0 → Phase 1 gate (falsifiable):** high-confidence facts must be ≥ 85% correct on the
  Phase-0 sample. If not, prompt guardrails are tightened and calibration is re-run before Phase 1
  ships the AI autopilot. Medium-confidence bar is ≥ 65%.
- `CalibrationRecord` rows are stored in the Muster backend under a `bhd_internal` party scope
  (not visible to primes or subs).

**HIL routing (uses `weight` from §4.1):**
- The router sends a fact to the human-in-the-loop queue when `confidence === 'low' AND weight >= 3`.
- `weight` is derived from the CMMC practice weight table at `intentCompiler` time and stamped onto
  every `ConfigFact` and `QuestionNode` at creation; it does not change after creation.

### 5.6 intentCompiler algorithm

**Inputs:** `GeneralizedIntent` object + detected/declared `StackDescriptor[]` + `CapabilityTaxonomy`
(from `muster-knowledge`) + `IntentPack` (CMMC L2: 110 practices mapped to objectives).

**Output:** `QuestionGraph` — the minimum set of question nodes that, when answered, can change the
`derived_status` of at least one objective given the declared scope and stack.

**Algorithm (implemented in `intentCompiler.ts`):**
1. Load all objectives for the framework from the IntentPack (110 for CMMC L2).
2. For each objective, check if an A-probe or C-recipe is registered for the declared stack.
   If yes, mark the objective as `probe_covered` or `recipe_covered` — do not emit a QuestionNode
   for it (the collection runtime will handle it; emit a placeholder node marked `deferred_to_probe`).
3. For remaining objectives, apply scope pruning: if `GeneralizedIntent.scope` has no physical
   boundary, drop objectives tagged `physical_only`; if no BYOD, drop `mobile_only`; if cloud-only,
   drop `on_prem_only`. Record pruned node IDs in `QuestionGraph.pruned`.
4. For each remaining objective, generate a `QuestionNode` with: `objective_ref`, plain-language
   question text (from IntentPack question map), `weight` (from CMMC practice weight table),
   `answer_options` (yes/no/unsure + free text), and `branch_rules` (conditions under which
   downstream nodes can be pruned by this answer).
5. Assign `next_by_info_gain`: the node with the highest `weight` among unanswered, un-pruned nodes.
   Ties broken by CMMC practice family order (AC before AU before CM, etc.).
6. Emit `QuestionGraph` with all nodes, edges (branch pruning rules), and initial `next_by_info_gain`.

**Session update:** after each answer, `intentCompiler.updateGraph(graph, answeredFact)` re-evaluates
`branch_rules`, prunes newly-resolved nodes, and recalculates `next_by_info_gain`.

### 5.7 Router behavior when C is not built (Phase 1)

In Phase 1, Approach C does not exist. The router handles this explicitly:
- Step 2 of the §5.1 cascade ("does a CaptureRecipe exist?") always evaluates to false in Phase 1
  because the recipe library is empty.
- On-prem/OT objectives that would route to C in Phase 2 fall through to step 3 (B path) with the
  `QuestionNode` tagged `lane: 'on_prem_fallback'`.
- The resulting `ConfigFact` carries `confidence: 'low'` (interview-only for infrastructure that
  would normally require a snippet), `weight` unchanged, and a `note: 'C path not yet available'`
  field in the evidence record. These facts are automatically added to the HIL queue if `weight >= 3`.
- The router never emits `insufficient_evidence` solely because C is absent; B is always the fallback.

---

## 6. Sub UX Flow (end-to-end, non-technical owner)

**Phase 0 vs. Phase 1 divergence note:** Steps ①–⑥ below describe the Phase 1 self-serve flow.
In **Phase 0 (concierge)**, the BHD operator drives the session alongside the sub; AI config
interpretation is disabled; "I'm not sure" records `unknown` (C path does not exist in Phase 0);
the OAuth consent step is skipped; and the score result is reviewed by the advisor before the sub
sees it. Concierge operators must not present the C or A paths as available in Phase 0. The
Phase 0 flow ends at step ⑤ export (no self-serve result screen); the advisor imports the JSON
into the prime roll-up manually.

```
Prime sends branded invite link (with engagement_token)
  ↓
① Open invite — sub lands on Muster Web
   • Scope-lite: 5 plain-language questions (target L2, does your org handle CUI, what systems, ~10 min)
     — includes one stack-intake question: "Do you store or process CUI on on-premises servers,
       manufacturing equipment, or operational technology?" (yes / no / unsure) — this answer feeds
       the Phase 1/2 C-gate measurement (see §5.2)
   • Consent screen (SCRE, plain English, read-only, signed snippets explained)
   • Optional: one-click API consent for GCC High (OAuth read-only scopes shown, plain English)
     — Exact scopes requested: User.Read, Organization.Read.All, Policy.Read.All,
       DeviceManagementConfiguration.Read.All, Reports.Read.All, AuditLog.Read.All
       (minimum read-only set; no Directory.Read.All)
     — If sub declines OAuth consent: silently fall back to B (interview) for all objectives
       that would have been covered by A. No error shown; sub sees normal interview flow.
       The prime roll-up will show source_mix.machine = 0 for that sub.
   • Save/resume: session token issued; link can be reopened within 7 days
   • Session expiry (day 8+): sub sees a "Your session has expired" screen with a "Request a new
     link" button that emails the prime contact. Partial answers are not recoverable after expiry
     (security posture data should not linger); the sub starts over with a fresh session.
  ↓
② Adaptive interview (Approach B)
   • Intent Compiler computes QuestionGraph from intent pack + declared stack (see §5.6)
   • One question at a time, plain language, progressive disclosure
   • Phase 1: "I'm not sure" routes the objective to C (snippet) if a recipe exists, else records 'unknown'
   • Phase 0: "I'm not sure" records 'unknown' (no C path available)
   • Free-text answers and pasted output interpreted by AI config interpreter → ConfigFact + confidence
   • Branch pruning: cloud-only → physical questions drop; no BYOD → mobile set drops
   • Next question chosen by information gain (highest-weight unresolved objective first, per §5.6)
  ↓
③ Snippet moments (Approach C — Phase 2 self-serve; Phase 1 concierge-assisted only)
   • When a high-weight objective is better settled by machine evidence OR sub can't answer:
     Muster presents a signed, read-only script (PowerShell / PS Graph / AD query)
   • UI shows: what it reads, what it does NOT do, SHA-256 hash, how to run it,
     PowerShell execution-policy note ("run: Set-ExecutionPolicy -Scope Process RemoteSigned")
   • Sub pastes output (or uploads file) → ingestion pipeline extracts ConfigFacts
   • Artifact stored (object store) as the audit trail; hash recorded in ConfigFact.evidence_ref
   • Sub can decline a snippet: objective falls back to B interview with 'low' confidence tag
  ↓
④ API harvest moments (Approach A — GCC High consent path)
   • If sub granted OAuth consent at step ①: harvest runs silently in background
   • Sub sees progress ("Reading your GCC High configuration — no changes are made")
   • Each probe emits ConfigFact(source=machine, confidence=high) → facts folded in automatically
  ↓
⑤ Review + confirm
   • Sub reviews derived facts and preliminary status per control family
   • Can override low-confidence facts with a free-text explanation (logged, confidence tagged 'attested')
   • "Flag for advisor review" available on any item
  ↓
⑥ See result
   • Plain-language score: "You scored 87/110 controls. Your three biggest gaps are…"
   • Disclaimer shown: "This is a self-assessed readiness indicator. It is not a CMMC certification,
     a formal self-attestation, or legal advice. Engage a C3PAO for formal assessment."
   • Conservative score (unknowns assumed to fail) shown alongside primary score
   • "What moves you up": the top 3 high-weight POAMItems with plain-language remediation
   • StatusPayload emitted → sent to Muster API → normalized into SubReadinessRecord → prime roll-up
   • Sub can download its own posture PDF
```

**UX guardrails:**
- AI copilot NEVER asserts a control is met unless a fact supports it.
- Score is always shown as a readiness indicator, never as certification or legal self-attestation.
- Conservative score (unknowns assumed to fail) shown alongside the primary score.
- Low-confidence / high-weight items are flagged with a caution indicator; the UI does not hide them.
- Save/resume at every step; session token survives browser close for 7 days.
- "Unknown is never a pass" — any objective without a supporting fact contributes to conservative score.
- Per-fact provenance and confidence are always visible to the sub (source, collector, confidence tier).

---

## 7. Prime / Management Flow

```
BHD or Channel creates an Engagement (U1)
  ↓
Load sub roster (U2)
  • Import: CSV with name/UEI/CAGE
  • Registry: SAM.gov entity search by UEI or CAGE (read-only API)
  • Discover: SAM sub-award data for a prime's programs (optional, Phase 2)
  ↓
Define scope (U3–U5): programs, milestones, cadence, data rights, enrollment posture
  ↓
Cohort triage (U6–U8)
  • Zero-touch pre-screen per sub (Cobalt Talon or simple stack-detection heuristic in v1)
  • Assign lane (authored-stack fast / not-yet-authored manual) + mode (self-serve / concierge)
  • Prioritize by contract-value-at-risk; group into waves
  ↓
Invite wave (U9): send branded links; track open / in-progress / complete per sub
  ↓
Prime roll-up board updates in real time as StatusPayloads arrive (U17–U22)
  • RAG by sub (red/amber/green)
  • Family heatmap: which control families are systemically failing across the tier
  • Risk register: subs ranked by value_at_risk × gap severity
  • Days-to-ready overlay vs. prime milestones
  • Drill-down: prime clicks a sub → sees its SubReadinessRecord
  • Export: PDF for program reviews; CSV for risk register
  ↓
Disposition per sub (U23–U25)
  • Ready → log, schedule re-assessment (cadence set at engagement scope)
  • Borderline / critical → BHD validation pass (reviewer samples evidence, upgrades rung)
  • Not ready → optional: offer enclave conversion (EnclaveConversion → Tier 2 bridge to CES Stamper)
  ↓
Continuous assurance (U26–U29)
  • Scheduled re-assessment triggers per cadence (annual / quarterly per prime SLA)
  • Drift detection: delta between successive SubReadinessRecords; alert on new-red
  • FCA stay-current snapshot: timestamped, signed posture per sub, exportable
  • Expansion: add subs, next program, loops to roster step
```

**Party-scoped access rules:**
- Prime: reads/writes its own Engagement; sees SubReadinessRecord summaries for its subs; cannot see raw facts.
- Sub: sees only its own assessment and result.
- BHD operator: sees all engagements, all subs, all facts; can perform validation pass.
- Assessor: read-only on one sub's evidence package (explicitly granted by BHD per engagement).

---

### 7.1 Engagement Orchestration & Nudging

The prime flow above tracks completion state per sub but has no active process-management layer.
This subsection specifies the nudging engine that moves subs through their lifecycle without operator
hand-holding, surfaces stalls to the prime, and ensures the roll-up board is a process dashboard —
not only a readiness-score board.

#### 7.1.1 Sub Engagement Lifecycle (state machine)

Each sub in an Engagement moves through a defined set of states stored in `SubEngagementRecord.state`:

```
invited
  │  (sub opens the branded link)
  ▼
opened
  │  (sub submits scope-lite answers / starts interview)
  ▼
in_progress
  │  (sub completes all questions + review + submits StatusPayload)
  ▼
complete ──────── (StatusPayload received; no further nudges sent)
  │
  │  [cadence elapsed since assessed_at]
  ▼
reassessment_due  (completion_state resets; new invite cycle begins)

Stall transitions (orthogonal — set when inactivity thresholds breach):
  invited       + N_open days without opening        → stalled_unopened
  in_progress   + N_active days without last_activity → stalled_in_progress
  stalled_*     + N_escalate days without progress    → escalated
```

**Threshold defaults (all configurable per Engagement at scope-definition time, U3–U5):**
- `N_open` = 3 days — invited but not opened → stalled_unopened
- `N_active` = 7 days — opened or in_progress with no activity → stalled_in_progress
- `N_escalate` = 14 days — stalled without any progress → escalated

**Tie to existing `completion_state`:** `QuestionGraph.completion_state` (`in_progress` / `complete` / `abandoned`)
reflects the sub's assessment session state. `SubEngagementRecord.state` is the engagement-level state
and is the source of truth for nudging and the roll-up. They are kept in sync: when `completion_state`
transitions to `complete`, `SubEngagementRecord.state` transitions to `complete` automatically;
`abandoned` maps to `stalled_in_progress` (no re-entry yet).

#### 7.1.2 Automated Nudge Engine

**Mechanism:** a scheduled worker job (`nudgeWorker.ts`) runs on a configurable cadence (default:
every 6 hours) in `muster-api`. On each run it queries all `SubEngagementRecord` rows that are not
in state `complete` or `reassessment_due`, evaluates thresholds, and dispatches nudge emails via a
`NotificationService` interface (`notificationService.ts`). Phase 1 implementation: SendGrid (or
equivalent transactional email provider); the interface is injected so the provider can be swapped.

**Nudge cadence (T = `invited_at` timestamp):**
- T+3: first reminder — "Your readiness assessment is ready. It takes about 20 minutes." (sent if state is `invited` or `stalled_unopened`)
- T+7: second reminder (sent if still not `complete` or `in_progress`)
- T+14: final reminder + escalation flag set (sent if still not `complete`)
- Auto-stop: no further automated nudges once `state = complete`. Reassessment cycle resets the clock.

**Per-engagement cadence configuration** (set at U3–U5 scope definition, stored on `Engagement`):
- `nudge_days: number[]` — override the T+3/7/14 defaults (e.g. `[2, 5, 10]`)
- `quiet_hours: { start: string; end: string; tz: string }` — do not dispatch during this window (e.g. 20:00–08:00 local prime time)
- `max_nudges: number` — hard cap per sub per cycle (default: 3); once reached, escalate but do not email

**Manual nudge:** the prime or BHD operator can trigger an out-of-cycle "Send nudge now" action on
any non-complete sub from the roll-up board (U17–U22). This dispatches a single email immediately,
increments `nudge_count`, and updates `last_nudge_at`. It does not reset the automated schedule.

**Framing:** all nudge emails contain only: prime-branded header, plain-language "complete your
readiness check" message, the sub's unique resume link, and an opt-out / contact link. No CUI,
no config details, no scores, no threat language. The framing is completion support, consistent
with the non-coercion stance.

**Phase 0 (concierge) equivalent:** there is no automated nudge engine in Phase 0. The BHD operator
maintains a manual worklist (exported from `StaticRollup.tsx` as a CSV of pending subs with
`last_activity_at` and `invited_at` timestamps) and performs outreach directly (phone / email).
The worklist CSV export is the Phase 0 process-management artifact.

#### 7.1.3 Escalation

When `state = escalated` (sub stalled past `N_escalate` threshold):
1. The sub's row in the roll-up board is flagged with a visual "escalation" indicator (distinct from
   the standard amber/red RAG color).
2. A daily digest email is sent to the prime contact (and BHD operator) listing all escalated subs:
   sub name, days stalled, last activity, value-at-risk tier.
3. The prime can take action (direct outreach, waive, or mark as `abandoned`) from the roll-up board.
   The BHD operator has the same controls.
4. Framing in the digest: "These subs have not completed their assessment. Your outreach may help."
   No coercive language; no implication of contractual penalty by Muster.

#### 7.1.4 Prime-Facing Engagement Progress View

The `rollup/` feature is extended with an **Engagement Progress tab** alongside the existing
readiness-score board. This is a process dashboard, not a replacement for the RAG/heatmap view.

**Counts panel** — by lifecycle state:
- Invited / Stalled (unopened) / In progress / Stalled (in progress) / Escalated / Complete / Reassessment due

**Stalled & Overdue worklist** — a sortable table of all non-complete subs showing:
- Sub name, UEI, wave, state, days in current state
- `last_contacted` (= `last_nudge_at` or manual outreach timestamp)
- `next_nudge_at` (computed by the worker; shown as a local timestamp)
- Value-at-risk tier (from triage)
- Actions: "Send nudge now", "Mark abandoned", "View sub record"

**Response-rate and timing metrics:**
- Open rate: % of invited subs who reached `opened` within N_open days
- Completion rate: % who reached `complete`
- Median days invite → complete for the engagement
- Days-in-stage distribution (histogram per state)

**Per-sub activity timeline** (accessible from the sub drill-down, U23–U25 disposition pane):
- Ordered list of `NudgeEvent` entries: event_type, timestamp, channel, outcome
- Lifecycle state transitions with timestamps
- Visible to prime (events only, no raw facts) and BHD operator (full record)

#### 7.1.5 Privacy and Compliance

- Nudge emails contain no CUI, no configuration details, no scores. Only: completion prompt + resume
  link + opt-out.
- Opt-out: every nudge email includes a one-click opt-out link. Setting `SubEngagementRecord.opted_out = true`
  immediately stops all automated nudges to that sub. Manual nudges are also blocked when `opted_out = true`.
  The opt-out state is visible on the roll-up worklist; the prime sees it as "opted out" status.
- Contactability: nudge emails are sent only to the contact address provided at invite time (stored
  in `SubEngagementRecord.contact_email`). No derived or scraped addresses.
- Least-data framing: `NudgeEvent` log stores event type, timestamp, channel, and delivery status —
  no email body content is persisted.
- Reuses the existing non-coercion + least-data framing from the base plan: the system facilitates
  completion; it does not threaten or penalize.

---

## 8. Phased Delivery

### Phase 0 — Concierge MVP (4–6 weeks, zero backend)

**Goal:** prove the assessment and sub UX with real subs; validate confidence calibration; measure
on-prem/OT share for the C-gate decision.
**Ships:**
- Muster Web (Vite + React SPA, Dexie session only)
- Scope-lite wizard (reusing SIT wizard pattern), including the on-prem/OT stack-intake question
  (see §6 step ①) — this is the measurement instrument for the Phase 2 C-gate
- Approach B adaptive interview: fixed question graph (pre-computed from CMMC L2 intent pack, no
  AI next-question yet), "I'm not sure" maps to 'unknown'
- `deriveActionStatuses()` vendored copy wired to Planner's M365 playbook for authored-stack subs
- StatusPayload JSON export (downloaded by sub, imported manually by BHD operator)
- Static React roll-up page (`StaticRollup.tsx`) — loads exported JSONs from local directory,
  renders prime board (RAG, family heatmap, risk register); this is the sole Phase 0 prime deliverable
- **Engagement orchestration (Phase 0 equivalent):** `StaticRollup.tsx` exports a pending-subs CSV
  (sub name, `invited_at`, `last_activity_at`, state). The BHD operator works this list manually —
  phone and mail-merge outreach. No automated nudge engine; no `nudgeWorker.ts`. The worklist CSV
  is the Phase 0 process-management artifact (§7.1.2 Phase 0 note).
**Deferred:** backend, auth, multi-tenancy, AI copilot, API consent, snippets, continuous re-assessment,
automated nudging.
**Gate to Phase 1 (both criteria must be met):**
1. At least 5 real subs assessed with at least 50 interview-derived ConfigFacts total.
2. Confidence calibration PASS: high-confidence facts ≥ 85% correct on advisor-verified sample;
   medium-confidence facts ≥ 65% correct (per §5.5 calibration baseline procedure).
   If either bar is not met, prompt guardrails are tightened and calibration is re-run.

### Phase 1 — A + B with Backend (8–12 weeks)

**Goal:** production multi-tenant platform; A + B Router; AI copilot live.
**Ships:**
- `muster-api` backend: Prisma + PostgreSQL, JWT auth, party-scoped RBAC
- Approach A: Microsoft GCC High Graph probe suite (reference: readiness-evaluator prototype);
  OAuth read-only consent flow; Capability Probe SDK v1
- Approach B: AI-driven adaptive interview — Claude API for config interpretation + information-gain
  next-question selection; hard guardrails (no invented findings)
- Real-time prime roll-up board (React, TanStack Query)
- Invite flow with branded email links
- Save/resume with session tokens persisted in backend
- SAM.gov roster import (CSV + UEI lookup)
- SPRS score (standalone implementation in `sprsCalc.ts`; DoD methodology v1.2.1; no ces-eo import — see §3)
- **Engagement orchestration (Phase 1 — automated):**
  - `SubEngagementRecord` table in Postgres; lifecycle state machine (§7.1.1)
  - `nudgeWorker.ts`: scheduled job (cron every 6 hours); stall detection (N_open/N_active/N_escalate thresholds); T+3/7/14 automated email cadence
  - `notificationService.ts`: SendGrid provider; injected interface
  - `NudgeEvent` log table (immutable; least-data: no body stored)
  - `NudgeCadenceConfig` per Engagement (configurable at U3–U5 scope definition)
  - Manual "Send nudge now" action on roll-up board; opt-out link in every email
  - Escalation digest to prime contact + BHD operator (daily; subs in `escalated` state)
  - `EngagementProgress.tsx` tab on prime roll-up board: state counts, stalled worklist,
    last-contacted / next-nudge timestamps, response-rate metrics, per-sub activity timeline
**Gate to Phase 2:** measure on-prem/OT share of actual cohort-1 sub roster.

### Phase 2 — C + Full Router (6–10 weeks, gated by cohort data)

**Decision rule:** measured via the scope-lite on-prem/OT stack-intake question collected in Phase 0
and Phase 1 (§6 step ①). If > 30% of cohort-1 sub responses answer "yes" or "unsure" to the
on-prem/OT question, Approach C proceeds; otherwise it is deferred to Phase 3.
"Unsure" counts toward the threshold (conservative); the BHD operator reviews unsure responses
before the gate decision. The measurement is taken from the first 20+ sub records available.
**Ships:**
- Approach C: CaptureRecipe library (AD, file-server, endpoint config-dump scripts — signed, read-only);
  ingestion pipeline (parse / LLM-extract); artifact store integration
- Full per-objective Router logic (A → C → B cascade)
- Snippet presentation UI with trust context (what it reads, hash, how to run)
- Evidence package export for C3PAO / assessor
- SAM sub-award discovery (programmatic sub-tier detection)
- Continuous re-assessment scheduler + drift alerts

### Phase 3 — Expansion (ongoing)

- Additional vendor playbooks: Google Workspace, AWS GovCloud, PreVeil (content, not architecture)
- Additional intent packs: FedRAMP, CMMC L1, SOC 2 (content, not architecture)
- Per-fact confidence telemetry dashboard (BHD internal: pricing basis + moat instrument)
- Tier 4: Cortex AI overlay (supply-chain risk analytics)

---

## 9. File / Module Inventory

| File / module | Action | Purpose |
|---|---|---|
| `scre-muster/apps/muster-web/` | CREATE | React 18 + Vite + TS front end |
| `muster-web/src/features/engage/` | CREATE | Engagement setup + roster (U1–U5) |
| `muster-web/src/features/triage/` | CREATE | Cohort triage + lane/mode assignment (U6–U8) |
| `muster-web/src/features/collection/interview/` | CREATE | Approach B: QuestionGraph + AI copilot |
| `muster-web/src/features/collection/harvest/` | CREATE | Approach A: OAuth consent + probe runner |
| `muster-web/src/features/collection/capture/` | CREATE | Approach C: snippet presenter + ingestion |
| `muster-web/src/features/rollup/` | CREATE | Prime roll-up board + heatmap |
| `muster-web/src/features/disposition/` | CREATE | Sub disposition + enclave bridge |
| `muster-web/src/features/assurance/` | CREATE | Continuous re-assessment scheduler |
| `muster-web/src/shared/types/muster.ts` | CREATE | All Muster domain types (§4.1) |
| `scre-muster/apps/muster-api/` | CREATE | Node + Express backend |
| `muster-api/src/services/intentCompiler.ts` | CREATE | GeneralizedIntent → QuestionGraph |
| `muster-api/src/services/router.ts` | CREATE | Per-objective A/B/C routing decision |
| `muster-api/src/services/factLedger.ts` | CREATE | Provenance + confidence merge |
| `muster-api/src/services/derivation.ts` | CREATE | Vendored copy of `deriveActionStatuses()` (see §5.4) |
| `muster-api/src/services/sprsCalc.ts` | CREATE | Standalone SPRS score (DoD methodology v1.2.1; no ces-eo import) |
| `muster-api/src/services/probeRunner.ts` | CREATE | Approach A: Capability Probe SDK |
| `muster-api/src/services/snippetEngine.ts` | CREATE | Approach C: recipe authoring + ingestion |
| `muster-api/src/services/rollupAggregator.ts` | CREATE | ConfigFacts → SubReadinessRecord → RollUp |
| `muster-api/prisma/schema.prisma` | CREATE | DB schema (Engagement, Sub, Assessment, ConfigFact, Artifact…) |
| `muster-api/src/auth/` | CREATE | JWT middleware + party-role RBAC |
| `scre-muster/packages/muster-shared/` | CREATE | Shared TS types (both web + api) |
| `scre-muster/packages/muster-knowledge/` | CREATE | Vendored copies of knowledge banks (data/, schemas/, src/services/); no symlinks; see §3 |
| `scre-muster/packages/muster-knowledge/KNOWLEDGE_VERSION.md` | CREATE | Pinned CES commit + sync date |
| `muster-api/src/services/DERIVATION_VERSION.md` | CREATE | Pinned CES commit + copy date + parity checklist |
| `muster-web/src/features/rollup/StaticRollup.tsx` | CREATE | Phase 0 static prime roll-up page (loads local JSON exports) |
| `muster-web/src/features/rollup/EngagementProgress.tsx` | CREATE | Phase 1 engagement process dashboard: state counts, stalled worklist, response-rate metrics, per-sub activity timeline (§7.1.4) |
| `muster-api/src/services/nudgeWorker.ts` | CREATE | Phase 1 scheduled job: queries SubEngagementRecord rows, evaluates stall thresholds, dispatches nudge emails via NotificationService, logs NudgeEvent rows (§7.1.2) |
| `muster-api/src/services/notificationService.ts` | CREATE | Phase 1 injectable notification provider interface; concrete implementation: SendGrid transactional email; interface allows future provider swap (§7.1.2) |
| `muster-shared/src/types/engagement.ts` | CREATE | SubEngagementRecord, NudgeEvent, NudgeCadenceConfig, EngagementState types (§4.1 additions) |
| `ces-planner/` | READ-ONLY | Never edit; reference implementation only |
| `ces-shared/` | READ-ONLY | Never edit; knowledge banks consumed via vendored copy only |
| `.github/workflows/knowledge-drift.yml` | CREATE | CI job: diffs muster-knowledge against CES source on every build; fails with warning on change |
| `.github/workflows/derivation-drift.yml` | CREATE | CI job: diffs vendored derivation.ts against CES source; fails with warning on change |
| `infra/azure/` | CREATE | Phase 1 deployment: Azure App Service (muster-api) + Azure Static Web Apps (muster-web) + Azure Database for PostgreSQL Flexible Server + Azure Blob Storage; Bicep templates; US East region |

---

## 10. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| **[TOP RISK] Score accuracy / FCA liability** — a Muster SPRS readiness score is used by a sub in a government self-attestation; if later found incorrect, it creates False Claims Act exposure for the sub and potentially for BHD | Legal catastrophe; product shutdown | (1) Label all outputs "SELF-ASSESSED READINESS INDICATOR — NOT a CMMC certification, not a formal self-attestation, not legal advice. Engage a C3PAO for formal assessment." Shown on result screen, PDF, and API response. (2) Conservative score (unknowns = fail) always shown alongside primary score. (3) Per-fact provenance + confidence always visible. (4) "Unknown is never a pass" enforced in derivation. (5) Low-confidence/high-weight facts flagged in HIL queue; sub sees them before submitting. (6) BHD legal reviews disclaimer language before Phase 1 launch. |
| **Trust / consent for Approach A** — subs won't grant read-only API access | A path unusable; fall back to B only | Make consent optional at invite; show exact scopes (minimum set; no Directory.Read.All); prime logo shown on consent screen; consent-decline falls back silently to B with source_mix.machine = 0; concierge MVP proves value before A is required |
| **Confidence calibration (Approach B)** — AI overstates confidence; scores inflate | Score reliability collapses; pricing and HIL routing break | Prompt-level guardrails enforce three-tier boundary (§5.5); Phase 0 generates calibration baseline with advisor verification; Phase 0 → Phase 1 gate is falsifiable (≥85% high, ≥65% medium accuracy required); conservative score shown always; unknowns stay unknown |
| **AI guardrails** — copilot invents a compliance finding | Legal / trust catastrophe | System prompt hard-codes prohibition; all AI-asserted facts tagged 'interview' with confidence ≤ medium; no fact can flip to 'met' without a supporting value; human reviewer sees all low-confidence / high-weight items |
| **Snippet trust on manufacturing layer (Approach C)** — owners won't run scripts | C moat unavailable for on-prem/OT | Scripts are **code-signed** with a BHD-issued code-signing certificate (Authenticode for PowerShell, SHA-256 hash displayed in UI). Sub verifies by comparing the hash in the UI to the hash shown in Windows Explorer (file properties). PowerShell execution policy instruction provided: `Set-ExecutionPolicy -Scope Process RemoteSigned`. Scripts are open-sourced on GitHub (read-only, no telemetry). "What it reads / does NOT do" plain-English callout in UI. Phase 1 concierge-assisted path tests acceptance before Phase 2 self-serve rollout. |
| **Backend lift** — multi-tenancy is the #1 engineering item | Blocks cohort + roll-up + continuous assurance | Concierge MVP (Phase 0) sidesteps entirely; Phase 1 builds it; Prisma + PostgreSQL is a known stack consistent with the CES ecosystem |
| **Derivation coupling** — `deriveActionStatuses()` expects SIBaseline shape | Breaking change if Planner refactors | Vendored copy (not live import); version stamp in `DERIVATION_VERSION.md`; parity checklist; CI drift monitor against upstream CES source (§5.4). |
| **Knowledge bank divergence** — Planner updates its playbook YAML / schemas | Muster's knowledge goes stale | Vendored copies in `muster-knowledge/` (no symlinks); CI diff job on every build; explicit sync procedure via `KNOWLEDGE_VERSION.md` (§3 inventory). |
| **Row-level security breach** — sub sees another sub's facts; prime sees raw facts | Trust collapse; compliance failure | Postgres RLS policies enforced at the database layer keyed to `party_id + tenant_id`; Express middleware validates JWT claims against `party_id` on every request; Prisma queries always include `where: { party_id: ctx.partyId }`. Four party scopes: `prime` (engagement summaries only, no raw facts), `sub` (own assessment only), `bhd_operator` (all), `assessor` (one sub's evidence package, explicitly granted per engagement). |
| **Encryption at rest** — DIB sub config facts exposed if storage is compromised | Compliance failure; data breach | PostgreSQL: encryption at rest enabled on the managed database service (Azure Database for PostgreSQL Flexible Server with customer-managed key or service-managed key). Object store: Azure Blob Storage with storage-service encryption. Deployment region: US East (Azure US region) to maintain data residency within the US. Confirmed before Phase 1 backend launch. |

---

## 11. Acceptance Criteria for This Plan

- [ ] Module name and top-level directory structure are defined and do not touch `ces/` in any way.
- [ ] Reuse-from-Planner inventory names exact file paths and functions; no edit to CES code is implied.
- [ ] All shared knowledge paths (`ces-planner/public/data/`, `ces-shared/src/data/`) are cited; no
  knowledge bank is forked; vendored-copy policy is specified.
- [ ] All Planner output artifact types (`ReadinessPosture`, `SIBaseline`, `DerivedActionStatus[]`)
  are mapped to Muster equivalents; schema interoperability to EvidenceOps SSP/POA&M/SPRS is preserved.
- [ ] Acquisition Router logic is specified per-objective with A → C → B cascade, explicit merge rules,
  and Phase-1 C-absent fallback behavior.
- [ ] Sub UX flow covers: invite → scope-lite → adaptive interview → snippet/harvest → review → result,
  with save/resume, "I'm not sure", confidence-gated HIL, OAuth decline fallback, session expiry recovery,
  and plain-language output including the FCA disclaimer.
- [ ] Prime flow covers: muster → triage (lane/mode) → invite → roll-up board → disposition → continuous.
- [ ] v1 = A + B; C and full routing are gated by the >30% on-prem/OT cohort-1 threshold measured via
  the scope-lite stack-intake question.
- [ ] Concierge MVP (Phase 0) is explicitly described as the zero-backend path; Phase 0 roll-up deliverable
  is the static React page (not a spreadsheet or script).
- [ ] Multi-tenant backend is specified (PostgreSQL + Prisma + JWT RBAC) with party-scoped access rules
  and RLS enforcement layer specified (Postgres RLS + Express middleware).
- [ ] Risks address: FCA/score accuracy (top risk), A consent, B confidence calibration, AI guardrails,
  C snippet trust, backend lift, derivation coupling, knowledge bank divergence, RLS breach,
  encryption at rest.
- [ ] Phased delivery shows clear, falsifiable gates between Phase 0 → 1 → 2.
- [ ] `ConfigFact.weight` field defined; HIL routing predicate compiles against the type.
- [ ] `intentCompiler.ts` algorithm specified (inputs, outputs, pruning logic, information-gain tie-break).
- [ ] Confidence calibration pass bar is stated numerically and is falsifiable.
- [ ] `deriveActionStatuses()` is a vendored copy with version stamp, parity checklist, and drift monitor.
- [ ] `SprsCalculator` is reimplemented standalone (no ces-eo import); rationale stated.
- [ ] Phase 1 deployment target named (Azure, US East region) with encryption-at-rest confirmed.
- [ ] **Engagement orchestration — state machine:** `SubEngagementRecord.state` transitions are
  implemented for all seven states (`invited` → `opened` → `in_progress` → `stalled_unopened` /
  `stalled_in_progress` → `escalated` → `complete` → `reassessment_due`); tie to
  `QuestionGraph.completion_state` is documented and enforced.
- [ ] **Nudge cadence fires:** `nudgeWorker.ts` dispatches automated emails at T+3, T+7, T+14 for
  non-complete subs; auto-stops when `state = complete`; respects `quiet_hours` and `max_nudges` cap.
- [ ] **Stall detection:** subs not opened within `N_open` days transition to `stalled_unopened`;
  subs with no `last_activity_at` update within `N_active` days transition to `stalled_in_progress`.
- [ ] **Escalation surfaces on roll-up:** subs in `escalated` state show a visual escalation flag
  distinct from standard RAG; prime contact receives a daily digest listing escalated subs.
- [ ] **Manual nudge action:** prime or BHD operator can trigger "Send nudge now" from the roll-up
  worklist on any non-complete, non-opted-out sub.
- [ ] **Opt-out respected:** setting `opted_out = true` (via email link) immediately stops all
  automated and manual nudge dispatch; opt-out state is visible on the roll-up worklist.
- [ ] **`EngagementProgress.tsx` dashboard:** shows counts by lifecycle state, stalled/overdue
  worklist with `last_contacted` and `next_nudge_at`, response-rate and days-in-stage metrics,
  and per-sub activity timeline (NudgeEvent log, readable by prime and BHD operator).
- [ ] **NudgeEvent log:** every nudge dispatch (automated or manual) produces an immutable
  `NudgeEvent` row; no email body content is stored.
- [ ] **Phase 0 process-management artifact:** `StaticRollup.tsx` exports a pending-subs CSV
  with `invited_at`, `last_activity_at`, and state columns; no automated nudge engine in Phase 0.
- [ ] **Privacy compliance:** nudge emails contain no CUI, no config details, no scores; only
  completion prompt + resume link + opt-out link; `contact_email` is invite-time address only.

---

## 12. Source Conflicts Noted and Resolved

| Conflict | Resolution |
|---|---|
| June 10 docs treat Planner repackaging as in-place (edit Planner); June 13–14 and Muster concept (June 16) treat SCRE as a new module reusing Planner by reference | **Later docs win:** SCRE is a new module (`scre-muster`); no edits to CES code. |
| June 10 engagement flow names "CES Planner" as the per-sub assessment tool directly; June 16 Muster concept replaces the Planner wizard with the adaptive interview | **Later docs win:** the adaptive collection experience (B interview + A harvest + C capture) replaces the Planner SIT/RRT wizard UX; `deriveActionStatuses()` remains as the derivation back-half. |
| June 13 recommends Approach A (M365) first; June 14 decision summary recommends A + B as v1 with C gated | **Later docs win (June 14 + June 16 confirm):** v1 = A + B; C is gated. |
| BHD-Planner-as-SCRE (June 10) defers multi-tenant backend to Phase 2; Muster concept (June 16) also defers but is more explicit about what must move to backend | **Consistent; later doc adds more detail:** plan follows June 16 specifics (cohort, roll-up, party-scoped RBAC in backend; per-sub collection can remain local-first during session). |
| §3 says "Exact import (or copy)" for `deriveActionStatuses()`; §10 says "Copy the function"; §9 says "read from ces/" | **Resolved (rev-2):** vendored copy only; no live runtime import from ces/; §5.4 governs. |
| §2.3 says "aggregate via script or spreadsheet" for Phase 0 roll-up; §8 says "basic prime roll-up in a React page" | **Resolved (rev-2):** Phase 0 deliverable is the static React page (`StaticRollup.tsx`); no spreadsheet aggregate. |
| §3 says "symlinks / copies" for muster-knowledge; §10 (rev-1) names symlinks as fragile | **Resolved (rev-2):** vendored copies only; no symlinks; CI drift job monitors upstream. |
| §5.1 HIL routing references `weight >= 3` but `weight` was absent from `ConfigFact` in §4.1 | **Resolved (rev-2):** `weight` field added to `ConfigFact` (1–5, derived from CMMC practice weight table). |
