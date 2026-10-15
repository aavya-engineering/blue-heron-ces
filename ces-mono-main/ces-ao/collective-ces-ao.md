# collective-ces-ao.md — Module Status & Next Steps

> Written 2026-07-25 for cross-session / AI-based planning. This is the single-page state
> of the **ces-ao** module. Ground truth for details: `session-ces-ao-*.md` (day-by-day),
> `docs/goals/*.md` (goal specs with implementation logs), git history on `master`.

## Goal (founder-calibrated 2026-07-25)

AO — the AdminOps Console — is the *governed operations* layer of CES: where
Stamper executes whole plans in bulk, AO gives the operator a controlled way to
run **individual privileged admin actions** during and after an engagement. Its
95-command registry sits behind three equivalent front-ends (CLI, GUI, MCP
server for agent use) that all funnel through one approval loop: **dry-run by
default, live writes explicitly gated, separation-of-duties enforced, and every
command emitting evidence labeled with the CMMC practices it touches.** AO
exists so that day-2 administration of a hardened tenant doesn't quietly undo
compliance — the routine "just fix this one setting" action stays inside the
same evidence discipline as the engagement itself. Per founder directive
(2026-07-19), AO enforcement is assertable as operational across all eight
admin domains. (G-AO-CMMC-BOUND-1 CLOSED 2026-07-25 — every execution now
CMMC-gated pre-session with boundary decisions emitted as evidence; remaining
external edge = ces-tenant M0 mirror, see Next steps.)

## What this module is

**ces-ao** = CMMC L2 AdminOps Console (`ces-ao` 0.2.0, ESM TypeScript). It is the
operator-facing interface over the 95-command admin-operations registry
(`ao-commands.registry.json`; 95 entries / 95 distinct ids / 8 domains, direct count
2026-08-07 — the "85" this doc previously carried is the *EO knowledge-bank* subset at
`ces-eo/knowledge-banks/adminops/`, which lacks A-18/19/20, B-13/14, D-11, F-11/12/13/14): a CLI (`ao`, `src/cli/index.ts`), an Express HTTP server + GUI
(`npm run ao` → port 3001, `public/index.html`), and an MCP server (v0.2) — all three drive the
same Tier-3 approval loop and converge on `invokeAoCommand` → `CommandExecutor` →
Stamper-owned `PowerShellAdapter`. Live writes are gated (`--apply` / `AO_MCP_ALLOW_APPLY`);
default is dry-run. Evidence is emitted per command with `cmmcPractices` labels.

Siblings it depends on (workspace `C:/Users/mhsut/DevProjects/ces/`):
- **ces-shared** — shared types incl. `TenantConfig` (`ces-shared/src/config/TenantConfig.ts`).
- **ces-tenant** — tenant registry + session factory package (`file:../ces-tenant`); AO's single
  integration point is `src/tenant/aoTenants.ts` (registry singleton, `loadTenantConfigBySlug`,
  `AO_CONSUMER` module id `'ces-ao'`, `requestAoStacksimMode` sim-only).
- **ces-stamper** — still owns `PowerShellAdapter` (deliberate carve-out, fed via
  `ConstructorParameters` casts in `src/execution/CommandExecutor.ts`).

**Hard session rules:** project-root write boundary (never write into sibling roots — file
requirements here instead); commit via pathspec/temp-index only (shared-index race protocol);
no force-push on shared branches.

## Current status (as of 2026-07-27, post GP-AO-BOUND-1 record-migration pass)

- **Suite: 213/213 passing, `tsc --noEmit` clean, build clean.** Branch: `master`. Phase-2 strict
  flip attempted 2026-07-27 and HELD (`CMMC_STRICT_DEFAULT=false`) — blocked on `~/.ces` registry
  data migration (audit 0.0%); see Next steps 3 + goal doc 2026-07-27 log.
- **G-AO-CMMC-BOUND-1 — CLOSED 2026-07-25** (GP-AO-BOUND-1: commits `da2f358` M4 wiring,
  `aa51dad` 33-mislabel data fix, `18335af` strict flip). CmmcScopeGate runs in
  `executeAoCommand` BEFORE approvals/context/sessions; denials + Phase-1 warnings + CUI
  denials land on `evidence.metadata.cmmcGate` (blocked commands ARE enforcement evidence);
  SoD single additive floor (write-shaped Tier 2 + L2 + live → manual gate, sim unaffected);
  `--strict-cmmc` CLI thread; registry practice validation is STRICT at boot (mislabels fail
  startup). Open external edge: ces-tenant M0 mirror (fields dropped by `parseTenantRecord`)
  — live tenants surface `cmmcLevel: undefined`, Phase 1 fail-open covers it; Phase-2 flip
  NO-GO (audit 07-25: 7 tenants, 0.0% coverage, `docs/cmmc-migration-audit-2026-07-25.md`).
- **G-TENANT-M5 — COMPLETE** (`311c336`): AO consumes the ces-tenant package; zero live imports
  of Stamper session/config internals; no cwd/`~/.stamper` path construction; `ao exec
  --stacksim` sim mode; one-time forward migration of legacy `plan-data/<slug>/<slug>.json`.
