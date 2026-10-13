# SIMSTACK-CONFIGS-SPEC — the 3 locked full-chain simsstack configs (GP-DEMO-3)

**Status:** LOCKED SPEC, uncommitted, branch `gp-demo-3`. This is the acceptance
CONTRACT for three NEW full-chain configs, selected and tightened from the six
candidates in `docs/context/SIMSTACK-CONCEPTS-{assess,attack}.md`. Nothing here is wired
yet — promotion into `src/demo/e2e-configs.ts` (`E2E_CONFIGS`) + a `scenarios/eval/*.json`
is a later phase, gated on serial live-validation. This document defines what each config
MUST be; the live phase calibrates the numbers this contract asserts.

**Selection (3 of 6 candidates):**
- **Config 1 `eval-decoy-maze`** ← assess-doc Candidate 1 (over decoy-shadow-ca / attack-A).
- **Config 2 `eval-fresh-gap`** ← attack-doc Config B (over assess-C2 two-gaps-clean, its near-dup).
- **Config 3 `eval-scope-boundary`** ← assess-doc Candidate 3, **P9-re-anchored** (its P6=unknown claim was unachievable — see §2.3).

**Dropped:** `eval-tarpit` (attack-C) pre-seeds `CMMC-RemoteMaintenance-MFA`, a name the ONE
plan itself creates — violating the never-pre-seed-a-plan-created-name rule and introducing a
skip-vs-duplicate ambiguity on P5 with no lesson decoy-maze does not already carry.
`eval-shadow-ca` (attack-A) has a before-map identical to demo-dib-small (admitted in-doc).
`eval-two-gaps-clean` (assess-C2) is a near-dup of `eval-fresh-gap` plus an out-of-vocab P4
policy. All three drops are on distinctness/over-reach grounds.

---

## Acronym / shorthand legend (CLAUDE.md rule)

| Term | Meaning |
|---|---|
| **P1–P9, N1, N2** | The 11 discovery probes (`docs/demo/EVAL-CONFIGS.md:22-29`). Only 11 control ids are in the shipped gate vocabulary. |
| **T1–T5** | The 5 shipped eval-only configs (`scenarios/eval/t*.json`; `fullChain:false`). |
| **the ONE plan** | `CLEAN_TENANT_MFA_BASELINE_ANSWER_MAP` (`src/muster-driver/answer-map.ts`) → the ~110-task translated CMMC L2 plan Stamper runs for ANY seeded tenant. |
| **DISCOVERY-1** | Muster's presence-based readiness walk; vocabulary is `met`\|`unknown` only, never `not_met` from silence (`EVAL-CONFIGS.md:9-20`). |
| **before-truth / after-truth** | Per-probe posture at seed (Muster reads in Beat 1) vs. what the SAME walk reads after the ONE plan executes (post-Beat-3 re-read). |
| **fullChain** | `E2eConfigEntry.fullChain` (`e2e-configs.ts:57`) — true ⇒ the Stamper remediation beat has a proven path. |
| **clause 3 / clause 5 / clause 10** | Predicate clauses of the 9(+1)-clause run predicate: clause 3 = before-truth discovery gate; clause 5 = `GUI_LEG_KNOWN_FALSE_FAILS` partition; clause 10 = post-remediation Muster re-read (`e2e-run.ts` postRemediation facts, `:893`). |
| **GUI_LEG_KNOWN_FALSE_FAILS** | The calibrated clause-5 known-false-FAIL set (`e2e-run.ts:768-797`). |
| **FD-3 / FD-4** | Founder-decisions in `PLAN-E2E-AO-DEMO.md`: FD-3 = AO runs A-18 (Tier-2, mutates `authorizationPolicy`) last; FD-4 = only demo-dib-small carried a proven full chain — these extend that. |
| **decoy** | An object that exists but does not match a probe's displayName filter, so it earns no credit (T5's trick). |
| **honest-open** | A probe the plan TARGETS but whose task fails live (pinned), so it stays `unknown` after — recorded, never masked. |

### The 11 gated probes (control ids ← shorthand, with filter grounding)

