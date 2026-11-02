// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * W1.1 — the verdict rule (founder decision B7 (d), B8), driven through the real
 * ControlAssessor.merge and the real StamperEvidenceLoader. Precedence, top wins:
 *   Tier 1 current-run Stamper NOT_SAT > Tier 2 live read > Tier 3 state-verified Stamper SAT
 *   > Tier 4 evidence-only SAT ("state not verified").
 * Policies never set status (F7). A stale NOT_SAT file from another run does not decide (F5).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AssessmentSource, ControlAssessment } from 'ces-shared/types/controls';
import type { PolicyDocument } from 'ces-shared/types/policy';
import { ControlAssessor, type EoControlAssessment, type ObjectiveSourceMap } from '../../../src/eo/assessment/ControlAssessor';
import { StamperEvidenceLoader, type StamperEvidence } from '../../../src/eo/evidence/StamperEvidenceLoader';

const controlsRefPath = require.resolve('ces-shared/data/cmmc-l2-controls');
const C = 'AC.L1-3.1.1';
const TS = '2026-10-27T13:00:40.000Z';

const loader = new StamperEvidenceLoader('w11-verdict');

function stamperFile(verdict: 'SAT' | 'NOT_SAT', mode: 'state-verified' | 'evidence-only', label: string, outcomeRationale = ''): StamperEvidence {
  return {
    complianceVerdict: verdict, sha256Hash: 'x', timestamp: TS, controlIds: [C], entryId: label, label,
    commandExecuted: mode === 'evidence-only' ? `[manual/evidence-only] ${label}` : 'Get-Something', mode, outcomeRationale,
  };
}

const live = (result: 'exists' | 'missing' | 'no_query', detail = 'live read'): ControlAssessment => ({
  control_id: C, nist_ref: '3.1.1', status: result === 'exists' ? 'met' : result === 'missing' ? 'not_met' : 'not_assessed',
  classification: 'automated', sources: [{ type: 'discovery', timestamp: TS, detail, result }], last_assessed: TS,
  signals: [], evidenceArtifactIds: [], automationSource: 'graph', lastFetchedAt: TS,
});

const stamperExec = (result: AssessmentSource['result']): AssessmentSource =>
  ({ type: 'stamper_execution', timestamp: TS, detail: 'Stamper task (run r1)', result });

interface Inputs {
  files?: StamperEvidence[];
  extra?: AssessmentSource[];
  signal?: ControlAssessment;
  policies?: PolicyDocument[];
  objectives?: ObjectiveSourceMap;
}

function assess(inp: Inputs): EoControlAssessment {
  const stamper = loader.toAssessmentSources(inp.files ?? []);
  if (inp.extra) stamper.set(C, [...(stamper.get(C) ?? []), ...inp.extra]);
  const signals = inp.signal ? new Map([[C, inp.signal]]) : undefined;
  const snap = new ControlAssessor(controlsRefPath, []).merge('w11', [], [], [], inp.policies ?? [], stamper, signals, undefined, [], inp.objectives);
  return snap.controls.find(c => c.control_id === C) as EoControlAssessment;
}

