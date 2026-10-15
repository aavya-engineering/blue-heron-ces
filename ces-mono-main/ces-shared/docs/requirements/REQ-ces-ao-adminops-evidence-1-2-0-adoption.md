# REQ: ces-ao — adopt AdminOps evidence contract 1.2.0 (`denied_sim_only`)

**Filed by:** ces-shared, fix batch FX-SH1, 2026-09-27
**Target module:** ces-ao
**Priority:** P1 for ces-ao's own gate (its golden conformance test is red against rebuilt ces-shared dist); P2 for the outcome switch
**Closes (when done):** `ces-ao/docs/requirements/REQ-shared-adminops-evidence-sim-refusal-outcome.md`

## What changed in ces-shared (`src/types/adminops-evidence.contract.ts`)

- `ADMINOPS_EVIDENCE_CONTRACT_VERSION` = `'1.2.0'` (was `'1.1.0'`).
- `SUPPORTED_ADMINOPS_EVIDENCE_VERSIONS` = `['1.0.0', '1.1.0', '1.2.0']` — 1.0.0/1.1.0 rows with every
  pre-existing outcome still parse unchanged.
- New outcome `denied_sim_only` for sim-only safety-rail refusals (`CES_AO_SIM_ONLY=1` refusing a
  non-sim tenant; a sim tenant with a non-loopback endpoint).
  - **Only valid on rows declaring `contractVersion` 1.2.0 or later** — a 1.0.0/1.1.0 row carrying it is
    rejected (path `outcome`), because a 1.1.0 reader would not know it.
  - Never SAT (in the NEVER_SAT set); allowed on dry-run rows.
  - `isDenial()` now returns true for it (ces-eo counts it under `stats.denied`; EO adminops tests green).

## Effect on ces-ao (verified read-only, 2026-09-27)

Running `npx vitest run test/contract/adminopsEvidence.conformance.test.ts test/evidenceContractConformance.test.ts`
in ces-ao against the rebuilt ces-shared dist: **10 failed / 62 passed**. Cause:
- `test/contract/adminopsEvidence.conformance.test.ts:89` pins `expect(m.contractVersion).toBe('1.1.0')`, and
  the committed golden rows carry `contractVersion: '1.1.0'` while the line above compares against the live
  constant (now `'1.2.0'`); the golden-drift test also differs on the version.

This is the golden-drift guard working as designed (contract change → regenerate), not a regression in the
contract: older rows remain valid.

## Update (same batch, FX-SH3): contract is now 1.3.0

`REQ-ces-shared-adminops-target-identity` (from ces-eo) added optional `targetUPN` / `targetObjectId` (the user the
command acted on — NOT the operator). `ADMINOPS_EVIDENCE_CONTRACT_VERSION` = `'1.3.0'`; SUPPORTED = 1.0.0–1.3.0.
`denied_sim_only` is valid on 1.2.0 and 1.3.0 rows. ces-eo's reader already forwards the target fields and its
offboarding wizard matches only the target.

## Asks

1. Regenerate the golden via `test/contract/evidenceGoldenGenerator.ts`; assert against
   `ADMINOPS_EVIDENCE_CONTRACT_VERSION` only (drop the `'1.1.0'` literal pin).
2. Switch the A5 sim-only rail from `outcome: 'denied_cmmc'` (+ rationale workaround) to
   `outcome: 'denied_sim_only'`; keep the rationale text.
3. Populate `targetUPN` (and `targetObjectId` when known) in `data.metadata` for user-targeted commands —
   at least A-02, A-03, B-05 — from the command's parameters (e.g. A-02 `UserPrincipalName`).
4. Update stale "contract 1.1.0" comments: `src/execution/EvidenceEmitter.ts:201`,
   `test/contract/evidenceGoldenGenerator.ts:14`.

## Acceptance

ces-ao `npm test` green against the rebuilt ces-shared dist; a sim-only refusal writes a row that
`AdminOpsEvidenceSchema.parse` accepts with `outcome: 'denied_sim_only'`, `contractVersion: '1.3.0'`, verdict ≠ SAT; an
A-02 live row carries `targetUPN` of the disabled user.
