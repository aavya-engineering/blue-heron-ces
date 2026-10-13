# GOAL — Sim coverage for every AdminOps command (G-STACKSIM-AO-COVERAGE-1), 2026-09-26

> **How to use:** open a Claude Code session in `C:/Users/mhsut/DevProjects/ces/tenant-stacksim` and say:
> "Execute GOAL-AO-SIM-COVERAGE-2026-09-26.md. Iterate until the exit criteria are met."

**From:** ces-tester (AO-OPS-SIMSTACK program). **Format follows** `docs/goals/G-STACKSIM-*.md`.

## 1. Why this exists

Every CES module is pointed at the sim the same way. The launcher injects three env values from
`ces-tenant`'s `getSimLaunchEnv()` (`../ces-tenant/src/impl/stacksim.ts`):
- `PSModulePath`: this repo's `psmodules/` goes first.
- `Path`: this repo's `azshim/` goes first.
- `STACKSIM_SERVER_URL`: defaults to `http://127.0.0.1:4390`.

From then on, every cmdlet ces-ao (AdminOps, AO) runs lands here. That part works: ces-tester
already drives AO command A-18 live through the AO UI against this sim.

**The gap is on this side.** A gap review of all 95 AO commands found that the sim answers only about
16 of them with the objects and fields the command actually needs:

| Rating | Count | What it means |
|---|---|---|
| Partial | about 46 | Resolver exists, but the seed is thin or missing |
| N | about 33 | Generic auto-derived CRUD stub with no seed, or the resource family is absent entirely |

The largest hole is the Exchange Online / Purview / SharePoint cmdlet family (`Search-UnifiedAuditLog`,
eDiscovery cases, transport rules, `*-SPO*`, `Get-PnPListItem`). It covers about 28 commands
across families D, E, G and H. `SeedEngine` has no generators for it. PIM eligibility, Windows
Autopilot, MAM app protection, app secrets, risky users, security incidents, Sentinel alert rules and
several Azure network resources are also missing.

`stacksim coverage` reports 100% today. That number is **structural**: every cmdlet resolves to
*something*. It is not **semantic**: the response does not contain what the command needs to
detect or change. This goal makes the sim semantically sufficient for all 95 AO commands on a
GCC High **G5** tenant, and makes the coverage gate prove it.

## 2. Inputs (read first; re-verify every file:line against current code)

1. **The per-command gap table:**
   `C:/Users/mhsut/DevProjects/ces/ces-tester/.worktrees/tester/docs/context/REVIEW.md`, section
   "Appendix — per-command stacksim coverage (all 95 ops)".
   - It has one row per AO command: cmdlets/URIs, rating Y/partial/N, and why.
   - It was derived by reading `deriveResolversFromInventory.ts` and the resolver files. **It was
     never executed.**
2. **The seed design:** `.../ces-tester/.worktrees/tester/docs/test/PLAN-AO-OPS-SIMSTACK.md`,
   §3.1–§3.3. It gives the scenario, a seed table per area with the deliberate gaps, the four
   planned tenant records, and the readonly-source map. §3 below restates the essentials. The plan
   is the fuller reference.
3. **The AO command registry** (source of truth for cmdlets and parameter `source` paths):
   `../ces-ao/src/registry/ao-commands.registry.json`, 95 commands.
4. **AO's requirement files, as they arrive:** `../ces-ao/docs/requirements/REQ-stacksim-*.md`.
   - An AO session is running a 95-op API loop and files these per sim gap (its INSTRUCTIONS §2.6).
   - Treat each one as **acceptance input**. It is not a prerequisite, so don't wait for them.

## 3. Current state (verify)

- **Generators:** `src/seed/generators/` has `azureResources`, `caPolicies`, `compliance`,
  `devices` and `identity`.
- **Resolvers:** `src/resolvers/` has `graph`, `azure`, `azCli` and `exo`.
- **Profiles:** `m365-azure`, `m365-only`, `m365-sentinel`. There is no G5 profile.
- **Scenarios:** `demo-dib-small` and `muster-*`. There is no AO scenario.
- **`psmodules/`:** no PnP.PowerShell. `exoResolvers.ts:17` calls PnP a "stray" real module.
- **Harness-only objects:** the D-11 "Sim CUI Label" and the A-20 "Sim Duplicate CA Policy" pair
  are seeded only inside `src/coverage/CoverageRunner.ts` (~L183-205, overrides ~L59-64). A normal
  `stacksim serve` from a profile doesn't have them.
