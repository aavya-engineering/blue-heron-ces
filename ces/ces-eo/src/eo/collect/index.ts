// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/** EO-collection W2.0: the collector frame and the registered audit-family collectors. */
import type { CollectRunResult } from './CollectorRunner.js';

export * from './Collector.js';
export * from './collectors.js';
export * from './securityCollectors.js';
export * from './adminOpsCollector.js';
export * from './CollectorRunner.js';
export * from './views.js';

/** The JSON answer of `POST /api/collect` and the E7 hook's console line: no rows, counts only. */
export function summarizeCollectRun(run: CollectRunResult): {
  tenantId: string;
  recorded: number;
  collectors: Array<{ planId: string; sourceId: string; status: string; windows: number; newItems: number; records: number; lastEventTime: string | null; lastWindowEnd: string | null; error?: string }>;
  errors: CollectRunResult['errors'];
} {
  return {
    tenantId: run.tenantId,
    recorded: run.recorded,
    collectors: run.results.map((r) => ({
      planId: r.planId,
      sourceId: r.sourceId,
      status: r.status,
      windows: r.windows.length,
      newItems: r.newItems,
      records: r.records.length,
      lastEventTime: r.watermarkAfter?.lastEventTime ?? null,
      lastWindowEnd: r.watermarkAfter?.lastWindowEnd ?? null,
      ...(r.error ? { error: r.error } : {}),
    })),
    errors: run.errors,
  };
}
