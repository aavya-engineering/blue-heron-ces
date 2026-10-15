# CUI Boundary Definition Flow Analysis

**Generated:** 2026-03-28 | **Source:** CES-FE v1.0.0 codebase trace

---

## Overview

The CUI (Controlled Unclassified Information) Boundary Definition wizard collects **24 answers** across **10 sections** that define where CUI lives, moves, and is protected within the customer's environment. CUI boundary data flows through: **Question -> CUIBoundaryOutput artifact -> 10 downstream consumers** (BTC derivation, consistency checks, RR question boosting, gap compiler boundary relevance, manifests, proposals, plans, policy templates, validators, and export rendering).

CUI Boundaries are scoped to a **customer + SI baseline** pair. 8 of 24 questions are auto-derived from SI baseline answers. A skip gate suppresses the entire wizard when `cui_presence === 'no_cui'`.

---

## 1. Question Catalog

### CUI-01: CUI Classification & Contract Scope (2 questions)

| ID | Field | Type | Key Bindings | SI Derived? |
|----|-------|------|-------------|:-----------:|
| CUI.CAT.001 | CUI categories | multi_select | manifest:`cui_categories`, policy:`cui_classification_matrix` | -- |
| CUI.CONTRACT.001 | Active DFARS contracts | list | policy:`contract_scope`, evidence:`contract_clause_repository` | -- |

### CUI-02: CUI Generation Model (2 questions)

| ID | Field | Type | Key Bindings | SI Derived? |
|----|-------|------|-------------|:-----------:|
| CUI.GEN.001 | CUI generated internally? | single_select | manifest:`cui_generation_mode` | **SI** |
| CUI.GEN.002 | CUI generating functions | multi_select | manifest:`cui_generating_functions` | -- |

### CUI-03: Data Lifecycle (5 questions)

| ID | Field | Type | Key Bindings | SI Derived? |
|----|-------|------|-------------|:-----------:|
| CUI.LC.ING.001 | CUI receipt channels | multi_select | manifest:`cui_ingress_channels` | -- |
| CUI.LC.STO.001 | CUI storage locations | multi_select | manifest:`cui_storage_locations` | -- |
| CUI.LC.PROC.001 | CUI processing tools | list | manifest:`cui_processing_tools` | -- |
| CUI.LC.EGR.001 | CUI external sharing | single_select | manifest:`external_sharing_model` | **SI** |
| CUI.LC.RET.001 | Retention model | single_select | policy:`retention_model` | **SI** |

### CUI-04: User & Identity Scope (4 questions)

| ID | Field | Type | Key Bindings | SI Derived? |
|----|-------|------|-------------|:-----------:|
| CUI.USR.001 | CUI user roles | multi_select | manifest:`cui_user_roles` | -- |
| CUI.USR.002 | CUI user count | number | manifest:`cui_user_count` | **SI** |
| CUI.ID.001 | Dedicated GCC High tenant? | single_select | manifest:`tenant_separation` | **SI** |
| CUI.ID.002 | Shared identity across envs? | single_select | manifest:`shared_identity` | **SI** |

### CUI-05: Device Model (2 questions)

| ID | Field | Type | Key Bindings | SI Derived? |
|----|-------|------|-------------|:-----------:|
| CUI.DEV.001 | Managed devices only? | single_select | manifest:`device_model` | **SI** |
| CUI.DEV.002 | PAW/SAW isolation? | single_select | manifest:`admin_workstation_model` | -- |

### CUI-06: DevOps Scope (2 questions)

| ID | Field | Type | Key Bindings | SI Derived? |
|----|-------|------|-------------|:-----------:|
| CUI.DEVOPS.001 | DevOps touches CUI? | single_select | manifest:`devops_in_scope` | **SI** |
| CUI.DEVOPS.002 | CUI repo locations | multi_select | manifest:`cui_repo_locations` | -- |

### CUI-07: Interconnections (3 questions)

