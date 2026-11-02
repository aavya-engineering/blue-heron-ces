# REQ-ces-shared-ec-launcher — point EcLauncher at the real EC entry (plan M4b)

**From:** ces-ec (EC-M2M3, 2026-09-28) · **To:** ces-shared · **Plan:** step 5 (M4b)
**Status:** OPEN — nothing in ces-shared was touched.

## Facts
- EC start command: `npx tsx src/index.ts` with **cwd = the ces-ec module root** (sibling of ces-shared). Verified by `ces-ec/test/entry.test.ts`, which spawns exactly this and polls `/api/health`.
- Port: `EC_PORT` (default 4001); bind host `EC_HOST` (default `127.0.0.1`). `/api/health` is always 2xx once listening, so the launcher's 2xx check is correct.
- `src/launcher/EcLauncher.ts` `spawnEc()` hardcodes `src/ec/index.ts` — **that path does not exist in ces-ec**. Both `command` and `cwd` must change.

## Asks
1. Parameterize `command` (default `['tsx','src/index.ts']` via `npx`) and `cwd` (default `CES_EC_CWD`, then `../ces-ec` relative to the caller's module root).
2. Add `EcLauncher.test.ts` with `http.get`/`spawn` mocked: healthy / spawn-then-healthy / timeout.
