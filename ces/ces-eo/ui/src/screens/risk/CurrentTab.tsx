// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// The risk register's current assessment (legacy risk-tab-current): vulnerability ingestion and its
// run history, the annual-review entry points, filter chips, the sortable register, the summary
// panel, and the entry editor (legacy risk drawer: score, treatment, reference, notes, mark
// mitigated / accepted, delete).

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { eoApi } from '../../api/eo';
import type { IngestionReport, RiskEntry, RiskRegister } from '../../api/types';
import { Card, ConfirmButton, Field, Notice, day, pretty, useAction } from '../../components/common';
import { AnnualReview, OneClickReview } from './AnnualReview';
import { LEVELS, NO_FILTERS, RECOMMENDATION, TREATMENT, compositeRisk, filterAndSort, sourceText, summarize, type RiskFilters, type SortKey } from './riskModel';

const SOURCE_CHIPS: Array<[string, string]> = [['defender_for_cloud', 'Defender'], ['secure_score', 'Secure Score'], ['plan_output', 'Plan Output'], ['manual', 'Manual'], ['sentinel_alert', 'Sentinel']];
const RISK_CHIPS: Array<[string, string]> = [['very_high', 'Very High'], ['high', 'High'], ['moderate', 'Moderate'], ['low', 'Low'], ['very_low', 'Very Low']];
const TREAT_CHIPS: Array<[string, string]> = [['recommended', 'Recommended'], ['in_progress', 'In Progress'], ['mitigated', 'Mitigated'], ['accepted_residual', 'Accepted'], ['transferred', 'Transferred']];
const COLUMNS: Array<[SortKey, string]> = [['threatEvent', 'Threat'], ['vulnerability', 'Vulnerability'], ['likelihood', 'Likelihood'], ['impact', 'Impact'], ['compositeRisk', 'Risk'], ['treatmentStatus', 'Treatment'], ['lastReviewed', 'Reviewed'], ['source', 'Source']];

function SourceDetail({ e }: { e: RiskEntry }) {
  const s = e.source;
  if (!s) return <>—</>;
  return (
    <>
      <strong>Type:</strong> {pretty(s.type)}
      {s.type === 'defender_for_cloud' && s.alertId ? <> | <a href={`https://portal.azure.us/#blade/Microsoft_Azure_Security/AlertBlade/alertId/${encodeURIComponent(String(s.alertId))}`} target="_blank" rel="noreferrer">View in Azure</a></> : null}
      {s.type === 'secure_score' && s.controlName ? <>{` | Control: ${s.controlName} (Score: ${s.score})`}</> : null}
      {s.type === 'plan_output' && s.controlId ? <>{` | Control: ${s.controlId} (${s.status})`}</> : null}
    </>
  );
}

export function EntryEditor({ tenant, entryId, onDone, onClose }: { tenant: string; entryId: string; onDone: () => Promise<void>; onClose: () => void }) {
  const q = useQuery({ queryKey: ['risk-entry', tenant, entryId], queryFn: () => eoApi.riskEntry(tenant, entryId), retry: false });
  if (q.isLoading) return <p className="eo-muted">Loading entry...</p>;
  if (q.isError || !q.data) return <Notice kind="error">The risk entry could not be loaded.</Notice>;
  return <EntryForm key={q.data.id} tenant={tenant} entry={q.data} onDone={onDone} onClose={onClose} />;
}

