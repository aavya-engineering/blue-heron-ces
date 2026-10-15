# Physical Protection Policy

## 1. Purpose

This policy establishes physical protection requirements for **{{org.legal_name}}** in accordance with NIST SP 800-171 Rev 2 (Family 3.10) and CMMC {{si.target_cmmc_level}} requirements.

## 2. Scope

This policy applies to all physical facilities housing information systems that process, store, or transmit CUI.

{{#if physical_security.has_physical}}
### Facility Locations
{{#each physical_security.facility_addresses}}
- {{this}}
{{/each}}
{{/if}}

## 3. Roles and Responsibilities

| Role | Name | Responsibility |
|------|------|----------------|
{{#if personnel.facilities_manager}}
| Facilities Manager | {{personnel.facilities_manager.name}} | Manage physical security controls |
{{/if}}
| ISSO | {{personnel.isso.name}} | Define physical security requirements |
| System Owner | {{personnel.system_owner.name}} | Authorize physical access |

## 4. Policy Statements

### 4.1 Physical Access Authorization (3.10.1)

- Physical access to CUI processing areas shall be limited to authorized personnel
- Access authorization lists shall be maintained and reviewed periodically
- Visitors shall be escorted in CUI processing areas at all times

### 4.2 Physical Access Control (3.10.2, 3.10.3, 3.10.4)

{{#if physical_security.access_control_system}}
- Access control system: **{{physical_security.access_control_system}}**
{{/if}}
- Multi-layer physical controls shall protect CUI processing areas
- Physical access logs shall be maintained and reviewed
- Physical access devices (keys, badges, cards) shall be inventoried and controlled

### 4.3 Visitor Management (3.10.3)

{{#if physical_security.visitor_management}}
- Visitor management: **{{physical_security.visitor_management}}**
{{/if}}
- All visitors shall be identified and authenticated before entry
- Visitors shall be escorted at all times in controlled areas
- Visitor access logs shall be maintained for a minimum of 1 year

### 4.4 Physical Access Monitoring (3.10.2)

- Physical access to CUI areas shall be monitored using intrusion detection and/or video surveillance
- Monitoring records shall be retained for audit purposes
- Anomalous physical access shall be investigated

### 4.5 Alternate Work Sites (3.10.6)

- Remote work locations accessing CUI shall meet minimum physical security requirements
- CUI shall not be processed on systems visible to unauthorized persons
- CUI printouts at remote locations shall be secured or destroyed when not in use

### 4.6 Equipment Protection (3.10.5)

- Equipment containing CUI shall be physically protected against environmental hazards
- Power and cabling shall be protected from interception or damage

## 5. Review

This policy shall be reviewed every **{{governance.review_cycle_months}}** months. Next scheduled review: **{{governance.next_review_date}}**.

---

**Effective Date:** {{governance.policy_effective_date}}
**NIST SP 800-171 Controls:** 3.10.1–3.10.6
**Policy Owner:** {{personnel.isso.name}}
