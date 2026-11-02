// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FC-ST-3 step 1 (EC milestone M4b, ST-16; REQ-ces-stamper-ec-autostart /
// REQ-ces-stamper-ec-launcher-adoption): GuiServer's Evidence Collector auto-start check,
// extracted into its own module so it is testable with every dependency faked — no real spawn,
// no real HTTP health check, no live tenant or non-localhost endpoint.
//
// Fixes the wrong `../eo` working folder (GuiServer.ts previously hardcoded a cwd that has never
// existed) by relying on ensureEcRunning()'s own default (`../ces-ec`, the real ces-ec module
// root, resolved relative to process.cwd() — the caller's own module root at runtime) unless
// CES_EC_CWD overrides it. Gated on CES_EC_AUTOSTART=1, not on EVIDENCE_OPS_SECRET (that secret
// is EC's own bearer-auth secret for its ingest/index routes — unrelated to whether Stamper should
// spawn a background process).
import {
  ensureEcRunning,
  type EnsureEcRunningResult,
  type SpawnFn,
  type HealthCheckFn,
  type SleepFn,
} from 'ces-shared/launcher';

export interface EcAutostartDeps {
  ecUrl?: string;
  env?: NodeJS.ProcessEnv;
  spawnFn?: SpawnFn;
  healthCheckFn?: HealthCheckFn;
  sleepFn?: SleepFn;
}

/**
 * Always health-checks EC (cheap, 2s timeout); spawns it only when unhealthy AND
 * `env.CES_EC_AUTOSTART === '1'`. Returns one of the four EnsureEcRunningResult states —
 * GuiServer surfaces this in its startup log and the /health route.
 */
export async function checkEcAutostart(deps: EcAutostartDeps = {}): Promise<EnsureEcRunningResult> {
  return ensureEcRunning({
    ecUrl: deps.ecUrl ?? 'http://localhost:4001',
    env: deps.env ?? process.env,
    spawnFn: deps.spawnFn,
    healthCheckFn: deps.healthCheckFn,
    sleepFn: deps.sleepFn,
  });
}
