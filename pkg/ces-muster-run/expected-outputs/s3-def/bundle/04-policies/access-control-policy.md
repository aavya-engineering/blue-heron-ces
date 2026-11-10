# Access Control Policy

**SIMULATED CUSTOMER (FICTIONAL): Corvelline Defense Assemblies Inc. (FICTIONAL)** This organisation is a simulated customer of the CES simulator, deficient by design. Its name, people, identifiers, addresses and tenant are invented; this document describes no real company and is not a compliance record.

## 1. Purpose

This Access Control Policy establishes the requirements and procedures for managing access to information systems and data within **Corvelline Defense Assemblies Inc. (FICTIONAL)** in accordance with NIST SP 800-171 Rev 2 (Family 3.1) and CMMC L2 requirements.

## 2. Scope

This policy applies to all information systems, applications, and data repositories that process, store, or transmit Controlled Unclassified Information (CUI) within the single_enclave boundary operated by Corvelline Defense Assemblies Inc. (FICTIONAL).


**Estimated in-scope users:** 57
**Estimated in-scope endpoints:** 57

## 3. Roles and Responsibilities

| Role | Name | Responsibility |
|------|------|----------------|
| Information System Security Officer | Belmira Pennanmore | Enforce access control policies and monitor compliance |
| System Owner | Derwyn Arrowbrook | Authorize access to systems and approve access requests |
| IT Director / CTO |  | Maintain technical access control mechanisms |
| Compliance Officer |  | Audit access control effectiveness |

## 4. Policy Statements

### 4.1 Account Management (3.1.1, 3.1.2)

Corvelline Defense Assemblies Inc. (FICTIONAL) shall limit information system access to authorized users, processes acting on behalf of authorized users, and devices.

- Access shall be granted based on the principle of least privilege
- All accounts shall be reviewed on a **Quarterly** basis
- Account lockout shall be enforced after **3** failed login attempts
- Accounts shall be locked for **15** minutes after lockout threshold is reached
- Primary identity management is performed through **entra_native** on the **gcc_high** tenant (s3-def.simtenant.onmicrosoft.us)

### 4.2 Access Enforcement (3.1.3, 3.1.4)

Access to CUI shall be controlled through:
- Role-based access control (RBAC)
- Conditional access policies following the **S3-CA{NN} {Purpose}** naming convention
- Multi-factor authentication for all users accessing CUI

### 4.3 Separation of Duties (3.1.4)

Corvelline Defense Assemblies Inc. (FICTIONAL) shall enforce separation of duties through:
- Distinct administrative and user accounts
- Privileged Identity Management (PIM)
- Segregated roles for security administration, system administration, and audit functions

### 4.4 Least Privilege (3.1.5, 3.1.6)

- Users shall be authorized only the minimum access necessary for their job functions
- Privileged accounts shall be limited to designated administrators
- CUI access shall require explicit authorization from the System Owner

### 4.5 Unsuccessful Logon Attempts (3.1.8)

The system shall limit unsuccessful logon attempts to **3** consecutive attempts within a 15-minute window. After exceeding the threshold, the account shall be locked for **15** minutes.

### 4.6 Session Management (3.1.10, 3.1.11)

- Session timeout shall be enforced after **15** minutes of inactivity
- Sessions shall be terminated upon user logoff
- Session locks shall require re-authentication

### 4.7 Remote Access (3.1.12, 3.1.13, 3.1.14)

- All remote access to CUI systems shall be monitored and controlled
- Remote access sessions shall use encrypted connections (TLS 1.2+)
- BYOD posture: **not_allowed**
- Personal devices are prohibited from accessing CUI

### 4.8 Wireless Access (3.1.16, 3.1.17)

- Wireless access to CUI systems shall be authenticated and encrypted
- Wireless access points shall be monitored for unauthorized connections

### 4.9 Mobile Device Access (3.1.18, 3.1.19)

- Mobile devices accessing CUI shall be enrolled in mobile device management
- Device enrollment type: **azure_ad_join**
- CUI shall be encrypted at rest on all mobile devices

### 4.10 External System Connections (3.1.20, 3.1.21, 3.1.22)

- Connections to external systems shall be authorized by the System Owner
- Publicly accessible information systems shall not contain CUI
- Collaboration mode: **email_first**

## 5. Enforcement

Violations of this policy may result in disciplinary action, up to and including termination of employment and/or contract.

## 6. Review

This policy shall be reviewed every **12** months. Next scheduled review: **2027-11-01**.

---

**Effective Date:** 2026-11-01
**NIST SP 800-171 Controls:** 3.1.1–3.1.22
**Policy Owner:** Belmira Pennanmore

## Approval

**Approved By:** Derwyn Arrowbrook, President (Authorizing Official)
**Signature:** ___________________________
**Date:** ___________________________
