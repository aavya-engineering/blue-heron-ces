# CES Data Dictionary

> Auto-generated 2026-02-07. Covers all 10 YAML data stores in `public/data/`.

## Overview

| # | File | TS Type | Loader | Hook | Entries | Role in Pipeline |
|---|------|---------|--------|------|---------|------------------|
| 1 | `primed SI Question Bank.yaml` | `SIQuestionBank` | `loadSIQuestionBank` | `useSIQuestionBank` | 5 questions | SIT wizard input |
| 2 | `primed RR Question Bank.yaml` | `RRQuestionBank` | `loadRRQuestionBank` | `useRRQuestionBank` | 3 activities | RRT wizard input |
| 3 | `domain CES CMMC Fundamental Requirements Store.yaml` | `CMMCRequirementsStore` | `loadCMMCRequirements` | `useCMMCRequirements` | 14 domains, 50 archetypes | Gap compiler, task compiler |
| 4 | `domain Evidence Archetype Catalog.yaml` | `EvidenceArchetypeCatalog` | `loadEvidenceArchetypes` | `useEvidenceArchetypes` | 50 archetypes | Evidence mapping |
| 5 | `domain Assessor Approach Knowledge Base.yaml` | `AssessorKnowledgeBase` | `loadAssessorKB` | `useAssessorKB` | 1 practice (stub) | Verification derivation, assessor notes |
| 6 | `domain Assessor Evidence Matrix.yaml` | `EvidenceMatrix` | `loadEvidenceMatrix` | `useEvidenceMatrix` | 1 mapping (stub) | Gap severity, evidence sufficiency |
| 7 | `domain Tech Stack Compliance Mapping.yaml` | `TechStackMapping` | `loadTechStackMapping` | `useTechStackMapping` | 6 stacks, 162 requirements | Tech stack context |
| 8 | `domain Capability Taxonomy.yaml` | `CapabilityTaxonomy` | `loadCapabilityTaxonomy` | `useCapabilityTaxonomy` | 15 capabilities, 163 practices | Practice-to-capability mapping |
| 9 | `domain Implementation Patterns.yaml` | `ImplementationPatterns` | `loadImplementationPatterns` | `useImplementationPatterns` | 163 patterns, 200 actions | Vendor-agnostic "what to do" |
| 10 | `vendor playbook Microsoft 365.yaml` | `VendorPlaybook` | `loadVendorPlaybook` | `useVendorPlaybook` | 200 playbook entries | M365-specific "how to do it" |

---

## Data Flow

```
Question Banks (1,2)          Domain Knowledge (3-7)         Actionable Layers (8-10)
─────────────────────         ────────────────────────       ─────────────────────────
SI Question Bank ──→ SIT ──→ SI Baseline                    Capability Taxonomy
RR Question Bank ──→ RRT ──→ Readiness Posture                    │
                                    │                       Implementation Patterns
                                    ▼                              │
                              Gap Compiler ◄── CMMC Reqs     Vendor Playbook M365
                                    │          Evidence            │
                                    │          Matrix              │
                                    ▼                              ▼
                              Task Compiler ◄──────────── selectVendorImplementation()
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
              Manual Plan    Exec Plan        Tenant Manifest
              Proposal
```

---

## 1. SI Question Bank

**File:** `primed SI Question Bank.yaml`
**TypeScript:** `SIQuestionBank` (from `src/shared/types/questions.ts`)
**Purpose:** Drives the SIT wizard. Each question maps to SI Baseline fields.
**Count:** 5 questions

### Schema

