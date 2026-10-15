# REQ — ces-shared: promote the EO signal-registry overlay; fix the L1/L2 key duplicates

- **Filed by:** ces-eo (FC-EO-D, EO-03, 2026-09-28)
- **Target:** ces-shared `src/data/control-signal-registry.json` (+ `dist`)
- **Status:** DONE (2026-09-28, verified by FC-EO-H) — `ces-shared` commit `cb00a20` (FC-SH step 3, part of
  ces-shared 2.8.0): the 6 overlay entries copied in verbatim, all 13 non-reference-id duplicates dropped
  (siblings intact), `MP.L1-3.8.3` re-keyed to `manualGateEvaluator` (not the capability evaluator).
  Re-verified directly against the shared asset (`ces-shared/dist/data/control-signal-registry.json`):
  107 keys, the 6 overlay ids present with unchanged `signals`/`evaluator`, all 13 duplicate keys absent,
  `MP.L1-3.8.3` -> `manualGateEvaluator`. ces-eo deleted `eoRegistryOverlay.ts`/`effectiveRegistry.ts` and
  updated `tests/unit/claim-accuracy.test.ts` accordingly (FC-EO-H step 1).

## Problem
1. EO-03 raised automatic-signal coverage from 79/110 to 85/110. The six new control→signal entries live in an
   EO-owned overlay (`ces-eo/src/eo/mapping/eoRegistryOverlay.ts`) because the registry is a ces-shared asset. Any
   other consumer of the shared registry still sees 79.
2. The shared registry has 13 keys that are not reference ids. Each is an L2-tagged duplicate of an L1 reference control:
   `AC.L2-3.1.1`, `AC.L2-3.1.2`, `AC.L2-3.1.20`, `AC.L2-3.1.22`, `IA.L2-3.5.1`, `IA.L2-3.5.2`, `MP.L2-3.8.3`,
   `SC.L2-3.13.1`, `SC.L2-3.13.5`, `SI.L2-3.14.1`, `SI.L2-3.14.2`, `SI.L2-3.14.4`, `SI.L2-3.14.5`. EO evaluates both,
   so a duplicate produces an assessment row for a non-reference control id.
3. `MP.L2-3.8.3` → `mediaDisposalEvaluator` is the **only** entry for practice 3.8.3; the reference id is
   `MP.L1-3.8.3`, which has no entry. That evaluator returns `met` whenever managed devices exist ("remote wipe capable").
   That is SAT on capability, not on sanitization. **Do not simply re-key it:** doing so would add +1 coverage on an
   intent-based verdict. EO deliberately did not count it (see `ces-eo/docs/SIGNAL-COVERAGE-2026-09-28.md` row 14).

## Ask
- Copy the six overlay entries (`AT.L2-3.2.1`, `AT.L2-3.2.3`, `AU.L2-3.3.5`, `PS.L2-3.9.2`, `RA.L2-3.11.2`,
  `SC.L2-3.13.7`, same `signals` and `evaluator`) into the shared registry, replacing their `manualGateEvaluator` entries.
- Resolve the 13 duplicates: keep the reference-id entry, and drop the L2 duplicate or merge its signals into it.
- `MP.L1-3.8.3`: add a manual-gate entry, not the current capability evaluator.

## Acceptance
In ces-eo, `tests/unit/claim-accuracy.test.ts` shows the shared asset alone at 85, and the overlay merge becomes a no-op
(`mergeRegistryOverlay` never overrides a shared graph entry, so this is safe to land in either order). EO will then
delete the overlay and update the test.
