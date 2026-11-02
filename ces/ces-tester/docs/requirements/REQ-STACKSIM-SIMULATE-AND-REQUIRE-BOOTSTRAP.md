# REQ-STACKSIM-SIMULATE-AND-REQUIRE-BOOTSTRAP

**Status:** PROPOSED — needs founder / sibling-owner triage
**Date:** 2026-08-30
**Filed by:** ces-tester (this doc is authored in ces-tester and filed *against* the sibling projects below; ces-tester implements nothing here)
**Filed against:** `tenant-stacksim` (primary owner), `ces-stamper` (secondary owner)
**Provenance:** found during the ces-tester GP-DEMO-3 provisioning audit — `docs/context/STAMPER-TENANT-PROVISIONING.md` (the four-surface onboarding-ladder audit), §6 and gap #9. The 15-vs-22 Graph-permission bootstrap dead-end (audit gap #1, fixed 2026-08-30 on ces-stamper branch `stamper-bootstrap-grant-parity`) is the concrete defect that motivated this REQ: it lived only on the live rung and could never have surfaced in sim.

---

## Acronym legend

| Term | Meaning |
|---|---|
| REQ | Requirement document (this file) |
| SP | Service Principal (Entra ID service-principal object for an app registration) |
| GA | Global Administrator (Entra ID directory role) |
| app registration | Entra ID `application` object (the `New-MgApplication` product) |
| appRoleAssignment | Graph object granting an SP an app role; **granting it *is* the admin-consent action** for Graph application permissions |
| KeyCredential | The certificate credential attached to an app registration (`Update-MgApplication -KeyCredentials`) |
| Connect gate | Stamper GUI Allow/Disallow toggle (Workflow Card 0) → `GET /api/connect` |
| PS7 / PS5.1 | PowerShell 7+ / Windows PowerShell 5.1 |
| stacksim / sim | The `tenant-stacksim` sibling — a local simulator that impersonates Graph/Az/Exchange for `kind:'sim'` tenants |
| interception | stacksim's mechanism: prepend fake modules to `PSModulePath` + `az` shim to `Path` + point `STACKSIM_SERVER_URL` at the sim server, so spawned PowerShell resolves cmdlets against the sim (`ces-tenant/src/impl/stacksim.ts:140-158`) |
| forge | ces-tester hand-building bootstrap's outputs so the sim can skip bootstrap (the thing this REQ retires) |

---

## 1. Problem statement (the fidelity gap)

Stamper's customer-onboarding ladder has four surfaces in a fixed order (audit §1): **Bootstrap → Connect → Preflight → Baseline**. Rungs 2–4 already run under stacksim interception. **Rung 1 (Bootstrap) does not exist in sim at all** — it is live-only (audit §6, line 205). Bootstrap is the rung that *creates the tenant's identity*: the app registration, its SP, the certificate KeyCredential, and the 22 Graph appRoleAssignments that every later session authenticates and consents with (`ces-stamper/scripts/New-TenantBootstrap.ps1`).

Because sim skips rung 1, the sim world must **enter the ladder at rung 2 with a pre-forged identity**. ces-tester manufactures bootstrap's outputs by hand:

- **`ces-tester/src/demo/sim-tenant-record.ts`** patches the registry's placeholder auth (`sim-app-<slug>`, `SIMTHUMBPRINT…`) with a real thumbprint + absolute `cert_path` so Stamper's Connect gate accepts it (`sim-tenant-record.ts:61-73, 138-148`).
- **`ces-tester/src/demo/stamper-prereqs.ts`** mints a real self-signed cert into `Cert:\CurrentUser\My` so Connect's cert probe passes (`stamper-prereqs.ts:95-111, 191-242`).

