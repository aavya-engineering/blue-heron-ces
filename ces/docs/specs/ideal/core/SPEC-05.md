# SPEC-05 — Testing (v1.0)

## Intent

Testing is the dimension that turns "it should work" into a machine-checked, regression-proof claim.
This spec anchors to the **test pyramid** (many fast unit tests, fewer integration, fewest E2E), to
**characterization / golden-master testing** (Michael Feathers' technique for pinning legacy behavior
before change), and to the CI principle that *coverage is measured and gated, not aspirational*. It
exists because agent-built code changes fast and broadly: without named test tiers, enforced coverage
floors, and golden references, an agent can refactor a seam and silently break behavior that no test
observed. Every requirement below is expressed as a countable, CI-checkable condition — a test tier
that exists, a threshold that fails the build, a golden artifact that must byte-match — never "tests
should be thorough."

## Requirements

- **SPEC-05.R1 — Named test tiers exist and are distinguishable.** *(L2)*
  The suite is organized into named tiers — **unit, contract, integration, golden, E2E** — that are
  individually runnable and identifiable.
  *Verify:* test files/scripts map to named tiers (by directory, tag, or npm script); confirm each
  claimed tier has at least one runnable test. A flat undifferentiated pile of tests is L1.

- **SPEC-05.R2 — Unit tier covers pure logic in isolation.** *(L2)*
  Business/domain logic (validators, generators, compilers, transformers) has unit tests that run
  without network or live services.
  *Verify:* each core logic module has a colocated unit test; the unit tier runs offline with no
  live-tenant dependency.

- **SPEC-05.R3 — Contract tests validate cross-module schemas both sides.** *(L2)*
  Every published cross-module contract (schema between producer and consumer) has a contract test on
  both the producing and consuming side.
  *Verify:* for each schema contract (e.g., stamper↔eo directive schema), a test asserts the producer
  emits and the consumer accepts the agreed shape; a DRAFT contract with no test is a gap
  (cross-refs SPEC-03).

- **SPEC-05.R4 — Integration tests exercise real seams.** *(L2)*
  Persistence, storage-ownership, multi-tenant isolation, and adapter wiring have integration tests
  against real (or faithfully faked) implementations, not mocks of themselves.
  *Verify:* integration tier exercises the actual persistence/ownership layer (e.g., Dexie ownership,
  repository collections) and asserts isolation invariants.

- **SPEC-05.R5 — Golden tests pin generated-artifact output.** *(L2)*
  Modules that generate artifacts (docx, SSP, POA&M, reports) have golden/reference tests that fail on
  any unintended change to output.
  *Verify:* a golden reference exists and the test fails on diff; updating the golden is a deliberate,
  reviewed action. Absence of a golden test for an artifact generator is a gap.

- **SPEC-05.R6 — E2E tier covers the primary user flow.** *(L2)*
  The primary end-to-end user journey per module (e.g., the planning wizard, an execute flow) has at
  least one E2E test with a committed, runnable config.
  *Verify:* an E2E runner config exists (e.g., `playwright.config.*`) **and** at least one E2E test
  runs against it. A Playwright dependency with no config and no test fails this requirement.

- **SPEC-05.R7 — Coverage is measured on every test run.** *(L2)*
  Test execution produces a coverage report; coverage is not disabled by default.
  *Verify:* the test script emits coverage (no `--no-coverage` default); a coverage config
  (`vitest`/`jest` coverage or c8/nyc) is present. A `test` script that runs `--no-coverage` fails.

- **SPEC-05.R8 — Coverage thresholds enforced in CI.** *(L3)*
  Minimum coverage thresholds (lines/branches/functions) are configured and fail the build when not
  met.
  *Verify:* coverage config sets numeric thresholds and CI fails below them; confirm the gate is wired
  into the pipeline, not just reportable. No threshold anywhere is L0/L1.

- **SPEC-05.R9 — Adapter and route coverage floors.** *(L3)*
  Execution adapters (API/Bicep/CLI/ManualGate) and HTTP route handlers carry an explicit
  per-area coverage floor, so untested adapters/routes cannot ship silently.
  *Verify:* coverage config declares floors for the adapter and route directories; CI fails if an
  adapter/route file drops below floor. Untested adapters (e.g., CLIAdapter, BicepAdapter) or route
  files below floor fail.

