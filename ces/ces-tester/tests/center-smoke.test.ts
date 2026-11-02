// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * CC-6 — Command Center browser smoke test.
 *
 * Gated behind SMOKE=1 so it stays out of the default `npm test`. Run:
 *   SMOKE=1 npx vitest run tests/center-smoke.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'node:http';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';

const SKIP = !process.env.SMOKE;

let server: http.Server;
let baseUrl: string;
let browser: import('playwright').Browser;
let page: import('playwright').Page;

const projectRoot = path.resolve(import.meta.dirname, '..');

describe.skipIf(SKIP)('Command Center smoke', () => {
  beforeAll(async () => {
    const { startCenterServer } = await import('../src/center/server.js');
    server = await startCenterServer({ port: 0, projectRoot });
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;

    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
  }, 30_000);

  afterAll(async () => {
    if (page) await page.close();
    if (browser) await browser.close();
    if (server) await new Promise<void>((r) => server.close(() => r()));
  });

  it('loads the page and shows the header', async () => {
    await page.goto(baseUrl);
    const h1 = await page.locator('h1').first().textContent({ timeout: 5000 });
    expect(h1).toMatch(/Command Center/i);
  });

  it('catalog API returns entries', async () => {
    const res = await fetch(`${baseUrl}/api/catalog`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ kind: string }>;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(20);

    const kinds = new Set(body.map((r) => r.kind));
    expect(kinds).toContain('scenario');
    expect(kinds).toContain('deck');
    expect(kinds).toContain('act');
    expect(kinds).toContain('pipeline');
  });

  it('finds a known deck and act in the catalog view', async () => {
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const bodyText = await page.locator('#catalog-body').textContent() ?? '';
    expect(bodyText).toContain('ces-overview');
    expect(bodyText).toContain('muster-readiness');
  }, 15_000);

  it('coverage API returns stats', async () => {
    const res = await fetch(`${baseUrl}/api/coverage`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { lastStatusMix: Record<string, { total: number }> };
    expect(body).toHaveProperty('lastStatusMix');
    const total = Object.values(body.lastStatusMix).reduce((s, v) => s + v.total, 0);
    expect(total).toBeGreaterThan(0);
  });

  it('runs API returns an array', async () => {
    const res = await fetch(`${baseUrl}/api/runs`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(Array.isArray(body)).toBe(true);
  });

  it('retire and unretire a runnable via API', async () => {
    const retireRes = await fetch(`${baseUrl}/api/retire/act:stamper`, { method: 'POST' });
    expect(retireRes.status).toBe(200);

    let catRes = await fetch(`${baseUrl}/api/catalog?includeRetired=1`);
    let catalog = (await catRes.json()) as Array<{ id: string; retired: boolean }>;
    let stamper = catalog.find((r) => r.id === 'act:stamper');
    expect(stamper?.retired).toBe(true);

    const unretireRes = await fetch(`${baseUrl}/api/unretire/act:stamper`, { method: 'POST' });
    expect(unretireRes.status).toBe(200);

    catRes = await fetch(`${baseUrl}/api/catalog?includeRetired=1`);
    catalog = (await catRes.json()) as Array<{ id: string; retired: boolean }>;
    stamper = catalog.find((r) => r.id === 'act:stamper');
    expect(stamper?.retired).toBe(false);
  });

  it('port is freed after server close', async () => {
    const addr = server.address() as AddressInfo;
    const port = addr.port;

    await page.close();
    await browser.close();
    await new Promise<void>((r) => server.close(() => r()));

    const probe = http.createServer();
    const free = await new Promise<boolean>((resolve) => {
      probe.once('error', () => resolve(false));
      probe.once('listening', () => {
        probe.close();
        resolve(true);
      });
      probe.listen(port, '127.0.0.1');
    });
    expect(free).toBe(true);

    // Restart for afterAll cleanup
    const { startCenterServer } = await import('../src/center/server.js');
    server = await startCenterServer({ port: 0, projectRoot });
    const newAddr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${newAddr.port}`;

    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
  }, 15_000);
});
