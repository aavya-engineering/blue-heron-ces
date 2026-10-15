// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { SignalResult } from 'ces-shared/types/signal';

export interface SignalRegistryEntry {
  signalId: string;
  transform: (signal: SignalResult) => Record<string, unknown>;
}

/**
 * Registry of signal-to-context transform functions.
 * Each entry maps a signalId to a function that extracts template context
 * variables from the signal's rawData.
 *
 * Template authors extend this registry to add new signal types
 * without modifying SnippetTemplateEngine source code.
 */
export const SIGNAL_REGISTRY: SignalRegistryEntry[] = [
  // --- Existing 5 signals (from SnippetTemplateEngine.ts) ---
  {
    signalId: 'cuiGroup',
    transform: (s) => ({
      cuiGroupExists: Boolean(s.rawData),
      groupDisplayName: (s.rawData as Record<string, unknown>)?.displayName as string ?? 'CUI-Authorized-Users',
      memberCount: Array.isArray((s.rawData as Record<string, unknown>)?.members) ? ((s.rawData as Record<string, unknown>).members as unknown[]).length : 0,
    }),
  },
  {
    signalId: 'conditionalAccess',
    transform: (s) => {
      const data = s.rawData as Record<string, unknown>;
      const policies = Array.isArray(data?.value) ? (data.value as Array<Record<string, unknown>>) : [];
      return {
        conditionalAccessActive: true,
        caPoliciesTotalCount: policies.length,
        policyName: policies.length > 0
          ? (policies[0]).displayName ?? 'Unknown'
          : undefined,
        policies: policies.map(p => ({
          displayName: p.displayName,
          state: p.state,
          conditions: {
            users: (p.conditions as Record<string, unknown>)?.users
              ? Array.isArray(((p.conditions as Record<string, unknown>).users as Record<string, unknown>)?.includeUsers)
                ? (((p.conditions as Record<string, unknown>).users as Record<string, unknown>).includeUsers as unknown[]).length
                : 0
              : 0,
            applications: (p.conditions as Record<string, unknown>)?.applications
              ? Array.isArray(((p.conditions as Record<string, unknown>).applications as Record<string, unknown>)?.includeApplications)
                ? (((p.conditions as Record<string, unknown>).applications as Record<string, unknown>).includeApplications as unknown[]).length
                : 0
              : 0,
          },
          grantControls: {
            builtInControls: ((p.grantControls as Record<string, unknown>)?.builtInControls as string[]) ?? [],
            authenticationStrength: ((p.grantControls as Record<string, unknown>)?.authenticationStrength as Record<string, unknown>)?.displayName,
          },
          sessionControls: p.sessionControls ?? {},
        })),
      };
    },
  },
  {
    signalId: 'authMethods',
    transform: (s) => {
      const data = s.rawData as Record<string, unknown>;
      const methods = Array.isArray(data?.authenticationMethodConfigurations)
        ? (data.authenticationMethodConfigurations as Array<Record<string, unknown>>)
        : [];
      return {
        mfaEnabled: true,
        authMethodsCount: methods.length,
        authMethods: methods.map(m => ({
          id: m.id,
          state: m.state,
          displayName: (m.displayName as string) ?? (m.id as string),
        })),
      };
    },
  },
  {
    signalId: 'managedDevices',
    transform: (s) => {
      const data = s.rawData as Record<string, unknown>;
      const devices = Array.isArray(data?.value) ? (data.value as Array<Record<string, unknown>>) : [];
      return {
        bitLockerEnforced: true,
        deviceCount: devices.length,
        devices: devices.slice(0, 10).map(d => ({
          displayName: d.displayName,
          operatingSystem: d.operatingSystem,
          isCompliant: d.isCompliant,
        })),
      };
    },
  },
  {
    signalId: 'compliancePolicies',
    transform: (s) => {
      const data = s.rawData as Record<string, unknown>;
      const policies = Array.isArray(data?.value) ? (data.value as Array<Record<string, unknown>>) : [];
      return {
        compliancePolicyActive: true,
        compliancePercentage: 100,
        policyName: policies.length > 0
          ? (policies[0]).displayName ?? 'Unknown'
          : undefined,
        policies: policies.map(p => ({
          displayName: p.displayName,
          description: p.description,
          scheduledActionsPerRule: Array.isArray(p.scheduledActionsPerRule) ? (p.scheduledActionsPerRule as unknown[]).length : 0,
        })),
      };
    },
  },

  // --- 35 additional signal types from evaluator audit ---
  {
    signalId: 'directoryRoles',
    transform: (s) => {
      const data = s.rawData as Record<string, unknown>;
      const roles = Array.isArray(data?.value) ? data.value : [];
      return { directoryRolesCount: roles.length, directoryRolesConfigured: roles.length > 0 };
    },
  },
  {
    signalId: 'crossTenantPolicy',
    transform: (s) => {
      const data = s.rawData as Record<string, unknown>;
      return { crossTenantPolicyConfigured: Boolean(data) };
    },
  },
  {
    signalId: 'sharepointSettings',
    transform: (s) => {
      const data = s.rawData as Record<string, unknown>;
      return {
        sharepointConfigured: Boolean(data),
        sharingCapability: (data?.sharingCapability as string) ?? 'unknown',
        externalSharingEnabled: data?.sharingCapability !== 'Disabled' && data?.sharingCapability !== 'ExistingExternalUserSharingOnly',
        ippProtectionEnabled: Boolean(data?.isIppProtectionEnabled),
        defaultSharingLinkType: (data?.defaultSharingLinkType as string) ?? 'unknown',
      };
    },
  },
  {
    signalId: 'dlpLabels',
    transform: (s) => {
      const data = s.rawData as Record<string, unknown>;
      const labels = Array.isArray(data?.value) ? (data.value as Array<Record<string, unknown>>) : [];
      return {
        dlpLabelsCount: labels.length,
        dlpLabelsConfigured: labels.length > 0,
        labels: labels.map(l => ({
          name: l.displayName ?? l.name,
          isActive: l.isActive ?? (l.state === 'active'),
          priority: l.priority ?? 0,
          tooltip: l.tooltip ?? l.description ?? '',
        })),
      };
    },
  },
  {
    signalId: 'pimPolicies',
    transform: (s) => {
      const data = s.rawData as Record<string, unknown>;
      const policies = Array.isArray(data?.value) ? (data.value as Array<Record<string, unknown>>) : [];
      return {
        pimConfigured: Boolean(data) && policies.length > 0,
        policies: policies.map(p => ({
          roleDisplayName: (p.roleDefinition as Record<string, unknown>)?.displayName ?? p.displayName ?? 'Unknown Role',
          activationDuration: p.activationMaxDuration ?? p.maximumDuration ?? 'PT8H',
          approvalRequired: Boolean((p.activationRule as Record<string, unknown>)?.isApprovalRequired ?? p.isApprovalRequired),
          mfaRequired: Boolean((p.activationRule as Record<string, unknown>)?.isMfaRequired ?? p.isMfaRequired),
        })),
      };
    },
  },
  {
    signalId: 'roleAssignments',
    transform: (s) => {
      const data = s.rawData as Record<string, unknown>;
      const assignments = Array.isArray(data?.value) ? (data.value as Array<Record<string, unknown>>) : [];
      return {
        roleAssignmentsCount: assignments.length,
        roleAssignmentsConfigured: assignments.length > 0,
        assignments: assignments.slice(0, 10).map(a => ({
          principalDisplayName: (a.principal as Record<string, unknown>)?.displayName ?? a.principalDisplayName ?? 'Unknown',
          roleDefinitionName: (a.roleDefinition as Record<string, unknown>)?.displayName ?? a.roleDefinitionDisplayName ?? 'Unknown Role',
          scope: (a.directoryScopeId as string) ?? '/',
        })),
      };
    },
  },
  {
    signalId: 'users',
    transform: (s) => {
      const data = s.rawData as Record<string, unknown>;
      const users = Array.isArray(data?.value) ? (data.value as Array<Record<string, unknown>>) : [];
      const sorted = [...users].sort((a, b) => {
        const aDate = (a.signInActivity as Record<string, unknown>)?.lastSignInDateTime as string ?? '';
        const bDate = (b.signInActivity as Record<string, unknown>)?.lastSignInDateTime as string ?? '';
        return bDate.localeCompare(aDate);
      });
      return {
        userCount: users.length,
        users: sorted.slice(0, 10).map(u => ({
          displayName: u.displayName,
          userPrincipalName: u.userPrincipalName,
          accountEnabled: Boolean(u.accountEnabled),
          lastSignIn: (u.signInActivity as Record<string, unknown>)?.lastSignInDateTime ?? 'Never',
        })),
      };
    },
  },
  {
    signalId: 'roleEligibility',
    transform: (s) => {
      const data = s.rawData as Record<string, unknown>;
      const eligibilities = Array.isArray(data?.value) ? data.value : [];
      return { roleEligibilityCount: eligibilities.length, roleEligibilityConfigured: eligibilities.length > 0 };
    },
  },
  {
    signalId: 'agreements',
    transform: (s) => {
      const data = s.rawData as Record<string, unknown>;
      const items = Array.isArray(data?.value) ? (data.value as Array<Record<string, unknown>>) : [];
      return {
        agreementsCount: items.length,
        agreementsConfigured: items.length > 0,
        agreements: items.map(a => ({
          displayName: a.displayName,
          isPerDeviceAcceptanceRequired: Boolean(a.isPerDeviceAcceptanceRequired),
          userReacceptanceFrequencyInDays: a.userReacceptRequiredFrequency ?? a.userReacceptanceFrequencyInDays ?? null,
        })),
      };
    },
  },
  {
    signalId: 'namedLocations',
    transform: (s) => {
      const data = s.rawData as Record<string, unknown>;
      const locations = Array.isArray(data?.value) ? (data.value as Array<Record<string, unknown>>) : [];
      return {
        namedLocationsCount: locations.length,
        namedLocationsConfigured: locations.length > 0,
        locations: locations.map(l => ({
          displayName: l.displayName,
          isTrusted: Boolean(l.isTrusted),
          ipRanges: Array.isArray(l.ipRanges) ? (l.ipRanges as Array<Record<string, unknown>>).map(r => r.cidrAddress ?? r.value) : [],
        })),
      };
    },
  },
  {
    signalId: 'transportConfig',
    transform: (s) => {
      const data = s.rawData as Record<string, unknown>;
      return {
        transportConfigured: Boolean(data),
        tlsVersion: (data?.tlsVersion as string) ?? 'TLS 1.2',
        enforceEncryption: Boolean(data?.requireEncryption ?? data?.enforceEncryption),
        requireTLS: Boolean(data?.requireTLS ?? data?.requireTls),
      };
    },
  },
  {
    signalId: 'deviceConfigurations',
    transform: (s) => {
      const data = s.rawData as Record<string, unknown>;
      const configs = Array.isArray(data?.value) ? (data.value as Array<Record<string, unknown>>) : [];
      return {
        deviceConfigurationsCount: configs.length,
        deviceConfigurationsActive: configs.length > 0,
        configurations: configs.slice(0, 10).map(c => ({
          displayName: c.displayName,
          description: c.description ?? '',
          platformType: (c['@odata.type'] as string)?.replace('#microsoft.graph.', '') ?? c.platformType ?? 'unknown',
          assignmentCount: Array.isArray(c.assignments) ? (c.assignments as unknown[]).length : 0,
        })),
      };
    },
  },
  {
    signalId: 'appProtections',
    transform: (s) => {
      const data = s.rawData as Record<string, unknown>;
      const policies = Array.isArray(data?.value) ? (data.value as Array<Record<string, unknown>>) : [];
      return {
        appProtectionsCount: policies.length,
        appProtectionsActive: policies.length > 0,
        policies: policies.map(p => ({
          displayName: p.displayName,
          platformType: (p['@odata.type'] as string)?.includes('android') ? 'Android' :
                        (p['@odata.type'] as string)?.includes('ios') ? 'iOS' :
                        (p['@odata.type'] as string)?.includes('windows') ? 'Windows' :
                        p.platformType ?? 'unknown',
          isAssigned: Boolean(p.isAssigned),
          protectionLevel: (p.appDataEncryptionType as string) ?? (p.encryptAppData ? 'Encrypted' : 'Standard'),
        })),
      };
    },
  },
  {
    signalId: 'auditQueries',
    transform: (s) => {
      const data = s.rawData as Record<string, unknown>;
      const queries = Array.isArray(data?.value) ? (data.value as Array<Record<string, unknown>>) : [];
      if (!s.rawData || queries.length === 0) {
        return { auditQueriesConfigured: false, sentinelNotAvailable: true };
      }
      return {
        auditQueriesConfigured: true,
        sentinelNotAvailable: false,
        queries: queries.map(q => ({
          name: q.displayName ?? q.name,
          description: q.description ?? '',
          dataSource: q.dataSource ?? q.source ?? 'unknown',
        })),
      };
    },
  },
  {
    signalId: 'mailboxAudit',
    transform: (s) => {
      const data = s.rawData as Record<string, unknown>;
      return {
        mailboxAuditEnabled: Boolean(data),
        auditBypassEnabled: Boolean(data?.auditBypassEnabled),
        defaultAuditSet: Array.isArray(data?.defaultAuditSet) ? data.defaultAuditSet : ['Admin', 'Delegate', 'Owner'],
      };
    },
  },
  {
    signalId: 'signInLogs',
    transform: (s) => {
      const data = s.rawData as Record<string, unknown>;
      const logs = Array.isArray(data?.value) ? (data.value as Array<Record<string, unknown>>) : [];
      return {
        signInLogsCount: logs.length,
        signInLogsAvailable: logs.length > 0,
        retentionDays: 90,
        logs: logs.slice(0, 10).map(l => ({
          userPrincipalName: l.userPrincipalName,
          appDisplayName: l.appDisplayName,
          status: (l.status as Record<string, unknown>)?.errorCode === 0 ? 'Success' : 'Failure',
          createdDateTime: l.createdDateTime,
        })),
      };
    },
  },
  {
    signalId: 'securityAlerts',
    transform: (s) => {
      const data = s.rawData as Record<string, unknown>;
      const alerts = Array.isArray(data?.value) ? (data.value as Array<Record<string, unknown>>) : [];
      return {
        securityAlertsCount: alerts.length,
        securityAlertsActive: alerts.length > 0,
        alerts: alerts.slice(0, 10).map(a => ({
          title: a.title,
          severity: a.severity,
          status: a.status,
          createdDateTime: a.createdDateTime,
          vendor: (a.vendorInformation as Record<string, unknown>)?.vendor ?? 'Microsoft',
        })),
      };
    },
  },
  {
    signalId: 'organization',
    transform: (s) => {
      const data = s.rawData as Record<string, unknown>;
      const org = Array.isArray(data?.value) ? (data.value as Array<Record<string, unknown>>)[0] : data;
      return {
        organizationConfigured: Boolean(data),
        organizationName: (org as Record<string, unknown>)?.displayName ?? 'Unknown',
        verifiedDomains: Array.isArray((org as Record<string, unknown>)?.verifiedDomains)
          ? ((org as Record<string, unknown>).verifiedDomains as Array<Record<string, unknown>>).map(d => d.name)
          : [],
        securityComplianceNotificationMails: Array.isArray((org as Record<string, unknown>)?.securityComplianceNotificationMails)
          ? (org as Record<string, unknown>).securityComplianceNotificationMails as string[]
          : [],
      };
    },
  },
  {
    signalId: 'secureScores',
    transform: (s) => {
      const data = s.rawData as Record<string, unknown>;
      const scores = Array.isArray(data?.value) ? (data.value as Array<Record<string, unknown>>) : [];
      const latest = scores.length > 0 ? scores[0] : null;
      return {
        secureScoresAvailable: scores.length > 0,
        currentScore: latest?.currentScore,
        maxScore: latest?.maxScore,
        percentage: latest && latest.maxScore ? Math.round((latest.currentScore as number) / (latest.maxScore as number) * 100) : undefined,
        controlScores: Array.isArray(latest?.controlScores) ? (latest.controlScores as Array<Record<string, unknown>>).slice(0, 10).map(c => ({
          controlName: c.controlName,
          score: c.score,
          maxScore: c.maxScore ?? c.scoreInPercentage,
        })) : [],
      };
    },
  },
  {
    signalId: 'presences',
    transform: (s) => {
      const data = s.rawData as Record<string, unknown>;
      return { presencesConfigured: Boolean(data) };
    },
  },
  {
    signalId: 'attackSimulations',
    transform: (s) => {
      const data = s.rawData as Record<string, unknown>;
      const sims = Array.isArray(data?.value) ? (data.value as Array<Record<string, unknown>>) : [];
      return {
        attackSimulationsCount: sims.length,
        attackSimulationsActive: sims.length > 0,
        simulations: sims.map(sim => ({
          displayName: sim.displayName,
          status: sim.status,
          lastModifiedDateTime: sim.lastModifiedDateTime,
          attackTechnique: sim.attackTechnique,
        })),
      };
    },
  },
  {
    signalId: 'directoryAudits',
    transform: (s) => {
      const data = s.rawData as Record<string, unknown>;
      const audits = Array.isArray(data?.value) ? (data.value as Array<Record<string, unknown>>) : [];
      return {
        directoryAuditsCount: audits.length,
        directoryAuditsAvailable: audits.length > 0,
        audits: audits.slice(0, 10).map(a => ({
          activityDisplayName: a.activityDisplayName,
          actorUserPrincipalName: (a.initiatedBy as Record<string, unknown>)?.user
            ? ((a.initiatedBy as Record<string, unknown>).user as Record<string, unknown>)?.userPrincipalName
            : 'System',
          result: a.result,
          activityDateTime: a.activityDateTime,
        })),
      };
    },
  },
  {
    signalId: 'detectedApps',
    transform: (s) => {
      const data = s.rawData as Record<string, unknown>;
      const apps = Array.isArray(data?.value) ? (data.value as Array<Record<string, unknown>>) : [];
      return {
        detectedAppsCount: apps.length,
        detectedAppsMonitored: apps.length > 0,
        apps: apps.slice(0, 10).map(a => ({
          displayName: a.displayName,
          version: a.version ?? 'unknown',
          deviceCount: a.deviceCount ?? 0,
          publisher: a.publisher ?? 'unknown',
        })),
      };
    },
  },
  {
    signalId: 'updateRings',
    transform: (s) => {
      const data = s.rawData as Record<string, unknown>;
      const rings = Array.isArray(data?.value) ? (data.value as Array<Record<string, unknown>>) : [];
      return {
        updateRingsCount: rings.length,
        updateRingsConfigured: rings.length > 0,
        rings: rings.map(r => ({
          displayName: r.displayName,
          deploymentDeferralInDays: r.featureUpdatesDeferralPeriodInDays ?? r.qualityUpdatesDeferralPeriodInDays ?? 0,
          automaticUpdateMode: r.automaticUpdateMode ?? r.installMode ?? 'autoInstallAtMaintenanceTime',
        })),
      };
    },
  },

  // --- G3 #3: NEW SI-family transforms for already-fetched-but-untransformed endpoints ---
  // riskDetections (Identity Protection) — endpoint /identityProtection/riskDetections.
  // Surfaces riskType / riskLevel / detectedDateTime for SI flaw-identification & monitoring.
  {
    signalId: 'riskDetections',
    transform: (s) => {
      const data = s.rawData as Record<string, unknown>;
      const detections = Array.isArray(data?.value)
        ? (data.value as Array<Record<string, unknown>>)
        : Array.isArray(s.rawData)
          ? (s.rawData as Array<Record<string, unknown>>)
          : [];
      const highOrCritical = detections.filter(
        d => d.riskLevel === 'high' || d.riskLevel === 'critical'
      );
      return {
        riskDetectionsCount: detections.length,
        riskDetectionsAvailable: detections.length > 0,
        highRiskDetectionsCount: highOrCritical.length,
        detections: detections.slice(0, 10).map(d => ({
          riskType: (d.riskType as string) ?? (d.riskEventType as string) ?? 'unknown',
          riskLevel: (d.riskLevel as string) ?? 'none',
          riskState: (d.riskState as string) ?? 'unknown',
          detectedDateTime: (d.detectedDateTime as string) ?? (d.activityDateTime as string) ?? null,
          userPrincipalName: (d.userPrincipalName as string) ?? null,
        })),
      };
    },
  },
  // vulnerabilities (Defender Threat Intelligence) — endpoint /security/microsoft/vulnerabilities.
  // Surfaces id / severity / cvss / remediation for SI flaw-remediation posture.
  {
    signalId: 'vulnerabilities',
    transform: (s) => {
      const data = s.rawData as Record<string, unknown>;
      const vulns = Array.isArray(data?.value)
        ? (data.value as Array<Record<string, unknown>>)
        : Array.isArray(s.rawData)
          ? (s.rawData as Array<Record<string, unknown>>)
          : [];
      const criticalOrHigh = vulns.filter(
        v => v.severity === 'critical' || v.severity === 'high'
      );
      return {
        vulnerabilitiesCount: vulns.length,
        vulnerabilitiesAvailable: vulns.length > 0,
        criticalOrHighCount: criticalOrHigh.length,
        vulnerabilities: vulns.slice(0, 10).map(v => ({
          id: (v.id as string) ?? 'unknown',
          severity: (v.severity as string) ?? 'unknown',
          cvss: (v.cvssV3 as number) ?? (v.cvssV2 as number) ?? (v.cvss as number) ?? null,
          remediation: (v.remediation as string) ?? (v.description as string) ?? null,
        })),
      };
    },
  },
];
