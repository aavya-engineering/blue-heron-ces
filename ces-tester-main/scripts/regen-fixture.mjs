// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

import { buildDeckView, renderShowHtml } from '../src/demo/show/slide-render.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

const DEMOS = path.resolve(import.meta.dirname, '..', 'demos');

const slides = [
  {
    slideNumber: 1,
    rows: [{ sheetRow: 2, slideNumber: 1, feature: 'Ridgeline Fabrication', talkTrack: 'open here' }],
    op: { mode: 'staged', tools: ['stacksim', 'eo'], images: [] },
  },
  {
    slideNumber: 2,
    rows: [
      { sheetRow: 3, slideNumber: 2, feature: 'Assessment', func: 'Walks the determinations', benefit: 'Evidence an assessor accepts' },
    ],
    op: { mode: 'warm', opId: 'eo-review', tools: ['eo'], durationSec: 45, images: [] },
  },
];

const deck = {
  sourcePath: 'demos/fixture.xlsx',
  baseDir: DEMOS,
  title: 'fixture',
  slides,
  assets: [],
  warnings: [],
};

const html = renderShowHtml(buildDeckView(deck));
const target = path.resolve(import.meta.dirname, '..', 'tests', 'fixtures', 'show-page-baseline.html');
fs.writeFileSync(target, html, 'utf8');
console.log(`Wrote ${html.length} bytes to ${target}`);
