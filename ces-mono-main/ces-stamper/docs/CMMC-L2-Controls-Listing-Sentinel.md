# CMMC Level 2 Controls Listing -- M365 GCC High G5 + Sentinel SI Baseline

**Prepared by:** Blue Heron Defense, LLC
**Target Environment:** Microsoft 365 GCC High + Microsoft Sentinel (no full Azure infrastructure)
**License Tier:** Microsoft 365 G5 (Government)
**Date:** March 2026
**Controls Covered:** 110 (all CMMC Level 2 practices)

---

## Strategic Intent (SI) Baseline Parameters

This document is tailored to the following SI baseline:

| Parameter | Value |
|---|---|
| BYOD | Allowed |
| Mobile devices | Not permitted in CUI enclave |
| Wireless networks | Not present in CUI boundary |
| Removable media | Blocked by policy and technical control |
| Remote access | Permitted |
| Nonlocal maintenance | Not performed |
| CUI endpoint posture | Browser-only (no CUI stored at rest on endpoints) |
| Infrastructure model | M365 + Sentinel (no full Azure Gov subscription) |

**Controls marked N/A:** 9 (justified by SI decisions above)
**Controls with M365+Sentinel alternative:** 6 (substitute M365-native capabilities for full Azure services)
**Controls in full scope:** 101

---

## Family Coverage Summary

| Family | Name | Total | In Scope | N/A | M365+Sentinel Alt. |
|--------|------|-------|----------|-----|---------------------|
| AC | Access Control | 22 | 18 | 4 | 0 |
| AT | Awareness and Training | 3 | 3 | 0 | 0 |
| AU | Audit and Accountability | 9 | 9 | 0 | 2 |
| CM | Configuration Management | 9 | 9 | 0 | 0 |
| IA | Identification and Authentication | 11 | 11 | 0 | 0 |
| IR | Incident Response | 3 | 3 | 0 | 0 |
| MA | Maintenance | 6 | 5 | 1 | 0 |
| MP | Media Protection | 9 | 7 | 2 | 0 |
| PE | Physical Protection | 6 | 5 | 1 | 0 |
| PS | Personnel Security | 2 | 2 | 0 | 0 |
| RA | Risk Assessment | 3 | 3 | 0 | 0 |
| CA | Security Assessment | 4 | 4 | 0 | 0 |
| SC | Systems and Communications Protection | 16 | 15 | 1 | 4 |
| SI | System and Information Integrity | 7 | 7 | 0 | 0 |
| **Total** | | **110** | **101** | **9** | **6** |

---

## AC -- Access Control (22 controls)

### AC.L1-3.1.1 -- Limit System Access to Authorized Users
**NIST 3.1.1 | Level 1 | SPRS Weight: 5**

> Limit information system access to authorized users, processes acting on behalf of authorized users or devices.

- Create a dedicated CUI Security Group in Entra ID containing only authorized personnel
- Assign Conditional Access policies scoped to the CUI Security Group requiring compliant device and MFA
- Block all access from non-compliant devices via Intune compliance policy
- Service principals and managed identities scoped to least-privilege Graph API permissions

---

### AC.L1-3.1.2 -- Limit Access to Authorized Transactions/Functions
**NIST 3.1.2 | Level 1 | SPRS Weight: 5**

> Limit information system access to the types of transactions and functions that authorized users are permitted to execute.

- RBAC role assignments scoped to CUI Security Group (Exchange Admin, SharePoint Admin, etc.)
- Entra ID Privileged Identity Management (PIM) for just-in-time privilege elevation
- SharePoint site-level permissions restrict CUI document libraries to authorized users
- Sensitivity labels with encryption restrict file-level access to designated recipients

---

### AC.L2-3.1.3 -- Control CUI Flow
**NIST 3.1.3 | Level 2 | SPRS Weight: 5**

> Control the flow of CUI in accordance with approved authorizations.

- Information Barriers in Purview create user segments preventing cross-segment communication
- DLP policies detect and block CUI transmission to unauthorized recipients
- Sensitivity labels with auto-labeling rules applied to documents and emails containing CUI patterns
- Exchange Online mail flow rules prevent forwarding CUI-labeled emails to external domains
- Teams DLP policies prevent sharing CUI content in unauthorized channels

---

### AC.L2-3.1.4 -- Separation of Duties
**NIST 3.1.4 | Level 2 | SPRS Weight: 3**

> Separate the duties of individuals to reduce the risk of malevolent activity without collusion.

- PIM approval workflows require a different administrator to approve privilege escalation
- Global Admin and Security Admin roles assigned to separate individuals
- Compliance Admin role separated from Exchange Admin
- Administrative units in Entra ID scope admin privileges to specific organizational units

---

### AC.L2-3.1.5 -- Least Privilege
**NIST 3.1.5 | Level 2 | SPRS Weight: 5**

> Employ the principle of least privilege, including for specific security functions and privileged accounts.

- PIM just-in-time eligible role assignments with maximum 8-hour activation window
- No standing Global Admin assignments; all privileged roles require activation
- Application consent workflow requires admin approval for OAuth grants
- Regular access reviews via Entra ID Access Reviews (quarterly)

---

### AC.L2-3.1.6 -- Non-Privileged Accounts for Non-Security Functions
**NIST 3.1.6 | Level 2 | SPRS Weight: 1**

> Use non-privileged accounts or roles when accessing non-security functions.

- Dedicated admin accounts (e.g., `admin-jsmith@tenant.us`) separate from daily-use accounts
- Conditional Access policy blocks admin accounts from non-admin workloads (email, Teams, SharePoint)
- PIM enforces time-bound activation so admin privileges automatically expire
- Break-glass accounts stored securely with access logging enabled

---

### AC.L2-3.1.7 -- Prevent Non-Privileged Users from Executing Privileged Functions
**NIST 3.1.7 | Level 2 | SPRS Weight: 1**

> Prevent non-privileged users from executing privileged functions and capture the execution of such functions in audit logs.

- PIM eligible role assignments prevent standing admin access for non-privileged users
- Unified Audit Log captures all privilege escalation events (RoleElevated, Add member to role)
- Conditional Access blocks admin portal access from non-compliant devices
- Purview Audit Premium retains privileged operation logs for 365 days

---

### AC.L2-3.1.8 -- Limit Unsuccessful Logon Attempts
**NIST 3.1.8 | Level 2 | SPRS Weight: 3**

> Limit unsuccessful logon attempts.

- Entra ID Smart Lockout: 10 failed attempts triggers 60-second lockout, escalating with repeat failures
- Custom banned password list blocks common and weak passwords
- Conditional Access risk-based policy blocks sign-ins flagged as high risk by Identity Protection
- Password Protection applied to on-premises AD (if hybrid) via Entra ID Password Protection proxy

---

### AC.L2-3.1.9 -- Privacy and Security Notices
**NIST 3.1.9 | Level 2 | SPRS Weight: 1**

> Provide privacy and security notices consistent with applicable CUI rules.

- Entra ID custom branding: login page displays CUI handling notice and authorized-use warning
- Terms of Use policy in Conditional Access requires user acceptance before granting access
- SharePoint CUI site home page displays handling instructions
- Email disclaimer transport rule appends CUI handling notice to outbound messages

---

### AC.L2-3.1.10 -- Session Lock
**NIST 3.1.10 | Level 2 | SPRS Weight: 3**

> Use session lock with pattern-hiding displays to prevent access and viewing of data after a period of inactivity.

- Intune device configuration policy: screen lock timeout set to 15 minutes
- Windows Hello for Business requires re-authentication after screen lock
- Pattern-hiding: Windows lock screen configured via Intune to show no notification content
- Conditional Access sign-in frequency policy forces reauthentication after 8 hours

---

### AC.L2-3.1.11 -- Terminate Sessions After Defined Condition
**NIST 3.1.11 | Level 2 | SPRS Weight: 3**

> Terminate (automatically) user sessions after a defined condition.

