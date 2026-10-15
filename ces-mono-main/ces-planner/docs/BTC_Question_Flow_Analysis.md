# BTC Question Flow Analysis

**Generated:** 2026-03-30 | **Source:** CES-FE v1.0.0 codebase trace

---

## Overview

The Boundary Topology Confirmation (BTC) wizard collects **22 answers** (plus 1 virtual question) across **6 sections** that empirically confirm whether the declared CUI boundary is structurally and operationally true prior to planning and stamping. BTC answers flow through: **Question -> BTCConfirmationOutput artifact -> 11 downstream consumers** (gap compiler, task compiler, manifest generator, proposal generator, manual plan generator, policy context compiler, cross-artifact validator, consistency checker, RRT evidence adapter, RRT bulk answer derivation, and export plan renderer).

BTC confirmations are scoped to a **customer + SI baseline + CUI boundary** triple. 10 of 22 questions can be pre-populated from SI baseline and CUI boundary answers. Unlike other wizards, BTC has a unique **runlist/activation engine** — a rules-based system that dynamically adjusts question depth (full/minimal/substitute) based on SI and CUI outputs. BTC also introduces an **evidence gate** — most questions require evidence attachments before the advisor can proceed.

A prerequisite gate suppresses the entire BTC wizard when no CUI boundary has been selected.

---

## 1. Question Catalog

### DV-01: Identity Verification (4 questions)

| # | ID | Field (btc binding) | Answer Type | Values | Required | Evidence Required |
|---|-----|---------------------|-------------|--------|----------|:-:|
| 1 | BTC.ID.001 | `ga_matches_declared` | boolean | Yes/No | Yes | Yes (export, Entra) |
| 2 | BTC.ID.002 | `priv_role_anomalies` | single_select | No unexpected roles, Yes - unexpected roles found, Unknown | Yes | Yes (export, Entra/PIM) |
| 3 | BTC.ID.003 | `guest_alignment` | single_select | No guests, Guests present - aligned, Guests present - not aligned, Unknown | Yes | Yes (query, Entra) |
| 4 | BTC.ID.004 | `breakglass_status` | single_select | Yes, Partially, No, Unknown | Yes | Yes (config_export, Entra/CA) |

### DV-02: Device Verification (3 questions)

| # | ID | Field (btc binding) | Answer Type | Values | Required | Evidence Required |
|---|-----|---------------------|-------------|--------|----------|:-:|
| 5 | BTC.DEV.001 | `device_compliance_gaps` | single_select | Yes, No - gaps found, Unknown | Yes | Yes (export, Intune) |
| 6 | BTC.DEV.002 | `unmanaged_access` | single_select | No, Yes, Unknown | Yes | Yes (query, Sentinel/Unified Audit) |
| 7 | BTC.DEV.003 | `paw_status` | single_select | Yes, Partially, No, Unknown | Yes | Yes (config_export, Intune) |

### DV-03: Logging & Telemetry Verification (4 questions)

| # | ID | Field (btc binding) | Answer Type | Values | Required | Evidence Required |
|---|-----|---------------------|-------------|--------|----------|:-:|
| 8 | BTC.LOG.001 | `ual_enabled` | single_select | Yes, No, Unknown | Yes | Yes (query, Unified Audit) |
| 9 | BTC.LOG.002 | `sentinel_ingestion` | single_select | Yes, Partially, No, Unknown | Yes | Yes (workspace_check, Sentinel) |
| 10 | BTC.LOG.003 | `retention_alignment` | single_select | Yes, Partially, No, Unknown | Yes | Yes (config_export, Purview/Unified Audit) |
| 11 | BTC.LOG.004 | `tamper_protection` | single_select | Yes, Partially, No, Unknown | Yes | Yes (config_export, Defender/Sentinel) |

### DV-04: DevOps Verification (3 questions)

