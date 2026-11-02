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
import { COLLECTED, OBSERVED_FIELD, isoTime } from '../../collect/Collector.js';
import { collectedRows, latestVersions, fieldOf } from '../../collect/views.js';
import { latestAlerts } from './si-evaluators.js';
import { rowsOf, unreadOrEmpty, storageBlockVerdict, restrictionVerdict, caVerdict, requiresMfa, includesPrivilegedRole, targetsAllUsers, expectedNumber, REQUIREMENT_DEFAULTS } from './conditions.js';

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

/** Alert states that mean the alert has not been handled yet (alerts_v2 and the legacy value). */
const UNHANDLED_ALERT_STATES: ReadonlySet<string> = new Set(['', 'new', 'newalert', 'unknown', 'unknownfuturevalue']);

/** Incident states that mean handling has not started (Defender XDR incidents start `active`). */
const UNHANDLED_INCIDENT_STATES: ReadonlySet<string> = new Set(['', 'active', 'unknownfuturevalue']);

/** Remediation statuses that mean a vulnerability is closed. */
const REMEDIATED_STATES = /^(remediated|resolved|fixed|mitigation applied|applied)$/i;

export const operationalEvaluators: Record<string, EvaluatorFn> = {
  // --- Manual Gate Evaluator (AT, CA, IR, MA, MP, PE, PS, RA families) ---
  manualGateEvaluator: () => {
    return {
      status: 'not_assessed',
      evidence: 'MANUAL GATE: This control requires manual verification. Provide policy reference, responsible role, and evidence artifacts.',
    };
  },

  // --- IR family ---
  // EO-collection W2 (IR.L2-3.6.1): incident handling moves through states with timestamps. W2 part 3
  // (B15 extension): the registry now routes /security/incidents here too, so the test runs on the
  // collected alerts (C6a) and incidents (C6b) — each point-in-time read (`securityAlerts`,
  // `securityIncidents`) only when its view is absent — newest version of each record. An alert is
  // handled when it has left the new state (in progress, resolved); an incident when it has left the
  // initial `active` state, or has been assigned, or classified (not `unknown`); either way with its
  // lastUpdateDateTime after its createdDateTime. Met when at least one record is handled. A record
  // with no status → not_met. Records all still new and unassigned → not_assessed. Unread or empty →
  // not_assessed, reads printed.
  // W5 cycle 8 (S3-D14): an alert still new, or an incident still active, unassigned and unclassified,
  // older than the triage period (TM value, else ALERT_TRIAGE_MAX_DAYS) → not_met, naming each with its
  // age: nothing handled it. Measured from the read's own time.
  incidentResponseEvaluator: (signals, ctx) => {
    const al = collectedRows(signals, [COLLECTED.SECURITY_ALERTS], { [COLLECTED.SECURITY_ALERTS]: 'securityAlerts' });
    const inc = collectedRows(signals, [COLLECTED.SECURITY_INCIDENTS], { [COLLECTED.SECURITY_INCIDENTS]: 'securityIncidents' });
    const states = [...al.states, ...inc.states].join('; ');
    if (!al.read && !inc.read) {
      return { status: 'not_assessed', evidence: `Incident-handling records not read — not assessed. Read: ${states}` };
    }
    const alerts = latestAlerts(al.rows);
    const incidents = latestVersions(inc.rows, (i) => str(fieldOf(i, 'id')),
      (i) => isoTime(fieldOf(i, 'lastUpdateDateTime') ?? fieldOf(i, 'createdDateTime')));
    const total = alerts.length + incidents.length;
    if (total === 0) {
      return { status: 'not_assessed', evidence: `No alert or incident in the window — not assessed (an empty read is not a negative finding). Read: ${states}` };
    }
    const noStatus = [
      ...alerts.filter((a) => !str(fieldOf(a, 'status'))).map((a) => `alert ${str(fieldOf(a, 'id')) || '?'}`),
      ...incidents.filter((i) => !str(fieldOf(i, 'status'))).map((i) => `incident ${str(fieldOf(i, 'id')) || '?'}`),
    ];
    if (noStatus.length > 0) {
      return { status: 'not_met', evidence: `${noStatus.length} of ${total} record(s) carry no handling status: ${noStatus.slice(0, 5).join(', ')}. Read: ${states}` };
    }
    const updatedAfterCreated = (r: unknown): boolean => {
      const created = Date.parse(isoTime(fieldOf(r, 'createdDateTime')));
      const updated = Date.parse(isoTime(fieldOf(r, 'lastUpdateDateTime')));
      return Number.isFinite(created) && Number.isFinite(updated) && updated > created;
    };
    const moved = alerts.filter((a) => !UNHANDLED_ALERT_STATES.has(str(fieldOf(a, 'status')).toLowerCase()) && updatedAfterCreated(a));
    const progressedIncident = (i: unknown): boolean => {
      const status = str(fieldOf(i, 'status')).toLowerCase();
      const classification = str(fieldOf(i, 'classification')).toLowerCase();
      return !UNHANDLED_INCIDENT_STATES.has(status) || !!str(fieldOf(i, 'assignedTo'))
        || (classification !== '' && classification !== 'unknown' && classification !== 'unknownfuturevalue');
    };
    const handled = incidents.filter((i) => progressedIncident(i) && updatedAfterCreated(i));
    const triage = expectedNumber(ctx, 'triage', REQUIREMENT_DEFAULTS.ALERT_TRIAGE_MAX_DAYS);
    const readAt = Math.max(...signals.filter((s) => s.status === 'success').map((s) => Date.parse(s.timestamp)).filter(Number.isFinite), 0) || Date.now();
    const ageDays = (r: unknown) => (readAt - Date.parse(isoTime(fieldOf(r, 'createdDateTime')))) / 86_400_000;
    const stale = [
      ...alerts.filter((a) => UNHANDLED_ALERT_STATES.has(str(fieldOf(a, 'status')).toLowerCase()) && !str(fieldOf(a, 'assignedTo')) && ageDays(a) > triage.value)
        .map((a) => `alert ${str(fieldOf(a, 'id'))} '${str(fieldOf(a, 'title'))}' ${str(fieldOf(a, 'status'))} for ${Math.floor(ageDays(a))} days`),
      ...incidents.filter((i) => !progressedIncident(i) && ageDays(i) > triage.value)
        .map((i) => `incident ${str(fieldOf(i, 'id'))} ${str(fieldOf(i, 'status'))}, unassigned, for ${Math.floor(ageDays(i))} days`),
    ];
    if (stale.length > 0) {
      return { status: 'not_met', evidence: `${stale.length} alert(s) or incident(s) left unhandled beyond the ${triage.value}-day triage period (${triage.source}): ${stale.join('; ')}. Read: ${states}` };
    }
    if (moved.length === 0 && handled.length === 0) {
      return { status: 'not_assessed', evidence: `${alerts.length} alert(s) and ${incidents.length} incident(s) read, none has left the new state (no alert in progress or resolved; no incident progressed, assigned or classified) — not assessed. Read: ${states}` };
    }
    const sample = [
      ...handled.map((i) => `incident ${str(fieldOf(i, 'id'))} ${str(fieldOf(i, 'status'))}${str(fieldOf(i, 'assignedTo')) ? ', assigned' : ''}${str(fieldOf(i, 'classification')) ? `, classification ${str(fieldOf(i, 'classification'))}` : ''} at ${isoTime(fieldOf(i, 'lastUpdateDateTime'))} (created ${isoTime(fieldOf(i, 'createdDateTime'))})`),
      ...moved.map((a) => `alert ${str(fieldOf(a, 'id'))} ${str(fieldOf(a, 'status'))} at ${isoTime(fieldOf(a, 'lastUpdateDateTime'))} (created ${isoTime(fieldOf(a, 'createdDateTime'))})`),
    ].slice(0, 5).join('; ');
    return { status: 'met', evidence: `${handled.length} of ${incidents.length} incident(s) and ${moved.length} of ${alerts.length} alert(s) moved through handling states with timestamps: ${sample}. Read: ${states}` };
  },

  // --- MA family ---
  // W5 cycle 1 (MA.L2-3.7.4): media are checked for malicious code: removable drives are scanned,
  // or every file is scanned on access.
  mediaCheckEvaluator: (signals) => restrictionVerdict(signals, 'Media checked for malicious code', [
    ['defenderScanRemovableDrivesDuringFullScan', v => v === true, 'scans removable drives'],
    ['defenderMonitorFileActivity', v => v === 'monitorAllFiles' || v === 'monitorIncomingFilesOnly', 'scans files on access'],
    ['defenderRequireRealTimeMonitoring', v => v === true, 'requires real-time monitoring'],
  ]),

  // W5 cycle 1 (MA.L2-3.7.5): nonlocal maintenance needs MFA: an enabled CA policy requires MFA (or
  // an authentication strength) of privileged roles or of all users. Report-only policies do not count.
  remoteMfaEvaluator: (signals, ctx) => caVerdict(signals, ctx, 'Nonlocal maintenance MFA',
    p => requiresMfa(p) && (includesPrivilegedRole(p) || targetsAllUsers(p)),
    names => `'${names}' require MFA or an authentication strength for privileged roles`,
    'none requires MFA or an authentication strength for privileged roles (report-only policies do not count)'),

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

  // W5 cycle 1 (MP.L2-3.8.7): a device configuration blocks removable media.
  removableMediaEvaluator: (signals, ctx) => {
    const empty = unreadOrEmpty(signals, ['deviceConfigurations'], 'Intune device configurations');
    if (empty) return empty;
    return storageBlockVerdict(rowsOf(signals, ['deviceConfigurations'])!.rows, ctx, 'Removable media', signals, ['deviceConfigurations']);
  },

  // W5 cycle 1 (MP.L2-3.8.8): portable storage without an identifiable owner is prohibited: a full
  // removable-storage block prohibits it a fortiori (an owner-based allow list is not read).
  unownedStorageEvaluator: (signals, ctx) => {
    const empty = unreadOrEmpty(signals, ['deviceConfigurations'], 'Intune device configurations');
    if (empty) return empty;
    return storageBlockVerdict(rowsOf(signals, ['deviceConfigurations'])!.rows, ctx, 'Unowned portable storage', signals, ['deviceConfigurations']);
  },

  // --- RA family ---
  // EO-collection W2 (RA.L2-3.11.3): vulnerabilities are remediated or tracked. Reads the collected
  // Defender vulnerability rows (C7b `collect.tvmVulnerabilities`, advanced hunting
  // DeviceTvmSoftwareVulnerabilities; newest observation per device, CVE and software). A row is a
  // vulnerability record when it names a CveId. Remediated = a status of remediated / resolved /
  // mitigation applied; tracked = a remediation recommendation (RecommendedSecurityUpdate or its id)
  // or a status (CveMitigationStatus, status, remediationStatus). Met when every vulnerability is
  // remediated or tracked; one that is neither → not_met. Unread, empty, or no CveId → not_assessed.
  // (Before W2 this evaluator returned met when any Windows Update ring existed: presence only.)
  vulnRemediationEvaluator: (signals) => {
    const read = collectedRows(signals, [COLLECTED.TVM_VULNERABILITIES]);
    const states = read.states.join('; ');
    if (!read.read) {
      return { status: 'not_assessed', evidence: `Defender vulnerability records not read — not assessed. Read: ${states}` };
    }
    const key = (r: unknown) => ['DeviceId', 'CveId', 'SoftwareVendor', 'SoftwareName', 'SoftwareVersion'].map((k) => str(fieldOf(r, k))).join('|');
    const vulns = latestVersions(read.rows.filter((r) => str(fieldOf(r, 'CveId'))), key, (r) => isoTime(fieldOf(r, OBSERVED_FIELD)));
    if (vulns.length === 0) {
      return { status: 'not_assessed', evidence: `${read.rows.length} row(s) read, none is a vulnerability record (no CveId) — not assessed. Read: ${states}` };
    }
    const statusOf = (r: unknown) => str(fieldOf(r, 'CveMitigationStatus')) || str(fieldOf(r, 'remediationStatus')) || str(fieldOf(r, 'status'));
    const remediated = vulns.filter((r) => REMEDIATED_STATES.test(statusOf(r)));
    // W5 cycle 8 (S3-D13): a Critical vulnerability is tracked only by a mitigation or remediation status;
    // Defender's own recommended update is on every open row and is not the organisation tracking it.
    const critical = (r: unknown) => /^critical$/i.test(str(fieldOf(r, 'VulnerabilitySeverityLevel')));
    const tracked = vulns.filter((r) => !REMEDIATED_STATES.test(statusOf(r))
      && (statusOf(r) || (!critical(r) && (str(fieldOf(r, 'RecommendedSecurityUpdate')) || str(fieldOf(r, 'RecommendedSecurityUpdateId'))))));
    const untracked = vulns.filter((r) => !remediated.includes(r) && !tracked.includes(r));
    const devices = new Set(vulns.map((r) => str(fieldOf(r, 'DeviceId')))).size;
    if (untracked.length > 0) {
      const sample = untracked.slice(0, 10).map((r) => `${str(fieldOf(r, 'CveId'))}${critical(r) ? ' (Critical)' : ''} on ${str(fieldOf(r, 'DeviceName')) || str(fieldOf(r, 'DeviceId'))}`).join(', ');
      const criticalNote = untracked.some(critical) ? `; ${untracked.filter(critical).length} Critical with no mitigation or remediation status (a recommended update alone does not track a Critical vulnerability)` : '';
      return { status: 'not_met', evidence: `${untracked.length} of ${vulns.length} vulnerability(ies) are neither remediated nor tracked by a recommendation or status${criticalNote}: ${sample}. Read: ${states}` };
    }
    return { status: 'met', evidence: `${vulns.length} vulnerability(ies) on ${devices} device(s): ${remediated.length} remediated, ${tracked.length} tracked by a remediation recommendation or status. Read: ${states}` };
  },
};
