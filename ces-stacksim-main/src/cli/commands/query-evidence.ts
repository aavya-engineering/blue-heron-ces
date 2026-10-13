// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import type { EvidenceQueryFilter } from '../../evidence/EvidenceQuery.js';
import type { EvidenceSnapshot } from '../../evidence/EvidenceHold.js';
import { parseFlags } from '../index.js';
import { DEFAULT_STACKSIM_SERVER_URL } from './query-ledger.js';

export interface QueryEvidenceArgs extends EvidenceQueryFilter {
  serverUrl?: string;
}

/** `stacksim query-evidence [--server-url u] [--object-type t] [--from ts] [--to ts]` */
export async function runQueryEvidence(argv: string[]): Promise<EvidenceSnapshot[]> {
  const flags = parseFlags(argv);
  return queryEvidence({
    serverUrl: typeof flags['server-url'] === 'string' ? flags['server-url'] : undefined,
    objectType: typeof flags['object-type'] === 'string' ? flags['object-type'] : undefined,
    from: typeof flags.from === 'string' ? flags.from : undefined,
    to: typeof flags.to === 'string' ? flags.to : undefined,
  });
}

/**
 * HTTP client of a running `stacksim serve` process's `/evidence` route
 * (Core Design (f): CLI query commands are HTTP clients only — never a
 * direct evidence/*.json or ledger.jsonl read).
 */
export async function queryEvidence(args: QueryEvidenceArgs): Promise<EvidenceSnapshot[]> {
  const base = args.serverUrl ?? DEFAULT_STACKSIM_SERVER_URL;
  const { serverUrl: _serverUrl, ...filter } = args;

  const res = await fetch(`${base}/evidence`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(filter),
  });
  const json = (await res.json()) as { data?: EvidenceSnapshot[]; error?: string };
  if (!res.ok) {
    throw new Error(`stacksim query-evidence: server responded ${res.status}: ${json.error ?? 'unknown error'}`);
  }
  return json.data ?? [];
}
