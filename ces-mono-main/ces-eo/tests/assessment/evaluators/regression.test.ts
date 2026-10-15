// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { SignalResult } from 'ces-shared/types/signal';
import { acEvaluators } from '../../../src/eo/mapping/evaluators/ac-evaluators';
import { iaEvaluators } from '../../../src/eo/mapping/evaluators/ia-evaluators';
import { auEvaluators } from '../../../src/eo/mapping/evaluators/au-evaluators';
import { scEvaluators } from '../../../src/eo/mapping/evaluators/sc-evaluators';
import { siEvaluators } from '../../../src/eo/mapping/evaluators/si-evaluators';
import { cmEvaluators } from '../../../src/eo/mapping/evaluators/cm-evaluators';

/**
 * Regression test suite: validates existing evaluators work with both
 * old SignalResult schema (no optional fields) and new schema (all fields present).
 */

const now = new Date().toISOString();

// Old schema: no optional fields (parsed, complianceState, findings, metadata)
function makeOldSignal(signalId: string, endpoint: string, data: unknown): SignalResult {
  return {
    signalId,
    source: 'graph',
    endpoint,
    timestamp: now,
    rawData: data,
    status: 'success',
  };
}

// New schema: all optional fields present
function makeNewSignal(signalId: string, endpoint: string, data: unknown): SignalResult {
  return {
    signalId,
    source: 'graph',
    endpoint,
    timestamp: now,
    rawData: data,
    status: 'success',
    parsed: { test: true },
    complianceState: 'compliant',
    findings: ['test finding'],
    metadata: { threshold: 95, compliantCount: 10, totalCount: 10 },
  };
}

const mockCaPolicies = [
  {
    displayName: 'MFA Enforce',
    state: 'enabled',
    grantControls: {
      builtInControls: ['mfa', 'compliantDevice'],
      operator: 'AND',
    },
    conditions: {
      users: { includeUsers: ['All'] },
    },
  },
];

const mockDevices = [
  { complianceState: 'compliant', deviceName: 'PC-001' },
  { complianceState: 'compliant', deviceName: 'PC-002' },
];

const mockAuditData = { AuditDisabled: false };

