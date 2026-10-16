# CMMC L2 Non-Stack & Excluded Controls — Evidence Gap Analysis

**Date:** 2026-04-16
**Tenant:** vfsgov-xtra
**Source:** Latest execution (2026-04-14), CES domain files, CMMC reference

## Purposego

For each Non-Stack (22) and Excluded (21) control, this document compares:
- **HAVE** — what Stamper currently generates as evidence
- **NEED** — what the CES domain files and CMMC assessor guidance expect
- **RECOMMENDATION** — best-practice suggestion to close any gap

Legend: ✅ = covered, ⚠️ = partial, ❌ = gap

---yes, build the integration

## NON-STACK Controls (22)

These are process, policy, or physical controls that cannot be fully automated. They require manual attestation, document uploads, or hybrid evidence (automated query + manual supplement).

### AT — Awareness and Training

#### AT.L2-3.2.1 — Ensure that managers, system administrators and users of organizational systems are made aware of the security risks associated with their activities and of the applicable policies, standards and procedures related to the security of those systems.

**HAVE:**
- **manual_gate** — Security Awareness Training Evidence Collection (manual_only)
  - get_command: no
  - evidence_commands: Write-Output placeholder only
- Evidence files: at.l2-3.2.1.training-evidence.json, at.l2-3.2.1.training-evidence.txt, at.l2-3.2.3.insider-threat.json

**NEED (per domain files):**
- ❗ **MUST HAVE** — EMX-TRAINING-001: Security awareness training completion report
  - Evidence that users complete required awareness training on a defined cadence.
  - Assessor expects: examine
  - Acceptable forms: Training LMS completion export; Attestation records; Remediation reminders excerpt
- ❗ **MUST HAVE** — EMX-TRAINING-002: Role-based training evidence
  - Evidence of additional training for privileged/technical roles.
  - Assessor expects: examine
  - Acceptable forms: Role-based training curriculum; Completion export; Role roster mapping

**RECOMMENDATION:**
- ❌ **Gap: No automatable evidence.** This control requires manual evidence upload.
- **Best Practice:** Replace `Write-Output` placeholder with structured JSON prompt that:
  1. Identifies the required EMX archetype(s)
  2. Lists specific artifacts the operator must upload (format, fields, examples)
  3. References the NIST control and assessor expectation
- Consider adding a GUI upload widget on the Evidence card for manual artifacts

---

#### AT.L2-3.2.2 — Ensure that personnel are trained to carry out their assigned information security- related duties and responsibilities.

**HAVE:**
- **manual_gate** — Security Awareness Training Evidence Collection (manual_only)
  - get_command: no
  - evidence_commands: Write-Output placeholder only
- Evidence files: at.l2-3.2.1.training-evidence.json, at.l2-3.2.1.training-evidence.txt, at.l2-3.2.3.insider-threat.json

**NEED (per domain files):**
- ❗ **MUST HAVE** — EMX-TRAINING-001: Security awareness training completion report
  - Evidence that users complete required awareness training on a defined cadence.
  - Assessor expects: examine
  - Acceptable forms: Training LMS completion export; Attestation records; Remediation reminders excerpt
- ❗ **MUST HAVE** — EMX-TRAINING-002: Role-based training evidence
  - Evidence of additional training for privileged/technical roles.
  - Assessor expects: examine
  - Acceptable forms: Role-based training curriculum; Completion export; Role roster mapping

**RECOMMENDATION:**
- ❌ **Gap: No automatable evidence.** This control requires manual evidence upload.
- **Best Practice:** Replace `Write-Output` placeholder with structured JSON prompt that:
  1. Identifies the required EMX archetype(s)
  2. Lists specific artifacts the operator must upload (format, fields, examples)
  3. References the NIST control and assessor expectation
- Consider adding a GUI upload widget on the Evidence card for manual artifacts

---

#### AT.L2-3.2.3 — Provide security awareness training on recognizing and reporting potential indicators of insider threat.

**HAVE:**
- **ipps** — Insider Threat Awareness Program Evidence
  - get_command: yes
  - evidence_commands: none
- Evidence files: at.l2-3.2.1.training-evidence.json, at.l2-3.2.1.training-evidence.txt, at.l2-3.2.3.insider-threat.json

**NEED (per domain files):**
- ❗ **MUST HAVE** — EMX-TRAINING-001: Security awareness training completion report
  - Evidence that users complete required awareness training on a defined cadence.
  - Assessor expects: examine
  - Acceptable forms: Training LMS completion export; Attestation records; Remediation reminders excerpt
- ❗ **MUST HAVE** — EMX-TRAINING-002: Role-based training evidence
  - Evidence of additional training for privileged/technical roles.
  - Assessor expects: examine
  - Acceptable forms: Role-based training curriculum; Completion export; Role roster mapping

**RECOMMENDATION:**
- ⚠️ **Gap: get_command exists but no evidence_command.** Copy/adapt the get_command into an `evidence_commands` array so the evidence collector captures live data.
- Suggested evidence_command:
  - `Get-InsiderRiskPolicy | ConvertTo-Json -Depth 5`

---

### AU — Audit and Accountability

#### AU.L2-3.3.6 — Provide audit record reduction and report generation to support on-demand analysis and reporting.

**HAVE:**
- **ipps** — Audit Reduction via Compliance Search
  - get_command: yes
  - evidence_commands: Get-ComplianceSearch
- Evidence files: au.l2-3.3.1.audit-enable.json, au.l2-3.3.1.audit-enable.txt, au.l2-3.3.1.audit-retention.json, au.l2-3.3.1.org-customization.json, au.l2-3.3.1.org-customization.txt, au.l2-3.3.2.signin-logs.json, au.l2-3.3.2.signin-logs.txt, au.l2-3.3.3.sentinel-connector.json, au.l2-3.3.5.audit-search.json, au.l2-3.3.5.audit-search.txt, au.l2-3.3.6.audit-reduction.json, au.l2-3.3.7.time-source.json, au.l2-3.3.7.time-source.txt, au.l2-3.3.8.audit-protect.json, au.l2-3.3.8.audit-protect.txt

**NEED (per domain files):**
- ❗ **MUST HAVE** — EMX-LOG-001: Audit logging policy
  - Policy specifying what events are logged, retention, review, and protection of logs.
  - Assessor expects: examine
  - Acceptable forms: Policy document; Logging standard document; Review cadence record
- ❗ **MUST HAVE** — EMX-LOG-002: Central log collection / SIEM ingestion proof
  - Evidence that relevant sources forward logs to a central repository/SIEM.
  - Assessor expects: examine, test
  - Acceptable forms: SIEM connector status screenshots; Log ingestion metrics export; Sample correlated event
- ○ Nice to have — EMX-LOG-003: Log retention configuration evidence
- ○ Nice to have — EMX-LOG-004: Security monitoring and alerting configuration
- ○ Nice to have — EMX-LOG-005: Time synchronization evidence

**RECOMMENDATION:**
- ✅ Has automated evidence collection. Verify output covers required EMX archetypes:
  - emx-log-001: Audit logging policy
  - emx-log-002: Central log collection / SIEM ingestion proof
- Consider adding EMX archetype ID to evidence file metadata for traceability

---

#### AU.L2-3.3.7 — Provide a system capability that compares and synchronizes internal system clocks with an authoritative source to generate time stamps for audit records.

