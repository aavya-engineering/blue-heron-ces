# Stamper: Evidence Storage to Tenant Blob

## Context

The tenant `vfsgov-xtra` has an `evidence_storage` block in its config. This enables Stamper to send execution evidence directly to Azure Blob Storage in addition to saving locally under the unified pipeline root.

**Unified local storage root (Phase C–G):**
- Tenant plan-data: `{CES_PIPELINE_ROOT}/Stamper/plan-data/{tenantSlug}/`
- Local evidence: `{CES_PIPELINE_ROOT}/Stamper/storage/evidence/`
- Default: `CES_PIPELINE_ROOT = C:\CES_Pipeline`. Override via `CES_PIPELINE_ROOT` env var.
- See `docs/storage/ENV_OVERRIDES.md` for the full variable reference.

The tenant config file is now located at `{CES_PIPELINE_ROOT}/Stamper/plan-data/vfsgov-xtra/vfsgov-xtra.json` (previously `plan-data/vfsgov-xtra/vfsgov-xtra.json` relative to the stamper workspace).

## Storage Details

| Field | Value |
|-------|-------|
| Account | `vfsgoevops01` |
| Container | `incident-evidence` |
| Endpoint | `https://vfsgoevops01.blob.core.usgovcloudapi.net/` |
| Auth | SharedKey (account_key in tenant config) |
| Region | usgovvirginia (GCC High) |
| Encryption | CMK via Key Vault (`eo-storage-cmk`) |
| Network | Firewall default-deny; `AzureServices` bypass enabled |

## Current Blob Structure

Existing evidence is stored as:
```
stamper/{tenant_slug}/{control_family}/{control_id}.{label}_{timestamp}.txt
```

Example:
```
stamper/vfsgov/access_control/ac.l2-3.1.8.smart-lockout_2026-03-12T02-28-05-976Z.txt
stamper/vfsgov/audit_accountability/au.l2-3.3.2.signin-logs_2026-03-12T02-49-03-623Z.txt
stamper/vfsgov/incident_response/ir.l2-3.6.1.atp-enable_2026-03-11T03-09-05-047Z.txt
```

## What Stamper Needs To Do

### 1. Read `evidence_storage` from tenant config

When executing commands, check if `evidence_storage` exists in the loaded tenant config. If present, Stamper should dual-write evidence:
- **Local** — continue writing to `plan-data/{slug}/evidence/{family}/` as today
- **Blob** — additionally upload to the tenant's blob container

### 2. Upload format

Upload evidence to blob using the existing naming convention:
```
stamper/{slug}/{control_family}/{entry_id}_{ISO_timestamp}.txt
```

Or, preferably, adopt the EC JSON envelope format for richer metadata:
```
artifacts/{run_id}/{entry_id}.json
```

Where the JSON envelope contains:
```json
{
  "artifactId": "<entry_id>",
  "runId": "<session_run_id>",
  "entryId": "<registry_entry_id>",
  "controlIds": ["AC.L2-3.1.1"],
  "complianceVerdict": "SAT",
  "outcome": "automated_success",
  "outcomeRationale": "...",
  "verdictRationale": "...",
  "rawResponse": "<command output>",
  "metadata": {
    "controlIds": ["AC.L2-3.1.1"],
    "timestamp": "2026-04-27T01:00:00.000Z",
    "sha256Hash": "<sha256 of rawResponse>",
    "executorIdentity": "<UPN or service principal>",
    "commandExecuted": "<the get_command that was run>",
    "environment": "gcchigh"
  },
  "registryEntry": { /* copy of the registry entry used */ }
}
```

### 3. Authentication

Use SharedKey authentication against the blob endpoint. The shared library `@bhd-vfs/shared/blob` provides:
- `uploadEvidenceBlob(config, blobPath, content)` — uploads a string to blob
- `listBlobs(config, prefix)` — lists blobs under a prefix
- `downloadBlob(config, blobPath)` — downloads blob content

Import from `@bhd-vfs/shared/blob`. The `EvidenceStorageConfig` interface:
```typescript
interface EvidenceStorageConfig {
  account_name: string;
  account_key: string;
  container: string;
  blob_endpoint: string;
  base_path: string; // prepended to all blob paths (empty string = no prefix)
}
```

### 4. Network considerations

The storage account has firewall rules (default deny). Stamper must either:
- Run from an IP in the allow list (currently `172.9.76.108`)
- Run from an Azure service with "AzureServices" bypass (e.g., Azure Automation)
- Have its IP added to the allow list before execution

### 5. EO Evidence Explorer integration

EO's Evidence Explorer reads blobs from this container and displays them in the UI. It searches both:
- `artifacts/` prefix (EC/JSON format)
- `stamper/{slug}/` prefix (legacy text format)

Both formats are supported for viewing. The JSON envelope format is preferred because it enables the structured evidence viewer (verdict banner, rationale, metadata fields) rather than raw text display.

## Acceptance Criteria

- [ ] Stamper reads `evidence_storage` from tenant config when available
- [ ] After each command execution, evidence is uploaded to blob in addition to local save
- [ ] Upload uses SharedKey auth via `@bhd-vfs/shared/blob` utilities
- [ ] Blob path follows either legacy or EC format (EC preferred)
- [ ] Graceful degradation: if blob upload fails, log warning but don't halt execution
- [ ] If `evidence_storage` is absent from config, skip blob upload (local-only mode)