| # | ID | Field (btc binding) | Answer Type | Values | Required | Evidence Required |
|---|-----|---------------------|-------------|--------|----------|:-:|
| 12 | BTC.DEVOPS.001 | `repo_boundary_alignment` | single_select | No, Yes, Unknown | Yes | Yes (repo_inventory, Git platform) |
| 13 | BTC.DEVOPS.002 | `pipeline_boundary_alignment` | single_select | Yes, Partially, No, Unknown | Yes | Yes (pipeline_inventory, CI/CD) |
| 14 | BTC.DEVOPS.003 | `artifact_storage_alignment` | single_select | Yes, Partially, No, Unknown | Yes | Yes (storage_check, Artifact store) |

### DV-05: Interconnection Verification (4 questions)

| # | ID | Field (btc binding) | Answer Type | Values | Required | Evidence Required |
|---|-----|---------------------|-------------|--------|----------|:-:|
| 15 | BTC.INT.001 | `integration_alignment` | single_select | All identified and approved, Some identified but not approved, Unknown | Yes | Yes (integration_inventory, M365/Azure) |
| 16 | BTC.INT.002 | `service_principal_governance` | single_select | Yes, Partially, No, Unknown | Yes | Yes (spn_export, Entra) |
| 17 | BTC.INT.003 | `forwarding_alignment` | single_select | Yes, Partially, No, Unknown | Yes | Yes (config_export, Exchange) |
| 18 | BTC.INT.004 | `backup_boundary_alignment` | single_select | All in scope, Some out of scope, Unknown | Yes | Yes (backup_config, Backup platform) |

### DV-06: Exception & Governance Validation (4 questions)

| # | ID | Field (btc binding) | Answer Type | Values | Required | Evidence Required |
|---|-----|---------------------|-------------|--------|----------|:-:|
| 19 | BTC.GOV.001 | `exception_register` | single_select | Yes, No, Unknown | Yes | No |
| 20 | BTC.GOV.002 | `compensating_controls` | single_select | Yes, Partially, No, Unknown | Yes | No |
| 21 | BTC.GOV.003 | `risk_acceptance` | single_select | Yes, Partially, No, Unknown | Yes | No |
| 22 | BTC.GOV.004 | `change_governance` | single_select | Yes, Partially, No, Unknown | Yes | No |

### Virtual Question (conditionally substituted)

| ID | Field | Answer Type | Values | Required | Evidence Required |
|----|-------|-------------|--------|----------|:-:|
| BTC.DEV.002.CA_ENFORCEMENT_PROOF | `device_ca_enforcement` | single_select | Proof provided (exports/screenshots), Not enforced, Unknown | Yes | Yes (export, Entra/Conditional Access) |

This virtual question replaces BTC.DEV.002 when the activation rule `BTC-RULE-MANAGED-ONLY` fires (managed devices required).

---

## 2. Activation Package (Dynamic Runlist Rules)

Unlike other CES wizards that present a fixed question set, BTC uses an **activation package** (`CES BTC Activation Package.yaml`) with **9 rules** that dynamically adjust verification depth. The runlist engine (`runlistEngine.ts`) evaluates each rule's conditions against SI and CUI outputs and applies actions.

