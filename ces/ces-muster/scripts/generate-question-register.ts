// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// generate-question-register.ts — MG-28: write src/features/interview/
// questionRegister.json from buildQuestionRegister(). Run `npm run
// register:generate` after adding or changing a question. `--check` exits 1
// when the committed file is stale (the vitest suite asserts the same).
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildQuestionRegister, serializeQuestionRegister } from '../src/features/interview/questionRegister.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '../src/features/interview/questionRegister.json');

const reg = buildQuestionRegister();
const text = serializeQuestionRegister(reg);

if (process.argv.includes('--check')) {
  const current = fs.existsSync(OUT) ? JSON.stringify(JSON.parse(fs.readFileSync(OUT, 'utf8'))) : '';
  if (current !== JSON.stringify(reg)) {
    console.error('questionRegister.json is stale: run npm run register:generate');
    process.exit(1);
  }
  console.log('questionRegister.json is current');
} else {
  fs.writeFileSync(OUT, text, 'utf8');
  console.log(`wrote ${path.relative(process.cwd(), OUT)}: ${reg.counts.rows} rows`, reg.counts);
}
if (reg.counts.unregistered > 0) {
  console.error(`${reg.counts.unregistered} unregistered question node(s)`);
  process.exit(1);
}
