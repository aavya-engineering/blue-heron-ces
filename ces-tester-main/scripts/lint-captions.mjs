#!/usr/bin/env node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-6 — the `demo:captions-lint` gate.
 *
 * The per-action narration captions (`src/demo/show/captions.ts`) are written in
 * the founder's voice and MUST pass the ms2-voice linter with zero [tell]. This
 * script is the ship gate: it dumps the EXACT corpus the code exports
 * (`ALL_CAPTIONS`, one caption per blank-line-separated paragraph so the linter
 * judges each independently) to a scratch file and runs `voice_lint.py` over it.
 *
 * It imports from `dist/`, so the npm script builds first. The linter path is
 * resolved through `os.homedir()` (the shell `~` does not expand inside a Node
 * spawn on Windows), and the scratch file lives in the OS temp dir, never the
 * repo.
 *
 * Exit: 0 when the linter exits 0 (clean, or [style]-only — style never blocks);
 * non-zero otherwise (2 = [tell] findings; 1 = linter usage/IO error). The
 * linter's own stdout is surfaced so a failing caption is named.
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// Absolute paths must be file:// URLs for the ESM loader on Windows.
const captionsUrl = pathToFileURL(
  path.join(here, '..', 'dist', 'src', 'demo', 'show', 'captions.js'),
).href;
const { ALL_CAPTIONS } = await import(captionsUrl);

if (!Array.isArray(ALL_CAPTIONS) || ALL_CAPTIONS.length === 0) {
  console.error('lint-captions: ALL_CAPTIONS is empty or not an array — nothing to lint');
  process.exit(1);
}

const linter = path.join(os.homedir(), '.claude', 'skills', 'ms2-voice', 'voice_lint.py');
if (!fs.existsSync(linter)) {
  console.error(`lint-captions: ms2-voice linter not found at ${linter}`);
  process.exit(1);
}

// One caption per paragraph — the linter's mechanical [tell] classes are
// per-line/paragraph, and blank-line separation keeps each caption's context to
// itself.
const corpus = ALL_CAPTIONS.join('\n\n') + '\n';
const scratch = path.join(os.tmpdir(), `ces-caption-corpus-${process.pid}.md`);
fs.writeFileSync(scratch, corpus, 'utf8');

const py = process.platform === 'win32' ? 'python' : 'python3';
const result = spawnSync(py, [linter, scratch], { encoding: 'utf8' });
try {
  fs.unlinkSync(scratch);
} catch {
  /* best-effort cleanup */
}

if (result.error) {
  console.error(`lint-captions: could not run ${py} — ${result.error.message}`);
  process.exit(1);
}
process.stdout.write(result.stdout ?? '');
if (result.stderr) process.stderr.write(result.stderr);

console.log(
  `lint-captions: ${ALL_CAPTIONS.length} caption(s) audited — voice_lint exit ${result.status}`,
);
// Only exit 0 (clean, or [style]-only) passes; 2 = [tell] findings, 1 = error.
process.exit(result.status === 0 ? 0 : result.status || 1);
