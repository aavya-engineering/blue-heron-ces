# GOAL — EvidenceOps to full functionality (G-EO-FULL-1), 2026-09-26

**Type:** executable /goal prompt for an agent working in `C:/Users/mhsut/DevProjects/ces/ces-eo`.
**Source assessment:** `C:/Users/mhsut/DevProjects/ces/ces-strategy/docs/context/module-status/evidenceops.json` and `evidenceops.md`. The assessment was run on ces-mono `07a8a29` plus uncommitted edits. Re-verify every "current state" line against the code before acting, because it may have moved.
**Conventions to follow:** `docs/goals/G-EO-STAB-1.md` (goal format, gates), `collective-ces-eo.md` (health line), `docs/context/MODULE_MAP.md`.

## 1. Current state (from the assessment)
- 23 user-level functionalities: 10 Implemented, 10 Partial, 1 Stub, 2 Missing.
- 568 jest cases green. `npx tsc --noEmit` clean. **Zero HTTP route tests** run in the default suite.
- **AO → EO is not wired.** AO persists every execution to `ces.db` collection `adminops_evidence` (`../ces-ao/src/execution/EvidenceEmitter.ts:97-124`). EO never reads it. `src/eo/rendering/InputSourceResolver.ts:17-30` registers all 12 prefixes as stubs, `adminops` included.
- **Missing:** EO-21 (AdminOps evidence ingestion and display) and EO-22 (EC page, which calls nonexistent `/api/ec/*`).
- **Stub:** EO-19 (input-source providers; the 8 renderers emit partial artifacts).
- **Partial:**
  - EO-03 signal collection is sim-only. The registry covers 107/110 practice numbers, but only 79/110 have an automated signal.
  - EO-04 scheduled capture: untested, and needs a prior `/api/connect`.
  - EO-06 SSP: tenant scoping reads `config.tenantSlug` (`documents-router.ts:128-160`). 126 dead templates sit in `src/eo/generation/templates`.
  - EO-07 SSP DOCX: API-only, weakly tested.
  - EO-08 POA&M: `/api/poam/list` is shadowed by `/api/poam/:poamId`. Tenant scoping is wrong.
  - EO-12..15 training, screening, offboarding, risk: 0 tests. Offboarding is attestation-only. Sentinel ingest is a stub.
  - EO-16 policies: API-only, push-only.

## 2. Target state
Every functionality EO-01..EO-23 is **Implemented** with in-module tests, and each has at least one route-level test. Concretely:
- When AO executes, denies, dry-runs or fails a command for a tenant, EO shows that row. It appears per tenant and per command, in the Evidence Explorer, at a stable API route, and as an assessment source for the row's controls.
- No stub resolvers remain for sources CES actually has.
- There are no dead templates or dead UI.
- Tenant scoping is correct on every route.

## 3. Milestones (in order; one small green commit or more per milestone)

**M1 — AO evidence reader (EO-21).** This is the founder's headline flow, so it goes first.
- Add `src/eo/evidence/AdminOpsEvidenceLoader.ts`. It reads `adminops_evidence` via `getCesRepository()` (ces-shared persistence) and maps each row to an `AssessmentSource` with `source: 'adminops'`. It keeps commandId, executionId, outcome/verdict, controlIds, timestamp and sha256.
- Resolve the tenant key. AO scopes rows by `tenantId` (see `../ces-ao/src/execution/CommandExecutor.ts:77`), while EO routes take a slug. Map slug → tenant config → tenantId, and document the rule.
- Wire the loader into `/api/assess`: add a merge input in `ControlAssessor.merge`, and while you are there replace the dead `discoveryResults`/`ecFindings` slots.
- Add an `adminops` source to `/api/evidence-explorer/index` and `/item`, and add `GET /api/adminops/evidence?tenant=&commandId=&correlationId=`.
- Acceptance tests:
  - (a) Loader unit test against a `:memory:` repository seeded with rows for all 7 AO outcomes.
  - (b) Supertest: seed a row, then `GET /api/adminops/evidence` returns it and the explorer index lists it.
  - (c) Assessment merge test: an AO row for a control appears in that control's sources.
  - (d) Cross-tenant isolation test.
- If AO's contract doc (`ces-ao/docs/contracts/ADMINOPS-EVIDENCE-CONTRACT.md`) exists, validate against it. If it does not, file `docs/requirements/REQ-ao-evidence-contract.md` here; do not edit ces-ao.

**M2 — `adminops` input-source provider plus the other real providers (EO-19).**
- Implement `adminops` in `InputSourceResolver` on top of the M1 loader, including `adminops.change_log...` for `SiaFromChangeLogRenderer`.
- Then implement `stamper` (plan-data evidence) and `planner` (policy store).
- Leave Graph-backed prefixes stubbed until M7, and name them explicitly as stubs in `evidenceops`-style docs.
- Update `tests/unit/rendering/render-pipeline.test.ts`, which currently asserts that every prefix is a stub.
- Acceptance: a render job with an `adminops.*` input yields `state: 'rendered'` with the real data.

**M3 — Correctness bugs (EO-06, EO-08, EO-02).**
- Use the request tenant everywhere in SSP generate and POA&M latest/:id/export/list, and in the auto-POA&M in `/api/assess`.
- Move `/api/poam/list` above `/api/poam/:poamId`.
- Acceptance: supertest cases proving that two tenants do not bleed into each other, and that `/api/poam/list` returns 200.

