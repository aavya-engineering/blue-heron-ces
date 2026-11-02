// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W5c7 test hygiene: unit tests never touch the user's real pipeline folder (%LOCALAPPDATA%\CES\pipeline).
// One temporary root per jest run, inside the repo (outside %LOCALAPPDATA%; %TEMP% is under it on Windows).
const fs = require('fs');
const path = require('path');

const ENV = 'CES_STAMPER_TEST_PIPELINE_ROOT';
const BASE = path.resolve(__dirname, '..', '..', '.test-pipeline');

/** The run's root: created once (global setup, or the first setup file when jest runs without it). */
function ensureRunRoot() {
  if (process.env[ENV] && fs.existsSync(process.env[ENV])) return process.env[ENV];
  fs.mkdirSync(BASE, { recursive: true });
  const root = fs.mkdtempSync(path.join(BASE, `run-${process.pid}-`));
  process.env[ENV] = root;
  return root;
}

/** True when `p` is %LOCALAPPDATA% or inside it (case-insensitive on Windows). */
function insideLocalAppData(p) {
  const lad = process.env.LOCALAPPDATA;
  if (!lad || !p) return false;
  const norm = (x) => path.resolve(x).toLowerCase().replace(/[\/]+$/, '');
  const a = norm(lad);
  const b = norm(p);
  return b === a || b.startsWith(a + path.sep);
}

module.exports = { ENV, BASE, ensureRunRoot, insideLocalAppData };
