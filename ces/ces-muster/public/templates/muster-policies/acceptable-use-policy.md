# Acceptable Use Policy

## 1. Purpose

This policy sets the rules of behavior for everyone who uses information systems operated by **{{org.legal_name}}**, so that CUI is handled only as authorized, in accordance with NIST SP 800-171 Rev 2 and CMMC {{si.target_cmmc_level}} requirements.

## 2. Scope

This policy applies to all employees, contractors, and other users with access to systems within the {{si.boundary_strategy}} boundary, including {{si.deployment_posture}} environments{{#if tenant.has_tenant}} on the **{{tenant.cloud_environment}}** tenant ({{tenant.primary_domain}}){{/if}}. Each user acknowledges this policy before access is granted and again after each revision.

## 3. Roles and Responsibilities

| Role | Name | Responsibility |
|------|------|----------------|
| ISSO | {{#if personnel.isso.name}}{{personnel.isso.name}}{{else}}Not supplied by the organisation (content gap): the Information System Security Officer (PI.PER.001).{{/if}} | Maintains this policy and handles reported violations |
| HR Representative | {{#if personnel.hr_representative.name}}{{personnel.hr_representative.name}}{{else}}Not supplied by the organisation (content gap): the HR representative (PI.PER.005).{{/if}} | Collects and retains signed acknowledgements; applies sanctions |
| Privacy Officer | {{#if personnel.privacy_officer.name}}{{personnel.privacy_officer.name}}{{else}}Not supplied by the organisation (content gap): the Privacy Officer (PI.PER.010).{{/if}} | Advises on personal information and monitoring notices |

## 4. Rules of Behavior

### 4.1 Authorized Use (3.1.1, 3.1.2)

- Use organizational systems only for authorized business purposes and only with your own account
- Access only the CUI your role requires; never share credentials or multifactor tokens
- Lock or sign out of a session when leaving it; sessions lock automatically after **{{odp.session_timeout_minutes}}** minutes of inactivity

### 4.2 Handling CUI (3.1.3, 3.1.22, 3.8.1)

{{#if si.cui_types.length}}
- CUI handled under this policy includes: {{join si.cui_types ", "}}
{{/if}}
{{#ifEquals si.collaboration_mode "teams_first"}}
- Store and share CUI only in the approved Teams and SharePoint locations inside the CUI boundary
{{else}}
- Store and share CUI only in the approved locations inside the CUI boundary
{{/ifEquals}}
- Do not forward CUI to personal accounts or post it to public or unapproved services
- Mark and label CUI as the organisation's CUI procedures require

### 4.3 Devices and Media (3.1.18, 3.1.19, 3.8.7, 3.8.8)

{{#ifEquals si.byod_posture "not_allowed"}}
- Personally owned devices shall not be used to access CUI or in-scope systems
{{else}}
- Personally owned devices may access in-scope systems only as the organisation's device policy permits
{{/ifEquals}}
- Use only organization-issued, managed devices for CUI work
- Do not connect unapproved removable media to in-scope systems

### 4.4 Prohibited Activities (3.4.9, 3.13.1)

- Installing unapproved software, browser extensions, or remote-access tools
- Disabling or bypassing security tools, logging, or encryption
- Attempting to access systems, data, or accounts beyond your authorization

### 4.5 Monitoring and Reporting (3.1.9, 3.6.1)

- Use of organizational systems is monitored; users have no expectation of privacy on them, as the system use notification states
- Report a suspected security incident, a lost device, or a policy violation to the ISSO at once; reportable incidents are reported externally within **{{odp.incident_reporting_hours}}** hours

## 5. Acknowledgement and Training

Users complete security awareness training **{{odp.training_frequency}}** and acknowledge this policy before first access. Violations may lead to loss of access and disciplinary action.

## 6. Review

This policy shall be reviewed every **{{governance.review_cycle_months}}** months. Next scheduled review: **{{governance.next_review_date}}**.

---

**Effective Date:** {{governance.policy_effective_date}}
**NIST SP 800-171 Controls:** 3.1.1, 3.1.2, 3.1.3, 3.1.9, 3.1.18, 3.1.19, 3.1.22, 3.4.9, 3.6.1, 3.8.1, 3.8.7, 3.8.8, 3.13.1
{{#if personnel.isso.name}}
**Policy Owner:** {{personnel.isso.name}}
{{/if}}
