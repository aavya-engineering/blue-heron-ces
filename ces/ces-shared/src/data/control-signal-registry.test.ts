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

describe('control-signal-registry — automated (graph or PowerShell read) coverage over reference controls', () => {
  it('exactly 85 of the 110 reference controls have an automated signal (79 pre-existing + 6 promoted overlay)', () => {
    const automated = Object.entries(REGISTRY).filter(([k, v]) => REFERENCE_IDS.has(k) && (hasGraphSignal(v) || v.signals.some((s) => s.type === 'powershell')));
    expect(automated.length).toBe(85);
  });

  it('83 of them read Graph; B15 moved AU.L2-3.3.1 and AU.L2-3.3.6 to the unified audit log (PowerShell read)', () => {
    const graph = Object.entries(REGISTRY).filter(([k, v]) => REFERENCE_IDS.has(k) && hasGraphSignal(v)).map(([k]) => k);
    expect(graph.length).toBe(83);
    expect(graph).not.toContain('AU.L2-3.3.1');
    expect(graph).not.toContain('AU.L2-3.3.6');
  });
});

// EO-collection W2.0b (B15, CONTRACT CHANGE, MG-27): the ten rows whose collector or evaluator was
// unreachable now list the sources EO's collectors and reads provide. The Graph audit-log query API
// (/security/auditLog/queries) is not available in GCC High (L4), so no row may name it; the unified
// audit log arrives through Search-UnifiedAuditLog (type powershell, EO collector C1a).
// B15 extension (W2 part 3, same flag): IR.L2-3.6.1 + /security/incidents, SI.L2-3.14.3 +
// /security/secureScores (eleven rows pinned). Both already had a Graph signal: 85/83 unchanged.
describe('control-signal-registry — B15 contract change (EO collectors)', () => {
  const B15: Record<string, ControlSignalEntry> = {
    'AU.L2-3.3.1': {
      signals: [
        { type: 'powershell', endpoint: 'Search-UnifiedAuditLog', required: true },
      ],
      evaluator: 'auditEventsEvaluator',
    },
    'AU.L2-3.3.6': {
      signals: [
        { type: 'powershell', endpoint: 'Search-UnifiedAuditLog', required: true, variables: ['tenantName'] },
      ],
      evaluator: 'auditReductionEvaluator',
    },
    'SI.L2-3.14.3': {
      signals: [
        { type: 'graph', endpoint: '/security/alerts_v2', required: true },
        { type: 'powershell', endpoint: 'Get-SafeLinksPolicy' },
        // B15 extension (EO-collection W2 part 3): the Secure Score read (EO collectors C8/C8b) reaches
        // safeLinksEvaluator, whose advisory rule reads it.
        { type: 'graph', endpoint: '/security/secureScores' },
      ],
      evaluator: 'safeLinksEvaluator',
    },
    // B15 extension (EO-collection W2 part 3): the Defender incidents read (EO collector C6b, and the
    // point-in-time securityIncidents read) reaches incidentResponseEvaluator, so incident assignment,
    // classification and status count as handling records.
    'IR.L2-3.6.1': {
      signals: [
        { type: 'graph', endpoint: '/security/alerts_v2', required: true },
        { type: 'graph', endpoint: '/security/incidents' },
      ],
      evaluator: 'incidentResponseEvaluator',
    },
    'SI.L2-3.14.7': {
      signals: [
        { type: 'graph', endpoint: '/security/alerts_v2', required: true },
        { type: 'graph', endpoint: '/identity/conditionalAccess/policies' },
        { type: 'graph', endpoint: '/identityProtection/riskDetections' },
      ],
      evaluator: 'alertsEvaluator',
    },
    'AC.L2-3.1.7': {
      signals: [
        { type: 'graph', endpoint: '/roleManagement/directory/roleEligibilityScheduleRequests', required: true },
        { type: 'graph', endpoint: '/roleManagement/directory/roleAssignmentScheduleRequests' },
        // W5 cycle 8 (CONTRACT CHANGE, see the block below): the standing role assignments and the users.
        { type: 'graph', endpoint: '/roleManagement/directory/roleAssignments' },
        { type: 'graph', endpoint: '/users' },
      ],
      evaluator: 'privilegedFunctionEvaluator',
    },
    'AC.L2-3.1.12': {
      signals: [
        { type: 'graph', endpoint: '/identity/conditionalAccess/namedLocations', required: true, variables: ['approvedIpRange'] },
        { type: 'graph', endpoint: '/auditLogs/signIns' },
      ],
      evaluator: 'namedLocationEvaluator',
    },
    'CM.L2-3.4.1': {
      signals: [
        { type: 'graph', endpoint: '/deviceManagement/deviceConfigurations', required: true, variables: ['baselineTemplateId', 'cuiGroupId'] },
        { type: 'graph', endpoint: '/deviceManagement/managedDevices' },
      ],
      evaluator: 'securityBaselineEvaluator',
    },
    'CM.L2-3.4.2': {
      signals: [
        { type: 'graph', endpoint: '/deviceManagement/deviceConfigurations', required: true },
        // W5 cycle 2 (EO-2, same B15 flag): the settings-catalog policies Stamper's asr-rules entry deploys.
        { type: 'graph', endpoint: '/deviceManagement/configurationPolicies' },
        { type: 'graph', endpoint: '/deviceManagement/managedDevices' },
      ],
      evaluator: 'asrRulesEvaluator',
    },
    'RA.L2-3.11.3': {
      signals: [
        { type: 'graph', endpoint: '/deviceManagement/windowsUpdateForBusinessUpdateRings', required: true },
        { type: 'graph', endpoint: '/security/runHuntingQuery' },
      ],
      evaluator: 'vulnRemediationEvaluator',
    },
    'SI.L1-3.14.1': {
      signals: [
        { type: 'graph', endpoint: '/deviceManagement/deviceCompliancePolicies', required: true },
        { type: 'graph', endpoint: '/deviceManagement/managedDevices' },
      ],
      evaluator: 'flawRemediationL1Evaluator',
    },
  };

  it.each(Object.keys(B15))('%s lists the B15 sources (evaluator unchanged)', (id) => {
    expect(REGISTRY[id]).toEqual(B15[id]);
  });

  it('no row names the Graph audit-log query API (not available in GCC High)', () => {
    const hits = Object.entries(REGISTRY)
      .filter(([, e]) => e.signals.some((s) => (s.endpoint ?? '').includes('/security/auditLog/queries')))
      .map(([k]) => k);
    expect(hits).toEqual([]);
  });
});

