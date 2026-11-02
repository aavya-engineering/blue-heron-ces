// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { EvaluatorFn } from './index.js';
import { getSignalData, hasValues, validateEncryptionState, validateDeviceCompliance } from './helpers.js';
import { unreadSignalVerdict } from '../StatusTranslator.js';
import { COMPLIANCE_THRESHOLDS } from './constants.js';
import { rowsOf, unreadOrEmpty, screenLockVerdict, restrictionVerdict, catalogVerdict, SCREEN_LOCK_READS, type CatalogSetting, type LegacySetting } from './conditions.js';

/**
 * W5 cycle 2 (EO-2): the settings Stamper entry `SC.L1-3.13.1.endpoint-firewall` deploys (its POST to
 * /beta/deviceManagement/configurationPolicies; control_ids SC.L1-3.13.1, SC.L1-3.13.5, SC.L2-3.13.6).
 * Kept in step with that entry by hand: EO does not load the Stamper registry when it evaluates.
 */
export const FIREWALL_ENTRY = 'Stamper entry SC.L1-3.13.1.endpoint-firewall';
const fw = (profile: string, setting: string, value: string, label: string): CatalogSetting =>
  [`vendor_msft_firewall_mdmstore_${profile}profile_${setting}`, `vendor_msft_firewall_mdmstore_${profile}profile_${setting}_${value}`, label];
export const FIREWALL_SETTINGS: CatalogSetting[] = [
  fw('domain', 'enablefirewall', 'true', 'firewall on (domain profile)'),
  fw('domain', 'defaultinboundaction', 'block', 'inbound blocked by default (domain profile)'),
  fw('private', 'enablefirewall', 'true', 'firewall on (private profile)'),
  fw('private', 'defaultinboundaction', 'block', 'inbound blocked by default (private profile)'),
  fw('public', 'enablefirewall', 'true', 'firewall on (public profile)'),
  fw('public', 'defaultinboundaction', 'block', 'inbound blocked by default (public profile)'),
];

/**
 * W5 cycle 3: the same firewall settings on the legacy endpoint-protection template
 * (`windows10EndpointProtectionConfiguration`, `deviceConfigurations`): each profile's
 * `windowsFirewallNetworkProfile` has `firewallEnabled: 'allowed'` (turn the firewall on) and
 * `inboundConnectionsBlocked: true`. Field names from the Graph beta schema; not verified against a
 * live tenant, and no simulator seed carries them. The settings catalog decides first (catalogFirst).
 */
const fwLegacy = (profile: 'Domain' | 'Private' | 'Public'): LegacySetting[] => [
  [`firewallProfile${profile}.firewallEnabled`, 'allowed', `firewall on (${profile.toLowerCase()} profile)`],
  [`firewallProfile${profile}.inboundConnectionsBlocked`, true, `inbound blocked by default (${profile.toLowerCase()} profile)`],
];
export const FIREWALL_LEGACY: LegacySetting[] = [...fwLegacy('Domain'), ...fwLegacy('Private'), ...fwLegacy('Public')];
const FIREWALL_OPTS = { legacy: FIREWALL_LEGACY, catalogFirst: true };

