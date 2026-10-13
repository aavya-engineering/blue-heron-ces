// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// recipeIngestService.ts — recipe output → ConfigFacts ingestion pipeline.
//
// FCA guardrails (MUST NOT violate):
//   - Absence of a section in recipe output → ABSENT (no fact emitted, not 'no').
//   - A probed-and-negative result → 'no' fact.
//   - A probed-and-positive result → 'yes' fact.
//   - Unknown/unsure MUST NOT appear as a ConfigFact answer; use fact absence.
//
// Signature verification ALWAYS runs first. A tampered recipe (sha256 mismatch)
// results in no facts — error thrown, caller receives 0 facts.
//
// AJV deviation: muster-api/package.json does not include ajv. Rather than
// importing from root node_modules (breaks self-containment), validateConfigFact()
// is a typed structural validator. See IMPLEMENTATION_T1.md §Deviations.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RECIPES_DIR, verifyRecipe, type RecipeManifest } from '../lib/recipeSigning.js';

// ── ConfigFact type ───────────────────────────────────────────────────────────

/**
 * A fact produced by the recipe ingestion pipeline.
 * Schema: muster-api/schemas/config-fact.schema.json
 */
export interface ConfigFact {
  question_id: string;
  answer: 'yes' | 'no';
  provenance: 'captured';
  confidence: 'high';
  captured_at: string; // ISO 8601
  source: string;      // 'recipe:<name>@<version>'
}

/**
 * The exact property set config-fact.schema.json permits. Because the schema
 * declares `additionalProperties: false` and every property is `required`, the
 * permitted key set is exactly these six — used to enforce the closed-object
 * rule below. Kept adjacent to the checks so a schema property change surfaces
 * here too.
 */
export const CONFIG_FACT_KEYS = [
  'question_id',
  'answer',
  'provenance',
  'confidence',
  'captured_at',
  'source',
] as const;

/**
 * Typed structural validator for ConfigFact — the single runtime enforcer.
 *
 * Provably agrees with config-fact.schema.json (G-MUSTER-PL-1 H1): the
 * schema↔validator agreement is proven both ways over fixtures in
 * tests/configFact.schema-validator-parity.test.ts. This is the permanent
 * design — muster-api stays self-contained (no ajv runtime dependency); the
 * hand-rolled validator is the deviation, now closed by the parity test rather
 * than carried as an open `[validate with BHD]` tag (checklist row 16).
 *
 * Returns true iff obj satisfies the ConfigFact shape, false otherwise. Enforces
 * every schema keyword the schema declares: required, per-property type/enum/
 * const/minLength, AND `additionalProperties: false` (unknown keys rejected).
 */
export function validateConfigFact(obj: unknown): obj is ConfigFact {
  if (typeof obj !== 'object' || obj === null) return false;
  const f = obj as Record<string, unknown>;
  if (typeof f['question_id'] !== 'string' || f['question_id'].length === 0) return false;
  if (f['answer'] !== 'yes' && f['answer'] !== 'no') return false;
  if (f['provenance'] !== 'captured') return false;
  if (f['confidence'] !== 'high') return false;
  if (typeof f['captured_at'] !== 'string' || f['captured_at'].length === 0) return false;
  if (typeof f['source'] !== 'string' || f['source'].length === 0) return false;
  // additionalProperties: false — no key outside the permitted set may appear.
  for (const key of Object.keys(f)) {
    if (!(CONFIG_FACT_KEYS as readonly string[]).includes(key)) return false;
  }
  return true;
}

// ── SignatureError ────────────────────────────────────────────────────────────

export class SignatureError extends Error {
  constructor(reason: string) {
    super(`signature_invalid: ${reason}`);
    this.name = 'SignatureError';
  }
}

// ── Concrete mappers (one per recipe) ─────────────────────────────────────────
//
// Each mapper implements the FCA rules:
//   - If the relevant output section is absent → return null (no fact)
//   - If probed and positive → return fact with answer 'yes'
//   - If probed and negative → return fact with answer 'no'

function buildFact(
  questionId: string,
  answer: 'yes' | 'no',
  recipeName: string,
  version: string,
  capturedAt: string
): ConfigFact {
  return {
    question_id: questionId,
    answer,
    provenance: 'captured',
    confidence: 'high',
    captured_at: capturedAt,
    source: `recipe:${recipeName}@${version}`,
  };
}

/** entra-mfa-report → iam-001 */
function mapEntraMfaReport(
  output: unknown,
  recipeName: string,
  version: string,
  capturedAt: string
): ConfigFact | null {
  if (typeof output !== 'object' || output === null) return null;
  const o = output as Record<string, unknown>;

  // ABSENT: no conditionalAccessPolicies section
  if (!Array.isArray(o['conditionalAccessPolicies'])) return null;

  const policies = o['conditionalAccessPolicies'] as unknown[];
  const mfaEnabled = policies.some((p) => {
    if (typeof p !== 'object' || p === null) return false;
    const policy = p as Record<string, unknown>;
    if (policy['state'] !== 'enabled') return false;
    const gc = policy['grantControls'];
    if (typeof gc !== 'object' || gc === null) return false;
    const gcObj = gc as Record<string, unknown>;
    if (!Array.isArray(gcObj['builtInControls'])) return false;
    return (gcObj['builtInControls'] as unknown[]).includes('mfa');
  });

  return buildFact('iam-001', mfaEnabled ? 'yes' : 'no', recipeName, version, capturedAt);
}

