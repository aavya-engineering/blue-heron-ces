// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.
// W5c7 test hygiene (setupFiles: runs in each test file before its modules are imported, so import-time
// constants such as EVIDENCE_DIR resolve here too): the pipeline root and the temp directory point at
// the run's root, whatever the shell had set. STAMPER_EVIDENCE_DIR is dropped (it would bypass the root).
const fs = require('fs');
const path = require('path');
const { ensureRunRoot } = require('./pipelineRoot.cjs');
const root = ensureRunRoot();
const pipeline = path.join(root, 'pipeline');
const tmp = path.join(root, 'tmp');
fs.mkdirSync(pipeline, { recursive: true });
fs.mkdirSync(tmp, { recursive: true });
process.env.CES_PIPELINE_ROOT = pipeline;
process.env.TEMP = tmp;
process.env.TMP = tmp;
process.env.TMPDIR = tmp;
delete process.env.STAMPER_EVIDENCE_DIR;
