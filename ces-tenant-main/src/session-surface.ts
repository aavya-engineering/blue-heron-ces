// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TENANT-2026A
// See LICENSE and TERMS.md.

/**
 * PowerShell session-factory surface, design §2.4 point 1.
 *
 * M0 — interface definition only, extracted from Stamper's CURRENT
 * `SessionManager` public API (`ces-stamper/src/core/SessionManager.ts`).
 * This surface "mostly needs to absorb SessionManager's TS orchestration
 * layer, not the PS1 script (already extracted)" — the underlying
 * `ces-shared/scripts/session-host.ps1` stays where it is; this interface
 * models the TypeScript orchestration on top of it.
 *
 * RATIFIED AMENDMENT (founder, 2026-07-10) — G-TENANT-1 addendum item 1:
 * every session request method below carries an optional trailing
 * `consumer: ConsumerIdentity` parameter (caller identity). INVARIANT:
 * requests without a consumer (neither per-request nor bound at surface
 * construction) are REJECTED in service mode and LOGGED in library mode.
 * See `consumer.ts`; not a silent edit — logged in `docs/M1-RECORD.md`.
 */

import type { ConsumerIdentity } from './consumer.js';
import type { SessionType } from './connection.js';

/**
 * Per-session runtime state. Verbatim shape from
 * `ces-stamper/src/core/SessionManager.ts:13-19` (`SessionState`).
 */
export interface SessionState {
  type: SessionType;
  connected: boolean;
  connectedAt: Date | null;
  lastUsedAt: Date | null;
  tokenExpiresAt: Date | null;
}

/**
 * Result of a command executed inside a persistent PowerShell host. Verbatim
 * shape from `ces-stamper/src/core/SessionManager.ts:21-26` (`PSResult`).
 */
export interface PSResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

/**
 * PowerShell session-factory surface contract. Method shapes are drawn from
 * `SessionManager`'s current public methods
 * (`ces-stamper/src/core/SessionManager.ts`); this interface does not include
 * `SessionManager`'s private methods (`spawnPersistentProcess`,
 * `queueCommand`, `sendCommand`, `startKeepalive`/`stopKeepalive`,
 * `killProcess`, `getIdentityCommand`) — those remain implementation detail
 * behind this surface, not part of the package's public contract.
 *
 * Windows-only surface (design §7): must stay cleanly separated from the
 * HTTP surface so a non-Windows consumer (muster-api) never transitively
 * pulls in a `child_process.spawn('powershell.exe', ...)` code path.
 */
export interface TenantSessionFactory {
  /**
   * Ensure the named session is connected, reconnecting if the token is near
   * expiry or the underlying process died. Source:
   * `SessionManager.ensureConnected()`, `ces-stamper/src/core/SessionManager.ts:104-139`.
   *
   * AMENDMENT 2026-07-10: carries the caller's `consumer` identity
   * (per-request override of any construction-time binding; see
   * `ConsumerIdentity`'s invariant for missing-consumer handling).
   */
  ensureConnected(type: SessionType, consumer?: ConsumerIdentity): Promise<void>;

  /**
   * Execute a command in the session's persistent process, queued so only
   * one command runs at a time per session type, with stale-connection and
   * process-death retry built in. Source: `SessionManager.execute()`,
   * `ces-stamper/src/core/SessionManager.ts:142-233`.
   *
   * AMENDMENT 2026-07-10: carries the caller's `consumer` identity (see
   * `ensureConnected`).
   */
  execute(type: SessionType, command: string, onStdout?: (chunk: string) => void, consumer?: ConsumerIdentity): Promise<PSResult>;

  /** Source: `SessionManager.getSessionState()`, `ces-stamper/src/core/SessionManager.ts:236-238`. */
  getSessionState(type: SessionType): SessionState;

  /** Source: `SessionManager.getAllSessionStates()`, `ces-stamper/src/core/SessionManager.ts:241-243`. */
  getAllSessionStates(): SessionState[];

  /** Source: `SessionManager.disconnectAll()`, `ces-stamper/src/core/SessionManager.ts:246-251`. */
  disconnectAll(): Promise<void>;

  /**
   * Connect to Microsoft Graph with explicit credentials, bypassing
   * `process.env`. Source: `SessionManager.connectMgGraph()`,
   * `ces-stamper/src/core/SessionManager.ts:256-280`.
   *
   * AMENDMENT 2026-07-10: carries the caller's `consumer` identity (see
   * `ensureConnected`).
   */
  connectMgGraph(tenantId?: string, appId?: string, certThumbprint?: string, consumer?: ConsumerIdentity): Promise<void>;

  /**
   * Connect to IPPS (Purview) with explicit credentials, bypassing
   * `process.env`. Source: `SessionManager.connectIPPS()`,
   * `ces-stamper/src/core/SessionManager.ts:285-308`.
   *
   * AMENDMENT 2026-07-10: carries the caller's `consumer` identity (see
   * `ensureConnected`).
   */
  connectIPPS(tenantId?: string, appId?: string, certThumbprint?: string, consumer?: ConsumerIdentity): Promise<void>;

  /**
   * Build the PowerShell connect command string for a session type. Source:
   * `SessionManager.buildConnectCommand()`,
   * `ces-stamper/src/core/SessionManager.ts:392-432` — hardcoded GCC
   * High/USGov literals per case (see `connection.ts`'s `ConnectionProfile`
   * doc comments for the specific literals); does not read
   * `tenantConfig.endpoints` (design §2.2, vestigial field today).
   */
  buildConnectCommand(type: SessionType, tenantId?: string, appId?: string, certThumbprint?: string): string;
}

/**
 * Sim-mode env-mutation entry point. Source:
 * `ces-stamper/src/core/StacksimMode.ts:103-131`
 * (`enableStacksimMode()`). Does not touch `TenantSessionFactory`'s API at
 * all (design §2.4) — it mutates `process.env.PSModulePath` / `Path` /
 * `STACKSIM_SERVER_URL` *before* the first session factory spawns a process,
 * so persistent PowerShell hosts inherit an environment where fake
 * same-named modules resolve first. There is currently no branch inside
 * `SessionManager` itself for sim-ness — it is 100% external environment
 * state (design §2.4). The registry's `kind` field (`registry.ts`) is
 * intended to make this seam first-class and introspectable; this interface
 * preserves the CURRENT env-mutation mechanism as-is (M0 makes no behavior
 * change).
 */
export interface StacksimModeController {
  /**
   * Mutate `process.env` so every PowerShell process this surface spawns
   * resolves cmdlets against tenant-stacksim instead of real Microsoft
   * endpoints. Must run before the first session spawn. Source:
   * `enableStacksimMode()`, `ces-stamper/src/core/StacksimMode.ts:103-131`.
   */
  enableStacksimMode(serverUrl?: string): Promise<void>;
}
