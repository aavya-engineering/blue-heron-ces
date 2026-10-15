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
import { STORAGE_KEYS } from '@/shared/config';
import type { CUIAnswer, CUIState } from '../types';

interface CUIStore extends CUIState {
  setCurrentSectionIndex: (index: number) => void;
  setCurrentQuestionIndex: (index: number) => void;
  setAnswer: (questionId: string, answer: CUIAnswer) => void;
  setSectionComplete: (sectionId: string, complete: boolean) => void;
  setComplete: (complete: boolean) => void;
  reset: () => void;
}

const initialState: CUIState = {
  currentSectionIndex: 0,
  currentQuestionIndex: 0,
  answers: {},
  sectionCompletionMap: {},
  isComplete: false,
};

export const useCUIStore = create<CUIStore>()(
  persist(
    (set) => ({
      ...initialState,

      setCurrentSectionIndex: (index) => set({ currentSectionIndex: index, currentQuestionIndex: 0 }),

      setCurrentQuestionIndex: (index) => set({ currentQuestionIndex: index }),

      setAnswer: (questionId, answer) =>
        set((state) => ({
          answers: {
            ...state.answers,
            [questionId]: answer,
          },
        })),

      setSectionComplete: (sectionId, complete) =>
        set((state) => ({
          sectionCompletionMap: {
            ...state.sectionCompletionMap,
            [sectionId]: complete,
          },
        })),

      setComplete: (complete) => set({ isComplete: complete }),

      reset: () => set(initialState),
    }),
    {
      name: STORAGE_KEYS.CUI_STORE,
    }
  )
);
