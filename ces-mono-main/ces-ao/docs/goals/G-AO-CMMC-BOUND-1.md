# Goal Document — G-AO-CMMC-BOUND-1

**Date:** 2026-07-11
**Status:** CLOSED 2026-07-25 (GP-AO-BOUND-1); M1-M5 executed. **Phase-2 strict flip LANDED
2026-07-27** (`da77e09`) once registry coverage hit 100% — `CMMC_STRICT_DEFAULT = true`, fail-closed
is now the default; `cmmcMigrationExempt` (dev/sim) is the carve-out. See the final Implementation
Log entry.

## Job

Make every ces-ao admin operation CMMC-bounded: constrained by the CMMC configuration (level,
assessment scope, CUI boundary, live/sim kind) of the tenant it operates against.
`docs/context/REVIEW.md` (read-only audit, 2026-07-11) found this currently **FALSE** — all 85
commands run identically regardless of tenant CMMC posture. Every milestone below closes one or more
numbered gaps from that review (cited as G1–G7).

## Scope fence — sibling-root constraint (READ FIRST)

`TenantConfig` lives in `ces-shared/src/config/TenantConfig.ts:15-50`; `TenantRegistryRecord` lives
in `ces-tenant/src/registry.ts:72-180`. Both are **sibling project roots** ces-ao sessions may not
write to. Schema additions (`cmmcLevel`, `assessmentScope`, `cuiBoundary`) are filed as
**requirements against the siblings** (M0 below) and consumed only after they land, mirroring the
G-TENANT-M5 precondition pattern (blocked on upstream, parallel-safe otherwise).

## Dependencies / Prerequisites filed against sibling repos (M0)

**Not implementation — this is the requirements spec to hand to ces-shared and ces-tenant sessions.**

### Against `ces-shared` (`TenantConfig.ts:15-50`)
- `cmmcLevel: 'L1' | 'L2' | undefined` — optional for backward compatibility (see migration policy
  below).
- `assessmentScope?: { subscriptionIds?: string[]; resourceGroups?: string[]; ous?: string[] }` —
  in-scope boundary for the assessment.
- `cuiBoundary?: { resourceAllowlist?: string[]; tagKey?: string; tagValue?: string }` — resource
  allowlist or tag-based CUI boundary, consumed by ParameterMapper (M3).

### Against `ces-tenant` (`registry.ts:72-180`)
- Mirror the same three fields on `TenantRegistryRecord` (superset of TenantConfig today, per
  REVIEW.md line 32).
- Promote `kind: 'live'|'sim'` (registry.ts:179) to a field the registry API surfaces generically,
  not only to the stacksim subsystem (REVIEW.md gap G7) — no schema change needed, just confirm it
  is queryable outside `aoTenants.ts`.
- Registry load-time validation SHOULD reject records where `cmmcLevel` is set but
  `assessmentScope`/`cuiBoundary` is absent (partial-config foot-gun) — proposed as a sibling-side
  check; ces-ao cannot enforce this on records it doesn't author.

**Gate for M0:** a requirements memo (this section, copy-pasted into an issue/goal doc in each
sibling root by the founder or a session with write permission there) is filed. "Landed" is a
**concrete, checkable signal**, not the filing alone: a type probe (scratch `tsc` compile or grep)
against `ces-shared/src/config/TenantConfig.ts` and `ces-tenant/src/registry.ts` confirms
`cmmcLevel`/`assessmentScope`/`cuiBoundary` exist on both types. Until that probe passes, M0 is
"filed, not landed" and M4's live registry integration stays blocked (M2/M3 proceed regardless — see
their carve-outs below). The probe is re-run manually at the start of M4; no CI/version-pin
mechanism is assumed across repos.

## Migration / backward-compatibility policy (applies to all milestones)

**Decision: fail-open-with-warning during a migration window, fail-closed after.**

- Phase 1 (migration window, starts when M0 fields land): if `cmmcLevel` is absent on a resolved
  tenant record, `CmmcScopeGate` logs a structured warning (`evidence` stream + stderr) and allows
  the command to proceed exactly as today (no regression for existing tenants). A `--strict-cmmc`
  flag / `AO_CMMC_STRICT=1` env var, off by default, lets operators opt into fail-closed early for
  testing.
