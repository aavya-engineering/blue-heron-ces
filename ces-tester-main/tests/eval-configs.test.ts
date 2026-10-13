// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

// GP-DEMO-2 M2 — the 5 eval config files (docs/demo/EVAL-CONFIGS.md T1-T5)
// load and shape-check correctly. Ground-truth CORRECTNESS (does the live
// discovery walk actually read what these files claim) is the live gate's
// job, not this file's — this only guards the fixtures themselves.
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { discoverScenarioFiles } from '../src/scenarios/scenarioFile.js';
import { loadEvalConfigFile, type EvalConfigFile } from '../src/demo/eval-run.js';

const EVAL_DIR = path.resolve('scenarios', 'eval');
// discoverScenarioFiles is filename-sorted, so the 3 GP-DEMO-3 full-chain
// configs (`eval-*.json`) sort BEFORE the five `t*-*.json` T-configs.
const EXPECTED_IDS = [
  'eval-decoy-maze',
  'eval-fresh-gap',
  'eval-scope-boundary',
  'eval-bare',
  'eval-identity-first',
  'eval-half-configured',
  'eval-mostly-hardened',
  'eval-decoys',
];

describe('scenarios/eval config files', () => {
  it('discovers all 8 config files (3 GP-DEMO-3 full-chain + T1-T5), filename-sorted', async () => {
    const files = await discoverScenarioFiles(EVAL_DIR);
    expect(files).toHaveLength(8);
    expect(files.map((f) => path.basename(f))).toEqual([
      'eval-decoy-maze.json',
      'eval-fresh-gap.json',
      'eval-scope-boundary.json',
      't1-eval-bare.json',
      't2-eval-identity-first.json',
      't3-eval-half-configured.json',
      't4-eval-mostly-hardened.json',
      't5-eval-decoys.json',
    ]);
  });

  it('all 8 load as valid eval config files with the expected config_ids', async () => {
    const files = await discoverScenarioFiles(EVAL_DIR);
    const configs: EvalConfigFile[] = [];
    for (const f of files) configs.push(await loadEvalConfigFile(f));
    expect(configs.map((c) => c.config_id)).toEqual(EXPECTED_IDS);
  });

  it('every expected_discovery value is met|unknown (never not_met — DISCOVERY-1 is presence-based)', async () => {
    const files = await discoverScenarioFiles(EVAL_DIR);
    for (const f of files) {
      const config = await loadEvalConfigFile(f);
      for (const [control, posture] of Object.entries(config.expected_discovery)) {
        expect(['met', 'unknown'], `${config.config_id} / ${control}`).toContain(posture);
      }
    }
  });

  it('every config carries the two negative controls (N1/N2) as unknown', async () => {
    const files = await discoverScenarioFiles(EVAL_DIR);
    for (const f of files) {
      const config = await loadEvalConfigFile(f);
      expect(config.expected_discovery['AC.L2-3.1.12'], config.config_id).toBe('unknown');
      expect(config.expected_discovery['IA.L2-3.5.4'], config.config_id).toBe('unknown');
    }
  });

  it('T1 (eval-bare) zeroes CA/users/crossTenant and expects the honest all-unknown', async () => {
    const config = await loadEvalConfigFile(path.join(EVAL_DIR, 't1-eval-bare.json'));
    expect(config.stacksim_seed.countOverrides).toEqual({ caPolicies: 0, users: 0, crossTenantAccessPolicy: 0 });
    expect(config.stacksim_seed.steps).toEqual([]);
    // AC.L2-3.1.20 dropped from the probe set (entries emit no observation —
    // REQ-STACKSIM-GRAPH-CMDLET-IN-EXO-MODULE); L1-3.1.20 remains.
    expect(config.expected_discovery['AC.L2-3.1.20']).toBeUndefined();
    expect(config.expected_discovery['AC.L1-3.1.20']).toBe('unknown');
    expect(config.expected_discovery['AC.L2-3.1.11']).toBe('unknown');
  });

  it('T5 (eval-decoys) renames CA policies to NON-CMMC decoy names, not the CMMC-required displayNames', async () => {
    const config = await loadEvalConfigFile(path.join(EVAL_DIR, 't5-eval-decoys.json'));
    const displayNames = (config.stacksim_seed.steps ?? [])
      .filter((s) => s.uri.includes('/conditionalAccess/policies/'))
      .map((s) => (s.body as { displayName?: string }).displayName);
    expect(displayNames).toEqual(['Legacy-MFA', 'Pilot-CA', 'Block-Old-TLS']);
    for (const name of displayNames) {
      expect(name).not.toMatch(/^CMMC-/);
    }
    // The trap: every CA-name probe still reads unknown despite policies existing.
    // (AC.L2-3.1.18 dropped from the probe set — its control aggregate is met in
    // every config via the always-seeded signIns evidence entry; live-adjudicated.)
    for (const control of ['AC.L2-3.1.11', 'AC.L2-3.1.14', 'SC.L2-3.13.7', 'AC.L2-3.1.15', 'MA.L2-3.7.5']) {
      expect(config.expected_discovery[control], control).toBe('unknown');
    }
    expect(config.expected_discovery['AC.L2-3.1.18']).toBeUndefined();
    // But the trap is scoped — unrelated probes still credit correctly.
    expect(config.expected_discovery['PS.L2-3.9.2']).toBe('met');
  });

  it('T4 (eval-mostly-hardened) names all 5 CMMC CA policies and expects P1-P5 all met', async () => {
    const config = await loadEvalConfigFile(path.join(EVAL_DIR, 't4-eval-mostly-hardened.json'));
    const displayNames = (config.stacksim_seed.steps ?? [])
      .filter((s) => s.uri.includes('/conditionalAccess/policies/'))
      .map((s) => (s.body as { displayName?: string }).displayName);
    expect(displayNames).toHaveLength(5);
    for (const name of displayNames) expect(name).toMatch(/^CMMC-/);
    // AC.L2-3.1.18 dropped (non-discriminating control aggregate — see T5 note).
    for (const control of ['AC.L2-3.1.11', 'AC.L2-3.1.14', 'SC.L2-3.13.7', 'AC.L2-3.1.15', 'MA.L2-3.7.5']) {
      expect(config.expected_discovery[control], control).toBe('met');
    }
  });
});
