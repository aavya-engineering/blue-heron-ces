// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TENANT-2026A
// See LICENSE and TERMS.md.

/**
 * W7-TEN (2026-10-29): a stream error on a dying session host ("write EOF") or a destroyed stdin
 * must not crash the process; the in-flight command fails into executeCore's existing respawn loop,
 * which re-sends it on the respawned host. Also pins that loop (re-send, 5 attempts).
 *
 * The fake stdin/stdout/stderr are real EventEmitters, so an 'error' emitted with no listener throws
 * as Node's streams do; vitest fails the run on such an uncaught error, so a passing test is the
 * survival proof.
 */

import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

import {
  PersistentSessionFactory,
  type SessionCredentials,
  type SpawnFn,
  type SpawnedProcessLike,
} from '../impl/session-factory.js';

const CREDS: SessionCredentials = {
  tenantId: 'tid-1',
  appId: 'app-1',
  certThumbprint: 'THUMB1',
  targetTenantDomain: 'contoso.onmicrosoft.us',
};

const USER_CMD = 'Get-MgUser -All';

/** What a host does when it receives the user command. */
type Fault = 'none' | 'eof-error' | 'write-throws' | 'close';

class StreamFake extends EventEmitter {
  destroyed = false;
  writable = true;
  writableEnded = false;
}

class FaultyPsHost implements SpawnedProcessLike {
  readonly stdinStream = new StreamFake();
  readonly stdoutStream = new StreamFake();
  readonly stderrStream = new StreamFake();
  private readonly proc = new EventEmitter();
  private stdinBuf = '';
  readonly receivedCommands: string[] = [];
  killed = false;
  exitCode: number | null = null;

  constructor(private readonly fault: Fault) {
    setImmediate(() => this.stdoutStream.emit('data', Buffer.from('STAMPER_HOST_READY\n')));
  }

  readonly stdin = Object.assign(this.stdinStream, {
    write: (chunk: string): void => {
      if (this.fault === 'write-throws' && chunk.includes(USER_CMD)) {
        throw new Error('write after host exit');
      }
      this.stdinBuf += chunk;
      const markerIdx = this.stdinBuf.indexOf('STAMPER_CMD_END\n');
      if (markerIdx === -1) return;
      const command = this.stdinBuf.slice(0, markerIdx).trimEnd();
      this.stdinBuf = this.stdinBuf.slice(markerIdx + 'STAMPER_CMD_END\n'.length);
      this.receivedCommands.push(command);

      if (command.includes(USER_CMD) && this.fault === 'eof-error') {
        // As on Windows: the host has exited; the pipe reports EOF on a later tick, no 'close' yet.
        this.exitCode = 1;
        setImmediate(() => {
          const err = Object.assign(new Error('write EOF'), { code: 'EOF' });
          this.stdinStream.destroyed = true;
          this.stdinStream.emit('error', err);
        });
        return;
      }
      if (command.includes(USER_CMD) && this.fault === 'close') {
        this.exitCode = 1;
        setImmediate(() => this.proc.emit('close', 1));
        return;
      }
      setImmediate(() => {
        this.stderrStream.emit('data', Buffer.from('STAMPER_STDERR_END\n'));
        this.stdoutStream.emit('data', Buffer.from(`${command.includes(USER_CMD) ? 'user-a' : 'connected'}\nSTAMPER_STDOUT_END\nSTAMPER_EXIT:0\n`));
      });
    },
    end: (): void => {},
  });

