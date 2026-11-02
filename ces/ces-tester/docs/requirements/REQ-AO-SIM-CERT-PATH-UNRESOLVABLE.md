# REQ-AO-SIM-CERT-PATH-UNRESOLVABLE

**Filed by:** ces-tester (GP-DEMO-3, M0 drivability spike)
**Date:** 2026-08-29
**Against:** `ces-tenant` (record authoring) — surfaces in `ces-ao` and `ces-stamper`
**Severity:** MEDIUM — a freshly created sim tenant cannot perform a live (`--apply`) write
out of the box. It fails closed on a certificate file that the registry itself wrote a path
to and that has never existed anywhere in the tree.
**Status:** OPEN — worked around inside ces-tester; NOT patched (write boundary).

## Summary

`FileTenantRegistry.createEphemeralSimTenant()` stamps every sim record with

```json
"auth": {
  "app_id": "sim-app-<slug>",
  "cert_path": "sim/<slug>.pfx",
  "cert_thumbprint": "SIMTHUMBPRINT0000000000000000000000000"
}
```

`cert_path` is **relative**, so it resolves against the consuming process's `cwd`, and no
such file is produced by the registry or by tenant-stacksim. `AuthChain` requires
`tenantConfig.certPath` to **exist on disk** before it will build an execution context, so
any live AdminOps write against a fresh sim tenant fails closed. Dry-run is unaffected,
which is why this stays hidden until the first real apply.

The placeholder `cert_thumbprint` has the same shape of problem one layer up: Stamper's GUI
Connect runs `Get-ChildItem Cert:\CurrentUser\My\<thumbprint>`, and `SIMTHUMBPRINT…` can
never match anything in a real certificate store.

## Verified record contents

Exactly as written by the registry during this spike:

```json
{
  "kind": "sim",
  "tenant": { "tenant_id": "sim-tenant-demo-dib-small", "environment": "gcc-high-sim" },
  "auth": {
    "app_id": "sim-app-demo-dib-small",
    "cert_path": "sim/demo-dib-small.pfx",
    "cert_thumbprint": "SIMTHUMBPRINT0000000000000000000000000"
  }
}
```

`sim/demo-dib-small.pfx` exists nowhere in the tree.

## Code path

| File | Line | Detail |
|---|---|---|
| `ces-tenant/src/impl/registry.ts` | 159 | relative `cert_path: \`sim/${slug}.pfx\`` |
| `ces-tenant/src/impl/registry.ts` | 160 | placeholder `SIMTHUMBPRINT…` thumbprint |
| `ces-ao/src/execution/AuthChain.ts` | 96-109 | requires `certPath` to exist on disk |
| `ces-shared/src/prereq/PrerequisiteChecker.ts` | 156-172 | `Get-ChildItem Cert:\CurrentUser\My\<thumbprint>` |
| `ces-stamper/src/config/StamperConfig.ts` | 114-133 | requires all four auth fields + an existing cert file when not dry-run |
| `ces-stamper/src/config/StamperConfig.ts` | 249-252 | **tenant JSON overrides env** — so a synthetic `.env` cannot paper over this for the GUI |

## Workaround shipped in ces-tester

ces-tester generates a self-signed sim certificate (`CN=ces-tester-sim`, identity-free
subject), exports it to a `.pfx` in the run-scoped workspace, imports it into
`Cert:\CurrentUser\My`, and then patches the registry-written record's **two auth fields
only** — real thumbprint and an **absolute** `cert_path` — leaving every governance field
the registry authored (notably `cmmcMigrationExempt: true`) untouched.

Verified end-to-end: with the absolute `cert_path`, `AuthChain`'s exists-check passes and a
live A-18 apply through the AdminOps GUI mutated the sim tenant and produced a WORM evidence
record. **The relative `sim/<slug>.pfx` placeholder-in-cwd trick that finding #5 proposed
turned out to be unnecessary** — an absolute path in the record is sufficient and is
cwd-independent, which is strictly safer for servers spawned from a module root.

## Suggested fix (for ces-tenant to apply — NOT applied by ces-tester)

Either (a) have `createEphemeralSimTenant` write an **absolute** `cert_path` into a
registry-owned location and materialize a placeholder/self-signed cert there, or (b) leave
`cert_path` empty for sim records and let `AuthChain` skip the file check when
`kind === 'sim'` — a simulated tenant has no real certificate to present. (b) is cleaner:
it stops pretending a credential exists.

## Cross-reference

- `docs/demo/E2E-GROUNDING-EVIDENCE.md` finding #5
- `docs/demo/PLAN-E2E-AO-DEMO.md` FD-5 second item (cert), M0 gate (d)
- Evidence: `runs/m0-spike/m0-001/tenant-root/sim/demo-dib-small.json`, `runs/m0-spike/m0-001/ao/spike-log.txt`
