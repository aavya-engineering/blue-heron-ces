# S3 Wiring — lines to add to muster-api/src/app.ts

Add these imports near the top of `src/app.ts` alongside the existing route imports:

```typescript
import interviewRouter from './routes/interview.js';
import coachRouter from './routes/coach.js';
```

Add these `app.use()` calls after the existing route registrations (before the error handler):

```typescript
app.use('/api/interview', interviewRouter);
app.use('/api/coach', coachRouter);
```

## Resulting endpoints

- `POST /api/interview/adaptive/next` — roles: sub | prime | bhd_operator
- `POST /api/interview/retro-confidence` — roles: sub | prime | bhd_operator
- `POST /api/coach/chat` — roles: sub | prime | bhd_operator
