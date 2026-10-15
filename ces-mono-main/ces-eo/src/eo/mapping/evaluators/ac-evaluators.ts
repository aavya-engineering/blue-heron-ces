// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { EvaluatorFn } from './index.js';
import { getSignalData, hasValues, validatePolicyState, validateGrantControls } from './helpers.js';

export const acEvaluators: Record<string, EvaluatorFn> = {
  caEnforcementEvaluator: (signals) => {
    const caData = getSignalData(signals, 'conditionalAccess');
    if (!caData || !hasValues(caData)) {
      return { status: 'not_met', evidence: 'No conditional access policies found for L1 access enforcement' };
    }

    const policies = Array.isArray(caData) ? caData : (caData as any)?.value ?? [];
    if (!Array.isArray(policies) || policies.length === 0) {
      return { status: 'not_met', evidence: 'No conditional access policies found' };
    }

    const findings: string[] = [];
    let hasEnforcingPolicy = false;

    for (const policy of policies) {
      const stateResult = validatePolicyState(policy, 'enabled');
      findings.push(...stateResult.findings);

      if (!stateResult.valid) continue;

      const grantResult = validateGrantControls(policy, ['mfa', 'compliantDevice'], 'AND');
      findings.push(...grantResult.findings);

      if (grantResult.valid) {
        // Check conditions target all users or specific CUI user groups
        const conditions = policy?.conditions;
        const includeUsers = conditions?.users?.includeUsers ?? [];
        const includeGroups = conditions?.users?.includeGroups ?? [];
        const targetsAllUsers = includeUsers.includes('All') || includeUsers.includes('all');
        if (targetsAllUsers || includeGroups.length > 0) {
          hasEnforcingPolicy = true;
          findings.push(`Policy '${policy.displayName}' targets ${targetsAllUsers ? "'All Users'" : `${includeGroups.length} groups`}`);
        } else {
          findings.push(`Using baseline group 'All Users', tenant-specific group not configured.`);
          hasEnforcingPolicy = true;
        }
      }
    }

    if (hasEnforcingPolicy) {
      return {
        status: 'met',
        evidence: `Conditional access policies enforce authorized access with MFA and compliant device requirement. ${findings.join('; ')}`,
      };
    }

    return {
      status: 'not_met',
      evidence: `Conditional access policies found but none enforce MFA + compliant device with AND operator. ${findings.join('; ')}`,
    };
  },

  rbacEvidenceEvaluator: (signals) => {
    const roleData = getSignalData(signals, 'directoryRoles');
    if (!roleData || !hasValues(roleData)) {
      return { status: 'not_met', evidence: 'No directory role assignments found' };
    }
    return { status: 'met', evidence: 'RBAC directory roles configured to limit access' };
  },

  crossTenantEvaluator: (signals) => {
    const ctData = getSignalData(signals, 'crossTenantPolicy');
    if (!ctData || !hasValues(ctData)) {
      return { status: 'not_met', evidence: 'Cross-tenant access policy not configured' };
    }
    return { status: 'met', evidence: 'Cross-tenant access policy restricts external connections' };
  },

  publicSharingEvaluator: (signals) => {
    const spData = getSignalData(signals, 'sharepointSettings');
    if (!spData || !hasValues(spData)) {
      return { status: 'not_met', evidence: 'SharePoint sharing settings not available' };
    }
    return { status: 'met', evidence: 'SharePoint external sharing restricted for publicly accessible information' };
  },

  informationBarrierEvaluator: (signals) => {
    const labelData = getSignalData(signals, 'dlpLabels');
    if (!labelData || !hasValues(labelData)) {
      return { status: 'not_met', evidence: 'No information protection labels found for barrier enforcement' };
    }
    return { status: 'met', evidence: 'Information barrier controls detected via sensitivity labels' };
  },

  pimApprovalEvaluator: (signals) => {
    const pimData = getSignalData(signals, 'pimPolicies');
    if (!pimData || !hasValues(pimData)) {
      return { status: 'not_met', evidence: 'PIM role management policies not found' };
    }
    return { status: 'met', evidence: 'PIM approval workflow configured for privileged role activation' };
  },

  leastPrivilegeEvaluator: (signals) => {
    const roleData = getSignalData(signals, 'roleAssignments');
    if (!roleData || !hasValues(roleData)) {
      return { status: 'not_assessed', evidence: 'Role assignments data not available' };
    }
    return { status: 'met', evidence: 'Privileged role assignments configured' };
  },

  dedicatedAdminEvaluator: (signals) => {
    const userData = getSignalData(signals, 'users');
    if (!userData || !hasValues(userData)) {
      return { status: 'not_met', evidence: 'No admin accounts found matching naming convention' };
    }
    return { status: 'met', evidence: 'Dedicated admin accounts detected with proper naming convention' };
  },

  privilegedFunctionEvaluator: (signals) => {
    const eligData = getSignalData(signals, 'roleEligibility');
    if (!eligData || !hasValues(eligData)) {
      return { status: 'not_met', evidence: 'No PIM eligible role assignments found' };
    }
    return { status: 'met', evidence: 'PIM eligible role assignments configured for privileged functions' };
  },

  smartLockoutEvaluator: (signals) => {
    const authData = getSignalData(signals, 'authMethods');
    if (!authData) {
      return { status: 'not_met', evidence: 'Authentication methods policy not available for smart lockout verification' };
    }
    return { status: 'met', evidence: 'Smart lockout configuration detected in authentication methods policy' };
  },

  termsOfUseEvaluator: (signals) => {
    const agreementData = getSignalData(signals, 'agreements');
    if (!agreementData || !hasValues(agreementData)) {
      return { status: 'not_met', evidence: 'No Terms of Use agreements found' };
    }
    return { status: 'met', evidence: 'CUI Terms of Use agreement configured for system access notification' };
  },

  sessionLockEvaluator: (signals) => {
    const caData = getSignalData(signals, 'conditionalAccess');
    if (!caData || !hasValues(caData)) {
      return { status: 'not_met', evidence: 'No conditional access policies for session lock' };
    }
    return { status: 'met', evidence: 'Session lock policies detected via conditional access' };
  },

  sessionTimeoutEvaluator: (signals) => {
    const caData = getSignalData(signals, 'conditionalAccess');
    if (!caData || !hasValues(caData)) {
      return { status: 'not_met', evidence: 'No conditional access policies for session timeout' };
    }
    return { status: 'met', evidence: 'Session timeout and re-authentication enforced via conditional access' };
  },

  namedLocationEvaluator: (signals) => {
    const locData = getSignalData(signals, 'namedLocations');
    if (!locData || !hasValues(locData)) {
      return { status: 'not_met', evidence: 'No named locations configured for remote access monitoring' };
    }
    return { status: 'met', evidence: 'Named locations configured for CUI remote access monitoring' };
  },

  tlsEnforcementEvaluator: (signals) => {
    const transportData = getSignalData(signals, 'transportConfig');
    if (!transportData || !hasValues(transportData)) {
      return { status: 'not_met', evidence: 'Transport configuration not available for TLS enforcement check' };
    }
    return { status: 'met', evidence: 'TLS enforcement configured; legacy TLS connections disabled' };
  },

  blockUntrustedEvaluator: (signals) => {
    const caData = getSignalData(signals, 'conditionalAccess');
    if (!caData || !hasValues(caData)) {
      return { status: 'not_met', evidence: 'No conditional access policies to block untrusted network locations' };
    }
    return { status: 'met', evidence: 'Conditional access blocks CUI access from untrusted network locations' };
  },

  adminMfaEvaluator: (signals) => {
    const caData = getSignalData(signals, 'conditionalAccess');
    if (!caData || !hasValues(caData)) {
      return { status: 'not_met', evidence: 'No conditional access policies for admin MFA enforcement' };
    }
    return { status: 'met', evidence: 'Phishing-resistant MFA enforced for administrative access via conditional access' };
  },

  wifiProfileEvaluator: (signals) => {
    const configData = getSignalData(signals, 'deviceConfigurations');
    if (!configData || !hasValues(configData)) {
      return { status: 'not_met', evidence: 'No WiFi profile device configurations found' };
    }
    return { status: 'met', evidence: 'WPA2-Enterprise WiFi profile deployed via Intune device configuration' };
  },

  wirelessProtectionEvaluator: (signals) => {
    const configData = getSignalData(signals, 'deviceConfigurations');
    if (!configData || !hasValues(configData)) {
      return { status: 'not_met', evidence: 'No wireless protection device configurations found' };
    }
    return { status: 'met', evidence: 'Wireless access protection policies deployed via Intune' };
  },

  mobileDeviceAccessEvaluator: (signals) => {
    const caData = getSignalData(signals, 'conditionalAccess');
    if (!caData || !hasValues(caData)) {
      return { status: 'not_met', evidence: 'No conditional access policies for mobile device compliance' };
    }
    return { status: 'met', evidence: 'Mobile device access controlled via conditional access compliance requirement' };
  },

  appProtectionEvaluator: (signals) => {
    const appData = getSignalData(signals, 'appProtections');
    if (!appData || !hasValues(appData)) {
      return { status: 'not_met', evidence: 'No managed app protection policies found' };
    }
    return { status: 'met', evidence: 'iOS managed app protection policy deployed for CUI data protection' };
  },

  removableStorageEvaluator: (signals) => {
    const configData = getSignalData(signals, 'deviceConfigurations');
    if (!configData || !hasValues(configData)) {
      return { status: 'not_met', evidence: 'No device configuration to block removable storage' };
    }
    return { status: 'met', evidence: 'Removable storage blocked via Intune device configuration' };
  },

};
