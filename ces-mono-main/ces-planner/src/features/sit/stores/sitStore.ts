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
import type { SITAnswer, SITState } from '../types';

interface SITStore extends SITState {
  // Actions
  setQuestionBank: (questionBank: any) => void;
  setAnswer: (questionId: string, answer: SITAnswer) => void;
  setCurrentStep: (step: number) => void;
  setComplete: (complete: boolean) => void;
  reset: () => void;
}

const initialState: SITState = {
  currentStep: 0,
  answers: {},
  questionBank: null,
  isComplete: false,
};

export const useSITStore = create<SITStore>()(
  persist(
    (set) => ({
      ...initialState,

      setQuestionBank: (questionBank) => set({ questionBank }),

      setAnswer: (questionId, answer) =>
        set((state) => ({
          answers: {
            ...state.answers,
            [questionId]: answer,
          },
        })),

      setCurrentStep: (step) => set({ currentStep: step }),

      setComplete: (complete) => set({ isComplete: complete }),

      reset: () => set(initialState),
    }),
    {
      name: 'sit-store',
    }
  )
);