| Probe | Control id(s) | Object | Probe filter (ces-stamper registry) | Match kind |
|---|---|---|---|---|
| P1 | `AC.L2-3.1.11` | session-timeout CA | `displayName eq 'CMMC-SessionTimeout'` | EXACT-EQ |
| P2 | `AC.L2-3.1.14`, `SC.L2-3.13.7` | block-untrusted CA | `CMMC-BlockUntrustedLocations` | exact |
| P3 | `AC.L2-3.1.15` | admin-MFA CA | `CMMC-AdminMFA-PhishingResistant` | exact |
| P5 | `MA.L2-3.7.5` | remote-maintenance CA | `Where-Object DisplayName -like 'CMMC-RemoteMaintenance*'` (`cmmc-l2-commands.registry.json:2127`) | **PREFIX** |
| P6 | `PS.L2-3.9.2` | a disabled account present | `Get-MgUser -Filter 'accountEnabled eq false'` (`registry:2623`) | see §2.3 |
| P7 | `IA.L2-3.5.5`, `IA.L2-3.5.6` | users exist | any user present | presence |
| P9 | `AC.L1-3.1.20` | cross-tenant policy | singleton present | presence |
| N1 | `AC.L2-3.1.12` | named-location | unmatchable → ALWAYS unknown | — |
| N2 | `IA.L2-3.5.4` | phishing-strength | unmatchable → ALWAYS unknown | — |

**Out of vocab, never in any map:** P4 `AC.L2-3.1.18` and P8 `AC.L2-3.1.20` were dropped after
live adjudication (`e2e-configs.ts:41-43`; `AC.L2-3.1.20` emits no observation). No config below
names either.

---

## 1. The load-bearing fact — the ONE plan flips exactly TWO probes: P1 and P5

Measured live from `runs/e2e/m7-run5/` (the completed GUI-leg execute, `status: partial`,
96/110 completed):

