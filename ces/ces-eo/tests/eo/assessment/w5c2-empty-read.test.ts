/**
 * Synthetic-customer W5 cycle 2, part 2, item 1: an empty Stamper read is no opinion.
 * Rule (PLAN.md verdict tiers; ssp-uplift phase log "unread/errored/empty/404 = no opinion"): a Stamper
 * record whose payload is empty (empty rawResponse, or `value: []` for an evidence-only entry) is never
 * a Tier 1 NOT_SAT and never a positive; it is uncounted and the ledger says why ("empty read,
 * uncounted"). Only a NOT_SAT with a non-empty payload, or a failed set / state postcheck on a
 * configuring entry (state-verified record), is Tier 1.
 * Records are real files read by the real StamperEvidenceLoader, then merged by the real ControlAssessor.
 */
import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import type { ControlAssessment } from 'ces-shared/types/controls';
import { ControlAssessor, type EoControlAssessment } from '../../../src/eo/assessment/ControlAssessor.js';
import { buildDeterminationLedger } from '../../../src/eo/assessment/DeterminationLedger.js';
import { StamperEvidenceLoader, isEmptyValueList, EMPTY_READ_UNCOUNTED } from '../../../src/eo/evidence/StamperEvidenceLoader.js';
import { stamperVerdictText } from '../../../src/eo/ssp/SspGenerator.js';

const _require = createRequire(__filename);
const controlsRefPath = _require.resolve('ces-shared/data/cmmc-l2-controls');
const TS = '2026-10-28T18:11:52.472Z';
const slug = 'w5c2-empty-read';

/** Run 45 (muster-partial), verbatim shape of ia.l2-3.5.8.password-policy-evidence.json. */
const run45Record = {
  rawResponse: '',
  outcome: 'partial_success',
  outcomeRationale: 'Command completed but expected data output was empty',
  complianceVerdict: 'NOT_SAT',
  verdictRationale: "Outcome 'partial_success' indicates compliance requirement is not yet satisfied",
  registryEntry: { entry_id: 'IA.L2-3.5.8.password-policy-evidence', label: 'Renderable: Entra ID Password Protection Policy Settings', idempotency: 'safe', set_command: '', control_ids: ['IA.L2-3.5.8'] },
  metadata: {
    controlIds: ['IA.L2-3.5.8'], timestamp: TS, executorIdentity: 'stamper/2.2.3@no-mgcontext',
    commandExecuted: '[manual/evidence-only] Renderable: Entra ID Password Protection Policy Settings',
    sha256Hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  },
};

const record = (entry: string, controlIds: string[], o: { raw: unknown; verdict: string; outcome: string; rationale: string; command: string }) => ({
  rawResponse: o.raw, outcome: o.outcome, outcomeRationale: o.rationale, complianceVerdict: o.verdict,
  registryEntry: { entry_id: entry, label: entry, control_ids: controlIds },
  metadata: { controlIds, timestamp: TS, commandExecuted: o.command, sha256Hash: 'x' },
});

const files: Record<string, unknown> = {
  'ia.l2-3.5.8.password-policy-evidence.json': run45Record,
  // An evidence-only read that returned rows, judged NOT_SAT: a real negative (Tier 1).
  'au.l2-3.3.1.nonempty.json': record('AU.L2-3.3.1.nonempty', ['AU.L2-3.3.1'], {
    raw: '{"value":[{"id":"p1","enabled":false}]}', verdict: 'NOT_SAT', outcome: 'partial_success',
    rationale: 'Verification failed: $.value[0].enabled expected true', command: '[manual/evidence-only] Audit policy read' }),
  // A configuring entry (get-then-set) whose set failed: no payload, still Tier 1.
  'cm.l2-3.4.2.asr-rules.json': record('CM.L2-3.4.2.asr-rules', ['CM.L2-3.4.2'], {
    raw: '', verdict: 'NOT_SAT', outcome: 'failed_remediation_available',
    rationale: 'Command failed: (400) Bad Request', command: "$body = '{...}'; Invoke-MgGraphRequest -Method POST -Uri 'https://graph.microsoft.us/beta/deviceManagement/configurationPolicies'" }),
  // An evidence-only `value: []` list: empty, so neither NOT_SAT nor SAT counts.
  'sc.l2-3.13.2.session-lock.json': record('SC.L2-3.13.2.session-lock', ['SC.L2-3.13.2'], {
    raw: '{ "value": [ ] }', verdict: 'NOT_SAT', outcome: 'partial_success',
    rationale: 'Command completed but expected data output was empty', command: '[manual/evidence-only] Session lock read' }),
  'mp.l2-3.8.5.media-access.json': record('MP.L2-3.8.5.media-access', ['MP.L2-3.8.5'], {
    raw: '{"value":[]}', verdict: 'SAT', outcome: 'automated_success', rationale: '', command: '[manual/evidence-only] Media access read' }),
};

