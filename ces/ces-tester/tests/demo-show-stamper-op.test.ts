// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 — the Stamper ops ("Configuration" on stage), against a
 * hand-written `UiPage`.
 *
 * The assertion that matters most is #1. THREAD_HANDOFF is binding: the
 * Configuration stage gets **no live product demo**. And `warm` is not
 * automatically off-stage — warm ops are dispatched fire-and-forget while the
 * deck advances, so warm work on `ctx.pane` runs in the audience-visible window
 * concurrently with the narration. A regression that swapped `ctx.backstage`
 * for `ctx.pane` would look identical in review and put minutes of Stamper
 * workflow cards on the projector.
 *
 * 1. **The op touches `backstage`, never `pane`, in `warm`.**
 * 2. **It refuses, loudly and specifically, when there is no backstage session**
 *    — it must never quietly fall back to the visible pane.
 * 3. **It composes `runStamperUiFlow` on a page it was handed**, so the "ops
 *    never launch their own browser" rule holds.
 */

import { describe, it, expect, afterAll } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import type { AppPane } from '../src/demo/show/app-pane.js';
import type { DemoSlide, OpMode } from '../src/demo/show/deck-model.js';
import type { ShowRunOptions } from '../src/demo/show/show-run.js';
import type { UiPage } from '../src/demo/ui-page.js';
import type { OpDriveContext } from '../src/demo/show/op-registry.js';
import {
  runStamperTranslateOp,
  translatedTaskCount,
  DEMO_MISSION_PLAN,
  DEMO_MANIFEST,
} from '../src/demo/show/ops/stamper-translate-op.js';
import {
  runStamperExecuteOp,
  partitionGuiFailures,
  readExecutePreconditions,
} from '../src/demo/show/ops/stamper-execute-op.js';

const STAMPER_URL = 'http://127.0.0.1:3000';
/**
 * A REAL temp directory, not a notional path: the flow's `captureScreenshot`
 * creates its screenshot directory, so a made-up `C:/ces/...` run dir would have
 * the test suite create folders outside the project root.
 */
const RUN_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-stamper-run-'));
const TESTER_ROOT = 'C:/ces/ces-tester';

const OPTIONS: ShowRunOptions = {
  deckPath: 'demos/t.xlsx',
  slidesPort: 4500,
  defaultDwellSec: 30,
  auto: true,
  presenter: true,
  slidesGeometry: { width: 1280, height: 720, x: 0, y: 0 },
  appGeometry: { width: 620, height: 1000, x: 1290, y: 0 },
  testerRoot: TESTER_ROOT,
  stacksimRoot: 'C:/ces/tenant-stacksim',
  aoRoot: 'C:/ces/ces-ao',
};

interface FakeStamperPage extends UiPage {
  readonly filled: Record<string, string>;
  readonly clicks: string[];
}

/**
 * A Stamper GUI that behaves the way the real one does through translate:
 * the tenant option exists, the connection gate appears, the card reaches
 * `.tenant-connected`, assess reports "Assessed" and translate reports
 * "Translated".
 */
function fakeStamperPage(): FakeStamperPage {
  const filled: Record<string, string> = {};
  const clicks: string[] = [];
  const page: Partial<FakeStamperPage> = {
    filled,
    clicks,
    goto: async () => undefined,
    waitForSelector: async () => undefined,
    click: async (selector: string) => {
      clicks.push(selector);
    },
    fill: async (selector: string, value: string) => {
      filled[selector] = value;
    },
    selectOption: async () => undefined,
    setInputFiles: async () => undefined,
    waitForDownload: async () => '',
    isVisible: async () => true,
    count: async () => 0,
    textContent: async (selector: string) =>
      selector === '#cardStatus2' ? 'Assessed' : selector === '#cardStatus3' ? 'Translated' : '',
    texts: async () => [],
    getAttribute: async () => 'workflow-card expanded tenant-connected',
    inputValue: async () => 'tenant',
    waitForResponse: async (_url: string, trigger: () => Promise<void>) => {
      await trigger();
      return { taskCount: 110 };
    },
    screenshot: async () => undefined,
    getJson: async () => ({}),
  };
  return page as FakeStamperPage;
}

