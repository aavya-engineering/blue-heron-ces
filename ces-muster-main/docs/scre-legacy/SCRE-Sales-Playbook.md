# SCRE Sales Playbook

*BHD Supply-Chain Readiness Evaluator — prime-facing call playbook. Internal sales enablement. Working document.*

---

## How to Use This Document

This playbook has two parts. **Part 1 — The SCRE Value Foundation** is reference material the AE internalizes before any call: the value prop, ICP, pain-to-value map, and the differentiated points you must be able to defend cold. **Part 2 — The Sales Conversation Plan** is the staged script for a 25-30 minute discovery/intro call. **Part 3 — Field Reference** holds the MEDDIC qualification guide, discovery question bank, and competitive notes for use across the cycle. The email cadence lives in a separate file (`SCRE-Sales-Email-Sequences.md`) — reference it, but run outreach from there. **Pre-call checklist:** before you dial, fill *every* personalization token from the Cobalt Talon intel record — the prime's named programs, largest award value, sub-tier size, primary DoD customer, enforcement signal, and the contact's title and role tier. A talk track with a bare `{{token}}` in it is not ready to deliver.

---

## Part 1 — The SCRE Value Foundation

> **You can't lawfully award CUI work to a sub you can't prove is ready — SCRE scores your entire sub-tier against the 110 CMMC controls on any stack and hands you one defensible roll-up board, before November 2026.**

*Internal reference. Not a script. Internalize this before any call or send.*

### Token legend (fill from Cobalt Talon before any call)

| Token | What it is | Fallback when absent |
|---|---|---|
| `{{prime_name}}` | The prime / mid-tier integrator company | required — do not call without it |
| `{{contact_first_name}}` | Named decision-maker first name | required — do not call without it |
| `{{role}}` | The contact's title | drop role-specific framing |
| `{{program_at_risk}}` | A named program of record (e.g., "Block V") | "your DoD programs of record" |
| `{{largest_award_value}}` | Largest active award $ value | "your largest active award" |
| `{{sub_tier_size}}` | Number of CUI-touching subs | "your sub-tier" |
| `{{flow_down_prime}}` | Primary DoD customer / pressure source | "your primary DoD customer" |
| `{{enforcement_signal}}` | The "why now" enforcement observable | *(use fallback copy — see 2.3)* |
| `{{cert_gap_signal}}` | Sub-readiness gap observable | "sub-tier certification gaps common across the DIB" |

> **`{{enforcement_signal}}` fallback copy (use verbatim when event_watch = 0 or the signal is null):** "With the CMMC Final Rule Phase 2 deadline approaching, primes in your program space are already seeing C3PAO queues form — the window to establish a defensible posture record is narrowing."

---

### 1.2 Elevator Pitch (60 seconds / ~100 words)

"Under DFARS 7021, you're on the hook for your sub-tier's CUI posture — and **a low-single-digit percentage of the DIB is certified to date; industry figures consistently put it well under 5%.** The problem is most primes have no way to actually assess, track, or report on sub readiness — today it's a spreadsheet and hope. **What SCRE gives you is a managed assessment program:** a SPRS-style score per sub against the 110 controls and 320 objectives, on whatever stack each sub runs, rolled up into one board you can take into a program review. Then continuous assurance to keep that picture current for your FCA stay-current obligation. **Worth a 25-minute conversation?**"

---

### 1.3 ICP One-Pager

**Ideal Prime Profile.** Revenue band **$50M–$5B**. Lead NAICS: **332710 Machine Shops, 541715 R&D**; secondary: **541330 Engineering Services, 541512 Computer Systems Design**. Sub-tier of **10+ CUI-touching subs**. Program types: weapons systems, submarines, munitions, IDIQ with CUI task orders. Cobalt Talon **prime_score ≥ 55** with **sub_readiness_gap HIGH** and an **enforcement_signal present**.

**Disqualifiers.** Mega-prime (Lockheed / Boeing / Northrop / RTX — they self-remediate; scored ×0.55). MSP-of-record already handles all sub compliance with no gap signal. No CUI anywhere in the sub-tier. `channel_or_competitor` flag — route to the partner motion, not the buyer pipeline.

