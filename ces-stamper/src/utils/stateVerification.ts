// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { VerificationResult } from '../core/OutputVerificationEngine.js';

/**
 * Parse -Param Value pairs AND hashtable syntax from a PowerShell set_command.
 * Returns Map<string, string> of param names to STRINGIFIED expected values.
 * Returns empty Map if regex fails to match any params (signals exit_code_only fallback).
 */
export function extractSetParameters(setCommand: string): Map<string, string> {
  const params = new Map<string, string>();

  // Pattern 1: -ParamName $true/$false (boolean params)
  const boolRegex = /-(\w+)\s+\$?(true|false)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = boolRegex.exec(setCommand)) !== null) {
    params.set(match[1], match[2].toLowerCase());
  }

  // Pattern 2: -ParamName "stringValue" (string params)
  const stringRegex = /-(\w+)\s+"([^"]+)"/g;
  while ((match = stringRegex.exec(setCommand)) !== null) {
    params.set(match[1], match[2]);
  }

  // Pattern 3: -ParamName @{Key=Value} (simple hashtable params)
  const hashtableRegex = /-(\w+)\s+@\{([^}]+)\}/g;
  while ((match = hashtableRegex.exec(setCommand)) !== null) {
    // Extract Key=Value pairs as separate entries
    const pairs = match[2].split(';');
    for (const pair of pairs) {
      const trimmed = pair.trim();
      if (trimmed) {
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.substring(0, eqIdx).trim();
          const value = trimmed.substring(eqIdx + 1).trim();
          params.set(key, value);
        }
      }
    }
  }

  if (params.size === 0) {
    // Zero params extracted — caller handles empty Map
  }

  return params;
}

/**
 * Search command output for an expected value associated with a param name.
 * Tries JSON parse first, then regex fallback, then raw text search.
 */
export function searchOutputForValue(
  output: string,
  expectedValue: string,
  paramName: string
): { found: boolean; matchedSnippet?: string; confidence: 'HIGH' | 'MEDIUM' | 'LOW' } {
  // Try JSON parse first: search object tree for paramName property matching expectedValue
  try {
    const parsed = JSON.parse(output.trim());
    const found = searchJsonTree(parsed, paramName, expectedValue);
    if (found !== undefined) {
      return { found: true, matchedSnippet: String(found), confidence: 'HIGH' };
    }
  } catch {
    // Not JSON — fall through to regex
  }

  // Regex fallback: search for paramName followed by expectedValue within 200 chars
  try {
    const escapedParam = paramName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedValue = expectedValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escapedParam + '[\\s\\S]{0,200}' + escapedValue, 'i');
    const match = regex.exec(output);
    if (match) {
      return { found: true, matchedSnippet: match[0].substring(0, 200), confidence: 'MEDIUM' };
    }
  } catch {
    // Regex failed — fall through
  }

  // Raw text search: search for string representation of expectedValue anywhere
  if (output.toLowerCase().includes(expectedValue.toLowerCase())) {
    return { found: true, matchedSnippet: expectedValue, confidence: 'LOW' };
  }

  return { found: false, confidence: 'LOW' as const };
}

/**
 * Verify post-SET state by comparing extracted parameters against post-GET output.
 * Returns full VerificationResult with stateVerificationDetails populated.
 */
