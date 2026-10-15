# Risk Assessment Policy (VFS-POL-011)

**Version:** 1.0
**Effective Date:** {{governance.policy_effective_date}}
**Policy Owner:** {{default personnel.isso.name "Designated Official"}}
**Organization:** {{org.legal_name}}

## 1. Purpose

This policy establishes risk assessment requirements for **{{org.legal_name}}** in accordance with NIST SP 800-171 Rev 2 (Family 3.11) and CMMC {{si.target_cmmc_level}} requirements.

## 2. Scope

This policy applies to all information systems, assets, operations, and individuals within the {{si.boundary_strategy}} boundary that process, store, or transmit CUI, including the {{si.deployment_posture}} deployment posture operating in the {{tenant.cloud_environment}} cloud environment.

## 3. Roles and Responsibilities

| Role | Name | Responsibility |
|------|------|----------------|
| ISSO | {{default personnel.isso.name "Designated Official"}} | Conduct and coordinate risk assessments |
| System Owner (AO) | {{default personnel.system_owner.name "Designated Official"}} | Accept or mitigate identified risks |
| Compliance Officer | {{default personnel.compliance_officer.name "Designated Official"}} | Verify risk assessment completeness |

## 4. Policy Statements

### 4.1 Risk Assessment (3.11.1)

{{org.legal_name}} shall periodically assess the risk to organizational operations, assets, and individuals resulting from the operation of information systems and the processing, storage, or transmission of CUI.

#### Methodology

Risk assessments shall be conducted in accordance with **{{risk_assessment.methodology}}** ({{risk_assessment.methodology_version}}). The following NIST SP 800-30 appendices shall be used:

{{#each risk_assessment.appendices_used}}
- Appendix {{this}}
{{/each}}

#### Frequency

Risk assessments shall be conducted on an annual 12-month cycle, with the assessment period anchored to the policy effective date. Additionally, risk assessments shall be triggered by any of the following events:

{{#each risk_assessment.trigger_events}}
- {{this}}
{{/each}}

#### Required Assessment Activities

Each risk assessment shall include the following activities:
- Threat identification using NIST SP 800-30 Appendix D threat source taxonomy
- Vulnerability identification through technical scanning and organizational posture review
- Risk scoring using likelihood and impact scales (Appendices G and H)
- Composite risk computation using the risk matrix (Appendix I)
- Treatment recommendations for each identified risk

#### Required Outputs

Each risk assessment shall produce the following outputs:
- Risk register documenting all identified risks with likelihood, impact, and composite risk ratings
- Annual risk assessment report (VFS-DOC-001) summarizing findings and recommendations
- Authorizing Official sign-off accepting or directing treatment for each identified risk

#### Continuous-Versus-Annual Model

While formal risk assessments are conducted annually, the organization maintains continuous risk awareness through:
- Ongoing vulnerability scanning (per Section 4.2)
- Security incident analysis and trend monitoring
- Threat intelligence monitoring applicable to the CUI environment
- Readiness posture changes identified through the compliance tooling

Material risk changes identified through continuous monitoring shall trigger an event-driven risk assessment per the trigger events listed above.

#### Stakeholder Roles

- **Authorizing Official ({{default personnel.system_owner.name "Designated Official"}}):** Reviews and accepts residual risk; signs off on risk treatment decisions
- **Compliance Officer / IT Lead ({{default personnel.compliance_officer.name "Designated Official"}}):** Coordinates assessment activities, maintains the risk register, and ensures assessment completeness
- **Small-Organization Provision:** In organizations where a single individual serves multiple roles, the Authorizing Official may serve as both risk assessor and risk acceptor, provided that the dual-role is documented and the assessment methodology is followed consistently

Risk assessments shall:
- Identify threats and vulnerabilities applicable to CUI systems
- Assess the likelihood and impact of potential security incidents
- Document risk determinations and recommended mitigations
- Be conducted at least annually and when significant changes occur

### 4.2 Vulnerability Scanning (3.11.2)

- Vulnerability scans shall be performed on a **monthly** basis
- Scans shall cover all in-scope systems, applications, and network devices
- Identified vulnerabilities shall be remediated based on severity:
  - Critical: within **14** days
  - High: within **30** days
  - Medium: within 90 days
  - Low: tracked and addressed during maintenance windows

### 4.3 Vulnerability Remediation (3.11.3)

- Vulnerabilities shall be remediated in accordance with organizational timelines
- Remediation activities shall be tracked to completion
- Risk acceptance decisions for unmitigated vulnerabilities shall be documented and approved by the System Owner
{{#ifEquals si.poam_policy "no_poam"}}
- POA&Ms are not used; all vulnerabilities must be remediated within the specified timelines
{{/ifEquals}}
{{#ifEquals si.poam_policy "poam_if_allowed"}}
- Vulnerabilities that cannot be remediated within timelines may be tracked via Plan of Action and Milestones (POA&M)
{{/ifEquals}}

### 4A. Record Retention

All risk assessment records, including risk registers, assessment reports, vulnerability scan results, and treatment decisions, shall be retained for **{{screening.evidence_retention_years}}** years per {{citations.cmmc_evidence_retention}}.

## 5. Review

This policy shall be reviewed every **{{governance.review_cycle_months}}** months. Next scheduled review: **{{governance.next_review_date}}**.

## 6. Enforcement / Consequence of Non-Compliance

Failure to conduct required risk assessments within the specified timeframes or to address identified risks in accordance with this policy may result in disciplinary action. The Authorizing Official shall be notified of any non-compliance, and CUI system operations may be suspended until a current risk assessment is completed.

## Attestation

I, {{default personnel.system_owner.name "Designated Official"}}, as the Authorizing Official, have reviewed and approve this policy.

**Signature:** ___________________________
**Name:** {{default personnel.system_owner.name "Designated Official"}}
**Title:** {{default personnel.system_owner.title "Authorizing Official"}}
**Date:** ___________________________

---

**Effective Date:** {{governance.policy_effective_date}}
**NIST SP 800-171 Controls:** 3.11.1--3.11.3
**CMMC Controls:** 3.11.1, 3.11.2, 3.11.3
**Policy Owner:** {{default personnel.isso.name "Designated Official"}}
**Tooling Reference:** Risk Assessment feature in EO
