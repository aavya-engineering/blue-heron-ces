// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// Non-component exports: context object, hook, and shared interface.
// Lives in a .ts file (not .tsx) so the react-refresh/only-export-components
// rule does not flag these alongside the TimingProvider component.
import { createContext, useContext } from 'react';
import type { TimingSegment, TimingSegmentName } from '@/shared/types/engagement';

export interface TimingContextValue {
  segments: TimingSegment[];
  startSegment: (name: TimingSegmentName) => void;
  stopSegment: (name: TimingSegmentName) => void;
  totalBudgetHours: 2;
}

const defaultValue: TimingContextValue = {
  segments: [],
  startSegment: () => {},
  stopSegment: () => {},
  totalBudgetHours: 2,
};

export const TimingContext = createContext<TimingContextValue>(defaultValue);

export function useTimingContext(): TimingContextValue {
  return useContext(TimingContext);
}
