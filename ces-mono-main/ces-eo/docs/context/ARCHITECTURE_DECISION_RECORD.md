# Architecture Decision Record — Evidence Ops (EO) Counts and Coverage

> **Historical (W4-EO4, 2026-09-27).** The template and signal counts below are the plan at the time it was written. Measured today: 111 + 7 templates in use (111 control snippets in `src/eo/data/snippet-templates` plus 7 narrative templates in `src/shared/data/snippet-templates`); the superseded, never-loaded `src/eo/generation/templates` set was deleted (FC-EO-C EO-06, 2026-09-27); 85 of 110 reference controls have an automated (graph) signal (79 from the shared ces-shared registry + 6 from the EO-owned overlay added by FC-EO-D, 2026-09-28). Pinned by `tests/unit/claim-accuracy.test.ts`.

| Field              | Value                                               |
|--------------------|-----------------------------------------------------|
| **ADR ID**         | EO-ADR-001                                          |
| **Date**           | 2026-09-27                                          |
| **Status**         | Superseded (counts updated — see banner above)      |
| **Owner**          | Evidence Ops Engineering Team                       |
| **Related Test**   | `tests/unit/claim-accuracy.test.ts` (W4-EO4)       |

---

## Context

EvidenceOps (EO) generates System Security Plans (SSP) and evidence reports for CMMC Level 2 assessments. To prevent documentation drift, the W4-EO4 accuracy test pins the measured counts of:

1. **Control snippet templates** — loaded by `SnippetTemplateEngine` from `src/eo/data/snippet-templates`
2. **Narrative templates** — loaded by `DirectiveNarrativeBuilder` / `SectionTwoGenerator` from `src/shared/data/snippet-templates`
3. **Automated signal coverage** — the count of 110 reference controls that have at least one `graph` signal in the `ces-shared` control-signal registry

## Decision

- Template counts are pinned in the test; any change requires updating the test assertion AND this ADR.
- Signal coverage is measured against the `ces-shared/data/control-signal-registry.json` asset directly; no EO-local overlay is retained after FC-EO-H (2026-09-28).
- Historical documents referencing older numbers must carry the **Historical (W4-EO4...)** banner so the accuracy test can allow them through its STALE-pattern grep.

## Superseded Numbers (at time of writing)

| Metric                                | Historical Value | Current (pinned) |
|---------------------------------------|------------------|------------------|
| Control snippet templates             | 126              | 111              |
| Narrative templates                   | 7                | 7                |
| Automated signal coverage (of 110)    | 107/110          | 85 of 110        |

## References

- `tests/unit/claim-accuracy.test.ts` — live enforcement
- `docs/ssp-generator-action-plan.md` — companion historical document
- FC-EO-C (EO-06, 2026-09-27) — deleted `src/eo/generation/templates`
- FC-EO-D (2026-09-28) — promoted 6 EO overlay entries into `ces-shared` registry
- FC-EO-H (2026-09-28) — retired EO overlay; `ces-shared` 2.8.0 alone is authoritative
