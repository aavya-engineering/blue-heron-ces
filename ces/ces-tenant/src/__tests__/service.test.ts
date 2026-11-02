// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TENANT-2026A
// See LICENSE and TERMS.md.

/**
 * G-TENANT-M6 acceptance gates (v1 auth-state-only, resolution 2026-07-11),
 * against a REAL daemon bound to an ephemeral 127.0.0.1 port:
 *
 *   Gate 1 -- the same contract suite runs against BOTH transports
 *            (library in-process, service over HTTP).
 *   Gate 2 -- two modules, ONE interactive auth event (register + claim).
 *   Gate 3 -- daemon down: connect succeeds via library fallback, no code
 *            change at the call site.
 *   Gate 4 -- per-module/per-service ledger for a scripted two-module run;
 *            ledger append-only; no credential material in any API response.
 *   Gate 5 -- status view renders the tenant x service x module matrix for
 *            one live-kind and one sim-kind tenant.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TenantKeysError } from '../impl/http-provider.js';
import { TenantServiceClient } from '../service/client.js';
import { TenantServiceDaemon } from '../service/server.js';
import { connectTenantSurfaces } from '../service/surfaces.js';
import type { TenantKeys } from '../http-surface.js';
import type { SimLaunchEnv, TenantLaunchContextProvider } from '../launch-context.js';
import type { TenantKind, TenantRegistryLifecycle } from '../registry.js';

const quietLogger = { log: () => {}, warn: () => {}, error: () => {} };
const FAKE_PSHOME_MODULES = path.join('C:', 'FakePS', 'Modules');

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8');
}

function rawTenant(slug: string, overrides: Record<string, any> = {}): Record<string, any> {
  return {
    client: { slug },
    tenant: { tenant_id: `tid-${slug}`, domain: `${slug}.onmicrosoft.us` },
    auth: { app_id: `app-${slug}`, cert_path: `certs/${slug}.pfx`, cert_thumbprint: `THUMB-${slug}` },
    endpoints: {},
    ...overrides,
  };
}

interface TestBed {
  registryRoot: string;
  cesPipelineRoot: string;
  homeDir: string;
  stacksimRoot: string;
  env: NodeJS.ProcessEnv;
}

function makeBed(): TestBed {
  const stacksimRoot = tempDir('ces-tsvc-sim-');
  fs.mkdirSync(path.join(stacksimRoot, 'psmodules', 'Microsoft.Graph.Authentication'), { recursive: true });
  fs.mkdirSync(path.join(stacksimRoot, 'azshim'), { recursive: true });
  return {
    registryRoot: tempDir('ces-tsvc-reg-'),
    cesPipelineRoot: tempDir('ces-tsvc-pipe-'),
    homeDir: tempDir('ces-tsvc-home-'),
    stacksimRoot,
    env: { GRAPH_TENANT_ID: 'env-tid', GRAPH_CLIENT_ID: 'env-app' },
  };
}

async function startDaemon(bed: TestBed): Promise<{ daemon: TenantServiceDaemon; baseUrl: string; port: number }> {
  const daemon = new TenantServiceDaemon({
    port: 0,
    env: bed.env,
    registryOptions: { registryRoot: bed.registryRoot, cesPipelineRoot: bed.cesPipelineRoot, homeDir: bed.homeDir, env: bed.env },
    keysOptions: { cesPipelineRoot: bed.cesPipelineRoot, homeDir: bed.homeDir, env: bed.env },
    launchOptions: {
      stacksimRoot: bed.stacksimRoot,
      env: bed.env,
      queryPsHomeModules: () => Promise.resolve(FAKE_PSHOME_MODULES),
      fetchFn: (() => Promise.resolve({ ok: true } as Response)) as typeof fetch,
    },
    logger: quietLogger,
  });
  const port = await daemon.start();
  cleanups.push(() => daemon.stop());
  return { daemon, baseUrl: `http://127.0.0.1:${port}`, port };
}

function makeClient(baseUrl: string, module: string, purpose = 'gate test'): TenantServiceClient {
  return new TenantServiceClient({ consumer: { module, purpose }, baseUrl, logger: quietLogger, healthTimeoutMs: 500 });
}

// ---------------------------------------------------------------------------
// Gate 1 -- same contract suite, both transports.
// ---------------------------------------------------------------------------

interface ContractSurfaces {
  registry: TenantRegistryLifecycle;
  launch: TenantLaunchContextProvider;
  resolveTenantKeys(slug: string | undefined): Promise<TenantKeys>;
}

function contractSuite(transport: string, make: () => Promise<{ surfaces: ContractSurfaces; bed: TestBed }>): void {
  describe(`TenantManager contract via ${transport} transport (gate 1)`, () => {
    it('sim tenant lifecycle: create, get, listByKind, teardown leaves no residue', async () => {
      const { surfaces } = await make();
      const created = await surfaces.registry.createEphemeralSimTenant('eph-contract', { scenario: 's1' });
      expect(created.kind).toBe('sim');
      expect(created.tenantId).toBe('sim-tenant-eph-contract');

      const fetched = await surfaces.registry.get('eph-contract');
      expect(fetched?.kind).toBe('sim');
      expect((await surfaces.registry.listByKind('sim')).map((r) => r.tenantSlug)).toContain('eph-contract');

      await surfaces.registry.teardownEphemeralSimTenant('eph-contract');
      expect(await surfaces.registry.get('eph-contract')).toBeUndefined();
      expect((await surfaces.registry.listByKind('sim')).map((r) => r.tenantSlug)).not.toContain('eph-contract');
    });

    it('token resolution: plan-data slug, endpoint fallback, tenant_not_found code, env fallback', async () => {
      const { surfaces, bed } = await make();
      writeJson(
        path.join(bed.cesPipelineRoot, 'Stamper', 'plan-data', 'acme', 'acme.json'),
        rawTenant('acme', { endpoints: { graph: 'https://graph.custom.us' } }),
      );

      const keys = await surfaces.resolveTenantKeys('acme');
      expect(keys.source).toBe('tenant-config');
      expect(keys.tenantId).toBe('tid-acme');
      expect(keys.endpoints.graph).toBe('https://graph.custom.us');
      expect(keys.endpoints.login).toBe('https://login.microsoftonline.us');

      await expect(surfaces.resolveTenantKeys('ghost')).rejects.toMatchObject({
        name: 'TenantKeysError',
        code: 'tenant_not_found',
      });

      const envKeys = await surfaces.resolveTenantKeys(undefined);
      expect(envKeys.source).toBe('env');
      expect(envKeys.tenantId).toBe('env-tid');
    });

    it('launch context: sim bundle for a sim tenant, refusal for kind live', async () => {
      const { surfaces, bed } = await make();
      await surfaces.registry.createEphemeralSimTenant('eph-launch', null);

      const bundle: SimLaunchEnv = await surfaces.launch.getSimLaunchEnv('eph-launch', 'sim');
      expect(bundle.psModulePath).toBe(`${path.join(bed.stacksimRoot, 'psmodules')};${FAKE_PSHOME_MODULES}`);
      expect(bundle.path.startsWith(`${path.join(bed.stacksimRoot, 'azshim')};`)).toBe(true);
      expect(bundle.stacksimServerUrl).toBeTruthy();

      await expect(surfaces.launch.getSimLaunchEnv('eph-launch', 'live')).rejects.toThrow();
    });
  });
}

contractSuite('library', async () => {
  const bed = makeBed();
  const surfaces = await connectTenantSurfaces({
    consumer: { module: 'contract-lib', purpose: 'gate 1' },
    preferService: false,
    env: bed.env,
    logger: quietLogger,
    library: {
      registry: { registryRoot: bed.registryRoot, cesPipelineRoot: bed.cesPipelineRoot, homeDir: bed.homeDir, env: bed.env },
      keys: { cesPipelineRoot: bed.cesPipelineRoot, homeDir: bed.homeDir, env: bed.env },
      stacksim: {
        stacksimRoot: bed.stacksimRoot,
        env: bed.env,
        queryPsHomeModules: () => Promise.resolve(FAKE_PSHOME_MODULES),
        fetchFn: (() => Promise.resolve({ ok: true } as Response)) as typeof fetch,
      },
    },
  });
  expect(surfaces.transport).toBe('library');
  return { surfaces, bed };
});

contractSuite('service', async () => {
  const bed = makeBed();
  const { baseUrl } = await startDaemon(bed);
  const surfaces = await connectTenantSurfaces({
    consumer: { module: 'contract-svc', purpose: 'gate 1' },
    serviceUrl: baseUrl,
    env: bed.env,
    logger: quietLogger,
  });
  expect(surfaces.transport).toBe('service');
  return { surfaces, bed };
});

// ---------------------------------------------------------------------------
// Gate 2 -- auto-connect: one interactive auth event across two modules.
// ---------------------------------------------------------------------------

describe('auth-state auto-connect (gate 2)', () => {
  it('two modules share one tenant connection with exactly ONE interactive auth event', async () => {
    const bed = makeBed();
    const { baseUrl } = await startDaemon(bed);
    const moduleA = makeClient(baseUrl, 'ces-muster', 'discovery scan');
    const moduleB = makeClient(baseUrl, 'ces-stamper', 'translate run');

    // The interactive ceremony (device-code/MFA once it exists; counted spy here).
    let interactiveAuthEvents = 0;
    const interactiveSignIn = vi.fn(() => {
      interactiveAuthEvents++;
      return { token: 'SUPERSECRET-BEARER-XYZ', expiresAt: new Date(Date.now() + 3600_000).toISOString() };
    });

    // Module A signs in once and registers the auth state with the daemon.
    const signIn = interactiveSignIn();
    await moduleA.registerAuthState({
      tenantSlug: 'acme',
      strategyKind: 'bearer',
      bearerToken: signIn.token,
      expiresAt: signIn.expiresAt,
    });

    // Module B claims -- NO second interactive event.
    const claim = await moduleB.claimAuthState('acme');
    expect(claim?.bearerToken).toBe('SUPERSECRET-BEARER-XYZ');
    expect(claim?.strategyKind).toBe('bearer');
    expect(claim?.registeredBy.module).toBe('ces-muster');
    expect(interactiveAuthEvents).toBe(1);
    expect(interactiveSignIn).toHaveBeenCalledTimes(1);
  });

  it('claims respect scope and expiry: exact session scope wins; expired state is never handed out', async () => {
    const bed = makeBed();
    const { baseUrl } = await startDaemon(bed);
    const client = makeClient(baseUrl, 'ces-tester');

    await client.registerAuthState({ tenantSlug: 't1', strategyKind: 'cert' });
    await client.registerAuthState({ tenantSlug: 't1', strategyKind: 'bearer', sessionType: 'graph', bearerToken: 'G-TOK' });
    expect((await client.claimAuthState('t1', 'graph'))?.bearerToken).toBe('G-TOK');
    expect((await client.claimAuthState('t1', 'exchange'))?.strategyKind).toBe('cert'); // tenant-wide fallback

    await client.registerAuthState({
      tenantSlug: 'gone',
      strategyKind: 'bearer',
      bearerToken: 'EXPIRED',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(await client.claimAuthState('gone')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Gate 3 -- kill the daemon: library fallback, same call site.
// ---------------------------------------------------------------------------

describe('degrade never block (gate 3)', () => {
  it('with the service down, the SAME connect call falls back to the library transport and works', async () => {
    const bed = makeBed();
    writeJson(path.join(bed.cesPipelineRoot, 'Stamper', 'plan-data', 'acme', 'acme.json'), rawTenant('acme'));

    const { daemon, baseUrl } = await startDaemon(bed);
    const connectOptions = {
      consumer: { module: 'ces-eo', purpose: 'assessment' },
      serviceUrl: baseUrl,
      env: bed.env,
      healthTimeoutMs: 300,
      logger: quietLogger,
      library: {
        registry: { registryRoot: bed.registryRoot, cesPipelineRoot: bed.cesPipelineRoot, homeDir: bed.homeDir, env: bed.env },
        keys: { cesPipelineRoot: bed.cesPipelineRoot, homeDir: bed.homeDir, env: bed.env },
        stacksim: {
          stacksimRoot: bed.stacksimRoot,
          env: bed.env,
          queryPsHomeModules: () => Promise.resolve(FAKE_PSHOME_MODULES),
          fetchFn: (() => Promise.resolve({ ok: true } as Response)) as typeof fetch,
        },
      },
    };

    const up = await connectTenantSurfaces(connectOptions);
    expect(up.transport).toBe('service');
    expect((await up.resolveTenantKeys('acme')).tenantId).toBe('tid-acme');

    await daemon.stop(); // kill the daemon

    const down = await connectTenantSurfaces(connectOptions); // same call, no code change
    expect(down.transport).toBe('library');
    expect((await down.resolveTenantKeys('acme')).tenantId).toBe('tid-acme');
    expect((await down.registry.get('acme'))?.kind).toBe('live');
  });
});

// ---------------------------------------------------------------------------
// Gate 4 -- ledger dimensions, append-only, no credential material.
// ---------------------------------------------------------------------------

describe('activity ledger (gate 4)', () => {
  it('a scripted two-module run yields per-module, per-service entries; ledger is append-only; responses carry no credential material', async () => {
    const bed = makeBed();
    const { baseUrl } = await startDaemon(bed);
    const moduleA = makeClient(baseUrl, 'ces-muster', 'discovery');
    const moduleB = makeClient(baseUrl, 'ces-tester', 'scenario run');

    // Seed a live tenant whose evidence_storage carries secret material --
    // it must never cross the service boundary.
    writeJson(
      path.join(bed.cesPipelineRoot, 'Stamper', 'plan-data', 'acme', 'acme.json'),
      rawTenant('acme', {
        evidence_storage: {
          account_name: 'acct',
          account_key: 'SECRET-ACCOUNT-KEY-123',
          container: 'c',
          base_path: 'p',
          blob_endpoint: 'https://blob',
        },
      }),
    );

    // Scripted run: module A resolves keys + self-reports an engine command;
    // module B creates a sim tenant, registers+claims auth, gets launch env.
    await moduleA.resolveTenantKeys('acme');
    moduleA.recordActivity({ consumer: null, operation: 'execute', tenantSlug: 'acme', sessionType: 'graph', outcome: 'ok', detail: 'Get-MgUser -All' });
    await moduleA.flushActivity();

    await moduleB.createEphemeralSimTenant('eph-run', { scenario: 'baseline' });
    await moduleB.registerAuthState({ tenantSlug: 'eph-run', strategyKind: 'sim', bearerToken: 'SIM-TOKEN-SHHH' });
    await moduleB.claimAuthState('eph-run');
    await moduleB.getSimLaunchEnv('eph-run', 'sim');

    // Per-module attribution.
    const aEntries = await moduleA.getActivity({ module: 'ces-muster' });
    expect(aEntries.map((e) => e.operation)).toEqual(['resolveTenantKeys', 'execute']);
    // Per-service dimension present on the self-reported engine entry.
    expect(aEntries[1].sessionType).toBe('graph');

    const bEntries = await moduleB.getActivity({ module: 'ces-tester' });
    expect(bEntries.map((e) => e.operation)).toEqual(
      expect.arrayContaining(['createEphemeralSimTenant', 'registerAuthState', 'claimAuthState', 'getSimLaunchEnv']),
    );

    // Append-only: no update/delete verbs on the ledger.
    for (const method of ['DELETE', 'PUT', 'PATCH']) {
      const res = await fetch(`${baseUrl}/api/activity`, { method });
      expect(res.status).toBe(405);
      expect((await res.json()).code).toBe('append_only');
    }

    // Service-mode invariant: unattributed requests are rejected.
    const noConsumer = await fetch(`${baseUrl}/api/keys`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'acme' }),
    });
    expect(noConsumer.status).toBe(400);
    expect((await noConsumer.json()).code).toBe('consumer_required');

    // No credential material in ANY read/API response (grep-able assertion).
    const bodies: string[] = [];
    for (const p of ['/api/status', '/status', '/api/activity', '/api/tenants/acme', '/api/tenants?kind=sim']) {
      bodies.push(await (await fetch(`${baseUrl}${p}`)).text());
    }
    const all = bodies.join('\n');
    expect(all).not.toContain('SECRET-ACCOUNT-KEY-123'); // evidenceStorage stripped
    expect(all).not.toContain('SIM-TOKEN-SHHH'); // token summarized as holdsToken
    expect(all).toContain('holdsToken');
  });
});

// ---------------------------------------------------------------------------
// Gate 5 -- status view: tenant x service x module matrix, live + sim.
// ---------------------------------------------------------------------------

describe('status view (gate 5)', () => {
  it('renders the matrix for one live-kind and one sim-kind tenant, by module and connection service', async () => {
    const bed = makeBed();
    const { baseUrl } = await startDaemon(bed);
    const muster = makeClient(baseUrl, 'ces-muster', 'discovery');
    const tester = makeClient(baseUrl, 'ces-tester', 'scenario run');

    writeJson(path.join(bed.cesPipelineRoot, 'Stamper', 'plan-data', 'liveco', 'liveco.json'), rawTenant('liveco'));
    await muster.get('liveco'); // registry read migrates + stamps kind: live
    await muster.resolveTenantKeys('liveco');
    muster.recordActivity({ consumer: null, operation: 'execute', tenantSlug: 'liveco', sessionType: 'exchange', outcome: 'ok' });
    await muster.flushActivity();
    await muster.registerAuthState({ tenantSlug: 'liveco', strategyKind: 'cert' });

    await tester.createEphemeralSimTenant('simco', null);
    await tester.registerAuthState({ tenantSlug: 'simco', strategyKind: 'sim', sessionType: 'graph' });

    // JSON matrix.
    const status = await muster.getStatus();
    expect(status.mode).toBe('auth-state-only');
    expect(status.activitySource).toBe('self-reported');
    const live = status.tenants.find((t) => t.tenantSlug === 'liveco');
    const sim = status.tenants.find((t) => t.tenantSlug === 'simco');
    expect(live?.kind).toBe('live');
    expect(sim?.kind).toBe('sim');
    expect(live?.authState[0]).toMatchObject({ strategyKind: 'cert', holdsToken: false });
    expect(live?.modules.map((m) => m.module)).toContain('ces-muster');
    expect(sim?.modules.map((m) => m.module)).toContain('ces-tester');

    // HTML matrix.
    const html = await (await fetch(`${baseUrl}/status`)).text();
    expect(html).toContain('liveco');
    expect(html).toContain('simco');
    expect(html).toContain('kind-live');
    expect(html).toContain('kind-sim');
    expect(html).toContain('ces-muster');
    expect(html).toContain('ces-tester');
    expect(html).toContain('self-reported');
  });
});

// ---------------------------------------------------------------------------
// CMMC scoping fields cross the service boundary (GP-SHARED-M0-1 amendment,
// 2026-07-26): wire records carry them; evidenceStorage stays stripped.
// ---------------------------------------------------------------------------

describe('CMMC fields over the service transport (GP-SHARED-M0-1)', () => {
  it('GET /api/tenants/:slug and ?kind= carry cmmc fields; redaction unchanged', async () => {
    const bed = makeBed();
    writeJson(path.join(bed.registryRoot, 'live', 'cmmcco.json'), {
      ...rawTenant('cmmcco', {
        cmmc_level: 'L2',
        assessment_scope: { ous: ['OU=CUI'] },
        cui_boundary: { tag_key: 'cui', tag_value: 'true' },
        cmmc_migration_exempt: false,
        evidence_storage: {
          account_name: 'acct',
          account_key: 'SECRET-ACCOUNT-KEY-123',
          container: 'c',
          base_path: 'b',
          blob_endpoint: 'https://blob.local',
        },
      }),
      kind: 'live',
    });
    const { baseUrl } = await startDaemon(bed);

    const single = await (await fetch(`${baseUrl}/api/tenants/cmmcco`)).json();
    expect(single.cmmcLevel).toBe('L2');
    expect(single.assessmentScope).toEqual({ ous: ['OU=CUI'] });
    expect(single.cuiBoundary).toEqual({ tagKey: 'cui', tagValue: 'true' });
    expect(single.cmmcMigrationExempt).toBe(false);
    expect(single.evidenceStorage).toBeUndefined();

    const list = await (await fetch(`${baseUrl}/api/tenants?kind=live`)).json();
    const row = list.find((r: any) => r.tenantSlug === 'cmmcco');
    expect(row?.kind).toBe('live');
    expect(row?.cmmcLevel).toBe('L2');
    expect(JSON.stringify(list)).not.toContain('SECRET-ACCOUNT-KEY-123');
  });
});