function EntryForm({ tenant, entry, onDone, onClose }: { tenant: string; entry: RiskEntry; onDone: () => Promise<void>; onClose: () => void }) {
  const [likelihood, setLikelihood] = useState(entry.likelihood ?? '');
  const [impact, setImpact] = useState(entry.impact ?? '');
  const [rec, setRec] = useState(entry.treatmentRecommendation ?? 'mitigate');
  const [status, setStatus] = useState(entry.treatmentStatus ?? 'recommended');
  const [ref, setRef] = useState(entry.treatmentReference ?? '');
  const [notes, setNotes] = useState(entry.notes ?? '');
  const save = useAction();
  const composite = compositeRisk(likelihood || undefined, impact || undefined);
  const doSave = (treatmentStatus: string) => void save.run(async () => {
    setStatus(treatmentStatus);
    const r = await eoApi.saveRiskEntry(tenant, entry.id, {
      likelihood: likelihood || undefined, impact: impact || undefined, compositeRisk: composite,
      treatmentRecommendation: rec, treatmentStatus, treatmentReference: ref || undefined, notes: notes || undefined,
      lastReviewed: new Date().toISOString(),
    });
    await onDone();
    return r;
  }, () => 'Saved.');
  return (
    <Card title={entry.threatEvent ?? 'Risk entry'} id="riskEntryEditor"
      actions={<button type="button" className="btn btn-ghost btn-small" id="riskEntryClose" onClick={onClose}>Close</button>}>
      <dl className="eo-dl">
        <div className="eo-dl-row"><dt>Threat source</dt><dd>{pretty(entry.threatSource)}</dd></div>
        <div className="eo-dl-row"><dt>Threat event</dt><dd>{entry.threatEvent ?? '—'}</dd></div>
        <div className="eo-dl-row"><dt>Vulnerability</dt><dd>{entry.vulnerability?.description ?? '—'}</dd></div>
        <div className="eo-dl-row"><dt>Affected assets</dt><dd>{(entry.affectedAssets ?? []).join(', ') || 'None specified'}</dd></div>
        <div className="eo-dl-row"><dt>Affected operations</dt><dd>{(entry.affectedOperations ?? []).join(', ') || 'None specified'}</dd></div>
      </dl>
      <div className="eo-grid-2">
        <Field label="Likelihood">
          <select id="riskLikelihood" value={likelihood} onChange={(e) => setLikelihood(e.target.value)}>
            <option value="">— Not scored —</option>{LEVELS.map((l) => <option key={l} value={l}>{pretty(l)}</option>)}
          </select>
        </Field>
        <Field label="Impact">
          <select id="riskImpact" value={impact} onChange={(e) => setImpact(e.target.value)}>
            <option value="">— Not scored —</option>{LEVELS.map((l) => <option key={l} value={l}>{pretty(l)}</option>)}
          </select>
        </Field>
        <Field label="Treatment recommendation">
          <select id="riskTreatmentRec" value={rec} onChange={(e) => setRec(e.target.value)}>
            {[...new Set([rec, ...RECOMMENDATION])].map((t) => <option key={t} value={t}>{pretty(t)}</option>)}
          </select>
        </Field>
        <Field label="Treatment status">
          <select id="riskTreatmentStatus" value={status} onChange={(e) => setStatus(e.target.value)}>
            {[...new Set([status, ...TREATMENT])].map((t) => <option key={t} value={t}>{pretty(t)}</option>)}
          </select>
        </Field>
        <Field label="Treatment reference"><input id="riskTreatmentRef" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="POA&M item ID or procedure reference" /></Field>
        <Field label="Notes"><textarea id="riskNotes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      <p id="riskComposite">{`Composite risk: ${composite ? pretty(composite) : 'needs scoring'}`}</p>
      <p className="eo-muted"><SourceDetail e={entry} /></p>
      <p className="eo-muted">{`First identified: ${day(entry.firstIdentified)} | Last reviewed: ${day(entry.lastReviewed)} | Next review: ${day(entry.nextReviewDue)}`}</p>
      <div className="eo-row">
        <button type="button" className="btn btn-primary btn-small" id="riskSaveBtn" disabled={save.busy} onClick={() => doSave(status)}>Save</button>
        <button type="button" className="btn btn-secondary btn-small" id="riskMitigatedBtn" disabled={save.busy} onClick={() => doSave('mitigated')}>Mark mitigated</button>
        <button type="button" className="btn btn-secondary btn-small" id="riskAcceptedBtn" disabled={save.busy} onClick={() => doSave('accepted_residual')}>Mark accepted</button>
        <ConfirmButton label="Delete" ariaLabel="Delete this risk entry" id="riskDeleteBtn" disabled={save.busy}
          onConfirm={() => void save.run(async () => { await eoApi.deleteRiskEntry(tenant, entry.id); await onDone(); onClose(); })} />
      </div>
      {save.message ? <Notice kind={save.message.kind}>{save.message.text}</Notice> : null}
    </Card>
  );
}

