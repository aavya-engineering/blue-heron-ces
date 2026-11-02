// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// policyInputNodes.ts — MG-16 (decision D2): the Policy Inputs questions
// Muster still asks. The primed Policy Inputs Question Bank has 40 questions;
// the rest are discovered, derived or defaulted by
// plan/policy/policyInputsProfile.ts and never asked:
//   PI.ORG.001 / 006 / 007  the Profile tab's organisation name, CAGE and UEI;
//   PI.GOV.001              the plan date (W5: effective on approval), or an answered approval date;
//   PI.GOV.002 / 003        the bank's recommended values (defaulted).
// Asked here (cluster 'plan-input:policy', optional for finish, mapped
// requirements [] so they never score):
//   PI.ORG.002-005  the address: discovered from Graph /organization when the
//                   read carries it (harvest pre-fill, shown editable);
//   PI.ORG.008-011  organisation type, industry, NAICS, parent company;
//   PI.PER.001-008  personnel. 001-004 and 006 are drafted from directory role
//                   holders on the Plan tab and confirmed there by a person;
//                   a draft never renders into a policy unconfirmed;
//   PI.PHY.001-003  physical security;
//   PI.ODP.001-015  the bank's organisation-defined parameters (FIN-32b, below).
// Prompts and options are the bank's, verbatim.
//
// FIN-32b (LOG-FIN-32 S-B (c)): the 15 bank ODPs are asked too, optional, so the
// UI can type every answer an answers file carries. The prompt is the bank's,
// verbatim (an answers file's question_text is the bank prompt; a different node
// text would make a typed answer's interview record differ from the file's). The
// field is the bank's bindings.policy_inputs key. Number questions take a whole
// number (input 'number'); single-select questions are radios over the bank's
// options. Unanswered, the profile keeps the bank's recommended value
// (provenance defaulted): policyInputsProfile.ts already resolves an answered
// PI.ODP.001-015 fact over the bank default, for the profile, the Tenant Manifest
// verification rows (001-005) and discovery's bounds (003-005). Mapped
// requirements [] (never scored): before FIN-32b an answered ODP had no node, so
// scoring gave it a synthetic `scre.PI.ODP.nnn` requirement (scoringService
// mapFactsToRRTAnswers); with a node it maps to nothing. Answers use Planner's
// "Name | Title | Email" personnel format; facility addresses are separated by ';'.
//
// W5c2 (SC-5 questions Q1-Q6, LOG-W5c2-muster.md): six Muster-only questions the
// pinned Planner bank does not carry, asked here in the bank's style and
// numbering and folded into the profile Muster-side (policyInputsProfile.ts,
// MUSTER_PERSONNEL_ROLES / SSP_INPUT_QUESTIONS):
//   PI.PER.009-011  Authorizing Official, Privacy Officer, Network Administrator
//                   ("Name | Title | Email", or "role held by <role>");
//   PI.SYS.001      the organisation's identifier for the in-scope system;
//   CUI.LC.VOL.001  CUI volume held and monthly inflow (CUI lifecycle family);
//   CUI.INT.004     one "System | ISA/MOU reference | connection type | data
//                   classification" per CUI.INT.001 interconnection, ';'-separated.
//
// W5c7 (AU.L2-3.3.7): one Muster-only ODP in the bank's numbering, after
// PI.ODP.015 (the pinned bank's last):
//   PI.ODP.016      the authoritative time source in-scope systems synchronise to
//                   (NTP server). Folded into the profile as
//                   odps.authoritative_time_source (default time.windows.com) and
//                   onto the TM's AU.L2-3.3.7 verification row when answered.
//
// FIN-26 (W7-MX1 part 3, founder rulings FD-9 and 2 of 2026-10-29):
//   PI.ODP.017      the organisation's maximum sign-in frequency for CUI access, in
//                   hours (note 42). Blank = the CES baseline of 8 hours; a longer
//                   answer never relaxes it. Folded into the profile as
//                   odps.sign_in_frequency_hours (default 8, CES baseline) and, when
//                   answered 1..8, onto the TM's AC.L2-3.1.11 verification row
//                   (FIN-26b: policyInputsProfile.ts, verificationExpectations.ts).
//   PI.PER.012      the role population for AT.L2-3.2.2 (role-based training): the
//                   job titles whose holders must take a role-based course. Its
//                   interview record reaches EO (POST /api/interviews), where the
//                   training store decides AT.L2-3.2.2 for that population only
//                   (ces-eo TrainingStore.ROLE_POPULATION_QUESTION_ID). It never
//                   scores in Muster (mapped requirements []).
import type { PlanInputKind, QuestionNode } from './questionGraph';

