// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 — the `muster-readiness` op ("Readiness Evaluation" on stage).
 *
 * Every side effect is injected, so none of this needs ces-muster built, a
 * stacksim serve, or a browser. What is worth pinning here is exactly the set
 * of things that would be invisible until they were wrong in front of a
 * customer:
 *
 * 1. **The artifact is judged, not the exit code.** `mu discovery` can exit
 *    `3221226505` (the known Windows libuv teardown) AFTER writing a complete,
 *    valid result. Judging the exit code would fail a good run; judging only the
 *    artifact when the CLI genuinely failed would narrate a stale one.
 * 2. **All FOUR schema postures are tallied.** ces-muster's
 *    `readiness-result.schema.json` permits `met`, `not_met`, `partial` and
 *    `unknown`; ces-tester's two-value expectation elsewhere is a pinned
 *    expectation for one retained run, not the wire contract. A tally that
 *    silently drops `partial` is a dishonest number on a slide.
 * 3. **A missing sibling build degrades honestly.** ces-tester never builds a
 *    sibling, so an unbuilt `dist/` must produce an "unavailable" readout and a
 *    log line, never a thrown error mid-demo.
 * 4. **No readiness score is claimed.** DISCOVERY-1 produces per-control
 *    posture and nothing else, and the readout says so in those words.
 */

import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import type { AppPane } from '../src/demo/show/app-pane.js';
import type { UiPage } from '../src/demo/ui-page.js';
import type { DemoSlide, OpMode } from '../src/demo/show/deck-model.js';
import type { ShowRunOptions } from '../src/demo/show/show-run.js';
import type { OpDriveContext } from '../src/demo/show/op-registry.js';
import {
  makeMusterReadinessOp,
  musterCliPath,
  readoutHtml,
  tallyPostures,
  NO_SCORE_LINE,
  READINESS_POSTURES,
  type MusterReadinessDeps,
  type SpawnResult,
} from '../src/demo/show/ops/muster-readiness-op.js';
import { WINDOWS_LIBUV_TEARDOWN_EXIT } from '../src/demo/e2e-run.js';

const MUSTER_ROOT = 'C:/ces/ces-muster';
const STAMPER_ROOT = 'C:/ces/ces-stamper';
const RUN_DIR = 'C:/ces/ces-tester/runs/show/test';
const SIM_URL = 'http://127.0.0.1:4390';

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

/** A readiness artifact carrying every posture the schema permits, plus a stray. */
const FOUR_POSTURE_ARTIFACT = JSON.stringify({
  observations: [
    { control_id: 'AC.L2-3.1.1', derived_posture: 'met' },
    { control_id: 'AC.L2-3.1.2', derived_posture: 'met' },
    { control_id: 'IA.L2-3.5.3', derived_posture: 'not_met' },
    { control_id: 'AU.L2-3.3.1', derived_posture: 'partial' },
    { control_id: 'SC.L2-3.13.1', derived_posture: 'unknown' },
  ],
});

interface Harness {
  readonly ctx: OpDriveContext;
  readonly logs: string[];
  readonly navigations: string[];
  readonly spawns: { args: readonly string[]; cwd: string; env: NodeJS.ProcessEnv }[];
  /** Selectors the fake SPA page was asked to click (the driver's import walk). */
  readonly clicks: string[];
  /** Files fed to the SPA's discovery file input. */
  readonly inputFiles: string[];
}

const MUSTER_BASE_URL = 'http://127.0.0.1:4173';

/**
 * `musterBaseUrl` present drives the SUCCESS path (the op navigates the pane to
 * the SPA and imports through the file-input seam); absent drives the DEGRADED
 * path (the readout card is rendered on the pane). Existing readout tests keep
 * their old behaviour because they omit it.
 */
function harness(mode: OpMode = 'live', musterBaseUrl?: string): Harness {
  const logs: string[] = [];
  const navigations: string[] = [];
  const spawns: Harness['spawns'] = [];
  const clicks: string[] = [];
  const inputFiles: string[] = [];
  const slide: DemoSlide = {
    slideNumber: 3,
    rows: [{ sheetRow: 4, slideNumber: 3, feature: 'Readiness Evaluation' }],
    op: { mode, opId: 'muster-readiness', tools: ['muster'], images: [] },
  };
  // The SPA page seam the honest import driver walks — no browser. `isVisible`
  // answers true for the boundary panel and false for the fixture summary, so a
  // successful import reads as boundary-visible / fixture-absent.
  const page = {
    goto: async (url: string) => {
      navigations.push(url);
    },
    click: async (sel: string) => {
      clicks.push(sel);
    },
    waitForSelector: async () => undefined,
    setInputFiles: async (_sel: string, file: string) => {
      inputFiles.push(file);
    },
    isVisible: async (sel: string) => sel.includes('boundary-confirm-panel'),
  } as unknown as UiPage;
  const pane = {
    page,
    goto: async (url: string) => {
      navigations.push(url);
    },
    close: async () => undefined,
  } as unknown as AppPane;

  return {
    logs,
    navigations,
    spawns,
    clicks,
    inputFiles,
    ctx: {
      pane,
      slide,
      index: 2,
      options: OPTIONS,
      log: (line: string) => logs.push(line),
      armed: {
        slug: 'demo-dib-small',
        simUrl: SIM_URL,
        runDir: RUN_DIR,
        musterRoot: MUSTER_ROOT,
        stamperRoot: STAMPER_ROOT,
        ...(musterBaseUrl ? { musterBaseUrl } : {}),
      },
    },
  };
}

