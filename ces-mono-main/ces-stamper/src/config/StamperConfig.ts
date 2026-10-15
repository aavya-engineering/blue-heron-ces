// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { BHD_PROVENANCE } from './provenance.js';
import { getModuleStorageRoot } from 'ces-shared/storage';
import { getActiveStackProvider } from 'ces-shared/stack';

/**
 * G4 — cloud-endpoint / convention DEFAULTS resolved through the active stack-provider seam
 * (ADR-003) instead of being inlined here. The Microsoft (GCC High) reference provider returns
 * the SAME values, so resolved config is byte-for-byte identical for the default stack. The active
 * stack id comes from the tenant config `stack` field (absent ⇒ DEFAULT_STACK_ID 'microsoft-gcc-high').
 * Only stack-agnostic endpoint/convention defaults move behind the seam — PowerShell cmdlets, Azure
 * resource types and registry command content remain Microsoft reference-implementation internals.
 */
interface StackEndpointDefaults {
  graphEndpoint: string;
  loginEndpoint: string;
  exchangeEnv: string;
  complianceUri: string;
  azureAuthEndpoint: string;
  /** True when the active stack's cloud environment is GCC High. */
  gccHighEndpoints: boolean;
}

function resolveStackDefaults(stack?: string): StackEndpointDefaults {
  const { cloudEndpoints, conventions } = getActiveStackProvider(stack ? { stack } : undefined).capabilities;
  const login = cloudEndpoints.login;
  return {
    graphEndpoint: cloudEndpoints.graph,
    loginEndpoint: login,
    // Microsoft provider supplies these; a minimal provider may omit them.
    exchangeEnv: cloudEndpoints.exchange ?? '',
    complianceUri: cloudEndpoints.compliance ?? '',
    // azure_auth is the login authority's /organizations endpoint (derived, not a separate literal).
    azureAuthEndpoint: `${login}/organizations`,
    gccHighEndpoints: conventions.cloudEnvironment === 'gcc_high',
  };
}

export interface StamperConfigOptions {
  tenantId: string;
  appId: string;
  certThumbprint: string;
  certPath: string;
  domain?: string;   // tenant primary domain (e.g. vfsgov.onmicrosoft.us) for EXO -Organization
  subscriptionId?: string;   // Azure subscription for the ARM channel (Set-AzContext)
  gccHighEndpoints: boolean;
  graphEndpoint: string;
  loginEndpoint: string;
  exchangeEnv: string;
  complianceUri: string;
  azureAuthEndpoint: string;
  storageRoot: string;
  stateDir: string;
  evidenceDir: string;
  logLevel: string;
  logDir: string;
  dryRun: boolean;
  enableRollback: boolean;
  idempotencyCheck: boolean;
}

/**
 * Layer 1: BHD Engine Configuration — IP retained by Blue Heron Defense, LLC.
 * Engine defaults and infrastructure parameters owned by BHD.
 */
export class StamperConfig {
  static readonly provenance = BHD_PROVENANCE;

  private config: StamperConfigOptions;

  constructor(envPath?: string, overrides?: Partial<StamperConfigOptions>, stack?: string) {
    // Load environment variables
    if (envPath && fs.existsSync(envPath)) {
      dotenv.config({ path: envPath });
    } else {
      dotenv.config();
    }

    this.config = { ...this.loadConfig(stack), ...overrides };
    this.validateConfig();
    this.ensureDirectories();
  }

  private loadConfig(stack?: string): StamperConfigOptions {
    // Cloud-endpoint / convention DEFAULTS come from the active stack provider (ADR-003), not inlined.
    const stackDefaults = resolveStackDefaults(stack);
    return {
      tenantId: process.env.TENANT_ID || '',
      appId: process.env.APP_ID || '',
      certThumbprint: process.env.CERT_THUMBPRINT || '',
      certPath: process.env.CERT_PATH || '',
      gccHighEndpoints: process.env.GCC_HIGH_ENDPOINTS === 'true',
      graphEndpoint: process.env.GRAPH_ENDPOINT || stackDefaults.graphEndpoint,
      loginEndpoint: process.env.LOGIN_ENDPOINT || stackDefaults.loginEndpoint,
      exchangeEnv: process.env.EXCHANGE_ENV || stackDefaults.exchangeEnv,
      complianceUri: process.env.COMPLIANCE_URI || stackDefaults.complianceUri,
      azureAuthEndpoint: process.env.AZURE_AUTH_ENDPOINT || stackDefaults.azureAuthEndpoint,
      storageRoot: process.env.STORAGE_ROOT || getModuleStorageRoot('Stamper'),
      stateDir: process.env.STATE_DIR || path.join(process.env.STORAGE_ROOT || getModuleStorageRoot('Stamper'), 'state'),
      evidenceDir: process.env.EVIDENCE_DIR || path.join(process.env.STORAGE_ROOT || getModuleStorageRoot('Stamper'), 'evidence'),
      logLevel: process.env.LOG_LEVEL || 'info',
      logDir: process.env.LOG_DIR || path.join(process.env.STORAGE_ROOT || getModuleStorageRoot('Stamper'), 'logs'),
      dryRun: process.env.DRY_RUN === 'true',
      enableRollback: process.env.ENABLE_ROLLBACK !== 'false',
      idempotencyCheck: process.env.IDEMPOTENCY_CHECK !== 'false'
    };
  }

