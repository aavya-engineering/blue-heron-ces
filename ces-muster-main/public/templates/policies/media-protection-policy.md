# Media Protection Policy

## 1. Purpose

This policy establishes requirements for protecting media containing CUI within **{{org.legal_name}}** in accordance with NIST SP 800-171 Rev 2 (Family 3.8) and CMMC {{si.target_cmmc_level}} requirements.

## 2. Scope

This policy applies to all digital and physical media that contain, process, or are used to transmit CUI within the {{si.boundary_strategy}} boundary.

## 3. Roles and Responsibilities

| Role | Name | Responsibility |
|------|------|----------------|
| ISSO | {{personnel.isso.name}} | Define media protection standards |
| IT Director | {{personnel.it_director.name}} | Implement media controls and sanitization procedures |
{{#if personnel.facilities_manager}}
| Facilities Manager | {{personnel.facilities_manager.name}} | Secure physical media storage |
{{/if}}

## 4. Policy Statements

### 4.1 Media Protection (3.8.1, 3.8.2)

- CUI media shall be protected using physical and logical access controls
- Access to CUI media shall be restricted to authorized personnel
- Digital media containing CUI shall be encrypted using FIPS 140-2 validated cryptography

### 4.2 Media Marking (3.8.4)

- All media containing CUI shall be marked with appropriate CUI markings
- Markings shall follow DoD CUI marking guidelines

### 4.3 Media Transport (3.8.5, 3.8.6)

- CUI media in transit shall be physically protected (locked containers, secure shipping)
- Digital transport of CUI shall use encrypted channels (TLS 1.2+, encrypted email)
- CUI shall not be transmitted over unencrypted channels

### 4.4 Media Sanitization (3.8.3)

- Media shall be sanitized before disposal or reuse using **{{default odp.media_sanitization_standard "NIST SP 800-88"}}** guidelines
- Sanitization records shall be maintained for audit purposes
- Sanitization methods shall be appropriate to the media type and sensitivity

### 4.5 Media Storage (3.8.7, 3.8.8, 3.8.9)

- CUI media shall be stored in controlled areas
- Backup media shall be stored in a separate location from primary systems
- CUI on mobile devices shall be encrypted at rest

## 5. Review

This policy shall be reviewed every **{{governance.review_cycle_months}}** months. Next scheduled review: **{{governance.next_review_date}}**.

---

**Effective Date:** {{governance.policy_effective_date}}
**NIST SP 800-171 Controls:** 3.8.1–3.8.9
**Policy Owner:** {{personnel.isso.name}}
