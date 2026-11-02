// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 — `demo:show` arg parsing and `--check` exit codes.
 *
 * The exit codes are the contract the build loop runs on: 0 = the deck is
 * demoable, 1 = it loaded but a check failed, 2 = it did not load (or the
 * invocation was bad) and NOTHING was rendered. A3 lives on that last one.
 */

import { describe, it, expect, vi } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  parseShowArgs,
  runDeckCheck,
  runDemoShowCommand,
  withStagedOps,
  DEFAULT_SLIDES_PORT,
  type DemoShowArgs,
} from '../src/cli/show-command.js';
import { DeckLoadFailure, type DemoDeck } from '../src/demo/show/deck-model.js';
import { loadDeck } from '../src/demo/show/xlsx-loader.js';

const REPO_ROOT = path.resolve(__dirname, '..');
const STARTER_DECK = path.join(REPO_ROOT, 'demos', 'ces-overview.xlsx');

describe('parseShowArgs', () => {
  it('defaults to the starter deck, port 4500 and a 30 s dwell', () => {
    const args = parseShowArgs([], 'C:/ces/ces-tester');
    expect(args.deckPath).toBe(path.resolve('C:/ces/ces-tester', 'demos/ces-overview.xlsx'));
    expect(args.slidesPort).toBe(DEFAULT_SLIDES_PORT);
    expect(args.defaultDwellSec).toBe(30);
    expect(args.check).toBe(false);
    expect(args.auto).toBe(true);
    expect(args.presenter).toBe(true);
    expect(args.errors).toEqual([]);
  });

  it('takes the deck as a positional .xlsx and honours the flags', () => {
    const args = parseShowArgs(
      ['--check', 'demos/other.xlsx', '--slides-port', '4600', '--default-dwell', '12', '--manual', '--no-presenter'],
      'C:/ces/ces-tester',
    );
    expect(args.check).toBe(true);
    expect(args.deckPath).toBe(path.resolve('demos/other.xlsx'));
    expect(args.slidesPort).toBe(4600);
    expect(args.defaultDwellSec).toBe(12);
    expect(args.auto).toBe(false);
    expect(args.presenter).toBe(false);
  });

  it('never mistakes a flag value for the deck path', () => {
    const args = parseShowArgs(['--stacksim-root', 'C:/elsewhere/sim.xlsx'], 'C:/ces/ces-tester');
    expect(args.deckPath).toBe(path.resolve('C:/ces/ces-tester', 'demos/ces-overview.xlsx'));
    expect(args.stacksimRoot).toBe(path.resolve('C:/elsewhere/sim.xlsx'));
  });

  it('defaults the sibling roots beside ces-tester', () => {
    const args = parseShowArgs([], 'C:/ces/ces-tester');
    expect(args.aoRoot).toBe(path.join('C:/ces', 'ces-ao'));
    expect(args.stacksimRoot).toBe(path.join('C:/ces', 'tenant-stacksim'));
    expect(args.eoRoot).toBe(path.join('C:/ces', 'ces-eo'));
    expect(args.stamperRoot).toBe(path.join('C:/ces', 'ces-stamper'));
    expect(args.musterRoot).toBe(path.join('C:/ces', 'ces-muster'));
  });

  it('overrides each sibling root from its own flag', () => {
    const args = parseShowArgs(
      ['--eo-root', 'D:/alt/eo', '--stamper-root', 'D:/alt/stamper', '--muster-root', 'D:/alt/muster'],
      'C:/ces/ces-tester',
    );
    expect(args.eoRoot).toBe(path.resolve('D:/alt/eo'));
    expect(args.stamperRoot).toBe(path.resolve('D:/alt/stamper'));
    expect(args.musterRoot).toBe(path.resolve('D:/alt/muster'));
  });

  it('never mistakes one of the new root values for the deck path', () => {
    // The failure this pins: a value-taking flag absent from FLAGS_WITH_VALUES
    // is not a type error and not a test failure anywhere else — its value just
    // silently becomes the positional deck argument.
    for (const flag of ['--eo-root', '--stamper-root', '--muster-root']) {
      const args = parseShowArgs([flag, 'C:/elsewhere/decoy.xlsx', 'demos/real.xlsx'], 'C:/ces/ces-tester');
      expect(args.deckPath, flag).toBe(path.resolve('demos/real.xlsx'));
    }
    // ...and with no positional at all, the default deck still wins.
    const bare = parseShowArgs(['--muster-root', 'C:/elsewhere/decoy.xlsx'], 'C:/ces/ces-tester');
    expect(bare.deckPath).toBe(path.resolve('C:/ces/ces-tester', 'demos/ces-overview.xlsx'));
    expect(bare.musterRoot).toBe(path.resolve('C:/elsewhere/decoy.xlsx'));
  });

  it('writes a run report by default and suppresses it with --no-report', () => {
    expect(parseShowArgs([], 'C:/ces/ces-tester').report).toBe(true);
    expect(parseShowArgs(['--no-report'], 'C:/ces/ces-tester').report).toBe(false);
  });

  it('--watchouts is OFF by default', () => {
    expect(parseShowArgs([], 'C:/ces/ces-tester').watchouts).toBe(false);
    expect(parseShowArgs(['--watchouts'], 'C:/ces/ces-tester').watchouts).toBe(true);
  });

  it('collects bad numeric flags instead of throwing', () => {
    const args = parseShowArgs(['--slides-port', 'soon', '--default-dwell', '-3'], 'C:/ces/ces-tester');
    expect(args.errors).toHaveLength(2);
    expect(args.errors[0]).toContain('--slides-port must be a positive number');
    expect(args.errors[1]).toContain('--default-dwell must be a positive number');
  });

  it('the in-slide mirror is ON by default and --pane-window turns it off (T1.5 S6)', () => {
    expect(parseShowArgs([], 'C:/ces/ces-tester').mirrorActive).toBe(true);
    expect(parseShowArgs(['--pane-window'], 'C:/ces/ces-tester').mirrorActive).toBe(false);
  });

  it('--pane-window is boolean — the positional .xlsx still resolves after it', () => {
    // It consumes no value, so it must NOT swallow the deck arg.
    const args = parseShowArgs(['--pane-window', 'demos/real.xlsx'], 'C:/ces/ces-tester');
    expect(args.deckPath).toBe(path.resolve('demos/real.xlsx'));
    expect(args.mirrorActive).toBe(false);
  });
});

