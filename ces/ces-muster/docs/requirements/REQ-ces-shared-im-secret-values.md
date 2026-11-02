# REQ: ces-shared: a secret-reference shape in the Infrastructure Manifest

**Filed by:** ces-muster (FC-MU-2, MS-5, 2026-09-28)
**Target module:** ces-shared (then ces-stamper to consume it)
**Priority:** P2
**Status:** DONE (2026-09-28, FC-MU-4). ces-shared 2.8.0 ships `SecretReferenceSchema` and
`InfrastructureBodySchema.secret_references[]` (FC-SH step 1). Muster's MS-5 HONEST-OPEN for the
initial password is closed: the reference now travels end to end and parses under the canonical,
typed schema — see "Closed" below. The ces-stamper consumption half
(`docs/requirements/REQ-ces-stamper-secret-reference-resolution.md`, filed by ces-shared) is
outside this module and tracked there.

## What
Founder decision (2026-09-27, #6): the initial password is generated in Muster and is never typed or stored in
plain text. It travels as a secret reference or a one-time value, following the ces-shared Infra Manifest schema.

The schema has no such shape. `InfrastructureBodySchema` (`src/types/mission-plan.bodies.ts`) and
`InfraVariableMapSchema` accept strings only. Both are `.passthrough()`, so an extra key parses, but nothing
defines what a secret reference is or how a consumer resolves it.

There is also a hazard. Stamper maps `initialPassword` to `initial_password` (`src/shared/variable-map.ts:47`) and
copies map values verbatim into variables (`src/server/routes/registry.routes.ts:261`). A reference string placed
in `stamper_variable_map.initialPassword` would become the literal password.

## What Muster emits today (interim, Muster-defined)
In `infrastructure.secret_references[]`, which sits outside the variable map and is kept by `.passthrough()`:

```json
{ "variable": "initialPassword", "form": "one_time_operator_held", "ref": "secretref:one-time:<uuid>" }
```

- The operator sees the value once, in Muster's intake, and must copy it to their own vault. Muster stores it
  nowhere: not in Dexie, not in facts, not in any artifact. `muster-api/tests/plan.fullSession.provisioning.test.ts`
  proves this.
- `stamper_variable_map.initialPassword` is never set, so Stamper reports the variable as unresolved. That is the
  safe failure mode.

## Ask
1. **ces-shared:** define `SecretReferenceSchema` and add `secret_references?: SecretReference[]` to
   `InfrastructureBodySchema`, and reject any secret variable name (at least `initialPassword`) that appears
   in `stamper_variable_map`. Choose the forms, for example `one_time_operator_held` (supplied by the operator at
   Configure time) and `key_vault_secret { vault, name }`. Export the schema on the public subpath.
2. **ces-stamper** (FC-2 checks consumption): when an Infra Manifest carries a secret reference, resolve it at
   Configure/translate time (an operator prompt, or a Key Vault read), and never write the resolved value to
   disk or to logs.

## Acceptance
- An Infra Manifest with `secret_references` parses under the exported schema. A manifest that puts
  `initialPassword` in `stamper_variable_map` is rejected.
- Muster's `plan.fullSession.provisioning.test.ts` switches from the passthrough check to the typed schema, with
  no change to the emitted shape. If the chosen shape differs, Muster adapts its emitter.

## Closed (2026-09-28, FC-MU-4)
ces-shared 2.8.0 shipped exactly the shape this REQ asked for — `variable`/`form`/`ref` for
`one_time_operator_held`, matching Muster's emitted shape byte-for-byte, so no emitter change was needed.
- **Acceptance 1** (parses): `muster-api/tests/plan.fullSession.provisioning.test.ts` — "the Infra Manifest
  parses under ces-shared and carries all three" — `InfraManifestSchema.safeParse(im)` succeeds with
  `secret_references` populated.
- **Acceptance 2** (rejects a plain password in the variable map): same file, new test "ces-shared rejects the
  Infra Manifest if a plain password ever landed in stamper_variable_map" — mutates a passing manifest to add
  `stamper_variable_map.initialPassword` and asserts `InfraManifestSchema.safeParse` fails at
  `infrastructure.stamper_variable_map.initialPassword` (ces-shared's `SECRET_VARIABLE_NAMES` guard).
- **Acceptance 3** (typed schema, no shape change): the test already imported `InfraManifestSchema` from
  `ces-shared/types/mission-plan` (unchanged import) — was always the typed schema, never a raw passthrough
  check; ces-shared 2.8.0 made the `secret_references` field itself typed (was accepted only via
  `InfrastructureBodySchema`'s `.passthrough()` before).
- **m365-only carrier** (founder decision 2026-09-28 #11, the separate gap this REQ's "Remaining gap" section
  and `docs/FLOW-THROUGH-REPORT-2026-09.md`'s FC-MU-2 section flagged as open): closed without a new REQ —
  ces-shared 2.8.0 shipped `TenantManifestBodySchema.provisioning_inputs` / `ProvisioningInputsSchema` directly
  off the founder decision (`../ces-shared/CHANGELOG.md` "2026-09-28 feature completion (FC-SH)" §1). Muster
  wires it in FC-MU-4 step 2: m365-only sessions now emit `tenant_manifest.provisioning_inputs` (no Infra
  Manifest exists for that model). See `muster-api/tests/plan.fullSession.provisioning.test.ts`'s "FC-MU-4
  MS-5 (m365_only)" describe block.
- **Commits:** `2a5ef63` (FC-MU-4 steps 1-3).
