// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { createHash } from 'crypto';
import * as path from 'path';
import { writeJsonArtifact } from 'ces-shared/persistence/files';
import { StructuredEvidence, EvidenceOutcome, FailureDiagnostics, FailureCategory, RegistryEntrySnapshot } from '../types/schema.types.js';
import { SubCommand, ExeTask } from '../types/schema.types.js';
import { uploadEvidenceBlob } from './blobUpload.js';
import { EvidenceStorageConfig } from '../config/ClientConfig.js';
import { VerificationResult } from '../core/OutputVerificationEngine.js';

type ModuleVersionMap = Record<string, string>;

const SILENT_FAILURE_PATTERNS = [
  /Insufficient privileges/i,
  /Access denied/i,
  /quota exceeded/i,
  /throttled/i,
  /The term '.*' is not recognized/i,
  /ERROR:/i,
  /Exception:/i,
  /Cannot find an overload/i,
  /is not recognized as the name of a cmdlet/i,
  /You cannot call a method on a null-valued expression/i,
  /Object reference not set to an instance/i,
];

function detectSilentFailure(stdout: string, stderr: string, subCommand: SubCommand): boolean {
  // Check stderr for all patterns (including WARNING:)
  for (const pattern of SILENT_FAILURE_PATTERNS) {
    if (pattern.test(stderr)) return true;
  }
  // Check stdout for all patterns except WARNING: (some commands output WARNING legitimately)
  for (const pattern of SILENT_FAILURE_PATTERNS) {
    if (pattern.test(stdout)) return true;
  }
  // Check stderr specifically for WARNING: (only stderr, not stdout)
  if (/WARNING:/i.test(stderr)) return true;

  // Empty stdout on data-expected commands (has captures or evidence-only)
  const isDataCommand = (subCommand.captures && subCommand.captures.length > 0) ||
                         subCommand.idempotency === 'evidence-only';
  if (isDataCommand && !stdout.trim() && !stderr.trim()) return true;
  return false;
}

/**
 * Assess the outcome of a command execution using exit code, stderr, and stdout heuristics.
 * Heuristics: (1) exitCode 0 + no exception → automated_success
 *             (2) exitCode >0 or exception → failed_* (based on classifyFailure)
 *             (3) empty stdout on expected data commands → partial_success
 * Expected data commands: sub-commands with non-empty captures[] OR get_command type
 */
export function assessOutcome(
  exitCode: number,
  stderr: string,
  stdout: string,
  hasException: boolean,
  subCommand: SubCommand,
  verificationResult?: VerificationResult,
  idempotentSkip?: boolean
): EvidenceOutcome {
  // Idempotent skip: resource already exists, creation skipped
  if (idempotentSkip === true) {
    return 'automated_success';
  }

  // Evidence-only entries: collection succeeded if exitCode is 0, regardless of
  // whether stdout is empty. Empty output is valid (e.g. no Wi-Fi profiles in a
  // BYOD-only tenant, no non-browser sign-in failures in audit period).
  // The verification engine handles pass/fail based on criteria.
  // Accept exitCode 0 even when hasException is true (PS may emit benign warnings
  // that flag as exceptions). Also accept non-empty stdout regardless of exitCode
  // (native tools like `az rest` can set $LASTEXITCODE even on success).
  if (subCommand.idempotency === 'evidence-only' && (stdout.trim() || exitCode === 0)) {
    return 'automated_success';
  }

  const conditionA = exitCode === 0 && !hasException;

  // Case: Failure (exitCode >0 or exception) — use existing classifyFailure logic
  if (!conditionA) {
    const diagnostics = classifyFailure(exitCode, stderr, hasException ? stderr : '');
    return diagnostics.failureCategory === 'FATAL' ? 'failed_no_remediation' : 'failed_remediation_available';
  }

  // Case: exitCode === 0 && !hasException — apply state verification decision table
  // Check verification BEFORE silent failure heuristics: a high-confidence verification
  // proving compliance overrides stderr pattern matches (e.g., "Access denied" on a
  // resource that already exists and is compliant).
  if (verificationResult) {
    const svd = verificationResult.stateVerificationDetails;
    const conditionB = svd?.confidence === 'HIGH' || svd?.confidence === 'MEDIUM';
    const conditionC = svd?.method === 'exit_code_only';

    // A=true, B=true (HIGH or MEDIUM confidence) → automated_success
    if (conditionB) {
      return 'automated_success';
    }

    // A=true, B=false, reason contains 'verification_pending_eventual_consistency' → verification_pending
    if (verificationResult.reason?.includes('verification_pending_eventual_consistency')) {
      return 'verification_pending';
    }

    // A=true, B=false, reason contains 'idempotent_no_change' → automated_success
    // SET ran with exit code 0, state was already in desired configuration.
    if (verificationResult.reason?.includes('idempotent_no_change')) {
      return 'automated_success';
    }

    // A=true, B=false, reason contains 'silent_failure_suspected' → failed_remediation_available
    if (verificationResult.reason?.includes('silent_failure_suspected')) {
      return 'failed_remediation_available';
    }

    // A=true, C=true (exit_code_only fallback) → automated_success (legacy path)
    if (conditionC) {
      return 'automated_success';
    }

    // Verification passed with HIGH confidence (top-level, no stateVerificationDetails) →
    // trust the verification engine over heuristic stderr pattern matching.
    if (verificationResult.passed && (verificationResult.confidence === 'HIGH' || verificationResult.confidence === 'MEDIUM')) {
      return 'automated_success';
    }
  }

  // Silent failure detection — catch exit code 0 commands with error patterns in output.
  // Runs AFTER verification check so that verified-compliant resources aren't misclassified.
  if (conditionA && detectSilentFailure(stdout, stderr, subCommand)) {
    return 'failed_remediation_available';
  }

  // Evidence-only entries: exitCode 0 means successful collection, even with empty stdout
  if (subCommand.idempotency === 'evidence-only' && exitCode === 0) {
    return 'automated_success';
  }

  // Backward compat: no verificationResult → use existing exitCode-only logic
  // Check if this is an expected data command (has captures or is get_command type)
  const isExpectedDataCommand = (subCommand.captures && subCommand.captures.length > 0) ||
                                 !subCommand.set_command || subCommand.set_command.trim() === '';

  // If expected data command but stdout is empty → partial success
  if (isExpectedDataCommand && !stdout.trim()) {
    return 'partial_success';
  }

  return 'automated_success';
}

