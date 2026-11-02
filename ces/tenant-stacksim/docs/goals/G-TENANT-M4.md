# Goal Document — G-TENANT-M4

**Provenance:** Founder-directed. M0 interface gate passed 2026-07-10 (founder review of
`ces-tenant`'s `src/*.ts` interfaces: approved as ratified). ces-tester promoted to named
consumer by founder direction 2026-07-10. This brief authored 2026-07-10, distributed from the
`ces-strategy` session that executed the M0 interface work. Self-contained — a fresh session in
this repo needs nothing outside this file, the design doc, `ces-tenant`'s `README.md` +
`src/*.ts` (read-only, in the sibling repo), and this repo's own `BACKLOG.md` (for the A9/S3
hazard tracking this goal closes).

## Job

`init-tenant`'s `writeSimTenantConfig()` (`src/config/SimTenantConfig.ts:123-145`) currently writes
JSON directly to `~/.stamper/tenants/<slug>.json` (or the flat variant, opt-in via
`--tenantprobe-flat`), matching Stamper's tenant-config schema **by convention**, not by
dependency (`SimTenantConfig.ts:15-19` explicitly documents this as deliberate — "not imported
from ces-shared — tenant-stacksim stays standalone with zero cross-package dependency"). This is
the named hazard **A9** (`BACKLOG.md:40,43`): sim-generated and live tenant configs can land in the
identical directory, indistinguishable except by filename convention, with zero discriminator
field. This goal changes `init-tenant` to emit tenant configs through `ces-tenant`'s registry API
instead of hand-constructing JSON, with `--stacksim` becoming a request for `kind: 'sim'` at the
registry level — structurally closing A9, not just documenting it as mitigated by opt-in flag
discipline.

## Must-NOTs (scope fence)

- Do not treat "structurally closed" as satisfied by the existing `--tenantprobe-flat` opt-in gate
  alone. That gate reduces *accidental* unconditional writes; it does not create a `kind`
  discriminator or a physically separate namespace. A9 is closed only when sim and live records
  *cannot* collide by construction (design §2.1, §7 "A9 migration": "the concrete, testable
  acceptance criterion for M4... not a separate initiative").
- Do not hand-construct JSON matching `ces-tenant`'s registry schema by convention, the same
  pattern that created A9 in the first place. Emission must go through `ces-tenant`'s registry
  config-emission API (design §6, per-consumer requirement for tenant-stacksim).
- Do not resolve the zero-dependency tension unilaterally in either direction. This is a real,
  founder-flagged open decision (design §6, §8 item 6) — do not silently adopt `ces-tenant` as a
  code dependency and declare the zero-dependency design goal obsolete, and do not silently keep
  `init-tenant` writing raw JSON and call the interface work satisfied by documentation alone. Both
  options must be stated in this goal's implementation log; picking one requires explicit founder
  sign-off captured there, not an implementer's default.
- Do not change `TenantProbe`'s directory-hardcoding behavior beyond what closing A9 requires — the
  `BACKLOG.md:40,43` note about `TenantProbe` having "no override" for its hardcoded directory is
  a related but separate item; do not silently expand this goal into a general `TenantProbe`
  refactor unless it's specifically required to make the `kind: 'sim'` namespace closure work.
- Do not touch anything under `psmodules/`, `azshim/`, or the store/ledger simulation engine itself
  — this goal is scoped to `init-tenant`'s config-emission path only, not the simulator's runtime
  behavior.

## Acceptance Gate

1. `init-tenant` emits tenant configs through `ces-tenant`'s registry API (or, if the founder
   resolves the zero-dependency tension in favor of staying standalone — see the open tension below
   — through a schema that a `ces-tenant`-side importer validates/ingests, with the boundary and
   rationale explicitly documented) rather than by directly writing JSON to
   `~/.stamper/tenants/<slug>.json`.
2. `--stacksim` (or `init-tenant`'s equivalent sim-creation path) produces a registry record with
   `kind: 'sim'` as a first-class field, not inferred from filename or directory convention.
3. **A9 is structurally closed**, verified concretely: sim-sourced and live-sourced tenant records
   cannot land in the same directory/namespace by construction (design §2.1's suggested shape:
   `~/.ces/tenants/sim/<slug>.json` vs. `~/.ces/tenants/live/<slug>.json`, or whatever namespace
   `ces-tenant`'s M1 implementation actually settled on — confirm against the shipped package, do
   not assume the design doc's suggestion was the final shape). A regression test (or equivalent
   verification script) demonstrating this — e.g. attempting to write a sim and a live record with
   the same slug and confirming they resolve to distinct storage locations — is part of this gate,
   not optional polish.
4. **S3** (`BACKLOG.md`'s tracked item, "`init-tenant` config isolation... `TenantProbe` has no
   directory override — inventory A9") gets its status line updated to reflect this closure, with
   the same evidence discipline the rest of `BACKLOG.md` already uses (commit hash + code
   citation), since `ces-tester`'s own goal tracking (`ces-tester/docs/goals/G-TESTER-1.md`'s Gate
   Ledger) reads this file as its source of truth for S3's closure state.
5. **The open tension is surfaced, not resolved by default.** This goal's implementation log must
   state, explicitly, both options for the zero-dependency-vs-adoption question (design §6, §8 item
   6) — (a) tenant-stacksim takes `ces-tenant` as a real code dependency, reversing
   `SimTenantConfig.ts:15-19`'s stated architecture decision; (b) tenant-stacksim stays
   zero-dependency and instead emits a schema `ces-tenant`'s registry independently validates/
   ingests on the consuming side. Whichever path was actually taken to satisfy gates 1-3 above must
   be named, along with the fact that the founder has not resolved this as a general policy — this
   goal's implementation is not itself the founder's resolution of §8 item 6, only a concrete
   instance that had to pick something to ship.
6. Encoding gate: grep for the UTF-8 mojibake marker (a-circumflex + euro sign, the double-decoded curly-quote sequence) returns 0 on every file touched by this goal.

## Preconditions

- **Blocked on M1 shipping.** This goal does not start until `ces-stamper`'s cutover
  (`ces-stamper/docs/goals/G-TENANT-M1.md`) and `ces-tenant`'s M1 implementation
  (`ces-tenant/docs/goals/G-TENANT-1.md`) are complete — there is no registry API to emit through
  until the package has a real implementation, not just M0's interface definitions.
- Note for sequencing awareness only (not a blocking precondition of this goal): `ces-tester`'s own
  goal tracking treats S1/S2/S3 as gates blocking *its* M1/M2 — S3's closure (this goal's item 4)
  is something `ces-tester` is waiting on independently. Closing S3 here has a downstream effect on
  that repo's Gate Ledger; no action required in this repo beyond the accurate `BACKLOG.md` status
  update already required by gate 4.

## Pointers (read-only — do not copy content into new files)

- Design doc: `ces-stamper/docs/design/tenant-manager-extraction.md` — §2.1 (the A9 hazard,
  confirmed from source, and the suggested sim/live namespace split), §5 (M4 gate detail, quoted
  above), §6 (tenant-stacksim's specific per-consumer requirements, including the explicit
  zero-dependency tension), §7 ("The A9 migration" risk section — clarifies A9 is not a separate
  code artifact elsewhere, it is this exact hazard), §8 item 6 (the open decision this goal must
  surface, not resolve).
- Ratified interfaces (sibling repo, read-only): `ces-tenant/src/registry.ts` — in particular the
  `kind: TenantKind` discriminator on `TenantRegistryRecord` and (if adopted) the
  `TenantRegistryLifecycle` create/query surface.
- This repo's own `BACKLOG.md` (lines ~40-43 as of the design doc's research pass) — the existing
  A9/S3 tracking entry this goal's gate 4 updates.

