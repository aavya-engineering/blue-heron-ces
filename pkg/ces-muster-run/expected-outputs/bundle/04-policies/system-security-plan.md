# System Security Plan (SSP)

**Planning draft, not the SSP of record.** The system security plan of record is the EvidenceOps SSP, which carries the assessed status.

## 1. System Identification

| Field | Value |
|-------|-------|
| **System Name** | Sim tenant muster-partial CUI Information System |
| **Organization** | Sim tenant muster-partial |
| **Address** |  |
| **CAGE Code** | N/A |
| **DUNS Number** | N/A |
| **Organization Type** | other |
| **CMMC Target Level** | L2 |
| **Assessment Route** | unknown_contract_dependent |
| **Boundary Strategy** | unknown |
| **Deployment Posture** | cloud_only |
| **SSP Date** | 2026-11-02 |

## 2. System Description

### 2.1 System Purpose

This System Security Plan describes the security controls implemented by **Sim tenant muster-partial** to protect Controlled Unclassified Information (CUI) in accordance with NIST SP 800-171 Rev 2 and CMMC L2 requirements.

### 2.2 CUI Categorization

- CUI Presence: **cui_present**

### 2.3 System Boundary

The system operates within a **unknown** boundary using a **cloud_only** deployment model.

### 2.4 Cloud Infrastructure

| Field | Value |
|-------|-------|
| Tenant ID | sim-tenant-muster-partial |
| Primary Domain | muster-partial.simtenant.onmicrosoft.us |
| Cloud Environment | gcc_high |
| Primary SKU | Microsoft 365 G5 |
| Identity Provider | entra_native |
| Device Enrollment | azure_ad_join |


### 2.6 System Users

- Estimated in-scope users: **5**
- Estimated in-scope endpoints: **5**
- Collaboration mode: **unknown**
- BYOD posture: **unknown**

## 3. Key Personnel

| Role | Name | Title | Email |
|------|------|-------|-------|

## 4. Security Controls

Sim tenant muster-partial implements security controls across all 14 NIST SP 800-171 domains:

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
| Partial | 57 | — |
| Not Met | 56 | — |
| Unknown | 21 | — |
| **Total** | **134** | — |

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

Physical security controls are documented separately or managed by the facility provider.

## 7. Governance

| Field | Value |
|-------|-------|
| Policy Effective Date | 2026-11-02 |
| Review Cycle | Every 12 months |
| Next Review Date | 2027-11-01 |
| Affirming Official | Not specified |
| POA&M Policy | unknown |

## 8. Risk Acceptance

- POA&M intent: **unknown**
- Evidence posture target: **unknown**
- Assessment route: **unknown_contract_dependent**

---

**Prepared by:** 
**Date:** 2026-11-02
