# REQ-TENANT-REACHPROBE — TenantReachProbe: amendment proposal (FOUNDER RATIFICATION REQUIRED)

Status: **PROPOSED — NOT RATIFIED.** Written 2026-07-26 as a requirement, not
executed. Per the design doc's explicit instruction (§2.5) and the charter's
interface-discipline rule, this capability may not be built by an agent without
founder ratification. This file is the ask; it changes no source.

## Why this is founder-gated, not agent-runnable

`TenantReachProbe` (`src/probe.ts`) is a **NEW-SCOPE placeholder**, not an
extraction. Three independent signals all point the same way:

1. **Design doc §2.5** (`ces-stamper/docs/design/tenant-manager-extraction.md:207-222`)
   ends with: *"**Do not invent a reach/tier probe capability that isn't
   grounded.** If the founder wants one, it's new scope for TenantManager to
   build ... but say so explicitly as new, not extracted."* The grounded finding
   is that **no reach/tier probe exists** in any of the four researched repos
   (Stamper, ces-eo, muster-api, tenant-stacksim).
2. **`src/probe.ts` header** states the interface is "declared as NEW-SCOPE, not
   extracted from existing behavior, per the design doc's explicit instruction to
   call this out to the founder rather than present it as extraction," and that
   the result shape is "a design placeholder only, to be refined when this
   capability is actually built" — i.e. even the signature is not yet fixed.
3. **Charter interface discipline** (collective §"Operating rules"): changes to
   ratified surfaces require founder ratification + a dated `RATIFIED AMENDMENT`
   marker. Promoting a placeholder interface to a real, implemented, exported
   surface is exactly such a change.

Building it now would mean an agent both ratifying a currently-provisional
signature and inventing un-grounded behavior — both are founder-only acts.

## What ratification would need to decide

If the founder wants this built, the ask needs to settle:

1. **Scope split.** Two behaviors currently live on one interface and have very
   different grounding:
   - `probeSimReady(slug, {maxAttempts, timeoutMs})` — **well-grounded.** It is
     ces-tester's already-hand-rolled sim ready-check (poll a cheap `/resolve`
     for a known-seeded object after a `scenario` CLI write; bounded retry,
     treat exhaustion as hard failure). Source: `ces-tester/PLAN.md` M1 task 3.
     This one *is* essentially extraction-ready — the only open question is
     whether ces-tester adopts it (its adoption milestone, not ours).
   - `probeReach(slug)` — **speculative.** No live-tenant reach/tier check
     exists anywhere. The design's suggested home is "a thin wrapper combining
     `warnIfSimUnreachable`'s pattern for sim with a lightweight Graph
     `/organization` call for live." That Graph call is new behavior and needs
     an auth-context decision (does probe run pre-auth? use the daemon's held
     auth state? a dedicated app-only token?).

   Recommendation: **ratify `probeSimReady` first** (grounded, low-risk,
   unblocks ces-tester without duplicating a fourth polling loop) and **defer
   `probeReach`** until a concrete consumer needs live-tier detection. Splitting
   avoids shipping a speculative live-probe signature we'd likely refine later.

2. **Signature confirmation.** If kept as one interface, confirm
   `TenantReachResult { reachable, kind, latencyMs?, error? }` is the shape to
   commit to, or amend it at ratification time.

3. **Transport placement.** Whether the probe is library-only, or also exposed
   over the M6 daemon (`/api/reach` or similar) — a new HTTP surface is itself a
   ratifiable amendment.

## If ratified, the agent-runnable execution plan (for reference only)

- `probeSimReady`: implement as `StacksimReachProbe` (or fold onto
  `StacksimEnvironment`) — POST/GET a cheap `/resolve` against the sim server
  URL already known to `StacksimEnvironment`; bounded retry loop mirroring
  `ces-tester/PLAN.md` M1 task 3 (default 10 attempts / 5s); exhaustion →
  `{ reachable: false, kind: 'sim', error: 'ready-check timeout' }`. Inject the
  fetch/timer seam like the other impls so it is testable without a live server.
- `probeReach` (only if scope-2 ratified): sim branch reuses the above; live
  branch does a lightweight Graph `/organization` GET via the resolved token,
  measuring `latencyMs`. Requires the auth-context decision above.
- Tests: new `probe.test.ts` — seeded-object-found, timeout-exhaustion,
  non-empty-first-try, and (if live) a mocked Graph 200/failure. Wire into
  `connectTenantSurfaces()` only if the transport decision says so.
- Version: additive minor (0.6.0) if purely new surface; mark
  `RATIFIED AMENDMENT (founder, <date>)` at the declaration site in `src/probe.ts`
  and add a milestone record.

## Disposition

Left as-is: `src/probe.ts` remains a documented NEW-SCOPE placeholder. No source
changed. Awaiting founder decision on scope (1), signature (2), transport (3).
