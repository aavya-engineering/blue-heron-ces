# REQ-ces-eo-ec-wiring — EO proxy, nav, upload form and reader for EC (plan M4a)

**From:** ces-ec (EC-M2M3, 2026-09-28) · **To:** ces-eo · **Plan:** `ces-strategy/docs/context/evidence-collector/PLAN.md` step 4 (M4a)
**Status:** OPEN — EC side is built and tested; nothing in ces-eo was touched.

## What EC now serves (default `http://127.0.0.1:4001`)
| Route | Auth | Returns |
|---|---|---|
| `GET /api/health` | open | `EcHealth` + `contractVersion`, `simOnly`, `reasons[]`. Always 200; `status:'degraded'` when `EVIDENCE_OPS_SECRET` is unset. |
| `GET /api/runs[?tenant=]` | open | plain array of `EcRun` (+ `tenantSlug`), newest first. No `tenant` = every stored tenant the sim rail admits. |
| `GET /api/findings[?tenant=&status=open\|resolved]` | open | plain array of `EcFinding`, newest first. Same aggregation. |
| `GET /api/items?tenant=[&controlId=]` | bearer | `EcEvidenceItem[]` (manual uploads / attestations only). |
| `GET /api/items/:itemId/content?tenant=` | bearer | raw bytes; `Content-Type` = item `mediaType`; `X-EC-Sha256` header. |
| `POST /api/ingest` | bearer | JSON `{tenantSlug, controlIds[], source:'manual_upload'\|'attestation', filename, mediaType, contentBase64, submittedByRole, collectedAt?}` → 201 `EcEvidenceItem`. Strict body: `verdict`/`dryRun`/unknown keys → 400. Decoded content > 10 MB → 413. |
| `POST /api/index?tenant=` | bearer | runs one index pass now → `{run, filesSeen, newFindings}`. |

Errors: 400 bad slug/body · 401 bad token · 403 `{error:'refused', reason}` sim-rail refusal · 404 unknown item · 409 pass in flight · 413 too large · 503 secret unset.
Bearer = `Authorization: Bearer <EVIDENCE_OPS_SECRET>`.

## Asks
1. `server/routers/ec-router.ts`: server-side proxies `/api/ec/health|runs|findings` → `EC_URL` (503 `{status:'unreachable'}` when EC is down). Forward `?tenant=` from the page's current tenant if you want tenant-scoped tables; without it EC aggregates.
2. `/api/ec/ingest` proxy with a 15 MB `express.json` limit on that route only; EO adds the bearer server-side (never ship the secret to the browser).
3. `evidence/EcEvidenceReader.ts`: `GET /api/items?tenant=&controlId=` with the bearer; empty store → `[]`. Feed control detail + `EvidencePackager` (bytes via `/api/items/:id/content`). **Must not change any verdict** (EC items are "present for review", never SAT).
4. Nav entry for `page-ec`; delete `discovery/EvidenceImporter.ts`.
5. EO env: `EC_URL` (default `http://127.0.0.1:4001`), `EVIDENCE_OPS_SECRET`.

## Acceptance (from the plan)
Route tests against a seeded fake EC; reader returns no items on an empty store; verdicts identical with and without EC items.
