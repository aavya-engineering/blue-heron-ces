// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * W5 cycle 1 (EvidenceOps narratives) on run 43's inputs (synthetic customer S1, simulator only), offline.
 * Fixtures in tests/fixtures/w5-run43 (trimmed copies of the archived run): the stored snapshot (83 / 4 / 0 / 23),
 * the ledger's evidence refs, the pushed TM / IM / MP, the two policy envelopes, the POA&M and the Stamper records.
 * The stored snapshot is used as is, so no evaluator runs: only the SSP / ledger composition is under test.
 * Each block names the scorecard row (SC-1 rows 1, 7; SC-2 rows 8, 9, 12, 17; SC-5) the W4 scorecard scores.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import JSZip from 'jszip';
import type { AssessmentSnapshot } from 'ces-shared/types/controls';
import type { PlanOfActionMilestones } from 'ces-shared/types/poam';
import { buildDeterminationLedger, type DeterminationLedger } from '../../src/eo/assessment/DeterminationLedger.js';
import { SspGenerator } from '../../src/eo/ssp/SspGenerator.js';
import { SnippetDataResolver } from '../../src/eo/ssp/SnippetDataResolver.js';
import { AdminOpsDataProvider } from '../../src/eo/ssp/AdminOpsDataProvider.js';
import { OdpValueProvider, applyPolicyInputs, variablesFromPolicyProfile, POLICY_ODPS } from '../../src/eo/ssp/OdpValueProvider.js';
import { SspDocxExporter } from '../../src/eo/ssp/SspDocxExporter.js';
import { NOT_SUPPLIED } from '../../src/eo/ssp/ContentGap.js';
import type { StamperEvidence } from '../../src/eo/evidence/StamperEvidenceLoader.js';

