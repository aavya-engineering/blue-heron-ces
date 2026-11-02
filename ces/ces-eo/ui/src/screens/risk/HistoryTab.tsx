// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// The annual snapshots (legacy loadSnapshotsList / openSnapshotViewer / openSnapshotComparison).
// The list route returns only { year, snapshotId, signedOffDate }, so each row's detail is read
// with GET /snapshots/:year to show the signer and the risk counts (legacy left those blank).
// Pick two snapshots to compare: added, retired, re-scored and treatment-changed entries.

import { useState, type ReactNode } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { eoApi } from '../../api/eo';
import type { RiskEntry, RiskSnapshot } from '../../api/types';
import { Card, Notice, day, pretty } from '../../components/common';
import { snapshotCounts, snapshotDiff, sourceText, vulnText } from './riskModel';

function EntryTable({ rows, extra }: { rows: Array<{ entry: RiskEntry; from?: string; to?: string }>; extra?: [string, string] }) {
  if (rows.length === 0) return <p className="eo-muted">No changes</p>;
  return (
    <div className="eo-table-wrap">
      <table className="eo-table">
        <thead><tr><th scope="col">Threat event</th><th scope="col">Vulnerability</th>{extra ? <><th scope="col">{extra[0]}</th><th scope="col">{extra[1]}</th></> : <th scope="col">Composite risk</th>}</tr></thead>
        <tbody>
          {rows.map(({ entry, from, to }) => (
            <tr key={entry.id}>
              <td>{entry.threatEvent ?? '—'}</td>
              <td>{vulnText(entry.vulnerability)}</td>
              {extra ? <><td>{pretty(from)}</td><td>{pretty(to)}</td></> : <td>{pretty(entry.compositeRisk)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SnapshotViewer({ s, onClose }: { s: RiskSnapshot; onClose: () => void }) {
  const entries = s.registerSnapshot?.entries ?? [];
  return (
    <Card title={`Snapshot ${s.assessmentYear}`} id="eo-snapshot-viewer" actions={<button type="button" className="btn btn-ghost btn-small" onClick={onClose}>Close</button>}>
      <p className="eo-muted">{`Review date: ${day(s.reviewedDate)} | AO signer: ${s.signedOffBy ?? '—'} | Signed: ${day(s.signedOffDate)} | Total entries: ${entries.length}`}</p>
      {s.reviewNotes ? <p>{`Notes: ${s.reviewNotes}`}</p> : null}
      <div className="eo-table-wrap">
        <table className="eo-table">
          <thead><tr><th scope="col">Threat event</th><th scope="col">Vulnerability</th><th scope="col">Likelihood</th><th scope="col">Impact</th><th scope="col">Composite risk</th><th scope="col">Treatment</th><th scope="col">Last reviewed</th><th scope="col">Source</th></tr></thead>
          <tbody>
            {entries.length === 0 ? <tr><td colSpan={8}>No entries in this snapshot.</td></tr> : entries.map((e) => (
              <tr key={e.id}>
                <td>{e.threatEvent ?? '—'}</td><td>{vulnText(e.vulnerability)}</td><td>{pretty(e.likelihood)}</td><td>{pretty(e.impact)}</td>
                <td>{pretty(e.compositeRisk)}</td><td>{pretty(e.treatmentStatus)}</td><td>{day(e.lastReviewed)}</td><td>{sourceText(e.source)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Comparison({ older, newer, onClose }: { older: RiskSnapshot; newer: RiskSnapshot; onClose: () => void }) {
  const d = snapshotDiff(older, newer);
  const sections: Array<[string, number, ReactNode]> = [
    ['Added', d.added.length, <EntryTable key="a" rows={d.added.map((entry) => ({ entry }))} />],
    ['Retired', d.retired.length, <EntryTable key="r" rows={d.retired.map((entry) => ({ entry }))} />],
    ['Re-scored', d.rescored.length, <EntryTable key="s" rows={d.rescored} extra={['Old risk', 'New risk']} />],
    ['Treatment changed', d.treatment.length, <EntryTable key="t" rows={d.treatment} extra={['Old treatment', 'New treatment']} />],
  ];
  return (
    <Card title={`Compare ${older.assessmentYear} vs ${newer.assessmentYear}`} id="eo-snapshot-compare" actions={<button type="button" className="btn btn-ghost btn-small" onClick={onClose}>Close</button>}>
      {sections.map(([title, n, body]) => (
        <details key={title} className="eo-details" data-section={title}>
          <summary>{`${title} (${n} entries)`}</summary>
          {body}
        </details>
      ))}
    </Card>
  );
}

export function HistoryTab({ tenant }: { tenant: string }) {
  const list = useQuery({ queryKey: ['risk-snapshots', tenant], queryFn: () => eoApi.riskSnapshots(tenant), retry: false });
  const years = (list.data ?? []).map((s) => s.year);
  const details = useQueries({ queries: years.map((y) => ({ queryKey: ['risk-snapshot', tenant, y], queryFn: () => eoApi.riskSnapshot(tenant, y), retry: false })) });
  const byYear = new Map<number, RiskSnapshot>();
  details.forEach((q, i) => { if (q.data) byYear.set(years[i], q.data); });
  const [picked, setPicked] = useState<number[]>([]);
  const [viewing, setViewing] = useState<number | null>(null);
  const [comparing, setComparing] = useState(false);
  const sorted = [...picked].sort((a, b) => a - b);
  const older = byYear.get(sorted[0]);
  const newer = byYear.get(sorted[1]);
  const viewed = viewing !== null ? byYear.get(viewing) : undefined;

  return (
    <>
      <Card title="Annual snapshots" id="eo-risk-history"
        actions={<button type="button" className="btn btn-primary btn-small" id="compareSnapshotsBtn" disabled={picked.length !== 2 || !older || !newer} onClick={() => setComparing(true)}>Compare selected</button>}>
        {list.isError ? <Notice kind="error">Failed to load snapshots.</Notice> : null}
        <div className="eo-table-wrap">
          <table className="eo-table" id="snapshotsHistoryTable">
            <thead><tr><th scope="col">Compare</th><th scope="col">Year</th><th scope="col">Signed off</th><th scope="col">AO signer</th><th scope="col">Entry counts</th><th scope="col">View</th></tr></thead>
            <tbody>
              {(list.data ?? []).length === 0 ? <tr><td colSpan={6}>No snapshots available. Complete an annual review to create one.</td></tr> : (list.data ?? []).map((s) => {
                const det = byYear.get(s.year);
                const c = snapshotCounts(det);
                const checked = picked.includes(s.year);
                return (
                  <tr key={s.year}>
                    <td><input type="checkbox" aria-label={`Compare ${s.year}`} checked={checked} disabled={!checked && picked.length >= 2}
                      onChange={(e) => { setComparing(false); setPicked((p) => (e.target.checked ? [...p, s.year] : p.filter((y) => y !== s.year))); }} /></td>
                    <td>{s.year}</td>
                    <td>{day(s.signedOffDate)}</td>
                    <td>{det?.signedOffBy ?? '—'}</td>
                    <td>{det ? `VH ${c.very_high} · H ${c.high} · M ${c.moderate} · L ${c.low} · VL ${c.very_low}` : '…'}</td>
                    <td><button type="button" className="btn btn-ghost btn-small" aria-label={`View snapshot ${s.year}`} disabled={!det} onClick={() => setViewing(viewing === s.year ? null : s.year)}>View</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      {viewed ? <SnapshotViewer s={viewed} onClose={() => setViewing(null)} /> : null}
      {comparing && older && newer ? <Comparison older={older} newer={newer} onClose={() => setComparing(false)} /> : null}
    </>
  );
}
