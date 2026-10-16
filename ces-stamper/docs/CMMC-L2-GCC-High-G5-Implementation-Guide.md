# CMMC Level 2 Implementation Guide — GCC High with Microsoft 365 G5

**Prepared by:** Blue Heron Defense, LLC
**Target Environment:** Microsoft 365 GCC High + Azure Government (optional)
**License Tier:** Microsoft 365 G5 (Government)
**Date:** March 2026
**Controls Covered:** 110 (all CMMC Level 2 practices)

---

## How to Read This Guide

Each control entry includes:

- **Standard Implementation** — how the control is normally satisfied in a GCC High G5 tenant
- **SIT Exclusion** (where applicable) — if a Strategic Intent (SI) decision makes this control Not Applicable, the trigger condition and justification are shown
- **M365-Only Alternative** (where applicable) — if the standard implementation requires Azure infrastructure and the tenant uses an M365-only stance, the alternative approach is described

Controls are grouped by NIST SP 800-171 family. SPRS weights (1, 3, or 5) are noted where relevant.

---

## AC — Access Control (22 controls)

### AC.L1-3.1.1 — Limit System Access to Authorized Users
**NIST 3.1.1 | Level 1 | SPRS Weight: 5**

> Limit information system access to authorized users, processes acting on behalf of authorized users or devices.

**GCC High G5 Implementation:**
- Create a dedicated CUI Security Group in Entra ID containing only authorized personnel
- Assign Conditional Access policies scoped to the CUI Security Group
- Block all access from non-compliant devices via Intune compliance policy
- Enforce device registration requirement for all CUI-accessing users
- Service principals and managed identities used for automated processes are scoped to least-privilege Graph API permissions

---

### AC.L1-3.1.2 — Limit Access to Authorized Transactions/Functions
**NIST 3.1.2 | Level 1 | SPRS Weight: 5**

> Limit information system access to the types of transactions and functions that authorized users are permitted to execute.

**GCC High G5 Implementation:**
- RBAC role assignments scoped to CUI Security Group (e.g., Exchange Admin, SharePoint Admin)
- Entra ID Privileged Identity Management (PIM) for just-in-time elevation
- SharePoint site-level permissions restrict CUI document libraries to authorized users only
- Exchange Online transport rules block CUI-labeled content from unauthorized mailboxes
- Sensitivity labels with encryption restrict file-level access

---

### AC.L2-3.1.3 — Control CUI Flow
**NIST 3.1.3 | Level 2 | SPRS Weight: 5**

> Control the flow of CUI in accordance with approved authorizations.

**GCC High G5 Implementation:**
- Information Barriers: create user segments (CUI-authorized vs. general) and policies preventing cross-segment communication
- DLP policies in Microsoft Purview detect and block CUI transmission to unauthorized recipients
- Sensitivity labels with auto-labeling rules applied to documents and emails containing CUI patterns
- Exchange Online mail flow rules prevent forwarding CUI-labeled emails to external domains
- Teams: DLP policies prevent sharing CUI content in unauthorized channels

---

### AC.L2-3.1.4 — Separation of Duties
**NIST 3.1.4 | Level 2 | SPRS Weight: 3**

> Separate the duties of individuals to reduce the risk of malevolent activity without collusion.

**GCC High G5 Implementation:**
- PIM approval workflows require a different administrator to approve privilege escalation
- Global Admin and Security Admin roles assigned to separate individuals
- Compliance Admin role separated from Exchange Admin
- PIM eligible assignments with multi-person approval for critical roles
- Administrative units in Entra ID scope admin privileges to specific OUs

---

### AC.L2-3.1.5 — Least Privilege
**NIST 3.1.5 | Level 2 | SPRS Weight: 5**

> Employ the principle of least privilege, including for specific security functions and privileged accounts.

**GCC High G5 Implementation:**
- PIM just-in-time (JIT) eligible role assignments — admins activate roles only when needed (max 8-hour window)
- No standing Global Admin assignments; all privileged roles require activation
- Application consent workflow requires admin approval for OAuth grants
- Managed identity for automation runbooks with scoped Graph permissions
- Regular access reviews via Entra ID Access Reviews (quarterly)

---

### AC.L2-3.1.6 — Non-Privileged Accounts for Non-Security Functions
**NIST 3.1.6 | Level 2 | SPRS Weight: 3**

> Use non-privileged accounts or roles when accessing non-security functions.

**GCC High G5 Implementation:**
- Dedicated admin accounts (e.g., `admin-jsmith@tenant.us`) separate from daily-use accounts
- Conditional Access policy blocks admin accounts from non-admin workloads (email, Teams, SharePoint browsing)
- PIM enforces time-bound activation — admin privileges automatically expire
- Break-glass accounts stored in Azure Key Vault with access logging

---

### AC.L2-3.1.7 — Prevent Non-Privileged Users from Executing Privileged Functions
**NIST 3.1.7 | Level 2 | SPRS Weight: 3**

> Prevent non-privileged users from executing privileged functions and capture the execution of such functions in audit logs.

**GCC High G5 Implementation:**
- PIM eligible role assignments prevent standing admin access
- Unified Audit Log captures all privilege escalation events (RoleElevated, Add member to role)
- Conditional Access blocks admin portal access from non-compliant devices
- Alert policies in Microsoft Defender for Office 365 trigger on unexpected privilege use
- Purview Audit Premium retains privileged operation logs for 365 days

---

### AC.L2-3.1.8 — Limit Unsuccessful Logon Attempts
**NIST 3.1.8 | Level 2 | SPRS Weight: 3**

> Limit unsuccessful logon attempts.

**GCC High G5 Implementation:**
- Entra ID Smart Lockout: 10 failed attempts triggers 60-second lockout, escalating with repeat failures
- Custom banned password list blocks common/weak passwords
- Conditional Access risk-based policy blocks sign-ins flagged as high risk by Identity Protection
- Password Protection applied to on-premises AD (if hybrid) via Entra ID Password Protection proxy

---

### AC.L2-3.1.9 — Privacy and Security Notices
**NIST 3.1.9 | Level 2 | SPRS Weight: 1**

> Provide privacy and security notices consistent with applicable CUI rules.

**GCC High G5 Implementation:**
- Entra ID custom branding: login page displays CUI handling notice and authorized-use warning
- Terms of Use (ToU) policy in Conditional Access requires user acceptance before granting access
- SharePoint CUI site home page displays handling instructions
- Email disclaimer transport rule appends CUI handling notice to outbound messages

---

### AC.L2-3.1.10 — Session Lock
**NIST 3.1.10 | Level 2 | SPRS Weight: 3**

> Use session lock with pattern-hiding displays to prevent access and viewing of data after a period of inactivity.

**GCC High G5 Implementation:**
- Intune device configuration policy: screen lock timeout = 15 minutes (Windows, iOS, Android)
- Windows Hello for Business requires re-authentication after screen lock
- Pattern-hiding: Windows lock screen shows no notification content (configured via Intune)
- Conditional Access sign-in frequency policy forces reauthentication after 8 hours

---

### AC.L2-3.1.11 — Terminate Sessions After Defined Condition
**NIST 3.1.11 | Level 2 | SPRS Weight: 3**

> Terminate (automatically) user sessions after a defined condition.

**GCC High G5 Implementation:**
- Conditional Access session controls: sign-in frequency = 8 hours, persistent browser session = disabled
- SharePoint idle session timeout = 15 minutes for unmanaged devices
- Teams web session timeout inherits Conditional Access policy
- Token lifetime policies: refresh token max inactive time = 24 hours

---

### AC.L2-3.1.12 — Monitor and Control Remote Access
**NIST 3.1.12 | Level 2 | SPRS Weight: 5**

> Monitor and control remote access sessions.

**GCC High G5 Implementation:**
- Conditional Access named locations define trusted corporate networks
- Sign-ins from outside named locations require MFA + compliant device
- Entra ID sign-in logs capture source IP, location, device state for all remote sessions
- Defender for Cloud Apps session policies monitor and can block risky remote file downloads
- Azure: VPN Gateway or Azure Bastion for infrastructure remote access

**SIT Exclusion — No Remote Access:**
- **Trigger:** `remote_access_posture = 'no_remote'`
- **Effect:** Control is Not Applicable — no remote access to CUI systems is permitted
- **Justification:** "No remote access to CUI systems per Strategic Intent baseline"
- **SPRS Impact:** 5-point weight removed from scoring (zero deduction)
- **Assessor Note:** Assessor must verify that no remote access paths exist (VPN, RDP, SSH, web portals from outside the facility)

---

### AC.L2-3.1.13 — Encrypt Remote Access Sessions
**NIST 3.1.13 | Level 2 | SPRS Weight: 5**

> Employ cryptographic mechanisms to protect the confidentiality of remote access sessions.

**GCC High G5 Implementation:**
- All M365 GCC High traffic is TLS 1.2+ encrypted (platform-enforced)
- Conditional Access requires compliant device with BitLocker enabled
- Azure VPN Gateway uses IPsec/IKEv2 with FIPS 140-2 validated modules
- Azure Bastion uses TLS-encrypted RDP/SSH tunnels
- Exchange Online: Outlook connections use TLS; SMTP relay requires STARTTLS

---

### AC.L2-3.1.14 — Route Remote Access via Managed Access Control Points
**NIST 3.1.14 | Level 2 | SPRS Weight: 5**

> Route remote access via managed access control points.

**GCC High G5 Implementation:**
- Conditional Access policies serve as the managed access control point for M365 services
- All authentication flows route through Entra ID (the managed control point)
- Azure: Azure Firewall as centralized network access control point
- Named locations block access from non-approved geographies
- Defender for Cloud Apps reverse proxy provides session-level control for SaaS apps