describe('W5 cycle 2 item 1: an empty Stamper read is no opinion', () => {
  let tmp: string;
  const prev = process.env.CES_PIPELINE_ROOT;
  let loader: StamperEvidenceLoader;

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'w5c2-empty-'));
    process.env.CES_PIPELINE_ROOT = tmp;
    const dir = path.join(tmp, 'Stamper', 'plan-data', slug, 'evidence', 'mixed');
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), JSON.stringify(body));
    loader = new StamperEvidenceLoader(slug);
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    if (prev === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = prev;
  });

  const sources = () => loader.toAssessmentSources(loader.loadEvidenceForTenant());

  test('the run 45 record (evidence-only, empty rawResponse, partial_success / NOT_SAT) is no_query, reason named', () => {
    const s = sources().get('IA.L2-3.5.8')!;
    expect(s.map(x => x.result)).toEqual(['no_query']);
    expect(s[0].detail).toBe(`Renderable: Entra ID Password Protection Policy Settings [executor stamper/2.2.3@no-mgcontext] (NOT_SAT on an empty payload; ${EMPTY_READ_UNCOUNTED}: Command completed but expected data output was empty)`);
  });

  test('a non-empty NOT_SAT and a failed get-then-set (empty, state-verified) stay missing (Tier 1)', () => {
    const m = sources();
    expect(m.get('AU.L2-3.3.1')!.map(x => x.result)).toEqual(['missing']);
    expect(m.get('CM.L2-3.4.2')!.map(x => x.result)).toEqual(['missing']);
  });

  test('an evidence-only `value: []` is empty: the NOT_SAT and the SAT are both uncounted', () => {
    const m = sources();
    expect(m.get('SC.L2-3.13.2')!.map(x => x.result)).toEqual(['no_query']);
    expect(m.get('MP.L2-3.8.5')!.map(x => x.result)).toEqual(['no_query']);
    expect(m.get('MP.L2-3.8.5')![0].detail).toContain('SAT on an empty payload; not counted');
    expect(isEmptyValueList({ '@odata.context': 'x', value: [] })).toBe(true);
    expect(isEmptyValueList('{"value":[{"id":1}]}')).toBe(false);
    expect(isEmptyValueList({ value: [], other: 1 })).toBe(false);
  });

  describe('merged: the control is decided by the next tier', () => {
    const tier2 = (id: string, nist: string, detail: string): ControlAssessment => ({
      control_id: id, nist_ref: nist, status: 'met', classification: 'automated',
      sources: [{ type: 'discovery', timestamp: TS, detail, result: 'exists' }], last_assessed: TS,
      signals: [], evidenceArtifactIds: [], automationSource: 'graph', lastFetchedAt: TS, implementation_narrative: detail,
    });
    const LIVE = 'Password reuse: the domain password policy remembers 24 generations';

    test('run 45 shape -> uncounted; IA.L2-3.5.8 met at Tier 2; the ledger says why the record was uncounted', () => {
      const signals = new Map([['IA.L2-3.5.8', tier2('IA.L2-3.5.8', '3.5.8', LIVE)], ['AU.L2-3.3.1', tier2('AU.L2-3.3.1', '3.3.1', 'Audit: on')], ['CM.L2-3.4.2', tier2('CM.L2-3.4.2', '3.4.2', 'ASR: on')]]);
      const snap = new ControlAssessor(controlsRefPath).merge(slug, [], [], [], [], sources(), signals, undefined, []);
      const c = (id: string) => snap.controls.find(x => x.control_id === id) as EoControlAssessment;
      expect(c('IA.L2-3.5.8').status).toBe('met');
      expect(c('IA.L2-3.5.8').statusRationale).toMatch(/^Tier 2 \(live read\) decides/);
      expect(c('AU.L2-3.3.1').status).toBe('not_met');
      expect(c('AU.L2-3.3.1').statusRationale).toMatch(/^Tier 1 /);
      expect(c('CM.L2-3.4.2').status).toBe('not_met');
      expect(c('CM.L2-3.4.2').statusRationale).toMatch(/^Tier 1 /);
      expect(c('CM.L2-3.4.2').assessmentFinding).toBe('Stamper entry CM.L2-3.4.2.asr-rules (CM.L2-3.4.2.asr-rules) NOT_SAT: Command failed: (400) Bad Request');

      const ledger = buildDeterminationLedger({ tenantId: slug, generatedAt: TS, snapshot: snap });
      const obj = ledger.objectives.find(o => o.objectiveId.startsWith('IA.L2-3.5.8'))!;
      expect(obj.status).toBe('satisfied');
      expect(obj.rationale).toContain(`IA.L2-3.5.8 is met at Tier 2 (live read): "${LIVE}"`);
      expect(obj.rationale).toContain(`1 Stamper record(s) not counted: "Renderable: Entra ID Password Protection Policy Settings" (NOT_SAT on an empty payload; ${EMPTY_READ_UNCOUNTED}: Command completed but expected data output was empty)`);
    });

    test('run 45 shape and no live opinion -> not assessed, never not met', () => {
      const snap = new ControlAssessor(controlsRefPath).merge(slug, [], [], [], [], sources(), new Map(), undefined, []);
      const c = snap.controls.find(x => x.control_id === 'IA.L2-3.5.8') as EoControlAssessment;
      expect(c.status).toBe('not_assessed');
      const ledger = buildDeterminationLedger({ tenantId: slug, generatedAt: TS, snapshot: snap });
      const obj = ledger.objectives.find(o => o.objectiveId.startsWith('IA.L2-3.5.8'))!;
      expect(obj.rationale).toContain(EMPTY_READ_UNCOUNTED);
    });
  });

  test('SSP evidence text: an evidence-only empty NOT_SAT is named uncounted; a state-verified one is not', () => {
    const base = { kind: 'stamper' as const, path: 'p.json', sha256: 'x', timestamp: TS, entryId: 'e', verdict: 'NOT_SAT', payloadEmpty: true as const, method: 'examine' as never };
    expect(stamperVerdictText({ ...base, mode: 'evidence-only', modeLabel: 'state not verified' })).toBe('NOT_SAT (empty payload; empty read, uncounted)');
    expect(stamperVerdictText({ ...base, mode: 'state-verified', modeLabel: 'state verified' })).toBe('NOT_SAT (empty payload)');
  });
});
