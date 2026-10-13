# S2 Wiring — nudges router

The orchestrator adds these lines to `muster-api/src/app.ts` when wiring S2.

**Import** (add with the other route imports at the top):

```typescript
import createNudgesRouter from './routes/nudges.js';
```

**Mount** (add inside `createApp()` after the existing `app.use('/api/touch', ...)` line):

```typescript
app.use('/api/nudges', createNudgesRouter(db));
```
