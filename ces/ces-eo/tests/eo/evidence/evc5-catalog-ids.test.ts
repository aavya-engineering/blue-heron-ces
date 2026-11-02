// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * EVC.5 — optional evidence-catalog ids (`form_id`, `emx_ids`, DEC-2) on manual evidence.
 * Covers: catalog path order; the /api/ec/ingest proxy validating and forwarding the ids
 * (valid, unknown form_id, unknown emx_id, absent, catalog unavailable); the ids travelling
 * to the control's ec_capture source, the determination ledger rollup and the evidence
 * package; and DEC-7 — an upload with valid ids changes no control status, no SPRS result
 * and never enters `evidenceArtifactIds`.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import multer from 'multer';
import type { ControlAssessment } from 'ces-shared/types/controls';
import { EC_CONTRACT_VERSION, type EcEvidenceItem } from 'ces-shared/types/evidence-collector';
import { catalogCandidates, loadCatalog, type CatalogLoad } from '../../../src/eo/evidence/EvidenceCatalog';
import { ecCatalogRef, ecCatalogRefsFromSources } from '../../../src/eo/evidence/EcEvidenceReader';
import { createEcRouter } from '../../../src/eo/server/routers/ec-router';
import { ControlAssessor } from '../../../src/eo/assessment/ControlAssessor';
import { SprsCalculator } from '../../../src/eo/sprs/SprsCalculator';
import { buildDeterminationLedger } from '../../../src/eo/assessment/DeterminationLedger';
import { EvidencePackager } from '../../../src/eo/packager/EvidencePackager';

const SECRET = 'eo-ec-secret';
const controlsRefPath = require.resolve('ces-shared/data/cmmc-l2-controls');
const siblingCatalog = (): CatalogLoad => loadCatalog({});

function ecItem(overrides: Partial<EcEvidenceItem> = {}): EcEvidenceItem {
  return {
    contractVersion: EC_CONTRACT_VERSION as EcEvidenceItem['contractVersion'],
    itemId: 'eci-evc5-1',
    tenantSlug: 'acme-sim',
    controlIds: ['AC.L1-3.1.1'],
    source: 'manual_upload',
    filename: 'acp.pdf',
    mediaType: 'application/pdf',
    sha256: 'd'.repeat(64),
    sizeBytes: 7,
    collectedAt: '2026-10-27T00:00:00.000Z',
    submittedByRole: 'compliance_officer',
    mode: 'sim',
    ...overrides,
  };
}

const TAGGED = { form_id: 'account_management_procedure', emx_ids: ['EMX-IAM-004'], form_id_matched_by: 'form_id' as const, catalog: 'validated' as const };

describe('EVC.5 catalog path resolution (EO copy)', () => {
  it('CES_EVIDENCE_CATALOG_PATH, when set, is the only path tried', () => {
    expect(catalogCandidates({ CES_EVIDENCE_CATALOG_PATH: 'x/cat.json', CES_PIPELINE_ROOT: 'p' })).toEqual([path.resolve('x/cat.json')]);
  });

  it('then <CES_PIPELINE_ROOT>/evidence-catalog, then the ces-muster copy', () => {
    const c = catalogCandidates({ CES_PIPELINE_ROOT: 'p' });
    expect(c[0]).toBe(path.join('p', 'evidence-catalog', 'evidence-catalog-release-0.json'));
    expect(c[1].split(path.sep).join('/')).toMatch(/\/ces-muster\/src\/features\/plan\/engine\/data\/evidence-catalog\/evidence-catalog-release-0\.json$/);
  });

  it('loads release 0 from the sibling default', () => {
    const load = siblingCatalog();
    expect(load.status).toBe('loaded');
    if (load.status === 'loaded') expect(load.definitionIds.size).toBe(14);
  });

  it('is unavailable when the configured file is missing', () => {
    expect(loadCatalog({ CES_EVIDENCE_CATALOG_PATH: path.join(os.tmpdir(), 'evc5-missing', 'cat.json') }).status).toBe('unavailable');
  });
});

// ─── /api/ec/ingest proxy ─────────────────────────────────────────

interface FakeEc { server: Server; url: string; ingestCalls: Array<Record<string, unknown>> }

