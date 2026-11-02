// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * W5 cycle 7 (test hygiene, V10): jest global setup and teardown that pin CES_PIPELINE_ROOT to a per-run
 * temporary directory, so no suite, and no child process a suite spawns (the live-sim EO server inherits the
 * environment), resolves the production default `%LOCALAPPDATA%\CES\pipeline` and opens its `ces.db`.
 * The production default (ces-shared `getCesPipelineRoot`) is unchanged. The directory name does not start
 * with `ces` (the outside-the-workspace snapshot watches `<usertemp>\ces*`). A suite that sets its own root
 * restores this one afterwards.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MARKER = 'CES_EO_TEST_PIPELINE_ROOT';

async function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-jest-pipeline-'));
  process.env.CES_PIPELINE_ROOT = root;
  process.env[MARKER] = root;
}

async function teardown() {
  const root = process.env[MARKER];
  if (!root || !path.basename(root).startsWith('eo-jest-pipeline-')) return;
  for (let i = 0; i < 5; i++) {
    try { fs.rmSync(root, { recursive: true, force: true }); return; } catch { await new Promise(r => setTimeout(r, 200)); }
  }
}

module.exports = { setup, teardown, MARKER };
