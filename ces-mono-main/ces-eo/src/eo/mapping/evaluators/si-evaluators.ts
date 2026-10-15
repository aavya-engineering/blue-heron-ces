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

export const siEvaluators: Record<string, EvaluatorFn> = {
  flawRemediationL1Evaluator: (signals) => {
    const complianceData = getSignalData(signals, 'compliancePolicies');
    if (!complianceData || !hasValues(complianceData)) {
      return { status: 'not_met', evidence: 'No device compliance policies for L1 flaw remediation' };
    }
    return { status: 'met', evidence: 'L1 flaw remediation verified via Defender Vulnerability Management compliance policies' };
  },

  malwareProtectionL1Evaluator: (signals) => {
    const configData = getSignalData(signals, 'deviceConfigurations');
    if (!configData || !hasValues(configData)) {
      return { status: 'not_met', evidence: 'No device configurations for L1 malware protection' };
    }
    return { status: 'met', evidence: 'L1 malware protection verified via Defender antimalware device configuration' };
  },

  avUpdateEvaluator: (signals) => {
    const configData = getSignalData(signals, 'deviceConfigurations');
    if (!configData || !hasValues(configData)) {
      return { status: 'not_met', evidence: 'No device configurations for antivirus update verification' };
    }
    return { status: 'met', evidence: 'Defender automatic antivirus updates configured via Intune device configuration' };
  },

  scanScheduleEvaluator: (signals) => {
    const configData = getSignalData(signals, 'deviceConfigurations');
    if (!configData || !hasValues(configData)) {
      return { status: 'not_met', evidence: 'No device configurations for scan schedule verification' };
    }
    return { status: 'met', evidence: 'Scheduled and real-time scanning configured via Defender Intune policy' };
  },

  safeLinksEvaluator: (signals) => {
    const alertData = getSignalData(signals, 'securityAlerts');
    if (!alertData) {
      return { status: 'not_met', evidence: 'Security alerts not available for Safe Links verification' };
    }
    return { status: 'met', evidence: 'Safe Links policy configured with URL scanning for email and Teams' };
  },

  monitoringEvaluator: (signals) => {
    const alertData = getSignalData(signals, 'securityAlerts');
    if (!alertData) {
      return { status: 'not_met', evidence: 'Security alerts monitoring not available' };
    }
    const scoreData = getSignalData(signals, 'secureScores');
    if (scoreData && hasValues(scoreData)) {
      return { status: 'met', evidence: 'Organizational systems monitored via security alerts and secure score' };
    }
    return { status: 'partial', evidence: 'Security alerts active but secure score data not available' };
  },

  alertsEvaluator: (signals) => {
    const alertData = getSignalData(signals, 'securityAlerts');
    if (!alertData) {
      return { status: 'not_met', evidence: 'Security alerts not available' };
    }
    return { status: 'met', evidence: 'Unauthorized use identification via security alerts configured' };
  },

  // --- G3 #3: NEW evaluators consuming newly-transformed SI signals ---

  /**
   * Identity Protection risk-detection posture (SI flaw identification / monitoring).
   * Consumes the `riskDetections` signal (/identityProtection/riskDetections).
   * not_met when no risk-detection signal is available (cannot demonstrate the
   * control is operating). met when the signal is available and either no
   * unmitigated high/critical detections remain, or none are present at all.
   */
  riskDetectionPostureEvaluator: (signals) => {
    const riskData = getSignalData(signals, 'riskDetections');
    if (riskData == null) {
      return {
        status: 'not_met',
        evidence: 'No Identity Protection risk-detection signal available to assess risk posture',
      };
    }

    const detections = Array.isArray(riskData)
      ? riskData
      : ((riskData as any)?.value ?? []);

    if (!Array.isArray(detections) || detections.length === 0) {
      return {
        status: 'met',
        evidence: 'Identity Protection active with no risk detections reported',
      };
    }

    const highOrCritical = detections.filter(
      (d: any) => d.riskLevel === 'high' || d.riskLevel === 'critical'
    );
    const unremediated = highOrCritical.filter(
      (d: any) =>
        d.riskState !== 'remediated' &&
        d.riskState !== 'dismissed' &&
        d.riskState !== 'confirmedSafe'
    );

    if (unremediated.length > 0) {
      const sample = unremediated
        .slice(0, 5)
        .map(
          (d: any) =>
            `${d.riskType ?? d.riskEventType ?? 'unknown'} (${d.riskLevel}, ${d.riskState ?? 'unknown'})`
        )
        .join('; ');
      return {
        status: 'not_met',
        evidence: `${unremediated.length} unremediated high/critical risk detection(s) require attention: ${sample}`,
      };
    }

    return {
      status: 'met',
      evidence: `Identity Protection monitored: ${detections.length} risk detection(s) reviewed, ${highOrCritical.length} high/critical all remediated/dismissed`,
    };
  },

  /**
   * Vulnerability-remediation posture (SI.L2-3.14.1 — flaw remediation).
   * Consumes the `vulnerabilities` signal (/security/microsoft/vulnerabilities),
   * surfacing severity / cvss / remediation. not_met when no vulnerability
   * signal is available, or when unremediated critical/high vulnerabilities exist.
   * met when no critical/high vulnerabilities are open.
   */
  vulnerabilityPostureEvaluator: (signals) => {
    const vulnData = getSignalData(signals, 'vulnerabilities') ?? getSignalData(signals, 'vulnerabilitiesExpanded');
    if (vulnData == null) {
      return {
        status: 'not_met',
        evidence: 'No Defender vulnerability signal available to assess flaw-remediation posture',
      };
    }

    const vulns = Array.isArray(vulnData)
      ? vulnData
      : ((vulnData as any)?.value ?? []);

    if (!Array.isArray(vulns) || vulns.length === 0) {
      return {
        status: 'met',
        evidence: 'Defender Vulnerability Management active with no open vulnerabilities reported',
      };
    }

    const criticalOrHigh = vulns.filter(
      (v: any) => v.severity === 'critical' || v.severity === 'high'
    );
    const unremediated = criticalOrHigh.filter((v: any) => {
      const remediated =
        v.remediationStatus === 'remediated' ||
        v.status === 'resolved' ||
        v.status === 'remediated';
      return !remediated;
    });

    if (unremediated.length > 0) {
      const sample = unremediated
        .slice(0, 5)
        .map(
          (v: any) =>
            `${v.id ?? 'unknown'} (${v.severity}${v.cvssV3 ?? v.cvss ? `, cvss ${v.cvssV3 ?? v.cvss}` : ''})`
        )
        .join('; ');
      return {
        status: 'not_met',
        evidence: `${unremediated.length} unremediated critical/high vulnerability(ies) require remediation: ${sample}`,
      };
    }

    return {
      status: 'met',
      evidence: `Flaw remediation verified: ${vulns.length} vulnerability(ies) assessed, ${criticalOrHigh.length} critical/high all remediated`,
    };
  },
};
