// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * PLAN.md M2 task 4 (Stamper leg, previously blocked in M1): `execute`
 * (non-dry-run) constructs a `StamperConfig`, which throws
 * ("TENANT_ID is required" etc, `StamperConfig.ts:114-123`) unless
 * TENANT_ID/APP_ID/CERT_THUMBPRINT are set — regardless of `--stacksim` env
 * injection, since those fields gate config validation before any session
 * is opened. Values here are synthetic placeholders: stacksim's own S4
 * closure record (`tenant-stacksim/BACKLOG.md`) states the sim "serves the
 * OAuth token endpoint for REST clients" and no-ops `Connect-*` calls, so
 * the real cert-store lookup this thumbprint would normally drive is never
 * reached — SessionManager's shadowed PSModulePath (M1's stacksim-launcher
 * env injection) intercepts the connect calls before they touch a real
 * cert store. Not verified against a live GCC High tenant (out of scope —
 * this is exactly what stacksim exists to avoid needing).
 *
 * `STORAGE_ROOT` is also set here, pointed into ces-tester's own run
 * workspace rather than `StamperConfig`'s out-of-repo default
 * (`<ces-stamper>/storage`) — Stamper's state/evidence/log files are a side
 * effect of running its real CLI, but keeping them under ces-tester's own
 * tree is cleaner and avoids polluting the sibling repo where a dedicated
 * env var already supports it. Unrelated to tenant IDENTITY resolution
 * (which is `ces-tenant`'s registry, per docs/goals/G-TENANT-ADOPT.md) —
 * this file only satisfies `StamperConfig`'s own env-var-driven config
 * validation gate.
 */

export interface SyntheticStamperEnvOptions {
  storageRoot: string;
}

const SYNTHETIC_ENV_CONTENTS = (storageRoot: string, certPath: string): string =>
  [
    'TENANT_ID=00000000-0000-0000-0000-000000000000',
    'APP_ID=00000000-0000-0000-0000-000000000001',
    'CERT_THUMBPRINT=0000000000000000000000000000000000000000',
    `CERT_PATH=${certPath.replace(/\\/g, '/')}`,
    `STORAGE_ROOT=${storageRoot.replace(/\\/g, '/')}`,
  ].join('\n') + '\n';

/** Writes a synthetic `.env` file (plus the placeholder `CERT_PATH` file it
 * references — `StamperConfig.ts:126` requires the path to exist on disk,
 * though its contents are never read: the shadowed PSModulePath intercepts
 * every `Connect-*` cmdlet before a real cert-store lookup would occur)
 * into `dir` for Stamper's `execute -e` flag, and returns the `.env`'s
 * absolute path. */
export async function writeSyntheticStamperEnv(dir: string, opts: SyntheticStamperEnvOptions): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  const certPath = path.join(dir, 'stamper.synthetic.cert.placeholder');
  await fs.writeFile(certPath, '', 'utf8');
  const filePath = path.join(dir, 'stamper.synthetic.env');
  await fs.writeFile(filePath, SYNTHETIC_ENV_CONTENTS(opts.storageRoot, certPath), 'utf8');
  return filePath;
}
