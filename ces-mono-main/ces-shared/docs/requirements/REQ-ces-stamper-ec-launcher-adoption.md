# REQ: ces-stamper — fix its EcLauncher call site (wrong cwd) and opt into autostart explicitly

**Filed by:** ces-shared, feature completion FC-SH step 4, 2026-09-28
**Target module:** ces-stamper
**Priority:** P1 (the existing call site is broken today — spawns EC, if it spawns at all, in the wrong directory)
**Answers:** `../ces-ec/docs/requirements/REQ-ces-shared-ec-launcher.md`

## What changed in ces-shared (2.8.0)

`ensureEcRunning()` (`ces-shared/launcher`) is now parameterized instead of hardcoding a spawn target that never
existed in ces-ec (`src/ec/index.ts`):
- `command`/`args` default to `npx tsx src/index.ts` (the real ces-ec entry).
- `cwd` precedence: an explicit `cwd`, then `env.CES_EC_CWD`, then `../ces-ec` resolved relative to
  `process.cwd()`.
- **Autostart is now opt-in.** A caller only gets a health check unless `env.CES_EC_AUTOSTART === '1'`; without
  it, an unhealthy EC is left alone (`autostart_disabled` is returned, nothing is spawned).
- The legacy two-positional-argument call (`ensureEcRunning(ecUrl, ecCwd)`) still works and is equivalent to
  `ensureEcRunning({ ecUrl, cwd: ecCwd })` — `await`ed call sites that ignore the return value are unaffected by
  its new resolved type (`'already_running' | 'started' | 'autostart_disabled' | 'failed'`, was `void`).

## What's broken today in ces-stamper

`src/server/GuiServer.ts:304`:
```ts
await ensureEcRunning('http://localhost:4001', path.resolve(process.cwd(), '../eo'));
```
This passes `../eo` as the EC working directory — not `../ces-ec`. Whatever `../eo` resolves to (presumably meant
to be `ces-eo` or a leftover from before EC had its own module root), it is not where `src/index.ts` (ces-ec's
entry) lives. Under the fixed launcher's old hardcoded-path behavior this already couldn't have worked; nothing in
ces-shared could catch it because `cwd` was always whatever the caller passed.

## Asks

1. Fix the cwd: `await ensureEcRunning({ ecUrl: 'http://localhost:4001', cwd: path.resolve(process.cwd(), '../ces-ec') })`,
   or simply drop the second argument and set `CES_EC_CWD` in the environment, or rely on the new default (`../ces-ec`
   relative to Stamper's own module root) if Stamper's `process.cwd()` at that point is the Stamper module root.
2. Decide on autostart: set `CES_EC_AUTOSTART=1` in Stamper's environment/launch config to preserve the prior
   "always try to spawn EC if unhealthy" behavior, or leave it unset if Stamper would rather EC be started
   independently (e.g. by ces-ec's own process manager or the operator).
3. Update the log line / surrounding comment ("Evidence Collector auto-start check...") if the chosen behavior is
   now health-check-only.

## Acceptance

- Starting Stamper's GuiServer with EC not already running, and `CES_EC_AUTOSTART=1` set, spawns EC from the
  correct `ces-ec` module root and it becomes healthy.
- Starting it with `CES_EC_AUTOSTART` unset does not spawn a process (matches the new default posture) and
  GuiServer continues to start normally (this was already true before — EC failing to start was non-fatal).
