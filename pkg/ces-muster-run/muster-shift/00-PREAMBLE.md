# The Planner → Muster shift: preamble

Read this before the backlog.

## What Planner is

Planner is generation 1 of the CES advisor: a browser wizard with about 316 questions across its stages. An operator
types answers, and Planner compiles them into the artifacts a CMMC engagement needs: the Mission Plan, Tenant
Manifest and Infrastructure Manifest that Stamper executes, plus the SI Baseline, TCP, Readiness Posture, policy
documents and assessor reports.

**Planner is the reference definition of the required outputs.** If Planner emits it, Muster must emit equivalent
content, unless a scope decision removes it or Planner itself is wrong (backlog section 5).

## What Muster is

Muster is generation 2. It must produce **the same outputs with far fewer questions**, learning about the customer
through:

- **tenant discovery:** read-only reads of the customer's Microsoft 365 / Entra tenant, against the simulator during
  development and against live tenants once proven;
- **inference:** deriving a value from known facts (licence SKUs give the licence tier);
- **defaults:** archetype priors and bank recommendations, only where discovery is silent, always marked as defaulted.

## The parity rule

**Same outputs, fewer questions.** Every input follows **discover → infer → default → ask**. Ask only what cannot be
derived, and justify every remaining question. There is no fixed question-count target. Instead, a **question
register** (MG-28) lists every question Muster still asks, the output field it feeds, and why it can't be derived. A
PR that adds a question adds a register row.

An unasked Planner question is not a gap. A gap exists only when an output needs information Muster neither asks,
derives nor can safely default.

## Why the shift matters

Planner's prompts make an engagement slow and error-prone: operators type values the tenant already knows, and typed
values drift from the real configuration. Muster reads the tenant, so its plan reflects what is actually deployed:
faster for the customer, more accurate for Stamper, and more defensible to an assessor, because every value carries
its provenance (discovered, asked, archetype or defaulted).

## Where everything lives

GitHub organisation: **blue-heron-defense-CES**.

| What | Where |
|---|---|
| Planner (reference) | `ces-mono/ces-planner/`; domain knowledge stores in `public/data/` |
| Stamper and shared contracts | `ces-mono/ces-stamper/`, `ces-mono/ces-shared/` |
| Muster | the `ces-muster` repo: React SPA plus `muster-api/` |
| Onboarding guide | `ces-onboarding/`: chapter 05 §8 (Planner) and §9 (Muster), chapter 06 (Muster database); chapter 08 (live tenant) for MG-19 |

Set up with the onboarding guide first.

## Scope decisions

| Decision |
|---|
| No pricing outputs: no proposal, SOW, LOE or cost estimate. |
| Render **all** policy, SSP, POA&M and IR documents Planner can generate (20 templates). |
| Discovery runs on the simulator and on live tenants (read-only); live is proven first on a BHD test tenant. |
| No fixed question count: minimise, and justify each remaining question. |
| Readiness covers all 165 Planner activities, filtered per scenario. |
| Plan modes `harden_existing` and `build_new`; `migrate` and `hybrid` deferred. |
| SI Baseline, TCP and Readiness Posture are **pushed** to Stamper with the plan. |
| Assessor reports and the tech-ref guide are downloads. |
| A cross-artifact misalignment **blocks** the push; an operator override is audited. |

Rationale: `02-DECISIONS.md`.

## Out of scope

Pricing in any form: proposal, SOW, LOE, rate card and cost estimate (MG-17, MG-26). Planner's Mission Plan carries an
inline `cost_proposal_sow` block and its validator expects a proposal; Muster omits both, and MG-04 and MG-15 adjust
for it.

## How to work the backlog

- **Waves:** `01-GAP-BACKLOG.md` section 6 groups items into four waves; do P0 first within each.
- **IDs:** use the MG-nn ID in branch names, commits and PR titles.
- **Done when:** each item's acceptance test, ideally a content diff against Planner's golden output.
- **Parity harness first:** MG-04 is the yardstick for nearly every later item. Build it, and seed the question
  register, in wave 1.
- **Cross-module:** the Stamper intake contract (MG-27) touches `ces-stamper/` and `ces-shared/`. The contractor team owns both
  sides of this change (decision D11); keep existing MP/TM/IM intake working.

## What BHD will supply

- **Archetype content** (MG-21) and **answers to the domain markers** (MG-24), before wave 3. Build the mechanism and
  leave content slots; don't invent domain content.
- **A BHD-owned test tenant**, consented for read-only live discovery (MG-19).
- **Review of policy outputs** (MG-16) before they count as done.

The reference customer (withheld) is not available; use scrubbed synthetic fixtures.

## Questions and progress

Raise questions with BHD in the usual channel; reference MG IDs. Report progress by wave and MG ID: done, in
progress, and blocked (naming the blocker).

## Legend

| Term | Meaning |
|---|---|
| CES / BHD | The product suite / the company that owns it |
| CMMC | Cybersecurity Maturity Model Certification |
| SI / TCP | Strategic Intent Baseline / Tenant Config Profile |
| SSP / POA&M / IR | System Security Plan / Plan of Action and Milestones / Incident Response |
| SOW / LOE / SKU | Statement of work / level of effort / Microsoft licence product ID |
| SPA | Single-page web app |
| MG-nn | Backlog item IDs |
| Golden | Planner's output for a fixture customer, used as the expected result |
