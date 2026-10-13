# REQ-PLANNER-MPT-DATA-RACE — filed against ces-planner (from ces-tester, 2026-07-25)

**Boundary note:** ces-planner is read-only from this repo. This is a requirement doc, not
a patch. Founder routes it.

## Defect

`useMissionPlanGenerator` (`src/features/mpt/hooks/useMissionPlanGenerator.ts`) can
generate a silently degenerate Mission Plan when "Create Mission Plan" is clicked before
its data banks finish loading:

1. The 9 `useDataLoader` hooks (`useCMMCRequirements`, `useEvidenceMatrix`,
   `useAssessorKB`, capability taxonomy/patterns/playbook, etc.) reset to
   `data: null, loading: true` on **every mount** (`useDataLoader.ts` — `useState` +
   `useEffect`, no suspension of consumers while loading).
2. `generate()` substitutes empty fallbacks for any bank still null:
   `cmmcRequirements || { requirements: [] }`, `evidenceMatrix || {}`, vendor
   capabilities with undefined members (lines ~134-160).
3. With empty gap-classification inputs, `compileGapSet`/`gapCompiler.ts` finds no `gap`
   for any control and falls through (`gapCompiler.ts:244-247`) to
   `stamper_action = 'Non-Stack'` → `directive: 'manual'` for every ordinary control.

Result: a structurally valid plan whose control directives are ~all `manual` — it
translates to **zero** `set_command`s in Stamper and executes vacuously. No error, no
warning surfaced to the user; the button is enabled the moment `hasPosture` is true,
independent of data-bank readiness.

## Observed live (ces-tester gp-m1-gate-1, 2026-07-26T00:49Z)

`exo-protection-baseline` scenario under `run-all` (loaded machine): mission plan with
**100 of 110 directives `manual`** (healthy comparison run: same answers, 100
`implement`), `set_sub_count: 0`, both expected_state checks failed with "0 mutations —
nothing ever wrote this state". Same scenario in isolation (idle machine): healthy plan,
PASS. The landing page remounts (and all 9 banks reload) right after the final wizard
save; a click within the reload window loses the race.

## Requirement

Either (a) gate the "Create Mission Plan" action's enabled state (or `generate()`'s
entry) on all data loaders having resolved, or (b) make `generate()` fail loudly when a
required bank is null instead of substituting empty fallbacks. (a) preferred — the
fallbacks also mask partial-bank corruption.

## ces-tester-side mitigation (already shipped, this repo)

`driveMuster` now detects the race signature (directives present, zero `implement`) and
re-clicks generation up to 3 attempts (`src/muster-driver/drive-muster.ts`,
`countImplementDirectives`). This is a workaround, not a fix — human users of the real UI
hit the same silent degenerate plan.
