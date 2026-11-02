// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * W7-EO (1) / V68: GET /api/assess always ends its event stream with a terminal event (assess_done or
 * assess_error), including when the tenant's session fails during the signal fetch (run 61b's E7B shape)
 * and when a later phase throws. Drives the real assessment router over HTTP with real stores in a temp
 * storage root; no blob account, no Graph (the session is a fake that fails). Sim only.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { closeAllCesRepositories } from 'ces-shared/persistence/node';
import { createAssessmentRouter } from '../../../src/eo/server/routers/assessment-router';
import { AssessmentStore } from '../../../src/eo/assessment/AssessmentStore';
import { PoamStore } from '../../../src/eo/poam/PoamStore';
import { PoamLedgerStore } from '../../../src/eo/poam/PoamLedgerStore';
import { PolicyStore } from '../../../src/eo/policies/PolicyStore';
import { PersonnelStore } from '../../../src/eo/personnel/PersonnelStore';
import { TrainingStore } from '../../../src/eo/personnel/TrainingStore';
import { ScreeningElementStore } from '../../../src/eo/personnel/ScreeningElementStore';

jest.mock('../../../src/eo/rendering/RenderOrchestrator', () => ({
  RenderOrchestrator: class { setAdminOpsData() {} async orchestrateRenders() { return new Map(); } },
}));

const SLUG = 'w7-eo-terminal';
const GUID = '00000000-0000-4000-8000-0000000007e0';
const REGISTRY = path.resolve(__dirname, '../../../../ces-stamper/src/registry/cmmc-l2-commands.registry.json');
const TERMINAL = new Set(['assess_done', 'assess_error']);

describe('W7-EO: /api/assess ends with a terminal event', () => {
  let tmp: string;
  let server: Server;
  let base: string;
  let mode: 'session-dies' | 'policy-store-throws' = 'session-dies';
  const prevPipeline = process.env.CES_PIPELINE_ROOT;
  const prevTenantRoot = process.env.CES_TENANT_ROOT;

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'w7-eo-terminal-'));
    process.env.CES_PIPELINE_ROOT = path.join(tmp, 'pipeline');
    process.env.CES_TENANT_ROOT = path.join(tmp, 'empty-registry');
    fs.mkdirSync(process.env.CES_PIPELINE_ROOT, { recursive: true });
    const stamperRoot = path.join(tmp, 'stamper');
    const dir = path.join(stamperRoot, 'plan-data', SLUG);
    fs.mkdirSync(dir, { recursive: true });
    const cfgPath = path.join(dir, `${SLUG}.json`);
    fs.writeFileSync(cfgPath, JSON.stringify({
      tenant: { tenant_id: GUID, domain: `${SLUG}.example.test` },
      client: { name: SLUG },
      auth: { app_id: '00000000-0000-4000-8000-000000000000', cert_path: 'sim.pfx', cert_thumbprint: 'SIM' },
    }));
    const storageRoot = path.join(tmp, 'eo-storage');
    fs.mkdirSync(storageRoot, { recursive: true });
    const policyStore = new PolicyStore(storageRoot);
    const realLoad = policyStore.load.bind(policyStore);
    policyStore.load = ((slug: string) => {
      if (mode === 'policy-store-throws') throw new Error('policy store unavailable');
      return realLoad(slug);
    }) as typeof policyStore.load;
    // A session bound to this tenant whose PowerShell host is gone: ensureConnected fails as after a failed respawn.
    const deadSession = {
      boundTenantSlug: SLUG, boundTenantId: GUID,
      ensureConnected: async () => { throw new Error('[SessionFactory] Process for "graph" died (code 1) during command execution'); },
    };
    const config = { storageRoot, tenantSlug: SLUG, tenantConfigPath: cfgPath, registryPath: REGISTRY } as any;
    const app = express();
    app.use(createAssessmentRouter({
      config, stamperRoot, getSessionManager: () => deadSession as any,
      assessmentStore: new AssessmentStore(storageRoot), poamStore: new PoamStore(storageRoot), poamLedgerStore: new PoamLedgerStore(storageRoot),
      policyStore, personnelStore: new PersonnelStore(storageRoot),
      screeningElementStore: new ScreeningElementStore(storageRoot), trainingStore: new TrainingStore(storageRoot),
    }));
    server = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    closeAllCesRepositories();
    fs.rmSync(tmp, { recursive: true, force: true });
    if (prevPipeline === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = prevPipeline;
    if (prevTenantRoot === undefined) delete process.env.CES_TENANT_ROOT; else process.env.CES_TENANT_ROOT = prevTenantRoot;
  });

  async function assess(): Promise<any[]> {
    const r = await fetch(`${base}/api/assess?tenant=${SLUG}`);
    expect(r.status).toBe(200);
    const text = await r.text(); // a cut stream rejects here ("TypeError: terminated")
    return text.split('\n\n').filter(f => f.startsWith('data: ')).map(f => JSON.parse(f.slice(6)));
  }

  it('the session dies during the signal fetch: signal_fetch_error, then the stream ends with assess_done', async () => {
    mode = 'session-dies';
    const events = await assess();
    expect(events.find(e => e.type === 'signal_fetch_error')?.message).toMatch(/died/);
    expect(events[events.length - 1].type).toBe('assess_done');
    expect(events.filter(e => TERMINAL.has(e.type))).toHaveLength(1);
  });

  it('a later phase throws: the stream ends with exactly one assess_error', async () => {
    mode = 'policy-store-throws';
    const events = await assess();
    expect(events[events.length - 1]).toMatchObject({ type: 'assess_error', error: 'policy store unavailable' });
    expect(events.filter(e => TERMINAL.has(e.type))).toHaveLength(1);
  });
});
