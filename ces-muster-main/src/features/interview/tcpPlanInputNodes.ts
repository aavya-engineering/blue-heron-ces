// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// tcpPlanInputNodes.ts — W4-MU1 (MS-R7, PLAN-3 M3): the Tenant Config Profile
// plan inputs as STATIC question-graph nodes, spread into QUESTION_GRAPH after
// the SI plan-input nodes. Same design as siPlanInputNodes.ts: one graph, one
// pruner, mapped_requirements [] (score-leak safe on both scoring paths),
// plan_input set, OPTIONAL for the finish gate.
//
// Only the bank's radio-capable TCP questions appear (single_select and
// boolean). Text / list / number / GUID answers (tenant id, domains, naming
// conventions, UPN lists, CUI sites …) are NOT asked here — no text widget yet
// (F9) — they are resolved by tcpAdapter.ts from session facts or the bank's
// own `recommended` value and honestly listed as defaulted on the Plan tab.
//
// Values are slugs; `bankOption` is the exact option string of
// `primed TCP Question Bank.yaml`, so tcpAdapter hands the vendored
// generateTenantConfigProfile the same raw_answer Planner's wizard would.
// Drift from the bank is caught by tcpPlanInputNodes.parity.test.ts.
import type { QuestionNode } from './questionGraph';

export interface TcpNodeSpec {
  id: string;
  /** bindings.tenant_config path in the TCP bank (TenantConfigProfileOutput.tenant_config.*). */
  field: string;
  text: string;
  answerType: 'single_select' | 'boolean';
  options: Array<{ value: string; label: string; bankOption: string | boolean }>;
}

const YES_NO = (yes: string, no: string): TcpNodeSpec['options'] => [
  { value: 'yes', label: yes, bankOption: true },
  { value: 'no', label: no, bankOption: false },
];

/** Transcribed from `primed TCP Question Bank.yaml`; guarded by the parity test. */
export const TCP_NODE_SPECS: TcpNodeSpec[] = [
  {
    id: 'TCP.TI.004',
    field: 'identity.cloud_environment',
    text: 'Which Microsoft cloud environment does the tenant run in?',
    answerType: 'single_select',
    options: [
      { value: 'commercial', label: 'Commercial', bankOption: 'Commercial' },
      { value: 'gcc', label: 'GCC', bankOption: 'GCC' },
      { value: 'gcc_high', label: 'GCC High', bankOption: 'GCC High' },
      { value: 'dod', label: 'DoD', bankOption: 'DoD' },
    ],
  },
  {
    id: 'TCP.LIC.001',
    field: 'licensing.primary_sku',
    text: 'What is the primary license SKU for this tenant?',
    answerType: 'single_select',
    options: [
      { value: 'm365_g5', label: 'Microsoft 365 G5', bankOption: 'Microsoft 365 G5' },
      { value: 'm365_g3', label: 'Microsoft 365 G3', bankOption: 'Microsoft 365 G3' },
      { value: 'm365_e5', label: 'Microsoft 365 E5', bankOption: 'Microsoft 365 E5' },
      { value: 'm365_e3', label: 'Microsoft 365 E3', bankOption: 'Microsoft 365 E3' },
      { value: 'o365_g5', label: 'Office 365 G5', bankOption: 'Office 365 G5' },
      { value: 'o365_g3', label: 'Office 365 G3', bankOption: 'Office 365 G3' },
      { value: 'other', label: 'Other', bankOption: 'Other' },
    ],
  },
  {
    id: 'TCP.IA.004',
    field: 'identity_architecture.identity_provider',
    text: 'How are identities provided to the tenant?',
    answerType: 'single_select',
    options: [
      { value: 'entra_native', label: 'Entra ID native (cloud-only)', bankOption: 'Entra ID native (cloud-only)' },
      { value: 'hybrid_ad_connect', label: 'Hybrid with AD Connect', bankOption: 'Hybrid with AD Connect' },
      { value: 'hybrid_cloud_sync', label: 'Hybrid with Cloud Sync', bankOption: 'Hybrid with Cloud Sync' },
      { value: 'external_idp', label: 'External IdP (Okta, Ping, etc.)', bankOption: 'External IdP (Okta, Ping, etc.)' },
    ],
  },
  {
    id: 'TCP.IA.005',
    field: 'identity_architecture.directory_sync_enabled',
    text: 'Is directory synchronisation from on-premises AD enabled?',
    answerType: 'boolean',
    options: YES_NO('Yes, directory sync is on', 'No directory sync'),
  },
  {
    id: 'TCP.PA.004',
    field: 'privileged_access.pim_enabled',
    text: 'Is Privileged Identity Management (PIM) enabled for admin roles?',
    answerType: 'boolean',
    options: YES_NO('Yes, PIM is enabled', 'No PIM'),
  },
  {
    id: 'TCP.GA.004',
    field: 'group_architecture.group_strategy',
    text: 'How are security group memberships managed?',
    answerType: 'single_select',
    options: [
      { value: 'dynamic', label: 'Dynamic (attribute-based)', bankOption: 'Dynamic (attribute-based)' },
      { value: 'assigned', label: 'Assigned (manual)', bankOption: 'Assigned (manual)' },
      { value: 'mixed', label: 'Mixed (both)', bankOption: 'Mixed (both)' },
    ],
  },
  {
    id: 'TCP.DM.001',
    field: 'device_management.enrollment_type',
    text: 'How are in-scope devices enrolled?',
    answerType: 'single_select',
    options: [
      { value: 'azure_ad_join', label: 'Azure AD Join', bankOption: 'Azure AD Join' },
      { value: 'hybrid_join', label: 'Hybrid Join', bankOption: 'Hybrid Join' },
      { value: 'enroll_only', label: 'Enroll Only (BYOD MDM)', bankOption: 'Enroll Only (BYOD MDM)' },
      { value: 'none', label: 'None', bankOption: 'None' },
    ],
  },
];

/** The static TCP plan-input nodes. cluster 'plan-input:tcp', mapped_requirements
 * [] (score-leak safe), plan_input set. */
export const TCP_PLAN_INPUT_NODES: QuestionNode[] = TCP_NODE_SPECS.map((s) => ({
  id: s.id,
  text: s.text,
  options: s.options.map((o) => ({ label: o.label, value: o.value })),
  cluster: 'plan-input:tcp',
  mapped_requirements: [],
  plan_input: { contract: 'tenant_config_profile', field: s.field },
}));

/** Node id → spec, for tcpAdapter's value → bank-option decode. */
export const TCP_NODE_SPEC_BY_ID: ReadonlyMap<string, TcpNodeSpec> = new Map(
  TCP_NODE_SPECS.map((s) => [s.id, s])
);
