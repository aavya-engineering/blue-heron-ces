// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Flow-through (MS-R3 / MS-R10): locate the ces monorepo root — the directory
 * that holds ces-muster and ces-stamper side by side. Walks up from `start`
 * (default: cwd) so it works from the main ces-tester checkout and from any
 * .worktrees/* checkout. CES_ROOT overrides.
 */
export function findCesRoot(start: string = process.cwd()): string {
  if (process.env.CES_ROOT) return path.resolve(process.env.CES_ROOT);
  let dir = path.resolve(start);
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'ces-muster')) && fs.existsSync(path.join(dir, 'ces-stamper'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error(`findCesRoot: no ancestor of ${start} holds both ces-muster and ces-stamper (set CES_ROOT)`);
}
