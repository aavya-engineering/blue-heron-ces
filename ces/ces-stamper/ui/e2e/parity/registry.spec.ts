// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// PC-13 Registry editor, PLAN §5: same reads and saves; routes GET /api/registry/:type,
// PUT /api/registry/:type/:entryId, POST /api/registry/resolve (the legacy page never calls
// GET /api/registry/:type/:entryId). Legacy page: /registry-editor.html?tenant=…&type=…; SPA:
// /app/registry?tenant=…&type=…. Saves and resolves are mocked (nothing written to the registry
// JSON, no tenant queried); one test reads the real m365 registry on both consoles.
// Watchable (PLAN §8b): headed and paced unless CES_UI_HEADLESS=1; video and trace on.

import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';
import { caption, compareRecordings, recordApiRequests, writeRecording } from './harness';
import type { ParityProject } from './selectors';
import { FIXTURE_REGISTRY, FIXTURE_TENANT, mockApi } from './spa3-fixtures';
import type { MockedCall } from './spa3-fixtures';


const T = FIXTURE_TENANT;
const projectOf = (name: string): ParityProject => (name === 'legacy' ? 'legacy' : 'react');
const PC13_ROUTES = ['/api/registry/m365', '/api/registry/infra', '/api/registry/resolve', ...FIXTURE_REGISTRY.map((e) => `/api/registry/m365/${e.entry_id}`)];

const urlFor = (project: ParityProject, tenant: string, type = 'm365') =>
  project === 'legacy'
    ? `/registry-editor.html?tenant=${encodeURIComponent(tenant)}&type=${type}`
    : `/app/registry?tenant=${encodeURIComponent(tenant)}&type=${type}`;

const SAVE = { legacy: 'button[onclick="saveRegistryEntry()"]', react: '#regSaveBtn' } as const;

async function mockRegistry(page: Page): Promise<MockedCall[]> {
  return mockApi(page, {
    'GET /api/registry/m365': { body: { entries: FIXTURE_REGISTRY } },
    'GET /api/registry/infra': { body: { entries: [] } },
    'POST /api/registry/resolve': (call) => {
      const command = String((call.body as { command?: string }).command ?? '');
      return { body: { resolved: command.replace(/\{domain\}/g, 'ridgeline.example'), unresolved: command.includes('{tenantId}') ? ['tenantId'] : [] } };
    },
    'PUT /api/registry/m365/ac-ca-baseline': (call) => ({ body: { success: true, entry: call.body } }),
  });
}

async function openRegistry(page: Page, project: ParityProject, tenant = T): Promise<void> {
  const loaded = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/registry/m365');
  await page.goto(urlFor(project, tenant));
  await loaded;
  await expect(page.locator('#registryEntryCounter')).not.toHaveText('Entry 0 of 0');
  await caption(page, `PC-13 (${project}): registry editor, m365`);
}

