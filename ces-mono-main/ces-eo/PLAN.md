# PLAN

## Goal

Stabilize the restored SSP roadmap implementation on `recover/ssp-roadmap-modules` so Evidence Ops can build and run tests from the recovery clone, while keeping `origin/master` and the original dirty local `cse-eo` folder untouched.

## File Inventory

Allowed implementation files:

- `package.json`
- `package-lock.json`
- `src/eo/ssp/__tests__/AssetCategorizationEngine.test.ts`
- `tests/integration/live-assessment.test.ts`
- `src/eo/ingestion/__tests__/GraphAuthProvider.test.ts`
- `tests/unit/rendering/render-pipeline.test.ts`
- `src/eo/mapping/__tests__/SignalToControlMapper.test.ts`
- `src/eo/ssp/__tests__/SharedResponsibilityMatrixGenerator.test.ts`
- `src/eo/ssp/SharedResponsibilityMatrixGenerator.ts`
- `src/eo/ssp/AssetCategorizationEngine.ts`
- `src/eo/ssp/SectionTwoGenerator.ts`
- `src/eo/ssp/SnippetDataResolver.ts`
- `src/eo/generation/DirectiveNarrativeBuilder.ts`
- `docs/context/IMPLEMENTATION_LOG.md`
- `docs/context/CRITIQUE.md`

Allowed context/planning files:

- `docs/context/VAULT.md`
- `docs/context/MODULE_MAP.md`
- `docs/context/REVIEW.md`
- `docs/context/RESEARCH_SUMMARY.md`
- `docs/context/PLAN_APPROVAL.md`
- `PLAN.md`

No other files may be edited without updating this plan first.

## Steps

1. Update local dependency resolution if required so `@bhd-vfs/shared` installs from the sibling `../shared` package in this recovery clone.
2. Run `npm install`.
3. Run `npm run build` and fix only compile blockers inside the file inventory.
4. Run `npm test -- --runInBand` and fix only validation blockers inside the file inventory.
5. Prefer config/test fixes over production implementation rewrites.
6. Log commands, changes, and any deviations in `docs/context/IMPLEMENTATION_LOG.md`.
7. If validation is still not green, record remaining failures and classify them as tooling, stale assertions, fixtures, or product defects.

## Expected Surgical Fixes

- Replace Vitest usage in `AssetCategorizationEngine.test.ts` with Jest-compatible usage.
- Align Jest/ts-jest config with NodeNext/ESM and avoid source rewrites for `import.meta`.
- Add a test-local type assertion in `live-assessment.test.ts`.
- Mock GraphAuthProvider's process boundary and use syntactically valid certificate thumbprints in tests.
- Update stale expectations for directive code count and evaluator behavior only after observing current test output.
- Replace restored module-level `import.meta.url` path constants with deterministic repository-relative paths where Jest CommonJS transpilation cannot execute `import.meta`.

## Verification

Run:

```powershell
npm install
npm run build
npm test -- --runInBand
git status --short
```
