# Supply-Chain Readiness Evaluator (SCRE)

**A BHD program concept — sell the prime once, certify the whole sub-tier.**
**Date:** June 10, 2026 · **Classification:** Internal — strategy
**Companion to:** `BHD-Operating-Model.md`, `BHD-GTM-Strategy.md`, `BHD-Assess-Subs-Capability.md`, `BHD-Assess-Subs-Build-Spec.md`
**Origin:** the "assess a sub for readiness and report back to a prime" opportunity raised by Brian Ball (Marion Square / Carahsoft) on the June 10, 2026 call — productized.

> **Reconciliation note (read first).** Tier 1 below — the readiness assessment — is a **standalone product**, not just an enclave wedge. It measures each sub's CMMC L2 posture (a SPRS-style score against the 110 controls / 320 objectives) using **CES Planner**, on whatever stack the sub runs today, with **no requirement** that any sub move to GCC High or a BHD enclave. It earns on 100% of the prime's sub-tier. Enclave conversion (Tier 2) is *optional upside* on the subset that chooses it. Full design in `BHD-Assess-Subs-Capability.md`; build-level detail in `BHD-Assess-Subs-Build-Spec.md`.

---

## 1. The idea in one paragraph

Instead of selling CMMC enclaves to 80,000 small contractors one logo at a time, BHD sells a single managed program to the **prime** (or large mid-tier integrator) that sits on top of them. The prime carries the liability and the leverage: it loses its program if its supply chain can't certify, and it carries False Claims Act exposure on every requirement it flows down. SCRE gives the prime a turnkey way to **assess, monitor, and *report on*** the CMMC readiness of its critical subcontractors — measured against the 110 controls via CES Planner, on whatever stack each sub runs today. The assessment stands on its own (it does not require any sub to be on GCC High or a BHD enclave); subs that turn out not-ready can *optionally* convert to a BHD turnkey enclave — turning the same enterprise relationship into a distribution channel for recurring per-user enclaves as well. It is land-and-expand run **sideways across a supply chain** rather than upward within one account.

---

## 2. Why this works — the structural forces SCRE exploits

1. **The prime has the pain and the power.** Under DFARS 252.204-7012/7021, primes must flow CMMC requirements down to subs and cannot lawfully award CUI-bearing work to an uncertified sub. An uncertified sub-tier is a direct threat to the prime's program eligibility and a source of FCA risk (the prime affirms its supply chain's posture). The prime is *motivated to act* in a way individual small subs often aren't until it's too late.
2. **Primes have no tool for this.** They can flow down a clause, but they have no mechanism to actually *get* their subs certified, verify it, or monitor it continuously. Today this is a spreadsheet, a few emails, and hope. SCRE is the missing managed layer.
3. **It collapses CAC.** The hardest, most expensive part of this market is reaching and convincing thousands of small, non-technical, fearful buyers. SCRE lets the prime's mandate do the selling — enrollment is sponsored, encouraged, or required by the prime. BHD acquires a cohort per enterprise sale.
4. **It compounds the moat.** Every sub enrolled is a tenant-deep, locked-in enclave. A prime's whole critical tier on BHD enclaves is a supply chain that is very hard for a competitor to dislodge — and a roll-up dataset that makes BHD's readiness reporting more valuable to the prime over time.
5. **It is defensible against the cliff.** The FCA "must stay current" obligation means the prime needs *continuous* assurance, not a one-time pass — so the reporting relationship and the per-sub enclaves persist past November 2026 into the renewal/maintenance world.

---

## 3. Who the program is sold to (the SCRE buyer)

The buyer is **not** the small sub. It is the entity with supply-chain liability and the authority to mobilize a tier:

- **Large primes** flowing CUI down to dozens/hundreds of subs (the headline target).
- **Mid-tier integrators** that are themselves subs to a prime but prime their own lower tier.
- **Program offices / OEMs** worried about a specific weapons-system supply chain's readiness.
- **Cobalt Talon already profiles candidate anchors** — e.g., Sigma Defense, Spry Methods and similar mid/large DIB firms with real sub-tiers — and the machine-shop buyer cohorts (332710) are exactly the kind of subs that hang beneath aerospace/submarine primes. SCRE connects the two halves of the existing target intelligence: anchor primes on top, scored sub cohorts beneath.

