// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// Outer shell nav rail — 5-tab GO Flow shell (Help/Situation/Discovery/Readiness/Plan).
// FIN-32: the rail of the kit shell (MusterShell), under the kit header; the current view
// carries aria-current="page" (the interview's own tab rail inside Situation is unchanged).
// Coexists with MusterNav (inner header) by design: ShellNav is a new wrapper
// rail mounted above MusterNav, never a replacement for it (P1 resolution #6).
// 'Situation' calls navigate('assessment') — same entry point as today; it does
// not extract or duplicate AssessmentPage's own tab-* rail.
//
// document/localStorage are not touched here, but the same node-renderability
// discipline as MusterNav/ThemeToggle in App.tsx applies to any future change.

type ShellView = 'help' | 'assessment' | 'discovery' | 'readiness' | 'plan';

/** FIN-32: the shell tab a view belongs to (the result screen sits under Situation). */
export function shellTabOf(view: string | undefined): ShellView | null {
  if (view === 'assessment' || view === 'result') return 'assessment';
  if (view === 'help' || view === 'discovery' || view === 'readiness' || view === 'plan') return view;
  return null;
}

export default function ShellNav({
  onNavigate,
  planEnabled = false,
  active,
}: {
  onNavigate: (v: ShellView) => void;
  /** G-MUSTER-PLAN-3 M0: the Plan tab is enabled once a readiness result exists. */
  planEnabled?: boolean;
  /** FIN-32: the App's current view (marks the matching tab aria-current="page"). */
  active?: string;
}) {
  const current = shellTabOf(active);
  const cur = (v: ShellView) => (current === v ? ('page' as const) : undefined);
  return (
    <nav className="shell-nav" aria-label="Muster shell navigation">
      <button
        className="shell-nav-btn"
        type="button"
        data-testid="nav-tab-help"
        aria-current={cur('help')}
        onClick={() => onNavigate('help')}
      >
        Help
      </button>
      <button
        className="shell-nav-btn"
        type="button"
        data-testid="nav-tab-situation"
        aria-current={cur('assessment')}
        onClick={() => onNavigate('assessment')}
      >
        Situation
      </button>
      <button
        className="shell-nav-btn"
        type="button"
        data-testid="nav-tab-discovery"
        aria-current={cur('discovery')}
        onClick={() => onNavigate('discovery')}
      >
        Discovery
      </button>
      <button
        className="shell-nav-btn"
        type="button"
        data-testid="nav-tab-readiness"
        aria-current={cur('readiness')}
        onClick={() => onNavigate('readiness')}
      >
        Readiness
      </button>
      <button
        className="shell-nav-btn"
        type="button"
        data-testid="nav-tab-plan"
        aria-current={cur('plan')}
        onClick={() => onNavigate('plan')}
        disabled={!planEnabled}
        title={planEnabled ? undefined : 'Complete a readiness assessment first'}
      >
        Plan
      </button>
    </nav>
  );
}
