// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { describe, it, expect } from '@jest/globals';
import type { SignalResult } from 'ces-shared/types/signal';
import { evaluatorRegistry } from '../evaluators/index.js';

describe('SignalToControlMapper', () => {
  describe('evaluatorRegistry', () => {
    it('should include the current evaluator registry functions', () => {
      const expectedEvaluators = [
        'leastPrivilegeEvaluator',
        'sessionLockEvaluator',
        'passwordComplexityEvaluator',
        'sessionTerminationEvaluator',
        'fipsCryptoEvaluator',
        'bitLockerEvaluator',
        'mobileCodeEvaluator',
        'monitoringEvaluator',
        'alertsEvaluator',
        'auditEventsEvaluator',
        'auditReviewEvaluator',
        'manualGateEvaluator',
      ];

      for (const name of expectedEvaluators) {
        expect(typeof evaluatorRegistry[name]).toBe('function');
      }
    });

    // FC-EO-H (2026-09-28): cuiAccessEvaluator, transactionTypesEvaluator,
    // externalConnectionsEvaluator, sharepointSharingEvaluator, mfaEvaluator,
    // authenticationEvaluator, boundaryProtectionEvaluator, publicNetworkEvaluator,
    // flawRemediationEvaluator, maliciousCodeProtectionEvaluator, secureScoreEvaluator and
    // mediaDisposalEvaluator were deleted — orphaned by ces-shared 2.8.0's registry-duplicate
    // cleanup (their reference controls each already had their own, distinct evaluator; see
    // tests/unit/claim-accuracy.test.ts). Removing tests OF deleted production code, not
    // weakening an assertion on code that still exists.
    it('the deleted evaluators are gone from the registry', () => {
      for (const name of [
        'cuiAccessEvaluator', 'transactionTypesEvaluator', 'externalConnectionsEvaluator',
        'sharepointSharingEvaluator', 'mfaEvaluator', 'authenticationEvaluator',
        'boundaryProtectionEvaluator', 'publicNetworkEvaluator', 'flawRemediationEvaluator',
        'maliciousCodeProtectionEvaluator', 'secureScoreEvaluator', 'mediaDisposalEvaluator',
      ]) {
        expect(evaluatorRegistry[name]).toBeUndefined();
      }
    });
  });

  describe('bitLockerEvaluator (SC.L2-3.13.11)', () => {
    it('should return met when devices and compliance policies exist', () => {
      const signals: SignalResult[] = [
        {
          signalId: 'managedDevices',
          source: 'graph',
          endpoint: '/deviceManagement/managedDevices',
          timestamp: new Date().toISOString(),
          rawData: {
            value: [
              { deviceName: 'DESKTOP-001', complianceState: 'compliant' },
            ],
          },
          status: 'success',
        },
        {
          signalId: 'compliancePolicies',
          source: 'graph',
          endpoint: '/deviceManagement/deviceCompliancePolicies',
          timestamp: new Date().toISOString(),
          rawData: { value: [{ displayName: 'BitLocker Required' }] },
          status: 'success',
        },
      ];

      const result = evaluatorRegistry.bitLockerEvaluator(signals);
      expect(result.status).toBe('met');
    });

    it('should return partial when devices exist but no compliance policies', () => {
      const signals: SignalResult[] = [
        {
          signalId: 'managedDevices',
          source: 'graph',
          endpoint: '/deviceManagement/managedDevices',
          timestamp: new Date().toISOString(),
          rawData: { value: [{ deviceName: 'DESKTOP-001' }] },
          status: 'success',
        },
      ];

      const result = evaluatorRegistry.bitLockerEvaluator(signals);
      expect(result.status).toBe('partial');
    });
  });
});
