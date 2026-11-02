// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import type { LedgerEntry, LedgerQuery } from '../../ledger/LedgerTypes.js';
import { parseFlags } from '../index.js';

export const DEFAULT_STACKSIM_SERVER_URL = 'http://127.0.0.1:4390';

export interface QueryLedgerArgs extends LedgerQuery {
  serverUrl?: string;
}

/**
 * `stacksim query-ledger [--server-url u] [--type create|mutate|read-serve]
 *   [--object-type t] [--id i] [--actor a] [--from ts] [--to ts]`
 */
export async function runQueryLedger(argv: string[]): Promise<LedgerEntry[]> {
  const flags = parseFlags(argv);
  return queryLedger({
    serverUrl: typeof flags['server-url'] === 'string' ? flags['server-url'] : undefined,
    type: typeof flags.type === 'string' ? (flags.type as LedgerQuery['type']) : undefined,
    objectType: typeof flags['object-type'] === 'string' ? flags['object-type'] : undefined,
    id: typeof flags.id === 'string' ? flags.id : undefined,
    actor: typeof flags.actor === 'string' ? (flags.actor as LedgerQuery['actor']) : undefined,
    from: typeof flags.from === 'string' ? flags.from : undefined,
    to: typeof flags.to === 'string' ? flags.to : undefined,
  });
}

/**
 * HTTP client of a running `stacksim serve` process's `/ledger` route
 * (Core Design (f): CLI query commands are HTTP clients only — never a
 * direct ledger.jsonl read).
 */
export async function queryLedger(args: QueryLedgerArgs): Promise<LedgerEntry[]> {
  const base = args.serverUrl ?? DEFAULT_STACKSIM_SERVER_URL;
  const { serverUrl: _serverUrl, ...filter } = args;

  const res = await fetch(`${base}/ledger`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(filter),
  });
  const json = (await res.json()) as { data?: LedgerEntry[]; error?: string };
  if (!res.ok) {
    throw new Error(`stacksim query-ledger: server responded ${res.status}: ${json.error ?? 'unknown error'}`);
  }
  return json.data ?? [];
}
