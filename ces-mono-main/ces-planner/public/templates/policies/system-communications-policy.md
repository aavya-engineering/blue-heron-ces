# System and Communications Protection Policy

## 1. Purpose

This policy establishes system and communications protection requirements for **{{org.legal_name}}** in accordance with NIST SP 800-171 Rev 2 (Family 3.13) and CMMC {{si.target_cmmc_level}} requirements.

## 2. Scope

This policy applies to all network communications and system boundaries within the {{si.boundary_strategy}} boundary, including {{si.deployment_posture}} environments.

## 3. Roles and Responsibilities

| Role | Name | Responsibility |
|------|------|----------------|
| IT Director | {{personnel.it_director.name}} | Implement network and communications protections |
| ISSO | {{personnel.isso.name}} | Define boundary protection requirements |
| System Owner | {{personnel.system_owner.name}} | Authorize network connections |

## 4. Policy Statements

### 4.1 Communications Boundary Protection (3.13.1, 3.13.2)

- Communications at the external boundary and key internal boundaries shall be monitored and controlled
- The CUI boundary ({{si.boundary_strategy}}) shall be clearly defined and enforced
- Subnetworks for publicly accessible system components shall be physically or logically separated
{{#if has_cui_boundary}}
- CUI boundary definition has been documented through the CUI Boundary tool
{{/if}}

### 4.2 Network Traffic Management (3.13.5, 3.13.6)

- Inbound and outbound network traffic shall be denied by default and allowed by exception
- Network traffic shall be monitored for anomalous behavior
{{#if tenant.sentinel_workspace}}
- Network monitoring: Microsoft Sentinel ({{tenant.sentinel_workspace}})
{{/if}}

### 4.3 Encryption (3.13.8, 3.13.11)

- CUI shall be encrypted in transit using FIPS 140-2 validated cryptography (TLS 1.2+)
- CUI shall be encrypted at rest using FIPS 140-2 validated cryptography
- Cryptographic keys shall be managed in accordance with organizational key management procedures
- Tenant environment: **{{tenant.cloud_environment}}** (cloud-managed encryption)

### 4.4 Information Flow Control (3.13.3, 3.13.4)

- Information flow enforcement mechanisms shall prevent CUI from moving outside the authorized boundary
- CUI data flows shall be documented and monitored
{{#if tenant.dlp_convention}}
- DLP policy convention: **{{tenant.dlp_convention}}**
{{/if}}
{{#if tenant.sensitivity_labels}}
- Sensitivity labels: **{{tenant.sensitivity_labels}}**
{{/if}}

### 4.5 Collaborative Computing Restrictions (3.13.12, 3.13.13)

- Collaboration mode: **{{si.collaboration_mode}}**
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

This policy shall be reviewed every **{{governance.review_cycle_months}}** months. Next scheduled review: **{{governance.next_review_date}}**.

---

**Effective Date:** {{governance.policy_effective_date}}
**NIST SP 800-171 Controls:** 3.13.1–3.13.16
**Policy Owner:** {{personnel.it_director.name}}