---

## RESOLUTION 2026-07-11 — founder decision: stacksim STAYS zero-dependency; registration moves to ces-tester

The open tension (design §6/§8 item 6) is RESOLVED, third option: **tenant-stacksim adopts
nothing and stays tenant-ignorant.** ces-tester — which already consumes ces-tenant and
orchestrates every sim scenario — registers sim tenants through ces-tenant's registry
(ephemeral kind:'sim' lifecycle) and hands stacksim only what it already understands. The
sim just simulates.

What this changes in THIS goal:
- The "emit through TenantManager's registry API" work items are RETIRED — no ces-tenant
  dependency lands here, ever, under this decision.
- `init-tenant`'s direct writes to `~/.stamper/tenants/` / plan-data become
  **deprecated-for-orchestrated-use**: mark them (doc + a console warning is enough) as a
  standalone-dev convenience only; orchestrated runs go through ces-tester's registration.
  Do not delete the command.
- The A9-class collision hazard is closed on the REGISTRY side (ces-tenant's physically
  separate live/ and sim/ roots, shipped in commit f9d75b4-era M1 work); stacksim's only
  residual duty is the deprecation marking above.

Provenance: founder, 2026-07-11, after tradeoff review — "yes to both" (this + M6
auth-state-only). Recorded here so a future stacksim session doesn't re-litigate.

**Residual duty EXECUTED 2026-07-11:** `init-tenant` marked deprecated-for-orchestrated-use —
doc comment (`src/cli/commands/init-tenant.ts`), console warning on every config write, README
CLI-table note, and a BACKLOG.md § S3 addendum pointing at the registry-side A9 closure.
Command kept, per this resolution. No ces-tenant dependency added; stacksim remains
tenant-ignorant.