**Economic buyer inside the prime:** typically the CISO/ISSM, the Supply Chain / Procurement VP, and the Program Manager whose program eligibility is at risk. Sell to the program-risk owner; the security org validates.

---

## 4. The offer — what the prime actually buys

A managed, tiered program rather than a product:

**Tier 1 — Supply-Chain Readiness Assessment (standalone product).**
BHD measures each nominated sub's CMMC L2 posture — a **SPRS-style score against the 110 controls / 320 objectives**, plus a gap/POA&M list — using **CES Planner** (browser-based, pre-tenant, so it works on any sub's stack), and delivers a **roll-up board + risk register** to the prime (RAG by sub, family-level systemic gaps, days-to-ready vs. program milestones). This is the "assess a sub, report to the prime" service Brian Ball described — productized and repeatable. **It is not merely a wedge:** it stands on its own value and revenue across 100% of the sub-tier whether or not any sub becomes a BHD customer. As a byproduct, the not-ready tiles become a pre-qualified, prime-endorsed enrollment list. Method, assurance ladder, and automation in `BHD-Assess-Subs-Capability.md`; data model and roll-up spec in `BHD-Assess-Subs-Build-Spec.md`.

**Tier 2 — Sponsored Enclave Enrollment (optional expansion).**
Subs flagged not-ready *may* convert to BHD turnkey enclaves — compliant day one, continuously evidenced — but enrollment is optional and never a precondition for Tier 1's value. The prime can sponsor, subsidize, mandate, or simply endorse it. Each converting sub becomes a per-user recurring enclave (and upgrades to the "Evidenced" assurance rung). This is where the 1→N enclave economics fire.

**Tier 3 — Continuous Supply-Chain Assurance (the annuity).**
Ongoing roll-up reporting to the prime: live readiness status across the enrolled tier, drift alerts, evidence freshness, and re-assessment tracking against the triennial cycle — backed by EvidenceOps' cryptographically signed records. This is what the prime needs to keep affirming "current" status under FCA, indefinitely.

**Optional Tier 4 — Cortex AI overlay.** Supply-chain risk analytics, automated sub onboarding, and prime-facing reporting automation via Cortex Partners.

---

## 5. How it runs — the workflow

1. **Anchor identification.** Cobalt Talon (+ Carahsoft / Marion Square relationships) surfaces primes whose sub-tiers are CUI-heavy and under-certified. Warm-intro via Carahsoft partner team where possible.
2. **Prime enrollment.** Sell Tier 1 to the prime's program-risk + security owners. Scope the sub-tier (which programs, which subs, CUI mapping).
3. **Cohort assessment.** Planner-driven readiness scoring across the nominated subs; deliver the roll-up dashboard and per-sub gap reports to the prime.
4. **Routing & enrollment.** Not-ready subs are offered turnkey enclaves; the prime's endorsement/sponsorship drives conversion. Already-mature subs get a lighter "verify & monitor" path.
5. **Provisioning at cohort scale.** Stamper deploys templated enclaves; templating is what makes cohort delivery margin-positive (see §6).
6. **Continuous assurance.** AdminOps holds posture; EvidenceOps streams signed evidence; the prime sees live roll-up status and gets assessment-ready packages per sub.
7. **Roll-up reporting & renewal.** Quarterly prime briefings; expansion to the next program/tier; triennial re-assessment locks the multi-year engagement.

---

## 6. Economics (illustrative, from internal CES analysis)

Per-sub revenue (consistent with the CES business model):
- Initial certification: **$25K–$100K** per sub.
- Ongoing compliance: **$2K–$15K / tenant / month** (managed tier dependent).
- Triennial re-assessment: **$10K–$30K** per sub.
- Underlying per-user economics: ~**$148–$263 / user / month** all-in (GCC High G5 ~$93 + CES platform + managed service), i.e. ~$1,776–$3,156 / user / year.

Program-level revenue (the point of SCRE):
- A prime enrolling **20 subs** seeds roughly **$0.5M–$2M** in initial-certification revenue and **$0.5M–$3.6M+ ARR** in ongoing fees — from *one* enterprise relationship.
- Add the Tier 1 assessment fee (sized per cohort) and Tier 3 assurance retainer (prime-facing reporting) on top.

