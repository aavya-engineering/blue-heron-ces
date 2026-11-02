// @vitest-environment jsdom
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// Unit tests for the harvest-prefill helpers (localStorage seam, pure functions).
// No network calls — no fetch stub needed.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadHarvestFacts, applyHarvestFacts, storeHarvestFacts } from '../assessmentHelpers';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  localStorage.clear();
});

// ── loadHarvestFacts ─────────────────────────────────────────────────────

describe('loadHarvestFacts', () => {
  it('returns empty array when key absent', () => {
    expect(loadHarvestFacts()).toEqual([]);
  });

  it('returns empty array when value is empty string', () => {
    localStorage.setItem('muster-harvest-facts', '');
    expect(loadHarvestFacts()).toEqual([]);
  });

  it('returns empty array for invalid JSON', () => {
    localStorage.setItem('muster-harvest-facts', 'not-json{{{');
    expect(loadHarvestFacts()).toEqual([]);
  });

  it('returns empty array when JSON is not an array', () => {
    localStorage.setItem('muster-harvest-facts', JSON.stringify({ question_id: 'x' }));
    expect(loadHarvestFacts()).toEqual([]);
  });

  it('returns valid harvest facts', () => {
    const facts = [
      {
        question_id: 'iam-001',
        answer: 'yes',
        provenance: 'auto_detected',
        confidence: 'high',
        source: 'graph:mfa_probe',
      },
    ];
    localStorage.setItem('muster-harvest-facts', JSON.stringify(facts));
    const result = loadHarvestFacts();
    expect(result).toHaveLength(1);
    expect(result[0].question_id).toBe('iam-001');
    expect(result[0].source).toBe('graph:mfa_probe');
  });

  it('filters out items missing required fields', () => {
    const mixed = [
      {
        question_id: 'iam-001',
        answer: 'yes',
        provenance: 'auto_detected',
        confidence: 'high',
        source: 'graph:mfa_probe',
      },
      { question_id: 'bad' }, // missing required fields
      null,
      42,
    ];
    localStorage.setItem('muster-harvest-facts', JSON.stringify(mixed));
    const result = loadHarvestFacts();
    expect(result).toHaveLength(1);
    expect(result[0].question_id).toBe('iam-001');
  });

  it('filters out items with wrong provenance', () => {
    const facts = [
      {
        question_id: 'iam-001',
        answer: 'yes',
        provenance: 'operator_interview', // wrong — must be auto_detected
        confidence: 'high',
        source: 'graph:mfa_probe',
      },
    ];
    localStorage.setItem('muster-harvest-facts', JSON.stringify(facts));
    expect(loadHarvestFacts()).toEqual([]);
  });
});

// ── applyHarvestFacts ─────────────────────────────────────────────────────

describe('applyHarvestFacts', () => {
  const harvestFacts = [
    {
      question_id: 'iam-001',
      answer: 'yes',
      provenance: 'auto_detected' as const,
      confidence: 'high' as const,
      source: 'graph:mfa_probe',
    },
    {
      question_id: 'ep-001',
      answer: 'no',
      provenance: 'auto_detected' as const,
      confidence: 'medium' as const,
      source: 'graph:mdm_probe',
    },
  ];

  it('pre-fills answers from harvest facts', () => {
    const result = applyHarvestFacts(harvestFacts, {});
    expect(result.answers['iam-001']).toBe('yes');
    expect(result.answers['ep-001']).toBe('no');
  });

  it('sets provenance to auto_detected for each pre-filled fact', () => {
    const result = applyHarvestFacts(harvestFacts, {});
    expect(result.provenances['iam-001']).toBe('auto_detected');
    expect(result.provenances['ep-001']).toBe('auto_detected');
  });

  it('carries confidence from harvest facts', () => {
    const result = applyHarvestFacts(harvestFacts, {});
    expect(result.confidences['iam-001']).toBe('high');
    expect(result.confidences['ep-001']).toBe('medium');
  });

  it('carries source string for display', () => {
    const result = applyHarvestFacts(harvestFacts, {});
    expect(result.sources['iam-001']).toBe('graph:mfa_probe');
  });

  it('does NOT overwrite an existing answer for the same question', () => {
    const existing = { 'iam-001': 'no' }; // user previously answered
    const result = applyHarvestFacts(harvestFacts, existing);
    expect(result.answers['iam-001']).toBeUndefined();
    expect(result.answers['ep-001']).toBe('no'); // only ep-001 is new
  });

  it('returns empty maps for empty harvest facts', () => {
    const result = applyHarvestFacts([], {});
    expect(result.answers).toEqual({});
    expect(result.provenances).toEqual({});
    expect(result.confidences).toEqual({});
    expect(result.sources).toEqual({});
  });
});

// ── W4-MU2 (MU-06): the write half of the seam ─────────────────────────────

describe('storeHarvestFacts', () => {
  it('writes the store loadHarvestFacts reads, keeping only well-formed harvest facts', () => {
    const good = {
      question_id: 'ep-001',
      answer: 'yes',
      provenance: 'auto_detected',
      confidence: 'high',
      captured_at: '2026-09-27T00:00:00.000Z',
      source: 'graph:intuneDevices',
    };
    const stored = storeHarvestFacts([good, { question_id: 'bad' }, null]);
    expect(stored).toBe(1);
    expect(loadHarvestFacts()).toEqual([good]);
    expect(applyHarvestFacts(loadHarvestFacts(), {}).answers).toEqual({ 'ep-001': 'yes' });
  });
});