**SIT Exclusion — No Wireless Networks:**
- **Trigger:** `wireless_posture = 'no_wireless'`
- **Effect:** Control is Not Applicable — no wireless access paths exist in the CUI boundary
- **Justification:** "No wireless networks in CUI enclave per Strategic Intent baseline"
- **SPRS Impact:** 5-point weight removed from scoring

---

### AC.L2-3.1.15 — Authorize Remote Execution of Privileged Commands
**NIST 3.1.15 | Level 2 | SPRS Weight: 5**

> Authorize remote execution of privileged commands and remote access to security-relevant information.

**GCC High G5 Implementation:**
- PIM requires justification and approval for remote privilege activation
- Conditional Access blocks admin portals from non-compliant/non-corporate devices
- Azure Bastion provides audited, browser-based access to VMs without exposing RDP/SSH
- Privileged Access Workstations (PAWs) enforced via Intune compliance for admin accounts
- All admin actions logged in Unified Audit Log with 365-day retention (G5)

---

### AC.L2-3.1.16 — Authorize Wireless Access
**NIST 3.1.16 | Level 2 | SPRS Weight: 1**

> Authorize wireless access prior to allowing such connections.

**GCC High G5 Implementation:**
- Intune Wi-Fi profiles push authorized SSID configurations to managed devices
- Certificate-based 802.1X authentication via Intune SCEP/PKCS profiles
- Conditional Access requires device compliance (including Wi-Fi profile compliance)
- Guest wireless isolated from corporate network; no CUI access from guest SSID

**SIT Exclusion — No Wireless Networks:**
- **Trigger:** `wireless_posture = 'no_wireless'`
- **Effect:** Control is Not Applicable — no wireless networks in CUI boundary
- **Justification:** "No wireless networks in CUI enclave per Strategic Intent baseline"
- **SPRS Impact:** 1-point weight removed

---

### AC.L2-3.1.17 — Protect Wireless Access
**NIST 3.1.17 | Level 2 | SPRS Weight: 3**

> Protect wireless access using authentication and encryption.

**GCC High G5 Implementation:**
- WPA3-Enterprise (or WPA2-Enterprise minimum) required on all CUI-accessible networks
- 802.1X with RADIUS/NPS and Entra ID certificate-based authentication
- Intune compliance policy marks devices connected to unauthorized SSIDs as non-compliant
- Network encryption: AES-256 for wireless frames

---

### AC.L2-3.1.18 — Control Mobile Devices
**NIST 3.1.18 | Level 2 | SPRS Weight: 3**

> Control connection of mobile devices.

**GCC High G5 Implementation:**
- Intune MDM enrollment required for all mobile devices accessing CUI
- Intune compliance policies enforce: OS version minimums, encryption enabled, jailbreak detection
- Conditional Access blocks non-enrolled mobile devices from M365 services
- App Protection Policies (MAM) for managed apps on personal devices (if BYOD allowed)
- Microsoft Defender for Endpoint on mobile provides threat detection

**SIT Exclusion — No Mobile Devices:**
- **Trigger:** `mobile_device_presence = 'no_mobile_devices'`
- **Effect:** Control is Not Applicable — no mobile devices access CUI
- **Justification:** "No mobile devices in CUI enclave per Strategic Intent baseline"
- **SPRS Impact:** 3-point weight removed
- **Assessor Note:** Verify no smartphones or tablets access Exchange, Teams, SharePoint, or OneDrive with CUI data

---

### AC.L2-3.1.19 — Encrypt CUI on Mobile Devices
**NIST 3.1.19 | Level 2 | SPRS Weight: 3**

> Encrypt CUI on mobile devices and mobile computing platforms.

**GCC High G5 Implementation:**
- Intune compliance policy requires device encryption (BitLocker on Windows, FileVault on macOS, native encryption on iOS/Android)
- App Protection Policy enforces app-level encryption for managed apps
- Sensitivity labels with encryption prevent unencrypted CUI storage on mobile
- Conditional Access blocks non-compliant (unencrypted) devices

**SIT Exclusion — No Mobile Devices:**
- **Trigger:** `mobile_device_presence = 'no_mobile_devices'`
- **Effect:** Control is Not Applicable
- **Justification:** "No mobile devices in CUI enclave per Strategic Intent baseline"
- **SPRS Impact:** 3-point weight removed

---

### AC.L1-3.1.20 — Verify/Control External System Connections
**NIST 3.1.20 | Level 1 | SPRS Weight: 5**

> Verify and control/limit connections to and use of external information systems.

**GCC High G5 Implementation:**
- Entra ID External Collaboration Settings: restrict guest invitations to specific domains
- Cross-tenant access policies define allowed external tenants and access levels
- Conditional Access blocks access from unmanaged/external devices to CUI resources
- SharePoint external sharing: disabled for CUI sites, or restricted to specific domains
- Defender for Cloud Apps: Shadow IT discovery identifies unauthorized SaaS usage

---

### AC.L2-3.1.21 — Limit Portable Storage on External Systems
**NIST 3.1.21 | Level 2 | SPRS Weight: 1**

> Limit use of portable storage devices on external systems.

**GCC High G5 Implementation:**
- Intune device restriction policy blocks USB mass storage devices
- Windows Defender Device Control policies restrict removable media access
- DLP endpoint policies detect and block CUI transfer to USB drives
- BitLocker To Go enforced for any authorized removable media

---

### AC.L1-3.1.22 — Control Publicly Accessible Information
**NIST 3.1.22 | Level 1 | SPRS Weight: 5**

> Control information posted or processed on publicly accessible information systems.

**GCC High G5 Implementation:**
- SharePoint external sharing: disabled or tightly restricted for all CUI site collections
- DLP policies prevent CUI-labeled content from being shared externally
- Sensitivity labels with "Do Not Forward" and encryption prevent public disclosure
- Content review workflow required before publishing to external-facing sites
- Exchange Online: transport rules block CUI auto-forwarding to external recipients

---

## AT — Awareness and Training (3 controls)

### AT.L2-3.2.1 — Security Awareness
**NIST 3.2.1 | Level 2 | SPRS Weight: 3**

> Ensure managers, system administrators and users are made aware of security risks and applicable policies.

**GCC High G5 Implementation:**
- Attack Simulation Training (Defender for Office 365 P2): phishing simulations with automated training assignments
- Compliance Manager: CUI handling training task tracked as an improvement action
- Security awareness training program documented in SSP with annual completion records
- Entra ID Terms of Use: annual re-acceptance of acceptable use policy
- Evidence: training completion reports exported from Attack Simulation Training

---

### AT.L2-3.2.2 — Role-Based Security Training
**NIST 3.2.2 | Level 2 | SPRS Weight: 3**

> Ensure personnel are trained to carry out assigned information security duties.

**GCC High G5 Implementation:**
- Admin-specific training for PIM, Conditional Access, DLP policy management
- Incident responders trained on Defender XDR investigation workflows
- Training records maintained in SharePoint with Purview retention policy
- Annual role-based training curriculum documented in SSP

---

### AT.L2-3.2.3 — Insider Threat Awareness
**NIST 3.2.3 | Level 2 | SPRS Weight: 3**

> Provide security awareness training on recognizing and reporting potential indicators of insider threat.

**GCC High G5 Implementation:**
- Purview Insider Risk Management: configure insider risk indicators and policies
- Training module covers: data exfiltration patterns, behavioral indicators, reporting procedures
- Anonymous reporting channel documented and communicated
- Evidence: insider threat training completion certificates stored in SharePoint

---

## AU — Audit and Accountability (9 controls)

### AU.L2-3.3.1 — Create and Retain Audit Logs
**NIST 3.3.1 | Level 2 | SPRS Weight: 5**

> Create and retain system audit logs and records to enable monitoring, analysis, investigation, and reporting.

**GCC High G5 Implementation:**
- Purview Audit Premium (G5): 365-day audit log retention for all M365 services
- Unified Audit Log captures: sign-ins, mailbox access, SharePoint file operations, Teams events, admin actions
- Azure: Log Analytics Workspace with 365-day retention for infrastructure logs
- Diagnostic settings route Entra ID sign-in and audit logs to Log Analytics
- Immutable storage (Azure) or Purview retention lock for audit log integrity

**M365-Only Note:** Purview Audit Premium provides 365-day retention natively. No Azure Log Analytics needed for M365 audit data, though Azure provides additional aggregation capabilities.

---

### AU.L2-3.3.2 — Individual Accountability
**NIST 3.3.2 | Level 2 | SPRS Weight: 5**

> Ensure that actions of individual system users can be uniquely traced to those users.

**GCC High G5 Implementation:**
- Entra ID assigns unique Object ID to every user, service principal, and managed identity
- Unified Audit Log records `UserId` (UPN) with every audited action
- Shared mailboxes: Send As / Send on Behalf auditing identifies the acting user
- MFA ensures the authenticated user is who they claim to be
- Purview Audit Premium: MailItemsAccessed records identify who read which emails

---

### AU.L2-3.3.3 — Review and Update Logged Events
**NIST 3.3.3 | Level 2 | SPRS Weight: 3**

> Review and update logged events.

**GCC High G5 Implementation:**
- Defender XDR Advanced Hunting: scheduled queries for authentication failures, privilege escalations, DLP violations
- Weekly/monthly audit log review process documented in SSP
- Purview Audit search with saved queries for recurring reviews
- Azure: Sentinel workbooks for automated log review dashboards

**M365-Only Alternative:**
- Purview Audit Premium search with saved queries
- Defender XDR Advanced Hunting scheduled queries
- Export results to SharePoint document library for quarterly review records

---