- **Known resolver defects:**
  - `Update-MgIdentityConditionalAccessPolicy` (B-07, F-07) never got the collection-name fix that
    `New-…` got (`graphResolvers.ts:20-32`). A write lands where the paired `Get-…` can't see it.
  - F-03: the `deviceConfigurations` name doesn't match.
  - F-14: `OperationalInsightsWorkspace` doesn't match the seeded `logAnalyticsWorkspaces`.
  - C-04: the auto-derived role-assignment collection name is wrong.
  - PIM: seeded role definition ids are fake, so AO's real-GUID filters (A-10) never match.

## 4. Milestones (each ends green and committed; report the SHA after each)

**M0 — Empirical smoke (do this first; it replaces trust in the table).**
- Build, then `stacksim serve` the `m365-azure` profile.
- For every row the table rates N or partial, run that row's cmdlet/URI signature once through
  the PowerShell harness (`src/coverage/psHarness.ts`), using the shims.
- Record the actual result: status, collection hit, and whether the needed fields are present.
- Write `docs/coverage/AO-SEMANTIC-BASELINE.md`, 95 rows: table rating, observed rating, and a note.
- Correct the table where reality differs. Every later milestone works from the observed rating.

**M1 — Foundation: G5 profile, AO scenario, deterministic ids, variable values in the tenant object.** ces-tester
blocks on this milestone, so do it before the resource work and **report its commit SHA**.
- **Profile:** `profiles/gcc-high-g5.json`, the `m365-azure` stance with `m365-sentinel`'s
  Sentinel pieces merged in.
  - **Generator** `src/seed/generators/licensing.ts`: `subscribedSkus` has one G5 GCC High SKU with
    consumed/prepaid units, `users[].assignedLicenses` is set, and one user is unlicensed (the gap).
  - **SKU values come from the Stamper tenant object (founder decision OD-6, 2026-09-26).**
    - Stamper's tenant manifest carries `tenant_identity.primary_sku` (`"Microsoft 365 G5"`),
      `license_count` and `addon_skus`. See `../ces-stamper/public/schemas/CES Tenant Manifest.schema.json`
      and `../ces-stamper/src/translators/ManifestReader.ts:238` (it becomes the `primarySku` variable).
      Seed the SKU's display name and units from those fields.
    - The SKU id is a deterministic **sim-style** value in the same family as the other tenant-object
      values (e.g. `sim-sku-g5`). It is published in the tenant object as `resources.m365_license_sku_id`.
      No real Microsoft GUID is used anywhere; nothing needs one.
- **Scenario:** `scenarios/aoops-g5.config.json`, shaped like `demo-dib-small.config.json`.
  - A fictional company, "Harrow Ridge Precision", `harrowridge.onmicrosoft.us`, about 25 staff,
    `environment:'gcc-high-sim'`.
  - Build it to `scenarios/aoops-g5.json`. The drift guard (`tests/integration/demo-profile.test.ts`
    pattern) must cover it.
  - A re-run is the reset.
