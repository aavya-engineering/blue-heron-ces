// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as fs from 'fs';
import {
  CESTenantManifestSchema,
  CESTenantManifestBodySchema,
  CESTenantManifestBody,
  CESNormativeControl,
  CESConfigIntent,
  CESEvidenceMonitor,
  CESDriftPolicy,
} from '../types/ces-artifacts.types.js';
import { Check } from '../types/schema.types.js';
import type { ProvisioningInputs } from 'ces-shared/types/mission-plan';

/**
 * Reads and validates a CES Tenant Manifest.
 * Extracts normative controls, config intents, evidence monitors, and drift policies.
 * Can generate Stamper-compatible prechecks/postchecks from manifest data.
 */
export class ManifestReader {
  private manifest: CESTenantManifestBody;

  constructor(manifest: CESTenantManifestBody) {
    this.manifest = manifest;
  }

  /**
   * Load from a standalone tenant manifest JSON file.
   */
  static fromFile(filePath: string): ManifestReader {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Manifest file not found: ${filePath}`);
    }
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const result = CESTenantManifestSchema.safeParse(data);
    if (!result.success) {
      throw new Error(
        `Manifest validation failed: ${result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`
      );
    }
    return new ManifestReader(result.data.tenant_manifest);
  }

  /**
   * Load from an embedded tenant_manifest block (extracted from mission plan outputs).
   */
  static fromEmbedded(manifestBody: unknown): ManifestReader {
    const result = CESTenantManifestBodySchema.safeParse(manifestBody);
    if (!result.success) {
      throw new Error(
        `Embedded manifest validation failed: ${result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`
      );
    }
    return new ManifestReader(result.data);
  }

  get manifestId(): string {
    return this.manifest.manifest_id;
  }

  get techStackId(): number {
    return this.manifest.tech_stack_id;
  }

  get normativeControls(): CESNormativeControl[] {
    return this.manifest.normative_controls;
  }

  get configIntents(): CESConfigIntent[] {
    return this.manifest.config_intents;
  }

  get evidenceMonitors(): CESEvidenceMonitor[] {
    return this.manifest.evidence_monitors;
  }

  get driftPolicies(): CESDriftPolicy[] {
    return this.manifest.drift_policies;
  }

  /**
   * FC-ST-3 step 2: m365-only sessions carry no Infra Manifest, so approver_upn /
   * terms_of_use_file / initial_password_ref travel on the Tenant Manifest instead
   * (ces-shared 2.8.0 `ProvisioningInputsSchema`). Undefined when the manifest carries none.
   */
  get provisioningInputs(): ProvisioningInputs | undefined {
    return (this.manifest as unknown as { provisioning_inputs?: ProvisioningInputs }).provisioning_inputs;
  }

  /**
   * Get all control IDs declared in the manifest.
   */
  getControlIds(): string[] {
    return this.manifest.normative_controls.map(nc => nc.control_id);
  }

  /**
   * Get the normative control definition for a specific control ID.
   */
  getControl(controlId: string): CESNormativeControl | undefined {
    return this.manifest.normative_controls.find(nc => nc.control_id === controlId);
  }

  /**
   * Get config intents that apply to a specific control ID.
   */
  getConfigIntentsForControl(controlId: string): CESConfigIntent[] {
    return this.manifest.config_intents.filter(ci => ci.control_ids.includes(controlId));
  }

  /**
   * Get evidence monitors that apply to a specific control ID.
   */
  getEvidenceMonitorsForControl(controlId: string): CESEvidenceMonitor[] {
    return this.manifest.evidence_monitors.filter(em => em.control_ids.includes(controlId));
  }

  /**
   * Phase 10.2: Generate platform-level connectivity prechecks from config_intents[].query_method.
   * Produces at most one check per distinct platform endpoint rather than sampling controls.
   * At 128 controls this produces 3-6 focused platform prechecks vs. 2.3% control sampling.
   */
  generatePrechecks(): Check[] {
    const emittedEndpoints = new Set<string>();
    const checks: Check[] = [];

    for (const ci of this.manifest.config_intents) {
      switch (ci.query_method) {
        case 'api': {
          const endpoint = 'graph.microsoft.us/v1.0/organization';
          if (!emittedEndpoints.has(endpoint)) {
            emittedEndpoints.add(endpoint);
            checks.push({
              id: 'pre-graph-connectivity',
              description: 'Verify Microsoft Graph API (GCC High) connectivity',
              method: 'api_query',
              target: '/v1.0/organization',
              expected: 'accessible',
              on_fail: 'Cannot reach graph.microsoft.us — check tenant credentials and network'
            });
          }
          break;
        }

        case 'export': {
          const endpoint = 'exchange-online-gcchigh';
          if (!emittedEndpoints.has(endpoint)) {
            emittedEndpoints.add(endpoint);
            checks.push({
              id: 'pre-exchange-connectivity',
              description: 'Verify Exchange Online / IPPS connectivity (GCC High)',
              method: 'api_query',
              target: '/v1.0/organization',
              expected: 'accessible',
              on_fail: 'Cannot reach Exchange Online GCC High — check Connect-ExchangeOnline credentials'
            });
          }
          break;
        }

        case 'log_query': {
          const endpoint = 'management.usgovcloudapi.net';
          if (!emittedEndpoints.has(endpoint)) {
            emittedEndpoints.add(endpoint);
            checks.push({
              id: 'pre-arm-connectivity',
              description: 'Verify Azure ARM management endpoint connectivity (Azure Government)',
              method: 'api_query',
              target: '/v1.0/organization',
              expected: 'accessible',
              on_fail: 'Cannot reach management.usgovcloudapi.net — check Azure Government credentials'
            });
          }
          break;
        }

        // 'manual' query method requires no platform connectivity check
        default:
          break;
      }
    }

    return checks;
  }

  /**
   * Generate Stamper-compatible postchecks from manifest normative_controls.
   * These validate that execution achieved the desired state.
   */
  generatePostchecks(): Check[] {
    const checks: Check[] = [];

    for (const nc of this.manifest.normative_controls) {
      for (const v of nc.verification) {
        checks.push({
          id: `post-${v.id}`,
          description: `[Postcheck] ${nc.control_id}: ${v.description}`,
          method: v.method,
          expected: v.expected,
          on_fail: v.on_fail
        });
      }
    }

    return checks;
  }

  /**
   * Generate variables from config intents (desired_config blocks).
   * Flattens config_intent desired_config keys and tenant_identity into
   * a flat variable map for CommandRegistry template resolution.
   */
  generateVariables(): Record<string, any> {
    const vars: Record<string, any> = {};

    for (const ci of this.manifest.config_intents) {
      // Namespaced config intent (backward compat)
      vars[`config_intent.${ci.id}`] = ci.desired_config;

      // Flatten each desired_config key directly for registry variable resolution.
      // First write wins — higher-priority intents (earlier in array) take precedence.
      // Scalars only, mirroring the tenant_identity filter below: non-scalar values
      // (e.g. the powershell_commands array) must not become plan variables — templates
      // can only substitute scalars, and stringified arrays trip the injection guard.
      // The namespaced config_intent.<id> entry above keeps the full object available.
      for (const [key, value] of Object.entries(ci.desired_config)) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          if (!(key in vars)) {
            vars[key] = value;
          }
        }
      }
    }

    // Flatten tenant_identity if present (tenantId, domain, tenant_name, etc.)
    if (this.manifest.tenant_identity) {
      for (const [key, value] of Object.entries(this.manifest.tenant_identity)) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          vars[key] = value;
        }
      }

      // cse-fe-v2 canonical mappings (snake_case → camelCase)
      const ti = this.manifest.tenant_identity as any;
      if (ti.tenant_id && !vars['tenantId']) vars['tenantId'] = ti.tenant_id;
      if (ti.primary_domain && !vars['primaryDomain']) vars['primaryDomain'] = ti.primary_domain;
      // tenantName derived from targetTenantDomain in PlanTranslator (lines 394, 835)
      if (ti.cloud_environment) vars['cloudEnvironment'] = ti.cloud_environment;
      if (ti.primary_sku) vars['primarySku'] = ti.primary_sku;
      if (ti.license_count !== undefined) vars['licenseCount'] = ti.license_count;
    }

    // Extract Sentinel/LAW variables from evidence_monitors
    for (const em of this.manifest.evidence_monitors) {
      const emAny = em as any;
      if (emAny.sentinel_workspace && !vars['sentinelWorkspace'])
        vars['sentinelWorkspace'] = emAny.sentinel_workspace;
      if (emAny.sentinel_resource_group && !vars['sentinelResourceGroup'])
        vars['sentinelResourceGroup'] = emAny.sentinel_resource_group;
      if (emAny.log_analytics_workspace_id && !vars['logAnalyticsWorkspaceId'])
        vars['logAnalyticsWorkspaceId'] = emAny.log_analytics_workspace_id;
    }

    vars['manifest_id'] = this.manifest.manifest_id;
    vars['tech_stack_id'] = this.manifest.tech_stack_id;

    return vars;
  }

  /**
   * Get the raw manifest body.
   */
  getManifest(): CESTenantManifestBody {
    return this.manifest;
  }
}
