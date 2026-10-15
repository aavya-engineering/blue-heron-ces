// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { EvaluatorFn } from './index.js';
import { getSignalData, hasValues } from './helpers.js';

export const operationalEvaluators: Record<string, EvaluatorFn> = {
  // --- Manual Gate Evaluator (AT, CA, IR, MA, MP, PE, PS, RA families) ---
  manualGateEvaluator: () => {
    return {
      status: 'not_assessed',
      evidence: 'MANUAL GATE: This control requires manual verification. Provide policy reference, responsible role, and evidence artifacts.',
    };
  },

  // --- IR family ---
  incidentResponseEvaluator: (signals) => {
    const alertData = getSignalData(signals, 'securityAlerts');
    if (!alertData || !hasValues(alertData)) {
      return { status: 'not_met', evidence: 'Security alerts not available for incident response capability verification' };
    }
    return { status: 'met', evidence: 'Incident response capability verified via Defender for Office 365 ATP and security alerts' };
  },

  // --- MA family ---
  mediaCheckEvaluator: (signals) => {
    const configData = getSignalData(signals, 'deviceConfigurations');
    if (!configData || !hasValues(configData)) {
      return { status: 'not_met', evidence: 'No device configurations for media malware check' };
    }
    return { status: 'met', evidence: 'Media malware check configured via Defender AV Intune policy' };
  },

  remoteMfaEvaluator: (signals) => {
    const caData = getSignalData(signals, 'conditionalAccess');
    if (!caData || !hasValues(caData)) {
      return { status: 'not_met', evidence: 'No conditional access policies for remote maintenance MFA' };
    }
    return { status: 'met', evidence: 'MFA enforced for remote maintenance sessions via conditional access' };
  },

  // --- MP family ---
  sensitivityLabelEvaluator: (signals) => {
    const labelData = getSignalData(signals, 'dlpLabels');
    if (!labelData || !hasValues(labelData)) {
      return { status: 'not_met', evidence: 'No sensitivity labels found for CUI media protection' };
    }
    return { status: 'met', evidence: 'CUI sensitivity label with encryption configured for media protection' };
  },

  mediaMarkingEvaluator: (signals) => {
    const labelData = getSignalData(signals, 'dlpLabels');
    if (!labelData || !hasValues(labelData)) {
      return { status: 'not_met', evidence: 'No sensitivity labels found for CUI media marking' };
    }
    return { status: 'met', evidence: 'CUI media marking enforced via sensitivity labels with visual markings' };
  },

  mediaAccessEvaluator: (signals) => {
    const configData = getSignalData(signals, 'deviceConfigurations');
    if (!configData || !hasValues(configData)) {
      return { status: 'not_met', evidence: 'No device configurations for CUI media access control' };
    }
    return { status: 'met', evidence: 'CUI media access controlled via Intune removable storage policy' };
  },

  bitLockerPolicyEvaluator: (signals) => {
    const configData = getSignalData(signals, 'deviceConfigurations');
    if (!configData || !hasValues(configData)) {
      return { status: 'not_met', evidence: 'No device configurations for BitLocker encryption policy' };
    }
    return { status: 'met', evidence: 'BitLocker drive encryption policy deployed via Intune for portable storage' };
  },

  removableMediaEvaluator: (signals) => {
    const configData = getSignalData(signals, 'deviceConfigurations');
    if (!configData || !hasValues(configData)) {
      return { status: 'not_met', evidence: 'No device configurations for removable media restriction' };
    }
    return { status: 'met', evidence: 'Removable media restrictions enforced via Intune device configuration' };
  },

  unownedStorageEvaluator: (signals) => {
    const configData = getSignalData(signals, 'deviceConfigurations');
    if (!configData || !hasValues(configData)) {
      return { status: 'not_met', evidence: 'No device configurations for unowned portable storage prohibition' };
    }
    return { status: 'met', evidence: 'Unidentified portable storage devices prohibited via Intune policy' };
  },

  // --- RA family ---
  vulnRemediationEvaluator: (signals) => {
    const wufbData = getSignalData(signals, 'updateRings');
    if (!wufbData || !hasValues(wufbData)) {
      return { status: 'not_met', evidence: 'Windows Update for Business ring data not available' };
    }
    return { status: 'met', evidence: 'Vulnerability remediation managed via Windows Update for Business deployment rings' };
  },
};
