// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.
// W5c7 test hygiene (setupFilesAfterEnv): before every test in every suite, the pipeline root the code
// would resolve (CES_PIPELINE_ROOT, else the %LOCALAPPDATA% default) must not be inside %LOCALAPPDATA%.
const path = require('path');
const { insideLocalAppData } = require('./pipelineRoot.cjs');
beforeEach(() => {
  const env = process.env.CES_PIPELINE_ROOT;
  const resolved = env ? path.resolve(env) : '(unset: the %LOCALAPPDATA%\CES\pipeline default)';
  if (!env || insideLocalAppData(resolved)) {
    throw new Error(`test pipeline root is the user's real folder or inside %LOCALAPPDATA%: ${resolved}`);
  }
});
