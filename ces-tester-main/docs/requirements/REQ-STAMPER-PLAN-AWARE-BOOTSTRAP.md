# REQ-STAMPER-PLAN-AWARE-BOOTSTRAP — The onboarding flow must consume the Infrastructure Manifest so Stamper can build anything MP/IM calls for

- **Status:** **rev 2.1 — IM/MP authorship corrected to ces-muster (founder 2026-08-30).** rev 2 — founder ruling 2026-08-30 supersedes rev 1's recommendation. The *whether* is now settled by the founder; only the *how* (mechanism) is open. rev 1's Options A–D and findings are KEPT below as record — see §7 for what rev 2 changes. rev 2.1 re-attributes IM/MP authorship from `ces-planner` to `ces-muster` (the go-forward vendored copy) per the founder statement below — see the **IM/MP authorship** note directly under this header; the mechanism/findings are otherwise unchanged.
- **Founder ruling (verbatim, authoritative):** *"bootstrap should know what IM says. 100%. that is the point of IM. E.g. the called-for might include azure. stamper must be ready to build anything MP can throw at it."*
- **What the ruling settles:** the onboarding/bootstrap **flow** MUST consume the Infrastructure Manifest (IM), and Stamper MUST be able to provision anything MP/IM calls for, Azure included. rev 1's "NO — do not make bootstrap plan-aware" (its §4) is **OVERRULED**; do not re-litigate it. rev 1's *grounded findings* survive and are reframed below from objections into requirements (§8).
- **Filed by:** ces-tester (GP-DEMO-3 provisioning audit)
- **Filed against:** sibling `ces-stamper` + `ces-muster` (the go-forward IM/MP author — see the IM/MP authorship note below; `ces-planner` is its legacy origin) (and, for the IM-driven onboarding rung, `tenant-stacksim` — this is multi-repo work; see §12).
- **Date:** 2026-08-30 (rev 1); 2026-08-30 (rev 2, post-ruling)
- **Provenance:** ces-tester GP-DEMO-3 tenant-provisioning audit (`docs/context/STAMPER-TENANT-PROVISIONING.md`) + founder question *"Should bootstrap take input from the mission plan about what infrastructure must exist (e.g. Azure)?"* → founder ruling above.
- **Boundary note:** This doc is a design proposal for the ces-stamper / ces-muster (go-forward IM/MP author; ces-planner = legacy origin) / tenant-stacksim teams to consider. ces-tester implements nothing here. All `../ces-stamper`, `../ces-muster`, `../ces-planner`, `../tenant-stacksim` references are read-only grounding.
- **Cross-link:** a *simulated* bootstrap (see `REQ-STACKSIM-SIMULATE-AND-REQUIRE-BOOTSTRAP.md`) must, if bootstrap becomes IM-aware, also model the IM-driven provisioning pass this doc introduces — the sim ladder can no longer stop at identity.
- **IM/MP authorship (rev 2.1 correction — founder 2026-08-30):** *"ces-muster is supposed to be the better-function but same-export replacement for ces-planner."* Accordingly, **`ces-muster` is the go-forward author of both the Infrastructure Manifest (IM) and the Mission Plan (MP).** Muster authors them through its own non-vendored plan adapters (`ces-muster/src/features/plan/tenantManifestAdapter.ts` — `buildTenantManifest()` :153-180 calls the vendored `generateInfrastructureManifest()` at :171; `buildManualPlan()` :195-215 calls the vendored `generateManualPlan()` at :198; both run one shared `compilePlan()` :112-147 → vendored `compileGapSet` :117 → `compileTaskCatalog` :125, with knowledge banks dependency-injected via `compilerBanks.ts` :20). The generators themselves are **vendored** from ces-planner into `ces-muster/src/vendored/ces-planner/mpt/services/` — same export surface, hence "same-export replacement." **Every `ces-planner/...` IM/MP citation in this doc should be read as its go-forward home `ces-muster/src/vendored/ces-planner/mpt/services/...`**; ces-planner is the legacy **origin** that muster vendors-and-diverges-from. Load-bearing convenience for the reader: the vendored `infraManifestGenerator.ts` is currently line-for-line identical to planner's (830/830, import paths aside), so **every line number cited below carries over verbatim** to muster's copy (`:76` placeholder subscription id, `:96` posture vocab, `:182-196` empty-string sentinel map, `:378`/`:392` `AZ-LOG-002a/b/c` drift, `:692` dead-wired `deriveInfraSteps`). The go-forward FIX therefore lands in muster's vendored copy (or upstream in planner then re-vendored to keep the two in sync).

---

## Acronym legend

