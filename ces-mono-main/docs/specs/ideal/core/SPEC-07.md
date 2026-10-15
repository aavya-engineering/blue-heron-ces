# SPEC-07 — CI/CD (v1.0)

## Intent

Continuous integration and delivery is the machine that makes every other spec *enforceable*
rather than aspirational: a requirement that is not checked by a gate regresses silently. This
dimension defines the pipeline that runs on every change — build, lint, typecheck, test, coverage,
dependency audit, and golden-diff gates — plus branch protection, environment promotion, and
artifact retention. It is framed by the DORA program's research (see *Accelerate*, State of DevOps
reports): elite delivery is characterized by high **deployment frequency**, low **change-failure
rate**, short **lead time for changes**, and fast **mean time to restore** — outcomes that require
automated gates and protected trunk, not manual discipline. A CI job that runs only a single test
command is a change-failure-rate liability: lint, type, coverage, and supply-chain regressions all
pass through it unnoticed.

## Requirements

- **SPEC-07.R1 — CI triggers on every push and pull request.** *(L1)*
  A CI workflow runs automatically on push to protected branches and on all PRs.
  **Verify:** the workflow `on:` block lists `push` and `pull_request`; a recent PR shows a completed
  CI run in its checks list.

- **SPEC-07.R2 — Build gate.** *(L2)*
  CI compiles every workspace from a clean checkout (`npm ci` from lockfile, then build) and fails the
  job on any compile error.
  **Verify:** the workflow installs with `npm ci` (not `npm install`) and runs the build; introduce a
  deliberate type error on a scratch branch and confirm the job exits non-zero.

- **SPEC-07.R3 — Lint gate with zero-warning budget.** *(L2)*
  CI runs the linter with `--max-warnings 0` (or equivalent) so warnings fail the build, not just
  errors.
  **Verify:** a distinct `lint` step exists in the workflow invoking eslint with `--max-warnings 0`;
  a warning-level rule violation fails the job.

- **SPEC-07.R4 — Typecheck gate.** *(L2)*
  CI runs `tsc --noEmit` (strict) as a gate independent of the test runner's transpilation.
  **Verify:** a `typecheck` step runs `tsc --noEmit`; the project's `tsconfig` has `strict: true`.

- **SPEC-07.R5 — Test gate fails the build on any failing test.** *(L2)*
  The full aggregate test suite runs in CI and a single failing test exits the job non-zero.
  **Verify:** the workflow runs the root test contract; a deliberately failing test on a scratch
  branch fails the job.

- **SPEC-07.R6 — Coverage gate with enforced thresholds.** *(L3)*
  Coverage is measured in CI and the build fails when line/branch coverage falls below a declared
  threshold — the threshold lives in committed config, not a reviewer's judgment.
  **Verify:** show the coverage config (e.g. `vitest.config` `coverage.thresholds` / jest
  `coverageThreshold`) with numeric floors, and the failing-gate output when coverage drops below it.

- **SPEC-07.R7 — Dependency-audit / supply-chain gate.** *(L3)*
  CI runs a dependency vulnerability audit (e.g. `npm audit --audit-level=high`) and/or lockfile
  integrity check, and fails on findings at or above a declared severity.
  **Verify:** an `audit` step exists with an explicit `--audit-level`; a seeded high-severity advisory
  fails the job. (See SPEC-04 for SBOM/least-privilege scope.)

- **SPEC-07.R8 — Golden-diff gate.** *(L3)*
  Deterministic reference outputs (golden files, e.g. the SSP reference render) are diffed in CI and
  any unreviewed drift fails the build.
  **Verify:** a golden/reference test runs in the CI suite; mutating a golden artifact without
  updating the snapshot fails the job.

- **SPEC-07.R9 — Branch protection on the trunk.** *(L3)*
  The default branch rejects direct pushes; merges require the CI checks above to pass and at least
  one review.
  **Verify:** repository branch-protection settings list the CI job as a required status check and
  require PR review; a direct push to the trunk is rejected.

