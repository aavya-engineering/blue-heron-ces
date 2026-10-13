# E2E Demo — Grounding Evidence (companion to PLAN-E2E-AO-DEMO.md)

**Date:** 2026-08-29 · **Status:** reference appendix — every claim read from source this
session, path + line cited. The plan depends on these; change a finding here and re-check
the plan's success predicate and FD items. Sibling repos were read **read-only**.

### Grounded findings (verified from source this session — not assumed)

1. **EO HAS a real, Playwright-drivable UI** — `EoServer.ts:268-271` serves a 7,254-line
   SPA on `EO_PORT` (default 4002). Selectors `#tenantConnectSelect`, `#connectBtn`,
   `#assessBtn`, `#assessStatus`; `/api/*` loopback-open when `CES_EO_AUTH_TOKEN` is unset;
   **spawn `cwd` must be the ces-eo root** (`:267` resolves `public/` from `process.cwd()`).
   Today's headless leg drives the same API the buttons call — a UI leg is a reskin.
2. **AO evidence does NOT land where its own docstring says.** `EvidenceEmitter.ts:83-86`
   documents `{CES_PIPELINE_ROOT}/AdminOps/evidence-store/...` — **stale (pre-ADR-002)**.
   The live code (`:97-126`) writes to **SQLite** via `getCesRepository()`:
   `{CES_PIPELINE_ROOT}/ces.db` (`CesRepository.ts:18`; win32 default `C:\CES_Pipeline`,
   `ces-shared/src/storage/contract.ts:16`), collection `adminops_evidence`, id
   `<commandId>:<executionId>`, scope `{tenantId}`. The returned `evidencePath` is a
   **locator string**, not a file path. → The demo points `CES_PIPELINE_ROOT` at a
   run-scoped dir and reads that `ces.db`. **REQ filed** (stale docstring).
3. **AO GUI execute route** — `POST /api/execute/:commandId` (`execute.routes.ts:33`,
   mounted `AoServer.ts:59`), body `{ tenant, inputs, dryRun, requestorUPN, approvalId }`,
   passed to `executeAoCommand` as `dryRun ?? true` (`:86-92`). Same governed engine as the
   CLI (`CommandExecutor.ts:65` → `AuthChain.createExecutionContext`), so the cert gate in
   finding #5 applies to the GUI path too. The CLI (`cli/index.ts:48-64`) remains available
   for invisible setup only.
4. **AO small-change command: A-18** (A-02 runner-up). Registry = 86 × Tier 2 + 9 × Tier 3
   (`sodTier`). A-18 "Default User Permission Lockdown": Tier 2, `get-then-set`, **zero
   required parameters**, CMMC `AC.L1-3.1.2` (L1, so `CmmcScopeGate` cannot deny on level).
   Templates `TemplateRegistry.ts:59-62` — GET then PATCH of
   `/v1.0/policies/authorizationPolicy` `defaultUserRolePermissions`. A singleton object,
   so the change is small and diffable. **tenant-stacksim's own coverage report records
   `ao:A-18:get` and `ao:A-18:set` PASS with a ledger mutate (178 → 179)** — the strongest
   available evidence. SoD's Tier-2 floor needs `kind === 'live'` (`SodGate.ts:30-41`), so a
   sim tenant never escalates to approval.
