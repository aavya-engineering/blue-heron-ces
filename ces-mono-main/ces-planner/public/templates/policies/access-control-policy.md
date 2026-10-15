# Access Control Policy

## 1. Purpose

This Access Control Policy establishes the requirements and procedures for managing access to information systems and data within **{{org.legal_name}}** in accordance with NIST SP 800-171 Rev 2 (Family 3.1) and CMMC {{si.target_cmmc_level}} requirements.

## 2. Scope

This policy applies to all information systems, applications, and data repositories that process, store, or transmit Controlled Unclassified Information (CUI) within the {{si.boundary_strategy}} boundary operated by {{org.legal_name}}.

{{#if si.external_service_providers.length}}
### External Service Providers in Scope
{{#each si.external_service_providers}}
- **{{this.name}}** ({{this.service_type}}) — FedRAMP: {{this.fedramp_posture}}
{{/each}}
{{/if}}

**Estimated in-scope users:** {{si.in_scope_users}}
**Estimated in-scope endpoints:** {{si.in_scope_endpoints}}

## 3. Roles and Responsibilities

| Role | Name | Responsibility |
|------|------|----------------|
| Information System Security Officer | {{personnel.isso.name}} | Enforce access control policies and monitor compliance |
| System Owner | {{personnel.system_owner.name}} | Authorize access to systems and approve access requests |
| IT Director / CTO | {{personnel.it_director.name}} | Maintain technical access control mechanisms |
| Compliance Officer | {{personnel.compliance_officer.name}} | Audit access control effectiveness |

## 4. Policy Statements

### 4.1 Account Management (3.1.1, 3.1.2)

{{org.legal_name}} shall limit information system access to authorized users, processes acting on behalf of authorized users, and devices.

- Access shall be granted based on the principle of least privilege
- All accounts shall be reviewed on a **{{default odp.access_review_frequency "quarterly"}}** basis
- Account lockout shall be enforced after **{{default odp.account_lockout_threshold "3"}}** failed login attempts
- Accounts shall be locked for **{{default odp.account_lockout_duration_minutes "30"}}** minutes after lockout threshold is reached
{{#if tenant.has_tenant}}
- Primary identity management is performed through **{{tenant.identity_provider}}** on the **{{tenant.cloud_environment}}** tenant ({{tenant.primary_domain}})
{{/if}}

### 4.2 Access Enforcement (3.1.3, 3.1.4)

Access to CUI shall be controlled through:
- Role-based access control (RBAC)
- Conditional access policies{{#if tenant.ca_naming}} following the **{{tenant.ca_naming}}** naming convention{{/if}}
- Multi-factor authentication for all users accessing CUI

### 4.3 Separation of Duties (3.1.4)

{{org.legal_name}} shall enforce separation of duties through:
- Distinct administrative and user accounts
- Privileged Identity Management (PIM){{#ifEquals tenant.pim_enabled true}} — **currently enabled**{{/ifEquals}}
- Segregated roles for security administration, system administration, and audit functions

### 4.4 Least Privilege (3.1.5, 3.1.6)

- Users shall be authorized only the minimum access necessary for their job functions
- Privileged accounts shall be limited to designated administrators
- CUI access shall require explicit authorization from the System Owner

### 4.5 Unsuccessful Logon Attempts (3.1.8)

The system shall limit unsuccessful logon attempts to **{{default odp.account_lockout_threshold "3"}}** consecutive attempts within a 15-minute window. After exceeding the threshold, the account shall be locked for **{{default odp.account_lockout_duration_minutes "30"}}** minutes.

### 4.6 Session Management (3.1.10, 3.1.11)

- Session timeout shall be enforced after **{{default odp.session_timeout_minutes "15"}}** minutes of inactivity
- Sessions shall be terminated upon user logoff
- Session locks shall require re-authentication

### 4.7 Remote Access (3.1.12, 3.1.13, 3.1.14)

- All remote access to CUI systems shall be monitored and controlled
- Remote access sessions shall use encrypted connections (TLS 1.2+)
- BYOD posture: **{{si.byod_posture}}**
{{#ifEquals si.byod_posture "not_allowed"}}
- Personal devices are prohibited from accessing CUI
{{/ifEquals}}
{{#ifEquals si.byod_posture "allowed_vdi_only"}}
- Personal devices may access CUI only through Virtual Desktop Infrastructure (VDI)
{{/ifEquals}}

### 4.8 Wireless Access (3.1.16, 3.1.17)

- Wireless access to CUI systems shall be authenticated and encrypted
- Wireless access points shall be monitored for unauthorized connections

### 4.9 Mobile Device Access (3.1.18, 3.1.19)

- Mobile devices accessing CUI shall be enrolled in mobile device management
{{#if tenant.has_tenant}}
- Device enrollment type: **{{tenant.enrollment_type}}**
{{/if}}
- CUI shall be encrypted at rest on all mobile devices

### 4.10 External System Connections (3.1.20, 3.1.21, 3.1.22)

- Connections to external systems shall be authorized by the System Owner
- Publicly accessible information systems shall not contain CUI
- Collaboration mode: **{{si.collaboration_mode}}**

## 5. Enforcement

Violations of this policy may result in disciplinary action, up to and including termination of employment and/or contract.

## 6. Review

This policy shall be reviewed every **{{governance.review_cycle_months}}** months. Next scheduled review: **{{governance.next_review_date}}**.

---

**Effective Date:** {{governance.policy_effective_date}}
**NIST SP 800-171 Controls:** 3.1.1–3.1.22
**Policy Owner:** {{personnel.isso.name}}
