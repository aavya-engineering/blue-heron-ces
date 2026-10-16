// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { PostureLevel, AzureResourceDefinition, ResourceDiscoveryResult, GapSummary } from '../types/baseline.types.js';
import { SessionManager } from './SessionManager.js';
import { ExecutionContext } from './ExecutionContext.js';
import { getCesRepository } from 'ces-shared/persistence/node';

type SendFn = (data: object) => void;

// G2: collection in the unified CesRepository holding per-tenant assess-state (derived state read
// downstream by gaps.routes). Mirrors GuiServer's ASSESS_STATE_COLLECTION.
const ASSESS_STATE_COLLECTION = 'stamper_assess_state';

const REQUIRED_VARIABLE_MAP_KEYS = [
  'subscriptionId', 'resourceGroup', 'location',
  'lawWorkspaceName', 'storageAccountName', 'keyVaultName',
  'cmkKeyName', 'vnetName', 'vnetCidr', 'subnetPeName',
  'subnetPeCidr', 'nsgPeName', 'automationAccountName', 'eoAppDisplayName',
];

/**
 * BaselineProvisioner orchestrates Azure infrastructure resource provisioning
 * driven by infrastructure manifest variables. Requires an infrastructure manifest
 * to be generated first, uses its stamper_variable_map for all resource names,
 * performs direct Azure CLI existence checks, and provisions missing resources
 * with accumulate-and-continue error handling.
 */
export class BaselineProvisioner {
  private tenantSlug: string;
  private variables: Record<string, any>;
  private getAbortRequested: () => boolean;
  private sessionManager: SessionManager;
  private executionContext: ExecutionContext;
  private captures: Record<string, string> = {};

  constructor(
    tenantSlug: string,
    infraManifestVariables: Record<string, any>,
    getAbortRequested: () => boolean,
    sessionManager: SessionManager,
    executionContext: ExecutionContext
  ) {
    // Validate that all required stamper_variable_map keys exist
    const missing = REQUIRED_VARIABLE_MAP_KEYS.filter(k => !infraManifestVariables[k]);
    if (missing.length > 0) {
      throw new Error(`Infrastructure manifest missing required keys: ${missing.join(', ')}`);
    }

    this.tenantSlug = tenantSlug;
    this.variables = { ...infraManifestVariables };
    this.getAbortRequested = getAbortRequested;
    this.sessionManager = sessionManager;
    this.executionContext = executionContext;
  }