**HAVE:**
- **mgraph** — Authoritative Time Source Verification (Platform Inherited)
  - get_command: yes
  - evidence_commands: (Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/organization').valu
- Evidence files: au.l2-3.3.1.audit-enable.json, au.l2-3.3.1.audit-enable.txt, au.l2-3.3.1.audit-retention.json, au.l2-3.3.1.org-customization.json, au.l2-3.3.1.org-customization.txt, au.l2-3.3.2.signin-logs.json, au.l2-3.3.2.signin-logs.txt, au.l2-3.3.3.sentinel-connector.json, au.l2-3.3.5.audit-search.json, au.l2-3.3.5.audit-search.txt, au.l2-3.3.6.audit-reduction.json, au.l2-3.3.7.time-source.json, au.l2-3.3.7.time-source.txt, au.l2-3.3.8.audit-protect.json, au.l2-3.3.8.audit-protect.txt

**NEED (per domain files):**
- ❗ **MUST HAVE** — EMX-LOG-001: Audit logging policy
  - Policy specifying what events are logged, retention, review, and protection of logs.
  - Assessor expects: examine
  - Acceptable forms: Policy document; Logging standard document; Review cadence record
- ❗ **MUST HAVE** — EMX-LOG-002: Central log collection / SIEM ingestion proof
  - Evidence that relevant sources forward logs to a central repository/SIEM.
  - Assessor expects: examine, test
  - Acceptable forms: SIEM connector status screenshots; Log ingestion metrics export; Sample correlated event
- ○ Nice to have — EMX-LOG-003: Log retention configuration evidence
- ○ Nice to have — EMX-LOG-004: Security monitoring and alerting configuration
- ○ Nice to have — EMX-LOG-005: Time synchronization evidence

**RECOMMENDATION:**
- ✅ Has automated evidence collection. Verify output covers required EMX archetypes:
  - emx-log-001: Audit logging policy
  - emx-log-002: Central log collection / SIEM ingestion proof
- Consider adding EMX archetype ID to evidence file metadata for traceability

---

### CM — Configuration Management

#### CM.L2-3.4.4 — Analyze the security impact of changes prior to implementation.

**HAVE:**
- **manual_gate** — Security Impact Analysis of Changes (Manual Process Gate) (manual_only)
  - get_command: no
  - evidence_commands: Get-MgAuditLogDirectoryAudit -Filter "category eq 'ApplicationManagement' or cat
- Evidence files: cm.l2-3.4.1.security-baseline.json, cm.l2-3.4.1.security-baseline.txt, cm.l2-3.4.2.asr-rules.json, cm.l2-3.4.2.asr-rules.txt, cm.l2-3.4.3.change-tracking.json, cm.l2-3.4.3.change-tracking.txt, cm.l2-3.4.4.impact-analysis.json, cm.l2-3.4.4.impact-analysis.txt, cm.l2-3.4.5.access-restrict.json, cm.l2-3.4.5.access-restrict.txt, cm.l2-3.4.6.least-functionality.json, cm.l2-3.4.6.least-functionality.txt, cm.l2-3.4.7.wdac.json, cm.l2-3.4.7.wdac.txt, cm.l2-3.4.8.detected-apps.json, cm.l2-3.4.8.detected-apps.txt, cm.l2-3.4.9.install-control.json, cm.l2-3.4.9.install-control.txt

**NEED (per domain files):**
- ❗ **MUST HAVE** — EMX-CONFIG-001: Configuration management policy and procedure
  - Policy and procedure governing baselines, changes, approvals, and documentation.
  - Assessor expects: examine, interview
  - Acceptable forms: Policy document; Procedure document; Change control standard
- ❗ **MUST HAVE** — EMX-CONFIG-002: Change ticket samples and approvals
  - Representative change records demonstrating review, approval, testing, and implementation.
  - Assessor expects: examine
  - Acceptable forms: Ticket exports (redacted); CAB minutes excerpt; Rollback plan sample
- ○ Nice to have — EMX-CONFIG-003: Approved baseline standards (system hardening)
- ○ Nice to have — EMX-CONFIG-004: POA&M tracking evidence

**RECOMMENDATION:**
- ✅ Has automated evidence collection. Verify output covers required EMX archetypes:
  - emx-config-001: Configuration management policy and procedure
  - emx-config-002: Change ticket samples and approvals
- Consider adding EMX archetype ID to evidence file metadata for traceability

---

#### CM.L2-3.4.8 — Apply deny-by-exception (blacklisting) policy to prevent the use of unauthorized software or deny-all, permit-by-exception (whitelisting) policy to allow the execution of authorized software.

**HAVE:**
- **mgraph** — Detected Applications Inventory Evidence via Intune
  - get_command: yes
  - evidence_commands: none
- Evidence files: cm.l2-3.4.1.security-baseline.json, cm.l2-3.4.1.security-baseline.txt, cm.l2-3.4.2.asr-rules.json, cm.l2-3.4.2.asr-rules.txt, cm.l2-3.4.3.change-tracking.json, cm.l2-3.4.3.change-tracking.txt, cm.l2-3.4.4.impact-analysis.json, cm.l2-3.4.4.impact-analysis.txt, cm.l2-3.4.5.access-restrict.json, cm.l2-3.4.5.access-restrict.txt, cm.l2-3.4.6.least-functionality.json, cm.l2-3.4.6.least-functionality.txt, cm.l2-3.4.7.wdac.json, cm.l2-3.4.7.wdac.txt, cm.l2-3.4.8.detected-apps.json, cm.l2-3.4.8.detected-apps.txt, cm.l2-3.4.9.install-control.json, cm.l2-3.4.9.install-control.txt

**NEED (per domain files):**
- ❗ **MUST HAVE** — EMX-CONFIG-001: Configuration management policy and procedure
  - Policy and procedure governing baselines, changes, approvals, and documentation.
  - Assessor expects: examine, interview
  - Acceptable forms: Policy document; Procedure document; Change control standard
- ❗ **MUST HAVE** — EMX-CONFIG-002: Change ticket samples and approvals
  - Representative change records demonstrating review, approval, testing, and implementation.
  - Assessor expects: examine
  - Acceptable forms: Ticket exports (redacted); CAB minutes excerpt; Rollback plan sample
- ○ Nice to have — EMX-CONFIG-003: Approved baseline standards (system hardening)
- ○ Nice to have — EMX-CONFIG-004: POA&M tracking evidence

**RECOMMENDATION:**
- ⚠️ **Gap: get_command exists but no evidence_command.** Copy/adapt the get_command into an `evidence_commands` array so the evidence collector captures live data.
- Suggested evidence_command:
  - `(Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/deviceManagement/detectedApps').value | ConvertTo-Json -Depth 5`

---

### IA — Identification and Authentication

#### IA.L2-3.5.8 — Prohibit password reuse for a specified number of generations.

**HAVE:**
- **mgraph** — Password Reuse Prevention Evidence
  - get_command: yes
  - evidence_commands: none
- Evidence files: ia.l2-3.5.1.user-identify.json, ia.l2-3.5.1.user-identify.txt, ia.l2-3.5.10.cert-auth.json, ia.l2-3.5.10.cert-auth.txt, ia.l2-3.5.11.branding.json, ia.l2-3.5.3.fido2-enable.json, ia.l2-3.5.3.fido2-enable.txt, ia.l2-3.5.3.mfa-authenticator.json, ia.l2-3.5.3.mfa-authenticator.txt, ia.l2-3.5.4.auth-strength.json, ia.l2-3.5.4.auth-strength.txt, ia.l2-3.5.5.disable-inactive.json, ia.l2-3.5.5.disable-inactive.txt, ia.l2-3.5.7.password-protection.json, ia.l2-3.5.7.password-protection.txt, ia.l2-3.5.8.password-reuse.json, ia.l2-3.5.8.password-reuse.txt, ia.l2-3.5.9.tap-config.json, ia.l2-3.5.9.tap-config.txt

**NEED (per domain files):**
- ❗ **MUST HAVE** — EMX-IAM-001: MFA enforcement evidence
  - Proof that MFA is required for in-scope identities per policy and configuration.
  - Assessor expects: examine, test
  - Acceptable forms: Conditional Access/MFA policy export; IdP policy screenshot; Sign-in logs showing MFA challenge
- ❗ **MUST HAVE** — EMX-IAM-006: Authentication policy and standards
  - Written standards describing password policy, MFA requirements, and session constraints.
  - Assessor expects: examine
  - Acceptable forms: Policy document; Standards document; Exception management procedure
- ○ Nice to have — EMX-IAM-007: Break-glass account controls evidence
- ○ Nice to have — EMX-IAM-003: Privileged role assignments report
- ○ Nice to have — EMX-IAM-002: Legacy authentication blocked evidence

**RECOMMENDATION:**
- ⚠️ **Gap: get_command exists but no evidence_command.** Copy/adapt the get_command into an `evidence_commands` array so the evidence collector captures live data.
- Suggested evidence_command:
  - `Get-MgDomain -DomainId '{primaryDomain}' | ConvertTo-Json -Depth 5`

---

#### IA.L2-3.5.10 — Store and transmit only cryptographically protected passwords.

**HAVE:**
- **mgraph** — Enable Certificate-Based Authentication Method
  - get_command: yes
  - evidence_commands: Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/policies/authenticat
- Evidence files: ia.l2-3.5.1.user-identify.json, ia.l2-3.5.1.user-identify.txt, ia.l2-3.5.10.cert-auth.json, ia.l2-3.5.10.cert-auth.txt, ia.l2-3.5.11.branding.json, ia.l2-3.5.3.fido2-enable.json, ia.l2-3.5.3.fido2-enable.txt, ia.l2-3.5.3.mfa-authenticator.json, ia.l2-3.5.3.mfa-authenticator.txt, ia.l2-3.5.4.auth-strength.json, ia.l2-3.5.4.auth-strength.txt, ia.l2-3.5.5.disable-inactive.json, ia.l2-3.5.5.disable-inactive.txt, ia.l2-3.5.7.password-protection.json, ia.l2-3.5.7.password-protection.txt, ia.l2-3.5.8.password-reuse.json, ia.l2-3.5.8.password-reuse.txt, ia.l2-3.5.9.tap-config.json, ia.l2-3.5.9.tap-config.txt

**NEED (per domain files):**
- ❗ **MUST HAVE** — EMX-IAM-001: MFA enforcement evidence
  - Proof that MFA is required for in-scope identities per policy and configuration.
  - Assessor expects: examine, test
  - Acceptable forms: Conditional Access/MFA policy export; IdP policy screenshot; Sign-in logs showing MFA challenge
- ❗ **MUST HAVE** — EMX-IAM-006: Authentication policy and standards
  - Written standards describing password policy, MFA requirements, and session constraints.
  - Assessor expects: examine
  - Acceptable forms: Policy document; Standards document; Exception management procedure
- ○ Nice to have — EMX-IAM-007: Break-glass account controls evidence
- ○ Nice to have — EMX-IAM-003: Privileged role assignments report
- ○ Nice to have — EMX-IAM-002: Legacy authentication blocked evidence

**RECOMMENDATION:**
- ✅ Has automated evidence collection. Verify output covers required EMX archetypes:
  - emx-iam-001: MFA enforcement evidence
  - emx-iam-006: Authentication policy and standards
- Consider adding EMX archetype ID to evidence file metadata for traceability

---

#### IA.L2-3.5.11 — Obscure feedback of authentication information.

**HAVE:**
- **mgraph** — Login Page Branding Evidence (Password Obscured by Platform)
  - get_command: yes
  - evidence_commands: none
- Evidence files: ia.l2-3.5.1.user-identify.json, ia.l2-3.5.1.user-identify.txt, ia.l2-3.5.10.cert-auth.json, ia.l2-3.5.10.cert-auth.txt, ia.l2-3.5.11.branding.json, ia.l2-3.5.3.fido2-enable.json, ia.l2-3.5.3.fido2-enable.txt, ia.l2-3.5.3.mfa-authenticator.json, ia.l2-3.5.3.mfa-authenticator.txt, ia.l2-3.5.4.auth-strength.json, ia.l2-3.5.4.auth-strength.txt, ia.l2-3.5.5.disable-inactive.json, ia.l2-3.5.5.disable-inactive.txt, ia.l2-3.5.7.password-protection.json, ia.l2-3.5.7.password-protection.txt, ia.l2-3.5.8.password-reuse.json, ia.l2-3.5.8.password-reuse.txt, ia.l2-3.5.9.tap-config.json, ia.l2-3.5.9.tap-config.txt

**NEED (per domain files):**
- ❗ **MUST HAVE** — EMX-IAM-001: MFA enforcement evidence
  - Proof that MFA is required for in-scope identities per policy and configuration.
  - Assessor expects: examine, test
  - Acceptable forms: Conditional Access/MFA policy export; IdP policy screenshot; Sign-in logs showing MFA challenge
- ❗ **MUST HAVE** — EMX-IAM-006: Authentication policy and standards
  - Written standards describing password policy, MFA requirements, and session constraints.
  - Assessor expects: examine
  - Acceptable forms: Policy document; Standards document; Exception management procedure
- ○ Nice to have — EMX-IAM-007: Break-glass account controls evidence
- ○ Nice to have — EMX-IAM-003: Privileged role assignments report
- ○ Nice to have — EMX-IAM-002: Legacy authentication blocked evidence

**RECOMMENDATION:**
- ⚠️ **Gap: get_command exists but no evidence_command.** Copy/adapt the get_command into an `evidence_commands` array so the evidence collector captures live data.
- Suggested evidence_command:
  - `Get-MgOrganizationBranding -OrganizationId '{tenantId}' | ConvertTo-Json -Depth 5`

---

### IR — Incident Response

#### IR.L2-3.6.3 — Test the organizational incident response capability.

**HAVE:**
- **mgraph** — Launch Attack Simulation for Incident Response Testing
  - get_command: yes
  - evidence_commands: none
- Evidence files: ir.l2-3.6.1.atp-enable.json, ir.l2-3.6.1.atp-enable.txt, ir.l2-3.6.1.malware-filter.json, ir.l2-3.6.1.malware-filter.txt, ir.l2-3.6.2.incident-track.json, ir.l2-3.6.3.attack-sim.json, ir.l2-3.6.3.attack-sim.txt

**NEED (per domain files):**
- ❗ **MUST HAVE** — EMX-IR-001: Incident response plan and procedures
  - Documented incident response plan with roles, communications, and escalation paths.
  - Assessor expects: examine, interview
  - Acceptable forms: IR plan document; Runbook excerpts; Contact list / escalation roster
- ❗ **MUST HAVE** — EMX-IR-002: Incident response tabletop exercise evidence
  - Records of tabletop exercises with lessons learned and tracked actions.
  - Assessor expects: examine, interview
  - Acceptable forms: Tabletop agenda; Attendance record; After-action report
- ○ Nice to have — EMX-IR-003: Incident ticket samples

**RECOMMENDATION:**
- ⚠️ **Gap: get_command exists but no evidence_command.** Copy/adapt the get_command into an `evidence_commands` array so the evidence collector captures live data.
- Suggested evidence_command:
  - `(Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/security/alerts_v2?$top=5&$orderby=createdDateTime desc').v | ConvertTo-Json -Depth 5`

---

### MA — Maintenance

#### MA.L2-3.7.1 — Perform maintenance on organizational systems.

**HAVE:**
- **mgraph** — Deploy Windows Update for Business Ring via Intune
  - get_command: yes
  - evidence_commands: none
- Evidence files: ma.l2-3.7.1.update-ring.json, ma.l2-3.7.1.update-ring.txt, ma.l2-3.7.3.offsite-sanitize.json, ma.l2-3.7.3.offsite-sanitize.txt, ma.l2-3.7.4.media-check.json, ma.l2-3.7.4.media-check.txt, ma.l2-3.7.5.remote-mfa.json, ma.l2-3.7.5.remote-mfa.txt, ma.l2-3.7.6.supervised.json, ma.l2-3.7.6.supervised.txt

**NEED (per domain files):**
- ❗ **MUST HAVE** — EMX-CONFIG-004: POA&M tracking evidence
  - Evidence of POA&M process and tracking for identified gaps.
  - Assessor expects: examine
  - Acceptable forms: POA&M register export; Remediation plan samples; Closure evidence
- ❗ **MUST HAVE** — EMX-ENDPOINT-006: Removable media control enforcement
  - Evidence that removable media use is controlled per policy.
  - Assessor expects: examine, test
  - Acceptable forms: Device control policy export; Audit log of blocked USB events; Policy document
- ○ Nice to have — EMX-ENDPOINT-001: Device management enrollment report

**RECOMMENDATION:**
- ⚠️ **Gap: get_command exists but no evidence_command.** Copy/adapt the get_command into an `evidence_commands` array so the evidence collector captures live data.
- Suggested evidence_command:
  - `(Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/deviceManagement/deviceConfigurations').value | ConvertTo-Json -Depth 5`

---

#### MA.L2-3.7.2 — Provide controls on the tools, techniques, mechanisms, and personnel used to conduct system maintenance.

**HAVE:**
- **mgraph** — Deploy Windows Update for Business Ring via Intune
  - get_command: yes
  - evidence_commands: none
- Evidence files: ma.l2-3.7.1.update-ring.json, ma.l2-3.7.1.update-ring.txt, ma.l2-3.7.3.offsite-sanitize.json, ma.l2-3.7.3.offsite-sanitize.txt, ma.l2-3.7.4.media-check.json, ma.l2-3.7.4.media-check.txt, ma.l2-3.7.5.remote-mfa.json, ma.l2-3.7.5.remote-mfa.txt, ma.l2-3.7.6.supervised.json, ma.l2-3.7.6.supervised.txt

**NEED (per domain files):**
- ❗ **MUST HAVE** — EMX-CONFIG-004: POA&M tracking evidence
  - Evidence of POA&M process and tracking for identified gaps.
  - Assessor expects: examine
  - Acceptable forms: POA&M register export; Remediation plan samples; Closure evidence
- ❗ **MUST HAVE** — EMX-ENDPOINT-006: Removable media control enforcement
  - Evidence that removable media use is controlled per policy.
  - Assessor expects: examine, test
  - Acceptable forms: Device control policy export; Audit log of blocked USB events; Policy document
- ○ Nice to have — EMX-ENDPOINT-001: Device management enrollment report

**RECOMMENDATION:**
- ⚠️ **Gap: get_command exists but no evidence_command.** Copy/adapt the get_command into an `evidence_commands` array so the evidence collector captures live data.
- Suggested evidence_command:
  - `(Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/deviceManagement/deviceConfigurations').value | ConvertTo-Json -Depth 5`

---

#### MA.L2-3.7.3 — Ensure equipment removed for off-site maintenance is sanitized of any CUI.

**HAVE:**
- **manual_gate** — Sanitize Equipment Removed for Off-Site Maintenance (manual_only)
  - get_command: no
  - evidence_commands: Write-Output placeholder only
- Evidence files: ma.l2-3.7.1.update-ring.json, ma.l2-3.7.1.update-ring.txt, ma.l2-3.7.3.offsite-sanitize.json, ma.l2-3.7.3.offsite-sanitize.txt, ma.l2-3.7.4.media-check.json, ma.l2-3.7.4.media-check.txt, ma.l2-3.7.5.remote-mfa.json, ma.l2-3.7.5.remote-mfa.txt, ma.l2-3.7.6.supervised.json, ma.l2-3.7.6.supervised.txt

**NEED (per domain files):**
- ❗ **MUST HAVE** — EMX-CONFIG-004: POA&M tracking evidence
  - Evidence of POA&M process and tracking for identified gaps.
  - Assessor expects: examine
  - Acceptable forms: POA&M register export; Remediation plan samples; Closure evidence
- ❗ **MUST HAVE** — EMX-ENDPOINT-006: Removable media control enforcement
  - Evidence that removable media use is controlled per policy.
  - Assessor expects: examine, test
  - Acceptable forms: Device control policy export; Audit log of blocked USB events; Policy document
- ○ Nice to have — EMX-ENDPOINT-001: Device management enrollment report

**RECOMMENDATION:**
- ❌ **Gap: No automatable evidence.** This control requires manual evidence upload.
- **Best Practice:** Replace `Write-Output` placeholder with structured JSON prompt that:
  1. Identifies the required EMX archetype(s)
  2. Lists specific artifacts the operator must upload (format, fields, examples)
  3. References the NIST control and assessor expectation
- Consider adding a GUI upload widget on the Evidence card for manual artifacts

---

#### MA.L2-3.7.6 — Supervise the maintenance activities of personnel without required access authorization.

**HAVE:**
- **manual_gate** — Supervised Maintenance by Authorized Personnel (Manual Gate) (manual_only)
  - get_command: no
  - evidence_commands: Get-MgAuditLogSignIn -Filter "appDisplayName eq 'Azure Bastion' or appDisplayNam
- Evidence files: ma.l2-3.7.1.update-ring.json, ma.l2-3.7.1.update-ring.txt, ma.l2-3.7.3.offsite-sanitize.json, ma.l2-3.7.3.offsite-sanitize.txt, ma.l2-3.7.4.media-check.json, ma.l2-3.7.4.media-check.txt, ma.l2-3.7.5.remote-mfa.json, ma.l2-3.7.5.remote-mfa.txt, ma.l2-3.7.6.supervised.json, ma.l2-3.7.6.supervised.txt

**NEED (per domain files):**
- ❗ **MUST HAVE** — EMX-CONFIG-004: POA&M tracking evidence
  - Evidence of POA&M process and tracking for identified gaps.
  - Assessor expects: examine
  - Acceptable forms: POA&M register export; Remediation plan samples; Closure evidence
- ❗ **MUST HAVE** — EMX-ENDPOINT-006: Removable media control enforcement
  - Evidence that removable media use is controlled per policy.
  - Assessor expects: examine, test
  - Acceptable forms: Device control policy export; Audit log of blocked USB events; Policy document
- ○ Nice to have — EMX-ENDPOINT-001: Device management enrollment report

**RECOMMENDATION:**
- ✅ Has automated evidence collection. Verify output covers required EMX archetypes:
  - emx-config-004: POA&M tracking evidence
  - emx-endpoint-006: Removable media control enforcement
- Consider adding EMX archetype ID to evidence file metadata for traceability

---

### PS — Personnel Security

#### PS.L2-3.9.1 — Screen individuals prior to authorizing access to organizational systems containing CUI.

**HAVE:**
- **manual_gate** — Personnel Background Screening Process (Manual Gate) (manual_only)
  - get_command: no
  - evidence_commands: Get-MgAuditLogDirectoryAudit -Filter "category eq 'UserManagement' and activityD
- Evidence files: ps.l2-3.9.1.screening.json, ps.l2-3.9.1.screening.txt, ps.l2-3.9.2.termination.json, ps.l2-3.9.2.termination.txt

**NEED (per domain files):**
- ❗ **MUST HAVE** — EMX-IAM-004: Joiner-mover-leaver (JML) procedure and samples
  - Documented account lifecycle process with sample tickets/records.
  - Assessor expects: examine, interview
  - Acceptable forms: Procedure document; HR/IT tickets samples (redacted); Access removal evidence
- ❗ **MUST HAVE** — EMX-TRAINING-001: Security awareness training completion report
  - Evidence that users complete required awareness training on a defined cadence.
  - Assessor expects: examine
  - Acceptable forms: Training LMS completion export; Attestation records; Remediation reminders excerpt
- ○ Nice to have — EMX-SUPPLIER-001: Third-party access inventory

**RECOMMENDATION:**
- ✅ Has automated evidence collection. Verify output covers required EMX archetypes:
  - emx-iam-004: Joiner-mover-leaver (JML) procedure and samples
  - emx-training-001: Security awareness training completion report
- Consider adding EMX archetype ID to evidence file metadata for traceability

---

#### PS.L2-3.9.2 — Ensure that organizational systems containing CUI are protected during and after personnel actions such as terminations and transfers.

**HAVE:**
- **mgraph** — Personnel Termination and Transfer Account Disable Evidence
  - get_command: yes
  - evidence_commands: Get-MgAuditLogDirectoryAudit -Filter "category eq 'UserManagement' and activityD
- Evidence files: ps.l2-3.9.1.screening.json, ps.l2-3.9.1.screening.txt, ps.l2-3.9.2.termination.json, ps.l2-3.9.2.termination.txt

**NEED (per domain files):**
- ❗ **MUST HAVE** — EMX-IAM-004: Joiner-mover-leaver (JML) procedure and samples
  - Documented account lifecycle process with sample tickets/records.
  - Assessor expects: examine, interview
  - Acceptable forms: Procedure document; HR/IT tickets samples (redacted); Access removal evidence
- ❗ **MUST HAVE** — EMX-TRAINING-001: Security awareness training completion report
  - Evidence that users complete required awareness training on a defined cadence.
  - Assessor expects: examine
  - Acceptable forms: Training LMS completion export; Attestation records; Remediation reminders excerpt
- ○ Nice to have — EMX-SUPPLIER-001: Third-party access inventory

**RECOMMENDATION:**
- ✅ Has automated evidence collection. Verify output covers required EMX archetypes:
  - emx-iam-004: Joiner-mover-leaver (JML) procedure and samples
  - emx-training-001: Security awareness training completion report
- Consider adding EMX archetype ID to evidence file metadata for traceability

---

### RA — Risk Assessment

#### RA.L2-3.11.1 — Periodically assess the risk to organizational operations (including mission, functions, image or reputation), organizational assets and individuals, resulting from the operation of organizational systems and the associated processing, storage or transmission of CUI.

**HAVE:**
- **mgraph** — Microsoft Secure Score Risk Assessment Evidence
  - get_command: yes
  - evidence_commands: none
- Evidence files: ra.l2-3.11.1.secure-score.json, ra.l2-3.11.1.secure-score.txt, ra.l2-3.11.2.vuln-scan.json, ra.l2-3.11.2.vuln-scan.txt, ra.l2-3.11.3.vuln-remediation.json, ra.l2-3.11.3.vuln-remediation.txt

**NEED (per domain files):**
- ❗ **MUST HAVE** — EMX-RISK-001: Risk register and risk acceptance records
  - Risk register showing identified risks, owners, decisions, and acceptance approvals.
  - Assessor expects: examine, interview
  - Acceptable forms: Risk register export; Risk acceptance memo samples; Review meeting notes excerpt
- ❗ **MUST HAVE** — EMX-RISK-002: System Security Plan (SSP) completeness evidence
  - Evidence SSP exists, reflects current boundary, and is maintained.
  - Assessor expects: examine, interview
  - Acceptable forms: SSP document; SSP update log; Approval record
- ○ Nice to have — EMX-VULN-001: Vulnerability scanning evidence
- ○ Nice to have — EMX-VULN-002: Vulnerability remediation tracking

**RECOMMENDATION:**
- ⚠️ **Gap: get_command exists but no evidence_command.** Copy/adapt the get_command into an `evidence_commands` array so the evidence collector captures live data.
- Suggested evidence_command:
  - `(Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/security/secureScores').value | ConvertTo-Json -Depth 5`

---

#### RA.L2-3.11.2 — Scan for vulnerabilities in organizational systems and applications periodically and when new vulnerabilities affecting those systems and applications are identified.

**HAVE:**
- **mgraph** — Vulnerability Scan Results Evidence via Defender
  - get_command: yes
  - evidence_commands: none
- Evidence files: ra.l2-3.11.1.secure-score.json, ra.l2-3.11.1.secure-score.txt, ra.l2-3.11.2.vuln-scan.json, ra.l2-3.11.2.vuln-scan.txt, ra.l2-3.11.3.vuln-remediation.json, ra.l2-3.11.3.vuln-remediation.txt

**NEED (per domain files):**
- ❗ **MUST HAVE** — EMX-RISK-001: Risk register and risk acceptance records
  - Risk register showing identified risks, owners, decisions, and acceptance approvals.
  - Assessor expects: examine, interview
  - Acceptable forms: Risk register export; Risk acceptance memo samples; Review meeting notes excerpt
- ❗ **MUST HAVE** — EMX-RISK-002: System Security Plan (SSP) completeness evidence
  - Evidence SSP exists, reflects current boundary, and is maintained.
  - Assessor expects: examine, interview
  - Acceptable forms: SSP document; SSP update log; Approval record
- ○ Nice to have — EMX-VULN-001: Vulnerability scanning evidence
- ○ Nice to have — EMX-VULN-002: Vulnerability remediation tracking

**RECOMMENDATION:**
- ⚠️ **Gap: get_command exists but no evidence_command.** Copy/adapt the get_command into an `evidence_commands` array so the evidence collector captures live data.
- Suggested evidence_command:
  - `(Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/deviceManagement/managedDevices?$select=deviceName,complian | ConvertTo-Json -Depth 5`

---

#### RA.L2-3.11.3 — Remediate vulnerabilities in accordance with risk assessments.

**HAVE:**
- **mgraph** — Vulnerability Remediation via Windows Update for Business Rings
  - get_command: yes
  - evidence_commands: Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/deviceManagement/dev
- Evidence files: ra.l2-3.11.1.secure-score.json, ra.l2-3.11.1.secure-score.txt, ra.l2-3.11.2.vuln-scan.json, ra.l2-3.11.2.vuln-scan.txt, ra.l2-3.11.3.vuln-remediation.json, ra.l2-3.11.3.vuln-remediation.txt

**NEED (per domain files):**
- ❗ **MUST HAVE** — EMX-RISK-001: Risk register and risk acceptance records
  - Risk register showing identified risks, owners, decisions, and acceptance approvals.
  - Assessor expects: examine, interview
  - Acceptable forms: Risk register export; Risk acceptance memo samples; Review meeting notes excerpt
- ❗ **MUST HAVE** — EMX-RISK-002: System Security Plan (SSP) completeness evidence
  - Evidence SSP exists, reflects current boundary, and is maintained.
  - Assessor expects: examine, interview
  - Acceptable forms: SSP document; SSP update log; Approval record
- ○ Nice to have — EMX-VULN-001: Vulnerability scanning evidence
- ○ Nice to have — EMX-VULN-002: Vulnerability remediation tracking

**RECOMMENDATION:**
- ✅ Has automated evidence collection. Verify output covers required EMX archetypes:
  - emx-risk-001: Risk register and risk acceptance records
  - emx-risk-002: System Security Plan (SSP) completeness evidence
- Consider adding EMX archetype ID to evidence file metadata for traceability

---

### CA — Security Assessment

#### CA.L2-3.12.2 — Develop and implement plans of action (e.g., POA&M) designed to correct deficiencies and reduce or eliminate vulnerabilities in organizational systems.

**HAVE:**
- **mgraph** — POA&M Improvement Actions Evidence via Compliance Manager
  - get_command: yes
  - evidence_commands: (Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/security/secureScor
- Evidence files: ca.l2-3.12.1.compliance-assess.json, ca.l2-3.12.1.compliance-assess.txt, ca.l2-3.12.2.poam.json, ca.l2-3.12.2.poam.txt, ca.l2-3.12.4.ssp.json, ca.l2-3.12.4.ssp.txt

**NEED (per domain files):**
- ❗ **MUST HAVE** — EMX-RISK-001: Risk register and risk acceptance records
  - Risk register showing identified risks, owners, decisions, and acceptance approvals.
  - Assessor expects: examine, interview
  - Acceptable forms: Risk register export; Risk acceptance memo samples; Review meeting notes excerpt
- ❗ **MUST HAVE** — EMX-RISK-002: System Security Plan (SSP) completeness evidence
  - Evidence SSP exists, reflects current boundary, and is maintained.
  - Assessor expects: examine, interview
  - Acceptable forms: SSP document; SSP update log; Approval record
- ○ Nice to have — EMX-LOG-003: Log retention configuration evidence
- ○ Nice to have — EMX-BOUNDARY-001: Assessment boundary statement

**RECOMMENDATION:**
- ✅ Has automated evidence collection. Verify output covers required EMX archetypes:
  - emx-risk-001: Risk register and risk acceptance records
  - emx-risk-002: System Security Plan (SSP) completeness evidence
- Consider adding EMX archetype ID to evidence file metadata for traceability

---

#### CA.L2-3.12.4 — Develop, document and periodically update System Security Plans (SSPs) that describe system boundaries, system environments of operation, how security requirements are implemented and the relationships with or connections to other systems.

**HAVE:**
- **manual_gate** — System Security Plan Documentation (Manual Gate) (manual_only)
  - get_command: no
  - evidence_commands: Write-Output placeholder only
- Evidence files: ca.l2-3.12.1.compliance-assess.json, ca.l2-3.12.1.compliance-assess.txt, ca.l2-3.12.2.poam.json, ca.l2-3.12.2.poam.txt, ca.l2-3.12.4.ssp.json, ca.l2-3.12.4.ssp.txt

**NEED (per domain files):**
- ❗ **MUST HAVE** — EMX-RISK-001: Risk register and risk acceptance records
  - Risk register showing identified risks, owners, decisions, and acceptance approvals.
  - Assessor expects: examine, interview
  - Acceptable forms: Risk register export; Risk acceptance memo samples; Review meeting notes excerpt
- ❗ **MUST HAVE** — EMX-RISK-002: System Security Plan (SSP) completeness evidence
  - Evidence SSP exists, reflects current boundary, and is maintained.
  - Assessor expects: examine, interview
  - Acceptable forms: SSP document; SSP update log; Approval record
- ○ Nice to have — EMX-LOG-003: Log retention configuration evidence
- ○ Nice to have — EMX-BOUNDARY-001: Assessment boundary statement

**RECOMMENDATION:**
- ❌ **Gap: No automatable evidence.** This control requires manual evidence upload.
- **Best Practice:** Replace `Write-Output` placeholder with structured JSON prompt that:
  1. Identifies the required EMX archetype(s)
  2. Lists specific artifacts the operator must upload (format, fields, examples)
  3. References the NIST control and assessor expectation
- Consider adding a GUI upload widget on the Evidence card for manual artifacts

---

## EXCLUDED Controls (21)

These controls are out of scope per the Strategic Intent baseline. Each still needs a documented justification that an assessor will review. The question is: does Stamper capture the exclusion rationale in a form the assessor can consume?

### AC — Access Control

#### AC.L2-3.1.6 — Use non-privileged accounts or roles when accessing non-security functions.

**HAVE:**
- Exclusion justification: "Removable media prohibited by policy and technical control per Strategic Intent baseline"
  - SI field: removable_media_posture = blocked
- Registry entries still present: Create Dedicated Admin Account

**NEED:**
- Documented exclusion rationale traceable to Strategic Intent baseline
- Assessor-consumable artifact (not just internal JSON metadata)
- Justification anchored to SI field: `removable_media_posture` = `blocked`

**RECOMMENDATION:**
- ✅ Exclusion rationale is documented in Mission Plan
- **Best Practice:** Generate a formal "Scope Exclusion Statement" evidence artifact per control that includes:
  1. Control ID and practice text
  2. Exclusion justification: "Removable media prohibited by policy and technical control per Strategic Intent baseline"
  3. SI baseline reference: removable_media_posture = blocked
  4. Compensating controls (if any)
  5. Approval authority and date
- This can be auto-generated from the Mission Plan data and exported as a PDF/JSON artifact

---

#### AC.L2-3.1.10 — Use session lock with pattern-hiding displays to prevent access and viewing of data after a period of inactivity.

**HAVE:**
- Exclusion justification: "CUI accessible via browser only with endpoint downloads blocked per Strategic Intent baseline"
  - SI field: cui_endpoint_posture = browser_only
- Registry entries still present: Deploy Screen Lock / Session Timeout Intune Policy

**NEED:**
- Documented exclusion rationale traceable to Strategic Intent baseline
- Assessor-consumable artifact (not just internal JSON metadata)
- Justification anchored to SI field: `cui_endpoint_posture` = `browser_only`

**RECOMMENDATION:**
- ✅ Exclusion rationale is documented in Mission Plan
- **Best Practice:** Generate a formal "Scope Exclusion Statement" evidence artifact per control that includes:
  1. Control ID and practice text
  2. Exclusion justification: "CUI accessible via browser only with endpoint downloads blocked per Strategic Intent baseline"
  3. SI baseline reference: cui_endpoint_posture = browser_only
  4. Compensating controls (if any)
  5. Approval authority and date
- This can be auto-generated from the Mission Plan data and exported as a PDF/JSON artifact

---

#### AC.L2-3.1.12 — Monitor and control remote access sessions.

**HAVE:**
- Exclusion justification: "No remote access to CUI systems per Strategic Intent baseline"
  - SI field: remote_access_posture = no_remote
- Registry entries still present: Create Approved CUI Named Location (IP Range)

**NEED:**
- Documented exclusion rationale traceable to Strategic Intent baseline
- Assessor-consumable artifact (not just internal JSON metadata)
- Justification anchored to SI field: `remote_access_posture` = `no_remote`

**RECOMMENDATION:**
- ✅ Exclusion rationale is documented in Mission Plan
- **Best Practice:** Generate a formal "Scope Exclusion Statement" evidence artifact per control that includes:
  1. Control ID and practice text
  2. Exclusion justification: "No remote access to CUI systems per Strategic Intent baseline"
  3. SI baseline reference: remote_access_posture = no_remote
  4. Compensating controls (if any)
  5. Approval authority and date
- This can be auto-generated from the Mission Plan data and exported as a PDF/JSON artifact

---

#### AC.L2-3.1.13 — Employ cryptographic mechanisms to protect the confidentiality of remote access sessions.

**HAVE:**
- Exclusion justification: "No remote access to CUI systems per Strategic Intent baseline"
  - SI field: remote_access_posture = no_remote
- Registry entries still present: Disable Legacy TLS Client Connections in Exchange Transport

**NEED:**
- Documented exclusion rationale traceable to Strategic Intent baseline
- Assessor-consumable artifact (not just internal JSON metadata)
- Justification anchored to SI field: `remote_access_posture` = `no_remote`

**RECOMMENDATION:**
- ✅ Exclusion rationale is documented in Mission Plan
- **Best Practice:** Generate a formal "Scope Exclusion Statement" evidence artifact per control that includes:
  1. Control ID and practice text
  2. Exclusion justification: "No remote access to CUI systems per Strategic Intent baseline"
  3. SI baseline reference: remote_access_posture = no_remote
  4. Compensating controls (if any)
  5. Approval authority and date
- This can be auto-generated from the Mission Plan data and exported as a PDF/JSON artifact

---

#### AC.L2-3.1.14 — Route remote access via managed access control points.

**HAVE:**
- Exclusion justification: "No wireless networks in CUI enclave per Strategic Intent baseline"
  - SI field: wireless_posture = no_wireless
- Registry entries still present: Conditional Access - Block Untrusted Network Locations

**NEED:**
- Documented exclusion rationale traceable to Strategic Intent baseline
- Assessor-consumable artifact (not just internal JSON metadata)
- Justification anchored to SI field: `wireless_posture` = `no_wireless`

**RECOMMENDATION:**
- ✅ Exclusion rationale is documented in Mission Plan
- **Best Practice:** Generate a formal "Scope Exclusion Statement" evidence artifact per control that includes:
  1. Control ID and practice text
  2. Exclusion justification: "No wireless networks in CUI enclave per Strategic Intent baseline"
  3. SI baseline reference: wireless_posture = no_wireless
  4. Compensating controls (if any)
  5. Approval authority and date
- This can be auto-generated from the Mission Plan data and exported as a PDF/JSON artifact

---

#### AC.L2-3.1.16 — Authorize wireless access prior to allowing such connections.

**HAVE:**
- Exclusion justification: "No wireless networks in CUI enclave per Strategic Intent baseline"
  - SI field: wireless_posture = no_wireless
- Registry entries still present: Deploy WPA2-Enterprise WiFi Profile via Intune

**NEED:**
- Documented exclusion rationale traceable to Strategic Intent baseline
- Assessor-consumable artifact (not just internal JSON metadata)
- Justification anchored to SI field: `wireless_posture` = `no_wireless`

**RECOMMENDATION:**
- ✅ Exclusion rationale is documented in Mission Plan
- **Best Practice:** Generate a formal "Scope Exclusion Statement" evidence artifact per control that includes:
  1. Control ID and practice text
  2. Exclusion justification: "No wireless networks in CUI enclave per Strategic Intent baseline"
  3. SI baseline reference: wireless_posture = no_wireless
  4. Compensating controls (if any)
  5. Approval authority and date
- This can be auto-generated from the Mission Plan data and exported as a PDF/JSON artifact

---

#### AC.L2-3.1.17 — Protect wireless access using authentication and encryption.

**HAVE:**
- Exclusion justification: "Removable media prohibited by policy and technical control per Strategic Intent baseline"
  - SI field: removable_media_posture = blocked
- Registry entries still present: Verify Intune Wi-Fi Configuration Profiles Enforce WPA2/3

**NEED:**
- Documented exclusion rationale traceable to Strategic Intent baseline
- Assessor-consumable artifact (not just internal JSON metadata)
- Justification anchored to SI field: `removable_media_posture` = `blocked`

**RECOMMENDATION:**
- ✅ Exclusion rationale is documented in Mission Plan
- **Best Practice:** Generate a formal "Scope Exclusion Statement" evidence artifact per control that includes:
  1. Control ID and practice text
  2. Exclusion justification: "Removable media prohibited by policy and technical control per Strategic Intent baseline"
  3. SI baseline reference: removable_media_posture = blocked
  4. Compensating controls (if any)
  5. Approval authority and date
- This can be auto-generated from the Mission Plan data and exported as a PDF/JSON artifact

---

#### AC.L2-3.1.18 — Control connection of mobile devices.

**HAVE:**
- Exclusion justification: "No mobile devices in CUI enclave per Strategic Intent baseline"
  - SI field: mobile_device_presence = no_mobile_devices
- Registry entries still present: Conditional Access - Mobile Device Compliance Requirement

**NEED:**
- Documented exclusion rationale traceable to Strategic Intent baseline
- Assessor-consumable artifact (not just internal JSON metadata)
- Justification anchored to SI field: `mobile_device_presence` = `no_mobile_devices`

**RECOMMENDATION:**
- ✅ Exclusion rationale is documented in Mission Plan
- **Best Practice:** Generate a formal "Scope Exclusion Statement" evidence artifact per control that includes:
  1. Control ID and practice text
  2. Exclusion justification: "No mobile devices in CUI enclave per Strategic Intent baseline"
  3. SI baseline reference: mobile_device_presence = no_mobile_devices
  4. Compensating controls (if any)
  5. Approval authority and date
- This can be auto-generated from the Mission Plan data and exported as a PDF/JSON artifact

---

#### AC.L2-3.1.19 — Encrypt CUI on mobile devices and mobile computing platforms.

**HAVE:**
- Exclusion justification: "No mobile devices in CUI enclave per Strategic Intent baseline"
  - SI field: mobile_device_presence = no_mobile_devices
- Registry entries still present: Deploy iOS MAM App Protection Policy

**NEED:**
- Documented exclusion rationale traceable to Strategic Intent baseline
- Assessor-consumable artifact (not just internal JSON metadata)
- Justification anchored to SI field: `mobile_device_presence` = `no_mobile_devices`

**RECOMMENDATION:**
- ✅ Exclusion rationale is documented in Mission Plan
- **Best Practice:** Generate a formal "Scope Exclusion Statement" evidence artifact per control that includes:
  1. Control ID and practice text
  2. Exclusion justification: "No mobile devices in CUI enclave per Strategic Intent baseline"
  3. SI baseline reference: mobile_device_presence = no_mobile_devices
  4. Compensating controls (if any)
  5. Approval authority and date
- This can be auto-generated from the Mission Plan data and exported as a PDF/JSON artifact

---

### CM — Configuration Management

#### CM.L2-3.4.6 — Employ the principle of least functionality by configuring organizational systems to provide only essential capabilities.

**HAVE:**
- Exclusion justification: "CUI accessible via browser only with endpoint downloads blocked per Strategic Intent baseline"
  - SI field: cui_endpoint_posture = browser_only
- Registry entries still present: Enforce Least Functionality - Disable Cortana and MSIA

**NEED:**
- Documented exclusion rationale traceable to Strategic Intent baseline
- Assessor-consumable artifact (not just internal JSON metadata)
- Justification anchored to SI field: `cui_endpoint_posture` = `browser_only`

**RECOMMENDATION:**
- ✅ Exclusion rationale is documented in Mission Plan
- **Best Practice:** Generate a formal "Scope Exclusion Statement" evidence artifact per control that includes:
  1. Control ID and practice text
  2. Exclusion justification: "CUI accessible via browser only with endpoint downloads blocked per Strategic Intent baseline"
  3. SI baseline reference: cui_endpoint_posture = browser_only
  4. Compensating controls (if any)
  5. Approval authority and date
- This can be auto-generated from the Mission Plan data and exported as a PDF/JSON artifact

---

### MA — Maintenance

#### MA.L2-3.7.4 — Check media containing diagnostic and test programs for malicious code before the media are used in organizational systems.

**HAVE:**
- Exclusion justification: "No nonlocal maintenance performed per Strategic Intent baseline"
  - SI field: maintenance_posture = no_nonlocal
- Registry entries still present: Media Malware Check via Defender AV Evidence

**NEED:**
- Documented exclusion rationale traceable to Strategic Intent baseline
- Assessor-consumable artifact (not just internal JSON metadata)
- Justification anchored to SI field: `maintenance_posture` = `no_nonlocal`

**RECOMMENDATION:**
- ✅ Exclusion rationale is documented in Mission Plan
- **Best Practice:** Generate a formal "Scope Exclusion Statement" evidence artifact per control that includes:
  1. Control ID and practice text
  2. Exclusion justification: "No nonlocal maintenance performed per Strategic Intent baseline"
  3. SI baseline reference: maintenance_posture = no_nonlocal
  4. Compensating controls (if any)
  5. Approval authority and date
- This can be auto-generated from the Mission Plan data and exported as a PDF/JSON artifact

---

### MP — Media Protection

#### MP.L2-3.8.5 — Control access to media containing CUI and maintain accountability for media during transport outside of controlled areas.

**HAVE:**
- Exclusion justification: "Removable media prohibited by policy and technical control per Strategic Intent baseline"
  - SI field: removable_media_posture = blocked
- Registry entries still present: CUI Media Access Control via Intune Removable Storage Policy

**NEED:**
- Documented exclusion rationale traceable to Strategic Intent baseline
- Assessor-consumable artifact (not just internal JSON metadata)
- Justification anchored to SI field: `removable_media_posture` = `blocked`

**RECOMMENDATION:**
- ✅ Exclusion rationale is documented in Mission Plan
- **Best Practice:** Generate a formal "Scope Exclusion Statement" evidence artifact per control that includes:
  1. Control ID and practice text
  2. Exclusion justification: "Removable media prohibited by policy and technical control per Strategic Intent baseline"
  3. SI baseline reference: removable_media_posture = blocked
  4. Compensating controls (if any)
  5. Approval authority and date
- This can be auto-generated from the Mission Plan data and exported as a PDF/JSON artifact

---

#### MP.L2-3.8.6 — Implement cryptographic mechanisms to protect the confidentiality of CUI stored on digital media during transport unless otherwise protected by alternative physical safeguards.

**HAVE:**
- Exclusion justification: "Removable media prohibited by policy and technical control per Strategic Intent baseline"
  - SI field: removable_media_posture = blocked
- Registry entries still present: Deploy BitLocker Drive Encryption Policy via Intune

**NEED:**
- Documented exclusion rationale traceable to Strategic Intent baseline
- Assessor-consumable artifact (not just internal JSON metadata)
- Justification anchored to SI field: `removable_media_posture` = `blocked`

**RECOMMENDATION:**
- ✅ Exclusion rationale is documented in Mission Plan
- **Best Practice:** Generate a formal "Scope Exclusion Statement" evidence artifact per control that includes:
  1. Control ID and practice text
  2. Exclusion justification: "Removable media prohibited by policy and technical control per Strategic Intent baseline"
  3. SI baseline reference: removable_media_posture = blocked
  4. Compensating controls (if any)
  5. Approval authority and date
- This can be auto-generated from the Mission Plan data and exported as a PDF/JSON artifact

---

#### MP.L2-3.8.7 — Control the use of removable media on system components.

**HAVE:**
- Exclusion justification: "CUI accessible via browser only with endpoint downloads blocked per Strategic Intent baseline"
  - SI field: cui_endpoint_posture = browser_only
- Registry entries still present: Removable Media Identification and Marking (Manual Gate), Verify Intune Removable Storage Restriction Policy

**NEED:**
- Documented exclusion rationale traceable to Strategic Intent baseline
- Assessor-consumable artifact (not just internal JSON metadata)
- Justification anchored to SI field: `cui_endpoint_posture` = `browser_only`

**RECOMMENDATION:**
- ✅ Exclusion rationale is documented in Mission Plan
- **Best Practice:** Generate a formal "Scope Exclusion Statement" evidence artifact per control that includes:
  1. Control ID and practice text
  2. Exclusion justification: "CUI accessible via browser only with endpoint downloads blocked per Strategic Intent baseline"
  3. SI baseline reference: cui_endpoint_posture = browser_only
  4. Compensating controls (if any)
  5. Approval authority and date
- This can be auto-generated from the Mission Plan data and exported as a PDF/JSON artifact

---

### PE — Physical Protection

#### PE.L1-3.10.1 — Limit physical access to organizational information systems, equipment, and the respective operating environments to authorized individuals.

**HAVE:**
- Exclusion justification: "Physical security inherited from FedRAMP High cloud service provider per SI baseline cloud-only deployment posture"
  - SI field: deployment_posture = cloud_only
- Registry entries still present: Physical Access Authorization and Control (Manual Gate), Limit Physical Access to Organizational Systems

**NEED:**
- Documented exclusion rationale traceable to Strategic Intent baseline
- Assessor-consumable artifact (not just internal JSON metadata)
- Justification anchored to SI field: `deployment_posture` = `cloud_only`

**RECOMMENDATION:**
- ✅ Exclusion rationale is documented in Mission Plan
- **Best Practice:** Generate a formal "Scope Exclusion Statement" evidence artifact per control that includes:
  1. Control ID and practice text
  2. Exclusion justification: "Physical security inherited from FedRAMP High cloud service provider per SI baseline cloud-only deployment posture"
  3. SI baseline reference: deployment_posture = cloud_only
  4. Compensating controls (if any)
  5. Approval authority and date
- This can be auto-generated from the Mission Plan data and exported as a PDF/JSON artifact

---

#### PE.L2-3.10.2 — Protect and monitor the physical facility and support infrastructure for organizational systems.

**HAVE:**
- Exclusion justification: "Physical security inherited from FedRAMP High cloud service provider per SI baseline cloud-only deployment posture"
  - SI field: deployment_posture = cloud_only
- Registry entries still present: Physical Facility Monitoring and Visitor Escort (Manual Gate)

**NEED:**
- Documented exclusion rationale traceable to Strategic Intent baseline
- Assessor-consumable artifact (not just internal JSON metadata)
- Justification anchored to SI field: `deployment_posture` = `cloud_only`

**RECOMMENDATION:**
- ✅ Exclusion rationale is documented in Mission Plan
- **Best Practice:** Generate a formal "Scope Exclusion Statement" evidence artifact per control that includes:
  1. Control ID and practice text
  2. Exclusion justification: "Physical security inherited from FedRAMP High cloud service provider per SI baseline cloud-only deployment posture"
  3. SI baseline reference: deployment_posture = cloud_only
  4. Compensating controls (if any)
  5. Approval authority and date
- This can be auto-generated from the Mission Plan data and exported as a PDF/JSON artifact

---

#### PE.L1-3.10.3 — Escort visitors and monitor visitor activity.

**HAVE:**
- Exclusion justification: "Physical security inherited from FedRAMP High cloud service provider per SI baseline cloud-only deployment posture"
  - SI field: deployment_posture = cloud_only
- Registry entries still present: Physical Access Log Audit (Manual Gate), Escort Visitors and Monitor Visitor Activity

**NEED:**
- Documented exclusion rationale traceable to Strategic Intent baseline
- Assessor-consumable artifact (not just internal JSON metadata)
- Justification anchored to SI field: `deployment_posture` = `cloud_only`

**RECOMMENDATION:**
- ✅ Exclusion rationale is documented in Mission Plan
- **Best Practice:** Generate a formal "Scope Exclusion Statement" evidence artifact per control that includes:
  1. Control ID and practice text
  2. Exclusion justification: "Physical security inherited from FedRAMP High cloud service provider per SI baseline cloud-only deployment posture"
  3. SI baseline reference: deployment_posture = cloud_only
  4. Compensating controls (if any)
  5. Approval authority and date
- This can be auto-generated from the Mission Plan data and exported as a PDF/JSON artifact

---

#### PE.L1-3.10.4 — Maintain audit logs of physical access.

**HAVE:**
- Exclusion justification: "Physical security inherited from FedRAMP High cloud service provider per SI baseline cloud-only deployment posture"
  - SI field: deployment_posture = cloud_only
- Registry entries still present: Physical Safeguarding of CUI Systems (Manual Gate), Maintain Audit Logs of Physical Access

**NEED:**
- Documented exclusion rationale traceable to Strategic Intent baseline
- Assessor-consumable artifact (not just internal JSON metadata)
- Justification anchored to SI field: `deployment_posture` = `cloud_only`

**RECOMMENDATION:**
- ✅ Exclusion rationale is documented in Mission Plan
- **Best Practice:** Generate a formal "Scope Exclusion Statement" evidence artifact per control that includes:
  1. Control ID and practice text
  2. Exclusion justification: "Physical security inherited from FedRAMP High cloud service provider per SI baseline cloud-only deployment posture"
  3. SI baseline reference: deployment_posture = cloud_only
  4. Compensating controls (if any)
  5. Approval authority and date
- This can be auto-generated from the Mission Plan data and exported as a PDF/JSON artifact

---

#### PE.L1-3.10.5 — Control and manage physical access devices.

**HAVE:**
- Exclusion justification: "Physical security inherited from FedRAMP High cloud service provider per SI baseline cloud-only deployment posture"
  - SI field: deployment_posture = cloud_only
- Registry entries still present: Physical Protection of CUI Output (Manual Gate), Control and Manage Physical Access Devices

**NEED:**
- Documented exclusion rationale traceable to Strategic Intent baseline
- Assessor-consumable artifact (not just internal JSON metadata)
- Justification anchored to SI field: `deployment_posture` = `cloud_only`

**RECOMMENDATION:**
- ✅ Exclusion rationale is documented in Mission Plan
- **Best Practice:** Generate a formal "Scope Exclusion Statement" evidence artifact per control that includes:
  1. Control ID and practice text
  2. Exclusion justification: "Physical security inherited from FedRAMP High cloud service provider per SI baseline cloud-only deployment posture"
  3. SI baseline reference: deployment_posture = cloud_only
  4. Compensating controls (if any)
  5. Approval authority and date
- This can be auto-generated from the Mission Plan data and exported as a PDF/JSON artifact

---

#### PE.L2-3.10.6 — Enforce safeguarding measures for CUI at alternate work sites.

**HAVE:**
- Exclusion justification: "No remote access to CUI systems per Strategic Intent baseline"
  - SI field: remote_access_posture = no_remote
- Registry entries still present: Alternative Work Site Physical Controls (Manual Gate)

**NEED:**
- Documented exclusion rationale traceable to Strategic Intent baseline
- Assessor-consumable artifact (not just internal JSON metadata)
- Justification anchored to SI field: `remote_access_posture` = `no_remote`

**RECOMMENDATION:**
- ✅ Exclusion rationale is documented in Mission Plan
- **Best Practice:** Generate a formal "Scope Exclusion Statement" evidence artifact per control that includes:
  1. Control ID and practice text
  2. Exclusion justification: "No remote access to CUI systems per Strategic Intent baseline"
  3. SI baseline reference: remote_access_posture = no_remote
  4. Compensating controls (if any)
  5. Approval authority and date
- This can be auto-generated from the Mission Plan data and exported as a PDF/JSON artifact

---

### SC — Systems and Communications Protection

#### SC.L2-3.13.16 — Protect the confidentiality of CUI at rest.

**HAVE:**
- ❌ No exclusion record found
- Registry entries still present: CUI Data-at-Rest Protection Evidence (Labels + BitLocker), Enable VM Disk Encryption (CMK via Key Vault)

**NEED:**
- Documented exclusion rationale traceable to Strategic Intent baseline
- Assessor-consumable artifact (not just internal JSON metadata)

**RECOMMENDATION:**
- ❌ **Gap: No documented exclusion.** Add scope_exclusion entry to Mission Plan with SI baseline reference.

---

## Summary

| Category | Covered | Partial | Gap |
|----------|---------|---------|-----|
| Non-Stack (22) | 9 | 9 | 4 |
| Excluded (21) | 20 | — | 1 |

### Priority Actions

1. **Tier 1 (Quick Win):** Add `evidence_commands` to the 9 Non-Stack controls that have get_commands but no evidence collection
2. **Tier 2 (Structured Prompts):** Replace 4 `Write-Output` placeholders with structured JSON including EMX archetype references
3. **Tier 3 (Scope Exclusion Artifacts):** Auto-generate formal exclusion statement documents from Mission Plan data for all 21 excluded controls
4. **Tier 4 (Evidence Card Upload):** Add GUI upload widget for manual evidence artifacts (training records, sanitization logs, SSP)
