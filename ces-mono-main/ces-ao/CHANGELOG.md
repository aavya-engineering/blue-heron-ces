# Changelog — ces-ao (AdminOps)

Format: [Keep a Changelog](https://keepachangelog.com/); [SemVer](https://semver.org/). Dates UTC.

## [Unreleased]

### Changed
- **CMMC dev-tenant exemption** (G-AO-CMMC-BOUND-1): AO's `dev` dry-run placeholder record
  (`plan-data/dev/dev.json`) is marked `cmmcMigrationExempt: true` — it is not a real assessment
  target and is excluded from the Phase-2 migration denominator.

### Security / posture — **Phase-2 strict flip LANDED**
- **`CMMC_STRICT_DEFAULT` flipped `false` → `true`** (Phase 2, fail-closed) — G-AO-CMMC-BOUND-1
  "complete the spokes". The flip's precondition (100% of active tenant registry records carry
  `cmmcLevel` or are `cmmcMigrationExempt`) is now MET: `npm run audit-cmmc-migration` reports
  **100.0%** (7 records: 6 exempt [dev + 5 sim], 1 migrated [vfsgov-xtra L2]), after ces-tenant
  landed sim-default-exempt (583a474) and the `~/.ces` data migrated. Effect: a command carrying
  `cmmcPractices` against an **unmigrated, non-exempt** tenant now **fails closed** before any
  context/session work, with enforcement evidence — instead of the prior Phase-1 fail-open warning.
- **`cmmcMigrationExempt` now honored by the enforcement path**, not just the audit denominator:
  `CmmcScopeGate.evaluate` (and `ParameterMapper`'s CUI-boundary check) treat an exempt record —
  the `dev` placeholder and ephemeral `kind:'sim'` tenants (ces-tenant default) — as a clean allow
  even with `cmmcLevel` absent. This keeps dev/sim commands running post-flip while real non-exempt
  unmigrated tenants fail closed (coverage not weakened). Per-call Phase-1 fail-open is still
  reachable via `--strict-cmmc=false` / `strictCmmc:false`.
- **FOUNDER-RATIFY:** the flip now consumes `vfsgov-xtra`'s CMMC boundary values (`cmmc_level` +
  `cui_boundary`) live from the registry. Those VALUES are the founder's to ratify — AO only
  gates on them, it does not set them.

## [0.2.0] — 2026-07-04

First tracked release; supersedes the frozen `0.1.0` scaffold. Establishes changelog + SemVer
discipline (G-ENG-5).

### Security
- **PowerShell command-injection guard** (G-ENG-1): AdminOps imports the shared ces-stamper
  PowerShellAdapter, whose `interpolateVariables` now sanitizes every substituted parameter value
  (rejects breakout metacharacters, doubles single quotes) — closing the live-tenant injection
  surface reached via `TemplateRegistry` command strings.
- Known open posture: the HTTP server itself has no authentication (tracked as G-ENG-4). dryRun
  default + the Tier-3 SoD gate are the current safeguards.

### Baseline capabilities
- 95 governed registry commands vs M365/Azure GCC High; three surfaces (CLI, HTTP GUI, MCP) from one
  headless engine; dryRun-by-default with a get-then-set write pattern.
- **Separation-of-duties approvals:** an approval is bound to a canonical-SHA-256 hash of its exact
  parameters, re-checked pre-live, single-use; approver must differ from requestor. Surfaced on all
  three channels (CLI `approve`, GUI approvals modal, MCP `ao_approvals`/`ao_approve`).
- ARM-channel network commands (F-13/F-14) + parameter `source` auto-fill from tenant config.
- Each execution emits SHA-256 StructuredEvidence (SAT/NOT_SAT).

### Changed
- Coverage measurable via `npm run test:coverage` (~88% lines); no threshold gate yet.
