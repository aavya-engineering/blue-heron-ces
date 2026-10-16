# CSE Domain Store vs Stamper Executable Plan: Fidelity Analysis

**Date:** 2026-05-04
**EP Analyzed:** `executable-plan-2026-05-03T15-27-27-426Z.json` (110 steps, 110 controls)
**CSE Domain Sources:** `domain Tech Stack Compliance Mapping.yaml`, `domain Implementation Patterns.yaml`
**Registries:** `cmmc-l2-commands.registry.json` (M365), `infra-cmmc-l2-commands.registry.json` (Azure)

---

## Summary Table

| # | Control | Domain Pattern | Domain Says | EP Step(s) | EP Does | Fidelity | Gap |
|---|---------|---------------|-------------|------------|---------|----------|-----|
| 1 | AC.L2-3.1.1 | IAM-002 | Account lifecycle: provision, deprovision, expiration, periodic review | `step_task_AC.L1-3.1.1` (L7, 11 subs) | Creates CUI security group, adds operator, verifies CA policies, NSG rules, KV RBAC | **PARTIAL** | No automated deprovision, no account expiration rules, no periodic review process |
| 2 | AC.L2-3.1.3 | DPC-002 | CUI flow: document data flows, configure DLP rules | `step_task_AC.L2-3.1.3` (L7, 3 subs) | Collects sensitivity label evidence, DLP policy evidence, service principal evidence | **FAITHFUL** | Evidence-only (no set_command) but verifies both labels and DLP exist |
| 3 | AC.L2-3.1.4 | IAM-005 | SoD: define matrix, configure role exclusions | `step_task_AC.L2-3.1.4` (L1, 2 subs) | Gets PIM policy, configures PIM approval for Compliance Admin role | **FAITHFUL** | Implements SoD via PIM approval workflow rather than role exclusion matrix; functionally equivalent |
| 4 | AC.L2-3.1.5 | IAM-006 | Least privilege: default deny, explicit grants, periodic certification | `step_task_AC.L2-3.1.5` (L7, 3 subs) + 3 other steps | PIM JIT eligible assignment, operator admin account check, PIM eligible role evidence | **FAITHFUL** | JIT activation with 1-year expiry enforces least privilege; no periodic access certification process |
| 5 | AC.L2-3.1.8 | IAM-009 | Account lockout after N failed attempts | `step_task_AC.L2-3.1.8` (L1, 1 sub) | Smart Lockout configuration evidence collection | **PARTIAL** | Evidence-only -- no set_command to configure lockout thresholds; relies on Entra ID defaults |
| 6 | AC.L2-3.1.10 | IAM-011 | Auto session lock after inactivity | `step_task_AC.L2-3.1.10` (L3, 1 sub) | Deploys Intune policy: 15-min screen lock timeout, password required | **FAITHFUL** | Sets exact inactivity timer via Intune device configuration |
| 7 | AC.L2-3.1.12 | NBP-002 | Remote access logging/monitoring, permitted methods | `step_task_AC.L2-3.1.12` (L7, 1 sub) | Creates Named Location (approved IP range) in CA | **PARTIAL** | Creates location-based control but no monitoring/logging configuration; only 1 sub-command |
| 8 | AC.L2-3.1.18 | EPM-001 | MDM enrollment, CA requiring device compliance | `step_task_AC.L2-3.1.18` (L4, 3 subs) | Mobile CA compliance, BYOD non-browser block, BYOD sign-in failures sample | **FAITHFUL** | Configures CA for mobile compliance + evidence of BYOD blocking; matches domain pattern |
| 9 | AC.L2-3.1.19 | CRY-004 | Mobile device CUI encryption at rest | Multiple steps including `prohibition-AC.L2-3.1.19` (L8, 4 subs) | Document-prohibition directive with BYOD block evidence, MAM evidence, sensitivity labels | **FAITHFUL** | Uses prohibition approach (BYOD blocked, managed devices encrypted via Intune); creative but valid |
| 10 | AT.L2-3.2.1 | SAT-001 | Security awareness training for managers/admins/users | `manual-AT.L2-3.2.1` (L8, manual gate) | Manual gate -- no automated implementation | **PARTIAL** | Correctly identifies as manual/process control; but no training platform integration or tracking |
| 11 | AU.L2-3.3.1 | SML-001 | Define audit events, configure logging, centralized collection + retention | `step_task_AU.L2-3.3.1` (L7, 27 subs) + 8 other steps | Exchange org customization, unified audit log enable, 1-year retention policy, LAW workspace (365-day), storage account, Sentinel, Defender for Cloud | **FAITHFUL** | Comprehensive: audit logging + centralized SIEM + immutable storage + 365-day retention |
| 12 | AU.L2-3.3.2 | SML-002 | Log user actions to specific accounts | `step_task_AU.L2-3.3.2` (L7, 12 subs) | Sign-in and directory audit log evidence, LAW, storage, Sentinel analytics rules | **FAITHFUL** | Sign-in logs + directory audit + Sentinel correlation rules trace actions to users |
| 13 | AU.L2-3.3.5 | SML-005 | SIEM correlation rules | `step_task_AU.L2-3.3.5` (L7, 1 sub) | Audit log search evidence via Exchange | **PARTIAL** | Only collects search capability evidence; no explicit SIEM correlation rule configuration |
| 14 | AU.L2-3.3.8 | SML-008 | Protect audit logs from unauthorized access/modification | `step_task_AU.L2-3.3.8` (L7, 2 subs) | Compliance Admin role evidence + CanNotDelete lock on LAW | **FAITHFUL** | RBAC restriction on audit logs + immutability lock on workspace |
| 15 | CM.L2-3.4.1 | EPM-003 | Define baselines, deploy baseline profiles | `step_task_CM.L2-3.4.1` (L7, 4 subs) + 8 other steps | Windows Security Baseline via Intune, CMMC L2 Azure Policy Initiative, Defender for Cloud | **FAITHFUL** | Deploys Windows baseline via Intune template + Azure Policy initiative for infra baseline |
| 16 | CM.L2-3.4.2 | EPM-004 | Security settings per CIS/STIG | `step_task_CM.L2-3.4.2` (L4, 2 subs) | ASR rules via Intune, resource group lock | **PARTIAL** | Deploys ASR rules (partial CIS benchmark) but no full STIG/CIS profile deployment |
| 17 | CM.L2-3.4.6 | EPM-005 | Disable unnecessary services, least functionality | `prohibition-CM.L2-3.4.6` (L8, 2 subs) | Document-prohibition: BYOD block + Cortana/MSIA disable evidence | **PARTIAL** | Disables Cortana and MSIA; BYOD block reduces attack surface; but no broad service hardening |
| 18 | CM.L2-3.4.8 | EPM-007 | Application allowlisting with deny-by-default | `renderable-CM.L2-3.4.8` (L8, 2 subs) | Document-renderable: detected apps inventory + app protection/Defender App Control evidence | **PARTIAL** | Evidence collection only; no actual allowlist deployment or deny-by-default enforcement |
| 19 | IA.L2-3.5.3 | IAM-024 | MFA policy + CA enforcement for all access paths | `step_task_IA.L2-3.5.3` (L7, 2 subs) | Enable MS Authenticator + FIDO2 security key auth methods | **PARTIAL** | Enables auth methods but no CA policy explicitly requiring MFA for all access paths |
| 20 | IA.L2-3.5.4 | IAM-025 | Replay-resistant auth (FIDO2, cert-based) | `step_task_IA.L2-3.5.4` (L1, 1 sub) | Creates phishing-resistant authentication strength policy | **FAITHFUL** | Auth strength policy directly enforces replay-resistant mechanisms |
| 21 | IA.L2-3.5.7 | IAM-028 | Password complexity (length, character types) | `step_task_IA.L2-3.5.7` (L1, 1 sub) | Azure AD Password Protection + banned password list evidence | **PARTIAL** | Collects password protection evidence but no set_command; relies on tenant defaults |
| 22 | IR.L2-3.6.1 | IRP-001 | IR plan + incident tracking system | `step_task_IR.L2-3.6.1` (L0, 2 subs) | Defender for Office 365 ATP enable, malware filter file type filtering | **DIVERGENT** | Domain says IR plan + tracking; EP configures malware detection tools instead |
| 23 | MA.L2-3.7.5 | n/a (PES/maintenance) | MFA for nonlocal maintenance, terminate when complete | `step_task_MA.L2-3.7.5` (L2, 1 sub) | CA policy requiring MFA for remote maintenance sessions | **FAITHFUL** | Directly implements MFA requirement for remote maintenance via CA |
| 24 | MP.L2-3.8.1 | MAP-002 | Physical + logical protections for CUI media | `step_task_MP.L2-3.8.1` (L0, 2 subs) | Create CUI sensitivity label with encryption + publish label policy | **FAITHFUL** | Sensitivity labels with encryption protect digital CUI media across all workloads |
| 25 | PE.L1-3.10.1 | PES-001 | Physical access controls at entry points | `inherit-PE.L1-3.10.1` (L0, 2 subs) | FedRAMP inheritance verification (tenant type + contradicting config check) | **FAITHFUL** | Correctly handled as FedRAMP inherited -- cloud infrastructure PE is CSP responsibility |
| 26 | PS.L2-3.9.1 | n/a (personnel) | Screen individuals before CUI access | `manual-PS.L2-3.9.1` (L8, manual gate) | Manual gate -- requires operator attestation | **PARTIAL** | Correctly identifies as manual/process; no automated screening integration |
| 27 | RA.L2-3.11.2 | VPM-010 | Regular vulnerability scanning | `renderable-RA.L2-3.11.2` (L8, 1 sub) | Document-renderable: Defender vulnerability scan results evidence | **PARTIAL** | Collects scan results but no scan scheduling or configuration |
| 28 | SC.L2-3.13.8 | CRY-001 | TLS 1.2+ for CUI transmission | `step_task_SC.L2-3.13.8` (L5, 2 subs) | BYOD sensitivity labels + disable legacy TLS in Exchange Transport | **FAITHFUL** | Enforces TLS 1.2 minimum by disabling legacy connections in Exchange |
| 29 | SC.L2-3.13.11 | CRY-003 | FIPS 140-2/3 validated crypto | `step_task_SC.L2-3.13.11` (L4, 1 sub) | FIPS 140-2 compliance verification (platform inherited) | **FAITHFUL** | GCC High inherits FIPS validation; EP verifies rather than configures (correct approach) |
| 30 | SI.L2-3.14.6 | SML-010 | System monitoring: detect attacks, unauthorized access, anomalies | `step_task_SI.L2-3.14.6` (L7, 7 subs) + 8 other steps | Security alerts via Defender, spam protection, email protection, NSG rules, Defender for Cloud, Sentinel analytics rules | **FAITHFUL** | Multi-layer monitoring: Defender alerts + EOP + Sentinel analytics + Defender for Cloud |
| 31 | SI.L2-3.14.7 | SML-011 | Detection rules for unauthorized use | `step_task_SI.L2-3.14.7` (L7, 3 subs) | Sentinel threat intelligence connectors, security alert evidence, Sentinel UEBA | **FAITHFUL** | UEBA + threat intel + detection rules = comprehensive unauthorized use detection |

