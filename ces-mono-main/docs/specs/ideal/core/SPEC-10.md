# SPEC-10 — Documentation (v1.0)

## Intent

Documentation exists so that a new engineer or agent can understand, run, operate, and change a
module without reading the whole codebase or interrupting its authors. This spec adopts the
**Diátaxis** framework's separation of concerns — tutorials (onboarding), how-to guides (runbooks),
reference (READMEs/APIs), and explanation (ADRs) — because conflating them is the root cause of
docs that are simultaneously too long and useless. It further adopts the **Architecture Decision
Record (ADR)** practice (Nygard) so that *why* a design was chosen survives staff turnover and is
not reverse-engineered from code. Documentation is treated as a build artifact: it has a location,
an owner, a freshness policy, and CI presence checks — not a best-effort afterthought. The failure
this spec prevents is the CES-observed smell of session logs and planning notes accreting as the de
facto "documentation" while modules ship with no README, no runbook, and no decision trail.

## Requirements

- **SPEC-10.R1 — README per module (purpose/run/test).** `[L2]`
  Every deliverable module (npm workspace / deployable service / library) has a `README.md` at its
  root that covers, at minimum, three sections: **Purpose** (what it is and its boundary), **Run**
  (the exact command(s) to start/build it locally), and **Test** (the exact command to run its
  tests). *Verify:* a CI/presence check enumerates every workspace in the monorepo root manifest and
  asserts each has a `README.md` containing headings matching purpose/run/test; missing or
  incomplete README fails the check. Spot-check: run the documented Run and Test commands verbatim
  and confirm they execute.

- **SPEC-10.R2 — Runbooks for operational procedures.** `[L2]`
  Every module that can be deployed, invoked against a live system, or requires recurring operator
  action has a runbook (in `docs/runbooks/<module>.md` or a `## Runbook` section) documenting: start
  and stop, health check, common failures with remediation, and who/what to escalate to. *Verify:*
  presence-checked — for each service listed in the deploy/environment matrix (see SPEC-12.R3), a
  runbook file exists and contains the four named sections; assert by a test that lists services and
  greps for the required headings.

- **SPEC-10.R3 — ADRs for material decisions.** `[L2]`
  Architecturally significant decisions (module boundaries, persistence choice, auth model, adopting
  or dropping a dependency, cross-module contract changes) are recorded as numbered ADRs in
  `docs/adr/NNNN-*.md` using a fixed template (Context / Decision / Status / Consequences). Each ADR
  has a status of Proposed, Accepted, Superseded, or Deprecated; superseding ADRs link to the ADR
  they replace. *Verify:* the `docs/adr/` directory exists with ≥1 conformant ADR; a lint asserts
  every ADR file has the four template headings and a valid Status value, and that no ADR is silently
  deleted (superseded, not removed).

- **SPEC-10.R4 — Onboarding path is a single documented entry point.** `[L2]`
  A single top-level document (repo `README.md` or `docs/onboarding.md`) links, in order, the steps a
  new contributor follows to get from clone to a green local test run: prerequisites, install,
  build, run, test, and where the spec library / ADRs live. *Verify:* the onboarding doc exists and
  its documented command sequence, executed on a clean checkout, reaches a passing test run; the
  links it contains resolve (link-check passes).

- **SPEC-10.R5 — Docs freshness policy with a staleness signal.** `[L3]`
  Documentation carries a freshness contract: reference docs that describe an interface are updated
  in the same change that alters the interface, and long-lived docs carry a "last reviewed" date or
  are covered by a check that flags drift. *Verify:* machine-enforced — e.g., a CI rule fails when a
  public API/CLI/route surface changes without a corresponding docs diff, and/or a scheduled check
  flags docs whose "last reviewed" date exceeds the policy window. The rule and its window are
  themselves documented.

