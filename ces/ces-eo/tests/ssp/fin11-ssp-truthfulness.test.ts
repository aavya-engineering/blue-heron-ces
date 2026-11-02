// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FIN-11 (finishing plan, SSP truthfulness; FINISH-PLAN.md §3.2, check V111): provisional narratives are
 * evidence-aware fallbacks that never claim; PS.L2-3.9.2's text is about terminations and transfers; the approach
 * block resolves tenant-signal, AdminOps and interview rows and counts every EC upload the finding cites; the
 * records sentence no longer says records "leave this control's assessed status unchanged"; "Non-Technology Stack"
 * only on the 28-control non-stack set; the Key Vault HSM text is gone; the A-21 KB entry has a procedure;
 * a placeholder tenant name is never the organisation name. Text only: no control status or SPRS value moves (AR5).
 */
import { describe, test, expect, jest, beforeAll, afterAll } from '@jest/globals';

jest.mock('ces-shared/blob', () => ({
  uploadEvidenceBlob: jest.fn(),
  downloadBlob: jest.fn(),
}), { virtual: true });

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import JSZip from 'jszip';
import type { AssessmentSnapshot } from 'ces-shared/types/controls';
import type { DeterminationLedger } from '../../src/eo/assessment/DeterminationLedger.js';
import { StamperEvidenceLoader } from '../../src/eo/evidence/StamperEvidenceLoader.js';
import { ecItemIdsFromSources, ecItemsToSources } from '../../src/eo/evidence/EcEvidenceReader.js';
import { SspDocxExporter, NONSTACK_TENANT_READ_LABEL } from '../../src/eo/ssp/SspDocxExporter.js';
import { assessmentApproachFor, nonStackPractices, isNonStackPractice } from '../../src/eo/ssp/AssessorApproach.js';
import { recordsSentence, RECORDS_STATUS_SENTENCE } from '../../src/eo/ssp/OrganisationRecords.js';
import { applySimulationMarker } from '../../src/eo/ssp/OdpValueProvider.js';
import { AdminOpsKnowledgeBankLoader } from '../../src/eo/ssp/AdminOpsKnowledgeBankLoader.js';
import { scEvaluators } from '../../src/eo/mapping/evaluators/sc-evaluators.js';
import { loadNegationLexicon } from '../../src/eo/ssp/NarrativeNegationGuard.js';
import { buildGoldenAssessment, buildGoldenManifests } from './golden-fixtures.js';

const _require = createRequire(__filename);
const controlsRefPath = _require.resolve('ces-shared/data/cmmc-l2-controls');
const sprsWeightsPath = _require.resolve('ces-shared/data/sprs-weights');
const FIXTURES = path.resolve(__dirname, '../fixtures/ssp-uplift');
const SLUG = 'muster-partial';
const readJson = <T>(name: string): T => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf-8')) as T;
const PROVISIONAL: Array<{ control_id: string; requirement: string; expected_evidence: string[] }> =
  JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../src/shared/data/provisional-narratives.json'), 'utf-8')).narratives;

type Mod = typeof import('../../src/eo/ssp/SspGenerator.js');
let mod: Mod;
beforeAll(async () => { mod = await import('../../src/eo/ssp/SspGenerator.js'); });

const claimHits = (text: string) => mod.IMPLEMENTATION_CLAIM_PATTERNS.filter(re => new RegExp(re.source, 'i').test(text)).map(String);

// The 28 controls of AUDIT-NONSTACK.md §1 (25 with no stack-signal objective + 3 store-decided).
const NON_STACK_28 = [
  'AT.L2-3.2.1', 'AT.L2-3.2.2', 'AT.L2-3.2.3', 'AU.L2-3.3.8', 'AU.L2-3.3.9', 'CA.L2-3.12.1', 'CA.L2-3.12.2', 'CA.L2-3.12.3',
  'CA.L2-3.12.4', 'CM.L2-3.4.4', 'IR.L2-3.6.2', 'IR.L2-3.6.3', 'MA.L2-3.7.1', 'MA.L2-3.7.2', 'MA.L2-3.7.3', 'MA.L2-3.7.6',
  'MP.L1-3.8.3', 'MP.L2-3.8.4', 'MP.L2-3.8.9', 'PE.L1-3.10.1', 'PE.L1-3.10.3', 'PE.L1-3.10.4', 'PE.L1-3.10.5', 'PE.L2-3.10.2',
  'PE.L2-3.10.6', 'PS.L2-3.9.1', 'PS.L2-3.9.2', 'RA.L2-3.11.1',
];

