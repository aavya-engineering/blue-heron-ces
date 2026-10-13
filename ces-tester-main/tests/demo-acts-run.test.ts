// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 act harness — the runtime, against injected seams.
 *
 * The load-bearing test in this file is **artifact-reaches-report**.
 * `ShowReportRecorder.opArtifact(index, path)` returns early when no op record
 * exists for that index, so a harness that fires `ctx.artifact()` without first
 * calling `opStarted` observes ZERO artifacts and reports nothing — while
 * appearing to pass. Asserting "the callback fired" would not catch that. These
 * tests assert the path is in the FINISHED report, and separately demonstrate
 * the drop so the guard is documented rather than folklore.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  MUSTER_CLI_RELATIVE,
  makeChecks,
  runActGroup,
  runActGroups,
  SLIDE_PROBES,
  syntheticDeck,
  syntheticSlide,
  showOptionsFor,
  type ActRunArgs,
  type ActRunDeps,
} from '../src/demo/acts/act-run.js';
import { actGroup } from '../src/demo/acts/act-roster.js';
import { createShowReport } from '../src/demo/show/run-report.js';
import { NO_SCORE_LINE } from '../src/demo/show/ops/muster-readiness-op.js';
import type { AppPane } from '../src/demo/show/app-pane.js';
import type { ArmedSim } from '../src/demo/show/arm-sim.js';
import type { OpImplementation } from '../src/demo/show/op-registry.js';
import type { UiPage, UiSession } from '../src/demo/ui-page.js';

const testerRoot = path.resolve(__dirname, '..');

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'acts-run-'));
}

function fakePane(): AppPane {
  const page = new Proxy({} as UiPage, { get: () => async () => undefined });
  const session = new Proxy({} as UiSession, { get: () => async () => undefined });
  return { page, session, goto: async () => undefined, close: async () => undefined };
}

function argsFor(runDir: string): ActRunArgs {
  return {
    testerRoot,
    stacksimRoot: path.join(testerRoot, '..', 'tenant-stacksim'),
    aoRoot: path.join(testerRoot, '..', 'ces-ao'),
    eoRoot: path.join(testerRoot, '..', 'ces-eo'),
    stamperRoot: path.join(testerRoot, '..', 'ces-stamper'),
    musterRoot: path.join(testerRoot, '..', 'ces-muster'),
    runId: path.basename(runDir),
  };
}

function fakeArm(runDir: string, extra: Partial<ArmedSim> = {}): ActRunDeps['arm'] {
  return async () => ({
    slug: 'demo-dib-small',
    simUrl: 'http://127.0.0.1:4390',
    runDir,
    stop: async () => undefined,
    ...extra,
  });
}

function baseDeps(runDir: string, implementations: ActRunDeps['implementations']): ActRunDeps {
  return {
    openPane: async () => fakePane(),
    arm: fakeArm(runDir),
    implementations,
    probe: async () => 'free',
    fileExists: (p) => fs.existsSync(p),
  };
}

/** An op that behaves the way `muster-readiness` does when everything works. */
function healthyMusterOp(runDir: string, opts: { noScoreLine?: boolean } = {}): OpImplementation {
  return async (ctx) => {
    const out = path.join(runDir, 'muster-readiness.json');
    fs.writeFileSync(
      out,
      JSON.stringify({
        observations: [
          { control_id: 'IA.L2-3.5.3', derived_posture: 'met' },
          { control_id: 'AC.L1-3.1.1', derived_posture: 'not_met' },
          { control_id: 'AU.L2-3.3.1', derived_posture: 'partial' },
          { control_id: 'CM.L2-3.4.1', derived_posture: 'unknown' },
        ],
      }),
    );
    ctx.log(
      "  op muster-readiness: evaluated 'demo-dib-small' in 77.6s — 4 control observation(s): " +
        '1 met / 1 not met / 1 partial / 1 unknown',
    );
    ctx.log('  op muster-readiness: read-only proof — ledger create+mutate delta 0');
    if (opts.noScoreLine !== true) ctx.log(`  op muster-readiness: ${NO_SCORE_LINE}`);
    // GP-DEMO-5 streamgui: the op imports its result into the SPA and ends on the
    // boundary panel — MR6 reads this line as the SPA-import tell.
    ctx.log(
      "  op muster-readiness: imported this run's result into the SPA — boundary panel visible, " +
        'fixture discovery-summary absent',
    );
    ctx.artifact?.(out);
  };
}

