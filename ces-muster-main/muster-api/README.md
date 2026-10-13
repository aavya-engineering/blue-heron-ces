# muster-api

Pure-Node (Express + Prisma) backend for Muster. Brokers all tenant-facing work;
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

`npm test` runs the full Vitest suite. Most tests are hermetic (a `mockDb`, no
real Postgres). Three tests in `tests/rls.test.ts` are **live-Postgres RLS
tests**, env-gated on `DATABASE_URL` (`describe.skipIf(!process.env.DATABASE_URL)`).
Without `DATABASE_URL` they report as **skipped** — that is the expected default
board (e.g. "N passed + 3 skipped"), not a failure.

### Running the live RLS tier (H2)

The live tier proves cross-tenant isolation is enforced by Postgres Row-Level
Security, so it MUST run against a **non-superuser role without `BYPASSRLS`** — a
superuser silently disables RLS and the isolation tests would falsely pass
(`.env.example` carries the same warning).

One-time setup, then the one-liner:

```bash
# 1. Point DATABASE_URL at a Postgres whose role is NOT a superuser and does
#    NOT have BYPASSRLS (see .env.example). Apply all migrations:
DATABASE_URL=postgresql://muster_app:password@localhost:5432/muster_db npm run migrate:deploy

# 2. Seed the two-tenant fixture the positive-visibility test needs
#    (idempotent — a no-op once seeded):
DATABASE_URL=postgresql://muster_app:password@localhost:5432/muster_db npm run seed:rls

# 3. The one-liner — run the RLS suite with the live tier active:
DATABASE_URL=postgresql://muster_app:password@localhost:5432/muster_db npm run test:live
```

On Windows PowerShell, set the variable first:

```powershell
$env:DATABASE_URL = 'postgresql://muster_app:password@localhost:5432/muster_db'
npm run migrate:deploy; npm run seed:rls; npm run test:live
```

With `DATABASE_URL` set the three live tests execute instead of skipping:

1. `tenant-A context cannot read tenant-B parties` — isolation (needs no rows).
2. `unscoped plain-db query returns [] and does not throw` — migration 004
   fail-closed (`current_setting('app.tenant_id', true)` is NULL when unset).
3. `withTenant(tenant-B) sees tenant-B parties` — positive visibility; this is
   the one that needs `npm run seed:rls` to have run first.

To run the entire suite (hermetic + live) against Postgres, use
`DATABASE_URL=... npm test` after steps 1–2 above.
