// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// policyAnswers.ts — MG-16 test helper for the full-session tests: answers to
// the Policy Inputs questions the graph asks (src/features/interview/
// policyInputNodes.ts). Synthetic values; personnel in Planner's
// "Name | Title | Email" form. They feed only the policy documents.
export const POLICY_ANSWERS: Record<string, string> = {
  'PI.ORG.002': '1 Fixture Way',
  'PI.ORG.003': 'Fixtureville',
  'PI.ORG.004': 'ZZ',
  'PI.ORG.005': '00000',
  'PI.ORG.008': 'Subcontractor',
  'PI.ORG.009': 'Synthetic manufacturing',
  'PI.ORG.010': '332710',
  'PI.ORG.011': 'None',
  'PI.PER.001': 'Fixture ISSO | ISSO | isso@fixture.example',
  'PI.PER.002': 'Fixture Owner | System Owner | owner@fixture.example',
  'PI.PER.003': 'Fixture Compliance | Compliance Officer | compliance@fixture.example',
  'PI.PER.004': 'Fixture IT | IT Director | it@fixture.example',
  'PI.PER.005': 'Fixture HR | HR Representative | hr@fixture.example',
  'PI.PER.006': 'Fixture IR | IR Lead | ir@fixture.example',
  'PI.PER.007': 'Fixture Facilities | Facilities Manager | facilities@fixture.example',
  'PI.PER.008': 'Fixture Legal | Contracts Representative | legal@fixture.example',
  'PI.PHY.001': '1 Fixture Way, Fixtureville, ZZ 00000',
  'PI.PHY.002': 'Badge readers (synthetic)',
  'PI.PHY.003': 'Visitors sign in and are escorted (synthetic)',
};