---

## Detailed Findings

### 1. AC.L2-3.1.1 -- Authorized Access / Account Management

**Domain Store (IAM-002):** Requires account management procedures covering creation, modification, disabling, and removal. Calls for automated provisioning tied to HR workflows, account expiration rules, and periodic review with management sign-off.

**EP Implementation:** Step `step_task_AC.L1-3.1.1` runs 11 sub-commands at Layer 7:
- `AC.L2-3.1.1.operator-discover` -- discovers operator by UPN (evidence-only)
- `AC.L2-3.1.1.group-create` -- creates CUI security group (set + get)
- `AC.L2-3.1.1.member-add` -- adds operator to CUI group (set + get)
- `AC.L1-3.1.1.ca-policy-evidence` -- verifies CA policies (evidence-only)
- Infrastructure entries: NSG rules, KV RBAC

**Fidelity: PARTIAL.** The EP creates the access control group and membership, which is the "gate" for authorized access. However, it lacks: (a) automated deprovision tied to HR, (b) account expiration configuration, (c) periodic access review process. The provisioning half is solid; the lifecycle management half is missing.

---

### 2. AC.L2-3.1.3 -- CUI Flow Control

**Domain Store (DPC-002):** Document CUI data flows; configure DLP rules to control CUI movement.

**EP Implementation:** Step `step_task_AC.L2-3.1.3` runs 3 sub-commands:
- `AC.L2-3.1.3.sensitivity-label` -- collects sensitivity label and publishing policy evidence (IPPS engine)
- `AC.L2-3.1.3.dlp-policy` -- collects DLP compliance policy evidence (IPPS engine)
- `AC.L2-3.1.3.service-account` -- collects service principal evidence (MGraph engine)

