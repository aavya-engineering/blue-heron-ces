# Evidence Ops -- Changes for 2026-04-20

## Theme: Directive Metadata Integration

Today's work added full directive provenance tracking to the evidence pipeline. Every evidence file produced by Stamper's Set B directive handlers (`document-absence`, `document-prohibition`, `manual`, `validate`, `implement`, `skip`) can now carry a `directiveMetadata` block that flows from evidence JSON files through the assessment pipeline into SSP generation, SPRS calculation, POA&M generation, and submission eligibility checks.

---

## New Files

| File | Lines | Purpose |
|------|-------|---------|
| `src/shared/types/directive.types.ts` | 101 | `DirectiveType`, `DirectiveReadiness`, `ExtendedDirectiveMetadata` interface, `isValidDirective()` guard, `toExtendedDirectiveMetadata()` converter |
| `src/shared/types/ssp.types.ts` | 21 | `DirectiveControlImplementation` -- extends `ControlImplementation` with `directive`, `directiveMetadata`, `sprsValue`, `sprsRationale` |
| `src/eo/generation/DirectiveNarrativeBuilder.ts` | 96 | Three static narrative templates: `buildDocumentAbsenceNarrative`, `buildDocumentProhibitionNarrative`, `buildPlatformInheritedNarrative` |
| `src/eo/ssp/DirectiveSprsCalculator.ts` | 233 | `calculateSprsValue()` maps directives to MET/NOT_MET/N/A; `verifyEvidenceRequirements()` downgrades MET when required fields are missing; `calculateScore()` aggregates |
| `src/eo/poam/DirectivePoamGenerator.ts` | 177 | `buildPoamList()` generates POA&M items for NOT_MET controls, splits into blocking vs eligible per 32 CFR 170.21 |
| `src/eo/submission/EligibilityChecker.ts` | 128 | Advisory eligibility check: score threshold (88), POA&M eligibility, directive data completeness |
| `src/shared/data/poam-eligibility.json` | 22 | Reference data for controls ineligible for POA&M per 32 CFR 170.21 (placeholder set) |

## Modified Files

### `@bhd-vfs/shared` (sibling package)

**`shared/src/types/evidence.types.ts`** -- Added `DirectiveMetadata` interface (8 fields: `control_id`, `directive`, `readiness`, `platform_inherited`, `enforcement_verified`, `narrative_stub`, `reasoning_trace`, `evidence_artifacts`).

**`shared/src/types/controls.types.ts`** -- Added optional `directiveMetadata?: DirectiveMetadata` field to `ControlAssessment` interface.

### `src/eo/evidence/StamperEvidenceLoader.ts`

- `StamperEvidence` interface gains optional `directiveMetadata` field
- `loadEvidenceForTenant()` now parses `parsed.directiveMetadata` from evidence JSON with defensive type coercion (checks `typeof rawDm.directive === 'string'` before attempting parse)
- New `toDirectiveMetadataMap()` returns `Map<controlId, DirectiveMetadata>` (first-write-wins per control)
- New `loadDirectiveMetadata()` validates directive values, throws on invalid
- New `enrichAssessmentWithDirectives()` batch-enriches an `AssessmentSnapshot` with extended metadata

### `src/eo/assessment/ControlAssessor.ts`

- `merge()` signature extended with optional `directiveMetadataMap` parameter
- Each `ControlAssessment` output now includes `directiveMetadata` from the map (when present)

### `src/eo/server/EoServer.ts`

- Assessment pipeline (`GET /api/assess`) now calls `evidenceLoader.toDirectiveMetadataMap()` and passes it to `assessor.merge()`
- SSE `assess_import` event includes `directiveMetadataCount`
- Post-assessment: runs directive-aware eligibility check via `DirectivePoamGenerator` + `EligibilityChecker`, emits `eligibility_report` SSE event (advisory only)

### `src/eo/server/validation-schemas.ts`

- Added `DirectiveMetadataSchema` Zod object for future validation of incoming directive metadata payloads

### `src/eo/generation/SnippetTemplateEngine.ts`

- New `renderDirectiveNarrative()` method dispatches to `DirectiveNarrativeBuilder` for `document-absence`, `document-prohibition`, and `manual+platform_inherited` directives; returns `null` to fall through to existing templates for `implement`/`validate`/`skip`

### `src/eo/ssp/SnippetDataResolver.ts`

- New `resolveDirectiveNarrative()` method returns a `ControlNarrative` for directive-specific controls, or `null` to fall through to manifest/mission-plan resolution

### `src/eo/ssp/SspGenerator.ts`

- Control implementation loop now checks for directive metadata, calls `isValidDirective()` + `toExtendedDirectiveMetadata()`
- Directive-specific narrative override via `snippetResolver.resolveDirectiveNarrative()` (fallback chain step 1)
- `DirectiveSprsCalculator` computes SPRS value per control; `verifyEvidenceRequirements()` downgrades MET to NOT_MET when required fields are missing
- Output type changed from `ControlImplementation` to `DirectiveControlImplementation` with `directive`, `directiveMetadata`, `sprsValue`, `sprsRationale` fields

---

## Data Flow Summary

```
Stamper evidence JSON
  -> StamperEvidenceLoader.loadEvidenceForTenant()  [parses directiveMetadata]
  -> toDirectiveMetadataMap()                        [Map<controlId, DirectiveMetadata>]
  -> ControlAssessor.merge()                         [attaches to ControlAssessment]
  -> SspGenerator.generate()                         [narrative override + SPRS calc]
  -> DirectivePoamGenerator.buildPoamList()          [POA&M for NOT_MET controls]
  -> EligibilityChecker.checkEligibility()           [advisory submission gate]
```

## Backward Compatibility

All additions are optional. Evidence files without `directiveMetadata` parse normally. `ControlAssessment.directiveMetadata` is `undefined` when no directive provenance exists. SSP generation falls through to existing template logic when no directive metadata is present.

## Verification

- `npx tsc --noEmit` -- clean compile, zero errors (both `shared` and `eo` packages)
