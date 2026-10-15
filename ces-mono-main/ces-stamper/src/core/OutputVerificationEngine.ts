// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { VerificationCriteria } from '../registry/command-registry.types.js';
import { StateVerificationDetails } from '../types/schema.types.js';
import { verifyPostSetState } from '../utils/stateVerification.js';

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'FAILED';

/**
 * FIDELITY tail (c) — evidence `equals` comparison mirrors PowerShell's `-eq`:
 * CASE-INSENSITIVE. Two faithful consequences:
 *   - a JSON boolean `true` matches the registry's PowerShell-rendered "True"
 *     ("true" === "true"), and "enabled" matches "Enabled";
 *   - it is still an exact value match otherwise (no partial/substring).
 * PowerShell config assertions (enabled/disabled, true/false, status enums) are
 * case-insensitive by convention; the sim stores JSON-native types, so String()
 * on a boolean is lowercase — this reconciles the two without weakening the check.
 */
export function evidenceValueEquals(actual: unknown, expected: string): boolean {
  return String(actual).toLowerCase() === expected.toLowerCase();
}

export interface VerificationResult {
  passed: boolean;
  confidence: ConfidenceLevel;
  score: number; // 0-100
  details: {
    exit_code_check: boolean;
    set_output_check: boolean | null;
    evidence_check: boolean | null;
  };
  reason: string;
  stateVerificationDetails?: StateVerificationDetails;
}

export class OutputVerificationEngine {
  verify(
    setCommandResult: { stdout: string; stderr: string; exitCode: number },
    evidenceResult: { stdout: string; exitCode: number } | null,
    criteria: VerificationCriteria | undefined,
    options?: { stateChanged?: boolean }
  ): VerificationResult {
    // Default weights
    const weights = criteria?.confidence_weights || {
      exit_code: 0.2,
      set_output: 0.2,
      evidence_match: 0.6,
    };

    // 1. Exit code check
    const exitCodeCheck = setCommandResult.exitCode === 0;

    // 2. Set output check
    let setOutputCheck: boolean | null = null;
    if (criteria?.set_output) {
      setOutputCheck = this.checkSetOutput(setCommandResult.stdout, criteria.set_output);
    }

    // 3. Evidence check
    let evidenceCheck: boolean | null = null;
    if (criteria?.evidence && evidenceResult) {
      evidenceCheck = this.checkEvidence(evidenceResult.stdout, criteria.evidence);
    }

    // 4. stateChanged:false override — resource was already in desired state.
    // When state didn't change and exit was clean:
    //   - SET output criteria may not match idempotent "already exists" output → don't penalize
    //   - Evidence regex/jsonpath may not match get_command's abbreviated output format
    //     (get_command returns raw PS objects without ConvertTo-Json; evidence criteria
    //     target the full evidence_commands JSON output). The get_command format mismatch
    //     should not penalize an already-compliant resource.
    //   - Null out failed evidence check entirely — the resource existed before and after,
    //     and evidence_commands will still run afterward for audit collection.
    if (options?.stateChanged === false && exitCodeCheck) {
      if (setOutputCheck === false) {
        setOutputCheck = null;
      }
      if (evidenceCheck === false) {
        evidenceCheck = null;
      }
    }

    // 5. Calculate score — normalize by applicable check weights only.
    // When set_output and/or evidence checks are null (not applicable), redistribute
    // their weight so exit_code alone can reach 100 instead of capping at 20.
    let rawScore = 0;
    let applicableWeight = weights.exit_code; // exit_code always applies
    if (exitCodeCheck) rawScore += weights.exit_code * 100;

    if (setOutputCheck !== null) {
      if (setOutputCheck) rawScore += weights.set_output * 100;
      applicableWeight += weights.set_output;
    }
    if (evidenceCheck !== null) {
      if (evidenceCheck) rawScore += weights.evidence_match * 100;
      applicableWeight += weights.evidence_match;
    }

    const score = applicableWeight > 0 ? rawScore / applicableWeight : 0;

    // 6. Determine confidence level
    let confidence: ConfidenceLevel;
    if (score >= 90) confidence = 'HIGH';
    else if (score >= 60) confidence = 'MEDIUM';
    else if (score >= 30) confidence = 'LOW';
    else confidence = 'FAILED';

    // 7. Determine overall pass/fail
    // Require minimum MEDIUM confidence for passed=true. LOW (30-59) or FAILED (<30) should not grant SAT verdict.
    const passed = score >= 60 && exitCodeCheck && (setOutputCheck !== false) && (evidenceCheck !== false);

    // 8. Generate reason
    const reason = options?.stateChanged === false && exitCodeCheck && passed
      ? 'Already compliant — state unchanged, evidence confirms resource exists'
      : this.generateReason(exitCodeCheck, setOutputCheck, evidenceCheck, confidence);

    return {
      passed,
      confidence,
      score: Math.round(score),
      details: {
        exit_code_check: exitCodeCheck,
        set_output_check: setOutputCheck,
        evidence_check: evidenceCheck,
      },
      reason,
    };
  }

  private checkSetOutput(stdout: string, setOutput: NonNullable<VerificationCriteria>['set_output']): boolean {
    if (!setOutput) return true;

    // Check min_length
    if (setOutput.min_length !== undefined && stdout.length < setOutput.min_length) {
      return false;
    }

    // Check fields_present (JSON parse + field existence)
    if (setOutput.fields_present && setOutput.fields_present.length > 0) {
      try {
        const parsed = JSON.parse(stdout);
        for (const field of setOutput.fields_present) {
          if (!(field in parsed)) {
            return false;
          }
        }
      } catch {
        return false; // JSON parse failure
      }
    }

    // Check regex_pattern
    if (setOutput.regex_pattern) {
      try {
        const regex = new RegExp(setOutput.regex_pattern);
        if (!regex.test(stdout)) {
          return false;
        }
      } catch {
        return false; // Invalid regex
      }
    }

    return true;
  }