interface Harness {
  readonly ctx: OpDriveContext;
  readonly logs: string[];
  readonly paneVisited: string[];
  readonly backstageVisited: string[];
  readonly backstagePage: FakeStamperPage;
}

function harness(mode: OpMode, over: { withBackstage?: boolean; stamperBaseUrl?: string | undefined } = {}): Harness {
  const logs: string[] = [];
  const paneVisited: string[] = [];
  const backstageVisited: string[] = [];
  const backstagePage = fakeStamperPage();

  const pane = {
    page: { goto: async () => undefined } as unknown as UiPage,
    goto: async (url: string) => {
      paneVisited.push(url);
    },
    close: async () => undefined,
  } as unknown as AppPane;

  const backstage = {
    page: backstagePage,
    goto: async (url: string) => {
      backstageVisited.push(url);
    },
    close: async () => undefined,
  } as unknown as AppPane;

  const slide: DemoSlide = {
    slideNumber: 5,
    rows: [{ sheetRow: 6, slideNumber: 5, feature: 'Configuration' }],
    op: { mode, opId: 'stamper-translate', tools: ['stamper'], images: [] },
  };

  return {
    logs,
    paneVisited,
    backstageVisited,
    backstagePage,
    ctx: {
      pane,
      slide,
      index: 4,
      options: OPTIONS,
      log: (line: string) => logs.push(line),
      backstage: (over.withBackstage ?? true) ? backstage : undefined,
      armed: {
        slug: 'demo-dib-small',
        simUrl: 'http://127.0.0.1:4390',
        stamperBaseUrl: 'stamperBaseUrl' in over ? over.stamperBaseUrl : STAMPER_URL,
        runDir: RUN_DIR,
        musterRoot: 'C:/ces/ces-muster',
        stamperRoot: 'C:/ces/ces-stamper',
      },
    },
  };
}

afterAll(() => {
  fs.rmSync(RUN_DIR, { recursive: true, force: true });
});

describe('stamper-translate op', () => {
  it('drives the BACKSTAGE session and never the audience-visible pane, in warm', async () => {
    const h = harness('warm');
    await runStamperTranslateOp(h.ctx);

    expect(h.backstageVisited).toEqual([STAMPER_URL]);
    // The Configuration GUI is never shown. This is the doctrine assertion.
    expect(h.paneVisited).toEqual([]);
    // ...and the flow really ran on the backstage page.
    expect(h.backstagePage.clicks).toContain('#btnAssess');
    expect(h.backstagePage.clicks).toContain('button[onclick="doTranslate()"]');
  });

  it('stops after translate — it never arms or clicks Execute', async () => {
    const h = harness('warm');
    await runStamperTranslateOp(h.ctx);
    expect(h.backstagePage.clicks).not.toContain('#btnExecuteMatrix');
  });

  it('refuses loudly rather than falling back to the visible pane', async () => {
    const h = harness('warm', { withBackstage: false });
    await expect(runStamperTranslateOp(h.ctx)).rejects.toThrow(/requires the backstage session/);
    expect(h.paneVisited).toEqual([]);
  });

  it('refuses when the Stamper GUI was never armed, naming the reason', async () => {
    const h = harness('warm', { stamperBaseUrl: undefined });
    await expect(runStamperTranslateOp(h.ctx)).rejects.toThrow(/Configuration GUI is not armed/);
  });

  it('types ABSOLUTE plan paths — the GUI child reads them with cwd = stamperRoot', async () => {
    const h = harness('warm');
    await runStamperTranslateOp(h.ctx);

    const plan = h.backstagePage.filled['#configMissionPlanPath'];
    const manifest = h.backstagePage.filled['#configManifestPath'];
    expect(plan).toBe(path.resolve(TESTER_ROOT, DEMO_MISSION_PLAN));
    expect(manifest).toBe(path.resolve(TESTER_ROOT, DEMO_MANIFEST));
    expect(path.isAbsolute(plan)).toBe(true);
    expect(path.isAbsolute(manifest)).toBe(true);
    // The TENANT manifest, never the infrastructure one.
    expect(manifest.endsWith(path.join('demo-dib-small', 'manifest.json'))).toBe(true);
  });

  it('renders the outcome readout into the visible pane on a live slide only', async () => {
    const warm = harness('warm');
    await runStamperTranslateOp(warm.ctx);
    expect(warm.paneVisited).toEqual([]);

    const live = harness('live');
    await runStamperTranslateOp(live.ctx);
    expect(live.paneVisited).toHaveLength(1);
    const readout = Buffer.from(
      live.paneVisited[0].replace(/^data:text\/html;charset=utf-8;base64,/, ''),
      'base64',
    ).toString('utf8');
    expect(readout).toContain('Mission plan translated to executable tasks');
    expect(readout).toContain('110');
    // Even the live readout is a readout — never the Configuration GUI itself.
    expect(live.backstageVisited).toEqual([STAMPER_URL]);
  });

  it('records every screenshot the flow captured through the evidence seam', async () => {
    const h = harness('warm');
    const artifacts: string[] = [];
    await runStamperTranslateOp({ ...h.ctx, artifact: (p: string) => artifacts.push(p) });

    // `through-translate` captures 01-connected and 02-assessed, both into the
    // run dir. Anything the flow collected must reach the report.
    expect(artifacts.map((a) => path.basename(a))).toEqual(['01-connected.png', '02-assessed.png']);
    expect(artifacts.every((a) => path.dirname(a) === path.resolve(RUN_DIR))).toBe(true);
  });

  it('does not crash when no artifact recorder is wired (the seam is optional)', async () => {
    const h = harness('warm');
    await expect(runStamperTranslateOp(h.ctx)).resolves.toBeUndefined();
  });
});

