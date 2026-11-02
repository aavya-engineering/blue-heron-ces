# REQ-AO-EVIDENCE-PATH-DOCSTRING-STALE

**Filed by:** ces-tester (GP-DEMO-3, M0 drivability spike)
**Date:** 2026-08-29
**Against:** `ces-ao`
**Severity:** LOW (documentation) — but it actively misleads any consumer trying to find
AdminOps evidence on disk, which cost real time during this spike.
**Status:** OPEN — NOT patched (write boundary).

## Summary

`EvidenceEmitter`'s docstring says evidence is written to
`{CES_PIPELINE_ROOT}/AdminOps/evidence-store/...`. That is **stale, pre-ADR-002**. The live
code writes to **SQLite** via `getCesRepository()` — `{CES_PIPELINE_ROOT}/ces.db`, table
`ces_records`, collection `adminops_evidence`. No such directory is ever created, and the
`evidencePath` the API returns is a **record locator string**, not a filesystem path.

## Evidence (measured)

Live A-18 execution through the AdminOps GUI, with `CES_PIPELINE_ROOT` pointed at a
run-scoped directory. The API returned:

```json
"evidencePath": "adminops_evidence/A-18:A-18-1788038395123"
```

That is `<collection>/<recordId>`. Nothing was written under
`<CES_PIPELINE_ROOT>/AdminOps/`; the record was found in `<CES_PIPELINE_ROOT>/ces.db`:

```
collection  = adminops_evidence
id          = A-18:A-18-1788038395123
tenant_id   = sim-tenant-demo-dib-small
tenant_slug = NULL
created_at  = 2026-08-29T21:19:55.123Z
```

Note `tenant_slug` is NULL — scoping must be by `tenant_id`, not slug, absent a CES customer
binding.

## Code path

| File | Line | Detail |
|---|---|---|
| `ces-ao/src/evidence/EvidenceEmitter.ts` | 83-86 | stale docstring naming `{CES_PIPELINE_ROOT}/AdminOps/evidence-store/...` |
| `ces-ao/src/evidence/EvidenceEmitter.ts` | 97-126 | live path: `getCesRepository()` → SQLite |
| `ces-shared/src/persistence/CesRepository.ts` | 16-18 | `{CES_PIPELINE_ROOT}/ces.db` |
| `ces-shared/src/persistence/CesRepository.ts` | 117-130 | `ces_records` schema; `data` is a JSON **string** |
| `ces-shared/src/storage/contract.ts` | 16 | win32 default root `C:\CES_Pipeline` |

## Suggested fix (for ces-ao to apply — NOT applied by ces-tester)

Update the docstring to describe the SQLite destination and state plainly that the returned
`evidencePath` is a `<collection>/<id>` locator, not a file path. If a filesystem-path
contract is still wanted by some consumer, rename the field (`evidenceLocator`) rather than
leaving a path-shaped string that resolves to nothing.

## Cross-reference

- `docs/demo/E2E-GROUNDING-EVIDENCE.md` finding #2
- Evidence: `runs/m0-spike/m0-001/ao/execute-A-18-response.json`, `.../evidence-row.json`
