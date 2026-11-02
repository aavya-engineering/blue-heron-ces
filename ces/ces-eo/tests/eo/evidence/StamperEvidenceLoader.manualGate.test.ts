// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FIN-10 (FD-2, NS-audit F-1): a manual-gate approval never credits a non-stack control. The gate
 * record loads as `no_query` (pending_review, below GD-b), so only GD-b document reviews or the
 * records stores decide. Covers the GUI approval record (the execute route's shape), the GUI
 * auto-mode PROVISIONAL record, a rejected gate, an approval naming a stack control, the CLI's
 * evidence-by-task records (never loaded), the chain read-back of an old payload, and the 28-control
 * set recomputed from the reference data. Drives the real loader and ControlAssessor.merge.
 * Fictional ids only.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { EcEvidenceItem } from 'ces-shared/types/evidence-collector';
import { EC_CONTRACT_VERSION } from 'ces-shared/types/evidence-collector';
import {
  StamperEvidenceLoader, NON_STACK_CONTROL_IDS, GATE_PENDING_REVIEW, GATE_NO_ACTION, isGatePendingReviewSource, manualGateOf,
} from '../../../src/eo/evidence/StamperEvidenceLoader';
import { ControlAssessor, GATE_PENDING_REVIEW_RATIONALE, objectiveIdsByControl, type DocumentReview } from '../../../src/eo/assessment/ControlAssessor';
import { stamperEvidenceFromChain, STAMPER_EVIDENCE_SOURCE, type StamperEvidenceFileItem } from '../../../src/eo/collect/StamperEvidenceCollector';
import type { EvidenceStore } from '../../../src/eo/evidence/store/EvidenceStore';

const SLUG = 'fin10-sim';
const PE = 'PE.L1-3.10.1';
const PS = 'PS.L2-3.9.2';
const STACK = 'AC.L1-3.1.1';
const HASH = 'c'.repeat(64);
const UPLOADER = { subjectId: 'uploader:u1', upn: 'uploader.one@fin10.example.test' };
const REVIEWER = 'reviewer.two@fin10.example.test';
const controlsRefPath = require.resolve('ces-shared/data/cmmc-l2-controls');
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

/** The GUI execute route's manual-gate record (execute.routes.ts, manual_gate branch). */
function guiGate(controls: string[], gateAction: 'approved' | 'none', id = 'manual-gate-sub') {
  const raw = JSON.stringify({ status: 'approved', mode: gateAction === 'approved' ? 'batch' : 'auto', operator: 'gui-operator', task_id: 't1', controls });
  return {
    rawResponse: raw,
    outcome: gateAction === 'approved' ? 'manual_action' : 'verification_pending',
    outcomeRationale: 'Outcome: manual_action',
    complianceVerdict: gateAction === 'approved' ? 'SAT' : 'PROVISIONAL',
    verdictRationale: 'x',
    registryEntry: { entry_id: id, label: `${id} label`, control_ids: controls },
    metadata: {
      controlIds: controls, timestamp: '2026-10-31T10:00:00.000Z', executorIdentity: 'stamper/1.0.0@00000000-0000-4000-8000-00000000c1a0',
      commandExecuted: `[manual/evidence-only] ${id} label`, sha256Hash: sha(raw),
      gate: 'manual', ownerRole: 'facility_manager', gateAction,
    },
  };
}

/** The CLI's record (buildManualGateEvidence) for a rejected gate. */
function rejectedGate(controls: string[]) {
  const raw = JSON.stringify({ task_id: 't2', controls, action: 'rejected' });
  return {
    rawResponse: raw, outcome: 'failed_no_remediation', outcomeRationale: 'Manual gate rejected by an operator in this run (owner role facility_manager)',
    complianceVerdict: 'NOT_SAT', verdictRationale: 'Operator rejected the gate',
    registryEntry: { entry_id: 'manual-rejected', label: 'manual-rejected label' },
    metadata: {
      controlIds: controls, timestamp: '2026-10-31T10:00:00.000Z', commandExecuted: '[manual-gate] t2', sha256Hash: sha(raw),
      gate: 'manual', ownerRole: 'facility_manager', gateAction: 'rejected',
    },
  };
}

/** An ordinary state-verified Stamper SAT (no gate). */
function stackSat(controls: string[], id = 'AC-01') {
  return {
    rawResponse: '{"value":[{"id":"x"}]}', complianceVerdict: 'SAT', outcomeRationale: '',
    registryEntry: { entry_id: id, label: `${id} label` },
    metadata: { controlIds: controls, timestamp: '2026-10-31T10:00:00.000Z', commandExecuted: 'Set-MgPolicy', sha256Hash: HASH },
  };
}

function ecItem(controlId: string): EcEvidenceItem {
  return {
    contractVersion: EC_CONTRACT_VERSION as EcEvidenceItem['contractVersion'],
    itemId: `item-${controlId}`, tenantSlug: SLUG, controlIds: [controlId], source: 'manual_upload',
    filename: 'visitor-log.pdf', mediaType: 'application/pdf', sha256: HASH, sizeBytes: 10,
    collectedAt: '2026-10-31T00:00:00.000Z', submittedByRole: 'compliance_officer', uploadedBy: UPLOADER, mode: 'sim',
  };
}
let n = 0;
const reviewsFor = (controlId: string, verdict: 'met' | 'not_met' = 'met'): DocumentReview[] =>
  objectiveIdsByControl().get(controlId)!.map(objectiveId => {
    n++;
    return {
      reviewId: `rev-${n}`, tenantSlug: SLUG, controlId, objectiveId, artifactHash: HASH, verdict,
      reviewer: { upn: REVIEWER, subjectId: `ao-approver:${REVIEWER}`, tokenId: `jti-${n}` },
      uploader: UPLOADER, ecItemIds: [`item-${controlId}`], reviewedAt: '2026-10-31T11:00:00.000Z',
    };
  });

describe('FIN-10: manual-gate records never credit a non-stack control (FD-2)', () => {
  let tmp: string;
  let evDir: string;
  const prevPipeline = process.env.CES_PIPELINE_ROOT;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-fin10-'));
    process.env.CES_PIPELINE_ROOT = tmp;
    evDir = path.join(tmp, 'Stamper', 'plan-data', SLUG, 'evidence');
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    if (prevPipeline === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = prevPipeline;
  });

  const write = (rel: string, body: unknown, base = evDir) => {
    const f = path.join(base, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(body, null, 2));
  };
  const load = () => {
    const loader = new StamperEvidenceLoader(SLUG);
    const evidence = loader.loadEvidenceForTenant();
    return { evidence, sources: loader.toAssessmentSources(evidence) };
  };
  const merge = (reviews: DocumentReview[] = [], ec: EcEvidenceItem[] = []) =>
    new ControlAssessor(controlsRefPath, []).merge(SLUG, [], [], [], [], load().sources, undefined, undefined, ec, undefined, reviews);
  const ctl = (snap: ReturnType<typeof merge>, id: string) => snap.controls.find(c => c.control_id === id)! as ReturnType<typeof merge>['controls'][number] & { statusRationale: string };

  it('the non-stack set is the 28 controls of AUDIT-NONSTACK §1, recomputed from the reference data', () => {
    const matrix = JSON.parse(fs.readFileSync(require.resolve('ces-shared/data/assessor-evidence-matrix'), 'utf-8').replace(/^﻿/, ''));
    const byPractice = new Map<string, boolean[]>();
    for (const o of matrix.objectives as Array<{ practice_id: string; evidence: Array<{ ces_source: string }> }>) {
      if (!byPractice.has(o.practice_id)) byPractice.set(o.practice_id, []);
      byPractice.get(o.practice_id)!.push(o.evidence.some(e => e.ces_source === 'stack_signal'));
    }
    const noStack = [...byPractice].filter(([, v]) => v.every(x => !x)).map(([k]) => k);
    expect(noStack).toHaveLength(25);
    const expected = new Set([...noStack, 'AT.L2-3.2.1', 'AT.L2-3.2.3', 'PS.L2-3.9.2']);
    expect([...NON_STACK_CONTROL_IDS].sort()).toEqual([...expected].sort());
    expect(NON_STACK_CONTROL_IDS.size).toBe(28);
    const objectives = [...NON_STACK_CONTROL_IDS].reduce((s, c) => s + (objectiveIdsByControl().get(c)?.length ?? 0), 0);
    expect(objectives).toBe(73);
  });

  it('parses the gate fields of both writers (GUI route and CLI)', () => {
    expect(manualGateOf(guiGate([PE], 'approved'))).toEqual({ action: 'approved', ownerRole: 'facility_manager' });
    expect(manualGateOf(guiGate([PE], 'none'))).toEqual({ action: 'none', ownerRole: 'facility_manager' });
    expect(manualGateOf(rejectedGate([PE]))).toEqual({ action: 'rejected', ownerRole: 'facility_manager' });
    expect(manualGateOf(stackSat([STACK]))).toBeUndefined();
    expect(manualGateOf({ metadata: { gate: 'cost' } })).toBeUndefined();
  });

  it('V110: a GUI-approved gate on a non-stack control is pending_review, not a credit; the control stays not_assessed', () => {
    write('physical_protection/pe-gate.json', guiGate([PE, PS], 'approved'));
    const { evidence, sources } = load();
    expect(evidence[0].gate).toEqual({ action: 'approved', ownerRole: 'facility_manager' });
    for (const id of [PE, PS]) {
      const s = sources.get(id)!;
      expect(s).toHaveLength(1);
      expect(s[0].result).toBe('no_query');
      expect(s[0].detail.endsWith(`(${GATE_PENDING_REVIEW})`)).toBe(true);
      expect(isGatePendingReviewSource(s[0])).toBe(true);
    }
    const snap = merge();
    const pe = ctl(snap, PE);
    expect(pe.status).toBe('not_assessed');
    expect(pe.statusRationale.startsWith(GATE_PENDING_REVIEW_RATIONALE)).toBe(true);
    expect(pe.automationSource).toBe('manual'); // never 'imported' from a gate approval
  });

  it('V110: GD-b reviews decide the control, whatever the gate record says', () => {
    write('physical_protection/pe-gate.json', guiGate([PE], 'approved'));
    const met = ctl(merge(reviewsFor(PE), [ecItem(PE)]), PE);
    expect(met.status).toBe('met');
    expect(met.statusRationale.startsWith('GD-b')).toBe(true);
    const notMet = ctl(merge(reviewsFor(PE, 'not_met'), [ecItem(PE)]), PE);
    expect(notMet.status).toBe('not_met');
    expect(notMet.statusRationale.startsWith('GD-b')).toBe(true);
    // A review by the uploader does not count: the gate still decides nothing.
    const self = reviewsFor(PE).map(r => ({ ...r, reviewer: { ...r.reviewer, upn: UPLOADER.upn } }));
    expect(ctl(merge(self, [ecItem(PE)]), PE).status).toBe('not_assessed');
  });

  it('an approved gate naming a stack control and a non-stack control: the stack control keeps its SAT path, the non-stack one is pending_review', () => {
    write('mixed/gate.json', guiGate([STACK, PE], 'approved'));
    const { sources } = load();
    expect(sources.get(STACK)!.map(s => s.result)).toEqual(['imported']);
    expect(sources.get(PE)!.map(s => s.result)).toEqual(['no_query']);
    const snap = merge();
    expect(ctl(snap, STACK).status).toBe('met'); // unchanged Tier 4 (evidence-only) path
    expect(ctl(snap, PE).status).toBe('not_assessed');
  });

  it('a gate with no operator action (GUI auto mode, PROVISIONAL) is no opinion on every control, never a Tier 1 not_met', () => {
    write('mixed/gate-none.json', guiGate([STACK, PE], 'none'));
    const { sources } = load();
    for (const id of [STACK, PE]) {
      expect(sources.get(id)!.map(s => [s.result, s.detail.endsWith(`(${GATE_NO_ACTION})`)])).toEqual([['no_query', true]]);
    }
    const snap = merge();
    expect(ctl(snap, STACK).status).toBe('not_assessed');
    expect(ctl(snap, PE).status).toBe('not_assessed');
  });

  it('a rejected gate stays a negative (an operator rejection never credits)', () => {
    write('physical_protection/pe-rejected.json', rejectedGate([PE]));
    const { sources } = load();
    expect(sources.get(PE)!.map(s => s.result)).toEqual(['missing']);
    expect(ctl(merge(), PE).status).toBe('not_met');
  });

  it('a non-gate Stamper SAT on a non-stack control is unchanged by FIN-10', () => {
    write('maintenance/ma-ring.json', stackSat(['MA.L2-3.7.1'], 'MA-01'));
    expect(load().sources.get('MA.L2-3.7.1')!.map(s => s.result)).toEqual(['imported']);
  });

  it('the CLI writes gate records to evidence-by-task, a sibling of the evidence folder: EO never loads them', () => {
    const byTask = path.join(path.dirname(evDir), 'evidence-by-task');
    write(`manual-${PE}/manual-gate.json`, guiGate([PE], 'approved'), byTask);
    write(`manual-${PS}/manual-gate.json`, { ...guiGate([PS], 'none'), metadata: { ...guiGate([PS], 'none').metadata, commandExecuted: '[manual-gate] t3' } }, byTask);
    expect(load().evidence).toEqual([]);
    expect(ctl(merge(), PE).status).toBe('not_assessed');
    expect(ctl(merge(), PE).statusRationale).toBe('No source has assessed this control');
  });

  it('the chain read-back gives an old payload (chained before FIN-10, no `gate`) its gate from the chained document', () => {
    const doc = guiGate([PE], 'approved');
    write('physical_protection/pe-gate.json', doc);
    const fresh = new StamperEvidenceLoader(SLUG).loadEvidenceForTenant()[0];
    const { gate: _gate, ...old } = fresh;
    const item: StamperEvidenceFileItem = {
      kind: 'file', id: 'file:physical_protection/pe-gate.json@x', relPath: 'physical_protection/pe-gate.json', fileSha256: 'x',
      observedAt: '2026-10-31T10:05:00.000Z', controlIds: [PE], document: doc, evidence: old,
    };
    const index = { kind: 'index', id: 'index:t', observedAt: 't', fileIds: [item.id], rowIds: [] };
    const recs = [
      { recordId: 'r-file', status: 'success', endpoint: 'stamper_evidence/file', query: `stamper_evidence/${item.id}`, payload: item },
      { recordId: 'r-index', status: 'success', endpoint: 'stamper_evidence/index', query: 'stamper_evidence/index:t', payload: index },
    ];
    const store = {
      query: ({ sourceId }: { sourceId: string }) => (sourceId === STAMPER_EVIDENCE_SOURCE ? recs : []),
      readPayload: (r: { payload: unknown }) => r.payload,
    } as unknown as EvidenceStore;
    const chained = stamperEvidenceFromChain(store, { records: recs.map(r => ({ recordId: r.recordId })) } as never);
    expect(chained.missing).toEqual([]);
    expect(chained.evidence).toEqual([fresh]);
    expect(new StamperEvidenceLoader(SLUG).toAssessmentSources(chained.evidence).get(PE)![0].result).toBe('no_query');
  });
});
