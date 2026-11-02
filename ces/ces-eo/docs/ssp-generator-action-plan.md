# SSP Document Generator -- Engineering Action Plan

> **Historical (W4-EO4, 2026-09-27).** The template and signal counts in this document are the plan at the time it was written. Measured today: 111 + 7 templates in use (111 control snippets in `src/eo/data/snippet-templates` plus 7 narrative templates in `src/shared/data/snippet-templates`); the superseded, never-loaded `src/eo/generation/templates` set was deleted (FC-EO-C EO-06, 2026-09-27); 85 of 110 reference controls have an automated (graph) signal (79 from the shared ces-shared registry + 6 from the EO-owned overlay added by FC-EO-D, 2026-09-28). Pinned by `tests/unit/claim-accuracy.test.ts`.

| Field              | Value                                               |
|--------------------|-----------------------------------------------------|
| **Version**        | 2.1                                                 |
| **Date**           | 2026-04-12                                          |
| **Classification** | CUI // SP-SSP // CMMC L2                            |
| **Status**         | APPROVED -- Ready for Implementation                |
| **Owner**          | Evidence Ops Engineering Team                       |
| **Approval**       | EO Project Lead                                     |
| **Review Cycle**   | End of each phase                                   |

---

## 1. Executive Summary

This action plan defines the engineering roadmap for building a complete System
Security Plan (SSP) document generator within Evidence Ops (EO).  The generator
will consume data from three upstream systems -- Planner (policy inputs, CUI
boundary, mission context), Stamper (tenant configuration, runtime variables,
command registries, infrastructure and tenant manifests), and the EO assessment
pipeline (findings, evidence artifacts, SPRS scoring) -- and produce
assessor-ready output artifacts suitable for C3PAO submission under 32 CFR
Part 170 (CMMC 2.0 Level 2).

**Output Artifacts:**

- SSP.docx -- Complete 15-section System Security Plan with CUI classification
  markings, signature page, table of contents, 110 control implementation
  narratives, 14 family overviews, per-control evidence artifact tables with
  SHA-256 hashes, and ODP documentation.
- SSP.pdf -- High-fidelity PDF conversion of the DOCX with classification
  markings preserved.
- ssp-oscal.json -- Machine-readable SSP export per NIST OSCAL 1.1.2
  specification for eMASS interoperability.
- IR-Plan.docx, CM-Plan.docx, ISCM-Plan.docx -- Standalone policy plan
  documents referenced by the SSP.
- POA&M.docx -- Automated Plan of Action and Milestones generated from
  NOT MET assessment findings.
- Boundary diagram (PNG), network topology diagram, data flow diagram --
  Visual artifacts embedded as SSP appendices.
- Evidence package ZIP -- Bundles all artifacts with a manifest listing
  SHA-256 hashes.

**Scope:** Close all 34 gaps identified in `docs/ssp-outline-cmmc-l2.md`,
scale from 3 to 110 snippet templates, implement DOCX/PDF/OSCAL export, and
integrate evidence artifact hashing per 32 CFR 170.17 regulatory requirements.

**Timeline:** 5 phases spanning 17-21 weeks, with decision gates between
phases, velocity tracking, and contingency buffers.

**Success Criteria:** Generate a complete, assessor-ready SSP for a production
GCC High tenant with all 15 sections populated, 110 control narratives, 3
diagrams, 3 policy documents, SHA-256 artifact references, and DOCX/PDF/OSCAL
export -- validated by C3PAO SME review simulation.

---

## 2. Current State Assessment

### 2.1 What Exists Today

The SSP generation pipeline spans three codebases.  The following inventory
is drawn from `docs/context/MODULE_MAP.md` and reflects the state as of
2026-04-12.

#### Evidence Ops (EO) -- `src/eo/`

| Module                          | Location                                    | Status    |
|---------------------------------|---------------------------------------------|-----------|
| `SspGenerator`                  | `src/eo/ssp/SspGenerator.ts`                | Functional -- produces `SystemSecurityPlan` JSON from assessment data |
| `SnippetDataResolver`           | `src/eo/ssp/SnippetDataResolver.ts`         | Functional -- resolves per-control narrative data from manifests |
| `SnippetTemplateEngine`         | `src/eo/generation/SnippetTemplateEngine.ts` | Partial -- Handlebars rendering engine works, but only 3 of 110 templates exist |
| `EvidencePackager`              | `src/eo/packager/`                          | Functional -- builds .zip evidence packages |
| `FindingStore`                  | `src/eo/stores/`                            | Functional -- stores MET/NOT MET/NOT ASSESSED verdicts per control |
| `EvidenceStore`                 | `src/eo/stores/`                            | Functional -- SHA-256 hashes in Azure Blob Storage |
| `ManifestBuilder`               | `src/eo/stores/`                            | Functional -- generates manifest files in Azure Blob |
| `VariableStore`                 | `src/eo/stores/`                            | Functional -- loads Stamper variables.json |
| `RunStore`                      | `src/eo/stores/`                            | Functional -- tracks assessment run metadata |
| `PolicyStore`                   | `src/eo/policies/`                          | Functional -- manages policy document references |

#### Planner (cse-fe-v2)

| Module                          | Location                                         | Status    |
|---------------------------------|--------------------------------------------------|-----------|
| SSP Handlebars Template         | `public/templates/policies/system-security-plan.md` | Functional -- organizational shell with system ID, description, personnel, controls, ODPs |
| `policyContextCompiler`         | `src/features/mpt/services/policyContextCompiler.ts` | Functional -- aggregates PolicyInputs, SI Baseline, TenantConfig, CUI Boundary into template context |
| `policyRenderer`                | `src/features/mpt/services/policyRenderer.ts`    | Functional -- renders Handlebars templates, calculates completeness percentage |
| `policyDocxExporter`            | `src/features/mpt/services/policyDocxExporter.ts` | Functional -- converts rendered Markdown to DOCX with cover page, signatures, revision history |

#### Stamper

| Data Source                     | Location                                            | Status    |
|---------------------------------|-----------------------------------------------------|-----------|
| Tenant configuration            | `plan-data/{slug}/{slug}.json`                      | Canonical -- org identity, tenant ID, domain, infrastructure model |
| Runtime variables               | `plan-data/{slug}/variables.json`                   | 150+ variables -- password, lockout, session, audit parameters |
| Tenant manifest                 | `plan-data/{slug}/plans/tenant-manifest-*.json`     | Per-control verification specifications |
| Infrastructure manifest         | `plan-data/{slug}/plans/infrastructure-manifest-*.json` | Resource inventory with provenance |
| Command registry                | `src/registry/cmmc-l2-commands.registry.json`       | 172 command entries for evidence collection |
| Control reference               | `src/registry/cmmc-l2-controls.reference.json`      | 110 CMMC L2 control definitions |

#### Shared Types (`src/shared/types/ssp.types.ts`)

`SystemSecurityPlan`, `ControlImplementation`, `BoundarySection`,
`ComponentInventory`, `NetworkSection`, `InterconnectionEntry`, `RoleEntry`,
`HostingSection` -- all defined and consumed by `SspGenerator`.

### 2.2 Automation Coverage Baseline

| Status          | Field Count | Percentage |
|-----------------|-------------|------------|
| **Automated**   | 26          | 40%        |
| **Partial**     | 5           | 8%         |
| **Manual**      | 2           | 3%         |
| **Gap**         | 32          | 49%        |
| **Total**       | 65          | 100%       |

**Target:** Raise automation coverage from 40% to 85% or higher by the end of
Phase 5.

### 2.3 Gap Category Summary

| Category                        | Description                                    | Gap Count | Priority    |
|---------------------------------|------------------------------------------------|-----------|-------------|
| A. Missing Snippet Templates    | 107 of 110 control narrative templates missing | 107       | HIGH        |
| B. Missing Diagrams             | Boundary, network, data flow diagrams          | 3+        | HIGH        |
| C. Missing Policy Documents     | IR Plan, CM Plan, ISCM Plan                    | 3+        | MEDIUM-HIGH |
| D. Missing Integrations         | SHA-256 refs, OSCAL, vuln scanning, POA&M      | 4         | HIGH/MEDIUM |

