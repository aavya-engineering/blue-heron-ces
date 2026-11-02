# `assets/demo-plan/` — the checked-in mission plan and tenant manifest for `demo:show`

`demo:show` never runs the ces-planner wizard, so it never produces a mission plan or a manifest
of its own — and the Stamper Configuration GUI cannot be configured without both. These two files
are that missing input, checked in so the Config beat of a demo is reproducible on any machine.

## What is here

| File | What it is | Consumed as |
|---|---|---|
| `demo-dib-small/mission-plan.json` | The manual mission plan for the `demo-dib-small` tenant, CMMC L2 `harden_existing`, stance `m365_azure` | typed into the GUI's `#configMissionPlanPath` |
| `demo-dib-small/manifest.json` | The **tenant** manifest (`artifact: tenant_manifest`) | typed into the GUI's `#configManifestPath` |

**It is the TENANT manifest, deliberately — not the infrastructure one.** The production Beat 3
path passes the tenant manifest to `#configManifestPath` (`drive-muster.ts` → `e2e-run.ts` →
`stamper-ui-driver.ts`); `configInfraManifestPath` has **zero consumers anywhere in ces-tester**.
Copying the infrastructure manifest instead would fail silently — the GUI accepts the path and the
translation comes out wrong.

## Provenance

- **Source run:** `runs/e2e/m7-run5/artifacts/plans/` — the GP-DEMO-3 M7 gate run, the first
  `demo:e2e` run to exit 0 with **all nine clauses PASS** (96/110 execute, 13 known false fails).
- **Source files:** `manual-mission-plan-2026-08-30T00-51-59-646Z.json` and
  `tenant-manifest-2026-08-30T00-51-59-654Z.json`, copied verbatim, byte for byte.
- **Generated:** 2026-08-30. **Tenant slug:** `demo-dib-small`.
- **Matched pair:** both carry `ces.cesId = ces-5e910877b82d`. They are two halves of one planning
  run and must be replaced **together** — a plan from one run against a manifest from another is
  the shape of a mid-demo translation failure with no useful error.
- **Producing commits:** `a108f2f` (2026-08-29, "GP-DEMO-3 M7: DONE — demo:e2e exits 0 with all
  nine clauses PASS") and `a23afe4` (2026-08-29), which recorded the run's evidence.
- **`runs/` is git-ignored** (`.gitignore` L3) and `git ls-files runs` returns nothing. The source
  directory exists on the machine that produced it and nowhere else — which is exactly why this
  tracked copy is the deliverable rather than a path into `runs/`.

## Regenerating

Re-run `demo:e2e` to green and re-copy the two files out of that run's `artifacts/plans/`
directory, as a matched pair, updating the provenance block above.

**Never hand-edit either file.** They are executor input, not authored content: a hand-tuned plan
that translates on this machine and nowhere else is worse than no fixture, because it fails for
the first person who trusts it.

## Identity

Both files were scanned before check-in for banned identifiers and for machine-absolute paths
(`C:\...`, `DevProjects`). Neither appears. Re-run that scan on any replacement.