- **Deterministic seed ids:** the same scenario gives the same ids every time.
- **Variable values live in the Stamper tenant object (founder decision, 2026-09-26). There is no
  separate manifest file.**
  - Stamper's per-tenant object is `plan-data/<slug>/<slug>.json`. This repo already generates it:
    `src/config/SimTenantConfig.ts:65-135` `buildSimTenantConfig`, written via
    `planDataTenantConfigPath`.
  - Its `resources` block (snake_case: `operator_upn`, `breakglass_upn`, `kv_name`, `vnet_name`,
    `nsg_name`, `law_name`…) plus `subscription.{subscription_id,resource_group}` are the variable
    values every consumer reads.
  - For the `aoops-g5` scenario, extend that block so it carries the seeded id, name or UPN for
    every readonly `source` path in the AO registry. Add new keys in the same snake_case style.
    Examples of AO sources to cover: `m365LicenseSkuId` (→ `m365_license_sku_id`), `baseGroupId`,
    `loaGroupId`, the three PIM role-def ids, `namedLocationId`, `adminGroupId`,
    `deviceComplianceCaPolicyId`, `android/iosAppProtectionPolicyId`, `cuiSiteId`, `cuiGroupId`,
    `sentinelWorkspaceName`, `adminPortalCaPolicyId`, `trainingEnforcementGroupId`. Reuse existing
    keys where one already fits (`kv_name`, `operator_upn`, `breakglass_upn`,
    `subscription.resource_group`). Derive the full list from the registry. Don't copy it from here.
  - The values must be the ids the seed actually created, not parallel literals. Build them from
    the seeded store, or from the same deterministic id function the seed uses.
  - Existing keys and values for `demo-dib-small`, `muster-*` and the `sim-m365-*` profiles stay
    byte-identical. Additions are for `aoops-g5` only, unless a change is deliberate and noted.
  - Write `docs/coverage/AO-SOURCE-TO-TENANT-KEY.md` (AO registry `source` → tenant-object key). AO
    re-points its registry `source` paths to these keys (its GOAL M3), so also file
    `docs/requirements/REQ-ao-source-paths.md` here with that table.
  - A test asserts that every registry `source` maps to a non-empty tenant-object value. If a source
    has no sim home, list it explicitly as not applicable, with the reason (e.g.
    `trainingRosterPath` is a local file that ces-tester writes).
- **Harness-only seeds:** move the D-11 and A-20 objects out of `CoverageRunner.ts` into the
  profile or scenario seed. Keep the overrides pointing at them.
- **Resolver fixes:** the four defects listed in §3.

**M2 — Graph identity and security.** Update `identity.ts`, `caPolicies.ts` and `graphResolvers.ts`;
create `pim.ts` and `security.ts`.

| Object | Seed | Deliberate gap |
|---|---|---|
| Users | Staff, an operator UPN, a break-glass UPN, a service account, a contractor | — |
| `signInActivity` | On every user | One user inactive 120+ days |
| Guests | `userType:'Guest'` | 2 guest users |
| `riskyUsers` | Risky-user records | One at high risk |
| Auth methods | Per-user auth methods | One SMS-only user |
| Groups | Group types (`Unified`) and seeded memberships | One group with `visibility:'Public'` |
| PIM | `roleEligibilitySchedules` and `roleAssignments` on the **real built-in role template GUIDs** (Global Administrator, Privileged Role Administrator, Security Administrator) | One standing GA assignment |
| Applications | Applications with `passwordCredentials` | One secret expiring in 10 days, one expired, one app with no owners |
| SPNs | Service principals | One SPN on a secret instead of a managed identity |
| `appRoleAssignments` | App role assignments | One over-privileged consent |
| Directory settings | `directorySettings` and a password-policy template | — |
| `secureScoreControlProfiles` | Control profiles | Several unaddressed |
| `securityIncidents` | Incidents | One new high-severity incident |

- Add a `roleEligibilityScheduleRequests` POST resolver for PIM.
- Serves A-01…A-12, A-16, A-17, C-01, C-02, C-04, C-06…C-10, D-08, D-09, E-08, F-02, F-05, F-09,
  F-10, G-02, G-03, G-08, H-01, H-02.

**M3 — Devices.** Update `devices.ts`; create `deviceMgmt.ts` and (if needed) `deviceResolvers.ts`.

| Object | Seed | Deliberate gap |
|---|---|---|
| Device `osVersion` | On every device | One outdated |
| Serial number and model | On every device | One missing |
| AV/EDR fields on `detectedApps` | Per device | One device with none |
| Compliance | Per-device compliance status | A non-compliant kiosk |
| `windowsAutopilotDeploymentProfiles` | Deployment profiles | One device unassigned |
| Android `managedAppProtections` | Present | — |
| iOS `managedAppProtections` | — | The iOS policy is absent |

- Device actions (rename, sync, lost mode, retire, isolate, remote assist) must change the stored
  device, not just return 200.
- Serves B-01…B-14, H-03.

**M4 — Azure.** Update `azureResources.ts`, `azureResolvers.ts` and `azCliResolvers.ts`.

