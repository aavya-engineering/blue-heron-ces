// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FC-SH step 3 (REQ-ces-shared-signal-registry-overlay, ces-eo FC-EO-D, 2026-09-28):
//   - EO's six overlay entries (AT.L2-3.2.1, AT.L2-3.2.3, AU.L2-3.3.5, PS.L2-3.9.2, RA.L2-3.11.2,
//     SC.L2-3.13.7) are promoted from EO's own overlay into the shared registry.
//   - 13 entries were filed under an L2-tagged id when the CMMC reference control for that practice
//     uses the L1 tag (e.g. AC.L2-3.1.1 duplicates AC.L1-3.1.1) — a registry key that is not a
//     reference control id produces an assessment row EO should never emit. 12 of the 13 are simply
//     dropped (their reference-id sibling already carries the correct entry; the L2 dup's signals are
//     NOT merged in — several use `required: true` on endpoints the L1 evaluator never reads, and
//     merging would turn a 403 into a false not_assessed on a currently-assessable control. See the
//     FC-SH session report for the 12 orphaned evaluator names). MP.L2-3.8.3 is the 13th and is
//     special-cased per the REQ: its evaluator claims SAT on device-wipe *capability*, not on
//     sanitization — it is replaced by a manual-gate entry under the correct id, MP.L1-3.8.3.
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const registry = JSON.parse(fs.readFileSync(path.join(__dirname, 'control-signal-registry.json'), 'utf-8'));
const referenceControls = JSON.parse(fs.readFileSync(path.join(__dirname, 'cmmc-l2-controls.reference.json'), 'utf-8'));

type SignalDefinition = {
  type: 'graph' | 'powershell' | 'manual';
  endpoint?: string;
  filter?: string;
  required?: boolean;
  variables?: string[];
};
type ControlSignalEntry = { signals: SignalDefinition[]; evaluator: string };

const REGISTRY = registry as Record<string, ControlSignalEntry>;
const REFERENCE_IDS = new Set((referenceControls as { controls: { control_id: string }[] }).controls.map((c) => c.control_id));

function hasGraphSignal(entry: ControlSignalEntry): boolean {
  return entry.signals.some((s) => s.type === 'graph');
}

describe('control-signal-registry — every key is a reference control id (fails on L1/L2 mismatch)', () => {
  it('every registry key exists in the 110 reference controls', () => {
    const badKeys = Object.keys(REGISTRY).filter((k) => !REFERENCE_IDS.has(k));
    expect(badKeys, `non-reference-id keys found: ${badKeys.join(', ')}`).toEqual([]);
  });

  it('the 12 non-MP L2 duplicates are gone; their L1 reference-id sibling is untouched', () => {
    const dropped = [
      'AC.L2-3.1.1', 'AC.L2-3.1.2', 'AC.L2-3.1.20', 'AC.L2-3.1.22',
      'IA.L2-3.5.1', 'IA.L2-3.5.2',
      'SC.L2-3.13.1', 'SC.L2-3.13.5',
      'SI.L2-3.14.1', 'SI.L2-3.14.2', 'SI.L2-3.14.4', 'SI.L2-3.14.5',
    ];
    for (const k of dropped) expect(k in REGISTRY, k).toBe(false);
    const siblings = [
      'AC.L1-3.1.1', 'AC.L1-3.1.2', 'AC.L1-3.1.20', 'AC.L1-3.1.22',
      'IA.L1-3.5.1', 'IA.L1-3.5.2',
      'SC.L1-3.13.1', 'SC.L1-3.13.5',
      'SI.L1-3.14.1', 'SI.L1-3.14.2', 'SI.L1-3.14.4', 'SI.L1-3.14.5',
    ];
    for (const k of siblings) expect(k in REGISTRY, k).toBe(true);
  });

  it('MP.L2-3.8.3 (capability evaluator) is gone; MP.L1-3.8.3 is a manual gate, not re-keyed capability logic', () => {
    expect('MP.L2-3.8.3' in REGISTRY).toBe(false);
    expect(REGISTRY['MP.L1-3.8.3']).toEqual({ signals: [{ type: 'manual' }], evaluator: 'manualGateEvaluator' });
  });
});