| Rule ID | Description | Priority | Source | Condition | Action |
|---------|------------|:--------:|--------|-----------|--------|
| BTC-RULE-BYOD-DIRECT | BYOD direct access elevates device verification | 95 | CUI `byod_model` | `Yes - direct access allowed` | Enable DV-02 full + risk flag `byod_direct_access_high_boundary_risk` |
| BTC-RULE-DEVOPS-SCOPE | DevOps in scope activates DevOps section | 90 | CUI `devops_in_scope` | `Yes` | Enable DV-04 full |
| BTC-RULE-BACKUP-OUT-OF-SCOPE | Out-of-scope backup requires validation | 88 | CUI `backup_model` | `Third-party backup (out-of-scope)` | Require BTC.INT.004 + risk flag `backup_outside_boundary_requires_comp_controls` |
| BTC-RULE-SHARED-IDENTITY | Shared identity increases identity depth | 85 | CUI `shared_identity` | `Yes` or `Partially` | Enable DV-01 full + risk flag `shared_identity_increases_assessor_scrutiny` |
| BTC-RULE-SI-NO-EXTERNAL | No external collaboration enforces interconnection check | 82 | SI `external_collaboration_posture` | `No external sharing` | Enable DV-05 full |
| BTC-RULE-DEVOPS-NOT-IN-SCOPE | DevOps out of scope reduces section to minimal | 80 | CUI `devops_in_scope` | `No` or `Unknown` | Set DV-04 to minimal |
| BTC-RULE-MANAGED-ONLY | Managed-only devices substitutes unmanaged question | 75 | CUI `managed_device_required` | `Yes - managed only` | Substitute BTC.DEV.002 with BTC.DEV.002.CA_ENFORCEMENT_PROOF |
| BTC-RULE-NO-GUESTS | No guest access requires explicit confirmation | 70 | CUI `guest_access_policy` | `No` | Require BTC.ID.003 full |
| BTC-RULE-EMAIL-FWD-NO | Email forwarding prohibited requires Exchange proof | 70 | CUI `email_forwarding_posture` | `No` | Require BTC.INT.003 full |

**Decision log:** Every rule evaluation (matched or skipped) is logged with the rule ID, description, and the actual input values evaluated. The decision log is embedded in the BTC confirmation artifact and displayed in dev mode via the `DecisionLogViewer` component.

**Source:** `CES BTC Activation Package.yaml`, `runlistEngine.ts`

---

## 3. SI and CUI Derivation Chains (10 pre-populated questions)

BTC answers are pre-populated from two sources: **SI baseline** (3 questions) and **CUI boundary** (7 questions). Derived answers use `provenance_class: 'operator_inference'`.

### SI -> BTC Derivation (3 questions)

| BTC Question | SI Field | Transform |
|-------------|----------|-----------|
| BTC.DEVOPS.001 | `operations.devops_touches_cui` | `false` -> "No" |
| BTC.DEVOPS.002 | `operations.devops_touches_cui` | `false` -> "N/A — DevOps not in scope" |
| BTC.DEVOPS.003 | `operations.devops_touches_cui` | `false` -> "N/A — DevOps not in scope" |

### CUI -> BTC Derivation (7 questions)

| BTC Question | CUI Source | Transform |
|-------------|-----------|-----------|
| BTC.GOV.001 | CUI.GEN.001 (CUI generation mode) | "Both" -> "CUI created and received"; includes("received") -> "CUI received only" |
| BTC.INT.003 | CUI.LC.EGR.001 (egress model) | includes("no") -> "No external email forwarding" |
| BTC.ID.001 | CUI.ID.001 (tenant isolation) | includes("isolated") -> "Yes — dedicated identity domain" |
| BTC.ID.002 | CUI.ID.002 (shared identity) | "Yes..." -> "Yes"; "No" -> "No" |
| BTC.ID.003 | CUI.USR.002 (user count) | Number > 0 -> "{N} in-scope users identified" |
| BTC.DEV.001 | CUI.DEV.001 (device model) | includes("managed only") -> "Managed devices only"; includes("vdi") -> "VDI / Cloud PC only"; includes("byod") -> "BYOD with MDM enrollment required" |
| BTC.LOG.001 | CUI.LC.RET.001 (retention model) | Non-empty string -> direct pass-through |

**Key rule:** Evidence-required BTC questions are pre-filled but **NOT skipped**. Only questions that are both derived AND do not require evidence are skippable. Since 18 of 22 bank questions require evidence, only the 4 governance questions (DV-06) are candidates for auto-skip.

**Source:** `btcSICUIDerivation.ts`

---

## 4. Risk Flags (Per-Question)

Each BTC question defines risk flags that trigger when specific answers are given:

