// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// cuiBoundaryNodes.ts — MG-08: the CUI boundary bindings Muster still ASKS.
//
// The boundary is built by plan/cuiBoundaryAdapter.ts from (in precedence
// order) these answers, the plan-mode derivation, the SI defaults (vendored
// cuiSIDerivation) and the CUI bank's own `recommended` values. These nodes
// cover only the bindings that none of those resolves for the customer:
//   - no SI derivation and no bank recommendation: contract scope, processing
//     tools, external integrations, out-of-scope systems;
//   - a default exists but is a generic starting value the customer's real
//     answer routinely differs from: CUI user count (the SI estimate counts
//     every in-scope user), whether CUI is generated or only received, the
//     generating functions, ingress channels, storage locations and the
//     admin-workstation model;
//   - W5c4: the seven bindings whose only source was the bank's `recommended`
//     value (CUI categories, user roles, repository locations, email
//     forwarding, API tokens moving CUI, backups, enforcement mechanisms).
// The other 8 bank questions are never asked (Planner's 24-question wizard is
// not ported). Same contract as the SI/TCP plan-input nodes: cluster
// 'boundary', mapped_requirements [] (score-leak safe), plan_input set, so they
// are OPTIONAL for the finish gate. Values: enum slugs map to the bank's exact
// option strings; list and number answers use the shared typed-input widget
// (siPlanInputNodes.parsePlanInputAnswer string format). Guarded against the
// bank by cuiBoundaryNodes.test.ts.
import type { PlanInputKind, QuestionNode } from './questionGraph';

export interface CuiNodeSpec {
  /** The CUI bank question id. */
  id: string;
  /** The bank's bindings.manifest key(s) the answer sets (cui_boundary.*). */
  field: string;
  /** The bank prompt (verbatim), plus a format hint for typed inputs. */
  text: string;
  /** The bank answer_type. */
  answerType: 'single_select' | 'multi_select' | 'list' | 'number';
  /** single_select: slug -> exact bank option. */
  options?: Array<{ value: string; label: string; bankOption: string }>;
  /** multi_select: the bank options, used to canonicalise typed items. */
  bankOptions?: string[];
}

