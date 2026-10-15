# Plan: Remove Right-Pane Dashboard, Default-Collapse Left Tree, Add Search-on-Blank

**Date:** 2026-07-10
**Status:** READY FOR IMPLEMENTATION

## Objective

Rework `public/index.html`'s right pane so it no longer shows the family-grouped
command-card dashboard; instead, when no command form is open, it shows a search
bar with live-filtered results. The left-column family tree starts collapsed by
default. All existing command-form, execution, approvals, and tooltip behavior
is preserved.

## Context Summary

- **From Review:** REVIEW.md/GAP_ANALYSIS.md/RESEARCH_SUMMARY.md in `docs/context/`
  are stale artifacts from an unrelated prior task (Azure Firewall/CMMC boundary
  research and an April dashboard-tooltip review) — not applicable here. Treated as N/A.
- **From Research:** N/A.
- **Constraints:** Single-file SPA, no build step, vanilla JS, Blueprint Dark /
  ces-ui.css conventions. Preserve `openCommandForm`, `closeCommandForm`, execution
  flow, approvals UI, tooltips, left-tree click-to-open.

## Implementation Steps

1. **Remove dashboard CSS** — delete the `DASHBOARD — command cards grid` block
   (`public/index.html` lines 295–367: `#dashboard`, `#dashboard.hidden`,
   `.command-card`, `.command-card:hover`, `.card-domain`, `.card-id-title`,
   `.card-id`, `.card-badges`, `.badge*`) and the `.family-dashboard-section*` /
   `.dashboard-family-body` rules (lines 168–222). Keep `.badge` rules only if
   reused elsewhere (grep first — `priority-p*`/`trigger` badges appear to be
   dashboard-only; remove if unused elsewhere in the file).

2. **Add blank-state search CSS** — new block near the removed dashboard section:
   `#blankState` (flex column, gap), `#commandSearchInput` (reuse existing
   `input[type="text"]` styling conventions, larger padding/font for a search
   bar), `#searchResults` (flex column list), `.search-result-item` (mirrors
   `.command-item` hover/border-left pattern for visual consistency), and an
   empty/no-query placeholder state (e.g. "Start typing to search 85 commands…").

3. **Left tree starts collapsed (static HTML)** — `public/index.html` lines
   752–822: add `class="family-section collapsed"` to each of the 8
   `<div class="family-section" data-domain="X">` elements (A–H). This relies on
   the existing `.family-section.collapsed .family-body { display: none }` and
   `.collapsed .chevron { transform: rotate(-90deg) }` rules already defined
   (lines 156–166) — no new CSS needed. `toggleFamily()` (line 1011) already
   toggles the class and needs no change.

4. **Replace dashboard DOM with blank-state DOM** — line 825–828: replace
   `<!-- Dashboard: All 85 command cards --><div id="dashboard"></div>` with:
   ```html
   <!-- Blank state: shown when no command form is open -->
   <div id="blankState">
     <input type="text" id="commandSearchInput" placeholder="Search commands (id, title, domain, CMMC practice)…" autocomplete="off" />
     <div id="searchResults"></div>
   </div>
   ```

5. **Remove `renderDashboard()` and `toggleDashboardFamily()`** — delete both
   functions in full (lines 954–1008 in current file: the
   `toggleDashboardFamily` comment+function and the `renderDashboard` comment+function).

6. **Add `renderSearchResults(query)`** — new function, placed where
   `renderDashboard` was. Case-insensitive substring match against `cmd.id`,
   `cmd.title`, `cmd.domainName`, and `cmd.cmmcPractices` (array — join or
   `.some()`). Empty/whitespace query → show placeholder text in `#searchResults`
   ("Start typing to search 85 commands…"), not the full list (avoids
   reintroducing an 85-item dump). Non-empty query with zero matches → "No
   matching commands." Each match renders a `.search-result-item` with
   `onclick="openCommandForm('${cmd.id}')"`, showing `cmd.domain`, `cmd.id`,
   `cmd.title` (reuse `.cmd-id`/`.cmd-title` span classes from `.command-item`
   for visual consistency, no need for new span classes).

7. **Wire the search input** — in the `DOMContentLoaded` handler (line 891–895),
   after `renderFamilyTree()`, replace the `renderDashboard();` call with:
   attach an `input` event listener on `#commandSearchInput` calling
   `renderSearchResults(this.value)`, and call `renderSearchResults('')` once to
   paint the initial placeholder.

