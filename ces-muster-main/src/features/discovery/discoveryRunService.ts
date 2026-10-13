// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// discoveryRunService.ts — W4-MU2 (MU-02): "Run discovery" runs the real
// executor. The SPA starts a sim discovery job on muster-api
// (POST /api/discovery/run), polls it (GET /api/discovery/run/:id), and feeds
// the returned readiness-result.v1 envelope through the SAME parser the file
// import uses (importReadinessResult) — one downstream seam, no canned rows.
//
// Network-optional by design (musterApi.ts): only the operator's explicit
// "Run discovery" click reaches this; the interview path never does. Failure is
// reported honestly (the offer screen shows it and keeps the file import) —
// there is no fixture fallback.
import { api } from '@/shared/api/musterApi';
import type { DiscoveryResult } from '@/shared/types/discovery';
import type { InterviewFact } from '@/shared/types/engagement';
import {
  discoveryResultsFromPayload,
  factsFromPayload,
  consentsFromPayload,
  parseReadinessResultFile,
} from './importReadinessResult';
import type { ReadinessConsent } from '@/shared/types/readinessResult';

export const DISCOVERY_POLL_INTERVAL_MS = 2_000;
/** A full-registry sim walk measured ~90s; allow generous headroom. */
export const DISCOVERY_MAX_WAIT_MS = 6 * 60_000;

type RunStatus =
  | { status: 'running' }
  | { status: 'done'; envelope: unknown; stats?: unknown; postures?: { met: number; unknown: number; not_met: number } }
  | { status: 'failed'; code?: string; error?: string };

export type DiscoveryRunOutcome =
  | {
      ok: true;
      results: DiscoveryResult[];
      facts: InterviewFact[];
      /** FC-MU-3: live consents recorded in the envelope (empty on a sim run). */
      consents: ReadinessConsent[];
      postures?: { met: number; unknown: number; not_met: number };
    }
  | { ok: false; message: string };

export interface DiscoveryRunOptions {
  tenantSlug?: string;
  pollIntervalMs?: number;
  maxWaitMs?: number;
  /** Test seam for the wait between polls. */
  sleep?: (ms: number) => Promise<void>;
}

function failureText(status: number, error?: string): string {
  if (status === 0) return 'muster-api is not reachable (not running, blocked, or timed out)';
  if (status === 401) return 'muster-api rejected the request: sign in to muster-api first';
  if (status === 403) return 'this role cannot run discovery (operator or prime only)';
  return error ? `muster-api returned ${status}: ${error}` : `muster-api returned ${status}`;
}

export async function runDiscoveryOnApi(opts: DiscoveryRunOptions = {}): Promise<DiscoveryRunOutcome> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const interval = opts.pollIntervalMs ?? DISCOVERY_POLL_INTERVAL_MS;
  const maxWait = opts.maxWaitMs ?? DISCOVERY_MAX_WAIT_MS;

  const start = await api.post<{ job_id: string }>(
    '/discovery/run',
    opts.tenantSlug ? { tenant_slug: opts.tenantSlug } : {}
  );
  if (!start.ok) return { ok: false, message: failureText(start.status, start.error) };
  const jobId = start.data.job_id;

  let waited = 0;
  for (;;) {
    const poll = await api.get<RunStatus>(`/discovery/run/${encodeURIComponent(jobId)}`);
    if (!poll.ok) return { ok: false, message: failureText(poll.status, poll.error) };
    const s = poll.data;
    if (s.status === 'failed') {
      return { ok: false, message: s.error ?? 'discovery run failed' };
    }
    if (s.status === 'done') {
      try {
        const payload = parseReadinessResultFile(JSON.stringify(s.envelope));
        return {
          ok: true,
          results: discoveryResultsFromPayload(payload),
          facts: factsFromPayload(payload),
          consents: consentsFromPayload(payload),
          postures: s.postures,
        };
      } catch (e) {
        return { ok: false, message: `discovery result did not parse: ${e instanceof Error ? e.message : String(e)}` };
      }
    }
    if (waited >= maxWait) return { ok: false, message: 'discovery run did not finish in time' };
    await sleep(interval);
    waited += interval;
  }
}
