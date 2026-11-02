// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FE-safe CES config contract: pure types + validation + resolvers. Zero node:* imports.
//
// The CES config file binds a Planner customer (customerName / customerId) to a Stamper/EO
// tenant (tenantSlug / tenantId) so the identity tuple can cross the subsystem boundary (G1 T2).
// See docs/G1-plan.md and docs/adr/ADR-001-ces-identity-model.md.

/**
 * The CES identity block carried on cross-subsystem outputs (Stamper plans/evidence, EO
 * assessment/SSP/POA&M, AO evidence). All fields optional — each subsystem fills what it knows.
 * See docs/adr/ADR-001-ces-identity-model.md.
 */
export interface CesIdentity {
  cesId?: string;
  customerId?: number;
  siBaselineId?: number;
  customerName?: string;
  tenantSlug?: string;
  tenantId?: string;
}

/** Binds one Planner customer to one Stamper/EO tenant. customerName is the stable cross-system key. */
export interface CesCustomerBinding {
  /** Planner customer name (matches the on-disk customers/<name> directory). */
  customerName: string;
  /** Planner Dexie customer id, when known. Optional — name is authoritative across systems. */
  customerId?: number;
  /** Stamper/EO directory key (e.g. "contoso"). */
  tenantSlug: string;
  /** Azure tenant GUID, when known. */
  tenantId?: string;
}

export interface CesConfigDefaults {
  /** e.g. 'gcc_high' | 'gcc' | 'commercial'. */
  cloudEnvironment?: string;
}

export interface CesConfig {
  /** Config schema version. */
  version: string;
  /** Optional pipeline-root override. The CES_PIPELINE_ROOT env var still takes precedence. */
  pipelineRoot?: string;
  /** Customer↔tenant bindings. */
  customers: CesCustomerBinding[];
  defaults?: CesConfigDefaults;
}

/** The config used when no file is present: empty bindings, current schema version. */
export const EMPTY_CES_CONFIG: CesConfig = { version: '1.0.0', customers: [] };

/** Env var that points at an explicit CES config file path. */
export const CES_CONFIG_PATH_ENV = 'CES_CONFIG_PATH';

/** Default config filename, resolved under the pipeline root by the node loader. */
export const CES_CONFIG_FILENAME = 'ces.config.json';

export class CesConfigError extends Error {
  constructor(message: string) {
    super(`CES config: ${message}`);
    this.name = 'CesConfigError';
  }
}

/**
 * Validate a parsed object into a CesConfig. Throws CesConfigError on any structural problem,
 * including duplicate tenantSlug or customerName (the bindings must be unambiguous in both
 * directions so the tuple resolves deterministically).
 */
export function validateCesConfig(raw: unknown): CesConfig {
  if (typeof raw !== 'object' || raw === null) {
    throw new CesConfigError('root must be an object');
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.version !== 'string' || obj.version.length === 0) {
    throw new CesConfigError('version must be a non-empty string');
  }
  if (!Array.isArray(obj.customers)) {
    throw new CesConfigError('customers must be an array');
  }

  const customers: CesCustomerBinding[] = obj.customers.map((entry, i) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new CesConfigError(`customers[${i}] must be an object`);
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.customerName !== 'string' || e.customerName.length === 0) {
      throw new CesConfigError(`customers[${i}].customerName must be a non-empty string`);
    }
    if (typeof e.tenantSlug !== 'string' || e.tenantSlug.length === 0) {
      throw new CesConfigError(`customers[${i}].tenantSlug must be a non-empty string`);
    }
    if (e.customerId !== undefined && typeof e.customerId !== 'number') {
      throw new CesConfigError(`customers[${i}].customerId must be a number when present`);
    }
    if (e.tenantId !== undefined && typeof e.tenantId !== 'string') {
      throw new CesConfigError(`customers[${i}].tenantId must be a string when present`);
    }
    return {
      customerName: e.customerName,
      tenantSlug: e.tenantSlug,
      ...(e.customerId !== undefined ? { customerId: e.customerId as number } : {}),
      ...(e.tenantId !== undefined ? { tenantId: e.tenantId as string } : {}),
    };
  });

  assertUnique(customers.map((c) => c.customerName), 'customerName');
  assertUnique(customers.map((c) => c.tenantSlug), 'tenantSlug');

  if (obj.pipelineRoot !== undefined && typeof obj.pipelineRoot !== 'string') {
    throw new CesConfigError('pipelineRoot must be a string when present');
  }

  return {
    version: obj.version,
    customers,
    ...(typeof obj.pipelineRoot === 'string' ? { pipelineRoot: obj.pipelineRoot } : {}),
    ...(obj.defaults && typeof obj.defaults === 'object'
      ? { defaults: obj.defaults as CesConfigDefaults }
      : {}),
  };
}

