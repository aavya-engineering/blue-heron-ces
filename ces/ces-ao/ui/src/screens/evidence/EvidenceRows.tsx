// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-30: the evidence rows of this session's requests, newest first, each with the assessment
// objectives its command evidences (AO-1 `evidence_objectives`, grouped under the command's
// practices). Objectives are display only and never score (AR5). AO has no evidence-list route,
// so the rows are the execute replies this console received (open item in LOG-FIN-30.md).

import { useAoStore } from '../../store/ao';

export function EvidenceRows() {
  const rows = useAoStore((s) => s.evidence);
  return (
    <section className="ao-evidence" aria-labelledby="evidenceRowsTitle" data-testid="evidence-rows">
      <h2 id="evidenceRowsTitle" className="ao-section-title">
        Evidence rows (this session)
      </h2>
      {rows.length === 0 ? (
        <p className="ao-muted">No evidence rows yet. Each dry run and apply that reaches the server writes one.</p>
      ) : (
        <table className="ao-table">
          <caption className="ao-visually-hidden">Evidence rows from this session, newest first</caption>
          <thead>
            <tr>
              <th scope="col">Command</th>
              <th scope="col">Step</th>
              <th scope="col">Outcome</th>
              <th scope="col">Verdict</th>
              <th scope="col">Objectives</th>
              <th scope="col">Correlation id</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.seq}
                data-testid={`evidence-row-${r.seq}`}
                data-command-id={r.commandId}
                data-mode={r.mode}
                data-state={r.state}
                data-outcome={r.outcome}
                data-verdict={r.verdict}
                data-correlation-id={r.correlationId}
                data-evidence-lost={r.evidenceLost ? 'true' : 'false'}
              >
                <td>
                  <span className="ao-mono">{r.commandId}</span> {r.title}
                  <div className="ao-muted">{r.tenant}</div>
                </td>
                <td>{r.mode === 'dry_run' ? 'dry run' : 'apply'}</td>
                <td>
                  {r.outcome || '—'}
                  {r.evidenceLost ? (
                    <div className="badge badge-violation" role="status">
                      EVIDENCE NOT PERSISTED
                    </div>
                  ) : null}
                </td>
                <td>
                  <span className={r.verdict === 'SAT' ? 'badge badge-compliant' : r.verdict ? 'badge badge-violation' : ''}>{r.verdict || '—'}</span>
                </td>
                <td>
                  {r.objectives.length === 0 ? (
                    <span className="ao-muted">none declared</span>
                  ) : (
                    <ul className="ao-obj-list" data-testid={`evidence-objectives-${r.seq}`}>
                      {r.objectives.map((g) => (
                        <li key={g.control} data-control={g.control}>
                          <span className="ao-mono">{g.control}</span>
                          {g.objectives.length ? <span className="ao-mono ao-muted">{` ${g.objectives.join(', ')}`}</span> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="ao-mono ao-small">
                  {r.correlationId}
                  {r.evidencePath ? <div className="ao-muted">{r.evidencePath}</div> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
