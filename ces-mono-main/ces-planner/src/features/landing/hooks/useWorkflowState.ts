// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useLiveQuery } from 'dexie-react-hooks';
import { dbHelpers } from '@/shared/db/schema';
import type {
  SIBaselineRecord,
  RRQuestionSetRecord,
  ReadinessPostureRecord,
  MissionPlan,
  CUIBoundaryRecord,
  BTCConfirmationRecord,
  TenantConfigProfileRecord,
  PolicyInputsRecord,
} from '@/shared/types/artifacts';

export interface WorkflowState {
  hasBaseline: boolean;
  hasTenantConfig: boolean;
  hasCUIBoundary: boolean;
  hasBTCConfirmation: boolean;
  hasPolicyInputs: boolean;
  hasQuestionSet: boolean;
  hasPosture: boolean;
  hasMissionPlan: boolean;
  baselineId?: number;
  tenantConfigId?: number;
  cuiBoundaryId?: number;
  btcConfirmationId?: number;
  policyInputsId?: number;
  questionSetId?: number;
  postureId?: number;
  missionPlanId?: number;
  availableBaselines: SIBaselineRecord[];
  availableTenantConfigs: TenantConfigProfileRecord[];
  availableCUIBoundaries: CUIBoundaryRecord[];
  availableBTCConfirmations: BTCConfirmationRecord[];
  availablePolicyInputs: PolicyInputsRecord[];
  availableQuestionSets: RRQuestionSetRecord[];
  availablePostures: ReadinessPostureRecord[];
  availableMissionPlans: MissionPlan[];
}

const emptyState: WorkflowState = {
  hasBaseline: false,
  hasTenantConfig: false,
  hasCUIBoundary: false,
  hasBTCConfirmation: false,
  hasPolicyInputs: false,
  hasQuestionSet: false,
  hasPosture: false,
  hasMissionPlan: false,
  availableBaselines: [],
  availableTenantConfigs: [],
  availableCUIBoundaries: [],
  availableBTCConfirmations: [],
  availablePolicyInputs: [],
  availableQuestionSets: [],
  availablePostures: [],
  availableMissionPlans: [],
};

export function useWorkflowState(
  customerId: number | null,
  selectedBaselineId: number | null | undefined,
  selectedTenantConfigId: number | null | undefined,
  selectedCUIBoundaryId: number | null | undefined,
  selectedBTCConfirmationId: number | null | undefined,
  selectedPolicyInputsId: number | null | undefined,
  selectedQuestionSetId: number | null | undefined,
  selectedPostureId: number | null | undefined,
  selectedMissionPlanId: number | null | undefined,
): WorkflowState {
  const state = useLiveQuery(
    async () => {
      // Baselines are scoped to the active customer; with no customer we expose none
      // (never return other customers' baselines — G1/ADR-001 ownership).
      if (!customerId) {
        return { ...emptyState };
      }

      const availableBaselines = await dbHelpers.getBaselinesForCustomer(customerId);

      // Downstream objects filtered by (customerId, baselineId)
      let availableTenantConfigs: TenantConfigProfileRecord[] = [];
      let availableCUIBoundaries: CUIBoundaryRecord[] = [];
      let availableBTCConfirmations: BTCConfirmationRecord[] = [];
      let availablePolicyInputs: PolicyInputsRecord[] = [];
      let availableQuestionSets: RRQuestionSetRecord[] = [];
      let availablePostures: ReadinessPostureRecord[] = [];
      let availableMissionPlans: MissionPlan[] = [];

      availablePolicyInputs = await dbHelpers.getPolicyInputsByCustomer(customerId);

      if (selectedBaselineId) {
        availableTenantConfigs = await dbHelpers.getTenantConfigsByCustomerAndBaseline(
          customerId,
          selectedBaselineId,
        );
        availableCUIBoundaries = await dbHelpers.getCUIBoundariesByCustomerAndBaseline(
          customerId,
          selectedBaselineId,
        );
        availableBTCConfirmations = await dbHelpers.getBTCsByCustomerAndBaseline(
          customerId,
          selectedBaselineId,
        );
        availableQuestionSets = await dbHelpers.getQuestionSetsByCustomerAndBaseline(
          customerId,
          selectedBaselineId,
        );
        availablePostures = await dbHelpers.getPosturesByCustomerAndBaseline(
          customerId,
          selectedBaselineId,
        );
        availableMissionPlans = await dbHelpers.getMissionPlansByCustomerAndBaseline(
          customerId,
          selectedBaselineId,
        );
      }

      return {
        hasBaseline: selectedBaselineId != null,
        hasTenantConfig: selectedTenantConfigId != null,
        hasCUIBoundary: selectedCUIBoundaryId != null,
        hasBTCConfirmation: selectedBTCConfirmationId != null,
        hasPolicyInputs: selectedPolicyInputsId != null,
        hasQuestionSet: selectedQuestionSetId != null,
        hasPosture: selectedPostureId != null,
        hasMissionPlan: selectedMissionPlanId != null,
        baselineId: selectedBaselineId ?? undefined,
        tenantConfigId: selectedTenantConfigId ?? undefined,
        cuiBoundaryId: selectedCUIBoundaryId ?? undefined,
        btcConfirmationId: selectedBTCConfirmationId ?? undefined,
        policyInputsId: selectedPolicyInputsId ?? undefined,
        questionSetId: selectedQuestionSetId ?? undefined,
        postureId: selectedPostureId ?? undefined,
        missionPlanId: selectedMissionPlanId ?? undefined,
        availableBaselines,
        availableTenantConfigs,
        availableCUIBoundaries,
        availableBTCConfirmations,
        availablePolicyInputs,
        availableQuestionSets,
        availablePostures,
        availableMissionPlans,
      };
    },
    [
      customerId,
      selectedBaselineId,
      selectedTenantConfigId,
      selectedCUIBoundaryId,
      selectedBTCConfirmationId,
      selectedPolicyInputsId,
      selectedQuestionSetId,
      selectedPostureId,
      selectedMissionPlanId,
    ],
  );

  return state || emptyState;
}
