// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// Outer shell nav rail — 5-tab GO Flow shell (Help/Situation/Discovery/Readiness).
// Coexists with MusterNav (inner header) by design: ShellNav is a new wrapper
// rail mounted above MusterNav, never a replacement for it (P1 resolution #6).
// 'Situation' calls navigate('assessment') — same entry point as today; it does
// not extract or duplicate AssessmentPage's own tab-* rail.
//
// document/localStorage are not touched here, but the same node-renderability
// discipline as MusterNav/ThemeToggle in App.tsx applies to any future change.

type ShellView = 'help' | 'assessment' | 'discovery' | 'readiness' | 'plan';

export default function ShellNav({
  onNavigate,
  planEnabled = false,
}: {
  onNavigate: (v: ShellView) => void;
  /** G-MUSTER-PLAN-3 M0: the Plan tab is enabled once a readiness result exists. */
  planEnabled?: boolean;
}) {
  return (
    <nav className="shell-nav" aria-label="Muster shell navigation">
      <button
        className="shell-nav-btn"
        data-testid="nav-tab-help"
        onClick={() => onNavigate('help')}
      >
        Help
      </button>
      <button
        className="shell-nav-btn"
        data-testid="nav-tab-situation"
        onClick={() => onNavigate('assessment')}
      >
        Situation
      </button>
      <button
        className="shell-nav-btn"
        data-testid="nav-tab-discovery"
        onClick={() => onNavigate('discovery')}
      >
        Discovery
      </button>
      <button
        className="shell-nav-btn"
        data-testid="nav-tab-readiness"
        onClick={() => onNavigate('readiness')}
      >
        Readiness
      </button>
      <button
        className="shell-nav-btn"
        data-testid="nav-tab-plan"
        onClick={() => onNavigate('plan')}
        disabled={!planEnabled}
        title={planEnabled ? undefined : 'Complete a readiness assessment first'}
      >
        Plan
      </button>
    </nav>
  );
}
