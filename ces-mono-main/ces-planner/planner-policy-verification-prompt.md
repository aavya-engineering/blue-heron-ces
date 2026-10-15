# Planner — Verify and Enhance Policy Documents for the Five EO-Tooled Controls

## ⚠️ Preservation Clause

This prompt directs Planner to verify the existing policy document system and policy generation logic for completeness, and enhance only what is missing. It does not replace or rebuild what works.

- **Existing policy documents are authoritative.** If a policy document already exists for a referenced VFS-POL-* identifier, do not regenerate it. Verify its content matches the requirements below; enhance only if gaps exist.
- **Existing policy generation logic is authoritative.** The pipeline that produces VFS-POL-* documents from configuration and data sources already exists. This prompt does not change how policies are generated; it only specifies what content the generated policies must include.
- **Existing template registration patterns are authoritative.** New policies (if any are missing) should register through the same path existing policies use.
- **Existing renderers, storage paths, and SSP integration points are authoritative.** This prompt addresses content requirements only, not infrastructure.

**Workflow expectation:**
1. Planner reads this prompt
2. Planner inspects each named policy in the existing system
3. For each policy, Planner verifies the listed requirements are addressed in the current template/output
4. Where requirements are met → no action; document the verification
5. Where requirements are missing or weak → enhance the template minimally to address the gap; preserve all existing content not in conflict
6. Planner reports back: which policies were verified as already complete, which were enhanced and how, which gaps remain unresolved with proposed remediation

If any requirement appears to conflict with an explicit organizational decision already encoded in a policy, Planner does not silently override the decision — it flags the conflict for human review.

---

## Context

Five CMMC Level 2 controls in the Valor Forge plan have point values (3 or 5) that prevent them from being placed on a POA&M. Each must be MET to attest. Each is being closed operationally through tooling within EO (Personnel card sub-features and the Risk Assessment feature) and is documented through one or more policy artifacts that EO renders into the SSP.

The five controls and their associated policy artifacts:

| Control | Title | Policy Artifact(s) |
|---|---|---|
| AT.L2-3.2.1 | Security awareness training | VFS-POL-012 |
| AT.L2-3.2.2 | Role-appropriate training | VFS-POL-012 (same policy covers both AT controls) |
| PS.L2-3.9.1 | Personnel screening | VFS-POL-009 |
| PS.L2-3.9.2 | Termination/transfer procedures | VFS-POL-010 |
| RA.L2-3.11.1 | Risk assessment | VFS-POL-011, VFS-DOC-001 (annual report) |

For an assessor evaluating these controls, the rendered policy documents establish that the procedure is defined. The operational evidence (collected via EO tooling) establishes that the procedure is executed. Both must be true. This prompt addresses the **policy side** — making sure each rendered document contains the content required to satisfy the assessment objectives.

---

## Common Requirements (all five policies)

Every policy in this set must, at minimum:

- **Identify the organization** by full legal name (e.g., "Valor Forge, LLC")
- **State a version number and effective date**
- **Identify the policy owner** (typically the Authorizing Official or designee)
- **State the policy's purpose** in one or two sentences
- **State the scope** — what people, systems, and data are covered
- **State the review cycle** — how often the policy itself is reviewed (annually is standard)
- **Reference the underlying CMMC control** by ID
- **Reference the methodology, standard, or procedure source** where applicable (NIST publications, NARA registries, etc.)
- **State the consequence of non-compliance** — what happens when the policy is not followed
- **Be signed or attested by the policy owner**

These common elements are likely already in the existing template structure. Planner verifies presence; if any are missing in any policy, enhance the template to ensure they appear in every rendering.

---

## VFS-POL-009 — Personnel Screening Procedure

### Control(s) addressed
- PS.L2-3.9.1 (Screen individuals prior to authorizing CUI access)

### Required policy content

**Purpose statement (must clearly state):**
- That the policy ensures individuals are screened before being authorized to access organizational systems containing CUI

