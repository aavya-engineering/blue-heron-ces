// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Copied from Stamper structuredEvidence.ts to maintain package independence
// Functions: buildStructuredEvidence(), assessOutcome(), deriveVerdict(), classifyFailure()

import { createHash } from 'crypto';
import {
  StructuredEvidence,
  EvidenceOutcome,
  FailureDiagnostics,
  FailureCategory,
  VerificationResult,
} from '../types/StamperTypes.js';

/**
 * Assess the outcome of a command execution using exit code, stderr, and stdout heuristics.
 */
export function assessOutcome(
  exitCode: number,
  stderr: string,
  stdout: string,
  verificationResult?: VerificationResult
): EvidenceOutcome {
  const conditionA = exitCode === 0;

  // Case: Failure (exitCode >0) — use classifyFailure logic
  if (!conditionA) {
    const diagnostics = classifyFailure(exitCode, stderr, '');
    return diagnostics.failureCategory === 'FATAL' ? 'failed_no_remediation' : 'failed_remediation_available';
  }

  // Case: exitCode === 0 — apply state verification decision table
  if (verificationResult) {
    const svd = verificationResult.stateVerificationDetails;
    const conditionB = svd?.confidence === 'HIGH' || svd?.confidence === 'MEDIUM';

    // A=true, B=true (HIGH or MEDIUM confidence) → automated_success
    if (conditionB) {
      return 'automated_success';
    }

    // A=true, B=false, reason contains 'verification_pending_eventual_consistency' → verification_pending
    if (verificationResult.reason?.includes('verification_pending_eventual_consistency')) {
      return 'verification_pending';
    }

    // A=true, B=false, reason contains 'idempotent_no_change' → automated_success
    if (verificationResult.reason?.includes('idempotent_no_change')) {
      return 'automated_success';
    }

    // Verification passed with HIGH confidence (top-level) → automated_success
    if (verificationResult.passed && (verificationResult.confidence === 'HIGH' || verificationResult.confidence === 'MEDIUM')) {
      return 'automated_success';
    }
  }

  // Backward compat: no verificationResult → use exitCode-only logic
  return conditionA ? 'automated_success' : 'failed_remediation_available';
}

/**
 * Classify failure using regex patterns for M365 GCC High error categorization.
 */
export function classifyFailure(
  exitCode: number,
  stderr: string,
  exceptionMessage: string
): FailureDiagnostics {
  const combinedErr = stderr + ' ' + exceptionMessage;

  // RETRIABLE patterns
  if (/429|throttle|too many requests/i.test(combinedErr)) {
    return {
      rootCause: 'rate_limit',
      failureCategory: 'RETRIABLE' as FailureCategory,
      remediationSteps: [
        'Wait 60 seconds and retry',
        'Consider implementing exponential backoff',
        'Review M365 service health dashboard for throttling incidents'
      ]
    };
  }

  if (/network error|timeout|connection reset/i.test(combinedErr)) {
    return {
      rootCause: 'transient_network',
      failureCategory: 'RETRIABLE' as FailureCategory,
      remediationSteps: [
        'Retry the operation immediately',
        'Verify network connectivity to GCC High endpoints (*.microsoft.us)',
        'Check firewall/proxy rules for M365 GCC High IP ranges'
      ]
    };
  }

  // CONFIGURATION patterns
  if (/400|bad request|invalid.*parameter/i.test(combinedErr)) {
    return {
      rootCause: 'validation',
      failureCategory: 'CONFIGURATION' as FailureCategory,
      remediationSteps: [
        'Review command syntax and required parameters',
        'Verify variable resolution completed successfully',
        'Check parameter format matches API requirements'
      ]
    };
  }

  // FATAL patterns
  if (/Access Denied|Forbidden|Unauthorized|insufficient privileges|Authorization_RequestDenied|403/i.test(combinedErr)) {
    return {
      rootCause: 'permissions',
      failureCategory: 'FATAL' as FailureCategory,
      remediationSteps: [
        'Grant required Graph API permissions in Azure Portal',
        'Assign necessary directory roles',
        'Verify service principal certificate is valid and not expired'
      ]
    };
  }

  if (/not found|does not exist|resource.*not available/i.test(combinedErr)) {
    return {
      rootCause: 'resource_missing',
      failureCategory: 'FATAL' as FailureCategory,
      remediationSteps: [
        'Verify resource exists in tenant',
        'Check if resource was deleted or moved'
      ]
    };
  }

  // Default: FATAL with generic guidance
  return {
    rootCause: `exit_code_${exitCode}`,
    failureCategory: 'FATAL' as FailureCategory,
    remediationSteps: [
      'Review command output and stderr for specific error details',
      'Check M365 GCC High service health dashboard'
    ]
  };
}

