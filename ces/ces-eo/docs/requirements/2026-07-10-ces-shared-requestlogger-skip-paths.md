# Requirement: `skipPaths` option for `requestLogger` (against ces-shared)

- **Filed from:** ces-eo, 2026-07-10
- **Target:** `ces-shared/src/observability/requestLogger.ts`
- **Status:** OPEN — awaiting a ces-shared session to implement

## Problem

`requestLogger(service)` logs one structured JSON line per request with no way to exempt
paths. Health-check pollers (the EO GUI hits `GET /api/health` every ~30s, mostly `304`)
flood stdout and drown out real traffic. Every CES server that adopts the observability
floor (G-ENG-6) and has a poller will hit the same problem.

## Workaround currently in ces-eo (remove when this ships)

`ces-eo/src/eo/server/EoServer.ts` (~line 190) wraps the middleware locally:

```ts
const logRequests = requestLogger('evidence-ops');
app.use((req, res, next) => {
  if (req.path === '/api/health') return next();
  logRequests(req, res, next);
});
```

Side effect of the workaround: exempted requests also skip request-ID assignment. The
shared implementation should do better (see below).

## Proposed API (backward compatible)

```ts
export interface RequestLoggerOptions {
  /** Exact request paths to exclude from the completion log line. */
  skipPaths?: string[];
}

export function requestLogger(service: string, options?: RequestLoggerOptions)
```

- `requestLogger('evidence-ops')` — unchanged behavior (no new required args).
- `requestLogger('evidence-ops', { skipPaths: ['/api/health'] })` — skipped paths still
  get the request-ID assignment + `x-request-id` echo (correlation stays intact); only
  the `structuredLog('info', 'request', ...)` completion line is suppressed.
- Match against the path without query string. `ReqLike` has no `path` field, so derive
  it: `(req.originalUrl ?? req.url ?? '').split('?')[0]`.
- Keep it dependency-free and framework-agnostic per the file's existing design note.

## Consumers to update when implemented

- **ces-eo** `EoServer.ts` — replace the local wrapper with
  `requestLogger('evidence-ops', { skipPaths: ['/api/health'] })`.
- Any other CES server using `requestLogger` with a health/poll endpoint (check AO,
  Stamper GUI server, Planner, Muster) can adopt the option opportunistically.

## Acceptance

1. `/api/health` requests produce no `request` log line but still carry/echo
   `x-request-id`.
2. All other requests log exactly as today (same fields, same levels).
3. Zero-arg call sites compile and behave unchanged.