function startFakeEc(): Promise<FakeEc> {
  const app = express();
  app.use(express.json());
  const ingestCalls: Array<Record<string, unknown>> = [];
  app.post('/api/ingest', (req, res) => {
    ingestCalls.push(req.body as Record<string, unknown>);
    res.status(201).json({ itemId: 'eci-new-1', ...(req.body as object) });
  });
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}`, ingestCalls });
    });
  });
}

async function startEoApp(ecUrl: string, loader: () => CatalogLoad): Promise<{ server: Server; base: string }> {
  const app = express();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
  app.use(createEcRouter({ ecUrl, secret: SECRET, upload, timeoutMs: 1000, loadCatalog: loader }));
  const server = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const { port } = server.address() as AddressInfo;
  return { server, base: `http://127.0.0.1:${port}` };
}

const close = (s: Server) => new Promise<void>(r => s.close(() => r()));

function form(extra: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const fields = { tenantSlug: 'acme-sim', controlIds: 'AC.L1-3.1.1', source: 'manual_upload', submittedByRole: 'compliance_officer', ...extra };
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  fd.set('file', new Blob(['policy'], { type: 'application/pdf' }), 'acp.pdf');
  return fd;
}

describe('EVC.5 POST /api/ec/ingest with catalog ids', () => {
  let fake: FakeEc;
  let eo: { server: Server; base: string };
  afterEach(async () => {
    await close(eo.server);
    await close(fake.server);
    jest.restoreAllMocks();
  });

  async function post(extra: Record<string, string>, loader: () => CatalogLoad = siblingCatalog) {
    fake = await startFakeEc();
    eo = await startEoApp(fake.url, loader);
    return fetch(`${eo.base}/api/ec/ingest`, { method: 'POST', body: form(extra) });
  }

  it('valid form_id and emx_ids are accepted and forwarded to EC', async () => {
    const res = await post({ form_id: 'access_control_policy', emx_ids: 'EMX-IAM-004, EMX-RISK-002' });
    expect(res.status).toBe(201);
    expect(fake.ingestCalls).toHaveLength(1);
    expect(fake.ingestCalls[0]).toMatchObject({ form_id: 'access_control_policy', emx_ids: ['EMX-IAM-004', 'EMX-RISK-002'] });
  });

  it('a definition_id is accepted as form_id', async () => {
    const res = await post({ form_id: 'AC.L2-3.1.1#E01' });
    expect(res.status).toBe(201);
    expect(fake.ingestCalls[0]).toMatchObject({ form_id: 'AC.L2-3.1.1#E01' });
  });

  it('unknown form_id: 400 naming the id, nothing reaches EC', async () => {
    const res = await post({ form_id: 'no_such_form' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: 'invalid_request', field: 'form_id', id: 'no_such_form' });
    expect(body.detail).toContain('no_such_form');
    expect(fake.ingestCalls).toHaveLength(0);
  });

  it('unknown emx_id: 400 naming the id, nothing reaches EC', async () => {
    const res = await post({ emx_ids: 'EMX-IAM-004,EMX-ZZZ-999' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: 'invalid_request', field: 'emx_ids', id: 'EMX-ZZZ-999' });
    expect(fake.ingestCalls).toHaveLength(0);
  });

  it('absent fields: the forwarded body carries no catalog keys (unchanged behaviour)', async () => {
    const res = await post({});
    expect(res.status).toBe(201);
    expect('form_id' in fake.ingestCalls[0]).toBe(false);
    expect('emx_ids' in fake.ingestCalls[0]).toBe(false);
  });

  it('catalog unavailable: forwards the ids unvalidated and logs it', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const res = await post({ form_id: 'anything_goes', emx_ids: 'EMX-ZZZ-999' }, () => ({ status: 'unavailable', reason: 'test' }));
    expect(res.status).toBe(201);
    expect(fake.ingestCalls[0]).toMatchObject({ form_id: 'anything_goes', emx_ids: ['EMX-ZZZ-999'] });
    expect(warn.mock.calls.some(c => String(c[0]).includes('evidence catalog unavailable'))).toBe(true);
  });
});

// ─── DEC-7 and the ids' path through EO ───────────────────────────

