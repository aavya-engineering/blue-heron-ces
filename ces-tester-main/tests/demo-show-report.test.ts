// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 — the `demo:show` run report.
 *
 * The recorder is pure over injected timestamps, so every assertion here is
 * arithmetic. Four things are worth pinning, and all four are ways a report can
 * quietly lie about a run that already happened:
 *
 * 1. **Toggles are not slide transitions.** `toggle-auto` / `toggle-presenter`
 *    fire `onChange` WITHOUT moving the index; counting them as moves would
 *    invent transitions.
 * 2. **A revisited slide accumulates.** Back-arrow and jump are normal on stage;
 *    a second visit must add to the dwell, not overwrite the first.
 * 3. **`auto` / `presenter` are events, not a boolean.** They are toggleable
 *    mid-run.
 * 4. **A crash in TEARDOWN must not cost the report.** Teardown kills servers
 *    and browsers and is the likeliest late failure — the evidence for the run
 *    that just happened has to survive it.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import type { ValidateFunction } from 'ajv';
import {
  advanceKindFor,
  createShowReport,
  writeShowReport,
  SHOW_REPORT_SCHEMA_VERSION,
  type ShowReport,
} from '../src/demo/show/run-report.js';
import { runShow, type ShowRunOptions } from '../src/demo/show/show-run.js';
import type { DemoDeck, DemoSlide } from '../src/demo/show/deck-model.js';
import type { AppPane } from '../src/demo/show/app-pane.js';
import { DEFAULT_APP_GEOMETRY, DEFAULT_SLIDES_GEOMETRY } from '../src/demo/show/app-pane.js';

const _require = createRequire(import.meta.url);

function reportValidator(): ValidateFunction {
  const ajvModule = _require('ajv') as { default?: unknown } & Record<string, unknown>;
  const AjvCtor = (ajvModule.default ?? ajvModule) as new (opts: {
    strict: boolean;
    allErrors: boolean;
  }) => { compile: (schema: unknown) => ValidateFunction };
  const schema = _require('../schemas/demo-show-report.schema.json');
  // `format: date-time` needs ajv-formats, which is not a dependency; the
  // structure is what this backstop is for, so formats are simply not asserted.
  return new AjvCtor({ strict: false, allErrors: true }).compile(schema);
}

function slide(n: number, op: Partial<DemoSlide['op']> = {}): DemoSlide {
  return {
    slideNumber: n,
    rows: [{ sheetRow: n + 1, slideNumber: n, feature: `Slide ${n}` }],
    op: { mode: 'staged', tools: [], images: [], ...op },
  };
}

function deckOf(...slides: DemoSlide[]): DemoDeck {
  return {
    sourcePath: 'demos/t.xlsx',
    baseDir: '/demos',
    title: 'test-deck',
    slides,
    assets: [],
    warnings: ['a load-time warning'],
  };
}

const TESTER_ROOT = path.join(os.tmpdir(), 'ces-report-tester-root');

const OPTIONS: ShowRunOptions = {
  deckPath: 'demos/t.xlsx',
  slidesPort: 4500,
  defaultDwellSec: 30,
  auto: true,
  presenter: true,
  slidesGeometry: DEFAULT_SLIDES_GEOMETRY,
  appGeometry: DEFAULT_APP_GEOMETRY,
  testerRoot: TESTER_ROOT,
  stacksimRoot: 'C:/ces/tenant-stacksim',
  aoRoot: 'C:/ces/ces-ao',
};

describe('advanceKindFor', () => {
  it('classifies only the five actions that move the index', () => {
    expect(advanceKindFor({ type: 'tick' })).toBe('auto');
    expect(advanceKindFor({ type: 'next' })).toBe('manual');
    expect(advanceKindFor({ type: 'prev' })).toBe('manual');
    expect(advanceKindFor({ type: 'first' })).toBe('jump');
    expect(advanceKindFor({ type: 'last' })).toBe('jump');
    expect(advanceKindFor({ type: 'goto', index: 2 })).toBe('jump');
  });

  it('returns undefined for the five that are NOT transitions', () => {
    // ShowAction has TEN members. The toggles fire onChange without moving the
    // index, so classifying them as advances would invent slide moves.
    expect(advanceKindFor({ type: 'toggle-auto' })).toBeUndefined();
    expect(advanceKindFor({ type: 'toggle-presenter' })).toBeUndefined();
    expect(advanceKindFor({ type: 'exit' })).toBeUndefined();
    expect(advanceKindFor({ type: 'op', index: 0, status: 'done' })).toBeUndefined();
  });
});