**M4 — Route-level test harness plus coverage for untested systems of record (EO-10..EO-15, EO-18, EO-23).**
- Build `createEoServer` in-process with a temp `STORAGE_ROOT` and a `:memory:`/temp `ces.db`. If the ESM/docx chain blocks in-process loading, fix the jest transform first.
- Cover CRUD and happy/error paths for personnel, training, screening (including the CUI PDF bytes), offboarding (complete writes the overlay), risk (register, auto-score, annual review, snapshots), package build, timeline and cleanup.
- Acceptance: at least 1 route test per route family, and at least 1 store test each for TrainingStore, ScreeningElementStore, OffboardingWizardStore, RiskAssessmentStore, EvidencePackager and PoamDocxExporter.

**M5 — Offboarding uses AO evidence (EO-14).**
- The offboarding steps "disable account" and "wipe device" show a matching AO execution row (AO use cases A-02/A-03/B-05) when one exists, and flag steps with no evidence.
- Attestation remains allowed but is labelled as attestation.
- Acceptance: a test where a seeded AO disable row turns the step evidence-backed.

**M6 — Remove or finish the dead surfaces (EO-22, EO-06, EO-07, EO-16).**
- Either delete the EC page and `EvidenceImporter.ts`, or implement `/api/ec/*`. Record the decision.
- Delete or wire `src/eo/generation/templates` (126 files). Keep one template set and update any doc that claims 126. *Done 2026-09-27 (FC-EO-C EO-06): deleted.*
- Add an SSP DOCX download button and a POA&M DOCX button to the UI.
- Add a read-only Policies view.
- Acceptance: `grep` finds no fetch to a nonexistent route, `npm run validate-snippets` is green, and a UI smoke test covers the new buttons.

**M7 — Signal coverage and continuous capture (EO-03, EO-04, EO-15).**
- Add registry entries for CM.L2-3.4.4, MA.L2-3.7.3 and MA.L2-3.7.6.
- Raise automated coverage above 79/110 where Graph exposes a signal, and document why the rest are manual.
- Scheduled capture must establish its own session (or report clearly that it is idle) and record drift versus the previous capture.
- Implement Sentinel ingest or remove it from the source list.
- Acceptance: a registry completeness test (110/110 practice IDs present), plus EvidenceCaptureService and scheduler tests with a fake SessionManager.

**M8 — Sim-in-the-loop gate.**
- Make `tests/integration/eo-live-sim.test.ts` part of a named `npm run test:sim` script.
- Add an AO → EO sim case: AO executes against stacksim, then EO `/api/adminops/evidence` and the explorer show the row.
- Acceptance: `npm run test:sim` is green on a machine with the tenant-stacksim sibling, and self-skips elsewhere.

## 4. Acceptance per milestone (common gate)
`npx tsc --noEmit` must be clean, `npm test` must be green with the count never below 568, and `npm run validate-snippets` must be green. Every new behavior needs a test in the same commit. Update `collective-ces-eo.md` with the health line after each milestone.

## 5. Ground rules
- **Sim-only.** Never run anything that can reach a real tenant or the internet. Live paths are exercised only through tenant-stacksim (`kind: 'sim'`, zero GUIDs). Leave `tests/integration/live-assessment.test.ts` skipped.
- **Write boundary = `ces/ces-eo`.** Read ces-ao, ces-shared, ces-stamper and ces-tester freely, but do not write there. If a sibling needs a change, file `docs/requirements/REQ-<sibling>-<topic>.md` here and report it.
- **Small green commits**, staged by explicit pathspec, because other sessions edit this repo concurrently. **No force-push**, no history rewrite, no `git clean`/hard reset. Do not `npm install` in a way that rewrites the lockfile unless a milestone needs a dependency; if it does, call that out.
- **One-SPRS rule** (from G-EO-STAB-1): EO's SPRS numbers are never the customer-facing number.
- Do not build a discovery engine here (FD-DISCOVERY-OWNER).
- **No personal identity** (names, emails, handles) in code, fixtures, docs or commit bodies.
- **HONEST-OPEN reporting:** at each milestone, report what is done, what is still open and what is sim-only, with file:line evidence. Never mark a functionality Implemented without its tests passing.

## 6. Exit criteria
- `evidenceops.json` re-derived from code shows 23/23 Implemented, with tests_in > 0 for every functionality.
- AO → EO is demonstrated in the sim gate (M8).
- InputSourceResolver has no stub for `adminops`, `stamper` or `planner`.
- All gates are green.
- No dead routes, templates or UI remain.

## Legend
- **AO:** AdminOps (ces-ao).
- **EO:** EvidenceOps (this module).
- **EO-nn:** functionality IDs from `evidenceops.json`.
- **EC:** Evidence Collector (legacy UI page).
- **M1–M8:** milestones in §3.
- **SPRS:** Supplier Performance Risk System score.
- **SSP:** System Security Plan.
- **POA&M:** Plan of Action and Milestones.
- **CRM:** customer responsibility matrix.
- **FD-DISCOVERY-OWNER:** the founder decision on who owns discovery (see G-EO-STAB-1).
- **HONEST-OPEN:** report done / open / sim-only honestly.
- **stacksim:** tenant-stacksim, the simulated tenant.
- **Supertest:** HTTP-level tests against the in-process Express app.
