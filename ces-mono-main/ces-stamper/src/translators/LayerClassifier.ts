// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { CESManualStep } from '../types/ces-artifacts.types.js';

/**
 * Execution layers for tenant stamping. Tasks must execute in layer order —
 * a Conditional Access policy (L3) can't target a security group that hasn't
 * been created yet (L1).
 *
 * Tasks within the same layer CAN run in parallel.
 * Cross-layer dependencies are injected by PlanTranslator.
 */
export enum ExecutionLayer {
  L0_FOUNDATION = 0,       // Tenant settings, org-wide policies, compliance docs
  L1_IDENTITY_OBJECTS = 1, // Users, security groups, admin accounts, service principals
  L2_ROLE_ASSIGNMENTS = 2, // PIM roles, RBAC, directory roles, admin unit scoping
  L3_IDENTITY_POLICIES = 3,// Conditional Access, MFA, auth methods, password policies
  L4_DEVICE_POLICIES = 4,  // Intune enrollment, compliance, config profiles, app protection
  L5_DATA_PROTECTION = 5,  // Sensitivity labels, DLP, Information Barriers, retention
  L6_INFRASTRUCTURE = 6,   // Azure Firewall, NSGs, VPN Gateway, VNets, Key Vault
  L7_MONITORING = 7,       // Sentinel, analytics rules, audit logging, alert rules
  L8_EVIDENCE = 8          // Evidence collection, postcheck validation
}

export const LAYER_NAMES: Record<ExecutionLayer, string> = {
  [ExecutionLayer.L0_FOUNDATION]: 'Foundation',
  [ExecutionLayer.L1_IDENTITY_OBJECTS]: 'Identity Objects',
  [ExecutionLayer.L2_ROLE_ASSIGNMENTS]: 'Role Assignments',
  [ExecutionLayer.L3_IDENTITY_POLICIES]: 'Identity Policies',
  [ExecutionLayer.L4_DEVICE_POLICIES]: 'Device Policies',
  [ExecutionLayer.L5_DATA_PROTECTION]: 'Data Protection',
  [ExecutionLayer.L6_INFRASTRUCTURE]: 'Infrastructure',
  [ExecutionLayer.L7_MONITORING]: 'Monitoring',
  [ExecutionLayer.L8_EVIDENCE]: 'Evidence & Verification'
};

/**
 * Maps M365 service names (from vendor blocks) to execution layers.
 * Service names are matched case-insensitively with substring matching.
 */