describe('the recorder', () => {
  it('records declared vs actual dwell, and classifies how each slide was left', () => {
    const deck = deckOf(slide(1, { durationSec: 20 }), slide(2));
    const r = createShowReport(deck, OPTIONS, 1_000, 'show-test');
    r.slideEntered(0, 1_000);
    r.slideLeft(0, 25_000, 'auto');
    r.slideEntered(1, 25_000);
    const report = r.finish(40_000, 'key');

    expect(report.slides[0]).toMatchObject({
      declaredDurationSec: 20,
      effectiveDurationSec: 20,
      actualDwellMs: 24_000,
    });
    expect(report.slides[0].visits[0].advance).toBe('auto');
    // A blank duration cell is null, and the run default fills it in.
    expect(report.slides[1]).toMatchObject({ declaredDurationSec: null, effectiveDurationSec: 30 });
    // The slide the operator was on when the run ended is closed as `end`.
    expect(report.slides[1].visits[0]).toMatchObject({ dwellMs: 15_000, advance: 'end' });
  });

  it('accumulates a revisited slide instead of overwriting it', () => {
    const deck = deckOf(slide(1), slide(2));
    const r = createShowReport(deck, OPTIONS, 0, 'show-test');
    r.slideEntered(0, 0);
    r.slideLeft(0, 10_000, 'manual');
    r.slideEntered(1, 10_000);
    r.slideLeft(1, 15_000, 'manual'); // operator went back
    r.slideEntered(0, 15_000);
    r.slideLeft(0, 18_000, 'manual');
    const report = r.finish(18_000, 'key');

    expect(report.slides[0].visits).toHaveLength(2);
    expect(report.slides[0].actualDwellMs).toBe(13_000);
    expect(report.run.manualAdvances).toBe(3);
  });

  it('records auto/presenter as an initial value plus events, never one boolean', () => {
    const r = createShowReport(deckOf(slide(1)), OPTIONS, 0, 'show-test');
    r.toggled('auto', false, 5_000);
    r.toggled('presenter', false, 6_000);
    r.toggled('auto', true, 9_000);
    const report = r.finish(10_000, 'key');

    expect(report.run.autoInitial).toBe(true);
    expect(report.run.presenterInitial).toBe(true);
    expect(report.run.toggles).toEqual([
      { at: new Date(5_000).toISOString(), what: 'auto', to: false },
      { at: new Date(6_000).toISOString(), what: 'presenter', to: false },
      { at: new Date(9_000).toISOString(), what: 'auto', to: true },
    ]);
    // A toggle is not a slide transition.
    expect(report.slides[0].visits).toEqual([]);
  });

  it('records op id, mode, duration, outcome and evidence, with paths relative to the tester root', () => {
    const deck = deckOf(slide(1), slide(2, { mode: 'warm', opId: 'eo-review' }));
    const r = createShowReport(deck, OPTIONS, 0, 'show-test');
    r.opStarted(1, deck.slides[1], 1_000);
    r.opArtifact(1, path.join(TESTER_ROOT, 'runs', 'show', 'show-test', 'eo-03-sprs.png'));
    r.opArtifact(1, path.join(TESTER_ROOT, 'runs', 'show', 'show-test', 'eo-03-sprs.png')); // de-duped
    r.opFinished(1, 8_480, 'done');
    const report = r.finish(9_000, 'key');

    expect(report.ops).toHaveLength(1);
    expect(report.ops[0]).toMatchObject({
      index: 1,
      slideNumber: 2,
      opId: 'eo-review',
      mode: 'warm',
      durationMs: 7_480,
      status: 'done',
      error: null,
    });
    // Relative, forward-slashed — a report is read on a different machine.
    expect(report.ops[0].artifacts).toEqual(['runs/show/show-test/eo-03-sprs.png']);
    // Slice 4a fills these in; the field exists now so the shape never changes.
    expect(report.ops[0].params).toEqual({});
  });

  it('carries a failure verbatim, and leaves an op still in flight as `running`', () => {
    const deck = deckOf(slide(1, { mode: 'live', opId: 'ao-registry' }), slide(2, { mode: 'warm', opId: 'eo-review' }));
    const r = createShowReport(deck, OPTIONS, 0, 'show-test');
    r.opStarted(0, deck.slides[0], 100);
    r.opFinished(0, 900, 'failed', 'the AO GUI never answered');
    r.opStarted(1, deck.slides[1], 200);
    const report = r.finish(1_000, 'error');

    expect(report.ops[0]).toMatchObject({ status: 'failed', error: 'the AO GUI never answered' });
    // An op the run outlived is `running` with a null end — a real outcome,
    // not a gap to be tidied away.
    expect(report.ops[1]).toMatchObject({ status: 'running', endedAt: null, durationMs: null });
    expect(report.exitReason).toBe('error');
  });

  it('carries the deck s load-time warnings into the report', () => {
    const report = createShowReport(deckOf(slide(1)), OPTIONS, 0, 'show-test').finish(1, 'key');
    expect(report.deck.warnings).toEqual(['a load-time warning']);
    expect(report.deck).toMatchObject({ title: 'test-deck', slideCount: 1, rowCount: 1 });
  });
});

