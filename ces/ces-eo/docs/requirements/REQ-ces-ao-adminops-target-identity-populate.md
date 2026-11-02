# REQ-ces-ao-adminops-target-identity-populate

- **From:** ces-eo (fix batch 2026-09-27, step FX-EO4)
- **To:** ces-ao (AdminOps evidence writer)
- **Status:** OPEN
- **Filed:** 2026-09-27

## Need
ces-shared contract 1.3.0 (FX-SH3, `03a6d0a`) added optional `targetUPN` / `targetObjectId`
to the AdminOps evidence row. The EO offboarding wizard now evidences a step only from a live,
executed row whose **target** is the offboarded person (never the operator). ces-ao's command
templates already take a `targetUPN` parameter (A-02/A-03/B-05 in `TemplateRegistry.ts`), but
the persisted evidence row (`data.metadata`) does not carry it yet, so real rows never evidence
a wizard step (fail closed).

## Ask
When persisting evidence for a user-targeted command, write the command's `targetUPN` (and the
resolved Entra object id when known, as `targetObjectId`) into the contract row, with
`contractVersion: '1.3.0'`. Add both to the golden fixture
(`test/fixtures/contract/adminops-evidence-rows.golden.json`) for at least one user-targeted row.

## Acceptance (EO side, already in place)
`ces-eo/tests/eo/adminops/adminops-offboarding.test.ts` drives the wizard routes with rows carrying
`targetUPN`; once the golden has a target, EO will switch that test's seed to the golden row.
