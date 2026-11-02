// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * SessionManager -- thin ces-eo-facing shim over `ces-tenant`'s
 * `PersistentSessionFactory` (G-TENANT-M2 cutover).
 *
 * The ~630-line TS orchestration layer that used to live here (persistent
 * `powershell.exe` hosts, `STAMPER_*` marker protocol, per-session queueing,
 * stale-connection/respawn retry, hardcoded GCC High/USGov connect commands,
 * SPO keepalive) was a near line-for-line duplicate of Stamper's
 * `SessionManager.ts` (design doc section 1, item 2). That logic now lives in
 * the `ces-tenant` package as its `TenantSessionFactory` implementation, which
 * Stamper already consumes (G-TENANT-M1); this shim cuts ces-eo over to the
 * same package instead of independently maintaining the duplicate.
 *
 * The shim keeps ces-eo's historical construction and call shapes so every
 * internal call site keeps working unchanged:
 *  - `new SessionManager(tenantConfig)` -- `TenantConfig` structurally
 *    satisfies `ces-tenant`'s `SessionCredentials`;
 *  - `execute(engine, command)` takes a registry ENGINE name ('mgraph',
 *    'exchange', ...) and maps it to a session type via `ENGINE_SESSION_MAP`
 *    (the underlying factory takes the session type directly);
 *  - `ensureConnected()` defaults to the 'graph' session.
 *
 * Consumer identity (ratified amendment 2026-07-10): every session request
 * made through this shim carries `{ module: 'ces-eo' }` bound at
 * construction.
 *
 * Sim-mode note (design doc section 5, M2 gate): ces-eo implements NO
 * sim-mode logic of its own -- running against a `kind: 'sim'` tenant is a
 * side effect of consuming `ces-tenant` (`FileTenantRegistry` +
 * `StacksimModeController`); see `tests/unit/tenant-cutover.test.ts`.
 */

import { spawn } from 'node:child_process';
import {
  PersistentSessionFactory,
  type PersistentSessionFactoryOptions,
  type PSResult,
  type SessionState,
  type SpawnFn,
} from 'ces-tenant';
import type { TenantConfig } from 'ces-shared/config';
import { ENGINE_SESSION_MAP, type SessionType } from 'ces-shared/session';

export type { SessionType };
export type { SessionState, PSResult };

// Re-exported for existing consumers (canonical home: ces-shared/session).
export { ENGINE_SESSION_MAP };

/** Caller identity bound to every request this module makes (ratified amendment 2026-07-10). */
export const EO_CONSUMER = { module: 'ces-eo', purpose: 'evidence collection' } as const;

const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000; // 5 minutes (mirrors the factory's reconnect buffer)

/**
 * W7-EO (respawn resilience, V68): the EO log lines around a PowerShell session respawn. The first names the
 * command in flight when the factory reported the process death; the second marks EO's one retry of a fetch
 * that still failed after the respawn; the third reports the outcome of a fetch during which a respawn happened.
 */
export const RESPAWN_IN_FLIGHT_LOG = '[EO SessionManager] session respawn; command in flight:';
export const RESPAWN_RETRY_LOG = '[EO SessionManager] retrying the fetch once after a session respawn:';
export const RESPAWN_FETCH_LOG = '[EO SessionManager] fetch after a session respawn';
/** The factory's process-death warning (ces-tenant session-factory.ts L351-353). */
const FACTORY_RESPAWN_RE = /Process died during execute for (\w+), respawning/;
/** Commands are logged truncated, as the factory records them (connect lines carry the app and certificate ids). */
const logged = (command: string): string => command.substring(0, 120);

interface RespawnState {
  /** The command in flight per session type (one at a time: the fetcher is sequential, FX-15). */
  inFlight: Map<string, string>;
  /** Respawns the factory has reported since construction. */
  respawns: number;
  logger: Pick<Console, 'log' | 'warn' | 'error'>;
}

/**
 * W7-EO: a write to the stdin of a PowerShell host that has just died emits an 'error' event on that stream;
 * the factory attaches no listener there, so Node raised it as an uncaught exception and the server process
 * (and the assess stream with it) ended. The default spawn here logs that error instead (the W7-TEN fix
 * belongs in ces-tenant; this is EO's guard).
 */
function guardedSpawn(state: RespawnState): SpawnFn {
  return (cmd, args, opts) => {
    const proc = spawn(cmd, [...args], opts);
    proc.stdin?.on('error', (err: Error) => state.logger.warn(`[EO SessionManager] session host stdin error (process gone): ${err.message}`));
    return proc;
  };
}

