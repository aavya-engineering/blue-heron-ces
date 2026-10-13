// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TENANT-2026A
// See LICENSE and TERMS.md.

/**
 * PersistentSessionFactory -- acceptance gate 3: the connect/execute SUCCESS
 * path runs against a mocked spawn seam (no live powershell.exe), the exact
 * coverage the M0 record flagged as untestable without a source change.
 * Also pins the buildConnectCommand() GCC High/USGov literals verbatim.
 */

import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

import {
  PersistentSessionFactory,
  type SessionCredentials,
  type SpawnFn,
  type SpawnedProcessLike,
} from '../impl/session-factory.js';
import { InProcessTenantStatus } from '../impl/status.js';

const CREDS: SessionCredentials = {
  tenantId: 'tid-1',
  appId: 'app-1',
  certThumbprint: 'THUMB1',
  targetTenantDomain: 'contoso.onmicrosoft.us',
  subscriptionId: 'sub-1',
};

const quietLogger = { log: () => {}, warn: () => {}, error: () => {} };

/**
 * Fake session-host: speaks the STAMPER_* marker protocol
 * (`session-host.ps1` side of `sendCommand()`'s contract). Emits
 * STAMPER_HOST_READY on spawn; each stdin command gets a scripted reply.
 */
class FakePsHost implements SpawnedProcessLike {
  readonly stdoutEmitter = new EventEmitter();
  readonly stderrEmitter = new EventEmitter();
  private readonly proc = new EventEmitter();
  private stdinBuf = '';
  readonly receivedCommands: string[] = [];
  killed = false;
  exitCode: number | null = null;

  constructor(
    private readonly respond: (command: string) => { stdout: string; exitCode: number } = () => ({
      stdout: 'ok',
      exitCode: 0,
    }),
  ) {
    setImmediate(() => this.stdoutEmitter.emit('data', Buffer.from('STAMPER_HOST_READY\n')));
  }

  readonly stdin = {
    write: (chunk: string): void => {
      this.stdinBuf += chunk;
      const markerIdx = this.stdinBuf.indexOf('STAMPER_CMD_END\n');
      if (markerIdx === -1) return;
      const command = this.stdinBuf.slice(0, markerIdx).trimEnd();
      this.stdinBuf = this.stdinBuf.slice(markerIdx + 'STAMPER_CMD_END\n'.length);
      this.receivedCommands.push(command);
      const { stdout, exitCode } = this.respond(command);
      setImmediate(() => {
        this.stderrEmitter.emit('data', Buffer.from('STAMPER_STDERR_END\n'));
        this.stdoutEmitter.emit('data', Buffer.from(`${stdout}\nSTAMPER_STDOUT_END\nSTAMPER_EXIT:${exitCode}\n`));
      });
    },
    end: (): void => {},
  };

  readonly stdout = {
    on: (event: 'data', l: (d: Buffer) => void) => this.stdoutEmitter.on(event, l),
    removeListener: (event: 'data', l: (d: Buffer) => void) => this.stdoutEmitter.removeListener(event, l),
  };

  readonly stderr = {
    on: (event: 'data', l: (d: Buffer) => void) => this.stderrEmitter.on(event, l),
    removeListener: (event: 'data', l: (d: Buffer) => void) => this.stderrEmitter.removeListener(event, l),
  };

  kill(): void {
    this.killed = true;
    this.exitCode = this.exitCode ?? 0;
  }

  on(event: string, listener: (...args: any[]) => void): unknown {
    return this.proc.on(event, listener);
  }
  removeListener(event: string, listener: (...args: any[]) => void): unknown {
    return this.proc.removeListener(event, listener);
  }
}

function makeFactory(respond?: ConstructorParameters<typeof FakePsHost>[0]) {
  const hosts: FakePsHost[] = [];
  const spawnFn: SpawnFn = vi.fn(() => {
    const host = new FakePsHost(respond);
    hosts.push(host);
    return host;
  });
  const factory = new PersistentSessionFactory(CREDS, { spawnFn, logger: quietLogger });
  return { factory, hosts, spawnFn };
}

