// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * PH-12 (LOG-PH7-EO.md open item 4): the Evidence Explorer index marks a Stamper manual-gate record
 * and a record run inside a manual gate (`manualGate`), so neither reads as a plain SAT. An ordinary
 * record carries no mark. Real evidence router over listen(0); fictional ids; temp dirs only.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { closeAllCesRepositories } from 'ces-shared/persistence/node';
import { createEvidenceRouter } from '../../../src/eo/server/routers/evidence-router';
import { AssessmentStore } from '../../../src/eo/assessment/AssessmentStore';

const SLUG = 'ph12-gate-sim';
const GUID = '00000000-0000-4000-8000-0000000012ab';
const HASH = 'c'.repeat(64);

const record = (id: string, verdict: string, extra: Record<string, unknown> = {}) => ({
  rawResponse: '{"value":[{"id":"x"}]}', complianceVerdict: verdict, outcomeRationale: '',
  registryEntry: { entry_id: id, label: `${id} label` },
  metadata: { controlIds: ['PE.L1-3.10.1'], timestamp: '2026-11-01T10:00:00.000Z', commandExecuted: `[manual/evidence-only] ${id}`, sha256Hash: HASH, ...extra },
});

describe('GET /api/evidence-explorer/index: manual-gate records are marked (PH-12)', () => {
  let tmp: string;
  let server: Server;
  let base: string;
  const prevPipeline = process.env.CES_PIPELINE_ROOT;
  const prevTenantRoot = process.env.CES_TENANT_ROOT;

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-ph12-gate-'));
    process.env.CES_PIPELINE_ROOT = tmp;
    process.env.CES_TENANT_ROOT = path.join(tmp, 'empty-registry');
    const stamperRoot = path.join(tmp, 'Stamper');
    const tenantDir = path.join(stamperRoot, 'plan-data', SLUG);
    fs.mkdirSync(path.join(tenantDir, 'evidence', 'physical_protection'), { recursive: true });
    const tenantJson = path.join(tenantDir, `${SLUG}.json`);
    fs.writeFileSync(tenantJson, JSON.stringify({ tenant: { tenant_id: GUID, domain: `${SLUG}.example.test` } }));
    const ev = (name: string, body: unknown) => fs.writeFileSync(path.join(tenantDir, 'evidence', 'physical_protection', name), JSON.stringify(body));
    ev('gate.json', record('PE-GATE', 'SAT', { gate: 'manual', gateAction: 'approved', ownerRole: 'facility_manager' }));
    ev('inside.json', record('PE-INSIDE', 'SAT', { gateContext: 'manual_gate' }));
    ev('plain.json', record('PE-PLAIN', 'SAT'));

    const storageRoot = path.join(tmp, 'eo-storage');
    fs.mkdirSync(storageRoot, { recursive: true });
    const emptyStore = { load: () => [], loadRegister: () => ({ entries: [] }), loadLatest: () => null } as any;
    const app = express();
    app.use(express.json());
    app.use(createEvidenceRouter({
      config: { storageRoot, tenantSlug: SLUG, tenantConfigPath: tenantJson } as any,
      stamperRoot,
      assessmentStore: new AssessmentStore(storageRoot),
      personnelStore: emptyStore, riskAssessmentStore: emptyStore, policyStore: emptyStore, poamStore: emptyStore,
      getSessionManager: () => null,
      captureSignals: async () => ({ capturedCount: 0, errors: [] }),
      getLastCaptureRun: () => null,
    }));
    server = await new Promise<Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeAllCesRepositories();
    fs.rmSync(tmp, { recursive: true, force: true });
    if (prevPipeline === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = prevPipeline;
    if (prevTenantRoot === undefined) delete process.env.CES_TENANT_ROOT; else process.env.CES_TENANT_ROOT = prevTenantRoot;
  });

  it('marks the gate record and the in-gate record; the plain record has no mark', async () => {
    const res = await fetch(`${base}/api/evidence-explorer/index?tenant=${SLUG}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { items?: Array<{ id: string; verdict?: string; manualGate?: unknown }> } | Array<{ id: string; verdict?: string; manualGate?: unknown }>;
    const items = Array.isArray(body) ? body : body.items ?? [];
    const byId = new Map(items.filter((i) => i.id.startsWith('stamper:')).map((i) => [i.id, i]));
    expect(byId.get('stamper:PE-GATE')?.manualGate).toEqual({ kind: 'gate', action: 'approved' });
    expect(byId.get('stamper:PE-INSIDE')?.manualGate).toEqual({ kind: 'gate_context' });
    expect(byId.get('stamper:PE-PLAIN')).toBeDefined();
    expect(byId.get('stamper:PE-PLAIN')?.manualGate).toBeUndefined();
    // verdict is unchanged: what Stamper wrote
    expect(byId.get('stamper:PE-GATE')?.verdict).toBe('SAT');
  });
});
