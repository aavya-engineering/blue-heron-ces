// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W8-SPA2: Translate (legacy card 3, index.html L4454-4485), the dev quick run (L4625-4631,
// shown for the `dev` tenant only) and the right column. The quick run is mounted by the shell
// (App.tsx), outside the cards as in legacy, so `dev` reaches it while card 3 is locked (W8-SPA4).
//
// The demo driver finds the Translate button by `button[onclick="doTranslate()"]` (the legacy
// button has no id). The SPA keeps that attribute (set through a ref; React does not render
// string handlers). An inline handler looks names up on the element first, so the button
// carries a no-op `doTranslate` of its own and no global is defined; React's onClick does the
// work.

import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../../api';
import { useWorkflowStore } from '../../store/workflow';
import { translateToggleDisabled, useTranslateStore } from '../../store/translate';
import { doTranslate, doTranslateAndExecute, useExecuteStore, watchTenant } from '../../store/execute';
import { ConsolePanel } from '../console/ConsolePanel';
import { WorkflowCard } from '../execute/WorkflowCard';

watchTenant();


const TIP =
  'Translates the CES Mission Plan + Tenant Manifest into an Executable Plan. Resolves registry commands, substitutes ' +
  'variables, orders steps into dependency layers, and writes the EP JSON to plan-data/<tenant>/plans/.';

/** Keeps the legacy selector attribute on a React-rendered button, with a no-op for its inline handler. */
function legacyOnclick(el: HTMLButtonElement | null) {
  if (!el) return;
  (el as HTMLButtonElement & { doTranslate?: () => void }).doTranslate = () => undefined;
  el.setAttribute('onclick', 'doTranslate()');
}

function PlanInputSummary() {
  const t = useTranslateStore();
  const rows: Array<[string, string]> = [
    ['Mission Plan', t.missionPlan],
    ['Tenant Manifest', t.manifest],
    ['Infrastructure Manifest', t.infraManifest],
  ];
  return (
    <dl className="spa-plan-inputs">
      {rows.map(([label, value]) => (
        <div key={label} className="spa-plan-input">
          <dt>{label}</dt>
          <dd title={value}>{value || '(not set)'}</dd>
        </div>
      ))}
    </dl>
  );
}

// FIN-16 (COST-GATE-SPEC §3.4): DP-1, the plan-time opt-in to a recurring cost. Every recurring
// catalogue entry is listed UNTICKED with its monthly estimate, basis, price date and free
// alternative (GET /api/cost-gate/items). Ticking one asks the operator to type the entry id and
// their name; POST /api/cost-gate/ack records cost-acks.json and a dp:1 evidence record. An
// opt-in takes effect at the next translate (translation drops un-acked recurring entries), and
// DP-2 is still typed at run time (the execute screen's dialog). Not shown for `dev` (dry run).

/** One row of GET /api/cost-gate/items. */
export interface CostGateItem {
  entry_id: string;
  label: string;
  kind?: string;
  control_ids?: string[];
  estimate?: string;
  estimate_basis?: string;
  price_date?: string;
  standard_alternative?: string[];
  last_resort?: boolean;
  acked: boolean;
  acked_at?: string;
  operator?: string;
  unavailable?: string;
}

interface CostGateItemsReply {
  tenant: string;
  price_date: string;
  items: CostGateItem[];
}

function errorMessage(err: unknown): string {
  const payload = (err as { payload?: { error?: string } } | null)?.payload;
  if (payload && typeof payload.error === 'string') return payload.error;
  return err instanceof Error ? err.message : String(err);
}

