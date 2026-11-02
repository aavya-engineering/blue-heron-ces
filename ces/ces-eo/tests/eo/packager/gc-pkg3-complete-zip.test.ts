// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * GC-PKG-3 (gap closure, assessor package slice 3): the zip always carries policies/, personnel/, stamper-evidence/
 * and an EO-built evidence-index.json whose objectiveRows (a row per objective of every assessed control, from the
 * KB-1 evidence matrix) cite only zip files with their true sha256; the integrity manifest covers every new file.
 * Drives the real EvidencePackager.build and readStamperChain (over a store stub), reads the zip back with JSZip.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { EC_CONTRACT_VERSION, type EcEvidenceItem } from 'ces-shared/types/evidence-collector';
import { EvidencePackager, readStamperChain, type StamperChainForPackage } from '../../../src/eo/packager/EvidencePackager';
import { assessmentApproachFor } from '../../../src/eo/ssp/AssessorApproach';

const _require = createRequire(__filename);
const JSZip = _require('jszip');
const controlsRefPath = _require.resolve('ces-shared/data/cmmc-l2-controls');
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

const snapshot = (controls: Array<{ control_id: string; status: string }>) => ({
  snapshotId: 'snap-pkg3', tenantId: '00000000-0000-4000-8000-0000000003aa', generatedAt: '2026-10-30T10:00:00.000Z',
  controls: controls.map(c => ({ ...c, sources: [] })), sources_merged: [], sprs_score: 100,
  controls_met: controls.filter(c => c.status === 'met').length, controls_not_met: 0, controls_partial: 0, controls_not_assessed: 0, liveAssessmentCount: 0,
}) as any;

const ecItem = (): EcEvidenceItem => ({
  contractVersion: EC_CONTRACT_VERSION as EcEvidenceItem['contractVersion'],
  itemId: 'eci-pkg3', tenantSlug: 'pkg3', controlIds: ['AC.L1-3.1.1'], source: 'manual_upload',
  filename: 'user-list.csv', mediaType: 'text/csv', sha256: sha('a,b\n'), sizeBytes: 4,
  collectedAt: '2026-10-30T09:00:00.000Z', submittedByRole: 'compliance_officer', mode: 'sim',
});

/** Unzip: entry name below the package folder → bytes. */
async function unzip(filePath: string): Promise<Map<string, Buffer>> {
  const zip = await JSZip.loadAsync(fs.readFileSync(filePath));
  const out = new Map<string, Buffer>();
  for (const name of Object.keys(zip.files)) {
    if (zip.files[name].dir) continue;
    out.set(name.split('/').slice(1).join('/'), await zip.file(name).async('nodebuffer'));
  }
  return out;
}

