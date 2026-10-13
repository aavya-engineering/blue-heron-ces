// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

import type { MusterPlanCase } from './muster-plan-generator.js';

/**
 * Flow-through MS-R3: the Muster generator INPUTS for the contract cases.
 * These are interview-level inputs (SIT answers keyed by real SI-bank question
 * ids, readiness posture) — the plans themselves come out of Muster's real
 * generator. No plan, directive or control disposition is hand-written here.
 *
 * Question ids (primed SI Question Bank, sets_its_fields):
 *   G-01 target_cmmc_level · G-02 cui_presence · G-07 boundary_strategy ·
 *   G-08 deployment_posture · S-20 tenant_model_preference ·
 *   SIT-023 fedramp_package_ids · SIT-024 physical_facility_count ·
 *   SIT-025 customer_equipment_count · S-25 mobile_device_presence ·
 *   S-26 wireless_posture · S-27 removable_media_posture
 */

/** Gapful: a mixed posture plus SI operational decisions that scope controls out
 * (no mobile -> capability-absent; removable media blocked -> prohibition), so
 * one plan carries Automated, Non-Stack, N-A-Capability-Absent and Met-By-Prohibition. */
export const GAPFUL_CASE: MusterPlanCase = {
  id: 'gapful',
  cesId: 'ft-x1-gapful',
  sitAnswers: {
    'G-01': 'L2',
    'G-02': 'cui_present',
    'G-07': 'single_enclave',
    'S-25': 'no_mobile_devices',
    'S-27': 'blocked',
  },
  requirementResults: [
    { requirement_id: 'AC.L1-3.1.1', status: 'not_met' },
    { requirement_id: 'AC.L2-3.1.3', status: 'partial' },
    { requirement_id: 'IA.L2-3.5.3', status: 'not_met' },
    { requirement_id: 'AU.L2-3.3.1', status: 'met' },
    { requirement_id: 'SC.L2-3.13.8', status: 'not_met' },
    { requirement_id: 'PS.L2-3.9.1', status: 'not_met' },
  ],
};

/** All-met: every requirement in Muster's requirements store reported `met`
 * (settles the `min(1)` risk: a plan with no gaps must still cross the boundary). */
export const ALL_MET_CASE: MusterPlanCase = {
  id: 'all-met',
  cesId: 'ft-x1-all-met',
  sitAnswers: {
    'G-01': 'L2',
    'G-02': 'cui_present',
    'G-07': 'single_enclave',
  },
  requirementResults: 'all-met',
};

/** FedRAMP-inherited: cloud-only GCC High with a FedRAMP package, zero facilities
 * and zero customer equipment -> PE/MA/AU/IA inheritance rows. */
export const FEDRAMP_PACKAGE_ID = 'F1234567890';
export const FEDRAMP_CASE: MusterPlanCase = {
  id: 'fedramp-inherited',
  cesId: 'ft-x1-fedramp',
  sitAnswers: {
    'G-01': 'L2',
    'G-02': 'cui_present',
    'G-07': 'single_enclave',
    'G-08': 'cloud_only',
    'S-20': 'gcc_high',
    'SIT-023': [FEDRAMP_PACKAGE_ID],
    'SIT-024': 0,
    'SIT-025': 0,
  },
  requirementResults: [
    { requirement_id: 'AC.L1-3.1.1', status: 'not_met' },
    { requirement_id: 'IA.L2-3.5.3', status: 'not_met' },
    { requirement_id: 'PE.L1-3.10.1', status: 'unknown' },
  ],
};

export const X1_CASES: MusterPlanCase[] = [GAPFUL_CASE, ALL_MET_CASE, FEDRAMP_CASE];
