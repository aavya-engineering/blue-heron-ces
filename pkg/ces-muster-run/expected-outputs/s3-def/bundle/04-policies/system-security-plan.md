# System Security Plan (SSP)

**SIMULATED CUSTOMER (FICTIONAL): Corvelline Defense Assemblies Inc. (FICTIONAL)** This organisation is a simulated customer of the CES simulator, deficient by design. Its name, people, identifiers, addresses and tenant are invented; this document describes no real company and is not a compliance record.

**Planning draft, not the SSP of record.** The system security plan of record is the EvidenceOps SSP, which carries the assessed status.

## 1. System Identification

| Field | Value |
|-------|-------|
| **System Name** | Corvelline Defense Assemblies Inc. (FICTIONAL) CUI Information System |
| **Organization** | Corvelline Defense Assemblies Inc. (FICTIONAL) |
| **Address** | 410 Ostervale Works Road, Dunmarrow, ZZ, 00000 |
| **CAGE Code** | 9S3D4 |
| **DUNS Number** | SIMX7Q3D9K5V |
| **Organization Type** | subcontractor |
| **CMMC Target Level** | L2 |
| **Assessment Route** | certification |
| **Boundary Strategy** | single_enclave |
| **Deployment Posture** | cloud_only |
| **SSP Date** | 2026-11-02 |

## 2. System Description

### 2.1 System Purpose

This System Security Plan describes the security controls implemented by **Corvelline Defense Assemblies Inc. (FICTIONAL)** to protect Controlled Unclassified Information (CUI) in accordance with NIST SP 800-171 Rev 2 and CMMC L2 requirements.

### 2.2 CUI Categorization

- CUI Presence: **cui_present**
- CUI Types: Controlled Technical Information, Export Controlled

### 2.3 System Boundary

The system operates within a **single_enclave** boundary using a **cloud_only** deployment model.

### 2.4 Cloud Infrastructure

| Field | Value |
|-------|-------|
| Tenant ID | sim-tenant-s3-def |
| Primary Domain | s3-def.simtenant.onmicrosoft.us |
| Cloud Environment | gcc_high |
| Primary SKU | Microsoft 365 G3 |
| Identity Provider | entra_native |
| Device Enrollment | azure_ad_join |


### 2.6 System Users

- Estimated in-scope users: **57**
- Estimated in-scope endpoints: **57**
- Collaboration mode: **email_first**
- BYOD posture: **not_allowed**

## 3. Key Personnel

| Role | Name | Title | Email |
|------|------|-------|-------|
| Information System Security Officer | Belmira Pennanmore | IT and Security Lead (ISSO) | belmira.pennanmore@s3-def.simtenant.onmicrosoft.us |
| System Owner | Derwyn Arrowbrook | President | derwyn.arrowbrook@s3-def.simtenant.onmicrosoft.us |
| Authorizing Official | Derwyn Arrowbrook | President | derwyn.arrowbrook@s3-def.simtenant.onmicrosoft.us |

## 4. Security Controls

Corvelline Defense Assemblies Inc. (FICTIONAL) implements security controls across all 14 NIST SP 800-171 domains:

1. **Access Control (AC)** — See Access Control Policy
2. **Awareness & Training (AT)** — See Awareness and Training Policy
3. **Audit & Accountability (AU)** — See Audit and Accountability Policy
4. **Configuration Management (CM)** — See Configuration Management Policy
5. **Identification & Authentication (IA)** — See Identification and Authentication Policy
6. **Incident Response (IR)** — See Incident Response Policy and IRP
7. **Maintenance (MA)** — See Maintenance Policy
8. **Media Protection (MP)** — See Media Protection Policy
9. **Personnel Security (PS)** — See Personnel Security Policy
10. **Physical Protection (PE)** — See Physical Protection Policy
11. **Risk Assessment (RA)** — See Risk Assessment Policy
12. **Security Assessment (CA)** — See Security Assessment Policy
13. **System & Communications Protection (SC)** — See System and Communications Protection Policy
14. **System & Information Integrity (SI)** — See System and Information Integrity Policy

### 4.1 Current Compliance Status

| Status | Count | Percentage |
|--------|-------|-----------|
| Met | 0 | 0% |
| Partial | 24 | — |
| Not Met | 89 | — |
| Unknown | 16 | — |
| **Total** | **129** | — |

## 5. Organizational Defined Parameters (ODPs)

| Parameter | Value |
|-----------|-------|
| Account Lockout Threshold | 3 attempts |
| Account Lockout Duration | 15 minutes |
| Session Timeout | 15 minutes |
| Minimum Password Length | 14 characters |
| Password History | 24 passwords |
| Maximum Password Age | 60 days |
| Audit Log Retention | 365 days |
| Vulnerability Scan Frequency | Monthly |
| Critical Patch Timeline | 14 days |
| High Patch Timeline | 30 days |
| Training Frequency | Annually |
| Incident Reporting | 72 hour(s) |
| Access Review Frequency | Quarterly |
| Backup Frequency | Daily |
| Media Sanitization Standard | NIST SP 800-88 Purge |

## 6. Physical Security

### Facility Locations
- 410 Ostervale Works Road, Dunmarrow, ZZ 00000

- Access Control System: **Keyed doors; a badge reader on the front-office entrance only; the production floor opens to the loading dock during shifts (fictional)**
- Visitor Management: **Visitors sign a paper book at the front desk; escorting on the production floor is not enforced (fictional)**

## 7. Governance

| Field | Value |
|-------|-------|
| Policy Effective Date | 2026-11-02 |
| Review Cycle | Every 12 months |
| Next Review Date | 2027-11-01 |
| Affirming Official | Derwyn Arrowbrook |
| POA&M Policy | poam_if_allowed |

## 8. Risk Acceptance

- POA&M intent: **poam_if_allowed**
- Evidence posture target: **l2_self_ready**
- Assessment route: **certification**

---

**Prepared by:** Belmira Pennanmore
**Date:** 2026-11-02

## Approval

**Approved By:** Derwyn Arrowbrook, President (Authorizing Official)
**Signature:** ___________________________
**Date:** ___________________________
