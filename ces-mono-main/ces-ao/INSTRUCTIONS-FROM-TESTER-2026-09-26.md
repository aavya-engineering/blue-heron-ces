# Instructions from ces-tester → ces-ao — AO-OPS-SIMSTACK (2026-09-26)

> **How to use:** open a Claude Code session in `C:/Users/mhsut/DevProjects/ces/ces-ao` and say:
> "Execute INSTRUCTIONS-FROM-TESTER-2026-09-26.md. Iterate until the exit criteria are met."

---

## PROMPT

You are working in **ces-ao (AdminOps, "AO")**. ces-tester is building an end-to-end suite that
stands up a fully configured **GCC High G5 simulated tenant (stacksim)** and drives **every one of
AO's 95 commands through the AO web UI**, proving that (a) each op works against the sim,
(b) its evidence is visible in ces-eo (Evidence Ops, "EO"), and (c) disallowed ops are denied.
Your job is to make **AO's side** of that true, then **iterate — build → run → fix → re-run —
until every exit criterion below is met.** Do not stop at a plan. Do not stop at the first green
test. Stop only when the matrix (§6) is fully resolved and the gates are clean, or when you are
genuinely blocked on a founder decision (then ask).

The gap review this is based on is at
`C:/Users/mhsut/DevProjects/ces/ces-tester/.worktrees/tester/docs/context/REVIEW.md` — read it
first. Its file:line citations were taken from a snapshot of this repo (commit 07a8a29); re-verify
each against current code before acting.

### 0. Ground rules (non-negotiable)

1. **Sim only.** Nothing you run may reach a real tenant. `graph.microsoft.us`,
   `management.usgovcloudapi.net`, `login.microsoftonline.us`, and every other non-localhost
   endpoint are off-limits to any test or manual run. Work item §2.1 makes AO enforce this. Until it lands,
   do not run live execution at all.
2. **Write boundary.** Modify only files under `ces/ces-ao`. You may READ ces-eo,
   tenant-stacksim, ces-tenant, ces-stamper, ces-shared, and ces-tester, and you may RUN stacksim
   (`node ../tenant-stacksim/bin/stacksim.mjs serve ...`). If a fix belongs in another project,
   write it up as a requirement file in `ces-ao/docs/requirements/REQ-<target>-<topic>.md`
   (what, why, evidence, acceptance test) and list it in your final report. Do not edit the
   sibling.
3. **Shared working tree.** This checkout contains ANOTHER session's uncommitted UI/theme work
   (at the time of writing: `public/index.html`, `public/ces-ui.css`,
   `public/ces-theme-toggle.js`, `src/server/AoServer.ts`, `package.json`, `collective-ces-ao.md`).
   Run `git status` before starting. Create branch `ao-ops-simstack` for your work. **Stage only
   your own files by explicit path. Never `git add -A` / `git add .`.** If a file you must change
   already has someone else's uncommitted edits (likely `public/index.html` or `AoServer.ts`),
   do NOT commit a mixed file. Stop and ask the founder how to sequence it.
4. **No force-push. No push without founder say-so.** Small green commits.
5. **Honesty.** An op that cannot be made to pass is recorded as `HONEST-OPEN` with the exact
   reason and the requirement file that would unblock it. Never mask, skip silently, or weaken an
   assertion to get green.
6. **Identity.** No personal names, personal emails, or handles in any committed content.
7. Session log: keep `session-ces-ao-2026-09-26.md` (and later dates) per the global rule.
8. Gates before every commit: `npx tsc --noEmit` and `npm test` both clean.

### 1. Context: who does what

