# Continuous Monitoring Plan

## 1. Document Information

| Field | Value |
|-------|-------|
| **Organization** | {{org.legal_name}} |
| **CMMC Level** | {{si.target_cmmc_level}} |
| **Effective Date** | {{governance.policy_effective_date}} |
| **Prepared By** | {{#if personnel.isso.name}}{{personnel.isso.name}}{{else}}Not supplied by the organisation (content gap): the Information System Security Officer (PI.PER.001).{{/if}} |
| **Authorizing Official** | {{#if personnel.authorizing_official.name}}{{personnel.authorizing_official.name}}{{#if personnel.authorizing_official.title}}, {{personnel.authorizing_official.title}}{{/if}}{{else}}Not supplied by the organisation (content gap): the Authorizing Official (PI.PER.009).{{/if}} |

## 2. Purpose

This plan establishes how **{{org.legal_name}}** monitors the security controls of the systems that process, store, or transmit CUI on an ongoing basis, so that their continued effectiveness is known between assessments, in accordance with NIST SP 800-171 Rev 2 requirement 3.12.3 and CMMC {{si.target_cmmc_level}} requirements.

## 3. Scope

This plan applies to all information systems within the {{si.boundary_strategy}} boundary, including {{si.deployment_posture}} environments{{#if tenant.has_tenant}} hosted on the **{{tenant.cloud_environment}}** tenant ({{tenant.primary_domain}}){{/if}}.

## 4. Roles and Responsibilities

| Role | Name | Responsibility |
|------|------|----------------|
| Authorizing Official | {{#if personnel.authorizing_official.name}}{{personnel.authorizing_official.name}}{{else}}Not supplied by the organisation (content gap): the Authorizing Official (PI.PER.009).{{/if}} | Receives monitoring results and decides on continued operation and risk acceptance |
| ISSO | {{#if personnel.isso.name}}{{personnel.isso.name}}{{else}}Not supplied by the organisation (content gap): the Information System Security Officer (PI.PER.001).{{/if}} | Runs this plan, reviews results, and reports to the Authorizing Official |
| Network Administrator | {{#if personnel.network_administrator.name}}{{personnel.network_administrator.name}}{{else}}Not supplied by the organisation (content gap): the Network Administrator (PI.PER.011).{{/if}} | Operates network and boundary monitoring and remediates findings |
| Incident Response Lead | {{#if personnel.ir_lead.name}}{{personnel.ir_lead.name}}{{else}}Not supplied by the organisation (content gap): the Incident Response Lead (PI.PER.006).{{/if}} | Handles monitoring alerts that become security incidents |

## 5. Monitoring Activities

| Activity | Frequency | NIST SP 800-171 |
|----------|-----------|-----------------|
| Review of audit log alerts and security events | Continuous (automated), with a documented weekly review | 3.3.1, 3.3.5 |
| Vulnerability scanning of in-scope systems | {{odp.vuln_scan_frequency}} | 3.11.2 |
| Remediation of critical vulnerabilities | Within {{odp.critical_patch_timeline_days}} days | 3.11.3, 3.14.1 |
| Remediation of high vulnerabilities | Within {{odp.high_patch_timeline_days}} days | 3.11.3, 3.14.1 |
| Review of user accounts and access rights | {{odp.access_review_frequency}} | 3.1.1 |
| Review of baseline configurations against the configuration management policy | At each approved change and at least annually | 3.4.1, 3.4.2 |
| Review of the system security plan and the plan of action and milestones | At least every {{governance.review_cycle_months}} months | 3.12.2, 3.12.4 |
| Assessment of the security controls | At least every {{governance.review_cycle_months}} months | 3.12.1 |

Audit records are retained for **{{odp.audit_log_retention_days}}** days.

## 6. Monitoring Tools and Data Sources

{{#if tenant.sentinel_workspace}}
- Security information and event management (SIEM): Microsoft Sentinel ({{tenant.sentinel_workspace}})
{{else}}
- Security information and event management (SIEM): the organisation's central log collection and alerting capability
{{/if}}
{{#each tenant.data_connectors}}
- Data source: {{this}}
{{/each}}
- Endpoint detection and response alerts from managed endpoints
- Vulnerability scan results
- Identity sign-in and audit logs

## 7. Reporting and Response

- The ISSO summarises monitoring results for the Authorizing Official at least monthly, and at once for a significant change in risk
- A suspected security incident is handled under the Incident Response Plan; reportable incidents are reported within **{{odp.incident_reporting_hours}}** hours
- A control found not operating as intended is recorded on the plan of action and milestones with an owner and a due date, or accepted by the Authorizing Official as a documented risk

## 8. Review

This plan shall be reviewed every **{{governance.review_cycle_months}}** months. Next scheduled review: **{{governance.next_review_date}}**.

---

**Effective Date:** {{governance.policy_effective_date}}
**NIST SP 800-171 Controls:** 3.12.3 (with 3.3.1, 3.3.5, 3.11.2, 3.11.3, 3.12.1, 3.12.2, 3.12.4, 3.14.1)
{{#if personnel.isso.name}}
**Plan Owner:** {{personnel.isso.name}}
{{/if}}
