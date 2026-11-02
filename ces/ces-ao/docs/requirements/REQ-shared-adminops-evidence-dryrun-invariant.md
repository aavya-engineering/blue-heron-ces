# REQ-shared-adminops-evidence-dryrun-invariant

> **STATUS: CLOSED (2026-09-27).** ces-shared S2 shipped the fix in `8697ecd`
> ("flow-through S2: fix dry-run invariant per F-4, bump to 1.1.0"): a dry run may carry
> `dry_run | denied_cmmc | denied_cui | blocked_pending_approval`, never SAT. Verified in
> ces-ao by un-skipping the two dry-run-mode cases in `test/evidenceContractConformance.test.ts`
> and by the persisted-row golden (`test/contract/adminopsEvidence.conformance.test.ts`,
> path `dry_run+deny`), commit `96b7935`. Kept below for history.

**Target module:** ces-shared
**Filed by:** ces-ao (AE-R2 conformance)
**Date:** 2026-09-27
**Priority:** P1 — blocks full conformance testing

## What

The `superRefine` invariant in `AdminOpsEvidenceSchema` rejects valid dry-run-mode
denials and blocks. Two checks fire:

1. `dryRun === true && outcome !== 'dry_run'` → error
2. `mode === 'dry_run' && outcome !== 'dry_run'` → error

These reject rows like `{ dryRun: true, mode: 'dry_run', outcome: 'denied_cmmc' }` — a
real scenario where a CMMC scope gate denies a command that was being previewed.

## Failing row

```json
{
  "contractVersion": "1.0.0",
  "commandId": "X-42",
  "tenantId": "tid-123",
  "mode": "dry_run",
  "dryRun": true,
  "outcome": "denied_cmmc",
  "controlIds": ["AC.L2-3.1.5"],
  "timestamp": "2026-09-27T00:00:00.000Z",
  "verdict": "NOT_APPLICABLE",
  "sha256": "abc123"
}
```

Error: `dryRun is true but outcome is 'denied_cmmc'; dry-run rows must have outcome 'dry_run'`

## Why it's wrong

A denied command during a dry-run preview is NOT a dry-run — it's a denial. The outcome
correctly records WHY the command didn't execute (CMMC gate denied it), while the mode
records that the request was a preview. These are orthogonal facts:

- `mode` = what was the request type (preview vs live)
- `outcome` = what actually happened (denied, blocked, executed, etc.)

A denial during a preview and a denial during a live attempt are both denials.

## Proposed fix

Relax the `superRefine` to:
```
(dryRun || mode === 'dry_run') && outcome === 'executed' → error
```

This preserves the SPRS integrity rule: a preview can never claim `executed`. The existing
per-outcome SAT guards (`denied_cmmc + SAT → error`, `dry_run + SAT → error`, etc.)
already prevent score inflation for every other outcome.

## Impact

- ces-ao conformance test: 2 paths skipped (`denied_cmmc` during dry-run, `blocked_pending_approval` during dry-run)
- ces-eo reader: unaffected (uses its own relaxed schema copy)

## Acceptance test

After the fix, `AdminOpsEvidenceSchema.parse({ dryRun: true, mode: 'dry_run', outcome: 'denied_cmmc', verdict: 'NOT_APPLICABLE', ... })` succeeds.
