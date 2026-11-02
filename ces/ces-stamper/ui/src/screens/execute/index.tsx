// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W8-SPA2: Execute (legacy card 4, index.html L4487-4597) and the right column. Demo driver
// ids kept: #workflowCard4, #cardStatus4, #execModeSelect, #execTargetSelect,
// #btnExecuteMatrix, #btnHalt (STAMPER_SELECTORS.executeHalt; a plain button shown while a
// run is open, since approval cards exist only in Incremental and Batch modes).

import { useEffect, useState } from 'react';
import { apiRequest } from '../../api';
import { useConsoleStore } from '../../store/console';
import { useWorkflowStore } from '../../store/workflow';
import { GRID_GROUPS, GRID_ROWS, gridActionCell, gridStepCell } from '../../store/console-events';
import type { GridRow } from '../../store/console-events';
import {
  EXEC_MODES,
  EXEC_TARGETS,
  executeFromMatrix,
  executeRetry,
  haltExecution,
  tryUnlockExecuteFromEP,
  useExecuteStore,
  watchTenant,
} from '../../store/execute';
import type { ExecMode, ExecTarget } from '../../store/execute';
import { ConsolePanel } from '../console/ConsolePanel';
import { WorkflowCard } from './WorkflowCard';

watchTenant();

const ROW_LABELS: Record<GridRow, string> = { pass: 'Pass', fail: 'Fail', excluded: 'Excluded', nonstack: 'Non-Stack' };
const GROUP_LABELS = { l03: 'L0-3', l47: 'L4-7', l8: 'L8' } as const;

const TIP =
  'Runs the Executable Plan against the tenant in the selected mode. Incremental pauses after each sub-command for approval. ' +
  'Batch pauses at layer boundaries. Automatic runs everything without stopping. Each sub-command can be approved, marked ' +
  'accomplished, or skipped. Evidence and captures are collected in real time.';

