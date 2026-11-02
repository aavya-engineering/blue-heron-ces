// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// PC-12 Unified variables, PLAN §5 (routes as corrected in LOG-W8-SPA3): same saves and
// resolutions. Legacy page: /unified-variables.html?tenant=…; SPA: /app/variables?tenant=….
// The `dev` tenant opens the empty state with no request, so the outcome tests use the fictional
// tenant `ridgeline-fixture`, fully mocked: nothing is written to disk and no tenant is queried.
// Watchable (PLAN §8b): headed and paced unless CES_UI_HEADLESS=1; video and trace on.

import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';
import { caption, compareRecordings, recordApiRequests, writeRecording } from './harness';
import type { ParityProject } from './selectors';
import { FIXTURE_CONFIG, FIXTURE_CONFIG_PATH, FIXTURE_TENANT, FIXTURE_VARIABLES, mockApi } from './spa3-fixtures';
import type { MockedCall } from './spa3-fixtures';


const T = FIXTURE_TENANT;
const projectOf = (name: string): ParityProject => (name === 'legacy' ? 'legacy' : 'react');

const PC12_ROUTES = [
  '/api/resolvable-variables',
  `/api/tenants/${T}`,
  '/api/tenants',
  '/api/tenants-browse',
  '/api/browse-file',
  `/api/tenants/${T}/variables`,
  '/api/resolve-variable',
  '/api/resolve-all-variables',
  '/api/file-to-base64',
];

const urlFor = (project: ParityProject, tenant: string) =>
  project === 'legacy' ? `/unified-variables.html?tenant=${encodeURIComponent(tenant)}` : `/app/variables?tenant=${encodeURIComponent(tenant)}`;

async function mockTenant(page: Page): Promise<MockedCall[]> {
  return mockApi(page, {
    'GET /api/resolvable-variables': { body: { ok: true, variables: ['kvName', 'lawName'] } },
    [`GET /api/tenants/${T}`]: { body: { ok: true, slug: T, path: FIXTURE_CONFIG_PATH, config: FIXTURE_CONFIG } },
    [`PUT /api/tenants/${T}`]: { body: { ok: true, slug: T, path: FIXTURE_CONFIG_PATH } },
    // Legacy renders the Variables tab with whatever resolvable names it has at that moment;
    // the delay keeps the resolvable list first, as on a real server.
    [`GET /api/tenants/${T}/variables`]: { body: { ok: true, variables: FIXTURE_VARIABLES }, delay: 300 },
    [`PUT /api/tenants/${T}/variables`]: (call) => ({ body: { ok: true, variables: (call.body as { variables: unknown }).variables } }),
    'POST /api/resolve-variable': { body: { ok: true, resolved: { kvName: 'kv-ridgeline' } } },
    'POST /api/resolve-all-variables': { body: { ok: true, resolved: { kvName: 'kv-ridgeline' }, ambiguous: {}, notFound: [] } },
  });
}

