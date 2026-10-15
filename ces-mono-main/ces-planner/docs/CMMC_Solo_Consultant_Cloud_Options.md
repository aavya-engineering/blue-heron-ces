# Microsoft Cloud Options for CMMC Compliance

**A Decision Guide for Small Federal Construction Contractors**

*Prepared by Blue Heron Defense*

| | |
|---|---|
| **Date** | April 1, 2026 |
| **Version** | 3.0 |
| **Prepared By** | Blue Heron Defense |
| **Audience** | Small federal construction contractors (1-3 users) expecting CUI within 1-2 years |
| **Scope** | CMMC Level 2 compliance via Microsoft 365 GCC G5; comparison with Commercial, GCC G3, GCC High G3, and GCC High G5 |
| **Purpose** | Help small contractors choose the right Microsoft cloud stack for CMMC Level 2 compliance |

---

## 1. Executive Summary

### The Bottom Line

- **GCC G5 at $52/mo** -- recommended for non-ITAR CUI (no add-on needed)
- **GCC High G5 at $93/mo** -- required only for ITAR/EAR/NOFORN CUI
- **G5 cheaper than G3+add-on** by $32/mo ($52 vs. $84), better features
- **Biggest cost leap:** Commercial ($22) to GCC ($52), not G3 to G5

### Cost Snapshot

- **Year 1 total:** $45,000-$91,000 (assessment + consulting dominate)
- **Ongoing (Yr 2+):** $624-$6,624 depending on Sentinel choice
- **C3PAO assessment ($30K-$50K)** dwarfs every license difference
- **G5 TCO beats G3+add-on** -- $384/yr cheaper with superior audit retention

### When This Does NOT Apply

- **ITAR/EAR/NOFORN CUI** -- must use GCC High; see Path C (Section 3.3)
- **FCI only, no CUI** -- Level 1 Commercial tenant; see Path A (Section 3.1)

### Next Steps

- **Start with the decision flow** in Section 2
- **Book C3PAO 12-18 months ahead** -- assessor calendars fill 6-12 months ahead
- **Confirm CUI markings** with your contracting officer before choosing a tier

*Terms like CUI, GCC, and C3PAO are defined in the Glossary (Appendix B).*

---

## 2. Key Questions: Finding Your Path

Answer these four questions in order. Each routes you to the cloud stack and compliance path that fits your contracts.

CUI (Controlled Unclassified Information) is government data requiring NIST 800-171 safeguards -- it carries header markings like CUI//SP-CTI.

**1. Do your subcontracts include DFARS 7012 flow-down with CUI requirements?**
  - NO -- **Path A: FCI Only (Level 1).** See Section 3.1.
  - YES -- Continue to Question 2.

**2. Does your CUI carry ITAR, EAR, or NOFORN markings?**
  - YES -- **Path C: GCC High G5.** See Section 3.3.
  - NO -- Continue to Question 3.

**3. Will you handle CUI within the next 12 months?**
  - NO -- **Path B (deferred):** Provision GCC G5 now, defer C3PAO assessment. See Section 3.2.
  - YES -- Continue to Question 4.

**4. Can you budget $500/month (~$6,000/year) for Microsoft Sentinel?**
  - YES -- **Path B-Full (GREEN).** See Section 3.2.
  - NO -- **Path B-Light (YELLOW).** See Section 3.2.

### How to Answer Each Question

**Q1: DFARS 7012 flow-down.** Look at your prime contract or subcontract for the clause DFARS 252.204-7012, "Safeguarding Covered Defense Information and Cyber Incident Reporting." It is typically listed in the contract's incorporated clauses section. If your contracting officer or prime has not flowed this clause down, you are handling FCI only. When in doubt, ask your prime directly: "Does this subcontract require me to store, process, or transmit CUI?" If the answer is no -- or if the clause is absent -- you are Path A.

**Q2: ITAR, EAR, or NOFORN markings.** Check the CUI banner markings on documents you receive from or generate for your prime. ITAR data carries markings like "CUI//SP-EXPT" or references to the US Munitions List (USML). EAR data references the Commerce Control List (CCL) or Export Administration Regulations. NOFORN data is marked "CUI//NOFORN" or "Not Releasable to Foreign Nationals." If you are unsure, ask your prime's security officer or contracting officer for the CUI category list applicable to your contract. Any of these markings require GCC High -- GCC is not sufficient.

**Q3: CUI handling timeline.** This is a business planning question. Review your pipeline: Are you actively bidding on contracts that require CUI handling? Has your prime indicated CUI will be shared in the next 12 months? If CUI is more than 12 months away, you can provision GCC G5 now to avoid the Commercial-to-GCC migration penalty (see Path A gotcha) while deferring the C3PAO assessment cost until CUI handling is imminent. Assessors are booking 12-18 months out as of Q2 2026, so factor in lead time.

**Q4: Sentinel budget.** Microsoft Sentinel is billed on data ingestion volume. For a solo contractor or small team, $500/month (~$6,000/year) is a realistic planning estimate. Check your current monthly IT spend: can you absorb this cost, or would it strain cash flow? If Sentinel is not feasible now, Path B-Light uses M365-native tools for the same nine controls with manual workarounds -- compliant but rated YELLOW instead of GREEN. You can add Sentinel later without tenant migration.

---

## 3. Your Path Forward

Each path below provides the specific stack, costs, gotchas, and next steps for your situation.

### 3.1 Path A -- FCI Only (Level 1)

> **WARNING:** Commercial tenants cannot upgrade to GCC. If CUI is even 1-2 years away, start in GCC G5 instead. See breakeven math below.

**Stack.** Commercial Business Premium at $22/user/month. Adequate for Level 1 FCI-only workloads. Not authorized for CUI.

**Costs.** Year 1 total: $9,000-$22,000 (L1 self-assessment plus consulting). Ongoing annual cost: $264 (license only, no infrastructure).

