// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * ScopeStatementDeriver.ts
 *
 * Auto-derives risk assessment scope statements from SI Baseline mission plan
 * and infrastructure manifest data.
 */

/**
 * Derives a prose scope statement from mission plan and infrastructure manifest.
 *
 * @param missionPlanData - Parsed SI Baseline JSON (inputs.si_baseline.si_baseline)
 * @param infraManifestData - Parsed infrastructure manifest JSON
 * @returns Prose scope statement, or empty string if minimum viable data is missing
 */
export function deriveScopeStatement(missionPlanData: any, infraManifestData: any, tenantSlug?: string): string {
  try {
    // Navigate to SI Baseline structure
    const siBaseline = missionPlanData?.inputs?.si_baseline?.si_baseline;
    if (!siBaseline) {
      console.warn('[ScopeStatementDeriver] Missing inputs.si_baseline.si_baseline in mission plan');
      return '';
    }

    // Extract required fields for minimum viable scope statement
    const cuiPresence = siBaseline.target?.cui_presence;
    const cuiTypes = siBaseline.target?.cui_types;
    const targetCmmcLevel = siBaseline.target?.target_cmmc_level;

    // Minimum viable check
    if (!cuiPresence || !cuiTypes || cuiTypes.length === 0 || !targetCmmcLevel) {
      console.warn('[ScopeStatementDeriver] Missing required fields: cui_presence, cui_types, or target_cmmc_level');
      return '';
    }

    // Extract optional fields
    const tenantModelPreference = siBaseline.dependencies?.tenant_model_preference;
    const boundaryStrategy = siBaseline.scope?.boundary_strategy;
    const deploymentPosture = siBaseline.scope?.deployment_posture;
    const cuiEndpointPosture = siBaseline.operations?.cui_endpoint_posture;
    const byodPosture = siBaseline.operations?.byod_posture;
    const collaborationMode = siBaseline.operations?.collaboration_mode;
    const externalServiceProviders = siBaseline.scope?.external_service_providers || [];
    const cesIntent = infraManifestData?.ces?.intent;

    // Use passed tenantSlug or try to extract from mission plan metadata
    const slug = tenantSlug || missionPlanData?.metadata?.tenant_slug || missionPlanData?.tenant_slug;

    // Build prose scope statement
    const parts: string[] = [];

    // Opening: CUI type and scope
    const cuiTypeLabels = cuiTypes.map((t: string) => {
      if (t === 'cui_basic') return 'CUI Basic';
      if (t === 'cui_specified') return 'CUI Specified';
      return t.toUpperCase();
    }).join(', ');

    let opening = `This risk assessment covers all information systems, personnel, and processes that store, process, or transmit Controlled Unclassified Information (${cuiTypeLabels})`;

    // Add tenant context if available
    if (slug && tenantModelPreference) {
      const tenantModelLabel = tenantModelPreference === 'gcc_high' ? 'GCC High' : tenantModelPreference;
      opening += ` within the ${slug} M365 ${tenantModelLabel} tenant`;
    } else if (slug) {
      opening += ` within the ${slug} tenant`;
    }
    opening += '.';
    parts.push(opening);

    // Boundary and deployment
    if (boundaryStrategy && deploymentPosture) {
      const boundaryLabel = boundaryStrategy.replace(/_/g, ' ');
      const deploymentLabel = deploymentPosture.replace(/_/g, '-');
      parts.push(`Boundary: ${boundaryLabel}, ${deploymentLabel} deployment.`);
    } else if (boundaryStrategy) {
      const boundaryLabel = boundaryStrategy.replace(/_/g, ' ');
      parts.push(`Boundary: ${boundaryLabel}.`);
    } else if (deploymentPosture) {
      const deploymentLabel = deploymentPosture.replace(/_/g, '-');
      parts.push(`Deployment: ${deploymentLabel}.`);
    }

    // Endpoint access model
    if (cuiEndpointPosture && byodPosture) {
      const endpointLabel = cuiEndpointPosture.replace(/_/g, '-');
      const byodLabel = byodPosture.replace(/_/g, ' ');
      parts.push(`Endpoint access model: ${endpointLabel} via ${byodLabel}.`);
    } else if (cuiEndpointPosture) {
      const endpointLabel = cuiEndpointPosture.replace(/_/g, '-');
      parts.push(`Endpoint access model: ${endpointLabel}.`);
    }

    // Collaboration
    if (collaborationMode) {
      const collabLabel = collaborationMode.replace(/_/g, '-');
      parts.push(`Collaboration: ${collabLabel}.`);
    }

    // External service providers
    if (externalServiceProviders.length > 0) {
      const espList = externalServiceProviders.join(', ');
      parts.push(`External service providers: ${espList}.`);
    } else {
      parts.push('No external service providers.');
    }

    // Infrastructure description from CES intent
    if (cesIntent) {
      parts.push(`Infrastructure: ${cesIntent}.`);
    }

    // Target compliance
    parts.push(`Target compliance: ${targetCmmcLevel}.`);

    return parts.join(' ');
  } catch (err) {
    console.warn('[ScopeStatementDeriver] Error during derivation:', err);
    return '';
  }
}
