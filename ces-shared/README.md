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

## License

PROPRIETARY — BHD-VFS
