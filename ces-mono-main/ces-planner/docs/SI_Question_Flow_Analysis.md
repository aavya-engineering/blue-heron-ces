# SI Question Flow Analysis

**Generated:** 2026-03-28 | **Source:** CES-FE v1.0.0 codebase trace

---

## Overview

The Strategic Intent (SI) wizard collects **23 answers** across **21 questions** that configure the entire downstream CMMC compliance pipeline. Every SI answer flows through a deterministic chain: **Question -> SI Baseline -> Downstream Consumers** (scope exclusions, gap analysis, RR question generation, wizard pre-population, policy documents, proposals, and manifests).

SI Baselines are **immutable** after generation. All downstream artifacts (RR Question Sets, Readiness Postures, Mission Plans, CUI Boundaries, BTC Confirmations, Tenant Config Profiles) reference their parent baseline by ID.

---

## 1. Question Catalog

| # | ID | Field Name | Answer Type | Values | Recommended | Required |
|---|-----|-----------|-------------|--------|-------------|----------|
| 1 | G-01 | `target_cmmc_level` | enum | L1, L2, L3 | L2 | Yes |
| 2 | G-02 | `cui_presence` | enum | no_cui, fci_only, cui_present, cui_plus_other_sensitive, unknown | -- | Yes |
| 3 | G-03 | `cui_types` | multi_select | cui_basic, cui_specified, export_controlled, proprietary, pii, critical_infrastructure, law_enforcement_sensitive, other, unknown | -- | Conditional |
| 4 | G-04 | `regulated_data_notes` | multi_select | none, itar, ear, hipaa, pci_dss, gdpr, ccpa, sox, fedramp, cmvp_fips140, data_residency, sector_specific, customer_specific, other | -- | Yes |
| 5 | G-05 | `assessment_route` + `assessment_body` | structured | route: self, certification, unknown_contract_dependent | -- | Yes |
| 6 | G-06 | `certification_timing_goal` | structured | goal_type: by_date, within_days, asap, no_timeline, unknown | -- | Yes |
| 7 | G-07 | `boundary_strategy` | enum | single_enclave, multiple_enclaves, hybrid_boundary, unknown | single_enclave | Yes |
| 8 | G-08 | `deployment_posture` | enum | cloud_only, hybrid, on_prem, unknown | -- | Yes |
| 9 | S-11 | `in_scope_users_estimate` + `in_scope_endpoints_estimate` | structured | integer fields | -- | Yes |
| 10 | S-12 | `collaboration_mode` | enum | teams_first, email_first, mixed, unknown | teams_first | Yes |
| 11 | S-13 | `byod_posture` | enum | not_allowed, allowed_vdi_only, allowed_mdm, unknown | not_allowed | Yes |
| 12 | S-16 | `evidence_posture_target` | enum | l2_self_ready, c3pao_ready, continuous_compliance, unknown | -- | Yes |
| 13 | S-20 | `tenant_model_preference` | enum | commercial_only, gcc, gcc_high, dod_il5, dod_il6, hybrid, unknown | -- | Yes |
| 14 | SIT-020 | `infrastructure_model` | enum | m365_only, m365_sentinel, m365_azure | -- | No |
| 15 | SIT-021 | `license_tier` | enum | business_premium, g3, g5 | -- | No |
| 16 | SIT-022 | `user_count` | integer | 1-500 | -- | No |
| 17 | S-24 | `poam_policy_intent` | enum | no_poam, poam_if_allowed, unknown | -- | Yes |
| 18 | S-25 | `mobile_device_presence` | enum | no_mobile_devices, company_managed_only, byod_and_company, unknown | no_mobile_devices | No |
| 19 | S-26 | `wireless_posture` | enum | no_wireless, managed_wireless, unknown | no_wireless | No |
| 20 | S-27 | `removable_media_posture` | enum | blocked, allowed_encrypted, allowed_uncontrolled, unknown | blocked | No |
| 21 | S-28 | `remote_access_posture` | enum | no_remote, vpn_only, cloud_native, unknown | no_remote | No |
| 22 | S-29 | `maintenance_posture` | enum | no_nonlocal, managed_nonlocal, unknown | no_nonlocal | No |
| 23 | S-30 | `cui_endpoint_posture` | enum | browser_only, managed_endpoints, unknown | browser_only | No |

