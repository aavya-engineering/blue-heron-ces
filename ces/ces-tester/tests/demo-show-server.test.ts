// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 S3 — the slides server and the operator runner.
 *
 * Every server here binds port **0**, never 4500: an ephemeral port keeps
 * `npm test` safe to run beside a live `demo:show` and safe to run in parallel
 * with itself.
 *
 * The runner tests cover A5's terminal half and A8's teardown with hand-written
 * fakes for both windows — the disposer list is the whole of A8, and asserting
 * it needs no browser at all.
 *
 * (Plan note: the File Inventory has no `demo-show-run.test.ts`; the runner is
 * the other half of this slice, so its tests live here rather than in a file the
 * plan does not allow.)
 */

import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { startSlidesServer, type SlidesServer } from '../src/demo/show/slides-server.js';
import { runShow, terminalAction, terminalKeyName, type ShowRunOptions } from '../src/demo/show/show-run.js';
import { parseGeometry, formatGeometry, DEFAULT_APP_GEOMETRY, DEFAULT_SLIDES_GEOMETRY, type AppPane } from '../src/demo/show/app-pane.js';
import type { DemoDeck, DemoSlide, SlideImage } from '../src/demo/show/deck-model.js';

function slide(n: number, opts: { mode?: DemoSlide['op']['mode']; opId?: 'ao-registry'; durationSec?: number; images?: SlideImage[]; html?: SlideImage } = {}): DemoSlide {
  return {
    slideNumber: n,
    rows: [{ sheetRow: n + 1, slideNumber: n, feature: `Slide ${n}`, talkTrack: `narration ${n}` }],
    op: {
      mode: opts.mode ?? 'staged',
      opId: opts.opId,
      tools: [],
      durationSec: opts.durationSec,
      images: opts.images ?? [],
      html: opts.html,
    },
  };
}

function deckOf(...slides: DemoSlide[]): DemoDeck {
  return { sourcePath: 'demos/t.xlsx', baseDir: '/demos', title: 'test-deck', slides, assets: [], warnings: [] };
}

/** Start a server on an ephemeral port and always stop it. */
async function withServer(
  deck: DemoDeck,
  fn: (server: SlidesServer) => Promise<void>,
  opts: Parameters<typeof startSlidesServer>[0] extends infer T ? Partial<T> : never = {},
): Promise<void> {
  const server = await startSlidesServer({ deck, port: 0, tickMs: 10_000, ...opts });
  try {
    await fn(server);
  } finally {
    await server.stop();
  }
}

describe('slides server routes', () => {
  const deck = deckOf(slide(1, { durationSec: 10 }), slide(2), slide(3));

  it('serves the page with the deck inlined and no external assets', async () => {
    await withServer(deck, async (server) => {
      const res = await fetch(server.url);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      const html = await res.text();
      // The deck rides inside the inlined JSON, so its `<` are <-escaped —
      // that escaping is exactly what keeps a `</script>` in a cell from
      // blanking the deck mid-demo. Slide 1 renders through the V4 title path,
      // so its heading is the hero one.
      expect(html).toContain('\\u003ch1 class=');
      expect(html).toContain('Slide 1\\u003c/h1>');
      expect(html).toContain('id="deck-data"');
      expect(html).not.toMatch(/<script[^>]+src=/);
    });
  });

  it('404s an unknown route', async () => {
    await withServer(deck, async (server) => {
      expect((await fetch(`${server.url}nope`)).status).toBe(404);
    });
  });

  it('exposes the current snapshot as JSON', async () => {
    await withServer(deck, async (server) => {
      const snap = (await (await fetch(`${server.url}state`)).json()) as { index: number; slideCount: number };
      expect(snap).toMatchObject({ index: 0, slideCount: 3 });
    });
  });

  it('hands onChange the ACTION, so an auto tick is distinguishable from a manual advance', async () => {
    const seen: { type: string; index: number; movedIndex: boolean }[] = [];
    await withServer(
      deck,
      async (server) => {
        server.dispatch({ type: 'next' });
        server.dispatch({ type: 'toggle-presenter' });
        server.dispatch({ type: 'goto', index: 0 });

        expect(seen.map((s) => s.type)).toEqual(['next', 'toggle-presenter', 'goto']);
        // The toggle changed state but NOT the index — a report that treated
        // every onChange as a slide move would invent a transition here.
        expect(seen.map((s) => s.movedIndex)).toEqual([true, false, true]);
      },
      {
        onChange: (state, previous, action) => {
          seen.push({ type: action.type, index: state.index, movedIndex: state.index !== previous.index });
        },
      },
    );
  });
});

