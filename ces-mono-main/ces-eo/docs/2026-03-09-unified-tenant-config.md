# 2026-03-09 — Unified Tenant Config + Shared Storage

## Summary

Consolidated how EC (Evidence Collector) and EO (Evidence Ops) configure themselves. Before this change, the two apps required 18+ env vars between them and maintained separate storage directories. After this change, both apps read from a single tenant JSON file and share one storage root.

---

## Problem

EC and EO are two processes in the same repo that configured themselves independently:

- **EC** required 8 individual env vars: `TENANT_ID`, `APP_ID`, `CERT_PATH`, `CERT_THUMBPRINT`, `REGISTRY_PATH`, `EVIDENCE_OPS_PORT`, `EVIDENCE_OPS_SHARED_SECRET`, `STORAGE_ROOT`
- **EO** required 10 different env vars: `EO_PORT`, `EC_URL`, `EC_STORAGE_ROOT`, `EO_STORAGE_ROOT`, `TENANT_SLUG`, `REGISTRY_PATH`, `INFRA_REGISTRY_PATH`, `MISSION_PLAN_PATH`, `TENANT_MANIFEST_PATH`, `INFRA_MANIFEST_PATH`
- They maintained separate storage directories (`./storage` and `./eo-storage`) despite their subdirectories never colliding
- The tenant config at `~/.stamper/tenants/vfsgov.json` already contained everything both apps need (auth, endpoints, resources) but only EO read it at runtime for discovery

---

## What Changed

### 1. Shared Tenant Config Loader (NEW)

**File:** `src/shared/config/TenantConfig.ts`

A new shared module that reads a tenant JSON file and returns a typed `TenantConfig` object. Both EC and EO import this. Fields extracted:

| Tenant JSON Path | TenantConfig Field |
|---|---|
| `client.slug` | `tenantSlug` |
| `tenant.tenant_id` | `tenantId` |
| `auth.app_id` | `appId` |
| `auth.cert_path` | `certPath` |
| `auth.cert_thumbprint` | `certThumbprint` |
| `endpoints.*` | `endpoints` |
| `subscription.*` | `subscription` |
| `resources.*` | `resources` |
| `evidence_storage.*` | `evidenceStorage` |

Both apps accept one env var to locate the tenant config:
- `TENANT_CONFIG` — absolute path to the JSON file (e.g. `C:\Users\mhsut\.stamper\tenants\vfsgov.json`)

Validation ensures `tenantId`, `appId`, `certPath`, and `certThumbprint` are present, with a descriptive error listing any missing fields.

### 2. Unified Storage Root

EC and EO now share a single `storageRoot` (default `./storage`). Their subdirectories don't collide:

```
storage/
  artifacts/        (EC writes)
  manifests/        (EC writes)
  findings/         (EC writes)
  runs/             (EC writes)
  variables/        (EC writes)
  assessments/      (EO writes)
  ssp/              (EO writes)
  poam/             (EO writes)
  packages/         (EO writes)
  timeline/         (EO writes)
```

Both apps accept `STORAGE_ROOT` env var (default `./storage`).

### 3. EC Config Refactored

**File:** `src/ec/config/EvidenceCollectorConfig.ts`

- **Before:** 8 individual env vars (`TENANT_ID`, `APP_ID`, `CERT_PATH`, `CERT_THUMBPRINT`, etc.)
- **After:** `TENANT_CONFIG` env var loads tenant JSON via shared loader; individual env vars still work as fallback
- Added `tenantSlug` field to the config schema
- Startup log now shows `Tenant: vfsgov (bbe08772-...)` instead of just the raw UUID

### 4. EO Config Refactored

**File:** `src/eo/config/EoConfig.ts`

- Removed `ecStorageRoot` field entirely
- Added `tenantConfigPath` field (from `TENANT_CONFIG` env var)
- Changed `storageRoot` default from `./eo-storage` to `./storage`
- Derives `tenantSlug` from tenant JSON when `TENANT_CONFIG` is set
- Removed `EC_STORAGE_ROOT` and `EO_STORAGE_ROOT` env var references

### 5. EO Server Updated