// Synthetic-customer W5 cycle 8 (CONTRACT CHANGE): three rows gain the reads their evaluators need to
// detect the deliberately deficient customer S3's seeded deficiencies. Evaluator names unchanged; no row
// added or removed; every added signal is optional; 85/83 unchanged (each row already read Graph).
//  - AC.L1-3.1.22 + the unified audit log (anonymous 'Anyone' sharing-link events, EO collector C1a);
//  - AC.L2-3.1.7 + the standing role assignments and the users (a standing privileged role on a normal account);
//  - IA.L2-3.5.3 + the per-user MFA registration report and the users (accounts without MFA registration).
describe('control-signal-registry — W5 cycle 8 contract change (S3 deficiency reads)', () => {
  const W5C8: Record<string, ControlSignalEntry> = {
    'AC.L1-3.1.22': {
      signals: [
        { type: 'graph', endpoint: '/admin/sharepoint/settings', required: true },
        { type: 'powershell', endpoint: 'Search-UnifiedAuditLog' },
      ],
      evaluator: 'publicSharingEvaluator',
    },
    'AC.L2-3.1.7': {
      signals: [
        { type: 'graph', endpoint: '/roleManagement/directory/roleEligibilityScheduleRequests', required: true },
        { type: 'graph', endpoint: '/roleManagement/directory/roleAssignmentScheduleRequests' },
        { type: 'graph', endpoint: '/roleManagement/directory/roleAssignments' },
        { type: 'graph', endpoint: '/users' },
      ],
      evaluator: 'privilegedFunctionEvaluator',
    },
    'IA.L2-3.5.3': {
      signals: [
        { type: 'graph', endpoint: '/policies/authenticationMethodsPolicy', required: true },
        { type: 'graph', endpoint: '/reports/authenticationMethods/userRegistrationDetails' },
        { type: 'graph', endpoint: '/users' },
        // Founder ruling 10-31 (diff D, LOG-PH5-EO.md): MFA for all users is also judged from CA policies.
        { type: 'graph', endpoint: '/identity/conditionalAccess/policies' },
      ],
      evaluator: 'mfaMethodsEvaluator',
    },
  };

  it.each(Object.keys(W5C8))('%s lists the W5 cycle 8 sources (evaluator unchanged)', (id) => {
    expect(REGISTRY[id]).toEqual(W5C8[id]);
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
