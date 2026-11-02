// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TENANT-2026A
// See LICENSE and TERMS.md.

/**
 * Sim-tenant launch-context surface — covers ces-tester as a NAMED
 * consumer, folded into M0 per founder direction 2026-07-10.
 *
 * ces-tester's `stamper-launcher` spawns Stamper's CLI directly (not through
 * `TenantSessionFactory`) with `--stacksim [url]` and needs the same
 * environment bundle `StacksimMode.enableStacksimMode()` computes internally
 * for its own in-process spawns (`ces-stamper/src/core/StacksimMode.ts:103-131`).
 * Source: `ces-tester/PLAN.md` M1 task 4 — "spawn `powershell.exe` running
 * `stamper init-tenant`-emitted-slug `translate` + `auto` execute, with
 * `--stacksim [url]` env injection... (PSModulePath/PATH/
 * `STACKSIM_SERVER_URL` into the child env before spawn, per arch §5
 * 'Stamper launch')" and the Interface Contract Summary table row 3:
 * "spawn `powershell.exe` running `stamper translate ... --tenant <slug>`
 * with `--stacksim [url]` env injected."
 *
 * This is a launch-context DATA contract, not a session factory — ces-tester
 * spawns Stamper as an external CLI process, it does not call into
 * `TenantSessionFactory` (that surface is Stamper/EO's in-process
 * orchestration layer, design §2.4 point 1). What ces-tester needs is the
 * same env values, requestable for a `kind: 'sim'` tenant, so its launcher
 * does not hand-reconstruct `StacksimMode`'s env-mutation logic a second
 * time (the exact duplication pattern design §1 documents happening three
 * times already).
 *
 * RATIFIED AMENDMENT (founder, 2026-07-10) — G-TENANT-1 addendum item 1:
 * `getSimLaunchEnv()` (a connection-context request) carries an optional
 * trailing `consumer: ConsumerIdentity`. INVARIANT: requests without a
 * consumer are REJECTED in service mode and LOGGED in library mode. See
 * `consumer.ts`; not a silent edit — logged in `docs/M1-RECORD.md`.
 */

import type { ConsumerIdentity } from './consumer.js';
import type { TenantKind } from './registry.js';

/**
 * The env bundle a `kind: 'sim'` tenant's consumer must inject into a child
 * process before spawning Stamper (or any other PowerShell-spawning
 * consumer) against it. Field values mirror
 * `enableStacksimMode()`'s three mutations verbatim
 * (`ces-stamper/src/core/StacksimMode.ts:118-125`):
 * `process.env.PSModulePath = "${psmodulesDir};${psHomeModules}"`,
 * `process.env.Path = "${azShimDir};${existingPath}"`,
 * `process.env.STACKSIM_SERVER_URL = url`.
 */
export interface SimLaunchEnv {
  /**
   * Value to set as the child process's `PSModulePath`. Source:
   * `StacksimMode.ts:118-119` — `${psmodulesDir};${psHomeModules}`, where
   * `psmodulesDir` is `<stacksimRoot>/psmodules` and `psHomeModules` is
   * queried from the local `$PSHOME` (`queryPsHomeModules()`,
   * `StacksimMode.ts:56-72`). Fake same-named modules must resolve first;
   * built-ins stay reachable via the appended `$PSHOME\Modules`.
   */
  psModulePath: string;

  /**
   * Value to set as the child process's `Path`, with the az shim directory
   * prepended. Source: `StacksimMode.ts:121-122` —
   * `${azShimDir};${existingPath}`, where `azShimDir` is
   * `<stacksimRoot>/azshim`. Prepending ensures a bare `az` invocation hits
   * the shim, never a real installed CLI.
   */
  path: string;

  /**
   * Value to set as the child process's `STACKSIM_SERVER_URL`. Source:
   * `StacksimMode.ts:124-125` — `serverUrl ?? process.env.STACKSIM_SERVER_URL
   * ?? DEFAULT_STACKSIM_SERVER_URL` (`'http://127.0.0.1:4390'`,
   * `StacksimMode.ts:43`). The sim's generated PowerShell modules read this
   * to know where to POST.
   */
  stacksimServerUrl: string;
}

/**
 * Launch-context provider contract. NEW-SCOPE relative to any single
 * existing function — `StacksimMode.enableStacksimMode()` computes and
 * APPLIES this bundle to `process.env` in one step for Stamper's own
 * in-process spawns; this interface asks for the bundle as DATA, so an
 * external process (ces-tester's launcher) can inject it into a child
 * process env without going through `process.env` mutation of the calling
 * process at all. The underlying values are 1:1 extracted from
 * `enableStacksimMode()` (see `SimLaunchEnv` field docs) — only the
 * data-vs-mutate shape is new.
 */
export interface TenantLaunchContextProvider {
  /**
   * Return the launch-context env bundle for a `kind: 'sim'` tenant. Callers
   * (e.g. ces-tester's `stamper-launcher`, `ces-tester/PLAN.md` M1 task 4)
   * merge this into the child process's env before spawning
   * `powershell.exe`. Implementations MUST reject (or the registry MUST
   * refuse to resolve) a request against a `kind: 'live'` tenant — this
   * bundle only makes sense for sim tenants; requesting it for a live
   * tenant would silently redirect real Microsoft-endpoint traffic through
   * the sim shim, the same class of hazard the `kind` discriminator
   * (design §2.1) exists to prevent.
   *
   * AMENDMENT 2026-07-10: carries the caller's `consumer` identity
   * (per-request override of any construction-time binding; see
   * `ConsumerIdentity`'s invariant for missing-consumer handling).
   */
  getSimLaunchEnv(tenantSlug: string, kind: TenantKind, consumer?: ConsumerIdentity): Promise<SimLaunchEnv>;
}