const SERVICE_LAYER_MAP: { pattern: RegExp; layer: ExecutionLayer }[] = [
  // L1 — Identity Objects
  { pattern: /entra.*(?:user|group|account|identity|registration)/i, layer: ExecutionLayer.L1_IDENTITY_OBJECTS },
  { pattern: /^entra id$/i, layer: ExecutionLayer.L1_IDENTITY_OBJECTS },
  { pattern: /active directory/i, layer: ExecutionLayer.L1_IDENTITY_OBJECTS },

  // L2 — Role Assignments
  { pattern: /pim/i, layer: ExecutionLayer.L2_ROLE_ASSIGNMENTS },
  { pattern: /privileged identity/i, layer: ExecutionLayer.L2_ROLE_ASSIGNMENTS },
  { pattern: /rbac/i, layer: ExecutionLayer.L2_ROLE_ASSIGNMENTS },
  { pattern: /role.*assignment/i, layer: ExecutionLayer.L2_ROLE_ASSIGNMENTS },
  { pattern: /role.*management/i, layer: ExecutionLayer.L2_ROLE_ASSIGNMENTS },

  // L3 — Identity Policies
  { pattern: /conditional access/i, layer: ExecutionLayer.L3_IDENTITY_POLICIES },
  { pattern: /mfa|multi.?factor/i, layer: ExecutionLayer.L3_IDENTITY_POLICIES },
  { pattern: /authentication method/i, layer: ExecutionLayer.L3_IDENTITY_POLICIES },
  { pattern: /password.*protect/i, layer: ExecutionLayer.L3_IDENTITY_POLICIES },
  { pattern: /smart lockout/i, layer: ExecutionLayer.L3_IDENTITY_POLICIES },
  { pattern: /temporary access pass/i, layer: ExecutionLayer.L3_IDENTITY_POLICIES },
  { pattern: /sign-?in/i, layer: ExecutionLayer.L3_IDENTITY_POLICIES },
  { pattern: /lifecycle workflow/i, layer: ExecutionLayer.L3_IDENTITY_POLICIES },
  { pattern: /external identities/i, layer: ExecutionLayer.L3_IDENTITY_POLICIES },
  { pattern: /cross-tenant/i, layer: ExecutionLayer.L3_IDENTITY_POLICIES },

  // L4 — Device Policies
  { pattern: /intune/i, layer: ExecutionLayer.L4_DEVICE_POLICIES },
  { pattern: /device.*config/i, layer: ExecutionLayer.L4_DEVICE_POLICIES },
  { pattern: /compliance.*polic/i, layer: ExecutionLayer.L4_DEVICE_POLICIES },
  { pattern: /mdm|mobile device management/i, layer: ExecutionLayer.L4_DEVICE_POLICIES },
  { pattern: /bitlocker/i, layer: ExecutionLayer.L4_DEVICE_POLICIES },
  { pattern: /windows update/i, layer: ExecutionLayer.L4_DEVICE_POLICIES },
  { pattern: /defender.*endpoint/i, layer: ExecutionLayer.L4_DEVICE_POLICIES },
  { pattern: /endpoint.*protection/i, layer: ExecutionLayer.L4_DEVICE_POLICIES },

  // L5 — Data Protection
  { pattern: /purview/i, layer: ExecutionLayer.L5_DATA_PROTECTION },
  { pattern: /sensitivity.*label/i, layer: ExecutionLayer.L5_DATA_PROTECTION },
  { pattern: /dlp|data loss/i, layer: ExecutionLayer.L5_DATA_PROTECTION },
  { pattern: /information.*barrier/i, layer: ExecutionLayer.L5_DATA_PROTECTION },
  { pattern: /retention/i, layer: ExecutionLayer.L5_DATA_PROTECTION },
  { pattern: /sharepoint.*(?:shar|external)/i, layer: ExecutionLayer.L5_DATA_PROTECTION },

  // L6 — Infrastructure
  { pattern: /azure.*firewall/i, layer: ExecutionLayer.L6_INFRASTRUCTURE },
  { pattern: /nsg|network security group/i, layer: ExecutionLayer.L6_INFRASTRUCTURE },
  { pattern: /vpn.*gateway/i, layer: ExecutionLayer.L6_INFRASTRUCTURE },
  { pattern: /virtual network|vnet/i, layer: ExecutionLayer.L6_INFRASTRUCTURE },
  { pattern: /key vault/i, layer: ExecutionLayer.L6_INFRASTRUCTURE },
  { pattern: /bastion/i, layer: ExecutionLayer.L6_INFRASTRUCTURE },
  { pattern: /private.*link/i, layer: ExecutionLayer.L6_INFRASTRUCTURE },
  { pattern: /private.*endpoint/i, layer: ExecutionLayer.L6_INFRASTRUCTURE },
  { pattern: /azure.*backup/i, layer: ExecutionLayer.L6_INFRASTRUCTURE },
  { pattern: /azure.*storage/i, layer: ExecutionLayer.L6_INFRASTRUCTURE },

  // L7 — Monitoring
  { pattern: /sentinel/i, layer: ExecutionLayer.L7_MONITORING },
  { pattern: /audit.*log/i, layer: ExecutionLayer.L7_MONITORING },
  { pattern: /unified audit/i, layer: ExecutionLayer.L7_MONITORING },
  { pattern: /log analytics/i, layer: ExecutionLayer.L7_MONITORING },
  { pattern: /secure score/i, layer: ExecutionLayer.L7_MONITORING },
  { pattern: /compliance manager/i, layer: ExecutionLayer.L7_MONITORING },
  { pattern: /alert.*rule/i, layer: ExecutionLayer.L7_MONITORING },

  // L6 — Infrastructure (Teams = collaboration infra)
  { pattern: /teams.*admin/i, layer: ExecutionLayer.L6_INFRASTRUCTURE },
  { pattern: /teams.*meeting/i, layer: ExecutionLayer.L6_INFRASTRUCTURE },
  { pattern: /teams.*calling/i, layer: ExecutionLayer.L6_INFRASTRUCTURE },
  { pattern: /teams.*external.*access/i, layer: ExecutionLayer.L6_INFRASTRUCTURE },
  { pattern: /teams.*federation/i, layer: ExecutionLayer.L6_INFRASTRUCTURE },
];

/**
 * Maps task_type to a default layer when no service-level match is found.
 */
const TASK_TYPE_DEFAULT_LAYER: Record<string, ExecutionLayer> = {
  'policy': ExecutionLayer.L0_FOUNDATION,
  'configuration': ExecutionLayer.L3_IDENTITY_POLICIES, // conservative default
  'process': ExecutionLayer.L0_FOUNDATION,
  'monitoring': ExecutionLayer.L7_MONITORING,
  'training': ExecutionLayer.L0_FOUNDATION,
  'assessment': ExecutionLayer.L8_EVIDENCE,
  'evidence_collection': ExecutionLayer.L8_EVIDENCE,
};

/**
 * Heuristic keywords in step titles / what_to_do that override layer assignment.
 */