interface PolicyNodeSpec {
  id: string;
  text: string;
  field: string;
  options?: string[];
  /** The typed input when there are no options (default 'text'). */
  input?: PlanInputKind;
}

const NUM = 'number' as const;

/** FIN-32b: the pinned bank's 15 ODPs (primed Policy Inputs Question Bank.yaml, section PI-03), verbatim. */
const BANK_ODP_SPECS: PolicyNodeSpec[] = [
  { id: 'PI.ODP.001', text: 'What is the account lockout threshold (failed login attempts before lockout)?', field: 'odps.account_lockout_threshold', input: NUM },
  { id: 'PI.ODP.002', text: 'What is the account lockout duration (minutes)?', field: 'odps.account_lockout_duration_minutes', input: NUM },
  { id: 'PI.ODP.003', text: 'What is the maximum session inactivity timeout (minutes)?', field: 'odps.session_timeout_minutes', input: NUM },
  { id: 'PI.ODP.004', text: 'What is the minimum password length (characters)?', field: 'odps.min_password_length', input: NUM },
  { id: 'PI.ODP.005', text: 'What is the password history depth (number of remembered passwords)?', field: 'odps.password_history_count', input: NUM },
  { id: 'PI.ODP.006', text: 'What is the maximum password age (days)?', field: 'odps.max_password_age_days', input: NUM },
  { id: 'PI.ODP.007', text: 'What is the audit log retention period (days)?', field: 'odps.audit_log_retention_days', input: NUM },
  {
    id: 'PI.ODP.008',
    text: 'What is the vulnerability scan frequency?',
    field: 'odps.vuln_scan_frequency',
    options: ['Weekly', 'Biweekly', 'Monthly', 'Quarterly'],
  },
  { id: 'PI.ODP.009', text: 'What is the critical vulnerability patch timeline (days)?', field: 'odps.critical_patch_timeline_days', input: NUM },
  { id: 'PI.ODP.010', text: 'What is the high-severity vulnerability patch timeline (days)?', field: 'odps.high_patch_timeline_days', input: NUM },
  {
    id: 'PI.ODP.011',
    text: 'What is the security awareness training frequency?',
    field: 'odps.training_frequency',
    options: ['Annually', 'Semi-annually', 'Quarterly'],
  },
  { id: 'PI.ODP.012', text: 'What is the incident reporting timeline (hours)?', field: 'odps.incident_reporting_hours', input: NUM },
  {
    id: 'PI.ODP.013',
    text: 'What is the access review frequency?',
    field: 'odps.access_review_frequency',
    options: ['Monthly', 'Quarterly', 'Semi-annually', 'Annually'],
  },
  {
    id: 'PI.ODP.014',
    text: 'What is the backup frequency for CUI systems?',
    field: 'odps.backup_frequency',
    options: ['Daily', 'Weekly', 'Real-time replication'],
  },
  {
    id: 'PI.ODP.015',
    text: 'What is the media sanitization standard?',
    field: 'odps.media_sanitization_standard',
    options: ['NIST SP 800-88 Clear', 'NIST SP 800-88 Purge', 'NIST SP 800-88 Destroy'],
  },
];