- Conditional Access session controls: sign-in frequency = 8 hours, persistent browser session disabled
- SharePoint idle session timeout = 15 minutes for unmanaged devices
- Teams web session timeout inherits Conditional Access policy
- Token lifetime policies: refresh token max inactive time = 24 hours

---

### AC.L2-3.1.12 -- Monitor and Control Remote Access
**NIST 3.1.12 | Level 2 | SPRS Weight: 5**

> Monitor and control remote access sessions.

- Conditional Access named locations define trusted corporate networks
- Sign-ins from outside named locations require MFA and compliant device
- Entra ID sign-in logs capture source IP, location, and device state for all remote sessions
- Defender for Cloud Apps session policies monitor and can block risky remote file downloads

---

### AC.L2-3.1.13 -- Encrypt Remote Access Sessions
**NIST 3.1.13 | Level 2 | SPRS Weight: 5**

> Employ cryptographic mechanisms to protect the confidentiality of remote access sessions.

- All M365 GCC High traffic is TLS 1.2+ encrypted (platform-enforced)
- Conditional Access requires compliant device with BitLocker enabled
- Exchange Online Outlook connections use TLS; SMTP relay requires STARTTLS
- Sensitivity labels add file-level encryption for CUI documents accessed remotely

---

### AC.L2-3.1.14 -- Route Remote Access via Managed Access Control Points
**NIST 3.1.14 | Level 2 | SPRS Weight: 5**

> Route remote access via managed access control points.

**N/A -- No wireless networks in CUI enclave per Strategic Intent baseline.**

SI Decision: `wireless_posture = 'no_wireless'`. No wireless access paths exist in the CUI boundary, making this control not applicable. All access routes through wired connections to M365 GCC High via Entra ID Conditional Access as the managed control point, which is covered under AC.L2-3.1.12.

---

### AC.L2-3.1.15 -- Authorize Remote Execution of Privileged Commands
**NIST 3.1.15 | Level 2 | SPRS Weight: 5**

> Authorize remote execution of privileged commands and remote access to security-relevant information.

- PIM requires justification and approval for remote privilege activation
- Conditional Access blocks admin portals from non-compliant or non-corporate devices
- Privileged Access Workstations (PAWs) enforced via Intune compliance for admin accounts
- All admin actions logged in Unified Audit Log with 365-day retention (G5)

---

### AC.L2-3.1.16 -- Authorize Wireless Access
**NIST 3.1.16 | Level 2 | SPRS Weight: 1**

> Authorize wireless access prior to allowing such connections.

**N/A -- No wireless networks in CUI enclave per Strategic Intent baseline.**

SI Decision: `wireless_posture = 'no_wireless'`. No wireless networks exist within the CUI boundary. All network access is wired. This control is not applicable because there are no wireless connections to authorize.

---

### AC.L2-3.1.17 -- Protect Wireless Access
**NIST 3.1.17 | Level 2 | SPRS Weight: 3**

> Protect wireless access using authentication and encryption.

- WPA3-Enterprise (or WPA2-Enterprise minimum) required on any CUI-accessible network
- 802.1X with RADIUS/NPS and Entra ID certificate-based authentication
- Intune compliance policy marks devices connected to unauthorized SSIDs as non-compliant
- Network encryption: AES-256 for wireless frames

Note: While the SI baseline specifies no wireless in the CUI boundary, this control remains in scope because wireless networks may exist in the broader organizational environment adjacent to the CUI enclave. Wireless protection prevents lateral movement into the CUI boundary.

---

### AC.L2-3.1.18 -- Control Mobile Devices
**NIST 3.1.18 | Level 2 | SPRS Weight: 3**

> Control connection of mobile devices.

**N/A -- No mobile devices in CUI enclave per Strategic Intent baseline.**

SI Decision: `mobile_device_presence = 'no_mobile_devices'`. No smartphones, tablets, or other mobile endpoints access CUI data. Conditional Access policies block mobile platforms (iOS, Android) from accessing M365 CUI resources. This control is not applicable because there are no mobile devices to control.

---

### AC.L2-3.1.19 -- Encrypt CUI on Mobile Devices
**NIST 3.1.19 | Level 2 | SPRS Weight: 3**

> Encrypt CUI on mobile devices and mobile computing platforms.

**N/A -- No mobile devices in CUI enclave per Strategic Intent baseline.**

SI Decision: `mobile_device_presence = 'no_mobile_devices'`. No mobile devices access or store CUI. This control is not applicable because there are no mobile devices or mobile computing platforms on which CUI could reside.

---

### AC.L1-3.1.20 -- Verify/Control External System Connections
**NIST 3.1.20 | Level 1 | SPRS Weight: 5**

> Verify and control/limit connections to and use of external information systems.

- Entra ID External Collaboration Settings restrict guest invitations to specific domains
- Cross-tenant access policies define allowed external tenants and access levels
- Conditional Access blocks access from unmanaged/external devices to CUI resources
- SharePoint external sharing disabled for CUI sites
- Defender for Cloud Apps shadow IT discovery identifies unauthorized SaaS usage

---

### AC.L2-3.1.21 -- Limit Portable Storage on External Systems
**NIST 3.1.21 | Level 2 | SPRS Weight: 1**

> Limit use of portable storage devices on external systems.

- Intune device restriction policy blocks USB mass storage devices
- Windows Defender Device Control policies restrict removable media access
- DLP endpoint policies detect and block CUI transfer to USB drives
- Removable media blocked organization-wide per SI baseline (enforced by Defender for Endpoint device control)

---

### AC.L1-3.1.22 -- Control Publicly Accessible Information
**NIST 3.1.22 | Level 1 | SPRS Weight: 5**

> Control information posted or processed on publicly accessible information systems.

- SharePoint external sharing disabled or tightly restricted for all CUI site collections
- DLP policies prevent CUI-labeled content from being shared externally
- Sensitivity labels with "Do Not Forward" and encryption prevent public disclosure
- Exchange Online transport rules block CUI auto-forwarding to external recipients

---

## AT -- Awareness and Training (3 controls)

### AT.L2-3.2.1 -- Security Awareness
**NIST 3.2.1 | Level 2 | SPRS Weight: 3**

> Ensure that managers, system administrators and users are made aware of security risks and applicable policies.

- Attack Simulation Training (Defender for Office 365 P2): phishing simulations with automated training
- Security awareness training program documented in SSP with annual completion records
- Entra ID Terms of Use: annual re-acceptance of acceptable use policy
- Compliance Manager improvement action tracks CUI handling training completion

---

### AT.L2-3.2.2 -- Role-Based Security Training
**NIST 3.2.2 | Level 2 | SPRS Weight: 3**

> Ensure that personnel are trained to carry out their assigned information security duties.

- Admin-specific training for PIM, Conditional Access, and DLP policy management
- Incident responders trained on Defender XDR investigation workflows
- Training records maintained in SharePoint with Purview retention policy
- Annual role-based training curriculum documented in SSP

---

### AT.L2-3.2.3 -- Insider Threat Awareness
**NIST 3.2.3 | Level 2 | SPRS Weight: 3**

> Provide security awareness training on recognizing and reporting potential indicators of insider threat.

- Purview Insider Risk Management configured with insider risk indicators and policies
- Training module covers data exfiltration patterns, behavioral indicators, and reporting procedures
- Anonymous reporting channel documented and communicated to all personnel
- Insider threat training completion certificates stored in SharePoint with retention policy

---

## AU -- Audit and Accountability (9 controls)

### AU.L2-3.3.1 -- Create and Retain Audit Logs
**NIST 3.3.1 | Level 2 | SPRS Weight: 5**

> Create and retain system audit logs and records to enable monitoring, analysis, investigation, and reporting.

- Purview Audit Premium (G5): 365-day audit log retention for all M365 services
- Unified Audit Log captures sign-ins, mailbox access, SharePoint file operations, Teams events, admin actions
- Sentinel workspace ingests Entra ID sign-in and audit logs via diagnostic settings connector
- Purview retention lock provides immutable audit log storage

---

### AU.L2-3.3.2 -- Individual Accountability
**NIST 3.3.2 | Level 2 | SPRS Weight: 5**