- **G-AO-CMMC-BOUND-1 — PARKED, M1–M3 EXECUTED / M4–M5 BLOCKED** (`docs/goals/G-AO-CMMC-BOUND-1.md`
  has the full spec + implementation log). Origin: read-only audit verdict **FALSE** on "every
  admin op is bounded by the tenant's CMMC configuration" — tenant configs carry zero CMMC
  fields; `cmmcPractices` was write-only metadata; SoD/apply gates are generic.
  - M1 `d07cc40`: GUI no longer hardcodes `tenant=dev`; selected tenant threads into
    `loadTenantConfig()` / `checkFirewallState()` (`public/index.html`).
  - M2 `623e9f6`: `CmmcScopeGate.ts` (carve-out types `CmmcTenantFields`/`CmmcAwareTenantConfig`,
    `AO_CMMC_STRICT` env), RegistryBridge load-time validation of `cmmcPractices` vs
    `cmmc-l2-controls.reference.json` (WARN-only in Phase 1), `npm run audit-cmmc-migration`.
  - M3 `dde01ea`: ParameterMapper CUI-boundary enforcement on `resources.*` params
    (allowlist/tag match; Case A = absent boundary pre-migration warns, Case B foot-gun denies;
    thrown-Error denial; zero caller changes).
  - **M0 (the blocker, NOT ces-ao work):** schema fields `cmmcLevel` / `assessmentScope` /
    `cuiBoundary` must land in ces-shared `TenantConfig` AND ces-tenant `registry.ts`.
    Requirements memo = M0 section of the goal doc. Resume probe: grep those three identifiers
    in `ces-shared/src/config/TenantConfig.ts` + `ces-tenant/src/registry.ts`; both must hit.
  - Migration policy: Phase 1 fail-open-with-warning → Phase 2 fail-closed at 100% tenant
    coverage (exempt convention). Coverage today: 5 tenants, 0 migrated, 0.0% (expected).

## Next steps, in dependency order

1. ~~M0 ces-shared half~~ DONE (`01612c4`, 0.3.0). ~~M4/M5~~ DONE. ~~Registry data-fix +
   strict flip (gate/SoD/evidence wiring)~~ DONE (GP-AO-BOUND-1, 2026-07-25).
2. ~~ces-tenant M0 mirror~~ **DONE (ces-tenant 0.5.0):** `parseTenantRecord`
   (`ces-tenant/src/impl/tenant-file.ts`) maps `cmmc_level`/`assessment_scope`/`cui_boundary`/
   `cmmc_migration_exempt` + load-time Case-B rejection. Registry code path now carries CMMC posture.
3. **Phase-2 strict flip — LANDED (2026-07-27, `19a14ba`/`da77e09`):** registry coverage reached
   **100.0%** (7 records: 6 exempt [`dev` + 5 sim], 1 migrated [`vfsgov-xtra` L2]) after ces-tenant
   sim-default-exempt (`583a474`) + `~/.ces` data migration cleared the blocker. `CMMC_STRICT_DEFAULT`
   flipped `false`→`true`: a non-exempt unmigrated tenant now fails closed with evidence before any
   context/session work. Two enabling changes shipped with it: the gate + ParameterMapper now HONOR
   `cmmcMigrationExempt` (was audit-only — a bare flip would have regressed dev/sim in production),
   and `CommandExecutor`'s evidence `strict` flag now consults `CMMC_STRICT_DEFAULT`. E2E fixture
   marked exempt; Phase-1 tests re-pointed to explicit non-strict; sim test unchanged (exempt by
   default). `npm test` **217/217**, tsc/build clean, audit **100.0%**. FOUNDER-RATIFY: `vfsgov-xtra`
   L2 + `cui_boundary` values are now live-consumed by the gate — AO gates on them, founder ratifies
   the values.
4. **GUI manual browser smoke (here, small):** verify the M1 tenant-threading fix in a real
   browser (automated tests exist; manual smoke never done).
5. **Adjacent open item:** ces-ao still reads `C:\CES_Pipeline`, while the 2026-07-10 decision
   made `ces-stamper/plan-data` (via `src/config/paths.ts` singleton in Stamper) the canonical
   tenant-config location. Needs a reconciliation decision + small goal of its own.

## Planning notes for a future AI session

- Read latest `session-ces-ao-*.md` first, then the goal doc for anything CMMC-related.
- Verify sibling state with the M0 resume probe before assuming M4 is unblocked — the memo may
  have been carried without landing, or landed with different field names.
- Baseline before any code change: `npm test` (expect 217/217), `npx tsc --noEmit`.
- `FileTenantRegistry` captures `CES_TENANT_ROOT` at construction; tests must call
  `resetTenantRegistryForTests()` after setting the env var.
- AO's `plan-data/dev/dev.json` is the reachable placeholder tenant (`?tenant=dev`) — do not
  "clean it up".
- `PowerShellAdapter` constructor types are nominal; the `AoExecutionConfig` + cast bridge and
  the kept `resolveStackEndpoints` seam retire only when the adapter is extracted or ces-tenant
  ships the sovereign endpoint table.
- Encoding gate: grep touched files for the U+00E2 U+20AC mojibake marker before commit.