describe('FIN-11 provisional fallback narratives', () => {
  test('non-met statuses: the lead, the not-yet-shown line, no implementation claim; met: no negation phrase', () => {
    const lexicon = loadNegationLexicon();
    for (const e of PROVISIONAL) {
      for (const status of ['not_met', 'not_assessed', 'partial']) {
        const n = mod.provisionalFallbackNarrative(e, status);
        expect(n.startsWith(mod.PROVISIONAL_LEAD)).toBe(true);
        expect(n).toMatch(/not yet shown to be in place/);
        expect({ id: e.control_id, status, hits: claimHits(n) }).toEqual({ id: e.control_id, status, hits: [] });
        expect(mod.withoutImplementationClaims(n)).toBe(n);
      }
      const met = mod.provisionalFallbackNarrative(e, 'met', 'Stamper evidence, 1 record(s) in the current run: x.json.');
      expect(met).toContain('Status this run: assessed met.');
      expect(met).toContain('**Evidence:** Stamper evidence, 1 record(s)');
      expect({ id: e.control_id, hits: lexicon.filter(p => met.toLowerCase().includes(p.toLowerCase())) }).toEqual({ id: e.control_id, hits: [] });
    }
  });
});

describe('FIN-11 approach block: held resolved for tenant-signal, AdminOps and interview rows', () => {
  test('stack_signal, ao_row and interview rows are held / not held when their source is known', () => {
    const states = (h: Parameters<typeof assessmentApproachFor>[1]) => assessmentApproachFor('PS.L2-3.9.2', h)!
      .objectives.flatMap(o => o.evidence.map(e => ({ o: o.objectiveId, s: e.cesSource, h: e.held, a: e.artifactType })));
    const unknown = states({});
    expect(unknown.filter(r => ['stack_signal', 'ao_row', 'interview'].includes(r.s)).every(r => r.h === 'unknown')).toBe(true);

    const known = states({ stackSignalsRead: true, adminOpsCommandIds: ['A-21'], interviewObjectiveIds: ['PS.L2-3.9.2[a]'] });
    const ao = known.filter(r => r.s === 'ao_row');
    expect(ao.length).toBeGreaterThan(0);
    expect(ao.some(r => r.h === 'held')).toBe(true);
    // G-06 is registered too; with only A-21 run, the G-06 row is not held.
    expect(ao.filter(r => r.h === 'not_held').length).toBeGreaterThan(0);
    for (const r of known.filter(x => x.s === 'interview')) expect(r.h).toBe(r.o === 'PS.L2-3.9.2[a]' ? 'held' : 'not_held');
    for (const r of known.filter(x => x.s === 'stack_signal')) expect(r.h).toBe('held');

    const none = states({ stackSignalsRead: false, adminOpsCommandIds: [], interviewObjectiveIds: [] });
    for (const r of none.filter(x => ['stack_signal', 'ao_row', 'interview'].includes(x.s))) expect(r.h).toBe('not_held');
  });

  test('an EC row names the upload count; a Stamper row that names no entry is never claimed held', () => {
    const a = assessmentApproachFor('PE.L1-3.10.1', { ecUploads: 2, stamperEntryIds: ['PE.L1-3.10.1.badge-export'] })!;
    const a0 = a.objectives[0];
    expect(a0.text).toContain('(Evidence Collector upload: 2 uploads on this control this run)');
    // "Physical protection policy" names no Stamper entry: some other record of the control does not prove it.
    expect(a0.evidence.find(e => e.cesSource === 'stamper_evidence')!.held).toBe('unknown');
    const none = assessmentApproachFor('PE.L1-3.10.1', { stamperEntryIds: [] })!;
    expect(none.objectives[0].evidence.find(e => e.cesSource === 'stamper_evidence')!.held).toBe('not_held');
  });

  test('EC count: every EC item on the control, and never fewer than the uploads the finding cites', () => {
    const sources = ecItemsToSources([
      { itemId: 'eci-1', filename: 'a.json', source: 'ec', collectedAt: '2026-10-31T00:00:00Z', controlIds: ['PE.L1-3.10.1'] },
      { itemId: 'eci-2', filename: 'b.json', source: 'ec', collectedAt: '2026-10-31T00:00:00Z', controlIds: ['PE.L1-3.10.1'], form_id: 'F-1' },
    ] as any).get('PE.L1-3.10.1');
    expect(ecItemIdsFromSources(sources).sort()).toEqual(['eci-1', 'eci-2']);
    const finding = 'PE.L1-3.10.1[a] met by x (review r1, sha256 f47f9dfb2cd9); PE.L1-3.10.1[b] met by x (review r2, sha256 1019c7a5d73b); '
      + 'PE.L1-3.10.1[c] met by x (review r3, sha256 1019c7a5d73b)';
    expect(mod.ecUploadCount(undefined, finding)).toBe(2);
    expect(mod.ecUploadCount(sources, finding)).toBe(2);
    expect(mod.ecUploadCount(sources, undefined)).toBe(2);
    expect(mod.ecUploadCount([], undefined)).toBe(0);
  });

  test('AdminOps command ids come from the AdminOps sources only', () => {
    expect(mod.adminOpsCommandIdsOf([
      { type: 'adminops_execution', timestamp: '', detail: 'A-21 (corr-1)', result: 'imported' },
      { type: 'adminops_execution', timestamp: '', detail: 'G-06 read-only op (state not verified)', result: 'imported' },
      { type: 'discovery', timestamp: '', detail: 'B-01 something', result: 'exists' },
    ] as any).sort()).toEqual(['A-21', 'G-06']);
    expect(mod.interviewObjectiveIdsOf(undefined)).toBeUndefined();
    expect(mod.interviewObjectiveIdsOf([{ objectives: [{ controlId: 'PE.L1-3.10.1', objectiveIds: ['PE.L1-3.10.1[a]', 'PE.L1-3.10.1[b]'] }] }] as any))
      .toEqual(['PE.L1-3.10.1[a]', 'PE.L1-3.10.1[b]']);
  });
});

