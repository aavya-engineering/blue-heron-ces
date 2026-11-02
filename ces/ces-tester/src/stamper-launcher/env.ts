// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

import type { SimLaunchEnv } from 'ces-tenant';

/**
 * G-TENANT-ADOPT Acceptance Gate item 4: PSModulePath/Path/
 * STACKSIM_SERVER_URL are no longer computed here — they come from
 * `ces-tenant`'s `TenantLaunchContextProvider.getSimLaunchEnv()`
 * (`src/tenant-registry/index.ts`), which is the ratified replacement for
 * this module's former `buildStacksimChildEnv()` (hand-rolled port of
 * `StacksimMode.ts:118-125`'s three env mutations — exactly the duplication
 * the goal's Must-NOTs name: "Do not hand-reconstruct StacksimMode's
 * env-mutation logic inside stamper-launcher").
 *
 * This module now only MERGES the launch-context provider's 3-field bundle
 * onto a full base-env copy (case-insensitive dedup on the same 2 keys,
 * since `SimLaunchEnv` returns bare replacement values, not a full env) —
 * the merge itself is not tenant logic, just child-process env plumbing.
 */

function deleteKeyCaseInsensitive(env: NodeJS.ProcessEnv, name: string): void {
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === name.toLowerCase()) {
      delete env[key];
    }
  }
}

export interface MergeSimLaunchEnvOptions {
  simLaunchEnv: SimLaunchEnv;
  /** Base env to extend (defaults to process.env). */
  baseEnv?: NodeJS.ProcessEnv;
}

export function mergeSimLaunchEnv(opts: MergeSimLaunchEnvOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...(opts.baseEnv ?? process.env) };

  deleteKeyCaseInsensitive(env, 'PSModulePath');
  env.PSModulePath = opts.simLaunchEnv.psModulePath;

  deleteKeyCaseInsensitive(env, 'Path');
  deleteKeyCaseInsensitive(env, 'PATH');
  env.Path = opts.simLaunchEnv.path;

  env.STACKSIM_SERVER_URL = opts.simLaunchEnv.stacksimServerUrl;

  return env;
}
