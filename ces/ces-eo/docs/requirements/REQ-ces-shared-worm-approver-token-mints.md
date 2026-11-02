# Requirement: make `eo_approver_token_mints` an append-only (WORM) collection (against ces-shared)

- **Filed from:** ces-eo, 2026-09-27 (FC-EO-C, step AO-16)
- **Target:** `ces-shared/src/persistence/CesRepository.ts` (`DEFAULT_WORM_COLLECTIONS`)
- **Status:** DONE (2026-09-28, verified by FC-EO-H) — `ces-shared` commit `9d873cd` (FC-SH step 5, part of
  ces-shared 2.8.0): `eo_approver_token_mints` added to `DEFAULT_WORM_COLLECTIONS`. Re-verified directly:
  `grep DEFAULT_WORM_COLLECTIONS ces-shared/src/persistence/CesRepository.ts` shows
  `['adminops_evidence', 'eo_approver_token_mints']`.

## Context

EvidenceOps records every AdminOps approver-token mint as evidence in the collection
`eo_approver_token_mints` (`ces-eo/src/eo/approver-tokens/ApproverTokenMintLog.ts`): who minted,
for whom, tenant, expiry — never the token. The EO class only exposes `record()` (fresh UUID per
mint) and `list()`, so EO itself never overwrites or deletes a row.

## Problem

Repository-level WORM protection covers only `adminops_evidence` by default. `getCesRepository()`
caches the first instance per db path with that instance's options, so EO cannot reliably opt its
collection into WORM without racing every other caller. Any other code path with repo access could
still `put` over, `update` or `delete` a mint record.

## Ask

Add `eo_approver_token_mints` to `DEFAULT_WORM_COLLECTIONS` (or provide a registry that collections can
be added to after the repository is created).

## Acceptance

A ces-shared test shows `put` over an existing `eo_approver_token_mints` id, `update` and `delete`
all throw `CesWormError`.
