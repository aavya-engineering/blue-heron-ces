# Porting Notes — ces-spine vendored files

**Pinned SHA:** `4a00bee5d5e618cf55da2469ec12307ebc620418`
**Source repo:** `C:/Users/mhsut/DevProjects/ces` (ces-planner/)
**Copy date:** 2026-07-05

---

## Import path adjustments

### `src/vendored/ces-spine/services/bulkAnswerDerivation.ts`
Source: `ces-planner/src/features/rrt/services/bulkAnswerDerivation.ts`

| Original | Adjusted |
|----------|----------|
| `from '../types'` | `from '../types/rrt'` |
| `from '@/shared/types/domain'` | `from '../types/domain'` |
| `from '@/shared/services/techRefIndex'` | `from '../types/techRefIndex'` |
| `from '@/shared/types/artifacts'` | `from '../types/artifacts'` |

### `src/vendored/ces-spine/services/postureGenerator.ts`
Source: `ces-planner/src/features/rrt/services/postureGenerator.ts`

| Original | Adjusted |
|----------|----------|
| `from '../types'` | `from '../types/rrt'` |
| `from '@/shared/types/artifacts'` | `from '../types/artifacts'` |
| `from '@/shared/utils/idGenerator'` | `from '../utils/idGenerator'` |
| `from '@/shared/utils/dateFormatter'` | `from '../utils/dateFormatter'` |

### `src/vendored/ces-spine/types/techRefIndex.ts`
Source: `ces-planner/src/shared/services/techRefIndex.ts`

| Original | Adjusted |
|----------|----------|
| `from '@/shared/types/domain'` | `from './domain'` |

### `src/__fixtures__/builders.ts`
Source: `ces-planner/src/__fixtures__/builders.ts`

| Original | Adjusted |
|----------|----------|
| `from '@/features/rrt/types'` | `from '@/vendored/ces-spine/types/rrt'` |
| `from '@/shared/types/artifacts'` | `from '@/vendored/ces-spine/types/artifacts'` |

### `src/vendored/ces-spine/services/__tests__/postureGenerator.characterization.test.ts`
Source: `ces-planner/src/features/rrt/services/__tests__/postureGenerator.characterization.test.ts`

| Original | Adjusted |
|----------|----------|
| `from '@/features/rrt/types'` | `from '@/vendored/ces-spine/types/rrt'` |

---

## Self-contained modules (no import changes needed)

- `src/vendored/ces-spine/types/rrt.ts` — no external imports
- `src/vendored/ces-spine/types/customer.ts` — no external imports
- `src/vendored/ces-spine/types/domain.ts` — no external imports
- `src/vendored/ces-spine/types/artifacts.ts` — re-export path `./customer` already resolved correctly
- `src/vendored/ces-spine/utils/idGenerator.ts` — no external imports
- `src/vendored/ces-spine/utils/dateFormatter.ts` — no external imports

---

## Logic deviations

### `src/vendored/ces-spine/types/artifacts.ts` — PolicyInputsRecord.data type

Original:
```typescript
data: import('@/features/policy/types').PolicyInputsOutput;
```

Adjusted to:
```typescript
data: Record<string, unknown>;
```

**Reason:** `ces-planner/src/features/policy/types` is not vendored into ces-muster (the policy feature is not part of the spine). The dynamic import would have caused a resolution error. `Record<string, unknown>` is a safe structural broadening for the DB record type — no code in ces-muster reads this field.

---

## ESLint config deviation

`src/vendored/**` is added to the ESLint `ignores` list in `eslint.config.js`. This prevents lint errors from vendored files (which intentionally use `any` types and cannot be modified). This is logged as a planned deviation — vendored code is not under lint enforcement.

---

## Additional packages required (not in original ces-planner devDeps)

- `globals` — required by the ESLint v9 flat config
- `jsdom` — required by Vitest's `environment: 'jsdom'` option
- `typescript-eslint` — the flat-config bundle (ces-planner uses the split packages separately)