> Ensure that actions of individual system users can be uniquely traced to those users.

- Entra ID assigns unique Object ID to every user, service principal, and managed identity
- Unified Audit Log records UserId (UPN) with every audited action
- Shared mailboxes: Send As and Send on Behalf auditing identifies the acting user
- Purview Audit Premium MailItemsAccessed records identify who read which emails

---

### AU.L2-3.3.3 -- Review and Update Logged Events
**NIST 3.3.3 | Level 2 | SPRS Weight: 3**

> Review and update logged events.

- Defender XDR Advanced Hunting: scheduled queries for authentication failures, privilege escalations, DLP violations
- Weekly/monthly audit log review process documented in SSP
- Purview Audit search with saved queries for recurring reviews

**M365+Sentinel Alternative:**
- Purview Audit Premium search with saved queries replaces full Sentinel workbook dashboards
- Defender XDR Advanced Hunting scheduled queries provide automated review capability
- Export review results to SharePoint document library for quarterly review records

---

### AU.L2-3.3.4 -- Alert on Audit Process Failure
**NIST 3.3.4 | Level 2 | SPRS Weight: 3**

> Alert in the event of an audit logging process failure.

- Service Health alerts for M365 audit service degradation
- Defender for Cloud alert triggers on diagnostic settings removal

**M365+Sentinel Alternative:**
- Defender XDR custom detection rules monitoring Purview Audit log ingestion gaps
- Power Automate flow: alert SOC mailbox if no Purview Audit events for 60 minutes
- Service Health notifications for audit service availability issues

---

### AU.L2-3.3.5 -- Correlate Audit Records
**NIST 3.3.5 | Level 2 | SPRS Weight: 3**

> Correlate audit record review, analysis and reporting for investigation and response.

- Sentinel cross-correlates Entra ID sign-ins, Office 365 audit logs, and Defender alerts into incidents
- Defender XDR unified incident view correlating email, identity, endpoint, and cloud app signals
- Advanced Hunting (KQL) queries join data across tables for investigation
- Incident timeline view in Defender XDR shows correlated attack chain

---

### AU.L2-3.3.6 -- Audit Reduction and Report Generation
**NIST 3.3.6 | Level 2 | SPRS Weight: 3**

> Provide audit record reduction and report generation to support on-demand analysis.

- Purview Audit search: filter by date, user, activity, and record type
- Defender XDR: export hunting query results to CSV
- Sentinel KQL queries with summarize, project, and render operators for report generation
- Power BI connected to M365 audit data for executive dashboards

---

### AU.L2-3.3.7 -- Authoritative Time Source
**NIST 3.3.7 | Level 2 | SPRS Weight: 1**

> Compare and synchronize internal system clocks with an authoritative source to generate time stamps.

- M365 GCC High: Microsoft manages NTP synchronization for all cloud services (platform-inherent)
- All audit log timestamps use UTC from Microsoft's authoritative time source
- Windows endpoints: Intune policy configures W32Time service to sync with time.windows.com or customer NTP
- No customer action required for cloud service time synchronization

---

### AU.L2-3.3.8 -- Protect Audit Information
**NIST 3.3.8 | Level 2 | SPRS Weight: 3**

> Protect audit information and audit logging tools from unauthorized access, modification, and deletion.

- Purview Audit log access restricted to Compliance Administrator and Security Reader roles
- RBAC removes audit log access from non-security admin roles
- Sentinel workspace RBAC limits query access to Security Operations team
- Purview retention lock prevents audit log deletion for the configured retention period

---

### AU.L2-3.3.9 -- Limit Audit Management
**NIST 3.3.9 | Level 2 | SPRS Weight: 3**

> Limit management of audit logging functionality to a subset of privileged users.

- Only Compliance Administrator and Global Administrator can modify audit policies
- PIM: audit management roles require JIT activation with justification
- Remove audit-related permissions from custom admin roles
- Monitor changes to audit configuration via Defender for Office 365 alert policies

---

## CM -- Configuration Management (9 controls)

### CM.L2-3.4.1 -- Baseline Configurations
**NIST 3.4.1 | Level 2 | SPRS Weight: 5**

> Establish and maintain baseline configurations and inventories throughout the system development life cycle.

- Intune: Windows Security Baseline profile applied to all managed devices
- CIS Benchmark Level 2 profile for Windows 10/11 deployed via Intune
- Device inventory maintained in Intune and Defender for Endpoint
- Software inventory via Defender Vulnerability Management

---

### CM.L2-3.4.2 -- Security Configuration Settings
**NIST 3.4.2 | Level 2 | SPRS Weight: 3**

> Establish and enforce security configuration settings for IT products.

- Attack Surface Reduction (ASR) rules enabled via Intune
- Microsoft Defender Antivirus: real-time protection, cloud-delivered protection, automatic sample submission
- Browser security: Microsoft Edge security baseline via Intune
- Office 365 macro execution policies and protected view settings via Intune administrative templates

---

### CM.L2-3.4.3 -- Track/Review/Approve Changes
**NIST 3.4.3 | Level 2 | SPRS Weight: 3**

> Track, review, approve or disapprove and log changes to organizational systems.

- Entra ID Audit Log tracks all directory changes (user, group, policy modifications)
- Exchange Online admin audit log captures mailbox and transport rule changes
- Intune configuration profile change tracking with assignment history
- Change management process documented in SSP with approval workflow

---

### CM.L2-3.4.4 -- Security Impact Analysis
**NIST 3.4.4 | Level 2 | SPRS Weight: 3**

> Analyze the security impact of changes prior to implementation.

- Conditional Access "What If" tool to test policy changes before deployment
- Intune scope tags and pilot groups to test configuration changes on subset of devices
- Microsoft Secure Score: assess impact of proposed changes on security posture
- Documented change management procedure requires security review before production deployment

---

### CM.L2-3.4.5 -- Access Restrictions for Changes
**NIST 3.4.5 | Level 2 | SPRS Weight: 3**

> Define, document, approve and enforce physical and logical access restrictions associated with changes.

- PIM: configuration changes require admin role activation with approval
- Conditional Access: admin portal access restricted to PAWs or compliant devices from named locations
- RBAC: least-privilege role assignments for configuration management (Intune Administrator vs. Global Admin)
- Sentinel alert rule triggers on unexpected Entra ID directory role changes

---

### CM.L2-3.4.6 -- Least Functionality
**NIST 3.4.6 | Level 2 | SPRS Weight: 3**

> Employ the principle of least functionality by configuring systems to provide only essential capabilities.

- Disable unnecessary M365 services (Sway, Delve) via service-level controls
- Intune: disable Windows optional features not required for CUI processing
- Remove default apps via Intune PowerShell scripts during device provisioning
- SharePoint: disable self-service site creation

---

### CM.L2-3.4.7 -- Restrict Nonessential Programs
**NIST 3.4.7 | Level 2 | SPRS Weight: 3**

> Restrict, disable or prevent the use of nonessential programs, functions, ports, protocols and services.

- Windows Defender Application Control (WDAC): deny-by-default, allow only approved applications
- Intune: block installation of unapproved applications
- Windows Firewall profiles via Intune: block unnecessary inbound/outbound ports
- Disable unnecessary Windows services via Intune PowerShell scripts

---

### CM.L2-3.4.8 -- Application Allow/Deny Lists
**NIST 3.4.8 | Level 2 | SPRS Weight: 1**

> Apply deny-by-exception or permit-by-exception policy for software execution.

- WDAC permit-by-exception (whitelisting): only Microsoft-signed and IT-approved applications execute
- AppLocker as complementary control for user-space applications
- Intune application deployment whitelist: only approved apps pushed to devices
- Defender for Endpoint application control recommendations from Vulnerability Management

---

### CM.L2-3.4.9 -- Control User-Installed Software
**NIST 3.4.9 | Level 2 | SPRS Weight: 1**

> Control and monitor user-installed software.

- Standard user accounts (non-admin) cannot install software on managed devices
- Intune: deploy approved applications via Company Portal
- WDAC prevents execution of unapproved software even if side-loaded
- Defender for Endpoint software inventory tracks all installed applications

