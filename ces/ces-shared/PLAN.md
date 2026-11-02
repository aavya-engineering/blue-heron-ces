# Plan: `skipPaths` option for `requestLogger`
**Date:** 2026-07-10
**Status:** READY FOR IMPLEMENTATION

## Objective
Add a backward-compatible `options?: { skipPaths?: string[] }` parameter to
`requestLogger(service)` in `src/observability/requestLogger.ts` so servers can
suppress the completion log line for noisy paths (e.g. health-check pollers)
while still assigning/echoing the request ID on every request.

## Context Summary
- **From Review:** N/A (no REVIEW.md; single well-scoped file, reviewed by inspection).
- **From Research:** N/A (no RESEARCH_SUMMARY.md; no external libraries involved).
- **Constraints:**
  - Module must stay dependency-free and framework-agnostic (local `ReqLike`/`ResLike`, no express types).
  - `structuredLog` and the middleware must never throw.
  - Zero-arg call sites (`requestLogger('service')`) must compile and behave unchanged.
  - Skipped paths still get request-ID assignment + `x-request-id` echo; only the
    `structuredLog('info', 'request', ...)` line on `res.on('finish')` is suppressed.
  - Path match is exact, against `(req.originalUrl ?? req.url ?? '').split('?')[0]`
    (no query string, no prefix/glob matching — per requirement doc).
  - All file changes confined to `ces-shared`. Consumer updates (ces-eo `EoServer.ts`,
    ces-ao, ces-stamper) are out of scope — filed as follow-up notes below.

## Implementation Steps
1. **`src/observability/requestLogger.ts`** —
   - Add and export `RequestLoggerOptions` interface: `{ skipPaths?: string[] }`.
   - Change signature to `requestLogger(service: string, options?: RequestLoggerOptions)`.
   - Inside the returned middleware, compute `const path = (req.originalUrl ?? req.url ?? '').split('?')[0];` once, before request-ID assignment logic (unchanged) runs.
   - Compute `const skip = options?.skipPaths?.includes(path) ?? false;` (use a `Set` only if simpler; array `.includes` is fine given typically small lists — keep dependency-free, no new imports).
   - Keep request-ID assignment (`req.requestId`, inbound `x-request-id` honor, `res.setHeader('x-request-id', ...)`) unconditional — runs regardless of `skip`.
   - Wrap only the existing `res.on('finish', () => structuredLog('info', 'request', {...}))` callback body in `if (!skip) { ... }` (or guard at the top of the callback with an early `return` when `skip` is true).
   - Preserve "never throws" behavior: no new code path should introduce a throw; `options` access uses optional chaining so a missing/malformed `options` object degrades to no-op skip list.
   - Update the JSDoc comment above `requestLogger` to document the new parameter and skip semantics.

2. **`src/observability/requestLogger.test.ts`** (NEW) —
   First test file for this module (vitest, colocated `*.test.ts` convention per
   `src/http/bearerAuth.test.ts`). Use lightweight fake `ReqLike`/`ResLike` objects
   (no express dependency) and spy on `console.log`/`process.stdout.write` (whichever
   `structuredLog` uses — confirm by reading the file during implementation) to assert
   whether a `request` line was emitted. Cover the three acceptance criteria:
   - **AC1 (skip suppresses log, keeps request-id):** call `requestLogger('svc', { skipPaths: ['/api/health'] })`, simulate a request to `/api/health` (with and without a query string, e.g. `/api/health?x=1`), trigger `res.on('finish')`. Assert no `structuredLog('info','request',...)` output occurred, `req.requestId` was set, and `res.setHeader` was called with `x-request-id`.
   - **AC2 (non-skipped paths unchanged):** same setup, request a different path (e.g. `/api/widgets`). Assert the completion log line IS emitted with expected fields (service, requestId, method, path, status, ms).
   - **AC3 (zero-arg compiles/behaves unchanged):** call `requestLogger('svc')` with no options, simulate a request to any path including `/api/health`. Assert the completion log line IS still emitted (no skipping without explicit `skipPaths`) — proves backward compatibility.
   - Bonus/edge case (optional, cheap to add): inbound `x-request-id` header is honored and echoed even on a skipped path.

