# System and Information Integrity Policy

**SIMULATED CUSTOMER (FICTIONAL): Hollinford Precision Machining LLC (FICTIONAL)** This organisation is a simulated customer of the CES simulator. Its name, people, identifiers, addresses and tenant are invented; this document describes no real company and is not a compliance record.

## 1. Purpose

This policy establishes system and information integrity requirements for **Hollinford Precision Machining LLC (FICTIONAL)** in accordance with NIST SP 800-171 Rev 2 (Family 3.14) and CMMC L2 requirements.

## 2. Scope

This policy applies to all information systems within the single_enclave boundary.

## 3. Roles and Responsibilities

| Role | Name | Responsibility |
|------|------|----------------|
| IT Director | Halric Brackvane | Implement integrity controls and patch management |
| ISSO | Corvane Marrowholt | Monitor security alerts and advisories |
| System Owner | Alvane Ashenmere | Authorize system changes for flaw remediation |

## 4. Policy Statements

### 4.1 Flaw Remediation (3.14.1)

- Security flaws shall be identified, reported, and corrected in a timely manner
- Critical vulnerabilities: remediate within **14** days
- High vulnerabilities: remediate within **30** days
- Software updates and patches shall be tested before deployment where feasible

### 4.2 Malicious Code Protection (3.14.2)

- Malicious code protection shall be deployed at system entry points and workstations
- Anti-malware signatures shall be updated automatically
- Real-time scanning shall be enabled on all CUI systems
- Users shall not disable malicious code protection

### 4.3 Security Alert Monitoring (3.14.3)

- Security alerts, advisories, and directives shall be monitored from:
  - CISA (Cybersecurity and Infrastructure Security Agency)
  - Vendor security bulletins
  - Internal monitoring systems
- SIEM alerts: Microsoft Sentinel (law-s1-mach-prod)
- Data connectors: Azure Active Directory, Microsoft 365, Microsoft Defender for Endpoint, Microsoft Defender for Office 365, Azure Activity, Windows Security Events

### 4.4 System Monitoring (3.14.6, 3.14.7)

- Information systems shall be monitored for:
  - Unauthorized access attempts
  - Security-relevant configuration changes
  - Anomalous network traffic patterns
  - Indicators of compromise (IOCs)
- Monitoring activities shall be documented and alerts shall be investigated

### 4.5 Input Validation (3.14.5)

- System inputs shall be validated to prevent injection attacks and malformed data
- Input validation shall be applied at trust boundaries

### 4.6 Spam and Unsolicited Communications (3.14.4)

- Email and messaging systems shall implement spam filtering and malicious content detection
- Phishing protection mechanisms shall be enabled

## 5. Review

This policy shall be reviewed every **12** months. Next scheduled review: **2027-11-01**.

---

**Effective Date:** 2026-11-01
**NIST SP 800-171 Controls:** 3.14.1–3.14.7
**Policy Owner:** Halric Brackvane

## Approval

**Approved By:** Alvane Ashenmere, President / Owner (Authorizing Official)
**Signature:** ___________________________
**Date:** ___________________________
