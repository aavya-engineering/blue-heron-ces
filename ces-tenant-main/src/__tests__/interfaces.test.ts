// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TENANT-2026A
// See LICENSE and TERMS.md.

import { describe, it, expect } from 'vitest';
import type { TenantRegistryRecord, TenantKind, TenantRegistryLifecycle } from '../registry.js';
import type { SessionType, ConnectionProfile } from '../connection.js';
import type { AuthStrategy, CertAuthStrategy } from '../auth.js';
import type { TenantSessionFactory, SessionState, PSResult } from '../session-surface.js';
import type { TenantKeys, TenantHttpKeyProvider } from '../http-surface.js';
import type { TenantReachProbe, TenantReachResult } from '../probe.js';
import type { SimLaunchEnv, TenantLaunchContextProvider } from '../launch-context.js';
import type { ConsumerIdentity } from '../consumer.js';
import type {
  TenantActivityEntry,
  TenantActivityRecorder,
  TenantConnectionStatusEntry,
  TenantStatusSurface,
} from '../status-surface.js';

/**
 * M0 has no implementation logic — these are compile-time-only smoke checks
 * that the exported interfaces shape-check against representative literals
 * drawn from the source behavior each interface documents. There is nothing
 * to assert about at runtime beyond "the module loads and the shapes
 * type-check," which `tsc --noEmit` (the real gate) already covers; this
 * suite exists so the package's `npm test` is non-empty and green.
 */
