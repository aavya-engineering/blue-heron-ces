// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

const fs = require('fs');
const mp = JSON.parse(fs.readFileSync('./plan-data/vfsgov-xtra/plans/manual-mission-plan-2026-04-14T00-27-54-661Z.json', 'utf8'));

function findKey(obj, path) {
  if (!obj || typeof obj !== 'object') return;
  for (const k of Object.keys(obj)) {
    if (k === 'control_directives' || k === 'directives') {
      console.log(`${path}.${k}`, 'len:', Array.isArray(obj[k]) ? obj[k].length : typeof obj[k]);
    }
    if (Array.isArray(obj[k]) && obj[k].length < 200) {
      findKey(obj[k], `${path}.${k}`);
    } else if (typeof obj[k] === 'object' && obj[k] !== null) {
      findKey(obj[k], `${path}.${k}`);
    }
  }
}

findKey(mp, 'root');

// Also search for 3.14.5 anywhere
const text = JSON.stringify(mp);
const idx = text.indexOf('3.14.5');
if (idx >= 0) {
  console.log('\nFound 3.14.5 at char', idx, ':', text.substring(Math.max(0, idx - 50), idx + 50));
} else {
  console.log('\n3.14.5 NOT found in MP');
}
