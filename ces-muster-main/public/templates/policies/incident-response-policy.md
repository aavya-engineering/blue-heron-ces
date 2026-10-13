# Incident Response Policy

## 1. Purpose

This policy establishes the incident response requirements for **{{org.legal_name}}** in accordance with NIST SP 800-171 Rev 2 (Family 3.6) and CMMC {{si.target_cmmc_level}} requirements.

## 2. Scope

This policy applies to all security incidents affecting information systems within the {{si.boundary_strategy}} boundary that process, store, or transmit CUI.

## 3. Roles and Responsibilities

| Role | Name | Responsibility |
|------|------|----------------|
| Incident Response Lead | {{personnel.ir_lead.name}} | Coordinate incident response activities |
| ISSO | {{personnel.isso.name}} | Assess incident impact and authorize response actions |
| System Owner | {{personnel.system_owner.name}} | Authorize system isolation or recovery actions |
| Legal Representative | {{personnel.legal_representative.name}} | Advise on legal and contractual notification obligations |

## 4. Policy Statements

### 4.1 Incident Response Capability (3.6.1)

{{org.legal_name}} shall maintain an operational incident response capability that includes:
- An incident response plan (see companion IRP document)
- Trained incident response personnel
- Regular testing of the incident response capability
- Defined roles and responsibilities for incident handling

### 4.2 Incident Tracking and Reporting (3.6.1, 3.6.2)

- All security incidents shall be tracked from detection through resolution
- Incidents involving CUI shall be reported to the ISSO within **{{default odp.incident_reporting_hours "1"}}** hour(s) of discovery
- Incidents shall be reported to the DoD CUI Program and DIBCAC as required
- Incident reports shall include: description, timeline, systems affected, CUI impact, response actions, and lessons learned

### 4.3 Incident Response Testing (3.6.3)

- The incident response plan shall be tested at least annually
- Testing methods may include tabletop exercises, simulations, or full-scale exercises
- Test results shall be documented and used to improve the incident response plan

## 5. Incident Classification

| Severity | Description | Response Time |
|----------|-------------|---------------|
| Critical | Active CUI compromise or data exfiltration | Immediate |
| High | Potential CUI exposure or system compromise | Within {{default odp.incident_reporting_hours "1"}} hour(s) |
| Medium | Policy violation or suspicious activity | Within 4 hours |
| Low | Minor security event, no CUI impact | Within 24 hours |

## 6. Review

This policy shall be reviewed every **{{governance.review_cycle_months}}** months. Next scheduled review: **{{governance.next_review_date}}**.

---

**Effective Date:** {{governance.policy_effective_date}}
**NIST SP 800-171 Controls:** 3.6.1–3.6.3
**Policy Owner:** {{personnel.ir_lead.name}}
