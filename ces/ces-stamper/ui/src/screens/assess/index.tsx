// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Assess screen (legacy workflow card 2, index.html L4252-4452; PC-05): the CMMC posture grid
// with tile drill-down, the family breakdown, verbose and upload toggles, Assess and Halt,
// Compute Gaps with the gap plan, the assess rows in the console, the CMMC status editor and
// the evidence viewer. #btnAssess and #cardStatus2 are demo-driver selectors.

import { EvidenceViewer } from 'ces-ui-kit';
import { GRID_COLUMNS, GRID_ROWS, ROW_SAT_TYPE, useAssessStore } from '../../store/assess';
import type { GridColumn, GridModel, GridRow } from '../../store/assess';
import { useConsoleStore } from '../../store/console';
import { CardScreen, ConsolePanel, WorkflowCard } from '../tenant/shared';
import { PrereqPanel } from '../tenant';
import { AssessEntryRow } from './AssessEntryRow';
import { CmmcEditor } from './CmmcEditor';

const COLUMN_LABEL: Record<GridColumn | 'sprs', string> = {
  automated: 'Automated',
  excluded: 'Excluded',
  nonstack: 'Non-Stack',
  total: 'Total',
  sprs: 'SPRS',
};
const ROW_LABEL: Record<GridRow, string> = { satisfied: 'Satisfied', provisional: 'Provisional', not_satisfied: 'Not Satisfied / Not Verified' };
const ROW_TONE: Record<GridRow, string> = { satisfied: 'metric-green', provisional: 'metric-blue', not_satisfied: 'metric-amber' };

function GridRowCells({ grid, row, onOpen }: { grid: GridModel | null; row: GridRow; onOpen: (col: GridColumn) => void }) {
  return (
    <>
      {GRID_COLUMNS.map((col) => {
        const cell = grid ? grid.cells[row][col] : null;
        return (
          <button
            type="button"
            key={col}
            className={`metric-cell ${ROW_TONE[row]}`}
            id={`cmmc_cell_${row}_${col}`}
            aria-label={`${ROW_LABEL[row]}, ${COLUMN_LABEL[col]}: ${cell ? cell.count : 'no data'}. Show controls`}
            onClick={() => onOpen(col)}
          >
            <span className="metric-value" id={`cmmc_val_${row}_${col}`}>
              {cell ? cell.count : '--'}
            </span>
            <span className="metric-pct" id={`cmmc_pct_${row}_${col}`}>
              {cell ? cell.pct : '--'}
            </span>
          </button>
        );
      })}
      <div className={`metric-cell ${ROW_TONE[row]}`} id={`cmmc_cell_${row}_sprs`}>
        <span className="metric-value" id={`cmmc_val_${row}_sprs`}>
          {grid ? grid.sprs[row] : '--'}
        </span>
        <span className="metric-pct" id={`cmmc_pct_${row}_sprs`}>
          pts off
        </span>
      </div>
    </>
  );
}

function CmmcGrid() {
  const grid = useAssessStore((s) => s.grid);
  const summarySprs = useAssessStore((s) => s.summarySprs);
  const showGridControls = useAssessStore((s) => s.showGridControls);
  return (
    <div className="cmmc-grid" id="cmmcDirectiveGrid" role="group" aria-label="CMMC posture" data-grid-mode={grid ? (grid.hasDirectives ? 'directive' : 'plan-less') : 'empty'}>
      {(['automated', 'excluded', 'nonstack', 'total', 'sprs'] as const).map((c) => (
        <div className="cmmc-grid-header" key={`h-${c}`}>
          {COLUMN_LABEL[c]}
        </div>
      ))}
      {GRID_COLUMNS.map((c) => (
        <div className="cmmc-summary-cell" id={`cmmc_summary_${c}`} key={`s-${c}`}>
          {grid && grid.summary ? grid.summary[c] : '--'}
        </div>
      ))}
      <div className="cmmc-summary-cell" id="cmmc_summary_sprs">
        {summarySprs}
      </div>
      {GRID_ROWS.map((row) => (
        <GridRowCells key={row} grid={grid} row={row} onOpen={(col) => void showGridControls(col, ROW_SAT_TYPE[row])} />
      ))}
    </div>
  );
}

