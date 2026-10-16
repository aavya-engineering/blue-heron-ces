// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { CesIdentity } from '../config/cesConfig.contract.js';

export interface PlanOfActionMilestones {
  poamId: string;
  generatedAt: string;
  tenantId: string;
  /** G1/T2: CES identity (customer↔tenant lineage), when resolvable from CES config. */
  ces?: CesIdentity;
  sprsScore: number;

  eligibility: PoamEligibility;
  items: PoamItem[];
  summary: PoamSummary;
}

export interface PoamEligibility {
  eligible: boolean;
  certificationPath: 'full' | 'conditional' | 'blocked';
  blockers: PoamBlocker[];
  scoreThresholdMet: boolean;
  weightRuleMet: boolean;
  prohibitedControlsMet: boolean;
}

export interface PoamBlocker {
  control_id: string;
  nist_ref: string;
  weight: number;
  reason: string;
}

export interface PoamItem {
  itemId: string;
  control_id: string;
  nist_ref: string;
  practice: string;
  weight: number;
  deficiencyDescription: string;
  plannedCorrectiveAction: string;
  responsibleParty: string;
  estimatedCompletionDate: string;
  resourcesRequired: string;
  status: 'open' | 'in_progress' | 'closed';
  milestones: PoamMilestone[];
  automationAvailable?: boolean;
}

export interface PoamMilestone {
  milestoneId: string;
  description: string;
  targetDate: string;
  status: 'pending' | 'completed';
}

export interface PoamSummary {
  totalItems: number;
  openItems: number;
  totalWeightOnPoam: number;
  projectedScoreAfterPoam: number;
}