describe('POST /nav (A5, page half)', () => {
  const deck = deckOf(slide(1), slide(2), slide(3));

  const post = (server: SlidesServer, body: unknown): Promise<Response> =>
    fetch(`${server.url}nav`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('moves next / prev / first / last from a keypress', async () => {
    await withServer(deck, async (server) => {
      expect((await post(server, { key: 'ArrowRight' })).status).toBe(204);
      expect(server.state().index).toBe(1);
      await post(server, { key: 'End' });
      expect(server.state().index).toBe(2);
      await post(server, { key: 'ArrowLeft' });
      expect(server.state().index).toBe(1);
      await post(server, { key: 'Home' });
      expect(server.state().index).toBe(0);
    });
  });

  it('exits on Escape and q', async () => {
    await withServer(deck, async (server) => {
      await post(server, { key: 'Escape' });
      expect(server.state().exited).toBe(true);
    });
    await withServer(deck, async (server) => {
      await post(server, { key: 'q' });
      expect(server.state().exited).toBe(true);
    });
  });

  it('accepts an explicit action and ignores an unmapped key or malformed body', async () => {
    await withServer(deck, async (server) => {
      await post(server, { action: { type: 'goto', index: 2 } });
      expect(server.state().index).toBe(2);
      expect((await post(server, { key: 'ß' })).status).toBe(204);
      expect(server.state().index).toBe(2);
      const res = await fetch(`${server.url}nav`, { method: 'POST', body: 'not json' });
      expect(res.status).toBe(204);
      expect(server.state().index).toBe(2);
    });
  });
});

describe('GET /events (SSE broadcast)', () => {
  const deck = deckOf(slide(1), slide(2));

  it('sends the current state immediately and again on every change', async () => {
    await withServer(deck, async (server) => {
      const res = await fetch(`${server.url}events`);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      expect(res.headers.get('cache-control')).toContain('no-cache');
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();

      const readEvent = async (): Promise<Record<string, unknown>> => {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) throw new Error('stream ended');
          const chunk = decoder.decode(value);
          const match = /data: (.*)\n/.exec(chunk);
          if (match) return JSON.parse(match[1]) as Record<string, unknown>;
        }
      };

      // The just-connected page must not wait for a tick to draw.
      expect(await readEvent()).toMatchObject({ index: 0, slideCount: 2 });
      expect(server.clientCount()).toBe(1);

      server.dispatch({ type: 'next' });
      expect(await readEvent()).toMatchObject({ index: 1 });

      await reader.cancel();
    });
  });

  it('drops the client when the stream closes, so teardown has nothing to wait on', async () => {
    await withServer(deck, async (server) => {
      const controller = new AbortController();
      const res = await fetch(`${server.url}events`, { signal: controller.signal });
      await res.body!.getReader().read();
      expect(server.clientCount()).toBe(1);
      controller.abort();
      await vi.waitFor(() => expect(server.clientCount()).toBe(0));
    });
  });
});

