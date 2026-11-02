/**
 * W5 cycle 4 (SC-3a): the examine coverage map (data/examine-coverage-map.json) on the evidence index.
 * Fixture: tests/fixtures/w5c4-evidence-index/run49c-inputs.json = run 49c (fictional S1) shapes, trimmed: eleven
 * SSP controls with their evidenceDetails as generated, and the store records of seventeen sources (ids, payload
 * hashes and times from the run-49c store manifest). The organisation records are the w5c3-records fixtures, put on
 * the controls by applyOrganisationRecords exactly as the SSP route does. Golden:
 * tests/fixtures/w5c4-evidence-index/expected-index.json (regenerate with UPDATE_GOLDEN=1 after a reviewed change).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { EcEvidenceItem } from 'ces-shared/types/evidence-collector';
import {
  buildEvidenceIndex, coverageRuleFor, examineItemKinds, loadExamineCoverageMap, loadExamineLists, type IndexControl,
} from '../../../src/eo/packager/EvidenceIndex.js';
import { methodForStoreSource } from '../../../src/eo/packager/MethodLabeler.js';
import { applyOrganisationRecords, parseOrganisationRecord } from '../../../src/eo/ssp/OrganisationRecords.js';

const FX = path.resolve(__dirname, '../../fixtures/w5c4-evidence-index');
const REC = path.resolve(__dirname, '../../fixtures/w5c3-records');
const GOLDEN = path.join(FX, 'expected-index.json');
const fx = JSON.parse(fs.readFileSync(path.join(FX, 'run49c-inputs.json'), 'utf8'));
const catalog = JSON.parse(fs.readFileSync(path.join(REC, 'catalog.json'), 'utf8')) as { items: Array<{ file: string; control_ids: string[]; collected_at: string }> };
const PRESENT = ['audit-log-reviews.json', 'personnel-lifecycle.json', 'personnel-screening.json', 'physical-access-devices.json', 'training-role-based.json'];

function orgRecords() {
  return PRESENT.map(file => {
    const c = catalog.items.find(i => i.file === file)!;
    const content = fs.readFileSync(path.join(REC, file));
    const item: EcEvidenceItem = {
      contractVersion: '1.0.0', itemId: `eci-fixture-${file.replace(/\.json$/, '')}`, tenantSlug: 's1-mach', controlIds: c.control_ids, source: 'manual_upload',
      filename: file, mediaType: 'application/json', sha256: createHash('sha256').update(content).digest('hex'), sizeBytes: content.length,
      collectedAt: c.collected_at, submittedByRole: 'compliance_officer', mode: 'sim',
    };
    return parseOrganisationRecord(item, content)!;
  });
}
function sspControls(): Array<IndexControl & { implementationNarrative: string; status: string }> {
  const ssp = { controlImplementations: JSON.parse(JSON.stringify(fx.controls)) };
  applyOrganisationRecords(ssp, orgRecords());
  return ssp.controlImplementations;
}
const build = (controls = sspControls(), records = fx.records) =>
  buildEvidenceIndex({ controls, records, tenantId: fx.tenantId, tenantSlug: 's1-mach', sspId: fx.sspId, generatedAt: fx.generatedAt });
const golden = (ix: ReturnType<typeof build>) => ({
  summary: ix.summary,
  examineCoverage: ix.examineCoverage,
  attached: ix.entries.filter(e => e.attachment),
});
const automatable = (ix: ReturnType<typeof build>) =>
  ix.examineCoverage.flatMap(c => c.items.map(i => ({ c: c.controlId, ...i }))).filter(i => !['documentary', 'ssp', 'poam'].includes(i.category));

describe('W5c4 examine coverage map (SC-3a)', () => {
  const ix = build();

  it('golden: the index of the run-49c fixture (coverage per item, attached entries, summary)', () => {
    if (process.env.UPDATE_GOLDEN === '1') fs.writeFileSync(GOLDEN, JSON.stringify(golden(ix), null, 1) + '\n');
    expect(golden(ix)).toEqual(JSON.parse(fs.readFileSync(GOLDEN, 'utf8')));
  });

  it('SC-3a on the fixture: the automatable items it covers before and after the map', () => {
    const none = buildEvidenceIndex({ controls: fx.controls, records: fx.records, generatedAt: fx.generatedAt, coverageMap: { items: [] } });
    const cov = (x: ReturnType<typeof build>) => automatable(x).filter(i => i.status === 'covered').length;
    expect([cov(none), automatable(none).length]).toEqual([21, 47]);
    expect([cov(ix), automatable(ix).length]).toEqual([35, 38]);
  });

  it('every attached entry is labelled examine, carries a hash and resolves to a fixture record or an organisation record', () => {
    const recs = new Map(fx.records.map((r: { recordId: string }) => [r.recordId, r]));
    const org = new Map(orgRecords().map(r => [r.itemId, r]));
    const attached = ix.entries.filter(e => e.attachment);
    expect(attached.length).toBe(ix.summary.attachedEntries);
    expect(attached.length).toBeGreaterThan(0);
    for (const e of attached) {
      expect(e.method).toBe('examine');
      expect(e.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(e.examineItems!.length).toBeGreaterThan(0);
      if (e.kind === 'evidence-store') {
        const r = recs.get(e.recordId!) as { payloadSha256: string; status: string } | undefined;
        expect(r).toBeDefined();
        expect(r!.payloadSha256).toBe(e.sha256);
        expect(r!.status).toBe('success');
      } else {
        expect(e.kind).toBe('organisation-record');
        expect(org.get(e.ecItemId!)!.sha256).toBe(e.sha256);
      }
    }
    // Each covered-by reference points at an attached entry of the same control.
    for (const c of ix.examineCoverage) for (const it of c.items.filter(i => i.coveredBy)) {
      const e = attached.find(x => x.controlId === c.controlId && x.sha256 === it.coveredBy!.sha256 && x.examineItems!.includes(it.index));
      expect(e).toBeDefined();
    }
  });

  it('class b: the latest returned, hashed record of the first listed source; never an empty, failed or unhashed read', () => {
    const ac = ix.examineCoverage.find(c => c.controlId === 'AC.L1-3.1.1')!;
    const audit = ac.items.find(i => i.text === 'system audit logs and records')!;
    expect(audit.coveredBy).toMatchObject({ kind: 'evidence-store', sourceId: 'collect.unifiedAuditLog' });
    const ual = fx.records.filter((r: { sourceId: string; status: string }) => r.sourceId === 'collect.unifiedAuditLog' && r.status === 'success')
      .sort((a: { seq: number }, b: { seq: number }) => b.seq - a.seq)[0];
    expect(audit.coveredBy!.recordId).toBe(ual.recordId);
    const devices = ac.items.find(i => i.text === 'list of devices and systems authorized to connect to organizational systems')!;
    expect(devices.coveredBy!.recordId).not.toBe('fixture-no-hash');
    const disabled = ac.items.find(i => i.text.startsWith('list of recently disabled system accounts'))!;
    expect(disabled.coveredBy!.sourceId).toBe('directoryUsers');
    // With no store records nothing is attached: the map never covers an item by itself.
    const bare = build(sspControls(), []);
    expect(bare.entries.some(e => e.attachment && e.kind === 'evidence-store')).toBe(false);
    expect(bare.examineCoverage.find(c => c.controlId === 'AC.L1-3.1.1')!.items.find(i => i.text === 'system audit logs and records')!.status).toBe('not covered');
  });

  it('class a: a configuration item the control already holds is covered without an attachment', () => {
    const si = ix.examineCoverage.find(c => c.controlId === 'SI.L1-3.14.2')!.items.find(i => i.text === 'malicious code protection mechanisms')!;
    expect(si).toMatchObject({ category: 'security-monitoring', status: 'covered' });
    expect(si.kinds).toEqual(expect.arrayContaining(['security-monitoring', 'configuration', 'stamper-file']));
    expect(si.coveredBy).toBeUndefined();
    const sc = ix.examineCoverage.find(c => c.controlId === 'SC.L1-3.13.1')!.items.find(i => i.text === 'boundary protection hardware and software')!;
    expect(sc.status).toBe('covered');
  });

  it('class e: the record the SSP lists on the control first, then any record of the kind; without records the items stay open', () => {
    const at = ix.examineCoverage.find(c => c.controlId === 'AT.L2-3.2.2')!.items.find(i => i.text === 'training records')!;
    expect(at.coveredBy).toMatchObject({ kind: 'organisation-record', file: 'training-role-based.json' });
    const pe = ix.examineCoverage.find(c => c.controlId === 'PE.L1-3.10.5')!.items.find(i => i.text === 'inventory records of physical access control devices')!;
    expect(pe.coveredBy).toMatchObject({ kind: 'organisation-record', file: 'physical-access-devices.json' });
    const ps = ix.examineCoverage.find(c => c.controlId === 'PS.L2-3.9.1')!.items.find(i => i.text === 'records of screened personnel')!;
    expect(ps.coveredBy!.file).toBe('personnel-screening.json');
    const noRecords = build(JSON.parse(JSON.stringify(fx.controls)));
    expect(noRecords.examineCoverage.find(c => c.controlId === 'PS.L2-3.9.1')!.items.find(i => i.text === 'records of screened personnel')!.status).toBe('not covered');
    expect(noRecords.entries.some(e => e.kind === 'organisation-record')).toBe(false);
  });

  it('class d: reclassified to documentary with the reason, uncovered even where a kind used to cover it; never credited unless a policy item', () => {
    const at1 = ix.examineCoverage.find(c => c.controlId === 'AT.L2-3.2.1')!.items.find(i => i.text === 'security awareness training curriculum')!;
    expect(at1).toMatchObject({ category: 'documentary', kinds: [], status: 'not covered', reclassified: { from: 'training', to: 'documentary' } });
    expect(at1.reclassified!.reason).toMatch(/document/);
    const ac5 = ix.examineCoverage.find(c => c.controlId === 'AC.L2-3.1.5')!.items.find(i => i.text === 'list of conditions for group and role membership')!;
    expect(ac5).toMatchObject({ category: 'documentary', status: 'not covered', reclassified: { from: 'accounts' } });
    expect(ix.summary.reclassifiedItems).toBe(ix.examineCoverage.flatMap(c => c.items).filter(i => i.reclassified).length);
  });

  it('the index never changes the SSP: evidenceDetails, status and narrative are the inputs as given', () => {
    const controls = sspControls();
    const before = JSON.stringify(controls);
    build(controls);
    expect(JSON.stringify(controls)).toBe(before);
    for (const [i, c] of controls.entries()) {
      expect(c.evidenceDetails).toEqual(fx.controls[i].evidenceDetails);
      expect(c.status).toBe(fx.controls[i].status);
    }
    // The SSP details are still one entry each, with their own method label.
    const detailEntries = ix.entries.filter(e => !e.attachment);
    expect(detailEntries.length).toBe(fx.controls.reduce((n: number, c: { evidenceDetails: unknown[] }) => n + c.evidenceDetails.length, 0));
  });

  it('applyOrganisationRecords lists every tagged record on its control (any status), idempotently, and nothing else', () => {
    const controls = sspControls();
    const at1 = controls.find(c => c.control_id === 'AU.L2-3.3.8')!;
    expect(at1.organisationRecords!.map(r => [r.file, r.recordKind, r.method])).toEqual([['audit-log-reviews.json', 'audit_log_review', 'examine']]);
    expect(controls.find(c => c.control_id === 'AC.L1-3.1.1')!.organisationRecords).toBeUndefined();
    const ssp = { controlImplementations: controls };
    const once = JSON.stringify(ssp);
    applyOrganisationRecords(ssp, orgRecords());
    expect(JSON.stringify(ssp)).toBe(once);
  });
});

describe('data/examine-coverage-map.json (the reviewable table)', () => {
  const map = loadExamineCoverageMap();
  const lists = loadExamineLists();
  const texts = new Set(lists.requirements.flatMap(r => r.examine.map(t => t.trim().toLowerCase())));

  it('every rule names a real examine item once, carries a reason and the field its class needs', () => {
    const seen = new Set<string>();
    for (const r of map.items) {
      const t = r.text.trim().toLowerCase();
      expect(texts.has(t)).toBe(true);
      // W5 cycle 5: a text may carry one row per requirement scope (`requirements`), still once per scope.
      const key = `${t}|${(r.requirements ?? []).join(',')}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      expect(r.reason.length).toBeGreaterThan(10);
      if (r.class === 'a') expect(r.addKinds?.length).toBeGreaterThan(0);
      if (r.class === 'b') expect(r.storeSources?.length).toBeGreaterThan(0);
      if (r.class === 'e') expect(r.recordKinds?.length).toBeGreaterThan(0);
      if (r.class === 'd') expect(r.reclassify).toBe('documentary');
      if (r.class !== 'd') expect(examineItemKinds(r.text).category).not.toBe('documentary');
    }
  });

  it('class b and e sources are examined evidence-store reads; the new audit configuration read is examine', () => {
    for (const r of map.items) for (const s of r.storeSources ?? []) expect(typeof s).toBe('string');
    expect(methodForStoreSource('adminAuditLogConfig')).toBe('examine');
    expect(coverageRuleFor(map, 'Continuous monitoring strategy')?.class).toBe('d');
  });
});