| Question | Risk Flag | Trigger |
|----------|-----------|---------|
| BTC.ID.001 | `unexpected_global_admin_if_false` | GA list does not match declared scope |
| BTC.ID.002 | `privilege_sprawl_if_yes` | Unexpected privileged roles found |
| BTC.ID.003 | `guest_misalignment_if_not_aligned` | Guests present but not aligned |
| BTC.ID.004 | `no_breakglass_if_no` | No break-glass accounts configured |
| BTC.DEV.001 | `unmanaged_cui_access_if_no` | Not all CUI users have compliant devices |
| BTC.DEV.002 | `unmanaged_access_if_yes` | Unmanaged devices accessing CUI |
| BTC.DEV.002.CA_ENFORCEMENT_PROOF | `ca_not_enforcing_device_compliance_if_not_enforced` | CA not enforcing device compliance |
| BTC.DEV.003 | `no_paw_if_no` | No PAW/SAW for admins |
| BTC.LOG.001 | `no_audit_log_if_no` | UAL not enabled |
| BTC.LOG.002 | `no_siem_ingestion_if_no` | Sentinel not ingesting |
| BTC.LOG.003 | `retention_mismatch_if_no` | Retention not configured as declared |
| BTC.LOG.004 | `log_tamper_risk_if_no` | No tamper protection |
| BTC.DEVOPS.001 | `cui_repo_outside_boundary_if_yes` | Repos outside boundary |
| BTC.DEVOPS.002 | `pipeline_outside_boundary_if_no` | Pipelines outside boundary |
| BTC.DEVOPS.003 | `artifact_leak_risk_if_no` | Artifact storage outside enclave |
| BTC.INT.001 | `unknown_integrations_if_not_all` | Unapproved integrations |
| BTC.INT.002 | `spn_sprawl_if_no` | Service principals not governed |
| BTC.INT.003 | `email_egress_risk_if_no` | Email forwarding unrestricted |
| BTC.INT.004 | `backup_outside_boundary_if_some` | Backups outside boundary |
| BTC.GOV.001 | `no_exception_register_if_no` | No exception register |
| BTC.GOV.002 | `no_comp_controls_if_no` | No compensating controls |
| BTC.GOV.003 | `unapproved_risk_if_no` | Risk not formally accepted |
| BTC.GOV.004 | `weak_change_governance_if_no` | Weak change governance |

Additionally, the **activation package** can inject risk flags dynamically:
- `shared_identity_increases_assessor_scrutiny` (BTC-RULE-SHARED-IDENTITY)
- `byod_direct_access_high_boundary_risk` (BTC-RULE-BYOD-DIRECT)
- `backup_outside_boundary_requires_comp_controls` (BTC-RULE-BACKUP-OUT-OF-SCOPE)

---

## 5. Gate Evaluation

BTC is unique among CES wizards in producing **gate statuses** — per-section pass/fail verdicts that determine boundary confidence. The `gateEvaluator.ts` evaluates each section's questions:

**Pass criteria per section:**
- All required questions must be answered
- All questions with `evidence_required` must have at least one evidence attachment

**Gate sections:**
| Gate | Section | Domain | Gating |
|------|---------|--------|:------:|
| DV-01 | Identity Verification | Identity | Yes |
| DV-02 | Device Verification | Device | Yes |
| DV-03 | Logging & Telemetry Verification | Logging | Yes |
| DV-04 | DevOps Verification | DevOps | Yes |
| DV-05 | Interconnection Verification | Interconnection | Yes |
| DV-06 | Exception & Governance Validation | Governance | Yes |

Gate status is stored as `Record<string, BTCGateStatus>` in the confirmation artifact and consumed by 5 downstream systems.

**Source:** `gateEvaluator.ts`

---

## 6. Downstream Consumers

### 6.1 Gap Compiler — Gate Failure Gaps

**File:** `gapCompiler.ts` | **Consumes:** gate_status