- **SPEC-10.R6 — Session logs and planning notes are not documentation.** `[L2]`
  Ephemeral artifacts — session logs (`session-*.md`), scratch planning notes, `NEXT_STEPS`/agent
  hand-off files — are stored in a location distinct from durable documentation and are never the
  sole source of a module's purpose/run/test or an operational procedure. *Verify:* the presence
  checks for R1–R3 target the durable docs locations only; a review item confirms no runbook or
  README requirement is satisfied by pointing at a dated session log.

- **SPEC-10.R7 — Generated docs are reproducible, not hand-copied.** `[L1]`
  Any documentation derived from code (API references, CLI help, config schemas, diagrams rendered
  from source) is produced by a documented, re-runnable command rather than manually transcribed.
  *Verify:* the generation command is recorded (in the doc header or build scripts) and re-running it
  produces no unexpected diff; a reviewer can regenerate from source.

## Anti-patterns

- **Module with no README.** A shippable workspace (e.g., a service with a `package.json` and a
  build) has no `README.md`, so its purpose and run/test commands live only in a maintainer's head.
- **Session notes mistaken for docs.** `AGENTS.md`, `NEXT_STEPS.md`, or dated `session-*.md` logs are
  treated as the module's documentation; a newcomer reads yesterday's stream-of-consciousness instead
  of a purpose statement.
- **Runbooks absent.** A service that runs live cmdlets or holds state has no start/stop/health/
  failure guidance; operations is tribal knowledge recovered under incident pressure.
- **Decisions with no trail.** A significant choice (why SQLite, why this auth seam) is undocumented;
  the next agent re-litigates it or unknowingly reverses it.
- **Stale reference docs.** The README's documented commands or the API reference describe an
  interface that no longer exists; docs actively mislead because nothing fails when code drifts.
- **README theatre.** A README exists but contains only a title and a badge — no purpose, no run, no
  test — passing a naive "file exists" check while conveying nothing.
- **Hand-copied generated content.** API/CLI/config docs are pasted screenshots or transcriptions
  that silently diverge from the code they claim to describe.

## Conformance checklist

- [ ] Does every workspace/module in the root manifest have a `README.md` covering purpose, run, and
  test, verified by a presence check? (R1)
- [ ] Do the documented run and test commands actually execute on a clean checkout? (R1, R4)
- [ ] Does every deployable/live-acting module have a runbook covering start/stop, health, common
  failures, and escalation? (R2)
- [ ] Do material decisions have numbered ADRs using the fixed template with a valid Status, and are
  superseded ADRs linked rather than deleted? (R3)
- [ ] Is there a single onboarding entry point whose command sequence reaches a green test run and
  whose links resolve? (R4)
- [ ] Is there a machine-enforced freshness signal (docs-with-code gate or last-reviewed check) with
  a documented window? (R5)
- [ ] Are session logs / planning notes kept separate and never the sole source for R1–R3? (R6)
- [ ] Is code-derived documentation produced by a re-runnable command rather than transcribed? (R7)

## CES profile hooks

- **Target level:** the CES profile sets SPEC-10 to **L2 with R1+R2 mandatory per module** — every
  CES workspace (`ces-shared`, `ces-stamper`, `ces-eo`, `ces-ao`, `ces-planner`) must carry a README
  (purpose/run/test) **and** a runbook, because each is independently runnable against operator or
  live-tenant surfaces. (Baseline observation: only `ces-planner` and `ces-stamper` currently have
  READMEs; `ces-eo`, `ces-ao`, `ces-shared` are R1 gaps.)
- **Tighten:** R6 is emphasized for CES specifically — the repo accumulates `session-*.md` logs and
  planning `.md` files at root; the profile forbids these from satisfying any R1–R3 requirement.
- **Tighten (candidate L3):** R5 is a stretch target — CES routes/CLI surfaces (EO/AO servers, `ao`
  CLI) should gate on docs-with-code once the README/runbook baseline (R1/R2) is closed.
- **Waive:** none. Documentation requirements apply to every module including the offline Planner.
