# Evaluation-Mode Tenant Configurations (GP-DEMO-2 M2 design, v2 — oracle-grounded)

The **done-when instrument**: 5 seedable tenant configurations with known ground truth.
The gate passes when Muster's evaluation (the DISCOVERY-1 executor, driven via the
`mu discovery --sim` CLI) reads **all 5 correctly** — each probe's `derived_posture`
matches the seeded truth. v2 replaces the v1 draft after the DISCOVERY-1 wiring spec
(2026-07-28) established the layer's actual contract.

## The discovery contract (what "reads correctly" means here)
DISCOVERY-1 is **presence-based**: it walks the Stamper registry `get_command`s
read-only and derives `met` (command returned matching, non-empty state) or `unknown`
(nothing matching / not readable at this tier). It does **not** parse state values —
so it cannot distinguish *enforced* from *report-only/disabled* (that is EO's
depth), and it never emits `not_met` from silence. Ground truth below is therefore in
the layer's own vocabulary: **met | unknown**. Two REAL product findings from the
spec are FILED, not masked (see `docs/requirements/`):
- `REQ-MUSTER-DISCOVERY-STATE-BLINDNESS.md` — presence ≠ enforcement (the v1 T5
  "report-only trap" is beyond this layer; the talk-track E3 beat pivots accordingly).
- `REQ-STACKSIM-STARTSWITH-FILTER-PASSTHROUGH.md` — `startsWith` cmdlet filters pass
  through unfiltered in the sim, weakening one probe class.

## Probe set (from the wiring-spec oracle; exact seeds are uri-kind PATCHes + countOverrides)
P1 `AC.L2-3.1.11` session-timeout CA (displayName `CMMC-SessionTimeout`) ·
P2 `AC.L2-3.1.14`/`SC.L2-3.13.7` block-untrusted CA · P3 `AC.L2-3.1.15` admin-MFA CA ·
P4 `AC.L2-3.1.18` mobile-device CA · P5 `MA.L2-3.7.5` remote-maintenance CA ·
P6 `PS.L2-3.9.2` disabled-account present · P7 `IA.L2-3.5.5/6` users exist ·
P8 `AC.L2-3.1.20` authorization-policy singleton (positive baseline) ·
P9 `AC.L1-3.1.20` cross-tenant policy · N1 `AC.L2-3.1.12` named-location (unmatchable
→ always unknown) · N2 `IA.L2-3.5.4` phishing-strength (unmatchable → always unknown).

## The 5 configurations

| id | Name | Posture story | Ground truth (probes) | What a correct read proves |
|---|---|---|---|---|
| T1 | `eval-bare` | Brand-new tenant, nothing configured | countOverrides zero CA/users/crossTenant → P1-P7, P9 **unknown**; P8 met; N1/N2 unknown | The honest zero: silence reads as unknown, no false credit anywhere |
| T2 | `eval-identity-first` | Identity CA work done, nothing else | P1-P3 **met** (CMMC-named CA policies); P4, P5 unknown; P6 unknown (all users enabled); P7, P8, P9 met | Mixed read, no halo: credited identity does not bleed into uncredited probes |
| T3 | `eval-half-configured` | **THE demo tenant** — 18 months in, undocumented | P1, P3, P5 **met**; P2, P4 unknown; P6 met (user-5 disabled); P7-P9 met; N1/N2 unknown | The realistic interleave: met/unknown alternate across categories, matching truth exactly |
| T4 | `eval-mostly-hardened` | Diligent shop, few real gaps | P1-P5 all met (5 CMMC-named CA policies via countOverride), P6-P9 met; N1/N2 unknown | Near-perfect reads near-perfect — and the negative controls STILL read unknown |
| T5 | `eval-decoys` | **The trap, layer-honest** — things exist, but not the *required* things | 3 CA policies present but decoy-named (`Legacy-MFA`, `Pilot-CA`, `Block-Old-TLS`) → P1-P5 **unknown**; P6-P9 met | The acid test within contract: presence of the WRONG objects earns no credit — Muster reads what's required, not what's merely there |

## Gate semantics (M5)
- One command runs T1→T5: seed (scenario materialize) → serve slug → `mu discovery
  --sim --out` → Ajv-validate result → diff `derived_posture` per probe vs ground
  truth → per-config PASS iff every probe matches. **Gate = 5/5 PASS.**
- Serial; tenant reset between configs; **read-only verified** per run (sim ledger
  mutation count == 0 during the discovery walk).
- Evidence (per-config probe table: expected vs read) written to `runs/` and the
  iteration ledger.

## Narrative note
T3 remains the `TALK-TRACK-EVAL.md` tenant. The E3 "trap" beat pivots from
report-only-CA (state — EO's layer) to the T5 decoy story (*"you have policies — but
not the ones an assessor needs; Muster credits requirements, not artifacts"*), and
the state-depth trap returns when EO joins the evaluation demo or DISCOVERY-2 adds
state parsing. Founder HIL on the narrative still pending.
