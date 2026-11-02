// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-6 — the per-action NARRATION captions.
 *
 * Two things are worth pinning, and both only fail in ways a code review would
 * miss:
 *
 * 1. **Every act emits its captions in order, at real steps.** A caption that
 *    fired out of order, or not at all, would still compile and still render a
 *    demo — it would just narrate the wrong thing. The `ao-registry` op is driven
 *    against a hand-written `UiPage` (the house pattern) with a recording
 *    `caption`, and the order is asserted.
 * 2. **The runner wires `ctx.caption` to the pane's HUD surface through
 *    `captionScript`.** `makeShowOps().run()` binds the seam; a fake pane whose
 *    `session.raw.evaluate` records proves the op's caption reached the band as a
 *    `captionScript` payload — the op→band edge, end to end.
 *
 * Plus the totality guard: every `DemoOpId` has a non-empty caption set, so a
 * future op cannot ship captionless.
 */

import { describe, it, expect } from 'vitest';
import { AO_SELECTORS } from '../src/demo/ao-ui-driver.js';
import { FakeUiPage } from './helpers/fake-ui-page.js';
import { CAPTIONS, ALL_CAPTIONS } from '../src/demo/show/captions.js';
import { CAPTION_ID } from '../src/demo/show/theatrical-page.js';
import { DEMO_OP_IDS } from '../src/demo/show/deck-model.js';
import { runAoRegistryOp } from '../src/demo/show/ops/ao-registry-op.js';
import { makeShowOps, type OpDriveContext } from '../src/demo/show/op-registry.js';
import type { AppPane } from '../src/demo/show/app-pane.js';
import type { DemoDeck, DemoSlide } from '../src/demo/show/deck-model.js';
import type { ShowOpContext, ShowRunOptions } from '../src/demo/show/show-run.js';
import type { ArmedSim } from '../src/demo/show/arm-sim.js';
import type { UiPage } from '../src/demo/ui-page.js';

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

/** The AO GUI fake that lets `runAoUiFlow` complete (from the driver's own test). */
function aoPage(): FakeUiPage {
  const page = new FakeUiPage({
    texts: {
      [AO_SELECTORS.statusBadge]: 'SUCCESS',
      [AO_SELECTORS.outcomeBadge]: 'automated_success',
    },
    values: { [AO_SELECTORS.tenantSelect]: '' },
    responses: { '/api/execute/A-18': { status: 'success', evidence: { outcome: 'automated_success' } } },
  });
  page.state.onClick[AO_SELECTORS.searchResult('A-18')] = () => {
    page.state.values[AO_SELECTORS.liveToggle] = '';
    page.state.visible.add(AO_SELECTORS.commandForm);
  };
  page.state.onClick[AO_SELECTORS.execute] = () => {
    page.state.visible.add(AO_SELECTORS.resultPanel);
    page.state.visible.add(AO_SELECTORS.evidenceSection);
  };
  return page;
}

function slide(op: Partial<DemoSlide['op']> = {}): DemoSlide {
  return {
    slideNumber: 1,
    rows: [{ sheetRow: 2, slideNumber: 1, feature: 'AO' }],
    op: { mode: 'live', tools: [], images: [], ...op },
  };
}