- **SPEC-07.R10 — Environment promotion path.** *(L2)*
  Artifacts are promoted through declared environments (dev → CI → live) rather than rebuilt per
  environment; the promotion steps are declared, not manual tribal knowledge.
  **Verify:** the pipeline (or a documented release runbook) names the environments and the
  promotion trigger; the same build artifact hash is carried forward, not recompiled.

- **SPEC-07.R11 — Build artifacts retained.** *(L2)*
  CI uploads and retains build/test artifacts (dist bundles, coverage reports, test logs) for a
  declared window.
  **Verify:** an `upload-artifact` (or equivalent) step exists with a `retention-days` value; a recent
  run has downloadable artifacts.

- **SPEC-07.R12 — Delivery metrics tracked (DORA framing).** *(L3)*
  Deployment frequency and change-failure rate are measurable from CI/release history so delivery
  health is observable over time, not anecdotal.
  **Verify:** release/deploy events are recorded (tags, release notes, or a metrics dashboard) such
  that deployment frequency and change-failure rate can be computed from repo/CI history.

## Anti-patterns

- **Single-gate CI.** The workflow runs one `npm test` command and nothing else — lint, type,
  coverage, and audit regressions all pass through (fails R3, R4, R6, R7). *This is the current CES
  posture: `.github/workflows/ci.yml` runs only `npm ci && npm test`.*
- **No coverage gate.** Coverage is never measured, so a PR that deletes tests still goes green
  (fails R6).
- **No supply-chain gate.** `npm audit` is never run in CI; a critical advisory ships unnoticed
  (fails R7).
- **`npm install` in CI.** Using `npm install` instead of `npm ci` lets the lockfile drift and makes
  builds non-reproducible (fails R2).
- **Unprotected trunk.** Contributors push directly to `master`; CI is advisory, not blocking
  (fails R9).
- **Rebuild-per-environment.** Each environment recompiles from source instead of promoting one
  vetted artifact, so "works in CI" does not guarantee "works in live" (fails R10).
- **Ephemeral artifacts.** Failing-run logs and coverage reports vanish with the runner, so
  post-mortems have nothing to inspect (fails R11).

## Conformance checklist

- [ ] CI runs on every push and PR. (R1)
- [ ] Clean `npm ci` + build gate present and blocking. (R2)
- [ ] Lint gate with `--max-warnings 0`. (R3)
- [ ] `tsc --noEmit` typecheck gate present. (R4)
- [ ] Test failure fails the job. (R5)
- [ ] Coverage measured with enforced numeric thresholds. (R6)
- [ ] Dependency audit gate with declared severity floor. (R7)
- [ ] Golden/reference diff gate present. (R8)
- [ ] Trunk branch protection requires passing CI + review. (R9)
- [ ] Environment promotion path is declared. (R10)
- [ ] Build/test artifacts retained for a declared window. (R11)
- [ ] Deployment frequency + change-failure rate are computable. (R12)

## CES profile hooks

- **Target: raise the single-test gate to a full gate set.** CES's `.github/workflows/ci.yml` (G6)
  today satisfies only R1, R2 (partial — `npm ci` + `npm test`), and R5, plus R8 by embedding (the EO
  golden SSP reference test runs inside `npm test`). The profile **tightens** the CES CI target to add
  **R6 (coverage)** and **R7 (dependency audit)** as first-class blocking gates — the two highest-value
  additions per the recon's "single test gate only" finding — and to promote **R3 (lint)** and
  **R4 (typecheck)** from build-embedded to explicit gates.
- **R8 already partially met:** the golden SSP reference test exists (`ces-eo` suite). The profile
  requires it stay in the CI aggregate and gain a companion golden-diff for other deterministic
  renders as they land.
- **Offline constraint honored:** CES CI is offline-only (no live-tenant, network, or `mmdc` steps).
  R10's environment promotion and R12's deploy metrics target **L2** while the product is pre-SaaS —
  see the CES profile's SPEC-12 note and `docs/saas-readiness.md`.
