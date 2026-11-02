// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// Maps interview stack declarations + facts → PreambleAnswers + minimal siBaseline
// for the deriveActionStatuses 6-step cascade.
import type { PreambleAnswers } from '@/features/plan/engine/rrt/types';
import type { InterviewFact } from '@/shared/types/engagement';

/** Build a minimal siBaseline for the cascade.
 *  Phase 0: assume CUI present, L2 target, hybrid deployment. [validate with BHD]
 */
export function buildSIBaseline(selectedStacks: string[]): unknown {
  const cloudOnly =
    selectedStacks.includes('none') ||
    (!selectedStacks.includes('on_prem_ad') && selectedStacks.length > 0);
  return {
    si_baseline: {
      target: { target_cmmc_level: 'L2' },
      scope: {
        cui_presence: 'has_cui',
        deployment_posture: cloudOnly ? 'cloud_only' : 'hybrid',
        byod_posture: 'not_allowed',
      },
    },
  };
}

/** RR activities whose answer evidences Conditional Access (remote access, authorized access). */
const CA_ACTIVITY_IDS = new Set(['RR-ACT-AC_L2_3_1_12', 'RR-ACT-AC_L2_3_1_14', 'RR-ACT-AC_L1_3_1_1', 'RR-ACT-AC_L1_3_1_2']);
/** RR activities whose answer says whether an SSP exists (foundation SSP, CA.L2-3.12.4). */
const SSP_ACTIVITY_IDS = new Set(['RR-ACT-UNIV-SSP', 'RR-ACT-CA_L2_3_12_4']);
/** TCP.LIC.001 primary SKU -> the cascade's licence tier. */
const LICENSE_TIER_BY_SKU: Record<string, PreambleAnswers['license_tier']> = {
  m365_g5: 'gcc_g5',
  o365_g5: 'gcc_g5',
  m365_g3: 'gcc_g3',
  o365_g3: 'gcc_g3',
  m365_e5: 'e5',
  m365_e3: 'e3',
};
/** RR activities whose answer evidences MFA. */
const MFA_ACTIVITY_IDS = new Set(['RR-ACT-AC_L2_3_1_13', 'RR-ACT-IA_L2_3_5_3']);

/** Map selected stack tiles + interview answers → PreambleAnswers for the cascade. */
export function mapToPreamble(
  selectedStacks: string[],
  facts: InterviewFact[]
): PreambleAnswers {
  // license_tier: E5/GCC-G5 if m365_e5_gcc selected, else E3 if any M365, else unknown
  let license_tier: PreambleAnswers['license_tier'] = 'unknown';
  // MG-07: the tenant's declared/discovered primary SKU (TCP.LIC.001, harvested
  // from subscribedSkus) beats the coarser stack tile, as it does for SIT-021.
  const skuTier = LICENSE_TIER_BY_SKU[facts.find((f) => f.question_id === 'TCP.LIC.001')?.answer ?? ''];
  if (skuTier) {
    license_tier = skuTier;
  } else if (selectedStacks.includes('m365_e5_gcc')) {
    license_tier = 'gcc_g5';
  } else if (selectedStacks.includes('m365_e3') || selectedStacks.includes('microsoft_sentinel')) {
    license_tier = 'e3';
  }

  // endpoint_management: intune if selected, third_party if on-prem AD only, else unmanaged
  let endpoint_management: PreambleAnswers['endpoint_management'] = 'unmanaged';
  if (selectedStacks.includes('microsoft_intune')) {
    endpoint_management = 'intune_enrolled';
  } else if (selectedStacks.includes('on_prem_ad')) {
    endpoint_management = 'third_party_mdm';
  }

  // monitoring_siem: sentinel if selected, basic M365 if any M365, else none
  let monitoring_siem: PreambleAnswers['monitoring_siem'] = 'none';
  if (selectedStacks.includes('microsoft_sentinel')) {
    monitoring_siem = 'sentinel_deployed';
  } else if (
    selectedStacks.includes('m365_e3') ||
    selectedStacks.includes('m365_e5_gcc') ||
    selectedStacks.includes('sharepoint')
  ) {
    monitoring_siem = 'basic_m365_audit';
  }

  // policy_doc_state: derive from the SSP foundation activity (MG-07; the
  // retired 'gov-001' id was never a graph node, so this read was dead)
  let policy_doc_state: PreambleAnswers['policy_doc_state'] = 'nothing_written';
  // (or CA.L2-3.12.4, the SSP requirement itself, where older SSP answers land).
  const sspFact = facts.find((f) => SSP_ACTIVITY_IDS.has(f.question_id));
  if (sspFact) {
    if (sspFact.answer === 'yes') policy_doc_state = 'ssp_with_policies';
    else if (sspFact.answer !== 'no' && sspFact.answer !== 'unknown') policy_doc_state = 'some_policies_drafted';
  }

  // security_archetype: infer from CA policy + MFA facts. MG-07: the RR
  // activities for the requirements the retired iam-004/iam-002 (remote access,
  // authorized access) and iam-001 (MFA) nodes mapped; legacy facts arrive
  // re-keyed onto them (expandLegacyReadinessFacts).
  let security_archetype: PreambleAnswers['security_archetype'] = 'greenfield';
  const caFact = facts.find((f) => CA_ACTIVITY_IDS.has(f.question_id));
  const mfaFact = facts.find((f) => MFA_ACTIVITY_IDS.has(f.question_id));
  if (caFact && caFact.answer === 'yes' && mfaFact && mfaFact.answer === 'yes') {
    security_archetype = 'basic_ca_policies';
  } else if (mfaFact && mfaFact.answer === 'yes') {
    security_archetype = 'security_defaults_only';
  } else if (selectedStacks.includes('microsoft_intune') && selectedStacks.includes('microsoft_sentinel')) {
    security_archetype = 'moderate_hardening';
  }

  return { license_tier, security_archetype, endpoint_management, monitoring_siem, policy_doc_state };
}