describe('PersistentSessionFactory -- mocked connect/execute success path (gate 3)', () => {
  it('connects on first execute, sends the init script, and returns the parsed PSResult', async () => {
    const { factory, hosts, spawnFn } = makeFactory((cmd) =>
      cmd.includes('Get-MgUser') ? { stdout: 'user-a\nuser-b', exitCode: 0 } : { stdout: 'connected', exitCode: 0 },
    );

    const result = await factory.execute('graph', 'Get-MgUser -All');

    expect(spawnFn).toHaveBeenCalledTimes(1);
    expect(spawnFn).toHaveBeenCalledWith(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', expect.stringContaining('session-host.ps1')],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
    );

    // Init script: module imports + guarded connect + connected sentinel.
    const initScript = hosts[0].receivedCommands[0];
    expect(initScript).toContain('Import-Module Microsoft.Graph.Authentication -RequiredVersion 2.35.1');
    expect(initScript).toContain('Connect-MgGraph -TenantId "tid-1" -ClientId "app-1" -CertificateThumbprint "THUMB1" -Environment USGov -NoWelcome');
    expect(initScript).toContain('Write-Output "STAMPER_SESSION_CONNECTED"');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('user-a\nuser-b\n');
    expect(result.stderr).toBe('');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    const state = factory.getSessionState('graph');
    expect(state.connected).toBe(true);
    expect(state.connectedAt).toBeInstanceOf(Date);
    expect(state.tokenExpiresAt).toBeInstanceOf(Date);
    expect(state.lastUsedAt).toBeInstanceOf(Date);
  });

  it('reuses the live session on subsequent executes (no respawn)', async () => {
    const { factory, spawnFn } = makeFactory();
    await factory.execute('graph', 'Get-MgUser -All');
    await factory.execute('graph', 'Get-MgGroup -All');
    expect(spawnFn).toHaveBeenCalledTimes(1);
  });

  it('streams stdout chunks through the onStdout callback', async () => {
    const { factory } = makeFactory(() => ({ stdout: 'chunk1\nchunk2', exitCode: 0 }));
    const chunks: string[] = [];
    await factory.execute('graph', 'Get-Whatever', (c) => chunks.push(c));
    // The init-script reply also streams; assert the command's lines arrived.
    expect(chunks.join('')).toContain('chunk1\n');
    expect(chunks.join('')).toContain('chunk2\n');
  });

  it('surfaces nonzero exit codes from the marker protocol', async () => {
    const { factory } = makeFactory((cmd) =>
      cmd.includes('Broken-Cmdlet') ? { stdout: 'boom', exitCode: 1 } : { stdout: 'ok', exitCode: 0 },
    );
    const result = await factory.execute('graph', 'Broken-Cmdlet');
    expect(result.exitCode).toBe(1);
  });

  it('connectMgGraph with explicit credentials bypasses the config values', async () => {
    const { factory, hosts } = makeFactory();
    await factory.connectMgGraph('tid-override', 'app-override', 'THUMB-OVERRIDE');
    const initScript = hosts[0].receivedCommands[0];
    expect(initScript).toContain('Connect-MgGraph -TenantId "tid-override" -ClientId "app-override" -CertificateThumbprint "THUMB-OVERRIDE"');
    expect(factory.getSessionState('graph').connected).toBe(true);
  });

  it('connectIPPS spawns a purview host and marks it connected', async () => {
    const { factory, hosts } = makeFactory();
    await factory.connectIPPS();
    expect(hosts[0].receivedCommands[0]).toContain('Connect-IPPSSession');
    expect(factory.getSessionState('purview').connected).toBe(true);
  });

  it('disconnectAll kills the persistent process and clears connected state', async () => {
    const { factory, hosts } = makeFactory();
    await factory.execute('graph', 'Get-MgUser');
    await factory.disconnectAll();
    expect(hosts[0].killed).toBe(true);
    expect(factory.getSessionState('graph').connected).toBe(false);
  });
});

