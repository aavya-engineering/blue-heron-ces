// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W8-SPA0: /health read-only `ui` and `simulator` fields; the AD-3 switch (legacy at /, SPA at /app/).

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

import {
  createHealthRouter,
  createStamperUiRouter,
  describeSimulator,
  describeUi,
  resolveStamperUiMode,
  StamperUiMode,
} from '../../src/server/routes/health.routes';

interface Reply { status: number; headers: http.IncomingHttpHeaders; body: string }

function get(url: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: buf }));
      })
      .on('error', reject);
  });
}

async function listen(app: express.Express): Promise<{ server: http.Server; base: string }> {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

function close(server: http.Server): Promise<void> {
  return new Promise((r) => server.close(() => r()));
}

/** The GuiServer order: UI router, then static, then health. */
function guiLikeApp(publicDir: string, mode: StamperUiMode, env: NodeJS.ProcessEnv): express.Express {
  const app = express();
  app.use(createStamperUiRouter(publicDir, mode));
  app.use(express.static(publicDir));
  app.use(createHealthRouter(null, null, null, () => 'not_checked', () => describeUi(publicDir, mode), env));
  return app;
}

describe('W8-SPA0 switch helpers', () => {
  it('resolveStamperUiMode defaults to legacy; only "react" selects the SPA', () => {
    expect(resolveStamperUiMode({})).toBe('legacy');
    expect(resolveStamperUiMode({ CES_STAMPER_UI: 'legacy' })).toBe('legacy');
    expect(resolveStamperUiMode({ CES_STAMPER_UI: 'react' })).toBe('react');
    expect(resolveStamperUiMode({ CES_STAMPER_UI: 'React' })).toBe('legacy');
  });

  it('describeSimulator reads STACKSIM_SERVER_URL from the launch environment', () => {
    expect(describeSimulator({})).toEqual({ active: false, serverUrl: null });
    expect(describeSimulator({ STACKSIM_SERVER_URL: 'http://127.0.0.1:4390' })).toEqual({
      active: true,
      serverUrl: 'http://127.0.0.1:4390',
    });
  });
});

describe('W8-SPA0 GuiServer mount (UI router + static + health)', () => {
  let tmp: string;

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-w8-spa0-'));
    fs.writeFileSync(path.join(tmp, 'index.html'), '<!doctype html><title>legacy</title>');
    fs.mkdirSync(path.join(tmp, 'app', 'assets'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'app', 'index.html'), '<!doctype html><title>spa</title>');
    fs.writeFileSync(path.join(tmp, 'app', 'assets', 'main.js'), 'export const ok = 1;');
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('legacy (default): / is the legacy page; /app/ and deep links serve the SPA; assets stay static', async () => {
    const { server, base } = await listen(guiLikeApp(tmp, 'legacy', {}));
    try {
      const root = await get(`${base}/`);
      expect(root.status).toBe(200);
      expect(root.body).toContain('legacy');

      const spa = await get(`${base}/app/`);
      expect(spa.status).toBe(200);
      expect(spa.body).toContain('spa');
      expect(spa.headers['cache-control']).toBe('no-cache, no-store, must-revalidate');

      const deep = await get(`${base}/app/translate`);
      expect(deep.status).toBe(200);
      expect(deep.body).toContain('spa');

      const asset = await get(`${base}/app/assets/main.js`);
      expect(asset.status).toBe(200);
      expect(asset.body).toBe('export const ok = 1;');

      const missingAsset = await get(`${base}/app/assets/missing.js`);
      expect(missingAsset.status).toBe(404);

      const bare = await get(`${base}/app`);
      expect(bare.status).toBe(301);
      expect(bare.headers.location).toBe('/app/');
    } finally {
      await close(server);
    }
  });

  it('react: / redirects to /app/; the legacy page file stays reachable by name', async () => {
    const { server, base } = await listen(guiLikeApp(tmp, 'react', {}));
    try {
      const root = await get(`${base}/`);
      expect(root.status).toBe(302);
      expect(root.headers.location).toBe('/app/');

      const legacyFile = await get(`${base}/index.html`);
      expect(legacyFile.status).toBe(200);
      expect(legacyFile.body).toContain('legacy');
    } finally {
      await close(server);
    }
  });

  it('SPA not built: /app/ routes fall through to 404 and /health says spaBuilt false', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-w8-spa0-empty-'));
    const { server, base } = await listen(guiLikeApp(empty, 'legacy', {}));
    try {
      expect((await get(`${base}/app/tenant`)).status).toBe(404);
      const health = JSON.parse((await get(`${base}/health`)).body);
      expect(health.ui).toEqual({ mode: 'legacy', spaPath: '/app/', spaBuilt: false });
    } finally {
      await close(server);
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it('/health keeps its fields and adds read-only ui and simulator', async () => {
    const env = { STACKSIM_SERVER_URL: 'http://127.0.0.1:4390' };
    const { server, base } = await listen(guiLikeApp(tmp, 'react', env));
    try {
      const reply = await get(`${base}/health`);
      expect(reply.status).toBe(200);
      const health = JSON.parse(reply.body);
      expect(Object.keys(health)).toEqual([
        'status',
        'registries',
        'evidenceCollector',
        'ui',
        'simulator',
        'timestamp',
      ]);
      expect(health.status).toBe('ok');
      expect(health.registries).toEqual({ m365: false, infra: false, merged: false });
      expect(health.evidenceCollector).toEqual({ autostart: 'not_checked' });
      expect(health.ui).toEqual({ mode: 'react', spaPath: '/app/', spaBuilt: true });
      expect(health.simulator).toEqual({ active: true, serverUrl: 'http://127.0.0.1:4390' });
    } finally {
      await close(server);
    }
  });

  it('createHealthRouter without the new arguments still answers (old call shape)', async () => {
    const app = express();
    app.use(createHealthRouter(null, null, null));
    const { server, base } = await listen(app);
    try {
      const health = JSON.parse((await get(`${base}/health`)).body);
      expect(health.evidenceCollector).toEqual({ autostart: 'not_checked' });
      expect(health.ui.spaPath).toBe('/app/');
      expect(typeof health.simulator.active).toBe('boolean');
    } finally {
      await close(server);
    }
  });
});
