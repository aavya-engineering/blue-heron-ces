# muster-api

Pure-Node (Express + CesRepository/SQLite `ces.db`) backend for Muster. Brokers all tenant-facing work;
the SPA never touches tenants, sessions, tokens, or registries.

## Signing in from the SPA (Plan tab → Stamper)

"Send to Stamper" and "Check Stamper progress" call `/api/plan/*` with a bearer
token. The SPA gets that token from the existing `POST /auth/login` (bcrypt check
against the `users` table, JWT signed with `JWT_SECRET`): the Plan tab shows an
email/password form, stores only the returned token (`localStorage['muster-jwt']`),
and drops it on any 401 so an expired token re-shows the form. There is no
dev bypass and no token in config. For local use, create an operator once:

```bash
npx tsx scripts/seed.ts --email <operator email> --password <password>   # or SEED_PASSWORD=...
npm run dev   # PORT=4000; CORS allows the Vite origins on localhost:5173/4173
```

Then sign in on the Plan tab with those credentials.

## Test tiers

`npm test` runs the full Vitest suite. Most tests are hermetic (a `mockDb`).
`tests/rls.test.ts` (`npm run test:live`) runs the tenant-scope suite against the
real CesRepository store on a temporary `ces.db`; it needs no external database.
Set `CES_PIPELINE_ROOT` and `CES_TENANT_ROOT` to a temp folder before running tests.

### One-time move of old Postgres data

`npm run migrate:engagements -- export --url <postgres-url> --out <dir>` then
`npm run migrate:engagements -- import --in <dir> [--db <ces.db>] [--dry-run]`
(see `src/cli/engagementMigrate.ts`). The export needs `psql`, not Prisma.
