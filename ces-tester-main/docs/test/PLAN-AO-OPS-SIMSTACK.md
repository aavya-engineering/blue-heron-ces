# Plan: AO-OPS-SIMSTACK — every AO op proven through the AO UI against a GCC High G5 simstack

**Date:** 2026-09-26 · **Branch:** `gp-aoops-1` (tester, ces-mono, stacksim worktrees) ·
**Status:** DRAFT, awaiting founder approval (Stage 3). Execution is Stage 4.
**Inputs:** `docs/context/THREAD_HANDOFF.md` (D1–D5), `docs/context/REVIEW.md` (P0/P1, 95-op
appendix), `ces-ao/INSTRUCTIONS-FROM-TESTER-2026-09-26.md` (AO-side scope, handed to a separate
AO session).

## Executive summary

- **What we build:** a repeatable scenario that stands up a **G5-licensed `gcc-high-sim`
  stacksim** seeded so every AO target exists (plus deliberate gaps for detect ops). A
  **Playwright suite** then drives **all 95 AO ops through the AO web UI**, asserts each one's
  evidence shows up **in EO (API and Evidence Explorer page)**, and proves the **CMMC scope, CUI
  boundary and SoD/approval denials**.
- **Ownership split (coordinator scope change, 2026-09-26):** a separate ces-ao session owns
  **all AO source changes**: the sim-only rail, the `'dev'` fallback fix, deny evidence
  (including SoD pending and rejected), the evidence contract and correlation id, UI
  `data-testid` hooks, the Tier-3 UI round trip, and AO's own API-level 95-op loop. **This plan
  schedules no edits under `.worktrees/ces-mono/ces-ao`.** It consumes AO through two upstream
  contract docs, `AO-UI-TEST-HOOKS.md` and `ADMINOPS-EVIDENCE-CONTRACT.md`.
- **Owned here:** the tester harness and suite only. **EO ingestion (Unit E) is upstream.**
  By founder ruling (2026-09-26), the EO session owns it under
  `ces/ces-eo/GOAL-FULL-FUNCTIONALITY-2026-09-26.md` M1/M8, and this plan consumes it at SYNC-E (§4).
- **Stacksim re-scope (2026-09-26, later):** the **stacksim resolvers and seed** (S0–S4, §3.2,
  §5.3) move to a separate tenant-stacksim session. Its prompt is
  `ces/tenant-stacksim/GOAL-AO-SIM-COVERAGE-2026-09-26.md` (branch `ao-sim-coverage`).
  **This plan schedules no stacksim edits.** It consumes that branch at pinned SHAs (SYNC-S, §4),
  the same way it consumes AO.