```
ces
├── artifact                    string    "ces_sit_question_bank_cmmc20_primed"
├── version                     string    "0.3.0"
├── generated_on                date      "2026-02-04"
├── intent                      string    Description of purpose
├── authoritative_sources[]
│   ├── id                      string    "cmmc-v2-model"
│   ├── title                   string    "CMMC Model v2.0"
│   └── type                    string    "government"
├── governance
│   ├── tag_policy
│   │   ├── FACT                string    Tagging rule
│   │   ├── INFERENCE           string    Tagging rule
│   │   └── OPEN_QUESTION       string    Tagging rule
│   └── change_control          string    Policy description
├── its_fields                  object    Maps SI Baseline sections to field lists
│   ├── si_baseline_target
│   │   ├── description         string
│   │   └── fields[]            string[]  ["target_cmmc_level", "cui_presence", ...]
│   ├── si_baseline_assessment  (same shape)
│   ├── si_baseline_scope       (same shape)
│   ├── si_baseline_operations  (same shape)
│   ├── si_baseline_evidence    (same shape)
│   ├── si_baseline_dependencies (same shape)
│   └── si_baseline_risk_acceptance (same shape)
└── question_bank
    ├── description             string
    └── questions[]
        ├── id                  string    "G-01"
        ├── text                string    Question prompt
        ├── applies_to_levels[] string[]  ["L1","L2","L3"]
        ├── sets_its_fields[]   string[]  ["target_cmmc_level"]
        ├── required            boolean   true
        ├── provenance
        │   ├── primary         string    "CMMC-v2-model"
        │   ├── validation_in_rrt boolean
        │   └── may_reference_sources[] string[]
        ├── advisor_description string    Human-readable context
        ├── advisor_reason_its  string    Why this question matters
        ├── advisor_cmmc_impact string    Compliance impact
        ├── advisor_pitfalls[]  string[]  Common mistakes
        ├── advisor_rr_implications[] string[]
        ├── advisor_mpt_gate_implications[] string[]
        ├── answer
        │   ├── type            enum      "enum" | "multi_select" | "structured_object"
        │   ├── options[]       (for enum/multi_select)
        │   │   ├── value       string    "L1"
        │   │   ├── description string
        │   │   ├── cmmc_attainment_impact string
        │   │   └── advisor_notes string
        │   ├── min_selections  integer   (multi_select only)
        │   ├── max_selections  integer   (multi_select only)
        │   ├── guidance        object    (for free_text / structured_object)
        │   │   ├── description string
        │   │   ├── cmmc_attainment_impact string
        │   │   └── advisor_notes string
        │   └── schema          object    (for structured_object — nested options)
        └── conditional_required_if (optional)
            ├── field           string    "target_cmmc_level"
            └── equals_any[]    string[]  ["L2","L3"]
```

---

## 2. RR Question Bank

**File:** `primed RR Question Bank.yaml`
**TypeScript:** `RRQuestionBank` (from `src/shared/types/questions.ts`)
**Purpose:** Drives the RRT wizard. Activities map to CMMC requirements and evidence.
**Count:** 3 universal activities

### Schema

```
ces
├── artifact                    string    "ces_rrt_readiness_recon_bank_cmmc20"
├── version                     string    "0.2.0"
├── generated_on                date      "2026-02-03"
├── intent                      string
├── authoritative_sources
│   ├── government[]
│   │   ├── id                  string
│   │   ├── title               string
│   │   ├── url                 string
│   │   ├── publisher           string
│   │   └── published_date      date
│   └── nist[]                  (same shape)
├── governance
│   ├── non_negotiables[]       string[]
│   └── tagging_policy
│       ├── allowed_tags[]      string[]  ["FACT","INFERENCE","OPEN_QUESTION"]
│       └── rules[]             string[]
├── sit_inputs_required[]       string[]  SI fields needed before RRT
├── rrt_fields
│   ├── scope[]                 string[]
│   ├── governance[]            string[]
│   └── practices[]             string[]
└── activity_bank
    └── universal
        ├── description         string
        └── activities[]
            ├── id              string    "RR-ACT-UNIV-BOUNDARY"
            ├── name            string    "Boundary Verification"
            ├── applies_to_levels[] string[]
            ├── produces_rrt_fields[] string[]
            ├── validates_sit_its_fields
            │   ├── confirms[]  string[]
            │   └── may_contradict[] string[]
            ├── provenance
            │   ├── primary     string
            │   └── reference_sources[] string[]
            ├── advisor_description string
            ├── advisor_reason_rrt string
            ├── advisor_cmmc_impact string
            ├── steps[]         string[]  Ordered steps for the activity
            ├── evidence_requests[]
            │   ├── id          string    "RR-EV-UNIV-BOUNDARY-001"
            │   ├── evidence_type string  "network_diagram"
            │   ├── description string
            │   ├── acceptable_forms[] string[]
            │   ├── collection_method string
            │   ├── retention_notes string
            │   ├── cmmc_attainment_impact string
            │   └── advisor_notes string
            ├── outputs[]       string[]  What the activity produces
            ├── mapped_requirements[] string[]  ["SC.L1-3.13.1", ...]
            ├── expected_evidence_archetypes[]
            │   ├── evidence_matrix_id string
            │   ├── archetype_id string  "EMX-BOUNDARY-001"
            │   └── assessor_methods[] string[]  ["examine","interview"]
            └── assessor_methods[] string[]  ["examine","interview","test"]
```

---

## 3. CMMC Fundamental Requirements Store

**File:** `domain CES CMMC Fundamental Requirements Store.yaml`
**TypeScript:** `CMMCRequirementsStore`
**Purpose:** Canonical CMMC requirement definitions. Used by gap compiler and task compiler.
**Count:** 14 domains, 50 evidence archetypes

