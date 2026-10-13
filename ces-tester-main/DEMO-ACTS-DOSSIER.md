# Demo-Acts Dossier

**What this is.** The reference definition of every **demo-act** — for humans and for AI. One entry
per act: what it does, what must be true before it runs, what is true after, what goes in, what
comes out, how it fails, and **how a test proves it worked**.

**Design rationale lives elsewhere — this file does not repeat it.** See
`docs/demo/DEMO-ACTS-CONCEPT.md` (§2 the act abstraction · §3 the catalog · §4 doctrine · §6 the
in-slide mirror · §7 the Muster correction) and `docs/demo/PLAN-DEMO-RICHNESS.md` (the build).

---

## AS OF

| | |
|---|---|
| **Date** | 2026-09-06 |
| **Branch / HEAD** | `gp-demo-4` @ `ae6fa85` *(GP-DEMO-5 muster Slice 3.3/3.4; GP-DEMO-6 adds `muster-rollup` (D.17) atop it — ALL 17 acts IMPLEMENTED)* |
| **Build state** | ✅ **Settled.** The five original ops plus `ao-make-change`, `eo-show-change-captured`, `simstack-create`, `simstack-destroy`, `muster-connect-tenant`, `muster-auto-analysis`, `muster-consent-and-attest`, `muster-adaptive-interview`, `muster-generate-sprs-mp` and `muster-rollup` are committed and deck-invocable — **all 17 acts are IMPLEMENTED**; PLAN-DEMO-RICHNESS finished. The act-test harness (`demo:acts-test`, `docs/demo/ACT-HARNESS.md`) is committed through its pacing slice, and every figure below marked MEASURED comes from its `--full` run `acts-full-1` on 2026-09-06. GP-DEMO-4 Slice 1A adds `eo-verify-evidence` (D.15, run `ev-1a-2`); Slice 1B registers `ao-make-change` (D.12, run `amc-1b-1`); Slice 1C registers `eo-show-change-captured` (D.16, run `escc-1c-1`). |
| **Rule applied** | Status tracks **deck-invocability of committed code**, not code that exists in someone's working tree. Nothing below is called IMPLEMENTED unless it is committed *and* a deck can name it today. |
| **Doctrine change** | ⚠ **2026-09-06 — founder decision 9: the RE (Muster) no-live restriction is LIFTED.** Muster may be demoed live. The no-live rule now applies to **Config (Stamper) only**; hub-and-spoke remains the Config format. **Every honesty guard survives the lift** (A.5) — the fixture-button rule especially. |

---

## A. Using acts — read this first

### A.1 How a deck invokes an act **today**

A deck is an `.xlsx` in `demos/`. Two columns select an act (`demos/README.md` is the contract):

| Column | Accepts | Notes |
|---|---|---|
| `op` | `simstack-create` · `simstack-destroy` · `ao-registry` · `ao-make-change` · `eo-review` · `eo-show-change-captured` · `muster-readiness` · `muster-connect-tenant` · `muster-auto-analysis` · `muster-consent-and-attest` · `muster-adaptive-interview` · `muster-generate-sprs-mp` | The act id. An unknown id is a **load error** (exit 2). Aliases: `op id`, `operation`. |
| `op mode` | `staged` · `warm` · `live` | Blank ⇒ `staged`. Alias: `mode`. |

**All three former gaps are now closed** (verified 2026-09-06 by `demo:acts-test --docs-only`):
- **The parameters column ships.** `CANONICAL_COLUMNS` (`src/demo/show/xlsx-loader.ts`) now carries
  it alongside `theme`, `show` and `watchouts`. Every **PARAMS** field below on a registered act is
  a knob you can turn today, validated against the op catalog at load time.
- **The `act` / `demo act` aliases ship** for the `op` column (`HEADER_ALIASES`).
- **The op catalog is published** at `docs/demo/OP-CATALOG.md`, with measured warm costs.

**What does NOT exist yet — do not author against it:**
- **No deck-cell resolution for the alias presets.** `ACT_ALIASES` (`op-catalog.ts`) is committed
  as DATA ONLY, so a deck cell must still name a registered op id. `eo-verify-evidence` is a name
  you can read here but not yet a name you can type into a spreadsheet.

Op fields are **per slide, not per row**, and resolve by unique-or-agree: a blank cell inherits;
two rows on one slide with different non-blank values is a validation error.

### A.2 Mode semantics

| Mode | When it runs | Slide behavior |
|---|---|---|
| `staged` | Never — replay only | Renders an honest placeholder naming the act that *would* have run (`stagedReplayHtml`, `op-registry.ts`). **`--check` forces this for the whole deck**, so `--check` never reaches an implementation. |
| `warm` | During **prep**, before slide 1 | Pays an expensive half off-stage; the slide awaits it on arrival. |
| `live` | On slide entry | The slide **holds past its dwell** until the act completes, then dwells normally. Manual advance always available. |

### A.3 The two ordering rules that actually bite

1. **Warm acts fire during prep in DECK ORDER through one serialized queue**
   (`op-registry.ts` — "Ops are SERIALIZED through one promise chain"). The app pane is a single
   page; two Playwright flows interleaving on it is a mid-demo failure with no useful error.
2. **A slide with no act leaves the pane untouched** — that is what lets a warm result stay on
   screen until its own slide arrives. **But an act that navigates the pane destroys the page state
   an earlier warm act left.** `ao-registry` calls `ctx.pane.goto(baseUrl)` unconditionally, so
   placing it between `eo-review` warm and `eo-review` live forces the (honest, slower) self-heal
   re-assess. Order decks accordingly.

### A.4 Arming, prep cost, and teardown

`prepare()` arms **only the surfaces the deck's non-staged acts actually need** (`armingFor`), then
acts run. A deck with zero live/warm acts arms nothing. Arming brings up the stacksim serve and,
conditionally, the AO GUI (:3001) and the EO server (:4002). Evidence lands in a run-scoped
`runDir`. Teardown stops what arming started.

**Prep-time budget is real:** a warm chain is serialized, so its wall time is the *sum* of its acts
(MEASURED 2026-09-06: EO assess ≈ 5 **seconds**, Stamper translate ≈ 5 min, Stamper execute ≈ 13 min). Founder decision 6 (2026-09-06) accepts this with a
`--check` budget warning above 300 s.

### A.5 Honesty rules — binding on every act and every talk track

1. **Never narrate fixture data as live.** ces-muster's SPA "Run Discovery" button loads
   `DISCOVERY_RESULTS_FIXTURE` with zero network (`ces-muster/src/features/app/App.tsx` L253-254).
   Only the CLI lane runs the real walk. (CONCEPT §7.2 step 2.)
2. **Never narrate marketing copy as this run's results.** ces-muster's offer screen ships
   "41.6% of objectives", "87.3%", "150 minutes" as product copy (`discoveryOfferCopy.ts` L7-11).
3. **Numbers come from the API or the artifact, never scraped from the DOM.** The DOM is what the
   audience sees; the judged number comes from the tool's own surface (`eo-review-op.ts` reads
   `/api/assessment` + `/api/sprs`).
4. **Tally all four postures** — `met`, `not_met`, `partial`, `unknown` — named, never dropped
   (`demos/README.md`).
5. **Invent no score.** DISCOVERY-1 produces **no readiness score** (founder decision 5 makes
   saying so an allowed stage claim). EO's SPRS is a different number from a different tool.
6. **A staged replay is never dressed as a live run.** That is the failure this harness exists to
   prevent.

### A.6 Doctrine gate

**Founder decisions 2026-09-06 (`docs/context/THREAD_HANDOFF.md`), binding:**
- **Item 2** — RE and Config get no live product demo. ⚠ **SUPERSEDED: RE by item 9, Config by
  decision 11.**
- **Item 8** — when the in-slide mirror (T1.5) lands, `mirror: none | theatrical` is a **mandatory
  per-act opt-in**. ⚠ **Config acts no longer stay `mirror: none` — decision 11 flips the Config
  pair to `theatrical`, streaming from the backstage session (`mirrorSource: backstage`).**
- **Item 9 (later the same day) — the RE restriction is LIFTED.** Muster **may** be demoed live;
  `mirror: theatrical` is permitted for Muster acts at T1.5. The no-live rule then applied to
  Config (Stamper) only.
- **Decision 11 (2026-09-07) — the Config restriction is LIFTED too.** The Configuration (Stamper)
  GUI may now be demoed live, but it is streamed from the **headless backstage session** on
  `/mirror/backstage` (`mirrorSource: backstage`), never by driving the visible pane — so the
  execute-only fast-path state is preserved and the pane's own surface is never disturbed. Every
  honesty guard survives (judge `result.report`, never the badge; the rotating AZ class stays an
  honest act-red). §8 record-replay stays out of scope.

**Why item 9 happened:** item 2 was decided on the incorrect premise that Muster had no GUI
(CONCEPT §7.4). It does — a React SPA with 76 `data-testid` hooks. The correction was surfaced and
the founder lifted the restriction.