**Gotcha: no upgrade path to CUI.** Commercial tenants cannot be upgraded to GCC in place. Moving from Commercial to GCC is a full tenant rebuild costing $10,000-$25,000 in migration services over 10-20 weeks. The monthly savings of $30 (Commercial at $22 vs. GCC G5 at $52) yields only $360 per year per user. Against a $10,000-$25,000 migration cost, the breakeven is 28 to 69 years. If CUI is even 1-2 years away, the math strongly favors starting in GCC G5 from day one and avoiding migration entirely.

**Next Steps.** Complete L1 self-assessment and submit SPRS score. No C3PAO assessment is required for Level 1.

### 3.2 Path B -- CUI without ITAR (Level 2 GCC)

**Stack.** Microsoft 365 GCC G5 at $52/user/month. FedRAMP Moderate authorized, suitable for CUI without export controls. Includes Purview Audit Premium (one-year retention), Insider Risk Management, Advanced DLP, and Defender for Endpoint Plan 2 -- no CMMC add-on required.

**Pricing insight.** GCC G5 at $52/mo is $32/mo cheaper than GCC G3 plus the required CMMC add-on ($84/mo) while providing superior audit retention and threat detection. The biggest cost leap is from Commercial ($22) to GCC ($52), not from G3 to G5.

**Gotcha: C3PAO lead time.** Assessor calendars fill 6-12 months ahead as of Q2 2026. Start your compliance program **12-18 months** before you expect to need certification. The assessment is a 3-5 day engagement covering documentation review, systematic control testing, evidence sampling, personnel interviews, and findings review. Certification is delivered 2-4 weeks later, valid for 3 years with annual affirmation.

**Gotcha: July 2026 price increase.** GCC G5 rises from $52 to $55/mo effective July 1, 2026 (+$36/year). This does not change the relative economics -- G5 remains the better value at Level 2.

Two facts that may surprise contractors. First, not all CUI requires GCC High -- CMMC requires a FedRAMP Moderate (or equivalent) environment, and GCC meets this threshold. GCC High is required only for export-controlled information. Second, GCC G5 at $52/mo is cheaper than GCC G3 plus the required CMMC add-on ($84/mo) while providing superior features.

> **How compliance changes your daily work:**
> - Use separate browser profiles for CUI vs. non-CUI work, with separate login sessions for your GCC environment
> - Enable MFA on every login -- no saved passwords or auto-login; every session requires a second factor
> - Store CUI files only in GCC SharePoint/OneDrive -- not Dropbox, Google Drive, or USB; misplaced CUI is a reportable incident
> - Budget 1-2 hours/month for compliance administration -- reviewing security logs, verifying policies, and updating incident response records

#### B-Full (GREEN)

**Stack.** GCC G5 + Microsoft Sentinel (~$500/month) for automated SIEM monitoring, threat detection, and incident management. This achieves GREEN readiness -- the strongest compliance posture for a small contractor.

**Costs.** Year 1 total: $45,000-$91,000 (license + Sentinel + C3PAO assessment + consulting). Ongoing annual cost: $6,624 ($624 license + $6,000 Sentinel).

**Next Steps:**
1. Provision GCC G5 tenant (compliance features included, no add-on needed)
2. Configure security baseline (Conditional Access, DLP, sensitivity labels, Purview Audit)
3. Deploy Microsoft Sentinel for automated security monitoring
4. Engage CMMC consultant for L2 gap remediation ($5,000-$16,000)
5. Schedule C3PAO assessment (allow 12-18 months lead time)
6. Confirm with contracting officer that CUI does not involve ITAR/EAR/NOFORN

#### B-Light (YELLOW)

**Stack.** GCC G5 M365-only deployment with no Azure infrastructure. Zero infrastructure cost. Rated YELLOW because nine Azure-dependent controls require M365-native workarounds.

**Costs.** Year 1 total: $9,624 (license + L1/L2 startup costs without C3PAO). Ongoing annual cost: $624 (license only).

**Workarounds required.** Nine security requirements use manual workarounds instead of automated tools -- compliant but requires more admin time. These cover audit review and analysis, alert monitoring, incident tracking, and six network/encryption controls, all satisfied with M365-native features instead of Azure infrastructure.

**Upgrade path.** Sentinel is the first upgrade when budget allows -- it eliminates the YELLOW workarounds and achieves GREEN readiness. Upgrade when audit log analysis exceeds 3-5 hours/month or your C3PAO flags the workarounds. Adding Sentinel does not require tenant migration; it is an Azure add-on to your existing GCC G5 environment.

### 3.3 Path C -- CUI with ITAR/EAR/NOFORN (Level 2 GCC High)

**Stack.** GCC High G5 at $93/user/month + Microsoft Sentinel (~$500/month). GCC High operates on a completely isolated government cloud with US-person-only staffed data centers, authorized for Impact Level 4/5 workloads including ITAR, EAR, and NOFORN data. The G5 tier's $108/year premium over G3 ($93 vs. $84 with add-on) is negligible relative to total compliance costs and buys one-year audit retention and ML-based anomaly detection.

**Costs.** Year 1 total: $46,000-$52,000 (license + Sentinel + C3PAO assessment + consulting). Ongoing annual cost: $7,116 ($1,116 license + $6,000 Sentinel).

**Gotcha: 30-day provisioning.** GCC High tenant provisioning takes up to 30 days. Plan accordingly.

**Gotcha: no migration path from GCC.** There is no in-place migration from GCC to GCC High. They are entirely separate environments requiring a full tenant rebuild. If there is any chance your CUI will carry ITAR/EAR/NOFORN markings, start in GCC High from day one.

**Gotcha: July 2026 price increase.** GCC High G5 rises from $93 to $98/mo effective July 1, 2026 (+$60/year).

**Next Steps.** Confirm ITAR/EAR/NOFORN status with your contracting officer. Provision GCC High G5 tenant (allow 30 days). Deploy Sentinel. Engage CMMC consultant and schedule C3PAO assessment (allow 12-18 months lead time).