---

## 2. Scope Exclusion Rules

When specific SI answers indicate a capability is absent from the environment, the gap compiler removes controls from the assessment surface. **9 rules** can exclude up to **30 of 110 L2 controls** (~27%).

| Rule | SI Field | Trigger Value | Controls Excluded | Count |
|------|----------|---------------|-------------------|-------|
| 1 | `mobile_device_presence` | `no_mobile_devices` | AC.L2-3.1.18, AC.L2-3.1.19 | 2 |
| 2 | `wireless_posture` | `no_wireless` | AC.L2-3.1.16, AC.L2-3.1.14 | 2 |
| 3 | `removable_media_posture` | `blocked` | AC.L2-3.1.6, AC.L2-3.1.17, MP.L2-3.8.5, MP.L2-3.8.6 | 4 |
| 4 | `remote_access_posture` | `no_remote` | AC.L2-3.1.12, AC.L2-3.1.13, PE.L2-3.10.6 | 3 |
| 5 | `maintenance_posture` | `no_nonlocal` | MA.L2-3.7.4 | 1 |
| 6 | `cui_endpoint_posture` | `browser_only` | AC.L2-3.1.10, CM.L2-3.4.6, MP.L2-3.8.7, SC.L2-3.13.16* | 4 |
| 7 | `infrastructure_model` | `m365_only` | AU.L2-3.3.3, AU.L2-3.3.4, SC.L1-3.13.1, SC.L1-3.13.5, SC.L2-3.13.6, SC.L2-3.13.10, SI.L2-3.14.7, IR.L2-3.6.2, SC.L2-3.13.2 | 9 |
| 8 | `infrastructure_model` | `m365_sentinel` | Same as Rule 7 minus AU.L2-3.3.3, AU.L2-3.3.4, IR.L2-3.6.2 | 6 |
| 9 | `deployment_posture` | `cloud_only` | PE.L1-3.10.1, PE.L2-3.10.2, PE.L1-3.10.3, PE.L1-3.10.4, PE.L1-3.10.5 | 5 |

*SC.L2-3.13.16 has `requires_rr_validation: true` — exclusion requires RR evidence confirmation.

**Source:** `gapCompiler.ts:buildScopeExclusions()` lines 20-138

---

## 3. Cross-Feature Derivation Chains

SI answers pre-populate answers in 3 downstream wizards, reducing advisor effort:

### SI -> CUI Boundary Derivation
| SI Field | CUI Question | Transform |
|----------|-------------|-----------|
| `tenant_model_preference` | CUI.ID.001 (tenant isolation) | gcc_high/dod_il5/dod_il6 -> "Yes - fully isolated" |
| `byod_posture` | CUI.DEV.001 (device model) | not_allowed -> "Yes - managed only" |
| `collaboration_mode` | CUI.LC.EGR.001 (egress model) | teams_first -> "Yes - controlled external sharing" |
| `cui_presence` | CUI.GEN.001 (CUI scope) | cui_present -> "Both" |
| `in_scope_users_estimate` | CUI.USR.002 (user count) | Direct pass-through |
| `tenant_model_preference` | CUI.ID.002 (shared identity) | gcc_high -> "No" (isolated) |

**Source:** `cuiSIDerivation.ts`

### SI -> TCP Derivation
| SI Field | TCP Question | Transform |
|----------|-------------|-----------|
| `tenant_model_preference` | TCP.TI.004 (cloud environment) | gcc_high -> "GCC High" |
| `deployment_posture` | TCP.IA.004 (identity provider) | cloud_only -> "Entra ID native" |
| `byod_posture` | TCP.DM.001 (enrollment type) | not_allowed -> "Azure AD Join" |
| `in_scope_users_estimate` | TCP.LIC.002 (license count) | Direct pass-through |

**Source:** `tcpSIDerivation.ts`

### SI -> BTC Derivation
| SI Field | BTC Question | Transform |
|----------|-------------|-----------|
| `devops_touches_cui` | BTC.DEVOPS.001-.003 | false -> "No" / "N/A" |

**Source:** `btcSICUIDerivation.ts`

---

