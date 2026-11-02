// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assessRowClasses,
  buildControlsFromGridTracker,
  buildReviewerExport,
  editorCountLabel,
  editorStatusCounts,
  emptyTracker,
  familyRowsFromStatus,
  filterEditorControls,
  gridFromStatus,
  mergeControlData,
  missingTenantFields,
  trackAssessEntry,
  useAssessStore,
} from './assess';
import type { CmmcStatus } from './assess';
import { useTenantStore } from './tenant';
import { useWorkflowStore } from './workflow';
import { useTranslateStore } from './translate';
import { changeTenant } from '../screens/tenant/flow';
import { CMMC_REFERENCE, CMMC_STATUS, TENANT_CONFIG, flush, installHarness, on, resetStores, statusBar } from '../screens/tenant/testUtils';
import type { Harness } from '../screens/tenant/testUtils';

let h: Harness;
beforeEach(() => resetStores());
afterEach(() => h?.restore());

describe('grid (handleCmmcStatus)', () => {
  it('buckets controls as legacy does in directive mode', () => {
    const g = gridFromStatus(CMMC_STATUS as CmmcStatus);
    expect(g.hasDirectives).toBe(true);
    // satisfied: automated + inherit-fedramp (as automated); excluded/nonstack satisfied go to provisional
    expect(g.cells.satisfied.automated).toEqual({ count: 2, pct: '2%' });
    expect(g.cells.provisional.excluded.count).toBe(1);
    expect(g.cells.provisional.nonstack.count).toBe(1);
    // won't + will + not-verified are "not satisfied"; document-absence normalises to excluded
    expect(g.cells.not_satisfied.automated.count).toBe(2);
    expect(g.cells.not_satisfied.excluded.count).toBe(1);
    expect(g.cells.not_satisfied.total).toEqual({ count: 3, pct: '3%' });
    expect(g.summary).toEqual({ automated: 4, excluded: 2, nonstack: 1, total: 7 });
    expect(g.sprs).toEqual({ satisfied: 0, provisional: 0, not_satisfied: 9 });
  });

  it('plan-less mode has the same counts, no summary row, and the client-side SPRS fallback', () => {
    const d = { ...CMMC_STATUS, hasDirectives: false, sprsByCategory: undefined } as CmmcStatus;
    const g = gridFromStatus(d);
    expect(g.summary).toBeNull();
    expect(g.cells.satisfied.total.count).toBe(2);
    expect(g.sprs.not_satisfied).toBe(9);
  });

  it('family rows are sorted with OK = satisfied + excluded', () => {
    const rows = familyRowsFromStatus(CMMC_STATUS as CmmcStatus);
    expect(rows.map((r) => r.family)).toEqual(['AC', 'AU']);
    expect(rows[0]).toMatchObject({ total: 22, ok: 2, prov: 0, gap: 0, greenPct: 9 });
  });
});