### AU.L2-3.3.4 — Alert on Audit Process Failure
**NIST 3.3.4 | Level 2 | SPRS Weight: 3**

> Alert in the event of an audit logging process failure.

**GCC High G5 Implementation:**
- Azure: Sentinel alert rule monitoring Log Analytics Workspace heartbeat — triggers on ingestion gaps
- Defender for Cloud alert on diagnostic settings removal
- Service Health alerts for M365 audit service degradation

**M365-Only Alternative:**
- Defender XDR custom detection rules monitoring Purview Audit log ingestion gaps
- Power Automate flow: alert SOC mailbox if no Purview Audit events for 60 minutes
- Service Health notifications for audit service availability

---

### AU.L2-3.3.5 — Correlate Audit Records
**NIST 3.3.5 | Level 2 | SPRS Weight: 3**

> Correlate audit record review, analysis and reporting for investigation and response.

**GCC High G5 Implementation:**
- Azure Sentinel: cross-correlates Entra ID sign-ins, Office 365 audit logs, Defender alerts into incidents
- Defender XDR: unified incident view correlating email, identity, endpoint, and cloud app signals
- Advanced Hunting (KQL) queries join data across tables for investigation
- Incident timeline view in Defender XDR shows correlated attack chain

---

### AU.L2-3.3.6 — Audit Reduction and Report Generation
**NIST 3.3.6 | Level 2 | SPRS Weight: 3**

> Provide audit record reduction and report generation to support on-demand analysis.

**GCC High G5 Implementation:**
- Purview Audit search: filter by date, user, activity, record type
- Defender XDR: export hunting query results to CSV
- Azure: Log Analytics KQL queries with `summarize`, `project`, `render` for report generation
- Power BI connected to M365 audit data for executive dashboards
- Compliance Manager: downloadable assessment reports

---

### AU.L2-3.3.7 — Authoritative Time Source
**NIST 3.3.7 | Level 2 | SPRS Weight: 1**

> Compare and synchronize internal system clocks with an authoritative source to generate time stamps.

**GCC High G5 Implementation:**
- M365 GCC High: Microsoft manages NTP synchronization for all cloud services (platform-inherent)
- All audit log timestamps use UTC from Microsoft's authoritative time source
- Windows endpoints: Intune policy configures W32Time service to sync with `time.windows.com` or customer NTP
- No customer action required for cloud service time synchronization — inherited from platform

---

### AU.L2-3.3.8 — Protect Audit Information
**NIST 3.3.8 | Level 2 | SPRS Weight: 3**

> Protect audit information and audit logging tools from unauthorized access, modification, and deletion.

**GCC High G5 Implementation:**
- Purview Audit log access restricted to Compliance Administrator and Security Reader roles
- RBAC: remove audit log access from non-security admin roles
- Azure: Log Analytics Workspace RBAC limits query access to Security Operations team
- Immutable storage with Purview retention lock prevents audit log deletion
- Azure Storage immutability policies for archived audit data

---

### AU.L2-3.3.9 — Limit Audit Management
**NIST 3.3.9 | Level 2 | SPRS Weight: 3**

> Limit management of audit logging functionality to a subset of privileged users.

**GCC High G5 Implementation:**
- Only Compliance Administrator and Global Administrator can modify audit policies
- PIM: audit management roles require JIT activation with justification
- Remove audit-related permissions from custom admin roles
- Monitor changes to audit configuration via alert policies (Defender for Office 365)

---

## CM — Configuration Management (9 controls)

### CM.L2-3.4.1 — Baseline Configurations
**NIST 3.4.1 | Level 2 | SPRS Weight: 5**

> Establish and maintain baseline configurations and inventories throughout the system development life cycle.

**GCC High G5 Implementation:**
- Intune: Windows Security Baseline profile applied to all managed devices
- CIS Benchmark Level 2 profile for Windows 10/11 deployed via Intune
- Device inventory maintained in Intune and Defender for Endpoint
- Software inventory via Defender Vulnerability Management
- Azure: ARM/Bicep templates define infrastructure baseline as code

---

### CM.L2-3.4.2 — Security Configuration Settings
**NIST 3.4.2 | Level 2 | SPRS Weight: 3**

> Establish and enforce security configuration settings for IT products.

**GCC High G5 Implementation:**
- Attack Surface Reduction (ASR) rules enabled via Intune
- Microsoft Defender Antivirus configuration: real-time protection, cloud-delivered protection, automatic sample submission
- Browser security: Microsoft Edge security baseline via Intune
- Office 365: macro execution policies, protected view settings via Intune administrative templates
- Azure: Azure Policy initiatives enforce resource configuration compliance

---

### CM.L2-3.4.3 — Track/Review/Approve Changes
**NIST 3.4.3 | Level 2 | SPRS Weight: 3**

> Track, review, approve or disapprove and log changes to organizational systems.

**GCC High G5 Implementation:**
- Entra ID Audit Log: tracks all directory changes (user, group, policy modifications)
- Exchange Online admin audit log captures mailbox and transport rule changes
- SharePoint: version history and change log for document library configurations
- Intune: configuration profile change tracking with assignment history
- Change management process documented in SSP with approval workflow

---

### CM.L2-3.4.4 — Security Impact Analysis
**NIST 3.4.4 | Level 2 | SPRS Weight: 3**

> Analyze the security impact of changes prior to implementation.

**GCC High G5 Implementation:**
- Conditional Access "What If" tool to test policy changes before deployment
- Intune: use scope tags and pilot groups to test configuration changes on subset of devices
- Microsoft Secure Score: assess impact of proposed changes on security posture
- Documented change management procedure requires security review before production deployment

---

### CM.L2-3.4.5 — Access Restrictions for Changes
**NIST 3.4.5 | Level 2 | SPRS Weight: 3**

> Define, document, approve and enforce physical and logical access restrictions associated with changes.

**GCC High G5 Implementation:**
- PIM: configuration changes require admin role activation with approval
- Conditional Access: admin portal access restricted to PAWs or compliant devices from named locations
- Azure: resource locks prevent accidental deletion of critical infrastructure
- RBAC: least-privilege role assignments for configuration management (e.g., Intune Administrator vs. Global Admin)

---

### CM.L2-3.4.6 — Least Functionality
**NIST 3.4.6 | Level 2 | SPRS Weight: 3**

> Employ the principle of least functionality by configuring systems to provide only essential capabilities.

**GCC High G5 Implementation:**
- Disable unnecessary M365 services (e.g., Sway, Delve) via service-level controls
- Intune: disable Windows optional features not required for CUI processing
- Remove default apps via Intune PowerShell scripts
- Azure: deploy only required resource providers; disable unused services
- SharePoint: disable self-service site creation

---

### CM.L2-3.4.7 — Restrict Nonessential Programs
**NIST 3.4.7 | Level 2 | SPRS Weight: 3**

> Restrict, disable or prevent the use of nonessential programs, functions, ports, protocols and services.

**GCC High G5 Implementation:**
- Windows Defender Application Control (WDAC) policy: deny-by-default, allow only approved applications
- Intune: block installation of unapproved applications
- Windows Firewall profiles via Intune: block unnecessary inbound/outbound ports
- Disable unnecessary Windows services via Intune PowerShell scripts
- Azure: NSG rules block all ports except explicitly required

---

### CM.L2-3.4.8 — Application Allow/Deny Lists
**NIST 3.4.8 | Level 2 | SPRS Weight: 1**

> Apply deny-by-exception or permit-by-exception policy for software execution.

**GCC High G5 Implementation:**
- WDAC: permit-by-exception (whitelisting) — only Microsoft-signed and IT-approved applications execute
- AppLocker as complementary control for user-space applications
- Intune: application deployment whitelist — only approved apps pushed to devices
- Defender for Endpoint: application control recommendations from Vulnerability Management

---

### CM.L2-3.4.9 — Control User-Installed Software
**NIST 3.4.9 | Level 2 | SPRS Weight: 1**

> Control and monitor user-installed software.

**GCC High G5 Implementation:**
- Standard user accounts (non-admin) cannot install software on managed devices
- Intune: deploy approved applications via Company Portal
- WDAC prevents execution of unapproved software even if side-loaded
- Defender for Endpoint software inventory tracks all installed applications
- Alert on unexpected software installation via Defender XDR

---

## IA — Identification and Authentication (11 controls)

### IA.L1-3.5.1 — Identify Users
**NIST 3.5.1 | Level 1 | SPRS Weight: 5**

> Identify information system users, processes acting on behalf of users or devices.

**GCC High G5 Implementation:**
- Entra ID: every user has a unique UPN and Object ID
- Service principals and managed identities identify automated processes
- Device objects in Entra ID identify registered/joined devices
- Conditional Access evaluates user, device, and application identity before granting access

---

### IA.L1-3.5.2 — Authenticate Users
**NIST 3.5.2 | Level 1 | SPRS Weight: 5**

> Authenticate the identities of users, processes, or devices as a prerequisite to allowing access.

**GCC High G5 Implementation:**
- Entra ID authentication: password + MFA required for all users
- Device authentication: Entra ID join or hybrid join with device certificate
- Service authentication: client certificates or managed identity tokens
- Conditional Access: authentication strength policies enforce approved methods

---

### IA.L2-3.5.3 — Multi-Factor Authentication
**NIST 3.5.3 | Level 2 | SPRS Weight: 5**

> Use multi-factor authentication for local and network access to privileged accounts and for network access to non-privileged accounts.

**GCC High G5 Implementation:**
- Microsoft Authenticator push notifications or number matching for all users
- FIDO2 security keys enabled for privileged accounts (phishing-resistant)
- Conditional Access: require MFA for all sign-ins (privileged and non-privileged)
- Authentication strength policy: require phishing-resistant methods for admin roles
- Windows Hello for Business for local workstation authentication

