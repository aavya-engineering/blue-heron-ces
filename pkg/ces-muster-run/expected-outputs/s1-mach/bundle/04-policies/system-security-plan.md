# System Security Plan (SSP)

**SIMULATED CUSTOMER (FICTIONAL): Hollinford Precision Machining LLC (FICTIONAL)** This organisation is a simulated customer of the CES simulator. Its name, people, identifiers, addresses and tenant are invented; this document describes no real company and is not a compliance record.

**Planning draft, not the SSP of record.** The system security plan of record is the EvidenceOps SSP, which carries the assessed status.

## 1. System Identification

| Field | Value |
|-------|-------|
| **System Name** | Hollinford Precision Machining LLC (FICTIONAL) CUI Information System |
| **Organization** | Hollinford Precision Machining LLC (FICTIONAL) |
| **Address** | 4100 Quarrystone Parkway, Unit 2, Fennick Falls, ZZ, 00000 |
| **CAGE Code** | 9S4M1 |
| **DUNS Number** | SIMX7Q2M4K9P |
| **Organization Type** | subcontractor |
| **CMMC Target Level** | L2 |
| **Assessment Route** | certification |
| **Boundary Strategy** | single_enclave |
| **Deployment Posture** | cloud_only |
| **SSP Date** | 2026-11-01 |

## 2. System Description

### 2.1 System Purpose

This System Security Plan describes the security controls implemented by **Hollinford Precision Machining LLC (FICTIONAL)** to protect Controlled Unclassified Information (CUI) in accordance with NIST SP 800-171 Rev 2 and CMMC L2 requirements.

### 2.2 CUI Categorization

- CUI Presence: **cui_present**
- CUI Types: Controlled Technical Information, Export Controlled

### 2.3 System Boundary

The system operates within a **single_enclave** boundary using a **cloud_only** deployment model.

### 2.4 Cloud Infrastructure

| Field | Value |
|-------|-------|
| Tenant ID | sim-tenant-s1-mach |
| Primary Domain | s1-mach.simtenant.onmicrosoft.us |
| Cloud Environment | gcc_high |
| Primary SKU | Microsoft 365 G5 |
| Identity Provider | entra_native |
| Device Enrollment | azure_ad_join |


### 2.6 System Users

- Estimated in-scope users: **44**
- Estimated in-scope endpoints: **44**
- Collaboration mode: **teams_first**
- BYOD posture: **not_allowed**

## 3. Key Personnel

| Role | Name | Title | Email |
|------|------|-------|-------|
| Information System Security Officer | Corvane Marrowholt | Information Systems Security Officer (ISSO) | corvane.marrowholt@s1-mach.simtenant.onmicrosoft.us |
| System Owner | Alvane Ashenmere | President / Owner | alvane.ashenmere@s1-mach.simtenant.onmicrosoft.us |
| Compliance Officer | Tamsel Kettlevane | Information Security Manager (ISSM) | tamsel.kettlevane@s1-mach.simtenant.onmicrosoft.us |
| IT Director / CTO | Halric Brackvane | Vice President, Operations | halric.brackvane@s1-mach.simtenant.onmicrosoft.us |
| HR Representative | Orsk Copperholt | Controller | orsk.copperholt@s1-mach.simtenant.onmicrosoft.us |
| Incident Response Lead | Dorrel Nettlecombe | Systems Administrator | dorrel.nettlecombe@s1-mach.simtenant.onmicrosoft.us |
| Facilities / Physical Security Manager | Varra Drosscombe | Programs Manager / Facility Security Officer | varra.drosscombe@s1-mach.simtenant.onmicrosoft.us |
| Legal / Contracts Representative | Ettrin Fallowwick | Contracts and CUI Manager | ettrin.fallowwick@s1-mach.simtenant.onmicrosoft.us |
| Authorizing Official | Alvane Ashenmere | President / Owner | alvane.ashenmere@s1-mach.simtenant.onmicrosoft.us |
| Privacy Officer | Ettrin Fallowwick | Contracts and CUI Manager (Privacy Officer role holder) | ettrin.fallowwick@s1-mach.simtenant.onmicrosoft.us |
| Network Administrator | Dorrel Nettlecombe | Systems Administrator (Network Administrator role holder) | dorrel.nettlecombe@s1-mach.simtenant.onmicrosoft.us |

## 4. Security Controls

Hollinford Precision Machining LLC (FICTIONAL) implements security controls across all 14 NIST SP 800-171 domains:

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
| Partial | 41 | — |
| Not Met | 77 | — |
| Unknown | 12 | — |
| **Total** | **130** | — |

## 5. Organizational Defined Parameters (ODPs)

| Parameter | Value |
|-----------|-------|
| Account Lockout Threshold | 3 attempts |
| Account Lockout Duration | 15 minutes |
| Session Timeout | 10 minutes |
| Minimum Password Length | 14 characters |
| Password History | 24 passwords |
| Maximum Password Age | 60 days |
| Audit Log Retention | 730 days |
| Vulnerability Scan Frequency | Weekly |
| Critical Patch Timeline | 14 days |
| High Patch Timeline | 30 days |
| Training Frequency | Annually |
| Incident Reporting | 72 hour(s) |
| Access Review Frequency | Monthly |
| Backup Frequency | Daily |
| Media Sanitization Standard | NIST SP 800-88 Purge |

## 6. Physical Security

### Facility Locations
- 4100 Quarrystone Parkway, Unit 2, Fennick Falls, ZZ 00000

- Access Control System: **Badge readers on the plant entrances and the programming room; the network rack is in a locked cage (fictional)**
- Visitor Management: **Visitors sign in at reception, wear a visitor badge and are escorted at all times (fictional)**

## 7. Governance

| Field | Value |
|-------|-------|
| Policy Effective Date | 2026-11-01 |
| Review Cycle | Every 12 months |
| Next Review Date | 2027-11-01 |
| Affirming Official | Alvane Ashenmere |
| POA&M Policy | poam_if_allowed |

## 8. Risk Acceptance

- POA&M intent: **poam_if_allowed**
- Evidence posture target: **c3pao_ready**
- Assessment route: **certification**

---

**Prepared by:** Corvane Marrowholt
**Date:** 2026-11-01

## Approval

**Document Owner:** Tamsel Kettlevane, Information Security Manager (ISSM)
**Approved By:** Alvane Ashenmere, President / Owner (Authorizing Official)
**Signature:** ___________________________
**Date:** ___________________________
