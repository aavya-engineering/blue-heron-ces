// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { ReactNode } from 'react';
import { ThemeToggle } from './ThemeToggle';

export interface AppShellProps {
  /** Module name shown after the company, e.g. "Stamper". */
  product: string;
  /** Version label shown before the theme toggle, e.g. "v2.2.3". */
  version?: string;
  company?: string;
  /** Logo mark; the legacy console serves it at the static root. */
  logoSrc?: string;
  /** Extra header controls, placed before the version and theme toggle. */
  headerControls?: ReactNode;
  /** Usually a StepRail; spans the page under the header. */
  rail?: ReactNode;
  /** Usually a TenantBanner; sits under the rail (legacy status bar row). */
  banner?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
}

/** Legacy console frame: ink header (ces-ui.css `.ces-header`), then the main column. */
export function AppShell({
  product,
  version,
  company = 'Blue Heron Defense',
  logoSrc = '/ces-logo.svg',
  headerControls,
  rail,
  banner,
  footer,
  children,
}: AppShellProps) {
  return (
    <div className="ck-shell">
      <header id="header" className="ces-header ck-header">
        <div className="header-brand">
          {logoSrc ? <img src={logoSrc} alt="" /> : null}
          CES
          <span className="header-company">
            {company} {'—'} {product}
          </span>
        </div>
        <div className="header-controls">
          {headerControls}
          {version ? <span className="ck-header-version">{version}</span> : null}
          <ThemeToggle />
        </div>
      </header>
      <main id="main" className="ck-main">
        {rail}
        {banner}
        {children}
      </main>
      {footer ? <footer className="ces-footer">{footer}</footer> : null}
    </div>
  );
}
