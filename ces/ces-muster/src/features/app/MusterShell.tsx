// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// MusterShell — FIN-32: Muster on the kit shell. The markup is the kit AppShell's
// (ces-shared/ui/kit/src/shell/AppShell.tsx): div.ck-shell > header#header.ces-header.ck-header
// ("CES" + "Blue Heron Defense — Muster") > main#main.ck-main (rail, then the screen) >
// footer.ces-footer, styled by ces-ui.css and the kit's kit.css, with the kit theme contract
// (ThemeToggle / theme.ts: localStorage "ces-theme", a missing value means dark).
//
// Why a local copy and not `import { AppShell } from 'ces-ui-kit'`: ces-muster is not a mono
// workspace and has its own react, while ces-ui-kit's dist resolves the root react. Two React
// copies break the kit's hooks (ThemeToggle's useState) at run time. The kit's CSS has no such
// problem and is imported as is. When ces-muster's vite config dedupes react (LOG-FIN-32 S-D),
// this file can become a thin wrapper over the kit AppShell; shellParity.test.ts holds the
// two in step until then.
//
// Node-renderable (renderToStaticMarkup in node-env tests): document and localStorage are
// touched only behind typeof guards.
import { useState, type ReactNode } from 'react';
import type { EngagementKind } from '@/shared/types/engagement';

export const APP_VERSION = 'v2.2.3';
export const PRODUCT = 'Muster';
export const COMPANY = 'Blue Heron Defense';
/** The suite footer (the legacy consoles' `.ces-footer` line), with the module named. */
export const FOOTER_TEXT = `${COMPANY} · CES ${PRODUCT} ${APP_VERSION} · CUI`;

type Theme = 'light' | 'dark';
const THEME_STORAGE_KEY = 'ces-theme';

function readTheme(): Theme {
  if (typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark') return 'dark';
  if (typeof localStorage === 'undefined') return 'dark';
  try {
    return (localStorage.getItem(THEME_STORAGE_KEY) || 'dark') === 'dark' ? 'dark' : 'light';
  } catch {
    return 'dark';
  }
}

/** The kit ThemeToggle (ces-ui-kit shell/ThemeToggle.tsx), same id, class, label and storage. */
export function MusterThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  const toggle = () => {
    if (typeof document !== 'undefined') {
      if (next === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
      else document.documentElement.removeAttribute('data-theme');
    }
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // storage blocked: the theme still applies for this page
    }
    setTheme(next);
  };
  return (
    <button
      id="ces-theme-toggle"
      type="button"
      className="ck-theme-toggle"
      title="Toggle light/dark theme"
      aria-label={`Switch to ${next} theme`}
      data-theme-current={theme}
      onClick={toggle}
    >
      <span aria-hidden="true">{'◐'}</span>
    </button>
  );
}

export type HeaderView = 'quick-session' | 'contracts' | 'rollup';

/**
 * The kit header: brand "CES — Blue Heron Defense — Muster", then Muster's header controls
 * (Quick Session, Contracts, and Rollup for prime-and-subs engagements), the version and the
 * theme toggle. Exported for narrow tests (DW#3b: rollup-nav only for prime_and_subs).
 */
export function MusterHeader({
  kind,
  onNavigate,
}: {
  kind: EngagementKind | null;
  onNavigate: (v: HeaderView) => void;
}) {
  return (
    <header id="header" className="ces-header ck-header">
      {/* Kit markup verbatim; home is the rail's Situation tab (the brand is not a button, as in Stamper). */}
      <div className="header-brand">
        <img src="/ces-logo.svg" alt="" />
        CES
        <span className="header-company">
          {COMPANY} {'—'} {PRODUCT}
        </span>
      </div>
      <div className="header-controls">
        <button type="button" className="header-nav-btn" data-testid="quick-session-nav" onClick={() => onNavigate('quick-session')}>
          Quick Session
        </button>
        {/* Contracts appears for BOTH engagement kinds */}
        <button type="button" className="header-nav-btn" data-testid="contracts-nav" onClick={() => onNavigate('contracts')}>
          Contracts
        </button>
        {kind === 'prime_and_subs' && (
          <button type="button" className="header-nav-btn" data-testid="rollup-nav" onClick={() => onNavigate('rollup')}>
            Rollup
          </button>
        )}
        <span className="ck-header-version" data-testid="muster-version">
          {APP_VERSION}
        </span>
        <MusterThemeToggle />
      </div>
    </header>
  );
}

/** The kit AppShell frame around Muster's screens. */
export function MusterShell({
  header,
  rail,
  children,
  footer = FOOTER_TEXT,
}: {
  header: ReactNode;
  rail?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="ck-shell" data-testid="muster-shell">
      {header}
      <main id="main" className="ck-main">
        {rail}
        {children}
      </main>
      {footer ? (
        <footer className="ces-footer" data-testid="muster-footer">
          {footer}
        </footer>
      ) : null}
    </div>
  );
}