describe('editor model', () => {
  const merged = () => mergeControlData(CMMC_REFERENCE.controls, CMMC_STATUS as CmmcStatus, null, null);

  it('merges reference, assess and plan data into status and category', () => {
    const byId = Object.fromEntries(merged().map((c) => [c.control_id, c]));
    expect(byId['AC.L2-3.1.1']).toMatchObject({ status: 'MET', gridCategory: 'satisfied', automationType: 'automated' });
    expect(byId['CM.L2-3.4.1']).toMatchObject({ status: 'PARTIAL', gridCategory: 'provisional' });
    expect(byId['IA.L2-3.5.3']).toMatchObject({ status: 'PARTIAL', gridCategory: 'unsat' });
    expect(byId['SI.L2-3.14.1']).toMatchObject({ status: 'NOT_VERIFIED', gridCategory: 'unsat' });
    expect(editorStatusCounts(merged())).toEqual({ MET: 3, PARTIAL: 3, NOT_MET: 0, NOT_APPLICABLE: 0, UNKNOWN: 0 });
  });

  it('derives implementation type from the mission plan gap classifications', () => {
    const mp = { steps: [{ step_name: 'Enforce MFA', gap_classifications: ['configure'], control_coverage: [{ control_id: 'IA.L2-3.5.3', support_type: 'primary' }] }] };
    const c = mergeControlData(CMMC_REFERENCE.controls, null, mp, null).find((x) => x.control_id === 'IA.L2-3.5.3')!;
    expect(c.implType).toBe('Automated');
    expect(c.status).toBe('UNKNOWN');
  });

  it('filters by tile, family, status, type and search, and labels the count', () => {
    const all = merged();
    const tile = filterEditorControls(all, { params: { autoType: 'automated', satType: 'unsat' }, family: '', status: '', impl: '', search: '' });
    expect(tile.map((c) => c.control_id)).toEqual(['IA.L2-3.5.3', 'SI.L2-3.14.1']);
    expect(editorCountLabel(tile.length, all.length, { autoType: 'automated', satType: 'unsat' })).toBe('2 of 7 controls (Automated, Not Satisfied / Not Verified)');
    expect(filterEditorControls(all, { params: null, family: 'AC', status: 'MET', impl: '', search: '' })).toHaveLength(2);
    expect(filterEditorControls(all, { params: null, family: '', status: '', impl: '', search: 'multifactor' })).toHaveLength(1);
    expect(editorCountLabel(7, 7, null)).toBe('7 of 7 controls');
  });

  it('grid-tracker controls classify from the assess rows', () => {
    let t = emptyTracker(2);
    t = trackAssessEntry(t, { entryId: 'ac-001', found: true, cmmc_controls: ['AC.L2-3.1.1'], registry: { set_command_template: 'Set-X' } });
    t = trackAssessEntry(t, { entryId: 'ia-001', found: false, cmmc_controls: ['IA.L2-3.5.3'], engine: 'manual_gate' });
    const controls = buildControlsFromGridTracker(t, CMMC_REFERENCE.controls);
    expect(controls.map((c) => [c.control_id, c.status, c.gridCategory, c.automationType])).toEqual([
      ['AC.L2-3.1.1', 'MET', 'satisfied', 'automated'],
      ['IA.L2-3.5.3', 'NOT_MET', 'unsat', 'nonstack'],
    ]);
    expect(controls[0]!.entryDetails[0]).toMatchObject({ entryId: 'ac-001', status: 'sat' });
  });

  it('builds the reviewer export with the legacy keys', () => {
    const exp = buildReviewerExport(merged(), '2026-10-29T00:00:00.000Z');
    expect(exp.total_controls).toBe(7);
    expect(Object.keys(exp.controls[0]!)).toEqual([
      'control_id', 'family', 'practice', 'status', 'category', 'implType', 'automationType',
      'registryEntryCount', 'discoveredCount', 'reason', 'entryDetails', 'hasMP', 'hasTM', 'scopeExclusion',
    ]);
  });

  it('row classes and the missing-config banner follow legacy', () => {
    expect(assessRowClasses({ found: true, status: 'exists' })).toEqual({ icon: '✓', iconCls: 'sat', rowCls: 'exists', verdictCls: 'sat' });
    expect(assessRowClasses({ found: false, status: 'error' }).rowCls).toBe('error');
    expect(assessRowClasses({ found: false, status: 'no_query' }).verdictCls).toBe('skip-verdict');
    expect(assessRowClasses({ found: false }).rowCls).toBe('missing');
    expect(missingTenantFields('dev', {})).toBeNull();
    expect(missingTenantFields('ridgeline', { tenant: { tenant_id: 'x' }, auth: { app_id: ' ' } })).toEqual(['auth.app_id', 'auth.cert_thumbprint', 'auth.cert_path']);
  });
});

const base = [
  on('GET', '/api/tenants/ridgeline', { ok: true, config: TENANT_CONFIG }),
  on('GET', '/api/last-translate', { ok: false }),
  on('POST', '/api/save-run-log', { ok: true, path: 'C:\\runs\\assess.json' }),
];