/** Deps that succeed, with the knobs each test turns. */
function deps(
  h: Harness,
  over: {
    exitCode?: number;
    artifact?: string | (() => never);
    cliBuilt?: boolean;
    ledger?: number[];
    stderr?: string;
  } = {},
): MusterReadinessDeps {
  const ledger = over.ledger ?? [12, 12];
  let call = 0;
  return {
    fileExists: () => over.cliBuilt ?? true,
    spawnCli: async (_command, args, cwd, env): Promise<SpawnResult> => {
      h.spawns.push({ args, cwd, env });
      return { stdout: '', stderr: over.stderr ?? '', exitCode: over.exitCode ?? 0 };
    },
    readArtifact: async () => {
      const a = over.artifact ?? FOUR_POSTURE_ARTIFACT;
      return typeof a === 'function' ? a() : a;
    },
    ledgerWrites: async () => ledger[Math.min(call++, ledger.length - 1)],
  };
}

/** The readout the op parked on the pane, decoded back out of the data: URL. */
function readoutFrom(navigations: readonly string[]): string {
  const url = navigations.at(-1) ?? '';
  const b64 = url.replace(/^data:text\/html;charset=utf-8;base64,/, '');
  return Buffer.from(b64, 'base64').toString('utf8');
}

describe('tallyPostures', () => {
  it('counts all four schema postures, not the two this repo happens to pin', () => {
    expect(READINESS_POSTURES).toEqual(['met', 'not_met', 'partial', 'unknown']);
    const tally = tallyPostures(JSON.parse(FOUR_POSTURE_ARTIFACT).observations);
    expect(tally).toMatchObject({ met: 2, not_met: 1, partial: 1, unknown: 1, other: 0, total: 5 });
  });

  it('counts and NAMES a posture the schema gains later rather than dropping it', () => {
    const tally = tallyPostures([
      { derived_posture: 'met' },
      { derived_posture: 'not_applicable' },
      { derived_posture: 'not_applicable' },
      {},
    ]);
    expect(tally.met).toBe(1);
    expect(tally.other).toBe(3);
    expect(tally.otherValues).toEqual(['not_applicable', '(missing)']);
    // Nothing is lost: the buckets always add up to what was in the artifact.
    expect(tally.met + tally.not_met + tally.partial + tally.unknown + tally.other).toBe(tally.total);
  });
});

