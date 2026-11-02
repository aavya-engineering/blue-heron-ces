# SIMSTACK-CONFIGS-HOWTO — load / edit / execute demo scenario configs

**Audience:** anyone adding, tuning, or running a demo *simsstack* configuration (a
seeded sim-tenant posture story) on branch `gp-demo-3`. This is the operator + author
runbook for the config machinery; the acceptance CONTRACT for the three new full-chain
configs lives in `docs/demo/SIMSTACK-CONFIGS-SPEC.md`, and the read-vocabulary is defined
in `docs/demo/EVAL-CONFIGS.md`. This doc tells you *how to drive them*, with those three
new configs as worked examples.

**Environment:** Windows PowerShell 5.1 for every command below. Every `demo:*` command is
served by the compiled CLI, so **`npm run build` first** — `bin/ces-tester.mjs` is a thin
loader over `dist/`, never the TypeScript source.

> **Live-leg caveat.** `demo:e2e` and `demo:eval` spawn live legs (stacksim serve, the
> Muster/Stamper/EO/AO drivers, ports). Run those only in the serial live-validation phase.
> Adding or editing a config (§3, §4) and unit-testing it (`npm test`) are CODE-ONLY and
> safe to do any time.

---

## 1. Acronym / shorthand legend (CLAUDE.md rule)

| Term | Meaning |
|---|---|
| **simsstack config** | A demo scenario configuration = a seeded sim tenant + its pinned before/after posture truth. Two homes: an `E2E_CONFIGS` entry (`src/demo/e2e-configs.ts`) and a `scenarios/eval/<id>.json` fixture. |
| **before-truth / after-truth** | Per-probe posture the discovery walk reads at seed (before any remediation) vs. after the ONE plan executes. |
| **P1–P9, N1, N2** | The 11 discovery probes — the ENTIRE gate vocabulary (`docs/demo/EVAL-CONFIGS.md`; SPEC §"11 gated probes"). N1/N2 are permanently-unmatchable negative controls, always `unknown`. |
| **T1–T5** | The 5 shipped eval-only configs (`scenarios/eval/t*.json`, `fullChain:false`) — the ancestry of the 3 new ones. |
| **the ONE plan** | `CLEAN_TENANT_MFA_BASELINE_ANSWER_MAP` (`src/muster-driver/answer-map.ts`) — the ~110-task translated CMMC L2 plan Stamper runs for any seeded tenant. It flips **exactly two probes: P1 and P5**. |
| **DISCOVERY-1** | Muster's presence-based readiness walk. Vocabulary is `met` \| `unknown` only — never `not_met` from silence. Presence-blind (a report-only policy still reads `met`). |
| **fullChain** | `E2eConfigEntry.fullChain` — `true` ⇒ the config has a PROVEN Stamper remediation path (an after-arc); `false` ⇒ Stamper beat is reported `n/a`, never silently skipped. |
| **decoy** | An object that exists but whose displayName does not match a probe's filter, so it earns no credit (T5's / decoy-maze's trick). No decoy name may begin with `CMMC-` (P5's filter is a PREFIX match). |
| **honest-open** | A probe the plan TARGETS but whose task fails live (pinned), so it stays `unknown` after remediation — recorded, never masked. |
| **CMMC** | Cybersecurity Maturity Model Certification — the DoD control framework the probes assess (L2 = Level 2). |
| **clause 3 / clause 5 / clause 10** | Predicate clauses of the `demo:e2e` run predicate: clause 3 = before-truth discovery gate; clause 5 = GUI-leg known-false-FAIL partition; clause 10 = post-remediation Muster re-read (the after-truth). |
| **GUI_LEG_KNOWN_FALSE_FAILS** | The calibrated clause-5 known-false-FAIL set (`src/demo/e2e-run.ts`). See §5.4. |
| **provenance** | `afterTruth.provenance` on a config: `'authored-contract'` (the map is a spec contract, NOT yet reproduced live → clause 10 reports `calibrating`) or `'live-adjudicated'` (reproduced live → clause 10 judged `pass`/`fail`). |
| **calibrating** | A clause status: recorded but never rendered clean. A normal run still exits non-zero on it; only `--calibrate` accepts it (clause 5) / re-stamps it (clause 10). |
| **AO / EO** | ces-ao (AdminOps, Beat 5, runs command A-18) / ces-eo (Evidence Ops, before/after depth assessment). |
| **GP-DEMO-N** | The Nth iteration/milestone of the CES-wide demo build (this work is GP-DEMO-3). |
| **M7** | GP-DEMO-3's milestone that PINNED the clause-5 `GUI_LEG_KNOWN_FALSE_FAILS` set from `demo-dib-small`'s first post-seed live execute (§5.4). |
| **Beats 0–5** | The six ordered stages of a `demo:e2e` run: 0 spine, 1 seed + discovery gate, 2 Muster wizard, 3 Stamper remediation, 4 post-remediation re-read, 5 AO A-18. |
| **FD-3 / FD-4** | Founder-decisions in `PLAN-E2E-AO-DEMO.md`: FD-3 = AO runs A-18 last; FD-4 = only demo-dib-small carried a proven full chain; the 3 new configs extend that set. |

