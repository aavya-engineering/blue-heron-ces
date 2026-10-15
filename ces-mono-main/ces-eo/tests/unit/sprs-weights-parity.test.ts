// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * GP-SPRS-PARITY-1 — SPRS weight-table parity guard.
 *
 * The 2026-07-11 EO↔Muster parity check (docs/design/readiness-report-contract.md §3)
 * found 14/31 overlapping controls with conflicting weights. Resolution (2026-07-12,
 * ces-shared 40b43ca): ONE canonical table — ces-shared/data/sprs-weights
 * (schema sprs-weights/2.0.0, regenerated from DoD AM v1.2.1 + 32 CFR 170.24) — which
 * Muster vendors under its drift discipline and EO resolves at runtime.
 *
 * This suite keeps the RED from silently coming back, from either direction:
 *  1. the methodology cross-check invariants must hold on the table EO actually loads
 *     (a stale ces-shared dist/ would fail here even when src/ is correct);
 *  2. the 14 formerly-disputed controls are pinned to their adjudicated weights;
 *  3. every reachable copy of the table (ces-shared src, Muster's two vendored copies,
 *     Muster's vendor-manifest pins) must be byte-identical to what EO loads.
 * Sibling-copy checks skip when the sibling checkout is absent.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// Resolve exactly the way EO's consumers do (SprsCalculator, DeterminationLedger).
const RESOLVED_PATH = require.resolve('ces-shared/data/sprs-weights');
const raw = fs.readFileSync(RESOLVED_PATH, 'utf-8').replace(/^﻿/, '');
const table = JSON.parse(raw);

const sha256 = (p: string) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const RESOLVED_HASH = sha256(RESOLVED_PATH);

const SIBLINGS_ROOT = path.resolve(__dirname, '..', '..', '..');
const COPIES: Record<string, string> = {
  'ces-shared src (canonical)': path.join(SIBLINGS_ROOT, 'ces-shared', 'src', 'data', 'sprs-weights.json'),
  'muster SPA vendored': path.join(SIBLINGS_ROOT, 'ces-muster', 'src', 'vendored', 'ces-shared', 'data', 'sprs-weights.json'),
  'muster-api vendored': path.join(SIBLINGS_ROOT, 'ces-muster', 'muster-api', 'src', 'vendored', 'ces-shared', 'data', 'sprs-weights.json'),
};
const VENDOR_MANIFEST = path.join(SIBLINGS_ROOT, 'ces-muster', 'vendor-manifest.json');

describe('sprs-weights methodology invariants (DoD AM v1.2.1 cross-check)', () => {
  test('identity: v1.2.1 methodology, sprs-weights/2.0.0 schema', () => {
    expect(table.version).toBe('1.2.1');
    expect(table.schema_version).toBe('sprs-weights/2.0.0');
    expect(table.starting_score).toBe(110);
    expect(table.floor_score).toBe(-203);
  });

  test('110 requirements; only 3.12.4 (SSP prerequisite) is unscored', () => {
    expect(table.controls).toHaveLength(110);
    const unscored = table.controls.filter((c: any) => c.unscored);
    expect(unscored.map((c: any) => c.nist_ref)).toEqual(['3.12.4']);
    expect(unscored[0].weight).toBe(0);
    expect(table.ssp_prerequisite_control).toBe('CA.L2-3.12.4');
  });

  test('official histogram: 44x5 + 14x3 + 51x1 = 313 deductible = 110 - (-203)', () => {
    const scored = table.controls.filter((c: any) => !c.unscored);
    const count = (w: number) => scored.filter((c: any) => c.weight === w).length;
    expect(count(5)).toBe(44);
    expect(count(3)).toBe(14);
    expect(count(1)).toBe(51);
    const deductible = scored.reduce((s: number, c: any) => s + c.weight, 0);
    expect(deductible).toBe(313);
    expect(table.starting_score - deductible).toBe(table.floor_score);
  });

  test('the two partial-credit rules: 3.5.3 and 3.13.11, full 5 -> partial 3', () => {
    const pc = table.partial_credit.map((p: any) => [p.nist_ref, p.full_weight, p.partial_weight]);
    expect(pc).toEqual([
      ['3.5.3', 5, 3],
      ['3.13.11', 5, 3],
    ]);
  });

  test('the 14 formerly-disputed controls carry their adjudicated weights', () => {
    // Contract §3 disputes, adjudicated by regeneration from the methodology
    // (ces-shared 40b43ca). A change here means the table was re-edited — re-run
    // the BHD/methodology validation before accepting it.
    const ADJUDICATED: Record<string, number> = {
      '3.1.6': 1, '3.1.12': 5, '3.1.14': 1, '3.5.5': 1, '3.9.2': 5,
      '3.4.1': 5, '3.4.2': 5, '3.4.7': 5, '3.11.1': 3, '3.3.1': 5,
      '3.3.2': 3, '3.6.2': 5, '3.6.3': 1, '3.8.9': 1,
    };
    const byRef = new Map(table.controls.map((c: any) => [c.nist_ref, c.weight]));
    for (const [ref, weight] of Object.entries(ADJUDICATED)) {
      expect({ ref, weight: byRef.get(ref) }).toEqual({ ref, weight });
    }
  });
});

describe('one-table parity: every copy is byte-identical to what EO loads', () => {
  for (const [label, copyPath] of Object.entries(COPIES)) {
    const present = fs.existsSync(copyPath);
    (present ? test : test.skip)(`${label} matches EO's resolved table`, () => {
      expect(sha256(copyPath)).toBe(RESOLVED_HASH);
    });
  }

  (fs.existsSync(VENDOR_MANIFEST) ? test : test.skip)(
    "muster vendor-manifest pins both vendored copies to EO's resolved hash",
    () => {
      const manifest = JSON.parse(fs.readFileSync(VENDOR_MANIFEST, 'utf-8'));
      const pins = Object.entries(manifest.files ?? manifest).filter(([k]) =>
        String(k).endsWith('data/sprs-weights.json'),
      );
      expect(pins.length).toBeGreaterThanOrEqual(2);
      for (const [, hash] of pins) {
        expect(hash).toBe(RESOLVED_HASH);
      }
    },
  );
});
