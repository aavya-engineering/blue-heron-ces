# ADR-002 — Unified SQLite Persistence

**Status:** accepted (G2) · **Date:** 2026-06-13 · **Context:** [G1 identity](ADR-001-ces-identity-model.md), G2 goal

## Context

Node subsystems (Stamper, EO, AO) persist domain objects as scattered raw JSON files written via
`fs.writeFile`, each `*Store` class inventing its own path layout and (in)consistency rules. There is
no single read/write interface and no enforced tenant isolation at the storage layer. G1 made every
persistent object carry an identity (`{customerId, siBaselineId, tenantSlug, cesId}`); G2 harmonizes
*where and how* those objects are stored.

## Decision

1. **One SQLite-backed repository — `CesRepository`** (`@bhd-vfs/shared/persistence/node`, NODE-ONLY,
   built on `better-sqlite3`). A single `ces.db` under the pipeline root holds all Node-side domain
   records in one `ces_records` table keyed by `(collection, id)`, with identity columns
   (`customer_id, si_baseline_id, tenant_slug, ces_id`) and a JSON `data` blob.

2. **Every read is scoped — isolation is enforced, not optional.** `get/list/update/delete` each
   require a `CesScope` (`{customerId?, siBaselineId?, tenantSlug?}`); an **empty scope throws**.
   Queries always filter by the named scope, so a caller can never read another tenant's rows and a
   lookup of an out-of-scope id returns "not found" (no existence disclosure). This is the storage
   realization of ADR-001's read-ownership rule.

3. **`better-sqlite3`, not `node:sqlite`.** Battle-tested, synchronous (ideal for a repository), and
   works on the project's Node ≥18 engines (a prebuilt binary installed cleanly). `node:sqlite` is
   experimental and Node-24-only.

4. **The browser (Planner) keeps Dexie/IndexedDB** — it cannot run `better-sqlite3`. Its `dbHelpers`
   already provide the same scoped-read contract (ADR-001 wiring). The unified *interface shape*
   (scoped CRUD over identity-keyed records) is shared; the backend differs by runtime.

## Consequences

- The Node `*Store` classes become thin adapters over `CesRepository` (a `collection` + scope per
  object type); their `fs.writeFile`/`readFile` persistence code is removed (G2 criterion #6).
- Migration is gated on G1: only objects that carry a stable identity (tuple or tenantSlug) move.
- Document/output writers (DOCX, diagrams, rendered SSP/POA&M, evidence file *content*) are **not**
  persistence and are out of scope — they remain file writers (and are G3 feature paths).

## Not in scope here

The per-subsystem store migrations and dead-code removal (separate G2 slices). DB-level encryption,
backup/rotation, and cross-DB query are future hardening.