const _require = createRequire(__filename);
const controlsRefPath = _require.resolve('ces-shared/data/cmmc-l2-controls');
const sprsWeightsPath = _require.resolve('ces-shared/data/sprs-weights');
const FX = path.resolve(__dirname, '../fixtures/w5-run43');
const readJson = <T>(name: string): T => JSON.parse(fs.readFileSync(path.join(FX, name), 'utf-8')) as T;
const LEXICON = (JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../data/narrative-negation-lexicon.json'), 'utf-8')) as { phrases: string[] }).phrases;
const lexPattern = (p: string) => new RegExp((/^[A-Za-z0-9]/.test(p) ? '(?<![A-Za-z0-9])' : '') + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
// The W4 scorecard's rules (pkg scorecard.mjs): disclosures stripped before the lexicon; the two manual-input markers.
const stripDisclosures = (n: string) => String(n ?? '').replace(/\n\n(Evidence disagreement|Presence only): [\s\S]*?(?=\n\n(Evidence disagreement|Presence only): |$)/g, '');
const MARKERS = [/\[MANUAL INPUT REQUIRED\]/g, /REQUIRES MANUAL INPUT/g];
const markerCount = (s: string) => MARKERS.reduce((n, re) => n + (s.match(re) ?? []).length, 0);

interface Run43Snapshot { tenantId: string; generatedAt: string; signals: Record<string, unknown>; controls: Array<Record<string, unknown> & { signalKeys: string[] }> }
interface Envelopes { profile: Parameters<typeof applyPolicyInputs>[1] & { personnel: Array<{ role_id: string; name: string }> }; manifest: { documents: Array<{ name: string; sha256: string }> } }

function snapshotRun43(): AssessmentSnapshot {
  const fx = readJson<Run43Snapshot>('snapshot-run43.json');
  return {
    tenantId: fx.tenantId, generatedAt: fx.generatedAt,
    controls: fx.controls.map(({ signalKeys, ...c }) => ({ ...c, signals: signalKeys.map(k => fx.signals[k]) })),
  } as unknown as AssessmentSnapshot;
}

async function docxBody(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  return (await zip.file('word/document.xml')!.async('string')).split('</w:p>')
    .map(p => (p.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) ?? []).map(t => t.replace(/<[^>]+>/g, '')).join('')).join('\n');
}

describe('W5 cycle 1: EO narratives on run 43 (S1, offline)', () => {
  let ssp: any;
  let ledger: DeterminationLedger;
  let env: Envelopes;
  let docx: string;
  const ci = (id: string) => ssp.controlImplementations.find((c: { control_id: string }) => c.control_id === id);

  beforeAll(async () => {
    const snapshot = snapshotRun43();
    const refs = readJson<{ refs: Record<string, any[]>; manual: Record<string, any> }>('ledger-refs-run43.json');
    env = readJson<Envelopes>('policy-envelopes-run43.json');
    ledger = buildDeterminationLedger({
      tenantId: snapshot.tenantId, generatedAt: snapshot.generatedAt, snapshot,
      manualControlStatus: refs.manual, evidenceRefsLookup: id => refs.refs[id] ?? [], policyManifest: env.manifest,
    });
    const adminOps = new AdminOpsDataProvider();
    adminOps.initialize();
    const tm = readJson<Record<string, any>>('tm-run43.json');
    const resolver = new SnippetDataResolver({ adminOpsProvider: adminOps, odpValueProvider: new OdpValueProvider(tm.odpValues) });
    const manifests = await resolver.loadManifests('s1-mach', {
      tenantManifestPath: path.join(FX, 'tm-run43.json'), infraManifestPath: path.join(FX, 'im-run43.json'), missionPlanPath: path.join(FX, 'mp-run43.json'),
    });
    const mp = readJson<Record<string, unknown>>('mp-run43.json');
    ssp = new SspGenerator(controlsRefPath, sprsWeightsPath, resolver).generate({
      assessment: snapshot, ledger, poam: readJson<PlanOfActionMilestones>('poam-run43.json'),
      missionPlan: mp, tenantManifest: tm, infraManifest: readJson('im-run43.json'), manifests, registries: [], policies: [],
      variables: variablesFromPolicyProfile(env.profile), tenantSlug: 's1-mach',
      stamperEvidence: readJson<StamperEvidence[]>('stamper-evidence-run43.json'),
    });
    applyPolicyInputs(ssp, env.profile, env.manifest, mp);
    docx = await docxBody(await new SspDocxExporter().export(ssp));
  }, 120000);

  test('status counts are the stored run 43 (83 / 4 / 0 / 23): composition only, no status moves', () => {
    const n = (s: string) => ssp.controlImplementations.filter((c: { status: string }) => c.status === s).length;
    expect([n('met'), n('not_met'), n('partial'), n('not_assessed')]).toEqual([83, 4, 0, 23]);
    expect(ledger.summary.controlsMet).toBe(83);
  });

  test('SC-1 row 1 (G-b9493aba2f): no met narrative hits the negation lexicon or carries a manual-input marker (was 19)', () => {
    const bad = ssp.controlImplementations.filter((c: any) => c.status === 'met' && (LEXICON.some(p => lexPattern(p).test(stripDisclosures(c.implementationNarrative))) || markerCount(c.implementationNarrative) > 0));
    expect(bad.map((c: any) => c.control_id)).toEqual([]);
  });

  test('a met narrative describes the reads that made it met: counts from the reads', () => {
    expect(ci('AC.L1-3.1.1').implementationNarrative).toContain('**S1-CA01 Require MFA - all users** (enabled)');
    expect((ci('AC.L1-3.1.1').implementationNarrative.match(/^- \*\*/gm) ?? []).length).toBe(14);
    expect(ci('AC.L1-3.1.1').implementationNarrative).toContain('for 5 directory roles');
    expect(ci('CM.L2-3.4.1').implementationNarrative).toContain('58 managed devices are inventoried');
    expect(ci('SC.L2-3.13.11').implementationNarrative).toContain('on 58 managed devices');
    // IA.L1-3.5.1 has no template: met at Tier 4, the narrative states that basis and the 53-user read.
    const ia = ci('IA.L1-3.5.1').implementationNarrative;
    expect(ia).toContain('Determination basis: Tier 4 (evidence-only Stamper SAT) decides');
    expect(ia).toContain('directoryUsers returned 53 objects (/users)');
  });

  test('the not-met narratives are untouched by the met-only rule (negations stay where the control is not met)', () => {
    const notMet = ssp.controlImplementations.filter((c: any) => c.status === 'not_met');
    expect(notMet).toHaveLength(4);
    for (const c of notMet) expect(c.implementationNarrative.length).toBeGreaterThan(0);
  });

  test('SC-1 row 7 (G-3427d656d7): every narrative >= 200 characters and none is the bare assertion (was 4)', () => {
    const bad = ssp.controlImplementations.filter((c: any) => stripDisclosures(c.implementationNarrative).trim().length < 200
      || /^[^\n]{0,160}implemented and continuously verified\.?$/i.test(stripDisclosures(c.implementationNarrative).trim()));
    expect(bad.map((c: any) => c.control_id)).toEqual([]);
    for (const id of ['MP.L2-3.8.4', 'MP.L2-3.8.9', 'CA.L2-3.12.1', 'CA.L2-3.12.3']) {
      const n = ci(id).implementationNarrative;
      expect(n).toContain('Verification (Tenant Manifest):');
      expect(n).toContain('Procedure (Mission Plan step');
      expect(n).toContain('**Evidence:** Stamper evidence');
      expect(n).not.toContain(NOT_SUPPLIED); // met: its evidence is stated, no content gap
    }
  });

  test('SC-2 row 8 (G-76b185cdd1): >= 90 % of the 320 objectives carry their own rationale (was 4)', () => {
    const own = ledger.objectives.filter(o => !/^inherited from control assessment/i.test(o.rationale));
    expect(ledger.objectives).toHaveLength(320);
    expect(own.length / 320).toBeGreaterThanOrEqual(0.9);
    const digital = ledger.objectives.filter(o => o.source === 'digital-signal');
    for (const o of digital) expect(o.rationale.startsWith(`${o.objectiveId} (${o.statement})`)).toBe(true);
    const a = ledger.objectives.find(o => o.objectiveId === 'AC.L1-3.1.1[a]')!;
    expect(a.rationale).toContain('AC.L1-3.1.1 is met at Tier 2 (live read)');
    expect(a.rationale).toContain('conditionalAccess at ');
    expect(a.rationale).toContain('policy reference policies/access-control-policy.md (sha256 c48f3c02d060)');
    // The SSP carries the same rationale per objective (W3.2 provenance).
    const ssp1 = ci('AC.L1-3.1.1').assessmentObjectives.find((o: any) => o.objectiveId === 'AC.L1-3.1.1[a]');
    expect(ssp1.rationale).toBe(a.rationale);
    expect(ledger.objectives.map(o => o.source).filter(s => s === 'digital-signal')).toHaveLength(316);
  });

  test('SC-2 row 9 (G-05ec7eac86): no ODP entry is labelled defaulted when the profile shows an answered interview', () => {
    const entries = ssp.controlImplementations.flatMap((c: any) => c.odpValues ?? []);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.filter((o: any) => /default/i.test(String(o.source)))).toEqual([]);
    const lockout = entries.find((o: any) => o.parameter === 'PI.ODP.001 account_lockout_threshold');
    expect(lockout.value).toBe(String(POLICY_ODPS['PI.ODP.001'].recommended));
    expect(lockout.source).toContain('answered Policy Inputs interview');
  });

  test('SC-2 row 12 (G-88b725b93e): no not-assessed narrative says "REQUIRES MANUAL INPUT"; each names a policy (was 16)', () => {
    const na = ssp.controlImplementations.filter((c: any) => c.status === 'not_assessed');
    expect(na).toHaveLength(23);
    expect(na.filter((c: any) => /REQUIRES MANUAL INPUT/.test(c.implementationNarrative)).map((c: any) => c.control_id)).toEqual([]);
    expect(na.filter((c: any) => !(c.relatedPolicies ?? []).length)).toEqual([]);
    const pe = ci('PE.L1-3.10.1').implementationNarrative;
    expect(pe).toContain('**Physical security (policy-inputs profile):** 1 facility in scope');
    expect(pe).toContain(`${NOT_SUPPLIED}: the physical security records that evidence this control.`);
    expect(ci('AT.L2-3.2.2').implementationNarrative).toContain('**Awareness training frequency (policy-inputs profile):** Annually (PI.ODP.011).');
  });

  test('SC-2 row 17 (G-8162815c0c, zero-count half): no met narrative states a zero count (was 5)', () => {
    const zero = ssp.controlImplementations.filter((c: any) => c.status === 'met' && /\b0 (managed devices|authentication methods|users)\b/i.test(c.implementationNarrative));
    expect(zero.map((c: any) => c.control_id)).toEqual([]);
  });

  test('SC-5 (G-57295baadb): no placeholder in the SSP JSON or the DOCX (was 120 / 133); gaps carry the content-gap sentence', () => {
    expect(markerCount(JSON.stringify(ssp))).toBe(0);
    expect(markerCount(docx)).toBe(0);
    const parties = Object.fromEntries(ssp.responsibleParties.map((r: any) => [r.role, r.name]));
    expect(parties.ISSO).toBe(env.profile.personnel.find(p => p.role_id === 'isso')!.name);
    expect(parties['System Owner']).toBe(env.profile.personnel.find(p => p.role_id === 'system_owner')!.name);
    expect(parties['Authorizing Official']).toBe(`${NOT_SUPPLIED}: the Authorizing Official.`);
    expect(ssp.cuiCategorization[0].volume).toBe(`${NOT_SUPPLIED}: the CUI volume.`);
    const app = Object.fromEntries(ssp.appendices.map((a: any) => [a.id, a]));
    expect(app.E.documentId).toBe('POLICY-SET MANIFEST');
    expect(app.E.summary).toContain('| policies/access-control-policy.md | c48f3c02d060931497c3936c3db46b43fb9a54cbd6815b6f5df80e73132bb42d |');
    expect(app.I.documentId).toMatch(/^policies\/incident-response-plan\.md \(sha256 5a15745f1143\.\.\.\)$/);
    expect(app.D.summary).not.toContain('[MANUAL INPUT REQUIRED]');
    expect(app.D.summary).toContain('Provider-managed (cloud service)');
    // W5 cycle 3 (P6): System Type is derived from run 43's SI Baseline scope (single_enclave, cloud_only).
    expect(docx).toContain('System Type: Cloud-only system within a single CUI enclave');
    // The W4 scorecard counts the sentence as a content gap: 26 in the JSON on run 43; 25 since W5 cycle 3
    // (P10: Appendix J resolves to the manifest's configuration-management-policy).
    expect(JSON.stringify(ssp).split(NOT_SUPPLIED).length - 1).toBe(25);
  });
});
