# collective-ces-stamper.md

Status + planning context for the **ces-stamper** module. Written 2026-07-25 for
AI-based planning sessions: assume the reader has no conversation history — this file
plus the repo is the whole picture. Cross-check `session-ces-stamper-*.md` (project
root, newest first) for turn-by-turn history.

## Goal (founder-calibrated 2026-07-25)

Stamper is the execution engine of CES: it takes a tenant plan — the CMMC L2 /
800-171 control-implementation steps that Muster's chain produced — and
**actually applies it** to the customer's cloud stack, **verifying every
outcome from real command output** rather than trusting that a command "ran."
Microsoft (M365/Graph/Exchange/Purview/Teams/SharePoint/Azure via persistent
PowerShell sessions) is first-class, and **Stamper supports other stacks**
(founder, 2026-07-25) — the engine is stack-plural by design, not
Microsoft-only. Two properties define it (founder-calibrated): it is
**evidence-centric** — every action exists to produce provable evidence of
tenant state, not just effect change — and **all actions are idempotent** —
safe to re-run, converging on the desired state rather than assuming a starting
point. It is the *execute & remediate* stage of the CES lifecycle. Stamper also
owns two assets the rest of the suite depends on: the **command registries**
(the machine-readable knowledge of how every control is checked and set —
consumed as data by Muster's discovery and EO's evidence collection) and the
canonical **plan-data** artifact tree. Its verification engine is deliberately
tolerant of PowerShell's casing/shape quirks so that "verified" means the
tenant state is right, not that a string matched.

## What this module is

Stamper is the CES execution engine: it takes tenant plans (CMMC L2 / 800-171
control-implementation steps) and executes them against a Microsoft cloud tenant
(M365/Graph/Exchange/Purview/Teams/SharePoint/Az) via persistent PowerShell sessions,
verifying outcomes from command output. It serves a GUI + REST API (GuiServer) and a
CLI (`src/cli/index.ts`). Package `ces-stamper` 0.2.0, TypeScript, jest ESM
(`cross-env NODE_OPTIONS=--experimental-vm-modules npx jest`), suite ~255 green.

Siblings it interacts with (read-only context; never write there without founder
permission): `ces-tenant` (session/tenant-registry package it now consumes),
`ces-ao` (AdminOps — Tier-3 approval loop; deep-imports Stamper compat shims),
`ces-eo` (Evidence/Objectives server), `ces-shared` (registry/methodology data,
e.g. sprs-weights/2.0.0), `ces-tester` (black-box tester), `tenant-stacksim`
(simulated tenant; standalone repo founder/ces-stacksim).

## Architecture facts a planner must know (post-cutover)

- **Tenant configs are registry-canonical**: `~/.ces/tenants/{live,sim}/<slug>.json`
  (`CES_TENANT_ROOT` overridable), managed via ces-tenant `FileTenantRegistry`.
  Repo `plan-data/<slug>/<slug>.json` copies are legacy seeds — no longer read at
  runtime, stale by design. `plan-data/` still holds plans/logs/state/evidence
  ARTIFACTS (that stays; artifact resolution lives in `src/config/paths.ts`).
- The registry refuses records whose `kind` (live|sim) contradicts their namespace.
  Never write a tenant JSON there without the matching `kind` field.
- `src/tenant/stamperTenants.ts` is the SINGLE ces-tenant integration point
  (registry singleton, seed migration, `resolveTenantRecordPath`,
  `requestStacksimMode`). New tenant-config access goes through here, nowhere else.
- `resolveTenantJsonPath(slug)` (src/config/ClientConfig.ts) is ASYNC — every new
  call site must await it.
