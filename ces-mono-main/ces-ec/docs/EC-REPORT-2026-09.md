# EC report — 2026-09

Evidence Collector (EC) = manual evidence intake + a hash-verified integrity ledger. It assigns no verdicts.
Plan: `ces-strategy/docs/context/evidence-collector/PLAN.md`. Contract: ces-shared 2.7.0 `types/evidence-collector` (EC contract 1.0.0).

## 2026-09-28 feature completion (EC-M2M3)

### Before → after
| Item | Before | After |
|---|---|---|
| EC module root | did not exist (launcher pointed at a non-existent `../eo/src/ec/index.ts`) | `ces-ec/` mono workspace (TypeScript/NodeNext, vitest, `docs/`), registered in the root `package.json` `workspaces` |
| M2 health | none | `GET /api/health` → contract `EcHealth` (+ `contractVersion`, `simOnly`, `reasons`); always 200, `degraded` when the secret is unset |
| M2 authenticated upload | none | `POST /api/ingest`, bearer `EVIDENCE_OPS_SECRET` compared constant-time (SHA-256 digests + `timingSafeEqual`); unset secret → 503; strict body (`verdict`/`dryRun` → 400); decoded cap 10 MB → 413; writes `items/<itemId>.{bin,json}` + ledger row |
| M2 run / finding / item lists | none | `GET /api/runs`, `GET /api/findings` (plain arrays, EO page shape; no `tenant` = all admitted tenants), `GET /api/items?tenant=` + `GET /api/items/:id/content` (bearer) |
| M2 index trigger | none | `POST /api/index?tenant=` (bearer) |
| M2 tenant scoping | none | every route resolves through `getEcTenantRoot` (throws on a bad slug → 400) |
| M2 sim rail | none | `CES_EC_SIM_ONLY` on unless exactly `0`; only registry `kind:'sim'` tenants with loopback endpoints admitted; unregistered tenants always refused; every refusal → stderr + `refusals.jsonl` under EC's module root |
| M3 index pass | none | reads Stamper `state/execution-results-*.json` (not `*.delivery.json`; validated against execution-results 1.x) and `evidence/**` read-only, plus EC's own items; SHA-256 ledger (`ledger-state.json` + append-on-change `ledger.jsonl`); findings `HASH_DRIFT` (high), `STALE` (low, `EC_STALE_DAYS`=90), `UNPARSEABLE` (high, incl. unreadable), `EMPTY_READ` (high) |
| M3 empty pass | n/a | run status `empty` + `EMPTY_READ` finding — never `success` |
| M3 triggers | n/a | startup pass (after listen), every `EC_INDEX_INTERVAL_MIN` (15) via an unref'd timer, on demand |
| Findings flood control | n/a | open findings deduped on checkId+subject; STALE / UNPARSEABLE / EMPTY_READ auto-resolve when the condition clears; HASH_DRIFT stays open for review |

### Start command (for M4b)
`npx tsx src/index.ts` with **cwd = the ces-ec module root**. Port `EC_PORT` (default **4001**), host `EC_HOST` (default `127.0.0.1`). Also `npm run start -w ces-ec` from the mono root. Verified by `test/entry.test.ts` (spawns exactly this command).

### Environment
`EC_PORT`, `EC_HOST`, `CES_EC_SIM_ONLY` (default on), `EVIDENCE_OPS_SECRET`, `EC_STALE_DAYS` (90), `EC_INDEX_INTERVAL_MIN` (15), plus the shared `CES_PIPELINE_ROOT` (EC store = `<root>/EvidenceCollector/storage/<slug>/`) and `CES_TENANT_ROOT` (ces-tenant registry).