describe('control-signal-registry — EO overlay promoted in (6 entries, same signals/evaluator)', () => {
  const overlay: Record<string, ControlSignalEntry> = {
    'AT.L2-3.2.1': {
      signals: [
        { type: 'graph', endpoint: '/reports/security/getAttackSimulationTrainingUserCoverage', required: true },
        { type: 'graph', endpoint: '/users', required: true },
      ],
      evaluator: 'awarenessTrainingCoverageEvaluator',
    },
    'AT.L2-3.2.3': {
      signals: [
        { type: 'graph', endpoint: '/reports/security/getAttackSimulationTrainingUserCoverage', required: true },
        { type: 'graph', endpoint: '/users', required: true },
      ],
      evaluator: 'insiderThreatTrainingEvaluator',
    },
    'AU.L2-3.3.5': {
      signals: [{ type: 'graph', endpoint: '/security/incidents', required: true }],
      evaluator: 'incidentCorrelationEvaluator',
    },
    'PS.L2-3.9.2': {
      signals: [
        { type: 'graph', endpoint: '/identityGovernance/lifecycleWorkflows/workflows', required: true },
        { type: 'graph', endpoint: '/users', required: true },
        { type: 'graph', endpoint: '/roleManagement/directory/roleAssignments', required: true },
      ],
      evaluator: 'personnelActionAccessEvaluator',
    },
    'RA.L2-3.11.2': {
      signals: [
        { type: 'graph', endpoint: '/security/runHuntingQuery', required: true },
        { type: 'graph', endpoint: '/deviceManagement/managedDevices' },
      ],
      evaluator: 'vulnScanRecencyEvaluator',
    },
    'SC.L2-3.13.7': {
      signals: [{ type: 'graph', endpoint: '/deviceManagement/deviceConfigurations', required: true }],
      evaluator: 'splitTunnelingEvaluator',
    },
  };

  it.each(Object.keys(overlay))('%s matches the EO overlay verbatim, no longer manualGateEvaluator', (id) => {
    expect(REGISTRY[id]).toEqual(overlay[id]);
  });
});

describe('control-signal-registry — automated (graph) coverage over reference controls', () => {
  it('exactly 85 of the 110 reference controls have a graph signal (79 pre-existing + 6 promoted overlay)', () => {
    const graphCount = Object.entries(REGISTRY).filter(([k, v]) => REFERENCE_IDS.has(k) && hasGraphSignal(v)).length;
    expect(graphCount).toBe(85);
  });
});

describe('control-signal-registry — shape validation (matches ControlSignalRegistry in signal-registry.types.ts)', () => {
  const VALID_TYPES = new Set(['graph', 'powershell', 'manual']);

  it('every entry has a non-empty evaluator and a non-empty, well-typed signals array', () => {
    for (const [id, entry] of Object.entries(REGISTRY)) {
      expect(typeof entry.evaluator === 'string' && entry.evaluator.length > 0, id).toBe(true);
      expect(Array.isArray(entry.signals) && entry.signals.length > 0, id).toBe(true);
      for (const s of entry.signals) {
        expect(VALID_TYPES.has(s.type), `${id}: ${JSON.stringify(s)}`).toBe(true);
        if (s.endpoint !== undefined) expect(typeof s.endpoint).toBe('string');
        if (s.required !== undefined) expect(typeof s.required).toBe('boolean');
      }
    }
  });
});

describe('dist freshness — control-signal-registry.json', () => {
  it('dist/data/control-signal-registry.json matches src (run `npm run build` first)', () => {
    const distPath = path.resolve(__dirname, '../../dist/data/control-signal-registry.json');
    if (!fs.existsSync(distPath)) {
      throw new Error(`dist/data/control-signal-registry.json is missing — run \`npm run build\`.`);
    }
    const distContent = JSON.parse(fs.readFileSync(distPath, 'utf-8'));
    expect(distContent).toEqual(REGISTRY);
  });
});
