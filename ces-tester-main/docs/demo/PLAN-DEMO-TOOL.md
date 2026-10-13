# Plan: `demo:show` — the CES presentation demo tool

**Date:** 2026-09-03
**Status:** READY FOR IMPLEMENTATION
**Home:** `ces-tester` (all new code). **Branch:** feature branch off `gp-demo-3`.
**This file is the plan.** Root `PLAN.md` is the frozen 2026-07-10 foundational plan, referenced
by line number elsewhere — **never write to it.**

## Acronym legend (coined here)

| Term | Meaning |
|---|---|
| S0–S6 | Build **slices** of the iterate loop (§Loop) |
| A1–A8 | **Acceptance checks** the loop repeats until all pass (§Goal) |
| FD-1–FD-4 | The four **founder decisions** locked 2026-09-03 (THREAD_HANDOFF.md §Locked decisions) |
| TT | **Talk track** — the narration column of the .xlsx |
| Deck | One loaded demo definition = one `demos/*.xlsx` |
| Op | The app-pane action a slide is paired with (`live`/`warm`/`staged`) |

## Objective

Turn ces-tester into an operator-facing presentation demo runner: a landscape 16:9 **slides
window** auto-rendered from a `demos/*.xlsx` demo definition narrates the product while a
separately positioned **portrait headed-Playwright window** drives real CES tool GUIs in sync.
Manual nav (next/prev/first/last/exit) and auto-pacing both supported; multiple decks, one per
.xlsx, primed externally.

## Context Summary

- **From THREAD_HANDOFF.md (binding):** FD-1 app pane = a second real headed browser window,
  reusing `ui-page.ts` / `watch-mode.ts` / `gui-servers.ts`. FD-2 hybrid per-slide op mode
  `live | warm | staged`. FD-3 per-slide `duration (sec)` with a configurable default; a slide
  whose op is still running **holds** until the op completes, then dwells; manual advance always
  available. FD-4 slides auto-rendered 16:9 from row fields with a consistent CES theme, plus an
  optional `image` override/augment.
- **From RESEARCH_SUMMARY.md (binding):** use `read-excel-file` (v9) via the **named `readSheet`
  export** — `readXlsxFile(path).then(rows => …)` is the pre-v9 form and is **wrong**; blank cells
  arrive as `null`. Two independently positioned windows require **two `chromium.launch()` calls**
  (`--window-position` + `--window-size`, never `--start-maximized`), each with
  `newContext({ viewport: null })`. Slides page = one `node:http` server serving the HTML **and**
  a `GET /events` SSE stream, with nav POSTed back to `/nav`; serve over HTTP, never `file://`.
- **From REVIEW.md / GAP_ANALYSIS.md:** N/A — both are July 2026 artifacts about the M0–M5 core
  ladder and G-TESTER-1; nothing in them bears on this feature. `docs/context/MODULE_MAP.md` is
  **stale** (2026-07-27, predates `src/demo/*`) — do not trust it; read the source.
- **Constraints:** two-entities boundary — siblings consumed over existing CLI/HTTP/GUI surfaces,
  read-only; **all writes land in ces-tester**. Windows-only; Stamper spawns use Windows
  PowerShell 5.1. Gates on every slice: `npx tsc --noEmit` + `npm test` clean.

## Goal and acceptance checks

**Goal:** a full demo run plays end-to-end from a primed `demos/*.xlsx` — slides render, nav and
auto-pacing work, and app ops line up with the narration.

- **A1** `demo:show --check demos/ces-overview.xlsx` exits 0: deck loads, every slide renders, the
  whole deck walks front-to-back headless with ops forced `staged`.
- **A2** Rows sharing a `slide #` are grouped onto **one** slide, in sheet order.
- **A3** A malformed .xlsx fails load with per-row, 1-based-sheet-row errors and exit code 2 —
  never a partial render.