### Plan acceptance criteria → tests (all call production code over real HTTP or the real pass)
| Criterion (PLAN Testing Strategy, M2/M3) | Test |
|---|---|
| Wrong token → 401; constant-time compare | `service.test.ts` "auth on POST /api/ingest" (wrong, different-length, missing, unset→503, `tokensMatch`) |
| Non-sim tenant refused while the rail is on | `service.test.ts` "sim rail" (live 403 + logged, unregistered, non-loopback sim, every route, `=0` opt-out, `false` keeps rail on); `scheduler.test.ts` startup refusal |
| Ledger hash matches content | `service.test.ts` "stores the item; recorded and ledgered sha256 match"; `indexPass.test.ts` "ledger" |
| Empty index → `empty` + `EMPTY_READ` | `indexPass.test.ts` "EMPTY_READ" (3); `scheduler.test.ts` on-demand empty |
| Changed fixture → `HASH_DRIFT` | `indexPass.test.ts` "HASH_DRIFT" (file change, no false drift, tampered EC item) |
| STALE / UNPARSEABLE | `indexPass.test.ts` "STALE" (3), "UNPARSEABLE" (2), "UNPARSEABLE (unreadable)" |
| Never writes into Stamper | `indexPass.test.ts` "read-only against Stamper" (byte + mtime snapshot) |
| Startup / 15 min / on demand | `scheduler.test.ts` (fake timers), `entry.test.ts` |

Fail-first evidence: one real defect caught on first run (a tampered EC item's ingest-mismatch drift was deduped into the ledger-drift finding; fixed with a distinct subject). Mutation run against the finished code — each mutation below made the suite fail, then was reverted: rail default off (6 fail), empty→success (3), no drift (1), no auth check (5), no ingest ledger (1), no stale (3), no manifest validation (1), no size cap (1).

### Gates
`npx tsc --noEmit` clean; `npm test` **50/50** (4 files). Spot-checks after the workspace change: `ces-eo` and `ces-stamper` `npx tsc --noEmit` both clean. Lockfile updated with `npm install --package-lock-only --ignore-scripts` (small diff: ces-ec workspace entry, link, ces-shared version 2.2.3→2.7.0 catch-up); no full `npm install` was needed — dependencies resolve from the hoisted root `node_modules`.

### Commits
- `cfbb101` — ces-ec M2 + M3, tests, REQs, root workspace + lockfile.
- (this report, session log, instructions file) — follow-up commit on the same day.

### REQs filed (`docs/requirements/`)
- `REQ-ces-eo-ec-wiring.md` — M4a: route table, which routes need the bearer, proxy/reader asks.
- `REQ-ces-shared-ec-launcher.md` — M4b: EcLauncher hardcodes `src/ec/index.ts`; must become `src/index.ts` with cwd = ces-ec.
- `REQ-ces-stamper-ec-autostart.md` — M4b: `CES_EC_AUTOSTART=1` gate, real cwd, SSE cleanup.
- `REQ-ces-mono-ec-script.md` — root `ec` script (outside this session's grant).

### HONEST-OPEN / notes
- **Root `ec` script** not added (grant covered only the workspace entry) → REQ-ces-mono-ec-script.
- **In-flight guard (409)** exists but the pass is synchronous, so overlap cannot occur in one process today; not separately tested.
- **Refusal log growth:** scheduled passes log a refusal for each non-admitted tenant every interval (≈96 rows/day/tenant). Acceptable for now; rotate or dedupe later if it matters.
- **Scheduled discovery** = Stamper plan-data tenant dirs ∪ EC tenant dirs; a Stamper tenant not registered in ces-tenant (or not `kind:'sim'`) is never indexed. Note: `FileTenantRegistry.get()` may migrate a legacy record forward into the registry root (ces-tenant's documented behavior).
- **Legacy manifests:** the existing on-disk demo manifest predates the execution-results contract (no `contractVersion`, verdict `"SAT"`) and will show as `UNPARSEABLE`. Current Stamper writes 1.1.0, so this is expected, not a Stamper defect.

Legend: EC-M2M3 = this session · M1–M4b = plan milestones · REQ = requirement file · HONEST-OPEN = open item with reason · SAT = satisfied.