async function openVariables(page: Page, project: ParityProject): Promise<void> {
  const loaded = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/tenants/${T}/variables`);
  await page.goto(urlFor(project, T));
  await loaded;
  await expect(page.locator('#pathHint')).toHaveText(FIXTURE_CONFIG_PATH);
  await caption(page, `PC-12 (${project}): unified variables for ${T}`);
}

const kvRow = (page: Page) => page.locator('.var-row:has(input[data-var="kvName"])');

test.describe('PC-12 unified variables', () => {
  test('dev: empty state, no request', async ({ page }, testInfo) => {
    const project = projectOf(testInfo.project.name);
    const rec = recordApiRequests(page);
    await page.goto(urlFor(project, 'dev'));
    await expect(page.locator('#emptyState')).toBeVisible();
    await page.waitForTimeout(500);
    rec.stop();
    expect(rec.requests.filter((r) => PC12_ROUTES.includes(r.path) || r.path.startsWith('/api/tenants'))).toEqual([]);
  });

  test('load, edit config, save; resolve a variable, save variables', async ({ page }, testInfo) => {
    const project = projectOf(testInfo.project.name);
    const calls = await mockTenant(page);
    await openVariables(page, project);
    await expect(page.locator('#tenantName')).toHaveText(T);
    await expect(page.locator('[data-path="client.name"]')).toHaveValue('Ridgeline Machining');
    await expect(page.locator('#configSaveBtn')).toBeDisabled();

    await caption(page, `PC-12 (${project}): edit client.name and save`);
    await page.locator('[data-path="client.name"]').fill('Ridgeline Machining West');
    await expect(page.locator('#configSaveBtn')).toBeEnabled();
    await page.locator('#configSaveBtn').click();
    await expect(page.locator('#toast')).toContainText('Config saved');
    const putConfig = calls.find((c) => c.method === 'PUT' && c.path === `/api/tenants/${T}`)!;
    const savedConfig = JSON.parse((putConfig.body as { json: string }).json) as typeof FIXTURE_CONFIG;
    expect(savedConfig.client.name).toBe('Ridgeline Machining West');

    await caption(page, `PC-12 (${project}): resolve kvName, save variables`);
    await page.locator('[data-tab="variables"]').click();
    await kvRow(page).locator('.var-check-btn').click();
    await expect(page.locator('input[data-var="kvName"]')).toHaveValue('kv-ridgeline');
    await expect(page.locator('#toast')).toContainText('Resolved kvName');
    await page.locator('#variablesSaveBtn').click();
    await expect(page.locator('#toast')).toContainText('Variables saved');
    const putVars = calls.find((c) => c.method === 'PUT' && c.path === `/api/tenants/${T}/variables`)!;
    expect(putVars.body).toEqual({ variables: { domain: 'ridgeline.example', kvName: 'kv-ridgeline', retentionDays: 90 } });
  });

  test('parity: same ordered requests and the same save bodies (AD-4)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'react', 'records both consoles; runs once');
    const calls = await mockTenant(page);
    const recs: Record<string, ReturnType<typeof recordApiRequests>> = {};
    const bodies: Record<string, unknown[]> = {};
    for (const project of ['legacy', 'react'] as const) {
      const start = calls.length;
      recs[project] = recordApiRequests(page);
      await openVariables(page, project);
      await page.locator('[data-path="client.name"]').fill('Ridgeline Machining West');
      await page.locator('#configSaveBtn').click();
      await expect(page.locator('#toast')).toContainText('Config saved');
      await page.locator('[data-tab="variables"]').click();
      await kvRow(page).locator('.var-check-btn').click();
      await expect(page.locator('input[data-var="kvName"]')).toHaveValue('kv-ridgeline');
      await page.locator('input[data-var="kvName"]').fill('');
      await page.locator('#resolveAllBtn').click();
      await expect(page.locator('input[data-var="kvName"]')).toHaveValue('kv-ridgeline');
      await page.locator('#variablesSaveBtn').click();
      await expect(page.locator('#toast')).toContainText('Variables saved');
      await page.waitForTimeout(500); // the config reloads that follow each resolve
      recs[project]!.stop();
      bodies[project] = calls
        .slice(start)
        .filter((c) => c.method !== 'GET')
        .map((c) => ({ method: c.method, path: c.path, body: c.body }));
    }
    writeRecording(testInfo.outputPath('parity-variables-legacy.json'), recs.legacy!.requests);
    writeRecording(testInfo.outputPath('parity-variables-react.json'), recs.react!.requests);
    // Legacy issues the three load requests without waiting, so compare their set, then the rest in order.
    const inScope = (r: typeof recs.legacy) => r!.requests.filter((x) => PC12_ROUTES.includes(x.path));
    const result = compareRecordings(inScope(recs.legacy).slice(3), inScope(recs.react).slice(3), { routes: PC12_ROUTES });
    const loadSet = (r: typeof recs.legacy) => inScope(r).slice(0, 3).map((x) => x.path).sort();
    testInfo.annotations.push({ type: 'parity', description: JSON.stringify(result) });
    expect(loadSet(recs.react)).toEqual(loadSet(recs.legacy));
    expect(result.differences).toEqual([]);
    expect(bodies.react).toEqual(bodies.legacy);
  });
});
