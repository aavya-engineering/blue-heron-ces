# PLAN — G-MUSTER-P1 build (2026-07-07)

Entry: gate rows 3/4 overridden in writing — see `GATE_OVERRIDE_2026-07-07.md`.
Branch `g-muster-p1`. Scope = _goal-muster-p1.md IN-SCOPE list; OUT list is hard
(no CaptureRecipe/router/continuous-assurance/non-M365 playbooks — those are P2).

## Environment constraints (honest engineering)

- **No live Postgres on this machine.** Prisma schema/migrations stay
  Postgres-targeted (RLS in SQL). Service/route tests run against a mocked Prisma
  client (`tests/helpers/mockDb.ts`); RLS gets (a) a static test asserting the
  migration SQL contains ENABLE/FORCE + policies for parties/interview_sessions/
  contracts, and (b) a live integration test `describe.skipIf(!process.env.DATABASE_URL)`
  that proves cross-tenant denial when a real DB is configured.
- **Claude API via native fetch** (Node 24; no new deps). `ANTHROPIC_API_KEY` env;
  absent key → 503 `{degraded: true}` so the SPA falls back. Model:
  `claude-haiku-4-5-20251001` default, override via `CLAUDE_MODEL`.
- **Graph harvest** is a provider seam: `GraphClient` interface + `MockGraphClient`
  (mock-tenant integration test). Real OAuth endpoints exist but exchange only when
  `GRAPH_CLIENT_ID/SECRET/TENANT` are configured.

## API contract (SPA codes against this; api slices implement it)

Base `/api`. Auth: `Authorization: Bearer <jwt>` (existing bearerAuth). Roles:
prime | sub | bhd_operator | assessor_read_only.

- `POST /auth/login`, `GET /auth/me` (exists)
- `GET|POST /engagements`, `GET /engagements/:id` (kind immutable — no PUT on kind)
- `GET|POST /engagements/:id/parties`, `GET /parties/:id`
- `GET|POST|PUT|DELETE /contracts`, `GET /contracts/:id` — 14 named fields;
  attach to party; for individual_contractor engagements party IS the contractor
  (prime_ref null semantics).
- `POST /sessions/sync` — SPA pushes Dexie session (facts/timing/stacks/status);
  upsert by id. `GET /sessions/:id`.
- `GET /engagements/:id/progress` — EngagementProgress: per-party 8-state lifecycle
  (invited → in_progress → stalled → complete → ready | validate | convert_to_enclave
  | reassessment_due, plus abandoned/opted_out terminals) + counts.
- `POST /parties/:id/actions/:action` — send-nudge-now | mark-abandoned |
  disposition-ready | disposition-validate | convert-to-enclave |
  schedule-reassessment | opt-out. Writes Disposition + lifecycle transition.
- `POST /nudges/tick` (bhd_operator; `{now?: ISO}` for simulated clock) — evaluates
  T+3/7/14, stall detection, escalation digest; returns fired events.
- `GET /hil/queue`, `POST /hil/queue/:id/resolve` (advisor timing captured start→resolve).
  Routing rule (exact): fact confidence === 'low' AND weight >= 3 → queue;
  sub-initiated flag → queue regardless of weight.
- `POST /interview/adaptive/next` — body {sessionId, priorFacts, stacks}; returns
  {question|null, provenance:'ai_adaptive', degraded:false} or 503 {degraded:true}.
- `POST /coach/chat` — body {sessionId, messages[]}; streams not required; 503 when degraded.
- `GET /harvest/consent-url`, `POST /harvest/callback`, `POST /harvest/run` —
  returns machine facts {question_id, answer, provenance:'auto_detected',
  confidence:'high', captured_at, source:'graph:<probe>'}.
- `GET /sprs/:sessionId` and pure `POST /sprs/score` {facts,stacks} → {sprs: -203..110}.
- `POST /touch/events` {mode:'a'|'c', engagement_id, minutes?, kind} + `GET /touch/report`
  — mode-(a) BHD-touch log (bar: 0 post-onboarding), mode-(c) per-escalation timer.

## Slices

S1 api domain core → S2 nudges → S3 Claude routes → S5 harvest → S6 SPRS (api);
S4 SPA (parallel after contracts pinned). Each slice: green `npm test` (root + api),
lint clean on `src`/`muster-api/src`/`e2e`, drift 26/26, then commit.

## Conventions for implementers

- muster-api: routers in `src/routes/<name>.ts`, services in `src/services/<name>.ts`
  (pure logic, injectable `db` + `now()` for simulated clocks), Zod validation,
  wire into `src/app.ts`. Tests in `muster-api/tests/*.test.ts`, no live DB.
- SPA: features under `src/features/<name>/`; reuse ces-ui classes + muster.css;
  zero-network guardrail applies to the OFFLINE interview path only — networked
  adaptive mode is explicitly P1 scope, but the static-graph fallback must still
  pass the DW#5 no-network test unchanged.
- FCA: any AI/harvest-derived fact with answer 'unknown'/'unsure' scores as not-passed;
  disclaimer stays on results; conservative score only.
- Label business assumptions [validate with BHD] at point of use.
