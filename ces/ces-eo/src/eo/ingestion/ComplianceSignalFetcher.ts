// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { SessionManager } from '../core/SessionManager.js';
import type { SignalResult } from 'ces-shared/types/signal';
import { PowerShellFallbackAdapter } from './PowerShellFallbackAdapter.js';

const GRAPH_ENDPOINTS = {
  // Identity & Access (AC, IA families)
  CROSS_TENANT_ACCESS: '/policies/crossTenantAccessPolicy/default',  // AC.L2-3.1.1
  AUTH_STRENGTH_POLICIES: '/policies/authenticationStrengthPolicies', // IA.L2-3.5.3
  AUTH_METHODS_USERS: '/reports/authenticationMethods/userRegistrationDetails', // IA.L2-3.5.3

  // Audit & Accountability (AU family)
  DIRECTORY_AUDITS: '/auditLogs/directoryAudits',  // AU.L2-3.3.1, AU.L2-3.3.2
  SIGNIN_LOGS: '/auditLogs/signIns',               // AU.L2-3.3.1

  // Configuration Management (CM family)
  DEVICE_CONFIGS: '/deviceManagement/configurationPolicies',  // CM.L2-3.4.1, CM.L2-3.4.2
  DEVICE_INTENTS: '/deviceManagement/intents',                // CM.L2-3.4.1

  // Data Protection (SC family)
  SENSITIVITY_LABELS: '/informationProtection/sensitivityLabels',  // SC.L2-3.13.8
  DLP_POLICIES: '/informationProtection/dataLossPreventionPolicies', // SC.L2-3.13.8
  ENCRYPTION_STATES: '/deviceManagement/managedDeviceEncryptionStates', // SC.L2-3.13.16 (beta)

  // Security & Vulnerability (SI family)
  VULNERABILITIES: '/security/microsoft/vulnerabilities',  // SI.L2-3.14.1
  ATTACK_SIMULATIONS: '/security/attackSimulation/simulations', // AT.L2-3.2.1
  RISK_DETECTIONS: '/identityProtection/riskDetections',   // IA.L2-3.5.3
  SECURE_SCORE: '/security/secureScore',                   // SI.L2-3.14.4
};


/** FC-EO-D (EO-03) — registry endpoints of the overlay signals (matched by SignalToControlMapper). */
export const COVERAGE_ENDPOINTS = {
  TRAINING_USER_COVERAGE: '/reports/security/getAttackSimulationTrainingUserCoverage', // AT.L2-3.2.1, AT.L2-3.2.3
  USERS: '/users',                                                                     // AT.L2-3.2.1/3, PS.L2-3.9.2
  INCIDENTS: '/security/incidents',                                                    // AU.L2-3.3.5
  LIFECYCLE_WORKFLOWS: '/identityGovernance/lifecycleWorkflows/workflows',             // PS.L2-3.9.2
  ROLE_ASSIGNMENTS: '/roleManagement/directory/roleAssignments',                       // PS.L2-3.9.2
  MANAGED_DEVICES: '/deviceManagement/managedDevices',                                 // RA.L2-3.11.2
  HUNTING_QUERY: '/security/runHuntingQuery',                                          // RA.L2-3.11.2
} as const;

/**
 * W5c1 EO-fetch: the properties the evaluators read from the directory users read (Graph returns
 * only the selected properties; signInActivity and the lifecycle fields are returned only on $select).
 */
export const DIRECTORY_USER_SELECT = [
  'id', 'userPrincipalName', 'displayName', 'accountEnabled', 'userType', 'assignedLicenses',
  'signInActivity', 'createdDateTime', 'onPremisesSyncEnabled',
  'passwordPolicies', 'lastPasswordChangeDateTime',
  // W5 cycle 3 (AC.L2-3.1.6): pairs an admin account with the same person's normal account.
  'employeeId',
].join(',');

/** W5c1 EO-fetch: directory-role PIM policies with their rules (Graph requires the scope filter on list). */
export const PIM_POLICIES_URI =
  "/v1.0/policies/roleManagementPolicies?$filter=scopeId%20eq%20'/'%20and%20scopeType%20eq%20'DirectoryRole'&$expand=rules";

/**
 * W5c1 EO-fetch: settings-catalog policies with their settings (beta resource; settings only on $expand).
 * W5 cycle 3: and their assignments (an unassigned policy applies to no device; assignments only on $expand).
 */
export const CONFIGURATION_POLICIES_URI = '/beta/deviceManagement/configurationPolicies?$expand=settings,assignments';

/**
 * W5 cycle 3 (assignment-aware credit): the other assignable Intune reads, with their assignments
 * (Graph returns `assignments` only on $expand). Each signal keeps the endpoint the registry routes.
 */
export const DEVICE_CONFIGURATIONS_URI = '/v1.0/deviceManagement/deviceConfigurations?$expand=assignments';
export const COMPLIANCE_POLICIES_URI = '/v1.0/deviceManagement/deviceCompliancePolicies?$expand=assignments';
export const IOS_APP_PROTECTIONS_URI = '/v1.0/deviceAppManagement/iosManagedAppProtections?$expand=assignments';

/** W5 cycle 3 (AC.L2-3.1.6): PIM-eligible directory-role holders (the standing holders are roleAssignments). */
export const ROLE_ELIGIBILITY_ENDPOINT = '/roleManagement/directory/roleEligibilitySchedules';
export const ROLE_ELIGIBILITY_URI = `/v1.0${ROLE_ELIGIBILITY_ENDPOINT}`;

/**
 * W5 cycle 3 (policy reconciliation): the tenant values the policy-inputs ODPs are compared with. Not
 * routed to any control (reconciliation never sets a status); read back from the evidence store when
 * the SSP is generated. Directory settings hold smart lockout ('Password Rule Settings'); domains hold
 * the password validity period.
 */
export const DIRECTORY_SETTINGS_ENDPOINT = '/groupSettings';
export const DIRECTORY_SETTINGS_URI = '/v1.0/groupSettings';
export const DOMAINS_ENDPOINT = '/domains';
export const DOMAINS_URI = '/v1.0/domains';

/**
 * W5 cycle 2 (EO-6): deleted users (IA.L2-3.5.5, identifier reuse). Graph returns deleted users only
 * through the type-cast segment; the selected properties are what the evaluator compares.
 */
