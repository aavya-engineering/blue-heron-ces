# GOAL — AdminOps full functionality (2026-09-26)

> **How to use:** open a Claude Code session in `C:/Users/mhsut/DevProjects/ces/ces-ao` and say:
> "Execute GOAL-FULL-FUNCTIONALITY-2026-09-26.md together with INSTRUCTIONS-FROM-TESTER-2026-09-26.md.
> Iterate until the exit criteria of both are met."

## Relationship to INSTRUCTIONS-FROM-TESTER-2026-09-26.md (read that first)

`INSTRUCTIONS-FROM-TESTER-2026-09-26.md` (INSTR) already specifies six things:

- the sim-only safety rail (§2.1)
- deny-path evidence for SoD pending/rejected (§2.2)
- the evidence contract and the EO requirement (§2.3)
- UI test hooks and the Tier-3 round trip (§2.4)
- the 95-op build→run→fix loop against stacksim (§2.5)
- stacksim requirement files (§2.6)

**This goal does not repeat any of that.** It adds the defects that INSTR does not name. A module-status assessment (2026-09-26) found them in code. Each one would stop INSTR's loop from producing honest PASS rows, or would make a PASS mean less than it says.

Source assessment: `C:/Users/mhsut/DevProjects/ces/ces-strategy/docs/context/module-status/adminops.json` (functionality ids AO-01..AO-24 below come from it).

**Do the work in this order:**

1. INSTR §2.1, the sim rail. It is P0.
2. This goal's milestones M1–M4. They change what evidence rows contain, so they must land before the contract doc in INSTR §2.3 is versioned.
3. INSTR §2.2–§2.4.
4. This goal's M5–M6.
5. INSTR §2.5–§2.6.

## Current state (from code + tests, commit 07a8a29 + uncommitted UI edits)

- **Tests:** 217/217 pass and `npx tsc --noEmit` is clean. But every test that executes a command mocks PowerShell with a stub that returns exit 0 regardless of `dryRun`. No op is proven against stacksim.
- **Per-op rating:** 43 Implemented, 52 Partial. Domains A–H (AO-04..AO-11) are all rated Partial.
- **Missing:** AO→EO hand-off (AO-21).
- **Stub:** `POST /api/commands/:id/execute` (AO-22).
- **Founder claim:** the "assume AO is fully operational" directive is **not** supported by the code. Do not cite it as evidence.

## Target state

Every functionality AO-01..AO-24 is **Implemented**, with tests that would fail if the behaviour regressed. In particular:

- Evidence rows are truthful: dry-run vs. live, real before/after state, distinct deny outcomes.
- Every command binds its parameters from a real tenant record.
- The CUI boundary cannot be overridden by request inputs.
- The UI renders what the API actually returns.
- AO→EO is unblocked from AO's side: contract, fields, requirement filed.

## Milestones (each ends green + committed on `ao-ops-simstack`)

### M1 — Truthful get-then-set state (AO-12, AO-13, AO-17)

- **Problem:** `src/execution/GetThenSetExecutor.ts:64` and `:88` call `adapter.execute(..., true)`. The third argument is Stamper's `dryRun`, and its legacy path then returns the fixed placeholder `"[dry-run] PowerShell commands validated"` (`ces-stamper/src/adapters/PowerShellAdapter.ts:134-155`). As a result, pre-state and post-state are never real, `stateChanged` is simply `setResult.success`, and the README's claim that pre-state is emitted as evidence is false.
- **Decide and document:**
  - On a **live** run, both gets run for real (`dryRun=false`).
  - On a **dry-run**, either run the get for real only when the target is a verified sim (INSTR §2.1 guard), or skip it and label the preview "no state read."
- **Replace `stateChanged = setResult.success`** with a before/after comparison. When the two outputs cannot be compared, record `verification: 'unverified'`.
- **Acceptance:** new unit tests with a mock that distinguishes `dryRun` true from false. They must prove three things:
  - (a) a live write issues gets with `dryRun=false`;
  - (b) the evidence `preStateOutput`/`postStateOutput` equal the mock's get outputs;
  - (c) a dry-run against a non-sim tenant makes zero adapter calls with `dryRun=false`.

### M2 — Dry-run and deny evidence are distinguishable (AO-12, AO-14, AO-15, AO-17)

- **Problem:** every dry-run writes a WORM row with `outcome: automated_success` and `complianceVerdict: SAT`, and has no `dryRun` field. `environment` is hardcoded to `'GCC-High'` (`src/utils/evidenceBuilder.ts:248`). CMMC and CUI denies get `failed_no_remediation`, the same outcome as an ordinary failure.
- **Row fields to add:**
  - `dryRun`
  - `tenantKind`
  - `tenantSlug`: pass it into `resolveCesIdentity` at `EvidenceEmitter.ts:108`, which today passes `tenantId` only.
  - `requestorUPN`, `approvalId` where present
  - `correlationId`: INSTR §2.3 defines it; persist it here.
  - `environment` derived from the stack/kind