**Economic buyers inside the prime (one line each):**
- **CISO / ISSM** — owns defensibility and evidence integrity; fears a failed DIBCAC audit.
- **Supply Chain / Procurement VP** — owns the operational burden of managing dozens of subs; fears the manual process breaking down at scale.
- **Program Manager** — owns program eligibility; fears a sub failing audit and pausing the program.

**Cobalt Talon qualification signals:** prime_score ≥ 55, sub_readiness_gap HIGH, enforcement_signal present (DIBCAC / prime directive / FCA settlement), contract_timing near the CMMC Final Rule Phase 2 window, named decision-makers in hand.

> **Rep coaching note (compliance):** When pulling quick qualification facts from internal strategy docs, never state a bare "~0.5% certified" figure to a prospect. Always use the approved hedge — "a low-single-digit percentage of the DIB, well under 5%" (Guardrail 8) — and drop the number entirely if a buyer challenges it.

---

### 1.4 Pain → Value Map

| Prime Pain (their words) | SCRE Response |
|---|---|
| "I can't lawfully award CUI work to an uncertified sub — but I don't know which ones are certified." | **Tier 1 delivers a SPRS-style score per sub** against the 110 controls on any stack, **before award.** |
| "Every flow-down affirmation I sign carries FCA exposure if my sub-tier isn't actually compliant." | **Tier 3 continuous assurance plus cryptographically signed evidence** gives you a defensible record for every affirmation cycle. |
| "We track this with a spreadsheet. It won't survive an audit." | **Prime roll-up board:** RAG by sub, family-level gap heatmap, risk register weighted by contract dollar value. |
| "We have 40 subs and almost none are certified. November is close." | **Stack-agnostic assessment** — works on any environment, no GCC High required; Tier 1 earns on 100% of the tier regardless of conversion. |
| "Getting each sub to act is a full-time job." | **Your certification-outcome directive creates aligned motivation** — enrollment is voluntary, but subs understand what the requirement takes. BHD's per-cohort model and prime sponsorship collapse the acquisition friction; **BHD earns enrollment on merit, not coercion.** |

---

### 1.5 Top 5 Differentiated Value Points

*Recite these cold. Defend them under pushback.*

1. **Stack-agnostic assessment.** Works on any sub's current environment — commercial M365, GCC High, Google Assured, AWS GovCloud, on-prem. No GCC High prerequisite, no sub displacement before scoring.
2. **Earns on 100% of the sub-tier.** Tier 1 revenue does not depend on any single sub converting to an enclave. The value and the economics hold whether or not a sub moves to BHD infrastructure.
3. **Prime-facing roll-up board.** RAG status, family-level systemic gap heatmap, risk register weighted by contract dollar value. The PM can take it into a program review; the CISO can use it to support an FCA affirmation.
4. **FCA stay-current annuity.** Tier 3 continuous assurance is the only offer addressing the ongoing "must stay current" obligation, not just the November window. The relationship persists past certification.
5. **One enterprise sale, a cohort of qualified subs.** The prime's directive replaces individual SMB selling. BHD's acquisition cost per sub collapses — the 20th assessment costs a fraction of the 1st thanks to Stamper templating.

---

## Part 2 — The Sales Conversation Plan

*Staged script for a 25-30 minute discovery/intro call.*

### 2.0 Call Architecture Overview

Five stages on a 30-minute clock. Each is governed by a named framework. **Pre-call checklist:** fill every token from Cobalt Talon; know the prime's named programs; know the contact's title and role tier; know the enforcement signal (or load the fallback copy). Lead with the prime's risk in every stage — never open with a feature.

| Stage | Minutes | Framework |
|---|---|---|
| 1 · Open and Credibility | 0–3 | Signal-Led Personalization |
| 2 · Pain Discovery | 3–15 | Sandler Pain Funnel |
| 3 · Value Framing | 15–22 | Challenger: Teach–Tailor–Take Control |
| 4 · Objection Handling | 22–27 | (see matrix) |
| 5 · CTA and Next Step | 27–30 | — |

---

### 2.1 Stage 1 — Open and Establish Credibility (0–3 min)