---

## 2. The three new configs (IDs + one-line stories)

All three are `fullChain: true`. Each ID is BOTH the `E2E_CONFIGS.id` and the eval-fixture
`config_id` / seed slug — one name, one story, two files.

| Config ID | Slug | One-line story |
|---|---|---|
| **`eval-decoy-maze`** | `eval-decoy-maze` | The full-chain successor to T5: five CA policies, every one decoy-named, so the MOST-configured tenant earns the LEAST credit — and after the plan flips P1/P5, three decoyed controls stay open (remediation ≠ completeness). |
| **`eval-fresh-gap`** | `eval-fresh-gap` | A brand-new, competently-built CUI enclave: P2/P3 correctly CMMC-named at seed, only P1/P5 never stood up — the confounder-free mirror of decoy-maze (does Muster UNDER-credit?) that ends fully green except the unmatchable N1/N2. |
| **`eval-scope-boundary`** | `eval-scope-boundary` | The automation-reach case: two decoy-shadowed gaps the plan CAN fix (P1/P5) plus a governance gap it structurally CANNOT (P9, no cross-tenant policy) — teaching a permanent scope boundary apart from a transient pinned bug (P2/P3). |

---

## 3. How to ADD a config

A config is authored in two places that must agree. Do both, then unit-test.

### 3.1 Author the eval fixture — `scenarios/eval/<id>.json`

This file owns the **seed** and the **before-truth** (its single source of truth). Required
shape (validated by `loadEvalConfigFile`, `src/demo/eval-run.ts:82` — a bad shape throws):

```json
{
  "config_id": "eval-decoy-maze",
  "description": "one paragraph — the story, the distinctness, the trap",
  "stacksim_seed": {
    "stance": "m365_azure",
    "countOverrides": { "caPolicies": 5 },
    "steps": [
      { "kind": "uri", "method": "PATCH",
        "uri": "/v1.0/identity/conditionalAccess/policies/caPolicy-1",
        "body": { "displayName": "Legacy-MFA" },
        "note": "decoy — not a CMMC name → no CA-probe credit" }
    ]
  },
  "expected_discovery": {
    "AC.L2-3.1.11": "unknown",
    "PS.L2-3.9.2": "met"
  }
}
```

Rules that keep the fixture honest:

- **`config_id` = the slug = the `E2E_CONFIGS.id`.** `runScenario` materializes the tenant
  under `config.config_id` (`eval-run.ts:231`), so the three names are one.
- **`expected_discovery` is the 11-key before-truth** — every value is `met` or `unknown`
  (no `not_met`, ever). Copy the exact per-probe table from SPEC §2 for the config.
- **Never pre-seed a name the plan creates** (`CMMC-SessionTimeout`, `CMMC-RemoteMaintenance-MFA`):
  P1/P5 stay ABSENT at seed so the plan creates them fresh with no collision.
- **No decoy displayName begins with `CMMC-`** (P5's filter is a PREFIX match — the
  dangerous one). Every decoy name in the three configs passes this.
- `countOverrides` picks how many objects the generator serves (`caPolicies: 5` for
  decoy-maze; `caPolicies: 2` for fresh-gap / scope-boundary; add
  `crossTenantAccessPolicy: 0` to make P9 read `unknown`, as scope-boundary does).

