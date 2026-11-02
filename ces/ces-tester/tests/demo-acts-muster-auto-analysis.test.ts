// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-5 Slice 3.1 — the `muster-auto-analysis` op + MA1-MA4 judge against
 * injected seams. No sibling, no browser: the CLI is a stub that writes a
 * readiness-result, the SPA is a fake page, the ledger is a constant.
 *
 * The load-bearing assertions: MA2 (read-only, delta 0), MA3 (the fixture
 * signature is ABSENT — a readiness-result of the real walk's size, not 14),
 * MA4 (landed on boundary-confirm-panel, not the fixture branch).
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runActGroup, type ActRunArgs, type ActRunDeps } from '../src/demo/acts/act-run.js';
import { actGroup } from '../src/demo/acts/act-roster.js';
import type { AppPane } from '../src/demo/show/app-pane.js';
import type { ArmedSim } from '../src/demo/show/arm-sim.js';
import type { UiSession } from '../src/demo/ui-page.js';
import type { OpImplementation } from '../src/demo/show/op-registry.js';
import { FakeUiPage } from './helpers/fake-ui-page.js';
import { MUSTER_SELECTORS } from '../src/demo/muster-ui-driver.js';
import { MUSTER_CONNECT_FACTS } from '../src/demo/show/ops/muster-connect-tenant-op.js';
import { makeMusterAutoAnalysisOp } from '../src/demo/show/ops/muster-auto-analysis-op.js';
import type { MusterAutoAnalysisDeps } from '../src/demo/show/ops/muster-auto-analysis-op.js';
import type { SpawnResult } from '../src/demo/show/ops/muster-readiness-op.js';

const testerRoot = path.resolve(__dirname, '..');
const SLUG = 'demo-dib-small';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'acts-maa-'));
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
function fakeArm(runDir: string): ActRunDeps['arm'] {
  return async (): Promise<ArmedSim> => ({
    slug: SLUG,
    simUrl: 'http://127.0.0.1:4390',
    musterBaseUrl: 'http://127.0.0.1:4173',
    runDir,
    stop: async () => undefined,
  });
}

/** An AppPane wrapping a FakeUiPage that reports the boundary panel visible. */
function fakePane(): AppPane {
  const page = new FakeUiPage({ visible: new Set([MUSTER_SELECTORS.boundaryConfirmPanel]) });
  const session = { page, raw: {} } as unknown as UiSession;
  return { page, session: session as unknown as AppPane['session'], goto: async () => undefined, close: async () => undefined };
}

/** connect stand-in: writes the manifest facts artifact MU-C1 reads. */
function connectOp(): OpImplementation {
  return async (ctx) => {
    fs.writeFileSync(
      path.join(ctx.armed.runDir, MUSTER_CONNECT_FACTS),
      JSON.stringify({
        mode: 'independent',
        authTier: 'cert-app-only',
        slug: SLUG,
        operatorName: 'Demo Operator',
        operatorRole: 'assessor',
        beginInterviewReachable: true,
        profileVisible: true,
      }),
    );
  };
}

/** A readiness-result of the REAL walk's size (329), NOT the 14-row fixture. */
function fakeReadinessResult(): unknown {
  const observations = Array.from({ length: 329 }, (_, i) => ({
    control_id: `X.L2-${i}`,
    derived_posture: i % 3 === 0 ? 'met' : 'unknown',
  }));
  return {
    schema_version: 'readiness-result/1.0.0',
    manifest: { mode: 'independent' },
    observations,
    derived: { sprs_now: { sprs: -162, assessed_count: 111 } },
    provenance: { tool: 'mu' },
  };
}