---

### IA.L2-3.5.4 — Replay-Resistant Authentication
**NIST 3.5.4 | Level 2 | SPRS Weight: 3**

> Employ replay-resistant authentication mechanisms for network access.

**GCC High G5 Implementation:**
- FIDO2/WebAuthn: challenge-response with cryptographic nonce (inherently replay-resistant)
- Microsoft Authenticator: time-based push with number matching (replay-resistant)
- Certificate-based authentication with TLS client certificates
- Conditional Access: authentication strength policy requires phishing-resistant methods for admin access
- OAuth 2.0 token binding prevents token replay

---

### IA.L2-3.5.5 — Prevent Identifier Reuse
**NIST 3.5.5 | Level 2 | SPRS Weight: 1**

> Prevent the reuse of identifiers for a defined period.

**GCC High G5 Implementation:**
- Entra ID: deleted user UPNs cannot be reassigned for 30 days (soft-delete retention)
- Disabled accounts retained in Entra ID for 90 days before hard deletion
- Service principal App IDs are globally unique GUIDs (never reused)
- Intune policy: disable accounts inactive for 90+ days

---

### IA.L2-3.5.6 — Disable Inactive Identifiers
**NIST 3.5.6 | Level 2 | SPRS Weight: 1**

> Disable identifiers after a defined period of inactivity.

**GCC High G5 Implementation:**
- Entra ID Access Reviews: automated review flags accounts with no sign-in for 90 days
- Power Automate or Logic App: disable accounts with no sign-in for 90+ days
- Conditional Access: block sign-in for accounts flagged as inactive
- Report: monthly export of last sign-in dates from Entra ID

---

### IA.L2-3.5.7 — Password Complexity
**NIST 3.5.7 | Level 2 | SPRS Weight: 3**

> Enforce a minimum password complexity and change of characters when new passwords are created.

**GCC High G5 Implementation:**
- Entra ID: minimum 14 characters (configurable via authentication methods policy)
- Custom banned password list: organization-specific terms blocked
- Smart Lockout: detects and blocks brute-force attempts
- NIST 800-63B alignment: no periodic password rotation; complexity based on length and banned list
- On-premises AD (hybrid): Password Protection proxy enforces cloud-managed banned list

---

### IA.L2-3.5.8 — Prohibit Password Reuse
**NIST 3.5.8 | Level 2 | SPRS Weight: 1**

> Prohibit password reuse for a specified number of generations.

**GCC High G5 Implementation:**
- Entra ID: password history enforcement (platform-managed)
- On-premises AD: Group Policy enforces 24-generation password history
- Self-Service Password Reset (SSPR) enforces history check on password change
- Note: NIST 800-63B de-emphasizes password history in favor of banned-word lists and length requirements

---

### IA.L2-3.5.9 — Temporary Passwords
**NIST 3.5.9 | Level 2 | SPRS Weight: 1**

> Allow temporary password use for system logons with an immediate change to a permanent password.

**GCC High G5 Implementation:**
- Entra ID: "User must change password at next sign-in" flag set on temporary password issuance
- Temporary Access Pass (TAP) for onboarding: one-time or time-limited use
- SSPR: forces immediate password change when admin resets password
- Documented process: admin issues TAP, user completes FIDO2/Authenticator registration, TAP expires

---

### IA.L2-3.5.10 — Cryptographically Protected Passwords
**NIST 3.5.10 | Level 2 | SPRS Weight: 3**

> Store and transmit only cryptographically protected passwords.

**GCC High G5 Implementation:**
- Entra ID: passwords stored as salted hashes (never plaintext)
- All authentication traffic encrypted via TLS 1.2+ (platform-enforced)
- Password Hash Sync (hybrid): SHA-256 hash transmitted over encrypted channel
- No legacy protocols (NTLM, Kerberos without armoring) for cloud authentication

---

### IA.L2-3.5.11 — Obscure Authentication Feedback
**NIST 3.5.11 | Level 2 | SPRS Weight: 1**

> Obscure feedback of authentication information.

**GCC High G5 Implementation:**
- Entra ID sign-in page: password field masked (asterisks/dots) — platform default
- Windows sign-in: password reveal button shows password only while held (configurable via Intune)
- Error messages on failed authentication are generic ("Sign-in failed") without revealing which factor was wrong
- MFA prompts do not reveal the second factor type to unauthorized parties

---

## IR — Incident Response (3 controls)

### IR.L2-3.6.1 — Incident Handling Capability
**NIST 3.6.1 | Level 2 | SPRS Weight: 3**

> Establish an operational incident-handling capability including preparation, detection, analysis, containment, recovery, and user response.

**GCC High G5 Implementation:**
- Defender XDR: unified incident queue with automated investigation and response (AIR)
- Incident Response Plan (IRP) documented in SSP appendix with roles, escalation paths, communication templates
- Defender for Endpoint: automated containment (isolate device, block file, quarantine email)
- Azure Sentinel (if deployed): SOAR playbooks automate response actions
- Tabletop exercises conducted annually with documented results

---

### IR.L2-3.6.2 — Track and Report Incidents
**NIST 3.6.2 | Level 2 | SPRS Weight: 3**

> Track, document and report incidents to designated officials and/or authorities.

**GCC High G5 Implementation:**
- Defender XDR incident queue: tracks incidents with severity, status, assignment, timeline
- Azure Sentinel (if deployed): incident tracking with SLA monitoring and auto-assignment
- DIBCAC reporting: documented procedure for reporting cyber incidents to DoD within 72 hours
- Incident log maintained in SharePoint with Purview legal hold for evidence preservation

**M365-Only Alternative:**
- Defender XDR incident queue as primary tracking system
- Integration with ServiceNow/Jira via Graph API for formal IR ticketing
- Manual IR documentation in SharePoint IR library with Purview legal hold

---

### IR.L2-3.6.3 — Test Incident Response
**NIST 3.6.3 | Level 2 | SPRS Weight: 3**

> Test the organizational incident response capability.

**GCC High G5 Implementation:**
- Annual tabletop exercise simulating CUI breach scenario
- Attack Simulation Training: phishing test campaigns with automated training for failures
- Defender XDR: simulated attack scenarios (Attack Simulation in evaluation mode)
- Post-exercise lessons learned documented and IRP updated accordingly
- Evidence: exercise reports with participant list, scenario description, findings, remediation actions

---

## MA — Maintenance (6 controls)

### MA.L2-3.7.1 — Perform System Maintenance
**NIST 3.7.1 | Level 2 | SPRS Weight: 3**

> Perform maintenance on organizational systems.

**GCC High G5 Implementation:**
- Intune: Windows Update for Business manages OS patching with deployment rings (pilot → production)
- Defender Vulnerability Management: identifies missing patches and prioritizes by CVSS
- M365 Apps update channel: Monthly Enterprise Channel for Office application updates
- Azure: Update Management for VM patching (if Azure deployed)
- Maintenance windows documented in SSP with change management process

---

### MA.L2-3.7.2 — Controls on Maintenance Tools/Personnel
**NIST 3.7.2 | Level 2 | SPRS Weight: 3**

> Provide controls on the tools, techniques, mechanisms, and personnel used to conduct system maintenance.

**GCC High G5 Implementation:**
- Admin tools: only approved management consoles (Entra portal, Intune portal, Exchange Admin Center)
- Remote management: only via approved channels (Intune, Azure Bastion, Microsoft Remote Desktop with MFA)
- Maintenance personnel: PIM-managed admin roles with time-bound activation
- Third-party maintenance: supervised access via PIM guest accounts with time-limited assignments
- Tool inventory documented in SSP

---

### MA.L2-3.7.3 — Sanitize Equipment for Off-Site Maintenance
**NIST 3.7.3 | Level 2 | SPRS Weight: 3**

> Ensure equipment removed for off-site maintenance is sanitized of any CUI.

**GCC High G5 Implementation:**
- Intune remote wipe: selective wipe removes corporate data before equipment leaves premises
- BitLocker: full-disk encryption ensures data is inaccessible without recovery key
- Documented procedure: IT performs selective wipe and verifies before releasing equipment
- Hardware disposal: NIST 800-88 compliant media sanitization (clear, purge, or destroy)

---

### MA.L2-3.7.4 — Check Maintenance Media for Malicious Code
**NIST 3.7.4 | Level 2 | SPRS Weight: 3**

> Check media containing diagnostic and test programs for malicious code before use.

**GCC High G5 Implementation:**
- Defender for Endpoint: real-time scanning of all media inserted into managed devices
- WDAC: blocks execution of unapproved diagnostic tools
- USB device control: only IT-provisioned, encrypted USB drives allowed
- Documented procedure: scan removable media with Defender before use in CUI environment

**SIT Exclusion — No Nonlocal Maintenance:**
- **Trigger:** `maintenance_posture = 'no_nonlocal'`
- **Effect:** Control is Not Applicable — no maintenance media from external sources
- **Justification:** "No nonlocal maintenance performed per Strategic Intent baseline"
- **SPRS Impact:** 3-point weight removed
- **Note:** This exclusion applies specifically to nonlocal maintenance media. Local maintenance scanning requirements still apply under MA.L2-3.7.1 and SI.L1-3.14.2.

---

### MA.L2-3.7.5 — MFA for Nonlocal Maintenance
**NIST 3.7.5 | Level 2 | SPRS Weight: 3**

> Require multifactor authentication to establish nonlocal maintenance sessions and terminate such connections when complete.

