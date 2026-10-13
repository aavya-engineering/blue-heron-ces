# System Security Plan (SSP)

## 1. System Identification

| Field | Value |
|-------|-------|
| **System Name** | {{org.legal_name}} CUI Information System |
| **Organization** | {{org.legal_name}} |
| **Address** | {{org.address_full}} |
| **CAGE Code** | {{default org.cage_code "N/A"}} |
| **DUNS Number** | {{default org.duns_number "N/A"}} |
| **Organization Type** | {{org.org_type}} |
| **CMMC Target Level** | {{si.target_cmmc_level}} |
| **Assessment Route** | {{si.assessment_route}} |
| **Boundary Strategy** | {{si.boundary_strategy}} |
| **Deployment Posture** | {{si.deployment_posture}} |
| **SSP Date** | {{generated_on}} |

## 2. System Description

### 2.1 System Purpose

This System Security Plan describes the security controls implemented by **{{org.legal_name}}** to protect Controlled Unclassified Information (CUI) in accordance with NIST SP 800-171 Rev 2 and CMMC {{si.target_cmmc_level}} requirements.

### 2.2 CUI Categorization

- CUI Presence: **{{si.cui_presence}}**
{{#if si.cui_types.length}}
- CUI Types: {{join si.cui_types ", "}}
{{/if}}

### 2.3 System Boundary

The system operates within a **{{si.boundary_strategy}}** boundary using a **{{si.deployment_posture}}** deployment model.

{{#if tenant.has_tenant}}
### 2.4 Cloud Infrastructure

| Field | Value |
|-------|-------|
| Tenant ID | {{tenant.tenant_id}} |
| Primary Domain | {{tenant.primary_domain}} |
| Cloud Environment | {{tenant.cloud_environment}} |
| Primary SKU | {{tenant.primary_sku}} |
| Identity Provider | {{tenant.identity_provider}} |
| Device Enrollment | {{tenant.enrollment_type}} |
{{/if}}

{{#if si.external_service_providers.length}}
### 2.5 External Service Providers

| Provider | Service Type | FedRAMP Status |
|----------|-------------|----------------|
{{#each si.external_service_providers}}
| {{this.name}} | {{this.service_type}} | {{this.fedramp_posture}} |
{{/each}}
{{/if}}

### 2.6 System Users

- Estimated in-scope users: **{{si.in_scope_users}}**
- Estimated in-scope endpoints: **{{si.in_scope_endpoints}}**
- Collaboration mode: **{{si.collaboration_mode}}**
- BYOD posture: **{{si.byod_posture}}**

## 3. Key Personnel

| Role | Name | Title | Email |
|------|------|-------|-------|
{{#each personnel}}
| {{this.role_title}} | {{this.name}} | {{this.title}} | {{this.email}} |
{{/each}}

## 4. Security Controls

{{org.legal_name}} implements security controls across all 14 NIST SP 800-171 domains:

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

{{#if posture.has_posture}}
### 4.1 Current Compliance Status

| Status | Count | Percentage |
|--------|-------|-----------|
| Met | {{posture.met}} | {{posture.compliance_pct}}% |
| Partial | {{posture.partial}} | — |
| Not Met | {{posture.not_met}} | — |
| Unknown | {{posture.unknown}} | — |
| **Total** | **{{posture.total}}** | — |
{{/if}}

## 5. Organizational Defined Parameters (ODPs)

| Parameter | Value |
|-----------|-------|
| Account Lockout Threshold | {{default odp.account_lockout_threshold "3"}} attempts |
| Account Lockout Duration | {{default odp.account_lockout_duration_minutes "30"}} minutes |
| Session Timeout | {{default odp.session_timeout_minutes "15"}} minutes |
| Minimum Password Length | {{default odp.min_password_length "14"}} characters |
| Password History | {{default odp.password_history_count "24"}} passwords |
| Maximum Password Age | {{default odp.max_password_age_days "60"}} days |
| Audit Log Retention | {{default odp.audit_log_retention_days "365"}} days |
| Vulnerability Scan Frequency | {{default odp.vuln_scan_frequency "Monthly"}} |
| Critical Patch Timeline | {{default odp.critical_patch_timeline_days "14"}} days |
| High Patch Timeline | {{default odp.high_patch_timeline_days "30"}} days |
| Training Frequency | {{default odp.training_frequency "Annual"}} |
| Incident Reporting | {{default odp.incident_reporting_hours "1"}} hour(s) |
| Access Review Frequency | {{default odp.access_review_frequency "Quarterly"}} |
| Backup Frequency | {{default odp.backup_frequency "Daily"}} |
| Media Sanitization Standard | {{default odp.media_sanitization_standard "NIST SP 800-88"}} |

## 6. Physical Security

{{#if physical_security.has_physical}}
### Facility Locations
{{#each physical_security.facility_addresses}}
- {{this}}
{{/each}}

{{#if physical_security.access_control_system}}
- Access Control System: **{{physical_security.access_control_system}}**
{{/if}}
{{#if physical_security.visitor_management}}
- Visitor Management: **{{physical_security.visitor_management}}**
{{/if}}
{{else}}
Physical security controls are documented separately or managed by the facility provider.
{{/if}}

## 7. Governance

| Field | Value |
|-------|-------|
| Policy Effective Date | {{governance.policy_effective_date}} |
| Review Cycle | Every {{governance.review_cycle_months}} months |
| Next Review Date | {{governance.next_review_date}} |
| Affirming Official | {{si.affirming_official}} |
| POA&M Policy | {{si.poam_policy}} |

## 8. Risk Acceptance

- POA&M intent: **{{si.poam_policy}}**
- Evidence posture target: **{{si.evidence_posture}}**
- Assessment route: **{{si.assessment_route}}**

---

**Prepared by:** {{personnel.isso.name}}
**Date:** {{generated_on}}
