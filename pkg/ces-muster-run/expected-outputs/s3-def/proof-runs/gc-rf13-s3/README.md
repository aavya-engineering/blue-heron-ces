# gc-rf13-s3 (2026-11-02): s3-def

Re-baselined from run-20261102T113206Z (round R-F13). SPRS 19 (authoritative E7B) = predicted 19 (PREDICT-RF13; R-F12 also observed 19). Founder rule: re-baseline on match (AR5).
Verify 118/129. Reds against the old baseline, all explained (PREDICT-RF11 §3.3, LOG-FIX-SCORE §5): V8, V27, V85, V108 — AC.L2-3.1.7 met->not_met (S3 holds standing roles, no PIM eligibility; honest), IA.L2-3.5.8 met->not_met (honest), AU.L2-3.3.4 not_assessed->met, AU.L2-3.3.8 not_assessed->not_met, MP.L2-3.8.5 not_met->met (+1, read order). V17: failed set PS.L2-3.9.2.leaver-access-terminated (2 enabled past leavers, nobody confirmed; honest) replaces the retired leaver-workflow entry.
Stay red after this re-baseline (punch list): V36 and V47 (PL-113: the scenario's expected_improvements still lists AC.L2-3.1.7), V94 (AC.L2-3.1.18/3.1.19 capability-absent postchecks, open founder call), V98, V124, V125.
