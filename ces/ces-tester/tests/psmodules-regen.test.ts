// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W5 cycle 6 (run 52): the simulator's PowerShell modules are regenerated from the built simulator at E1, before E6
// executes, and E1's steps.json row carries the count written. Nothing here starts a server or the sim.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { countModulesWrittenSince, SIM_PSMODULE_GENERATOR } from '../src/flow/muster-e2e-run.js';

describe('W5c6 psmodules regenerated at E1', () => {
  it('counts only <Name>/<Name>.psd1 files written at or after the start', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tester-psm-'));
    try {
      const mod = (name: string, mtimeMs?: number): void => {
        fs.mkdirSync(path.join(dir, name), { recursive: true });
        const f = path.join(dir, name, `${name}.psd1`);
        fs.writeFileSync(f, '@{}');
        if (mtimeMs !== undefined) fs.utimesSync(f, mtimeMs / 1000, mtimeMs / 1000);
      };
      const since = Date.now() - 60000;
      mod('Az.Accounts');
      mod('Microsoft.Graph.Users');
      mod('Stale.Module', since - 60000);
      fs.mkdirSync(path.join(dir, 'NoManifest'));
      fs.writeFileSync(path.join(dir, 'loose.psd1'), '@{}');
      expect(countModulesWrittenSince(dir, since)).toBe(2);
      expect(countModulesWrittenSince(path.join(dir, 'missing'), since)).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('E1 runs the built generator on <sim>/psmodules before the reseed, and records psmodules_written; E6 comes later', () => {
    expect(SIM_PSMODULE_GENERATOR).toBe(path.join('dist', 'src', 'codegen', 'generatePsModule.js'));
    const src = fs.readFileSync(path.resolve('src', 'flow', 'muster-e2e-run.ts'), 'utf8');
    const e1 = src.indexOf("id: 'E1'");
    const e2 = src.indexOf("id: 'E2'");
    const e6 = src.indexOf("id: 'E6'");
    const gen = src.indexOf("runLogged('E1-psmodules', node, [SIM_PSMODULE_GENERATOR, psmodulesDir], P.sim)", e1);
    const scenario = src.indexOf("runLogged('E1-scenario'", e1);
    expect(e1).toBeGreaterThan(-1);
    expect(gen).toBeGreaterThan(e1);
    expect(gen).toBeLessThan(scenario);
    expect(scenario).toBeLessThan(e2);
    expect(e2).toBeLessThan(e6);
    expect(src.slice(e1, e2)).toContain('psmodules_written: psmodulesWritten, ledger_up');
  });
});
