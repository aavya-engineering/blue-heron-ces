// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useTheme, type Theme } from './theme';

export interface ThemeToggleProps {
  /** Legacy id; ces-ui.css styles `#ces-theme-toggle`. */
  id?: string;
  onChange?: (theme: Theme) => void;
}

export function ThemeToggle({ id = 'ces-theme-toggle', onChange }: ThemeToggleProps) {
  const [theme, setTheme] = useTheme();
  const next: Theme = theme === 'dark' ? 'light' : 'dark';

  return (
    <button
      id={id}
      type="button"
      className="ck-theme-toggle"
      title="Toggle light/dark theme"
      aria-label={`Switch to ${next} theme`}
      data-theme-current={theme}
      onClick={() => {
        setTheme(next);
        onChange?.(next);
      }}
    >
      <span aria-hidden="true">{'◐'}</span>
    </button>
  );
}
