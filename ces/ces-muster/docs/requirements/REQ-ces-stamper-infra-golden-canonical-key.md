# REQ: ces-stamper: Muster's Infra Manifest golden now uses the canonical `infrastructure` key

**Filed by:** ces-muster (W4-MU1 follow-up, 2026-09-27)
**Target module:** ces-stamper (W4-ST2)
**Priority:** P1 (information; no Stamper code change should be needed)

## What changed
`ces-muster/src/features/plan/__fixtures__/infrastructure-manifest.json` was first committed in `299cac2` with
the generator's `infrastructure_manifest` key. The follow-up commit (message contains "W4-MU1") re-emits it as
ces-shared REQ-ces-muster-infra-manifest-emit (W4-SH2, 2.5.0) asks. The same shape is what
`POST /api/plan/push` writes:
- the body is keyed `infrastructure` (the deprecated `infrastructure_manifest` key is gone);
- `infrastructure.infrastructure_model` is set (`m365_azure` for the golden);
- `stamper_variable_map` adds `firewallSubnetCidr`, `workloadSubnetCidr`, `bastionSubnetCidr`,
  `firewallName`, `publicIpName`, `vmName`, `vmImage` and `vmSize`, each with a provenance row. Every
  `STAMPER_PROVISIONING_REQUIRED_VARIABLES` key is non-empty.

The shared `InfraManifestSchema`, and so Stamper's `CESInfrastructureManifestSchema`, accept this shape. Code
that reads `data.infrastructure` after parsing is unaffected. Only a test that reads the raw JSON's
`infrastructure_manifest` property would need to change.

## Pushed filename
`infrastructure-manifest-<slug>-<ts>.json` is written next to `tenant-manifest-<slug>-<ts>.json` with the same
`<slug>-<ts>`. The CLI lookup `replace(/tenant-manifest/i, 'infrastructure-manifest')` finds it.

## Heads-up for the dry run
The golden's `stamper_variable_map.subscriptionId` is the vendored generator's placeholder
(`sub_<time>_<rand>`, frozen for the golden), not a GUID. The shared contract only requires it to be non-empty,
and Muster has no source for a real subscription id: no TCP question asks for one. If W4-ST2's dry run checks
the GUID shape, treat this as a known placeholder rather than a Muster regression.
