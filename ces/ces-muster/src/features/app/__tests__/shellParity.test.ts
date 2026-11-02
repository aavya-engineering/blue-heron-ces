// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// @vitest-environment node

// FIN-32: Muster's shell is the kit AppShell's markup (MusterShell.tsx says why it is a local
// copy). This test reads the kit's AppShell and ThemeToggle SOURCE as text (no kit code runs, so
// the two React copies never meet) and checks that every class and id they render is in
// Muster's rendered shell, plus the header line "CES … Blue Heron Defense — Muster".
import * as fs from 'node:fs';
import * as path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, test, expect } from 'vitest';
import { MusterHeader, MusterShell, FOOTER_TEXT, APP_VERSION } from '../MusterShell';
import ShellNav from '../ShellNav';

const KIT_SHELL = path.resolve(__dirname, '../../../../../ces-shared/ui/kit/src/shell');
const kitSource = (f: string) => fs.readFileSync(path.join(KIT_SHELL, f), 'utf8');
const haveKit = fs.existsSync(path.join(KIT_SHELL, 'AppShell.tsx'));

/** className="a b" and id="x" literals in a TSX source. */
function tokens(src: string): { classes: string[]; ids: string[] } {
  const classes = [...src.matchAll(/className="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/));
  const ids = [...src.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  return { classes: [...new Set(classes)], ids: [...new Set(ids)] };
}

function render(kind: 'individual_contractor' | 'prime_and_subs' | null = null): string {
  return renderToStaticMarkup(
    React.createElement(MusterShell, {
      header: React.createElement(MusterHeader, { kind, onNavigate: () => {} }),
      rail: React.createElement(ShellNav, { onNavigate: () => {}, active: 'plan', planEnabled: true }),
      children: React.createElement('p', null, 'screen'),
    })
  );
}

describe.skipIf(!haveKit)('Muster shell = kit AppShell markup', () => {
  test('every class and id the kit AppShell renders is in the Muster shell', () => {
    const html = render();
    const { classes, ids } = tokens(kitSource('AppShell.tsx'));
    expect(classes.length).toBeGreaterThan(4);
    const rendered = new Set([...html.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)));
    for (const c of classes) expect(rendered.has(c), `class ${c}`).toBe(true);
    for (const id of ids) expect(html, `id ${id}`).toContain(`id="${id}"`);
  });

  test('the theme toggle keeps the kit id, class and storage contract', () => {
    const src = kitSource('ThemeToggle.tsx');
    expect(src).toContain("id = 'ces-theme-toggle'");
    expect(src).toContain('ck-theme-toggle');
    const html = render();
    expect(html).toContain('id="ces-theme-toggle"');
    expect(html).toContain('class="ck-theme-toggle"');
    expect(html).toMatch(/aria-label="Switch to (light|dark) theme"/);
    const theme = kitSource('theme.ts');
    expect(theme).toContain("THEME_STORAGE_KEY = 'ces-theme'");
    expect(theme).toContain("DEFAULT_THEME: Theme = 'dark'");
  });
});

describe('Muster header, footer and rail', () => {
  test('header names the company and the module, as every CES console does', () => {
    const html = render();
    expect(html).toContain('<header id="header" class="ces-header ck-header">');
    expect(html).toMatch(/CES<span class="header-company">Blue Heron Defense — Muster<\/span>/);
    expect(html).toContain(APP_VERSION);
    expect(html).not.toContain('CES Muster</span>'); // the old doubled brand is gone
  });

  test('footer is the suite line with the module named; the rail sits inside main', () => {
    const html = render();
    expect(html).toContain(`<footer class="ces-footer" data-testid="muster-footer">${FOOTER_TEXT}</footer>`);
    expect(FOOTER_TEXT).toBe(`Blue Heron Defense · CES Muster ${APP_VERSION} · CUI`);
    expect(html.indexOf('<main id="main" class="ck-main">')).toBeLessThan(html.indexOf('class="shell-nav"'));
    expect(html).toMatch(/data-testid="nav-tab-plan" aria-current="page"/);
  });

  test('rollup-nav only for prime_and_subs (DW#3b, unchanged)', () => {
    expect(render('individual_contractor')).not.toContain('rollup-nav');
    expect(render('prime_and_subs')).toContain('rollup-nav');
    for (const id of ['quick-session-nav', 'contracts-nav']) expect(render('individual_contractor')).toContain(id);
  });
});
