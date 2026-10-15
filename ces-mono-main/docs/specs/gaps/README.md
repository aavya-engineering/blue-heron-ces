# GAP REPORT — Ideal vs As-Is — 2026-07-04 (commit a0d6ae1)

The engineering punch list: the ideal library (`docs/specs/ideal/`, G-SPEC-1) with the CES-profile
target levels, diffed against the evidence-cited as-is baselines (`docs/specs/as-is/`, G-SPEC-2).
Reports and plans only — **fixes nothing**; the remediation happens in the candidate goals below.

Per-module detail: [planner](gaps-planner.md) · [stamper](gaps-stamper.md) · [eo](gaps-eo.md) ·
[ao](gaps-ao.md) · [shared+root](gaps-shared-root.md). Candidate goals: [candidate-goals.md](candidate-goals.md).
Importable finding table: [punchlist-sync.md](punchlist-sync.md).

## The gap matrix (as-is → target; ● = meets, gap size in levels)

Cell shows `as-is/target`. **●** = at or above target. **▲n** = n levels below target. `W` = waived
(Planner offline). SPEC-11 target is CES-mandatory L3.

| # | Dimension | Planner | Stamper | EO | AO | Shared/Root |
|---|---|:---:|:---:|:---:|:---:|:---:|
| 01 | Concept | L2/L3 ▲1 | L1/L3 ▲2 | L1/L3 ▲2 | L2/L3 ▲1 | L1/L3 ▲2 |
| 02 | Architecture | L2/L2 ● | L2/L2 ● | L1/L2 ▲1 | L2/L2 ● | L2/L2 ● |
| 03 | API & Contracts | L1/L2 W | L1/L2 ▲1 | L1/L2 ▲1 | L2/L2 ● | L1/L2 ▲1 |
| 04 | **Security** | L1/L3 W* | L1/L3 ▲2 | L1/L3 ▲2 | L1/L3 ▲2 | L2/L3 ▲1 |
| 05 | **Testing** | L1/L3 ▲2 | L1/L3 ▲2 | L2/L3 ▲1 | L2/L3 ▲1 | L1/L3 ▲2 |
| 06 | Packaging | L1/L2 ▲1 | L1/L2 ▲1 | L1/L2 ▲1 | L1/L2 ▲1 | L1/L2 ▲1 |
| 07 | **CI/CD** | L1/L3 ▲2 | L1/L3 ▲2 | L1/L3 ▲2 | L2/L3 ▲1 | L1/L3 ▲2 |
| 08 | Configuration | L1/L3 ▲2 | L1/L3 ▲2 | L2/L3 ▲1 | L1/L3 ▲2 | L2/L3 ▲1 |
| 09 | Observability | L1/L2 ▲1 | L1/L2 ▲1 | L1/L2 ▲1 | L1/L2 ▲1 | L1/L2 ▲1 |
| 10 | Documentation | L2/L2 ● | L2/L2 ● | L1/L2 ▲1 | L1/L2 ▲1 | L1/L2 ▲1 |
| 11 | **Data (L3 mand.)** | L2/L3 ▲1 | L2/L3 ▲1 | L1/L3 ▲2 | L2/L3 ▲1 | L2/L3 ▲1 |
| 12 | Deployment | L1/L2 W | L1/L2 ▲1 | L1/L2 ▲1 | L1/L2 ▲1 | L1/L2 ▲1 |

\* Planner SPEC-04: server auth/session/transport are offline-waived, but two *non-waived* integrity
gaps remain (permissive AJV, legacy cross-customer read leak) — see gaps-planner.md.

**Reads at a glance:** Architecture (02) and Documentation (10) are the only dimensions with any
cells already at target. Security (04), Testing (05), and CI/CD (07) are ▲2 across almost the whole
fleet. Every dimension except 02/10 is below target somewhere — but the gaps concentrate: five
root-level fixes close most of the ▲2 breadth.

## Finding volume

| Module | P0 | P1 | P2 | P3 | distinct findings |
|---|:--:|:--:|:--:|:--:|:--:|
| ces-planner | 0 | 2 | 14 | 1 | 17 |
| ces-stamper | 1 | 2 | 15 | 6 | 24 |
| ces-eo | 1 | ~4 | ~24 | ~12 | 41 |
| ces-ao | 1 | 1 | 8 | 2 | 12 |
| shared/root | 0 | 2 | 20 | 7 | 29 |
| **fleet** | **2 distinct** | **~11** | **~81** | **~28** | **~123** |

The two P0s share ONE root cause (below), so there is effectively **one P0 code fix** plus one
P0 dependency bump.

## Top findings (the ones that change what you do next)