- **A4** Operator run opens **two** windows: slides landscape 16:9 left, app pane portrait right.
- **A5** Manual nav works from both the slides page and the terminal: next, prev, first, last, exit.
- **A6** Auto-pacing honors per-slide `duration (sec)`, falls back to `--default-dwell` (30 s) when
  blank, and **holds** past the dwell while a slide's op is still running.
- **A7** At least one **real live op** drives a real CES tool GUI in the app pane, end-to-end.
- **A8** Exit (`Esc`/`q`/Ctrl-C) tears down both browsers, the slides server, spawned GUI servers
  and stacksim serve — no orphaned processes, no held ports.

## The loop (this plan is a loop, not a linear pass)

Repeat until A1–A8 all pass:

1. Build the next slice (S0→S6; do not batch slices).
2. Gate: `npx tsc --noEmit` **and** `npm test` — both clean before the slice is done.
3. Run the acceptance check available at that slice (`demo:show --check …` from S2 onward; the
   operator run from S3 onward).
4. Append findings/gaps to `docs/demo/DEMO-ITERATION-LOG.md` under a **new**
   `## GP-DEMO-4 — demo:show iteration log` heading — append only, never rewrite GP-DEMO-1 content.
5. If any check regressed or a gap opened, the next slice fixes it before new scope.

### Slices

- **S0 — deps + fixture generator.** Add `read-excel-file` (dep) and `fflate` (devDep). Write
  `scripts/make-demo-xlsx.mjs`: a minimal OOXML writer (zip via `fflate.zipSync`) emitting
  `demos/ces-overview.xlsx` — ~8 slides, several multi-row, a mix of op modes, one blank duration.
  Prefer `t="inlineStr"` cells (no `sharedStrings.xml`); **if the S1 round-trip test shows
  `read-excel-file` will not read inline strings, fall back to a real `sharedStrings.xml`.**
- **S1 — loader + validation.** `deck-model.ts`, `xlsx-loader.ts`, `deck-validate.ts`,
  `schemas/demo-deck.schema.json`. **Gate = the round-trip test:** generate the fixture, load it
  with our own loader, assert the grouped slide model. Satisfies A2/A3.
- **S2 — render + state + check runner.** `slide-render.ts`, `show-state.ts`, `demo:show --check`.
  Satisfies A1; A5/A6 provable at the pure-state level in unit tests.
- **S3 — slides server + operator run.** `slides-server.ts`, `app-pane.ts`, `show-run.ts`,
  `src/cli/show-command.ts`, CLI registration. Satisfies A4/A5/A6/A8.
- **S4 — op registry + staged/warm plumbing.** `op-registry.ts`; staged replay page; warm ops
  started in the prep phase and awaited on slide arrival.
- **S5 — the first real live op (A7).** `arm-sim.ts` + `ops/ao-registry-op.ts`.
- **S6 — polish from the log.** Whatever S0–S5 filed as gaps; then re-run A1–A8.

## Design decisions

- **Data model:** deck → slides keyed by `slide #` (ascending) → one or more content rows each.
  Per-slide op spec (tools, mode, opId, durationSec, images) resolves by **unique-or-agree**:
  blank cells inherit from the slide's other rows; two rows on the same slide carrying *different*
  non-blank values for the same op field is a **validation error**, never a silent first-wins.
- **Row errors cite the 1-based spreadsheet row** the founder sees in Excel (header is row 1, so
  data row *i* is sheet row *i+1*): `demos/ces-overview.xlsx row 7: "op mode" must be one of
  live|warm|staged (got "livee")`. Collect **all** errors, print them, exit 2.
- **Columns** (headers normalized: lowercased, non-alphanumerics stripped, aliases accepted):
  `slide #` (required, integer ≥ 1), `talk track`, `feature`, `function`, `benefit`,
  `differentiator`, `tools` (comma-separated subset of stacksim|muster|stamper|ao|eo), `op mode`,
  `op` (registry id, optional), `duration (sec)`, `image`. Unknown columns are ignored with a
  warning; unknown `op` id is an error.