**Defect class that hides as a result:** anything wrong in bootstrap — a missing Graph permission (audit gap #1), the `Update-MgApplication -KeyCredentials` array-replace that detaches prior certs (gap #2), the manual `.env`→registry bridge (gap #6), the interactive-password / no-`--cert-password` seam — can only ever be caught on a live tenant with a live GA sign-in. The demo and the sim never rehearse the first, highest-friction customer rung, so onboarding regressions ship undetected.

**The requirement:** make `tenant-stacksim` able to **SIMULATE** bootstrap (intercept its cmdlets and materialize the objects it creates into the sim ledger) and **REQUIRE** it (a fresh sim tenant starts with *no* app registration / SP / grants, so Connect fails until the operator runs an intercepted bootstrap) — exactly as a real tenant world does.

---

## 2. Current behavior (cited)

### 2.1 Bootstrap is live-only and its interactive sign-in runs *before* any sim env exists

`stamper bootstrap` (CLI `src/cli/index.ts:365-452`, per audit §2) spawns `powershell.exe -File scripts/New-TenantBootstrap.ps1` with inherited stdio. The script's **step 2 is an interactive GA sign-in** — `Connect-MgGraph -Scopes … -Environment … -TenantId …` (`New-TenantBootstrap.ps1:147`) — that pops a real browser/device-code prompt against a real Microsoft endpoint and then hard-requires a non-null context (`Get-MgContext`, `:155`). This runs in a bare console **before any stacksim env bundle is applied**: interception is an env mutation on the process that will spawn PowerShell (`ces-tenant/src/impl/stacksim.ts:140-158`), and nothing in the bootstrap path arms it. This is the **core technical obstacle** — bootstrap's first Graph call bypasses interception by construction.

The full cmdlet contract a simulated bootstrap must satisfy (all from `New-TenantBootstrap.ps1`), with `-Filter` support where noted:

| Step | Cmdlet | Line | Notes |
|---|---|---|---|
| Sign-in | `Connect-MgGraph -Scopes … -TenantId …` | 147 | interactive GA (the obstacle) |
| Verify | `Get-MgContext` | 155 | must return non-null or script `exit 1` |
| App lookup | `Get-MgApplication -Filter "displayName eq '<n>'"` | 167 | reuse-by-name; `-Filter` honesty required |
| App create | `New-MgApplication -DisplayName … -SignInAudience AzureADMyOrg` | 174 | creates the `applications` object |
| Cert mint | `New-SelfSignedCertificate` | 193 | **stays real** — see §3.3 |
| Cert export | `Export-PfxCertificate` / `Export-Certificate` | 251, 255 | **stays real** |
| Attach cert | `Update-MgApplication -ApplicationId … -KeyCredentials @($kc)` | 279 | array-replace (audit gap #2) |
| Graph SP lookup | `Get-MgServicePrincipal -Filter "displayName eq 'Microsoft Graph'"` | 292 | needs the Graph SP **with its `AppRoles` array** |
| App SP lookup | `Get-MgServicePrincipal -Filter "appId eq '<appId>'"` | 306 | absent → create |
| App SP create | `New-MgServicePrincipal -AppId <appId>` | 309 | creates the app's own SP |
| Grant read | `Get-MgServicePrincipalAppRoleAssignment -ServicePrincipalId …` | 365 | skip-if-present |
| Grant | `New-MgServicePrincipalAppRoleAssignment -ServicePrincipalId … -PrincipalId … -ResourceId <graphSpId> -AppRoleId <roleId>` | 372-377 | the 22 grants (`:319-345`) |
| Validate | `Disconnect-MgGraph` → app-only `Connect-MgGraph -ClientId … -CertificateThumbprint …` → `Get-MgOrganization` | 450-464 | non-fatal on failure |

### 2.2 The sim's `Connect-MgGraph` is a no-op that validates nothing — so the forged identity always works

The generated fake `Connect-MgGraph` (`tenant-stacksim/psmodules/Microsoft.Graph.Authentication/Microsoft.Graph.Authentication.psm1:82-104`) accepts **any** `-ClientId` / `-CertificateThumbprint` and simply records them into `$script:StacksimMgContext`; `Get-MgContext` (`:106-112`) hands that back. There is no check that an SP with that `appId` exists, or that any KeyCredential matches. This is precisely why a forged `sim-app-<slug>` identity connects: **the sim has no enforcement point at which "no identity → Connect fails."** Requirement (3) below has no home until this is added.

Downstream, Stamper's Connect gate (`ces-stamper/src/server/routes/connect.routes.ts:74-144`) emits `prereq_blocked` on a missing cert or module, then runs `ensureConnected('graph')` / `ensureConnected('exchange')` (`:156, 169`). The only thing today blocking a bare sim tenant at Connect is the **cert-store probe** (audit gap #9) — which hits the *real* store outside interception — not any identity check.

### 2.3 stacksim does not model the objects bootstrap creates as *bootstrap-created*

- `KNOWN_OBJECT_TYPES` (`tenant-stacksim/src/store/schemas.ts:7-60`) has **`servicePrincipals`** (`:10`) but **no `applications` collection and no `appRoleAssignments` collection.**
- The seed generates a generic `servicePrincipals` set — `sp-1..n` with arbitrary `appId`s and **no `AppRoles` array** (`tenant-stacksim/src/seed/generators/identity.ts:16-22`) — not the CES app's own SP keyed by the tenant's `appId`, and not the Microsoft Graph SP with the resolvable `AppRoles` that `New-TenantBootstrap.ps1:355` filters on.
- `graphResolvers.ts` has **no resolver** for `New-MgApplication`, `New-MgServicePrincipal`, `Update-MgApplication -KeyCredentials`, or `New-MgServicePrincipalAppRoleAssignment` (confirmed absent). So even if bootstrap's cmdlets *were* intercepted, they would hit unmodeled create paths.
- The registry pre-seeds a **complete fake identity** on every sim tenant — `auth.app_id = sim-app-<slug>`, `cert_thumbprint = SIMTHUMBPRINT…` (`ces-tenant/src/impl/registry.ts:151-168`) — i.e. the sim tenant is born *already bootstrapped*, the opposite of a fresh real tenant.

---

## 3. Proposed requirement

### 3.1 stacksim must model the objects bootstrap creates

`tenant-stacksim` MUST model, as first-class store objects with create/read resolvers:

1. **`applications`** — a new `KNOWN_OBJECT_TYPES` collection. Resolvers: `New-MgApplication` (create), `Get-MgApplication -Filter "displayName eq …"` (reuse-by-name), `Update-MgApplication -KeyCredentials` (attach cert; honor the real array-replace semantics so audit gap #2 is reproducible in sim).
2. **The app's own `servicePrincipal`** — `New-MgServicePrincipal -AppId <appId>` must create an SP whose `appId` matches, resolvable by `Get-MgServicePrincipal -Filter "appId eq '<appId>'"`. (The existing generic `sp-1..n` seed is insufficient — none carry the tenant's `appId`.)
3. **The Microsoft Graph SP, seeded with a resolvable `AppRoles` array** — `Get-MgServicePrincipal -Filter "displayName eq 'Microsoft Graph'"` must return an SP whose `.AppRoles` contains an entry (`{Id, Value}`) for **each of the 22 permission values** in `New-TenantBootstrap.ps1:319-345`. Without this, every grant fails "permission not found in Graph API" at `:355`. **This is the second-hardest deliverable after interception** and is currently unstated anywhere.
4. **`appRoleAssignments`** — a new collection modeling consent. Resolvers: `New-MgServicePrincipalAppRoleAssignment` (create), `Get-MgServicePrincipalAppRoleAssignment -ServicePrincipalId …` (read, for the skip-if-present check at `:365`). This is the object Stamper's Preflight Phase 1 reads to diff granted-vs-required (audit §4, `execute.routes.ts:2665-2723`); modeling it here also unblocks honest Preflight fidelity in sim.

### 3.2 Bootstrap's cmdlets must reach the sim (the hard part)

The interactive `Connect-MgGraph` (`New-TenantBootstrap.ps1:147`) runs before any sim env exists (§2.1). Two candidate resolutions — sibling owners to choose:

- **Option A — sim-mode bootstrap flag (ces-stamper owns).** Add a `-Stacksim` / `--stacksim` path to the CLI bootstrap command and `New-TenantBootstrap.ps1` that (a) skips the interactive GA sign-in and the network reachability test, (b) applies the stacksim env bundle to its own process *before* the first `Connect-MgGraph` (reusing `getSimLaunchEnv()` which already returns the bundle as data for exactly this kind of external launcher — `ces-tenant/src/impl/stacksim.ts:171-226`), and (c) takes a non-interactive cert password (see §5 risk b). Pro: one script, both modes. Con: bootstrap grows a sim-awareness it otherwise has none of.
- **Option B — sim bootstrap launcher (ces-tester or a new sibling owns; stacksim provides the seam).** A launcher arms interception (`enableStacksimMode()`), then spawns `New-TenantBootstrap.ps1` as a child inheriting the mutated env, with the sole change to the script being: make the interactive sign-in and network test conditional on an env flag (e.g. `STACKSIM_SERVER_URL` present ⇒ skip). Pro: keeps sim-launch logic out of the shipping bootstrap body. Con: still requires a small conditional in the ps1.

Either way the **minimum ces-stamper change** is: the interactive `Connect-MgGraph` + `Test-NetConnection` (`:126-161`) must become skippable in sim mode, and the app-only validation reconnect (`:450-464`) must tolerate the sim.

### 3.3 The local cmdlets stay real — and that is the design win

`New-SelfSignedCertificate` / `Export-PfxCertificate` (`:193, 251`) resolve from `$PSHOME\Modules`, which interception **keeps** on `PSModulePath` (`ces-tenant/src/impl/stacksim.ts:145` appends `;${psHomeModules}`). So a simulated bootstrap mints a **real** cert into the **real** `Cert:\CurrentUser\My` and writes a real `.pfx` — which is exactly the artifact Stamper's non-intercepted Connect cert-probe (audit gap #9) needs. This is the clean argument for §3.5: simulated bootstrap produces the same real cert `stamper-prereqs.ts` forges today, via the real code path.

### 3.4 A fresh sim tenant must start WITHOUT the bootstrap-created objects (the "require" part)

1. The **seed** MUST NOT pre-create the CES app registration, its SP, or its appRoleAssignments (the generic `servicePrincipals` seed may remain, but must not include an SP whose `appId` equals the tenant's `auth.app_id`).
2. The **registry record** for a fresh sim tenant must represent an *un-bootstrapped* tenant — either the `auth.app_id`/`cert_thumbprint` are absent until bootstrap runs, or a bootstrapped-marker distinguishes the two states. (This is in tension with today's always-populated `sim-app-<slug>`/`SIMTHUMBPRINT` at `registry.ts:151-168`; see §5 open question e — owner is ces-tenant.)
3. The sim's **`Connect-MgGraph` MUST gain an enforcement point** (`…Authentication.psm1:82-104`): when connecting app-only with a `-ClientId`/`-CertificateThumbprint` for which **no SP with that `appId` and no matching KeyCredential exists in the sim store**, it must fail the way a real tenant does (empty/`$null` context, or the real Graph auth error), so `Get-MgContext` returns `$null` and Stamper's Connect surfaces a prereq/identity block rather than a green light. **Acceptance hinges on this** — without it "require bootstrap" is unenforceable.

### 3.5 What ces-tester changes once this lands

- **Retire `ces-tester/src/demo/sim-tenant-record.ts`'s auth patch** (`:61-73`) and **`ces-tester/src/demo/stamper-prereqs.ts`** cert-forging (`:95-242`) in favor of driving a simulated bootstrap that produces the same record + real cert through the real onboarding code path.
- The GP-DEMO ladder then starts at **rung 1** — the demo can show Connect *failing* on a fresh sim tenant, an operator running bootstrap, and Connect then *succeeding* — the full customer arc, not the stage-2 entry it forges today.
- ces-tester keeps only the run-scoping it legitimately owns (run-scoped registry root, absolute `cert_path`), not the identity fabrication.

---

## 4. Acceptance criteria (objectively checkable)

1. **Fresh sim tenant, no identity → Connect blocks.** A freshly seeded `kind:'sim'` tenant with no bootstrap run: `GET /api/connect?tenant=<slug>` emits `prereq_blocked` (or an identity-missing block) and does **not** report a connected Graph session — driven by the sim's `Connect-MgGraph` returning a `$null` context because no SP/KeyCredential exists (§3.4.3).
2. **Intercepted bootstrap creates the objects in the sim ledger.** Running bootstrap in sim mode (§3.2) results in the sim store/ledger holding: one `applications` object for the display name, one `servicePrincipals` object whose `appId` equals the tenant's, and **22 `appRoleAssignments`** against the Microsoft Graph SP — all queryable via `POST /ledger` / the Graph REST facade, all created by the real cmdlets, not seeded.
3. **After bootstrap, Connect succeeds.** With the same tenant, `GET /api/connect` now passes the cert probe (real cert minted by the real `New-SelfSignedCertificate`) and reports `connected_graph` — no forged record, no forged cert.
4. **Preflight sees a satisfied grant set in sim.** `GET /api/preflight` against the bootstrapped sim tenant finds the app's SP present (no "SP absent" hard error, audit §4) and the 22 Graph permissions already granted (0 missing) — proving the sim's `appRoleAssignments` model is read-compatible with Preflight's diff.
5. **ces-tester drives it end-to-end.** The GP-DEMO-3 harness runs fresh-sim → (Connect fails) → simulated bootstrap → (objects appear) → Connect succeeds → Assess/Translate/Execute, with `sim-tenant-record.ts`'s auth patch and `stamper-prereqs.ts` no longer invoked.

---

## 5. Effort / ownership split

| Deliverable | Owner |
|---|---|
| §3.1 `applications` + `appRoleAssignments` collections; app-SP-by-appId; **Microsoft Graph SP seeded with the 22 AppRoles**; the four create/read resolvers | **tenant-stacksim** |
| §3.4.3 `Connect-MgGraph` enforcement point (fail when no SP/KeyCredential in store) | **tenant-stacksim** |
| §3.4.1 seed no longer pre-creates the CES identity | **tenant-stacksim** |
| §3.2 make the interactive `Connect-MgGraph` + `Test-NetConnection` skippable in sim; tolerate app-only validation reconnect; non-interactive sim cert password | **ces-stamper** (Option A) or shared (Option B) |
| §3.4.2 fresh sim registry record represents *un-bootstrapped* state | **ces-tenant** (owns `registry.ts` / record shape) |
| §3.5 retire the forge (`sim-tenant-record.ts` auth patch, `stamper-prereqs.ts`); drive simulated bootstrap; author acceptance harness | **ces-tester** |

---

## 6. Risks / open questions

- **(a) `.env` overwrite.** Bootstrap's default `-OutputPath` is `<stamper-root>\.env` (`New-TenantBootstrap.ps1:398-403`) with `Out-File -Force` (`:437`). A sim run MUST redirect `-OutputPath` to a run-scoped path, or it clobbers a live operator's real `.env`.
- **(b) Password prompt vs. G-ENG-2.** Bootstrap prompts interactively for the cert password (`Read-Host -AsSecureString`, `:227-244`) and the CLI deliberately has **no `--cert-password` flag** (audit §2, G-ENG-2 injection-hardening). A non-interactive sim path needs a sanctioned way to supply a throwaway sim password without reopening that vector.
- **(c) PS7 vs PS5.1.** Bootstrap hard-requires PS7 (`:86-90`); the stacksim README states the fake modules and harness target **Windows PowerShell 5.1**. Open question: do the generated fake modules load and resolve correctly under `pwsh` (PS7)? If not, the sim bootstrap path needs either PS7-compatible fakes or a documented shell.
- **(d) `AppRoles` fidelity drift.** The 22-permission list is triplicated (bootstrap ps1, Preflight `REQUIRED_GRAPH_PERMISSIONS` at `execute.routes.ts:2555-2578`, and — once seeded — the sim Graph-SP `AppRoles`) — audit gap #10. A single shared source, or a coverage test asserting the sim's seeded `AppRoles` ⊇ bootstrap's list, is advisable to keep the sim honest as the list evolves.
- **(e) Identity reconciliation (the manual bridge, in sim).** Audit gap #6 (bootstrap `.env` → registry record is a manual, error-prone transcription) reappears here: after simulated bootstrap the registry record's `app_id`/`cert_thumbprint` MUST match what bootstrap created. Either sim bootstrap honors the record's pre-assigned ids, or the record is rewritten from bootstrap output. Owner (ces-tenant) must decide which, since it defines the fresh-tenant record shape (§3.4.2).
- **(f) Scope.** This REQ covers rung 1 (Bootstrap). It assumes rungs 2–4 keep working under interception (they do today, audit §6). It does **not** propose changing Preflight/Baseline beyond what §3.1's `appRoleAssignments` model incidentally improves.
