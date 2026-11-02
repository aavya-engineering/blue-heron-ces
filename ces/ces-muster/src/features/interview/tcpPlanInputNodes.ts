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
import type { PlanInputKind, QuestionNode } from './questionGraph';

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

/**
 * MG-14: the bank's non-radio TCP questions that hold TENANT FACTS (ids,
 * domains, accounts, counts, platforms, workspace) rather than naming
 * conventions. Each is a typed-input node so the harvest prefill
 * (muster-api harvestService TENANT_PROBES, provenance auto_detected) can carry
 * the discovered value as an overridable pre-fill; pruned when that fact is
 * present, asked (optional) only when discovery is silent. W5c3: the
 * conventions (IA.002/003, GA.001/003, CA.001, DM.002/003, DP.001/004, MON.005)
 * and the other text / list questions are typed nodes too (below), so an answer
 * replaces the bank recommendation; unanswered, it stays listed as defaulted.
 * `bankType` is the bank's answer_type (guarded by tenantDiscovery.test.ts).
 */
export interface TcpTypedNodeSpec {
  id: string;
  field: string;
  text: string;
  input: Extract<PlanInputKind, 'text' | 'list' | 'number'>;
  bankType: 'guid' | 'text' | 'list' | 'number' | 'upn_list' | 'multi_select';
}

export const TCP_TYPED_NODE_SPECS: TcpTypedNodeSpec[] = [
  { id: 'TCP.TI.001', field: 'identity.tenant_id', text: 'What is the tenant id (directory id GUID)?', input: 'text', bankType: 'guid' },
  { id: 'TCP.TI.002', field: 'identity.primary_domain', text: 'What is the tenant primary domain?', input: 'text', bankType: 'text' },
  { id: 'TCP.TI.003', field: 'identity.custom_domains', text: 'Which domains are verified in the tenant? (comma-separated)', input: 'list', bankType: 'list' },
  { id: 'TCP.TI.005', field: 'identity.display_name', text: 'What is the tenant display name?', input: 'text', bankType: 'text' },
  { id: 'TCP.LIC.002', field: 'licensing.license_count', text: 'How many licenses of the primary SKU are assigned?', input: 'number', bankType: 'number' },
  { id: 'TCP.IA.001', field: 'identity_architecture.break_glass_accounts', text: 'Which accounts are the break-glass (emergency access) accounts? (UPNs, comma-separated)', input: 'list', bankType: 'upn_list' },
  { id: 'TCP.PA.001', field: 'privileged_access.global_admins', text: 'Which accounts hold Global Administrator? (UPNs, comma-separated)', input: 'list', bankType: 'upn_list' },
  { id: 'TCP.PA.002', field: 'privileged_access.security_admins', text: 'Which accounts hold Security Administrator? (UPNs, comma-separated)', input: 'list', bankType: 'upn_list' },
  { id: 'TCP.PA.003', field: 'privileged_access.compliance_admins', text: 'Which accounts hold Compliance Administrator? (UPNs, comma-separated)', input: 'list', bankType: 'upn_list' },
  { id: 'TCP.GA.002', field: 'group_architecture.key_groups', text: 'Which security groups govern CUI and compliance access? (comma-separated)', input: 'list', bankType: 'list' },
  { id: 'TCP.CA.003', field: 'conditional_access.existing_policy_count', text: 'How many Conditional Access policies exist in the tenant today?', input: 'number', bankType: 'number' },
  { id: 'TCP.DM.004', field: 'device_management.platforms_in_scope', text: 'Which device platforms are in scope? (comma-separated: Windows, macOS, iOS/iPadOS, Android)', input: 'list', bankType: 'multi_select' },
  { id: 'TCP.MON.003', field: 'monitoring.log_analytics_workspace_id', text: 'What is the Log Analytics workspace id (GUID) behind Sentinel?', input: 'text', bankType: 'guid' },
  { id: 'TCP.MON.004', field: 'monitoring.data_connectors', text: 'Which Sentinel data connectors are enabled? (comma-separated)', input: 'list', bankType: 'multi_select' },
  // W5c3 (SC-8b): the bank's remaining text / list questions. Before, no node
  // carried them, so an answer (or a harvest fact) could never reach the TCP and
  // the bank recommendation always stood (listed as defaulted). Same decode path;
  // still optional plan inputs. Named locations and the break-glass exclusion
  // group are harvested (graph:namedLocations, graph:conditionalAccess + groups);
  // the conventions, CUI sites / channels and Sentinel names are asked.
  { id: 'TCP.LIC.003', field: 'licensing.addon_skus', text: 'Which add-on licence SKUs are in use? (comma-separated SKU part numbers)', input: 'list', bankType: 'list' },
  { id: 'TCP.LIC.004', field: 'licensing.service_activations', text: 'Which services are activated in the tenant? (comma-separated: Exchange Online, SharePoint Online, Teams, Intune, Defender for Endpoint, Defender for Office 365, Defender for Identity, Defender for Cloud Apps, Azure Information Protection, Purview Compliance, Sentinel)', input: 'list', bankType: 'multi_select' },
  { id: 'TCP.IA.002', field: 'identity_architecture.admin_naming_convention', text: 'What is the admin account naming convention?', input: 'text', bankType: 'text' },
  { id: 'TCP.IA.003', field: 'identity_architecture.service_account_naming_convention', text: 'What is the service account naming convention?', input: 'text', bankType: 'text' },
  { id: 'TCP.PA.005', field: 'privileged_access.break_glass_exclusion_group', text: 'What is the break-glass exclusion group name?', input: 'text', bankType: 'text' },
  { id: 'TCP.GA.001', field: 'group_architecture.security_group_convention', text: 'What is the security group naming convention?', input: 'text', bankType: 'text' },
  { id: 'TCP.GA.003', field: 'group_architecture.distribution_group_convention', text: 'What is the distribution group naming convention?', input: 'text', bankType: 'text' },
  { id: 'TCP.CA.001', field: 'conditional_access.ca_naming_convention', text: 'What is the Conditional Access policy naming convention?', input: 'text', bankType: 'text' },
  { id: 'TCP.CA.002', field: 'conditional_access.named_locations', text: 'Which named locations exist? (comma-separated, each Name|Type|Value where Type is ip or country)', input: 'list', bankType: 'list' },
  { id: 'TCP.DM.002', field: 'device_management.device_naming_convention', text: 'What is the device naming convention?', input: 'text', bankType: 'text' },
  { id: 'TCP.DM.003', field: 'device_management.compliance_policy_convention', text: 'What is the compliance policy naming convention?', input: 'text', bankType: 'text' },
  { id: 'TCP.DP.001', field: 'data_protection.sensitivity_label_convention', text: 'What is the sensitivity label naming convention?', input: 'text', bankType: 'text' },
  { id: 'TCP.DP.002', field: 'data_protection.cui_sharepoint_sites', text: 'Which SharePoint site URLs are designated for CUI storage? (comma-separated)', input: 'list', bankType: 'list' },
  { id: 'TCP.DP.003', field: 'data_protection.cui_teams_channels', text: 'Which Teams channels are designated for CUI collaboration? (comma-separated)', input: 'list', bankType: 'list' },
  { id: 'TCP.DP.004', field: 'data_protection.dlp_policy_convention', text: 'What is the DLP policy naming convention?', input: 'text', bankType: 'text' },
  { id: 'TCP.MON.001', field: 'monitoring.sentinel_workspace_name', text: 'What is the Sentinel (Log Analytics) workspace name?', input: 'text', bankType: 'text' },
  { id: 'TCP.MON.002', field: 'monitoring.sentinel_resource_group', text: 'What is the Azure resource group for Sentinel?', input: 'text', bankType: 'text' },
  { id: 'TCP.MON.005', field: 'monitoring.alert_rule_convention', text: 'What is the alert rule naming convention?', input: 'text', bankType: 'text' },
];