describe('FIN-11 records sentence, non-stack set, KB and evaluator text', () => {
  test('the records sentence no longer says the records leave the status unchanged', () => {
    const s = recordsSentence([{ count: 1, kindLabel: 'visitor log', dateFrom: '2026-10-01', dateTo: '2026-10-01', filename: 'v.json', itemId: 'eci-v', sha256: 'a'.repeat(64) } as any]);
    expect(s).not.toMatch(/leave this control's assessed status unchanged/);
    expect(s.endsWith(RECORDS_STATUS_SENTENCE)).toBe(true);
    expect(s).toContain('(GD-b)');
  });

  test('the non-stack set is the 28 controls of the non-stack audit', () => {
    expect([...nonStackPractices()].sort()).toEqual([...NON_STACK_28].sort());
    expect(isNonStackPractice('AC.L2-3.1.17')).toBe(false);
    expect(isNonStackPractice('SI.L2-3.14.6')).toBe(false);
    expect(isNonStackPractice('PS.L2-3.9.2')).toBe(true);
  });

  test('cryptoKeyManagementEvaluator: still met when Secure Score reads; no Key Vault / HSM claim', () => {
    const v = scEvaluators.cryptoKeyManagementEvaluator([
      { signalId: 'secureScores', source: 'graph', endpoint: '/security/secureScores', timestamp: '', status: 'success', rawData: { value: [{ currentScore: 1 }] } },
    ] as any, {} as any) as { status: string; evidence: string };
    expect(v.status).toBe('met');
    expect(v.evidence).not.toMatch(/HSM|verified via Azure Key Vault/);
    expect(v.evidence).toMatch(/Secure Score/);
  });

  test('the A-21 KB entry carries a procedure (cmdlets, endpoint, permission, role)', () => {
    const loader = new AdminOpsKnowledgeBankLoader(path.resolve(__dirname, '../../knowledge-banks/adminops'));
    loader.loadAdminOpsKnowledgeBanks();
    const kb = loader.getKnowledgeBank('PS.L2-3.9.2')!;
    expect(kb.useCaseId).toBe('A-21');
    expect(kb.configurationSteps.powershellCmdlets.length).toBeGreaterThan(0);
    expect(kb.configurationSteps.graphApiEndpoint).toMatch(/lifecycleWorkflows\/workflows/);
    expect(kb.configurationSteps.requiredPermissions).toContain('LifecycleWorkflows.ReadWrite.All');
    expect(kb.entraRolesRequired.length).toBeGreaterThan(0);
    expect(kb.configurationSteps.portalPath.length).toBeGreaterThan(0);
    expect(JSON.stringify(kb)).not.toMatch(/\[VERIFY\]|\bN\/A\b/);
  });
});

describe('FIN-11 PKG-2 remainder: names', () => {
  const MARKER = 'SIMULATED CUSTOMER (FICTIONAL): ';
  const profile = { simulation: { simulated: true, legalName: 'Hollinford Precision Machining LLC (FICTIONAL)' } } as any;

  test('a system name equal to the legal name (spacing, case or doubling aside) gives the marker alone', () => {
    for (const name of ['Hollinford Precision Machining LLC (FICTIONAL)', ' hollinford  precision machining llc (fictional) ',
      'Hollinford Precision Machining LLC (FICTIONAL) - Hollinford Precision Machining LLC (FICTIONAL)']) {
      const doc = applySimulationMarker({ systemName: name }, profile);
      expect(doc.systemName).toBe(`${MARKER}Hollinford Precision Machining LLC (FICTIONAL)`);
    }
    expect(applySimulationMarker({ systemName: 'Plant 2 enclave' }, profile).systemName)
      .toBe(`${MARKER}Hollinford Precision Machining LLC (FICTIONAL) - Plant 2 enclave`);
  });

  test('"Sim Tenant" is never the organisation name, nor the tenant name in narratives', () => {
    const generate = (identity: Record<string, unknown>) => {
      const m = buildGoldenManifests() as any;
      m.tenantManifest.tenant_identity = identity;
      return new mod.SspGenerator(controlsRefPath, sprsWeightsPath).generate({ assessment: buildGoldenAssessment(controlsRefPath), manifests: m });
    };
    const sim = generate({ display_name: 'Sim Tenant', primary_domain: 'muster-partial.simtenant.example.test' });
    expect(sim.organizationName).toBeUndefined();
    expect(JSON.stringify(sim.controlImplementations)).not.toContain('Sim Tenant');
    const real = generate({ display_name: 'Golden Reference Defense Co.' });
    expect(real.organizationName).toBe('Golden Reference Defense Co.');
  });
});

// Same text extraction and heading split as verify.mjs V31.
const decodeXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const docxTextOf = (xml: string) => decodeXml(xml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (m) => `${m.replace(/<[^>]+>/g, '')}\n`).replace(/<[^>]+>/g, ''));
const HEADING = /^([A-Z]{2}\.L[123]-\d+\.\d+\.\d+) — \d+\.\d+\.\d+$/;

