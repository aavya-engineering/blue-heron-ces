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
import { COLLECTED, OBSERVED_FIELD, isoTime } from '../../collect/Collector.js';
import { collectedRows, latestVersions, fieldOf } from '../../collect/views.js';
import { REQUIREMENT_DEFAULTS, rowsOf, unreadOrEmpty, notAssessed, expectedNumber, toNumber, cfgName, restrictionVerdict, type Restriction } from './conditions.js';

const REAL_TIME: Restriction[] = [
  ['defenderRequireRealTimeMonitoring', v => v === true, 'requires real-time monitoring'],
  ['defenderMonitorFileActivity', v => /^monitor/i.test(String(v)), 'monitors file activity'],
];

/** Collected views and the point-in-time reads used only when the view is absent. */
const ALERTS_READ = { [COLLECTED.SECURITY_ALERTS]: 'securityAlerts' };
const RISK_READ = { [COLLECTED.RISK_DETECTIONS]: 'riskDetections' };
const SCORE_READ = { [COLLECTED.SECURE_SCORES]: 'secureScores' };

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

/** Newest version of each alert (collected alerts are versioned by lastUpdateDateTime). */
export function latestAlerts(rows: unknown[]): unknown[] {
  return latestVersions(rows, (a) => str(fieldOf(a, 'id')), (a) => isoTime(fieldOf(a, 'lastUpdateDateTime') ?? fieldOf(a, 'createdDateTime')));
}

/** Newest version of each risk detection (versioned by lastUpdatedDateTime). */
function latestDetections(rows: unknown[]): unknown[] {
  return latestVersions(rows, (d) => str(fieldOf(d, 'id')), (d) => isoTime(fieldOf(d, 'lastUpdatedDateTime') ?? fieldOf(d, 'detectedDateTime')));
}

/**
 * Alert categories (MITRE ATT&CK tactics as Defender XDR names them) that indicate unauthorized
 * use of the system: access gained, kept, raised or abused (3.14.7).
 */
export const UNAUTHORIZED_USE_CATEGORIES: ReadonlySet<string> = new Set([
  'initialaccess', 'persistence', 'privilegeescalation', 'credentialaccess', 'lateralmovement', 'collection', 'exfiltration',
]);

