# REQ: ces-shared: the built dist is missing data/sprs-weights.json, although the exports map names it

**Filed by:** ces-muster (FX2-MU2, 2026-09-27)
**Target module:** ces-shared
**Priority:** P2 (it blocks Muster from importing the SPRS weights directly instead of keeping a vendored copy)

## Finding
`ces-shared/package.json` exports `"./data/sprs-weights": "./dist/data/sprs-weights.json"`.
`ces-shared/dist/data/` does not contain `sprs-weights.json`; the source is in `src/data/`. The dist has the
other data JSONs, so the dist looks stale: `scripts/copy-data.cjs` has not run since sprs-weights was added.
Any consumer of `ces-shared/data/sprs-weights` (muster-api already depends on `ces-shared` via `file:`)
fails to resolve.

## Ask
1. Rebuild ces-shared (`npm run build`, which runs copy-data) so `dist/data/sprs-weights.json` exists.
2. Add a test or build check that every file in the `exports` map resolves to a file in dist.

## What Muster does meanwhile
Muster keeps two vendored copies of the weights (SPA and muster-api), plus a byte-parity check and a sync
tool: `src/vendored/cesSharedSync.ts`, test `src/vendored/__tests__/cesSharedParity.test.ts`, and
`npm run check:ces-shared` / `sync:ces-shared`. Once this REQ is fixed, muster-api can switch to
`import ... from 'ces-shared/data/sprs-weights'`. The SPA copy stays until the SPA's CI can see ces-shared,
because the SPA CI checks out ces-muster only.
