# gc-rf13-mp (2026-11-02): muster-partial

Re-baselined from run-20261102T121155Z (round R-F13). SPRS 24 = predicted 24 (PREDICT-RF13; R-F12 also observed 24). Founder rule: re-baseline on match (AR5).
Verify 122/129. Reds, all explained: V6, V8, V17, V27, V85, V108 compare against the old 36 baseline (gc-rf9-mp). The moves are the placeholder rule (founder ruling, LOG-FIX-SCORE §5): AC.L2-3.1.16, AC.L2-3.1.17, IR.L2-3.6.1 met->not_met (Wi-Fi SSID and incident-report address are the unanswered Muster placeholders), AU.L2-3.3.4 placeholder rationale, plus MP.L2-3.8.5 not_met->met (+1, the read now runs after block-storage). V17 failed set: AC.L2-3.1.16.wifi-profile, AU.L2-3.3.4.audit-config-alert, IR.L2-3.6.1.user-reporting, PS.L2-3.9.2.leaver-access-terminated (no past leaver on mp; honest).
V98: registry breadth, punch list (open).