**GCC High G5 Implementation:**
- Conditional Access: require MFA + compliant device for all admin portal access
- PIM: time-bound admin role activation automatically expires (terminates session authorization)
- Azure Bastion: MFA-enforced browser-based remote access to VMs
- Session timeout: Conditional Access sign-in frequency terminates idle admin sessions

---

### MA.L2-3.7.6 — Supervise Maintenance Personnel
**NIST 3.7.6 | Level 2 | SPRS Weight: 1**

> Supervise maintenance activities of personnel without required access authorization.

**GCC High G5 Implementation:**
- Guest access in Entra ID: time-limited with PIM, requires sponsor approval
- Defender XDR: real-time monitoring of guest/vendor account activity
- Audit logs capture all actions taken by guest accounts
- Documented procedure: vendor maintenance requires designated employee escort/supervision
- Access reviews: quarterly review of guest accounts, remove when maintenance complete

---

## MP — Media Protection (9 controls)

### MP.L2-3.8.1 — Protect System Media
**NIST 3.8.1 | Level 2 | SPRS Weight: 3**

> Protect (physically control and securely store) system media containing CUI, both paper and digital.

**GCC High G5 Implementation:**
- Digital media: BitLocker full-disk encryption on all managed devices
- SharePoint/OneDrive: sensitivity labels with encryption for CUI documents
- Paper media: documented physical security procedures (locked cabinets, controlled access rooms)
- Backup media: encrypted and stored in secured location per documented procedure

---

### MP.L2-3.8.2 — Limit Access to CUI on Media
**NIST 3.8.2 | Level 2 | SPRS Weight: 1**

> Limit access to CUI on system media to authorized users.

**GCC High G5 Implementation:**
- SharePoint site permissions: CUI libraries restricted to CUI Security Group members
- Sensitivity labels with encryption: only designated users can open CUI files
- OneDrive: sharing restricted for CUI-labeled files
- Physical media: access log for media containing CUI

---

### MP.L1-3.8.3 — Sanitize Media Before Disposal
**NIST 3.8.3 | Level 1 | SPRS Weight: 3**

> Sanitize or destroy information system media containing FCI before disposal or release for reuse.

**GCC High G5 Implementation:**
- Intune remote wipe for devices being repurposed or disposed
- NIST 800-88 compliant media sanitization procedures documented
- BitLocker recovery key deleted from Entra ID before device disposal
- Paper shredding: cross-cut shredder (DIN 66399 Level P-4 minimum)
- Certificate of destruction for third-party disposal services

---

### MP.L2-3.8.4 — Mark Media with CUI Markings
**NIST 3.8.4 | Level 2 | SPRS Weight: 1**

> Mark media with necessary CUI markings and distribution limitations.

**GCC High G5 Implementation:**
- Sensitivity labels: "CUI" and "CUI//SP-..." labels with visual markings (headers, footers, watermarks)
- Auto-labeling policies in Purview detect CUI content patterns and apply labels
- Email: sensitivity label adds "CONTROLLED UNCLASSIFIED INFORMATION" banner
- Physical media: documented labeling procedures (CUI markings on USB drives, backup tapes, paper documents)

---

### MP.L2-3.8.5 — Control CUI Media During Transport
**NIST 3.8.5 | Level 2 | SPRS Weight: 3**

> Control access to media containing CUI and maintain accountability during transport outside controlled areas.

**GCC High G5 Implementation:**
- DLP policies prevent unauthorized transfer of CUI to removable media
- Encrypted USB drives required for any authorized CUI transport
- Chain-of-custody log for physical media transport
- Sensitivity labels with encryption ensure CUI remains protected in transit

**SIT Exclusion — Removable Media Blocked:**
- **Trigger:** `removable_media_posture = 'blocked'`
- **Effect:** Control is Not Applicable — no removable media transport of CUI occurs
- **Justification:** "Removable media prohibited by policy and technical control per Strategic Intent baseline"
- **SPRS Impact:** 3-point weight removed

---

### MP.L2-3.8.6 — Encrypt CUI on Digital Media During Transport
**NIST 3.8.6 | Level 2 | SPRS Weight: 3**

> Implement cryptographic mechanisms to protect CUI stored on digital media during transport.

**GCC High G5 Implementation:**
- BitLocker To Go encryption required for USB drives
- Email: sensitivity labels with S/MIME or Microsoft Purview Message Encryption
- File transfer: SFTP or HTTPS only for electronic CUI transfer
- Azure: Storage Service Encryption + customer-managed keys for blob/file storage

**SIT Exclusion — Removable Media Blocked:**
- **Trigger:** `removable_media_posture = 'blocked'`
- **Effect:** Control is Not Applicable
- **Justification:** "Removable media prohibited by policy and technical control per Strategic Intent baseline"
- **SPRS Impact:** 3-point weight removed

---

### MP.L2-3.8.7 — Control Removable Media
**NIST 3.8.7 | Level 2 | SPRS Weight: 1**

> Control the use of removable media on system components.

**GCC High G5 Implementation:**
- Defender for Endpoint: device control policies block unauthorized USB devices
- Intune: removable storage access control (read/write/execute restrictions)
- Approved USB devices identified by hardware ID in allowlist
- DLP endpoint policy: block CUI transfer to unapproved removable media

---

### MP.L2-3.8.8 — Prohibit Ownerless Portable Storage
**NIST 3.8.8 | Level 2 | SPRS Weight: 1**

> Prohibit the use of portable storage devices when such devices have no identifiable owner.

**GCC High G5 Implementation:**
- Device control policy: only IT-provisioned USB devices (with asset tag) are permitted
- Defender for Endpoint: block all removable storage by default, allowlist by hardware ID
- Documented policy: found/unmarked USB devices are confiscated and scanned in isolated environment
- Intune: USB device inventory linked to user assignment

---

### MP.L2-3.8.9 — Protect Backup CUI
**NIST 3.8.9 | Level 2 | SPRS Weight: 1**

> Protect the confidentiality of backup CUI at storage locations.

**GCC High G5 Implementation:**
- SharePoint/OneDrive: data at rest encrypted with Microsoft-managed keys (default) or customer-managed keys (G5 + compliance add-on)
- Exchange Online: mailbox encryption at rest with service encryption + customer key
- Azure Backup (if deployed): encrypted backup vaults with customer-managed keys in Key Vault
- Purview retention policies ensure CUI backups are retained for required period

---

## PE — Physical Protection (6 controls)

### PE.L1-3.10.1 — Limit Physical Access
**NIST 3.10.1 | Level 1 | SPRS Weight: 5**

> Limit physical access to organizational information systems, equipment, and operating environments to authorized individuals.

**GCC High G5 Implementation:**
- Physical security controls are customer responsibility (not cloud-managed)
- Badge/key card access to CUI processing areas
- Visitor sign-in/escort procedures
- Server rooms (if on-premises components): locked with access limited to authorized IT staff
- Documented physical security policy in SSP

---

### PE.L2-3.10.2 — Protect Physical Facility
**NIST 3.10.2 | Level 2 | SPRS Weight: 3**

> Protect and monitor the physical facility and support infrastructure.

**GCC High G5 Implementation:**
- Surveillance cameras at entry points to CUI processing areas
- Environmental controls: fire suppression, HVAC, UPS for on-premises equipment
- Physical intrusion detection (alarm system) for after-hours protection
- Documented facility security procedures in SSP

---

### PE.L1-3.10.3 — Escort Visitors
**NIST 3.10.3 | Level 1 | SPRS Weight: 5**

> Escort visitors and monitor visitor activity.

**GCC High G5 Implementation:**
- Visitor management procedures: sign-in, badge, escort at all times in CUI areas
- Visitor log maintained with entry/exit times
- Visitors must surrender badges upon departure
- No unescorted visitor access to areas where CUI is processed, stored, or transmitted

---

### PE.L1-3.10.4 — Physical Access Audit Logs
**NIST 3.10.4 | Level 1 | SPRS Weight: 1**

> Maintain audit logs of physical access.

**GCC High G5 Implementation:**
- Badge reader logs capture entry/exit with timestamp and user identity
- Visitor logs maintained (paper or electronic) with 90-day minimum retention
- Surveillance camera recordings retained per organizational policy
- Periodic review of physical access logs documented

---

### PE.L1-3.10.5 — Control Physical Access Devices
**NIST 3.10.5 | Level 1 | SPRS Weight: 1**

> Control and manage physical access devices.

**GCC High G5 Implementation:**
- Badge/key card inventory maintained by facilities management
- Lost/stolen badges immediately deactivated
- Periodic audit of active badge assignments vs. authorized personnel list
- Key/combination changes when personnel with access depart

---

### PE.L2-3.10.6 — Alternate Work Sites
**NIST 3.10.6 | Level 2 | SPRS Weight: 1**

> Enforce safeguarding measures for CUI at alternate work sites.

**GCC High G5 Implementation:**
- Conditional Access: require compliant device + MFA for access from non-corporate locations
- Intune: enforce screen lock, BitLocker, and endpoint protection at alternate sites
- DLP policies prevent CUI download to unmanaged devices
- Telework agreement: employees acknowledge CUI handling requirements at home/remote locations
- Defender for Cloud Apps: session policy blocks download of CUI files on unmanaged devices

**SIT Exclusion — No Remote Access:**
- **Trigger:** `remote_access_posture = 'no_remote'`
- **Effect:** Control is Not Applicable — no alternate/remote work sites for CUI
- **Justification:** "No remote access to CUI systems per Strategic Intent baseline"
- **SPRS Impact:** 1-point weight removed

---

## PS — Personnel Security (2 controls)

### PS.L2-3.9.1 — Screen Individuals
**NIST 3.9.1 | Level 2 | SPRS Weight: 3**

> Screen individuals prior to authorizing access to organizational systems containing CUI.

