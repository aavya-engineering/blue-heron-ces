# Evidence Blob Path Convention

## Storage Target

| Field | Value |
|-------|-------|
| Account | `vfsgoevops01` |
| Container | `incident-evidence` |
| Endpoint | `https://vfsgoevops01.blob.core.usgovcloudapi.net/` |
| Auth | SharedKey (account_key in tenant config) |

## Required `base_path`

Every tenant config (`plan-data/<slug>/<slug>.json`) must set `base_path` in the `evidence_storage` block:

```json
"evidence_storage": {
  "account_name": "vfsgoevops01",
  "account_key": "<key>",
  "container": "incident-evidence",
  "blob_endpoint": "https://vfsgoevops01.blob.core.usgovcloudapi.net/",
  "base_path": "stamper/<slug>"
}
```

For tenant `vfsgov-xtra`, `base_path` is `stamper/vfsgov-xtra`.

**Do not leave `base_path` as `""`**. An empty base_path causes Stamper's `stampedBlobPath()` to produce a leading `/` in the blob name, which breaks Azure SharedKey signature verification (403).

## Resulting Blob Hierarchy

```
incident-evidence/                        ← container
  stamper/                                ← tool prefix
    vfsgov-xtra/                          ← tenant slug
      access_control/
        ac.l2-3.1.8.smart-lockout_2026-05-03T01-00-00-000Z.json
      audit_accountability/
        au.l2-3.3.2.signin-logs_2026-05-03T01-05-00-000Z.json
      ...
```

Pattern: `stamper/{slug}/{control_family}/{entry_id}_{ISO_timestamp}.json`

## Who Reads This Path

| Consumer | How it resolves `base_path` |
|----------|-----------------------------|
| **Stamper** (`structuredEvidence.ts`) | `stampedBlobPath(config.base_path, evidFile)` — prepends base_path to the evidence filename |
| **EO** (`EoServer.ts:3719`) | `es.base_path ?? ''` — reads from the same tenant config JSON |
| **Shared library** (`@bhd-vfs/shared/blob`) | `config.base_path ? config.base_path + '/' + blobPath : blobPath` — handles empty gracefully |
| **EO Evidence Explorer** | Lists blobs under `stamper/{slug}/` prefix to display in the UI |

All three codebases read `base_path` from the same `plan-data/<slug>/<slug>.json` file. Set it once, both tools use it.

## Checklist When Onboarding a New Tenant

1. Create `plan-data/<slug>/<slug>.json` with `evidence_storage` block
2. Set `base_path` to `stamper/<slug>`
3. Verify the operator's IP is in the storage account firewall allow list (currently `172.9.76.108`)
4. Run a test Execute with upload toggle ON — confirm blobs appear under `incident-evidence/stamper/<slug>/`
