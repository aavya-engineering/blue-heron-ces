// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

// PH9-TS: the console-run readiness probes (V124 EO behind its token, V125 muster-api with no `/` route), Stamper's
// TENANT_ID from the sim registry record (V85, FIN-14), and the muster-partial remote-maintenance MFA expectation (V23).
// The probe tests bind one local server on a random port (port 0); nothing else is spawned.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import { waitForHttpOk, ANY_HTTP_ANSWER } from '../src/demo/gui-servers.js';
import { writeSyntheticStamperEnv, SYNTHETIC_TENANT_ID } from '../src/stamper-launcher/synthetic-env.js';
import { stamperTenantIdOf } from '../src/flow/muster-e2e-run.js';

const TOKEN = 'ph9-ts-run-token';
let server: http.Server;
let base = '';

beforeAll(async () => {
  // /health: 401 without the bearer token, 200 with it (EO's PH-7 gate). Anything else: 404 (muster-api's handler).
  server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.statusCode = req.headers.authorization === `Bearer ${TOKEN}` ? 200 : 401;
    } else {
      res.statusCode = 404;
    }
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe('waitForHttpOk options (V124 / V125)', () => {
  it('default: a 401 is not ready (the R-F6 EO failure)', async () => {
    await expect(waitForHttpOk(`${base}/health`, 300, 50)).rejects.toThrow(/never became ready/);
  });
  it('with the bearer header, the gated route is ready', async () => {
    await expect(waitForHttpOk(`${base}/health`, 2000, 50, { headers: { Authorization: `Bearer ${TOKEN}` } })).resolves.toBeUndefined();
  });
  it('default: a 404 is not ready (the R-F6 muster-api failure)', async () => {
    await expect(waitForHttpOk(`${base}/`, 300, 50)).rejects.toThrow(/never became ready/);
  });
  it('ANY_HTTP_ANSWER: a 404 means the server is up', async () => {
    await expect(waitForHttpOk(`${base}/`, 2000, 50, { ready: ANY_HTTP_ANSWER })).resolves.toBeUndefined();
  });
  it('ANY_HTTP_ANSWER still times out when nothing listens', async () => {
    const closed = http.createServer();
    await new Promise<void>((r) => closed.listen(0, '127.0.0.1', () => r()));
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((r) => closed.close(() => r()));
    await expect(waitForHttpOk(`http://127.0.0.1:${port}/`, 300, 50, { ready: ANY_HTTP_ANSWER })).rejects.toThrow(/never became ready/);
  });
});

describe('Stamper TENANT_ID = EO tenant id (V85, FIN-14)', () => {
  const tmp = fs.mkdtempSync(path.join(process.env.CES_PIPELINE_ROOT ? path.dirname(process.env.CES_PIPELINE_ROOT) : os.tmpdir(), 'ph9-ts-'));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('reads tenant.tenant_id from the registry record', () => {
    const rec = path.join(tmp, 's1-mach.json');
    fs.writeFileSync(rec, JSON.stringify({ kind: 'sim', tenant: { tenant_id: 'sim-tenant-s1-mach' } }));
    expect(stamperTenantIdOf(rec)).toBe('sim-tenant-s1-mach');
  });
  it('undefined for a missing record or one without a tenant id', () => {
    expect(stamperTenantIdOf(path.join(tmp, 'absent.json'))).toBeUndefined();
    const rec = path.join(tmp, 'no-id.json');
    fs.writeFileSync(rec, JSON.stringify({ kind: 'sim', tenant: {} }));
    expect(stamperTenantIdOf(rec)).toBeUndefined();
  });
  it('the synthetic env carries the given tenant id', async () => {
    const f = await writeSyntheticStamperEnv(path.join(tmp, 'a'), { storageRoot: path.join(tmp, 'st'), tenantId: 'sim-tenant-s1-mach' });
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    expect(lines).toContain('TENANT_ID=sim-tenant-s1-mach');
    expect(lines.filter((l) => l.startsWith('TENANT_ID='))).toHaveLength(1);
  });
  it('the synthetic env keeps the all-zero placeholder when none is given', async () => {
    const f = await writeSyntheticStamperEnv(path.join(tmp, 'b'), { storageRoot: path.join(tmp, 'st') });
    expect(fs.readFileSync(f, 'utf8').split('\n')).toContain(`TENANT_ID=${SYNTHETIC_TENANT_ID}`);
    expect(SYNTHETIC_TENANT_ID).toBe('00000000-0000-0000-0000-000000000000');
  });
});

describe('muster-partial remote-maintenance MFA expectation (V23)', () => {
  it('expects the CES policy enabled, as the MA.L2-3.7.5.remote-mfa SET writes it', () => {
    const sc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'scenarios', 'muster', 'muster-partial-e2e.json'), 'utf8'));
    const all = JSON.stringify(sc);
    expect(all).not.toContain('enabledForReportingButNotEnforced');
    const find = (o: unknown): Record<string, unknown> | null => {
      if (!o || typeof o !== 'object') return null;
      const r = o as Record<string, unknown>;
      if ((r.select as { equals?: string } | undefined)?.equals === 'CMMC-RemoteMaintenance-MFA') return r;
      for (const v of Object.values(r)) { const hit = find(v); if (hit) return hit; }
      return null;
    };
    const check = find(sc);
    expect(check).not.toBeNull();
    expect(check!.path).toBe('state');
    expect(check!.value).toBe('enabled');
  });
});
