# Awareness and Training Policy (VFS-POL-012)

**Version:** 1.0
**Effective Date:** {{governance.policy_effective_date}}
**Policy Owner:** {{default personnel.isso.name "Designated Official"}}
**Organization:** {{org.legal_name}}

## 1. Purpose

This policy establishes the security awareness and training requirements for all personnel of **{{org.legal_name}}** who access information systems processing, storing, or transmitting Controlled Unclassified Information (CUI), in accordance with NIST SP 800-171 Rev 2 (Family 3.2) and CMMC {{si.target_cmmc_level}} requirements.

## 2. Scope

This policy applies to all employees, contractors, and third-party personnel with access to CUI systems within the {{si.boundary_strategy}} boundary, including the {{si.deployment_posture}} deployment posture operating in the {{tenant.cloud_environment}} cloud environment.

## 3. Roles and Responsibilities

| Role | Name | Responsibility |
|------|------|----------------|
| ISSO | {{default personnel.isso.name "Designated Official"}} | Develop and maintain training content |
| HR Representative | {{default personnel.hr_representative.name "Designated Official"}} | Track training completion and enforce compliance |
| System Owner | {{default personnel.system_owner.name "Designated Official"}} | Ensure role-based training for system users |
| Compliance Officer | {{default personnel.compliance_officer.name "Designated Official"}} | Audit training program effectiveness |

## 4. Policy Statements

### 4.1 Security Awareness Training (3.2.1)

All personnel shall receive security awareness training:
- Upon initial hire or role assignment
- On an **annual** recurring basis
- When significant changes occur to information systems or policy

Training shall cover at minimum:
- CUI identification and handling procedures
- Phishing and social engineering awareness
- Password management and authentication requirements
- Incident reporting procedures
- Acceptable use of information systems
- Physical security responsibilities

#### Required DoD Course Catalog

The following courses are required for all CUI-access personnel. Courses are self-paced, free of charge, and delivered through government training portals.

| Course | Provider | Frequency | Audience | URL |
|--------|----------|-----------|----------|-----|
{{#each training.baseline_courses}}
| {{this.title}} | {{this.provider}} | {{this.frequency}} | {{this.audience}} | {{this.url}} |
{{/each}}

### 4.2 Role-Based Security Training (3.2.2)

Personnel with significant security responsibilities shall receive specialized training appropriate to their assigned roles:
- System administrators — secure configuration, patch management, log review
- Security personnel — incident response, vulnerability management, audit review
- Managers — risk management, policy enforcement, access authorization
- Developers{{#if si.devops_touches_cui}} (DevOps in scope for CUI){{/if}} — secure coding practices, SAST/DAST tools

#### Administrator-Track Course Requirements

System administrators shall complete the following additional courses annually, or an equivalent from CISA:

| Course | Provider | Frequency | Audience | URL |
|--------|----------|-----------|----------|-----|
{{#each training.admin_courses}}
| {{this.title}} | {{this.provider}} | {{this.frequency}} | {{this.audience}} | {{this.url}} |
{{/each}}

### 4.3 Insider Threat Awareness (3.2.3)

All personnel shall receive training on recognizing and reporting insider threats, including:
- Indicators of potential insider threat behavior
- Reporting mechanisms and points of contact
- Protection of whistleblowers and reporters

All personnel shall be trained on indicators of insider threat as defined in the CDSE INT101.16 curriculum. Training shall emphasize recognition of behavioral and technical indicators and the obligation to report.

Suspected insider threat indicators shall be reported to {{default personnel.ir_lead.name personnel.isso.name}} within 24 hours of observation.

## 5. Training Records

All training completion records shall be maintained for **{{screening.evidence_retention_years}}** years per {{citations.cmmc_evidence_retention}} and made available for assessment purposes.

Training certificates shall be downloaded as PDF and stored in the individual's personnel record. Certificate retention follows the same retention period.

## 5A. Training Frequency and Anchor

Training cycles are anchored to the DoD fiscal year beginning October 1. Annual courses must be completed within each fiscal year cycle. Biennial courses must be completed within each two-year cycle from the date of initial completion.

> Course URLs verified as of {{generated_year}}. Verify current availability at each training cycle.

## 6. Enforcement

Personnel who fail to complete required training within the specified timeframe shall have CUI system access disabled until training is completed and documented. Access suspension and restoration shall be documented in the Personnel card within the compliance tooling.

## 7. Review

This policy shall be reviewed every **{{governance.review_cycle_months}}** months. Next scheduled review: **{{governance.next_review_date}}**.

## Attestation

I, {{default personnel.system_owner.name "Designated Official"}}, as the Authorizing Official, have reviewed and approve this policy.

**Signature:** ___________________________
**Name:** {{default personnel.system_owner.name "Designated Official"}}
**Title:** {{default personnel.system_owner.title "Authorizing Official"}}
**Date:** ___________________________

---

**Effective Date:** {{governance.policy_effective_date}}
**NIST SP 800-171 Controls:** 3.2.1--3.2.3
**CMMC Controls:** 3.2.1, 3.2.2, 3.2.3
**Policy Owner:** {{default personnel.isso.name "Designated Official"}}
**Tooling Reference:** Personnel card Training sub-feature
