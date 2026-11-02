# gc-w9r2b-s2 (2026-10-31): s2-eng, W9-R2b

Re-baselined from run-20261031T020501Z. Verify 85/86; SPRS 67 unchanged. Explained red: V57 (302 GAPS rows vs 301 in nb-run66b, +1: the CM.L2-3.4.8 row). V69 within threshold. E9 red only as its roll-up.

Reason: DEPTH-1a replaced `CM.L2-3.4.8.detected-apps` (it listed Conditional Access policies; it now reads Intune detected apps). The old Muster verdict predicate was a free pass for CM.L2-3.4.8 (deny/allow-by-exception); it now records "undecidable" (`expect: null`, ces-muster 80a13a5), so RR-ACT-CM_L2_3_4_8 is unsure and adds GAPS row G-840fcc0934. Founder chose option A (accept and re-baseline), 2026-10-30. First round with the Muster results loop retired (V86 RETIRED, V100 PASS).

Legend: S1/S2/S3/MP = `s1-mach`/`s2-eng`/`s3-def`/`muster-partial`; W9-R2b = wave 9 proof round 2, rerun b; V-nn = verify checks (`PLAN.md` §5); V57 = GAPS row count never rises; V69 = SC-8a unsure-answer share at most 15 %; V86 = retired Muster results loop; V100 = Muster holds no execution results (ROLE-1/ROLE-3, the depth plan `DEPTH-REPORT-AND-PLAN.md`); E9 = overall run return code; SPRS = Supplier Performance Risk System score; option A = founder 2026-10-30 ruling accepting the honest CM.L2-3.4.8 change.
