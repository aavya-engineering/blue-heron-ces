# Goal Document - G-STACKSIM-FIDELITY-1: sim fidelity for muster-readiness discovery reads

**Date:** 2026-07-11 - **Type:** /goal.
**Provenance:** founder directive 2026-07-11 working-system program
(ces-strategy/docs/context/VAULT.md, section B; lane analysis
ces-strategy/docs/context/masterplan/tester-stacksim.md sec. 5; master plan
ces-strategy/docs/MASTER-PLAN-2026-07-11.md).

Scope note (adjusted from the vault per lane findings): the vault listed "S4 fake-auth
surfaces" as open - S4 is CLOSED (BACKLOG.md:51, commit 829f01b; all of S1-S5 closed).
Nothing in stacksim blocks tester milestones anymore. What remains is DISCOVERY-READ
fidelity for muster-readiness sessions: the sim's own documented DOESN'T list becomes a
real gap once readiness probes multiply beyond today's 3-probe/4-fact surface.

## Job

- **M1 - per-probe onboarding protocol (S).** Codify the documented protocol as a repo
  doc + template: every NEW Muster discovery probe needs (a) a URI resolver entry
  (unregistered URIs 404, and Muster treats probe failure as absence, never 'no'),
  (b) a scenario knob, (c) an expectedFacts row in the muster-* scenario manifests.
  The muster-harvest.test.ts glob means adding a scenario adds a test - keep that
  property. This is a standing per-probe tax (S each, unbounded total as readiness probe
  count grows) - the protocol doc makes it a checklist, not rediscovery.
- **M2 - OData $filter/paging semantics (M; demand-driven).** Today GETs return FULL
  collections - any discovery probe that filters (e.g. "enabled policies only") gets
  everything and derives WRONG facts silently. Implement $filter/$top/paging semantics for
  exactly the collections the discovery-engine probe surface uses (demand-driven, not
  Graph-complete). Trigger: the first readiness probe that sends a filtered GET.
- **M3 - facade coverage for discovery-engine reads (S per gap).** If the registry-walking
  executor (G-DISCOVERY-1) surfaces sim gaps: the 503/523 inventory calls already PASS
  0-FAIL including Stamper get_commands; the 20 manual_only exclusions stay known-untested;
  fill only demonstrated misses.
- **Carry-note (no build):** SPO `-CertificateThumbprint` connect not yet validated against
  live GCC High - sanity-check on the first real connect (owned by the live smoke lane,
  noted here because S4 recorded it).

## Must-NOTs

- No write-path fidelity work in this goal - discovery is read-heavy; named-cmdlet
  mutation arg-threading and token validation stay by-design limitations (note only).
- No speculative Graph-complete OData implementation - demand-driven per actual probe
  surface only.
- Do not break the scenario-glob-equals-test property of muster-harvest.test.ts.
- Boundary principle: gaps in Muster's probe behavior (e.g. failure-as-absence) are filed
  against ces-muster, not papered over in the sim.

## Acceptance gate (objectively checkable)

1. M1: protocol doc committed; a new probe added by following ONLY the doc lands green in
   muster-harvest.test.ts (dry-run the checklist once).
2. M2: for each collection in the discovery probe surface, a test proves a $filter'd GET
   returns the filtered subset (and an unfiltered GET is unchanged); a paging test where
   the probe surface pages.
3. M3: discovery-engine v1 run against a sim tenant completes its runnable-get walk with
   zero 404s attributable to missing resolver entries (or each miss has a filed row +
   fix).
4. Existing suites and the 5 muster-* scenario tests stay green.

## Preconditions

- BLOCKED-ON the discovery probe surface definition: G-DISCOVERY-1 (registry-walking
  executor) and/or new Muster readiness probes. M1 (protocol doc) may run any time.

## Pointers

- ces-strategy/docs/context/masterplan/tester-stacksim.md sec. 5 (fidelity limits list)
- BACKLOG.md:13-63 (S1-S5 closed, S4 SPO caveat), LOOP_STATE.md:63,67 (inventory pass)
- scenarios/muster-*.json + muster-harvest test glob
- session-tenant-stacksim-2026-07-09.md:127-162 (resolver protocol, probe surface),
  2026-07-10:104-113 (DOESN'T list)
- ces-strategy/docs/MASTER-PLAN-2026-07-11.md (G-DISCOVERY-1 dependency)