**What did NOT change:** every honesty guard in A.5 survives the lift — above all the
**fixture-button rule** (A.5 #1). Being allowed to demo Muster live is *not* permission to click
its Run Discovery button and narrate canned data.

| Capability | Live product demo? | `mirror` at T1.5 |
|---|---|---|
| **RE (Muster)** | ✅ **YES** — decision 9 | `theatrical` permitted |
| **Ops (AO)** | ✅ YES | `theatrical` |
| **Assessment (EO)** | ✅ YES | `theatrical` |
| **Config (Stamper)** | ✅ **YES** — decision 11 (from backstage, `/mirror/backstage`) | `theatrical` (`mirrorSource: backstage`) |

---

## B. Status summary

| Status | Count | Acts |
|---|---|---|
| **IMPLEMENTED** (committed + deck-invocable now) | **16** | `simstack-create` · `simstack-destroy` · `ao-registry-command` · `ao-make-change` · `eo-assess` · `eo-browse-determinations` · `eo-verify-evidence` · `eo-show-change-captured` · `muster-readiness` · `muster-connect-tenant` · `muster-auto-analysis` · `muster-consent-and-attest` · `muster-adaptive-interview` · `muster-generate-sprs-mp` · `stamper-translate` · `stamper-execute` |
| **IN-BUILD** | **0** | — |
| **PROPOSED** | **0** | — |

**Note on the three `eo-review` views:** `eo-assess`, `eo-browse-determinations` and
`eo-verify-evidence` are all the committed `eo-review` op. It branches on op mode — `warm`
assesses, `live` walks the result — and the `land` parameter chooses where the walk ends. They are
**one op id with three deck-expressible configurations**, not three implementations; giving each a
name a deck cell can carry needs alias resolution, not new code.

---

## C. The per-act template

Every entry below fills exactly these fields, in this order:

`ID` · `PURPOSE` · `STATUS` · `TARGET` · `GRADE` · `MODES` · `PARAMS` · `PRECONDITIONS` ·
`POSTCONDITIONS` · `INPUTS` · `OUTPUTS` · `FAILURE MODES` · `SUCCESS (TESTABLE)` · `DOCTRINE` ·
`DRIVER` · `SUGGESTED TALK-TRACK`

### C.1 About `SUGGESTED TALK-TRACK`

**These are suggestions, not script.** Strategy owns deck content and morphs these into the story;
they are act-level *explanatory* lines — what the presenter says while **this act runs** — not the
narrative arc. The arc doctrine (THREAD_HANDOFF "Narrative doctrine": problem → pain → approach →
benefit → differentiator) governs the deck; these lines only have to make the moment on screen
legible, and land a pain-removal or differentiator note where one falls naturally.

**How to use them.** Each line is plain presenter prose with no markdown, tied to a visible beat of
the act, so a deck author can paste one straight into a `talk track` cell. A multi-row slide takes
several lines, one per row, in order.

**Future, not this pass:** a loader could publish these from the act catalog so authors pull them
instead of retyping (relates to REQ 4a's op catalog and the reserved presenter columns `show` /
`watchouts`). **No schema or code is proposed here — words only.**

**Every honesty guard in A.5 binds these lines.** None of them may claim a readiness score Muster
does not produce, narrate fixture or marketing figures as tenant results, or treat the Stamper
status badge as authoritative. Warm acts get a line that says plainly the work ran during
preparation rather than pretending it is running now.

**Visual grades:** `CURSOR` (real UI, real pointer — requires the T1 theatrical layer) ·
`TERMINAL-THEATER` (real CLI stdout, BHD-styled — T2) · `READOUT` (a result card rendered via
`htmlDataUrl()`).

**`SUCCESS (TESTABLE)` has two tiers:**
- **Registration** — assertable by `demo:show --check` (exit **0** pass / **1** checked-and-failed /
  **2** unloadable or bad invocation, `src/cli/show-command.ts` L243-247). `--check` forces `staged`
  and **never reaches an implementation**, so it proves the id loads, nothing more.
- **Behavior** — assertable only by unit seams (a hand-written `UiPage`, an injected spawn) or the
  headless end-to-end proof harness.

---

## D. The acts

### D.1 `simstack-create`

- **ID** `simstack-create`
- **PURPOSE** Stand up the deliberately half-configured demo tenant so the story's gap is *shown*, not asserted.
- **STATUS** **IMPLEMENTED** — committed (GP-DEMO-4 Slice 2A). `src/demo/show/ops/simstack-create-op.ts`; registered in `DEMO_OP_IDS`. A **READOUT over the armed state**, not a live re-seed: arming seeds before it serves (an exclusive lock), so the act presents what prep built and proves it. Runtime-verified by `demo:acts-test --act simstack-create` (run `sc-2a-1`).
- **TARGET** tenant-stacksim · HTTP serve · **:4390**
- **GRADE** READOUT today (TERMINAL-THEATER once T2 lands; no GUI exists for stacksim)
- **MODES** `staged` replay · `warm` present during prep · `live` present on entry. **Every mode PRESENTS what arming built — none re-seeds.** A live re-seed would be dishonest (arming already seeded, under an exclusive lock) and would fork the arming path ACT-HARNESS.md forbids.
- **PARAMS** none — this act reads only ctx.armed and takes no knobs.
- **PRECONDITIONS** Port 4390 free (`STACKSIM_PORT`, `arm-sim.ts:59` — "probed, never assumed free"); Windows + a real sibling `tenant-stacksim` checkout; the serve is armed BEFORE any op runs (stacksim holds an exclusive lock while seeding — `needle-run.ts:103-104` — which is why arming seeds *before* it serves, and why this act cannot re-seed).
- **POSTCONDITIONS** The armed sim tenant is presented: the sim answers `GET /v1.0/policies/authorizationPolicy`, the registry record has four valid auth fields, and the report-only gap is shown. **Deliberately does NOT** re-seed, touch any real tenant, or remediate the gap — the gap is the point.
- **INPUTS** `stacksimRoot`; slug (`SHOW_SLUG = 'demo-dib-small'`, `arm-sim.ts:56`); `runDir`.
- **OUTPUTS** Terminal-theater transcript; ledger create rows; the armed `simUrl` + `slug` every later act consumes.
- **FAILURE MODES** Port busy → arming **aborts before slide 1** with a message naming the ports and pointing at `demo:reset` (correct: fail in prep, never on stage). A **live** record already at that slug → `createEphemeralSimTenant` refuses. Cert not installable → `ensureSimCert` throws; the Connect gate is explicitly not something to degrade around.
- **SUCCESS (TESTABLE)** *Registration:* `--check` on a deck naming `simstack-create` exits 0. *Behavior* (runtime-verified GP-DEMO-4 Slice 2A, run `sc-2a-1`): the harness `simstack-create` group asserts **SC1** the sim answers `GET /v1.0/policies/authorizationPolicy`; **SC2** the registry record (`<runDir>/tenant-root/sim/<slug>.json`) has all four auth fields valid via `missingSimTenantAuthFields` — no `SIMTHUMBPRINT…` placeholder, **absolute** `cert_path`; **SC3** the deliberate gap is present — `caPolicy-1` is `state: 'enabledForReportingButNotEnforced'` (report-only, **not** absent).
- **DOCTRINE** Not gated — stacksim keeps its name and is first-class product.
- **DRIVER** None needed (CLI/HTTP).

> ⚠ **CORRECTION — the demo gap is NOT an absent MFA policy.** `DEMO-ACTS-CONCEPT.md` §3 says
> *"MFA policy absent"*; the implementation disagrees and the implementation is right.
> `tenant-stacksim/scripts/build-demo-scenario.mjs:83-95` PATCHes `caPolicy-1` to
> `state: 'enabledForReportingButNotEnforced'` — **the policy exists and is report-only**:
> *"the MSP set up an MFA policy six months ago in report-only mode and never flipped it to
> enforced."* The control is `DEMO_MFA_CONTROL_ID = 'IA.L2-3.5.3'` (`src/demo/needle-run.ts:52`);
> expected facts `iam-001` / `iam-004` = `no`.
> **Consequence that must not be narrated wrong:** because the policy is *present*, Muster's
> presence-based DISCOVERY-1 reads `IA.L2-3.5.3` as **`met`** before any remediation. Gap depth
> belongs to the Assessment (EO) beat. The correct narration is *"report-only, never enforced"*,
> never *"absent"*. (Concept doc correction logged in §E.)

- **SUGGESTED TALK-TRACK**
  - I'm standing up a tenant that looks like the ones we actually walk into — not a clean lab.
  - Watch the ledger fill in as the estate builds itself.
  - Here is the gap we are going to chase. There is an MFA policy. It has sat in report-only mode for six months and nobody ever turned it on.
  - That is most of the environments we assess. Not missing. Just never finished.

### D.2 `simstack-destroy`

- **ID** `simstack-destroy`
- **PURPOSE** Tear the ephemeral demo tenant down cleanly — the "leave no trace" beat, and the rehearsal-reset primitive.
- **STATUS** **IMPLEMENTED** — committed (GP-DEMO-4 Slice 2B). `src/demo/show/ops/simstack-destroy-op.ts`; registered in `DEMO_OP_IDS`. Wraps `teardownEphemeralSimTenant` (registry record only) — **never** `demo:reset`. Runtime-verified by `demo:acts-test --act simstack-destroy` (run `sd-2b-1`).
- **TARGET** tenant-stacksim · HTTP/CLI · **:4390**
- **GRADE** READOUT today (TERMINAL-THEATER once T2 lands)
- **MODES** `staged` · `live` (fast). **`warm` is REJECTED by the catalog** — destroying during prep would remove the tenant the deck is about to use. GP-DEMO-4 Slice 2B added a general loader check (`deck-validate.ts`): a slide whose declared `op mode` is not in `OP_CATALOG[opId].modes` is a **load error** citing the catalog, so a deck naming `warm` for this op fails at `--check`.
- **PARAMS** none — keepEvidence is hardcoded true (the run evidence is never deleted) and the slug comes from ctx.armed.
- **PRECONDITIONS** A sim tenant exists for the slug (or not — the teardown is idempotent). No act later in the deck depends on it. **The slug must be a `sim` record, not a live one.**
- **POSTCONDITIONS** Depends on which mechanism the act wraps (see the box below). **Deliberately does NOT** delete `runDir` evidence, screenshots, or the run report — those outlive the tenant and are the proof the demo happened. ⚠ Note `demo:reset`'s `clear-runs` **would** delete them, which is why this act must not simply shell out to `demo:reset` mid-deck.
- **INPUTS** Deck: slug. Environment: registry root, stacksim root.
- **OUTPUTS** Terminal-theater transcript; a confirmation readout naming what was removed and what was left.
- **FAILURE MODES** **Live-record refusal** — tearing down a slug that holds a live record throws `refusing to tear down "<slug>": it is a live tenant, not an ephemeral sim`. That is a safety feature: surface it, never suppress it. A held file handle on Windows can block `rmSync`. Teardown must **never fail the show**: log and continue.
- **SUCCESS (TESTABLE)** *Registration:* `--check` exits 0; **a deck declaring `warm` for this id fails with a catalog error** (the Slice 2B loader check — verified). *Behavior* (runtime-verified GP-DEMO-4 Slice 2B, run `sd-2b-1`): **SD1** after the act, `listByKind('sim')` **does not contain the slug** — the gate contract in `docs/goals/G-TENANT-ADOPT.md:64`, "teardown leaves no residue"; **SD2** running it **twice succeeds** (idempotence — the second call is a documented no-op); **SD3** a live-slug target **throws** the refusal (`refusing to tear down "…": it is a live tenant, not an ephemeral sim`) rather than deleting; **SD4** `runDir` still contains every artifact written before it ran.
- **DOCTRINE** Not gated.
- **DRIVER** None needed.

> ⚠ **VERIFIED — there is no single command that destroys a sim tenant end to end.** Three
> mechanisms exist and they are **disjoint**; the act must choose deliberately:
>
> | Mechanism | What it actually does | What it does NOT do |
> |---|---|---|
> | **`teardownEphemeralSimTenant(registry, slug)`** (`src/tenant-registry/index.ts:83-88` → `ces-tenant/src/impl/registry.ts:177-190`) | Deletes **exactly one file**: `<registryRoot>/sim/<slug>.json`. Idempotent; refuses live slugs. Returns `void`. | Does not stop `serve`, does not touch stacksim's own tenant store, does not remove the `.pfx` or the installed cert, does not clear `runs/`. |
> | **`demo:reset`** (`src/cli/index.ts:347` → `src/cli/demo-command.ts:132-149`) | **No flags.** Four ordered actions: wipe+reseed the stacksim tenant store · remove `.stacksim.lock` · `rm -rf runs/` · **report** port occupancy. Exit `1` iff any action errors, else `0`. | **Never calls `teardownEphemeralSimTenant`.** **Never kills a process to free a port** — reporting only, by explicit design ("mis-identifying the owner could kill an unrelated process"). |
> | **`ArmedSim.stop()`** (`arm-sim.ts:143-150`) | Stops EO → AO GUI → stacksim serve, in reverse acquisition order. Idempotent. | Deletes **nothing** — no runDir, no tenant record, no cert. |
>
> **Recommended composition for the act:** `stop()` is already called by `dispose()`; the act should
> wrap **`teardownEphemeralSimTenant`** (registry record only, evidence preserved) and *report* port
> state. Reserve `demo:reset` for **between** rehearsals, never mid-deck — its `clear-runs` destroys
> the run's own evidence.

- **SUGGESTED TALK-TRACK**
  - When we are done here, the tenant goes away.
  - What stays is the evidence. Every screenshot, every artifact, every record of what we just proved.
  - That is deliberate. The environment is disposable. The proof is not.

### D.3 `muster-readiness`

- **ID** `muster-readiness`
- **PURPOSE** Run ces-muster's real readiness evaluation (DISCOVERY-1) against the sim and stream the Muster SPA operating on this run's real result.
- **STATUS** **IMPLEMENTED** — committed `5d5854b` (Slice 2a); GP-DEMO-5 streamgui adds the SPA drive. `src/demo/show/ops/muster-readiness-op.ts`; registered in `DEMO_OP_IDS` (`deck-model.ts` L42).
- **TARGET** ces-muster · **CLI** (`../ces-muster/muster-api/dist/cli/bin.js discovery --sim`) **→ the Muster SPA on :4173** (the CLI result imported through the file-input seam)
- **GRADE** THEATRICAL (GP-DEMO-5 streamgui) — the SPA streams the boundary panel operating on this run's real result; the readout card renders only on the degraded path
- **MODES** `staged` replay · `live` evaluate now (~80 s CLI + import, held on-slide). `warm` was **DROPPED** — a warm SPA drive shows a stale panel; honesty wants the import visibly happening (matches `muster-auto-analysis`)
- **PARAMS** `detail` (enum, default `counts`; `controls` lists every control) — selects the readout depth. Beyond that the op reads only `ctx.armed` and `ctx.slide.op.mode`.
- **PRECONDITIONS** stacksim armed, **and the ces-muster SPA on :4173** — `armingFor` now maps `muster-readiness` to `withMuster: true` (GP-DEMO-5 streamgui): it imports its CLI result into the SPA. **Operator prerequisite: `../ces-muster/muster-api/dist/cli/bin.js` AND `../ces-muster/dist/index.html` must already exist** — *ces-tester never builds a sibling*. `STAMPER_REGISTRY_ROOT` is set by the op to `<stamperRoot>/src/registry`.
- **POSTCONDITIONS** `<runDir>/muster-readiness.json` exists; `ctx.artifact?.(outPath)` has been called; on the **success path** the pane navigated to the SPA and imported the result, ending on `boundary-confirm-panel` (fixture `discovery-summary` absent); on the **degraded path** the pane shows the readout card. **Deliberately does NOT** mutate the tenant, produce a score, or claim gap discovery.
- **INPUTS** `ctx.armed.{slug, runDir, simUrl, musterRoot, stamperRoot}`; `ctx.slide.op.mode`. `musterRoot`/`stamperRoot` are **non-optional** on `ArmedEnvironment` and resolved once by the runner — "an op never works out where a sibling lives, and never builds one".
- **OUTPUTS** The artifact; a readout page (total, four-posture table, `NO_SCORE_LINE`, read-only delta, artifact path) rendered as a base64 `data:` URL via `htmlDataUrl` — no server; seven log lines; the `artifact` callback.
- **FAILURE MODES** **Missing `bin.js` → does NOT fail the show**: renders an "evaluation unavailable" readout naming the path; the RE beat silently degrades. **Non-zero ledger delta → logged with `— NOT READ-ONLY` appended, but it is ADVISORY, not a gate** (unlike `eval-run.ts`, where `readOnly` is a required conjunct of `pass`). **The only throw path:** the artifact is unreadable/malformed **and** exit was `0` or the known teardown code — "a real breakage in a sibling, not a degraded environment".
- **SUCCESS (TESTABLE)** *Registration:* `--check` exits 0; an unknown id exits 2. *Behavior:* judging is **artifact-first, not exit-code-gated** — (a) if the artifact parses with an `observations` array the act **succeeds regardless of exit code**; (b) artifact unreadable + exit `0` or `WINDOWS_LIBUV_TEARDOWN_EXIT` (`3221226505` = `0xC0000409`, `e2e-run.ts:644`) → **throws**; (c) artifact unreadable + any other exit → degrades to `available: false`, logs the first 300 chars of stderr, does **not** throw; (d) `tallyPostures()` is pure and exported "so the four-value guarantee is directly assertable against a fixture rather than inferred from a screenshot" — assert `READINESS_POSTURES = ['met','not_met','partial','unknown']` and that unknown values land in `other`/`otherValues` (a missing posture keys as `'(missing)'`); (e) the readout contains `NO_SCORE_LINE` verbatim; (f) every side effect is injectable (`spawnCli`, `fileExists`, `readArtifact`, `ledgerWrites`) so **tests need no ces-muster**.
- **DOCTRINE** **RE — NOT gated (decision 9, 2026-09-06).** Muster may be demoed live, and GP-DEMO-5 streamgui gives this act the SPA drive: `mirror: theatrical`, streaming the visible pane. It NEVER clicks the fixture "Run Discovery" button — the real CLI artifact feeds the UI. The op header's pre-lift wording has been rewritten (B1).
- **DRIVER** The CLI (`discovery --sim`) for the evaluation, then `driveMusterImportDiscovery` (`muster-ui-driver.ts`) for the SPA import — the same honest file-input seam `muster-auto-analysis` uses, reused (not aliased: this op is standalone and navigates the SPA itself).

- **SUGGESTED TALK-TRACK**
  - The first question any contractor asks is where do we actually stand.
  - This is a read-only walk of the tenant. It reads configuration and writes nothing, and we prove that rather than asking you to take our word for it.
  - The ledger delta is zero. Nothing was touched.
  - It gives us posture control by control. It deliberately does not give us a score. That number comes later, from the assessment, and I will not invent one here.

### D.4 `muster-connect-tenant`

- **ID** `muster-connect-tenant`
- **PURPOSE** Point Muster at a tenant and declare **how** it is being assessed — the honest opening beat.
- **STATUS** **IMPLEMENTED** — committed (GP-DEMO-5 Slice 3.0). `src/demo/show/ops/muster-connect-tenant-op.ts`; registered in `DEMO_OP_IDS`. Drives the new `src/demo/muster-ui-driver.ts` against the Vite preview arming brings up (`src/demo/show/arm-muster.ts`). Runtime-verified by `demo:acts-test --act muster-gui` (run `mg-30-2`).
- **TARGET** ces-muster **SPA** · `npm run preview` · **:4173** *(not :5173 — contested with ces-planner)*
- **GRADE** CURSOR
- **MODES** `staged` · `live`. **`warm` is REJECTED by the catalog** (it is a seconds-long UI step) — the 2B loader check enforces the omission.
- **PARAMS** `mode` (enum `self-hosted|independent|collaborative-bhd`, default `independent`); `authTier` (enum `lite|script-upload|device-code|cert-app-only`, default `cert-app-only`); `slug` (string, default the armed sim slug). All settable from the deck today.
- **PRECONDITIONS** Muster SPA armed on :4173 (arming spawns `npm run preview` — Muster has no CLI `gui`/`serve` subcommand). **Operator prerequisite: `../ces-muster/dist/index.html` must exist** (`npm run build` in ces-muster) — ces-tester never builds a sibling; absent, the harness exits 2 naming the remedy.
- **POSTCONDITIONS** A `readiness_manifest` is captured in the SPA session and the manifest view is left on screen (Begin Interview reachable but UNCLICKED). **Deliberately does NOT** touch a tenant — the SPA never does; only muster-api reaches tenants, via `ces-tenant`.
- **INPUTS** Deck params. Environment: `--muster-root`, SPA base URL.
- **OUTPUTS** A manifest screenshot (`muster-connect-01-manifest.png`); the manifest visible on screen.
- **FAILURE MODES** SPA not armed → specific error naming the arming module. Selector drift → loud timeout in seconds, not minutes.
- **SUCCESS (TESTABLE)** *Registration:* id loads in `--check`. *Behavior* (runtime-verified GP-DEMO-5 Slice 3.0, run `mg-30-2`): **MU-C1** — after the act, the Profile/`readiness-manifest-capture` view is visible; `rm-mode`, `rm-auth-tier`, `rm-tenant-slug`, `rm-operator-name` carry the declared values; `begin-interview` is reachable (and was left UNCLICKED so the manifest DOM is still readable). ⚠ **P2 correction:** the act drives `rm-operator-role` for completeness, but the SPA defaults `operator_role` to `'assessor'` (`AssessmentPage.tsx`), so the real persistence gate is `operator_name` + `tenant_slug` — there is NO "throws without role" negative. The `buildReadinessResult()`-throws-without-manifest negative is a ces-muster-internal function (not harness-reachable here); it is exercised via the export gating in D.8's act.
- **DOCTRINE** **RE — NOT gated (decision 9, 2026-09-06 — the RE restriction is LIFTED).** Live-eligible; `mirror: theatrical` permitted at T1.5. Honesty guards (A.5) survive the lift unchanged. **The driver now exists — doctrine was never what stopped these five acts, and neither is the driver any longer.**
- **DRIVER** Exists (`src/demo/muster-ui-driver.ts`, GP-DEMO-5 Slice 3.0) — 76 `data-testid` hooks + ces-muster's own Playwright happy path copied from.

- **SUGGESTED TALK-TRACK**
  - Before we assess anything, we declare how we are assessing it.
  - Mode, authorization tier, who is operating, which tenant.
  - That sounds like paperwork. It is the opposite. You cannot produce a readiness result here without stating how you obtained it.
  - That is the difference between an assessment and an opinion.

### D.5 `muster-auto-analysis`

- **ID** `muster-auto-analysis`
- **PURPOSE** Run the **real** read-only discovery walk and show its results inside Muster's UI.
- **STATUS** **IMPLEMENTED** — committed (GP-DEMO-5 Slice 3.1). `src/demo/show/ops/muster-auto-analysis-op.ts`; registered in `DEMO_OP_IDS`. Runs the REAL CLI walk then imports it through the SPA file seam. Runtime-verified by `demo:acts-test --act muster-gui` (run `maa-31-1`).
- **TARGET** ces-muster · **CLI walk → SPA import** (:4173)
- **GRADE** TERMINAL-THEATER, then CURSOR
- **MODES** `staged` · `live`. **`warm` is REJECTED by the catalog** (the loader check).
- **PARAMS** `slug` (string, default the armed sim slug) — the tenant the discovery CLI walks. (No import knob: importing IS the act.)
- **PRECONDITIONS** stacksim armed; SPA armed on :4173; `muster-connect-tenant` ran earlier. **Operator prerequisite:** both `../ces-muster/muster-api/dist/cli/bin.js` AND `../ces-muster/dist/index.html` must exist (`npm run build` in ces-muster).
- **POSTCONDITIONS** The real observations are imported into the SPA, landing on `boundary-confirm-panel`. **Deliberately does NOT** mutate the tenant (ledger delta 0), and does **not** click the SPA's own Run Discovery button.
- **INPUTS** The `readiness-result/1.0.0` artifact produced by the CLI walk (`<runDir>/readiness-result.json`).
- **OUTPUTS** The CLI artifact; a facts artifact (`muster-auto-analysis.json`); a boundary-panel screenshot.
- **FAILURE MODES** ⚠ **The designed-around failure:** clicking `discovery-run-btn` would load `DISCOVERY_RESULTS_FIXTURE` (zero network) — **a replay dressed as a live run**. The act routes through the CLI + import seam instead. Import rejects a malformed payload loudly rather than partially ingesting.
- **SUCCESS (TESTABLE)** *Registration:* id loads. *Behavior* (runtime-verified GP-DEMO-5 Slice 3.1, run `maa-31-1`): **MA1** the CLI artifact exists and is a `readiness-result/1.0.0` (the CLI Ajv-validates strict:true before writing; the judge confirms the version + required structure); **MA2** the walk is read-only — ledger create+mutate delta **=== 0**; **MA3** the fixture signature is **ABSENT** — what was imported is a readiness-result carrying the REAL walk's observation count, NOT the 14-row `DISCOVERY_RESULTS_FIXTURE`; **MA4** the import landed on `boundary-confirm-panel` and NOT the fixture branch's `discovery-summary`. ⚠ **Two dossier clauses corrected in-slice (retire+re-pin):** (1) the original "after import, `discovery-sub-tab`/`discovery-summary` are visible" is **wrong** — those render only on the FIXTURE-RUN branch (`App.tsx`); the honest import lands on `boundary-confirm-panel` (MA4). (2) "the on-screen counts equal the artifact's counts" is **RETIRED** — imported discovery has NO pre-boundary count surface, so there is no on-screen number to equate. It is **re-pinned NON-VACUOUSLY** to real-ingestion evidence: the import is a readiness-result of the real walk's size (not the fixture's 14) landing on the boundary panel (MA3+MA4), a distinction the fixture path fails. (The `observations tally == derived.sprs_now.assessed_count` internal-consistency check was considered and dropped: measured, `assessed_count` counts SPRS *requirements* (111 ≈ 110), not observations (329) — the equality does not hold. §E.14.)
- **DOCTRINE** **RE — NOT gated (decision 9, 2026-09-06 — the RE restriction is LIFTED).** Live-eligible; `mirror: theatrical` permitted at T1.5. Honesty guards (A.5) survive the lift unchanged.
- **DRIVER** Exists (`src/demo/muster-ui-driver.ts`).