Worked examples already on disk: `scenarios/eval/eval-decoy-maze.json`,
`eval-fresh-gap.json`, `eval-scope-boundary.json`.

### 3.2 Add the `E2E_CONFIGS` entry — `src/demo/e2e-configs.ts`

This is what `demo:e2e --config <id>` resolves. Append an `E2eConfigEntry` (the three new
entries are already present, `e2e-configs.ts:240-320`):

```ts
{
  id: 'eval-decoy-maze',
  slug: 'eval-decoy-maze',
  fullChain: true,
  description: 'SIMSTACK §2.1 — …',
  // BEFORE-truth stays a POINTER at the fixture (single source of truth):
  expectedDiscovery: { source: 'eval-config', configFile: 'scenarios/eval/eval-decoy-maze.json' },
  // AFTER-truth ships as a CALIBRATED INLINE map — the ONLY valid shape:
  afterTruth: {
    source: 'calibrated',
    provenance: 'authored-contract',   // until live-calibrated
    establishedAt: '2026-08-30',
    postures: {
      'AC.L2-3.1.11': 'met',   // P1 flips
      'MA.L2-3.7.5':  'met',   // P5 flips
      'AC.L2-3.1.14': 'unknown', // P2 pinned honest-open
      // …all 11 keys…
    },
  },
  aoCommand: 'A-18',
}
```

Two non-negotiables (SPEC §4, "the trap"):

- **before-truth = `{ source: 'eval-config', configFile: … }`** — a POINTER, so the fixture
  stays the single source of truth (T1–T5's maps were corrected after live adjudication;
  a second inline copy would silently diverge).
- **after-truth = `{ source: 'calibrated', … }` INLINE.** An `eval-config` after-truth
  pointer would resolve to that file's `expected_discovery` — i.e. the BEFORE map — and
  judge clause 10 against the wrong posture. `resolveAfterTruth` / `resolveGroundTruth`
  (`e2e-configs.ts:380`) make that mistake silent, so the inline map is the only safe shape.
- Set **`provenance: 'authored-contract'`** for a map derived from the spec/prior evidence
  but not yet reproduced on THIS config's own seed path. Clause 10 then reports
  `calibrating` (never a fabricated clean pass). The serial `--calibrate` phase (§5.3)
  reproduces the values and re-stamps the map `'live-adjudicated'`.

### 3.3 Unit-test (CODE-ONLY, safe now)

```powershell
npm run build
npm test
```

`tests/demo-e2e-configs.test.ts` checks the registry shape (every after-truth is
`calibrated`, keys are the 11-probe vocabulary, etc.); `tests/eval-configs.test.ts` and
`tests/scenarioFile.test.ts` validate the fixtures. No live leg runs.

---

## 4. How to EDIT a config (change the seed or the truth)

- **Change the seed** (add/rename a decoy, flip a `countOverride`, disable a different
  user): edit the `steps` / `countOverrides` in `scenarios/eval/<id>.json` ONLY. The
  before-truth pointer already reads this file, so the E2E entry needs no change unless the
  posture the seed produces changes.
- **Change the before-truth** (a probe now reads differently at seed): edit
  `expected_discovery` in the fixture. That single edit updates both the `demo:eval` gate
  and the `demo:e2e` clause-3 gate (both resolve the pointer). Do NOT copy the value into
  the E2E entry — there is no before-map there to edit.
- **Change the after-truth** (remediation outcome changed): edit the inline `postures` in
  the `E2E_CONFIGS.afterTruth` block. **When you change a number, change the provenance
  discipline with it** — a hand-edited map is `'authored-contract'` again until a live
  `--calibrate` run reproduces it. Never quietly bump `establishedAt` and leave
  `'live-adjudicated'` standing on an unverified value (SPEC §4 amendment).
- After ANY edit: `npm run build` then `npm test`. The registry/fixture tests catch a
  divergence (e.g. an after-truth key outside the 11-probe vocab, or a `not_met` slipped
  into a fixture) before a live run does.

**Worked edit — retire the calibration flag.** After the serial live phase reproduces
`eval-decoy-maze`'s after-map on its own seed path, flip its entry from
`provenance: 'authored-contract'` to `provenance: 'live-adjudicated'` and set
`establishedAt` to the adjudication date. Clause 10 then judges `pass`/`fail` normally
instead of `calibrating`. That is the ONLY edit that promotes a config out of `calibrating`.

