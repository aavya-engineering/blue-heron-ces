# Goal Document - G-MUSTER-DISCOVERY-1: the discovery engine (registry-walking get_command executor, muster-api lane)

**Date:** 2026-07-11 (rehomed from `G-DISCOVERY-1`) - **Type:** /goal.
**Owning repo:** ces-muster - `muster-api` discovery lane. NOT a new sibling repo, NOT a
ces-stamper lane. This goal file was originally staged in `ces-strategy/docs/goals/` as
`G-DISCOVERY-1.md` pending FD-DISCOVERY-OWNER ratification; it MOVED here, renamed, on
ratification.
**Provenance:** founder directive 2026-07-11 working-system program
(ces-strategy/docs/context/VAULT.md:40-42; lane analyses
ces-strategy/docs/context/masterplan/cross-cutting.md sec. 1 and
ces-strategy/docs/context/masterplan/muster-modes.md dep 1; master plan
ces-strategy/docs/MASTER-PLAN-2026-07-11.md).

**Ownership ruling (founder HIL decision, 2026-07-11, FINAL - FD-DISCOVERY-OWNER):**
neither lane analysis's recommendation was taken. The cross-cutting lane recommended a new
sibling repo (`ces-discovery`); the muster-modes lane preferred a ces-stamper lane. The
founder ratified a third option, the **muster-api lane**, verbatim: *"that is what Muster
does - it should leverage existing known proven code to do it."* Discovery lives in
ces-muster's muster-api as a discovery lane, leveraging ces-tenant's proven
`PersistentSessionFactory` (the extracted Stamper engine) plus Stamper's registries AS
DATA. This directly supersedes `TENANT-CONNECTION.md`'s prior must-NOT ("the discovery
engine must NOT be built inside Muster") - see that file's 2026-07-11 dated override note
for the surviving intent (Muster must never hand-roll session/auth; the SPA still never
touches tenants).

**Why muster-api, not the SPA:** muster-api is pure Node running on Windows/server
infrastructure - the browser constraint that motivated keeping tenant/session logic out of
the SPA never applied to muster-api. muster-api already brokers all tenant-facing work per
`TENANT-CONNECTION.md`; a discovery lane inside it is an extension of that existing
broker role, not a new architectural surface. The SPA continues to see only discovery
results, never sessions, tokens, or registries.

## Job

Build the UNBUILT engine that muster-readiness needs for LIVE sessions: a minimal v1
READ-ONLY discovery lane inside muster-api that:

1. Resolves the target tenant via the ces-tenant registry (`kind: 'live' | 'sim'`) and
   opens sessions via `PersistentSessionFactory` / `StacksimEnvironment` - live/sim parity
   comes free from tenant kind, exactly as ces-tenant prescribes. muster-api already
   consumes ces-tenant's HTTP token/endpoint surface for credential resolution
   (`TENANT-CONNECTION.md`); this lane is the first muster-api consumer of the
   `PersistentSessionFactory` session surface itself, justified by muster-api's Node/
   server runtime (no browser constraint).
2. Walks BOTH Stamper registries AS DATA via `CommandRegistry` (223 entries / 201 runnable
   gets). Registry access follows muster's existing vendor-with-drift-check convention
   (the ces-spine precedent used for `FD-PLANNER-OUTPUTS`): registry files are read as data
   - either read directly from `ces-stamper/src/registry` in place, or via a
   copy-with-drift-check consistent with how this goal's originating lane analyses
   described registry access - no fork, no independent copy that can silently drift.
3. Executes each entry's `get_command` READ-ONLY; honors `manual_only` (skip, record as
   such); records per-command auth-tier degradation ("unavailable at this auth tier" as a
   fact-status, per the residual-elicitation-ladder design - degradation is per-command,
   never all-or-nothing).
4. Emits readiness-result.v1 `observations[]` (entry_id, control_ids, derived_posture,
   objective_coverage, confidence) + capture files referenced by `raw_capture_ref` -
   never inline output.
5. LIFTS the executor semantics already proven in Stamper's assess lane
   (ces-stamper/src/server/routes/assess.routes.ts:74-78, 305-317, 380-493 - variable
   resolution, manual_only skip, per-entry evidence rows) rather than reinventing; that
   lane is 80% of this executor, trapped inside a GUI SSE route.

