# SCRE Sales Email Sequences

*BHD Supply-Chain Readiness Evaluator — prime-facing cold outreach. Internal sales enablement. Working document. Companion to `SCRE-Sales-Playbook.md`.*

---

## How to Use This Document

Fill **every** personalization token from the Cobalt Talon intel record before you send — a touch with a bare `{{token}}` in it does not go out, and neither does one that doesn't reference a real, named signal. Respect the cadence: **do not send two touches to the same person in the same week.** The role-specific variants in Sequence 2 are *additive* — they replace only the opening paragraph of Touches 1–3, not the whole touch or the master sequence. The Subject Line Archive at the end consolidates every line for A/B tracking. Keep bodies short and mobile-skimmable: one idea, one CTA, ~50–125 words.

---

## Token Reference Card

*Fill from Cobalt Talon before any send. Same tokens, same fallbacks as the Playbook — do not re-derive.*

| Token | What it maps to | Fallback when absent |
|---|---|---|
| `{{prime_name}}` | The prime / mid-tier integrator company | **required** — do not send without it |
| `{{contact_first_name}}` | Named decision-maker first name | **required** — do not send without it |
| `{{role}}` | The contact's title | use master sequence, no role variant |
| `{{program_at_risk}}` | A named program of record (e.g., "Block V") | "your DoD programs of record" |
| `{{largest_award_value}}` | Largest active award $ value | "your largest active award" |
| `{{sub_tier_size}}` | Number of CUI-touching subs | "your sub-tier" |
| `{{flow_down_prime}}` | Primary DoD customer / pressure source | "your primary DoD customer" |
| `{{enforcement_signal}}` | The "why now" enforcement observable | *(use fallback copy below — see note)* |
| `{{cert_gap_signal}}` | Sub-readiness gap observable | "sub-tier certification gaps common across the DIB" |
| `{{hiring_signal}}` | Open security/compliance reqs (talent_iq) | use Touch 4 fallback body |
| `{{named_contact_title}}` | Role tier from intel | omit role-specific opener; use generic peer opener |
| `{{cobalt_talon_why_now}}` | Per-factor "Why now" narrative | use `{{enforcement_signal}}` fallback copy |

> **`{{enforcement_signal}}` fallback copy (use verbatim when event_watch = 0 or the signal is null):** "With the CMMC Final Rule Phase 2 deadline approaching, primes in your program space are already seeing C3PAO queues form — the window to establish a defensible posture record is narrowing."

---

## Sequence 1 — Multi-Touch Cold Cadence (Scored Prime Prospect)

*Master sequence to a scored prime (prime_score ≥ 55, sub_readiness_gap HIGH, enforcement_signal present, named decision-maker in hand). Five touches over ~3 weeks: **Day 1 / Day 4 / Day 8 / Day 14 / Day 21.** Each touch leans on a **different** Cobalt Talon signal so the sequence doesn't read as a drip blast. CTA on every touch = book a ~25-minute intro meeting.*

> **Global rule — replace every token with the specific underlying observable, not a generic slot (applies to all touches and all sequences):** A token left vague reads as a CRM blast to a federal buyer and must not be sent. Swap each token for the named fact behind it before sending — `{{program_at_risk}}` → the actual named program (e.g., "your Block V award"), `{{enforcement_signal}}` → the actual DIBCAC flag / named flow-down prime / FCA settlement, `{{largest_award_value}}` → the real award and dollar figure. Pull the specific observable from the per-factor "Why Now" narrative in Cobalt Talon, not just the program-name field. If you can't state a real observable, the signal isn't credible and the touch doesn't go out.

---

### Touch 1 — Day 1: The Risk Signal (Cold Open)

**Purpose / timing:** Day 1 opener. Prove this isn't a generic CMMC blast by leading with a named program. One idea: the prime's specific sub-tier exposure under DFARS 7021. **Signal leaned on:** programs of record + `{{cert_gap_signal}}` (sub_readiness_gap).