**Scope (must explicitly cover):**
- All personnel, contractors, and service accounts with access to the organization's CUI-handling environments
- The specific CUI-handling environment must be identified (e.g., "M365 GCC High tenant and supporting Azure Government subscription")

**Defined screening criteria — the policy must specify what is evaluated, including at minimum:**
- Identity verification (with acceptable identity document types)
- Citizenship or immigration status verification (with statement that US citizenship is required for ITAR-related CUI access and GCC High admin roles where applicable)
- Verifiable professional history (with acceptable verification methods)
- Direct-knowledge attestation from co-principals OR third-party background investigation (with criteria for each path)
- Self-attestation regarding adverse history (criminal record, OFAC/sanctions, disqualifying findings)
- Signed acknowledgment of CUI handling obligations under 32 CFR Part 2002
- Authorizing Official sign-off as the final authorization gate

**Sequence requirement:**
- Authorization to access CUI-bearing systems is contingent on completion of all defined screening criteria
- AO sign-off occurs only after the prior screening elements are documented

**Authorization gate:**
- Tenant account provisioning and CUI access authorization require documented completion of screening per this procedure

**Documentation requirements:**
- Each screened individual's record contains the seven evidence elements (or formally documents not-applicable status with justification)
- Records are stored in the compliance repository under the personnel-files structure
- Retention period: 6 years (matches CMMC evidence retention per 32 CFR 170.16)

**Review cycle for individuals:**
- Screening reassessed every 5 years
- Earlier reassessment triggered by significant life events (criminal arrest, role change with elevated access, organizational change)

**Small-organization provision:**
- For small organizations where founders are the population being screened, the policy explicitly recognizes founder-level direct-knowledge screening as a valid path, requiring mutual attestations between principals plus identity verification, citizenship documentation, self-attestation, CUI acknowledgment, and AO sign-off
- This provision should not be silently activated; it must be explicitly stated so an assessor can identify the path being followed

**Tooling reference:**
- Policy notes that operational execution is managed within the Personnel card's Screening sub-feature in EO, with embedded templates for each evidence element

### Planner verification action
Read VFS-POL-009. Confirm each requirement above appears in the rendered output. If gaps exist, enhance the template. Preserve all existing content. Report verification result.

---

## VFS-POL-010 — Personnel Termination and Transfer Procedure

### Control(s) addressed
- PS.L2-3.9.2 (Termination/transfer procedures protecting CUI systems)

### Required policy content

**Purpose statement (must clearly state):**
- That the policy ensures organizational systems containing CUI are protected during and after personnel actions including terminations, transfers, and role changes

**Scope (must explicitly cover):**
- All personnel, contractors, and service accounts with access to the organization's CUI-handling environments
- All termination types (voluntary, involuntary), transfer scenarios, and role changes affecting CUI access

**Required immediate actions (within defined SLA — typically 1 business hour of notification):**
- HR/management notification of the termination event to IT/security
- Disable Entra ID account
- Revoke all active sessions
- Remove CA policy scope assignments for CUI access
- Disable any associated service account credentials

**Required near-term actions (within defined SLA — typically 1 business day):**
- Review of CUI access during the employment/engagement period
- Preservation of the user's email and OneDrive content per retention policy
- Trigger data access review for recently-accessed CUI
- License unassignment from the user
- Account marked for deletion per retention schedule (e.g., 30-day soft delete then permanent)

**Property return requirements:**
- Organization-issued hardware (procedure covers future state where hardware exists, even if currently no hardware is issued)
- Credentials (physical tokens, smart cards, certificates)
- Documented chain of custody for returned items

**Transfer-specific provisions:**
- Access review against the new role's required access
- Removal of access no longer needed
- Addition of access required by the new role
- Documented authorization by the new role's manager

**SLA enforcement:**
- The policy defines time-bound expectations for each action
- Operational tooling (offboarding workflow within Personnel card) tracks elapsed time against SLAs
- SLA breaches are documented in the offboarding run record

**Sample execution requirement:**
- The policy notes that procedural sample executions (e.g., deprovisioning a stale credential or service account) count as evidence of executing the procedure when no real personnel termination event has yet occurred

