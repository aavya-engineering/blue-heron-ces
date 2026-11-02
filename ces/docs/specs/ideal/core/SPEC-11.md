# SPEC-11 — Data & Persistence (v1.0)

## Intent

Data is the part of a system that outlives every deploy, so its handling must be deliberate: one
place data lives, one way schema changes, provable integrity for records that matter, an explicit
lifecycle, and hard walls between tenants. This spec draws on established practice — **schema
migrations as versioned, forward-only, reviewed changes** (the Flyway/Rails-migration discipline),
**WORM (Write-Once-Read-Many) / append-only immutability** for records that must not be altered
after creation (the model behind regulated evidence stores and object-lock storage), and an
explicit **data-retention policy** that names how long each class of data is kept and enforces
disposal. For a CUI-handling product the integrity and retention requirements are not optional
niceties: an evidence record whose bytes can change silently, or a tenant whose data can be read
under another tenant's scope, is a disqualifying defect, not a bug. The failure modes this spec
prevents are scattered ad hoc persistence, undocumented schema drift, "retention" that is a field
nobody enforces, and tenant resolution so ambiguous that a query can leak across boundaries.

## Requirements

- **SPEC-11.R1 — Single persistence layer per data domain.** `[L2]`
  All reads and writes for a given data domain go through one persistence module/repository, not
  scattered direct DB handles, ad hoc file writes, or duplicated query logic across modules.
  *Verify:* a grep/lint finds no direct database-driver or raw-file-store access outside the
  designated persistence layer (e.g., no `new Database(...)` / raw connection opens in feature code);
  all callers depend on the repository abstraction. Asserted by a structure test.

- **SPEC-11.R2 — Schema changes are versioned migrations.** `[L2]`
  Every change to persisted schema (tables, columns, indexes, on-disk artifact layout) is a numbered,
  ordered, forward-only migration checked into the repo and applied by a single documented command;
  no schema is changed by hand in a live store. *Verify:* a migrations directory/manifest exists with
  monotonically ordered entries; a test applies all migrations from empty to head successfully and
  asserts the resulting schema matches what the code expects (round-trips). Re-running the command is
  idempotent.

- **SPEC-11.R3 — Integrity: records requiring it carry a content hash.** `[L2]`
  Any record class designated integrity-critical (evidence, audit entries, assessment
  determinations) stores a content hash (e.g., SHA-256 of the canonical payload) computed at write
  time, so tampering is detectable. *Verify:* a test creates such a record, reads it back, recomputes
  the hash over the canonical content, and asserts it matches the stored hash; mutating the content
  without updating provenance is detectable by re-verification.

- **SPEC-11.R4 — Immutability/append-only where required (WORM intent).** `[L3]`
  Integrity-critical records are append-only: once written they are not updated or deleted through
  the normal data path; corrections are new versioned records that supersede, not in-place edits.
  *Verify:* machine-enforced — the repository exposes no update/delete for the WORM record class (or
  guards it behind an explicit, audited administrative path), and a test asserting that an
  attempted in-place mutation of a committed evidence record is rejected/throws. Where backed by
  storage that supports object-lock, the lock is asserted as configured.

- **SPEC-11.R5 — Retention policy is declared and enforced.** `[L2]`
  Each data class has a stated retention period, and disposal/expiry is actually executed by code on
  a schedule or lifecycle rule — retention is not a documentation-only or unused field. *Verify:* the
  retention period is defined in config/schema **and** a test demonstrates the enforcement path (a
  record past its retention window is disposed/flagged by the retention job); a "retention" field
  that is written but never read by any enforcement code fails this requirement.

- **SPEC-11.R6 — Tenant isolation is enforced on every access.** `[L3]`
  Every read and write is scoped to a tenant, and the persistence layer rejects an access with a
  missing/empty scope rather than defaulting to "all tenants." Cross-tenant reads are impossible
  through the normal data path. *Verify:* machine-enforced — a test asserts the repository throws on
  empty/absent scope, and a test seeds two tenants and asserts tenant A's scoped query returns zero
  of tenant B's rows. The scope guard cannot be bypassed by feature code (follows from R1).

