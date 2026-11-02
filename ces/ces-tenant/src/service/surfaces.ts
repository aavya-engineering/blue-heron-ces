// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TENANT-2026A
// See LICENSE and TERMS.md.

/**
 * Transport selection -- the config/discovery step of M6 design
 * requirement 1 ("consumers do not code against 'the daemon' -- they code
 * against TenantManager; a config/discovery step selects in-process vs
 * service transport") and the DEGRADE-NEVER-BLOCK guarantee of
 * requirement 2 / acceptance gate 3: if the service is down, every surface
 * comes back library-backed and the module works exactly as it does today,
 * with no code change at the call sites.
 */

import type { ConsumerIdentity } from '../consumer.js';
import type { TenantKeys } from '../http-surface.js';
import type { TenantLaunchContextProvider } from '../launch-context.js';
import type { TenantRegistryLifecycle } from '../registry.js';
import type { TenantActivityRecorder, TenantStatusSurface } from '../status-surface.js';

import { FileTenantRegistry, type FileTenantRegistryOptions } from '../impl/registry.js';
import { PlanDataTenantHttpKeyProvider, type PlanDataTenantHttpKeyProviderOptions } from '../impl/http-provider.js';
import { StacksimEnvironment, type StacksimEnvironmentOptions } from '../impl/stacksim.js';
import { InProcessTenantStatus } from '../impl/status.js';

import { TenantServiceClient } from './client.js';
import { defaultTenantServiceUrl } from './protocol.js';

export type TenantTransport = 'service' | 'library';

/** The one bundle consumers hold; identical call sites in both transports. */
export interface TenantSurfaces {
  transport: TenantTransport;
  registry: TenantRegistryLifecycle;
  launch: TenantLaunchContextProvider;
  status: TenantStatusSurface;
  activity: TenantActivityRecorder;
  /** The ratified `TenantHttpKeyProvider` surface (async since the 2026-07-11 amendment); library transport resolves in-process. */
  resolveTenantKeys(slug: string | undefined): Promise<TenantKeys>;
  /** Present only on the service transport: the auth-state register/claim surface (v1 auth-state-only daemon). */
  service?: TenantServiceClient;
}

export interface ConnectTenantSurfacesOptions {
  /** REQUIRED everywhere (amendment invariant): rejected by the service, warned by the library. */
  consumer: ConsumerIdentity;
  /** Service base URL. Default: `CES_TENANT_SERVICE_URL` env, else `http://127.0.0.1:4690`. */
  serviceUrl?: string;
  /** Set false to force the library transport without probing. Default true. */
  preferService?: boolean;
  env?: NodeJS.ProcessEnv;
  fetchFn?: typeof fetch;
  healthTimeoutMs?: number;
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;
  /** Library-transport construction options (also used as the fallback when the service is down). */
  library?: {
    registry?: FileTenantRegistryOptions;
    keys?: PlanDataTenantHttpKeyProviderOptions;
    stacksim?: StacksimEnvironmentOptions;
  };
}

/**
 * Probe the service; hand back service-backed surfaces when it is up,
 * library-backed surfaces otherwise. One call site, two transports, zero
 * consumer rework when flipping (or when the daemon dies).
 */
export async function connectTenantSurfaces(options: ConnectTenantSurfacesOptions): Promise<TenantSurfaces> {
  const env = options.env ?? process.env;
  const logger = options.logger ?? console;

  if (options.preferService !== false) {
    const client = new TenantServiceClient({
      consumer: options.consumer,
      baseUrl: options.serviceUrl ?? defaultTenantServiceUrl(env),
      env,
      ...(options.fetchFn ? { fetchFn: options.fetchFn } : {}),
      ...(options.healthTimeoutMs !== undefined ? { healthTimeoutMs: options.healthTimeoutMs } : {}),
      logger,
    });
    if (await client.isUp()) {
      return {
        transport: 'service',
        registry: client,
        launch: client,
        status: client,
        activity: client,
        resolveTenantKeys: (slug) => client.resolveTenantKeys(slug),
        service: client,
      };
    }
    logger.log('[ces-tenant] tenant service not reachable -- using library transport (degrade, never block)');
  }

  // Library transport: the M1 in-process implementations, wired to one
  // own-process status ledger, consumer identity bound at construction.
  const status = new InProcessTenantStatus();
  const registry = new FileTenantRegistry({ env, ...options.library?.registry });
  const keys = new PlanDataTenantHttpKeyProvider({
    env,
    consumer: options.consumer,
    activity: status,
    logger,
    ...options.library?.keys,
  });
  const launch = new StacksimEnvironment({
    env,
    registry,
    consumer: options.consumer,
    activity: status,
    logger,
    ...options.library?.stacksim,
  });

  return {
    transport: 'library',
    registry,
    launch,
    status,
    activity: status,
    resolveTenantKeys: async (slug) => keys.resolveTenantKeys(slug, options.consumer),
  };
}