/* ------------------------------------------------------------ 2c: execute */

/**
 * An execute-capable fake: the same page as above, plus `#cardStatus4` reaching
 * a terminal badge and a real execution report on disk (the flow finds it
 * through `stamperPlansDir`, so it has to actually exist).
 */
function executeHarness(
  mode: OpMode,
  over: {
    connected?: boolean;
    outputPath?: string;
    report?: unknown;
    badge?: string;
  } = {},
): Harness & { readonly runRoot: string; readonly cleanup: () => void } {
  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-stamper-exec-'));
  const plansDir = path.join(runRoot, 'pipeline', 'Stamper', 'plan-data', 'demo-dib-small', 'plans');
  fs.mkdirSync(plansDir, { recursive: true });
  if (over.report !== null) {
    fs.writeFileSync(
      path.join(plansDir, 'execution-report-2026-09-06T10-00-00.json'),
      JSON.stringify(
        over.report ?? {
          status: 'partial',
          summary: { total_tasks: 110, completed: 97 },
          failed_tasks: [{ task_id: 'step_task_9f2', error: 'AZ-LOG-001: verification failed — sim' }],
        },
      ),
    );
  }

  const base = harness(mode);
  const page = base.backstagePage;
  // Modelled the way the real GUI behaves: the card reaches `.tenant-connected`
  // when the connection gate is allowed. Starting DISCONNECTED is what forces
  // the op onto the full flow — and the full flow then connects for real.
  let connected = over.connected ?? true;
  const outputPath = over.outputPath ?? 'C:/plans/executable-plan.json';
  const click = page.click;
  page.click = async (selector: string) => {
    if (selector === '#gateAllowBtn') connected = true;
    await click(selector);
  };
  page.getAttribute = async () =>
    connected ? 'workflow-card expanded tenant-connected' : 'workflow-card expanded';
  page.inputValue = async (selector: string) =>
    selector === '#outputPath' ? outputPath : 'tenant';
  const originalText = page.textContent;
  page.textContent = async (selector: string) =>
    selector === '#cardStatus4' ? (over.badge ?? 'Complete') : originalText(selector);

  const ctx: OpDriveContext = {
    ...base.ctx,
    slide: { ...base.ctx.slide, op: { ...base.ctx.slide.op, opId: 'stamper-execute' } },
    armed: { ...base.ctx.armed, runDir: runRoot },
  };
  return { ...base, ctx, runRoot, cleanup: () => fs.rmSync(runRoot, { recursive: true, force: true }) };
}

