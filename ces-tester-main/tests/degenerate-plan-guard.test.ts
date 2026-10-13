// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

// gp-m1 fix-forward: the degenerate-plan detector behind driveMuster's
// regeneration retry (see countImplementDirectives's doc comment for the
// ces-planner data-bank race it guards against).
import { describe, it, expect } from 'vitest';
import { countImplementDirectives } from '../src/muster-driver/drive-muster.js';

function planWith(directives: Array<{ control_id: string; directive: string }>): unknown {
  return { outputs: { human_readable_mission_plan: { control_directives: directives } } };
}

describe('countImplementDirectives', () => {
  it('counts implement directives in a healthy plan', () => {
    const r = countImplementDirectives(
      planWith([
        { control_id: 'AC.L1-3.1.1', directive: 'implement' },
        { control_id: 'PS.L2-3.9.2', directive: 'manual' },
        { control_id: 'PE.L2-3.10.1', directive: 'inherit-fedramp' },
      ]),
    );
    expect(r).toEqual({ total: 3, implement: 1 });
  });

  it('flags the race signature: directives present, zero implement', () => {
    const r = countImplementDirectives(
      planWith([
        { control_id: 'AC.L1-3.1.1', directive: 'manual' },
        { control_id: 'AC.L1-3.1.2', directive: 'manual' },
      ]),
    );
    expect(r.total).toBe(2);
    expect(r.implement).toBe(0);
  });

  it('tolerates missing/foreign shapes (total 0 — judged by mid-pipeline assertions, not the guard)', () => {
    expect(countImplementDirectives({})).toEqual({ total: 0, implement: 0 });
    expect(countImplementDirectives(null)).toEqual({ total: 0, implement: 0 });
    expect(countImplementDirectives({ outputs: {} })).toEqual({ total: 0, implement: 0 });
  });
});
