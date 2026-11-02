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
import { unreadSignalVerdict } from '../StatusTranslator.js';
import { rowsOf, unreadOrEmpty, restrictionVerdict, catalogVerdict, type CatalogSetting, type LegacySetting } from './conditions.js';

/**
 * W5 cycle 2 (EO-2): the settings Stamper entry `CM.L2-3.4.2.asr-rules` deploys (its POST to
 * /beta/deviceManagement/configurationPolicies, ces-stamper `cmmc-l2-commands.registry.json`).
 * Kept in step with that entry by hand: EO does not load the Stamper registry when it evaluates.
 */
export const ASR_RULES_ENTRY = 'Stamper entry CM.L2-3.4.2.asr-rules';
export const ASR_RULES_GROUP = 'device_vendor_msft_policy_config_defender_attacksurfacereductionrules';
export const ASR_RULES_SETTINGS: CatalogSetting[] = [
  [`${ASR_RULES_GROUP}_blockcontent`, `${ASR_RULES_GROUP}_blockcontent_block`, 'blocks executable content from email and webmail'],
  [`${ASR_RULES_GROUP}_blockofficechildprocess`, `${ASR_RULES_GROUP}_blockofficechildprocess_block`, 'blocks Office apps from creating child processes'],
  [`${ASR_RULES_GROUP}_blockcredentialstealing`, `${ASR_RULES_GROUP}_blockcredentialstealing_block`, 'blocks credential stealing from LSASS'],
  [`${ASR_RULES_GROUP}_blockuntrustedusb`, `${ASR_RULES_GROUP}_blockuntrustedusb_block`, 'blocks untrusted and unsigned processes from USB'],
];
/** The same four rules on the legacy endpoint-protection template (`windows10EndpointProtectionConfiguration`). */
export const ASR_RULES_LEGACY: LegacySetting[] = [
  ['defenderEmailContentExecutionType', 'block', 'blocks executable content from email and webmail'],
  ['defenderOfficeAppsLaunchChildProcessType', 'block', 'blocks Office apps from creating child processes'],
  ['defenderPreventCredentialStealingType', 'enable', 'blocks credential stealing from LSASS'],
  ['defenderUntrustedUSBProcessType', 'block', 'blocks untrusted and unsigned processes from USB'],
];

export const cmEvaluators: Record<string, EvaluatorFn> = {
  securityBaselineEvaluator: (signals) => {
    // Try expanded configurationPolicies signal first, then fallback to deviceConfigurations
    const configPoliciesData = getSignalData(signals, 'configurationPolicies');
    const configData = configPoliciesData ?? getSignalData(signals, 'deviceConfigurations');

    if (!configData || !hasValues(configData)) {
      return unreadSignalVerdict(signals, ['configurationPolicies', 'deviceConfigurations'], 'Device configuration policies')
        ?? { status: 'not_met', evidence: 'No device configurations for security baseline verification' };
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

  // W5 cycle 2 (EO-2, CM.L2-3.4.2): the ASR rules Stamper deploys are set to block, read live from the
  // settings catalog or the legacy endpoint-protection template (either decides met).
  asrRulesEvaluator: (signals) => catalogVerdict(signals, 'Attack surface reduction rules', ASR_RULES_ENTRY, ASR_RULES_SETTINGS,
    { anchors: [ASR_RULES_GROUP], legacy: ASR_RULES_LEGACY }),

  // W5 cycle 1 (CM.L2-3.4.3): changes are logged with what changed, when, and who made them.
  // A logged change without its activity, time or actor -> not_met. Review and approval are records.
  changeTrackingEvaluator: (signals) => {
    const ids = ['directoryAudits'];
    const empty = unreadOrEmpty(signals, ids, 'Directory audit logs');
    if (empty) return empty;
    const rows = rowsOf(signals, ids)!.rows as Record<string, any>[];
    const actor = (r: Record<string, any>) => r.initiatedBy?.user?.id || r.initiatedBy?.user?.userPrincipalName || r.initiatedBy?.app?.appId || r.initiatedBy?.app?.displayName;
    const incomplete = rows.filter(r => !r.activityDisplayName || !r.activityDateTime || !actor(r));
    if (incomplete.length > 0) {
      return { status: 'not_met', evidence: `Change tracking: ${incomplete.length} of ${rows.length} directory audit record(s) lack the activity, time or actor` };
    }
    const cats = [...new Set(rows.map(r => String(r.category ?? 'uncategorised')))];
    return { status: 'met', evidence: `Change tracking: ${rows.length} directory audit record(s) each log the change, its time and its actor (categories ${cats.join(', ')}); review and approval of changes are records, not read` };
  },

  configAccessRestrictEvaluator: (signals) => {
    const unread = unreadSignalVerdict(signals, 'roleAssignments', 'Role assignments');
    if (unread) return unread;
    const roleData = getSignalData(signals, 'roleAssignments');
    return { status: 'met', evidence: 'Access to configuration changes restricted via RBAC role assignments' };
  },

  // W5 cycle 1 (CM.L2-3.4.6): a device configuration disables a nonessential capability.
  leastFunctionalityEvaluator: (signals) => restrictionVerdict(signals, 'Least functionality', [
    ['cortanaBlocked', v => v === true, 'blocks Cortana'],
    ['gameDvrBlocked', v => v === true, 'blocks Game DVR'],
    ['bluetoothBlocked', v => v === true, 'blocks Bluetooth'],
    ['connectedDevicesServiceBlocked', v => v === true, 'blocks the connected devices service'],
    ['microsoftAccountSignInAssistantSettings', v => v === 'disabled', 'disables the consumer account sign-in assistant'],
  ]),

  // W5 cycle 1 (CM.L2-3.4.7): a device configuration restricts nonessential programs.
  applicationControlEvaluator: (signals) => restrictionVerdict(signals, 'Nonessential programs restricted', [
    ['appLockerApplicationControl', v => /^enforce/i.test(String(v)), 'enforces application control'],
    ['appsAllowTrustedAppsSideloading', v => v === 'blocked', 'blocks sideloaded apps'],
    ['smartScreenEnableAppInstallControl', v => v === true, 'allows Store apps only'],
    ['smartScreenBlockPromptOverride', v => v === true, 'blocks overriding SmartScreen'],
  ]),

  detectedAppsEvaluator: (signals) => {
    const unread = unreadSignalVerdict(signals, 'detectedApps', 'Detected applications');
    if (unread) return unread;
    const appsData = getSignalData(signals, 'detectedApps');
    return { status: 'met', evidence: 'Application inventory verified via Intune detected applications' };
  },

  // W5 cycle 1 (CM.L2-3.4.9): a device configuration controls user-installed software.
  installControlEvaluator: (signals) => restrictionVerdict(signals, 'User-installed software controlled', [
    ['appsAllowTrustedAppsSideloading', v => v === 'blocked', 'blocks sideloaded apps'],
    ['developerUnlockSetting', v => v === 'blocked', 'blocks developer unlock'],
    ['appsBlockWindowsStoreOriginatedApps', v => v === true, 'blocks Store-originated apps'],
    ['storeBlocked', v => v === true, 'blocks the Store'],
  ]),
};
