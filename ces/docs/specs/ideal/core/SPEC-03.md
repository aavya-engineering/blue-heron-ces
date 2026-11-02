# SPEC-03 — API & Contracts (v1.0)

## Intent

An API is a promise, and a contract is that promise written down in a form both sides can check.
This dimension exists so that every network- or module-facing surface is *versioned*, *schema-backed*,
and *validated on both ends*, and so that no consumer is ever broken by a silent change. It anchors to
recognized standards: **OpenAPI** for describing HTTP surfaces, **JSON Schema / Zod** for request and
response validation, **Semantic Versioning** for signalling compatibility, **RFC 9457 / RFC 7807
(problem+json)** for a uniform error shape, and **RFC 8594 (Sunset)** plus a stated deprecation policy
for retiring surfaces gracefully. The governing rule is simple and testable: no breaking change without
a major version bump, and no cross-module contract left in DRAFT once something in production depends
on it. Maturity levels follow the L0–L3 model in SPEC-00.

## Requirements

- **SPEC-03.R1 — Every HTTP surface carries a version.** Each externally reachable HTTP route exposes a
  version via path segment (`/v1/...`) or a version header (`Accept-Version`/media-type). *(Level: L2)*
  — **Verify:** a route test enumerates all registered routes and asserts each matches a version
  segment or is served under a versioned mount; an unversioned route fails the test.

- **SPEC-03.R2 — Published schema per request and response.** Every endpoint has a machine-readable
  request and response schema (OpenAPI operation, or a referenced Zod/JSON Schema). *(Level: L3)* —
  **Verify:** a schema artifact resolves for each endpoint; a check fails on any route lacking a
  request/response schema binding.

- **SPEC-03.R3 — Validated on both sides.** The server validates inbound requests and outbound
  responses against the schema, and consumers validate against the same schema via contract tests.
  *(Level: L3)* — **Verify:** a contract-test tier exists (producer + consumer); server middleware
  rejects schema-invalid input with a structured error; an intentionally malformed payload is rejected
  by the test.

- **SPEC-03.R4 — Uniform error model.** Errors are returned in one consistent structured shape (code +
  message + details), aligned to problem+json (RFC 9457/7807). *(Level: L2)* — **Verify:** error
  responses validate against a single error schema; a test hitting a known failure path asserts the
  shape and a stable `code` field.

- **SPEC-03.R5 — No breaking change without a major version bump.** The API follows SemVer; a
  backward-incompatible change (removed field, narrowed type, changed required set, removed route)
  requires a major-version increment. *(Level: L3)* — **Verify:** a contract-diff gate compares the
  current schema against the last published one and fails a breaking delta unless the major version
  changed. (Grounding: EO v0.2.0 removed the `confidence` field unguarded — this gate would have
  caught it.)

- **SPEC-03.R6 — Deprecation policy with signalling.** A written deprecation policy exists; deprecated
  surfaces are marked in the contract and emit `Deprecation` and `Sunset` (RFC 8594) headers with a
  removal date. *(Level: L2)* — **Verify:** a deprecated endpoint carries the headers and a contract
  annotation; policy doc states the minimum notice window.

- **SPEC-03.R7 — Cross-module contracts are ratified, not DRAFT.** No shared/inter-module contract
  remains in DRAFT status once a production code path depends on it; contracts carry an explicit
  status field. *(Level: L3)* — **Verify:** each contract artifact has `status: ratified` (not DRAFT);
  a check cross-references consumed contracts and fails on any DRAFT that has a live consumer.
  (Grounding: `stamper-eo-schema-contract.md` is DRAFT v1.0 yet consumed by EO.)

- **SPEC-03.R8 — Contract is the single source of truth.** Types/handlers are generated from, or
  validated against, the schema — hand-maintained shapes that can drift from the contract are
  disallowed. *(Level: L2)* — **Verify:** a generation or validation step ties code to the schema; a
  drift check (schema vs types) is present and green.

- **SPEC-03.R9 — Backward-compatibility rules documented.** The rules for compatible change within a
  major version are written down (additive-only; new fields optional; never repurpose a field).
  *(Level: L2)* — **Verify:** a compatibility-policy section exists and is referenced by the
  contract-diff gate's definition of "breaking".

