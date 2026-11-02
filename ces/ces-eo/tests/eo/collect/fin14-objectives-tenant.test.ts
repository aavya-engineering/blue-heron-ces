// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FIN-14 (V76): AO's per-row objective ids (`data.evidenceObjectives`, slice AO-1) reach EO's
 * collector C10 store record, the assessor view (JSON and HTML) and the evidence package row; rows
 * without objectives are written exactly as before. Display only: no source, credit or hash moves.
 * Also the FLOW-4 remainder: collector C11 takes the tenant's stamper_evidence_metadata rows when
 * Stamper wrote them under its own config tenant id (the all-zero id in the harness), bound by the
 * tenant slug or, with no slug, by the file's folder; another slug's rows never come in.
 * Fictional ids only.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalSha256 } from 'ces-shared/crypto';
import { getCesRepository, closeAllCesRepositories } from 'ces-shared/persistence/node';
import { AdminOpsEvidenceReader } from '../../../src/eo/adminops/AdminOpsEvidenceReader';
import { packageAdminOpsRow } from '../../../src/eo/adminops/adminopsViews';
import { composeAdminOpsSection } from '../../../src/eo/viewer/AssessorViewComposer';
import { renderAdminOpsSectionHtml } from '../../../src/eo/viewer/AssessorViewHtml';
import { EvidenceStore } from '../../../src/eo/evidence/store/EvidenceStore';
import { collectorInfo } from '../../../src/eo/evidence/store/collectorIdentity';
import { runCollectors, adminOpsCollector, type AdminOpsCollectedRow } from '../../../src/eo/collect/index';
import { toCollectedRow } from '../../../src/eo/collect/adminOpsCollector';
import {
  stamperEvidenceCollector, readStamperEvidenceRows, isUnderDir, NO_COLLECTOR_READER, STAMPER_EVIDENCE_SOURCE,
  type StamperEvidenceRowItem, type StamperEvidenceIndexItem,
} from '../../../src/eo/collect/StamperEvidenceCollector';
import { makeRealShapeRow } from '../adminops/helpers/makeRealShapeRow';

const TENANT = '00000000-0000-4000-8000-0000000000e4';
const STAMPER_TENANT = '00000000-0000-0000-0000-000000000000';
const SLUG = 'fin14-sim';
const OTHER_SLUG = 'fin14-other';
const NOW = Date.parse('2026-10-31T12:00:00.000Z');
const T = (min: number) => new Date(NOW - min * 60_000).toISOString();
const OBJ = ['AC.L1-3.1.2[a]', 'AC.L1-3.1.2[b]'];
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