Complete gap-to-work-item traceability is provided in Section 8.

---

## 3. Phased Delivery Plan

### Architecture Data Flow

```
[Stamper] --> tenant config, variables, manifests
    |
    v
[EO Assessment Run] --> FindingStore (verdicts), EvidenceStore (SHA-256 hashes)
    |
    v
[SspContextBuilder] --> aggregates Planner + Stamper + EO data into SspContext
    |
    v
[SspGenerator] --> produces SystemSecurityPlan JSON (existing)
    |
    +----> [SnippetTemplateEngine] --> renders 110 control narratives (3/110 done)
    |
    +----> [DiagramGenerator] --> produces boundary/network/DFD diagrams (new)
    |
    +----> [PolicyDocGenerator] --> produces IR/CM/ISCM plans (new)
    |
    v
[SspDocxExporter] --> Markdown --> DOCX with evidence tables, diagrams, appendices (new)
    |
    v
[PDF Converter] --> DOCX --> signed PDF (new)
    |
    v
[EvidencePackager] --> bundles SSP.docx + diagrams + policies + evidence into .zip
```

### Critical Path

```
Phase 1.1 (DOCX Exporter)
    --> Phase 1.3 (SSP Template)
        --> Phase 2.0 (Data Source Validation, Weeks 5-7)
            --> Phase 2.1-2.6 (Snippet Templates, Weeks 8-13) [CRITICAL PATH BOTTLENECK]
                --> Phase 3.1 (Diagrams)
                    --> Phase 4.1-4.4 (Policy Docs + POA&M)
                        --> Phase 5.1-5.4 (OSCAL + Production)
```

### Parallel Work Streams

- Phase 1.2 (Evidence Artifact Tracking) runs parallel to Phase 1.1
- Phase 1.5 (OSCAL Foundation) runs parallel to Phase 1.1-1.3
- Phase 2.1-2.5 (snippet families) partially parallelizes across engineers
- Phase 3.2-3.3 (manual diagram workflows) runs parallel to Phase 3.1
- Phase 4.1-4.3 (policy document generators) fully parallelizes

---

### Phase 1: Foundation and Decision Gates (Weeks 1-4)

**Objectives:** Port DOCX generation to EO, implement evidence artifact
reference tracking, establish snippet template authoring workflow, create
baseline 15-section SSP structure, validate OSCAL foundation.

#### 1.1 DOCX Library Selection and Exporter Implementation

Create `SspDocxExporter` module in EO using the `docx` npm package.  See
Section 5 for library decision rationale.

**Dependencies:** None

**Tasks:**
- Install `docx` npm package
- Create `src/eo/ssp/SspDocxExporter.ts`
- Implement: `SystemSecurityPlan` JSON to DOCX Buffer conversion
- Implement CUI classification cover page per 32 CFR 2002
- Implement signature page (System Owner, ISSO, Authorizing Official)
- Implement revision history table
- Implement table of contents with auto-generated section links
- Implement classification header/footer on all pages

**Acceptance Criteria:**
- [ ] `SspDocxExporter.export(ssp: SystemSecurityPlan)` returns a valid DOCX Buffer
- [ ] Cover page includes CUI banner, classification, system name, version, date
- [ ] Signature page includes 3 signature blocks with roles and date fields
- [ ] Revision history table renders version, date, author, description columns
- [ ] Table of contents auto-generates from section headers
- [ ] Classification marking appears in header/footer of every page
- [ ] Unit test validates DOCX structure with sample SSP JSON
- [ ] DOCX opens correctly in Microsoft Word and LibreOffice Writer

**Effort:** 6 days

#### 1.2 Evidence Artifact Reference Tracking

Extend `FindingStore` and `ManifestBuilder` to link controls to evidence
artifacts with SHA-256 hashes, as required by 32 CFR 170.17.

**Dependencies:** None

**Tasks:**
- Extend `FindingStore` schema: add `evidenceArtifacts[]` per finding
  (`{ blobPath, sha256Hash, collectionDate, source }`)
- Update `ManifestBuilder` to generate `control-to-artifact-map.json` in
  Azure Blob Storage
- Create `EvidenceArtifactResolver` utility for enriching SSP control
  narratives with artifact tables
- Update `SspGenerator` to call `EvidenceArtifactResolver` and populate
  evidence tables in `ControlImplementation` objects
- Validate SHA-256 hashes match EC-stored evidence hashes

**Acceptance Criteria:**
- [ ] `FindingStore` findings include `evidenceArtifacts` field with SHA-256 hashes
- [ ] `ManifestBuilder` generates `control-to-artifact-map.json` in Azure Blob
- [ ] `SspGenerator` output includes evidence artifact tables for controls with linked artifacts
- [ ] DOCX exporter renders evidence tables: Artifact Name, SHA-256 Hash, Collection Date, Source
- [ ] End-to-end test validates artifact hashes match EC-stored evidence
- [ ] Per-control artifact tables appear in Section 8 of SSP DOCX

**Effort:** 7 days

#### 1.3 Baseline SSP Template (15 Sections)

Create a CMMC 2.0 Level 2 SSP Handlebars template with all 15 sections from
the SSP outline.

**Dependencies:** None

**Tasks:**
- Create `src/shared/templates/ssp-cmmc-l2.md.hbs` Handlebars template
- Implement all 15 sections: System ID, Description, Environment, Boundary,
  CUI Categories, Interconnections, Roles, Controls (110), ODPs, Continuous
  Monitoring, POA&M, IR Summary, CM Summary, Attachments, Document Control
- Define template variables per Appendix A of the SSP outline
- ~~Create `SspContextBuilder` class aggregating data from Planner PolicyInputs,
  Stamper variables/manifests, and EO assessment data~~
  **UPDATE (Phase 2.0):** SspContextBuilder deferred to Phase 3. Phase 2.0 extends
  `SnippetTemplateEngine.buildContext()` with variables parameter for immediate ODP
  access in templates. See ADR-001 in `docs/context/ARCHITECTURE_DECISION_RECORD.md`.
- Integrate template with `SspDocxExporter`
- Implement gap placeholders: `[MANUAL INPUT REQUIRED: <description>]`

**Acceptance Criteria:**
- [ ] Template includes all 15 sections with Handlebars placeholders
- [x] ~~`SspContextBuilder.build()` aggregates data from all upstream sources~~ (Deferred to Phase 3; `buildContext()` extended with variables parameter in Phase 2.0)
- [ ] DOCX export produces 15-section document with table of contents
- [ ] All 26 currently-automated fields populate correctly
- [ ] Gap sections render placeholder text with specific guidance
- [ ] Generated SSP passes basic structure validation

**Effort:** 8 days

#### 1.4 Snippet Template Authoring Workflow

Establish the repeatable workflow for creating snippet templates at scale.

**Dependencies:** None

**Tasks:**
- Document authoring guide in `docs/snippet-template-authoring.md`
- Create template validation script: `npm run validate-snippets`
- Set up test fixtures for all 14 control families in `tests/fixtures/`
- Create scaffolding tool: `npm run scaffold-snippet AC.L2-3.1.1`

**Acceptance Criteria:**
- [ ] Authoring guide documented with 5-step workflow
- [ ] Validation script passes for all 3 existing templates
- [ ] Scaffolding tool generates template files with correct naming
- [ ] Test fixtures exist for all 14 control families
- [ ] Workflow executable by new engineers without additional training

**Effort:** 4 days

#### 1.5 OSCAL Version Selection and Exporter Foundation

Pin OSCAL version and establish exporter architecture.  See Section 6 for
OSCAL specification details.

**Dependencies:** None

**Tasks:**
- Create `src/eo/ssp/OscalExporter.ts` module skeleton
- Download OSCAL 1.1.2 SSP JSON schema to
  `src/shared/schemas/oscal-1.1.2-ssp.json`
- Install `ajv` for schema validation
- Define TypeScript type mapping: EO `SystemSecurityPlan` to OSCAL SSP model
- Implement stub exporter with basic metadata section
- Add schema validation test