| Owner | Responsibility |
|---|---|
| **ces-ao (you)** | Every command executes correctly against stacksim; deny paths deny and write evidence; evidence rows carry a stable, documented contract EO can ingest; the UI is stably drivable by Playwright; no path can reach a real tenant. |
| ces-tester | The full-UI Playwright suite (all 95 ops), the G5 simstack scenario, cross-tool assertions (AO → EO). It consumes your UI hooks and evidence contract. |
| ces-eo | Ingesting `adminops_evidence` and showing it (today EO's `adminops` input source is a stub: `ces-eo/src/.../InputSourceResolver.ts` → "Data source not implemented: adminops"). **Not your job:** file the requirement (§2.3). |
| tenant-stacksim | Resolvers and seed data for endpoints AO calls. **Not your job:** file requirements for gaps (§2.6). |

### 2. Work items (do them in this order; each ends green and committed)

**2.1 Sim-target safety rail (P0: do this first).**
- Before any Graph/ARM/EXO dispatch, assert that the resolved tenant record's endpoints are
  consistent with its `kind`. For `kind:'sim'`, every endpoint must be `http://localhost:<port>` or
  `http://127.0.0.1:<port>`, matching `STACKSIM_SERVER_URL` when that is set. Refuse otherwise, with a
  clear error and deny evidence.
- **Detect "stacksim mode is active" from the environment, not from a flag.** *(Amendment
  2026-09-26, later the same day. It governs this item and GOAL-FULL-FUNCTIONALITY M6's "stacksim
  mode active in the process".)* Sim routing is process-level. It is three env values that
  `ces-tenant`'s `getSimLaunchEnv()` / `enableStacksimMode()` produce
  (`ces-tenant/src/impl/stacksim.ts:140-155`, `launch-context.ts` `SimLaunchEnv`):
  - `PSModulePath`: stacksim `psmodules` first
  - `Path`: the stacksim `azshim` first
  - `STACKSIM_SERVER_URL`

  Two launch paths set them, and **both must count as active**:
  - (a) AO's own `--stacksim` flag (`src/cli/index.ts:63-80`), which calls `requestAoStacksimMode`;
  - (b) an **external launcher that injects them into AO's inherited env**. This is how ces-tester
    starts AO today: `node dist/cli/index.js gui --port <n>`, with no flag
    (`ces-tester/src/demo/gui-servers.ts:89-122,178` `buildGuiChildEnv`).

  Implement one pure predicate, e.g. `isStacksimModeActive(env)`. It is true only when
  `STACKSIM_SERVER_URL` is a loopback `http://localhost|127.0.0.1:<port>` URL **and** the first
  `PSModulePath` segment (case-insensitive key) is a directory that contains the stacksim shim
  modules (e.g. `Microsoft.Graph.Authentication`). The `--stacksim` path should end up satisfying
  the same predicate, so there is one truth, not two. A check keyed only on
  "`requestAoStacksimMode` was called" would refuse every sim run ces-tester launches.

  Keep two things separate:
  - This predicate answers "*where will the cmdlets go?*". Under an inherited sim env, even a
    `kind:'live'` record's cmdlets hit the sim shims.
  - `CES_AO_SIM_ONLY=1` (below) answers "*which records may run?*". Both checks are needed.

  Tests: (a) predicate true for a ces-tester-style injected env; (b) false when `PSModulePath` is
  real or `STACKSIM_SERVER_URL` is non-loopback or absent; (c) a sim record is refused when the
  predicate is false; (d) `CES_AO_SIM_ONLY=1` together with a predicate-false env refuses
  everything.
- Add an explicit test/automation mode: env `CES_AO_SIM_ONLY=1`. When it is set, refuse ANY
  non-sim tenant (including `kind:'live'`) at the execute route and at `CommandExecutor`, and write
  deny evidence.
- Fix the `'dev'` fallback. `plan-data/dev/dev.json` carries real GCC-High endpoints and gets
  migrated into the registry as `kind:'live'`, and `index.html` and `executeCommand()` both fall back to
  `'dev'`. Remove the silent fallback: no tenant means an error, not `'dev'`. Also stop that
  fixture from carrying real endpoints, or mark it so it can never dispatch. See
  `docs/goals/G-AO-CMMC-BOUND-1.md`, which already tracks this pattern.
- `GetThenSetExecutor` currently runs the get-half live even when `dryRun` is true. Under
  sim-only mode it must go through the same guard. Decide and document whether dry-run should
  perform any network read at all. The safe default is no, unless the target is a verified sim.
- Tests: unit tests prove a `live`-kind or real-host record is refused under `CES_AO_SIM_ONLY=1`,
  a sim record with a non-localhost endpoint is refused, and a correct sim record passes.

**2.2 Deny paths all write evidence.**
- The CMMC scope gate (`CmmcScopeGate`) and the CUI boundary (`ParameterMapper.checkCuiBoundary`)
  already route through `CommandExecutor.denyWithEvidence`. Add tests that prove it for each.
- The SoD / Tier-3 **pending-approval stop** (`CommandExecutor` returns `pending_approval`) and
  **approval rejection** (`ApprovalStore.recordApprovalDecision`) currently write NO evidence
  row. Make both write an `adminops_evidence` record with a distinct outcome (e.g.
  `blocked_pending_approval`, `approval_rejected`) so the audit trail exists.
- For each of the 9 Tier-3 ops (A-03, A-15, A-19, A-20, D-03, D-11, F-13, F-14, H-02), prove:
  (a) execute without approval is blocked and evidenced; (b) self-approval by the requesting UPN
  is refused; (c) approval by a second UPN, then re-execute, runs.
- **Open question you must resolve (read-only check):** after approval, `engine='manual_gate'` is
  what reaches `adapter.execute()`. Confirm in `ces-stamper` whether `PowerShellAdapter` actually
  dispatches the Graph/ARM call for `manual_gate` or treats it as attestation-only. If it doesn't
  dispatch, decide AO-side how a post-approval Tier-3 op reaches the sim (e.g. swap back to the
  real engine after approval). If that needs a Stamper change, file `REQ-stamper-...`.

**2.3 Evidence contract for EO.**
- Document AO's `adminops_evidence` row schema in `docs/contracts/ADMINOPS-EVIDENCE-CONTRACT.md`.
  Include command id, tenant slug, tenant kind, outcome (executed / dry_run / denied_cmmc /
  denied_cui / blocked_pending_approval / approval_rejected / failed), CMMC practice ids, a
  correlation/run id, timestamps, before/after state, and the evidence verdict. Version it.
- Make sure every execution path (success, failure, each deny, dry-run) emits a row that
  conforms. Add a schema-conformance test.
- Accept an optional **correlation id** header or field on `POST /api/execute/:commandId`, persist
  it on the evidence row, and return it. The ces-tester suite uses it to find "the row for this
  UI click" in EO.
- Fix `EvidenceEmitter.ts`'s stale docstring. Evidence goes to `ces.db` / `adminops_evidence`, not
  the filesystem path it claims.
- File `docs/requirements/REQ-eo-adminops-ingestion.md`: EO must read `adminops_evidence` from the
  shared `ces.db` (same `getCesRepository()`), map it to an EO source type, and display it
  (per-command, per-tenant, including deny outcomes) at a stable UI location and API route. Point
  to the contract doc as the acceptance schema.

**2.4 Make the UI stably drivable (the tester drives all 95 ops through it).**
- Add stable `data-testid` hooks, without changing visual behavior:
  - per-command list item: `cmd-<ID>`
  - form fields: `param-<name>`; keep the existing ids and add the testids
  - live toggle, tenant input, execute
  - the firewall precheck/confirm modal (F-11/F-12)
  - the approvals modal, approver input, approve and reject buttons
  - result status badge, evidence outcome badge, evidence verdict, correlation id display
- Expose each result's final state in a machine-readable attribute, e.g.
  `data-state="executed|denied|pending_approval|failed"` on the result panel. Tests should not
  have to parse prose.
- Make the Tier-3 flow drivable end to end in the UI: request → pending → second-UPN approve
  → re-execute. Today the requestor must manually re-run Execute with the `approvalId`. At minimum
  surface the approvalId in the DOM; better, offer "execute approved request".
- Fix the stale "85 commands" copy. Derive the count from the registry.
- **Mind rule 0.3:** `public/index.html` has another session's uncommitted edits. Ask before
  committing if it is still dirty.
- Write `docs/contracts/AO-UI-TEST-HOOKS.md` listing every hook. ces-tester codes against it.

**2.5 Make every op execute correctly against stacksim (the main loop).**
- Stand up stacksim locally from `../tenant-stacksim` (read/run only). Point AO at it with
  `requestAoStacksimMode()` (`kind:'sim'`, endpoints `http://localhost:4390/...`). The tester's
  pattern for a usable sim record (cert thumbprint and path patched post-creation) is in
  `ces-tester/src/.../sim-tenant-record.ts`. Reuse the idea.
- Build an AO-local integration suite (e.g. `test/integration/ops-simstack.test.ts`, opt-in via
  `CES_AO_SIM_ONLY=1` + a running stacksim) that executes **each of the 95 commands** through
  `POST /api/execute/:id`, with correct parameters, in both dry-run and live-against-sim modes.
  Assert: expected outcome; one conforming evidence row written; for write-shaped ops, the sim
  state actually changed and the paired read sees it.
- **Loop:** run all 95 → triage each failure → fix it in AO if the fault is AO's (wrong
  endpoint, param mapping, get-then-set logic, parser, evidence emission) → re-run → repeat. Keep
  going until every op is `PASS` or `HONEST-OPEN` with a filed requirement.
- Known AO-adjacent issues from the review to check first:
  - B-07/F-07: `Update-MgIdentityConditionalAccessPolicy` may write to a collection the paired
    read can't see. Determine whether AO or stacksim is at fault.
  - A-10: the PIM filter uses real Global Admin role GUIDs that won't match seeded ids. Make the
    role-definition source tenant-derived, not hardcoded.
  - G-01/G-05 use `Import-Csv` (a local roster), not a tenant endpoint. Define a sim-safe input
    for them.

**2.6 File stacksim requirements for everything AO can't fix.**
The review found about 33 of 95 ops with no sim coverage and about 46 partial. The largest cluster is
`Search-UnifiedAuditLog` / eDiscovery / EXO / IPPS / SPO / PnP (about 20 ops across D, E, G and H). Also
PIM eligibility, Windows Autopilot, MAM/BYOD, Application secrets, RiskyUser, SecurityIncident,
RouteTable, NetworkWatcher/FlowLog, Sentinel alert rules, and G5 license/SKU. For each gap your
loop proves, write or extend `docs/requirements/REQ-stacksim-<resource>.md`:
- which ops it blocks
- the exact cmdlets/URIs and request shapes AO sends
- the response shape and seed fields AO needs, including deliberate "gap" objects so
  detect-type ops have something to find
- an acceptance test

ces-tester will carry these to stacksim.

**Update (founder decisions 2026-09-26):**
- **Stacksim now has its own goal:** `../tenant-stacksim/GOAL-AO-SIM-COVERAGE-2026-09-26.md`, on
  branch `ao-sim-coverage`. Your REQ-stacksim files are acceptance input to it.
- **Where readonly parameter values live:** the **Stamper tenant object**, `plan-data/<slug>/<slug>.json`
  → `resources` (snake_case, e.g. `kv_name`, `operator_upn`) and `subscription.*`. ces-tenant parses that
  object (`ces-tenant/src/impl/tenant-file.ts`), and stacksim generates it for sim tenants.
- **The license SKU follows the same rule:** name and units come from the tenant manifest's
  `tenant_identity.primary_sku`, and the id is published as `resources.m365_license_sku_id`.
- **Point your registry `source` paths at those keys** when you do GOAL-FULL-FUNCTIONALITY M3. Stacksim will
  file `docs/requirements/REQ-ao-source-paths.md` in its repo with the exact source → key table. Use
  that table rather than inventing key names. If you need a key before it lands, propose it in a REQ file.

### 3. Deny-case matrix you must prove (per applicable op)

| Deny | How to trigger against the sim | Expected |
|---|---|---|
| CMMC scope gate | L2-only command vs. a sim tenant with `cmmcLevel: 1` and no migration exemption | denied, `denied_cmmc` evidence row |
| CUI boundary | resource parameter outside the tenant's `cuiBoundary` | denied, `denied_cui` evidence row |
| SoD / approval | Tier-3 (or Tier-2 floored on live+L2+write), no approval / self-approval / rejected | blocked, evidence row per §2.2 |
| Sim-only rail | `kind:'live'` or non-localhost endpoint under `CES_AO_SIM_ONLY=1` | refused, evidence row |

### 4. Exit criteria (ALL must hold)

1. The §2.1 guard is in place and tested. No code path defaults to a real-endpoint tenant.
2. Every deny path (CMMC, CUI, SoD pending, SoD rejected, sim-only rail) denies and writes a
   contract-conforming evidence row, each proven by a test.
3. The evidence contract doc exists, and every execution path conforms (schema test green).
4. UI hooks are in place and documented, and the Tier-3 round trip is completable in the UI.
5. `docs/test/AO-OPS-SIMSTACK-MATRIX.md` has **95 rows**: command id, family, tier, params used,
   dry-run result, live-vs-sim result, evidence row verified (Y/N), deny cases proven, status
   `PASS` / `HONEST-OPEN (REQ-...)`. **Zero rows in any other state.**
6. Every `HONEST-OPEN` row cites a filed `docs/requirements/REQ-*.md` naming the owning project
   and the precise unblock condition, and AO-side causes are fixed rather than parked.
7. `npx tsc --noEmit` and `npm test` are clean, and the integration suite runs green (PASS rows) against a
   fresh `stacksim serve`.
8. All work is committed on `ao-ops-simstack`, only your files staged, no pushes.

### 5. Iteration protocol

- After each full integration run, update the matrix and append a short run record to the session
  log: counts `PASS` / `HONEST-OPEN` / `FAILING`, what you fixed, what's next.
- `FAILING` must reach 0. Each cycle, pick the biggest AO-side failure cluster first.
- If the same failure survives three fix attempts, write down the evidence, classify it
  (AO bug / sim gap / contract question), and either file the requirement or ask the founder.
  Don't loop blindly.
- When stacksim or EO ship a requirement you filed, re-run the affected rows and flip them to `PASS`.

### 6. Final report (when done)

Summarize for the founder:
- the counts (PASS / HONEST-OPEN)
- the commits on `ao-ops-simstack`
- the requirement files filed, grouped by owning project
- the evidence contract version
- the UI hooks doc
- any decisions you need from the founder

Include a legend for any shorthand you coin, and end with a bulleted E-summary.

### Legend

AO = ces-ao AdminOps · EO = ces-eo Evidence Ops · stacksim = tenant-stacksim simulated tenant ·
G5 = Microsoft 365 GCC High G5 licensing · CMMC = Cybersecurity Maturity Model Certification ·
CUI = Controlled Unclassified Information · SoD = Separation of Duties · Tier-3 / `manual_gate` = AO's
two-person approval class · PIM = Privileged Identity Management · EXO / IPPS = Exchange Online /
Purview PowerShell · SPO = SharePoint Online · PnP = PnP.PowerShell · MAM/BYOD = Mobile App
Management / Bring Your Own Device · HONEST-OPEN = op recorded as not-passing, with a filed
requirement naming why, never masked · P0 = blocking severity from the gap review.