  /**
   * Return the list of Azure resource definitions for the given posture level.
   * M365 Only: empty array (no Azure resources).
   * M365 + Foundation: Resource Group, LAW, Storage, Key Vault, CMK Key, Automation Account.
   * M365 + Full Infra: Foundation + VNet, Subnet, NSG.
   */
  getResourceDefinitions(posture: PostureLevel): AzureResourceDefinition[] {
    if (posture === 'm365_only') {
      return [];
    }

    const v = this.variables;

    const foundation: AzureResourceDefinition[] = [
      {
        resourceType: 'ResourceGroup',
        resourceName: v.resourceGroup,
        dependsOn: [],
        provisionCommand: `New-AzResourceGroup -Name '${v.resourceGroup}' -Location '${v.location}' -ErrorAction SilentlyContinue | ConvertTo-Json -Depth 10`,
        discoveryCommand: `Get-AzResourceGroup -Name '${v.resourceGroup}' -ErrorAction SilentlyContinue | ConvertTo-Json -Depth 10`,
        captureKeys: [],
      },
      {
        resourceType: 'LogAnalyticsWorkspace',
        resourceName: v.lawWorkspaceName,
        dependsOn: [v.resourceGroup],
        provisionCommand: `New-AzOperationalInsightsWorkspace -ResourceGroupName '${v.resourceGroup}' -Name '${v.lawWorkspaceName}' -Location '${v.location}' -Sku PerGB2018 -ErrorAction SilentlyContinue | ConvertTo-Json -Depth 10`,
        discoveryCommand: `Get-AzOperationalInsightsWorkspace -ResourceGroupName '${v.resourceGroup}' -Name '${v.lawWorkspaceName}' -ErrorAction SilentlyContinue | ConvertTo-Json -Depth 10`,
        captureKeys: ['lawWorkspaceId', 'lawResourceId'],
      },
      {
        resourceType: 'StorageAccount',
        resourceName: v.storageAccountName,
        dependsOn: [v.resourceGroup],
        provisionCommand: `New-AzStorageAccount -ResourceGroupName '${v.resourceGroup}' -Name '${v.storageAccountName}' -Location '${v.location}' -SkuName Standard_GRS -Kind StorageV2 -MinimumTlsVersion TLS1_2 -AllowBlobPublicAccess $false -ErrorAction SilentlyContinue | ConvertTo-Json -Depth 10`,
        discoveryCommand: `Get-AzStorageAccount -ResourceGroupName '${v.resourceGroup}' -Name '${v.storageAccountName}' -ErrorAction SilentlyContinue | ConvertTo-Json -Depth 10`,
        captureKeys: ['storageResourceId'],
      },
      {
        resourceType: 'KeyVault',
        resourceName: v.keyVaultName,
        dependsOn: [v.resourceGroup],
        provisionCommand: `New-AzKeyVault -ResourceGroupName '${v.resourceGroup}' -VaultName '${v.keyVaultName}' -Location '${v.location}' -EnablePurgeProtection -ErrorAction SilentlyContinue | ConvertTo-Json -Depth 10`,
        discoveryCommand: `Get-AzKeyVault -ResourceGroupName '${v.resourceGroup}' -VaultName '${v.keyVaultName}' -ErrorAction SilentlyContinue | ConvertTo-Json -Depth 10`,
        captureKeys: ['kvResourceId', 'kvUri'],
      },
      {
        resourceType: 'CMKKey',
        resourceName: v.cmkKeyName,
        dependsOn: [v.keyVaultName],
        provisionCommand: `Add-AzKeyVaultKey -VaultName '${v.keyVaultName}' -Name '${v.cmkKeyName}' -Destination Software -ErrorAction SilentlyContinue | ConvertTo-Json -Depth 10`,
        discoveryCommand: `Get-AzKeyVaultKey -VaultName '${v.keyVaultName}' -Name '${v.cmkKeyName}' -ErrorAction SilentlyContinue | ConvertTo-Json -Depth 10`,
        captureKeys: [],
      },
      {
        resourceType: 'AutomationAccount',
        resourceName: v.automationAccountName,
        dependsOn: [v.resourceGroup],
        provisionCommand: `New-AzAutomationAccount -ResourceGroupName '${v.resourceGroup}' -Name '${v.automationAccountName}' -Location '${v.location}' -AssignSystemIdentity -ErrorAction SilentlyContinue | ConvertTo-Json -Depth 10`,
        discoveryCommand: `Get-AzAutomationAccount -ResourceGroupName '${v.resourceGroup}' -Name '${v.automationAccountName}' -ErrorAction SilentlyContinue | ConvertTo-Json -Depth 10`,
        captureKeys: ['automationResourceId', 'automationMiPrincipalId'],
      },
    ];

    if (posture === 'm365_foundation') {
      return foundation;
    }

    // m365_full_infra: Foundation + network resources
    const network: AzureResourceDefinition[] = [
      {
        resourceType: 'VNet',
        resourceName: v.vnetName,
        dependsOn: [v.resourceGroup],
        provisionCommand: `New-AzVirtualNetwork -ResourceGroupName '${v.resourceGroup}' -Name '${v.vnetName}' -Location '${v.location}' -AddressPrefix '${v.vnetCidr}' -ErrorAction SilentlyContinue | ConvertTo-Json -Depth 10`,
        discoveryCommand: `Get-AzVirtualNetwork -ResourceGroupName '${v.resourceGroup}' -Name '${v.vnetName}' -ErrorAction SilentlyContinue | ConvertTo-Json -Depth 10`,
        captureKeys: [],
      },
      {
        resourceType: 'Subnet',
        resourceName: v.subnetPeName,
        dependsOn: [v.vnetName],
        provisionCommand: `$vnet = Get-AzVirtualNetwork -ResourceGroupName '${v.resourceGroup}' -Name '${v.vnetName}' -ErrorAction SilentlyContinue; Add-AzVirtualNetworkSubnetConfig -Name '${v.subnetPeName}' -VirtualNetwork $vnet -AddressPrefix '${v.subnetPeCidr}' -ErrorAction SilentlyContinue | Set-AzVirtualNetwork -ErrorAction SilentlyContinue | ConvertTo-Json -Depth 10`,
        discoveryCommand: `Get-AzVirtualNetworkSubnetConfig -Name '${v.subnetPeName}' -VirtualNetwork (Get-AzVirtualNetwork -ResourceGroupName '${v.resourceGroup}' -Name '${v.vnetName}' -ErrorAction SilentlyContinue) -ErrorAction SilentlyContinue | ConvertTo-Json -Depth 10`,
        captureKeys: [],
      },
      {
        resourceType: 'NSG',
        resourceName: v.nsgPeName,
        dependsOn: [v.resourceGroup],
        provisionCommand: `New-AzNetworkSecurityGroup -ResourceGroupName '${v.resourceGroup}' -Name '${v.nsgPeName}' -Location '${v.location}' -ErrorAction SilentlyContinue | ConvertTo-Json -Depth 10`,
        discoveryCommand: `Get-AzNetworkSecurityGroup -ResourceGroupName '${v.resourceGroup}' -Name '${v.nsgPeName}' -ErrorAction SilentlyContinue | ConvertTo-Json -Depth 10`,
        captureKeys: [],
      },
    ];

    return [...foundation, ...network];
  }

