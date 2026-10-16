# Goal Document - G-STAMPER-STAB-1: Stamper stabilization for the working-system program

**Date:** 2026-07-11 - **Type:** /goal.
**Provenance:** founder directive 2026-07-11 working-system program
(ces-strategy/docs/context/VAULT.md, section B; lane analysis
ces-strategy/docs/context/masterplan/stamper.md; master plan
ces-strategy/docs/MASTER-PLAN-2026-07-11.md).

## Job

Make Stamper scenario-ready. Five milestones, priority order per the lane:

- **M1 - variable-poisoning fix (S). HIGHEST-LEVERAGE ITEM IN THE PROGRAM.** The vault's
  "IA.L2-3.5.3 template bug" is mis-diagnosed: templates are clean; the real defect is a
  chain - ManifestReader flattens non-scalar `desired_config` values (including the
  `powershell_commands` ARRAY) into plan variables (src/translators/ManifestReader.ts:
  202-216; line 221 restricts tenant_identity to scalars but 211-215 does not);
  PlanTranslator merges them plan-wide; `PowerShellAdapter.interpolateVariables`
  sanitizes EVERY variables-map entry unconditionally BEFORE checking whether the template
  references the key (src/adapters/PowerShellAdapter.ts:1654-1667; guard throw 1645-1649).
  Result: 45 of 110 tasks failed in gate-run-1, ALL with the identical injection-guard
  error on "powershell_commands". Fix: make interpolateVariables placeholder-driven like
  resolveTemplate - test for `${key}`/`{key}` in the template before sanitizing; sanitize
  only what is substituted. Belt-and-braces: stop flattening non-scalar desired_config in
  ManifestReader (mirror the scalar filter at 221). Then `npm run build` (ces-tester
  invokes node dist/cli/index.js) and re-run the tester M2 gate to confirm the
  expected_state assertion flips.
- **M2 - teams/sharepoint connect channels (S).** buildGCCHighConnection wires only 4
  channels (graph/exo/ipps/az, PowerShellAdapter.ts:1586-1608) but TaskRunner routes `spo`
  and `teams` engines to the same adapter, the registry has a live teams entry, and
  ces-tenant supports all 6 session types. Add 2 branches calling
  `connect.buildConnectCommand('teams'|'sharepoint')`.
- **M3 - land untracked load-bearing files + log reconciliation (S).** Pathspec-commit:
  docs/goals/G-TENANT-M1.md, docs/design/tenant-manager-extraction.md,
  tests/unit/SessionManager.test.ts, tests/unit/StacksimMode.test.ts (19 characterization
  tests counted in the "241 green" baseline - a fresh clone silently loses them), plus
  reconcile session-ces-stamper-2026-07-10.md Turn 6 (stale "held cleanly" claim; M1
  actually LANDED, workspace commit ccebc1f).
- **M4 - record the adapter-shim decision: KEEP (S).** AO's single remaining deep import
  (`ces-stamper/adapters/powershell`, a versioned package.json exports contract) stays as
  the standing boundary exception for this program; extraction (L) is deferred past the
  objective gate. Record in docs/ (decision note) and in the master-plan board
  (FD-ADAPTER-SHIM ratification).
- **M5 - real-tenant smoke ladder (M; behind FD-LIVE-SMOKE).** (1) connect-only probe per
  channel (graph/exo/ipps/az + teams/spo after M2), (2) one evidence-only get_command,
  (3) tester smoke config handoff. Precondition: cert installed/valid, app-role consent
  current (statically unverifiable - verify live first). Watch items: IPPS dropped
  -ShowBanner:$false; Az switched to -Subscription; SPO thumbprint connect never validated
  against live GCC High.

## Must-NOTs

- Do NOT loosen or bypass the PowerShell injection guard - the fix is placeholder-gating
  WHAT gets sanitized, not weakening sanitization of what IS substituted.
- Do NOT extract or restructure the PowerShellAdapter in this goal (M4 records KEEP).
- Guard rule (AO lane): any change to the adapter's constructor signature or the fields it
  reads (tenantId/appId/certThumbprint/domain/subscriptionId/gccHighEndpoints/dryRun)
  must pair an AO-side follow-through in the same tick - AO bridges via
  `as unknown as ConstructorParameters<...>` casts and breaks at RUNTIME, not compile time.
- No `--yes` flag work: founder declined 2026-07-10; the stdin-newline protocol is proven
  across 6+ deterministic gate runs. Revisit only if the pipe flakes.
- No force-push; pathspec commits only.
- M5 live runs: no destructive writes outside the tester reversible-write policy.

## Acceptance gate (objectively checkable)

1. Unit test: a plan whose variables map contains an unreferenced array-valued key
   executes a templated task WITHOUT the injection-guard throw; a template that actually
   substitutes a metacharacter-bearing value STILL throws (guard intact).
2. Tester M2 gate re-run: execution report shows ZERO failures with the
   "powershell_commands" injection-guard error (was 45/110); tester `expected_state`
   verdict flips green (the caPolicy-1 MFA assertion).
3. M2: unit coverage that teams and sharepoint engine tasks receive a Connect line from
   connectCommandSource; suite green.
4. M3: `git status` clean for the four files (tracked, committed); fresh-clone test count
   equals the in-place count (241).
5. M4: decision note committed; master-plan board updated.
6. M5: per-channel connect probes green against the live tenant record
   (~/.ces/tenants/live/vfsgov-xtra.json); one evidence-only get captured; smoke config
   handed to ces-tester.
7. Full suite stays green (17 suites / 241 tests baseline) and dist/ rebuilt.

## Preconditions

- None for M1-M3 (READY now). M4: FD-ADAPTER-SHIM ratified by the founder (recommendation
  KEEP is already on the table; batch it at the next founder check-in - the milestone IS
  the recording of that ratification). M5: FD-LIVE-SMOKE decided + cert/consent verified
  live.

## Pointers

- ces-strategy/docs/context/masterplan/stamper.md (full diagnosis + evidence paths)
- ces-tester runs/gate-run-1/artifacts-workspace/ (execution report evidence: 45 identical
  failures)
- src/utils/templateResolver.ts:27-50 (the placeholder-driven pattern to mirror)
- ces-tester/docs/PHASE0_FINDINGS.md (stdin protocol), docs/context/IMPLEMENTATION_LOG.md
