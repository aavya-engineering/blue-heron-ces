# Derivation Version — ces-spine code files

## Entry Criteria

- **E1 APPROVED — 2026-07-05 — explicit user approval recorded after review of the full plan**
- **E2 ces-muster did not exist prior to this run**

## Pinned SHA

```
4a00bee5d5e618cf55da2469ec12307ebc620418
```

## Source

- **Repo:** `C:/Users/mhsut/DevProjects/ces`
- **Package:** `ces-planner/`
- **Copy date:** 2026-07-05

## Vendored Code Files with SHA-256 Hashes

| File | SHA-256 |
|------|---------|
| `src/vendored/ces-spine/services/bulkAnswerDerivation.ts` | `9aa290c838ef87dfdce3d74c188a7017ba9f55a7cb90592fc55d8af8912e9e5b` |
| `src/vendored/ces-spine/services/postureGenerator.ts` | `d5d1e611b90f7d4b038a4fd7604b002766c9ccda4c03b10d13e5875eba818245` |
| `src/vendored/ces-spine/types/rrt.ts` | `5ccabcc5f0b24dc49b33551e30dbb2a08122f1653a00c2101ccda1782fcd508c` |
| `src/vendored/ces-spine/types/domain.ts` | `8bf3a9a272352af94ab1699b2bd50f713f538856eb2b51bc08611eb1028c65c8` |
| `src/vendored/ces-spine/types/artifacts.ts` | `9dafc4c97e7a31ce7b7b5fcd11040f7a7381a6dd6a7ec3f4eba7f161718f477c` |
| `src/vendored/ces-spine/types/customer.ts` | `638af75defb2555424d75c85a9197f05f0193f67bce017ccd4461a95c56e81fd` |
| `src/vendored/ces-spine/types/techRefIndex.ts` | `ada38fa11d1848299a92b7ad586001280e7463272b4cb7012c21042a11a4728e` |
| `src/vendored/ces-spine/utils/idGenerator.ts` | `8fb1be6007be3b888c723517e1464a07a2337228e39e32b3006409e274af41c6` |
| `src/vendored/ces-spine/utils/dateFormatter.ts` | `4f1f523181c447d3ee1e1c4bb3d05645bcfcc9064542cc3cd6567a3b84bc221e` |
| `src/__fixtures__/builders.ts` | `93bd4dbd9f9e2d7da25214741a7b412eccd83bc6e3af3d805bf85b0945ebb8ef` |

## Deviations from source

See `docs/PORTING_NOTES.md` for full import path adjustments and the single logic deviation (`PolicyInputsRecord.data` type broadening in `artifacts.ts`).
