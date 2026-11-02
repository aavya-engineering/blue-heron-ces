# S5 Wiring Note — harvest router

Do NOT edit `src/app.ts` until the full S5 test suite passes and the slice is
approved for commit. Add the following two lines in `src/app.ts` at the
positions shown.

## Import (top of file, with other route imports)

```typescript
import harvestRouter from './routes/harvest.js';
```

## Mount (inside createApp(), after the existing touch mount)

```typescript
app.use('/api/harvest', harvestRouter);
```

## Complete wiring diff (for copy-paste)

```diff
// src/app.ts
+import harvestRouter from './routes/harvest.js';

 export function createApp() {
   ...
   app.use('/api/touch', createTouchRouter(db));
+  app.use('/api/harvest', harvestRouter);
   ...
 }
```

## Note on test injection

For test servers that need a specific GraphClient, use the named factory:

```typescript
import { createHarvestRouter } from './routes/harvest.js';
const router = createHarvestRouter(myMockClient);
app.use('/api/harvest', router);
```
