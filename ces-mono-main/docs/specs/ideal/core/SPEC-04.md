# SPEC-04 — Security (v1.0)

## Intent

Security is the dimension that decides whether the software can be trusted with credentials, tenant
data, and privileged execution. This spec anchors to **OWASP ASVS** (Application Security
Verification Standard — verifiable, level-tiered security requirements), **SLSA** (Supply-chain
Levels for Software Artifacts — provenance and build-integrity), and the **12-factor** principle that
*config lives in the environment but secrets live in a dedicated store, never in code or version
control*. It exists because agent-built software concentrates risk: agents wire auth, spawn shells,
substitute templates, and read secrets far faster than a human reviews them. The requirements below
are defaults-on (secure unless deliberately relaxed with rationale), machine-checkable, and biased
toward eliminating whole classes of failure (plaintext secrets, unescaped substitution, unpinned
dependencies) rather than patching instances.

## Requirements

- **SPEC-04.R1 — AuthN defaults-on for every network surface.** *(L2)*
  Every HTTP/API surface requires authentication by default; an unauthenticated route exists only
  when explicitly annotated as public with rationale.
  *Verify:* enumerate every route registration; each is either behind auth middleware or carries a
  documented `// public:` justification. A server whose auth middleware is a no-op when a token env
  var is unset fails this requirement.

- **SPEC-04.R2 — AuthZ enforced per privileged action, not just at the edge.** *(L2)*
  Privileged/mutating actions check the caller's authorization at the action, and separation-of-duty
  (SOD) gates on high-impact actions are enforced server-side, not advisory.
  *Verify:* for each mutating route/command, point to the authz/SOD check it passes through; confirm
  the check is server-evaluated (not a client flag). Grep for SOD/tier gates and confirm they bind
  to the executed command + params, not merely a UI toggle.

- **SPEC-04.R3 — Zero plaintext secrets.** *(L3)*
  No secret (password, token, cert password, connection string) appears as a CLI flag value, a
  literal in source, or a committed file.
  *Verify:* CI grep finds **no** `--password`/`--cert-password`/`--token` value-bearing flags and no
  secret-shaped literals outside the central store; `git log -p` / secret-scanner shows no committed
  secrets. Presence of a `--cert-password` option is an automatic fail.

- **SPEC-04.R4 — Central secret store; env holds config, not secrets.** *(L3)*
  Secrets are resolved at runtime from a central store (e.g., Azure Key Vault / OS keychain / managed
  identity); environment variables carry non-secret config and at most a reference/handle to a
  secret, never the secret value.
  *Verify:* trace every credential to a store-backed resolver; confirm no `process.env.*` read
  returns a raw secret value. Count of secret-valued env reads must be zero.

- **SPEC-04.R5 — Config reads are centralized, not scattered.** *(L2)*
  Secret and credential access flows through a single config/secret layer per module; no ad hoc
  `process.env` reads sprinkled across the codebase.
  *Verify:* grep `process.env` occurrences; all reside in the config/secret module (or a documented
  allowlist). Dozens of scattered reads across many files fail this (cross-refs SPEC-08).

- **SPEC-04.R6 — Input validation on every external input.** *(L2)*
  Every request body, query param, CLI input, and file upload is schema-validated (type, shape,
  bounds) before use, with strict mode enabled.
  *Verify:* each input boundary passes a Zod/AJV (or equivalent) schema; validators run in strict
  mode (`strict:true`, `validateSchema:true`). Lenient config (`strict:false`) is a partial-credit
  L1 finding, not L2.

- **SPEC-04.R7 — Output escaping / contextual encoding.** *(L2)*
  All rendered output (HTML, templates, docx, logs) is contextually escaped for its sink; template
  engines run with auto-escaping on.
  *Verify:* confirm the template/render layer auto-escapes (e.g., Handlebars default escaping not
  bypassed via triple-stache/`SafeString` without justification); no raw interpolation of
  user/tenant data into markup.

- **SPEC-04.R8 — Injection defense for shell and template substitution.** *(L3)*
  Any place that substitutes values into a shell command or a command template parameterizes or
  escapes those values; no raw string concatenation of external input into `spawn`/`exec` or into a
  PowerShell/command template.
  *Verify:* locate every `spawn`/`exec`/template-substitution site; each uses argument arrays or an
  escaping/allowlist guard on interpolated values. Raw template substitution into command strings
  without an escaping pass fails.

- **SPEC-04.R9 — Rate limiting on network surfaces.** *(L2)*
  Public and authenticated HTTP surfaces apply rate limiting to mutating and expensive endpoints.
  *Verify:* a rate-limit middleware is registered and covers mutating routes; confirm limits are
  configured (not merely imported). Absence on all routes is L0/L1.

- **SPEC-04.R10 — CSRF protection for browser-driven state change.** *(L2)*
  Any cookie/session-authenticated state-changing endpoint enforces CSRF protection (token or
  same-site + origin check).
  *Verify:* state-changing browser endpoints require a CSRF token or documented same-site+origin
  defense; pure bearer-token APIs with no ambient credentials may waive this with a note.

- **SPEC-04.R11 — Dependency audit gate in CI.** *(L3)*
  A dependency vulnerability audit runs in CI and fails the build on known high/critical advisories.
  *Verify:* CI contains an `npm audit`/`osv-scanner` (or equivalent) step with a failing threshold;
  the lockfile is committed and audited. No audit step in the pipeline is a fail.

