// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useCallback, useEffect, useState } from 'react';

/**
 * Theme contract shared with the legacy console (ces-shared/ui/ces-theme-toggle.js):
 * key localStorage["ces-theme"]; a missing value means dark (suite default);
 * the stored value "dark" means dark; any other stored value means light.
 * Dark sets data-theme="dark" on <html>; light removes the attribute.
 */
export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'ces-theme';
export const DEFAULT_THEME: Theme = 'dark';

export function readStoredTheme(): Theme {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY) || DEFAULT_THEME;
  return stored === 'dark' ? 'dark' : 'light';
}

export function applyTheme(theme: Theme): void {
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

/** Persists and applies a theme exactly as the legacy toggle does on click. */
export function storeTheme(theme: Theme): void {
  window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  applyTheme(theme);
}

export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    storeTheme(next);
    setThemeState(next);
  }, []);

  return [theme, setTheme];
}
