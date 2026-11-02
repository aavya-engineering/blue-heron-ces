// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * NS-1b (GD-b): GET /api/assess reads the tenant's WORM document reviews (eo_document_reviews,
 * DocumentReviewStore) and passes them, with the EC items (uploadedBy), to ControlAssessor.merge.
 * (1) No reviews: the snapshot is identical to the pre-NS-1b call (merge without its last two
 *     arguments), also when ces.db holds another tenant's reviews.
 * (2) Fixture reviews: a non-stack control becomes met only when every objective has a met review
 *     by a reviewer who is not the uploader; a stack-decided control is untouched.
 * Harness as assess-policy-invariance.test.ts (real router over HTTP, temp root, no Graph session).
 * EC is mocked (EcEvidenceReader). Sim only.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import type { EcEvidenceItem } from 'ces-shared/types/evidence-collector';
import { EC_CONTRACT_VERSION } from 'ces-shared/types/evidence-collector';
import { closeAllCesRepositories } from 'ces-shared/persistence/node';
import { createAssessmentRouter } from '../../../src/eo/server/routers/assessment-router';
import { DocumentReviewStore } from '../../../src/eo/server/routers/review-router';
import { ControlAssessor, objectiveIdsByControl, type DocumentReview } from '../../../src/eo/assessment/ControlAssessor';
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

const mockEcItems: EcEvidenceItem[] = [];
jest.mock('../../../src/eo/evidence/EcEvidenceReader', () => ({
  ...jest.requireActual('../../../src/eo/evidence/EcEvidenceReader'),
  EcEvidenceReader: class {
    async readItems(_slug: string, controlId?: string) { return mockEcItems.filter(i => !controlId || i.controlIds.includes(controlId)); }
    async readItemsOrThrow(slug: string, controlId?: string) { return this.readItems(slug, controlId); }
    async readItemContent() { return null; }
  },
}));

const REGISTRY = path.resolve(__dirname, '../../../../ces-stamper/src/registry/cmmc-l2-commands.registry.json');
const SLUG = 'ns1b-reviews';
const GUID = '00000000-0000-4000-8000-0000000011bb';
const NONSTACK = 'AT.L2-3.2.3';   // 2 objectives; nonstack in the registry; no source in this fixture
const STACK = 'AC.L1-3.1.1';      // met by its evidence-only SAT file (Tier 4)
const HASH = 'c'.repeat(64);
const UPLOADER = { subjectId: 'uploader:u1', upn: 'Uploader.One@ns1b.example.test' };
const REVIEWER = 'reviewer.two@ns1b.example.test';

function ecItem(controlId: string): EcEvidenceItem {
  return {
    contractVersion: EC_CONTRACT_VERSION as EcEvidenceItem['contractVersion'],
    itemId: `item-${controlId}`, tenantSlug: SLUG, controlIds: [controlId], source: 'manual_upload',
    filename: 'training-roster.pdf', mediaType: 'application/pdf', sha256: HASH, sizeBytes: 10,
    collectedAt: '2026-10-30T00:00:00.000Z', submittedByRole: 'compliance_officer', uploadedBy: UPLOADER, mode: 'sim',
  };
}

let n = 0;
function review(controlId: string, objectiveId: string, verdict: 'met' | 'not_met' = 'met', reviewerUpn = REVIEWER): DocumentReview {
  n++;
  return {
    reviewId: `ns1b-rev-${n}`, tenantSlug: SLUG, controlId, objectiveId, artifactHash: HASH, verdict,
    reviewer: { upn: reviewerUpn, subjectId: `ao-approver:${reviewerUpn}`, tokenId: `jti-${n}` },
    uploader: UPLOADER, ecItemIds: [`item-${controlId}`], reviewedAt: '2026-10-30T01:00:00.000Z',
  };
}

