// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * PH7-EO (orchestrator decision, option a): a Stamper record written while running a manual_gate task's runnable
 * sub-commands carries `metadata.gateContext: 'manual_gate'` (P7-ST, CONTRACT CHANGE, additive). EO shows it in the
 * SSP evidence index and never counts it, whatever its verdict: credit comes only through the gate review (GD-b).
 * Drives the real loader, ControlAssessor.merge, the ledger, the SSP evidence details, the chain read-back and the
 * blob filter. Fictional ids only.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import {
  StamperEvidenceLoader, MANUAL_GATE_DISPLAY_ONLY, gateContextOf,
} from '../../../src/eo/evidence/StamperEvidenceLoader';
import { ControlAssessor } from '../../../src/eo/assessment/ControlAssessor';
import { buildDeterminationLedger } from '../../../src/eo/assessment/DeterminationLedger';
import { buildEvidenceDetails, stamperVerdictText, evidenceLineFor, type EvidenceDetail } from '../../../src/eo/ssp/SspGenerator';
import { stamperEvidenceFromChain, STAMPER_EVIDENCE_SOURCE, type StamperEvidenceFileItem } from '../../../src/eo/collect/StamperEvidenceCollector';
import { blobInScope } from '../../../src/eo/server/routers/assessment-router';
import { buildEvidenceIndex } from '../../../src/eo/packager/EvidenceIndex';
import type { EvidenceStore } from '../../../src/eo/evidence/store/EvidenceStore';

type StamperDetail = Extract<EvidenceDetail, { kind: 'stamper' }>;

const SLUG = 'ph7-gatectx-sim';
const STACK = 'AC.L1-3.1.1';
const OTHER = 'AC.L2-3.1.5';
const TS = '2026-11-01T10:00:00.000Z';
const EXECUTOR = 'stamper/1.0.0@00000000-0000-4000-8000-00000000c1a0';
const controlsRefPath = require.resolve('ces-shared/data/cmmc-l2-controls');
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

/** A state-verified Stamper record; with `ctx`, written inside a manual gate (P7-ST's shape). */
function record(controls: string[], o: { id: string; verdict: 'SAT' | 'NOT_SAT'; ctx?: boolean; gate?: boolean }) {
  const raw = JSON.stringify({ value: [{ id: 'policy-1', state: 'enabled' }] });
  return {
    rawResponse: raw, outcome: o.verdict === 'SAT' ? 'automated_success' : 'failed_remediation_available',
    outcomeRationale: o.verdict === 'SAT' ? '' : 'Verification failed: $.value[0].state expected enabled',
    complianceVerdict: o.verdict, verdictRationale: 'x',
    registryEntry: { entry_id: o.id, label: `${o.id} label`, control_ids: controls },
    metadata: {
      controlIds: controls, timestamp: TS, executorIdentity: EXECUTOR,
      commandExecuted: 'Set-MgPolicy -Id policy-1', sha256Hash: sha(raw),
      ...(o.ctx ? { gateContext: 'manual_gate' } : {}),
      ...(o.gate ? { gate: 'manual', gateAction: 'approved', ownerRole: 'it_admin' } : {}),
    },
  };
}

