// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

/**
 * harvest.test.ts — DONE-WHEN #8: mock-tenant integration test for Graph harvest.
 *
 * Coverage:
 *  1. Full fixture (CA MFA policy + 12 devices + 2 compliance) → 8 auto_detected facts
 *     (MG-07: on the RR activities the retired iam-001/iam-004/ep-001/ep-002 aliased)
 *  2. Empty CA policy list → the MFA / remote-access activities answer 'no'
 *  3. Probe throws → that fact absent, others unaffected (FCA absence guardrail)
 *  4. POST /run with injected MockGraphClient → 200 with facts
 *  5. Degraded 503: POST /run without access_token and no injected client
 *  (FC-MU-3: the client-secret consent-url / callback routes and
 *   buildConsentUrl are retired — see harvest.retired.test.ts.)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import express from 'express';
import { MockGraphClient } from '../src/lib/graphClient.js';
import { runHarvest, PROBE_RR_ACTIVITIES, PROBE_RETIRED_ID } from '../src/services/harvestService.js';
import { LEGACY_READINESS_ALIASES } from '@/features/interview/questionGraph';
import { createHarvestRouter } from '../src/routes/harvest.js';
import { mintToken } from '../src/lib/jwt.js';

// ── Fixtures ───────────────────────────────────────────────────────────────────

const CA_MFA_FIXTURE = {
  value: [
    {
      id: 'policy-mfa-1',
      state: 'enabled',
      grantControls: { builtInControls: ['mfa'], operator: 'OR' },
    },
    {
      id: 'policy-disabled',
      state: 'disabled',
      grantControls: { builtInControls: ['mfa'], operator: 'OR' },
    },
  ],
};

const DEVICES_12_FIXTURE = {
  value: Array.from({ length: 12 }, (_, i) => ({ id: `device-${i}`, deviceName: `ws-${i}` })),
};

const COMPLIANCE_2_FIXTURE = {
  value: [{ id: 'compliance-win10' }, { id: 'compliance-macos' }],
};

const FULL_FIXTURES: Record<string, unknown> = {
  '/identity/conditionalAccess/policies': CA_MFA_FIXTURE,
  '/deviceManagement/managedDevices': DEVICES_12_FIXTURE,
  '/deviceManagement/deviceCompliancePolicies': COMPLIANCE_2_FIXTURE,
};

const EMPTY_CA_FIXTURES: Record<string, unknown> = {
  '/identity/conditionalAccess/policies': { value: [] },
  '/deviceManagement/managedDevices': DEVICES_12_FIXTURE,
  '/deviceManagement/deviceCompliancePolicies': COMPLIANCE_2_FIXTURE,
};

const THROWING_CA_FIXTURES: Record<string, unknown> = {
  '/identity/conditionalAccess/policies': new Error('Simulated network error on CA probe'),
  '/deviceManagement/managedDevices': DEVICES_12_FIXTURE,
  '/deviceManagement/deviceCompliancePolicies': COMPLIANCE_2_FIXTURE,
};

// ── Token helpers ──────────────────────────────────────────────────────────────

function primeToken(): string {
  return mintToken({ sub: 'user-prime', tenant_id: 'tenant-1', party_id: null, role: 'prime' });
}

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// ── Fixed clock ────────────────────────────────────────────────────────────────

const FIXED_NOW = new Date('2026-07-07T12:00:00.000Z');
const nowFn = () => FIXED_NOW;

// MG-07: one row of facts per probe outcome, on the RR activities it answers.
const MFA = PROBE_RR_ACTIVITIES.mfa;
const REMOTE = PROBE_RR_ACTIVITIES.remoteAccess;
const MDM = PROBE_RR_ACTIVITIES.mdmEnrollment;
const EPP = PROBE_RR_ACTIVITIES.endpointProtection;
const factsFor = (facts: Array<{ question_id: string }>, ids: readonly string[]) =>
  facts.filter((f) => ids.includes(f.question_id));

// ── runHarvest unit tests — DONE-WHEN #8 ──────────────────────────────────────

describe('harvestService — mock-tenant integration (DONE-WHEN #8)', () => {
  it('the probe activity ids equal the SPA alias table for the retired ids (old payloads re-key the same way)', () => {
    for (const [row, ids] of Object.entries(PROBE_RR_ACTIVITIES)) {
      const retired = PROBE_RETIRED_ID[row as keyof typeof PROBE_RR_ACTIVITIES];
      expect([...ids], row).toEqual(LEGACY_READINESS_ALIASES[retired]);
    }
  });

  it('full fixture: CA MFA policy + 12 devices + 2 compliance → 8 auto_detected facts', async () => {
    const client = new MockGraphClient(FULL_FIXTURES);
    const facts = await runHarvest(client, nowFn);

    expect(facts).toHaveLength(8);
    expect(facts.some((f) => /^(iam|ep)-\d{3}$/.test(f.question_id))).toBe(false);

    const expectRow = (ids: readonly string[], source: string) => {
      const row = factsFor(facts, ids);
      expect(row.map((f) => f.question_id)).toEqual([...ids]);
      for (const f of row) {
        expect(f).toMatchObject({
          answer: 'yes',
          provenance: 'auto_detected',
          confidence: 'high',
          source,
          captured_at: FIXED_NOW.toISOString(),
        });
      }
    };
    expectRow(MFA, 'graph:conditionalAccess');
    expectRow(REMOTE, 'graph:conditionalAccess');
    expectRow(MDM, 'graph:intuneDevices');
    expectRow(EPP, 'graph:defenderCompliance');

    // MockGraphClient recorded exactly 3 probe calls
    expect(client.calls).toHaveLength(3);
    expect(client.calls).toContain('/identity/conditionalAccess/policies');
    expect(client.calls).toContain('/deviceManagement/managedDevices');
    expect(client.calls).toContain('/deviceManagement/deviceCompliancePolicies');
  });

  it('disabled CA policy does not count as MFA-enforced → MFA "yes" only for enabled', async () => {
    // The full fixture has one enabled+mfa and one disabled+mfa. Enabled wins → 'yes'.
    const client = new MockGraphClient(FULL_FIXTURES);
    const facts = await runHarvest(client, nowFn);
    expect(factsFor(facts, MFA).map((f) => (f as { answer: string }).answer)).toEqual(['yes', 'yes']);
  });

  it('empty CA policy list → the MFA and remote-access activities answer "no"', async () => {
    const client = new MockGraphClient(EMPTY_CA_FIXTURES);
    const facts = await runHarvest(client, nowFn);

    expect(factsFor(facts, [...MFA, ...REMOTE]).map((f) => (f as { answer: string }).answer)).toEqual(['no', 'no', 'no', 'no']);

    // MDM and endpoint protection still present from other probes
    expect(factsFor(facts, [...MDM, ...EPP]).map((f) => (f as { answer: string }).answer)).toEqual(['yes', 'yes', 'yes', 'yes']);

    expect(facts).toHaveLength(8);
  });

  it('CA probe throws → MFA and remote-access facts absent; MDM and endpoint protection unaffected', async () => {
    const client = new MockGraphClient(THROWING_CA_FIXTURES);
    const facts = await runHarvest(client, nowFn);

    // Absent (CA probe threw — absence, not 'no')
    // FCA guardrail: absence of evidence must never be treated as pass
    expect(factsFor(facts, [...MFA, ...REMOTE])).toEqual([]);

    // present and unaffected
    expect(factsFor(facts, [...MDM, ...EPP]).map((f) => (f as { answer: string }).answer)).toEqual(['yes', 'yes', 'yes', 'yes']);

    // Exactly 4 facts
    expect(facts).toHaveLength(4);
  });
});

// ── HTTP route tests ───────────────────────────────────────────────────────────
//
// Two servers:
//   serverWithClient — createHarvestRouter(mockClient) for POST /run injection test
//   serverNoClient   — createHarvestRouter() for degraded + env-stubbed tests

let serverWithClient: http.Server;
let serverNoClient: http.Server;
let baseWithClient: string;
let baseNoClient: string;

beforeAll(async () => {
  const mockClient = new MockGraphClient(FULL_FIXTURES);

  const appWithClient = express();
  appWithClient.use(express.json());
  appWithClient.use('/api/harvest', createHarvestRouter(mockClient));
  serverWithClient = http.createServer(appWithClient);
  await new Promise<void>((resolve) => serverWithClient.listen(0, '127.0.0.1', resolve));
  const addr1 = serverWithClient.address() as { port: number };
  baseWithClient = `http://127.0.0.1:${addr1.port}`;

  const appNoClient = express();
  appNoClient.use(express.json());
  appNoClient.use('/api/harvest', createHarvestRouter());
  serverNoClient = http.createServer(appNoClient);
  await new Promise<void>((resolve) => serverNoClient.listen(0, '127.0.0.1', resolve));
  const addr2 = serverNoClient.address() as { port: number };
  baseNoClient = `http://127.0.0.1:${addr2.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    serverWithClient.close((err) => (err ? reject(err) : resolve()))
  );
  await new Promise<void>((resolve, reject) =>
    serverNoClient.close((err) => (err ? reject(err) : resolve()))
  );
});

describe('harvest route — POST /run with injected MockGraphClient', () => {
  it('returns 200 with facts array when testClient is injected', async () => {
    const res = await fetch(`${baseWithClient}/api/harvest/run`, {
      method: 'POST',
      headers: { ...authHeader(primeToken()), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { facts: unknown[] };
    expect(Array.isArray(body.facts)).toBe(true);
    const facts = body.facts as Array<{ question_id: string; source: string }>;
    // MG-07: the 8 readiness-probe facts on RR activity ids …
    expect(factsFor(facts, [...MFA, ...REMOTE, ...MDM, ...EPP])).toHaveLength(8);
    // … then FX-11 / MG-14: the tenant-fact reads (this fixture serves only the CA list).
    expect(facts.slice(8).map((f) => f.question_id)).toContain('TCP.CA.003');
    expect(facts.slice(8).every((f) => f.source.startsWith('graph:'))).toBe(true);
  });
});

describe('harvest route — degraded 503 paths', () => {
  it('POST /run without access_token and no injected client → 503 {degraded: true}', async () => {
    const res = await fetch(`${baseNoClient}/api/harvest/run`, {
      method: 'POST',
      headers: { ...authHeader(primeToken()), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { degraded: boolean };
    expect(body.degraded).toBe(true);
  });
});