function ProgressGrid() {
  const grid = useConsoleStore((s) => s.grid);
  if (!grid.visible) return null;
  return (
    <div id="execProgressSection" className="spa-exec-progress">
      <table className="exec-progress-grid spa-grid">
        <caption className="spa-visually-hidden">Execution progress by layer</caption>
        <thead>
          <tr>
            <td />
            {GRID_GROUPS.map((g) => (
              <th key={g} scope="col" className="exec-grid-header">
                {GROUP_LABELS[g]}
              </th>
            ))}
            <th scope="col" className="exec-grid-header">
              Steps
            </th>
            <th scope="col" className="exec-grid-header">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {GRID_ROWS.map((row) => (
            <tr key={row} className={`exec-row-${row}`}>
              <th scope="row" className={`exec-grid-rowlabel exec-row-${row}`}>
                {ROW_LABELS[row]}
              </th>
              {GRID_GROUPS.map((g) => (
                <td key={g} className="exec-metric-cell" id={`ecell_${g}_${row}`} data-row={row}>
                  <span id={`val_${g}_${row}`}>{gridStepCell(grid, g, row)}</span>
                </td>
              ))}
              <td className="exec-metric-cell" id={`ecell_total_${row}`} data-row={row}>
                <span id={`val_total_${row}`}>{gridStepCell(grid, 'total', row)}</span>
              </td>
              <td className="exec-metric-cell" id={`ecell_act_${row}`} data-row={row}>
                <span id={`val_act_${row}`}>{gridActionCell(grid, row)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="spa-muted spa-small">
        <b>Steps</b> = execution tasks (1 per control, 110 total) | <b>Actions</b> = registry commands within each step
      </div>
    </div>
  );
}

// FIN-16 (COST-GATE-SPEC §3.5, GUI): the DP-2 dialog. While a run is open on a non-dev tenant,
// the screen polls GET /api/cost-gate/pending; a recurring SET waiting for DP-2 opens a dialog
// with the entry, its monthly estimate, basis, price date and free alternative, and the exact
// text to type (`<entry id> <monthly cost>`). Confirm and Refuse post POST /api/approve with
// gateType 'cost'. Browser automation is declared (`automated`, from navigator.webdriver): the
// server accepts a scripted confirmation only on a kind:'sim' tenant (FD-1).

export const COST_PENDING_POLL_MS = 1500;

/** One prompt of GET /api/cost-gate/pending (CostGateDp2's Dp2Prompt plus its gate key). */
export interface PendingCostPrompt {
  entryId: string;
  label: string;
  controlIds: string[];
  estimate: string;
  estimateBasis: string;
  priceDate: string;
  standardAlternative: string[];
  expected: string;
  gateKey: string;
  requestedAt: string;
}

function automationDeclared(): boolean {
  return typeof navigator !== 'undefined' && (navigator as Navigator & { webdriver?: boolean }).webdriver === true;
}

function replyError(err: unknown): string {
  const payload = (err as { payload?: { error?: string } } | null)?.payload;
  if (payload && typeof payload.error === 'string') return payload.error;
  return err instanceof Error ? err.message : String(err);
}

export function CostDp2Dialog() {
  const running = useExecuteStore((s) => s.running);
  const tenant = useWorkflowStore((s) => s.tenant);
  const [prompt, setPrompt] = useState<PendingCostPrompt | null>(null);
  const [typed, setTyped] = useState('');
  const [operator, setOperator] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const active = running && Boolean(tenant) && tenant !== 'dev';

  useEffect(() => {
    if (!active) {
      setPrompt(null);
      return;
    }
    let stopped = false;
    const poll = async () => {
      try {
        const reply = await apiRequest<{ pending?: PendingCostPrompt[] }>('GET', '/api/cost-gate/pending');
        if (stopped) return;
        const first = Array.isArray(reply?.pending) && reply.pending.length > 0 ? reply.pending[0] : null;
        setPrompt((prev) => (prev && first && prev.gateKey === first.gateKey && prev.requestedAt === first.requestedAt ? prev : first));
      } catch {
        // keep polling; the run's own stream reports errors
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), COST_PENDING_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [active]);

  useEffect(() => {
    setTyped('');
    setMessage('');
  }, [prompt?.gateKey, prompt?.requestedAt]);

  if (!active || !prompt) return null;

  const answer = async (decision: 'approve' | 'skip') => {
    setBusy(true);
    try {
      const reply = await apiRequest<{ ok?: boolean; outcome?: string; error?: string }>('POST', '/api/approve', {
        body: {
          gateType: 'cost',
          entryId: prompt.entryId,
          decision,
          ...(decision === 'approve' ? { typed, operator } : {}),
          tenant,
          automated: automationDeclared(),
        },
      });
      setMessage(reply?.outcome === 'accepted' ? `DP-2 accepted for ${prompt.entryId}.` : `Refused: ${reply?.error ?? 'the cost was not started'}`);
      setPrompt(null);
    } catch (err) {
      setMessage(`Refused: ${replyError(err)}`);
      // A 400 (missing typed text or name) leaves the prompt open; anything else closed it.
      if ((err as { status?: number } | null)?.status !== 400) setPrompt(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      id="costDp2Dialog"
      className="spa-cost-dp2"
      role="dialog"
      aria-modal="true"
      aria-labelledby="costDp2Title"
      data-entry-id={prompt.entryId}
    >
      <h3 id="costDp2Title">Recurring cost: confirm at run time (DP-2)</h3>
      <dl className="spa-cost-dp2-facts">
        <div>
          <dt>Entry</dt>
          <dd>
            {prompt.entryId}: {prompt.label}
          </dd>
        </div>
        <div>
          <dt>Controls</dt>
          <dd>{prompt.controlIds.join(', ') || '(none)'}</dd>
        </div>
        <div>
          <dt>Estimate</dt>
          <dd id="costDp2Estimate">
            about {prompt.estimate} a month ({prompt.estimateBasis}; price date {prompt.priceDate})
          </dd>
        </div>
        <div>
          <dt>Free alternative</dt>
          <dd>{prompt.standardAlternative.join(', ') || 'none'}</dd>
        </div>
      </dl>
      <p>
        To start this cost, type exactly: <code id="costDp2Expected">{prompt.expected}</code>. Anything else refuses it.
      </p>
      <label htmlFor="costDp2Typed">Confirmation text</label>
      <input id="costDp2Typed" className="spa-input" value={typed} autoComplete="off" onChange={(e) => setTyped(e.target.value)} />
      <label htmlFor="costDp2Operator">Your name or ID</label>
      <input id="costDp2Operator" className="spa-input" value={operator} autoComplete="off" onChange={(e) => setOperator(e.target.value)} />
      {message ? (
        <div className="spa-small" role="alert">
          {message}
        </div>
      ) : null}
      <div className="btn-row">
        <button type="button" className="btn btn-primary" id="costDp2Confirm" disabled={busy} onClick={() => void answer('approve')}>
          Start the cost
        </button>
        <button type="button" className="btn btn-secondary" id="costDp2Refuse" disabled={busy} onClick={() => void answer('skip')}>
          Refuse
        </button>
      </div>
    </div>
  );
}

export function ExecuteCard() {
  const s = useExecuteStore();
  const counter = useConsoleStore((c) => c.counter.text);
  const ledgerCount = useConsoleStore((c) => c.ledger.length);
  const toggleLedger = useConsoleStore((c) => c.toggleLedger);

  return (
    <WorkflowCard
      step={4}
      title="Execute"
      badge={s.badge}
      tip={TIP}
      headerExtra={
        <span id="executeCounter" className="spa-counter">
          {counter}
        </span>
      }
    >
      <div className="spa-ep-row">
        <div id="execEpDisplay" className="spa-ep-display" title={s.epDisplay.title}>
          {s.epDisplay.text}
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-small"
          title="Re-validate the Executable Plan path and unlock this card"
          onClick={() => void tryUnlockExecuteFromEP()}
        >
          Reload EP
        </button>
      </div>
      <ProgressGrid />
      <div className="spa-field-row">
        <div className="spa-field">
          <label htmlFor="execModeSelect">Mode</label>
          <select id="execModeSelect" value={s.mode} onChange={(e) => s.setMode(e.target.value as ExecMode)}>
            {EXEC_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div className="spa-field">
          <label htmlFor="execTargetSelect">Target</label>
          <select id="execTargetSelect" value={s.target} onChange={(e) => s.setTarget(e.target.value as ExecTarget)}>
            {EXEC_TARGETS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="spa-toggles">
        <label className="verbose-toggle">
          <input type="checkbox" id="verboseExecute" checked={s.verbose} onChange={(e) => s.setVerbose(e.target.checked)} /> Verbose
        </label>
        <label className="verbose-log-toggle-btn">
          <input type="checkbox" id="verboseLogPanelToggle" checked={s.logPanel} onChange={(e) => s.setLogPanel(e.target.checked)} /> Log Panel
        </label>
        <label className="verbose-toggle">
          <input type="checkbox" id="uploadToExecute" checked={s.upload} onChange={(e) => s.setUpload(e.target.checked)} /> Upload Evidence
        </label>
      </div>
      <div className="btn-row spa-btn-row">
        <button type="button" className="btn btn-primary" id="btnExecuteMatrix" disabled={s.running} onClick={executeFromMatrix}>
          Execute
        </button>
        {s.retryVisible ? (
          <button type="button" className="btn btn-primary btn-retry" id="btnRetry" onClick={executeRetry}>
            Retry Skipped/Failed
          </button>
        ) : null}
        {s.running ? (
          <button type="button" className="btn btn-destructive btn-halt btn-small" id="btnHalt" onClick={() => void haltExecution()}>
            Halt
          </button>
        ) : null}
      </div>
      <CostDp2Dialog />
      {ledgerCount > 0 ? (
        <button type="button" className="btn btn-secondary resources-float-btn" id="resourcesFloatBtn" onClick={toggleLedger}>
          Resources{' '}
          <span className="ledger-badge" id="resourceBadge">
            {ledgerCount}
          </span>
        </button>
      ) : null}
    </WorkflowCard>
  );
}

export default function ExecuteScreen() {
  return (
    <section className="spa-screen spa-run-screen" data-screen="execute" aria-labelledby="screen-title-card4">
      <div className="spa-run-left">
        <ExecuteCard />
      </div>
      <ConsolePanel />
    </section>
  );
}
