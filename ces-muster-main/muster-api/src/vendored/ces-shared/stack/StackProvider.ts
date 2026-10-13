// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// G4 — stack-provider seam. FE-safe contract (pure types + validation + registry; zero node:* imports).
//
// CES is built around the Microsoft / Azure GCC High stack today. This seam makes the system
// multi-stack CAPABLE: every stack-specific *selection* (cloud endpoints, which control-signal
// registry / evaluator set / vendor playbook / tech-stack map / SSP narrative source to use, and
// infra/identity conventions) is resolved through ONE provider keyed by a stack id. Microsoft is
// the reference provider; other stacks register by supplying the same capability contract.
//
// "Capability, not content": a provider declares WHICH assets it uses (by id/endpoint/convention),
// not the assets' authored domain content. See docs/adr/ADR-003-stack-provider-seam.md.

export type StackId = string;

/** Cloud service endpoints for a stack's APIs (Microsoft GCC High differs from commercial, etc.). */
export interface StackCloudEndpoints {
  graph: string;
  login: string;
  exchange?: string;
  arm?: string;
  compliance?: string;
}

/** Infra/identity conventions a stack assumes (naming, default region, identity model). */
export interface StackConventions {
  /** e.g. 'gcc_high' | 'gcc' | 'commercial'. */
  cloudEnvironment: string;
  /** Default deployment region, e.g. 'usgovvirginia'. */
  defaultLocation: string;
  /** Identity platform, e.g. 'entra-id'. */
  identityModel: string;
  /** Infrastructure-model variants this stack supports (reuses the existing G1/G2 selector). */
  infrastructureModels: string[];
}

/**
 * The capability contract a stack MUST supply to be registered (DONE-WHEN #3). All values are
 * references/metadata (ids, endpoints, conventions) — the stack's actual domain content lives behind
 * those ids and is authored separately (capability, not content).
 */
export interface StackCapabilities {
  id: StackId;
  displayName: string;
  cloudEndpoints: StackCloudEndpoints;
  /** Id of the control→signal registry this stack uses (resolved to data by the subsystem). */
  controlSignalRegistryId: string;
  /** Id of the evaluator set this stack uses. */
  evaluatorSetId: string;
  /** Id of the vendor playbook this stack uses. */
  vendorPlaybookId: string;
  /** Id of the tech-stack→control mapping this stack uses. */
  techStackMapId: string;
  /** Id of the SSP narrative-source strategy this stack uses. */
  sspNarrativeSourceId: string;
  conventions: StackConventions;
}

/** A registered stack = its capabilities. (Subsystems bind behavior by the capability ids above.) */
export interface StackProvider {
  capabilities: StackCapabilities;
}

export class StackCapabilityError extends Error {
  constructor(message: string) {
    super(`stack capability: ${message}`);
    this.name = 'StackCapabilityError';
  }
}

/** Validate a declared capability object. Throws StackCapabilityError listing what's missing. */
export function validateStackCapabilities(raw: unknown): StackCapabilities {
  if (typeof raw !== 'object' || raw === null) {
    throw new StackCapabilityError('capabilities must be an object');
  }
  const c = raw as Record<string, unknown>;
  const missing: string[] = [];
  const str = (k: string) => {
    if (typeof c[k] !== 'string' || (c[k] as string).length === 0) missing.push(k);
  };
  str('id');
  str('displayName');
  str('controlSignalRegistryId');
  str('evaluatorSetId');
  str('vendorPlaybookId');
  str('techStackMapId');
  str('sspNarrativeSourceId');

  const endpoints = c.cloudEndpoints as Record<string, unknown> | undefined;
  if (!endpoints || typeof endpoints !== 'object') missing.push('cloudEndpoints');
  else {
    if (typeof endpoints.graph !== 'string' || !endpoints.graph) missing.push('cloudEndpoints.graph');
    if (typeof endpoints.login !== 'string' || !endpoints.login) missing.push('cloudEndpoints.login');
  }

  const conv = c.conventions as Record<string, unknown> | undefined;
  if (!conv || typeof conv !== 'object') missing.push('conventions');
  else {
    if (typeof conv.cloudEnvironment !== 'string' || !conv.cloudEnvironment) missing.push('conventions.cloudEnvironment');
    if (typeof conv.defaultLocation !== 'string' || !conv.defaultLocation) missing.push('conventions.defaultLocation');
    if (typeof conv.identityModel !== 'string' || !conv.identityModel) missing.push('conventions.identityModel');
    if (!Array.isArray(conv.infrastructureModels)) missing.push('conventions.infrastructureModels');
  }

  if (missing.length > 0) {
    throw new StackCapabilityError(`missing/invalid required field(s): ${missing.join(', ')}`);
  }
  return raw as StackCapabilities;
}

/** A registry of stack providers keyed by stack id. */
export class StackRegistry {
  private providers = new Map<StackId, StackProvider>();

  /** Register a provider (validates its capabilities first). Last registration for an id wins. */
  register(provider: StackProvider): void {
    validateStackCapabilities(provider.capabilities);
    this.providers.set(provider.capabilities.id, provider);
  }

  has(id: StackId): boolean {
    return this.providers.has(id);
  }

  get(id: StackId): StackProvider {
    const p = this.providers.get(id);
    if (!p) {
      throw new StackCapabilityError(`no provider registered for stack "${id}" (registered: ${this.ids().join(', ') || 'none'})`);
    }
    return p;
  }

  ids(): StackId[] {
    return [...this.providers.keys()];
  }
}

/** The reference stack id. Used as the default so existing (Microsoft-only) deployments are unchanged. */
export const DEFAULT_STACK_ID = 'microsoft-gcc-high';

/**
 * Resolve the active stack id from existing config (reuses the TenantConfig seam that already
 * carries infrastructure_model — does NOT introduce a parallel selector). Absent → Microsoft.
 */
export function resolveStackId(config: { stack?: string } | undefined): StackId {
  const s = config?.stack;
  return typeof s === 'string' && s.length > 0 ? s : DEFAULT_STACK_ID;
}