function FamilyBreakdown() {
  const visible = useAssessStore((s) => s.reviewToggleVisible);
  const collapsed = useAssessStore((s) => s.reviewCollapsed);
  const families = useAssessStore((s) => s.families);
  const toggle = useAssessStore((s) => s.toggleReviewDetail);
  const openEditor = useAssessStore((s) => s.openEditor);
  return (
    <>
      <button
        type="button"
        className="review-detail-toggle"
        id="reviewDetailToggle"
        hidden={!visible}
        aria-expanded={!collapsed}
        aria-controls="reviewDetailWrap"
        onClick={toggle}
      >
        <span>Family Breakdown</span>
        <span className={`review-detail-chevron${collapsed ? ' collapsed' : ''}`} id="reviewDetailChevron" aria-hidden="true">
          ▼
        </span>
      </button>
      <div id="reviewDetailWrap" hidden={collapsed}>
        <table className="cmmc-family-table" id="cmmcFamilyTable">
          <tbody>
            <tr>
              <th scope="col">Family</th>
              <th scope="col">Total</th>
              <th scope="col">OK</th>
              <th scope="col">Prov</th>
              <th scope="col">Gap</th>
              <th scope="col">
                <span className="visually-hidden">Bar</span>
              </th>
            </tr>
            {families.map((f) => (
              <tr key={f.family} data-family={f.family}>
                <td title={f.name}>{f.family}</td>
                <td>{f.total}</td>
                <td className="fam-ok">
                  <button type="button" aria-label={`${f.family} satisfied: ${f.ok}`} onClick={() => void openEditor(false, { familyFilter: f.family, satType: 'satisfied' })}>
                    {f.ok}
                  </button>
                </td>
                <td className="fam-prov">
                  <button type="button" aria-label={`${f.family} provisional: ${f.prov}`} onClick={() => void openEditor(false, { familyFilter: f.family, satType: 'provisional' })}>
                    {f.prov}
                  </button>
                </td>
                <td className="fam-gap">
                  <button type="button" aria-label={`${f.family} not satisfied: ${f.gap}`} onClick={() => void openEditor(false, { familyFilter: f.family, satType: 'unsat' })}>
                    {f.gap}
                  </button>
                </td>
                <td className="bar-cell">
                  <div className="cmmc-bar" aria-hidden="true">
                    <div className="cmmc-bar-seg green" style={{ width: `${f.greenPct}%` }} />
                    <div className="cmmc-bar-seg blue" style={{ width: `${f.bluePct}%` }} />
                    <div className="cmmc-bar-seg amber" style={{ width: `${f.amberPct}%` }} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function GapPlanSection() {
  const plan = useAssessStore((s) => s.gapPlan);
  if (!plan) return null;
  const s = plan.summary;
  return (
    <div id="gapPlanSection">
      <div className="review-detail-toggle">
        <span>Gap Remediation Plan</span>
        <span id="gapPlanCount">{plan.gap_controls.length} controls with gaps</span>
      </div>
      <div className="cmmc-legend" id="gapPlanSummary">
        <div className="cmmc-legend-item">
          <span className="cmmc-legend-dot dot-red" />
          Critical: {s.by_priority.critical}
        </div>
        <div className="cmmc-legend-item">
          <span className="cmmc-legend-dot dot-amber" />
          High: {s.by_priority.high}
        </div>
        <div className="cmmc-legend-item">
          <span className="cmmc-legend-dot dot-blue" />
          Medium: {s.by_priority.medium}
        </div>
        <div className="cmmc-legend-item">
          <span className="cmmc-legend-dot dot-muted" />
          Low: {s.by_priority.low}
        </div>
        <div className="cmmc-legend-item">
          {s.total_gap_entries} gap entries · {s.manual_only_count} manual-only · {s.automated_count} automated
        </div>
      </div>
      <div id="gapPlanControls">
        {plan.gap_controls.length === 0 ? (
          <div className="cmmc-detail-muted">
            No gap entries in the cached assess state (not a satisfaction claim — re-run Assess if the tenant may have changed).
          </div>
        ) : (
          plan.gap_controls.map((gc) => (
            <div key={gc.control_id} className={`gap-plan-control ${gc.priority}`} data-control={gc.control_id}>
              <div className="gap-plan-head">
                <span className="gap-plan-id">{gc.control_id}</span>
                <span className="gap-plan-practice">{gc.practice}</span>
                <span className="gap-plan-priority">{gc.priority}</span>
              </div>
              {gc.gap_entries.map((ge, i) => (
                <div className="gap-plan-entry" key={`${ge.entry_id}-${i}`}>
                  <span>{ge.entry_id}</span>
                  <span>{ge.label}</span>
                  <span>{ge.status}</span>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function AssessCard() {
  const s = useAssessStore();
  const classes = [s.cardState ? `card-${s.cardState}` : ''].filter(Boolean).join(' ');
  return (
    <WorkflowCard
      index={2}
      title="Assess"
      titleId="screen-title-assess"
      badge={s.badge}
      collapsed={s.collapsed}
      onToggle={s.toggleCard}
      className={classes}
      tooltip="Query the live tenant to determine what CMMC controls are already satisfied."
      headerExtra={
        <>
          <span id="assessCounter" className="assess-counter">
            {s.counter}
          </span>
          <span className="assess-stale-badge" id="assessStaleIndicator" hidden={!s.stale}>
            ⚠ Stale — Re-run
          </span>
        </>
      }
    >
      {s.configWarn ? (
        <div className="card-config-warn" role="alert">
          <strong>Missing tenant config fields:</strong>
          <ul>
            {s.configWarn.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div id="cmmcSection" className={s.stale ? 'grid-stale' : ''} data-stale={s.stale ? 'true' : 'false'}>
        <CmmcGrid />
        <div className="cmmc-legend" id="cmmcDirectiveLegend">
          <div className="cmmc-legend-item">
            <span className="cmmc-legend-dot dot-green" />
            <span>Satisfied</span>
          </div>
          <div className="cmmc-legend-item">
            <span className="cmmc-legend-dot dot-blue" />
            <span>Provisional</span>
          </div>
          <div className="cmmc-legend-item">
            <span className="cmmc-legend-dot dot-amber" />
            <span title="Not satisfied, or planned but not verified by a tenant read">Not Satisfied / Not Verified</span>
          </div>
        </div>
        <FamilyBreakdown />
      </div>
      <div>
        <label className="verbose-toggle">
          <input type="checkbox" id="verboseAssess" checked={s.verboseChecked} onChange={(e) => s.setVerbose(e.target.checked)} /> Verbose
        </label>
        <label className="verbose-toggle">
          <input type="checkbox" id="uploadToAssess" checked={s.uploadToBlob} onChange={(e) => s.setUploadToBlob(e.target.checked)} /> Upload Evidence
        </label>
      </div>
      <div className="btn-row">
        <button type="button" className="btn btn-primary grow" id="btnAssess" onClick={s.doAssess} disabled={s.running}>
          Assess Tenant
        </button>
        <button type="button" className="btn btn-destructive btn-small" id="btnAssessHalt" onClick={s.haltAssess} hidden={!s.running}>
          Halt
        </button>
      </div>
      <div className="btn-row">
        <button
          type="button"
          className="btn btn-secondary grow"
          id="btnComputeGaps"
          onClick={() => void s.computeGaps()}
          disabled={s.computingGaps}
          title="Compute a gap-remediation plan from the last Assess run (cached, no live tenant query)."
        >
          {s.computingGaps ? 'Computing...' : 'Compute Gaps'}
        </button>
      </div>
      <GapPlanSection />
    </WorkflowCard>
  );
}

function AssessRows() {
  const epoch = useConsoleStore((s) => s.logEpoch);
  const entries = useAssessStore((s) => s.entries);
  return (
    <>
      {entries
        .filter((r) => r.epoch === epoch)
        .map((r) => (
          <AssessEntryRow key={r.key} row={r} />
        ))}
    </>
  );
}

function EvidenceOverlay() {
  const evidence = useAssessStore((s) => s.evidence);
  const close = useAssessStore((s) => s.closeEvidence);
  const nav = useAssessStore((s) => s.evidenceNav);
  return (
    <EvidenceViewer
      mode="overlay"
      open={evidence.open}
      evidence={evidence.record}
      onClose={close}
      nav={evidence.nav.length > 1 ? { index: evidence.index, total: evidence.nav.length, onPrev: () => nav(-1), onNext: () => nav(1) } : undefined}
    />
  );
}

export default function AssessScreen() {
  return (
    <CardScreen
      screen="assess"
      titleId="screen-title-assess"
      card={<AssessCard />}
      console={
        <ConsolePanel>
          <AssessRows />
          <PrereqPanel />
        </ConsolePanel>
      }
    >
      <CmmcEditor />
      <EvidenceOverlay />
    </CardScreen>
  );
}