- **SPEC-05.R10 — Characterization tests before touching legacy seams.** *(L2)*
  Legacy/untested seams get characterization tests that pin current behavior *before* refactoring
  them.
  *Verify:* for any recently modified legacy module, a characterization test predates or accompanies
  the change (git history shows the pin was added before the refactor). Refactoring a seam with no
  behavior pin fails.

- **SPEC-05.R11 — Tests run offline and deterministically in CI.** *(L2)*
  The default suite is hermetic: no live-tenant, no network, no wall-clock/order flakiness; live
  steps are separate and manually gated.
  *Verify:* CI runs the suite with no network/live credentials and it passes deterministically; any
  live-tenant test is in a separate, manually triggered job.

- **SPEC-05.R12 — Test result and coverage artifacts retained.** *(L2)*
  CI retains test results and coverage reports as build artifacts for each run.
  *Verify:* the pipeline uploads/retains a coverage report and test summary per run (cross-refs
  SPEC-07). No retained evidence is a gap.

## Anti-patterns

- **Coverage never measured** — `test` scripts run `--no-coverage`, no coverage config anywhere; there
  is no number to gate on; violates R7/R8.
- **Playwright installed, never wired** — an E2E dependency with no `playwright.config` and no E2E
  test; the primary flow is untested; violates R6.
- **Untested adapters/routes** — execution adapters (CLI/Bicep/API) and 90+ route registrations with
  no coverage floor; the riskiest code is the least tested; violates R9.
- **Mock-of-itself integration** — "integration" tests that mock the very persistence/adapter they
  claim to integrate; violates R4.
- **DRAFT contract, no contract test** — a cross-module schema marked DRAFT with no both-sides test;
  drift ships undetected; violates R3.
- **Refactor without a pin** — changing a legacy seam with no characterization test capturing prior
  behavior; violates R10.
- **Flaky/live-dependent default suite** — the everyday suite needs a live tenant or network and is
  order-dependent; violates R11.

## Conformance checklist

- [ ] Named tiers (unit/contract/integration/golden/E2E) exist and are individually runnable. *(R1)*
- [ ] Core logic modules have offline unit tests. *(R2)*
- [ ] Every cross-module contract has a both-sides contract test. *(R3)*
- [ ] Integration tests exercise real persistence/isolation seams. *(R4)*
- [ ] Every artifact generator has a golden/reference test. *(R5)*
- [ ] The primary user flow has an E2E config **and** a running E2E test. *(R6)*
- [ ] Every test run produces coverage (no `--no-coverage` default). *(R7)*
- [ ] CI enforces numeric coverage thresholds and fails below them. *(R8)*
- [ ] Adapters and routes have explicit coverage floors enforced in CI. *(R9)*
- [ ] Legacy seams get characterization tests before refactor. *(R10)*
- [ ] Default suite runs offline and deterministically; live steps are separate. *(R11)*
- [ ] CI retains test-result and coverage artifacts per run. *(R12)*

## CES profile hooks

- **Golden-SSP test = exemplar (CES tightening to propagate).** The CES profile names EO's
  `tests/ssp/ssp-golden-reference.test.ts` as the reference implementation of R5 and *requires the
  same pattern* for every other artifact generator (POA&M, Evidence.zip, and Planner posture/proposal
  outputs). Golden coverage of generated compliance artifacts is mandatory L2+ because the artifact
  *is* the product.
- **Coverage-threshold gating = named CES target.** The CES profile sets R7/R8 as an explicit CES
  target: today CI has **no coverage gate anywhere** (recon), so the profile targets L3 by (1) turning
  off the `--no-coverage` defaults, (2) configuring thresholds per workspace, and (3) adding the gate
  to `.github/workflows/ci.yml`. This is a tracked uplift, not a claim of current compliance.
- **Adapter/route floors sized to CES risk (CES tightening).** R9 floors are pointed specifically at
  Stamper's execution adapters (APIAdapter/BicepAdapter/CLIAdapter/ManualGateAdapter — currently
  untested) and EO's ~98 route registrations, because these are the live-tenant blast radius. The
  profile pairs this with SPEC-04.R8 (injection guards must be test-covered).
- **Characterization-first is already partial (CES note).** The Planner already ships characterization
  tests (baselineValidator, postureGenerator, gapCompiler, etc.); the profile keeps R10 mandatory and
  extends it to Stamper/EO legacy seams before any refactor.
