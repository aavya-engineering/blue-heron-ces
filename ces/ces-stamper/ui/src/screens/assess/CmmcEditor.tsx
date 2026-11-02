// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// CMMC L2 status editor overlay (legacy #cmmcEditorOverlay L12614; renderEditorDashboard L12187,
// renderEditorNav L12224, applyEditorFilters L12261, renderControlCard L12352, exportReviewerData
// L12544). Ids follow the legacy page.

import { useEffect, useState } from 'react';
import { escId } from 'ces-ui-kit';
import {
  buildReviewerExport,
  editorCountLabel,
  editorFamilies,
  editorStatusCounts,
  filterEditorControls,
  reviewerExportFilename,
  useAssessStore,
} from '../../store/assess';
import type { EditorControl, EntryDetail } from '../../store/assess';

const FAMILY_NAMES: Readonly<Record<string, string>> = {
  AC: 'Access Control',
  AT: 'Awareness and Training',
  AU: 'Audit and Accountability',
  CM: 'Configuration Management',
  IA: 'Identification and Authentication',
  IR: 'Incident Response',
  MA: 'Maintenance',
  MP: 'Media Protection',
  PE: 'Physical Protection',
  PS: 'Personnel Security',
  RA: 'Risk Assessment',
  CA: 'Security Assessment',
  SC: 'Systems and Communications Protection',
  SI: 'System and Information Integrity',
};

const ST_CLASS: Record<string, string> = { MET: 'st-met', PARTIAL: 'st-partial', NOT_MET: 'st-not-met', NOT_APPLICABLE: 'st-na', UNKNOWN: 'st-unknown' };
const ST_LABEL: Record<string, string> = { MET: 'Met', PARTIAL: 'Partial', NOT_MET: 'Not Met', NOT_APPLICABLE: 'N/A', UNKNOWN: 'Unknown' };
const IMPL_CLASS: Record<string, string> = {
  Automated: 'impl-automated',
  'Manual Process': 'impl-manual',
  'Manual Alternative': 'impl-manual-alt',
  'Not Available': 'impl-not-available',
  'Scoped Out': 'impl-scoped-out',
};
const AUTO_BADGE: Record<string, string> = {
  automated: 'Auto',
  excluded: 'Excluded',
  nonstack: 'NonStack',
  'document-absence': 'Absent',
  'document-prohibition': 'Prohibited',
  'inherit-fedramp': 'Inherited',
};
const ENTRY_ICON: Record<string, string> = { exists: '✔', missing: '○', error: '✖', no_query: '–', not_checked: '–' };

/** Legacy escHtml(String(x)): an absent id or label prints as "undefined" (grid-tracker rows). */
const text = (v: unknown) => String(v);

function EntryRow({ ed }: { ed: EntryDetail }) {
  const showEvidenceForEntry = useAssessStore((s) => s.showEvidenceForEntry);
  return (
    <button
      type="button"
      className="cmmc-ed-entry"
      data-entry-id={text(ed.entry_id)}
      data-entry-label={text(ed.label)}
      data-entry-engine={text(ed.engine)}
      onClick={() => {
        useAssessStore.setState((s) => ({ evidence: { ...s.evidence, nav: [], index: 0 } }));
        void showEvidenceForEntry(text(ed.entry_id), text(ed.label), text(ed.engine));
      }}
    >
      <span className={`cmmc-ed-entry-status ed-status-${ed.status}`} aria-hidden="true">
        {ENTRY_ICON[String(ed.status)] || '–'}
      </span>
      <span className="cmmc-ed-entry-id">{text(ed.entry_id)}</span>
      <span className="cmmc-ed-entry-label">{text(ed.label)}</span>
      <span className="cmmc-ed-entry-engine">{text(ed.engine)}</span>
    </button>
  );
}

