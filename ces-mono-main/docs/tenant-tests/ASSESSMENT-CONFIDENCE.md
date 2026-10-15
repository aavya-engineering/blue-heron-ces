# How far to expand for "very high confidence" a C3PAO finds vfsgov meets CMMC 2.0 L2

**Date:** 2026-07-03 · **Grounds:** NIST SP 800-171 R2, NIST SP 800-171A, CMMC Assessment Process
(CAP) v1.0, 32 CFR §170 (research summary `docs/context/RESEARCH_SUMMARY.md`). **Current state:**
`docs/tenant-tests/results/dashboard.html` (77 probes, ~1.1/control, Examine-only).

## The bar an assessor actually scores against

CMMC L2 is **not scored at the 110-practice level**. It is scored at **320 assessment objectives**
(determination statements, 800-171A). **One NOT MET objective fails the whole practice** (32 CFR
§170.4). Objectives average ~2.9 per practice (up to 8). For each objective, 800-171A names required
**methods**: **Examine / Interview / Test**. Automated tenant-config checks satisfy **Examine only** —
and for the AC family alone, **19 of 26 objectives also require Interview or Test**. Evidence must be
**adequate** (right artifact type) *and* **sufficient** (covers every sampled in-scope host unit).
M365 GCC High is a CUI/Security-Protection Asset → the full 110-control, all-three-methods assessment
applies. To certify, SPRS score must be **≥ 88/110** and no 5-point practice may sit on the POA&M.

## Where we are: ~1/9 of the evidence surface

Our suite runs **77 probes at ~1 per control** — the "top use case per persona" depth. That is one
config **Examine** touch per control, ≈ **one of the ~2.9 objectives** each control carries, and
**Examine only** (no Interview, no Test, no SSP narrative). Per the research, one automated check per
practice ≈ **1/9 of what a C3PAO examines**. So: necessary, real, and already valuable (it flipped 6
findings to 1 and dispositioned the out-of-scope controls) — but it is a *slice* of Examine, not the
assessment.

## Four axes of expansion (only one is "more tests")

| Axis | From → To | Automatable? | Rough size |
|---|---|---|---|
| **1. Objective depth** | 110 practices → 320 objectives (the config-verifiable subset) | Yes (our suite) | ~77 → **~150–200 Examine probes** (~2–2.5×) |
| **2. Method coverage** | Examine only → Examine + **Test** (demonstrated) + **Interview** | Test partly (T3 tier + test personas); Interview no | build the **T3 demonstrated-test tier**; rest is human prep |
| **3. Documentation** | none → **SSP mapped to all 320 objectives** (not 110!), 17+ signed org policies, POA&M, scoping/boundary doc | No — authored (EvidenceOps generates SSP/POA&M) | the largest single lift |
| **4. Inheritance** | INHERITED tags → **CRM** (Microsoft FedRAMP pkg, under NDA) + SSP narrative per inherited control + tenant-side confirmation | Partly (our tests confirm tenant side) | ~53 controls need CRM citations |

**The ceiling of automated testing:** config **Examine** can meaningfully cover only ~40–50% of the
320 objectives (the "does the enforcing policy exist / is it scoped / did it fire" statements). The
other ~50–60% is Interview + Test + signed documentation — which our suite can **gap-check and track**
but **cannot produce**. A perfectly green automated board is roughly a **B on Examine**, and Examine
is one of three methods. That is the honest reason "expand the tests" alone never reaches "very high
confidence the assessor agrees."

## The target for "very high confidence"

Confidence is a product of four factors, not one. To get there:

1. **Tests → objective depth (our suite, ~2–2.5×):** expand each control's probes to cover *all* its
   config-Examine objectives (e.g. IA-3.5.3 MFA = methods defined **and** enforced **and** weak
   methods disabled **and** phishing-resistant available — 4 objective-touches, we test ~2). Target
   ~150–200 probes with an explicit `objective` id (800-171A) on each row, so coverage is measured
   against 320, not 110.
2. **Add the T3 demonstrated-Test tier:** provision test personas + an unenrolled device + an external
   address, and actually *demonstrate* the control (blocked share, denied non-compliant sign-in,
   rejected weak password). Closes the "Test" method for the objectives that allow it.
3. **Objective-level SSP + POA&M (EvidenceOps):** drive CES's own EO module to a narrative mapped to
   each of the 320 objectives, plus a POA&M for the gaps — the single biggest confidence lever, and
   the #1 documented failure trigger (SSP mapped to 110 not 320).
4. **CRM inheritance package:** obtain Microsoft's GCC High CRM (under NDA), cite it in the SSP for the
   ~53 inheritable controls, and keep our tests as the tenant-side confirmation.
5. **Interview readiness:** a control-owner matrix — who articulates/demonstrates each family — so the
   Interview method isn't a surprise.

## Bottom line (the answer to "how far")

- **To max out what our test suite can prove:** ~2–2.5× (to ~150–200 probes) at **objective-level
  depth**, plus a demonstrated-Test (T3) tier. That takes automated **Examine + Test** confidence to
  very high.
- **But that is at most ~40–50% of the assessor's surface.** "Very high confidence the *assessor*
  agrees" requires the other axes — **objective-mapped SSP, signed policies, POA&M, the Microsoft CRM,
  and interview readiness** — which are documentation and people, not probes.
- **Sequencing that buys the most confidence per unit effort:** (1) objective-mapped SSP/POA&M via
  EvidenceOps [biggest lever], (2) our suite → objective depth + T3 [proves the config for Examine &
  Test], (3) CRM + interview matrix [closes inheritance & Interview].

Proposed goal to execute this: **G-EUT-5** — "objective-level assurance": re-key the suite to the 320
800-171A objectives, add the T3 tier, and wire the objective map into EvidenceOps' SSP so the tests
and the SSP cover the same 320 statements.
