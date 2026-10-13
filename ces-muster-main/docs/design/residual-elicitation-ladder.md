# The Answer Engine — one best-first path for every question Muster asks

*(Formerly "The Residual Elicitation Ladder." Reframed 2026-07-10 per founder direction:
the ladder's modes are not separate flow stages — they are the ordered RESOLVER CHAIN of
one answering engine. Filename kept so the G-MUSTER-GO-1 pointer stays valid.)*

**Date:** 2026-07-10 · **Status:** design concept, founder-approved direction ("i love this"
+ same-day unification: "treat our answering path as THE means to get an answer — a then b
then c then d — not as a broken-apart thing")
**Companion to:** `docs/goals/G-MUSTER-GO-2.md` (The Answer Engine — the goal derived from
this design; predecessor context in `docs/goals/G-MUSTER-GO-1.md`, the discovery-first GO
flow) — this document designs how EVERY question Muster asks gets answered, discovery
included as the chain-head rung: one best-first resolver chain covering Strategic Intent,
the CUI boundary, and every other fact, discoverable or not.
**Grounding:** `src/features/interview/questionGraph.ts` (current static question graph),
`src/features/` (existing `contracts/`, `coach/`, `intake/` lanes),
`ces-strategy/docs/registry-objective-coverage-2026-07-10.md` (the residual's size:
150 of 320 assessment objectives sit on discoverable controls but need documents, records,
or human input; 37 more belong to fully manual controls).

---

## The problem, stated honestly

Automated discovery (G-MUSTER-GO-1) answers what the tenant can answer — roughly 42% of the
320 assessment objectives, touching 96 of 110 controls. What remains is different **in
kind**, not just in count: Strategic Intent (business goals, contract reality, timeline,
risk appetite) and the CUI boundary (where controlled information lives, who touches it,
how it flows) are questions about **intent, business reality, and information flows**.
No get_command sees them.

Today's answer is a form: the question graph asks yes/no/unsure questions one at a time.
The evidence that this under-serves us is in our own bank: `iam-001` asks a human "Does your
organization enforce MFA for all users?" — a question the tenant answers *definitively* in
one query. Humans are being asked what machines know, and asked in the most expensive
format there is: blank-field recall.

The fix is not a better form — and it is not a set of separate flow stages either
("discovery here, infer there"). It is **one answer engine**:

## One answer engine (the unifying model)

Every fact Muster needs carries an ordered **resolver chain** — the rungs below, best
first: *discover → infer-and-confirm → extract-from-document → archetype-default →
ask-the-human*. One engine works the question list **biggies first** (the questions that
prune the most other questions and change the plan the most), trying the best available
resolver for each fact and falling down the chain only as needed. Then it repeats: each
pass shrinks the next.

The user experiences one repeating loop with an ez-button, not modes:

> "I can answer 61 of these automatically — press the button."
> → "12 need your contract — upload it."
> → "5 need you."

Two engineering truths under the hood:

1. **Intent is per-question; execution is method-batched.** One discovery pass serves
   every fact whose chain-head is discovery — the engine plans per-fact chains but runs
   one tenant sweep, one document extraction, one interview, not N of each.
2. **Resolver availability is environmental.** What the customer's access situation
   permits (see "The auth ladder" below) determines which chain-heads are live. If live
   discovery is unavailable, chains degrade gracefully to script-upload results,
   documents, and defaults — the engine runs the same loop either way; answers just cost
   slightly more. This is what makes the front door deal-resilient.

All resolvers fill the **same fact store with the same provenance model** — a fact knows
which resolver produced it and at what confidence; the attestation guardrail (below)
applies uniformly.

---

## The resolver chain (the rungs, best first)

### Rung 1 — Infer from footprints, then confirm (don't ask)

Discovery cannot see the CUI boundary as *intent*, but it sees the boundary's **evidence**:

- Sensitivity labels and their scoping
- Data-loss-prevention policies and what they protect
- SharePoint site names, permissions, and membership patterns
- Security groups and conditional-access scoping
- The tenancy itself (a government-cloud tenant is a strong prior that CUI is in scope)

So Muster **drafts the boundary** and asks for correction, not creation:

> "Your tenant suggests controlled information lives in these 3 sites, handled by these
> 12 people in this security group, flowing through these mailboxes. Correct anything
> that's wrong."

Confirming a drawn picture is an order of magnitude cheaper cognitively than recalling one
from scratch — and error-spotting is the thing humans are reliably good at. **This is the
single biggest lever on the residual.**

*Implementation note:* this rung consumes the same discovery results the Discovery tab
already produces (G-MUSTER-GO-1 M-milestones); the new work is the inference rules
(footprint → boundary-draft) and the confirm/correct UI. No new tenant access needed.

### Rung 2 — Read documents, not people

Most Strategic Intent and boundary answers already exist on paper the customer possesses:

- **The contract**: the DFARS 252.204-7012 clause, CUI categories in the DD-254, CDRLs,
  period of performance — that is half of Strategic Intent in one upload.
- Existing System Security Plans, policies, network diagrams, org charts.

Muster ingests the document, extraction drafts the candidate answers, the human confirms.
"Upload your contract — we'll read the CUI categories out of it" replaces a dozen fields.

*Implementation note:* `src/features/contracts/` already exists as a lane — this rung has
a home waiting. Extraction quality is a real risk (see guardrail below); the confirm step
is what makes imperfect extraction acceptable.

### Rung 3 — Archetype priors

Make the FIRST adaptive question: **"Which of these looks most like you?"**

- 50-person machine shop, one prime contract, Microsoft-only stack
- 200-person software subcontractor, multiple primes, hybrid cloud
- ... (4–6 archetypes total)

An archetype prefills defaults for dozens of long-tail answers; adaptive answering then
probes only where this customer *deviates* from the archetype. This is G-MUSTER-GO-1's
"earlier questions obviate later ones" taken to its limit — one question can obviate
thirty.

*Implementation note:* the Capability Taxonomy and Implementation Patterns domain
knowledge files are the raw material for archetype definitions. Archetype-prefilled
answers carry `source: archetype-default` provenance until individually confirmed or
overridden — they are priors, not facts.

### Rung 4 — Interview, not form

One plain sentence — *"our engineers get drawings from Lockheed by email and open them in
SolidWorks on five workstations"* — answers a dozen boundary form-fields at once: CUI type,
ingress channel, storage location, application scope, endpoint count, user population.

A conversational intake parses free-text answers into the structured store, fills every
field the sentence supports, and follows up only on what is still missing. The question
bank stops being the UX and becomes the **schema** — the completeness checklist the
conversation is filling behind the scenes.

*Implementation note:* `src/features/coach/` points in this direction. This rung is where
AI-assisted parsing enters; parsed fields carry `source: interview-extracted` provenance
and surface in the same confirm/correct UI as rungs 1–2.

### Rung 5 — Ask only what changes the plan

Not every unanswered question blocks progress. Muster should produce a **provisional plan
with declared unknowns** and rank the remaining questions by value-of-information: does
this answer actually change the plan? Many "required" fields turn out to be
plan-invariant — they matter for the System Security Plan's prose, not for what gets built
— and can be deferred to SSP-drafting time instead of gating the flow.

*Implementation note:* this requires the plan generator to accept marked assumptions and
report which inputs it is sensitive to. Deferred questions queue visibly ("12 questions
deferred — none affect your plan; you'll answer them during document generation").

---

## The auth ladder — discovery without certs

Certificate app-only authentication (app registration + admin consent + cert upload +
permission assignment) is what **Stamper's write path** legitimately needs. In a
change-controlled government-cloud shop that provisioning takes days to weeks — friction
that can kill a deal before it starts. The design error to avoid: letting the write path's
auth requirement gate the **read path**. Discovery only reads, and reads have cheaper
doors, in order of preference:

1. **Delegated sign-in (device-code flow).** The customer's own admin signs in
   interactively with their existing account and multi-factor prompt; discovery runs with
   their read permissions for the session. Nothing is provisioned — no app registration,
   no cert. Discovery at plan time is an attended activity anyway (the admin is in the
   room). This is precisely how the big compliance-automation platforms onboard in
   minutes; the pattern is deal-proven.
2. **Admin-runs-it-themselves + upload.** Hand the admin a signed, human-readable,
   read-only collection script; they run it under their own session and upload the results
   file into Muster. CES never holds credentials at all — frequently the EASIEST option to
   clear a customer security review — and it lands exactly on the goal's
   "import discovery results" mode for offline-first Muster.
3. **A "lite" tier via posture/reporting APIs** (e.g., Secure Score class reads): one
   consented read yields a coarse same-day posture snapshot — not a substitute for real
   discovery, but it keeps a deal warm while deeper access clears review.
4. **Certificate app-only** — still the right answer *later*, at remediation time, when
   Stamper needs to write and trust is established. Cert friction moves post-deal, where
   it no longer kills anything.

Two honesty notes: (a) some reads require specific admin roles regardless of flow — the
engine must degrade **per-command**, not all-or-nothing, and record "unavailable at this
auth tier" as a fact-status rather than silently skipping; (b) the auth tier achieved is
itself provenance — a fact discovered under delegated auth is the same class of evidence
as one discovered app-only, but the record should say which door it came through.

---

## The guardrail that keeps every rung honest

Strategic Intent and the CUI boundary feed the System Security Plan, and the SSP carries
**False Claims Act weight**. Therefore:

1. **Every inferred, extracted, archetype-defaulted, or parsed answer must end in human
   attestation** — a named person confirms it, and the record shows *drafted by
   [discovery inference / document extraction / archetype default / interview parsing],
   confirmed by [name] on [date]*.
2. **Nothing auto-drafted converts silently into an attested fact.** Unconfirmed drafts
   render visually as drafts everywhere they appear, including in readiness math.
3. The ladder reduces **typing**, never **accountability**. This is the same
   no-fabrication discipline CES applies everywhere else.

## Engineering note (standing, from G-MUSTER-GO-1)

**DO NOT REPLICATE CODE AS AN EASY OUT — DO THE RIGHT THING FROM A SOFTWARE ENGINEERING
POV.** For this design specifically: one question-graph store with one provenance model
serves all five rungs — the rungs are *fillers* of the same schema, not five parallel
question systems. Rung 1 consumes the Discovery tab's existing results; rung 2 builds in
the existing `contracts/` lane; rungs 3–4 refactor the existing question bank into the
adaptive graph rather than authoring a second bank.

## Where this lands in G-MUSTER-GO-1

- The **adaptive answering** definition gains the ladder as its internal design: adaptive
  answering = rungs 3–5 operating over whatever rungs 1–2 could not fill.
- The **automated branch's** "residuals via adaptive answering" step starts at rung 1
  (discovery footprints are available); the **manual branch** starts at rung 2/3 (no
  discovery results, so documents and archetypes carry more weight).
- Milestone impact: rung 1 (infer+confirm) and rung 3 (archetypes) are the highest
  leverage-to-effort candidates for the goal's early milestones; rung 4 (conversational
  interview) is the largest build and belongs behind them.

## Open questions

1. Inference rules for rung 1: rule-based footprint mapping first, or AI-assisted from the
   start? (Rule-based is auditable and cheap; start there.)
2. Extraction engine for rung 2: local model vs API — a government-cloud-safe choice is
   required if customer contracts transit it. This is a real constraint, not a detail.
3. Archetype set: who authors the 4–6 archetypes and validates their defaults? (Founder
   review required — these encode business judgment.)
4. Provenance schema: extend the existing answer store or version it? (Belongs in the
   goal's adaptive-graph data-model decision.)
5. Auth-ladder implementation order: delegated device-code flow vs admin-run-script-upload
   first? (Script-upload is the smaller build and matches the goal's import-file mode;
   device-code is the smoother demo. Both eventually.)
6. Resolver-chain data model: where does each fact's chain order live — per-question in the
   graph, or per question-class defaults with overrides? (Belongs with open question 4 in
   the goal's data-model decision.)