describe('NS-1b: /api/assess passes the tenant\'s stored document reviews to ControlAssessor.merge (GD-b)', () => {
  let tmp: string;
  let server: Server;
  let base: string;
  let assessmentStore: AssessmentStore;
  const mergeSpy = jest.spyOn(ControlAssessor.prototype, 'merge');
  const prevPipeline = process.env.CES_PIPELINE_ROOT;
  const prevTenantRoot = process.env.CES_TENANT_ROOT;

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ns1b-reviews-'));
    process.env.CES_PIPELINE_ROOT = path.join(tmp, 'pipeline');
    process.env.CES_TENANT_ROOT = path.join(tmp, 'empty-registry');

    const evDir = path.join(process.env.CES_PIPELINE_ROOT, 'Stamper', 'plan-data', SLUG, 'evidence', 'access_control');
    fs.mkdirSync(evDir, { recursive: true });
    fs.writeFileSync(path.join(evDir, 'ac.l1-3.1.1.ca-policy-evidence.json'), JSON.stringify({
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
      evidence_storage: { account_name: 'acct-ns1b', account_key: 'sim-key', container: 'evidence', base_path: '', blob_endpoint: 'http://127.0.0.1:1/never-called' },
    }));

    mockEcItems.push(ecItem(NONSTACK), ecItem(STACK));

    const storageRoot = path.join(tmp, 'eo-storage');
    fs.mkdirSync(storageRoot, { recursive: true });
    assessmentStore = new AssessmentStore(storageRoot);
    const config = { storageRoot, tenantSlug: SLUG, tenantConfigPath: cfgPath, registryPath: REGISTRY } as any;
    const app = express();
    app.use(createAssessmentRouter({
      config, stamperRoot, getSessionManager: () => null,
      assessmentStore, poamStore: new PoamStore(storageRoot), poamLedgerStore: new PoamLedgerStore(storageRoot),
      policyStore: new PolicyStore(storageRoot), personnelStore: new PersonnelStore(storageRoot),
      screeningElementStore: new ScreeningElementStore(storageRoot), trainingStore: new TrainingStore(storageRoot),
    }));
    server = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    mergeSpy.mockRestore();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    closeAllCesRepositories();
    fs.rmSync(tmp, { recursive: true, force: true });
    if (prevPipeline === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = prevPipeline;
    if (prevTenantRoot === undefined) delete process.env.CES_TENANT_ROOT; else process.env.CES_TENANT_ROOT = prevTenantRoot;
  });

  // sprs_score: the router sets it on the merge result after merge returns (the legacy re-run has none).
  const VOLATILE = new Set(['timestamp', 'snapshotId', 'generatedAt', 'last_assessed', 'lastFetchedAt', 'sprs_score']);
  const normalize = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (k, val) => (VOLATILE.has(k) ? '<volatile>' : val)));

  /** One assess; returns the merge call's arguments and result, and the saved snapshot. */
  async function assess(): Promise<{ args: unknown[]; result: any; saved: any; self: ControlAssessor }> {
    mergeSpy.mockClear();
    const r = await fetch(`${base}/api/assess?tenant=${SLUG}`);
    expect(r.status).toBe(200);
    const text = await r.text();
    const events = text.split('\n\n').filter(f => f.startsWith('data: ')).map(f => JSON.parse(f.slice(6)));
    expect(events.map(e => e.type)).toContain('assess_done');
    expect(events.find(e => e.type === 'assess_error')).toBeUndefined();
    expect(mergeSpy).toHaveBeenCalledTimes(1);
    const saved = assessmentStore.loadLatestForTenant(GUID);
    expect(saved).not.toBeNull();
    return { args: mergeSpy.mock.calls[0], result: mergeSpy.mock.results[0].value, saved, self: mergeSpy.mock.instances[0] as unknown as ControlAssessor };
  }
  // FIN-27: CA.L2-3.12.1 / 3.12.3 follow EO's own assessment history, so they differ between successive assesses.
  const withoutCa = (controls: any[]) => controls.filter((c: any) => !String(c.control_id).startsWith('CA.L2-3.12.'));
  const ctl = (snap: any, id: string) => snap.controls.find((c: any) => c.control_id === id);
  /** The pre-NS-1b call: the same instance and arguments, without objectiveSources / documentReviews. */
  const legacy = (a: { args: unknown[]; self: ControlAssessor }) =>
    (mergeSpy.getMockImplementation() ?? ControlAssessor.prototype.merge).apply(a.self, a.args.slice(0, 9) as any);

  it('no reviews (none stored, then only another tenant\'s): identical to the pre-NS-1b merge', async () => {
    const noDb = await assess();
    expect(noDb.args).toHaveLength(12); // FIN-27: the 12th is EO's own CA records (prior assessments, POA&M ledger)
    expect(noDb.args[9]).toBeUndefined();
    expect(noDb.args[10]).toEqual([]);
    expect((noDb.args[8] as EcEvidenceItem[]).map(i => i.uploadedBy)).toEqual([UPLOADER, UPLOADER]);
    expect(normalize(withoutCa(noDb.result.controls))).toEqual(normalize(withoutCa(legacy(noDb).controls)));
    expect(ctl(noDb.saved, NONSTACK).status).toBe('not_assessed');
    expect(ctl(noDb.saved, STACK).status).toBe('met');

    // Another tenant's reviews are out of scope.
    const store = new DocumentReviewStore();
    for (const o of objectiveIdsByControl().get(NONSTACK)!) store.record({ ...review(NONSTACK, o), tenantSlug: 'other-tenant' }, '00000000-0000-4000-8000-0000000011cc');
    const otherOnly = await assess();
    expect(otherOnly.args[10]).toEqual([]);
    expect(normalize(withoutCa(otherOnly.result.controls))).toEqual(normalize(withoutCa(legacy(otherOnly).controls)));
    expect(normalize(withoutCa(otherOnly.saved.controls))).toEqual(normalize(withoutCa(noDb.saved.controls)));
    // FIN-27: the second assess may credit CA.L2-3.12.1 (5 points) from EO's own first assessment; nothing else moves.
    const caMoved = otherOnly.saved.controls.filter((x: any) => x.status !== ctl(noDb.saved, x.control_id).status).map((x: any) => x.control_id);
    expect(caMoved.every((id: string) => id.startsWith('CA.L2-3.12.'))).toBe(true);
  });

  it('fixture reviews: the non-stack control is met only when every objective has a met review by a non-uploader; the stack control is untouched', async () => {
    const store = new DocumentReviewStore();
    const [oa, ob] = objectiveIdsByControl().get(NONSTACK)!;
    const baseline = (await assess()).saved;

    // Partial coverage, plus the uploader reviewing their own upload: not countable for [b].
    store.record(review(NONSTACK, oa), GUID);
    store.record(review(NONSTACK, ob, 'met', UPLOADER.upn.toUpperCase()), GUID);
    // A not_met review on a stack-decided control: the stack source outranks it.
    store.record(review(STACK, objectiveIdsByControl().get(STACK)![0], 'not_met'), GUID);
    const partial = await assess();
    expect((partial.args[10] as DocumentReview[]).length).toBe(3);
    expect(ctl(partial.saved, NONSTACK).status).toBe('not_assessed');
    expect(ctl(partial.saved, STACK).status).toBe('met');
    expect(normalize(withoutCa(partial.saved.controls))).toEqual(normalize(withoutCa(baseline.controls)));

    // Every objective now has a met review by a reviewer who is not the uploader.
    store.record(review(NONSTACK, ob), GUID);
    const full = await assess();
    const c = ctl(full.saved, NONSTACK);
    expect(c.status).toBe('met');
    expect(c.statusRationale).toMatch(/^GD-b \(document review of every objective/);
    expect(c.statusRationale).toContain(REVIEWER);
    expect(ctl(full.saved, STACK).status).toBe('met');
    expect(ctl(full.saved, STACK).statusRationale).not.toMatch(/^GD-b/);
    const moved = withoutCa(full.saved.controls).filter((x: any) => x.status !== ctl(baseline, x.control_id).status).map((x: any) => x.control_id);
    expect(moved).toEqual([NONSTACK]);
  });
});
