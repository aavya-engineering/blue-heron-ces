// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// DEPTH-4 (depth plan §4): a risk assessment or a POA&M is never platform-inherited.
import { describe, test, expect } from 'vitest';
import { buildControlDirectives, NEVER_INHERITED } from '../engine/mpt/services/manualPlanGenerator';
import type { ControlDisposition } from '../engine/mpt/types';

const disposition = (requirement_id: string): ControlDisposition => ({
  requirement_id, title: requirement_id, domain: requirement_id.slice(0, 2), level: 'L2', scope_status: 'in_scope',
  stamper_action: 'Inherited-FedRAMP', task_ids: [], estimated_effort_hours: 0, gap_classifications: [],
  fedramp_package_id: 'FR-PKG', inheritance_rationale: 'CSP',
});

describe('DEPTH-4: no inherit-fedramp directive on RA / CA', () => {
  test('RA.L2-3.11.1/2/3 and CA.L2-3.12.2 become manual; another inherited control stays inherit-fedramp', () => {
    const ids = [...NEVER_INHERITED, 'PE.L1-3.10.1'];
    const out = buildControlDirectives(ids.map(disposition));
    for (const id of NEVER_INHERITED) expect(out.find((d) => d.control_id === id)!.directive).toBe('manual');
    expect(out.find((d) => d.control_id === 'PE.L1-3.10.1')!.directive).toBe('inherit-fedramp');
    expect([...NEVER_INHERITED].sort()).toEqual(['CA.L2-3.12.2', 'RA.L2-3.11.1', 'RA.L2-3.11.2', 'RA.L2-3.11.3']);
  });
});