describe('PersistentSessionFactory -- dry-run and state surface', () => {
  it('dry-run short-circuits execute without spawning', async () => {
    const spawnFn: SpawnFn = vi.fn();
    const factory = new PersistentSessionFactory(CREDS, { dryRun: true, spawnFn, logger: quietLogger });
    const result = await factory.execute('exchange', 'Get-Mailbox');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('[dry-run]');
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('initializes all six session states disconnected', () => {
    const { factory } = makeFactory();
    const states = factory.getAllSessionStates();
    expect(states.map((s) => s.type).sort()).toEqual(['azure', 'exchange', 'graph', 'purview', 'sharepoint', 'teams']);
    expect(states.every((s) => !s.connected && s.connectedAt === null)).toBe(true);
  });
});

describe('PersistentSessionFactory -- caller identity + activity (ratified amendment 2026-07-10)', () => {
  function makeAmendedFactory(options: Partial<ConstructorParameters<typeof PersistentSessionFactory>[1]> = {}) {
    const status = new InProcessTenantStatus();
    const warn = vi.fn();
    const spawnFn: SpawnFn = vi.fn(() => new FakePsHost());
    const factory = new PersistentSessionFactory(CREDS, {
      spawnFn,
      logger: { log: () => {}, warn, error: () => {} },
      activity: status,
      tenantSlug: 'contoso',
      ...options,
    });
    return { factory, status, warn };
  }

  it('execute with a construction-time consumer records a tenant x service x module activity entry', async () => {
    const { factory, status, warn } = makeAmendedFactory({ consumer: { module: 'ces-stamper', purpose: 'translate run' } });
    await factory.execute('graph', 'Get-MgUser -All');

    const entries = await status.getActivity({ module: 'ces-stamper' });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      consumer: { module: 'ces-stamper', purpose: 'translate run' },
      operation: 'execute',
      tenantSlug: 'contoso',
      sessionType: 'graph',
      outcome: 'ok',
    });
    expect(entries[0].detail).toContain('Get-MgUser');
    expect(warn).not.toHaveBeenCalled();
  });

  it('a per-request consumer overrides the construction-time binding', async () => {
    const { factory, status } = makeAmendedFactory({ consumer: { module: 'ces-stamper', purpose: 'default' } });
    await factory.execute('graph', 'Get-MgGroup', undefined, { module: 'ces-eo', purpose: 'assessment probe' });

    expect(await status.getActivity({ module: 'ces-eo' })).toHaveLength(1);
    expect(await status.getActivity({ module: 'ces-stamper' })).toHaveLength(0);
  });

  it('a request without any consumer is LOGGED in library mode and recorded with consumer: null (amendment invariant)', async () => {
    const { factory, status, warn } = makeAmendedFactory();
    await factory.execute('graph', 'Get-MgUser');

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('without consumer identity'));
    const entries = await status.getActivity();
    expect(entries).toHaveLength(1);
    expect(entries[0].consumer).toBeNull();
    expect(entries[0].outcome).toBe('ok');
  });

  it('ensureConnected / connectMgGraph / connectIPPS carry the consumer and each record one entry', async () => {
    const { factory, status } = makeAmendedFactory();
    const consumer = { module: 'ces-eo', purpose: 'assessment' };
    await factory.ensureConnected('graph', consumer);
    await factory.connectMgGraph(undefined, undefined, undefined, consumer);
    await factory.connectIPPS(undefined, undefined, undefined, consumer);

    const entries = await status.getActivity({ module: 'ces-eo' });
    expect(entries.map((e) => e.operation)).toEqual(['ensureConnected', 'connectMgGraph', 'connectIPPS']);
    expect(entries.map((e) => e.sessionType)).toEqual(['graph', 'graph', 'purview']);
    expect(entries.every((e) => e.outcome === 'ok')).toBe(true);
  });

  it('a failed request records an outcome: error entry and still throws', async () => {
    const spawnFn: SpawnFn = vi.fn(() => {
      throw new Error('spawn refused');
    });
    const status = new InProcessTenantStatus();
    const factory = new PersistentSessionFactory(CREDS, {
      spawnFn,
      logger: quietLogger,
      activity: status,
      tenantSlug: 'contoso',
      consumer: { module: 'ces-stamper', purpose: 'translate run' },
    });

    await expect(factory.connectMgGraph()).rejects.toThrow();
    const entries = await status.getActivity();
    expect(entries).toHaveLength(1);
    expect(entries[0].outcome).toBe('error');
    expect(entries[0].consumer).toEqual({ module: 'ces-stamper', purpose: 'translate run' });
  });

  it('the factory feeds the own-process status view via attachSessionSource', async () => {
    const { factory, status } = makeAmendedFactory({ consumer: { module: 'ces-stamper', purpose: 'translate run' } });
    status.attachSessionSource(factory, { tenantSlug: 'contoso', kind: 'live' });
    await factory.execute('graph', 'Get-MgUser');

    const rows = await status.getConnectionStatus();
    expect(rows).toHaveLength(1);
    expect(rows[0].tenantSlug).toBe('contoso');
    expect(rows[0].kind).toBe('live');
    expect(rows[0].sessions.find((s) => s.type === 'graph')?.connected).toBe(true);
    expect(rows[0].lastActivityAt).toBeInstanceOf(Date);
  });
});