**Acceptance Criteria:**
- [ ] OSCAL 1.1.2 SSP JSON schema downloaded and committed
- [ ] `OscalExporter` stub with metadata section exists
- [ ] Schema validation test passes for stub output
- [ ] TypeScript type mapping documented for all OSCAL SSP sections
- [ ] Version pinning documented in `package.json` and README

**Effort:** 3 days

#### GATE 0: Early Proof-of-Concept Validation (Week 1.5)

This gate de-risks Phase 1 investment by validating technical assumptions at
37% completion rather than waiting until 100% (GATE 1).

**Gate Criteria:**
1. DOCX library generates a valid 3-section sample SSP with CUI classification
   markings (cover page, header/footer, one content section)
2. FindingStore schema extension design for `evidenceArtifacts[]` reviewed and
   approved (design doc, not implementation)
3. Snippet template validation script passes for at least 1 existing template

**Gate Decision:**
- **PASS:** Continue Phase 1 work items on current trajectory.
- **FAIL:** Stop and reassess.  If DOCX library blocked, switch to fallback
  immediately (saves 2.5 weeks vs discovering at GATE 1).  If FindingStore
  design flawed, redesign before implementation investment.

---

#### Phase 1 Decision Gate (Week 4)

**GATE 1: Foundation Validation**

This gate determines whether the technical foundation is sound before
committing to the Phase 2 template scale-up.

**Gate Criteria:**
1. DOCX exporter generates a valid, readable 15-section SSP DOCX with
   classification markings
2. Evidence artifact SHA-256 references appear correctly in per-control tables
3. Snippet template validation script passes for 3 existing templates
4. OSCAL exporter stub validates against OSCAL 1.1.2 schema
5. No blocking technical issues discovered with `docx` library

**Gate Deliverable:** Foundation Validation Report documenting DOCX library
suitability, evidence tracking test results, template workflow feasibility,
OSCAL validation results, and GO/NO-GO recommendation.

**Gate Decision:**
- **GO:** Proceed to Phase 2 (snippet template scale-up)
- **NO-GO:** Revise Phase 1 tasks.  If `docx` library unsuitable, fall back to
  Planner's `markdown-it` + `html-docx-js` approach before Phase 2 commitment.

#### Phase 1 Milestones

| Milestone | Week | Deliverable                                              |
|-----------|------|----------------------------------------------------------|
| 1.A       | 1.5  | DOCX exporter functional with sample SSP JSON            |
| GATE 0    | 1.5  | Early proof-of-concept validation (DOCX sample, FindingStore design, 1 template validated) |
| 1.B       | 2.5  | Evidence artifact references integrated into FindingStore |
| 1.C       | 3.5  | Baseline 15-section SSP DOCX with automated fields       |
| 1.D       | 4.0  | GATE 1 foundation validation complete                    |

---

### Phase 2: Data Source Validation and Snippet Templates at Scale (Weeks 5-13)

**Objectives:** Validate and deliver all data sources required for template
authoring, then create 107 missing snippet templates, prioritize by family,
track velocity with buffer weeks, test against real tenant datasets, add
family-level overviews.

See Section 7 for the template velocity plan and contingency strategy.

**CRITICAL PATH ALERT:** This phase is the project bottleneck.  Template
velocity of 4+ templates/day with 2-3 engineers is aggressive.  Buffer week
included.

#### Phase 2.0: Data Source Validation and Schema Extensions (Weeks 5-7)

Templates cannot be authored against missing data sources.  This sub-phase
validates and delivers all upstream schema extensions before template authoring
begins.

##### 2.0.1 Planner Schema Extensions (Weeks 5-6)

Coordinate and validate delivery of the 6 Planner PolicyInputs extensions:
enclave definitions, ISA registry, ESP vendor list, retention policies,
network/DFD diagram paths.  If the Planner team cannot deliver, implement
manual input fallback fields immediately -- do not wait.

##### 2.0.2 Stamper variables.json Extensions (Weeks 5-6)

Coordinate and validate delivery of encryption ODPs:
`encryptionAlgorithmAtRest`, `encryptionAlgorithmInTransit`, `tlsMinVersion`.
If the Stamper team cannot deliver, commit static defaults (AES-256, TLS 1.2)
and document override instructions.

##### 2.0.3 Data Source Integration Testing (Week 7)

End-to-end validation that all data sources needed for template authoring are
available and accessible.  Run `SspContextBuilder` against a real tenant to
confirm all template variables resolve.  Any variable that fails to resolve is
flagged and either fixed or marked for manual input placeholder.

**Acceptance Criteria for Phase 2.0:**
- [ ] All Planner schema extensions delivered OR manual fallback fields implemented
- [ ] All Stamper variables.json extensions delivered OR static defaults committed
- [ ] `SspContextBuilder` successfully resolves all template variables for at least 1 test tenant
- [ ] No template will be authored against a data source that does not exist

---

#### 2.1 Access Control (AC) Family -- 22 Templates

**Dependencies:** Phase 1.4 (authoring workflow), Phase 2.0 (data sources)

**Tasks:** Inventory Stamper variables for AC family (Conditional Access,
role assignments, privileged access, session timeouts).  Draft templates in
4 batches of 5-6.  Test each batch against 2+ real tenant datasets.  Review
narratives for C3PAO testability.

**Acceptance Criteria:** 22 templates in `snippet-templates/ac/`, all pass
validation, narratives reference specific Entra ID configurations, completed
by end of Week 9.

**Effort:** 10 days

#### 2.2 System and Communications Protection (SC) Family -- 16 Templates

**Dependencies:** Phase 1.4, Phase 2.0 (parallel with 2.1)

**Tasks:** Inventory Stamper variables for SC family (encryption, boundary
protection, TLS, DLP, email security).  Draft templates in 3 batches.
Coordinate with Stamper team to add encryption variables to `variables.json`.

**Dependency Alert:** Requires Stamper team to add `encryptionAlgorithmAtRest`,
`encryptionAlgorithmInTransit`, `tlsMinVersion` to variables.json schema.
Validated in Phase 2.0.2.

**Acceptance Criteria:** 16 templates in `snippet-templates/sc/`, encryption
ODPs added to variables.json, validation passes, completed by end of Week 10.

**Effort:** 8 days

#### 2.3 Identification and Authentication (IA) Family -- 11 Templates

**Dependencies:** Phase 1.4, Phase 2.0 (parallel with 2.1, 2.2)

**Tasks:** Inventory Stamper variables for IA family (MFA, password policies,
authenticator management).  Draft templates in 2 batches.  Map to Entra ID
authentication strength policies.

**Acceptance Criteria:** 11 templates in `snippet-templates/ia/`, MFA details
from tenant-manifest, password ODPs from variables.json, completed by
end of Week 10.

**Effort:** 6 days

#### 2.4 Configuration Management (CM), Audit (AU), Media Protection (MP) -- 27 Templates

**Dependencies:** Phase 2.1-2.3

**Tasks:** Author CM (9), AU (9), MP (9) templates.  Reference audit
retention ODPs, Azure data deletion policies, baseline configurations.

**Acceptance Criteria:** 27 templates across `cm/`, `au/`, `mp/`
subdirectories, validation passes, completed by end of Week 11.

**Effort:** 12 days

#### 2.5 Remaining Families (AT, CA, IR, MA, PE, PS, RE, SI) -- 31 Templates

**Dependencies:** Phase 2.4

**Tasks:** Author templates for AT (3), CA (4), IR (3), MA (6), PE (6),
PS (2), RE (3), SI (7).

**Acceptance Criteria:** 31 templates across 8 subdirectories, all 110
templates validated, end-to-end SSP test produces narratives for every
control, completed by end of Week 12.

**Effort:** 13 days

#### 2.6 Family-Level Overview Templates

**Dependencies:** Phase 2.5 (partial parallel)

**Tasks:** Create 14 overview templates (`ac-overview.md.hbs`, etc.).  Each
includes family purpose, platform strategy, key technologies, policy
references.  Integrate into `SspGenerator`.

**Acceptance Criteria:** 14 overviews in `snippet-templates/overviews/`, SSP
DOCX includes family overviews before control narratives.

