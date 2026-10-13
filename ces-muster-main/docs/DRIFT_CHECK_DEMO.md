# Drift Check Demo — 2026-07-05

## Setup

All 19 vendored files hashed into `vendor-manifest.json` at pinned SHA `4a00bee5d5e618cf55da2469ec12307ebc620418`.

## Pass (clean baseline)

```
> node scripts/check-vendor-drift.mjs

Vendor drift check — pinned SHA: 4a00bee5d5e618cf55da2469ec12307ebc620418
Checked 19 files: 19 OK, 0 DRIFT

All vendored files match pinned hashes. No drift detected.
```

## Fail (1-char mutation — trailing space appended to bulkAnswerDerivation.ts)

```
> node scripts/check-vendor-drift.mjs

Vendor drift check — pinned SHA: 4a00bee5d5e618cf55da2469ec12307ebc620418
Checked 19 files: 18 OK, 1 DRIFT

DRIFT DETECTED:
  MISMATCH src/vendored/ces-spine/services/bulkAnswerDerivation.ts
    expected: b57280f8f114f9e29d32426991cfe6d70d2ec7d2082b1f50272ba71dcaf9b145
    actual:   73c3b2bb77d3b3a6806609cbf29146adb74bc12a8060bcd3b0c4e3931733601a
```

Exit code 1 — CI fails on drift.

## Pass (after revert)

```
> node scripts/check-vendor-drift.mjs

Vendor drift check — pinned SHA: 4a00bee5d5e618cf55da2469ec12307ebc620418
Checked 19 files: 19 OK, 0 DRIFT

All vendored files match pinned hashes. No drift detected.
```