5. **A live AO write fails closed on a missing cert file.** `AuthChain.ts:96-109` requires
   `tenantConfig.certPath` to **exist on disk**; sim records carry the *relative*
   `sim/<slug>.pfx` (`ces-tenant/src/impl/registry.ts:159`) and no such file exists anywhere
   in the tree — it resolves against the spawn `cwd`. Dry-run is unaffected. Fix: spawn from
   a run-scoped cwd holding a placeholder (precedent: `synthetic-env.ts:51-52`). **Do not**
   use `--config` — it bypasses the registry (`invokeCommand.ts:74-76`), losing
   `cmmcMigrationExempt`. *(Stamper's GUI needs more than a placeholder — see FD-5.)*
6. **Evidence is written on EVERY terminal path — including dry-run** (CommandExecutor.ts:354,
   plus the two denial paths), and **persistence failure is silently swallowed**
   (`CommandExecutor.ts:94-97` `catch { return {}; }`). A green AO exit therefore does *not*
   prove collection. The predicate must (a) snapshot rows before/after and (b) assert
   `data.evidence.metadata.stateChanged === true` — which is real
   (`= applied = setResult.success`, `CommandExecutor.ts:326`).
   `adminops_evidence` is **WORM** (`CesRepository.ts:72`).
   Record id is `<commandId>:<commandId>-<epochMs>` (`CommandExecutor.ts:90`) — non-deterministic,
   so query by collection + scope `{ tenantId: 'sim-tenant-<slug>' }` ordered by `created_at`
   (`tenant_slug` is NULL without a CES customer binding).
6b. **CORRECTION — AO does NOT capture real pre/post state today.** Verified directly:
   `GetThenSetExecutor.ts:64` (pre-state) and `:87` (post-state) both call
   `adapter.execute(task, variables, true)` — the third argument is `dryRun`, hardcoded
   `true`. The comment at `:62-63` states the opposite intent ("run it live even in dryRun
   so the operator sees the real current state"), but `PowerShellAdapter.execute` returns a
   stub on `dryRun` without running anything (`ces-stamper/src/adapters/PowerShellAdapter.ts:134-156`,
   `stdout: '[dry-run] PowerShell commands validated'`); both adapter paths short-circuit
   (`:302`, `:639`, `:1206`). **So `metadata.preStateOutput` / `postStateOutput` are stub
   strings even on a live apply.** This contradicts the vault's "get-then-set pre-state
   evidence" claim and the demo's original framing. → **REQ filed**, and the AO beat must
   NOT claim pre-state capture. What it *can* honestly claim — and what the founder's ask
   #5 actually requires — is that **evidence of the change was auto-collected**: a WORM,
   tenant-scoped, sha256-hashed, control-tagged record appeared without anyone asking for
   it, `stateChanged` is true, and the stacksim ledger independently shows the mutation.

7. **Sim mode is INHERITED PROCESS ENV — this is what makes the all-GUI mandate work.**
   `StacksimModeController.enable()` mutates `process.env` in place with exactly three
   variables (`ces-tenant/src/impl/stacksim.ts:144-151`): `PSModulePath` (stacksim's
   PowerShell shims), `Path` (the az shim), `STACKSIM_SERVER_URL`. ces-tester already
   assembles precisely this bundle for the Stamper CLI
   (`src/stamper-launcher/env.ts:33-46`, `mergeSimLaunchEnv`). Because the GUI servers
   spawn PowerShell children that **inherit** their parent's env, **launching `stamper gui`
   / `ao gui` with that merged env arms every GUI-triggered execution** — no in-frame CLI
   step, no `--stacksim` flag needed. The arming is just how ces-tester spawns the server:
   invisible setup, exactly the founder's permitted carve-out. Registry side (the A9
   live-slug guard) is already handled by ces-tester's `createEphemeralSimTenant`.
8. **The AO GUI CAN perform a live write** — `dryRun` is client-controlled and the
   front-end exposes a **"Live Execution (dryRun: OFF)" toggle** (`public/index.html:825`,
   read `:1194`, sent `:1205`). Two evidence-panel rendering bugs
   (`#evidenceVerdict` reads `evidence.verdict`, which does not exist — the field is
   `complianceVerdict`, `:1278`; the badge compares `outcome` to `'SAT'`, never equal,
   `:1269-1275`) mean the demo asserts only on fields that render. REQs filed regardless.
   No server-side path refuses a sim tenant: `CmmcScopeGate` clean-allows sim records
   (`cmmcMigrationExempt`) and `SodGate`'s Tier-2 floor requires `kind === 'live'`.
9. **Watch-mode plumbing already exists end-to-end**; only the CLI flag is missing.
   `drive-muster.ts:132` is the single `chromium.launch({ headless: opts.headless ?? true })`,
   fed by `DriveMusterOptions.headless` (`:46`) and `NeedleRunOptions.headless`
   (`needle-run.ts:62`, passed `:232`). `runDemoRunCommand` never sets it → always headless.
10. **`better-sqlite3` + `ces-shared` resolve** from ces-tester via the hoisted
   `ces/node_modules`; declare the dep anyway. Evidence DB = one SQLite file, table
   `ces_records`, PK `(collection, id)`, `data` a JSON **string** (`CesRepository.ts:118-130`).
11. **Tenant state persists** at `<stacksimRoot>/.stacksim/tenants/<slug>`
    (`stacksim-client/cli.ts:22`), so AO can take its own serve window after EO (M0 verifies).
    The stacksim server must already be running — `warnIfSimUnreachable` only *warns*
    (`ces-tenant/src/impl/stacksim.ts:245-265`).

