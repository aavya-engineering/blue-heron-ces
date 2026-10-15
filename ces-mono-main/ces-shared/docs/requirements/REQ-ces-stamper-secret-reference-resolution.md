# REQ: ces-stamper — resolve SecretReference at Configure/translate time; never write the value

**Filed by:** ces-shared, feature completion FC-SH step 1, 2026-09-28
**Target module:** ces-stamper
**Priority:** P2 (answers `../ces-muster/docs/requirements/REQ-ces-shared-im-secret-values.md` ask 2)
**Related:** `../ces-muster/docs/requirements/REQ-ces-shared-im-secret-values.md`,
`../ces-muster/docs/requirements/REQ-ces-shared-export-provisioning-vars.md`

## What changed in ces-shared (2.8.0)

`src/types/mission-plan.bodies.ts`:
- `SecretReferenceSchema` (discriminated union on `form`, both variants `.strict()` so a stray
  `value`/`secret`/`password` key is a parse error): `one_time_operator_held { variable, form, ref }` and
  `key_vault_secret { variable, form, vault, name }`.
- `SECRET_VARIABLE_NAMES = ['initialPassword']` — variable names that must never carry a plain value.
- `InfrastructureBodySchema.secret_references?: SecretReference[]`.
- `ProvisioningInputsSchema` (`approver_upn`, `terms_of_use_file { file_name, content_base64 }`,
  `initial_password_ref: SecretReference`) and `TenantManifestBodySchema.provisioning_inputs?`, for
  m365-only sessions that carry no Infra Manifest (founder decision, feature-completion round 2, #11).

`src/types/mission-plan.contract.ts`: `InfraManifestSchema`'s existing `superRefine` now rejects a manifest
where `stamper_variable_map.initialPassword` (or any variable a `secret_references[]` entry itself names) holds a
non-empty plain string. All additive/optional — existing manifests without these fields parse unchanged.

## What ces-shared did NOT do

Resolve the reference. That is Stamper's job, at Configure/translate time (an operator prompt for
`one_time_operator_held`, a Key Vault read for `key_vault_secret`).

## Hazard this closes (from the REQ Muster filed)

`src/shared/variable-map.ts:47` maps `initialPassword` → `initial_password`, and
`src/server/routes/registry.routes.ts:261` / `tenant.routes.ts:90` copy that value into `variables` verbatim. If a
`SecretReference` object ever lands in `stamper_variable_map.initialPassword` (instead of a resolved string), it
would flow through untouched — never resolved, never rejected. The new `InfraManifestSchema` refinement rejects a
**plain-value** `initialPassword`, but a manifest can still validly carry the reference only in
`secret_references[]`, leaving `stamper_variable_map.initialPassword` unset — which is exactly Muster's current
interim behavior (Stamper reports the variable unresolved; safe failure mode, proven by
`muster-api/tests/plan.fullSession.provisioning.test.ts`).

## Asks

1. When translating an Infra Manifest (or a Tenant Manifest with `provisioning_inputs`), resolve each
   `SecretReference` before use:
   - `one_time_operator_held`: prompt the operator (Configure-time UI/CLI); the resolved value is used once and
     never written to disk, logs, or any persisted artifact.
   - `key_vault_secret`: read `vault`/`name` from Azure Key Vault at translate time.
2. Never persist the resolved value — only ever the reference. Audit any code path that currently logs or
   snapshots `stamper_variable_map` / `variables` to confirm a resolved secret can't leak through it.
3. For `provisioning_inputs` (m365-only sessions): map `approver_upn` → `approverUPN`/`approver_upn`,
   `terms_of_use_file.file_name`/`content_base64` → `touFileName`/`touFileBase64`, and
   `initial_password_ref` (resolved) → `initialPassword`, matching `VARIABLE_MAPPING` in
   `src/shared/variable-map.ts` — no new variable names invented; this REQ deliberately reuses Stamper's own
   existing camelCase names in `ProvisioningInputsSchema`'s design.
4. Close by updating `CESTenantManifestBodySchema` (`src/types/ces-artifacts.types.ts:243`,
   `SharedTenantManifestBodySchema.superRefine(...)`) if Stamper wants its own refinement that a plain-string
   `provisioning_inputs.initial_password_ref` is likewise rejected (ces-shared's schema already rejects this at
   the type level — `initial_password_ref` must parse as `SecretReferenceSchema`).

## Acceptance

- A translate/Configure run given a manifest with `secret_references` resolves each reference and the resulting
  variable map is never written to disk/log with the plain value under a different key than the caller supplied
  as already-resolved.
- `tests/unit/SharedMissionPlanDelegation.test.ts` and any Stamper secret-handling test stay/become green against
  ces-shared 2.8.0.
