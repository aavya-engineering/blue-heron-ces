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
import type { BTCAnswer, BTCState, Runlist } from '../types';
import type { BTCEvidenceRef } from '@/shared/types/artifacts';

interface BTCStore extends BTCState {
  setCurrentRunlistIndex: (index: number) => void;
  setAnswer: (questionId: string, answer: BTCAnswer) => void;
  addEvidence: (evidence: BTCEvidenceRef) => void;
  removeEvidence: (evidenceId: string) => void;
  setRunlist: (runlist: Runlist) => void;
  setComplete: (complete: boolean) => void;
  reset: () => void;
}

const initialState: BTCState = {
  currentRunlistIndex: 0,
  answers: {},
  evidenceItems: [],
  runlist: null,
  isComplete: false,
};

export const useBTCStore = create<BTCStore>()(
  persist(
    (set) => ({
      ...initialState,

      setCurrentRunlistIndex: (index) => set({ currentRunlistIndex: index }),

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

      setRunlist: (runlist) => set({ runlist }),

      setComplete: (complete) => set({ isComplete: complete }),

      reset: () => set(initialState),
    }),
    {
      name: STORAGE_KEYS.BTC_STORE,
      partialize: (state) => ({
        answers: state.answers,
        evidenceItems: state.evidenceItems,
        runlist: state.runlist,
      }),
    }
  )
);