- `src/core/SessionManager.ts` is a ~60-line INTERNAL-ONLY wrapper extending
  ces-tenant `PersistentSessionFactory` (binds Stamper's consumer identity).
  GP-STAMPER-1 M1 (2026-07-25) retired the compat surfaces: the
  `./core/session` and `./config/stamper` export paths are REMOVED from
  package.json (ces-ao's G-TENANT-M5 landed 07-11; zero live external imports
  remained) and `src/core/StacksimMode.ts` + its characterization test are
  DELETED. The one sanctioned external deep import is
  `ces-stamper/adapters/powershell` (FD-ADAPTER-SHIM: KEEP).
- `src/adapters/PowerShellAdapter.ts` connect lines come from the wired
  SessionManager (`connectCommandSource()`), not hardcoded GCC-High literals.
  FD-ADAPTER-SHIM was decided KEEP (`docs/design/adapter-shim-decision.md`).
- `src/core/OutputVerificationEngine.ts` verification is deliberately tolerant of
  casing/shape only: jsonpath segments match case-insensitively, single-element
  arrays unwrap (multi-element refuses to guess), and `equals` compares
  case-insensitively mirroring PS `-eq`. Genuine value mismatches still fail —
  preserve that boundary in any change.

## Current status (2026-07-25)

- Last real Stamper work was 2026-07-12: FIDELITY tail (c) commits `19b5f89` +
  `4245c82` (verification tolerance, above). Suite 255 green, dist rebuilt, ces-ao
  proven green against the dist. Nothing in-flight in this root; working tree has
  no pending Stamper feature work.
- Completed goal docs: `docs/goals/G-STAMPER-STAB-1.md` (M1b–M4 done 07-11) and
  `docs/goals/G-TENANT-M1.md` (Stamper cutover done 07-11, gates in
  `session-ces-stamper-2026-07-11.md`).
- Branch discipline: work happens on feature branches, never master; commit via
  pathspec/temp-index only (multi-pane shared-index race, see memory protocol);
  never force-push shared branches.

## Next steps (priority-ordered, with enough context to plan from)

1. ~~File the IA.L2-3.5.3 bug~~ **DONE (GP-STAMPER-1 M2, 2026-07-25):**
   `docs/bugs/BUG-IA.L2-3.5.3-injection-guard.md` — the defect was already fixed
   by `5252d90` (07-11 variable-poisoning fix); tester's failing runs predated it.
   Registry-grounded regression test added to `PowerShellAdapter.test.ts`.
   Freshest tester gate (`gp-m1-gate-1`, 07-26T00:49Z) shows the scenario PASS.
2. ~~Support ces-ao G-TENANT-M5 cutover~~ **DONE:** M5 landed 07-11 (see
   `../ces-ao/docs/goals/G-TENANT-M5.md` implementation log); GP-STAMPER-1 M1
   (2026-07-25) retired the dead compat surfaces (see Architecture facts above).
   Still open from that thread: ces-ao reads `C:\CES_Pipeline` for plan-data
   while Stamper's canonical plan-data is `ces-stamper/plan-data` (07-10
   decision, paths.ts singleton).
2b. **Stack-plural roadmap awaiting founder ratification:**
   `docs/STACK-PLURAL-ROADMAP.md` (GP-STAMPER-1 M3 draft) — AWS has zero in-repo
   representation today; roadmap phases 0-4 + founder questions Q1-Q4 pending.
3. **Two residual sim-fidelity classes** (filed on the loop board in `4245c82`; they
   are stacksim work, NOT Stamper product bugs — scenario already passes on its
   asserted surface): (a) server-COMPUTED fields the sim never returns, e.g.
   DlpCompliancePolicy `$.DistributionStatus="Success"`; (b) `-Filter` Get queries
   returning empty from the sim, e.g. `Get-MgUser -Filter 'accountEnabled eq true'`
   (inactive-user discovery). Fix belongs in `../tenant-stacksim` /
   founder/ces-stacksim; a Stamper-side planner should only track them as
   external dependencies for gate FAIL triage.
4. **Housekeeping**: delete stale `C:\CES_Pipeline\Stamper\plan-data\vfsgov-xtra`
   once confirmed nothing back-compat-reads it (grep ces-ao + ces-eo for the path
   first). Low risk, verify-then-delete.

## Gates any future slice must pass (established pattern)

`npx tsc --noEmit` clean → full jest suite zero regressions → `npm run build` →
ces-ao `tsc --noEmit` + `npm test` green against the rebuilt dist (compat-shim
proof, required while shims exist) → mojibake/encoding grep 0 on touched files →
live or sim smoke where behavior changed. Commit pathspec-scoped on pass.

## Standing constraints

- Founder identity non-exposure is supreme law (see global CLAUDE.md): no personal
  or work identifiers in anything public — commits are pushed to remotes, so scan
  before push.
- Session logging to `session-ces-stamper-<date>.md` every turn.
- Small green slices; review + verify; commit; then ask for the next slice.
