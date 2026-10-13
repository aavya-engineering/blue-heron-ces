# Implementation — S5 Graph Probe + OAuth Consent Seam

**Date:** 2026-07-07
**Branch:** g-muster-p1
**Slice:** G-MUSTER-P1 S5 — GCC High Graph probe + OAuth consent seam

## Files created

| File | Description |
|------|-------------|
| `src/lib/graphClient.ts` | `GraphClient` interface; `realGraphClient(token, baseUrl?)`; `MockGraphClient` class |
| `src/services/harvestService.ts` | `HarvestFact` type; 3-probe table; `runHarvest(client, now?)` |
| `src/services/consentService.ts` | `buildConsentUrl`; `exchangeCode`; `DegradedError` |
| `src/routes/harvest.ts` | `createHarvestRouter(testClient?)`; default export production router |
| `tests/harvest.test.ts` | 10 tests — mock-tenant integration + route + degraded + consent URL shape |
| `WIRING_S5.md` | Import + mount lines to add to `src/app.ts` when slice ships |

## Test results

```
tests/harvest.test.ts — 10 tests PASS
All test files: 11 passed (108 total, 1 skipped — existing RLS live-DB skip)
npx tsc --noEmit — clean (no output)
```

## Probes implemented

| Probe name | Graph path | Question IDs |
|------------|-----------|--------------|
| `conditionalAccess` | `/identity/conditionalAccess/policies` | `iam-001`, `iam-004` |
| `intuneDevices` | `/deviceManagement/managedDevices` | `ep-001` |
| `defenderCompliance` | `/deviceManagement/deviceCompliancePolicies` | `ep-002` |

## NOT-PROBEABLE — documented in harvestService.ts

- **mon-004 (Sentinel SIEM):** Sentinel is an ARM/Log Analytics resource; no equivalent endpoint exists on `graph.microsoft.us`. Harvest never produces a mon-004 fact.
- **dp-002 (TLS in transit):** Device compliance policies do not authoritatively cover all network-path TLS. No reliable Graph probe; must be self-reported.

## GCC High endpoints [validate with BHD]

- Graph base: `https://graph.microsoft.us/v1.0` (override via `GRAPH_BASE_URL`)
- OAuth authority: `https://login.microsoftonline.us`
- Graph scope: `https://graph.microsoft.us/.default`

## Deviations from plan

None. All spec items implemented as described.

## FCA guardrail compliance

- Per-probe non-fatal: catch block in `runHarvest` produces NO fact on error (absence, not 'no'). Tested by the "probe throws" case.
- Not-probeable questions produce no facts. Callers must not treat absent facts as passing.
- `provenance: 'auto_detected'` on every fact; `confidence: 'high'` (Graph data is authoritative).
- Harvest facts do not flip unknown→pass — scoring layer responsibility.

## Environment variables

| Var | Usage |
|-----|-------|
| `GRAPH_BASE_URL` | Override Graph base (default: `https://graph.microsoft.us/v1.0`) |
| `GRAPH_CLIENT_ID` | App registration client ID (required for consent flow) |
| `GRAPH_CLIENT_SECRET` | App registration secret (required for token exchange) |
| `GRAPH_TENANT_ID` | Azure AD tenant ID (required for consent + token exchange) |
| `GRAPH_REDIRECT_URI` | Redirect URI for token exchange (optional; defaults to `''`) |

All three `GRAPH_CLIENT_*` vars must be set or all consent/callback routes return `503 {degraded: true}`.

## Open items

- app.ts wiring: see `WIRING_S5.md` — do NOT edit app.ts until slice is approved.
- dp-002 (TLS in transit): no auto-detect probe; must remain self-reported.
- mon-004 (Sentinel): ARM-based; would require a separate AzureRM client seam (P2).
