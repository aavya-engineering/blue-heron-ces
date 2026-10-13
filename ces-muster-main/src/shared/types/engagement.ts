// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

export type EngagementKind = 'prime_and_subs' | 'individual_contractor';

export interface Engagement {
  id: string;
  engagement_kind: EngagementKind;
  created_at: string;
}

export interface AssessedParty {
  id: string;
  engagement_id: string;
  name: string;
  uei?: string;
  cage?: string;
  on_prem_ot: 'yes' | 'no' | 'unsure';
  created_at: string;
  /**
   * G-MUSTER-PL-1 C3: the three AssessmentPage profile answers, persisted with
   * the party so they survive reload (resume restores them) and reach the
   * exported StatusPayload. Optional — only written when the operator answered.
   * Non-indexed; no Dexie version bump needed.
   */
  employee_count?: '<50' | '50-250' | '250+';
  has_ssp?: 'yes' | 'no' | 'unsure';
  covers_m365?: 'yes' | 'no';
}

/**
 * G-MUSTER-GO-2 (Q4/Q6 decision: EXTEND the existing store, one provenance model).
 * The named-human attestation that converts a drafted fact into one that counts.
 * Rendered as "drafted by [source], confirmed by [name] on [date]" (M4 exact-string
 * gate). A fact with a draft provenance and NO attestation is an unconfirmed draft:
 * it prunes/defers questions but NEVER contributes to a score (drafts prune, never
 * pass; unknown still never prunes, never passes).
 */
export interface FactAttestation {
  drafted_by: string;
  confirmed_by: string;
  confirmed_on: string;
}

export interface InterviewFact {
  question_id: string;
  question_text: string;
  answer: string;
  provenance: string;
  confidence: 'high' | 'medium' | 'low' | 'unknown';
  recorded_at: string;
  /** Present only once a named human confirms a drafted fact (GO-2 M4). */
  attestation?: FactAttestation;
  /** FC-MU-3: where an auto-detected answer came from (e.g. 'graph:conditionalAccess'). */
  source?: string;
}

export type TimingSegmentName = 'setup' | 'interview' | 'verification' | 'review';

export interface TimingSegment {
  segment: TimingSegmentName;
  started_at: string;
  stopped_at?: string;
  duration_ms?: number;
}

export interface PreambleSnapshot {
  license_tier: string;
  security_archetype: string;
  endpoint_management: string;
  monitoring_siem: string;
  policy_doc_state: string;
}

/**
 * READINESS-1 M2: the Situation-tab readiness manifest capture. Flat strings
 * here (a Dexie-persisted record); the exporter shapes them into the
 * readiness-result.v1 manifest block. Enums mirror
 * shared/types/readinessResult.ts (ReadinessSessionMode / ReadinessAuthTier).
 */
export interface ReadinessManifestCapture {
  mode: 'self-hosted' | 'independent' | 'collaborative-bhd';
  auth_tier: 'device-code' | 'script-upload' | 'lite' | 'cert-app-only';
  tenant_slug: string;
  tenant_kind: 'live' | 'sim';
  operator_name: string;
  operator_role: string;
  bhd_name?: string;
}

export interface InterviewSession {
  id: string;
  party_id: string;
  facts: InterviewFact[];
  timing_segments: TimingSegment[];
  status: 'in_progress' | 'complete';
  created_at: string;
  completed_at?: string;
  preamble?: PreambleSnapshot;
  /** Stack tiles declared in the service-inventory step — drives the preamble mapper. */
  selected_stacks?: string[];
  /** Persisted question index — enables mid-interview resume after page reload. */
  current_question_index?: number;
  /**
   * READINESS-1 M2: the discovery rows this session's facts were synthesized
   * from (fixture run or imported results file) — the readiness exporter's
   * observations[] source. Non-indexed; no Dexie version bump needed.
   */
  discovery_results?: import('./discovery').DiscoveryResult[];
  /**
   * DISCOVERY-1: the FULL observation rows produced by the muster-api discovery
   * executor (registry walk against a live/sim tenant session) — carrying the
   * real ran_entry_ids, raw_capture_ref, and executor-derived_posture that the
   * thin discovery_results shape cannot. When present, the readiness exporter
   * uses these verbatim instead of synthesizing observations from
   * discovery_results (which stubs ran_entry_ids: [] and posture-from-confidence).
   * Non-indexed; no Dexie version bump needed.
   */
  discovery_observations?: import('./readinessResult').ReadinessObservation[];
  /** READINESS-1 M2: Situation-tab manifest capture (see type above). */
  readiness_manifest?: ReadinessManifestCapture;
  /**
   * FC-MU-3: the live device-code consents of the discovery run this session
   * was built from (an imported / API-run readiness record). The exporter
   * writes them back as manifest.consent / manifest.consents. Non-indexed.
   */
  live_consents?: import('./readinessResult').ReadinessConsent[];
  /**
   * FC-MU-2 (MS-5): provisioning inputs too large or too structured for a fact.
   * The terms-of-use PDF lives here (the fact TCP.MU.002 records only its name +
   * sha256). The generated initial password is NEVER stored — anywhere.
   * Non-indexed; no Dexie version bump needed.
   */
  provisioning_inputs?: {
    tou_file?: { name: string; base64: string; sha256: string; size: number };
  };
}

export interface Sub {
  id: string;
  engagement_id: string;
  name: string;
  uei?: string;
  cage?: string;
}

/**
 * An answer queued for sync while in adaptive mode with no server connection.
 * Stored in Dexie 'queued_answers' (v2 schema).
 */
export interface QueuedAnswer {
  id: string;
  session_id: string;
  question_id: string;
  answer: string;
  recorded_at: string;
  /** 0 = unsynced, 1 = synced */
  synced: 0 | 1;
}

/**
 * Contract entity — 14 named fields. [validate with BHD]
 * For individual_contractor engagements, prime_ref is null (party IS the contractor).
 */
export interface Contract {
  id: string;
  contract_number: string;          // required
  program_name: string;             // required
  cmmc_level_required: 1 | 2 | 3;  // required
  party_id: string;
  prime_ref: string | null;         // null for individual_contractor
  start_date?: string;
  end_date?: string;
  value_usd?: number;
  cage_code?: string;
  uei?: string;
  contracting_office?: string;
  classification_level?: string;
  notes?: string;
}
