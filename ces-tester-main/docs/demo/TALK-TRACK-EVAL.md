# Evaluation-Mode Demo — TALK TRACK (v0 draft, GP-DEMO-2 M4)

**Scenario:** Muster in **evaluation mode** on a **half-configured** DIB tenant.
**Status:** DRAFT — founder review required before this is a standard demo (HIL, per
GP-DEMO-1 convention). Beats lockstep with the evaluation demo runner.
**Canon honored:** Muster **reads and reports**. Evaluation mode never writes — the
sim ledger shows **zero mutations** for the whole run, and that fact is itself a beat.

---

## The story in one line

> **"You're not starting from zero — and we can prove exactly where you are."**

The remediation demo (GP-DEMO-1) sells the *journey*. This demo sells the *first
honest map*. It targets the most common DIB buyer there is: the shop that already
spent money — MFA rolled out in 2023, an MSP who "turned on security defaults," a
Purview trial someone started — and whose real fear is a vendor who ignores all of it
and quotes a rip-and-replace. Evaluation mode walks into that tenant, **credits what
genuinely works, exposes what only looks like it works,** and hands them a defensible
starting score. Nothing changed, nothing risked — read-only, evidenced, repeatable.

---

## Framing — say once, up front

"Same ground rules as always: this runs against our simulator of an M365/GCC-High
tenant — no cloud, no credentials, no customer data — and the code doing the reading
is the real product. One thing is different from our remediation demo: **today we
touch nothing.** Muster is in evaluation mode — it reads your tenant the way an
assessor would, and at the end I'll show you the change ledger to prove the count of
changes we made is zero."

## Beat E0 — The tenant: "Ridgeline, eighteen months in"
"This is a 13-seat machine shop that is NOT starting from zero. They rolled out MFA
last year. Audit logging — their MSP said it was on. There's a DLP policy somebody
created during a trial. Sound familiar? This is the real posture of most of the DIB:
**half-configured, undocumented, and nobody's sure what actually counts.**"

**So-what:** this is *your* tenant's shape — the demo isn't a strawman greenfield.

## Beat E1 — Muster reads (not interviews)
"Watch what Muster does NOT do: it doesn't hand you a 300-question survey and trust
your memory. It reads the tenant — the actual policies, the actual states — and
builds the posture from evidence."

**So-what:** your self-assessment stops being a memory exercise. The score is grounded
in what's *there*.

## Beat E2 — Credit where it's due
"First result: the things you did right are **counted**. The MFA conditional-access
policy you rolled out? Met — and Muster shows the evidence it read. That matters
commercially: your past investment isn't discarded, it's *banked*. We remediate the
gap, not the tenant."

**So-what:** no rip-and-replace. The quote you eventually get is for the *delta*.

## Beat E3 — The trap: looks-configured ≠ configured *(the acid beat)*
"Now the one that stings. Your remote-maintenance MFA policy — it exists. It's even
'on.' But it's in **report-only mode**: it observes, it doesn't enforce. A checkbox
audit credits it. An assessor doesn't. Muster reads it the way your C3PAO will — and
flags it. Same with that DLP policy from the trial: present, but disabled. **This is
the difference between a checklist and a reading.**"

**So-what:** the gaps that fail assessments are exactly the ones a questionnaire
can't see. Finding them *now* is cheap; finding them in an assessment is not.
**Objection — "our MSP says we're covered":** "Your MSP configured it — in report-only.
Nobody lied; enforcement just never got switched on. That's why you read the tenant
instead of the paperwork."

## Beat E4 — The honest score + the map
"Here's the posture: met, not-met, and 'present-but-not-enforced,' control by
control, with the score computed from it. This is your defensible starting point —
what you'd stand behind in SPRS, because every line traces to something Muster read."

**So-what:** a defensible number plus a prioritized gap list, in minutes, read-only.

## Beat E5 — Zero writes (close the loop on trust)
"And the promise from the top: the ledger. Every interaction this session made
against the tenant — **zero changes.** Evaluation mode is something you can run
against a scoped slice of production without a change-control meeting."

**So-what:** the lowest-friction first engagement that exists: we look, we prove,
we touch nothing.

## Close — the ask
"So before anyone quotes you a six-figure remediation: run the evaluation. Step one
with us is exactly what you watched — a **read-only paid evaluation** of a scoped
slice of your real tenant: credit what works, expose what only pretends to, and
leave you a defensible score and the delta-only remediation map. Who owns your CMMC
posture, and can we book the evaluation this week?"

---

### Presenter cheat-strip
- ✅ "read-only — the ledger shows zero changes" (verify live, don't just claim).
- ✅ "credits what genuinely works" / "remediate the gap, not the tenant."
- ✅ report-only CA + disabled DLP = the trap beats; name them plainly.
- ❌ never claim live-tenant discovery is shipped (sim today; connector cutover
  pending — same Graph surface).
- ❌ never quote a second SPRS number (one-SPRS rule — Muster owns the headline).
- ❌ never say "audit passed/guaranteed" — the score is defensible, not certified.