| ID | Field | Type | Key Bindings | SI Derived? |
|----|-------|------|-------------|:-----------:|
| CUI.INT.001 | Third-party integrations | list | manifest:`external_integrations` | -- |
| CUI.INT.002 | Email forwarding posture | single_select | manifest:`email_forwarding_posture` | -- |
| CUI.INT.003 | API tokens move CUI? | single_select | manifest:`api_tokens_move_cui` | -- |

### CUI-08: Backup & Resiliency (1 question)

| ID | Field | Type | Key Bindings | SI Derived? |
|----|-------|------|-------------|:-----------:|
| CUI.BKP.001 | Backup model | single_select | manifest:`backup_model` | -- |

### CUI-09: Out-of-Scope Declaration (2 questions)

| ID | Field | Type | Key Bindings | SI Derived? |
|----|-------|------|-------------|:-----------:|
| CUI.OOS.001 | Out-of-scope systems | list | manifest:`out_of_scope_systems` | -- |
| CUI.OOS.002 | Boundary technical controls | text | policy:`boundary_controls` | Cross-derived |

### CUI-10: Boundary Enforcement Model (1 question)

| ID | Field | Type | Key Bindings | SI Derived? |
|----|-------|------|-------------|:-----------:|
| CUI.ENF.001 | Enforcement mechanisms | multi_select | manifest:`boundary_enforcement_controls` | -- |

---

## 2. SI Derivation Chain (8 auto-populated questions)

| CUI Question | SI Field | Transform |
|-------------|----------|-----------|
| CUI.GEN.001 | `target.cui_presence` | cui_present/cui_plus_other_sensitive -> "Both"; fci_only -> "No -- only received" |
| CUI.LC.EGR.001 | `operations.collaboration_mode` | teams_first/email_first/mixed -> "Yes -- controlled external sharing" |
| CUI.LC.RET.001 | `evidence.retention_target_days` | If > 0 -> "Standard retention schedule" |
| CUI.USR.002 | `scope.in_scope_users_estimate` | Direct pass-through (number) |
| CUI.ID.001 | `dependencies.tenant_model_preference` | gcc_high/dod_il5/dod_il6 -> "Yes -- fully isolated tenant" |
| CUI.ID.002 | `dependencies.tenant_model_preference` | gcc_high/dod_il5/dod_il6 -> "No"; commercial_only/gcc -> "Yes" |
| CUI.DEV.001 | `operations.byod_posture` | not_allowed -> "Yes -- managed only"; allowed_vdi_only -> "BYOD via VDI/Cloud PC" |
| CUI.DEVOPS.001 | `operations.devops_touches_cui` | true -> "Yes -- fully in scope"; false -> "No" |

**Skip gate:** If `cui_presence === 'no_cui'`, the wizard shows a skip screen. If `fci_only`, generation mode is limited.

**Cross-question derivation:** CUI.OOS.002 (boundary technical controls) is auto-derived from 6 upstream CUI answers (DEV.001, ID.001, LC.STO.001, LC.EGR.001, INT.002, ENF.001) as a narrative text describing how the boundary is enforced.

**Source:** `cuiSIDerivation.ts`

---

## 3. CUI Domain Map

CUI answer prefixes map to CMMC domains for boundary relevance scoring:

| CUI Prefix | Primary CMMC Domains | Adjacent Domains |
|-----------|---------------------|-----------------|
| `CUI.ID` | AC, IA | AU |
| `CUI.DEV` | AC, PE | CM, MA |
| `CUI.DEVOPS` | CM, SA | AC, SI |
| `CUI.LC.EGR` | AU, MP | SC |
| `CUI.LC.RET` | AU, MP | SC |
| `CUI.GEN` | SC | AC, SI |
| `CUI.USR` | AT, PS | AC |

**Source:** `cuiDomainMap.ts` | Used by gap compiler for boundary relevance and RR question set generator for priority boosting.

---

## 4. Risk Flags

