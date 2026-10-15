# REQ-ces-tester-eo-tenant-on-assessment-reads

- **From:** ces-eo (fix batch 2026-09-27, step FX-EO8)
- **To:** ces-tester (demo engine: EO acts, e2e run, show ops)
- **Status:** OPEN
- **Filed:** 2026-09-27

## Need
FX-EO8 scopes EvidenceOps' assessment reads to the requested tenant. Before, `GET /api/assessment`,
`/api/sprs`, `/api/sprs/history`, `/api/controls` and `/api/controls/:controlId` returned the
snapshot of whichever tenant was saved last in that storage root. After FX-EO8 each of them
requires `?tenant=<slug>`: no tenant → **400** `tenant required`, unknown tenant → **404**, and
a tenant with no assessment → 404 (never another tenant's snapshot).

ces-tester calls these routes **without** a tenant, so after FX-EO8 they return 400. Most call
sites are best-effort (`.catch(() => undefined)` / "never throws"), so the demo does not crash,
but the EO panes lose their numbers (score, control counts, MFA control detail).

## Call sites (read-only grep, 2026-09-27)
| File | Line(s) | Route |
|---|---|---|
| `src/demo/acts/act-run.ts` | 615, 616, 1749, 1750 | `/api/assessment`, `/api/sprs` |
| `src/demo/e2e-run.ts` | 1541, 1544, 1552 | `/api/assessment`, `/api/sprs`, `/api/controls/:id` |
| `src/demo/eo-leg.ts` | 208 | `/api/controls/:id` |
| `src/demo/eo-ui-driver.ts` | 125 | `/api/controls/:id` |
| `src/demo/show/ops/eo-review-op.ts` | 210, 211, 318, 319 | `/api/assessment`, `/api/sprs` |
| `src/demo/show/ops/eo-show-change-captured-op.ts` | 175, 176 | `/api/assessment`, `/api/sprs` |
| `tests/demo-show-eo-op.test.ts`, `tests/demo-eo-ui-driver.test.ts` | (URL expectations) | same |

`eo-leg.ts:281` already calls `/api/assess?tenant=${opts.slug}`; the same slug is the one to send.

## Ask
Append `?tenant=<slug>` (URL-encoded) to each call above, using the slug the act already assessed
(`opts.slug` / the armed tenant). Update the two test files' expected URLs.

## Acceptance (EO side, already in place)
`ces-eo/tests/eo/server/tenant-reads.route.test.ts` shows the contract: with `?tenant=` each
route returns that tenant's own snapshot; without it, 400 `tenant required`.
