# G-MUSTER-PLAN-2 M2 — Planner-generator port: work breakdown

**Date:** 2026-07-12. **Decision of record:** FD-PLANNER-OUTPUTS = port/vendor Planner's
generators into Muster under the drift-check discipline (not run Planner as a backend).
**Status:** slice 1 DONE (`172e3e5`, SI Baseline); slices 2-5 scoped below.

## The dependency reality (why this is multi-tick, not per-generator)

Planner's four output generators are pure and individually vendorable, but they do NOT take
raw Muster inputs — they take Planner's *compiled intermediate artifacts*. The dependency
DAG:

```
SIT answers ─► generateSIBaseline ──────────────► SIBaseline        [slice 1 DONE]
                                                       │
readiness posture ─► gapCompiler ─► GapSet ────────────┤
                                                       ▼
   assessorKB(YAML) + patterns/playbook(YAML) + techRefIndex + loeRateStore
                          │
                          ▼
                   compileTaskCatalog ─────────────► TaskCatalog     [THE bulk — ~2,400 LOC]
                                                       │
        ┌──────────────────────────────────────┬──────┴───────────────┐
        ▼                                       ▼                      ▼
 generateTenantManifest              generateManualPlan        (policy generators)
   (needs TaskCatalog + PlanMode        (needs TaskCatalog +      (needs policy intake
    + TCP/CUI/BTC)                        ReadinessPosture +        answers)
        │                                 assessorKB + vendorCaps)
        ▼                                       ▼                      ▼
 tenant_manifest [slice 3]         manual_mission_plan [slice 4]  policy docs [slice 5]

 generateInfrastructureManifest(SIBaseline, TCP) ─► infrastructure_manifest | null
   (null for m365_only — Muster's common case; Azure path needs a full Azure TCP) [slice 2]
```

**The gating dependency is `compileTaskCatalog`** (src/features/mpt/services/taskCompiler.ts,
~800 LOC) plus its chain: `gapCompiler.ts`, `sharedStepCompiler.ts`, `milestoneCompiler.ts`
(~2,400 LOC total). It pulls in:
- **YAML knowledge banks** (assessorKB = "Assessor Approach", plus Capability Taxonomy /
  Implementation Patterns / Evidence Archetype Catalog / Tech Stack Compliance Mapping) —
  vendorable as data, drift-checked, but several files.
- **`TechRefIndex`** service — a lookup over the tech-ref data (portable).
- **`useLoeRateStore`** (Zustand) — a STATEFUL store the compiler reads LOE rates from. Porting
  a store dep into a pure generator path needs a small refactor to pass rates as a parameter
  (do NOT vendor a live store into the scoring path).

## Input artifacts Muster does NOT produce today (the other blocker)

Planner builds these from dedicated wizards; Muster's readiness/discovery flow does not:
- **TenantConfigProfileOutput (TCP)** — needed by infra manifest + tenant manifest. Muster has
  stacks + facts; a *minimal* TCP is synthesizable for the m365 path, but the full Azure TCP
  (subscription, VNet CIDR, resource naming, WORM retention) is not collected.
- **ReadinessPosture in Planner's shape** — Muster HAS a posture (scoringService), but Planner's
  generateManualPlan expects `readiness_posture.requirement_results[]` with Planner's field
  shape. A mapping adapter is needed (small).
- **CUIBoundaryOutput / BTCConfirmationOutput** — optional to the generators (they accept
  null), so not blocking, but reduce output fidelity when absent.

## Slice plan (each its own tick, in dependency order)

- **Slice 1 — SI Baseline. DONE** (`172e3e5`).
- **Slice 2 — Infrastructure Manifest.** LOW VALUE STANDALONE: for Muster's M365-only default
  the correct output is `null`; the Azure path needs a full TCP Muster lacks. RECOMMENDATION:
  fold into slice 3 (build the minimal-TCP adapter once), do not ship a null-only slice.
- **Slice 3 — TaskCatalog compiler port + Tenant Manifest (THE big one, ~multi-tick).**
  1. Vendor the compiler chain (taskCompiler/gapCompiler/sharedStepCompiler/milestoneCompiler)
     + its type closure, drift-checked; refactor the loeRateStore read to a passed parameter.
  2. Vendor the knowledge banks (assessorKB + patterns/playbook/archetype/techstack YAML),
     drift-checked (Muster already vendors the ces-spine banks — same pattern).
  3. Build the Muster-posture → GapSet → TaskCatalog adapter.
  4. Vendor + drive generateTenantManifest + generateInfrastructureManifest.
  5. Gate: contract shape + parity vs Planner reference outputs (tenant-manifest_*.json).
- **Slice 4 — Manual Mission Plan.** Consumes the slice-3 TaskCatalog + a posture-shape adapter
  + vendorCaps. Vendor manualPlanGenerator (+ its ~16-file closure: planHelpers, taskCompiler,
  costModel, inlineCostBuilder, proposalGenerator, ...). Gate: parity vs
  manual-mission-plan_*.json (the artifact ces-tester already drives Stamper with).
- **Slice 5 — Policy docs.** Vendor policyProfileGenerator/policyRenderer; needs policy-intake
  answers (a Muster intake gap). Lowest priority.

## Recommendation to the founder

Slice 3 is the real M2 — a focused multi-tick port of Planner's compiler + banks, ~3,000+ LOC
plus several YAML files and one store refactor. It is tractable under the vendoring discipline
(Muster already vendors ces-spine the same way) but it is NOT a single-tick slice. Two viable
sequencings:
1. **Commit the multi-tick port now** (slices 3→4→5 back-to-back) — finishes gate (iii)'s plan
   half, the last big functionality block.
2. **Clear the smaller completable functionality first** (G-MUSTER-DISCOVERY-1, EO-STAB M3/M4,
   the stacksim FIDELITY tail) so breadth advances, then commit the compiler port as a
   dedicated block.

Either is defensible; the port's scale (not its direction — that's decided) is the reason to
name the choice explicitly rather than silently sink several ticks into it.
