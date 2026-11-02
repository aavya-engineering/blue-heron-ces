// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.
// W5c7 test hygiene: create the run's temporary pipeline root. Set here, in jest's own process, before the
// workers start, the variables reach the workers' real environment, which Node's os.tmpdir() reads (the
// per-suite mkdtemp roots); env.cjs repeats them in each test file's sandboxed process.env.
const fs = require('fs');
const path = require('path');
const { ensureRunRoot } = require('./pipelineRoot.cjs');
module.exports = async () => {
  const root = ensureRunRoot();
  const tmp = path.join(root, 'tmp');
  fs.mkdirSync(tmp, { recursive: true });
  fs.mkdirSync(path.join(root, 'pipeline'), { recursive: true });
  process.env.CES_PIPELINE_ROOT = path.join(root, 'pipeline');
  process.env.TEMP = tmp;
  process.env.TMP = tmp;
  process.env.TMPDIR = tmp;
  delete process.env.STAMPER_EVIDENCE_DIR;
};