## 4. RR Question Set Filtering

The SI baseline shapes which Readiness Recon questions are presented. The `questionSetGenerator.ts` extracts a **scenario profile** from 11 SI fields and applies **10 applicability rules**:

| Rule Name | SI Field | Condition | Effect |
|-----------|----------|-----------|--------|
| Level filter | `target_cmmc_level` | Always | Exclude activities above target level |
| CUI_IN_NAME | `cui_presence` | no_cui / fci_only | Exclude CUI-specific activities |
| L2_CUI_ASSUMPTION | `cui_presence` | no_cui | Exclude L2 activities requiring CUI |
| PS_CUI | `cui_presence` | no_cui / fci_only | Exclude PS domain CUI activities |
| MOBILE_DEVICE | `byod_posture` | not_allowed | Exclude mobile device activities |
| REMOTE_ACCESS | `deployment_posture` | cloud_only / hybrid | Boost remote access activities |
| AUDIT_BOOST | `evidence_posture_target` | c3pao_ready / continuous | Boost audit activities |
| MULTI_ENCLAVE_BOOST | `boundary_strategy` | multiple / hybrid | Boost scoping activities |
| CA_CERTIFICATION | `assessment_route` | certification | Boost CA domain activities |
| IR_CERTIFICATION | `assessment_route` | certification | Boost IR domain activities |
| CRYPTO_TENANT | `tenant_model_preference` | gcc_high / dod_il5/6 | Boost crypto activities |

**Source:** `questionSetGenerator.ts:extractScenarioProfile()` lines 30-45

---

## 5. RRT Bulk Answer Derivation

The RRT uses SI fields to automatically derive readiness statuses for controls that are not applicable to the environment:

| SI Field | Derivation | Effect |
|----------|-----------|--------|
| `target_cmmc_level` | `targetLevelNum()` | Scope gate: controls above target level -> N/A |
| `cui_presence` | `hasCUI()` | If no CUI + L2+ MP/SC/SI domain -> N/A |
| `deployment_posture` | `isCloudOnly()` | cloud_only + PE domain -> N/A |
| `byod_posture` | `isBYODNotAllowed()` | not_allowed + mobile action -> N/A |

**Source:** `bulkAnswerDerivation.ts` lines 134-161

---

## 6. Mission Plan Generation Impacts

### Gap Compiler
| SI Field | Impact |
|----------|--------|
| `target_cmmc_level` | Determines L1/L2/L3 control hierarchy and severity levels |
| `deployment_posture` | Rule 9 scope exclusions (PE controls) |
| `infrastructure_model` | Rules 7/8 scope exclusions (Azure controls); infrastructure gap classification |
| `license_tier` | License tier gap classification (business_premium -> 3 controls get `control_not_available`) |
| All operations fields (S-25 to S-30) | Rules 1-6 scope exclusions |

### Proposal Generator
| SI Field | Impact |
|----------|--------|
| `target_cmmc_level` | Proposal target level and intent |
| `infrastructure_model` | Cost calculation |
| `license_tier` | Cost calculation via `LICENSE_TIER_COSTS` |
| `user_count` | Licensing cost (default 50) |
| `assessment_body` | SOW deliverable: "Assessment coordination with {body}" |
| `certification_timing_goal` | Proposal assumptions (timeline) |
| `regulated_data_notes` | Special handling assumptions (ITAR/EAR/CJIS/PII/PHI) |
| `budget_constraints` | Proposal assumptions |
| `schedule_constraints` | Proposal assumptions |

### Infrastructure Manifest Generator
| SI Field | Impact |
|----------|--------|
| `infrastructure_model` | m365_only -> no manifest; m365_sentinel -> Sentinel-only; m365_azure -> full |
| `tenant_model_preference` | Fallback for cloud environment |
| `retention_target_days` | WORM retention days |
| `target_cmmc_level` | Manifest intent string |

### Policy Context Compiler
All SI fields are exposed to Handlebars policy templates via the `si.*` namespace. 17 Markdown policy documents can reference any SI answer for conditional content.

**Source:** `policyContextCompiler.ts` lines 213-237

---

## 7. Data Persistence

