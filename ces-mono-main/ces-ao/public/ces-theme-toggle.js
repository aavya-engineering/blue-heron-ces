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