1. **[P0] Live-tenant command injection — ONE fix clears two modules.** Unescaped
   `String(value)` interpolation into `spawn('powershell.exe', … script)` in the **shared**
   `ces-stamper/src/adapters/PowerShellAdapter.ts` (`interpolateVariables` ~:1597-1629). Both Stamper
   *and* AO (which imports the same adapter) run plan-/operator-supplied values through it with no
   escaping, quoting, or allowlist, and no injection test exists. A crafted parameter breaks out of
   the command and runs arbitrary PowerShell against the live GCC High tenant.
   `GAP-stamper-04.R8-1` = `GAP-ao-04.R8-01`. **Fix once in the shared adapter.**
2. **[P0] EO ships a HIGH-severity vuln.** `multer 1.0.0–2.1.1` (DoS) in ces-eo, plus `js-yaml` and
   `uuid` (moderate). All have fixes; nothing flags them because no CI runs `npm audit`.
   `GAP-eo-04.R11-01/02`. **`npm audit fix` + add the audit gate.**
3. **[P1] Three unauthenticated HTTP servers.** AO server has no auth (`AoServer.ts:83-106`); EO auth
   is off-by-default, exposing all 104 `/api/*` routes when `CES_EO_AUTH_TOKEN` is unset; Stamper's
   12 GUI routers have no authN. Each compounds the injection surface (unauthenticated → injectable).
4. **[P1] Plaintext `--cert-password` flag** persists at `ces-stamper/src/cli/index.ts:371` — the
   profile's named SPEC-04 anti-target (an automatic R3 fail).
5. **[P1] Planner cross-customer read leak.** Legacy no-tuple Dexie reads can return another
   customer's artifacts (`GAP-planner-11.R6-01`) — a CUI-isolation risk on the offline path.
6. **[leverage P2] CI is a single test gate.** No lint, typecheck, coverage, or `npm audit` gate in
   `.github/workflows/ci.yml`. Adding them lifts SPEC-05 and SPEC-07 across every module at once.
7. **[leverage P2] Coverage is unmeasurable fleet-wide** — no module has coverage tooling installed
   or a threshold. Can't ratchet what you can't measure.
8. **[P1] The load-bearing seam is DRAFT.** The stamper↔EO directive-metadata schema contract
   (`ces-eo/docs/stamper-eo-schema-contract.md`) — the seam CUI evidence flows across — is
   unratified and validated on the consumer side only. Drift ships undetected.
9. **[P2] EO is a 4,100-line, 104-route monolith** (`EoServer.ts`) — the one architecture cell below
   target; the module carries the most findings (41) largely because of it.
10. **[P2] Fleet hygiene:** every module frozen at `0.1.0` with no changelog; `winston` is a declared
    but unused dependency in **both** Stamper and EO (logging is `console.*`); three modules
    (ces-shared, ces-eo, ces-ao) have no README.

## Where CES is already strong (so this isn't all red)

- **The SoD approval design (AO)** — canonical-SHA-256 `paramsHash`-bound two-person approvals with
  pre-live re-check, single-use, at CLI/GUI/MCP parity — **meets/exceeds** the SPEC-04 L3 bar and is
  the cross-module exemplar for privileged-action governance.
- **Evidence integrity** — SHA-256 hashing + who/what/when audit envelopes (Stamper, AO) and the
  scope-enforced `CesRepository` (throws on empty scope, tenant-isolated) give Data a real L2 base.
- **EoConfig** (Zod-validated-at-startup, throws on invalid) is the config exemplar the other modules
  should converge on; the **golden SSP reference test** is the testing exemplar.
- **Architecture** — four of five modules at L2 with numbered ADRs and clean adapter/stack seams.

## Dedup ledger (not re-raised — cross-referenced)

Evidence signing → G8(a)/phase-3 G11; blob-WORM → G8(b)/G10; EO auth → G8(c); hash-order → G8(d)
(fixed); RSA-PSS/WORM deferrals → G8 risk-acceptances (pending Azure). Multi-stack + persistence
hardening items → cesPunchlist. These carry a `DUP→` marker in the per-module files.

## Method + honesty notes

Mechanical diff (target − as-is per cell) then finding itemization at the violated-requirement level,
severity orthogonal to effort. Punchlist dedup used a dependency-free XLSX extraction
(`punchlist-import.csv`, 121 rows — mostly product-roadmap tasks, few 1:1 engineering matches). The
finding counts for EO are approximate in the fleet tally (grep of the prose, not a structured field);
the per-module files are authoritative. Two recon errors were corrected during G-SPEC-2 (winston
dead-dep in Stamper; EO high-vuln = multer). Zero product code changed in the whole G-SPEC series.
