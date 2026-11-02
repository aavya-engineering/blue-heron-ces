// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * W1.1 (F7) — policies are documentation, never status. GET /api/assess must produce the same
 * output whether or not the tenant's policy store holds policies: the same SSE events (ids and
 * timestamps aside) and the same saved assessment snapshot. Before W1.1 a policy with
 * completeness >= 90 added an `imported` policy_doc source and made its controls met.
 *
 * Drives the REAL assessment router over HTTP with real stores in a temp root (harness as in
 * assess-tenant.route.test.ts): blob transport returns no blobs, the docx render pipeline is
 * stubbed, no Graph session (Phase 4 skipped). One Stamper evidence file on disk. Sim only.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import type { PolicyDocument } from 'ces-shared/types/policy';
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

jest.mock('ces-shared/blob', () => ({
  ...jest.requireActual('../../__mocks__/ces-shared/blob'),
  listBlobs: async () => [],
  downloadBlob: async () => null,
}));

const REGISTRY = path.resolve(__dirname, '../../../../ces-stamper/src/registry/cmmc-l2-commands.registry.json');
const SLUG = 'w11-policy-invariance';
const GUID = '00000000-0000-4000-8000-0000000011aa';

const POLICIES: PolicyDocument[] = [
  { template_id: 'acp', title: 'Access Control Policy', markdown: '# Access Control', completeness: 100, domain: 'Access Control', nist_controls: ['3.1.1', '3.1.2', '3.1.3'] },
  { template_id: 'iap', title: 'Identification and Authentication Policy', markdown: '# IA', completeness: 95, domain: 'Identification and Authentication', nist_controls: ['3.5.1', '3.5.2'] },
];

describe('W1.1 F7: /api/assess output is identical with and without policies in the policy store', () => {
  let tmp: string;
  let server: Server;
  let base: string;
  let assessmentStore: AssessmentStore;
  let policyStore: PolicyStore;
  const prevPipeline = process.env.CES_PIPELINE_ROOT;
  const prevTenantRoot = process.env.CES_TENANT_ROOT;

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'w11-policy-'));
    process.env.CES_PIPELINE_ROOT = path.join(tmp, 'pipeline');
    process.env.CES_TENANT_ROOT = path.join(tmp, 'empty-registry');

    // One evidence-only SAT file for AC.L1-3.1.1, where StamperEvidenceLoader reads it.
    const evDir = path.join(process.env.CES_PIPELINE_ROOT, 'Stamper', 'plan-data', SLUG, 'evidence', 'access_control');
    fs.mkdirSync(evDir, { recursive: true });
    fs.writeFileSync(path.join(evDir, 'ac.l1-3.1.1.ca-policy-evidence.json'), JSON.stringify({
      // W0.2a: a SAT counts only with a non-empty rawResponse, so the fixture carries one.
      rawResponse: '{"value":[{"id":"caPolicy-1"}]}',
      complianceVerdict: 'SAT', outcomeRationale: 'Command completed successfully (exit code 0)',
      registryEntry: { entry_id: 'AC.L1-3.1.1.ca-policy-evidence', label: 'Verify Conditional Access Policies', control_ids: ['AC.L1-3.1.1'] },
      metadata: { controlIds: ['AC.L1-3.1.1'], timestamp: '2026-10-27T13:00:00.000Z', commandExecuted: '[manual/evidence-only] Verify Conditional Access Policies', sha256Hash: 'x' },
    }));

    const stamperRoot = path.join(tmp, 'stamper');
    const dir = path.join(stamperRoot, 'plan-data', SLUG);
    fs.mkdirSync(dir, { recursive: true });
    const cfgPath = path.join(dir, `${SLUG}.json`);
    fs.writeFileSync(cfgPath, JSON.stringify({
      tenant: { tenant_id: GUID, domain: `${SLUG}.example.test` },
      client: { name: SLUG },
      auth: { app_id: '00000000-0000-4000-8000-000000000000', cert_path: 'sim.pfx', cert_thumbprint: 'SIM' },
      evidence_storage: { account_name: 'acct-w11', account_key: 'sim-key', container: 'evidence', base_path: '', blob_endpoint: 'http://127.0.0.1:1/never-called' },
    }));

    const storageRoot = path.join(tmp, 'eo-storage');
    fs.mkdirSync(storageRoot, { recursive: true });
    assessmentStore = new AssessmentStore(storageRoot);
    policyStore = new PolicyStore(storageRoot);
    const config = { storageRoot, tenantSlug: SLUG, tenantConfigPath: cfgPath, registryPath: REGISTRY } as any;
    const app = express();
    app.use(createAssessmentRouter({
      config, stamperRoot, getSessionManager: () => null,
      assessmentStore, poamStore: new PoamStore(storageRoot), poamLedgerStore: new PoamLedgerStore(storageRoot),
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

  // EO-collection W3: the drift event names the previous snapshot, so its id is volatile too.
  const VOLATILE = new Set(['timestamp', 'snapshotId', 'previousSnapshotId', 'poamId', 'generatedAt', 'last_assessed', 'lastFetchedAt']);
  const normalize = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (k, val) => (VOLATILE.has(k) ? '<volatile>' : val)));

  async function assess(): Promise<{ events: unknown; snapshot: unknown; raw: any }> {
    const r = await fetch(`${base}/api/assess?tenant=${SLUG}`);
    expect(r.status).toBe(200);
    const text = await r.text();
    const events = text.split('\n\n').filter(f => f.startsWith('data: ')).map(f => JSON.parse(f.slice(6)));
    expect(events.map(e => e.type)).toContain('assess_done');
    expect(events.find(e => e.type === 'assess_error')).toBeUndefined();
    const snap = assessmentStore.loadLatestForTenant(GUID);
    expect(snap).not.toBeNull();
    return { events: normalize(events), snapshot: normalize(snap), raw: snap };
  }

  it('same SSE events and same snapshot; the policy-mapped controls are not made met', async () => {
    // EO-collection W3: every assess now compares with the previous snapshot (drift event) and
    // reconciles the stored POA&M (poam_reconciled). A warm-up assess gives both compared runs a
    // predecessor, so those events are comparable (the first-ever assess is a baseline instead).
    // FIN-27: CA.L2-3.12.1 needs one prior assessment and 3.12.3 two, so three warm-ups let the CA credit settle (EO's own POA&M ledger is written by the assess itself).
    await assess();
    await assess();
    await assess();
    const without = await assess();

    policyStore.save(SLUG, POLICIES);
    expect(policyStore.load(SLUG)).toHaveLength(2); // the store really holds them for the second run

    const withPolicies = await assess();
    expect(withPolicies.events).toEqual(without.events);
    // FIN-27: the CA rows cite EO's own (growing) assessment history, so compare everything else.
    const noCa = (snap: any) => ({ ...snap, controls: snap.controls.filter((c: any) => !String(c.control_id).startsWith('CA.L2-3.12.')) });
    expect(noCa(withPolicies.snapshot)).toEqual(noCa(without.snapshot));

    const status = (id: string) => withPolicies.raw.controls.find((c: any) => c.control_id === id).status;
    expect(status('AC.L1-3.1.2')).toBe('not_assessed'); // policy-only control: was met before W1.1
    expect(status('AC.L1-3.1.1')).toBe('met');          // its evidence-only SAT file, labelled
    expect(withPolicies.raw.controls.some((c: any) => c.sources.some((s: any) => s.type === 'policy_doc'))).toBe(false);
  });
});