describe('FIN-11 on run 23: text only, no status move', () => {
  const prevRoot = process.env.CES_PIPELINE_ROOT;
  let tmp: string;
  let snapshot: AssessmentSnapshot;
  let ssp: any;
  let withInterviews: any;

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fin11-'));
    process.env.CES_PIPELINE_ROOT = tmp;
    const evidenceDir = path.join(tmp, 'Stamper', 'plan-data', SLUG, 'evidence');
    for (const r of readJson<Array<{ path: string; record: unknown }>>('stamper-evidence-run23.json')) {
      const file = path.join(evidenceDir, ...r.path.split('/'));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(r.record));
    }
    const stamperEvidence = new StamperEvidenceLoader(SLUG).loadEvidenceForTenant();
    snapshot = readJson<AssessmentSnapshot>('snapshot-run23.json');
    const base = () => ({
      assessment: JSON.parse(JSON.stringify(snapshot)) as AssessmentSnapshot,
      ledger: readJson<DeterminationLedger>('ledger-run23.json'),
      variables: {},
      tenantSlug: SLUG,
      stamperEvidence,
    });
    ssp = new mod.SspGenerator(controlsRefPath, sprsWeightsPath).generate(base());
    withInterviews = new mod.SspGenerator(controlsRefPath, sprsWeightsPath).generate({
      ...base(),
      interviewRecords: [{ objectives: [{ controlId: 'CA.L2-3.12.4', objectiveIds: ['CA.L2-3.12.4[a]'] }] }] as any,
    });
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    if (prevRoot === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = prevRoot;
  });

  test('AR5: every control status equals the snapshot; SPRS values equal with and without interview records', () => {
    const byId = new Map(snapshot.controls.map(c => [c.control_id, c.status]));
    for (const c of ssp.controlImplementations) {
      if (byId.has(c.control_id) && byId.get(c.control_id) !== 'partial') expect({ id: c.control_id, s: c.status }).toEqual({ id: c.control_id, s: byId.get(c.control_id) });
    }
    expect(withInterviews.controlImplementations.map((c: any) => [c.control_id, c.status, c.sprsValue ?? null]))
      .toEqual(ssp.controlImplementations.map((c: any) => [c.control_id, c.status, c.sprsValue ?? null]));
  });

  test('the 13 provisional controls: a signal narrative or the provisional fallback; never a claim when not met', () => {
    const ids = new Set(PROVISIONAL.map(p => p.control_id));
    const cis = ssp.controlImplementations.filter((c: any) => ids.has(c.control_id));
    expect(cis).toHaveLength(13);
    const viaFallback = cis.filter((c: any) => c.implementationNarrative.startsWith(mod.PROVISIONAL_LEAD));
    expect(viaFallback.length).toBeGreaterThan(0);
    for (const c of cis) {
      const snap = snapshot.controls.find(s => s.control_id === c.control_id);
      const hasSignals = (snap?.signals ?? []).length > 0;
      expect({ id: c.control_id, fallback: c.implementationNarrative.startsWith(mod.PROVISIONAL_LEAD) }).toEqual({ id: c.control_id, fallback: !hasSignals });
      if (c.status !== 'met') expect({ id: c.control_id, hits: claimHits(c.implementationNarrative) }).toEqual({ id: c.control_id, hits: [] });
      for (const old of ['The organization maintains a System Security Plan', 'reviewed and signed by the System Owner', 'exported as CSV/PDF reports', '90-day default']) {
        expect(c.implementationNarrative).not.toContain(old);
      }
    }
    const ps2 = cis.find((c: any) => c.control_id === 'PS.L2-3.9.2');
    if (ps2.implementationNarrative.startsWith(mod.PROVISIONAL_LEAD)) expect(ps2.implementationNarrative).toContain('terminations and transfers');
  });

  test('CA.L2-3.12.4 states its signature state without claiming a signature', () => {
    const ca = ssp.controlImplementations.find((c: any) => c.control_id === 'CA.L2-3.12.4');
    expect(ca.implementationNarrative).toContain('It is not yet signed');
    expect(ca.implementationNarrative).not.toMatch(/signed by/);
  });

  test('approach rows: no tenant-signal or AdminOps row is "not checked" on an assessed control; interviews resolve when records are given', () => {
    const assessed = new Set(snapshot.controls.map(c => c.control_id));
    for (const c of ssp.controlImplementations) {
      if (!assessed.has(c.control_id)) continue;
      for (const o of c.assessmentApproach.objectives) for (const e of o.evidence) {
        if (e.cesSource === 'stack_signal' || e.cesSource === 'ao_row' || e.cesSource === 'ec_upload') {
          expect({ id: o.objectiveId, s: e.cesSource, h: e.held === 'unknown' }).toEqual({ id: o.objectiveId, s: e.cesSource, h: false });
        }
      }
    }
    // No CES database in this temp pipeline root, so interview rows stay unknown without the input.
    expect(ssp.controlImplementations.flatMap((c: any) => c.assessmentApproach.objectives.flatMap((o: any) => o.evidence))
      .filter((e: any) => e.cesSource === 'interview').every((e: any) => e.held === 'unknown')).toBe(true);
    const ca = withInterviews.controlImplementations.find((c: any) => c.control_id === 'CA.L2-3.12.4');
    const rows = ca.assessmentApproach.objectives.flatMap((o: any) => o.evidence.filter((e: any) => e.cesSource === 'interview').map((e: any) => [o.objectiveId, e.held]));
    expect(rows.length).toBeGreaterThan(0);
    for (const [oid, h] of rows) expect(h).toBe(oid === 'CA.L2-3.12.4[a]' ? 'held' : 'not_held');
  });

  test('DOCX: "Non-Technology Stack" only on the non-stack set; other nonstack controls say tenant read', async () => {
    const buf = await new SspDocxExporter().export(ssp);
    const xml = await (await JSZip.loadAsync(buf)).file('word/document.xml')!.async('string');
    const lines = docxTextOf(xml).split('\n');
    const starts = new Map<string, number>();
    lines.forEach((l, i) => { const m = l.trim().match(HEADING); if (m && !starts.has(m[1])) starts.set(m[1], i); });
    const order = [...starts.entries()].sort((x, y) => x[1] - y[1]);
    const blocks = new Map<string, string>();
    order.forEach(([id, at], k) => blocks.set(id, lines.slice(at, k + 1 < order.length ? order[k + 1][1] : lines.length).join('\n')));
    let tenantRead = 0;
    for (const c of ssp.controlImplementations) {
      const block = blocks.get(c.control_id) ?? '';
      const nonTech = block.includes('Classification: Non-Technology Stack');
      expect({ id: c.control_id, nonTech }).toEqual({ id: c.control_id, nonTech: c.classification === 'nonstack' && isNonStackPractice(c.control_id) });
      if (c.classification === 'nonstack' && !isNonStackPractice(c.control_id)) {
        expect(block).toContain(`Classification: ${NONSTACK_TENANT_READ_LABEL}`);
        tenantRead++;
      }
    }
    expect(tenantRead).toBeGreaterThan(0);
  });
});