const SPECS: PolicyNodeSpec[] = [
  { id: 'PI.ORG.002', text: "What is the organization's street address?", field: 'organization.address.street' },
  { id: 'PI.ORG.003', text: 'City', field: 'organization.address.city' },
  { id: 'PI.ORG.004', text: 'State', field: 'organization.address.state' },
  { id: 'PI.ORG.005', text: 'ZIP Code', field: 'organization.address.zip' },
  {
    id: 'PI.ORG.008',
    text: "What is the organization's relationship to DoD contracts?",
    field: 'organization.org_type',
    options: ['Prime Contractor', 'Subcontractor', 'Vendor / Supplier', 'Other'],
  },
  { id: 'PI.ORG.009', text: 'What industry does the organization operate in?', field: 'organization.industry' },
  { id: 'PI.ORG.010', text: "What is the organization's primary NAICS code?", field: 'organization.naics_code' },
  {
    id: 'PI.ORG.011',
    text: 'Does this organization have a parent company? If so, what is the name?',
    field: 'organization.parent_company',
  },
  {
    id: 'PI.PER.001',
    text: 'Who is the Information System Security Officer (ISSO)? Provide: Name, Title, Email',
    field: 'personnel.isso',
  },
  { id: 'PI.PER.002', text: 'Who is the System Owner? Provide: Name, Title, Email', field: 'personnel.system_owner' },
  {
    id: 'PI.PER.003',
    text: 'Who is the Compliance Officer? Provide: Name, Title, Email',
    field: 'personnel.compliance_officer',
  },
  { id: 'PI.PER.004', text: 'Who is the IT Director / CTO? Provide: Name, Title, Email', field: 'personnel.it_director' },
  {
    id: 'PI.PER.005',
    text: 'Who is the HR representative for security awareness training? Provide: Name, Title, Email',
    field: 'personnel.hr_representative',
  },
  { id: 'PI.PER.006', text: 'Who is the Incident Response Lead? Provide: Name, Title, Email', field: 'personnel.ir_lead' },
  {
    id: 'PI.PER.007',
    text: 'Who is the Facilities / Physical Security Manager? Provide: Name, Title, Email',
    field: 'personnel.facilities_manager',
  },
  {
    id: 'PI.PER.008',
    text: 'Who is the Legal / Contracts representative? Provide: Name, Title, Email',
    field: 'personnel.legal_representative',
  },
  {
    id: 'PI.PER.009',
    text: 'Who is the Authorizing Official for the in-scope system? Provide: Name, Title, Email',
    field: 'personnel.authorizing_official',
  },
  {
    id: 'PI.PER.010',
    text: 'Who is the Privacy Officer? Provide: Name, Title, Email (or "role held by <role>")',
    field: 'personnel.privacy_officer',
  },
  {
    id: 'PI.PER.011',
    text: 'Who is the Network Administrator? Provide: Name, Title, Email (or "role held by <role>")',
    field: 'personnel.network_administrator',
  },
  {
    id: 'PI.PER.012',
    text: 'Which job titles hold information-security duties that need role-based security training (AT.L2-3.2.2)? List each job title exactly as the personnel records show it, separated by ";" (for example: Systems Administrator; Information Systems Security Officer (ISSO))',
    field: 'personnel.role_training_population',
  },
  {
    id: 'PI.SYS.001',
    text: "What is the organization's identifier for the in-scope system (asset or system ID)?",
    field: 'ssp_inputs.system_identifier',
  },
  {
    id: 'CUI.LC.VOL.001',
    text: 'What is the approximate CUI volume (files or GB held, and typical monthly inflow)?',
    field: 'ssp_inputs.cui_volume',
  },
  {
    id: 'CUI.INT.004',
    text: 'For each interconnection listed in CUI.INT.001: System | ISA or MOU reference number | connection type | data classification (one interconnection per line, or separated by ";")',
    field: 'ssp_inputs.interconnection_agreements',
  },
  ...BANK_ODP_SPECS,
  {
    id: 'PI.ODP.016',
    text: 'What authoritative time source do in-scope systems synchronise to? (NTP server)',
    field: 'odps.authoritative_time_source',
  },
  {
    id: 'PI.ODP.017',
    text: "What is the organisation's maximum sign-in frequency for CUI access, in hours? (blank = the CES baseline of 8 hours; a longer value is recorded for reconciliation and never relaxes the baseline)",
    field: 'odps.sign_in_frequency_hours',
  },
  {
    id: 'PI.PHY.001',
    text: 'List all facility addresses where CUI is processed or stored (one per line).',
    field: 'physical_security.facility_addresses',
  },
  { id: 'PI.PHY.002', text: 'What physical access control system is used?', field: 'physical_security.access_control_system' },
  { id: 'PI.PHY.003', text: 'What visitor management procedures are in place?', field: 'physical_security.visitor_management' },
];

export const POLICY_INPUT_NODES: QuestionNode[] = SPECS.map((s) => ({
  id: s.id,
  text: s.text,
  options: (s.options ?? []).map((o) => ({ label: o, value: o })),
  ...(s.options ? {} : { input: s.input ?? ('text' as const) }),
  cluster: 'plan-input:policy',
  mapped_requirements: [],
  plan_input: { contract: 'policy_inputs', field: s.field },
}));

export const POLICY_INPUT_NODE_IDS: readonly string[] = SPECS.map((s) => s.id);
