// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { describe, test, expect } from '@jest/globals';
import fs from 'fs';
import path from 'path';

// FIN-11: the provisional narratives are reference text (what an assessor expects), not statements about the
// organisation. SspGenerator composes them into an evidence-aware fallback (fin11-ssp-truthfulness.test.ts).

const PROVISIONAL_PATH = path.join(process.cwd(), 'src/shared/data/provisional-narratives.json');

const EXPECTED_CONTROL_IDS = [
  'IA.L2-3.5.8',
  'CM.L2-3.4.4',
  'CM.L2-3.4.8',
  'AU.L2-3.3.6',
  'CA.L2-3.12.2',
  'CA.L2-3.12.4',
  'RA.L2-3.11.2',
  'PS.L2-3.9.1',
  'RA.L2-3.11.3',
  'SI.L2-3.14.3',
  'SI.L2-3.14.6',
  'SI.L2-3.14.7',
  'PS.L2-3.9.2',
];

interface Entry { control_id: string; requirement: string; expected_evidence: string[] }
const load = (): Entry[] => JSON.parse(fs.readFileSync(PROVISIONAL_PATH, 'utf-8')).narratives;

describe('Provisional narratives (FIN-11 reference text)', () => {
  test('13 entries, each with a requirement and the evidence an assessor examines', () => {
    const data = load();
    expect(data.length).toBe(13);
    for (const e of data) {
      expect(typeof e.requirement).toBe('string');
      expect(e.requirement.length).toBeGreaterThan(200);
      expect(e.expected_evidence.length).toBeGreaterThan(0);
      expect((e as unknown as Record<string, unknown>).narrative).toBeUndefined();
    }
  });

  test('contains all 13 expected control IDs, no duplicates', () => {
    const ids = load().map(n => n.control_id);
    for (const expectedId of EXPECTED_CONTROL_IDS) expect(ids).toContain(expectedId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('no entry states what the organisation has done (no affirmative claim)', () => {
    for (const e of load()) {
      const text = `${e.requirement} ${e.expected_evidence.join(' ')}`;
      expect({ id: e.control_id, t: /\bThe organi[sz]ation (enforces|conducts|maintains|provides|screens|remediates|monitors|identifies|ensures)\b/.test(text) }).toEqual({ id: e.control_id, t: false });
      expect({ id: e.control_id, t: /\b(is|are|been|was|were)\s+(fully\s+)?implemented\b|continuously verified|signed by/i.test(text) }).toEqual({ id: e.control_id, t: false });
      expect({ id: e.control_id, t: /\b90-day\b/.test(text) }).toEqual({ id: e.control_id, t: false });
    }
  });

  test('IA.L2-3.5.8 still describes password reuse prevention', () => {
    const ia = load().find(e => e.control_id === 'IA.L2-3.5.8')!;
    expect(ia.requirement).toContain('password reuse prevention');
  });

  test('PS.L2-3.9.1 is about screening; PS.L2-3.9.2 is about terminations and transfers', () => {
    const byId = new Map(load().map(e => [e.control_id, e.requirement]));
    expect(byId.get('PS.L2-3.9.1')!).toContain('screened');
    const ps2 = byId.get('PS.L2-3.9.2')!;
    expect(ps2).toContain('terminations and transfers');
    expect(ps2).toMatch(/on termination/);
    expect(ps2).toMatch(/on transfer/);
    expect(ps2).not.toContain('personnel security criteria');
  });
});