- **SPEC-03.R10 — API surface inventory exists.** An enumerated inventory of all endpoints (and
  cross-module contracts) is maintained. *(Level: L1)* — **Verify:** a route/contract manifest exists
  and, when regenerated, matches the routes actually registered (no drift).

- **SPEC-03.R11 — Auth expectations declared per endpoint.** Each endpoint's authentication/authorization
  requirement is stated in the contract (security scheme), including explicitly "public". *(Level: L2)*
  — **Verify:** every operation names a security scheme or `public`; a check fails on an endpoint with
  no declared auth posture. (Cross-ref SPEC-04.)

- **SPEC-03.R12 — Contract changes are versioned with a changelog.** Every contract carries a version
  and a changelog; changes are additive/revised with a log line, never silently edited, and consumers
  are notified. *(Level: L3)* — **Verify:** contract file has a version + changelog section; git
  history shows changelog lines accompany contract edits.

## Anti-patterns

- **Unversioned breaking change** — a field removed or a type narrowed on a `/api/...` route with no
  version bump, breaking every consumer at once (EO's dropped `confidence`).
- **DRAFT-forever contract** — a cross-module schema marked DRAFT for months while production code
  already depends on it, so "the contract" and "the behavior" quietly diverge (stamper↔EO).
- **God-file route registration as pseudo-API** — ~98 routes registered in one 3.9K-line file with no
  schema, no version, no inventory (cross-ref SPEC-02.R10).
- **Ad-hoc error shapes** — some routes return `{error}`, others `{message}`, others a bare string, so
  no consumer can handle failures uniformly.
- **One-sided validation** — server validates input but never its own output, or the consumer trusts
  the response blindly; the contract is only half-enforced.
- **Hand-drifted types** — TypeScript interfaces maintained by hand next to a schema they no longer
  match; the code compiles, the contract lies.
- **Silent sunset** — an endpoint removed with no `Deprecation`/`Sunset` notice and no deprecation
  window, stranding consumers.

## Conformance checklist

- [ ] Every HTTP route is served under a version segment or version header. *(R1)*
- [ ] Every endpoint has a published request and response schema. *(R2)*
- [ ] Server validates inbound + outbound; consumer contract tests exist. *(R3)*
- [ ] All errors conform to one structured problem+json-style schema with stable codes. *(R4)*
- [ ] A contract-diff gate blocks breaking changes without a major version bump. *(R5)*
- [ ] Deprecated surfaces are annotated and emit `Deprecation`/`Sunset` headers per policy. *(R6)*
- [ ] No consumed cross-module contract is in DRAFT status. *(R7)*
- [ ] Code is generated from or validated against the schema (no hand-drift). *(R8)*
- [ ] Backward-compatibility rules are documented and drive the "breaking" definition. *(R9)*
- [ ] An endpoint/contract inventory exists and matches registered routes. *(R10)*
- [ ] Every endpoint declares its auth posture (scheme or explicit public). *(R11)*
- [ ] Every contract is versioned with a changelog; edits are logged, not silent. *(R12)*

## CES profile hooks

- **Tighten R7 to a hard gate on stamper↔EO.** The profile mandates that
  `docs/stamper-eo-schema-contract.md` move from DRAFT v1.0 to `ratified`, with both the stamper
  producer (`DirectiveMetadata`/`RegistryEntrySnapshot` Zod schemas) and the EO consumer validated
  against it — this is the flagship SPEC-03 tightening (cross-links SPEC-02.R8/R9).
- **Tighten R1 across all four servers.** Stamper GUI, EO (`EoServer`), and AO (`AoServer`) currently
  expose unversioned `/api/*` surfaces; the profile requires a `/v1` mount or version header on each,
  making the current state a tracked gap.
- **Tighten R5 to catch EO regressions.** The profile requires the contract-diff gate specifically
  because EO has already shipped an unguarded breaking change (`confidence` removal at v0.2.0).
- **Waive R2/R3 for the Planner's dev-server-only artifact routes.** The Vite dev-server routes
  (`/api/list-artifacts`, `/api/save-artifact`, …) are not a production API surface; the profile
  waives full schema/contract-test rigor for them with rationale (offline SPA, no runtime backend),
  while still requiring path-safety (cross-ref SPEC-04).
- SPEC-03 dimension **target = L2**, tightening to **L3 on R5 and R7** given the cross-module
  evidence-integrity dependency.
