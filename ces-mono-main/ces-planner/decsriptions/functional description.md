# CES Front End (CES FE) — Functional Description

## 1. Purpose and Role

The **CES Front End (CES FE)** is the authoritative human interface to the CES system. Its purpose is to:

- Capture **Strategic Intent** with rigor and completeness  
- Materialize that intent into an **immutable SI Baseline**  
- Orchestrate downstream automation (RRT, MPT, Proposal, Tenant Manifest)  
- Provide **explainability, traceability, and assessor-aligned justification** at every step  

The CES FE **does not invent requirements, controls, or interpretations**.  
It is a **rules-driven interface** over authoritative data stores and schemas.

---

## 2. Design Principles

### 2.1 Begin With the End in Mind
The CES FE is designed **from the assessor backward**.  
All questions, decisions, and outputs are shaped by:
- CMMC Model requirements  
- CMMC Assessment Guides  
- Observed assessor behaviors and evidence expectations  

### 2.2 Deterministic, Not Conversational
- The FE is **not a chatbot**  
- Every question, prompt, and decision:
  - Is schema-backed  
  - Has a defined purpose  
  - Produces structured output consumed downstream  

### 2.3 Separation of Concerns
The FE enforces **strict phase boundaries**:
- SIT → intent capture  
- SI Baseline → immutable target state  
- RRT → factual readiness  
- MPT → execution planning  
- Proposal / Tenant Manifest → commercialization and continuous compliance  

---

## 3. Primary Functions

### 3.1 Strategic Intent Capture (SIT)

**Function**  
Guide an internal advisor (VFS staff) through **all intent-defining questions** required for CMMC Levels 1–3.

**Behavior**
- Questions are rendered from the **ITS Question Bank (YAML)**  
- Each question includes:
  - Description (what is being asked)
  - Why it is **Intent-Shaping (ITS)**
  - Impact on CMMC attainment
  - Advisor prompts for interpretation  

**Key Constraint**
- SIT answers are **never consumed directly** by downstream systems.

**Output**
- Raw SIT responses (transient only)  
- Input to SI Baseline normalization

---

### 3.2 Strategic Intent Baseline Generation (SI Baseline)

**Function**  
Transform raw SIT responses into a **single, normalized, immutable target state**.

**Behavior**
- Enforces:
  - Required fields
  - Enumerations
  - Cross-field consistency (e.g., level vs assessment route)
- Advisor may review, but **cannot partially accept** the baseline.

**Key Properties**
- Versioned  
- Immutable once accepted  
- Becomes the **sole source of truth**

**Output**
- `SI_Baseline_Output` (schema-validated)

---

### 3.3 Readiness Recon Orchestration (RRT)

**Function**  
Determine **which readiness activities apply**, based strictly on the SI Baseline.

**Behavior**
- FE:
  - Evaluates applicability rules
  - Displays *why* each RRT activity applies
  - Suppresses non-applicable activities  
- Supports factual capture (evidence exists / does not exist)

**Key Constraint**
- RRT logic **cannot reference SIT data**
- It only consumes `si_baseline.*` fields

**Output**
- Readiness Posture snapshot  
- Findings with control references

---

### 3.4 Mission Plan Generation (MPT)

**Function**  
Generate a **complete plan to reach the SI Baseline**, factoring in:
- Current readiness posture  
- Assessor expectations  
- Vendor capabilities  

**Behavior**
- Generates:
  - **Manual Mission Plan**
  - **Executable Mission Plan**
  - Or both, from identical inputs  
- Explains:
  - Why each step exists
  - Which controls are satisfied
  - What evidence will be produced

**Outputs**
- Human-readable mission plan  
- Executable plan (for Enclave Stamper)  
- Tenant Manifest  
- Proposal Package (optional)

---

### 3.5 Proposal & SOW Generation

**Function**  
Convert the mission plan into a **defensible cost proposal and SOW**.

**Behavior**
- Every priced line item:
  - Maps to steps, milestones, and controls  
- FE explains:
  - Why cost exists
  - What risk it mitigates
  - What assessor evidence it enables

**Output**
- Proposal Package (schema-validated)

---

### 3.6 Tenant Manifest Visualization

**Function**  
Present the **normative definition of “RIGHT”** for the enclave.

**Behavior**
- Displays:
  - Required control states
  - Evidence expectations
  - Drift detection rules  
- Viewable by:
  - Engineers
  - Security staff
  - Assessors (read-only)

**Output**
- Tenant Manifest (consumed by monitoring agents)

---

## 4. Authoritative Data Flow

```text
ITS Question Bank
        ↓
CES FE (SIT UI)
        ↓
SI Baseline Output  ←── IMMUTABLE
        ↓
RRT (Readiness Posture)
        ↓
MPT Generator
   ↙        ↓        ↘
Manual     Executable   Proposal
Plan       Plan         Package
        ↓
Tenant Manifest → Continuous Monitoring / Drift
