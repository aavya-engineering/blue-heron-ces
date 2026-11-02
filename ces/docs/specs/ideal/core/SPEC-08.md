# SPEC-08 — Configuration (v1.0)

## Intent

Configuration is where an application meets its environment, and it is a recurring source of
silent, environment-specific failure: a port that differs between dev and CI, a path baked into a
constant, a required variable read in three places with three different defaults. This dimension
requires that every module has **one** configuration layer that reads the environment, applies safe
defaults, validates the whole shape **at startup**, and exports a typed, immutable config object —
so misconfiguration fails loudly and early rather than as a null-pointer three calls deep. It is
anchored in the **Twelve-Factor App** methodology (factor III, "Config"): strict separation of
config from code, config stored in the environment, and no config as scattered constants or
per-module `if (process.env...)` reads. Fail-fast schema validation turns "systematic" config into
"enforced" config: a missing or malformed value cannot start the process.

## Requirements

- **SPEC-08.R1 — One config module per module.** *(L2)*
  Each workspace/module has a single file (or directory) that owns environment reads and produces its
  config; no other file reads raw environment or config sources directly.
  **Verify:** a single named config module exists per workspace (e.g. `config/EoConfig.ts`); it is the
  only importer of the environment for that module.

- **SPEC-08.R2 — Schema-validated at startup, fail-fast.** *(L3)*
  The assembled config is validated against a declared schema at process startup; validation failure
  throws with a field-level message and prevents the process from serving.
  **Verify:** the config module parses through a schema (e.g. Zod `safeParse`) and throws on failure
  with the offending field path; starting with a malformed value produces a startup error, not a
  runtime crash later.

- **SPEC-08.R3 — Zero environment reads outside the config layer.** *(L3)*
  `process.env` (and equivalent raw sources) is read only inside the config module; the rest of the
  code receives config via the typed object.
  **Verify:** `grep -rn "process.env" src --exclude-dir=config` returns zero hits for the module (or
  a lint rule forbids `process.env` outside the config path); count is asserted, not eyeballed.

- **SPEC-08.R4 — No hardcoded ports.** *(L3)*
  Listening ports come from validated config with a safe default, never a literal in a server/CLI
  constant.
  **Verify:** `grep -rn` for literal port numbers (e.g. `3000`, `4002`) in `src` outside the config
  module returns zero; the port originates from the schema's defaulted field.

- **SPEC-08.R5 — No hardcoded filesystem paths.** *(L2)*
  Storage roots, data directories, and external tool paths are config-derived (with computed safe
  defaults), never a literal or a `TODO`-flagged constant.
  **Verify:** `grep -rn` for absolute paths / base-path constants in `src` outside the config module
  returns zero; paths resolve through the config layer or a shared storage helper.

- **SPEC-08.R6 — Safe defaults for every non-secret field.** *(L2)*
  Every non-secret config field has a sensible default so the module starts in a dev environment
  with an empty environment; only genuinely required values (secrets, tenant identity) are mandatory.
  **Verify:** the schema declares `.default(...)` for non-secret fields; the module boots with no env
  set except documented required values.

- **SPEC-08.R7 — Documented environment matrix.** *(L2)*
  A committed reference lists every environment variable: name, type, required/optional, default, and
  which environments (dev/CI/live) set it.
  **Verify:** a `.env.example` and/or a config table in the module README enumerates all variables the
  config schema consumes; the list matches the schema fields (no undocumented reads).

- **SPEC-08.R8 — Config is typed and immutable to consumers.** *(L2)*
  Consumers receive a typed config object (inferred from the schema); it is not mutated at runtime.
  **Verify:** the config type is exported (e.g. `type EoConfig = z.infer<...>`); consumers import the
  type, and the object is not reassigned after load.

- **SPEC-08.R9 — Secrets are referenced, not defaulted, in config.** *(L2)*
  Secret-bearing fields (passwords, tokens, cert material) have no baked default value and are sourced
  from the environment or a secret store; they are never committed as literals.
  **Verify:** no secret field carries a literal default in the schema; grep for secret-looking
  constants in config returns zero. (Central secret storage is SPEC-04's scope; this requirement only
  forbids secrets-as-defaults in the config layer.)

## Anti-patterns

- **Three different config patterns in one codebase.** Build-time (Vite `import.meta.env`), dotenv
  sprawl, and a validated schema module coexist with no convergence (fails R1). *This is the current
  CES spread — planner Vite build-time, stamper dotenv sprawl, EO's validated `EoConfig`.*
- **Scattered `process.env` reads.** The same variable is read in dozens of files with ad-hoc
  fallbacks (fails R3). *CES stamper has ~44 scattered `process.env` reads.*
- **Hardcoded port 3000.** A server or CLI binds a literal port instead of config (fails R4). *CES AO
  hardcodes port `3000` at `ces-ao` `cli/index.ts:15`.*
- **Hardcoded base path with a `TODO`.** A storage root is a constant marked "TODO: make
  configurable" (fails R5). *CES stamper `STAMPER_BASE_PATH` is hardcoded at `src/shared/config.ts:19`
  with a TODO.*
- **No startup validation.** Config is read lazily; a missing variable surfaces as `undefined` deep in
  a handler hours later (fails R2).
- **Undocumented env matrix.** New contributors discover required variables by reading stack traces;
  no `.env.example` (fails R7).
- **Secret as default value.** A schema field defaults to a real token/password literal (fails R9).

## Conformance checklist

- [ ] Exactly one config module owns environment reads. (R1)
- [ ] Config is schema-validated at startup and fails fast. (R2)
- [ ] Zero `process.env` reads outside the config module (grep-asserted). (R3)
- [ ] No hardcoded ports outside config. (R4)
- [ ] No hardcoded filesystem paths outside config. (R5)
- [ ] Every non-secret field has a safe default. (R6)
- [ ] Environment matrix documented (`.env.example` / README table). (R7)
- [ ] Config object is typed and treated as immutable. (R8)
- [ ] No secrets carry literal defaults in config. (R9)

## CES profile hooks

- **CES exemplar to converge on: `EoConfig`.** `ces-eo/src/eo/config/EoConfig.ts` is the reference
  implementation for this whole dimension — a single Zod `EoConfigSchema` with `.default(...)`s,
  `loadEoConfig()` performing `safeParse` and throwing a field-level error on failure (R2), a single
  entry point that consolidates environment reads (R1), a `port` field defaulted (not hardcoded, R4),
  and an exported `type EoConfig = z.infer<...>` (R8). The profile names **EoConfig as the pattern the
  other CES modules MUST converge on**.
- **Tightenings the profile applies to non-EO modules:**
  - **Stamper** — eliminate the ~44 scattered `process.env` reads (R3) and the hardcoded
    `STAMPER_BASE_PATH` TODO at `config.ts:19` (R5) by routing them through a Zod-validated `StamperConfig`
    modeled on `EoConfig`.
  - **AO** — replace the hardcoded port `3000` at `cli/index.ts:15` with a defaulted, validated config
    field (R4).
  - **Planner** — the Vite build-time config is an accepted variant for the offline SPA, but any
    server-touching or path-resolving config must move behind a validated layer (R1, R5).
- **Documented matrix (R7)** is a CES **L2 target** across all modules: each workspace ships a
  `.env.example` enumerating the variables its schema consumes.
