// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// M3 triggers: startup pass, every EC_INDEX_INTERVAL_MIN (default 15), and on demand via
// POST /api/index. Non-sim tenants are skipped with a logged refusal.

import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_INDEX_INTERVAL_MIN, getIndexIntervalMin } from '../src/config.js';
import { IndexService, discoverTenants } from '../src/scheduler.js';
import { readRefusals } from '../src/simRail.js';
import { listRuns } from '../src/store.js';
import { auth, makeSandbox, registerTenant, seedStamper, startApp, type Sandbox } from './helpers.js';

let sb: Sandbox;

beforeEach(() => {
  sb = makeSandbox();
  registerTenant(sb, 'ec-sim-a', 'sim');
  registerTenant(sb, 'ec-live-a', 'live');
  seedStamper(sb, 'ec-sim-a', { 'evidence/access_control/ac.l1-3.1.1.json': 'evidence-ac.json' });
  seedStamper(sb, 'ec-live-a', { 'evidence/access_control/ac.l1-3.1.1.json': 'evidence-ac.json' });
});
afterEach(() => {
  vi.useRealTimers();
  sb.restore();
});

describe('interval config', () => {
  it('defaults to 15 minutes and honors EC_INDEX_INTERVAL_MIN', () => {
    expect(DEFAULT_INDEX_INTERVAL_MIN).toBe(15);
    expect(getIndexIntervalMin({})).toBe(15);
    expect(getIndexIntervalMin({ EC_INDEX_INTERVAL_MIN: '5' })).toBe(5);
    expect(getIndexIntervalMin({ EC_INDEX_INTERVAL_MIN: 'nonsense' })).toBe(15);
  });
});

describe('discoverTenants', () => {
  it('finds Stamper plan-data tenant dirs and EC tenant dirs, skipping invalid names', () => {
    fs.mkdirSync(path.join(sb.pipelineRoot, 'EvidenceCollector', 'storage', 'ec-only'), { recursive: true });
    fs.writeFileSync(path.join(sb.pipelineRoot, 'Stamper', 'plan-data', 'not-a-dir.json'), '{}');
    expect(discoverTenants()).toEqual(['ec-live-a', 'ec-only', 'ec-sim-a']);
  });
});

describe('IndexService.start', () => {
  it('runs a startup pass for admitted tenants, refuses (and logs) the live one, and never touches its data', async () => {
    const svc = new IndexService(sb.resolver);
    try {
      const outcomes = await svc.start();
      const bySlug = Object.fromEntries(outcomes.map((o) => [o.tenantSlug, o.outcome]));
      expect(bySlug).toEqual({ 'ec-live-a': 'refused', 'ec-sim-a': 'indexed' });
      expect(listRuns('ec-sim-a')).toHaveLength(1);
      expect(fs.existsSync(path.join(sb.pipelineRoot, 'EvidenceCollector', 'storage', 'ec-live-a'))).toBe(false);
      expect(readRefusals().filter((r) => r.tenantSlug === 'ec-live-a' && r.operation === 'startup-index')).toHaveLength(1);
      expect(svc.isScheduled()).toBe(true);
    } finally {
      svc.stop();
    }
  });

  it('re-indexes every interval (fake timers) and stops cleanly', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const svc = new IndexService(sb.resolver);
    await svc.start(15);
    expect(listRuns('ec-sim-a')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000 - 1);
    expect(listRuns('ec-sim-a')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(listRuns('ec-sim-a')).toHaveLength(2));
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    await vi.waitFor(() => expect(listRuns('ec-sim-a')).toHaveLength(3));
    svc.stop();
    expect(svc.isScheduled()).toBe(false);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(listRuns('ec-sim-a')).toHaveLength(3);
  });
});

describe('POST /api/index (on demand)', () => {
  it('runs a pass now and returns the run + new findings', async () => {
    const ec = await startApp({ resolveTenant: sb.resolver });
    try {
      const res = await fetch(`${ec.base}/api/index?tenant=ec-sim-a`, { method: 'POST', headers: auth() });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.run).toMatchObject({ runType: 'index', status: 'success', artifactsWritten: 1 });
      expect(body.filesSeen).toBe(1);
      const runs = await (await fetch(`${ec.base}/api/runs?tenant=ec-sim-a`)).json();
      expect(runs[0].runId).toBe(body.run.runId);
    } finally {
      await ec.close();
    }
  });

  it('an empty on-demand pass reports status empty and the EMPTY_READ finding is listed', async () => {
    registerTenant(sb, 'ec-sim-empty', 'sim');
    const ec = await startApp({ resolveTenant: sb.resolver });
    try {
      const body = await (await fetch(`${ec.base}/api/index?tenant=ec-sim-empty`, { method: 'POST', headers: auth() })).json();
      expect(body.run.status).toBe('empty');
      const findings = await (await fetch(`${ec.base}/api/findings?tenant=ec-sim-empty&status=open`)).json();
      expect(findings.map((f: { checkId: string }) => f.checkId)).toEqual(['EMPTY_READ']);
    } finally {
      await ec.close();
    }
  });

  it('requires the bearer and a tenant', async () => {
    const ec = await startApp({ resolveTenant: sb.resolver });
    try {
      expect((await fetch(`${ec.base}/api/index?tenant=ec-sim-a`, { method: 'POST' })).status).toBe(401);
      expect((await fetch(`${ec.base}/api/index`, { method: 'POST', headers: auth() })).status).toBe(400);
    } finally {
      await ec.close();
    }
  });
});
