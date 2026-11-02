// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Evidence screen (legacy card 5, ces-stamper/public/index.html L4600-4623; PC-10, PC-11).
// Legacy ids kept: workflowCard5, cardStatus5, evidenceSummary, evStat*, evidenceSearch,
// evidenceFamilies, evidenceEmptyState, btnEvidenceScan, and data-family-abbrev /
// data-control-id / data-entry-id on the rows. The overlay is the kit EvidenceViewer
// (evidenceViewerOverlay). Tenant: ?tenant= if given, else the workflow store's tenant.

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { EvidenceViewer, escId } from 'ces-ui-kit';
import { useWorkflowStore } from '../../store/workflow';
import {
  cardStatusText,
  controlBadge,
  controlMatches,
  familyBadge,
  fileMeta,
  readExpandedFamilies,
  sortControls,
  summaryView,
  useEvidenceStore,
  verdictBadge,
  visibleFamilies,
  writeExpandedFamilies,
} from '../../store/evidence';
import type { EvidenceScanControl, EvidenceScanEntry, EvidenceScanFamily } from '../../store/evidence';
import './evidence.css';

const CARD_STATE = { idle: '', running: 'active', done: 'done', failed: 'failed' } as const;

export default function EvidenceScreen() {
  const [params] = useSearchParams();
  const storeTenant = useWorkflowStore((s) => s.tenant);
  const tenant = params.get('tenant') || storeTenant || null;

  const state = useEvidenceStore();
  const { setTenant, scanEvidence, openOverlay, closeOverlay, openPopout } = state;
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string[]>(() => readExpandedFamilies());
  const [openControls, setOpenControls] = useState<Record<string, boolean>>({});

  useEffect(() => setTenant(tenant), [tenant, setTenant]);

  // A new scan re-renders the families: controls collapse, expanded families come back from storage.
  useEffect(() => {
    setOpenControls({});
    setExpanded(readExpandedFamilies());
  }, [state.scan]);

  const toggleFamily = (abbrev: string) => {
    const next = expanded.includes(abbrev) ? expanded.filter((a) => a !== abbrev) : [...expanded, abbrev];
    setExpanded(next);
    writeExpandedFamilies(next);
  };
  const toggleControl = (key: string) => setOpenControls((c) => ({ ...c, [key]: !c[key] }));

  const scan = state.scan;
  const summary = scan ? summaryView(scan.summary) : null;
  const scanned = state.status !== 'idle' && scan !== null;
  const empty = scanned && scan.summary.controlsWithEvidence === 0;

  return (
    <section
      className="spa-screen spa-ev"
      data-screen="evidence"
      id="workflowCard5"
      data-card-state={CARD_STATE[state.status]}
      aria-labelledby="screen-title-evidence"
    >
      <div className="spa-ev-header">
        <h2 id="screen-title-evidence">
          <span className="spa-ev-step" aria-hidden="true">
            5
          </span>
          Evidence
        </h2>
        <span className="spa-ev-status" id="cardStatus5" data-status={state.status} aria-live="polite">
          {cardStatusText(state)}
        </span>
      </div>
      <p className="spa-ev-intro">
        Interrogate the local evidence store against all 110 CMMC L2 controls: which registry sub-commands have
        evidence files on disk, grouped by CMMC family.
      </p>

      <div className="spa-ev-summary" id="evidenceSummary">
        <Stat id="evStatControls" label="Controls" value={summary ? String(summary.controls) : '--'} tone={null} />
        <Stat
          id="evStatWithEvidence"
          label="With Evidence"
          value={summary ? String(summary.withEvidence.value) : '--'}
          tone={summary?.withEvidence.tone ?? null}
        />
        <Stat
          id="evStatMissing"
          label="Missing"
          value={summary ? String(summary.missing.value) : '--'}
          tone={summary?.missing.tone ?? null}
        />
        <Stat id="evStatCoverage" label="Coverage" value={summary ? summary.coverage.text : '--'} tone={summary?.coverage.tone ?? null} />
      </div>

      <div className="spa-ev-search">
        <label className="ck-sr-only" htmlFor="evidenceSearch">
          Search controls
        </label>
        <input
          type="text"
          id="evidenceSearch"
          placeholder="Search controls (e.g., AC.L2-3.1.5)..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div id="evidenceFamilies" hidden={empty}>
        {scan
          ? visibleFamilies(scan.families, query).map((fam) => (
              <Family
                key={fam.abbreviation}
                fam={fam}
                query={query}
                expanded={expanded.includes(fam.abbreviation)}
                onToggle={() => toggleFamily(fam.abbreviation)}
                openControls={openControls}
                onToggleControl={toggleControl}
                verdicts={state.verdicts}
                onOpen={(entryId) => void openOverlay(entryId)}
                onPopout={(entryId) => void openPopout(entryId)}
              />
            ))
          : null}
      </div>
      <div id="evidenceEmptyState" className="spa-ev-empty" hidden={!empty}>
        No evidence files found. Run Execute to generate evidence.
      </div>

      {state.message ? (
        <p className="spa-ev-message" id="evidenceStatusMessage" role="alert">
          {state.message.text}
        </p>
      ) : null}

      <div className="spa-ev-actions">
        <button type="button" className="btn btn-primary" id="btnEvidenceScan" onClick={() => void scanEvidence()}>
          Scan Evidence
        </button>
      </div>

      <EvidenceViewer mode="overlay" open={state.overlay.open} evidence={state.overlay.evidence} onClose={closeOverlay} />
    </section>
  );
}

