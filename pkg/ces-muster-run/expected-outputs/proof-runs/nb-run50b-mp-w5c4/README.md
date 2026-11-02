# Run 50b (2026-10-28): muster-partial under synthetic-customer W5 cycles 3-4 (58 checks)

57/58 on re-verify after re-baseline (V43b: pass-1 drift vs run 50's stored snapshot = the AC.L2-3.1.5 across-build move; clears on the next muster-partial run, as before); Stamper 110/110 (CMMC-RemoteMaintenance-MFA created again after the lookup tightening; CMMC-Compliance-Windows created and assigned; every Intune object assigned; one update ring); EO 82/5/0/23 SPRS 43 (was 81/3/0/26 SPRS 38 at run 47; 77/9/0/24 SPRS 30 at run 50 before the fixes); scorecard 6/10 within (SC-1 7/7, SC-2 10/11, SC-3a 218/248 = 87.9 %, SC-3b, SC-4 17.1 %, SC-7); GAPS 508 (was 613). OUTSIDE UNCHANGED.

Moves vs run 47: MA.L2-3.7.1 / 3.7.2 / RA.L2-3.11.3 -> met (the assigned ring); AC.L2-3.1.5 -> not met (two standing Global Administrators, now visible through the served directory roles) and AC.L2-3.1.6 -> not met (the tenant's Global Administrator is a licensed normal account): both honest for an unmanaged generic tenant. The five compliance-decided controls that fell on run 50 (unassigned generic policies) are met again on CES's own assigned compliance policy, SC.L2-3.13.8 excepted by the attribution rule.

Still outside threshold on this scenario: SC-5 27/37 and SC-6 (no organisation content: muster-partial has no answers file by design); SC-8a 35/96 = 36.5 %; SC-8b 25/39.
