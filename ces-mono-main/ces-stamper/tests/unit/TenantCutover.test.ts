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

import { SessionManager } from '../../src/core/SessionManager';
import {
  DEFAULT_SIM_TENANT_SLUG,
  STAMPER_CONSUMER,
  getTenantRegistry,
  listTenantRecordsWithPaths,
  requestStacksimMode,
  resetTenantRegistryForTests,
  resolveTenantRecordPath,
  seedRegistryFromRepoPlanData,
} from '../../src/tenant/stamperTenants';
import { resolveTenantJsonPath, loadClientConfigFromTenantJson } from '../../src/config/ClientConfig';

/**
 * G-TENANT-M1 acceptance gate 3: direct package coverage for the cutover
 * itself — Stamper's OWN code (the SessionManager shim, the stamperTenants
 * integration module, the ClientConfig resolver) calling into `ces-tenant`'s
 * `TenantSessionFactory`, `StacksimModeController`, and registry API. This
 * is deliberately NOT a copy of ces-tenant's internal suite: every entry
 * point exercised here is a Stamper module.
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

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('G-TENANT-M1 cutover — Stamper code on ces-tenant surfaces', () => {
  describe('SessionManager shim drives ces-tenant TenantSessionFactory (spawn seam)', () => {
    it('connects and executes through the persistent-host marker protocol without powershell.exe', async () => {
      const spawned: Array<{ command: string; args: readonly string[]; host: FakeSessionHost }> = [];
      const spawnFn = (command: string, args: readonly string[]) => {
        const host = new FakeSessionHost();
        spawned.push({ command, args, host });
        setImmediate(() => host.stdout.emit(`${HOST_READY}\n`));
        return host;
      };

      const activityEntries: any[] = [];
      const sm = new SessionManager(
        {
          tenantId: 'tenant-id-123',
          appId: 'app-id-456',
          certThumbprint: 'THUMBPRINT789',
          targetTenantDomain: 'contoso.onmicrosoft.us',
          tenantSlug: 'cutover-tenant',
        },
        false /* NOT dry-run — the real connect/execute path */,
        {
          spawnFn,
          sessionHostScript: 'X:\\fake\\session-host.ps1',
          logger: { log: () => undefined, warn: () => undefined, error: () => undefined },
          activity: { recordActivity: (entry: any) => activityEntries.push(entry) },
        },
      );

      const result = await sm.execute('graph', 'Get-MgUser -All');

      // Spawn went through the injected seam with SessionManager's historical args.
      expect(spawned).toHaveLength(1);
      expect(spawned[0].command).toBe('powershell.exe');
      expect(spawned[0].args).toEqual([
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        'X:\\fake\\session-host.ps1',
      ]);

      // The init script sent to the host carries the ces-tenant-built GCC High connect command.
      const initScript = spawned[0].host.commands[0];
      expect(initScript).toContain(
        'Connect-MgGraph -TenantId "tenant-id-123" -ClientId "app-id-456" -CertificateThumbprint "THUMBPRINT789" -Environment USGov -NoWelcome',
      );

      // Marker-protocol round trip produced a real PSResult.
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('FAKE-HOST-OK');
      expect(sm.getSessionState('graph').connected).toBe(true);

      // Ratified 2026-07-10 amendment: the request carried Stamper's consumer identity.
      const executeEntry = activityEntries.find((e) => e.operation === 'execute');
      expect(executeEntry).toBeDefined();
      expect(executeEntry.consumer).toEqual({ module: 'ces-stamper', purpose: 'stamper session' });
      expect(executeEntry.tenantSlug).toBe('cutover-tenant');
      expect(executeEntry.outcome).toBe('ok');

      await sm.disconnectAll();
    });
  });

  describe('registry API through Stamper helpers (temp CES_TENANT_ROOT)', () => {
    let tempRoot: string;
    const originalTenantRoot = process.env.CES_TENANT_ROOT;

    beforeEach(() => {
      tempRoot = makeTempDir('ces-tenant-cutover-');
      process.env.CES_TENANT_ROOT = tempRoot;
      resetTenantRegistryForTests();
    });

    afterEach(() => {
      if (originalTenantRoot === undefined) delete process.env.CES_TENANT_ROOT;
      else process.env.CES_TENANT_ROOT = originalTenantRoot;
      resetTenantRegistryForTests();
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    it('creates, resolves, lists, and tears down an ephemeral sim tenant', async () => {
      const registry = getTenantRegistry();
      const created = await registry.createEphemeralSimTenant('cutover-ephemeral', { seed: 'ref' });
      expect(created.kind).toBe('sim');

      // Stamper's registry-backed path resolution lands in the sim namespace.
      const recordPath = await resolveTenantRecordPath('cutover-ephemeral');
      expect(recordPath).toBe(path.join(tempRoot, 'sim', 'cutover-ephemeral.json'));
      expect(fs.existsSync(recordPath)).toBe(true);

      // And the ClientConfig seam (used by every route/CLI call site) agrees.
      await expect(resolveTenantJsonPath('cutover-ephemeral')).resolves.toBe(recordPath);

      const listed = await listTenantRecordsWithPaths();
      expect(listed.some((e) => e.record.tenantSlug === 'cutover-ephemeral' && e.record.kind === 'sim')).toBe(true);

      await registry.teardownEphemeralSimTenant('cutover-ephemeral');
      expect(fs.existsSync(recordPath)).toBe(false);
      expect(await registry.listByKind('sim')).not.toContainEqual(
        expect.objectContaining({ tenantSlug: 'cutover-ephemeral' }),
      );
    });

    it('resolves an unknown slug to the would-be live record path (existing not-found flows keep working)', async () => {
      const p = await resolveTenantRecordPath('no-such-tenant-xyz');
      expect(p).toBe(path.join(tempRoot, 'live', 'no-such-tenant-xyz.json'));
      expect(fs.existsSync(p)).toBe(false);
    });

    it('seeds legacy repo plan-data tenant JSONs forward into the registry, kind-stamped', () => {
      const planRoot = makeTempDir('stamper-plan-data-');
      try {
        const liveRaw = {
          client: { slug: 'acme', name: 'Acme Corp' },
          tenant: { tenant_id: 'tid-acme', domain: 'acme.onmicrosoft.us', environment: 'gcc-high' },
          auth: { app_id: 'app-acme', cert_path: 'certs/acme.pfx', cert_thumbprint: 'ACMETHUMB' },
          endpoints: { graph: 'https://graph.microsoft.us', login: 'https://login.microsoftonline.us' },
        };
        const simRaw = {
          client: { slug: 'simx', name: 'Sim X' },
          tenant: { tenant_id: 'tid-simx', domain: 'simx.simtenant.onmicrosoft.us', environment: 'gcc-high-sim' },
          auth: { app_id: 'app-simx', cert_path: 'sim/simx.pfx', cert_thumbprint: 'SIMTHUMB' },
          endpoints: { graph: 'http://localhost:4390/graph', login: 'http://localhost:4390/login' },
        };
        for (const [slug, raw] of [['acme', liveRaw], ['simx', simRaw]] as const) {
          fs.mkdirSync(path.join(planRoot, slug), { recursive: true });
          fs.writeFileSync(path.join(planRoot, slug, `${slug}.json`), JSON.stringify(raw, null, 2), 'utf-8');
        }

        seedRegistryFromRepoPlanData(planRoot, tempRoot);

        const acmePath = path.join(tempRoot, 'live', 'acme.json');
        const simxPath = path.join(tempRoot, 'sim', 'simx.json');
        expect(fs.existsSync(acmePath)).toBe(true);
        expect(fs.existsSync(simxPath)).toBe(true);
        expect(JSON.parse(fs.readFileSync(acmePath, 'utf-8')).kind).toBe('live');
        expect(JSON.parse(fs.readFileSync(simxPath, 'utf-8')).kind).toBe('sim');

        // Sources are left in place (reads-not-writes back-compat).
        expect(fs.existsSync(path.join(planRoot, 'acme', 'acme.json'))).toBe(true);

        // The seeded record round-trips through the existing loader unchanged.
        const cfg = loadClientConfigFromTenantJson(acmePath);
        expect(cfg.tenantId).toBe('tid-acme');
        expect(cfg.certThumbprint).toBe('ACMETHUMB');
      } finally {
        fs.rmSync(planRoot, { recursive: true, force: true });
      }
    });
  });

  describe('--stacksim flow drives ces-tenant StacksimModeController via a kind:sim registry request', () => {
    let tempRoot: string;
    let stacksimRoot: string;
    const originalTenantRoot = process.env.CES_TENANT_ROOT;

    beforeEach(() => {
      tempRoot = makeTempDir('ces-tenant-stacksim-');
      stacksimRoot = makeTempDir('stacksim-root-');
      fs.mkdirSync(path.join(stacksimRoot, 'psmodules', 'Microsoft.Graph.Authentication'), { recursive: true });
      fs.mkdirSync(path.join(stacksimRoot, 'azshim'), { recursive: true });
      process.env.CES_TENANT_ROOT = tempRoot;
      resetTenantRegistryForTests();
    });

    afterEach(() => {
      if (originalTenantRoot === undefined) delete process.env.CES_TENANT_ROOT;
      else process.env.CES_TENANT_ROOT = originalTenantRoot;
      resetTenantRegistryForTests();
      fs.rmSync(tempRoot, { recursive: true, force: true });
      fs.rmSync(stacksimRoot, { recursive: true, force: true });
    });

    it('creates the default sim registry record when none exists and mutates the injected env', async () => {
      const fakeEnv: NodeJS.ProcessEnv = { Path: 'C:\\Windows\\system32' };

      const record = await requestStacksimMode('http://127.0.0.1:9999', {
        env: fakeEnv,
        stacksimRoot,
        queryPsHomeModules: async () => 'C:\\FAKE\\PSHOME\\Modules',
        fetchFn: (async () => ({ ok: true })) as unknown as typeof fetch,
      });

      // The flag became a registry request: a kind:'sim' record now exists.
      expect(record.kind).toBe('sim');
      const registry = getTenantRegistry();
      const sims = await registry.listByKind('sim');
      expect(sims.some((r) => r.tenantSlug === record.tenantSlug)).toBe(true);
      expect(record.tenantSlug).toBe(DEFAULT_SIM_TENANT_SLUG);
      expect(fs.existsSync(path.join(tempRoot, 'sim', `${DEFAULT_SIM_TENANT_SLUG}.json`))).toBe(true);

      // enableStacksimMode ran through ces-tenant's controller against the injected env.
      expect(fakeEnv.PSModulePath).toBe(`${path.join(stacksimRoot, 'psmodules')};C:\\FAKE\\PSHOME\\Modules`);
      expect(fakeEnv.Path).toBe(`${path.join(stacksimRoot, 'azshim')};C:\\Windows\\system32`);
      expect(fakeEnv.STACKSIM_SERVER_URL).toBe('http://127.0.0.1:9999');

      // Consumer identity constant is what the amendment expects Stamper to wire.
      expect(STAMPER_CONSUMER.module).toBe('ces-stamper');
      expect(STAMPER_CONSUMER.purpose.length).toBeGreaterThan(0);
    });
  });
});
