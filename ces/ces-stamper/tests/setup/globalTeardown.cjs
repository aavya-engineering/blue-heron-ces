// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.
// W5c7 test hygiene: remove the run's temporary pipeline root (and the base folder when it is empty).
const fs = require('fs');
const { ENV, BASE } = require('./pipelineRoot.cjs');
module.exports = async () => {
  const root = process.env[ENV];
  if (root && root.startsWith(BASE)) fs.rmSync(root, { recursive: true, force: true });
  try { if (fs.readdirSync(BASE).length === 0) fs.rmdirSync(BASE); } catch { /* absent or in use by a parallel run */ }
};