---

## IA -- Identification and Authentication (11 controls)

### IA.L1-3.5.1 -- Identify Users
**NIST 3.5.1 | Level 1 | SPRS Weight: 5**

> Identify information system users, processes acting on behalf of users or devices.

- Entra ID: every user has a unique UPN and Object ID
- Service principals and managed identities identify automated processes
- Device objects in Entra ID identify registered and joined devices
- Conditional Access evaluates user, device, and application identity before granting access

---

### IA.L1-3.5.2 -- Authenticate Users
**NIST 3.5.2 | Level 1 | SPRS Weight: 5**

> Authenticate the identities of users, processes, or devices as a prerequisite to allowing access.

- Entra ID authentication: password plus MFA required for all users
- Device authentication: Entra ID join or hybrid join with device certificate
- Service authentication: client certificates or managed identity tokens
- Conditional Access authentication strength policies enforce approved methods

---

### IA.L2-3.5.3 -- Multi-Factor Authentication
**NIST 3.5.3 | Level 2 | SPRS Weight: 5**

> Use multi-factor authentication for local and network access to privileged accounts and for network access to non-privileged accounts.

- Microsoft Authenticator push notifications with number matching for all users
- FIDO2 security keys enabled for privileged accounts (phishing-resistant)
- Conditional Access: require MFA for all sign-ins (privileged and non-privileged)
- Authentication strength policy: require phishing-resistant methods for admin roles
- Windows Hello for Business for local workstation authentication

---

### IA.L2-3.5.4 -- Replay-Resistant Authentication
**NIST 3.5.4 | Level 2 | SPRS Weight: 3**

> Employ replay-resistant authentication mechanisms for network access.

- FIDO2/WebAuthn: challenge-response with cryptographic nonce (inherently replay-resistant)
- Microsoft Authenticator: time-based push with number matching (replay-resistant)
- Certificate-based authentication with TLS client certificates
- OAuth 2.0 token binding prevents token replay across sessions

---

### IA.L2-3.5.5 -- Prevent Identifier Reuse
**NIST 3.5.5 | Level 2 | SPRS Weight: 1**

> Prevent the reuse of identifiers for a defined period.

- Entra ID: deleted user UPNs cannot be reassigned for 30 days (soft-delete retention)
- Disabled accounts retained in Entra ID for 90 days before hard deletion
- Service principal App IDs are globally unique GUIDs (never reused)
- Documented policy: identifiers remain reserved for 90 days after deprovisioning

---

### IA.L2-3.5.6 -- Disable Inactive Identifiers
**NIST 3.5.6 | Level 2 | SPRS Weight: 1**

> Disable identifiers after a defined period of inactivity.

- Entra ID Access Reviews: automated review flags accounts with no sign-in for 90 days
- Power Automate or Logic App disables accounts with no sign-in for 90+ days
- Conditional Access blocks sign-in for accounts flagged as inactive
- Monthly export of last sign-in dates from Entra ID for management review

---

### IA.L2-3.5.7 -- Password Complexity
**NIST 3.5.7 | Level 2 | SPRS Weight: 3**

> Enforce a minimum password complexity and change of characters when new passwords are created.

- Entra ID: minimum 14 characters via authentication methods policy
- Custom banned password list blocks organization-specific terms
- Smart Lockout detects and blocks brute-force attempts
- NIST 800-63B alignment: complexity based on length and banned list rather than periodic rotation

---

### IA.L2-3.5.8 -- Prohibit Password Reuse
**NIST 3.5.8 | Level 2 | SPRS Weight: 1**

> Prohibit password reuse for a specified number of generations.

- Entra ID: password history enforcement (platform-managed)
- On-premises AD (if hybrid): Group Policy enforces 24-generation password history
- Self-Service Password Reset (SSPR) enforces history check on password change
- NIST 800-63B de-emphasizes password history in favor of banned-word lists and length requirements

---

### IA.L2-3.5.9 -- Temporary Passwords
**NIST 3.5.9 | Level 2 | SPRS Weight: 1**

> Allow temporary password use for system logons with an immediate change to a permanent password.

- Entra ID: "User must change password at next sign-in" flag set on temporary password issuance
- Temporary Access Pass (TAP) for onboarding: one-time or time-limited use
- Documented process: admin issues TAP, user completes FIDO2/Authenticator registration, TAP expires
- SSPR forces immediate password change when admin resets password

---

### IA.L2-3.5.10 -- Cryptographically Protected Passwords
**NIST 3.5.10 | Level 2 | SPRS Weight: 3**

> Store and transmit only cryptographically protected passwords.

- Entra ID: passwords stored as salted hashes (never plaintext)
- All authentication traffic encrypted via TLS 1.2+ (platform-enforced)
- Password Hash Sync (hybrid): SHA-256 hash transmitted over encrypted channel
- No legacy protocols (NTLM, Kerberos without armoring) for cloud authentication

---

### IA.L2-3.5.11 -- Obscure Authentication Feedback
**NIST 3.5.11 | Level 2 | SPRS Weight: 1**

> Obscure feedback of authentication information.

- Entra ID sign-in page: password field masked with asterisks/dots (platform default)
- Windows sign-in: password reveal button shows password only while held (configurable via Intune)
- Error messages on failed authentication are generic ("Sign-in failed") without revealing which factor failed
- MFA prompts do not reveal the second factor type to unauthorized parties

---

## IR -- Incident Response (3 controls)

### IR.L2-3.6.1 -- Incident Handling Capability
**NIST 3.6.1 | Level 2 | SPRS Weight: 3**

> Establish an operational incident-handling capability including preparation, detection, analysis, containment, recovery, and user response.

- Defender XDR unified incident queue with automated investigation and response (AIR)
- Incident Response Plan documented in SSP appendix with roles, escalation paths, communication templates
- Defender for Endpoint: automated containment (isolate device, block file, quarantine email)
- Sentinel SOAR playbooks automate response actions for common incident types
- Tabletop exercises conducted annually with documented results

---

### IR.L2-3.6.2 -- Track and Report Incidents
**NIST 3.6.2 | Level 2 | SPRS Weight: 3**

> Track, document and report incidents to designated officials and/or authorities.

- Defender XDR incident queue tracks incidents with severity, status, assignment, and timeline
- Sentinel incident tracking with SLA monitoring and auto-assignment rules
- DIBCAC reporting: documented procedure for reporting cyber incidents to DoD within 72 hours
- Incident log maintained in SharePoint with Purview legal hold for evidence preservation

---

### IR.L2-3.6.3 -- Test Incident Response
**NIST 3.6.3 | Level 2 | SPRS Weight: 3**

> Test the organizational incident response capability.

- Annual tabletop exercise simulating CUI breach scenario
- Attack Simulation Training: phishing test campaigns with automated training for failures
- Defender XDR simulated attack scenarios (Attack Simulation in evaluation mode)
- Post-exercise lessons learned documented and IRP updated accordingly
- Exercise reports with participant list, scenario description, findings, and remediation actions

---

## MA -- Maintenance (6 controls)

### MA.L2-3.7.1 -- Perform System Maintenance
**NIST 3.7.1 | Level 2 | SPRS Weight: 3**

> Perform maintenance on organizational systems.

- Intune: Windows Update for Business manages OS patching with deployment rings (pilot to production)
- Defender Vulnerability Management identifies missing patches and prioritizes by CVSS
- M365 Apps update channel: Monthly Enterprise Channel for Office application updates
- Maintenance windows documented in SSP with change management process

---

### MA.L2-3.7.2 -- Controls on Maintenance Tools/Personnel
**NIST 3.7.2 | Level 2 | SPRS Weight: 3**

> Provide controls on the tools, techniques, mechanisms, and personnel used to conduct system maintenance.

- Admin tools limited to approved management consoles (Entra portal, Intune portal, Exchange Admin Center)
- Remote management only via approved channels (Intune, Microsoft Remote Desktop with MFA)
- Maintenance personnel: PIM-managed admin roles with time-bound activation
- Third-party maintenance: supervised access via PIM guest accounts with time-limited assignments

