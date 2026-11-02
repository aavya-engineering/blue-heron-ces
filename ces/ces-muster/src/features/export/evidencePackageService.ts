// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// Evidence package export — T3 slice.
// Builds a self-contained, provenance-complete evidence package, validates it
// against the committed JSON Schema, and triggers a browser download.
import Ajv from 'ajv';
import type { AssessedParty, InterviewSession } from '@/shared/types/engagement';
import type { ReadinessPosture } from '@/vendored/ces-spine/types/artifacts';
import schema from '../../../public/schemas/evidence-package.schema.json';

/** FCA-safe self-assessment disclaimer — identical to the text shown on ResultScreen. */
export const FCA_DISCLAIMER =
  'Self-assessed indicator — not a certification, not an SPRS submission, and not a quote-binding gap report.';

const ajvValidate = new Ajv({ strict: true }).compile(schema);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EvidencePackageFact {
  question_id: string;
  question_text: string;
  answer: string;
  provenance: string;
  confidence: 'high' | 'medium' | 'low' | 'unknown';
  recorded_at: string;
  source?: string;
}

export interface EvidencePackageArtifact {
  name: string;
  content_type: string;
  sha256: string;
  embedded_content?: string;
}

export interface EvidencePackage {
  package_version: '1.0';
  generated_at: string;
  party: { id: string; name: string; uei?: string; cage?: string };
  session_id: string;
  fca_disclaimer: string;
  facts: EvidencePackageFact[];
  posture_summary: {
    conservative_score: number;
    control_status_summary: {
      met: number;
      partial: number;
      not_met: number;
      unknown: number;
    };
  };
  sprs: { sprs: number; assessed_count: number } | null;
  artifacts: EvidencePackageArtifact[];
}

interface ArtifactInput {
  name: string;
  content_type: string;
  embedded_content?: string;
}

export interface BuildEvidencePackageParams {
  session: InterviewSession;
  party: AssessedParty;
  posture: ReadinessPosture;
  conservativeScore: number;
  sprs?: { sprs: number; assessed_count: number } | null;
  artifacts?: ArtifactInput[];
}

export interface ValidationResult {
  valid: boolean;
  errors?: unknown[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute a lowercase hex-encoded SHA-256 digest of the given UTF-8 string.
 * Uses the Web Crypto API (crypto.subtle) — available in browsers and Node 24+.
 */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

/**
 * Assemble an EvidencePackage from session data, posture results, and optional
 * artifacts. Artifact sha256 values are computed from embedded_content via
 * crypto.subtle; function is async for that reason.
 */
export async function buildEvidencePackage(
  params: BuildEvidencePackageParams
): Promise<EvidencePackage> {
  const { session, party, posture, conservativeScore, sprs = null, artifacts = [] } = params;

  const processedArtifacts: EvidencePackageArtifact[] = await Promise.all(
    artifacts.map(async (a) => {
      const hash = await sha256Hex(a.embedded_content ?? '');
      const artifact: EvidencePackageArtifact = {
        name: a.name,
        content_type: a.content_type,
        sha256: hash,
      };
      if (a.embedded_content !== undefined) {
        artifact.embedded_content = a.embedded_content;
      }
      return artifact;
    })
  );

  const summary = posture.ces.control_status_summary;

  return {
    package_version: '1.0',
    generated_at: new Date().toISOString(),
    party: {
      id: party.id,
      name: party.name,
      ...(party.uei ? { uei: party.uei } : {}),
      ...(party.cage ? { cage: party.cage } : {}),
    },
    session_id: session.id,
    fca_disclaimer: FCA_DISCLAIMER,
    facts: session.facts.map((f) => ({
      question_id: f.question_id,
      question_text: f.question_text,
      answer: f.answer,
      provenance: f.provenance,
      confidence: f.confidence,
      recorded_at: f.recorded_at,
    })),
    posture_summary: {
      conservative_score: conservativeScore,
      control_status_summary: {
        met: summary.met,
        partial: summary.partial,
        not_met: summary.not_met,
        unknown: summary.unknown,
      },
    },
    sprs: sprs ?? null,
    artifacts: processedArtifacts,
  };
}

/**
 * Validate an evidence package against the committed JSON Schema.
 * Same AJV idiom as statusPayloadService / exportWiring tests.
 */
export function validateEvidencePackage(pkg: unknown): ValidationResult {
  const valid = ajvValidate(pkg);
  if (valid) return { valid: true };
  return { valid: false, errors: ajvValidate.errors ?? [] };
}

/**
 * Build, validate, and trigger a browser download of the evidence package.
 * Throws if the assembled package fails schema validation — never exports
 * an invalid package.
 */
export async function exportEvidencePackage(params: BuildEvidencePackageParams): Promise<void> {
  const pkg = await buildEvidencePackage(params);
  const result = validateEvidencePackage(pkg);
  if (!result.valid) {
    throw new Error(
      `Evidence package validation failed: ${JSON.stringify(result.errors)}`
    );
  }
  const partySlug = params.party.name.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
  const date = new Date().toISOString().split('T')[0];
  const filename = `evidence-package-${partySlug}-${date}.json`;
  const json = JSON.stringify(pkg, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