**Fidelity: FAITHFUL.** All commands are evidence-only (no set_command), meaning the labels and DLP policies must already exist. This matches the domain pattern -- the EP verifies that both sensitivity labels and DLP policies are configured for CUI across Exchange, SharePoint, and OneDrive.

---

### 3. AC.L2-3.1.4 -- Separation of Duties

**Domain Store (IAM-005):** Define SoD matrix; configure role exclusions preventing conflicting assignments.

**EP Implementation:** Step `step_task_AC.L2-3.1.4` runs 2 sub-commands:
- `AC.L2-3.1.4.pim-policy-get` -- retrieves PIM policy for Compliance Administrator (captures pimPolicyId)
- `AC.L2-3.1.4.pim-approval` -- configures PIM approval workflow requiring a different approver (set + get)

**Fidelity: FAITHFUL.** Instead of a static role exclusion matrix, the EP implements SoD dynamically via PIM approval workflows. A user requesting Compliance Admin activation needs a different person (approverUPN) to approve. This is actually a stronger implementation than simple role exclusion.

---

### 4. AC.L2-3.1.5 -- Least Privilege

**Domain Store (IAM-006):** Default deny, explicit grants per role, periodic access certification.

**EP Implementation:** Appears in 4 steps including the dedicated `step_task_AC.L2-3.1.5`:
- `AC.L2-3.1.5.pim-eligible` -- JIT role assignment with 1-year expiry (set + get)
- `AZ-ID-002` -- operator admin account verification
- `AZ-ID-005` -- PIM eligible role assignment verification

