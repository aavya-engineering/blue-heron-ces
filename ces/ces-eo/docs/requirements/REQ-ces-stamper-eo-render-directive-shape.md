# REQ — ces-stamper: emit `eo_render_directive` in the shape EvidenceOps parses

- **Filed by:** ces-eo (W4-EO3, 2026-09-27)
- **Target:** ces-stamper (`src/server/routes/execute.routes.ts`, `DOC_RENDERABLE_CONTROLS`, ~lines 1160–1340)
- **Status:** ANSWERED (2026-09-27, FC-EO-A) — ces-stamper's live `EO_RENDER_DIRECTIVES`
  (`ces-stamper/src/evidence/eoRenderDirective.ts`, commit `W4-ST4`/`97180ec`) now writes
  `directive_code` (e.g. `EO_RENDER_SIA` for `CM.L2-3.4.4`) exactly as asked below, with
  `input_sources: ['entra_audit_logs']` — no `code`/`change_log` shape remains. EO's
  `StamperEvidenceLoader.ts:87-96` parses it unmodified via `RenderDirectiveSchema`.
  End-to-end proof: `tests/unit/rendering/render-pipeline.test.ts`'s "EO-19: RenderOrchestrator
  end-to-end" suite drives a real Stamper evidence fixture (`directive_code: 'EO_RENDER_SIA'`,
  `input_sources: ['entra_audit_logs']`) through `StamperEvidenceLoader` → `RenderOrchestrator`
  → `SiaFromChangeLogRenderer`, asserting `state: 'rendered'`.

## Problem
Stamper writes `eo_render_directive` as `{ code: '<control id>', artifact_type, artifact_version, input_sources, output_target, render_scope }`.
EvidenceOps parses it with `RenderDirectiveSchema` (`ces-eo/src/shared/types/render.types.ts`), which requires
`directive_code` (one of the `EO_RENDER_*` codes in `DIRECTIVE_CODES`) and has no `code` field. Every directive Stamper
writes therefore fails the parse in `StamperEvidenceLoader` (logged as "Invalid eo_render_directive") and no render job
is created from real Stamper output.

## What EO has done (W4-EO3)
EO now resolves every input source Stamper names (`entra_password_policy`, `entra_audit_logs`,
`intune_app_control_policies`, `unified_audit_log`, `pipeline_not_sat_findings`, `manual_gate_items`,
`pipeline_control_narratives`, `evidence_manifests`, `defender_for_cloud_findings`) from real data
(`tests/unit/rendering/input-source-providers.test.ts`). The directive itself is the remaining break.

## Ask
Emit `directive_code` with the EO code for each control (or agree a shared contract in ces-shared), e.g.
IA.L2-3.5.8 → `EO_RENDER_PASSWORD_REUSE_POLICY`, CM.L2-3.4.4 → `EO_RENDER_SIA`, CM.L2-3.4.8 → `EO_RENDER_DENY_BY_EXCEPTION_POLICY`,
AU.L2-3.3.6 → `EO_RENDER_AUDIT_REDUCTION_REPORT`, CA.L2-3.12.2 → `EO_RENDER_POAM`, CA.L2-3.12.4 → `EO_RENDER_SSP`,
RA.L2-3.11.2 → `EO_RENDER_VULN_SCAN_REPORT`. Keep `input_sources` as they are (EO accepts them).

## Acceptance
A Stamper evidence file written by the document-renderable path parses with EO's `RenderDirectiveSchema`
(a cross-repo contract test, ideally in ces-shared).
