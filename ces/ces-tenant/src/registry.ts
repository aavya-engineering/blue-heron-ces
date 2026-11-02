// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TENANT-2026A
// See LICENSE and TERMS.md.

/**
 * TenantManager registry record shape.
 *
 * M0 — interface definition only, no behavior change (design §5). This codifies
 * Stamper's CURRENT tenant-record shape plus the `kind` discriminator design §2.1
 * says does not exist anywhere in the codebase today ("Current state has no
 * discriminator at all... This is a real gap the package must close, not an
 * existing feature to preserve").
 *
 * Source of the non-`kind` fields: `ces-shared/src/config/TenantConfig.ts:15-49`
 * (the `TenantConfig` interface loaded by `loadTenantConfig()`,
 * `ces-shared/src/config/TenantConfig.ts:68-136`, from tenant JSON files at
 * `<slug>.json`). That loader reads `client.slug`, `tenant.tenant_id`,
 * `auth.app_id`, `auth.cert_path`, `auth.cert_thumbprint`, `tenant.domain`,
 * `endpoints`, `subscription`, `resources`, `evidence_storage`, plus
 * Stamper-only optional fields (`client.name`, `stack`, `infrastructure_model`,
 * `excluded_entries`).
 */

/**
 * First-class sim/live discriminator. Does not exist in any current tenant
 * record (design §2.1) — sim-ness today is purely an out-of-band property of
 * whether `enableStacksimMode()` mutated `process.env` before the process
 * started (`ces-stamper/src/core/StacksimMode.ts:103-131`). New metadata, not
 * preserved behavior: any migrated record missing `kind` is a migration bug,
 * not a valid state (design §2.1 point 3).
 */
export type TenantKind = 'live' | 'sim';

/**
 * Evidence/blob storage credentials embedded in a tenant record.
 * Source: `ces-shared/src/config/TenantConfig.ts:7-13` (`EvidenceStorageConfig`),
 * populated from tenant JSON's `evidence_storage` key
 * (`ces-shared/src/config/TenantConfig.ts:100-112`, secret-ref-resolved via
 * `resolveSecretRef()` — never a raw literal in the persisted config).
 */
export interface TenantEvidenceStorageProfile {
  account_name: string;
  account_key: string;
  container: string;
  base_path: string;
  blob_endpoint: string;
}

/**
 * Azure subscription binding for ARM-surface session types.
 * Source: `ces-shared/src/config/TenantConfig.ts:30-34`, populated from tenant
 * JSON's `subscription` key (`TenantConfig.ts:122-123`). Also independently
 * read as `subscription.subscription_id` by `SessionManager.buildConnectCommand()`
 * for the `azure` case via `this.config.subscriptionId`
 * (`ces-stamper/src/core/SessionManager.ts:412-414`) and by
 * `PowerShellAdapter.buildGCCHighConnection()`'s Az branch
 * (`ces-stamper/src/adapters/PowerShellAdapter.ts:1585-1586`,
 * `this.config.subscriptionId`).
 */
export interface TenantSubscriptionProfile {
  subscription_id: string;
  resource_group: string;
  location: string;
}

/**
 * In-scope boundary for a CMMC assessment. RATIFIED AMENDMENT (founder,
 * 2026-07-26) — GP-SHARED-M0-1 ces-tenant half, mirroring
 * `ces-shared/src/config/TenantConfig.ts` (`AssessmentScope`), filed by
 * ces-ao `G-AO-CMMC-BOUND-1` M0.
 */
export interface AssessmentScope {
  subscriptionIds?: string[];
  resourceGroups?: string[];
  ous?: string[];
}

/**
 * CUI boundary: resource allowlist or tag-based match, consumed by ces-ao
 * ParameterMapper. RATIFIED AMENDMENT (founder, 2026-07-26) — GP-SHARED-M0-1
 * ces-tenant half, mirroring `ces-shared/src/config/TenantConfig.ts`
 * (`CuiBoundary`).
 */
export interface CuiBoundary {
  resourceAllowlist?: string[];
  tagKey?: string;
  tagValue?: string;
}