**Effort:** 3 days

#### Phase 2 Buffer Week (Week 13)

Dedicated rework week if template velocity falls below target.  Tasks include
fixing validation failures, rendering errors, and data source gaps.  Conduct
C3PAO narrative quality review simulation.

#### Phase 2 Milestones

| Milestone | Week | Deliverable                                      |
|-----------|------|--------------------------------------------------|
| 2.0       | 7    | Data source validation complete, all schema extensions delivered or fallbacks committed |
| 2.A       | 9    | AC family complete (22 templates)                |
| 2.B       | 10   | SC and IA families complete (49 cumulative)      |
| 2.C       | 11   | CM, AU, MP families complete (76 cumulative)     |
| 2.D       | 12   | All 110 templates + 14 family overviews          |
| 2.E       | 13   | Buffer week complete, 100% coverage validated    |

---

### Phase 3: Diagrams and Visual Artifacts (Weeks 14-15)

**Objectives:** Generate boundary diagram from infrastructure manifest, define
manual workflows for network topology and data flow diagrams, integrate all
diagrams into SSP DOCX as appendices.

#### 3.1 Boundary Diagram Generator

**Dependencies:** Phase 1.3 (SSP structure)

Implement `DiagramGenerator.generateBoundary(infraManifest)` using Mermaid.js
for text-to-diagram rendering.  Consume infrastructure-manifest resource lists
(entraGroups, exchangeMailboxes, sharePointSites, oneDriveAccounts).  Render
trust zones: M365 GCC High (in-scope), external systems (out-of-scope), user
endpoints.  Save as PNG/SVG, embed in SSP DOCX Attachment C.

**Acceptance Criteria:**
- [ ] Boundary diagram PNG generated from real tenant infrastructure manifest
- [ ] Diagram clearly shows in-scope vs. out-of-scope components
- [ ] Diagram embedded in DOCX Attachment C
- [ ] Diagram legend explains symbols and trust zones

**Effort:** 5 days

#### 3.2 Network Topology Diagram (Manual Workflow)

**Dependencies:** Phase 3.1

Manual workflow due to limited Azure networking usage in pure M365 GCC High
tenants.  Create template in Visio/draw.io format, document workflow in
`docs/diagram-creation-guide.md`, add `networkDiagramPath` to Planner
PolicyInputs, reference in SSP DOCX Attachment A.

**Effort:** 3 days

#### 3.3 Data Flow Diagram (Manual Workflow)

**Dependencies:** Phase 3.2

Create DFD template showing CUI ingress (contract receipt, email), processing
(SharePoint collaboration, Teams), storage (document libraries, mailboxes),
egress (deliverable submission, archival).  Add `dataFlowDiagramPath` to
Planner PolicyInputs.  Reference in SSP DOCX Attachment B.

**Effort:** 3 days

#### Phase 3 Milestones

| Milestone | Week | Deliverable                                        |
|-----------|------|----------------------------------------------------|
| 3.A       | 14   | Boundary diagram automated and embedded in SSP DOCX |
| 3.B       | 15   | Network and DFD manual workflows documented         |

---

### Phase 4: Policy Documents and POA&M (Weeks 16-17)

**Objectives:** Create IR, CM, and ISCM plan document generators, implement
POA&M generator, integrate policy documents into SSP evidence package.

#### 4.1 Incident Response Plan Generator

**Dependencies:** Phase 1.1 (DOCX exporter)

Create `templates/policies/incident-response-plan.md.hbs` with sections:
purpose, scope, CIRT composition, incident categories, detection through
recovery phases, DFARS 252.204-7012 reporting workflow, evidence preservation,
post-incident review.  Add IR plan fields to Planner PolicyInputs.  Implement
`PolicyDocGenerator.generateIrPlan()`.  Generate `IR-Plan.docx`, reference
in SSP Section 12.

**Acceptance Criteria:**
- [ ] IR plan template includes all required sections per NIST SP 800-171 IR family
- [ ] DFARS 7012 reporting checklist included as appendix
- [ ] IR-Plan.docx generated and referenced in SSP DOCX

**Effort:** 4 days

#### 4.2 Configuration Management Plan Generator

**Dependencies:** Phase 1.1 (parallel with 4.1)

Create CM plan template with sections: purpose, scope, baseline definitions,
change control workflow, vulnerability management, patching SLAs, configuration
monitoring.  Implement `PolicyDocGenerator.generateCmPlan()`.  Reference in
SSP Section 13.

**Acceptance Criteria:**
- [ ] CM plan template includes baseline definition and change control workflow
- [ ] Patching SLAs documented by severity (critical: 15d, high: 30d, medium: 90d)
- [ ] CM-Plan.docx generated and referenced in SSP DOCX

**Effort:** 4 days

#### 4.3 ISCM Plan Generator

**Dependencies:** Phase 1.1 (parallel with 4.1, 4.2)

Create ISCM plan template with sections: purpose, assessment frequency,
automated evidence collection, drift detection, vulnerability scanning,
reporting chain, escalation thresholds.  Implement
`PolicyDocGenerator.generateIscmPlan()`.  Reference in SSP Section 10.

**Acceptance Criteria:**
- [ ] ISCM plan documents automated evidence collection via Stamper/EO pipeline
- [ ] Assessment frequencies defined (daily automated, quarterly manual)
- [ ] ISCM-Plan.docx generated and referenced in SSP DOCX

**Effort:** 3 days

#### 4.4 POA&M Generator

**Dependencies:** Phase 1.2 (evidence artifact tracking)

Implement `PoamGenerator` module consuming `FindingStore` NOT MET verdicts.
Extend `FindingStore` schema with remediation fields: `milestoneDate`,
`responsibleParty`, `riskLevel`, `status`.  Create POA&M DOCX template.
Map NOT MET findings to NIST SP 800-171A determination statements via
`src/shared/data/sp-800-171a-objectives.json` lookup table.  Integrate into
`EvidencePackager` pipeline.  Reference in SSP Section 11.

**Acceptance Criteria:**
- [ ] POA&M generator converts NOT MET verdicts into formatted POA&M
- [ ] POA&M includes risk categorization (high/medium/low)
- [ ] Milestone tracking fields populated (manual input required for dates)
- [ ] POA&M.docx generated and bundled in evidence package
- [ ] NIST SP 800-171A lookup table committed

**Effort:** 5 days

#### Phase 4 Milestones

| Milestone | Week | Deliverable                                          |
|-----------|------|------------------------------------------------------|
| 4.A       | 16   | IR, CM, ISCM plan generators functional              |
| 4.B       | 17   | POA&M generator functional and integrated            |

---

### Phase 5: OSCAL Export and Production Readiness (Weeks 18-21)

**Objectives:** Complete OSCAL SSP JSON export, add PDF generation, run
production testing with 3+ tenants, finalize documentation and C3PAO
readiness checklist.

#### 5.1 OSCAL SSP Exporter (Complete Implementation)

**Dependencies:** Phase 1.5 (OSCAL foundation), Phase 2.6 (all templates)

Complete `OscalExporter` module per NIST OSCAL 1.1.2 specification.  Map all
OSCAL SSP sections: `system-characteristics`, `system-implementation`,
`control-implementation`, `metadata`.  Validate against schema using `ajv`.
Add `ssp-oscal.json` to evidence package.

**Acceptance Criteria:**
- [ ] OSCAL JSON validates against NIST OSCAL 1.1.2 SSP schema
- [ ] All 110 controls mapped to `implemented-requirements` with statements
- [ ] Evidence artifacts referenced in OSCAL `links` with SHA-256 hashes
- [ ] OSCAL JSON bundled in evidence package
- [ ] OSCAL version locked at 1.1.2, documented in package.json and README

**Effort:** 7 days

#### 5.2 PDF Generation from DOCX

**Dependencies:** Phase 1.1 (DOCX exporter)

Use LibreOffice CLI (`soffice --headless --convert-to pdf`) for high-fidelity
DOCX-to-PDF conversion.  Implement `PdfConverter.convert(docxBuffer) -->
pdfBuffer`.  Add digital signature placeholder page.  Document LibreOffice
installation requirement.

