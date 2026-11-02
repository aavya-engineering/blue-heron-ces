// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useState } from 'react';

/** The execute `summary` event fields the legacy Execution Results panel shows. */
export interface ExecutionSummary {
  total: number;
  pass: number;
  accomplished?: number;
  fail: number;
  skip: number;
  dryRunLog?: string;
  reportJson?: string;
  reportMd?: string;
}

/** One row of the legacy "Control Execution Results" table (`_lastExecutionResults.results[]`). */
export interface ControlResult {
  controlId: string;
  directive: string;
  /** SAT, NOT_SAT, PROVISIONAL, N/A, or another verdict (shown untinted). */
  verdict: string;
  outcome: string;
  evidencePath?: string;
}

export interface ExecutionResultsTableProps {
  /** Null or absent: the panel shows with empty content, as before a run. */
  summary?: ExecutionSummary | null;
  /** Absent: the per-control section is not shown (legacy hides it until results arrive). */
  controlResults?: readonly ControlResult[];
  /** Link target for a report path; legacy is `file://` + path. */
  reportHref?: (path: string) => string;
  /** Per-control table starts expanded. Legacy starts collapsed. */
  defaultExpanded?: boolean;
  /** Panel id; default legacy `results`. */
  id?: string;
  /** Content id; default legacy `resultsContent` (demo driver: `#resultsContent .report-links a`). */
  contentId?: string;
}

const VERDICT_TONE: Readonly<Record<string, string>> = {
  SAT: 'ck-verdict-sat',
  NOT_SAT: 'ck-verdict-notsat',
  PROVISIONAL: 'ck-verdict-provisional',
  'N/A': 'ck-verdict-na',
};

function defaultReportHref(path: string) {
  return `file://${path}`;
}

/** Legacy Execution Results panel (`#results` > `#resultsContent`: summary table, report links) plus the per-control table. */
export function ExecutionResultsTable({
  summary,
  controlResults,
  reportHref = defaultReportHref,
  defaultExpanded = false,
  id = 'results',
  contentId = 'resultsContent',
}: ExecutionResultsTableProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const rows: ReadonlyArray<[string, number]> = summary
    ? [
        ['Total Steps', summary.total],
        ['Pass (Stamper)', summary.pass],
        ['Accomplished (Operator)', summary.accomplished ?? 0],
        ['Fail', summary.fail],
        ['Skip', summary.skip],
      ]
    : [];

  return (
    <section id={id} className="panel ck-panel ck-results" aria-labelledby={`${id}Title`}>
      <h2 id={`${id}Title`} className="ck-panel-title">
        Execution Results
      </h2>
      <div id={contentId}>
        {summary ? (
          <>
            <table className="ck-summary-table">
              <thead>
                <tr>
                  <th scope="col">Metric</th>
                  <th scope="col">Count</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([label, value]) => (
                  <tr key={label}>
                    <td>{label}</td>
                    <td>{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {summary.dryRunLog ? (
              <div className="report-links ck-report-links">
                <strong>Dry Run Log:</strong>
                <br />
                <a href={reportHref(summary.dryRunLog)}>{summary.dryRunLog}</a>
              </div>
            ) : null}
            {summary.reportJson || summary.reportMd ? (
              <div className="report-links ck-report-links">
                <strong>Reports:</strong>
                <br />
                {summary.reportJson ? (
                  <>
                    <a href={reportHref(summary.reportJson)}>{summary.reportJson}</a>
                    <br />
                  </>
                ) : null}
                {summary.reportMd ? <a href={reportHref(summary.reportMd)}>{summary.reportMd}</a> : null}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
      {controlResults ? (
        <div id="controlResultsSection" className="ck-control-results">
          <button
            type="button"
            className="ck-control-results-toggle"
            aria-expanded={expanded}
            aria-controls="controlResultsBody"
            onClick={() => setExpanded((v) => !v)}
          >
            <span className={expanded ? 'ck-chevron ck-chevron-open' : 'ck-chevron'} aria-hidden="true">
              {'▶'}
            </span>
            <span className="ck-control-results-title">Control Execution Results</span>
            <span id="controlResultsCount" className="ck-control-results-count">
              ({controlResults.length})
            </span>
          </button>
          <div id="controlResultsBody" className="ck-control-results-body" hidden={!expanded} tabIndex={0}>
            <table className="ck-control-table">
              <thead>
                <tr>
                  <th scope="col">Control ID</th>
                  <th scope="col">Directive</th>
                  <th scope="col">Verdict</th>
                  <th scope="col">Outcome</th>
                  <th scope="col">Evidence</th>
                </tr>
              </thead>
              <tbody id="controlResultsTableBody">
                {controlResults.map((r, index) => (
                  <tr key={`${r.controlId}-${index}`} data-verdict={r.verdict}>
                    <td className="ck-mono">{r.controlId}</td>
                    <td>{r.directive}</td>
                    <td>
                      <span className={`ck-verdict ${VERDICT_TONE[r.verdict] ?? ''}`.trim()}>{r.verdict}</span>
                    </td>
                    <td>{r.outcome}</td>
                    <td>
                      {r.evidencePath ? (
                        <span className="ck-evidence-file" title={r.evidencePath}>
                          {r.evidencePath.replace(/.*[\\/]/, '')}
                        </span>
                      ) : (
                        <span className="ck-muted">--</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