/**
 * Registry record for one tenant. Fields through `resources`/`evidenceStorage`
 * mirror `ces-shared/src/config/TenantConfig.ts:15-50` verbatim (current
 * behavior, no change); `kind` is the new discriminator (design §2.1).
 *
 * Credential fields are references only (thumbprint, cert path, app/tenant
 * IDs) — never raw secret material, matching current practice: no
 * `TenantConfig` consumer persists a raw secret to the tenant JSON file
 * (design §2.3, "Store credential references only").
 */
export interface TenantRegistryRecord {
  /** `client.slug` in tenant JSON — `ces-shared/src/config/TenantConfig.ts:75`. */
  tenantSlug: string;

  /**
   * `tenant.tenant_id` — `ces-shared/src/config/TenantConfig.ts:76`. Consumed
   * by `SessionManager.buildConnectCommand()`'s `-TenantId` param on every
   * session type except `sharepoint`, where it is still used
   * (`ces-stamper/src/core/SessionManager.ts:423`, `-TenantId "${tid}"`).
   */
  tenantId: string;

  /**
   * `auth.app_id` — `ces-shared/src/config/TenantConfig.ts:77`. Consumed as
   * `-ClientId`/`-AppId`/`-ApplicationId` depending on cmdlet, in
   * `SessionManager.buildConnectCommand()`
   * (`ces-stamper/src/core/SessionManager.ts:403-427`).
   */
  appId: string;

  /**
   * `auth.cert_path` — `ces-shared/src/config/TenantConfig.ts:78`. Present in
   * the schema but NOT read by `SessionManager.buildConnectCommand()` itself
   * (design §2.3) — cert lookup is delegated to each PowerShell module's own
   * `CurrentUser\My` cert-store resolution
   * (`ces-stamper/src/core/SessionManager.ts` ~418-423 doc comment).
   */
  certPath: string;

  /**
   * `auth.cert_thumbprint` (secret-ref-resolved) —
   * `ces-shared/src/config/TenantConfig.ts:79`, resolution at
   * `ces-shared/src/config/TenantConfig.ts:108` (`resolveSecretRef(certThumbprint).value`).
   * Consumed as `-CertificateThumbprint` by every `buildConnectCommand()` case
   * (`ces-stamper/src/core/SessionManager.ts:403-427`).
   */
  certThumbprint: string;

  /** `tenant.domain` — `ces-shared/src/config/TenantConfig.ts:81`. */
  domain: string;

  /**
   * Per-tenant endpoint table. Source shape:
   * `ces-shared/src/config/TenantConfig.ts:22-29`. Design §2.2 flags this
   * field as SCHEMA-ONLY today: `buildConnectCommand()` never reads
   * `tenantConfig.endpoints` — it uses hardcoded GCC High/USGov literals
   * instead (`SessionManager.ts:403-427`). Preserved here as-is (extraction,
   * not new scope); making `buildConnectCommand()` equivalents actually read
   * this table is out of M0's no-behavior-change gate.
   */
  endpoints: {
    graph: string;
    login: string;
    compliance_uri?: string;
    exchange_env?: string;
    azure_auth?: string;
    arm?: string;
  };

  /** `subscription` — `ces-shared/src/config/TenantConfig.ts:30-34`. Optional: absent for m365-only tenants (mirrors `tenant-stacksim/src/config/SimTenantConfig.ts:73-81`, `m365_only` profile omits it). */
  subscription?: TenantSubscriptionProfile;

  /** Convenience-flattened `subscription.subscription_id` — `ces-shared/src/config/TenantConfig.ts:35`, read directly by `SessionManager.buildConnectCommand()`'s `azure` case (`SessionManager.ts:412`). */
  subscriptionId?: string;

  /** Placeholder-substitution values for endpoint templates — `ces-shared/src/config/TenantConfig.ts:36`, consumed by `resolveEndpointVariables()` (`TenantConfig.ts:56-61`). */
  resources?: Record<string, string>;

  /** Evidence/blob storage credentials — `ces-shared/src/config/TenantConfig.ts:37`. Out of TenantManager's scope fence per design §3 ("No evidence storage... TenantManager's registry is about who/how to connect, not where evidence artifacts land") — preserved here only because it is part of the CURRENT `TenantConfig` shape being extracted verbatim; not to be read/written by TenantManager's own logic. */
  evidenceStorage?: TenantEvidenceStorageProfile;