function autoOp(opts: { ledgerBefore?: number; ledgerAfter?: number } = {}): OpImplementation {
  const deps: MusterAutoAnalysisDeps = {
    fileExists: () => true, // the CLI "exists"
    spawnCli: async (_c, args): Promise<SpawnResult> => {
      const outPath = args[args.indexOf('--out') + 1];
      fs.writeFileSync(outPath, JSON.stringify(fakeReadinessResult()));
      return { stdout: '', stderr: '', exitCode: 0 };
    },
    ledgerWrites: async () => {
      // Same count before and after → delta 0 (read-only). Toggle for the mutate test.
      return next.shift() ?? 5;
    },
  };
  const next = [opts.ledgerBefore ?? 5, opts.ledgerAfter ?? 5];
  return makeMusterAutoAnalysisOp(deps);
}

/** consent + adaptive stand-ins: write the facts the MC/MI judges read (the real
 *  ops drive a live browser / raw page, out of scope for this unit test). */
function consentOp(): OpImplementation {
  return async (ctx) => {
    fs.writeFileSync(
      path.join(ctx.armed.runDir, 'muster-consent.json'),
      JSON.stringify({ confirmerName: 'Demo Operator', boundaryPanelVisible: true, hadDrafts: true, nameGatingObserved: true, confirmedQid: 'bnd-001', continueClicked: true }),
    );
  };
}
function adaptiveOp(): OpImplementation {
  return async (ctx) => {
    fs.writeFileSync(
      path.join(ctx.armed.runDir, 'muster-adaptive.json'),
      JSON.stringify({ discoveryTotal: 40, manualTotal: 55, pruned: true }),
    );
  };
}
function sprsOp(): OpImplementation {
  return async (ctx) => {
    fs.writeFileSync(
      path.join(ctx.armed.runDir, 'muster-sprs.json'),
      JSON.stringify({ exportedArtifact: 'readiness-export.json', schemaVersion: 'readiness-result/1.0.0', payloadSprs: -110, domScoreText: '42% compliant', domScorePercent: 42 }),
    );
  };
}

function depsFor(runDir: string, auto: OpImplementation): ActRunDeps {
  return {
    openPane: async () => fakePane(),
    arm: fakeArm(runDir),
    implementations: {
      'muster-connect-tenant': connectOp(),
      'muster-auto-analysis': auto,
      'muster-consent-and-attest': consentOp(),
      'muster-adaptive-interview': adaptiveOp(),
      'muster-generate-sprs-mp': sprsOp(),
    },
    probe: async () => 'free',
    fileExists: (p) => fs.existsSync(p),
  };
}

describe('runActGroup — muster-gui / auto-analysis (D.5)', () => {
  it('passes MU-C1 + MA1-MA4 for the honest CLI-walk → import composition', async () => {
    const runDir = tempDir();
    const report = await runActGroup(actGroup('muster-gui')!, argsFor(runDir), () => undefined, depsFor(runDir, autoOp()));
    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    for (const id of ['MU-C1', 'MA1', 'MA2', 'MA3', 'MA4', 'MC1', 'MC2', 'MC3', 'MI1', 'MP1', 'MP2', 'MP3', 'ARM1', 'TD1']) {
      expect(byId[id]?.status, `${id}: ${byId[id]?.detail}`).toBe('pass');
    }
    expect(byId.MA3.evidence).toMatchObject({ observationCount: 329, fixtureObservationCount: 14 });
    expect(byId.MA4.evidence).toMatchObject({ boundaryPanelVisible: true, discoverySummaryVisible: false });
    expect(report.status).toBe('pass');
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it('MA2 reds when the walk mutates the ledger (delta != 0)', async () => {
    const runDir = tempDir();
    const report = await runActGroup(
      actGroup('muster-gui')!,
      argsFor(runDir),
      () => undefined,
      depsFor(runDir, autoOp({ ledgerBefore: 5, ledgerAfter: 7 })),
    );
    const ma2 = report.checks.find((c) => c.id === 'MA2')!;
    expect(ma2.status).toBe('fail');
    expect(ma2.detail).toContain('NOT read-only');
    fs.rmSync(runDir, { recursive: true, force: true });
  });
});