**Tooling reference:**
- Policy notes that operational execution is managed through the Offboarding workflow within the Personnel card in EO
- Each offboarding event produces a procedural overlay artifact correlated with data-plane events from Entra audit logs

### Planner verification action
Read VFS-POL-010. Confirm each requirement above appears. Enhance if gaps exist. Preserve existing content. Report.

---

## VFS-POL-011 — Risk Assessment Procedure

### Control(s) addressed
- RA.L2-3.11.1 (Periodically assess risk to operations, assets, individuals)

### Required policy content

**Purpose statement (must clearly state):**
- That the policy ensures the organization periodically assesses cybersecurity risk arising from operating systems that process, store, or transmit CUI

**Scope (must explicitly cover):**
- The CUI-handling environment (M365 GCC High tenant, Azure Government subscription, supporting components)
- Assets under assessment (tenant configuration, identity infrastructure, CUI data at rest and in transit, supporting Microsoft services)
- Operations under assessment (mission, functions, image, reputation impact)
- Individuals under assessment (impact to personnel from CUI compromise)

**Frequency definition:**
- Annual (12-month) cycle is the standard
- The policy explicitly states the frequency in months
- Earlier assessment is triggered by significant changes (architectural changes, new contracts with different CUI categories, tenant variant changes)

**Methodology declaration:**
- NIST SP 800-30 Revision 1 is the methodology
- Specific NIST appendices used: D (Threat Sources), E (Threat Events), G (Likelihood Scale), H (Impact Scale), I (Composite Risk)
- The policy cites the source publication and the version

**Required assessment activities:**
- Threat identification using NIST SP 800-30 Appendix D and E catalogs
- Vulnerability identification combining technical sources (Defender for Cloud findings, Microsoft Secure Score) and organizational sources (current plan NOT MET items, organizational maturity gaps)
- Risk scoring using NIST SP 800-30 qualitative scales (Very Low / Low / Moderate / High / Very High for both likelihood and impact)
- Composite risk computation per NIST SP 800-30 Appendix I matrix
- Treatment recommendations per identified risk

**Required outputs:**
- A risk register with all threat-vulnerability pairs and their scoring
- An annual Risk Assessment Report (VFS-DOC-001) summarizing the assessment
- AO sign-off on the report

**Continuous-versus-annual model:**
- The risk register is maintained continuously (vulnerabilities ingested from technical sources between annual reviews)
- The annual review is a structured workflow examining the register, re-scoring entries, and producing a signed snapshot
- The signed annual snapshot is the formal assessment artifact for compliance

**Stakeholder roles:**
- Authorizing Official: approves methodology, signs off on annual snapshots
- Compliance officer / IT lead: maintains the register, drives the annual review workflow
- For small organizations, one person may hold all roles

**Tooling reference:**
- Policy notes that operational execution is managed through the Risk Assessment feature in EO
- Continuous vulnerability ingestion from Defender for Cloud, Secure Score, and Plan output occurs automatically
- Annual review workflow is conducted within the feature

### Planner verification action
Read VFS-POL-011. Confirm each requirement above appears. Enhance if gaps exist. Preserve existing content. Report.

---

## VFS-DOC-001 — Risk Assessment Report (Annual Snapshot)

### Note on document type
VFS-DOC-001 is a generated report, not a policy. It is rendered from the Risk Assessment feature's annual snapshot, not authored. Planner verification ensures the rendering template produces the required sections.

### Required document content

**Cover and metadata:**
- Document identifier (VFS-DOC-001) with year (e.g., VFS-DOC-001-2026)
- Effective date (date of annual review completion)
- Organization legal name
- Authorizing Official identification

**Required sections:**

**1. Executive Summary**
- High-level summary of risk picture
- Counts of risks by composite risk level
- Notable changes since prior assessment

**2. Scope and Methodology**
- Scope statement (matches VFS-POL-011 scope)
- NIST SP 800-30 methodology reference
- Appendices used for threat catalog, vulnerability identification, scoring

