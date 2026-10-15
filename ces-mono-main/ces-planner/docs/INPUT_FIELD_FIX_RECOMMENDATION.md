# Recommendation: Fix Dark / Unreadable Data-Entry Fields

**Date:** 2026-07-03
**Status:** Approved by gap analysis — awaiting go-ahead to implement
**Pipeline artifacts:** `docs/context/REVIEW.md`, `docs/context/RESEARCH_SUMMARY.md`, `PLAN.md`, `docs/context/GAP_ANALYSIS.md`

---

## The Problem

Data-entry fields (inputs, textareas, selects) across the Planner render with a dark
background even when the app is in light mode, and typed text is invisible or nearly
invisible.

## Root Cause

Two compounding issues, found in Stage 1 review:

1. **P0 — `src/index.css:29` declares `color-scheme: light dark` on `:root`.**
   This tells Chrome/Edge/Safari the page supports both themes. When the **OS** is in
   dark mode, the browser's own UA stylesheet paints native form controls dark —
   dark backgrounds, light text — completely bypassing the app's `[data-theme="dark"]`
   toggle. The surrounding chrome (cards, headers, body text) stays light because it is
   styled via CES CSS custom properties, which don't respond to `color-scheme`.
   Result: dark fields on a light page, and light-on-white text once the browser and
   app disagree.

2. **Secondary — no form element in the codebase sets an explicit background or text
   color.** Every input/textarea/select uses only border and focus Tailwind classes,
   so nothing blocks the UA dark defaults. ~20 callsites are affected across
   `CustomerForm`, `AnswerInput` (SIT), `RRQuestionPage` / `EvidenceCollector` /
   `ProvenanceSelector` (RRT), `LoeRateEditor`, `MPTGenerator`, and the shared
   `Select` / `TextArea` wrappers.

## Best-Practice Research (WCAG 2.2 AA)

| Element | Requirement | Threshold |
|---|---|---|
| Input text vs. field background | SC 1.4.3 | 4.5:1 |
| Placeholder text | SC 1.4.3 | 4.5:1 (gray-400 on white **fails** at 2.6:1) |
| Field border vs. page surface | SC 1.4.11 | 3:1 |
| Focus ring vs. adjacent surface | SC 2.4.11 (new in 2.2) | 3:1 |

Key practices adopted:
- `color-scheme` must be tied to the **app's** theme gate, never left as `light dark`
  when the app controls its own toggle.
- Form fields need explicit background/text/placeholder colors — never rely on UA
  defaults.
- Chrome/Safari autofill can only be overridden with the
  `-webkit-box-shadow: inset` + `-webkit-text-fill-color` technique.

## Recommended Fix (single file: `src/index.css`)

Four edits — no React component changes:

1. **Line 29:** `color-scheme: light dark` → `color-scheme: light`.
   *The one-word fix that stops the browser from dark-painting form controls on a
   dark-mode OS while the app is light.*

2. **Line 149:** prepend `color-scheme: dark;` as the first property inside the
   `[data-theme="dark"]` block. *Binds native browser rendering (scrollbars, date
   pickers, select arrows) to the app's own theme toggle.*

3. **Inside the existing `@layer base` block (before its closing `}` at line 73):**
   a token-driven reset for all text-entry controls:

   ```css
   input:not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="file"]):not([type="color"]):not([type="image"]):not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):not([type="range"]),
   textarea,
   select {
     background-color: var(--co-surface);
     color: var(--co-text);
     border-color: var(--co-border);
   }

   input:not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="file"]):not([type="color"]):not([type="image"]):not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):not([type="range"])::placeholder,
   textarea::placeholder {
     color: var(--co-text-muted);
   }
   ```

   Because the `[data-theme="dark"]` block already overrides these tokens, dark-mode
   field colors resolve automatically. Cascade-layer ordering guarantees any Tailwind
   utility class on a component still wins, so this is a safe floor for every current
   and future field with zero per-callsite edits.

4. **After line 161 (non-layered):** Chrome/Safari autofill override using hardcoded
   hex matching the CES tokens (`#ffffff`/`#0f172a` light, `#1e293b`/`#f8fafc` dark),
   commented with their token equivalents.

## Why this approach over per-component classes

The base-layer reset covers all ~20 affected callsites (including the shared
`Select.tsx` / `TextArea.tsx` wrappers flagged P0 in review) in one place, uses the
same token values a per-component fix would hardcode, and automatically covers any
future form element. Per-component `bg-white text-gray-900` hardening remains an
optional defense-in-depth follow-up.

## Verification Plan

- `npm run lint` (zero warnings) and `npm run build` must pass
- Light OS: fields show white background, dark text, visible placeholder
- **Dark OS + light app theme (the reported bug):** fields must NOT be dark;
  scrollbars and date-picker chrome render light
- Dark OS + app dark theme: fields show `#1e293b` background, `#f8fafc` text;
  scrollbars/date-picker render dark
- Chrome autofill: no yellow/blue overlay in either mode
- Submit buttons, file pickers, color swatches visually unchanged

## Deferred (separate slices)

- Per-component Tailwind class hardening (defense-in-depth)
- Focus-ring token harmonization (`ring-primary-500` vs `ring-blue-500`)
- `AnswerInput.tsx` corner-radius design divergence
- Custom `<select>` arrow (`appearance-none` + SVG) for cross-browser polish