/**
 * Derive compliance verdict from evidence outcome.
 */
export function deriveVerdict(
  outcome: EvidenceOutcome,
  verificationResult?: VerificationResult
): { verdict: 'SAT' | 'NOT_SAT'; rationale: string } {
  const SAT_OUTCOMES: EvidenceOutcome[] = [
    'automated_success', 'policy_compliance', 'manual_action',
    'outside_action', 'inherited', 'not_applicable'
  ];

  // Promotion: If verification confirms compliance with high confidence, override command failure
  if (
    verificationResult?.passed === true &&
    verificationResult.confidence === 'HIGH' &&
    verificationResult.score >= 90
  ) {
    return {
      verdict: 'SAT',
      rationale: verificationResult.reason || 'Resource verified as compliant via evidence check'
    };
  }

  // If verification failed or low confidence, demote to NOT_SAT
  if (verificationResult) {
    if (!verificationResult.passed) {
      return {
        verdict: 'NOT_SAT',
        rationale: `Content verification failed: ${verificationResult.reason}. Confidence: ${verificationResult.confidence} (score: ${verificationResult.score})`
      };
    }
    if (verificationResult.confidence === 'FAILED' || verificationResult.score < 60) {
      return {
        verdict: 'NOT_SAT',
        rationale: `Verification confidence insufficient for SAT verdict (${verificationResult.confidence}, score: ${verificationResult.score}/100). Requires MEDIUM (>=60) minimum.`
      };
    }
  }

  // Handle verification_pending outcome
  if (outcome === 'verification_pending') {
    return {
      verdict: 'NOT_SAT',
      rationale: 'Verification pending — eventual consistency requires retry. Check back later.'
    };
  }

  if (SAT_OUTCOMES.includes(outcome)) {
    return { verdict: 'SAT', rationale: `Outcome '${outcome}' indicates compliance requirement is satisfied` };
  }
  return { verdict: 'NOT_SAT', rationale: `Outcome '${outcome}' indicates compliance requirement is not yet satisfied` };
}

/**
 * Build a complete StructuredEvidence object from execution data.
 * Simplified version for AO (no SubCommand/ExeTask dependencies).
 */
export function buildStructuredEvidence(
  rawOutput: string,
  exitCode: number,
  stderr: string,
  controlIds: string[],
  commandExecuted: string,
  executorIdentity: string,
  verificationResult?: VerificationResult
): StructuredEvidence {
  const outcome = assessOutcome(exitCode, stderr, rawOutput, verificationResult);

  let failureDiagnostics: FailureDiagnostics | undefined;
  if (outcome.startsWith('failed_')) {
    failureDiagnostics = classifyFailure(exitCode, stderr, '');
  }

  const { verdict, rationale } = deriveVerdict(outcome, verificationResult);

  const sha256Hash = createHash('sha256').update(rawOutput, 'utf8').digest('hex');

  return {
    rawResponse: rawOutput,
    outcome,
    outcomeRationale: outcome === 'automated_success'
      ? `Command completed successfully (exit code ${exitCode})`
      : outcome === 'verification_pending'
      ? 'Command succeeded but state change not yet confirmed — verification pending'
      : outcome.startsWith('failed_')
      ? `Command failed: ${failureDiagnostics?.rootCause || 'unknown error'}`
      : `Outcome: ${outcome}`,
    failureDiagnostics,
    complianceVerdict: verdict,
    verdictRationale: rationale,
    verificationResult: verificationResult ? {
      passed: verificationResult.passed,
      confidence: verificationResult.confidence,
      score: verificationResult.score,
      details: verificationResult.details,
      reason: verificationResult.reason,
      stateVerificationDetails: verificationResult.stateVerificationDetails,
    } : undefined,
    metadata: {
      controlIds,
      timestamp: new Date().toISOString(),
      executorIdentity,
      commandExecuted,
      sha256Hash,
      environment: 'GCC-High',
    }
  };
}
