// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * EO-collection W2 (first half): the audit-family collectors, registered in run order.
 *  - C1a unified audit log: Search-UnifiedAuditLog on the Exchange Online session (B17).
 *  - C2 Entra directory audits, C3 Entra sign-ins: Graph, `$filter=<time> ge <window start>`.
 *  - C4 PIM role-assignment schedule requests (activations): Graph, same windowing.
 * W2 second half (securityCollectors.ts): C5a/C5b risk, C6a/C6b Defender XDR, C7a/C7b TVM hunting,
 * C8 Secure Score, C8b Secure Score control profiles (W2 part 3), C9 Intune compliance.
 * Synthetic-customer W2 (adminOpsCollector.ts): C10 AdminOps evidence rows from the shared DB.
 */
import {
  COLLECTED, UAL_ENDPOINT, EXCHANGE_HOST, graphLogCollector, isoTime,
  type Collector,
} from './Collector.js';
import {
  riskDetectionsCollector, riskyUsersCollector, securityAlertsCollector, securityIncidentsCollector,
  tvmRecencyCollector, tvmVulnerabilitiesCollector, secureScoresCollector, secureScoreProfilesCollector, deviceComplianceCollector,
} from './securityCollectors.js';
import { adminOpsCollector } from './adminOpsCollector.js';

export const unifiedAuditLogCollector: Collector = {
  planId: 'C1a',
  sourceId: COLLECTED.UNIFIED_AUDIT_LOG,
  endpoint: UAL_ENDPOINT,
  signalSource: 'powershell',
  host: EXCHANGE_HOST,
  permission: 'Exchange Online View-Only Audit Logs role (not verified)',
  cadenceMinutes: 60,
  initialLookbackMinutes: 7 * 24 * 60,
  maxWindowMinutes: 24 * 60,
  overlapMinutes: 15,
  viewDays: 30,
  idOf: (it) => String((it as { Identity?: unknown })?.Identity ?? ''),
  timeOf: (it) => isoTime((it as { CreationDate?: unknown })?.CreationDate),
  async read(reader, window) {
    const r = await reader.searchUnifiedAuditLog(window.start, window.end);
    return { status: r.status, items: r.rows, query: r.query, ...(r.error ? { error: r.error } : {}) };
  },
};

export const directoryAuditsCollector: Collector = graphLogCollector({
  planId: 'C2',
  sourceId: COLLECTED.DIRECTORY_AUDITS,
  endpoint: '/auditLogs/directoryAudits',
  uriPath: '/v1.0/auditLogs/directoryAudits',
  timeField: 'activityDateTime',
  permission: 'AuditLog.Read.All',
  cadenceMinutes: 15,
  initialLookbackDays: 30,
  viewDays: 30,
});

export const signInsCollector: Collector = graphLogCollector({
  planId: 'C3',
  sourceId: COLLECTED.SIGN_INS,
  endpoint: '/auditLogs/signIns',
  uriPath: '/v1.0/auditLogs/signIns',
  timeField: 'createdDateTime',
  permission: 'AuditLog.Read.All, Policy.Read.All',
  cadenceMinutes: 15,
  initialLookbackDays: 30,
  viewDays: 30,
});

export const pimActivationsCollector: Collector = graphLogCollector({
  planId: 'C4',
  sourceId: COLLECTED.PIM_ACTIVATIONS,
  endpoint: '/roleManagement/directory/roleAssignmentScheduleRequests',
  uriPath: '/v1.0/roleManagement/directory/roleAssignmentScheduleRequests',
  timeField: 'createdDateTime',
  permission: 'RoleManagement.Read.Directory (read variant not verified)',
  cadenceMinutes: 15,
  initialLookbackDays: 30,
  viewDays: 30,
});

/** The registered collectors, in run order (one read at a time, FX-15). */
export const REGISTERED_COLLECTORS: readonly Collector[] = [
  unifiedAuditLogCollector,
  directoryAuditsCollector,
  signInsCollector,
  pimActivationsCollector,
  riskDetectionsCollector,
  riskyUsersCollector,
  securityAlertsCollector,
  securityIncidentsCollector,
  tvmRecencyCollector,
  tvmVulnerabilitiesCollector,
  secureScoresCollector,
  secureScoreProfilesCollector,
  deviceComplianceCollector,
  adminOpsCollector,
];