describe('the written artifact', () => {
  it('validates against schemas/demo-show-report.schema.json', async () => {
    const deck = deckOf(slide(1, { durationSec: 20 }), slide(2, { mode: 'warm', opId: 'eo-review' }));
    const r = createShowReport(deck, OPTIONS, 1_000, 'show-test');
    r.slideEntered(0, 1_000);
    r.toggled('presenter', false, 2_000);
    r.slideLeft(0, 21_000, 'auto');
    r.slideEntered(1, 21_000);
    r.opStarted(1, deck.slides[1], 21_100);
    r.opArtifact(1, path.join(TESTER_ROOT, 'runs', 'show', 'show-test', 'shot.png'));
    r.opFinished(1, 28_000, 'done');
    const report = r.finish(30_000, 'key');

    const validate = reportValidator();
    const ok = validate(report as unknown);
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
    expect(report.schemaVersion).toBe(SHOW_REPORT_SCHEMA_VERSION);
  });

  it('creates its directory — a staged-only deck never arms, so nothing else made one', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-report-'));
    try {
      const abs = path.join(dir, 'runs', 'show', 'never-armed', 'report.json');
      const report = createShowReport(deckOf(slide(1)), OPTIONS, 0, 'never-armed').finish(1, 'key');
      await writeShowReport(report, abs);
      const written = JSON.parse(fs.readFileSync(abs, 'utf8')) as ShowReport;
      expect(written.runId).toBe('never-armed');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('runShow writes the report BEFORE teardown', () => {
  it('a crash inside teardown does not cost the report', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-report-run-'));
    try {
      const deck = deckOf(slide(1, { durationSec: 999 }), slide(2, { durationSec: 999 }));
      const pane = {
        page: {} as AppPane['page'],
        session: {} as AppPane['session'],
        goto: async () => undefined,
        // The disposer that ruins the run's teardown.
        close: async () => {
          throw new Error('the browser refused to close');
        },
      } as AppPane;

      const code = await runShow(
        { ...OPTIONS, testerRoot: root, slidesPort: 0, runId: 'crash-in-teardown' },
        {
          load: async () => deck,
          probe: async () => 'free',
          openSlides: async () => ({ close: async () => undefined }) as never,
          openApp: async () => pane,
          until: (exit) => exit(),
          log: () => undefined,
        },
      );

      expect(code).toBe(0);
      const abs = path.join(root, 'runs', 'show', 'crash-in-teardown', 'report.json');
      // The evidence for the run that just happened survives the failure.
      expect(fs.existsSync(abs)).toBe(true);
      const written = JSON.parse(fs.readFileSync(abs, 'utf8')) as ShowReport;
      expect(written.runId).toBe('crash-in-teardown');
      expect(written.deck.slideCount).toBe(2);
      const v = reportValidator();
      const ok2 = v(written as unknown);
      expect(v.errors ?? []).toEqual([]);
      expect(ok2).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('--no-report writes nothing at all', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-report-run-'));
    try {
      await runShow(
        { ...OPTIONS, testerRoot: root, slidesPort: 0, runId: 'suppressed', report: false },
        {
          load: async () => deckOf(slide(1, { durationSec: 999 })),
          probe: async () => 'free',
          openSlides: async () => ({ close: async () => undefined }) as never,
          openApp: async () =>
            ({
              page: {} as AppPane['page'],
              session: {} as AppPane['session'],
              goto: async () => undefined,
              close: async () => undefined,
            }) as AppPane,
          until: (exit) => exit(),
          log: () => undefined,
        },
      );
      expect(fs.existsSync(path.join(root, 'runs'))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