- **Verdicts and outcomes:**
  - A dry-run must never carry `SAT`. Use a `PREVIEW` verdict, or omit the verdict.
  - Denies get a distinct outcome (`denied_cmmc` / `denied_cui`) that aligns with INSTR §2.3's outcome enum.
- **Stop swallowing persistence failures** (`CommandExecutor.ts:94-97`). Surface `evidencePersisted:false` on the result and log it.
- **Acceptance:**
  - A test per path (dry-run, live success, live failure, CMMC deny, CUI deny) asserts the new fields and the outcome/verdict.
  - A test proves a persistence error is surfaced, not silent.
  - Update `test/evidenceBuilder.test.ts` expectations deliberately. Do not weaken them.

### M3 — Every sourced parameter resolves (AO-03 and 26 ops)

- **Problem:** the registry `source` values for 26 commands name top-level `TenantConfig` fields that parsed ces-tenant records do not have. Examples: `operatorUPN`, `keyVaultName`, `globalAdminRoleDefId`, `cuiSiteId`, `trainingRosterPath`. So `mapAoParametersToVariables` returns nothing for them. `execute.routes.ts:75` skips required-checks for sourced params, so these commands run with literal or empty placeholders.
- **Affected commands:** A-01, A-05, A-06, A-09, A-11, A-14, A-15, A-17, B-06, B-07, B-08, B-09, C-03, C-05, D-05, D-09, E-01, F-07, F-08, G-01, G-02, G-03, G-05, H-01, H-02, H-03.
- **Fix, AO side only:**
  - Re-point each `source` to the path where records actually carry the value (e.g. `resources.<name>`).
  - Fail closed with a clear 400 error and a deny-style evidence row when a required sourced param does not resolve.
  - Remove the hardcoded GA GUID in A-10 (`TemplateRegistry.ts:47,49`) in favour of a sourced role id.
- If a value has no home in the tenant schema, file `docs/requirements/REQ-ces-tenant-<field>.md`. Do not edit ces-tenant or ces-shared.
- **Acceptance:**
  - A data-driven test over all 95 commands, using a parsed-shape tenant fixture (the field layout in `ces-tenant/src/impl/tenant-file.ts:195-215`). It asserts that every required sourced param resolves, and that no `{name}` / `${name}` placeholder survives in the resolved command text.
  - A test that an unresolvable source fails closed with evidence.
  - Fix the E2E fixture comment that wrongly claims dotted-path resolution.

### M4 — CUI boundary cannot be overridden (AO-15)

- **Problem:** `ParameterMapper.ts:43-50` checks a `resources.*` config value, then `:56-58` lets `userInputs` with the same key overwrite it unchecked. User-typed resource parameters are never boundary-checked.
- **Fix:**
  - Config-sourced params win over user inputs. A user input for a sourced param is rejected unless it equals the config value.
  - Boundary-check every final resource-identifying variable, not only the config-sourced ones. Declare which params are resource identifiers in the registry (a new optional field), so the check is explicit.
- **Acceptance:**
  - A test where a request overrides `resourceGroup`/`firewallName` with an out-of-boundary value is denied with `denied_cui` evidence.
  - A test where a user-typed resource param outside the boundary is denied.
  - The existing ParameterMapper tests stay green.

### M5 — UI renders the real result; web apply guard; stub route (AO-01, AO-13, AO-18, AO-19, AO-22)

- **Result panel** (`public/index.html:1276-1287`): the badge should read `evidence.complianceVerdict`, and the verdict text should read `evidence.verdictRationale`. Also show `dryRun` and the correlation id.
- **Firewall precheck** (`index.html:1112-1122`): parse `result.result.stdout`. Show "state unavailable in dry-run" unless M1 gives a real read.
- **Auto-fill:** support dotted sources, reload the tenant config when the tenant field changes, and stop posting readonly fields as user inputs. This ties to M4.
- **Web apply guard:** a live `dryRun:false` via HTTP requires an explicit server-side arming, mirroring CLI `--apply` and MCP `AO_MCP_ALLOW_APPLY`. Examples: env `CES_AO_ALLOW_APPLY=1`, or the INSTR §2.1 sim-only rail.
- **Stub route:** delete `POST /api/commands/:id/execute` (`commands.routes.ts:14-23`), or return 410.
- **Health:** report the real package version.
- **Copy:** replace "85 commands" with the registry-derived count. This overlaps INSTR §2.4; do it once.
- **Mind INSTR rule 0.3:** `public/index.html` and `AoServer.ts` carry another session's uncommitted edits. Ask before committing a mixed file.
- **Acceptance:**
  - DOM-level tests (the `guiTenantSelection.test.ts` style, or jsdom) for the badge/verdict mapping and the precheck parse.
  - An HTTP test proving `dryRun:false` is refused without arming.
  - A test that the stub route is gone or returns 410.