**Fidelity: FAITHFUL.** PIM JIT with time-limited assignments (1 year) directly implements least privilege. Roles are eligible (not permanent), requiring explicit activation with justification. The only gap is no automated periodic access certification, but the time-based expiry serves as a compensating control.

---

### 5. AC.L2-3.1.8 -- Unsuccessful Logon Attempts

**Domain Store (IAM-009):** Configure account lockout policy after defined number of failed attempts.

**EP Implementation:** Step `step_task_AC.L2-3.1.8` runs 1 sub-command:
- `AC.L2-3.1.8.smart-lockout` -- evidence-only; collects authentication methods policy and settings

**Fidelity: PARTIAL.** No set_command -- relies entirely on Entra ID's built-in Smart Lockout defaults (which are reasonable: 10 failed attempts, 60-second lockout). The domain pattern expects explicit configuration, but the EP only verifies the existing state. For GCC High tenants, this is often acceptable since Smart Lockout is enabled by default.

---

### 6. AC.L2-3.1.10 -- Session Lock

**Domain Store (IAM-011):** Configure automatic session lock after defined inactivity period.

**EP Implementation:** Step `step_task_AC.L2-3.1.10` runs 1 sub-command:
- `AC.L2-3.1.10.screen-lock` -- deploys Intune policy with `passwordMinutesOfInactivityBeforeScreenTimeout=15` and `passwordRequired=true`

**Fidelity: FAITHFUL.** Directly configures a 15-minute inactivity lock via Intune device configuration. The set_command creates the policy; the get_command verifies it exists. This precisely matches the domain pattern.

---

### 7. AC.L2-3.1.12 -- Remote Access Monitoring

**Domain Store (NBP-002):** Configure logging/monitoring for remote access sessions; define permitted remote access methods.

**EP Implementation:** Step `step_task_AC.L2-3.1.12` runs 1 sub-command:
- `AC.L2-3.1.12.named-location` -- creates "Approved-CUI-Networks" named location in CA

**Fidelity: PARTIAL.** The named location is a prerequisite for remote access control (used by the block-untrusted CA policy in AC.L2-3.1.14), but it does not configure remote access session logging or monitoring dashboards. The monitoring aspect from the domain pattern is handled indirectly via AU.L2-3.3.1/3.3.2 audit logging, but the EP step itself only creates the network location.

---

### 8. AC.L2-3.1.18 -- Mobile Device Connection Control

**Domain Store (EPM-001):** MDM enrollment requirements; CA requiring device compliance.

**EP Implementation:** Step `step_task_AC.L2-3.1.18` runs 3 sub-commands:
- `AC.L2-3.1.18.mobile-ca` -- CA policy requiring mobile device compliance (set + get)
- `AC.L2-3.1.18.byod-nonbrowser-block` -- BYOD non-browser client blocking evidence
- `AC.L2-3.1.18.byod-nonbrowser-signins` -- BYOD sign-in failure sampling evidence

**Fidelity: FAITHFUL.** The CA policy enforces device compliance for mobile connections, and the BYOD blocking provides defense-in-depth. This closely matches the domain pattern of MDM enrollment + CA enforcement.

---

### 9. AC.L2-3.1.19 -- Mobile Device CUI Encryption

**Domain Store (CRY-004):** Configure mobile device encryption for CUI data at rest.

**EP Implementation:** Multiple steps including `prohibition-AC.L2-3.1.19` (document-prohibition directive):
- BYOD non-browser block CA policies
- BYOD sign-in failure evidence
- Sensitivity labels configuration
- iOS MAM app protection policy evidence

**Fidelity: FAITHFUL.** Uses a creative approach: rather than just encrypting mobile data, the EP documents that unmanaged mobile devices are prohibited. Managed devices inherit Intune encryption requirements. The prohibition approach with supporting evidence is assessor-valid.

---

### 10. AT.L2-3.2.1 -- Security Awareness Training

**Domain Store (SAT-001):** Ensure managers, admins, and users are aware of security risks; deliver training content.

**EP Implementation:** `manual-AT.L2-3.2.1` -- manual gate requiring operator attestation.

**Fidelity: PARTIAL.** Correctly identifies this as a process/human control that cannot be automated via PowerShell. The manual gate ensures the operator acknowledges the requirement. However, there is no integration with a training platform (e.g., Microsoft 365 Attack Simulation Training) to verify training completion.

---

### 11. AU.L2-3.3.1 -- Audit Event Logging

**Domain Store (SML-001):** Define audit events, configure logging on all systems, centralized log collection with retention.

**EP Implementation:** The most comprehensive step in the plan -- `step_task_AU.L2-3.3.1` has 27 sub-commands and this control appears in 9 different steps:
- Exchange: org customization, audit log enable, 1-year retention policy
- Azure: LAW (365-day retention), immutable storage (TLS 1.2, HTTPS-only), Sentinel onboarding, Sentinel data connectors, Defender for Cloud
- Sentinel analytics rules for correlating events

