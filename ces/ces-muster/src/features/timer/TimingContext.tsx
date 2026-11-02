// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// TimingProvider is the only React component export from this file.
// Context object, hook, and interface live in timingCore.ts to satisfy the
// react-refresh/only-export-components lint rule.
import { useState, useCallback, type ReactNode } from 'react';
import type { TimingSegment, TimingSegmentName } from '@/shared/types/engagement';
import { TimingContext, type TimingContextValue } from './timingCore';

export function TimingProvider({ children }: { children: ReactNode }) {
  const [segments, setSegments] = useState<TimingSegment[]>([]);

  const startSegment = useCallback((name: TimingSegmentName) => {
    const now = new Date().toISOString();
    setSegments((prev) => {
      if (prev.some((s) => s.segment === name && !s.stopped_at)) return prev;
      return [...prev, { segment: name, started_at: now }];
    });
  }, []);

  const stopSegment = useCallback((name: TimingSegmentName) => {
    const now = new Date().toISOString();
    setSegments((prev) =>
      prev.map((s) => {
        if (s.segment !== name || s.stopped_at) return s;
        const duration_ms = new Date(now).getTime() - new Date(s.started_at).getTime();
        return { ...s, stopped_at: now, duration_ms };
      })
    );
  }, []);

  const value: TimingContextValue = {
    segments,
    startSegment,
    stopSegment,
    totalBudgetHours: 2,
  };

  return <TimingContext.Provider value={value}>{children}</TimingContext.Provider>;
}