Failed BTC gates generate HIGH-severity gaps in the gap analysis:

| Input | Effect |
|-------|--------|
| `gate_status[sectionId].pass === false` | Creates a gap with `gap_reason: "BTC gate failure: {reason}"`, severity HIGH |
| BTC gate failure gaps | Exempt from boundary-relevance severity downgrade (always stay HIGH) |

The gap compiler iterates all failed gates and matches them to CMMC requirements in the corresponding domain. Each matched requirement gets a gap with classifications `['manual']`.

**Source:** `gapCompiler.ts` lines 416-452, 486-487

### 6.2 Task Compiler — Gate Failure Enrichment & Risk Remediation Tasks

**File:** `taskCompiler.ts` | **Consumes:** gate_status, risk_flags, decision_log

Three BTC integration points:

**A. Gate failure enrichment** — For any task whose CMMC domain matches a failed BTC gate:
- Priority is boosted (one level higher)
- `[BTC Gate Failure]` prefix added to `what_to_do`
- `[BTC Re-Verification]` suffix added to `how_to_verify`
- `btc_gate_context` metadata attached (gate_id, failure_reason)

**B. Decision log injection** — Matching decision log entries are appended to task rationale:
- `[BTC Decision] {rule_id}: {description} — result: {result}`

**C. Risk flag remediation tasks** — High/critical BTC risk flags generate standalone remediation tasks:
- Task ID: `task_BTC_RISK_{flag_id}`
- Title: `Remediate BTC risk: {description}`
- Priority: p0 (critical) or p1 (high)
- Includes re-verification criteria

**Source:** `taskCompiler.ts` lines 42-48, 141-170, 182-231

### 6.3 Manifest Generator — Normative Controls, Evidence Monitors, Drift Policies

**File:** `manifestGenerator.ts` | **Consumes:** gate_status

Three manifest sections use BTC data:

**A. Normative controls** — Failed gates produce normative controls:
| Input | Control ID | Required State |
|-------|-----------|----------------|
| Failed gate | `btc_gate_{domain}` | Re-verify after remediation: {reason} |

Each control includes a verification check with method `manual_attestation` and escalation on fail.

**B. Evidence monitors** — Failed gates produce daily-cadence monitors:
| Input | Signal | Cadence | Severity |
|-------|--------|---------|----------|
| Failed gate | `BTC gate re-verification: {domain}` | daily | critical |

**C. Drift policies** — Failed gates produce a critical drift policy:
| Input | Scope | Response |
|-------|-------|----------|
| All failed gates (aggregated) | `BTC Gate Re-Verification: {gate summaries}` | Immediate escalation, re-run BTC, document evidence |

**Source:** `manifestGenerator.ts` lines 59-63, 209-224, 646-660, 799-819

### 6.4 Proposal Generator — Boundary Compliance Section

**File:** `proposalGenerator.ts` | **Consumes:** gate_status, risk_flags

When BTC confirmation exists, the proposal's `boundary_compliance` section includes:

| Field | Source |
|-------|--------|
| `btc_verified` | `true` |
| `btc_generated_on` | `ces.generated_on` |
| `gate_summary` | `{total, pass, fail}` counts |
| `risk_flags` | Array of `{flag_id, domain, severity, description}` |

**Source:** `proposalGenerator.ts` lines 133-165

### 6.5 Manual Plan Generator — Input References & Boundary Context

**File:** `manualPlanGenerator.ts` | **Consumes:** gate_status, risk_flags, evidence_refs

Two integration points:

**A. Input references block:**
| Field | Source |
|-------|--------|
| `btc_confirmation_ref.artifact` | `ces.artifact` |
| `btc_confirmation_ref.version` | `ces.version` |
| `btc_confirmation_ref.generated_on` | `ces.generated_on` |
| `btc_confirmation_ref.btc_bank_version` | `ces.btc_bank_version` |
| `btc_confirmation_ref.activation_package_version` | `ces.activation_package_version` |
| `btc_confirmation_ref.gate_summary` | `{total, pass, fail}` counts |

