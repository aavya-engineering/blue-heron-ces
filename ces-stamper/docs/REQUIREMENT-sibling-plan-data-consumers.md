# Requirement: Sibling Repo Plan-Data Consumers

**Date:** 2026-07-10
**Context:** ces-stamper unified its tenant plan-data resolution onto the in-repo
`ces-stamper/plan-data/` folder (see `PLAN.md`, "Unify ces-stamper Plan-Data
Locations onto the Repo Folder"). Stamper no longer calls
`getStamperPlanDataRoot()` (the pipeline-root helper, default
`C:\CES_Pipeline\Stamper\plan-data`) for tenant config resolution. This has
consequences for sibling repos that still call that helper directly.

## (a) ces-ao gap — AoServer.ts:98

`ces-ao/src/server/AoServer.ts:98` hard-codes `getStamperPlanDataRoot()` with
no environment override. After this change, tenants that only exist under
`ces-stamper/plan-data/` (e.g. `sim-m365-azure`) will NOT be visible to
ces-ao, because ces-ao is still reading from the pipeline root
(`C:\CES_Pipeline\Stamper\plan-data`).

ces-ao needs one of:
1. An env-override analogous to ces-eo's `STAMPER_PLAN_DATA_ROOT` (see (b)
   below), so an operator can redirect it without a code change, or
2. A direct code fix pointing `AoServer.ts:98` at the ces-stamper repo folder.

Both options require edits inside `ces-ao/` (and possibly `ces-shared/`),
which are read-only sibling repos from ces-stamper's perspective — out of
scope for this execution. This is a requirement/gap note only.

## (b) Operator action — ces-eo environment variable

ces-eo already supports an env override (`EoConfig.ts:107`,
`VariableStore.ts:49`, both do
`process.env.STAMPER_PLAN_DATA_ROOT ?? getStamperPlanDataRoot()`). To keep
ces-eo pointed at the same canonical plan-data folder ces-stamper now uses,
set the following in ces-eo's environment:

```
STAMPER_PLAN_DATA_ROOT=C:\Users\mhsut\DevProjects\ces\ces-stamper\plan-data
```

## (c) Follow-up — NOT part of this execution

`C:\CES_Pipeline\Stamper\plan-data\vfsgov-xtra\` is a candidate for deletion,
but only once ces-ao is fixed to read from the ces-stamper repo folder (per
(a)), or the user explicitly approves deleting it while ces-ao still reads
that exact path. Do not delete it now — `AoServer.ts:98` reads that path live
with no fallback, and ces-ao may be running.

A hash comparison performed during this execution found the pipeline-root
copy and the repo copy of `vfsgov-xtra/vfsgov-xtra.json` to be byte-identical
(SHA-256 match), so there is no data-loss risk in leaving both in place until
the ces-ao gap above is resolved.