describe('W1.1 precedence (top tier with an opinion wins)', () => {
  it('Tier 1: a current-run NOT_SAT file beats a positive live read and state-verified SAT files', () => {
    const c = assess({ files: [stamperFile('NOT_SAT', 'state-verified', 'Set X failed'), stamperFile('SAT', 'state-verified', 'Set Y')], signal: live('exists') });
    expect(c.status).toBe('not_met');
    expect(c.statusRationale).toMatch(/^Tier 1/);
    expect(c.statusRationale).toContain('Set X failed');
  });

  it('Tier 1: an evidence-only NOT_SAT (empty output, not a 404) also decides', () => {
    const c = assess({ files: [stamperFile('NOT_SAT', 'evidence-only', 'Empty output', 'Command completed but expected data output was empty')], signal: live('exists') });
    expect(c.status).toBe('not_met');
    expect(c.statusRationale).toMatch(/^Tier 1/);
  });

  it('Tier 1: a failed Stamper task in the execution-results manifest (FX-12) beats a positive live read', () => {
    const c = assess({ extra: [stamperExec('missing')], signal: live('exists') });
    expect(c.status).toBe('not_met');
    expect(c.statusRationale).toMatch(/^Tier 1/);
  });

  it('Tier 2: a negative live read (class D, AC.L1-3.1.1) beats SAT files of both modes', () => {
    const c = assess({
      files: [stamperFile('SAT', 'state-verified', 'Create CUI group'), stamperFile('SAT', 'evidence-only', 'Verify CA policies')],
      extra: [stamperExec('no_query')],
      signal: live('missing', 'CA policies read, none enforce MFA + compliant device'),
    });
    expect(c.status).toBe('not_met');
    expect(c.statusRationale).toMatch(/^Tier 2 \(live read\)/);
    expect(c.statusRationale).toContain('none enforce MFA');
  });

  it('Tier 2: a positive live read beats a negative state-verified execution verdict (AdminOps)', () => {
    const c = assess({ extra: [{ type: 'adminops_execution', timestamp: TS, detail: 'AdminOps NOT_SAT', result: 'missing' }], signal: live('exists') });
    expect(c.status).toBe('met');
    expect(c.statusRationale).toMatch(/^Tier 2/);
  });

  it('Tier 3: a state-verified SAT decides over an evidence-only SAT when there is no live read', () => {
    const c = assess({ files: [stamperFile('SAT', 'state-verified', 'Set Y'), stamperFile('SAT', 'evidence-only', 'Verify Y')], signal: live('no_query') });
    expect(c.status).toBe('met');
    expect(c.statusRationale).toMatch(/^Tier 3/);
    expect(c.statusRationale).not.toContain('state not verified;');
  });

  it('Tier 3: a negative state-verified verdict beats an evidence-only SAT', () => {
    const c = assess({ files: [stamperFile('SAT', 'evidence-only', 'Verify Y')], extra: [{ type: 'adminops_execution', timestamp: TS, detail: 'AdminOps NOT_SAT', result: 'missing' }] });
    expect(c.status).toBe('not_met');
    expect(c.statusRationale).toMatch(/^Tier 3/);
  });

  it('Tier 4 (B8): an evidence-only SAT alone counts as met, labelled "state not verified"', () => {
    const c = assess({ files: [stamperFile('SAT', 'evidence-only', 'Verify Y')] });
    expect(c.status).toBe('met');
    expect(c.statusRationale).toMatch(/^Tier 4/);
    expect(c.statusRationale).toContain('state not verified');
    expect(c.sources.find(s => s.type === 'evidence_import')!.detail).toBe('Verify Y (state not verified)');
  });

  it('W1.0 effect: an unread live signal plus an evidence-only SAT stays met (no negative source)', () => {
    const c = assess({ files: [stamperFile('SAT', 'evidence-only', 'Verify Y')], extra: [stamperExec('no_query')], signal: live('no_query', "'users' was not read") });
    expect(c.status).toBe('met');
  });

  it('a 404 NOT_SAT (class C prime) is no opinion: with an evidence-only SAT beside it the control stays met', () => {
    const c = assess({ files: [
      stamperFile('NOT_SAT', 'evidence-only', 'Verify identity', 'The remote server returned an error: (404) Not Found.'),
      stamperFile('SAT', 'evidence-only', 'Verify auth methods'),
    ] });
    expect(c.status).toBe('met');
    expect(c.statusRationale).toMatch(/^Tier 4/);
  });

  it('every source unread -> not_assessed', () => {
    const c = assess({ extra: [stamperExec('no_query')], signal: live('no_query') });
    expect(c.status).toBe('not_assessed');
  });
});

describe('W1.1 per-objective scoring (B7 (d))', () => {
  const obj = (entries: Array<[string, AssessmentSource[]]>): ObjectiveSourceMap => new Map([[C, new Map(entries)]]);
  const src = (type: AssessmentSource['type'], result: AssessmentSource['result'], detail: string): AssessmentSource => ({ type, timestamp: TS, detail, result });

  it('met only if every objective is met', () => {
    const all = assess({ signal: live('exists'), objectives: obj([['3.1.1[a]', [src('discovery', 'exists', 'a ok')]], ['3.1.1[b]', [src('discovery', 'exists', 'b ok')]]]) });
    expect(all.status).toBe('met');
    expect(all.statusRationale).toMatch(/^Scored per objective \(2\)/);

    const one = assess({ signal: live('exists'), objectives: obj([['3.1.1[a]', [src('discovery', 'exists', 'a ok')]], ['3.1.1[b]', [src('discovery', 'missing', 'b absent')]]]) });
    expect(one.status).toBe('not_met');
    expect(one.statusRationale).toContain('3.1.1[b] not_met');
  });

  it('some objectives met, the rest unread -> partial (ledger roll-up), never not_met', () => {
    const c = assess({ objectives: obj([['3.1.1[a]', [src('discovery', 'exists', 'a ok')]], ['3.1.1[b]', [src('discovery', 'no_query', 'b unread')]]]) });
    expect(c.status).toBe('partial');
  });

  it('the same precedence applies inside an objective, and a control-level Tier 1 still decides', () => {
    const inside = assess({ objectives: obj([['3.1.1[a]', [src('discovery', 'missing', 'a absent'), src('evidence_import', 'imported', 'SAT')]]]) });
    expect(inside.status).toBe('not_met');

    const tier1 = assess({ extra: [stamperExec('missing')], objectives: obj([['3.1.1[a]', [src('discovery', 'exists', 'a ok')]]]) });
    expect(tier1.status).toBe('not_met');
    expect(tier1.statusRationale).toMatch(/^Tier 1/);
  });
});

