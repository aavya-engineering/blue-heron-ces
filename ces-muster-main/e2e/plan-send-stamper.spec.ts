// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// FX-MU1 + FX-MU4: the Plan tab's "Send to Stamper" button calls muster-api's
// POST /api/plan/push with the generated plan. Offline: the route is
// intercepted in the browser (page.route) — nothing leaves the machine, no
// muster-api needed. The judged fact is the captured request body.
import { test, expect } from '@playwright/test';
import { fillProfileAndBegin, answerAllAndFinish } from './helpers';

test('plan-send-stamper: generate → Send to Stamper → push request carries the generated plan', async ({
  page,
}) => {
  let captured: { url: string; auth: string | null; body: Record<string, unknown> } | null = null;
  await page.route('**/api/plan/push', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') {
      await route.fulfill({ status: 204 });
      return;
    }
    captured = {
      url: req.url(),
      auth: req.headers()['authorization'] ?? null,
      body: req.postDataJSON() as Record<string, unknown>,
    };
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        pushed: ['manual-mission-plan-e2e-2026-09-27T00-00-00-000Z.json', 'tenant-manifest-e2e-2026-09-27T00-00-00-000Z.json'],
        plansDir: 'intercepted',
      }),
    });
  });

  // FX-MU4: no injected token — the operator signs in on the Plan tab and the
  // intercepted POST /auth/login returns the token the push must then carry.
  let loginBody: Record<string, unknown> | null = null;
  await page.route('**/auth/login', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') {
      await route.fulfill({ status: 204 });
      return;
    }
    loginBody = req.postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ token: 'e2e-token' }),
    });
  });

  await page.goto('/');
  await fillProfileAndBegin(page, { kind: 'individual_contractor', name: 'Plan Push Co' });
  await answerAllAndFinish(page, 'no');

  await page.getByTestId('nav-tab-plan').click();
  await page.getByTestId('plan-generate-btn').click();
  await expect(page.getByTestId('plan-doc-list')).toBeVisible({ timeout: 15000 });

  expect(await page.evaluate(() => localStorage.getItem('muster-jwt'))).toBeNull();
  await page.getByTestId('muster-signin-email').fill('operator@muster.test');
  await page.getByTestId('muster-signin-password').fill('e2e-password');
  await page.getByTestId('muster-signin-btn').click();
  await expect(page.getByTestId('muster-signin-state')).toContainText('Signed in');
  expect(loginBody).toEqual({ email: 'operator@muster.test', password: 'e2e-password' });

  await page.getByTestId('plan-send-stamper-btn').click();
  await expect(page.getByTestId('plan-send-stamper-success')).toContainText('manual-mission-plan-e2e-');

  expect(captured).not.toBeNull();
  const c = captured!;
  expect(c.url).toMatch(/\/api\/plan\/push$/);
  expect(c.auth).toBe('Bearer e2e-token');
  expect(typeof c.body.tenant_slug).toBe('string');
  const mp = c.body.missionPlan as { ces?: unknown; outputs?: { human_readable_mission_plan?: { control_directives?: unknown[] } } };
  expect(mp.ces).toBeTruthy();
  expect(mp.outputs?.human_readable_mission_plan?.control_directives?.length ?? 0).toBeGreaterThan(0);
  expect(c.body.tenantManifest).toBeTruthy();

  // Download fallback is still offered.
  await expect(page.getByTestId('plan-download-mission-plan')).toBeVisible();
});
