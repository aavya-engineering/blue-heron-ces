# Candidate Remediation Goals — from the 2026-07-04 Gap Report

Six dependency-ordered goal stubs clustering the ~123 findings into small-green-slice work.
Security-critical first, then the highest-leverage root fixes, then maturity debt. Each is a stub
ready to promote to a full `docs/G*-plan.md` when picked up. IDs are provisional (`G-ENG-*`).

Ordering rationale: **G-ENG-1/2 are security (do first)**; **G-ENG-3 is the single highest-leverage
fix** (one CI change lifts two ▲2 dimensions across five modules) and unblocks measurement for
everything after; G-ENG-4/5/6 are maturity debt, parallelizable once the gates exist.

---

## G-ENG-1 — Close the live-tenant command-injection surface  ·  P0  ·  effort S

**Objective:** Add escaping/quoting + an allowlist to the shared `interpolateVariables` in
`ces-stamper/src/adapters/PowerShellAdapter.ts` so operator/plan-supplied values cannot break out of
a PowerShell command, and lock it with injection tests. One fix clears both Stamper and AO (AO imports
the same adapter).
**Closes:** GAP-stamper-04.R8-1, GAP-ao-04.R8-01 (the two P0 code findings).
**Scope guard:** the fix is in the shared adapter + tests only; do not change command templates or
tenant behavior. dryRun path must stay identical.
**Acceptance:** a value containing `'`, `;`, `` ` ``, `$(...)` injected into any templated command is
neutralized (asserted by new tests in both ces-stamper and ces-ao); existing 211+171 suites stay green.

## G-ENG-2 — Supply-chain + secrets hygiene  ·  P0/P1  ·  effort S–M

**Objective:** Remediate EO's shipped vulnerabilities and remove the plaintext credential path, then
add the gate that stops both recurring.
**Closes:** GAP-eo-04.R11-01 (multer HIGH), GAP-eo-04.R11-02 (js-yaml/uuid), GAP-eo-04.R14-01 (tmpdir
upload cleanup), GAP-stamper-04.R3-1 (plaintext `--cert-password` → prompt or KeyVault ref).
**Depends on:** none, but the recurrence guard (the `npm audit` gate) is delivered jointly with G-ENG-3.
**Scope guard:** `npm audit fix` (no `--force` without a compat check on multer major); remove the
`--cert-password` flag in favor of a secure prompt / secret reference; no functional change.
**Acceptance:** `npm audit --omit=dev` reports 0 prod vulns in every workspace; no plaintext-secret CLI
flag remains (grep-checked); suites green.

## G-ENG-3 — CI gate cluster + coverage tooling (the leverage fix)  ·  P2 (high leverage)  ·  effort M

**Objective:** Turn the single `npm test` gate into a real quality wall: add lint, typecheck,
`npm audit`, and coverage gates to `.github/workflows/ci.yml`; install coverage tooling
(`@vitest/coverage-v8` for the vitest workspaces, jest coverage config for stamper/eo); set initial
thresholds at *current* measured levels and ratchet up.
**Closes:** the SPEC-05 + SPEC-07 ▲2 cells fleet-wide — GAP-shared-07.R3/R4/R6/R7, GAP-shared-05.R7,
and the per-module coverage/CI DUPs (planner/stamper/eo/ao all point here). Note: phase-3 G12
modernizes CI *actions* but does NOT add these gates, so they are genuinely open.
**Depends on:** nothing; **unblocks** measurement for G-ENG-4/5/6 (can't ratchet what you can't measure).
**Scope guard:** CI config + coverage dev-deps + threshold config only; thresholds start at current
levels so nothing goes red on day one. No product code.
**Acceptance:** CI fails a PR that drops coverage below threshold, fails on a new `npm audit` prod
vuln, fails on lint/type error; a coverage number is reproducible per workspace.

## G-ENG-4 — Server auth + input-integrity pass  ·  P1  ·  effort M

**Objective:** Put authentication in front of every HTTP surface and close the input-integrity leaks.
**Closes:** GAP-ao-04.R1-01 (AO server auth), GAP-eo-04.R1-01 (EO auth on-by-default, not opt-in),
GAP-stamper-04.R1-1 (Stamper GUI auth), GAP-planner-03.R2-01 (AJV strict/validateSchema), and the
CUI-isolation P1 GAP-planner-11.R6-01 (legacy no-tuple read leak).
**Depends on:** G-ENG-1 (auth in front of a still-injectable surface is half a fix — sequence after).
**Scope guard:** additive auth middleware + validation tightening; keep offline Planner's *local* UX
(the AJV + tuple fixes are integrity, not network auth, which stays waived for Planner).
**Acceptance:** unauthenticated request to any AO/EO/Stamper `/api/*` route is rejected; EO auth is on
unless explicitly disabled; a schema-invalid Planner artifact is refused; no cross-customer read path.

## G-ENG-5 — Release + documentation discipline  ·  P2  ·  effort M

**Objective:** Unfreeze versions to real SemVer with changelogs, and write the missing module docs.
**Closes:** GAP-*-06.R1 (versions frozen 0.1.0 fleet-wide) + 06.R3 (changelogs), GAP-shared-10.R1 /
GAP-eo-10.R1 / GAP-ao-10.R1 (READMEs for ces-shared, ces-eo, ces-ao), plus a runbook per server module.
**Depends on:** G-ENG-3 (a release checklist that can't run CI gates is theatre).
**Scope guard:** version/changelog/docs only; no behavior change.
**Acceptance:** every module has a README (purpose/run/test), a CHANGELOG, and a version that reflects
real state; CI presence-checks the README.

## G-ENG-6 — Observability floor + EO decomposition + contract ratification  ·  P1/P2  ·  effort L

**Objective:** Raise Observability off L1 everywhere, break up the EO monolith, ratify the load-bearing
seam, and add the WORM guard the evidence-integrity claim needs.
**Closes:** GAP-*-09.R3 (request IDs + structured logger; remove the `winston` dead-dep in Stamper+EO —
either wire it or drop it), GAP-eo-02.R10 (split the 4,100-line `EoServer.ts`), GAP-shared-03.R7 /
GAP-eo-03.R7 (ratify stamper↔EO contract out of DRAFT + a contract-diff gate), GAP-shared-11.R4
(CesRepository WORM/append-only guard for evidence collections).
**Depends on:** G-ENG-3 (gates) and G-ENG-4 (auth/audit-trail groundwork); largest and most decomposable.
**Scope guard:** refactor + observability + contract ratification; the golden SSP test must stay green
throughout the EO split (it is the safety net).
**Acceptance:** privileged AO/EO actions emit a request ID + durable audit record; EoServer.ts is
decomposed with the golden test green; the schema contract is v1.0 (not DRAFT) with a both-sides
validation + diff gate; CesRepository refuses to mutate an evidence record.

---

## Sequencing summary

```
G-ENG-1 (P0 injection) ──┐
G-ENG-2 (P0 vulns/secrets)┼─► G-ENG-3 (CI gates + coverage) ──► G-ENG-5 (release+docs)
                          │                                └──► G-ENG-6 (observability+EO split+contract)
                          └─► G-ENG-4 (auth + integrity) ──────►┘
```

Do 1 and 2 immediately (security). 3 next (leverage + unblocks measurement). 4 after 1. 5 and 6 last,
parallelizable. Everything is small-green-slice sized except G-ENG-6, which decomposes into the EO
split, the observability primitive, and the contract ratification as separate slices.
