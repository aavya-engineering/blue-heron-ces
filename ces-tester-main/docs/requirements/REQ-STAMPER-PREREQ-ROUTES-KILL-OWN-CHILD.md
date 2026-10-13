# REQ-STAMPER-PREREQ-ROUTES-KILL-OWN-CHILD

**Filed by:** ces-tester (GP-DEMO-3, M0 drivability spike)
**Date:** 2026-08-29
**Against:** `ces-stamper`
**Severity:** HIGH — the two self-service remediation endpoints in the Stamper GUI's
prerequisite panel are 100% non-functional on Node >= 16. Every user who hits a missing
module or a missing certificate is told the fix failed, and no fix ever runs.
**Status:** OPEN — ces-tester is boundary-bound (read-only on siblings) and will NOT patch this.

## Summary

`POST /api/prereqs/import-cert` and `GET /api/prereqs/install` both spawn a PowerShell
child and then register `req.on('close', () => kill())`. On Node >= 16 the server-side
`IncomingMessage` emits `'close'` **when the request is complete** — not only when the
client disconnects. For these two routes the request is complete the moment the (tiny or
empty) body has been read, i.e. within milliseconds of the handler starting. `kill()`
therefore lands on the freshly spawned PowerShell process immediately, it exits non-zero
without doing anything, and the route reports `success: false`.

## Evidence (measured, not inferred)

Stamper GUI booted from ces-tester (`stamper gui --port 3000`, cwd = ces-stamper root,
Node v24.12.0), a valid self-signed PFX on disk, correct password, target store empty:

```
store before: ABSENT
elapsed to full SSE body: 24 ms
data: {"type":"install_progress","module":"Certificate","message":"Importing certificate from ...\sim.pfx..."}
data: {"type":"install_done","module":"Certificate","success":false}
store immediately after: ABSENT
store after +4s:        ABSENT
```

**24 ms** is well below PowerShell 5.1's startup time — the child cannot have completed an
import. The absence of an `ERROR: ...` progress line rules out a spawn failure
(`proc.on('error')` would have emitted one, `PrerequisiteChecker.ts:219-222`), so the child
started and was then killed.

**Control — the identical command succeeds outside the route.** Same machine, same user,
same PFX/password, and the *same child env the GUI server runs under* (stacksim-shadowed
`PSModulePath` + ces-tester's `Microsoft.Graph` shim), spawned from Node exactly as
`PrerequisiteChecker.importCertificate` does:

```
EXIT 0
   PSParentPath: Microsoft.PowerShell.Security\Certificate::CurrentUser\My
Thumbprint                                Subject
2F916D65470F7E8DD5B8ABB2860757E0A21F2323  CN=ces-tester-sim
```

So neither the command, the password escaping, the env, nor the store permissions are at
fault. Only the route is.

## Code path

| File | Line | Detail |
|---|---|---|
| `ces-stamper/src/server/routes/connect.routes.ts` | 257-291 | `POST /api/prereqs/import-cert` |
| `ces-stamper/src/server/routes/connect.routes.ts` | 285-287 | `req.on('close', () => { kill(); });` — the defect |
| `ces-stamper/src/server/routes/connect.routes.ts` | 226-255 | `GET /api/prereqs/install` |
| `ces-stamper/src/server/routes/connect.routes.ts` | 245-247 | same `req.on('close')` pattern — **same defect, module installs are also dead** |
| `ces-shared/src/prereq/PrerequisiteChecker.ts` | 191-231 | `importCertificate()` — correct as written; the `kill` seam is simply called too early |
| `ces-shared/src/prereq/PrerequisiteChecker.ts` | 225-227 | `kill = () => proc.kill()` |
| `ces-stamper/public/index.html` | 6479-6540 | `importPrereqCert()` — renders the resulting `success:false` as a `Retry` button |

Note `GET /api/prereqs/install` is if anything *worse*: a GET has no request body at all, so
`'close'` fires on the very first tick.

## Impact on ces-tester (GP-DEMO-3)

FD-5(b) of `docs/demo/PLAN-E2E-AO-DEMO.md` (founder-ruled 2026-08-29) directs the demo's sim
certificate into `Cert:\CurrentUser\My` **through the Stamper GUI's own
`POST /api/prereqs/import-cert`**, Playwright-driven, precisely so the fix is GUI-native.
That route cannot work. The demo therefore falls back to FD-5's own stated alternative
**(i) "a ces-tester setup script does it"** — the fallback the plan already sanctions, and
invisible setup outside the demo frame, so the all-Playwright mandate is untouched (the
demo surface remains Connect → Assess → Translate → Execute in the GUI). **Flagged, not
silently swapped.**

## Suggested fix (for ces-stamper to apply — NOT applied by ces-tester)

Bind the abort to a real client disconnect rather than request completion. Either:

- gate on `res`: `res.on('close', () => { if (!res.writableEnded) kill(); })`; or
- gate on the socket: `req.socket.on('close', ...)`; or
- keep `req.on('close')` but guard it — `if (!settled) kill();` where `settled` is set in
  `promise.then(...)`.

The same change is needed at both call sites. A regression test should assert that a
successful import returns `success: true` and that the certificate is actually present in
the store afterwards — the current shape can never distinguish "killed" from "failed".

## Cross-reference

- `docs/demo/PLAN-E2E-AO-DEMO.md` FD-5 (ruled 2026-08-29)
- `docs/demo/E2E-GROUNDING-EVIDENCE.md` (companion appendix)
- `docs/context/IMPLEMENTATION_LOG.md` — GP-DEMO-3 M0 section, spike (b)
- Evidence artifacts: `runs/m0-spike/m0-001/stamper/import-cert-diag.txt`