- **SPEC-04.R12 — Lockfile-pinned, reproducible dependency tree.** *(L2)*
  Dependencies are installed from a committed lockfile with `npm ci` (or equivalent), not floating
  ranges resolved at build time.
  *Verify:* CI uses `npm ci`; `package-lock.json` is committed; no `npm install` in the build path.

- **SPEC-04.R13 — SBOM generated per released artifact.** *(L3)*
  Each release produces a Software Bill of Materials (CycloneDX/SPDX) enumerating dependencies and
  versions.
  *Verify:* the release process emits an SBOM file per artifact and retains it as a build artifact
  (cross-refs SPEC-06 provenance). No SBOM output is a fail at L3.

- **SPEC-04.R14 — Least privilege for identities and file scope.** *(L2)*
  Service identities hold the minimum scopes required; file/path operations are constrained to an
  explicit allowed root; uploads have an extension allowlist, a size cap, and lifecycle cleanup.
  *Verify:* confirm requested API scopes match the operations performed (no over-broad grants);
  path operations enforce a `startsWith(allowedRoot)` (or canonicalized) check; upload handling shows
  extension allowlist + size limit + cleanup. Uploads to a shared tmp dir with no size limit or
  cleanup fail.

- **SPEC-04.R15 — Fail-safe defaults; errors deny.** *(L2)*
  Security controls default to the safe state: missing config disables the surface or denies access
  rather than silently opening it.
  *Verify:* confirm that an unset auth token, missing tenant pin, or missing policy causes deny/refuse
  behavior, not open access. An auth layer that becomes a pass-through when its token is unset fails.

## Anti-patterns

- **`--cert-password` (or any secret-valued CLI flag)** — plaintext secret on the command line and in
  shell history; violates R3.
- **Scattered `process.env` reads** for credentials across dozens of files — no central secret layer,
  impossible to audit; violates R4/R5.
- **Template substitution without escaping** — raw interpolation of tenant/user values into a
  PowerShell or command template; command-injection surface; violates R8.
- **Auth middleware that no-ops when its token env var is unset** — "secure" only when someone
  remembers to set a variable; violates R1/R15.
- **Lenient validators** (`strict:false`, `validateSchema:false`) — schemas present but not enforced;
  violates R6.
- **Uploads to `os.tmpdir()`** with no size limit and no auto-cleanup — resource exhaustion and stale
  sensitive files; violates R14.
- **No `npm audit` / SBOM in CI** — unknown supply-chain exposure; violates R11/R13.
- **Fire-and-forget privileged POSTs** that swallow failures — security-relevant actions with no
  delivery guarantee or alert (cross-refs SPEC-09).

## Conformance checklist

- [ ] Every route is authenticated or annotated public with rationale. *(R1)*
- [ ] Privileged/mutating actions enforce authz + server-side SOD gates. *(R2)*
- [ ] No secret-valued CLI flags or secret literals anywhere; grep-clean in CI. *(R3)*
- [ ] All secrets resolve from a central store; zero secret-valued env reads. *(R4)*
- [ ] Credential/config access is centralized, not scattered. *(R5)*
- [ ] Every external input is schema-validated in strict mode. *(R6)*
- [ ] Output is contextually escaped; template auto-escaping is on. *(R7)*
- [ ] Every shell/template substitution parameterizes or escapes input. *(R8)*
- [ ] Rate limiting covers mutating/expensive endpoints. *(R9)*
- [ ] Browser state-change endpoints enforce CSRF (or documented waiver). *(R10)*
- [ ] CI runs a dependency audit that fails on high/critical advisories. *(R11)*
- [ ] Build uses a committed lockfile via `npm ci`. *(R12)*
- [ ] Each release emits an SBOM. *(R13)*
- [ ] Identities, paths, and uploads follow least privilege (scope/root/allowlist/size/cleanup). *(R14)*
- [ ] Controls fail safe: missing config denies rather than opens. *(R15)*

## CES profile hooks

- **dryRun-first live-tenant execution (CES tightening).** For modules that execute against a live
  GCC High tenant (Stamper, AO), the CES profile tightens R2/R15: `dryRun` is the enforced default,
  live execution requires an explicit un-dry-run gate, and for Tier-3 actions the two-person SOD
  approval must bind to the canonical params hash before any live call. This is a CES *requirement
  addition* on top of core AuthZ.
- **Central secret store = Key Vault (CES tightening).** The CES profile raises R3/R4 to mandatory
  L3 for Stamper and AO: the **`--cert-password` plaintext option must be removed** and cert/secret
  material must resolve from Azure Key Vault / managed identity — no plaintext secret path, no
  secret-valued env var. The recon-noted 44 scattered `process.env` reads (Stamper) are a tracked
  R5 gap.
- **PowerShell / shell injection guards (CES tightening).** The CES profile marks R8 mandatory L3 for
  Stamper's `CLIAdapter` `spawn()` on plan-derived commands and AO's `TemplateRegistry` PowerShell
  template substitution: every interpolated value must pass an escaping/allowlist guard, verified by
  test. These are the highest-severity CES injection surfaces.
- **Offline Planner waiver.** The CES profile *waives* R1/R9/R10 for `ces-planner` where it runs as an
  offline SPA with no runtime backend (only Vite dev-server routes), with rationale; the dev-server
  artifact routes still owe the R14 path-root check.
