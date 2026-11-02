// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * CC-3/CC-4/CC-5 — `ces-tester center` command.
 * Starts the Command Center HTTP server.
 */

import * as path from 'node:path';

function argFlag(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : undefined;
}

export async function runCenterCommand(argv: string[]): Promise<number> {
  const port = parseInt(argFlag(argv, '--port') ?? '4600', 10);
  const projectRoot = process.cwd();

  try {
    const { startCenterServer } = await import('../center/server.js');
    await startCenterServer({ port, projectRoot });
    return 0;
  } catch (err) {
    console.error(`center: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
}
