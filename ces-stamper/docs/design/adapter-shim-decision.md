# DECISION RECORD - FD-ADAPTER-SHIM: KEEP (G-STAMPER-STAB-1 M4)

**Date decided:** 2026-07-11 (founder HIL session, working-system program).
**Status:** RATIFIED - FINAL for the working-system program; revisit is a named
post-gate follow-on (item 4 of the loop's follow-on ledger).
**Provenance:** ces-strategy/docs/MASTER-PLAN-2026-07-11.md sec. 4 (FD-ADAPTER-SHIM
row); lane analysis ces-strategy/docs/context/masterplan/stamper.md item 2;
ces-strategy/docs/LOOP-WORKING-SYSTEM.md (board + follow-on ledger).

## The decision

**KEEP** ces-ao's single remaining deep import of this package -
`import { PowerShellAdapter } from 'ces-stamper/adapters/powershell'`
(ces-ao/src/execution/CommandExecutor.ts) - as **the standing boundary exception**
to the CES tool-boundary principle (tools standalone; orchestrators consume
interfaces). Extraction of the adapter into a shared engine package is DEFERRED
past the objective gate.

## Why

- The import rides a real, versioned export contract: `package.json` `exports`
  `"./adapters/powershell"` - not a reach into internals.
- Extraction is L-class: the adapter is ~1,700 lines and drags StamperConfig,
  SessionManager, ExecutionContext, and the evidence/verification stack with it -
  interface surgery mid-program, high churn during the scenario push.
- The shim demonstrably holds: AO tsc clean + suite green against stamper dist
  (197/197 as of 2026-07-11).
- Shared-chokepoint benefit: fixes land once and both consumers inherit them
  (the M1 variable-poisoning fix and M2 teams/spo channels reached AO for free).

## Consequences / obligations while KEEP stands

1. **AO guard rule (binding on every Stamper tick):** any change to the adapter's
   constructor signature or the fields it reads (tenantId / appId / certThumbprint /
   domain / subscriptionId / gccHighEndpoints / dryRun) pairs an AO-side
   follow-through in the same tick - AO bridges via runtime casts and breaks at
   RUNTIME, not compile time.
2. The `./adapters/powershell` export path (and its transitive `./core/session`,
   `./config/stamper` exports) must NOT be removed or reshaped while the exception
   stands. Shim paths with no remaining consumers (core/session, config/stamper)
   stay in place until the revisit rules on them.
3. G-MUSTER-DISCOVERY-1's precondition is THIS RECORD existing (the decision
   recorded before anyone extracts) - satisfied by this document.

## Revisit trigger

Post-objective-gate only (loop follow-on ledger item 4). The revisit weighs
extraction (shared engine package) against the exception's continued cost; nothing
in the working-system program re-opens it earlier.