---

## 4. Your First 12 Months

You have chosen your path. Here is what the compliance journey looks like, month by month, starting from the decision to act.

### The Roadmap

| Months | Milestone | What You're Doing |
|--------|-----------|-------------------|
| 1-2 | **Scope and provision** | Define your enclave boundary. Engage a CSP partner to provision your GCC (or GCC High) tenant. Start the SSP. |
| 2-4 | **Configure and harden** | Deploy security baseline: Conditional Access, MFA, DLP policies, sensitivity labels, Purview Audit. Add Sentinel if budgeted. |
| 3-5 | **Self-assess and submit SPRS** | Score yourself against all 110 NIST 800-171 controls. Submit your SPRS score. Identify gaps. |
| 4-8 | **Remediate gaps** | Close open POA&M items. Build evidence binders. Engage a CMMC consultant if needed ($5K-$16K). |
| 6-10 | **Pre-assessment readiness** | Conduct a mock assessment or RPO readiness review. Fix findings. Finalize SSP and POA&M. |
| 8-12 | **C3PAO assessment** | 3-5 day on-site/virtual assessment. Certification delivered 2-4 weeks after. Valid for 3 years with annual affirmation. |

This timeline assumes you booked your C3PAO at month 1. If you haven't, add their current lead time (6-12 months for scheduling as of Q2 2026) on top of month 8-12.

### Define Your Enclave

Before anything else, draw a boundary around what's in scope. Everything inside the boundary must meet all 110 controls. Everything outside is irrelevant to CMMC.

For a solo contractor working from home, your enclave is typically:

- **Your M365 GCC tenant** -- Exchange, SharePoint, OneDrive, Teams
- **The devices you use to access CUI** -- your work laptop, your phone if it connects to your GCC tenant
- **Your home office** -- the physical space where CUI is viewed, discussed, or printed
- **Your network** -- the Wi-Fi and internet connection used to access CUI systems

Keep it small. Every device, application, and physical space you add to the enclave is another thing you must secure, document, and defend during assessment. A solo contractor's greatest advantage is a tight enclave.

**Common scoping mistake:** including personal devices, family computers, or commercial cloud accounts in the enclave. Don't. Use separate devices (or at minimum, separate browser profiles and user accounts) to keep CUI work isolated.

### Build Your SSP

The System Security Plan is the master compliance document -- the first thing your C3PAO will ask to see. It describes how you implement each of the 110 NIST 800-171 controls in your specific environment.

