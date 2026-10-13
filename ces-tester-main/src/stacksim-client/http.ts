// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

import type { LedgerEntry, LedgerQuery, ResolveRequestBody } from './types.js';

export const DEFAULT_STACKSIM_SERVER_URL = 'http://127.0.0.1:4390';

/** `POST /resolve` against a running `stacksim serve` instance (PLAN.md Interface Contract). */
export async function resolve(serverUrl: string, body: ResolveRequestBody): Promise<unknown> {
  const res = await fetch(`${serverUrl}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { data?: unknown; error?: string };
  if (!res.ok) {
    throw new Error(`stacksim /resolve: server responded ${res.status}: ${json.error ?? 'unknown error'}`);
  }
  return json.data;
}

/** `POST /ledger` against a running `stacksim serve` instance (PLAN.md Interface Contract). */
export async function queryLedger(serverUrl: string, filter: LedgerQuery = {}): Promise<LedgerEntry[]> {
  const res = await fetch(`${serverUrl}/ledger`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(filter),
  });
  const json = (await res.json()) as { data?: LedgerEntry[]; error?: string };
  if (!res.ok) {
    throw new Error(`stacksim /ledger: server responded ${res.status}: ${json.error ?? 'unknown error'}`);
  }
  return json.data ?? [];
}
