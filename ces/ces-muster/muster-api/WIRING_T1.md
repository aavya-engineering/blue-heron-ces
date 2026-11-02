# WIRING_T1.md — G-MUSTER-P2 Slice T1 wiring reference

## New router: recipes

File: `muster-api/src/routes/recipes.ts`

Export: `createRecipesRouter()` (factory) + `default` (production instance)

To wire into `app.ts` when ready (DO NOT edit app.ts during T1 — this slice
is additive and the default export is ready for mounting):

```typescript
// In src/app.ts, add after the sprs router line:
import recipesRouter from './routes/recipes.js';
// ...
app.use('/api/recipes', recipesRouter);
```

## Endpoints

| Method | Path                  | Auth               | Notes                                    |
|--------|-----------------------|--------------------|------------------------------------------|
| GET    | /api/recipes          | bearerAuth (any)   | List recipes from INDEX.json             |
| POST   | /api/recipes/ingest   | prime/bhd_op/sub   | DONE-WHEN #8 gate: x-concierge-session   |

## Feature flag

`RECIPES_SELF_SERVE=true` — unlocks POST /recipes/ingest without concierge header.
Default: absent (OFF). Do not set to `true` until concierge validation sessions
are recorded in `docs/recipes-concierge-validation.md`.

## New files (T1)

```
recipes/
  INDEX.json                           — signed recipe index
  entra-mfa-report/
    recipe.ps1                         — read-only MFA capture
    manifest.json                      — sha256 + output_maps_to
  defender-av-status/
    recipe.ps1                         — read-only AV status capture
    manifest.json
  bitlocker-status/
    recipe.ps1                         — read-only BitLocker capture
    manifest.json

muster-api/
  schemas/
    config-fact.schema.json            — ConfigFact JSON schema
  src/
    lib/
      recipeSigning.ts                 — sha256Hex, signRecipe, verifyRecipe
    services/
      recipeIngestService.ts           — ingest(), validateConfigFact()
    routes/
      recipes.ts                       — GET /recipes, POST /recipes/ingest
  tests/
    recipes.readonly.test.ts           — static read-only assertion
    recipes.ingest.test.ts             — signature + mapping + gate tests
  WIRING_T1.md                         — this file
  IMPLEMENTATION_T1.md                 — implementation record
```