**B. Boundary context section:**
| Field | Source |
|-------|--------|
| `btc_verification.gate_status` | Full gate status record |
| `btc_verification.risk_flags` | Full risk flags array |
| `btc_verification.evidence_count` | `evidence_refs.length` |

**Source:** `manualPlanGenerator.ts` lines 125-138, 261-268

### 6.6 Policy Context Compiler — btc.* Namespace

**File:** `policyContextCompiler.ts` | **Consumes:** gate_status

| Template Variable | Source |
|-------------------|--------|
| `btc.gate_status` | Full `Record<string, {pass, reason}>` |
| `btc.has_btc` | Boolean: gate_status has entries |

Available in all 17 Handlebars Markdown policy document templates.

**Source:** `policyContextCompiler.ts` lines 104-107, 258-261

### 6.7 Cross-Artifact Validator

**File:** `validator.ts` | **4 BTC checks**

| Check | What It Validates |
|-------|-------------------|
| 6a | Failed BTC gates produce warnings |
| 6b | Critical/high BTC risk flags produce warnings |
| 8 | Failed BTC gates must have matching `btc_gate_{domain}` normative controls in manifest |
| — | Missing normative control for failed gate produces a warning |

**Source:** `validator.ts` lines 131-150, 159-171

### 6.8 Consistency Checker

**File:** `consistencyChecker.ts` | **4 BTC rules**

| Rule ID | Description | Severity |
|---------|-------------|----------|
| `btc-staleness` | CUI boundary is newer than BTC — consider re-running BTC | info |
| `cui-identity-vs-btc-gate` | CUI says identity is isolated but BTC identity gate failed | warning |
| `cui-device-vs-btc-gate` | CUI says managed devices only but BTC device gate failed | warning |
| `btc-gate-vs-rp-status` | BTC gate failed for a domain but all RP requirements in that domain are met (stale RP) | warning |

**Source:** `consistencyChecker.ts` lines 122-228

### 6.9 RRT — BTC Evidence Adapter

**File:** `btcEvidenceAdapter.ts` | **Consumes:** evidence_refs

BTC evidence references are converted into RRT `EvidenceItem` format and injected into the RRT evidence store:

| BTC Field | RRT Field |
|-----------|-----------|
| `evidence_id` | `evidence_id` |
| `source_system` | `source_system` |
| `location` | `location` |
| `hash_sha256` | `hash_sha256` |
| `captured_at` | `captured_at` |
| `question_id` | `supporting_question_ids[0]` |
| — | `archetype_id` = `'btc_evidence'` |
| `notes` | `notes` = `"From BTC: {notes}"` |

This evidence is added idempotently (skips if already present) and also passed to the posture generator.

**Source:** `btcEvidenceAdapter.ts`, `RRTWizard.tsx` lines 132-148

### 6.10 RRT — Bulk Answer Derivation (BTC Risk Flag Gate)

**File:** `bulkAnswerDerivation.ts` | **Consumes:** risk_flags

BTC risk flags influence RRT action status derivation (rule 4.5 in priority chain):

| Input | Condition | Effect |
|-------|-----------|--------|
| High/critical risk flag matching domain | `flag.domain === action.domain && flag.severity in ['high', 'critical']` | Action status downgraded to `'partial'` with `derivation_source: 'btc_risk_flag'` |

This ensures that domains with BTC-flagged risks cannot auto-derive as "met" in readiness assessment.

**Source:** `bulkAnswerDerivation.ts` lines 391-407, 499

### 6.11 Export Plan Utility

**File:** `exportPlan.ts` | **3 rendering paths**