describe('Backward Compatibility: Old vs New SignalResult Schema', () => {
  describe('AC evaluators', () => {
    test('caEnforcementEvaluator produces equivalent status with old and new schema', () => {
      const oldSignals = [makeOldSignal('conditionalAccess', '/identity/conditionalAccess/policies', mockCaPolicies)];
      const newSignals = [makeNewSignal('conditionalAccess', '/identity/conditionalAccess/policies', mockCaPolicies)];

      const oldResult = acEvaluators.caEnforcementEvaluator(oldSignals);
      const newResult = acEvaluators.caEnforcementEvaluator(newSignals);

      expect(oldResult.status).toBe(newResult.status);
    });

    test('caEnforcementEvaluator handles empty signals', () => {
      const result = acEvaluators.caEnforcementEvaluator([]);
      expect(result.status).toBe('not_met');
    });
  });

  describe('AU evaluators', () => {
    test('auditEventsEvaluator produces equivalent status with old and new schema', () => {
      const oldSignals = [makeOldSignal('mailboxAudit', '/auditLogs', mockAuditData)];
      const newSignals = [makeNewSignal('mailboxAudit', '/auditLogs', mockAuditData)];

      const oldResult = auEvaluators.auditEventsEvaluator(oldSignals);
      const newResult = auEvaluators.auditEventsEvaluator(newSignals);

      expect(oldResult.status).toBe(newResult.status);
    });
  });

  describe('SC evaluators', () => {
    test('bitLockerEvaluator produces equivalent status with old and new schema', () => {
      const oldSignals = [
        makeOldSignal('managedDevices', '/deviceManagement/managedDevices', mockDevices),
        makeOldSignal('compliancePolicies', '/deviceManagement/deviceCompliancePolicies', [{ bitLockerEnabled: true }]),
      ];
      const newSignals = [
        makeNewSignal('managedDevices', '/deviceManagement/managedDevices', mockDevices),
        makeNewSignal('compliancePolicies', '/deviceManagement/deviceCompliancePolicies', [{ bitLockerEnabled: true }]),
      ];

      const oldResult = scEvaluators.bitLockerEvaluator(oldSignals);
      const newResult = scEvaluators.bitLockerEvaluator(newSignals);

      expect(oldResult.status).toBe(newResult.status);
    });

    test('dlpEvaluator handles empty signals', () => {
      const result = scEvaluators.dlpEvaluator([]);
      expect(result.status).toBe('not_met');
    });

    test('dlpEvaluator detects active DLP policies', () => {
      const dlpSignals = [makeOldSignal('dlpPolicies', '/informationProtection/dataLossPreventionPolicies', [
        {
          name: 'CUI Protection',
          rules: [{ actions: [{ type: 'block' }] }],
        },
      ])];
      const result = scEvaluators.dlpEvaluator(dlpSignals);
      expect(result.status).toBe('met');
    });
  });

  describe('CM evaluators', () => {
    test('securityBaselineEvaluator produces equivalent status with old and new schema', () => {
      const configData = [{ displayName: 'Windows Baseline', settings: {} }];
      const oldSignals = [makeOldSignal('deviceConfigurations', '/deviceManagement/deviceConfigurations', configData)];
      const newSignals = [makeNewSignal('deviceConfigurations', '/deviceManagement/deviceConfigurations', configData)];

      const oldResult = cmEvaluators.securityBaselineEvaluator(oldSignals);
      const newResult = cmEvaluators.securityBaselineEvaluator(newSignals);

      expect(oldResult.status).toBe(newResult.status);
    });
  });

  describe('All evaluators tolerate extended SignalResult', () => {
    const allEvaluators = {
      ...acEvaluators,
      ...iaEvaluators,
      ...auEvaluators,
      ...scEvaluators,
      ...siEvaluators,
      ...cmEvaluators,
    };

    test('no evaluator throws when receiving new schema signals', () => {
      const newSignals = [
        makeNewSignal('conditionalAccess', '/identity/conditionalAccess/policies', mockCaPolicies),
        makeNewSignal('managedDevices', '/deviceManagement/managedDevices', mockDevices),
        makeNewSignal('compliancePolicies', '/deviceManagement/deviceCompliancePolicies', []),
        makeNewSignal('secureScores', '/security/secureScores', []),
        makeNewSignal('deviceConfigurations', '/deviceManagement/deviceConfigurations', []),
        makeNewSignal('authMethods', '/policies/authenticationMethodsPolicy', {}),
        makeNewSignal('securityAlerts', '/security/alerts_v2', []),
      ];

      for (const [name, evaluator] of Object.entries(allEvaluators)) {
        expect(() => evaluator(newSignals)).not.toThrow();
      }
    });

    test('no evaluator throws when receiving old schema signals', () => {
      const oldSignals = [
        makeOldSignal('conditionalAccess', '/identity/conditionalAccess/policies', mockCaPolicies),
        makeOldSignal('managedDevices', '/deviceManagement/managedDevices', mockDevices),
        makeOldSignal('compliancePolicies', '/deviceManagement/deviceCompliancePolicies', []),
        makeOldSignal('secureScores', '/security/secureScores', []),
        makeOldSignal('deviceConfigurations', '/deviceManagement/deviceConfigurations', []),
        makeOldSignal('authMethods', '/policies/authenticationMethodsPolicy', {}),
        makeOldSignal('securityAlerts', '/security/alerts_v2', []),
      ];

      for (const [name, evaluator] of Object.entries(allEvaluators)) {
        expect(() => evaluator(oldSignals)).not.toThrow();
      }
    });

    test('no evaluator throws with empty signals', () => {
      for (const [name, evaluator] of Object.entries(allEvaluators)) {
        expect(() => evaluator([])).not.toThrow();
      }
    });
  });
});
