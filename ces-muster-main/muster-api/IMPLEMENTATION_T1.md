# Implementation Log — G-MUSTER-P2 Slice T1
**Date:** 2026-07-07
**Plan Reference:** G-MUSTER-P2 DONE-WHEN #2, #3 (partial), #8

## Files Created

### recipes/ library
- `recipes/entra-mfa-report/recipe.ps1` — read-only Entra CA + MFA registration capture
- `recipes/entra-mfa-report/manifest.json` — sha256: 4552b63a..., maps to iam-001
- `recipes/defender-av-status/recipe.ps1` — read-only Defender AV status capture
- `recipes/defender-av-status/manifest.json` — sha256: 348742f8..., maps to ep-002
- `recipes/bitlocker-status/recipe.ps1` — read-only BitLocker volume capture
- `recipes/bitlocker-status/manifest.json` — sha256: 19ea9af4..., maps to dp-001
- `recipes/INDEX.json` — signed index with manifest_sha256 for all three recipes

### muster-api/src/lib/
- `src/lib/recipeSigning.ts` — sha256Hex, signRecipe, verifyRecipe, RECIPES_DIR

### muster-api/schemas/
- `schemas/config-fact.schema.json` — ConfigFact JSON schema (draft 2020-12)

### muster-api/src/services/
- `src/services/recipeIngestService.ts` — ingest(), validateConfigFact(), SignatureError,
  concrete mappers for entra-mfa-report/defender-av-status/bitlocker-status

### muster-api/src/routes/
- `src/routes/recipes.ts` — GET /recipes, POST /recipes/ingest, DONE-WHEN #8 gate

### muster-api/tests/
- `tests/recipes.readonly.test.ts` — static read-only assertion, 7 tests
- `tests/recipes.ingest.test.ts` — signature + mapping + gate tests, 30 tests

### muster-api/
- `WIRING_T1.md` — wiring doc, includes app.ts mount instructions
- `IMPLEMENTATION_T1.md` — this file

## Recipe Hashes (computed with node:crypto, no placeholders)

| Recipe | Script SHA256 | Manifest SHA256 |
|--------|---------------|-----------------|
| entra-mfa-report | 4552b63ab14995c0d1b26b45b30c2d7e767f6e772f7d535bf2386444e59076fc | 0643f4c1c5dd55662a2ef5ae313fe27125a18f4591d895c2ea3c03efd0dd9ea6 |
| defender-av-status | 348742f88fe988ba370cc2cdb48d04bb3ae0862a0445076cd776fa3549651d00 | f2430122f224a2ca540c2c32ca78ff78ab7e7a4c4be24aeaaff3b675f027a67a |
| bitlocker-status | 19ea9af43e198a3dc3e10c51ee43a27070715d506315a68aa968ef1e89b36432 | 23b04e3f2ff2b28c1f7ef99ce51eff24b4a47dc94ba61996fc1842871037849a |

## Test Counts

- `recipes.readonly.test.ts`: 7 tests — all pass
- `recipes.ingest.test.ts`: 30 tests — all pass
- Existing suite: 144 tests — all still pass (1 skipped; pre-existing)
- `resync.contract.test.ts`: 0 tests — pre-existing suite load failure (SPA alias
  `@/shared/db/schema` unavailable in muster-api context); this file is untracked,
  added by a parallel critic agent, and was broken before T1 work began.
- **Total passing: 181** (144 pre-existing + 37 new)

## Deviations from Plan

1. **AJV not used** — `muster-api/package.json` does not include `ajv`. Per plan spec
   ("note the deviation"), `validateConfigFact()` is a typed structural validator in
   `recipeIngestService.ts` instead of AJV schema validation. The `config-fact.schema.json`
   is still committed as the authoritative schema definition. Unit tests for the validator
   are in `recipes.ingest.test.ts` §validateConfigFact.

2. **`import.meta.url` replaced with `__dirname`** — `muster-api` compiles to CJS
   (`"module": "NodeNext"` but no `"type": "module"` in `package.json`), so
   `import.meta` is not available. `RECIPES_DIR` in `recipeSigning.ts` uses `__dirname`
   instead. Tests (run by vitest/tsx) retain `import.meta.url` since they bypass tsc.

3. **Route-level "signature_invalid 400" test uses 404 proxy** — the route reads the
   manifest from disk, so we cannot inject a tampered manifest through the HTTP layer
   without writing to disk. The `400 signature_invalid` path is fully exercised in the
   ingest service unit tests (DONE-WHEN #2). The route test for this case verifies the
   `404 not found` branch (non-existent recipe_name) as a proxy for error routing.

4. **`signRecipe` does not write to disk** — the plan says "embeds in manifest"; the
   implementation returns the updated manifest object for the caller to persist if
   needed. Writing to disk is a separate concern (the committed files already have
   correct sha256 values).

5. **`bitlocker-status` empty array → 'no' fact** — plan says "ABSENT when output lacks
   the section". An empty array means the script ran but found no volumes. A 'no' fact
   is emitted (cannot confirm any volume is encrypted). An empty array is not treated
   as a missing section; a non-array object is ABSENT. This is the conservative FCA
   interpretation.

## Testing Notes

- All three recipe scripts verified statically (no forbidden tokens)
- All three recipe manifests verified against their scripts via verifyRecipe
- All three mapping functions tested positive, negative, and absent cases
- DONE-WHEN #2: tampered manifest (wrong sha256) → SignatureError, zero facts ✓
- DONE-WHEN #8: self-serve flag OFF + no concierge header → 403 ✓
- DONE-WHEN #8: with x-concierge-session: true header → 200 ✓
- DONE-WHEN #8: RECIPES_SELF_SERVE=true → 200 without header ✓

## Open Items

- App wiring: `app.ts` not touched per spec; see `WIRING_T1.md` for mount line
- DONE-WHEN #3 router (A→C→B per-objective) not in scope for T1
- DONE-WHEN #4–#9 router/export/annuity items are future slices (T2+)
- `[validate with BHD]` annotations in all three recipe.ps1 files flag cmdlet
  availability in target tenants for BHD review