---

## 5. How to EXECUTE a config

All commands are `node bin/ces-tester.mjs <cmd>` from the ces-tester root, after
`npm run build`. Two entry points, by what you want to prove.

### 5.1 `demo:eval --config <id>` — the "Muster reads it right" leg (before-truth only)

Seeds the tenant from the fixture, runs the DISCOVERY-1 walk once, and diffs the live read
against `expected_discovery`. This is the fast, single-leg gate — no Stamper, no after-arc.

```powershell
npm run build
node bin/ces-tester.mjs demo:eval --config eval-decoy-maze
```

- `--all` runs every discovered fixture (T1–T5 + the three new ones) and prints the N/N
  gate; `--config <id>` runs exactly one. One of the two is required.
- PASS ⇒ `schemaValid`, `readOnly` (zero ledger mutations — the read-only proof), and zero
  posture mismatches. Any mismatch prints `MISMATCH <control>: expected …, got …`.
- Evidence: `runs/eval/<runId>/gate-summary.json`.
- Optional roots: `--muster-root`, `--stacksim-root`, `--stamper-root` (default to sibling
  dirs under `../`).

Use this leg to validate a NEW fixture's before-truth in isolation before wiring the full
chain.

### 5.2 `demo:e2e --config <id>` — the full Muster + Stamper + after-truth chain

Runs Beats 0–5: discovery gate (clause 3) → Muster wizard → Stamper remediation (clause 5)
→ post-remediation Muster re-read against the after-truth (clause 10) → AO A-18.

```powershell
npm run build
node bin/ces-tester.mjs demo:e2e --config eval-decoy-maze
```

- No `--config` ⇒ the FD-4 default, `demo-dib-small`. An unknown id THROWS (exit 2) — it
  never silently defaults to another tenant.
- `--plan` prints the beat plan + the config list and executes NOTHING (safe any time):
  ```powershell
  node bin/ces-tester.mjs demo:e2e --config eval-fresh-gap --plan
  ```
- Exit 0 only when every clause passes / is `n/a` / is an ACCEPTED `calibrating`; exit 1 on
  an honest partial; exit 2 on a bad invocation.
- Evidence: `runs/e2e/<runId>/` (discovery results, Stamper failure taxonomy, the
  post-remediation re-read, AO evidence).
- On the three new configs, clause 10 reports **`calibrating`** on a normal run (their
  after-maps are `provenance: 'authored-contract'`), so a normal run exits non-zero until
  the calibration flow below is done. That is by design — no fabricated live pass.

### 5.3 `--watch` — spectate the live legs

Adds `--watch` to **`demo:e2e`** (and `demo:run`) to drive the Playwright legs headed
(visible browser) so you can watch the wizard/remediation on screen. Threaded straight into
the drivers via `resolveWatchMode`; the run is otherwise identical. `demo:eval` does NOT
parse `--watch` — its single discovery walk is headless-only, so the flag is silently
inert there.

```powershell
node bin/ces-tester.mjs demo:e2e --config eval-scope-boundary --watch
```

### 5.4 `--calibrate` — the per-config known-false-FAIL + after-truth calibration flow (M7)

Two calibrated things are **per-config** and must be established on each config's own live
seed path before that config can produce a clean `demo:e2e`:

1. **The clause-5 GUI-leg known-false-FAIL set** (`GUI_LEG_KNOWN_FALSE_FAILS`,
   `e2e-run.ts:811`). It was pinned from `demo-dib-small`'s first post-seed live execute
   (M7), and `M2-ENTRY-FINDINGS.md` proved it is drive-mode-dependent — so assume it is
   posture-dependent too. A new config may reach tasks demo-dib-small never did.
2. **The clause-10 after-truth** — an `'authored-contract'` map must be reproduced live and
   re-stamped `'live-adjudicated'`.

The flow (serial live phase only):

