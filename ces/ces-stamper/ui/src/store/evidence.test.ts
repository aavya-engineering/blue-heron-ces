// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cardStatusText,
  controlBadge,
  familyBadge,
  fileMeta,
  formatAge,
  formatFileSize,
  parseEvidenceReply,
  readExpandedFamilies,
  sortControls,
  summaryView,
  useEvidenceStore,
  verdictBadge,
  visibleFamilies,
  writeExpandedFamilies,
} from './evidence';
import type { EvidenceScanFamily, EvidenceScanResult } from './evidence';
import { useWorkflowStore } from './workflow';
import { resetPopoutState } from './popout';
import { FIXTURE_EVIDENCE, FIXTURE_SCAN, FIXTURE_TENANT, mockApi } from './spa3-mock-api';
import type { MockApi } from './spa3-mock-api';

const SCAN = FIXTURE_SCAN as EvidenceScanResult;
let api: MockApi | null = null;

beforeEach(() => {
  useEvidenceStore.getState().reset();
  useWorkflowStore.getState().reset();
  resetPopoutState();
  window.sessionStorage.clear();
});

afterEach(() => {
  api?.restore();
  api = null;
  vi.restoreAllMocks();
});

describe('evidence rules (legacy card 5 functions)', () => {
  it('formats sizes and ages as legacy', () => {
    expect([formatFileSize(512), formatFileSize(2048), formatFileSize(3 * 1024 * 1024)]).toEqual(['512B', '2KB', '3.0MB']);
    expect([formatAge(0.5), formatAge(2.4), formatAge(49)]).toEqual(['30m ago', '2h ago', '2d ago']);
    const [ac] = SCAN.families;
    expect(fileMeta(ac!.controls[1]!.entries[0]!)).toBe('2KB · 2h ago');
    expect(fileMeta(ac!.controls[0]!.entries[0]!)).toBe('Not found');
  });

  it('colours family, control and stat badges as legacy', () => {
    const fam = (controlCount: number, controlsWithEvidence: number) =>
      ({ abbreviation: 'X', name: 'X', controlCount, controlsWithEvidence, controls: [] }) as EvidenceScanFamily;
    expect(familyBadge(fam(2, 2))).toEqual({ tone: 'green', text: '2/2' });
    expect(familyBadge(fam(2, 1))).toEqual({ tone: 'amber', text: '1/2' });
    expect(familyBadge(fam(2, 0))).toEqual({ tone: 'red', text: '0/2' });
    expect(familyBadge(fam(0, 0))).toEqual({ tone: 'grey', text: '0/0' });
    expect(controlBadge(SCAN.families[0]!.controls[1]!)).toEqual({ tone: 'green', text: '1 file' });
    expect(controlBadge(SCAN.families[0]!.controls[0]!)).toEqual({ tone: 'grey', text: '0 files' });
    expect(summaryView(SCAN.summary)).toEqual({
      controls: 3,
      withEvidence: { value: 1, tone: 'green' },
      missing: { value: 2, tone: 'red' },
      coverage: { text: '33%', tone: 'amber' },
    });
    const full = summaryView({ ...SCAN.summary, controlsWithEvidence: 3, coveragePct: 100 });
    expect([full.missing.tone, full.coverage.tone]).toEqual(['green', 'green']);
    const none = summaryView({ ...SCAN.summary, controlsWithEvidence: 0, coveragePct: 0 });
    expect([none.withEvidence.tone, none.coverage.tone]).toEqual([null, 'red']);
  });

  it('sorts controls, filters by control id and hides families with no match', () => {
    expect(sortControls(SCAN.families[0]!.controls).map((c) => c.controlId)).toEqual(['AC.L2-3.1.1', 'AC.L2-3.1.5']);
    expect(visibleFamilies(SCAN.families, '').map((f) => f.abbreviation)).toEqual(['AC', 'AU']);
    expect(visibleFamilies(SCAN.families, ' au.l2 ').map((f) => f.abbreviation)).toEqual(['AU']);
    expect(visibleFamilies(SCAN.families, 'least')).toEqual([]);
  });

  it('maps verdicts and parses evidence-content replies as legacy', () => {
    expect(verdictBadge('SAT')).toEqual({ tone: 'sat', text: 'SAT' });
    expect(verdictBadge('NOT_SAT')).toEqual({ tone: 'not-sat', text: 'NOT SAT' });
    expect(verdictBadge(undefined)).toEqual({ tone: 'none', text: 'NO VERDICT' });
    expect(parseEvidenceReply({ structured: { outcome: 'success' }, isJson: true, content: 'x' })).toEqual({ outcome: 'success' });
    expect(parseEvidenceReply({ isJson: true, content: '{"outcome":"failed"}' })).toEqual({ outcome: 'failed' });
    expect(parseEvidenceReply({ isJson: true, content: 'not json' })).toEqual({ rawResponse: 'not json' });
    expect(parseEvidenceReply({ isJson: false, content: 'plain' })).toEqual({ rawResponse: 'plain' });
  });

  it('keeps expanded families under the legacy sessionStorage key', () => {
    expect(readExpandedFamilies()).toEqual([]);
    writeExpandedFamilies(['AC']);
    expect(window.sessionStorage.getItem('evidenceExpandedFamilies')).toBe('["AC"]');
    expect(readExpandedFamilies()).toEqual(['AC']);
  });
});