- **SUGGESTED TALK-TRACK**
  - Now we run the real discovery walk against that tenant.
  - What you are seeing came from this tenant, in this run. It is not a canned result.
  - Every control it can resolve on its own is one fewer question a human has to sit and answer.

### D.6 `muster-consent-and-attest`

- **ID** `muster-consent-and-attest` *(supersedes the working name `muster-run-analysis-scripts` — CONCEPT §7.3)*
- **PURPOSE** Show that scanning is **permissioned** and that a **named human attests** to what the machine inferred.
- **STATUS** **IMPLEMENTED** — committed (GP-DEMO-5 Slice 3.2). `src/demo/show/ops/muster-consent-and-attest-op.ts`; registered in `DEMO_OP_IDS`. Runtime-verified by `demo:acts-test --act muster-gui` (run `mca-32-1`).
- **TARGET** ces-muster SPA (:4173) for attestation; muster-api (:4000) lanes as readout
- **GRADE** CURSOR (attestation) + READOUT (OAuth / concierge lanes)
- **MODES** `staged` · `live` (no `warm` — loader-enforced)
- **PARAMS** none — the confirmer is the demo operator and the drafts come from the prior import.
- **PRECONDITIONS** A prior act produced drafts to confirm (typically `muster-auto-analysis`); SPA armed. Operates on the boundary panel the import left up (no navigation).
- **POSTCONDITIONS** Selected drafts become **attested facts** carrying a named human. **Deliberately does NOT** let a machine assert CUI-boundary intent, and does **not** convert unconfirmed drafts into scoring facts.
- **INPUTS** The draft set on screen (enumerated from the raw page).
- **OUTPUTS** A facts artifact (`muster-consent.json`); a confirm-panel screenshot.
- **FAILURE MODES** ⚠ **Do not stage the offer screen as a permission gate** — "Run Discovery vs Skip" is a UX choice, not authorization. Blank confirmer name is rejected at the UI layer (the draft confirm is `disabled` while the name is blank). The OAuth and `x-concierge-session` gates **cannot** be shown in sim — readout only.
- **SUCCESS (TESTABLE)** *Registration:* id loads. *Behavior* (runtime-verified GP-DEMO-5 Slice 3.2, run `mca-32-1`): **MC1** `boundary-confirm-panel` visible; **MC2** a blank `boundary-confirmer-name` is **rejected** — a draft `boundary-confirm-${qid}` is `disabled` while the name is blank and enabled after (when the import produced drafts; a pruning-only run records that plainly); **MC3** after `boundary-continue-btn` the workflow advances, and a confirmed draft carries the operator name (verified in D.8's exported payload — the chain). ⚠ **Clause (d) "unconfirmed drafts score identically to no facts" is a SCORING INVARIANT** not reachable in a single harness run (it needs a two-run score comparison); it is covered by **ces-muster's own tests** and deferred there (the D.4 `buildReadinessResult` precedent) — recorded, not dropped.
- **DOCTRINE** **RE — NOT gated (decision 9, 2026-09-06 — the RE restriction is LIFTED).** Live-eligible; `mirror: theatrical` permitted at T1.5. Honesty guards (A.5) survive the lift unchanged.
- **DRIVER** Exists (`src/demo/muster-ui-driver.ts`).

- **SUGGESTED TALK-TRACK**
  - Nothing gets scanned that you have not authorized.
  - Here is the part that matters legally. The machine can infer. It cannot attest.
  - A named human confirms the boundary, and nothing auto-drafted becomes an attested fact on its own.
  - Your system security plan carries False Claims Act weight. This is where that protection actually lives.

### D.7 `muster-adaptive-interview`

- **ID** `muster-adaptive-interview`
- **PURPOSE** Show the question count **drop** because discovery already answered them — the clearest value beat in the set.
- **STATUS** **IMPLEMENTED** — committed (GP-DEMO-5 Slice 3.3). `src/demo/show/ops/muster-adaptive-interview-op.ts`; registered in `DEMO_OP_IDS`. Runtime-verified by `demo:acts-test --act muster-gui` (run `mai-33-1`).
- **TARGET** ces-muster SPA · :4173
- **GRADE** CURSOR
- **MODES** `staged` · `live` (no `warm` — loader-enforced)
- **PARAMS** none — both branches use the same profile; the delta is measured, not parameterized.
- **PRECONDITIONS** The discovery import + boundary confirm ran earlier (the visible pane carries the imported facts); SPA armed. Opens a throwaway HEADLESS session for the manual-branch baseline (no extra port — TD1 unaffected).
- **POSTCONDITIONS** An interview session in progress with a visible reduced question count. **Deliberately does NOT** convert any `unknown`/`unsure` answer into a pass, and never scores readiness from the interview alone.
- **INPUTS** The pruned question graph (discovery branch) and a fresh unpruned one (manual branch).
- **OUTPUTS** A facts artifact (`muster-adaptive.json`) with both totals; an interview screenshot.
- **FAILURE MODES** Claude adaptive ordering unavailable → the SPA **permanently falls back to the static graph**; honest degradation. **MEASURED, not asserted:** if the totals tie, the op reports "no pruning" plainly rather than narrating a drop.
- **SUCCESS (TESTABLE)** *Registration:* id loads. *Behavior* (runtime-verified GP-DEMO-5 Slice 3.3, run `mai-33-1`): **MI1** the discovery branch's `progress-note` total ("of N answered") is **strictly less than** a fresh manual branch's for the same profile — the exact comparison ces-muster's own e2e makes (`e2e/five-tabs.spec.ts`, regex `of (\d+) answered`). Both branches are walked live (the manual one in a throwaway headless session); the totals are read from the DOM, compared, and recorded. A no-pruning tie is reported as an honest `environment` finding, never narrated as a drop.
- **DOCTRINE** **RE — NOT gated (decision 9, 2026-09-06 — the RE restriction is LIFTED).** Live-eligible; `mirror: theatrical` permitted at T1.5. Honesty guards (A.5) survive the lift unchanged.
- **DRIVER** Exists (`src/demo/muster-ui-driver.ts`).

- **SUGGESTED TALK-TRACK**
  - Here is the interview, and I want you to watch the number of questions.
  - Discovery already answered a large share of these, so we do not ask you again.
  - What is left is the set a machine genuinely cannot answer. Intent, boundary, who is responsible.
  - That is hours of your team's time we are not spending, and it is the same answers either way.

### D.8 `muster-generate-sprs-mp`

- **ID** `muster-generate-sprs-mp`
- **PURPOSE** Land the number the customer actually reports (SPRS), then the artifact Stamper executes (the Mission Plan).
- **STATUS** **IMPLEMENTED** — committed (GP-DEMO-5 Slice 3.4). `src/demo/show/ops/muster-generate-sprs-mp-op.ts`; registered in `DEMO_OP_IDS`. Runtime-verified by `demo:acts-test --act muster-gui` (run `msp-34-1`).
- **TARGET** ces-muster SPA · :4173
- **GRADE** CURSOR + READOUT
- **MODES** `staged` · `live` (no `warm` — loader-enforced)
- **PARAMS** none — exports the readiness result; plan-mode is out of this pass (recorded below).
- **PRECONDITIONS** An interview in progress (the adaptive-interview beat ran); SPA armed. Finishes the interview → the result view → exports through the download seam.
- **POSTCONDITIONS** A `readiness-result/1.0.0` payload is downloaded; SPRS + the conservative-score on screen. **Deliberately does NOT** claim certification — Muster's own code caps this as a *"self-assessed indicator — not a certification, not an SPRS submission"*.
- **INPUTS** The routed fact set (from the interview + import).
- **OUTPUTS** The downloaded readiness-result payload; a facts artifact (`muster-sprs.json`); a result screenshot.
- **FAILURE MODES** Download blocked → the export capture hangs, so the pane context sets `acceptDownloads` explicitly. Missing manifest → export throws (correctly).
- **SUCCESS (TESTABLE)** *Registration:* id loads. *Behavior* (runtime-verified GP-DEMO-5 Slice 3.4, run `msp-34-1`): **MP1** the EXPORTED payload is a `readiness-result/1.0.0` (Ajv-validated by the SPA's export path; the judge confirms the version); **MP2** the SPRS integer is read from the PAYLOAD (`derived.sprs_now.sprs`), never the DOM; **MP3** the DOM `conservative-score` matches `/^-?\d+% compliant/` — a percentage string, NOT the SPRS integer. ⚠ **Dossier drift corrected in-slice:** clause (a)'s `/^-?\d+$/` regex is **REFUTED** — `conservative-score`'s text is `"{score}% compliant"` (`ResultScreen.tsx:91`); the honest per-session number is `conservative-score` (result view via `finish-interview`), NOT the fixture constant `readiness-sprs-score`. Clause (c) "on-screen score equals the payload score" is re-pinned: the DOM % and the payload SPRS are **different numbers** (a compliance percentage vs the DoD 110-point SPRS), so the honest equality is "the SPRS is sourced from the exported payload" (MP2), not a DOM-scrape. **Clause (d) "only `met` passes"** is a **SPRS-calculator invariant** (`sprsCalc.ts` L71-77) covered by **ces-muster's own unit tests** and deferred there — recorded, not dropped. **Clause (e) plan-mode `manual_mission_plan`** is **out of this pass** (not exercised) — recorded per "if exercised".
- **DOCTRINE** **RE — NOT gated (decision 9, 2026-09-06 — the RE restriction is LIFTED).** Live-eligible; `mirror: theatrical` permitted at T1.5. Honesty guards (A.5) survive the lift unchanged.
- **DRIVER** Exists (`src/demo/muster-ui-driver.ts`).

- **SUGGESTED TALK-TRACK**
  - This is the number your program office asks about.
  - Only fully met controls count. Partial and unknown deduct in full. It is conservative on purpose, because the alternative is a score you cannot defend.
  - Alongside it, the mission plan. The actual remediation work, ordered and ready to execute.
  - The assessment and the plan come out of the same pass, so you are not re-litigating findings to build a work list.

### D.9 `stamper-translate`

- **ID** `stamper-translate`
- **PURPOSE** Compile the mission plan into executable tasks (Configuration).
- **STATUS** **IMPLEMENTED** — committed (GP-DEMO-4 Slice 2b). `src/demo/show/ops/stamper-translate-op.ts`; registered in `DEMO_OP_IDS`. The backstage session it depends on is committed with it.
- **TARGET** ces-stamper GUI · **:3000** — driven on the **backstage session**, never the visible pane
- **GRADE** THEATRICAL (decision 11) — the real GUI streams live from the backstage session into the slide (`/mirror/backstage`); the pane is never driven
- **MODES** `staged` · `warm` · `live` ~5 min (MEASURED 2026-09-06: 308.6 s for 110 tasks); the all-live streamgui proof deck uses `live` so the GUI streams operating in-sync
- **PARAMS** `missionPlan`, `manifest` — paths, defaulting to the committed `assets/demo-plan` fixture. Both are settable from the deck today and resolve to ABSOLUTE paths before reaching the GUI.
- **PRECONDITIONS** Stamper GUI armed on :3000 (**only** when a deck drives a stamper act); the **backstage session** created by the runner during `prepare()`, which is committed and proven — `demo:acts-test` counts ZERO visible-pane navigations across the whole Config pair; plan + manifest resolved to **absolute** paths (the GUI child runs with `cwd = stamperRoot`, so a tester-relative path resolves against the wrong root).
- **POSTCONDITIONS** A translated plan exists with `#outputPath` populated on the backstage page. **Deliberately does NOT** appear in the visible app pane, and does **not** execute anything.
- **INPUTS** Mission plan + manifest fixture; armed slug; `pipelineRoot`.
- **OUTPUTS** Task count; plan path; screenshots into `runDir`; a readout on the live slide.
- **FAILURE MODES** **Sticky dry-run:** the GUI forces `#execTargetSelect` to `dryrun` and never restores it — a first attempt reports "Complete" in 0.7 s with **zero mutations**; the flow sets `tenant` and throws if it did not stick. Missing `stamperBaseUrl` → specific error naming the arming module. `seedPlanVariables` must run **before** translate or ~23 tasks fail.
- **SUCCESS (TESTABLE)** *Registration:* a deck naming `stamper-translate` `--check`s to 0. *Behavior:* the act touches **`ctx.backstage`, never `ctx.pane`**, in `warm` (asserted by test); arming brings up :3000 **only** for a deck that drives a stamper act, and **:3000 is free after teardown**; `runStamperUiFlow`'s **default `phase` behavior is byte-identical** to before the slice (so `demo:e2e` is unaffected).
- **DOCTRINE** **Config — LIVE-eligible (decision 11, 2026-09-07 — the Config restriction is LIFTED).** The GUI streams from the **backstage session** on `/mirror/backstage` (`mirror: theatrical`, `mirrorSource: backstage`), never by driving the visible pane. Honesty guards survive: the readout still judges `/api/translate`'s real task count, never a badge. ⚠ The pre-lift wording elsewhere ("Config gets no live product demo") is superseded.
- **DRIVER** Exists (`src/demo/stamper-ui-driver.ts`), gaining an optional `phase` in 2b.

- **SUGGESTED TALK-TRACK**
  - While we have been talking, the plan has been compiling in the background.
  - It turns the findings into concrete, ordered tasks against this specific tenant.
  - I am not going to walk you through that interface. What matters is what came out of it, and that is what you are looking at.

### D.10 `stamper-execute`

- **ID** `stamper-execute`
- **PURPOSE** Apply the compiled plan against the sim — the remediation beat.
- **STATUS** **IMPLEMENTED** — committed (GP-DEMO-4 Slice 2c). `src/demo/show/ops/stamper-execute-op.ts`; registered in `DEMO_OP_IDS`.
- **TARGET** ces-stamper GUI · **:3000** · backstage session
- **GRADE** THEATRICAL (decision 11) — the real GUI streams live from the backstage session (`/mirror/backstage`); warm streams backstage's real current state (mid-run / completed report), live streams the operation in-sync; the pane is never driven
- **MODES** `staged` · `warm` (~13 min; MEASURED 2026-09-06: 774.3 s on the fast path) — must NOT be crossed by a live-streamed op on a later slide (one serialized queue) · `live` streams in-sync at the cost of a ~13-min hold-card (the all-live proof deck's mode)
- **PARAMS** `skipKnownFalseFails` (boolean, default `true`) — settable from the deck today. `false` means judge NOTHING as expected: every failure fails the act. `peekMs` (number, unset by default) — demo peek: on a live slide, start Execute, confirm it is running, stream it for that many ms, then halt it and cut away without awaiting the ≈13-min terminal; halting stops the backstage churn that would otherwise crash later live acts, and no report is judged that run.
- **PRECONDITIONS** A `stamper-translate` warm act **earlier in the deck**, leaving the backstage page connected with `#outputPath` populated → the ~13 min fast path; otherwise the full flow (~18 min, because it repeats connect/assess/translate first). **The backstage session is what makes the fast path the common case**, since nothing else navigates that page.
- **POSTCONDITIONS** The plan is applied to the **sim** tenant — this act **does mutate**, deliberately. **Deliberately does NOT** touch a real tenant, and does not judge itself by the UI badge.
- **INPUTS** The translated plan; the skip-list.
- **OUTPUTS** Execution report on disk (tasks total / applied / failed); screenshots; the readout.
- **FAILURE MODES** **`#cardStatus4` is narrative only** — measured "Complete" while the on-disk report read `partial` (80/110). **Judge `result.report`, never the badge.** Two distinct false-fail id spaces: judge the GUI leg against `GUI_LEG_KNOWN_FALSE_FAILS`, **not** `known-false-fails.ts` (the CLI registry judge). Never pin a raw `step_task_*` id — the suffix regenerates every translation.
- **SUCCESS (TESTABLE)** *Registration:* id loads in `--check`. *Behavior:* (a) the act reads the **on-disk execution report**, not the badge; (b) `partitionGuiFailures(failureIds, skipList)` splits expected / unexpected / staleSkips, and **the act fails only on `unexpected`**; (c) an `undefined` skip-list means "judge nothing as expected"; (d) backstage-not-pane assertion holds; (e) ports 3000/4390 (and 3001/4002 when driven) free after teardown.
- **DOCTRINE** **Config — LIVE-eligible (decision 11, 2026-09-07 — the Config restriction is LIFTED).** The GUI streams from the **backstage session** on `/mirror/backstage` (`mirror: theatrical`, `mirrorSource: backstage`), never by driving the visible pane. Honesty guards survive: judge `result.report`, never the badge; the rotating AZ-NSG/AZ-NET class stays an honest act-red. §8 record-replay is out of scope.
- **DRIVER** Exists.

- **SUGGESTED TALK-TRACK**
  - The remediation itself already ran, during setup. It takes minutes, not seconds, and I would rather spend that time talking to you than watching a progress bar.
  - What you are seeing is the report it wrote to disk. Tasks attempted, tasks applied, tasks failed.
  - We judge that file, never the status badge on the screen. The badge has told us Complete while the report said partial, so we stopped trusting it.
  - The failures listed there are known simulator artifacts, and we call them out rather than quietly filtering them.

### D.11 `ao-registry-command`

- **ID** `ao-registry` *(the §3 catalog name is `ao-registry-command`; the registered id is `ao-registry`)*
- **PURPOSE** Browse the governed command registry and execute a real command against the sim — the day-two operations beat.
- **STATUS** **IMPLEMENTED** — committed (GP-DEMO-4, `1cc0c94` lineage). `src/demo/show/ops/ao-registry-op.ts`.
- **TARGET** ces-ao GUI · **:3001** · the **visible app pane**
- **GRADE** CURSOR-capable once T1 lands; today a plain (invisible-cursor) drive
- **MODES** `staged` replay · `warm` / `live` — ⚠ **it does not branch**: both run the identical flow (unlike `eo-review`).
- **PARAMS** `command` (string, default `A-18` — the constant `AO_DEMO_COMMAND_ID`): the registry command id to submit. Settable from the deck today.
- **PRECONDITIONS** AO GUI armed on :3001 (`armingFor` sets `withAoGui` when a deck drives this act). Ordering rule: **it calls `ctx.pane.goto(baseUrl)` unconditionally**, so it will navigate the pane away from any hydrated EO page — never place it between `eo-review` warm and `eo-review` live.
- **POSTCONDITIONS** A command has been **executed live against the ephemeral sim slug**, and an evidence record is written. This act **mutates** — that is its point. **Deliberately does NOT** run a GUI dry-run: the AO GUI hardcodes tenant `'dev'` whenever the live toggle is off, so a "dry run" would silently target a different tenant — the exact substitution the honesty rules forbid.
- **INPUTS** Armed `aoBaseUrl`, `slug`, `AO_DEMO_COMMAND_ID`, `runDir`.
- **OUTPUTS** `statusBadge`, `outcomeBadge`, screenshots in `runDir`.
- **FAILURE MODES** AO GUI not armed → throws naming `arm-sim.ts`. **Ordering trap enforced by the driver:** `openCommandForm()` resets the tenant box on every open, so the live toggle must be checked **before** the slug is filled and the form must never be reopened after arming.
- **SUCCESS (TESTABLE)** *Registration:* `--check` exits 0 for a deck naming `ao-registry`. *Behavior:* (a) `runAoUiFlow` completes and returns a `statusBadge`; (b) screenshots land in `runDir`; (c) the evidence record exists for the executed command; (d) unarmed AO → the specific arming error, not a timeout. ⚠ **Honest gap: this act judges no artifact** — it reads badges and captures screenshots. It is the thinnest success definition of the three implemented acts.
- **DOCTRINE** **Ops — NOT gated.** Founder decision: Ops and Assessment are LIVE.
- **DRIVER** Exists (`src/demo/ao-ui-driver.ts`).

- **SUGGESTED TALK-TRACK**
  - This is the governed command registry. Every operation we can perform on a tenant, catalogued, with its approval tier.
  - I will search for the one I need rather than remembering syntax.
  - Notice the live toggle. Off, this targets a scratch tenant. On, it is real. That speed bump is deliberate.
  - Execute. And the evidence record writes itself as the command runs.
  - Nobody has to remember to document this afterwards, which is exactly when documentation stops happening.

### D.12 `ao-make-change`

- **ID** `ao-make-change`
- **PURPOSE** Submit the *remediating* governed change on stage — the "fix it" beat.
- **STATUS** **IMPLEMENTED** — committed (GP-DEMO-4 Slice 1B). `src/demo/show/ops/ao-make-change-op.ts`; registered in `DEMO_OP_IDS`. It is `ao-registry`'s flow under a distinct id (no alias resolution — that is GP-DEMO-5 T3), defaulting to the remediation command `A-18`. Runtime-verified by `demo:acts-test --act ao-make-change` (run `amc-1b-1`).
- **TARGET** ces-ao GUI · :3001 · visible pane
- **GRADE** CURSOR (with T1)
- **MODES** `staged` · `warm` · `live` — ⚠ like `ao-registry` it **does not branch**: `warm` and `live` run the identical flow.
- **PARAMS** `command` (string, default `A-18` — the remediation command `AO_DEMO_COMMAND_ID`, which mutates the tenant authorizationPolicy, the MFA object): the registry command id to submit. Settable from the deck today.
- **PRECONDITIONS** As D.11, plus: the gap this change remediates must actually exist (typically seeded by `simstack-create` and observed by an assessment act).
- **POSTCONDITIONS** The tenant is changed; an evidence record exists. **Deliberately does NOT** silently target `dev` (see D.11).
- **INPUTS** `command` param; armed AO surface.
- **OUTPUTS** Badges; screenshots; the evidence record a later act verifies.
- **FAILURE MODES** As D.11. Note the `command` param is a **`string`**, so an unknown command id is **not** caught at `--check` (there is no enum to validate against — `--check` forces `staged` and never reaches the drive); it is caught by the AO GUI at runtime, loud, in seconds.
- **SUCCESS (TESTABLE)** *Registration:* `--check` on a deck naming `ao-make-change` exits 0 (an unknown command is caught by the AO GUI at runtime, not at `--check` — a `string` param carries no enum). *Behavior* (runtime-verified GP-DEMO-4 Slice 1B, run `amc-1b-1`): the harness `ao-make-change` group asserts **AM1** the named command executed against the sim slug (op done, status badge logged); **AM2** screenshots registered and on disk; **AM3** the AO `adminops_evidence` row NAMES the command AND carries `stateChanged=true` — the targeted control changed state, proven from the artifact, not the badge; **AM4** unarmed AO throws the specific arming error naming `arm-sim.ts`, off the pane.
- **DOCTRINE** **Ops — NOT gated.**
- **DRIVER** Exists.

- **SUGGESTED TALK-TRACK**
  - This is the fix for the gap we found.
  - Same governed registry, same approval path. We are not dropping to a command prompt to make a change to your tenant.
  - It runs, and it is recorded, in one motion.

### D.13 `eo-assess`

- **ID** `eo-review` **with `op mode: warm`** *(a distinct name awaits alias resolution)*
- **PURPOSE** Run the real EO assessment — the expensive half, paid off-stage.
- **STATUS** **IMPLEMENTED** — committed `1cc0c94`. `src/demo/show/ops/eo-review-op.ts`, warm branch.
- **TARGET** ces-eo SPA · **:4002** · visible app pane
- **GRADE** CURSOR (off-stage; the audience sees the *result*, not this)
- **MODES** `warm` is this act. (`live` on the same id is D.14; `staged` replays.)
- **PARAMS** `family` (default `IA`) and `land` (default `sprs`), both settable from the deck today — though the warm half assesses regardless of where the later walk lands.
- **PRECONDITIONS** EO armed on :4002 (`armingFor` sets `withEo`). ⚠ **MEASURED 2026-09-06: 4.7 s, not the five minutes this entry claimed for months** (`demo:acts-test --full`, 106 live assessments, SPRS -108). `warm` is still the right mode — it is what leaves a hydrated page for the live walk — but it is not buying time, and no talk track may promise a five-minute wait here.
- **POSTCONDITIONS** The pane holds a **hydrated** EO page: `renderFamilyTable` has run and `tr.control-sub-row` rows exist. **Deliberately does NOT** mutate the tenant — EO reads. ⚠ **The hydration is page state, not server state** — a reload or another act's `goto` destroys it.
- **INPUTS** Armed `eoBaseUrl`, `slug`, `runDir`.
- **OUTPUTS** A hydrated assessment on the pane; screenshots; log line with elapsed time and connect status.
- **FAILURE MODES** EO not armed → throws naming `arm-eo.ts`/`arm-sim.ts`. The SPA clicks the evidence tab ~1500 ms after `assess_done`, **after** the flow returns — anything driving tabs immediately gets yanked mid-browse, so the op waits it out unconditionally.
- **SUCCESS (TESTABLE)** *Registration:* `--check` exits 0. *Behavior:* after the act, `page.count('#familyTableBody tr.control-sub-row') > 0` — the single reliable tell that a real assessment rendered **in this page**.
- **DOCTRINE** **Assessment — NOT gated.** LIVE is the founder's ruling.
- **DRIVER** Exists (`src/demo/eo-ui-driver.ts`).

- **SUGGESTED TALK-TRACK**
  - The assessment already ran during setup, so we are looking at a finished result rather than a progress bar.
  - What it produced is on the screen now, and we are going to walk into it.

### D.14 `eo-browse-determinations`

- **ID** `eo-review` **with `op mode: live`** *(alias awaits deck-cell resolution)*
- **PURPOSE** Walk the assessment the audience came to see: matrix → one family's NOT-MET determinations → the SPRS score.
- **STATUS** **IMPLEMENTED** — committed `1cc0c94`, live branch.
- **TARGET** ces-eo SPA · :4002 · visible pane
- **GRADE** CURSOR (the strongest cursor beat available today)
- **MODES** `live`
- **PARAMS** `family` (default `IA` — where the MFA control `IA.L2-3.5.3` lives) and `land` (default `sprs`). Both are settable from the deck today.
- **PRECONDITIONS** ⚠ **A hydrated EO page in the app pane** — i.e. an `eo-assess` (warm) act earlier in the deck **and no pane-navigating act in between**. **If absent, the op self-heals**: it says so in the log and runs the real assess live (slower, still real). It never shows an empty matrix and narrates a result.
- **POSTCONDITIONS** The SPRS tab is on screen. **Deliberately does NOT** navigate or reload — it drives tabs inside the same page, because the SPA cannot rehydrate an assessment from a page load.
- **INPUTS** The hydrated page; `eoBaseUrl`.
- **OUTPUTS** Three screenshots (`eo-review-01-compliance-matrix.png`, `-02-family-determinations.png`, `-03-sprs.png`); log lines carrying both the **on-screen** values and the **API** values.
- **FAILURE MODES** Not hydrated → self-heal (loud, honest). Metric tiles never resolve → 20 s timeout by design — *a live failure on stage must be loud in seconds, not minutes.*
- **SUCCESS (TESTABLE)** *Registration:* `--check` exits 0. *Behavior:* (a) `#metricMet` matches `/^\d+$/`; (b) `#sprsDetailScore` matches `/^-?\d+$/`; (c) narrated numbers are read from **`/api/assessment` and `/api/sprs`**, not the DOM; (d) when `liveAssessmentCount === 0` the log **must** carry `LIVE SIGNAL LEG DID NOT RUN; do not narrate these numbers`; (e) three screenshots exist in `runDir`; (f) starting un-hydrated triggers the self-heal path and still ends hydrated.
- **DOCTRINE** **Assessment — NOT gated.**
- **DRIVER** Exists.

- **SUGGESTED TALK-TRACK**
  - This is the compliance matrix. Every control, its determination, and the evidence behind it.
  - Let me filter to identification and authentication, and just the ones we are not meeting.
  - Each row is one control, the approach we assessed it against, and what it is costing you.
  - And here is the score with the deductions that produced it. This is not a summary you have to trust. You can walk into any line of it and see why.

### D.15 `eo-verify-evidence`

- **ID** `eo-review` + `land=evidence`
- **PURPOSE** Open the Evidence Explorer and show the record the AO act just wrote — "the evidence writes itself".
- **STATUS** **IMPLEMENTED** — the implementation is committed AND the landing is now selectable: a deck cell carrying `land=evidence` validates against the catalog and resolves to the Evidence Explorer ending. It is `eo-review` configured, not separate code.
- **TARGET** ces-eo SPA · :4002 · visible pane
- **GRADE** CURSOR
- **MODES** `live`
- **PARAMS** `land` = `evidence` (required — it is what makes this act this act; `family` still applies to the walk that precedes the landing)
- **PRECONDITIONS** A hydrated EO page (as D.14) **and** an earlier `ao-registry-command` / `ao-make-change` act that actually wrote the record being shown.
- **POSTCONDITIONS** The Evidence Explorer is on screen showing that record. Read-only.
- **INPUTS** `land` param; the hydrated page; the command id executed earlier.
- **OUTPUTS** Screenshot; log line naming the record.
- **FAILURE MODES** No matching record (the AO act did not run, or ran against a different slug) → must say so rather than showing an empty explorer and narrating success.
- **SUCCESS (TESTABLE)** *Registration:* `land=evidence` validates; a bad enum value fails `--check` citing the catalog. *Behavior* (**corrected + runtime-verified GP-DEMO-4 Slice 1A, run `ev-1a-2`**): the harness `eo-verify-evidence` group runs the chain in one lifecycle — `ao-registry` (live) → `eo-review` (warm) → `eo-review` (live, `land=evidence`) — and asserts three tells: **EV1** the Evidence Explorer landing screenshot (`eo-review-03-evidence.png`) reaches the finished report and is on disk; **EV2** the Explorer surfaces THIS run's assessment (an `assessment:IA.L2-3.5.3` item — non-vacuous because EO storage is run-scoped, so `assessmentStore.loadLatest()` can only return the warm leg's own assessment, unlike the static signal catalog which always returns items); **EV3** the AO write-side `adminops_evidence` row names the executed command (`A-18:A-18-…`, `stateChanged=true`). ⚠ **The original clause — "the Explorer contains ≥1 record whose command id equals the AO command" — is RETIRED as unsatisfiable, not silently dropped.** ces-eo `evidence-router.ts` L188-357 builds `/api/evidence-explorer/index` from Stamper plan-data, blob artifacts, EO's OWN assessment, personnel/risk and a static signal catalog; **there is no `adminops_evidence` source and the item shape carries no command-id field**, so no arming makes an AO command appear there (run `ev-1a-2` observed 122 items — `local:110, signal:12` — and `commandIdInExplorer=false`). The command-id half of the cross-act chain is therefore proven **write-side (EV3)**, and the Explorer half proves this run's assessment is queryable (EV1+EV2). (See §E.12.)
- **DOCTRINE** **Assessment — NOT gated.**
- **DRIVER** Exists.

- **SUGGESTED TALK-TRACK**
  - Remember the command we ran a moment ago. Its evidence record was written the instant it executed — not reconstructed from memory a year later.
  - And here is the assessment's own evidence trail, every control queryable with the artifact behind it.
  - This is what we mean when we say there is no scramble at assessment time. The work documents itself as it happens.

### D.16 `eo-show-change-captured`

- **ID** `eo-show-change-captured`
- **PURPOSE** Re-assess after remediation and walk to the control that **flipped** — the proof the loop closes.
- **STATUS** **IMPLEMENTED** — committed (GP-DEMO-4 Slice 1C). `src/demo/show/ops/eo-show-change-captured-op.ts`; registered in `DEMO_OP_IDS`. Composes the re-exported `assessInPane` (the re-assess) + a delta-aware walk. Runtime-verified by `demo:acts-test --act eo-show-change-captured` (run `escc-1c-1`).
- **TARGET** ces-eo SPA · :4002 · visible pane
- **GRADE** CURSOR
- **MODES** `staged` · `live`. ⚠ **The re-assess half is `live`-required, NOT `warm`:** in a real deck, warm ops fire during prep BEFORE any live remediator, so a warm re-assess would capture "after" before remediation ran. `warm` is dropped from the catalog `modes` (Slice 2B's loader validation enforces it).
- **PARAMS** `control` (string, default the demo's MFA control `IA.L2-3.5.3`, `DEMO_MFA_CONTROL_ID`); `family` (string, default `IA`). Both settable from the deck today.
- **PRECONDITIONS** A **before** assessment captured earlier in the deck; a remediating act (`stamper-execute` or `ao-make-change`) between before and after; EO armed.
- **POSTCONDITIONS** An **after** assessment exists and the delta is on screen. Read-only with respect to the tenant.
- **INPUTS** The before-numbers (from the earlier act's log/report); the control id.
- **OUTPUTS** Before/after determination for the control; SPRS delta; screenshots.
- **FAILURE MODES** ⚠ **The honesty trap specific to this act:** if the control did **not** flip, the act must report that plainly — a demo that narrates a flip that did not happen is the worst failure in the catalog. Also: the before-numbers must come from a recorded artifact, not from memory of what was on screen.
- **SUCCESS (TESTABLE)** *Registration:* id loads. *Behavior* (runtime-verified GP-DEMO-4 Slice 1C, run `escc-1c-1`): the harness `eo-show-change-captured` group runs `eo-review`(warm) → `ao-make-change`(live) → `eo-show-change-captured`(live), captures `eo-before.json` between the warm and the remediator (SLIDE_PROBES) and `eo-after.json` after the re-assess, and asserts: **EC1** both artifacts parse AND `after.generatedAt` is strictly newer (the re-assess produced a fresh snapshot); **EC2** `eo-before.json` matches the warm leg's OWN logged API numbers (the before was captured while still true, not already remediated); **EC3** the named control's before/after status is compared and the op's narration MATCHES the computed comparison (a flip is narrated iff the control actually flipped); **EC4** the on-screen SPRS the walk read equals `eo-after.json`'s score (screen==file); **EC5** a non-flip (or no reliable before) is reported plainly via the exported honesty constants and narrates NO flip. ⚠ **The control's status (EC3) and the SPRS delta (EC4) are INDEPENDENT facts** — A-18 mutates `authorizationPolicy` and can move the score without flipping `IA.L2-3.5.3` (whose enforcement flip belongs to Stamper in the full arc); the judge never infers one from the other. ⚠ **Two dossier clauses corrected (retire+re-pin, GP-DEMO-4 Slice 1C):** clause (b) "the named control's status **differs**… asserts the direction" is re-pinned to "compares and asserts the direction **if it changed**, else reports no change" — asserting an unconditional flip would be the exact dishonesty this act guards against, and the measured outcome (run `escc-1c-1`, see §E.13) is that A-18 alone does not flip the EO determination of `IA.L2-3.5.3`; clause (c) "SPRS delta **equals** the delta shown on screen" is re-pinned to EC4's screen==file (there is no on-screen delta widget; A.5#3 sources numbers from the artifact, and the on-screen SPRS proves the artifact is what was shown).
- **DOCTRINE** **Assessment — NOT gated.**
- **DRIVER** Exists.

- **SUGGESTED TALK-TRACK**
  - Now we assess again.
  - Same control we started with. It was not met. It is now.
  - The score moved, and we can show you exactly which change moved it.
  - That is the loop closed. Assess, remediate, prove — and the proof is a record, not a claim.

### D.17 `muster-rollup`

- **ID** `muster-rollup`
- **PURPOSE** Show the PRIME contractor its subcontractor rollup — every sub's readiness on one Red/Amber/Green board — by driving ces-muster's real rollup surface.
- **STATUS** **IMPLEMENTED** — committed (GP-DEMO-6). `src/demo/show/ops/muster-rollup-op.ts`; registered in `DEMO_OP_IDS`. Writes a fixed set of SAMPLE StatusPayloads and imports them into the SPA's rollup board through `src/demo/muster-ui-driver.ts`'s `driveMusterRollup`. Not an acts-harness group (it is a deck beat, not a test tier); covered by `tests/demo-muster-rollup.test.ts` and `demo:show --check`.
- **TARGET** ces-muster **SPA** · `features/rollup/StaticRollup.tsx` · **:4173** · visible pane
- **GRADE** CURSOR
- **MODES** `staged` · `live`. **`warm` is REJECTED by the catalog** (a warm rollup would park a stale board) — the 2B loader check enforces the omission.
- **PARAMS** none — the sample fleet is fixed. A Readiness Evaluation reads one tenant, so the honest ceiling is a demonstration of the surface, not a live multi-sub run; a knob here would only invite implying the fleet is real.
- **PRECONDITIONS** Muster SPA armed on :4173 (arming spawns `npm run preview`). **Operator prerequisite: `../ces-muster/dist/index.html` must exist** (`npm run build` in ces-muster) — ces-tester never builds a sibling; absent or unarmed, the beat degrades to the honest sample-board readout card rather than failing.
- **POSTCONDITIONS** The SPA's `prime_and_subs` rollup board is on screen with one RAG row per sample sub. **Deliberately does NOT** claim the subs were evaluated in this run, and does **not** mutate any tenant (it reads no tenant at all — the inputs are authored sample files).
- **INPUTS** The sample StatusPayloads this act writes to the run dir. Environment: the SPA base URL, the run dir.
- **OUTPUTS** The sample StatusPayload files (`status-payload-NN-*.json`); the rollup board rendered on the SPA (or the sample-board card on the degraded path).
- **FAILURE MODES** SPA not armed → the honest sample-board card, never a blank pane. Selector drift or a broken engagement gate → the same card, with the reason logged. A sample that no longer matches `status-payload.schema.json` → the SPA lists it under `form-error`, and the act throws rather than show a board silently short a row.
- **SUCCESS (TESTABLE)** *Registration:* id loads in `--check`. *Behavior:* **MR1** every sample in `SAMPLE_FLEET` carries the schema-required fields and enum values (`tests/demo-muster-rollup.test.ts` hand-asserts them, since ces-tester has no Ajv); **MR2** `fleetSummary` computes the RAG spread the board renders (2 green / 2 amber / 1 red across the 70/40 thresholds), and every party name carries the `(sample)` label so the board itself never reads as live results; **MR3** the driver imports one file per sub, waits for the row count to reach the fleet size, and returns any `form-error` — a non-empty error fails the beat; **MR4** the degraded path renders the readout card and NAVIGATES the pane, while the success path leaves the live SPA on stage.
- **DOCTRINE** **RE — NOT gated (decision 9, 2026-09-06 — the RE restriction is LIFTED).** Live-eligible; `mirror: theatrical` on the pane. Honesty guard specific to this act: the fleet is illustrative, said out loud in the captions and on the card; the real per-sub proof is the single-tenant `muster-readiness` beat.
- **DRIVER** Exists (`src/demo/muster-ui-driver.ts`, `driveMusterRollup` — reuses the connect beat's Profile selectors plus the rollup nav, roster section and file seam).

- **SUGGESTED TALK-TRACK**
  - You just watched one subcontractor prove itself. As the prime, you live with every sub at once.
  - Each sub runs the same read-only evaluation in its own tenant, and its status reports up to you.
  - These are sample status files, so you can see how the board fills in — not results pulled from this run.
  - Green, amber, red, sub by sub. You see where each one stands without an email, and without touching their systems.

---

## E. Known inconsistencies in the current catalog

Recorded here because a dossier that hides them is not a reference.

1. **`ao-registry` does not branch on op mode**, unlike `eo-review`. `warm` and `live` run the same
   flow, so a `warm` AO act simply completes early and its result sits on the pane.
2. **`ao-registry` navigates the visible pane unconditionally** (`ctx.pane.goto`), making it the
   concrete hazard the deck-ordering rule (A.3) warns about.
3. **`ao-registry` judges no artifact** — it reads two badges. Every other implemented act judges an
   artifact or an API. Its `SUCCESS` section is correspondingly thin, and honestly so.
4. **The parameters column now ships** (GP-DEMO-4), so every documented parameter on a registered
   act is a knob a deck can turn. `eo-verify-evidence` was PROPOSED purely for want of it and is now
   IMPLEMENTED. `ao-make-change` (GP-DEMO-4 Slice 1B) is now IMPLEMENTED too — its id is registered
   and the `command` knob is a shipped catalog parameter.
5. **`DEMO_PORTS` labels 5173 `muster`** (`src/cli/demo-command.ts`) but 5173 is **ces-planner's**
   wizard in every current code path; ces-muster's own SPA also defaults to 5173, and the collision
   has been observed live. `muster-api`'s port (4000) is not in `DEMO_PORTS` at all.
   (CONCEPT §7.6 NOTES 3-4.)
6. **The §3 name `ao-registry-command` and the registered id `ao-registry` differ.** The dossier
   uses the registered id; the catalog should reconcile these in Slice 4a.
7. ⚠ **`DEMO-ACTS-CONCEPT.md` §3 says the demo gap is an *"MFA policy absent"*. It is not** — the
   policy exists in report-only state (D.1). The concept doc needs that one phrase corrected; it was
   not editable this pass (dossier-only write scope).
8. **`muster-readiness-op.ts`'s header comment is now stale** — it says RE is "never a live product
   walk", which decision 9 superseded the same day. A comment-only fix, after the build.
9. **The read-only ledger proof is a hard gate in `eval-run.ts` but only advisory in
   `muster-readiness-op.ts`.** Both are deliberate, but the asymmetry is worth knowing before
   writing a test that assumes the show op fails on a non-zero delta. It does not.
10. **There is no end-to-end sim destroy** (D.2): `teardownEphemeralSimTenant` deletes one registry
    file, `demo:reset` wipes the stacksim store and `runs/` but never calls it, and `ArmedSim.stop()`
    deletes nothing. **GP-DEMO-4 Slice 2B resolved the choice:** `simstack-destroy` wraps
    `teardownEphemeralSimTenant` (registry record only), keeps every `runDir` artifact, and never
    shells to `demo:reset` (whose `clear-runs` would delete the run's own evidence).
11. **`ShowOpContext.artifact` is live.** `show-run.ts` wires it to the run report's recorder, and
    all five ops register artifacts through it. One trap survives and is worth knowing: the
    recorder's `opArtifact` returns early when no `opStarted` preceded it for that slide index, so a
    driver that skips `opStarted` records NOTHING while appearing to work. `demo:acts-test` brackets
    every op with both calls for exactly this reason.
12. **The EO Evidence Explorer has no AdminOps-evidence source.** `evidence-router.ts`'s
    `/api/evidence-explorer/index` aggregates Stamper plan-data, blob artifacts, EO's own
    assessment, personnel/risk and a static signal catalog — never the `adminops_evidence` collection
    AO writes to, and its item shape carries no command-id field. So D.15's "show the record the AO
    act just wrote **in the explorer**" is not literally showable: the record's existence is proven
    write-side (the AO `ces.db` row), and the explorer proves the assessment's evidence trail. The
    D.15 SUCCESS clause and talk track were corrected accordingly (GP-DEMO-4 Slice 1A). Also fixed the
    same slice: `eo-review-op.ts`'s `land=evidence` branch clicked `.nav-tab[data-page="evidence"]`,
    but the SPA tab is `data-page="evidence-explorer"` (`ces-eo/public/index.html` L1471) — the
    landing had never actually worked until runtime-verified here.
13. **A-18 alone does not flip the EO determination of `IA.L2-3.5.3`** (measured GP-DEMO-4 Slice 1C,
    run `escc-1c-1`: before `met` / SPRS −89 → after `met` / SPRS −89, **delta 0**). Two facts
    combine: (a) EO's presence-based sim assessment already reads `IA.L2-3.5.3` as **`met`** on a
    fresh seed — the CA policy is *present* (report-only), and presence is what the sim scores, the
    same reason D.1 notes Muster reads it met — so there is no `not_met` for A-18 to flip; and (b)
    `ao-make-change` (A-18) mutates the tenant `authorizationPolicy` (default-user permissions),
    which in this run moved neither that determination nor the overall SPRS. The MFA control's real
    enforcement gap (report-only → enforced) is a `caPolicy-1` change owned by **Stamper** in the
    full arc, not visible as a determination flip here. So `eo-show-change-captured` (D.16) reports
    the control's status and the SPRS delta as INDEPENDENT facts and narrates only what actually
    changed — here, nothing. D.16's suggested talk track ("It was not met. It is now.") describes the
    **stamper-execute** remediation path, not the A-18-only harness path; a deck that follows D.16
    with `ao-make-change` alone must not narrate a control flip. `eo-review-op.ts`'s `assessInPane`
    was exported and given an API-numbers log line the same slice (EC2's cross-check source; the warm
    path logged no numbers before).
14. **`derived.sprs_now.assessed_count` counts SPRS REQUIREMENTS, not observations** (measured
    GP-DEMO-5 Slice 3.1: a real walk gave 329 observations, `assessed_count` 111 ≈ the 110 CMMC L2
    requirements). So D.5's non-vacuous re-pin does NOT use "observations tally == assessed_count"
    (the equality does not hold); it uses real-ingestion evidence — the import is a readiness-result
    of the real walk's size (not the 14-row `DISCOVERY_RESULTS_FIXTURE`) landing on
    `boundary-confirm-panel` (MA3+MA4), a distinction the fixture path fails.

---

## F. Legend

| Term | Meaning |
|---|---|
| **act / demo-act** | A named, tester-implemented demo primitive a deck references by id (+ params, once Slice 4a lands). Design: CONCEPT §2. |
| **op / op id** | The current implementation term; today's `op` column carries an act id. Acts and ops are the same object (CONCEPT §2.1). |
| **op mode** | `staged` (replay) · `warm` (prep-phase) · `live` (on entry, slide holds). |
| **RE / Config / Ops / Assessment** | On-stage names (binding): Muster = Readiness Evaluation, Stamper = Configuration, AO = Operations, EO = Assessment. |
| **doctrine-gated** | Blocked from live product demo by THREAD_HANDOFF **Founder decisions 2026-09-06 item 2 — as narrowed by item 9 (2026-09-06), which lifted the restriction for RE.** Since that amendment the term applies to **Config (Stamper) only**; Config acts ship `mirror: none` per **item 8**. RE, Ops and Assessment are all live-eligible. |
| **decision 9** | The founder's 2026-09-06 amendment: *"the no-live rule now applies to Config (Stamper) only."* Muster/RE may be demoed live once a driver exists. Honesty guards survive the lift; hub-and-spoke remains the Config format. |
| **backstage session** | A second, headless, never-displayed `AppPane` created by the runner in `prepare()` so Config work never appears on the visible pane. |
| **`--check`** | `demo:show --check <deck>` — headless validator. Exit **0** pass / **1** checked-and-failed / **2** unloadable or bad invocation. Forces `staged`, so it never reaches an implementation. |
| **CURSOR / TERMINAL-THEATER / READOUT** | The three visual grades (§C). |
| **T1 / T1.5 / T2 / T3** | Proposed follow-on slices: theatrical cursor layer · in-slide mirror · terminal-theater · new acts (CONCEPT §5, §6.5). |
| **DISCOVERY-1** | ces-muster's `mu discovery --sim` executor — presence-based per-control posture, **not** a score. |
| **MP** | **Manual Mission Plan** (`manual_mission_plan`) — Muster's plan-mode artifact that Stamper executes. Not a POA&M, not an SSP. |
| **SPRS** | Supplier Performance Risk System score — DoD 110-point methodology. Only `met` passes; `partial` and `unknown` deduct full weight. |
| **FCA** | Two meanings in this material: **Fail-Conservative Assessment** (unknown never passes) and **False Claims Act** (why human attestation is mandatory). Disambiguate on use. |
| **`runDir`** | The run-scoped evidence directory arming creates; screenshots and artifacts land there. |
| **GUI-leg false fails** | `GUI_LEG_KNOWN_FALSE_FAILS` — expected sim-only Stamper verification failures. A **different id space** from `known-false-fails.ts` (the CLI registry judge). |