**Fidelity: FAITHFUL.** Exceeds the domain pattern requirements. Implements unified audit logging (Exchange), centralized SIEM (Sentinel + LAW), immutable storage with WORM lock, 365-day retention, and multiple data connectors. This is the strongest implementation in the entire EP.

---

### 12. AU.L2-3.3.2 -- User Action Accountability

**Domain Store (SML-002):** Log user actions traceable to specific accounts.

**EP Implementation:** `step_task_AU.L2-3.3.2` runs 12 sub-commands:
- `AU.L2-3.3.2.signin-logs` -- sign-in and directory audit log evidence
- LAW + storage + Sentinel analytics rules (excessive failed logins)

**Fidelity: FAITHFUL.** Sign-in logs and directory audit logs inherently trace actions to specific user accounts. Sentinel analytics rules add automated detection of anomalous patterns.

---

### 13. AU.L2-3.3.5 -- Audit Record Correlation

**Domain Store (SML-005):** Configure SIEM correlation rules.

**EP Implementation:** `step_task_AU.L2-3.3.5` runs 1 sub-command:
- `AU.L2-3.3.5.audit-search` -- audit log search evidence via Exchange

**Fidelity: PARTIAL.** Only demonstrates search capability, not correlation rules. However, Sentinel analytics rules (created in AU.L2-3.3.1/3.3.2 steps -- e.g., AZ-SEN-005, AZ-SEN-007) do perform correlation. The gap is that the AU.L2-3.3.5 step itself does not reference the Sentinel correlation rules; they are attached to other control steps.

---

### 14. AU.L2-3.3.8 -- Audit Information Protection

**Domain Store (SML-008):** Protect audit logs from unauthorized access/modification.

**EP Implementation:** `step_task_AU.L2-3.3.8` runs 2 sub-commands:
- `AU.L2-3.3.8.audit-protect` -- Compliance Admin role evidence (RBAC restriction on audit logs)
- `AZ-LOG-004` -- CanNotDelete lock on Sentinel LAW workspace

**Fidelity: FAITHFUL.** RBAC role restriction limits who can manage audit logs; the CanNotDelete lock prevents workspace deletion. Combined with the WORM lock from AU.L2-3.3.1, this provides comprehensive audit log protection.

---

### 15. CM.L2-3.4.1 -- Baseline Configuration

**Domain Store (EPM-003):** Define and document baseline configs; deploy profiles to endpoints.

**EP Implementation:** `step_task_CM.L2-3.4.1` runs 4 sub-commands:
- `CM.L2-3.4.1.security-baseline` -- Windows Security Baseline via Intune template (set + get)
- NSG boundary rules
- `AZ-FOUND-002` -- CMMC L2 Azure Policy Initiative (set + get)
- `AZ-FOUND-003` -- Defender for Cloud P2

**Fidelity: FAITHFUL.** Deploys Windows security baseline via Intune for endpoints, and CMMC L2 Azure Policy initiative for infrastructure. The combination covers both endpoint and infrastructure baselines.

---

### 16. CM.L2-3.4.2 -- Security Configuration Enforcement

**Domain Store (EPM-004):** Configure settings per CIS Benchmark or DISA STIG.

**EP Implementation:** `step_task_CM.L2-3.4.2` runs 2 sub-commands:
- `CM.L2-3.4.2.asr-rules` -- Attack Surface Reduction rules via Intune (set + get)
- `AZ-FOUND-004` -- Resource group CanNotDelete lock

**Fidelity: PARTIAL.** ASR rules are one aspect of security configuration, but not a full CIS benchmark or DISA STIG deployment. The EP enforces specific attack surface reduction rules but does not demonstrate comprehensive STIG compliance scanning or CIS benchmark profile application.

---

### 17. CM.L2-3.4.6 -- Least Functionality

**Domain Store (EPM-005):** Configure systems to provide only essential capabilities; disable unnecessary services.

**EP Implementation:** `prohibition-CM.L2-3.4.6` (document-prohibition directive) runs 2 sub-commands:
- BYOD non-browser client block evidence
- `CM.L2-3.4.6.least-functionality` -- disable Cortana and MSIA evidence

**Fidelity: PARTIAL.** Disabling Cortana and Microsoft Search in Apps is a start, but the domain pattern calls for broad service hardening. The EP does not disable other non-essential services, ports, or protocols at the OS level.

---

### 18. CM.L2-3.4.8 -- Application Allowlisting

**Domain Store (EPM-007):** Application allowlisting with deny-by-default policy.

**EP Implementation:** `renderable-CM.L2-3.4.8` (document-renderable directive) runs 2 sub-commands:
- `CM.L2-3.4.8.detected-apps` -- detected applications inventory evidence
- `CM.L2-3.4.8.app-protection-evidence` -- Intune app protection and Defender Application Control evidence

**Fidelity: PARTIAL.** Evidence collection only -- no actual allowlist creation or deny-by-default enforcement. The "document-renderable" directive indicates this control requires manual/policy documentation rather than automated enforcement. The EP collects evidence of existing app inventory and protection policies but does not deploy a deny-by-exception policy.