describe('muster-readiness op', () => {
  it('spawns the discovery CLI from the muster root with the stamper registry in env', async () => {
    const h = harness('warm');
    await makeMusterReadinessOp(deps(h))(h.ctx);

    expect(h.spawns).toHaveLength(1);
    const spawn = h.spawns[0];
    expect(spawn.cwd).toBe(MUSTER_ROOT);
    expect(spawn.args[0]).toBe(musterCliPath(MUSTER_ROOT));
    expect(spawn.args.slice(1)).toEqual([
      'discovery',
      '--sim',
      '--slug',
      'demo-dib-small',
      '--out',
      path.join(RUN_DIR, 'muster-readiness.json'),
    ]);
    expect(spawn.env.STAMPER_REGISTRY_ROOT).toBe(path.resolve(STAMPER_ROOT, 'src', 'registry'));
  });

  it('renders a readout carrying all four postures and the no-score line', async () => {
    const h = harness('warm');
    await makeMusterReadinessOp(deps(h))(h.ctx);

    const readout = readoutFrom(h.navigations);
    for (const posture of ['met', 'not met', 'partial', 'unknown']) {
      expect(readout, posture).toContain(`<th>${posture}</th>`);
    }
    expect(readout).toContain(NO_SCORE_LINE);
    expect(readout).toContain('5</div>');
    expect(readout).toContain('ledger create+mutate delta 0');
    // The log carries the same four numbers the slide shows.
    expect(h.logs.join('\n')).toContain('2 met / 1 not met / 1 partial / 1 unknown');
    expect(h.logs.join('\n')).toContain(NO_SCORE_LINE);
  });

  it('accepts the known Windows libuv teardown exit when the artifact is complete', async () => {
    const h = harness('warm');
    await makeMusterReadinessOp(deps(h, { exitCode: WINDOWS_LIBUV_TEARDOWN_EXIT }))(h.ctx);

    const readout = readoutFrom(h.navigations);
    expect(readout).toContain('5</div>');
    expect(readout).not.toContain('unavailable');
    expect(h.logs.join('\n')).toContain('known Windows libuv teardown');
  });

  it('renders "unavailable" rather than throwing when the sibling is not built', async () => {
    const h = harness('live');
    await expect(makeMusterReadinessOp(deps(h, { cliBuilt: false }))(h.ctx)).resolves.toBeUndefined();

    expect(h.spawns).toEqual([]);
    const readout = readoutFrom(h.navigations);
    expect(readout).toContain('readiness evaluation unavailable');
    expect(readout).toContain('npm run build');
    expect(h.logs.join('\n')).toContain('UNAVAILABLE');
  });

  it('degrades honestly when the CLI failed AND wrote nothing readable', async () => {
    const h = harness('warm');
    await makeMusterReadinessOp(
      deps(h, {
        exitCode: 9,
        stderr: 'boom',
        artifact: () => {
          throw new Error('ENOENT');
        },
      }),
    )(h.ctx);

    expect(readoutFrom(h.navigations)).toContain('readiness evaluation unavailable');
    expect(h.logs.join('\n')).toContain('exited 9');
  });

  it('throws loudly when the CLI claimed success but produced no observations array', async () => {
    // A clean exit with an unusable artifact is a real sibling breakage, not a
    // degraded environment — silently showing "unavailable" would hide it.
    const h = harness('warm');
    await expect(makeMusterReadinessOp(deps(h, { artifact: '{"summary":"nope"}' }))(h.ctx)).rejects.toThrow(
      /no readable readiness artifact/,
    );
  });

  it('reports a non-zero ledger delta instead of quietly claiming read-only', async () => {
    const h = harness('warm');
    await makeMusterReadinessOp(deps(h, { ledger: [12, 15] }))(h.ctx);

    expect(h.logs.join('\n')).toContain('ledger create+mutate delta 3 — NOT READ-ONLY');
    expect(readoutFrom(h.navigations)).toContain('ledger create+mutate delta 3');
  });

  it('records the readiness artifact through the evidence seam', async () => {
    const h = harness('warm');
    const artifacts: string[] = [];
    await makeMusterReadinessOp(deps(h))({ ...h.ctx, artifact: (p: string) => artifacts.push(p) });
    expect(artifacts).toEqual([path.join(RUN_DIR, 'muster-readiness.json')]);
  });

  it('evaluates for real in live mode — the CLI is seconds, not minutes', async () => {
    // No musterBaseUrl → the DEGRADED path: it still runs the real CLI and renders
    // the readout card (the honest fallback when the SPA is not armed).
    const h = harness('live');
    await makeMusterReadinessOp(deps(h))(h.ctx);
    expect(h.spawns).toHaveLength(1);
    expect(h.logs.join('\n')).toContain('op muster-readiness (live)');
    expect(h.logs.join('\n')).toContain('importing the result into the Muster SPA');
    // The stale "headless substrate / separate op" doctrine is gone (B1).
    expect(h.logs.join('\n')).not.toContain('a live RE walk is a separate op');
  });

  it('SUCCESS path: navigates to the SPA and imports the result, ending on the boundary panel', async () => {
    const h = harness('live', MUSTER_BASE_URL);
    await makeMusterReadinessOp(deps(h))(h.ctx);

    // The real CLI still ran and wrote its artifact.
    expect(h.spawns).toHaveLength(1);
    // The pane was navigated to the SPA, and the artifact was fed through the
    // file-input seam — NEVER a data: readout card (that would wipe the SPA off).
    expect(h.navigations).toContain(MUSTER_BASE_URL);
    expect(h.navigations.some((n) => n.startsWith('data:text/html'))).toBe(false);
    expect(h.inputFiles).toEqual([path.join(RUN_DIR, 'muster-readiness.json')]);
    expect(h.clicks).toContain('[data-testid="nav-tab-discovery"]');
    // The honest tell: boundary panel visible, fixture discovery-summary absent.
    expect(h.logs.join('\n')).toContain('boundary panel visible');
    expect(h.logs.join('\n')).toContain('fixture discovery-summary absent');
    // The RE identity survives — the four-value tally and no-score line still log.
    expect(h.logs.join('\n')).toContain('2 met / 1 not met / 1 partial / 1 unknown');
    expect(h.logs.join('\n')).toContain(NO_SCORE_LINE);
  });

  it('DEGRADED guard: an available result but an UN-armed SPA renders the readout card', async () => {
    // The P2 musterBaseUrl guard: available evaluation, no SPA → the card, not a
    // hang trying to import into a page that was never navigated.
    const h = harness('live'); // no musterBaseUrl
    await makeMusterReadinessOp(deps(h))(h.ctx);
    expect(readoutFrom(h.navigations)).toContain('control observations');
    expect(h.inputFiles).toEqual([]); // never touched the SPA
    expect(h.logs.join('\n')).toContain('the Muster SPA is not armed');
  });
});

describe('readoutHtml', () => {
  it('escapes an unexpected posture value rather than injecting it into the page', () => {
    const tally = tallyPostures([{ derived_posture: '<img src=x onerror=alert(1)>' }]);
    const html = readoutHtml({ available: true, tally, slug: 'demo-dib-small', ledgerDelta: 0 });
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img src=x');
  });
});
