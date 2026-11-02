// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// EO-collection W1.6 (V14): EO's evidence store is wiped once per run at E6, before E7, in both
// harnesses. The wipe leaves no store and nothing else of EO's storage root is touched. Nothing
// here starts a server or the sim.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { wipeEoEvidenceStore } from '../src/flow/muster-e2e-run.js';

describe('W1.6 EO evidence-store wipe', () => {
  it('leaves no store; the rest of EO\'s storage root stays', () => {
    const eo = fs.mkdtempSync(path.join(os.tmpdir(), 'tester-eo-'));
    try {
      const t = path.join(eo, 'evidence-store', '00000000-0000-4000-8000-000000000001');
      fs.mkdirSync(path.join(t, 'payloads'), { recursive: true });
      for (const f of ['records.jsonl', 'manifest.json', 'watermarks.json', path.join('payloads', 'ab.json')]) fs.writeFileSync(path.join(t, f), '{}');
      fs.mkdirSync(path.join(eo, 'assessments'), { recursive: true });
      fs.writeFileSync(path.join(eo, 'assessments', 'keep.json'), '{}');
      wipeEoEvidenceStore(eo);
      expect(fs.existsSync(path.join(eo, 'evidence-store'))).toBe(false);
      expect(fs.existsSync(path.join(eo, 'assessments', 'keep.json'))).toBe(true);
      wipeEoEvidenceStore(eo); // no store: a no-op, never an error
      expect(fs.existsSync(path.join(eo, 'evidence-store'))).toBe(false);
    } finally {
      fs.rmSync(eo, { recursive: true, force: true });
    }
  });

  it('the tester runner wipes it at E6 on EO\'s STORAGE_ROOT (out/eo), before E7', () => {
    const src = fs.readFileSync(path.resolve('src', 'flow', 'muster-e2e-run.ts'), 'utf8');
    const e6 = src.indexOf("id: 'E6'");
    const e7 = src.indexOf("id: 'E7'");
    const call = src.indexOf("wipeEoEvidenceStore(path.join(P.out, 'eo'))");
    expect(e6).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(e6);
    expect(e7 === -1 || call < e7).toBe(true);
    expect(src).toMatch(/STORAGE_ROOT: path\.join\(P\.out, 'eo'\)/);
  });

  it('mx-e2e.ps1 wipes <OUT>\\eo\\evidence-store in its E6 block', () => {
    const ps1 = path.resolve('..', '..', 'pkg', 'ces-muster-run', 'scripts', 'mx-e2e.ps1');
    if (!fs.existsSync(ps1)) return; // package not checked out beside this repo
    const src = fs.readFileSync(ps1, 'utf8');
    const e6 = src.indexOf("if (Want 'E6')");
    const wipe = src.indexOf("$eoStore = Join-Path $OUT 'eo\\evidence-store'");
    const e7 = src.indexOf("if (Want 'E7')");
    expect(wipe).toBeGreaterThan(e6);
    expect(wipe).toBeLessThan(e7);
    expect(src).toContain('if (Test-Path $eoStore) { Remove-Item -Recurse -Force $eoStore }');
    expect(src).toMatch(/\$env:STORAGE_ROOT = Join-Path \$OUT 'eo'/);
  });
});