| Question | Risk Flag | Trigger |
|----------|-----------|---------|
| CUI.CAT.001 | `export_control_in_scope_if_selected` | ITAR or EAR selected |
| CUI.GEN.001 | `internal_generation_requires_devops_review` | Generates CUI internally |
| CUI.LC.STO.001 | `external_storage_if_selected` | External SaaS selected |
| CUI.LC.EGR.001 | `third_party_cui_flow_if_yes` | CUI leaves enclave |
| CUI.ID.002 | `cross_tenant_identity_risk_if_yes` | Shared identity = Yes |
| CUI.DEV.001 | `direct_byod_boundary_risk` | BYOD direct access allowed |
| CUI.DEVOPS.002 | `repo_outside_boundary_if_selected` | Commercial GitHub/Azure DevOps selected |
| CUI.INT.002 | `email_egress_risk` | Email forwarding unrestricted |
| CUI.BKP.001 | `backup_outside_boundary_if_selected` | Third-party backup out of scope |

---

## 5. Downstream Consumers

### 5.1 BTC Wizard (Boundary Topology Confirmation)

CUI boundary pre-populates 7 BTC questions:

| BTC Question | CUI Source | Transform |
|-------------|-----------|-----------|
| BTC.GOV.001 | CUI.GEN.001 | "Both" -> "CUI created and received" |
| BTC.INT.003 | CUI.LC.EGR.001 | "No" -> "No external email forwarding" |
| BTC.ID.001 | CUI.ID.001 | "isolated" -> "Yes -- dedicated identity domain" |
| BTC.ID.002 | CUI.ID.002 | Direct pass-through |
| BTC.ID.003 | CUI.USR.002 | Number -> "{N} in-scope users identified" |
| BTC.DEV.001 | CUI.DEV.001 | "managed only" -> "Managed devices only" |
| BTC.LOG.001 | CUI.LC.RET.001 | Direct pass-through |

**Source:** `btcSICUIDerivation.ts`

### 5.2 Consistency Checker

Cross-validates CUI answers against SI baseline and BTC confirmation:

| Check | CUI Field | Cross-Reference | What It Validates |
|-------|-----------|----------------|-------------------|
| BYOD consistency | CUI.DEV.001 | SI `byod_posture` | Device model matches SI intent |
| DevOps consistency | CUI.DEVOPS.001 | SI `devops_touches_cui` | DevOps scope matches SI intent |
| Sharing consistency | CUI.LC.EGR.001 | SI `collaboration_mode` | External sharing model aligns |
| CUI staleness | `ces.generated_on` | SI `ces.generated_on` | CUI boundary not older than SI |
| Identity gate | CUI.ID.001 | BTC identity gate | Tenant isolation confirmed in BTC |
| Device gate | CUI.DEV.001 | BTC device gate | Device model confirmed in BTC |

**Source:** `consistencyChecker.ts`

### 5.3 RR Question Set Generator

Gives **+8 priority boost** to RR questions whose CMMC domain matches CUI boundary primary domains via `CUI_DOMAIN_MAP`. Questions in CUI-relevant domains are sorted earlier in the question set.

**Source:** `questionSetGenerator.ts:evaluateApplicability()`

### 5.4 Gap Compiler — Boundary Relevance

Each gap gets a `boundary_relevance` tag and potential severity adjustment:

| Relevance | Condition | Severity Impact |
|-----------|-----------|----------------|
| `in_boundary` | Gap's CMMC domain is a primary CUI domain | No change |
| `boundary_adjacent` | Gap's CMMC domain is an adjacent CUI domain | No change |
| `out_of_boundary` | Neither primary nor adjacent | HIGH -> MEDIUM, MEDIUM -> LOW |

The `buildBoundaryScopeMap()` function reads all CUI boundary keys, matches prefixes against `CUI_DOMAIN_MAP`, and builds primary/adjacent domain sets.

**Source:** `gapCompiler.ts` lines 480-492, 674-699

### 5.5 Manifest Generator

CUI boundary feeds 5 manifest builder functions:

| Manifest Section | CUI Prefixes Used | What's Generated |
|-----------------|-------------------|-----------------|
| **Boundary Zones** | All keys | `cui_boundary_version` + definitions array |
| **Normative Controls** | CUI.LC.EGR, CUI.LC.RET, CUI.GEN, CUI.ID | DLP, retention, marking, shared identity controls |
| **Assets** | CUI.ID, CUI.DEV, CUI.DEVOPS, CUI.LC | identity_provider, endpoint_fleet, devops_pipeline, data_boundary |
| **Config Intents** | CUI.LC.EGR, CUI.LC.RET, CUI.ID | DLP, retention, shared identity intents |
| **Evidence Monitors** | CUI.LC.EGR, CUI.LC.RET | DLP incident + retention policy monitors |

