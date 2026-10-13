# CES-Wide Demo — TALK-TRACK (canonical)

Presenter narration for the canonical five-beat demo (see the hub's
`DEMO-READINESS-MAP.md`), written for a **skeptical DIB-contractor buyer** — a small machine
shop that must self-attest an SPRS score, survive a C3PAO assessment, and will not burn
$150K–$500K or six months to do it.

**Status:** FOUNDER-APPROVED 2026-07-28 (GP-DEMO-1 HIL gate #2 signed off) — this is now the
standard demo talk track. Further edits are versioned amendments, not a re-approval reset.

**Version:** v1 (2026-07-27, GP-DEMO-1 iteration 2). Changes from v0: the **P0-3 honesty-tax
reframe** — the five per-beat concessions are consolidated into one upfront "What's real"
framing, and the sim→your-tenant bridge is stated as the product's **opening move**, not a
closing concession; plus the **P1-10 transfer rebuttal** (why the machinery you're watching is
what runs against a real tenant). Beats stay numbered in lockstep with the beat sheet.

**Truth rule honored:** nothing marked GAP or "must NOT claim" in the beat sheet is narrated as
real. Everything here is what we *can* prove today: sim tenant, real module code, real SPRS from
Muster, real ledger-recorded evidence, real submission deliverables — offline and resettable.

---

## Framing — say this ONCE, up front (this is the P0-3 reframe)

Before the run, set the frame so the honesty is a strength, not a running apology:

> "Two things up front, so I never have to interrupt the demo to hedge. **One:** everything you're
> about to see runs against a *simulator* of a Microsoft 365 / Azure tenant — no cloud spend, no
> real credentials, no customer data. That's deliberate: it's how we prove the product end-to-end,
> repeatably, without touching anyone's production environment. **Two:** the code you're watching —
> the assessment engine, the scoring, the remediation, the evidence ledger, the document
> generation — is the *real product*, not a demo mock. The only piece not yet cut over to live
> customer tenants is the discovery *connector*, and it targets the exact same Microsoft Graph
> surface this simulator models. So the honest way to read this demo is: **this is the machinery
> that will run against your environment — and step one of working with us is pointing it at a
> scoped slice of your real tenant.** Hold me to that as we go."

That single frame retires the five separate concessions v0 spread across the beats. Per-beat, you
now only *point* at the boundary in one line instead of re-litigating it.

**Standing guardrails (still true, keep off the mic as overstatement):**
- The **one true SPRS number** is Muster's (Beat 1). Stamper shows no score; EO's SPRS is
  detail-only. Never quote a second number.
- SPRS-*after* is a **projected trajectory** on synthetic data, not a promise about a real tenant.

---

## Hook (open with this — ~2 sentences, deadline-forward but solution-fast)

"CMMC 2.0 Phase 2 turns on November 10th — after that, a self-attested SPRS score you can't defend
isn't just a lost bid, it's contractual risk. The manual path to defensible costs six figures and
six months; what I'm going to show you is that same outcome — assess, fix, re-prove, and generate
the actual audit package — as one continuous run, with every step producing hashed evidence
instead of a slide."

*(Note the shift from v0: name the exposure once, then pivot immediately to the solution rather
than dwelling on False-Claims-Act threat — a defensive small-shop owner hardens if you lead with
fear and stay there.)*

---

## Beat 0 — Seed the demo tenant
"This is 'Ridgeline Fabrication' — a fictional 13-seat machine shop, the kind of contractor most
of this room is. Full M365/Azure tenant, real deliberate gaps baked in — MFA isn't actually
enforced, a couple of identity controls are failing — and, on purpose, some controls *pass*, so
nothing here is rigged to flatter the tool. And I can reset it to pristine between runs, so the
starting posture is identical every time."

**So-what:** your environment's shape — findable gaps and genuine passes — with zero risk to a
production tenant.
**Objection — "Is this a mock that agrees with your tool?":** "No — the gaps are ground-truth in
the tenant state, some controls deliberately pass, and the reset proves the start posture is
identical every run. You're watching the product read reality."

## Beat 1 — Muster: assess & score
"Muster reads the *actual* posture — not a checkbox questionnaire you grade yourself on. It maps
all 110 Level 2 controls and produces the one thing you can hand an assessor: a single SPRS score
and a concrete, control-by-control gap list. That number is your defensible self-assessment
starting point — the same score you'd file in SPRS, but backed by what the tool observed. And it
exports a schema-validated readiness result the next stages consume directly — no re-keying."

**So-what:** a defensible SPRS score plus an assessor-ready gap list in minutes, not a weeks-long
manual gap analysis.
**Boundary (one line, no re-hedging):** "Reminder from the frame: the discovery here is against
our simulator — the scoring engine computing that number is the real product."
**Objection — "why will this transfer to my real tenant?" (P1-10, the load-bearing one):** "Because
the connector reads the same Microsoft Graph endpoints this simulator emulates — the assessment
and scoring logic doesn't change between sim and live, only the source it points at. That's exactly
why our first engagement step is running it against a scoped slice of your real environment."

## Beat 2 — Stamper: apply & verify the remediation
"Now Stamper takes the gap list and actually *fixes* it — here, the MFA baseline — pushed through
the same resolver a real GCC-High tenant would get. Every action is recorded to an append-only
ledger with SHA-256 integrity hashing and six-year retention. That's the whole game for an audit:
you don't just tell your C3PAO you enabled MFA, you hand them cryptographically-verifiable evidence
of when and how, generated automatically as a byproduct of the work — audit-ready by design, not a
scramble the week before your assessor arrives."

**So-what:** remediation and tamper-evident audit evidence in one step — what makes a C3PAO review
fast instead of a document hunt.
**Boundary (one line):** "You may see a couple of controls read FAIL — those are known fidelity
gaps in the *simulator*, fields it doesn't synthesize, not remediation failures. The harness flags
them by name so we're not guessing." *(Presenter: the harness's known-false-FAIL registry annotates
these; never run live `execute`.)*
**Objection — "why did that say FAIL?":** "Simulator fidelity gap, not a product failure — against
a real tenant that field comes back populated. I'd rather show honest output than a scrubbed one."