### Schema

```
ces
├── artifact                    string
├── version                     string
├── generated_on                date
├── intent                      string
├── authoritative_sources
│   ├── government[]
│   │   ├── id                  string    "cmmc-v2-model"
│   │   ├── title               string
│   │   ├── url                 string
│   │   ├── publisher           string
│   │   └── published_date      date
│   └── nist[]                  (same shape)
├── governance
│   ├── non_negotiables[]       string[]
│   └── tagging_policy
│       ├── allowed_tags[]      string[]
│       └── rules[]             string[]
└── catalogs
    ├── domains[]
    │   ├── code                string    "AC"
    │   ├── name                string    "Access Control"
    │   └── description         string
    └── evidence_archetypes[]
        ├── id                  string    "emx-boundary-001"
        ├── name                string    "Network Boundary Diagram"
        ├── description         string
        ├── preferred_forms[]   string[]  ["Visio","Lucidchart export","PDF"]
        └── collection_methods[] string[] ["examine"]
```

### Domain Codes

| Code | Name |
|------|------|
| AC | Access Control |
| AT | Awareness & Training |
| AU | Audit & Accountability |
| CM | Configuration Management |
| IA | Identification & Authentication |
| IR | Incident Response |
| MA | Maintenance |
| MP | Media Protection |
| PS | Personnel Security |
| PE | Physical & Environmental Protection |
| RA | Risk Assessment |
| CA | Security Assessment |
| SC | System & Communications Protection |
| SI | System & Information Integrity |

---

## 4. Evidence Archetype Catalog

**File:** `domain Evidence Archetype Catalog.yaml`
**TypeScript:** `EvidenceArchetypeCatalog`
**Purpose:** Defines evidence types, acceptable forms, and collection guidance.
**Count:** 50 archetypes across 13 domains

### Schema

```
(root)
├── artifact                    string    "ces_evidence_archetype_catalog"
├── version                     string    "0.1.0"
├── generated_on                date
├── intent                      string
├── id_format                   string    "EMX-<DOMAIN>-<NNN>"
├── domains[]                   string[]  13 domains
└── evidence_archetypes[]
    ├── archetype_id            string    "EMX-BOUNDARY-001"
    ├── domain                  string    "BOUNDARY"
    ├── name                    string    "Boundary Architecture Diagram"
    ├── description             string    Multi-line description
    ├── assessor_methods_expected[] string[] ["examine"]
    ├── acceptable_forms_examples[] string[] ["Visio","Lucidchart","PDF"]
    ├── collection_notes        string    Guidance on how to collect
    ├── retention_notes_template string   Retention policy template
    └── maps_to_cmmc_practices[] string[] ["SC.L1-3.13.1","SC.L2-3.13.1"]
```

### Archetype Domains

BOUNDARY, DATAFLOW, IAM, ENDPOINT, CONFIG, LOG, VULN, RISK, IR, MEDIA, SUPPLIER, TRAINING, DEVOPS

---

## 5. Assessor Approach Knowledge Base

**File:** `domain Assessor Approach Knowledge Base.yaml`
**TypeScript:** `AssessorKnowledgeBase`
**Purpose:** How C3PAO assessors evaluate each practice. Drives verification steps and assessor notes.
**Count:** 1 practice (stub — needs expansion)

### Schema

```
ces
├── artifact                    string
├── version                     string
├── generated_on                date
├── intent                      string
├── truth_tags[]                string[]  ["FACT","INFERENCE","OPEN_QUESTION"]
├── authoritative_sources[]
│   ├── id                      string
│   └── type                    string
└── practices[]
    ├── practice_id             string    "AC.L2-3.1.1"
    ├── assessor_intent         string    What the assessor is trying to determine
    ├── assessor_methods[]      string[]  ["examine","interview","test"]
    ├── what_assessors_probe[]  string[]  Specific things assessors look for
    ├── common_failure_modes[]  string[]  Why organizations fail this practice
    ├── partial_credit_guidance string    When partial credit may apply
    ├── level3_depth_notes      string    Additional rigor for L3
    └── truth_tag               string    "FACT" | "INFERENCE" | "OPEN_QUESTION"
```

---

## 6. Assessor Evidence Matrix

**File:** `domain Assessor Evidence Matrix.yaml`
**TypeScript:** `EvidenceMatrix`
**Purpose:** Maps practices to required evidence with strength ratings. Drives gap severity.
**Count:** 1 mapping (stub — needs expansion)

### Schema