- **Sequencing:** REVIEW P0s come first. P0-1 is the env/junction in M0. P0-3 is a tester-side
  guard in M1, backed later by AO's rail. P0-2 is EO ingestion in M1. P0-4 is the stacksim
  G5 skeleton (upstream: stacksim goal M1 → SYNC-S0), then per-wave resolvers (stacksim goal
  M2–M5 → SYNC-S). Harness work comes next (M2). **SYNC-1 (AO's
  rail, contract and hooks land) gates the first real UI run.** Waves W1–W4 converge the ops.
  SYNC-2 (AO's Tier-3 UI and SoD evidence) gates W5. W6 covers the deny matrix.
- **Loop exit:** all 95 rows in `docs/test/AO-OPS-UI-STATUS.md` are `PASS` or
  `HONEST-OPEN(reason, owner, REQ)`, with zero rows in any other state. All four gates are
  clean, and the full suite passes twice in a row on a fresh simstack.

## Legend

| Term | Meaning |
|---|---|
| AO / EO | ces-ao AdminOps / ces-eo Evidence Ops |
| simstack / stacksim | tenant-stacksim simulated GCC High tenant (`gcc-high-sim`, port 4390) |
| G5 | Microsoft 365 GCC High G5 licensing (seeded as a SKU plus per-user assignments) |
| CUI / SoD / PIM / CA / MAM / DLP / SPO / EXO / IPPS / PnP / UAL / LAW / NSG | Controlled Unclassified Information / Separation of Duties / Privileged Identity Management / Conditional Access / Mobile App Management / Data Loss Prevention / SharePoint Online / Exchange Online / Purview (IPPS) PowerShell / PnP.PowerShell / Unified Audit Log (`Search-UnifiedAuditLog`) / Log Analytics Workspace / Network Security Group |
| D1–D5 | Locked founder decisions in THREAD_HANDOFF.md |
| P0-1..P0-4, P1 | REVIEW.md verdict items (P0-1 ces-tenant/install, P0-2 AO→EO wiring, P0-3 sim-target guard, P0-4 stacksim gaps) |
| M0–M4 | Milestones of this plan |
| W1–W6 | Op waves inside the loop (§6) |
| SYNC-1 / SYNC-2 | Points where the tester consumes landed AO-session deliverables (§4) |
| Unit E / S0–S4 / T1–T3 | Parallel work units with disjoint file sets (§5) |
| Flow R / GTS / T3 / FW | Op UI flow: Read (evidence-only) / Get-Then-Set write / Tier-3 approval round trip / Firewall precheck plus confirm modal |
| Sim Y / P / N / Y* | REVIEW appendix sim coverage: yes / partial / none / passes only via coverage-harness-only seed |
| E-std | Standard evidence assertion (§7.2) |
| Deny codes | **CL** = L2-practice op against an L1 tenant · **CS** = L1-only op against a strict tenant with no `cmmcLevel` · **CU** = CUI-boundary deny · **SD** = SoD set (no approval / self-approval / rejected / param-tamper / replay) · **RL** = sim-only rail refusal |
| HONEST-OPEN | Row that does not pass, recorded with its reason, owner and REQ file. Never masked. |
| `aoops-*` | Tenant slugs this plan creates (§3.3) |
| Fix-cap | The maximum of 3 fix iterations per op before it must be triaged to HONEST-OPEN or a founder question |

## 1. Objective and constraints

**Objective.** Prove objectives #1–#6 of THREAD_HANDOFF.md through the AO UI (D1). Deny scope
follows D2, the seed follows D4, and isolation follows D5.

**Constraints.**
- **Worktrees only.** Never write to `ces/ces-ao`, `ces/ces-eo`, `ces/tenant-stacksim`,
  `ces/ces-tenant`, or the main ces-tester checkout.
- **ces-tenant and ces-stamper are read-only.** They are not in the D3 set.
- **`.worktrees/ces-mono/ces-ao` is read-only for this plan.** AO arrives by merging the AO
  session's branch (§4).
- Windows 11, with PowerShell 5.1 for spawns. There are no pushes and no force-pushes. Commits
  are small and green on `gp-aoops-1`. No banned identity strings may appear.

**Per-repo gate (run before every commit):**

| Repo | Directory | Gate |
|---|---|---|
| tester | `.worktrees/tester` | `npx tsc --noEmit` + `npm test` (unit only). E2E is separate: `npm run test:aoops` |
| ces-eo | `.worktrees/ces-mono/ces-eo` | `npx tsc --noEmit` + `npm test` |
| ces-ao (verify only, no edits) | `.worktrees/ces-mono/ces-ao` | `npx tsc --noEmit` + `npm test` after each SYNC merge |
| stacksim | `.worktrees/stacksim` | `npx tsc --noEmit` + `npm test` (includes the demo-profile drift guard) |

M0 records any pre-existing failures as a baseline in the status ledger. A gate is "clean" when
it has no failures beyond that baseline.

## 2. Milestones

### M0 — Environment and baseline (serial; resolves P0-1)
1. Confirm `git branch --show-current` returns `gp-aoops-1` in all three worktrees. Leave
   `ces-mono/ces-tenant` on master as a read-only dependency.
2. **Tester ces-tenant resolution (a new finding, not in REVIEW).** The tester's `package.json`
   has `"ces-tenant": "file:../ces-tenant"`, which resolves to `.worktrees/ces-tenant`. That
   path does not exist. The ces-tenant worktree is at `.worktrees/ces-mono/ces-tenant`.
   Create a directory junction from `.worktrees/ces-tenant` to `.worktrees/ces-mono/ces-tenant`.
   It stays inside the ces-tester root and is already covered by `.git/info/exclude`.
3. Run `npm install` in ces-mono (root workspaces), `ces-mono/ces-tenant`, stacksim and tester.
   Then run `npm run build` in `ces-mono/ces-tenant` **first**, because both `file:`
   consumers resolve its `dist/`. After that, build ces-mono `ces-shared`, `ces-ao`, `ces-eo`
   and `ces-stamper`
   (`gui-servers.ts` spawns `dist/cli/index.js`), and `npx playwright install chromium`.
   No `node_modules` exist in any worktree today.
4. Run all four gates and record the baseline.
5. **Deny-tenant feasibility spike (read-only).** Confirm that a sim record patched
   post-creation through the `sim-tenant-record.ts` pattern (`cmmcMigrationExempt:false`,
   `cmmcLevel`, `cuiBoundary`) is what AO's `CmmcAwareTenantConfig` reads. Sources:
   `CmmcScopeGate.ts:63-115` and `ParameterMapper.ts:92-141`. If it is not, raise **OD-3**.

**Exit:** installs succeed; the baseline for all four gates is recorded; the spike outcome is
recorded.

### M1 — P0 builds owned here (parallel: T1, E, S0)
- **T1** (§3.4 tester rail, P0-3 tester side) only. **S0 and E are upstream**: S0 is the stacksim
  goal's M1, and E is EO GOAL M1. T1's overlay reads the variable values from the **Stamper tenant
  object** (`plan-data/aoops-g5/aoops-g5.json` → `resources`) that stacksim emits at the pinned
  SYNC-S0 SHA. Until then, it is tested against a fixture tenant object.
- E is built against a **draft contract fixture**: `adminops_evidence` rows shaped per the
  REVIEW description of `EvidenceEmitter.ts:37-59`, plus the outcome enum and correlation id
  from the AO instructions §2.3. It is re-validated at SYNC-1.

**Exit:** T1 guard unit tests are green, and the harness refuses a `dev`/`live` record and any
non-worktree module root. EO's index returns `source:'adminops'` items from a fixture `ces.db`
(unit test). `stacksim seed --scenario aoops-g5` produces the G5 SKU, licensed users, and the
moved D-11/A-20 objects. All gates are clean.

### M2 — Harness (parallel: T2, T3)
- **T2**: a generic AO UI op driver coded against `AO-UI-TEST-HOOKS.md` (§7.3). Until SYNC-1 it
  is tested against `tests/fixtures/ao-ui-hooks-fixture.html`, a stub page that implements the
  hook contract.
- **T3**: the EO evidence checker, the status ledger, and the matrix data module.
- Meta-tests: matrix completeness (the registry has 95 ops, the matrix has 95 rows, and the
  IDs match); flow classification matches the registry (`sodTier`, `idempotencyClass`,
  F-11/F-12).

**Exit:** driver unit tests are green on the fixture; the ledger renders 95 `PENDING` rows; the
gates are clean.

### SYNC-1 → M3 — Loop waves W1–W4 (§6); stacksim units S1–S4 run in parallel
**Entry:** SYNC-1 is met (§4).

**Exit per wave:** every row in the wave is `PASS` or `HONEST-OPEN`; the gates are clean; the
ledger is committed.

### SYNC-2 → M4 — W5 (Tier-3), W6 (deny matrix), close-out
**Exit (the loop exit):** all 95 rows are terminal. Every applicable deny cell is `PASS` or
`HONEST-OPEN`. `npm run test:aoops` passes twice in a row on a fresh `stacksim` reset. The
HONEST-OPEN list and all REQs are filed. The founder gets the report.

## 3. Simstack seed design (stacksim worktree)

### 3.1 Scenario

- `scenarios/aoops-g5.config.json` follows the shape of `demo-dib-small.config.json`.
  - The company is fictional (for example "Harrow Ridge Precision"), with domain
    `harrowridge.onmicrosoft.us`, about 25 staff and `environment:'gcc-high-sim'`.
  - It uses the `m365-azure` stance, with the Sentinel pieces from `m365-sentinel.json` merged
    into the new `profiles/gcc-high-g5.json`.
  - Build it into `scenarios/aoops-g5.json`. The drift guard applies.
- A re-run is the reset. The tester reuses `reset.ts`'s `stacksim-tenant-reset` action.

### 3.2 Seed requirements

Every target is present (D4). The tag `(gap)` marks a deliberate finding.

| Area | Seed (new generator file where noted) | Serves |
|---|---|---|
| **G5 licensing** | `subscribedSkus` holds one G5 GCC High SKU (part number per OD-6) with consumed/prepaid units. `users[].assignedLicenses` is set. One user is unlicensed **(gap)**. `generators/licensing.ts` NEW | A-01 (`m365LicenseSkuId`), G5-gated reads |
| Users / identity | Staff, an operator UPN, a break-glass UPN, a service account, a contractor. Adds `signInActivity` (one user at 120+ days, **gap**), `userType:'Guest'` (2 users, **gap**), `riskyUsers` (1 at high risk, **gap**), and auth methods (one SMS-only user, **gap**) | A-01..A-08, A-11, A-12, A-16, C-06, C-10, E-08, G-02, G-08, H-02 |
| Groups | `baseGroup`, LOA group, admin group, CUI group, training-enforcement group. Adds `groupTypes:['Unified']`, one group with `visibility:'Public'` **(gap)**, and seeded memberships | A-04, A-05, A-06, A-17, D-08, D-09, G-02, G-03 |
| PIM | `roleEligibilitySchedules` and `roleAssignments` that use the **real built-in role template GUIDs** (Global Admin, Privileged Role Admin, Security Admin). There is one standing GA assignment **(gap)** and a `roleEligibilityScheduleRequests` POST resolver. `generators/pim.ts` NEW | A-04, A-09, A-10, C-04 |
| CA / named locations | The existing seed, plus the admin-portal CA policy, the device-compliance CA policy, and the **duplicate CA pair moved from `CoverageRunner.ts` ~181-205** (Y*) | A-13, A-14, A-19, A-20, B-07, F-04, F-07 |
| Intune | Devices with `osVersion` (one outdated, **gap**), serial number and model (one missing, **gap**), AV/EDR fields on detected apps (one device with none, **gap**), a non-compliant kiosk **(gap)**, and per-device compliance status | B-01..B-06, B-10, B-11, B-13, H-03 |
| Autopilot / MAM | `windowsAutopilotDeploymentProfiles` (one device unassigned, **gap**). Android and iOS `managedAppProtections`, with the iOS policy absent **(gap)**. `generators/deviceMgmt.ts` NEW | B-08, B-09, B-12, B-14 |
| Apps / SPNs | Applications with `passwordCredentials`: one expiring in 10 days and one expired **(gap)**, one app with no owners **(gap)**, and one SPN using a secret instead of a managed identity **(gap)**. `appRoleAssignments` includes one over-privileged consent **(gap)** | C-01, C-02, C-07, C-08, F-10 |
| Key Vault | The existing seed, plus one certificate expiring in 20 days **(gap)** and one over-broad RBAC assignment **(gap)** | C-03, C-04, C-05 |
| Directory settings | `directorySettings` and a password-policy template | C-09 |
| Purview / DLP / labels | The existing seed, plus the **"Sim CUI Label" moved from `CoverageRunner.ts`**, retention and hold policies, and compliance tags | D-01, D-02, D-07, D-11, H-06 |
| EXO / IPPS | UAL records for these operations: file access or unlabeled downloads (D-01, D-10), external share (D-04), admin role changes (E-07), a noisy alert series (E-05), sign-in anomalies (E-08), phishing-simulation clicks (G-04), and insider indicators (G-07). Also `AdminAuditLogConfig` (enabled), `TransportRule`, `OMEConfiguration`, and `ComplianceCase` / `CaseHoldPolicy` / `CaseHoldRule`. `generators/exoIpps.ts` NEW | D-01..D-03, D-06, D-10, E-01..E-10, F-04, F-08, G-04, G-07, H-04..H-06 |
| SPO / PnP | `spoTenant` with sharing capability `ExternalUserAndGuestSharing` **(gap)**, a CUI site with one stale member **(gap)**, and a PnP acknowledgement list (one user missing, **gap**). `generators/spo.ts` NEW | D-04, D-05, D-09, G-06 |
| Azure | The existing NSG, VNet and Firewall seed. Adds NSG rules (one allow-any on 3389, **gap**), `publicIpAddresses`, `routeTables`, `networkWatchers` and `flowLogs` (VNet flow logs off, **gap**), a storage account, the LAW under **both** the `logAnalyticsWorkspaces` and `OperationalInsightsWorkspace` names, `diagnosticSettings` (one resource without them, **gap**), `sentinelAlertRules` (one disabled rule, **gap**), `backupJobs` (one failed, **gap**), and `armResources` for drift | E-01, E-03, F-06, F-08, F-11..F-14, H-07 |
| Security | `secureScores` (existing), `secureScoreControlProfiles` (several unaddressed, **gap**), `alerts` (existing), and `securityIncidents` (one new high-severity incident, **gap**). `generators/security.ts` NEW | F-01, F-02, F-05, F-09, H-01, H-03, H-07, H-08 |
| Local roster (not a sim endpoint) | The tester writes a fixture training roster CSV to `trainingRosterPath` inside the run directory (one overdue user, **gap**). The sim-safe input mechanism follows AO §2.5 | G-01, G-05 |

**Resolver fixes (stacksim).** The `Update-MgIdentityConditionalAccessPolicy` collection
fix (REVIEW finding #1; mirrors `graphResolvers.ts:20-32`), the F-03 `deviceConfigurations`
naming mismatch, the F-14 `OperationalInsightsWorkspace` naming, and PnP cmdlet shimming
(OD-5).

### 3.3 Tenant records (tester, via the `sim-tenant-record.ts` overlay)

| Slug | kind | cmmcLevel | Exempt | cuiBoundary | Purpose |
|---|---|---|---|---|---|
| `aoops-g5` | sim | L2 | **false** | allowlist = every seeded `resources.*` value | Positive runs. Also exercises the gates' allow paths. |
| `aoops-g5-l1` | sim | L1 | false | same as `aoops-g5` | CL denies |
| `aoops-g5-unset` | sim | (absent) | false | absent | CS denies (strict is the default) |
| `aoops-g5-cui` | sim | L2 | false | allowlist that **excludes** the seeded firewall, VNet and storage names | CU denies |
| `dev` / any `live` | (untouched) | — | — | — | RL: must be refused (AO rail under `CES_AO_SIM_ONLY=1`, plus the tester rail) |

All four `aoops-*` records use endpoints `http://localhost:4390/*` and the same stacksim
instance.

**Readonly parameter source map.** This is required, and without it about 35 ops return 400.

- The registry uses about 30 readonly `source` paths, including `m365LicenseSkuId`,
  `baseGroupId`, `loaGroupId`, the three PIM role-def ids, `namedLocationId`, `adminGroupId`,
  `deviceComplianceCaPolicyId`, `android/iosAppProtectionPolicyId`, `keyVaultName`,
  `cuiSiteId`, `cuiGroupId`, `sentinelWorkspaceName`, `resourceGroupName`,
  `adminPortalCaPolicyId`, `operatorUPN`, `breakGlassUPN`, `itHelpDeskPhone`,
  `auditLogRetentionDays`, `trainingEnforcementGroupId`, `trainingRosterPath`, `resources.*`
  and `subscription.resource_group`.
- The UI fills these from `GET /api/tenant`, and `ParameterMapper` silently skips any
  `undefined` source.
- **S0** makes the scenario emit **deterministic seed ids** and publishes every variable value in
  the Stamper tenant object `plan-data/aoops-g5/aoops-g5.json` → `resources` (per OD-6; it replaces the manifest file), which maps each source to its seeded id, name or UPN.
- **T1's overlay** stamps every source onto all four `aoops-*` records from that tenant object.
- In `aoops-g5-cui`, the `resources.*` values are **present but excluded from the allowlist**,
  so the CU check actually fires.
- A meta-test asserts that every registry `source` resolves non-empty on `aoops-g5`.

### 3.4 Hard safety rail (tester side; the AO side is upstream)

`src/aoops/sim-guard.ts` runs **before any spawn or browser action** and aborts the run on
any of these conditions:
1. A module root (AO, EO, stacksim) does not resolve under `.worktrees/`. This blocks
   accidental use of the main checkouts, which carry other sessions' work.
2. `STACKSIM_SERVER_URL` is not `http://localhost|127.0.0.1:<port>`.
3. Any `aoops-*` record has an endpoint host other than the stacksim host, or has
   `kind !== 'sim'`.
4. `CES_AO_SIM_ONLY=1` is not set in the AO and EO child environments.
5. **After SYNC-1:** a startup probe runs against a **sentinel `kind:'live'` record** in the
   run-scoped registry root, with endpoints on a non-routable host
   (`https://graph.example.invalid`). The probe expects AO's *specific* sim-only rail refusal,
   because a "tenant not found" error proves nothing. If AO does anything else, the run aborts.
   The probe is safe even if the rail fails. A separate check asserts that an empty tenant
   field is refused, which confirms there is no `'dev'` fallback.

The guard also installs a **Playwright `context.route('**/*')` block** that aborts any
browser request to a non-localhost host, and it **refuses to run W-live steps before SYNC-1**.
This mirrors AO rule 0.1: there is no live execution until AO's rail lands.

Every run uses a run-scoped `runs/aoops/<ts>/` for `CES_PIPELINE_ROOT` (shared by the AO and
EO children so both see one `ces.db`) and for the ces-tenant registry root.

## 4. Upstream dependency on the AO session (sync points)

The AO session works on branch `ao-ops-simstack` in the main `ces` monorepo. It is the same
git repo as the `ces-mono` worktree.

| Sync | AO deliverable consumed | Tester action | Gates |
|---|---|---|---|
| **SYNC-1** | §2.1 sim-only rail (`CES_AO_SIM_ONLY`) and the `'dev'` fallback removed; §2.3 `docs/contracts/ADMINOPS-EVIDENCE-CONTRACT.md` and the correlation id on `POST /api/execute/:id`; §2.4 `docs/contracts/AO-UI-TEST-HOOKS.md` and the `data-testid` / `data-state` hooks | In the `ces-mono` worktree, merge `ao-ops-simstack` at a pinned SHA into `gp-aoops-1`. This is a merge only, with no AO edits. Rebuild AO. Re-run the ces-ao gate. Validate the Unit E loader against real contract rows. Switch the T2 selector map from the fixture to the real hooks | Start of W1–W4 real UI runs |
| **SYNC-2** | §2.2 SoD pending and rejected evidence; Tier-3 UI round trip; the `manual_gate` post-approval dispatch resolution | Re-merge at the new pinned SHA | W5, and the SD/RL cells of W6 |
| Rolling | AO-side fixes from AO's API loop (for example the A-10 role-definition source) | Re-merge per wave | Re-run affected rows |
| **SYNC-E** | ces-eo: EO GOAL-FULL-FUNCTIONALITY M1 (`AdminOpsEvidenceLoader`, `GET /api/adminops/evidence`, explorer `adminops` source) | Merge the EO session's branch at the reported SHA into the `ces-mono` worktree (merge only). Point T3's EO checker at those routes | Start of W1 real UI runs (EO assertions) |
| **SYNC-S0** | tenant-stacksim `ao-sim-coverage`: goal M1 (G5 profile, `aoops-g5` scenario, deterministic ids, manifest, resolver fixes) | In `.worktrees/stacksim`, merge `ao-sim-coverage` at the reported SHA into `gp-aoops-1`. This is a merge only, with no stacksim edits. Rebuild, then re-run the stacksim gate | Start of W1 |
| **SYNC-S** (rolling) | Stacksim goal M2 (Graph), M3 (devices), M4 (Azure), M5 (EXO/IPPS/SPO/PnP) | Re-merge at each reported SHA | W2 needs M2–M4 field seeds; W3 needs M2 + M3; W4 needs M5 (+ M4 for E-01/E-03); W5 F-13/F-14 need M4 |

**Rules:**
- Record the pinned SHA in the ledger header.
- An AO-caused red is never fixed here. It becomes `HONEST-OPEN(blocked-upstream-AO, REQ-ao-…)`
  with a REQ file in `docs/requirements/`. The founder or coordinator relays it to the AO
  session. It flips back to `PASS` after the next merge.
- AO's `REQ-stacksim-*` and `REQ-eo-adminops-ingestion` files are **acceptance input** for
  Units S1–S4 and E, not parallel work.
- **Two matrices, deliberately distinct.** AO's `AO-OPS-SIMSTACK-MATRIX.md` covers API level.
  The tester's `AO-OPS-UI-STATUS.md` covers the UI and EO level.

## 5. Work units (disjoint file sets) and file inventory

### 5.1 tester — `.worktrees/tester`

| File | Action | Unit |
|---|---|---|
| `src/aoops/sim-guard.ts` | CREATE | T1 |
| `src/aoops/simstack-up.ts` (scenario reset and serve, four tenant records, roster fixture) | CREATE | T1 |
| `src/demo/sim-tenant-record.ts` (add a `cmmcOverlay {cmmcLevel?, cmmcMigrationExempt, cuiBoundary?}` option) | MODIFY | T1 |
| `src/demo/gui-servers.ts` (`GuiServerKind` gains `'eo'`, with port, ready path and spawn; module roots are passed explicitly) | MODIFY L47-62, spawn helpers | T1 |
| `src/aoops/ao-op-driver.ts` (generic: registry-driven `param-*` fill from `GET /api/commands`, flows R/GTS/T3/FW, reads `data-state`, captures the correlation id) | CREATE | T2 |
| `src/aoops/ao-hooks.ts` (the selector map from `AO-UI-TEST-HOOKS.md`) | CREATE | T2 |
| `tests/fixtures/ao-ui-hooks-fixture.html` (the stub page before SYNC-1) | CREATE | T2 |
| `src/aoops/op-matrix.ts` (95 rows: flow, wave, inputs per op, expected state, deny cells) | CREATE | T3 |
| `src/aoops/eo-evidence-check.ts` (EO API and Evidence Explorer page assertions, and `ces.db` row lookup by correlation id, reusing `ao-evidence.ts:230-257`) | CREATE | T3 |
| `src/aoops/status-ledger.ts` (writes `docs/test/AO-OPS-UI-STATUS.{json,md}`) | CREATE | T3 |
| `src/aoops/run-aoops.ts` (the loop runner, with `--wave`, `--op` and `--deny`) and the `src/cli/index.ts` subcommand `aoops` | CREATE / MODIFY | T3 |
| `tests/aoops-sim-guard.test.ts`, `tests/aoops-driver.test.ts`, `tests/aoops-matrix.test.ts`, `tests/aoops-ledger.test.ts` | CREATE | T1 / T2 / T3 |
| `tests-e2e/aoops.e2e.ts` (deliberately **not** `*.test.ts`, so `npm test`'s default Vitest include never collects it) and `vitest.aoops.config.ts` (explicit `include: ['tests-e2e/**/*.e2e.ts']`) | CREATE | T3 |
| `package.json` (script `test:aoops`) | MODIFY | T3 |
| `docs/requirements/REQ-ao-*.md` (as the loop finds AO faults) | CREATE | loop |
| `docs/test/AO-OPS-UI-STATUS.md` / `.json` | CREATE (generated) | loop |

### 5.2 ces-eo — `.worktrees/ces-mono/ces-eo` (Unit E)

> **RESOLVED 2026-09-26: EO owns it.** The table below is reference only. No Unit E edits happen here.
> Original flag: `ces/ces-eo/GOAL-FULL-FUNCTIONALITY-2026-09-26.md`
> (G-EO-FULL-1) M1 and M8, written by another session, schedule the same `AdminOpsEvidenceLoader`,
> explorer source and AO→EO sim case as Unit E. Recommendation: that EO session owns it, and this plan
> consumes it at a pinned SHA (SYNC-E), the same way it consumes AO and stacksim. Note also that EO already
> has a partial reader: `AdminOpsEvidenceReader` feeds the assessor view (ces-mono `ae8233d`,
> repaired in `93c9810`). The new loader should build on it, not beside it.

| File | Action | Lines / functions |
|---|---|---|
| `src/eo/evidence/AdminOpsEvidenceLoader.ts` | CREATE | Reads `adminops_evidence` through `getCesRepository()` (shared `ces.db`) and maps each row to an explorer item (`id:'adminops:<evidenceId>'`, `source:'adminops'`, `controlIds`=cmmcPractices, outcome, correlationId, verdict) |
| `src/eo/server/routers/evidence-router.ts` | MODIFY | `/api/evidence-explorer/index` L188+ (add source #3, plus optional `?source=adminops&correlationId=` filters); `/api/evidence-explorer/item` L360+ (adminops detail, including deny outcome and before/after state) |
| `public/index.html` | MODIFY | Evidence Explorer page (`#page-evidence-explorer`, ~L1695): an "AdminOps" source chip and filter, an outcome badge, and `data-testid="eo-ev-item-<correlationId>"` |
| `src/eo/server/tenant-resolve.ts` | MODIFY | Under `CES_AO_SIM_ONLY=1` (shared flag), refuse non-sim tenants. This is the EO half of the rail |
| `src/eo/evidence/__tests__/AdminOpsEvidenceLoader.test.ts`, router test | CREATE | Fixture `ces.db`; every outcome in the contract enum |

### 5.3 stacksim — UPSTREAM (tenant-stacksim session; consumed at SYNC-S0 / SYNC-S)

> **Re-scoped 2026-09-26.** The units below are now executed by the tenant-stacksim session
> under `GOAL-AO-SIM-COVERAGE-2026-09-26.md` (S0 → its M1, S1 → M2, S2 → M3, S3 → M4,
> S4 → M5; its M0 empirical smoke and M6 semantic coverage gate are additions). This table is
> kept as the reference file inventory. `.worktrees/stacksim` is **merge-only** from here on.
> A sim-gap red in the loop becomes a note to that session (or `HONEST-OPEN(blocked-upstream-stacksim)`).
> It is never fixed here.

Shared touchpoints have **one owner, S0**: `SeedEngine.ts`, `ResolverTable.ts`, the profile,
and the scenario files. S1–S4 export generators and resolvers, and S0 registers them in one
small commit per wave.

| Unit | Files | Action |
|---|---|---|
| S0 | `profiles/gcc-high-g5.json`, `scenarios/aoops-g5.config.json` (+ generated `.json` and the `aoops-g5` tenant object `resources` values (OD-6)), `src/seed/generators/licensing.ts`, `src/seed/SeedEngine.ts`, `src/resolvers/ResolverTable.ts`, `src/coverage/CoverageRunner.ts` (~181-205, harness-only seeds moved to the profile) | CREATE / MODIFY |
| S1 Graph identity and security | `src/seed/generators/identity.ts`, `src/seed/generators/caPolicies.ts`, `src/seed/generators/pim.ts` (new), `src/seed/generators/security.ts` (new), `src/resolvers/graphResolvers.ts` | MODIFY / CREATE |
| S2 Devices | `src/seed/generators/devices.ts`, `src/seed/generators/deviceMgmt.ts` (new), `src/resolvers/deviceResolvers.ts` (new) | MODIFY / CREATE |
| S3 Azure | `src/seed/generators/azureResources.ts`, `src/resolvers/azureResolvers.ts`, `src/resolvers/azCliResolvers.ts` | MODIFY |
| S4 EXO / IPPS / SPO / PnP | `src/seed/generators/compliance.ts`, `src/seed/generators/exoIpps.ts` (new), `src/seed/generators/spo.ts` (new), `src/resolvers/exoResolvers.ts`, `psmodules/` PnP shim (if OD-5 = yes) | MODIFY / CREATE |
| each | co-located `*.test.ts` for its own files | CREATE |

**Parallelism.** T1 ∥ E ∥ S0 (M1). T2 ∥ T3 (M2). S1 ∥ S2 ∥ S3 ∥ S4 (M3, with S0 merging). No
two units share a file.

## 6. Waves and loop protocol

| Wave | Ops | Sim prerequisite | Count |
|---|---|---|---|
| W1 pipeline smoke | A-13 A-14 A-18 B-02 B-05 B-13 C-03 C-05 C-07 F-01 F-11 G-08 H-08 | S0 only (existing Y resolvers) | 13 |
| W2 field additions | A-01 A-02 A-05 A-06 A-08 A-11 A-12 A-16 A-17 B-01 B-03 B-04 B-06 B-07 B-10 B-11 C-06 C-09 C-10 D-08 F-03 F-05 F-06 F-07 F-10 F-12 G-02 G-03 H-03 H-07 | S1 / S2 / S3 field seeds, CA-update fix | 30 |
| W3 new Graph resources | A-04 A-07 A-09 A-10 B-08 B-09 B-12 B-14 C-01 C-02 C-04 C-08 F-02 F-09 H-01 | S1 (PIM, apps, security), S2 (Autopilot, MAM) | 15 |
| W4 EXO/IPPS/SPO/local | D-01 D-02 D-04 D-05 D-06 D-07 D-09 D-10 E-01…E-10 F-04 F-08 G-01 G-04 G-05 G-06 G-07 H-04 H-05 H-06 | S4 (+ S3 for E-01/E-03) | 28 |
| W5 Tier-3 | A-03 A-15 A-19 A-20 D-03 D-11 F-13 F-14 H-02 | SYNC-2, and S3 for F-13/F-14 | 9 |
| W6 deny matrix | every applicable CL / CS / CU / SD / RL cell | SYNC-1 (CL/CS/CU/RL), SYNC-2 (SD) | — |

**Loop (per wave):** `npm run test:aoops -- --wave Wn`
1. **Triage** each red into exactly one bucket:
   - sim gap → S1–S4
   - EO → E
   - harness → T
   - AO → a REQ-ao file plus HONEST-OPEN(blocked-upstream)
   - spec/doctrine → founder
2. **Fix** in the owning unit and re-run the red rows only.
3. Re-run the **whole wave** once all its rows are terminal. This catches regressions.
4. **Fix-cap:** after 3 failed iterations on one op, stop. Record the evidence and classify the
   row as HONEST-OPEN with a REQ, or raise a founder question.

Commit the ledger after each wave. No row may be skipped silently: the runner fails if any row
ends `PENDING` or `FAILING` at wave close.

## 7. Evidence wiring and assertions

### 7.1 AO→EO wiring (Unit E)

AO already writes to `{CES_PIPELINE_ROOT}/ces.db`, collection `adminops_evidence`
(`EvidenceEmitter.ts:93-127`). EO gains a loader over the same repository and exposes those
rows through the existing Evidence Explorer surface (`evidence-router.ts:188`), which already
aggregates Stamper and blob sources. This is a pull model with a shared DB, so no push API is
needed. `InputSourceResolver`'s `adminops` stub is out of scope (§10).

### 7.2 E-std (asserted on every executed row and every deny cell)

1. **AO UI:** the result panel `data-state` shows the expected outcome, and the evidence
   outcome badge is present.
2. **AO store:** exactly one new `adminops_evidence` row with this run's **correlation id**.
   Its `commandId`, tenant slug, outcome and `cmmcPractices` must match the registry, and it
   must conform to the contract schema.
3. **EO API:** `GET /api/evidence-explorer/index?tenant=<slug>&source=adminops` contains the
   item with the same correlation id, outcome and controlIds.
   `GET /api/evidence-explorer/item?id=adminops:<id>` returns before/after state (GTS) or the
   deny reason.
4. **EO UI:** on the Evidence Explorer page, filter AdminOps and assert
   `eo-ev-item-<correlationId>` is visible with the outcome badge. A screenshot goes to the run
   directory.
5. **Sim ledger:** R ops must produce a mutation count of 0. GTS, T3 and FW ops, once applied,
   must produce a count of 1 or more on the expected resource. A dry run must produce 0.

### 7.3 Positive case by flow

| Flow | Steps | Pass condition |
|---|---|---|
| R | select → fill params → live on, tenant `aoops-g5` → Execute | `executed` and E-std; the detect op reports its seeded **gap** object by id |
| GTS | (a) dry-run, (b) live apply, (c) live re-run | (a) preview, ledger 0; (b) applied, ledger ≥1, paired read shows the new state; (c) idempotent no-op |
| FW | Execute → precheck → `confirm` OK, plus a separate Cancel run | Cancel: ledger 0; OK: firewall state flipped, and F-11/F-12 run as a round trip that restores state |
| T3 | Requestor Execute → `pending_approval` → approvals modal as a second UPN → approve → execute the approved request | Pending creates a deny-evidence row (after SYNC-2); the approved run is `executed`, the evidence links the approvalId, and E-std holds |

## 8. Test matrix (95 rows)

Columns:
- **Positive** = the op-specific input or target (the flow per §7.3; E-std always applies).
- **CL/CS** = the applicable CMMC deny.
- **CU** = the CUI deny, which applies only where a `resources.*` param exists
  (`ParameterMapper.ts:43`).
- **SD** = SoD.

The **RL** probe is suite-level (§3.4 #5) and not per row.

| Op | Title | Tier | Flow | Sim | Wave | Positive (target / expected finding) | CMMC | CU | SD |
|---|---|---|---|---|---|---|---|---|---|
| A-01 | New User Provisioning | T2 | GTS | P | W2 | new UPN, G5 SKU assigned, added to baseGroup | CS | – | – |
| A-02 | User Offboarding – Disable | T2 | GTS | P | W2 | seeded staff UPN disabled and sessions revoked | CS | – | – |
| A-03 | User Offboarding – Hard Delete | T3 | T3 | Y | W5 | departed user deleted | CS | – | ✓ |
| A-04 | Role Change / Transfer | T2 | GTS | P | W3 | old→new group swap; PIM eligibility read | CS | – | – |
| A-05 | LOA – Suspend | T2 | GTS | P | W2 | user disabled and moved to LOA group | CS | – | – |
| A-06 | LOA Return – Restore | T2 | GTS | P | W2 | reverse of A-05 | CL | – | – |
| A-07 | MFA Enrollment Enforcement | T2 | GTS | N | W3 | SMS-only user enforced | CL | – | – |
| A-08 | MFA Method Audit – Weak Removal | T2 | R | P | W2 | finds SMS-only user | CL | – | – |
| A-09 | Privileged Role Review (PIM) | T2 | R | N | W3 | finds standing GA | CL | – | – |
| A-10 | Standing Privilege Elimination | T2 | GTS | P | W3 | standing GA converted to eligible | CL | – | – |
| A-11 | Stale Account Detection | T2 | R | P | W2 | finds the 120-day user | CS | – | – |
| A-12 | Guest / External User Audit | T2 | R | P | W2 | finds 2 guests | CS | – | – |
| A-13 | CA Policy Review | T2 | R | Y | W1 | lists seeded CA policies | CS | – | – |
| A-14 | Named Location Update | T2 | GTS | Y | W1 | trusted CIDR updated | CL | – | – |
| A-15 | Break-Glass Validation | T3 | T3 | Y | W5 | break-glass excluded from all CA | CL | – | ✓ |
| A-16 | Suspicious Sign-In Response | T2 | GTS | P | W2 | risky user confirmed compromised and blocked | CS | – | – |
| A-17 | Admin Account Separation | T2 | GTS | P | W2 | separate admin UPN created | CL | – | – |
| A-18 | Default User Permission Lockdown | T2 | GTS | Y | W1 | authorizationPolicy hardened | CS | – | – |
| A-19 | Break-Glass CA Exclusion | T3 | T3 | Y | W5 | break-glass added to CA exclusion | CL | ✓ | ✓ |
| A-20 | CA Duplicate Policy Cleanup | T3 | T3 | Y* | W5 | duplicate pair resolved | CL | – | ✓ |
| B-01 | New Device Enrollment | T2 | GTS | P | W2 | device renamed and synced | CL | – | – |
| B-02 | Compliance Policy Gap Report | T2 | R | Y | W1 | finds non-compliant kiosk | CL | – | – |
| B-03 | OS Patch Currency Audit | T2 | R | P | W2 | finds outdated OS | CS | – | – |
| B-04 | Security Baseline Drift | T2 | R | P | W2 | per-device status drift | CL | – | – |
| B-05 | Terminated-User Device Wipe | T2 | GTS | Y | W1 | departed user's device retired | CS | – | – |
| B-06 | Lost/Stolen Device Wipe | T2 | GTS | P | W2 | lost-mode enabled | CS | – | – |
| B-07 | Non-Compliant Device CA Block | T2 | GTS | P | W2 | CA updated and visible to the paired read | CL | – | – |
| B-08 | CUI App Allowlist/Blocklist | T2 | GTS | N | W3 | app added to Android MAM | CL | – | – |
| B-09 | BYOD Separation (MAM) | T2 | GTS | N | W3 | missing iOS MAM created | CS | – | – |
| B-10 | Hardware Inventory Reconciliation | T2 | R | P | W2 | finds device missing serial | CL | – | – |
| B-11 | EDR Coverage Gap Detection | T2 | R | P | W2 | finds device without EDR | CS | – | – |
| B-12 | Autopilot Profile Review | T2 | R | N | W3 | finds unassigned device | CL | – | – |
| B-13 | Device Compliance Baseline | T2 | GTS | Y | W1 | baseline policy created/updated | CL | – | – |
| B-14 | Autopilot Profile Provisioning | T2 | GTS | N | W3 | profile created | CL | – | – |
| C-01 | App Secret/Cert Expiry Alert | T2 | R | N | W3 | finds expiring and expired secrets | CL | – | – |
| C-02 | App Secret Rotation | T2 | GTS | N | W3 | secret rotated | CL | – | – |
| C-03 | Key Vault Key Rotation | T2 | GTS | Y | W1 | key rotated | CL | – | – |
| C-04 | Key Vault RBAC Audit | T2 | R | N | W3 | finds over-broad assignment | CS | – | – |
| C-05 | TLS/SSL Certificate Expiry | T2 | R | Y | W1 | finds cert expiring in 20 days | CL | – | – |
| C-06 | Service Account Password Rotation | T2 | GTS | P | W2 | service account rotated | CL | – | – |
| C-07 | Managed Identity Adoption | T2 | R | Y | W1 | finds secret-based SPN | CS | – | – |
| C-08 | Orphaned App/SPN Cleanup | T2 | R | N | W3 | finds ownerless app | CS | – | – |
| C-09 | Password Policy Compliance | T2 | GTS | P | W2 | banned list and lockout set | CL | – | – |
| C-10 | Leaked Credential Response | T2 | GTS | P | W2 | risky user remediated | CS | – | – |
| D-01 | Sensitivity Label Coverage | T2 | R | N | W4 | finds unlabeled activity | CL | – | – |
| D-02 | DLP Policy Effectiveness | T2 | R | P | W4 | DLP and UAL matches | CL | – | – |
| D-03 | DLP Incident – CUI Exfiltration | T3 | T3 | N | W5 | case and hold created | CL | – | ✓ |
| D-04 | External Sharing Audit | T2 | R | N | W4 | finds external sharing | CS | – | – |
| D-05 | CUI Site Membership Recert | T2 | R | N | W4 | finds stale member | CL | – | – |
| D-06 | Email Encryption & Transport Rules | T2 | GTS | N | W4 | transport rule created | CL | – | – |
| D-07 | Retention Policy & Legal Hold | T2 | R | N | W4 | lists retention and hold | CL | – | – |
| D-08 | Public Teams Detection | T2 | R | P | W2 | finds public team | CS | – | – |
| D-09 | CUI Repository Onboarding | T2 | GTS | N | W4 | CUI site locked down, group private | CL | – | – |
| D-10 | Oversharing Risk Report | T2 | R | N | W4 | finds oversharing events | CS | – | – |
| D-11 | CUI Label Protection Enablement | T3 | T3 | Y* | W5 | CUI label protection set | CL | – | ✓ |
| E-01 | Audit Log Retention | T2 | GTS | P | W4 | LAW retention set | CL | – | – |
| E-02 | UAL Health | T2 | R | N | W4 | UAL enabled and recent | CL | – | – |
| E-03 | Diagnostic Settings Coverage | T2 | R | P | W4 | finds resource without diagnostic settings | CL | – | – |
| E-04 | Sentinel Analytics Rule Review | T2 | R | N | W4 | UAL-based review (per registry) | CS | – | – |
| E-05 | Alert Fatigue Analysis | T2 | R | N | W4 | finds noisy series | CS | – | – |
| E-06 | Log Export to SIEM Validation | T2 | R | N | W4 | export config confirmed | CL | – | – |
| E-07 | Privileged Action Audit | T2 | R | N | W4 | finds admin role changes | CL | – | – |
| E-08 | Sign-In Log Anomaly Sweep | T2 | R | N | W4 | finds anomalies and risky user | CS | – | – |
| E-09 | C3PAO Evidence Package Assembly | T2 | R | N | W4 | package assembled | CL | – | – |
| E-10 | POA&M Evidence Closure | T2 | R | N | W4 | case updated | CL | – | – |
| F-01 | Secure Score Trend Report | T2 | R | Y | W1 | score read | CL | – | – |
| F-02 | Defender Recommendation Sprint | T2 | R | N | W3 | finds unaddressed profiles | CL | – | – |
| F-03 | ASR Rule Audit | T2 | R | N | W2 | reads deviceConfigurations | CS | – | – |
| F-04 | Legacy Auth Block Validation | T2 | R | P | W4 | CA and legacy sign-ins | CS | – | – |
| F-05 | Azure Security Benchmark Report | T2 | R | P | W2 | score and profiles | CL | – | – |
| F-06 | Resource Firewall/NSG Audit | T2 | R | P | W2 | finds allow-any 3389 | CS | – | – |
| F-07 | Admin Portal IP Restriction | T2 | GTS | P | W2 | CA updated and visible to the paired read | CL | – | – |
| F-08 | Config Drift Alert Response | T2 | GTS | P | W4 | drifted resource reverted | CL | – | – |
| F-09 | CIS Benchmark Hardening | T2 | R | N | W3 | control profiles | CL | – | – |
| F-10 | Third-Party App Consent Audit | T2 | R | P | W2 | finds over-privileged consent | CL | – | – |
| F-11 | Azure Firewall Deallocate | T2 | FW | Y | W1 | firewall deallocated (Cancel = no-op) | CL | ✓ | – |
| F-12 | Azure Firewall Allocate | T2 | FW | P | W2 | firewall re-allocated with VNet and public IP | CL | ✓ | – |
| F-13 | Enclave Subnet Deny-by-Default | T3 | T3 | P | W5 | route table and NSG baseline | CL | ✓ | ✓ |
| F-14 | VNet Flow Logs + Sentinel | T3 | T3 | N | W5 | flow logs on, rule created | CL | ✓ | ✓ |
| G-01 | Annual Security Training Audit | T2 | R | N | W4 | roster fixture: finds overdue user | CL | – | – |
| G-02 | New Hire Training Enforcement | T2 | GTS | P | W2 | user added to enforcement group | CL | – | – |
| G-03 | Role-Based CUI Training | T2 | R | P | W2 | CUI group members checked | CL | – | – |
| G-04 | Phishing Simulation Report | T2 | R | N | W4 | finds clickers | CL | – | – |
| G-05 | Personnel Screening Sync | T2 | R | N | W4 | roster fixture diff | CL | – | – |
| G-06 | NDA/AUP Acknowledgment | T2 | R | N | W4 | PnP list: finds missing acknowledgement (OD-5) | CL | – | – |
| G-07 | Insider Threat Indicator Report | T2 | R | N | W4 | finds indicators | CL | – | – |
| G-08 | Contractor Access Recert | T2 | R | Y | W1 | lists contractor | CL | – | – |
| H-01 | Security Incident Intake | T2 | GTS | N | W3 | incident classified | CL | – | – |
| H-02 | Compromised Account Containment | T3 | T3 | P | W5 | risky user contained | CL | – | ✓ |
| H-03 | Malware/Ransomware Isolation | T2 | GTS | P | W2 | device isolated | CL | – | – |
| H-04 | Timeline & Evidence Preservation | T2 | GTS | N | W4 | case and hold created | CL | – | – |
| H-05 | IR Tabletop/Drill Evidence | T2 | R | N | W4 | drill evidence case | CL | – | – |
| H-06 | Post-Incident Review Package | T2 | GTS | N | W4 | case and tag created | CL | – | – |
| H-07 | Backup Integrity Verification | T2 | R | P | W2 | finds failed backup job | CL | – | – |
| H-08 | BCP/DR Contact List & Runbook | T2 | R | Y | W1 | contact list read | CL | – | – |

**Deny cell expectations (W6).**
- **CL:** `aoops-g5-l1` → `data-state=denied`, outcome `denied_cmmc`, E-std on the deny row,
  ledger 0. 67 rows.
- **CS:** `aoops-g5-unset` → the same, with the strict reason. 28 rows.
- **CU:** `aoops-g5-cui` → `denied_cui`. 5 rows.
- **SD:** per T3 op, 5 cases:
  - no approval → `blocked_pending_approval`
  - self-approval refused (`ApprovalStore.ts:93`)
  - rejected → `approval_rejected`
  - approved but params changed → refused (params-hash)
  - approved request replayed → refused (single-use)

  45 cells.
- **RL:** `dev` / live → refused and evidenced. 1 suite probe, run with one R op and one GTS
  op, which covers the dry-run get-half.

## 9. Testing strategy

- **Unit (in `npm test`):**
  - sim-guard: each abort case from §3.4.
  - Driver: param fill and flow state machine against the hooks fixture.
  - Matrix completeness: 95 rows, and the CL/CS split is derived from the registry
    `cmmcPractices` (`.L2-`) rather than hand-set.
  - Ledger rendering.
  - EO loader over a fixture `ces.db` for every contract outcome.
  - stacksim generators and resolvers.
- **E2E (`npm run test:aoops`):**
  - One simstack per run (reset, then serve).
  - AO and EO GUIs spawned from the worktrees with a shared run-scoped root.
  - Waves run serially, because the sim state is shared.
  - GTS and FW ops use targets dedicated to each op, or restore state (F-11/F-12 pair), so
    order does not matter.
- **UI-exposure reconciliation (meta-test):** the AO UI `cmd-<ID>` count equals the
  `GET /api/commands` count, which equals the registry count of 95. Any divergence is recorded,
  not assumed.

## 10. Out of scope

- **Any edit under `.worktrees/ces-mono/ces-ao`** or the main `ces/ces-ao`. This includes the
  AO rail, deny evidence, contract, hooks, the Tier-3 UI, `manual_gate` dispatch, and the A-10
  role-GUID source. All of it belongs to the AO session.
- ces-tenant and ces-stamper changes.
- EO `InputSourceResolver` `adminops` rendering (SSP templates).
- Relabelling the stacksim `coverage-report.json`.
- The Tier-2 SoD floor on `kind:'live'` (see OD-2).
- Changes to demo and show behaviour. `src/demo/gui-servers.ts` and
  `src/demo/sim-tenant-record.ts` are only extended additively, and existing demo tests must
  stay green.
- Pushes. Merging `gp-aoops-1` anywhere.

## 11. Acceptance criteria

- [ ] M0 junction and installs done; baseline gates recorded.
- [ ] Tester rail aborts on every §3.4 condition; the Playwright route block is proven by a test.
- [ ] EO Evidence Explorer shows AO rows (API and UI) for executed, dry-run, and every deny
      outcome.
- [ ] `aoops-g5` scenario seeds the G5 SKU and every §3.2 target and gap; the stacksim gate is
      clean.
- [ ] Driver completes the R/GTS/FW/T3 flows purely through `AO-UI-TEST-HOOKS.md` hooks.
- [ ] 95/95 rows are `PASS` or `HONEST-OPEN(reason, owner, REQ)`; every applicable deny cell is
      terminal.
- [ ] Two consecutive green `test:aoops` runs on a fresh simstack; all four gates are clean;
      small commits on `gp-aoops-1`; no pushes.

## 12. Open decisions (founder)

| # | Decision | Recommendation |
|---|---|---|
| OD-1 | Merge policy for AO: pull `ao-ops-simstack` into the `gp-aoops-1` ces-mono worktree at pinned SHAs (as planned), or have the tester run AO from another location? | Pinned-SHA merge. It keeps D5 isolation and the AO session's WIP stays out |
| OD-2 | The Tier-2 SoD floor only fires on `kind:'live'`+L2+write, so it is untestable on a sim. Accept HONEST-OPEN, or ask AO for a test-only override? | HONEST-OPEN, noted in the report; a test override weakens the rail |
| OD-3 | If the M0 spike shows sim records cannot carry `cmmcLevel` / `cuiBoundary` / non-exempt through ces-tenant, allow an AO-side overlay (AO session) or a ces-tenant change? | AO-side overlay via a REQ-ao file; ces-tenant stays read-only |
| OD-4 | "Role gate" in D2: AO has no operator RBAC beyond requestor/approver UPN. Build operator roles (AO session), or scope "role/approval" to SoD only? | Scope to SoD for this task; file a REQ for operator RBAC |
| OD-5 | G-06 needs PnP.PowerShell, which the sim does not shim. Build a PnP shim in stacksim, or HONEST-OPEN? | **RESOLVED 2026-09-26: yes, build it** (stacksim goal M5) |
| OD-6 | Where do the G5 SKU and the AO variable values come from? | **RESOLVED 2026-09-26: the Stamper tenant object.** SKU from `tenant_identity.primary_sku`; all values in `plan-data/<slug>/<slug>.json` → `resources`, emitted by stacksim (its goal M1). This replaces the separate `aoops-g5.manifest.json` in §3.3 |
| OD-7 | Should `test:aoops` stay outside `npm test`, since it needs stacksim, AO and EO running? | Yes, a separate script; unit coverage stays in `npm test` |
| OD-8 | CUI deny coverage is only 5 ops, because AO checks only `resources.*` params and not user-typed resource params. Accept, or ask AO to extend the check? | Accept for now; file a REQ-ao so the gap is visible |
| OD-9 | *(Reframed after the stacksim re-scope.)* The AO session's API loop runs against `../tenant-stacksim`. Should it check out `ao-sim-coverage` there (read and run only) once the stacksim goal's M1 lands, so that both matrices measure the same seed? | Yes. Both the AO session and this plan track `ao-sim-coverage` at the same pinned SHA |