## File Inventory
| File | Action | Lines/Functions Affected |
|------|--------|---------------------------|
| `src/observability/requestLogger.ts` | MODIFY | Add `RequestLoggerOptions` export; change `requestLogger(service)` signature (~L36) to accept `options?`; add path-skip guard around the `structuredLog('info','request',...)` call inside `res.on('finish', ...)`; update JSDoc |
| `src/observability/requestLogger.test.ts` | CREATE | New file — AC1/AC2/AC3 coverage per above |

## Architecture Decisions
- **Exact string match, not prefix/glob:** Matches the requirement doc precisely
  (`skipPaths.includes(path)`); avoids adding matching complexity/deps not asked for.
- **Compute path via existing derivation formula:** Reuses `(req.originalUrl ?? req.url ?? '').split('?')[0]` exactly as specified, so behavior matches what the `path` field already logs (before the split), keeping semantics consistent between the skip check and the logged `path` value.
- **Guard only the log emission, not request-ID logic:** Directly satisfies the
  "should do better" note in the requirement (the ces-eo workaround's flaw was losing
  request-ID assignment on skipped paths).
- **No new dependency, no new exported helper for path extraction:** Keep the module
  single-file and dependency-free per its design note; inline the derivation.

## Testing Strategy
- New `requestLogger.test.ts` using vitest (`describe`/`it`/`expect`, matching repo's
  existing vitest conventions).
- Fake `ReqLike`/`ResLike` implementations constructed inline in the test file (no
  express, no supertest) — call the middleware function directly, then manually invoke
  the registered `'finish'` callback to simulate response completion.
- Spy/capture whatever output stream `structuredLog` writes to (read the current
  implementation first to confirm stdout vs `console.log`) rather than assuming.
- Confirm no regression by running full suite, not just the new file.

## Out of Scope
- Updating `ces-eo/src/eo/server/EoServer.ts` to adopt `skipPaths` (separate repo,
  separate change — filed as a follow-up against ces-eo).
- Updating `ces-ao`'s `quietRequestLogger.ts` or `ces-stamper`'s `GuiServer.ts` to use
  the new option — opportunistic follow-ups, not required by this task.
- Prefix, glob, or regex path matching — only exact string match per requirement.
- Any change to `structuredLog` itself, `LogFields`, or `LogLevel`.
- Any change to request-ID generation/propagation logic beyond leaving it unconditional.

## Verification Commands
```
npm test
npm run build
```
Both must pass. `npm test` runs vitest (including the new `requestLogger.test.ts`
plus all existing tests, e.g. `src/http/bearerAuth.test.ts`) with no regressions.
`npm run build` (tsc + copy-data.cjs) must succeed, confirming the `./observability`
subpath export (`./dist/observability/requestLogger.js`) still compiles cleanly and
that the new `RequestLoggerOptions` type is exported without breaking `dist/` output.

## Acceptance Criteria
- [ ] `requestLogger(service, { skipPaths: [...] })` compiles; `RequestLoggerOptions` is exported.
- [ ] A request to a path in `skipPaths` (matched without query string) produces no
      `structuredLog('info','request',...)` line, but still gets `req.requestId`
      assigned and `x-request-id` echoed via `res.setHeader`.
- [ ] A request to a path NOT in `skipPaths` logs exactly as before (same fields/levels).
- [ ] `requestLogger('service')` (zero-arg / no options) compiles and behaves exactly
      as it did before this change — no skipping occurs.
- [ ] `requestLogger.test.ts` exists and covers all three acceptance criteria above.
- [ ] `npm test` passes (new + existing tests, including `bearerAuth.test.ts`).
- [ ] `npm run build` passes.
- [ ] Module remains dependency-free and framework-agnostic; logging still never throws.
