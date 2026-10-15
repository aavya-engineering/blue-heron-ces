# Requirement: make `eo_operator_passkey_events` an append-only (WORM) collection (against ces-shared)

- **Filed from:** ces-eo, 2026-09-28 (FC-EO-G, passkey operator sign-in)
- **Target:** `ces-shared/src/persistence/CesRepository.ts` (`DEFAULT_WORM_COLLECTIONS`)
- **Status:** OPEN — awaiting a ces-shared session

## Context

EvidenceOps now lets BHD operators sign in to the approver-token issuer with passkeys registered on
the EO machine (founder decisions 16–19, 2026-09-28). Every operator enrollment-code issue, passkey
enrollment and passkey revocation is written as an evidence record to the collection
`eo_operator_passkey_events` (`ces-eo/src/eo/approver-tokens/PasskeyOperatorStore.ts`). The EO class
exposes only `recordEvent()` (fresh UUID per event) and `listEvents()`, so EO itself never
overwrites or deletes an event.

## Problem

Same gap as `REQ-ces-shared-worm-approver-token-mints.md`: `getCesRepository()` caches the first
instance per db path with that instance's options, so EO cannot reliably opt a collection into WORM.
Another code path with repository access could still `put` over, `update` or `delete` an event.

## Ask

Add `eo_operator_passkey_events` to `DEFAULT_WORM_COLLECTIONS`.

Do **not** add `eo_operator_passkeys` or `eo_operator_enrollment_codes`: those are operational state
(the sign counter and last-used time move on every sign-in; revocation and code consumption are
updates). Their history is carried by the event collection.

## Acceptance

A ces-shared test shows `put` over an existing `eo_operator_passkey_events` id, `update` and
`delete` all throw `CesWormError`.