---

### 19. IA.L2-3.5.3 -- Multifactor Authentication

**Domain Store (IAM-024):** Define MFA policy; configure CA enforcement for all in-scope access paths.

**EP Implementation:** `step_task_IA.L2-3.5.3` runs 2 sub-commands:
- `IA.L2-3.5.3.mfa-authenticator` -- enables Microsoft Authenticator (set + get)
- `IA.L2-3.5.3.fido2-enable` -- enables FIDO2 security key (set + get)

**Fidelity: PARTIAL.** Enables two authentication methods (Authenticator + FIDO2), which is necessary but not sufficient. The domain pattern also requires a Conditional Access policy that *requires* MFA for all access paths. The EP enables the methods but the MFA-requiring CA policy is not in this step. (Note: The block-untrusted CA policy in AC.L2-3.1.14 and session timeout in AC.L2-3.1.11 do include CA policies, but explicit MFA enforcement via CA is absent from this specific step.)

---

### 20. IA.L2-3.5.4 -- Replay-Resistant Authentication

**Domain Store (IAM-025):** Configure replay-resistant auth protocols (FIDO2, certificate-based, OATH tokens).

**EP Implementation:** `step_task_IA.L2-3.5.4` runs 1 sub-command:
- `IA.L2-3.5.4.auth-strength` -- creates phishing-resistant authentication strength policy (set + get)

**Fidelity: FAITHFUL.** The authentication strength policy directly configures replay-resistant (phishing-resistant) methods. In Entra ID, authentication strength policies define which methods satisfy the requirement, including FIDO2 and certificate-based auth.

---

### 21. IA.L2-3.5.7 -- Password Complexity

**Domain Store (IAM-028):** Configure minimum password complexity (length, character types).

**EP Implementation:** `step_task_IA.L2-3.5.7` runs 1 sub-command:
- `IA.L2-3.5.7.password-protection` -- Azure AD Password Protection + banned password list (evidence-only)

**Fidelity: PARTIAL.** Evidence-only -- no set_command to configure password complexity rules. The banned password list is one aspect of password quality, but explicit complexity requirements (minimum length, character types) are not configured. Entra ID does have default password policies, but the EP does not verify or enforce specific complexity thresholds.

---

### 22. IR.L2-3.6.1 -- Incident Response Planning

**Domain Store (IRP-001):** Develop IR plan (roles, procedures, escalation); configure incident tracking system.

**EP Implementation:** `step_task_IR.L2-3.6.1` runs 2 sub-commands:
- `IR.L2-3.6.1.atp-enable` -- enables Defender for Office 365 ATP for SharePoint/Teams/OneDrive
- `IR.L2-3.6.1.malware-filter` -- enables file type filtering in default malware filter policy

**Fidelity: DIVERGENT.** The domain pattern is about IR *planning* (policy documents, tracking systems). The EP instead configures *detection* capabilities (ATP, malware filtering). While these are necessary for incident detection, they do not constitute an IR plan. The IR plan itself is a document/process that exists outside of technical configuration.

---

### 23. MA.L2-3.7.5 -- Nonlocal Maintenance

**Domain Store (not explicitly in patterns, but the CMMC requirement):** MFA for nonlocal maintenance sessions; terminate when complete.

**EP Implementation:** `step_task_MA.L2-3.7.5` runs 1 sub-command:
- `MA.L2-3.7.5.remote-mfa` -- CA policy requiring MFA for remote maintenance (set + get)

**Fidelity: FAITHFUL.** Directly creates a Conditional Access policy that enforces MFA for remote administrative sessions, matching the CMMC requirement.

---

### 24. MP.L2-3.8.1 -- Media Protection

**Domain Store (MAP-002):** Physical and logical protections for CUI media.

**EP Implementation:** `step_task_MP.L2-3.8.1` runs 2 sub-commands:
- `MP.L2-3.8.1.cui-label` -- creates CUI sensitivity label with encryption (IPPS, set + get)
- `MP.L2-3.8.1.label-policy` -- publishes CUI label policy to all workloads (IPPS, set + get)

**Fidelity: FAITHFUL.** Sensitivity labels with encryption protect digital media (documents, emails) containing CUI. Publishing across Exchange, SharePoint, and OneDrive covers the digital media landscape. Physical media controls remain outside Stamper's scope (as expected).

---

### 25. PE.L1-3.10.1 -- Limit Physical Access

**Domain Store (PES-001):** Physical access controls at facility entry points.

**EP Implementation:** `inherit-PE.L1-3.10.1` (inherit-fedramp directive) runs 2 sub-commands:
- Tenant type verification (GCC High confirmation)
- Contradicting config check (VMs, host pools, Arc machines)

**Fidelity: FAITHFUL.** Physical security for cloud infrastructure is the CSP's (Microsoft's) responsibility under FedRAMP High. The EP correctly handles this as an inheritance verification rather than trying to configure physical controls. The contradicting-config check ensures no IaaS VMs exist that would shift PE responsibility back to the customer.

