# Ideal Specification Library

The durable, versioned benchmark that drives an **agentic software development lifecycle from concept
to deployment** — the rubric against which CES (and future products) is measured. Authored under
`docs/G-SPEC-1-plan.md`; consumed by G-SPEC-2 (score) and G-SPEC-3 (diff).

Two layers:

1. **Generic core** (`core/SPEC-00..12`) — product-agnostic. What *any* well-engineered, agent-built
   product must satisfy. Every requirement is a **testable assertion with a Verify clause**, tagged
   with the maturity level it defines — written so agents can consume and check them, not aspire to
   them.
2. **CES profile** (`ces-profile.md`) — a thin overlay setting one **target level per dimension** plus
   CES-specific tightenings and named waivers. It never re-tags a core requirement.

## Navigate

**Method / meta (read first):**
- [SPEC-00 — Agentic SDLC Method](core/SPEC-00.md) — the maturity model (L0–L3), scoring rules
  (R1–R14), and the consumption protocol. Binding on every audit; not a scored dimension.

**The twelve dimensions (concept → deployment):**
- [SPEC-01 — Concept & Requirements](core/SPEC-01.md)
- [SPEC-02 — Architecture & Design](core/SPEC-02.md)
- [SPEC-03 — API & Contracts](core/SPEC-03.md)
- [SPEC-04 — Security](core/SPEC-04.md)
- [SPEC-05 — Testing](core/SPEC-05.md)
- [SPEC-06 — Packaging & Release](core/SPEC-06.md)
- [SPEC-07 — CI/CD](core/SPEC-07.md)
- [SPEC-08 — Configuration](core/SPEC-08.md)
- [SPEC-09 — Observability](core/SPEC-09.md)
- [SPEC-10 — Documentation](core/SPEC-10.md)
- [SPEC-11 — Data & Persistence](core/SPEC-11.md)
- [SPEC-12 — Deployment & Operations](core/SPEC-12.md)

**CES overlay:**
- [ces-profile.md](ces-profile.md) — per-dimension targets (one-screen table) + tightenings/waivers.

## The maturity model (defined in SPEC-00, summarized)

- **L0 Absent** — not addressed.
- **L1 Ad hoc** — partially present, inconsistent, or undocumented.
- **L2 Systematic** — present, documented, consistent across the module.
- **L3 Enforced** — a machine mechanism (CI gate, schema validation at a boundary, or a test) fails the
  build/PR on violation, so silent regression is impossible.

Levels are **cumulative** (SPEC-00.R2): a cell at Ln satisfies every requirement tagged ≤ Ln. Level
tags live **only in the core specs**; target levels live **only in the profile** — the two are never
conflated (SPEC-00.R12).

## Spec file format (uniform, agent-consumable)

Every core spec follows the same shape: **Intent** (why the dimension exists, with industry anchors) ·
**Requirements** (`SPEC-NN.Rk`, each = statement + maturity tag + a Verify clause) · **Anti-patterns** ·
**Conformance checklist** (the yes/no list an agent runs, each citing its R#) · **CES profile hooks**
(what the profile tightens/waives). Requirements are verifiable, never aspirational (SPEC-00.R13).

## How G-SPEC-2 uses the library (to score)

For each `(module × dimension)` cell, an agent:
1. Loads the core spec + the `ces-profile.md` target for that dimension (SPEC-00.R9).
2. Scores **per requirement first, then rolls up** (SPEC-00.R5): the cell level is the highest Ln such
   that all requirements tagged ≤ Ln pass.
3. Cites evidence for every non-L0 verdict — a `file:line` or reproducible command output; **no
   evidence, no score above L0** (SPEC-00.R4). An **L3 claim requires a named enforcing mechanism**
   (CI line / schema / test), never prose (SPEC-00.R3).
4. Marks waived requirements `N/A` per the profile (SPEC-00.R7).

## How G-SPEC-3 uses the library (to diff)

The gap matrix places the **profile target** in the left column and the **scored as-is** beside it. A
gap is flagged **only where `as-is < target`** (SPEC-00.R6) — never against a blanket L3. Dimensions
the profile marks *"target, not yet met"* (SPEC-05, SPEC-07) are the expected standing gaps.

## Amendment policy (specs are versioned — never silently edited)

The library is a fixed point you diff against over time; its integrity depends on disciplined change
(SPEC-00.R14):

1. **Version every spec.** Each file carries `vX.Y` in its title. A substantive change bumps it —
   patch (`vX.Y+1`) for clarifications, minor/major for requirement changes.
2. **Changelog line, never a silent edit.** Every substantive edit lands with a dated changelog line
   recording what changed and why. A meaning/level change under a stale version is non-conformant and
   makes historical scores non-reproducible.
3. **New requirement → next R# + a maturity tag + a Verify clause.** Append `SPEC-NN.R{next}`; never
   renumber existing requirements (scores cite them by ID). The new requirement then obeys the same
   rules (SPEC-00.R2–R5) as any other.
4. **The profile tightens or waives — it never re-tags.** `ces-profile.md` may raise a dimension
   target, add a CES-specific requirement, or waive a named requirement with rationale. It must **not**
   change a core requirement's level tag (SPEC-00.R7, R12); to change a tag, amend the core spec with a
   version bump and changelog line.
5. **Amendments preserve reproducibility.** Given the same repo commit and the same spec+profile
   versions, re-scoring yields the same cell levels (SPEC-00.R8).

### Changelog

- **2026-07-04** — v1.0. Initial library: SPEC-00..12 core specs + `ces-profile.md` + this index
  (G-SPEC-1, T1–T5).
