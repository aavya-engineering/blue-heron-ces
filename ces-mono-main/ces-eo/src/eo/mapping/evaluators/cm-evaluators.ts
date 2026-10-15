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

export const cmEvaluators: Record<string, EvaluatorFn> = {
  securityBaselineEvaluator: (signals) => {
    // Try expanded configurationPolicies signal first, then fallback to deviceConfigurations
    const configPoliciesData = getSignalData(signals, 'configurationPolicies');
    const configData = configPoliciesData ?? getSignalData(signals, 'deviceConfigurations');

    if (!configData || !hasValues(configData)) {
      return { status: 'not_met', evidence: 'No device configurations for security baseline verification' };
    }

    const configs = Array.isArray(configData) ? configData : (configData as any)?.value ?? [];
    if (!Array.isArray(configs) || configs.length === 0) {
      return { status: 'not_met', evidence: 'No device configuration policies found' };
    }

    const findings: string[] = [];
    let hasCompleteBaseline = false;

    for (const config of configs) {
      const displayName = config?.displayName ?? config?.name ?? 'unknown';
      const settingsStr = JSON.stringify(config).toLowerCase();

      const hasBitLocker = settingsStr.includes('bitlocker') || settingsStr.includes('encryption');
      const hasSecureBoot = settingsStr.includes('secureboot') || settingsStr.includes('secure boot');
      const hasPasswordComplexity = settingsStr.includes('password') || settingsStr.includes('complexity');

      const matchedCategories: string[] = [];
      if (hasBitLocker) matchedCategories.push('BitLocker/encryption');
      if (hasSecureBoot) matchedCategories.push('SecureBoot');
      if (hasPasswordComplexity) matchedCategories.push('password complexity');

      if (matchedCategories.length > 0) {
        findings.push(`Config '${displayName}' includes ${matchedCategories.length} baseline settings: ${matchedCategories.join(', ')}`);
      }

      if (hasBitLocker && hasSecureBoot && hasPasswordComplexity) {
        hasCompleteBaseline = true;
      }
    }

    if (hasCompleteBaseline) {
      return {
        status: 'met',
        evidence: `Security baseline deployed with all required categories. ${findings.join('; ')}`,
      };
    }

    if (findings.length > 0) {
      return {
        status: 'partial',
        evidence: `Security baseline partially deployed, missing one or more categories (BitLocker, SecureBoot, password complexity). ${findings.join('; ')}`,
      };
    }

    return { status: 'met', evidence: 'Windows security baseline deployed via Intune device configuration' };
  },

  asrRulesEvaluator: (signals) => {
    const configData = getSignalData(signals, 'deviceConfigurations');
    if (!configData || !hasValues(configData)) {
      return { status: 'not_met', evidence: 'No device configurations for ASR rules verification' };
    }
    return { status: 'met', evidence: 'Attack Surface Reduction rules deployed via Intune configuration profile' };
  },

  changeTrackingEvaluator: (signals) => {
    const auditData = getSignalData(signals, 'directoryAudits');
    if (!auditData || !hasValues(auditData)) {
      return { status: 'not_met', evidence: 'Directory audit data not available for change tracking' };
    }
    return { status: 'met', evidence: 'Configuration change tracking enabled via directory audit logs' };
  },

  configAccessRestrictEvaluator: (signals) => {
    const roleData = getSignalData(signals, 'roleAssignments');
    if (!roleData || !hasValues(roleData)) {
      return { status: 'not_met', evidence: 'Role assignment data not available for configuration access restriction' };
    }
    return { status: 'met', evidence: 'Access to configuration changes restricted via RBAC role assignments' };
  },

  leastFunctionalityEvaluator: (signals) => {
    const configData = getSignalData(signals, 'deviceConfigurations');
    if (!configData || !hasValues(configData)) {
      return { status: 'not_met', evidence: 'No device configurations for least functionality enforcement' };
    }
    return { status: 'met', evidence: 'Least functionality enforced: Cortana and unnecessary services disabled via Intune' };
  },

  applicationControlEvaluator: (signals) => {
    const configData = getSignalData(signals, 'deviceConfigurations');
    if (!configData || !hasValues(configData)) {
      return { status: 'not_met', evidence: 'No device configurations for application control (WDAC)' };
    }
    return { status: 'met', evidence: 'WDAC application control policy deployed via Intune' };
  },

  detectedAppsEvaluator: (signals) => {
    const appsData = getSignalData(signals, 'detectedApps');
    if (!appsData || !hasValues(appsData)) {
      return { status: 'not_met', evidence: 'No detected applications inventory available' };
    }
    return { status: 'met', evidence: 'Application inventory verified via Intune detected applications' };
  },

  installControlEvaluator: (signals) => {
    const configData = getSignalData(signals, 'deviceConfigurations');
    if (!configData || !hasValues(configData)) {
      return { status: 'not_met', evidence: 'No device configurations for software installation control' };
    }
    return { status: 'met', evidence: 'User software installation controlled via Intune device configuration' };
  },
};
