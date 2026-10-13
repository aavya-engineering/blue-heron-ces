# System and Information Integrity Policy

## 1. Purpose

This policy establishes system and information integrity requirements for **{{org.legal_name}}** in accordance with NIST SP 800-171 Rev 2 (Family 3.14) and CMMC {{si.target_cmmc_level}} requirements.

## 2. Scope

This policy applies to all information systems within the {{si.boundary_strategy}} boundary.

## 3. Roles and Responsibilities

| Role | Name | Responsibility |
|------|------|----------------|
| IT Director | {{personnel.it_director.name}} | Implement integrity controls and patch management |
| ISSO | {{personnel.isso.name}} | Monitor security alerts and advisories |
| System Owner | {{personnel.system_owner.name}} | Authorize system changes for flaw remediation |

## 4. Policy Statements

### 4.1 Flaw Remediation (3.14.1)

- Security flaws shall be identified, reported, and corrected in a timely manner
- Critical vulnerabilities: remediate within **{{default odp.critical_patch_timeline_days "14"}}** days
- High vulnerabilities: remediate within **{{default odp.high_patch_timeline_days "30"}}** days
- Software updates and patches shall be tested before deployment where feasible

### 4.2 Malicious Code Protection (3.14.2)

- Malicious code protection shall be deployed at system entry points and workstations
- Anti-malware signatures shall be updated automatically
- Real-time scanning shall be enabled on all CUI systems
- Users shall not disable malicious code protection

### 4.3 Security Alert Monitoring (3.14.3)

- Security alerts, advisories, and directives shall be monitored from:
  - CISA (Cybersecurity and Infrastructure Security Agency)
  - Vendor security bulletins
  - Internal monitoring systems
{{#if tenant.sentinel_workspace}}
- SIEM alerts: Microsoft Sentinel ({{tenant.sentinel_workspace}})
{{#if tenant.data_connectors.length}}
- Data connectors: {{join tenant.data_connectors ", "}}
{{/if}}
{{/if}}

### 4.4 System Monitoring (3.14.6, 3.14.7)

- Information systems shall be monitored for:
  - Unauthorized access attempts
  - Security-relevant configuration changes
  - Anomalous network traffic patterns
  - Indicators of compromise (IOCs)
- Monitoring activities shall be documented and alerts shall be investigated

### 4.5 Input Validation (3.14.5)

- System inputs shall be validated to prevent injection attacks and malformed data
- Input validation shall be applied at trust boundaries

### 4.6 Spam and Unsolicited Communications (3.14.4)

- Email and messaging systems shall implement spam filtering and malicious content detection
- Phishing protection mechanisms shall be enabled

## 5. Review

This policy shall be reviewed every **{{governance.review_cycle_months}}** months. Next scheduled review: **{{governance.next_review_date}}**.

---

**Effective Date:** {{governance.policy_effective_date}}
**NIST SP 800-171 Controls:** 3.14.1–3.14.7
**Policy Owner:** {{personnel.it_director.name}}
