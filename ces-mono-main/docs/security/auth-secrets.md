# Auth & Secrets — Best Practices (G1 T6 foundation)

**Status:** foundation in place · full secrets-manager integration deferred (G3/G5 per roadmap).

## Problem

Today tenant config (`plan-data/{slug}/{slug}.json`) can hold secret material inline in plaintext:
`auth.cert_thumbprint`, `evidence_storage.account_key`. Inline secrets in config files are the
single biggest auth hygiene gap surfaced by the G1 persistence inventory.

## What G1 adds

A secret-**reference** mechanism (`@bhd-vfs/shared/config/secrets`). Any secret-bearing config field
may hold either:

- a **literal** (legacy, discouraged), or
- a **reference** resolved from the environment at load time:
  - `env:VFS_CERT_THUMBPRINT`
  - `${VFS_CERT_THUMBPRINT}`

`loadTenantConfig()` resolves `auth.cert_thumbprint` and `evidence_storage.account_key` through this
mechanism. Behavior:

- **Literals pass through unchanged** — existing configs keep working (no breakage).
- **A declared reference that can't resolve throws** (fail closed) — never silently empty.

## Recommended deployment

Externalize secrets; keep only references in the config file:

```jsonc
{
  "auth": {
    "app_id": "…",
    "cert_path": "/secrets/tenant.pfx",
    "cert_thumbprint": "env:VFS_CERT_THUMBPRINT"   // resolved from env at load
  },
  "evidence_storage": {
    "account_key": "${VFS_STORAGE_KEY}"
  }
}
```

Set the env vars from your platform's secret store (CI/CD secret, key vault injection, etc.).

## Strict mode (opt-in)

Hardened deployments can forbid inline secrets entirely with
`assertNoInlineSecrets(record, fields)` — it throws if any designated field holds a literal rather
than a reference. Not wired into the default loader (would break literal-based configs); adopt it in
environments that mandate externalized secrets.

## Deferred (G3/G5)

- Direct secret-store integration (Key Vault / managed identity) instead of env injection.
- Audit logging of secret access.
- Certificate expiry/rotation tracking.
- `cert_path` private-key material handling (the `.pfx` itself remains on disk today).
