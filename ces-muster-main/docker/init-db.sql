-- Setup role for muster-api (least-privilege — MUST NOT be SUPERUSER or BYPASSRLS)
-- SUPERUSER / BYPASSRLS silently disables all PostgreSQL Row-Level Security policies
-- and would allow any tenant to read another tenant's rows. Use CREATEDB + CREATEROLE
-- for Prisma migrations in dev only; strip those in production (see .env.example).
DO
$do$
BEGIN
   IF NOT EXISTS (
      SELECT FROM pg_catalog.pg_roles
      WHERE rolname = 'muster_app') THEN
      -- NOBYPASSRLS is the default but stated explicitly as a documentation guardrail.
      -- CREATEDB + CREATEROLE are required for Prisma `migrate dev` in local dev.
      -- In production, run migrations as a separate privileged role and remove those grants.
      CREATE ROLE muster_app WITH
        LOGIN
        PASSWORD 'password'
        CREATEDB
        CREATEROLE
        NOBYPASSRLS
        NOSUPERUSER;
   END IF;
END
$do$;

GRANT ALL PRIVILEGES ON DATABASE muster_db TO muster_app;
GRANT ALL ON SCHEMA public TO muster_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO muster_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO muster_app;