function merge(ecItems: EcEvidenceItem[]) {
  return new ControlAssessor(controlsRefPath, []).merge('evc5-tenant', [], [], [], [], undefined, undefined, undefined, ecItems);
}

const strip = (c: ControlAssessment) => ({ control_id: c.control_id, status: c.status, evidenceArtifactIds: c.evidenceArtifactIds, automationSource: c.automationSource });

describe('EVC.5 DEC-7: catalog ids never change a status or the verified-artifact list', () => {
  it('an upload with valid ids changes no control status and does not enter evidenceArtifactIds', () => {
    const without = merge([]);
    const withIds = merge([ecItem({ ...TAGGED, controlIds: ['AC.L1-3.1.1', 'AU.L2-3.3.1', 'SC.L1-3.13.1'] })]);
    expect(withIds.controls.map(strip)).toEqual(without.controls.map(strip));
    for (const c of withIds.controls) expect(c.evidenceArtifactIds).not.toContain('eci-evc5-1');
    expect(new SprsCalculator().calculate(withIds.controls)).toEqual(new SprsCalculator().calculate(without.controls));
  });

  it('the ids ride on the control ec_capture source (no_query) and nowhere when absent', () => {
    const tagged = merge([ecItem(TAGGED)]).controls.find(c => c.control_id === 'AC.L1-3.1.1')!;
    const src = tagged.sources.find(s => s.type === 'ec_capture')!;
    expect(src.result).toBe('no_query');
    expect(ecCatalogRefsFromSources(tagged.sources)).toEqual([{ itemId: 'eci-evc5-1', filename: 'acp.pdf', ...TAGGED }]);

    const plain = merge([ecItem()]).controls.find(c => c.control_id === 'AC.L1-3.1.1')!;
    expect(plain.sources.find(s => s.type === 'ec_capture')!.rawOutput).toBeUndefined();
    expect(ecCatalogRef(ecItem())).toBeUndefined();
  });

  it('the determination ledger rollup lists the item with its ids; statuses are unchanged', () => {
    const catalog = [{ objectiveId: 'AC.L1-3.1.1[a]', controlId: 'AC.L1-3.1.1', description: 'authorized users are identified', methods: ['examine'] }];
    const input = { tenantId: 't', generatedAt: '2026-10-27T00:00:00Z', objectivesCatalog: catalog, sprsWeights: { '3.1.1': 5 } };
    const plain = buildDeterminationLedger({ ...input, snapshot: merge([]) });
    const tagged = buildDeterminationLedger({ ...input, snapshot: merge([ecItem(TAGGED)]) });
    expect(tagged.controls[0].evidence).toEqual([{ itemId: 'eci-evc5-1', filename: 'acp.pdf', ...TAGGED }]);
    expect('evidence' in plain.controls[0]).toBe(false);
    expect(tagged.controls[0].status).toBe(plain.controls[0].status);
    expect(tagged.objectives).toEqual(plain.objectives);
    expect(tagged.summary).toEqual(plain.summary);
  });
});

describe('EVC.5 evidence package: per-item JSON for tagged items only', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evc5-pkg-')); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  const snapshot = () => ({ snapshotId: 's', tenantId: 't', generatedAt: '2026-10-27T00:00:00.000Z', controls: [], sources_merged: [], sprs_score: 0, controls_met: 0, controls_not_met: 0, controls_partial: 0, controls_not_assessed: 0 }) as any;

  it('writes evidence/ec/<control>/<itemId>.json carrying form_id and emx_ids', async () => {
    const result = await new EvidencePackager(controlsRefPath).build({
      assessment: snapshot(),
      ecEvidenceItems: [{ item: ecItem(TAGGED), content: Buffer.from('policy!') }, { item: ecItem({ itemId: 'eci-plain' }), content: Buffer.from('x') }],
      outputDir: tmpDir,
    });
    const zip = fs.readFileSync(result.filePath);
    expect(zip.includes(Buffer.from('evidence/ec/AC.L1-3.1.1/eci-evc5-1.json'))).toBe(true);
    expect(zip.includes(Buffer.from('evidence/ec/AC.L1-3.1.1/eci-plain.json'))).toBe(false);
  });
});