**Subject line:**
- **A (risk-frame):** `{{program_at_risk}}: your sub-tier exposure under DFARS 7021`
- **B (question-frame):** `{{prime_name}} — how many of your subs can actually certify?`
- **C (signal-frame):** `Flagged {{program_at_risk}} in your sub-tier`

**Body (≈110 words):**

{{contact_first_name}} —

We were looking at {{prime_name}}'s programs of record and flagged **{{program_at_risk}}** as a place your sub-tier exposure is likely concentrated. That's a specific read, not a generic CMMC pitch.

Here's the structural problem: under DFARS 7021 you can't lawfully award CUI work to a sub you can't prove is ready — and {{cert_gap_signal}} suggests a real readiness gap underneath {{program_at_risk}}. Most primes track this with a spreadsheet and hope.

SCRE scores your whole sub-tier against the 110 CMMC controls — on whatever stack each sub runs — and hands you one defensible roll-up board.

Worth a 25-minute call?

{{contact_first_name}}, [rep name]

---

### Touch 2 — Day 4: The FCA Frame

**Purpose / timing:** Day 4. Deliberately a *different* angle than Touch 1 so the sequence doesn't repeat. Teach the FCA "stay-current" distinction and quantify with award value. **Signal leaned on:** `{{largest_award_value}}` (contract_recon).

**Subject line:**
- **A (FCA-frame):** `Flowing down the clause isn't the same as evidencing it`
- **B (value-frame):** `{{largest_award_value}} riding on an unproven sub-tier`

**Body (≈115 words):**

{{contact_first_name}} —

Following up with the part most primes miss: **flowing down DFARS 7021 and knowing your supply chain is compliant are legally distinct.** Per DoD and DoJ enforcement precedent, the clause is a representation, not a shield — primes who affirm their sub-tier's CUI posture carry a well-documented industry risk under the False Claims Act. Not a guarantee of action, but a real, understood exposure.

A spreadsheet of self-attestations isn't a defensible record if those affirmations are ever scrutinized — and with {{largest_award_value}} riding on it, that's not abstract.

SCRE's Tier 3 gives you continuous, cryptographically signed evidence — the record that supports a defensible affirmation, every cycle.

Worth 25 minutes?

[rep name]

> **Rep note (not in the email):** If a reply asks whether *they* have specific legal exposure, defer — "BHD is not a law firm; for legal exposure questions specific to your contracts, you'll want your general counsel. What I can speak to is the posture record." Never assert this prospect is non-compliant or will face FCA action.

---

### Touch 3 — Day 8: The Urgency Signal

**Purpose / timing:** Day 8. Deadline + roll-up value. Attribute the date correctly and frame it as a phased effective date, not a universal cliff. **Signal leaned on:** `{{enforcement_signal}}` (event_watch / pressure_index) + contract_timing.

**Subject line:**
- **A (urgency-frame):** `C3PAO queues are forming now — before they close`
- **B (deadline-frame):** `Per the CMMC Final Rule: the November 2026 window`

**Body (≈115 words):**

{{contact_first_name}} —

A timing note worth getting ahead of. **Per the CMMC Final Rule, Phase 2 requirements take effect for new DoD solicitations on or around November 2026** — that's the window already driving C3PAO queue formation, not a cliff on every existing contract.

**{{enforcement_signal}}** tells us pressure is already moving in your space.

Here's the math that bites primes: a Tier 1 readiness assessment across a cohort takes time to run. If you wait for the deadline to act, you arrive at enforcement with no posture record — and a queue that's already full.

SCRE gives you a scored roll-up of your sub-tier now, while there's runway.

Open to 25 minutes this week or next?

[rep name]

> **If no enforcement signal is on file,** replace the `{{enforcement_signal}}` sentence with the fallback verbatim: "With the CMMC Final Rule Phase 2 deadline approaching, primes in your program space are already seeing C3PAO queues form — the window to establish a defensible posture record is narrowing."

---

### Touch 4 — Day 14: The Operational Angle

