// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Deterministic in-memory fixtures for the SSP golden / structural tests.
 *
 * These build a representative AssessmentSnapshot covering a spread of control
 * statuses + classifications across all 110 CMMC L2 controls, plus minimal
 * tenant / infra / mission-plan manifests and the diagram-source structures
 * (AuthorizationBoundary / CuiDataFlows) needed to exercise diagram embedding.
 *
 * Used by:
 *   - ssp-golden-reference.test.ts (Step 1: no-drop structural guard)
 *   - ssp-diagram-embed.test.ts    (Step 2: diagramPath population)
 *   - mermaid-syntax-validator.test.ts (Step 3: generated Mermaid validity)
 *   - ssp-assessor-additions.test.ts   (Step 4: assessor-grade additions)
 *
 * No network / blob / storage access — fully deterministic.
 */
import * as fs from 'node:fs';
import type { AssessmentSnapshot, ControlStatus, ControlClassification } from 'ces-shared/types/controls';
import type { AllManifests } from 'ces-shared/types/ssp';
import type { AuthorizationBoundary, CuiDataFlows } from '../../src/shared/types/ssp.types.js';

const STATUSES: ControlStatus[] = ['met', 'not_met', 'partial', 'not_assessed'];
const CLASSIFICATIONS: ControlClassification[] = ['automated', 'manual', 'nonstack'];

const FIXED_NOW = '2026-01-15T00:00:00.000Z';

interface ControlsReference {
  total_controls: number;
  controls: Array<{ control_id: string; family: string; nist_ref: string; practice: string }>;
}

/**
 * Build a deterministic AssessmentSnapshot spanning all 110 controls with a
 * rotating spread of statuses + classifications. Deterministic by control index.
 */
export function buildGoldenAssessment(controlsRefPath: string): AssessmentSnapshot {
  const ref: ControlsReference = JSON.parse(fs.readFileSync(controlsRefPath, 'utf-8'));

  let met = 0;
  let notMet = 0;
  let partial = 0;
  let notAssessed = 0;

  const controls = ref.controls.map((c, i) => {
    const status = STATUSES[i % STATUSES.length];
    if (status === 'met') met++;
    else if (status === 'not_met') notMet++;
    else if (status === 'partial') partial++;
    else notAssessed++;

    return {
      control_id: c.control_id,
      nist_ref: c.nist_ref,
      status,
      classification: CLASSIFICATIONS[i % CLASSIFICATIONS.length],
      sources: [],
      // Two controls get evidence references so the assessor-traceability
      // appendix and evidence rendering have non-empty data to surface.
      implementation_narrative: undefined,
      last_assessed: FIXED_NOW,
      signals: [],
      evidenceArtifactIds: i % 5 === 0 ? [`EV-${c.control_id}-001`] : [],
      automationSource: 'manual' as const,
      lastFetchedAt: FIXED_NOW,
    };
  });

  return {
    snapshotId: 'snap-golden-fixture',
    tenantId: 'tenant-golden',
    generatedAt: FIXED_NOW,
    controls,
    sources_merged: ['manual'],
    sprs_score: 0,
    controls_met: met,
    controls_not_met: notMet,
    controls_partial: partial,
    controls_not_assessed: notAssessed,
  };
}

/** Minimal but type-shaped manifests (tenant / infra / mission plan). */
export function buildGoldenManifests(): AllManifests {
  return {
    tenantManifest: {
      tenant_identity: {
        display_name: 'Golden Reference Defense Co.',
        description: 'M365 GCC High environment for CUI processing (golden fixture).',
      },
      boundary_zones: ['M365 GCC High', 'Azure Government'],
    },
    infraManifest: {
      cloudEnvironment: 'AzureUSGovernment',
      network: [
        {
          resource_type: 'Microsoft.Network/virtualNetworks',
          name: 'vnet-cui-prod',
          depends_on: [],
          properties: {
            subnets: [
              { name: 'snet-app', addressPrefix: '10.0.1.0/24' },
              { name: 'snet-data', addressPrefix: '10.0.2.0/24' },
            ],
          },
        },
        {
          resource_type: 'Microsoft.Network/networkSecurityGroups',
          name: 'nsg-app',
          depends_on: ['snet-app'],
          properties: {},
        },
      ],
      logging: [
        {
          resource_type: 'log_analytics_workspace',
          name: 'law-cui',
          properties: { retention_days: 365 },
        },
        {
          resource_type: 'sentinel_onboarding',
          name: 'sentinel-cui',
          properties: {},
        },
      ],
    } as unknown as AllManifests['infraManifest'],
    missionPlan: {
      steps: [
        {
          what_to_do: 'Enforce MFA for all privileged accounts via Conditional Access.',
          owner_role: 'System Administrator',
          control_coverage: [{ control_id: 'AC.L1-3.1.1' }],
        },
      ],
    } as unknown as AllManifests['missionPlan'],
  } as AllManifests;
}

/** Mission plan as a plain Record for the generate() missionPlan param. */
export function buildGoldenMissionPlan(): Record<string, unknown> {
  return {
    steps: [
      {
        what_to_do: 'Enforce MFA for all privileged accounts via Conditional Access.',
        owner_role: 'System Administrator',
        control_coverage: [{ control_id: 'AC.L1-3.1.1' }],
      },
      {
        what_to_do: 'Apply sensitivity labels to CUI documents in SharePoint Online.',
        owner_role: 'CUI Program Manager',
        control_coverage: [{ control_id: 'MP.L2-3.8.3' }],
      },
    ],
  };
}

export function buildGoldenTenantManifest(): Record<string, unknown> {
  return {
    tenant_identity: {
      display_name: 'Golden Reference Defense Co.',
      description: 'M365 GCC High environment for CUI processing (golden fixture).',
    },
    boundary_zones: ['M365 GCC High', 'Azure Government'],
  };
}

export function buildGoldenInfraManifest(): Record<string, unknown> {
  return (buildGoldenManifests().infraManifest as unknown) as Record<string, unknown>;
}

/** Authorization boundary structure (drives the boundary Mermaid graph). */
export function buildGoldenAuthorizationBoundary(): AuthorizationBoundary {
  return {
    zones: [
      {
        name: 'M365 GCC High',
        description: 'CUI collaboration and storage zone.',
        components: ['Exchange Online', 'SharePoint Online', 'Teams'],
      },
      {
        name: 'Azure Government',
        description: 'Hosting and logging zone.',
        components: ['Log Analytics', 'Microsoft Sentinel'],
      },
    ],
    externalConnections: ['DoD Reporting Authority', 'External CSP'],
  };
}

/** CUI data flow structure (drives the data-flow Mermaid sequenceDiagram). */
export function buildGoldenCuiDataFlows(): CuiDataFlows {
  return {
    ingress: [
      { source: 'External Partner', destination: 'Exchange Online', cuiType: 'CTI', protocol: 'TLS 1.2' },
    ],
    internal: [
      { source: 'Exchange Online', destination: 'SharePoint Online', cuiType: 'CTI' },
    ],
    egress: [
      { source: 'SharePoint Online', destination: 'Authorized Recipient', cuiType: 'CTI', protocol: 'TLS 1.2' },
    ],
  };
}