const TITLE_OVERRIDE_PATTERNS: { pattern: RegExp; layer: ExecutionLayer }[] = [
  { pattern: /create.*(?:user|account|group|security group)/i, layer: ExecutionLayer.L1_IDENTITY_OBJECTS },
  { pattern: /provision.*(?:user|account)/i, layer: ExecutionLayer.L1_IDENTITY_OBJECTS },
  { pattern: /assign.*role/i, layer: ExecutionLayer.L2_ROLE_ASSIGNMENTS },
  { pattern: /pim.*activ/i, layer: ExecutionLayer.L2_ROLE_ASSIGNMENTS },
  { pattern: /ssp|system security plan/i, layer: ExecutionLayer.L0_FOUNDATION },
  { pattern: /poa&?m|plan of action/i, layer: ExecutionLayer.L0_FOUNDATION },
  { pattern: /training.*program/i, layer: ExecutionLayer.L0_FOUNDATION },
  { pattern: /screening.*polic/i, layer: ExecutionLayer.L0_FOUNDATION },
  { pattern: /incident.*response.*plan/i, layer: ExecutionLayer.L0_FOUNDATION },
  { pattern: /media.*(?:sanitiz|dispos|protect)/i, layer: ExecutionLayer.L0_FOUNDATION },
  { pattern: /physical.*access/i, layer: ExecutionLayer.L0_FOUNDATION },
  { pattern: /visitor/i, layer: ExecutionLayer.L0_FOUNDATION },
  { pattern: /evidence.*collect/i, layer: ExecutionLayer.L8_EVIDENCE },
  { pattern: /verify|validation|assessment/i, layer: ExecutionLayer.L8_EVIDENCE },
];

export class LayerClassifier {
  /**
   * Classify a manual step into an execution layer.
   * Priority: title overrides > service match > task_type default
   */
  classifyStep(step: CESManualStep): ExecutionLayer {
    // 1. Check title overrides first (strongest signal)
    const titleLayer = this.matchTitle(step.title);
    if (titleLayer !== undefined) return titleLayer;

    // 2. Check vendor service from actions
    if (step.actions) {
      for (const action of step.actions) {
        if (action.vendor?.m365_service) {
          const serviceLayer = this.matchService(action.vendor.m365_service);
          if (serviceLayer !== undefined) return serviceLayer;
        }
      }
    }

    // 3. Check what_to_do for service mentions
    const whatToDoText = step.what_to_do.join(' ');
    const whatLayer = this.matchServiceText(whatToDoText);
    if (whatLayer !== undefined) return whatLayer;

    // 4. Fall back to task_type default
    return TASK_TYPE_DEFAULT_LAYER[step.task_type] ?? ExecutionLayer.L0_FOUNDATION;
  }

  /**
   * Get the layer dependencies — what layers must complete before this layer can start.
   */
  getLayerDependencies(layer: ExecutionLayer): ExecutionLayer[] {
    switch (layer) {
      case ExecutionLayer.L0_FOUNDATION: return [];
      case ExecutionLayer.L1_IDENTITY_OBJECTS: return [ExecutionLayer.L0_FOUNDATION];
      case ExecutionLayer.L2_ROLE_ASSIGNMENTS: return [ExecutionLayer.L1_IDENTITY_OBJECTS];
      case ExecutionLayer.L3_IDENTITY_POLICIES: return [ExecutionLayer.L1_IDENTITY_OBJECTS, ExecutionLayer.L2_ROLE_ASSIGNMENTS];
      case ExecutionLayer.L4_DEVICE_POLICIES: return [ExecutionLayer.L3_IDENTITY_POLICIES];
      case ExecutionLayer.L5_DATA_PROTECTION: return [ExecutionLayer.L3_IDENTITY_POLICIES, ExecutionLayer.L4_DEVICE_POLICIES];
      case ExecutionLayer.L6_INFRASTRUCTURE: return [ExecutionLayer.L0_FOUNDATION];
      case ExecutionLayer.L7_MONITORING: return [ExecutionLayer.L3_IDENTITY_POLICIES, ExecutionLayer.L6_INFRASTRUCTURE];
      case ExecutionLayer.L8_EVIDENCE: return [
        ExecutionLayer.L1_IDENTITY_OBJECTS,
        ExecutionLayer.L2_ROLE_ASSIGNMENTS,
        ExecutionLayer.L3_IDENTITY_POLICIES,
        ExecutionLayer.L4_DEVICE_POLICIES,
        ExecutionLayer.L5_DATA_PROTECTION,
        ExecutionLayer.L6_INFRASTRUCTURE,
        ExecutionLayer.L7_MONITORING,
      ];
      default: return [];
    }
  }

  private matchTitle(title: string): ExecutionLayer | undefined {
    for (const { pattern, layer } of TITLE_OVERRIDE_PATTERNS) {
      if (pattern.test(title)) return layer;
    }
    return undefined;
  }

  private matchService(serviceName: string): ExecutionLayer | undefined {
    for (const { pattern, layer } of SERVICE_LAYER_MAP) {
      if (pattern.test(serviceName)) return layer;
    }
    return undefined;
  }

  private matchServiceText(text: string): ExecutionLayer | undefined {
    for (const { pattern, layer } of SERVICE_LAYER_MAP) {
      if (pattern.test(text)) return layer;
    }
    return undefined;
  }
}
