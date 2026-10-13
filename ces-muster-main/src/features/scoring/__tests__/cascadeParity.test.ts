// @vitest-environment node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// Cascade parity — proves the full deriveActionStatuses → generateReadinessPosture path
// produces the same results the ces-planner vendored spine would produce for identical inputs.
// Uses readFileSync + js-yaml to load real YAML knowledge files (no fetch in tests).
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { load } from 'js-yaml';
import { deriveActionStatuses, convertToRRTAnswers } from '@/vendored/ces-spine/services/bulkAnswerDerivation';
import { generateReadinessPosture } from '@/vendored/ces-spine/services/postureGenerator';
import { computeConservativeScore } from '../scoringService';
import type { PreambleAnswers } from '@/vendored/ces-spine/types/rrt';
import type { ImplementationPatterns, VendorPlaybook } from '@/vendored/ces-spine/types/domain';

// Load real knowledge files once — same files the browser fetches from /knowledge/
const patterns = load(
  readFileSync(resolve('public/knowledge/domain Implementation Patterns.yaml'), 'utf-8')
) as ImplementationPatterns;
const playbook = load(
  readFileSync(resolve('public/knowledge/vendor playbook Microsoft 365.yaml'), 'utf-8')
) as VendorPlaybook;

const GREENFIELD_E3: PreambleAnswers = {
  license_tier: 'e3',
  security_archetype: 'greenfield',
  endpoint_management: 'unmanaged',
  monitoring_siem: 'none',
  policy_doc_state: 'nothing_written',
};

const MODERATE_E5: PreambleAnswers = {
  license_tier: 'gcc_g5',
  security_archetype: 'moderate_hardening',
  endpoint_management: 'intune_enrolled',
  monitoring_siem: 'sentinel_deployed',
  policy_doc_state: 'ssp_with_policies',
};

describe('Cascade parity — deriveActionStatuses + generateReadinessPosture', () => {
  test('loads real YAML patterns and playbook with non-zero action counts', () => {
    expect(patterns.patterns.length).toBeGreaterThan(0);
    expect(playbook.playbook.length).toBeGreaterThan(0);
    expect(patterns.ces.artifact).toBe('implementation_patterns');
    expect(playbook.ces.artifact).toBe('vendor_playbook');
  });

  test('greenfield/E3: cascade produces no partial or implemented statuses', () => {
    const actionStatuses = deriveActionStatuses(patterns, playbook, GREENFIELD_E3, {});
    expect(actionStatuses.length).toBeGreaterThan(0);

    // Greenfield archetype: configure/customize/manual all map to not_implemented.
    // Only license_gate (E5-gated) yields not_applicable; inherent platform actions
    // yield implemented (those are structural, not assessment findings).
    // No action should be 'partial' for pure greenfield.
    const partial = actionStatuses.filter((a) => a.status === 'partial');
    expect(partial).toHaveLength(0);

    // E5-gated services yield not_applicable via license_gate
    const licenseGated = actionStatuses.filter((a) => a.derivation_source === 'license_gate');
    expect(licenseGated.length).toBeGreaterThan(0);
    for (const a of licenseGated) {
      expect(a.status).toBe('not_applicable');
    }
  });

  test('moderate/GCC-G5: cascade produces partial statuses (preamble overrides fire)', () => {
    const actionStatuses = deriveActionStatuses(patterns, playbook, MODERATE_E5, {});
    // Moderate hardening + GCC-G5: endpoint + monitoring + IAM preamble overrides fire
    const partial = actionStatuses.filter((a) => a.status === 'partial');
    expect(partial.length).toBeGreaterThan(0);

    // Preamble overrides for endpoint management should appear
    const preambleOverrides = actionStatuses.filter(
      (a) => a.derivation_source === 'preamble_override'
    );
    expect(preambleOverrides.length).toBeGreaterThan(0);
  });

  test('greenfield/E3 full cascade → posture: score = 0 (all applicable actions are not_implemented)', () => {
    const actionStatuses = deriveActionStatuses(patterns, playbook, GREENFIELD_E3, {});
    const answers = convertToRRTAnswers(actionStatuses);
    const posture = generateReadinessPosture(answers, [], {}, {});
    const score = computeConservativeScore(posture);

    // Greenfield: not_implemented → not_met in posture; score = 0
    expect(score).toBe(0);
    expect(posture.ces.control_status_summary.met).toBe(0);
    // Should have not_met requirements (cascade found gaps)
    expect(posture.ces.control_status_summary.not_met).toBeGreaterThan(0);
  });

  test('moderate/GCC-G5 full cascade → posture: partial requirements present (preamble overrides)', () => {
    // NOTE: The postureGenerator has a merge-quirk (characterization test documents it):
    // an initial 'unknown' merged with 'met' returns 'unknown' — lone 'implemented'
    // actions cannot promote a requirement to 'met'. This is the vendored behavior.
    // Partial answers DO survive the merge (partial outranks unknown).
    const actionStatuses = deriveActionStatuses(patterns, playbook, MODERATE_E5, {});
    const answers = convertToRRTAnswers(actionStatuses);
    const posture = generateReadinessPosture(answers, [], {}, {});

    // Partial preamble overrides (endpoint, monitoring) produce 'partial' in the posture
    expect(posture.ces.control_status_summary.partial).toBeGreaterThan(0);
    // Score > 0 only if met > 0; with the merge quirk, score may be 0 for lone actions
    // but there should be fewer not_met than in the greenfield case
    const greenfieldStatuses = deriveActionStatuses(patterns, playbook, GREENFIELD_E3, {});
    const greenfieldAnswers = convertToRRTAnswers(greenfieldStatuses);
    const greenfieldPosture = generateReadinessPosture(greenfieldAnswers, [], {}, {});
    expect(posture.ces.control_status_summary.not_met).toBeLessThan(
      greenfieldPosture.ces.control_status_summary.not_met
    );
  });

  test('cascade output is deterministic — same inputs produce identical action_ids and statuses', () => {
    const run1 = deriveActionStatuses(patterns, playbook, GREENFIELD_E3, {});
    const run2 = deriveActionStatuses(patterns, playbook, GREENFIELD_E3, {});

    expect(run1.length).toBe(run2.length);
    for (let i = 0; i < run1.length; i++) {
      expect(run1[i].action_id).toBe(run2[i].action_id);
      expect(run1[i].status).toBe(run2[i].status);
      expect(run1[i].derivation_source).toBe(run2[i].derivation_source);
    }
  });

  test('convertToRRTAnswers excludes not_applicable actions from posture inputs', () => {
    const actionStatuses = deriveActionStatuses(patterns, playbook, GREENFIELD_E3, {});
    const answers = convertToRRTAnswers(actionStatuses);

    // not_applicable actions should not appear in the RRTAnswer map
    const notApplicable = actionStatuses.filter((a) => a.status === 'not_applicable');
    for (const action of notApplicable) {
      expect(Object.prototype.hasOwnProperty.call(answers, action.action_id)).toBe(false);
    }
  });
});
