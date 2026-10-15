// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { FileTenantRegistry, StacksimEnvironment, registryRecordPath } from 'ces-tenant';
import type { TenantConfig } from 'ces-shared/config';

import { SessionManager, EO_CONSUMER } from '../../src/eo/core/SessionManager';
import { stamperTenantConfigPath, loadEoConfig } from '../../src/eo/config/EoConfig';
import { validateOrMigrateTenantConfig } from '../../src/eo/config/MigrationHelper';

/**
 * G-TENANT-M2 acceptance gates 1, 2 and 4: ces-eo's OWN entry points
 * (the SessionManager shim, the EoConfig/MigrationHelper resolvers) calling
 * into `ces-tenant`'s `TenantSessionFactory`, registry API and
 * `StacksimModeController`. Deliberately NOT a copy of ces-tenant's internal
 * suite: every entry point exercised here is a ces-eo module.
 */

// ---- Fake persistent-host plumbing (ces-tenant's injected spawn seam) ----

const HOST_READY = 'STAMPER_HOST_READY';
const CMD_END = 'STAMPER_CMD_END';
const STDOUT_END = 'STAMPER_STDOUT_END';
const STDERR_END = 'STAMPER_STDERR_END';
const EXIT_PREFIX = 'STAMPER_EXIT:';

class FakeStream {
  private listeners: Array<(d: Buffer) => void> = [];
  on(_event: 'data', listener: (d: Buffer) => void): this {
    this.listeners.push(listener);
    return this;
  }
  removeListener(_event: 'data', listener: (d: Buffer) => void): this {
    this.listeners = this.listeners.filter((l) => l !== listener);
    return this;
  }
  emit(text: string): void {
    for (const l of [...this.listeners]) l(Buffer.from(text));
  }
}

class FakeSessionHost {
  stdout = new FakeStream();
  stderr = new FakeStream();
  killed = false;
  exitCode: number | null = null;
  commands: string[] = [];
  private buffered = '';
  private handlers: Record<string, Array<(...args: any[]) => void>> = {};

  stdin = {
    write: (chunk: string): boolean => {
      this.buffered += chunk;
      let idx: number;
      while ((idx = this.buffered.indexOf(`${CMD_END}\n`)) !== -1) {
        const command = this.buffered.slice(0, idx).replace(/\n$/, '');
        this.buffered = this.buffered.slice(idx + CMD_END.length + 1);
        this.commands.push(command);
        setImmediate(() => {
          this.stdout.emit(`FAKE-HOST-OK\n${STDOUT_END}\n${EXIT_PREFIX}0\n`);
          this.stderr.emit(STDERR_END);
        });
      }
      return true;
    },
    end: (): void => undefined,
  };

  kill(): void {
    this.killed = true;
    if (this.exitCode === null) this.exitCode = 0;
  }
  on(event: string, listener: (...args: any[]) => void): this {
    (this.handlers[event] ??= []).push(listener);
    return this;
  }
  removeListener(event: string, listener: (...args: any[]) => void): this {
    this.handlers[event] = (this.handlers[event] ?? []).filter((l) => l !== listener);
    return this;
  }
}

function makeSpawnSeam() {
  const spawned: Array<{ command: string; args: readonly string[]; host: FakeSessionHost }> = [];
  const spawnFn = (command: string, args: readonly string[]) => {
    const host = new FakeSessionHost();
    spawned.push({ command, args, host });
    setImmediate(() => host.stdout.emit(`${HOST_READY}\n`));
    return host;
  };
  return { spawned, spawnFn };
}

const quietLogger = { log: () => undefined, warn: () => undefined, error: () => undefined };

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeTenantConfig(overrides: Partial<TenantConfig> = {}): TenantConfig {
  return {
    tenantSlug: 'eo-cutover-tenant',
    tenantId: 'tenant-id-123',
    appId: 'app-id-456',
    certPath: 'C:\\certs\\eo.pfx',
    certThumbprint: 'THUMBPRINT789',
    domain: 'contoso.onmicrosoft.us',
    targetTenantDomain: 'contoso.onmicrosoft.us',
    endpoints: { graph: 'https://graph.microsoft.us', login: 'https://login.microsoftonline.us' },
    ...overrides,
  } as TenantConfig;
}

