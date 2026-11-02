# REQ: ARM/Bicep deployment resolver in the sim (tenant-stacksim) — prerequisite for Stamper's Bicep adapter

**Filed by:** ces-stamper, Wave 4 step W4-ST3 (2026-09-27)
**Status:** OPEN (low priority — no producer yet)
**Blocks:** Stamper `BicepAdapter` (stub) — W4-ST3 Bicep part is HONEST-OPEN

## Situation (verified 2026-09-27)

- `src/adapters/BicepAdapter.ts` is a stub: dry run returns a placeholder, live returns "not yet implemented".
- **No producer:** 0 entries with `"engine": "bicep"` in `cmmc-l2-commands.registry.json` or
  `infra-cmmc-l2-commands.registry.json`; `PlanTranslator` never emits a bicep task. Azure baseline
  provisioning runs through `az`/Az PowerShell sub-commands instead.
- **No sim target:** tenant-stacksim has no resolver for ARM template/Bicep deployments
  (`New-AzResourceGroupDeployment`, `az deployment group create`), so an implementation could not be
  proven sim-only today.

## What (when Bicep becomes a real path)

1. tenant-stacksim: resolve `New-AzResourceGroupDeployment -TemplateFile <bicep>` / `az deployment group create`
   by materializing the template's declared resources into the store (ledger-recorded), with a what-if mode.
2. Then Stamper implements `BicepAdapter` against it (`az bicep build` → deployment → post-GET), with an
   inverse (deployment of the prior state or delete of created resources) for run-level rollback.

## Acceptance

A Stamper test runs a bicep task against stacksim (sim-only) and the deployed resources are visible via the
sim's ARM/Graph facade; rollback removes them.
