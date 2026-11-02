// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * EO-collection W2 (second half): the security-monitoring collectors. All read Microsoft Graph on
 * the GCC High host (graph.microsoft.us) through the tenant's own Graph session; none is pushed
 * (Defender XDR alerts have no change notifications, so they are polled).
 *  - C5a risk detections, C5b risky users (Entra ID Protection): `$filter` on the record's time.
 *  - C6a alerts (alerts_v2), C6b incidents (`$expand=alerts`): `$filter=lastUpdateDateTime ge`;
 *    each update of an alert or incident is a new version (id@lastUpdateDateTime).
 *  - C7a TVM assessment recency, C7b TVM software vulnerabilities: advanced hunting (KQL, POST).
 *  - C8 Secure Score history: `/security/secureScores?$top=90`, kept from the window start on.
 *  - C8b Secure Score control profiles (W2 part 3): `/security/secureScoreControlProfiles`, the
 *    recommendations as advisories (snapshot), emitted under the registry endpoint
 *    `/security/secureScores` so they reach the same controls as C8.
 *  - C9 Intune device compliance: `/deviceManagement/managedDevices` (snapshot).
 * Snapshot sources (C7b, C9) have no event time: each row is stamped with the window end
 * (OBSERVED_FIELD) and its id carries its state, so an unchanged row is collected once per view
 * period and a changed state is a new row.
 */
import {
  COLLECTED, OBSERVED_FIELD, graphLogCollector, isoTime, readGraph,
  type Collector, type CollectorRead, type CollectWindow,
} from './Collector.js';

const GRAPH_HOST = 'graph.microsoft.us';
const HUNTING_ENDPOINT = '/security/runHuntingQuery';
const HUNTING_URI = '/v1.0/security/runHuntingQuery';
const DAY_MIN = 24 * 60;

const field = (it: unknown, k: string): unknown => (it && typeof it === 'object' ? (it as Record<string, unknown>)[k] : undefined);
const text = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/** Keep only rows dated at or after the window start (for reads the server cannot window). */
function inWindow(read: CollectorRead, window: CollectWindow, timeOf: (it: unknown) => string): CollectorRead {
  if (read.status !== 'success') return read;
  const start = Date.parse(window.start);
  return { ...read, items: read.items.filter((it) => { const t = Date.parse(timeOf(it)); return Number.isFinite(t) && t >= start; }) };
}

/** Stamp each row of a snapshot read with the window end. */
function observed(read: CollectorRead, window: CollectWindow): CollectorRead {
  if (read.status !== 'success') return read;
  return { ...read, items: read.items.map((it) => ({ ...(it as Record<string, unknown>), [OBSERVED_FIELD]: window.end })) };
}

export const riskDetectionsCollector: Collector = graphLogCollector({
  planId: 'C5a',
  sourceId: COLLECTED.RISK_DETECTIONS,
  endpoint: '/identityProtection/riskDetections',
  uriPath: '/v1.0/identityProtection/riskDetections',
  timeField: 'detectedDateTime',
  versionField: 'lastUpdatedDateTime',
  permission: 'IdentityRiskEvent.Read.All',
  cadenceMinutes: 60,
  initialLookbackDays: 90,
  viewDays: 90,
});

export const riskyUsersCollector: Collector = graphLogCollector({
  planId: 'C5b',
  sourceId: COLLECTED.RISKY_USERS,
  endpoint: '/identityProtection/riskyUsers',
  uriPath: '/v1.0/identityProtection/riskyUsers',
  timeField: 'riskLastUpdatedDateTime',
  versionField: 'riskLastUpdatedDateTime',
  permission: 'IdentityRiskyUser.Read.All',
  cadenceMinutes: 60,
  initialLookbackDays: 90,
  viewDays: 90,
});

export const securityAlertsCollector: Collector = graphLogCollector({
  planId: 'C6a',
  sourceId: COLLECTED.SECURITY_ALERTS,
  endpoint: '/security/alerts_v2',
  uriPath: '/v1.0/security/alerts_v2',
  timeField: 'lastUpdateDateTime',
  versionField: 'lastUpdateDateTime',
  permission: 'SecurityAlert.Read.All',
  cadenceMinutes: 15,
  initialLookbackDays: 30,
  viewDays: 30,
});

export const securityIncidentsCollector: Collector = graphLogCollector({
  planId: 'C6b',
  sourceId: COLLECTED.SECURITY_INCIDENTS,
  endpoint: '/security/incidents',
  uriPath: '/v1.0/security/incidents',
  expand: '$expand=alerts',
  timeField: 'lastUpdateDateTime',
  versionField: 'lastUpdateDateTime',
  permission: 'SecurityIncident.Read.All',
  cadenceMinutes: 15,
  initialLookbackDays: 90,
  viewDays: 90,
});

/** KQL: the latest Defender vulnerability-management assessment per device since the window start. */
export const tvmRecencyKql = (startIso: string): string =>
  `DeviceTvmInfoGathering | where Timestamp >= datetime(${startIso}) | summarize LastAssessed = max(Timestamp) by DeviceId, DeviceName`;