**GCC High G5 Implementation:**
- Background investigation required before CUI access granted (customer HR responsibility)
- Entra ID: user account created only after screening completion
- Documented screening criteria in SSP (criminal background check, identity verification minimum)
- Contractor screening requirements in contract language

---

### PS.L2-3.9.2 — Personnel Actions
**NIST 3.9.2 | Level 2 | SPRS Weight: 3**

> Ensure systems containing CUI are protected during and after personnel actions such as terminations and transfers.

**GCC High G5 Implementation:**
- Offboarding procedure: disable Entra ID account within 24 hours of termination
- Intune remote wipe: selective wipe of corporate data from departing employee's devices
- OneDrive access transfer: manager receives access to departed employee's OneDrive
- Litigation hold: apply Purview legal hold to departing employee's mailbox and OneDrive if required
- PIM: remove all privileged role assignments immediately upon termination
- Badge/physical access revoked simultaneously with logical access

---

## RA — Risk Assessment (3 controls)

### RA.L2-3.11.1 — Risk Assessment
**NIST 3.11.1 | Level 2 | SPRS Weight: 3**

> Periodically assess risk to organizational operations, assets, and individuals.

**GCC High G5 Implementation:**
- Microsoft Secure Score: continuous risk assessment with prioritized improvement actions
- Compliance Manager: CMMC L2 assessment template with automated scoring
- Annual risk assessment documented in SSP appendix
- Defender Vulnerability Management: continuous vulnerability assessment across managed endpoints
- Risk register maintained and reviewed quarterly

---

### RA.L2-3.11.2 — Vulnerability Scanning
**NIST 3.11.2 | Level 2 | SPRS Weight: 5**

> Scan for vulnerabilities periodically and when new vulnerabilities are identified.

**GCC High G5 Implementation:**
- Defender Vulnerability Management: continuous agent-based vulnerability scanning
- Software inventory with CVE correlation and CVSS scoring
- Threat and Vulnerability Management dashboard: prioritized remediation recommendations
- Intune: compliance policies flag devices with critical unpatched vulnerabilities as non-compliant
- Azure: Defender for Cloud vulnerability assessment for VMs and containers

---

### RA.L2-3.11.3 — Remediate Vulnerabilities
**NIST 3.11.3 | Level 2 | SPRS Weight: 5**

> Remediate vulnerabilities in accordance with risk assessments.

**GCC High G5 Implementation:**
- Defender Vulnerability Management: remediation requests create Intune security tasks
- Windows Update for Business: automated patching with deployment rings
- Intune: compliance policies quarantine devices with critical unpatched vulnerabilities
- Documented vulnerability remediation SLA: critical = 15 days, high = 30 days, medium = 90 days
- Monthly vulnerability review meeting documented

---

## CA — Security Assessment (4 controls)

### CA.L2-3.12.1 — Assess Security Controls
**NIST 3.12.1 | Level 2 | SPRS Weight: 3**

> Periodically assess security controls to determine if they are effective.

**GCC High G5 Implementation:**
- Microsoft Secure Score: continuous automated assessment of M365 security configuration
- Compliance Manager: CMMC L2 template with automated and manual assessment actions
- Annual self-assessment documented using NIST SP 800-171A methodology
- Triennial CMMC Level 2 assessment by C3PAO
- Stamper assess pipeline: automated readiness assessment against 110 controls

---

### CA.L2-3.12.2 — Plan of Action and Milestones (POA&M)
**NIST 3.12.2 | Level 2 | SPRS Weight: 3**

> Develop and implement plans of action to correct deficiencies and reduce vulnerabilities.

**GCC High G5 Implementation:**
- Compliance Manager improvement actions serve as POA&M items
- POA&M document: lists each deficiency, assigned owner, remediation plan, milestone dates
- Monthly POA&M review with management sign-off
- SPRS score update submitted to SPRS portal after remediation
- Note: 5 controls are POA&M-prohibited (3.1.20, 3.1.22, 3.10.3, 3.10.4, 3.10.5, 3.12.4) — these must be fully met before assessment

---

### CA.L2-3.12.3 — Monitor Security Controls
**NIST 3.12.3 | Level 2 | SPRS Weight: 3**

> Monitor security controls on an ongoing basis.

**GCC High G5 Implementation:**
- Microsoft Secure Score: tracks control effectiveness daily
- Compliance Manager: automated reassessment of technical controls
- Defender XDR alerts: trigger on security control degradation (e.g., Conditional Access policy disabled)
- Azure Policy (if deployed): continuous compliance monitoring of infrastructure resources
- Quarterly control effectiveness review documented

---

### CA.L2-3.12.4 — System Security Plan (SSP)
**NIST 3.12.4 | Level 2 | SPRS Weight: 5**

> Develop, document and periodically update System Security Plans.

**GCC High G5 Implementation:**
- SSP document describes: system boundary, environment of operation, security control implementation
- System boundary defined: M365 GCC High tenant + managed endpoints + (optional) Azure Gov subscription
- Interconnection agreements documented for external system connections
- Annual SSP review and update
- SSP stored in SharePoint with version control and Purview retention
- Note: POA&M-prohibited — SSP must exist before assessment

---

## SC — Systems and Communications Protection (16 controls)

### SC.L1-3.13.1 — Boundary Protection
**NIST 3.13.1 | Level 1 | SPRS Weight: 5**

> Monitor, control and protect communications at external and key internal boundaries.

**GCC High G5 Implementation:**
- Azure: NSG flow logs + Azure Firewall + Sentinel for network boundary monitoring
- Conditional Access policies: serve as the logical access boundary for M365 services
- Defender for Cloud Apps: CASB monitoring of cloud application traffic
- Exchange Online: transport rules control email flow at the organization boundary
- DLP policies monitor and control data flow at the CUI boundary

**M365-Only Alternative:**
- Conditional Access policies as boundary enforcement
- Defender for Cloud Apps session policies for session-level control
- Tenant boundary IS the security boundary
- Document: "External boundary = M365 tenant edge with Conditional Access as access control point"

---

### SC.L2-3.13.2 — Security Engineering Principles
**NIST 3.13.2 | Level 2 | SPRS Weight: 3**

> Employ architectural designs, software development techniques and systems engineering principles that promote effective information security.

**GCC High G5 Implementation:**
- GCC High is purpose-built for government security requirements (FedRAMP High authorized)
- Defense-in-depth: multiple layers (identity → device → application → data) enforced by Conditional Access
- Microsoft Secure Score + Compliance Manager guide security architecture decisions
- Documented security architecture in SSP with data flow diagrams
- Quarterly architecture review using Secure Score improvement actions

**M365-Only Alternative:**
- Microsoft Secure Score for M365 + Compliance Manager CMMC template
- Quarterly architecture review documented in SSP

---

### SC.L2-3.13.3 — Separate User and System Management Functionality
**NIST 3.13.3 | Level 2 | SPRS Weight: 3**

> Separate user functionality from system management functionality.

**GCC High G5 Implementation:**
- Admin portals (admin.microsoft.com, entra.microsoft.com) separated from user portals
- Conditional Access: dedicated policy set for admin access (stricter requirements)
- Privileged Access Workstations (PAWs): dedicated devices for admin tasks, separate from daily-use machines
- PIM: admin functionality only available during active role elevation
- Network segmentation (if Azure): admin traffic on separate subnet from user traffic

---

### SC.L2-3.13.4 — Prevent Unauthorized Information Transfer
**NIST 3.13.4 | Level 2 | SPRS Weight: 3**

> Prevent unauthorized and unintended information transfer via shared system resources.

**GCC High G5 Implementation:**
- Information Barriers: prevent cross-segment communication in Teams and SharePoint
- DLP policies: detect and block CUI in unauthorized channels
- Sensitivity labels with encryption: prevent copy/paste/forward of labeled content
- Endpoint DLP: monitor and block clipboard operations involving CUI
- Azure: managed disks and VM isolation prevent cross-tenant data leakage (platform-managed)

---

### SC.L1-3.13.5 — Publicly Accessible Subnetworks
**NIST 3.13.5 | Level 1 | SPRS Weight: 5**

> Implement subnetworks for publicly accessible system components that are physically or logically separated from internal networks.

**GCC High G5 Implementation:**
- Azure: VNet with dedicated subnets (workload, bastion, firewall) with NSG isolation
- Public-facing resources in DMZ subnet with Azure Firewall and WAF
- No direct inbound access from internet to workload subnet
- Private endpoints for Storage, Key Vault, SQL (no public IP exposure)

**M365-Only Alternative:**
- SharePoint external sharing policies restrict public-facing content
- Conditional Access named locations limit external site access to specific IP ranges
- Separate SharePoint site collections for externally shared content with restrictive DLP
- Logical separation via Entra ID groups and SharePoint permissions

---

### SC.L2-3.13.6 — Deny Network Traffic by Default
**NIST 3.13.6 | Level 2 | SPRS Weight: 3**

> Deny network communications traffic by default and allow by exception.

**GCC High G5 Implementation:**
- Azure: NSG default deny-all inbound and outbound rules, specific allow rules for required traffic
- Azure Firewall: application rules and network rules with default deny
- Intune: Windows Firewall profile with default deny inbound

**M365-Only Alternative:**
- Conditional Access "block all access" baseline policy + exception grants for trusted devices/locations/users
- Intune compliance: deny non-compliant device access (default deny posture)
- Defender for Cloud Apps: block by default, allow approved cloud apps

---

### SC.L2-3.13.7 — Prevent Split Tunneling
**NIST 3.13.7 | Level 2 | SPRS Weight: 3**

> Prevent remote devices from simultaneously establishing non-remote connections and communicating via external networks (split tunneling).