describe('assess run (PC-05)', () => {
  it('streams /api/assess with the legacy query keys and finishes Assessed', async () => {
    h = installHarness(base);
    await changeTenant('ridgeline');
    useTranslateStore.getState().setOutputPath('C:\\plans\\ep.json');
    useAssessStore.getState().doAssess();
    const s = h.streams[0]!;
    expect(s.url).toBe('/api/assess?tenant=ridgeline&verbose=false&uploadToBlob=true&planFile=C%3A%5Cplans%5Cep.json');
    expect(useAssessStore.getState().badge).toEqual({ text: 'Assessing...', className: 'status-running' });
    expect(useWorkflowStore.getState().steps.assess).toBe('running');
    s.emit({ type: 'connection_log', phase: 'connected', tenant: 'ridgeline', message: 'Connected' });
    s.emit({ type: 'assess_start', totalEntries: 2, evidencePath: 'C:\\evidence' });
    s.emit({ type: 'assess_check', entryId: 'ac-001', label: 'Conditional access', found: true, status: 'exists', cmmc_controls: ['AC.L2-3.1.1'], entryIndex: 1 });
    s.emit({ type: 'assess_check', entryId: 'ia-001', label: 'MFA', found: false, cmmc_controls: ['IA.L2-3.5.3'], entryIndex: 2 });
    s.emit({ type: 'cmmc_status', ...CMMC_STATUS });
    s.emit({ type: 'assess_done' });
    await flush();
    const st = useAssessStore.getState();
    expect(st.counter).toBe('2');
    expect(st.entries).toHaveLength(2);
    expect(st.badge).toEqual({ text: 'Assessed', className: 'status-done' });
    expect(st.grid?.cells.satisfied.automated.count).toBe(2);
    expect(useTenantStore.getState().connection).toBe('connected');
    expect(useWorkflowStore.getState().steps.assess).toBe('done');
    expect(useWorkflowStore.getState().steps.translate).toBe('ready');
    expect(useTenantStore.getState().toast?.stats).toBe('4 completed / 3 not satisfied');
    expect(h.lines()).toContain('POST /api/save-run-log');
    expect(s.closed).toBe(true);
  });

  it('dev cannot assess; halt marks the card Error', async () => {
    h = installHarness(base);
    useAssessStore.getState().doAssess();
    expect(statusBar()?.message).toBe('Select a tenant before assessing readiness.');
    await changeTenant('ridgeline');
    useAssessStore.getState().doAssess();
    useAssessStore.getState().haltAssess();
    expect(h.streams[0]!.closed).toBe(true);
    expect(useAssessStore.getState().badge.text).toBe('Error');
    expect(useWorkflowStore.getState().steps.assess).toBe('failed');
  });

  it('restores cached assess state, unlocking Translate; a later execution marks it stale', async () => {
    h = installHarness([...base, on('GET', '/api/assess-state', { accomplishedIds: ['ac-001'], cmmcStatus: CMMC_STATUS, timestamp: '2026-10-28T00:00:00.000Z' })]);
    await changeTenant('ridgeline');
    expect(useAssessStore.getState().badge.text).toBe('Assessed');
    expect(useAssessStore.getState().grid?.summary?.total).toBe(7);
    expect(useWorkflowStore.getState().steps.translate).toBe('ready');
    window.localStorage.setItem('executedAt_ridgeline', '2026-10-29T00:00:00.000Z');
    await changeTenant('ridgeline');
    expect(useAssessStore.getState().badge.text).toBe('Stale');
    expect(useAssessStore.getState().stale).toBe(true);
    expect(useWorkflowStore.getState().steps.assess).toBe('ready');
  });

  it('compute gaps renders the plan or the server error', async () => {
    const plan = {
      summary: { total_gap_entries: 1, total_controls_with_gaps: 1, manual_only_count: 0, automated_count: 1, by_priority: { critical: 1, high: 0, medium: 0, low: 0 } },
      gap_controls: [{ control_id: 'IA.L2-3.5.3', practice: 'MFA', priority: 'critical', gap_entries: [{ entry_id: 'ia-001', label: 'MFA', status: 'missing' }] }],
    };
    h = installHarness([...base, on('GET', '/api/compute-gaps', { success: true, plan })]);
    await changeTenant('ridgeline');
    await useAssessStore.getState().computeGaps();
    expect(useAssessStore.getState().gapPlan).toEqual(plan);
    expect(statusBar()?.message).toBe('Gap-remediation plan computed: 1 gap entries across 1 controls.');
    h.restore();
    h = installHarness([on('GET', '/api/compute-gaps', { success: false, error: 'No cached assess state' }, 404)]);
    await useAssessStore.getState().computeGaps();
    expect(statusBar()).toEqual({ message: 'No cached assess state', type: 'error' });
  });
});

