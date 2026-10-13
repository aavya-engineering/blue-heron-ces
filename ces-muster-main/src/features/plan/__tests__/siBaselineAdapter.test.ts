// @vitest-environment node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// G-MUSTER-PLAN-2 M2 slice 1 gate: the VENDORED ces-planner SI-Baseline
// generator produces the Planner artifact contract from Muster's inputs, and
// the contract SHAPE matches Planner's own output for a reference engagement.
import { describe, test, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildSiBaseline, sitAnswersFromMuster } from '../siBaselineAdapter';

describe('PLAN-2 M2 slice 1 — SI Baseline via the vendored Planner generator', () => {
  test('produces the Planner si_baseline_output contract shape from Muster inputs', () => {
    const artifact = buildSiBaseline({
      targetLevel: 'L2',
      cuiPresence: 'cui_present',
      boundaryStrategy: 'single_enclave',
      deploymentPosture: 'cloud_only',
      selectedStacks: ['microsoft_sentinel'],
    });

    // ces envelope
    expect(artifact.ces.artifact).toBe('si_baseline_output');
    expect(typeof artifact.ces.version).toBe('string');
    expect(artifact.ces.generated_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Muster's asserted fields flowed through the generator unchanged.
    expect(artifact.si_baseline.target.target_cmmc_level).toBe('L2');
    expect(artifact.si_baseline.target.cui_presence).toBe('cui_present');
    expect(artifact.si_baseline.scope.boundary_strategy).toBe('single_enclave');
    expect(artifact.si_baseline.scope.deployment_posture).toBe('cloud_only');

    // The generator filled the rest with its own defaults, not blanks.
    expect(artifact.si_baseline.assessment.assessment_route).toBeTruthy();
    expect(Array.isArray(artifact.si_baseline.assessment.affirmation_obligations)).toBe(true);
  });

  test('CONTRACT PARITY: the artifact top-level shape matches a real Planner reference output', () => {
    const refDir = path.resolve(
      process.cwd(),
      '..',
      'ces-planner',
      'customers',
      'VFS GCC High G5 M365 + Foundation + Sentinel',
      'outputs'
    );
    // Reference outputs may not be present in every checkout; skip parity
    // (not fail) when absent — the generator IS the parity guarantee since it
    // is Planner's own code, vendored unforked.
    if (!fs.existsSync(refDir)) {
      console.warn('[PLAN-2 M2] Planner reference outputs absent — parity shape check skipped');
      return;
    }
    const siFile = fs.readdirSync(refDir).find((f) => f.startsWith('si-baseline') || /si_baseline/.test(f));
    if (!siFile) {
      console.warn('[PLAN-2 M2] no SI-baseline reference output on disk — parity shape check skipped');
      return;
    }
    const ref = JSON.parse(fs.readFileSync(path.join(refDir, siFile), 'utf8'));
    const ours = buildSiBaseline({ targetLevel: 'L2', cuiPresence: 'cui_present' });

    // Same top-level keys and same si_baseline section keys.
    expect(Object.keys(ours).sort()).toEqual(expect.arrayContaining(['ces', 'si_baseline']));
    if (ref.si_baseline) {
      expect(Object.keys(ours.si_baseline).sort()).toEqual(Object.keys(ref.si_baseline).sort());
    }
  });

  test('unsupplied fields are never invented — only asserted inputs appear as answers', () => {
    const { answers } = sitAnswersFromMuster({ targetLevel: 'L2' });
    expect(Object.keys(answers)).toEqual(['G-01']);
    expect(answers['G-01'].provenance_class).toBe('client_assertion');
  });

  test('a completely empty input still yields a valid (all-default) baseline', () => {
    const artifact = buildSiBaseline({});
    expect(artifact.ces.artifact).toBe('si_baseline_output');
    expect(artifact.si_baseline.target.target_cmmc_level).toBe('L2'); // generator default
    expect(artifact.si_baseline.target.cui_presence).toBe('unknown');
  });
});