**Purpose / timing:** Day 14. Social-proof / risk reframed as operational relief — meet them where their team already is. **Signal leaned on:** `{{hiring_signal}}` (talent_iq); falls back to `{{sub_tier_size}}` scale framing.

**Subject line:**
- **A (operational-frame):** `One dashboard instead of chasing {{sub_tier_size}}`
- **B (build-frame):** `Saw {{prime_name}} is building out compliance capacity`

**Body — with hiring signal (≈105 words):**

{{contact_first_name}} —

We noticed {{prime_name}} is building out compliance capacity — which tells me sub-tier readiness is already on someone's desk there.

SCRE isn't a replacement for that team; it's the thing that lets a new hire stand up faster. Instead of rebuilding sub-tracking from scratch, they inherit a prime-facing roll-up board on day one: RAG by sub, family-level gap heatmap, a risk register weighted by contract dollars.

The work your people are scoping by hand, we deliver as a managed program — across any stack, no sub displacement required.

Worth 25 minutes to see the board?

[rep name]

**Body — fallback, no hiring signal (≈95 words):**

{{contact_first_name}} —

Practical angle this time. Right now your procurement and program teams are managing sub readiness across {{sub_tier_size}} by hand — spreadsheets, status emails, follow-ups.

SCRE collapses that into one dashboard: RAG by sub, family-level gap heatmap, a risk register weighted by contract dollars, days-to-ready against your milestones. One managed program instead of chasing dozens of vendors individually.

It runs on whatever stack each sub is on today — nothing to migrate first.

Worth 25 minutes to see what the roll-up looks like for {{prime_name}}?

[rep name]

---

### Touch 5 — Day 21: The Low-Friction Break-Up

**Purpose / timing:** Day 21. Respectful close — step back, leave the door open, lower the ask to a no-cost artifact. **Signal leaned on:** the Cobalt Talon pre-screen itself (offered as a snapshot, not named as surveillance).

**Subject line:**
- **A (break-up):** `Closing the loop on {{prime_name}}`
- **B (break-up / value):** `Before I step back — your sub-tier snapshot`

**Body (≈90 words):**

{{contact_first_name}} —

I'll step back after this — but before I do, I want to make sure you've seen what our pre-screen already shows for {{prime_name}}'s sub-tier.

It's a one-page supply-chain readiness snapshot built around {{program_at_risk}}: where the certification gaps likely sit, weighted by program risk. No cost, nothing to sign.

If it's useful, just reply "yes" and I'll send the snapshot plus a calendar link — 25 minutes, whenever it fits.

If the timing's wrong, no hard feelings; I'll assume it's not a priority right now.

Either way, thanks for the read.

[rep name]

---

## Sequence 2 — Role-Specific Variants

*Applies to **Touches 1–3** of the master sequence. Each variant rewrites **only the opening paragraph** (the first 2–3 sentences) for the role. The rest of the touch body, the CTA, and the subject options are unchanged from Sequence 1. Use a variant only when `{{role}}` is known; otherwise run the master opener.*

---

### Variant A — CISO / ISSM

*Emphasis: evidence over self-attestation, signed records, SPRS-style methodology, DIBCAC defensibility. **No procurement or dollar framing in the opener** — this reader cares about defensibility and evidence integrity, not contract value.*

**Touch 1 opener (replaces master Touch 1 paragraph 1–2):**

{{contact_first_name}} —

When we looked at {{prime_name}}, {{program_at_risk}} stood out as a place your sub-tier evidence is thinnest. The hard question for an ISSM isn't whether you flowed down DFARS 7021 — it's whether you could produce a defensible posture record for that tier on demand. {{cert_gap_signal}} suggests today the answer is a spreadsheet of self-attestations you have to trust.

*(Continue with master Touch 1 from "SCRE scores your whole sub-tier…")*

**Touch 2 opener (replaces master Touch 2 paragraph 1):**

{{contact_first_name}} —

