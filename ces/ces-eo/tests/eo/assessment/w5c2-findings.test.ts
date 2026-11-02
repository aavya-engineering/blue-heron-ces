/**
 * Synthetic-customer W5 cycle 2: the deciding evaluator's evidence sentence (the "finding") reaches
 * the three assessor outputs. Golden on one met and one not-met control (plus a Tier 1 Stamper NOT_SAT):
 *   - ledger: each objective rationale carries the sentence verbatim after the tier clause;
 *   - SSP: `assessmentFinding` (its own field, never inside `implementationNarrative`); the DOCX prints
 *     it under the status ("Basis of determination:" for met, "Finding:" for not met);
 *   - POA&M: `deficiencyDescription` = the finding; `plannedCorrectiveAction` derived from it (an
 *     organisation value -> configure the organisation's value; a failed Stamper entry -> named), else
 *     "Corrective action to be defined by the organisation"; `automationAvailable` only from a registry entry.
 * Status is never changed by any of this.
 */
import { describe, test, expect, jest, beforeAll } from '@jest/globals';

jest.mock('ces-shared/blob', () => ({ uploadEvidenceBlob: jest.fn(), downloadBlob: jest.fn() }), { virtual: true });
jest.mock('ces-shared/storage', () => ({ getStamperPlanDataRoot: jest.fn(() => '/tmp/golden-plan-data') }), { virtual: true });

import { createRequire } from 'node:module';
import JSZip from 'jszip';
import type { AssessmentSnapshot, ControlAssessment } from 'ces-shared/types/controls';
import type { CommandRegistryFile } from 'ces-shared/types/registry';
import type { SystemSecurityPlan } from 'ces-shared/types/ssp';
import type { PlanOfActionMilestones } from 'ces-shared/types/poam';
import { ControlAssessor, findingOf, type EoControlAssessment } from '../../../src/eo/assessment/ControlAssessor.js';
import { buildDeterminationLedger, type DeterminationLedger } from '../../../src/eo/assessment/DeterminationLedger.js';
import { StamperEvidenceLoader, type StamperEvidence } from '../../../src/eo/evidence/StamperEvidenceLoader.js';
import { PoamGenerator, NO_CORRECTIVE_ACTION, correctiveActionFromFinding } from '../../../src/eo/poam/PoamGenerator.js';
import { SspDocxExporter } from '../../../src/eo/ssp/SspDocxExporter.js';
import { buildGoldenTenantManifest, buildGoldenInfraManifest, buildGoldenManifests } from '../../ssp/golden-fixtures.js';

const _require = createRequire(__filename);
const controlsRefPath = _require.resolve('ces-shared/data/cmmc-l2-controls');
const sprsWeightsPath = _require.resolve('ces-shared/data/sprs-weights');
const TS = '2026-10-28T17:57:47.436Z';

const NOT_MET = 'SC.L2-3.13.9';
const NOT_MET_SENTENCE = "Session end after inactivity: 'CMMC-ScreenLock-Policy' 15 min; none locks within 10 min (organisation value: TM expected value (answered)) with a password to unlock";
const MET = 'AC.L2-3.1.10';
const MET_SENTENCE = "Session lock: 'CMMC-ScreenLock-Policy' 10 min; locks within 10 min (organisation value: TM expected value (answered)) with a password to unlock; none inactive";
const TIER1 = 'AC.L2-3.1.6';
const NO_ACTION = 'AC.L2-3.1.21';
const NO_ACTION_SENTENCE = "Portable storage: 'CMMC-Device-Restrictions' storageBlockRemovableStorage false; removable storage is not blocked";

const live = (controlId: string, nist: string, result: 'exists' | 'missing', detail: string): ControlAssessment => ({
  control_id: controlId, nist_ref: nist, status: result === 'exists' ? 'met' : 'not_met',
  classification: 'automated', sources: [{ type: 'discovery', timestamp: TS, detail, result }], last_assessed: TS,
  signals: [], evidenceArtifactIds: [], automationSource: 'graph', lastFetchedAt: TS, implementation_narrative: detail,
});

const notSat: StamperEvidence = {
  complianceVerdict: 'NOT_SAT', sha256Hash: 'x', timestamp: TS, controlIds: [TIER1],
  entryId: 'AC.L2-3.1.6.admin-account', label: 'Prohibition: Create Dedicated Admin Account',
  commandExecuted: 'Get-MgUser', mode: 'state-verified', outcomeRationale: 'Command failed: exit_code_0',
  executorIdentity: 'stamper/2.2.3@no-mgcontext',
};

const registry: CommandRegistryFile = {
  entries: [{ entry_id: 'AC.L2-3.1.6.admin-account', label: 'Prohibition: Create Dedicated Admin Account', engine: 'mgraph', control_ids: [TIER1], get_command: 'Get-MgUser', set_command: 'New-MgUser' }],
} as unknown as CommandRegistryFile;

