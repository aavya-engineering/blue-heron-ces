# REQ: ces-stamper: the Muster results token must belong to the tenant that pushed the plan

**Filed by:** ces-muster (FX2-MU1, 2026-09-27)
**Target module:** ces-stamper
**Priority:** P1 (results delivery returns 404 if the token is from the wrong tenant or has the wrong role)

## What changed in Muster
Muster's plan hand-off routes now check role and tenant:

| Route | Roles allowed | Tenant rule |
|---|---|---|
| `POST /api/plan/push` | `prime`, `bhd_operator` | The first push of a `tenant_slug` claims it for the caller's Muster tenant (`<slug>/state/muster-owner.json`). Pushes from any other tenant get 404. |
| `POST /api/plan/results` | `bhd_operator` | Only the tenant that owns the slug is accepted. Any other tenant gets 404. |
| `GET /api/plan/status` | every member role | Only the owning tenant is accepted. Any other tenant gets 404. |

The wrong role gets 403. A slug that is unclaimed, belongs to another tenant, or has no matching plan returns
the same 404 body, `{ "error": "No such plan for this tenant" }`.

## Ask
- `CES_MUSTER_API_TOKEN` (read by `src/core/ExecutionResultsPublisher.ts`) must be a Muster `bhd_operator`
  token from the **same Muster tenant** that pushed the plan. A token from a `prime` user or from another
  tenant is now refused. That delivery outcome is `failed` with HTTP 403 or 404, and the manifest stays on
  disk for a retry, which is existing behaviour.
- Document this in Stamper's env notes. Optional: say in the `[results-delivery]` log line that a 404
  can mean "wrong tenant token".

## Notes
- Plans pushed before this change have no `muster-owner.json`, so results and status for them return 404.
  Re-push to claim the slug. This affects sim data only.
