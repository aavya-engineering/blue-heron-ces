# Continuous Monitoring Plan

**SIMULATED CUSTOMER (FICTIONAL): Corvelline Defense Assemblies Inc. (FICTIONAL)** This organisation is a simulated customer of the CES simulator, deficient by design. Its name, people, identifiers, addresses and tenant are invented; this document describes no real company and is not a compliance record.

## 1. Document Information

| Field | Value |
|-------|-------|
| **Organization** | Corvelline Defense Assemblies Inc. (FICTIONAL) |
| **CMMC Level** | L2 |
| **Effective Date** | 2026-11-01 |
| **Prepared By** | Belmira Pennanmore |
| **Authorizing Official** | Derwyn Arrowbrook, President |

## 2. Purpose

This plan establishes how **Corvelline Defense Assemblies Inc. (FICTIONAL)** monitors the security controls of the systems that process, store, or transmit CUI on an ongoing basis, so that their continued effectiveness is known between assessments, in accordance with NIST SP 800-171 Rev 2 requirement 3.12.3 and CMMC L2 requirements.

## 3. Scope

This plan applies to all information systems within the single_enclave boundary, including cloud_only environments hosted on the **gcc_high** tenant (s3-def.simtenant.onmicrosoft.us).

## 4. Roles and Responsibilities

| Role | Name | Responsibility |
|------|------|----------------|
| Authorizing Official | Derwyn Arrowbrook | Receives monitoring results and decides on continued operation and risk acceptance |
| ISSO | Belmira Pennanmore | Runs this plan, reviews results, and reports to the Authorizing Official |
| Network Administrator | Not supplied by the organisation (content gap): the Network Administrator (PI.PER.011). | Operates network and boundary monitoring and remediates findings |
| Incident Response Lead | Not supplied by the organisation (content gap): the Incident Response Lead (PI.PER.006). | Handles monitoring alerts that become security incidents |

## 5. Monitoring Activities

| Activity | Frequency | NIST SP 800-171 |
|----------|-----------|-----------------|
| Review of audit log alerts and security events | Continuous (automated), with a documented weekly review | 3.3.1, 3.3.5 |
| Vulnerability scanning of in-scope systems | Monthly | 3.11.2 |
| Remediation of critical vulnerabilities | Within 14 days | 3.11.3, 3.14.1 |
| Remediation of high vulnerabilities | Within 30 days | 3.11.3, 3.14.1 |
| Review of user accounts and access rights | Quarterly | 3.1.1 |
| Review of baseline configurations against the configuration management policy | At each approved change and at least annually | 3.4.1, 3.4.2 |
| Review of the system security plan and the plan of action and milestones | At least every 12 months | 3.12.2, 3.12.4 |
| Assessment of the security controls | At least every 12 months | 3.12.1 |

Audit records are retained for **365** days.

## 6. Monitoring Tools and Data Sources

- Security information and event management (SIEM): Microsoft Sentinel (s3-def-law-prod)
- Endpoint detection and response alerts from managed endpoints
- Vulnerability scan results
- Identity sign-in and audit logs

## 7. Reporting and Response

- The ISSO summarises monitoring results for the Authorizing Official at least monthly, and at once for a significant change in risk
- A suspected security incident is handled under the Incident Response Plan; reportable incidents are reported within **72** hours
- A control found not operating as intended is recorded on the plan of action and milestones with an owner and a due date, or accepted by the Authorizing Official as a documented risk

## 8. Review

This plan shall be reviewed every **12** months. Next scheduled review: **2027-11-01**.

---

**Effective Date:** 2026-11-01
**NIST SP 800-171 Controls:** 3.12.3 (with 3.3.1, 3.3.5, 3.11.2, 3.11.3, 3.12.1, 3.12.2, 3.12.4, 3.14.1)
**Plan Owner:** Belmira Pennanmore

## Approval

**Approved By:** Derwyn Arrowbrook, President (Authorizing Official)
**Signature:** ___________________________
**Date:** ___________________________