describe('CMMC editor requests', () => {
  it('family drill-down loads the reference once, then plan-data paths and both plan files', async () => {
    h = installHarness([
      ...base,
      on('GET', '/api/cmmc-controls', CMMC_REFERENCE),
      on('GET', '/api/plan-data-paths', { ok: true, missionPlan: 'C:\\plans\\mp.json', manifest: 'C:\\plans\\tm.json' }),
      on('GET', '/api/read-plan-file', { steps: [] }),
    ]);
    await changeTenant('ridgeline');
    useAssessStore.getState().applyCmmcStatus(CMMC_STATUS as CmmcStatus);
    h.calls.length = 0;
    await useAssessStore.getState().openEditor(false, { familyFilter: 'AC', satType: 'satisfied' });
    expect(h.calls.map((c) => c.url)).toEqual([
      '/api/cmmc-controls',
      '/api/plan-data-paths?tenant=ridgeline',
      '/api/read-plan-file?path=C%3A%5Cplans%5Cmp.json',
      '/api/read-plan-file?path=C%3A%5Cplans%5Ctm.json',
    ]);
    const ed = useAssessStore.getState().editor;
    expect(ed.open).toBe(true);
    expect(ed.family).toBe('AC');
    expect(ed.controls).toHaveLength(7);
    h.calls.length = 0;
    useAssessStore.getState().closeEditor();
    await useAssessStore.getState().openEditor(false, null);
    expect(h.calls.map((c) => c.url.split('?')[0])).toEqual(['/api/plan-data-paths', '/api/read-plan-file', '/api/read-plan-file']);
  });

  it('a tile after an assess uses the tracked rows (no plan-file requests) and shows the banner', async () => {
    h = installHarness([...base, on('GET', '/api/cmmc-controls', CMMC_REFERENCE)]);
    await changeTenant('ridgeline');
    useAssessStore.setState({ tracker: trackAssessEntry(emptyTracker(1), { entryId: 'ac-001', found: true, cmmc_controls: ['AC.L2-3.1.1'] }) });
    h.calls.length = 0;
    await useAssessStore.getState().showGridControls('total', 'satisfied');
    expect(h.calls.map((c) => c.url)).toEqual(['/api/cmmc-controls']);
    const ed = useAssessStore.getState().editor;
    expect(ed.executionBanner).toBe(true);
    expect(ed.params).toEqual({ autoType: null, satType: 'satisfied', useExecutionData: true });
  });

  it('evidence for an uncached entry comes from /api/evidence-content', async () => {
    h = installHarness([
      on('GET', '/api/evidence-content', { content: '{}', file: 'C:\\evidence\\ac-001.json', structured: { registryEntry: { entry_id: 'ac-001', label: 'Conditional access' }, complianceVerdict: 'SAT' } }),
    ]);
    await useAssessStore.getState().showEvidenceForEntry('ac-001', 'Conditional access', 'mgraph');
    expect(h.calls[0]!.url).toBe('/api/evidence-content?tenant=dev&entryId=ac-001');
    const ev = useAssessStore.getState().evidence;
    expect(ev.open).toBe(true);
    expect(ev.record?.complianceVerdict).toBe('SAT');
    expect(ev.record?.registryEntry?.entry_id).toBe('ac-001');
  });
});