| Term | Meaning |
|---|---|
| SP | Service Principal (Entra ID service principal for an app registration) |
| RG | Azure Resource Group |
| LAW | Log Analytics Workspace |
| KV | Azure Key Vault |
| CMK | Customer-Managed Key (KV key used for encryption) |
| NSG | Network Security Group |
| RBAC | Role-Based Access Control (Azure subscription/resource role assignments) |
| MP | Mission Plan (the CES human-readable plan of CMMC control remediation) |
| IM | Infrastructure Manifest — carrying `stamper_variable_map` + rich per-resource specs + `infrastructure_model` posture. **Authored go-forward by `ces-muster`** (via its vendored ces-planner generator; see the IM/MP authorship note above); `ces-planner` is the legacy origin. (rev 1 called this "Manifest.") |
| TCP | Tenant Config Profile (the questionnaire / question-bank answers about a tenant) |
| SI Baseline | System Integrator Baseline (the SI's tenant/scoping answers, incl. `infrastructure_model`) |
| SI | System Integrator (the party running the engagement; authors the SI Baseline) |
| ODP | Organization-Defined Parameter (a policy value; provenance source `policy_odp`) |
| Posture / model | The infra tier for a tenant (`m365_only` / `m365_sentinel` / `m365_azure`; baseline's own names differ — see Finding B / §8) |
| Coverage matrix | The IM-expressible-vocabulary × current-Stamper-capability table (§9) — what Stamper builds today vs what IM can call for, gaps named |
| Conformance gate | A build/CI check (§10) that fails loudly when IM's vocabulary grows a resource/registry-id Stamper cannot yet provision, so Stamper can never silently under-provision |
| FD | `FUNCTIONAL_DESCRIPTION.md` (ces-stamper's self-description doc; carries the ownership drift in §1.4 / Finding D) |
| GA | Global Administrator (Entra directory role) |
| RG/LAW/KV/CMK | Resource Group / Log Analytics Workspace / Key Vault / Customer-Managed Key (the core Azure infra objects; see rows above) |
| REQ | Requirement doc (this proposal is one), filed in `docs/requirements/` |

---

## 7. Rev 2 — what the ruling changes (READ FIRST)

rev 1 asked *whether* onboarding should be IM-aware and answered "no." The founder answered **yes, 100%** — IM is the point, and Stamper must build anything MP/IM calls for, Azure included. So rev 2 keeps every grounded fact rev 1 established and re-points them: rev 1's objections become the **build list** for honoring the ruling. Sections 1–6 below are the rev 1 record (findings intact; its §4 recommendation overruled). Sections 7–12 are rev 2.

The design must satisfy the ruling **without** pretending the chicken-and-egg ordering rev 1 documented (§2) does not exist. The reconciliation (§11) is: the onboarding **flow** consumes IM whenever IM exists, in **either arrival order**, and the IM-driven pass is **re-runnable** so one identity can outlive many re-plans.

---

## 8. rev 1's findings, reframed as rev 2 requirements

Each is a *live, grounded* defect that must be fixed to honor the ruling — not an argument against it.

- **R1 — Wire IM through to Stamper (kill the dead wire).** `deriveInfraSteps` (`ces-planner/.../infraManifestGenerator.ts:692`) is called only by its own test; IM reaches Stamper today only by an operator hand-carrying a file into a path field (`baseline.routes.ts:103-119`). **Requirement:** IM must flow to the onboarding flow by a named contract (auto-discovery of the planner's `infrastructure-manifest_*.json`, or an explicit `-InfraManifest` handoff), not by hand.
- **R2 — Own Azure *subscription* onboarding.** VERIFIED: no surface grants the app SP its Azure **subscription** RBAC. Bootstrap runs zero Az cmdlets (`New-TenantBootstrap.ps1`, 0 occurrences); the only Azure RBAC anywhere is *resource-scoped* grants in the infra registry during **execute** (`infra-cmmc-l2-commands.registry.json:293, 438, 1236`). Baseline simply assumes `Connect-AzAccount -ServicePrincipal` already has rights to create RGs/KVs. **Requirement:** an owned step must grant the SP subscription RBAC (Contributor or a scoped custom role) and register the 11 resource providers (`registry.json:13`, `AZ-PREFLIGHT-001`) — the elevation the ruling's "build anything" presupposes.
- **R3 — Reconcile the posture vocabulary to one authority.** Baseline accepts `m365_only | m365_foundation | m365_full_infra` (`baseline.routes.ts:78`); IM/planner emit `m365_only | m365_sentinel | m365_azure` (`infraManifestGenerator.ts:96,120,208`). These are not even the same *cuts*: IM's `m365_sentinel` = RG + LAW + Sentinel only (`infraManifestGenerator.ts:120-149`), which is **less** than baseline's `m365_foundation` (RG+LAW+Storage+KV+CMK+Automation); baseline has no sentinel-only tier and IM has no foundation tier. **Requirement:** adopt the **planner's** vocabulary as authoritative (it authors `infrastructure_model`); baseline maps/accepts it, and the middle tier is defined once.
- **R4 — Correct the FD ownership drift.** `FUNCTIONAL_DESCRIPTION.md:56-57` claims stamper owns `src/generators/infraManifestGenerator.ts` "from TCP questionnaire inputs." That file does not exist in stamper; the generator lives in the planner codebase and stamper is a pure consumer (`BaselineProvisioner.ts:19-23,42-45`). **Requirement:** fix the FD so the record names the IM author correctly — which, go-forward, is **`ces-muster`** (its vendored ces-planner generator; see the IM/MP authorship note near the top), with ces-planner as the legacy origin.

---

## 9. Coverage matrix — "anything MP can throw at it," bounded to the IM schema

"Anything" is **not** infinite. It is exactly what `infraManifestGenerator.ts`'s vocabulary can express: the `stamper_variable_map` resource set × the three `infrastructure_model` postures, with each resource spec citing `registry_entry_ids` into the ~72-entry infra registry. Bounding "anything" to that schema is what keeps this design from drifting into a universal Azure engine.

**The load-bearing fact:** `BaselineProvisioner` consumes **only the flat 14-key `stamper_variable_map`** (`BaselineProvisioner.ts:12-17,42-45,65-150`) — it never reads IM's rich per-resource specs (SKUs, CMK algorithm, WORM, NSG rules, CA policies…). So everything IM expresses beyond those 14 names is provisioned either by the **infra command registry at execute** or **by nothing at all from IM**.

| IM resource_type (vocabulary) | IM calls for | Stamper builds today | Where | Gap |
|---|---|---|---|---|
| resource_group | RG @ location | ✅ `New-AzResourceGroup` | baseline (`BaselineProvisioner.ts:68-75`) | none |
| log_analytics_workspace | LAW PerGB2018 | ✅ | baseline (`:76-83`) | none |
| storage_account | Standard_**ZRS** + **CMK** (Microsoft.Keyvault) + public-net Disabled | ⚠️ Standard_**GRS**, **no CMK wiring**, public-net not set | baseline (`:84-91`) | **CMK envelope + ZRS + network lockdown not built by baseline** (CMK RBAC is registry `AZ-LOG-002`/`:293`) |
| storage_container (WORM) | 3 **immutable/locked** containers, retention=wormDays | ❌ none | — | **WORM immutability unbuilt by baseline** (registry `AZ-LOG-002` handles it at execute; IM also cites `AZ-LOG-002a/b/c` which are **not** discrete registry entry_ids — traceability drift) |
| key_vault | **Premium** + RBAC-auth + purge + public-net Disabled + soft-delete 90d | ⚠️ default SKU, `-EnablePurgeProtection` only | baseline (`:92-99`) | **SKU/RBAC/network/soft-delete not built** |
| key_vault_key (CMK) | **RSA-HSM 4096** | ⚠️ `-Destination Software` (not HSM) | baseline (`:100-107`) | **HSM-backed CMK not built** |
| automation_account | Basic + SystemAssigned MI | ✅ | baseline (`:108-115`) | none (RBAC → registry `AZ-AUTO-003`/`:1201`) |
| virtual_network | VNet + address space | ✅ | baseline (`:124-131`) | none |
| subnet | **5 subnets** (pe, mgmt, identity, AzureFirewall, +) | ⚠️ **only `snet-pe`** | baseline (`:132-139`) | **4 of 5 subnets unbuilt; mgmt/identity/fw have empty `registry_entry_ids` → registry doesn't build them either** |
| network_security_group | NSG + **DenyInternetInbound rule** | ⚠️ NSG created **empty** | baseline (`:140-147`) | **deny rule not applied** |
| private_dns_zone | 2 zones (vault, blob) | ✅ registry `AZ-NET-003/004` | execute | none (not baseline) |
| private_endpoint | 2 PEs (KV, blob) | ✅ registry `AZ-PE-001/002` | execute | none (not baseline) |
| diagnostic_setting | 5 (KV, SA, Auto, Sub, Entra) | ✅ registry `AZ-DIAG-002/003/005/006`, `AZ-LOG-003` | execute | none (not baseline) |
| sentinel_onboarding | Sentinel + CMMC 2.0 hub | ✅ registry `AZ-SEN-001` | execute | none (not baseline) |
| defender_for_cloud | 4 plans Standard | ✅ registry `AZ-FOUND-003` | execute | none (not baseline) |
| policy_assignment | CMMC L2 initiative | ✅ registry `AZ-FOUND-002` | execute | none (not baseline) |
| role_assignments | Automation MI ×4 roles | ✅ registry `AZ-AUTO-003` | execute | none (not baseline) |
| entra_account (break-glass) | 1 break-glass acct | ❌ **`registry_entry_ids: []`** | — | **not wired from IM**; plausibly covered by the main CMMC registry via MP execute, but **no IM linkage** |
| conditional_access_policy | CA-MFA-All, CA-Block-Legacy | ❌ **`registry_entry_ids: []`** | — | **not wired from IM** (same caveat) |
| service_principal (EO) | EO automation SP | ❌ **`registry_entry_ids: []`** | — | **not wired from IM** (same caveat) |

**Named gaps (what Stamper cannot build from IM today):** (a) baseline builds the foundation scaffold at **lower fidelity** than IM specifies — KV SKU/RBAC/network, storage CMK+ZRS+WORM, HSM CMK, NSG rules, and 4 of 5 subnets are dropped because baseline reads only the 14 flat names; (b) the identity tier (break-glass, 2 CA policies, EO SP) and the 3 non-PE subnets carry **empty `registry_entry_ids`** — no IM→provisioner linkage anywhere; (c) **posture-consumability**: an `m365_sentinel` IM fills 9 of 14 variable-map keys with **empty strings** (`infraManifestGenerator.ts:182-196`), and `BaselineProvisioner`'s constructor rejects empty strings (`BaselineProvisioner.ts:42-44`) — so a sentinel-posture IM **throws** unless the tenant-config overlay rescues it (proof the overlay is load-bearing today — see §11 point 4).

---

## 10. Conformance gate — the engineering translation of "ready for anything"

Without a gate, IM's vocabulary can grow a resource Stamper silently skips (exactly gaps (a)/(b) above). **Requirement:** a build/CI **coverage check** that, for every IM `resource_type` and every `registry_entry_ids` an IM can emit, asserts a mapped Stamper capability exists — a `BaselineProvisioner` resource definition **or** an infra-registry `entry_id`. It fails loudly when:

1. IM emits a `resource_type` no provisioner covers, or
2. IM cites a `registry_entry_ids` value absent from the registry (this check already has a hit: `AZ-LOG-002a/b/c`), or
3. a `stamper_variable_map` key is added that no consumer reads.

This is "stamper must be ready to build anything MP can throw at it," made checkable: the day the planner adds a resource, CI red-flags Stamper before a tenant is under-provisioned.

---

## 11. Reconciling rev 1's objections as design (not blockers)

- **Chicken-and-egg (rev 1 §2) → design for BOTH arrival orders.**
  - *(i) IM present at onboarding:* the flow consumes it — identity **+** subscription-RBAC elevation (R2) **+** infra readiness primed from IM.
  - *(ii) IM absent:* identity-only now; an **IM-driven provisioning pass** runs when IM lands, and is **RE-RUNNABLE** as plans evolve. Re-runnability also dissolves rev 1's "one identity outlives many re-plans" — the identity is minted once; the IM pass re-runs per plan.
- **"Third writer" (rev 1 §Option D con) → resolved under the ruling's own principle.** "That is the point of IM" ⇒ **IM is the single source of truth for infra resource values.** So baseline's tenant-config overlay (`baseline.routes.ts:133-150`) is **demoted from co-writer to derived-from-IM**. Caveat (sequencing): the overlay is **load-bearing today** — it rescues the empty-string sentinel map (§9 gap c) and supplies the real `subscriptionId`, which IM currently sets to a **generated placeholder** (`infraManifestGenerator.ts:76` — "real sub ID comes from TCP or manual input"). **Therefore demotion requires ces-planner to first capture the real subscription ID into IM** (§12), else the single-source-of-truth IM cannot supply what the overlay supplies.

---

## 12. The one genuine fork (founder-decision item) + recommendation

Both mechanisms satisfy "bootstrap knows what IM says"; they differ in blast radius.

- **Fork-1 — IM consumed *inside* `New-TenantBootstrap.ps1`** (e.g. an optional `-InfraManifest` param): one command, but couples Graph-identity minting to Azure-subscription provisioning.
- **Fork-2 — a distinct IM-driven provisioning rung** immediately after identity, that the `bootstrap` CLI **chains automatically** (the *flow* is IM-aware; the identity script stays clean).

**Recommendation: Fork-2, chained by the CLI.** Reasoned, citation-backed:
1. **Re-runnability requires it.** Re-running `New-TenantBootstrap.ps1` is **destructive** — it replaces the whole KeyCredentials array and detaches prior certs (audit gap #2, `New-TenantBootstrap.ps1:272-280`). An `-InfraManifest` param inside the ps1 cannot re-run the IM pass without re-running that destructive identity step. A distinct rung re-runs cleanly (§11 point i-ii).
2. **Privilege-domain separation.** Bootstrap's elevation is **Graph GA** (identity); the IM pass's elevation is **Azure subscription Owner/UAA** (R2). Keeping them in one script conflates two admin roles; the rung isolates them.
3. **Blast radius.** Fork-2 leaves the shipping identity script byte-for-byte and adds a new, testable surface — the same shape as Stamper's existing SSE rungs (Preflight, Baseline), so it is demoable and sim-able.
The CLI chaining is what honors the ruling literally: `stamper bootstrap` (the flow) *does* know what IM says, because it runs the IM rung next.

---

## 13. Multi-repo scope, ownership split, sequencing

This is **not a narrow patch** — it spans ces-muster (go-forward IM/MP author) + ces-stamper + tenant-stacksim + ces-tester (with ces-planner as the legacy origin kept in sync via re-vendor) and deserves its **own goal** if the founder greenlights rev 2.

| # | Deliverable | Owner |
|---|---|---|
| D1 | IM captures the **real subscription ID** (retire the placeholder, `infraManifestGenerator.ts:76`); resolve the `AZ-LOG-002a/b/c` registry-id drift (`:378`/`:392`); publish the IM→Stamper handoff contract (R1) — land the fix in muster's vendored copy (`ces-muster/src/vendored/ces-planner/mpt/services/infraManifestGenerator.ts`), or upstream in ces-planner then re-vendor to keep the two in sync | **ces-muster** (go-forward; ces-planner = legacy origin) |
| D2 | Posture-vocabulary reconciliation to the author's `m365_only/m365_sentinel/m365_azure`; baseline maps/accepts it; define the middle tier once (R3) | **ces-muster + ces-stamper** (author = muster's vendored copy; ces-planner legacy origin kept in sync) |
| D3 | **New IM-driven provisioning rung** (Fork-2): subscription RBAC + provider registration (R2), then baseline primed from IM; make baseline consume IM's **rich specs** (close §9 gaps a/b) or delegate them to the registry explicitly; **conformance gate** (§10); demote the tenant-config overlay to derived-from-IM (§11) | **ces-stamper** |
| D4 | FD ownership-drift fix (R4) | **ces-stamper** |
| D5 | Simulate the IM-driven rung under interception (cross-link REQ-STACKSIM…); the sim ladder must model the IM pass, not stop at identity | **tenant-stacksim** |
| D6 | Drive the full arc in the demo harness (identity → IM rung → baseline → execute); retire any forged infra state | **ces-tester** |

**Rough sequencing:** D1 + D2 first (unblock single-source-of-truth and one vocabulary) → D3 (the substantive rung + gate) → D4 in parallel → D5/D6 once D3 lands. D3 is the bulk (medium–high effort: a new privileged SSE rung + fidelity uplift + the coverage gate); D1/D2/D4 are low–medium.

---

## 1. Current design (grounded) — *rev 1 record*

### 1.1 Bootstrap is identity-only and runs pre-plan

`stamper bootstrap` → `scripts/New-TenantBootstrap.ps1` establishes **identity only**: it creates the app registration, a self-signed cert, the SP, grants Microsoft Graph app-role permissions, and writes `.env`. Its entire input surface is `-TenantId`, `-DisplayName`, `-Environment` (+ optional cert password/paths) — `New-TenantBootstrap.ps1:44-66`. It takes **no plan, no manifest, no Azure resource input** of any kind.

Critically, bootstrap touches **zero Azure**: there is no `Connect-AzAccount`, no `New-AzRoleAssignment`, no Az cmdlet anywhere in the script (verified: 0 occurrences). Everything it does is Microsoft Graph identity work (`New-TenantBootstrap.ps1:146-385`).

### 1.2 The plan → infrastructure linkage exists, but flows through a LATER path

The audit's four-surface ladder (`STAMPER-TENANT-PROVISIONING.md:29-50`) runs:

```
bootstrap (identity)  →  register tenant JSON  →  Connect gate  →  Preflight (Graph perms + directory roles)
   →  Configure card supplies infra manifest  →  /api/baseline (Azure infra)  →  translate → execute (RBAC tasks)
```

The Azure-infrastructure knowledge enters only at **baseline**, and only from the **Infrastructure Manifest**:

- `/api/baseline` refuses to run until an `infrastructure-manifest*.json` already exists in the tenant's `plans/` dir — *"Generate manifest first via Configure card."* (`baseline.routes.ts:103-119`).
- It Zod-validates the manifest, extracts `infrastructure_manifest.stamper_variable_map`, then **overlays the tenant config's `subscription`/`resources` blocks on top as source of truth** (`baseline.routes.ts:121-156`).
- `BaselineProvisioner` requires all 14 variable-map keys (`subscriptionId`, `resourceGroup`, `location`, `lawWorkspaceName`, …, `eoAppDisplayName`) or it throws (`BaselineProvisioner.ts:12-17, 41-45`), then discovers gaps and provisions RG → LAW/Storage/KV/Automation → CMK/network in dependency layers (`BaselineProvisioner.ts:60-151, 273-387`).
- RBAC that rides the plan (Storage MI → KV Crypto User; EO SP → KV Crypto Officer; Automation MI → four roles) lives in the **infra command registry** and runs during **execute**, after baseline (`infra-cmmc-l2-commands.registry.json:293, 438, 1236`).

### 1.3 What the mission plan actually contains about infrastructure

Grounded in `ces-planner` (which authors the plan; `ces-muster` vendors the same generator):

- **The mission-plan document does NOT contain Azure infrastructure.** Its `outputs` are `human_readable_mission_plan` (CMMC control milestones/steps), `cost_proposal_sow`, and a `tenant_manifest` — and that `tenant_manifest` is a *control/evidence* manifest (normative_controls, config_intents, evidence_monitors), not an Azure infra manifest (`ces-planner/public/schemas/CES MPT Manual Mission Plan schema.json`, `outputs` at ~486-504; `tenant_manifest` at ~1184-1240).
- **The Azure infra input exists — as a SEPARATE, SIBLING artifact:** the **Infrastructure Manifest**, authored by `ces-planner/src/features/mpt/services/infraManifestGenerator.ts` (`generateInfrastructureManifest()` builds it; `stamper_variable_map` populated at ~177-196 for the Sentinel tier and ~598-617 for the full-Azure tier). Resource names are **derived from the TCP monitoring section + SI Baseline** via `deriveInputs()`.
- **Posture gates it.** A single field `si_baseline.dependencies.infrastructure_model` ∈ `m365_only | m365_sentinel | m365_azure` (`ces-planner/src/shared/types/artifacts.ts:97`, set by SI question-bank item at `primed SI Question Bank.yaml:695`) decides whether a manifest is emitted at all — `m365_only` returns `null` (no infra).
- **The two artifacts are wired as siblings, not parent/child.** The planner generates the infra manifest only when a TCP exists, *independently of the plan*; `generateManualPlan()` never receives the infra manifest, so the plan's steps contain no infra steps. There is a `deriveInfraSteps()` that would splice infra into plan steps, but it is **dead-wired** — called only by its own test. The manifest is persisted as its own file (`infrastructure-manifest_infra-manifest-<ts>.json`) beside `manual_plan` (`ces-planner/.../hooks/useMissionPlanGenerator.ts:170-191, 287, 299-301`).

**So the honest one-line answer to the founder's question:** the *plan bundle* already carries the infra input, but as a fifth, standalone artifact — the mission plan proper does not, and bootstrap sees neither because it runs before either exists.

### 1.4 A documentation drift worth noting

`ces-stamper/FUNCTIONAL_DESCRIPTION.md:56-57` claims stamper owns `src/generators/infraManifestGenerator.ts` and generates the manifest "from TCP questionnaire inputs." **That file does not exist in stamper** (verified). The generator lives in `ces-planner`; stamper is a pure consumer (`BaselineProvisioner.ts:19-23, 41-45`). The stamper "Configure card" is a **path picker for a manifest authored upstream** (`public/index.html:4188` — an optional `infrastructure-manifest-*.json` path field), not a generator. This drift matters: any decision below should also correct the record of who owns manifest authorship.

---

## 2. The question, restated — and why it is non-trivial

> Should bootstrap (or the onboarding flow) become mission-plan-aware, so the infrastructure a plan requires is known/planned earlier?

It is non-trivial because of a **chicken-and-egg ordering**:

- Bootstrap needs only `TenantId` + `DisplayName` + `Environment` (`New-TenantBootstrap.ps1:44-66`) and runs **first**, at an interactive GA console, to mint the identity every later session authenticates with.
- The infra manifest's values are **derived from the TCP + SI Baseline** (`infraManifestGenerator.ts` `deriveInputs()`), which exist only **after** a planning engagement has produced them. At bootstrap time there is, by construction, no TCP, no SI Baseline, no manifest, and often not even a chosen `infrastructure_model`.
- So "make bootstrap read the plan" asks bootstrap to consume an artifact that does not yet exist when bootstrap must run. You can bootstrap a tenant's identity long before you know which plan/posture will apply — and the same identity may serve multiple re-plans over the tenant's life.

There is a second, sharper issue the founder's question surfaces:

**No surface in the ladder grants the app SP its Azure *subscription* RBAC.** Bootstrap does only Graph (§1.1). Preflight does Graph perms + three *directory* roles (`STAMPER-TENANT-PROVISIONING.md:139-140`). Baseline simply assumes `Connect-AzAccount -ServicePrincipal … -Environment AzureUSGovernment` already works with rights to create RGs/KVs/etc. The only Azure RBAC anywhere is *resource-scoped* grants in the infra registry that run **during execute, after baseline** (`infra-cmmc-l2-commands.registry.json:293, 438, 1236`). Nothing gives the SP Contributor/Owner (or provider-registration rights) on the subscription in the first place. **The real missing rung is not "plan-aware bootstrap" — it is that no surface owns Azure subscription onboarding.**

---

## 3. Options

### Option A — Keep as-is (bootstrap identity-only; baseline owns infra)

- **What changes:** nothing in bootstrap. Optionally document the boundary explicitly.
- **Pros:** respects the chicken-and-egg reality; bootstrap stays a fast, GA-only, plan-independent identity step reusable across re-plans; single infra owner (baseline) already exists and is idempotent.
- **Cons:** leaves the subscription-RBAC gap (§2) unowned; leaves the planner→stamper manifest handoff informal (operator hand-carries a file into a path field); leaves the posture-vocabulary mismatch (Finding B below).
- **Effort:** ~zero.

### Option B — Baseline stays sole infra owner, but tighten the manifest flow

- **What changes:** formalize the planner→stamper handoff (a named artifact contract / auto-discovery of the planner's `infrastructure-manifest_*.json`), **reconcile the posture vocabularies** (`m365_only|m365_foundation|m365_full_infra` in `baseline.routes.ts:78` vs `m365_only|m365_sentinel|m365_azure` in `ces-artifacts.types.ts:510` and planner), and correct the `FUNCTIONAL_DESCRIPTION` ownership drift (§1.4).
- **Pros:** fixes real, cheap defects; keeps the architecture (bootstrap identity-only, baseline infra) intact; removes the "third source of truth" risk by making the manifest the canonical input rather than something tenant-config overlays (`baseline.routes.ts:133-150`).
- **Cons:** does not, by itself, close the subscription-RBAC gap; still infra-owned-late (which is fine if infra is genuinely a post-plan concern).
- **Effort:** low–medium (schema/contract + enum reconciliation + docs).

### Option C — New pre-provision / subscription-onboarding rung (reads the manifest)

- **What changes:** add one surface between Preflight and Baseline — call it **Onboard Subscription** — that, given a tenant that already has an infra manifest + subscription block, grants the app SP its **Azure subscription RBAC** (Contributor or a scoped custom role on the target RG/subscription) and **registers the required resource providers** (the infra registry already knows the 11 providers: `infra-cmmc-l2-commands.registry.json:13`). It reads the manifest that already exists; it does **not** move infra knowledge into bootstrap.
- **Pros:** closes the actual gap (§2) — makes `Connect-AzAccount`/baseline reliably succeed; keeps bootstrap plan-independent; is naturally plan-aware *at the right time* (after a plan/manifest exists) without the chicken-and-egg problem; a clean, demoable rung (see §4).
- **Cons:** requires a GA/Owner elevation moment for the subscription grant (like bootstrap's GA moment, but Azure-side) — a new interactive/privileged step; more surface area to build and test.
- **Effort:** medium.

### Option D — Make bootstrap itself plan-aware (bootstrap consumes the infra manifest)

- **What changes:** bootstrap gains a `-InfraManifest`/`-Plan` input and pre-provisions or pre-plans Azure from it.
- **Pros:** "one command sets up everything" narrative; infra known at the earliest moment.
- **Cons:** collides head-on with the chicken-and-egg ordering (§2) — bootstrap must run before a TCP/SI Baseline/manifest exists; forces a plan to exist before identity, inverting the real engagement sequence; introduces a **third writer** of the same resource values (bootstrap + manifest + baseline's tenant-config overlay at `baseline.routes.ts:133-150`), multiplying drift; couples the GA identity step to Azure subscription elevation, conflating two different privilege domains. Highest blast radius, least alignment with how planning actually happens.
- **Effort:** high.

---

## 4. Recommendation — *OVERRULED by the founder ruling (see header + §7). Kept as record.*

> **rev 2 note:** the founder overruled this. The onboarding **flow** MUST consume IM, and Stamper MUST build anything MP/IM calls for. rev 1's Option B defect-fixes survive as R3/R4 (§8); rev 1's Option C ("Onboard Subscription" rung) survives and is **strengthened** into rev 2's mandatory, IM-driven, re-runnable rung (§12 Fork-2, R2). Only Option D's *"reject"* verdict is dead. Read §7–§13 as the operative recommendation.

**Answer to the literal question: NO — do not make bootstrap plan-aware (reject Option D).** Bootstrap should remain identity-only and plan-independent. The chicken-and-egg ordering is fundamental, not incidental: the infra input is *derived from* artifacts (TCP, SI Baseline) that only exist after planning, and one bootstrapped identity legitimately outlives many re-plans.

**Recommended path: Option B + Option C.**

- **Do Option B now** (low cost, pure defect-fixing): reconcile the posture vocabularies, formalize the planner→stamper manifest handoff, correct the ownership drift. These are true bugs surfaced by the audit regardless of the bigger decision.
- **Do Option C next** (the substantive change): add an **Onboard Subscription** rung that reads the already-existing infra manifest and grants the SP its Azure subscription RBAC + registers providers. This is where "plan-aware infrastructure onboarding" actually belongs — *after* a plan/manifest exists, not inside bootstrap. It closes the real gap (§2) that the founder's instinct was pointing at.

**Reasoning:** The founder's question ("should bootstrap know what infra a plan needs?") is best read as diagnosing a real hole — that infra onboarding is under-owned — but the fix is a *new post-plan rung*, not moving plan-awareness into the pre-plan identity step. Option C makes the flow plan-aware at the only point where the plan exists; Option D makes it plan-aware where the plan cannot yet exist.

---

## 5. Impact on the ces-tester demo — *rev 1 record; see rev 2 note*

> **rev 2 note:** the **IM-driven onboarding beat** (§12 Fork-2 rung) **REPLACES** rev 1's floated *"Onboard Subscription"* beat below. The demo arc becomes: identity → **IM-driven rung** (subscription RBAC + providers + infra primed from IM) → baseline → execute — one beat that visibly bridges plan → infrastructure, and the only place "plan-aware onboarding" is shown.

The founder earlier floated adding a preflight/baseline provisioning beat to the demo. This proposal makes that concrete:

- Option C gives a clean new **demo beat**: *"Onboard Subscription"* — a plan-aware rung that reads the infra manifest and grants Azure RBAC + registers providers, visibly bridging plan → infrastructure. It slots between the existing Preflight and Baseline beats and is SSE-streamable like the others.
- Even without Option C, Option B's vocabulary reconciliation removes a latent footgun. Note the drift is not a mechanical baseline failure: baseline's posture is an operator-chosen query param (`baseline.routes.ts:69, 78`) and baseline reads the manifest only for `stamper_variable_map` (`baseline.routes.ts:131`); the manifest's `infrastructure_model` (`m365_sentinel|m365_azure`) is consumed at **translate** (`translate.routes.ts:105-120`). So the hazard is human, not thrown: an operator holding a manifest that says `m365_azure` must mentally map it to baseline's `m365_full_infra` when picking a posture, with no code to catch a wrong pick — exactly the kind of silent mismatch a live demo should not rest on.
- A demo of the *current* baseline beat should note the honest caveat: baseline presumes the SP already has subscription rights that nothing in the ladder grants — so a from-scratch tenant demo would fail at `Connect-AzAccount` today unless that RBAC was arranged out-of-band.

---

## 6. Risks / open questions

1. **Subscription-RBAC elevation model.** Option C needs *someone* with Owner/User Access Administrator on the subscription to grant the SP. Is that the same GA human as bootstrap, a separate Azure admin, or a pre-arranged grant? This determines whether C is one more interactive rung or an automated step.
2. **Posture name authority.** Which vocabulary wins in the Option B reconciliation — the planner's `m365_sentinel|m365_azure` (upstream, canonical) or baseline's `m365_foundation|m365_full_infra`? Recommend the planner's, since it authors the field; baseline should map/accept it.
3. **Tenant-config overlay vs manifest as source of truth.** Baseline currently overlays tenant-config `subscription`/`resources` over the manifest (`baseline.routes.ts:133-150`). If the manifest becomes the formal contract (Option B), does the overlay stay (operator override) or go (single source)? Needs a decision.
4. **`deriveInfraSteps()` — resurrect or delete?** The planner has dead code to splice infra into plan steps (`infraManifestGenerator.ts:692`, unused). If the sibling-artifact model is intentional, delete it; if infra-in-plan was the intended direction, that is a *different* proposal than this one and should be decided explicitly.
5. **Provider registration timing.** Registering the 11 resource providers (`infra-cmmc-l2-commands.registry.json:13`) can take minutes to propagate. If Option C registers them, baseline must tolerate not-yet-registered state on a fast follow — an ordering/retry concern.
6. **Cross-repo scope.** Option B touches both ces-planner (contract) and ces-stamper (consumer). The founder should confirm both teams are in scope before either starts.