export function verifyPostSetState(
  postGetOutput: string | undefined,
  setCommand: string,
  stateChanged: boolean,
  exitCode: number,
  consistency_hint?: 'eventual_hours' | 'eventual_slow' | 'eventual_fast'
): VerificationResult {
  // postGetOutput undefined check: post-GET failed or was not run
  if (postGetOutput === undefined) {
    return {
      passed: exitCode === 0,
      confidence: 'LOW',
      score: 35,
      details: { exit_code_check: exitCode === 0, set_output_check: null, evidence_check: null },
      reason: 'No post-GET output available',
      stateVerificationDetails: {
        method: 'exit_code_only',
        confidence: 'LOW',
        confidenceScore: 35,
      },
    };
  }

  // exitCode > 0: command failed
  if (exitCode > 0) {
    return {
      passed: false,
      confidence: 'FAILED',
      score: 0,
      details: { exit_code_check: false, set_output_check: null, evidence_check: null },
      reason: 'Command failed',
      stateVerificationDetails: {
        method: 'exit_code_only',
        confidence: 'LOW',
        confidenceScore: 0,
      },
    };
  }

  // Extract expected params via extractSetParameters
  const expectedParams = extractSetParameters(setCommand);

  // If extractSetParameters returns empty Map: no parameters extracted
  if (expectedParams.size === 0) {
    return {
      passed: exitCode === 0,
      confidence: 'LOW',
      score: 35,
      details: { exit_code_check: true, set_output_check: null, evidence_check: null },
      reason: 'No parameters extracted from set_command',
      stateVerificationDetails: {
        method: 'exit_code_only',
        confidence: 'LOW',
        confidenceScore: 35,
      },
    };
  }

  // For each param, call searchOutputForValue
  let allFound = true;
  let worstConfidence: 'HIGH' | 'MEDIUM' | 'LOW' = 'HIGH';
  let lastMatchedValue: string | undefined;
  let lastExpectedValue: string | undefined;
  let lastRawExtract: string | undefined;
  let foundCount = 0;

  for (const [paramName, expectedValue] of expectedParams) {
    const result = searchOutputForValue(postGetOutput, expectedValue, paramName);
    if (result.found) {
      foundCount++;
      lastMatchedValue = result.matchedSnippet;
      lastExpectedValue = expectedValue;
      lastRawExtract = result.matchedSnippet;
      // Aggregate confidence: worst wins
      if (result.confidence === 'LOW') worstConfidence = 'LOW';
      else if (result.confidence === 'MEDIUM' && worstConfidence === 'HIGH') worstConfidence = 'MEDIUM';
    } else {
      allFound = false;
    }
  }

  // stateChanged: false — resource was already in desired state before SET ran.
  // For get-then-set idempotency, no state change means already compliant.
  // Rules:
  //   stateChanged: false AND output contains expected value → PASS (already compliant)
  //   stateChanged: false AND output does NOT contain expected value → context-dependent
  //   stateChanged: true  AND output contains expected value → PASS (handled by general path below)
  if (exitCode === 0 && !stateChanged) {
    if (foundCount > 0) {
      // At least one expected value confirmed in current state → already compliant.
      // The pre-state proves compliance; verification criteria may not match the
      // idempotent "already exists" SET output, but the GET state is correct.
      const alreadyCompliantScore = worstConfidence === 'HIGH' ? 90
        : worstConfidence === 'MEDIUM' ? 65 : 50;
      return {
        passed: true,
        confidence: worstConfidence,
        score: alreadyCompliantScore,
        details: { exit_code_check: true, set_output_check: true, evidence_check: null },
        reason: `already_compliant: ${foundCount}/${expectedParams.size} expected params confirmed in current state`,
        stateVerificationDetails: {
          method: 'parameter_extraction',
          matchedValue: lastMatchedValue,
          expectedValue: lastExpectedValue,
          confidence: worstConfidence,
          rawExtract: lastRawExtract,
          confidenceScore: alreadyCompliantScore,
        },
      };
    }

    if (consistency_hint === 'eventual_hours' || consistency_hint === 'eventual_slow' || consistency_hint === 'eventual_fast') {
      return {
        passed: false,
        confidence: 'LOW',
        score: 35,
        details: { exit_code_check: true, set_output_check: false, evidence_check: null },
        reason: 'verification_pending_eventual_consistency',
        stateVerificationDetails: {
          method: 'parameter_extraction',
          expectedValue: lastExpectedValue,
          confidence: 'LOW',
          confidenceScore: 35,
        },
      };
    }

    // foundCount === 0, no consistency hint: param extraction may have failed for
    // complex output formats. Trust exit code — most likely already compliant.
    return {
      passed: true,
      confidence: 'LOW',
      score: 40,
      details: { exit_code_check: true, set_output_check: null, evidence_check: null },
      reason: 'idempotent_no_change',
      stateVerificationDetails: {
        method: 'exit_code_only',
        expectedValue: lastExpectedValue,
        confidence: 'LOW',
        confidenceScore: 40,
      },
    };
  }

  // Calculate confidenceScore based on aggregate confidence
  let confidenceScore: number;
  if (worstConfidence === 'HIGH') confidenceScore = 90;
  else if (worstConfidence === 'MEDIUM') confidenceScore = 65;
  else confidenceScore = 35;

  // Clamp to 0-100 range
  confidenceScore = Math.max(0, Math.min(100, confidenceScore));

  const passed = allFound && confidenceScore >= 60;

  return {
    passed,
    confidence: worstConfidence,
    score: confidenceScore,
    details: { exit_code_check: true, set_output_check: allFound, evidence_check: null },
    reason: allFound
      ? `State verified: ${foundCount}/${expectedParams.size} params matched (${worstConfidence})`
      : `State verification incomplete: ${foundCount}/${expectedParams.size} params matched`,
    stateVerificationDetails: {
      method: 'parameter_extraction',
      matchedValue: lastMatchedValue,
      expectedValue: lastExpectedValue,
      confidence: worstConfidence,
      rawExtract: lastRawExtract,
      confidenceScore,
    },
  };
}

/**
 * Recursively search a JSON object tree for a property matching paramName with expectedValue.
 */
function searchJsonTree(obj: any, paramName: string, expectedValue: string): any {
  if (obj === null || obj === undefined) return undefined;

  if (typeof obj === 'object') {
    // Check if this object has the paramName property
    const lowerParam = paramName.toLowerCase();
    for (const key of Object.keys(obj)) {
      if (key.toLowerCase() === lowerParam) {
        if (String(obj[key]).toLowerCase() === expectedValue.toLowerCase()) {
          return obj[key];
        }
      }
    }
    // If array, search first element
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const found = searchJsonTree(item, paramName, expectedValue);
        if (found !== undefined) return found;
      }
    } else {
      // Recurse into nested objects
      for (const key of Object.keys(obj)) {
        if (typeof obj[key] === 'object' && obj[key] !== null) {
          const found = searchJsonTree(obj[key], paramName, expectedValue);
          if (found !== undefined) return found;
        }
      }
    }
  }

  return undefined;
}