| Object | Seed | Deliberate gap |
|---|---|---|
| NSG rules | NSG rules | One allow-any on 3389 |
| Network | `publicIpAddresses`, `routeTables`, `networkWatchers` + `flowLogs` | VNet flow logs off |
| Storage account | One storage account | — |
| Log Analytics workspace | Reachable under both `logAnalyticsWorkspaces` and `OperationalInsightsWorkspace` | — |
| `diagnosticSettings` | Diagnostic settings | One resource without them |
| `sentinelAlertRules` | Alert rules, with `Get/New-AzSentinelAlertRule` resolvers | One disabled rule |
| `backupJobs` | Backup jobs | One failed |
| `armResources` | ARM resources for drift | — |

- Serves E-01, E-03, F-06, F-08, F-11…F-14, H-07.

**M5 — Exchange Online / Purview / SharePoint / PnP (the biggest milestone).** Create `exoIpps.ts` and
`spo.ts`; update `compliance.ts` and `exoResolvers.ts`.
- **Unified audit log records that `Search-UnifiedAuditLog` can filter:**
  - file access and unlabeled downloads (D-01, D-10)
  - external share (D-04)
  - admin role changes (E-07)
  - a noisy alert series (E-05)
  - sign-in anomalies (E-08)
  - phishing-simulation clicks (G-04)
  - insider indicators (G-07)

  Honour the date-range, operations and record-type parameters AO actually sends. Read them from
  the registry command text.
- **Exchange and Purview objects:**
  - `AdminAuditLogConfig` (enabled)
  - `TransportRule` and `OMEConfiguration`
  - retention and hold policies, and compliance tags
  - `ComplianceCase` / `CaseHoldPolicy` / `CaseHoldRule`, with New/Set that persist
- **SharePoint:**
  - `spoTenant` with sharing capability `ExternalUserAndGuestSharing` (gap)
  - a CUI site with one stale member (gap)
  - a PnP acknowledgement list with one user missing (gap)
- **PnP shim (founder approved, OD-5, 2026-09-26):** build a minimal PnP.PowerShell shim in
  `psmodules/` that supports `Connect-PnPOnline` and `Get-PnPListItem` (plus whatever else AO's
  G-06 command text calls), backed by the seeded acknowledgement list.
- Serves D-01…D-07, D-10, D-11, E-01…E-10, F-04, F-08, G-04, G-06, G-07, H-04…H-06.

**M6 — Semantic self-certification (the gate that makes "done" checkable without AO).**
- Extend `src/coverage/CoverageRunner.ts` (with `AoExtractor`) so it can run every AO command's
  get and set halves against the **`aoops-g5` scenario seed**, not the harness-injected objects.
- For each command, assert a **semantic** expectation, not only "resolved":
  - Detect-type commands find their deliberate gap.
  - Get-then-set writes are visible to the paired read afterwards.
  - Actions change store state.
- Keep the expectations in one data file keyed by command id (e.g. `coverage/ao-semantic-expectations.json`).
- Emit `coverage/ao-semantic-report.json` and a readable `docs/coverage/AO-SEMANTIC-COVERAGE.md`
  (95 rows).
- Add an `npm run coverage:ao` script. Keep it out of plain `npm test` if it needs PowerShell;
  otherwise it self-skips off Windows.

## 5. Ground rules

1. **Sim only.** Nothing may reach a real tenant or the internet. Every endpoint is loopback.
   Every tenant, user, SKU and domain is fictional.
2. **Write boundary = `ces/tenant-stacksim`.** You may read ces-ao, ces-eo, ces-tenant, ces-shared
   and ces-tester. If one of them needs a change, file
   `docs/requirements/REQ-<sibling>-<topic>.md` here and report it. Never edit a sibling. **Do not
   touch `ces-tester/.worktrees/stacksim`.** It is ces-tester's worktree of this same repo, on
   branch `gp-aoops-1`.
3. **Branch and working tree.**
   - Work on a new branch, `ao-sim-coverage`, created from the current HEAD (`9170eb8` at the
     time of writing). This checkout is on `gp-demo-1-stacksim-p02`, and
     `session-tenant-stacksim-2026-07-28.md` has another session's uncommitted edit. Leave that
     edit alone.
   - Stage by explicit path. Never `git add -A` or `git add .`.
   - **No force-push, and no push** without the founder's say-so.
   - ces-tester will merge `ao-sim-coverage` into its worktree at the SHAs you report.
4. **Shared touchpoints have one writer per commit:** `SeedEngine.ts`, `ResolverTable.ts`, the profile
   and the scenario files. Register new generators and resolvers in a small commit of their own.
