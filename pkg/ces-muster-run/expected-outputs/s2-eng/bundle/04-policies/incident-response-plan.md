# Incident Response Plan (IRP)

**SIMULATED CUSTOMER (FICTIONAL): Tamberlow Systems Engineering LLC (FICTIONAL)** This organisation is a simulated customer of the CES simulator. Its name, people, identifiers, addresses and tenant are invented; this document describes no real company and is not a compliance record.

## 1. Document Information

| Field | Value |
|-------|-------|
| **Organization** | Tamberlow Systems Engineering LLC (FICTIONAL) |
| **Address** | 2750 Halberd Point Road, Suite 300, Wrenmoor, ZZ, 00000 |
| **CMMC Level** | L2 |
| **Effective Date** | 2026-11-01 |
| **Prepared By** | Roswen Dunnridge |
| **Approved By** | Aubrel Ashbyfield |

## 2. Purpose

This Incident Response Plan establishes the procedures for detecting, responding to, containing, eradicating, and recovering from security incidents affecting CUI systems operated by **Tamberlow Systems Engineering LLC (FICTIONAL)**.

## 3. Scope

This plan applies to all security incidents affecting information systems within the single_enclave boundary that process, store, or transmit CUI. This includes hybrid environments hosted on the **gcc_high** tenant (s2-eng.simtenant.onmicrosoft.us).

## 4. Incident Response Team

| Role | Name | Contact | Responsibility |
|------|------|---------|----------------|
| IR Lead | Roswen Dunnridge | roswen.dunnridge@s2-eng.simtenant.onmicrosoft.us | Overall incident coordination |
| ISSO | Galwyn Rowanfield | galwyn.rowanfield@s2-eng.simtenant.onmicrosoft.us | Security assessment and containment |
| IT Director | Linnow Flintridge | linnow.flintridge@s2-eng.simtenant.onmicrosoft.us | Technical response and recovery |
| System Owner | Aubrel Ashbyfield | aubrel.ashbyfield@s2-eng.simtenant.onmicrosoft.us | Authorization for response actions |
| Legal/Contracts | Oriel Elderridge | oriel.elderridge@s2-eng.simtenant.onmicrosoft.us | Legal and notification obligations |
| HR Representative | Zephren Ivorford | zephren.ivorford@s2-eng.simtenant.onmicrosoft.us | Personnel-related incidents |

## 5. Incident Classification

| Severity | Description | Response Time | Notification |
|----------|-------------|---------------|-------------|
| **Critical** | Active CUI compromise, data exfiltration, ransomware | Immediate | IR Lead + System Owner + Legal within 30 min |
| **High** | Potential CUI exposure, unauthorized access to CUI system | Within 72 hour(s) | IR Lead + ISSO |
| **Medium** | Policy violation, suspicious activity, malware detection | Within 4 hours | ISSO |
| **Low** | Minor security event, no CUI impact | Within 24 hours | ISSO (documented) |

## 6. Incident Response Phases

### 6.1 Preparation

- Maintain incident response tools and forensic capabilities
- Conduct annual incident response training for IR team members
- Maintain contact lists for IR team, management, and external parties
- Ensure logging and monitoring are operational on all CUI systems
- Primary SIEM: Microsoft Sentinel (law-s2-eng-prod)

### 6.2 Detection and Analysis

**Detection sources:**
- Security Information and Event Management (SIEM) alerts
- Endpoint detection and response (EDR) alerts
- User reports of suspicious activity
- Vulnerability scan results
- External threat intelligence feeds

**Analysis procedures:**
1. Verify the incident is genuine (not a false positive)
2. Determine the scope and severity using the classification above
3. Identify affected systems, data, and users
4. Determine whether CUI has been compromised
5. Document initial findings in the incident tracking system

### 6.3 Containment

**Short-term containment:**
- Isolate affected systems from the network
- Disable compromised user accounts
- Block malicious IP addresses or domains
- Preserve volatile evidence (memory dumps, network captures)

**Long-term containment:**
- Apply temporary mitigations (patches, configuration changes)
- Enhance monitoring on potentially affected systems
- Implement additional access controls as needed

### 6.4 Eradication

- Remove malware and unauthorized access mechanisms
- Patch exploited vulnerabilities
- Reset compromised credentials
- Verify eradication through scanning and monitoring

### 6.5 Recovery

- Restore systems from known-good backups
- Verify system integrity before returning to production
- Monitor recovered systems for signs of continued compromise
- Gradually return systems to normal operations
- Backup frequency: **Daily**

### 6.6 Post-Incident Activity

- Conduct lessons-learned review within 5 business days
- Document the complete incident timeline
- Identify root cause and contributing factors
- Update the IRP based on lessons learned
- Update detection rules and monitoring based on findings
- Retain incident documentation for a minimum of **1095** days

## 7. External Reporting Requirements

### 7.1 DoD Reporting

For incidents involving CUI under DoD contracts:
- Report to DIBNet within 72 hours of discovery
- Preserve and protect images of affected systems for 90 days
- Provide support to DoD damage assessment activities

### 7.2 Law Enforcement

Contact law enforcement when criminal activity is suspected, with guidance from the Legal representative (Oriel Elderridge).

## 8. Communication Plan

| Audience | Method | Timing | Responsible |
|----------|--------|--------|-------------|
| IR Team | Phone/Teams | Immediate | IR Lead |
| Management | Email + Briefing | Within 2 hours | IR Lead |
| Legal/Contracts | Phone | Within 4 hours | IR Lead |
| Affected Users | Email | After containment | HR Rep |
| External (DoD) | DIBNet | Within 72 hours | ISSO |
| Law Enforcement | Phone | As appropriate | Legal |

## 9. Plan Testing

- This plan shall be tested at least annually through tabletop exercises
- Full-scale exercises should be conducted when significant changes to the environment occur
- Test results shall be documented and used to improve the plan

## 10. Plan Maintenance

- This plan shall be reviewed every **12** months
- Updates required when: personnel changes, system changes, lessons learned, regulatory changes
- Next scheduled review: **2027-11-01**

---

**Effective Date:** 2026-11-01
**NIST SP 800-171 Controls:** 3.6.1–3.6.3
**Plan Owner:** Roswen Dunnridge
