// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Shared by the W8-SPA3 parity specs (PC-10 to PC-13): fictional fixtures (Ridgeline Machining),
// an API mock that answers the same way for both consoles (so outcomes are comparable and no
// save reaches disk or a tenant), and the legacy console's dev-tenant setup. `import type` only
// from Playwright.

import type { Page, Route } from '@playwright/test';

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
            { entryId: 'ac-least-priv-roles', label: 'Privileged role review', engine: 'mgraph', evidenceFile: 'mgraph/ac-least-priv-roles.txt', evidenceExists: false, fileInfo: null },
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
            { entryId: 'au-unified-audit', label: 'Unified audit log', engine: 'exchange', evidenceFile: 'exchange/au-unified-audit.txt', evidenceExists: false, fileInfo: null },
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
  outcomeRationale: 'Baseline policy found.',
  registryEntry: { entry_id: 'ac-ca-baseline', label: 'Conditional Access baseline', engine: 'mgraph', control_ids: ['AC.L2-3.1.1'] },
  metadata: { commandExecuted: 'Get-MgIdentityConditionalAccessPolicy', controlIds: ['AC.L2-3.1.1'], executorIdentity: 'operator@ridgeline.example' },
  rawResponse: { value: [{ displayName: 'Ridgeline baseline' }] },
};

export const FIXTURE_EVIDENCE_REPLY = {
  entryId: 'ac-ca-baseline',
  file: 'mgraph/ac-ca-baseline.txt',
  fullPath: 'C:\\fixture\\evidence\\mgraph\\ac-ca-baseline.txt',
  sizeBytes: 2048,
  modifiedAt: '2026-10-29T10:00:00.000Z',
  isJson: true,
  content: '{}',
  structured: FIXTURE_EVIDENCE,
};

export const FIXTURE_CONFIG_PATH = 'C:\\fixture\\tenants\\ridgeline-fixture.json';

export const FIXTURE_CONFIG = {
  client: { slug: FIXTURE_TENANT, name: 'Ridgeline Machining' },
  tenant: { tenant_id: '00000000-0000-4000-8000-000000000001', domain: 'ridgeline.example' },
  auth: { app_id: '00000000-0000-4000-8000-000000000002' },
};

export const FIXTURE_VARIABLES = { domain: 'ridgeline.example', kvName: '', retentionDays: 90 };

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

export interface MockedCall {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
}

export interface MockReply {
  status?: number;
  body: unknown;
  /** Delay before answering (ms). */
  delay?: number;
}

export type MockHandler = MockReply | ((call: MockedCall) => MockReply);

/**
 * Answers `METHOD /path` from `handlers` and lets every other /api request through to the real
 * server. Returns the list of answered calls (with parsed bodies) for "same saves" comparisons.
 */
export async function mockApi(page: Page, handlers: Record<string, MockHandler>): Promise<MockedCall[]> {
  const calls: MockedCall[] = [];
  await page.route('**/api/**', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const key = `${request.method()} ${url.pathname}`;
    const handler = handlers[key];
    if (!handler) {
      await route.continue();
      return;
    }
    let body: unknown;
    try {
      body = request.postData() ? (JSON.parse(request.postData()!) as unknown) : undefined;
    } catch {
      body = request.postData();
    }
    const call: MockedCall = { method: request.method(), path: url.pathname, query: Object.fromEntries(url.searchParams.entries()), body };
    calls.push(call);
    const reply = typeof handler === 'function' ? handler(call) : handler;
    if (reply.delay) await new Promise((r) => setTimeout(r, reply.delay));
    await route.fulfill({ status: reply.status ?? 200, contentType: 'application/json', body: JSON.stringify(reply.body) });
  });
  return calls;
}

/** Legacy console on the dev fixture tenant (PLAN §5: parity runs on `dev`). */
export async function openLegacyOnDev(page: Page): Promise<void> {
  const tenants = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/tenants');
  await page.goto('/');
  await tenants;
  await page.waitForLoadState('load');
  if ((await page.locator('#tenantSelect').inputValue()) !== 'dev') await page.selectOption('#tenantSelect', 'dev');
}

/** Opens legacy card 5 if it is collapsed (toggleCard). */
export async function expandLegacyEvidenceCard(page: Page): Promise<void> {
  const card = page.locator('#workflowCard5');
  if (await card.evaluate((el) => el.classList.contains('card-collapsed'))) {
    await card.locator('.workflow-card-header').click();
  }
}