  /** `client.name` — `ces-shared/src/config/TenantConfig.ts:40`, Stamper-only optional field. */
  clientName?: string;

  /** Active stack id (multi-stack selector) — `ces-shared/src/config/TenantConfig.ts:41-45`. Absent implies the Microsoft/GCC High reference stack. */
  stack?: string;

  /** @deprecated Fallback only — `ces-shared/src/config/TenantConfig.ts:46-47`. Prefer the Infrastructure Manifest artifact's `infrastructure_model` when available. */
  infrastructure_model?: 'm365_only' | 'm365_sentinel' | 'm365_azure';

  /** `ces-shared/src/config/TenantConfig.ts:48`. */
  excluded_entries?: string[];

  /**
   * `tenant.domain`, duplicated under this name for callers that derive a
   * tenant short-name from it — `ces-shared/src/config/TenantConfig.ts:49`,
   * `ces-shared/src/config/TenantConfig.ts:132`
   * (`targetTenantDomain: raw.tenant?.domain`). Also independently read as
   * `this.config.targetTenantDomain` by `SessionManager.buildConnectCommand()`
   * to derive `tenantName` for the `sharepoint` case
   * (`ces-stamper/src/core/SessionManager.ts:397-399`,
   * `targetTenantDomain.split('.')[0]`).
   */
  targetTenantDomain?: string;

  // --- CMMC scoping fields — RATIFIED AMENDMENT (founder, 2026-07-26) ---
  // GP-SHARED-M0-1 ces-tenant half (the M0 mirror), filed by ces-ao
  // G-AO-CMMC-BOUND-1 M0. Raw tenant-JSON keys are snake_case
  // (`cmmc_level`, `assessment_scope`, `cui_boundary`) per the file's
  // existing convention; parsing is fail-closed on malformed values and
  // absent values stay `undefined` (pre-migration records load unchanged).
  // Load-time partial-config rejection (Case B): `cmmcLevel` set with
  // `cuiBoundary` absent is refused by `parseTenantRecord()` — see
  // `impl/tenant-file.ts`.

  /**
   * Optional for backward compatibility: absent ⇒ pre-migration tenant.
   * Consumers (ces-ao CmmcScopeGate) fail open with a warning during
   * Phase 1 and fail closed in Phase 2.
   */
  cmmcLevel?: 'L1' | 'L2';
  assessmentScope?: AssessmentScope;
  cuiBoundary?: CuiBoundary;

  /**
   * Migration-exemption marker (informal convention promoted to a typed
   * field here — G-AO-CMMC-BOUND-1 M0 memo addendum): `true` excludes this
   * record from the Phase-2 flip denominator (`migrated / (total - exempt)`),
   * e.g. a deprecated/archival tenant that will never migrate. Raw JSON key:
   * `cmmc_migration_exempt` (snake_case convention) or a literal top-level
   * `cmmcMigrationExempt` — both are honored.
   */
  cmmcMigrationExempt?: boolean;

  /**
   * Sim/live discriminator (design §2.1). NEW field — not present in any
   * current `TenantConfig`/tenant-JSON shape. Every migrated record must be
   * stamped `'live'` unless sourced from `tenant-stacksim`'s emitted config
   * (`tenant-stacksim/src/config/SimTenantConfig.ts:123-145`,
   * `writeSimTenantConfig()`), in which case `'sim'` (design §2.1 point 3).
   * This is the field that makes the existing A9 hazard
   * (`tenant-stacksim/BACKLOG.md:40,43` — sim and live configs colliding in
   * `~/.stamper/tenants/` with zero way to disambiguate) structurally
   * closeable at the registry level (design §2.1 hazard note, §7 "A9
   * migration").
   *
   * G7 confirmation (G-AO-CMMC-BOUND-1 M0, confirmed 2026-07-26): this field
   * is surfaced GENERICALLY by the registry API — every record returned by
   * `get()` / `listByKind()` carries it, in both library mode
   * (`FileTenantRegistry`) and service mode (`GET /api/tenants[...]`; the
   * wire redaction strips only `evidenceStorage`). It is not private to the
   * stacksim subsystem; no schema change was needed.
   */
  kind: TenantKind;
}