- **Rendering** follows the house precedent in `src/results/dashboard-generator.ts`: styled HTML
  shell with the whole deck **inlined as JSON** at generation time; the page is a dumb renderer.
  Feature = title, function/benefit/differentiator = cards, TT = a presenter band (toggle `t`).
  `image` renders in place of / beside the auto-rendered body; images resolve **relative to the
  .xlsx's directory**, are served from `/asset/<id>` and are path-traversal-guarded to under
  `demos/`. A missing image file is a load-time error.
- **Server-authoritative state.** `show-state.ts` is a pure reducer (index, dwell deadline, op
  status); `slides-server.ts` owns it, broadcasts over SSE, and the page only renders. The pacing
  timer lives in the server, never the browser.
- **Ports:** slides server default **4500**, overridable with `--slides-port`. Avoid-list is
  **five**, not three: 3000 stamper GUI, 3001 ao GUI, 4390 stacksim, 4002 eo, 5173 muster
  (`DEMO_PORTS` in `src/cli/demo-command.ts`). Probe the chosen port at startup with the exported
  `probePort` from `src/demo/preflight.ts` and fail with a clear message if taken.
- **Two windows, two launches.** Slides: `--window-position=0,0 --window-size=1280,720`. App pane:
  `--window-position=1290,0 --window-size=620,1000`. Both `viewport: null`. Geometry overridable
  by CLI flags. New `openPositionedUiPage()` added to `ui-page.ts` beside `openUiPage` — do not
  change `openUiPage`'s existing signature or behavior.
- **V1 live op = AO GUI (fastest real GUI op with an existing driver):** open `ao gui` :3001 in the
  app pane, browse the command registry, run a Tier-1 **dryRun** exec. `arm-sim.ts` composes the
  already-exported helpers (`ensureSimCert`, `authorSimTenantRecord`, `createEphemeralSimTenant`,
  `getSimLaunchEnv`, `buildGuiChildEnv`, `startAoGui`, stacksim `startServe`/`waitUntilReady`) —
  **do not modify `e2e-run.ts`.** Arming is prep-phase **invisible setup** under the existing
  carve-out, completed before slide 1.
  **Operator note:** `AoServer.start` calls `open()` (see `gui-servers.ts` ~L217), popping a stray
  real browser window beside Playwright's. Harmless, but close it before starting the show.
- **Teardown (A8):** `show-run.ts` owns one disposer list, run on `Esc`/`q`, `SIGINT`/`SIGTERM`, and
  on any fatal error — closes both browsers, stops the slides server, and calls the existing
  `stop()` (`killTree`) handles for spawned GUI servers and stacksim serve.
- **`--check` mode:** headless, no windows, ops forced `staged`, walks the whole deck and prints a
  PASS/FAIL report. This is what makes the loop runnable unattended; it lands in S2.

## File Inventory

The executor is restricted to this table.

