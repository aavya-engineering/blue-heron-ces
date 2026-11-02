// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-33 / W8-FNT: the self-hosted font stylesheet names only local files, every file exists,
// the families match the ces-ui.css token stacks, and main.tsx imports it.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const fontsDir = path.resolve(here, '../../../ces-shared/ui/kit/fonts');
const raw = fs.readFileSync(path.join(fontsDir, 'ces-fonts.css'), 'utf-8');
/** The rules only (the header comment names the Google @import it replaces). */
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');

describe('self-hosted fonts (W8-FNT)', () => {
  it('references no external URL', () => {
    expect(css).not.toMatch(/https?:\/\//);
    expect(css).not.toMatch(/@import/);
  });

  it('every url() names a woff2 file in the fonts folder', () => {
    const urls = Array.from(css.matchAll(/url\(([^)]+)\)/g), (m) => m[1]!.replace(/['"]/g, ''));
    expect(urls.length).toBe(12);
    for (const u of urls) {
      expect(u.startsWith('./')).toBe(true);
      expect(u.endsWith('.woff2')).toBe(true);
      expect(fs.existsSync(path.join(fontsDir, u))).toBe(true);
    }
  });

  it('declares the families the token stacks use, with font-display swap', () => {
    const tokens = fs.readFileSync(path.resolve(here, '../../../ces-shared/ui/ces-ui.css'), 'utf-8');
    for (const family of ['IBM Plex Sans', 'IBM Plex Mono']) {
      expect(tokens).toContain(`'${family}'`);
      expect(css).toContain(`font-family: '${family}'`);
    }
    const faces = css.split('@font-face').length - 1;
    expect(css.split('font-display: swap').length - 1).toBe(faces);
  });

  it('ships the OFL licence texts and is imported by main.tsx', () => {
    expect(fs.existsSync(path.join(fontsDir, 'OFL-IBM-Plex-Sans.txt'))).toBe(true);
    expect(fs.existsSync(path.join(fontsDir, 'OFL-IBM-Plex-Mono.txt'))).toBe(true);
    const main = fs.readFileSync(path.join(here, 'main.tsx'), 'utf-8');
    expect(main).toContain("import '../../../ces-shared/ui/kit/fonts/ces-fonts.css';");
  });
});
