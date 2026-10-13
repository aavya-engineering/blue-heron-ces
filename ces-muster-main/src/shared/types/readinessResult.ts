// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// readiness-result.v1 — TypeScript mirror of public/schemas/readiness-result.schema.json.
// G-MUSTER-READINESS-1 M1 (spec: docs/design/readiness-result-v1.md).
//
// Design rule (master plan appendix, muster-modes lane sec. 1): the payload IS the
// import-file format. One schema serves four producers — canned fixture, admin-run
// script upload (GO-2 M3), ces-tester run, and a BHD-run readiness session handed to
// plan-mode. No second format ever.

import type { EngagementKind, FactAttestation, InterviewFact } from './engagement';
import type { SprsResult } from '@/features/scoring/sprsCalc';

/** The three session kinds — founder-directive verbatim (VAULT.md). */
export type ReadinessSessionMode = 'self-hosted' | 'independent' | 'collaborative-bhd';

/**
 * Auth ladder tier achieved during the session — "the auth tier achieved is itself
 * provenance" (residual-elicitation-ladder.md).
 */
export type ReadinessAuthTier = 'device-code' | 'script-upload' | 'lite' | 'cert-app-only';

/**
 * The M365 tenant the session observed, in ces-tenant registry semantics.
 * NAME COLLISION (documented per the lane analysis): this is NOT muster-api's SaaS
 * `Tenant` model (muster-api/prisma/schema.prisma) — it is the ces-tenant registry
 * record { slug, kind }, where sim and live are the same code path.
 */
export interface ReadinessTenantRef {
  slug: string;
  kind: 'live' | 'sim';
}

export interface ReadinessManifest {
  mode: ReadinessSessionMode;
  auth_tier: ReadinessAuthTier;
  tenant: ReadinessTenantRef;
  operator: { name: string; role: string };
  /** Present only for collaborative-bhd sessions. */
  bhd_presence?: { name: string };
  engagement_id: string;
  party_id: string;
  engagement_kind: EngagementKind;
  started_at: string;
  completed_at?: string;
  /** FC-MU-2: the customer's consent for a LIVE device-code run (absent on sim runs).
   * With several consents (FC-MU-3), this is the Graph one. */
  consent?: ReadinessConsent;
  /** FC-MU-3 (1.1.0): every live consent the run used, one per area. */
  consents?: ReadinessConsent[];
}

/** FC-MU-3: the Microsoft surface a live device-code consent covers. */
export type LiveConsentArea = 'graph' | 'exchange' | 'purview' | 'azure' | 'teams';

/** FC-MU-2: who consented, when, to which read-only scopes, for which tenant. */
export interface ReadinessConsent {
  consented_by: string;
  consented_at: string;
  scopes: string[];
  tenant_id: string;
  auth_tier: 'device-code';
  client_id?: string;
  /** FC-MU-3: which area the consent covers (absent on FC-MU-2 records = graph). */
  area?: LiveConsentArea;
  /** FC-MU-5: the reader roles proven at consent time (non-Graph areas). */
  reader_roles?: string[];
  /** FC-MU-5: the Azure subscription the reader check covered. */
  subscription_id?: string;
}

/** Objective coverage bucket per the 2026-07-10 coverage dataset (planner_gen2_feed). */
export type ObjectiveCoverageBucket = 'A' | 'B' | 'C';

/**
 * One per-control observation row: the shipped DiscoveryResult shape
 * (src/__fixtures__/discoveryResults.ts) extended with execution provenance.
 */
export interface ReadinessObservation {
  control_id: string;
  objective_ids: string[];
  confidence: 'high' | 'medium' | 'low' | 'unknown';
  /** Registry entry ids actually run for this row (e.g. "tenant:AC.L2-3.1.1.operator-discover"). */
  ran_entry_ids: string[];
  /** Pointer (path/hash) to captured command output. Raw output is NEVER inline. */
  raw_capture_ref?: string;
  derived_posture: 'met' | 'not_met' | 'partial' | 'unknown';
  /** Per-objective bucket, e.g. { "AC.L1-3.1.1[a]": "A" }. */
  objective_coverage?: Record<string, ObjectiveCoverageBucket>;
  /** EMX archetype names verbatim from planner_gen2_feed residual_documentary_must_have. */
  residual_must_have?: string[];
}

/**
 * GO-2 M4 attestation extension — THE shared FactAttestation model
 * (src/shared/types/engagement.ts), re-exported so the payload mirror and the
 * live fact store cannot drift. All three fields are REQUIRED when an
 * attestation is present: a partial attestation is not an attestation
 * (unconfirmed drafts simply omit the object). The rendered record reads
 * "drafted by [source], confirmed by [name] on [date]"; unconfirmed drafts
 * stay drafts everywhere, including readiness math (drafts prune, never pass).
 */
export type ReadinessFactAttestation = FactAttestation;

export interface ReadinessFact extends InterviewFact {
  attestation?: ReadinessFactAttestation;
}

export interface ReadinessGap {
  requirement_id: string;
  weight: number;
  /** Registry entries whose set_command is the fix path (may be empty when fixable = manual). */
  fix_entry_ids: string[];
  fixable: 'registry' | 'manual';
}

export interface ReadinessDerived {
  /**
   * One-SPRS rule: computeSprs (src/features/scoring/sprsCalc.ts) is the only source of
   * the number, counting only attested/observed non-draft facts.
   */
  sprs_now: SprsResult;
  gaps: ReadinessGap[];
  /**
   * The SAME calculator re-run with every registry-fixable gap flipped to met.
   * A PROJECTION — must always render labeled as one.
   */
  sprs_after: number;
}

export interface ReadinessProvenance {
  /** Registry name -> version, e.g. { "cmmc-l2-commands": "..." }. */
  registry_versions: Record<string, string>;
  /** Coverage dataset id, e.g. "registry-objective-coverage-2026-07-10". */
  coverage_dataset: string;
  engine: { name: string; version: string };
  generated_at: string;
}

export interface ReadinessResult {
  /** FC-MU-3: 1.1.0 is written; 1.0.0 is still accepted on import. */
  schema_version: ReadinessSchemaVersion;
  manifest: ReadinessManifest;
  observations: ReadinessObservation[];
  /** Optional session facts; draft facts carry their draft provenance strings. */
  facts?: ReadinessFact[];
  derived: ReadinessDerived;
  provenance: ReadinessProvenance;
}

/** FC-MU-3: the readiness-record versions the importer accepts. */
export const READINESS_SCHEMA_VERSIONS = ['readiness-result/1.0.0', 'readiness-result/1.1.0'] as const;
export type ReadinessSchemaVersion = (typeof READINESS_SCHEMA_VERSIONS)[number];
/** FC-MU-3: the version every exporter writes. */
export const READINESS_SCHEMA_CURRENT: ReadinessSchemaVersion = 'readiness-result/1.1.0';
