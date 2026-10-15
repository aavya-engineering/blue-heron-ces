// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FX2-ST1 — Stamper scores with the canonical ces-shared SPRS weights (sprs-weights/2.0.0),
// not a local copy. The expected values are read from the canonical file itself; the
// score is computed by the production analyzer + production SPRS roll-up.
import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { CmmcComplianceAnalyzer, computeSprsByCategory } from '../../src/core/CmmcComplianceAnalyzer';
import { loadSprsWeights } from '../../src/core/ScopeExclusionValidator';
import { CommandRegistry } from '../../src/registry/CommandRegistry';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const _require = createRequire(import.meta.url);
const canonicalPath = _require.resolve('ces-shared/data/sprs-weights');
const canonical = JSON.parse(fs.readFileSync(canonicalPath, 'utf-8'));
const canonicalByRef = new Map<string, { weight: number; poam_allowed: boolean }>(
  canonical.controls.map((c: any) => [c.nist_ref, { weight: c.weight, poam_allowed: c.poam_allowed }]),
);

describe('FX2-ST1 canonical SPRS weights', () => {
  it('canonical file is the 2.0.0 schema with the reviewed values', () => {
    expect(canonical.schema_version).toBe('sprs-weights/2.0.0');
    // The drift the review found: local copy said 1/true, 5/false, 1/false.
    expect(canonicalByRef.get('3.2.1')).toEqual({ weight: 5, poam_allowed: false });
    expect(canonicalByRef.get('3.1.20')).toEqual({ weight: 1, poam_allowed: false });
    expect(canonicalByRef.get('3.13.13')).toEqual({ weight: 1, poam_allowed: true });
  });

  it('loadSprsWeights() returns the canonical table (all 110 refs, weight + poam_allowed)', () => {
    const w = loadSprsWeights();
    expect(w.size).toBe(110);
    for (const [ref, exp] of canonicalByRef) {
      expect({ ref, ...w.get(ref) }).toEqual({ ref, ...exp });
    }
  });

  it('the production analyzer scores 3.2.1, 3.1.20 and 3.13.13 with the canonical weights', () => {
    const registries = [
      CommandRegistry.load(),
      CommandRegistry.load(path.join(ROOT, 'src/registry/infra-cmmc-l2-commands.registry.json')),
    ];
    // Plan-less Assess with nothing discovered: every control is NOT MET and deducts its weight.
    const status = new CmmcComplianceAnalyzer(registries, null, new Map()).analyze();
    const all = [...status.satisfied, ...status.provisional, ...status.willBeSatisfied, ...status.wontBeSatisfied, ...status.outOfScope];
    for (const ref of ['3.2.1', '3.1.20', '3.13.13']) {
      const cs = all.find((c) => c.control.nist_ref === ref)!;
      expect(cs).toBeDefined();
      expect(cs.category).toBe('wont_be_satisfied');
      expect({ ref, weight: cs.sprsWeight }).toEqual({ ref, weight: canonicalByRef.get(ref)!.weight });
    }
    // Every control's weight comes from the canonical table.
    for (const cs of all) {
      expect({ ref: cs.control.nist_ref, weight: cs.sprsWeight }).toEqual({ ref: cs.control.nist_ref, weight: canonicalByRef.get(cs.control.nist_ref)!.weight });
    }
  });

  it('the production SPRS roll-up deducts exactly the canonical weights (all NOT MET = floor of the weight sum)', () => {
    const registries = [
      CommandRegistry.load(),
      CommandRegistry.load(path.join(ROOT, 'src/registry/infra-cmmc-l2-commands.registry.json')),
    ];
    const status = new CmmcComplianceAnalyzer(registries, null, new Map()).analyze();
    const sprs = computeSprsByCategory(status);
    const expected = status.wontBeSatisfied.reduce((s, cs) => s + canonicalByRef.get(cs.control.nist_ref)!.weight, 0);
    expect(sprs.not_satisfied).toBe(expected);
    expect(sprs.score).toBe(110 - expected);
    // The drifted refs deduct their canonical weights (old local copy: 3.2.1=1, 3.1.20=5).
    const w = (ref: string) => status.wontBeSatisfied.find((cs) => cs.control.nist_ref === ref)!.sprsWeight;
    expect({ '3.2.1': w('3.2.1'), '3.1.20': w('3.1.20'), '3.13.13': w('3.13.13') }).toEqual({ '3.2.1': 5, '3.1.20': 1, '3.13.13': 1 });
  });

  it('the local weights copy is gone and nothing in src reads it', () => {
    expect(fs.existsSync(path.join(ROOT, 'src/registry/sprs-weights.json'))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, 'src/registry/cmmc-l2-controls.reference.json'))).toBe(false);
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|js|cjs|html)$/.test(e.name) && /registry['"\/\\, ]+['"]?(sprs-weights|cmmc-l2-controls\.reference)\.json/.test(fs.readFileSync(p, 'utf-8'))) offenders.push(p);
      }
    };
    for (const d of ['src', 'scripts', 'public']) walk(path.join(ROOT, d));
    expect(offenders).toEqual([]);
  });
});
