// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-31b: Evidence Explorer (legacy loadEvidenceIndex / renderEvidenceTree / filterEvidenceTree /
// selectEvidenceItem / renderStructuredEvidence / renderBlobSignalEvidence / fetchLiveSignal /
// verifyEvidenceIntegrity). Read-only: the index, one item, a SHA-256 re-check, and a live signal
// read through this tenant's Graph session. The connection state comes from the index route (this
// tenant's own session), so a signal item is offered only when EO says this tenant is connected.

import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { JsonView } from 'ces-ui-kit';
import { eoApi } from '../../api/eo';
import type { EvidenceIndexItem, EvidenceItemContent, EvidenceVerifyResult, LiveSignalResult } from '../../api/types';
import { Card, Notice, TenantRequired, errorText } from '../../components/common';

/** Sources verify supports (evidence-router.ts GET /api/evidence-explorer/verify). */
const VERIFIABLE = new Set(['stamper', 'blob']);

/** Legacy filterEvidenceTree: source chips (none = all) and a title / control-id search. */
export function filterItems(items: EvidenceIndexItem[], sources: string[], search: string): EvidenceIndexItem[] {
  const q = search.trim().toLowerCase();
  return items.filter((i) => {
    if (sources.length && !sources.includes(i.source)) return false;
    if (q && !`${i.title} ${(i.controlIds ?? []).join(' ')}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

function Fields({ title, rows }: { title: string; rows: Array<[string, ReactNode | undefined | null]> }) {
  const shown = rows.filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (!shown.length) return null;
  return (
    <section className="eo-ev-section" aria-label={title}>
      <h3 className="eo-ev-title">{title}</h3>
      <dl className="eo-dl">{shown.map(([k, v]) => <div key={k} className="eo-dl-row"><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
    </section>
  );
}

const code = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : <code className="eo-mono">{String(v)}</code>);
const local = (v: unknown) => { if (typeof v !== 'string' || !v) return undefined; const d = new Date(v); return isNaN(d.getTime()) ? undefined : d.toLocaleString(); };

/** Legacy renderStructuredEvidence: a Stamper evidence file (verdict, metadata, registry entry, verification). */
function StructuredEvidence({ ev, size }: { ev: Record<string, any>; size?: number }) {
  const m = ev.metadata ?? {};
  const r = ev.registryEntry ?? {};
  const v = ev.verificationResult;
  return (
    <>
      <p className="eo-row">
        <span className={ev.complianceVerdict === 'SAT' ? 'badge badge-compliant' : 'badge badge-violation'} id="evidenceVerdict">{String(ev.complianceVerdict)}</span>
        <span>{ev.outcome ?? ''}</span>
      </p>
      <Fields title="Rationale" rows={[['Verdict rationale', ev.verdictRationale], ['Outcome rationale', ev.outcomeRationale]]} />
      <Fields title="Metadata" rows={[
        ['Controls', Array.isArray(m.controlIds) ? m.controlIds.join(', ') : undefined], ['Timestamp (UTC)', m.timestamp], ['Local time', local(m.timestamp)],
        ['SHA-256', code(m.sha256Hash)], ['Executor', m.executorIdentity], ['Environment', m.environment], ['Command', code(m.commandExecuted)],
        ['Module versions', typeof m.moduleVersions === 'string' ? m.moduleVersions : m.moduleVersions ? JSON.stringify(m.moduleVersions) : undefined],
        ['State changed', m.stateChanged === undefined ? undefined : String(m.stateChanged)], ['File size', size ? `${size.toLocaleString()} bytes` : undefined],
      ]} />
      <Fields title="Registry entry" rows={[
        ['Label', r.label], ['Entry ID', code(r.entry_id)], ['Engine', r.engine], ['Control IDs', Array.isArray(r.control_ids) ? r.control_ids.join(', ') : undefined],
        ['Layer', r.layer_hint], ['Idempotency', r.idempotency], ['On failure', r.on_failure], ['Get command', code(r.get_command)], ['Set command', code(r.set_command)],
        ['Evidence commands', Array.isArray(r.evidence_commands) && r.evidence_commands.length ? code(r.evidence_commands.join('\n')) : undefined],
        ['Manual only', r.manual_only ? 'Yes' : undefined], ['Notes', r.notes], ['Attestation category', r.attestation_category],
      ]} />
      {v ? <Fields title="Verification" rows={[
        ['Passed', String(v.passed)], ['Confidence', v.confidence], ['Score', v.score === undefined ? undefined : String(v.score)], ['Reason', v.reason],
        ['Details', Array.isArray(v.details) && v.details.length ? <ul>{v.details.map((d: string, i: number) => <li key={i}>{d}</li>)}</ul> : undefined],
      ]} /> : null}
      {ev.rawResponse ? <details className="eo-details"><summary>Raw response</summary><pre className="eo-pre">{String(ev.rawResponse)}</pre></details> : null}
      {m.preStateOutput || m.postStateOutput ? (
        <details className="eo-details"><summary>State comparison</summary>
          <div className="eo-grid-2">
            <div><strong>Pre-state</strong><pre className="eo-pre">{m.preStateOutput || '—'}</pre></div>
            <div><strong>Post-state</strong><pre className="eo-pre">{m.postStateOutput || '—'}</pre></div>
          </div>
        </details>
      ) : null}
    </>
  );
}

/** Legacy renderBlobSignalEvidence: a captured signal blob. */
function SignalBlobEvidence({ ev, size }: { ev: Record<string, any>; size?: number }) {
  return (
    <>
      <p className="eo-row"><span className="badge badge-review">Signal evidence</span><span className="eo-mono">{ev.signalId}</span></p>
      <Fields title="Signal details" rows={[
        ['Control', ev.controlId], ['Signal ID', ev.signalId], ['Source', ev.source], ['Endpoint', code(ev.endpoint)], ['Captured (UTC)', ev.capturedAt],
        ['Local time', local(ev.capturedAt)], ['SHA-256', code(ev.sha256)], ['Artifact ID', code(ev.artifactId)], ['File size', size ? `${size.toLocaleString()} bytes` : undefined],
      ]} />
      {ev.rawValue !== undefined && ev.rawValue !== null ? <section aria-label="Response"><h3 className="eo-ev-title">Response</h3><JsonView value={ev.rawValue} /></section> : null}
    </>
  );
}

function ItemContent({ item, data }: { item: EvidenceIndexItem; data: EvidenceItemContent }) {
  const c = data.content as Record<string, any> | null;
  if (c && typeof c === 'object' && c.complianceVerdict && c.metadata && c.registryEntry) return <StructuredEvidence ev={c} size={data.metadata?.size} />;
  if (c && typeof c === 'object' && c.signalId && c.rawValue !== undefined) return <SignalBlobEvidence ev={c} size={data.metadata?.size} />;
  let value: unknown = data.content;
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { /* text */ } }
  return (
    <>
      <Fields title="Item" rows={[
        ['Title', item.title], ['Controls', item.controlIds?.length ? item.controlIds.join(', ') : undefined], ['SHA-256', code(data.metadata?.sha256)],
        ['Timestamp', data.metadata?.timestamp], ['Local time', local(data.metadata?.timestamp)], ['Size', data.metadata?.size ? `${data.metadata.size.toLocaleString()} bytes` : undefined],
      ]} />
      {typeof value === 'string' ? <pre className="eo-pre">{value}</pre> : <JsonView value={value} id="evidenceJson" />}
    </>
  );
}

function ExplorerBody({ tenant }: { tenant: string }) {
  const index = useQuery({ queryKey: ['evidence-index', tenant], queryFn: () => eoApi.evidenceIndex(tenant), retry: false });
  const [search, setSearch] = useState('');
  const [sources, setSources] = useState<string[]>([]);
  const [selected, setSelected] = useState<EvidenceIndexItem | null>(null);
  const [view, setView] = useState<{ kind: 'item'; data: EvidenceItemContent } | { kind: 'signal'; data: LiveSignalResult } | { kind: 'error'; text: string } | { kind: 'loading' } | null>(null);
  const [verify, setVerify] = useState<{ state: 'busy' } | { state: 'done'; r: EvidenceVerifyResult } | { state: 'error'; text: string } | null>(null);

  const items = index.data?.items ?? [];
  const connected = index.data?.connectionState === 'connected';
  const allSources = useMemo(() => {
    const base = ['stamper', 'blob', 'signal', 'local'];
    for (const i of items) if (!base.includes(i.source)) base.push(i.source);
    return base;
  }, [items]);
  const shown = filterItems(items, sources, search);

  const open = async (item: EvidenceIndexItem) => {
    setSelected(item);
    setVerify(null);
    if (item.requiresConnection && !connected) {
      setView({ kind: 'error', text: 'This item needs a live tenant connection. Use Connect (optional) on the Tenant and access screen, then refresh the index.' });
      return;
    }
    setView({ kind: 'loading' });
    try {
      if (item.source === 'signal') setView({ kind: 'signal', data: await eoApi.liveSignal(tenant, item.path ?? '') });
      else setView({ kind: 'item', data: await eoApi.evidenceItem(tenant, item.source, item.path ?? '') });
    } catch (e) {
      setView({ kind: 'error', text: errorText(e) });
    }
  };

  const runVerify = async (item: EvidenceIndexItem) => {
    setVerify({ state: 'busy' });
    try { setVerify({ state: 'done', r: await eoApi.verifyEvidence(tenant, item.source, item.path ?? '') }); } catch (e) { setVerify({ state: 'error', text: errorText(e) }); }
  };

  return (
    <>
      <Notice kind={connected ? 'success' : 'warn'} id="evidenceConnectionBanner">
        {connected ? 'Connected: blob artifacts and live signal data are available.' : 'Local-only mode: connect the tenant (Tenant and access screen) for live signal data.'}
      </Notice>
      <Card title="Evidence index" id="eo-evidence-filter"
        actions={<button type="button" className="btn btn-primary btn-small" id="evidenceRefresh" onClick={() => void index.refetch()}>Refresh index</button>}>
        <div className="eo-row">
          <label className="eo-field eo-grow">
            <span className="eo-field-label">Search by title or control ID</span>
            <input id="evidenceSearchInput" type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
        </div>
        <div className="eo-row" role="group" aria-label="Filter by source">
          {allSources.map((src) => (
            <button key={src} type="button" className="eo-chip" aria-pressed={sources.includes(src)} data-source={src}
              onClick={() => setSources((x) => (x.includes(src) ? x.filter((y) => y !== src) : [...x, src]))}>
              {src}
            </button>
          ))}
        </div>
        {index.isError ? <Notice kind="error">{`Index failed: ${errorText(index.error)}`}</Notice> : null}
      </Card>
      <div className="eo-columns">
        <Card title={`Evidence items (${shown.length})`} id="eo-evidence-tree">
          {index.isLoading ? <p className="eo-muted">Loading...</p> : shown.length === 0 ? <p className="eo-muted">No items found.</p> : (
            <ul className="eo-tree" id="evidenceTree">
              {shown.map((i) => (
                <li key={i.id}>
                  <button type="button" className="eo-tree-item" aria-current={selected?.id === i.id ? 'true' : undefined} data-id={i.id} onClick={() => void open(i)}>
                    <span className={`eo-src eo-src-${i.source}`}>{i.source}</span>
                    <span>{i.title}</span>
                    {i.verdict === 'SAT' ? <span className="badge badge-compliant">SAT</span> : i.verdict === 'NOT_SAT' ? <span className="badge badge-violation">NOT SAT</span> : null}
                    {i.requiresConnection && !connected ? <span className="eo-muted">(needs connection)</span> : null}
                    {i.controlIds?.length ? <span className="eo-muted eo-mono">{i.controlIds.join(', ')}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Content viewer" id="eo-evidence-viewer"
          actions={selected && VERIFIABLE.has(selected.source) && view?.kind === 'item' ? (
            <button type="button" className="btn btn-secondary btn-small" id="evidenceVerifyBtn" disabled={verify?.state === 'busy'} onClick={() => void runVerify(selected)}>Verify SHA-256</button>
          ) : undefined}>
          {verify?.state === 'busy' ? <Notice>Verifying...</Notice> : null}
          {verify?.state === 'done' ? <Notice kind={verify.r.verified ? 'success' : 'error'} id="evidenceVerifyBadge">{verify.r.verified ? 'VERIFIED: the recomputed SHA-256 matches.' : 'MISMATCH: the recomputed SHA-256 does not match.'}</Notice> : null}
          {verify?.state === 'error' ? <Notice kind="error">{`Verify failed: ${verify.text}`}</Notice> : null}
          {!selected ? <p className="eo-muted">Select an item to view its content.</p> : null}
          {view?.kind === 'loading' ? <p className="eo-muted">Loading...</p> : null}
          {view?.kind === 'error' ? <Notice kind="error">{view.text}</Notice> : null}
          {selected && view?.kind === 'item' ? <ItemContent item={selected} data={view.data} /> : null}
          {selected && view?.kind === 'signal' ? (
            <>
              <p className="eo-muted">{`Signal ${selected.path ?? ''}, fetched ${view.data.timestamp}, ${view.data.signalResults?.length ?? 0} result(s).`}</p>
              <JsonView value={view.data.signalResults} id="evidenceSignalJson" />
            </>
          ) : null}
        </Card>
      </div>
    </>
  );
}

export default function EvidenceExplorerScreen() {
  return <div className="eo-screen"><TenantRequired>{(t) => <ExplorerBody tenant={t} />}</TenantRequired></div>;
}