The distinction that matters to your role: flowing down the clause and *evidencing* compliance are legally distinct. Per DoD and DoJ enforcement precedent, a self-attestation you can't substantiate is the weak point if your affirmations are ever scrutinized. SCRE gives you a SPRS-style score per sub plus cryptographically signed evidence — the record, not the assumption.

*(Continue with master Touch 2 from "A spreadsheet of self-attestations…", adapting smoothly.)*

**Touch 3 opener (replaces master Touch 3 paragraph 1–2):**

{{contact_first_name}} —

Per the CMMC Final Rule, Phase 2 requirements take effect for new DoD solicitations on or around November 2026 — and a failed DIBCAC look at your sub-tier is the scenario you'd own. {{enforcement_signal}} tells us pressure is already moving. The gap-and-POA&M output from a Tier 1 assessment is exactly what makes that defensible.

*(Continue with master Touch 3 from "Here's the math that bites primes…")*

---

### Variant B — Supply Chain / Procurement VP

*Emphasis: one managed program vs. chasing dozens of small vendors, predictable per-cohort scoping, reduced sub-management overhead. Reference `{{sub_tier_size}}` and the manual-tracking burden.*

**Touch 1 opener (replaces master Touch 1 paragraph 1–2):**

{{contact_first_name}} —

Looking at {{prime_name}}, the operational problem under {{program_at_risk}} is scale: you're carrying {{sub_tier_size}} touching CUI, and verifying each one's CMMC readiness by hand doesn't survive contact with a deadline. Under DFARS 7021 you can't award CUI work to a sub you can't prove is ready — so today that burden lands on your team, manually, vendor by vendor.

*(Continue with master Touch 1 from "SCRE scores your whole sub-tier…")*

**Touch 2 opener (replaces master Touch 2 paragraph 1):**

{{contact_first_name}} —

The procurement version of this: every flow-down affirmation your organization signs assumes a sub-tier posture your team is tracking by spreadsheet. That's a lot of operational risk riding on manual process across {{sub_tier_size}}. SCRE turns it into one managed program — scoped per cohort, priced predictably, with a single roll-up instead of dozens of vendor threads.

*(Continue with master Touch 2 from "A spreadsheet of self-attestations…", adapting smoothly.)*

**Touch 3 opener (replaces master Touch 3 paragraph 1–2):**

{{contact_first_name}} —

Per the CMMC Final Rule, Phase 2 requirements take effect for new DoD solicitations on or around November 2026 — and assessing {{sub_tier_size}} one vendor at a time won't fit the window. {{enforcement_signal}} tells us pressure is already moving. A per-cohort program assesses the whole tier on one timeline instead of dozens.

*(Continue with master Touch 3 from "Here's the math that bites primes…")*

---

### Variant C — Program Manager (Program Eligibility at Risk)

*Emphasis: program award eligibility, `{{program_at_risk}}`, milestone alignment, days-to-ready on the roll-up board, and the consequence of a high-value sub failing audit at the wrong time. **Most urgent and specific of the three variants.***

**Touch 1 opener (replaces master Touch 1 paragraph 1–2):**

{{contact_first_name}} —

Straight to the program risk: on {{program_at_risk}}, your award eligibility depends on a sub-tier that has to be certifiable — and {{cert_gap_signal}} says some of it isn't. If a high-value sub fails an audit at the wrong milestone, that's not their problem to absorb; it's a pause on your program. Most primes have no live view of where that risk sits.

*(Continue with master Touch 1 from "SCRE scores your whole sub-tier…")*

**Touch 2 opener (replaces master Touch 2 paragraph 1):**

{{contact_first_name}} —

For a PM, the FCA frame is really an eligibility frame: the affirmations made on {{program_at_risk}} assume a sub-tier posture nobody has actually evidenced. If that assumption is wrong, the exposure shows up as a paused milestone — with {{largest_award_value}} behind it. SCRE gives you a days-to-ready read per sub, against your milestones, before it becomes a program problem.

*(Continue with master Touch 2 from "A spreadsheet of self-attestations…", adapting smoothly.)*