/** KQL: the current software vulnerabilities per device (a state table; it has no Timestamp). */
export const TVM_VULNERABILITIES_KQL = 'DeviceTvmSoftwareVulnerabilities';

const lastAssessedOf = (it: unknown): string => isoTime(field(it, 'LastAssessed') ?? field(it, 'Timestamp'));

export const tvmRecencyCollector: Collector = {
  planId: 'C7a',
  sourceId: COLLECTED.TVM_RECENCY,
  endpoint: HUNTING_ENDPOINT,
  signalSource: 'graph',
  host: GRAPH_HOST,
  permission: 'ThreatHunting.Read.All',
  cadenceMinutes: DAY_MIN,
  initialLookbackMinutes: 30 * DAY_MIN,
  overlapMinutes: 15,
  viewDays: 30,
  idOf: (it) => (text(field(it, 'DeviceId')) ? `${text(field(it, 'DeviceId'))}@${lastAssessedOf(it)}` : ''),
  timeOf: lastAssessedOf,
  async read(reader, window) {
    const read = await readGraph(reader, COLLECTED.TVM_RECENCY, HUNTING_ENDPOINT, HUNTING_URI, tvmRecencyKql(window.start));
    return inWindow(read, window, lastAssessedOf);
  },
};

export const tvmVulnerabilitiesCollector: Collector = {
  planId: 'C7b',
  sourceId: COLLECTED.TVM_VULNERABILITIES,
  endpoint: HUNTING_ENDPOINT,
  signalSource: 'graph',
  host: GRAPH_HOST,
  permission: 'ThreatHunting.Read.All',
  cadenceMinutes: DAY_MIN,
  initialLookbackMinutes: DAY_MIN,
  overlapMinutes: 15,
  viewDays: 30,
  idOf: (it) => ['DeviceId', 'CveId', 'SoftwareVendor', 'SoftwareName', 'SoftwareVersion', 'CveMitigationStatus']
    .map((k) => text(field(it, k))).join('|'),
  timeOf: (it) => isoTime(field(it, OBSERVED_FIELD)),
  async read(reader, window) {
    return observed(await readGraph(reader, COLLECTED.TVM_VULNERABILITIES, HUNTING_ENDPOINT, HUNTING_URI, TVM_VULNERABILITIES_KQL), window);
  },
};

export const secureScoresCollector: Collector = {
  planId: 'C8',
  sourceId: COLLECTED.SECURE_SCORES,
  endpoint: '/security/secureScores',
  signalSource: 'graph',
  host: GRAPH_HOST,
  permission: 'SecurityEvents.Read.All',
  cadenceMinutes: DAY_MIN,
  initialLookbackMinutes: 90 * DAY_MIN,
  overlapMinutes: 15,
  viewDays: 90,
  idOf: (it) => text(field(it, 'id')),
  timeOf: (it) => isoTime(field(it, 'createdDateTime')),
  async read(reader, window) {
    const read = await readGraph(reader, COLLECTED.SECURE_SCORES, '/security/secureScores', '/v1.0/security/secureScores?$top=90');
    return inWindow(read, window, (it) => isoTime(field(it, 'createdDateTime')));
  },
};

export const secureScoreProfilesCollector: Collector = {
  planId: 'C8b',
  sourceId: COLLECTED.SECURE_SCORE_PROFILES,
  endpoint: '/security/secureScores',
  signalSource: 'graph',
  host: GRAPH_HOST,
  permission: 'SecurityEvents.Read.All',
  cadenceMinutes: DAY_MIN,
  initialLookbackMinutes: DAY_MIN,
  overlapMinutes: 15,
  viewDays: 30,
  idOf: (it) => (text(field(it, 'id')) ? `${text(field(it, 'id'))}|${text(field(it, 'implementationStatus'))}|${text(field(it, 'deprecated'))}` : ''),
  timeOf: (it) => isoTime(field(it, OBSERVED_FIELD)),
  async read(reader, window) {
    return observed(await readGraph(reader, COLLECTED.SECURE_SCORE_PROFILES, '/security/secureScores', '/v1.0/security/secureScoreControlProfiles'), window);
  },
};

export const deviceComplianceCollector: Collector = {
  planId: 'C9',
  sourceId: COLLECTED.DEVICE_COMPLIANCE,
  endpoint: '/deviceManagement/managedDevices',
  signalSource: 'graph',
  host: GRAPH_HOST,
  permission: 'DeviceManagementManagedDevices.Read.All',
  cadenceMinutes: DAY_MIN,
  initialLookbackMinutes: DAY_MIN,
  overlapMinutes: 15,
  viewDays: 30,
  idOf: (it) => (text(field(it, 'id')) ? `${text(field(it, 'id'))}|${text(field(it, 'complianceState'))}` : ''),
  timeOf: (it) => isoTime(field(it, OBSERVED_FIELD)),
  async read(reader, window) {
    const uri = '/v1.0/deviceManagement/managedDevices?$select=id,deviceName,operatingSystem,complianceState,lastSyncDateTime';
    return observed(await readGraph(reader, COLLECTED.DEVICE_COMPLIANCE, '/deviceManagement/managedDevices', uri), window);
  },
};
