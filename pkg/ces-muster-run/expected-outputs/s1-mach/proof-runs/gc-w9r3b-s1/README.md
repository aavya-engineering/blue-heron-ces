# gc-w9r3b-s1 (2026-10-31): s1-mach, W9-R3b

Re-baselined. SPRS 67 -> 82: 9 controls not_assessed -> met (AU.L2-3.3.9, IR.L2-3.6.3, MA.L2-3.7.3, MA.L2-3.7.6, PE.L1-3.10.1/3/4/5, RA.L2-3.11.1). Explained reds: V8, V27, V85 (moves vs the old baseline) and V69 (SC-8a 15.5 %, accepted).

Reason: NS-4 reviews (pkg a626e49, tester 9d6f007) credit non-stack controls under GD-b. Observed equalled predicted (W9-R3). The founder approved the re-baseline (D-1, 2026-10-31). Proof of the V36 deduction fix and the V49 operator-UPN fix (pkg 753ed23).

Legend: S1/S2/S3/MP = `s1-mach`/`s2-eng`/`s3-def`/`muster-partial`; W9-R3b = wave 9 proof round 3, rerun b; V-nn = verify checks (`PLAN.md` §5, `GAP-CLOSURE-PLAN.md` §5); V8/V27/V85 = status counts vs the previous baseline; V69 = SC-8a unsure share at most 15 %; NS-4 = harness review step E8.6 (document reviews of non-stack objectives, reviewer not the uploader, rule GD-b); SPRS = Supplier Performance Risk System score; D-1 = founder decision 2026-10-31 to re-baseline (`docs/context/founder-questions/QUESTIONS-2026-10-31.md`).
