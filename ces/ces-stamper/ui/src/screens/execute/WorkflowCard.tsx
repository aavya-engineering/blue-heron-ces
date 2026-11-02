// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W8-SPA2: a legacy workflow card frame (#workflowCard<n>, .workflow-card-header,
// #cardStatus<n>). The SPA shows one card per screen, always expanded: it never carries
// `card-collapsed`, so the demo driver's expandCard() guard leaves it alone. A locked card
// carries `card-locked`, as legacy.

import type { ReactNode } from 'react';
import type { CardBadge } from '../../store/translate';

export interface WorkflowCardProps {
  step: number;
  title: string;
  badge: CardBadge;
  locked?: boolean;
  /** Legacy header tooltip. */
  tip?: string;
  /** Extra header content after the badge (card 4: #executeCounter). */
  headerExtra?: ReactNode;
  children: ReactNode;
}

export function WorkflowCard({ step, title, badge, locked = false, tip, headerExtra, children }: WorkflowCardProps) {
  return (
    <div className={`workflow-card spa-card${locked ? ' card-locked' : ''}`} id={`workflowCard${step}`} data-locked={locked}>
      <div className="workflow-card-header spa-card-header" title={tip}>
        <span className="card-step-num">{step}</span>
        <h2 className="spa-card-title" id={`screen-title-card${step}`}>
          {title}
        </h2>
        <span className={`card-status-badge ${badge.cls}`} id={`cardStatus${step}`}>
          {badge.text}
        </span>
        {headerExtra}
      </div>
      <div className="workflow-card-body spa-card-body">{children}</div>
    </div>
  );
}