```
ces
├── artifact                    string
├── version                     string
├── generated_on                date
├── intent                      string
├── evidence_strength_tiers[]   string[]  ["weak","adequate","strong"]
└── mappings[]
    ├── practice_id             string    "AC.L2-3.1.1"
    ├── assessor_methods[]      string[]  ["examine","interview","test"]
    ├── evidence[]
    │   ├── emx_id              string    "EMX-IAM-001"
    │   ├── strength            string    "strong" | "adequate" | "weak"
    │   └── description         string    Why this evidence matters
    ├── anti_patterns[]         string[]  Evidence that looks right but fails
    └── truth_tag               string    "FACT"
```

---

## 7. Tech Stack Compliance Mapping

**File:** `domain Tech Stack Compliance Mapping.yaml`
**TypeScript:** `TechStackMapping`
**Purpose:** Maps vendor tech stacks to CMMC requirements.
**Count:** 6 tech stacks, ~162 CMMC requirements

### Schema

```
(root)
├── schema_name                 string    "TechStack-CMMC-Mapping"
├── schema_version              string
├── generated_on                date
├── TechStacks[]
│   ├── id                      integer   1
│   ├── name                    string    "Microsoft 365 GCC High"
│   ├── vendor                  string    "Microsoft"
│   ├── description             string
│   └── fedramp_level           string    "High"
└── CMMC_Requirements[]
    ├── id                      integer   1
    ├── requirement_id          string    "AC.L1-3.1.1"
    ├── level                   string    "L1"
    ├── domain                  string    "AC"
    ├── title                   string    "Authorized Access Control"
    ├── requirement_text        string    Full requirement text
    ├── truth_tag               string    "FACT"
    └── source_ids[]            string[]  ["cmmc-v2-model","sp800-171-r2"]
```

### Tech Stacks

| ID | Name | Vendor | FedRAMP |
|----|------|--------|---------|
| 1 | Microsoft 365 GCC High | Microsoft | High |
| 2 | Microsoft 365 GCC | Microsoft | Moderate |
| 3 | Google Workspace + Chronicle | Google | Moderate |
| 4 | AWS GovCloud | Amazon | High |
| 5 | Hybrid On-Prem + Azure | Microsoft | Moderate |
| 6 | Custom / Best-of-Breed | Multiple | Varies |

---

## 8. Capability Taxonomy

**File:** `domain Capability Taxonomy.yaml`
**TypeScript:** `CapabilityTaxonomy`
**Purpose:** Maps CMMC practices to functional security capabilities. Groups practices under vendor-implementable capability areas.
**Count:** 15 capabilities, 163 practices

### Schema

```
ces
├── artifact                    string    "capability_taxonomy"
├── version                     string    "1.0.0"
└── generated_on                date      "2026-02-07"
capabilities[]
├── id                          string    "identity_access_management"
├── name                        string    "Identity & Access Management"
├── abbreviation                string    "IAM"
├── description                 string    Multi-line capability description
├── cmmc_domains[]              string[]  ["AC","IA"]
├── vendor_stack_components
│   └── microsoft_365[]         string[]  ["Entra ID","Conditional Access","PIM","RBAC"]
└── practices[]
    ├── id                      string    "AC.L1-3.1.1"
    ├── title                   string    "Authorized Access Control"
    └── capability_role         string    "Restrict system access to authorized users"
```

### Capabilities

| ID | Abbreviation | Name | CMMC Domains |
|----|-------------|------|--------------|
| identity_access_management | IAM | Identity & Access Management | AC, IA |
| network_boundary_protection | NBP | Network & Boundary Protection | SC |
| data_protection | DP | Data Protection & CUI Handling | MP, SC |
| cryptographic_protection | CRYPTO | Cryptographic Protection | SC |
| endpoint_management | EPM | Endpoint Management & Protection | SC, SI |
| configuration_change_management | CCM | Configuration & Change Management | CM |
| audit_monitoring | AML | Audit, Monitoring & Logging | AU |
| vulnerability_patch_management | VPM | Vulnerability & Patch Management | RA, SI |
| incident_response | IR | Incident Response | IR |
| awareness_training | AT | Security Awareness & Training | AT |
| personnel_security | PS | Personnel Security | PS |
| physical_security | PES | Physical & Environmental Security | PE |
| maintenance | MAINT | Maintenance | MA |
| media_asset_protection | MAP | Media & Asset Protection | MP |
| risk_security_assessment | RSA | Risk & Security Assessment | CA, RA |

---

## 9. Implementation Patterns

