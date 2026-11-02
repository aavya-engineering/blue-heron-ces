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

import modulePins from '../data/module-pins.json' with { type: 'json' };
import {
  PersistentSessionFactory,
  renderModuleImport,
  type ModulePinEntry,
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
    private readonly respond: (command: string) => { stdout: string; exitCode: number; order?: string } = () => ({
      stdout: 'ok',
      exitCode: 0,
    }),
    /**
     * S1 fix: when set, the reply goes out as separate chunks in this order: O = stdout plus
     * STAMPER_STDOUT_END, X = STAMPER_EXIT, R = STAMPER_STDERR_END (a real pipe can split them).
     */
    private readonly chunkOrder?: string,
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
      const { stdout, exitCode, order } = this.respond(command);
      // W8-SES: a per-command `order` overrides chunkOrder (an order without X never sends the exit line).
      const chunkOrder = order ?? this.chunkOrder;
      setImmediate(() => {
        if (chunkOrder) {
          const emit: Record<string, () => void> = {
            O: () => this.stdoutEmitter.emit('data', Buffer.from(`${stdout}\nSTAMPER_STDOUT_END\n`)),
            X: () => this.stdoutEmitter.emit('data', Buffer.from(`STAMPER_EXIT:${exitCode}\n`)),
            R: () => this.stderrEmitter.emit('data', Buffer.from('STAMPER_STDERR_END\n')),
          };
          if (order) {
            // W8-SES: a per-command order sends each chunk in its own tick, as separate pipe reads do.
            const send = (i: number): void => {
              if (i >= order.length) return;
              emit[order[i]]();
              setImmediate(() => send(i + 1));
            };
            send(0);
            return;
          }
          for (const k of chunkOrder) emit[k]();
          return;
        }
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

function makeFactory(respond?: ConstructorParameters<typeof FakePsHost>[0], chunkOrder?: string) {
  const hosts: FakePsHost[] = [];
  const spawnFn: SpawnFn = vi.fn(() => {
    const host = new FakePsHost(respond, chunkOrder);
    hosts.push(host);
    return host;
  });
  const factory = new PersistentSessionFactory(CREDS, { spawnFn, logger: quietLogger });
  return { factory, hosts, spawnFn };
}

describe('PersistentSessionFactory -- mocked connect/execute success path (gate 3)', () => {
  it('FIN-42 (SP-4): the session host is spawned with a scrubbed env (no CES module secrets, the rest kept)', async () => {
    const planted = { CES_AO_AUTH_TOKEN: 'x', jwt_secret: 'x', CES_EC_PRINCIPAL_SECRET: 'x', DATABASE_URL: 'x', FIN42_KEEP_ME: 'kept' };
    const before = { ...process.env };
    Object.assign(process.env, planted);
    try {
      const { factory, spawnFn } = makeFactory();
      await factory.execute('graph', 'Get-MgUser -All');
      const opts = (spawnFn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][2] as { env?: NodeJS.ProcessEnv };
      expect(opts.env).toBeDefined();
      const keys = Object.keys(opts.env ?? {}).map((k) => k.toUpperCase());
      for (const k of ['CES_AO_AUTH_TOKEN', 'JWT_SECRET', 'CES_EC_PRINCIPAL_SECRET', 'DATABASE_URL']) expect(keys).not.toContain(k);
      expect(opts.env?.FIN42_KEEP_ME).toBe('kept');
      expect(process.env.CES_AO_AUTH_TOKEN).toBe('x'); // the parent env is not mutated
    } finally {
      for (const k of Object.keys(planted)) if (!(k in before)) delete process.env[k];
    }
  });

  it('connects on first execute, sends the init script, and returns the parsed PSResult', async () => {
    const { factory, hosts, spawnFn } = makeFactory((cmd) =>
      cmd.includes('Get-MgUser') ? { stdout: 'user-a\nuser-b', exitCode: 0 } : { stdout: 'connected', exitCode: 0 },
    );

    const result = await factory.execute('graph', 'Get-MgUser -All');

    expect(spawnFn).toHaveBeenCalledTimes(1);
    expect(spawnFn).toHaveBeenCalledWith(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', expect.stringContaining('session-host.ps1')],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: expect.any(Object) },
    );

    // Init script: module imports + guarded connect + connected sentinel.
    const initScript = hosts[0].receivedCommands[0];
    const authPin = (modulePins.sessions.graph as ModulePinEntry[]).find((m) => m.name === 'Microsoft.Graph.Authentication');
    expect(initScript).toContain(`Import-Module Microsoft.Graph.Authentication -RequiredVersion ${authPin?.requiredVersion}`);
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

describe('PersistentSessionFactory -- marker chunks split across pipe reads (S1 fix, 2026-10-28)', () => {
  // Run 27 (synthetic customer s1-mach): the EO reads `Get-MgSecurityAlert | ConvertTo-Json` and
  // `Get-MgIdentityConditionalAccessPolicy | ConvertTo-Json` each came back empty on one assess pass
  // ("Unexpected end of JSON input"), because STAMPER_EXIT arrived in a later chunk than
  // STAMPER_STDOUT_END and the collected output was dropped. Orders OXR and ROX lost it; ORX did not.
  const JSON_OUT = '[\n  {\n    "id": "caPolicy-1"\n  }\n]';
  const respond = (cmd: string) =>
    cmd.includes('Get-MgIdentityConditionalAccessPolicy') ? { stdout: JSON_OUT, exitCode: 0 } : { stdout: 'connected', exitCode: 0 };

  for (const order of ['OXR', 'ROX', 'ORX']) {
    it(`keeps the command's stdout when the reply arrives as chunks ${order}`, async () => {
      const { factory } = makeFactory(respond, order);
      const result = await factory.execute('graph', 'Get-MgIdentityConditionalAccessPolicy | ConvertTo-Json -Depth 10');
      expect(result.stdout).toBe(`${JSON_OUT}\n`);
      expect(JSON.parse(result.stdout)).toEqual([{ id: 'caPolicy-1' }]);
      expect(result.exitCode).toBe(0);
    });
  }

  it('streams each output line to onStdout exactly once when the reply is split', async () => {
    const { factory } = makeFactory(
      (cmd) => (cmd.includes('Get-Whatever') ? { stdout: 'line1\nline2', exitCode: 0 } : { stdout: 'connected', exitCode: 0 }),
      'OXR',
    );
    const chunks: string[] = [];
    const result = await factory.execute('graph', 'Get-Whatever', (c) => chunks.push(c));
    expect(result.stdout).toBe('line1\nline2\n');
    expect(chunks).toEqual(['line1\n', 'line2\n']);
  });

  it('carries the exit code from a separate chunk', async () => {
    const { factory } = makeFactory((cmd) => (cmd.includes('Get-Fails') ? { stdout: 'partial', exitCode: 1 } : { stdout: 'connected', exitCode: 0 }), 'ROX');
    const result = await factory.execute('graph', 'Get-Fails');
    expect(result.stdout).toBe('partial\n');
    expect(result.exitCode).toBe(1);
  });
});

describe('PersistentSessionFactory -- exit code belongs to its own command (W8-SES, 2026-10-30)', () => {
  // W8-GEX (LOG-W8-GEX.md section 1): session-host.ps1 writes STAMPER_STDOUT_END, then STAMPER_STDERR_END
  // (stderr), then STAMPER_EXIT, and a real pipe delivered them as three chunks (order O, R, X). The
  // command resolved on the first two with exit 0 and the next command took the late exit 1.
  it('waits for an exit line that arrives after both end markers', async () => {
    const { factory } = makeFactory((cmd) =>
      cmd.includes('Get-LabelPolicy') ? { stdout: '', exitCode: 1, order: 'ORX' } : { stdout: 'connected', exitCode: 0 },
    );
    const result = await factory.execute('purview', 'Get-LabelPolicy -Identity x');
    expect(result.exitCode).toBe(1);
  });

  it('gives back-to-back commands their own exit codes (first 1, second 0)', async () => {
    const { factory, hosts } = makeFactory((cmd) => {
      if (cmd.includes('Get-LabelPolicy')) return { stdout: '', exitCode: 1, order: 'ORX' };
      if (cmd.includes('New-LabelPolicy')) return { stdout: 'created', exitCode: 0, order: 'ORX' };
      return { stdout: 'connected', exitCode: 0 };
    });
    // Sequential, as get-then-set runs: the SET is sent as soon as the GET resolves.
    const first = await factory.execute('purview', 'Get-LabelPolicy -Identity x');
    const second = await factory.execute('purview', 'New-LabelPolicy -Name x');
    expect(hosts.length).toBe(1);
    // Both commands ran on the same host, one after the other (connect sends its own commands first).
    const sent = hosts[0].receivedCommands;
    expect(sent[sent.length - 2]).toContain('Get-LabelPolicy');
    expect(sent[sent.length - 1]).toContain('New-LabelPolicy');
    expect(first.exitCode).toBe(1);
    expect(second.exitCode).toBe(0);
    expect(second.stdout).toBe('created\n');
  });

  it('times out a command whose exit line never arrives, then respawns and reruns it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      let hung = false;
      const { factory, hosts } = makeFactory((cmd) => {
        if (cmd.includes('Get-Hangs') && !hung) {
          hung = true;
          return { stdout: '', exitCode: 1, order: 'OR' };
        }
        return { stdout: cmd.includes('Get-Hangs') ? 'second-try' : 'connected', exitCode: 0 };
      });
      const pending = factory.execute('graph', 'Get-Hangs');
      // Let connect and the hanging command reach the host, then pass the 5 minute command timeout.
      for (let i = 0; i < 20 && hosts[0]?.receivedCommands.length !== 2; i++) {
        await new Promise((r) => setImmediate(r));
      }
      expect(hosts[0].receivedCommands.length).toBe(2);
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);
      const result = await pending;
      expect(hosts[0].killed).toBe(true);
      expect(hosts.length).toBe(2);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('second-try\n');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('module-pins.json -- PowerShell module pins live in one data file (K4, 2026-10-31)', () => {
  const sessions = modulePins.sessions as Record<string, ModulePinEntry[]>;

  it('has schemaVersion 1 and one entry list per session type', () => {
    expect(modulePins.schemaVersion).toBe(1);
    expect(Object.keys(sessions).sort()).toEqual(['azure', 'exchange', 'graph', 'purview', 'sharepoint', 'teams']);
  });

  it('pins Microsoft.Graph.Authentication first in the graph list, with an exact version and a reason', () => {
    const first = sessions.graph[0];
    expect(first.name).toBe('Microsoft.Graph.Authentication');
    expect(first.requiredVersion).toMatch(/^\d+(\.\d+){1,3}$/);
    expect(first.why).toBeTruthy();
  });

  it('renders pinned and unpinned entries as the Import-Module lines the session host has always received', () => {
    expect(renderModuleImport({ name: 'Microsoft.Graph.Authentication', requiredVersion: '2.35.1' })).toBe(
      'Import-Module Microsoft.Graph.Authentication -RequiredVersion 2.35.1 -Force -ErrorAction SilentlyContinue',
    );
    expect(renderModuleImport({ name: 'Az.Monitor' })).toBe('Import-Module Az.Monitor -Force -ErrorAction SilentlyContinue');
  });

  it('rejects a module name or version that is not plain module text', () => {
    expect(() => renderModuleImport({ name: 'Az.Monitor; Remove-Item x' })).toThrow(/invalid module name/);
    expect(() => renderModuleImport({ name: 'Az.Monitor', requiredVersion: '2.35.1 -Force; x' })).toThrow(/invalid requiredVersion/);
  });

  it('every graph entry from the file reaches the graph init script, in file order', async () => {
    const { factory, hosts } = makeFactory();
    await factory.execute('graph', 'Get-MgUser -All');
    const initScript = hosts[0].receivedCommands[0];
    const lines = sessions.graph.map(renderModuleImport);
    let at = -1;
    for (const line of lines) {
      const idx = initScript.indexOf(line);
      expect(idx).toBeGreaterThan(at);
      at = idx;
    }
  });
});