**GCC High G5 Implementation:**
- VPN configuration (if used): force-tunnel mode routes all traffic through VPN
- Intune: configure Always-On VPN profile with no split tunneling for CUI access
- Conditional Access: require compliant device (VPN compliance check) for CUI resource access
- Defender for Endpoint: network protection prevents connections to unapproved domains
- Note: M365 traffic optimization may allow direct-to-cloud for M365 URLs per Microsoft best practices, documented as acceptable in SSP

---

### SC.L2-3.13.8 — Encrypt CUI in Transit
**NIST 3.13.8 | Level 2 | SPRS Weight: 5**

> Implement cryptographic mechanisms to prevent unauthorized disclosure of CUI during transmission.

**GCC High G5 Implementation:**
- TLS 1.2+ enforced for all M365 GCC High connections (platform requirement)
- Email: Purview Message Encryption for external CUI transmission
- Sensitivity labels: auto-encrypt CUI-labeled documents
- Azure: all Azure service endpoints use TLS 1.2+
- IPsec VPN for site-to-site connections (FIPS 140-2 validated)
- SharePoint/OneDrive: data in transit encrypted via HTTPS

---

### SC.L2-3.13.9 — Terminate Network Connections
**NIST 3.13.9 | Level 2 | SPRS Weight: 3**

> Terminate network connections at end of sessions or after a defined period of inactivity.

**GCC High G5 Implementation:**
- Conditional Access sign-in frequency: sessions terminated after 8 hours (configurable)
- SharePoint idle session timeout: 15 minutes for browser sessions
- Azure VPN Gateway: idle timeout configured (4-30 minutes)
- Exchange Online: Outlook Web App session timeout
- Token lifetime policies: access tokens expire per Microsoft default (1 hour), refresh tokens per policy

---

### SC.L2-3.13.10 — Cryptographic Key Management
**NIST 3.13.10 | Level 2 | SPRS Weight: 3**

> Establish and manage cryptographic keys for cryptography employed in organizational systems.

**GCC High G5 Implementation:**
- Azure Key Vault (if deployed): HSM-backed keys with FIPS 140-2 Level 2 validation
- Key rotation policies: automatic rotation per organizational schedule
- RBAC: Key Vault access restricted to Crypto Officer and Crypto User roles
- Customer Key for M365: customer-managed encryption keys for SharePoint and Exchange (G5 + compliance add-on)

**M365-Only Alternative:**
- Entra ID Certificate-Based Authentication for device certificates
- Microsoft Cloud PKI (G5 feature) for certificate lifecycle management
- Customer Key for M365: customer-managed keys for at-rest encryption (requires additional configuration)
- Gap severity: HIGH — Key Vault provides superior centralized key management

---

### SC.L2-3.13.11 — FIPS-Validated Cryptography
**NIST 3.13.11 | Level 2 | SPRS Weight: 5**

> Employ FIPS-validated cryptography when used to protect the confidentiality of CUI.

**GCC High G5 Implementation:**
- M365 GCC High: Microsoft uses FIPS 140-2 validated cryptographic modules for data at rest and in transit
- Windows: FIPS mode can be enabled via Intune security baseline (CNG/CAPI2 validated modules)
- BitLocker: uses FIPS 140-2 validated AES-256 encryption
- Azure: all encryption services use FIPS 140-2 validated modules
- Note: Enabling Windows FIPS mode may cause application compatibility issues; test before deployment

---

### SC.L2-3.13.12 — Collaborative Computing Devices
**NIST 3.13.12 | Level 2 | SPRS Weight: 1**

> Prohibit remote activation of collaborative computing devices and provide indication of devices in use.

**GCC High G5 Implementation:**
- Teams Rooms: disable remote camera/microphone activation in Teams admin center
- Intune: configure camera and microphone policies for managed devices
- Physical indicators: LED light on cameras when active (hardware-enforced on certified Teams devices)
- Teams: meeting recording notification displayed to all participants
- Policy: document prohibition of remote activation in acceptable use policy

---

### SC.L2-3.13.13 — Control Mobile Code
**NIST 3.13.13 | Level 2 | SPRS Weight: 1**

> Control and monitor the use of mobile code.

**GCC High G5 Implementation:**
- Intune: browser security settings block unauthorized ActiveX, Java applets
- Attack Surface Reduction rules: block JavaScript/VBScript from launching downloaded content
- Defender SmartScreen: blocks malicious downloads and scripts
- WDAC: only approved executables and scripts can run
- Microsoft Edge: Enhanced Security Mode restricts JavaScript JIT compilation on untrusted sites

---

### SC.L2-3.13.14 — Control VoIP
**NIST 3.13.14 | Level 2 | SPRS Weight: 1**

> Control and monitor the use of Voice over Internet Protocol (VoIP) technologies.

**GCC High G5 Implementation:**
- Microsoft Teams: primary VoIP platform, fully integrated with GCC High security controls
- Teams calling policies: restrict external calling, PSTN access per user group
- Conditional Access: Teams access requires compliant device + MFA
- Teams audit logging: call records, meeting attendance, recording events captured
- Teams Rooms: managed via Intune with security baseline applied

---

### SC.L2-3.13.15 — Protect Communications Session Authenticity
**NIST 3.13.15 | Level 2 | SPRS Weight: 3**

> Protect the authenticity of communications sessions.

**GCC High G5 Implementation:**
- TLS 1.2+ with certificate validation for all M365 sessions
- DKIM, DMARC, SPF configured for email authenticity
- Entra ID token signing: RS256 with rotating keys (platform-managed)
- Azure: mutual TLS for service-to-service communication (where supported)
- Teams: end-to-end encrypted meetings (1:1 calls, opt-in for multi-party)

---

### SC.L2-3.13.16 — Protect CUI at Rest
**NIST 3.13.16 | Level 2 | SPRS Weight: 3**

> Protect the confidentiality of CUI at rest.

**GCC High G5 Implementation:**
- SharePoint/OneDrive: service encryption with Microsoft-managed keys (default) or Customer Key
- Exchange Online: mailbox encryption at rest with service encryption
- BitLocker: full-disk encryption on all managed endpoints
- Azure: Storage Service Encryption (SSE) with Microsoft-managed or customer-managed keys
- Sensitivity labels with encryption: file-level protection for CUI documents

**SIT Exclusion — Browser-Only CUI:**
- **Trigger:** `cui_endpoint_posture = 'browser_only'`
- **Effect:** Control is Not Applicable — CUI is never stored at rest on endpoints
- **Justification:** "CUI accessible via browser only with endpoint downloads blocked per Strategic Intent baseline"
- **Assessor Note:** Cloud-side at-rest encryption (SharePoint, Exchange) still applies. This exclusion covers only the endpoint at-rest requirement.

---

## SI — System and Information Integrity (7 controls)

### SI.L1-3.14.1 — Flaw Remediation
**NIST 3.14.1 | Level 1 | SPRS Weight: 5**

> Identify, report and correct information and information system flaws in a timely manner.

**GCC High G5 Implementation:**
- Defender Vulnerability Management: continuous flaw identification with CVE correlation
- Windows Update for Business: automated patching via Intune deployment rings
- Intune compliance: devices with critical unpatched flaws marked non-compliant
- Documented patch management SLA: critical = 15 days, high = 30 days
- Monthly patch review meeting with remediation tracking

---

### SI.L1-3.14.2 — Malicious Code Protection
**NIST 3.14.2 | Level 1 | SPRS Weight: 5**

> Provide protection from malicious code at appropriate locations.

**GCC High G5 Implementation:**
- Microsoft Defender Antivirus: real-time protection on all managed endpoints
- Defender for Office 365 P2: Safe Attachments and Safe Links for email and Teams
- Cloud-delivered protection: real-time malware signature updates
- Automatic sample submission for unknown files
- Defender for Endpoint: behavioral analysis and machine learning detection

---

### SI.L2-3.14.3 — Security Alerts and Advisories
**NIST 3.14.3 | Level 2 | SPRS Weight: 3**

> Monitor system security alerts and advisories and take action in response.

**GCC High G5 Implementation:**
- Microsoft Service Health: M365 security advisories and service notifications
- Defender Vulnerability Management: threat intelligence integration with CVE advisories
- Microsoft Security Response Center (MSRC) advisories monitored
- Documented process: weekly review of security advisories with remediation prioritization
- Azure: Defender for Cloud security recommendations (if Azure deployed)

---

### SI.L1-3.14.4 — Update Malicious Code Protection
**NIST 3.14.4 | Level 1 | SPRS Weight: 3**

> Update malicious code protection mechanisms when new releases are available.

**GCC High G5 Implementation:**
- Defender Antivirus: automatic definition updates (cloud-delivered, multiple times daily)
- Intune: Defender update ring configuration ensures timely engine/platform updates
- Compliance policy: flag devices with outdated Defender definitions as non-compliant
- Cloud-delivered protection enables zero-day detection without signature updates

---

### SI.L1-3.14.5 — System and File Scanning
**NIST 3.14.5 | Level 1 | SPRS Weight: 3**

> Perform periodic scans and real-time scans of files from external sources.

**GCC High G5 Implementation:**
- Defender Antivirus: real-time protection scans files on access, download, and execution
- Scheduled full scan: weekly via Intune configuration
- Defender for Office 365: scans email attachments and links before delivery
- SharePoint/OneDrive: automatic malware scanning of uploaded files
- Endpoint DLP: scans files at transfer points (USB, cloud upload, email attachment)

---

### SI.L2-3.14.6 — Monitor Systems for Attacks
**NIST 3.14.6 | Level 2 | SPRS Weight: 3**

> Monitor systems, including inbound and outbound communications, to detect attacks and indicators of potential attacks.

