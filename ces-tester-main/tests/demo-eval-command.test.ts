// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

// GP-DEMO-2 M5 — `demo:eval` CLI arg parsing (pure; no live servers, no
// process spawning — runDemoEvalCommand itself is exercised by the live
// gate run).
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { parseDemoEvalArgs } from '../src/cli/demo-command.js';

const TESTER_ROOT = path.resolve('/ces/ces-tester');
const CES_ROOT = path.resolve('/ces');

describe('parseDemoEvalArgs', () => {
  it('defaults muster/stacksim/stamper roots to ces-tester siblings, no --config, not --all', () => {
    const args = parseDemoEvalArgs([], TESTER_ROOT);
    expect(args.musterRoot).toBe(path.join(CES_ROOT, 'ces-muster'));
    expect(args.stacksimRoot).toBe(path.join(CES_ROOT, 'tenant-stacksim'));
    expect(args.stamperRoot).toBe(path.join(CES_ROOT, 'ces-stamper'));
    expect(args.configId).toBeUndefined();
    expect(args.all).toBe(false);
    expect(args.evalScenariosDir).toBe(path.join(TESTER_ROOT, 'scenarios', 'eval'));
  });

  it('parses --config <id>', () => {
    const args = parseDemoEvalArgs(['--config', 'eval-bare'], TESTER_ROOT);
    expect(args.configId).toBe('eval-bare');
    expect(args.all).toBe(false);
  });

  it('parses --all', () => {
    const args = parseDemoEvalArgs(['--all'], TESTER_ROOT);
    expect(args.all).toBe(true);
    expect(args.configId).toBeUndefined();
  });

  it('parses --muster-root as an override, resolved to an absolute path', () => {
    const args = parseDemoEvalArgs(['--muster-root', '../other-muster'], TESTER_ROOT);
    expect(args.musterRoot).toBe(path.resolve('../other-muster'));
  });

  it('--config and --all can both be present (runDemoEvalCommand filters by configId when set)', () => {
    const args = parseDemoEvalArgs(['--all', '--config', 'eval-decoys'], TESTER_ROOT);
    expect(args.all).toBe(true);
    expect(args.configId).toBe('eval-decoys');
  });
});