  /**
   * Discover the current posture of Azure resources by running discoveryCommand for each.
   * Non-null JSON with ResourceId field means exists=true. Accumulate-and-continue on errors.
   */
  async discoverPosture(
    resources: AzureResourceDefinition[],
    send: SendFn
  ): Promise<Map<string, ResourceDiscoveryResult>> {
    const results = new Map<string, ResourceDiscoveryResult>();

    for (const resource of resources) {
      if (this.getAbortRequested()) break;

      const startTime = Date.now();

      try {
        const psResult = await this.sessionManager.execute('azure', resource.discoveryCommand);
        const durationMs = Date.now() - startTime;

        let exists = false;
        let resourceId: string | undefined;

        if (psResult.exitCode === 0 && psResult.stdout.trim()) {
          // Strip STAMPER_EXECUTION_SUCCESS marker before parsing JSON
          const cleanStdout = psResult.stdout.replace(/STAMPER_EXECUTION_SUCCESS\s*/g, '').trim();
          try {
            const parsed = JSON.parse(cleanStdout);
            if (parsed && (parsed.ResourceId || parsed.Id)) {
              exists = true;
              resourceId = parsed.ResourceId || parsed.Id;
            }
          } catch {
            // Non-JSON output — treat as not found
          }
        }

        const result: ResourceDiscoveryResult = {
          resourceName: resource.resourceName,
          resourceType: resource.resourceType,
          exists,
          resourceId,
        };
        results.set(resource.resourceName, result);

        // Merge captures from existing resources
        if (exists && psResult.stdout.trim()) {
          this.extractAndMergeCaptures(resource, psResult.stdout.trim());
        }

        send({
          type: 'discovery_progress',
          resourceName: resource.resourceName,
          resourceType: resource.resourceType,
          exists,
          ...(resourceId ? { resourceId } : {}),
          durationMs,
        });
      } catch (err) {
        const durationMs = Date.now() - startTime;
        const errorMsg = err instanceof Error ? err.message : String(err);

        const result: ResourceDiscoveryResult = {
          resourceName: resource.resourceName,
          resourceType: resource.resourceType,
          exists: false,
          error: errorMsg,
        };
        results.set(resource.resourceName, result);

        send({
          type: 'discovery_progress',
          resourceName: resource.resourceName,
          resourceType: resource.resourceType,
          exists: false,
          error: errorMsg,
          durationMs,
        });
      }
    }

    return results;
  }

  /**
   * Compare discovered resources against resource definitions.
   * Returns gap summary and list of missing resource definitions.
   */
  computeGaps(
    resources: AzureResourceDefinition[],
    discoveryResults: Map<string, ResourceDiscoveryResult>
  ): { gapSummary: GapSummary; missingResources: AzureResourceDefinition[] } {
    const missingResources: AzureResourceDefinition[] = [];
    let existingCount = 0;
    const byResourceType: Record<string, number> = {};

    for (const resource of resources) {
      const result = discoveryResults.get(resource.resourceName);
      if (result && result.exists) {
        existingCount++;
      } else {
        missingResources.push(resource);
        byResourceType[resource.resourceType] = (byResourceType[resource.resourceType] || 0) + 1;
      }
    }

    const gapSummary: GapSummary = {
      total: resources.length,
      missing: missingResources.length,
      existing: existingCount,
      byResourceType,
    };

    return { gapSummary, missingResources };
  }

