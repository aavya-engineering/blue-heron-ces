# Postgres setup for the full Muster UI path

Blue Heron Defense, CES team. **Not executed by BHD.** The MX run does not use a database: discovery, plan compile and the plan push all work without one (see `BRING-MUSTER-CURRENT.md`). Use this page when you want the browser app's own path: sign in, then **Send to Stamper** from the Plan tab.

Citations are `repo:path:line` at the pins in `pins.json`.

## Why the UI path needs Postgres

- muster-api's Prisma schema names only `provider = "postgresql"`, with `url = env("DATABASE_URL")` (`ces-muster:muster-api/prisma/schema.prisma:11-12`). There is no SQLite or in-memory provider.
- `/auth/login` looks the user up with `db.user.findUnique` (`muster-api/src/routes/auth.ts:33`). Login, engagements, parties and sessions all need the database.
- The SPA's "Send to Stamper" signs in through `/auth/login` first. The MX run skips this by minting a token directly (`scripts/mint-token.mjs`) for `/api/plan/push`, which is mounted without a database (`muster-api/src/app.ts:88`).

## Steps

1. **Install PostgreSQL 16** and make sure `psql` is on `PATH`.
2. **Create the database and an application role.** The application role must **not** be a superuser and must **not** have `BYPASSRLS`:
   ```sql
   CREATE ROLE muster_app LOGIN PASSWORD '<choose one>' NOSUPERUSER NOBYPASSRLS;
   CREATE DATABASE muster OWNER postgres;
   GRANT CONNECT ON DATABASE muster TO muster_app;
   ```
3. **Run the migrations** as the owner role, from `ces-muster/muster-api`:
   ```powershell
   $env:DATABASE_URL = 'postgresql://postgres:<pw>@localhost:5432/muster'
   npx prisma migrate deploy        # applies prisma/migrations/001_init .. 007_live_area_consents
   ```
   Then grant the application role access to the tables the migrations created (schema `public`): `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO muster_app;`
4. **Seed an operator user** (`muster-api/scripts/seed.ts`):
   ```powershell
   npx tsx scripts/seed.ts --email operator@example.test --password '<pw>' --role bhd_operator
   ```
5. **Start muster-api against the application role:**
   ```powershell
   $env:DATABASE_URL = 'postgresql://muster_app:<pw>@localhost:5432/muster'
   $env:JWT_SECRET = '<a long random string>'
   $env:CES_PIPELINE_ROOT = 'C:\mx\pl'      # keep pushes out of C:\CES_Pipeline
   $env:PORT = '4000'                      # the SPA's default API base is http://localhost:4000/api
   npm start
   ```
   The SPA reads its API base from `localStorage['muster-api-url']`, default `http://localhost:4000/api` (`ces-muster:src/shared/api/musterApi.ts:13,31`).
6. **Run the SPA** (`npm run dev` in `ces-muster`), complete an assessment, open the Plan tab, sign in with the seeded user, and use **Send to Stamper**. The files land in `<CES_PIPELINE_ROOT>/Stamper/plan-data/<slug>/plans/` with the same names the MX run produces, so `mx-e2e.ps1 -From E5` can take it from there.

## MG-06 warning (row-level security)

The first migration runs `ALTER ROLE postgres BYPASSRLS` (`muster-api/prisma/migrations/001_init/migration.sql:105-114`). If the application ever connects as `postgres`, tenant isolation silently disappears. There is no role bootstrap in the repo, and the live RLS tests skip without `DATABASE_URL` (`muster-api/tests/rls.test.ts:116`). This is backlog item MG-06 in the muster-shift package; it is still open.

## Legend

| Term | Meaning |
|---|---|
| RLS | Postgres row-level security (tenant isolation) |
| SPA | The Muster browser app (`ces-muster`) |
| MG-06 | muster-shift backlog item: RLS role bootstrap |
| MX | The Muster-on-the-sim run this package documents |