**Effort:** 4 days

#### 5.3 Production Testing Campaign

**Dependencies:** Phase 5.1, 5.2

Test with 3 real tenant datasets selected by complexity tier:
- **Simple:** <50 users, <10 SharePoint sites, basic Conditional Access
- **Medium:** 50-200 users, 10-50 SharePoint sites, advanced policies
- **Complex:** >200 users, >50 SharePoint sites, custom configurations

Run full assessment pipeline, generate complete SSP packages, conduct C3PAO
review simulation, document and remediate defects, re-test.

**Effort:** 6 days

#### 5.4 Documentation and C3PAO Readiness Checklist

**Dependencies:** Phase 5.3

Create `docs/ssp-generator-user-guide.md`, `docs/c3pao-submission-checklist.md`.
Add CLI commands: `npm run ssp:generate`, `npm run ssp:export-oscal`,
`npm run ssp:export-pdf`.  Update README.

**Effort:** 3 days

#### Phase 5 Milestones

| Milestone | Week | Deliverable                                       |
|-----------|------|---------------------------------------------------|
| 5.A       | 19   | OSCAL export functional and validated             |
| 5.B       | 20   | PDF generation functional and tested              |
| 5.C       | 21   | Production testing complete, docs finalized       |

---

## 4. Inter-Phase Dependency Map

| Work Item   | Depends On        | Can Parallelize With |
|-------------|-------------------|----------------------|
| Phase 1.1   | None              | Phase 1.2, 1.4, 1.5 |
| Phase 1.2   | None              | Phase 1.1, 1.4, 1.5 |
| Phase 1.3   | None              | Phase 1.2, 1.4, 1.5 |
| Phase 1.4   | None              | Phase 1.1, 1.2, 1.3 |
| Phase 1.5   | None              | Phase 1.1, 1.2, 1.3 |
| Phase 2.0   | Phase 1.4         | Phase 1.5            |
| Phase 2.1   | Phase 1.4, 2.0    | Phase 2.2, 2.3       |
| Phase 2.2   | Phase 1.4, 2.0    | Phase 2.1, 2.3       |
| Phase 2.3   | Phase 1.4, 2.0    | Phase 2.1, 2.2       |
| Phase 2.4   | Phase 2.1-2.3     | --                   |
| Phase 2.5   | Phase 2.4         | --                   |
| Phase 2.6   | Phase 2.5         | Phase 2.5 (partial)  |
| Phase 3.1   | Phase 1.3         | Phase 3.2, 3.3       |
| Phase 3.2   | Phase 3.1         | Phase 3.3            |
| Phase 3.3   | Phase 3.2         | --                   |
| Phase 4.1   | Phase 1.1         | Phase 4.2, 4.3       |
| Phase 4.2   | Phase 1.1         | Phase 4.1, 4.3       |
| Phase 4.3   | Phase 1.1         | Phase 4.1, 4.2       |
| Phase 4.4   | Phase 1.2         | Phase 4.1-4.3        |
| Phase 5.1   | Phase 1.5, 2.6    | Phase 5.2            |
| Phase 5.2   | Phase 1.1         | Phase 5.1            |
| Phase 5.3   | Phase 5.1, 5.2    | --                   |
| Phase 5.4   | Phase 5.3         | --                   |

---

## 5. DOCX Library Decision

### Selected Library

**`docx`** by dolanmiu, version 8.5.0 or later.

NPM: `npm install docx`

### Rationale

The `docx` library was selected based on research findings documented in
`docs/context/RESEARCH_SUMMARY.md`.  The evaluation considered three
candidates:

| Library         | Approach              | TypeScript | Ext. Deps | Maintenance | Verdict      |
|-----------------|-----------------------|------------|-----------|-------------|--------------|
| `docx`          | Programmatic from scratch | Native  | None      | Active      | **Selected** |
| `docxtemplater` | Template-based fill   | Via @types | Several   | Active      | Rejected     |
| `officegen`     | Multi-format          | No         | Several   | Unmaintained | Rejected    |

**Key factors favoring `docx`:**
1. Clean TypeScript API with full type safety -- matches EO's TypeScript-first
   codebase (ESM, NodeNext resolution).
2. No external dependencies -- minimizes supply chain risk for a compliance
   toolchain.
3. Ideal for programmatic generation of complex documents with dynamic
   structure -- the SSP structure varies per tenant (different control counts,
   evidence tables, diagram attachments).
4. Full control over document structure: headers, footers, table of contents,
   signature pages, classification markings, nested tables, embedded images.
5. Active maintenance and community support.

**Why not `docxtemplater`:** The SSP is generated from scratch using structured
data, not by filling in a pre-existing Word template.  `docxtemplater` excels
at template-based replacement but adds unnecessary complexity for dynamic
document construction.

### Fallback Plan

If the `docx` library proves unsuitable during Phase 1 implementation (missing
features for classification marking, performance issues with large documents,
or inability to handle embedded PNG diagrams), the fallback is to adopt
Planner's existing approach: `markdown-it` for Markdown-to-HTML rendering plus
`html-docx-js` for HTML-to-DOCX conversion.  This fallback is validated at
GATE 1 (end of Week 4) before committing to Phase 2.

**Fallback rework estimate:** 5-7 additional days if triggered in Phase 1.
If triggered after Phase 2 begins, rework estimate increases to 10-15 days due
to template integration dependencies.  This is why GATE 1 exists as a hard
decision point before Phase 2 commitment.

---

## 6. OSCAL 1.1.2 Export Specification

### Version Decision

| Field            | Value                                                         |
|------------------|---------------------------------------------------------------|
| OSCAL Version    | 1.1.2 (current stable as of 2026-04)                         |
| Schema Source     | https://pages.nist.gov/OSCAL/reference/1.1.2/ssp/json-schema/ |
| Validator        | `ajv` JSON Schema validator with official OSCAL 1.1.2 schema |
| Lock Policy      | Do not upgrade without full regression validation             |

### Rationale

OSCAL 1.1.2 is the most recent stable release with demonstrated compatibility
with DoD eMASS.  OSCAL is mandatory for machine-readable assessment data
exchange per the DoD compliance ecosystem.  Modern compliance platforms export
in Word, Excel, PDF, and OSCAL.  By targeting 1.1.2 specifically, we avoid
breaking changes from pre-release versions while maintaining eMASS
interoperability.

### Type Mapping: EO to OSCAL SSP

| EO Type / Field                | OSCAL 1.1.2 SSP Element                          |
|--------------------------------|---------------------------------------------------|
| `SystemSecurityPlan.metadata`  | `metadata` (title, last-modified, version, oscal-version, parties, responsible-parties) |
| `SystemSecurityPlan.systemInfo` | `system-characteristics` (system-id, system-name, description, security-sensitivity-level) |
| `SystemSecurityPlan.components` | `system-implementation.components[]` + `system-implementation.inventory-items[]` |
| `SystemSecurityPlan.users`     | `system-implementation.users[]`                   |
| `ControlImplementation[]`      | `control-implementation.implemented-requirements[]` (with narrative `statements[]`) |
| `FindingStore` evidence refs   | `control-implementation.implemented-requirements[].links[]` (artifact SHA-256) |
| `RoleEntry[]`                  | `metadata.responsible-parties[]`                  |
| `InterconnectionEntry[]`       | `system-implementation.components[]` (type: "interconnection") |

### Implementation Phases

- **Phase 1.5 (Foundation):** Stub exporter with metadata section only,
  schema validation test.
- **Phase 5.1 (Complete):** All OSCAL SSP sections mapped, 110 controls
  in `implemented-requirements`, evidence artifact links, full schema
  validation.

### Scope Boundaries

- **In scope:** OSCAL SSP model (system-security-plan).
- **Out of scope:** OSCAL Assessment Results model, OSCAL POA&M model,
  SCAP integration.  Deferred to post-MVP roadmap.

---

## 7. Template Velocity Plan

### The Problem