- Phase 2 (post-window — trigger: 100% of active tenant registry records carry `cmmcLevel`, verified
  by a startup registry audit script added in M2): flip the gate default to fail-closed — absence of
  `cmmcLevel` on a tenant blocks any command whose `cmmcPractices` is non-empty. **Current active
  tenant record count is unknown to this goal** (ces-ao does not own the registry); M5's audit-script
  run is the first point this goal has real data, and reports the actual count/coverage rather than
  assuming a number now.
- **Exception path:** a tenant record may be marked `cmmcMigrationExempt: true` (informal convention
  on the sibling registry record, filed as an M0 memo addendum, not a schema field this goal
  implements) to exclude it from the 100% denominator — e.g. a deprecated/archival tenant that will
  never migrate. The audit script reports coverage as `migrated / (total - exempt)`, logging exempt
  tenants by slug so the exception is visible, not silent, and one orphaned record can't stall the
  flip forever.
- Dry-run stays the default in both phases; this goal does not touch that default.
- The phase flip is a one-line default change plus a CHANGELOG entry, not new milestone work — call
  it out explicitly when M2's gate criteria are re-verified against a fully-migrated registry.

## Milestones

### M1 — GUI tenant=dev fix (no dependency on M0)
**Closes:** G5 (GUI hardcodes `tenant=dev` in `loadTenantConfig()`/`checkFirewallState()`,
`public/index.html:978-981,1093,1158-1168`).
**Work:** Thread the operator-selected tenant slug (already present elsewhere in the SPA state) into
both `loadTenantConfig()` and `checkFirewallState()` calls instead of the literal `'dev'`.
**File inventory:**
| File | Action | Lines |
|---|---|---|
| `public/index.html` | MODIFY | `978-981`, `1093`, `1158-1168` |
**Gate criteria:** grep `tenant=dev` (or `'dev'` literal in the two functions) returns zero hits
outside a documented default-value fallback; manual smoke test confirms param auto-fill and firewall
precheck both query the operator's selected tenant, not `dev`.
**Test plan:** extend a DOM/route-level test asserting the fetch URL for both functions includes the
SPA's selected tenant slug (1-2 new tests; minimal fetch-mock acceptable if no GUI scaffolding exists).
**Size:** XS (single file, ~4 call sites).

### M2 — CmmcScopeGate module + registry load-time validation (depends on M0 landing)
**Closes:** G1 (no CMMC level on TenantConfig — consumed here once M0 lands), G2 (`cmmcPractices`
never read back for validation), G6 (`infrastructure_model`/`excluded_entries` dead code — supersede
with the new fields rather than wiring the old ones).
**Work:**
- New `src/execution/CmmcScopeGate.ts`: exported `evaluate(tenantConfig, aoCommand): { allow: boolean; reason?: string; warning?: string }`. Compares `aoCommand.cmmcPractices`/`control_ids` against
  `tenantConfig.cmmcLevel`; implements the fail-open-with-warning / fail-closed phase policy above.
  **This module owns `--strict-cmmc`/`AO_CMMC_STRICT` flag parsing** (env var read directly;
  `--strict-cmmc` CLI flag threaded from `src/cli/index.ts` as a boolean into `evaluate()`'s caller
  context, same pattern as `--apply` today at `src/cli/index.ts:55,70`). M4 wires the gate into the
  execution path but does not re-implement flag parsing.
- Registry load-time validation (extend wherever `ao-commands.registry.json` is parsed, likely near
  `src/registry/RegistryBridge.ts`): assert every command's `cmmcPractices` entries resolve against
  `ces-shared/src/data/cmmc-l2-controls.reference.json` (exists, currently unused for this — REVIEW.md
  line 52). Fail startup (or log a startup error) on unmapped practice codes.
- Registry migration audit script (small CLI/npm script) reporting the % of tenant registry records
  carrying `cmmcLevel` — used to decide the Phase 1→2 flip.
- **G6 closure:** `infrastructure_model`/`excluded_entries` are not removed from the `TenantConfig`
  type (sibling-root edit, out of scope) but get a one-line "superseded by assessmentScope/
  cuiBoundary" comment at the type declaration once M0 lands, plus a grep-based unit test in
  `registryValidation.test.ts` asserting neither field is read anywhere in `src/execution/*` or
  `src/server/*` — so a future reintroduction fails CI instead of silently reviving dead code.
