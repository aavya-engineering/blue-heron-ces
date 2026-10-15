# Risk Assessment Report VFS-DOC-001-{{generated_year}}

**Effective Date:** {{governance.policy_effective_date}}
**Organization:** {{org.legal_name}}
**Authorizing Official:** {{default personnel.system_owner.name "Designated Official"}}
**Methodology:** {{risk_assessment.methodology}} ({{risk_assessment.methodology_version}})

## 1. Executive Summary

This risk assessment report documents the current risk posture of **{{org.legal_name}}** with respect to Controlled Unclassified Information (CUI) systems operating within the {{si.boundary_strategy}} boundary under the {{si.deployment_posture}} deployment posture.

{{#if risk_assessment.risk_register.length}}
### Risk Summary by Composite Level

{{#each risk_assessment.risk_register}}
- **{{this.risk_id}}:** {{this.composite_level}} -- {{this.description}}
{{/each}}
{{else}}
### Risk Summary by Composite Level

[No data available -- complete when Risk Assessment feature is populated]
{{/if}}

### Changes Since Prior Assessment

This section documents material changes to the risk environment since the most recent prior assessment, including new threats, resolved vulnerabilities, and changes to the CUI boundary or operational environment.

## 2. Scope and Methodology

### Scope

This risk assessment covers all information systems, assets, operations, and individuals within the {{si.boundary_strategy}} CUI boundary of **{{org.legal_name}}**, consistent with the scope defined in VFS-POL-011 (Risk Assessment Policy). The assessment environment includes the {{si.deployment_posture}} deployment posture operating in the {{tenant.cloud_environment}} cloud environment.

### Methodology

Risk assessments are conducted in accordance with **{{risk_assessment.methodology}}** ({{risk_assessment.methodology_version}}). The following NIST SP 800-30 appendices are used in the assessment process:

{{#each risk_assessment.appendices_used}}
- Appendix {{this}}
{{/each}}

## 3. Threat Identification

{{#if risk_assessment.threat_sources.length}}
The following threat sources have been identified and categorized:

{{#each risk_assessment.threat_sources}}
- {{this}}
{{/each}}
{{else}}
[No data available -- complete when Risk Assessment feature is populated]
{{/if}}

## 4. Vulnerability Assessment

### Technical Vulnerabilities

{{#if risk_assessment.vulnerability_sources.length}}
Technical vulnerabilities are identified through the following sources:

{{#each risk_assessment.vulnerability_sources}}
- {{this}}
{{/each}}
{{else}}
Technical vulnerability data sources include {{#ifEquals si.infrastructure_model "m365_azure"}}Microsoft Defender for Cloud findings, Microsoft Secure Score analysis, and configuration baseline compliance scans{{else}}security monitoring platform findings, compliance scoring analysis, and configuration baseline compliance scans{{/ifEquals}}.

[No data available -- complete when Risk Assessment feature is populated]
{{/if}}

### Organizational Vulnerabilities

Organizational vulnerabilities are derived from readiness posture assessment results, specifically controls assessed as NOT MET in the current compliance posture.

{{#if posture.has_posture}}
Current posture: {{posture.met}} MET, {{posture.partial}} PARTIAL, {{posture.not_met}} NOT MET, {{posture.unknown}} UNKNOWN out of {{posture.total}} total controls ({{posture.compliance_pct}}% compliance).
{{else}}
[No posture data available -- complete readiness assessment to populate]
{{/if}}

### Environmental Vulnerabilities

Environmental vulnerabilities consider the physical, operational, and regulatory context of the organization's CUI environment, including the {{si.deployment_posture}} deployment posture and {{tenant.cloud_environment}} cloud environment.

## 5. Risk Analysis

{{#if risk_assessment.risk_register.length}}
### Threat-Vulnerability Pairs

Risk analysis pairs identified threats with applicable vulnerabilities to determine likelihood and impact ratings per NIST SP 800-30 Appendix I (Composite Risk Matrix).

{{#each risk_assessment.risk_register}}
### {{this.risk_id}}: {{this.description}}

- **Threat Source:** {{this.threat_source}}
- **Vulnerability:** {{this.vulnerability}}
- **Likelihood:** {{this.likelihood}}
- **Impact:** {{this.impact}}
- **Composite Risk:** {{this.composite_level}}
{{/each}}
{{else}}
[No data available -- complete when Risk Assessment feature is populated]
{{/if}}

## 6. Risk Register

{{#if risk_assessment.risk_register.length}}
| Risk ID | Description | Threat Source | Vulnerability | Likelihood | Impact | Composite Risk | Treatment |
|---------|-------------|---------------|---------------|------------|--------|----------------|-----------|
{{#each risk_assessment.risk_register}}
| {{this.risk_id}} | {{this.description}} | {{this.threat_source}} | {{this.vulnerability}} | {{this.likelihood}} | {{this.impact}} | {{this.composite_level}} | {{this.treatment}} |
{{/each}}
{{else}}
| Risk ID | Description | Threat Source | Vulnerability | Likelihood | Impact | Composite Risk | Treatment |
|---------|-------------|---------------|---------------|------------|--------|----------------|-----------|
| | [No data available -- complete when Risk Assessment feature is populated] | | | | | | |
{{/if}}

## 7. Treatment Recommendations

{{#if risk_assessment.risk_register.length}}
The following treatment recommendations are provided for each identified risk:

{{#each risk_assessment.risk_register}}
### {{this.risk_id}}: {{this.description}}

- **Recommended Treatment:** {{this.treatment}}
- **Rationale:** {{this.treatment_rationale}}
{{/each}}
{{else}}
[No data available -- complete when Risk Assessment feature is populated]

Treatment options follow the standard risk treatment framework:
- **Mitigate** -- Implement controls to reduce likelihood or impact
- **Avoid** -- Eliminate the risk by removing the threat source or vulnerability
- **Transfer** -- Shift risk to a third party (e.g., insurance, outsourcing)
- **Accept** -- Acknowledge the risk with documented Authorizing Official approval
{{/if}}

## 8. Authorizing Official Sign-off

## Attestation

I, {{default personnel.system_owner.name "Designated Official"}}, as the Authorizing Official, have reviewed and approve this policy.

**Signature:** ___________________________
**Name:** {{default personnel.system_owner.name "Designated Official"}}
**Title:** {{default personnel.system_owner.title "Authorizing Official"}}
**Date:** ___________________________

**Next Assessment Due:** The next risk assessment shall be conducted no later than 12 months from the effective date of this report, or sooner if triggered by events defined in VFS-POL-011.

---

**Effective Date:** {{governance.policy_effective_date}}
**CMMC Controls:** 3.11.1
**Policy Owner:** {{default personnel.system_owner.name "Designated Official"}}
