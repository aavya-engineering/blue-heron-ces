// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

export interface MechanismStatus {
  ca_app_control: boolean;
  non_browser_client_block: boolean;
  dlp_coverage: boolean;
  sensitivity_labels: boolean;
}

const VERDICT_TABLE: Record<string, (m: MechanismStatus) => boolean> = {
  'AC.L2-3.1.18': (m) => m.ca_app_control && m.non_browser_client_block,
  'AC.L2-3.1.19': (m) => m.ca_app_control && m.non_browser_client_block,
  'CM.L2-3.4.6':  (m) => m.ca_app_control && m.non_browser_client_block,
  'SC.L2-3.13.16': (m) => m.ca_app_control && m.sensitivity_labels,
  'AC.L1-3.1.22': (m) => m.dlp_coverage,
  'MP.L2-3.8.8':  (m) => m.dlp_coverage,
  'MP.L2-3.8.9':  (m) => m.dlp_coverage,
  'SC.L2-3.13.8': (m) => m.dlp_coverage,
};

export function computeControlVerdict(
  controlId: string,
  mechanisms: MechanismStatus,
): { verdict: 'SAT' | 'NOT_SAT'; rationale: string } {
  const check = VERDICT_TABLE[controlId];
  if (!check) {
    return { verdict: 'NOT_SAT', rationale: 'Control not in BYOD verdict map' };
  }
  const passed = check(mechanisms);
  if (passed) {
    return { verdict: 'SAT', rationale: `${controlId} satisfied: required mechanisms verified` };
  }
  const missing: string[] = [];
  if (!mechanisms.ca_app_control) missing.push('CA App Control');
  if (!mechanisms.non_browser_client_block) missing.push('Non-Browser Client Block');
  if (!mechanisms.dlp_coverage) missing.push('DLP Coverage');
  if (!mechanisms.sensitivity_labels) missing.push('Sensitivity Labels');
  return { verdict: 'NOT_SAT', rationale: `${controlId} not satisfied: missing ${missing.join(', ')}` };
}

export function buildNarrativeStub(
  mechanisms: MechanismStatus,
  policyNames: Record<string, string>,
): string {
  const lines: string[] = ['Session-Controlled BYOD Architecture Evidence Summary:'];
  lines.push(`  Mechanism 1 (CA App Control): ${mechanisms.ca_app_control ? 'VERIFIED' : 'NOT VERIFIED'}${policyNames['ca_app_control'] ? ' - ' + policyNames['ca_app_control'] : ''}`);
  lines.push(`  Mechanism 2 (Non-Browser Client Block): ${mechanisms.non_browser_client_block ? 'VERIFIED' : 'NOT VERIFIED'}${policyNames['non_browser_client_block'] ? ' - ' + policyNames['non_browser_client_block'] : ''}`);
  lines.push(`  Mechanism 3 (DLP Coverage): ${mechanisms.dlp_coverage ? 'VERIFIED' : 'NOT VERIFIED'}${policyNames['dlp_coverage'] ? ' - ' + policyNames['dlp_coverage'] : ''}`);
  lines.push(`  Mechanism 4 (Sensitivity Labels): ${mechanisms.sensitivity_labels ? 'VERIFIED' : 'NOT VERIFIED'}${policyNames['sensitivity_labels'] ? ' - ' + policyNames['sensitivity_labels'] : ''}`);
  return lines.join('\n');
}
