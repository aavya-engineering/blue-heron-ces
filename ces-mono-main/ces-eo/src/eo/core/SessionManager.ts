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

import {
  PersistentSessionFactory,
  type PersistentSessionFactoryOptions,
  type PSResult,
  type SessionState,
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

export class SessionManager extends PersistentSessionFactory {
  /**
   * FX2-EO1: the tenant this session was opened for. A session is bound to exactly one tenant;
   * `TenantSessionRegistry` refuses to hand it out for any other slug / tenant GUID.
   */
  readonly boundTenantSlug: string | undefined;
  readonly boundTenantId: string | undefined;

  constructor(
    tenantConfig: TenantConfig,
    options: Omit<PersistentSessionFactoryOptions, 'consumer'> = {},
  ) {
    super(tenantConfig, {
      consumer: { ...EO_CONSUMER },
      ...(tenantConfig.tenantSlug !== undefined ? { tenantSlug: tenantConfig.tenantSlug } : {}),
      ...options,
    });
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
  override execute(engine: string, command: string, onStdout?: (chunk: string) => void): Promise<PSResult> {
    const type: SessionType = ENGINE_SESSION_MAP[engine] ?? 'graph';
    return super.execute(type, command, onStdout);
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