describe('withStagedOps', () => {
  it('forces every op to staged without touching anything else', async () => {
    const deck = await loadDeck(STARTER_DECK);
    const staged = withStagedOps(deck);
    expect(deck.slides.some((s) => s.op.mode !== 'staged')).toBe(true);
    expect(staged.slides.every((s) => s.op.mode === 'staged')).toBe(true);
    // Op ids survive — the check still reports what the deck would drive.
    expect(staged.slides.find((s) => s.slideNumber === 7)!.op.opId).toBe('ao-registry');
    expect(staged.slides.map((s) => s.rows)).toEqual(deck.slides.map((s) => s.rows));
  });
});

describe('runDeckCheck (A1)', () => {
  it('passes on the checked-in starter deck and walks every slide', async () => {
    const deck = await loadDeck(STARTER_DECK);
    const result = runDeckCheck(deck, 30);
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.slideCount).toBe(8);
    expect(result.rowCount).toBe(11);
    expect(result.lines.some((l) => l.includes('walk: 8 slide(s) front-to-back, ops forced staged'))).toBe(true);
    // The blank duration is reported as coming from the run default.
    expect(result.lines.some((l) => l.includes('slide   3') && l.includes('30s (default)'))).toBe(true);
  });

  it('an empty deck cannot fail a render it never performs', () => {
    const empty: DemoDeck = {
      sourcePath: 'demos/x.xlsx',
      baseDir: '/demos',
      title: 'x',
      slides: [],
      assets: [],
      warnings: [],
    };
    const result = runDeckCheck(empty, 30);
    expect(result.ok).toBe(true);
    expect(result.slideCount).toBe(0);
  });

  it('reports a contentless slide as a failure', () => {
    const broken: DemoDeck = {
      sourcePath: 'demos/x.xlsx',
      baseDir: '/demos',
      title: 'x',
      slides: [{ slideNumber: 1, rows: [], op: { mode: 'staged', tools: [], images: [] } }],
      assets: [],
      warnings: [],
    };
    const result = runDeckCheck(broken, 30);
    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(['slide 1 has no content rows']);
  });

  it('passes a full-bleed html slide that renders no <h1> at all', () => {
    const bleed: DemoDeck = {
      sourcePath: 'demos/x.xlsx',
      baseDir: '/demos',
      title: 'x',
      slides: [
        {
          slideNumber: 1,
          // Narration only in the presenter band — nothing on the slide itself,
          // which is exactly what makes it full-bleed.
          rows: [{ sheetRow: 2, slideNumber: 1, talkTrack: 'the story' }],
          op: {
            mode: 'staged',
            tools: [],
            images: [],
            html: { id: 'hero.html', rawValue: 'hero.html', absPath: '/demos/hero.html' },
          },
        },
      ],
      assets: [],
      warnings: [],
    };
    const result = runDeckCheck(bleed, 30);
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });

});

