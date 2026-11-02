// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import express from 'express';
import http from 'http';

// Set CES_PIPELINE_ROOT before any ces-shared imports resolve the default
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-browse-'));
process.env.CES_PIPELINE_ROOT = tmpRoot;

import { createUtilityRouter } from '../../src/server/routes/utility.routes';

function fetch_(url: string): Promise<{ status: number; json: () => Promise<any> }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () =>
        resolve({
          status: res.statusCode!,
          json: () => Promise.resolve(JSON.parse(body)),
        })
      );
    }).on('error', reject);
  });
}

describe('GET /api/browse — Muster filename separator parity (MS-R5)', () => {
  let server: http.Server;
  let baseUrl: string;
  const tenantSlug = 'test-sep';

  beforeAll(async () => {
    const plansDir = path.join(tmpRoot, 'Stamper', 'plan-data', tenantSlug, 'plans');
    fs.mkdirSync(plansDir, { recursive: true });

    // Write files with both separators
    fs.writeFileSync(
      path.join(plansDir, 'manual-mission-plan-2026-03-28T18-56-36-979Z.json'),
      JSON.stringify({ ces: { version: '1.0' }, source: 'legacy' })
    );
    fs.writeFileSync(
      path.join(plansDir, 'manual-mission-plan_test-sep_2026-09-26T12-00-00-000Z.json'),
      JSON.stringify({ ces: { version: '1.0' }, source: 'muster' })
    );
    fs.writeFileSync(
      path.join(plansDir, 'tenant-manifest_test-sep_2026-09-26T12-00-00-000Z.json'),
      JSON.stringify({ ces: { version: '1.0' } })
    );
    fs.writeFileSync(
      path.join(plansDir, 'infra-manifest_test-sep_2026-09-26T12-00-00-000Z.json'),
      JSON.stringify({ ces: { version: '1.0' } })
    );

    const app = express();
    app.use(createUtilityRouter());
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(() => {
    server?.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('finds Muster underscore-separated mission plan via pattern query', async () => {
    const res = await fetch_(`${baseUrl}/api/browse?tenant=${tenantSlug}&pattern=manual-mission-plan`);
    const body = await res.json();
    expect(body.ok).toBe(true);
    const names = body.files.map((f: any) => f.name);
    expect(names).toContain('manual-mission-plan_test-sep_2026-09-26T12-00-00-000Z.json');
    expect(names).toContain('manual-mission-plan-2026-03-28T18-56-36-979Z.json');
  });

  it('finds Muster underscore-separated tenant manifest via pattern query', async () => {
    const res = await fetch_(`${baseUrl}/api/browse?tenant=${tenantSlug}&pattern=tenant-manifest`);
    const body = await res.json();
    expect(body.ok).toBe(true);
    const names = body.files.map((f: any) => f.name);
    expect(names).toContain('tenant-manifest_test-sep_2026-09-26T12-00-00-000Z.json');
  });

  it('auto-discovery returns Muster underscore-separated files', async () => {
    const res = await fetch_(`${baseUrl}/api/plan-data-paths?tenant=${tenantSlug}`);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.missionPlan).toBeTruthy();
    expect(body.manifest).toBeTruthy();
    expect(body.infraManifest).toBeTruthy();
  });
});