- **SPEC-11.R7 — Tenant resolution has one unambiguous, documented order.** `[L2]`
  The precedence for resolving the active tenant (e.g., authenticated identity → explicit request
  parameter → configured default) is defined in exactly one place, documented, and applied
  consistently; there is no per-endpoint confusion among env, config file, query string, and request
  body. *Verify:* a single resolver function is the sole source of the active scope; a test covers the
  precedence order and asserts an unresolvable request is rejected, not silently defaulted. Grep shows
  no endpoint reading tenant from an out-of-policy source.

- **SPEC-11.R8 — Backups/exports are consistent and restorable.** `[L2]`
  The persisted store can be captured (backup/export) and restored to a working state, and the
  procedure is documented; integrity-critical records survive a backup→restore round-trip with hashes
  intact. *Verify:* a documented backup/restore (or export/import) procedure exists (cross-ref
  SPEC-12.R6) and a test/exercise restores a captured store and re-verifies R3 hashes post-restore.

## Anti-patterns

- **Scattered persistence.** Feature modules open their own DB connections or write artifact files
  directly, so there is no single choke point to enforce scope, hashing, or retention.
- **Hand-edited schema / phantom migrations.** The live schema drifts from what any migration
  describes; a column exists that no migration created, so a fresh build cannot reproduce production.
- **Retention field present but not enforced.** Records carry a `retentionUntil`/`retention` value
  that no job ever reads — the policy is theater; data is kept forever or disposed by nobody.
- **Mutable evidence.** An "evidence" or "audit" record can be updated in place, so its content hash
  (if any) is recomputed on edit and tampering is undetectable — WORM in name only.
- **Ambiguous tenant resolution.** One endpoint reads tenant from the query string, another from the
  request body, another from an env var; precedence is undefined, and a crafted request can land in
  the wrong tenant's data.
- **Scope defaults to global.** A missing scope silently means "all tenants" instead of an error,
  turning one forgotten filter into a cross-tenant leak.
- **Unrestorable backup.** Backups are taken but never test-restored; the first real restore reveals
  they are corrupt, partial, or missing the blob artifacts that pair with the DB rows.

## Conformance checklist

- [ ] Do all reads/writes for each domain go through a single persistence layer, with no raw DB/file
  access in feature code? (R1)
- [ ] Are all schema changes numbered forward-only migrations that apply empty→head in a test? (R2)
- [ ] Do integrity-critical records carry a write-time content hash that re-verifies on read? (R3)
- [ ] Are evidence/audit records append-only, with in-place mutation rejected and asserted by a test?
  (R4)
- [ ] Is a retention period declared per data class **and** enforced by a demonstrated disposal path?
  (R5)
- [ ] Does the repository throw on empty scope, and does a two-tenant test prove no cross-tenant
  reads? (R6)
- [ ] Is tenant resolution defined in one documented resolver with a tested precedence order and no
  out-of-policy sources? (R7)
- [ ] Does a backup→restore round-trip produce a working store with integrity hashes intact? (R8)

## CES profile hooks

CES tightens this dimension to **L3-mandatory** because it is a CUI-handling, CMMC L2 product;
evidence integrity is the core value proposition, not a feature.

- **Tighten — R3/R4 to L3, evidence WORM required.** All CES evidence records (Stamper artifacts,
  EO assessment determinations, AO audit entries) MUST carry a content hash and MUST be append-only.
  Corrections are superseding versions, never edits. This maps to CES goals **G10 (WORM intent)** and
  **G11 (Key Vault signing)** — hashing + signing together make tampering detectable and
  attributable. In-place mutation of a committed evidence record must throw, asserted by a test.
- **Tighten — R5 retention = 6 years for CUI.** CES sets the retention period for CUI-classed
  evidence to **6 years** and requires the enforcement path to exist (lifecycle/disposal job), not
  merely a stored field. The period is cited in config, not hardcoded ad hoc.
- **Tighten — R6/R7 to L3, isolation is non-negotiable.** CES `CesRepository` already throws on empty
  scope; the profile makes the two-tenant no-leak test (R6) and the single documented resolver (R7) a
  hard gate. The tenant-tests EUT suite is the enforcement surface.
- **Acknowledge (pre-SaaS scope):** at-scale isolation (DB-per-tenant vs. row-level in a server
  RDBMS) and per-tenant cloud WORM storage are **deferred** per `docs/saas-readiness.md`; today's
  operator-local SQLite `ces.db` + local blob store satisfies R1–R8 at single-operator scale. The
  L3 integrity/isolation requirements above still apply to that local store.
- **Waive:** none. Integrity, retention, and isolation are mandatory in every deployment posture.