---

### 26. PS.L2-3.9.1 -- Personnel Screening

**Domain Store (not in patterns):** Screen individuals before authorizing CUI access.

**EP Implementation:** `manual-PS.L2-3.9.1` -- manual gate.

**Fidelity: PARTIAL.** Personnel screening is inherently a human/HR process. The manual gate correctly flags this as requiring operator attestation, but there is no integration with background check systems or HR workflows.

---

### 27. RA.L2-3.11.2 -- Vulnerability Scanning

**Domain Store (VPM-010):** Configure regular vulnerability scanning of all in-scope systems.

**EP Implementation:** `renderable-RA.L2-3.11.2` (document-renderable directive) runs 1 sub-command:
- `RA.L2-3.11.2.vuln-scan` -- Defender vulnerability scan results evidence

**Fidelity: PARTIAL.** Collects scan results from Defender Vulnerability Management as evidence, but does not configure scan schedules or scanning parameters. The domain pattern calls for configuring the scanner, not just collecting results.

---

### 28. SC.L2-3.13.8 -- CUI Transmission Encryption

**Domain Store (CRY-001):** Configure TLS 1.2+ for all CUI transmission paths.

**EP Implementation:** `step_task_SC.L2-3.13.8` runs 2 sub-commands:
- `SC.L2-3.13.16.byod-sensitivity-labels` -- BYOD sensitivity labels configuration (IPPS evidence)
- `SC.L2-3.13.8.tls-enforce` -- disables legacy TLS client connections in Exchange Transport (set + get)

**Fidelity: FAITHFUL.** Directly disables legacy TLS connections in Exchange transport rules, enforcing TLS 1.2+ for email transmission. Azure services (storage, Key Vault) are configured with TLS 1.2 minimum in their respective infra registry entries.

---

### 29. SC.L2-3.13.11 -- FIPS-Validated Cryptography

**Domain Store (CRY-003):** Configure FIPS 140-2/3 validated modules; verify compliance.

**EP Implementation:** `step_task_SC.L2-3.13.11` runs 1 sub-command:
- `SC.L2-3.13.11.fips` -- FIPS 140-2 compliance verification (evidence-only)

**Fidelity: FAITHFUL.** In GCC High, FIPS 140-2 is inherited from the platform -- Microsoft's cloud services use FIPS-validated cryptographic modules. The EP correctly treats this as a verification rather than a configuration task.

---

### 30. SI.L2-3.14.6 -- System Monitoring

**Domain Store (SML-010):** Configure monitoring to detect attacks, unauthorized access, anomalies.

**EP Implementation:** `step_task_SI.L2-3.14.6` runs 7 sub-commands and appears in 9 total steps:
- `SI.L2-3.14.6.security-alerts` -- Defender security alert evidence
- `SI.L2-3.14.6.spam-protection` -- anti-spam filter policy evidence
- `SI.L2-3.14.6.email-protection-evidence` -- Defender for Office 365 / EOP evidence
- NSG boundary rules
- Defender for Cloud P2
- Sentinel CMMC analytics rules (privileged identity changes, excessive failed logins)

**Fidelity: FAITHFUL.** Multi-layer monitoring spanning Defender for Endpoint, Defender for Cloud, Defender for Office 365, Exchange Online Protection, and Sentinel analytics rules. This is one of the strongest implementations in the EP.

---

### 31. SI.L2-3.14.7 -- Unauthorized Use Detection

**Domain Store (SML-011):** Detection rules for unauthorized system use patterns.

**EP Implementation:** `step_task_SI.L2-3.14.7` runs 3 sub-commands:
- `SI.L2-3.14.7.threat-intel` -- Sentinel threat intelligence data connectors
- `SI.L2-3.14.7.security-alerts-evidence` -- security alert and detection rule evidence
- `AZ-SEN-010` -- enable Sentinel UEBA for anomalous behavior detection (set + get)

**Fidelity: FAITHFUL.** UEBA (User and Entity Behavior Analytics) is specifically designed to detect unauthorized use patterns through behavioral anomaly detection. Combined with threat intelligence connectors and detection rules, this comprehensively addresses the domain pattern.

---

## Overall Statistics

| Rating | Count | Percentage |
|--------|-------|------------|
| FAITHFUL | 19 | 61.3% |
| PARTIAL | 11 | 35.5% |
| DIVERGENT | 1 | 3.2% |
| MISSING | 0 | 0.0% |
| **Total** | **31** | **100%** |

### By Family

