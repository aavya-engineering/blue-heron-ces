// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-30: AoServer's static mount of the kit SPA at /app/ (createAoUiRouter), against a temp build:
// /app/ and extensionless routes serve index.html with no-cache; assets are static; /app redirects
// to /app/; without a build /app/ is a 404 and nothing else changes. Through createApp(): the legacy
// page still answers at /, and /app/ is open like the legacy page (the bearer gate covers /api/* only,
// ces-shared createBearerAuthMiddleware), while the API it calls still needs the token.

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { AoServer, AO_SPA_BASE_PATH, AO_SPA_DIR, createAoUiRouter } from '../src/server/AoServer.js';

let tmpRoot: string;
let saved: { pl?: string; tn?: string };
let server: Server | undefined;

async function serve(app: express.Express): Promise<string> {
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-fin30-'));
  saved = { pl: process.env.CES_PIPELINE_ROOT, tn: process.env.CES_TENANT_ROOT };
  process.env.CES_PIPELINE_ROOT = path.join(tmpRoot, 'pl');
  process.env.CES_TENANT_ROOT = path.join(tmpRoot, 'tenants');
  const dist = path.join(tmpRoot, 'dist');
  fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>CES AdminOps</title><div id="root"></div>');
  fs.writeFileSync(path.join(dist, 'assets', 'index-abc.js'), 'console.log(1);');
});

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

afterAll(() => {
  if (saved.pl === undefined) delete process.env.CES_PIPELINE_ROOT;
  else process.env.CES_PIPELINE_ROOT = saved.pl;
  if (saved.tn === undefined) delete process.env.CES_TENANT_ROOT;
  else process.env.CES_TENANT_ROOT = saved.tn;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('FIN-30: SPA mount at /app/', () => {
  it('serves the build from ces-ao/ui/dist at /app/', () => {
    expect(AO_SPA_BASE_PATH).toBe('/app/');
    expect(AO_SPA_DIR.split(path.sep).slice(-2)).toEqual(['ui', 'dist']);
  });

  it('serves index.html for /app/ and extensionless routes (no-cache), and assets as files', async () => {
    const app = express();
    app.use(createAoUiRouter(path.join(tmpRoot, 'dist')));
    const base = await serve(app);

    for (const p of ['/app/', '/app/commands', '/app/a/b']) {
      const r = await fetch(base + p);
      expect(r.status, p).toBe(200);
      expect(await r.text()).toContain('CES AdminOps');
      expect(r.headers.get('cache-control')).toContain('no-store');
    }
    const asset = await fetch(base + '/app/assets/index-abc.js');
    expect(asset.status).toBe(200);
    expect(await asset.text()).toBe('console.log(1);');
    const missing = await fetch(base + '/app/assets/nope.js');
    expect(missing.status).toBe(404);
    const bare = await fetch(base + '/app', { redirect: 'manual' });
    expect(bare.status).toBe(302);
    expect(bare.headers.get('location')).toBe('/app/');
  });

  it('without a build, /app/ falls through to 404', async () => {
    const app = express();
    app.use(createAoUiRouter(path.join(tmpRoot, 'no-build')));
    const base = await serve(app);
    expect((await fetch(base + '/app/')).status).toBe(404);
  });

  it('through createApp(): the legacy page stays at /; /app/ is open like it, and /api/* keeps the bearer gate', async () => {
    const base = await serve(AoServer.createApp({ CES_AO_AUTH_TOKEN: 'fin30-token' } as NodeJS.ProcessEnv));
    const legacy = await fetch(base + '/', { headers: { authorization: 'Bearer fin30-token' } });
    expect(legacy.status).toBe(200);
    expect(await legacy.text()).toContain('AdminOps');
    // No build in the checkout: 404; after `vite build`: 200. Never 401: pages are open, data is gated.
    expect([200, 404]).toContain((await fetch(base + '/app/')).status);
    expect((await fetch(base + '/api/commands')).status).toBe(401);
    expect((await fetch(base + '/api/commands', { headers: { authorization: 'Bearer fin30-token' } })).status).toBe(200);
  });
});