---

### MA.L2-3.7.3 -- Sanitize Equipment for Off-Site Maintenance
**NIST 3.7.3 | Level 2 | SPRS Weight: 3**

> Ensure equipment removed for off-site maintenance is sanitized of any CUI.

- Intune remote wipe: selective wipe removes corporate data before equipment leaves premises
- BitLocker full-disk encryption ensures data is inaccessible without recovery key
- Documented procedure: IT performs selective wipe and verifies before releasing equipment
- Hardware disposal: NIST 800-88 compliant media sanitization (clear, purge, or destroy)

---

### MA.L2-3.7.4 -- Check Maintenance Media for Malicious Code
**NIST 3.7.4 | Level 2 | SPRS Weight: 3**

> Check media containing diagnostic and test programs for malicious code before use.

**N/A -- No nonlocal maintenance performed per Strategic Intent baseline.**

SI Decision: `maintenance_posture = 'no_nonlocal'`. All system maintenance is performed locally by authorized personnel using managed devices. No maintenance media from external sources is introduced. Local maintenance scanning requirements are covered under MA.L2-3.7.1 and SI.L1-3.14.2.

---

### MA.L2-3.7.5 -- MFA for Nonlocal Maintenance
**NIST 3.7.5 | Level 2 | SPRS Weight: 3**

> Require multifactor authentication to establish nonlocal maintenance sessions and terminate such connections when complete.

- Conditional Access: require MFA plus compliant device for all admin portal access
- PIM: time-bound admin role activation automatically expires (terminates session authorization)
- Session timeout: Conditional Access sign-in frequency terminates idle admin sessions
- All maintenance sessions logged in Unified Audit Log

Note: While the SI baseline specifies no nonlocal maintenance, this control remains in scope because MFA requirements apply to all remote admin access, not exclusively to nonlocal maintenance scenarios. Cloud-based admin sessions via Entra portal, Intune, and Exchange Admin Center are inherently nonlocal.

---

### MA.L2-3.7.6 -- Supervise Maintenance Personnel
**NIST 3.7.6 | Level 2 | SPRS Weight: 1**

> Supervise maintenance activities of personnel without required access authorization.

- Guest access in Entra ID: time-limited with PIM, requires sponsor approval
- Defender XDR: real-time monitoring of guest/vendor account activity
- Audit logs capture all actions taken by guest accounts
- Documented procedure: vendor maintenance requires designated employee escort/supervision

---

## MP -- Media Protection (9 controls)

### MP.L2-3.8.1 -- Protect System Media
**NIST 3.8.1 | Level 2 | SPRS Weight: 3**

> Protect (physically control and securely store) system media containing CUI, both paper and digital.

- Digital media: BitLocker full-disk encryption on all managed devices
- SharePoint/OneDrive: sensitivity labels with encryption for CUI documents
- Paper media: documented physical security procedures (locked cabinets, controlled access rooms)
- Backup media: encrypted and stored in secured location per documented procedure

---

### MP.L2-3.8.2 -- Limit Access to CUI on Media
**NIST 3.8.2 | Level 2 | SPRS Weight: 1**

> Limit access to CUI on system media to authorized users.

- SharePoint site permissions: CUI libraries restricted to CUI Security Group members
- Sensitivity labels with encryption: only designated users can open CUI files
- OneDrive: sharing restricted for CUI-labeled files
- Physical media: access log maintained for media containing CUI

---

### MP.L1-3.8.3 -- Sanitize Media Before Disposal
**NIST 3.8.3 | Level 1 | SPRS Weight: 3**

> Sanitize or destroy information system media containing FCI before disposal or release for reuse.

- Intune remote wipe for devices being repurposed or disposed
- NIST 800-88 compliant media sanitization procedures documented
- BitLocker recovery key deleted from Entra ID before device disposal
- Paper shredding: cross-cut shredder (DIN 66399 Level P-4 minimum)

---

### MP.L2-3.8.4 -- Mark Media with CUI Markings
**NIST 3.8.4 | Level 2 | SPRS Weight: 1**

> Mark media with necessary CUI markings and distribution limitations.

- Sensitivity labels: "CUI" and "CUI//SP-..." labels with visual markings (headers, footers, watermarks)
- Auto-labeling policies in Purview detect CUI content patterns and apply labels
- Email sensitivity label adds "CONTROLLED UNCLASSIFIED INFORMATION" banner
- Physical media: documented labeling procedures for paper documents and any authorized devices

---

### MP.L2-3.8.5 -- Control CUI Media During Transport
**NIST 3.8.5 | Level 2 | SPRS Weight: 3**

> Control access to media containing CUI and maintain accountability during transport outside controlled areas.

**N/A -- Removable media prohibited by policy and technical control per Strategic Intent baseline.**

SI Decision: `removable_media_posture = 'blocked'`. No CUI is transported on removable media. Defender for Endpoint device control blocks all removable storage devices. DLP endpoint policies provide an additional enforcement layer. This control is not applicable because no removable media transport of CUI occurs.

---

### MP.L2-3.8.6 -- Encrypt CUI on Digital Media During Transport
**NIST 3.8.6 | Level 2 | SPRS Weight: 3**

> Implement cryptographic mechanisms to protect CUI stored on digital media during transport.

**N/A -- Removable media prohibited by policy and technical control per Strategic Intent baseline.**

SI Decision: `removable_media_posture = 'blocked'`. No CUI is stored on digital media for transport. All CUI transmission occurs via M365 GCC High services protected by TLS 1.2+ (platform-enforced). This control is not applicable because there is no digital media transport requiring cryptographic protection.

---

### MP.L2-3.8.7 -- Control Removable Media
**NIST 3.8.7 | Level 2 | SPRS Weight: 1**

> Control the use of removable media on system components.

- Defender for Endpoint device control policies block unauthorized USB devices
- Intune removable storage access control: read/write/execute restrictions
- All removable media blocked by default per SI baseline (no approved devices in CUI enclave)
- DLP endpoint policy blocks CUI transfer to any removable media

Note: While the SI baseline blocks removable media, this control remains in scope because it requires the organization to have technical controls enforcing the block. The Defender for Endpoint device control policy is the implementing mechanism.

---

### MP.L2-3.8.8 -- Prohibit Ownerless Portable Storage
**NIST 3.8.8 | Level 2 | SPRS Weight: 1**

> Prohibit the use of portable storage devices when such devices have no identifiable owner.

- Device control policy: only IT-provisioned USB devices (with asset tag) permitted
- Defender for Endpoint: block all removable storage by default, allowlist by hardware ID
- Documented policy: found/unmarked USB devices confiscated and scanned in isolated environment
- Intune USB device inventory linked to user assignment

Note: Per SI baseline, all removable media is blocked. This control is in scope to enforce that prohibition and address the unlikely scenario of an unauthorized device insertion.

---

### MP.L2-3.8.9 -- Protect Backup CUI
**NIST 3.8.9 | Level 2 | SPRS Weight: 1**

> Protect the confidentiality of backup CUI at storage locations.

- SharePoint/OneDrive: data at rest encrypted with Microsoft-managed keys or Customer Key
- Exchange Online: mailbox encryption at rest with service encryption
- Purview retention policies ensure CUI backups are retained for required period
- Sensitivity labels with encryption provide file-level protection for CUI backup data

---

## PE -- Physical Protection (6 controls)

### PE.L1-3.10.1 -- Limit Physical Access
**NIST 3.10.1 | Level 1 | SPRS Weight: 5**

> Limit physical access to organizational information systems, equipment, and operating environments to authorized individuals.

- Physical security controls: badge/key card access to CUI processing areas
- Visitor sign-in and escort procedures documented
- Server rooms (if on-premises components): locked with access limited to authorized IT staff
- Physical security policy documented in SSP

---

### PE.L2-3.10.2 -- Protect Physical Facility
**NIST 3.10.2 | Level 2 | SPRS Weight: 3**

