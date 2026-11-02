# Maintenance Policy

## 1. Purpose

This policy establishes system maintenance requirements for **Sim tenant muster-partial** in accordance with NIST SP 800-171 Rev 2 (Family 3.7) and CMMC L2 requirements.

## 2. Scope

This policy applies to all information systems within the unknown boundary, including cloud_only environments.

## 3. Roles and Responsibilities

| Role | Name | Responsibility |
|------|------|----------------|
| IT Director |  | Schedule and oversee maintenance activities |
| ISSO |  | Approve maintenance procedures and verify security impact |
| System Owner |  | Authorize maintenance windows |

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

- Critical security patches shall be applied within **14** days of release
- High-severity patches shall be applied within **30** days of release
- All patches shall be tested before deployment to production systems where feasible
- Emergency patches may bypass normal change control with documented justification

## 5. Review

This policy shall be reviewed every **12** months. Next scheduled review: **2027-11-01**.

---

**Effective Date:** 2026-11-02
**NIST SP 800-171 Controls:** 3.7.1–3.7.6
**Policy Owner:** 