- **P1 `AC.L2-3.1.11`** — the plan's `New-MgIdentityConditionalAccessPolicy displayName=CMMC-SessionTimeout` task **completed**: `CMMC-SessionTimeout` is present in `runs/e2e/m7-run5/ledger-snapshot.json` and is NOT in `stamper-failure-taxonomy.json` `failureIds`. **unknown→met.**
- **P5 `MA.L2-3.7.5`** — `New-MgIdentityConditionalAccessPolicy -DisplayName 'CMMC-RemoteMaintenance-MFA'` task **completed**: `CMMC-RemoteMaintenance-MFA` is in the ledger, not in `failureIds`. **unknown→met.** (Honest footnote: the created policy is `-State 'enabledForReportingButNotEnforced'` — report-only — yet DISCOVERY-1 reads it `met` because it is presence-blind, `REQ-MUSTER-DISCOVERY-STATE-BLINDNESS`. The flip is real for THIS layer; depth is EO's.)

Everything a config leaves absent/decoy **stays that way after the plan**:

- **P2 `AC.L2-3.1.14`/`SC.L2-3.13.7`** and **P3 `AC.L2-3.1.15`** — their creating tasks are in
  `m7-run5` `failureIds` (`Unresolved runtime variables: namedLocationId` /
  `phishingResistantStrengthId`) and are pinned (`GUI_LEG_KNOWN_FALSE_FAILS`,
  `e2e-run.ts:786-788`). The GUI leg's `ExecutionContext.resolve()` **throws before the command
  runs** (`M2-ENTRY-FINDINGS.md`, `ExecutionContext.ts:99-120`) — so the task fails identically
  whether or not a matching object already exists; the get-then-set idempotency guard is never
  reached. Consequence: a seeded CMMC-named P2/P3 object is **untouched** by the failing task
  (stays met, no regression); an absent/decoy P2/P3 stays unknown (honest-open).
- **P6 `PS.L2-3.9.2`** — plan node `manual-PS.L2-3.9.2`, `manual_gate`, empty `set_command`: the
  plan never disables an account. Held by SEED. (Footnote: the plan's inactive-user sweep,
  `registry:1769`, MAY disable seeded users at Beat 3, but P6/P7 read presence, not enabled-state,
  so the 11-key after-truth is invariant.)
- **P7 `IA.L2-3.5.5/6`** — the plan creates no users. Held by SEED. Do NOT zero `users`.
- **P9 `AC.L1-3.1.20`** — the plan references `crossTenantAccessPolicy` in GET/verify only; **zero**
  crossTenant `mutate` at M4 in the `m7-run5` ledger. Held by SEED — the plan structurally cannot
  create it. This is the architectural boundary Config 3 teaches.
- **N1/N2** — always `unknown` (unmatchable filters). demo-dib-small had a namedLocation at seed
  and N1 STILL read unknown (`m7-run5/discovery-result.json`). Presence of a namedLocation ≠ an N1
  match.

**Design rule obeyed by all three configs:** never pre-seed a name the plan creates
(`CMMC-SessionTimeout`, `CMMC-RemoteMaintenance-MFA`) — P1/P5 are always left ABSENT at seed, so
the plan creates them fresh with no collision. **Decoy naming rule:** no decoy displayName may
begin with `CMMC-` (P5's filter is a PREFIX match — the dangerous one). Every decoy name below
passes.

---

## 2. The three configs

### 2.1 Config 1 — `eval-decoy-maze` (id `eval-decoy-maze`, slug `eval-decoy-maze`)

**Story.** The full-chain successor to T5. A shop two years in that has been *busy* — five
Conditional Access policies stood up — but every one carries an internal/project name, not the
assessor-required CMMC name. It looks the MOST configured of any tenant and earns the LEAST
credit. It is the sharpest assessor-edge-case: two truths in one config — *presence ≠ credit*, and
*remediation ≠ completeness* (after the plan, three of the five decoyed controls are STILL open).

**Distinctness (own the coincidence).** The 11-key BEFORE map is IDENTICAL to T5's
(`t5-eval-decoys.json` expected_discovery). Its novelty is (a) the 5-decoy seed (T5 has 3),
(b) the hostile "most-configured-earns-least" story, and (c) it is FULL-CHAIN with an after-arc —
T5 is `fullChain:false`, Stamper `n/a`, no after-truth exists for it. The after-map is unique in
the whole config set.

**`stacksim_seed`** (shape per `t5-eval-decoys.json`; materialized via `runScenario`,
`e2e-run.ts:980`):
```
stance: m365_azure
countOverrides: { caPolicies: 5 }          # profiles/m365-azure.json:17 default is 3; T4 attests 5; generator caPolicies.ts:7 serves any count
steps (all kind:"uri", method:"PATCH"):
  PATCH /v1.0/identity/conditionalAccess/policies/caPolicy-1  body { displayName: "Legacy-MFA" }          # T5-proven decoy
  PATCH /v1.0/identity/conditionalAccess/policies/caPolicy-2  body { displayName: "Pilot-CA" }             # T5-proven decoy
  PATCH /v1.0/identity/conditionalAccess/policies/caPolicy-3  body { displayName: "Block-Old-TLS" }        # T5-proven decoy
  PATCH /v1.0/identity/conditionalAccess/policies/caPolicy-4  body { displayName: "MDM-Rollout-Ring1" }    # new decoy — no CMMC- prefix
  PATCH /v1.0/identity/conditionalAccess/policies/caPolicy-5  body { displayName: "Maint-Window-VPN" }     # new decoy — no CMMC- prefix
  PATCH /v1.0/users/user-5  body { accountEnabled: false }                                                 # P6 met (t3/t4/t5 pattern; user-5 is last of default 5)
```
No CMMC-named policy present → P1/P5 (the plan's targets) are ABSENT at seed (created fresh).
Default users (5) kept → `user-2`/`group-1` resolve the plan's P1/P5 captures; P7 met. Default
`crossTenantAccessPolicy` (1) kept → P9 met.

**BEFORE-truth** (11-key): `AC.L2-3.1.11` **unknown** · `AC.L2-3.1.14` **unknown** ·
`SC.L2-3.13.7` **unknown** · `AC.L2-3.1.15` **unknown** · `MA.L2-3.7.5` **unknown** ·
`PS.L2-3.9.2` **met** · `IA.L2-3.5.5` **met** · `IA.L2-3.5.6` **met** · `AC.L1-3.1.20` **met** ·
`AC.L2-3.1.12` **unknown** · `IA.L2-3.5.4` **unknown**.

**Gaps Stamper remediates:** P1 (`CMMC-SessionTimeout`), P5 (`CMMC-RemoteMaintenance-MFA`) — fresh, no collision with the five decoys.

**AFTER-truth:** `AC.L2-3.1.11` **met** · `AC.L2-3.1.14` **unknown** · `SC.L2-3.13.7` **unknown** ·
`AC.L2-3.1.15` **unknown** · `MA.L2-3.7.5` **met** · `PS.L2-3.9.2` **met** · `IA.L2-3.5.5` **met** ·
`IA.L2-3.5.6` **met** · `AC.L1-3.1.20` **met** · `AC.L2-3.1.12` **unknown** · `IA.L2-3.5.4` **unknown**.
(P1, P5 flip; **P2, P3 STAY unknown** — pinned honest-open; P6/P7/P9 unchanged; N1/N2 unknown.)

**Why it is an honest test.** (1) Muster gives zero credit for five wrong-named policies — reads
what's *required*, not what's *there* (anti-halo). (2) After the plan, three of five decoyed
controls are STILL unknown, forcing the honest "we closed two, three remain" beat — the demo
cannot narrate the plan as a magic wand.

---

### 2.2 Config 2 — `eval-fresh-gap` (id `eval-fresh-gap`, slug `eval-fresh-gap`)

**Story.** A brand-new, competently-built CUI enclave. Block-untrusted-locations and admin-MFA
were configured correctly and CMMC-named on day one — but the two policies teams most often forget,
idle **session termination** (P1) and **non-local maintenance MFA** (P5), were never stood up. No
drift, no decoys: the confounder-free control that isolates the flip mechanic and demonstrates the
full green-after. It is the mirror of Config 1: Config 1 asks *does Muster OVER-credit?*; this asks
*does Muster UNDER-credit?*

**Distinctness.** Distinct from T4 mostly-hardened (5 CMMC-named, all-met, eval-only, never
remediated) and from T2 identity-first (P1 CMMC-named and met at seed — here P1 is the ABSENT gap).
Distinct from demo-dib-small (4 non-CMMC CA gaps + a report-only-MFA depth headline). Its
distinctness is the remediation ARC (two real gaps → both closed → every gated probe met but N1/N2),
not the static posture.

**`stacksim_seed`:**
```
stance: m365_azure
countOverrides: { caPolicies: 2 }          # NEW count value (default 3, T2 attests {}, T4 attests 5); generator caPolicies.ts:7 serves range(2). LIVE-VERIFY caPolicies:2 serves cleanly.
steps:
  PATCH /v1.0/identity/conditionalAccess/policies/caPolicy-1  body { displayName: "CMMC-BlockUntrustedLocations" }   # P2 met BEFORE (verbatim from t2/t4)
  PATCH /v1.0/identity/conditionalAccess/policies/caPolicy-2  body { displayName: "CMMC-AdminMFA-PhishingResistant" } # P3 met BEFORE (verbatim from t2/t4)
  PATCH /v1.0/users/user-5  body { accountEnabled: false }                                                           # P6 met
```
No mobile-device (P4) policy — P4 is out of vocab; adding it would only introduce ungated noise.
P1/P5 left ABSENT (the gaps). Default users/crossTenant kept → P7/P9 met.

**BEFORE-truth:** `AC.L2-3.1.11` **unknown** · `AC.L2-3.1.14` **met** · `SC.L2-3.13.7` **met** ·
`AC.L2-3.1.15` **met** · `MA.L2-3.7.5` **unknown** · `PS.L2-3.9.2` **met** · `IA.L2-3.5.5` **met** ·
`IA.L2-3.5.6` **met** · `AC.L1-3.1.20` **met** · `AC.L2-3.1.12` **unknown** · `IA.L2-3.5.4` **unknown**.

**Gaps Stamper remediates:** P1, P5.

**AFTER-truth:** `AC.L2-3.1.11` **met** · `AC.L2-3.1.14` **met** · `SC.L2-3.13.7` **met** ·
`AC.L2-3.1.15` **met** · `MA.L2-3.7.5` **met** · `PS.L2-3.9.2` **met** · `IA.L2-3.5.5` **met** ·
`IA.L2-3.5.6` **met** · `AC.L1-3.1.20` **met** · `AC.L2-3.1.12` **unknown** · `IA.L2-3.5.4` **unknown**.
**Every gated probe met EXCEPT N1/N2.**

P2/P3 stay met because their plan tasks fail PRE-EXECUTION (`ExecutionContext.resolve()` throws on
`namedLocationId`/`phishingResistantStrengthId` before the command runs — `M2-ENTRY-FINDINGS.md`),
so the seeded objects are never touched. This is honest: a remediation task that fails on a
control already met does not regress it.

**Why it is an honest test.** With no decoys and no drift it cleanly proves the `unknown→met`
transition on exactly the two reliably-flippable probes AND that Muster does not UNDER-credit two
genuinely-present, correctly-named policies (no false unknown at seed). It also makes the
negative-control honesty vivid: even a fully-remediated tenant leaves N1/N2 `unknown`, because
those filters are permanently unmatchable — the layer never manufactures credit from a full pass.

---

### 2.3 Config 3 — `eval-scope-boundary` (id `eval-scope-boundary`, slug `eval-scope-boundary`)

**Story.** The automation-reach case. A tenant with the two CA gaps the plan CAN fix (P1/P5 absent,
sitting behind two decoy policies) AND a governance gap the plan structurally CANNOT touch: **no
cross-tenant access policy (P9)**. Its job is to teach the assessor where the automation's reach
ends and to distinguish two different reasons a gap stays open after remediation:
- **P9 stays unknown for an ARCHITECTURAL reason** — the plan has NO cross-tenant create task at
  all (zero crossTenant mutate in `m7-run5`). It will NEVER flip, regardless of bug fixes. Needs a
  human or a different plan.
- **P2/P3 stay unknown for a TRANSIENT reason** — the plan TRIES to create them but the task is
  pinned-failing on the capture-cascade bug (`GUI_LEG_KNOWN_FALSE_FAILS`). They flip once
  GP-STAMPER-1 lands `REQ-STAMPER-SUBCOMMAND-CAPTURES-NOT-RUN`.

**Tightening from assess-doc Candidate 3 (IMPORTANT).** The source concept claimed **P6=unknown**
(no disabled-offboarding account). **That is unachievable and is corrected here.** Evidence:
`tenant-stacksim/src/seed/generators/identity.ts:12` creates ALL default users
`accountEnabled: true` — there is no default disabled account — yet `t2-eval-identity-first.json`
(default users, NO disable step) has an ADJUDICATED `PS.L2-3.9.2: met` (it passed the live gate
5/5). The only way to make P6 read `unknown` is to zero `users`, which breaks the plan's
`breakGlassUserId=user-2` / `cuiGroupId=group-1` captures (constraint #3, `stamper-plan-variables.ts:184-190`)
— forbidden on a full chain. So this config **keeps P6=met** and re-anchors the scope-boundary
lesson entirely on **P9** (which IS honestly seedable to unknown via T1's proven crossTenant-zero
mechanic). P9's architectural permanence is a *sharper* boundary lesson than P6 would have been.

> P6 mechanism note (empirical-airtight, mechanism-inferred): the fact `P6=met with zero disabled
> accounts` is adjudicated (t2, gate 5/5). The *mechanism* — a server-side `accountEnabled eq false`
> `-Filter` returning non-empty (passthrough) — is INFERRED, not confirmed: `graphResolvers.ts`
> registers the users collection (`:195-196`) but no explicit `eq`-filter application was found at
> the resolver layer, and the filed passthrough REQ
> (`REQ-STACKSIM-STARTSWITH-FILTER-PASSTHROUGH`) covers `startsWith`, not `eq`. **Action:** file a
> ces-tester REQ candidate `REQ-STACKSIM-ACCOUNTENABLED-EQ-FILTER-PASSTHROUGH` (write-up in
> ces-tester per the write boundary; do not patch the sibling). The before/after truth here does
> not depend on the mechanism — P6=met is asserted from the adjudicated fact, and the config
> disables `user-5` anyway so P6 reads met on BOTH the filter-honored and passthrough paths.

**`stacksim_seed`:**
```
stance: m365_azure
countOverrides: { caPolicies: 2, crossTenantAccessPolicy: 0 }   # crossTenant:0 per t1-eval-bare.json:9 (proven); singleton generator compliance.ts:92
steps:
  PATCH /v1.0/identity/conditionalAccess/policies/caPolicy-1  body { displayName: "Legacy-MFA" }    # T5-proven decoy (some CA hygiene, not the required two)
  PATCH /v1.0/identity/conditionalAccess/policies/caPolicy-2  body { displayName: "Pilot-CA" }       # T5-proven decoy
  PATCH /v1.0/users/user-5  body { accountEnabled: false }                                           # P6 met (explicit, path-independent)
```
P1/P5 absent (no CMMC-named policy) → the two remediable gaps. crossTenant zeroed → P9 unknown.
Default users (5) kept → P7 met and P1/P5 captures resolve.

**BEFORE-truth:** `AC.L2-3.1.11` **unknown** · `AC.L2-3.1.14` **unknown** · `SC.L2-3.13.7` **unknown** ·
`AC.L2-3.1.15` **unknown** · `MA.L2-3.7.5` **unknown** · `PS.L2-3.9.2` **met** · `IA.L2-3.5.5` **met** ·
`IA.L2-3.5.6` **met** · `AC.L1-3.1.20` **unknown** · `AC.L2-3.1.12` **unknown** · `IA.L2-3.5.4` **unknown**.

**Gaps Stamper remediates:** P1, P5 only. (P9 is deliberately a gap the plan CANNOT close.)

**AFTER-truth:** `AC.L2-3.1.11` **met** · `AC.L2-3.1.14` **unknown** · `SC.L2-3.13.7` **unknown** ·
`AC.L2-3.1.15` **unknown** · `MA.L2-3.7.5` **met** · `PS.L2-3.9.2` **met** · `IA.L2-3.5.5` **met** ·
`IA.L2-3.5.6` **met** · `AC.L1-3.1.20` **unknown** · `AC.L2-3.1.12` **unknown** · `IA.L2-3.5.4` **unknown**.
(P1/P5 flip; **P9 STAYS unknown** — architectural; P2/P3 stay unknown — transient/pinned;
P6/P7 met; N1/N2 unknown.)

**Why it is an honest test.** Multiple gaps go in; exactly two come out closed, and they are
precisely the two the plan is *architecturally* able to close. It makes the plan's scope legible:
identity CA yes; cross-tenant governance no — and it teaches the assessor to distinguish a
permanent scope boundary (P9) from a transient tool bug (P2/P3). An assessor watching the
before/after learns not to over-trust the tool.

---

## 3. Cross-config comparison

| | before P1 | before P2/P3 | before P5 | before P9 | flips (P1,P5) | stays unknown AFTER | after-arc lesson |
|---|---|---|---|---|---|---|---|
| **decoy-maze** | unknown | unknown (decoy) | unknown | met | yes | P2, P3 (pinned) | over-credit; remediation ≠ completeness |
| **fresh-gap** | unknown | **met** (real) | unknown | met | yes | *(only N1/N2)* | under-credit; clean full-green win |
| **scope-boundary** | unknown | unknown (decoy) | unknown | **unknown** | yes | P2, P3 (pinned) **+ P9 (architectural)** | automation reach; permanent vs transient boundary |

The three AFTER-maps are pairwise distinct — and no shipped config (T1–T5, demo-dib-small) has any
after-arc at all. That is the strongest distinctness argument.

**Own the coincidence (proud-critic low-3).** To the 11-probe gate, `decoy-maze` and
`scope-boundary` are exactly ONE probe apart: their BEFORE and AFTER maps differ only at **P9**
(`AC.L1-3.1.20` — met in decoy-maze, `unknown` in scope-boundary, because §2.3 re-anchors the
scope-boundary lesson on `crossTenantAccessPolicy:0`). The 5-vs-2 decoy count reads identically to
the gate (every decoy is `unknown` either way), so it changes no probe. This is deliberate, not an
accident: scope-boundary IS decoy-maze plus the one architectural gap the plan cannot close, and
that single-probe delta is precisely the lesson — a permanent scope boundary (P9) sitting next to a
transient pinned one (P2/P3). The two remain narratively distinct (over-credit + remediation ≠
completeness vs. automation-reach), but a demo narration should NOT run them back-to-back as if
they were far apart; pair each with its contrast (`fresh-gap` is the wide-apart one) instead.

---

## 4. Promotion mechanics & live-calibration flags (for the Integrate/live phase)

**How the after-truth wires (do NOT get this wrong).** The clause-10 machinery already exists:
`E2eConfigEntry.afterTruth` + `resolveAfterTruth` (`e2e-configs.ts:78,257`), and the run judges
clause 10 (`e2e-run.ts:893` postRemediation facts). The re-read is read **after Beat 3 (Stamper),
before Beat 5 (AO A-18)** — A-18 mutates `authorizationPolicy` (FD-3); P8 is out of vocab, but keep
the ordering so the contract is unambiguous. **Trap:** `resolveGroundTruth` for an
`source:'eval-config'` after-truth returns that file's `expected_discovery` — i.e. the BEFORE map.
Pointing `afterTruth` at the same JSON would silently judge clause 10 against the before-truth. Per
the insertion-point comment (`e2e-configs.ts`), each config's `afterTruth` MUST ship as a
`{ source: 'calibrated', provenance, postures: {…}, establishedAt }` inline map. The per-probe
AFTER tables above are the CONTRACT that calibration must reproduce (or the config is re-examined,
not the number quietly changed).

**AMENDMENT (GP-DEMO-3, proud-critic fix — provenance discipline).** The original shape
`{ source:'calibrated', postures, calibratedAt }` could not, in the DATA, distinguish a
live-measured map from a hand-authored one — a reader diffing dates could not tell, and a
field literally named `calibratedAt` mislabelled an authored contract as calibrated. Corrected:
- The date field is `establishedAt` (not `calibratedAt`) — it never claims "calibrated".
- A new `provenance: 'live-adjudicated' | 'authored-contract'` field discloses, machine-readably,
  how the map was established (`CalibratedDiscoveryGroundTruth.provenance`).
- These three configs ship their AFTER maps as **`provenance: 'authored-contract'`** — they are
  this §2 table, derived from `m7-run5`, NOT yet reproduced on these configs' own `runScenario`
  seed path (flag #4 below). The run leg reads `afterTruthProvenance` and reports clause 10
  **`calibrating`** for an authored contract — a normal `demo:e2e` run CANNOT stake a clean
  clause-10 pass on it (no fabricated live pass); only the serial `--calibrate` live phase accepts
  the recorded re-read, which must then reproduce these values and re-stamp the map
  `'live-adjudicated'`. A contaminated (ledger-writing) or aborted re-read FAILS regardless of
  provenance.

**Live-calibration flags (assume until a live run proves otherwise).** Every flag below is an OPEN
item the serial `--calibrate` phase must close. None can produce a fabricated pass in the meantime:
the AFTER maps are `provenance:'authored-contract'`, so clause 10 reports `calibrating` (not `pass`)
until that phase reproduces them — flags #2/#3/#5 are things the phase confirms, not things a normal
run silently trusts. Flag #3's clause-5 pin, if it fires, is added THEN (never speculatively now —
`e2e-run.ts` pins only demonstrated, sibling-owned causes; an unobserved pin would itself be a
fabricated exemption).
1. **clause-5 known-fail set is per-config.** `GUI_LEG_KNOWN_FALSE_FAILS` was calibrated on
   demo-dib-small; `M2-ENTRY-FINDINGS.md` proved it is drive-mode-dependent — assume it is
   posture-dependent. Recalibrate per config (`--calibrate`).
2. **`caPolicies: 2`** (fresh-gap, scope-boundary) is a NEW count value — unattested by any shipped
   config (T1 uses 0, T2 default 3, T3 uses 4, T4 uses 5). The generator (`caPolicies.ts:7`
   `range(count)`) serves it trivially, but confirm the served list has exactly 2 policies live.
3. **scope-boundary `crossTenantAccessPolicy: 0`** may make the plan's `AC.L1-3.1.20` VERIFY task
   fail-loud (a new per-config clause-5 pin). It does NOT change the discovery after-truth
   (P9=unknown regardless), but the pin must be added if it fires.
4. **P1/P5 completion is proven only on demo-dib-small's materialization path**
   (`build-demo-scenario.mjs`). These configs use the OTHER path — `stacksim_seed` via
   `runScenario` (`e2e-run.ts:980`) — which has never run the plan (T1–T5 are `fullChain:false`).
   P1's create interpolates `{cuiGroupId}=group-1` + `{breakGlassUserId}=user-2`; P5 interpolates
   `{breakGlassUserId}`. Both ids EXIST in the default eval seed (users:5 → user-2; groups:3 →
   group-1), and the sim is expected to accept a `New-Mg…` body without validating referenced
   existence — CONFIRM live.
5. **UPN-based lookups won't resolve.** The plan-variable seed names `ray.dominguez@…` etc.
   (`stamper-plan-variables.ts:181-183`) against a 5-user eval seed whose users are
   `sim.userN@simtenant.onmicrosoft.us`. This affects only non-probe / already-pinned tasks; P1/P5
   use ID variables, not UPN lookups. Note it so the live phase isn't surprised.
6. **Inactive-user sweep footnote.** The plan's `registry:1769` sweep may disable seeded users at
   Beat 3. P6/P7 read presence, not enabled-state, so the 11-key after-truth is invariant.

**Scope for this phase:** spec only. No `E2E_CONFIGS` entry, no `scenarios/eval/*.json`, no commit.
Write boundary: ces-tester only. Promotion (registry entry + eval JSON + `fullChain:true` +
live-calibrated `afterTruth`) is the next serial phase.

---

## 5. AMENDMENT (GP-DEMO-3 serial live-validation, 2026-08-30) — the plan flips FOUR probes, not two

**What the live phase measured.** The serial `--calibrate` live-validation of these three
configs (branch `gp-demo-3`) recorded, for the FIRST time, a post-remediation Muster re-read
on each config's OWN `runScenario` seed path (clause 10 — a read m7-run5 never took, because
clause 10 postdates it). The re-read of **`eval-fresh-gap`** (run `gpd3-freshgap-cal`, read-only,
ledger create+mutate delta 0) diverged from this document's §2.2 authored after-truth on exactly
two probes: **N1 `AC.L2-3.1.12`** and **N2 `IA.L2-3.5.4`** read **met**, not `unknown`.

**Why this is a CONTRACT CORRECTION, not a bug (mechanism, airtight).** The ONE plan carries
producer tasks `AC.L2-3.1.12.named-location` and `IA.L2-3.5.4.auth-strength`. Both **COMPLETE**
(neither is in `gpd3-freshgap-cal/stamper-failure-taxonomy.json` `failureIds`) and each **creates
a real object** — a `namedLocations` object and an `authenticationStrengthPolicies` object,
recorded as ledger `create` entries in `gpd3-freshgap-cal/ledger-snapshot.json`. DISCOVERY-1's N1
and N2 probes run the SAME registry entry ids (`ran_entry_ids: ["AC.L2-3.1.12.named-location"]`,
`["IA.L2-3.5.4.auth-strength"]`) — the probe's `get_command` and the plan's `set_command` are a
**paired get/set on one entry**, so the get necessarily matches what the set created. Post-read
`confidence: high` + a real `raw_capture_ref`. This is the same class of fact as the P5
report-only footnote (§1): the flip is real **for this presence-based layer**; depth is EO's.

**So §1's "flips exactly TWO probes (P1, P5)" is superseded: the plan flips FOUR — P1, P5, N1, N2.**
The §1 claim "N1/N2 — always unknown (unmatchable filters)" was a **BEFORE-read** fact
(seed-generated named locations / auth-strength objects genuinely do NOT match — demo-dib-small's
seed namedLocation read N1 `unknown`, confirmed) that was **extrapolated to an after-read that had
never been measured**. The extrapolation was wrong: a *plan-created* object matches where a
*seed-created* one does not. N1/N2 remain `unknown` for (a) every BEFORE-truth (at seed), and
(b) every eval-only config (T1–T5, `fullChain:false`) where the plan never runs — so
`t*.json` `expected_discovery` and the three `eval-*.json` `expected_discovery` (all before-maps)
are UNCHANGED and correct.

**Consequence for the three after-truths (all run the same plan, so all four flip):**
- **`eval-fresh-gap`** — CORRECTED + re-stamped `live-adjudicated` from `gpd3-freshgap-cal`.
  It now ends **fully green (all 11 gated probes met)**, not "green except N1/N2".
- **`eval-decoy-maze`** and **`eval-scope-boundary`** — expected to show the same N1/N2 flip, but
  each is corrected from **its own** calibrate run's recorded re-read (never pre-edited from
  fresh-gap's evidence — every `live-adjudicated` posture must trace to that config's own read).
  Their P2/P3 (pinned) and P9 (scope-boundary, architectural) unknowns are unaffected.

**Narrative implication flagged for the founder (NOT silently absorbed).** §2.2's honesty lesson
"even a fully-remediated tenant leaves N1/N2 `unknown`, because those filters are permanently
unmatchable — the layer never manufactures credit from a full pass" is **falsified by live
evidence**: with the full chain, N1/N2 DO flip to met (legitimately — the plan builds the
objects). fresh-gap is therefore a **clean full-green** win, not a "green-except-two" negative
control. The negative-control framing survives only for the eval-only (`fullChain:false`) configs.
This changes the demo narration for §2.2 and the §3 comparison row; it is a design/story call for
the founder, surfaced here and in the run's final report — the measured after-truth is corrected
regardless (SPEC §4: re-examined and disclosed, never quietly changed).
