# REQ-ces-eo-jest-shared-contract-mapper

**Target:** ces-eo (`package.json` → `jest.moduleNameMapper`) · **Filed:** 2026-09-27 · **Status:** OPEN
**Filed by:** ces-eo flow-through run, step E5 (AE-R2)

## Problem
E5 made `ces-eo/src` import `ces-shared/types/adminops-evidence` at runtime (reader, SspGenerator).
`ces-shared/dist` is ESM-only (`"type":"module"`); ts-jest runs ces-eo tests as CommonJS, so jest
cannot load the dist file ("Cannot use import statement outside a module"). Other runtime `ces-shared/*`
subpaths work in jest only because `package.json` maps them to `../ces-shared/src/...`.

## Required change
Add to `ces-eo/package.json` → `jest.moduleNameMapper`:

```json
"^ces-shared/types/adminops-evidence$": "<rootDir>/../ces-shared/src/types/adminops-evidence.contract.ts",
```

Then delete the interim shim `tests/__mocks__/ces-shared/types/adminops-evidence.ts`.

## Why not done in E5
`ces-eo/package.json` carries another session's uncommitted edit and is on the 09-27 untouchable list.

## Interim (committed with E5)
`tests/__mocks__/ces-shared/types/adminops-evidence.ts` — jest's automatic node-module mock slot,
containing only `export * from '<ces-shared/src contract>'`. It re-exports the **real** shared source,
so it is a resolution aid equivalent to the mapper, not a behavioural mock; no assertion is weakened.
Production (Node ESM) resolves the package export to `dist` as normal.

## Acceptance
Mapper line present, shim deleted, `npx jest --no-coverage --testPathIgnorePatterns eo-live-sim live-assessment`
still green with the same suite/test counts.