/** Transcribed from `primed CUI Boundary Question Bank.yaml`; guarded by the test. */
export const CUI_NODE_SPECS: CuiNodeSpec[] = [
  {
    id: 'CUI.CONTRACT.001',
    field: 'contract_scope',
    text: 'List all active contracts containing DFARS 7012/7019/7020/7021 or prime-specific CUI clauses. (comma-separated)',
    answerType: 'list',
  },
  {
    id: 'CUI.GEN.001',
    field: 'cui_generation_mode',
    text: 'Is CUI generated internally?',
    answerType: 'single_select',
    options: [
      { value: 'received_only', label: 'No – only received', bankOption: 'No – only received' },
      { value: 'generated', label: 'Yes – generated internally', bankOption: 'Yes – generated internally' },
      { value: 'both', label: 'Both', bankOption: 'Both' },
    ],
  },
  {
    id: 'CUI.GEN.002',
    field: 'cui_generating_functions',
    text: 'Which internal functions generate CUI? (comma-separated: Engineering, DevOps, Program Management, Executive, Security/IT, Other)',
    answerType: 'multi_select',
    bankOptions: ['Engineering', 'DevOps', 'Program Management', 'Executive', 'Security/IT', 'Other'],
  },
  {
    id: 'CUI.LC.ING.001',
    field: 'cui_ingress_channels',
    text: 'How is CUI received? (comma-separated: Encrypted email, Prime/customer portal, Secure file transfer (SFTP/FTPS), Teams/SharePoint sharing, API integration, Physical media, Other)',
    answerType: 'multi_select',
    bankOptions: [
      'Encrypted email',
      'Prime/customer portal',
      'Secure file transfer (SFTP/FTPS)',
      'Teams/SharePoint sharing',
      'API integration',
      'Physical media',
      'Other',
    ],
  },
  {
    id: 'CUI.LC.STO.001',
    field: 'cui_storage_locations',
    text: 'Where is CUI stored? (comma-separated: SharePoint Online (GCC High), OneDrive (GCC High), Exchange mailboxes, Teams file libraries, Azure Storage, On-prem file server, Git repositories, External SaaS (specify))',
    answerType: 'multi_select',
    bankOptions: [
      'SharePoint Online (GCC High)',
      'OneDrive (GCC High)',
      'Exchange mailboxes',
      'Teams file libraries',
      'Azure Storage',
      'On-prem file server',
      'Git repositories',
      'External SaaS (specify)',
    ],
  },
  {
    id: 'CUI.LC.PROC.001',
    field: 'cui_processing_tools',
    text: 'Which tools/processes actively process CUI? (comma-separated)',
    answerType: 'list',
  },
  {
    id: 'CUI.USR.002',
    field: 'cui_user_count',
    text: 'Approximate number of CUI users?',
    answerType: 'number',
  },
  {
    id: 'CUI.DEV.002',
    field: 'admin_workstation_model',
    text: 'Are privileged admin workstations isolated (PAW/SAW)?',
    answerType: 'single_select',
    options: [
      { value: 'yes', label: 'Yes', bankOption: 'Yes' },
      { value: 'planned', label: 'Planned', bankOption: 'Planned' },
      { value: 'no', label: 'No', bankOption: 'No' },
      { value: 'unknown', label: 'Unknown', bankOption: 'Unknown' },
    ],
  },
  {
    id: 'CUI.INT.001',
    field: 'external_integrations',
    text: 'List all third-party systems integrated with in-scope systems. (comma-separated, or "none")',
    answerType: 'list',
  },
  {
    id: 'CUI.OOS.001',
    field: 'out_of_scope_systems',
    text: 'List systems explicitly declared out of scope. (comma-separated, or "none")',
    answerType: 'list',
  },
  // W5c4: the seven bindings that stood at the bank's `recommended` value (listed
  // as defaulted in every S1 plan); asked so the organisation's answer replaces it.
  {
    id: 'CUI.CAT.001',
    field: 'cui_categories',
    text: 'What CUI categories apply to this organization? (comma-separated: Controlled Technical Information (CTI), Technical drawings / engineering data, Source code, Program/project documentation, Security / IT artifacts containing CUI, Contract deliverables containing CUI, Export-controlled data (ITAR), Export-controlled data (EAR), Other (specify))',
    answerType: 'multi_select',
    bankOptions: [
      'Controlled Technical Information (CTI)',
      'Technical drawings / engineering data',
      'Source code',
      'Program/project documentation',
      'Security / IT artifacts containing CUI',
      'Contract deliverables containing CUI',
      'Export-controlled data (ITAR)',
      'Export-controlled data (EAR)',
      'Other (specify)',
    ],
  },
  {
    id: 'CUI.USR.001',
    field: 'cui_user_roles',
    text: 'Which user roles require access to CUI? (comma-separated: Engineers, DevOps, Program Managers, Executives, IT Admins, Security Team, Contractors, Subcontractors)',
    answerType: 'multi_select',
    bankOptions: ['Engineers', 'DevOps', 'Program Managers', 'Executives', 'IT Admins', 'Security Team', 'Contractors', 'Subcontractors'],
  },
  {
    id: 'CUI.DEVOPS.002',
    field: 'cui_repo_locations',
    text: 'Where are repositories containing CUI located? (comma-separated: Azure DevOps (GCC High), GitHub Enterprise (Gov), Commercial GitHub, Commercial Azure DevOps, Other)',
    answerType: 'multi_select',
    bankOptions: ['Azure DevOps (GCC High)', 'GitHub Enterprise (Gov)', 'Commercial GitHub', 'Commercial Azure DevOps', 'Other'],
  },
  {
    id: 'CUI.INT.002',
    field: 'email_forwarding_posture',
    text: 'Is email forwarding enabled for in-scope users?',
    answerType: 'single_select',
    options: [
      { value: 'no', label: 'No', bankOption: 'No' },
      { value: 'yes_restricted', label: 'Yes – restricted', bankOption: 'Yes – restricted' },
      { value: 'yes_unrestricted', label: 'Yes – unrestricted', bankOption: 'Yes – unrestricted' },
    ],
  },
  {
    id: 'CUI.INT.003',
    field: 'api_tokens_move_cui',
    text: 'Are service principals / API tokens used to move CUI?',
    answerType: 'single_select',
    options: [
      { value: 'no', label: 'No', bankOption: 'No' },
      { value: 'yes', label: 'Yes', bankOption: 'Yes' },
      { value: 'unknown', label: 'Unknown', bankOption: 'Unknown' },
    ],
  },
  {
    id: 'CUI.BKP.001',
    field: 'backup_model',
    text: 'How are backups handled?',
    answerType: 'single_select',
    options: [
      { value: 'm365_native', label: 'M365 native only', bankOption: 'M365 native only' },
      { value: 'third_party_in_scope', label: 'Third-party backup (in scope)', bankOption: 'Third-party backup (in scope)' },
      { value: 'third_party_out_of_scope', label: 'Third-party backup (out of scope)', bankOption: 'Third-party backup (out of scope)' },
    ],
  },
  {
    id: 'CUI.ENF.001',
    field: 'boundary_enforcement_controls',
    text: 'Which enforcement mechanisms are intended to protect the boundary? (comma-separated: Conditional Access, Intune compliance enforcement, DLP policies, Sensitivity labels, External sharing restrictions, Defender policies, Network segmentation, Other)',
    answerType: 'multi_select',
    bankOptions: [
      'Conditional Access',
      'Intune compliance enforcement',
      'DLP policies',
      'Sensitivity labels',
      'External sharing restrictions',
      'Defender policies',
      'Network segmentation',
      'Other',
    ],
  },
];

