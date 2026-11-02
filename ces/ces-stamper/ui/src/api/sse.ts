// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Server-sent event (SSE) routes. Each builder returns the stream URL with the query keys the
// route handler reads; screens pass it to the kit's useEventStream (legacy behaviour: one stream
// per URL, JSON `message` events, closed on error and not retried).

import { useEventStream } from 'ces-ui-kit';
import type { EventStream, UseEventStreamOptions } from 'ces-ui-kit';
import { buildUrl } from './http';

export interface AssessStreamQuery {
  tenant: string;
  verbose?: boolean;
  uploadToBlob?: boolean;
  planFile?: string;
}

export interface ExecuteStreamQuery {
  plan: string;
  mode?: string;
  dryRun?: boolean;
  tenant?: string;
  verbose?: boolean;
  uploadToBlob?: boolean;
  evidencePopout?: boolean;
  retry?: string;
}

export const stamperStreams = {
  // connect.routes.ts
  connect: (tenant: string) => buildUrl('/api/connect', { tenant }),
  installPrereq: (module: string) => buildUrl('/api/prereqs/install', { module }),
  // baseline.routes.ts
  baseline: (tenant: string, posture: string) => buildUrl('/api/baseline', { tenant, posture }),
  // execute.routes.ts
  preflight: (tenant: string) => buildUrl('/api/preflight', { tenant }),
  execute: (query: ExecuteStreamQuery) => buildUrl('/api/execute', { ...query }),
  // assess.routes.ts
  assess: (query: AssessStreamQuery) => buildUrl('/api/assess', { ...query }),
} as const;

/** The kit's SSE hook, re-exported so screens import streams from one place. */
export function useStamperStream<T = unknown>(url: string | null, options: UseEventStreamOptions<T>): EventStream {
  return useEventStream<T>(url, options);
}
