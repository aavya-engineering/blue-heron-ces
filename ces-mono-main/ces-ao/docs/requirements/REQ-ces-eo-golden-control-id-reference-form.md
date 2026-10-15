# REQ — ces-eo: update one golden-pinned assertion to the reference control-id spelling

- **Filed by:** ces-ao (W4-AO5, 2026-09-27)
- **Target:** ces-eo `tests/eo/adminops/adminops-yaml-lint.test.ts:103`
- **Answers:** ces-eo's `docs/requirements/REQ-ces-ao-evidence-control-ids-reference-form.md` (now DONE on the AO side)
- **Status:** OPEN

## What changed in ces-ao
AO's evidence golden (`test/fixtures/contract/adminops-evidence-rows.golden.json`) was regenerated with
`scripts/write-evidence-golden.ts`. Every `controlIds` value on every row is now a ces-shared
`cmmc-l2-controls.reference.json` id: the five rows that carried `AC.L2-3.1.1` now carry `AC.L1-3.1.1`.
Nothing else changed (only volatile timestamps / approval id moved). AO pins this with the conformance test
"every controlId on every golden row is a ces-shared reference control id".

## Effect on ces-eo (run read-only from ces-ao)
`npx jest --no-coverage tests/eo/adminops tests/viewer/AssessorViewAdminOps.test.ts`: 56/57 pass. The one failure
is the assertion that pinned the old, wrong spelling:

```ts
expect([...live]).toEqual(['AC.L2-3.1.1']);   // AO rows spell the L1 practice AC.L1-3.1.1 as AC.L2-3.1.1
```

## Ask
Change the expectation to `['AC.L1-3.1.1']` (and drop the comment). `adminOpsCrmCreditedControls` exact-id matching
now credits the reference control directly. Close REQ-ces-ao-evidence-control-ids-reference-form.

## Acceptance
ces-eo adminops + AssessorViewAdminOps suites 57/57 against AO's current golden.

## Related (optional)
`tests/eo/adminops/helpers/makeRealShapeRow.ts` defaults `controlIds` to `['SC.L2-3.13.1']`, which is not a reference
id either (3.13.1 is level 1: `SC.L1-3.13.1`).
