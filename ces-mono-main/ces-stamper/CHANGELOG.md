# Changelog — ces-stamper

Format: [Keep a Changelog](https://keepachangelog.com/); [SemVer](https://semver.org/). Dates UTC.

## [0.2.0] — 2026-07-04

First tracked release; supersedes the frozen `0.1.0` scaffold. Establishes changelog + SemVer
discipline (G-ENG-5).

### Security
- **Removed the plaintext `--cert-password` CLI flag** (G-ENG-2). It leaked the password into
  shell history/process listings and was interpolated into a PowerShell string. Bootstrap now
  prompts for a `SecureString` interactively (Read-Host).
- **PowerShell command-injection guard** (G-ENG-1): `interpolateVariables` now sanitizes every
  substituted value — rejects shell-breakout metacharacters and doubles single quotes — closing the
  live-tenant injection surface shared with AdminOps.

### Baseline capabilities
- Executes Executable Mission Plans against M365/Azure GCC High (prechecks/postchecks, evidence,
  rollback); CLI `stamper` + Express GUI. Cert app-only auth. dryRun enforced across adapters.
- ARM channel (`Connect-AzAccount` cert SP + `Set-AzContext`) added for the Azure network commands.
- Evidence records carry SHA-256 + who/what/when audit metadata + Zod retention fields.

### Changed
- Coverage measurable via `npm run test:coverage` (jest --coverage); no threshold gate yet.
