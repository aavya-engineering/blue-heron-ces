// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Test-only transport for the W8-SPA3 unit tests: answers by "METHOD /path" and records each call
// (method, path, query, parsed body) in order. Fixture data is fictional (Ridgeline Machining).

import { setFetcher } from '../api';
import type { Fetcher } from '../api';

export interface MockCall {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
}

export type MockAnswer = { status?: number; body: unknown } | ((call: MockCall) => { status?: number; body: unknown });

export interface MockApi {
  calls: MockCall[];
  /** "METHOD /path" signatures in call order. */
  signatures: () => string[];
  restore: () => void;
}

export function mockApi(routes: Record<string, MockAnswer>): MockApi {
  const calls: MockCall[] = [];
  const previous: Fetcher = setFetcher(async (input, init) => {
    const url = new URL(input, 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    const call: MockCall = { method, path: url.pathname, query: Object.fromEntries(url.searchParams.entries()), body };
    calls.push(call);
    const answer = routes[`${method} ${url.pathname}`] ?? { status: 404, body: { ok: false, error: `no mock for ${method} ${url.pathname}` } };
    const { status = 200, body: replyBody } = typeof answer === 'function' ? answer(call) : answer;
    return new Response(JSON.stringify(replyBody), { status });
  });
  return {
    calls,
    signatures: () => calls.map((c) => `${c.method} ${c.path}`),
    restore: () => {
      setFetcher(previous);
    },
  };
}

export const FIXTURE_TENANT = 'ridgeline-fixture';

export const FIXTURE_SCAN = {
  summary: { totalControls: 3, controlsWithEvidence: 1, coveragePct: 33, totalEntries: 3, entriesWithEvidence: 1 },
  families: [
    {
      abbreviation: 'AC',
      name: 'Access Control',
      controlCount: 2,
      controlsWithEvidence: 1,
      controls: [
        {
          controlId: 'AC.L2-3.1.5',
          practice: 'Employ the principle of least privilege.',
          hasEvidence: false,
          allCovered: false,
          entries: [
            {
              entryId: 'ac-least-priv-roles',
              label: 'Privileged role review',
              engine: 'mgraph',
              evidenceFile: 'mgraph/ac-least-priv-roles.txt',
              evidenceExists: false,
              fileInfo: null,
            },
          ],
        },
        {
          controlId: 'AC.L2-3.1.1',
          practice: 'Limit system access to authorized users.',
          hasEvidence: true,
          allCovered: true,
          entries: [
            {
              entryId: 'ac-ca-baseline',
              label: 'Conditional Access baseline',
              engine: 'mgraph',
              evidenceFile: 'mgraph/ac-ca-baseline.txt',
              evidenceExists: true,
              fileInfo: { sizeBytes: 2048, modifiedAt: '2026-10-29T10:00:00.000Z', ageHours: 2.4 },
            },
          ],
        },
      ],
    },
    {
      abbreviation: 'AU',
      name: 'Audit and Accountability',
      controlCount: 1,
      controlsWithEvidence: 0,
      controls: [
        {
          controlId: 'AU.L2-3.3.1',
          practice: 'Create and retain system audit logs.',
          hasEvidence: false,
          allCovered: false,
          entries: [
            {
              entryId: 'au-unified-audit',
              label: 'Unified audit log',
              engine: 'exchange',
              evidenceFile: 'exchange/au-unified-audit.txt',
              evidenceExists: false,
              fileInfo: null,
            },
          ],
        },
      ],
    },
  ],
  evidenceDir: 'C:\\fixture\\evidence',
};

export const FIXTURE_EVIDENCE = {
  complianceVerdict: 'SAT',
  verdictRationale: 'Policy present and enforced.',
  outcome: 'success',
  registryEntry: { entry_id: 'ac-ca-baseline', label: 'Conditional Access baseline', engine: 'mgraph', control_ids: ['AC.L2-3.1.1'] },
  metadata: { commandExecuted: 'Get-MgIdentityConditionalAccessPolicy', controlIds: ['AC.L2-3.1.1'], executorIdentity: 'operator@ridgeline.example' },
  rawResponse: { value: [{ displayName: 'Ridgeline baseline' }] },
};

export const FIXTURE_CONFIG = {
  client: { slug: FIXTURE_TENANT, name: 'Ridgeline Machining' },
  tenant: { tenant_id: '00000000-0000-4000-8000-000000000001', domain: 'ridgeline.example' },
  auth: { app_id: '00000000-0000-4000-8000-000000000002' },
};

export const FIXTURE_VARIABLES = {
  domain: 'ridgeline.example',
  kvName: '',
  retentionDays: 90,
  _internal: 'hidden',
};

export const FIXTURE_REGISTRY = [
  {
    entry_id: 'ac-ca-baseline',
    control_ids: ['AC.L2-3.1.1'],
    label: 'Conditional Access baseline',
    engine: 'mgraph',
    get_command: 'Get-MgPolicy -Domain {domain}',
    set_command: 'Set-MgPolicy -Domain {domain}',
    idempotency: 'get-then-set',
    on_failure: 'abort_step',
  },
  {
    entry_id: 'au-unified-audit',
    control_ids: ['AU.L2-3.3.1'],
    label: 'Unified audit log',
    engine: 'exchange',
    get_command: 'Get-AdminAuditLogConfig',
    idempotency: 'get-then-set',
    on_failure: 'warn_continue',
  },
];
