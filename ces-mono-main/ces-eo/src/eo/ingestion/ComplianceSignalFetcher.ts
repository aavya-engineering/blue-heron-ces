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

/** Latest Defender vulnerability-management assessment per device (read-only KQL). */
export const TVM_RECENCY_QUERY =
  'DeviceTvmInfoGathering | summarize LastAssessed = max(Timestamp) by DeviceId, DeviceName';

/**
 * Unified API client that fetches compliance signals from Microsoft Graph
 * via PowerShell cmdlets (SessionManager) and PowerShell fallback for Exchange/Purview.
 */
export class ComplianceSignalFetcher {
  private readonly sessionManager: SessionManager;
  private readonly psAdapter: PowerShellFallbackAdapter;

  constructor(sessionManager: SessionManager, psAdapter: PowerShellFallbackAdapter) {
    this.sessionManager = sessionManager;
    this.psAdapter = psAdapter;
  }

  private async fetchEndpoint(
    signalId: string,
    endpoint: string,
    isBeta: boolean = false
  ): Promise<SignalResult> {
    const now = new Date().toISOString();
    const cmdlet = this.endpointToCmdlet(endpoint);
    const cmd = isBeta
      ? `Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/beta${endpoint}' -Method GET | ConvertTo-Json -Depth 5`
      : `${cmdlet} | ConvertTo-Json -Depth 5`;

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
          `${ep.cmdlet} | ConvertTo-Json -Depth 5`
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
      { id: 'compliancePolicies', path: '/deviceManagement/deviceCompliancePolicies', cmdlet: 'Get-MgDeviceManagementDeviceCompliancePolicy' },
      { id: 'managedDevices', path: '/deviceManagement/managedDevices', cmdlet: 'Get-MgDeviceManagementManagedDevice' },
      { id: 'detectedApps', path: '/deviceManagement/detectedApps', cmdlet: 'Get-MgDeviceManagementDetectedApp' },
    ];

