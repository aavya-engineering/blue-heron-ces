// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// W4-MU2 (MU-06) acceptance: the Graph-harvest prefill seam is closed, sim only.
//
// 1. Hermetic: POST /api/harvest/run { sim: true } sends every probe to the
//    localhost stacksim Graph base — even when the request carries an
//    access_token and GRAPH_BASE_URL points elsewhere — and 503s when the sim
//    is down.
// 2. Live stacksim (self-booting, infra-gated): the SPA's production client
//    (runSimHarvest) against the production app writes the store the
//    interview's mount-time prefill reads (loadHarvestFacts), and every fact's
//    answer equals what the sim's Graph REST actually returns — not canned.
import 'fake-indexeddb/auto';
import { describe, test, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';
import * as path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import express from 'express';
import { createHarvestRouter, SIM_GRAPH_BASE } from '../src/routes/harvest.js';
import { createApp } from '../src/app.js';
import { mintToken } from '../src/lib/jwt.js';
import { SIM_URL, simAvailable } from '../src/services/liveSimSession.js';
import { runSimHarvest } from '@/features/assessment/harvestRunService';
import { loadHarvestFacts, applyHarvestFacts } from '@/features/assessment/assessmentHelpers';

const OPERATOR = mintToken({ sub: 'op', tenant_id: 't-1', party_id: null, role: 'bhd_operator' });

const store = new Map<string, string>();
beforeAll(() => {
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  store.set('muster-jwt', OPERATOR);
});
afterAll(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

function listen(app: express.Express): { server: http.Server; base: string } {
  const server = app.listen(0);
  return { server, base: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
}

describe('W4-MU2 MU-06: sim harvest never leaves localhost', () => {
  test('every probe goes to the stacksim Graph base, ignoring access_token and GRAPH_BASE_URL', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/harvest', createHarvestRouter(undefined, async () => true));
    const { server, base } = listen(app);
    const prevBase = process.env.GRAPH_BASE_URL;
    process.env.GRAPH_BASE_URL = 'https://graph.example.invalid/v1.0';
    const realFetch = globalThis.fetch;
    const graphCalls: string[] = [];
    const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith(base)) return realFetch(input, init); // the route itself
      graphCalls.push(url);
      return new Response(JSON.stringify({ value: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', spy);
    try {
      const res = await realFetch(`${base}/api/harvest/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPERATOR}` },
        body: JSON.stringify({ sim: true, access_token: 'would-go-to-a-tenant', tenant_slug: 'x' }),
      });
      expect(res.status).toBe(200);
      expect(graphCalls.length).toBe(3);
      for (const u of graphCalls) expect(u.startsWith(`${SIM_GRAPH_BASE}/`)).toBe(true);
      expect(SIM_GRAPH_BASE).toBe('http://127.0.0.1:4390/v1.0');
    } finally {
      vi.unstubAllGlobals();
      if (prevBase === undefined) delete process.env.GRAPH_BASE_URL;
      else process.env.GRAPH_BASE_URL = prevBase;
      server.close();
    }
  });

  test('sim down: 503 and the SPA client stores nothing', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/harvest', createHarvestRouter(undefined, async () => false));
    const { server, base } = listen(app);
    try {
      store.delete('muster-harvest-facts');
      store.set('muster-api-url', `${base}/api`);
      const o = await runSimHarvest();
      expect(o.ok).toBe(false);
      if (!o.ok) expect(o.message).toContain('503');
      expect(store.has('muster-harvest-facts')).toBe(false);
    } finally {
      server.close();
    }
  });
});

async function ledgerUp(): Promise<boolean> {
  try {
    const res = await fetch(`${SIM_URL}/ledger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function simGraph(p: string): Promise<unknown[]> {
  const res = await fetch(`${SIM_GRAPH_BASE}${p}`, { headers: { Authorization: 'Bearer stacksim' } });
  return ((await res.json()) as { value: unknown[] }).value;
}

describe.skipIf(!simAvailable())('W4-MU2 MU-06: live stacksim harvest → prefill store', () => {
  let sim: ChildProcess | undefined;
  let server: http.Server;

  beforeAll(async () => {
    if (!(await ledgerUp())) {
      sim = spawn('node', ['bin/stacksim.mjs', 'serve', 'm365_azure'], {
        cwd: path.resolve(process.cwd(), '..', '..', 'tenant-stacksim'),
        stdio: 'ignore',
      });
      const deadline = Date.now() + 20000;
      while (!(await ledgerUp())) {
        if (Date.now() > deadline) throw new Error('stacksim did not come up within 20s');
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    const l = listen(createApp() as unknown as express.Express);
    server = l.server;
    store.set('muster-api-url', `${l.base}/api`);
  }, 30000);

  afterAll(() => {
    server?.close();
    sim?.kill();
  });

  it('the SPA client writes the prefill store with answers that match the sim Graph', async () => {
    store.delete('muster-harvest-facts');
    const o = await runSimHarvest();
    if (!o.ok) console.error(o.message);
    expect(o.ok).toBe(true);

    const facts = loadHarvestFacts(); // exactly what the interview mount reads
    const byQ = new Map(facts.map((f) => [f.question_id, f]));
    expect([...byQ.keys()].sort()).toEqual(['ep-001', 'ep-002', 'iam-001', 'iam-004']);
    for (const f of facts) {
      expect(f.provenance).toBe('auto_detected');
      expect(f.source.startsWith('graph:')).toBe(true);
    }

    // Ground truth straight from the sim's Graph REST.
    const [devices, compliance, ca] = await Promise.all([
      simGraph('/deviceManagement/managedDevices'),
      simGraph('/deviceManagement/deviceCompliancePolicies'),
      simGraph('/identity/conditionalAccess/policies'),
    ]);
    const mfa = (ca as Array<{ state?: string; grantControls?: { builtInControls?: string[] } }>).some(
      (p) => p.state === 'enabled' && (p.grantControls?.builtInControls ?? []).includes('mfa')
    );
    expect(byQ.get('ep-001')!.answer).toBe(devices.length > 0 ? 'yes' : 'no');
    expect(byQ.get('ep-002')!.answer).toBe(compliance.length > 0 ? 'yes' : 'no');
    expect(byQ.get('iam-001')!.answer).toBe(mfa ? 'yes' : 'no');
    expect(byQ.get('iam-004')!.answer).toBe(mfa ? 'yes' : 'no');

    // And the prefill turns them into AUTO-DETECTED interview answers.
    const prefill = applyHarvestFacts(facts, {});
    expect(prefill.answers['ep-001']).toBe(byQ.get('ep-001')!.answer);
    expect(prefill.provenances['ep-001']).toBe('auto_detected');
  }, 60000);
});