107 snippet templates must be authored to achieve full SSP control narrative
coverage.  This is the critical path bottleneck for the entire project.  Each
template requires understanding the control requirement, identifying relevant
Stamper variables and infrastructure manifest fields, authoring a Handlebars
template with testable narrative statements, and validating against real
tenant data.

### Velocity Targets

| Scenario    | Rate (templates/engineer/day) | Team Size | Daily Output | Duration  |
|-------------|-------------------------------|-----------|--------------|-----------|
| Optimistic  | 4                             | 2-3       | 8-12         | 5 weeks   |
| Realistic   | 2.5                           | 2-3       | 5-7.5        | 6 weeks   |
| Pessimistic | 2                             | 2-3       | 4-6          | 7-8 weeks |

### Family Prioritization

Families are ordered by template count (highest first) to maximize early
progress visibility and identify authoring pattern issues before the long tail.

| Priority | Family | Count | Cumulative | Target Week |
|----------|--------|-------|------------|-------------|
| 1        | AC     | 22    | 22         | Week 9      |
| 2        | SC     | 16    | 38         | Week 10     |
| 3        | IA     | 11    | 49         | Week 10     |
| 4        | CM     | 9     | 58         | Week 11     |
| 5        | AU     | 9     | 67         | Week 11     |
| 6        | MP     | 9     | 76         | Week 11     |
| 7        | SI     | 7     | 83         | Week 12     |
| 8        | MA     | 6     | 89         | Week 12     |
| 9        | PE     | 6     | 95         | Week 12     |
| 10       | CA     | 4     | 99         | Week 12     |
| 11       | AT     | 3     | 102        | Week 12     |
| 12       | IR     | 3     | 105        | Week 12     |
| 13       | RE     | 3     | 108        | Week 12     |
| 14       | PS     | 2     | 110        | Week 12     |

### Velocity Monitoring

- **Daily:** Completed template count reported at standup, blocking issues
  identified.
- **Weekly:** Cumulative count vs. target milestone, velocity trend analysis.
- **Week 13:** Dedicated buffer week for rework if coverage < 100%.

### Contingency Plan

| Trigger                     | Action                                                 |
|-----------------------------|--------------------------------------------------------|
| Velocity < 85% by Week 10  | Increase batch size, reduce per-template review depth  |
| Velocity < 75% by Week 10  | De-scope lowest-priority families (PE, PS, AT) to manual input; focus on AC, SC, IA, CM, AU, MP |
| Velocity < 50% by Week 10  | ESCALATE to project lead for resource allocation or timeline extension |
| Rework rate > 20%          | Pause authoring, review template patterns, update authoring guide |

### De-Scope Fallback

If de-scoping is triggered, affected controls render with structured
manual input placeholders rather than automated narratives:

```
[MANUAL INPUT REQUIRED: PE.L2-3.10.1 Physical Access Authorizations --
Provide narrative describing physical access authorization procedures for
facilities containing CUI systems.  Reference physical access logs, badge
systems, and visitor management procedures.]
```

This preserves SSP structural completeness while deferring narrative
automation to a future sprint.

---

## 8. GAP_WORK_NEEDED Traceability Table

Every gap identified in `docs/ssp-outline-cmmc-l2.md` is mapped to a specific
work item in this plan.  No gap is unaddressed -- each is either resolved by a
plan phase, delegated to an external team with a coordination plan, or
explicitly deferred with rationale.

| Gap ID  | SSP Section | Gap Description                            | Priority    | Resolution        | Work Item Reference        |
|---------|-------------|--------------------------------------------|-------------|-------------------|----------------------------|
| GAP-001 | 2           | System Boundary Diagram                    | HIGH        | Phase 3.1         | Boundary Diagram Generator |
| GAP-002 | 3           | Network Topology Diagram                   | HIGH        | Phase 3.2         | Network Topology (Manual)  |
| GAP-003 | 3           | Network Topology Data (Azure networking)   | MEDIUM      | Deferred          | Out of Scope -- manual workflow |
| GAP-004 | 4           | Enclave Definitions                        | MEDIUM      | External          | Planner CUI Boundary schema extension |
| GAP-005 | 4           | Exclusion List                             | MEDIUM      | External          | Planner PolicyInputs extension |
| GAP-006 | 5           | Data Flow Diagrams                         | HIGH        | Phase 3.3         | Data Flow Diagram (Manual) |
| GAP-007 | 5           | Retention Policies                         | MEDIUM      | External          | Planner PolicyInputs + Stamper commands |
| GAP-008 | 6           | ISA Documents Registry                     | MEDIUM      | External          | Planner PolicyInputs extension |
| GAP-009 | 6           | Third-Party Vendor List                    | MEDIUM      | External          | Planner PolicyInputs extension |
| GAP-010 | 6           | ESP Responsibility Matrices                | MEDIUM      | External          | Planner responsibility matrix template |
| GAP-011 | 7           | Formal Role Definitions                    | LOW         | External          | Planner policy library role template |
| GAP-012 | 7           | Delegation of Authority                    | LOW         | External          | Planner PolicyInputs extension |
| GAP-013 | 7           | Organizational Chart                       | LOW         | External          | Planner org chart generator (manual) |
| GAP-014 | 8           | 107 Missing Snippet Templates              | HIGH        | Phase 2.1-2.5     | All Phase 2 template work items |
| GAP-015 | 8           | Family-Level Overviews                     | HIGH        | Phase 2.6         | Family overview templates  |
| GAP-016 | 8           | Evidence Artifact Refs with SHA-256        | HIGH        | Phase 1.2         | Evidence Artifact Reference Tracking |
| GAP-017 | 9           | Encryption Algorithm ODPs                  | MEDIUM      | External          | Stamper variables.json extension (Phase 2.2 dep) |
| GAP-018 | 9           | ODP-to-Control Mapping Table               | MEDIUM      | Phase 2.2         | ODP registry (`odp-registry.json`) |
| GAP-019 | 10          | Formal ISCM Plan Document                  | MEDIUM-HIGH | Phase 4.3         | ISCM Plan Generator        |
| GAP-020 | 10          | SCAP/OSCAL Export                          | HIGH        | Phase 5.1         | OSCAL SSP Exporter (SCAP deferred) |
| GAP-021 | 11          | Formal POA&M Generator                     | HIGH        | Phase 4.4         | POA&M Generator            |
| GAP-022 | 11          | Weakness Categorization (SP 800-171A)      | HIGH        | Phase 4.4         | SP 800-171A lookup table   |
| GAP-023 | 11          | Milestone Tracking                         | MEDIUM      | Phase 4.4         | FindingStore schema extension |
| GAP-024 | 12          | Standalone IR Plan Document                | MEDIUM-HIGH | Phase 4.1         | IR Plan Generator          |
| GAP-025 | 12          | DFARS 7012 Reporting Workflow              | MEDIUM-HIGH | Phase 4.1         | IR Plan template appendix  |
| GAP-026 | 13          | CM Plan Document                           | MEDIUM-HIGH | Phase 4.2         | CM Plan Generator          |
| GAP-027 | 13          | Approved Baselines                         | MEDIUM      | External          | Stamper baseline configuration profiles |
| GAP-028 | 13          | Change Control Workflow                    | MEDIUM      | External          | Planner CM plan template   |
| GAP-029 | 13          | Vulnerability Scan Data Integration        | MEDIUM      | Deferred          | Out of Scope -- future roadmap |
| GAP-030 | 14          | Diagrams (Network, DFD, Boundary)          | HIGH        | Phase 3.1-3.3     | All Phase 3 work items     |
| GAP-031 | 14          | Policy Plans (IR, CM, ISCM)               | MEDIUM-HIGH | Phase 4.1-4.3     | All Phase 4 policy work items |
| GAP-032 | 15          | Version Control Workflow                   | LOW         | External          | Planner SSP lifecycle workflow |
| GAP-033 | 15          | Signature Authority Matrix                 | LOW         | Phase 1.1         | DOCX signature page template |
| GAP-034 | 15          | Distribution List Tracking                 | LOW         | External          | Planner PolicyInputs extension |

### Gap Coverage Summary