**Source:** `manifestGenerator.ts`

### 5.6 Proposal Generator

- Sets `cui_boundary_defined: true` and `cui_generated_on` in the `boundary_compliance` section when CUI boundary exists.

**Source:** `proposalGenerator.ts:buildBoundaryCompliance()`

### 5.7 Manual Plan Generator

- Adds `cui_boundary_ref` to the inputs block (artifact metadata)
- Embeds the entire `cui_boundary` record into the plan's `boundary_context` section

**Source:** `manualPlanGenerator.ts`

### 5.8 Policy Context Compiler

Exposes the full CUI boundary to Handlebars policy templates:

| Template Variable | Source |
|-------------------|--------|
| `cui_boundary` | Full `Record<string, unknown>` of all boundary key-value pairs |
| `has_cui_boundary` | Boolean: whether any CUI data exists |

Available in all 17 Handlebars Markdown policy document templates.

**Source:** `policyContextCompiler.ts`

### 5.9 Cross-Artifact Validator

Warns if CUI boundary exists but the manifest is missing a `boundary_zones` section.

**Source:** `validator.ts`

### 5.10 Export Plan Utility

Three rendering paths for CUI boundary data:

| Format | Section | Content |
|--------|---------|---------|
| Text | "CUI BOUNDARY DEFINITIONS" | All key-value pairs |
| HTML | Boundary definitions table | All key-value pairs as HTML table |
| HTML | Input references card | CUI boundary artifact metadata |
| HTML | Manifest boundary zones | Boundary zone definitions with version |

**Source:** `exportPlan.ts`

---

## 6. Data Persistence

| Layer | Location | Details |
|-------|----------|---------|
| Wizard state | localStorage `ces-cui-store` | Zustand persisted: answers, section progress, cursor |
| Artifact | IndexedDB `cui_boundaries` | Index: `[customerId+baselineId]`, auto-increment ID |
| Disk (dev) | `customers/{name}/inputs/cui-boundary-{id}.json` | Via Vite dev server API |
| App store | localStorage `ces-app-store` | `selectedCUIBoundaryId` — reset on customer/baseline change |

**Cascade:** Deleting a CUI boundary cascades to delete linked BTC confirmations. Deleting a baseline cascades to delete all CUI boundaries (and their BTC confirmations).

---

## 7. Data Flow Diagram

```
SI Baseline (8 derived answers + skip gate)
  |
  v
YAML Question Bank (24 questions, 10 sections)  +  Help Overlay (guidance)
  |                                                         |
  +-------- merged ----------------------------------------+
  |
  v
CUIWizard (orchestration)
  |-- SI Derivation (8 questions: GEN.001, LC.EGR.001, LC.RET.001, USR.002,
  |                                ID.001, ID.002, DEV.001, DEVOPS.001)
  |-- Cross-question derivation (OOS.002 from 6 upstream answers)
  |-- Previous Run Hydration (reverseMapCUIBoundary)
  |-- YAML Recommendations (all questions with `recommended` values)
  |-- Autofill Service (hardcoded DoD contractor defaults + SI overrides)
  |
  v
generateCUIBoundary() -> CUIBoundaryOutput
  |-- Direct mapping: bindings.manifest + bindings.policy keys
  |-- Contract normalization: byod_model, managed_device_required, guest_access_policy
  |
  v
Save to IndexedDB (cui_boundaries) + disk persistence
  |
  v
selectedCUIBoundaryId in AppStore -> useWorkflowState
  |
  +---> BTC Wizard           (7 CUI fields -> BTC answer pre-population)
  +---> Consistency Checker   (5 CUI fields cross-validated vs SI/BTC)
  +---> RR Question Set Gen   (+8 priority boost for CUI-relevant CMMC domains)
  +---> Gap Compiler          (boundary relevance tagging + severity downgrade)
  +---> Manifest Generator    (boundary zones, normative controls, assets, intents, monitors)
  +---> Proposal Generator    (cui_boundary_defined flag)
  +---> Manual Plan Generator (input ref + full boundary context embed)
  +---> Policy Context        (full cui_boundary dict -> 17 Handlebars templates)
  +---> Validator             (boundary_zones presence check)
  +---> Export Plan           (text/HTML rendering of boundary definitions)
```

