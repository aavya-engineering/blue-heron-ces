# REQ: ces-tester: accept readiness-result/1.1.0 (Muster now writes it)

**Filed by:** ces-muster (FC-MU-3 step 3, 2026-09-28)
**Target module:** ces-tester
**Priority:** P1 (the Muster demo acts' MA1 and MP1 judges fail against a current Muster build)

## What changed in Muster
Founder decision 2026-09-28 #12: the readiness record is now `readiness-result/1.1.0`. Both Muster exporters write
it: the SPA readiness export (`src/features/export/readinessResultService.ts`) and the muster-api discovery envelope
(`muster-api/src/services/discoveryEnvelope.ts`, which `mu discovery --sim` writes). Muster's importer accepts
`1.0.0` and `1.1.0`. 1.1.0 is 1.0.0 plus three optional fields: `manifest.consent` (with `area`),
`manifest.consents[]` and `facts[].source`. Nothing required changed. Schema: `public/schemas/readiness-result.schema.json`.

## What breaks in ces-tester (read, not changed)
- `src/demo/show/ops/muster-auto-analysis-op.ts:56` `READINESS_RESULT_SCHEMA_VERSION = 'readiness-result/1.0.0'`.
- `src/demo/acts/act-run.ts:1428` (MA1) and `:1581` (MP1) compare `schema_version` to that constant with `!==` / `===`.
  A 1.1.0 artifact fails MA1 ("schema_version readiness-result/1.1.0") and MP1.
- `tests/demo-acts-muster-auto-analysis.test.ts` fixtures use 1.0.0 (they stay valid; add a 1.1.0 case).

## Ask
Accept both versions in MA1/MP1 (for example a set `{1.0.0, 1.1.0}`), and add a 1.1.0 fixture case.

## Acceptance
A demo run against the current Muster HEAD passes MA1 and MP1 with a 1.1.0 artifact; a 1.0.0 artifact still passes.

## Addendum (ces-muster FC-MU-5, 2026-09-28)
Still `readiness-result/1.1.0` (widened in place: no 1.1.0 record has been produced against a real tenant yet).
Additive, optional, inside `definitions.consent` (used by `manifest.consent` and `manifest.consents[]`):
- `area` enum gains `teams` (the fifth live area).
- `reader_roles` (string array): the reader roles proven at consent time, e.g. `["Global Reader"]`, or
  `["Global Reader", "Azure Reader (subscription)"]` for Azure.
- `subscription_id` (string): the Azure subscription the reader check covered.
If ces-tester validates against a copy of the schema, refresh that copy; if it only compares `schema_version`,
nothing more is needed. Acceptance: a 1.1.0 artifact whose consent carries these fields passes MA1 and MP1.