describe('W5 cycle 2: the finding in the ledger, the SSP and the POA&M', () => {
  let snap: AssessmentSnapshot;
  let ledger: DeterminationLedger;
  let ssp: SystemSecurityPlan;
  let docText: string;
  let poam: PlanOfActionMilestones;
  const ctl = (id: string) => snap.controls.find(c => c.control_id === id) as EoControlAssessment;
  const sspCtl = (id: string) => ssp.controlImplementations.find(c => c.control_id === id) as unknown as Record<string, unknown>;
  const item = (id: string) => poam.items.find(i => i.control_id === id)!;

  beforeAll(async () => {
    const signals = new Map<string, ControlAssessment>([
      [NOT_MET, live(NOT_MET, '3.13.9', 'missing', NOT_MET_SENTENCE)],
      [MET, live(MET, '3.1.10', 'exists', MET_SENTENCE)],
      [NO_ACTION, live(NO_ACTION, '3.1.21', 'missing', NO_ACTION_SENTENCE)],
    ]);
    const stamper = new StamperEvidenceLoader('w5c2').toAssessmentSources([notSat]);
    snap = new ControlAssessor(controlsRefPath, [registry]).merge('w5c2', [], [], [], [], stamper, signals, undefined, []);
    ledger = buildDeterminationLedger({ tenantId: 'w5c2', generatedAt: TS, snapshot: snap });
    const { SspGenerator } = await import('../../../src/eo/ssp/SspGenerator.js');
    ssp = new SspGenerator(controlsRefPath, sprsWeightsPath).generate({
      assessment: snap,
      tenantManifest: buildGoldenTenantManifest(),
      infraManifest: buildGoldenInfraManifest(),
      manifests: buildGoldenManifests(),
      variables: { organizationName: 'Golden Reference Defense Co.' },
    });
    const xml = await (await JSZip.loadAsync(await new SspDocxExporter().export(ssp))).file('word/document.xml')!.async('string');
    docText = xml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, m => `${m.replace(/<[^>]+>/g, '')}\n`).replace(/<[^>]+>/g, '')
      .replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    poam = new PoamGenerator(controlsRefPath, sprsWeightsPath, [registry]).generate({ assessment: snap });
  });

  describe('assessment snapshot', () => {
    test('status unchanged; the finding is the deciding source text, verbatim', () => {
      expect(ctl(NOT_MET).status).toBe('not_met');
      expect(ctl(NOT_MET).assessmentFinding).toBe(NOT_MET_SENTENCE);
      expect(ctl(MET).status).toBe('met');
      expect(ctl(MET).assessmentFinding).toBe(MET_SENTENCE);
      expect(ctl(TIER1).status).toBe('not_met');
      expect(ctl(TIER1).statusRationale).toMatch(/^Tier 1/);
      expect(ctl(TIER1).assessmentFinding).toBe('Stamper entry AC.L2-3.1.6.admin-account (Prohibition: Create Dedicated Admin Account) NOT_SAT: Command failed: exit_code_0');
      expect(ctl(TIER1).findingStamperEntries).toEqual([{ entryId: 'AC.L2-3.1.6.admin-account', label: 'Prohibition: Create Dedicated Admin Account', outcomeRationale: 'Command failed: exit_code_0' }]);
    });

    test('a control nothing decided has no finding', () => {
      const none = snap.controls.find(c => c.status === 'not_assessed') as EoControlAssessment;
      expect(none.assessmentFinding).toBeUndefined();
      expect(findingOf([])).toBe('');
    });
  });

  describe('ledger (golden)', () => {
    test('not met: the sentence follows the tier clause', () => {
      const o = ledger.objectives.find(x => x.objectiveId === `${NOT_MET}[a]`)!;
      expect(o.status).toBe('other_than_satisfied');
      expect(o.rationale).toBe(
        `${NOT_MET}[a] (${o.statement}) is other than satisfied: ${NOT_MET} is not met at Tier 2 (live read): "${NOT_MET_SENTENCE}".`);
    });

    test('met: the sentence follows the tier clause', () => {
      const o = ledger.objectives.find(x => x.objectiveId === `${MET}[a]`)!;
      expect(o.status).toBe('satisfied');
      expect(o.rationale).toBe(`${MET}[a] (${o.statement}) is satisfied: ${MET} is met at Tier 2 (live read): "${MET_SENTENCE}".`);
    });

    test('every objective of the two controls carries it; statuses are the control statuses', () => {
      for (const [id, s] of [[NOT_MET, NOT_MET_SENTENCE], [MET, MET_SENTENCE]]) {
        const objs = ledger.objectives.filter(x => x.controlId === id);
        expect(objs.length).toBeGreaterThan(0);
        for (const o of objs) expect(o.rationale).toContain(`at Tier 2 (live read): "${s}"`);
      }
      expect(ledger.controls.find(c => c.controlId === NOT_MET)!.status).toBe('not_met');
      expect(ledger.controls.find(c => c.controlId === MET)!.status).toBe('met');
    });
  });

  describe('SSP JSON and DOCX (golden)', () => {
    test('assessmentFinding is its own field, not in the narrative', () => {
      expect(sspCtl(NOT_MET).assessmentFinding).toBe(NOT_MET_SENTENCE);
      expect(sspCtl(MET).assessmentFinding).toBe(MET_SENTENCE);
      expect(String(sspCtl(MET).implementationNarrative)).not.toContain('none inactive');
      // a met control's negation guard does not see the field: "none" in the finding raises no flag
      expect((sspCtl(MET).consistencyFlags as unknown[] | undefined) ?? []).toEqual([]);
    });

    test('not-assessed controls carry no assessmentFinding', () => {
      for (const c of ssp.controlImplementations.filter(x => x.status === 'not_assessed')) expect('assessmentFinding' in c).toBe(false);
    });

    test('the DOCX prints the sentence under the status', () => {
      expect(docText).toContain(`Finding: ${NOT_MET_SENTENCE}`);
      expect(docText).toContain(`Basis of determination: ${MET_SENTENCE}`);
      const lines = docText.split('\n');
      const at = lines.findIndex(l => l === `Basis of determination: ${MET_SENTENCE}`);
      expect(lines.slice(Math.max(0, at - 3), at).some(l => l.startsWith('Implementation Status:') || l.startsWith('SPRS Determination:') || l.startsWith('Rationale:'))).toBe(true);
    });
  });

  describe('POA&M (golden)', () => {
    test('not met against an organisation value: description = the sentence; action = configure the organisation value', () => {
      const i = item(NOT_MET);
      expect(i.deficiencyDescription).toBe(NOT_MET_SENTENCE);
      expect(i.plannedCorrectiveAction).toBe(
        `Configure the organisation's value: the finding compares the configured value with the organisation's value ("none locks within 10 min (organisation value: TM expected value (answered)) with a password to unlock"); set the configuration named in the finding to that value, then re-assess the control.`);
      expect(i.plannedCorrectiveAction).not.toMatch(/encryption/);
      expect(i.automationAvailable).toBe(false);
      expect(i.resourcesRequired).toBe('');
    });

    test('Tier 1 Stamper NOT_SAT: the entry id and outcomeRationale; the action names the entry; automation from the registry', () => {
      const i = item(TIER1);
      expect(i.deficiencyDescription).toBe('Stamper entry AC.L2-3.1.6.admin-account (Prohibition: Create Dedicated Admin Account) NOT_SAT: Command failed: exit_code_0');
      expect(i.plannedCorrectiveAction).toBe('Resolve the failure of Stamper entry AC.L2-3.1.6.admin-account (Prohibition: Create Dedicated Admin Account), last outcome: Command failed: exit_code_0; re-run the entry and re-assess the control.');
      expect(i.automationAvailable).toBe(true);
    });

    test('no specific action known: the organisation defines it (no invented action)', () => {
      const i = item(NO_ACTION);
      expect(i.deficiencyDescription).toBe(NO_ACTION_SENTENCE);
      expect(i.plannedCorrectiveAction).toBe(NO_CORRECTIVE_ACTION);
      expect(NO_CORRECTIVE_ACTION).toBe('Corrective action to be defined by the organisation');
      expect(i.automationAvailable).toBe(false);
    });

    test('a failing Tenant Manifest check is an organisation value', () => {
      const a = correctiveActionFromFinding({ text: "Password complexity: passwordMinimumLength 'P1' 14; failing $.passwordExpirationDays lte 60 (answered)", stamperEntries: [] });
      expect(a).toBe(`Configure the organisation's value: the finding compares the configured value with the organisation's value ("failing $.passwordExpirationDays lte 60 (answered)"); set the configuration named in the finding to that value, then re-assess the control.`);
      expect(correctiveActionFromFinding({ text: NO_ACTION_SENTENCE, stamperEntries: [] })).toBeNull();
      expect(correctiveActionFromFinding({ stamperEntries: [] })).toBeNull();
    });

    test('no family boilerplate remains in any item', () => {
      for (const i of poam.items) {
        expect(i.plannedCorrectiveAction).not.toMatch(/via Stamper (set_command )?to enforce|to enable system integrity checks/);
        expect(i.deficiencyDescription).not.toBe('Control implementation not detected');
      }
    });

    test('without registries no control claims automation (no hard-coded fallback set)', () => {
      const p = new PoamGenerator(controlsRefPath, sprsWeightsPath).generate({ assessment: snap });
      expect(p.items.every(i => i.automationAvailable === false)).toBe(true);
    });
  });
});
