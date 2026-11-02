// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W8-SPA2: the legacy right column (#rightCol, index.html L4638-4671) on the kit panels:
// status bar, Console / Terminal tabs with Save Log, Execution Results, Error Log, and the
// Resource Ledger drawer. The Translate, Execute and Console screens each render it, so the
// run stays visible whichever of them is open (legacy keeps the column on screen).
// W8-SPAW: the Tenant, Configure and Assess screens render it too (one console for every card);
// their extra #taskList rows (the prerequisites panel, the assess entry rows) come in as children.

import type { ReactNode } from 'react';
import { ConsoleView, ErrorLog, ExecutionResultsTable, ResourceLedger, TabNav, TerminalView } from 'ces-ui-kit';
import type { ConsoleEntry } from 'ces-ui-kit';
import { useConsoleStore } from '../../store/console';
import type { ConsoleTab } from '../../store/console';
import type { ConsoleItem } from '../../store/console-events';
import { approveRow, exportLedger, saveRunLog, useExecuteStore } from '../../store/execute';
import { ConsoleRow } from './ConsoleRows';
import type { RowOptions } from './ConsoleRows';
import './console.css';

const TABS = [
  { id: 'console', label: 'Console', controls: 'taskList' },
  { id: 'terminal', label: 'Terminal', controls: 'terminalList' },
];

/** The kit ConsoleView renders plain rows first; everything from the first execute row on is its children. */
export function splitLeadingLogs(items: readonly ConsoleItem[]): { leading: ConsoleEntry[]; rest: ConsoleItem[] } {
  let i = 0;
  const leading: ConsoleEntry[] = [];
  while (i < items.length && items[i].kind === 'log') {
    const it = items[i] as Extract<ConsoleItem, { kind: 'log' }>;
    leading.push({ key: it.key, time: it.time, level: it.level, message: it.message });
    i++;
  }
  return { leading, rest: items.slice(i) };
}

export function ConsolePanel({ children }: { children?: ReactNode } = {}) {
  const c = useConsoleStore();
  const verbose = useExecuteStore((s) => s.verbose);
  const running = useExecuteStore((s) => s.running);
  const setVerbose = useExecuteStore((s) => s.setVerbose);
  const { leading, rest } = splitLeadingLogs(c.items);

  const options: RowOptions = {
    verbose,
    onDecide: (target, decision) => void approveRow(target, decision),
    onToggleStep: c.toggleStep,
  };

  const onTab = (id: string) => {
    const tab = id as ConsoleTab;
    c.setTab(tab);
    // Legacy switchConsoleTab: the Terminal tab forces verbose on during a run.
    if (tab === 'terminal' && running && !verbose) {
      setVerbose(true);
      c.setVerboseForced(true);
    }
  };

  return (
    <div id="rightCol" className="spa-right-col">
      <div id="statusBar" role="status" className={c.status ? `spa-status ${c.status.tone}` : 'spa-status'} hidden={!c.status}>
        {c.status?.text ?? ''}
      </div>

      <div id="taskListWrap" className="spa-console">
        <div className="console-header spa-console-header">
          <div className="console-tabs spa-console-tabs">
            <TabNav tabs={TABS} active={c.activeTab} onChange={onTab} label="Run output" idPrefix="consoleTab-" />
            {c.verboseForced ? (
              <span id="termVerboseHint" className="term-verbose-hint">
                (verbose forced)
              </span>
            ) : null}
          </div>
          <div className="spa-console-save">
            <span id="rlogSaveMsg" className="rlog-save-msg" data-tone={c.saveMessage?.tone ?? ''} aria-live="polite">
              {c.saveMessage?.text ?? ''}
            </span>
            <button type="button" className="btn btn-secondary console-save-btn" title="Save execution log to disk" onClick={() => void saveRunLog()}>
              Save Log
            </button>
          </div>
        </div>
        <ConsoleView entries={leading} hidden={c.activeTab !== 'console'} labelledBy="consoleTab-console">
          {rest.map((item, i) => (
            <ConsoleRow key={item.key} item={item} last={i === rest.length - 1} steps={c.steps} subs={c.subs} options={options} />
          ))}
          {children}
        </ConsoleView>
        <TerminalView blocks={c.terminal} hidden={c.activeTab !== 'terminal'} labelledBy="consoleTab-terminal" />
      </div>

      <div className="spa-results-wrap" hidden={c.resultsHidden}>
        <ExecutionResultsTable summary={c.summary} controlResults={c.controlResults ?? undefined} />
      </div>

      <ErrorLog entries={c.errorLog} />

      {c.ledgerOpen ? (
        <ResourceLedger entries={c.ledger} onExport={(format, entries) => void exportLedger(format, entries)} onClose={c.toggleLedger} />
      ) : null}
    </div>
  );
}