describe('evidence store', () => {
  it('does nothing without a tenant', async () => {
    api = mockApi({});
    await useEvidenceStore.getState().scanEvidence();
    expect(api.calls).toEqual([]);
    expect(cardStatusText(useEvidenceStore.getState())).toBe('Locked');
  });

  it('scans: GET /api/evidence-scan?tenant, rail running then done, status shows coverage', async () => {
    api = mockApi({ 'GET /api/evidence-scan': { body: FIXTURE_SCAN } });
    useEvidenceStore.getState().setTenant(FIXTURE_TENANT);
    expect(cardStatusText(useEvidenceStore.getState())).toBe('Ready');
    const pending = useEvidenceStore.getState().scanEvidence();
    expect(useWorkflowStore.getState().steps.evidence).toBe('running');
    expect(cardStatusText(useEvidenceStore.getState())).toBe('Scanning...');
    await pending;
    expect(api.calls).toEqual([{ method: 'GET', path: '/api/evidence-scan', query: { tenant: FIXTURE_TENANT }, body: undefined }]);
    expect(useWorkflowStore.getState().steps.evidence).toBe('done');
    expect(cardStatusText(useEvidenceStore.getState())).toBe('33% Coverage');
  });

  it('a failed scan marks the rail failed and shows the legacy status text', async () => {
    api = mockApi({ 'GET /api/evidence-scan': { status: 500, body: { error: 'Registry not loaded' } } });
    useEvidenceStore.getState().setTenant('dev');
    await useEvidenceStore.getState().scanEvidence();
    const s = useEvidenceStore.getState();
    expect(s.status).toBe('failed');
    expect(s.message?.text).toBe('Evidence scan failed: Registry not loaded');
    expect(useWorkflowStore.getState().steps.evidence).toBe('failed');
    expect(cardStatusText(s)).toBe('Error');
  });

  it('opens the overlay from GET /api/evidence-content and records the verdict', async () => {
    api = mockApi({
      'GET /api/evidence-content': { body: { entryId: 'ac-ca-baseline', isJson: true, content: '{}', structured: FIXTURE_EVIDENCE } },
    });
    useEvidenceStore.getState().setTenant(FIXTURE_TENANT);
    await useEvidenceStore.getState().openOverlay('ac-ca-baseline');
    expect(api.calls[0]).toMatchObject({ path: '/api/evidence-content', query: { tenant: FIXTURE_TENANT, entryId: 'ac-ca-baseline' } });
    const s = useEvidenceStore.getState();
    expect(s.overlay).toMatchObject({ open: true, entryId: 'ac-ca-baseline' });
    expect(s.verdicts['ac-ca-baseline']).toBe('SAT');
    s.closeOverlay();
    expect(useEvidenceStore.getState().overlay.open).toBe(false);
  });

  it('shows the legacy error when evidence cannot be loaded', async () => {
    api = mockApi({ 'GET /api/evidence-content': { status: 404, body: { error: 'Evidence file not found: x.txt' } } });
    useEvidenceStore.getState().setTenant(FIXTURE_TENANT);
    await useEvidenceStore.getState().openOverlay('x');
    expect(useEvidenceStore.getState().message?.text).toBe('Error loading evidence: Evidence file not found: x.txt');
    expect(useEvidenceStore.getState().overlay.open).toBe(false);
  });

  it('pop-out: fetches the evidence, opens the named window, reports a blocked pop-up', async () => {
    api = mockApi({ 'GET /api/evidence-content': { body: { isJson: false, content: 'raw text' } } });
    useEvidenceStore.getState().setTenant(FIXTURE_TENANT);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await useEvidenceStore.getState().openPopout('ac-ca-baseline');
    expect(open).toHaveBeenCalledWith('/app/popout', 'stamper-evidence-popout', 'width=900,height=700');
    expect(useEvidenceStore.getState().message?.text).toBe('Popup blocked. Please allow popups for this site.');
  });

  it('a tenant change clears the card', async () => {
    api = mockApi({ 'GET /api/evidence-scan': { body: FIXTURE_SCAN } });
    useEvidenceStore.getState().setTenant(FIXTURE_TENANT);
    await useEvidenceStore.getState().scanEvidence();
    useEvidenceStore.getState().setTenant('dev');
    const s = useEvidenceStore.getState();
    expect([s.tenant, s.status, s.scan]).toEqual(['dev', 'idle', null]);
  });
});
