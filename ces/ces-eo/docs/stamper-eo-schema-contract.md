# Stamper-EO Schema Contract

**Version:** 1.0
**Date:** 2026-04-20
**Status:** RATIFIED v1.0 (2026-07-04, G-ENG-6) — supersedes the DRAFT/"pending confirmation" note.

## Purpose

This document defines the agreed schema for the directive metadata that Stamper evidence files
carry and EvidenceOps consumes. Changes require an explicit version bump here (no breaking change
without a major bump) — see Ratification & Enforcement below.

## Ratification & Enforcement (v1.0)

- **Ratified:** CES is a single-owner monorepo; the stale "pending Stamper team confirmation" note is
  resolved. The producer (ces-stamper structured-evidence emission, `src/types/schema.types.ts` +
  `src/utils/structuredEvidence.ts`) and the consumer (ces-eo `StamperEvidenceLoader.ts`) both
  operate against the fields below.
- **Current validation posture (honest):** the CONSUMER validates on read — `StamperEvidenceLoader`
  parses the optional `directiveMetadata` block defensively (coerces/defaults each field), so a
  missing or partial block degrades gracefully rather than crashing. The producer emits the fields
  as part of its evidence metadata.
- **Tracked hardening (not yet built — GAP-shared-03.R5/R7):** a SHARED runtime schema module that
  BOTH sides import (single source of truth) plus a CI contract-diff gate that fails on a
  breaking change without a version bump. Until then, this document is the authority and the
  consumer's defensive parse is the runtime guard.

## Evidence File Location

- Azure Blob Storage path: `{tenantId}/evidence/{controlId}/{timestamp}.json`
- Local path (Stamper plan-data): `stamper/plan-data/{slug}/evidence/**/*.json`
- Access method: EcClient for blob storage, filesystem for local plan-data

## Directive Metadata Schema

Evidence files MAY contain a top-level `directiveMetadata` field with the following structure:

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `control_id` | `string` | CMMC control ID (e.g., "AC.L2-3.1.1") |
| `directive` | `string` | One of: `implement`, `validate`, `manual`, `document-absence`, `document-prohibition`, `skip` |
| `readiness` | `string` | One of: `met`, `not-met`, `unknown` |
| `platform_inherited` | `boolean` | Whether control is inherited from cloud platform (Microsoft) |
| `enforcement_verified` | `boolean` | Whether Stamper's verification logic confirmed enforcement is active |
| `narrative_stub` | `string` | Short text describing what the control does in context |
| `reasoning_trace` | `string` | Planner's classification reasoning (read-only for EO) |
| `evidence_artifacts` | `string[]` | Artifact IDs or paths associated with this directive |

### Optional Narrative Template Fields

These fields are populated by Stamper from artifact metadata and used by EO for narrative generation.

| Field | Type | Required For | Description |
|-------|------|-------------|-------------|
| `baseline_date` | `string` (ISO 8601) | `document-absence` | Date of baseline system inventory establishing absence |
| `verification_date` | `string` (ISO 8601) | `document-prohibition` | Date enforcement was last verified active |
| `policy_reference` | `string` | `document-prohibition` | Policy document reference for prohibition |
| `enforcement_mechanism` | `string` | `document-prohibition` | Technical mechanism enforcing prohibition |
| `configuration_reference` | `string` | `document-prohibition` | Configuration setting reference |
| `monitoring_mechanism` | `string` | `document-prohibition` | Continuous monitoring mechanism |
| `service_line` | `string` | `manual+platform_inherited` | Cloud service name (e.g., "Microsoft 365 GCC High") |
| `crm_reference` | `string` | `manual+platform_inherited` | Microsoft Customer Responsibility Matrix document ID |
| `fedramp_package_id` | `string` | `manual+platform_inherited` | FedRAMP authorization package ID |

## Backward Compatibility

- Evidence files WITHOUT `directiveMetadata` are valid
- EO logs a warning and falls back to existing assessment logic (signal-based / manifest-based / mission plan)
- No error is thrown for missing `directiveMetadata`

## Validation Rules

- Invalid `directive` values cause an error with descriptive message listing valid values
- `enforcement_verified` is set by Stamper's verification logic, not by EO
- All date fields must be ISO 8601 format when present

## Sample Evidence File

```json
{
  "metadata": {
    "controlIds": ["AC.L2-3.1.1"],
    "sha256Hash": "abc123...",
    "timestamp": "2026-04-15T10:30:00Z"
  },
  "complianceVerdict": "SAT",
  "registryEntry": {
    "entry_id": "ac-3.1.1-conditional-access",
    "label": "Conditional Access Policy Check"
  },
  "directiveMetadata": {
    "control_id": "AC.L2-3.1.1",
    "directive": "implement",
    "readiness": "met",
    "platform_inherited": false,
    "enforcement_verified": true,
    "narrative_stub": "Access control implemented via Conditional Access policies",
    "reasoning_trace": "Control classified as 'implement' per AC family automation capability",
    "evidence_artifacts": ["artifact-001", "artifact-002"],
    "verification_date": "2026-04-15T10:30:00Z",
    "enforcement_mechanism": "Azure AD Conditional Access"
  }
}
```
