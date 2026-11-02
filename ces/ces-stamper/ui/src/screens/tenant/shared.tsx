// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Pieces the three card screens (Tenant, Configure, Assess) share: the page-load bootstrap,
// the console pane (W8-SPAW: SPA2's right column, re-exported, with #statusBar and
// #taskListWrap > #taskList on the one console store), the workflow-card frame (#workflowCardN, .workflow-card-header, #cardStatusN; the demo driver's
// expandCard() clicks the header while the card carries card-collapsed) and the run-end toast.

import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useTenantStore } from '../../store/tenant';
import type { CardBadgeClass } from '../../store/tenant';
import { ConsolePanel } from '../console/ConsolePanel';
import { bootstrapConsole } from './flow';
import './cards.css';

export { ConsolePanel };

/** Runs the legacy page-load sequence once per page (whichever card screen opens first). */
export function useConsoleBootstrap(): void {
  useEffect(() => {
    void bootstrapConsole();
  }, []);
}

export interface WorkflowCardProps {
  index: number;
  title: string;
  titleId: string;
  badge: { text: string; className: CardBadgeClass };
  collapsed: boolean;
  onToggle: () => void;
  /** Extra classes on the card (tenant-<state>, card-done, card-active). */
  className?: string;
  /** Rendered in the header after the badge (assess counter, stale badge). */
  headerExtra?: ReactNode;
  tooltip?: string;
  children: ReactNode;
}

export function WorkflowCard({ index, title, titleId, badge, collapsed, onToggle, className, headerExtra, tooltip, children }: WorkflowCardProps) {
  const bodyId = `workflowCard${index}Body`;
  const classes = ['workflow-card', collapsed ? 'card-collapsed' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <div className={classes} id={`workflowCard${index}`}>
      {/* The div takes the pointer click (legacy markup); the chevron button gives keyboard access. */}
      <div className="workflow-card-header" onClick={onToggle} title={tooltip}>
        <span className="card-step-num" aria-hidden="true">
          {index}
        </span>
        <h2 id={titleId} className="card-title">
          {title}
        </h2>
        <span className={`card-status-badge ${badge.className}`} id={`cardStatus${index}`}>
          {badge.text}
        </span>
        {headerExtra}
        <button
          type="button"
          className="card-chevron"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${title} card`}
        >
          ▼
        </button>
      </div>
      <div className="workflow-card-body" id={bodyId} hidden={collapsed}>
        {children}
      </div>
    </div>
  );
}

export function RunToastView() {
  const toast = useTenantStore((s) => s.toast);
  const dismiss = useTenantStore((s) => s.dismissToast);
  if (!toast) return null;
  return (
    <button type="button" className={`run-toast ${toast.success ? 'success' : 'fail'}`} onClick={dismiss} aria-label={`${toast.title}. Dismiss`}>
      <span className="toast-title">{toast.title}</span>
      <span className="toast-quip">{toast.quip}</span>
      {toast.stats ? <span className="toast-stats">{toast.stats}</span> : null}
    </button>
  );
}

/** The two-column card page every card screen uses. */
export function CardScreen({ screen, titleId, card, console: consolePane, children }: {
  screen: string;
  titleId: string;
  card: ReactNode;
  console: ReactNode;
  children?: ReactNode;
}) {
  useConsoleBootstrap();
  return (
    <section className="spa-screen spa-card-screen" data-screen={screen} aria-labelledby={titleId}>
      <div className="spa-columns">
        <div className="spa-left">{card}</div>
        <div className="spa-right">{consolePane}</div>
      </div>
      {children}
      <RunToastView />
    </section>
  );
}
