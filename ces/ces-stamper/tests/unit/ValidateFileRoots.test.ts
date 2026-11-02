// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import express from 'express';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('/api/validate-file canonical roots (N-5)', () => {
  let app: express.Express;
  let server: http.Server;
  let port: number;
  let tmpRoot: string;
  let origEnv: string | undefined;

  beforeAll(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-file-'));
    origEnv = process.env.CES_PIPELINE_ROOT;
    process.env.CES_PIPELINE_ROOT = tmpRoot;

    const tenantDir = path.join(tmpRoot, 'Stamper', 'plan-data', 'dev', 'plans');
    fs.mkdirSync(tenantDir, { recursive: true });
    fs.writeFileSync(path.join(tenantDir, 'test-plan.json'), '{"ok":true}');

    const { createUtilityRouter } = await import('../../src/server/routes/utility.routes.js');
    app = express();
    app.use(createUtilityRouter({} as any));
    server = app.listen(0);
    port = (server.address() as any).port;
  });

  afterAll(() => {
    server?.close();
    if (origEnv !== undefined) process.env.CES_PIPELINE_ROOT = origEnv;
    else delete process.env.CES_PIPELINE_ROOT;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function get(queryPath: string): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
      const url = `http://127.0.0.1:${port}/api/validate-file?path=${encodeURIComponent(queryPath)}`;
      http.get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode!, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode!, body: data });
          }
        });
      }).on('error', reject);
    });
  }

  it('accepts a file under CES_PIPELINE_ROOT', async () => {
    const filePath = path.join(tmpRoot, 'Stamper', 'plan-data', 'dev', 'plans', 'test-plan.json');
    const result = await get(filePath);
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    expect(result.body.exists).toBe(true);
  });

  it('rejects a path outside allowed roots', async () => {
    const result = await get('/etc/passwd');
    expect(result.status).toBe(403);
    expect(result.body.error).toMatch(/outside allowed/i);
  });

  it('rejects path traversal with ..', async () => {
    const traversal = tmpRoot + '/Stamper/../../etc/passwd';
    const result = await get(traversal);
    expect(result.status).toBe(403);
    expect(result.body.error).toMatch(/traversal/i);
  });
});