describe('G-TENANT-M2 cutover -- ces-eo code on ces-tenant surfaces', () => {
  describe('SessionManager shim drives ces-tenant TenantSessionFactory (spawn seam)', () => {
    it('connects and executes an ENGINE-named command through the persistent-host marker protocol without powershell.exe', async () => {
      const { spawned, spawnFn } = makeSpawnSeam();
      const activityEntries: any[] = [];

      const sm = new SessionManager(makeTenantConfig(), {
        spawnFn,
        sessionHostScript: 'X:\\fake\\session-host.ps1',
        logger: quietLogger,
        activity: { recordActivity: (entry: any) => activityEntries.push(entry) },
      });

      // ces-eo's historical call shape: registry ENGINE name, not session type.
      const result = await sm.execute('mgraph', 'Get-MgUser -Top 1');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('FAKE-HOST-OK');

      // One persistent host spawned, for the graph session ('mgraph' maps to 'graph').
      expect(spawned).toHaveLength(1);
      expect(spawned[0].args).toContain('X:\\fake\\session-host.ps1');
      const allCommands = spawned[0].host.commands.join('\n');
      // The init script carries the ces-tenant-built GCC High connect command with this tenant's credentials.
      expect(allCommands).toContain('Connect-MgGraph');
      expect(allCommands).toContain('-Environment USGov');
      expect(allCommands).toContain('tenant-id-123');
      expect(allCommands).toContain('Get-MgUser -Top 1');

      // Session state is served by the ces-tenant factory underneath.
      expect(sm.getSessionState('graph').connected).toBe(true);
      expect(sm.isConnected()).toBe(true);

      // Ratified amendment 2026-07-10: every request carries ces-eo's consumer identity.
      expect(activityEntries.length).toBeGreaterThan(0);
      for (const entry of activityEntries) {
        expect(entry.consumer?.module).toBe('ces-eo');
      }
      expect(EO_CONSUMER.module).toBe('ces-eo');
      expect(EO_CONSUMER.purpose.length).toBeGreaterThan(0);

      await sm.disconnectAll();
    });
  });

  describe('EoConfig/MigrationHelper resolve tenant config via the ces-tenant registry (gate 2)', () => {
    let tenantRoot: string;
    let pipelineRoot: string;
    let storageRoot: string;
    const savedEnv: Record<string, string | undefined> = {};
    const ENV_KEYS = [
      'CES_TENANT_ROOT', 'CES_PIPELINE_ROOT', 'TENANT_SLUG', 'TENANT_CONFIG',
      'ACTIVE_TENANT_SLUG', 'REGISTRY_PATH', 'STORAGE_ROOT', 'STAMPER_PLAN_DATA_ROOT',
    ];

    beforeEach(() => {
      tenantRoot = makeTempDir('eo-m2-tenant-root-');
      pipelineRoot = makeTempDir('eo-m2-pipeline-');
      storageRoot = makeTempDir('eo-m2-storage-');
      for (const key of ENV_KEYS) {
        savedEnv[key] = process.env[key];
        delete process.env[key];
      }
      process.env.CES_TENANT_ROOT = tenantRoot;
      process.env.CES_PIPELINE_ROOT = pipelineRoot;
    });

    afterEach(() => {
      for (const key of ENV_KEYS) {
        if (savedEnv[key] === undefined) delete process.env[key];
        else process.env[key] = savedEnv[key];
      }
      fs.rmSync(tenantRoot, { recursive: true, force: true });
      fs.rmSync(pipelineRoot, { recursive: true, force: true });
      fs.rmSync(storageRoot, { recursive: true, force: true });
    });

    function seedPlanDataTenant(slug: string): void {
      const dir = path.join(pipelineRoot, 'Stamper', 'plan-data', slug);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, `${slug}.json`),
        JSON.stringify({
          client: { slug, name: 'Acme EO' },
          tenant: { tenant_id: `tid-${slug}`, domain: `${slug}.onmicrosoft.us` },
          auth: { app_id: `app-${slug}`, cert_path: `C:\\certs\\${slug}.pfx`, cert_thumbprint: 'ACMETHUMB' },
          endpoints: { graph: 'https://graph.microsoft.us', login: 'https://login.microsoftonline.us' },
        }, null, 2),
        'utf-8',
      );
    }

    it('stamperTenantConfigPath() resolves through the registry, forward-migrating a plan-data record into the registry root', () => {
      seedPlanDataTenant('acme-eo');

      const resolved = stamperTenantConfigPath('acme-eo');

      // The path handed back is the registry's canonical location, not a legacy construction.
      expect(resolved).toBe(registryRecordPath(tenantRoot, 'live', 'acme-eo'));
      // The registry's back-compat read migrated the record forward (stamped kind: 'live').
      expect(fs.existsSync(resolved)).toBe(true);
      expect(JSON.parse(fs.readFileSync(resolved, 'utf-8')).kind).toBe('live');
    });

    it('loadEoConfig() auto-resolves tenantConfigPath via the registry API', async () => {
      seedPlanDataTenant('acme-eo');
      process.env.TENANT_SLUG = 'acme-eo';
      process.env.REGISTRY_PATH = path.join(storageRoot, 'registry.json');
      process.env.STORAGE_ROOT = storageRoot;
      process.env.STAMPER_PLAN_DATA_ROOT = path.join(pipelineRoot, 'Stamper', 'plan-data');

      const config = await loadEoConfig();

      expect(config.tenantSlug).toBe('acme-eo');
      expect(config.tenantConfigPath).toBe(registryRecordPath(tenantRoot, 'live', 'acme-eo'));
    });

    it('validateOrMigrateTenantConfig() loads a registry-resolved record and reports registry-derived availability', async () => {
      seedPlanDataTenant('acme-eo');

      const tc = await validateOrMigrateTenantConfig('acme-eo');
      expect(tc.tenantSlug).toBe('acme-eo');
      expect(tc.tenantId).toBe('tid-acme-eo');
      expect(tc.certThumbprint).toBe('ACMETHUMB');

      await expect(validateOrMigrateTenantConfig('no-such-tenant')).rejects.toThrow(/Available tenants: acme-eo/);
    });
  });

  describe('sim-mode as a side effect: kind:sim tenant via registry + StacksimModeController (gate 4)', () => {
    let tenantRoot: string;
    let stacksimRoot: string;
    const savedTenantRoot = { value: undefined as string | undefined };

    beforeEach(() => {
      tenantRoot = makeTempDir('eo-m2-sim-root-');
      stacksimRoot = makeTempDir('eo-m2-stacksim-');
      fs.mkdirSync(path.join(stacksimRoot, 'psmodules', 'Microsoft.Graph.Authentication'), { recursive: true });
      fs.mkdirSync(path.join(stacksimRoot, 'azshim'), { recursive: true });
      savedTenantRoot.value = process.env.CES_TENANT_ROOT;
      process.env.CES_TENANT_ROOT = tenantRoot;
    });

    afterEach(() => {
      if (savedTenantRoot.value === undefined) delete process.env.CES_TENANT_ROOT;
      else process.env.CES_TENANT_ROOT = savedTenantRoot.value;
      fs.rmSync(tenantRoot, { recursive: true, force: true });
      fs.rmSync(stacksimRoot, { recursive: true, force: true });
    });

    it('ces-eo runs against a kind:sim tenant: registry record -> EoConfig resolution -> SessionManager, with the sim env mutated by ces-tenant, not by any ces-eo code', async () => {
      // 1. A kind:'sim' tenant exists only as a ces-tenant registry record.
      const registry = new FileTenantRegistry({ registryRoot: tenantRoot });
      const record = await registry.createEphemeralSimTenant('eo-sim', { scenario: 'eo-smoke' });
      expect(record.kind).toBe('sim');
      const sims = await registry.listByKind('sim');
      expect(sims.map((r) => r.tenantSlug)).toContain('eo-sim');

      // 2. ces-eo's own config resolvers find it through the registry.
      const resolvedPath = stamperTenantConfigPath('eo-sim');
      expect(resolvedPath).toBe(registryRecordPath(tenantRoot, 'sim', 'eo-sim'));
      const tc = await validateOrMigrateTenantConfig('eo-sim');
      expect(tc.tenantSlug).toBe('eo-sim');

      // 3. Sim mode comes from ces-tenant's StacksimModeController -- ces-eo
      //    implements no sim seam of its own (must-NOT: zero local sim logic).
      const fakeEnv: NodeJS.ProcessEnv = { Path: 'C:\\Windows\\system32' };
      const stacksim = new StacksimEnvironment({
        env: fakeEnv,
        stacksimRoot,
        queryPsHomeModules: async () => 'C:\\FAKE\\PSHOME\\Modules',
        fetchFn: (async () => ({ ok: true })) as unknown as typeof fetch,
        registry,
        logger: quietLogger,
        consumer: { ...EO_CONSUMER, purpose: 'sim-mode smoke test' },
      });
      await stacksim.enableStacksimMode('http://127.0.0.1:9999');

      expect(fakeEnv.PSModulePath).toBe(`${path.join(stacksimRoot, 'psmodules')};C:\\FAKE\\PSHOME\\Modules`);
      expect(fakeEnv.Path).toBe(`${path.join(stacksimRoot, 'azshim')};C:\\Windows\\system32`);
      expect(fakeEnv.STACKSIM_SERVER_URL).toBe('http://127.0.0.1:9999');

      // The launch-context provider only hands out sim bundles for sim records.
      const bundle = await stacksim.getSimLaunchEnv('eo-sim', 'sim');
      expect(bundle.stacksimServerUrl).toBe('http://127.0.0.1:9999');

      // 4. ces-eo's SessionManager runs against the sim tenant's credentials
      //    through the same ces-tenant factory (spawn seam, no powershell.exe).
      const { spawned, spawnFn } = makeSpawnSeam();
      const activityEntries: any[] = [];
      const sm = new SessionManager(tc, {
        spawnFn,
        sessionHostScript: 'X:\\fake\\session-host.ps1',
        logger: quietLogger,
        activity: { recordActivity: (entry: any) => activityEntries.push(entry) },
      });
      const result = await sm.execute('mgraph', 'Get-MgUser -Top 1');
      expect(result.exitCode).toBe(0);
      expect(spawned).toHaveLength(1);
      expect(spawned[0].host.commands.join('\n')).toContain(`sim-tenant-eo-sim`);
      expect(activityEntries.every((e) => e.consumer?.module === 'ces-eo')).toBe(true);
      await sm.disconnectAll();
    });
  });
});