describe('PersistentSessionFactory.buildConnectCommand -- GCC High/USGov literals pinned (SessionManager.ts:392-432)', () => {
  const { factory } = makeFactory();

  it('graph', () => {
    expect(factory.buildConnectCommand('graph')).toBe(
      'Connect-MgGraph -TenantId "tid-1" -ClientId "app-1" -CertificateThumbprint "THUMB1" -Environment USGov -NoWelcome',
    );
  });

  it('exchange', () => {
    expect(factory.buildConnectCommand('exchange')).toBe(
      'Connect-ExchangeOnline -AppId "app-1" -Organization "contoso.onmicrosoft.us" -CertificateThumbprint "THUMB1" -ExchangeEnvironmentName O365USGovGCCHigh -ShowBanner:$false',
    );
  });

  it('purview', () => {
    expect(factory.buildConnectCommand('purview')).toBe(
      'Connect-IPPSSession -AppId "app-1" -Organization "contoso.onmicrosoft.us" -CertificateThumbprint "THUMB1" -ConnectionUri "https://ps.compliance.protection.office365.us/powershell-liveid/" -AzureADAuthorizationEndpointUri "https://login.microsoftonline.us/organizations"',
    );
  });

  it('azure (with and without subscription)', () => {
    expect(factory.buildConnectCommand('azure')).toBe(
      'Connect-AzAccount -ServicePrincipal -TenantId "tid-1" -ApplicationId "app-1" -CertificateThumbprint "THUMB1" -Environment AzureUSGovernment -Subscription "sub-1" | Out-Null',
    );
    const noSub = new PersistentSessionFactory({ ...CREDS, subscriptionId: undefined }, { logger: quietLogger });
    expect(noSub.buildConnectCommand('azure')).toBe(
      'Connect-AzAccount -ServicePrincipal -TenantId "tid-1" -ApplicationId "app-1" -CertificateThumbprint "THUMB1" -Environment AzureUSGovernment | Out-Null',
    );
  });

  it('sharepoint (tenant name derived from targetTenantDomain)', () => {
    expect(factory.buildConnectCommand('sharepoint')).toBe(
      'Import-Module Microsoft.Online.SharePoint.PowerShell -DisableNameChecking -WarningAction SilentlyContinue; Connect-SPOService -Url "https://contoso-admin.us.sharepoint.us" -ClientId "app-1" -TenantId "tid-1" -CertificateThumbprint "THUMB1" -Region ITAR -ErrorAction Stop',
    );
  });

  it('teams', () => {
    expect(factory.buildConnectCommand('teams')).toBe(
      'Connect-MicrosoftTeams -TenantId "tid-1" -ApplicationId "app-1" -CertificateThumbprint "THUMB1" -TeamsEnvironmentName TeamsGCCH',
    );
  });

  it('explicit credential overrides take precedence over config', () => {
    expect(factory.buildConnectCommand('graph', 'T2', 'A2', 'C2')).toBe(
      'Connect-MgGraph -TenantId "T2" -ClientId "A2" -CertificateThumbprint "C2" -Environment USGov -NoWelcome',
    );
  });
});
