// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// G13 — Slice 3: Google Workspace evaluator tests.
import { describe, test, expect } from '@jest/globals';
import { googleWorkspaceEvaluators } from '../../../src/eo/mapping/evaluators/googleWorkspaceEvaluators.js';
import {
  selectEvaluatorRegistry,
  GOOGLE_EVALUATOR_SET_ID,
} from '../../../src/eo/mapping/evaluators/index.js';
import type { SignalResult } from 'ces-shared/types/signal';

function makeSignal(data: Record<string, unknown>): SignalResult {
  // Google signal data lands in `rawData` (per ComplianceSignalFetcher + SignalResult type);
  // the evaluator reads rawData. (G-ENG-3: fixed from the phantom `data` field that made the
  // production 2SV-enforced path dead code.)
  return {
    signalId: 'google-2sv-signal',
    source: 'graph',
    endpoint: '/admin/directory/v1/users',
    timestamp: new Date().toISOString(),
    status: 'success',
    rawData: data,
  };
}

describe('google_2sv_enforced_evaluator', () => {
  const evaluator = googleWorkspaceEvaluators['google_2sv_enforced_evaluator'];

  test('returns status: met when enforcedForAllUsers is true', () => {
    const result = evaluator([makeSignal({ enforcedForAllUsers: true })]);
    expect(result.status).toBe('met');
    expect(typeof result.evidence).toBe('string');
    expect(result.evidence.length).toBeGreaterThan(0);
  });

  test('returns status: met when isEnforcedIn2Sv is true', () => {
    const result = evaluator([makeSignal({ isEnforcedIn2Sv: true })]);
    expect(result.status).toBe('met');
  });

  test('returns status: not_met when enforcedForAllUsers is false', () => {
    const result = evaluator([makeSignal({ enforcedForAllUsers: false })]);
    expect(result.status).toBe('not_met');
    expect(typeof result.evidence).toBe('string');
  });

  test('returns status: not_met when isEnforcedIn2Sv is false', () => {
    const result = evaluator([makeSignal({ isEnforcedIn2Sv: false })]);
    expect(result.status).toBe('not_met');
  });

  test('returns status: not_met when signals array is empty', () => {
    const result = evaluator([]);
    expect(result.status).toBe('not_met');
  });

  test('returns status: not_met when data property is absent', () => {
    const signal: SignalResult = {
      signalId: 'no-data',
      source: 'graph',
      endpoint: '/admin/directory/v1/users',
      timestamp: new Date().toISOString(),
      status: 'success',
      rawData: null,
    };
    const result = evaluator([signal]);
    expect(result.status).toBe('not_met');
  });
});

describe('selectEvaluatorRegistry with GOOGLE_EVALUATOR_SET_ID', () => {
  test('returns a non-empty registry for google-workspace-evaluators', () => {
    const registry = selectEvaluatorRegistry(GOOGLE_EVALUATOR_SET_ID);
    expect(typeof registry).toBe('object');
    expect(Object.keys(registry).length).toBeGreaterThan(0);
  });

  test('google registry contains evaluator for IA.L2-3.5.3 (google_2sv_enforced_evaluator)', () => {
    const registry = selectEvaluatorRegistry(GOOGLE_EVALUATOR_SET_ID);
    expect(typeof registry['google_2sv_enforced_evaluator']).toBe('function');
  });

  test('GOOGLE_EVALUATOR_SET_ID constant equals google-workspace-evaluators', () => {
    expect(GOOGLE_EVALUATOR_SET_ID).toBe('google-workspace-evaluators');
  });
});
