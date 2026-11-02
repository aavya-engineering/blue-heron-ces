# readiness-result.v1 — payload specification (G-MUSTER-READINESS-1 M1)

**Date:** 2026-07-11. **Status:** SHIPPED (M1). **Schema:** `public/schemas/readiness-result.schema.json`.
**Types:** `src/shared/types/readinessResult.ts`. **Fixtures:** `src/__fixtures__/readinessResults.ts`.
**Test:** `src/features/export/__tests__/readinessResultSchema.test.ts`.
**Provenance:** founder directive 2026-07-11 working-system program; normative text
ces-strategy/docs/context/masterplan/muster-modes.md sec. 1; master plan appendix
(ces-strategy/docs/MASTER-PLAN-2026-07-11.md).

## The design rule

**The payload IS the import-file format.** One schema serves four producers — canned
fixture, admin-run script upload (GO-2 M3: script-upload == import-file, one mechanism),
ces-tester run, and a BHD-run readiness session handed to plan-mode. **No second format,
ever.** It converges the three partial shapes that already exist: Muster's
DiscoveryResult rows, Stamper's ReadinessResult (executor-observation ancestor), and the
coverage JSON's planner_gen2_feed (the gap/residual math skeleton).

## Shape summary (normative detail lives in the JSON schema)

- `schema_version`: `"readiness-result/1.1.0"` is written (FC-MU-3); the importer accepts
  `"readiness-result/1.0.0"` and `"readiness-result/1.1.0"` and nothing else.
- `manifest` — session provenance:
  - `mode: self-hosted | independent | collaborative-bhd` (founder-directive verbatim).
  - `auth_tier: device-code | script-upload | lite | cert-app-only` — "the auth tier
    achieved is itself provenance" (residual-elicitation-ladder.md).
  - `tenant: { slug, kind: live|sim }` — ces-tenant registry semantics. **NAME
    COLLISION documented:** NOT muster-api's SaaS `Tenant` model (prisma/schema.prisma).
  - `operator { name, role }`, optional `bhd_presence { name }` (collaborative-bhd only).
  - `engagement_id, party_id, engagement_kind` (existing engagement.ts vocabulary —
    `mode` is a manifest attribute, NOT a new EngagementKind).
  - `started_at`, optional `completed_at`.
  - optional `consent { consented_by, consented_at, scopes[], tenant_id, auth_tier:
    device-code, client_id? }` (FC-MU-2, 2026-09-28) — the customer's consent for a
    LIVE device-code read. Present only when `tenant.kind` is `live`. FC-MU-3 adds an
    optional `area: graph | exchange | purview | azure` to it.
  - optional `consents[]` (1.1.0, FC-MU-3) — every live consent the run used, one per area;
    `consent` stays the Graph one. The SPA keeps both across import → interview → export
    (`InterviewSession.live_consents`).
- `facts[].source` (optional, 1.1.0, FC-MU-3) — where an auto-detected answer came from.
- `observations[]` — the shipped DiscoveryResult row `{ control_id, objective_ids[],
  confidence }` extended per row with: `ran_entry_ids[]` (registry entry ids),
  optional `raw_capture_ref` (pointer only — **raw output never inline**),
  `derived_posture: met|not_met|partial|unknown` (sprsCalc status vocabulary),
  optional `objective_coverage: { "<obj-id>": A|B|C }` (planner_gen2_feed skeleton),
  optional `residual_must_have[]` (EMX archetype names verbatim).
- `facts[]` (optional) — InterviewFact rows exactly as-is plus GO-2's optional
  `attestation { drafted_by, confirmed_by, confirmed_on }` extension (rendered
  "drafted by [source], confirmed by [name] on [date]"). Draft facts carry draft
  provenance strings; **drafts prune, never pass; unknown never prunes, never passes.**
- `derived`:
  - `sprs_now: SprsResult` — **one-SPRS rule:** Muster's parity-proven `computeSprs`
    (sprsCalc.ts) is the only source of the number, counting only attested/observed
    non-draft facts. Bounded [-203, 110] in-schema (DoD floor/ceiling).
  - `gaps[] { requirement_id, weight, fix_entry_ids[], fixable: registry|manual }` —
    the registry `set_command` IS the fix path (125 of 223 entries carry set_commands).
  - `sprs_after: number` — the SAME calculator re-run with every registry-fixable gap
    flipped to met. **A PROJECTION; must always render labeled as one** (FCA).
- `provenance` — `registry_versions` (name -> version), `coverage_dataset` id,
  `engine { name, version }`, `generated_at`.

## Validation conventions

Draft-07, `additionalProperties: false` throughout, compiled with `new Ajv({ strict:
true })` (house pattern: statusPayload/evidencePackage tests). No `format` keywords —
timestamps are plain strings, matching the existing schemas.

## Flow (who produces, who consumes)

The discovery engine (G-MUSTER-DISCOVERY-1, muster-api lane) PRODUCES `observations[]`
plus capture files; MUSTER-READINESS (M2/M3) wraps them with the manifest, session
facts, and the customer report (SPRS now / two-tier gaps / SPRS-after-as-projection);
MUSTER-PLAN (G-MUSTER-PLAN-2) CONSUMES the payload through the same
`synthesizeFactsFromDiscovery` + `pruneByCoverage` seam as fixtures; ces-tester injects
payload fixtures via its reserved `muster.readiness_payload` scenario-schema block.
Stamper's contract is unchanged.

## Versioning

`readiness-result/1.0.0`. Additive optional fields bump the patch/minor; anything that
changes required fields or enum vocabularies bumps the major and REQUIRES a founder
decision (the payload is a frozen interface three goals build against).

FC-MU-2 (2026-09-28) added the optional `manifest.consent` object. It is additive and
optional, so every existing payload still validates. The `schema_version` const stays
`readiness-result/1.0.0`: the SPA importer (`importReadinessResult.ts`) matches that
const exactly, so a version bump would reject every payload already on disk.

FC-MU-3 (2026-09-28, founder decision #12): **bumped to 1.1.0.** 1.1.0 = 1.0.0 plus the
optional `manifest.consent` (with `area`), `manifest.consents[]` and `facts[].source`. The
schema's `schema_version` is an enum of both versions; both exporters (SPA
`readinessResultService.ts`, muster-api `discoveryEnvelope.ts`) write 1.1.0; the importer
takes either. Consumers that match `1.0.0` exactly must widen: ces-tester does
(`docs/requirements/REQ-ces-tester-readiness-result-1.1.0.md`).