describe('stamper-execute op', () => {
  it('takes the execute-only FAST PATH when the backstage page connected and translated', async () => {
    const h = executeHarness('warm');
    try {
      await runStamperExecuteOp(h.ctx);
      // It did NOT re-run connect/assess/translate.
      expect(h.backstagePage.clicks).not.toContain('#gateAllowBtn');
      expect(h.backstagePage.clicks).not.toContain('#btnAssess');
      expect(h.backstagePage.clicks).not.toContain('button[onclick="doTranslate()"]');
      expect(h.backstagePage.clicks).toContain('#btnExecuteMatrix');
      // It did not even re-navigate — the page it needs is the one in front of it.
      expect(h.backstageVisited).toEqual([]);
      expect(h.logs.join('\n')).toContain('running execute-only');
      // And never the visible pane, in warm.
      expect(h.paneVisited).toEqual([]);
    } finally {
      h.cleanup();
    }
  });

  it('falls back to the FULL flow, loudly, when either precondition fails', async () => {
    for (const over of [{ connected: false }, { outputPath: '' }]) {
      const h = executeHarness('warm', over);
      try {
        await runStamperExecuteOp(h.ctx);
        expect(h.backstagePage.clicks, JSON.stringify(over)).toContain('#btnAssess');
        expect(h.backstagePage.clicks).toContain('button[onclick="doTranslate()"]');
        expect(h.backstageVisited).toEqual([STAMPER_URL]);
        expect(h.logs.join('\n')).toContain('CANNOT take the fast path');
        expect(h.logs.join('\n')).toContain('~12 min');
      } finally {
        h.cleanup();
      }
    }
  });

  it('judges result.report and says plainly that the badge is not the judge', async () => {
    // The M0 trap: the badge reads Complete while the report reads partial.
    const h = executeHarness('warm', { badge: 'Complete' });
    try {
      await runStamperExecuteOp(h.ctx);
      const log = h.logs.join('\n');
      expect(log).toContain('report partial — 97 / 110 task(s) applied');
      expect(log).toContain('badge said "Complete", which is NOT the judge');
    } finally {
      h.cleanup();
    }
  });

  it('skips expected sim false-FAILs and does not fail on them', async () => {
    const h = executeHarness('warm');
    try {
      // The seeded failure carries entry-id AZ-LOG-001, which IS on the GUI-leg list.
      await expect(runStamperExecuteOp(h.ctx)).resolves.toBeUndefined();
      expect(h.logs.join('\n')).toContain('expected sim false-FAIL(s) skipped');
    } finally {
      h.cleanup();
    }
  });

  it('FAILS on an unexpected red, after rendering the readout', async () => {
    const h = executeHarness('live', {
      report: {
        status: 'partial',
        summary: { total_tasks: 110, completed: 90 },
        // A real entry-id shape that is simply not on the pinned list.
        failed_tasks: [{ task_id: 'step_task_zz1', error: 'AZ-NEW-999: verification failed' }],
      },
    });
    try {
      await expect(runStamperExecuteOp(h.ctx)).rejects.toThrow(/unexpected failure\(s\) not on the GUI-leg skip list/);
      // The operator still sees what happened — the readout goes up first.
      expect(h.paneVisited).toHaveLength(1);
      const readout = Buffer.from(
        h.paneVisited[0].replace(/^data:text\/html;charset=utf-8;base64,/, ''),
        'base64',
      ).toString('utf8');
      expect(readout).toContain('UNEXPECTED');
      expect(readout).toContain('AZ-NEW-999');
    } finally {
      h.cleanup();
    }
  });

  it('refuses to report anything when no execution report reached disk', async () => {
    const h = executeHarness('warm', { report: null });
    try {
      await expect(runStamperExecuteOp(h.ctx)).rejects.toThrow(/no execution report on disk/);
    } finally {
      h.cleanup();
    }
  });

  it('refuses the visible pane when there is no backstage session', async () => {
    const h = executeHarness('warm');
    try {
      await expect(runStamperExecuteOp({ ...h.ctx, backstage: undefined })).rejects.toThrow(
        /requires the backstage session/,
      );
      expect(h.paneVisited).toEqual([]);
    } finally {
      h.cleanup();
    }
  });

  it('PEEK: starts it, confirms running, and cuts away without judging a report or faking a readout', async () => {
    // The running badge is what the real GUI shows once Execute is clicked.
    const h = executeHarness('live', { badge: 'Executing...' });
    try {
      const ctx: OpDriveContext = {
        ...h.ctx,
        slide: { ...h.ctx.slide, op: { ...h.ctx.slide.op, params: { peekMs: 5 } } },
      };
      await expect(runStamperExecuteOp(ctx)).resolves.toBeUndefined();
      const log = h.logs.join('\n');
      // It really kicked the run off...
      expect(h.backstagePage.clicks).toContain('#btnExecuteMatrix');
      // ...then halted it after the peek so it cannot churn on backstage...
      expect(h.backstagePage.clicks).toContain('#btnHalt');
      expect(log).toContain('(peek)');
      expect(log).toContain('HALTED');
      // ...and never painted the "applied and verified" readout (that would be a
      // result it did not wait for).
      expect(h.paneVisited).toEqual([]);
    } finally {
      h.cleanup();
    }
  });
});

