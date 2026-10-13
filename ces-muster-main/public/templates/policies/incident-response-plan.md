# Incident Response Plan (IRP)

## 1. Document Information

| Field | Value |
|-------|-------|
| **Organization** | {{org.legal_name}} |
| **Address** | {{org.address_full}} |
| **CMMC Level** | {{si.target_cmmc_level}} |
| **Effective Date** | {{governance.policy_effective_date}} |
| **Prepared By** | {{personnel.ir_lead.name}} |
| **Approved By** | {{personnel.system_owner.name}} |

## 2. Purpose

This Incident Response Plan establishes the procedures for detecting, responding to, containing, eradicating, and recovering from security incidents affecting CUI systems operated by **{{org.legal_name}}**.

## 3. Scope

This plan applies to all security incidents affecting information systems within the {{si.boundary_strategy}} boundary that process, store, or transmit CUI. This includes {{si.deployment_posture}} environments{{#if tenant.has_tenant}} hosted on the **{{tenant.cloud_environment}}** tenant ({{tenant.primary_domain}}){{/if}}.

## 4. Incident Response Team

| Role | Name | Contact | Responsibility |
|------|------|---------|----------------|
| IR Lead | {{personnel.ir_lead.name}} | {{personnel.ir_lead.email}} | Overall incident coordination |
| ISSO | {{personnel.isso.name}} | {{personnel.isso.email}} | Security assessment and containment |
| IT Director | {{personnel.it_director.name}} | {{personnel.it_director.email}} | Technical response and recovery |
| System Owner | {{personnel.system_owner.name}} | {{personnel.system_owner.email}} | Authorization for response actions |
| Legal/Contracts | {{personnel.legal_representative.name}} | {{personnel.legal_representative.email}} | Legal and notification obligations |
| HR Representative | {{personnel.hr_representative.name}} | {{personnel.hr_representative.email}} | Personnel-related incidents |

## 5. Incident Classification

| Severity | Description | Response Time | Notification |
|----------|-------------|---------------|-------------|
| **Critical** | Active CUI compromise, data exfiltration, ransomware | Immediate | IR Lead + System Owner + Legal within 30 min |
| **High** | Potential CUI exposure, unauthorized access to CUI system | Within {{default odp.incident_reporting_hours "1"}} hour(s) | IR Lead + ISSO |
| **Medium** | Policy violation, suspicious activity, malware detection | Within 4 hours | ISSO |
| **Low** | Minor security event, no CUI impact | Within 24 hours | ISSO (documented) |

## 6. Incident Response Phases

### 6.1 Preparation

- Maintain incident response tools and forensic capabilities
- Conduct annual incident response training for IR team members
- Maintain contact lists for IR team, management, and external parties
- Ensure logging and monitoring are operational on all CUI systems
{{#if tenant.sentinel_workspace}}
- Primary SIEM: Microsoft Sentinel ({{tenant.sentinel_workspace}})
{{/if}}

### 6.2 Detection and Analysis

**Detection sources:**
- Security Information and Event Management (SIEM) alerts
- Endpoint detection and response (EDR) alerts
- User reports of suspicious activity
- Vulnerability scan results
- External threat intelligence feeds

**Analysis procedures:**
1. Verify the incident is genuine (not a false positive)
2. Determine the scope and severity using the classification above
3. Identify affected systems, data, and users
4. Determine whether CUI has been compromised
5. Document initial findings in the incident tracking system

### 6.3 Containment

**Short-term containment:**
- Isolate affected systems from the network
- Disable compromised user accounts
- Block malicious IP addresses or domains
- Preserve volatile evidence (memory dumps, network captures)

**Long-term containment:**
- Apply temporary mitigations (patches, configuration changes)
- Enhance monitoring on potentially affected systems
- Implement additional access controls as needed

### 6.4 Eradication

- Remove malware and unauthorized access mechanisms
- Patch exploited vulnerabilities
- Reset compromised credentials
- Verify eradication through scanning and monitoring

### 6.5 Recovery

- Restore systems from known-good backups
- Verify system integrity before returning to production
- Monitor recovered systems for signs of continued compromise
- Gradually return systems to normal operations
- Backup frequency: **{{default odp.backup_frequency "Daily"}}**

### 6.6 Post-Incident Activity

- Conduct lessons-learned review within 5 business days
- Document the complete incident timeline
- Identify root cause and contributing factors
- Update the IRP based on lessons learned
- Update detection rules and monitoring based on findings
- Retain incident documentation for a minimum of **{{default odp.audit_log_retention_days "365"}}** days

## 7. External Reporting Requirements

### 7.1 DoD Reporting

For incidents involving CUI under DoD contracts:
- Report to DIBNet within 72 hours of discovery
- Preserve and protect images of affected systems for 90 days
- Provide support to DoD damage assessment activities

### 7.2 Law Enforcement

Contact law enforcement when criminal activity is suspected, with guidance from the Legal representative ({{personnel.legal_representative.name}}).

## 8. Communication Plan

| Audience | Method | Timing | Responsible |
|----------|--------|--------|-------------|
| IR Team | Phone/Teams | Immediate | IR Lead |
| Management | Email + Briefing | Within 2 hours | IR Lead |
| Legal/Contracts | Phone | Within 4 hours | IR Lead |
| Affected Users | Email | After containment | HR Rep |
| External (DoD) | DIBNet | Within 72 hours | ISSO |
| Law Enforcement | Phone | As appropriate | Legal |

## 9. Plan Testing

- This plan shall be tested at least annually through tabletop exercises
- Full-scale exercises should be conducted when significant changes to the environment occur
- Test results shall be documented and used to improve the plan

## 10. Plan Maintenance

- This plan shall be reviewed every **{{governance.review_cycle_months}}** months
- Updates required when: personnel changes, system changes, lessons learned, regulatory changes
- Next scheduled review: **{{governance.next_review_date}}**

---

**Effective Date:** {{governance.policy_effective_date}}
**NIST SP 800-171 Controls:** 3.6.1–3.6.3
**Plan Owner:** {{personnel.ir_lead.name}}
