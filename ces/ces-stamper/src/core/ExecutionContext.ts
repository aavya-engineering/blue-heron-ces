// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { ClientConfig } from '../config/ClientConfig.js';

export interface ContractError {
  step_id: string;
  entry_id: string;
  missing_variable: string;
  source: 'manifest' | 'runtime';
  message: string;
}

export interface VariableValidationTarget {
  step_id: string;
  entry_id: string;
  variables_required: string[];
  variables_runtime: string[];
}

export interface TenantCredentials {
  tenantId: string;
  appId: string;
  certThumbprint: string;
  certPath?: string;
}

export class ExecutionContext {
  private variables: Map<string, string> = new Map();
  private runtimeVariables: Map<string, string> = new Map();
  private _dryRun: boolean;

  constructor(dryRun: boolean = false, tenantCredentials?: TenantCredentials) {
    this._dryRun = dryRun;

    // If credentials provided, load them immediately into variables
    if (tenantCredentials) {
      this.variables.set('tenantId', tenantCredentials.tenantId);
      this.variables.set('appId', tenantCredentials.appId);
      this.variables.set('certThumbprint', tenantCredentials.certThumbprint);
      if (tenantCredentials.certPath) {
        this.variables.set('certPath', tenantCredentials.certPath);
      }
    }
  }

  isDryRun(): boolean { return this._dryRun; }

  /**
   * Load manifest variables at translate-time.
   * Accepts the flattened output of ManifestReader.generateVariables().
   */
  loadManifestVariables(vars: Record<string, any>): void {
    for (const [key, value] of Object.entries(vars)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        this.variables.set(key, String(value));
      }
      // Skip object/array values — they're namespaced config_intent blocks
    }
  }

  /**
   * Load client config variables (appId, tenantId, certThumbprint).
   */
  loadClientConfig(config: ClientConfig): void {
    this.variables.set('tenantId', config.tenantId);
    this.variables.set('appId', config.appId);
    this.variables.set('certThumbprint', config.certThumbprint);
    this.variables.set('certPath', config.certPath);
    if (config.targetTenantDomain) {
      this.variables.set('tenantName', config.targetTenantDomain.split('.')[0]);
    }
    if (config.subscriptionId) {
      this.variables.set('subscriptionId', config.subscriptionId);
    }
    if (config.subscription?.resource_group) {
      this.variables.set('resourceGroup', config.subscription.resource_group);
    }
    if (config.subscription?.location) {
      this.variables.set('location', config.subscription.location);
    }
    if (config.clientName) {
      this.variables.set('clientName', config.clientName);
    }
  }

  /**
   * Register variables captured from command output at runtime.
   */
  registerCaptures(captures: Record<string, string>): void {
    for (const [key, value] of Object.entries(captures)) {
      this.runtimeVariables.set(key, value);
    }
  }

  /**
   * Resolve {variable} placeholders in a command template.
   * Checks manifest vars first, then runtime captures.
   * In dry-run mode, unresolved runtime vars become <RUNTIME:varName>.
   * Missing required manifest vars always throw.
   */
  resolve(template: string, variablesRequired: string[], variablesRuntime: string[], skipUnresolvableManifest: boolean = false): string {
    // Check manifest vars
    const missingManifest = variablesRequired.filter(
      v => !this.variables.has(v) && !this.runtimeVariables.has(v)
    );
    if (missingManifest.length > 0 && !skipUnresolvableManifest) {
      throw new Error(
        `Unresolved manifest variables: ${missingManifest.join(', ')}. ` +
        `Ensure tenant manifest provides these values.`
      );
    }

    // Check runtime vars
    const missingRuntime = variablesRuntime.filter(
      v => !this.variables.has(v) && !this.runtimeVariables.has(v)
    );
    if (missingRuntime.length > 0 && !this._dryRun) {
      throw new Error(
        `Unresolved runtime variables: ${missingRuntime.join(', ')}. ` +
        `These should be produced by prior command captures.`
      );
    }

    return template.replace(/\{(\w+)\}/g, (match, name) => {
      if (this.runtimeVariables.has(name)) {
        return this.runtimeVariables.get(name)!;
      }
      if (this.variables.has(name)) {
        return this.variables.get(name)!;
      }
      if (this._dryRun || skipUnresolvableManifest) {
        return `<MANIFEST:${name}>`;
      }
      return match; // leave as-is if somehow missed
    });
  }

  /**
   * Pre-flight validation: check all manifest variables across all steps.
   * Returns ALL errors at once (TypeScript-style, not fail-on-first).
   * Runtime variables are validated against captures from prior entries.
   */
  validateManifestContract(
    targets: VariableValidationTarget[],
    runtimeProducedSet: Set<string>
  ): ContractError[] {
    const errors: ContractError[] = [];

    for (const target of targets) {
      for (const v of target.variables_required) {
        if (!this.variables.has(v) && !runtimeProducedSet.has(v)) {
          errors.push({
            step_id: target.step_id,
            entry_id: target.entry_id,
            missing_variable: v,
            source: 'manifest',
            message: `Variable "${v}" required by "${target.entry_id}" in step "${target.step_id}" is not provided by manifest config and is not produced by any prior command capture.`,
          });
        }
      }

      for (const v of target.variables_runtime) {
        if (!runtimeProducedSet.has(v) && !this.variables.has(v)) {
          errors.push({
            step_id: target.step_id,
            entry_id: target.entry_id,
            missing_variable: v,
            source: 'runtime',
            message: `Runtime variable "${v}" required by "${target.entry_id}" in step "${target.step_id}" is not produced by any prior command capture and is not in manifest.`,
          });
        }
      }
    }

    return errors;
  }

  /**
   * Get all currently available variables (for debugging/reporting).
   */
  getAllVariables(): Record<string, string> {
    const all: Record<string, string> = {};
    for (const [k, v] of this.variables) all[k] = v;
    for (const [k, v] of this.runtimeVariables) all[k] = v;
    return all;
  }

  /**
   * Check if a specific variable is available.
   */
  hasVariable(name: string): boolean {
    return this.variables.has(name) || this.runtimeVariables.has(name);
  }
}