/* ------------------------------------------------------- the recorder contract */

describe('the opStarted requirement', () => {
  const group = actGroup('muster-readiness')!;
  const deck = syntheticDeck(group, testerRoot);
  const options = showOptionsFor(argsFor(testerRoot), deck);

  it('DROPS an artifact recorded for an index that never had opStarted', () => {
    const recorder = createShowReport(deck, options, 0, 'r');
    recorder.opArtifact(0, path.join(testerRoot, 'runs', 'show', 'r', 'orphan.json'));
    const report = recorder.finish(1, 'end-of-deck');
    expect(report.ops).toEqual([]);
  });

  it('keeps it once opStarted ran first', () => {
    const recorder = createShowReport(deck, options, 0, 'r');
    recorder.opStarted(0, deck.slides[0], 0);
    recorder.opArtifact(0, path.join(testerRoot, 'runs', 'show', 'r', 'kept.json'));
    recorder.opFinished(0, 1, 'done');
    const report = recorder.finish(2, 'end-of-deck');
    expect(report.ops[0].artifacts).toEqual(['runs/show/r/kept.json']);
  });
});

/* ------------------------------------------------------------- synthetic deck */

describe('the synthetic deck', () => {
  it('fills params through validateParams so the loader is not re-implemented', () => {
    // eo-review's catalog defaults are family=IA, land=sprs.
    const slide = syntheticSlide({ opId: 'eo-review', mode: 'warm' }, 0);
    expect(slide.op.params).toEqual({ family: 'IA', land: 'sprs' });
    expect(slide.op.mode).toBe('warm');
    expect(slide.slideNumber).toBe(1);
  });

  it('carries an explicit param over the default', () => {
    const slide = syntheticSlide({ opId: 'eo-review', mode: 'live', params: { land: 'evidence' } }, 1);
    expect(slide.op.params).toEqual({ family: 'IA', land: 'evidence' });
  });

  it('builds one slide per roster entry, all driving ops', () => {
    const group = actGroup('ao-registry')!;
    const deck = syntheticDeck(group, testerRoot);
    expect(deck.slides).toHaveLength(2);
    expect(deck.slides.map((s) => s.op.mode)).toEqual(['warm', 'live']);
    expect(deck.slides.every((s) => s.op.opId === 'ao-registry')).toBe(true);
  });
});

/* ------------------------------------------------------------------- checks */

describe('makeChecks', () => {
  it('turns a fail into a finding, and a bare skip into no finding at all', () => {
    const checks = makeChecks('g');
    checks.pass('A1', 'fine');
    checks.skip('A2', 'not applicable');
    checks.fail('A3', 'broken');
    expect(checks.results.map((c) => c.status)).toEqual(['pass', 'skipped', 'fail']);
    expect(checks.findings).toHaveLength(1);
    expect(checks.findings[0].failureClass).toBe('act-red');
  });

  it('lets a skip declare itself a harness defect — absence is never evidence', () => {
    const checks = makeChecks('g');
    checks.skip('SE3', 'the partition never ran', 'harness-defect');
    expect(checks.findings[0].failureClass).toBe('harness-defect');
  });
});

/* -------------------------------------------------------------- runActGroup */

