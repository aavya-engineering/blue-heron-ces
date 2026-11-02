// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-30: the command list (legacy left column, family tree L1134-1158, and the search pane
// L1179-1208). Hooks keep the legacy names (AO-UI-TEST-HOOKS.md "Command catalog").

import { useState } from 'react';
import { selectCommand, useAoStore } from '../../store/ao';
import type { AoCommand } from '../../api';

export function matchesSearch(cmd: AoCommand, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return (
    cmd.id.toLowerCase().includes(q) ||
    cmd.title.toLowerCase().includes(q) ||
    cmd.domainName.toLowerCase().includes(q) ||
    (cmd.cmmcPractices ?? []).some((p) => p.toLowerCase().includes(q))
  );
}

function CommandButton({ cmd, testId, active }: { cmd: AoCommand; testId: string; active: boolean }) {
  return (
    <li>
      <button
        type="button"
        className={`ao-cmd${active ? ' ao-cmd-active' : ''}`}
        data-testid={testId}
        data-command-id={cmd.id}
        aria-current={active ? 'true' : undefined}
        title={cmd.overview}
        onClick={() => void selectCommand(cmd.id)}
      >
        <span className="ao-cmd-id">{cmd.id}</span>
        <span className="ao-cmd-title">{cmd.title}</span>
      </button>
    </li>
  );
}

export function CommandList() {
  const commands = useAoStore((s) => s.commands);
  const domains = useAoStore((s) => s.domains);
  const search = useAoStore((s) => s.search);
  const openId = useAoStore((s) => s.openId);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const matches = commands.filter((c) => matchesSearch(c, search));

  return (
    <nav className="ao-commands" aria-label="Commands">
      <label htmlFor="commandSearchInput" className="ao-label">
        Search commands
      </label>
      <input
        id="commandSearchInput"
        data-testid="command-search"
        type="search"
        autoComplete="off"
        placeholder="Search commands (id, title, domain, CMMC practice)…"
        value={search}
        onChange={(e) => useAoStore.setState({ search: e.target.value })}
      />
      <div id="searchResults" data-testid="search-results" className="ao-search-results" aria-live="polite">
        {search.trim() === '' ? (
          <div className="ao-muted">{`Start typing to search ${commands.length} commands…`}</div>
        ) : matches.length === 0 ? (
          <div className="ao-muted">No matching commands.</div>
        ) : (
          <ul className="ao-cmd-list">
            {matches.map((c) => (
              <CommandButton key={c.id} cmd={c} testId={`search-cmd-${c.id}`} active={c.id === openId} />
            ))}
          </ul>
        )}
      </div>
      {domains.map((d) => {
        const list = commands.filter((c) => c.domain === d.id);
        const isCollapsed = !!collapsed[d.id];
        const bodyId = `family-${d.id}`;
        return (
          <section key={d.id} className="ao-family" data-domain={d.id}>
            <h2 className="ao-family-head">
              <button
                type="button"
                className="ao-family-toggle"
                aria-expanded={!isCollapsed}
                aria-controls={bodyId}
                onClick={() => setCollapsed({ ...collapsed, [d.id]: !isCollapsed })}
              >
                <span className="ao-family-letter">{d.id}</span> {d.name}
                <span className="ao-muted">{` (${list.length})`}</span>
              </button>
            </h2>
            <ul id={bodyId} className="ao-cmd-list" data-family={d.id} hidden={isCollapsed}>
              {list.map((c) => (
                <CommandButton key={c.id} cmd={c} testId={`cmd-${c.id}`} active={c.id === openId} />
              ))}
            </ul>
          </section>
        );
      })}
    </nav>
  );
}
