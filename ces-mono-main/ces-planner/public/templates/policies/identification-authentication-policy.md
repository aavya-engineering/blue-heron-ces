# Identification and Authentication Policy

## 1. Purpose

This policy establishes identification and authentication requirements for **{{org.legal_name}}** in accordance with NIST SP 800-171 Rev 2 (Family 3.5) and CMMC {{si.target_cmmc_level}} requirements.

## 2. Scope

This policy applies to all users, devices, and processes accessing information systems within the {{si.boundary_strategy}} boundary.

## 3. Roles and Responsibilities

| Role | Name | Responsibility |
|------|------|----------------|
| ISSO | {{personnel.isso.name}} | Define authentication standards |
| IT Director | {{personnel.it_director.name}} | Implement authentication mechanisms |
| System Owner | {{personnel.system_owner.name}} | Authorize user identities |

## 4. Policy Statements

### 4.1 User Identification (3.5.1, 3.5.2)

- Each user shall be assigned a unique identifier
- User identities shall be verified before granting system access
- Shared accounts are prohibited for CUI system access
{{#if tenant.has_tenant}}
- Identity provider: **{{tenant.identity_provider}}** on {{tenant.cloud_environment}} tenant ({{tenant.primary_domain}})
{{/if}}

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

- Minimum password length: **{{default odp.min_password_length "14"}}** characters
- Password complexity: combination of uppercase, lowercase, numbers, and special characters
- Password history: last **{{default odp.password_history_count "24"}}** passwords shall not be reused
- Maximum password age: **{{default odp.max_password_age_days "60"}}** days
- Passwords shall be stored using cryptographically secure hashing
- Default and vendor-supplied passwords shall be changed immediately upon installation

### 4.6 Authenticator Feedback (3.5.10)

Authentication feedback shall not reveal whether the identifier or the authenticator was incorrect (obscured error messages).

### 4.7 Cryptographic Authentication (3.5.11)

Cryptographic mechanisms shall be used to protect the confidentiality of authentication information during transmission.

## 5. Enforcement

Accounts that violate this policy (e.g., shared credentials, disabled MFA) shall be suspended pending investigation.

## 6. Review

This policy shall be reviewed every **{{governance.review_cycle_months}}** months. Next scheduled review: **{{governance.next_review_date}}**.

---

**Effective Date:** {{governance.policy_effective_date}}
**NIST SP 800-171 Controls:** 3.5.1–3.5.11
**Policy Owner:** {{personnel.isso.name}}
