// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * W5 cycle 3 (SC-5): EO consumes the Muster content cycle 2 added (P1-P7, P9, P10 of LOG-W5c2-muster.md).
 * Golden on run 43's inputs (tests/fixtures/w5-run43) through the real SspGenerator, applyPolicyInputs and
 * SspDocxExporter, twice:
 *   - S1-like: the run 43 profile plus the cycle-2 content (personnel role_ids, organization CAGE / UEI,
 *     ssp_inputs) and the 22-document manifest: the rows are filled, no content-gap sentence for them,
 *     and each filled field has its provenance;
 *   - partial (muster-partial-like): no named roles, no CAGE / UEI, no ssp_inputs, SI boundary "unknown":
 *     the content-gap sentences stay, never a placeholder.
 * Plus the date arithmetic, the appendix mapping, Appendix H's join and the two rule items
 * (AC.L2-3.1.4 approvers, IA.L2-3.5.5 empty deleted-users read). Names are the fictional S1 roster.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import JSZip from 'jszip';
import type { AssessmentSnapshot } from 'ces-shared/types/controls';
import type { PlanOfActionMilestones } from 'ces-shared/types/poam';
import type { SignalResult } from 'ces-shared/types/signal';
import { buildDeterminationLedger } from '../../src/eo/assessment/DeterminationLedger.js';
import { SspGenerator } from '../../src/eo/ssp/SspGenerator.js';
import { SnippetDataResolver } from '../../src/eo/ssp/SnippetDataResolver.js';
import { AdminOpsDataProvider } from '../../src/eo/ssp/AdminOpsDataProvider.js';
import {
  OdpValueProvider, applyPolicyInputs, variablesFromPolicyProfile, addMonthsIso, SSP_APPENDIX_DOCUMENTS,
  type PolicyInputsProfileArtifact, type SspContentProvenanceEntry,
} from '../../src/eo/ssp/OdpValueProvider.js';
import { SspDocxExporter } from '../../src/eo/ssp/SspDocxExporter.js';
import { NOT_SUPPLIED } from '../../src/eo/ssp/ContentGap.js';
import { evaluatorRegistry, PRESENCE_ONLY_EVALUATORS } from '../../src/eo/mapping/evaluators/index.js';
import type { StamperEvidence } from '../../src/eo/evidence/StamperEvidenceLoader.js';