describe('the caption corpus is total and honest', () => {
  it('gives every DemoOpId a non-empty caption set', () => {
    for (const id of DEMO_OP_IDS) {
      const set = CAPTIONS[id];
      expect(set, id).toBeTruthy();
      const branches = Object.values(set);
      expect(branches.length, id).toBeGreaterThan(0);
      for (const branch of branches) {
        expect(branch.length, id).toBeGreaterThan(0);
        for (const line of branch) {
          expect(typeof line, id).toBe('string');
          expect(line.trim().length, id).toBeGreaterThan(0);
        }
      }
    }
  });

  it('flattens every caption exactly once into ALL_CAPTIONS', () => {
    const flat = Object.values(CAPTIONS).flatMap((set) => Object.values(set).flat());
    expect(ALL_CAPTIONS).toEqual(flat);
    expect(ALL_CAPTIONS.length).toBe(new Set(ALL_CAPTIONS).size); // no duplicates
    expect(ALL_CAPTIONS.length).toBeGreaterThan(40);
  });

  it('carries no run-value interpolation markers (static strings only)', () => {
    for (const line of ALL_CAPTIONS) {
      expect(line, line).not.toMatch(/[$][{]|%[sd]\b|\{\d+\}/);
    }
  });
});

describe('an act emits its captions in order at real steps', () => {
  it('ao-registry narrates the console, the submit, then the evidence trail', async () => {
    const captions: string[] = [];
    const visited: string[] = [];
    const fakeAo = aoPage();
    const pane = {
      page: fakeAo as unknown as UiPage,
      session: {} as AppPane['session'],
      goto: async (url: string) => {
        visited.push(url);
      },
      close: async () => undefined,
    } as unknown as AppPane;

    const ctx: OpDriveContext = {
      pane,
      slide: slide({ opId: 'ao-registry' }),
      index: 0,
      options: OPTIONS,
      log: () => undefined,
      caption: async (text: string) => {
        captions.push(text);
      },
      armed: {
        slug: 'demo-dib-small',
        aoBaseUrl: 'http://127.0.0.1:3001',
        runDir: 'C:/ces/ces-tester/runs/show/test',
        musterRoot: 'C:/ces/ces-muster',
        stamperRoot: 'C:/ces/ces-stamper',
      },
    };

    await runAoRegistryOp(ctx);

    // Exactly the ao-registry corpus, in order — the console framing before the
    // flow, the evidence line after it.
    expect(captions).toEqual([...CAPTIONS['ao-registry'].steps]);
    // The band was painted before the AO GUI was driven (after the goto).
    expect(visited).toContain('http://127.0.0.1:3001');
  });
});

describe('the runner wires ctx.caption to the pane band through captionScript', () => {
  it('an op that calls ctx.caption paints a captionScript payload on the pane surface', async () => {
    const evaluated: string[] = [];
    // hudSurfaceOf reads `pane.session.raw` and only calls `evaluate` lazily, so
    // a `raw` with just `evaluate` is enough to prove the edge.
    const raw = {
      evaluate: async (script: unknown) => {
        evaluated.push(String(script));
        return undefined;
      },
    };
    const pane = {
      page: { goto: async () => undefined } as unknown as UiPage,
      session: { raw } as unknown as AppPane['session'],
      goto: async () => undefined,
      close: async () => undefined,
    } as unknown as AppPane;

    const deck: DemoDeck = {
      sourcePath: 'demos/t.xlsx',
      baseDir: '/demos',
      title: 't',
      slides: [slide({ opId: 'ao-registry' })],
      assets: [],
      warnings: [],
    };
    const armedStub = (): ArmedSim => ({
      slug: 'demo-dib-small',
      simUrl: 'http://127.0.0.1:4390',
      aoBaseUrl: 'http://127.0.0.1:3001',
      runDir: 'C:/ces/ces-tester/runs/show/test',
      stop: async () => undefined,
    });

    const ops = makeShowOps(pane, deck, OPTIONS, {
      arm: async () => armedStub(),
      implementations: {
        'ao-registry': async (ctx) => {
          await ctx.caption?.('LIVE NARRATION LINE');
        },
      },
      log: () => undefined,
    });
    await ops.prepare!();
    const ctx: ShowOpContext = { pane, slide: deck.slides[0], index: 0, options: OPTIONS, log: () => undefined };
    await ops.run(ctx);

    const captionScripts = evaluated.filter((s) => s.includes(CAPTION_ID));
    expect(captionScripts.length).toBeGreaterThan(0);
    expect(captionScripts[0]).toContain('LIVE NARRATION LINE');
    expect(captionScripts[0]).toContain('textContent = text');
    // The band is the TOP element, distinct from the bottom status HUD.
    expect(captionScripts[0]).toContain('top:14px');
  });
});
