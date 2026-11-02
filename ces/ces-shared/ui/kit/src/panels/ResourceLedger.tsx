// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useMemo, useState } from 'react';
import {
  DEFAULT_LEDGER_FILTER,
  filterLedger,
  type LedgerEntry,
  type LedgerExportFormat,
  type LedgerFilter,
} from './ledger';

export interface ResourceLedgerProps {
  entries: readonly LedgerEntry[];
  /** Called with the format and the currently filtered entries (legacy exportResourceLedger). */
  onExport: (format: LedgerExportFormat, entries: LedgerEntry[]) => void;
  /** Shows the legacy close button when given. */
  onClose?: () => void;
  /** Rendering cap; legacy shows the first 500 with a warning. */
  maxRendered?: number;
  /** Timestamp display; legacy uses `new Date(ts).toLocaleString()`. */
  formatTime?: (timestamp: string) => string;
  /** Prefix for every legacy id (`resourceLedgerPanel`, `filterDiscovered`, ... `ledgerBody`). Default ''. */
  idPrefix?: string;
}

const EXPORTS: ReadonlyArray<{ format: LedgerExportFormat; label: string }> = [
  { format: 'md', label: 'Markdown' },
  { format: 'json', label: 'JSON' },
  { format: 'csv', label: 'CSV' },
];

function defaultFormatTime(timestamp: string) {
  return new Date(timestamp).toLocaleString();
}

function uniqueSorted(values: Iterable<string>) {
  return Array.from(new Set(values)).sort();
}

/** Legacy Resource Ledger panel: category, type, step and search filters; count; grouped list; three exports. */
export function ResourceLedger({
  entries,
  onExport,
  onClose,
  maxRendered = 500,
  formatTime = defaultFormatTime,
  idPrefix = '',
}: ResourceLedgerProps) {
  const [filter, setFilter] = useState<LedgerFilter>(DEFAULT_LEDGER_FILTER);
  const filtered = useMemo(() => filterLedger(entries, filter), [entries, filter]);
  const types = useMemo(() => uniqueSorted(entries.map((e) => e.type)), [entries]);
  const steps = useMemo(() => uniqueSorted(entries.map((e) => e.step)), [entries]);
  const shown = filtered.slice(0, maxRendered);
  const groups: ReadonlyArray<{ category: string; title: string; rows: LedgerEntry[] }> = [
    { category: 'discovered', title: 'Discovered Resources', rows: shown.filter((e) => e.category === 'discovered') },
    { category: 'created', title: 'Created Resources', rows: shown.filter((e) => e.category === 'created') },
  ];
  const id = (name: string) => `${idPrefix}${name}`;
  const update = (patch: Partial<LedgerFilter>) => setFilter((current) => ({ ...current, ...patch }));

  return (
    <section id={id('resourceLedgerPanel')} className="ck-ledger" aria-labelledby={id('ledgerTitle')}>
      <div className="ck-ledger-header">
        <h3 id={id('ledgerTitle')}>Resource Ledger</h3>
        {onClose ? (
          <button type="button" className="ck-ledger-close" onClick={onClose} aria-label="Close resource ledger">
            {'×'}
          </button>
        ) : null}
      </div>
      <div className="ck-ledger-filters">
        <div className="ck-ledger-filter-row">
          <label>
            <input
              type="checkbox"
              id={id('filterDiscovered')}
              checked={filter.discovered}
              onChange={(e) => update({ discovered: e.target.checked })}
            />{' '}
            Discovered
          </label>
          <label>
            <input
              type="checkbox"
              id={id('filterCreated')}
              checked={filter.created}
              onChange={(e) => update({ created: e.target.checked })}
            />{' '}
            Created
          </label>
        </div>
        <div className="ck-ledger-filter-row">
          <select
            id={id('filterType')}
            aria-label="Filter by resource type"
            value={filter.type}
            onChange={(e) => update({ type: e.target.value })}
          >
            <option value="">All Types</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            id={id('filterStep')}
            aria-label="Filter by step"
            value={filter.step}
            onChange={(e) => update({ step: e.target.value })}
          >
            <option value="">All Steps</option>
            {steps.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="ck-ledger-filter-row">
          <input
            type="text"
            id={id('filterSearch')}
            aria-label="Search resources"
            placeholder="Search (space-separated terms)"
            value={filter.search}
            onChange={(e) => update({ search: e.target.value })}
          />
        </div>
        <span id={id('ledgerCount')} className="ck-ledger-count" aria-live="polite">
          {filtered.length} / {entries.length} resources
        </span>
      </div>
      <div id={id('ledgerBody')} className="ck-ledger-body" tabIndex={0} aria-label="Resources">
        {filtered.length > maxRendered ? (
          <div className="ck-ledger-warning">
            Showing {maxRendered} of {filtered.length} resources. Use filters to narrow results.
          </div>
        ) : null}
        {groups.map((group) =>
          group.rows.length > 0 ? (
            <div key={group.category} className="ck-ledger-section" data-category={group.category}>
              <div className="ck-ledger-section-header">
                {group.title} ({group.rows.length})
              </div>
              <ul className="ck-ledger-list">
                {group.rows.map((entry, index) => (
                  <li
                    key={`${entry.step}-${entry.path}-${entry.timestamp}-${index}`}
                    className={entry.category === 'created' ? 'ck-ledger-item ck-ledger-item-created' : 'ck-ledger-item'}
                  >
                    <div className="ck-ledger-item-type">{entry.type}</div>
                    <div className="ck-ledger-item-path">{entry.path}</div>
                    <div className="ck-ledger-item-meta">
                      Step: {entry.step} | {formatTime(entry.timestamp)}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null,
        )}
        {shown.length === 0 ? <div className="ck-ledger-empty">No resources match the current filters</div> : null}
      </div>
      <div className="ck-ledger-exports">
        {EXPORTS.map(({ format, label }) => (
          <button
            key={format}
            type="button"
            className="ck-ledger-export"
            data-format={format}
            onClick={() => onExport(format, filtered)}
          >
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}
