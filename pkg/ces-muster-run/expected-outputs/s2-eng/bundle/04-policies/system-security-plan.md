# System Security Plan (SSP)

**SIMULATED CUSTOMER (FICTIONAL): Tamberlow Systems Engineering LLC (FICTIONAL)** This organisation is a simulated customer of the CES simulator. Its name, people, identifiers, addresses and tenant are invented; this document describes no real company and is not a compliance record.

**Planning draft, not the SSP of record.** The system security plan of record is the EvidenceOps SSP, which carries the assessed status.

## 1. System Identification

| Field | Value |
|-------|-------|
| **System Name** | Tamberlow Systems Engineering LLC (FICTIONAL) CUI Information System |
| **Organization** | Tamberlow Systems Engineering LLC (FICTIONAL) |
| **Address** | 2750 Halberd Point Road, Suite 300, Wrenmoor, ZZ, 00000 |
| **CAGE Code** | 9S2E7 |
| **DUNS Number** | SIMX4N8T2R6W |
| **Organization Type** | subcontractor |
| **CMMC Target Level** | L2 |
| **Assessment Route** | certification |
| **Boundary Strategy** | single_enclave |
| **Deployment Posture** | hybrid |
| **SSP Date** | 2026-11-01 |

## 2. System Description

### 2.1 System Purpose

This System Security Plan describes the security controls implemented by **Tamberlow Systems Engineering LLC (FICTIONAL)** to protect Controlled Unclassified Information (CUI) in accordance with NIST SP 800-171 Rev 2 and CMMC L2 requirements.

### 2.2 CUI Categorization

- CUI Presence: **cui_present**
- CUI Types: Controlled Technical Information, Export Controlled

### 2.3 System Boundary

The system operates within a **single_enclave** boundary using a **hybrid** deployment model.

### 2.4 Cloud Infrastructure

| Field | Value |
|-------|-------|
| Tenant ID | sim-tenant-s2-eng |
| Primary Domain | s2-eng.simtenant.onmicrosoft.us |
| Cloud Environment | gcc_high |
| Primary SKU | Microsoft 365 G5 |
| Identity Provider | hybrid_ad_connect |
| Device Enrollment | enroll_only |


### 2.6 System Users

- Estimated in-scope users: **29**
- Estimated in-scope endpoints: **29**
- Collaboration mode: **teams_first**
- BYOD posture: **allowed_mdm**

## 3. Key Personnel

| Role | Name | Title | Email |
|------|------|-------|-------|
| Information System Security Officer | Galwyn Rowanfield | Information Systems Security Officer (ISSO) | galwyn.rowanfield@s2-eng.simtenant.onmicrosoft.us |
| System Owner | Aubrel Ashbyfield | President / Principal Engineer | aubrel.ashbyfield@s2-eng.simtenant.onmicrosoft.us |
| Compliance Officer | Arlow Junipbank | Information Security Manager (ISSM) | arlow.junipbank@s2-eng.simtenant.onmicrosoft.us |
| IT Director / CTO | Linnow Flintridge | Director of Operations | linnow.flintridge@s2-eng.simtenant.onmicrosoft.us |
| HR Representative | Zephren Ivorford | Office Manager | zephren.ivorford@s2-eng.simtenant.onmicrosoft.us |
| Incident Response Lead | Roswen Dunnridge | Systems Administrator | roswen.dunnridge@s2-eng.simtenant.onmicrosoft.us |
| Facilities / Physical Security Manager | Dallow Sedgefield | Program Manager / Facility Security Officer | dallow.sedgefield@s2-eng.simtenant.onmicrosoft.us |
| Legal / Contracts Representative | Oriel Elderridge | Contracts and CUI Manager | oriel.elderridge@s2-eng.simtenant.onmicrosoft.us |
| Authorizing Official | Aubrel Ashbyfield | President / Principal Engineer | aubrel.ashbyfield@s2-eng.simtenant.onmicrosoft.us |
| Privacy Officer | Oriel Elderridge | Contracts and CUI Manager (Privacy Officer role holder) | oriel.elderridge@s2-eng.simtenant.onmicrosoft.us |
| Network Administrator | Roswen Dunnridge | Systems Administrator (Network Administrator role holder) | roswen.dunnridge@s2-eng.simtenant.onmicrosoft.us |

## 4. Security Controls

Tamberlow Systems Engineering LLC (FICTIONAL) implements security controls across all 14 NIST SP 800-171 domains:

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
| Partial | 40 | — |
| Not Met | 82 | — |
| Unknown | 12 | — |
| **Total** | **134** | — |

## 5. Organizational Defined Parameters (ODPs)

| Parameter | Value |
|-----------|-------|
| Account Lockout Threshold | 3 attempts |
| Account Lockout Duration | 30 minutes |
| Session Timeout | 15 minutes |
| Minimum Password Length | 14 characters |
| Password History | 24 passwords |
| Maximum Password Age | 60 days |
| Audit Log Retention | 1095 days |
| Vulnerability Scan Frequency | Biweekly |
| Critical Patch Timeline | 7 days |
| High Patch Timeline | 30 days |
| Training Frequency | Annually |
| Incident Reporting | 72 hour(s) |
| Access Review Frequency | Quarterly |
| Backup Frequency | Daily |
| Media Sanitization Standard | NIST SP 800-88 Purge |

## 6. Physical Security

### Facility Locations
- 2750 Halberd Point Road, Suite 300, Wrenmoor, ZZ 00000
- 18 Cinderfield Lane, Wrenmoor, ZZ 00000

- Access Control System: **Badge readers on the office and test-lab entrances and on the project room; the server closet is locked (fictional)**
- Visitor Management: **Visitors sign in at reception, wear a visitor badge and are escorted at all times; the test lab admits visitors only with the lab manager (fictional)**

## 7. Governance

| Field | Value |
|-------|-------|
| Policy Effective Date | 2026-11-01 |
| Review Cycle | Every 12 months |
| Next Review Date | 2027-11-01 |
| Affirming Official | Aubrel Ashbyfield |
| POA&M Policy | poam_if_allowed |

## 8. Risk Acceptance

- POA&M intent: **poam_if_allowed**
- Evidence posture target: **c3pao_ready**
- Assessment route: **certification**

---

**Prepared by:** Galwyn Rowanfield
**Date:** 2026-11-01

## Approval

**Document Owner:** Arlow Junipbank, Information Security Manager (ISSM)
**Approved By:** Aubrel Ashbyfield, President / Principal Engineer (Authorizing Official)
**Signature:** ___________________________
**Date:** ___________________________
