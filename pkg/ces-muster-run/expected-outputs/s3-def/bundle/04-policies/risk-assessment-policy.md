# Risk Assessment Policy (EDC-POL-011)

**SIMULATED CUSTOMER (FICTIONAL): Corvelline Defense Assemblies Inc. (FICTIONAL)** This organisation is a simulated customer of the CES simulator, deficient by design. Its name, people, identifiers, addresses and tenant are invented; this document describes no real company and is not a compliance record.

**Version:** 1.0
**Effective Date:** 2026-11-01
**Policy Owner:** Belmira Pennanmore
**Organization:** Corvelline Defense Assemblies Inc. (FICTIONAL)

## 1. Purpose

This policy establishes risk assessment requirements for **Corvelline Defense Assemblies Inc. (FICTIONAL)** in accordance with NIST SP 800-171 Rev 2 (Family 3.11) and CMMC L2 requirements.

## 2. Scope

This policy applies to all information systems, assets, operations, and individuals within the single_enclave boundary that process, store, or transmit CUI, including the cloud_only deployment posture operating in the gcc_high cloud environment.

## 3. Roles and Responsibilities

| Role | Name | Responsibility |
|------|------|----------------|
| ISSO | Belmira Pennanmore | Conduct and coordinate risk assessments |
| System Owner (AO) | Derwyn Arrowbrook | Accept or mitigate identified risks |
| Compliance Officer | Designated Official | Verify risk assessment completeness |

## 4. Policy Statements

### 4.1 Risk Assessment (3.11.1)

Corvelline Defense Assemblies Inc. (FICTIONAL) shall periodically assess the risk to organizational operations, assets, and individuals resulting from the operation of information systems and the processing, storage, or transmission of CUI.

#### Methodology

Risk assessments shall be conducted in accordance with **NIST SP 800-30 Revision 1** (Rev 1 (September 2012)). The following NIST SP 800-30 appendices shall be used:

- Appendix D (Threat Sources)
- Appendix E (Threat Events)
- Appendix G (Likelihood Scale)
- Appendix H (Impact Scale)
- Appendix I (Composite Risk Matrix)

#### Frequency

Risk assessments shall be conducted on an annual 12-month cycle, with the assessment period anchored to the policy effective date. Additionally, risk assessments shall be triggered by any of the following events:

- Architectural changes to the CUI boundary
- New contracts with different CUI categories
- Tenant variant changes (e.g., GCC High to IL5)
- Significant security incidents affecting CUI
- Material changes in threat landscape

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
- Annual risk assessment report (EDC-DOC-001) summarizing findings and recommendations
- Authorizing Official sign-off accepting or directing treatment for each identified risk

#### Continuous-Versus-Annual Model

While formal risk assessments are conducted annually, the organization maintains continuous risk awareness through:
- Ongoing vulnerability scanning (per Section 4.2)
- Security incident analysis and trend monitoring
- Threat intelligence monitoring applicable to the CUI environment
- Readiness posture changes identified through the compliance tooling

Material risk changes identified through continuous monitoring shall trigger an event-driven risk assessment per the trigger events listed above.

#### Stakeholder Roles

- **Authorizing Official (Derwyn Arrowbrook):** Reviews and accepts residual risk; signs off on risk treatment decisions
- **Compliance Officer / IT Lead (Designated Official):** Coordinates assessment activities, maintains the risk register, and ensures assessment completeness
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
- Vulnerabilities that cannot be remediated within timelines may be tracked via Plan of Action and Milestones (POA&M)

### 4A. Record Retention

All risk assessment records, including risk registers, assessment reports, vulnerability scan results, and treatment decisions, shall be retained for **6** years per 6 years per 32 CFR 170.16.

## 5. Review

This policy shall be reviewed every **12** months. Next scheduled review: **2027-11-01**.

## 6. Enforcement / Consequence of Non-Compliance

Failure to conduct required risk assessments within the specified timeframes or to address identified risks in accordance with this policy may result in disciplinary action. The Authorizing Official shall be notified of any non-compliance, and CUI system operations may be suspended until a current risk assessment is completed.

## Attestation

I, Derwyn Arrowbrook, as the Authorizing Official, have reviewed and approve this policy.

**Signature:** ___________________________
**Name:** Derwyn Arrowbrook
**Title:** President
**Date:** ___________________________

---

**Effective Date:** 2026-11-01
**NIST SP 800-171 Controls:** 3.11.1--3.11.3
**CMMC Controls:** 3.11.1, 3.11.2, 3.11.3
**Policy Owner:** Belmira Pennanmore
**Tooling Reference:** Risk Assessment feature in EO