### M6 — Sim targeting from the web/MCP surfaces (AO-20)

- **Problem:** only the CLI (`--stacksim`) calls `requestAoStacksimMode`. Sim routing is process-level (`PSModulePath` + `STACKSIM_SERVER_URL`, `ces-tenant/src/impl/stacksim.ts:140-155`), not the record's endpoints.
- **Fix:**
  - Add a server start flag (`ao gui --stacksim [url]`) and an MCP env switch that enable stacksim mode before any session spawns.
  - Extend the INSTR §2.1 guard so a `kind:'sim'` record is refused unless stacksim mode is active in the process. A matching URL is not enough.
- **Acceptance:**
  - A test (mocked controller, as in `test/simTenant.test.ts`) that the GUI start path enables stacksim.
  - A test that a sim record is refused when stacksim mode is not active.

## Ground rules

1. **Sim only.** Nothing may reach a real tenant or any non-localhost endpoint. No live execution until INSTR §2.1 lands.
2. **Write boundary = `ces/ces-ao` only.** For ces-eo, ces-tenant, ces-shared, ces-stamper and tenant-stacksim, file `docs/requirements/REQ-<target>-<topic>.md` (what, why, evidence, acceptance test). Never edit a sibling. The EO-side ingestion (AO-21) is EO's work: file `REQ-eo-adminops-ingestion.md` per INSTR §2.3, pointing at the contract version produced after M2.
3. **Small green commits** on `ao-ops-simstack`. Stage only your own files by explicit path. Never `git add -A`. **No force-push; no push** without the founder's say-so.
4. **Gates before every commit:** `npx tsc --noEmit` and `npm test`, both clean.
5. **No personal names, emails or handles** in any committed content, fixtures included. Use `@<tenant>.onmicrosoft.us` placeholder UPNs.
6. **HONEST-OPEN reporting.** Anything that can't be made to pass is recorded with the exact reason and the requirement that unblocks it. Never weaken an assertion to get green. Two existing tests currently codify gaps:
   - `commandExecutionE2E.test.ts:228` asserts that there is **no** evidence for a halted Tier-3;
   - the E2E mock treats every dry-run as a success.

   Change both deliberately, alongside INSTR §2.2 and M2.
7. **Session log:** `session-ces-ao-2026-09-26.md` and later dates.

## Exit criteria (all, in addition to INSTR §4)

1. M1–M6 acceptance tests exist and pass. `npx tsc --noEmit` and `npm test` are clean.
2. No evidence row can be both `dryRun:true` and `SAT`. Every row carries `dryRun`, `tenantSlug`, `tenantKind` and a distinct outcome for each terminal path.
3. On a live write, `preStateOutput`/`postStateOutput` come from real reads. No evidence field contains the adapter's dry-run placeholder string.
4. A data-driven test proves all 95 commands resolve every required sourced param against a parsed-shape tenant record, with zero surviving placeholders.
5. A CUI-boundary override via request input is denied and evidenced.
6. The web route refuses live execution unless armed, and the stub route is gone.
7. `adminops.json` re-assessed by the next module-status pass shows every AO-NN functionality Implemented. The only exception is AO-21, which may remain blocked on EO's REQ, recorded HONEST-OPEN.

## Legend

| Term | Meaning |
|---|---|
| AO | ces-ao AdminOps |
| EO | ces-eo EvidenceOps |
| INSTR | INSTRUCTIONS-FROM-TESTER-2026-09-26.md |
| AO-01..AO-24 | Functionality ids from the 2026-09-26 module-status assessment (`adminops.json`) |
| M1–M6 | Milestones of this goal |
| SoD | Separation of duties |
| Tier-3 | AO's two-person approval class |
| CUI | Controlled Unclassified Information |
| CMMC | Cybersecurity Maturity Model Certification |
| WORM | Write-once-read-many (the `adminops_evidence` collection) |
| SAT / PREVIEW | Compliance verdict values; PREVIEW is proposed here |
| stacksim | tenant-stacksim simulated tenant |
| GA | Global Administrator |
| REQ | A requirement file under `docs/requirements/` |
| HONEST-OPEN | Not passing, recorded with its reason and unblocking requirement, never masked |
| P0 | Blocking priority |