describe('ces-tenant M0 interface shapes', () => {
  it('TenantRegistryRecord accepts a live-tenant literal shaped like current TenantConfig + kind', () => {
    const kind: TenantKind = 'live';
    const record: TenantRegistryRecord = {
      tenantSlug: 'vfsgov',
      tenantId: 'tenant-id',
      appId: 'app-id',
      certPath: '/path/to/cert.pfx',
      certThumbprint: 'THUMBPRINT',
      domain: 'vfsgov.onmicrosoft.us',
      endpoints: { graph: 'https://graph.microsoft.us', login: 'https://login.microsoftonline.us' },
      targetTenantDomain: 'vfsgov.onmicrosoft.us',
      kind,
    };
    expect(record.kind).toBe('live');
  });

  it('SessionType covers the six Stamper/EO session kinds', () => {
    const types: SessionType[] = ['graph', 'exchange', 'purview', 'azure', 'sharepoint', 'teams'];
    expect(types).toHaveLength(6);
  });

  it('ConnectionProfile accepts the current hardcoded GCC High/USGov literals', () => {
    const profile: ConnectionProfile = {
      sessionType: 'graph',
      graphEnvironment: 'USGov',
    };
    expect(profile.graphEnvironment).toBe('USGov');
  });

  it('CertAuthStrategy is assignable to AuthStrategy', () => {
    const strategy: AuthStrategy = {
      kind: 'cert',
      tenantId: 't',
      appId: 'a',
      certThumbprint: 'c',
    } satisfies CertAuthStrategy;
    expect(strategy.kind).toBe('cert');
  });

  it('TenantSessionFactory / TenantHttpKeyProvider / TenantReachProbe are structurally implementable', () => {
    const state: SessionState = { type: 'graph', connected: false, connectedAt: null, lastUsedAt: null, tokenExpiresAt: null };
    const result: PSResult = { stdout: '', stderr: '', exitCode: 0, durationMs: 0 };

    const sessionFactory: TenantSessionFactory = {
      ensureConnected: async () => {},
      execute: async () => result,
      getSessionState: () => state,
      getAllSessionStates: () => [state],
      disconnectAll: async () => {},
      connectMgGraph: async () => {},
      connectIPPS: async () => {},
      buildConnectCommand: () => '',
    };

    const keys: TenantKeys = {
      source: 'env',
      tenantId: 't',
      appId: 'a',
      endpoints: { graph: 'https://graph.microsoft.us', login: 'https://login.microsoftonline.us' },
    };
    const httpProvider: TenantHttpKeyProvider = {
      // Async since the ratified 2026-07-11 amendment.
      resolveTenantKeys: async () => keys,
    };

    const reachResult: TenantReachResult = { reachable: true, kind: 'sim' };
    const probe: TenantReachProbe = {
      probeReach: async () => reachResult,
    };

    expect(typeof sessionFactory.buildConnectCommand).toBe('function');
    expect(typeof httpProvider.resolveTenantKeys).toBe('function');
    expect(typeof probe.probeReach).toBe('function');
  });

  it('ces-tester interfaces (TenantRegistryLifecycle, probeSimReady, TenantLaunchContextProvider) are structurally implementable', () => {
    const record: TenantRegistryRecord = {
      tenantSlug: 'sim-scenario-1',
      tenantId: 'sim-tenant-sim-scenario-1',
      appId: 'sim-app-sim-scenario-1',
      certPath: 'sim/sim-scenario-1.pfx',
      certThumbprint: 'SIMTHUMBPRINT0000000000000000000000000',
      domain: 'sim-scenario-1.simtenant.onmicrosoft.us',
      endpoints: { graph: 'http://localhost:4390/graph', login: 'http://localhost:4390/login' },
      kind: 'sim',
    };

    const lifecycle: TenantRegistryLifecycle = {
      createEphemeralSimTenant: async () => record,
      teardownEphemeralSimTenant: async () => {},
      get: async () => record,
      listByKind: async (kind: TenantKind) => (kind === 'sim' ? [record] : []),
    };

    const probeWithSimReady: TenantReachProbe = {
      probeReach: async () => ({ reachable: true, kind: 'sim' } satisfies TenantReachResult),
      probeSimReady: async () => ({ reachable: true, kind: 'sim' } satisfies TenantReachResult),
    };

    const launchEnv: SimLaunchEnv = {
      psModulePath: 'C:/tenant-stacksim/psmodules;C:/PowerShell/Modules',
      path: 'C:/tenant-stacksim/azshim;C:/existing/path',
      stacksimServerUrl: 'http://127.0.0.1:4390',
    };
    const launchContextProvider: TenantLaunchContextProvider = {
      getSimLaunchEnv: async () => launchEnv,
    };

    expect(typeof lifecycle.createEphemeralSimTenant).toBe('function');
    expect(typeof lifecycle.teardownEphemeralSimTenant).toBe('function');
    expect(typeof lifecycle.listByKind).toBe('function');
    expect(typeof probeWithSimReady.probeSimReady).toBe('function');
    expect(typeof launchContextProvider.getSimLaunchEnv).toBe('function');
  });

  // ---- Ratified amendment (founder, 2026-07-10): caller identity + status surface ----

  it('ConsumerIdentity carries { module, purpose } and every amended request surface accepts it', async () => {
    const consumer: ConsumerIdentity = { module: 'ces-stamper', purpose: 'translate run' };
    const state: SessionState = { type: 'graph', connected: false, connectedAt: null, lastUsedAt: null, tokenExpiresAt: null };
    const result: PSResult = { stdout: '', stderr: '', exitCode: 0, durationMs: 0 };
    const keys: TenantKeys = {
      source: 'env',
      tenantId: 't',
      appId: 'a',
      endpoints: { graph: 'https://graph.microsoft.us', login: 'https://login.microsoftonline.us' },
    };
    const launchEnv: SimLaunchEnv = { psModulePath: 'a', path: 'b', stacksimServerUrl: 'c' };

    // Compile-time contract: the amended signatures accept the trailing consumer param.
    const sessionFactory: TenantSessionFactory = {
      ensureConnected: async (_type, _consumer?: ConsumerIdentity) => {},
      execute: async (_type, _command, _onStdout?, _consumer?: ConsumerIdentity) => result,
      getSessionState: () => state,
      getAllSessionStates: () => [state],
      disconnectAll: async () => {},
      connectMgGraph: async (_t?, _a?, _c?, _consumer?: ConsumerIdentity) => {},
      connectIPPS: async (_t?, _a?, _c?, _consumer?: ConsumerIdentity) => {},
      buildConnectCommand: () => '',
    };
    const httpProvider: TenantHttpKeyProvider = {
      resolveTenantKeys: async (_slug, _consumer?: ConsumerIdentity) => keys,
    };
    const launchProvider: TenantLaunchContextProvider = {
      getSimLaunchEnv: async (_slug, _kind, _consumer?: ConsumerIdentity) => launchEnv,
    };

    await sessionFactory.ensureConnected('graph', consumer);
    await sessionFactory.execute('graph', 'Get-MgUser', undefined, consumer);
    await httpProvider.resolveTenantKeys('acme', consumer);
    await launchProvider.getSimLaunchEnv('sim1', 'sim', consumer);
    expect(consumer.module).toBe('ces-stamper');
  });

  it('TenantStatusSurface / TenantActivityRecorder (status + append-only activity read surface) are structurally implementable', async () => {
    const entry: TenantActivityEntry = {
      at: new Date(),
      consumer: { module: 'ces-eo', purpose: 'assessment' },
      operation: 'execute',
      tenantSlug: 'acme',
      sessionType: 'graph',
      outcome: 'ok',
    };
    const noIdentityEntry: TenantActivityEntry = {
      at: new Date(),
      consumer: null, // library mode: logged, recorded as null; service mode: rejected
      operation: 'resolveTenantKeys',
      outcome: 'error',
      detail: 'tenant_not_found',
    };
    const statusRow: TenantConnectionStatusEntry = {
      tenantSlug: 'acme',
      kind: 'live',
      sessions: [{ type: 'graph', connected: true, connectedAt: new Date(), lastUsedAt: null, tokenExpiresAt: null }],
      lastActivityAt: new Date(),
    };

    const recorder: TenantActivityRecorder = {
      recordActivity: () => {},
    };
    const surface: TenantStatusSurface = {
      getConnectionStatus: async () => [statusRow],
      getActivity: async (filter) =>
        [entry, noIdentityEntry].filter((e) => filter?.module === undefined || e.consumer?.module === filter.module),
    };

    recorder.recordActivity({ consumer: entry.consumer, operation: entry.operation, outcome: 'ok' });
    expect(await surface.getConnectionStatus()).toHaveLength(1);
    expect(await surface.getActivity({ module: 'ces-eo' })).toHaveLength(1);
    expect(await surface.getActivity()).toHaveLength(2);
  });
});