> Protect and monitor the physical facility and support infrastructure.

- Surveillance cameras at entry points to CUI processing areas
- Environmental controls: fire suppression, HVAC, UPS for on-premises equipment
- Physical intrusion detection (alarm system) for after-hours protection
- Facility security procedures documented in SSP

---

### PE.L1-3.10.3 -- Escort Visitors
**NIST 3.10.3 | Level 1 | SPRS Weight: 5**

> Escort visitors and monitor visitor activity.

- Visitor management procedures: sign-in, badge, escort at all times in CUI areas
- Visitor log maintained with entry/exit times
- Visitors must surrender badges upon departure
- No unescorted visitor access to areas where CUI is processed, stored, or transmitted

---

### PE.L1-3.10.4 -- Physical Access Audit Logs
**NIST 3.10.4 | Level 1 | SPRS Weight: 1**

> Maintain audit logs of physical access.

- Badge reader logs capture entry/exit with timestamp and user identity
- Visitor logs maintained (paper or electronic) with 90-day minimum retention
- Surveillance camera recordings retained per organizational policy
- Periodic review of physical access logs documented

---

### PE.L1-3.10.5 -- Control Physical Access Devices
**NIST 3.10.5 | Level 1 | SPRS Weight: 1**

> Control and manage physical access devices.

- Badge/key card inventory maintained by facilities management
- Lost/stolen badges immediately deactivated
- Periodic audit of active badge assignments vs. authorized personnel list
- Key/combination changes when personnel with access depart

---

### PE.L2-3.10.6 -- Alternate Work Sites
**NIST 3.10.6 | Level 2 | SPRS Weight: 1**

> Enforce safeguarding measures for CUI at alternate work sites.

**N/A -- Browser-only CUI access means no CUI stored at rest on endpoints at alternate work sites per Strategic Intent baseline.**

SI Decision: `cui_endpoint_posture = 'browser_only'`. CUI is accessed exclusively via browser sessions to M365 GCC High. No CUI is downloaded to or stored on endpoints. Conditional Access session policies block file downloads to unmanaged devices. Because no CUI resides at rest at alternate work sites, the safeguarding measures for CUI at those locations are not applicable. Cloud-side protections (SharePoint encryption, Conditional Access, DLP) remain fully in scope.

---

## PS -- Personnel Security (2 controls)

### PS.L2-3.9.1 -- Screen Individuals
**NIST 3.9.1 | Level 2 | SPRS Weight: 3**

> Screen individuals prior to authorizing access to organizational systems containing CUI.

- Background investigation required before CUI access granted (customer HR responsibility)
- Entra ID: user account created only after screening completion
- Documented screening criteria in SSP (criminal background check, identity verification minimum)
- Contractor screening requirements specified in contract language

---

### PS.L2-3.9.2 -- Personnel Actions
**NIST 3.9.2 | Level 2 | SPRS Weight: 3**

> Ensure systems containing CUI are protected during and after personnel actions such as terminations and transfers.

- Offboarding procedure: disable Entra ID account within 24 hours of termination
- Intune remote wipe: selective wipe of corporate data from departing employee's devices
- OneDrive access transfer: manager receives access to departed employee's OneDrive
- PIM: remove all privileged role assignments immediately upon termination
- Badge/physical access revoked simultaneously with logical access

---

## RA -- Risk Assessment (3 controls)

### RA.L2-3.11.1 -- Risk Assessment
**NIST 3.11.1 | Level 2 | SPRS Weight: 3**

> Periodically assess risk to organizational operations, assets, and individuals.

- Microsoft Secure Score: continuous risk assessment with prioritized improvement actions
- Compliance Manager: CMMC L2 assessment template with automated scoring
- Annual risk assessment documented in SSP appendix
- Defender Vulnerability Management: continuous vulnerability assessment across managed endpoints

---

### RA.L2-3.11.2 -- Vulnerability Scanning
**NIST 3.11.2 | Level 2 | SPRS Weight: 5**

> Scan for vulnerabilities periodically and when new vulnerabilities are identified.

- Defender Vulnerability Management: continuous agent-based vulnerability scanning
- Software inventory with CVE correlation and CVSS scoring
- Threat and Vulnerability Management dashboard: prioritized remediation recommendations
- Intune compliance policies flag devices with critical unpatched vulnerabilities as non-compliant

---

### RA.L2-3.11.3 -- Remediate Vulnerabilities
**NIST 3.11.3 | Level 2 | SPRS Weight: 5**

> Remediate vulnerabilities in accordance with risk assessments.

- Defender Vulnerability Management: remediation requests create Intune security tasks
- Windows Update for Business: automated patching with deployment rings
- Intune compliance policies quarantine devices with critical unpatched vulnerabilities
- Documented vulnerability remediation SLA: critical = 15 days, high = 30 days, medium = 90 days

---

## CA -- Security Assessment (4 controls)

### CA.L2-3.12.1 -- Assess Security Controls
**NIST 3.12.1 | Level 2 | SPRS Weight: 3**

> Periodically assess security controls to determine if they are effective.

- Microsoft Secure Score: continuous automated assessment of M365 security configuration
- Compliance Manager: CMMC L2 template with automated and manual assessment actions
- Annual self-assessment documented using NIST SP 800-171A methodology
- Triennial CMMC Level 2 assessment by C3PAO

---

### CA.L2-3.12.2 -- Plan of Action and Milestones (POA&M)
**NIST 3.12.2 | Level 2 | SPRS Weight: 3**

> Develop and implement plans of action to correct deficiencies and reduce vulnerabilities.

- Compliance Manager improvement actions serve as POA&M items
- POA&M document lists each deficiency with assigned owner, remediation plan, and milestone dates
- Monthly POA&M review with management sign-off
- SPRS score update submitted to SPRS portal after remediation

---

### CA.L2-3.12.3 -- Monitor Security Controls
**NIST 3.12.3 | Level 2 | SPRS Weight: 3**

> Monitor security controls on an ongoing basis.

- Microsoft Secure Score tracks control effectiveness daily
- Compliance Manager automated reassessment of technical controls
- Defender XDR alerts trigger on security control degradation (e.g., Conditional Access policy disabled)
- Quarterly control effectiveness review documented

---

### CA.L2-3.12.4 -- System Security Plan (SSP)
**NIST 3.12.4 | Level 2 | SPRS Weight: 5**

> Develop, document and periodically update System Security Plans.

- SSP describes system boundary, environment of operation, and security control implementation
- System boundary defined: M365 GCC High tenant + managed endpoints + Sentinel workspace
- Interconnection agreements documented for external system connections
- Annual SSP review and update
- SSP stored in SharePoint with version control and Purview retention

Note: This control is POA&M-prohibited. The SSP must exist before assessment.

---

## SC -- Systems and Communications Protection (16 controls)

### SC.L1-3.13.1 -- Boundary Protection
**NIST 3.13.1 | Level 1 | SPRS Weight: 5**

> Monitor, control and protect communications at external and key internal boundaries.

- Conditional Access policies serve as the logical access boundary for M365 services
- Defender for Cloud Apps CASB monitoring of cloud application traffic
- Exchange Online transport rules control email flow at the organization boundary
- DLP policies monitor and control data flow at the CUI boundary

**M365+Sentinel Alternative:**
- Conditional Access policies as boundary enforcement (replaces Azure NSG/Firewall)
- Defender for Cloud Apps session policies for session-level control
- Sentinel analytics rules correlate boundary-crossing events from Entra ID and Office 365 connectors
- Tenant boundary serves as the security boundary, documented in SSP

---

### SC.L2-3.13.2 -- Security Engineering Principles
**NIST 3.13.2 | Level 2 | SPRS Weight: 3**

> Employ architectural designs, software development techniques and systems engineering principles that promote effective information security.

- GCC High is purpose-built for government security requirements (FedRAMP High authorized)
- Defense-in-depth: multiple layers (identity, device, application, data) enforced by Conditional Access
- Microsoft Secure Score plus Compliance Manager guide security architecture decisions
- Documented security architecture in SSP with data flow diagrams

