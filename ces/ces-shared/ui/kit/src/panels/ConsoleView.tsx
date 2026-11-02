// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { ReactNode } from 'react';
import { useStickToBottom } from './useStickToBottom';

export type LogLevel = 'info' | 'success' | 'warn' | 'error';

/** One legacy `appendConnectionLog` row. */
export interface ConsoleEntry {
  /** Stable React key; the index is used when absent. */
  key?: string;
  /** Display time, legacy `HH:MM:SS`. */
  time: string;
  level?: LogLevel;
  message: string;
}

export interface ConsoleViewProps {
  entries: readonly ConsoleEntry[];
  /** Rendered after the rows, inside the scroll region (legacy appends the prerequisite panel there). */
  children?: ReactNode;
  /** Legacy `taskList` (demo driver: `#taskList .connection-log-row .log-icon.error`). */
  id?: string;
  hidden?: boolean;
  /** Id of the tab that labels this panel; makes it a `tabpanel`. Without it the region is a `log`. */
  labelledBy?: string;
  /** Accessible name when not labelled by a tab. */
  label?: string;
}

const ICONS: Record<LogLevel, string> = {
  info: 'ℹ',
  success: '✓',
  warn: '⚠',
  error: '✗',
};

/**
 * Legacy Console tab body (`#taskList`). Rows keep the legacy classes the demo driver counts
 * (`connection-log-row`, `log-icon <level>`). Only the last row shows the pending spinner when
 * its message ends in "...", as legacy removes the previous spinner on every append.
 */
export function ConsoleView({ entries, children, id = 'taskList', hidden = false, labelledBy, label = 'Console' }: ConsoleViewProps) {
  const { ref, onScroll } = useStickToBottom<HTMLDivElement>(`${entries.length}:${hidden}`, false);

  return (
    <div
      id={id}
      ref={ref}
      onScroll={onScroll}
      className="ck-console-view"
      hidden={hidden}
      tabIndex={0}
      {...(labelledBy
        ? { role: 'tabpanel', 'aria-labelledby': labelledBy }
        : { role: 'log', 'aria-label': label, 'aria-live': 'polite' as const })}
    >
      {entries.map((entry, index) => {
        const level = entry.level ?? 'info';
        const pending = index === entries.length - 1 && entry.message.endsWith('...');
        return (
          <div key={entry.key ?? index} className="connection-log-row ck-log-row" data-level={level}>
            <span className="log-time ck-log-time">{entry.time}</span>
            <span className={`log-icon ${level} ck-log-icon ck-log-${level}`} role="img" aria-label={level}>
              {ICONS[level]}
            </span>
            <span className="log-msg ck-log-msg">
              {entry.message}
              {pending ? <span className="ck-log-spinner" aria-hidden="true" /> : null}
            </span>
          </div>
        );
      })}
      {children}
    </div>
  );
}