| Store | Table | Index | Relationship |
|-------|-------|-------|-------------|
| IndexedDB | `si_baselines` | `customerId` | Root artifact |
| IndexedDB | `rr_question_sets` | `[customerId+baselineId]` | Child of SI Baseline |
| IndexedDB | `readiness_postures` | `[customerId+baselineId]` | Child of SI Baseline |
| IndexedDB | `mission_plans` | `[customerId+baselineId]` | Child of SI Baseline |
| IndexedDB | `cui_boundaries` | `[customerId+baselineId]` | Child of SI Baseline |
| IndexedDB | `btc_confirmations` | `[customerId+baselineId]` | Child of SI Baseline |
| IndexedDB | `tenant_config_profiles` | `[customerId+baselineId]` | Child of SI Baseline |
| Disk (dev) | `customers/{name}/inputs/` | `si-baseline-{id}.json` | File export |

Selecting a new baseline in the app store resets all downstream artifact selections to null.

---

## 8. Impact Summary Matrix

| SI Field | Scope Exclusions | RR Filtering | RRT Derivation | CUI | TCP | BTC | Gap Compiler | Proposal | Policy | Manifest |
|----------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| `target_cmmc_level` | -- | Level filter | Scope gate | -- | -- | -- | Level hierarchy | Target | Yes | Intent |
| `cui_presence` | -- | 3 rules | hasCUI() | Yes | -- | -- | -- | -- | Yes | -- |
| `cui_types` | -- | -- | -- | -- | -- | -- | -- | -- | Yes | -- |
| `regulated_data_notes` | -- | -- | -- | -- | -- | -- | -- | Assumptions | Yes | -- |
| `assessment_route` | -- | 2 rules | -- | -- | -- | -- | -- | -- | Yes | -- |
| `assessment_body` | -- | -- | -- | -- | -- | -- | -- | SOW | -- | -- |
| `certification_timing_goal` | -- | -- | -- | -- | -- | -- | -- | Timeline | -- | -- |
| `boundary_strategy` | -- | 1 rule | -- | -- | -- | -- | -- | -- | Yes | -- |
| `deployment_posture` | 5 PE | 1 rule | isCloudOnly() | -- | 2 Qs | -- | PE exclusions | -- | Yes | Location |
| `in_scope_users/endpoints` | -- | -- | -- | 1 Q | 1 Q | -- | -- | -- | Yes | -- |
| `collaboration_mode` | -- | YAML | -- | 1 Q | -- | -- | -- | -- | Yes | -- |
| `byod_posture` | -- | 1 rule | isBYOD() | 1 Q | 1 Q | -- | -- | -- | Yes | -- |
| `evidence_posture_target` | -- | 1 rule | -- | -- | -- | -- | -- | -- | Yes | -- |
| `tenant_model_preference` | -- | 1 rule | -- | 2 Qs | 1 Q | -- | -- | -- | Yes | Fallback |
| `infrastructure_model` | 6-9 controls | -- | -- | -- | -- | -- | Infra gaps | Cost | -- | Mode |
| `license_tier` | -- | -- | -- | -- | -- | -- | License gaps | Cost | -- | -- |
| `user_count` | -- | -- | -- | -- | -- | -- | -- | Cost | -- | -- |
| `poam_policy_intent` | -- | YAML | -- | -- | -- | -- | -- | -- | Yes | -- |
| `mobile_device_presence` | 2 AC | -- | -- | -- | -- | -- | AC exclusions | -- | -- | -- |
| `wireless_posture` | 2 AC | -- | -- | -- | -- | -- | AC exclusions | -- | -- | -- |
| `removable_media_posture` | 4 AC/MP | -- | -- | -- | -- | -- | AC/MP exclusions | -- | -- | -- |
| `remote_access_posture` | 3 AC/PE | -- | -- | -- | -- | -- | AC/PE exclusions | -- | -- | -- |
| `maintenance_posture` | 1 MA | -- | -- | -- | -- | -- | MA exclusion | -- | -- | -- |
| `cui_endpoint_posture` | 4 AC/CM/MP/SC | -- | -- | -- | -- | -- | Endpoint exclusions | -- | -- | -- |

**Total scope exclusion capacity:** Up to 30 of 110 L2 controls (~27%) when all operational posture questions select the exclusion-trigger value.