**File:** `domain Implementation Patterns.yaml`
**TypeScript:** `ImplementationPatterns`
**Purpose:** Vendor-agnostic actions for each CMMC practice. Describes WHAT to do, not HOW.
**Count:** 163 patterns, 200 actions

### Schema

```
ces
├── artifact                    string    "implementation_patterns"
├── version                     string    "1.0.0"
└── generated_on                date      "2026-02-07"
patterns[]
├── practice_id                 string    "AC.L1-3.1.1"
├── capability                  string    "identity_access_management"
├── pattern_id                  string    "IAM-001"
├── pattern_name                string    "Enforce Authorized Access"
└── actions[]
    ├── id                      string    "IAM-001-01"
    ├── action                  string    "Define access control policy specifying who..."
    ├── action_type             enum      "policy" | "configuration" | "process" |
    │                                     "monitoring" | "training" | "assessment"
    └── evidence_outputs[]      string[]  ["access_control_policy"]
```

### Action Types

| Type | Meaning |
|------|---------|
| `policy` | Create/update a written policy or procedure document |
| `configuration` | Configure a system, service, or tool |
| `process` | Establish an operational process or workflow |
| `monitoring` | Set up ongoing monitoring, alerting, or review |
| `training` | Deliver training or awareness content |
| `assessment` | Perform an evaluation, scan, or test |

### Key Relationship

`patterns[].actions[].id` → joins to → `playbook[].action_id` in the Vendor Playbook.

---

## 10. Vendor Playbook — Microsoft 365

**File:** `vendor playbook Microsoft 365.yaml`
**TypeScript:** `VendorPlaybook`
**Purpose:** M365-specific implementation for each pattern action. Portal paths, PowerShell commands, Graph API calls, evidence collection.
**Count:** 200 playbook entries

### Schema

```
ces
├── artifact                    string    "vendor_playbook"
├── vendor                      string    "microsoft_365"
├── version                     string    "1.0.0"
├── generated_on                date      "2026-02-07"
└── license_requirements[]      string[]  ["Microsoft 365 E5 or E5 Security",
                                           "Azure P2 license for PIM",
                                           "Microsoft Sentinel"]
playbook[]
├── action_id                   string    "IAM-001-01"    ← joins to patterns[].actions[].id
├── m365_service                string    "Entra ID"
├── implementation              string    "Configure Entra ID as identity provider..."
├── portal_path                 string    "entra.microsoft.com > Identity > Users > ..."
├── powershell[]                string[]  ["Connect-MgGraph -Scopes '...'",
│                                          "New-MgIdentityGovernance..."]
├── graph_api[]                 string[]  (optional) REST API calls
├── evidence_commands[]         string[]  ["Get-MgUser -All | Select ... | Export-Csv ..."]
└── notes                       string    (optional) Caveats, prerequisites
```

### M365 Services Referenced

|


---

## Cross-File Join Keys

These fields link the data stores together:

| From | Field | To | Field | Purpose |
|------|-------|----|-------|---------|
| Capability Taxonomy | `practices[].id` | Implementation Patterns | `practice_id` | Capability → pattern lookup |
| Implementation Patterns | `actions[].id` | Vendor Playbook | `action_id` | Pattern → M365 how-to |
| Implementation Patterns | `practice_id` | CMMC Requirements | `requirement_id` | Pattern → requirement context |
| Implementation Patterns | `capability` | Capability Taxonomy | `capabilities[].id` | Back-reference to capability |
| Evidence Archetype Catalog | `archetype_id` | RR Question Bank | `expected_evidence_archetypes[].archetype_id` | Activity → evidence type |
| Assessor Evidence Matrix | `evidence[].emx_id` | Evidence Archetype Catalog | `archetype_id` | Matrix → archetype detail |
| Assessor Evidence Matrix | `practice_id` | CMMC Requirements | `requirement_id` | Matrix → requirement |
| Assessor Approach KB | `practice_id` | CMMC Requirements | `requirement_id` | Assessor approach → requirement |
| Tech Stack Mapping | `requirement_id` | CMMC Requirements | `requirement_id` | Stack → requirement coverage |

---

## Caching

All data files are loaded via `DataLoaderService` which:
1. Checks IndexedDB cache (`domain_data_cache` / `question_banks_cache` table) first
2. Fetches YAML from `/data/` on cache miss
3. Parses with `js-yaml`
4. Optionally validates against JSON schema via AJV
5. Stores in IndexedDB with version and timestamp
6. Deduplicates concurrent requests via promise map

Cache key names match `DATA_FILES` constants (e.g., `CAPABILITY_TAXONOMY`, `VENDOR_PLAYBOOK_M365`).
