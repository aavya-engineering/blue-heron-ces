// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import type { StoreObject } from '../../store/StoreTypes.js';

/**
 * G-STACKSIM-2 iteration 3: seed generators for the collections backing
 * EO's ComplianceSignalFetcher.ts named-cmdlet calls (see
 * src/resolvers/graphResolvers.ts's iteration-3 manual entries). Every
 * cmdlet piping its result through `| ConvertTo-Json` needs at least one
 * seeded object - a genuinely empty PowerShell array produces NO stdout at
 * all when piped through ConvertTo-Json (verified directly against
 * powershell.exe), which upstream surfaces as EO's
 * `JSON.parse('')` -> "Unexpected end of JSON input" - so every generator
 * here returns exactly one (or `count`) realistic object, never zero.
 */

function range(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i);
}

/** Real Graph resource: singleton `/policies/authenticationMethodsPolicy`. */
export function generateAuthenticationMethodsPolicy(count: number): StoreObject[] {
  return range(count).map((i) => ({
    id: i === 0 ? 'authenticationMethodsPolicy' : `authenticationMethodsPolicy-${i + 1}`,
    displayName: 'Authentication Methods Policy',
    policyVersion: '1',
  }));
}

export function generateSecureScores(count: number): StoreObject[] {
  return range(count).map((i) => ({
    id: `secureScore-${i + 1}`,
    activeUserCount: 5,
    currentScore: 62,
    maxScore: 100,
    createdDateTime: new Date().toISOString(),
  }));
}

export function generateAlerts(count: number): StoreObject[] {
  return range(count).map((i) => ({
    id: `alert-${i + 1}`,
    title: `Sim Security Alert ${i + 1}`,
    severity: 'medium',
    status: 'newAlert',
  }));
}

/** Real Graph resource: `/informationProtection/policy/labels` (distinct from `sensitivityLabels`). */
export function generatePolicyLabels(count: number): StoreObject[] {
  return range(count).map((i) => ({
    id: `policyLabel-${i + 1}`,
    name: `Sim Policy Label ${i + 1}`,
    isActive: true,
  }));
}

export function generateAuthenticationStrengthPolicies(count: number): StoreObject[] {
  return range(count).map((i) => ({
    id: i === 0 ? 'authenticationStrengthPolicy' : `authenticationStrengthPolicy-${i + 1}`,
    displayName: 'Sim Phishing-Resistant MFA Strength',
    policyType: 'custom',
  }));
}

/** Terms-of-use agreements (`/agreements`). */
export function generateTouAgreements(count: number): StoreObject[] {
  return range(count).map((i) => ({
    id: `touAgreement-${i + 1}`,
    displayName: 'CUI System Access Notice',
    isViewingBeforeAcceptanceRequired: true,
  }));
}

export function generateRoleManagementPolicies(count: number): StoreObject[] {
  return range(count).map((i) => ({
    id: `roleManagementPolicy-${i + 1}`,
    displayName: `Sim Role Management Policy ${i + 1}`,
    scopeId: '/',
  }));
}

export function generateVulnerabilities(count: number): StoreObject[] {
  return range(count).map((i) => ({
    id: `vulnerability-${i + 1}`,
    cveId: `CVE-2026-${1000 + i}`,
    severity: 'medium',
  }));
}

/** Real Graph resource: singleton `/policies/crossTenantAccessPolicy/default`. */
export function generateCrossTenantAccessPolicy(count: number): StoreObject[] {
  return range(count).map((i) => ({
    id: i === 0 ? 'crossTenantAccessPolicy' : `crossTenantAccessPolicy-${i + 1}`,
    displayName: 'Default Cross-Tenant Access Policy',
  }));
}

export function generateAuthenticationMethodUserRegistrationDetails(count: number): StoreObject[] {
  return range(count).map((i) => ({
    id: `authMethodUserRegistrationDetail-${i + 1}`,
    userPrincipalName: `sim.user${i + 1}@simtenant.onmicrosoft.us`,
    isMfaRegistered: true,
  }));
}

export function generateSignInLogs(count: number): StoreObject[] {
  return range(count).map((i) => ({
    id: `signIn-${i + 1}`,
    userPrincipalName: `sim.user${i + 1}@simtenant.onmicrosoft.us`,
    createdDateTime: new Date().toISOString(),
    status: { errorCode: 0 },
  }));
}

/** Real Graph resource: `/deviceManagement/configurationPolicies` (Settings Catalog, distinct from `deviceConfigurations`). */
export function generateDeviceManagementConfigurationPolicies(count: number): StoreObject[] {
  return range(count).map((i) => ({
    id: `deviceManagementConfigurationPolicy-${i + 1}`,
    name: `Sim Configuration Policy ${i + 1}`,
    platforms: 'windows10',
  }));
}

