// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// G3 #5 — assert every in-scope CMMC L2 control (110) has a real implementation path:
// an auto-evaluator, a provisional narrative, or a documented manual gate. No control is stubbed.
// Resolution is by NIST ref (unambiguous across CMMC L1/L2 control-id tagging).
import { createRequire } from 'node:module';
import { MANUAL_GATE_CONTROLS } from '../../../src/eo/ssp/SnippetDataResolver';

const req = createRequire(import.meta.url);
const refRaw = req('ces-shared/data/cmmc-l2-controls');
const REFERENCE: Array<{ control_id: string; nist_ref: string; family: string }> =
  Array.isArray(refRaw) ? refRaw : refRaw.controls;
const REGISTRY: Record<string, { evaluator?: string }> = req('ces-shared/data/control-signal-registry');
const PROVISIONAL: Array<{ control_id: string }> =
  req('../../../src/shared/data/provisional-narratives.json').narratives;

const nistOf = (controlId: string): string => controlId.match(/(\d+\.\d+\.\d+)$/)?.[1] ?? controlId;

// Build the three coverage sets, keyed by NIST ref.
const evaluatorRefs = new Set<string>();
for (const [controlId, entry] of Object.entries(REGISTRY)) {
  if (entry && entry.evaluator) evaluatorRefs.add(nistOf(controlId));
}
const provisionalRefs = new Set(PROVISIONAL.map((p) => nistOf(p.control_id)));
const manualRefs = new Set([...MANUAL_GATE_CONTROLS].map((c) => nistOf(c)));

function pathFor(nistRef: string): 'evaluator' | 'provisional' | 'manual' | 'STUB' {
  if (evaluatorRefs.has(nistRef)) return 'evaluator';
  if (provisionalRefs.has(nistRef)) return 'provisional';
  if (manualRefs.has(nistRef)) return 'manual';
  return 'STUB';
}

describe('CMMC controls completeness', () => {
  it('the reference set is the 110 CMMC L2 controls', () => {
    expect(REFERENCE).toHaveLength(110);
  });

  it('every control resolves to a real implementation path — none stubbed/partial', () => {
    const stubs = REFERENCE.filter((c) => pathFor(c.nist_ref) === 'STUB').map((c) => c.control_id);
    expect(stubs).toEqual([]);
  });

  it('the previously-missing controls now have a path', () => {
    expect(pathFor('3.7.3')).toBe('manual'); // MA off-site equipment sanitization
    expect(pathFor('3.7.6')).toBe('manual'); // MA supervise uncleared maintenance personnel
    expect(pathFor('3.8.3')).toBe('evaluator'); // MP.L1-3.8.3 (manual gate, correctly re-keyed off the non-reference MP.L2 dup; ces-shared 2.8.0)
  });

  it('coverage partitions cleanly across the 110 (auto + provisional + manual = full set)', () => {
    const counts = { evaluator: 0, provisional: 0, manual: 0, STUB: 0 };
    for (const c of REFERENCE) counts[pathFor(c.nist_ref)]++;
    expect(counts.STUB).toBe(0);
    expect(counts.evaluator + counts.provisional + counts.manual).toBe(110);
    // Manual gates are a legitimate complete state (operational/physical controls), not stubs.
    expect(counts.manual).toBeGreaterThan(0);
    expect(counts.evaluator).toBeGreaterThan(0);
  });
});