describe('runDemoShowCommand exit codes', () => {
  const silence = { log: () => undefined };

  it('exits 0 on --check against the starter deck', async () => {
    const code = await runDemoShowCommand(['--check', STARTER_DECK], REPO_ROOT, silence);
    expect(code).toBe(0);
  });

  it('--check writes NO run report — the report is an operator-run artifact', async () => {
    // `--check` returns before `runShow` is ever reached, so nothing under
    // runs/show/ may appear because of it.
    const before = fs.existsSync(path.join(REPO_ROOT, 'runs', 'show'))
      ? fs.readdirSync(path.join(REPO_ROOT, 'runs', 'show'))
      : [];
    const code = await runDemoShowCommand(['--check', STARTER_DECK], REPO_ROOT, silence);
    expect(code).toBe(0);
    const after = fs.existsSync(path.join(REPO_ROOT, 'runs', 'show'))
      ? fs.readdirSync(path.join(REPO_ROOT, 'runs', 'show'))
      : [];
    expect(after).toEqual(before);
  });

  it('exits 2 with per-row errors and renders nothing on a malformed deck (A3)', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const code = await runDemoShowCommand(['--check', 'demos/bad.xlsx'], REPO_ROOT, {
        ...silence,
        load: async () => {
          throw new DeckLoadFailure('demos/bad.xlsx', [
            { sheetRow: 7, message: '"op mode" must be one of live|warm|staged (got "livee")' },
            { sheetRow: 9, message: '"duration (sec)" must be a positive number of seconds, or blank for the run default (got "soon")' },
          ]);
        },
      });
      expect(code).toBe(2);
      const printed = errors.mock.calls.map((c) => String(c[0]));
      expect(printed[0]).toBe('demos/bad.xlsx row 7: "op mode" must be one of live|warm|staged (got "livee")');
      expect(printed[1]).toContain('demos/bad.xlsx row 9: "duration (sec)"');
      expect(printed[2]).toContain('2 problem(s) — nothing was rendered');
    } finally {
      errors.mockRestore();
    }
  });

  it('exits 2 on a bad flag without loading anything', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const load = vi.fn();
    try {
      const code = await runDemoShowCommand(['--slides-port', 'soon'], REPO_ROOT, { ...silence, load });
      expect(code).toBe(2);
      expect(load).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });

  it('exits 1 when the deck loads but a check fails', async () => {
    const code = await runDemoShowCommand(['--check', STARTER_DECK], REPO_ROOT, {
      ...silence,
      load: async () => ({
        sourcePath: 'demos/x.xlsx',
        baseDir: '/demos',
        title: 'x',
        // A slide the loader could never produce: grouped, but contentless.
        slides: [{ slideNumber: 1, rows: [], op: { mode: 'staged' as const, tools: [], images: [] } }],
        assets: [],
        warnings: [],
      }),
    });
    expect(code).toBe(1);
  });

  it('delegates the operator run to the injected runner', async () => {
    const run = vi.fn(async (_args: DemoShowArgs) => 0);
    const code = await runDemoShowCommand([STARTER_DECK], REPO_ROOT, { ...silence, run });
    expect(code).toBe(0);
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0][0]).toMatchObject({ check: false, deckPath: STARTER_DECK });
  });
});
