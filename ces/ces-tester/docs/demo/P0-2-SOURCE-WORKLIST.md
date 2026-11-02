# P0-2 "fix at source" — core-9 work-list (founder ruling 2026-07-27)

Diagnosis method: ran each task's write→read-back through the **actual** tenant-stacksim
resolver (`dist/`) and applied Stamper's exact verifier (`OutputVerificationEngine.extractJsonPath`
+ `evidenceValueEquals`). Two verifier facts drive it: `equals` is case-insensitive (rendering is
never the cause); `extractJsonPath` unwraps a **single**-element array but returns `undefined` for
`[]` or length≠1. Named-cmdlet GETs return the whole collection and honor only `-Filter`, not
`-Identity` (`ResolverTable.ts:156`).

## Result: the core-9 is stale — 5 already fixed, 4 real gaps, 0 Stamper bugs

| # | task | status | source |
|---|---|---|---|
| 1 | MP.L2-3.8.1.cui-label | **already-fixed** (`$.Name="CUI"` round-trips) | re-verify live |
| 2 | IA.L2-3.5.9.tap-config | **already-fixed** (`isUsableOnce=true`) | re-verify live |
| 3 | SC.L2-3.13.13.safe-attach | **already-fixed** (`Enable=true`) | re-verify live |
| 4 | AU.L2-3.3.1.audit-enable | **already-fixed** (`UnifiedAuditLogIngestionEnabled=true`) | re-verify live |
| 5 | SI.L2-3.14.3.safe-links | **already-fixed** (`EnableSafeLinksForEmail=true`) | re-verify live |
| 6 | SI.L2-3.14.2.malware-rule | **stacksim GAP** — `$.State` create-default undefined | tenant-stacksim |
| 7 | SC.L2-3.13.15.anti-phish | **stacksim GAP** — `$.Enabled` create-default undefined | tenant-stacksim |
| 8 | MP.L2-3.8.9.dlp-policy | **stacksim GAP** — `-Identity` ignored → 2–3-elem array → undefined (765d215 incomplete) | tenant-stacksim |
| 9 | AC.L2-3.1.1.member-add | **stacksim GAP** — write→`groupMemberByRef`, read→`groupMember` (never sees write) | tenant-stacksim |

The 5 already-fixed predate the FIDELITY-1 / M3 / 765d215 sim work — exactly the "stale skip" our
`known-false-fails.ts` says to re-measure. **No ces-stamper template changes needed** (registry
commands mirror real-tenant behavior; the gaps are all sim-side).

## The 4 fixes (all in tenant-stacksim — own repo, parallel-safe). Respect sim-transparency.

**(8) dlp-policy — KEYSTONE, do first** (builds the `-Identity`/natural-id path the others reuse).
`New-/Get-DlpCompliancePolicy`, field `$.DistributionStatus`. 765d215 seeded 2 policies + the
computed field, but `-Identity` is ignored so `Get` returns a 2-elem array (3 after `New-`).
- `src/resolvers/ResolverTable.ts`: honor `-Identity <val>` on named-cmdlet GET (match
  Identity/Name/DisplayName/id → return the single object).
- `resolveMutation`: key the new object by its `-Name`/`-Identity` natural id (mirror the `users`
  `naturalId` block ~lines 466-478) so `New-…-Name 'CMMC-CUI-Block'` upserts onto the seeded id.
- Interim: cut the `dlpCompliancePolicy` seed 2→1 in `profiles/m365-*.json`.
- Test: `ResolverTable.test.ts` — seed, New, `Get -Identity 'CMMC-CUI-Block'` returns exactly 1.

**(6) malware-rule + (7) anti-phish — together** (one mechanism). `New-MalwareFilterRule`
(`$.State='Enabled'`) and `New-AntiPhishPolicy` (`$.Enabled=true`) are **server-computed create
defaults** the SET args never set (same class as DLP DistributionStatus; templates are correct).
- Add `creationDefaults?: Record<string,unknown>` to `NamedCmdletResolverEntry`
  (`src/resolvers/types.ts`); populate via hand-authored override in `src/resolvers/exoResolvers.ts`.
- `resolveMutation`: merge defaults **under** the arg patch (args win).
- Test: `ResolverTable.test.ts` round-trips (none exist today).

**(9) member-add — last** (most bespoke). `New-MgGroupMemberByRef` writes collection
`groupMemberByRef`; `Get-MgGroupMember` reads `groupMember` → read can't see the write.
- `src/resolvers/graphResolvers.ts` (hand-authored override, per `azureResolvers.ts` precedent):
  map `New-MgGroupMemberByRef` and `Add-MgGroupMember` → collection `groupMember`, member id =
  trailing `directoryObjects/{id}` parsed from `-BodyParameter @{'@odata.id'}` so
  `$.Id eq {operatorUserId}` matches.
- Test: graph round-trip.

All four touch `ResolverTable.ts:resolveMutation` → serialize commits there.

## After the fixes
Re-measure live (full demo-dib-small execute); the harness `partitionFailures` should report the
registered entries as **stale-skips** as each fix lands → shrink `known-false-fails.ts` honestly.
Any residual red on 1–5 under load is Stamper-side/timing (P0-2 load-sensitivity), not sim surface.
