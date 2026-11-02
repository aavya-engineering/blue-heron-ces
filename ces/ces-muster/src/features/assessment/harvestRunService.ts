// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// harvestRunService.ts — W4-MU2 (MU-06): close the Graph-harvest prefill seam.
// Until now the SPA read localStorage 'muster-harvest-facts' on interview mount
// but nothing ever wrote it, and nothing called /api/harvest. This client asks
// muster-api to run the harvest probes against the local stacksim Graph
// (POST /api/harvest/run { sim: true } — the route pins the localhost base),
// then writes the store the prefill already reads.
//
// Network-optional by design (musterApi.ts): only the operator's explicit click
// reaches this. A failed probe yields no fact (absence, never 'no'); a failed
// run writes nothing.
import { api } from '@/shared/api/musterApi';
import { storeHarvestFacts } from './assessmentHelpers';

export const HARVEST_TIMEOUT_MS = 30_000;

export type HarvestRunOutcome = { ok: true; stored: number } | { ok: false; message: string };

export async function runSimHarvest(): Promise<HarvestRunOutcome> {
  const res = await api.post<{ facts: unknown[] }>('/harvest/run', { sim: true }, HARVEST_TIMEOUT_MS);
  if (!res.ok) {
    if (res.status === 0) return { ok: false, message: 'muster-api is not reachable (not running, blocked, or timed out)' };
    if (res.status === 401) return { ok: false, message: 'sign in to muster-api first' };
    if (res.status === 403) return { ok: false, message: 'this role cannot run the harvest (operator or prime only)' };
    return { ok: false, message: res.error ? `muster-api returned ${res.status}: ${res.error}` : `muster-api returned ${res.status}` };
  }
  const facts = Array.isArray(res.data?.facts) ? res.data.facts : [];
  return { ok: true, stored: storeHarvestFacts(facts) };
}
