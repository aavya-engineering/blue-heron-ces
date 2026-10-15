# CMMC Cloud Options for Solo Contractors -- One-Page Summary

**Prepared by Blue Heron Defense | April 2026 | v2.0**

---

## Recommendation: Microsoft 365 GCC G5 ($52/user/month)

- **Best value for CMMC Level 2** -- GCC G5 is cheaper than GCC G3 + the required CMMC add-on ($52 vs. $84/mo) with superior audit, DLP, and threat detection included natively
- **FedRAMP Moderate authorized** -- meets DFARS 7012 requirements for standard construction CUI (schedules, cost estimates, engineering specs)
- **GCC High ($93/mo) required only for ITAR, EAR, or NOFORN CUI** -- confirm export-control status with your contracting officer

---

## Critical: ITAR / EAR / NOFORN -- Start in GCC High or Start Over

- **There is no migration path from GCC to GCC High.** They are completely separate, isolated environments. If you start in GCC and later need GCC High, you must rebuild your entire tenant from scratch -- new accounts, new data migration, new configuration, new cost.
- **If there is any possibility you will handle ITAR, EAR, or NOFORN CUI -- now or in the future -- start in GCC High G5 ($93/mo) from day one.** The $41/mo premium over GCC G5 is negligible compared to the cost and disruption of a full tenant rebuild later.
- **Ask your contracting officer before you choose.** Review every active and anticipated contract for export-control markings. One ITAR document on a GCC tenant is a compliance violation.

---

## Infrastructure Options

- **M365 + Sentinel (recommended)** -- adds cloud SIEM at ~$500/mo for automated monitoring; achieves GREEN compliance readiness
- **M365-only (budget option)** -- $0 infrastructure cost; YELLOW readiness with 9 controls requiring documented M365 workarounds
- **Full Azure** -- ~$1,167/mo; rarely justified for small contractors

---

## Cost Summary (1-3 Users)

- **Year 1 total:** $45,000--$91,000 (dominated by C3PAO assessment at $30K--$50K and consulting at $5K--$16K)
- **Ongoing annual:** $624 (license only) to $6,624 (license + Sentinel)
- **July 2026 price increase:** GCC G5 rises to $55/mo (+$3) -- does not change the relative economics

---

## Why Comply Now

- **No certification = no CUI contracts** -- CMMC is a go/no-go bid requirement; non-responsive without it
- **Primes prefer certified subs** -- early movers gain competitive advantage in teaming and proposal scoring
- **CUI contracts are 60--70% of DoD construction advisory work** -- opting out shrinks your addressable market dramatically
- **Migration penalty:** moving from Commercial to GCC later costs $10K--$25K and takes 10--20 weeks; monthly savings of $30 takes 28--69 years to break even

---

## Timeline and Next Steps

1. **Provision GCC G5 tenant now** -- compliance features included, no add-on needed
2. **Configure security baseline** -- Conditional Access, DLP, sensitivity labels, Purview Audit
3. **Evaluate Sentinel** based on budget and risk tolerance
4. **Engage CMMC consultant** for Level 2 gap remediation ($5K--$16K)
5. **Schedule C3PAO assessment** -- assessors booking 6--12 months out as of Q2 2026; start 12--18 months before you need certification

---

*This is a summary of the full decision guide. Consult the complete document for cloud stack comparison matrices, control-by-control analysis, cost breakdowns, and sample DFARS flow-down language.*
