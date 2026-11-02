// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// PH-10 (R-F7 V116): at a terminal, the CLI's prompts (task confirm, manual gate, DP-2) must reach the screen.
// listr2's default renderer holds back stdout while it draws, so a run that can ask a person uses the simple renderer.
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { tuiRenderer } from '../../src/tui/StamperTUI';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.resolve(__dirname, '../../src/tui/StamperTUI.ts'), 'utf8');

describe('PH-10: the TUI renderer lets prompts through when a person can be asked', () => {
  it('manual mode or a terminal stdin takes the simple renderer; no terminal keeps the default (fallback)', () => {
    expect(tuiRenderer({ mode: 'manual', stdinIsTTY: true, stdoutIsTTY: true })).toBe('simple');
    expect(tuiRenderer({ mode: 'manual', stdinIsTTY: false, stdoutIsTTY: true })).toBe('simple');
    expect(tuiRenderer({ mode: 'auto', stdinIsTTY: true, stdoutIsTTY: true })).toBe('simple');
    expect(tuiRenderer({ mode: 'auto', stdinIsTTY: false, stdoutIsTTY: true })).toBe('default');
    expect(tuiRenderer({ mode: 'manual', stdinIsTTY: true, stdoutIsTTY: false })).toBe('default');
  });

  it('the run builds its Listr with the helper', () => {
    expect(SRC).toMatch(/renderer: tuiRenderer\(\{ mode, stdinIsTTY: !!process\.stdin\.isTTY, stdoutIsTTY: !!process\.stdout\.isTTY \}\)/);
    expect(SRC.match(/new Listr\(/g)).toHaveLength(1);
  });
});