## Beat 3 — EO: prove-it, evidence & audit deliverables
"Fixing isn't enough — you have to *prove* it independently. EO re-assesses control by control,
confirms the remediation took, and produces the documents you actually submit: your System Security
Plan, your POA&M for what's still open, and an Evidence package — real Word and zip files. And it's
not a rigged pass: a representative run comes back with dozens met and dozens not-met, because
that's what an honest re-assessment of a mid-journey tenant looks like. The POA&M lifecycle is
managed for you — items open and close as posture changes."

**So-what:** the actual CMMC submission package — SSP, POA&M, Evidence — falls out of the run,
cutting the most expensive piece of manual prep.
**Boundary (one line):** "Same frame: EO's re-assessment against the sim is rehearsed; the live
click-through of document generation is the one leg we're still hardening, so I'm showing you the
generated deliverables directly." *(Presenter: drive the offline assessor-view; STAGED for
iteration 2 — full live EO leg.)*
**Objection — "did it auto-pass everything?":** "No — a realistic met/not-met split, with open
items written into the POA&M. A tool that passes everything is the one you shouldn't trust."

## Beat 4 — Results dashboard: before → after
"Here's the whole engagement on one screen — where this tenant started, what we remediated, what
evidence got produced, what's still open. Fully offline, so you can walk into a board meeting or an
assessor kickoff with it. The story is the one that matters: real gaps found, fixed and verified,
with the audit trail — end to end, resettable, repeatable."

**So-what:** one defensible, at-a-glance record of the engagement outcome and the evidence behind
it.
**Boundary (one line):** "Your before/after SPRS is the Muster number from Beat 1 — this view
proves the toolchain ran clean and the state verified; I keep those two claims separate on
purpose." *(Presenter: the unified before→after SPRS dashboard is STAGED for iteration 2 — until
then, show the Muster number and the tester dashboard as two artifacts, not one.)*

---

## Close — the ask (now a callback, not the first mention of the bridge)
"That's the pitch in one run: assess to a defensible SPRS, remediate with tamper-evident evidence,
re-prove it independently, and walk out with the actual SSP, POA&M, and Evidence package — the
six-figure, six-month manual effort compressed into a repeatable flow. And remember the frame we
opened with: the machinery you just watched is the real product, and **step one of working together
is pointing it at a scoped slice of your real environment — a paid gap assessment that turns this
demo into your defensible SPRS score before November.** Who owns your CMMC posture internally, and
can we get 30 minutes with them this week?"

*(The bridge is now a callback to the opening frame — the buyer heard "this runs against your
environment, step one is the gap assessment" at minute one, so the ask lands as the plan all along,
not a walk-back.)*

---

### Presenter cheat-strip (do-not-say list — keep off the mic)
- ❌ "live-tenant discovery / enforcement" — sim today (FD-LIVE-SMOKE held); say "same Graph
  surface, connector cutover pending" instead.
- ❌ any SPRS number other than Muster's headline.
- ❌ "your real SPRS will be X" — after-score is a labeled projection on synthetic data.
- ❌ "continuous / always-on drift monitoring" — demo is point-in-time assess.
- ❌ "works on AWS / any stack" — Microsoft/GCC-High is live; AWS is roadmap.
- ❌ real cloud auth/crypto/throttling security — tokens are fake, queries unfiltered.
- ✅ safe to say: 503/523 real commands PASS, 0 FAIL (measured fidelity floor); SHA-256,
  6-year-retention, C3PAO-grade evidence; real SSP.docx / POA&M.docx / Evidence.zip; offline and
  resettable.