describe('W1.1 policies never set status (F7)', () => {
  const policy: PolicyDocument = { template_id: 'acp', title: 'Access Control Policy', markdown: '# ACP', completeness: 100, domain: 'Access Control', nist_controls: ['3.1.1', '3.1.2'] };

  it('a complete policy alone no longer makes a control met', () => {
    const c = assess({ policies: [policy] });
    expect(c.status).toBe('not_assessed');
    expect(c.sources.some(s => s.type === 'policy_doc')).toBe(false);
  });

  it('a complete policy does not outvote a negative live read', () => {
    expect(assess({ policies: [policy], signal: live('missing') }).status).toBe('not_met');
  });

  it('the snapshot is the same with and without policies', () => {
    const strip = (s: ReturnType<ControlAssessor['merge']>) => ({
      ...s, snapshotId: '', generatedAt: '',
      controls: s.controls.map(c => ({ ...c, last_assessed: '', lastFetchedAt: '' })),
    });
    const a = new ControlAssessor(controlsRefPath, []);
    const files = loader.toAssessmentSources([stamperFile('SAT', 'evidence-only', 'Verify Y')]);
    expect(strip(a.merge('w11', [], [], [], [policy], files))).toEqual(strip(a.merge('w11', [], [], [], [], files)));
  });
});

describe('W1.1 current-run filter (F5): a stale NOT_SAT file does not decide', () => {
  let tmp: string;
  const prev = process.env.CES_PIPELINE_ROOT;
  const slug = 'w11-stale';
  const EXECUTION_START = '2026-10-27T13:05:00.000Z';

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'w11-'));
    process.env.CES_PIPELINE_ROOT = tmp;
    const dir = path.join(tmp, 'Stamper', 'plan-data', slug, 'evidence', 'system_comms');
    fs.mkdirSync(dir, { recursive: true });
    const write = (file: string, verdict: string, timestamp: string, command: string, runId?: string) =>
      fs.writeFileSync(path.join(dir, file), JSON.stringify({
        // W0.2a: a SAT counts only with a non-empty rawResponse, so every fixture carries one.
        rawResponse: '{"value":[{"id":"p1"}]}',
        complianceVerdict: verdict, outcomeRationale: verdict === 'SAT' ? 'exit code 0' : 'forced failure (test flag)',
        registryEntry: { entry_id: file, label: file, control_ids: ['SC.L2-3.13.15'] },
        metadata: { controlIds: ['SC.L2-3.13.15'], timestamp, commandExecuted: command, sha256Hash: 'x', ...(runId ? { runId } : {}) },
      }));
    // The forced-failure run's NOT_SAT, left on disk before the current run started.
    write('sc.l2-3.13.15.anti-spam.json', 'NOT_SAT', '2026-10-27T13:01:03.841Z', '[--force-fail SC.L2-3.13.15.anti-spam: SET not sent]');
    // The current run's files.
    write('sc.l2-3.13.15.anti-phish.json', 'SAT', '2026-10-27T13:06:00.000Z', 'New-AntiPhishPolicy');
    // A record that carries a run id is judged by the run id, not by its timestamp.
    write('sc.l2-3.13.15.dkim.json', 'NOT_SAT', '2026-10-27T13:07:00.000Z', 'New-DkimSigningConfig', 'run-old');
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    if (prev === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = prev;
  });

  const statusOf = (evidence: StamperEvidence[]) => {
    const l = new StamperEvidenceLoader(slug);
    return new ControlAssessor(controlsRefPath, []).merge('w11', [], [], [], [], l.toAssessmentSources(evidence))
      .controls.find(c => c.control_id === 'SC.L2-3.13.15')!.status;
  };

  it('without the filter the stale NOT_SAT (and the old-run file) would decide', () => {
    const all = new StamperEvidenceLoader(slug).loadEvidenceForTenant();
    expect(all).toHaveLength(3);
    expect(statusOf(all)).toBe('not_met');
  });

  it('with the current run (run id + execution start) only the current-run file is kept and the control is met', () => {
    const current = new StamperEvidenceLoader(slug).loadEvidenceForTenant({ runId: 'run-new', executionStart: EXECUTION_START });
    expect(current.map(e => e.entryId)).toEqual(['sc.l2-3.13.15.anti-phish.json']);
    expect(current[0].commandExecuted).toBe('New-AntiPhishPolicy');
    expect(current[0].mode).toBe('state-verified');
    expect(statusOf(current)).toBe('met');
  });

  it('a record whose run id matches the current run is kept whatever its timestamp', () => {
    const kept = new StamperEvidenceLoader(slug).loadEvidenceForTenant({ runId: 'run-old', executionStart: EXECUTION_START });
    expect(kept.map(e => e.entryId).sort()).toEqual(['sc.l2-3.13.15.anti-phish.json', 'sc.l2-3.13.15.dkim.json']);
  });
});
