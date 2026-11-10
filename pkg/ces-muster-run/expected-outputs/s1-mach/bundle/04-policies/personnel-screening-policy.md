# Personnel Screening Procedure (EDC-POL-009)

**SIMULATED CUSTOMER (FICTIONAL): Hollinford Precision Machining LLC (FICTIONAL)** This organisation is a simulated customer of the CES simulator. Its name, people, identifiers, addresses and tenant are invented; this document describes no real company and is not a compliance record.

**Version:** 1.0
**Effective Date:** 2026-11-01
**Policy Owner:** Alvane Ashenmere
**Organization:** Hollinford Precision Machining LLC (FICTIONAL)

## 1. Purpose

This procedure establishes the personnel screening requirements for **Hollinford Precision Machining LLC (FICTIONAL)** to ensure that all individuals are screened prior to being authorized access to systems containing Controlled Unclassified Information (CUI), in accordance with NIST SP 800-171 Rev 2 control 3.9.1 and CMMC L2 requirements.

## 2. Scope

This procedure applies to all employees, contractors, third-party personnel, and service accounts requiring access to CUI systems within the single_enclave boundary, including the cloud_only deployment posture operating in the gcc_high cloud environment.

## 3. Roles and Responsibilities

| Role | Name | Responsibility |
|------|------|----------------|
| HR Representative | Orsk Copperholt | Coordinate and document screening activities |
| ISSO | Corvane Marrowholt | Verify screening completion before access provisioning |
| System Owner (AO) | Alvane Ashenmere | Authorize CUI access after all screening elements are documented |

## 4. Screening Criteria

All personnel must satisfy the following seven screening elements before CUI access is authorized:

### 4.1 Identity Verification

Government-issued photo identification must be verified and documented. Acceptable forms include a valid passport, driver's license, or state-issued identification card.

### 4.2 Citizenship and Immigration Status

Citizenship or lawful immigration status must be verified and documented.

### 4.3 Professional History Verification

Employment history for the prior seven years must be verified through direct employer contact or a qualified third-party investigation service.

### 4.4 Background Investigation

One of the following must be completed and documented:
- **Direct-knowledge attestation** by the Authorizing Official (see Section 6, Small-Organization Provision)
- **Third-party background investigation** conducted by a qualified investigation service

### 4.5 Self-Attestation

The individual must provide a signed self-attestation covering:
- Criminal history disclosure
- OFAC (Office of Foreign Assets Control) sanctions list clearance

### 4.6 CUI Acknowledgment

The individual must sign a CUI handling acknowledgment per 32 CFR Part 2002, confirming understanding of responsibilities for protecting CUI.

### 4.7 Authorizing Official Sign-Off

The Authorizing Official (Alvane Ashenmere) must review all completed screening elements and provide documented sign-off before CUI access is provisioned.

## 5. Authorization Gate

No account provisioning or CUI access shall be granted until all seven screening elements in Section 4 are completed and documented. The Authorizing Official sign-off (Section 4.7) is the final gate and must occur after all other elements are satisfactorily documented.

## 6. Small-Organization Provision

For organizations where the Authorizing Official has direct, firsthand knowledge of an individual's background (e.g., founder-level relationships), the following alternative is permitted:
- The Authorizing Official provides a written direct-knowledge attestation documenting the basis of their personal knowledge
- The individual provides a mutual attestation acknowledging their screening status
- Both attestations must be signed, dated, and retained per Section 7

This provision does not waive the requirements for identity verification (4.1), citizenship verification (4.2), CUI acknowledgment (4.6), or AO sign-off (4.7).

## 7. Documentation and Retention

The following evidence elements must be maintained for each individual screened:

1. Government-issued photo ID (copy)
2. Citizenship/immigration verification record
3. Professional history verification results
4. Background investigation report or direct-knowledge attestation
5. Signed self-attestation (criminal history, OFAC)
6. Signed CUI handling acknowledgment
7. Authorizing Official sign-off record

All screening records shall be retained for **6** years per 6 years per 32 CFR 170.16.

## 8. Reassessment

Personnel screening shall be reassessed every **5** years. Additionally, reassessment shall be triggered by any of the following events:

- Criminal arrest or conviction
- Role change with elevated CUI access
- Organizational ownership or control change

## 9. Third-Party Personnel

Third-party personnel, including contractors and subcontractors, are subject to the same screening requirements as organizational employees. Additionally:
- A non-disclosure agreement (NDA) covering CUI handling must be executed prior to access authorization
- The sponsoring organization must verify that screening has been completed before requesting access provisioning

## 10. Tooling Reference

Personnel screening status is tracked in the Personnel card Screening sub-feature of the compliance tooling. Screening completion status must be current before access provisioning workflows are executed.

## 11. Enforcement / Consequence of Non-Compliance

Failure to complete required screening elements will result in denial or revocation of CUI system access. Personnel who circumvent screening requirements or provide false information during the screening process are subject to disciplinary action, up to and including termination, and may be reported to relevant authorities.

## 12. Review

This procedure shall be reviewed every **12** months. Next scheduled review: **2027-11-01**.

## Attestation

I, Alvane Ashenmere, as the Authorizing Official, have reviewed and approve this policy.

**Signature:** ___________________________
**Name:** Alvane Ashenmere
**Title:** President / Owner
**Date:** ___________________________

---

**Effective Date:** 2026-11-01
**CMMC Controls:** 3.9.1
**Policy Owner:** Alvane Ashenmere