---

### SC.L2-3.13.3 -- Separate User and System Management Functionality
**NIST 3.13.3 | Level 2 | SPRS Weight: 3**

> Separate user functionality from system management functionality.

- Admin portals (admin.microsoft.com, entra.microsoft.com) separated from user portals
- Conditional Access: dedicated policy set for admin access with stricter requirements
- Privileged Access Workstations (PAWs): dedicated devices for admin tasks separate from daily-use machines
- PIM: admin functionality only available during active role elevation

---

### SC.L2-3.13.4 -- Prevent Unauthorized Information Transfer
**NIST 3.13.4 | Level 2 | SPRS Weight: 3**

> Prevent unauthorized and unintended information transfer via shared system resources.

- Information Barriers in Purview prevent cross-segment communication in Teams and SharePoint
- DLP policies detect and block CUI in unauthorized channels
- Sensitivity labels with encryption prevent copy/paste/forward of labeled content
- Endpoint DLP monitors and blocks clipboard operations involving CUI

---

### SC.L1-3.13.5 -- Publicly Accessible Subnetworks
**NIST 3.13.5 | Level 1 | SPRS Weight: 5**

> Implement subnetworks for publicly accessible system components that are physically or logically separated from internal networks.

- SharePoint external sharing policies restrict public-facing content to dedicated site collections
- Conditional Access named locations limit external access to specific IP ranges

**M365+Sentinel Alternative:**
- Separate SharePoint site collections for externally shared content with restrictive DLP policies
- Logical separation via Entra ID groups and SharePoint permissions (replaces Azure VNet segregation)
- Conditional Access named locations as network boundary enforcement
- Sentinel monitors cross-boundary access patterns via Entra ID sign-in log analytics

---

### SC.L2-3.13.6 -- Deny Network Traffic by Default
**NIST 3.13.6 | Level 2 | SPRS Weight: 3**

> Deny network communications traffic by default and allow by exception.

- Intune: Windows Firewall profile with default deny inbound

**M365+Sentinel Alternative:**
- Conditional Access "block all access" baseline policy plus exception grants for trusted devices/locations/users (replaces Azure NSG default deny)
- Intune compliance policies deny non-compliant device access as default deny posture
- Defender for Cloud Apps blocks unapproved cloud apps by default
- Sentinel alert rules detect access attempts that bypass Conditional Access policies

---

### SC.L2-3.13.7 -- Prevent Split Tunneling
**NIST 3.13.7 | Level 2 | SPRS Weight: 3**

> Prevent remote devices from simultaneously establishing non-remote connections and communicating via external networks (split tunneling).

- Conditional Access: require compliant device for CUI resource access
- Defender for Endpoint network protection prevents connections to unapproved domains
- Intune: configure Always-On VPN profile with no split tunneling for CUI access (if VPN used)
- M365 traffic optimization may allow direct-to-cloud for M365 URLs per Microsoft best practices, documented in SSP

---

### SC.L2-3.13.8 -- Encrypt CUI in Transit
**NIST 3.13.8 | Level 2 | SPRS Weight: 5**

> Implement cryptographic mechanisms to prevent unauthorized disclosure of CUI during transmission.

- TLS 1.2+ enforced for all M365 GCC High connections (platform requirement)
- Purview Message Encryption for external CUI email transmission
- Sensitivity labels auto-encrypt CUI-labeled documents
- SharePoint/OneDrive data in transit encrypted via HTTPS
- IPsec VPN for site-to-site connections where applicable (FIPS 140-2 validated)

---

### SC.L2-3.13.9 -- Terminate Network Connections
**NIST 3.13.9 | Level 2 | SPRS Weight: 3**

> Terminate network connections at end of sessions or after a defined period of inactivity.

- Conditional Access sign-in frequency: sessions terminated after 8 hours (configurable)
- SharePoint idle session timeout: 15 minutes for browser sessions
- Exchange Online: Outlook Web App session timeout enforced
- Token lifetime policies: access tokens expire per Microsoft default (1 hour), refresh tokens per policy

---

### SC.L2-3.13.10 -- Cryptographic Key Management
**NIST 3.13.10 | Level 2 | SPRS Weight: 3**

> Establish and manage cryptographic keys for cryptography employed in organizational systems.

- Entra ID Certificate-Based Authentication for device certificates
- Customer Key for M365: customer-managed encryption keys for SharePoint and Exchange (G5 feature)

**M365+Sentinel Alternative:**
- Entra ID Certificate-Based Authentication manages device certificate lifecycle
- Microsoft Cloud PKI (G5 feature) for certificate lifecycle management (replaces Azure Key Vault HSM)
- Customer Key for M365 provides customer-managed at-rest encryption keys
- Gap note: Azure Key Vault provides superior centralized key management; M365-native approach requires additional procedural documentation

---

### SC.L2-3.13.11 -- FIPS-Validated Cryptography
**NIST 3.13.11 | Level 2 | SPRS Weight: 5**

> Employ FIPS-validated cryptography when used to protect the confidentiality of CUI.

- M365 GCC High uses FIPS 140-2 validated cryptographic modules for data at rest and in transit
- Windows FIPS mode can be enabled via Intune security baseline (CNG/CAPI2 validated modules)
- BitLocker uses FIPS 140-2 validated AES-256 encryption
- Note: enabling Windows FIPS mode may cause application compatibility issues; test before deployment

---

### SC.L2-3.13.12 -- Collaborative Computing Devices
**NIST 3.13.12 | Level 2 | SPRS Weight: 1**

> Prohibit remote activation of collaborative computing devices and provide indication of devices in use.

- Teams Rooms: disable remote camera/microphone activation in Teams admin center
- Intune: configure camera and microphone policies for managed devices
- Physical indicators: LED light on cameras when active (hardware-enforced on certified Teams devices)
- Teams meeting recording notification displayed to all participants

---

### SC.L2-3.13.13 -- Control Mobile Code
**NIST 3.13.13 | Level 2 | SPRS Weight: 1**

> Control and monitor the use of mobile code.

- Attack Surface Reduction rules block JavaScript/VBScript from launching downloaded content
- Defender SmartScreen blocks malicious downloads and scripts
- WDAC only permits approved executables and scripts to run
- Microsoft Edge Enhanced Security Mode restricts JavaScript JIT compilation on untrusted sites

---

### SC.L2-3.13.14 -- Control VoIP
**NIST 3.13.14 | Level 2 | SPRS Weight: 1**

> Control and monitor the use of Voice over Internet Protocol (VoIP) technologies.

- Microsoft Teams is the primary VoIP platform, fully integrated with GCC High security controls
- Teams calling policies restrict external calling and PSTN access per user group
- Conditional Access: Teams access requires compliant device plus MFA
- Teams audit logging captures call records, meeting attendance, and recording events

---

### SC.L2-3.13.15 -- Protect Communications Session Authenticity
**NIST 3.13.15 | Level 2 | SPRS Weight: 3**

> Protect the authenticity of communications sessions.

- TLS 1.2+ with certificate validation for all M365 sessions
- DKIM, DMARC, and SPF configured for email authenticity
- Entra ID token signing: RS256 with rotating keys (platform-managed)
- Teams end-to-end encrypted meetings for 1:1 calls (opt-in for multi-party)

---

### SC.L2-3.13.16 -- Protect CUI at Rest
**NIST 3.13.16 | Level 2 | SPRS Weight: 3**

> Protect the confidentiality of CUI at rest.

**N/A (endpoints) -- Browser-only CUI access means no CUI stored at rest on endpoints per Strategic Intent baseline.**

SI Decision: `cui_endpoint_posture = 'browser_only'`. CUI is accessible via browser sessions only. Conditional Access session policies block file downloads to endpoints. No CUI resides at rest on endpoint devices. This exclusion covers only the endpoint at-rest requirement.

**Cloud-side encryption remains in scope:** SharePoint/OneDrive service encryption with Microsoft-managed keys or Customer Key, Exchange Online mailbox encryption at rest, and Purview sensitivity labels with encryption all continue to protect CUI at rest in the M365 cloud. These are platform-inherent and do not require additional endpoint controls.

