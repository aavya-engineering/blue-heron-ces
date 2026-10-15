// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useState, useEffect } from 'react';
import { dbHelpers } from '../db/schema';
import { makeCesTuple } from '../identity/cesTuple';
import { useAppStore } from '../stores/appStore';
import { checkConsistency, type ConsistencyIssue } from '../services/consistencyChecker';

export function useConsistencyCheck(
  baselineId: number | null,
  cuiBoundaryId: number | null,
  btcConfirmationId: number | null,
  postureId?: number | null,
) {
  const [issues, setIssues] = useState<ConsistencyIssue[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      // Need at least a baseline and one other artifact to compare
      if (!baselineId || (!cuiBoundaryId && !btcConfirmationId)) {
        setIssues([]);
        return;
      }

      setLoading(true);
      try {
        // Scope reads to the active customer + baseline (G1/ADR-001 ownership).
        const customerId = useAppStore.getState().currentCustomerId;
        const tuple = customerId ? makeCesTuple(customerId, baselineId) : undefined;
        const [baseline, cuiBoundary, btcConfirmation, posture] = await Promise.all([
          dbHelpers.getBaselineById(baselineId, tuple),
          cuiBoundaryId ? dbHelpers.getCUIBoundaryById(cuiBoundaryId, tuple) : Promise.resolve(null),
          btcConfirmationId ? dbHelpers.getBTCById(btcConfirmationId, tuple) : Promise.resolve(null),
          postureId ? dbHelpers.getPostureById(postureId, tuple) : Promise.resolve(null),
        ]);

        if (cancelled) return;

        const result = checkConsistency({
          siBaseline: baseline?.data ?? null,
          cuiBoundary: cuiBoundary?.data ?? null,
          btcConfirmation: btcConfirmation?.data ?? null,
          readinessPosture: posture?.data ?? null,
        });
        setIssues(result);
      } catch {
        // Gracefully degrade — no consistency issues if load fails
        setIssues([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [baselineId, cuiBoundaryId, btcConfirmationId, postureId]);

  return { issues, loading };
}