export const siEvaluators: Record<string, EvaluatorFn> = {
  flawRemediationL1Evaluator: (signals) => {
    const complianceData = getSignalData(signals, 'compliancePolicies');
    if (!complianceData || !hasValues(complianceData)) {
      return { status: 'not_met', evidence: 'No device compliance policies for L1 flaw remediation' };
    }
    return { status: 'met', evidence: 'L1 flaw remediation verified via Defender Vulnerability Management compliance policies' };
  },

  // W5 cycle 1 (SI.L1-3.14.2): a Defender configuration protects against malicious code.
  malwareProtectionL1Evaluator: (signals) => restrictionVerdict(signals, 'Malicious code protection', [
    ...REAL_TIME,
    ['defenderRequireCloudProtection', v => v === true, 'requires cloud protection'],
    ['defenderCloudBlockLevel', v => /^(high|highPlus|zeroTolerance)$/i.test(String(v)), 'blocks at a high cloud level'],
  ]),

  // W5 cycle 1 (SI.L1-3.14.4): Defender signatures update within the defined interval.
  avUpdateEvaluator: (signals, ctx) => {
    const ids = ['deviceConfigurations'];
    const empty = unreadOrEmpty(signals, ids, 'Intune device configurations');
    if (empty) return empty;
    const rows = rowsOf(signals, ids)!.rows.filter(r => r.defenderSignatureUpdateIntervalInHours !== undefined && r.defenderSignatureUpdateIntervalInHours !== null);
    if (rows.length === 0) return notAssessed('Malicious code protection updates', 'no device configuration sets defenderSignatureUpdateIntervalInHours', signals, ids);
    const max = expectedNumber(ctx, 'defenderSignatureUpdateIntervalInHours', REQUIREMENT_DEFAULTS.AV_UPDATE_MAX_HOURS);
    const seen = rows.map(r => `'${cfgName(r)}' every ${String(r.defenderSignatureUpdateIntervalInHours)} h`).join(', ');
    const ok = rows.filter(r => { const h = toNumber(r.defenderSignatureUpdateIntervalInHours); return h !== undefined && h > 0 && h <= max.value; });
    if (ok.length > 0) return { status: 'met', evidence: `Malicious code protection updates: ${seen} (within ${max.value} h, ${max.source})` };
    return { status: 'not_met', evidence: `Malicious code protection updates: ${seen}; none within ${max.value} h (${max.source})` };
  },

  // W5 cycle 1 (SI.L1-3.14.5): periodic scans are scheduled and files are scanned in real time.
  scanScheduleEvaluator: (signals) => {
    const ids = ['deviceConfigurations'];
    const empty = unreadOrEmpty(signals, ids, 'Intune device configurations');
    if (empty) return empty;
    const rows = rowsOf(signals, ids)!.rows;
    const fields = ['defenderSystemScanSchedule', 'defenderScanType', 'defenderRequireRealTimeMonitoring', 'defenderMonitorFileActivity'];
    const shaped = rows.filter(r => fields.some(f => r[f] !== undefined && r[f] !== null));
    if (shaped.length === 0) return notAssessed('Periodic and real-time scans', `no device configuration sets ${fields.join(', ')}`, signals, ids);
    const periodic = shaped.filter(r => r.defenderSystemScanSchedule && r.defenderSystemScanSchedule !== 'userDefined'
      && /^(quick|full)$/i.test(String(r.defenderScanType ?? '')));
    const realTime = shaped.filter(r => REAL_TIME.some(([f, ok]) => r[f] !== undefined && r[f] !== null && ok(r[f])));
    if (periodic.length > 0 && realTime.length > 0) {
      const p0 = periodic[0];
      return { status: 'met', evidence: `Periodic and real-time scans: '${periodic.map(cfgName).join("', '")}' schedule a ${String(p0.defenderScanType)} scan (${String(p0.defenderSystemScanSchedule)}${p0.defenderScheduledScanTime ? ` ${String(p0.defenderScheduledScanTime)}` : ''}); '${realTime.map(cfgName).join("', '")}' scan files in real time` };
    }
    return { status: 'not_met', evidence: `Periodic and real-time scans: ${periodic.length === 0 ? 'no scheduled quick or full scan' : 'scheduled scan set'}; ${realTime.length === 0 ? 'no real-time scanning' : 'real-time scanning set'}` };
  },

  // EO-collection W2 (SI.L2-3.14.3): advisories are read with dates. W2 part 3 (B15 extension): the
  // registry now routes /security/secureScores here, so the Secure Score reads reach this rule: C8
  // `collect.secureScores` (the point-in-time `secureScores` only when no view is present) and C8b
  // `collect.secureScoreControlProfiles` (the control profiles, each stamped with the time it was
  // observed). Met when the newest dated score lists at least one recommendation (controlScores) or
  // a current (not deprecated) control profile names one. A score without a date → not_met. Unread,
  // empty, or no recommendation listed → not_assessed, reads printed.
  safeLinksEvaluator: (signals) => {
    const score = collectedRows(signals, [COLLECTED.SECURE_SCORES], SCORE_READ);
    const prof = collectedRows(signals, [COLLECTED.SECURE_SCORE_PROFILES]);
    const states = [...score.states, ...prof.states].join('; ');
    if (!score.read && !prof.read) {
      return { status: 'not_assessed', evidence: `Security advisories (Secure Score recommendations) not read — not assessed. Read: ${states}` };
    }
    if (score.rows.length === 0 && prof.rows.length === 0) {
      return { status: 'not_assessed', evidence: `Secure Score was read and returned 0 scores and 0 control profiles — not assessed (an empty read is not a negative finding). Read: ${states}` };
    }
    const undated = score.rows.filter((r) => !isoTime(fieldOf(r, 'createdDateTime')));
    if (undated.length > 0) {
      return { status: 'not_met', evidence: `${undated.length} of ${score.rows.length} Secure Score record(s) carry no date — advisory reads cannot be placed in time. Read: ${states}` };
    }
    const newest = [...score.rows].sort((a, b) => Date.parse(isoTime(fieldOf(b, 'createdDateTime'))) - Date.parse(isoTime(fieldOf(a, 'createdDateTime'))))[0];
    const listed = newest === undefined ? [] : fieldOf(newest, 'controlScores');
    const recs = (Array.isArray(listed) ? listed : []).filter((c) => str(fieldOf(c, 'controlName')));
    const profiles = latestVersions(prof.rows, (p) => str(fieldOf(p, 'id')), (p) => isoTime(fieldOf(p, OBSERVED_FIELD)))
      .filter((p) => str(fieldOf(p, 'title') ?? fieldOf(p, 'id')) && String(fieldOf(p, 'deprecated')).toLowerCase() !== 'true');
    if (recs.length === 0 && profiles.length === 0) {
      const what = newest === undefined ? 'No Secure Score' : `Secure Score of ${isoTime(fieldOf(newest, 'createdDateTime'))}`;
      return { status: 'not_assessed', evidence: `${what} lists no recommendations and no current control profile was read — advisories not evidenced; not assessed. Read: ${states}` };
    }
    const parts: string[] = [];
    if (recs.length > 0) {
      parts.push(`Secure Score of ${isoTime(fieldOf(newest, 'createdDateTime'))} lists ${recs.length} recommendation(s) (${recs.slice(0, 5).map((c) => str(fieldOf(c, 'controlName'))).join(', ')}); ${score.rows.length} dated score(s) collected`);
    }
    if (profiles.length > 0) {
      const seen = profiles.map((p) => isoTime(fieldOf(p, OBSERVED_FIELD))).filter(Boolean).sort();
      parts.push(`${profiles.length} current control profile(s) observed ${seen[seen.length - 1] ?? 'undated'} (${profiles.slice(0, 5).map((p) => `${str(fieldOf(p, 'title') ?? fieldOf(p, 'id'))}${str(fieldOf(p, 'implementationStatus')) ? ` [${str(fieldOf(p, 'implementationStatus'))}]` : ''}`).join(', ')})`);
    }
    return { status: 'met', evidence: `Security advisories read with dates: ${parts.join('; ')}. Read: ${states}` };
  },

  // EO-collection W2 (SI.L2-3.14.6, refines W0.4): met only when the three monitoring feeds were all
  // collected in the window and are healthy: the alerts (C6a), risk-detection (C5a) and Secure Score
  // (C8) reads succeeded on this pass, and Secure Score holds at least one score in the window.
  // A feed whose collector failed this pass is unhealthy even if older rows are stored (B19).
  // Point-in-time reads stand in only when no collected view is present. Otherwise not_assessed.
  monitoringEvaluator: (signals) => {
    const alerts = collectedRows(signals, [COLLECTED.SECURITY_ALERTS], ALERTS_READ);
    const risk = collectedRows(signals, [COLLECTED.RISK_DETECTIONS], RISK_READ);
    const score = collectedRows(signals, [COLLECTED.SECURE_SCORES], SCORE_READ);
    const reads = [...alerts.states, ...risk.states, ...score.states].join('; ');
    if (alerts.read && risk.read && score.read && score.rows.length > 0) {
      return { status: 'met', evidence: `All three monitoring feeds collected and healthy (security alerts, Identity Protection risk detections, Secure Score). Reads: ${reads}` };
    }
    const why = !alerts.read || !risk.read || !score.read ? 'a monitoring feed was not read' : 'Secure Score returned no score in the window';
    return { status: 'not_assessed', evidence: `Monitoring feeds not all operating (${why}) — not assessed. Reads: ${reads}` };
  },

  // EO-collection W2 (SI.L2-3.14.7): unauthorized-use detections exist with a disposition. Records:
  // Identity Protection risk detections (C5a) and alerts (C6a) whose category is an unauthorized-use
  // tactic (UNAUTHORIZED_USE_CATEGORIES); newest version of each. Disposition = the record carries its
  // state and a time: riskState and detectedDateTime on a detection, status and createdDateTime on an
  // alert. Met when at least one such record exists and every one has a disposition; a record without
  // one → not_met. Unread, empty, or no relevant record → not_assessed, reads printed.
  alertsEvaluator: (signals) => {
    const det = collectedRows(signals, [COLLECTED.RISK_DETECTIONS], RISK_READ);
    const al = collectedRows(signals, [COLLECTED.SECURITY_ALERTS], ALERTS_READ);
    const reads = [...det.states, ...al.states].join('; ');
    if (!det.read && !al.read) {
      return { status: 'not_assessed', evidence: `Unauthorized-use detections not read — not assessed. Reads: ${reads}` };
    }
    const detections = latestDetections(det.rows);
    const alerts = latestAlerts(al.rows).filter((a) => UNAUTHORIZED_USE_CATEGORIES.has(str(fieldOf(a, 'category')).toLowerCase()));
    const total = detections.length + alerts.length;
    if (total === 0) {
      return { status: 'not_assessed', evidence: `No risk detection or unauthorized-use alert in the window — not assessed (an empty read is not a negative finding). Reads: ${reads}` };
    }
    const undisposed = [
      ...detections.filter((d) => !str(fieldOf(d, 'riskState')) || !isoTime(fieldOf(d, 'detectedDateTime') ?? fieldOf(d, 'activityDateTime')))
        .map((d) => `risk detection ${str(fieldOf(d, 'id')) || '?'}`),
      ...alerts.filter((a) => !str(fieldOf(a, 'status')) || !isoTime(fieldOf(a, 'createdDateTime')))
        .map((a) => `alert ${str(fieldOf(a, 'id')) || '?'}`),
    ];
    if (undisposed.length > 0) {
      return { status: 'not_met', evidence: `${undisposed.length} of ${total} unauthorized-use detection(s) carry no disposition (state and time): ${undisposed.slice(0, 5).join(', ')}. Reads: ${reads}` };
    }
    const dispositions = [...new Set([
      ...detections.map((d) => `${str(fieldOf(d, 'riskEventType')) || 'risk'}: ${str(fieldOf(d, 'riskState'))}`),
      ...alerts.map((a) => `${str(fieldOf(a, 'category'))}: ${str(fieldOf(a, 'status'))}`),
    ])].slice(0, 6).join(', ');
    return { status: 'met', evidence: `${detections.length} risk detection(s) and ${alerts.length} unauthorized-use alert(s) identified, each with a disposition (${dispositions}). Reads: ${reads}` };
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
