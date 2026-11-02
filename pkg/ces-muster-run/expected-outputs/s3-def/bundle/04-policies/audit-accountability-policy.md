# Audit and Accountability Policy

**SIMULATED CUSTOMER (FICTIONAL): Corvelline Defense Assemblies Inc. (FICTIONAL)** This organisation is a simulated customer of the CES simulator, deficient by design. Its name, people, identifiers, addresses and tenant are invented; this document describes no real company and is not a compliance record.

## 1. Purpose

This policy establishes the requirements for audit logging, monitoring, and accountability within **Corvelline Defense Assemblies Inc. (FICTIONAL)** in accordance with NIST SP 800-171 Rev 2 (Family 3.3) and CMMC L2 requirements.

## 2. Scope

This policy applies to all information systems within the single_enclave boundary that process, store, or transmit CUI.

## 3. Roles and Responsibilities

| Role | Name | Responsibility |
|------|------|----------------|
| ISSO | Belmira Pennanmore | Establish audit requirements and review audit logs |
| IT Director |  | Implement and maintain audit infrastructure |
| System Owner | Derwyn Arrowbrook | Ensure systems generate required audit records |
| Compliance Officer |  | Verify audit compliance |

## 4. Policy Statements

### 4.1 Audit Event Creation (3.3.1)

The organization shall create and retain system audit logs sufficient to establish:
- What type of event occurred
- When the event occurred
- Where the event occurred
- Source of the event
- Outcome of the event
- Identity of individuals or subjects associated with the event

Auditable events include at minimum: login/logout, access to CUI, privilege changes, system configuration changes, account management actions, and failed access attempts.

### 4.2 Audit Correlation and Reporting (3.3.2)

Audit records from multiple sources shall be correlated to support investigation of security incidents.
- SIEM: Microsoft Sentinel workspace **s3-def-law-prod**

### 4.3 Audit Record Content (3.3.1, 3.3.2)

Audit records shall contain sufficient information to establish what occurred, when, where, the source, and the outcome.

### 4.4 Audit Storage and Retention (3.3.4)

- Audit logs shall be retained for a minimum of **365** days
- Audit storage capacity shall be managed to prevent storage exhaustion
- Alerts shall be generated when audit storage reaches 80% capacity

### 4.5 Audit Log Protection (3.3.3, 3.3.8)

- Audit logs shall be protected from unauthorized access, modification, and deletion
- Only designated security personnel shall have access to audit log management functions
- Audit log integrity shall be protected using tamper-evident mechanisms

### 4.6 Audit Review and Analysis (3.3.5)

- Audit logs shall be reviewed on a regular schedule (at minimum weekly)
- Automated alerting shall be configured for high-severity events
- Unusual or suspicious activity shall be investigated and documented

### 4.7 Audit Reduction and Report Generation (3.3.6)

The organization shall provide audit reduction and report generation capabilities to support after-the-fact investigations and on-demand compliance reporting.

### 4.8 Time Synchronization (3.3.7)

All systems shall synchronize clocks to a common authoritative time source to enable accurate audit record correlation.

### 4.9 Audit Process Protection (3.3.9)

Audit logging processes shall be protected from unauthorized shutdown or modification. System administrators shall not have the ability to disable auditing on CUI systems.

## 5. Enforcement

Disabling, circumventing, or tampering with audit controls is strictly prohibited and may result in disciplinary action.

## 6. Review

This policy shall be reviewed every **12** months. Next scheduled review: **2027-11-01**.

---

**Effective Date:** 2026-11-01
**NIST SP 800-171 Controls:** 3.3.1–3.3.9
**Policy Owner:** Belmira Pennanmore

## Approval

**Approved By:** Derwyn Arrowbrook, President (Authorizing Official)
**Signature:** ___________________________
**Date:** ___________________________