8. **Update `openCommandForm()`** — line 1017–1023: replace
   `document.getElementById('dashboard').classList.add('hidden');` with
   `document.getElementById('blankState').classList.add('hidden');` (add a
   `#blankState.hidden { display: none; }` CSS rule alongside the new block from
   step 2, consistent with the removed dashboard's `.hidden` pattern).

9. **Update `closeCommandForm()`** — line 1218–1223: replace
   `document.getElementById('dashboard').classList.remove('hidden');` with
   `document.getElementById('blankState').classList.remove('hidden');` and, since
   the pane is now blank-state, also clear/reset the search box
   (`commandSearchInput.value = ''`) and re-render with an empty query
   (`renderSearchResults('')`) so returning to blank state doesn't show stale
   results from a prior search.

## File Inventory

| File | Action | Lines/Functions Affected |
|------|--------|---------------------------|
| public/index.html | MODIFY | CSS: remove L168–222 (`.family-dashboard-section*`), L295–367 (`#dashboard`, `.command-card*`, `.badge*` if unused elsewhere) |
| public/index.html | MODIFY | CSS: add `#blankState`, `#blankState.hidden`, `#commandSearchInput`, `#searchResults`, `.search-result-item` block (placed where old dashboard CSS was) |
| public/index.html | MODIFY | HTML: L752–822 — add `collapsed` class to all 8 `.family-section` divs |
| public/index.html | MODIFY | HTML: L825–828 — replace `#dashboard` div with `#blankState` (search input + results container) |
| public/index.html | MODIFY | JS: L891–895 `DOMContentLoaded` — drop `renderDashboard()` call, wire search input listener, initial `renderSearchResults('')` |
| public/index.html | MODIFY | JS: delete L954–960 `toggleDashboardFamily()` |
| public/index.html | MODIFY | JS: delete/replace L962–1008 `renderDashboard()` with new `renderSearchResults(query)` |
| public/index.html | MODIFY | JS: L1017–1023 `openCommandForm()` — hide `#blankState` instead of `#dashboard` |
| public/index.html | MODIFY | JS: L1218–1223 `closeCommandForm()` — show `#blankState`, reset search box + results |

## Architecture Decisions

- **Reuse `.command-item`-style visuals for search results** rather than the
  removed `.command-card` styling, so the blank-state list reads as an
  extension of the left-tree's list idiom, not a reintroduction of the card grid.
- **Empty query shows a placeholder, not the full 85-command list** — keeps the
  "blank pane" genuinely blank/lightweight per the task intent; browsing by
  family already exists via the left tree.
- **Left tree collapse is static (`collapsed` class in HTML)**, matching how the
  markup already works today (family sections are hardcoded per-domain divs, not
  JS-generated) — no persistence/localStorage needed, no JS change to `toggleFamily`.

## Testing Strategy

- Manual verification only (no test suite for this SPA per MODULE_MAP.md).
- Confirm no leftover references to `dashboard`, `renderDashboard`,
  `toggleDashboardFamily`, `.command-card`, `.family-dashboard-section`,
  `.dashboard-family-body` anywhere in `public/index.html` after edits (grep the
  file for these identifiers — should return zero hits).

## Out of Scope

- Changing the left-tree family markup from static HTML to JS-generated.
- Persisting left-tree collapse/expand state across page reloads.
- Fuzzy/ranked search (substring match only, per constraints).
- Any change to `executeCommand`, approvals UI, firewall confirm modal, or
  tenant config loading.
- Any change to `src/server/` or the command registry JSON.

## Acceptance Criteria

- [ ] Right pane no longer renders a family-grouped card grid at any time.
- [ ] Left column's 8 family sections are collapsed on initial page load.
- [ ] With no command form open, right pane shows a search bar and (once typed
      into) live-updating matches beneath it.
- [ ] Clicking a search result opens that command's form, identical to
      left-tree click-to-open.
- [ ] Closing a command form returns to blank/search state, not stale results.
- [ ] All dead dashboard code (CSS classes, `renderDashboard`,
      `toggleDashboardFamily`, `#dashboard` DOM) is removed, not left orphaned.
- [ ] Command form open/close, execution (dry-run/live), Tier-3 approvals flow,
      firewall confirm modal, and left-tree tooltips all work unchanged.

## Verification (manual, `npm run ao` on port 3001)

1. `npm run ao` from repo root; open `http://localhost:3001`.
2. On load: left column shows all 8 family headers (A–H) collapsed (chevrons
   point sideways, no command items visible). Right pane shows a search bar and
   a placeholder message, no card grid.
3. Click a left-tree family header (e.g. "A") — it expands, showing its command
   items; click again — collapses. Confirm this still works identically to
   before.
4. Click a command item in the left tree (e.g. `A-01`) — command form opens in
   right pane, search bar/results are hidden. Confirm form contents (title,
   overview, parameters) render correctly.
5. Click the close button (×) on the command form — right pane returns to
   blank/search state (search box empty, placeholder shown, not stale results).
6. Type into the search bar, e.g. "user" — results update live per keystroke,
   showing matches on title (e.g. A-01 "New User Provisioning"). Type an id
   fragment, e.g. "b-0" — matches domain B commands. Type a CMMC practice
   fragment, e.g. "3.5.1" — matches commands whose `cmmcPractices` include it
   (e.g. A-01). Clear the box — placeholder returns.
7. Click a search result — command form opens for that command (same as
   left-tree click-to-open), search state hidden.
8. Open Approvals (header button) — confirm approvals modal/panel still works
   unaffected by these changes.
9. Trigger F-11 or F-12 (firewall) — confirm precheck/confirm-modal flow still
   works unaffected.
10. Browser console: no errors on load, search typing, form open/close.