describe('GET /asset/<id> (traversal guard)', () => {
  it('serves a declared asset by id and refuses anything else', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-show-assets-'));
    try {
      const file = path.join(dir, 'one.png');
      fs.writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      const asset: SlideImage = { id: 'one.png', rawValue: 'one.png', absPath: file };
      const deck: DemoDeck = {
        ...deckOf(slide(1, { images: [asset] })),
        baseDir: dir,
        assets: [asset],
      };

      await withServer(deck, async (server) => {
        const ok = await fetch(`${server.url}asset/one.png`);
        expect(ok.status).toBe(200);
        expect(ok.headers.get('content-type')).toBe('image/png');
        expect(Buffer.from(await ok.arrayBuffer())).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

        // Assets are addressed BY ID out of the deck's own table, so a path
        // simply is not a thing the route can be handed.
        for (const attempt of [
          'asset/../../package.json',
          'asset/..%2F..%2Fpackage.json',
          'asset/%2e%2e%2f%2e%2e%2fpackage.json',
          'asset/C:/Windows/win.ini',
          'asset/two.png',
        ]) {
          const res = await fetch(`${server.url}${attempt}`);
          expect(res.status, attempt).toBe(404);
          expect(await res.text()).not.toContain('ces-tester');
        }
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('serves an html slide body as text/html so the iframe can render it', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-show-assets-'));
    try {
      const file = path.join(dir, 'hero.html');
      fs.writeFileSync(file, '<!doctype html><h2>Hero</h2>', 'utf8');
      const asset: SlideImage = { id: 'hero.html', rawValue: 'hero.html', absPath: file };
      const deck: DemoDeck = {
        ...deckOf(slide(1, { html: asset })),
        baseDir: dir,
        assets: [asset],
      };

      await withServer(deck, async (server) => {
        const res = await fetch(`${server.url}asset/hero.html`);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
        expect(await res.text()).toContain('<h2>Hero</h2>');
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('server-owned pacing', () => {
  it('advances the deck on its own clock, holding while an op runs', async () => {
    const deck = deckOf(slide(1, { durationSec: 1 }), slide(2, { mode: 'live', opId: 'ao-registry', durationSec: 1 }), slide(3));
    let clock = 0;
    await withServer(
      deck,
      async (server) => {
        expect(server.state().index).toBe(0);
        clock = 1_500;
        await vi.waitFor(() => expect(server.state().index).toBe(1), { timeout: 2_000 });
        // Slide 2 drives an op, so no amount of clock movement advances it.
        clock = 900_000;
        await new Promise((r) => setTimeout(r, 60));
        expect(server.state().index).toBe(1);
        server.dispatch({ type: 'op', index: 1, status: 'done' });
        clock = 900_000 + 1_500;
        await vi.waitFor(() => expect(server.state().index).toBe(2), { timeout: 2_000 });
      },
      { tickMs: 10, now: () => clock },
    );
  });
});

describe('geometry flags (A4)', () => {
  it('parses and round-trips the X geometry spelling', () => {
    expect(parseGeometry('1280x720+0+0')).toEqual({ width: 1280, height: 720, x: 0, y: 0 });
    expect(parseGeometry('620x1000+1290+0')).toEqual({ width: 620, height: 1000, x: 1290, y: 0 });
    expect(parseGeometry('800x600-10-20')).toEqual({ width: 800, height: 600, x: -10, y: -20 });
    expect(formatGeometry(DEFAULT_SLIDES_GEOMETRY)).toBe('1280x720+0+0');
    expect(formatGeometry(DEFAULT_APP_GEOMETRY)).toBe('620x1000+1290+0');
  });

  it('rejects malformed geometry rather than silently defaulting', () => {
    for (const bad of ['1280x720', 'x+0+0', '1280*720+0+0', '0x0+0+0', '']) {
      expect(parseGeometry(bad), bad).toBeUndefined();
    }
  });

  it('defaults place the slides landscape left and the app pane portrait right', () => {
    expect(DEFAULT_SLIDES_GEOMETRY.width / DEFAULT_SLIDES_GEOMETRY.height).toBeCloseTo(16 / 9, 3);
    expect(DEFAULT_APP_GEOMETRY.height).toBeGreaterThan(DEFAULT_APP_GEOMETRY.width);
    expect(DEFAULT_APP_GEOMETRY.x).toBeGreaterThanOrEqual(DEFAULT_SLIDES_GEOMETRY.width);
  });
});

describe('terminal nav (A5, terminal half)', () => {
  it('maps raw bytes to the same key names the page sends', () => {
    expect(terminalKeyName('\u001b[C')).toBe('ArrowRight');
    expect(terminalKeyName('\u001b[D')).toBe('ArrowLeft');
    expect(terminalKeyName('\u001b[H')).toBe('Home');
    expect(terminalKeyName('\u001b[F')).toBe('End');
    expect(terminalKeyName('\u0003')).toBe('Escape'); // Ctrl-C
    expect(terminalKeyName('\u001b')).toBe('Escape');
    expect(terminalKeyName('q')).toBe('Escape');
    expect(terminalKeyName('\r')).toBe(' ');
  });

  it('produces the same actions the page keys do', () => {
    expect(terminalAction('\u001b[C')).toEqual({ type: 'next' });
    expect(terminalAction('\u001b[D')).toEqual({ type: 'prev' });
    expect(terminalAction('\u001b[H')).toEqual({ type: 'first' });
    expect(terminalAction('\u001b[F')).toEqual({ type: 'last' });
    expect(terminalAction('\u0003')).toEqual({ type: 'exit' });
    expect(terminalAction('t')).toEqual({ type: 'toggle-presenter' });
    expect(terminalAction('\u0000')).toBeUndefined();
  });
});

describe('runShow teardown (A8)', () => {
  const deck = deckOf(slide(1, { durationSec: 999 }), slide(2, { mode: 'live', opId: 'ao-registry', durationSec: 999 }));

  const options: ShowRunOptions = {
    deckPath: 'demos/t.xlsx',
    slidesPort: 4500,
    defaultDwellSec: 30,
    auto: true,
    presenter: true,
    slidesGeometry: DEFAULT_SLIDES_GEOMETRY,
    appGeometry: DEFAULT_APP_GEOMETRY,
    testerRoot: 'C:/ces/ces-tester',
    stacksimRoot: 'C:/ces/tenant-stacksim',
    aoRoot: 'C:/ces/ces-ao',
    // These tests assert teardown and op scheduling, not reporting. Leaving the
    // report on would have runShow write into a testerRoot that does not exist
    // on this machine — creating directories OUTSIDE the project root.
    report: false,
  };

  function fakes() {
    const closed: string[] = [];
    const pane = {
      page: {} as AppPane['page'],
      session: {} as AppPane['session'],
      goto: async () => undefined,
      close: async () => {
        closed.push('app pane');
      },
    } as AppPane;
    return {
      closed,
      pane,
      openSlides: async () => ({
        page: {} as never,
        raw: {} as never,
        close: async () => {
          closed.push('slides window');
        },
      }),
      openApp: async () => pane,
    };
  }

  it('closes both windows and the slides server on exit, in reverse order', async () => {
    const f = fakes();
    const code = await runShow(options, {
      load: async () => deck,
      probe: async () => 'free',
      openSlides: f.openSlides,
      openApp: f.openApp,
      log: () => undefined,
      until: (exit) => setTimeout(exit, 20),
    });
    expect(code).toBe(0);
    expect(f.closed).toEqual(['app pane', 'slides window']);
  });

  it('refuses to start when the slides port is taken, and leaves nothing behind', async () => {
    const f = fakes();
    const lines: string[] = [];
    const code = await runShow(options, {
      load: async () => deck,
      probe: async () => 'occupied',
      openSlides: f.openSlides,
      openApp: f.openApp,
      log: (l) => lines.push(l),
    });
    expect(code).toBe(1);
    expect(lines.join('\n')).toContain('port 4500 is already in use');
    expect(f.closed).toEqual([]);
  });

  it('tears down even when opening the app pane throws', async () => {
    const f = fakes();
    const code = await runShow(options, {
      load: async () => deck,
      probe: async () => 'free',
      openSlides: f.openSlides,
      openApp: async () => {
        throw new Error('no display');
      },
      log: () => undefined,
    });
    expect(code).toBe(1);
    // The slides window still gets closed — the disposer list does not care
    // which step failed.
    expect(f.closed).toEqual(['slides window']);
  });

  it('has SIGINT covered BEFORE prep, so Ctrl-C while arming cannot orphan a server', async () => {
    const f = fakes();
    const order: string[] = [];
    let listenersDuringPrep = 0;

    const code = await runShow(options, {
      load: async () => deck,
      probe: async () => 'free',
      openSlides: f.openSlides,
      openApp: f.openApp,
      makeOps: () => ({
        prepare: async () => {
          // Arming is the longest, most process-spawning phase. With no SIGINT
          // listener registered yet, a Ctrl-C here would hard-exit node and
          // skip `finally` entirely — stacksim serve and the AO GUI survive.
          listenersDuringPrep = process.listenerCount('SIGINT');
          order.push('prep');
        },
        run: async () => undefined,
        dispose: async () => {
          order.push('ops disposed');
        },
      }),
      log: () => undefined,
      until: (exit) => setTimeout(exit, 20),
    });

    expect(code).toBe(0);
    expect(listenersDuringPrep).toBeGreaterThan(0);
    expect(order).toEqual(['prep', 'ops disposed']);
  });

  it('skips the deck and tears down when a signal arrives during prep', async () => {
    const f = fakes();
    const warmed: number[] = [];
    let server: SlidesServer | undefined;

    await runShow(options, {
      load: async () => deck,
      probe: async () => 'free',
      startServer: async (o) => {
        server = await startSlidesServer({ ...o, port: 0, tickMs: 10_000 });
        return server;
      },
      openSlides: f.openSlides,
      openApp: f.openApp,
      makeOps: () => ({
        prepare: async () => {
          // Stand in for the operator's Ctrl-C landing mid-arming.
          server!.dispatch({ type: 'exit' });
        },
        run: async (ctx) => {
          warmed.push(ctx.index);
        },
      }),
      log: () => undefined,
    });

    expect(warmed).toEqual([]);
    expect(f.closed).toEqual(['app pane', 'slides window']);
  });

  it('restores the terminal so the process can actually exit', async () => {
    const f = fakes();
    const listeners: ((chunk: string) => void)[] = [];
    const raw: boolean[] = [];
    const stdin = {
      isTTY: true,
      setRawMode: (v: boolean) => {
        raw.push(v);
      },
      resume: () => undefined,
      pause: () => {
        raw.push(false);
      },
      setEncoding: () => undefined,
      on: (_e: string, fn: (chunk: string) => void) => listeners.push(fn),
      off: () => listeners.pop(),
    } as unknown as NodeJS.ReadStream;

    await runShow(options, {
      load: async () => deck,
      probe: async () => 'free',
      openSlides: f.openSlides,
      openApp: f.openApp,
      stdin,
      log: () => undefined,
      until: () => setTimeout(() => listeners[0]?.('q'), 10),
    });
    expect(raw[0]).toBe(true);
    expect(raw[raw.length - 1]).toBe(false);
  });
});

describe('runShow op scheduling', () => {
  const deck = deckOf(
    slide(1, { durationSec: 999 }),
    slide(2, { mode: 'warm', opId: 'ao-registry', durationSec: 999 }),
    slide(3, { mode: 'live', opId: 'ao-registry', durationSec: 999 }),
    slide(4, { mode: 'staged', opId: 'ao-registry', durationSec: 999 }),
  );

  const options: ShowRunOptions = {
    deckPath: 'demos/t.xlsx',
    slidesPort: 4500,
    defaultDwellSec: 30,
    auto: false,
    presenter: true,
    slidesGeometry: DEFAULT_SLIDES_GEOMETRY,
    appGeometry: DEFAULT_APP_GEOMETRY,
    testerRoot: 'C:/ces/ces-tester',
    stacksimRoot: 'C:/ces/tenant-stacksim',
    aoRoot: 'C:/ces/ces-ao',
    // These tests assert teardown and op scheduling, not reporting. Leaving the
    // report on would have runShow write into a testerRoot that does not exist
    // on this machine — creating directories OUTSIDE the project root.
    report: false,
  };

  it('warms during prep, drives live ops on arrival, and never runs a staged op', async () => {
    const ran: number[] = [];
    const prepared: string[] = [];
    let server: SlidesServer | undefined;

    const closed: string[] = [];
    await runShow(options, {
      load: async () => deck,
      probe: async () => 'free',
      startServer: async (o) => {
        server = await startSlidesServer({ ...o, port: 0, tickMs: 10_000 });
        return server;
      },
      openSlides: async () => ({ page: {} as never, raw: {} as never, close: async () => { closed.push('slides'); } }),
      openApp: async () =>
        ({ page: {} as never, session: {} as never, goto: async () => undefined, close: async () => { closed.push('app'); } }) as AppPane,
      makeOps: () => ({
        prepare: async () => {
          prepared.push('armed');
        },
        run: async (ctx) => {
          ran.push(ctx.slide.slideNumber);
        },
      }),
      log: () => undefined,
      until: (exit) => {
        setTimeout(() => {
          // Prep has finished by now: the warm op ran, the live one has not.
          expect(prepared).toEqual(['armed']);
          expect(ran).toEqual([2]);
          server!.dispatch({ type: 'goto', index: 3 }); // staged — must not run
          server!.dispatch({ type: 'goto', index: 2 }); // live — must run
          setTimeout(() => {
            expect(ran).toEqual([2, 3]);
            expect(server!.state().ops).toEqual(['none', 'done', 'done', 'none']);
            exit();
          }, 30);
        }, 30);
      },
    });
    expect(ran).toEqual([2, 3]);
  });

  it('marks an op failed and surfaces the reason without ending the show', async () => {
    let server: SlidesServer | undefined;
    await runShow(options, {
      load: async () => deck,
      probe: async () => 'free',
      startServer: async (o) => {
        server = await startSlidesServer({ ...o, port: 0, tickMs: 10_000 });
        return server;
      },
      openSlides: async () => ({ page: {} as never, raw: {} as never, close: async () => undefined }),
      openApp: async () => ({ page: {} as never, session: {} as never, goto: async () => undefined, close: async () => undefined }) as AppPane,
      makeOps: () => ({ run: async () => { throw new Error('AO GUI never came up'); } }),
      log: () => undefined,
      until: (exit) =>
        setTimeout(() => {
          expect(server!.state().ops[1]).toBe('failed');
          expect(server!.state().opError).toBe('AO GUI never came up');
          expect(server!.state().exited).toBe(false);
          exit();
        }, 40),
    });
  });
});

describe('noTty auto-exit (end-of-deck)', () => {
  const shortDeck = deckOf(
    slide(1, { durationSec: 0.05 }),
    slide(2, { durationSec: 0.05 }),
    slide(3, { durationSec: 0.05 }),
  );

  const opts: ShowRunOptions = {
    deckPath: 'demos/t.xlsx',
    slidesPort: 4500,
    defaultDwellSec: 30,
    auto: true,
    presenter: true,
    slidesGeometry: DEFAULT_SLIDES_GEOMETRY,
    appGeometry: DEFAULT_APP_GEOMETRY,
    testerRoot: 'C:/ces/ces-tester',
    stacksimRoot: 'C:/ces/tenant-stacksim',
    aoRoot: 'C:/ces/ces-ao',
    report: false,
  };

  it('exits cleanly when auto-pacing hits the wall on the last slide', async () => {
    const closed: string[] = [];
    const code = await runShow(opts, {
      load: async () => shortDeck,
      probe: async () => 'free',
      startServer: async (o) => startSlidesServer({ ...o, port: 0, tickMs: 50 }),
      openSlides: async () => ({
        page: {} as never,
        raw: {} as never,
        close: async () => { closed.push('slides window'); },
      }),
      openApp: async () => ({
        page: {} as never,
        session: {} as never,
        goto: async () => undefined,
        close: async () => { closed.push('app pane'); },
      }) as AppPane,
      stdin: { isTTY: false } as unknown as NodeJS.ReadStream,
      log: () => undefined,
    });
    expect(code).toBe(0);
    expect(closed).toEqual(['app pane', 'slides window']);
  }, 5000);
});