/** The factory's logger, forwarded unchanged; a respawn warning also logs the command in flight. */
function respawnLogger(state: RespawnState): Pick<Console, 'log' | 'warn' | 'error'> {
  return {
    log: (...a: unknown[]) => state.logger.log(...a),
    error: (...a: unknown[]) => state.logger.error(...a),
    warn: (...a: unknown[]) => {
      state.logger.warn(...a);
      const m = FACTORY_RESPAWN_RE.exec(String(a[0] ?? ''));
      if (m) {
        state.respawns++;
        state.logger.warn(`${RESPAWN_IN_FLIGHT_LOG} ${m[1]} session: ${logged(state.inFlight.get(m[1]) ?? '(none recorded)')}`);
      }
    },
  };
}

export class SessionManager extends PersistentSessionFactory {
  /**
   * FX2-EO1: the tenant this session was opened for. A session is bound to exactly one tenant;
   * `TenantSessionRegistry` refuses to hand it out for any other slug / tenant GUID.
   */
  readonly boundTenantSlug: string | undefined;
  readonly boundTenantId: string | undefined;
  private readonly respawn: RespawnState;

  constructor(
    tenantConfig: TenantConfig,
    options: Omit<PersistentSessionFactoryOptions, 'consumer'> = {},
  ) {
    const respawn: RespawnState = { inFlight: new Map(), respawns: 0, logger: options.logger ?? console };
    super(tenantConfig, {
      consumer: { ...EO_CONSUMER },
      ...(tenantConfig.tenantSlug !== undefined ? { tenantSlug: tenantConfig.tenantSlug } : {}),
      ...options,
      spawnFn: options.spawnFn ?? guardedSpawn(respawn),
      logger: respawnLogger(respawn),
    });
    this.respawn = respawn;
    this.boundTenantSlug = options.tenantSlug ?? tenantConfig.tenantSlug;
    this.boundTenantId = tenantConfig.tenantId;
  }

  /** ces-eo call sites historically default to the graph session. */
  override ensureConnected(type: SessionType = 'graph'): Promise<void> {
    return super.ensureConnected(type);
  }

  /**
   * Execute a command for the given registry ENGINE name ('mgraph',
   * 'exchange', 'purview', 'az', ...). ces-eo's historical signature; the
   * engine-to-session-type mapping stays here so callers are unchanged while
   * the underlying `ces-tenant` factory works in session types.
   */
  override async execute(engine: string, command: string, onStdout?: (chunk: string) => void): Promise<PSResult> {
    const type: SessionType = ENGINE_SESSION_MAP[engine] ?? 'graph';
    // W7-EO (respawn resilience): the factory re-queues the command after a respawn; when the call still fails
    // and a respawn happened during it, EO retries the fetch once. Every respawn ends in a logged fetch outcome.
    const before = this.respawn.respawns;
    this.respawn.inFlight.set(type, command);
    try {
      const result = await super.execute(type, command, onStdout);
      if (this.respawn.respawns > before) this.respawn.logger.warn(`${RESPAWN_FETCH_LOG} succeeded (factory re-queue): ${logged(command)}`);
      return result;
    } catch (err) {
      if (this.respawn.respawns === before) throw err;
      this.respawn.logger.warn(`${RESPAWN_RETRY_LOG} ${logged(command)} (${err instanceof Error ? err.message : String(err)})`);
      try {
        const result = await super.execute(type, command, onStdout);
        this.respawn.logger.warn(`${RESPAWN_FETCH_LOG} succeeded (EO retry): ${logged(command)}`);
        return result;
      } catch (retryErr) {
        this.respawn.logger.warn(`${RESPAWN_FETCH_LOG} failed after the EO retry: ${logged(command)} (${retryErr instanceof Error ? retryErr.message : String(retryErr)})`);
        throw retryErr;
      }
    } finally {
      this.respawn.inFlight.delete(type);
    }
  }

  /** Check if the graph session is connected and its token is not near expiry (historical ces-eo helper). */
  isConnected(): boolean {
    const graphState = this.getSessionState('graph');
    return (
      graphState.connected &&
      graphState.tokenExpiresAt !== null &&
      graphState.tokenExpiresAt.getTime() > Date.now() + TOKEN_EXPIRY_BUFFER_MS
    );
  }
}
