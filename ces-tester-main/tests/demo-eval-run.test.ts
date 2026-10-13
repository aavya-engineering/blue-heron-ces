// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

// GP-DEMO-2 M2/M3 — the evaluation-mode leg's pure diff + config-loading
// helpers. runEvalConfig itself is live (seeds+serves stacksim, spawns the
// muster discovery CLI) and is exercised by the live gate run, not here.
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { diffPostures, isValidEvalConfigFile, loadEvalConfigFile } from '../src/demo/eval-run.js';

describe('diffPostures', () => {
  it('matches every control when observed postures equal expected', () => {
    const result = diffPostures(
      { 'AC.L2-3.1.11': 'met', 'AC.L2-3.1.12': 'unknown' },
      [
        { control_id: 'AC.L2-3.1.11', derived_posture: 'met' },
        { control_id: 'AC.L2-3.1.12', derived_posture: 'unknown' },
      ],
    );
    expect(result.pass).toBe(true);
    expect(result.matches).toEqual(['AC.L2-3.1.11', 'AC.L2-3.1.12']);
    expect(result.mismatches).toHaveLength(0);
  });

  it('reports a mismatch when the observed posture disagrees with expected', () => {
    const result = diffPostures(
      { 'AC.L2-3.1.11': 'met' },
      [{ control_id: 'AC.L2-3.1.11', derived_posture: 'unknown' }],
    );
    expect(result.pass).toBe(false);
    expect(result.mismatches).toEqual([{ control: 'AC.L2-3.1.11', expected: 'met', actual: 'unknown' }]);
    expect(result.matches).toHaveLength(0);
  });

  it('reports actual "missing" when an expected control has no observation row at all', () => {
    const result = diffPostures({ 'AC.L2-3.1.11': 'met' }, []);
    expect(result.pass).toBe(false);
    expect(result.mismatches).toEqual([{ control: 'AC.L2-3.1.11', expected: 'met', actual: 'missing' }]);
  });

  it('ignores observation rows for controls not in the expected block', () => {
    const result = diffPostures(
      { 'AC.L2-3.1.11': 'met' },
      [
        { control_id: 'AC.L2-3.1.11', derived_posture: 'met' },
        { control_id: 'SOME.OTHER-1', derived_posture: 'not_met' },
      ],
    );
    expect(result.pass).toBe(true);
    expect(result.matches).toEqual(['AC.L2-3.1.11']);
  });

  it('an empty expected block trivially passes', () => {
    const result = diffPostures({}, [{ control_id: 'X', derived_posture: 'met' }]);
    expect(result.pass).toBe(true);
    expect(result.matches).toHaveLength(0);
    expect(result.mismatches).toHaveLength(0);
  });
});

describe('isValidEvalConfigFile', () => {
  const VALID = {
    config_id: 'eval-bare',
    description: 'test',
    stacksim_seed: { stance: 'm365_azure', countOverrides: {}, steps: [] },
    expected_discovery: { 'AC.L2-3.1.11': 'unknown' },
  };

  it('accepts a well-formed config file', () => {
    expect(isValidEvalConfigFile(VALID)).toBe(true);
  });

  it('rejects a missing config_id', () => {
    const { config_id, ...rest } = VALID;
    expect(isValidEvalConfigFile(rest)).toBe(false);
  });

  it('rejects an expected_discovery value outside met|unknown', () => {
    expect(
      isValidEvalConfigFile({ ...VALID, expected_discovery: { 'AC.L2-3.1.11': 'not_met' } }),
    ).toBe(false);
  });

  it('rejects a missing stacksim_seed', () => {
    const { stacksim_seed, ...rest } = VALID;
    expect(isValidEvalConfigFile(rest)).toBe(false);
  });

  it('rejects non-object input', () => {
    expect(isValidEvalConfigFile(null)).toBe(false);
    expect(isValidEvalConfigFile('nope')).toBe(false);
  });
});

describe('loadEvalConfigFile', () => {
  it('throws a loud, file-path-prefixed error for a nonexistent file', async () => {
    await expect(loadEvalConfigFile(path.resolve('scenarios/eval/does-not-exist.json'))).rejects.toThrow();
  });

  it('loads a real eval config file from scenarios/eval', async () => {
    const filePath = path.resolve('scenarios/eval/t1-eval-bare.json');
    const config = await loadEvalConfigFile(filePath);
    expect(config.config_id).toBe('eval-bare');
    expect(config.stacksim_seed.stance).toBe('m365_azure');
  });
});
