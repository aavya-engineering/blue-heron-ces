# Implementation Log — T3: Evidence Package Export

**Date:** 2026-07-07
**Plan Reference:** G-MUSTER-P2 Slice T3 (DONE-WHEN #6)

## Files Created

- `public/schemas/evidence-package.schema.json` — JSON Schema draft-07; required fields: package_version, generated_at, party, session_id, fca_disclaimer, facts, posture_summary; additionalProperties: false throughout; sprs nullable via anyOf; artifacts optional array; sha256 minLength:64.
- `src/features/export/evidencePackageService.ts` — exports FCA_DISCLAIMER constant, sha256Hex (async, crypto.subtle), buildEvidencePackage (async), validateEvidencePackage (AJV, same idiom as statusPayload tests), exportEvidencePackage (build → validate-or-throw → blob download).
- `src/features/export/__tests__/evidencePackage.test.ts` — 7 tests, @vitest-environment node; covers round-trip schema validation with mixed-provenance facts, FCA disclaimer exactness (DONE-WHEN #6), missing-disclaimer and missing-provenance rejections, sha256 correctness for known string "hello", artifact hash embedded in package, and additionalProperties rejection.
- `docs/WIRING_T3.md` — one paragraph on ResultScreen button wiring (deferred).

## Test Counts

- New tests added: 7 (evidencePackage.test.ts)
- Full suite: 197 tests / 24 files — all pass
- ESLint: zero warnings/errors on src/features/export/
- Build: tsc + vite build green

## Deviations from Plan

- `posture_summary.control_status_summary` in the evidence package schema omits `level` (present in ReadinessPosture and in StatusPayload). The task spec lists only {met, partial, not_met, unknown} for this sub-object. Decision: follow the spec; level is not copied. Logged as intentional divergence from the StatusPayload precedent.
- Artifact sha256 when `embedded_content` is absent: hashes the empty string (`e3b0c...`). The task spec does not define this case; the test exercises the non-empty path only. Minimal-footprint decision.
- `sprs` nullable: implemented via `anyOf [{type: object, ...}, {type: null}]` rather than `type: ["object","null"]` to avoid AJV v8 strict-mode edge cases with `required` on a union-typed field.

## Open Items

- None. ResultScreen wiring described in docs/WIRING_T3.md; deferred per task instructions.