**Touch 3 opener (replaces master Touch 3 paragraph 1–2):**

{{contact_first_name}} —

Per the CMMC Final Rule, Phase 2 requirements take effect for new DoD solicitations on or around November 2026 — and on {{program_at_risk}} the real risk is a sub failing audit at the wrong milestone and pausing the program. {{enforcement_signal}} tells us pressure is already moving. The roll-up board gives you days-to-ready per sub so you see it coming.

*(Continue with master Touch 3 from "Here's the math that bites primes…")*

---

## Sequence 3 — Warm Intro Variant (Carahsoft / ValorForge Channel)

*Single touch, sent when the team has a named referral (e.g., from Alex Whitworth at Carahsoft's CMMC Sales Desk, or a ValorForge PM introduction). Name the referral in sentence one and go straight to the ask — the referral does the credibility work. Body ≤ 75 words.*

**Subject line:**
- **A (warm):** `[Referral name] suggested we connect — {{prime_name}} sub-tier`
- **B (warm / program):** `Intro via [referral source]: {{program_at_risk}} readiness`

**Body (≈70 words):**

{{contact_first_name}} —

[Referral name] at [Carahsoft / ValorForge] suggested I reach out. They thought {{prime_name}}'s sub-tier posture on {{program_at_risk}} was worth a direct conversation, given where the CMMC Final Rule timing is heading.

Short version: we score your whole sub-tier against the 110 controls on any stack and hand the prime one defensible roll-up board.

Could we put 25 minutes on the calendar? I'll bring a pre-screen of your tier.

[rep name]

---

## Send Mechanics

*Operating rules for running the cadence. Read before loading the sequence into Outreach / Salesloft / HubSpot.*

- **Cadence spacing.** Day 1 / 4 / 8 / 14 / 21. Touches accelerate early (signal → teach → deadline), then space out and soften (operational → break-up). **Never send two touches to the same contact in the same week** — if a holiday or reply shifts a send, push the whole tail, don't compress it.
- **The signal rule (non-negotiable).** Every send must reference a real, named Cobalt Talon observable — a program, an award value, an enforcement event, a hiring signal. **If you can't fill the signal token with something true, the touch doesn't go out.** Use the specified fallback copy only where the table permits it; never invent a signal.
- **When to stop.** Stop the sequence immediately on any reply (route to the rep for a 1:1 response). Stop on an explicit opt-out. After Touch 5 with no reply, exit to nurture — re-enter only on a fresh signal (new event_watch hit, new program, new hiring req), not on a timer.
- **A/B guidance.** Test **one variable at a time** — subject line *or* opener, not both. Run subject-line A/B on Touches 1–3 where volume is highest (risk vs. question vs. signal frame; FCA vs. value; urgency vs. deadline). Hold the body constant while testing subjects. Give a variant a real sample before calling it — don't switch on a handful of sends. Log results against the Subject Line Archive below.
- **Role variants are additive.** Only swap the opener when `{{role}}` is confirmed from intel; an unconfirmed role runs the master sequence. Don't mix a CISO opener into a Procurement body.
- **Compliance reminders carry into email.** FCA stays a general, public-sourced industry risk — never assert this prospect is non-compliant or will be sued. Keep the certification stat as "a low-single-digit percentage, well under 5%," and drop the number entirely if a reply challenges it. Attribute the deadline to "the CMMC Final Rule" as phased effective dates. Don't name Cobalt Talon in prospect-facing copy — "our pre-screen" / "our market-intelligence research function" is the scripted reference.

---

## Subject Line Archive

*Every subject line across all sequences and variants, for A/B tracking. Hook types: Risk / FCA / Urgency / Operational / Break-Up / Warm.*

| Sequence | Touch | Variant | Subject Line | Hook Type |
|---|---|---|---|---|
| 1 — Cold | T1 | A | `{{program_at_risk}}: your sub-tier exposure under DFARS 7021` | Risk |
| 1 — Cold | T1 | B | `{{prime_name}} — how many of your subs can actually certify?` | Risk |
| 1 — Cold | T1 | C | `Flagged {{program_at_risk}} in your sub-tier` | Risk |
| 1 — Cold | T2 | A | `Flowing down the clause isn't the same as evidencing it` | FCA |
| 1 — Cold | T2 | B | `{{largest_award_value}} riding on an unproven sub-tier` | FCA |
| 1 — Cold | T3 | A | `C3PAO queues are forming now — before they close` | Urgency |
| 1 — Cold | T3 | B | `Per the CMMC Final Rule: the November 2026 window` | Urgency |
| 1 — Cold | T4 | A | `One dashboard instead of chasing {{sub_tier_size}}` | Operational |
| 1 — Cold | T4 | B | `Saw {{prime_name}} is building out compliance capacity` | Operational |
| 1 — Cold | T5 | A | `Closing the loop on {{prime_name}}` | Break-Up |
| 1 — Cold | T5 | B | `Before I step back — your sub-tier snapshot` | Break-Up |
| 2 — CISO/ISSM | T1 | role | `{{program_at_risk}}: can you evidence your sub-tier on demand?` | Risk |
| 2 — CISO/ISSM | T2 | role | `Self-attestation vs. signed evidence — the FCA gap` | FCA |
| 2 — CISO/ISSM | T3 | role | `A defensible DIBCAC posture before November 2026` | Urgency |
| 2 — Procurement VP | T1 | role | `Verifying {{sub_tier_size}} by hand won't beat the deadline` | Operational |
| 2 — Procurement VP | T2 | role | `Dozens of flow-down affirmations, one manual process` | Operational |
| 2 — Procurement VP | T3 | role | `Assess the whole tier on one timeline, not dozens` | Urgency |
| 2 — Program Manager | T1 | role | `A sub failing audit on {{program_at_risk}} pauses your program` | Risk |
| 2 — Program Manager | T2 | role | `{{program_at_risk}} eligibility riding on an unproven sub-tier` | FCA |
| 2 — Program Manager | T3 | role | `Days-to-ready on {{program_at_risk}} before November 2026` | Urgency |
| 3 — Warm Intro | — | A | `[Referral name] suggested we connect — {{prime_name}} sub-tier` | Warm |
| 3 — Warm Intro | — | B | `Intro via [referral source]: {{program_at_risk}} readiness` | Warm |
| Archive — Curiosity | — | — | `The question your flow-down affirmation can't answer` | Risk |
| Archive — Curiosity | — | — | `What {{prime_name}}'s sub-tier looks like from the outside` | Risk |
| Archive — Curiosity | — | — | `Most primes are running spreadsheet-and-hope. You?` | Risk |
| Archive — Program-Risk | — | — | `{{program_at_risk}}: one uncertified sub from a pause` | Risk |
| Archive — Program-Risk | — | — | `Your award eligibility and a sub-tier you can't see` | Risk |
| Archive — Deadline | — | — | `Per the CMMC Final Rule — what changes for new solicitations` | Urgency |
| Archive — Deadline | — | — | `The C3PAO queue won't wait for your cohort` | Urgency |
| Archive — Deadline | — | — | `Runway, not a cliff — but the runway is shortening` | Urgency |
| Archive — Value | — | — | `Less than 1% of {{largest_award_value}} to know your posture` | Value/ROI |
| Archive — Value | — | — | `One roll-up board, your whole sub-tier, any stack` | Operational |
| Archive — Value | — | — | `Score the tier without migrating a single sub` | Operational |
| Archive — Break-Up | — | — | `Should I close your file, {{contact_first_name}}?` | Break-Up |
| Archive — Break-Up | — | — | `I'll assume the timing's wrong on {{prime_name}}` | Break-Up |

---

*BHD is not a law firm. Nothing in these emails or notes is legal advice. Where a prospect raises specific legal exposure, defer to their general counsel and speak only to the posture record. Every send references a real Cobalt Talon signal or it does not go out.*
