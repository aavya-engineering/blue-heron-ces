// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TENANT-2026A
// See LICENSE and TERMS.md.

/** getCesPipelineRoot default: per-user folder on Windows, env override wins. */

import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { getCesPipelineRoot } from '../impl/paths.js';

describe('getCesPipelineRoot', () => {
  it('honours CES_PIPELINE_ROOT on every platform', () => {
    const root = path.join(os.tmpdir(), 'pl-override');
    expect(getCesPipelineRoot({ CES_PIPELINE_ROOT: root }, 'win32')).toBe(path.resolve(root));
    expect(getCesPipelineRoot({ CES_PIPELINE_ROOT: root }, 'linux')).toBe(path.resolve(root));
  });

  it('defaults to LOCALAPPDATA\\CES\\pipeline on win32', () => {
    const lad = path.join(os.tmpdir(), 'lad');
    expect(getCesPipelineRoot({ LOCALAPPDATA: lad }, 'win32')).toBe(path.resolve(lad, 'CES', 'pipeline'));
  });

  it('falls back to the home AppData\\Local folder when LOCALAPPDATA is unset', () => {
    expect(getCesPipelineRoot({}, 'win32')).toBe(path.resolve(os.homedir(), 'AppData', 'Local', 'CES', 'pipeline'));
  });

  it('keeps the cwd-relative default on POSIX', () => {
    expect(getCesPipelineRoot({}, 'linux')).toBe(path.resolve(process.cwd(), 'ces-pipeline'));
  });
});