The output feeds Muster's own import seam directly (same process, no serialization hop
required beyond what the seam already expects): muster-readiness needs ZERO new network
code for live readiness, and the discovery lane needs zero new IPC to reach plan mode's
import path.

## Must-NOTs

- MUST NOT reintroduce hand-rolled tenant/session/auth resolution anywhere in Muster - the
  lane consumes ces-tenant's `PersistentSessionFactory` exactly as ces-tenant prescribes,
  never a parallel implementation (`TENANT-CONNECTION.md`'s surviving must-NOT intent,
  post-override).
- MUST NOT let the Muster SPA touch tenants, sessions, or registries - the lane lives
  entirely in muster-api; the browser sees only discovery results
  (`TENANT-CONNECTION.md`'s architectural rule, unchanged by this goal).
- READ-ONLY, absolutely: get_command and evidence_commands only; NEVER executes a
  set_command; enforce structurally (the lane has no code path to a set), not by
  convention.
- No second payload format: output validates against readiness-result.v1 - the schema is
  G-MUSTER-READINESS-1 M1's; do not design the observation shape twice (GO-1
  open-decision-3: decide the format once).
- No registry fork - registries are read as data in place or via copy-with-drift-check
  only; never an independently-maintained copy.
- No second SPRS implementation - the lane emits observations; scoring is Muster's
  (`computeSprs`, one-SPRS rule).
- Boundary principle: gaps found in Stamper's registries or ces-tenant surfaces are filed
  against those owners.

## Acceptance gate (objectively checkable)

1. Discovery lane run against a stacksim sim tenant completes the runnable-get walk and
   emits a file that VALIDATES against the readiness-result.v1 schema; manual_only entries
   appear as skipped-with-status rows, not omissions.
2. Per-command auth-tier degradation demonstrated: a run at a restricted tier records
   "unavailable at this auth tier" statuses instead of failing the walk.
3. The emitted file, fed through Muster's import seam, produces boundary-draft behavior
   equivalent to the canned-fixture path (asserted via G-MUSTER-PLAN-2's equivalence
   test).
4. Both-tenant parity: sim run mandatory for this gate; a live run (subset acceptable
   under the smoke policy) once FD-LIVE-SMOKE's hold lifts - identical observation SHAPE
   asserted across kinds.
5. Own suite green (folded into ces-muster's suite); zero writes verified (sim ledger
   shows no mutation entries from the run).

## Preconditions

- FD-DISCOVERY-OWNER ratified - DONE (this document; muster-api lane, 2026-07-11).
- G-MUSTER-READINESS-1 M1 (the schema) landed.
- G-STAMPER-STAB-1 M1 + M4 landed (do not extract from a half-cutover executor; adapter
  KEEP decision recorded - cross-cutting O6; FD-ADAPTER-SHIM resolved KEEP, 2026-07-11).

## Effort

L (weeks): M if cleanly extracted from the assess lane, L with both-tenant parity tests
(both lanes' estimates). BLOCKS live readiness sessions (gate iii) and the tester
real-tenant discovery leg; does NOT block payload definition or plan-mode-from-payload
(fixtures suffice).

## Pointers

- ces-strategy/docs/context/masterplan/cross-cutting.md sec. 1 (options table, spec) and
  sec. 2 (payload flow map) - historical framing; the muster-api lane supersedes the
  option this document originally recommended.
- ces-strategy/docs/context/masterplan/muster-modes.md dep 1 (the stamper-lane
  counter-recommendation, recorded for provenance; also superseded).
- ces-strategy/docs/MASTER-PLAN-2026-07-11.md sec. 2 and sec. 4 (roster row, FD-DISCOVERY-
  OWNER resolution record).
- ces-stamper/src/server/routes/assess.routes.ts (the executor to lift).
- ces-tenant/README.md:46-59 (registry roots, StacksimEnvironment, live refusal).
- ces-muster/TENANT-CONNECTION.md (the 2026-07-11 dated override note recording this
  ruling against the prior must-NOT).
- ces-muster/docs/design/residual-elicitation-ladder.md:160-193 (auth tiers, degradation).
- ces-strategy/docs/data/registry-objective-coverage-2026-07-10.json (runnable-get
  census).
