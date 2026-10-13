// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 S4/S5 — op dispatch against a hand-written `UiPage`.
 *
 * The `UiPage` seam exists precisely so a GUI flow's ORDERING can be pinned
 * without a browser (see `ui-page.ts`'s header). The same trick applies one
 * level up: the show's op plumbing — mode dispatch, the single-lane queue, the
 * staged replay's refusal to touch the pane — is all assertable against a fake
 * pane that just records what it was asked to do.
 *
 * The serialization test is the one that matters most. The app pane is ONE
 * page; a warm op still in flight when the operator taps forward twice would
 * otherwise interleave two Playwright flows on it, and that failure arrives
 * mid-demo with no useful error.
 */

import { describe, it, expect } from 'vitest';
import type { AppPane } from '../src/demo/show/app-pane.js';
import type { DemoDeck, DemoSlide } from '../src/demo/show/deck-model.js';
import type { ShowOpContext, ShowRunOptions } from '../src/demo/show/show-run.js';
import type { UiPage } from '../src/demo/ui-page.js';
import {
  armingFor,
  htmlDataUrl,
  makeShowOps,
  stagedReplayHtml,
  OP_IMPLEMENTATIONS,
  type OpDriveContext,
} from '../src/demo/show/op-registry.js';
import { DEMO_OP_IDS, type DemoOpId } from '../src/demo/show/deck-model.js';
import type { ArmedSim, ArmSimOptions } from '../src/demo/show/arm-sim.js';

const OPTIONS: ShowRunOptions = {
  deckPath: 'demos/t.xlsx',
  slidesPort: 4500,
  defaultDwellSec: 30,
  auto: true,
  presenter: true,
  slidesGeometry: { width: 1280, height: 720, x: 0, y: 0 },
  appGeometry: { width: 620, height: 1000, x: 1290, y: 0 },
  testerRoot: 'C:/ces/ces-tester',
  stacksimRoot: 'C:/ces/tenant-stacksim',
  aoRoot: 'C:/ces/ces-ao',
};

function slide(n: number, op: Partial<DemoSlide['op']> = {}): DemoSlide {
  return {
    slideNumber: n,
    rows: [{ sheetRow: n + 1, slideNumber: n, feature: `Slide ${n}` }],
    op: { mode: 'staged', tools: [], images: [], ...op },
  };
}

function deckOf(...slides: DemoSlide[]): DemoDeck {
  return { sourcePath: 'demos/t.xlsx', baseDir: '/demos', title: 't', slides, assets: [], warnings: [] };
}

/** A pane that records every navigation, and nothing else. */
function fakePane(): AppPane & { readonly visited: string[] } {
  const visited: string[] = [];
  const page = {
    goto: async (url: string) => {
      visited.push(url);
    },
  } as unknown as UiPage;
  return {
    visited,
    page,
    session: {} as AppPane['session'],
    goto: async (url: string) => {
      visited.push(url);
    },
    close: async () => undefined,
  } as AppPane & { readonly visited: string[] };
}

function armedStub(overrides: Partial<ArmedSim> = {}): ArmedSim {
  return {
    slug: 'demo-dib-small',
    simUrl: 'http://127.0.0.1:4390',
    aoBaseUrl: 'http://127.0.0.1:3001',
    eoBaseUrl: 'http://127.0.0.1:4002',
    runDir: 'C:/ces/ces-tester/runs/show/test',
    stop: async () => undefined,
    ...overrides,
  };
}

function ctxFor(pane: AppPane, deckSlide: DemoSlide, index: number): ShowOpContext {
  return { pane, slide: deckSlide, index, options: OPTIONS, log: () => undefined };
}

describe('op registry', () => {
  it('registers exactly the op ids the deck model allows', () => {
    expect(Object.keys(OP_IMPLEMENTATIONS).sort()).toEqual([...DEMO_OP_IDS].sort());
    expect(Object.keys(OP_IMPLEMENTATIONS).sort()).toEqual([
      'ao-make-change',
      'ao-registry',
      'eo-review',
      'eo-show-change-captured',
      'muster-adaptive-interview',
      'muster-auto-analysis',
      'muster-connect-tenant',
      'muster-consent-and-attest',
      'muster-generate-sprs-mp',
      'muster-readiness',
      'muster-rollup',
      'simstack-create',
      'simstack-destroy',
      'stamper-execute',
      'stamper-translate',
    ]);
  });

  it('arms once during prep, and only when the deck actually drives something', async () => {
    const armCalls: number[] = [];
    const arm = async (): Promise<ArmedSim> => {
      armCalls.push(1);
      return armedStub();
    };

    const narrationOnly = makeShowOps(fakePane(), deckOf(slide(1), slide(2)), OPTIONS, { arm, log: () => undefined });
    await narrationOnly.prepare!();
    expect(armCalls).toHaveLength(0);

    const withLive = makeShowOps(
      fakePane(),
      deckOf(slide(1), slide(2, { mode: 'live', opId: 'ao-registry' })),
      OPTIONS,
      { arm, log: () => undefined },
    );
    await withLive.prepare!();
    expect(armCalls).toHaveLength(1);
  });

  it('never arms for a deck whose only op is staged', async () => {
    let armed = false;
    const ops = makeShowOps(fakePane(), deckOf(slide(1, { mode: 'staged', opId: 'ao-registry' })), OPTIONS, {
      arm: async () => {
        armed = true;
        return armedStub();
      },
      log: () => undefined,
    });
    await ops.prepare!();
    expect(armed).toBe(false);
  });

  it('dispatches to the implementation registered for the slide op id', async () => {
    const pane = fakePane();
    const seen: OpDriveContext[] = [];
    const deck = deckOf(slide(1), slide(2, { mode: 'live', opId: 'ao-registry' }));
    const ops = makeShowOps(pane, deck, OPTIONS, {
      arm: async () => armedStub(),
      implementations: {
        'ao-registry': async (ctx) => {
          seen.push(ctx);
        },
      },
      log: () => undefined,
    });
    await ops.prepare!();
    await ops.run(ctxFor(pane, deck.slides[1], 1));

    expect(seen).toHaveLength(1);
    expect(seen[0].slide.slideNumber).toBe(2);
    expect(seen[0].armed).toMatchObject({ slug: 'demo-dib-small', aoBaseUrl: 'http://127.0.0.1:3001' });
  });

  it('fails loudly rather than silently when prep never ran or the op is unknown', async () => {
    const pane = fakePane();
    const deck = deckOf(slide(1, { mode: 'live', opId: 'ao-registry' }));

    const unarmed = makeShowOps(pane, deck, OPTIONS, { implementations: { 'ao-registry': async () => undefined }, log: () => undefined });
    await expect(unarmed.run(ctxFor(pane, deck.slides[0], 0))).rejects.toThrow(/the sim was never armed/);

    const noOpId = makeShowOps(pane, deckOf(slide(1, { mode: 'live' })), OPTIONS, { arm: async () => armedStub(), log: () => undefined });
    await expect(noOpId.run(ctxFor(pane, slide(1, { mode: 'live' }), 0))).rejects.toThrow(/names no op/);
  });

  it('dispatches eo-review and hands it the armed EO base url', async () => {
    const pane = fakePane();
    const seen: OpDriveContext[] = [];
    const deck = deckOf(slide(1), slide(2, { mode: 'live', opId: 'eo-review' }));
    const ops = makeShowOps(pane, deck, OPTIONS, {
      arm: async () => armedStub(),
      implementations: {
        'eo-review': async (ctx) => {
          seen.push(ctx);
        },
      },
      log: () => undefined,
    });
    await ops.prepare!();
    await ops.run(ctxFor(pane, deck.slides[1], 1));

    expect(seen).toHaveLength(1);
    expect(seen[0].armed.eoBaseUrl).toBe('http://127.0.0.1:4002');
    // The op branches on this, so the show must actually deliver it.
    expect(seen[0].slide.op.mode).toBe('live');
  });

  it('arms only the surfaces the deck actually drives', async () => {
    const asked: ArmSimOptions[] = [];
    const arm = async (_o: ShowRunOptions, _l: (line: string) => void, opts: ArmSimOptions): Promise<ArmedSim> => {
      asked.push(opts);
      return armedStub();
    };
    const prepareWith = async (...slides: DemoSlide[]): Promise<void> => {
      await makeShowOps(fakePane(), deckOf(...slides), OPTIONS, { arm, log: () => undefined }).prepare!();
    };

    await prepareWith(slide(1, { mode: 'live', opId: 'ao-registry' }));
    await prepareWith(slide(1, { mode: 'warm', opId: 'eo-review' }));
    await prepareWith(slide(1, { mode: 'warm', opId: 'eo-review' }), slide(2, { mode: 'live', opId: 'ao-registry' }));

    // An AO-only deck must not pay for EO's boot, and vice versa — EO is the
    // slowest thing arming spawns.
    expect(asked[0]).toEqual({ withAoGui: true, withEo: false, withStamperGui: false, withMuster: false });
    expect(asked[1]).toEqual({ withAoGui: false, withEo: true, withStamperGui: false, withMuster: false });
    expect(asked[2]).toEqual({ withAoGui: true, withEo: true, withStamperGui: false, withMuster: false });
  });

  it('armingFor maps driven op ids to surfaces, and a staged-only deck asks for none', () => {
    expect(armingFor(new Set<DemoOpId>())).toEqual({ withAoGui: false, withEo: false, withStamperGui: false, withMuster: false });
    expect(armingFor(new Set<DemoOpId>(['eo-review']))).toEqual({
      withAoGui: false,
      withEo: true,
      withStamperGui: false,
      withMuster: false,
    });
    // `muster-readiness` (GP-DEMO-5 streamgui) now imports its CLI result INTO the
    // Muster SPA and streams the boundary panel, so it arms :4173 — but never an
    // AO GUI or an EO server.
    expect(armingFor(new Set<DemoOpId>(['muster-readiness']))).toEqual({
      withAoGui: false,
      withEo: false,
      withStamperGui: false,
      withMuster: true,
    });
    // Either stamper op is enough to want the Configuration GUI armed.
    for (const opId of ['stamper-translate', 'stamper-execute'] as const) {
      expect(armingFor(new Set<DemoOpId>([opId])), opId).toEqual({
        withAoGui: false,
        withEo: false,
        withStamperGui: true,
        withMuster: false,
      });
    }
  });

  describe('the backstage session (THREAD_HANDOFF: Config is never on stage)', () => {
    const backstageDeps = (): {
      readonly opened: AppPane[];
      readonly closed: number[];
      readonly openBackstage: () => Promise<AppPane>;
    } => {
      const opened: AppPane[] = [];
      const closed: number[] = [];
      return {
        opened,
        closed,
        openBackstage: async () => {
          const pane = fakePane();
          const wrapped: AppPane = { ...pane, close: async () => void closed.push(opened.length) };
          opened.push(wrapped);
          return wrapped;
        },
      };
    };

    it('is created only for a deck that drives a stamper op', async () => {
      for (const [opId, expected] of [
        ['stamper-translate', 1],
        ['stamper-execute', 1],
        ['eo-review', 0],
        ['ao-registry', 0],
        ['muster-readiness', 0],
      ] as const) {
        const d = backstageDeps();
        const ops = makeShowOps(fakePane(), deckOf(slide(1, { mode: 'warm', opId })), OPTIONS, {
          arm: async () => armedStub(),
          openBackstage: d.openBackstage,
          implementations: { [opId]: async () => undefined },
          log: () => undefined,
        });
        await ops.prepare!();
        expect(d.opened.length, opId).toBe(expected);
      }
    });

    it('is handed to the op as `backstage`, and the visible pane is a different object', async () => {
      const d = backstageDeps();
      const pane = fakePane();
      let seen: OpDriveContext | undefined;
      const deckSlide = slide(1, { mode: 'warm', opId: 'stamper-translate' });
      const ops = makeShowOps(pane, deckOf(deckSlide), OPTIONS, {
        arm: async () => armedStub({ stamperBaseUrl: 'http://127.0.0.1:3000' }),
        openBackstage: d.openBackstage,
        implementations: {
          'stamper-translate': async (ctx) => {
            seen = ctx;
          },
        },
        log: () => undefined,
      });
      await ops.prepare!();
      await ops.run(ctxFor(pane, deckSlide, 0));

      expect(seen?.backstage).toBe(d.opened[0]);
      expect(seen?.backstage).not.toBe(pane);
      // The armed Stamper base url reaches the op — omitting the copy from the
      // env literal would leave it undefined and the op would refuse to run.
      expect(seen?.armed.stamperBaseUrl).toBe('http://127.0.0.1:3000');
      // Nothing was shown in the audience-visible pane.
      expect(pane.visited).toEqual([]);
    });

    it('is closed on dispose, BEFORE the servers it was driving are killed', async () => {
      const d = backstageDeps();
      const order: string[] = [];
      const ops = makeShowOps(fakePane(), deckOf(slide(1, { mode: 'warm', opId: 'stamper-translate' })), OPTIONS, {
        arm: async () => armedStub({ stop: async () => void order.push('armed.stop') }),
        openBackstage: async () => {
          const pane = fakePane();
          return { ...pane, close: async () => void order.push('backstage.close') };
        },
        implementations: { 'stamper-translate': async () => undefined },
        log: () => undefined,
      });
      await ops.prepare!();
      await ops.dispose!();
      expect(order).toEqual(['backstage.close', 'armed.stop']);
      expect(d.opened).toEqual([]);
    });

    it('leaves `backstage` undefined for a deck that needs none', async () => {
      const pane = fakePane();
      let seen: OpDriveContext | undefined;
      const deckSlide = slide(1, { mode: 'live', opId: 'ao-registry' });
      const ops = makeShowOps(pane, deckOf(deckSlide), OPTIONS, {
        arm: async () => armedStub(),
        implementations: {
          'ao-registry': async (ctx) => {
            seen = ctx;
          },
        },
        log: () => undefined,
      });
      await ops.prepare!();
      await ops.run(ctxFor(pane, deckSlide, 0));
      expect(seen?.backstage).toBeUndefined();
    });
  });

  it('stops the armed environment on dispose (A8)', async () => {
    let stopped = 0;
    const deck = deckOf(slide(1, { mode: 'live', opId: 'ao-registry' }));
    const ops = makeShowOps(fakePane(), deck, OPTIONS, {
      arm: async () => armedStub({ stop: async () => { stopped += 1; } }),
      log: () => undefined,
    });
    await ops.prepare!();
    await ops.dispose!();
    await ops.dispose!(); // idempotent — the disposer list may run twice
    expect(stopped).toBe(1);
  });
});

describe('serialization (one pane, one lane)', () => {
  const deck = deckOf(
    slide(1),
    slide(2, { mode: 'warm', opId: 'ao-registry' }),
    slide(3, { mode: 'live', opId: 'ao-registry' }),
  );

  it('never lets two ops interleave on the pane', async () => {
    const pane = fakePane();
    const events: string[] = [];
    const gate: (() => void)[] = [];

    const ops = makeShowOps(pane, deck, OPTIONS, {
      arm: async () => armedStub(),
      implementations: {
        'ao-registry': async (ctx) => {
          events.push(`start ${ctx.slide.slideNumber}`);
          await new Promise<void>((resolve) => gate.push(resolve));
          events.push(`end ${ctx.slide.slideNumber}`);
        },
      },
      log: () => undefined,
    });
    await ops.prepare!();

    // Warm starts, then the operator taps forward before it finished.
    const warm = ops.run(ctxFor(pane, deck.slides[1], 1));
    const live = ops.run(ctxFor(pane, deck.slides[2], 2));
    await new Promise((r) => setTimeout(r, 5));

    // Only the warm op has started — the live one is queued behind it.
    expect(events).toEqual(['start 2']);
    gate.shift()!();
    await warm;
    await new Promise((r) => setTimeout(r, 5));
    gate.shift()!();
    await live;

    expect(events).toEqual(['start 2', 'end 2', 'start 3', 'end 3']);
  });

  it('a failing op does not poison the queue for the next one', async () => {
    const pane = fakePane();
    const ran: number[] = [];
    const ops = makeShowOps(pane, deck, OPTIONS, {
      arm: async () => armedStub(),
      implementations: {
        'ao-registry': async (ctx) => {
          ran.push(ctx.slide.slideNumber);
          if (ctx.slide.slideNumber === 2) throw new Error('AO GUI never came up');
        },
      },
      log: () => undefined,
    });
    await ops.prepare!();

    const first = ops.run(ctxFor(pane, deck.slides[1], 1));
    const second = ops.run(ctxFor(pane, deck.slides[2], 2));
    await expect(first).rejects.toThrow('AO GUI never came up');
    await expect(second).resolves.toBeUndefined();
    expect(ran).toEqual([2, 3]);
  });
});

describe('staged replay', () => {
  it('leaves the pane alone for a slide that declares no op', async () => {
    const pane = fakePane();
    const deck = deckOf(slide(1), slide(2, { mode: 'warm', opId: 'ao-registry' }));
    const ops = makeShowOps(pane, deck, OPTIONS, { arm: async () => armedStub(), log: () => undefined });
    await ops.reveal!(ctxFor(pane, deck.slides[0], 0));
    // This is the whole point: narration slides must not wipe a warm result
    // off the pane before its own slide arrives.
    expect(pane.visited).toEqual([]);
  });

  it('shows an honest replay page for a slide that declares an op but is staged', async () => {
    const pane = fakePane();
    const staged = slide(4, { mode: 'staged', opId: 'ao-registry' });
    const ops = makeShowOps(pane, deckOf(staged), OPTIONS, { arm: async () => armedStub(), log: () => undefined });
    await ops.reveal!(ctxFor(pane, staged, 0));

    expect(pane.visited).toHaveLength(1);
    expect(pane.visited[0].startsWith('data:text/html;charset=utf-8;base64,')).toBe(true);
    const html = Buffer.from(pane.visited[0].split('base64,')[1], 'base64').toString('utf8');
    expect(html).toContain('staged replay');
    expect(html).toContain('ao-registry');
    // It never claims a result it did not get.
    expect(html).not.toMatch(/success|SAT|complete/i);
  });

  it('escapes founder text and embeds a declared image', () => {
    const html = stagedReplayHtml({
      slideNumber: 3,
      rows: [{ sheetRow: 4, slideNumber: 3, feature: '<b>Pwn</b>' }],
      op: {
        mode: 'staged',
        opId: 'ao-registry',
        tools: [],
        images: [{ id: 'a.png', rawValue: 'art/a.png', absPath: 'C:\\repo\\demos\\art\\a.png' }],
      },
    });
    expect(html).not.toContain('<b>Pwn</b>');
    expect(html).toContain('&lt;b&gt;Pwn&lt;/b&gt;');
    expect(html).toContain('file:///C:/repo/demos/art/a.png');
  });

  it('htmlDataUrl round-trips', () => {
    const url = htmlDataUrl('<p>hi &amp; bye</p>');
    expect(Buffer.from(url.split('base64,')[1], 'base64').toString('utf8')).toBe('<p>hi &amp; bye</p>');
  });
});
