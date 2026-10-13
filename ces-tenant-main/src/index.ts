// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TENANT-2026A
// See LICENSE and TERMS.md.

/**
 * ces-tenant — TenantManager package. See ../README.md for scope/boundary
 * and ../docs/design.md for the authoritative extraction design doc pointer.
 *
 * M0 shipped the ratified interfaces (every type below is documented at its
 * declaration site with the Stamper/EO/tenant-stacksim/muster-api file:line
 * behavior it codifies, or explicitly marked NEW-SCOPE). M1 adds the
 * concrete implementations under `impl/` (see docs/M1-RECORD.md):
 * `FileTenantRegistry`, `PersistentSessionFactory`, `StacksimEnvironment`,
 * `PlanDataTenantHttpKeyProvider`. `TenantReachProbe` remains a NEW-SCOPE
 * placeholder with no implementation, per the M1 scope fence (design §2.5).
 *
 * Windows/HTTP surface separation (design §7): only `impl/session-factory.ts`
 * and `impl/stacksim.ts` import `node:child_process`; constructing/using the
 * HTTP or registry surfaces never spawns a process.
 */

export type {
  TenantKind,
  TenantEvidenceStorageProfile,
  TenantSubscriptionProfile,
  // CMMC scoping — RATIFIED AMENDMENT (founder, 2026-07-26), GP-SHARED-M0-1.
  AssessmentScope,
  CuiBoundary,
  TenantRegistryRecord,
  TenantRegistryLifecycle,
} from './registry.js';

export type { SessionType, EngineSessionMap, ConnectionProfile, PowerShellSpawnArgs } from './connection.js';

export type {
  AuthStrategyKind,
  CertAuthStrategy,
  ClientSecretAuthStrategy,
  BearerPassthroughAuthStrategy,
  SimAuthStrategy,
  AuthStrategy,
  AuthStrategyResolver,
} from './auth.js';

export type { SessionState, PSResult, TenantSessionFactory, StacksimModeController } from './session-surface.js';

export type { TenantKeys, TenantKeysErrorCode, TenantHttpKeyProvider } from './http-surface.js';

export type { TenantReachResult, TenantReachProbe } from './probe.js';

export type { SimLaunchEnv, TenantLaunchContextProvider } from './launch-context.js';

// ---- Ratified amendment (founder, 2026-07-10): caller identity + status/activity surface ----

export type { ConsumerIdentity } from './consumer.js';

export type {
  TenantActivityEntry,
  TenantActivityInput,
  TenantActivityRecorder,
  TenantActivityFilter,
  TenantConnectionStatusEntry,
  TenantStatusSurface,
} from './status-surface.js';

// ---- M1 implementations ----

export { FileTenantRegistry, type FileTenantRegistryOptions } from './impl/registry.js';

export {
  PersistentSessionFactory,
  type PersistentSessionFactoryOptions,
  type SessionCredentials,
  type SpawnFn,
  type SpawnedProcessLike,
  type SpawnedStdio,
  type SpawnedStdin,
} from './impl/session-factory.js';

export {
  StacksimEnvironment,
  type StacksimEnvironmentOptions,
  DEFAULT_STACKSIM_SERVER_URL,
} from './impl/stacksim.js';

export {
  PlanDataTenantHttpKeyProvider,
  type PlanDataTenantHttpKeyProviderOptions,
  TenantKeysError,
} from './impl/http-provider.js';

export { ENGINE_SESSION_MAP } from './impl/engine-map.js';

export {
  getCesPipelineRoot,
  getRegistryRoot,
  registryRecordPath,
  CES_TENANT_ROOT_ENV,
  CES_PIPELINE_ROOT_ENV,
} from './impl/paths.js';

export { SecretRefError } from './impl/secret-ref.js';

export { InProcessTenantStatus, type SessionStateSource } from './impl/status.js';

// ---- M6: stateful tenant service (v1 auth-state-only) ----
// Daemon: `npm run serve` (user-run only, decision logged in docs/M6-RECORD.md).
// Consumers use connectTenantSurfaces() -- service transport when the daemon
// is up, library transport otherwise (degrade, never block).

export {
  DEFAULT_TENANT_SERVICE_PORT,
  TENANT_SERVICE_URL_ENV,
  TENANT_SERVICE_MODE,
  defaultTenantServiceUrl,
  type WireError,
  type WireActivityEntry,
  type WireSessionState,
  type AuthStateRegistration,
  type AuthStateClaim,
  type AuthStateSummary,
  type ServiceStatusPayload,
  type ServiceStatusTenantRow,
  type TenantModuleActivitySummary,
  type ServiceHealthPayload,
} from './service/protocol.js';

export { TenantServiceDaemon, type TenantServiceDaemonOptions } from './service/server.js';

export { TenantServiceClient, type TenantServiceClientOptions } from './service/client.js';

export {
  connectTenantSurfaces,
  type ConnectTenantSurfacesOptions,
  type TenantSurfaces,
  type TenantTransport,
} from './service/surfaces.js';
