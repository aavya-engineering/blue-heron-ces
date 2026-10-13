# Maintenance Policy

## 1. Purpose

This policy establishes system maintenance requirements for **{{org.legal_name}}** in accordance with NIST SP 800-171 Rev 2 (Family 3.7) and CMMC {{si.target_cmmc_level}} requirements.

## 2. Scope

This policy applies to all information systems within the {{si.boundary_strategy}} boundary, including {{si.deployment_posture}} environments.

## 3. Roles and Responsibilities

| Role | Name | Responsibility |
|------|------|----------------|
| IT Director | {{personnel.it_director.name}} | Schedule and oversee maintenance activities |
| ISSO | {{personnel.isso.name}} | Approve maintenance procedures and verify security impact |
| System Owner | {{personnel.system_owner.name}} | Authorize maintenance windows |

## 4. Policy Statements

### 4.1 Controlled Maintenance (3.7.1)

- All maintenance activities shall be scheduled, performed, documented, and reviewed
- Maintenance tools shall be approved and controlled
- Maintenance records shall be retained for audit purposes

### 4.2 Maintenance Tools (3.7.2)

- Only approved maintenance tools shall be used on CUI systems
- Maintenance tools with diagnostic or test capabilities shall be inspected before use
- Media containing diagnostic programs shall be checked for malicious code before use

### 4.3 Nonlocal Maintenance (3.7.5)

- Remote maintenance sessions shall require multi-factor authentication
- Remote maintenance shall be monitored and logged
- Remote maintenance sessions shall be terminated when complete

### 4.4 Maintenance Personnel (3.7.6)

- Maintenance personnel shall be authorized before performing work
- Non-cleared maintenance personnel shall be escorted and supervised
- Maintenance activities by non-organizational personnel shall be documented

### 4.5 Patch Management (3.7.3, 3.7.4)

- Critical security patches shall be applied within **{{default odp.critical_patch_timeline_days "14"}}** days of release
- High-severity patches shall be applied within **{{default odp.high_patch_timeline_days "30"}}** days of release
- All patches shall be tested before deployment to production systems where feasible
- Emergency patches may bypass normal change control with documented justification

## 5. Review

This policy shall be reviewed every **{{governance.review_cycle_months}}** months. Next scheduled review: **{{governance.next_review_date}}**.

---

**Effective Date:** {{governance.policy_effective_date}}
**NIST SP 800-171 Controls:** 3.7.1–3.7.6
**Policy Owner:** {{personnel.it_director.name}}