describe('GC-PKG-3 complete assessor zip', () => {
  let tmp: string;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-pkg3-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  test('empty stores: policies/, personnel/ and stamper-evidence/ hold a README; the index has rows; the manifest covers all', async () => {
    const result = await new EvidencePackager(controlsRefPath).build({
      assessment: snapshot([{ control_id: 'AC.L1-3.1.1', status: 'met' }, { control_id: 'AU.L2-3.3.1', status: 'not_assessed' }]),
      outputDir: tmp,
    });
    const files = await unzip(result.filePath);
    expect(files.get('policies/README.md')!.toString()).toMatch(/No policies imported/);
    expect(files.get('personnel/README.md')!.toString()).toMatch(/No personnel, screening or training records/);
    expect(files.get('stamper-evidence/README.md')!.toString()).toMatch(/No Stamper evidence in EO's hash chain: the chain was not read/);
    const index = JSON.parse(files.get('evidence-index.json')!.toString());
    expect(index.schema).toBe('ces-eo/evidence-index@1'); // the Appendix P part bundle.mjs and scorecard.mjs read
    expect(Array.isArray(index.examineCoverage)).toBe(true);
    const objectives = assessmentApproachFor('AC.L1-3.1.1')!.objectives.map(o => o.objectiveId);
    expect(index.objectiveRows.map((r: any) => r.objectiveId)).toEqual(objectives); // not_assessed AU.L2-3.3.1 has no row
    expect(index.objectiveSummary).toMatchObject({ rows: objectives.length, metControls: 1, metControlsWithRow: 1, filesCited: 0 });
    const manifest = JSON.parse(files.get('integrity-manifest.json')!.toString());
    const listed = new Map(manifest.files.map((f: any) => [f.file, f.sha256]));
    for (const f of ['policies/README.md', 'personnel/README.md', 'stamper-evidence/README.md', 'evidence-index.json']) {
      expect(listed.get(f)).toBe(sha(files.get(f)!));
    }
  });

  test('chain, policies, personnel and EC files: every objective row cites zip files with their true hash', async () => {
    const evidenceDir = path.join(tmp, 'evidence');
    fs.mkdirSync(path.join(evidenceDir, 'AU'), { recursive: true });
    const auBytes = Buffer.from('{"metadata":{"controlIds":["AU.L2-3.3.1"]},"rawResponse":"x"}\r\n');
    fs.writeFileSync(path.join(evidenceDir, 'AU', 'audit-enable.json'), auBytes);
    const chain: StamperChainForPackage = {
      indexRecordId: 'rec-index', missing: [],
      files: [{ recordId: 'rec-1', relPath: 'AU/audit-enable.json', chainSha256: sha(auBytes), controlIds: ['AU.L2-3.3.1'], bytes: auBytes, matchesChain: true }],
    };
    const result = await new EvidencePackager(controlsRefPath).build({
      assessment: snapshot([{ control_id: 'AC.L1-3.1.1', status: 'met' }, { control_id: 'AC.L1-3.1.2', status: 'not_met' }, { control_id: 'AU.L2-3.3.1', status: 'met' }]),
      outputDir: tmp,
      stamperChain: chain,
      policies: [{ template_id: 't-ac', title: 'Access Control Policy', markdown: '# Access Control Policy\n', completeness: 1, domain: 'AC', nist_controls: ['3.1.1'] }],
      personnelRecords: [{ id: 'p-1', displayName: 'Person One', email: 'p1@example.test', role: 'user', screeningState: 'screened', createdDate: '2026-10-01T00:00:00.000Z', evidenceArtifacts: [], lifecycleEvents: [] } as any],
      personnelTraining: [{ personnelId: 'p-1', state: { personnelId: 'p-1', completions: [] } }],
      personnelScreening: [{ personnelId: 'p-1', elements: [{ elementNumber: 1, status: 'complete', data: null }] }],
      ecEvidenceItems: [{ item: ecItem(), content: Buffer.from('a,b\n') }],
    });
    const files = await unzip(result.filePath);
    expect(files.has('policies/README.md')).toBe(false);
    expect(files.has('personnel/README.md')).toBe(false);
    for (const f of ['policies/AC/access-control-policy.md', 'personnel/p-1.json', 'personnel/training/p-1.json', 'personnel/screening/p-1.json', 'stamper-evidence/AU/audit-enable.json']) {
      expect(files.has(f)).toBe(true);
    }
    expect(files.get('stamper-evidence/AU/audit-enable.json')!.equals(auBytes)).toBe(true);
    const chainDoc = JSON.parse(files.get('stamper-evidence/chain.json')!.toString());
    expect(chainDoc).toMatchObject({ source: 'collect.stamperEvidence', indexRecordId: 'rec-index' });
    expect(chainDoc.files[0]).toMatchObject({ file: 'stamper-evidence/AU/audit-enable.json', chainSha256: sha(auBytes), zipSha256: sha(auBytes), matchesChain: true });

    const index = JSON.parse(files.get('evidence-index.json')!.toString());
    for (const row of index.objectiveRows) {
      for (const f of row.files) expect(sha(files.get(f.file)!)).toBe(f.sha256);
    }
    const cites = (objectiveId: string) => index.objectiveRows.find((r: any) => r.objectiveId === objectiveId)?.files.map((f: any) => f.file);
    expect(cites('AC.L1-3.1.1[a]')).toContain('evidence/ec/AC.L1-3.1.1/eci-pkg3-user-list.csv'); // ec_upload
    expect(cites('AC.L1-3.1.2[a]')).toContain('policies/AC/access-control-policy.md'); // stamper_evidence naming the policy
    expect(cites('AU.L2-3.3.1[c]')).toContain('stamper-evidence/AU/audit-enable.json'); // stamper_evidence of the control
    expect(index.objectiveSummary.metControls).toBe(2);
    expect(index.objectiveSummary.metControlsWithRow).toBe(2);

    const manifest = JSON.parse(files.get('integrity-manifest.json')!.toString());
    const listed = new Map(manifest.files.map((f: any) => [f.file, f.sha256]));
    for (const f of ['personnel/training/p-1.json', 'personnel/screening/p-1.json', 'stamper-evidence/AU/audit-enable.json', 'stamper-evidence/chain.json', 'evidence-index.json']) {
      expect(listed.get(f)).toBe(sha(files.get(f)!));
    }
  });

  test('POST /api/package/build: stamper-evidence/ = the chain C11 wrote, policies/ and personnel/ READMEs, the index resolves', async () => {
    const prevPipeline = process.env.CES_PIPELINE_ROOT;
    const prevTenantRoot = process.env.CES_TENANT_ROOT;
    process.env.CES_PIPELINE_ROOT = tmp;
    process.env.CES_TENANT_ROOT = path.join(tmp, 'empty-registry');
    const SLUG = 'pkg3-sim';
    const TENANT = '00000000-0000-4000-8000-0000000003bb';
    const stamperRoot = path.join(tmp, 'Stamper');
    const tenantDir = path.join(stamperRoot, 'plan-data', SLUG);
    const storageRoot = path.join(tmp, 'eo');
    let server: import('node:http').Server | undefined;
    try {
      fs.mkdirSync(path.join(tenantDir, 'evidence', 'audit'), { recursive: true });
      fs.mkdirSync(path.join(tenantDir, 'plans'), { recursive: true });
      fs.writeFileSync(path.join(tenantDir, `${SLUG}.json`), JSON.stringify({ tenant: { tenant_id: TENANT, domain: `${SLUG}.example.test` } }));
      const evBytes = JSON.stringify({ rawResponse: '{"value":[1]}', complianceVerdict: 'SAT', registryEntry: { entry_id: 'AU.L2-3.3.1.audit-enable', label: 'audit' },
        metadata: { controlIds: ['AU.L2-3.3.1'], timestamp: '2026-10-30T09:00:00.000Z', sha256Hash: sha('{"value":[1]}'), commandExecuted: 'Get-AdminAuditLogConfig' } }, null, 2);
      fs.writeFileSync(path.join(tenantDir, 'evidence', 'audit', 'au-enable.json'), evBytes);
      fs.writeFileSync(path.join(tenantDir, 'plans', `policy-set-manifest-${SLUG}-2026-10-30T09-00-00-000Z.json`),
        JSON.stringify({ artifact: { documents: [{ name: 'policies/audit-policy.md', sha256: 'a'.repeat(64) }] } }));

      const { runCollectors } = await import('../../../src/eo/collect/index');
      const { stamperEvidenceCollector, NO_COLLECTOR_READER } = await import('../../../src/eo/collect/StamperEvidenceCollector');
      const { collectorInfo } = await import('../../../src/eo/evidence/store/collectorIdentity');
      const run = await runCollectors({ storageRoot, tenantId: TENANT, tenantSlug: SLUG, reader: NO_COLLECTOR_READER,
        identity: collectorInfo('00000000-0000-4000-8000-00000000c1a0'), collectors: [stamperEvidenceCollector] } as any);
      expect(run.errors).toEqual([]);

      const { AssessmentStore } = await import('../../../src/eo/assessment/AssessmentStore');
      const { PersonnelStore } = await import('../../../src/eo/personnel/PersonnelStore');
      const { createEvidenceRouter } = await import('../../../src/eo/server/routers/evidence-router');
      const express = (await import('express')).default;
      const now = new Date().toISOString();
      new AssessmentStore(storageRoot).save({ snapshotId: 'snap-r', tenantId: TENANT, generatedAt: now, sprs_score: 110,
        controls: [{ control_id: 'AU.L2-3.3.1', status: 'met', sources: [] }] } as any);
      fs.mkdirSync(path.join(storageRoot, 'ssp'), { recursive: true });
      fs.writeFileSync(path.join(storageRoot, 'ssp', `latest-${SLUG}.json`), JSON.stringify({ sspId: 'ssp-r', tenantId: TENANT, snapshotId: 'snap-r', generatedAt: now, controlImplementations: [] }));
      const poam = { poamId: 'poam-r', tenantId: TENANT, snapshotId: 'snap-r', generatedAt: now, sprsScore: 110, items: [], summary: { totalItems: 0, openItems: 0, totalWeightOnPoam: 0, projectedScoreAfterPoam: 110 }, eligibility: { eligible: true, certificationPath: 'full' } };
      const emptyStore = { load: () => [], loadRegister: () => ({ entries: [] }), loadLatest: () => null } as any;
      const app = express();
      app.use(express.json());
      app.use(createEvidenceRouter({
        config: { storageRoot } as any, stamperRoot, assessmentStore: new AssessmentStore(storageRoot),
        personnelStore: new PersonnelStore(storageRoot), riskAssessmentStore: emptyStore, policyStore: emptyStore,
        poamStore: { ...emptyStore, loadLatest: () => poam } as any,
        getSessionManager: () => null, captureSignals: async () => ({ capturedCount: 0, errors: [] }) as any, getLastCaptureRun: () => null,
      }));
      server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
      const port = (server!.address() as import('node:net').AddressInfo).port;
      const r = await fetch(`http://127.0.0.1:${port}/api/package/build`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenant: SLUG, allowPartial: true }),
      });
      expect(r.status).toBe(200);
      const files = await unzip((await r.json()).filePath);
      const stamperFiles = [...files.keys()].filter(f => f.startsWith('stamper-evidence/') && f !== 'stamper-evidence/chain.json');
      expect(stamperFiles).toEqual(['stamper-evidence/audit/au-enable.json']);
      expect(sha(files.get(stamperFiles[0])!)).toBe(sha(evBytes));
      expect(files.has('policies/README.md')).toBe(true);
      expect(files.has('personnel/README.md')).toBe(true);
      const index = JSON.parse(files.get('evidence-index.json')!.toString());
      expect(index.tenantSlug).toBe(SLUG);
      expect(index.objectiveSummary.metControlsWithRow).toBe(1);
      expect(index.objectiveRows.find((x: any) => x.objectiveId === 'AU.L2-3.3.1[c]').files).toEqual([{ file: 'stamper-evidence/audit/au-enable.json', sha256: sha(evBytes) }]);
      for (const row of index.objectiveRows) for (const f of row.files) expect(sha(files.get(f.file)!)).toBe(f.sha256);
    } finally {
      if (server) { server.closeAllConnections(); await new Promise<void>(res => server!.close(() => res())); }
      (await import('ces-shared/persistence/node')).closeAllCesRepositories();
      if (prevPipeline === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = prevPipeline;
      if (prevTenantRoot === undefined) delete process.env.CES_TENANT_ROOT; else process.env.CES_TENANT_ROOT = prevTenantRoot;
    }
  });

  test('readStamperChain: the last C11 index, its files with disk bytes when they match, the chained document when not, missing ids', () => {
    const evidenceDir = path.join(tmp, 'evidence');
    fs.mkdirSync(evidenceDir, { recursive: true });
    const same = Buffer.from('{"a":1}');
    fs.writeFileSync(path.join(evidenceDir, 'same.json'), same);
    fs.writeFileSync(path.join(evidenceDir, 'changed.json'), '{"a":"rewritten"}');
    const payloads: Record<string, unknown> = {
      'p-old-index': { kind: 'index', id: 'index:old', fileIds: ['file:old.json@0'], rowIds: [] },
      'p-index': { kind: 'index', id: 'index:new', fileIds: ['file:same.json@s', 'file:changed.json@c', 'file:gone.json@g'], rowIds: [] },
      'p-same': { kind: 'file', id: 'file:same.json@s', relPath: 'same.json', fileSha256: sha(same), controlIds: ['AC.L1-3.1.1'], document: { a: 1 } },
      'p-changed': { kind: 'file', id: 'file:changed.json@c', relPath: 'changed.json', fileSha256: 'f'.repeat(64), controlIds: [], document: { a: 2 } },
    };
    const rec = (recordId: string, kind: string, id: string, payloadSha256: string) => ({
      recordId, sourceId: 'collect.stamperEvidence', status: 'success', endpoint: `stamper_evidence/${kind}`, query: `stamper_evidence/${id}`, payloadSha256,
    });
    const records = [
      rec('r0', 'index', 'index:old', 'p-old-index'),
      rec('r1', 'file', 'file:same.json@s', 'p-same'),
      rec('r2', 'file', 'file:changed.json@c', 'p-changed'),
      rec('r3', 'index', 'index:new', 'p-index'),
    ];
    const store = { query: () => records, readPayload: (r: { payloadSha256: string }) => payloads[r.payloadSha256] } as any;
    const chain = readStamperChain(store, evidenceDir);
    expect(chain.indexRecordId).toBe('r3');
    expect(chain.missing).toEqual(['file:gone.json@g']);
    expect(chain.files.map(f => [f.relPath, f.recordId, f.matchesChain])).toEqual([['same.json', 'r1', true], ['changed.json', 'r2', false]]);
    expect(chain.files[0].bytes.equals(same)).toBe(true);
    expect(JSON.parse(chain.files[1].bytes.toString())).toEqual({ a: 2 });
    expect(readStamperChain({ query: () => [], readPayload: () => null } as any, evidenceDir)).toMatchObject({ indexRecordId: null, files: [], note: expect.stringMatching(/no C11/) });
  });
});