Why the margin holds at cohort scale (this is the strategic point):
- CES platform cost is largely **fixed per tenant**, not per user, and Stamper's deterministic templating means the **20th enclave costs a fraction of the 1st**. SCRE turns BHD's determinism into operating leverage — the cohort model is where unit economics improve fastest.
- CAC per sub collapses because the prime's mandate replaces individual SMB selling.

---

## 7. Ecosystem & channel roles

- **BHD** — platform + delivery: assessment, enclave provisioning, continuous assurance, prime reporting.
- **ValorForge (SDVOSB)** — federal GTM, prime relationships, reseller/contract vehicle access, program-management wrapper for the prime engagement.
- **Cortex Partners (SDVOSB)** — AI overlay for supply-chain risk analytics and reporting automation (Tier 4).
- **Carahsoft** — channel reach into primes, co-marketing, and the contract vehicles to be bought through; presence on Carahsoft's **CMMC Sales Desk** (Alex Whitworth's program) as the credibility surface.
- **Marion Square** — market-fit framing and warm prime/Carahsoft introductions; the original source of the concept.

---

## 8. Positioning & message to the prime

- **To the program owner:** "Your award eligibility depends on a sub-tier that is ~0.5% certified. We make your critical suppliers certified and keep them that way — and give you a live readiness picture you can stand behind."
- **To the CISO/ISSM:** "Continuous, cryptographically signed evidence across your enrolled suppliers — not a spreadsheet of self-attestations you have to trust."
- **To procurement:** "One managed program instead of chasing dozens of small vendors. Sponsored or self-pay enrollment; predictable per-user economics."
- **The FCA frame (used carefully):** flowing down a clause is not the same as knowing your supply chain is compliant; SCRE closes that gap with evidence, reducing the prime's successor/affirmation risk.

---

## 9. Risks & how to handle them

| Risk | Mitigation |
|---|---|
| Prime won't mandate enrollment (only endorses) | Offer sponsored, subsidized, and self-pay enrollment tiers; even endorsement + warm handoff beats cold SMB outreach. Lead with the paid assessment so value lands regardless. |
| Subs resist a prime-chosen vendor | Position enclave as the *fast, cheap, certain* path; preserve sub choice while making BHD the default. Avoid any appearance of coercion that creates channel-conflict or legal friction. |
| Channel conflict with the prime's existing MSP | Offer a "verify & monitor" lane for subs already with an MSP; capture the not-ready majority; partner rather than rip-and-replace where sensible. |
| Antitrust / fairness optics of a prime steering subs | Keep enrollment voluntary and competitively priced; document sub choice; let the prime *require a certification outcome*, not a specific vendor, while BHD wins on merit. |
| Cohort delivery overwhelms capacity | Templating + Stamper determinism + staged onboarding waves; size Tier 1 cohorts to delivery throughput. |
| Data sensitivity of roll-up reporting | Roll-up shows readiness status, not the subs' CUI; contractual data-handling and least-privilege reporting. |

---

## 10. Pilot plan (next 90 days)

1. **Pick one anchor prime** from Cobalt Talon with a CUI-heavy, under-certified machine-shop / precision-manufacturing sub-tier (ties to the 332710 beachhead).
2. **Use the warm path** — Marion Square / Carahsoft partner team — to reach the program-risk owner.
3. **Sell a paid Tier 1 assessment** of 10–25 nominated subs; deliver the roll-up dashboard + risk register.
4. **Convert 3–5 not-ready subs** into sponsored/endorsed enclaves as the proof cohort.
5. **Instrument the case study** — time-to-ready, pass outcomes, prime-facing reporting — as the reference asset to sell the next prime.
6. **Codify the playbook** (scoping template, pricing grid, reporting format, onboarding-wave model) so SCRE is repeatable prime-to-prime.

---

## 11. Why SCRE is the highest-leverage motion BHD has

It is the only motion that turns a fragmented, high-CAC, 80,000-account SMB market into a small number of enterprise distribution deals — each of which seeds a cohort of tenant-deep, locked-in, recurring enclaves and a continuous prime-facing assurance relationship that outlives the deadline. It uses the regulator's own flow-down mechanism as BHD's sales force, converts BHD's deterministic templating into cohort-scale margin, and stitches together the two halves of work BHD has already done: Cobalt Talon's anchor-prime and sub-cohort intelligence, and the Carahsoft/Marion Square channel. One sale, many enclaves, a forever reporting relationship.