*No product pitch in Stage 1. Establish context, prove this isn't a cold dial, earn permission. Two variants:*

**Warm intro (via Carahsoft / ValorForge):**
"{{contact_first_name}}, thanks for the time — [referral source] suggested I reach out. The reason they connected us: we work with primes on sub-tier CMMC readiness, and when we looked at {{prime_name}}, **{{program_at_risk}}** stood out as a place your sub-tier exposure is likely concentrated, especially with **{{flow_down_prime}}** flow-down in the mix. **I'd like to spend the next 20 minutes on your sub-tier posture ahead of November — does that work?**"

**Cold open:**
"{{contact_first_name}}, I'll be direct about why I called. **We were looking at {{prime_name}}'s programs of record and flagged {{program_at_risk}} as a place where your sub-tier exposure is likely concentrated** — that's a specific read, not a generic CMMC pitch. **I'd like to spend the next 20 minutes on your sub-tier posture ahead of November — does that work?**"

---

### 2.2 Stage 2 — Pain Discovery: Sandler Pain Funnel (3–15 min)

*Move surface → business impact → personal stakes → budget. Ask, then listen. Let them say the low number. Coaching notes are bracketed — they're for you, not to read aloud.*

1. **[Surface — Situation]** "How are you currently tracking which of your subs are certified?"
   *[Listen for: spreadsheet, emails, "we flow down the clause and assume." Disqualifier: a funded, working continuous program already in place — drop to nurture.]*

2. **[Problem]** "When you flow down DFARS 7021, what gives you confidence the affirmation is actually accurate?"
   *[Listen for: a pause, "honestly, not much." That pause is the pain. Disqualifier: a confident, evidenced answer with signed records.]*

3. **[Problem]** "How many of your subs would you guess are actually certified today?"
   *[Listen for: a low number, or "I don't know." Both open the door. Disqualifier: "most of them, and we verify it."]*

4. **[Implication]** "If a sub failed an audit and a program got paused, who owns that internally?"
   *[Listen for: "that's on me" or a named person — personal exposure surfaces here. Disqualifier: "it's purely the sub's problem" — needs reframing in Stage 3.]*