describe('PH7-EO: a manual-gate run record (metadata.gateContext manual_gate) is display only', () => {
  let tmp: string;
  let evDir: string;
  const prevPipeline = process.env.CES_PIPELINE_ROOT;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-ph7-gatectx-'));
    process.env.CES_PIPELINE_ROOT = tmp;
    evDir = path.join(tmp, 'Stamper', 'plan-data', SLUG, 'evidence');
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    if (prevPipeline === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = prevPipeline;
  });

  const write = (rel: string, body: unknown) => {
    const f = path.join(evDir, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(body, null, 2));
  };
  const load = () => {
    const loader = new StamperEvidenceLoader(SLUG);
    const evidence = loader.loadEvidenceForTenant();
    return { evidence, sources: loader.toAssessmentSources(evidence) };
  };
  const merge = () => new ControlAssessor(controlsRefPath, []).merge(SLUG, [], [], [], [], load().sources, undefined, undefined, []);
  const ctl = (snap: ReturnType<typeof merge>, id: string) => snap.controls.find(c => c.control_id === id)! as ReturnType<typeof merge>['controls'][number] & { statusRationale: string };

  it('parses metadata.gateContext; only the exact value manual_gate counts', () => {
    expect(gateContextOf({ metadata: { gateContext: 'manual_gate' } })).toBe('manual_gate');
    expect(gateContextOf({ metadata: { gateContext: 'Manual_Gate' } })).toBeUndefined();
    expect(gateContextOf({ metadata: {} })).toBeUndefined();
    expect(gateContextOf(null)).toBeUndefined();
    write('access_control/ctx.json', record([STACK], { id: 'AC-CTX', verdict: 'SAT', ctx: true }));
    write('access_control/plain.json', record([OTHER], { id: 'AC-PLAIN', verdict: 'SAT' }));
    const byId = new Map(load().evidence.map(e => [e.entryId, e]));
    expect(byId.get('AC-CTX')!.gateContext).toBe('manual_gate');
    expect(byId.get('AC-PLAIN')!.gateContext).toBeUndefined();
  });

  it('a state-verified SAT run inside a manual gate is no_query on every control it names: the control is not credited', () => {
    write('access_control/ctx.json', record([STACK, OTHER], { id: 'AC-CTX', verdict: 'SAT', ctx: true }));
    const { sources } = load();
    for (const id of [STACK, OTHER]) {
      expect(sources.get(id)!.map(s => s.result)).toEqual(['no_query']);
      expect(sources.get(id)![0].detail).toBe(`AC-CTX label [executor ${EXECUTOR}] (${MANUAL_GATE_DISPLAY_ONLY})`);
    }
    const snap = merge();
    expect(ctl(snap, STACK).status).toBe('not_assessed');
    expect(ctl(snap, OTHER).status).toBe('not_assessed');
  });

  it('control case: the same record without gateContext credits the control', () => {
    write('access_control/plain.json', record([STACK], { id: 'AC-PLAIN', verdict: 'SAT' }));
    expect(load().sources.get(STACK)!.map(s => s.result)).toEqual(['imported']);
    expect(ctl(merge(), STACK).status).toBe('met');
  });

  it('a NOT_SAT run inside a manual gate is no opinion too (display only), never a Tier 1 not_met', () => {
    write('access_control/ctx-neg.json', record([STACK], { id: 'AC-CTX-NEG', verdict: 'NOT_SAT', ctx: true }));
    expect(load().sources.get(STACK)!.map(s => s.result)).toEqual(['no_query']);
    expect(ctl(merge(), STACK).status).toBe('not_assessed');
  });

  it('gateContext wins over an approved manual-gate record (FIN-10 gate fields): still display only on a stack control', () => {
    write('access_control/both.json', record([STACK], { id: 'AC-BOTH', verdict: 'SAT', ctx: true, gate: true }));
    const s = load().sources.get(STACK)!;
    expect(s.map(x => x.result)).toEqual(['no_query']);
    expect(s[0].detail.endsWith(`(${MANUAL_GATE_DISPLAY_ONLY})`)).toBe(true);
    expect(ctl(merge(), STACK).status).toBe('not_assessed');
  });

  it('beside an ordinary SAT on the same control, only the ordinary record decides', () => {
    write('access_control/ctx.json', record([STACK], { id: 'AC-CTX', verdict: 'SAT', ctx: true }));
    write('access_control/plain.json', record([STACK], { id: 'AC-PLAIN', verdict: 'SAT' }));
    const snap = merge();
    expect(ctl(snap, STACK).status).toBe('met');
    expect(ctl(snap, STACK).statusRationale).toContain('AC-PLAIN label');
    expect(ctl(snap, STACK).statusRationale).not.toContain('AC-CTX label');
  });

  it('the ledger lists it as not counted, with the reason', () => {
    write('access_control/ctx.json', record([STACK], { id: 'AC-CTX', verdict: 'SAT', ctx: true }));
    const ledger = buildDeterminationLedger({ tenantId: SLUG, generatedAt: TS, snapshot: merge() });
    const obj = ledger.objectives.find(o => o.controlId === STACK)!;
    expect(obj.rationale).toContain(`1 Stamper record(s) not counted: "AC-CTX label" (${MANUAL_GATE_DISPLAY_ONLY})`);
    expect(obj.rationale).not.toContain('counted Stamper record(s) for the control');
  });

  it('the SSP evidence index shows it, labelled display only', () => {
    write('access_control/ctx.json', record([STACK], { id: 'AC-CTX', verdict: 'SAT', ctx: true }));
    write('access_control/plain.json', record([OTHER], { id: 'AC-PLAIN', verdict: 'SAT' }));
    const details = buildEvidenceDetails(load().evidence, undefined, SLUG);
    const d = details.get(STACK)!.find((x): x is StamperDetail => x.kind === 'stamper')!;
    expect(d.entryId).toBe('AC-CTX');
    expect(d.gateContext).toBe('manual_gate');
    expect(stamperVerdictText(d)).toBe('SAT (manual-gate run; display only, not counted)');
    expect(evidenceLineFor(details.get(STACK))).toContain('SAT (manual-gate run; display only, not counted)');
    const plain = details.get(OTHER)!.find((x): x is StamperDetail => x.kind === 'stamper')!;
    expect(plain.gateContext).toBeUndefined();
    expect(stamperVerdictText(plain)).toBe('SAT');
  });

  it('the evidence package index carries the display-only marker on the stamper entry', () => {
    write('access_control/ctx.json', record([STACK], { id: 'AC-CTX', verdict: 'SAT', ctx: true }));
    write('access_control/plain.json', record([OTHER], { id: 'AC-PLAIN', verdict: 'SAT' }));
    const details = buildEvidenceDetails(load().evidence, undefined, SLUG);
    const index = buildEvidenceIndex({
      controls: [STACK, OTHER].map(id => ({ control_id: id, family: 'AC', status: 'not_assessed', evidenceDetails: details.get(id) })),
      generatedAt: TS,
    });
    const e = (id: string) => index.entries.find(x => x.controlId === id && x.kind === 'stamper')!;
    expect(e(STACK).gateContext).toBe('manual_gate');
    expect(e(OTHER).gateContext).toBeUndefined();
  });

  it('the chain read-back gives an old payload (chained before PH7, no gateContext) its gateContext from the chained document', () => {
    const doc = record([STACK], { id: 'AC-CTX', verdict: 'SAT', ctx: true });
    write('access_control/ctx.json', doc);
    const fresh = new StamperEvidenceLoader(SLUG).loadEvidenceForTenant()[0];
    const { gateContext: _ctx, ...old } = fresh;
    const item: StamperEvidenceFileItem = {
      kind: 'file', id: 'file:access_control/ctx.json@x', relPath: 'access_control/ctx.json', fileSha256: 'x',
      observedAt: TS, controlIds: [STACK], document: doc, evidence: old,
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
    expect(chained.evidence).toEqual([fresh]);
    expect(new StamperEvidenceLoader(SLUG).toAssessmentSources(chained.evidence).get(STACK)![0].result).toBe('no_query');
  });

  it('a manual-gate run record uploaded as a blob is never a blob source', () => {
    const now = Date.parse(TS) + 60_000;
    expect(blobInScope(record([STACK], { id: 'AC-CTX', verdict: 'SAT', ctx: true }), { slug: SLUG }, now)).toEqual({ ok: false, reason: 'manual_gate' });
    expect(blobInScope(record([STACK], { id: 'AC-PLAIN', verdict: 'SAT' }), { slug: SLUG }, now)).toEqual({ ok: true });
  });
});