export function generateDeviceManagementIntents(count: number): StoreObject[] {
  return range(count).map((i) => ({
    id: `deviceManagementIntent-${i + 1}`,
    displayName: `Sim Device Management Intent ${i + 1}`,
  }));
}

export function generateSensitivityLabels(count: number): StoreObject[] {
  return range(count).map((i) => ({
    id: `sensitivityLabel-${i + 1}`,
    name: 'CUI',
    displayName: 'CUI//SP-CTI',
    isActive: true,
  }));
}

export function generateDlpPolicies(count: number): StoreObject[] {
  return range(count).map((i) => ({
    id: `dlpPolicy-${i + 1}`,
    name: `Sim DLP Policy ${i + 1}`,
    isEnabled: true,
  }));
}

/**
 * GP-STACKSIM-1 fidelity tail (a) (2026-07-27): Purview / Security & Compliance
 * DLP policies as returned by IPPS PowerShell's `Get-DlpCompliancePolicy`
 * (Connect-IPPSSession) — a DIFFERENT resource from the Graph
 * `informationProtection dlpPolicies` collection (generateDlpPolicies above),
 * with the IPPS object model's native PascalCase shape.
 *
 * The reported gap: `DistributionStatus` is a SERVER-COMPUTED field. A real
 * tenant reports 'Success' once a saved policy has finished distributing to
 * every workload; the sim seeded no such collection at all, so Stamper's
 * `$.DistributionStatus -eq 'Success'` (and the `$_.Enabled -eq $true`
 * Where-Object) read undefined/empty against a policy a real tenant would have
 * returned. Seeding the collection WITH the computed field closes that — the
 * sim's job is to return what the real API computes and returns, not to
 * recompute it. One policy is named 'CMMC-CUI-Block' so the registries'
 * `-Identity 'CMMC-CUI-Block'` / `-like '*CUI*'` reads have a real match.
 */
export function generateDlpCompliancePolicies(count: number): StoreObject[] {
  const names = ['CMMC-CUI-Block', 'CUI-SharePoint-Protection'];
  return range(count).map((i) => {
    const name = names[i] ?? `Sim DLP Compliance Policy ${i + 1}`;
    return {
      id: name,
      Name: name,
      Mode: 'Enable',
      Enabled: true,
      Workload: 'Exchange, SharePoint, OneDriveForBusiness, Teams',
      Priority: i,
      // Fixed (not `new Date()`): seed state must be deterministic across a
      // demo reset, and this real EXO field name (`WhenCreated`) is not one the
      // demo determinism mask strips (it masks only *DateTime/*timestamp keys).
      WhenCreated: '2026-01-15T00:00:00.000Z',
      // Server-computed on a real tenant — the field the fidelity item flagged.
      DistributionStatus: 'Success',
    };
  });
}

export function generateAttackSimulations(count: number): StoreObject[] {
  return range(count).map((i) => ({
    id: `attackSimulation-${i + 1}`,
    displayName: `Sim Phishing Simulation ${i + 1}`,
    status: 'completed',
  }));
}

export function generateRiskDetections(count: number): StoreObject[] {
  return range(count).map((i) => ({
    id: `riskDetection-${i + 1}`,
    riskLevel: 'medium',
    riskState: 'atRisk',
  }));
}

/**
 * GP-STACKSIM-1 M3 (2026-07-25): the four authenticationMethodConfigurations
 * every real Entra tenant carries as fixed, well-known singletons (Fido2,
 * MicrosoftAuthenticator, TemporaryAccessPass, x509Certificate - Stamper's
 * IA.L2-3.5.3/3.5.9/3.5.10 GET them by literal id). STAB-1 M1b's honest
 * item-level 404 made those GETs fail against an unseeded collection (the
 * four stamper:IA.* GET FAILs in the 2026-07-25 coverage re-run); a real GCC
 * High tenant can never 404 on them. Seeded 'disabled' - the sim's
 * deliberately pre-Stamper posture; Stamper's stamp is what enables them.
 * The `count` contract: these are fixed singletons, so the profile count
 * must be exactly 4 (the generator caps there regardless).
 */
export function generateAuthenticationMethodsPolicyConfigurations(count: number): StoreObject[] {
  const wellKnown = ['Fido2', 'MicrosoftAuthenticator', 'TemporaryAccessPass', 'x509Certificate'];
  return wellKnown.slice(0, count).map((id) => ({
    id,
    state: 'disabled',
  }));
}