    for (const ep of endpoints) {
      try {
        const result = await this.sessionManager.execute(
          'mgraph',
          `${ep.cmdlet} | ConvertTo-Json -Depth 5`
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
          `${ep.cmdlet} | ConvertTo-Json -Depth 5`
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
        'Get-MgInformationProtectionPolicyLabel | ConvertTo-Json -Depth 5'
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
        "Get-MgGroup -Filter \"displayName eq 'CUI-Authorized-Users'\" | ConvertTo-Json -Depth 5"
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
        'Get-MgPolicyAuthorizationPolicy | ConvertTo-Json -Depth 5'
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
        'Get-MgIdentityConditionalAccessNamedLocation | ConvertTo-Json -Depth 5'
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

  async fetchDeviceConfigurations(): Promise<SignalResult[]> {
    const now = new Date().toISOString();
    try {
      const result = await this.sessionManager.execute(
        'mgraph',
        'Get-MgDeviceManagementDeviceConfiguration | ConvertTo-Json -Depth 5'
      );
      const data = JSON.parse(result.stdout.replace(/EO_EXECUTION_SUCCESS\s*$/, '').trim());
      return [{
        signalId: 'deviceConfigurations',
        source: 'graph',
        endpoint: '/deviceManagement/deviceConfigurations',
        timestamp: now,
        rawData: data,
        status: 'success',
      }];
    } catch (err) {
      return [{
        signalId: 'deviceConfigurations',
        source: 'graph',
        endpoint: '/deviceManagement/deviceConfigurations',
        timestamp: now,
        rawData: null,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      }];
    }
  }

  async fetchManagedAppProtections(): Promise<SignalResult[]> {
    const now = new Date().toISOString();
    try {
      const result = await this.sessionManager.execute(
        'mgraph',
        'Get-MgDeviceAppManagementIosManagedAppProtection | ConvertTo-Json -Depth 5'
      );
      const data = JSON.parse(result.stdout.replace(/EO_EXECUTION_SUCCESS\s*$/, '').trim());
      return [{
        signalId: 'appProtections',
        source: 'graph',
        endpoint: '/deviceAppManagement/iosManagedAppProtectionPolicies',
        timestamp: now,
        rawData: data,
        status: 'success',
      }];
    } catch (err) {
      return [{
        signalId: 'appProtections',
        source: 'graph',
        endpoint: '/deviceAppManagement/iosManagedAppProtectionPolicies',
        timestamp: now,
        rawData: null,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      }];
    }
  }

  async fetchAuthStrengthPolicies(): Promise<SignalResult[]> {
    const now = new Date().toISOString();
    try {
      const result = await this.sessionManager.execute(
        'mgraph',
        'Get-MgPolicyAuthenticationStrengthPolicy | ConvertTo-Json -Depth 5'
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
        'Get-MgAgreement | ConvertTo-Json -Depth 5'
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
    const now = new Date().toISOString();
    try {
      const result = await this.sessionManager.execute(
        'mgraph',
        'Get-MgPolicyRoleManagementPolicy | ConvertTo-Json -Depth 5'
      );
      const data = JSON.parse(result.stdout.replace(/EO_EXECUTION_SUCCESS\s*$/, '').trim());
      return [{
        signalId: 'pimPolicies',
        source: 'graph',
        endpoint: '/policies/roleManagementPolicies',
        timestamp: now,
        rawData: data,
        status: 'success',
      }];
    } catch (err) {
      return [{
        signalId: 'pimPolicies',
        source: 'graph',
        endpoint: '/policies/roleManagementPolicies',
        timestamp: now,
        rawData: null,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      }];
    }
  }

  async fetchVulnerabilities(): Promise<SignalResult[]> {
    const now = new Date().toISOString();
    try {
      const result = await this.sessionManager.execute(
        'mgraph',
        'Get-MgSecurityThreatIntelligenceVulnerability | ConvertTo-Json -Depth 5'
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

  async fetchExpandedSignals(): Promise<SignalResult[]> {
    const signals: SignalResult[] = [];

    // Identity & Access (AC, IA families)
    signals.push(await this.fetchEndpoint('crossTenantPolicy', GRAPH_ENDPOINTS.CROSS_TENANT_ACCESS));
    signals.push(await this.fetchEndpoint('authStrengthPolicies', GRAPH_ENDPOINTS.AUTH_STRENGTH_POLICIES));
    signals.push(await this.fetchEndpoint('authMethodsUsers', GRAPH_ENDPOINTS.AUTH_METHODS_USERS));

    // Audit & Accountability (AU family)
    signals.push(await this.fetchEndpoint('directoryAudits', GRAPH_ENDPOINTS.DIRECTORY_AUDITS));
    signals.push(await this.fetchEndpoint('signInLogs', GRAPH_ENDPOINTS.SIGNIN_LOGS));

    // Configuration Management (CM family)
    signals.push(await this.fetchEndpoint('configurationPolicies', GRAPH_ENDPOINTS.DEVICE_CONFIGS));
    signals.push(await this.fetchEndpoint('deviceIntents', GRAPH_ENDPOINTS.DEVICE_INTENTS));

    // Data Protection (SC family)
    signals.push(await this.fetchEndpoint('sensitivityLabels', GRAPH_ENDPOINTS.SENSITIVITY_LABELS));
    signals.push(await this.fetchEndpoint('dlpPolicies', GRAPH_ENDPOINTS.DLP_POLICIES));
    signals.push(await this.fetchEndpoint('encryptionStates', GRAPH_ENDPOINTS.ENCRYPTION_STATES, true));

    // Security & Vulnerability (SI family)
    signals.push(await this.fetchEndpoint('vulnerabilitiesExpanded', GRAPH_ENDPOINTS.VULNERABILITIES));
    signals.push(await this.fetchEndpoint('attackSimulations', GRAPH_ENDPOINTS.ATTACK_SIMULATIONS));
    signals.push(await this.fetchEndpoint('riskDetections', GRAPH_ENDPOINTS.RISK_DETECTIONS));
    signals.push(await this.fetchEndpoint('secureScore', GRAPH_ENDPOINTS.SECURE_SCORE));

    return signals;
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
    return Promise.all([
      this.fetchGraphCollection('trainingUserCoverage', COVERAGE_ENDPOINTS.TRAINING_USER_COVERAGE,
        '/v1.0/reports/security/getAttackSimulationTrainingUserCoverage'),
      this.fetchGraphCollection('directoryUsers', COVERAGE_ENDPOINTS.USERS,
        '/v1.0/users?$select=id,userPrincipalName,accountEnabled,userType,assignedLicenses&$top=999'),
      this.fetchGraphCollection('securityIncidents', COVERAGE_ENDPOINTS.INCIDENTS,
        `/v1.0/security/incidents?$expand=alerts&$filter=createdDateTime%20ge%20${since}`),
      this.fetchGraphCollection('lifecycleWorkflows', COVERAGE_ENDPOINTS.LIFECYCLE_WORKFLOWS,
        '/v1.0/identityGovernance/lifecycleWorkflows/workflows?$expand=tasks'),
      this.fetchGraphCollection('roleAssignmentsAll', COVERAGE_ENDPOINTS.ROLE_ASSIGNMENTS,
        '/v1.0/roleManagement/directory/roleAssignments'),
      this.fetchGraphCollection('managedDevicesAll', COVERAGE_ENDPOINTS.MANAGED_DEVICES,
        '/v1.0/deviceManagement/managedDevices?$select=id,deviceName,operatingSystem'),
      this.fetchGraphCollection('tvmAssessmentRecency', COVERAGE_ENDPOINTS.HUNTING_QUERY,
        '/v1.0/security/runHuntingQuery', TVM_RECENCY_QUERY),
    ]);
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

  /** Fetch all signal categories in parallel — single source of truth for full signal fetch */
  async fetchAllSignals(): Promise<SignalResult[]> {
    const signalBatches = await Promise.all([
      this.fetchIdentitySignals(),
      this.fetchDeviceSignals(),
      this.fetchSecuritySignals(),
      this.fetchDlpSignals(),
      this.fetchGroupMembership(),
      this.fetchAuthorizationPolicy(),
      this.fetchNamedLocations(),
      this.fetchDeviceConfigurations(),
      this.fetchManagedAppProtections(),
      this.fetchAuthStrengthPolicies(),
      this.fetchAgreements(),
      this.fetchPimPolicies(),
      this.fetchVulnerabilities(),
      this.fetchExchangeConfig(),
      this.fetchPurviewConfig(),
      this.fetchCoverageSignals(),
    ]);
    return signalBatches.flat();
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