function CostOptInForm({
  item,
  tenant,
  onDone,
  onCancel,
}: {
  item: CostGateItem;
  tenant: string;
  onDone: (msg: string) => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [operator, setOperator] = useState('');
  const [noOtherMeans, setNoOtherMeans] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const idBase = `costAck_${item.entry_id.replace(/[^A-Za-z0-9_-]/g, '_')}`;
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await apiRequest('POST', '/api/cost-gate/ack', {
        body: { tenant, entryId: item.entry_id, typed, operator, ...(item.last_resort ? { noOtherMeans } : {}) },
      });
      onDone(`DP-1 recorded for ${item.entry_id}. Translate again to include it in the plan; DP-2 is still typed at run time.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="spa-cost-ack-form" role="group" aria-label={`Opt in to ${item.entry_id}`} data-cost-ack-form={item.entry_id}>
      <p className="spa-small">
        This starts a recurring cost of about <b>{item.estimate}</b> a month. To opt in, type the entry id <code>{item.entry_id}</code>.
      </p>
      <label htmlFor={`${idBase}_typed`}>Type the entry id</label>
      <input id={`${idBase}_typed`} className="spa-input" value={typed} autoComplete="off" onChange={(e) => setTyped(e.target.value)} />
      <label htmlFor={`${idBase}_operator`}>Your name or ID</label>
      <input id={`${idBase}_operator`} className="spa-input" value={operator} autoComplete="off" onChange={(e) => setOperator(e.target.value)} />
      {item.last_resort ? (
        <>
          <label htmlFor={`${idBase}_nom`}>Why no other means will do (last resort)</label>
          <textarea id={`${idBase}_nom`} className="spa-input" value={noOtherMeans} onChange={(e) => setNoOtherMeans(e.target.value)} />
        </>
      ) : null}
      {error ? (
        <div className="status-error spa-small" role="alert">
          {error}
        </div>
      ) : null}
      <div className="btn-row">
        <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={() => void submit()}>
          Confirm opt-in (DP-1)
        </button>
        <button type="button" className="btn btn-secondary btn-small" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** The DP-1 list on card 3 (non-dev tenants only). */
export function CostOptInList() {
  const tenant = useWorkflowStore((s) => s.tenant);
  const [reply, setReply] = useState<CostGateItemsReply | null>(null);
  const [error, setError] = useState('');
  const [opening, setOpening] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    if (!tenant || tenant === 'dev') return;
    try {
      setReply(await apiRequest<CostGateItemsReply>('GET', '/api/cost-gate/items', { query: { tenant } }));
      setError('');
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [tenant]);
  useEffect(() => {
    setReply(null);
    setOpening(null);
    setNotice('');
    void load();
  }, [load]);
  if (!tenant || tenant === 'dev') return null;
  const items = Array.isArray(reply?.items) ? reply.items : [];
  const acked = items.filter((i) => i.acked).length;
  return (
    <details id="costOptInList" className="spa-cost-optin">
      <summary>
        Recurring costs: off by default ({acked} of {items.length} opted in{reply?.price_date ? `; price date ${reply.price_date}` : ''})
      </summary>
      {error ? (
        <div className="status-error spa-small" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="spa-small" role="status" id="costOptInNotice">
          {notice}
        </div>
      ) : null}
      <ul className="spa-cost-items">
        {items.map((i) => {
          const boxId = `costItem_${i.entry_id.replace(/[^A-Za-z0-9_-]/g, '_')}`;
          return (
            <li key={i.entry_id} data-cost-entry={i.entry_id}>
              <input
                type="checkbox"
                id={boxId}
                checked={i.acked || opening === i.entry_id}
                disabled={i.acked || Boolean(i.unavailable)}
                onChange={(e) => setOpening(e.target.checked ? i.entry_id : null)}
              />{' '}
              <label htmlFor={boxId}>
                <b>{i.entry_id}</b> {i.label}
                {i.unavailable ? (
                  <span className="spa-muted"> ({i.unavailable})</span>
                ) : (
                  <span className="spa-cost-price">
                    {' '}
                    about {i.estimate} a month ({i.estimate_basis}; price date {i.price_date})
                    {i.standard_alternative && i.standard_alternative.length > 0 ? `; free alternative: ${i.standard_alternative.join(', ')}` : ''}
                    {i.acked ? ` (opted in${i.operator ? ` by ${i.operator}` : ''})` : ''}
                  </span>
                )}
              </label>
              {opening === i.entry_id ? (
                <CostOptInForm
                  item={i}
                  tenant={tenant}
                  onCancel={() => setOpening(null)}
                  onDone={(msg) => {
                    setOpening(null);
                    setNotice(msg);
                    void load();
                  }}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

export function TranslateCard() {
  const t = useTranslateStore();
  const locked = useWorkflowStore((s) => s.steps.translate === 'locked');
  const disabled = translateToggleDisabled(t);
  return (
    <WorkflowCard step={3} title="Translate" badge={t.badge} locked={locked} tip={TIP}>
      <PlanInputSummary />
      <label htmlFor="outputPath">Executable Plan</label>
      <div className="path-input-row">
        <input
          type="text"
          id="outputPath"
          className="spa-input"
          placeholder="(auto-generated when you click Translate)"
          readOnly
          value={t.outputPath}
          title={t.outputPath}
        />
      </div>
      <div className="spa-toggles">
        <label className="verbose-toggle">
          <input
            type="checkbox"
            id="gapsOnlyToggle"
            checked={t.gapsOnly}
            disabled={disabled.gapsOnly}
            onChange={(e) => t.setGapsOnly(e.target.checked)}
          />{' '}
          Gaps Only
        </label>
        <label className="verbose-toggle">
          <input
            type="checkbox"
            id="automatedOnlyToggle"
            checked={t.automatedOnly}
            disabled={disabled.automatedOnly}
            onChange={(e) => t.setAutomatedOnly(e.target.checked)}
          />{' '}
          Automated Only
        </label>
      </div>
      <CostOptInList />
      <div className="btn-row spa-btn-row">
        <button type="button" className="btn btn-primary btn-full" ref={legacyOnclick} disabled={locked} onClick={() => void doTranslate()}>
          Translate Plan
        </button>
      </div>
    </WorkflowCard>
  );
}

export function DevQuickRun() {
  const tenant = useWorkflowStore((s) => s.tenant);
  const quick = useExecuteStore((s) => s.quick);
  if (tenant !== 'dev') return null;
  return (
    <div id="devQuickRunWrap" className="spa-dev-quick" role="group" aria-label="Dev quick run">
      <div className="dev-quick-row">
        <button
          type="button"
          className="btn btn-primary"
          id="btnQuickExecAuto"
          disabled={quick.auto.busy}
          onClick={() => void doTranslateAndExecute('auto')}
        >
          {quick.auto.label}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          id="btnQuickExecManual"
          disabled={quick.manual.busy}
          onClick={() => void doTranslateAndExecute('manual')}
        >
          {quick.manual.label}
        </button>
      </div>
    </div>
  );
}

export default function TranslateScreen() {
  return (
    <section className="spa-screen spa-run-screen" data-screen="translate" aria-labelledby="screen-title-card3">
      <div className="spa-run-left">
        <TranslateCard />
      </div>
      <ConsolePanel />
    </section>
  );
}
