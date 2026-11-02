// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import * as path from 'node:path';

/**
 * Where `coverage` / `coverage-ao` write their report and run artefacts:
 * `--out <dir>` first, then env STACKSIM_REPORT_DIR, else `defaultDir`
 * (the committed location inside the clone). Always absolute.
 */
export function resolveReportDir(
  flags: Record<string, string | boolean>,
  env: NodeJS.ProcessEnv,
  defaultDir: string,
): { dir: string; redirected: boolean } {
  const out = typeof flags.out === 'string' && flags.out !== '' ? flags.out : env.STACKSIM_REPORT_DIR;
  if (out) return { dir: path.resolve(out), redirected: true };
  return { dir: path.resolve(defaultDir), redirected: false };
}
