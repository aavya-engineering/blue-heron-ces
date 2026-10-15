# SPEC-12 — Deployment & Operations (v1.0)

## Intent

A system is only as good as the reliability with which it can be stood up, changed, and — when a
change goes wrong — reversed. This spec makes deployment a repeatable, documented procedure per
module rather than a remembered ritual: an install/deploy story, a tested rollback, a named set of
environments (dev / CI / live) with explicit differences, a register of every manual step that
someone must perform by hand, and a backup/restore that has actually been exercised. It aligns with
the operational discipline behind change management and SRE practice — every change is reversible,
every environment is described, and toil (manual steps) is tracked so it can be eliminated. The
failure modes it prevents are the classic ones: a deploy that only its author can perform, a
"we've never rolled back" system that discovers its rollback is broken during an incident, undocumented
drift between what CI tests and what runs live, manual steps that live only in someone's memory, and
backups that cannot be restored.

## Requirements

- **SPEC-12.R1 — Deploy/install story per module.** `[L2]`
  Each deployable module has a documented, repeatable procedure to install/build and start it in a
  target environment, expressed as commands or scripts (not prose that requires interpretation).
  *Verify:* the procedure exists (runbook/README/deploy script per SPEC-10.R2) and a reviewer,
  following it verbatim on a clean environment, brings the module to a healthy state; the start and
  health-check commands are the ones documented.

- **SPEC-12.R2 — Rollback procedure exists and is tested.** `[L2]`
  Every deploy has a defined way to return to the previous known-good state (redeploy prior artifact,
  reverse migration, restore snapshot), and that path has been exercised at least once — not assumed.
  *Verify:* a documented rollback procedure exists per module; an exercise/test demonstrates a
  deploy-then-rollback returning to the prior working state (including data compatibility). A module
  whose rollback is untried fails this requirement.

- **SPEC-12.R3 — Environment matrix (dev / CI / live) is documented.** `[L2]`
  The set of environments is named and described in one place, listing for each: how it is reached,
  what config/secrets it uses, what data it touches, and how it differs from the others. *Verify:* an
  environment matrix document exists enumerating dev, CI, and live (and any others), cross-referencing
  the config layer (SPEC-08); a reviewer can answer "what changes between CI and live" from the doc
  alone. Presence-checked; the environments it names match those the deploy scripts target.

- **SPEC-12.R4 — Manual steps are registered.** `[L3]`
  Every step in bringing up or operating the system that is not automated (certificate provisioning,
  a one-time console setting, a tenant-consent grant) is listed in an explicit manual-step register,
  with owner and trigger. Nothing required to run the system lives only in memory. *Verify:*
  machine-checkable presence — a `manual-steps` register exists and is referenced by the deploy
  runbooks; a review item confirms no runbook prose contains an unregistered "you also have to…"
  step. Ideally the register is the single source the deploy checklist iterates.

- **SPEC-12.R5 — Environment promotion is gated, not ad hoc.** `[L2]`
  Moving an artifact from CI toward live follows a defined promotion path with gates (tests/build
  green, approval where required) rather than copying files by hand from a developer machine.
  *Verify:* the promotion path is documented and tied to CI gates (SPEC-07); artifacts reaching live
  are the ones CI produced/tested, evidenced by build provenance or a release checklist. No
  "built on my laptop" path to live.

- **SPEC-12.R6 — Backup and restore are documented and exercised.** `[L2]`
  There is a documented procedure to back up all durable state (database + paired artifact/blob
  storage) and to restore it, and the restore has been performed at least once to prove it works.
  *Verify:* backup/restore procedure exists; an exercise restores a captured backup into a working
  environment and validates integrity (cross-ref SPEC-11.R8 — evidence hashes re-verify post-restore).
  Backup coverage includes the blob artifacts, not only the DB.

