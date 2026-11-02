# G-MUSTER-DISCOVERY-1 — implementation log (sibling to the goal file)

Gate results recorded here (goal-file-untouched convention, per the G-TENANT-M3
precedent). Executed under GP-MUSTER-1 M1.

## Acceptance gate ledger

| Gate | Status | Date | Evidence |
|---|---|---|---|
| 1 — sim walk emits schema-valid file, manual_only recorded | **PASS** | 2026-07-12 | `tests/discovery.live-sim.test.ts` (self-booting live stacksim walk), commit `ce1d389` |
| 2 — restricted tier records "unavailable at this auth tier" per command | **PASS** | 2026-07-25 | `runDiscovery` now emits per-entry `statuses[]`; degradation records the literal normative string (`AUTH_TIER_UNAVAILABLE`). `tests/discovery.test.ts` "GATE 2" describe: restricted-tier walk (Graph `Authorization_RequestDenied` signature) completes, denied commands carry the fact-status, permitted reads land `ok`, `manual_only` recorded — never silent, never all-or-nothing. `isDegradation` extended to match Graph's real `insufficient privileges` / `authorization_requestdenied` wording (previously misclassified as `failed`). |
| 3 — emitted file through the import seam == canned-fixture path | **PASS** | 2026-07-25 | `src/features/discovery/__tests__/executorImportEquivalence.test.ts`: a REAL executor walk (all outcome classes incl. a Gate-2 denial) wrapped in the v1 envelope, parsed + schema-validated by `parseReadinessResultFile`, reduced by `discoveryResultsFromPayload`, then `synthesizeFactsFromDiscovery` + `inferBoundaryDrafts` outputs asserted identical to the direct DiscoveryResult[] path (PLAN-2 equivalence discipline). Non-vacuous (facts + drafts non-empty); FCA carried through the file (unknown → `unsure`, unknown never drafts). |
| 4 — live-run parity | **BLOCKED** | — | Founder-controlled FD-LIVE-SMOKE hold. Sim-side shape assertions in place; live subset run + cross-kind shape assertion to execute on release. |
| 5 — suite green + zero writes | **PASS** | 2026-07-25 | Zero-writes: live-sim test "GATE 5 zero-writes" — walk runs against `stacksim serve m365_azure`, then `POST /ledger {type: create\|mutate, from: walk-start}` both return `[]` (boot-time SeedEngine creates are pre-walk and excluded by `from`). Full board: root tsc clean, muster-api tsc clean, SPA 294/294 (45 files), muster-api 263 passed + 3 env-skips (22 files), e2e 9/9, drift 60/60 OK. |

## Notes

- The `/ledger` query surface wraps results as `{ data: LedgerEntry[] }` — first
  zero-writes assertion compared the wrapper and failed on shape; fixed to unwrap.
- `statuses[]` lives on `DiscoveryRunResult` (run bookkeeping surface). The
  readiness-result.v1 observation schema is closed (`additionalProperties: false`)
  and versioned 1.0.0 shared by four producers — persisting per-command statuses
  INTO the payload (e.g. as elicitation-ladder residual facts) would be a schema
  change and is deliberately NOT taken here; it belongs with a future schema-rev
  decision if the residual-elicitation UI needs it. Founder-adjacent; flagged, not
  resolved.
- `discoveryService.ts` is imported cross-package by the SPA-side Gate 3 test
  (pure module, zero imports) — it is now typechecked by BOTH tsconfigs; keep it
  dependency-free.