const _require = createRequire(__filename);
const controlsRefPath = _require.resolve('ces-shared/data/cmmc-l2-controls');
const sprsWeightsPath = _require.resolve('ces-shared/data/sprs-weights');
const FX = path.resolve(__dirname, '../fixtures/w5-run43');
const readJson = <T>(name: string): T => JSON.parse(fs.readFileSync(path.join(FX, name), 'utf-8')) as T;
const LEXICON = (JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../data/narrative-negation-lexicon.json'), 'utf-8')) as { phrases: string[] }).phrases;
const lexPattern = (p: string) => new RegExp((/^[A-Za-z0-9]/.test(p) ? '(?<![A-Za-z0-9])' : '') + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
const MARKERS = [/\[MANUAL INPUT REQUIRED\]/g, /REQUIRES MANUAL INPUT/g];
const markerCount = (s: string) => MARKERS.reduce((n, re) => n + (s.match(re) ?? []).length, 0);
const gapCount = (s: string) => s.split(NOT_SUPPLIED).length - 1;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

interface Run43Snapshot { tenantId: string; generatedAt: string; signals: Record<string, unknown>; controls: Array<Record<string, unknown> & { signalKeys: string[] }> }
interface Envelopes { profile: PolicyInputsProfileArtifact & { personnel: Array<{ role_id: string; name: string; title?: string; email?: string }> }; manifest: { documents: Array<{ name: string; sha256: string }> } }

async function docxBody(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  return (await zip.file('word/document.xml')!.async('string')).split('</w:p>')
    .map(p => (p.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) ?? []).map(t => t.replace(/<[^>]+>/g, '')).join('')).join('\n');
}

const MAIL = 's1-mach.simtenant.onmicrosoft.us';
/** The cycle-2 Muster content as run 46 pushed it for S1 (fictional). */
const S1_ADDED: Required<Pick<PolicyInputsProfileArtifact, 'ssp_inputs'>> & { personnel: NonNullable<PolicyInputsProfileArtifact['personnel']>; organization: { cage_code: string; duns_number: string } } = {
  personnel: [
    { role_id: 'authorizing_official', role_title: 'Authorizing Official', name: 'Alvane Ashenmere', title: 'President / Owner', email: `alvane.ashenmere@${MAIL}` },
    { role_id: 'privacy_officer', role_title: 'Privacy Officer', name: 'Ettrin Fallowwick', title: 'Contracts and CUI Manager (Privacy Officer role holder)', email: `ettrin.fallowwick@${MAIL}` },
    { role_id: 'network_administrator', role_title: 'Network Administrator', name: 'Dorrel Nettlecombe', title: 'Systems Administrator (Network Administrator role holder)', email: `dorrel.nettlecombe@${MAIL}` },
  ],
  organization: { cage_code: '9S4M1', duns_number: 'SIMX7Q2M4K9P' },
  ssp_inputs: {
    system_identifier: 'HPM-CUI-ENC-01 (fictional)',
    cui_volume: 'About 9,500 files (about 38 GB) held in the SharePoint enclave and the Teams CUI channels (fictional estimate)',
    interconnection_agreements: [
      { system: 'Prime contractor supplier portal', agreement_reference: 'ISA SIMX-ISA-0142 (fictional)', connection_type: 'HTTPS browser upload and download through the prime-hosted portal', data_classification: 'CUI: Controlled Technical Information, Export Controlled' },
      { system: 'CAM file sync service account', agreement_reference: 'MOU SIMX-MOU-0007 (fictional)', connection_type: 'Service-account file sync to the CAM programming VM', data_classification: 'CUI: Controlled Technical Information, Export Controlled' },
    ],
  },
};

/** One SSP + DOCX on run 43's inputs with the given profile, manifest and SI Baseline scope. */
async function build(profile: PolicyInputsProfileArtifact, manifest: Envelopes['manifest'], scope?: Record<string, unknown>) {
  const fx = readJson<Run43Snapshot>('snapshot-run43.json');
  const snapshot = { tenantId: fx.tenantId, generatedAt: fx.generatedAt, controls: fx.controls.map(({ signalKeys, ...c }) => ({ ...c, signals: signalKeys.map(k => fx.signals[k]) })) } as unknown as AssessmentSnapshot;
  const refs = readJson<{ refs: Record<string, any[]>; manual: Record<string, any> }>('ledger-refs-run43.json');
  const ledger = buildDeterminationLedger({ tenantId: snapshot.tenantId, generatedAt: snapshot.generatedAt, snapshot, manualControlStatus: refs.manual, evidenceRefsLookup: id => refs.refs[id] ?? [], policyManifest: manifest });
  const adminOps = new AdminOpsDataProvider();
  adminOps.initialize();
  const tm = readJson<Record<string, any>>('tm-run43.json');
  const resolver = new SnippetDataResolver({ adminOpsProvider: adminOps, odpValueProvider: new OdpValueProvider(tm.odpValues) });
  const manifests = await resolver.loadManifests('s1-mach', { tenantManifestPath: path.join(FX, 'tm-run43.json'), infraManifestPath: path.join(FX, 'im-run43.json'), missionPlanPath: path.join(FX, 'mp-run43.json') });
  const mp = readJson<Record<string, any>>('mp-run43.json');
  if (scope) mp.inputs.si_baseline.si_baseline.scope = { ...mp.inputs.si_baseline.si_baseline.scope, ...scope };
  const ssp: any = new SspGenerator(controlsRefPath, sprsWeightsPath, resolver).generate({
    assessment: snapshot, ledger, poam: readJson<PlanOfActionMilestones>('poam-run43.json'),
    missionPlan: mp, tenantManifest: tm, infraManifest: readJson('im-run43.json'), manifests, registries: [], policies: [],
    variables: variablesFromPolicyProfile(profile), tenantSlug: 's1-mach', stamperEvidence: readJson<StamperEvidence[]>('stamper-evidence-run43.json'),
  });
  applyPolicyInputs(ssp, profile, manifest, mp, manifests.tenantManifest);
  return { ssp, docx: await docxBody(await new SspDocxExporter().export(ssp)) };
}

const env = readJson<Envelopes>('policy-envelopes-run43.json');
const MANIFEST_22 = { documents: [...env.manifest.documents, ...['continuous-monitoring-plan', 'acceptable-use-policy'].map(b => ({ name: `policies/${b}.md`, sha256: sha(b) }))].sort((a, b) => a.name.localeCompare(b.name)) };
const s1Profile = (): PolicyInputsProfileArtifact => ({
  ...env.profile,
  organization: { ...(env.profile.organization ?? {}), legal_name: 'Hollinford Precision Machining LLC (FICTIONAL)', ...S1_ADDED.organization },
  personnel: [...env.profile.personnel, ...S1_ADDED.personnel],
  governance: { policy_effective_date: '2026-10-28', review_cycle_months: 12 },
  ssp_inputs: S1_ADDED.ssp_inputs,
});
const partialProfile = (): PolicyInputsProfileArtifact => ({
  ces: env.profile.ces, odps: env.profile.odps, personnel: [],
  organization: { legal_name: 'Sim tenant muster-partial' },
  governance: { policy_effective_date: '2026-10-28', review_cycle_months: 12 },
});
const provOf = (ssp: any, field: string): SspContentProvenanceEntry | undefined => (ssp.contentProvenance ?? []).find((p: SspContentProvenanceEntry) => p.field === field);
const party = (ssp: any, role: string) => ssp.responsibleParties.find((r: any) => r.role === role);
const appendix = (ssp: any, id: string) => ssp.appendices.find((a: any) => a.id === id);

describe('W5 cycle 3 golden: S1-like profile (all fields present)', () => {
  let ssp: any;
  let docx: string;
  beforeAll(async () => { ({ ssp, docx } = await build(s1Profile(), MANIFEST_22)); }, 120000);

  test('P1 / P2: the AO, Privacy Officer and Network Administrator are the named role holders, provenance answered', () => {
    expect(party(ssp, 'Authorizing Official')).toEqual({ role: 'Authorizing Official', name: 'Alvane Ashenmere', title: 'President / Owner', contact: `alvane.ashenmere@${MAIL}` });
    expect(party(ssp, 'Privacy Officer').name).toBe('Ettrin Fallowwick');
    expect(party(ssp, 'Network Administrator').name).toBe('Dorrel Nettlecombe');
    expect(ssp.authorizingOfficial.name).toBe('Alvane Ashenmere');
    expect(ssp.incidentResponse.escalationPath).toContain('→ Alvane Ashenmere →');
    for (const role of ['Authorizing Official', 'Privacy Officer', 'Network Administrator']) {
      expect(provOf(ssp, `responsibleParties[role=${role}].name`)?.provenance).toBe('answered');
    }
    expect(provOf(ssp, 'authorizingOfficial')).toEqual({ field: 'authorizingOfficial', provenance: 'answered', source: 'policy-inputs profile personnel[role_id=authorizing_official] (PI.PER.009)' });
  });

  test('P4 / P5 / P6 / P7 / P3: CAGE, UEI, System Identifier, System Type, next review date and CUI volume, each with provenance', () => {
    expect(ssp.cageCode).toBe('9S4M1');
    expect(ssp.ueiNumber).toBe('SIMX7Q2M4K9P');
    expect(ssp.systemIdentifier).toBe('HPM-CUI-ENC-01 (fictional)');
    expect(ssp.systemType).toBe(`Cloud-only system within a single CUI enclave: ${ssp.systemDescription.replace(/[.\s]+$/, '')}.`);
    expect(ssp.nextReviewDate).toBe('2027-10-28');
    expect(ssp.cuiCategorization[0].volume).toBe(S1_ADDED.ssp_inputs.cui_volume);
    expect(provOf(ssp, 'cageCode')?.provenance).toBe('organisation profile');
    expect(provOf(ssp, 'ueiNumber')?.provenance).toBe('organisation profile');
    expect(provOf(ssp, 'systemIdentifier')).toEqual({ field: 'systemIdentifier', provenance: 'answered', source: 'policy-inputs profile ssp_inputs.system_identifier (PI.SYS.001)' });
    expect(provOf(ssp, 'systemType')).toEqual({ field: 'systemType', provenance: 'derived', source: 'SI Baseline scope.deployment_posture (cloud_only) + scope.boundary_strategy (single_enclave) + SSP systemDescription' });
    expect(provOf(ssp, 'nextReviewDate')).toEqual({ field: 'nextReviewDate', provenance: 'derived', source: 'policy-inputs profile governance.policy_effective_date (2026-10-28) + governance.review_cycle_months (12)' });
    expect(provOf(ssp, 'cuiCategorization[0].volume')?.provenance).toBe('answered');
  });

  test('P10 / P9: appendices I-L resolve to the manifest documents (hash referenced); H joins the agreements with EO records', () => {
    for (const [id, base] of Object.entries(SSP_APPENDIX_DOCUMENTS)) {
      const d = MANIFEST_22.documents.find(x => x.name === `policies/${base}.md`)!;
      expect(appendix(ssp, id).documentId).toBe(`policies/${base}.md (sha256 ${d.sha256.slice(0, 12)}...)`);
      expect(provOf(ssp, `appendices[${id}].documentId`)).toEqual({ field: `appendices[${id}].documentId`, provenance: 'organisation profile', source: `policy-set manifest document policies/${base}.md, sha256 ${d.sha256} (SSP_APPENDIX_DOCUMENTS ${id})` });
    }
    const h = appendix(ssp, 'H');
    expect(h.documentId).toBe('POLICY-INPUTS PROFILE (CUI.INT.004)');
    expect(h.summary).toContain('| Prime contractor supplier portal | ISA SIMX-ISA-0142 (fictional) |');
    expect(h.summary).toMatch(/\| Prime contractor supplier portal \|[^\n]*\| Prime\/customer portal \(CUI flow Ingress, CUI boundary fact cui_ingress_channels\) \|/);
    expect(h.summary).toContain('| CAM file sync service account | MOU SIMX-MOU-0007 (fictional) |');
    expect(h.summary).toMatch(/CAM file sync service account[^\n]*No EO interconnection record matches this system; organisation-stated \(CUI\.INT\.004\) \|/);
    expect(h.summary).not.toContain(NOT_SUPPLIED);
    expect(provOf(ssp, 'appendices[H]')?.provenance).toBe('answered');
  });

  test('no content-gap sentence for the filled rows in the JSON; what remains is F, G and the evidence-record narratives', () => {
    const json = JSON.stringify(ssp);
    expect(markerCount(json)).toBe(0);
    for (const what of ['the Authorizing Official', 'the Privacy Officer', 'the Network Administrator', 'the CUI volume']) expect(json).not.toContain(`${NOT_SUPPLIED}: ${what}.`);
    const gapAppendices = ssp.appendices.filter((a: any) => a.documentId === NOT_SUPPLIED).map((a: any) => a.id);
    expect(gapAppendices).toEqual(['F', 'G']);
    const narrativeGaps = ssp.controlImplementations.filter((c: any) => c.implementationNarrative.includes(NOT_SUPPLIED)).length;
    expect(gapCount(json)).toBe(2 + narrativeGaps);
    // provenance strings never carry the sentence, so the scorecard does not count a filled field twice
    expect(gapCount(JSON.stringify(ssp.contentProvenance))).toBe(0);
  });

  test('DOCX: cover AO name, document approver, approval authority, identification fields and both next review dates', () => {
    expect(markerCount(docx)).toBe(0);
    const lines = docx.split('\n');
    const aoAt = lines.findIndex(l => l.startsWith('Authorizing Official: '));
    expect(lines.slice(aoAt, aoAt + 3).join('\n')).toContain('Name: Alvane Ashenmere');
    expect(docx).toContain('Document Approver\nAlvane Ashenmere');
    expect(docx).toContain('Next Scheduled Review\n2027-10-28');
    expect(docx).toContain('Next Review Date: 2027-10-28');
    expect(docx).toContain('Approval Authority: Alvane Ashenmere');
    expect(docx).toContain('CAGE Code: 9S4M1');
    expect(docx).toContain('UEI Number: SIMX7Q2M4K9P');
    expect(docx).toContain('System Identifier: HPM-CUI-ENC-01 (fictional)');
    expect(docx).toContain('System Type: Cloud-only system within a single CUI enclave');
    for (const what of ['Authorizing Official', 'document approver', 'next review date', 'Next Review Date', 'Approval Authority', 'CAGE Code', 'UEI Number', 'System Identifier', 'System Type', 'Privacy Officer', 'Network Administrator', 'CUI volume']) {
      expect(docx).not.toContain(`${NOT_SUPPLIED}: the ${what}.`);
    }
  });
});

describe('W5 cycle 3 golden: profile without the organisation content (muster-partial-like)', () => {
  let ssp: any;
  let docx: string;
  beforeAll(async () => { ({ ssp, docx } = await build(partialProfile(), MANIFEST_22, { boundary_strategy: 'unknown' })); }, 120000);

  test('the content-gap sentences stay for every row without a source value; never a placeholder', () => {
    const json = JSON.stringify(ssp);
    expect(markerCount(json)).toBe(0);
    expect(markerCount(docx)).toBe(0);
    for (const role of ['Authorizing Official', 'Privacy Officer', 'Network Administrator']) expect(party(ssp, role).name).toBe(`${NOT_SUPPLIED}: the ${role}.`);
    expect(ssp.authorizingOfficial).toBeUndefined();
    expect(ssp.cuiCategorization[0].volume).toBe(`${NOT_SUPPLIED}: the CUI volume.`);
    expect(appendix(ssp, 'H').documentId).toBe(NOT_SUPPLIED);
    for (const label of ['CAGE Code', 'UEI Number', 'System Type']) expect(docx).toContain(`${label}: ${NOT_SUPPLIED}: the ${label}.`);
    expect(docx).toContain(`${NOT_SUPPLIED}: the Authorizing Official.`);
    expect(docx).toContain(`Approval Authority: ${NOT_SUPPLIED}: the Approval Authority.`);
    for (const f of ['cageCode', 'ueiNumber', 'systemType', 'authorizingOfficial', 'cuiCategorization[0].volume', 'appendices[H]', 'responsibleParties[role=Authorizing Official].name']) expect(provOf(ssp, f)).toBeUndefined();
  });

  test('the two derivations the rules allow without organisation content: System Identifier from the TM tenant_id, next review from governance', () => {
    expect(ssp.systemIdentifier).toBe('sim-tenant-s1-mach (derived from the Tenant Manifest tenant_id; the organisation has assigned no system identifier)');
    expect(provOf(ssp, 'systemIdentifier')?.provenance).toBe('derived');
    expect(ssp.nextReviewDate).toBe('2027-10-28');
    expect(docx).toContain('Next Review Date: 2027-10-28');
  });
});

describe('W5 cycle 3 units', () => {
  test('addMonthsIso: plain, year roll, end-of-month and leap-day clamps, unreadable input', () => {
    expect(addMonthsIso('2026-10-28', 12)).toBe('2027-10-28');
    expect(addMonthsIso('2026-11-15', 3)).toBe('2027-02-15');
    expect(addMonthsIso('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsIso('2024-02-29', 12)).toBe('2025-02-28');
    expect(addMonthsIso('2027-08-31', 6)).toBe('2028-02-29');
    expect(addMonthsIso('not a date', 12)).toBeUndefined();
  });

  test('P1: the AO is taken only from role_id authorizing_official: never inferred from the System Owner or a title', () => {
    const owner = { role_id: 'system_owner', name: 'Fict Owner', title: 'Authorizing Official and Owner' };
    expect(variablesFromPolicyProfile({ personnel: [owner] }).authorizingOfficialName).toBeUndefined();
    expect(variablesFromPolicyProfile({ personnel: [owner, { role_id: 'authorizing_official', name: 'adm.x@example.invalid' }] }).authorizingOfficialName).toBeUndefined();
    expect(variablesFromPolicyProfile({ personnel: [owner, { role_id: 'authorizing_official', name: 'Fict Ao', title: 'President' }] })).toMatchObject({ authorizingOfficialName: 'Fict Ao', authorizingOfficialTitle: 'President' });
  });

  test('P7: no next review date without both governance values; P4: blank CAGE / UEI are not values', () => {
    expect(variablesFromPolicyProfile({ governance: { policy_effective_date: '2026-10-28' } }).nextReviewDate).toBeUndefined();
    expect(variablesFromPolicyProfile({ governance: { review_cycle_months: 12 } }).nextReviewDate).toBeUndefined();
    expect(variablesFromPolicyProfile({ organization: { cage_code: '  ', duns_number: '' } })).not.toHaveProperty('cageCode');
  });

  const minimal = () => ({
    controlImplementations: [] as any[],
    appendices: ['H', 'I', 'J', 'K', 'L'].map(id => ({ id, documentId: NOT_SUPPLIED, title: id, summary: 's' })),
    interconnections: [] as any[], cuiDataFlowRows: [] as any[],
  });
  const docs = (...bases: string[]) => ({ documents: bases.map(b => ({ name: `policies/${b}.md`, sha256: sha(b) })) });

  test('appendix mapping: the map is Muster\'s; a document the manifest lacks keeps the gap; AUTO-GENERATED is kept; idempotent', () => {
    expect(SSP_APPENDIX_DOCUMENTS).toEqual({ I: 'incident-response-plan', J: 'configuration-management-policy', K: 'continuous-monitoring-plan', L: 'acceptable-use-policy' });
    const s: any = minimal();
    s.appendices.find((a: any) => a.id === 'L').documentId = 'AUTO-GENERATED';
    applyPolicyInputs(s, null, docs('incident-response-plan', 'configuration-management-policy', 'acceptable-use-policy'));
    const id = (x: string) => s.appendices.find((a: any) => a.id === x).documentId;
    expect(id('J')).toBe(`policies/configuration-management-policy.md (sha256 ${sha('configuration-management-policy').slice(0, 12)}...)`);
    expect(id('K')).toBe(NOT_SUPPLIED);
    expect(id('L')).toBe('AUTO-GENERATED');
    const before = JSON.stringify(s);
    applyPolicyInputs(s, null, docs('incident-response-plan', 'configuration-management-policy', 'acceptable-use-policy'));
    expect(JSON.stringify(s)).toBe(before);
    expect(s.contentProvenance.map((p: SspContentProvenanceEntry) => p.field)).toEqual(['appendices[I].documentId', 'appendices[J].documentId']);
  });

  test('Appendix H: a missing agreement field is its own content gap; one-word overlaps do not match; no agreements, no change', () => {
    const s: any = minimal();
    s.cuiDataFlowRows = [{ direction: 'Storage', path: 'Teams file libraries', source: 'x' }, { direction: 'Ingress', path: 'Partner file portal', source: 'CUI boundary fact cui_ingress_channels' }];
    applyPolicyInputs(s, { ssp_inputs: { interconnection_agreements: [{ system: 'Partner upload portal', connection_type: 'HTTPS' }, { system: 'CAM file sync' }] } }, null);
    const h = s.appendices.find((a: any) => a.id === 'H');
    expect(h.summary).toContain(`| Partner upload portal | ${NOT_SUPPLIED}: the ISA/MOU reference for Partner upload portal. | HTTPS |`);
    expect(h.summary).toContain('Partner file portal (CUI flow Ingress, CUI boundary fact cui_ingress_channels)');
    expect(h.summary).toMatch(/\| CAM file sync \|[^\n]*No EO interconnection record matches this system/);
    const empty: any = minimal();
    applyPolicyInputs(empty, { ssp_inputs: { interconnection_agreements: [] } }, null);
    expect(empty.appendices.find((a: any) => a.id === 'H').documentId).toBe(NOT_SUPPLIED);
    expect(empty.contentProvenance).toBeUndefined();
  });

  test('the disk variables win: a value that is not the profile\'s records no profile provenance', () => {
    const s: any = { ...minimal(), cageCode: 'DISK1' };
    applyPolicyInputs(s, { organization: { cage_code: '9S4M1' } }, null);
    expect(s.cageCode).toBe('DISK1');
    expect(s.contentProvenance).toBeUndefined();
  });
});

describe('W5 cycle 3 rule items', () => {
  const AT = '2026-10-28T16:00:00.000Z';
  const sig = (signalId: string, endpoint: string, rawData: unknown): SignalResult => ({ signalId, source: 'graph', endpoint, timestamp: AT, rawData, status: 'success' } as SignalResult);
  const pim = (...approvers: unknown[]) => sig('pimPolicies', '/policies/roleManagementPolicies', [{ id: 'roleManagementPolicy-1', displayName: 'Compliance Administrator policy', rules: [{
    '@odata.type': '#microsoft.graph.unifiedRoleManagementPolicyApprovalRule', id: 'Approval_EndUser_Assignment',
    setting: { isApprovalRequired: true, approvalStages: [{ primaryApprovers: approvers }] } }] }]);
  const single = (userId: unknown, description = 'Approver') => ({ '@odata.type': '#microsoft.graph.singleUser', userId, description });
  const run = (name: string, signals: SignalResult[]) => evaluatorRegistry[name](signals, undefined);

  test('(a) AC.L2-3.1.4: a userId: null approver does not count and is printed; a resolving approver counts', () => {
    const none = run('pimApprovalEvaluator', [pim(single(null))]);
    expect(none.status).toBe('not_met');
    expect(none.evidence).toBe("PIM role management policies: 1 policy(ies) read; none requires approval by a named approver before activation; approver(s) not counted (no directory user): Compliance Administrator policy: approver 'Approver' has userId null");
    expect(run('pimApprovalEvaluator', [pim(single('user-46'))]).status).toBe('met');
    const mixed = run('pimApprovalEvaluator', [pim(single(null, 'Unresolved'), single('user-46'))]);
    expect(mixed.status).toBe('met');
    expect(mixed.evidence).toContain("approver 'Unresolved' has userId null");
    expect(run('pimApprovalEvaluator', [pim({ '@odata.type': '#microsoft.graph.groupMembers', groupId: 'group-1' })]).status).toBe('met');
  });

  test('(a) with a users read, an approver id must be one of its users', () => {
    const usersRead = sig('directoryUsers', '/users', { value: [{ id: 'user-1' }] });
    const v = run('pimApprovalEvaluator', [pim(single('user-46')), usersRead]);
    expect(v.status).toBe('not_met');
    expect(v.evidence).toContain("approver 'Approver' userId user-46 is not in the users read");
    expect(run('pimApprovalEvaluator', [pim(single('user-1')), usersRead]).status).toBe('met');
  });

  test('(b) IA.L2-3.5.5: an empty deleted-users read that succeeded is met, window-limited, not presence only', () => {
    const v = run('inactiveAccountsEvaluator', [
      sig('directoryUsers', '/users', { value: [{ id: 'user-1', userPrincipalName: `user-1@${MAIL}`, accountEnabled: true }] }),
      sig('deletedUsers', '/directory/deletedItems/microsoft.graph.user', { value: [] }),
    ]);
    expect(v.status).toBe('met');
    expect(v.evidence).toContain('no identifiers deleted in the 30-day recycle-bin window, so none could be reused');
    expect(v.evidence).toContain('window-limited');
    expect(PRESENCE_ONLY_EVALUATORS.has('inactiveAccountsEvaluator')).toBe(false);
    expect(evaluatorRegistry.inactiveAccountsEvaluator.presenceOnly).toBeUndefined();
    // it becomes a met narrative: no negation-lexicon hit (V30; SC-1 row 1)
    expect(LEXICON.filter(p => lexPattern(p).test(v.evidence))).toEqual([]);
  });
});
