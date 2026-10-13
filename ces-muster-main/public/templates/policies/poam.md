# Plan of Action and Milestones (POA&M)

## 1. Document Information

| Field | Value |
|-------|-------|
| **Organization** | {{org.legal_name}} |
| **System Name** | {{org.legal_name}} CUI Information System |
| **CMMC Level** | {{si.target_cmmc_level}} |
| **Prepared By** | {{personnel.isso.name}} |
| **Date Prepared** | {{generated_on}} |
| **POA&M Policy** | {{si.poam_policy}} |

## 2. Purpose

{{#ifEquals si.poam_policy "no_poam"}}
> **Note:** {{org.legal_name}} has elected a no-POA&M posture. All identified deficiencies shall be remediated within the specified timelines. This document serves as a tracking mechanism only and does not constitute acceptance of risk for open items.
{{/ifEquals}}
{{#ifEquals si.poam_policy "poam_if_allowed"}}
This Plan of Action and Milestones (POA&M) documents known security deficiencies and the planned remediation actions for **{{org.legal_name}}**. Each item includes a description, severity, responsible party, and target completion date.
{{/ifEquals}}

## 3. POA&M Summary

{{#if posture.has_posture}}
Based on the current Readiness Posture assessment:

| Category | Count |
|----------|-------|
| Controls Met | {{posture.met}} |
| Controls Partially Met | {{posture.partial}} |
| Controls Not Met | {{posture.not_met}} |
| Controls Unknown | {{posture.unknown}} |
| **Overall Compliance** | **{{posture.compliance_pct}}%** |

Items requiring POA&M tracking: **{{posture.not_met}}** not-met + **{{posture.partial}}** partial = potential POA&M entries.
{{else}}
> Readiness Posture assessment has not yet been completed. POA&M items will be populated after assessment.
{{/if}}

## 4. POA&M Items

> POA&M items are auto-populated from the Readiness Posture gap analysis. Each entry below corresponds to a control requirement that has not been fully met.

| # | Weakness | Severity | Responsible | Target Date | Status |
|---|----------|----------|-------------|-------------|--------|
| 1 | [Populated from gap analysis] | — | {{personnel.isso.name}} | — | Open |

*Detailed POA&M entries are generated as part of the Mission Plan gap analysis and appended to the exported document.*

## 5. Milestones

For each POA&M item, milestones shall include:
1. **Identification** — Document the deficiency and root cause
2. **Planning** — Define remediation approach and resource requirements
3. **Implementation** — Execute the remediation action
4. **Verification** — Validate the control is effectively implemented
5. **Closure** — Update POA&M status and retain evidence

## 6. Review Schedule

- POA&M shall be reviewed on a **{{default odp.access_review_frequency "quarterly"}}** basis
- Updates shall be documented with date, author, and changes made
- Overdue items shall be escalated to the System Owner ({{personnel.system_owner.name}})

## 7. Responsible Officials

| Role | Name | Responsibility |
|------|------|----------------|
| ISSO | {{personnel.isso.name}} | Maintain POA&M and track remediation |
| System Owner | {{personnel.system_owner.name}} | Accept risk for delayed items |
| Compliance Officer | {{personnel.compliance_officer.name}} | Verify closure evidence |

---

**Effective Date:** {{governance.policy_effective_date}}
**Next Review:** {{governance.next_review_date}}
