# SPEC-01 — Concept & Requirements (v1.0)

## Intent

A software product is only as trustworthy as the chain from *stated intent* to *proven behavior*.
This dimension exists so that every capability an agent builds traces back to a named persona and a
numbered requirement, and forward to a test that proves it — closing the loop that ISO/IEC/IEEE
29148 (requirements engineering) and the V-model verification discipline both demand. Requirements
are written as testable assertions, not prose aspirations, so an agent can decide pass/fail without
interpretation. For a compliance product this chain is doubly load-bearing: a regulatory obligation
that is not expressed as a requirement, and a requirement that is not exercised by a test, is an
audit finding waiting to happen. Maturity levels below follow the L0–L3 model defined in SPEC-00.

## Requirements

- **SPEC-01.R1 — Product intent of record.** A written product intent/mission statement exists in the
  repo (charter, README top-matter, or `docs/`). *(Level: L1)* — **Verify:** a single canonical
  intent document is present and linked from the module README; reviewer confirms it names the
  problem and the target outcome.

- **SPEC-01.R2 — Personas enumerated.** Personas are named, each with a role and a primary goal; no
  user story references an undefined persona. *(Level: L2)* — **Verify:** a personas section lists
  ≥1 persona (name + role + goal); a check confirms every story's actor resolves to a listed persona.

- **SPEC-01.R3 — Canonical user stories with stable IDs.** Capabilities are expressed as user stories
  in the form *"As a &lt;persona&gt;, I want &lt;capability&gt;, so that &lt;benefit&gt;"*, each carrying a unique
  stable ID (e.g., `US-012`). *(Level: L2)* — **Verify:** every story has a `US-` ID; IDs are unique
  and never re-used (grep for duplicate IDs returns none).

- **SPEC-01.R4 — Acceptance criteria per story.** Every user story has ≥1 acceptance criterion written
  in an explicit, checkable shape (Given/When/Then or an assertion), not a vague sentence.
  *(Level: L2)* — **Verify:** each `US-` has ≥1 AC block; a lint rejects ACs lacking a
  Given/When/Then or a measurable assertion.

- **SPEC-01.R5 — Requirements are uniquely and stably identified.** Every requirement carries a
  unique, non-recycled ID (`SPEC-NN.Rk` in the ideal library; `REQ-xxx` or equivalent in product
  specs). *(Level: L2)* — **Verify:** ID-uniqueness check passes; superseded IDs are marked
  deprecated, never silently reassigned.

- **SPEC-01.R6 — Ban on aspirational phrasing.** Requirement and AC text contains no unquantified
  quality words ("fast", "secure", "robust", "well-designed", "should be good") without an attached
  metric or check. *(Level: L2)* — **Verify:** a phrasing lint scans requirement text for a banned-word
  list and fails on any match not paired with a number or a named test.

- **SPEC-01.R7 — Non-functional requirements captured distinctly.** Performance, security, compliance,
  and reliability obligations are recorded as first-class requirements, separate from feature stories.
  *(Level: L1)* — **Verify:** an NFR section exists and each NFR is individually numbered and testable.

- **SPEC-01.R8 — Non-goals stated explicitly.** Out-of-scope items and non-goals are written down so
  scope creep is detectable. *(Level: L2)* — **Verify:** a non-goals section is present; reviewer
  confirms at least the known exclusions (e.g., "no server auth — offline SPA") are listed.

- **SPEC-01.R9 — Machine-checkable acceptance criteria bind to tests.** Each acceptance criterion names
  or maps to at least one automated test that evaluates it; no AC is verified by "manual inspection"
  alone unless registered in a manual-step register. *(Level: L3)* — **Verify:** every AC row cites a
  test ID/path; a script resolves each cited test to an existing test case.

- **SPEC-01.R10 — Requirement→test traceability matrix, complete both directions.** A traceability
  matrix maps every requirement to ≥1 test and flags any acceptance-bearing test that cites no
  requirement. *(Level: L3)* — **Verify:** a CI/build check emits the matrix and fails on any
  requirement with zero tests (orphan requirement) or any acceptance test with no requirement
  (untraced test).

- **SPEC-01.R11 — Requirement changes are versioned.** Changes to requirements are recorded with a
  version bump and a changelog line; requirements are revised additively, never silently edited.
  *(Level: L3)* — **Verify:** the spec/requirements doc carries a version and changelog; git history
  shows changelog lines accompany requirement edits.

- **SPEC-01.R12 — Compliance obligations traced to requirements.** Where the product is subject to a
  regulatory framework, each obligation (e.g., a CMMC practice) maps to ≥1 requirement and thence to a
  test — obligation → requirement → test is unbroken. *(Level: L3)* — **Verify:** a mapping table
  exists; a check confirms every in-scope obligation resolves to a requirement that resolves to a test.

## Anti-patterns

- **Aspiration-as-requirement** — "the system should be secure and performant" with no metric, no
  persona, no test; passes review because nobody can disagree with it.
- **Orphan requirement** — a numbered requirement no test ever exercises; green suite, unproven claim.
- **Untraced test** — a large acceptance/E2E test that maps to no requirement, so its failure carries
  no meaning and its deletion is undetected.
- **Persona drift** — user stories invoke actors ("the admin", "the operator") never defined,
  so scope and authz assumptions are implicit.
- **Silent requirement edit** — requirement text changed in place with no version bump or changelog,
  erasing the audit trail of what was promised when.
- **Compliance gap** — a mandated control with no corresponding requirement, discovered only at
  assessment time.
- **ID recycling** — a retired requirement's ID reused for a new requirement, corrupting traceability
  history.

## Conformance checklist

- [ ] Canonical product-intent document exists and is linked. *(R1)*
- [ ] Every user story's actor resolves to a defined persona. *(R2)*
- [ ] All capabilities are `US-`-numbered canonical user stories with unique IDs. *(R3)*
- [ ] Every user story has ≥1 Given/When/Then (or assertion) acceptance criterion. *(R4)*
- [ ] All requirement IDs are unique and non-recycled. *(R5)*
- [ ] Requirement/AC text passes the aspirational-phrasing lint. *(R6)*
- [ ] Non-functional requirements are captured as distinct, numbered items. *(R7)*
- [ ] A non-goals / out-of-scope section is present. *(R8)*
- [ ] Every acceptance criterion cites a resolvable automated test (or a registered manual step). *(R9)*
- [ ] Traceability matrix shows zero orphan requirements and zero untraced acceptance tests. *(R10)*
- [ ] Requirements doc is versioned with changelog lines for edits. *(R11)*
- [ ] Every in-scope compliance obligation maps obligation→requirement→test. *(R12)*

## CES profile hooks

- **Tighten R12 to mandatory L3 (CMMC traceability).** CES is a CMMC L2 / GCC High product; the
  profile requires every in-scope CMMC practice to trace to a requirement and a test, and will point
  the check at the EO determination ledger / assessment objectives as the obligation source.
- **Tighten R10 (traceability) toward the characterization tests** already present in `ces-planner`
  (baselineValidator, postureGenerator, gapCompiler, etc.) and the EO golden SSP reference — these
  become the anchor tests the matrix must resolve to.
- **Waive R9's "no manual-only AC" strictly** for live-tenant / GCC High behaviors that cannot run in
  CI: those ACs are satisfied by a registered manual step (ties to SPEC-12 manual-step register)
  rather than an offline test, with rationale recorded.
- The profile sets the SPEC-01 dimension **target = L3** (traceability enforced), citing the
  evidence-integrity posture of the product.