/**
 * Registry lifecycle + query surface — covers ces-tester as a NAMED consumer
 * (not a future footnote), per founder direction 2026-07-10 folded into this
 * M0 deliverable. Source: `ces-tester/PLAN.md`.
 *
 * ces-tester's M1 orchestrator materializes a scenario's `stacksim_seed`
 * block, invokes `stacksim scenario <name> --scenarios-dir <tempdir>
 * [--slug]`, then launches Stamper against the resulting sim tenant
 * (`ces-tester/PLAN.md` Interface Contract Summary table, rows 1/3/4; M1
 * tasks 2 and 4). Today that lifecycle bypasses any registry entirely —
 * stacksim's `init-tenant`/`scenario` CLI writes tenant JSON directly
 * (`ces-tester/PLAN.md` M0 items citing STACKSIM_INVENTORY §5 item 1, S1/S2),
 * and cleanup is a manually-tracked task ("this task includes
 * deleting/resetting the sim tenant's entry under `~/.stamper/tenants/`
 * after each M1 run, rather than leaving it to be inferred" —
 * `ces-tester/PLAN.md` M1 task 4) until stacksim's S3 fix lands
 * (`ces-tester/PLAN.md` M0 preconditions gate, S3: "config isolation for
 * `init-tenant`... `TenantProbe` has no directory override — inventory A9").
 * This is the same A9 hazard design §2.1 already names; expressing
 * create/query/teardown as a registry interface is the structural fix S3
 * asks for, seen from ces-tester's orchestrator side.
 */
export interface TenantRegistryLifecycle {
  /**
   * Create an ephemeral `kind: 'sim'` tenant from an embedded seed/scenario
   * reference, for one orchestrator run. Mirrors ces-tester's M1 task 2
   * materialize-and-invoke path (write the scenario's `stacksim_seed` block
   * to a temp scenario file, then `stacksim scenario <name> --scenarios-dir
   * <tempdir> [--slug]` — `ces-tester/PLAN.md` M1 task 2) and M1 task 4's
   * `init-tenant`-emitted-slug handoff to the Stamper launcher. The `seed`
   * parameter is intentionally opaque to this interface — ces-tester owns
   * its own scenario JSON format (`ces-tester/PLAN.md` Scenario Schema
   * Skeleton); TenantManager only needs a reference to it, not its shape
   * (design §3 scope fence — no scenario/business logic belongs here).
   */
  createEphemeralSimTenant(slug: string, seedRef: unknown): Promise<TenantRegistryRecord>;

  /**
   * Tear down / wipe an ephemeral sim tenant's registry entry after a run.
   * Mirrors ces-tester's "ces-tester wipes per run" requirement and the
   * documented manual-cleanup step pending stacksim's S3
   * (`ces-tester/PLAN.md` M1 task 4) — this method is what makes that
   * cleanup a first-class registry operation instead of an inferred,
   * hand-run step. Must leave no residue: a torn-down slug must not be
   * returned by `listByKind('sim', ...)` afterward.
   */
  teardownEphemeralSimTenant(slug: string): Promise<void>;

  /**
   * Query a single record by slug, regardless of kind.
   */
  get(slug: string): Promise<TenantRegistryRecord | undefined>;

  /**
   * List/filter registry records by `kind`. Source of the invariant this
   * method exists to enforce: ces-tester's orchestrator "must never
   * accidentally target a live tenant" (founder direction, 2026-07-10) when
   * it lists sim tenants for cleanup/reset between scenario runs — the same
   * A9 collision hazard design §2.1 documents (sim and live records
   * indistinguishable except by filename convention, zero `kind` field
   * today). Implementations MUST filter strictly on the stamped `kind`
   * field, never on naming convention or directory location, so a
   * mis-filed live record can never be silently swept up by a sim-only
   * cleanup pass.
   */
  listByKind(kind: TenantKind): Promise<TenantRegistryRecord[]>;
}