**What goes in the SSP:**
- **System boundary description** -- your enclave diagram showing devices, cloud services, network topology, and data flows
- **Control-by-control implementation statements** -- for each of the 110 controls, a description of how you satisfy it (e.g., "MFA is enforced via Conditional Access policy requiring Microsoft Authenticator for all user sign-ins")
- **Roles and responsibilities** -- who manages what (for a solo contractor, this is mostly you)
- **Inventory** -- hardware, software, and cloud services in scope
- **Interconnections** -- any external systems that touch your enclave (prime's SharePoint, subcontractor access)

**How much work:** 40-80 hours for a solo contractor starting from scratch. A CMMC consultant can accelerate this with templates and guided workshops. The SSP is a living document -- you update it whenever your environment changes.

### Provision Your GCC Tenant

You cannot purchase GCC or GCC High licenses directly from Microsoft's website. You need a **Cloud Solution Provider (CSP)** authorized for government cloud.

**Steps:**
1. Find a CSP partner authorized for GCC (or GCC High). Microsoft's Solution Provider directory filters by government cloud authorization. Your CMMC consultant may have a preferred partner.
2. Provide your organization's DUNS/UEI number and government contract documentation. The CSP validates your eligibility for government cloud.
3. The CSP provisions your tenant. GCC typically takes 1-2 weeks. GCC High takes up to 30 days.
4. Configure your domain, users, and security baseline.

**Important:** Do not provision a Commercial tenant "to get started" and plan to migrate later. There is no in-place upgrade path from Commercial to GCC (or from GCC to GCC High). Start in your target cloud from day one.

### Know Your SPRS Score

The Supplier Performance Risk System (SPRS) is the DoD's dashboard for contractor cybersecurity posture. Primes and contracting officers check your SPRS score before awarding work.

**How it works:**
- Self-assess against all 110 NIST 800-171 controls
- Each unmet control has a weighted penalty value (1, 3, or 5 points)
- A perfect score is 110 (all controls met). The lowest possible score is -203 (no controls met)
- Submit your score to SPRS through the SPRS portal (requires a DoD-approved identity credential)

**Reality check:** Most newcomers score between -100 and -170 on their first honest self-assessment. This is normal. The score improves as you remediate gaps and close POA&M items. Do not inflate your score -- a fraudulently high SPRS score is a False Claims Act risk.

**Primes are watching.** Even before CMMC enforcement deadlines, primes are filtering subcontractors by SPRS score. Having a submitted score -- even a low one with a credible remediation plan -- is better than having no score at all.

### Understand Your Incident Reporting Obligation

DFARS 252.204-7012 requires you to report cyber incidents affecting CUI to the DoD Cyber Crime Center (DC3) **within 72 hours** of discovery. This is a legal obligation from the moment you handle CUI, not something you prepare for later.

**What counts as a reportable incident:** unauthorized access to your CUI systems, CUI sent to the wrong recipient, a compromised device that had access to CUI, ransomware or malware affecting systems in your enclave.

**What to have ready before you handle CUI:**
- A written incident response plan (even a 2-page document counts -- it must exist)
- The DC3 reporting portal bookmarked (https://dibnet.dod.mil)
- Your contracting officer's contact information for notification
- A process for preserving forensic evidence (at minimum: do not wipe or reimage affected systems for 90 days)

### When to Hire Help

You do not need to outsource your entire compliance program, but most solo contractors benefit from targeted professional help at specific points.

| Role | What They Do | When You Need Them | Typical Cost |
|------|-------------|-------------------|-------------|
| **CMMC Consultant** | SSP development, gap remediation, assessment prep | Months 1-8 (20-40 hours) | $5,000-$16,000 |
| **RPO (Registered Practitioner Organization)** | Readiness assessment, gap analysis, remediation guidance | Months 3-6 (optional) | $3,000-$8,000 |
| **CSP Partner** | GCC/GCC High tenant provisioning and licensing | Month 1 | Included in licensing |
| **C3PAO** | Formal CMMC Level 2 certification assessment | Months 8-12 | $30,000-$50,000 |
| **MSP (Managed Service Provider)** | Ongoing IT management, monitoring, patching | Ongoing (optional) | $500-$2,000/month |

**What you can do yourself:** Daily compliance tasks (log review, policy enforcement, incident response), SPRS self-assessment, evidence collection, and annual affirmation. A solo contractor who invests the time to understand the 110 controls can manage ongoing compliance without an MSP.

**What you should probably hire out:** SSP drafting (unless you're comfortable writing technical security documentation) and the initial security baseline configuration of your GCC tenant.

---

## 5. Cost Analysis for a 1-3 User Organization

Every dollar figure cites its source: retail/list prices from Microsoft public pricing and volume/planning estimates from the CES-FE internal cost model. Solo consultants will pay retail/list prices.

### Total Annual Cost Scenarios

| Stack Configuration | License (Annual) | Infra (Annual) | Year 1 Startup | **Year 1 Total** | Ongoing (Yr 2+) | Readiness |
|--------------------|-----------------|---------------|----------------|------------------|-----------------|-----------|
| Commercial + M365-only | $264 | $0 | $9,000 | **$9,264** | $264 | L1 (FCI) |
| GCC G5 + M365-only | $624 | $0 | $9,000 | **$9,624** | $624 | L1/L2 (CUI non-ITAR) YELLOW |
| GCC G5 + Sentinel | $624 | $6,000 | $45,000 | **$51,624** | $6,624 | L2 (CUI non-ITAR) GREEN |
| GCC High G3 + Sentinel | $1,008 | $6,000 | $45,000 | **$52,008** | $7,008 | L2 (CUI) GREEN |
| GCC High G5 + Sentinel | $1,116 | $6,000 | $45,000 | **$52,116** | $7,116 | L2 (CUI) GREEN |
| GCC High G5 + M365-only | $1,116 | $0 | $45,000 | **$46,116** | $1,116 | L2 (CUI) YELLOW |

*Year 1 startup assumes C3PAO assessment (midpoint $40,000) plus consulting ($5,000) for L2 rows, and L1 self-assessment (midpoint $5,000) plus consulting ($4,000) for L1 rows. Migration cost not included (assumes starting in target cloud from day one). Sentinel annual cost uses $500/month midpoint. Readiness ratings: GREEN indicates full compliance path, YELLOW indicates 9 Azure controls require M365 alternative implementations. July 2026 price increases will add approximately $36-$96 per year and are not reflected in this table.*

### Hidden Year 1 Costs

License and infrastructure costs are the visible recurring expenses. Year 1 includes substantial one-time costs that frequently exceed annual license spend.

| Cost Item | L1 Self-Assessment | L2 Self-Assessment | L2 C3PAO Assessment |
|-----------|-------------------|-------------------|---------------------|
| Assessment Fee | $4,000-$6,000 | $37,000-$49,000 | $30,000-$50,000 |
| Tenant Migration (if applicable) | $0 | $10,000-$25,000 | $10,000-$25,000 |
| Consulting (20-40 hrs @ $250-$400/hr) | $5,000-$16,000 | $5,000-$16,000 | $5,000-$16,000 |
| **Total Year 1 Startup** | **$9,000-$22,000** | **$52,000-$90,000** | **$45,000-$91,000** |

*Assessment costs sourced from independent research. Migration costs apply only if starting in Commercial or GCC and moving to GCC High. Consulting hours assume gap remediation, evidence collection, and assessment preparation. L2 self-assessment is available only if the contract allows; most L2 contracts require C3PAO assessment.*

Year 1 is dominated by startup costs, not licensing. The C3PAO assessment alone ($30,000-$50,000) dwarfs the license difference between any two stacks. Sentinel at $6,000/year is the largest recurring infrastructure expense and the first candidate for cost optimization if YELLOW readiness is acceptable.

**July 2026 price increases** (effective July 1): GCC G5 rises from $52 to $55/mo (+$36/year); GCC High G5 from $93 to $98/mo (+$60/year). These do not change the relative economics -- G5 remains the better value at Level 2.

**A note on cyber insurance:** Standard E&O policies typically exclude cyber incidents. If you handle CUI, expect $2,000 to $5,000 per year for $1 million in cyber liability coverage. Some C3PAOs ask for proof of cyber insurance during assessment.

**Key takeaway:** Year 1 costs are dominated by assessment fees ($30,000-$50,000 for C3PAO) and consulting ($5,000-$16,000), not licensing. GCC G5 at $52/mo saves $384/year over GCC G3 plus the add-on while providing better features. The stack selection decision should be driven by compliance posture and long-term cost, not Year 1 optimization.

---

## 6. Why CMMC Is Hard for Small Contractors

Approximately 80,000 defense contractors need CMMC Level 2 certification. As of early 2026, fewer than 270 hold final certificates -- less than 0.4%. Only 1% of contractors report feeling fully prepared. This is not a readiness gap caused by negligence. It is a structural problem: CMMC was designed for the defense industrial base at scale, but the compliance burden does not scale down. A one-person construction advisory firm faces the same 110 controls, the same C3PAO assessment, and the same documentation requirements as a 500-person defense manufacturer.

Here is what makes it genuinely difficult at your scale.

### Four Phases, Four Pain Points

CMMC compliance is not a single event -- it is a lifecycle with distinct phases, each carrying its own cost and complexity.

| Phase | What's Involved | Manual Cost | Manual Time |
|-------|----------------|-------------|-------------|
| **Plan** | Understand 110 controls, scope your enclave, choose your cloud stack, build your SSP and policies | $40,000-$100,000 | 4-8 weeks |
| **Execute** | Configure your tenant: Conditional Access, DLP, sensitivity labels, audit logging, Sentinel, hundreds of settings | 80-200 hours | Weeks to months |
| **Maintain** | 85+ operational procedures: log reviews, access reviews, patching, incident response, evidence capture | Ongoing | 2-8 hours/month |
| **Assess** | Collect evidence for all 110 controls, assemble C3PAO package, calculate SPRS score, prepare for 3-5 day assessment | $50,000-$200,000 | Weeks |

Total manual compliance cost: **$150,000-$500,000+** per organization. No single competitor covers all four phases with automation.

### The Documentation Wall

The SSP alone is a 60-100 page document describing how you implement each of the 110 controls. Then add the POA&M, incident response plan, configuration management plan, access control policy, media protection policy, and a dozen more -- 18 policy documents in total for a typical Level 2 program. Most small contractors hit this wall in month 2 and stall. Not because the controls are technically impossible, but because translating "what I actually do" into formal security documentation is unfamiliar, time-consuming, and unforgiving. A missing control statement or an inconsistent description across documents is an assessment finding.

### You Are Every Role

Large organizations have a CISO, a sysadmin, an IT security analyst, a compliance officer, and an incident responder. You are all of them. CMMC doesn't care. Control PE.L2-3.10.6 requires "escort visitors and monitor visitor activity" -- you need a policy for that even if your office is your spare bedroom. Control PS.L2-3.9.2 requires "ensure CUI is protected during personnel actions" -- you need a documented offboarding process even if you have no employees. Every control must be addressed, even when the control clearly envisions a larger organization.

### The Cost-to-Revenue Problem

Year 1 compliance costs of $45,000 to $91,000 represent a significant fraction of annual revenue for a small contractor. A solo consultant billing $150,000-$300,000 per year is spending 15-60% of gross revenue on compliance in Year 1. The C3PAO assessment alone ($30,000-$50,000) may exceed the value of the subcontract that triggered the requirement. This is the economics problem: CMMC compliance has a high fixed cost that large contractors absorb across hundreds of employees and millions in revenue, but small contractors absorb across one person and one contract.

### The C3PAO Capacity Crisis

Fewer than 100 authorized C3PAOs exist to serve 80,000 contractors. Current wait times run 6-12 months. By late 2026, projections reach 24-30 months. Assessment fees are already $31,000-$76,000 and escalating toward $75,000-$150,000 as demand outpaces supply. A failed assessment still costs full price, and you start over. The math is brutal: 100 assessors, 80,000 companies, 3-year recertification cycles.

### The Vendor Confusion Problem

The CMMC ecosystem is crowded with consultants, RPOs, C3PAOs, MSPs, and software vendors -- all selling different things, many overpromising. Common traps for newcomers:

- **Buying GCC High when GCC is sufficient.** A $41/month/user premium ($492/year) with no compliance benefit unless you handle ITAR/EAR/NOFORN.
- **Paying for an MSP to "manage compliance" at $1,500/month** when your 1-user enclave needs 2 hours/month of administration.
- **Engaging a C3PAO before you're ready.** A failed assessment still costs $30,000-$50,000 and you start over.
- **Buying compliance software designed for 200-user organizations** with feature complexity and pricing that doesn't fit a solo contractor.

### The Moving Target

CMMC 2.0 rulemaking has shifted timelines repeatedly since 2020. The final rule (32 CFR Part 170) took effect December 16, 2024, with a phased rollout: Phase 1 (self-assessment in solicitations) began November 2025, Phase 2 (mandatory C3PAO certification) begins November 2026, with full enforcement by November 2028. But contract-specific deadlines vary, prime contractor expectations evolve faster than regulation, and Microsoft pricing changes mid-cycle (July 2026 increases). Staying current requires ongoing attention that competes with billable work.

### The Evidence Burden

Compliance is not a one-time project. Your C3PAO certifies you for 3 years, but you must maintain evidence continuously: audit logs, access reviews, policy acknowledgments, incident response tests, configuration change records. If your annual affirmation cannot be supported by current evidence, your certification is at risk. For a solo contractor without automated tooling, this means disciplined monthly maintenance -- the kind that slips when project deadlines press.

### The Market Consequence

An estimated 15-20% of DIB companies may exit the defense market rather than achieve certification, redistributing approximately $42 billion in annual contract value. For those who stay and certify, the competitive advantage is significant. For those who delay, the window is closing.

---

## 7. How Blue Heron CES Helps

Blue Heron Defense built the Compliance Engineering System (CES) to solve the structural problem described above: four lifecycle phases, each requiring specialized expertise, each carrying significant cost, and no existing platform covering all four with real automation.

CES is not a compliance tracker or a document library. It is a four-subsystem platform that automates each phase of the CMMC lifecycle -- Plan, Execute, Maintain, and Assess -- producing the specific artifacts your C3PAO needs to certify you.

### Phase 1: Planner -- Scope, Assess, and Plan

The Planner is where your compliance journey starts. It replaces the $40,000-$100,000 planning phase with a guided, question-driven workflow.

**Strategic Intent Tool (SIT).** CES asks targeted questions about your contracts, data types, CUI markings, and infrastructure to generate an immutable SI Baseline -- the foundation document that defines your enclave boundary, your certification target, and your compliance scope. This replaces weeks of scoping conversations with a structured, repeatable process that locks your strategic decisions into an auditable record.

**Readiness Recon Tool (RRT).** CES walks you through each applicable NIST 800-171 control with plain-language questions and evidence prompts. You answer honestly about what you have in place today. A bulk derivation engine auto-resolves 60-80% of your control statuses from a handful of infrastructure inputs -- you don't answer 110 questions; you answer the ones that matter. CES generates a Readiness Posture: a scored gap analysis showing exactly where you stand, which gaps are critical, and which are already satisfied by your cloud configuration.

**Mission Planning Tool (MPT).** Based on your gaps, CES compiles findings from five independent sources and generates schema-validated artifacts:

- **Mission Plan** -- A step-by-step remediation roadmap mapping each gap to specific actions, owners, and timelines
- **Executive Plan** -- A summary for your prime or leadership showing compliance trajectory and resource requirements
- **Cost Proposal** -- A task-level cost estimate with infrastructure and labor breakdowns
- **Infrastructure Manifest** -- A technical specification for your target-state tenant configuration, ready for execution
- **18 Policy Documents** -- Access control, incident response, media protection, and 15 more -- generated from templates with your organization's details injected, not generic boilerplate

**What this replaces:** 4-8 weeks of consultant-led scoping, gap analysis, and documentation at $250-$400/hour. CES does the discovery and planning in days, producing the same artifacts a consulting engagement would -- validated against CMMC schemas, specific to your environment, structured for your assessor.

### Phase 2: Stamper -- Configure Your Tenant

Planning tells you what to do. Stamper does it. It is a deterministic execution engine that configures your Microsoft 365 GCC or GCC High tenant to meet CMMC Level 2 requirements.

**172-entry command registry.** Every CMMC-relevant tenant configuration -- Conditional Access policies, DLP rules, sensitivity labels, audit logging, Sentinel analytics rules, Exchange transport rules, SharePoint sharing controls -- is encoded as a verified, tested command. Not documentation. Not a checklist. Executable commands that Stamper runs against your live tenant.

**GCC High-native.** Stamper is built for Microsoft's sovereign government cloud endpoints (`.microsoft.us`), not adapted from commercial tooling. It encodes 24 documented behavioral differences between commercial M365 and GCC High that would otherwise cause silent configuration failures -- deprecated flags, broken extensions, region constraints, permission model gaps that don't appear in Microsoft's public documentation.

**Idempotent and verifiable.** Every command follows a GET-then-SET pattern: check the current state, apply the change only if needed, verify the result. Multi-factor output verification (exit code, SET output, and evidence field) produces a weighted confidence score for each configuration change. Nothing is assumed; everything is measured.

**Evidence captured automatically.** Every configuration change produces a cryptographically hashed evidence record -- pre-state, post-state, and verification output. Your C3PAO doesn't have to take your word for it; they can verify the hash.

**What this replaces:** 80-200 hours of manual PowerShell configuration, referencing scattered Microsoft documentation, hoping each command works the same in GCC High as it does in commercial (it often doesn't), and producing no verifiable evidence that you did it correctly.

### Phase 3: AdminOps -- Maintain Compliance Daily

Certification is a 3-year credential with annual affirmation. AdminOps is the operational playbook that keeps you compliant between assessments.

**85 operational use cases across 8 domains.** Identity and access management (17 use cases), device management (12), credential lifecycle (10), data protection (10), audit and monitoring (10), security posture (10), personnel security (8), and incident response (8). Each use case maps to specific CMMC practices, includes the exact GCC High PowerShell commands or admin console steps, and defines what evidence to capture.

**Three-tier separation of duties.** Even for small organizations, CMMC requires role separation for privileged operations. AdminOps defines which operations require standard admin access, which require elevated privileges via Privileged Identity Management (PIM), and which require two-person approval -- with audit logging at every tier.

**Continuous evidence capture.** Every admin action -- user provisioning, access review, policy change, incident response -- produces a metadata-tagged evidence artifact linked to the CMMC practice it satisfies. When your annual affirmation comes due, the evidence already exists.

**What this replaces:** Ad-hoc compliance administration where you "do the right thing" but have no systematic evidence that you did. The difference between passing and failing a recertification assessment is often not whether you maintained compliance, but whether you can prove it.

### Phase 4: EvidenceOps -- Prove It to Your Assessor

Your C3PAO assessment is a 3-5 day engagement where an independent assessor verifies every control. EvidenceOps automates the most painful part: assembling the evidence package.

**Automated 110-control assessment.** EvidenceOps queries your live tenant against the same 172-entry command registry Stamper uses, discovers your current compliance state, and merges evidence from four sources: live discovery results, Stamper execution records, AdminOps operational evidence, and Planner policy documents. One assessment run produces a complete compliance snapshot with per-control provenance.

**SSP generation.** The System Security Plan -- the 60-100 page document that stops most small contractors cold -- is generated from your actual tenant configuration and assessment results. Per-control implementation narratives, system boundary descriptions, data flow diagrams, roles and responsibilities, and evidence citations. Not a template you fill in; a document that reflects your real environment.

**SPRS score calculation.** Your Supplier Performance Risk System score is calculated using DoD Assessment Methodology v1.2.1 with proper weighted deductions, partial credit, and POA&M eligibility rules. No guessing, no spreadsheet formulas, no accidentally inflating your score.

**C3PAO evidence package.** A single assessor-ready ZIP containing: cover sheet, SSP, SPRS score, POA&M, evidence organized by CMMC practice family, and an integrity manifest with SHA-256 hashes for every artifact. Your assessor can independently verify that no evidence has been modified since capture.

**What this replaces:** Weeks of manual evidence collection, screenshot-taking, spreadsheet assembly, and document formatting that typically costs $50,000-$200,000 in professional services. EvidenceOps does it in hours, with cryptographic proof of integrity that manual methods cannot provide.

### The Evidence Integrity Chain

Across all four subsystems, every artifact is SHA-256 hashed at creation, stored in Azure Immutable Blob Storage with a 7-year WORM (Write Once, Read Many) retention policy, and signed with Azure Key Vault RSA-PSS 2048-bit digital signatures. This is not compliance theater. It means:

- **Evidence cannot be tampered with** after capture -- WORM storage is physically immutable
- **Your assessor can verify independently** -- recompute the hash, check the signature, confirm the chain
- **Chain of custody is automated** -- who captured what, when, from what system, linked to which control

No other CMMC platform provides an end-to-end cryptographic evidence chain from planning through assessment.

### Why This Matters for a Solo Contractor

**It covers the full lifecycle.** Most compliance tools address one phase -- planning OR tracking OR documentation. CES covers Plan, Execute, Maintain, and Assess as a single integrated platform. You are not assembling a toolchain from four vendors.

**It is built for your cloud.** CES is native to Microsoft 365 GCC and GCC High, encoding the specific endpoints, commands, and behavioral differences that matter for government cloud. Commercial compliance tools adapted for GCC High miss the 24+ behavioral divergences that cause silent failures.

**It is designed for your assessor.** Every artifact CES produces -- the SSP, the evidence package, the SPRS score, the POA&M -- is structured for C3PAO consumption. Assessors who receive CES evidence packages complete their review faster because the format aligns with their methodology. This is deliberate: CES is optimized for the person who decides whether you pass.

**It runs offline.** The Planner operates entirely on your local machine with no cloud dependency. Your compliance data -- contract details, control assessments, gap analysis, remediation plans -- never leaves your device. For a contractor handling CUI, this is not a convenience feature; it is a security requirement.

### What CES Does Not Replace

- **Your C3PAO assessment.** CES prepares you for the assessment and packages your evidence; it does not certify you.
- **Legal advice.** CES does not interpret your contract clauses or advise on DFARS compliance obligations.
- **Business judgment.** CES tells you what compliance requires and what it costs; you decide whether the contract is worth pursuing.

CES is the difference between spending $150,000-$500,000 on manual compliance with uncertain outcomes and spending a fraction of that with a structured plan, automated execution, continuous evidence, and an assessor-ready package -- knowing exactly where you stand at every point in the lifecycle.

---

## 8. CMMC Context

*If you already understand CMMC Level 2 and CUI, this section is optional reference. Skip to the Appendix (Section 9) or return to the decision flow (Section 2).*

Your subcontract from the prime contractor includes a DFARS 7012 flow-down clause requiring you to implement NIST SP 800-171 controls and obtain CMMC certification by a contract-specific deadline. It does not matter that you are a one-person shop -- if your subcontract involves CUI, you need the same certification as a 500-person defense manufacturer. This is the contract flow-down problem: the Department of Defense requires prime contractors to meet CMMC standards, and primes flow those requirements down to every subcontractor who touches CUI.

### What CUI Looks Like in Construction Work

CUI markings appear as headers, footers, or banner lines on documents. Here are examples specific to construction advisory work:

- **Architectural and engineering drawings** marked "CUI//SP-CTI" (Controlled Technical Information) -- floor plans, structural details, or MEP layouts for a DoD facility.
- **Cost estimates and pricing data** marked "CUI//SP-PROCURE" (procurement-sensitive) -- detailed cost breakdowns, independent government estimates, or budget exhibits.
- **Project schedules with DoD facility milestone data** -- master schedules showing construction phasing or commissioning timelines for secure facilities.
- **RFI and submittal logs containing facility layout details** -- responses describing building configurations, security features, or utility routing for DoD installations.
- **Geospatial and site survey data** -- survey coordinates or GIS layers for secure facilities that reveal layout or access points.

For contrast, these are typically NOT CUI: your invoice to the prime, your capability statement, FAR-based subcontract documents without CUI markings, or internal project notes that do not contain government-furnished information. Those are Federal Contract Information (FCI), which requires only Level 1.

### Level 1 vs. Level 2

CMMC Level 1 covers FCI with 17 controls and a self-assessment. Level 2 covers CUI with 110 controls from NIST SP 800-171 spanning 14 security domains. The jump from 17 to 110 controls is not incremental -- it is a fundamentally different compliance posture, adding entire domains (Personnel Security, Physical Protection, Recovery, Risk Assessment, Security Assessment, Situational Awareness) and deepening existing ones (Access Control expands from 4 to 22 controls). Most contracts involving CUI require a C3PAO assessment -- an independent third-party audit resulting in formal certification, costing $30,000 to $50,000 for organizations under 50 users.

Construction advisory work almost always involves CUI because engineering specifications, cost estimates, and program schedules routinely carry CUI markings. If any document you handle carries a CUI banner, you need Level 2.

> **What Does a C3PAO Assessment Look Like?** The assessment is a 3 to 5 day engagement. Day 1 covers documentation review (SSP, POA&M, system architecture). Days 2-3 involve systematic control testing -- demonstrating MFA, showing audit logs, verifying encryption, walking through incident response. Day 4 covers evidence sampling and personnel interviews. Day 5 is findings review and exit briefing. Certification is delivered 2 to 4 weeks later, valid for 3 years with annual affirmation.

DFARS 252.204-7012 requires that CUI be processed on systems meeting FedRAMP Moderate (or equivalent) security requirements. Both GCC and GCC High meet this threshold. GCC High is required only when CUI involves export-controlled information (ITAR, EAR, NOFORN). For standard construction program CUI, GCC is a legitimate and significantly cheaper compliance path.

### What Happens If You Don't Comply

- **You cannot bid on new CUI contracts.** CMMC certification is a go/no-go criterion. Without it, your proposal is non-responsive.
- **Existing contracts may be terminated for default.** Contracts with CMMC flow-down clauses include certification deadlines enforceable under FAR 52.249-8.
- **Primes prefer certified subcontractors.** Even before formal enforcement, primes are preferentially awarding work to certified subs to de-risk their own compliance.
- **DFARS liability for CUI spillage.** Storing CUI on non-authorized systems creates legal exposure under DFARS 252.204-7012, and the regulatory environment is tightening.

---

## 9. Appendix

### Glossary

| Term | Definition |
|------|-----------|
| **C3PAO** | CMMC Third-Party Assessor Organization. An accredited organization authorized to conduct CMMC Level 2 certification assessments. |
| **CDI** | Covered Defense Information. The subset of CUI that relates to defense contracts -- includes CUI markings on technical data, operational information, or export-controlled content provided by or generated for DoD. CDI triggers the full DFARS 252.204-7012 cyber incident reporting obligation. |
| **CMMC** | Cybersecurity Maturity Model Certification. The DoD's framework for assessing and certifying the cybersecurity posture of defense contractors. |
| **Conditional Access** | A Microsoft Entra ID (formerly Azure AD) policy engine that enforces access rules based on user identity, device health, location, and risk level. Used to implement CMMC access control requirements such as MFA enforcement and device compliance checks. |
| **CUI** | Controlled Unclassified Information. Government-created or -possessed information that requires safeguarding under NIST SP 800-171 but is not classified. |
| **DFARS** | Defense Federal Acquisition Regulation Supplement. Regulations supplementing the FAR for DoD acquisitions, including cybersecurity requirements. |
| **DLP** | Data Loss Prevention. Security policies and tools that prevent unauthorized sharing or leakage of sensitive information. |
| **EAR** | Export Administration Regulations. US Department of Commerce regulations controlling the export of dual-use goods, software, and technology with both commercial and military applications. CUI subject to EAR requires GCC High -- GCC is not sufficient. |
| **E&O** | Errors and Omissions insurance. Professional liability coverage for claims arising from negligent acts, errors, or omissions in professional services. Standard E&O policies typically exclude cyber incidents, requiring separate cyber liability coverage. |
| **Enclave** | A defined security boundary encompassing the people, processes, technology, and facilities that store, process, or transmit CUI. Your CMMC assessment scope is determined by your enclave boundary -- everything inside it must meet all applicable controls. For a solo contractor, the enclave typically includes your M365 tenant, the devices you use to access it, and any physical space where CUI is viewed or discussed. |
| **FAR** | Federal Acquisition Regulation. The primary body of rules governing US federal government procurement. FAR clauses (e.g., FAR 52.249-8 for contract default) are incorporated by reference into federal contracts and subcontracts. |
| **FCI** | Federal Contract Information. Information provided by or generated for the government under contract that is not intended for public release. |
| **FedRAMP** | Federal Risk and Authorization Management Program. The US government's standardized approach to security assessment and authorization for cloud services. |
| **FIPS** | Federal Information Processing Standards. NIST-issued standards for cryptographic modules used in federal systems. FIPS 140-2 validation is required for encryption implementations under CMMC Level 2 (control SI.L2-3.14.7). |
| **GCC** | Government Community Cloud. Microsoft's cloud environment for US government agencies and contractors, FedRAMP Moderate authorized, suitable for CUI without export controls. Available in G3 ($60/mo) and G5 ($52/mo) tiers. |
| **GCC High** | Government Community Cloud High. Microsoft's isolated government cloud with US-person-only staffed data centers, authorized for Impact Level 4/5 workloads including ITAR, EAR, and NOFORN data. There is no migration path from GCC to GCC High -- they are entirely separate environments requiring a full tenant rebuild. |
| **IL (Impact Level)** | A DoD data sensitivity classification for cloud hosting under the Cloud Computing Security Requirements Guide (CC SRG). IL4 covers CUI and non-critical mission data; IL5 covers higher-sensitivity CUI and mission-critical workloads. GCC High is authorized at IL4/5. |
| **ITAR** | International Traffic in Arms Regulations. US State Department regulations controlling the export of defense articles and services. CUI subject to ITAR requires GCC High -- GCC is not sufficient. |
| **M365** | Microsoft 365. Microsoft's cloud-based productivity and security platform including Exchange, SharePoint, Teams, and security tools. |
| **MFA** | Multi-Factor Authentication. A security method requiring two or more verification factors (password plus authenticator app, hardware token, or biometric) to access a system. Required for every login session under CMMC Level 2. |
| **NIST SP 800-171** | National Institute of Standards and Technology Special Publication 800-171. The security standard defining 110 controls for protecting CUI in non-federal systems. |
| **NOFORN** | Not Releasable to Foreign Nationals. A dissemination control marking restricting information to US citizens only. CUI carrying NOFORN markings requires GCC High due to its US-person-only data handling and staffing requirements. |
| **POA&M** | Plan of Action and Milestones. A formal document listing known security deficiencies, the planned remediation steps, required resources, and target completion dates. C3PAO assessors review the POA&M during certification to evaluate residual risk. |
| **Sentinel** | Microsoft Sentinel. A cloud-native SIEM platform built on Azure for security monitoring and incident response. |
| **SIEM** | Security Information and Event Management. Security tools that aggregate, correlate, and analyze security logs for threat detection. |
| **SPRS** | Supplier Performance Risk System. The DoD system where contractors submit their CMMC self-assessment scores. |
| **SSP** | System Security Plan. The master compliance document describing how each NIST SP 800-171 control is implemented in your environment, including system boundaries, data flows, and responsible personnel. The SSP is the first document a C3PAO assessor reviews. |
| **Tenant** | An organization's dedicated, isolated instance of a cloud platform (e.g., Microsoft 365). Each tenant has its own identity directory, licenses, data, and security configuration. Migrating between cloud tiers (e.g., GCC to GCC High) requires provisioning a new tenant and rebuilding the environment from scratch. |

---

*This document was prepared by Blue Heron Defense using pricing data current as of April 2026. Microsoft cloud pricing is subject to change; confirm current rates with your Microsoft licensing partner or authorized reseller before making purchasing decisions. This document does not constitute legal advice regarding DFARS 252.204-7012 compliance or CMMC certification requirements. Consult a qualified CMMC consultant and your contracting officer for guidance specific to your contracts.*

*Cost figures in this document are presented at two levels: (1) retail/list pricing from Microsoft public rate cards, which is the price small contractors will pay; and (2) volume/planning estimates from the CES-FE internal cost model, applicable to organizations with 50 or more users. Where a single figure is cited without qualification, it is the retail/list price.*
