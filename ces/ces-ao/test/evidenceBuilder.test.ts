// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { describe, it, expect } from 'vitest';
import { assessOutcome, deriveVerdict, classifyFailure } from '../src/utils/evidenceBuilder.js';
import type { VerificationResult } from '../src/types/StamperTypes.js';

function verif(p: Partial<VerificationResult>): VerificationResult {
  return {
    passed: false,
    confidence: 'LOW',
    score: 0,
    details: { exit_code_check: true, set_output_check: null, evidence_check: null },
    reason: '',
    ...p,
  };
}

// Characterization tests for evidence outcome / verdict / failure classification.
describe('assessOutcome', () => {
  it('exit code 0 with no verificationResult -> automated_success', () => {
    expect(assessOutcome(0, '', 'ok')).toBe('automated_success');
  });

  it('non-zero exit + FATAL failure (403) -> failed_no_remediation', () => {
    expect(assessOutcome(1, '403 Forbidden', 'out')).toBe('failed_no_remediation');
  });

  it('non-zero exit + RETRIABLE failure (429) -> failed_remediation_available', () => {
    expect(assessOutcome(1, '429 too many requests', 'out')).toBe('failed_remediation_available');
  });

  it('exit 0 + HIGH-confidence state verification -> automated_success', () => {
    const r = verif({
      passed: true,
      confidence: 'HIGH',
      score: 95,
      stateVerificationDetails: { method: 'exit_code_only', confidence: 'HIGH', confidenceScore: 95 },
    });
    expect(assessOutcome(0, '', 'out', r)).toBe('automated_success');
  });

  it('exit 0 + low confidence + eventual-consistency reason -> verification_pending', () => {
    const r = verif({ reason: 'verification_pending_eventual_consistency' });
    expect(assessOutcome(0, '', 'out', r)).toBe('verification_pending');
  });

  it('exit 0 + idempotent_no_change reason -> automated_success', () => {
    const r = verif({ reason: 'idempotent_no_change' });
    expect(assessOutcome(0, '', 'out', r)).toBe('automated_success');
  });
});

describe('deriveVerdict', () => {
  it('automated_success -> SAT', () => {
    expect(deriveVerdict('automated_success').verdict).toBe('SAT');
  });

  it('not_applicable (a SAT outcome) -> SAT', () => {
    expect(deriveVerdict('not_applicable').verdict).toBe('SAT');
  });

  it('failed_no_remediation -> NOT_SAT', () => {
    expect(deriveVerdict('failed_no_remediation').verdict).toBe('NOT_SAT');
  });

  it('verification_pending -> NOT_SAT with retry rationale', () => {
    const r = deriveVerdict('verification_pending');
    expect(r.verdict).toBe('NOT_SAT');
    expect(r.rationale).toContain('Verification pending');
  });

  it('promotes a failed outcome to SAT when verification passed HIGH and score >= 90', () => {
    const r = deriveVerdict('failed_no_remediation', verif({ passed: true, confidence: 'HIGH', score: 95, reason: 'verified compliant' }));
    expect(r.verdict).toBe('SAT');
    expect(r.rationale).toBe('verified compliant');
  });

  it('demotes to NOT_SAT when verification did not pass', () => {
    const r = deriveVerdict('automated_success', verif({ passed: false, confidence: 'MEDIUM', score: 70, reason: 'mismatch' }));
    expect(r.verdict).toBe('NOT_SAT');
    expect(r.rationale).toContain('Content verification failed: mismatch');
  });

  it('demotes to NOT_SAT when passed but confidence FAILED / low score', () => {
    const r = deriveVerdict('automated_success', verif({ passed: true, confidence: 'FAILED', score: 50, reason: 'low' }));
    expect(r.verdict).toBe('NOT_SAT');
    expect(r.rationale).toContain('insufficient for SAT');
  });
});

describe('classifyFailure', () => {
  it('429/throttle -> rate_limit / RETRIABLE', () => {
    const d = classifyFailure(1, '429 throttle', '');
    expect(d.rootCause).toBe('rate_limit');
    expect(d.failureCategory).toBe('RETRIABLE');
  });

  it('connection reset -> transient_network / RETRIABLE', () => {
    const d = classifyFailure(1, 'connection reset', '');
    expect(d.rootCause).toBe('transient_network');
    expect(d.failureCategory).toBe('RETRIABLE');
  });

  it('400 bad request -> validation / CONFIGURATION', () => {
    const d = classifyFailure(1, '400 bad request', '');
    expect(d.rootCause).toBe('validation');
    expect(d.failureCategory).toBe('CONFIGURATION');
  });

  it('Access Denied -> permissions / FATAL', () => {
    const d = classifyFailure(1, 'Access Denied', '');
    expect(d.rootCause).toBe('permissions');
    expect(d.failureCategory).toBe('FATAL');
  });

  it('resource not found -> resource_missing / FATAL', () => {
    const d = classifyFailure(1, 'resource not found', '');
    expect(d.rootCause).toBe('resource_missing');
    expect(d.failureCategory).toBe('FATAL');
  });

  it('unrecognized error -> exit_code_<n> / FATAL default', () => {
    const d = classifyFailure(7, 'weird', '');
    expect(d.rootCause).toBe('exit_code_7');
    expect(d.failureCategory).toBe('FATAL');
  });
});
