# Personnel Termination and Transfer Procedure (EDC-POL-010)

**Version:** 1.0
**Effective Date:** 2026-11-01
**Policy Owner:** Designated Official
**Organization:** Sim tenant muster-partial

## 1. Purpose

This procedure establishes the requirements for protecting CUI systems and data during and after personnel termination, transfer, and role change actions for **Sim tenant muster-partial**, in accordance with NIST SP 800-171 Rev 2 control 3.9.2 and CMMC L2 requirements.

## 2. Scope

This procedure applies to all employees, contractors, third-party personnel, and service accounts within the unknown boundary operating in the cloud_only deployment posture and the gcc_high cloud environment. It covers all termination types (voluntary, involuntary, for cause), transfers between roles, and changes in job responsibilities affecting CUI access.

## 3. Roles and Responsibilities

| Role | Name | Responsibility |
|------|------|----------------|
| HR Representative | Designated Official | Initiate personnel action notification and coordinate property return |
| ISSO | Designated Official | Execute technical access revocation and verify completion |
| System Owner (AO) | Designated Official | Authorize access changes and review completion of all actions |

## 4. Immediate Actions (typically within 1 business hour)

Upon notification of a personnel termination or for-cause separation, the following actions shall be completed typically within 1 business hour:

### 4.1 Notification

HR Representative notifies the ISSO and System Owner of the personnel action, including the type (termination, transfer, role change) and effective timing.

### 4.2 Disable Identity Provider Account

The departing individual's entra_native account shall be disabled to prevent new authentication.

### 4.3 Revoke Active Sessions

All active sessions (Microsoft 365, VPN, remote access) shall be revoked to terminate any currently authenticated access.

### 4.4 Remove Conditional Access Policy Scope

The individual shall be removed from all Conditional Access policy groups that grant CUI system access.

### 4.5 Disable Service Account Credentials

Any service account credentials, API keys, or shared secrets associated with the individual shall be rotated or disabled.

## 5. Near-Term Actions (typically within 1 business day)

The following actions shall be completed typically within 1 business day of the personnel action:

### 5.1 CUI Access Review

A comprehensive review of all CUI access grants shall be conducted to identify and document all systems, applications, and data repositories the individual had access to.

### 5.2 Email and OneDrive Preservation

The individual's Exchange Online mailbox and OneDrive for Business content shall be placed on litigation hold or exported for preservation in accordance with organizational retention requirements.

### 5.3 Data Access Review Trigger

A review shall be initiated to determine whether the individual accessed, downloaded, or transferred CUI data in the period preceding the personnel action.

### 5.4 License Unassignment

Microsoft 365 and other SaaS licenses assigned to the individual shall be unassigned and returned to the license pool.

### 5.5 Account Marked for Deletion

The disabled account shall be marked for deletion following the 30-day soft delete period, during which recovery remains possible if needed for investigation purposes.

## 6. Property Return

All organizational property shall be returned and documented using the following chain of custody record:

| Item | Serial/ID | Returned To | Date | Condition | Signature |
|------|-----------|-------------|------|-----------|-----------|
| Laptop/Workstation | | | | | |
| Mobile Device | | | | | |
| Access Badges/Cards | | | | | |
| Hardware Tokens/Keys | | | | | |
| Removable Media | | | | | |
| Other Equipment | | | | | |

All credentials, including passwords, PINs, and authentication tokens, shall be collected or confirmed as revoked.

## 7. Transfer-Specific Provisions

For personnel transferring between roles within the organization:

- **Access Review:** Current CUI access grants shall be reviewed against the requirements of the new role
- **Access Removal:** CUI access not required for the new role shall be revoked prior to the transfer effective date
- **Access Addition:** New CUI access required for the new role shall follow the standard screening and authorization process (EDC-POL-009)
- **Manager Authorization:** The receiving manager must authorize any new access grants in writing

## 8. SLA Enforcement

Time-bound expectations for immediate (typically 1 business hour) and near-term (typically 1 business day) actions are tracked through the compliance tooling. Elapsed time from notification to completion is recorded for each action item. SLA breaches shall be documented, including the reason for delay and any compensating controls applied during the extended period.

## 9. Sample Execution Provision

In the absence of actual termination events during an assessment period, procedural sample executions shall be conducted and documented to demonstrate the organization's capability to execute this procedure. Sample executions count as evidence of procedural readiness for assessment purposes.

## 10. Tooling Reference

Personnel termination and transfer actions are tracked through the Offboarding workflow in the compliance tooling. The procedural overlay artifact documents each step's completion status. entra_native audit log correlation provides independent verification of technical access revocation timing.

## 11. Documentation and Retention

All personnel action records, including notification timestamps, access revocation evidence, property return documentation, and completion confirmations, shall be retained for **6** years per 6 years per 32 CFR 170.16.

## 12. Enforcement / Consequence of Non-Compliance

Failure to execute personnel termination or transfer actions within the specified timeframes may result in unauthorized CUI access and constitutes a security incident. Personnel responsible for executing these procedures who fail to comply are subject to disciplinary action, up to and including termination. All SLA breaches shall be documented and reported to the Authorizing Official.

## 13. Review

This procedure shall be reviewed every **12** months. Next scheduled review: **2027-11-01**.

## Attestation

I, Designated Official, as the Authorizing Official, have reviewed and approve this policy.

**Signature:** ___________________________
**Name:** Designated Official
**Title:** Authorizing Official
**Date:** ___________________________

---

**Effective Date:** 2026-11-01
**CMMC Controls:** 3.9.2
**Policy Owner:** Designated Official