---

## 8. Impact Summary Matrix

| CUI Field | BTC Derivation | Consistency Check | RR Boost | Gap Relevance | Manifest | Proposal | Plan | Policy | Validator | Export |
|-----------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| `cui_categories` | -- | -- | -- | -- | Zones | -- | Context | Yes | -- | Yes |
| `contract_scope` | -- | -- | -- | -- | -- | -- | Context | Yes | -- | Yes |
| `cui_generation_mode` | BTC.GOV.001 | -- | SC domain | SC/AC/SI | Marking ctrl | -- | Context | Yes | -- | Yes |
| `cui_generating_functions` | -- | -- | -- | -- | General | -- | Context | Yes | -- | Yes |
| `cui_ingress_channels` | -- | -- | -- | -- | General | -- | Context | Yes | -- | Yes |
| `cui_storage_locations` | -- | -- | -- | -- | General | -- | Context | Yes | -- | Yes |
| `cui_processing_tools` | -- | -- | -- | -- | General | -- | Context | Yes | -- | Yes |
| `external_sharing_model` | BTC.INT.003 | SI sharing | AU/MP domain | AU/MP/SC | DLP ctrl+intent+monitor | -- | Context | Yes | -- | Yes |
| `retention_model` | BTC.LOG.001 | -- | AU/MP domain | AU/MP/SC | Retention ctrl+intent+monitor | -- | Context | Yes | -- | Yes |
| `cui_user_roles` | -- | -- | AT/PS domain | AT/PS/AC | General | -- | Context | Yes | -- | Yes |
| `cui_user_count` | BTC.ID.003 | -- | AT/PS domain | AT/PS/AC | General | -- | Context | Yes | -- | Yes |
| `tenant_separation` | BTC.ID.001 | Identity gate | AC/IA domain | AC/IA/AU | Identity ctrl+intent+asset | -- | Context | Yes | -- | Yes |
| `shared_identity` | BTC.ID.002 | -- | AC/IA domain | AC/IA/AU | Identity ctrl | -- | Context | Yes | -- | Yes |
| `device_model` | BTC.DEV.001 | BYOD+device gate | AC/PE domain | AC/PE/CM/MA | Endpoint asset | -- | Context | Yes | -- | Yes |
| `admin_workstation_model` | -- | -- | AC/PE domain | AC/PE/CM/MA | General | -- | Context | Yes | -- | Yes |
| `devops_in_scope` | -- | DevOps check | CM/SA domain | CM/SA/AC/SI | DevOps asset | -- | Context | Yes | -- | Yes |
| `cui_repo_locations` | -- | -- | CM/SA domain | CM/SA/AC/SI | General | -- | Context | Yes | -- | Yes |
| `external_integrations` | -- | -- | -- | -- | General | -- | Context | Yes | -- | Yes |
| `email_forwarding_posture` | -- | -- | -- | -- | General | -- | Context | Yes | -- | Yes |
| `api_tokens_move_cui` | -- | -- | -- | -- | General | -- | Context | Yes | -- | Yes |
| `backup_model` | -- | -- | -- | -- | General | -- | Context | Yes | -- | Yes |
| `out_of_scope_systems` | -- | -- | -- | -- | General | -- | Context | Yes | -- | Yes |
| `boundary_controls` | -- | -- | -- | -- | -- | -- | Context | Yes | -- | Yes |
| `boundary_enforcement_controls` | -- | -- | -- | -- | General | -- | Context | Yes | -- | Yes |

**Key insight:** CUI boundary data has the broadest downstream reach of any wizard — 10 distinct consumers. The CUI domain map creates a ripple effect where boundary answers influence gap severity across 11 of 14 CMMC domains.
