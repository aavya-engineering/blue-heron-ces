# Run 45 (2026-10-28): muster-partial regression under synthetic-customer W5 cycle 1 (58 checks)

57/58 on re-verify after re-baseline (V43b red: pass-1 drift vs run 42's snapshot = the five across-build moves below; clears on the next muster-partial run, as run 39 -> 43 did for S1); Stamper 110/110; EO 76/8/0/26 SPRS 29 (was 81/5/0/24 SPRS 38); scorecard 4/10 within (SC-1 7/7, SC-2 10/11, SC-3b, SC-4 23.7 %, SC-7); GAPS 624 rows (was 1047). OUTSIDE UNCHANGED.

Moves vs run 42, all explained:
- AC.L2-3.1.3 met -> not met: the tenant's only label is the generic 'Sim Policy Label 1'; the rewritten evaluator needs an active CUI-marking label, and Stamper's "CUI Sensitivity Label and Publishing Policy" entry is evidence-only (does not create it). Honest: cycle 2 Stamper item (create the label).
- IA.L2-3.5.7 met -> not assessed: no muster-partial read carries passwordMinimumLength (the generic compliance policies lack password fields). Simulator seed item (S1 carries them).
- IA.L2-3.5.8 met -> not met at Tier 1: the evidence-only entry IA.L2-3.5.8.password-policy-evidence returned an empty payload (outcome partial_success, verdict NOT_SAT) and EO counted it at Tier 1. Rule violation (empty = no opinion): cycle 2 EO fix; also a simulator seed item (/beta/settings and domain password settings on muster-partial).
- IA.L2-3.5.10 met -> not met: 8 conditional access policies read, none blocks legacy authentication for all users. Honest: CES has no Stamper entry that blocks legacy authentication (S1 met only because its seed carries one): cycle 2 Stamper item.
- IA.L2-3.5.11 met -> not assessed: founder decision (platform-inherited, not tested).