/**
 * Classify failure using regex patterns for M365 GCC High error categorization.
 * Returns root cause, failure category (RETRIABLE/CONFIGURATION/FATAL), and remediation steps.
 */
export function classifyFailure(
  exitCode: number,
  stderr: string,
  exceptionMessage: string
): FailureDiagnostics {
  const combinedErr = stderr + ' ' + exceptionMessage;

  // RETRIABLE patterns
  if (/AADSTS50011|AADSTS50076|AADSTS50079/.test(combinedErr)) {
    return {
      rootCause: 'auth_federated_idp',
      failureCategory: 'RETRIABLE' as FailureCategory,
      remediationSteps: [
        'Retry the operation after 30 seconds',
        'Verify Azure AD federation configuration is healthy',
        'Check if MFA is required and user has completed enrollment'
      ]
    };
  }

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

  // M365/Azure-specific errors
  if (/409|conflict|already exists/i.test(combinedErr) || /resource.*already.*exists/i.test(combinedErr)) {
    return {
      rootCause: 'Resource already exists (409 Conflict)',
      failureCategory: 'CONFIGURATION' as FailureCategory,
      remediationSteps: [
        'Verify existing resource configuration matches desired state',
        'Use Update- cmdlet instead of New-',
        'Enable idempotent mode in registry entry (get-then-set)'
      ]
    };
  }

  if (/400|bad request|invalid.*parameter/i.test(combinedErr) && /graph/i.test(combinedErr)) {
    return {
      rootCause: 'Microsoft Graph API rejected request parameters (400 Bad Request)',
      failureCategory: 'CONFIGURATION' as FailureCategory,
      remediationSteps: [
        'Review API documentation for parameter format',
        'Check for deprecated properties or API version mismatch',
        'Validate JSON schema if using -BodyParameter or Invoke-MgGraphRequest'
      ]
    };
  }

  // CONFIGURATION patterns
  if (/module was not found|cannot find module|module conflict/i.test(combinedErr)) {
    return {
      rootCause: 'module_version',
      failureCategory: 'CONFIGURATION' as FailureCategory,
      remediationSteps: [
        'Install required PowerShell module: Install-Module <ModuleName> -Force',
        'Update module to latest version: Update-Module <ModuleName>',
        'Verify module compatibility with GCC High endpoints'
      ]
    };
  }

  if (/endpoint.*not found|invalid uri|unsupported scheme/i.test(combinedErr)) {
    return {
      rootCause: 'endpoint',
      failureCategory: 'CONFIGURATION' as FailureCategory,
      remediationSteps: [
        'Verify GCC High endpoint configuration (graph.microsoft.us, management.usgovcloudapi.net)',
        'Check ClientConfig.ts for correct environment settings',
        'Ensure Connect-MgGraph uses -Environment USGov'
      ]
    };
  }

  if (/parameter.*invalid|missing required parameter/i.test(combinedErr)) {
    return {
      rootCause: 'parameter',
      failureCategory: 'CONFIGURATION' as FailureCategory,
      remediationSteps: [
        'Review command syntax and required parameters',
        'Verify variable resolution completed successfully',
        'Check registry entry schema for missing variables_required fields'
      ]
    };
  }

  // FATAL patterns
  if (/Access Denied|Forbidden|Unauthorized|insufficient privileges/i.test(combinedErr)) {
    return {
      rootCause: 'permissions',
      failureCategory: 'FATAL' as FailureCategory,
      remediationSteps: [
        'Grant required Graph API permissions in Azure Portal',
        'Assign necessary directory roles (Exchange Admin, SharePoint Admin, etc.)',
        'Run /api/preflight to auto-grant missing permissions',
        'Verify service principal certificate is valid and not expired'
      ]
    };
  }

  if (/not found|does not exist|resource.*not available/i.test(combinedErr)) {
    return {
      rootCause: 'resource_missing',
      failureCategory: 'FATAL' as FailureCategory,
      remediationSteps: [
        'Verify resource exists in tenant using Get-* command',
        'Check if resource was deleted or moved',
        'Review capture chaining: upstream task may have failed to create dependency'
      ]
    };
  }

  // Default: FATAL with generic guidance
  return {
    rootCause: `exit_code_${exitCode}`,
    failureCategory: 'FATAL' as FailureCategory,
    remediationSteps: [
      'Review command output and stderr for specific error details',
      'Check M365 GCC High service health dashboard',
      'Consult PowerShell module documentation for the failing command'
    ]
  };
}