  /**
   * Execute provisioning for missing resources in dependency order.
   * Accumulate-and-continue: failed resources emit baseline_error and continue.
   * Resources depending on failed resources are skipped.
   */
  async executeGaps(
    missingResources: AzureResourceDefinition[],
    send: SendFn
  ): Promise<{ succeeded: number; failed: number; skipped: number }> {
    if (missingResources.length === 0) {
      return { succeeded: 0, failed: 0, skipped: 0 };
    }

    // Sort into dependency layers:
    // Layer 0: no dependencies (Resource Group)
    // Layer 1: depends on Resource Group (LAW, Storage, KV, VNet)
    // Layer 2: depends on Layer 1 resources (CMK Key, Automation, NSG, Subnet)
    const layers = this.sortIntoDependencyLayers(missingResources);

    let succeeded = 0;
    let failed = 0;
    let skipped = 0;
    const failedResources = new Set<string>();

    for (const layer of layers) {
      if (this.getAbortRequested()) break;

      for (const resource of layer) {
        if (this.getAbortRequested()) {
          skipped++;
          continue;
        }

        // Check if any dependency has failed
        const failedDep = resource.dependsOn.find(dep => failedResources.has(dep));
        if (failedDep) {
          send({
            type: 'baseline_error',
            phase: 'provision',
            resourceName: resource.resourceName,
            error: `dependency ${failedDep} failed`,
          });
          failedResources.add(resource.resourceName);
          skipped++;
          continue;
        }

        try {
          // Execute the provision command
          const provisionResult = await this.sessionManager.execute('azure', resource.provisionCommand);

          send({
            type: 'execution_progress',
            resourceName: resource.resourceName,
            resourceType: resource.resourceType,
            phase: 'provision',
            exitCode: provisionResult.exitCode,
            stdout: provisionResult.stdout.substring(0, 2000),
            stderr: provisionResult.stderr.substring(0, 500),
          });

          if (provisionResult.exitCode > 0) {
            send({
              type: 'baseline_error',
              phase: 'provision',
              resourceName: resource.resourceName,
              error: provisionResult.stderr || `Provision failed with exit code ${provisionResult.exitCode}`,
            });
            failedResources.add(resource.resourceName);
            failed++;
            continue;
          }

          succeeded++;

          // After successful provisioning, run discoveryCommand and extract captures
          if (resource.captureKeys.length > 0) {
            try {
              const discoverResult = await this.sessionManager.execute('azure', resource.discoveryCommand);
              if (discoverResult.exitCode === 0 && discoverResult.stdout.trim()) {
                const capturedValues = this.extractAndMergeCaptures(resource, discoverResult.stdout.trim());
                if (Object.keys(capturedValues).length > 0) {
                  send({
                    type: 'execution_progress',
                    resourceName: resource.resourceName,
                    resourceType: resource.resourceType,
                    phase: 'capture_resolved',
                    exitCode: 0,
                    stdout: '',
                    stderr: '',
                    captures: capturedValues,
                  });
                }
              }
            } catch {
              // best-effort capture extraction
            }
          }
        } catch (execErr) {
          const execMsg = execErr instanceof Error ? execErr.message : String(execErr);
          send({
            type: 'baseline_error',
            phase: 'provision',
            resourceName: resource.resourceName,
            error: execMsg,
          });
          failedResources.add(resource.resourceName);
          failed++;
        }
      }
    }

    // Register all captures with ExecutionContext
    if (Object.keys(this.captures).length > 0) {
      this.executionContext.registerCaptures(this.captures);
      Object.assign(this.variables, this.captures);
    }

    return { succeeded, failed, skipped };
  }