  private validateConfig(): void {
    const errors: string[] = [];

    if (!this.config.dryRun) {
      if (!this.config.tenantId) {
        errors.push('TENANT_ID is required');
      }
      if (!this.config.appId) {
        errors.push('APP_ID is required');
      }
      if (!this.config.certThumbprint) {
        errors.push('CERT_THUMBPRINT is required');
      }
      if (!this.config.certPath) {
        errors.push('CERT_PATH is required');
      } else if (!fs.existsSync(this.config.certPath)) {
        errors.push(`Certificate file not found at: ${this.config.certPath}`);
      }
    }

    if (errors.length > 0) {
      throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
    }
  }

  private ensureDirectories(): void {
    const dirs = [
      this.config.storageRoot,
      this.config.stateDir,
      this.config.evidenceDir,
      this.config.logDir
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  get tenantId(): string {
    return this.config.tenantId;
  }

  get appId(): string {
    return this.config.appId;
  }

  get certThumbprint(): string {
    return this.config.certThumbprint;
  }

  get certPath(): string {
    return this.config.certPath;
  }

  get domain(): string {
    return this.config.domain || '';
  }

  get subscriptionId(): string {
    return this.config.subscriptionId || '';
  }

  get gccHighEndpoints(): boolean {
    return this.config.gccHighEndpoints;
  }

  get graphEndpoint(): string {
    return this.config.graphEndpoint;
  }

  get loginEndpoint(): string {
    return this.config.loginEndpoint;
  }

  get exchangeEnv(): string {
    return this.config.exchangeEnv;
  }

  get complianceUri(): string {
    return this.config.complianceUri;
  }

  get azureAuthEndpoint(): string {
    return this.config.azureAuthEndpoint;
  }

  get storageRoot(): string {
    return this.config.storageRoot;
  }

  get stateDir(): string {
    return this.config.stateDir;
  }

  get evidenceDir(): string {
    return this.config.evidenceDir;
  }

  get logLevel(): string {
    return this.config.logLevel;
  }

  get logDir(): string {
    return this.config.logDir;
  }

  get dryRun(): boolean {
    return this.config.dryRun;
  }

  get enableRollback(): boolean {
    return this.config.enableRollback;
  }

  get idempotencyCheck(): boolean {
    return this.config.idempotencyCheck;
  }

  get clientName(): string {
    return process.env.CLIENT_NAME || 'ValorForge Solutions';
  }

  getAll(): StamperConfigOptions {
    return { ...this.config };
  }

  /**
   * Create StamperConfig from ClientConfig without mutating process.env.
   * Explicitly passes credentials instead of reading from environment.
   */
  static fromTenantConfig(cfg: any): StamperConfig {
    // Active stack id from the tenant config seam (absent ⇒ DEFAULT_STACK_ID 'microsoft-gcc-high').
    // Cloud-endpoint / convention DEFAULTS come from that stack's provider (ADR-003), not inlined.
    const stack: string | undefined = cfg.stack;
    const stackDefaults = resolveStackDefaults(stack);
    const overrides: Partial<StamperConfigOptions> = {
      tenantId: cfg.tenant?.tenant_id || cfg.tenantId || '',
      appId: cfg.auth?.app_id || cfg.appId || '',
      certThumbprint: cfg.auth?.cert_thumbprint || cfg.certThumbprint || '',
      certPath: cfg.auth?.cert_path || cfg.certPath || '',
      domain: cfg.tenant?.domain || cfg.domain || '',
      subscriptionId: cfg.subscription?.subscription_id || cfg.subscriptionId || '',
      gccHighEndpoints: stackDefaults.gccHighEndpoints,
      graphEndpoint: cfg.endpoints?.graph || stackDefaults.graphEndpoint,
      loginEndpoint: cfg.endpoints?.login || stackDefaults.loginEndpoint,
      exchangeEnv: cfg.endpoints?.exchange_env || stackDefaults.exchangeEnv,
      complianceUri: cfg.endpoints?.compliance_uri || stackDefaults.complianceUri,
      azureAuthEndpoint: cfg.endpoints?.azure_auth || stackDefaults.azureAuthEndpoint,
      dryRun: cfg.dryRun ?? true,  // Default to dryRun=true to skip cert-file-exists check; caller can override
    };

    // Pass through optional infrastructure overrides (stateDir, storageRoot, etc.)
    if (cfg.stateDir) overrides.stateDir = cfg.stateDir;
    if (cfg.storageRoot) overrides.storageRoot = cfg.storageRoot;
    if (cfg.evidenceDir) overrides.evidenceDir = cfg.evidenceDir;
    if (cfg.logDir) overrides.logDir = cfg.logDir;

    // Create instance without reading process.env; pass the resolved stack so loadConfig() defaults match.
    const instance = new StamperConfig(undefined, overrides, stack);
    return instance;
  }
}
