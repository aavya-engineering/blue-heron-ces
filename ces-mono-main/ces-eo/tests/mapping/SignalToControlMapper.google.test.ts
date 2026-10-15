// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// G13 — Slice 2: Google control-signal registry content and path resolution.
//
// DEVIATION from plan: `new SignalToControlMapper(registryPath)` cannot be called under ts-jest
// because SignalToControlMapper.ts:50 uses `const require = createRequire(import.meta.url)` which
// the jest-import-meta-transformer rewrites to `const require = createRequire(require('url')...)`
// — a temporal dead zone error. The existing test file for SignalToControlMapper also avoids
// instantiating the class directly for the same reason. We test registry content and the evaluator
// pipeline directly instead, which covers the DONE-WHEN criteria for Slice 2.
import { describe, test, expect } from '@jest/globals';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import type { SignalResult } from 'ces-shared/types/signal';
import { googleWorkspaceEvaluators } from '../../src/eo/mapping/evaluators/googleWorkspaceEvaluators.js';

const _require = createRequire(__filename);

describe('Google control-signal registry content (Slice 2)', () => {
  test('Microsoft registry id resolves to a valid file', () => {
    const p = _require.resolve('ces-shared/data/control-signal-registry');
    expect(typeof p).toBe('string');
    expect(fs.existsSync(p)).toBe(true);
  });

  test('Google registry id resolves to a valid file', () => {
    const p = _require.resolve('ces-shared/data/google-workspace-control-signal-registry');
    expect(typeof p).toBe('string');
    expect(fs.existsSync(p)).toBe(true);
  });

  test('Google registry JSON has IA.L2-3.5.3 entry with correct structure', () => {
    const p = _require.resolve('ces-shared/data/google-workspace-control-signal-registry');
    const registry = JSON.parse(fs.readFileSync(p, 'utf-8'));
    expect(registry['IA.L2-3.5.3']).toBeDefined();
    expect(registry['IA.L2-3.5.3'].evaluator).toBe('google_2sv_enforced_evaluator');
    expect(Array.isArray(registry['IA.L2-3.5.3'].signals)).toBe(true);
    expect(registry['IA.L2-3.5.3'].signals.length).toBeGreaterThan(0);
    expect(typeof registry['IA.L2-3.5.3'].title).toBe('string');
    expect(typeof registry['IA.L2-3.5.3'].source).toBe('string');
  });

  test('Google registry signal has required type and endpoint fields (same shape as Microsoft entries)', () => {
    const p = _require.resolve('ces-shared/data/google-workspace-control-signal-registry');
    const registry = JSON.parse(fs.readFileSync(p, 'utf-8'));
    const signal = registry['IA.L2-3.5.3'].signals[0];
    expect(typeof signal.type).toBe('string');
    expect(typeof signal.endpoint).toBe('string');
    expect(signal.required).toBe(true);
  });

  test('registry evaluator name resolves to a REAL evaluator that returns met when 2SV is enforced', () => {
    // Binding test: the evaluator name declared in the registry JSON must resolve to an actual
    // evaluator in googleWorkspaceEvaluators (the same lookup SignalToControlMapper performs), and
    // that real evaluator must report 'met' for an enforced-2SV signal. This exercises the real code,
    // not an inline copy.
    const p = _require.resolve('ces-shared/data/google-workspace-control-signal-registry');
    const registry = JSON.parse(fs.readFileSync(p, 'utf-8'));
    const evaluatorName: string = registry['IA.L2-3.5.3'].evaluator;

    const evaluator = (googleWorkspaceEvaluators as Record<string, (s: SignalResult[]) => { status: string; evidence: string }>)[evaluatorName];
    expect(typeof evaluator).toBe('function');

    const signal: SignalResult = {
      signalId: 'google-2sv-enforced-signal',
      source: 'graph',
      endpoint: '/admin/directory/v1/users',
      timestamp: new Date().toISOString(),
      status: 'success',
      rawData: { isEnforcedIn2Sv: true, enforcedForAllUsers: true },
    };

    const result = evaluator([signal]);
    expect(result.status).toBe('met');
    expect(result.evidence).toContain('IA.L2-3.5.3');
  });
});