5. **[Implication]** "What does your program manager actually know about the sub-tier's posture right now?"
   *[Listen for: internal misalignment — security and program office aren't synced. Disqualifier: tight, current shared visibility.]*

6. **[Implication]** "Has a sub-tier gap ever surfaced late on a program — and what did that cost you to scramble?"
   *[Listen for: a war story. Pain they've already lived is your strongest lever. Disqualifier: "never happened, we've got it handled."]*

7. **[Need-Payoff]** "If you had a live readiness dashboard across your critical subs today, what would you do differently?"
   *[Listen for: them selling themselves on the value. Let the silence work. Disqualifier: "nothing — wouldn't change our decisions."]*

8. **[Budget awareness]** "What would it cost you if one program was paused at the wrong time?"
   *[Listen for: a number tied to {{largest_award_value}} — that's your ROI anchor. Disqualifier: "negligible."]*

9. **[Urgency / timeline]** "Have you set a deadline internally for having something in place before November?"
   *[Listen for: a date, or its absence — both are usable. Disqualifier: "we're waiting until after the rule settles."]*

---

### 2.3 Stage 3 — Value Framing: Challenger Reframe (15–22 min)

*Three beats. Use the approved safe formulation — do not sharpen it.*

**Teach (the commercial insight):**
"Here's what most primes don't realize: **flowing down DFARS 7021 and knowing your supply chain is compliant are legally distinct.** Per DoD and DoJ enforcement precedent, the clause isn't a shield — it's a representation. **Primes who flow down DFARS 7021 are making an ongoing representation about their supply chain's CUI posture, and that representation creates a documented industry risk under the False Claims Act** — not a guarantee of action, but a well-understood exposure. And today, **a low-single-digit percentage of the DIB is certified — industry figures consistently put it well under 5%.**" *[Pause — let that land.]*

> **Rep coaching note:** If the prospect asks whether *they* have specific legal exposure, defer: *"BHD is not a law firm; for legal exposure questions specific to your contracts, you'll want your general counsel involved. What I can speak to is what the posture record looks like."* Never assert that this prospect is non-compliant or will face FCA action.

**Tailor (connect to their data):**
"For {{prime_name}}, with **{{sub_tier_size}}** touching CUI on **{{program_at_risk}}**, and **{{largest_award_value}}** on the line — that's not an abstract risk. **{{enforcement_signal}}** tells us enforcement is already moving in your space."
> *If no enforcement signal is on file, use the fallback verbatim:* "With the CMMC Final Rule Phase 2 deadline approaching, primes in your program space are already seeing C3PAO queues form — the window to establish a defensible posture record is narrowing."

**Take Control (introduce SCRE, move to next step):**
"What we do is give the prime — you — a managed assessment program. **Tier 1:** a SPRS-style score per sub, any stack, with a roll-up board you can take into a program review. **Tier 2:** optional enclave conversion for the subs that aren't ready. **Tier 3:** continuous assurance for your FCA stay-current obligation. **What SCRE provides is the evidentiary record that supports a defensible affirmation** — a scored, documented picture of your sub-tier, updated continuously. That's different from the spreadsheet-and-hope approach most primes are running today. **The first step is a short scoping call where we show you what the pre-screen already shows about your sub-tier.**"

> **Rep coaching note:** If the prospect asks "what pre-screen?" or "what is Cobalt Talon?", use the scripted Cobalt Talon deflection in §2.4 (below the objection matrix) and pivot immediately back to their posture question. Do not elaborate on methodology.

---

### 2.4 Stage 4 — Objection Handling Matrix (22–27 min)

*Bold the line you actually deliver. Mapped from BHD-Supply-Chain-Readiness-Evaluator.md §9 plus standard enterprise objections.*

| Objection | Underlying Fear | Response Talk Track | Evidence / Proof Point |
|---|---|---|---|
| **1. "Our subs will push back on a prime-chosen vendor."** | Channel conflict, legal/fairness friction | "**Your prime directive specifies a certification outcome — that's your legitimate business requirement. How each sub meets that outcome is their choice.** BHD wins that evaluation on merit: stack-agnostic, priced per cohort, faster to evidence than a sub building its own program. **But we are one path, not the only path.** Enrollment in a BHD enclave is always voluntary and competitively priced." | Voluntary, competitively-priced enrollment; the prime requires an *outcome*, not a *vendor*. Documented sub choice. |
| **2. "We already have an MSP managing this."** | Disrupting an existing vendor relationship | "Then we don't rip and replace. **For subs your MSP already manages, we offer a 'verify and monitor' lane that works alongside them.** For any sub without a current readiness path, you can offer BHD as one competitively-priced option among others — the sub still chooses. **We partner, not displace.**" | Verify-and-monitor lane alongside the MSP; BHD offered on merit as one option among others for subs lacking a readiness path. |
| **3. "This is a sub problem, not ours."** | Scope and budget ownership | "I hear that a lot — and it's exactly the gap. **Per DoD/DoJ enforcement precedent, DFARS 7021 makes your uncertified sub-tier *your* documented FCA exposure, because you affirm its posture.** The spreadsheet isn't a defense. SCRE turns that into a defensible record." | Flow-down = ongoing representation; the prime carries the affirmation risk. |
| **4. "We'll wait until after November."** | Premature spend | "**Per the CMMC Final Rule, Phase 2 requirements take effect for new solicitations on or around November 2026 — that's the window driving C3PAO queue formation now.** A Tier 1 assessment across a cohort takes time to run. Waiting leaves you with no posture record at enforcement. **{{enforcement_signal}}** tells us pressure is already moving." | C3PAO queues forming now; cohort assessment has lead time. *(Use fallback copy if no signal.)* |
| **5. "We don't have budget for this."** | Discretionary spend / wrong budget owner | "Frame it as risk mitigation, not IT spend. **Here's how we price: initial certification runs $25K–$100K per sub depending on environment complexity; the Tier 1 assessment fee is priced per cohort and sized during scoping.** A prime seeding a 20-sub cohort is typically looking at $500K–$2M for initial assessments, plus $500K–$3.6M+ annualized for continuous assurance. **At $25K per sub, assessing your 20 highest-risk subs is less than 1% of a $50M award.** The exact number depends on your cohort size and stack complexity — **that's exactly what the scoping call produces.**" Redirect to the PM and CISO, not just procurement. | Pricing bands from §6; anchor fee vs. {{largest_award_value}}; defer the exact quote to scoping. |
| **6. "We do this internally — spreadsheet and emails."** | Admitting (or not seeing) the gap | "That's where most primes are. **But a spreadsheet can't produce a SPRS-style score, a cryptographically signed evidence trail, or a roll-up board you can defend in a DoD program review.** That's the difference between tracking and evidencing." | SPRS-style score, signed evidence, prime-facing board. |
| **7. "We already flow down the clause — that's enough."** | Legal liability misunderstood | "**Flowing down a clause and evidencing compliance are legally distinct under the FCA.** The clause is a representation, not proof. SCRE closes the evidentiary gap with a documented, defensible posture record — the kind that matters if your affirmations are ever scrutinized." | Clause ≠ evidence; SCRE supplies the affirmation-supporting record. |

> **If asked "what is Cobalt Talon?":** *"Cobalt Talon is our market-intelligence research function — it's how we come into conversations already familiar with your programs and sub-tier landscape."* Then pivot straight back to their posture question. Do not elaborate or describe methodology.

---

### 2.5 Stage 5 — CTA and Next Step (27–30 min)

*The standard ask is a 25-30 minute intro meeting. Both variants end with a specific calendar action — never "I'll follow up."*

**Variant A — Warm / engaged buyer:**
"Here's what I'd suggest. **Let's put 25 minutes on the calendar for a scoping intro, and I'll bring the sub-tier pre-screen results — so you're looking at your own supply chain picture before we even meet.** I'll send an invite for [day/time]; does that hold for you?"
> *Upgrade only if the buyer asks for more time or more stakeholders:* "If you want to pull in your security lead, **we can go to 45 minutes and go deeper on the sub-tier mechanics.**" Do not lead with 45 minutes unprompted.

**Variant B — Hesitant / needs internal buy-in:**
"No pressure to commit today. **Let me send you a one-page risk summary built around {{program_at_risk}} — low friction, nothing to sign — so you've got something concrete to take to your PM and CISO.** I'll follow up [specific date] to see if a 25-minute conversation makes sense then. I'll get that summary to you by end of week — what's the best address?"

---

## Part 3 — Sales-Team Field Reference

### 3.1 MEDDIC Qualifying Questions

*Governs call prep and pipeline hygiene — not the live script. Ask these across the cycle, not all in one call. Each has a coaching note: qualified vs. disqualifying.*

**Metrics**
1. "What's the total contract value riding on the programs your CUI-touching subs support?" *[Qualified: a large, named figure tied to {{largest_award_value}}. Disqualifying: trivial or unknown dollar exposure.]*
2. "If one program paused because a sub failed audit, what does that cost you per month?" *[Qualified: a quantified, painful number. Disqualifying: "wouldn't matter much."]*
3. "How does the cost of an assessment compare to what an FCA settlement or a paused program would run you?" *[Qualified: they engage with the asymmetry. Disqualifying: they refuse to frame it as risk.]*

**Economic Buyer**
4. "Who owns the flow-down affirmation when it's signed — security, procurement, or the program office?" *[Qualified: a clear named owner. Disqualifying: nobody owns it.]*
5. "Who signs off on standing up an external assessment program like this?" *[Qualified: names an authority with budget. Disqualifying: "no one's thought about it."]*
6. "Is the person feeling this pain the same person who can fund the fix?" *[Qualified: yes, or a clear path between them. Disqualifying: pain and budget sit in disconnected silos.]*

**Decision Criteria**
7. "What does your security team need to see before they'd trust an external readiness score?" *[Qualified: specific, satisfiable criteria. Disqualifying: a moving or impossible bar.]*
8. "Does it matter to you whether the assessment works across any stack, or are your subs standardized?" *[Qualified: values stack-agnostic — our strength. Disqualifying: locked to a stack we'd have to displace first.]*

**Decision Process**
9. "How have you procured compliance or security services before — what vehicle and what steps?" *[Qualified: a known, navigable path (Carahsoft, GSA, direct). Disqualifying: no precedent and no appetite to build one.]*
10. "What has to happen internally, and by when, to have something in place before November?" *[Qualified: a real timeline with steps. Disqualifying: "we'll figure it out later."]*

**Identify Pain**
11. *Cross-reference the Sandler funnel in Stage 2 — do not re-run those questions here. Confirm the pain surfaced there is owned, quantified, and time-bound.* *[Qualified: pain is named, dollarized, and dated. Disqualifying: pain is acknowledged but not owned.]*

**Champion**
12. "Who in your org is most exposed if a sub fails an audit?" *[Qualified: a motivated individual with internal pull. Disqualifying: diffuse, ownerless risk.]*
13. "Who benefits most from having a live readiness dashboard in front of the program office?" *[Qualified: a person who'd carry this internally. Disqualifying: nobody wants it.]*
14. "If we built a business case, who would walk it into the room — and would they?" *[Qualified: a willing champion. Disqualifying: no one will advocate.]*

---

### 3.2 Discovery Question Bank

*Full bank for use beyond the scripted call. One line each, by topic. No talk tracks — just the questions.*

**Sub-tier composition**
1. How many subs in your tier touch CUI?
2. What NAICS / business types dominate your critical sub-tier?
3. What's the CUI scope — which subs actually handle controlled data vs. just FCI?
4. How geographically spread is your sub base?
5. Which subs are single-source or hardest to replace?

**Current state and tooling**
6. How do you track sub compliance status today?
7. What reports on sub readiness do you send to the program office, and how often?
8. Who maintains that tracking, and how much of their time does it take?
9. Have you ever had to produce sub-tier posture evidence on demand?

**Program-specific risk**
10. Which programs carry the heaviest CUI flow-down?
11. What program milestones are readiness measured against?
12. Which subs sit on your highest-value awards?
13. Is any program already gated on a sub's certification status?

**Enforcement history and pressure signals**
14. Have you had any DIBCAC interaction — yours or a sub's?
15. Has your prime customer issued a directive on sub certification timing?
16. Any FCA or cyber-compliance enforcement history in your space you're watching?
17. What's driving urgency internally right now — a date, an audit, a customer ask?

**Internal ownership and political dynamics**
18. Who cares most about this internally — and who's resistant?
19. Has anyone here been burned by a sub-tier surprise before?
20. Are security and the program office aligned on sub readiness, or not yet?
21. Who would own this program if it got funded?

**Budget and procurement vehicle**
22. How do you typically buy services like this — direct, GSA, Carahsoft, other vehicle?
23. Is there a fiscal-year timing window that helps or hurts?
24. What budget line would this come out of — security, program, or supply chain?
25. What's your appetite for a paid pilot vs. a full cohort engagement?

---

### 3.3 Competitive and Positioning Notes

When the prime asks "why not use [incumbent GRC vendor]?", **don't name or trash competitors.** Frame the category instead: **"Most assessments are designed for the *sub*, not the *prime*."** Land four differentiators:

- **Stack-agnostic, not tool-specific.** Many tools assume a particular environment or require the sub to migrate first. **SCRE scores any stack as-is** — commercial M365, GCC High, Google Assured, AWS GovCloud, on-prem.
- **Prime-facing roll-up, not sub-facing only.** Most tooling reports to the sub. **SCRE gives *you* the roll-up board** — RAG by sub, family heatmap, risk register weighted by contract dollars — built for a program review.
- **Continuous assurance, not point-in-time.** A one-time scan doesn't survive the FCA stay-current obligation. **Tier 3 keeps the picture live.**
- **Cohort economics, not per-sub pricing.** Per-sub tools don't scale across a tier. **One managed program, priced per cohort,** collapses your acquisition and management overhead — the 20th assessment costs a fraction of the 1st.

Close the positioning on the buyer's frame: *"The question isn't which tool scores a single sub best — it's who hands the prime a defensible picture of the whole tier. That's the gap SCRE was built for."*

---

*BHD is not a law firm. Nothing in this playbook is legal advice. Where a prospect raises specific legal exposure, defer to their general counsel and speak only to the posture record.*
