# REQ-ces-stamper-ec-autostart — gate EC autostart on CES_EC_AUTOSTART, pass the real cwd (plan M4b)

**From:** ces-ec (EC-M2M3, 2026-09-28) · **To:** ces-stamper · **Plan:** step 5 (M4b)
**Status:** OPEN — nothing in ces-stamper was touched.

## Asks
1. `src/server/GuiServer.ts` (~L300-305): gate `ensureEcRunning` on `CES_EC_AUTOSTART=1`, not on `EVIDENCE_OPS_SECRET`; pass the ces-ec module root as cwd (not `../eo`). EC still reads `EVIDENCE_OPS_SECRET` itself for its bearer routes; without it EC runs `degraded` (read-only lists work, ingest/index/items return 503).
2. Delete the orphaned `evidence_ops` SSE handler in `public/index.html`.
3. Grep test: GuiServer no longer passes `../eo`.

## Note for Stamper
EC reads `plan-data/<slug>/state/execution-results-*.json` (not `*.delivery.json`) and `evidence/**` read-only. A pre-contract manifest (no `contractVersion`, verdict words like `"SAT"`) is reported by EC as `UNPARSEABLE`; the current `ExecutionResultsCollector` writes 1.1.0, so re-running old tenants clears it. No action needed unless old manifests must stay.