function assertUnique(values: string[], field: string): void {
  const seen = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) throw new CesConfigError(`duplicate ${field}: "${v}"`);
    seen.add(v);
  }
}

// ─── Resolvers (pure) ────────────────────────────────────────────

export function findBindingByCustomerName(
  config: CesConfig,
  customerName: string,
): CesCustomerBinding | undefined {
  return config.customers.find((c) => c.customerName === customerName);
}

export function findBindingByCustomerId(
  config: CesConfig,
  customerId: number,
): CesCustomerBinding | undefined {
  return config.customers.find((c) => c.customerId === customerId);
}

export function findBindingByTenantSlug(
  config: CesConfig,
  tenantSlug: string,
): CesCustomerBinding | undefined {
  return config.customers.find((c) => c.tenantSlug === tenantSlug);
}

/** Resolve a tenantSlug from a customer key (id preferred, else name). */
export function resolveTenantSlug(
  config: CesConfig,
  key: { customerId?: number; customerName?: string },
): string | undefined {
  if (key.customerId !== undefined) {
    const byId = findBindingByCustomerId(config, key.customerId);
    if (byId) return byId.tenantSlug;
  }
  if (key.customerName !== undefined) {
    return findBindingByCustomerName(config, key.customerName)?.tenantSlug;
  }
  return undefined;
}

/**
 * Resolve a CES identity block for a tenant being processed by a downstream subsystem (EO/AO),
 * using the customer↔tenant binding. Matches by tenantSlug first, else tenantId. Returns the
 * identity recoverable from config (customerName/customerId/tenantSlug/tenantId); cesId/siBaselineId
 * are not in the config map and stay undefined here. Always echoes the input tenantSlug/tenantId.
 */
export function resolveCesIdentity(
  config: CesConfig,
  key: { tenantSlug?: string; tenantId?: string },
): CesIdentity {
  const binding =
    (key.tenantSlug !== undefined ? findBindingByTenantSlug(config, key.tenantSlug) : undefined) ??
    (key.tenantId !== undefined
      ? config.customers.find((c) => c.tenantId === key.tenantId)
      : undefined);
  const identity: CesIdentity = {};
  if (binding) {
    identity.customerName = binding.customerName;
    if (binding.customerId !== undefined) identity.customerId = binding.customerId;
    identity.tenantSlug = binding.tenantSlug;
    if (binding.tenantId !== undefined) identity.tenantId = binding.tenantId;
  }
  if (key.tenantSlug !== undefined) identity.tenantSlug = key.tenantSlug;
  if (key.tenantId !== undefined && identity.tenantId === undefined) identity.tenantId = key.tenantId;
  return identity;
}

/**
 * Pipeline-root precedence: env (CES_PIPELINE_ROOT) → config.pipelineRoot → undefined
 * (callers fall back to their platform default). Pure: env value is passed in.
 */
export function resolvePipelineRoot(
  config: CesConfig,
  envPipelineRoot: string | undefined,
): string | undefined {
  if (envPipelineRoot && envPipelineRoot.length > 0) return envPipelineRoot;
  return config.pipelineRoot;
}