describe('runActGroup — muster-readiness against injected seams', () => {
  it('passes every MR check and puts the artifact in the finished report', async () => {
    const runDir = tempDir();
    const group = actGroup('muster-readiness')!;
    const report = await runActGroup(group, argsFor(runDir), () => undefined, {
      // GP-DEMO-5 streamgui: muster-readiness now arms the SPA (:4173), so the
      // arm fake must report musterBaseUrl for ARM1 to see the declared surface.
      ...baseDeps(runDir, { 'muster-readiness': healthyMusterOp(runDir) }),
      arm: fakeArm(runDir, { musterBaseUrl: 'http://127.0.0.1:4173' }),
    });

    expect(report.status).toBe('pass');
    expect(report.findings).toEqual([]);
    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    for (const id of ['MR1', 'MR2', 'MR3', 'MR4', 'MR5', 'MR6', 'ARM1', 'TD1']) {
      expect(byId[id]?.status, id).toBe('pass');
    }
    // The proof: the path is in the FINISHED report, not merely fired.
    expect(report.artifacts.some((a) => a.endsWith('muster-readiness.json'))).toBe(true);
    expect(byId.MR5.evidence?.artifact).toBeDefined();
    expect(byId.MR2.evidence).toMatchObject({ met: 1, not_met: 1, partial: 1, unknown: 1 });
    // GP-DEMO-5 streamgui: `warm` was dropped — the group is a single live slide.
    expect(report.ops.map((o) => o.mode)).toEqual(['live']);
    expect(report.armMs).not.toBeNull();
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it('reds MR4 when the no-score honesty line is missing', async () => {
    const runDir = tempDir();
    const report = await runActGroup(
      actGroup('muster-readiness')!,
      argsFor(runDir),
      () => undefined,
      baseDeps(runDir, {
        'muster-readiness': healthyMusterOp(runDir, { noScoreLine: true }),
      }),
    );
    const mr4 = report.checks.find((c) => c.id === 'MR4')!;
    expect(mr4.status).toBe('fail');
    expect(report.findings.find((f) => f.rule === 'MR4')?.failureClass).toBe('act-red');
    expect(report.status).toBe('failed');
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it('reds MR1 artifact-first when the op writes nothing', async () => {
    const runDir = tempDir();
    const report = await runActGroup(
      actGroup('muster-readiness')!,
      argsFor(runDir),
      () => undefined,
      baseDeps(runDir, { 'muster-readiness': async () => undefined }),
    );
    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    expect(byId.MR1.status).toBe('fail');
    // A consequential skip must NOT masquerade as a harness defect.
    expect(byId.MR2.status).toBe('skipped');
    expect(report.findings.some((f) => f.rule === 'MR2')).toBe(false);
    // But a missing artifact in the report IS a harness-defect candidate.
    expect(report.findings.find((f) => f.rule === 'MR5')?.failureClass).toBe('harness-defect');
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it('records an op that throws, and keeps going to teardown', async () => {
    const runDir = tempDir();
    const report = await runActGroup(
      actGroup('muster-readiness')!,
      argsFor(runDir),
      () => undefined,
      baseDeps(runDir, {
        'muster-readiness': async () => {
          throw new Error('the sibling exploded');
        },
      }),
    );
    expect(report.ops.every((o) => o.status === 'failed')).toBe(true);
    expect(report.ops[0].error).toContain('the sibling exploded');
    expect(report.checks.find((c) => c.id === 'MR6')?.status).toBe('fail');
    // Teardown still ran and still proved the ports free.
    expect(report.portsFreeAfter).toBe(true);
    fs.rmSync(runDir, { recursive: true, force: true });
  });
});

describe('runActGroup — arming and teardown', () => {
  it('ARM1 is a harness-defect when arming exceeds the declaration', async () => {
    const runDir = tempDir();
    const report = await runActGroup(actGroup('muster-readiness')!, argsFor(runDir), () => undefined, {
      ...baseDeps(runDir, { 'muster-readiness': healthyMusterOp(runDir) }),
      // muster-readiness declares NO extra surface; hand it an armed AO GUI.
      arm: fakeArm(runDir, { aoBaseUrl: 'http://127.0.0.1:3001' }),
    });
    const arm1 = report.checks.find((c) => c.id === 'ARM1')!;
    expect(arm1.status).toBe('fail');
    expect(report.findings.find((f) => f.rule === 'ARM1')?.failureClass).toBe('harness-defect');
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it('TD1 reds when a port survives teardown', async () => {
    const runDir = tempDir();
    const group = actGroup('muster-readiness')!;
    // The pre-arm phase probes each expected port once (free); every probe after
    // that — the TD1 teardown probes — reports occupied, so a port "survives".
    let calls = 0;
    const report = await runActGroup(group, argsFor(runDir), () => undefined, {
      ...baseDeps(runDir, { 'muster-readiness': healthyMusterOp(runDir) }),
      probe: async () => (++calls <= group.expectedPorts.length ? 'free' : 'occupied'),
    });
    expect(report.checks.find((c) => c.id === 'TD1')?.status).toBe('fail');
    expect(report.portsFreeAfter).toBe(false);
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it('refuses to arm over an occupied port, and classes it environment not act-red', async () => {
    const runDir = tempDir();
    const report = await runActGroup(actGroup('muster-readiness')!, argsFor(runDir), () => undefined, {
      ...baseDeps(runDir, { 'muster-readiness': healthyMusterOp(runDir) }),
      probe: async () => 'occupied',
    });
    expect(report.status).toBe('skipped');
    expect(report.findings[0].failureClass).toBe('environment');
    expect(report.ops).toEqual([]);
    fs.rmSync(runDir, { recursive: true, force: true });
  });
});

describe('runActGroup — ao-registry judges', () => {
  it('AO1 proves warm and live agree; AO4 proves unarmed AO fails fast, off the pane', async () => {
    const runDir = tempDir();
    const shot = path.join(runDir, '01-command-form.png');
    fs.writeFileSync(shot, 'png');
    const report = await runActGroup(actGroup('ao-registry')!, argsFor(runDir), () => undefined, {
      ...baseDeps(runDir, {
        'ao-registry': async (ctx) => {
          ctx.artifact?.(shot);
        },
      }),
      arm: fakeArm(runDir, { aoBaseUrl: 'http://127.0.0.1:3001' }),
    });
    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    expect(byId.AO1.status).toBe('pass');
    expect(byId.AO2.status).toBe('pass');
    expect(byId.ARM1.status).toBe('pass');
    // AO4 runs the REAL implementation against an unarmed environment.
    expect(byId.AO4.status, JSON.stringify(byId.AO4)).toBe('pass');
    expect(String(byId.AO4.evidence?.error)).toContain('arm-sim.ts');
    // No AO evidence DB exists under a temp runDir, so AO3 is the one red here.
    expect(byId.AO3.status).toBe('fail');
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it('AO1 reds when the two modes disagree, because the op is documented not to branch', async () => {
    const runDir = tempDir();
    const shot = path.join(runDir, '01-command-form.png');
    fs.writeFileSync(shot, 'png');
    let first = true;
    const report = await runActGroup(actGroup('ao-registry')!, argsFor(runDir), () => undefined, {
      ...baseDeps(runDir, {
        'ao-registry': async (ctx) => {
          if (first) ctx.artifact?.(shot);
          first = false;
        },
      }),
      arm: fakeArm(runDir, { aoBaseUrl: 'http://127.0.0.1:3001' }),
    });
    expect(report.checks.find((c) => c.id === 'AO1')?.status).toBe('fail');
    fs.rmSync(runDir, { recursive: true, force: true });
  });
});

describe('runActGroups', () => {
  it('refuses to run rather than failing MR1 when the muster CLI is not built', async () => {
    await expect(
      runActGroups(['muster-readiness'], argsFor(tempDir()), () => undefined, {
        fileExists: (p) => !p.endsWith(MUSTER_CLI_RELATIVE),
      }),
    ).rejects.toThrow(/muster CLI is not built/);
  });

  it('names an unknown act group rather than silently running nothing', async () => {
    await expect(
      runActGroups(['simstack'], argsFor(tempDir()), () => undefined, {}),
    ).rejects.toThrow(/unknown act group "simstack"/);
  });
});

/* ------------------------------------------------- Slice D: the expensive pair */

/** A pane whose `count` is controllable, so hydration can be simulated. */
function fakePaneWithRows(rows: () => number): AppPane {
  const page = new Proxy({} as UiPage, {
    get: (_t, prop) => (prop === 'count' ? async () => rows() : async () => undefined),
  });
  const session = new Proxy({} as UiSession, { get: () => async () => undefined });
  return { page, session, goto: async () => undefined, close: async () => undefined };
}

/**
 * A throwaway EO API, so EO3 reads real JSON over real HTTP as it does live.
 * FX-TE5: it enforces ces-eo FX-EO8 — no `?tenant=` is a 400, any tenant but
 * `tenant` (the one it knows) is a 404 — and records every URL it served.
 */
async function fakeEoServer(
  body: {
    assessment: Record<string, unknown>;
    sprs: Record<string, unknown>;
  },
  tenant = 'demo-dib-small',
): Promise<{ baseUrl: string; urls: string[]; close: () => Promise<void> }> {
  const http = await import('node:http');
  const urls: string[] = [];
  const server = http.createServer((req, res) => {
    urls.push(req.url ?? '');
    const u = new URL(req.url ?? '/', 'http://127.0.0.1');
    const asked = u.searchParams.get('tenant');
    if (!asked || asked !== tenant) {
      res.writeHead(asked ? 404 : 400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: asked ? `unknown tenant ${asked}` : 'tenant required' }));
      return;
    }
    const payload = u.pathname === '/api/sprs' ? body.sprs : body.assessment;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    urls,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const EO_SHOTS = [
  'eo-review-01-compliance-matrix.png',
  'eo-review-02-family-determinations.png',
  'eo-review-03-sprs.png',
];

const EO_FAMILY_LOG = '  op eo-review: IA determinations — 4 row(s) in the matrix';

function eoOp(runDir: string, shots: readonly string[], logs: readonly string[]): OpImplementation {
  return async (ctx) => {
    if (ctx.slide.op.mode === 'warm') return;
    for (const line of logs) ctx.log(line);
    for (const name of shots) {
      const file = path.join(runDir, name);
      fs.writeFileSync(file, 'png');
      ctx.artifact?.(file);
    }
  };
}

describe('runActGroup — the eo-review pair', () => {
  it('passes EO1-EO5 when warm hydrates, the walk captures, and the API answers', async () => {
    const runDir = tempDir();
    const eo = await fakeEoServer({
      assessment: { controls_met: 57, controls_not_met: 12, liveAssessmentCount: 1 },
      sprs: { score: -38 },
    });
    const report = await runActGroup(actGroup('eo-review')!, argsFor(runDir), () => undefined, {
      ...baseDeps(runDir, { 'eo-review': eoOp(runDir, EO_SHOTS, [EO_FAMILY_LOG]) }),
      openPane: async () => fakePaneWithRows(() => 4),
      arm: fakeArm(runDir, { eoBaseUrl: eo.baseUrl }),
    });
    await eo.close();

    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    for (const id of ['EO1', 'EO2', 'EO3', 'EO4', 'EO5', 'ARM1', 'TD1']) {
      expect(byId[id]?.status, `${id}: ${byId[id]?.detail}`).toBe('pass');
    }
    // Asserted NUMERICALLY. readEoNumbers returns `number | undefined`, so a
    // regex test against it is a check that cannot fail for the right reason —
    // and SPRS is sign-permitting because the DoD methodology deducts below zero.
    expect(byId.EO3.evidence).toMatchObject({ controlsMet: 57, sprsScore: -38 });
    expect(report.status).toBe('pass');
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it('FX-TE5: EO3 reads the ARMED tenant (not a default) and reds when the tenant is dropped', async () => {
    const runDir = tempDir();
    const body = { assessment: { controls_met: 57, controls_not_met: 12, liveAssessmentCount: 1 }, sprs: { score: -38 } };
    // A slug that is not the fixture default, so a hard-coded fallback fails.
    const eo = await fakeEoServer(body, 'acme-dib-large');
    const ok = await runActGroup(actGroup('eo-review')!, argsFor(runDir), () => undefined, {
      ...baseDeps(runDir, { 'eo-review': eoOp(runDir, EO_SHOTS, [EO_FAMILY_LOG]) }),
      openPane: async () => fakePaneWithRows(() => 4),
      arm: fakeArm(runDir, { slug: 'acme-dib-large', eoBaseUrl: eo.baseUrl }),
    });
    expect(ok.checks.find((c) => c.id === 'EO3')?.status).toBe('pass');
    expect(eo.urls.sort()).toEqual(['/api/assessment?tenant=acme-dib-large', '/api/sprs?tenant=acme-dib-large']);

    // Armed for a tenant this EO does not know: the 404 must surface as an EO3
    // failure, proving the check really rides on the tenant it sends.
    const wrong = await runActGroup(actGroup('eo-review')!, argsFor(runDir), () => undefined, {
      ...baseDeps(runDir, { 'eo-review': eoOp(runDir, EO_SHOTS, [EO_FAMILY_LOG]) }),
      openPane: async () => fakePaneWithRows(() => 4),
      arm: fakeArm(runDir, { slug: 'demo-dib-small', eoBaseUrl: eo.baseUrl }),
    });
    await eo.close();
    expect(wrong.checks.find((c) => c.id === 'EO3')?.status).toBe('fail');
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it('FX-TE5: the eo-show-change-captured BEFORE probe reads the armed tenant', async () => {
    const runDir = tempDir();
    const eo = await fakeEoServer(
      { assessment: { controls_met: 5, liveAssessmentCount: 1 }, sprs: { score: -89 } },
      'acme-dib-large',
    );
    const probe = SLIDE_PROBES['eo-show-change-captured']!;
    const pane = fakePaneWithRows(() => 0);
    const armed = { slug: 'acme-dib-large', eoBaseUrl: eo.baseUrl, runDir, musterRoot: '', stamperRoot: '' };
    expect(await probe(0, { pane, backstage: undefined, armed })).toMatchObject({ eoBeforeSprs: -89 });
    expect(eo.urls.sort()).toEqual(['/api/assessment?tenant=acme-dib-large', '/api/sprs?tenant=acme-dib-large']);
    // The wrong tenant gets a 404, so the BEFORE carries no score.
    const other = { ...armed, slug: 'demo-dib-small' };
    expect(await probe(0, { pane, backstage: undefined, armed: other })).toMatchObject({ eoBeforeSprs: null });
    await eo.close();
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it('EO2 classes a missing family shot as ENVIRONMENT when the family had no rows', async () => {
    const runDir = tempDir();
    const eo = await fakeEoServer({
      assessment: { controls_met: 1, controls_not_met: 0, liveAssessmentCount: 1 },
      sprs: { score: 0 },
    });
    const report = await runActGroup(actGroup('eo-review')!, argsFor(runDir), () => undefined, {
      // No family log line and no `02` shot: the family had nothing to show.
      ...baseDeps(runDir, { 'eo-review': eoOp(runDir, [EO_SHOTS[0], EO_SHOTS[2]], []) }),
      openPane: async () => fakePaneWithRows(() => 4),
      arm: fakeArm(runDir, { eoBaseUrl: eo.baseUrl }),
    });
    await eo.close();

    expect(report.findings.find((f) => f.rule === 'EO2')?.failureClass).toBe('environment');
    expect(report.findings.some((f) => f.failureClass === 'act-red')).toBe(false);
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it('EO2 reds for real when the family HAD rows and the shot is still missing', async () => {
    const runDir = tempDir();
    const eo = await fakeEoServer({
      assessment: { controls_met: 1, controls_not_met: 0, liveAssessmentCount: 1 },
      sprs: { score: 0 },
    });
    const report = await runActGroup(actGroup('eo-review')!, argsFor(runDir), () => undefined, {
      ...baseDeps(runDir, {
        'eo-review': eoOp(runDir, [EO_SHOTS[0], EO_SHOTS[2]], [EO_FAMILY_LOG]),
      }),
      openPane: async () => fakePaneWithRows(() => 4),
      arm: fakeArm(runDir, { eoBaseUrl: eo.baseUrl }),
    });
    await eo.close();
    expect(report.findings.find((f) => f.rule === 'EO2')?.failureClass).toBe('act-red');
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it('EO4 reds when no live signal leg ran and the op did not say so', async () => {
    const runDir = tempDir();
    const silent = await fakeEoServer({
      assessment: { controls_met: 1, controls_not_met: 0, liveAssessmentCount: 0 },
      sprs: { score: 0 },
    });
    const quiet = await runActGroup(actGroup('eo-review')!, argsFor(runDir), () => undefined, {
      ...baseDeps(runDir, { 'eo-review': eoOp(runDir, EO_SHOTS, [EO_FAMILY_LOG]) }),
      openPane: async () => fakePaneWithRows(() => 4),
      arm: fakeArm(runDir, { eoBaseUrl: silent.baseUrl }),
    });
    await silent.close();
    expect(quiet.checks.find((c) => c.id === 'EO4')?.status).toBe('fail');

    const honestServer = await fakeEoServer({
      assessment: { controls_met: 1, controls_not_met: 0, liveAssessmentCount: 0 },
      sprs: { score: 0 },
    });
    const honest = await runActGroup(actGroup('eo-review')!, argsFor(runDir), () => undefined, {
      ...baseDeps(runDir, {
        'eo-review': eoOp(runDir, EO_SHOTS, [
          EO_FAMILY_LOG,
          '  op eo-review: API — met 1 — LIVE SIGNAL LEG DID NOT RUN; do not narrate these numbers',
        ]),
      }),
      openPane: async () => fakePaneWithRows(() => 4),
      arm: fakeArm(runDir, { eoBaseUrl: honestServer.baseUrl }),
    });
    await honestServer.close();
    expect(honest.checks.find((c) => c.id === 'EO4')?.status).toBe('pass');
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it('EO1 is a harness-defect, not an act-red, when the post-warm probe never ran', async () => {
    const runDir = tempDir();
    const eo = await fakeEoServer({
      assessment: { controls_met: 1, controls_not_met: 0, liveAssessmentCount: 1 },
      sprs: { score: 0 },
    });
    const report = await runActGroup(actGroup('eo-review')!, argsFor(runDir), () => undefined, {
      ...baseDeps(runDir, { 'eo-review': eoOp(runDir, EO_SHOTS, [EO_FAMILY_LOG]) }),
      openPane: async () => fakePaneWithRows(() => 4),
      arm: fakeArm(runDir, { eoBaseUrl: eo.baseUrl }),
      slideProbes: { 'eo-review': async () => ({}) },
    });
    await eo.close();
    expect(report.findings.find((f) => f.rule === 'EO1')?.failureClass).toBe('harness-defect');
    fs.rmSync(runDir, { recursive: true, force: true });
  });
});

function writeExecutionReport(runDir: string, failedTaskIds: readonly string[]): string {
  const file = path.join(runDir, 'execution-report-20260906.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      status: 'partial',
      summary: { total_tasks: 110, completed: 80 },
      failed_tasks: failedTaskIds.map((id) => ({ task_id: id, error: '' })),
    }),
  );
  return file;
}

function stamperOps(
  runDir: string,
  failedTaskIds: readonly string[],
): ActRunDeps['implementations'] {
  return {
    'stamper-translate': async (ctx) => {
      for (const name of ['01-connected.png', '02-assessed.png']) {
        const file = path.join(runDir, name);
        fs.writeFileSync(file, 'png');
        ctx.artifact?.(file);
      }
    },
    'stamper-execute': async (ctx) => {
      ctx.artifact?.(writeExecutionReport(runDir, failedTaskIds));
      ctx.log(
        '  op stamper-execute: report partial — 80 / 110 task(s) applied in 786.4s ' +
          '(phase execute-only); badge said "Complete", which is NOT the judge',
      );
    },
  };
}

const READY_PRECONDITIONS: ActRunDeps['slideProbes'] = {
  stamper: async (index) =>
    index === 0
      ? { preconditions: { connected: true, outputPath: 'C:/plans/plan.json', ready: true } }
      : {},
};

describe('runActGroup — the stamper pair', () => {
  it('green branch: SE3 records the partition as POSITIVE PROOF, all three counts', async () => {
    const runDir = tempDir();
    const report = await runActGroup(actGroup('stamper')!, argsFor(runDir), () => undefined, {
      ...baseDeps(runDir, stamperOps(runDir, ['AZ-NSG-003'])),
      arm: fakeArm(runDir, { stamperBaseUrl: 'http://127.0.0.1:3000' }),
      slideProbes: READY_PRECONDITIONS,
    });

    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    for (const id of ['ST1', 'ST2', 'ST3', 'ST4', 'SE1', 'SE2', 'SE3', 'SE4', 'ARM1', 'TD1']) {
      expect(byId[id]?.status, `${id}: ${byId[id]?.detail}`).toBe('pass');
    }
    // The green branch is distinguishable from a silently-skipped SE3 by THIS
    // record, never by the absence of a red.
    expect(byId.SE3.evidence).toMatchObject({ expected: 1, unexpected: 0 });
    expect(Number(byId.SE3.evidence?.staleSkips)).toBeGreaterThan(0);
    expect(byId.SE3.evidence?.expectedIds).toBe('AZ-NSG-003');
    // SE1 judged the FILE; SE4 recorded the badge divergence as evidence.
    expect(byId.SE1.evidence).toMatchObject({ status: 'partial', completedTasks: 80 });
    expect(byId.SE4.evidence).toMatchObject({ badge: 'Complete', diverged: true });
    // ST1: the Config GUI never touched the audience-visible pane.
    expect(byId.ST1.evidence?.paneNavigations).toBe(0);
    expect(report.status).toBe('pass');
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it('red branch: an unexpected failure is named, act-red, and never pinned away', async () => {
    const runDir = tempDir();
    const report = await runActGroup(actGroup('stamper')!, argsFor(runDir), () => undefined, {
      ...baseDeps(runDir, stamperOps(runDir, ['AZ-NSG-003', 'TOTALLY-UNKNOWN-TASK'])),
      arm: fakeArm(runDir, { stamperBaseUrl: 'http://127.0.0.1:3000' }),
      slideProbes: READY_PRECONDITIONS,
    });
    const se3 = report.findings.find((f) => f.rule === 'SE3')!;
    expect(se3.failureClass).toBe('act-red');
    expect(se3.message).toContain('TOTALLY-UNKNOWN-TASK');
    expect(report.status).toBe('failed');
    // The tier floor still holds: an honest act-red is NOT a harness defect.
    expect(report.findings.some((f) => f.failureClass === 'harness-defect')).toBe(false);
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it('a group with no execution report reds SE1 and SKIPS SE2-SE4 — it never passes', async () => {
    const runDir = tempDir();
    const report = await runActGroup(actGroup('stamper')!, argsFor(runDir), () => undefined, {
      ...baseDeps(runDir, {
        'stamper-translate': async () => undefined,
        'stamper-execute': async () => undefined,
      }),
      arm: fakeArm(runDir, { stamperBaseUrl: 'http://127.0.0.1:3000' }),
      slideProbes: READY_PRECONDITIONS,
    });
    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    expect(byId.SE1.status).toBe('fail');
    expect(byId.SE3.status).toBe('skipped');
    expect(report.status).toBe('failed');
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it('ST2 is a harness-defect when the post-translate probe never ran', async () => {
    const runDir = tempDir();
    const report = await runActGroup(actGroup('stamper')!, argsFor(runDir), () => undefined, {
      ...baseDeps(runDir, stamperOps(runDir, [])),
      arm: fakeArm(runDir, { stamperBaseUrl: 'http://127.0.0.1:3000' }),
      slideProbes: { stamper: async () => ({}) },
    });
    expect(report.findings.find((f) => f.rule === 'ST2')?.failureClass).toBe('harness-defect');
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it('ST4 reds when arming brings up surfaces the Config pair never uses', async () => {
    const runDir = tempDir();
    const report = await runActGroup(actGroup('stamper')!, argsFor(runDir), () => undefined, {
      ...baseDeps(runDir, stamperOps(runDir, [])),
      arm: fakeArm(runDir, {
        stamperBaseUrl: 'http://127.0.0.1:3000',
        eoBaseUrl: 'http://127.0.0.1:4002',
      }),
      slideProbes: READY_PRECONDITIONS,
    });
    const st4 = report.checks.find((c) => c.id === 'ST4')!;
    expect(st4.status).toBe('fail');
    expect(st4.detail).toContain('EO server');
    fs.rmSync(runDir, { recursive: true, force: true });
  });
});