test.describe('PC-13 registry editor', () => {
  test('reads, navigates, searches, checks variables, resolves and saves', async ({ page }, testInfo) => {
    const project = projectOf(testInfo.project.name);
    const calls = await mockRegistry(page);
    await openRegistry(page, project);
    await expect(page.locator('#registryEntryCounter')).toHaveText('Entry 1 of 2');
    await expect(page.locator('#reg_entry_id')).toHaveValue('ac-ca-baseline');
    await expect(page.locator('#varStatusText')).toHaveText('All vars OK');
    await expect(page.locator('#regPrevBtn')).toBeDisabled();

    await page.locator('#regNextBtn').click();
    await expect(page.locator('#registryEntryCounter')).toHaveText('Entry 2 of 2');
    await expect(page.locator('#reg_entry_id')).toHaveValue('au-unified-audit');
    await page.locator('#regPrevBtn').click();

    await caption(page, `PC-13 (${project}): search "au-"`);
    await page.locator('#searchInput').fill('au-');
    await expect(page.locator('#searchResultsCount')).toHaveText('1 of 2');
    await expect(page.locator('#reg_entry_id')).toHaveValue('au-unified-audit');
    await page.locator('#searchInput').fill('');
    await expect(page.locator('#reg_entry_id')).toHaveValue('ac-ca-baseline');

    await caption(page, `PC-13 (${project}): resolve GET`);
    await page.locator('button', { hasText: 'Resolve GET' }).click();
    await expect(page.locator('#registryResolveBox')).toContainText('# GET Command (Resolved)');
    await expect(page.locator('#registryResolveBox')).toContainText('Get-MgPolicy -Domain ridgeline.example');

    await caption(page, `PC-13 (${project}): edit label and save`);
    await page.locator('#reg_label').fill('Conditional Access baseline v2');
    await page.locator(SAVE[project]).click();
    await expect(page.locator('#toast')).toContainText('Entry saved successfully');
    await expect(page.locator('#registryEntryCounter')).toHaveText('Entry 1 of 2');
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.path).toBe('/api/registry/m365/ac-ca-baseline');
    expect(put.body).toMatchObject({ entry_id: 'ac-ca-baseline', label: 'Conditional Access baseline v2' });
  });

  test('dev: no variable check', async ({ page }, testInfo) => {
    const project = projectOf(testInfo.project.name);
    await mockRegistry(page);
    const rec = recordApiRequests(page);
    await openRegistry(page, project, 'dev');
    await page.waitForTimeout(500);
    rec.stop();
    expect(rec.requests.filter((r) => r.path === '/api/registry/resolve')).toEqual([]);
    await expect(page.locator('#varStatusIndicator')).toBeHidden();
  });

  test('parity: same ordered requests and the same save body (AD-4)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'react', 'records both consoles; runs once');
    const calls = await mockRegistry(page);
    const recs: Record<string, ReturnType<typeof recordApiRequests>> = {};
    const saves: Record<string, unknown> = {};
    for (const project of ['legacy', 'react'] as const) {
      recs[project] = recordApiRequests(page);
      await openRegistry(page, project);
      await expect(page.locator('#varStatusText')).toHaveText('All vars OK');
      await page.locator('#regNextBtn').click();
      await expect(page.locator('#varStatusText')).toHaveText('All vars OK');
      await page.locator('#regPrevBtn').click();
      await page.locator('button', { hasText: 'Resolve SET' }).click();
      await expect(page.locator('#registryResolveBox')).toContainText('# SET Command (Resolved)');
      // Notes starts collapsed on both consoles (legacy class `collapsed`, kit `hidden` body).
      await page.locator('#regSecNotes .registry-section-header').click();
      await page.locator('#reg_notes').fill('Reviewed by the fixture operator.');
      await page.locator(SAVE[project]).click();
      await expect(page.locator('#toast')).toContainText('Entry saved successfully');
      await page.locator('#regToggleInfra').click();
      await expect(page.locator('#registryEntryCounter')).toContainText('of 0');
      recs[project]!.stop();
      saves[project] = calls.filter((c) => c.method === 'PUT').at(-1)?.body;
    }
    writeRecording(testInfo.outputPath('parity-registry-legacy.json'), recs.legacy!.requests);
    writeRecording(testInfo.outputPath('parity-registry-react.json'), recs.react!.requests);
    const result = compareRecordings(recs.legacy!.requests, recs.react!.requests, { routes: PC13_ROUTES });
    testInfo.annotations.push({ type: 'parity', description: JSON.stringify(result) });
    expect(result.differences).toEqual([]);
    expect(saves.react).toEqual(saves.legacy);
  });

  test('real m365 registry: both consoles read the same entry count and first entry', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'react', 'drives both consoles; runs once');
    const seen: Record<string, string[]> = {};
    for (const project of ['legacy', 'react'] as const) {
      await openRegistry(page, project, 'dev');
      seen[project] = [await page.locator('#registryEntryCounter').innerText(), await page.locator('#reg_entry_id').inputValue()];
    }
    testInfo.annotations.push({ type: 'registry', description: JSON.stringify(seen) });
    expect(seen.react).toEqual(seen.legacy);
  });
});