/**
 * Derive compliance verdict from evidence outcome.
 * Uses outcome-based mapping and verification result.
 */
export function deriveVerdict(
  outcome: EvidenceOutcome,
  verificationResult?: VerificationResult,
  consistency_hint?: string,
  assessOnly?: boolean
): { verdict: 'SAT' | 'NOT_SAT'; rationale: string } {
  const SAT_OUTCOMES: EvidenceOutcome[] = [
    'automated_success', 'policy_compliance', 'manual_action',
    'outside_action', 'inherited', 'not_applicable'
  ];

  // Assess-only evidence: discovery-only rationale for SAT outcomes
  if (assessOnly === true && SAT_OUTCOMES.includes(outcome)) {
    return { verdict: 'SAT', rationale: 'Resource discovered during Assess (get_command returned data). Full state verification will occur during Execute phase.' };
  }

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
    // FAILED confidence means score < 30 per OutputVerificationEngine.ts L53-56
    if (verificationResult.confidence === 'FAILED' || verificationResult.score < 60) {
      return {
        verdict: 'NOT_SAT',
        rationale: `Verification confidence insufficient for SAT verdict (${verificationResult.confidence}, score: ${verificationResult.score}/100). Requires MEDIUM (>=60) minimum.`
      };
    }
  }

  // Handle verification_pending outcome
  if (outcome === 'verification_pending') {
    const hintText = consistency_hint === 'eventual_hours' ? 'IPPS eventual consistency (1-24h)'
      : consistency_hint === 'eventual_slow' ? 'eventual consistency (15-30min)'
      : consistency_hint === 'eventual_fast' ? 'eventual consistency (3-20s)'
      : 'eventual consistency';
    return {
      verdict: 'NOT_SAT',
      rationale: `Verification pending — ${hintText} requires retry. Check back later.`
    };
  }

  if (SAT_OUTCOMES.includes(outcome)) {
    return { verdict: 'SAT', rationale: `Outcome '${outcome}' indicates compliance requirement is satisfied` };
  }
  return { verdict: 'NOT_SAT', rationale: `Outcome '${outcome}' indicates compliance requirement is not yet satisfied` };
}

/**
 * Build a complete StructuredEvidence object from execution data.
 * Orchestrates: assessOutcome, classifyFailure, module version extraction, metadata construction.
 */