describe('partitionGuiFailures', () => {
  it('splits expected sim false-FAILs from unexpected reds', () => {
    const p = partitionGuiFailures(['AZ-LOG-001', 'AC.L2-3.1.1.new-red'], ['AZ-LOG-001', 'AZ-SEN-001']);
    expect(p.expected).toEqual(['AZ-LOG-001']);
    expect(p.unexpected).toEqual(['AC.L2-3.1.1.new-red']);
    // A skip that matched nothing is drift, and is surfaced rather than ignored.
    expect(p.staleSkips).toEqual(['AZ-SEN-001']);
  });

  it('treats an ABSENT skip list as "judge nothing as expected"', () => {
    // An absent list is not permission to pass.
    const p = partitionGuiFailures(['AZ-LOG-001'], undefined);
    expect(p.expected).toEqual([]);
    expect(p.unexpected).toEqual(['AZ-LOG-001']);
    expect(p.staleSkips).toEqual([]);
  });

  it('is clean when nothing failed', () => {
    const p = partitionGuiFailures([], ['AZ-LOG-001']);
    expect(p.unexpected).toEqual([]);
    expect(p.staleSkips).toEqual(['AZ-LOG-001']);
  });
});

describe('readExecutePreconditions', () => {
  const pageWith = (connected: boolean, outputPath: string): UiPage =>
    ({
      getAttribute: async () => (connected ? 'workflow-card tenant-connected' : 'workflow-card'),
      inputValue: async () => outputPath,
    }) as unknown as UiPage;

  it('is ready only when the page is connected AND carries an executable plan', async () => {
    expect(await readExecutePreconditions(pageWith(true, 'C:/plans/exec.json'))).toMatchObject({ ready: true });
    // Both of doExecute's own bail conditions, individually.
    expect(await readExecutePreconditions(pageWith(false, 'C:/plans/exec.json'))).toMatchObject({ ready: false });
    expect(await readExecutePreconditions(pageWith(true, ''))).toMatchObject({ ready: false });
    expect(await readExecutePreconditions(pageWith(true, '   '))).toMatchObject({ ready: false });
  });
});

describe('translatedTaskCount', () => {
  it('reads the count from every shape /api/translate has been seen to use', () => {
    expect(translatedTaskCount({ taskCount: 110 })).toBe(110);
    expect(translatedTaskCount({ task_count: 42 })).toBe(42);
    expect(translatedTaskCount({ totalTasks: 7 })).toBe(7);
    expect(translatedTaskCount({ tasks: [1, 2, 3] })).toBe(3);
    expect(translatedTaskCount({ plan: { tasks: [1, 2] } })).toBe(2);
  });

  it('reports UNKNOWN rather than inventing a number', () => {
    expect(translatedTaskCount(undefined)).toBeUndefined();
    expect(translatedTaskCount({})).toBeUndefined();
    expect(translatedTaskCount({ taskCount: 'many' })).toBeUndefined();
  });
});