| File | Action | Notes |
|---|---|---|
| `docs/demo/PLAN-DEMO-TOOL.md` | CREATE | this plan (already written) |
| `package.json` | MODIFY | + `read-excel-file` (dep), `fflate` (devDep), `demo:show` script |
| `scripts/make-demo-xlsx.mjs` | CREATE | fflate/OOXML starter-fixture generator (S0) |
| `demos/ces-overview.xlsx` | CREATE | generated starter primed deck, checked in |
| `demos/README.md` | CREATE | column contract + how to regenerate/extend |
| `schemas/demo-deck.schema.json` | CREATE | ajv schema for normalized rows |
| `src/demo/show/deck-model.ts` | CREATE | `DemoDeck`/`DemoSlide`/`SlideRow`/`SlideOp`/`OpMode` |
| `src/demo/show/xlsx-loader.ts` | CREATE | `readSheet` + header normalize + group by slide # |
| `src/demo/show/deck-validate.ts` | CREATE | ajv + per-row 1-based errors, unique-or-agree |
| `src/demo/show/slide-render.ts` | CREATE | 16:9 HTML shell, deck inlined as JSON |
| `src/demo/show/show-state.ts` | CREATE | pure nav/pacing reducer |
| `src/demo/show/slides-server.ts` | CREATE | `node:http`: page, `/events` SSE, `/nav`, `/asset/*` |
| `src/demo/show/app-pane.ts` | CREATE | positioned portrait headed window |
| `src/demo/show/op-registry.ts` | CREATE | opId → op fn; live/warm/staged dispatch |
| `src/demo/show/ops/ao-registry-op.ts` | CREATE | the S5 real live op |
| `src/demo/show/arm-sim.ts` | CREATE | prep-phase arming; composes existing exports only |
| `src/demo/show/show-run.ts` | CREATE | runner, prep, key handling, disposer list |
| `src/cli/show-command.ts` | CREATE | `demo:show [deck] [--check] [--slides-port] […]` |
| `src/cli/index.ts` | MODIFY | register `demo:show`; extend `usage()` |
| `src/demo/ui-page.ts` | MODIFY | add `openPositionedUiPage()`; leave `openUiPage` untouched |
| `docs/demo/DEMO-ITERATION-LOG.md` | MODIFY | **append** a `## GP-DEMO-4` section per loop pass |
| `tests/demo-show-xlsx-loader.test.ts` | CREATE | round-trip + grouping + error messages |
| `tests/demo-show-state.test.ts` | CREATE | nav, dwell, hold-while-op-running |
| `tests/demo-show-render.test.ts` | CREATE | multi-row slide, image override, escaping |
| `tests/demo-show-server.test.ts` | CREATE | SSE broadcast, `/nav`, asset traversal guard |
| `tests/demo-show-op-registry.test.ts` | CREATE | mode dispatch against a fake `UiPage` |
| `tests/demo-show-command.test.ts` | CREATE | arg parsing, `--check` exit codes |

## Testing Strategy

- Unit (vitest, no browser): loader/grouping/validation, state reducer, render output, server
  routes over `node:http` on an ephemeral port, op dispatch against a hand-written `UiPage` (the
  seam exists precisely so ordering is testable — see `ui-page.ts` header).
- Round-trip: generator → own loader → asserted model. The S0/S1 gate.
- `demo:show --check`: full-deck headless walk; the loop's unattended acceptance runner.
- Manual: one operator run per loop pass, verifying A4–A8 by eye; log the result.

## Out of Scope (V1)

- Authoring/editing spreadsheets — ces-tester **loads** decks primed externally.
- The full five-tool op library. One real live op (AO) proves the seam; stacksim/muster/stamper/eo
  ops are later loop iterations.
- Recording/exporting the demo (video, PDF), remote/multi-machine control, presenter-notes second
  screen beyond the in-page band.
- Any write to a sibling repo, any `PLAN.md` edit, any change to `e2e-run.ts` / `e2e-configs.ts` /
  existing demo legs, and any push.

## Executor standing rules

- **Never write `session-ces-tester-*.md`** — the orchestrating session owns those files.
- **Never write root `PLAN.md`.**
- **Do not commit or push.** The orchestrator handles commits. If a commit is ever unavoidable,
  stage only your own files by explicit path — **never `git add -A` / `git add .`**.
- Gates before declaring any slice done: `npx tsc --noEmit` and `npm test`, both clean.
- Small green slices on a feature branch; log each pass in `docs/demo/DEMO-ITERATION-LOG.md`.

## Acceptance Criteria

- [ ] A1 `demo:show --check demos/ces-overview.xlsx` exits 0
- [ ] A2 multi-row slides group correctly by `slide #`
- [ ] A3 malformed deck ⇒ per-row 1-based errors, exit 2
- [ ] A4 two windows: 16:9 slides left, portrait app pane right
- [ ] A5 next/prev/first/last/exit from page **and** terminal
- [ ] A6 per-slide duration honored, 30 s default, holds while op runs
- [ ] A7 one real live CES GUI op drives the app pane end-to-end
- [ ] A8 clean teardown — no orphaned processes or held ports
- [ ] `npx tsc --noEmit` + `npm test` clean at every slice
- [ ] `docs/demo/DEMO-ITERATION-LOG.md` carries a GP-DEMO-4 entry per loop pass