| Resolution Category     | Count | Percentage |
|-------------------------|-------|------------|
| Addressed in Plan       | 20    | 59%        |
| External Coordination   | 12    | 35%        |
| Deferred to Future      | 2     | 6%         |
| **Total**               | **34**| **100%**   |

---

## 9. Assessor-Ready Acceptance Criteria

An SSP generated by this toolchain is considered **assessor-ready** when it
satisfies every criterion below.  These criteria are concrete, measurable, and
verifiable by automated test or manual inspection.

### 9.1 Document Completeness

| Criterion                                                    | Verification Method     |
|--------------------------------------------------------------|-------------------------|
| All 15 sections present with no `[MANUAL INPUT REQUIRED]` placeholders | Automated: regex scan of rendered DOCX content |
| All 110 control narratives populated from snippet templates  | Automated: template validation script |
| All 14 family overview paragraphs present                    | Automated: section header count validation |
| 3 required diagrams included as appendices (boundary, network, DFD) | Automated: attachment count in DOCX structure |
| 3 policy documents included (IR Plan, CM Plan, ISCM Plan)   | Automated: file presence check in evidence package ZIP |
| POA&M document present if any findings are NOT MET           | Automated: conditional file presence check |

### 9.2 Regulatory Compliance

| Criterion                                                    | Verification Method     |
|--------------------------------------------------------------|-------------------------|
| CUI classification marking on cover page and all headers/footers per 32 CFR 2002 | Manual: visual inspection of DOCX |
| Signature page includes System Owner, ISSO, Authorizing Official blocks | Automated: DOCX structure validation |
| Revision history table populated                             | Automated: table row count > 0 |
| Per-control evidence artifact tables include SHA-256 hashes per 32 CFR 170.17 | Automated: hash format regex validation |
| All ODPs documented in Section 9 with values from variables.json | Automated: ODP registry cross-reference |
| ISA documents referenced for external service providers (Section 6) | Manual: content review |

### 9.3 Narrative Quality (C3PAO Testability)

| Criterion                                                    | Verification Method     |
|--------------------------------------------------------------|-------------------------|
| Narratives reference specific configurations (not vague statements) | Manual: C3PAO SME review simulation |
| Narratives map to NIST SP 800-171A assessment objectives (320 statements) | Automated: objective ID cross-reference |
| Narratives cite evidence artifacts by name                   | Automated: artifact reference count per control |
| No placeholder text, lorem ipsum, or template rendering errors | Automated: regex scan for known placeholder patterns |
| Responsible party assigned for each control (Section 7 roles) | Automated: field presence validation |

### 9.4 Technical Accuracy

| Criterion                                                    | Verification Method     |
|--------------------------------------------------------------|-------------------------|
| DOCX opens without errors in Microsoft Word and LibreOffice Writer | Manual: open test on both platforms |
| PDF renders correctly with no formatting issues              | Manual: visual inspection |
| OSCAL JSON validates against NIST OSCAL 1.1.2 SSP schema    | Automated: `ajv` schema validation |
| Table of contents auto-generates correctly                   | Manual: DOCX field update test |
| All cross-references resolve correctly                       | Manual: spot-check of "see Section N" references |

### 9.5 Package Completeness

| Artifact                  | Required | Validation                    |
|---------------------------|----------|-------------------------------|
| SSP.docx                  | Yes      | File present, valid DOCX      |
| SSP.pdf                   | Yes      | File present, valid PDF       |
| ssp-oscal.json            | Yes      | File present, schema-valid    |
| boundary-diagram.png      | Yes      | File present, non-zero bytes  |
| network-diagram.png       | Yes      | File present, non-zero bytes  |
| dfd-diagram.png           | Yes      | File present, non-zero bytes  |
| IR-Plan.docx              | Yes      | File present, valid DOCX      |
| CM-Plan.docx              | Yes      | File present, valid DOCX      |
| ISCM-Plan.docx            | Yes      | File present, valid DOCX      |
| POA&M.docx                | Conditional | Present when NOT MET findings exist |
| package-manifest.json     | Yes      | File present, SHA-256 hashes for all artifacts |

### Definition of Assessor-Ready

An assessor-ready SSP can be submitted to a C3PAO for CMMC Level 2 assessment
without requiring additional document preparation.  The C3PAO can begin
assessment activities (document review, configuration testing, personnel
interviews) immediately upon receipt.

---

## 10. External Dependency Coordination Plan

### 10.1 Planner Team Coordination

**Required Schema Extensions:**

| Extension                          | SSP Section | Needed By |
|------------------------------------|-------------|-----------|
| Enclave definitions in CUI Boundary | Section 4  | Phase 2   |
| ISA registry in PolicyInputs       | Section 6  | Phase 2   |
| ESP vendor list in PolicyInputs    | Section 6  | Phase 2   |
| Retention policy fields            | Section 5  | Phase 2   |
| `networkDiagramPath` field         | Section 3  | Phase 3   |
| `dataFlowDiagramPath` field        | Section 5  | Phase 3   |

**Coordination Timeline:**
- **Week 0:** Share schema extension requirements document with Planner team.
- **Week 2:** Validate Planner team commitment and delivery timeline.
- **Week 4 (GATE 1):** Confirm Planner delivery alignment with Phase 2.0.
- **Week 5-6 (Phase 2.0.1):** Validate delivery or implement manual fallbacks.

**Fallback:** If the Planner team cannot deliver by Week 6, implement
manual input fallback fields immediately during Phase 2.0.1.  Manual
input fields degrade the automation coverage metric but do not block SSP
generation or template authoring.

### 10.2 Stamper Team Coordination

**Required variables.json Extensions:**

| Extension                    | Parent Control(s) | Needed By |
|------------------------------|-------------------|-----------|
| `encryptionAlgorithmAtRest`  | SC.L2-3.13.11    | Phase 2.2 |
| `encryptionAlgorithmInTransit` | SC.L2-3.13.8   | Phase 2.2 |
| `tlsMinVersion`              | SC.L2-3.13.8     | Phase 2.2 |

**Coordination Timeline:**
- **Week 0:** Share variables.json extension requirements with Stamper team.
- **Week 5-6 (Phase 2.0.2):** Validate Stamper team delivery or commit static defaults.

**Fallback:** If the Stamper team cannot deliver encryption variables by
Week 6, commit static default values (AES-256 for at-rest, TLS 1.2
for in-transit) during Phase 2.0.2 and document override instructions in the
authoring guide.  This is acceptable because encryption algorithms in GCC High
are platform-level configurations with well-known defaults.

### 10.3 C3PAO SME Review Coordination

**Required SME Involvement:**

| Activity                              | Phase     | Duration  |
|---------------------------------------|-----------|-----------|
| Narrative quality review (templates)  | Phase 2   | 2-3 days  |
| Assessor-ready SSP review simulation  | Phase 5.3 | 3-5 days  |

**Coordination Timeline:**
- **Week 0:** Contract C3PAO or CMMC compliance consultant for review services.
- **Week 4:** Schedule Phase 2 narrative review engagement.
- **Week 17:** Schedule Phase 5.3 production readiness review.

**Fallback:** If C3PAO SME is unavailable, use internal security team for
preliminary review.  Document all assumptions for later C3PAO validation.  This
increases risk of rework in Phase 5.3 but does not block progress.

**SME Credential Requirements (per gap analysis):** The Phase 5.3 reviewer
should hold C3PAO assessor credentials or CMMC-AB certification.  If only
internal security staff are available, document this as a known limitation in
the Foundation Validation Report and schedule formal C3PAO review as a
post-delivery activity.

---

## 11. Risk Register

