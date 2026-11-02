# ces-shared

The shared spine of the CES monorepo. `ces-shared` is infrastructure, not a
product: it holds **no** compliance/product logic. It provides the single
persistence layer, deterministic hashing, the stack-provider config seam, shared
types + config validation, and the `ces-ui.css` design system that the CES apps
build on.

## Purpose

- **`CesRepository`** — one SQLite-backed (`better-sqlite3`) read/write/update/delete
  interface for every persistent CES object, replacing scattered raw-JSON files.
  Records are keyed by `collection` + `id`; every read/update/delete must name a
  `CesScope`, so unscoped (cross-tenant leak-prone) reads are impossible.
  NODE-ONLY — do not import from FE/browser code. See
  `docs/adr/ADR-002-unified-persistence.md`.
- **`canonicalSha256`** — deterministic SHA-256 over canonical JSON (object keys
  sorted recursively), so logically-equal objects hash identically. Used for
  evidence integrity and param-binding equality.
- **Stack seam** — a `StackRegistry` of `StackProvider`s (Microsoft GCC High is
  the reference; Google Workspace + an example stub also register). Consumers
  resolve the active provider from config rather than hardcoding endpoints.
- **Shared types + config validation** — the `types/*` type modules plus
  `validateCesConfig` / `resolveCesIdentity` / `TenantConfig`, and the reference
  data sets (CMMC L2 controls, assessment objectives, SPRS weights, personas).

This is workspace-internal (`"license": "PROPRIETARY"`, not published to npm).

## Consumed by

`ces-stamper`, `ces-eo`, `ces-ao`, `ces-planner` — all as the `ces-shared`
workspace dependency via the subpath `exports` below.

## Build

```bash
npm run build      # tsc && node scripts/copy-data.cjs  -> emits to dist/
```

Dependents build `ces-shared` first: the monorepo root `pretest` runs
`build:shared` (then `build:stamper`) before any tests, and `build:core` builds
shared ahead of the apps.

## Test

```bash
npm test               # vitest run
npm run test:coverage  # vitest run --coverage (@vitest/coverage-v8)
```

## Key exports / entry points

Import via package subpaths (resolved from `dist/`):

- `ces-shared/persistence/node` — `CesRepository`, `CesScope`, `CesScopeError`,
  `getCesDbPath` (scope-enforced persistence).
- `ces-shared/crypto` — `canonicalSha256`, `canonicalJsonStringify`.
- `ces-shared/stack` — `getActiveStackProvider`, `getStackProvider`,
  `defaultStackRegistry`, the provider modules (the stack seam).
- `ces-shared/config` — `TenantConfig`; `ces-shared/config/ces` —
  `validateCesConfig`, `resolveCesIdentity`, `CesIdentity`;
  `ces-shared/config/secrets` — `secretRef`.
- `ces-shared/storage`, `ces-shared/storage/node`, `ces-shared/storage/contract`
  — the pipeline storage stack (root resolution + contract seam).
- `ces-shared/types/*` — capture, controls, drift, eval, evidence, poam, policy,
  registry, signal, sprs, ssp, persona.
- `ces-shared/data/*` — CMMC L2 controls, assessment objectives, SPRS weights,
  personas, control-signal registries; `ces-shared/data/infra-manifest-example` — the
  golden m365_azure Infra Manifest Muster targets (W4-SH2).
- `ces-shared/http` — `createBearerAuthMiddleware` (service token; loopback trusted in dev).
- `ces-shared/http/principal` (W4-SH1) — **authenticated per-user request principal**:
  `requirePrincipal({ verifier, devPrincipal?, requiredRoles?, header? })` middleware +
  `getRequestPrincipal(req)` → `{ subjectId, upn, displayName?, roles, tenantId?, verified, source }`.
  The principal comes only from a signed token in the `x-ces-principal` header (keeps
  `Authorization` free for the service token), verified by `createHs256PrincipalVerifier`
  (local-only HS256; `signPrincipalToken` for local issuers/tests). It is stored in a private
  WeakMap — never read from body/query/request properties. Fail closed: no verifier and no
  `devPrincipal` ⇒ 401 everywhere. `devPrincipal` is explicit, loopback-only, marked
  `verified: false`; log `principalPostureLine(opts)` at startup.
- `ces-shared/types/evidence-catalog` (EVC.1) — evidence catalog types plus a zod
  mirror (`EvidenceCatalogSchema`, `parseEvidenceCatalog`) of
  `ces-shared/data/evidence-catalog-schema` (`src/data/evidence-catalog.schema.json`,
  JSON Schema 2020-12, the source of truth). Schema only: the catalog data (release
  log, released batches, NIST 800-171A examine lists, objective coverage buckets)
  lives in Planner at `ces-planner/public/data/evidence-catalog/` (DEC-8).
- `ces-shared/types/practice-id` (EVC.6) — `normalizePracticeId`; see below.

## Practice-id convention (R-4)

The controls reference (`src/data/cmmc-l2-controls.reference.json`) spells the 17
Level 1 practices with `L1` (`AC.L1-3.1.1`) and their objectives the same way
(`AC.L1-3.1.1[a]`). The CMMC Level 2 Assessment Guide v2.13 labels every practice
`L2` (`AC.L2-3.1.1`), and the evidence catalog's release 0 follows v2.13
(`practice_id_convention: "L2-guide-v2.13"`).

Code keys practices by NIST number, the part after the first dash: `AC.L1-3.1.1`,
`AC.L2-3.1.1`, `AC.L2-3.1.1#E01` and `3.1.1` all normalise to `3.1.1`
(`normalizePracticeId`). Pending a BHD decision on which spelling is canonical,
both forms resolve to the same entry; do not compare practice ids as raw strings.
`src/types/practice-id.test.ts` checks both forms for all 110 practices. Planner's
`src/shared/services/practiceReference.ts` (`toNistRef`) applies the same rule
with its own one-line helper.

## License

PROPRIETARY — BHD-EDC
