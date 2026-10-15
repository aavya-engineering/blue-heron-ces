# ADR-004 — Reserved stack capabilities: `vendorPlaybookId` & `techStackMapId`

**Status:** Accepted (G7) · **Date:** 2026-06-14 · **Relates to:** [ADR-003](./ADR-003-stack-provider-seam.md)

## Context
The G4 stack-provider seam (`StackCapabilities`, `ces-shared/src/stack/`) declares six capability
reference ids. A code-confirmed sweep (see `docs/ces-stack-lifecycle-dashboard.html`) found that four
are consumed and two are **declared but unconsumed**:

| Capability | Consumed by | Status |
|---|---|---|
| `cloudEndpoints`, `conventions` | Stamper, AdminOps, EvidenceOps | consumed |
| `controlSignalRegistryId`, `evaluatorSetId`, `sspNarrativeSourceId` | EvidenceOps | consumed |
| **`vendorPlaybookId`** | — | **unconsumed** |
| **`techStackMapId`** | — | **unconsumed** |

Both unconsumed ids are bound by the Microsoft provider (`microsoft-365`, `microsoft-tech-stack`) and by
the stub (`stub-empty`), but no code path resolves them. G7 raised the question: wire them now or defer.

## Decision
**Defer wiring `vendorPlaybookId` and `techStackMapId`; keep them in the contract.**

- They remain required fields in `StackCapabilities` (a stack still declares them), so the contract is
  stable and future-proof and the validator keeps enforcing them.
- No consumer is added until a concrete need exists:
  - `vendorPlaybookId` — would select a vendor remediation/playbook source. Today the Planner's task
    compilation and Stamper's command registry already encode Microsoft playbook content directly; there
    is no second vendor playbook to switch to, so a selector would be dead routing.
  - `techStackMapId` — would select a tech-stack→control mapping. The current mapping is Microsoft-only
    and lives in EO assets; no alternate map exists to route to.
- Wiring them now would be speculative indirection (YAGNI) with no behavior change and no test that could
  meaningfully exercise a second binding — exactly the "don't over-abstract" caution in ADR-003 §5.

## Consequences
- **Positive:** contract stays complete and ready; zero dead routing; the seam's consumed surface matches
  what subsystems actually need.
- **Negative / watch:** the two ids are "declared but inert" — documented here and in the dashboard so
  they are not mistaken for active behavior. When a real second vendor playbook or tech-stack map is
  authored, this ADR is superseded and the consumer is added then (the natural place: Planner task
  compilation for `vendorPlaybookId`; EO/Planner mapping for `techStackMapId`).
- No code change; no test impact.

## Trigger to revisit
Authoring any non-Microsoft vendor playbook **or** tech-stack→control map. At that point, add the
selector at the consumption point and update ADR-003's consumption matrix.

## G13 Review Note (2026-06-14)

G13 authored the `google-workspace-cloud` stack provider (minimal but real: real OAuth/Admin SDK
endpoints, one control-signal mapping `IA.L2-3.5.3`, one evaluator `google_2sv_enforced_evaluator`,
registry resolver, SSP leak guards). The trigger condition for wiring `vendorPlaybookId` or
`techStackMapId` was reviewed and **is not met**:

- `vendorPlaybookId = 'google-workspace-playbook'` — no Google vendor playbook content has been
  authored; no consumer has been added. Deferral stands.
- `techStackMapId = 'google-workspace-techstack'` — no Google tech-stack→control map has been
  authored; no consumer has been added. Deferral stands.

Both fields are declared in the `googleWorkspaceCloudProvider` as required by `StackCapabilities`
and pass `validateStackCapabilities` without error. Their ids are reserved for future content
authoring. This ADR is not superseded by G13.