export const DELETED_USERS_ENDPOINT = '/directory/deletedItems/microsoft.graph.user';
export const DELETED_USERS_URI = `/v1.0${DELETED_USERS_ENDPOINT}?$select=id,userPrincipalName,deletedDateTime`;

/**
 * W5 cycle 5 (SC-3a, examine coverage): the reads behind the remaining automatable examine items. None is
 * routed to a control (no registry route), so no evaluator reads them and no status moves; the evidence
 * index attaches their latest returned, hashed record to the items data/examine-coverage-map.json names.
 * Each signal's endpoint is its own path (never a routed registry endpoint).
 */
export const EXAMINE_READ_ENDPOINTS = {
  /** SIM-W4c1: Defender protection state per Windows device (signature version and update time, last scans). */
  PROTECTION_STATES: '/deviceManagement/managedDevices/windowsProtectionState',
  /** SIM-W4c1: Defender malware detections with their per-device states. */
  MALWARE_INFORMATION: '/deviceManagement/windowsMalwareInformation',
  /** SIM-W4c2: terms-of-use acceptances (the users' acknowledgements of the notice). */
  TOU_ACCEPTANCES: '/identityGovernance/termsOfUse/agreements/acceptances',
  /** SIM-W4c3: access review definitions with their instances and decisions. */
  ACCESS_REVIEWS: '/identityGovernance/accessReviews/definitions',
  /** SIM-W4c6: Intune remote actions (wipe, retire) and the matching Intune audit events. */
  REMOTE_ACTION_AUDITS: '/deviceManagement/remoteActionAudits',
  WIPE_AUDIT_EVENTS: '/deviceManagement/auditEvents',
  /** SIM-W4c7: SharePoint site permissions, per site. */
  SITE_PERMISSIONS: '/sites/permissions',
} as const;

/** W5 cycle 5: the Windows managed devices whose protection state is read (all pages). */
export const WINDOWS_DEVICES_URI = "/v1.0/deviceManagement/managedDevices?$select=id,deviceName,operatingSystem&$filter=operatingSystem%20eq%20'Windows'";
/** W5 cycle 5: one device's Defender protection state (`{id}` = the managed device id). */
export const PROTECTION_STATE_URI = '/beta/deviceManagement/managedDevices/{id}/windowsProtectionState';
export const MALWARE_INFORMATION_URI = '/beta/deviceManagement/windowsMalwareInformation';
export const DEVICE_MALWARE_STATES_URI = '/beta/deviceManagement/windowsMalwareInformation/{id}/deviceMalwareStates';
export const TOU_AGREEMENTS_URI = '/v1.0/identityGovernance/termsOfUse/agreements';
export const TOU_ACCEPTANCES_URI = '/v1.0/identityGovernance/termsOfUse/agreements/{id}/acceptances';
export const ACCESS_REVIEW_DEFINITIONS_URI = '/v1.0/identityGovernance/accessReviews/definitions';
export const ACCESS_REVIEW_INSTANCES_URI = '/v1.0/identityGovernance/accessReviews/definitions/{id}/instances';
export const ACCESS_REVIEW_DECISIONS_URI = '/v1.0/identityGovernance/accessReviews/definitions/{id}/instances/{iid}/decisions';
export const REMOTE_ACTION_AUDITS_URI = '/beta/deviceManagement/remoteActionAudits';
export const SITES_URI = '/v1.0/sites?search=*&$select=id,webUrl,displayName';
export const SITE_PERMISSIONS_URI = '/v1.0/sites/{id}/permissions';

/** PowerShell: every page of one Graph collection URI (in `$u`) appended to the array named `$target`. */
const psPages = (uriExpr: string, target: string): string =>
  `$u = ${uriExpr}; do { $r = Invoke-MgGraphRequest -Method GET -Uri $u; if ($r.value) { ${target} += $r.value }; $u = $r.'@odata.nextLink' } while ($u)`;

/** Latest Defender vulnerability-management assessment per device (read-only KQL). */
export const TVM_RECENCY_QUERY =
  'DeviceTvmInfoGathering | summarize LastAssessed = max(Timestamp) by DeviceId, DeviceName';

/** Graph host for GCC High (L4). */
export const GRAPH_HOST = 'graph.microsoft.us';

/**
 * EO-collection W1.4: what was actually sent for one read: the host and the request (URI with its
 * query string, or the cmdlet). Kept beside the SignalResult (which is unchanged) for the store.
 */
export interface CollectedRead {
  signalId: string;
  host: string;
  query: string;
}

/** EO-collection W2 C1a: one `Search-UnifiedAuditLog` window (rows in the EXO object shape). */
export interface UnifiedAuditLogRead {
  status: 'success' | 'error' | 'not_assessed';
  rows: unknown[];
  /** The search command sent (no connect line). */
  query: string;
  error?: string;
}

/**
 * Unified API client that fetches compliance signals from Microsoft Graph
 * via PowerShell cmdlets (SessionManager) and PowerShell fallback for Exchange/Purview.
 */
export class ComplianceSignalFetcher {
  private readonly sessionManager: SessionManager;
  private readonly psAdapter: PowerShellFallbackAdapter;
  /** W1.4: the request behind each read made through fetchEndpoint / fetchGraphCollection. */
  private readonly readLog = new Map<string, CollectedRead>();

  constructor(sessionManager: SessionManager, psAdapter: PowerShellFallbackAdapter) {
    this.sessionManager = sessionManager;
    this.psAdapter = psAdapter;
  }