---

## SI -- System and Information Integrity (7 controls)

### SI.L1-3.14.1 -- Flaw Remediation
**NIST 3.14.1 | Level 1 | SPRS Weight: 5**

> Identify, report and correct information and information system flaws in a timely manner.

- Defender Vulnerability Management: continuous flaw identification with CVE correlation
- Windows Update for Business: automated patching via Intune deployment rings
- Intune compliance policies mark devices with critical unpatched flaws as non-compliant
- Documented patch management SLA: critical = 15 days, high = 30 days

---

### SI.L1-3.14.2 -- Malicious Code Protection
**NIST 3.14.2 | Level 1 | SPRS Weight: 5**

> Provide protection from malicious code at appropriate locations.

- Microsoft Defender Antivirus: real-time protection on all managed endpoints
- Defender for Office 365 P2: Safe Attachments and Safe Links for email and Teams
- Cloud-delivered protection: real-time malware signature updates
- Defender for Endpoint: behavioral analysis and machine learning detection

---

### SI.L2-3.14.3 -- Security Alerts and Advisories
**NIST 3.14.3 | Level 2 | SPRS Weight: 3**

> Monitor system security alerts and advisories and take action in response.

- Microsoft Service Health: M365 security advisories and service notifications
- Defender Vulnerability Management: threat intelligence integration with CVE advisories
- MSRC (Microsoft Security Response Center) advisories monitored
- Documented process: weekly review of security advisories with remediation prioritization
- Sentinel analytics rules surface relevant threat intelligence from Microsoft feeds

---

### SI.L1-3.14.4 -- Update Malicious Code Protection
**NIST 3.14.4 | Level 1 | SPRS Weight: 3**

> Update malicious code protection mechanisms when new releases are available.

- Defender Antivirus: automatic definition updates (cloud-delivered, multiple times daily)
- Intune: Defender update ring configuration ensures timely engine/platform updates
- Compliance policy flags devices with outdated Defender definitions as non-compliant
- Cloud-delivered protection enables zero-day detection without signature updates

---

### SI.L1-3.14.5 -- System and File Scanning
**NIST 3.14.5 | Level 1 | SPRS Weight: 3**

> Perform periodic scans and real-time scans of files from external sources.

- Defender Antivirus: real-time protection scans files on access, download, and execution
- Scheduled full scan: weekly via Intune configuration
- Defender for Office 365: scans email attachments and links before delivery
- SharePoint/OneDrive: automatic malware scanning of uploaded files

---

### SI.L2-3.14.6 -- Monitor Systems for Attacks
**NIST 3.14.6 | Level 2 | SPRS Weight: 3**

> Monitor systems, including inbound and outbound communications, to detect attacks and indicators of potential attacks.

- Defender for Endpoint: real-time endpoint detection and response (EDR)
- Defender for Office 365: email threat detection (phishing, malware, BEC)
- Defender for Identity: detects identity-based attacks (pass-the-hash, credential theft)
- Defender for Cloud Apps: detects anomalous cloud application behavior
- Sentinel analytics rules with threat intelligence matching for cross-signal correlation

---

### SI.L2-3.14.7 -- Identify Unauthorized Use
**NIST 3.14.7 | Level 2 | SPRS Weight: 3**

> Identify unauthorized use of organizational systems.

- Entra ID Identity Protection: risk-based sign-in detection (impossible travel, anonymous proxy, malware-linked IP)
- Conditional Access blocks or requires MFA for risky sign-ins
- Defender for Cloud Apps anomaly detection (unusual file access, mass download)
- Purview Insider Risk Management for data exfiltration detection
- Sentinel UEBA (User and Entity Behavior Analytics) for user behavior anomaly detection

---

## Appendix A: SI Baseline N/A Controls Summary

9 controls are marked Not Applicable based on the Strategic Intent baseline parameters. Per the DoD Assessment Methodology, N/A controls receive zero SPRS deduction. The assessor must validate each justification against the tenant's actual operational posture.

| # | Control ID | NIST Ref | SPRS Weight | SI Decision | Justification |
|---|------------|----------|-------------|-------------|---------------|
| 1 | AC.L2-3.1.14 | 3.1.14 | 5 | `wireless_posture = 'no_wireless'` | No wireless networks in CUI enclave per Strategic Intent baseline |
| 2 | AC.L2-3.1.16 | 3.1.16 | 1 | `wireless_posture = 'no_wireless'` | No wireless networks in CUI enclave per Strategic Intent baseline |
| 3 | AC.L2-3.1.18 | 3.1.18 | 3 | `mobile_device_presence = 'no_mobile_devices'` | No mobile devices in CUI enclave per Strategic Intent baseline |
| 4 | AC.L2-3.1.19 | 3.1.19 | 3 | `mobile_device_presence = 'no_mobile_devices'` | No mobile devices in CUI enclave per Strategic Intent baseline |
| 5 | MA.L2-3.7.4 | 3.7.4 | 3 | `maintenance_posture = 'no_nonlocal'` | No nonlocal maintenance performed per Strategic Intent baseline |
| 6 | MP.L2-3.8.5 | 3.8.5 | 3 | `removable_media_posture = 'blocked'` | Removable media prohibited by policy and technical control per Strategic Intent baseline |
| 7 | MP.L2-3.8.6 | 3.8.6 | 3 | `removable_media_posture = 'blocked'` | Removable media prohibited by policy and technical control per Strategic Intent baseline |
| 8 | PE.L2-3.10.6 | 3.10.6 | 1 | `cui_endpoint_posture = 'browser_only'` | Browser-only CUI access; no CUI stored at rest on endpoints at alternate work sites |
| 9 | SC.L2-3.13.16 | 3.13.16 | 3 | `cui_endpoint_posture = 'browser_only'` | Browser-only CUI access; no CUI stored at rest on endpoints (cloud-side encryption remains in scope) |

**Total SPRS weight removed:** 25 points (5 + 1 + 3 + 3 + 3 + 3 + 3 + 1 + 3)
**Effective maximum possible deduction:** 110 - 25 = 85 points (from the remaining 101 in-scope controls)

---

## Appendix B: M365+Sentinel Alternative Controls

6 controls use M365-native capabilities with Sentinel for tenants without a full Azure Gov subscription. These are fully satisfiable approaches but substitute for Azure-native services (NSG, Firewall, Key Vault).

| # | Control ID | NIST Ref | Standard (Full Azure) | M365+Sentinel Alternative |
|---|------------|----------|----------------------|---------------------------|
| 1 | AU.L2-3.3.3 | 3.3.3 | Sentinel retention + automated workbook review | Purview Audit Premium search + Defender XDR Advanced Hunting scheduled queries |
| 2 | AU.L2-3.3.4 | 3.3.4 | Sentinel alert on LAW heartbeat failure | Defender XDR custom detection rules + Power Automate alerts on audit ingestion gaps |
| 3 | SC.L1-3.13.1 | 3.13.1 | NSG flow logs + Azure Firewall + Sentinel | Conditional Access as boundary + Defender for Cloud Apps session policies + Sentinel connectors |
| 4 | SC.L1-3.13.5 | 3.13.5 | VNet segregation with dedicated subnets | SharePoint site collection separation + CA named locations + Sentinel access monitoring |
| 5 | SC.L2-3.13.6 | 3.13.6 | NSG default deny rules | CA "block all" baseline + exception grants + Intune compliance deny + Sentinel alerting |
| 6 | SC.L2-3.13.10 | 3.13.10 | Azure Key Vault with HSM-backed keys | Entra ID CBA + Microsoft Cloud PKI + Customer Key for M365 |

---

*This document was generated from the Stamper CMMC L2 control reference (110 controls), CES-FE scope exclusion rules, and M365/Azure registry implementations. Tailored to the M365+Sentinel SI baseline with BYOD allowed, no mobile devices, no wireless, removable media blocked, remote access permitted, no nonlocal maintenance, and browser-only CUI on endpoints.*