| Format | Section | Content |
|--------|---------|---------|
| Text | BTC VERIFICATION STATUS | Gate summary (pass/fail counts), evidence count, per-gate pass/fail table, risk flags |
| HTML | BTC Verification Status | Stats cards (pass/fail/evidence), gate table with color coding, risk flag cards |
| HTML | Input References | BTC Confirmation reference card with artifact metadata and gate summary |
| HTML | Task how_to_verify | `[BTC Re-Verification]` items get red-highlighted styling |

**Source:** `exportPlan.ts` lines 770-795, 1811-1843, 1882-1893, 1743-1744

---

## 7. Data Persistence

| Layer | Location | Details |
|-------|----------|---------|
| Wizard state | localStorage `ces-btc-store` | Zustand persisted: answers, evidenceItems, runlist |
| Artifact | IndexedDB `btc_confirmations` | Index: `++id, customerId, baselineId, cuiBoundaryId, [customerId+baselineId]` |
| Disk (dev) | `customers/{name}/inputs/btc-confirmation-{id}.json` | Via `persistBTCConfirmation()` |
| App store | localStorage `ces-app-store` | `selectedBTCConfirmationId` — reset on customer/baseline/CUI boundary change |

**Cascade rules:**
- Deleting a **CUI boundary** cascades to delete all linked BTC confirmations (`deleteCUIBoundary` in `schema.ts`)
- Deleting a **baseline** cascades to delete all CUI boundaries and their BTC confirmations (Landing page deletion handler)
- Changing the selected CUI boundary resets `selectedBTCConfirmationId` to null

**DB schema version:** Added in version 3 (alongside `cui_boundaries`).

---

## 8. Landing Page Integration

BTC appears as a dedicated card on the landing page, positioned between CUI Boundary and Tenant Config Profile:

**Prerequisite:** CUI boundary must be selected (`hasCUIBoundary === true`) before BTC is enabled.

**Card features:**
- Dropdown: Lists available BTC confirmations (labeled by creation date)
- Auto-select: First available BTC confirmation is auto-selected
- 5-button grid: New / View / Export / Cancel+Confirm (delete) or spacer+Delete
- Status messaging: "Complete CUI boundary definition to unlock BTC verification." when disabled
- Color coding: Green if BTC confirmations exist; gray if CUI boundary not yet defined

**New button:** Resets the BTC store and navigates to `/btc`

**MPT Description:** The mission planner description dynamically reflects BTC status:
- With BTC: standard description
- Without BTC: "Note: BTC not verified — plan will not include boundary context."

**Route:** `/btc` -> `BTCPage` -> `BTCWizard`

---

## 9. Data Flow Diagram

