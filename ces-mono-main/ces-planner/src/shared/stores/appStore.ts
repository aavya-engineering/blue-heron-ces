// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { STORAGE_KEYS, WORKFLOW_STAGES, type WorkflowStage } from '../config';

interface AppState {
  currentCustomerId: number | null;
  selectedBaselineId: number | null;
  selectedTenantConfigId: number | null;
  selectedCUIBoundaryId: number | null;
  selectedBTCConfirmationId: number | null;
  selectedPolicyInputsId: number | null;
  selectedQuestionSetId: number | null;
  selectedPostureId: number | null;
  selectedMissionPlanId: number | null;
  currentCesId: string | null;
  currentWorkflowStage: WorkflowStage;
  initialized: boolean;

  // Actions
  setCustomer: (customerId: number) => void;
  setSelectedBaselineId: (baselineId: number | null) => void;
  setSelectedTenantConfigId: (id: number | null) => void;
  setSelectedCUIBoundaryId: (id: number | null) => void;
  setSelectedBTCConfirmationId: (id: number | null) => void;
  setSelectedPolicyInputsId: (id: number | null) => void;
  setSelectedQuestionSetId: (id: number | null) => void;
  setSelectedPostureId: (id: number | null) => void;
  setSelectedMissionPlanId: (id: number | null) => void;
  setCurrentCesId: (cesId: string | null) => void;
  setWorkflowStage: (stage: WorkflowStage) => void;
  setInitialized: (initialized: boolean) => void;
  reset: () => void;
}

const initialState = {
  currentCustomerId: null,
  selectedBaselineId: null,
  selectedTenantConfigId: null,
  selectedCUIBoundaryId: null,
  selectedBTCConfirmationId: null,
  selectedPolicyInputsId: null,
  selectedQuestionSetId: null,
  selectedPostureId: null,
  selectedMissionPlanId: null,
  currentCesId: null,
  currentWorkflowStage: WORKFLOW_STAGES.CUSTOMER_SELECTION as WorkflowStage,
  initialized: false,
};

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      ...initialState,

      setCustomer: (customerId) =>
        set({
          currentCustomerId: customerId,
          selectedBaselineId: null,
          selectedTenantConfigId: null,
          selectedCUIBoundaryId: null,
          selectedBTCConfirmationId: null,
          selectedPolicyInputsId: null,
          selectedQuestionSetId: null,
          selectedPostureId: null,
          selectedMissionPlanId: null,
          currentWorkflowStage: WORKFLOW_STAGES.SIT,
        }),

      setSelectedBaselineId: (baselineId) =>
        set({
          selectedBaselineId: baselineId,
          selectedTenantConfigId: null,
          selectedCUIBoundaryId: null,
          selectedBTCConfirmationId: null,
          selectedQuestionSetId: null,
          selectedPostureId: null,
          selectedMissionPlanId: null,
        }),

      setSelectedTenantConfigId: (id) => set({ selectedTenantConfigId: id }),

      setSelectedCUIBoundaryId: (id) =>
        set({
          selectedCUIBoundaryId: id,
          selectedBTCConfirmationId: null,
        }),

      setSelectedBTCConfirmationId: (id) => set({ selectedBTCConfirmationId: id }),

      setSelectedPolicyInputsId: (id) => set({ selectedPolicyInputsId: id }),

      setSelectedQuestionSetId: (id) =>
        set({
          selectedQuestionSetId: id,
          selectedPostureId: null,
          selectedMissionPlanId: null,
        }),

      setSelectedPostureId: (id) =>
        set({
          selectedPostureId: id,
          selectedMissionPlanId: null,
        }),

      setSelectedMissionPlanId: (id) => set({ selectedMissionPlanId: id }),

      setCurrentCesId: (cesId) => set({ currentCesId: cesId }),

      setWorkflowStage: (stage) => set({ currentWorkflowStage: stage }),

      setInitialized: (initialized) => set({ initialized }),

      reset: () => set({ ...initialState, initialized: true }),
    }),
    {
      name: STORAGE_KEYS.APP_STORE,
      partialize: (state) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { initialized, ...rest } = state;
        return rest;
      },
    }
  )
);