| ID    | Risk Description                                         | Impact | Prob.  | Phase    | Mitigation                                                             |
|-------|----------------------------------------------------------|--------|--------|----------|------------------------------------------------------------------------|
| R-001 | Snippet template authoring bottleneck (107 templates)    | High   | High   | Phase 2  | Parallelize across 2-3 engineers; prioritize high-count families; buffer week at Week 13; de-scope low-priority families to manual input in MVP |
| R-002 | DOCX library unsuitable (feature gaps, performance)      | Medium | Low    | Phase 1  | GATE 1 validation at Week 4; fallback to `markdown-it` + `html-docx-js`; rework 5-7d in Phase 1, 10-15d if after Phase 2 start |
| R-003 | OSCAL schema complexity exceeds estimate                 | Medium | Medium | Phase 5  | Start OSCAL research in Phase 1.5; use NIST reference implementations; pin to OSCAL 1.1.2; scope limited to SSP model only |
| R-004 | Diagram generation quality insufficient for C3PAO        | Medium | Medium | Phase 3  | Start with manual workflow for network/DFD; iterate on automated generation later; boundary diagram validated in Phase 3.1 |
| R-005 | Planner schema coordination delays                       | Medium | Medium | Phase 2  | Define schema changes at Week 0; validate commitment at Week 2; fallback to manual input fields |
| R-006 | Stamper variables.json coordination delays               | Low    | Low    | Phase 2.2 | Coordinate at Week 0; validate at Week 5; fallback to static defaults (AES-256, TLS 1.2) |
| R-007 | C3PAO narrative quality standards unclear                | High   | Medium | Phase 2, 5 | Engage SME in Phase 2; define concrete assessor-ready criteria (Section 9); simulate C3PAO review before production testing |
| R-008 | Template velocity < 75% by Week 10                       | High   | Medium | Phase 2  | Daily velocity tracking; de-scope PE, PS, AT families; escalate for resource allocation if < 50% |
| R-009 | LibreOffice installation requirement for PDF             | Low    | Low    | Phase 5.2 | Document install procedure in deployment guide; validate in CI/CD pipeline |
| R-010 | GATE 1 fallback rework cascades into Phase 2             | High   | Low    | Phase 1-2 | GATE 1 is a hard decision point; do not begin Phase 2 until GATE 1 passes; re-estimate Phase 2 timeline if fallback triggered |

---

## 12. Resource Requirements

### Engineering Team

| Role                    | Count | Responsibilities                                                |
|-------------------------|-------|-----------------------------------------------------------------|
| Lead Engineer           | 1     | Architecture, OSCAL integration, production readiness, risk management, GATE 1 validation |
| Template Engineers      | 2-3   | Snippet template authoring (107 templates), family coordination, velocity tracking |
| Integration Engineer    | 1     | DOCX/PDF export, diagram generation, evidence artifact tracking |
| QA Engineer             | 1     | Testing, C3PAO review simulation, validation scripts            |

### External Dependencies

| Team / Role        | Deliverable                           | Timeline       |
|--------------------|---------------------------------------|----------------|
| Planner Team       | Schema extensions (6 fields)          | Week 0-6       |
| Stamper Team       | variables.json extensions (3 fields)  | Week 0-6       |
| C3PAO SME          | Narrative quality review              | Phase 2        |
| C3PAO SME          | Assessor-ready SSP review simulation  | Phase 5.3      |

---

## 13. Out of Scope

### Explicitly Deferred to Future Roadmap

1. **Automated network topology generation** from Azure networking resources --
   Phase 3.2 uses manual workflow due to limited Azure networking in pure
   M365 GCC High tenants.
2. **Vulnerability scanner integration** (Tenable, Qualys, Microsoft Defender
   Vulnerability Management) -- Gap Category D item deferred to post-MVP.
3. **Change management workflow automation** -- CM plan documents change control
   procedures but does not automate ITSM integration.
4. **OSCAL Assessment Results export** -- Phase 5.1 covers SSP model only;
   Assessment Results and POA&M OSCAL models deferred.
5. **Digital signature automation** -- PDF includes signature placeholder page
   but the signing workflow is manual.

### Not Addressed in This Plan

1. **FedRAMP SSP generation** -- This plan targets CMMC 2.0 Level 2 only.
2. **NIST SP 800-171 Rev 3 migration** -- CMMC 2.0 Level 2 uses Rev 2; Rev 3
   ODPs are not in scope.
3. **Multi-tenant batch SSP generation** -- Single-tenant workflow only; batch
   operations are a future enhancement.

---

## 14. Success Metrics

### Quantitative

| Metric                          | Baseline | Target  |
|---------------------------------|----------|---------|
| SSP section automation coverage | 40%      | >= 85%  |
| Snippet template coverage       | 3/110    | 110/110 |
| Diagram coverage                | 0/3      | 3/3     |
| Policy document coverage        | 0/3      | 3/3     |
| Evidence artifact linkage       | 0%       | 100% of controls with assessment evidence |
| OSCAL schema compliance         | N/A      | 100% (OSCAL 1.1.2) |
| Production tenant validation    | 0        | 3 tenants, zero blocking defects |

### Qualitative

- C3PAO SME confirms SSP narratives are testable and meet 32 CFR 170.17.
- Control implementation statements reference specific configurations rather
  than vague compliance assertions.
- SSP includes all required elements per NIST SP 800-171 Rev 2 and
  32 CFR Part 170.

---

## 15. Plan Acceptance Criteria

This action plan is considered fully executed when all of the following are
satisfied:

- [ ] DOCX Export: Generate assessor-ready SSP in DOCX format with cover page,
      classification marking, table of contents, 15 sections, signature page,
      revision history
- [ ] PDF Export: Convert DOCX to PDF with classification markings preserved
- [ ] OSCAL Export: Generate NIST OSCAL 1.1.2 SSP JSON validated against
      official schema
- [ ] Control Narratives: All 110 controls include automated implementation
      narratives from snippet templates
- [ ] Evidence Artifacts: All controls with assessment evidence include
      per-control tables with SHA-256 hashes
- [ ] Diagrams: SSP includes 3 required diagrams as appendices
- [ ] Policy Documents: SSP package includes IR Plan, CM Plan, ISCM Plan
- [ ] POA&M: NOT MET findings auto-generate POA&M document
- [ ] Family Overviews: All 14 control families include overview paragraphs
- [ ] ODP Documentation: All ODPs documented with values from variables.json
- [ ] Production Testing: 3 production tenants generate complete SSP packages
- [ ] C3PAO Review: SME confirms SSPs are submission-ready
- [ ] Documentation: User guide, C3PAO checklist, CLI commands documented

---

## 16. Next Steps

### Week 0 (Pre-Kickoff)

- [ ] Stakeholder review of this plan (EO, Planner, Stamper teams)
- [ ] Resource allocation: 1 lead + 2-3 template engineers + 1 integration
      + 1 QA
- [ ] Contract C3PAO SME for narrative review and production testing
- [ ] Share Planner schema extension requirements with Planner team
- [ ] Share Stamper variables.json extension requirements with Stamper team
- [ ] Approve plan and commit to timeline

### Week 1 (Kickoff)

- [ ] Sprint planning for Phase 1
- [ ] Begin Phase 1.1 (DOCX Library and Exporter)
- [ ] Begin Phase 1.2 (Evidence Artifact Tracking) in parallel
- [ ] Begin Phase 1.5 (OSCAL Foundation) in parallel

### Week 1.5 (GATE 0)

- [ ] GATE 0 proof-of-concept validation: DOCX 3-section sample, FindingStore
      schema design review, snippet validation script passes for 1 template
- [ ] PASS/FAIL decision -- if FAIL, switch to fallback immediately

### Week 4 (GATE 1)

- [ ] Foundation Validation Report
- [ ] GO/NO-GO decision for Phase 2

---

*End of SSP Document Generator Engineering Action Plan*

**Document Control:**
- **Version:** 2.1
- **Date:** 2026-04-12
- **Author:** Evidence Ops Architecture Team
- **Revision Notes:** Incorporates GAP_ANALYSIS.md findings -- decision gates,
  DOCX library decision, OSCAL version pinning, template velocity tracking,
  GAP_WORK_NEEDED traceability, assessor-ready criteria, external dependency
  coordination, risk register
- v2.1: Applied CRITIQUE.md findings -- added GATE 0 proof-of-concept
  validation at Week 1.5, reordered Phase 2 to prioritize data source
  validation (Weeks 5-7) before template authoring (Weeks 8-13), cascaded
  downstream phase timelines
- **Review Cycle:** Update at end of each phase
- **Approval Authority:** EO Project Lead
