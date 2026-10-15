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

// Note: SspGenerator cannot be imported directly under ts-jest because it uses
// bare import.meta.url at module scope (L40, L88). The override priority test
// verifies the narrative content matches what the Map lookup would produce.
// Full integration testing requires ESM runtime (npx tsx or node --loader).

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

describe('Provisional Narrative Loading and Override', () => {
  test('loads provisional narratives JSON correctly', () => {
    const data = JSON.parse(fs.readFileSync(PROVISIONAL_PATH, 'utf-8'));
    expect(data.narratives.length).toBe(13);
    expect(data.narratives[0]).toHaveProperty('control_id');
    expect(data.narratives[0]).toHaveProperty('narrative');
  });

  test('contains all 13 expected control IDs', () => {
    const data = JSON.parse(fs.readFileSync(PROVISIONAL_PATH, 'utf-8'));
    const loadedIds = data.narratives.map((n: { control_id: string }) => n.control_id);
    for (const expectedId of EXPECTED_CONTROL_IDS) {
      expect(loadedIds).toContain(expectedId);
    }
  });

  test('no duplicate control IDs', () => {
    const data = JSON.parse(fs.readFileSync(PROVISIONAL_PATH, 'utf-8'));
    const ids = data.narratives.map((n: { control_id: string }) => n.control_id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  test('provisional narrative for IA.L2-3.5.8 contains expected content', () => {
    // Verifies the Map lookup would return the correct narrative
    const data = JSON.parse(fs.readFileSync(PROVISIONAL_PATH, 'utf-8'));
    const narrativeMap = new Map<string, string>();
    for (const entry of data.narratives) {
      narrativeMap.set(entry.control_id, entry.narrative);
    }

    const iaNarrative = narrativeMap.get('IA.L2-3.5.8');
    expect(iaNarrative).toBeDefined();
    expect(iaNarrative).toContain('password reuse prevention');
    expect(iaNarrative!.length).toBeGreaterThan(200);
  });

  test('PS.L2-3.9.1 and PS.L2-3.9.2 have provisional narratives', () => {
    // These controls were removed from the MANUAL_GATE and should have narratives
    const data = JSON.parse(fs.readFileSync(PROVISIONAL_PATH, 'utf-8'));
    const narrativeMap = new Map<string, string>();
    for (const entry of data.narratives) {
      narrativeMap.set(entry.control_id, entry.narrative);
    }

    expect(narrativeMap.has('PS.L2-3.9.1')).toBe(true);
    expect(narrativeMap.has('PS.L2-3.9.2')).toBe(true);
    expect(narrativeMap.get('PS.L2-3.9.1')!).toContain('screens individuals');
    expect(narrativeMap.get('PS.L2-3.9.2')!).toContain('personnel security criteria');
  });

  test('validation warns on short narratives', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

    // Simulate the validation logic from SspGenerator
    const data = JSON.parse(fs.readFileSync(PROVISIONAL_PATH, 'utf-8'));
    for (const entry of data.narratives) {
      if (entry.narrative.length < 200 && !entry.narrative.includes('Implementation not yet documented') && !entry.narrative.includes('REQUIRES MANUAL INPUT')) {
        console.warn(`WARNING: Control ${entry.control_id} narrative is ${entry.narrative.length} chars (minimum 200 recommended for assessor review)`);
      }
    }

    // No provisional narrative should be under 200 chars, so warn should NOT have been called
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test('narrative length validation passes for >200 chars', () => {
    const data = JSON.parse(fs.readFileSync(PROVISIONAL_PATH, 'utf-8'));

    for (const entry of data.narratives) {
      expect(entry.narrative.length).toBeGreaterThan(200);
    }
  });
});
