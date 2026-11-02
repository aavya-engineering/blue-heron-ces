// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// FIN-17 (OQ-1): the interim AI gate. AI paths are off for live tenants in V1: the client is handed
// out only with a key, MUSTER_AI_SIM_ONLY=1 and no live access configured; otherwise the AI routes
// answer 503 {degraded:true} (checked through the real coach route).
import { describe, test, expect, afterEach } from 'vitest';
import http from 'node:http';
import express from 'express';
import { aiGate, getClaude, isDegraded } from '../src/lib/claude.js';
import coachRouter from '../src/routes/coach.js';
import { mintToken } from '../src/lib/jwt.js';

const SAVED = { ...process.env };
afterEach(() => {
  for (const k of ['ANTHROPIC_API_KEY', 'MUSTER_AI_SIM_ONLY', 'MUSTER_LIVE_CLIENT_ID']) {
    if (SAVED[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED[k];
  }
});

describe('FIN-17: AI gate (interim until SP-9)', () => {
  test('aiGate: no key / not declared sim-only / live access configured are all refusals', () => {
    expect(aiGate({})).toEqual({ allowed: false, reason: 'no_key' });
    expect(aiGate({ ANTHROPIC_API_KEY: 'k' })).toEqual({ allowed: false, reason: 'not_declared_sim_only' });
    expect(aiGate({ ANTHROPIC_API_KEY: 'k', MUSTER_AI_SIM_ONLY: 'true' })).toEqual({ allowed: false, reason: 'not_declared_sim_only' });
    expect(aiGate({ ANTHROPIC_API_KEY: 'k', MUSTER_AI_SIM_ONLY: '1', MUSTER_LIVE_CLIENT_ID: 'app-id' })).toEqual({ allowed: false, reason: 'live_access_configured' });
    expect(aiGate({ ANTHROPIC_API_KEY: 'k', MUSTER_AI_SIM_ONLY: '1' })).toEqual({ allowed: true });
  });

  test('a key alone no longer enables AI: getClaude is null and isDegraded is true', () => {
    process.env.ANTHROPIC_API_KEY = 'test-key-not-used';
    delete process.env.MUSTER_AI_SIM_ONLY;
    delete process.env.MUSTER_LIVE_CLIENT_ID;
    expect(getClaude()).toBeNull();
    expect(isDegraded()).toBe(true);
    process.env.MUSTER_AI_SIM_ONLY = '1';
    expect(isDegraded()).toBe(false);
    expect(getClaude()).not.toBeNull(); // constructed only; no call is made
    process.env.MUSTER_LIVE_CLIENT_ID = 'live-app';
    expect(getClaude()).toBeNull();
  });

  test('the coach route answers 503 degraded when live access is configured, even with a key', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key-not-used';
    process.env.MUSTER_AI_SIM_ONLY = '1';
    process.env.MUSTER_LIVE_CLIENT_ID = 'live-app';
    const app = express();
    app.use(express.json());
    app.use('/api/coach', coachRouter);
    const server = app.listen(0);
    try {
      const port = (server.address() as { port: number }).port;
      const token = mintToken({ sub: 'u', tenant_id: '00000000-0000-0000-0000-0000000000c1', party_id: null, role: 'bhd_operator' });
      const res = await fetch(`http://127.0.0.1:${port}/api/coach/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sessionId: 's', messages: [{ role: 'user', content: 'hi' }] }),
      });
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ degraded: true });
    } finally {
      server.close();
    }
  });
});
