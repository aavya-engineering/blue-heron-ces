// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// One `assess_check` row in #taskList (legacy handleAssessEvent L7420-7586, buildRegistryMetaBlock
// L10539): status icon, entry id, engine, label, control pills, index, and the details block.

import { useState } from 'react';
import { escId } from 'ces-ui-kit';
import { assessRowClasses, useAssessStore } from '../../store/assess';
import type { AssessEntryRow as Row } from '../../store/assess';

function RegistryMeta({ reg }: { reg: Record<string, any> | null | undefined }) {
  if (!reg) return null;
  const items: JSX.Element[] = [];
  if (reg['idempotency']) items.push(<span key="i" className={`meta-badge idemp-${reg['idempotency']}`}>idemp: {reg['idempotency']}</span>);
  if (reg['on_failure']) items.push(<span key="f" className={`meta-badge fail-${reg['on_failure']}`}>on-fail: {reg['on_failure']}</span>);
  if (reg['layer_hint'] !== undefined && reg['layer_hint'] !== null) items.push(<span key="l" className="meta-badge layer-hint">L{reg['layer_hint']}</span>);
  if (reg['sequence_hint'] !== undefined && reg['sequence_hint'] !== null)
    items.push(<span key="s" className="meta-badge layer-hint">seq:{reg['sequence_hint']}</span>);
  if (reg['manual_only']) items.push(<span key="m" className="meta-badge manual-only">manual-only</span>);
  const pills = (key: string, label: string, values: string[], cls: string) => {
    if (!values.length) return;
    items.push(<span key={`${key}-l`} className="registry-meta-label">{label}</span>);
    values.forEach((v, i) =>
      items.push(
        <span key={`${key}-${i}`} className={cls}>
          {v}
        </span>,
      ),
    );
  };
  pills('vr', 'vars-req:', reg['variables_required'] || [], 'var-pill-required');
  pills('vt', 'vars-rt:', reg['variables_runtime'] || [], 'var-pill-runtime');
  pills('cp', 'captures:', (reg['captures'] || []).map((c: { variable: string; from: string }) => `${c.variable} (${c.from})`), 'var-pill-capture');
  if (reg['evidence_commands'] && reg['evidence_commands'].length > 0)
    items.push(<span key="e" className="registry-meta-label">evid-cmds: {reg['evidence_commands'].length}</span>);
  if (reg['notes']) items.push(<div key="n" className="registry-meta-notes">{reg['notes']}</div>);
  if (items.length === 0) return null;
  return <div className="registry-meta-block">{items}</div>;
}

function ClippedOutput({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button type="button" className={`sub-cmd-stream-output collapsible${open ? '' : ' clipped'}`} aria-expanded={open} onClick={() => setOpen(!open)}>
      {text}
    </button>
  );
}

export function AssessEntryRow({ row }: { row: Row }) {
  const [expanded, setExpanded] = useState(true);
  const openEvidenceModal = useAssessStore((s) => s.openEvidenceModal);
  const d = row.data;
  const { icon, iconCls, rowCls, verdictCls } = assessRowClasses(d);
  const cut = (text: string, n: number) => (row.verbose ? text : text.substring(0, n));
  const detailsId = `assess-entry-${escId(d.entryId || '')}-details`;
  return (
    <div className={`assess-entry-row${expanded ? ' expanded' : ''} ${rowCls}`} id={`assess-entry-${escId(d.entryId || '')}`}>
      <button type="button" className="assess-entry-header" aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded(!expanded)}>
        <span className={`assess-status-icon ${iconCls}`} aria-hidden="true">
          {icon}
        </span>
        <span className="assess-entry-id">{d.entryId || ''}</span>
        {d.engine ? <span className="assess-engine-badge">{d.engine}</span> : null}
        <span className="assess-entry-label">{d.label || ''}</span>
        {(d.cmmc_controls || []).map((c) => (
          <span key={c} className="cmmc-control-pill">
            {c}
          </span>
        ))}
        <span className="assess-entry-index">{d.entryIndex ? `${d.entryIndex}/${row.total}` : ''}</span>
      </button>
      <div className="assess-entry-details" id={detailsId} hidden={!expanded}>
        <RegistryMeta reg={d.registry} />
        {d.command ? (
          <div className="sub-cmd-stream-line">
            <span className="stream-phase-badge get">GET</span>
            <span className="stream-cmd-text">{cut(d.command, 300)}</span>
          </div>
        ) : null}
        {d.rawOutput && d.rawOutput.trim() ? <ClippedOutput text={cut(d.rawOutput, 2000)} /> : null}
        {d.set_command ? (
          <div className="sub-cmd-stream-line">
            <span className="stream-phase-badge would-set">WOULD SET</span>
            <span className="stream-cmd-text">{cut(d.set_command, 300)}</span>
          </div>
        ) : null}
        {d.file ? (
          <div className="sub-cmd-stream-line">
            <span className="stream-phase-badge evidence">EVIDENCE</span>
            <span className="stream-cmd-text">{d.file}</span>
          </div>
        ) : null}
        {d.evidenceContent && d.evidenceContent.trim() ? <ClippedOutput text={d.evidenceContent} /> : null}
        {d.evidenceContent && d.evidenceContent.trim() ? (
          <button
            type="button"
            className="btn btn-secondary btn-small btn-evidence"
            onClick={(e) => {
              e.stopPropagation();
              useAssessStore.setState((s) => ({ evidence: { ...s.evidence, nav: [], index: 0 } }));
              openEvidenceModal({
                entryId: d.entryId || '',
                label: d.label || '',
                outcome: d.outcome || null,
                outcomeRationale: d.outcomeRationale || null,
                complianceVerdict: d.complianceVerdict || null,
                verdictRationale: d.verdictRationale || null,
                cmmc_controls: d.cmmc_controls || [],
                evidenceContent: d.evidenceContent || '',
                file: d.file || '',
                engine: d.engine || '',
                command: d.command || '',
                rawOutput: d.rawOutput || '',
                set_command: d.set_command || '',
                fullRegistry: d.fullRegistry || d.registry || null,
              });
            }}
          >
            Evidence
          </button>
        ) : null}
        {d.reason ? <div className={`assess-verdict ${verdictCls}`}>{d.reason}</div> : null}
      </div>
    </div>
  );
}
