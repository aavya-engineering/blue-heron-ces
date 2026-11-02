// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.


// RF-25 (R11): tsc copies only imported JSON, so the runtime assets that EO loads relative
// to its own module (snippet templates, shared data JSON) were missing from dist/ and EO had
// to run from source. Copy them next to the compiled code so `node dist/eo/index.js` works.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const ASSET_DIRS = [
  ['src/eo/data', 'dist/eo/data'],
  ['src/shared/data', 'dist/shared/data'],
];

let copied = 0;
for (const [from, to] of ASSET_DIRS) {
  const src = path.join(root, from);
  if (!fs.existsSync(src)) continue;
  fs.cpSync(src, path.join(root, to), {
    recursive: true,
    filter: (p) => fs.statSync(p).isDirectory() || /\.(hbs|json)$/.test(p),
  });
  copied++;
}
console.log(`Copied ${copied} EO asset folder(s) into dist/`);
