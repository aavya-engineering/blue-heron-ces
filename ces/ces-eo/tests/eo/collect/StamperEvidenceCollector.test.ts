// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Gap closure FLOW-4: collector C11 (`collect.stamperEvidence`) and the assessment's read-back from
 * the chain (stamperEvidenceFromChain, the path assessment-router.ts Phase 1.5 now takes). The old
 * path (StamperEvidenceLoader reading Stamper's files) and the new path must give identical evidence
 * items, assessment sources per control and directive metadata, across reruns, a rewritten file and
 * a removed file. stamper_evidence_metadata rows are chained with their hash. Fictional ids only.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { getCesRepository, closeAllCesRepositories } from 'ces-shared/persistence/node';
import { StamperEvidenceLoader } from '../../../src/eo/evidence/StamperEvidenceLoader';
import { EvidenceStore } from '../../../src/eo/evidence/store/EvidenceStore';
import { collectorInfo } from '../../../src/eo/evidence/store/collectorIdentity';
import { runCollectors } from '../../../src/eo/collect/index';
import {
  stamperEvidenceCollector, stamperEvidenceFromChain, NO_COLLECTOR_READER, STAMPER_EVIDENCE_SOURCE,
  type StamperEvidenceRowItem,
} from '../../../src/eo/collect/StamperEvidenceCollector';

const TENANT = '00000000-0000-4000-8000-0000000000f4';
const OTHER = '00000000-0000-4000-8000-0000000000f9';
const SLUG = 'f4-sim';
const NOW = Date.parse('2026-10-30T12:00:00.000Z');
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

const rec = (o: { verdict: string; controlIds: string[]; entry: string; raw?: unknown; cmd?: string; rationale?: string; dm?: unknown; ts?: string }) => ({
  rawResponse: o.raw ?? '{"value":[{"id":"x"}]}',
  complianceVerdict: o.verdict,
  outcomeRationale: o.rationale ?? '',
  registryEntry: { entry_id: o.entry, label: `${o.entry} label` },
  metadata: {
    controlIds: o.controlIds, timestamp: o.ts ?? '2026-10-30T11:00:00.000Z', sha256Hash: sha(String(o.raw ?? '')),
    commandExecuted: o.cmd ?? 'Get-MgPolicy', executorIdentity: 'stamper/1.0.0@00000000-0000-4000-8000-00000000c1a0',
  },
  ...(o.dm ? { directiveMetadata: o.dm } : {}),
});

describe('FLOW-4: Stamper evidence through EO\'s hash chain (C11)', () => {
  let tmp: string;
  let evDir: string;
  const prevPipeline = process.env.CES_PIPELINE_ROOT;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-c11-'));
    process.env.CES_PIPELINE_ROOT = tmp;
    evDir = path.join(tmp, 'Stamper', 'plan-data', SLUG, 'evidence');
  });
  afterEach(() => {
    closeAllCesRepositories();
    fs.rmSync(tmp, { recursive: true, force: true });
    if (prevPipeline === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = prevPipeline;
  });

  const write = (rel: string, body: unknown) => {
    const f = path.join(evDir, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, typeof body === 'string' ? body : JSON.stringify(body, null, 2));
  };
  const fixture = () => {
    write('access_control/ac-sat.json', rec({ verdict: 'SAT', controlIds: ['AC.L1-3.1.1', 'AC.L1-3.1.2'], entry: 'AC-01',
      dm: { control_id: 'AC.L1-3.1.1', directive: 'implement', readiness: 'ready', evidence_artifacts: ['a'] } }));
    write('access_control/ac-notsat.json', rec({ verdict: 'NOT_SAT', controlIds: ['AC.L1-3.1.1'], entry: 'AC-02', rationale: 'policy disabled' }));
    write('audit_accountability/au-404.json', rec({ verdict: 'NOT_SAT', controlIds: ['AU.L2-3.3.1'], entry: 'AU-01', rationale: 'Response status code (404) Not Found' }));
    write('config_management/cm-evonly-empty.json', rec({ verdict: 'SAT', controlIds: ['CM.L2-3.4.1'], entry: 'CM-01', raw: '{"value":[]}', cmd: '[manual/evidence-only] CM-01' }));
    write('config_management/cm-evonly-notsat.json', rec({ verdict: 'NOT_SAT', controlIds: ['CM.L2-3.4.2'], entry: 'CM-02', raw: '', cmd: '[manual/evidence-only] CM-02' }));
    write('media_protection/no-controls.json', { complianceVerdict: 'SAT', metadata: { controlIds: [] } });
    write('media_protection/broken.json', '{ not json');
    write('media_protection/notes.txt', 'not evidence');
  };
  const ctx = (nowMs: number) => ({
    storageRoot: path.join(tmp, 'eo'), tenantId: TENANT, tenantSlug: SLUG, nowMs,
    reader: NO_COLLECTOR_READER, identity: collectorInfo('00000000-0000-4000-8000-00000000c1a0'), collectors: [stamperEvidenceCollector],
  });
  const store = () => EvidenceStore.forStorageRoot(path.join(tmp, 'eo'), TENANT);
  /** The assessment's Phase 1.5, old (file read) and new (chain read), on the same tree. */
  const both = async (nowMs: number) => {
    const loader = new StamperEvidenceLoader(SLUG);
    const old = loader.loadEvidenceForTenant();
    const run = await runCollectors(ctx(nowMs));
    expect(run.errors).toEqual([]);
    const chained = stamperEvidenceFromChain(store(), run.results[0]);
    return { loader, old, run, chained };
  };
  const expectIdentical = ({ loader, old, chained }: Awaited<ReturnType<typeof both>>) => {
    expect(chained.error).toBeUndefined();
    expect(chained.missing).toEqual([]);
    expect(chained.evidence).toEqual(old);
    expect([...loader.toAssessmentSources(chained.evidence)]).toEqual([...loader.toAssessmentSources(old)]);
    expect([...loader.toDirectiveMetadataMap(chained.evidence)]).toEqual([...loader.toDirectiveMetadataMap(old)]);
  };

  it('gives the same evidence items, sources per control and directive metadata as the file read', async () => {
    fixture();
    const r = await both(NOW);
    expect(r.old).toHaveLength(5);
    expectIdentical(r);
    const sources = new StamperEvidenceLoader(SLUG).toAssessmentSources(r.chained.evidence);
    expect(sources.get('AC.L1-3.1.1')!.map((s) => s.result)).toEqual(expect.arrayContaining(['imported', 'missing']));
    expect(sources.get('AU.L2-3.3.1')![0].result).toBe('no_query');
    expect(r.run.results[0]).toMatchObject({ planId: 'C11', sourceId: STAMPER_EVIDENCE_SOURCE, status: 'success', newItems: 6 });
    expect(r.run.signals).toEqual([]);
  });

  it('chains each file once with the sha256 of its bytes; reruns add only the index; a rewritten or removed file follows the tree', async () => {
    fixture();
    expectIdentical(await both(NOW));
    const files = store().query({ sourceId: STAMPER_EVIDENCE_SOURCE }).filter((x) => x.endpoint === 'stamper_evidence/file');
    expect(files).toHaveLength(5);
    for (const x of files) {
      const p = store().readPayload(x) as { relPath: string; fileSha256: string; controlIds: string[] };
      expect(p.fileSha256).toBe(sha(fs.readFileSync(path.join(evDir, p.relPath))));
      expect(x.controlIds).toEqual([...p.controlIds].sort());
    }

    const again = await both(NOW + 60_000);
    expectIdentical(again);
    expect(again.run.results[0].newItems).toBe(1); // the index only

    write('access_control/ac-notsat.json', rec({ verdict: 'SAT', controlIds: ['AC.L1-3.1.1'], entry: 'AC-02' }));
    fs.rmSync(path.join(evDir, 'audit_accountability', 'au-404.json'));
    const changed = await both(NOW + 120_000);
    expectIdentical(changed);
    expect(changed.run.results[0].newItems).toBe(2); // the rewritten file and the index
    expect(changed.chained.evidence.some((e) => e.entryId === 'AU-01')).toBe(false);
    expect(store().verify().ok).toBe(true);
  });

  it('chains the tenant\'s stamper_evidence_metadata rows with their hash; the latest attempt is marked', async () => {
    const content = path.join(tmp, 'Stamper', 'storage', 'evidence', 'p1', 't1', 'a1', 'content.json');
    fs.mkdirSync(path.dirname(content), { recursive: true });
    fs.writeFileSync(content, '{"a":1}');
    const h = sha(fs.readFileSync(content));
    const repo = getCesRepository(path.join(tmp, 'ces.db'));
    const data = (hash: string) => ({ artifact_id: 'a1', task_id: 't1', control_ids: ['SI.L1-3.14.1'], storage_location: content, sha256_hash: hash });
    repo.put('stamper_evidence_metadata', { id: 'p1:t1:a1#1', ces: { tenantId: TENANT }, data: data('0'.repeat(64)) });
    repo.put('stamper_evidence_metadata', { id: 'p1:t1:a1#2', ces: { tenantId: TENANT }, data: data(h) });
    repo.put('stamper_evidence_metadata', { id: 'p9:t9:a9#1', ces: { tenantId: OTHER }, data: data(h) });

    const r = await both(NOW);
    expectIdentical(r);
    const rows = store().query({ sourceId: STAMPER_EVIDENCE_SOURCE }).filter((x) => x.endpoint === 'stamper_evidence/row')
      .map((x) => store().readPayload(x) as StamperEvidenceRowItem);
    expect(rows.map((x) => [x.rowId, x.latest, x.metaSha256 === (x.row as { sha256_hash: string }).sha256_hash, x.fileSha256]).sort()).toEqual([
      ['p1:t1:a1#1', false, true, h],
      ['p1:t1:a1#2', true, true, h],
    ]);
    expect(rows.find((x) => x.latest)!.metaSha256).toBe(h);
  });

  it('an absent evidence folder and DB give no evidence and one index record (the DB is not created)', async () => {
    const r = await both(NOW);
    expectIdentical(r);
    expect(r.old).toEqual([]);
    expect(r.run.results[0].newItems).toBe(1);
    expect(fs.existsSync(path.join(tmp, 'ces.db'))).toBe(false);
  });
});
