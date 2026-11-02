// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * W7-EO (1) respawn resilience (run 61b's E7B flake): when the PowerShell host dies during a fetch, the EO log
 * names the command in flight, the fetch is retried (the factory's re-queue, then once more by EO when that
 * still fails), and the outcome is logged. Drives the real SessionManager over ces-tenant's spawn seam with
 * fake session hosts (no powershell.exe).
 */
import { describe, it, expect } from '@jest/globals';
import type { TenantConfig } from 'ces-shared/config';
import { SessionManager, RESPAWN_IN_FLIGHT_LOG, RESPAWN_RETRY_LOG, RESPAWN_FETCH_LOG } from '../../src/eo/core/SessionManager.js';

const HOST_READY = 'STAMPER_HOST_READY';
const CMD_END = 'STAMPER_CMD_END';

class FakeStream {
  private listeners: Array<(d: Buffer) => void> = [];
  on(_e: 'data', l: (d: Buffer) => void): this { this.listeners.push(l); return this; }
  removeListener(_e: 'data', l: (d: Buffer) => void): this { this.listeners = this.listeners.filter(x => x !== l); return this; }
  emit(text: string): void { for (const l of [...this.listeners]) l(Buffer.from(text)); }
}

/** A session host that answers every command, except that it dies on a command matching `dieOn`. */
class FakeHost {
  stdout = new FakeStream();
  stderr = new FakeStream();
  killed = false;
  exitCode: number | null = null;
  private buffered = '';
  private handlers: Record<string, Array<(...a: any[]) => void>> = {};
  constructor(private readonly dieOn: (command: string) => boolean) {}
  stdin = {
    write: (chunk: string): boolean => {
      this.buffered += chunk;
      let idx: number;
      while ((idx = this.buffered.indexOf(`${CMD_END}\n`)) !== -1) {
        const command = this.buffered.slice(0, idx);
        this.buffered = this.buffered.slice(idx + CMD_END.length + 1);
        setImmediate(() => {
          if (this.dieOn(command)) {
            this.exitCode = 1;
            for (const h of [...(this.handlers.close ?? [])]) h(1);
            return;
          }
          this.stdout.emit('{"value":[]}\nSTAMPER_STDOUT_END\nSTAMPER_EXIT:0\n');
          this.stderr.emit('STAMPER_STDERR_END');
        });
      }
      return true;
    },
    end: (): void => undefined,
  };
  kill(): void { this.killed = true; if (this.exitCode === null) this.exitCode = 0; }
  on(e: string, l: (...a: any[]) => void): this { (this.handlers[e] ??= []).push(l); return this; }
  removeListener(e: string, l: (...a: any[]) => void): this { this.handlers[e] = (this.handlers[e] ?? []).filter(x => x !== l); return this; }
}

const tenant = { tenantSlug: 'w7-eo-respawn', tenantId: 'tenant-w7', appId: 'app-w7', certPath: 'x.pfx', certThumbprint: 'THUMB', domain: 'w7.example.test', targetTenantDomain: 'w7.example.test' } as TenantConfig;
const FETCH = 'Get-MgReportAuthenticationMethodUserRegistrationDetail -All | ConvertTo-Json -Depth 10';

function harness(deaths: number) {
  let left = deaths;
  const hosts: FakeHost[] = [];
  const warns: string[] = [];
  const spawnFn = () => {
    const h = new FakeHost(cmd => cmd.includes('Get-MgReport') && left-- > 0);
    hosts.push(h);
    setImmediate(() => h.stdout.emit(`${HOST_READY}\n`));
    return h;
  };
  const logger = { log: () => undefined, error: () => undefined, warn: (...a: unknown[]) => { warns.push(a.map(String).join(' ')); } };
  const sm = new SessionManager(tenant, { spawnFn, sessionHostScript: 'X:\\fake\\session-host.ps1', logger });
  return { sm, hosts, warns };
}

describe('W7-EO respawn resilience (SessionManager)', () => {
  it('a host death mid-fetch: the factory respawns and re-queues; EO logs the command in flight and the retried fetch', async () => {
    const { sm, hosts, warns } = harness(1);
    const r = await sm.execute('mgraph', FETCH);
    expect(r.stdout).toContain('{"value":[]}');
    expect(hosts.length).toBe(2);
    const i = warns.findIndex(w => w.includes('Process died during execute for graph, respawning (attempt 1/5)'));
    expect(i).toBeGreaterThanOrEqual(0);
    expect(warns[i + 1]).toBe(`${RESPAWN_IN_FLIGHT_LOG} graph session: ${FETCH.substring(0, 120)}`);
    expect(warns).toContain(`${RESPAWN_FETCH_LOG} succeeded (factory re-queue): ${FETCH.substring(0, 120)}`);
    await sm.disconnectAll();
  });

  it("the factory's five respawns all fail: EO retries the fetch once, which succeeds", async () => {
    const { sm, warns } = harness(6);
    const r = await sm.execute('mgraph', FETCH);
    expect(r.exitCode).toBe(0);
    expect(warns.filter(w => w.startsWith(RESPAWN_IN_FLIGHT_LOG))).toHaveLength(5);
    expect(warns.some(w => w.startsWith(`${RESPAWN_RETRY_LOG} ${FETCH.substring(0, 120)}`))).toBe(true);
    expect(warns).toContain(`${RESPAWN_FETCH_LOG} succeeded (EO retry): ${FETCH.substring(0, 120)}`);
    await sm.disconnectAll();
  });

  it('the EO retry fails too: the error reaches the fetcher (an error signal) and the failure is logged', async () => {
    const { sm, warns } = harness(1000);
    await expect(sm.execute('mgraph', FETCH)).rejects.toThrow(/died/);
    expect(warns.filter(w => w.startsWith(RESPAWN_RETRY_LOG))).toHaveLength(1);
    expect(warns.some(w => w.startsWith(`${RESPAWN_FETCH_LOG} failed after the EO retry: ${FETCH.substring(0, 120)}`))).toBe(true);
    await sm.disconnectAll();
  });

  it('no respawn: a failure is not retried and nothing is logged by EO', async () => {
    const { sm, warns } = harness(0);
    await sm.execute('mgraph', FETCH);
    expect(warns.filter(w => w.startsWith('[EO SessionManager]'))).toEqual([]);
    await sm.disconnectAll();
  });
});
