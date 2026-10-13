# REQ-TESTER-STAGE-SIMPLIFY — simplify the demo:show stage (founder directive)

**From:** ces-strategy · **To:** ces-tester · **Date:** 2026-09-06 · **Status:** ROUTED
(founder-approved 2026-09-06; copy at `ces-tester/docs/requirements/REQ-TESTER-STAGE-SIMPLIFY.md`)

Founder direction (2026-09-06, verbatim intent): *"get rid of the telemetry and footer
stuff on right side … the app pane needs to be bigger and run top to bottom — it may need
half the width."* Strategy's HTML preview already implements this look; this REQ asks
tester's `demo:show` stage to match.

## Asks

1. **Remove the telemetry rail** (`slide-render.ts` `railHtml` / `.rail`, the
   Tell·Show·Tell stops + Op/Mode/Status/Tools/Dwell/Slide readouts) from act slides.
   The "Now" lozenge may stay — it reads as content, not chrome.
2. **Remove the right-side chrome cluster** from the bottom bar: the op pill, the mode
   pill, the clock, and the keyboard-hints chips. Keep: dots + Prev/Next/Exit (founder
   requested those 2026-09-05) and the dwell bar. If the operator still needs op/mode
   state, put it in presenter-only surfacing (e.g. the presenter band), not on stage.
3. **App pane: half width, full height.** When the in-slide app mirror / act readout
   lands (DEMO-ACTS-CONCEPT §6, our REQ-TESTER-DEMO-RICHNESS ask), the pane should span
   the slide area **top to bottom** beside the content column at **up to 50% width** —
   not a lower-right inset. Strategy's preview renders this exact layout (cards left at
   ~50%, pane right 50%, full height) and our authored card text is being written to fit
   the narrower column.

## Notes

- Strategy's preview (`scripts/preview_demo.py` → `DEMOS/<name>/out/<name>-preview.html`)
  is the visual reference for the simplified stage.
- Our decks already carry `right-third` (app | image | absent) declaring which slides
  expect the pane.
- Claim-bar/honesty rules unaffected; this is stage chrome only.