  /**
   * Persist captured resource IDs to the tenant's assess-state under the baselineCaptures key.
   * G2: assess-state is DERIVED STATE read downstream (gaps.routes), so it lives in the unified
   * tuple/tenant-keyed CesRepository — one record per tenant: collection 'stamper_assess_state',
   * scope { tenantSlug }, id = slug. Merge semantics (read-modify-write of the state object) are
   * preserved so existing keys survive.
   */
  persistCaptures(): void {
    const repo = getCesRepository();
    const existing = repo.get<Record<string, any>>(
      ASSESS_STATE_COLLECTION,
      this.tenantSlug,
      { tenantSlug: this.tenantSlug },
    );
    const state: Record<string, any> = existing ? { ...existing.data } : {};

    state.baselineCaptures = {
      ...this.captures,
      lastUpdated: new Date().toISOString(),
    };

    repo.put(ASSESS_STATE_COLLECTION, {
      id: this.tenantSlug,
      ces: { tenantSlug: this.tenantSlug },
      data: state,
    });
  }

  /**
   * Sort resources into dependency layers for ordered provisioning.
   * Layer 0: Resources with no dependencies (or dependencies already satisfied).
   * Layer 1+: Resources whose dependencies are in earlier layers.
   */
  private sortIntoDependencyLayers(resources: AzureResourceDefinition[]): AzureResourceDefinition[][] {
    const layers: AzureResourceDefinition[][] = [];
    const placed = new Set<string>();
    let remaining = [...resources];

    // Also consider already-existing resources as "placed" (their dependencies are satisfied)
    // The missing resources list already excludes existing ones, but dependencies
    // may reference resources that exist (not in the missing list)
    // We need to account for resources that are NOT in the missing list (already exist)
    const allResourceNames = new Set(resources.map(r => r.resourceName));

    while (remaining.length > 0) {
      const layer: AzureResourceDefinition[] = [];

      for (const resource of remaining) {
        const unmetDeps = resource.dependsOn.filter(
          dep => allResourceNames.has(dep) && !placed.has(dep)
        );
        if (unmetDeps.length === 0) {
          layer.push(resource);
        }
      }

      if (layer.length === 0) {
        // Circular dependency or unresolvable — place all remaining in final layer
        layers.push(remaining);
        break;
      }

      for (const resource of layer) {
        placed.add(resource.resourceName);
      }

      remaining = remaining.filter(r => !placed.has(r.resourceName));
      layers.push(layer);
    }

    return layers;
  }

  /**
   * Extract capture values from discovery command JSON output and merge into captures.
   * Returns the newly extracted key-value pairs.
   */
  private extractAndMergeCaptures(
    resource: AzureResourceDefinition,
    stdout: string
  ): Record<string, string> {
    const extracted: Record<string, string> = {};

    try {
      const cleanStdout = stdout.replace(/STAMPER_EXECUTION_SUCCESS\s*/g, '').trim();
      const parsed = JSON.parse(cleanStdout);
      if (!parsed) return extracted;

      for (const key of resource.captureKeys) {
        switch (key) {
          case 'lawWorkspaceId':
            if (parsed.CustomerId) {
              extracted.lawWorkspaceId = parsed.CustomerId;
            }
            break;
          case 'lawResourceId':
            if (parsed.ResourceId) {
              extracted.lawResourceId = parsed.ResourceId;
            }
            break;
          case 'kvResourceId':
            if (parsed.ResourceId) {
              extracted.kvResourceId = parsed.ResourceId;
            }
            break;
          case 'kvUri':
            if (parsed.VaultUri) {
              extracted.kvUri = parsed.VaultUri;
            }
            break;
          case 'storageResourceId':
            if (parsed.Id || parsed.ResourceId) {
              extracted.storageResourceId = parsed.Id || parsed.ResourceId;
            }
            break;
          case 'automationResourceId':
            if (parsed.Id || parsed.ResourceId) {
              extracted.automationResourceId = parsed.Id || parsed.ResourceId;
            }
            break;
          case 'automationMiPrincipalId':
            if (parsed.Identity?.PrincipalId) {
              extracted.automationMiPrincipalId = parsed.Identity.PrincipalId;
            }
            break;
        }
      }
    } catch {
      // Non-parseable output — no captures
    }

    // Merge into accumulated captures
    Object.assign(this.captures, extracted);

    return extracted;
  }
}