```
SI Baseline (3 derived answers: DEVOPS.001-.003)
  |
  +-- Extract siOutputs (isolation_philosophy, external_collaboration_posture,
  |                       third_party_tolerance, automation_ambition)
  |
  v
CUI Boundary (7 derived answers: GOV.001, INT.003, ID.001-.003, DEV.001, LOG.001)
  |
  +-- Extract cuiOutputs (full cui_boundary record)
  |
  v
Activation Package (9 rules) ---> Runlist Engine (buildRunlist)
  |                                     |
  |-- Evaluate conditions vs SI + CUI   |-- Enable/disable sections
  |-- Decision log                      |-- Set question modes (full/minimal/substitute)
  |                                     |-- Inject risk flags
  v                                     v
Runlist (22+ entries, dynamic)    +   Decision Log
  |
  v
BTCWizard (orchestration)
  |-- SI/CUI Derivation (10 questions pre-populated)
  |-- Previous Run Hydration (reverseMapBTCConfirmation)
  |-- YAML Recommendations (questions with `recommended` values)
  |-- Autofill Service (positive/compliant defaults)
  |-- New Tenant Fill (negative/unknown defaults)
  |-- Default Evidence Seeding (placeholder evidence per question)
  |-- Evidence Gate (blocks progression until evidence attached)
  |
  v
BTCStore (Zustand, persisted to localStorage)
  |
  v
generateBTCConfirmation() -> BTCConfirmationOutput
  |-- answers: Record<string, {question_id, answer, mode, evidence_ids, captured_at}>
  |-- evidence_refs: BTCEvidenceRef[]
  |-- risk_flags: BTCRiskFlag[]
  |-- gate_status: Record<sectionId, {domain, pass, reason}>
  |-- decision_log: BTCDecisionLogEntry[]
  |
  v
Save to IndexedDB (btc_confirmations) + disk persistence
  |
  v
selectedBTCConfirmationId in AppStore -> useWorkflowState
  |
  +---> Gap Compiler          (failed gates -> HIGH-severity gaps)
  +---> Task Compiler          (gate enrichment + risk flag remediation tasks + decision log)
  +---> Manifest Generator     (normative controls + evidence monitors + drift policies)
  +---> Proposal Generator     (boundary_compliance: btc_verified, gate_summary, risk_flags)
  +---> Manual Plan Generator  (btc_confirmation_ref + boundary_context.btc_verification)
  +---> Policy Context         (btc.gate_status + btc.has_btc -> 17 Handlebars templates)
  +---> Cross-Artifact Validator (gate warnings + risk flag warnings + manifest cross-check)
  +---> Consistency Checker    (staleness, identity gate vs CUI, device gate vs CUI, gate vs RP)
  +---> RRT Evidence Adapter   (evidence_refs -> RRT EvidenceItem format)
  +---> RRT Bulk Derivation    (risk_flags -> domain action status downgrade)
  +---> Export Plan            (text/HTML rendering: gate stats, risk flags, BTC references)
```

---

## 10. Impact Summary Matrix

| BTC Field / Section | Gap Compiler | Task Compiler | Manifest | Proposal | Manual Plan | Policy | Validator | Consistency | RRT Evidence | RRT Derivation | Export |
|---------------------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| `gate_status` (all) | HIGH gaps | Priority boost + enrichment | Normative + monitors + drift | Gate summary | Input ref + context | Yes | 3 checks | 3 rules | — | — | Gate stats |
| `gate_status` (identity) | Identity gaps | Identity tasks | Identity controls | — | — | — | — | CUI identity check | — | — | Yes |
| `gate_status` (device) | Device gaps | Device tasks | Device controls | — | — | — | — | CUI device check | — | — | Yes |
| `gate_status` (logging) | Logging gaps | Logging tasks | Logging controls | — | — | — | — | — | — | — | Yes |
| `gate_status` (devops) | DevOps gaps | DevOps tasks | DevOps controls | — | — | — | — | — | — | — | Yes |
| `gate_status` (interconnection) | Interconnect gaps | Interconnect tasks | Interconnect controls | — | — | — | — | — | — | — | Yes |
| `gate_status` (governance) | Governance gaps | Governance tasks | Governance controls | — | — | — | — | — | — | — | Yes |
| `risk_flags` | — | p0/p1 remediation tasks | — | Risk flag list | — | — | High/critical warnings | — | — | Domain downgrade | Risk flags |
| `decision_log` | — | Task rationale injection | — | — | — | — | — | — | — | — | — |
| `evidence_refs` | — | — | — | — | Evidence count | — | — | — | RRT evidence items | — | Evidence count |
| `ces.generated_on` | — | — | — | `btc_generated_on` | Input ref | — | — | Staleness check | — | — | Metadata |
| `ces.btc_bank_version` | — | — | — | — | Input ref | — | — | — | — | — | Metadata |
| `ces.activation_package_version` | — | — | — | — | Input ref | — | — | — | — | — | Metadata |

**Key insight:** BTC has the deepest integration with the gap analysis and task compilation pipeline of any non-RRT artifact. Every failed gate cascades into HIGH-severity gaps, priority-boosted tasks with re-verification criteria, normative controls in the manifest, daily evidence monitors, and critical drift policies. BTC risk flags additionally influence RRT readiness assessment, ensuring boundary verification failures cannot be silently auto-derived as "met" in downstream posture generation.