5. **Gates before every commit:** `npx tsc --noEmit` and `npm test` (drift guard included) are both
   clean. Every generator or resolver ships with a co-located `*.test.ts`.
6. **Do not break existing consumers.** `demo-dib-small`, the `muster-*` scenarios and the
   `muster-harvest.test.ts` property ("adding a scenario adds a test") must stay green and unchanged
   in output, unless a fix is deliberate and noted.
7. **Honesty.**
   - A command the sim can't serve without a founder decision, or without work in another module,
     is `HONEST-OPEN`: record the exact reason and the unblocking REQ or decision.
   - Never make a semantic check pass by canned responses keyed on the command id. The sim must
     really execute against its store.
   - The coverage report must never claim more than it checked.
8. **No personal identity** (names, emails or handles) in code, fixtures, docs or commits.
9. **Session log:** `session-tenant-stacksim-2026-09-26.md` (and later dates), per the global rule.
   Update `collective-tenant-stacksim.md`'s health line at each milestone.

## 6. Exit criteria

1. M0 baseline committed, and the table corrected against observed behaviour.
2. M1 landed and its SHA reported:
   - `stacksim scenario aoops-g5` seeds the G5 SKU (values from the Stamper tenant object), every §4 target and every
     deliberate gap, with deterministic ids;
   - the tenant object's `resources` covers every registry `source`, the source→key table and
    `REQ-ao-source-paths.md` are filed, and the coverage test is green;
   - the harness-only seeds are gone from `CoverageRunner.ts`;
   - the four resolver fixes are in, each with a regression test.
3. `npm run coverage:ao` against `aoops-g5`: **95/95 commands semantically PASS, or are HONEST-OPEN
   with a reason plus a REQ** (G-01/G-05 are not sim endpoints, since they read a local roster
   CSV that ces-tester writes; G-06 is expected to PASS via the PnP shim).
4. Every `REQ-stacksim-*.md` that ces-ao has filed by then is either satisfied (cite the test) or
   answered in a reply note beside it in this repo.
5. `npx tsc --noEmit` and `npm test` are clean. The existing scenarios' outputs are unchanged.
   The commits are small and unpushed on `ao-sim-coverage`.
6. The final report gives: SHAs per milestone; the 95-row semantic table summary (PASS / HONEST-OPEN
   counts); new generators, resolvers and shims; REQs filed.

## 7. Founder decisions (resolved 2026-09-26)

| # | Decision | Ruling |
|---|---|---|
| OD-5 | PnP.PowerShell shim for G-06? | **Yes.** Build it (M5) |
| OD-6 | Where do the G5 SKU and other variable values come from? | **The Stamper tenant object.** SKU name and units from `tenant_identity.primary_sku` / `license_count` / `addon_skus`; every AO variable value in `plan-data/<slug>/<slug>.json` → `resources` (M1) |

## Legend

| Term | Meaning |
|---|---|
| AO | ces-ao AdminOps (95 admin commands, families A–H) |
| EO | ces-eo EvidenceOps |
| Y / partial / N | Review ratings. Y = hand-authored resolver plus the needed seed fields; partial = mixed or thin seed; N = generic stub with no seed, or the resource is absent |
| Structural vs semantic coverage | "The cmdlet resolves" vs "the response has what the command needs" |
| G5 | Microsoft 365 G5 (GCC High) licensing |
| PIM | Privileged Identity Management |
| MAM | Mobile Application Management (app protection) |
| EXO / IPPS / SPO / PnP | Exchange Online / Purview (compliance) PowerShell / SharePoint Online / PnP.PowerShell |
| Unified audit log | The audit log `Search-UnifiedAuditLog` queries |
| GA | Global Administrator |
| M0–M6 | Milestones of this goal |
| OD-5 / OD-6 | Founder decisions (now resolved), numbered as in ces-tester's PLAN-AO-OPS-SIMSTACK.md §12 |
| Stamper tenant object | `plan-data/<slug>/<slug>.json` (client, tenant, auth, endpoints, `resources`, `subscription`); generated for sims by `SimTenantConfig.ts` |
| REQ | A requirement file under `docs/requirements/` |
| HONEST-OPEN | Not passing, recorded with its reason and unblocking REQ/decision, never masked |
