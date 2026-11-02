// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import type { StoreObject } from '../../store/StoreTypes.js';
import type { SeedSet } from './gccHighG5.js';

/**
 * EO-collection B20 (founder decision 2026-10-27, option (b)): the minimal
 * log-type seed EvidenceOps' periodic collectors need, opted into by the
 * `muster-partial` scenario only (`"seedSets": ["eo-collection-b20"]`).
 * Nothing here is configuration: every object is an audit, risk, incident or
 * activation RECORD, so the scenario's pre-Stamper configuration posture
 * (and Muster's expectedFacts) is unchanged.
 *
 * Contents (built on the m365_azure profile's generated users user-1..5,
 * managedDevice-1..4, alert-1..2 and riskDetection-1):
 *  - unifiedAuditLog: 30 rows across Exchange, SharePoint/OneDrive, Entra ID
 *    and Teams; 28 dated inside the last 30 days, 2 older (35 and 45 days).
 *  - securityIncidents: 1 incident whose 2 alerts are the generated alert-1
 *    and alert-2, enriched here with the alerts_v2 fields (incidentId,
 *    serviceSource, createdDateTime, lastUpdateDateTime, evidence ...).
 *  - riskyUsers: 1 (user-3). riskDetections: 2 for user-3 - the generated
 *    riskDetection-1 enriched with its user and dates, plus 1 added.
 *  - roleAssignmentScheduleRequests: 1 PIM self-activation by user-1, with
 *    the matching UAL row.
 *
 * "Now": there is no fixed scenario clock. Every timestamp is the seed
 * engine's single build-time `now`, floored to the UTC hour, minus a fixed
 * offset - so a rebuild in the same hour yields identical B20 records, and the
 * dates are absolute once written (no read-time re-dating, unlike the
 * gcc-high-g5 set's `ageMinutes` audit rows). Ids are fixed literals.
 *
 * Users, domain and addresses are fictional (simtenant.onmicrosoft.us,
 * RFC 5737 documentation IPs); the role template id is the built-in
 * Security Administrator platform constant.
 */

export const EO_COLLECTION_B20 = 'eo-collection-b20';

const DOMAIN = 'simtenant.onmicrosoft.us';
const upn = (n: number) => `sim.user${n}@${DOMAIN}`;
const TENANT_ID = 'sim-tenant-id';
const SECURITY_ADMINISTRATOR = '194ae4cb-b126-40b2-bd5b-6091b380977d';