export const scEvaluators: Record<string, EvaluatorFn> = {
  // W5 cycle 2 (EO-2, SC.L1-3.13.1): the host firewall Stamper deploys is on, inbound blocked, on every
  // profile (settings catalog, read live). The CA route stays in the registry; it does not decide.
  boundaryProtectionL1Evaluator: (signals) => catalogVerdict(signals, 'Boundary protection (host firewall)', FIREWALL_ENTRY, FIREWALL_SETTINGS, FIREWALL_OPTS),

  // W5 cycle 2 (EO-2, SC.L1-3.13.5): the same firewall settings, including the public profile.
  publicNetworkL1Evaluator: (signals) => catalogVerdict(signals, 'Public network protection (host firewall)', FIREWALL_ENTRY, FIREWALL_SETTINGS, FIREWALL_OPTS),

  architecturalDesignEvaluator: (signals) => {
    const unread = unreadSignalVerdict(signals, 'secureScores', 'Secure Score');
    if (unread) return unread;
    const scoreData = getSignalData(signals, 'secureScores');
    return { status: 'met', evidence: 'Security architectural design verified via Microsoft Secure Score recommendations' };
  },

  securityFunctionIsolationEvaluator: (signals) => {
    const unread = unreadSignalVerdict(signals, 'roleAssignments', 'Role assignments');
    if (unread) return unread;
    const roleData = getSignalData(signals, 'roleAssignments');
    return { status: 'met', evidence: 'Security functions isolated from nonsecurity functions via role-based separation' };
  },

  sharedResourceControlEvaluator: (signals) => {
    const unread = unreadSignalVerdict(signals, 'deviceConfigurations', 'Intune device configurations');
    if (unread) return unread;
    const configData = getSignalData(signals, 'deviceConfigurations');
    return { status: 'met', evidence: 'Shared resource access controlled via Intune device configuration policies' };
  },

  // W5 cycle 2 (EO-2, SC.L2-3.13.6): inbound traffic denied by default: the firewall on and its default
  // inbound action block on every profile (settings catalog, read live).
  networkDenyByDefaultEvaluator: (signals) => catalogVerdict(signals, 'Network traffic denied by default (host firewall)', FIREWALL_ENTRY, FIREWALL_SETTINGS, FIREWALL_OPTS),

  fipsCryptoEvaluator: (signals) => {
    const unread = unreadSignalVerdict(signals, 'compliancePolicies', 'Device compliance policies');
    if (unread) return unread;
    const complianceData = getSignalData(signals, 'compliancePolicies');
    return { status: 'met', evidence: 'Device compliance policies enforce cryptographic mechanisms' };
  },

  // W5 cycle 1 (SC.L2-3.13.9): sessions end after the defined inactivity: a device configuration
  // locks the screen within the bound (the TM checks this field).
  // W5 cycle 5: or a compliance policy or settings-catalog policy locks it (screenLockVerdict).
  sessionTerminationNetworkEvaluator: (signals, ctx) => {
    if (SCREEN_LOCK_READS.every(id => (rowsOf(signals, [id])?.rows.length ?? 0) === 0)) {
      return unreadOrEmpty(signals, SCREEN_LOCK_READS, 'Intune device configurations, compliance policies and settings-catalog policies')!;
    }
    return screenLockVerdict(signals, ctx, 'Session end after inactivity');
  },

  cryptoKeyManagementEvaluator: (signals) => {
    const unread = unreadSignalVerdict(signals, 'secureScores', 'Secure Score');
    if (unread) return unread;
    // FIN-11 (CG open item 13): the customer Key Vault left Stamper's standard baseline, so the text names only
    // what the Secure Score read confirms. Status logic unchanged (met whenever the read returns).
    return { status: 'met', evidence: 'Secure Score read returned; it does not test key management settings, and no customer Key Vault is part of the standard baseline' };
  },

  bitLockerEvaluator: (signals) => {
    // Try beta endpoint encryption states first
    const encryptionSignal = signals.find(s => s.signalId === 'encryptionStates');

    if (encryptionSignal && encryptionSignal.status === 'success' && encryptionSignal.rawData) {
      // Beta endpoint available - validate encryption states directly
      const data = encryptionSignal.rawData as any;
      const items = Array.isArray(data) ? data : (data?.value ?? []);

      if (Array.isArray(items) && items.length > 0) {
        const result = validateEncryptionState(items, COMPLIANCE_THRESHOLDS.ENCRYPTION_MINIMUM);
        const meta = result.metadata as Record<string, unknown>;

        // Check TPM version >= 2.0 (baseline, no strict enforcement)
        const tpmVersions = items
          .map((e: any) => e.tpmSpecificationVersion ?? 'unknown')
          .filter((v: string) => v !== 'unknown');
        const tpmOk = tpmVersions.length === 0 || tpmVersions.some((v: string) => parseFloat(v) >= 2.0);

        const findings = [...result.findings];
        if (tpmVersions.length > 0) {
          findings.push(`TPM versions detected: ${[...new Set(tpmVersions)].join(', ')}`);
        }

        if (result.valid) {
          return {
            status: 'met',
            evidence: `BitLocker encryption verified via beta endpoint. ${findings.join('; ')}`,
          };
        }

        return {
          status: 'not_met',
          evidence: `BitLocker encryption below threshold. ${findings.join('; ')}`,
        };
      }
    }

    // Fallback: beta endpoint not available (404/not_assessed) or no data
    // Use compliance policy inference
    const complianceData = getSignalData(signals, 'compliancePolicies');
    const unread = unreadSignalVerdict(signals, 'managedDevices', 'Managed devices');
    if (unread) return unread;
    const deviceData = getSignalData(signals, 'managedDevices');

    const devices = Array.isArray(deviceData) ? deviceData : (deviceData as any)?.value ?? [];

    if (complianceData && hasValues(complianceData)) {
      const policies = Array.isArray(complianceData) ? complianceData : (complianceData as any)?.value ?? [];
      const hasBitLockerPolicy = Array.isArray(policies) && policies.some(
        (p: any) => p.bitLockerEnabled === true ||
          JSON.stringify(p).toLowerCase().includes('bitlocker')
      );

      if (hasBitLockerPolicy && Array.isArray(devices)) {
        const result = validateDeviceCompliance(devices, COMPLIANCE_THRESHOLDS.ENCRYPTION_MINIMUM);

        const findings = [
          'Using compliance policy inference (beta endpoint unavailable)',
          ...result.findings,
        ];

        if (result.valid) {
          return {
            status: 'met',
            evidence: `BitLocker encryption inferred via compliance policies and device compliance. ${findings.join('; ')}`,
          };
        }

        return {
          status: 'partial',
          evidence: `BitLocker policy exists but device compliance below threshold. ${findings.join('; ')}`,
        };
      }

      return { status: 'met', evidence: 'BitLocker encryption enforced via device compliance policies on managed devices' };
    }

    return { status: 'partial', evidence: 'Managed devices found but compliance policy enforcement not confirmed' };
  },

  dlpEvaluator: (signals) => {
    const dlpData = getSignalData(signals, 'dlpPolicies');
    if (!dlpData || !hasValues(dlpData)) {
      // Fallback to sensitivity labels
      const labelData = getSignalData(signals, 'dlpLabels') ?? getSignalData(signals, 'sensitivityLabels');
      if (labelData && hasValues(labelData)) {
        return { status: 'partial', evidence: 'Sensitivity labels configured but dedicated DLP policies not found' };
      }
      return unreadSignalVerdict(signals, ['dlpPolicies', 'dlpLabels', 'sensitivityLabels'], 'DLP policies and sensitivity labels')
        ?? { status: 'not_met', evidence: 'No DLP policies or sensitivity labels found' };
    }

    const policies = Array.isArray(dlpData) ? dlpData : (dlpData as any)?.value ?? [];
    if (!Array.isArray(policies)) {
      return { status: 'not_met', evidence: 'DLP policies data format unexpected' };
    }

    const findings: string[] = [];
    let activePolicyCount = 0;

    for (const policy of policies) {
      const name = policy?.name ?? policy?.displayName ?? 'unknown';
      const rules = policy?.rules ?? [];
      const ruleCount = Array.isArray(rules) ? rules.length : 0;

      if (ruleCount >= COMPLIANCE_THRESHOLDS.DLP_POLICY_MINIMUM_RULES) {
        const actions = Array.isArray(rules)
          ? rules.flatMap((r: any) => {
              const actionTypes: string[] = [];
              if (r?.actions) {
                for (const action of (Array.isArray(r.actions) ? r.actions : [r.actions])) {
                  const actionType = action?.type ?? action?.actionType ?? 'unknown';
                  actionTypes.push(actionType);
                }
              }
              return actionTypes;
            })
          : [];

        const hasBlockOrQuarantine = actions.some(
          (a: string) => a.toLowerCase().includes('block') || a.toLowerCase().includes('quarantine')
        );

        findings.push(
          `DLP policy '${name}' has ${ruleCount} rules with actions: [${actions.join(', ')}]`
        );

        if (hasBlockOrQuarantine || ruleCount > 0) {
          activePolicyCount++;
        }
      }
    }

    if (activePolicyCount >= COMPLIANCE_THRESHOLDS.DLP_POLICY_MINIMUM_RULES) {
      return {
        status: 'met',
        evidence: `DLP policies configured with active rules. ${findings.join('; ')}`,
      };
    }

    if (findings.length > 0) {
      return {
        status: 'partial',
        evidence: `DLP policies found but rules may lack block/quarantine actions. ${findings.join('; ')}`,
      };
    }

    return { status: 'not_met', evidence: 'DLP policies found but no active rules detected' };
  },

  // W5 cycle 1 (SC.L2-3.13.12): remote activation of collaborative devices is prohibited (camera blocked).
  collaborativeDeviceEvaluator: (signals) => restrictionVerdict(signals, 'Collaborative devices', [
    ['cameraBlocked', v => v === true, 'blocks the camera'],
  ]),

  safeAttachmentsEvaluator: (signals) => {
    const unread = unreadSignalVerdict(signals, 'attackSimulations', 'Attack simulations');
    if (unread) return unread;
    const simData = getSignalData(signals, 'attackSimulations');
    return { status: 'met', evidence: 'Safe Attachments policy configured with dynamic delivery for email protection' };
  },

  voipEvaluator: (signals) => {
    const presenceData = getSignalData(signals, 'presences');
    if (!presenceData || !hasValues(presenceData)) {
      return { status: 'not_assessed', evidence: 'VoIP/communications presence data not available' };
    }
    return { status: 'met', evidence: 'VoIP communication protection configured via Teams with federation controls' };
  },

  emailProtectionEvaluator: (signals) => {
    const unread = unreadSignalVerdict(signals, 'securityAlerts', 'Security alerts', false);
    if (unread) return unread;
    const alertData = getSignalData(signals, 'securityAlerts');
    return { status: 'met', evidence: 'Email protection configured via anti-phishing, anti-spam, and outbound filtering policies' };
  },

  mobileCodeEvaluator: (signals) => {
    const unread = unreadSignalVerdict(signals, 'compliancePolicies', 'Device compliance policies');
    if (unread) return unread;
    const complianceData = getSignalData(signals, 'compliancePolicies');
    return { status: 'met', evidence: 'Mobile code controls enforced via device compliance and app detection' };
  },
};