export function buildStructuredEvidence(
  rawOutput: string,
  exitCode: number,
  stderr: string,
  exception: Error | null,
  subCommand: SubCommand,
  task: ExeTask,
  variables: Record<string, any>,
  moduleVersions?: ModuleVersionMap,
  registryEntry?: RegistryEntrySnapshot,
  options?: { setCommandExitCode?: number; setCommandStderr?: string; getCommandOutput?: string; postStateOutput?: string; stateChanged?: boolean; verificationResult?: VerificationResult; consistency_hint?: string; idempotentSkip?: boolean; assessOnly?: boolean }
): StructuredEvidence {
  const hasException = exception !== null;

  // Use actual exitCode/stderr if provided via options, otherwise use the passed-in values
  const actualExitCode = options?.setCommandExitCode ?? exitCode;
  const actualStderr = options?.setCommandStderr ?? stderr;

  const outcome = assessOutcome(actualExitCode, actualStderr, rawOutput, hasException, subCommand, options?.verificationResult, options?.idempotentSkip);

  let failureDiagnostics: FailureDiagnostics | undefined;
  if (outcome.startsWith('failed_')) {
    failureDiagnostics = classifyFailure(actualExitCode, actualStderr, exception?.message || '');
  }

  // Derive compliance verdict from outcome + verification result
  const { verdict, rationale } = deriveVerdict(outcome, options?.verificationResult, options?.consistency_hint, options?.assessOnly);

  // Generate SHA256 hash of UTF-8 encoded rawResponse BEFORE JSON serialization
  const sha256Hash = createHash('sha256').update(rawOutput, 'utf8').digest('hex');

  // Extract executor identity from variables.tenant_slug or fallback to 'unknown'
  const executorIdentity = variables.tenant_slug || variables.tenantSlug || 'unknown';

  // Extract controlIds — prefer registryEntry.control_ids as authoritative source
  const controlIds = registryEntry?.control_ids ?? task.controls ?? (task as any).compliance_mapping?.cmmc_controls ?? [];

  // Construct full PowerShell command executed
  const commandExecuted = subCommand.set_command || `[manual/evidence-only] ${subCommand.label}`;

  return {
    rawResponse: rawOutput,
    outcome,
    outcomeRationale: options?.idempotentSkip === true
      ? 'Resource already exists — creation skipped (idempotent)'
      : outcome === 'automated_success'
      ? `Command completed successfully (exit code ${actualExitCode})`
      : outcome === 'verification_pending'
      ? 'Command succeeded but state change not yet confirmed — verification pending'
      : outcome === 'partial_success'
      ? 'Command completed but expected data output was empty'
      : outcome.startsWith('failed_')
      ? `Command failed: ${failureDiagnostics?.rootCause || 'unknown error'}`
      : `Outcome: ${outcome}`,
    failureDiagnostics,
    complianceVerdict: verdict,
    verdictRationale: rationale,
    verificationResult: options?.verificationResult ? {
      passed: options.verificationResult.passed,
      confidence: options.verificationResult.confidence,
      score: options.verificationResult.score,
      details: options.verificationResult.details,
      reason: options.verificationResult.reason,
      stateVerificationDetails: options.verificationResult.stateVerificationDetails,
    } : undefined,
    registryEntry,
    metadata: {
      controlIds,
      timestamp: new Date().toISOString(),
      executorIdentity,
      commandExecuted,
      sha256Hash,
      moduleVersions,
      environment: variables.environment || 'GCC-High',
      preStateOutput: options?.getCommandOutput,
      postStateOutput: options?.postStateOutput,
      stateChanged: options?.stateChanged
    }
  };
}

/**
 * Append ISO timestamp before extension so immutable blob containers don't 409.
 */
function stampedBlobPath(basePath: string, evidFile: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const prefix = basePath ? basePath + '/' : '';
  return `${prefix}${evidFile.replace(/\.(txt|json)$/, '')}_${ts}.json`;
}

/**
 * Write structured evidence to local disk and optionally upload to blob storage.
 * Returns local path and blob URL (if uploaded).
 */
export async function writeAndUploadEvidence(
  evidenceDir: string,
  evidFile: string,
  evidence: StructuredEvidence,
  evidenceStorage?: EvidenceStorageConfig
): Promise<{ localPath: string; blobUrl?: string }> {
  const fullPath = path.join(evidenceDir, evidFile);
  // G2: local evidence artifact routed through the sanctioned JSON-artifact writer (same
  // JSON.stringify(x, null, 2) content). jsonStr is still computed for the blob upload below.
  writeJsonArtifact(fullPath, evidence);
  const jsonStr = JSON.stringify(evidence, null, 2);

  let blobUrl: string | undefined;
  if (evidenceStorage) {
    const blobPath = stampedBlobPath(evidenceStorage.base_path, evidFile);
    const result = await uploadEvidenceBlob(evidenceStorage, blobPath, jsonStr);
    if (result.success) {
      blobUrl = result.url;
    } else {
      console.warn('[blob-upload] Failed:', result.error, 'path:', blobPath);
    }
  }

  return { localPath: fullPath, blobUrl };
}
