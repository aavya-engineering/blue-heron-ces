# Run 44 (2026-10-28, second attempt "44b"): synthetic customer S1 (s1-mach), wave W5 cycle 1 proof (58 checks)

58/58 after re-baseline; EO 82/6/0/22 SPRS 49 (was 83/4/0/23 SPRS 46); Stamper 110/110; scorecard 6/10 rows within threshold (SC-1 7/7, SC-2 10/11, SC-3b, SC-4 22 %, SC-6 20/20 + 15/15, SC-7); GAPS 518 rows (was 985). OUTSIDE UNCHANGED.

Moves against the run-39 baseline, all explained:
- AT.L2-3.2.1, AT.L2-3.2.3 not assessed -> met (training population from assignedLicenses; predicted).
- IA.L2-3.5.11 met -> not assessed (founder decision: obscured authentication feedback is platform-inherited, not tested; predicted).
- IA.L2-3.5.7 met -> not met: Muster attaches the answered "maximum password age 60 days" (PI.ODP.006) to this control; S1's tenant never expires passwords (by design, SP 800-63B). Password age is not an SP 800-171A objective of 3.5.7, so this is a Muster expectation-mapping defect: cycle 2 item, with the policy-vs-configuration mismatch to be surfaced as a reconciliation finding instead.
- SC.L2-3.13.9 met -> not met: the organisation answered a 10-minute inactivity lock (PI.ODP.003); Stamper's screen-lock entry hard-codes 15 minutes. Honest (CES configured a weaker value than the customer's requirement; known W5 item from run 39's prediction): cycle 2 remediation = the entry takes the organisation's value.

First attempt (44a) failed verification (69/17/0/24, Stamper 106/110): Stamper's firewall and ASR entries read the settings catalog without $expand=settings (a live-tenant defect the old simulator route hid) and three evaluators lacked registry routes after the rewrite. Both fixed (ces-mono 5291533) before 44b.