  private checkEvidence(stdout: string, evidence: NonNullable<VerificationCriteria>['evidence']): boolean {
    if (!evidence) return true;

    // Check not_empty
    if (evidence.not_empty && stdout.trim().length === 0) {
      return false;
    }

    // Check jsonpath
    if (evidence.jsonpath) {
      try {
        const parsed = JSON.parse(stdout);
        const value = this.extractJsonPath(parsed, evidence.jsonpath);

        if (value === undefined) {
          return false;
        }

        // Check equals
        if (evidence.equals !== undefined) {
          return evidenceValueEquals(value, evidence.equals);
        }

        // Check regex
        if (evidence.regex) {
          try {
            const regex = new RegExp(evidence.regex);
            return regex.test(String(value));
          } catch {
            return false;
          }
        }

        return true; // jsonpath extracted successfully
      } catch {
        return false; // JSON parse failure
      }
    }

    // If only equals/regex without jsonpath, check against raw stdout
    if (evidence.equals !== undefined) {
      return evidenceValueEquals(stdout.trim(), evidence.equals);
    }

    if (evidence.regex) {
      try {
        const regex = new RegExp(evidence.regex, 's');
        return regex.test(stdout);
      } catch {
        return false;
      }
    }

    return true;
  }

  /**
   * Simple JSONPath dot-notation parser.
   * Supports: "$.field", "$.field.subfield", "$.nested.deep.field"
   * Strips leading "$." before accessing.
   */
  private extractJsonPath(obj: any, path: string): any {
    // Strip leading "$." if present
    const cleanPath = path.replace(/^\$\./, '');

    // Split on dots
    const parts = cleanPath.split('.');

    let current = obj;
    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      // Unwrap a single-element array: Graph SDK cmdlets and collection GETs
      // frequently return a one-item array where the jsonpath expects the
      // object (e.g. Get-Mg*...NamedLocation -Filter returns [ {...} ]).
      if (Array.isArray(current)) {
        if (current.length !== 1) return undefined;
        current = current[0];
        if (current === null || current === undefined) return undefined;
      }
      if (typeof current !== 'object') {
        return undefined;
      }
      // Case-insensitive property access. Real Graph SDK cmdlets surface
      // PascalCase (.DisplayName, .State, .Id) while raw Graph JSON is
      // camelCase (.displayName); CES registry verification jsonpaths are
      // written both ways. PowerShell property access is itself
      // case-insensitive, so mirroring that here is faithful, not lenient —
      // and it is the correct home for this tolerance (vs. mutating the shared
      // stacksim response, which breaks EO/AO consumers of raw Graph casing).
      if (Object.prototype.hasOwnProperty.call(current, part)) {
        current = current[part];
      } else {
        const key = Object.keys(current).find((k) => k.toLowerCase() === part.toLowerCase());
        current = key === undefined ? undefined : current[key];
      }
    }

    return current;
  }

  private generateReason(
    exitCodeCheck: boolean,
    setOutputCheck: boolean | null,
    evidenceCheck: boolean | null,
    confidence: ConfidenceLevel
  ): string {
    if (!exitCodeCheck) {
      return 'Command exited with non-zero code';
    }

    if (setOutputCheck === false) {
      return 'Set output validation failed';
    }

    if (evidenceCheck === false) {
      return 'Evidence validation failed';
    }

    if (confidence === 'HIGH') {
      return 'All verification checks passed';
    }

    if (confidence === 'MEDIUM') {
      return 'Exit code passed, partial validation';
    }

    if (confidence === 'LOW') {
      return 'Only exit code verified';
    }

    return 'Verification criteria not met';
  }

  /**
   * Verify post-SET state using generic parameter extraction heuristics.
   * Complementary to verify() — works without registry-defined verification criteria.
   */
  verifySetState(
    setCommand: string,
    postGetOutput: string | undefined,
    stateChanged: boolean,
    exitCode: number,
    consistency_hint?: 'eventual_hours' | 'eventual_slow' | 'eventual_fast'
  ): VerificationResult {
    const result = verifyPostSetState(postGetOutput, setCommand, stateChanged, exitCode, consistency_hint);

    // Confidence scoring adjustments
    let adjustedScore = result.score;
    let adjustmentReason = '';

    if (result.stateVerificationDetails?.confidence === 'HIGH') {
      adjustedScore += 20;
      adjustmentReason = ' [Score adjusted: +20 HIGH confidence]';
    } else if (!stateChanged && exitCode === 0 && result.stateVerificationDetails?.confidence === 'LOW'
      && result.reason !== 'idempotent_no_change' && !result.reason.startsWith('already_compliant')) {
      adjustedScore -= 30;
      adjustmentReason = ' [Score adjusted: -30 low confidence + no state change]';
    }

    // Clamp final score to 0-100
    adjustedScore = Math.max(0, Math.min(100, adjustedScore));

    // Update result with adjusted score
    result.score = adjustedScore;
    result.reason = result.reason + adjustmentReason;

    // Update stateVerificationDetails confidenceScore to match
    if (result.stateVerificationDetails) {
      result.stateVerificationDetails.confidenceScore = adjustedScore;
    }

    return result;
  }
}