```powershell
# 1. Run once WITHOUT --calibrate to record the live taxonomy + re-read.
node bin/ces-tester.mjs demo:e2e --config eval-decoy-maze
#    -> clause 5 reports `calibrating` if no set exists yet; clause 10 reports
#       `calibrating` (authored-contract). Run exits non-zero — nothing masked.

# 2. Inspect the recorded evidence.
#    runs/e2e/<runId>/stamper-failure-taxonomy.json   (clause-5 calibration input)
#    runs/e2e/<runId>/discovery-after-result.json      (clause-10 re-read, read-only walk)

# 3. CLASSIFY every failing id (never transcribe). Pin ONLY ids with a
#    demonstrated, sibling-owned cause (verification class = REQ-STAMPER-ROTATING-VERIFY-FAIL;
#    capture-cascade class = REQ-STAMPER-SUBCOMMAND-CAPTURES-NOT-RUN). Anything without a
#    proven cause stays OUT and fails clause 5 loudly. Add the ids by editing
#    GUI_LEG_KNOWN_FALSE_FAILS (see the mechanism note below).

# 4. Re-run WITH --calibrate to ACCEPT the recorded taxonomy (clause 5) and the
#    re-read (clause 10) as success FOR THIS RUN.
node bin/ces-tester.mjs demo:e2e --config eval-decoy-maze --calibrate
```

- `--calibrate` changes exit semantics for `calibrating` clauses ONLY. For clause 10 it
  accepts the RECORDED re-read as success — and note (`e2e-run.ts:489-502`) that on an
  `'authored-contract'` map BOTH a matching and a diverging re-read are recorded as
  `calibrating`, so `--calibrate` accepts either at the exit-code level. A divergence is not
  silently blessed: it is surfaced in the clause detail (`expected … got …`) with the
  instruction that **the config is re-examined, not the number quietly changed** (SPEC §4).
  That discipline is on the operator reading the detail, not enforced by the exit code —
  so ALWAYS read the clause-10 detail on a `--calibrate` run before promoting the map.
- A contaminated (ledger-writing) or aborted re-read is a loud **FAIL** regardless of
  provenance or `--calibrate` — `calibrating` on a broken measurement would be worthless
  (`e2e-run.ts:473-488`).
- `--calibrate` does NOT excuse any other clause. `--skip-gates` (which makes clause 9
  report `not run`, still a FAIL) is separate and never a substitute.
- After a `--calibrate` run whose clause-10 detail shows the re-read reproduced the map,
  promote the entry to `provenance: 'live-adjudicated'` (the §4 worked edit) so future
  NORMAL runs judge clause 10 `pass`/`fail`.

> **Per-config pin mechanism — the current state.** `GUI_LEG_KNOWN_FALSE_FAILS` is today a
> SINGLE global const (`e2e-run.ts:811`), calibrated on `demo-dib-small`. The run leg does
> accept an override (`opts.guiKnownFalseFails`, `e2e-run.ts:865`), but that option is NOT
> exposed on the CLI and `E2eConfigEntry` carries no pin field — so "per-config sets" is a
> live-phase item (SPEC §4 flag #1), not a wired feature. Until it is wired, extend the one
> global set with demonstrated-cause ids only. A genuinely per-config partition is the
> promotion work that flag #1 tracks.
- **Never pin speculatively.** A pin with no observed, sibling-owned cause is a fabricated
  exemption. The three configs' open items (fresh-gap/scope-boundary's `caPolicies: 2`, a
  possible P9-VERIFY pin on scope-boundary's `crossTenantAccessPolicy: 0`) are listed in
  SPEC §4 as things the live phase CONFIRMS, not things a normal run trusts.

---

## 6. Quick reference

```powershell
npm run build                                              # required before any demo:* command

node bin/ces-tester.mjs demo:eval  --config eval-decoy-maze         # before-truth leg (fast)
node bin/ces-tester.mjs demo:eval  --all                           # all fixtures, N/N gate

node bin/ces-tester.mjs demo:e2e   --config eval-fresh-gap --plan  # plan only, no execution
node bin/ces-tester.mjs demo:e2e   --config eval-fresh-gap         # full chain (Beats 0-5)
node bin/ces-tester.mjs demo:e2e   --config eval-scope-boundary --watch      # spectate
node bin/ces-tester.mjs demo:e2e   --config eval-scope-boundary --calibrate  # accept recorded

npm test                                                  # unit tests only (code-only, safe)
```

**The three config IDs:** `eval-decoy-maze`, `eval-fresh-gap`, `eval-scope-boundary`.
