# Changelog

## [0.3.0] - 2026-07-04

Aligns the package version with the changelog (was frozen at 0.1.0 in package.json). Captures the
determination/assurance work and the G-ENG remediation slices.

### Added
- **DeterminationLedger** — unified per-objective status spine composing disposition > tenant-suite
  evidence > non-digital readiness > digital snapshot; objective-level POA&M lifecycle with
  auto-close; persona-scoped projections; the assessor determination viewer (`/assessor`).
- Objective-level SSP mapping to the real 320 NIST 800-171A determination statements.

### Security / fixed
- `npm audit fix` cleared the **multer HIGH** DoS and the js-yaml moderate (G-ENG-2). The remaining
  uuid moderate is not applicable (uuid.v4 only). A CI `npm audit --audit-level=high` gate now
  guards against recurrence (G-ENG-3).
- Fixed a latent bug: the Google Workspace 2SV evaluator read a phantom `signal.data` field
  (production populates `rawData`), so 2SV-enforced was never detected live (G-ENG-3).

### Changed
- Coverage measurable via `npm run test:coverage`; no threshold gate yet.

## [0.2.0] - 2026-03-15

### Breaking Changes

- **New required dependencies:** `@azure/identity`, `@microsoft/microsoft-graph-client`, `@microsoft/microsoft-graph-types`, `handlebars`. Run `npm install` after updating.
- **Tenant config now mandatory for live mode.** Use `POST /api/tenant-config` to set the active tenant or set `TENANT_SLUG` in `.env`. Tenant configs are read from `~/.stamper/tenants/{slug}.json`.
- **Confidence field removed from ControlAssessment interface.** Custom consumers that reference `confidence` must update. Use `status` field ('met' | 'not_met' | 'partial' | 'not_assessed') instead.
- **ControlAssessment interface updated** with new required fields: `signals`, `evidenceArtifactIds`, `automationSource`, `lastFetchedAt`.

### Added

- **Live API assessment mode** (`GET /api/assess?mode=live`): Queries Microsoft Graph APIs directly for real-time compliance signal data. Covers 20 highest-weight CMMC L2 controls.
- **Graph API integration** for GCC High (`graph.microsoft.us`): Certificate-based authentication via `@azure/identity` ClientCertificateCredential.
- **Signal-to-control mapping engine**: Maps 7 Graph API endpoints + 2 PowerShell fallback sources to 20 CMMC L2 controls with evaluator functions.
- **Automatic evidence capture**: When a control passes (status=met), automatically downloads and stores the configuration data as evidence artifacts to Azure Blob Storage.
- **Snippet template engine**: Handlebars-based narrative generation for SSP control implementations.
- **PowerShell module pre-flight check**: Validates required PowerShell modules at startup (warns if missing).
- **Permission validator**: Checks Graph API permissions on startup and logs warnings for missing permissions.
- **Migration helper**: Validates tenant config and cert file existence.
- **Assessment mode toggle in GUI**: Switch between "Legacy PowerShell" and "Live API" modes.
- **13 Graph API permissions documented** in `docs/setup/GRAPH_PERMISSIONS.md`.

### Changed

- **DiscoveryEngine** now supports dual-mode operation (live vs legacy). Legacy PowerShell flow preserved as fallback.
- **SSP generator** uses SnippetTemplateEngine for control narratives when available.
- **POA&M generator** includes `automationAvailable` flag for controls with Stamper remediation paths.
- **ControlAssessor** tracks `liveAssessmentCount` in AssessmentSnapshot metadata.
- **EoConfig** validates `activeTenantSlug` and adds `graphScopes` field.

### Deprecated

- **Legacy assessment mode** (`?mode=legacy`): Will be removed in v2.0. Use `?mode=live` for automated assessments.

### Migration Guide

1. Install new dependencies: `npm install`
2. Create tenant config at `~/.stamper/tenants/{slug}.json` (see `docs/setup/GRAPH_PERMISSIONS.md`)
3. Register Azure AD application with certificate auth in GCC High tenant
4. Grant 13 required Graph API permissions (see setup guide)
5. Install PowerShell modules for Exchange/Purview: `ExchangeOnlineManagement`, `Microsoft.Graph`
6. Set `TENANT_SLUG=your-slug` in `.env` or use `POST /api/tenant-config`
7. Access live assessment at `GET /api/assess?mode=live&tenant=your-slug`

### PowerShell Requirements

PowerShell modules still required for Exchange Online and Purview compliance features (no Graph API equivalents):

- `ExchangeOnlineManagement` - transport rules, mailbox audit settings
- `Microsoft.Graph` - backup Graph queries via PowerShell
- `Az.Accounts` - Azure authentication (optional)

Pre-flight check runs at EO server startup and warns if modules are missing.