/**
 * MG-14 / FX-11: the operator values Stamper's commands need that the primed
 * TCP bank has no question for (so they are not bank-parity nodes). Stamper's
 * variable names (ces-stamper src/shared/variable-map.ts) are in `stamperVar`.
 * Break-glass UPN and the CUI group name need no node: they come from
 * TCP.IA.001 and TCP.GA.002 (tcpAdapter operatorValues).
 */
export interface TcpOperatorNodeSpec {
  id: string;
  key: 'operator_upn' | 'break_glass_user_id' | 'wifi_ssid' | 'security_email';
  stamperVar: string;
  text: string;
  input: Extract<PlanInputKind, 'text' | 'upn'>;
}

export const TCP_OPERATOR_NODE_SPECS: TcpOperatorNodeSpec[] = [
  { id: 'TCP.MU.004', key: 'operator_upn', stamperVar: 'operatorUPN', text: 'Which admin account will run the build (the consented operator)? Enter its sign-in name (UPN).', input: 'upn' },
  { id: 'TCP.MU.005', key: 'break_glass_user_id', stamperVar: 'breakGlassUserId', text: 'What is the object id (GUID) of the first break-glass account?', input: 'text' },
  { id: 'TCP.MU.006', key: 'wifi_ssid', stamperVar: 'wifiSsid', text: 'What is the SSID of the managed corporate Wi-Fi network devices should join?', input: 'text' },
  { id: 'TCP.MU.007', key: 'security_email', stamperVar: 'securityEmail', text: 'Which mailbox receives security notifications and alerts? Enter the address.', input: 'upn' },
];

/** The static TCP plan-input nodes. cluster 'plan-input:tcp', mapped_requirements
 * [] (score-leak safe), plan_input set. */
export const TCP_PLAN_INPUT_NODES: QuestionNode[] = [
  ...TCP_NODE_SPECS.map((s) => ({
    id: s.id,
    text: s.text,
    options: s.options.map((o) => ({ label: o.label, value: o.value })),
    cluster: 'plan-input:tcp',
    mapped_requirements: [],
    plan_input: { contract: 'tenant_config_profile', field: s.field },
  })),
  ...TCP_TYPED_NODE_SPECS.map((s) => ({
    id: s.id,
    text: s.text,
    options: [],
    cluster: 'plan-input:tcp',
    mapped_requirements: [],
    plan_input: { contract: 'tenant_config_profile', field: s.field },
    input: s.input,
  })),
  ...TCP_OPERATOR_NODE_SPECS.map((s) => ({
    id: s.id,
    text: s.text,
    options: [],
    cluster: 'plan-input:tcp',
    mapped_requirements: [],
    plan_input: { contract: 'tenant_config_profile', field: `operator_values.${s.key}` },
    input: s.input,
  })),
];

/** MG-14: node id -> typed bank spec / operator spec, for tcpAdapter's decode. */
export const TCP_TYPED_SPEC_BY_ID: ReadonlyMap<string, TcpTypedNodeSpec> = new Map(
  TCP_TYPED_NODE_SPECS.map((s) => [s.id, s])
);
export const TCP_OPERATOR_SPEC_BY_ID: ReadonlyMap<string, TcpOperatorNodeSpec> = new Map(
  TCP_OPERATOR_NODE_SPECS.map((s) => [s.id, s])
);

/** Node id → spec, for tcpAdapter's value → bank-option decode. */
export const TCP_NODE_SPEC_BY_ID: ReadonlyMap<string, TcpNodeSpec> = new Map(
  TCP_NODE_SPECS.map((s) => [s.id, s])
);