- **SPEC-12.R7 — Health and readiness are observable at deploy time.** `[L1]`
  Each service exposes a way to confirm it started correctly (health/readiness endpoint or documented
  check) so a deploy can be validated rather than assumed. *Verify:* the documented health check
  returns success against a freshly deployed instance; the deploy procedure (R1) references it as the
  success criterion.

## Anti-patterns

- **No rollback procedure.** The team has never rolled back and has no documented way to; the first
  bad deploy under pressure is also the first rollback attempt, and it fails (e.g., a forward-only
  migration with no reverse and no snapshot).
- **Snowflake deploy.** Only one person can deploy because the "procedure" is undocumented steps in
  their shell history; their absence blocks releases.
- **Undocumented environment drift.** CI tests against config that differs from live in unrecorded
  ways (ports, auth mode, data store), so "green in CI" does not predict "works in live."
- **Manual steps unregistered.** A live bring-up silently requires a certificate upload, a tenant
  admin-consent grant, or a one-time portal toggle that appears in no register; a fresh install mysteriously
  fails until someone remembers.
- **Built-on-my-laptop promotion.** Artifacts are hand-copied to live instead of promoted from the
  CI-produced, tested build, so what runs live was never the thing that was tested.
- **Backups never restored.** Backups run nightly but no restore has ever been attempted; the blob
  artifacts were never included, and the DB alone restores to a broken state.
- **Assumed-healthy deploy.** No health/readiness check, so a service that crashed on startup is
  believed deployed until users report errors.

## Conformance checklist

- [ ] Does each deployable module have a documented, repeatable install/deploy procedure that reaches
  a healthy state when followed verbatim? (R1)
- [ ] Is there a documented rollback procedure per module that has actually been exercised? (R2)
- [ ] Is there an environment matrix naming dev/CI/live with each one's reach, config, data, and
  differences? (R3)
- [ ] Is there a manual-step register (owner + trigger) that captures every non-automated step, with
  no unregistered steps hiding in runbook prose? (R4)
- [ ] Is promotion to live gated on CI (tested artifact promoted, not hand-copied)? (R5)
- [ ] Is there a documented backup/restore that has been exercised, covering DB **and** artifacts,
  with integrity re-verified post-restore? (R6)
- [ ] Does each service expose a health/readiness check used as the deploy success criterion? (R7)

## CES profile hooks

- **Target level: L2, with explicit rationale (pre-SaaS).** CES is **operator-local and pre-SaaS**;
  per `docs/saas-readiness.md` the EO/AO Express servers and Stamper run on a single operator
  workstation with a local SQLite `ces.db` and local artifacts. The profile therefore targets **L2**
  (deploy/rollback/env-matrix/backup documented, consistent, and exercised for the operator-local
  model) rather than L3 (containerized, automated promotion, orchestrated blue/green) — L3 deployment
  automation is deferred until hosted multi-tenant demand justifies it. This waiver is cited, not
  implicit.
- **Tighten — R4 to L3 (manual-step register mandatory).** CES has irreducible manual steps that gate
  live operation — certificate-based auth setup for live cmdlet execution, tenant admin-consent
  grants, GCC High endpoint/egress configuration. These MUST be captured in a manual-step register;
  an unregistered manual step is a hard fail because it directly blocks live-tenant execution.
- **Tighten — R6 pairs with SPEC-11.** Backup/restore MUST include the evidence blob artifacts (not
  only `ces.db`) and re-verify evidence content hashes post-restore (SPEC-11.R3/R4/R8), since evidence
  integrity is the product's core guarantee.
- **Acknowledge — R5 promotion is lightweight today.** With a single operator target, "promotion" is
  the documented build:core + release-checklist path, not a multi-stage orchestrator; the L2 target
  accepts this. Revisit at containerization (saas-readiness phase 1).
- **Waive — none outright.** The L2 target itself is the scoping mechanism; individual requirements
  are met at operator-local scale, with R4 and R6 tightened as above.