/** defender-av-status → ep-002 */
function mapDefenderAvStatus(
  output: unknown,
  recipeName: string,
  version: string,
  capturedAt: string
): ConfigFact | null {
  if (typeof output !== 'object' || output === null) return null;
  const o = output as Record<string, unknown>;

  // ABSENT: required fields not present
  if (
    typeof o['AntivirusEnabled'] === 'undefined' ||
    typeof o['RealTimeProtectionEnabled'] === 'undefined'
  ) {
    return null;
  }

  const avEnabled = o['AntivirusEnabled'] === true;
  const rtpEnabled = o['RealTimeProtectionEnabled'] === true;

  return buildFact('ep-002', avEnabled && rtpEnabled ? 'yes' : 'no', recipeName, version, capturedAt);
}

/** bitlocker-status → dp-001 */
function mapBitlockerStatus(
  output: unknown,
  recipeName: string,
  version: string,
  capturedAt: string
): ConfigFact | null {
  // ABSENT: output is not an array
  if (!Array.isArray(output)) return null;

  const volumes = output as unknown[];

  // ABSENT: empty array — no volumes to assess (conservative: cannot confirm encryption)
  // Per FCA: absence of evidence never passes. We emit 'no' here because the recipe ran
  // (section present) but found no encrypted volumes.
  if (volumes.length === 0) {
    return buildFact('dp-001', 'no', recipeName, version, capturedAt);
  }

  const allEncrypted = volumes.every((v) => {
    if (typeof v !== 'object' || v === null) return false;
    const vol = v as Record<string, unknown>;
    return vol['VolumeStatus'] === 'FullyEncrypted' && vol['ProtectionStatus'] === 'On';
  });

  return buildFact('dp-001', allEncrypted ? 'yes' : 'no', recipeName, version, capturedAt);
}

// ── Mapper dispatch ───────────────────────────────────────────────────────────

type Mapper = (
  output: unknown,
  recipeName: string,
  version: string,
  capturedAt: string
) => ConfigFact | null;

const MAPPERS: Record<string, Mapper> = {
  'entra-mfa-report': mapEntraMfaReport,
  'defender-av-status': mapDefenderAvStatus,
  'bitlocker-status': mapBitlockerStatus,
};

// ── ingest ────────────────────────────────────────────────────────────────────

export interface IngestParams {
  recipeName: string;
  output: unknown;        // parsed JSON from recipe script stdout
  manifest: RecipeManifest; // read from disk by the caller (route handler)
}

/**
 * Ingests recipe output into ConfigFacts.
 *
 * Flow:
 *   1. Read the recipe script from disk.
 *   2. Verify sha256(script) === manifest.sha256 — throw SignatureError if not.
 *   3. Dispatch to per-recipe mapper.
 *   4. Validate each produced fact with validateConfigFact — throw if invalid.
 *   5. Return the fact array (may be empty if all mappings returned ABSENT).
 *
 * @throws SignatureError if the recipe script hash does not match manifest.sha256
 * @throws Error if a produced fact fails schema validation (programming bug)
 */
export function ingest({ recipeName, output, manifest }: IngestParams): ConfigFact[] {
  // Step 1 & 2: signature verification
  const recipeDir = join(RECIPES_DIR, recipeName);
  const scriptPath = join(recipeDir, 'recipe.ps1');
  let scriptContent: Buffer;
  try {
    scriptContent = readFileSync(scriptPath);
  } catch {
    // Try .sh fallback
    scriptContent = readFileSync(join(recipeDir, 'recipe.sh'));
  }

  const verify = verifyRecipe({ script: scriptContent, manifest });
  if (!verify.valid) {
    throw new SignatureError(verify.reason ?? 'unknown reason');
  }

  // Step 3: map output → facts
  const mapper = MAPPERS[recipeName];
  if (!mapper) {
    // Unknown recipe — no facts, not an error (conservative)
    return [];
  }

  const capturedAt = new Date().toISOString();
  const fact = mapper(output, recipeName, manifest.version, capturedAt);
  const facts: ConfigFact[] = fact !== null ? [fact] : [];

  // Step 4: validate each fact
  for (const f of facts) {
    if (!validateConfigFact(f)) {
      throw new Error(
        `Internal: mapper for '${recipeName}' produced invalid ConfigFact: ${JSON.stringify(f)}`
      );
    }
  }

  return facts;
}