/** Deterministic UAL record id: the row's Identity and its AuditData.Id. */
export const b20UalId = (n: number) => `b2000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const H = 60;
const D = 1440;

/** UAL RecordType enum name -> the integer AuditData carries. */
const RECORD_TYPE_NUM: Record<string, number> = {
  ExchangeAdmin: 1,
  ExchangeItem: 2,
  SharePointFileOperation: 6,
  AzureActiveDirectory: 8,
  SharePointSharingOperation: 14,
  AzureActiveDirectoryStsLogon: 15,
  MicrosoftTeams: 25,
  ExchangeItemAggregated: 50,
};

interface UalRow {
  ageMin: number;
  recordType: string;
  operation: string;
  user: number;
  workload: string;
  extra?: Record<string, unknown>;
}

const CUI_SITE = 'https://simtenant.sharepoint.us/sites/engineering';

/** The 30 rows, newest first. Ages are minutes before the hour-floored build time. */
const UAL_ROWS: UalRow[] = [
  { ageMin: 1 * H, recordType: 'ExchangeItemAggregated', operation: 'MailItemsAccessed', user: 3, workload: 'Exchange', extra: { MailboxOwnerUPN: upn(3), OperationCount: 4 } },
  { ageMin: 3 * H, recordType: 'SharePointFileOperation', operation: 'FileAccessed', user: 3, workload: 'SharePoint', extra: { ObjectId: `${CUI_SITE}/Shared Documents/fixture-7731.docx`, SiteUrl: CUI_SITE } },
  { ageMin: 5 * H, recordType: 'MicrosoftTeams', operation: 'MessageSent', user: 1, workload: 'MicrosoftTeams', extra: { TeamName: 'Sim Engineering', ChannelName: 'General' } },
  { ageMin: 8 * H, recordType: 'AzureActiveDirectoryStsLogon', operation: 'UserLoggedIn', user: 1, workload: 'AzureActiveDirectory', extra: { ClientIP: '192.0.2.10', LogonError: null } },
  { ageMin: 1 * D, recordType: 'SharePointFileOperation', operation: 'FileModified', user: 3, workload: 'SharePoint', extra: { ObjectId: `${CUI_SITE}/Shared Documents/fixture-7731.docx`, SiteUrl: CUI_SITE } },
  { ageMin: 1 * D + 2 * H, recordType: 'ExchangeItem', operation: 'Send', user: 1, workload: 'Exchange', extra: { Item: { Subject: 'Sim weekly status' } } },
  { ageMin: 2 * D, recordType: 'AzureActiveDirectory', operation: 'Add member to role completed (PIM activation)', user: 1, workload: 'AzureActiveDirectory', extra: { ObjectId: upn(1), Target: [{ ID: 'Security Administrator', Type: 1 }], ModifiedProperties: [{ Name: 'Role.TemplateId', NewValue: SECURITY_ADMINISTRATOR }] } },
  { ageMin: 2 * D + 1 * H, recordType: 'MicrosoftTeams', operation: 'MemberAdded', user: 1, workload: 'MicrosoftTeams', extra: { TeamName: 'Sim Engineering', Members: [{ UPN: upn(3), Role: 1 }] } },
  { ageMin: 3 * D, recordType: 'AzureActiveDirectoryStsLogon', operation: 'UserLoggedIn', user: 3, workload: 'AzureActiveDirectory', extra: { ClientIP: '203.0.113.50', LogonError: null } },
  { ageMin: 3 * D + 30, recordType: 'AzureActiveDirectoryStsLogon', operation: 'UserLoginFailed', user: 3, workload: 'AzureActiveDirectory', extra: { ClientIP: '198.51.100.23', LogonError: 'InvalidUserNameOrPassword' } },
  { ageMin: 3 * D + 2 * H, recordType: 'ExchangeItem', operation: 'MoveToDeletedItems', user: 3, workload: 'Exchange', extra: { Item: { Subject: 'Sim: action required on your account' } } },
  { ageMin: 4 * D, recordType: 'SharePointSharingOperation', operation: 'SharingInvitationCreated', user: 3, workload: 'SharePoint', extra: { ObjectId: `${CUI_SITE}/Shared Documents/drawing-0420.pdf`, TargetUserOrGroupName: 'partner.two@example.test' } },
  { ageMin: 5 * D, recordType: 'ExchangeAdmin', operation: 'Set-Mailbox', user: 1, workload: 'Exchange', extra: { ObjectId: upn(3), Parameters: [{ Name: 'AuditEnabled', Value: 'True' }] } },
  { ageMin: 6 * D, recordType: 'AzureActiveDirectory', operation: 'Update user.', user: 1, workload: 'AzureActiveDirectory', extra: { ObjectId: upn(3) } },
  { ageMin: 7 * D, recordType: 'SharePointFileOperation', operation: 'FileDownloaded', user: 3, workload: 'SharePoint', extra: { ObjectId: `${CUI_SITE}/Shared Documents/drawing-0420.pdf`, SiteUrl: CUI_SITE } },
  { ageMin: 8 * D, recordType: 'MicrosoftTeams', operation: 'TeamsSessionStarted', user: 3, workload: 'MicrosoftTeams', extra: {} },
  { ageMin: 9 * D, recordType: 'SharePointFileOperation', operation: 'FileUploaded', user: 1, workload: 'OneDrive', extra: { ObjectId: 'https://simtenant-my.sharepoint.us/personal/sim_user1/Documents/notes.txt' } },
  { ageMin: 10 * D, recordType: 'AzureActiveDirectory', operation: 'Add member to group.', user: 1, workload: 'AzureActiveDirectory', extra: { ObjectId: upn(3), Target: [{ ID: 'group-1', Type: 2 }] } },
  { ageMin: 12 * D, recordType: 'ExchangeAdmin', operation: 'Set-AdminAuditLogConfig', user: 1, workload: 'Exchange', extra: { Parameters: [{ Name: 'UnifiedAuditLogIngestionEnabled', Value: 'True' }] } },
  { ageMin: 14 * D, recordType: 'ExchangeItemAggregated', operation: 'MailItemsAccessed', user: 1, workload: 'Exchange', extra: { MailboxOwnerUPN: upn(1), OperationCount: 12 } },
  { ageMin: 15 * D, recordType: 'MicrosoftTeams', operation: 'ChannelAdded', user: 1, workload: 'MicrosoftTeams', extra: { TeamName: 'Sim Engineering', ChannelName: 'Program-CUI' } },
  { ageMin: 17 * D, recordType: 'SharePointSharingOperation', operation: 'SharingSet', user: 1, workload: 'SharePoint', extra: { ObjectId: CUI_SITE, TargetUserOrGroupName: 'CUI-Authorized-Users' } },
  { ageMin: 19 * D, recordType: 'AzureActiveDirectory', operation: 'Reset user password.', user: 1, workload: 'AzureActiveDirectory', extra: { ObjectId: upn(3) } },
  { ageMin: 21 * D, recordType: 'SharePointFileOperation', operation: 'FileDeleted', user: 3, workload: 'SharePoint', extra: { ObjectId: `${CUI_SITE}/Shared Documents/old-rev-0311.docx`, SiteUrl: CUI_SITE } },
  { ageMin: 23 * D, recordType: 'AzureActiveDirectoryStsLogon', operation: 'UserLoggedIn', user: 3, workload: 'AzureActiveDirectory', extra: { ClientIP: '192.0.2.33', LogonError: null } },
  { ageMin: 25 * D, recordType: 'MicrosoftTeams', operation: 'TeamCreated', user: 1, workload: 'MicrosoftTeams', extra: { TeamName: 'Sim Engineering' } },
  { ageMin: 27 * D, recordType: 'ExchangeAdmin', operation: 'New-TransportRule', user: 1, workload: 'Exchange', extra: { ObjectId: 'Sim external mail tag' } },
  { ageMin: 28 * D, recordType: 'SharePointFileOperation', operation: 'FileAccessed', user: 1, workload: 'SharePoint', extra: { ObjectId: `${CUI_SITE}/Shared Documents/fixture-7731.docx`, SiteUrl: CUI_SITE } },
  // Outside a 30-day window on purpose (window and backfill tests).
  { ageMin: 35 * D, recordType: 'AzureActiveDirectory', operation: 'Add user.', user: 1, workload: 'AzureActiveDirectory', extra: { ObjectId: upn(3) } },
  { ageMin: 45 * D, recordType: 'ExchangeAdmin', operation: 'Set-OrganizationConfig', user: 1, workload: 'Exchange', extra: { Parameters: [{ Name: 'AuditDisabled', Value: 'False' }] } },
];

export function buildEoCollectionB20Seed(nowMs: number): SeedSet {
  const anchor = Math.floor(nowMs / 3600000) * 3600000;
  const at = (ageMin: number) => new Date(anchor - ageMin * 60000).toISOString();
  // AuditData.CreationTime is the service's zone-less UTC form.
  const auditTime = (ageMin: number) => at(ageMin).replace(/\.\d{3}Z$/, '');

  const unifiedAuditLog: StoreObject[] = UAL_ROWS.map((r, i) => {
    const id = b20UalId(i + 1);
    return {
      id,
      CreationDate: at(r.ageMin),
      RecordType: r.recordType,
      Operations: r.operation,
      UserIds: upn(r.user),
      AuditData: JSON.stringify({
        CreationTime: auditTime(r.ageMin),
        Id: id,
        Operation: r.operation,
        OrganizationId: TENANT_ID,
        RecordType: RECORD_TYPE_NUM[r.recordType],
        ResultStatus: r.operation === 'UserLoginFailed' ? 'Failed' : 'Succeeded',
        UserKey: `user-${r.user}`,
        UserType: r.user === 1 ? 2 : 0,
        Version: 1,
        Workload: r.workload,
        UserId: upn(r.user),
        ...r.extra,
      }),
    };
  });

  // Incident timeline: phishing mail (alert-1, ~3d 2h ago), then a risky
  // sign-in from the same user (alert-2, ~3d ago), correlated into one
  // incident and last updated a day ago.
  const userEvidence = {
    '@odata.type': '#microsoft.graph.security.userEvidence',
    roles: ['impacted'],
    userAccount: { accountName: 'sim.user3', azureAdUserId: 'user-3', displayName: 'Sim User 3', userPrincipalName: upn(3) },
  };
  const alertEnrich: Record<string, Record<string, unknown>> = {
    'alert-1': {
      providerAlertId: 'sim-mdo-0001',
      incidentId: 'incident-b20-1',
      serviceSource: 'microsoftDefenderForOffice365',
      detectionSource: 'microsoftDefenderForOffice365',
      category: 'InitialAccess',
      classification: null,
      determination: null,
      description: 'A user clicked a link in an email that was later found to be malicious.',
      createdDateTime: at(3 * D + 2 * H),
      firstActivityDateTime: at(3 * D + 2 * H + 10),
      lastActivityDateTime: at(3 * D + 2 * H),
      lastUpdateDateTime: at(2 * D),
      mitreTechniques: ['T1566.002'],
      tenantId: TENANT_ID,
      evidence: [userEvidence],
    },
    'alert-2': {
      providerAlertId: 'sim-aadip-0001',
      incidentId: 'incident-b20-1',
      serviceSource: 'azureAdIdentityProtection',
      detectionSource: 'azureAdIdentityProtection',
      category: 'InitialAccess',
      classification: null,
      determination: null,
      description: 'Sign-in from an anonymized IP address with unfamiliar properties.',
      createdDateTime: at(3 * D),
      firstActivityDateTime: at(3 * D + 30),
      lastActivityDateTime: at(3 * D),
      lastUpdateDateTime: at(1 * D),
      mitreTechniques: ['T1078'],
      tenantId: TENANT_ID,
      evidence: [
        userEvidence,
        { '@odata.type': '#microsoft.graph.security.deviceEvidence', roles: ['impacted'], mdeDeviceId: 'managedDevice-3', deviceDnsName: 'Sim Managed Device 3' },
      ],
    },
  };
  const inlineAlert = (id: string, title: string, e: Record<string, unknown>) => ({
    id,
    title,
    severity: 'medium',
    status: 'newAlert',
    incidentId: e.incidentId,
    serviceSource: e.serviceSource,
    detectionSource: e.detectionSource,
    createdDateTime: e.createdDateTime,
    lastUpdateDateTime: e.lastUpdateDateTime,
  });
  const securityIncidents: StoreObject[] = [
    {
      id: 'incident-b20-1',
      displayName: 'Initial access involving one user (phishing click and risky sign-in)',
      severity: 'medium',
      status: 'active',
      classification: 'unknown',
      determination: 'unknown',
      assignedTo: upn(1),
      tenantId: TENANT_ID,
      createdDateTime: at(3 * D + 2 * H),
      lastUpdateDateTime: at(1 * D),
      incidentWebUrl: 'https://security.microsoft.us/incidents/incident-b20-1',
      alerts: [
        inlineAlert('alert-1', 'Sim Security Alert 1', alertEnrich['alert-1']),
        inlineAlert('alert-2', 'Sim Security Alert 2', alertEnrich['alert-2']),
      ],
    },
  ];

  const detection = (ageMin: number, riskEventType: string, ip: string) => ({
    riskEventType,
    riskDetail: 'none',
    detectionTimingType: 'realtime',
    activity: 'signin',
    source: 'IdentityProtection',
    tokenIssuerType: 'AzureAD',
    userId: 'user-3',
    userDisplayName: 'Sim User 3',
    userPrincipalName: upn(3),
    ipAddress: ip,
    location: { city: 'Unknown', countryOrRegion: 'ZZ' },
    activityDateTime: at(ageMin),
    detectedDateTime: at(ageMin),
    lastUpdatedDateTime: at(ageMin),
  });
  const riskDetectionEnrich = {
    'riskDetection-1': detection(3 * D + 30, 'unfamiliarFeatures', '198.51.100.23'),
  };
  const riskDetections: StoreObject[] = [
    { id: 'riskDetection-b20-2', riskLevel: 'high', riskState: 'atRisk', ...detection(3 * D, 'anonymizedIPAddress', '203.0.113.50') },
  ];
  const riskyUsers: StoreObject[] = [
    {
      id: 'user-3',
      userPrincipalName: upn(3),
      userDisplayName: 'Sim User 3',
      riskLevel: 'high',
      riskState: 'atRisk',
      riskDetail: 'none',
      riskLastUpdatedDateTime: at(3 * D),
      isDeleted: false,
      isProcessing: false,
    },
  ];

  const roleAssignmentScheduleRequests: StoreObject[] = [
    {
      id: 'roleAssignmentScheduleRequest-b20-1',
      action: 'selfActivate',
      principalId: 'user-1',
      roleDefinitionId: SECURITY_ADMINISTRATOR,
      directoryScopeId: '/',
      appScopeId: null,
      isValidationOnly: false,
      targetScheduleId: 'roleAssignmentScheduleRequest-b20-1',
      justification: 'Investigate incident-b20-1',
      status: 'Provisioned',
      approvalId: null,
      createdDateTime: at(2 * D),
      completedDateTime: at(2 * D - 1),
      createdBy: { user: { id: 'user-1', displayName: 'Sim User 1' } },
      scheduleInfo: { startDateTime: at(2 * D - 1), expiration: { type: 'afterDuration', duration: 'PT4H', endDateTime: null } },
      ticketInfo: { ticketNumber: 'SIM-IR-0001', ticketSystem: 'Sim ITSM' },
    },
  ];

  return {
    enrich: { alerts: alertEnrich, riskDetections: riskDetectionEnrich },
    add: { unifiedAuditLog, securityIncidents, riskDetections, riskyUsers, roleAssignmentScheduleRequests },
  };
}
