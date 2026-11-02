// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useStickToBottom } from './useStickToBottom';

/** Legacy `.term-phase.<phase>` badge classes. */
export type TerminalPhase = 'precheck' | 'get' | 'set' | 'postset' | 'verify' | 'evidence' | 'save';

/** One element of the legacy terminal transcript (`#terminalList` children), in display order. */
export type TerminalBlock =
  /** `.term-separator`: time, sub-command id, label (legacy prepends one to a flushed failure). */
  | { kind: 'separator'; time: string; id: string; label?: string }
  /** `.term-action-header`: "Action i/n", sub-command id, label, optional engine. */
  | { kind: 'action'; index: number; total: number; subId: string; label?: string; engine?: string }
  /** `.term-line`: phase badge, command sent, stdout (empty shows "(empty)"), error lines, right-aligned meta. */
  | { kind: 'line'; phase: TerminalPhase; label?: string; command?: string; stdout?: string; errors?: readonly string[]; meta?: string }
  /** Bare `.term-err` line, e.g. "Task failed: ...". */
  | { kind: 'error'; text: string }
  /** `.term-action-footer.term-verdict`: PASS or FAIL dot. */
  | { kind: 'verdict'; pass: boolean; text?: string };

export interface TerminalViewProps {
  blocks: readonly TerminalBlock[];
  /** Legacy `terminalList`. */
  id?: string;
  hidden?: boolean;
  /** Id of the tab that labels this panel; makes it a `tabpanel`. Without it the region is a `log`. */
  labelledBy?: string;
  label?: string;
}

function Block({ block }: { block: TerminalBlock }) {
  switch (block.kind) {
    case 'separator':
      return (
        <div className="ck-term-separator">
          <span className="ck-term-sep-time">{block.time}</span>
          <span className="ck-term-sep-id">{block.id}</span>
          <span className="ck-term-sep-label">{block.label ?? ''}</span>
        </div>
      );
    case 'action':
      return (
        <div className="ck-term-action">
          <span className="ck-term-action-index">
            Action {block.index}/{block.total}
          </span>
          <span className="ck-term-action-id">{block.subId}</span>
          <span className="ck-term-action-label">{block.label ?? ''}</span>
          {block.engine ? <span className="ck-term-action-engine">{block.engine}</span> : null}
        </div>
      );
    case 'line':
      return (
        <div className="ck-term-line" data-phase={block.phase}>
          <span className={`ck-term-phase ck-term-phase-${block.phase}`}>{block.label ?? block.phase.toUpperCase()}</span>
          {block.command ? <div className="ck-term-cmd">{block.command}</div> : null}
          <div className="ck-term-out">{block.stdout && block.stdout.trim() ? block.stdout : '(empty)'}</div>
          {(block.errors ?? []).map((text, i) => (
            <div key={i} className="ck-term-err">
              {text}
            </div>
          ))}
          {block.meta ? <div className="ck-term-meta">{block.meta}</div> : null}
        </div>
      );
    case 'error':
      return <div className="ck-term-err">{block.text}</div>;
    case 'verdict':
      return (
        <div className="ck-term-verdict" data-verdict={block.pass ? 'pass' : 'fail'}>
          <span className={block.pass ? 'ck-term-verdict-pass' : 'ck-term-verdict-fail'}>
            {'●'} {block.text ?? (block.pass ? 'PASS' : 'FAIL')}
          </span>
        </div>
      );
  }
}

/**
 * Legacy Terminal tab body (`#terminalList`): raw tenant I/O only. Auto-scrolls to the newest
 * block and pauses while the operator has scrolled up, as legacy scrollTerminal does.
 */
export function TerminalView({ blocks, id = 'terminalList', hidden = false, labelledBy, label = 'Terminal' }: TerminalViewProps) {
  const { ref, onScroll } = useStickToBottom<HTMLDivElement>(`${blocks.length}:${hidden}`, true);

  return (
    <div
      id={id}
      ref={ref}
      onScroll={onScroll}
      className="ck-terminal-view"
      hidden={hidden}
      tabIndex={0}
      {...(labelledBy
        ? { role: 'tabpanel', 'aria-labelledby': labelledBy }
        : { role: 'log', 'aria-label': label, 'aria-live': 'polite' as const })}
    >
      {blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </div>
  );
}