**GCC High G5 Implementation:**
- Defender for Endpoint: real-time endpoint detection and response (EDR)
- Defender for Office 365: email threat detection (phishing, malware, BEC)
- Defender for Identity: detects identity-based attacks (pass-the-hash, credential theft)
- Defender for Cloud Apps: detects anomalous cloud application behavior
- Azure Sentinel (if deployed): SIEM with correlation rules and threat intelligence matching

---

### SI.L2-3.14.7 — Identify Unauthorized Use
**NIST 3.14.7 | Level 2 | SPRS Weight: 3**

> Identify unauthorized use of organizational systems.

**GCC High G5 Implementation:**
- Entra ID Identity Protection: risk-based sign-in detection (impossible travel, anonymous proxy, malware-linked IP)
- Conditional Access: block or require MFA for risky sign-ins
- Azure Sentinel (if deployed): UEBA for user behavior anomaly detection
- Defender for Cloud Apps: anomaly detection (unusual file access, mass download)

**M365-Only Alternative:**
- Entra ID Identity Protection risk-based Conditional Access
- Defender for Cloud Apps anomaly detection (impossible travel, unusual file access)
- Purview Insider Risk Management for data exfiltration detection

---

# Appendix A: Scope Exclusion Rules Reference

These are the Strategic Intent (SI) decisions that can make specific CMMC controls Not Applicable. Each rule is triggered by a specific SIT question answer.

| # | SI Decision | SIT Field | SIT Value | Controls Excluded | SPRS Weight Removed |
|---|---|---|---|---|---|
| 1 | No mobile devices in CUI enclave | `mobile_device_presence` | `no_mobile_devices` | AC.L2-3.1.18, AC.L2-3.1.19 | 6 (3+3) |
| 2 | No wireless networks | `wireless_posture` | `no_wireless` | AC.L2-3.1.14, AC.L2-3.1.16 | 6 (5+1) |
| 3 | Removable media blocked | `removable_media_posture` | `blocked` | MP.L2-3.8.5, MP.L2-3.8.6 | 6 (3+3) |
| 4 | No remote access to CUI | `remote_access_posture` | `no_remote` | AC.L2-3.1.12, PE.L2-3.10.6 | 6 (5+1) |
| 5 | No nonlocal maintenance | `maintenance_posture` | `no_nonlocal` | MA.L2-3.7.4 | 3 |
| 6 | Browser-only CUI access | `cui_endpoint_posture` | `browser_only` | SC.L2-3.13.16 | 3 |

**Maximum combined SPRS weight removal:** 30 points (if all 6 rules apply)

**Important notes:**
- AC.L2-3.1.15 (Authorize remote execution of privileged commands) is NOT excluded by any single rule. It would require both no mobile AND no wireless, but the planner does not implement that combined exclusion.
- Assessors must validate each exclusion against the tenant's actual operational posture. An unjustified N/A claim will be scored as "not met."
- Scope exclusions are SI facts, not risk acceptances — they describe architectural realities of the CUI enclave.

---

# Appendix B: M365-Only Alternative Implementations

When a tenant uses the `m365_only` infrastructure model (no Azure subscription), 9 controls require alternative implementations that substitute M365-native capabilities for Azure services.

| Control | Standard (Azure) | M365-Only Alternative | Gap Severity |
|---|---|---|---|
| AU.L2-3.3.3 | Sentinel retention + automated review | Purview Audit Premium search + Defender XDR Advanced Hunting scheduled queries | LOW |
| AU.L2-3.3.4 | Sentinel alert on LAW heartbeat failure | Defender XDR custom detection rules + Power Automate email alerts on audit ingestion gaps | MEDIUM |
| SC.L1-3.13.1 | NSG flow logs + Azure Firewall + Sentinel | Conditional Access as boundary + Defender for Cloud Apps session policies | LOW |
| SC.L2-3.13.2 | Azure Advisor + Secure Score | Microsoft Secure Score + Compliance Manager CMMC template + quarterly architecture review | LOW |
| SC.L1-3.13.5 | VNet segregation with dedicated subnets | SharePoint external sharing policies + CA named locations + separate site collections for public content | MEDIUM |
| SC.L2-3.13.6 | NSG default deny rules | CA "block all" baseline + exception grants + Intune compliance deny non-compliant | LOW |
| SC.L2-3.13.10 | Azure Key Vault with HSM-backed keys | Entra ID CBA + Microsoft Cloud PKI + Customer Key for M365 | HIGH |
| IR.L2-3.6.2 | Sentinel incident tracking with SLA | Defender XDR incident queue + ServiceNow/Jira integration via Graph API | MEDIUM |
| SI.L2-3.14.7 | Sentinel UEBA + sign-in analytics | Entra ID Identity Protection + Defender for Cloud Apps anomaly detection + Purview Insider Risk Management | MEDIUM |

**Cost consideration:** M365-only eliminates Azure subscription costs (~$2,000-5,000/month for typical CMMC infrastructure) but accepts higher operational effort and gap severity for 9 controls.

---

# Appendix C: SPRS Weight Reference

All 110 CMMC L2 controls with their SPRS weights, POA&M eligibility, and excludability status.

**Scoring:** Start at 110. Subtract the weight for each "not met" control. Partial credit may apply per DoD Assessment Methodology.

| Weight | Controls | Count |
|---|---|---|
| 5 points | 3.1.1, 3.1.2, 3.1.3, 3.1.5, 3.1.12, 3.1.13, 3.1.14, 3.1.15, 3.1.20, 3.1.22, 3.3.1, 3.3.2, 3.4.1, 3.5.1, 3.5.2, 3.5.3, 3.10.1, 3.10.3, 3.11.2, 3.11.3, 3.12.4, 3.13.1, 3.13.5, 3.13.8, 3.13.11, 3.14.1, 3.14.2 | 27 |
| 3 points | 3.1.4, 3.1.8, 3.1.10, 3.1.11, 3.1.17, 3.1.18, 3.1.19, 3.2.1, 3.2.2, 3.2.3, 3.3.3, 3.3.4, 3.3.5, 3.3.6, 3.3.8, 3.3.9, 3.4.2, 3.4.3, 3.4.4, 3.4.5, 3.4.6, 3.4.7, 3.5.4, 3.5.7, 3.5.10, 3.6.1, 3.6.2, 3.6.3, 3.7.1, 3.7.2, 3.7.3, 3.7.4, 3.7.5, 3.8.1, 3.8.3, 3.8.5, 3.8.6, 3.9.1, 3.9.2, 3.10.2, 3.11.1, 3.12.1, 3.12.2, 3.12.3, 3.13.2, 3.13.3, 3.13.4, 3.13.6, 3.13.7, 3.13.9, 3.13.10, 3.13.15, 3.13.16, 3.14.3, 3.14.4, 3.14.5, 3.14.6, 3.14.7 | 58 |
| 1 point | 3.1.6, 3.1.7, 3.1.9, 3.1.16, 3.1.21, 3.3.7, 3.4.8, 3.4.9, 3.5.5, 3.5.6, 3.5.8, 3.5.9, 3.5.11, 3.7.6, 3.8.2, 3.8.4, 3.8.7, 3.8.8, 3.8.9, 3.10.4, 3.10.5, 3.10.6, 3.13.12, 3.13.13, 3.13.14 | 25 |

**Total: 27x5 + 58x3 + 25x1 = 135 + 174 + 25 = 334 deduction points across 110 controls**
**Maximum score: 110 (all controls met)**

### POA&M-Prohibited Controls (must be met, cannot be deferred)

| NIST Ref | Control ID | Weight | Practice |
|---|---|---|---|
| 3.1.20 | AC.L1-3.1.20 | 5 | Verify/control external system connections |
| 3.1.22 | AC.L1-3.1.22 | 5 | Control publicly accessible information |
| 3.10.3 | PE.L1-3.10.3 | 5 | Escort visitors |
| 3.10.4 | PE.L1-3.10.4 | 1 | Physical access audit logs |
| 3.10.5 | PE.L1-3.10.5 | 1 | Control physical access devices |
| 3.12.4 | CA.L2-3.12.4 | 5 | System Security Plan |

---

# Appendix D: Infrastructure Model Comparison

| Capability | M365 Only | M365 + Sentinel | M365 + Azure |
|---|---|---|---|
| **Identity & Access** | Full (Entra ID, CA, PIM) | Full | Full |
| **Endpoint Protection** | Full (Defender, Intune) | Full | Full |
| **Email Security** | Full (Defender for O365 P2) | Full | Full |
| **Data Protection** | Full (Purview, DLP, Labels) | Full | Full |
| **SIEM/SOAR** | Defender XDR only | Full (Sentinel) | Full (Sentinel) |
| **Network Security** | CA-based boundary | CA-based boundary | Full (NSG, Firewall, VNet) |
| **Key Management** | Customer Key only | Customer Key only | Full (Key Vault HSM) |
| **Infrastructure Logging** | M365 UAL only | M365 UAL + Sentinel | Full (LAW, NSG flow logs) |
| **Vulnerability Scanning** | Defender VM (endpoints) | Defender VM (endpoints) | Defender for Cloud (infra + endpoints) |
| **Controls fully covered** | 101/110 (9 alternatives) | 104/110 (6 alternatives) | 110/110 |
| **Estimated monthly cost** | G5 license only | G5 + Sentinel (~$500-1,500) | G5 + Azure (~$2,000-5,000) |
| **Assessor risk** | Medium (alternatives require justification) | Low-Medium | Low |

---

*This document was generated from the Stamper CMMC L2 control reference, CES-FE scope exclusion rules, and M365/Azure registry implementations. For the most current control implementations, run `stamper assess` against the target tenant.*
