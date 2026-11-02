// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// planModeNode.ts — MG-10 (decision D6): the ONE plan-mode confirm question.
// plan/planModeDerivation.ts derives the mode from discovery (no or empty
// target tenant -> build_new, an established tenant -> harden_existing); the
// operator confirms or corrects it here. An answer always beats the
// derivation. Only the two V1 modes are offered: migrate/hybrid are deferred
// and only flagged (never built). Same plan-input contract as the SI/TCP nodes
// (mapped_requirements [] — score-leak safe; OPTIONAL for the finish gate).
import type { QuestionNode } from './questionGraph';

export const PLAN_MODE_NODE_ID = 'PLAN.MODE.001';

export const PLAN_MODE_NODE: QuestionNode = {
  id: PLAN_MODE_NODE_ID,
  text: 'Muster derives the plan mode from discovery. Confirm it: does this plan harden the existing tenant, or build a new one?',
  options: [
    { label: 'Harden the existing tenant', value: 'harden_existing' },
    { label: 'Build a new tenant', value: 'build_new' },
  ],
  // The 'Tenant Config' tab (assessmentHelpers.CLUSTER_LABELS): the mode is a
  // decision about the target tenant. No new tab; kept out of the SI cluster.
  cluster: 'plan-input:tcp',
  mapped_requirements: [],
  plan_input: { contract: 'mission_plan', field: 'plan_mode' },
};