**3. Threat Identification**
- Threats identified, organized by source type (adversarial, non-adversarial, structural, environmental)
- For each threat: source, threat event description, applicability rationale

**4. Vulnerability Assessment**
- Technical vulnerabilities (from Defender for Cloud, Secure Score)
- Organizational vulnerabilities (from plan NOT MET items, organizational maturity gaps)
- Environmental vulnerabilities (where applicable)

**5. Risk Analysis**
- Threat-vulnerability pairs with assigned likelihood and impact
- Composite risk per pair
- Visual matrix or heatmap presentation

**6. Risk Register**
- Full table of all identified risks with current treatment status
- Sortable by composite risk level

**7. Treatment Recommendations**
- Per risk: mitigate / avoid / transfer / accept
- For mitigate recommendations: linked to specific treatment artifacts (POA&M items, procedures, architectural changes)

**8. Authorizing Official Sign-off**
- Attestation language confirming review of the assessment
- AO signature and date
- Next assessment due date

### Planner verification action
Read the rendering template for VFS-DOC-001. Confirm the eight sections are produced from snapshot data. Enhance template if any section is missing or thin. Report.

---

## VFS-POL-012 — Security Awareness and Training Program

### Control(s) addressed
- AT.L2-3.2.1 (Security awareness training)
- AT.L2-3.2.2 (Role-appropriate training)
- AT.L2-3.2.3 (Insider threat awareness — the 1-point control, also covered by this policy though it can be POA&M'd)

### Required policy content

**Purpose statement (must clearly state):**
- That the policy ensures personnel are made aware of cybersecurity risks and trained to carry out their assigned information-security responsibilities

**Scope (must explicitly cover):**
- All personnel, contractors, and service accounts with access to the organization's CUI-handling environments
- All roles, with role-appropriate training requirements specified

**Required courses with role mapping:**

For all users with CUI access (baseline):
- DoD Cyber Awareness Challenge (annual, satisfies AT.L2-3.2.1)
- DoD Mandatory CUI Training (initial then biennial refresh, supports AT.L2-3.2.1)
- CDSE Insider Threat Awareness (INT101.16) (annual, satisfies AT.L2-3.2.3)

For system administrators (additional to baseline):
- One admin-track course per year (CDSE Cybersecurity Fundamentals, CISA Learning admin-track course, or equivalent — satisfies AT.L2-3.2.2)

**Course catalog:**
- Specific course titles, providers, source URLs, durations
- Refresh cycle per course (e.g., annual for Cyber Awareness, biennial for CUI Training)
- Identified DoD/government sources where the courses are accessed

**Delivery method:**
- Self-paced web courses at the identified DoD/government sites
- No vendor LMS required
- All identified courses are free

**Completion tracking:**
- Each user saves the completion certificate as a PDF
- Certificates filed in the personnel record under the training section
- Tooling (Personnel card Training sub-feature) tracks completion status, refresh due dates, and overdue training

**Frequency:**
- Annual refresh for Cyber Awareness Challenge and Insider Threat Awareness
- Biennial for CUI Training
- The DoD fiscal year (starting Oct 1) is recognized as a natural refresh anchor

**Non-completion consequence:**
- Account access disabled until training completion is verified
- Documented in the Personnel card and enforced through tenant access management

**Insider threat coverage:**
- Specific reference to indicators of insider threat as defined in CDSE INT101.16 curriculum
- Link to organizational reporting procedures for suspected insider threat indicators

**Tooling reference:**
- Policy notes that operational execution is managed through the Training sub-feature within the Personnel card in EO
- Training assignments, completion tracking, and certificate evidence are captured there

### Planner verification action
Read VFS-POL-012. Confirm each requirement above appears. Enhance if gaps exist. Preserve existing content. Report.

---

## Cross-Policy Consistency Requirements

Beyond per-policy requirements, the policy set must be internally consistent:

**Consistent scope language:**
- All five policies reference the same CUI-handling environment description
- If the organization changes scope (e.g., adds Azure compute), all policies update via the rendering pipeline, not separately

**Consistent retention period:**
- All five policies reference 6-year evidence retention per 32 CFR 170.16
- No policy contradicts this with a different retention period

**Consistent role definitions:**
- Authorizing Official is consistently identified by name and role across policies
- IT lead, compliance officer roles consistently named where they appear

**Consistent tooling references:**
- Each policy that references operational tooling cites the correct EO surface (Personnel card sub-features for PS and AT controls; Risk Assessment feature for RA control)
- Tooling references are descriptive, not prescriptive — policies don't lock in implementation details that may evolve

**Consistent CMMC control attribution:**
- Each policy explicitly cites the CMMC control(s) it addresses
- Where a policy addresses multiple controls (e.g., VFS-POL-012 covers AT.L2-3.2.1, 3.2.2, 3.2.3), all are cited

### Planner verification action
After per-policy verification, check cross-policy consistency. Report any inconsistencies and propose remediation.

---

## What Planner Reports Back

After verification and enhancement, Planner reports:

1. **Per-policy verification result** — for each of VFS-POL-009, VFS-POL-010, VFS-POL-011, VFS-POL-012, and the VFS-DOC-001 template:
   - Status: already compliant / enhanced / gaps remaining
   - List of requirements that were already addressed
   - List of requirements that were added or enhanced (with summary of the change)
   - List of requirements that could not be resolved automatically (with proposed remediation)

2. **Cross-policy consistency check result:**
   - Inconsistencies found
   - Resolutions applied or proposed

3. **Configuration changes made:**
   - Any changes to the policy generation configuration (course catalog, threat catalog defaults, scoring tables, scope statements)
   - Diff summary

4. **Files affected:**
   - List of template files changed
   - No existing policy files renamed, deleted, or restructured (per preservation clause)

5. **Outstanding work:**
   - Any requirements that need human input (e.g., AO designation if not yet captured in config)
   - Any conflicts flagged for human review
   - Estimated effort to close outstanding work

---

## What Planner Does Not Do

- **Does not alter how policies are generated.** This prompt is content-focused.
- **Does not introduce new template engines or rendering paths.**
- **Does not silently override existing organizational decisions encoded in policies.** Conflicts get flagged for human review.
- **Does not generate evidence (training certificates, screening records, risk register entries).** Those come from operational execution, not policy generation.
- **Does not delete or rename existing policy files.** Extension by addition only.

---

## Success Criteria

- All five policy templates (VFS-POL-009, VFS-POL-010, VFS-POL-011, VFS-POL-012, plus VFS-DOC-001 rendering) produce documents that contain every requirement listed
- Cross-policy consistency is verified
- Existing policy generation logic is preserved; only template content is enhanced where needed
- Planner produces a clear verification report identifying what was already in place, what was added, and what remains outstanding
- The five rendered policies, when consumed by the SSP generator, satisfy the policy/procedural side of the assessment objectives for the five EO-tooled controls
- An assessor reading the rendered policies sees defined criteria, defined frequencies, defined scope, defined methodologies, defined consequences — the full picture of "the procedure is real and documented"

---

## Relationship to Other Session Artifacts

This prompt complements:
- `stamper-eo-tooled-directive-prompt.md` — Stamper verifies that policies exist and render correctly; this prompt ensures the rendered policies have the right content
- `stamper-five-controls-eo-tooled-evidence-prompt.md` — Stamper evidence files reference these policies as the documented procedure
- `claude-code-prompt-personnel-card.md`, `claude-code-prompt-personnel-screening-extended.md`, `claude-code-prompt-personnel-training-feature.md`, `personnel-card-offboarding-wizard-integration-plan.md` — operational tooling that executes the procedures these policies define
- `claude-code-prompt-risk-assessment-feature.md` — the Risk Assessment feature whose configuration drives VFS-POL-011 and VFS-DOC-001 rendering

After this prompt is acted upon:
- The five must-close controls have a complete and verified policy foundation
- The operational execution (via EO tooling) and the policy documentation (via this verification) together satisfy each control's full assessment objectives
- Planner has a clear record of what was verified, what was enhanced, and what remains for human attention
