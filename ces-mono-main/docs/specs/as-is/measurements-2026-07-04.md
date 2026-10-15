# AS-IS Measurements — 2026-07-04 (commit a0d6ae1)

Shared measurement pass for the G-SPEC-2 baselines. Every number here is a real command
output on branch `g0-safety-net` at commit `a0d6ae1`, reproducible with the command shown.
Read-only: no product/config/test changes were made to obtain these.

## Source size + test-file ratio

`find <ws>/src -name '*.ts*' | grep -v .test. | xargs wc -l` for src LOC;
`find <ws> -name '*.test.ts*' -o -name '*.spec.ts'` for test files.

| Module | src LOC (ts/tsx, excl. tests) | test files | test files / 1k src LOC |
|---|---:|---:|---:|
| ces-shared | 2,811 | 11 | 3.9 |
| ces-stamper | 22,843 | 14 | 0.6 |
| ces-eo | 26,409 | 49 | 1.9 |
| ces-ao | 3,785 | 11 | 2.9 |
| ces-planner | 40,341 | 11 | 0.3 |
| **total** | **96,189** | **96** | — |

## Coverage — NOT MEASURABLE without a workspace change (a finding in itself)

`npx vitest run --coverage` in ces-ao → **`MISSING DEPENDENCY: Cannot find dependency
'@vitest/coverage-v8'`**. Audit of every workspace:

| Module | runner | coverage tooling installed | coverage script | threshold config |
|---|---|---|---|---|
| ces-shared | vitest | none | none | none |
| ces-stamper | jest | jest core only (no reporter cfg) | none | none |
| ces-eo | jest | jest core only | none (test = `--no-coverage`) | none |
| ces-ao | vitest | none (`@vitest/coverage-v8` absent) | none | none |
| ces-planner | vitest | none | none | none |

**Conclusion:** no module can produce a coverage number without adding a dependency, and no
module enforces a threshold. Per the G-SPEC-2 scope guard (read-only, zero product changes) we did
NOT install coverage tooling. This is recorded as direct evidence for SPEC-05 (Testing) and SPEC-07
(CI/CD): coverage is neither measured nor gated anywhere. The test-file ratio above is the
available proxy; it replaces nothing but bounds the discussion.

## Supply-chain — `npm audit --omit=dev` per workspace

| Module | production vulnerabilities |
|---|---|
| ces-shared | 0 |
| ces-stamper | 0 |
| ces-ao | 0 |
| ces-planner | 0 |
| **ces-eo** | **3 (2 moderate, 1 high)** — **`multer` (HIGH)**, `js-yaml <3.15.0` (moderate), `uuid <11.1.1` (moderate); fixes available (`npm audit fix`). [Per the EO baseline live re-run: the high is multer.] |

No CI gate runs `npm audit`, so these persist unflagged. EO's are the only production findings.

## HTTP surface size

| Module | surface | count | note |
|---|---|---:|---|
| ces-stamper | route files (`src/server/routes/*.ts`) | 12 | modular routers |
| ces-eo | route registrations in `src/eo/server/EoServer.ts` | 104 | single-file monolith server |
| ces-ao | route patterns in `src/server/routes/*.ts` | 7 | + approvals routes; thin surface |
| ces-ao | registry commands (`ao-commands.registry.json`) | 95 | grew from 85 (recon) — A-19/20, D-11, F-13/14 added |

No HTTP surface carries an API version segment or header (grep for `/v1`/`/v2`/version headers → none in route paths). One cross-module schema contract (`docs/stamper-eo-schema-contract.md`) — status DRAFT.

## CI gates — `.github/workflows/ci.yml`

Only two run steps: `npm ci` and `npm test`. `npm test` = the root aggregate contract (pretest
builds ces-shared + ces-stamper, then runs shared/stamper/eo/ao/fe suites, mixed vitest + jest).
**No lint gate, no typecheck gate, no coverage gate, no `npm audit` gate, no golden-diff gate, no
build-artifact retention** beyond what `npm test` embeds. Triggers: push to master + g0-safety-net,
and PRs.

## Suite state (green-before baseline)

Per-workspace suites verified green during this session's other work at this commit: ces-shared
102, ces-stamper 211, ces-eo 548 (+3 skipped), ces-ao 171. Root `npm test` is the aggregate
contract; individual suites reproduced above. No test was modified to take these measurements.

## Deltas from the recon (`docs/context/SPEC_RECON.md`, 2026-07-01)

The recon is 3 days stale relative to this commit. Material changes since: AO registry 85 → 95
commands (Tier-3 approvals surfaced on CLI/GUI/MCP; ARM channel + F-13/14 network commands);
EO suite grew (548) with the G-FW-ALT UC-H objective work; the shared design system was re-themed
(no engineering-dimension impact); the founder-handoff secret exposure was resolved via history
rewrite (see [[ces-secret-exposure]]). Baselines must cite current file:line, not the recon.
