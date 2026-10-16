// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * CES Theme Toggle — vanilla JS, no framework dependency.
 * Toggles data-theme="dark" on <html>, persists to localStorage key "ces-theme".
 * Apply saved theme immediately on load (before paint) to avoid flash.
 */
(function () {
  var STORAGE_KEY = 'ces-theme';
  var DARK = 'dark';

  function getTheme() {
    // Dark is the suite default (founder, 2026-09-07); an explicit 'light'
    // choice persisted by the user still wins.
    return localStorage.getItem(STORAGE_KEY) || DARK;
  }

  function applyTheme(theme) {
    if (theme === DARK) {
      document.documentElement.setAttribute('data-theme', DARK);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }

  // Apply saved preference immediately on load.
  applyTheme(getTheme());

  // Wire up toggle button once DOM is ready.
  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('ces-theme-toggle');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var next = getTheme() === DARK ? 'light' : DARK;
      localStorage.setItem(STORAGE_KEY, next);
      applyTheme(next);
    });
  });
}());