function Stat({ id, label, value, tone }: { id: string; label: string; value: string; tone: string | null }) {
  return (
    <div className="spa-ev-stat">
      <div className="spa-ev-stat-value" id={id} data-tone={tone ?? undefined}>
        {value}
      </div>
      <div className="spa-ev-stat-label">{label}</div>
    </div>
  );
}

interface FamilyProps {
  fam: EvidenceScanFamily;
  query: string;
  expanded: boolean;
  onToggle: () => void;
  openControls: Readonly<Record<string, boolean>>;
  onToggleControl: (key: string) => void;
  verdicts: Readonly<Record<string, unknown>>;
  onOpen: (entryId: string) => void;
  onPopout: (entryId: string) => void;
}

function Family({ fam, query, expanded, onToggle, openControls, onToggleControl, verdicts, onOpen, onPopout }: FamilyProps) {
  const badge = familyBadge(fam);
  const bodyId = `evFamilyBody-${escId(fam.abbreviation)}`;
  return (
    <div className="spa-ev-family" data-family-abbrev={fam.abbreviation} data-collapsed={!expanded}>
      <h3 className="spa-ev-family-heading">
        <button type="button" className="spa-ev-family-header" aria-expanded={expanded} aria-controls={bodyId} onClick={onToggle}>
          <span className="spa-ev-chevron" aria-hidden="true">
            {expanded ? '▼' : '▶'}
          </span>
          <strong>{fam.abbreviation}</strong> {fam.name}
          <span className="spa-ev-badge" data-tone={badge.tone}>
            {badge.text}
          </span>
        </button>
      </h3>
      <div className="spa-ev-family-body" id={bodyId} hidden={!expanded}>
        {sortControls(fam.controls)
          .filter((ctrl) => controlMatches(ctrl.controlId, query))
          .map((ctrl) => (
            <Control
              key={ctrl.controlId}
              ctrl={ctrl}
              open={!!openControls[`${fam.abbreviation}/${ctrl.controlId}`]}
              onToggle={() => onToggleControl(`${fam.abbreviation}/${ctrl.controlId}`)}
              verdicts={verdicts}
              onOpen={onOpen}
              onPopout={onPopout}
            />
          ))}
      </div>
    </div>
  );
}

interface ControlProps {
  ctrl: EvidenceScanControl;
  open: boolean;
  onToggle: () => void;
  verdicts: Readonly<Record<string, unknown>>;
  onOpen: (entryId: string) => void;
  onPopout: (entryId: string) => void;
}

function Control({ ctrl, open, onToggle, verdicts, onOpen, onPopout }: ControlProps) {
  const badge = controlBadge(ctrl);
  const filesId = `evControlFiles-${escId(ctrl.controlId)}`;
  return (
    <>
      <button
        type="button"
        className="spa-ev-control-row"
        data-control-id={ctrl.controlId}
        aria-expanded={open}
        aria-controls={filesId}
        onClick={onToggle}
      >
        <span className="spa-ev-chevron" aria-hidden="true">
          {open ? '▼' : '▶'}
        </span>
        <span className="spa-ev-control-id">{ctrl.controlId}</span>
        <span className="spa-ev-control-practice">{ctrl.practice}</span>
        <span className="spa-ev-badge" data-tone={badge.tone}>
          {badge.text}
        </span>
      </button>
      <div className="spa-ev-control-files" id={filesId} hidden={!open}>
        {ctrl.entries.map((entry) => (
          <FileRow key={entry.entryId} entry={entry} verdict={verdicts[entry.entryId]} onOpen={onOpen} onPopout={onPopout} />
        ))}
      </div>
    </>
  );
}

interface FileRowProps {
  entry: EvidenceScanEntry;
  verdict: unknown;
  onOpen: (entryId: string) => void;
  onPopout: (entryId: string) => void;
}

function FileRow({ entry, verdict, onOpen, onPopout }: FileRowProps) {
  const v = verdictBadge(verdict);
  const content = (
    <>
      <span className="spa-ev-engine">{entry.engine}</span>
      <span className="spa-ev-file-label">{entry.label}</span>
      <span className="spa-ev-verdict" data-verdict={v.tone}>
        {v.text}
      </span>
      <span className="spa-ev-file-meta">{fileMeta(entry)}</span>
    </>
  );
  if (!entry.evidenceExists) {
    return (
      <div className="spa-ev-file-row" data-entry-id={entry.entryId} data-evidence-file={entry.evidenceFile} data-missing="true">
        {content}
      </div>
    );
  }
  return (
    <div className="spa-ev-file-row" data-entry-id={entry.entryId} data-evidence-file={entry.evidenceFile}>
      <button type="button" className="spa-ev-file-open" onClick={() => onOpen(entry.entryId)}>
        {content}
      </button>
      <button
        type="button"
        className="btn btn-ghost spa-ev-popout-btn"
        id={`evPopout-${escId(entry.entryId)}`}
        title="Open in a new window"
        aria-label={`Open ${entry.label} evidence in a new window`}
        onClick={() => onPopout(entry.entryId)}
      >
        {'⧉'}
      </button>
    </div>
  );
}
