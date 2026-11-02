# System and Communications Protection Policy

**SIMULATED CUSTOMER (FICTIONAL): Hollinford Precision Machining LLC (FICTIONAL)** This organisation is a simulated customer of the CES simulator. Its name, people, identifiers, addresses and tenant are invented; this document describes no real company and is not a compliance record.

## 1. Purpose

This policy establishes system and communications protection requirements for **Hollinford Precision Machining LLC (FICTIONAL)** in accordance with NIST SP 800-171 Rev 2 (Family 3.13) and CMMC L2 requirements.

## 2. Scope

This policy applies to all network communications and system boundaries within the single_enclave boundary, including cloud_only environments.

## 3. Roles and Responsibilities

| Role | Name | Responsibility |
|------|------|----------------|
| IT Director | Halric Brackvane | Implement network and communications protections |
| ISSO | Corvane Marrowholt | Define boundary protection requirements |
| System Owner | Alvane Ashenmere | Authorize network connections |

## 4. Policy Statements

### 4.1 Communications Boundary Protection (3.13.1, 3.13.2)

- Communications at the external boundary and key internal boundaries shall be monitored and controlled
- The CUI boundary (single_enclave) shall be clearly defined and enforced
- Subnetworks for publicly accessible system components shall be physically or logically separated
- CUI boundary definition has been documented through the CUI Boundary tool

### 4.2 Network Traffic Management (3.13.5, 3.13.6)

- Inbound and outbound network traffic shall be denied by default and allowed by exception
- Network traffic shall be monitored for anomalous behavior
- Network monitoring: Microsoft Sentinel (law-s1-mach-prod)

### 4.3 Encryption (3.13.8, 3.13.11)

- CUI shall be encrypted in transit using FIPS 140-2 validated cryptography (TLS 1.2+)
- CUI shall be encrypted at rest using FIPS 140-2 validated cryptography
- Cryptographic keys shall be managed in accordance with organizational key management procedures
- Tenant environment: **gcc_high** (cloud-managed encryption)

### 4.4 Information Flow Control (3.13.3, 3.13.4)

- Information flow enforcement mechanisms shall prevent CUI from moving outside the authorized boundary
- CUI data flows shall be documented and monitored
- DLP policy convention: **S1-DLP CUI in {Location}**
- Sensitivity labels: **{Classification}**

### 4.5 Collaborative Computing Restrictions (3.13.12, 3.13.13)

- Collaboration mode: **teams_first**
- Remote activation of collaborative computing devices shall be explicitly controlled
- CUI shall not be shared via unauthorized collaboration tools

### 4.6 Session Authenticity (3.13.9)

Communications sessions shall be authenticated to prevent hijacking or replay attacks.

### 4.7 Mobile Code (3.13.14)

Usage of mobile code (JavaScript, ActiveX, etc.) shall be controlled and monitored on CUI systems.

### 4.8 Voice over IP (3.13.15)

If VoIP is used for CUI discussions, it shall be protected with encryption and access controls.

### 4.9 DNS and Routing Protection (3.13.7, 3.13.10, 3.13.16)

- Split tunneling shall not be used for remote connections to CUI systems
- DNS shall be protected from manipulation
- Network routing shall be controlled to prevent unauthorized data flows

## 5. Review

This policy shall be reviewed every **12** months. Next scheduled review: **2027-11-01**.

---

**Effective Date:** 2026-11-02
**NIST SP 800-171 Controls:** 3.13.1–3.13.16
**Policy Owner:** Halric Brackvane

## Approval

**Approved By:** Alvane Ashenmere, President / Owner (Authorizing Official)
**Signature:** ___________________________
**Date:** ___________________________
