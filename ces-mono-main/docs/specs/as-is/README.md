# AS-IS Baselines — Roll-Up Scorecard — 2026-07-04 (commit a0d6ae1)

The 5×12 engineering-maturity matrix for CES, scored against the ideal library
(`docs/specs/ideal/`) per SPEC-00's L0–L3 model. Each cell links to the evidence-cited
baseline beside it. Read-only audit: no product/config/test changes (suite green before and
after — see `measurements-2026-07-04.md`).

## The matrix (as-is level per module × dimension)

`W` = waived by design for that module (Planner is offline-first; see its baseline). Target = the
CES-profile target level (`docs/specs/ideal/ces-profile.md`).

| # | Dimension | Planner | Stamper | EO | AO | Shared/Root | **Target** |
|---|---|:---:|:---:|:---:|:---:|:---:|:---:|
| 01 | Concept & Requirements | L2 | L1 | L1 | L2 | L1 | **L3** |
| 02 | Architecture & Design | L2 | L2 | L1 | L2 | L2 | **L2** |
| 03 | API & Contracts | L1ᵂ | L1 | L1 | L2 | L1 | **L2** |
| 04 | Security | L1ᵂ | L1 | L1 | L1 | L2 | **L3** |
| 05 | Testing | L1 | L1 | L2 | L2 | L1 | **L3** |
| 06 | Packaging & Release | L1 | L1 | L1 | L1 | L1 | **L2** |
| 07 | CI/CD | L1 | L1 | L1 | L2 | L1 | **L3** |
| 08 | Configuration | L1 | L1 | L2 | L1 | L2 | **L3** |
| 09 | Observability | L1 | L1 | L1 | L1 | L1 | **L2** |
| 10 | Documentation | L2 | L2 | L1 | L1 | L1 | **L2** |
| 11 | Data & Persistence | L2 | L2 | L1 | L2 | L2 | **L3ᵐ** |
| 12 | Deployment & Ops | L1ᵂ | L1 | L1 | L1 | L1 | **L2** |

ᵐ SPEC-11 (Data) is CES **mandatory L3** — evidence integrity is the product.
Baselines: [planner](as-is-planner.md) · [stamper](as-is-stamper.md) · [eo](as-is-eo.md) · [ao](as-is-ao.md) · [shared+root](as-is-shared-root.md).

## What this says at a glance

**Strongest dimensions (at or near target):**
- **Architecture (02)** — four of five modules at L2 (target L2): numbered ADRs, adapter/stack-provider
  seams, feature layering. Only EO lags (L1) on the 4,100-line `EoServer.ts` monolith.
- **Data & Persistence (11)** — four modules at L2 with a single scope-enforced `CesRepository`,
  SHA-256 evidence hashing, tenant isolation. Held below the mandatory L3 by missing WORM
  enforcement, numbered migrations, and a retention job — not by architecture.
- **AO CI/CD (07 = L2)** and **EO/shared Configuration (08 = L2, the EoConfig Zod pattern)** are the
  local exemplars the rest should converge on.

**Weakest, most systemic (biggest gap × breadth):**
- **CI/CD (07)** — single `npm test` gate everywhere; no lint, typecheck, coverage, or `npm audit`
  gate. Target L3. The one root fix (add gates to `ci.yml`) lifts every module at once.
- **Testing (05)** — no module has coverage tooling installed or a threshold; ratios 0.3–1.9 files/kLOC.
  Target L3.
- **Security (04)** — all modules L1 (shared L2). Two sharp, repeated findings: **unescaped
  PowerShell/template interpolation into live GCC High execution (Stamper + AO)** and **auth
  off-by-default/absent (EO, AO server)**, plus the plaintext `--cert-password` flag and EO's 3
  production vulns. Target L3.
- **Observability (09)** — every module L1: `console.*` sprawl, `winston` declared-but-unused in both
  Stamper and EO, no request IDs, no ops audit trail. Target L2.
- **Packaging (06)** — every module frozen at `0.1.0`, no changelogs/release discipline. Target L2.

**Cross-cutting facts** (identical across the fleet, so best fixed once at the root): coverage
tooling absent; CI single-gate; versions frozen; the stamper↔EO schema contract is DRAFT/unratified;
three modules (shared, eo, ao) have no README.

## Method note

Scores follow SPEC-00: L0 absent, L1 ad hoc, L2 systematic, L3 machine-enforced. A score required
≥1 cited piece of current evidence (file:line or command output at commit a0d6ae1); an L3 claim
required naming the enforcing mechanism. The 2026-07-01 recon (`docs/context/SPEC_RECON.md`) was the
starting map only — two of its claims were corrected against live evidence (winston is a dead
dependency in Stamper, not "10+ files"; EO's high-severity vuln is `multer`, not `js-yaml`). The
diff of this matrix against the profile targets is G-SPEC-3 (`docs/specs/gaps/`).
