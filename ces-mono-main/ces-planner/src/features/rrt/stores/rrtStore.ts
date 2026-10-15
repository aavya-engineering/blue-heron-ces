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
import type {
  RRTAnswer,
  EvidenceItem,
  RRTState,
  RRTWizardPhase,
  PreambleAnswers,
  DerivedActionStatus,
  ActionStatus,
} from '../types';

interface RRTStore extends RRTState {
  // Actions
  setQuestionSet: (questionSet: any) => void;
  setAnswer: (questionId: string, answer: RRTAnswer) => void;
  addEvidence: (evidence: EvidenceItem) => void;
  removeEvidence: (evidenceId: string) => void;
  setCurrentStep: (step: number) => void;
  setComplete: (complete: boolean) => void;
  setWizardPhase: (phase: RRTWizardPhase) => void;
  setPreambleAnswers: (answers: PreambleAnswers) => void;
  setActionStatuses: (statuses: DerivedActionStatus[]) => void;
  updateActionStatus: (actionId: string, status: ActionStatus) => void;
  setBulkAnswers: (answers: Record<string, RRTAnswer>) => void;
  reset: () => void;
}

const initialState: RRTState = {
  currentStep: 0,
  answers: {},
  evidenceItems: [],
  questionSet: null,
  isComplete: false,
  wizardPhase: 'preamble',
  preambleAnswers: null,
  actionStatuses: [],
};

export const useRRTStore = create<RRTStore>()(
  persist(
    (set) => ({
      ...initialState,

      setQuestionSet: (questionSet) => set({ questionSet }),

      setAnswer: (questionId, answer) =>
        set((state) => ({
          answers: {
            ...state.answers,
            [questionId]: answer,
          },
        })),

      addEvidence: (evidence) =>
        set((state) => ({
          evidenceItems: [...state.evidenceItems, evidence],
        })),

      removeEvidence: (evidenceId) =>
        set((state) => ({
          evidenceItems: state.evidenceItems.filter((e) => e.evidence_id !== evidenceId),
        })),

      setCurrentStep: (step) => set({ currentStep: step }),

      setComplete: (complete) => set({ isComplete: complete }),

      setWizardPhase: (phase) => set({ wizardPhase: phase }),

      setPreambleAnswers: (answers) => set({ preambleAnswers: answers }),

      setActionStatuses: (statuses) => set({ actionStatuses: statuses }),

      updateActionStatus: (actionId, status) =>
        set((state) => ({
          actionStatuses: state.actionStatuses.map((a) =>
            a.action_id === actionId
              ? {
                  ...a,
                  status,
                  overridden: true,
                  original_status: a.original_status ?? a.status,
                  derivation_source: 'advisor_override' as const,
                }
              : a
          ),
        })),

      setBulkAnswers: (answers) => set({ answers }),

      reset: () => set(initialState),
    }),
    {
      name: 'rrt-store',
      partialize: (state) => ({
        answers: state.answers,
        evidenceItems: state.evidenceItems,
        questionSet: state.questionSet,
      }),
    }
  )
);