function ControlCard({ c, expanded, onToggle }: { c: EditorControl; expanded: boolean; onToggle: () => void }) {
  const statusBadge =
    c.gridCategory === 'excluded' ? (
      <span className="cmmc-status-badge st-excluded">Excluded</span>
    ) : (
      <span className={`cmmc-status-badge ${ST_CLASS[c.status] || 'st-unknown'}`}>{ST_LABEL[c.status] || c.status}</span>
    );
  const bodyId = `ctrl-${escId(c.control_id)}-body`;
  return (
    <div className={`cmmc-ctrl-card${expanded ? ' expanded' : ''}`} id={`ctrl-${escId(c.control_id)}`}>
      <button type="button" className="cmmc-ctrl-header" aria-expanded={expanded} aria-controls={bodyId} onClick={onToggle}>
        <span className="cmmc-ctrl-id">{c.control_id}</span>
        <span className="cmmc-ctrl-practice">{c.practice}</span>
        {c.gridCategory === 'excluded' && c.reason ? <span className="exclusion-reason">{c.reason}</span> : null}
        {statusBadge}
        {c.implType ? <span className={`cmmc-impl-badge ${IMPL_CLASS[c.implType] || ''}`}>{c.implType}</span> : null}
        {c.automationType ? <span className="cmmc-impl-badge">{AUTO_BADGE[c.automationType] || c.automationType}</span> : null}
      </button>
      <div className="cmmc-ctrl-body" id={bodyId} hidden={!expanded}>
        {c.entryDetails && c.entryDetails.length > 0 ? (
          <div className="cmmc-detail-section">
            <div className="cmmc-detail-label">Registry Entries ({c.entryDetails.length})</div>
            {c.entryDetails.map((ed, i) => (
              <EntryRow key={i} ed={ed} />
            ))}
          </div>
        ) : c.registryEntryCount === 0 ? (
          <div className="cmmc-detail-section">
            <div className="cmmc-detail-label">Registry Entries</div>
            <div className="cmmc-detail-muted">No registry entries — this control is nonstack/manual-only</div>
          </div>
        ) : null}
        {c.reason ? (
          <div className="cmmc-detail-section">
            <div className="cmmc-detail-label">Assessment Reason</div>
            <div>{c.reason}</div>
          </div>
        ) : null}
        <div className="cmmc-detail-section">
          <div className="cmmc-detail-label">Mission Plan</div>
          {c.mpSteps && c.mpSteps.length > 0 ? (
            c.mpSteps.map((ms, i) => {
              const meta = [ms.task_type && `task: ${ms.task_type}`, ms.priority && `priority: ${ms.priority}`, ms.support_type && `support: ${ms.support_type}`]
                .filter(Boolean)
                .join(' | ');
              return (
                <div key={i}>
                  {ms.step_name ? <div>{ms.step_name}</div> : null}
                  {ms.gap_classifications.map((g) => (
                    <span key={g} className={`cmmc-chip chip-${escId(g)}`}>
                      {g}
                    </span>
                  ))}
                  {meta ? <div className="cmmc-detail-muted">{meta}</div> : null}
                </div>
              );
            })
          ) : (
            <div className="cmmc-detail-muted">Not available — no MP loaded</div>
          )}
        </div>
        <div className="cmmc-detail-section">
          <div className="cmmc-detail-label">Tenant Manifest</div>
          {c.tmControl ? (
            <>
              {(c.tmControl['verification'] || []).map((ver: any, i: number) => (
                <div key={i}>
                  Method: <span className="cmmc-chip">{ver.method || ver}</span>
                </div>
              ))}
              {(c.tmIntents || []).map((intent, i) => (
                <div key={i}>
                  {intent['intent_id'] ? <strong>{intent['intent_id']} </strong> : null}
                  {intent['source_of_truth'] ? <span className="cmmc-chip">{intent['source_of_truth']}</span> : null}
                </div>
              ))}
            </>
          ) : (
            <div className="cmmc-detail-muted">Not available — no TM loaded</div>
          )}
        </div>
        {c.scopeExclusion ? (
          <div className="cmmc-detail-section">
            <div className="cmmc-detail-label">Scope Exclusion</div>
            <div className="cmmc-scope-row">
              {c.scopeExclusion['si_field'] ? (
                <div>
                  <strong>{c.scopeExclusion['si_field']}</strong>: {c.scopeExclusion['si_value'] || ''}
                </div>
              ) : null}
              {c.scopeExclusion['justification'] ? <span className="scope-just">{c.scopeExclusion['justification']}</span> : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function download(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function CmmcEditor() {
  const editor = useAssessStore((s) => s.editor);
  const cmmc = useAssessStore((s) => s.cmmc);
  const evidenceOpen = useAssessStore((s) => s.evidence.open);
  const closeEditor = useAssessStore((s) => s.closeEditor);
  const setFamily = useAssessStore((s) => s.setEditorFamily);
  const setFilter = useAssessStore((s) => s.setEditorFilter);
  const openControlEvidence = useAssessStore((s) => s.openControlEvidence);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!editor.open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !useAssessStore.getState().evidence.open) closeEditor();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [editor.open, closeEditor, evidenceOpen]);

  if (!editor.open) return null;
  const controls = editor.controls || [];
  const filtered = filterEditorControls(controls, {
    params: editor.params,
    family: editor.family,
    status: editor.status,
    impl: editor.impl,
    search: editor.search,
  });
  const counts = editorStatusCounts(controls);

  let siKeys: string[] = [];
  if (cmmc && ((cmmc.excludedControls && cmmc.excludedControls.length > 0) || (cmmc.outOfScopeControls && cmmc.outOfScopeControls.length > 0))) {
    const reasons = new Set<string>();
    for (const c of controls) if (c.scopeExclusion && c.scopeExclusion['si_field']) reasons.add(`${c.scopeExclusion['si_field']}: ${c.scopeExclusion['si_value'] || ''}`);
    siKeys = Array.from(reasons);
  }

  const groups: Array<{ family: string; items: EditorControl[] }> = [];
  for (const c of filtered) {
    const last = groups[groups.length - 1];
    if (last && last.family === c.family) last.items.push(c);
    else groups.push({ family: c.family, items: [c] });
  }

  const toggle = (c: EditorControl) => {
    if (openControlEvidence(c)) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(c.control_id)) next.delete(c.control_id);
      else next.add(c.control_id);
      return next;
    });
  };

  return (
    <div
      className="cmmc-editor-overlay visible"
      id="cmmcEditorOverlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeEditor();
      }}
    >
      <div className="cmmc-editor" role="dialog" aria-modal="true" aria-labelledby="cmmcEditorTitle">
        <div className="cmmc-editor-header">
          <h2 className="cmmc-editor-title" id="cmmcEditorTitle">
            CMMC L2 Status Editor — All 110 Controls
          </h2>
          <div className="cmmc-editor-actions">
            <button
              type="button"
              className="btn btn-secondary btn-small"
              title="Export as JSON"
              onClick={() => download(JSON.stringify(buildReviewerExport(controls), null, 2), reviewerExportFilename())}
            >
              Export
            </button>
            <button type="button" className="cmmc-editor-close" title="Close" aria-label="Close CMMC editor" onClick={closeEditor}>
              ×
            </button>
          </div>
        </div>
        {editor.executionBanner ? <div id="cmmcEditorBanner">Showing execution results</div> : null}
        <div className="cmmc-editor-dashboard" id="cmmcEditorDashboard">
          <div className="cmmc-dash-tile">
            <div className="dash-val">{controls.length}</div>
            <div className="dash-label">Controls</div>
          </div>
          <div className="cmmc-dash-tile tile-met">
            <div className="dash-val">{counts.MET}</div>
            <div className="dash-label">Met</div>
          </div>
          <div className="cmmc-dash-tile tile-partial">
            <div className="dash-val">{counts.PARTIAL}</div>
            <div className="dash-label">Partial</div>
          </div>
          <div className="cmmc-dash-tile tile-notmet">
            <div className="dash-val">{counts.NOT_MET}</div>
            <div className="dash-label">Not Met</div>
          </div>
          <div className="cmmc-dash-tile tile-na">
            <div className="dash-val">{counts.NOT_APPLICABLE}</div>
            <div className="dash-label">N/A</div>
          </div>
          <div className="cmmc-dash-tile tile-unknown">
            <div className="dash-val">{counts.UNKNOWN}</div>
            <div className="dash-label">Unknown</div>
          </div>
          {siKeys.length > 0 ? (
            <div className="cmmc-dash-si">
              <strong>SI Objectives:</strong> {siKeys.map((k) => <span key={k}>{k} </span>)}
            </div>
          ) : null}
        </div>
        <div className="cmmc-editor-body">
          <nav className="cmmc-editor-nav" id="cmmcEditorNav" aria-label="Control families">
            <button type="button" className={`cmmc-nav-item${editor.family === '' ? ' active' : ''}`} aria-pressed={editor.family === ''} title="All families" onClick={() => setFamily('')}>
              All <span className="cmmc-nav-count">{controls.length}</span>
            </button>
            {editorFamilies(controls).map(([f, n]) => (
              <button key={f} type="button" className={`cmmc-nav-item${editor.family === f ? ' active' : ''}`} aria-pressed={editor.family === f} title={f} onClick={() => setFamily(f)}>
                {f} <span className="cmmc-nav-count">{n}</span>
              </button>
            ))}
          </nav>
          <div className="cmmc-editor-main">
            <div className="cmmc-editor-filters" id="cmmcEditorFilters">
              <select id="edFilterStatus" aria-label="Status filter" value={editor.status} onChange={(e) => setFilter({ status: e.target.value })}>
                <option value="">All Statuses</option>
                <option value="MET">Met</option>
                <option value="PARTIAL">Partial</option>
                <option value="NOT_MET">Not Met</option>
                <option value="NOT_APPLICABLE">N/A</option>
                <option value="UNKNOWN">Unknown</option>
              </select>
              <select id="edFilterImplType" aria-label="Implementation type filter" value={editor.impl} onChange={(e) => setFilter({ impl: e.target.value })}>
                <option value="">All Types</option>
                <option value="Automated">Automated</option>
                <option value="Manual Process">Manual Process</option>
                <option value="Manual Alternative">Manual Alternative</option>
                <option value="Not Available">Not Available</option>
                <option value="Scoped Out">Scoped Out</option>
              </select>
              <input
                type="text"
                id="edFilterSearch"
                aria-label="Search controls"
                placeholder="Search controls..."
                value={editor.search}
                onChange={(e) => setFilter({ search: e.target.value })}
              />
              <span className="cmmc-filter-count" id="edFilterCount" aria-live="polite">
                {editorCountLabel(filtered.length, controls.length, editor.params)}
              </span>
            </div>
            <div className="cmmc-editor-controls" id="cmmcEditorControls">
              {filtered.length === 0 ? (
                <div className="cmmc-no-match">No controls match the current filters.</div>
              ) : (
                groups.map((g, i) => (
                  <div key={`${g.family}-${i}`}>
                    <div className="cmmc-family-group-header" id={`fam-${escId(g.family)}`}>
                      {`${g.family} — ${FAMILY_NAMES[g.family] || g.family}`}
                    </div>
                    {g.items.map((c) => (
                      <ControlCard key={c.control_id} c={c} expanded={expanded.has(c.control_id)} onToggle={() => toggle(c)} />
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
