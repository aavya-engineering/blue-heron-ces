// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * SessionManager — thin Stamper-facing shim over `ces-tenant`'s
 * `PersistentSessionFactory` (G-TENANT-M1 cutover).
 *
 * The ~700-line TS orchestration layer that used to live here (persistent
 * `powershell.exe` hosts, `STAMPER_*` marker protocol, per-session queueing,
 * stale-connection/respawn retry, hardcoded GCC High/USGov connect commands)
 * moved into the `ces-tenant` package as its `TenantSessionFactory`
 * implementation. This file keeps Stamper's historical construction shape
 * (`new SessionManager(clientConfig, dryRun)`) so:
 *  - every internal call site (routes, TaskRunner, StamperEngine,
 *    PowerShellAdapter, BaselineProvisioner) keeps working unchanged;
 *  - the M0 characterization tests (`tests/unit/SessionManager.test.ts`)
 *    still pass against the ces-tenant-backed implementation.
 *
 * INTERNAL-ONLY since GP-STAMPER-1 M1 (2026-07-25): ces-ao's G-TENANT-M5
 * cutover landed 2026-07-11 (zero live `ces-stamper/core/session` /
 * `ces-stamper/config/stamper` imports remain anywhere in the estate), so
 * both compat export paths were removed from package.json. The one
 * sanctioned external deep import is `ces-stamper/adapters/powershell`
 * (FD-ADAPTER-SHIM: KEEP — `docs/design/adapter-shim-decision.md`).
 *
 * Consumer identity (ratified amendment 2026-07-10): every session request
 * made through this shim carries `{ module: 'ces-stamper' }` bound at
 * construction.
 */

import {
  PersistentSessionFactory,
  type PersistentSessionFactoryOptions,
  type SessionCredentials,
  type PSResult,
  type SessionState,
} from 'ces-tenant';
import { ENGINE_SESSION_MAP, type SessionType } from 'ces-shared/session';

export type { SessionType };
export type { SessionState, PSResult };

// Re-exported for existing consumers (canonical home: ces-shared/session).
export { ENGINE_SESSION_MAP };

/**
 * The credential fields the underlying factory reads. Stamper's
 * `ClientConfig` (= `ces-shared` `TenantConfig`) satisfies this
 * structurally, so all existing `new SessionManager(clientConfig, ...)`
 * call sites typecheck unchanged.
 */
export type SessionManagerCredentials = SessionCredentials & { tenantSlug?: string };

export class SessionManager extends PersistentSessionFactory {
  constructor(
    config: SessionManagerCredentials,
    dryRun: boolean = false,
    options: Omit<PersistentSessionFactoryOptions, 'dryRun'> = {},
  ) {
    super(config, {
      dryRun,
      consumer: { module: 'ces-stamper', purpose: 'stamper session' },
      ...(config.tenantSlug !== undefined ? { tenantSlug: config.tenantSlug } : {}),
      ...options,
    });
  }
}