export const CUI_NODE_SPEC_BY_ID: Record<string, CuiNodeSpec> = Object.fromEntries(
  CUI_NODE_SPECS.map((s) => [s.id, s])
);

function inputKind(s: CuiNodeSpec): PlanInputKind | undefined {
  if (s.answerType === 'number') return 'number';
  if (s.answerType === 'list' || s.answerType === 'multi_select') return 'list';
  return undefined;
}

export const CUI_BOUNDARY_NODES: QuestionNode[] = CUI_NODE_SPECS.map((s) => {
  const input = inputKind(s);
  return {
    id: s.id,
    text: s.text,
    options: (s.options ?? []).map((o) => ({ label: o.label, value: o.value })),
    cluster: 'boundary',
    mapped_requirements: [],
    plan_input: { contract: 'cui_boundary', field: s.field },
    ...(input ? { input } : {}),
  };
});

/**
 * The bank raw_answer for a stored node answer, or null when the stored string
 * is not a valid answer (it is then ignored and the default applies). List
 * answers split on comma/semicolon like the shared widget; "none" alone is an
 * explicit empty list; multi_select items are canonicalised to the bank option
 * (case-insensitive) and kept as typed when they match none.
 */
export function cuiRawAnswer(spec: CuiNodeSpec, stored: string): string | number | string[] | null {
  const text = stored.trim();
  if (!text) return null;
  switch (spec.answerType) {
    case 'single_select':
      return spec.options?.find((o) => o.value === text)?.bankOption ?? null;
    case 'number':
      return /^\d+$/.test(text) ? Number(text) : null;
    case 'list':
    case 'multi_select': {
      const items = text.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
      if (items.length === 1 && items[0].toLowerCase() === 'none') return [];
      if (items.length === 0) return null;
      if (spec.answerType === 'list') return items;
      return items.map((i) => spec.bankOptions?.find((o) => o.toLowerCase() === i.toLowerCase()) ?? i);
    }
  }
}
