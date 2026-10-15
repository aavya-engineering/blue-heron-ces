// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { NistQualitativeScore, RiskEntry } from '../../shared/types/risk-assessment.types.js';
import { computeCompositeRisk } from './NistScoringMatrix.js';
import type { RiskAssessmentStore } from './RiskAssessmentStore.js';

/**
 * Auto-scores Secure Score risk entries using a deterministic heuristic
 * based on Microsoft's own weighting (maxScore) and implementation gap (currentScore).
 *
 * Methodology (NIST SP 800-30 aligned):
 *
 * IMPACT — derived from maxScore (Microsoft's control importance weight):
 *   maxScore >= 9  → very_high  (critical security control)
 *   maxScore >= 6  → high       (important security control)
 *   maxScore >= 4  → moderate   (standard security control)
 *   maxScore >= 2  → low        (minor security control)
 *   maxScore < 2   → very_low   (informational)
 *
 * LIKELIHOOD — derived from implementation gap ratio:
 *   gap = 1 - (currentScore / maxScore)
 *   gap >= 0.8  → very_high  (almost entirely unimplemented)
 *   gap >= 0.6  → high       (mostly unimplemented)
 *   gap >= 0.4  → moderate   (partially implemented)
 *   gap >= 0.2  → low        (mostly implemented, minor gap)
 *   gap < 0.2   → very_low   (nearly complete)
 *
 * When currentScore/maxScore are unavailable, defaults:
 *   - likelihood: moderate (conservative middle)
 *   - impact: derived from vulnerability type (organizational → moderate)
 *
 * COMPOSITE RISK — standard NIST SP 800-30 5x5 matrix lookup.
 */

const SCORE_SCALE: NistQualitativeScore[] = ['very_low', 'low', 'moderate', 'high', 'very_high'];

/**
 * Derive impact from Microsoft Secure Score maxScore value.
 */
export function deriveImpactFromMaxScore(maxScore: number | undefined): NistQualitativeScore {
  if (maxScore === undefined || maxScore === null) return 'moderate';
  if (maxScore >= 9) return 'very_high';
  if (maxScore >= 6) return 'high';
  if (maxScore >= 4) return 'moderate';
  if (maxScore >= 2) return 'low';
  return 'very_low';
}

/**
 * Derive likelihood from implementation gap ratio.
 * gap = 1 - (currentScore / maxScore)
 */
export function deriveLikelihoodFromGap(currentScore: number | undefined, maxScore: number | undefined): NistQualitativeScore {
  if (currentScore === undefined || maxScore === undefined || maxScore === 0) {
    // No score data — assume moderate likelihood (conservative default)
    return 'moderate';
  }
  const gap = 1 - (currentScore / maxScore);
  if (gap >= 0.8) return 'very_high';
  if (gap >= 0.6) return 'high';
  if (gap >= 0.4) return 'moderate';
  if (gap >= 0.2) return 'low';
  return 'very_low';
}

/**
 * Apply default scoring to Defender for Cloud entries based on severity.
 */
export function deriveScoringFromSeverity(severity: string | undefined): { likelihood: NistQualitativeScore; impact: NistQualitativeScore } {
  switch (severity?.toLowerCase()) {
    case 'high':
      return { likelihood: 'high', impact: 'high' };
    case 'medium':
      return { likelihood: 'moderate', impact: 'moderate' };
    case 'low':
      return { likelihood: 'low', impact: 'low' };
    case 'informational':
      return { likelihood: 'very_low', impact: 'very_low' };
    default:
      return { likelihood: 'moderate', impact: 'moderate' };
  }
}

/**
 * Apply default scoring to Sentinel incident entries based on severity.
 */
export function deriveScoringFromIncidentSeverity(severity: string | undefined): { likelihood: NistQualitativeScore; impact: NistQualitativeScore } {
  // Sentinel incidents are adversarial — likelihood is generally higher
  switch (severity?.toLowerCase()) {
    case 'high':
      return { likelihood: 'very_high', impact: 'very_high' };
    case 'medium':
      return { likelihood: 'high', impact: 'high' };
    case 'low':
      return { likelihood: 'moderate', impact: 'moderate' };
    case 'informational':
      return { likelihood: 'low', impact: 'low' };
    default:
      return { likelihood: 'moderate', impact: 'moderate' };
  }
}

/**
 * Apply default scoring to Plan Output NOT MET entries.
 * All NOT MET findings represent organizational vulnerabilities with moderate baseline.
 */
export function deriveScoringForPlanOutput(): { likelihood: NistQualitativeScore; impact: NistQualitativeScore } {
  // A control assessed as NOT MET means the gap exists (high likelihood),
  // and the control is required for CMMC (moderate-to-high impact)
  return { likelihood: 'high', impact: 'moderate' };
}

export interface AutoScoreResult {
  scored: number;
  skipped: number;
  errors: string[];
}

/**
 * Auto-score all unscored entries in a tenant's risk register.
 * Only applies to entries that have no likelihood, impact, or compositeRisk set.
 * Adds a note indicating the score was auto-derived.
 */
export function autoScoreRegister(store: RiskAssessmentStore, tenantSlug: string): AutoScoreResult {
  const register = store.loadRegister(tenantSlug);
  const result: AutoScoreResult = { scored: 0, skipped: 0, errors: [] };

  for (const entry of register.entries) {
    // Skip already-scored entries
    if (entry.likelihood && entry.impact && entry.compositeRisk) {
      result.skipped++;
      continue;
    }

    try {
      const scoring = deriveScoring(entry);
      if (!scoring) {
        result.skipped++;
        continue;
      }

      const compositeRisk = computeCompositeRisk(scoring.likelihood, scoring.impact);
      const now = new Date().toISOString();
      const autoNote = `[AUTO-SCORED ${now}] likelihood=${scoring.likelihood}, impact=${scoring.impact}, compositeRisk=${compositeRisk}`;
      const existingNotes = entry.notes ?? '';
      const notes = existingNotes ? `${existingNotes}\n${autoNote}` : autoNote;

      store.updateEntry(tenantSlug, entry.id, {
        likelihood: scoring.likelihood,
        impact: scoring.impact,
        compositeRisk,
        notes,
        lastReviewed: now,
      });

      result.scored++;
    } catch (err) {
      const msg = `Failed to score entry ${entry.id}: ${err instanceof Error ? err.message : String(err)}`;
      result.errors.push(msg);
    }
  }

  return result;
}

/**
 * Derive likelihood + impact for a single entry based on its source type.
 */
function deriveScoring(entry: RiskEntry): { likelihood: NistQualitativeScore; impact: NistQualitativeScore } | null {
  switch (entry.source.type) {
    case 'secure_score': {
      const source = entry.source as { type: 'secure_score'; controlName: string; score?: number; maxScore?: number };
      // Use score field as currentScore, maxScore if available
      const likelihood = deriveLikelihoodFromGap(source.score, source.maxScore);
      const impact = deriveImpactFromMaxScore(source.maxScore);
      return { likelihood, impact };
    }
    case 'defender_for_cloud': {
      const source = entry.source as { type: 'defender_for_cloud'; alertId: string; severity: string };
      return deriveScoringFromSeverity(source.severity);
    }
    case 'sentinel_alert': {
      const source = entry.source as { type: 'sentinel_alert'; incidentId: string; title: string; severity?: string };
      return deriveScoringFromIncidentSeverity(source.severity);
    }
    case 'plan_output': {
      return deriveScoringForPlanOutput();
    }
    case 'manual': {
      // Manual entries should be scored by the human — skip
      return null;
    }
    default:
      return null;
  }
}