| Family | Controls Analyzed | Faithful | Partial | Divergent |
|--------|------------------|----------|---------|-----------|
| AC | 9 | 6 | 3 | 0 |
| AT | 1 | 0 | 1 | 0 |
| AU | 4 | 3 | 1 | 0 |
| CM | 4 | 1 | 3 | 0 |
| IA | 3 | 1 | 2 | 0 |
| IR | 1 | 0 | 0 | 1 |
| MA | 1 | 1 | 0 | 0 |
| MP | 1 | 1 | 0 | 0 |
| PE | 1 | 1 | 0 | 0 |
| PS | 1 | 0 | 1 | 0 |
| RA | 1 | 0 | 1 | 0 |
| SC | 2 | 2 | 0 | 0 |
| SI | 2 | 2 | 0 | 0 |

---

## Key Recommendations

### Critical (DIVERGENT -- fix immediately)

1. **IR.L2-3.6.1 -- Incident Response Planning:** The EP configures detection tools (ATP, malware filters) under the IR.L2-3.6.1 step, but the control requires an IR *plan* (policy document). Consider either:
   - Adding a manual gate or document-renderable step that collects/verifies the IR plan document
   - Re-labeling the existing step's control mapping to SI.L1-3.14.2 (malware protection) and creating a separate IR.L2-3.6.1 step for the plan

### High Priority (PARTIAL -- close gaps)

2. **IA.L2-3.5.3 -- MFA Enforcement:** The EP enables auth methods but needs an explicit CA policy requiring MFA for all access paths. Consider adding a sub-command that creates or verifies a CA policy with `grantControls.builtInControls=@('mfa')`.

3. **AC.L2-3.1.1 -- Account Lifecycle:** Add sub-commands for:
   - Account expiration policy (Entra ID sign-in activity-based conditional access)
   - Evidence of periodic access review configuration

4. **CM.L2-3.4.8 -- Application Allowlisting:** Upgrade from document-renderable to implement directive. Consider deploying Windows Defender Application Control (WDAC) policies via Intune to enforce deny-by-default.

5. **CM.L2-3.4.2 -- Security Configuration:** The ASR rules are only one facet. Consider deploying a broader CIS benchmark profile via Intune configuration profiles or referencing the Windows Security Baseline (deployed in CM.L2-3.4.1) as covering this requirement.

### Medium Priority (PARTIAL -- improve evidence)

6. **AC.L2-3.1.8 -- Smart Lockout:** Add a set_command to explicitly configure lockout threshold and duration, or add evidence commands that verify the specific threshold values match organizational policy.

7. **IA.L2-3.5.7 -- Password Complexity:** Add evidence commands that extract the current password policy settings (minimum length, complexity requirements) from the Entra ID domain settings.

8. **AC.L2-3.1.12 -- Remote Access Monitoring:** The named location is a prerequisite, not monitoring. Consider adding Sentinel analytics rules for remote access session monitoring (sign-in logs from non-trusted locations).

9. **RA.L2-3.11.2 -- Vulnerability Scanning:** Consider adding a sub-command that verifies Defender Vulnerability Management scan schedule configuration, not just results.

10. **AU.L2-3.3.5 -- Audit Correlation:** Consider adding Sentinel analytics rule references to this step, since correlation rules already exist but are attributed to other controls.

### Low Priority (PARTIAL -- acceptable workarounds)

11. **AT.L2-3.2.1 / PS.L2-3.9.1 -- Human Process Controls:** Manual gates are the correct approach for training and personnel screening. No technical change needed; consider adding links to training platform documentation in the step notes.

12. **CM.L2-3.4.6 -- Least Functionality:** Cortana/MSIA disablement is a start. The Windows Security Baseline (CM.L2-3.4.1) and ASR rules (CM.L2-3.4.2) cover additional service hardening. Consider cross-referencing these steps.

---

## Architectural Observations

### Strengths
- **Audit & Monitoring (AU/SI):** The EP's strongest area. AU.L2-3.3.1 alone has 27 sub-commands spanning Exchange, Azure, and Sentinel. Multi-layer monitoring with immutable storage is excellent.
- **FedRAMP Inheritance:** PE controls correctly handled as inherited with contradicting-config verification -- a smart approach for cloud-native architectures.
- **Creative Directives:** The document-prohibition (AC.L2-3.1.19, CM.L2-3.4.6) and document-renderable (CM.L2-3.4.8, RA.L2-3.11.2) directives show mature handling of controls that cannot be purely automated.

### Weaknesses
- **Account Lifecycle (AC family):** Strong on provisioning and access gating, weak on deprovision and periodic review.
- **Configuration Management (CM family):** Baseline deployment is solid, but STIG/CIS enforcement depth and application control lag behind domain expectations.
- **Identity Assurance (IA family):** Auth methods are enabled, but explicit MFA *enforcement* via CA policies is not clearly attributed to the IA.L2-3.5.3 step.

### Structural Pattern
The EP uses a "wide graph" approach where a single control often appears in multiple steps (e.g., AU.L2-3.3.1 appears in 9 steps). While this provides defense-in-depth, it makes it harder to assess whether a single control's requirements are fully met. The domain store uses a 1:1 pattern-to-control mapping, which is cleaner for assessment purposes.
