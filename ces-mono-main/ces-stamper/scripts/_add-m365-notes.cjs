// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * _add-m365-notes.cjs
 *
 * Adds SSP-useful notes to M365 registry entries that are missing them.
 * Reads cmmc-l2-commands.registry.json, patches entries with empty/missing notes,
 * writes back with JSON.stringify(data, null, 2).
 */

const fs = require('fs');
const path = require('path');

const registryPath = path.join(__dirname, '..', 'src', 'registry', 'cmmc-l2-commands.registry.json');

// Notes lookup keyed by entry_id
const notesMap = {
  // --- AC family ---
  "AC.L2-3.1.1.operator-discover":
    "Resolves the operator's Entra ID object ID by UPN. Captures operatorUserId for downstream role assignment and group membership entries. Evidence proves the operator identity is uniquely identified per AC.L1-3.1.1.",

  "AC.L2-3.1.1.group-create":
    "Creates a dedicated Entra ID security group for CUI-authorized users. Group membership gates Conditional Access policies, sensitivity label scoping, and Information Barrier segments. Evidence proves access is limited to authorized users per AC.L1-3.1.1.",

  "AC.L2-3.1.1.member-add":
    "Adds the operator to the CUI security group. Requires cuiGroupId and operatorUserId captured from prior entries. Evidence shows the operator is enrolled in the access-controlled group per AC.L1-3.1.1.",

  "AC.L2-3.1.2.role-assign":
    "Assigns an Entra ID directory role to the operator. Uses roleDefId variable (well-known GUID for the target role). Evidence proves RBAC is enforced, limiting functions to what the role permits per AC.L2-3.1.2.",

  "AC.L2-3.1.3.ib-segment":
    "Creates an Information Barrier organization segment filtering by Department attribute. Segments are prerequisites for IB policies that control CUI information flow. Runs in Security & Compliance PowerShell (IPPS) session.",

  "AC.L2-3.1.3.ib-policy":
    "Evidence-only collection of Information Barrier policies. IB policy creation requires complex segment-to-segment rules that vary per organization. Manual configuration in the Compliance portal is recommended. Runs in IPPS session.",

  "AC.L2-3.1.4.pim-policy-get":
    "Retrieves the PIM (Privileged Identity Management) policy for the Compliance Administrator role. Captures pimPolicyId used by the pim-approval entry to configure approval requirements. Evidence proves separation of duties controls exist per AC.L2-3.1.4.",

  "AC.L2-3.1.4.pim-approval":
    "Configures PIM approval workflow for Compliance Administrator role activation. Requires approverUPN — a different user than the requestor, enforcing separation of duties. Evidence proves dual-authorization is required for privileged role activation per AC.L2-3.1.4.",

  "AC.L2-3.1.5.pim-eligible":
    "Creates a PIM eligible (JIT) role assignment instead of a permanent assignment. Assignments expire after 1 year and require activation with justification. Evidence proves least privilege via time-limited access per AC.L2-3.1.5. Also supports AC.L2-3.1.7 and SC.L2-3.13.3.",

  "AC.L2-3.1.7.pim-roles-eligible":
    "Evidence-only. Queries PIM eligible role schedules for Global Admin, Privileged Role Admin, and Security Admin. Evidence proves privileged roles use JIT activation rather than permanent assignment per AC.L2-3.1.7.",

  "AC.L2-3.1.7.pim-roles-permanent":
    "Evidence-only. Checks for permanent (non-expiring) assignments on privileged roles. Healthy state is zero permanent assignments — all should be PIM-eligible. Evidence proves no standing privileged access exists per AC.L2-3.1.7.",

  "AC.L2-3.1.9.terms-of-use":
    "Creates a Terms of Use agreement in Entra ID that users must accept before accessing CUI systems. Requires touFileName and touFileBase64 (the PDF content). Evidence proves privacy and security notices are displayed per AC.L2-3.1.9.",

  "AC.L2-3.1.10.screen-lock":
    "Deploys an Intune device configuration policy enforcing 15-minute screen lock timeout and password requirement. Targets Windows 10/11 managed devices. Evidence proves session lock with pattern-hiding display per AC.L2-3.1.10.",

  "AC.L2-3.1.11.session-timeout":
    "Creates a Conditional Access policy enforcing 8-hour sign-in frequency and disabling persistent browser sessions. Targets CUI group members with break-glass exclusion. Evidence proves automatic session termination per AC.L2-3.1.11.",

  "AC.L2-3.1.12.named-location":
    "Creates a named location (trusted IP range) in Entra ID Conditional Access. Captures namedLocationId for use in block-untrusted-locations policy. Evidence proves remote access is monitored via network location awareness per AC.L2-3.1.12.",

  "AC.L2-3.1.14.block-untrusted":
    "Creates a Conditional Access policy blocking access from untrusted network locations. Uses namedLocationId to exclude approved networks. Evidence proves remote access is routed via managed access control points per AC.L2-3.1.14. Also supports SC.L2-3.13.7 split-tunneling prevention.",

  "AC.L2-3.1.16.wifi-profile":
    "Deploys a WPA2-Enterprise Wi-Fi profile via Intune device configuration. Requires wifiSsid variable. Evidence proves wireless access is authorized and configured with enterprise authentication per AC.L2-3.1.16.",

  "AC.L2-3.1.18.mobile-ca":
    "Creates a Conditional Access policy requiring compliant or approved mobile applications for Android/iOS access. Targets CUI group with break-glass exclusion. Evidence proves mobile device access is controlled per AC.L2-3.1.18.",

  "AC.L2-3.1.19.ios-mam":
    "Deploys an iOS Mobile Application Management (MAM) policy restricting data storage to OneDrive/SharePoint, blocking backup, and requiring device compliance. Evidence proves CUI encryption on mobile platforms per AC.L2-3.1.19.",

  "AC.L2-3.1.20.guest-restrict":
    "Restricts guest invitations to admins and guest inviters only. Disables email-based subscription signups and email-verified user join. Evidence proves external system connections are controlled per AC.L1-3.1.20.",

  "AC.L2-3.1.20.spo-sharing":
    "Disables SharePoint Online external sharing at the tenant level via Graph beta admin/sharepoint/settings endpoint. Evidence proves external information system use is restricted per AC.L1-3.1.20. Uses beta endpoint — no v1.0 equivalent for this setting.",

  "AC.L2-3.1.21.block-storage":
    "Deploys an Intune device configuration policy blocking removable storage on Windows 10/11 devices. Evidence proves portable storage device use is restricted on external systems per AC.L2-3.1.21.",

  // --- AU family ---
  "AU.L2-3.3.1.audit-enable":
    "Enables Unified Audit Log ingestion in Exchange Online. This is a prerequisite for all M365 audit capabilities. Evidence proves audit logging is active for system activity monitoring per AU.L2-3.3.1.",

  "AU.L2-3.3.1.audit-retention":
    "Creates a 12-month audit log retention policy covering AAD, Exchange, SharePoint, and OneDrive record types. Runs in Security & Compliance PowerShell (IPPS). Evidence proves audit records are retained to enable investigation per AU.L2-3.3.1.",

  "AU.L2-3.3.2.signin-logs":
    "Evidence-only. Collects Entra ID sign-in and directory audit logs for the past 30 days. Evidence proves individual user actions are uniquely traceable for accountability per AU.L2-3.3.2.",

  "AU.L2-3.3.5.audit-search":
    "Evidence-only. Runs a Unified Audit Log search covering the past 7 days of ExchangeAdmin records. Demonstrates audit record review and correlation capability per AU.L2-3.3.5. Runs in Exchange Online PowerShell session.",

  // --- CM family ---
  "CM.L2-3.4.4.impact-analysis":
    "Manual gate for security impact analysis of configuration changes. Evidence command collects recent Entra ID directory audit events for ApplicationManagement, Policy, and UserManagement categories. Human review required to confirm changes were analyzed before implementation per CM.L2-3.4.4.",

  "CM.L2-3.4.6.least-functionality":
    "Deploys Intune device configuration blocking Cortana and Microsoft Sign-In Assistant. Reduces unnecessary platform services on managed devices. Evidence proves least functionality principle per CM.L2-3.4.6.",

  "CM.L2-3.4.8.detected-apps":
    "Evidence-only. Queries Intune detected applications inventory showing software name, version, and device count. Evidence proves the organization maintains a software inventory for deny-by-exception or permit-by-exception policy enforcement per CM.L2-3.4.8.",

  // --- IA family ---
  "IA.L2-3.5.3.mfa-authenticator":
    "Enables Microsoft Authenticator as an authentication method in the tenant authentication methods policy. Evidence proves MFA capability is available for all accounts per IA.L2-3.5.3.",

  "IA.L2-3.5.3.fido2-enable":
    "Enables FIDO2 security key as an authentication method. FIDO2 provides phishing-resistant MFA using hardware security keys. Evidence proves replay-resistant, phishing-resistant authentication is available per IA.L2-3.5.3.",

  "IA.L2-3.5.4.auth-strength":
    "Creates a custom authentication strength policy requiring FIDO2, Windows Hello for Business, or x509 certificate multi-factor authentication. Captures phishingResistantStrengthId for use in Conditional Access policies. Evidence proves replay-resistant authentication mechanisms per IA.L2-3.5.4.",

  "IA.L2-3.5.5.disable-inactive":
    "Disables user accounts that have been inactive for 90+ days. Excludes operator and break-glass accounts. Evidence proves identifiers are disabled after a defined period of inactivity per IA.L2-3.5.5 and IA.L2-3.5.6.",

  "IA.L2-3.5.8.password-reuse":
    "Evidence-only. Queries domain password validity period from Entra ID. Azure AD enforces password history (preventing reuse) at the platform level. Evidence proves password reuse prevention per IA.L2-3.5.8.",

  "IA.L2-3.5.10.cert-auth":
    "Enables x509 certificate-based authentication in the tenant authentication methods policy. CBA provides cryptographic proof of identity without transmitting passwords. Evidence proves passwords are stored and transmitted only in cryptographically protected form per IA.L2-3.5.10.",

  // --- IR family ---
  "IR.L2-3.6.1.atp-enable":
    "Enables Defender for Office 365 Advanced Threat Protection for SharePoint, Teams, and OneDrive. Provides real-time file scanning and detonation in these workloads. Evidence proves incident preparation and detection capability per IR.L2-3.6.1.",

  "IR.L2-3.6.1.malware-filter":
    "Enables file type filtering in the Default malware filter policy. Blocks known-malicious file types at the Exchange transport layer. Evidence proves malware detection and containment per IR.L2-3.6.1.",

  // --- MA family ---
  "MA.L2-3.7.1.update-ring":
    "Deploys a Windows Update for Business ring via Intune with 7-day quality update deferral, 30-day feature update deferral, and auto-install at scheduled time. Evidence proves system maintenance is performed via automated patching per MA.L2-3.7.1 and MA.L2-3.7.2.",

  // --- MP family ---
  "MP.L2-3.8.1.cui-label":
    "Creates a 'CUI' sensitivity label with encryption enabled in Security & Compliance PowerShell. Covers MP.L2-3.8.1 (protect media), MP.L2-3.8.2 (limit access), and MP.L2-3.8.4 (CUI marking). Evidence proves CUI markings and encryption are available for digital media.",

  "MP.L2-3.8.1.label-policy":
    "Publishes the CUI sensitivity label to all Exchange workloads via a label policy. Labels are not usable until published. Evidence proves CUI protection labels are available to all users per MP.L2-3.8.1.",

  "MP.L2-3.8.3.sanitize":
    "Manual gate for media sanitization before disposal. No automation surface for physical media destruction. Evidence requires sanitization logs with device serial, method, timestamp, operator, and verification status per MP.L1-3.8.3.",

  "MP.L2-3.8.6.bitlocker":
    "Deploys BitLocker drive encryption policy via Intune using XTS-AES 256-bit encryption with startup authentication. Evidence proves CUI is cryptographically protected on digital media during transport per MP.L2-3.8.6.",

  "MP.L2-3.8.7.removable-id":
    "Manual gate for removable media identification and marking. Evidence command queries CUI sensitivity labels to verify labeling capability exists. Physical marking procedures require manual documentation per MP.L2-3.8.7.",

  "MP.L2-3.8.8.storage-owner":
    "Manual gate for portable storage device ownership tracking. No automation surface for physical device inventory. Evidence requires CSV/JSON with device serial, owner, issue date, return date, and CUI authorization status per MP.L2-3.8.8.",

  "MP.L2-3.8.9.dlp-policy":
    "Creates a DLP compliance policy covering Exchange, SharePoint, and OneDrive locations. DLP policies take hours to distribute across workloads (consistency_hint: eventual_hours). Evidence proves CUI backup confidentiality is enforced per MP.L2-3.8.9.",

  "MP.L2-3.8.9.dlp-rule":
    "Creates a DLP compliance rule under the CMMC-CUI-Block policy that blocks access and notifies the site admin. Runs in Security & Compliance PowerShell (IPPS). Evidence proves CUI blocking enforcement per MP.L2-3.8.9.",

  // --- PS family ---
  "PS.L2-3.9.1.screening":
    "Manual gate for personnel screening. Evidence command collects Entra ID audit logs for user creation events. HR screening records must be uploaded manually. Evidence proves individuals are screened before CUI system access per PS.L2-3.9.1.",

  "PS.L2-3.9.2.termination":
    "Evidence-only. Queries disabled Entra ID accounts to verify terminated/transferred personnel have been deprovisioned. Evidence proves systems are protected during personnel actions per PS.L2-3.9.2.",

  // --- RA family ---
  "RA.L2-3.11.1.secure-score":
    "Evidence-only. Collects Microsoft Secure Score as proxy evidence of periodic risk assessment. Secure Score evaluates tenant configuration against security best practices. Evidence proves risk assessment capability per RA.L2-3.11.1.",

  // --- SC family ---
  "SC.L2-3.13.2.advisor":
    "Evidence-only. Queries Azure Advisor security recommendations for the subscription. Evidence proves architectural review and security engineering principles are applied per SC.L2-3.13.2.",

  "SC.L2-3.13.8.tls-enforce":
    "Disables legacy TLS client connections in Exchange Online transport configuration. Ensures all email transport uses TLS 1.2+. Evidence proves cryptographic mechanisms protect CUI during transmission per SC.L2-3.13.8 and AC.L2-3.1.13.",

  "SC.L2-3.13.12.camera-block":
    "Deploys an Intune device configuration policy blocking the camera on managed Windows devices. Prevents unauthorized remote activation of collaborative computing devices per SC.L2-3.13.12.",

  "SC.L2-3.13.13.safe-attach":
    "Creates a Safe Attachments policy with Dynamic Delivery action in Exchange Online. Attachments are scanned in a sandbox while the message body is delivered immediately. Evidence proves mobile code (email attachments) is controlled per SC.L2-3.13.13.",

  "SC.L2-3.13.13.safe-attach-rule":
    "Creates a Safe Attachments rule applying the CMMC-SafeAttach policy to the primary domain. Requires primaryDomain variable. Evidence proves Safe Attachments coverage for the organization per SC.L2-3.13.13.",

  "SC.L2-3.13.14.teams-external":
    "Disables Teams federation and public cloud consumer access at the tenant level. Runs in Teams PowerShell session. Evidence proves VoIP/collaboration technologies are controlled and external access is restricted per SC.L2-3.13.14.",

  "SC.L2-3.13.15.dkim":
    "Enables DKIM (DomainKeys Identified Mail) signing for the primary domain. DKIM provides email authentication via cryptographic signatures. Evidence proves communications session authenticity per SC.L2-3.13.15.",

  "SC.L2-3.13.15.anti-phish":
    "Creates an anti-phishing policy with mailbox intelligence, spoof intelligence, and first-contact safety tips. Authentication failures are quarantined. Evidence proves communications session authenticity per SC.L2-3.13.15.",

  "SC.L2-3.13.15.anti-phish-rule":
    "Creates an anti-phishing rule applying the CMMC-AntiPhish policy to the primary domain. Requires primaryDomain variable. Evidence proves anti-phishing coverage for the organization per SC.L2-3.13.15.",

  "SC.L2-3.13.15.anti-spam":
    "Creates an inbound content filter policy with spam moved to Junk folder, high-confidence spam quarantined, and bulk threshold set to 6. Evidence proves communications session integrity via spam filtering per SC.L2-3.13.15.",

  "SC.L2-3.13.15.anti-spam-rule":
    "Creates an inbound content filter rule applying the CMMC-AntiSpam policy to the primary domain. Requires primaryDomain variable. Evidence proves anti-spam coverage for the organization per SC.L2-3.13.15.",

  "SC.L2-3.13.15.outbound-spam":
    "Creates an outbound spam filter policy that blocks the user when threshold is reached and limits external recipients to 500/hour. Evidence proves outbound communications are monitored for abuse per SC.L2-3.13.15.",

  "SC.L2-3.13.15.outbound-spam-rule":
    "Creates an outbound spam filter rule applying the CMMC-OutboundSpam policy to the primary domain. Requires primaryDomain variable. Evidence proves outbound spam protection coverage per SC.L2-3.13.15.",

  // --- SI family ---
  "SI.L2-3.14.2.anti-malware":
    "Creates a malware filter policy with file type rejection and internal admin notification. Requires securityEmail variable for admin notifications. Evidence proves malicious code protection at the email transport layer per SI.L1-3.14.2.",

  "SI.L2-3.14.2.malware-rule":
    "Creates a malware filter rule applying the CMMC-Malware policy to the primary domain. Requires primaryDomain variable. Evidence proves malware filtering coverage for the organization per SI.L1-3.14.2.",

  "SI.L2-3.14.3.safe-links":
    "Creates a Safe Links policy enabling URL scanning for email, internal senders, and deferred delivery. Scans URLs at time-of-click to detect malicious redirects. Evidence proves system security alert monitoring via URL threat detection per SI.L2-3.14.3.",

  "SI.L2-3.14.3.safe-links-rule":
    "Creates a Safe Links rule applying the CMMC-SafeLinks policy to the primary domain. Requires primaryDomain variable. Evidence proves Safe Links URL scanning coverage per SI.L2-3.14.3.",

  "SI.L2-3.14.6.security-alerts":
    "Evidence-only. Collects Microsoft Secure Score availability and recent Defender security alerts (top 10). Evidence proves inbound/outbound communications traffic is monitored for attacks per SI.L2-3.14.6.",

  "RA.L2-3.11.2.vuln-scan": null, // already has notes
};

// Read the registry
const raw = fs.readFileSync(registryPath, 'utf8');
const registry = JSON.parse(raw);

let added = 0;
let alreadyHadNotes = 0;
let notInMap = 0;

for (const entry of registry.entries) {
  const id = entry.entry_id;
  const hasNotes = entry.notes && entry.notes.trim().length > 0;

  if (hasNotes) {
    alreadyHadNotes++;
    continue;
  }

  if (notesMap[id] && notesMap[id] !== null) {
    entry.notes = notesMap[id];
    added++;
  } else if (notesMap[id] === null) {
    // explicitly skipped
  } else {
    notInMap++;
    console.log(`WARNING: entry ${id} has no notes and is not in the lookup map`);
  }
}

// Write back
fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n', 'utf8');

console.log(`\nDone.`);
console.log(`  Entries already with notes: ${alreadyHadNotes}`);
console.log(`  Notes added: ${added}`);
console.log(`  Missing from map (need manual review): ${notInMap}`);
console.log(`  Total entries: ${registry.entries.length}`);