**File:** `src/eo/server/EoServer.ts`

- All references to `config.ecStorageRoot` replaced with `config.storageRoot` (evidence browser endpoints: artifacts, manifests, verify)
- Evidence packager call updated: `ecStorageRoot` param renamed to `storageRoot`
- **New endpoint:** `POST /api/tenant-config` — accepts `{ path: "..." }`, validates the file exists and contains required fields, sets `config.tenantConfigPath` and `config.tenantSlug` at runtime
- **New endpoint:** `GET /api/tenant-config` — returns current `tenantConfigPath` and `tenantSlug`

### 6. EO Packager Updated

**File:** `src/eo/packager/EvidencePackager.ts`

- Renamed `ecStorageRoot` parameter to `storageRoot` in the `build()` method
- Internal references updated: `artifacts` and `manifests` directories now read from `storageRoot`

### 7. Index Files Updated

**File:** `src/ec/index.ts`
- Startup log changed from `Tenant: <tenantId>` to `Tenant: <slug> (<tenantId>)`

**File:** `src/eo/index.ts`
- Added startup log for `tenantConfigPath` when set

### 8. GUI: Tenant Config Path Picker

**File:** `public/index.html`

- Added a text input + "Load" button to the header bar, left of the tenant dropdown
- Input placeholder: `Tenant config path...`
- On click, POSTs the path to `/api/tenant-config`, then reloads the tenant dropdown and auto-selects the loaded tenant
- On page load, fetches `GET /api/tenant-config` to restore any previously-set path

### 9. .gitignore Cleaned Up

**File:** `.gitignore`

- Removed `eo-storage/` line (directory no longer used since both apps share `storage/`)

---

## Files Changed

| File | Status | Lines |
|---|---|---|
| `src/shared/config/TenantConfig.ts` | NEW | +69 |
| `src/ec/config/EvidenceCollectorConfig.ts` | Modified | +26, -4 |
| `src/ec/index.ts` | Modified | +1, -1 |
| `src/eo/config/EoConfig.ts` | Modified | +16, -7 |
| `src/eo/index.ts` | Modified | +3 |
| `src/eo/server/EoServer.ts` | Modified | +39, -5 |
| `src/eo/packager/EvidencePackager.ts` | Modified | +4, -4 |
| `public/index.html` | Modified | +50 |
| `.gitignore` | Modified | -1 |
| **Total** | **9 files** | **+204, -20** |

---

## Env Var Changes

### Before

**EC (8 vars):**
`TENANT_ID`, `APP_ID`, `CERT_PATH`, `CERT_THUMBPRINT`, `REGISTRY_PATH`, `EVIDENCE_OPS_PORT`, `EVIDENCE_OPS_SHARED_SECRET`, `STORAGE_ROOT`

**EO (9 vars):**
`EO_PORT`, `EC_URL`, `EC_STORAGE_ROOT`, `EO_STORAGE_ROOT`, `TENANT_SLUG`, `REGISTRY_PATH`, `INFRA_REGISTRY_PATH`, `MISSION_PLAN_PATH`, `TENANT_MANIFEST_PATH`, `INFRA_MANIFEST_PATH`

### After

**EC (5 vars):**
`TENANT_CONFIG`, `REGISTRY_PATH`, `EVIDENCE_OPS_PORT`, `EVIDENCE_OPS_SHARED_SECRET`, `STORAGE_ROOT`

**EO (9 vars):**
`TENANT_CONFIG`, `EO_PORT`, `EC_URL`, `REGISTRY_PATH`, `INFRA_REGISTRY_PATH`, `MISSION_PLAN_PATH`, `TENANT_MANIFEST_PATH`, `INFRA_MANIFEST_PATH`, `STORAGE_ROOT`

**Shared:** `TENANT_CONFIG` and `STORAGE_ROOT` are the same env var for both apps.

EC still accepts the legacy individual env vars (`TENANT_ID`, `APP_ID`, etc.) as fallback when `TENANT_CONFIG` is not set.

---

## Commit

```
1e6c189 feat: unify tenant config and shared storage across EC and EO
```

Build verified clean (`npm run build` — no errors).
