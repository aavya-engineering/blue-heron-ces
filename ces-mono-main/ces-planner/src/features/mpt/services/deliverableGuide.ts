// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// ---------------------------------------------------------------------------
// Deliverable Content Guidance for Non-Systems CMMC Artifacts
//
// Provides document structure, assessor expectations, and automation tips for
// policies, procedures, training programs, and administrative records that
// cannot be produced by system configuration exports alone.
// ---------------------------------------------------------------------------

import type { PatternEntry } from '@/shared/types/domain';

interface DeliverableTemplate {
  documentName: string;
  sections: string[];
  assessorChecklist: string[];
  automationTip: string;
  references: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Template Definitions (keyed by stable ID)
// ═══════════════════════════════════════════════════════════════════════════

const T: Record<string, DeliverableTemplate> = {
  // ── PE — Physical Protection ────────────────────────────────────────────

  visitor_mgmt: {
    documentName: 'Visitor Management Procedure & Log',
    sections: [
      'Purpose, scope, and facility coverage',
      'Visitor categories: escorted, limited-unescorted, prohibited areas',
      'Pre-visit authorization and sponsor responsibilities',
      'Check-in/check-out: sign-in form fields, ID verification, badge issuance/retrieval',
      'Escort rules: maximum visitor-to-escort ratio, movement restrictions, break protocol',
      'Visitor log required fields: name, org, sponsor, purpose, badge #, time-in/out, areas visited',
      'Prohibited items list and inspection procedures',
    ],
    assessorChecklist: [
      'Sign-in log contains all required fields for every visit in the review period',
      'Badges are visually distinct from employee badges and collected at checkout',
      'Escort policy specifies who may escort and maximum visitor-to-escort ratio',
      'Visitor logs retained at least 3 years and producible for audit on demand',
    ],
    automationTip:
      'Microsoft Forms for digital sign-in → Power Automate logs entries to SharePoint list and notifies sponsor. Badge system API integration captures time-in/out automatically.',
    references: ['NIST SP 800-171 3.10.3', 'NIST SP 800-53 PE-3, PE-8'],
  },

  physical_access_device: {
    documentName: 'Physical Access Device Management Procedure',
    sections: [
      'Device types covered: badges, keys, key cards, combinations, PINs',
      'Issuance workflow: request → authorization → provisioning → acknowledgment',
      'Inventory tracking fields: device ID, assignee, access level, issue date, return date',
      'Lost/stolen device procedure: same-day deactivation, re-issuance, incident report',
      'Periodic inventory reconciliation schedule (at least quarterly)',
      'Termination tie-in: device recovery on employee departure date',
    ],
    assessorChecklist: [
      'Complete device inventory with current assignees maintained',
      'Lost/stolen device procedure includes same-day deactivation requirement',
      'Inventory reconciliation performed at least quarterly with documented results',
      'Terminated employee devices recovered and logged on departure date',
    ],
    automationTip:
      'SharePoint list for device inventory with Power Automate alerts for overdue returns and quarterly reconciliation reminders. Badge system API for automated issuance/deactivation.',
    references: ['NIST SP 800-171 3.10.1', 'NIST SP 800-53 PE-3'],
  },

  facility_monitoring: {
    documentName: 'Facility Monitoring & Surveillance Plan',
    sections: [
      'Monitored areas: all locations with CUI systems, entry points, server rooms',
      'Monitoring methods: CCTV, intrusion detection sensors, environmental monitors',
      'Camera coverage map with field-of-view diagrams and blind-spot analysis',
      'Monitoring schedule (24/7 vs business hours) and staffing model',
      'Recording retention period (minimum 90 days) and storage requirements',
      'Alarm response procedures, escalation matrix, and after-hours contacts',
    ],
    assessorChecklist: [
      'Camera coverage map covers all CUI processing and storage areas',
      'Recording retention meets or exceeds 90 days',
      'Alarm response procedures tested at least annually',
      'Monitoring system uptime logs reviewed for gaps or tampering',
    ],
    automationTip:
      'Integrate physical security alerts with Microsoft Sentinel for unified monitoring. Power BI dashboard for camera uptime and incident tracking.',
    references: ['NIST SP 800-171 3.10.2', 'NIST SP 800-53 PE-6'],
  },

  alternate_site: {
    documentName: 'Alternate Work Site Security Policy',
    sections: [
      'Applicability: telework, co-working spaces, travel, disaster recovery sites',
      'Security requirements by site type: encryption, VPN, physical controls',
      'CUI handling restrictions at alternate sites',
      'Equipment requirements: approved devices, screen privacy, secure storage',
      'Incident reporting from alternate sites',
    ],
    assessorChecklist: [
      'Alternate site policy exists and covers all remote work scenarios',
      'CUI handling requirements specified for each site type',
      'Personnel acknowledge alternate site security requirements',
      'Policy reviewed and updated at least annually',
    ],
    automationTip:
      'Intune compliance policies enforce device encryption and VPN at alternate sites. Conditional Access policies restrict access from non-compliant devices.',
    references: ['NIST SP 800-171 3.10.6', 'NIST SP 800-53 PE-17'],
  },

  // ── PS — Personnel Security ─────────────────────────────────────────────

  screening: {
    documentName: 'Personnel Screening Policy & Procedure',
    sections: [
      'Screening levels by role tier: general user, privileged user, CUI handler, admin',
      'Background check requirements per tier: criminal, financial, employment verification',
      'Pre-access gate: screening must complete before CUI system access is provisioned',
      'Rescreening frequency: standard roles every 5 years, privileged every 2-3 years',
      'Disqualifying criteria and appeals/waiver process',
      'Records retention and privacy protections for screening data',
    ],
    assessorChecklist: [
      'All CUI-access personnel screened before access was provisioned',
      'Screening levels defined for each role category with documented criteria',
      'Rescreening schedule documented and tracked to completion',
      'Screening records retained per policy with appropriate access controls',
    ],
    automationTip:
      'Entra ID Lifecycle Workflows: gate CUI group membership on screening-status attribute from HR system. Power Automate sends rescreening due-date reminders to HR and managers.',
    references: ['NIST SP 800-171 3.9.1', 'NIST SP 800-53 PS-3, PS-7'],
  },

  termination: {
    documentName: 'Personnel Termination & Transfer Procedure',
    sections: [
      'Trigger events: voluntary termination, involuntary termination, transfer, reassignment',
      'Same-day actions: disable all system accounts, revoke VPN and remote access tokens',
      'Physical access: collect badges, keys, access devices; deactivate in badge system',
      'Property return: laptops, mobile devices, removable media, CUI hardcopy materials',
      'CUI data disposition: archive or verified destruction of CUI in departing user custody',
      'Exit interview: security debriefing on ongoing NDA and CUI handling obligations',
      'Offboarding checklist with IT, security, facilities, and manager sign-offs',
    ],
    assessorChecklist: [
      'All system accounts disabled within 24 hours of separation (same day for involuntary)',
      'Physical access devices collected and deactivated with documented confirmation',
      'Completed offboarding checklists on file for all departures in review period',
      'CUI materials returned or destruction documented with witness',
    ],
    automationTip:
      'Entra ID Lifecycle Workflows triggered by HR termination event → auto-disable accounts, revoke sessions, remove group memberships. Power Automate orchestrates multi-system checklist to IT, security, and facilities.',
    references: ['NIST SP 800-171 3.9.2', 'NIST SP 800-53 PS-4, PS-5'],
  },

  adverse_action: {
    documentName: 'Adverse Information & Protective Actions Procedure',
    sections: [
      'Trigger criteria: what constitutes adverse information (security violations, criminal activity)',
      'Assessment process: investigation steps, evidence collection, decision authority',
      'Protective measures: immediate access suspension, enhanced monitoring, reassignment',
      'Notification chain: security officer → management → HR → legal',
      'Documentation requirements: decisions, rationale, actions taken, retention period',
    ],
    assessorChecklist: [
      'Defined criteria for what triggers an adverse information review',
      'Decision authority clearly identified (security officer or delegate)',
      'Protective actions implementable within 24 hours of determination',
      'All actions and decisions documented and retained per policy',
    ],
    automationTip:
      'Microsoft Purview Insider Risk Management for behavioral detection triggers. Power Automate for investigation workflow and decision tracking in SharePoint.',
    references: ['NIST SP 800-171 3.9.2', 'NIST SP 800-53 PS-4, PS-7'],
  },

  access_agreement: {
    documentName: 'Access Agreement & Acceptable Use Policy',
    sections: [
      'Agreement types: general access (all users), privileged access, remote access, third-party',
      'Content per agreement: permitted use, prohibited activities, monitoring notice, CUI handling obligations',
      'Signature requirements: before access provisioning, re-sign on policy update',
      'Acknowledgment tracking: who signed, date, version, next renewal',
      'Non-compliance consequences and enforcement process',
    ],
    assessorChecklist: [
      'Signed agreements on file for all current users with CUI access',
      'Agreement content covers CUI handling, monitoring consent, and acceptable use',
      'Re-acknowledgment performed when agreements are updated',
      'Third-party personnel have appropriate agreements before access',
    ],
    automationTip:
      'SharePoint with Power Automate approval for digital signature. Entra ID: gate access provisioning on signed agreement status. Automated annual re-acknowledgment campaigns.',
    references: ['NIST SP 800-171 3.9.2', 'NIST SP 800-53 PS-6'],
  },

  sanctions: {
    documentName: 'Personnel Sanctions Policy',
    sections: [
      'Scope: applies to all personnel with access to CUI systems',
      'Violation categories: minor (e.g., tailgating), moderate (e.g., unauthorized sharing), severe (e.g., data exfiltration)',
      'Sanction levels per category: counseling, written warning, access suspension, termination, legal referral',
      'Investigation and due process requirements',
      'Documentation and records retention',
    ],
    assessorChecklist: [
      'Sanctions policy exists and is communicated to all personnel',
      'Sanction levels proportional to violation severity',
      'Process includes investigation and due process before sanctions applied',
      'Sanction records maintained and available for review',
    ],
    automationTip:
      'SharePoint for sanctions tracking with restricted access. Power Automate for escalation workflows and HR notification.',
    references: ['NIST SP 800-171 3.9.2', 'NIST SP 800-53 PS-8'],
  },

  // ── MA — Maintenance ────────────────────────────────────────────────────

  maintenance: {
    documentName: 'System Maintenance Policy & Procedure',
    sections: [
      'Maintenance categories: routine/scheduled, emergency, vendor-performed',
      'Scheduling and approval workflow: request → approve → schedule → execute → verify',
      'Pre-maintenance security: isolate CUI data, verify technician clearance, define scope',
      'Execution logging: start/stop times, actions taken, components replaced, personnel',
      'Post-maintenance verification: security config check, integrity validation, functionality test',
      'Record fields: date, system ID, type, description, technician, approver, CUI-isolation verified',
    ],
    assessorChecklist: [
      'Maintenance schedule exists and is followed for all in-scope systems',
      'Approval documented before each maintenance event',
      'CUI systems isolated or continuously monitored during maintenance',
      'Post-maintenance security verification performed and documented',
      'Complete maintenance records available for the full review period',
    ],
    automationTip:
      'Azure DevOps or Planner for maintenance scheduling and approval. ServiceNow/Jira for ticketing. Intune for post-maintenance remote health verification.',
    references: ['NIST SP 800-171 3.7.1, 3.7.2', 'NIST SP 800-53 MA-2, MA-5'],
  },

  tool_control: {
    documentName: 'Maintenance Tool Control Procedure',
    sections: [
      'Authorized tool list: tool name, version, purpose, risk level, approval date',
      'Authorization process: request → security risk review → approval → add to inventory',
      'Inspection requirements: tools inspected before and after use on CUI systems',
      'Diagnostic tool sanitization: remove all CUI data before tool leaves the facility',
      'Prohibited tools and enforcement policy',
    ],
    assessorChecklist: [
      'Authorized tool list is current and reviewed at least annually',
      'Tools inspected for unauthorized software/data before and after use',
      'Diagnostic media sanitized of CUI before removal from facility',
      'Unauthorized tools explicitly prohibited with documented enforcement',
    ],
    automationTip:
      'SharePoint list for tool registry with Power Automate approval workflow. Intune/Defender for Endpoint USB device control for digital diagnostic tools.',
    references: ['NIST SP 800-171 3.7.1, 3.7.2', 'NIST SP 800-53 MA-3'],
  },

  supervised_maintenance: {
    documentName: 'Supervised Maintenance Procedure',
    sections: [
      'Applicability: all maintenance by non-cleared or external personnel',
      'Supervision requirements: cleared escort with continuous presence, area restrictions',
      'Pre-maintenance briefing: security rules, prohibited actions, CUI handling',
      'Activity logging: supervisor, technician, start/end time, observed actions',
      'Post-session verification: system integrity check, no unauthorized changes or data removal',
    ],
    assessorChecklist: [
      'All non-cleared maintenance supervised by authorized cleared personnel',
      'Supervision logs include supervisor identity and continuous-presence attestation',
      'Post-maintenance integrity checks documented for each session',
      'Technicians briefed on security requirements before every session',
    ],
    automationTip:
      'Microsoft Forms for pre-maintenance security briefing acknowledgment. SharePoint for supervision logs. Power Automate triggers post-session integrity check assignment.',
    references: ['NIST SP 800-171 3.7.5, 3.7.6', 'NIST SP 800-53 MA-5'],
  },

  // ── MP — Media Protection ──────────────────────────────────────────────

  media_disposal: {
    documentName: 'Media Protection & Disposal Policy',
    sections: [
      'Media types in scope: HDDs, SSDs, USB drives, optical media, paper, tapes',
      'Protection requirements by media type and CUI classification level',
      'Disposal authorization: who approves disposal, documentation required',
      'Sanitization method-to-media mapping per NIST SP 800-88 Rev 1 (Clear, Purge, Destroy)',
      'Third-party disposal: vendor security requirements, certificates of destruction, chain-of-custody',
    ],
    assessorChecklist: [
      'Policy covers all media types present in the environment',
      'Sanitization methods align with NIST SP 800-88 Rev 1 for each media type',
      'Certificates of destruction collected from all third-party disposal vendors',
      'Policy reviewed and updated at least annually',
    ],
    automationTip:
      'Compliance Manager template for media protection policy scaffolding. SharePoint for media lifecycle tracking. Power Automate for disposal request and approval workflow.',
    references: [
      'NIST SP 800-171 3.8.1, 3.8.3',
      'NIST SP 800-88 Rev 1',
      'NIST SP 800-53 MP-6',
    ],
  },

  sanitization: {
    documentName: 'Media Sanitization Procedure (per NIST 800-88)',
    sections: [
      'Decision flow: determine media type → select sanitization method → execute → verify → document',
      'Method-to-media mapping: HDD (degauss+destroy), SSD (crypto-erase+destroy), USB (crypto-erase), paper (cross-cut shred ≤1mm), optical (shred/incinerate)',
      'Verification: confirm sanitization effectiveness via spot-check, tool verification, or witness',
      'Record fields: date, media type, serial/asset ID, method used, performed-by, verified-by, certificate ref',
      'Failed sanitization escalation: proceed to physical destruction with documented rationale',
    ],
    assessorChecklist: [
      'Sanitization methods match NIST 800-88 guidance for each specific media type',
      'Each sanitization event has a complete record with all required fields',
      'Verification step performed after each sanitization (not assumed)',
      'Failed sanitizations escalated to physical destruction with documentation',
    ],
    automationTip:
      'SharePoint list for sanitization event tracking with barcode/QR scanner input. Power Automate auto-generates sanitization certificates. Integrate with asset management for media lifecycle.',
    references: [
      'NIST SP 800-88 Rev 1 (Guidelines for Media Sanitization)',
      'NIST SP 800-171 3.8.3',
      'NIST SP 800-53 MP-6',
    ],
  },

  media_marking: {
    documentName: 'CUI Media Marking Procedure',
    sections: [
      'Marking requirements per 32 CFR Part 2002: CUI banner, category, dissemination controls',
      'Physical media: labels, stamps, or indelible markings on exterior',
      'Digital media: file headers, folder naming conventions, sensitivity labels',
      'Marking examples and templates for each media type (provided as reference cards)',
      'Responsibility: who marks, verification process, correction procedure',
    ],
    assessorChecklist: [
      'All CUI media properly marked per 32 CFR Part 2002',
      'Marking consistent across physical and digital media',
      'Personnel trained on marking requirements with reference materials available',
      'Marking verified during periodic reviews',
    ],
    automationTip:
      'Microsoft Purview sensitivity labels for automated digital CUI marking. Label policies auto-apply to documents matching CUI patterns. SharePoint hosts printable label templates for physical media.',
    references: [
      '32 CFR Part 2002 (CUI Marking)',
      'NIST SP 800-171 3.8.4',
      'NIST SP 800-53 MP-3',
    ],
  },

  media_transport: {
    documentName: 'Media Transport Protection Procedure',
    sections: [
      'Applicability: all physical transport of CUI media outside controlled areas',
      'Protection methods: tamper-evident packaging, encryption for digital media (FIPS 140-validated)',
      'Chain-of-custody fields: sender, carrier, recipient, each transfer point, timestamps',
      'Authorized carriers and approved transport methods',
      'Receipt confirmation: recipient verifies integrity and acknowledges receipt',
    ],
    assessorChecklist: [
      'Chain-of-custody documented for every transport event',
      'Tamper-evident packaging used for all physical CUI media',
      'Digital media encrypted with FIPS 140-2/3 validated encryption during transport',
      'Receipt confirmation obtained and retained from every recipient',
    ],
    automationTip:
      'SharePoint list for transport tracking with chain-of-custody log. Power Automate sends receipt confirmation request to recipient. BitLocker To Go for USB encryption.',
    references: ['NIST SP 800-171 3.8.5, 3.8.6', 'NIST SP 800-53 MP-5'],
  },

  // ── AT — Awareness & Training ───────────────────────────────────────────

  security_training: {
    documentName: 'Security Awareness Training Program',
    sections: [
      'Training objectives aligned to CMMC: CUI handling, access control, incident reporting, social engineering, physical security, media protection',
      'Target audience: all personnel with access to CUI systems or data',
      'Curriculum outline: module topics, learning objectives, duration per module',
      'Delivery methods: LMS (online), in-person, hybrid; phishing simulations for reinforcement',
      'Schedule: within 30 days of hire/onboarding, annual refresher, ad-hoc for policy changes',
      'Assessment: knowledge checks per module, minimum passing score (e.g., 80%), remediation path for failures',
      'Completion tracking fields: employee name, course, completion date, score, next due date',
    ],
    assessorChecklist: [
      'All in-scope personnel trained within 30 days of onboarding',
      'Annual refresher completed with documented participation rate (target ≥95%)',
      'Content covers CUI identification, marking, handling, storage, and destruction',
      'Phishing/social engineering awareness included with simulation exercises',
      'Non-completers have documented remediation plan with timeline',
    ],
    automationTip:
      'Viva Learning or KnowBe4 for course delivery and LMS tracking. Microsoft Forms for knowledge assessments. Power BI dashboard for completion rates. Entra ID dynamic groups auto-assign training to new hires.',
    references: ['NIST SP 800-171 3.2.1', 'NIST SP 800-53 AT-2'],
  },

  role_training: {
    documentName: 'Role-Based Security Training Program',
    sections: [
      'Role categories: system admin, developer, auditor, incident responder, security manager, general privileged user',
      'Role-specific topics: admin (hardening, logging, account mgmt), developer (secure coding, SAST/DAST), IR (forensics, containment, evidence handling)',
      'Prerequisites: general security awareness training required before role-specific',
      'Hands-on labs or practical exercises for technical roles',
      'Certification requirements where applicable (CompTIA Security+, CISSP, etc.)',
      'Update triggers: role change, new systems deployed, emerging threat landscape',
    ],
    assessorChecklist: [
      'Each privileged role has documented training requirements',
      'Role-specific training completed before privileged access granted',
      'Training curriculum reviewed when roles, systems, or threats change',
      'Hands-on assessment documented for technical roles',
    ],
    automationTip:
      'Viva Learning role-based learning paths assigned via Entra ID security groups. SharePoint tracks certifications with Power Automate expiration alerts.',
    references: ['NIST SP 800-171 3.2.2', 'NIST SP 800-53 AT-3'],
  },

  insider_threat: {
    documentName: 'Insider Threat Awareness Training',
    sections: [
      'Insider threat types: malicious (intentional theft/sabotage), negligent (accidental exposure), compromised (credential theft)',
      'Behavioral indicators: unauthorized access attempts, unusual data transfers, policy violations, disgruntlement',
      'Reporting channels: who to contact, anonymous options (hotline, web form)',
      'Organizational response: what happens after a report (investigation, no retaliation)',
      'Case studies relevant to CUI/defense environments',
    ],
    assessorChecklist: [
      'All personnel complete insider threat training at least annually',
      'Training covers malicious, negligent, and compromised insider scenarios',
      'Reporting channels clearly communicated and easily accessible',
      'Training updated to reflect current threat landscape',
    ],
    automationTip:
      'Microsoft Purview Insider Risk Management for automated behavioral detection. Viva Learning for training delivery. Microsoft Forms for anonymous reporting intake.',
    references: [
      'NIST SP 800-171 3.2.3',
      'NIST SP 800-53 AT-2(2), PM-12',
    ],
  },

  security_exercises: {
    documentName: 'Security Exercise & Simulation Program',
    sections: [
      'Exercise types: phishing simulation, tabletop, functional (red team), full-scale, disaster recovery',
      'Exercise schedule: phishing monthly, tabletop quarterly, functional/full annually',
      'Scenario development: realistic threats to CUI environment (spillage, breach, ransomware)',
      'Execution: participants, rules of engagement, objectives, success criteria',
      'After-action report: findings, lessons learned, improvement actions, responsible owners',
    ],
    assessorChecklist: [
      'Phishing simulations conducted regularly with tracked click/report rates',
      'Tabletop exercises cover CUI-specific incident scenarios',
      'After-action reports completed with improvement actions assigned',
      'Improvement actions tracked to closure',
    ],
    automationTip:
      'Defender Attack Simulation Training for automated phishing campaigns with metrics. SharePoint for exercise docs and after-action reports. Planner for improvement action tracking.',
    references: ['NIST SP 800-171 3.6.3', 'NIST SP 800-53 IR-3, CP-4'],
  },

  // ── CA/RA — Security Assessment & Risk Assessment ──────────────────────

  risk_assessment: {
    documentName: 'Risk Assessment Report & Risk Register',
    sections: [
      'Assessment scope: systems, boundaries, data types in scope for CUI',
      'Methodology: NIST SP 800-30 or organizational risk framework, likelihood × impact model',
      'Threat identification: threat sources, threat events, relevance to CUI environment',
      'Vulnerability identification: scan results, architectural weaknesses, process gaps',
      'Risk determination: likelihood × impact matrix, risk level per finding (Critical/High/Medium/Low)',
      'Risk register fields: risk ID, description, likelihood, impact, level, owner, treatment decision, status',
      'Risk response: accept, mitigate, transfer, or avoid — with documented rationale per risk',
    ],
    assessorChecklist: [
      'Risk assessment performed at least annually and after significant system changes',
      'All CMMC-scope systems included in the assessment',
      'Risk register current with assigned owners and treatment plans for each risk',
      'Risk acceptance decisions approved by authorizing official with documented rationale',
    ],
    automationTip:
      'Compliance Manager for risk tracking aligned to CMMC practices. Power BI for risk heat-map dashboards. SharePoint list for risk register with Power Automate review reminders.',
    references: [
      'NIST SP 800-30 Rev 1 (Risk Assessment Guide)',
      'NIST SP 800-171 3.11.1',
      'NIST SP 800-53 RA-3',
    ],
  },

  scrm: {
    documentName: 'Supply Chain Risk Management Plan',
    sections: [
      'Scope: suppliers, vendors, and service providers with access to CUI or CUI systems',
      'Supplier assessment criteria: security posture, certifications, incident history, financial stability',
      'Contract requirements: CUI protection clauses, incident notification (≤72 hrs), right-to-audit, CMMC flowdown',
      'Ongoing monitoring: periodic reassessment schedule, performance metrics, threat intelligence',
      'Incident response: supplier breach notification procedure and coordinated response',
    ],
    assessorChecklist: [
      'All CUI-handling suppliers identified and risk-assessed',
      'Contracts include CUI protection, incident notification, and CMMC flowdown requirements',
      'Supplier risk assessments performed at onboarding and at least annually',
      'Flowdown requirements documented and verified for sub-tier suppliers',
    ],
    automationTip:
      'SharePoint for supplier risk register and contract repository. Power Automate for assessment due-date reminders. Microsoft Forms for supplier self-assessment questionnaires.',
    references: [
      'NIST SP 800-171 3.11.4',
      'NIST SP 800-161 Rev 1',
      'NIST SP 800-53 SR-1 through SR-12',
    ],
  },

  poam: {
    documentName: 'Plan of Action & Milestones (POA&M)',
    sections: [
      'Finding source: assessment, vulnerability scan, audit, incident, self-identified',
      'POA&M fields: ID, finding description, severity, responsible party, milestone(s), target date, status, resources needed',
      'Milestone tracking: interim milestones with measurable progress indicators',
      'Review cadence: monthly status updates, quarterly management review',
      'Closure criteria: what constitutes complete remediation (evidence required)',
      'Escalation: process for overdue items and resource-constraint requests',
    ],
    assessorChecklist: [
      'All known vulnerabilities and assessment findings have POA&M entries',
      'Each entry has assigned owner, target date, and realistic milestones',
      'Monthly progress updates documented with evidence of work performed',
      'Closed items have remediation evidence and independent verification',
    ],
    automationTip:
      'Planner or Azure DevOps for POA&M item tracking with automated status dashboards. Compliance Manager for centralized finding management. Power BI for executive POA&M reporting.',
    references: ['NIST SP 800-171 3.12.2', 'NIST SP 800-53 CA-5'],
  },

  security_assessment: {
    documentName: 'Security Assessment Plan & Report',
    sections: [
      'Assessment scope: controls in scope, systems, authorization boundaries',
      'Methods per control: examine (review docs/configs), interview (personnel), test (active testing)',
      'Assessor qualifications and independence requirements',
      'Assessment schedule, logistics, and evidence collection plan',
      'Findings format: control ID, finding, severity, supporting evidence, recommendation',
      'Report handling: distribution list, CUI marking if applicable',
    ],
    assessorChecklist: [
      'All CMMC practices assessed using appropriate methods (examine, interview, test)',
      'Assessment performed by qualified, sufficiently independent assessors',
      'Findings documented with supporting evidence for each determination',
      'Assessment report current (within 12 months) and available for review',
    ],
    automationTip:
      'Compliance Manager for assessment workflow, evidence collection, and control status tracking. SharePoint for assessment report repository with version control.',
    references: [
      'NIST SP 800-171A (Assessment Guide)',
      'NIST SP 800-171 3.12.1',
      'NIST SP 800-53 CA-2',
    ],
  },

  ssp: {
    documentName: 'System Security Plan (SSP)',
    sections: [
      'System identification: name, description, owner, operational status, authorization boundary',
      'System categorization: CUI types processed, stored, and transmitted',
      'System environment: architecture diagrams, network topology, interconnections, data flows',
      'Control implementation statements: how each CMMC practice is satisfied (implemented, planned, inherited, N/A with rationale)',
      'Roles and responsibilities: security roles, organizational chart, contact information',
      'Continuous monitoring strategy: what is monitored, tools used, review frequency, update triggers',
    ],
    assessorChecklist: [
      'SSP exists and covers all in-scope systems and authorization boundaries',
      'Control implementation statements address every applicable CMMC practice',
      'System boundary and data flow diagrams current and accurate',
      'SSP reviewed and updated at least annually and after significant changes',
    ],
    automationTip:
      'Compliance Manager for SSP control-status tracking aligned to CMMC. SharePoint for document management with approval workflows and version history. Power Automate for annual review reminders.',
    references: [
      'NIST SP 800-171 3.12.4',
      'NIST SP 800-18 Rev 1',
      'NIST SP 800-53 PL-2',
    ],
  },

  // ── IR — Incident Response ──────────────────────────────────────────────

  ir_plan: {
    documentName: 'Incident Response Plan',
    sections: [
      'Purpose, scope, and CUI-specific incident definition',
      'Incident categories: unauthorized access, data spillage, malware, insider threat, physical breach, supply chain compromise',
      'Roles and responsibilities: IR team, management, legal, communications, HR, external contacts',
      'Detection and reporting: how incidents are identified, reporting channels, initial triage timeline',
      'Response phases: containment → eradication → recovery → post-incident review',
      'CUI-specific procedures: spillage containment steps, DoD notification requirements (72 hours per DFARS 252.204-7012)',
      'Communication plan: internal escalation matrix, external reporting (DIBNet, DC3, law enforcement)',
      'Plan testing: exercise types, schedule, and after-action review process',
    ],
    assessorChecklist: [
      'IR plan exists, is current, and explicitly covers CUI-specific scenarios',
      'Roles and contact information current and accessible during incidents',
      'DoD/DC3 72-hour notification requirement documented with procedures',
      'Plan tested at least annually via tabletop or functional exercise',
      'Plan updated based on lessons learned from exercises and actual incidents',
    ],
    automationTip:
      'Microsoft Sentinel for automated detection and playbook-driven response. Teams channel for IR communications. SharePoint for IR plan repository. Power Automate for escalation notification chains.',
    references: [
      'NIST SP 800-171 3.6.1, 3.6.2',
      'DFARS 252.204-7012 (72-hr reporting)',
      'NIST SP 800-61 Rev 2',
      'NIST SP 800-53 IR-1 through IR-8',
    ],
  },

  incident_tracking: {
    documentName: 'Incident Tracking & Reporting Procedure',
    sections: [
      'Incident report fields: ID, date/time, reporter, category, affected systems, CUI impact, severity',
      'Tracking workflow: report → triage → investigate → contain → remediate → close → lessons-learned',
      'Evidence preservation: what to collect, chain-of-custody, forensic image requirements',
      'Reporting triggers: when to escalate internally, when to notify DoD, when to involve law enforcement',
      'Post-incident review: timeline, root cause, corrective actions, plan updates needed',
    ],
    assessorChecklist: [
      'All incidents logged with complete required fields',
      'Incident timeline and response actions documented for each event',
      'Evidence preserved per retention and chain-of-custody requirements',
      'Closed incidents have post-incident review with lessons learned and corrective actions',
    ],
    automationTip:
      'Microsoft Sentinel for incident management and automated tracking. ServiceNow or Jira for ticketing with SLA monitoring. Power Automate for escalation rules.',
    references: [
      'NIST SP 800-171 3.6.2',
      'NIST SP 800-61 Rev 2',
      'NIST SP 800-53 IR-5, IR-6',
    ],
  },

  soc_ops: {
    documentName: 'Security Operations Center (SOC) Charter',
    sections: [
      'SOC mission, scope, and authority',
      'Staffing model: roles, shifts, minimum coverage requirements',
      'Escalation matrix: triage → Tier 1 → Tier 2 → IR team → management',
      'Monitoring scope: systems, log sources, alert types, SLA for response',
      'Reporting: daily summary, weekly metrics, monthly executive report',
    ],
    assessorChecklist: [
      'SOC charter defines scope and authority clearly',
      'Escalation matrix current with named contacts',
      'Monitoring coverage includes all CUI-scope systems',
      'SOC metrics tracked and reported to management',
    ],
    automationTip:
      'Microsoft Sentinel as SIEM platform. Sentinel workbooks for automated SOC dashboards. Power Automate for shift-change handoff notifications.',
    references: ['NIST SP 800-171 3.6.1', 'NIST SP 800-53 IR-1, IR-4'],
  },

  cirt: {
    documentName: 'Incident Response Team & Playbooks',
    sections: [
      'Team composition: roles (lead, forensics, comms, legal), named members, alternates',
      'Activation criteria: what triggers CIRT activation vs SOC-level handling',
      'Playbook per incident type: phishing, malware, data spillage, insider threat, DDoS, physical breach',
      'Each playbook: detection indicators, containment steps, eradication steps, recovery, communication template',
      'Coordination: external partners, ISAC contacts, law enforcement, DoD reporting',
    ],
    assessorChecklist: [
      'CIRT team roster current with contact information for all members',
      'Playbooks exist for primary incident categories relevant to CUI',
      'Playbooks tested via exercises with after-action improvements documented',
      'External coordination contacts (DC3, FBI, ISAC) documented and current',
    ],
    automationTip:
      'Sentinel automated playbooks (Logic Apps) for initial containment actions. SharePoint for playbook repository. Teams for CIRT activation and secure communications.',
    references: [
      'NIST SP 800-171 3.6.1, 3.6.2',
      'NIST SP 800-61 Rev 2',
      'NIST SP 800-53 IR-7, IR-10',
    ],
  },

  // ── CM — Configuration Management ──────────────────────────────────────

  change_mgmt: {
    documentName: 'Change Management Procedure',
    sections: [
      'Change categories: standard (pre-approved), normal (CAB review), emergency (expedited)',
      'Change request fields: requester, description, affected systems, risk level, rollback plan',
      'Approval workflow: request → security impact analysis → CAB review → approve → implement → verify',
      'Security impact analysis: CUI exposure changes, boundary impacts, control modifications',
      'Post-implementation verification and documentation requirements',
    ],
    assessorChecklist: [
      'All changes to CUI systems follow the documented change process',
      'Security impact analysis performed and documented before implementation',
      'Change records include approval, implementation details, and verification results',
      'Emergency changes retroactively documented and reviewed by CAB',
    ],
    automationTip:
      'Azure DevOps or ServiceNow for change request workflows with approval gates. Power Automate for CAB notification and routing. SharePoint for change records and CAB minutes.',
    references: ['NIST SP 800-171 3.4.3, 3.4.4', 'NIST SP 800-53 CM-3'],
  },

  // ── AC — Access Control (documentation aspects) ────────────────────────

  access_review: {
    documentName: 'Access Review & Certification Process',
    sections: [
      'Review scope: all accounts with access to CUI systems and data',
      'Review frequency: quarterly for privileged accounts, semi-annual for standard',
      'Review process: manager certifies each direct report access as retain, modify, or revoke',
      'Documentation: reviewer name, review date, decision per account, follow-up actions',
      'Exception handling: orphaned accounts, service accounts, shared accounts',
    ],
    assessorChecklist: [
      'Access reviews performed on schedule for the entire review period',
      'Manager sign-off documented for each reviewed account',
      'Revocation decisions implemented within defined SLA (e.g., 5 business days)',
      'Reviews cover both standard and privileged accounts including service accounts',
    ],
    automationTip:
      'Entra ID Access Reviews for automated manager certification campaigns. Entra ID Governance for automatic access expiration. Power BI for access review compliance dashboards.',
    references: ['NIST SP 800-171 3.1.1', 'NIST SP 800-53 AC-2'],
  },

  // ── AU — Audit & Accountability ────────────────────────────────────────

  log_review: {
    documentName: 'Log Review & Analysis Process',
    sections: [
      'Log sources in scope: all CUI-system security logs, access logs, change logs',
      'Review schedule: automated daily correlation, manual weekly review, monthly summary report',
      'Review process: what to look for (anomalies, policy violations, attack indicators)',
      'Finding categories: informational, suspicious, confirmed incident → escalation path',
      'Documentation: reviewer, date, scope, findings, actions taken',
    ],
    assessorChecklist: [
      'Log review schedule documented and followed',
      'Reviews cover all in-scope log sources',
      'Findings documented with disposition (false positive, investigated, escalated)',
      'Review records retained per audit policy',
    ],
    automationTip:
      'Microsoft Sentinel analytics rules for automated log correlation and alert generation. Sentinel workbooks for weekly review dashboards. Power Automate for review task assignment and tracking.',
    references: ['NIST SP 800-171 3.3.1', 'NIST SP 800-53 AU-6'],
  },

  // ── Generic fallbacks by action type ────────────────────────────────────

  generic_policy: {
    documentName: 'Compliance Policy Document',
    sections: [
      'Purpose, scope, and applicability to CUI environment',
      'Roles and responsibilities (policy owner, enforcers, affected personnel)',
      'Policy statements: specific, measurable, enforceable requirements',
      'Enforcement: consequences for non-compliance at each severity level',
      'Review cycle: at least annual review, change approval process, version history',
    ],
    assessorChecklist: [
      'Policy exists, is current (within 12 months), and approved by appropriate authority',
      'Policy statements are specific and measurable (not vague aspirational language)',
      'Personnel have acknowledged receipt and have ongoing access to the policy',
      'Policy reviewed and updated at least annually with version history',
    ],
    automationTip:
      'Compliance Manager for policy scaffolding from CMMC assessment templates. SharePoint for document management with approval workflows, version control, and acknowledgment tracking.',
    references: ['NIST SP 800-171', 'NIST SP 800-53'],
  },

  generic_process: {
    documentName: 'Compliance Procedure Document',
    sections: [
      'Purpose, scope, and when this procedure applies',
      'Step-by-step process flow with decision points and responsible roles',
      'Required inputs, outputs, and record-keeping at each step',
      'Exception handling and escalation path',
      'Review cycle: at least annual, update triggers (system changes, incidents, audit findings)',
    ],
    assessorChecklist: [
      'Procedure documented and accessible to all responsible personnel',
      'Steps specific enough to be followed consistently by different operators',
      'Records demonstrate the procedure is actually followed in practice',
      'Procedure reviewed and updated at least annually',
    ],
    automationTip:
      'Power Automate for workflow automation and approval routing. SharePoint for procedure hosting with version control. Microsoft Forms for structured data capture at each process step.',
    references: ['NIST SP 800-171', 'NIST SP 800-53'],
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Evidence-output keyword → template ID mapping
// Checked in order; first substring match wins. More specific keywords first.
// ═══════════════════════════════════════════════════════════════════════════

const KEYWORD_MAP: [string, string][] = [
  // PE
  ['visitor_management', 'visitor_mgmt'],
  ['visitor_badge', 'visitor_mgmt'],
  ['visitor_log', 'visitor_mgmt'],
  ['escort_log', 'visitor_mgmt'],
  ['access_device_inventory', 'physical_access_device'],
  ['device_issuance', 'physical_access_device'],
  ['monitoring_system', 'facility_monitoring'],
  ['camera_coverage', 'facility_monitoring'],
  ['alternate_site', 'alternate_site'],
  // PS
  ['screening_policy', 'screening'],
  ['screening_criteria', 'screening'],
  ['screening_records', 'screening'],
  ['screening_completion', 'screening'],
  ['enhanced_screening', 'screening'],
  ['sensitive_role_inventory', 'screening'],
  ['termination_procedure', 'termination'],
  ['access_revocation_checklist', 'termination'],
  ['adverse_action', 'adverse_action'],
  ['protective_measure', 'adverse_action'],
  ['access_agreement_policy', 'access_agreement'],
  ['signed_agreement', 'access_agreement'],
  ['sanction_policy', 'sanctions'],
  ['sanction_records', 'sanctions'],
  // MA
  ['maintenance_procedure', 'maintenance'],
  ['maintenance_schedule', 'maintenance'],
  ['maintenance_records', 'maintenance'],
  ['tool_authorization', 'tool_control'],
  ['approved_tool', 'tool_control'],
  ['supervision_procedure', 'supervised_maintenance'],
  ['supervision_records', 'supervised_maintenance'],
  ['media_inspection', 'supervised_maintenance'],
  ['inspection_records', 'supervised_maintenance'],
  // MP
  ['media_disposal', 'media_disposal'],
  ['sanitization_procedure', 'sanitization'],
  ['sanitization_records', 'sanitization'],
  ['destruction_records', 'sanitization'],
  ['disposal_certificate', 'sanitization'],
  ['media_marking', 'media_marking'],
  ['marking_example', 'media_marking'],
  ['transport_procedure', 'media_transport'],
  ['chain_of_custody', 'media_transport'],
  // AT
  ['training_materials', 'security_training'],
  ['training_completion', 'security_training'],
  ['training_schedule', 'security_training'],
  ['completion_dashboard', 'security_training'],
  ['role_training', 'role_training'],
  ['insider_threat_training', 'insider_threat'],
  ['advanced_training', 'role_training'],
  ['exercise_plan', 'security_exercises'],
  ['exercise_results', 'security_exercises'],
  ['phishing_simulation', 'security_exercises'],
  ['exercise_after_action', 'security_exercises'],
  ['lessons_learned', 'security_exercises'],
  // CA / RA
  ['risk_assessment_report', 'risk_assessment'],
  ['risk_register', 'risk_assessment'],
  ['risk_assessment_schedule', 'risk_assessment'],
  ['supply_chain_risk', 'scrm'],
  ['vendor_risk', 'scrm'],
  ['scrm_plan', 'scrm'],
  ['security_assessment_report', 'security_assessment'],
  ['control_effectiveness', 'security_assessment'],
  ['poam_document', 'poam'],
  ['poam_management', 'poam'],
  ['remediation_progress', 'poam'],
  ['system_security_plan', 'ssp'],
  ['ssp_review', 'ssp'],
  ['ssp_change', 'ssp'],
  ['ssp_existence', 'ssp'],
  ['ssp_currency', 'ssp'],
  // IR
  ['incident_response_plan', 'ir_plan'],
  ['incident_tracking', 'incident_tracking'],
  ['incident_report', 'incident_tracking'],
  ['soc_charter', 'soc_ops'],
  ['staffing_plan', 'soc_ops'],
  ['escalation_matrix', 'soc_ops'],
  ['cirt_charter', 'cirt'],
  ['response_playbook', 'cirt'],
  ['team_roster', 'cirt'],
  // CM
  ['change_management', 'change_mgmt'],
  ['change_request', 'change_mgmt'],
  ['impact_analysis', 'change_mgmt'],
  // AC
  ['access_review', 'access_review'],
  ['access_certification', 'access_review'],
  ['account_review', 'access_review'],
  ['manager_signoff', 'access_review'],
  // AU
  ['log_review', 'log_review'],
  ['review_findings', 'log_review'],
];

// Fallback: action_type → template ID when no keyword matches
const ACTION_FALLBACK: Record<string, string> = {
  policy: 'generic_policy',
  process: 'generic_process',
  training: 'security_training',
  assessment: 'security_assessment',
};

// ═══════════════════════════════════════════════════════════════════════════
// Lookup
// ═══════════════════════════════════════════════════════════════════════════

function matchTemplate(
  outputName: string,
  actionType: string,
): DeliverableTemplate | null {
  const lower = outputName.toLowerCase();
  for (const [keyword, templateId] of KEYWORD_MAP) {
    if (lower.includes(keyword)) return T[templateId] || null;
  }
  const fallbackId = ACTION_FALLBACK[actionType];
  return fallbackId ? T[fallbackId] || null : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Main export — called from taskCompiler per gap
// ═══════════════════════════════════════════════════════════════════════════

export function deriveDeliverableContentGuidance(
  vendorCaps: any,
  requirementId: string,
): string[] {
  const patterns: PatternEntry[] = vendorCaps?.patterns?.patterns || [];
  const matchingPatterns = patterns.filter(
    (p) => p.practice_id === requirementId,
  );

  if (matchingPatterns.length === 0) return [];

  const steps: string[] = [];
  const emittedTemplates = new Set<string>();

  for (const pattern of matchingPatterns) {
    for (const action of pattern.actions) {
      // Only generate deliverable guides for non-technical action types
      if (
        !['policy', 'process', 'training', 'assessment'].includes(
          action.action_type,
        )
      ) {
        continue;
      }

      for (const output of action.evidence_outputs || []) {
        const template = matchTemplate(output, action.action_type);
        if (!template) continue;
        // Deduplicate: same template may match multiple outputs
        if (emittedTemplates.has(template.documentName)) continue;
        emittedTemplates.add(template.documentName);

        steps.push(`[Deliverable] ${template.documentName}`);
        for (const s of template.sections) {
          steps.push(`  Content: ${s}`);
        }
        for (const c of template.assessorChecklist) {
          steps.push(`  Assessor: ${c}`);
        }
        steps.push(`  Create with: ${template.automationTip}`);
        if (template.references.length > 0) {
          steps.push(`  Ref: ${template.references.join('; ')}`);
        }
      }
    }
  }

  return steps;
}
