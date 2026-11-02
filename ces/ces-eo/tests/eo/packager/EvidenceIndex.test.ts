// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * EO-collection W4.3 / W4.4: the evidence index (bundle item 12's evidence-index.json): the vendored
 * 800-171A examine lists, the examine cross-reference, the method labels on every entry and the
 * run-25 replay (tests/fixtures/evidence-index/run25-inputs.json: run 25's SSP evidence details and
 * its 190 store records, trimmed).
 */
import { describe, it, expect } from '@jest/globals';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  buildEvidenceIndex, evidenceKindOfStoreSource, examineItemKinds, EXAMINE_LISTS_PATH, loadExamineLists, methodForDetail,
} from '../../../src/eo/packager/EvidenceIndex.js';

const fx = JSON.parse(fs.readFileSync(path.join(__dirname, '../../fixtures/evidence-index/run25-inputs.json'), 'utf-8'));
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/;
const ABSOLUTE_PATH = /(?<![A-Za-z0-9])[A-Za-z]:(?:\\|\/)(?!\/)|"\/(?:tmp|home|Users|var)\//;

describe('data/examine-lists.json (vendored 800-171A examine lists)', () => {
  const lists = loadExamineLists();

  it('holds all 110 requirements, each list as long as its count; 865 items', () => {
    expect(lists.requirements).toHaveLength(110);
    for (const r of lists.requirements) expect(r.examine.length).toBe(r.examine_count);
    expect(lists.requirements.reduce((n, r) => n + r.examine.length, 0)).toBe(865);
    expect(lists.requirements.find(r => r.requirement_id === '3.1.7')!.examine).toContain('list of privileged functions and associated user account assignments');
  });

  it('records the source hash (= run check V29\'s), and the requirements equal the source file when it is reachable', () => {
    expect(lists.source.sha256).toBe('c254a6bf7f9db189b45817c23065c80058225fbb566ab2daaad3de63a3c5a4fc');
    const src = path.resolve(path.dirname(EXAMINE_LISTS_PATH), '../../ces-muster/src/features/plan/engine/data/evidence-catalog/nist-800-171a-examine-lists.json');
    if (!fs.existsSync(src)) return; // the sibling repo is not part of every checkout
    const buf = fs.readFileSync(src);
    expect(crypto.createHash('sha256').update(buf).digest('hex')).toBe(lists.source.sha256);
    expect(JSON.parse(buf.toString('utf-8')).requirements).toEqual(lists.requirements);
  });

  it('names the contractor transcription by hash and relabels its 3.1.7 section as 3.1.9; carries no path or name', () => {
    const c = (lists.source as { contractorTranscription: { sha256: string; requirements: string[] } }).contractorTranscription;
    expect(c.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(c.requirements).toEqual(['3.1.1', '3.1.2', '3.1.3', '3.1.4', '3.1.5', '3.1.6', '3.1.9']);
    const text = fs.readFileSync(EXAMINE_LISTS_PATH, 'utf-8');
    expect(text).not.toMatch(ABSOLUTE_PATH);
    expect(text).not.toMatch(EMAIL);
  });
});

describe('examine cross-reference rules', () => {
  it('maps examine items to the evidence kinds that can cover them', () => {
    const k = (t: string) => examineItemKinds(t);
    expect(k('system security plan')).toEqual({ category: 'ssp', kinds: ['ssp'] });
    expect(k('Access control policy').category).toBe('documentary');
    expect(k('procedures addressing audit record generation').category).toBe('documentary');
    expect(k('system design documentation').category).toBe('documentary');
    expect(k('system configuration settings and associated documentation')).toEqual({ category: 'configuration', kinds: ['stamper-file', 'configuration', 'admin-ops change'] });
    expect(k('system audit logs and records').kinds).toEqual(['audit-log', 'security-monitoring']);
    expect(k('list of active system accounts and the name of the individual associated with each account').kinds).toEqual(['account-inventory']);
    expect(k('list of devices and systems authorized to connect to organizational systems').kinds).toEqual(['device-inventory']);
    expect(k('security awareness and training records').kinds).toEqual(['training-record']);
    expect(k('plan of action').kinds).toEqual(['poam']);
    expect(k('notifications or records of recently transferred, separated, or terminated employees').kinds).toEqual([]);
  });

  it('store sources map to evidence kinds; detail methods default from kind and source', () => {
    expect(evidenceKindOfStoreSource('collect.unifiedAuditLog')).toBe('audit-log');
    expect(evidenceKindOfStoreSource('directoryUsers')).toBe('account-inventory');
    expect(evidenceKindOfStoreSource('collect.deviceCompliance')).toBe('device-inventory');
    expect(evidenceKindOfStoreSource('conditionalAccess')).toBe('configuration');
    expect(evidenceKindOfStoreSource('trainingUserCoverage')).toBe('training-record');
    expect(methodForDetail({ kind: 'stamper', sha256: 'x', timestamp: 't' })).toBe('examine');
    expect(methodForDetail({ kind: 'evidence-store', sourceId: 'collect.signIns', sha256: 'x', timestamp: 't' })).toBe('examine');
    expect(methodForDetail({ kind: 'evidence-store', sourceId: 'signInLogs', sha256: 'x', timestamp: 't' })).toBe('examine'); // log records: examine (2026-10-28)
    expect(methodForDetail({ kind: 'evidence-store', sourceId: 'directoryUsers', sha256: 'x', timestamp: 't' })).toBe('test');
    expect(methodForDetail({ kind: 'evidence-store', sourceId: 'collect.signIns', method: 'test', sha256: 'x', timestamp: 't' })).toBe('test');
  });

  it('a control is covered item by item from the kinds it holds; no details leaves only the SSP and POA&M', () => {
    const ix = buildEvidenceIndex({
      generatedAt: '2026-10-28T03:00:00.000Z',
      controls: [
        { control_id: 'AU.L2-3.3.1', evidenceDetails: [{ kind: 'evidence-store', recordId: 'r1', sourceId: 'collect.unifiedAuditLog', sha256: 'a'.repeat(64), timestamp: 't', objectiveIds: [] }] },
        { control_id: 'AC.L1-3.1.1' },
      ],
    });
    const au = ix.examineCoverage.find(c => c.controlId === 'AU.L2-3.3.1')!;
    expect(au.requirementId).toBe('3.3.1');
    expect(au.items.filter(i => i.status === 'covered').map(i => i.text)).toEqual(['system security plan', 'system audit logs and records', 'system auditable events']);
    expect(au.items.find(i => i.text === 'system incident reports')).toMatchObject({ kinds: ['security-monitoring'], status: 'not covered' });
    const ac = ix.examineCoverage.find(c => c.controlId === 'AC.L1-3.1.1')!;
    expect(ac.items.filter(i => i.status === 'covered').map(i => i.text)).toEqual(['system security plan']);
    expect(ix.entries[0]).toMatchObject({ controlId: 'AU.L2-3.3.1', method: 'examine', evidenceKind: 'audit-log', unresolved: true });
    expect(ix.summary.unresolvedStoreRefs).toBe(1);
  });

  it('W2 follow-up: a C10 (collect.adminOps) record is an admin-ops change (confirmed apply) or an admin-ops read, never configuration; only a change covers configuration items', () => {
    expect(evidenceKindOfStoreSource('collect.adminOps', 'adminops_evidence/apply_confirmed')).toBe('admin-ops change');
    for (const ep of ['adminops_evidence/read', 'adminops_evidence/apply_unconfirmed', 'adminops_evidence/dry_run', 'adminops_evidence/blocked', undefined]) {
      expect(evidenceKindOfStoreSource('collect.adminOps', ep)).toBe('admin-ops read');
    }
    const rec = (recordId: string, endpoint: string) => ({
      seq: 1, recordId, tenantId: 'sim-tenant-x', sourceId: 'collect.adminOps', endpoint,
      collector: { name: 'ces-eo/collect/C10', version: 'x', identity: 'ces-eo@sim' }, query: `adminops_evidence/${recordId}`,
      window: { start: '2026-10-27T00:00:00.000Z', end: '2026-10-28T00:00:00.000Z' }, collectedAt: '2026-10-28T00:00:00.000Z',
      status: 'success', itemCount: 1, controlIds: ['AC.L1-3.1.2'],
    });
    const d = (recordId: string, method: 'test' | 'examine') =>
      ({ kind: 'evidence-store', recordId, sourceId: 'collect.adminOps', method, sha256: 'b'.repeat(64), timestamp: 't', objectiveIds: [] });
    const settings = 'system configuration settings and associated documentation';
    const build = (details: ReturnType<typeof d>[], records: ReturnType<typeof rec>[]) => buildEvidenceIndex({
      generatedAt: '2026-10-28T03:00:00.000Z', controls: [{ control_id: 'AC.L1-3.1.2', evidenceDetails: details }], records: records as any,
    });
    // A read: filed as admin-ops read; the configuration item stays uncovered (AD-6: state not verified).
    const read = build([d('r-read', 'examine')], [rec('r-read', 'adminops_evidence/read')]);
    expect(read.entries[0]).toMatchObject({ evidenceKind: 'admin-ops read', method: 'examine', sourceId: 'collect.adminOps' });
    expect(read.examineCoverage[0].kindsPresent).not.toContain('configuration');
    expect(read.examineCoverage[0].items.find(i => i.text === settings)!.status).toBe('not covered');
    // A confirmed apply: filed as admin-ops change; it covers the configuration item.
    const change = build([d('r-apply', 'test')], [rec('r-apply', 'adminops_evidence/apply_confirmed')]);
    expect(change.entries[0]).toMatchObject({ evidenceKind: 'admin-ops change', method: 'test' });
    expect(change.examineCoverage[0].items.find(i => i.text === settings)!.status).toBe('covered');
    // An unresolved C10 detail falls back to its method (test only for a confirmed apply).
    const unresolved = build([d('gone-1', 'test'), d('gone-2', 'examine')], []);
    expect(unresolved.entries.map(e => [e.evidenceKind, e.unresolved])).toEqual([['admin-ops change', true], ['admin-ops read', true]]);
  });
});

describe('run 25 replay: the evidence index of bundle item 12', () => {
  const ix = buildEvidenceIndex({
    controls: fx.controls, records: fx.records, tenantId: fx.tenantId, tenantSlug: 'muster-partial', sspId: fx.sspId, generatedAt: '2026-10-28T03:00:00.000Z',
  });

  it('one entry per SSP evidence detail, every entry labelled, every store ref resolved to its record', () => {
    expect(ix.summary.entries).toBe(366 + 135);
    expect(ix.summary.byMethod).toEqual({ examine: 469, test: 30, interview: 2 });
    expect(ix.summary.controlsWithEvidence).toBe(90);
    expect(ix.summary.unresolvedStoreRefs).toBe(0);
    for (const e of ix.entries) expect(['examine', 'test', 'interview']).toContain(e.method);
    for (const e of ix.entries.filter(x => x.kind === 'evidence-store')) {
      expect(e.collectorIdentity).toBe('ces-eo/2.2.3@sim-app-muster-partial');
      expect(e.window?.end).toBeTruthy();
    }
  });

  it('examine coverage for all 110 controls: 865 items, 262 covered today', () => {
    expect(ix.examineCoverage).toHaveLength(110);
    expect(ix.summary.examineItems).toBe(865);
    expect(ix.summary.examineCovered).toBe(262);
    const ac = ix.examineCoverage.find(c => c.controlId === 'AC.L1-3.1.1')!;
    expect(ac.kindsPresent).toEqual(['configuration', 'poam', 'ssp', 'stamper-file']);
    expect(ac.covered).toBe(2);
  });

  it('sampling windows for twelve families; the source hash; no absolute path or personal identifier anywhere', () => {
    expect(ix.samplingWindows.map(w => w.family)).toEqual(['AC', 'AT', 'AU', 'CM', 'IA', 'IR', 'MA', 'MP', 'PS', 'RA', 'SC', 'SI']);
    expect(ix.examineSource.sha256).toBe('c254a6bf7f9db189b45817c23065c80058225fbb566ab2daaad3de63a3c5a4fc');
    const text = JSON.stringify(ix);
    expect(text).not.toMatch(ABSOLUTE_PATH);
    expect(text).not.toMatch(EMAIL);
    for (const e of ix.entries.filter(x => x.kind === 'stamper')) expect(e.path).not.toMatch(/^[\\/]|^[A-Za-z]:/);
  });
});