  private async fetchEndpoint(
    signalId: string,
    endpoint: string,
    isBeta: boolean = false,
    cmdletArgs: string = ''
  ): Promise<SignalResult> {
    const now = new Date().toISOString();
    const cmdlet = `${this.endpointToCmdlet(endpoint)}${cmdletArgs ? ` ${cmdletArgs}` : ''}`;
    const cmd = isBeta
      ? `Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/beta${endpoint}' -Method GET | ConvertTo-Json -Depth 10`
      : `${cmdlet} | ConvertTo-Json -Depth 10`;
    this.readLog.set(signalId, { signalId, host: GRAPH_HOST, query: isBeta ? `GET https://${GRAPH_HOST}/beta${endpoint}` : cmdlet });

    try {
      const result = await this.sessionManager.execute('mgraph', cmd);
      const data = JSON.parse(result.stdout.replace(/EO_EXECUTION_SUCCESS\s*$/, '').trim());
      const signal: SignalResult = {
        signalId,
        source: 'graph',
        endpoint,
        timestamp: now,
        rawData: data,
        status: 'success',
        findings: [],
      };
      this.preParse(signal);
      return signal;
    } catch (err: any) {
      const statusCode = err?.statusCode ?? this.extractStatusCode(err);

      // 403 = missing permissions, return not_assessed
      if (statusCode === 403) {
        return {
          signalId,
          source: 'graph',
          endpoint,
          timestamp: now,
          rawData: null,
          status: 'not_assessed',
          findings: [`Missing permissions for ${endpoint}: ${err.message ?? String(err)}`],
        };
      }

      // 429 = rate limit, wait 5s and retry once
      if (statusCode === 429) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        try {
          const retryResult = await this.sessionManager.execute('mgraph', cmd);
          const retryData = JSON.parse(retryResult.stdout.replace(/EO_EXECUTION_SUCCESS\s*$/, '').trim());
          const signal: SignalResult = {
            signalId,
            source: 'graph',
            endpoint,
            timestamp: now,
            rawData: retryData,
            status: 'success',
            findings: ['Retried after rate limit'],
          };
          this.preParse(signal);
          return signal;
        } catch (retryErr: any) {
          return {
            signalId,
            source: 'graph',
            endpoint,
            timestamp: now,
            rawData: null,
            status: 'error',
            findings: [`Rate limit retry failed: ${retryErr.message ?? String(retryErr)}`],
          };
        }
      }

      // 404 = beta endpoint not available in GCC High, return not_assessed with finding
      if (statusCode === 404 && isBeta) {
        return {
          signalId,
          source: 'graph',
          endpoint,
          timestamp: now,
          rawData: null,
          status: 'not_assessed',
          findings: [`Beta endpoint ${endpoint} not available in GCC High`],
        };
      }

      // All other errors return error status
      return {
        signalId,
        source: 'graph',
        endpoint,
        timestamp: now,
        rawData: null,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
        findings: [err instanceof Error ? err.message : String(err)],
      };
    }
  }

  private preParse(signal: SignalResult): void {
    if (signal.status !== 'success' || !signal.rawData) return;

    const data = signal.rawData as any;
    const items = Array.isArray(data) ? data : (Array.isArray(data?.value) ? data.value : null);

    // Pre-parse enabled CA policies
    if (signal.endpoint === '/identity/conditionalAccess/policies' && items) {
      const enabledPolicies = items.filter((p: any) => p.state === 'enabled');
      signal.parsed = {
        enabledPolicies,
        enabledCount: enabledPolicies.length,
        totalCount: items.length,
      };
    }

    // Pre-parse compliant devices
    if (signal.endpoint === '/deviceManagement/managedDevices' && items) {
      const compliantDevices = items.filter((d: any) => d.complianceState === 'compliant');
      signal.parsed = {
        compliantDevices,
        compliantCount: compliantDevices.length,
        totalCount: items.length,
      };
      const percentage = items.length > 0 ? (compliantDevices.length / items.length) * 100 : 0;
      signal.metadata = {
        compliantCount: compliantDevices.length,
        totalCount: items.length,
        threshold: 95,
        percentage,
      };
      signal.complianceState = percentage >= 95 ? 'compliant' : 'non_compliant';
    }

    // Pre-parse encryption states
    if (signal.endpoint === GRAPH_ENDPOINTS.ENCRYPTION_STATES && items) {
      const encrypted = items.filter((e: any) => e.encryptionState === 'encrypted');
      signal.parsed = {
        encryptedDevices: encrypted,
        encryptedCount: encrypted.length,
        totalCount: items.length,
      };
    }
  }

  private extractStatusCode(err: any): number | undefined {
    if (typeof err?.statusCode === 'number') return err.statusCode;
    const msg = err?.message ?? String(err);
    const match = msg.match(/(\d{3})/);
    if (match) {
      const code = parseInt(match[1], 10);
      if (code >= 400 && code < 600) return code;
    }
    return undefined;
  }

  async fetchIdentitySignals(): Promise<SignalResult[]> {
    const signals: SignalResult[] = [];
    const now = new Date().toISOString();

    const endpoints = [
      { id: 'conditionalAccess', path: '/identity/conditionalAccess/policies', cmdlet: 'Get-MgIdentityConditionalAccessPolicy' },
      { id: 'authMethods', path: '/policies/authenticationMethodsPolicy', cmdlet: 'Get-MgPolicyAuthenticationMethodPolicy' },
      { id: 'roleAssignments', path: '/roleManagement/directory/roleAssignments', cmdlet: 'Get-MgRoleManagementDirectoryRoleAssignment' },
    ];

    for (const ep of endpoints) {
      try {
        const result = await this.sessionManager.execute(
          'mgraph',
          `${ep.cmdlet} | ConvertTo-Json -Depth 10`
        );
        const data = JSON.parse(result.stdout.replace(/EO_EXECUTION_SUCCESS\s*$/, '').trim());
        const signal: SignalResult = {
          signalId: ep.id,
          source: 'graph',
          endpoint: ep.path,
          timestamp: now,
          rawData: data,
          status: 'success',
        };
        this.preParse(signal);
        signals.push(signal);
      } catch (err) {
        signals.push({
          signalId: ep.id,
          source: 'graph',
          endpoint: ep.path,
          timestamp: now,
          rawData: null,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return signals;
  }

  async fetchDeviceSignals(): Promise<SignalResult[]> {
    const signals: SignalResult[] = [];
    const now = new Date().toISOString();

    const endpoints = [
      { id: 'managedDevices', path: '/deviceManagement/managedDevices', cmdlet: 'Get-MgDeviceManagementManagedDevice' },
      { id: 'detectedApps', path: '/deviceManagement/detectedApps', cmdlet: 'Get-MgDeviceManagementDetectedApp' },
    ];

    for (const ep of endpoints) {
      try {
        const result = await this.sessionManager.execute(
          'mgraph',
          `${ep.cmdlet} | ConvertTo-Json -Depth 10`
        );
        const data = JSON.parse(result.stdout.replace(/EO_EXECUTION_SUCCESS\s*$/, '').trim());
        const signal: SignalResult = {
          signalId: ep.id,
          source: 'graph',
          endpoint: ep.path,
          timestamp: now,
          rawData: data,
          status: 'success',
        };
        this.preParse(signal);
        signals.push(signal);
      } catch (err) {
        signals.push({
          signalId: ep.id,
          source: 'graph',
          endpoint: ep.path,
          timestamp: now,
          rawData: null,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // W5 cycle 3: compliance policies with their assignments (first, as before).
    signals.unshift(await this.fetchGraphCollection('compliancePolicies', '/deviceManagement/deviceCompliancePolicies', COMPLIANCE_POLICIES_URI));
    return signals;
  }

  async fetchSecuritySignals(): Promise<SignalResult[]> {
    const signals: SignalResult[] = [];
    const now = new Date().toISOString();

    const endpoints = [
      { id: 'secureScores', path: '/security/secureScores', cmdlet: 'Get-MgSecuritySecureScore' },
      { id: 'securityAlerts', path: '/security/alerts_v2', cmdlet: 'Get-MgSecurityAlert' },
    ];

    for (const ep of endpoints) {
      try {
        const result = await this.sessionManager.execute(
          'mgraph',
          `${ep.cmdlet} | ConvertTo-Json -Depth 10`
        );
        const data = JSON.parse(result.stdout.replace(/EO_EXECUTION_SUCCESS\s*$/, '').trim());
        signals.push({
          signalId: ep.id,
          source: 'graph',
          endpoint: ep.path,
          timestamp: now,
          rawData: data,
          status: 'success',
        });
      } catch (err) {
        signals.push({
          signalId: ep.id,
          source: 'graph',
          endpoint: ep.path,
          timestamp: now,
          rawData: null,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return signals;
  }

  async fetchDlpSignals(): Promise<SignalResult[]> {
    const now = new Date().toISOString();
    try {
      const result = await this.sessionManager.execute(
        'mgraph',
        'Get-MgInformationProtectionPolicyLabel | ConvertTo-Json -Depth 10'
      );
      const data = JSON.parse(result.stdout.replace(/EO_EXECUTION_SUCCESS\s*$/, '').trim());
      return [{
        signalId: 'dlpLabels',
        source: 'graph',
        endpoint: '/informationProtection/policy/labels',
        timestamp: now,
        rawData: data,
        status: 'success',
      }];
    } catch (err) {
      return [{
        signalId: 'dlpLabels',
        source: 'graph',
        endpoint: '/informationProtection/policy/labels',
        timestamp: now,
        rawData: null,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      }];
    }
  }

  async fetchGroupMembership(): Promise<SignalResult[]> {
    const now = new Date().toISOString();
    try {
      const result = await this.sessionManager.execute(
        'mgraph',
        "Get-MgGroup -Filter \"displayName eq 'CUI-Authorized-Users'\" | ConvertTo-Json -Depth 10"
      );
      const data = JSON.parse(result.stdout.replace(/EO_EXECUTION_SUCCESS\s*$/, '').trim());
      return [{
        signalId: 'cuiGroup',
        source: 'graph',
        endpoint: "/groups?$filter=displayName eq 'CUI-Authorized-Users'",
        timestamp: now,
        rawData: data,
        status: 'success',
      }];
    } catch (err) {
      return [{
        signalId: 'cuiGroup',
        source: 'graph',
        endpoint: "/groups?$filter=displayName eq 'CUI-Authorized-Users'",
        timestamp: now,
        rawData: null,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      }];
    }
  }

  async fetchAuthorizationPolicy(): Promise<SignalResult[]> {
    const now = new Date().toISOString();
    try {
      const result = await this.sessionManager.execute(
        'mgraph',
        'Get-MgPolicyAuthorizationPolicy | ConvertTo-Json -Depth 10'
      );
      const data = JSON.parse(result.stdout.replace(/EO_EXECUTION_SUCCESS\s*$/, '').trim());
      return [{
        signalId: 'authorizationPolicy',
        source: 'graph',
        endpoint: '/policies/authorizationPolicy',
        timestamp: now,
        rawData: data,
        status: 'success',
      }];
    } catch (err) {
      return [{
        signalId: 'authorizationPolicy',
        source: 'graph',
        endpoint: '/policies/authorizationPolicy',
        timestamp: now,
        rawData: null,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      }];
    }
  }

  async fetchNamedLocations(): Promise<SignalResult[]> {
    const now = new Date().toISOString();
    try {
      const result = await this.sessionManager.execute(
        'mgraph',
        'Get-MgIdentityConditionalAccessNamedLocation | ConvertTo-Json -Depth 10'
      );
      const data = JSON.parse(result.stdout.replace(/EO_EXECUTION_SUCCESS\s*$/, '').trim());
      return [{
        signalId: 'namedLocations',
        source: 'graph',
        endpoint: '/identity/conditionalAccess/namedLocations',
        timestamp: now,
        rawData: data,
        status: 'success',
      }];
    } catch (err) {
      return [{
        signalId: 'namedLocations',
        source: 'graph',
        endpoint: '/identity/conditionalAccess/namedLocations',
        timestamp: now,
        rawData: null,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      }];
    }
  }

  /** W5 cycle 3: read through the Graph REST list with `$expand=assignments` (was the cmdlet). */
  async fetchDeviceConfigurations(): Promise<SignalResult[]> {
    return [await this.fetchGraphCollection('deviceConfigurations', '/deviceManagement/deviceConfigurations', DEVICE_CONFIGURATIONS_URI)];
  }

  /**
   * W5 cycle 3: read through the Graph REST list with `$expand=assignments` (was the cmdlet). The signal
   * keeps the endpoint string the registry routes.
   */
  async fetchManagedAppProtections(): Promise<SignalResult[]> {
    return [await this.fetchGraphCollection('appProtections', '/deviceAppManagement/iosManagedAppProtectionPolicies', IOS_APP_PROTECTIONS_URI)];
  }

  async fetchAuthStrengthPolicies(): Promise<SignalResult[]> {
    const now = new Date().toISOString();
    try {
      const result = await this.sessionManager.execute(
        'mgraph',
        'Get-MgPolicyAuthenticationStrengthPolicy | ConvertTo-Json -Depth 10'
      );
      const data = JSON.parse(result.stdout.replace(/EO_EXECUTION_SUCCESS\s*$/, '').trim());
      return [{
        signalId: 'authStrength',
        source: 'graph',
        endpoint: '/policies/authenticationStrengthPolicies',
        timestamp: now,
        rawData: data,
        status: 'success',
      }];
    } catch (err) {
      return [{
        signalId: 'authStrength',
        source: 'graph',
        endpoint: '/policies/authenticationStrengthPolicies',
        timestamp: now,
        rawData: null,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      }];
    }
  }

  async fetchAgreements(): Promise<SignalResult[]> {
    const now = new Date().toISOString();
    try {
      const result = await this.sessionManager.execute(
        'mgraph',
        'Get-MgAgreement | ConvertTo-Json -Depth 10'
      );
      const data = JSON.parse(result.stdout.replace(/EO_EXECUTION_SUCCESS\s*$/, '').trim());
      return [{
        signalId: 'agreements',
        source: 'graph',
        endpoint: '/agreements',
        timestamp: now,
        rawData: data,
        status: 'success',
      }];
    } catch (err) {
      return [{
        signalId: 'agreements',
        source: 'graph',
        endpoint: '/agreements',
        timestamp: now,
        rawData: null,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      }];
    }
  }

  async fetchPimPolicies(): Promise<SignalResult[]> {
    return [await this.fetchGraphCollection('pimPolicies', '/policies/roleManagementPolicies', PIM_POLICIES_URI)];
  }

  async fetchConfigurationPolicies(): Promise<SignalResult[]> {
    return [await this.fetchGraphCollection('configurationPolicies', GRAPH_ENDPOINTS.DEVICE_CONFIGS, CONFIGURATION_POLICIES_URI)];
  }

  /** W5 cycle 2 (EO-6): deleted users, all pages (signal `deletedUsers`, read by IA.L2-3.5.5). */
  async fetchDeletedUsers(): Promise<SignalResult[]> {
    return [await this.fetchGraphCollection('deletedUsers', DELETED_USERS_ENDPOINT, DELETED_USERS_URI)];
  }

  /**
   * W5 cycle 8 (IA.L2-3.5.3, S3-D06): the per-user MFA registration report (signal
   * `userRegistrationDetails`), through its cmdlet (the endpoint's cmdlet map).
   * W7-EO: with `-All`; without it the SDK cmdlet returns only the first page on a real tenant.
   */
  async fetchRegistrationDetails(): Promise<SignalResult[]> {
    return [await this.fetchEndpoint('userRegistrationDetails', GRAPH_ENDPOINTS.AUTH_METHODS_USERS, false, '-All')];
  }

  /** W5 cycle 3 (AC.L2-3.1.6): PIM-eligible directory-role holders. */
  async fetchRoleEligibility(): Promise<SignalResult[]> {
    return [await this.fetchGraphCollection('roleEligibilitySchedules', ROLE_ELIGIBILITY_ENDPOINT, ROLE_ELIGIBILITY_URI)];
  }

  /** W5 cycle 3 (policy reconciliation): directory settings and domains (unrouted; see DIRECTORY_SETTINGS_URI). */
  async fetchReconciliationReads(): Promise<SignalResult[]> {
    return [
      await this.fetchGraphCollection('directorySettings', DIRECTORY_SETTINGS_ENDPOINT, DIRECTORY_SETTINGS_URI),
      await this.fetchGraphCollection('domains', DOMAINS_ENDPOINT, DOMAINS_URI),
    ];
  }

  /**
   * W5 cycle 5 (SC-3a): one read that is not a single Graph collection (a list, then a sub-resource per
   * listed object; or a cmdlet with a time filter), run as one PowerShell command that prints
   * `{ value: [...] }`. `query` is what the store records (the list request and the per-object path).
   * Errors map as in fetchGraphCollection (401/403 not_assessed, else error).
   */
  private async fetchComposite(signalId: string, endpoint: string, cmd: string, query: string): Promise<SignalResult> {
    const now = new Date().toISOString();
    this.readLog.set(signalId, { signalId, host: GRAPH_HOST, query });
    try {
      const result = await this.sessionManager.execute('mgraph', cmd);
      const data = JSON.parse(result.stdout.replace(/EO_EXECUTION_SUCCESS\s*$/, '').trim());
      return { signalId, source: 'graph', endpoint, timestamp: now, rawData: data, status: 'success', findings: [] };
    } catch (err: any) {
      const statusCode = err?.statusCode ?? this.extractStatusCode(err);
      const message = err instanceof Error ? err.message : String(err);
      if (statusCode === 403 || statusCode === 401) {
        return { signalId, source: 'graph', endpoint, timestamp: now, rawData: null, status: 'not_assessed',
          findings: [`Missing permissions for ${endpoint}: ${message}`] };
      }
      return { signalId, source: 'graph', endpoint, timestamp: now, rawData: null, status: 'error', error: message, findings: [message] };
    }
  }

  /**
   * W5 cycle 5 (SC-3a): the examine-coverage reads (SIM-W4c1..W4c3, W4c6, W4c7; W4c4 is the Purview
   * `protectionAlerts` command, W4c5 the existing settings-catalog read). Unrouted: no control status
   * reads them. Logs are windowed by a `ge <time>` filter in the request (the store records the window);
   * state reads (protection state, acceptances, reviews, permissions) are point in time. One read at a time.
   * Permissions (not verified live): DeviceManagementManagedDevices.Read.All, Agreement.Read.All,
   * AccessReview.Read.All, DeviceManagementApps.Read.All (audit events), Sites.FullControl.All (site permissions).
   */
  async fetchExamineCoverageReads(nowMs: number = Date.now()): Promise<SignalResult[]> {
    const day = 24 * 60 * 60 * 1000;
    const since90 = new Date(nowMs - 90 * day).toISOString();
    const since365 = new Date(nowMs - 365 * day).toISOString();
    const q = (v: string) => v.replace(/'/g, "''");
    const lit = (v: string) => `'${q(v)}'`;
    const sub = (prefix: string, idExpr: string, suffix = '') => `('${q(prefix)}' + ${idExpr}${suffix ? ` + '${q(suffix)}'` : ''})`;
    const json = '@{ value = $all } | ConvertTo-Json -Depth 10 -Compress';
    const E = EXAMINE_READ_ENDPOINTS;
    const malwareUri = `${MALWARE_INFORMATION_URI}?$filter=lastDetectionDateTime%20ge%20${since90}`;
    const auditCmdlet = `Get-MgDeviceManagementAuditEvent -All | Where-Object activityType in ('Wipe ManagedDevice', 'Retire ManagedDevice') and activityDateTime ge ${since365}`;
    const reads: Array<() => Promise<SignalResult>> = [
      () => this.fetchComposite('defenderProtectionStates', E.PROTECTION_STATES,
        `$devs = @(); ${psPages(lit(WINDOWS_DEVICES_URI), '$devs')}; $all = @(); foreach ($d in $devs) { try { $s = Invoke-MgGraphRequest -Method GET -Uri ${sub('/beta/deviceManagement/managedDevices/', '$d.id', '/windowsProtectionState')}; if ($s) { $all += @{ managedDeviceId = $d.id; deviceName = $d.deviceName; windowsProtectionState = $s } } } catch { } }; ${json}`,
        `GET ${WINDOWS_DEVICES_URI}; per device: GET ${PROTECTION_STATE_URI}`),
      () => this.fetchComposite('windowsMalwareInformation', E.MALWARE_INFORMATION,
        `$mal = @(); ${psPages(lit(malwareUri), '$mal')}; $all = @(); foreach ($m in $mal) { $st = @(); ${psPages(sub('/beta/deviceManagement/windowsMalwareInformation/', '$m.id', '/deviceMalwareStates'), '$st')}; $all += @{ malware = $m; deviceMalwareStates = $st } }; ${json}`,
        `GET ${malwareUri}; per malware: GET ${DEVICE_MALWARE_STATES_URI}`),
      () => this.fetchComposite('touAcceptances', E.TOU_ACCEPTANCES,
        `$ags = @(); ${psPages(lit(TOU_AGREEMENTS_URI), '$ags')}; $all = @(); foreach ($a in $ags) { ${psPages(sub('/v1.0/identityGovernance/termsOfUse/agreements/', '$a.id', '/acceptances'), '$all')} }; ${json}`,
        `GET ${TOU_AGREEMENTS_URI}; per agreement: GET ${TOU_ACCEPTANCES_URI}`),
      () => this.fetchComposite('accessReviews', E.ACCESS_REVIEWS,
        `$defs = @(); ${psPages(lit(ACCESS_REVIEW_DEFINITIONS_URI), '$defs')}; $all = @(); foreach ($d in $defs) { $ins = @(); ${psPages(sub('/v1.0/identityGovernance/accessReviews/definitions/', '$d.id', '/instances'), '$ins')}; $out = @(); foreach ($i in $ins) { $dec = @(); ${psPages(`('${q('/v1.0/identityGovernance/accessReviews/definitions/')}' + $d.id + '/instances/' + $i.id + '/decisions')`, '$dec')}; $out += @{ instance = $i; decisions = $dec } }; $all += @{ definition = $d; instances = $out } }; ${json}`,
        `GET ${ACCESS_REVIEW_DEFINITIONS_URI}; per definition: GET ${ACCESS_REVIEW_INSTANCES_URI}; per instance: GET ${ACCESS_REVIEW_DECISIONS_URI}`),
      () => this.fetchGraphCollection('remoteActionAudits', E.REMOTE_ACTION_AUDITS,
        `${REMOTE_ACTION_AUDITS_URI}?$filter=requestDateTime%20ge%20${since365}`),
      () => this.fetchComposite('intuneWipeAuditEvents', E.WIPE_AUDIT_EVENTS,
        `$all = @(Get-MgDeviceManagementAuditEvent -All | Where-Object { @('Wipe ManagedDevice', 'Retire ManagedDevice') -contains $_.activityType -and [datetime]$_.activityDateTime -ge [datetime]'${since365}' }); ${json}`,
        auditCmdlet),
      () => this.fetchComposite('sitePermissions', E.SITE_PERMISSIONS,
        `$sites = @(); ${psPages(lit(SITES_URI), '$sites')}; $all = @(); foreach ($s in $sites) { $p = @(); ${psPages(sub('/v1.0/sites/', '$s.id', '/permissions'), '$p')}; $all += @{ siteId = $s.id; webUrl = $s.webUrl; displayName = $s.displayName; permissions = $p } }; ${json}`,
        `GET ${SITES_URI}; per site: GET ${SITE_PERMISSIONS_URI}`),
    ];
    const results: SignalResult[] = [];
    for (const read of reads) results.push(await read());
    return results;
  }

  async fetchVulnerabilities(): Promise<SignalResult[]> {
    const now = new Date().toISOString();
    try {
      const result = await this.sessionManager.execute(
        'mgraph',
        'Get-MgSecurityThreatIntelligenceVulnerability | ConvertTo-Json -Depth 10'
      );
      const data = JSON.parse(result.stdout.replace(/EO_EXECUTION_SUCCESS\s*$/, '').trim());
      return [{
        signalId: 'vulnerabilities',
        source: 'graph',
        endpoint: '/security/microsoft/vulnerabilities',
        timestamp: now,
        rawData: data,
        status: 'success',
      }];
    } catch (err) {
      return [{
        signalId: 'vulnerabilities',
        source: 'graph',
        endpoint: '/security/microsoft/vulnerabilities',
        timestamp: now,
        rawData: null,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      }];
    }
  }

  /**
   * W0.3 (P0 #2): the audit and risk reads that were defined in the never-called expanded set
   * and are registered and GA in L4. Windowed by the record's own date field (directory audits
   * and sign-ins 30 days, risk detections 90 days), all pages via fetchGraphCollection. The
   * cross-tenant access policy (AC.L1-3.1.20) is a singleton, not a collection, so it keeps the
   * single-object cmdlet read. One read at a time on the shared session (FX-15).
   */
  async fetchAuditSignals(nowMs: number = Date.now()): Promise<SignalResult[]> {
    const day = 24 * 60 * 60 * 1000;
    const since30 = new Date(nowMs - 30 * day).toISOString();
    const since90 = new Date(nowMs - 90 * day).toISOString();
    const reads: Array<() => Promise<SignalResult>> = [
      () => this.fetchGraphCollection('directoryAudits', GRAPH_ENDPOINTS.DIRECTORY_AUDITS,
        `/v1.0/auditLogs/directoryAudits?$filter=activityDateTime%20ge%20${since30}`),
      () => this.fetchGraphCollection('signInLogs', GRAPH_ENDPOINTS.SIGNIN_LOGS,
        `/v1.0/auditLogs/signIns?$filter=createdDateTime%20ge%20${since30}`),
      () => this.fetchGraphCollection('riskDetections', GRAPH_ENDPOINTS.RISK_DETECTIONS,
        `/v1.0/identityProtection/riskDetections?$filter=detectedDateTime%20ge%20${since90}`),
      () => this.fetchEndpoint('crossTenantPolicy', GRAPH_ENDPOINTS.CROSS_TENANT_ACCESS),
    ];
    const results: SignalResult[] = [];
    for (const read of reads) results.push(await read());
    return results;
  }

  /**
   * FC-EO-D (EO-03) — one read-only Graph collection, ALL pages, via Invoke-MgGraphRequest (flat
   * Graph JSON, no SDK AdditionalProperties). `endpoint` is the registry path the mapper matches;
   * `uri` is the versioned request (query string allowed). POST is used ONLY for the advanced-hunting
   * read query (runHuntingQuery), which reads and never mutates tenant state.
   */
  async fetchGraphCollection(
    signalId: string,
    endpoint: string,
    uri: string,
    huntingQuery?: string,
  ): Promise<SignalResult> {
    const now = new Date().toISOString();
    const q = (v: string) => v.replace(/'/g, "''");
    const cmd = huntingQuery !== undefined
      ? `$b = @{ Query = '${q(huntingQuery)}' } | ConvertTo-Json -Compress; Invoke-MgGraphRequest -Method POST -Uri '${q(uri)}' -Body $b -ContentType 'application/json' | ConvertTo-Json -Depth 10 -Compress`
      : `$u = '${q(uri)}'; $all = @(); do { $r = Invoke-MgGraphRequest -Method GET -Uri $u; if ($r.value) { $all += $r.value }; $u = $r.'@odata.nextLink' } while ($u); @{ value = $all } | ConvertTo-Json -Depth 10 -Compress`;
    this.readLog.set(signalId, { signalId, host: GRAPH_HOST, query: huntingQuery !== undefined ? `POST ${uri} ${huntingQuery}` : `GET ${uri}` });
    try {
      const result = await this.sessionManager.execute('mgraph', cmd);
      const data = JSON.parse(result.stdout.replace(/EO_EXECUTION_SUCCESS\s*$/, '').trim());
      return { signalId, source: 'graph', endpoint, timestamp: now, rawData: data, status: 'success', findings: [] };
    } catch (err: any) {
      const statusCode = err?.statusCode ?? this.extractStatusCode(err);
      const message = err instanceof Error ? err.message : String(err);
      if (statusCode === 403 || statusCode === 401) {
        return { signalId, source: 'graph', endpoint, timestamp: now, rawData: null, status: 'not_assessed',
          findings: [`Missing permissions for ${endpoint}: ${message}`] };
      }
      return { signalId, source: 'graph', endpoint, timestamp: now, rawData: null, status: 'error', error: message, findings: [message] };
    }
  }

  /**
   * FC-EO-D (EO-03) — the reads behind the six automatic-signal-coverage controls (now registered
   * directly in the shared Microsoft control-signal registry, ces-shared 2.8.0). All are read-only
   * and tenant-scoped (the session is the requested tenant's own). The collections these evaluators
   * rely on for completeness (users, role assignments, managed devices) are read with paging under
   * their own signal ids so existing evaluators' inputs are unchanged.
   */
  async fetchCoverageSignals(nowMs: number = Date.now()): Promise<SignalResult[]> {
    const since = new Date(nowMs - 90 * 24 * 60 * 60 * 1000).toISOString();
    // FX-15 (K5): one read at a time on the shared session (see fetchAllSignals).
    const reads: Array<() => Promise<SignalResult>> = [
      () => this.fetchGraphCollection('trainingUserCoverage', COVERAGE_ENDPOINTS.TRAINING_USER_COVERAGE,
        '/v1.0/reports/security/getAttackSimulationTrainingUserCoverage'),
      () => this.fetchGraphCollection('directoryUsers', COVERAGE_ENDPOINTS.USERS,
        `/v1.0/users?$select=${DIRECTORY_USER_SELECT}&$top=999`),
      () => this.fetchGraphCollection('securityIncidents', COVERAGE_ENDPOINTS.INCIDENTS,
        `/v1.0/security/incidents?$expand=alerts&$filter=createdDateTime%20ge%20${since}`),
      () => this.fetchGraphCollection('lifecycleWorkflows', COVERAGE_ENDPOINTS.LIFECYCLE_WORKFLOWS,
        '/v1.0/identityGovernance/lifecycleWorkflows/workflows?$expand=tasks'),
      () => this.fetchGraphCollection('roleAssignmentsAll', COVERAGE_ENDPOINTS.ROLE_ASSIGNMENTS,
        '/v1.0/roleManagement/directory/roleAssignments'),
      () => this.fetchGraphCollection('managedDevicesAll', COVERAGE_ENDPOINTS.MANAGED_DEVICES,
        '/v1.0/deviceManagement/managedDevices?$select=id,deviceName,operatingSystem'),
      () => this.fetchGraphCollection('tvmAssessmentRecency', COVERAGE_ENDPOINTS.HUNTING_QUERY,
        '/v1.0/security/runHuntingQuery', TVM_RECENCY_QUERY),
    ];
    const results: SignalResult[] = [];
    for (const read of reads) results.push(await read());
    return results;
  }

  /**
   * W1.4: host and request for a signal this fetcher returned. Reads made through fetchEndpoint
   * and fetchGraphCollection report what was sent; the other Graph reads report their cmdlet
   * (the endpoint's cmdlet map); PowerShell-fallback reads report the session kind and the
   * command id (the connect line carries the tenant's app and certificate ids, so it is not kept).
   */
  describeRead(signal: SignalResult): CollectedRead {
    const logged = this.readLog.get(signal.signalId);
    if (logged) return logged;
    if (signal.source === 'graph') {
      return { signalId: signal.signalId, host: GRAPH_HOST, query: this.endpointToCmdlet(signal.endpoint) };
    }
    return { signalId: signal.signalId, host: `${signal.source}:exchange-online-gcch`, query: signal.endpoint };
  }

  /**
   * EO-collection W2 C1a (B17): one window of the unified audit log via `Search-UnifiedAuditLog`
   * on the tenant's Exchange Online session (connected by ces-tenant with
   * `-ExchangeEnvironmentName O365USGovGCCHigh`; no connect line here). `-SessionCommand
   * ReturnLargeSet` pages within one `-SessionId` until ResultCount rows are read (EXO caps a
   * session at 50,000). Read-only. Returns the rows (EXO object shape) or the failure.
   */
  async searchUnifiedAuditLog(startIso: string, endIso: string): Promise<UnifiedAuditLogRead> {
    const sessionId = `ces-eo-ual-${Date.parse(startIso)}-${Date.parse(endIso)}`;
    const search = `Search-UnifiedAuditLog -StartDate '${startIso}' -EndDate '${endIso}' -SessionId '${sessionId}' -SessionCommand ReturnLargeSet -ResultSize 5000`;
    const cmd = `$all = @(); do { $r = @(${search}); $all += $r } while ($r.Count -gt 0 -and $all.Count -lt $r[0].ResultCount -and $all.Count -lt 50000); ConvertTo-Json -InputObject @($all) -Depth 10 -Compress`;
    try {
      const result = await this.sessionManager.execute('exchange', cmd);
      const text = result.stdout.replace(/EO_EXECUTION_SUCCESS\s*$/, '').trim();
      const parsed = text === '' ? [] : JSON.parse(text);
      const rows = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === 'object' ? [parsed] : []);
      return { status: 'success', rows, query: search };
    } catch (err: any) {
      const statusCode = err?.statusCode ?? this.extractStatusCode(err);
      const message = err instanceof Error ? err.message : String(err);
      return { status: statusCode === 401 || statusCode === 403 ? 'not_assessed' : 'error', rows: [], query: search, error: message };
    }
  }

  async fetchSignalByEndpoint(signalId: string, endpoint: string): Promise<SignalResult> {
    return this.fetchEndpoint(signalId, endpoint);
  }

  async fetchExchangeConfig(): Promise<SignalResult[]> {
    return this.psAdapter.runExchangeCommands();
  }

  async fetchPurviewConfig(): Promise<SignalResult[]> {
    return this.psAdapter.runPurviewCommands();
  }

  /**
   * Fetch all signal categories — single source of truth for full signal fetch.
   *
   * FX-15 (K5): the batches run one after another, not in parallel. Every batch shares one
   * persistent PowerShell session per session type. The session factory queues commands per
   * type, but its reconnect paths (stale connection / process death) kill the process, drop the
   * queue and start a new one, so a parallel caller still queued on the old chain then writes
   * to the new process's stdin alongside the reconnecting caller. The marker protocol then
   * hands one command's output to another, JSON parsing fails, the signal becomes `error`, and
   * the controls judged only from it (first: the CA policy read) flip run to run. Sequential
   * batches keep exactly one command in flight, in a fixed order.
   */
  async fetchAllSignals(): Promise<SignalResult[]> {
    const batches: Array<() => Promise<SignalResult[]>> = [
      () => this.fetchIdentitySignals(),
      () => this.fetchDeviceSignals(),
      () => this.fetchSecuritySignals(),
      () => this.fetchDlpSignals(),
      () => this.fetchGroupMembership(),
      () => this.fetchAuthorizationPolicy(),
      () => this.fetchNamedLocations(),
      () => this.fetchDeviceConfigurations(),
      () => this.fetchConfigurationPolicies(),
      () => this.fetchManagedAppProtections(),
      () => this.fetchAuthStrengthPolicies(),
      () => this.fetchAgreements(),
      () => this.fetchPimPolicies(),
      () => this.fetchDeletedUsers(),
      () => this.fetchRoleEligibility(),
      () => this.fetchRegistrationDetails(),
      () => this.fetchReconciliationReads(),
      () => this.fetchVulnerabilities(),
      () => this.fetchExamineCoverageReads(),
      () => this.fetchExchangeConfig(),
      () => this.fetchPurviewConfig(),
      () => this.fetchCoverageSignals(),
      () => this.fetchAuditSignals(),
    ];
    const signals: SignalResult[] = [];
    for (const batch of batches) signals.push(...(await batch()));
    return signals;
  }

  private endpointToCmdlet(endpoint: string): string {
    const map: Record<string, string> = {
      '/identity/conditionalAccess/policies': 'Get-MgIdentityConditionalAccessPolicy',
      '/policies/authenticationMethodsPolicy': 'Get-MgPolicyAuthenticationMethodPolicy',
      '/roleManagement/directory/roleAssignments': 'Get-MgRoleManagementDirectoryRoleAssignment',
      '/deviceManagement/deviceCompliancePolicies': 'Get-MgDeviceManagementDeviceCompliancePolicy',
      '/deviceManagement/managedDevices': 'Get-MgDeviceManagementManagedDevice',
      '/deviceManagement/detectedApps': 'Get-MgDeviceManagementDetectedApp',
      '/security/secureScores': 'Get-MgSecuritySecureScore',
      '/security/alerts_v2': 'Get-MgSecurityAlert',
      '/informationProtection/policy/labels': 'Get-MgInformationProtectionPolicyLabel',
      '/groups': 'Get-MgGroup',
      '/policies/authorizationPolicy': 'Get-MgPolicyAuthorizationPolicy',
      '/identity/conditionalAccess/namedLocations': 'Get-MgIdentityConditionalAccessNamedLocation',
      '/deviceManagement/deviceConfigurations': 'Get-MgDeviceManagementDeviceConfiguration',
      '/policies/authenticationStrengthPolicies': 'Get-MgPolicyAuthenticationStrengthPolicy',
      '/agreements': 'Get-MgAgreement',
      '/policies/roleManagementPolicies': 'Get-MgPolicyRoleManagementPolicy',
      '/policies/crossTenantAccessPolicy/default': 'Get-MgPolicyCrossTenantAccessPolicyDefault',
      '/reports/authenticationMethods/userRegistrationDetails': 'Get-MgReportAuthenticationMethodUserRegistrationDetail',
      '/auditLogs/directoryAudits': 'Get-MgAuditLogDirectoryAudit',
      '/auditLogs/signIns': 'Get-MgAuditLogSignIn',
      '/deviceManagement/configurationPolicies': 'Get-MgDeviceManagementConfigurationPolicy',
      '/deviceManagement/intents': 'Get-MgDeviceManagementIntent',
      '/informationProtection/sensitivityLabels': 'Get-MgInformationProtectionSensitivityLabel',
      '/informationProtection/dataLossPreventionPolicies': 'Get-MgInformationProtectionDataLossPreventionPolicy',
      '/security/microsoft/vulnerabilities': 'Get-MgSecurityThreatIntelligenceVulnerability',
      '/security/attackSimulation/simulations': 'Get-MgSecurityAttackSimulation',
      '/identityProtection/riskDetections': 'Get-MgRiskDetection',
      '/security/secureScore': 'Get-MgSecuritySecureScore',
    };
    return map[endpoint] ?? `Invoke-MgGraphRequest -Uri '${endpoint}' -Method GET`;
  }
}
