-- Migration: 007_live_area_consents (FC-MU-3 step 5, founder decision 2026-09-28 #14)
--
-- Live coverage beyond Graph: Exchange Online, Purview and Azure each get their
-- own device-code consent (one delegated token per resource). Each granted
-- consent is recorded here, keyed by area: { "exchange": {...}, "purview": {...},
-- "azure": {...} }. The Graph consent stays in live_consent (migration 006).
-- A refused or aborted consent writes nothing. No token or secret is stored.
ALTER TABLE engagements ADD COLUMN live_area_consents JSONB;