function IngestionReportView({ r }: { r: IngestionReport }) {
  return (
    <div id="riskIngestionStatus">
      <p><strong>Ingestion complete</strong>{` (${new Date(r.timestamp).toLocaleString()}) — new: ${r.totalNew} | updated: ${r.totalUpdated} | errors: ${r.totalErrors}`}</p>
      {r.results?.length ? <ul className="eo-list">{r.results.map((x) => <li key={x.source}>{`${pretty(x.source)}: +${x.new} new, ${x.updated} updated, ${x.skipped} skipped${x.errors?.length ? ` (${x.errors.length} errors)` : ''}`}</li>)}</ul> : null}
    </div>
  );
}

function Chips({ title, chips, active, onToggle }: { title: string; chips: Array<[string, string]>; active: string[]; onToggle: (v: string) => void }) {
  return (
    <div className="eo-row" role="group" aria-label={`Filter by ${title.toLowerCase()}`}>
      <span className="eo-field-label">{title}</span>
      {chips.map(([v, l]) => <button key={v} type="button" className="eo-chip" aria-pressed={active.includes(v)} onClick={() => onToggle(v)}>{l}</button>)}
    </div>
  );
}

export function CurrentTab({ tenant, register }: { tenant: string; register: RiskRegister | undefined }) {
  const qc = useQueryClient();
  const runs = useQuery({ queryKey: ['ingestion-runs', tenant], queryFn: () => eoApi.ingestionRuns(tenant), retry: false });
  const [filters, setFilters] = useState<RiskFilters>(NO_FILTERS);
  const [sortKey, setSortKey] = useState<SortKey>('compositeRisk');
  const [asc, setAsc] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [wizard, setWizard] = useState(false);
  const [report, setReport] = useState<IngestionReport | null>(null);
  const ingest = useAction();
  const entries = register?.entries ?? [];
  const rows = filterAndSort(entries, filters, sortKey, asc);
  const summary = summarize(entries);
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['risk-register', tenant] });
    await qc.invalidateQueries({ queryKey: ['risk-entry', tenant] });
    await qc.invalidateQueries({ queryKey: ['ingestion-runs', tenant] });
    await qc.invalidateQueries({ queryKey: ['risk-snapshots', tenant] });
  };
  const toggle = (k: 'source' | 'risk' | 'treatment') => (v: string) =>
    setFilters((f) => ({ ...f, [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] }));
  const sortBy = (k: SortKey) => { if (k === sortKey) setAsc(!asc); else { setSortKey(k); setAsc(true); } };
  const daysToDue = register?.nextReviewDue ? Math.floor((new Date(register.nextReviewDue).getTime() - Date.now()) / 86_400_000) : null;

  return (
    <>
      <Card title="Current assessment" id="eo-risk-current">
        <div className="eo-row">
          <button type="button" className="btn btn-primary btn-small" id="riskIngestBtn" disabled={ingest.busy}
            onClick={() => void ingest.run(async () => { const r = await eoApi.ingest(tenant); setReport(r); await refresh(); return r; })}>
            {ingest.busy ? 'Ingesting...' : 'Run ingestion'}
          </button>
          <button type="button" className="btn btn-secondary btn-small" id="beginAnnualReviewBtn" aria-pressed={wizard} onClick={() => setWizard((x) => !x)}>
            {wizard ? 'Hide annual review' : 'Begin annual review'}
          </button>
          {daysToDue !== null && daysToDue > 30 ? <span className="eo-muted">{`Next review due in ${daysToDue} days.`}</span> : null}
        </div>
        <OneClickReview tenant={tenant} onDone={refresh} />
        {ingest.message ? <Notice kind={ingest.message.kind}>{`Ingestion failed: ${ingest.message.text}`}</Notice> : null}
        {report ? <IngestionReportView r={report} /> : null}
        <details className="eo-details" id="ingestionRunHistory">
          <summary>Ingestion run history</summary>
          {(runs.data ?? []).length === 0 ? <p className="eo-muted">No ingestion runs recorded yet.</p> : (
            <div className="eo-table-wrap">
              <table className="eo-table">
                <thead><tr><th scope="col">Date</th><th scope="col">New</th><th scope="col">Updated</th><th scope="col">Errors</th><th scope="col">Trigger</th></tr></thead>
                <tbody>{(runs.data ?? []).map((r, i) => <tr key={`${r.timestamp}-${i}`}><td>{new Date(r.timestamp).toLocaleString()}</td><td>{r.totalNew}</td><td>{r.totalUpdated}</td><td>{r.totalErrors}</td><td>{r.trigger ?? 'manual'}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </details>
      </Card>

      {wizard ? <AnnualReview tenant={tenant} entries={entries} onClose={() => setWizard(false)} onDone={refresh} /> : null}

      <Card title="Risk register" id="eo-risk-card">
        <Chips title="Source" chips={SOURCE_CHIPS} active={filters.source} onToggle={toggle('source')} />
        <Chips title="Risk" chips={RISK_CHIPS} active={filters.risk} onToggle={toggle('risk')} />
        <Chips title="Treatment" chips={TREAT_CHIPS} active={filters.treatment} onToggle={toggle('treatment')} />
        <div className="eo-row">
          <button type="button" className="eo-chip" aria-pressed={filters.needsScoring} onClick={() => setFilters((f) => ({ ...f, needsScoring: !f.needsScoring }))}>Needs scoring</button>
        </div>
        <div className="eo-table-wrap">
          <table className="eo-table" id="riskRegisterTable">
            <thead>
              <tr>
                {COLUMNS.map(([k, l]) => (
                  <th key={k} scope="col" aria-sort={k === sortKey ? (asc ? 'ascending' : 'descending') : 'none'}>
                    <button type="button" className="eo-linkbtn" onClick={() => sortBy(k)}>{l}</button>
                  </th>
                ))}
                <th scope="col">Edit</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? <tr><td colSpan={9}>No risk entries yet. Run ingestion or add entries manually.</td></tr> : rows.map((e) => (
                <tr key={e.id} data-entry={e.id}>
                  <td>{e.threatEvent ?? '—'}</td>
                  <td>{(e.vulnerability?.description ?? '—').slice(0, 80)}</td>
                  <td>{pretty(e.likelihood)}</td>
                  <td>{pretty(e.impact)}</td>
                  <td>{e.compositeRisk ? pretty(e.compositeRisk) : 'Needs scoring'}</td>
                  <td>{pretty(e.treatmentStatus)}</td>
                  <td>{day(e.lastReviewed)}</td>
                  <td>{sourceText(e.source)}</td>
                  <td><button type="button" className="btn btn-secondary btn-small" aria-label={`Edit ${e.threatEvent ?? e.id}`} onClick={() => setSelected(e.id)}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {selected ? <EntryEditor tenant={tenant} entryId={selected} onDone={refresh} onClose={() => setSelected(null)} /> : null}

      <div className="eo-columns" id="riskSummaryPanel">
        <Card title="By risk level" id="riskSummaryByLevel">
          <ul className="eo-list">{Object.entries(summary.byLevel).map(([k, v]) => <li key={k} className="eo-row"><span>{pretty(k)}</span><strong>{v}</strong></li>)}</ul>
        </Card>
        <Card title="Top 5 highest risk" id="riskSummaryTop5">
          {summary.top5.length === 0 ? <p className="eo-muted">No scored entries</p> : (
            <ul className="eo-list">{summary.top5.map((e) => <li key={e.id} className="eo-row"><span>{(e.threatEvent ?? '—').slice(0, 30)}</span><strong>{pretty(e.compositeRisk)}</strong></li>)}</ul>
          )}
        </Card>
        <Card title="By source" id="riskSummaryBySource">
          {Object.keys(summary.bySource).length === 0 ? <p className="eo-muted">No entries</p> : (
            <ul className="eo-list">{Object.entries(summary.bySource).map(([k, v]) => <li key={k} className="eo-row"><span>{pretty(k)}</span><strong>{v}</strong></li>)}</ul>
          )}
        </Card>
      </div>
    </>
  );
}
