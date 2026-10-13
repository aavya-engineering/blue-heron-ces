# Security Assessment Policy

## 1. Purpose

This policy establishes security assessment and authorization requirements for **{{org.legal_name}}** in accordance with NIST SP 800-171 Rev 2 (Family 3.12) and CMMC {{si.target_cmmc_level}} requirements.

## 2. Scope

This policy applies to all information systems within the {{si.boundary_strategy}} boundary.

## 3. Roles and Responsibilities

| Role | Name | Responsibility |
|------|------|----------------|
| ISSO | {{personnel.isso.name}} | Plan and coordinate security assessments |
| Compliance Officer | {{personnel.compliance_officer.name}} | Verify assessment completeness and track findings |
| System Owner | {{personnel.system_owner.name}} | Authorize corrective actions |

## 4. Policy Statements

### 4.1 Security Control Assessment (3.12.1)

- Security controls shall be assessed periodically to determine effectiveness
- Assessment frequency: at least annually
- Assessment methods: testing, examination, and interview
- Assessment results shall be documented and reported to the System Owner

### 4.2 Plan of Action and Milestones (3.12.2)

{{#ifEquals si.poam_policy "no_poam"}}
{{org.legal_name}} does not maintain POA&Ms. All identified deficiencies shall be remediated within the specified vulnerability remediation timelines.
{{/ifEquals}}
{{#ifEquals si.poam_policy "poam_if_allowed"}}
{{org.legal_name}} shall develop and maintain Plans of Action and Milestones (POA&M) for:
- Findings from security assessments
- Identified vulnerabilities that cannot be immediately remediated
- Deficiencies noted during continuous monitoring

POA&Ms shall include: description, severity, responsible party, estimated completion date, and milestones.
{{/ifEquals}}

### 4.3 Continuous Monitoring (3.12.3)

{{org.legal_name}} shall implement a continuous monitoring strategy that includes:
- Ongoing assessment of security controls
- Automated vulnerability scanning
- Security event monitoring and analysis
- Configuration and patch compliance monitoring
- Evidence posture target: **{{si.evidence_posture}}**

### 4.4 System Security Plan (3.12.4)

- A System Security Plan (SSP) shall be developed and maintained
- The SSP shall describe the system boundary, security controls, and their implementation
- The SSP shall be updated annually or when significant changes occur
- Assessment route: **{{si.assessment_route}}**

## 5. Review

This policy shall be reviewed every **{{governance.review_cycle_months}}** months. Next scheduled review: **{{governance.next_review_date}}**.

---

**Effective Date:** {{governance.policy_effective_date}}
**NIST SP 800-171 Controls:** 3.12.1–3.12.4
**Policy Owner:** {{personnel.compliance_officer.name}}
