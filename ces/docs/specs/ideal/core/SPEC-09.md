# SPEC-09 — Observability (v1.0)

## Intent

Observability is the ability to answer "what is the system doing, and why did that request fail?"
from its emitted signals alone — without attaching a debugger to production. This dimension defines
the floor: structured logging with severity levels and a request/correlation ID that threads a
single operation across modules; an audit trail for privileged actions; health endpoints; failure
metrics and alerting for asynchronous jobs; and — non-negotiably — **no silent error swallowing**.
It is anchored in the industry's **"three pillars of observability"** (logs, metrics, traces) and in
**OpenTelemetry**-style context propagation, where a correlation/trace ID is attached at the edge and
carried through every downstream call and log line so one failed operation can be reconstructed
end-to-end. A `catch` block that logs a warning and continues, an async job that runs with no record
of its last outcome, or a fire-and-forget POST whose failure is discarded are all observability
holes that turn a five-minute triage into a code-reading expedition.

## Requirements

- **SPEC-09.R1 — Structured logging with severity levels.** *(L2)*
  Logs are emitted through a logging library as structured records (JSON or key-value) with an explicit
  level (debug/info/warn/error), not free-form strings.
  **Verify:** a logger is configured with levels and structured output; sampled log lines are parseable
  records carrying a `level` field, not bare `console.log("...")` text.

- **SPEC-09.R2 — One logging path; no `console.*` sprawl.** *(L2)*
  The module logs through a single logger; direct `console.*` calls are absent from application code
  (permitted only in CLIs' explicit user-facing output paths), and no logging library is imported but
  unused.
  **Verify:** `grep -rn "console\." src` returns zero outside declared CLI output; the imported logger
  is actually used (no `import winston` with zero call sites).

- **SPEC-09.R3 — Request / correlation IDs propagated.** *(L3)*
  Every inbound request is assigned (or inherits) a request ID that is attached to all log lines for
  that operation and forwarded on downstream calls between modules.
  **Verify:** middleware assigns a request ID; log lines for one request share the ID; a cross-module
  call (e.g. EO → Stamper capture) forwards the ID in a header, visible in both sides' logs.

- **SPEC-09.R4 — Audit trail for privileged actions.** *(L3)*
  Every privileged/state-changing action (admin command execution, approval decision, tenant config
  change, evidence capture) writes a durable audit record: who, what, when, target, outcome.
  **Verify:** privileged handlers emit an audit record with actor identity, action, timestamp, target,
  and result; the record is persisted (not just logged to stdout) and survives restart.

- **SPEC-09.R5 — Health endpoints.** *(L2)*
  Each long-running service exposes a health endpoint reporting liveness and key dependency/readiness
  status.
  **Verify:** a `GET /api/health` (or equivalent) exists and returns a status payload; it reflects
  degraded state when a critical dependency is down, not a constant `200 OK`.

- **SPEC-09.R6 — Failure metrics and alerting for async jobs.** *(L3)*
  Scheduled/background jobs record run outcomes as metrics (success/failure counts, last-run
  timestamp) durably, and a failure crosses a threshold into an alert rather than passing unnoticed.
  **Verify:** an async job persists its last-run status and increments a failure metric on error; a
  forced failure produces a durable failure record / alert signal, not silence.

- **SPEC-09.R7 — No silent error swallowing.** *(L2)*
  Caught errors are either handled meaningfully, rethrown, or logged at `error` level with context;
  no `catch {}` empties, and failures are not downgraded to `warn` and discarded.
  **Verify:** `grep` for empty catch blocks returns zero; error paths log at `error` with the error and
  correlating context; fire-and-forget calls handle rejection instead of dropping it.

- **SPEC-09.R8 — Async job state is durable, not in-memory.** *(L2)*
  Background job scheduling/last-run state persists across process restarts rather than living only in
  a process variable.
  **Verify:** last-run/next-run state is written to storage; after a restart the job's history is
  intact, not reset to zero.

## Anti-patterns

- **Winston imported but unused.** A logging library is a dependency and imported, yet the code logs
  through `console.*` anyway (fails R1, R2). *This is the current CES EO posture — winston imported,
  `console.*`-only in practice.*
- **`console.*` sprawl.** Logging is scattered raw `console.log`/`console.error` with no levels or
  structure (fails R1, R2). *CES AO has ~4 total `console` calls and near-no structured logging;
  planner logs ad hoc.*
- **No request IDs.** No correlation ID exists, so a single failed request cannot be traced across the
  EO → Stamper capture boundary (fails R3). *CES has no request IDs in any module.*
- **Ops audit gap.** Evidence capture is richly audited (SHA-256 + `executorIdentity` + controlIds)
  because evidence *is* the product, but ordinary privileged ops (approvals, tenant config) leave no
  durable trail (fails R4). *CES: audit is strong where evidence is the product, absent for ops.*
- **Silent async job.** A scheduled signal-capture job runs with no success/failure metric and its
  `lastCaptureRun` lives only in memory — a restart erases the history and a failed run is invisible
  (fails R6, R8). *This is the current CES EO scheduled-signal-capture behavior.*
- **Swallowed POST failure.** A fire-and-forget `POST /api/stamp-capture` discards its rejection, so a
  dropped evidence capture surfaces as nothing (fails R7). *CES `EvidenceOpsClient` fires and forgets.*
- **Constant-200 health check.** A health endpoint returns `200` unconditionally and never reflects a
  down dependency (fails R5).

## Conformance checklist

- [ ] Structured logging with explicit levels. (R1)
- [ ] Single logging path; no `console.*` sprawl; no unused logger import. (R2)
- [ ] Request/correlation IDs assigned and propagated cross-module. (R3)
- [ ] Durable audit trail for privileged/state-changing actions. (R4)
- [ ] Health endpoint reflects real dependency status. (R5)
- [ ] Async jobs emit failure metrics + alerting. (R6)
- [ ] No empty catches; no failures downgraded to warn-and-discard. (R7)
- [ ] Async job state persists across restart. (R8)

## CES profile hooks

- **CES observability floor (the profile's headline target for this dimension): request IDs +
  privileged-action audit.** The profile sets a two-part floor every CES service must reach:
  1. **Request/correlation IDs (R3)** assigned at each server edge and forwarded across the EO → Stamper
     capture boundary, so one failed capture is traceable end-to-end. CES has none today.
  2. **Durable audit trail for privileged AO/EO actions (R4)** — AO command executions and approval
     decisions, EO tenant-config changes and evidence captures — recording actor, action, timestamp,
     target, and outcome. CES already audits evidence (SHA-256 metadata, `executorIdentity`); the
     profile **extends** that discipline to ops actions that currently leave no durable trail.
- **Converge the four postures onto one.** The recon finds four different CES logging postures
  (stamper winston-used; EO winston-imported-but-unused; planner console; AO near-nothing). The profile
  **tightens** all modules to R1+R2 — the stamper winston setup is the closest to the target and is the
  reference the others converge on.
- **Close the two named silent-failure holes.** The profile makes R6+R8 mandatory for EO's scheduled
  signal capture (persist `lastCaptureRun`, emit failure metric) and R7 mandatory for
  `EvidenceOpsClient`'s fire-and-forget POST (handle the rejection, do not drop a capture silently) —
  both flagged in the recon as concrete regressions.
- **Health (R5)** is a CES **L2 target**: EO and AO already expose `GET /api/health`; the tightening is
  to make those endpoints reflect real dependency/readiness state rather than a constant `200`.