**File inventory:**
| File | Action | Lines/Functions |
|---|---|---|
| `src/execution/CmmcScopeGate.ts` | CREATE | new module (incl. `--strict-cmmc`/`AO_CMMC_STRICT` parsing) |
| `src/registry/RegistryBridge.ts` | MODIFY | add control-catalog validation near line 42 |
| `scripts/audit-cmmc-migration.ts` (or similar) | CREATE | new script |
| `test/registryValidation.test.ts` | CREATE | includes G6 dead-field grep-assertion test |
**Gate criteria:** unit tests cover: (a) command with L2-only practice against `cmmcLevel: 'L1'`
tenant → denied; (b) same against `cmmcLevel: 'L2'` → allowed; (c) tenant with `cmmcLevel` absent,
Phase 1 default → allowed + warning logged; (d) same, `AO_CMMC_STRICT=1` → denied; (e) registry
load with an invalid `cmmcPractices` code → startup validation error; (f) grep-based test confirms
`infrastructure_model`/`excluded_entries` have zero consumers in `src/execution/*`/`src/server/*`
(G6 closure verification).
**Test plan:** ~9-11 new unit tests in `test/cmmcScopeGate.test.ts` + `test/registryValidation.test.ts`.
**Size:** M (new module + validation wiring, no execution-path integration yet — that's M4).
**Mock/stub carve-out:** built and unit-tested against a mocked `TenantConfig` carrying the new
fields before M0 lands for real (same pattern as REVIEW.md's `G-TENANT-M5` precedent); only the live
registry integration in M4 is hard-blocked on the M0 landing signal above.

### M3 — ParameterMapper CUI-boundary checks (mock/stub carve-out mirrors M2; live integration depends on M0)
**Closes:** G3 (no CUI-boundary/in-scope-resources allowlist; `resources.*`/`param.source` free-form
copy, `src/execution/ParameterMapper.ts:31-43`).
**Mock/stub carve-out:** same as M2 — logic is built and unit-tested against a mocked
`tenantConfig.cuiBoundary` before M0 lands for real; only wiring against live sibling registry output
is blocked on the M0 landing signal.
**Work:** Extend `ParameterMapper`'s dotted-path resolution (`ParameterMapper.ts:34`) to check
resolved `resources.*` values against `tenantConfig.cuiBoundary` (allowlist or tag match) before
substitution. Fail-closed: a resource parameter outside the boundary blocks execution with a named
reason, not a silent pass-through. Apply the same Phase 1/2 migration policy as M2, with the
"absent `cuiBoundary`" case split into the two scenarios the sibling registry can produce:
- **Case A — pre-migration tenant** (`cmmcLevel` also absent): not-yet-migrated. Phase 1 → warn and
  allow (matches M2's tenant-level policy); Phase 2 → deny (tenant hasn't migrated at all).
- **Case B — foot-gun record** (`cmmcLevel` present but `cuiBoundary` absent — the partial-config case
  ces-tenant is only asked to SHOULD-reject at load time, so AO can't assume it never reaches this
  code): a **configuration error, not a migration gap** — always deny, in both phases, with a
  distinct reason string (`"cuiBoundary missing on cmmcLevel-scoped tenant"`). Intentionally stricter
  than Case A: opting into `cmmcLevel` scoping with no boundary is a higher-risk silent gap than
  simply not having migrated yet.
**File inventory:**
| File | Action | Lines/Functions |
|---|---|---|
| `src/execution/ParameterMapper.ts` | MODIFY | resolution logic near `31-43` |
**Gate criteria:** a D-family command (Data Protection & CUI Boundary) with a resource param outside
`cuiBoundary.resourceAllowlist` is denied in Phase 2 mode; same param inside the allowlist proceeds;
Case A (pre-migration) warns in Phase 1 and denies in Phase 2; Case B (foot-gun) denies in both
phases with the distinct reason string.
**Test plan:** ~8 unit tests covering allowlist match/no-match, tag-based match/no-match, Case A in
both phases, Case B in both phases.
**Size:** S.

### M4 — Wire CmmcScopeGate into execution + approval/apply gating (depends on M2, M3)
**Closes:** G1, G2, G3 (enforcement, not just detection), G4 (approval/apply gating is tenant-
agnostic — `SodGate.ts:11-13`, `mcp/ao-mcp-server.mjs:23`), G7 (promote `kind` beyond stacksim).
**Work:**
- Invoke `CmmcScopeGate.evaluate()` in `CommandExecutor.executeAoCommand` before context creation
  (REVIEW.md's own recommended insertion point, "before Step 3"). This is the milestone hard-blocked
  on the M0 landing signal (type-probe defined in the M0 section) — the gate module itself was
  already built/tested against mocks in M2/M3.
- Make Tier-3/approval defaults tenant-aware: tighten default `sodTier` (or add a floor) when
  `cmmcLevel: 'L2'` and `kind: 'live'` — a command that wouldn't normally require two-person approval
  does, against a hardened live L2 tenant. Additive check in `SodGate.ts`, not a replacement of the
  static `sodTier` field. **Explicit scope boundary:** this is the *only* SoD change in scope — a
  single additive floor keyed on `(cmmcLevel === 'L2' && kind === 'live')`. No other tenant attribute
  may drive SoD tier selection under this goal; no change to how approvals are requested, stored, or
  expired; no new approval roles or thresholds. Any broader SoD policy redesign is a separate goal.
- CLI `--apply` (`src/cli/index.ts:55,70`) and MCP `AO_MCP_ALLOW_APPLY` (`mcp/ao-mcp-server.mjs:23`)
  remain global switches but are now insufficient alone: `CmmcScopeGate` can still block apply for a
  specific tenant/command pair even when the global flag is set. Document this precedence explicitly.
**File inventory:**
| File | Action | Lines/Functions |
|---|---|---|
| `src/execution/CommandExecutor.ts` | MODIFY | `executeAoCommand`, insertion before context creation (near `76-102`) |
| `src/execution/SodGate.ts` | MODIFY | `requiresManualGate`, `11-13` (single additive floor only, see scope boundary above) |
| `src/cli/index.ts` | MODIFY | comment/doc only unless flag precedence needs code, near `55,70` |
| `mcp/ao-mcp-server.mjs` | MODIFY | comment/doc only unless flag precedence needs code, near `23,98-107` |
**Test technique precondition:** the "no auth chain invoked" gate criterion requires asserting
`AuthChain.createExecutionContext` is not called. Before writing the test, check whether
`test/commandExecutor.test.ts` already spies on or mocks `AuthChain` (likely, since
`createExecutionContext` needs mocking for any existing dry-run test). If so, extend it with a
call-count assertion; if not, introduce a minimal spy (`vi.spyOn`/`jest.spyOn`, matching whatever
mocking library the repo's existing tests already import — no new test-mocking dependency). One-time
setup cost inside M4, not a capability assumed to exist elsewhere.
**Gate criteria:** end-to-end test: L2-scoped command against a `kind:'live'`, `cmmcLevel:'L1'`
tenant is denied before any session/context is created (no auth chain invoked, per the spy/mock
technique above); same command against correctly-scoped tenant proceeds to dry-run; live-tenant L2
command with tightened SoD requires two-person approval even when its static `sodTier` alone would
not; confirm no SoD change other than the single additive floor is present in the diff.
**Test plan:** ~10-12 new/extended tests across `test/commandExecutor.test.ts` and `test/sodGate.test.ts`
(extending existing suites, matching the repo's pattern from G-TENANT-M5's `simTenant.test.ts`).
**Size:** M-L (touches the hot execution path; highest-risk milestone, needs full regression run).

### M5 — Full-suite regression + phase-flip readiness report
**Closes:** verification of all above; produces the go/no-go artifact for the Phase 1→2 flip.
**Work:** Run full `npm test` (171-test baseline + all new tests from M1-M4), `tsc` clean, `npm run
build` clean. Run the M2 migration audit script against the live tenant registry; report `cmmcLevel`
coverage % and recommend flip timing.
**File inventory:** none (verification only); implementation log entry appended to this file.
**Gate criteria:** full suite green (baseline 171 + new, target ~195-205 total); zero regressions;
migration audit report checked in as evidence.
**Test plan:** N/A — this milestone *is* the test plan execution.
**Size:** S (process/verification only).

## Must / Must-NOT

- MUST fail closed once Phase 2 is active; MUST fail open with a logged warning during Phase 1 —
  never fail open silently.
- MUST keep dry-run as the default execution mode throughout; this goal does not change that.
- MUST NOT write schema changes directly into `ces-shared` or `ces-tenant` — those are filed as M0
  requirements only, per the project-root write boundary.
- MUST NOT block M1 or M2's registry-validation half on M0 landing (M2's `CmmcScopeGate` logic can be
  built and unit-tested against a mocked/stubbed tenant config carrying the new fields before the
  sibling repos ship them for real; only the live registry integration in M4 is hard-blocked).
- MUST NOT expand into unrelated AO governance surfaces (evidence emission format, ApprovalStore
  persistence schema) beyond the tenant-awareness additions in M4.
- MUST NOT tighten `SodGate.ts` beyond the single additive `(cmmcLevel === 'L2' && kind === 'live')`
  floor defined in M4 — no other tenant field may drive SoD tier, no new approval roles/thresholds,
  no change to approval request/store/expiry mechanics (see M4 scope boundary).

## Acceptance Gate (goal-level)

- [ ] M0 memo filed; type-probe (M0 section) confirms fields landed before M4's live integration.
- [ ] M1-M5 gate criteria pass, including M2's G6 dead-field grep test and M3's Case A/B tests.
- [ ] Grep for `tenant=dev` literal in `public/index.html` (outside documented fallback) = 0.
- [ ] Grep confirms `CmmcScopeGate.evaluate()` is invoked in `CommandExecutor.executeAoCommand`
      before context/session creation.
- [ ] Full test suite green, count and delta recorded in Implementation Log.
- [ ] Migration audit report shows `cmmcLevel` coverage % (`migrated / (total - exempt)`), the
      exempt-tenant list if any, and a recommended Phase 2 flip date.
- [ ] M4 diff contains exactly one SoD change (the additive `cmmcLevel:'L2'`+`kind:'live'` floor).

## Implementation Log

**2026-07-11 — M1-M3 executed** (founder approved; commits pathspec-scoped on master):

- **M0:** requirements memo = the M0 section above; NOT yet filed into sibling roots (write
  boundary — founder to carry it, or grant a sibling session). Type probe run 2026-07-11:
  `cmmcLevel`/`assessmentScope`/`cuiBoundary` absent from both sibling types → **filed, not landed**.
- **M1** (`d07cc40`): `public/index.html` — new `getSelectedTenant()` helper (single documented
  `'dev'` fallback) threaded into `loadTenantConfig()` + `checkFirewallState()`; 3 new tests
  (`test/guiTenantSelection.test.ts`). Gate greps PASS. Manual browser smoke still open.
  Note: `executeCommand()` has its own separate `|| 'dev'` fallback — pre-existing, outside M1's
  two named functions, left as-is.
- **M2** (`623e9f6`): `src/execution/CmmcScopeGate.ts` (evaluate(), local `CmmcTenantFields`/
  `CmmcAwareTenantConfig` carve-out types, `AO_CMMC_STRICT` + strictCmmc option, Phase-flip
  constant); RegistryBridge load-time validation vs `cmmc-l2-controls.reference.json`;
  `scripts/audit-cmmc-migration.ts` + npm script; G6 dead-field grep test. 10 new tests, gates
  (a)-(f) PASS. **Deviations:** (1) registry validation WARNS instead of throwing — the live
  registry has **33 practice-code mislabels** (`.L2-` tags on controls the catalog classifies
  L1); hard-throw would brick startup on today's data. Pure validator returns full detail for a
  stricter caller. (2) `validateRegistryAtLoad` exported but not wired into AoServer/invokeCommand
  boot (M4 scope). (3) Reference JSON read by path, not via ces-shared dist export.
- **M3** (`dde01ea`): `ParameterMapper` CUI-boundary check for `resources.*`-sourced params
  (allowlist + tag match, Case A warn/deny by phase, Case B always-deny with distinct reason);
  denial = thrown Error (matches existing caller convention, zero caller changes). 9 new tests,
  all gates PASS incl. real F-14 D-family scenario. Interpretation: `tagKey`/`tagValue` matched
  as dotted-path lookup on tenantConfig (no per-resource tag metadata exists yet).
- **M5 (partial — verification of M1-M3):** `npm test` **197/197 (15 files)** — baseline 175 + 22
  new, zero regressions; `tsc --noEmit` clean; `npm run build` clean. Migration audit run against
  the live registry: **5 tenants, 0 exempt, 0 migrated, coverage 0.0%** (expected — M0 not
  landed). Phase 1 (fail-open-with-warning) is the active default.

**Blocked remainder:** M4 (wire gate into CommandExecutor before context creation; SoD additive
floor L2+live; apply-flag precedence) + final M5 rerun — both gated on the M0 type probe passing.

**NEW ISSUE surfaced (out of goal scope, needs its own fix):** 33 `cmmcPractices` mislabels in
`ao-commands.registry.json` (e.g. `AC.L2-3.1.1` where the reference catalog says `AC.L1-3.1.1`).
Under Phase 2/strict these would mis-gate 33 commands. Data-fix task against the registry JSON;
`npm test` surfaces the list via the (warning) validator.

## Revision log

**Rev 2 (2026-07-11)** — resolved GAP_ANALYSIS.md findings 1-8:
1. M3/M0 carve-out ambiguity → M3 now explicitly mirrors M2's mock/stub carve-out; only live
   registry wiring is blocked on M0.
2. `--strict-cmmc`/`AO_CMMC_STRICT` unassigned → assigned to `CmmcScopeGate.ts` in M2; M4 is
   wiring-only.
3. M3 absent-`cuiBoundary` ambiguity → split into Case A (pre-migration, warn/deny by phase) and
   Case B (foot-gun: `cmmcLevel` set, `cuiBoundary` absent — always deny, distinct reason string).
4. M0 "acknowledged and scheduled" untestable → replaced with a concrete type-probe (scratch
   compile/grep against sibling type files) as the landing condition.
5. G6 closure unverified → M2 adds a grep-based unit test asserting zero consumers of
   `infrastructure_model`/`excluded_entries`, plus a superseded-by comment at the type declaration.
6. Phase 2 flip lacked record count/exception path → added `cmmcMigrationExempt` convention (M0
   addendum) and coverage formula `migrated / (total - exempt)`; M5 reports actual counts.
7. M4 SoD scope-creep risk → added an explicit single-additive-floor scope boundary to M4, a
   matching Must-NOT clause, and an acceptance-gate diff check.
8. M4 spy/mock assumption → added a test-technique precondition: check for an existing `AuthChain`
   spy/mock in `test/commandExecutor.test.ts` first, extend or introduce minimally as needed.

**2026-07-25 — M4 + M5 executed; goal CLOSED (GP-AO-BOUND-1, monorepo-root session):**

- **M0 landing state at unpark:** ces-shared half LANDED (0.3.0, GP-SHARED-M0-1 `01612c4`:
  `cmmcLevel`/`assessmentScope`/`cuiBoundary` on `TenantConfig` + snake_case parsing; type probe
  passes). ces-tenant mirror NOT landed — `parseTenantRecord` (`ces-tenant/src/impl/tenant-file.ts`)
  maps fields explicitly and drops the new ones, so registry-resolved tenants surface
  `cmmcLevel: undefined` (Phase 1 fail-open covers exactly this window; the goal pack's launch gate
  named only GP-SHARED-M0-1, superseding this doc's both-siblings probe for the WIRING — the live
  data path remains a filed sibling requirement).
- **M4** (`da2f358`): `CmmcScopeGate.evaluate()` invoked in `executeAoCommand` BEFORE approval
  opening/context creation/session spawn; denial returns a persisted enforcement-evidence artifact
  (`evidence.metadata.cmmcGate`, new typed field on StructuredEvidence). Variable mapping moved
  ahead of context creation; CUI-boundary denials (new typed `CuiBoundaryDenialError` in
  ParameterMapper, same throw semantics) also terminate pre-auth with evidence. SoD single additive
  floor: write-shaped Tier 2 + `cmmcLevel:'L2'` + `kind:'live'` → manual gate (sim unaffected;
  exactly one SoD change in the diff, per scope boundary). `--strict-cmmc` CLI flag threaded
  (CLI → invokeAoCommand → ExecuteOptions.strictCmmc → evaluate); apply-flag precedence documented
  at CLI + MCP (`--apply`/`AO_MCP_ALLOW_APPLY` necessary but NOT sufficient — the gate can still
  deny). `validateRegistryAtLoad` wired into AoServer boot + CLI/MCP first registry load (deviation
  2 from M2 resolved). Carve-out types collapsed onto ces-shared 0.3.0 (`CmmcTenantFields` now only
  `cmmcMigrationExempt` + `kind`). Tests: `cmmcExecutorGate.test.ts` (8 — denial-before-AuthChain
  via vi.mock spy per the test-technique precondition; E2E had no AuthChain mock, so this was the
  one-time setup) + `sodGate.test.ts` (6).
- **Registry label debt** (`aa51dad` + `18335af`, GP-AO-BOUND-1 M2): all 33 mislabels fixed — 31
  mechanical `.L2-`→`.L1-` relabels; 2 judgment relabels H-07/H-08 `RE.L2-3.10.1` (CMMC 1.0
  leftover family) → `MP.L2-3.8.9` (backup-CUI practice). Validator 0 violations; then STRICT FLIP
  (founder-confirmed 2026-07-25): `validateRegistryAtLoad` throws — mislabels now fail startup.
- **M5 final:** `npm test` **213/213 (18 files)** — 197 pre-goal baseline + 16 new (8+6+2), zero
  regressions; `tsc --noEmit` clean; `npm run build` clean. Migration audit (evidence:
  `docs/cmmc-migration-audit-2026-07-25.md`): 7 tenants, 0 exempt, 0 migrated, **coverage 0.0%** —
  Phase 2 flip NO-GO until (1) ces-tenant M0 mirror lands, (2) records migrate, (3) audit = 100%.
  Phase 1 fail-open-with-warning remains the default; every fail-open pass is now itself evidenced
  via `evidence.metadata.cmmcGate.warning` (GP-AO-BOUND-1 M3).
- **Acceptance gate checklist:** all boxes pass except the Phase-2 flip (explicitly reported no-go
  with preconditions, which is what the box asks for). `tenant=dev` grep: unchanged from M1 (0
  outside documented fallbacks). `CmmcScopeGate.evaluate` grep in executor: present before
  context/session creation. SoD diff: exactly one additive floor.

**2026-07-27 — record-migration + Phase-2 flip attempt (GP-AO-BOUND-1, "complete the spokes"):**

- **ces-tenant M0 mirror LANDED** (ces-tenant 0.5.0): type probe passes — `parseTenantRecord`
  (`ces-tenant/src/impl/tenant-file.ts`) now maps `cmmc_level`/`assessment_scope`/`cui_boundary`/
  `cmmc_migration_exempt` and load-time-rejects the Case-B foot-gun (`cmmc_level` set + `cui_boundary`
  absent → throw). The registry *code* path can now carry CMMC posture end-to-end.
- **AO part done** (`c059e7a`): AO's `dev` dry-run placeholder record marked
  `cmmcMigrationExempt: true` at its source of truth (`plan-data/dev/dev.json`) — not a real
  assessment target, excluded from the Phase-2 denominator.
- **Phase-2 flip HELD — precondition unmet** (`7fa4d36`): flip trigger is 100% registry coverage;
  `npm run audit-cmmc-migration` = **0.0%** (7 records: `dev`, `vfsgov-xtra` live; 5 sim — all in
  `~/.ces/tenants`, none carry `cmmcLevel`). Trial `CMMC_STRICT_DEFAULT = true` this session
  fails-closed on every unmigrated tenant and reds **107/213 tests** (E2E + sim fixtures have no
  `cmmcLevel`) — the goal's designed "not-ready" signal, reverted. Note: AO's `dev` exemption does
  NOT move the audit — the audit reads the already-seeded `~/.ces` registry copy, whose exemption
  bit lives outside AO's writable area.
- **FILED REQUIREMENT — against ces-tenant / founder (registry-data migration, blocks the flip):**
  The 7 live/sim records under `~/.ces/tenants` (and their canonical sources) must be migrated
  before the Phase-2 flip can land. AO cannot write `~/.ces` (task write-boundary; it is neither
  AO's project root nor an authorized destination this turn). Required per record:
  - **`dev`** (live): propagate `cmmcMigrationExempt: true` from `plan-data/dev/dev.json` into the
    seeded `~/.ces/tenants/live/dev.json` copy (or delete the stale seed and let AO re-seed).
  - **`vfsgov-xtra`** (live): populate `cmmc_level` (`L1`|`L2`) **and** `cui_boundary`
    (allowlist or tag) — the mirror throws on a partial config — plus `assessment_scope` if scoped;
    or mark exempt if it is not a real assessment target.
  - **5 sim records** (`clean-tenant-mfa-baseline`, `probe-state-inspect`, `sim-m365-azure`,
    `sim-m365-only`, `sim-m365-sentinel`): decide policy — sim tenants are ephemeral and pane-created
    (count drifts), so the cleanest path is a **default `cmmcMigrationExempt` for `kind:'sim'`
    records** (candidate ces-tenant enhancement: stamp exemption at `createEphemeralSimTenant`), else
    each must carry `cmmc_level` + `cui_boundary`.
  Once the audit reports 100%, the flip is a one-line change (`CMMC_STRICT_DEFAULT = true`) plus a
  CHANGELOG entry — no other AO code changes (the gate, evidence, SoD floor, and CLI/MCP precedence
  are all already wired and tested).
- **Gates:** `npm test` **213/213 (17 files)**, `tsc --noEmit` clean, audit run (0.0%). No
  regressions; the flip was trialed and reverted, not shipped.

**2026-07-27 (later) — Phase-2 strict flip LANDED (GP-AO-BOUND-1, "complete the spokes"):**

- **Precondition now MET.** `npm run audit-cmmc-migration` = **100.0%** (7 records: 6 exempt
  [`dev` + 5 sim], 1 migrated [`vfsgov-xtra` L2]) after ces-tenant landed sim-default-exempt
  (`583a474`) and the `~/.ces` registry data migrated. The blocker filed in the earlier 07-27
  entry is CLEARED.
- **The flip** (`da77e09`): `CMMC_STRICT_DEFAULT` `false` → `true`. An unmigrated, **non-exempt**
  tenant carrying `cmmcPractices` now fails closed before any context/session work, with
  enforcement evidence. Per-call Phase-1 fail-open remains reachable via `strictCmmc:false`
  (`--strict-cmmc=false`).
- **Two enabling changes** (`19a14ba`, committed first so both commits stayed green):
  1. **Gate/mapper honor `cmmcMigrationExempt`.** `CmmcScopeGate.evaluate` (and
     `ParameterMapper.checkCuiBoundary`) now treat an exempt record — the `dev` placeholder and
     ephemeral `kind:'sim'` tenants (ces-tenant default) — as a clean allow even with `cmmcLevel`
     absent. Previously exemption only affected the audit denominator, so a bare flip would have
     failed dev/sim commands closed in production (real regression, not just tests). Real
     non-exempt unmigrated tenants still fail closed → Phase-2 coverage not weakened.
  2. **Evidence `strict` flag corrected.** `CommandExecutor` recomputed `strictActive` for the
     evidence artifact without consulting `CMMC_STRICT_DEFAULT`; the flip exposed it mislabeling a
     default-strict denial as `strict:false`. Now mirrors `isStrictMode` (opts > env > default).
- **Test fixtures made strict-compatible** (the real work, per the goal's fail-closed design):
  E2E fixture marked `cmmcMigrationExempt` (synthetic pipeline fixture, not an assessment target);
  the two tests that asserted fail-open *as the default* (`cmmcScopeGate` (c),
  `cmmcExecutorGate` Phase-1) now opt into non-strict explicitly — they still exercise the
  Phase-1 path, which is now a path rather than the default; sim test passes unchanged (its sim
  config is exempt-by-default from ces-tenant). +4 tests total (exempt-through + absent/non-exempt
  fail-closed, at unit and executor levels).
- **Gates:** `npm test` **217/217 (17 files)** (213 pre-flip + 4), `tsc --noEmit` clean,
  `npm run build` clean, `npm run audit-cmmc-migration` **100.0%**. No regressions.
- **FOUNDER-RATIFY:** the flip now gates live on `vfsgov-xtra`'s `cmmc_level` (L2) + `cui_boundary`
  values from the registry. AO consumes them; the VALUES remain the founder's to ratify (per this
  turn's EXCLUDE — not re-decided here).
- **Status:** the Phase-2 flip acceptance-gate box (previously reported no-go with preconditions)
  is now **GO / landed**. All other boxes remained satisfied.
