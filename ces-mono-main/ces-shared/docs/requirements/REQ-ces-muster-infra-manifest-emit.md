# REQ-ces-muster-infra-manifest-emit

**Target module:** ces-muster (supports W4-MU1 / MS-R7)
**Filed by:** ces-shared (W4-SH2, 2026-09-27)
**Priority:** P1
**Status:** OPEN

## What

ces-shared 2.5.0 ships a golden-style Infrastructure Manifest that passes both the shared
`InfraManifestSchema` and Stamper's `CESInfrastructureManifestSchema`:
`ces-shared/data/infra-manifest-example` (`src/data/infra-manifest.example.json`). When Muster emits an
infra manifest, target that shape. Compared with the vendored generator
(`src/vendored/ces-planner/mpt/services/infraManifestGenerator.ts`), the gaps are:

1. **Envelope key.** The generator writes `infrastructure_manifest` (deprecated alias, still accepted and
   normalized). Emit the canonical `infrastructure` key.
2. **`infrastructure_model`.** The Azure path does not set it on the body (only a provenance entry).
   Stamper's translate then falls back to tenant config with a warning
   (`ces-stamper/src/server/routes/translate.routes.ts`, "lacks infrastructure_model"). Always set it.
3. **Subnet variable names.** Stamper's network registry resolves `mgmtSubnetCidr`, `workloadSubnetCidr`,
   `bastionSubnetCidr`, `firewallSubnetCidr`. The generator emits `mgmtSubnetCidr`, `identitySubnetCidr`,
   `peSubnetCidr`, `fwSubnetCidr`.
   - `fwSubnetCidr` is now a deprecated alias that `InfraManifestSchema` copies onto `firewallSubnetCidr`
     (a conflicting pair is rejected). Emit `firewallSubnetCidr`.
   - `workloadSubnetCidr` and `bastionSubnetCidr` are never emitted, so AZ-NET-* / AZ-BAS-* stay unresolved.
4. **Resource names Stamper's infra registry requires.** `firewallName`, `publicIpName` (AZ-FW-*), and
   `vmName` / `vmImage` / `vmSize` (AZ-VM-*) are now typed optional fields in the shared variable map.
   Emit them for m365_azure.
5. **`generated_on`** must be an ISO 8601 date-time (Stamper refinement). The generator already uses
   `new Date().toISOString()`; keep that.

The identity variables `breakGlassUPN`, `operatorUPN`, `appId`, `cisoEmail` used by some registry entries
come from the tenant manifest / tenant config, not the infra manifest. They are out of scope here.

## Acceptance test

A Muster-generated m365_azure infra manifest:
- parses with `InfraManifestSchema` (ces-shared) and `CESInfrastructureManifestSchema` (ces-stamper);
- has every key in `STAMPER_PROVISIONING_REQUIRED_VARIABLES` non-empty;
- has `infrastructure_model` and the four canonical subnet CIDRs set;
- is keyed `infrastructure`, not `infrastructure_manifest`.
