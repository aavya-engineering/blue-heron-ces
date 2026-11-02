# REQ-AO-GUI-NO-CORRELATION-ID — AO's web UI executes without a correlationId

- **Status:** CLOSED 2026-09-27 by ces-ao FX-AO7 (`e53e708`); verified by ces-tester FX-TE4
- **Filed:** 2026-09-27, flow-through fix batch; X3 EV2 re-pin
- **Owner:** ces-ao
- **Filed by:** ces-tester, branch `flow-through-2026-09`
- **Unblock condition:** the AO web UI's execute call sends a `correlationId` (generated per click and
  shown or returned to the caller), so a UI-driven row can be traced into EvidenceOps by correlationId the
  same way an API-driven row can. ces-tester then keys demo check EV2 on correlationId instead of the
  ces.db row id.

## Evidence (ces monorepo `487ad97`, read-only)

- `ces-ao/public/index.html:1208-1218` — the execute `fetch('/api/execute/<id>')` body is
  `{ tenant, inputs, dryRun, requestorUPN, approvalId }`; `:1108-1111` (the state probe) sends
  `{ tenant, inputs, dryRun: true }`. The file contains no `correlationId` at all.
- The route accepts one (`ces-ao/src/server/routes/execute.routes.ts`, `correlationId` from the body)
  and the executor echoes it onto the evidence row (AE-R3). FX-TE1
  (`tests/flow/ao-eo.flow.test.ts`) proves that path end to end when the caller supplies one.

## Why it matters

AE-R6 asks that EvidenceOps find "this run's AO row by correlationId". For API/CLI/MCP callers that
works. For the demo's UI-driven path (and any operator using the web UI) the row has no correlationId,
so the only unique key is the ces.db row id. ces-tester's EV2 (`src/demo/acts/act-run.ts`) is re-pinned
to that row id meanwhile.

## Boundary

ces-tester did not change ces-ao (write boundary).

## Closure (2026-09-27, ces-tester FX-TE4)

- **Fix:** ces-ao `e53e708` (FX-AO7). `public/index.html` `newCorrelationId()` sends a fresh
  `ao-ui-<uuid>` on every `/api/execute` call (and the state probe), and shows it in
  `#resultCorrelationId`. The route echoes it and it lands on the persisted contract row at
  `data.metadata.correlationId` (ces-ao `test/guiCorrelation.routes.test.ts`).
- **Re-pin:** demo check EV2 (act D.15 `eo-verify-evidence`, `src/demo/acts/act-run.ts`) now
  matches by correlationId. It takes the newest AO row for the command in this run's `ces.db`, which
  must carry an `ao-ui-` id that is unique in the DB. It finds that id in EO's
  `/api/adminops/executions`, then confirms the Explorer lists the row and opens it with the same
  correlationId and command. The ces.db row id is only the join to the Explorer item.
- **Proof:** `tests/demo-acts-eo-verify-evidence.test.ts` (10 tests). The positive case asserts
  `EV2.evidence.correlationId`. The negatives fail on: no correlationId, a non-UI id, another click's
  id, the same row id with a different id, and an item that opens to another id or command.
  `tests/demo-ao-evidence.test.ts` pins the `data.metadata` read location.
- **Collateral fix:** FX-AO7 also removed `#liveTenantInput` in favour of `#tenantSelect` (no default
  tenant; with none selected the UI never calls `/api/execute`). `src/demo/ao-ui-driver.ts` now
  waits for the slug's option, selects it, then arms the toggle. It also reports the UI's
  correlationId (`tests/demo-ao-ui-driver.test.ts`).
- **Not done:** a live browser run of act D.15 in this batch. The re-pin is proven against the real
  row shape and EO's route shapes; the live chain AO → ces.db → EO by correlationId is FX-TE1's
  (API-driven).
