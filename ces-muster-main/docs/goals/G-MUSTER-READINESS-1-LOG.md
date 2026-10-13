# G-MUSTER-READINESS-1 — completion record (sibling to the goal file)

## Gate 6 / M4 — weights-validation outcome: **PASS** (recorded 2026-07-25)

The sprsCalc.ts:9 mandate ("[validate with BHD] verify weights against current
methodology before any customer-facing use") was satisfied on 2026-07-12 by
**adopting the canonical methodology table** rather than by a manual review:

- Muster retired sprsCalc's inline WEIGHT_TABLE (which disagreed with the DoD
  methodology on 14+ controls) and now builds its lookup from the vendored
  canonical `sprs-weights.json` (**sprs-weights/2.0.0**, DoD Assessment
  Methodology v1.2.1 + 32 CFR 170.24), SHA-pinned in `vendor-manifest.json`
  (commit `5cd1e95`; muster-api's copy `6e3aa93`; parity fixture `9e7471c`).
- The ReadinessReport "pending BHD validation" banner was retired and replaced
  with a methodology-provenance note in the same commit.

**Independent verification (EO lane, 2026-07-25, GP-SPRS-PARITY-1, ces repo
commit `79e42da`):** all four copies of the table (ces-shared src + dist,
Muster's two vendored copies) are byte-identical (sha effcf570…), matching both
manifest pins; all 14 previously disputed weights carry single adjudicated
values; methodology invariants machine-checked (44×5 + 14×3 + 51×1 = 313,
floor −203, 110 requirements). A standing parity guard now lives in EO's suite
(`ces-eo/tests/unit/sprs-weights-parity.test.ts`) so future drift goes RED.

**Filing closed:** this record is the response to the EO filing in
`ces-eo/docs/design/readiness-report-contract.md` §3a ("Remaining formality —
Muster should record the 2.0.0 adoption as that outcome"). The section-3
"no customer-facing SPRS number ships" consequence was already lifted by EO's
§3a resolution; with this record, G-MUSTER-READINESS-1 gate 6 is closed. No
canon change was involved — ownership (Muster's computeSprs) and inputs (the
canonical table) both stand as already shipped.