describe('FIN-14: AO objectives reach EO; C11 binds Stamper rows to the tenant', () => {
  let tmp: string;
  let dbPath: string;
  const prevPipeline = process.env.CES_PIPELINE_ROOT;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-fin14-'));
    process.env.CES_PIPELINE_ROOT = tmp;
    dbPath = path.join(tmp, 'ces.db');
  });
  afterEach(() => {
    closeAllCesRepositories();
    fs.rmSync(tmp, { recursive: true, force: true });
    if (prevPipeline === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = prevPipeline;
  });

  /** One applied A-02 row with objectives (AO-1 shape) and one A-09 read without. */
  const seedAo = () => {
    const repo = getCesRepository(dbPath);
    const withObj = makeRealShapeRow({
      tenantId: TENANT, tenantSlug: SLUG, commandId: 'A-02', executionId: 'o1', controlIds: ['AC.L1-3.1.2'], timestamp: T(30),
      preStateOutput: '{"accountEnabled":true}', postStateOutput: '{"accountEnabled":false}', verdict: 'SAT',
    }) as { id: string; ces: unknown; data: Record<string, unknown> };
    withObj.data.evidenceObjectives = [...OBJ];
    repo.put('adminops_evidence', withObj as never);
    repo.put('adminops_evidence', makeRealShapeRow({ tenantId: TENANT, tenantSlug: SLUG, commandId: 'A-09', executionId: 'o2', controlIds: ['AC.L2-3.1.3'], timestamp: T(29), verdict: 'SAT' }));
  };
  const entries = () => new AdminOpsEvidenceReader(TENANT, dbPath).read().entries;

  describe('V76: objective ids are carried', () => {
    it('C10: toCollectedRow carries them; hashes are of the contract row only', () => {
      seedAo();
      const [a02, a09] = [...entries()].sort((x, y) => x.rowId.localeCompare(y.rowId));
      const row = toCollectedRow(a02.rowId, a02.evidence, a02.evidenceObjectives);
      expect(row.evidenceObjectives).toEqual(OBJ);
      expect(row.rowSha256).toBe(canonicalSha256(a02.evidence));
      const { evidenceObjectives: _objectives, ...withoutObjectives } = row;
      expect(toCollectedRow(a02.rowId, a02.evidence)).toEqual(withoutObjectives);
      expect('evidenceObjectives' in toCollectedRow(a09.rowId, a09.evidence, a09.evidenceObjectives)).toBe(false);
    });

    it('C10: the store record payload of a run carries them', async () => {
      seedAo();
      const run = await runCollectors({
        storageRoot: path.join(tmp, 'eo'), tenantId: TENANT, tenantSlug: SLUG, nowMs: NOW,
        reader: {} as never, identity: collectorInfo('00000000-0000-4000-8000-00000000c1a0'), collectors: [adminOpsCollector],
      });
      expect(run.errors).toEqual([]);
      const store = EvidenceStore.forStorageRoot(path.join(tmp, 'eo'), TENANT);
      const payloads = store.query({ sourceId: adminOpsCollector.sourceId }).map(r => store.readPayload(r) as AdminOpsCollectedRow);
      const byOp = Object.fromEntries(payloads.map(p => [p.opId, p.evidenceObjectives ?? null]));
      expect(byOp).toEqual({ 'A-02': OBJ, 'A-09': null });
    });

    it('assessor view: the section rows (JSON) and the HTML table show them', () => {
      seedAo();
      const section = composeAdminOpsSection(entries(), TENANT);
      const byCmd = Object.fromEntries(section.rows.map(r => [r.commandId, r.evidenceObjectives ?? null]));
      expect(byCmd).toEqual({ 'A-02': OBJ, 'A-09': null });
      const html = renderAdminOpsSectionHtml(section);
      expect(html).toContain('<th>Objectives</th>');
      expect(html).toContain(`data-ao-objectives="${OBJ.join(' ')}"`);
      expect(html).toContain('data-ao-objectives=""');
      // Parsed rows (the old input) still compose, with no objectives.
      const parsed = composeAdminOpsSection(new AdminOpsEvidenceReader(TENANT, dbPath).read().parsed, TENANT);
      expect(parsed.rows.every(r => !('evidenceObjectives' in r))).toBe(true);
      expect(parsed.rows.map(r => r.commandId).sort()).toEqual(section.rows.map(r => r.commandId).sort());
    });

    it('evidence package: an entry with objectives writes them; a parsed row is written exactly as before', () => {
      seedAo();
      const e = entries().find(x => x.evidence.commandId === 'A-02')!;
      const withObj = packageAdminOpsRow(e);
      expect(JSON.parse(withObj.json).evidenceObjectives).toEqual(OBJ);
      expect(withObj.evidenceObjectives).toEqual(OBJ);
      const plain = packageAdminOpsRow(e.evidence);
      expect(plain.json).toBe(JSON.stringify({ ...e.evidence, label: plain.label }, null, 2));
      expect(plain.fileName).toBe(withObj.fileName);
      const a09 = entries().find(x => x.evidence.commandId === 'A-09')!;
      expect(packageAdminOpsRow(a09).json).toBe(packageAdminOpsRow(a09.evidence).json);
    });
  });

  describe('C11 tenant id (FLOW-4 open item 2)', () => {
    const tenantRoot = () => path.join(tmp, 'Stamper', 'plan-data', SLUG);
    const seedRows = () => {
      const file = path.join(tenantRoot(), 'evidence', 'access_control', 'ac.json');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, '{"a":1}');
      const otherFile = path.join(tmp, 'Stamper', 'plan-data', OTHER_SLUG, 'evidence', 'x.json');
      fs.mkdirSync(path.dirname(otherFile), { recursive: true });
      fs.writeFileSync(otherFile, '{"b":2}');
      const data = (loc: string) => ({ artifact_id: 'a', task_id: 't', control_ids: ['AC.L1-3.1.1'], storage_location: loc, sha256_hash: sha(fs.readFileSync(loc)) });
      const repo = getCesRepository(dbPath);
      repo.put('stamper_evidence_metadata', { id: 'p:t:own#1', ces: { tenantId: TENANT, tenantSlug: SLUG }, data: data(file) });
      repo.put('stamper_evidence_metadata', { id: 'p:t:slug#1', ces: { tenantId: STAMPER_TENANT, tenantSlug: SLUG }, data: data(file) });
      repo.put('stamper_evidence_metadata', { id: 'p:t:path#1', ces: { tenantId: STAMPER_TENANT }, data: data(file) });
      repo.put('stamper_evidence_metadata', { id: 'p:t:otherslug#1', ces: { tenantId: STAMPER_TENANT, tenantSlug: OTHER_SLUG }, data: data(otherFile) });
      repo.put('stamper_evidence_metadata', { id: 'p:t:otherpath#1', ces: { tenantId: STAMPER_TENANT }, data: data(otherFile) });
      // A row naming this tenant's slug is taken even if its file sits elsewhere; one naming another slug never is.
      repo.put('stamper_evidence_metadata', { id: 'p:t:otherslug-ourpath#1', ces: { tenantId: STAMPER_TENANT, tenantSlug: OTHER_SLUG }, data: data(file) });
    };

    it('takes rows under EO\'s tenant id, then rows of this slug or folder under Stamper\'s id; never another slug\'s', () => {
      seedRows();
      const rows = readStamperEvidenceRows(TENANT, T(0), SLUG);
      const got = Object.fromEntries(rows.map(r => [r.rowId, [r.scopedBy, r.rowTenantId, r.tenantIdMatches]]));
      expect(got).toEqual({
        'p:t:own#1': ['tenantId', TENANT, true],
        'p:t:slug#1': ['tenantSlug', STAMPER_TENANT, false],
        'p:t:path#1': ['storagePath', STAMPER_TENANT, false],
      });
      // Without a slug the read is the tenant-id scope only (the FLOW-4 behaviour).
      expect(readStamperEvidenceRows(TENANT, T(0)).map(r => r.rowId)).toEqual(['p:t:own#1']);
    });

    it('R-F2: of the rows bound by slug or folder, only the newest Stamper run\'s are taken (older runs are history)', async () => {
      const file = path.join(tenantRoot(), 'evidence', 'access_control', 'ac.json');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, '{"a":1}');
      const data = { artifact_id: 'a', task_id: 't', control_ids: ['AC.L1-3.1.1'], storage_location: file, sha256_hash: sha(fs.readFileSync(file)) };
      const repo = getCesRepository(dbPath);
      repo.put('stamper_evidence_metadata', { id: 'oldrun:t:slug#1', ces: { tenantId: STAMPER_TENANT, tenantSlug: SLUG }, data });
      repo.put('stamper_evidence_metadata', { id: 'oldrun:t:path#1', ces: { tenantId: STAMPER_TENANT }, data });
      await new Promise((r) => setTimeout(r, 15));
      seedRows();
      const ids = readStamperEvidenceRows(TENANT, T(0), SLUG).map(r => r.rowId).sort();
      expect(ids).toEqual(['p:t:own#1', 'p:t:path#1', 'p:t:slug#1']);
    });

    it('PH-11: the newest-run filter covers rows under EO\'s tenant id too (an older run\'s rows there are history)', async () => {
      const file = path.join(tenantRoot(), 'evidence', 'access_control', 'ac.json');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, '{"a":1}');
      const data = { artifact_id: 'a', task_id: 't', control_ids: ['AC.L1-3.1.1'], storage_location: file, sha256_hash: sha(fs.readFileSync(file)) };
      const repo = getCesRepository(dbPath);
      repo.put('stamper_evidence_metadata', { id: 'oldrun:t:own#1', ces: { tenantId: TENANT, tenantSlug: SLUG }, data });
      repo.put('stamper_evidence_metadata', { id: 'oldrun:t:own2#1', ces: { tenantId: TENANT }, data });
      await new Promise((r) => setTimeout(r, 15));
      seedRows();
      expect(readStamperEvidenceRows(TENANT, T(0), SLUG).map(r => r.rowId).sort()).toEqual(['p:t:own#1', 'p:t:path#1', 'p:t:slug#1']);
      // Without a slug: the tenant-id rows alone, newest run only.
      expect(readStamperEvidenceRows(TENANT, T(0)).map(r => r.rowId)).toEqual(['p:t:own#1']);
    });

    it('PH-11: when the newest run is under EO\'s tenant id, an older run bound by slug or folder is dropped', async () => {
      const file = path.join(tenantRoot(), 'evidence', 'access_control', 'ac.json');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, '{"a":1}');
      const data = { artifact_id: 'a', task_id: 't', control_ids: ['AC.L1-3.1.1'], storage_location: file, sha256_hash: sha(fs.readFileSync(file)) };
      const repo = getCesRepository(dbPath);
      repo.put('stamper_evidence_metadata', { id: 'zerorun:t:slug#1', ces: { tenantId: STAMPER_TENANT, tenantSlug: SLUG }, data });
      repo.put('stamper_evidence_metadata', { id: 'zerorun:t:path#1', ces: { tenantId: STAMPER_TENANT }, data });
      await new Promise((r) => setTimeout(r, 15));
      repo.put('stamper_evidence_metadata', { id: 'newrun:t:own#1', ces: { tenantId: TENANT, tenantSlug: SLUG }, data });
      const rows = readStamperEvidenceRows(TENANT, T(0), SLUG);
      expect(rows.map(r => [r.rowId, r.scopedBy])).toEqual([['newrun:t:own#1', 'tenantId']]);
    });

    it('a C11 run chains those rows and lists them in its index', async () => {
      seedRows();
      const run = await runCollectors({
        storageRoot: path.join(tmp, 'eo'), tenantId: TENANT, tenantSlug: SLUG, nowMs: NOW,
        reader: NO_COLLECTOR_READER, identity: collectorInfo('00000000-0000-4000-8000-00000000c1a0'), collectors: [stamperEvidenceCollector],
      });
      expect(run.errors).toEqual([]);
      const store = EvidenceStore.forStorageRoot(path.join(tmp, 'eo'), TENANT);
      const recs = store.query({ sourceId: STAMPER_EVIDENCE_SOURCE });
      const rows = recs.filter(r => r.endpoint === 'stamper_evidence/row').map(r => store.readPayload(r) as StamperEvidenceRowItem);
      expect(rows.map(r => r.rowId).sort()).toEqual(['p:t:own#1', 'p:t:path#1', 'p:t:slug#1']);
      expect(rows.every(r => r.fileSha256 === r.metaSha256)).toBe(true);
      const index = store.readPayload(recs.find(r => r.endpoint === 'stamper_evidence/index')!) as StamperEvidenceIndexItem;
      expect([...index.rowIds].sort()).toEqual(['p:t:own#1', 'p:t:path#1', 'p:t:slug#1']);
      expect(store.verify().ok).toBe(true);
    });

    it('isUnderDir: inside only, never the folder itself or a sibling with the same prefix', () => {
      const d = path.join(tmp, 'plan-data', 'a');
      expect(isUnderDir(path.join(d, 'evidence', 'x.json'), d)).toBe(true);
      expect(isUnderDir(d, d)).toBe(false);
      expect(isUnderDir(path.join(tmp, 'plan-data', 'ab', 'x.json'), d)).toBe(false);
      expect(isUnderDir('', d)).toBe(false);
    });
  });
});
