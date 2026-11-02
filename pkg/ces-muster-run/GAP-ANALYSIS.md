# Muster vs Planner: gap analysis and status after the MX run

Blue Heron Defense, CES team. Revision 2026-10-24. Trimmed from our 10-23 analysis of the contractor clones (`ces-muster` at `29ee828`, `ces-mono` at `0252153`), with the status of each item after the MX run. Citations are `repo:path:line`.

## Legend

| Term | Meaning |
|---|---|
| MP / TM / IM | Manual Mission Plan / Tenant Manifest / Infrastructure Manifest |
| SI Baseline / TCP | Strategic Intent Baseline / Tenant Config Profile |
| SSP / POA&M | System Security Plan / Plan of Action and Milestones |
| EO | ces-eo (EvidenceOps) |
| sim | ces-stacksim |
| N-nn | Run-enabling gaps found in this analysis (section 3) |
| MG-nn | muster-shift backlog items (`muster-shift/01-GAP-BACKLOG.md`) |
| D1–D11 | muster-shift decisions (`muster-shift/02-DECISIONS.md`) |
| mx-01..03 | The patches in `patches/` |
| K4, K5 | EO defects found in this run (section 5) |
| MX | This run and package |

## 1. Headline findings

1. **The SSP is produced by EO, not by Planner or Muster.** EO builds it from an assessment snapshot plus the MP, TM and IM (`ces-mono:ces-eo/src/eo/ssp/SspGenerator.ts:202`; route `ces-eo/src/eo/server/routers/documents-router.ts:87`). Planner only renders a template SSP and POA&M as markdown when policy inputs exist; Muster copied those templates and has no renderer.
2. **Stamper needs only the MP and TM** (IM optional). Muster's output satisfies that; Stamper reads no SI Baseline, TCP or posture (`ces-stamper/src/cli/index.ts:384-545`).
3. **Muster had no headless discovery-to-plan path.** `mu discovery --sim` is headless, but the join, scoring and compile lived only in the browser app. **MX closes this** with one new file, `overlay/ces-muster/scripts/mx/plan-from-discovery.ts`, that calls the same Muster functions in the same order as the app.
4. **Layout and naming assumptions** (nested layout, `tenant-stacksim` folder name, EO's fixed TM filename, the `C:\CES_Pipeline` default) stop a first run. **MX closes these with scripts and environment variables**, no code changes.
5. Three truthfulness fixes ship as patches (mx-01 to mx-03). MG-02 (what "met" means) is deferred, so every readiness number from this run is **provisional**.

## 2. What each tool produces

| Artifact | Planner (code) | Muster after MX |
|---|---|---|
| SI Baseline | `ces-planner/src/features/sit/services/baselineGenerator.ts:19` | Yes (file written by the MX runner); 7 of 26 fields derived (MG-13) |
| Readiness posture | `rrt/services/postureGenerator.ts:19` | Embedded in the MP with real counts (mx-02); the separate readiness-result file is written by the MX runner |
| TCP | `tcp/services/tcpProfileGenerator.ts:116` | Yes when an Azure signal or TCP answers exist; partly bank defaults (MG-14) |
| IM | `mpt/services/infraManifestGenerator.ts:101` | Yes only with an Azure signal in the declared stacks (mx-03) |
| MP | `mpt/services/manualPlanGenerator.ts:111` | Yes, 110 control directives; fixed `harden_existing` (MG-10); still carries the pricing block (harmless) |
| TM | `mpt/services/manifestGenerator.ts:39` | Yes; zones empty (CUI boundary `null`, MG-08) |
| CUI boundary, BTC | `cui/...`, `btc/...` | No (`null` passed, MG-08, MG-09) |
| Policy documents, DOCX | `mpt/services/policyRenderer.ts:97` | No (MG-16) |
| Exclusions, traceability, control-assessment reports | `mpt/services/*ReportGenerator.ts` | No (MG-11) |
| Cross-artifact validation | `mpt/services/validator.ts` | Core-field check and Zod on push only (MG-15) |
| SSP, POA&M | Template markdown only | **Produced by EO** from the pushed MP/TM/IM and a post-Stamper sim assessment (MX steps E7, E8) |

## 3. Run-enabling gaps and how MX closes them

| ID | Gap | How MX closes it | Where |
|---|---|---|---|
| N-01 | Layout, names, Windows clone failures, `npm install` lockfile churn, missing builds, CRLF false failures | Own bootstrap: nested layout, pins, `-c core.longpaths=true -c core.autocrlf=false`, `npm ci`, the 4 missing builds, `STACKSIM_ROOT`, `STAMPER_REGISTRY_ROOT` | `bootstrap.ps1`, `bootstrap.sh` |
| N-02 | Sim seeding and discovery | E1 `stacksim scenario` + `serve`; E2 `mu discovery --sim` | `scripts/mx-e2e.ps1` |
| N-03 | No headless discovery-to-plan runner | New file run with `vite-node`: `createSession` → `parseReadinessResultFile` → `synthesizeFactsFromDiscovery` (+ boundary drafts, payload facts) → `applyDiscoveryFacts` → `factsFromAnswers` → `compilePlanForSession` → `buildReadinessResult` | `overlay/ces-muster/scripts/mx/plan-from-discovery.ts` |
| N-04 | Push into Stamper's plan-data | muster-api with `JWT_SECRET` and no database; a minted `bhd_operator` token; `POST /api/plan/push`. Direct write with the same names is the fallback | E4; `scripts/mint-token.mjs`, `scripts/mx-helpers.mjs push` |
| N-05 | EO cannot find Muster's timestamped TM (`ces-eo/src/eo/config/EoConfig.ts:178-182`) | `TENANT_MANIFEST_PATH` set to the pushed TM before EO starts | E7 |
| N-06 | EO needs a sim assessment | ces-tenant sim registration, EO from source on :4002, `/api/connect`, `/api/assess` (SSE) | E7; `scripts/mx-helpers.mjs sim-env`, `sse` |
| N-07 | SSP and POA&M | `POST /api/ssp/generate`, `GET /api/ssp/export/:id?tenant=<slug>` (DOCX), `POST /api/poam/generate` | E8 |

## 4. muster-shift backlog status after MX

| ID | Item | Status after MX |
|---|---|---|
| MG-01 | Empty read scores as met | **Fixed by mx-01** (reference patch). The join now synthesizes "yes" (class A) only when the executor's posture is `met`; `derived_posture` is carried from the readiness payload into the join. Two equivalence tests updated to the new row shape. |
| MG-02 | Verdict predicates ("met" means "output returned") | **Open, deferred** (decision F3). All readiness numbers are labelled provisional. |
| MG-03 | Two postures; 1970 dates; empty summary in the MP | **Fixed by mx-02.** The MP's `inputs.readiness_posture.control_status_summary` carries the real met/partial/not-met/unknown counts and the compile date. `key_findings` stays the "Initial assessment findings pending" placeholder while nothing is `not_met` (a consequence of MG-02). The MP fixture was regenerated. |
| MG-04 | Parity harness | Open |
| MG-05 | IM inferred as `m365_azure` for any cloud stack | **Fixed by mx-03.** Only an Azure signal (a stack tile matching `azure` or `sentinel`) infers `m365_azure`; otherwise `m365_only`. The MX run declares `m365_e5_gcc, microsoft_intune, microsoft_sentinel`, which is truthful for the `m365_azure` sim (it seeds a Log Analytics workspace and Azure network resources), so an IM is produced. |
| MG-06 | RLS role bootstrap | Open (see `POSTGRES-SETUP.md`) |
| MG-07 | RR coverage (25 static nodes) | Open. The MX run is discovery-only, so the unanswered nodes compile to `implement` directives. |
| MG-08 | CUI boundary | Open |
| MG-09 | BTC | Open |
| MG-10 | Plan mode | Open (`harden_existing` only) |
| MG-11 | Reports | Open |
| MG-12 | Push SI/TCP/posture | Open (the push body is still MP, TM, IM; the MX runner writes SI Baseline, TCP and readiness result as files) |
| MG-13 | SI derivation (7 of 26) | Open |
| MG-14 | TCP from tenant | Open |
| MG-15 | Validation | Open |
| MG-16 | Policy rendering | Open |
| MG-17, MG-26 | Pricing | Out of scope |
| MG-18 | Tech-ref guide | Open |
| MG-19 | Live tenant | Changed before MX (consent persistence added); out of scope for the sim run |
| MG-20 | CI | Open. `scripts/run-tests.*` is a usable starting point for a CI job. |
| MG-21 | Archetypes | Open |
| MG-22 | Consistency rules | Open |
| MG-23 | `ran_entry_ids` | Partly done. On the MX path the readiness result carries the executor's rows verbatim (all observations have non-empty `ran_entry_ids`, check V4); the export fallback still writes `[]` |
| MG-24 | Domain markers | Open |
| MG-25 | Help tooltips | Not verified |
| MG-27 | Stamper intake for SI/TCP/posture | Open (contractor owns the Stamper side, decision D11) |
| MG-28 | Question register | Open |

## 5. New findings from the run

- **K4 (EO): the SSP's system name and boundary never come from the TM on the documents route.** `documents-router.ts` calls `generator.generate(...)` without `manifests`, so `extractSystemName` falls back to `<tenantId> System`, and `extractBoundary` reads a top-level `boundary_zones` that Muster's TM nests under `tenant_manifest` (and leaves empty, MG-08). The TM is loaded (the SSP's `sourceArtifacts` lists it) but its content does not reach the SSP text. Not fixed here.
- **Stamper on a discovery-driven Muster plan is PARTIAL.** 110 tasks: 87 completed, 23 failed (the named list is in `expected-outputs/summary.json`). Most failures are "verification failed — Evidence validation failed" for sim-unsupported or variable-dependent commands; the translate step reports unresolved variables such as `adminUserName`, `breakGlassUPN` and `approverUPN` that a full interview (TCP answers) would supply.
- **EO must run from source.** Its `dist` build lacks the `data/` template folders.
- **K5 (EO): the assessment is not deterministic on the sim.** In one run, all 10 controls that EO evaluates only from the Conditional Access signal came back `not_met`, with identical sim state and reads. The likely cause is parallel signal batches through one persistent PowerShell session (`ces-eo/src/eo/ingestion/ComplianceSignalFetcher.ts:740-760`). Not fixed here.

## E-summary

- SSP and POA&M come from EO; Stamper needs only MP and TM. Both now run from a real Muster discovery on the sim.
- N-01 to N-07 are closed by scripts, one overlay file and environment variables; MG-01, MG-03 and MG-05 by three small reference patches.
- MG-02 is deferred, so readiness numbers are provisional; the rest of the backlog is unchanged and still the parity work list.
- New: K4 (EO ignores the TM's identity on the SSP route), K5 (EO's sim assessment is not deterministic) and a named list of 23 failing Stamper tasks.
