// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

import { resolve } from './http.js';

export interface ReadyCheckOptions {
  serverUrl: string;
  /** A cheap /resolve query for a known-seeded object (e.g. caPolicies collection). */
  method: string;
  uri: string;
  maxAttempts?: number;
  intervalMs?: number;
}

export class ReadyCheckExhaustedError extends Error {
  constructor(uri: string, attempts: number) {
    super(`stacksim ready-check: "${uri}" still empty after ${attempts} attempts — hard failure, not a silent pass`);
    this.name = 'ReadyCheckExhaustedError';
  }
}

function isNonEmpty(data: unknown): boolean {
  if (data === null || data === undefined) return false;
  if (Array.isArray(data)) return data.length > 0;
  if (typeof data === 'object') {
    const record = data as Record<string, unknown>;
    if ('value' in record && Array.isArray(record.value)) return record.value.length > 0;
    return Object.keys(record).length > 0;
  }
  return true;
}

/**
 * PLAN.md M1 task 3: after `scenario` returns (a direct-write path pre-S1's
 * single-writer-server unification) and before any HTTP read, poll a cheap
 * /resolve query for a known-seeded object until non-empty or a bounded
 * retry budget (default 10 attempts / 5s total) is exhausted. Exhaustion is
 * a hard failure, not a silent pass-through to the assertion step.
 */
export async function waitUntilReady(opts: ReadyCheckOptions): Promise<void> {
  const maxAttempts = opts.maxAttempts ?? 10;
  const intervalMs = opts.intervalMs ?? 500;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const data = await resolve(opts.serverUrl, { kind: 'uri', method: opts.method, uri: opts.uri });
      if (isNonEmpty(data)) {
        return;
      }
    } catch {
      // Server may not be fully up yet on early attempts — treat as not-ready, keep polling.
    }
    if (attempt < maxAttempts) {
      await sleep(intervalMs);
    }
  }

  throw new ReadyCheckExhaustedError(opts.uri, maxAttempts);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
