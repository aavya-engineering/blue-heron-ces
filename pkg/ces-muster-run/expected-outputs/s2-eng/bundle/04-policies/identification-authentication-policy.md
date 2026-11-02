# Identification and Authentication Policy

**SIMULATED CUSTOMER (FICTIONAL): Tamberlow Systems Engineering LLC (FICTIONAL)** This organisation is a simulated customer of the CES simulator. Its name, people, identifiers, addresses and tenant are invented; this document describes no real company and is not a compliance record.

## 1. Purpose

This policy establishes identification and authentication requirements for **Tamberlow Systems Engineering LLC (FICTIONAL)** in accordance with NIST SP 800-171 Rev 2 (Family 3.5) and CMMC L2 requirements.

## 2. Scope

This policy applies to all users, devices, and processes accessing information systems within the single_enclave boundary.

## 3. Roles and Responsibilities

| Role | Name | Responsibility |
|------|------|----------------|
| ISSO | Galwyn Rowanfield | Define authentication standards |
| IT Director | Linnow Flintridge | Implement authentication mechanisms |
| System Owner | Aubrel Ashbyfield | Authorize user identities |

## 4. Policy Statements

### 4.1 User Identification (3.5.1, 3.5.2)

- Each user shall be assigned a unique identifier
- User identities shall be verified before granting system access
- Shared accounts are prohibited for CUI system access
- Identity provider: **hybrid_ad_connect** on gcc_high tenant (s2-eng.simtenant.onmicrosoft.us)

### 4.2 Multi-Factor Authentication (3.5.3)

- Multi-factor authentication (MFA) shall be required for:
  - All access to CUI systems (local and remote)
  - All privileged account access
  - All remote access sessions
- MFA shall use at least two of: something you know, something you have, something you are

### 4.3 Replay-Resistant Authentication (3.5.4)

Authentication mechanisms shall employ replay-resistant techniques (e.g., time-based tokens, challenge-response, cryptographic authenticators).

### 4.4 Identifier Management (3.5.5, 3.5.6)

- User identifiers shall not be reused for a minimum of 2 years after account deletion
- Inactive accounts shall be disabled after 90 days of inactivity
- Temporary accounts shall have explicit expiration dates

### 4.5 Password Management (3.5.7, 3.5.8, 3.5.9, 3.5.10)

- Minimum password length: **14** characters
- Password complexity: combination of uppercase, lowercase, numbers, and special characters
- Password history: last **24** passwords shall not be reused
- Maximum password age: **60** days
- Passwords shall be stored using cryptographically secure hashing
- Default and vendor-supplied passwords shall be changed immediately upon installation

### 4.6 Authenticator Feedback (3.5.10)

Authentication feedback shall not reveal whether the identifier or the authenticator was incorrect (obscured error messages).

### 4.7 Cryptographic Authentication (3.5.11)

Cryptographic mechanisms shall be used to protect the confidentiality of authentication information during transmission.

## 5. Enforcement

Accounts that violate this policy (e.g., shared credentials, disabled MFA) shall be suspended pending investigation.

## 6. Review

This policy shall be reviewed every **12** months. Next scheduled review: **2027-11-01**.

---

**Effective Date:** 2026-11-02
**NIST SP 800-171 Controls:** 3.5.1–3.5.11
**Policy Owner:** Galwyn Rowanfield

## Approval

**Approved By:** Aubrel Ashbyfield, President / Principal Engineer (Authorizing Official)
**Signature:** ___________________________
**Date:** ___________________________