  readonly stdout = this.stdoutStream;
  readonly stderr = this.stderrStream;

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

/** `faults[i]` is the behaviour of the i-th spawned host; hosts beyond the list behave normally. */
function makeFactory(faults: Fault[]) {
  const hosts: FaultyPsHost[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const logger = {
    log: () => {},
    warn: (msg: string) => warnings.push(msg),
    error: (msg: string) => errors.push(msg),
  };
  const spawnFn: SpawnFn = vi.fn(() => {
    const host = new FaultyPsHost(faults[hosts.length] ?? 'none');
    hosts.push(host);
    return host;
  });
  const factory = new PersistentSessionFactory(CREDS, { spawnFn, logger });
  return { factory, hosts, warnings, errors, spawnFn };
}

const userCommandsOn = (host: FaultyPsHost): string[] => host.receivedCommands.filter((c) => c.includes(USER_CMD));

describe('PersistentSessionFactory -- stdin stream errors on a dying host (W7-TEN)', () => {
  it('a "write EOF" error on stdin is captured, logged with the command in flight, and the command is re-sent on a respawned host', async () => {
    const { factory, hosts, warnings } = makeFactory(['eof-error']);

    const result = await factory.execute('graph', USER_CMD);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('user-a');
    expect(hosts).toHaveLength(2);
    expect(userCommandsOn(hosts[0])).toHaveLength(1);
    expect(userCommandsOn(hosts[1])).toEqual(userCommandsOn(hosts[0]));
    expect(warnings).toContainEqual(
      expect.stringMatching(/stdin error for graph \(process gone\): write EOF; command in flight: Get-MgUser -All/),
    );
    expect(warnings).toContainEqual(
      expect.stringContaining('Process died during execute for graph, respawning (attempt 1/5)'),
    );
  });

  it('a stream error with no command in flight is logged and does not crash', async () => {
    const { factory, hosts, warnings } = makeFactory([]);
    await factory.ensureConnected('graph');

    hosts[0].stdoutStream.emit('error', new Error('pipe broken'));
    hosts[0].stdinStream.emit('error', new Error('write EOF'));

    expect(warnings).toContainEqual(expect.stringContaining('stdout error for graph (process gone): pipe broken; command in flight: none'));
    expect(warnings).toContainEqual(expect.stringContaining('stdin error for graph (process gone): write EOF; command in flight: none'));
    // The factory still serves commands.
    const result = await factory.execute('graph', USER_CMD);
    expect(result.stdout).toContain('user-a');
  });

  it('an error from a replaced host does not fail the command running on the new host', async () => {
    const { factory, hosts } = makeFactory(['eof-error']);
    const result = await factory.execute('graph', USER_CMD);
    expect(hosts).toHaveLength(2);

    // A late error from the dead first host: logged only, the live session is untouched.
    hosts[0].stdinStream.emit('error', new Error('write EOF'));
    const again = await factory.execute('graph', USER_CMD);
    expect(again.stdout).toContain('user-a');
    expect(result.stdout).toContain('user-a');
    expect(hosts).toHaveLength(2);
  });
});

describe('PersistentSessionFactory -- guarded stdin write (W7-TEN)', () => {
  it('does not write to a destroyed stdin; respawns and re-sends the command', async () => {
    const { factory, hosts, warnings } = makeFactory([]);
    await factory.ensureConnected('graph');
    // The race the liveness check misses: the pipe is gone but the exit code is not set yet.
    hosts[0].stdinStream.destroyed = true;
    expect(hosts[0].exitCode).toBeNull();

    const result = await factory.execute('graph', USER_CMD);

    expect(result.stdout).toContain('user-a');
    expect(userCommandsOn(hosts[0])).toHaveLength(0);
    expect(hosts).toHaveLength(2);
    expect(userCommandsOn(hosts[1])).toHaveLength(1);
    expect(warnings).toContainEqual(
      expect.stringContaining('Process died during execute for graph, respawning (attempt 1/5)'),
    );
  });

  it('does not write to a stdin that is no longer writable (ended)', async () => {
    const { factory, hosts } = makeFactory([]);
    await factory.ensureConnected('graph');
    hosts[0].stdinStream.writable = false;
    hosts[0].stdinStream.writableEnded = true;

    const result = await factory.execute('graph', USER_CMD);

    expect(result.stdout).toContain('user-a');
    expect(userCommandsOn(hosts[0])).toHaveLength(0);
    expect(userCommandsOn(hosts[1])).toHaveLength(1);
  });

  it('a write that throws fails into the respawn path and the command is re-sent', async () => {
    const { factory, hosts } = makeFactory(['write-throws']);

    const result = await factory.execute('graph', USER_CMD);

    expect(result.stdout).toContain('user-a');
    expect(hosts).toHaveLength(2);
    expect(userCommandsOn(hosts[1])).toHaveLength(1);
  });
});

describe('PersistentSessionFactory -- existing respawn loop unchanged (W7-TEN pin)', () => {
  it('re-sends the identical wrapped command after the host dies (close) mid-command', async () => {
    const { factory, hosts, warnings } = makeFactory(['close']);

    const result = await factory.execute('graph', USER_CMD);

    expect(result.stdout).toContain('user-a');
    expect(hosts).toHaveLength(2);
    expect(userCommandsOn(hosts[0])).toEqual([`$ErrorActionPreference = "Stop"\n${USER_CMD}`]);
    expect(userCommandsOn(hosts[1])).toEqual(userCommandsOn(hosts[0]));
    expect(warnings).toContainEqual(
      expect.stringContaining('Process died during execute for graph, respawning (attempt 1/5)'),
    );
  });

  it('gives up after 5 respawns (1 + 5 hosts) and rejects', async () => {
    const { factory, hosts, errors } = makeFactory(['eof-error', 'eof-error', 'eof-error', 'eof-error', 'eof-error', 'eof-error']);

    await expect(factory.execute('graph', USER_CMD)).rejects.toThrow(/died \(stdin error: write EOF\) during command execution/);

    expect(hosts).toHaveLength(6);
    for (const host of hosts) expect(userCommandsOn(host)).toHaveLength(1);
    expect(errors).toContainEqual(expect.stringContaining('graph respawn failed after 5 attempts, giving up.'));
  });
});

/**
 * W7-TEN2 (2026-10-29): a host built only to the exported contract (`SpawnedStdio.on('data')`,
 * `SpawnedStdin.write/end`), shaped like the consumers' spawn-seam fakes: its stdout/stderr `on`
 * ignores the event name, and its stdin has no `on` and no writable/destroyed/writableEnded.
 * The factory must not take that for a dead host (no 'error' listener filed as a data listener).
 */
class ContractStream {
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

class ContractHost implements SpawnedProcessLike {
  readonly stdout = new ContractStream();
  readonly stderr = new ContractStream();
  private readonly proc = new EventEmitter();
  private buf = '';
  readonly receivedCommands: string[] = [];
  killed = false;
  exitCode: number | null = null;

  constructor() {
    setImmediate(() => this.stdout.emit('STAMPER_HOST_READY\n'));
  }

  readonly stdin = {
    write: (chunk: string): boolean => {
      this.buf += chunk;
      let idx: number;
      while ((idx = this.buf.indexOf('STAMPER_CMD_END\n')) !== -1) {
        const command = this.buf.slice(0, idx).trimEnd();
        this.buf = this.buf.slice(idx + 'STAMPER_CMD_END\n'.length);
        this.receivedCommands.push(command);
        setImmediate(() => {
          this.stdout.emit(`${command.includes(USER_CMD) ? 'user-a' : 'connected'}\nSTAMPER_STDOUT_END\nSTAMPER_EXIT:0\n`);
          this.stderr.emit('STAMPER_STDERR_END');
        });
      }
      return true;
    },
    end: (): void => undefined,
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

describe('PersistentSessionFactory -- contract-minimal host is healthy (W7-TEN2)', () => {
  it('connects and executes on one host; no stream-error listener is attached to a data-only stream', async () => {
    const hosts: ContractHost[] = [];
    const warnings: string[] = [];
    const spawnFn: SpawnFn = vi.fn(() => {
      const host = new ContractHost();
      hosts.push(host);
      return host;
    });
    const factory = new PersistentSessionFactory(CREDS, {
      spawnFn,
      logger: { log: () => {}, warn: (msg: string) => warnings.push(msg), error: () => {} },
    });

    const result = await factory.execute('graph', USER_CMD);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('user-a');
    expect(hosts).toHaveLength(1);
    expect(hosts[0].receivedCommands.filter((c) => c.includes(USER_CMD))).toHaveLength(1);
    expect(warnings.filter((w) => /error for graph \(process gone\)|respawning/.test(w))).toEqual([]);
  });
});
