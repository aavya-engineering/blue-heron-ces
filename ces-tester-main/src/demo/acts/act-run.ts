// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 act harness — the runtime.
 *
 * **AD1: this composes `makeShowOps`, it never re-implements it.** The harness
 * builds a synthetic in-memory `DemoDeck` per act-group, opens a headless pane,
 * and drives `prepare()` → `run(ctx)` per slide → `dispose()`. That inherits
 * per-act arming (`armingFor` reads the deck's own driven ids), the backstage
 * session, warm-ordering and the single-lane serialization — with no slides
 * server, no windows and no operator loop. Forking any of that would mean
 * testing a parallel arming path instead of the one the demo uses.
 *
 * **The `opStarted` requirement.** `ShowReportRecorder.opArtifact(index, path)`
 * returns early when no op record exists for that index (`run-report.ts` L216).
 * So the harness calls `opStarted` BEFORE running an op and `opFinished` after,
 * mirroring `show-run.ts` L337-349. Without it, MR5 / AO2 / EO2 / ST3 all
 * silently observe zero artifacts and the artifact-first axis quietly reports
 * nothing while appearing to pass.
 *
 * **Judging is artifact-first.** Preference order, highest first: the artifact
 * on disk, then the finished report, then a sibling API the harness calls
 * itself, then a live-page probe, and only last a log substring — and then only
 * for the honesty strings the dossier quotes verbatim. `OpImplementation`
 * returns `Promise<void>`, so nothing else is available.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  BACKSTAGE_GEOMETRY,
  DEFAULT_APP_GEOMETRY,
  DEFAULT_SLIDES_GEOMETRY,
  openAppPane,
  type AppPane,
} from '../show/app-pane.js';
import type { DemoDeck, DemoOpId, DemoSlide } from '../show/deck-model.js';
import { OP_CATALOG, validateParams } from '../show/op-catalog.js';
import {
  makeShowOps,
  OP_IMPLEMENTATIONS,
  type ArmedEnvironment,
  type MakeShowOpsDeps,
  type OpDriveContext,
  type OpImplementation,
} from '../show/op-registry.js';
import { createShowReport, type ShowReport } from '../show/run-report.js';
import type { ShowRunOptions } from '../show/show-run.js';
import { probePort } from '../preflight.js';
import {
  NO_SCORE_LINE,
  READINESS_POSTURES,
  tallyPostures,
} from '../show/ops/muster-readiness-op.js';
import { runAoRegistryOp } from '../show/ops/ao-registry-op.js';
import { runAoMakeChangeOp } from '../show/ops/ao-make-change-op.js';
import { hasRenderedAssessment, readEoNumbers } from '../show/ops/eo-review-op.js';
import {
  compareEoChange,
  DEMO_MFA_CONTROL_ID,
  EO_CHANGE_NO_FLIP,
  EO_CHANGE_NO_RELIABLE_BEFORE,
  type EoAssessmentArtifact,
} from '../show/ops/eo-show-change-captured-op.js';
import {
  partitionGuiFailures,
  readExecutePreconditions,
} from '../show/ops/stamper-execute-op.js';
import {
  findLatestExecutionReport,
  parseExecutionReport,
  stamperPlansDir,
  type ExecutionReportSummary,
} from '../stamper-ui-driver.js';
import { GUI_LEG_KNOWN_FALSE_FAILS } from '../e2e-run.js';
import { AO_UI_CORRELATION_PREFIX, newestAoEvidenceRow, readAoEvidence, simTenantId } from '../ao-evidence.js';
import { AO_DEMO_COMMAND_ID, aoDbPath } from '../ao-leg.js';
import {
  SIMSTACK_GAP_POLICY_ID,
  SIMSTACK_GAP_STATE,
  simstackRegistryRoot,
} from '../show/ops/simstack-create-op.js';
import {
  simRecordPath,
  readSimTenantAuthFields,
  missingSimTenantAuthFields,
} from '../sim-tenant-record.js';
import { musterDistIndex } from '../show/arm-muster.js';
import { MUSTER_CONNECT_FACTS } from '../show/ops/muster-connect-tenant-op.js';
import {
  MUSTER_AUTO_ANALYSIS_FACTS,
  READINESS_RESULT_ARTIFACT,
  READINESS_RESULT_SCHEMA_VERSION,
} from '../show/ops/muster-auto-analysis-op.js';
import { eoTenantUrl } from '../eo-tenant-url.js';
import { MUSTER_CONSENT_FACTS } from '../show/ops/muster-consent-and-attest-op.js';
import { MUSTER_ADAPTIVE_FACTS } from '../show/ops/muster-adaptive-interview-op.js';
import { MUSTER_SPRS_FACTS } from '../show/ops/muster-generate-sprs-mp-op.js';
import { READINESS_RESULT_SCHEMA_VERSION as MUSTER_SPRS_SCHEMA } from '../show/ops/muster-auto-analysis-op.js';
import {
  createTenantRegistry,
  teardownEphemeralSimTenant,
  listSimTenants,
} from '../../tenant-registry/index.js';
import type { UiPage, UiSession } from '../ui-page.js';
import {
  ACT_GROUPS,
  actGroup,
  type ActGroup,
  type ActSlide,
} from './act-roster.js';
import {
  writeGroupReport,
  type ActGroupReport,
  type CheckResult,
  type FailureClass,
  type Finding,
  type OpMeasurement,
} from './acts-report.js';

/** The operator prerequisite. ces-tester NEVER builds a sibling. */
export const MUSTER_CLI_RELATIVE = path.join('muster-api', 'dist', 'cli', 'bin.js');

export interface ActRunArgs {
  readonly testerRoot: string;
  readonly stacksimRoot: string;
  readonly aoRoot: string;
  readonly eoRoot: string;
  readonly stamperRoot: string;
  readonly musterRoot: string;
  readonly runId: string;
}

export interface ActRunDeps {
  readonly openPane?: (headless: boolean) => Promise<AppPane>;
  readonly implementations?: Partial<Record<DemoOpId, OpImplementation>>;
  readonly arm?: MakeShowOpsDeps['arm'];
  readonly probe?: (port: number) => Promise<'free' | 'occupied'>;
  readonly now?: () => number;
  readonly fileExists?: (absPath: string) => boolean;
  readonly slideProbes?: Readonly<Record<string, SlideProbe>>;
}

/* ------------------------------------------------------------ check recorder */

/**
 * Collects check results AND the findings they imply, so a judge decides the
 * `failureClass` at the point it knows why the check failed. A missing EO2
 * screenshot on a family with no rows is `environment`; the same file missing
 * on a populated family is `act-red`. Only the judge can tell those apart.
 */
export interface Checks {
  readonly results: CheckResult[];
  readonly findings: Finding[];
  pass(id: string, detail: string, evidence?: CheckResult['evidence']): void;
  fail(
    id: string,
    detail: string,
    failureClass?: FailureClass,
    evidence?: CheckResult['evidence'],
  ): void;
  /**
   * A check that did not run. `failureClass` is OPTIONAL and omitting it means
   * "legitimately not applicable"; supplying `harness-defect` is how a check
   * that SHOULD have run reports that it did not — absence of a red is never
   * itself evidence.
   */
  skip(id: string, detail: string, failureClass?: FailureClass): void;
}

export function makeChecks(subject: string): Checks {
  const results: CheckResult[] = [];
  const findings: Finding[] = [];
  return {
    results,
    findings,
    pass(id, detail, evidence) {
      results.push({ id, status: 'pass', detail, ...(evidence ? { evidence } : {}) });
    },
    fail(id, detail, failureClass = 'act-red', evidence) {
      results.push({ id, status: 'fail', detail, ...(evidence ? { evidence } : {}) });
      findings.push({ rule: id, severity: 'fail', failureClass, subject, message: detail });
    },
    skip(id, detail, failureClass) {
      results.push({ id, status: 'skipped', detail });
      if (failureClass) {
        findings.push({ rule: id, severity: 'fail', failureClass, subject, message: detail });
      }
    },
  };
}

/* ------------------------------------------------------------ synthetic deck */

/**
 * AD3 — slide params come from `validateParams(opId, raw).resolved`, so the
 * harness fills defaults exactly the way the xlsx loader does rather than
 * hand-rolling a second set that could drift from the catalog.
 */
export function syntheticSlide(slide: ActSlide, index: number): DemoSlide {
  return {
    slideNumber: index + 1,
    rows: [
      {
        sheetRow: index + 2,
        slideNumber: index + 1,
        feature: `${slide.opId} (${slide.mode})`,
      },
    ],
    op: {
      mode: slide.mode,
      opId: slide.opId,
      tools: [OP_CATALOG[slide.opId].target],
      images: [],
      params: validateParams(slide.opId, slide.params ?? {}).resolved,
    },
  };
}

export function syntheticDeck(group: ActGroup, testerRoot: string): DemoDeck {
  return {
    sourcePath: path.join(testerRoot, `<synthetic:${group.id}>`),
    baseDir: testerRoot,
    title: `acts-test ${group.id}`,
    slides: group.slides.map(syntheticSlide),
    assets: [],
    warnings: [],
  };
}

export function showOptionsFor(args: ActRunArgs, deck: DemoDeck): ShowRunOptions {
  return {
    deckPath: deck.sourcePath,
    slidesPort: 0,
    defaultDwellSec: 30,
    auto: false,
    presenter: false,
    slidesGeometry: DEFAULT_SLIDES_GEOMETRY,
    appGeometry: DEFAULT_APP_GEOMETRY,
    testerRoot: args.testerRoot,
    stacksimRoot: args.stacksimRoot,
    aoRoot: args.aoRoot,
    eoRoot: args.eoRoot,
    stamperRoot: args.stamperRoot,
    musterRoot: args.musterRoot,
    runId: args.runId,
    report: true,
  };
}

/* ----------------------------------------------------------------- the judge */

export interface JudgeContext {
  readonly group: ActGroup;
  readonly args: ActRunArgs;
  /** Undefined only when no op ran, which is itself a harness defect. */
  readonly armed: ArmedEnvironment | undefined;
  readonly pane: AppPane;
  readonly backstage: AppPane | undefined;
  /** The FINISHED report — artifacts are read from here, never from callbacks. */
  readonly report: ShowReport;
  readonly logs: readonly string[];
  readonly ops: readonly OpMeasurement[];
  /** ST1 — visible-pane navigations counted while the group ran. */
  readonly paneNavigations: number;
  readonly fileExists: (absPath: string) => boolean;
  readonly options: ShowRunOptions;
  /** Evidence sampled BETWEEN slides, while it was still true. See SLIDE_PROBES. */
  readonly snapshots: Readonly<Record<string, unknown>>;
}

export type Judge = (ctx: JudgeContext, checks: Checks) => Promise<void>;

function readJson(absPath: string): unknown {
  return JSON.parse(fs.readFileSync(absPath, 'utf8')) as unknown;
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * A page (and a pane around it) that throws on ANY access. AO4 drives the
 * unarmed negative case through this so the injected failure can never reach a
 * real browser — the point of the check is the arming error, and a negative case
 * that quietly navigated the real pane would have destroyed the state the rest
 * of the group is judging.
 */
function throwingPane(why: string): AppPane {
  const boom = (): never => {
    throw new Error(why);
  };
  const page = new Proxy({} as UiPage, { get: () => boom });
  const session = new Proxy({} as UiSession, { get: () => boom });
  return { page, session, goto: async () => boom(), close: async () => undefined };
}

/* ------------------------------------------------------ D.3 muster-readiness */

const judgeMusterReadiness: Judge = async (ctx, checks) => {
  const armed = ctx.armed;
  if (!armed) {
    for (const id of ['MR1', 'MR2', 'MR3', 'MR4', 'MR5', 'MR6']) {
      checks.skip(id, 'no armed environment was observed', 'harness-defect');
    }
    return;
  }

  const artifactAbs = path.join(armed.runDir, 'muster-readiness.json');
  const artifactRel = path.relative(ctx.args.testerRoot, artifactAbs).replace(/\\/g, '/');

  // MR1 — artifact-first. The op's own contract is that judging is NOT
  // exit-code-gated: if the artifact parses with an `observations` array the act
  // succeeded, whatever the CLI's exit code was.
  let observations: readonly unknown[] | undefined;
  if (!ctx.fileExists(artifactAbs)) {
    checks.fail('MR1', `no readiness artifact at ${artifactRel}`);
  } else {
    try {
      const parsed = readJson(artifactAbs) as { observations?: unknown };
      if (!Array.isArray(parsed.observations)) {
        checks.fail('MR1', `${artifactRel} has no \`observations\` array`);
      } else {
        observations = parsed.observations;
        checks.pass('MR1', `${artifactRel} parses with an observations array`, {
          artifact: artifactRel,
          observations: observations.length,
        });
      }
    } catch (err) {
      checks.fail('MR1', `${artifactRel} does not parse: ${message(err)}`);
    }
  }

  // MR2 — all four postures named, five buckets summing to the observation
  // count. `other`/`otherValues` is how a posture the schema gains later is
  // COUNTED AND NAMED rather than silently dropped.
  if (!observations) {
    checks.skip('MR2', 'MR1 produced no observations to tally');
  } else {
    const tally = tallyPostures(observations);
    const sum = tally.met + tally.not_met + tally.partial + tally.unknown + tally.other;
    const tallyLine = ctx.logs.find((l) => l.includes('control observation(s):'));
    const unnamed = READINESS_POSTURES.filter(
      (p) => !(tallyLine ?? '').includes(p.replace('_', ' ')),
    );
    if (sum !== observations.length) {
      checks.fail(
        'MR2',
        `the five posture buckets sum to ${sum} but there are ${observations.length} observations`,
      );
    } else if (!tallyLine) {
      checks.fail('MR2', 'the op logged no posture tally line');
    } else if (unnamed.length > 0) {
      checks.fail('MR2', `the tally line drops posture(s): ${unnamed.join(', ')}`);
    } else {
      checks.pass('MR2', `all four postures named; ${sum} buckets = ${observations.length} observations`, {
        met: tally.met,
        not_met: tally.not_met,
        partial: tally.partial,
        unknown: tally.unknown,
        other: tally.other,
        otherValues: tally.otherValues.join(', '),
      });
    }
  }

  // MR3 — ADVISORY by design. The ledger delta is a hard gate in `eval-run.ts`
  // but only advisory here (dossier E9), so a NON-ZERO delta must not red. What
  // would be a real failure is the proof line going missing: that is the op's
  // OUTPUTS contract changing under us.
  const ledgerLine = ctx.logs.find((l) => l.includes('read-only proof — ledger create+mutate delta'));
  if (!ledgerLine) {
    checks.fail('MR3', 'the op logged no read-only ledger proof line');
  } else {
    checks.pass('MR3', `ledger proof recorded (advisory — the op does not gate on it)`, {
      line: ledgerLine.trim(),
      readOnly: ledgerLine.includes('delta 0') || !ledgerLine.includes('NOT READ-ONLY'),
    });
  }

  // MR4 — the honesty string, verbatim. One of the few places a log substring is
  // the right judge: the dossier quotes this line exactly.
  if (ctx.logs.some((l) => l.includes(NO_SCORE_LINE))) {
    checks.pass('MR4', 'the readout carries NO_SCORE_LINE verbatim');
  } else {
    checks.fail('MR4', 'no log line carries NO_SCORE_LINE — the "we invent no score" guard is gone');
  }

  // MR5 — the artifact reached the FINISHED report, not merely the callback.
  const recorded = reportArtifacts(ctx.report);
  const hit = recorded.find((r) => r.endsWith('muster-readiness.json'));
  if (!hit) {
    checks.fail(
      'MR5',
      `the finished report registers no readiness artifact (${recorded.length} artifact(s) recorded)`,
      'harness-defect',
    );
  } else if (!ctx.fileExists(resolveArtifact(ctx.args.testerRoot, hit))) {
    checks.fail('MR5', `the report registers ${hit}, but nothing is there on disk`);
  } else {
    checks.pass('MR5', `the artifact reached the finished report: ${hit}`, { artifact: hit });
  }

  // MR6 — GP-DEMO-5 streamgui: `warm` was dropped, so this is a LIVE-only check.
  // The live run must complete AND import this run's result into the Muster SPA,
  // landing on the boundary panel (the fixture `discovery-summary` absent) — not
  // merely render the readout card.
  const failed = ctx.ops.filter((o) => o.status !== 'done');
  const importLine = ctx.logs.find((l) => l.includes("imported this run's result into the SPA"));
  const boundaryVisible = (importLine ?? '').includes('boundary panel visible');
  const fixtureAbsent = (importLine ?? '').includes('fixture discovery-summary absent');
  if (failed.length > 0) {
    checks.fail('MR6', `the live mode did not complete: ${failed.map((o) => o.mode).join(', ')}`);
  } else if (!importLine) {
    // The op degraded to the readout card (SPA not armed / CLI unavailable). An
    // honest fallback, but not the streamed SPA the act advertises — environment,
    // never act-red.
    checks.fail(
      'MR6',
      'the live run rendered the readout card, not the SPA import (no boundary-panel log line) — SPA unavailable',
      'environment',
    );
  } else if (!boundaryVisible || !fixtureAbsent) {
    checks.fail('MR6', `the SPA import did not land honestly on the boundary panel: ${importLine.trim()}`);
  } else {
    checks.pass('MR6', "live completed and imported this run's result into the SPA (boundary panel visible, fixture absent)", {
      liveMs: ctx.ops.find((o) => o.mode === 'live')?.ms ?? -1,
    });
  }
};

/* ------------------------------------------------------------ D.11 ao-registry */

const judgeAoRegistry: Judge = async (ctx, checks) => {
  const armed = ctx.armed;
  if (!armed) {
    for (const id of ['AO1', 'AO2', 'AO3', 'AO4']) {
      checks.skip(id, 'no armed environment was observed', 'harness-defect');
    }
    return;
  }

  // AO1 — `ao-registry` does NOT branch on op mode (dossier E1), so warm and
  // live must not merely both pass: they must do the same thing. Asserting they
  // agree is the only way to test a documented non-branch.
  const warm = ctx.report.ops.find((o) => o.mode === 'warm');
  const live = ctx.report.ops.find((o) => o.mode === 'live');
  const names = (op: typeof warm): string[] =>
    [...(op?.artifacts ?? [])].map((a) => path.basename(a)).sort();
  if (!warm || !live) {
    checks.fail('AO1', 'the report is missing a warm or a live op record', 'harness-defect');
  } else if (warm.status !== 'done' || live.status !== 'done') {
    checks.fail('AO1', `warm ${warm.status}, live ${live.status}`);
  } else if (JSON.stringify(names(warm)) !== JSON.stringify(names(live))) {
    checks.fail(
      'AO1',
      `warm and live disagree although the op does not branch: ${names(warm).join(',')} vs ${names(live).join(',')}`,
    );
  } else {
    checks.pass('AO1', 'warm and live ran the identical flow and agree', {
      artifacts: names(warm).join(', '),
    });
  }

  // AO2 — screenshots registered AND on disk. The dossier is honest that this
  // act judges no artifact of its own; the screenshots are what there is.
  const shots = reportArtifacts(ctx.report).filter((a) => a.endsWith('.png'));
  const missing = shots.filter((s) => !ctx.fileExists(resolveArtifact(ctx.args.testerRoot, s)));
  if (shots.length === 0) {
    checks.fail('AO2', 'the finished report registers no screenshot', 'harness-defect');
  } else if (missing.length > 0) {
    checks.fail('AO2', `registered but absent on disk: ${missing.join(', ')}`);
  } else {
    checks.pass('AO2', `${shots.length} screenshot(s) registered and present`, {
      screenshots: shots.length,
    });
  }

  // AO3 — closes the dossier's own §E3 gap ("this act judges no artifact"). The
  // pipeline root is re-derived because neither ArmedSim nor ArmedEnvironment
  // exposes it: `arm-sim.ts` L175 builds `<runDir>/pipeline` and hands that same
  // root to the AO GUI child (L267).
  const dbPath = aoDbPath(path.join(armed.runDir, 'pipeline'));
  const tenantId = simTenantId(armed.slug);
  const commandId = String(ctx.group.slides[0].params?.command ?? AO_DEMO_COMMAND_ID);
  try {
    const rows = readAoEvidence(dbPath, tenantId);
    // The registry command id is the row id's prefix (`A-18:A-18-<ts>`).
    // `metadata.commandExecuted` is the POWERSHELL TEXT the command expanded to
    // ("Invoke-MgGraphRequest -Method PATCH -Uri '/v1.0/policies/...'"), not the
    // id — matching on it finds nothing and reports a working act as broken.
    const named = rows.filter((r) => r.id.split(':')[0] === commandId);
    if (named.length === 0) {
      checks.fail(
        'AO3',
        `no evidence row for command ${commandId} in ${path.basename(dbPath)} (${rows.length} row(s) for ${tenantId})`,
      );
    } else {
      const newest = named[named.length - 1];
      checks.pass('AO3', `${named.length} evidence row(s) name command ${commandId}`, {
        tenantId,
        rows: rows.length,
        matching: named.length,
        outcome: newest.outcome ?? '(none)',
        complianceVerdict: newest.complianceVerdict ?? '(none)',
        stateChanged: newest.metadata.stateChanged ?? false,
      });
    }
  } catch (err) {
    checks.fail('AO3', `could not read AO evidence at ${dbPath}: ${message(err)}`, 'environment');
  }

  // AO4 — the negative case, INJECTED. Unarmed AO must produce the specific
  // arming error naming the module that would have armed it, in milliseconds,
  // rather than a timeout minutes later on stage.
  const negativeSlide = syntheticSlide({ opId: 'ao-registry', mode: 'live' }, 0);
  const negativeCtx: OpDriveContext = {
    pane: throwingPane('AO4: the unarmed negative case must never reach a real pane'),
    slide: negativeSlide,
    index: 0,
    options: ctx.options,
    log: () => undefined,
    armed: { ...armed, aoBaseUrl: undefined },
  };
  const started = Date.now();
  try {
    await runAoRegistryOp(negativeCtx);
    checks.fail('AO4', 'unarmed AO did not throw — it would have hung on stage');
  } catch (err) {
    const text = message(err);
    const elapsed = Date.now() - started;
    if (text.includes('arm-sim.ts') && text.includes('not armed')) {
      checks.pass('AO4', `unarmed AO threw the specific arming error in ${elapsed} ms`, {
        error: text,
        ms: elapsed,
      });
    } else {
      checks.fail('AO4', `unarmed AO threw, but not the arming error: ${text}`);
    }
  }
};

/* --------------------------------------------------- D.13 / D.14 eo-review */

/** The screenshot the op always writes, whatever the family or the landing. */
const EO_MATRIX_SHOT = 'eo-review-01-compliance-matrix.png';
const EO_FAMILY_SHOT = 'eo-review-02-family-determinations.png';
const EO_LIVE_SIGNAL_WARNING = 'LIVE SIGNAL LEG DID NOT RUN; do not narrate these numbers';

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return (await res.json()) as unknown;
}

const judgeEoReview: Judge = async (ctx, checks) => {
  const armed = ctx.armed;
  if (!armed?.eoBaseUrl) {
    for (const id of ['EO1', 'EO2', 'EO3', 'EO4', 'EO5']) {
      checks.skip(id, 'EO was never armed', 'harness-defect');
    }
    return;
  }

  // EO1 — the single reliable tell that a real assessment rendered IN THIS PAGE,
  // sampled straight after the warm slide rather than at the end: by judge time
  // the live half has walked tabs and the question "did warm hydrate?" is no
  // longer answerable.
  const hydratedAfterWarm = ctx.snapshots.hydratedAfterWarm;
  if (hydratedAfterWarm === true) {
    checks.pass('EO1', 'the warm assess left a hydrated assessment on the pane');
  } else if (hydratedAfterWarm === undefined) {
    checks.skip('EO1', 'the post-warm hydration probe never ran', 'harness-defect');
  } else {
    checks.fail('EO1', 'after the warm assess the pane showed no rendered assessment');
  }

  // EO2 — CONDITION-AWARE. The op captures `02` only when the family had rows,
  // and the `03` filename follows the resolved `land`. Asserting all three
  // unconditionally reds for an environmental reason and reads as a real
  // failure — the inverse of the masking trap.
  const shots = new Set(reportArtifacts(ctx.report).map((a) => path.basename(a)));
  const landing = String(ctx.group.slides[1]?.params?.land ?? 'sprs');
  const landingShot = `eo-review-03-${landing}.png`;
  const familyHadRows = ctx.logs.some((l) => /op eo-review: \S+ determinations —/.test(l));

  const missing: string[] = [];
  if (!shots.has(EO_MATRIX_SHOT)) missing.push(EO_MATRIX_SHOT);
  if (!shots.has(landingShot)) missing.push(landingShot);
  if (missing.length > 0) {
    checks.fail('EO2', `the walk registered no ${missing.join(' and no ')}`);
  } else if (!shots.has(EO_FAMILY_SHOT)) {
    if (familyHadRows) {
      checks.fail('EO2', `the family had rows but ${EO_FAMILY_SHOT} was never registered`);
    } else {
      // Environment, NEVER act-red: an empty family is a property of the
      // assessed tenant, not a defect in the act.
      checks.fail(
        'EO2',
        `${EO_FAMILY_SHOT} is absent because the family had no rows in this run`,
        'environment',
        { landing, matrix: true, family: false },
      );
    }
  } else {
    checks.pass('EO2', `matrix, family determinations and the ${landing} landing all captured`, {
      landing,
      shots: [...shots].filter((s) => s.startsWith('eo-review-0')).sort().join(', '),
    });
  }

  // EO3 — the narrated numbers come from the tool's own surface, so the harness
  // reads the SAME APIs the op reads. Asserted NUMERICALLY: readEoNumbers
  // returns `number | undefined`, and a `/^\d+$/` test against a number is a
  // check that cannot fail for the right reason.
  let numbers: ReturnType<typeof readEoNumbers> | undefined;
  try {
    const [assessment, sprs] = await Promise.all([
      fetchJson(eoTenantUrl(armed.eoBaseUrl, '/api/assessment', armed.slug)),
      fetchJson(eoTenantUrl(armed.eoBaseUrl, '/api/sprs', armed.slug)),
    ]);
    numbers = readEoNumbers(assessment, sprs);
    const metOk = Number.isInteger(numbers.controlsMet) && (numbers.controlsMet ?? -1) >= 0;
    const notMetOk = Number.isInteger(numbers.controlsNotMet) && (numbers.controlsNotMet ?? -1) >= 0;
    // SPRS is sign-permitting: the DoD methodology deducts below zero.
    const sprsOk = Number.isInteger(numbers.sprsScore);
    if (metOk && notMetOk && sprsOk) {
      checks.pass('EO3', 'the EO API returns integer control counts and an integer SPRS score', {
        controlsMet: numbers.controlsMet ?? -1,
        controlsNotMet: numbers.controlsNotMet ?? -1,
        sprsScore: numbers.sprsScore ?? -1,
        liveAssessmentCount: numbers.liveAssessmentCount ?? 0,
      });
    } else {
      checks.fail(
        'EO3',
        `the EO API numbers are not all integers: met=${numbers.controlsMet}, not met=${numbers.controlsNotMet}, SPRS=${numbers.sprsScore}`,
      );
    }
  } catch (err) {
    checks.fail('EO3', `could not read the EO API: ${message(err)}`, 'environment');
  }

  // EO4 — the honesty guard. When no live signal leg ran, the log MUST say so,
  // because the numbers on screen are then not this run's evidence.
  const liveCount = numbers?.liveAssessmentCount ?? 0;
  const warned = ctx.logs.some((l) => l.includes(EO_LIVE_SIGNAL_WARNING));
  if (liveCount > 0) {
    checks.pass('EO4', `the live signal leg ran (${liveCount} live assessment(s)) — no warning due`, {
      liveAssessmentCount: liveCount,
    });
  } else if (warned) {
    checks.pass('EO4', 'no live signal leg ran, and the op said so verbatim', {
      liveAssessmentCount: liveCount,
    });
  } else {
    checks.fail(
      'EO4',
      'no live signal leg ran, but the op never logged the "do not narrate these numbers" warning',
    );
  }

  // EO5 — the walk drives tabs INSIDE the page; it must not have navigated or
  // reloaded, because the SPA cannot rehydrate an assessment from a page load.
  if (await hasRenderedAssessment(ctx.pane.page)) {
    checks.pass('EO5', 'the pane is still hydrated after the live walk');
  } else {
    checks.fail('EO5', 'the live walk left the pane without a rendered assessment');
  }
};

/* ------------------------------------------------- D.9 / D.10 stamper pair */

function loadExecutionReport(
  ctx: JudgeContext,
): { summary: ExecutionReportSummary; from: string } | undefined {
  // Located the way `stamper-execute-op` itself locates it — through the path
  // the driver reported, which the op registers as an artifact. Hardcoding a
  // directory here would judge a different file from the one the act judged.
  const registered = ctx.report.ops
    .flatMap((op) => [...op.artifacts])
    .filter((a) => a.endsWith('.json'));
  const candidates = registered.map((a) => resolveArtifact(ctx.args.testerRoot, a));
  const fallback = ctx.armed
    ? findLatestExecutionReport(
        stamperPlansDir(path.join(ctx.armed.runDir, 'pipeline'), ctx.armed.slug),
      )
    : undefined;
  for (const file of [...candidates, ...(fallback ? [fallback] : [])]) {
    if (!ctx.fileExists(file)) continue;
    try {
      return { summary: parseExecutionReport(readJson(file)), from: file };
    } catch {
      continue;
    }
  }
  return undefined;
}

const judgeStamper: Judge = async (ctx, checks) => {
  const armed = ctx.armed;
  if (!armed) {
    for (const id of ['ST1', 'ST2', 'ST3', 'ST4', 'SE1', 'SE2', 'SE3', 'SE4']) {
      checks.skip(id, 'no armed environment was observed', 'harness-defect');
    }
    return;
  }

  // ST1 — backstage, not pane. This is a DOCTRINE check, not a cosmetic one:
  // Config gets no live product demo, so the Configuration GUI must never touch
  // the audience-visible pane. Counted by proxying `AppPane.goto`.
  if (ctx.paneNavigations === 0) {
    checks.pass('ST1', 'the Config GUI never navigated the visible pane', { paneNavigations: 0 });
  } else {
    checks.fail(
      'ST1',
      `the Config work navigated the visible pane ${ctx.paneNavigations} time(s) — doctrine says it never appears on stage`,
    );
  }

  // ST2 — the precondition sampled right after translate, which is when it
  // means something: it is what decides execute's phase.
  const pre = ctx.snapshots.preconditions as
    | { connected: boolean; outputPath: string; ready: boolean }
    | undefined;
  if (!pre) {
    checks.skip('ST2', 'the post-translate precondition probe never ran', 'harness-defect');
  } else if (pre.outputPath !== '') {
    checks.pass('ST2', 'translate left the backstage page carrying an executable plan', {
      connected: pre.connected,
      outputPath: pre.outputPath,
      ready: pre.ready,
    });
  } else {
    checks.fail('ST2', `translate left #outputPath empty (connected=${pre.connected})`);
  }

  // ST3 — translate's own evidence.
  const translateOp = ctx.report.ops.find((o) => o.opId === 'stamper-translate');
  const translateShots = (translateOp?.artifacts ?? []).filter((a) => a.endsWith('.png'));
  if (translateShots.length >= 2) {
    checks.pass('ST3', `${translateShots.length} translate screenshot(s) registered`, {
      screenshots: translateShots.length,
    });
  } else {
    checks.fail('ST3', `translate registered ${translateShots.length} screenshot(s), expected >= 2`);
  }

  // ST4 — arming brought up :3000 and NOTHING else. A stamper deck that also
  // spins up the AO GUI and the EO server is paying for surfaces it never
  // touches, and on stage that is dead time before slide 1.
  const strays = [
    armed.aoBaseUrl ? 'AO GUI' : undefined,
    armed.eoBaseUrl ? 'EO server' : undefined,
  ].filter((s): s is string => s !== undefined);
  if (!armed.stamperBaseUrl) {
    checks.fail('ST4', 'arming did not bring up the Stamper GUI', 'harness-defect');
  } else if (strays.length > 0) {
    checks.fail('ST4', `arming also brought up ${strays.join(' and ')}, which this group never uses`);
  } else {
    checks.pass('ST4', `arming brought up only the Stamper GUI (${armed.stamperBaseUrl})`);
  }

  // SE1 — the ON-DISK report is the judge. The `#cardStatus4` badge has read
  // "Complete" while the report on disk read `partial` (80/110), which is why
  // the badge is narrative only and never evidence.
  const loaded = loadExecutionReport(ctx);
  if (!loaded) {
    checks.fail('SE1', 'no execution report was found on disk — there is nothing to judge honestly');
    for (const id of ['SE2', 'SE3', 'SE4']) {
      checks.skip(id, 'SE1 found no execution report to read');
    }
    return;
  }
  const summary = loaded.summary;
  checks.pass(
    'SE1',
    `judged the on-disk execution report, not the badge: ${summary.status ?? 'unknown'}`,
    {
      report: path.relative(ctx.args.testerRoot, loaded.from).replace(/\\/g, '/'),
      status: summary.status ?? 'unknown',
      completedTasks: summary.completedTasks ?? -1,
      totalTasks: summary.totalTasks ?? -1,
      failures: summary.failureIds.length,
    },
  );

  // SE2 — the fast path is the whole reason the backstage session exists.
  const fastPath = ctx.logs.some((l) => l.includes('(phase execute-only)'));
  if (pre?.ready && fastPath) {
    checks.pass('SE2', 'ST2 held and execute took the execute-only phase');
  } else if (pre?.ready) {
    checks.fail(
      'SE2',
      'ST2 held but execute did NOT take the execute-only phase — the backstage session bought nothing',
    );
  } else {
    checks.skip('SE2', 'ST2 did not hold, so the full phase was correct');
  }

  // SE3 — the GREEN BRANCH MUST BE POSITIVELY PROVEN. All three counts are
  // recorded even when every one of them is zero: a group whose SE3 carries no
  // partition record is indistinguishable from one where the check silently
  // never ran, and absence of a red is never itself evidence.
  const partition = partitionGuiFailures(summary.failureIds, GUI_LEG_KNOWN_FALSE_FAILS);
  const evidence = {
    expected: partition.expected.length,
    unexpected: partition.unexpected.length,
    staleSkips: partition.staleSkips.length,
    expectedIds: partition.expected.join(', '),
    unexpectedIds: partition.unexpected.join(', '),
    staleSkipIds: partition.staleSkips.join(', '),
  };
  if (partition.unexpected.length === 0) {
    checks.pass(
      'SE3',
      `no unexpected failures: ${evidence.expected} expected / 0 unexpected / ${evidence.staleSkips} stale skip(s)`,
      evidence,
    );
  } else {
    // An honest act-red. Recorded, named, non-zero exit — and NEVER pinned.
    checks.fail(
      'SE3',
      `${partition.unexpected.length} unexpected failure(s) not on the GUI-leg skip list: ${partition.unexpected.join(', ')}`,
      'act-red',
      evidence,
    );
  }

  // SE4 — divergence is recorded as evidence, not as a failure. The badge being
  // wrong is a known ces-stamper property; what matters is that we noticed and
  // did not narrate it.
  const badgeLine = ctx.logs.find((l) => l.includes('which is NOT the judge'));
  const badge = /badge said "([^"]*)"/.exec(badgeLine ?? '')?.[1];
  if (badge === undefined) {
    checks.skip('SE4', 'the op logged no badge value to compare against the report');
  } else {
    const diverged = badge.toLowerCase() !== (summary.status ?? '').toLowerCase();
    checks.pass(
      'SE4',
      diverged
        ? `badge "${badge}" DIVERGED from the on-disk report "${summary.status ?? 'unknown'}" — recorded, and the report is what was judged`
        : `badge "${badge}" agreed with the on-disk report`,
      { badge, reportStatus: summary.status ?? 'unknown', diverged },
    );
  }
};

/* -------------------------------------------------- D.12 ao-make-change */

/**
 * D.12 — the remediating governed change. A single live slide runs
 * `ao-registry`'s flow under a distinct id, defaulting to the remediation
 * command A-18. The acceptance is the same three-clause artifact test as the
 * AO family, plus the state-change clause D.11 does not carry:
 *   - AM1 the command executed against the sim slug (op done + status logged);
 *   - AM2 screenshots registered AND on disk;
 *   - AM3 the AO evidence row NAMES the command AND `stateChanged === true`
 *     (D.12's "the targeted control changes state" — the row is the artifact);
 *   - AM4 unarmed AO throws the specific arming error, off the pane.
 */
const judgeAoMakeChange: Judge = async (ctx, checks) => {
  const armed = ctx.armed;
  if (!armed) {
    for (const id of ['AM1', 'AM2', 'AM3', 'AM4']) {
      checks.skip(id, 'no armed environment was observed', 'harness-defect');
    }
    return;
  }

  const commandId = String(ctx.group.slides[0].params?.command ?? AO_DEMO_COMMAND_ID);

  // AM1 — the command executed. Single live slide; it must have completed and
  // logged a status badge naming the command it ran.
  const live = ctx.report.ops.find((o) => o.mode === 'live');
  const statusLine = ctx.logs.find((l) => l.includes('op ao-make-change: status'));
  if (!live) {
    checks.fail('AM1', 'the report is missing the live op record', 'harness-defect');
  } else if (live.status !== 'done') {
    checks.fail('AM1', `the live drive did not complete: ${live.status}`);
  } else if (!statusLine) {
    checks.fail('AM1', 'the op logged no status line — the drive returned no badge');
  } else {
    checks.pass('AM1', `the remediating command ${commandId} executed against '${armed.slug}'`, {
      status: statusLine.trim(),
    });
  }

  // AM2 — screenshots registered AND on disk (same read as AO2).
  const shots = reportArtifacts(ctx.report).filter((a) => a.endsWith('.png'));
  const missing = shots.filter((s) => !ctx.fileExists(resolveArtifact(ctx.args.testerRoot, s)));
  if (shots.length === 0) {
    checks.fail('AM2', 'the finished report registers no screenshot', 'harness-defect');
  } else if (missing.length > 0) {
    checks.fail('AM2', `registered but absent on disk: ${missing.join(', ')}`);
  } else {
    checks.pass('AM2', `${shots.length} screenshot(s) registered and present`, {
      screenshots: shots.length,
    });
  }

  // AM3 — the artifact: the AO evidence row NAMES the command and records the
  // state change. Matched on the row id's command prefix, never on
  // `metadata.commandExecuted` (the expanded PowerShell text — AO3's warning).
  const dbPath = aoDbPath(path.join(armed.runDir, 'pipeline'));
  const tenantId = simTenantId(armed.slug);
  try {
    const rows = readAoEvidence(dbPath, tenantId);
    const named = rows.filter((r) => r.id.split(':')[0] === commandId);
    if (named.length === 0) {
      checks.fail(
        'AM3',
        `no evidence row for command ${commandId} in ${path.basename(dbPath)} (${rows.length} row(s) for ${tenantId})`,
      );
    } else {
      const newest = named[named.length - 1];
      if (newest.metadata.stateChanged !== true) {
        checks.fail(
          'AM3',
          `evidence row ${newest.id} names ${commandId} but stateChanged=${String(newest.metadata.stateChanged)} — the change did not take`,
          'act-red',
          { recordId: newest.id, stateChanged: newest.metadata.stateChanged ?? false },
        );
      } else {
        checks.pass('AM3', `${named.length} evidence row(s) name ${commandId}, newest stateChanged=true`, {
          tenantId,
          rows: rows.length,
          matching: named.length,
          recordId: newest.id,
          outcome: newest.outcome ?? '(none)',
          complianceVerdict: newest.complianceVerdict ?? '(none)',
          stateChanged: true,
        });
      }
    }
  } catch (err) {
    checks.fail('AM3', `could not read AO evidence at ${dbPath}: ${message(err)}`, 'environment');
  }

  // AM4 — the negative case, INJECTED through a throwing pane (same as AO4).
  const negativeSlide = syntheticSlide({ opId: 'ao-make-change', mode: 'live' }, 0);
  const negativeCtx: OpDriveContext = {
    pane: throwingPane('AM4: the unarmed negative case must never reach a real pane'),
    slide: negativeSlide,
    index: 0,
    options: ctx.options,
    log: () => undefined,
    armed: { ...armed, aoBaseUrl: undefined },
  };
  const started = Date.now();
  try {
    await runAoMakeChangeOp(negativeCtx);
    checks.fail('AM4', 'unarmed AO did not throw — it would have hung on stage');
  } catch (err) {
    const text = message(err);
    const elapsed = Date.now() - started;
    if (text.includes('arm-sim.ts') && text.includes('not armed')) {
      checks.pass('AM4', `unarmed AO threw the specific arming error in ${elapsed} ms`, {
        error: text,
        ms: elapsed,
      });
    } else {
      checks.fail('AM4', `unarmed AO threw, but not the arming error: ${text}`);
    }
  }
};

/* -------------------------------------------- D.15 eo-verify-evidence */

/** The Evidence Explorer landing screenshot `eo-review` writes for `land=evidence`. */
const EO_EVIDENCE_SHOT = 'eo-review-03-evidence.png';

/**
 * D.15 — the cross-act chain: an AO command executed live, then EO assessed and
 * walked to the Evidence Explorer.
 *
 * **EV2 re-pinned to correlationId (FX-TE4, 2026-09-27).** ces-eo AE-R5 +
 * FX-EO1/FX-EO2 list AdminOps rows in `/api/evidence-explorer/index`
 * (tenant-scoped, item path `adminops/<ces.db row id>`), open them via
 * `/api/evidence-explorer/item`, and `/api/adminops/executions` returns each
 * row's `correlationId`. Since ces-ao FX-AO7 (`e53e708`) the AO web UI sends a
 * fresh `ao-ui-<uuid>` correlationId on every execute and it lands on the
 * persisted contract row (`data.metadata.correlationId`); REQ-AO-GUI-NO-CORRELATION-ID
 * is closed. So:
 *   - **EV1** the Evidence Explorer landing screenshot (the tab was reached);
 *   - **EV2** EvidenceOps finds **this click's AO row by its correlationId**:
 *     the newest row AO wrote for the executed command in this run's own
 *     `ces.db` must carry an `ao-ui-` correlationId (the UI's, not an API
 *     caller's); EO's `/api/adminops/executions` must return exactly one row
 *     with that correlationId; the Explorer index must list that row, and
 *     opening it must return the same correlationId and command id. The
 *     ces.db row id is only the join to the Explorer item, never the key;
 *   - **EV3** the AO write-side record naming the executed command.
 *
 * Hydration is NOT judged in this group (no SLIDE_PROBES entry): EV1's landing
 * screenshot plus the Explorer API are the tells here.
 */
const judgeEoVerifyEvidence: Judge = async (ctx, checks) => {
  const armed = ctx.armed;
  if (!armed?.eoBaseUrl) {
    for (const id of ['EV1', 'EV2', 'EV3']) {
      checks.skip(id, 'EO was never armed', 'harness-defect');
    }
    return;
  }

  const commandId = String(ctx.group.slides[0].params?.command ?? AO_DEMO_COMMAND_ID);

  // EV1 — the evidence-landing screenshot registered in the finished report AND
  // present on disk (same read as MR5 / AO2).
  const registered = reportArtifacts(ctx.report).find((a) => a.endsWith(EO_EVIDENCE_SHOT));
  if (!registered) {
    checks.fail('EV1', `the walk registered no ${EO_EVIDENCE_SHOT} — the Evidence Explorer landing was not reached`);
  } else if (!ctx.fileExists(resolveArtifact(ctx.args.testerRoot, registered))) {
    checks.fail('EV1', `the report registers ${registered}, but nothing is there on disk`);
  } else {
    checks.pass('EV1', `the Evidence Explorer landing screenshot is registered and present`, {
      screenshot: registered,
    });
  }

  // EV2 — EvidenceOps finds THIS click's AO row by its correlationId
  // (FX-AO7's `ao-ui-<uuid>`). The endpoints take the RAW slug, never
  // `sim-tenant-<slug>`.
  const ev2DbPath = aoDbPath(path.join(armed.runDir, 'pipeline'));
  const ev2Rows = (() => {
    try {
      return readAoEvidence(ev2DbPath, simTenantId(armed.slug));
    } catch {
      return [];
    }
  })();
  const ev2Named = ev2Rows.filter((r) => r.id.split(':')[0] === commandId);
  const ev2Row = newestAoEvidenceRow(ev2Named);
  const correlationId = ev2Row?.correlationId;
  if (!ev2Row) {
    checks.fail('EV2', `no AO row for command ${commandId} in this run's ces.db — nothing for EvidenceOps to find`);
  } else if (!correlationId) {
    checks.fail(
      'EV2',
      `this run's AO row ${ev2Row.id} carries no correlationId — the AO UI did not send one (REQ-AO-GUI-NO-CORRELATION-ID regressed?)`,
    );
  } else if (!correlationId.startsWith(AO_UI_CORRELATION_PREFIX)) {
    checks.fail(
      'EV2',
      `this run's AO row ${ev2Row.id} has correlationId "${correlationId}", not an AO web UI id (${AO_UI_CORRELATION_PREFIX}<uuid>)`,
    );
  } else if (ev2Rows.filter((r) => r.correlationId === correlationId).length !== 1) {
    checks.fail('EV2', `correlationId ${correlationId} is on more than one AO row in this run's ces.db — not a unique key`);
  } else {
    const slugQ = encodeURIComponent(armed.slug);
    try {
      const executions = (await fetchJson(`${armed.eoBaseUrl}/api/adminops/executions?tenant=${slugQ}`)) as {
        executions?: Array<{ rowId?: string; commandId?: string; correlationId?: string }>;
      };
      const matches = (Array.isArray(executions.executions) ? executions.executions : []).filter(
        (e) => e.correlationId === correlationId,
      );
      if (matches.length !== 1 || !matches[0].rowId) {
        checks.fail(
          'EV2',
          `EvidenceOps /api/adminops/executions returns ${matches.length} row(s) with correlationId ${correlationId} (expected exactly 1)`,
        );
      } else {
        const rowId = matches[0].rowId;
        const index = (await fetchJson(`${armed.eoBaseUrl}/api/evidence-explorer/index?tenant=${slugQ}`)) as {
          items?: Array<{ id?: string; source?: string; title?: string; path?: string }>;
        };
        const items = Array.isArray(index.items) ? index.items : [];
        const aoItems = items.filter((it) => it.source === 'adminops');
        const item = aoItems.find((it) => it.id === `adminops:${rowId}`);
        if (!item || !item.path) {
          checks.fail(
            'EV2',
            `the Explorer does not list the row for correlationId ${correlationId} (adminops:${rowId}; ${aoItems.length} adminops item(s) of ${items.length})`,
          );
        } else {
          const opened = (await fetchJson(
            `${armed.eoBaseUrl}/api/evidence-explorer/item?tenant=${slugQ}&source=adminops&path=${encodeURIComponent(item.path)}`,
          )) as { content?: { rowId?: string; commandId?: string; correlationId?: string; outcome?: string } };
          const c = opened.content ?? {};
          if (c.correlationId !== correlationId || c.commandId !== commandId) {
            checks.fail(
              'EV2',
              `the Explorer item ${item.id} opened as correlationId ${c.correlationId ?? '?'} / command ${c.commandId ?? '?'} — expected ${correlationId} / ${commandId}`,
            );
          } else {
            checks.pass('EV2', `EvidenceOps finds this click's AO row for ${commandId} by correlationId ${correlationId}`, {
              correlationId,
              itemId: item.id ?? '',
              rowId,
              commandId: c.commandId,
              outcome: c.outcome ?? '',
              adminopsItems: aoItems.length,
            });
          }
        }
      }
    } catch (err) {
      checks.fail('EV2', `could not read EvidenceOps: ${message(err)}`, 'environment');
    }
  }

  // EV3 — the write-side record. The AO leg wrote an `adminops_evidence` row
  // naming the executed command; this carries the command-id half of the chain
  // that the Explorer cannot. Matched on the row id's command prefix
  // (`A-18:A-18-<ts>`), never on `metadata.commandExecuted` (the expanded
  // PowerShell text — AO3's warning).
  const dbPath = aoDbPath(path.join(armed.runDir, 'pipeline'));
  const tenantId = simTenantId(armed.slug);
  try {
    const rows = readAoEvidence(dbPath, tenantId);
    const named = rows.filter((r) => r.id.split(':')[0] === commandId);
    if (named.length === 0) {
      checks.fail(
        'EV3',
        `no AO evidence row for command ${commandId} in ${path.basename(dbPath)} (${rows.length} row(s) for ${tenantId})`,
      );
    } else {
      const newest = named[named.length - 1];
      checks.pass('EV3', `${named.length} AO evidence row(s) name command ${commandId} — the record exists write-side`, {
        tenantId,
        rows: rows.length,
        matching: named.length,
        recordId: newest.id,
        stateChanged: newest.metadata.stateChanged ?? false,
      });
    }
  } catch (err) {
    checks.fail('EV3', `could not read AO evidence at ${dbPath}: ${message(err)}`, 'environment');
  }
};

/* ---------------------------------------- D.16 eo-show-change-captured */

function readEoArtifact(
  absPath: string,
  fileExists: (p: string) => boolean,
): EoAssessmentArtifact | undefined {
  if (!fileExists(absPath)) return undefined;
  try {
    return readJson(absPath) as EoAssessmentArtifact;
  } catch {
    return undefined;
  }
}

/**
 * D.16 — the loop-closes proof. The BEFORE is captured by SLIDE_PROBES between
 * the warm assess and the remediator; the op re-assesses for the AFTER and
 * narrates ONLY what changed. The judge computes the truth from the two artifacts
 * and verifies the op's narration matched it — never the reverse.
 *
 * The named control's status and the SPRS delta are INDEPENDENT (A-18 can move
 * the score without flipping IA.L2-3.5.3), so EC3 (control) and EC4 (SPRS) are
 * separate and neither is inferred from the other.
 */
const judgeEoShowChangeCaptured: Judge = async (ctx, checks) => {
  const armed = ctx.armed;
  if (!armed?.eoBaseUrl) {
    for (const id of ['EC1', 'EC2', 'EC3', 'EC4', 'EC5']) {
      checks.skip(id, 'EO was never armed', 'harness-defect');
    }
    return;
  }
  const control = String(ctx.group.slides[2]?.params?.control ?? DEMO_MFA_CONTROL_ID);
  const before = readEoArtifact(path.join(armed.runDir, 'eo-before.json'), ctx.fileExists);
  const after = readEoArtifact(path.join(armed.runDir, 'eo-after.json'), ctx.fileExists);

  // EC1 — both artifacts parse AND the after snapshot is fresh (generatedAt
  // strictly newer) — proof the re-assess produced a new snapshot, not a re-serve.
  if (!before || !after) {
    checks.fail('EC1', `missing before/after artifact: before=${Boolean(before)}, after=${Boolean(after)}`);
    for (const id of ['EC2', 'EC3', 'EC4', 'EC5']) {
      checks.skip(id, 'EC1 found no before/after artifacts to judge');
    }
    return;
  }
  const cmp = compareEoChange(before, after, control);
  const fresh =
    !!cmp.beforeGeneratedAt && !!cmp.afterGeneratedAt && cmp.afterGeneratedAt > cmp.beforeGeneratedAt;
  if (fresh) {
    checks.pass('EC1', 'both before/after artifacts parse and the after snapshot is strictly fresher', {
      beforeGeneratedAt: cmp.beforeGeneratedAt ?? '(none)',
      afterGeneratedAt: cmp.afterGeneratedAt ?? '(none)',
    });
  } else {
    checks.fail(
      'EC1',
      `the after snapshot is not newer than the before (before ${cmp.beforeGeneratedAt ?? '(none)'}, after ${cmp.afterGeneratedAt ?? '(none)'}) — the re-assess produced no fresh snapshot`,
    );
  }

  // EC2 — the captured before matches the warm leg's OWN logged API numbers, so
  // the before-capture is real (captured while still true), not already
  // remediated. The first `op eo-review: API —` line is the warm leg's (the
  // re-assess logs a second one later).
  const warmLine = ctx.logs.find((l) => l.includes('op eo-review: API —'));
  const beforeNums = readEoNumbers(before.assessment, before.sprs);
  if (!warmLine) {
    checks.fail(
      'EC2',
      'the eo-review warm leg logged no API numbers line to cross-check the before against',
      'harness-defect',
    );
  } else {
    const m = /met (-?\d+|\?), not met (-?\d+|\?), SPRS (-?\d+|\?)/.exec(warmLine);
    const logMet = m?.[1] ?? '?';
    const logNotMet = m?.[2] ?? '?';
    const logSprs = m?.[3] ?? '?';
    const agree =
      logMet === String(beforeNums.controlsMet) &&
      logNotMet === String(beforeNums.controlsNotMet) &&
      logSprs === String(beforeNums.sprsScore);
    if (agree) {
      checks.pass('EC2', `eo-before.json matches the warm leg's logged numbers (met ${logMet}, not met ${logNotMet}, SPRS ${logSprs})`, {
        met: logMet,
        notMet: logNotMet,
        sprs: logSprs,
      });
    } else {
      checks.fail(
        'EC2',
        `eo-before.json (met ${beforeNums.controlsMet}, not met ${beforeNums.controlsNotMet}, SPRS ${beforeNums.sprsScore}) disagrees with the warm leg's log (met ${logMet}, not met ${logNotMet}, SPRS ${logSprs}) — the before-state was not captured while still true`,
      );
    }
  }

  // EC3 — the control's before/after status is compared and the op's narration
  // MATCHES the computed comparison (flip narrated iff actually flipped).
  const flipNarrated = ctx.logs.some((l) => l.includes('FLIP:'));
  const noFlipNarrated = ctx.logs.some((l) => l.includes(EO_CHANGE_NO_FLIP));
  const ec3Evidence = {
    control,
    beforeStatus: cmp.beforeStatus,
    afterStatus: cmp.afterStatus,
    flipped: cmp.flipped,
  };
  if (cmp.flipped && flipNarrated && !noFlipNarrated) {
    checks.pass('EC3', `${control} flipped ${cmp.beforeStatus} -> ${cmp.afterStatus}; the op narrated the flip`, ec3Evidence);
  } else if (!cmp.flipped && noFlipNarrated && !flipNarrated) {
    checks.pass('EC3', `${control} did not change (${cmp.beforeStatus}); the op reported no change, not a flip`, ec3Evidence);
  } else {
    checks.fail(
      'EC3',
      `narration disagrees with the artifacts: computed flipped=${cmp.flipped}, flipNarrated=${flipNarrated}, noFlipNarrated=${noFlipNarrated}`,
      'act-red',
      ec3Evidence,
    );
  }

  // EC4 — screen==file for the SPRS: the on-screen score the op read equals the
  // after-artifact score. The SPRS delta is recorded as its OWN fact.
  const onScreenMatch = ctx.logs.map((l) => /on screen (-?\d+)/.exec(l)).find((x) => x);
  const onScreen = onScreenMatch ? Number(onScreenMatch[1]) : undefined;
  if (typeof cmp.afterSprs !== 'number') {
    checks.fail('EC4', 'the after artifact carries no numeric SPRS score', 'environment');
  } else if (onScreen === undefined) {
    checks.fail('EC4', 'the walk read no on-screen SPRS score to compare against the artifact');
  } else if (onScreen !== cmp.afterSprs) {
    checks.fail('EC4', `on-screen SPRS ${onScreen} != after-artifact SPRS ${cmp.afterSprs} — screen and file disagree`);
  } else {
    checks.pass('EC4', `on-screen SPRS equals the after artifact (${onScreen}); SPRS delta ${cmp.sprsDelta}`, {
      beforeSprs: cmp.beforeSprs ?? -1,
      afterSprs: cmp.afterSprs,
      sprsDelta: cmp.sprsDelta ?? 0,
      onScreen,
    });
  }

  // EC5 — the honesty guard. A non-flip (or no reliable before) MUST be reported
  // plainly and MUST NOT narrate a flip. A real flip is a legitimate pass.
  if (cmp.flipped && flipNarrated) {
    checks.pass('EC5', `${control} genuinely flipped; the flip narration is backed by the artifacts`, {
      flipped: true,
      from: cmp.beforeStatus,
      to: cmp.afterStatus,
    });
  } else if (!cmp.flipped && noFlipNarrated && !flipNarrated) {
    checks.pass('EC5', `no flip occurred and the op logged the honest no-change line, narrating no flip`, {
      flipped: false,
      control,
      status: cmp.beforeStatus,
    });
  } else {
    checks.fail(
      'EC5',
      `dishonest or inconsistent narration: computed flipped=${cmp.flipped} but flipNarrated=${flipNarrated}, noFlipNarrated=${noFlipNarrated}`,
      'act-red',
    );
  }
};

/* ---------------------------------------------------- D.1 simstack-create */

/**
 * D.1 — the tenant is stood up with the deliberate gap. A READOUT over the armed
 * state: the judge verifies the same three facts the op presents, reading the
 * sim and the registry record directly (the record file IS the artifact).
 */
const judgeSimstackCreate: Judge = async (ctx, checks) => {
  const armed = ctx.armed;
  if (!armed?.simUrl) {
    for (const id of ['SC1', 'SC2', 'SC3']) {
      checks.skip(id, 'the stacksim serve was never armed', 'harness-defect');
    }
    return;
  }

  // SC1 — the sim answers the policy endpoint: the tenant materialized.
  try {
    const res = await fetch(`${armed.simUrl}/v1.0/policies/authorizationPolicy`);
    if (res.ok) {
      checks.pass('SC1', `the sim answers GET /v1.0/policies/authorizationPolicy (${res.status})`, {
        status: res.status,
      });
    } else {
      checks.fail('SC1', `the sim policy endpoint returned ${res.status}`, 'environment');
    }
  } catch (err) {
    checks.fail('SC1', `could not reach the sim policy endpoint: ${message(err)}`, 'environment');
  }

  // SC2 — the registry record has four valid auth fields + absolute cert_path.
  const recordPath = simRecordPath(simstackRegistryRoot(armed.runDir), armed.slug);
  try {
    const fields = readSimTenantAuthFields(readJson(recordPath));
    const missing = missingSimTenantAuthFields(fields);
    if (missing.length === 0) {
      checks.pass('SC2', 'the registry record has four valid auth fields, absolute cert_path, no placeholder', {
        tenantId: fields.tenantId ?? '(none)',
        appId: fields.appId ?? '(none)',
        certPath: fields.certPath ?? '(none)',
      });
    } else {
      checks.fail('SC2', `the registry record is unusable: ${missing.join(', ')}`);
    }
  } catch (err) {
    checks.fail('SC2', `could not read the registry record at ${recordPath}: ${message(err)}`);
  }

  // SC3 — the deliberate gap is present: caPolicy-1 is report-only, NOT absent.
  try {
    const res = await fetch(
      `${armed.simUrl}/v1.0/identity/conditionalAccess/policies/${SIMSTACK_GAP_POLICY_ID}`,
    );
    if (!res.ok) {
      checks.fail('SC3', `the gap policy endpoint returned ${res.status}`, 'environment');
    } else {
      const body = (await res.json()) as { state?: unknown };
      const state = typeof body.state === 'string' ? body.state : undefined;
      if (state === SIMSTACK_GAP_STATE) {
        checks.pass('SC3', `the report-only gap is present (${SIMSTACK_GAP_POLICY_ID} = ${state})`, {
          policy: SIMSTACK_GAP_POLICY_ID,
          state,
        });
      } else {
        checks.fail('SC3', `${SIMSTACK_GAP_POLICY_ID} is not report-only (got ${state ?? 'no state'}) — the deliberate gap is missing`);
      }
    }
  } catch (err) {
    checks.fail('SC3', `could not read the gap policy: ${message(err)}`, 'environment');
  }
};

/* --------------------------------------------------- D.2 simstack-destroy */

/**
 * D.2 — the "leave no trace" teardown. The op already removed the sim registry
 * record; the judge proves the four contract clauses: the slug is gone from
 * `listByKind('sim')`, a second teardown is a no-op, a LIVE slug is REFUSED (a
 * safety, injected via a throwaway registry with a fabricated live record — a
 * negative-path fixture, never orchestration), and the run evidence survived.
 */
const judgeSimstackDestroy: Judge = async (ctx, checks) => {
  const armed = ctx.armed;
  if (!armed) {
    for (const id of ['SD1', 'SD2', 'SD3', 'SD4']) {
      checks.skip(id, 'no armed environment was observed', 'harness-defect');
    }
    return;
  }
  const registryRoot = simstackRegistryRoot(armed.runDir);
  const registry = createTenantRegistry({ registryRoot });

  // SD1 — the slug is gone from `listByKind('sim')` (the gate contract).
  try {
    const sims = await listSimTenants(registry);
    if (!sims.some((r) => r.tenantSlug === armed.slug)) {
      checks.pass('SD1', `listByKind('sim') no longer contains '${armed.slug}'`, {
        simRecords: sims.length,
      });
    } else {
      checks.fail('SD1', `'${armed.slug}' is still in listByKind('sim') after the act`);
    }
  } catch (err) {
    checks.fail('SD1', `could not list sim tenants: ${message(err)}`, 'environment');
  }

  // SD2 — idempotence: a second teardown succeeds (a documented no-op).
  try {
    await teardownEphemeralSimTenant(registry, armed.slug);
    checks.pass('SD2', 'a second teardown succeeded — the operation is idempotent');
  } catch (err) {
    checks.fail('SD2', `the second teardown threw (not idempotent): ${message(err)}`);
  }

  // SD3 — a LIVE-slug target THROWS the refusal, rather than deleting. Injected
  // through a throwaway registry with a fabricated live record.
  const sd3Root = path.join(armed.runDir, 'sd3-refusal-check');
  const livePath = path.join(sd3Root, 'live', `${armed.slug}.json`);
  try {
    fs.mkdirSync(path.dirname(livePath), { recursive: true });
    fs.writeFileSync(
      livePath,
      JSON.stringify({ kind: 'live', client: { slug: armed.slug }, tenant: { tenant_id: `live-${armed.slug}` } }),
    );
    await teardownEphemeralSimTenant(createTenantRegistry({ registryRoot: sd3Root }), armed.slug);
    checks.fail('SD3', 'tearing down a LIVE slug did NOT throw — the safety refusal is gone');
  } catch (err) {
    const text = message(err);
    if (text.includes('refusing to tear down') && text.includes('live tenant')) {
      checks.pass('SD3', 'a live-slug teardown throws the refusal instead of deleting', { error: text });
    } else {
      checks.fail('SD3', `teardown threw, but not the live-slug refusal: ${text}`);
    }
  }

  // SD4 — the run evidence survived: the op's artifact reached the report AND is
  // on disk, and the run directory still holds its evidence (teardown removed the
  // record, not the proof).
  const artifact = reportArtifacts(ctx.report).find((a) => a.endsWith('simstack-destroy.json'));
  const runDirEntries = ctx.fileExists(armed.runDir) ? fs.readdirSync(armed.runDir).length : 0;
  if (!artifact) {
    checks.fail('SD4', 'the finished report registers no simstack-destroy.json', 'harness-defect');
  } else if (!ctx.fileExists(resolveArtifact(ctx.args.testerRoot, artifact))) {
    checks.fail('SD4', `the report registers ${artifact}, but nothing is on disk`);
  } else if (runDirEntries === 0) {
    checks.fail('SD4', 'the run directory is empty after teardown — evidence was destroyed');
  } else {
    checks.pass('SD4', `runDir evidence intact after teardown (${runDirEntries} entr${runDirEntries === 1 ? 'y' : 'ies'})`, {
      runDirEntries,
      artifact,
    });
  }
};

/* ---------------------------------------------- D.5 muster-auto-analysis */

/**
 * D.5 — the honest CLI-walk → import composition. Judged from the CLI artifact
 * and the facts the op captured after import. Runs only when the group's slice
 * includes `muster-auto-analysis`.
 */
const judgeMusterAutoAnalysis: Judge = async (ctx, checks) => {
  if (!ctx.group.opIds.includes('muster-auto-analysis')) return;
  const armed = ctx.armed!;
  const cliArtifact = path.join(armed.runDir, READINESS_RESULT_ARTIFACT);
  const factsPath = path.join(armed.runDir, MUSTER_AUTO_ANALYSIS_FACTS);

  // MA1 — the CLI artifact exists and is a readiness-result/1.0.0. The CLI
  // Ajv-validates (strict:true) before writing; the judge confirms the version
  // and the required top-level structure the import consumes.
  if (!ctx.fileExists(cliArtifact)) {
    checks.fail('MA1', `no CLI readiness-result artifact at ${READINESS_RESULT_ARTIFACT}`);
  } else {
    try {
      const a = readJson(cliArtifact) as {
        schema_version?: string;
        observations?: unknown;
        derived?: unknown;
        manifest?: unknown;
      };
      const missing: string[] = [];
      if (a.schema_version !== READINESS_RESULT_SCHEMA_VERSION) missing.push(`schema_version ${a.schema_version}`);
      if (!Array.isArray(a.observations)) missing.push('observations[]');
      if (!a.derived) missing.push('derived');
      if (!a.manifest) missing.push('manifest');
      if (missing.length === 0) {
        checks.pass('MA1', `the CLI artifact is a ${READINESS_RESULT_SCHEMA_VERSION} (${(a.observations as unknown[]).length} observations)`, {
          schemaVersion: a.schema_version ?? '',
          observations: (a.observations as unknown[]).length,
        });
      } else {
        checks.fail('MA1', `the CLI artifact is not a valid readiness-result: ${missing.join(', ')}`);
      }
    } catch (err) {
      checks.fail('MA1', `the CLI artifact does not parse: ${message(err)}`);
    }
  }

  if (!ctx.fileExists(factsPath)) {
    for (const id of ['MA2', 'MA3', 'MA4']) {
      checks.skip(id, `the op registered no ${MUSTER_AUTO_ANALYSIS_FACTS}`, 'harness-defect');
    }
    return;
  }
  const facts = readJson(factsPath) as {
    schemaVersion?: string;
    observationCount?: number;
    fixtureObservationCount?: number;
    ledgerDelta?: number | null;
    boundaryPanelVisible?: boolean;
    discoverySummaryVisible?: boolean;
  };

  // MA2 — the walk is read-only: ledger create+mutate delta is 0.
  if (facts.ledgerDelta === 0) {
    checks.pass('MA2', 'the discovery walk is read-only (ledger create+mutate delta 0)', { ledgerDelta: 0 });
  } else if (facts.ledgerDelta === null || facts.ledgerDelta === undefined) {
    checks.fail('MA2', 'the ledger delta was not measured — cannot prove the walk was read-only', 'environment');
  } else {
    checks.fail('MA2', `the walk mutated the ledger (create+mutate delta ${facts.ledgerDelta}) — NOT read-only`);
  }

  // MA3 — the fixture signature is ABSENT (non-vacuous, per the re-pin): what was
  // imported is a readiness-result (schema_version present) carrying the REAL
  // walk's observation count, which is NOT the DISCOVERY_RESULTS_FIXTURE's 14
  // bare rows. Records both counts.
  const obsCount = facts.observationCount ?? -1;
  const fixtureCount = facts.fixtureObservationCount ?? 14;
  if (facts.schemaVersion === READINESS_RESULT_SCHEMA_VERSION && obsCount !== fixtureCount && obsCount > 0) {
    checks.pass('MA3', `the fixture signature is absent: a readiness-result of ${obsCount} observations, not the ${fixtureCount}-row fixture`, {
      observationCount: obsCount,
      fixtureObservationCount: fixtureCount,
      schemaVersion: facts.schemaVersion ?? '',
    });
  } else {
    checks.fail('MA3', `could not distinguish the import from the fixture: schemaVersion=${facts.schemaVersion}, observationCount=${obsCount}, fixtureCount=${fixtureCount}`);
  }

  // MA4 — real ingestion: the import landed on `boundary-confirm-panel` and NOT
  // the fixture branch's `discovery-summary`.
  if (facts.boundaryPanelVisible === true && facts.discoverySummaryVisible === false) {
    checks.pass('MA4', 'the import landed on boundary-confirm-panel, not the fixture branch', {
      boundaryPanelVisible: true,
      discoverySummaryVisible: false,
    });
  } else {
    checks.fail(
      'MA4',
      `the import did not land on the honest path: boundaryPanelVisible=${facts.boundaryPanelVisible}, discoverySummaryVisible=${facts.discoverySummaryVisible}`,
    );
  }
};

/* ------------------------------------------ D.6 muster-consent-and-attest */

/** D.6 — a named human attests the boundary. Judged from the facts artifact. */
const judgeMusterConsent: Judge = async (ctx, checks) => {
  if (!ctx.group.opIds.includes('muster-consent-and-attest')) return;
  const armed = ctx.armed!;
  const factsPath = path.join(armed.runDir, MUSTER_CONSENT_FACTS);
  if (!ctx.fileExists(factsPath)) {
    for (const id of ['MC1', 'MC2', 'MC3']) {
      checks.skip(id, `the op registered no ${MUSTER_CONSENT_FACTS}`, 'harness-defect');
    }
    return;
  }
  const facts = readJson(factsPath) as {
    boundaryPanelVisible?: boolean;
    hadDrafts?: boolean;
    nameGatingObserved?: boolean;
    confirmedQid?: string | null;
    continueClicked?: boolean;
    confirmerName?: string;
  };

  // MC1 — the boundary confirm panel was reached (permissioned attestation step).
  if (facts.boundaryPanelVisible === true) {
    checks.pass('MC1', 'the boundary confirm panel was visible for attestation', {
      confirmer: facts.confirmerName ?? '',
    });
  } else {
    checks.fail('MC1', 'the boundary confirm panel was not visible');
  }

  // MC2 — a blank confirmer name is rejected: a draft confirm is disabled while
  // the name is blank and enabled after. When the import produced NO drafts,
  // there is nothing to gate — a pruning-only pass, recorded plainly.
  if (facts.hadDrafts === true) {
    if (facts.nameGatingObserved === true) {
      checks.pass('MC2', 'a draft confirm was name-gated: disabled while the confirmer name was blank, enabled after', {
        hadDrafts: true,
      });
    } else {
      checks.fail('MC2', 'the draft confirm was NOT name-gated — a machine inference could attest itself');
    }
  } else {
    checks.pass('MC2', 'pruning-only (no drafts to confirm); the panel and continue worked', { hadDrafts: false });
  }

  // MC3 — after continue, the workflow advanced; a confirmed draft carries the
  // operator name (the chain D.8's export verifies).
  if (facts.continueClicked === true) {
    checks.pass('MC3', `attestation continued${facts.confirmedQid ? ` — confirmed draft ${facts.confirmedQid} carries '${facts.confirmerName}'` : ' (no drafts confirmed)'}`, {
      confirmedQid: facts.confirmedQid ?? '(none)',
      confirmer: facts.confirmerName ?? '',
    });
  } else {
    checks.fail('MC3', 'the attestation did not continue past the boundary panel');
  }
};

/* ---------------------------------------- D.8 muster-generate-sprs-mp */

/** D.8 — the SPRS number, read from the exported payload (never the DOM). */
const judgeMusterSprs: Judge = async (ctx, checks) => {
  if (!ctx.group.opIds.includes('muster-generate-sprs-mp')) return;
  const armed = ctx.armed!;
  const factsPath = path.join(armed.runDir, MUSTER_SPRS_FACTS);
  if (!ctx.fileExists(factsPath)) {
    for (const id of ['MP1', 'MP2', 'MP3']) {
      checks.skip(id, `the op registered no ${MUSTER_SPRS_FACTS}`, 'harness-defect');
    }
    return;
  }
  const facts = readJson(factsPath) as {
    schemaVersion?: string;
    payloadSprs?: number | null;
    domScoreText?: string;
    domScorePercent?: number | null;
    exportedArtifact?: string;
  };

  // MP1 — the EXPORTED payload is a readiness-result/1.0.0 (Ajv-validated by the
  // SPA's export path; the judge confirms the version).
  if (facts.schemaVersion === MUSTER_SPRS_SCHEMA) {
    checks.pass('MP1', `the exported payload is a ${MUSTER_SPRS_SCHEMA}`, {
      artifact: facts.exportedArtifact ?? '',
    });
  } else {
    checks.fail('MP1', `the exported payload is not a ${MUSTER_SPRS_SCHEMA} (got ${facts.schemaVersion})`);
  }

  // MP2 — the SPRS integer was read from the PAYLOAD, not the DOM.
  if (typeof facts.payloadSprs === 'number' && Number.isInteger(facts.payloadSprs)) {
    checks.pass('MP2', `the SPRS integer was read from the exported payload: ${facts.payloadSprs}`, {
      payloadSprs: facts.payloadSprs,
    });
  } else {
    checks.fail('MP2', `no integer SPRS score in the exported payload (got ${facts.payloadSprs})`);
  }

  // MP3 — the DOM conservative-score matches `/^-?\d+% compliant/` (NOT a bare
  // integer — that regex was refuted). Numbers come from the payload, not this.
  const domText = (facts.domScoreText ?? '').trim();
  if (/^-?\d+% compliant/.test(domText) && typeof facts.domScorePercent === 'number') {
    checks.pass('MP3', `the DOM conservative-score matches /^-?\\d+% compliant/ ("${domText}") — a percentage string, not the SPRS integer`, {
      domScoreText: domText,
      domScorePercent: facts.domScorePercent,
    });
  } else {
    checks.fail('MP3', `the DOM conservative-score does not match /^-?\\d+% compliant/ (got "${domText}")`);
  }
};

/* ---------------------------------------- D.7 muster-adaptive-interview */

/** D.7 — discovery pruning. Judged from the two measured question totals. */
const judgeMusterAdaptive: Judge = async (ctx, checks) => {
  if (!ctx.group.opIds.includes('muster-adaptive-interview')) return;
  const armed = ctx.armed!;
  const factsPath = path.join(armed.runDir, MUSTER_ADAPTIVE_FACTS);
  if (!ctx.fileExists(factsPath)) {
    checks.skip('MI1', `the op registered no ${MUSTER_ADAPTIVE_FACTS}`, 'harness-defect');
    return;
  }
  const facts = readJson(factsPath) as {
    discoveryTotal?: number | null;
    manualTotal?: number | null;
    pruned?: boolean;
  };
  const d = facts.discoveryTotal;
  const m = facts.manualTotal;
  if (typeof d !== 'number' || typeof m !== 'number') {
    checks.fail('MI1', `a question total was not measured (discovery=${d}, manual=${m})`, 'environment');
  } else if (d < m) {
    checks.pass('MI1', `discovery pruned the interview: ${d} question(s) vs the manual branch's ${m} (${m - d} fewer)`, {
      discoveryTotal: d,
      manualTotal: m,
      fewer: m - d,
    });
  } else {
    // Honest outcome, not an act defect: the op reported no pruning plainly.
    checks.fail(
      'MI1',
      `no pruning measured: discovery ${d} is not strictly less than the manual branch's ${m} — reported plainly, not narrated as a drop`,
      'environment',
      { discoveryTotal: d, manualTotal: m },
    );
  }
};

/* ------------------------------------------------------ D.4 muster-gui */

/**
 * D.4-D.8 — the Muster SPA acts, one group grown per slice. 3.0 judges MU-C1:
 * after `muster-connect-tenant`, the Profile/manifest view is on screen, the
 * `rm-*` fields carry the declared values, and Begin Interview is reachable (and
 * was left UNCLICKED). Read straight off the DOM the op stopped on.
 */
const judgeMusterGui: Judge = async (ctx, checks) => {
  const armed = ctx.armed;
  if (!armed?.musterBaseUrl) {
    checks.skip('MU-C1', 'the ces-muster preview was never armed', 'harness-defect');
    return;
  }
  const connectSlide = ctx.group.slides.find((s) => s.opId === 'muster-connect-tenant');
  const expectedMode = String(connectSlide?.params?.mode ?? 'independent');
  const expectedAuthTier = String(connectSlide?.params?.authTier ?? 'cert-app-only');
  const expectedSlug = String(connectSlide?.params?.slug ?? armed.slug);
  // Read the manifest from the facts artifact the connect op captured while the
  // Profile view was still on screen — a later muster-gui act navigates away.
  const factsPath = path.join(armed.runDir, MUSTER_CONNECT_FACTS);
  if (!ctx.fileExists(factsPath)) {
    checks.fail('MU-C1', `the connect op registered no ${MUSTER_CONNECT_FACTS}`, 'harness-defect');
  } else {
    try {
      const m = readJson(factsPath) as {
        mode?: string;
        authTier?: string;
        slug?: string;
        operatorName?: string;
        operatorRole?: string;
        beginInterviewReachable?: boolean;
        profileVisible?: boolean;
      };
      const mismatches: string[] = [];
      if (m.profileVisible !== true) mismatches.push('the manifest view was not visible');
      if (m.beginInterviewReachable !== true) mismatches.push('begin-interview was not reachable');
      if (m.mode !== expectedMode) mismatches.push(`mode ${m.mode} != ${expectedMode}`);
      if (m.authTier !== expectedAuthTier) mismatches.push(`authTier ${m.authTier} != ${expectedAuthTier}`);
      if (m.slug !== expectedSlug) mismatches.push(`slug ${m.slug} != ${expectedSlug}`);
      if (!m.operatorName) mismatches.push('operator name is blank (the export persistence gate)');
      if (mismatches.length === 0) {
        checks.pass('MU-C1', 'the manifest carries the declared values and begin-interview was reachable (unclicked)', {
          mode: m.mode ?? '',
          authTier: m.authTier ?? '',
          slug: m.slug ?? '',
          operator: m.operatorName ?? '',
          role: m.operatorRole ?? '',
        });
      } else {
        checks.fail('MU-C1', `manifest check failed: ${mismatches.join('; ')}`);
      }
    } catch (err) {
      checks.fail('MU-C1', `could not read ${MUSTER_CONNECT_FACTS}: ${message(err)}`);
    }
  }

  await judgeMusterAutoAnalysis(ctx, checks);
  await judgeMusterConsent(ctx, checks);
  await judgeMusterAdaptive(ctx, checks);
  await judgeMusterSprs(ctx, checks);
};

export const JUDGES: Readonly<Record<string, Judge>> = {
  'muster-readiness': judgeMusterReadiness,
  'muster-gui': judgeMusterGui,
  'simstack-create': judgeSimstackCreate,
  'simstack-destroy': judgeSimstackDestroy,
  'ao-registry': judgeAoRegistry,
  'ao-make-change': judgeAoMakeChange,
  'eo-review': judgeEoReview,
  'eo-verify-evidence': judgeEoVerifyEvidence,
  'eo-show-change-captured': judgeEoShowChangeCaptured,
  stamper: judgeStamper,
};

/**
 * Some evidence only exists BETWEEN slides. EO's post-warm hydration and
 * Stamper's post-translate `#outputPath` are both destroyed or made ambiguous by
 * the slide that follows, so they are sampled the moment they are true.
 */
export type SlideProbe = (
  index: number,
  ctx: {
    readonly pane: AppPane;
    readonly backstage: AppPane | undefined;
    readonly armed: ArmedEnvironment | undefined;
  },
) => Promise<Record<string, unknown>>;

export const SLIDE_PROBES: Readonly<Record<string, SlideProbe>> = {
  'eo-review': async (index, { pane }) =>
    index === 0 ? { hydratedAfterWarm: await hasRenderedAssessment(pane.page) } : {},
  // D.16 — capture the BEFORE straight after the warm assess (slide 0), before
  // the remediator (slide 1) runs, while it is provably still true. The op reads
  // and registers this file; the probe only writes it (a probe has no
  // ctx.artifact). `/api/assessment` is a stored snapshot, so this is the last
  // moment the pre-remediation numbers are guaranteed on disk.
  'eo-show-change-captured': async (index, { armed }) => {
    if (index !== 0 || !armed?.eoBaseUrl) return {};
    const [assessment, sprs] = await Promise.all([
      fetchJson(eoTenantUrl(armed.eoBaseUrl, '/api/assessment', armed.slug)).catch(() => undefined),
      fetchJson(eoTenantUrl(armed.eoBaseUrl, '/api/sprs', armed.slug)).catch(() => undefined),
    ]);
    const before = { assessment, sprs, capturedAt: new Date().toISOString() };
    fs.writeFileSync(path.join(armed.runDir, 'eo-before.json'), JSON.stringify(before, null, 2));
    const nums = readEoNumbers(assessment, sprs);
    return { eoBeforeCaptured: true, eoBeforeSprs: nums.sprsScore ?? null };
  },
  stamper: async (index, { backstage }) =>
    index === 0 && backstage
      ? { preconditions: await readExecutePreconditions(backstage.page) }
      : {},
};

/**
 * Artifact paths in a finished report are relative to `testerRoot` with POSIX
 * separators (absolute only when they escape the root). Resolving through this
 * makes "reached the finished report" and "exists on disk" the same read.
 */
export function resolveArtifact(testerRoot: string, recorded: string): string {
  return path.isAbsolute(recorded) ? recorded : path.join(testerRoot, recorded);
}

export function reportArtifacts(report: ShowReport): string[] {
  return report.ops.flatMap((op) => [...op.artifacts]);
}

/* ------------------------------------------------------------- the group run */

export async function runActGroup(
  group: ActGroup,
  args: ActRunArgs,
  log: (line: string) => void,
  deps: ActRunDeps = {},
): Promise<ActGroupReport> {
  const now = deps.now ?? (() => Date.now());
  const probe = deps.probe ?? probePort;
  const fileExists = deps.fileExists ?? ((p: string) => fs.existsSync(p));

  const logs: string[] = [];
  const record = (line: string): void => {
    logs.push(line);
    log(`    ${line}`);
  };

  const checks = makeChecks(group.id);
  const deck = syntheticDeck(group, args.testerRoot);
  const options = showOptionsFor(args, deck);
  const measurements: OpMeasurement[] = [];

  // Ports must be free BEFORE arming, not only after teardown: a port left
  // occupied by an earlier group turns one honest failure into a cascade of
  // environment failures that all look like act-reds.
  for (const port of group.expectedPorts) {
    if ((await probe(port)) === 'occupied') {
      checks.skip(
        'ARM1',
        `port ${port} was already occupied before arming — refusing to arm over it`,
        'environment',
      );
      return {
        groupId: group.id,
        status: 'skipped',
        opIds: [...group.opIds],
        expectedPorts: [...group.expectedPorts],
        armedPorts: [],
        armMs: null,
        ops: [],
        artifacts: [],
        checks: checks.results,
        findings: checks.findings,
        portsFreeAfter: null,
        log: logs,
      };
    }
  }

  let armed: ArmedEnvironment | undefined;
  let backstage: AppPane | undefined;
  let paneNavigations = 0;
  let armMs: number | null = null;
  const snapshots: Record<string, unknown> = {};

  const pane = await (deps.openPane ?? defaultOpenPane)(true);
  const countingPane: AppPane = {
    ...pane,
    goto: async (url: string) => {
      paneNavigations += 1;
      // Truncated deliberately: an op that renders a readout navigates to a
      // base64 `data:` URL kilobytes long, and logging it whole would bury the
      // group report under the very artifact it is supposed to be indexing.
      record(`pane.goto(${url.length > 96 ? `${url.slice(0, 96)}… (${url.length} chars)` : url})`);
      return pane.goto(url);
    },
  };

  // Wrap each implementation so the harness can see `ctx.armed` and
  // `ctx.backstage` — neither is exposed by `ShowOpRunner`, and ARM1 / ST1 /
  // AO3 all need them.
  const base = { ...OP_IMPLEMENTATIONS, ...deps.implementations };
  const implementations: Partial<Record<DemoOpId, OpImplementation>> = {};
  for (const opId of group.opIds) {
    const real = base[opId];
    implementations[opId] = async (ctx) => {
      armed = ctx.armed;
      backstage = ctx.backstage;
      await real(ctx);
    };
  }

  const startedAtMs = now();
  const recorder = createShowReport(deck, options, startedAtMs, args.runId);
  const ops = makeShowOps(countingPane, deck, options, {
    implementations,
    ...(deps.arm ? { arm: deps.arm } : {}),
    log: record,
  });

  let report: ShowReport | undefined;
  try {
    const armStart = now();
    await ops.prepare?.();
    armMs = now() - armStart;
    record(`armed in ${armMs} ms`);

    for (const [index, slide] of deck.slides.entries()) {
      recorder.slideEntered(index, now());
      recorder.opStarted(index, slide, now());
      const opStart = now();
      let status: 'done' | 'failed' = 'done';
      let error: string | undefined;
      try {
        await ops.run({
          pane: countingPane,
          slide,
          index,
          options,
          log: record,
          artifact: (absPath) => recorder.opArtifact(index, absPath),
        });
      } catch (err) {
        status = 'failed';
        error = err instanceof Error ? err.message : String(err);
        record(`op ${slide.op.opId} (${slide.op.mode}) FAILED: ${error}`);
      }
      const ms = now() - opStart;
      recorder.opFinished(index, now(), status, error);
      measurements.push({
        index,
        opId: slide.op.opId ?? '?',
        mode: slide.op.mode,
        ms,
        status,
        ...(error ? { error } : {}),
      });
      record(`op ${slide.op.opId} (${slide.op.mode}) ${status} in ${ms} ms`);

      // Sampled here, not at the end: the slide that follows destroys or makes
      // ambiguous the very facts EO1 and ST2 are about.
      const probeFn = deps.slideProbes?.[group.id] ?? SLIDE_PROBES[group.id];
      if (probeFn) {
        try {
          Object.assign(snapshots, await probeFn(index, { pane, backstage, armed }));
        } catch (err) {
          record(`slide probe after ${index} failed: ${message(err)}`);
        }
      }
    }

    report = recorder.finish(now(), 'end-of-deck');

    // ARM1 — the armed set equals the group's declaration.
    const actual = {
      withAoGui: armed?.aoBaseUrl !== undefined,
      withEo: armed?.eoBaseUrl !== undefined,
      withStamperGui: armed?.stamperBaseUrl !== undefined,
      withMuster: armed?.musterBaseUrl !== undefined,
    };
    if (!armed) {
      checks.skip('ARM1', 'no op ran, so no armed environment was observed', 'harness-defect');
    } else if (
      actual.withAoGui === group.expectedArming.withAoGui &&
      actual.withEo === group.expectedArming.withEo &&
      actual.withStamperGui === group.expectedArming.withStamperGui &&
      actual.withMuster === group.expectedArming.withMuster
    ) {
      checks.pass('ARM1', `armed exactly what the group declares`, {
        withAoGui: actual.withAoGui,
        withEo: actual.withEo,
        withStamperGui: actual.withStamperGui,
        withMuster: actual.withMuster,
      });
    } else {
      checks.fail(
        'ARM1',
        `arming does not match the declaration: expected ${JSON.stringify(group.expectedArming)}, observed ${JSON.stringify(actual)}`,
        'harness-defect',
      );
    }

    const judge = JUDGES[group.id];
    if (!judge) {
      checks.skip(
        'JUDGE',
        `no judge is registered for act group "${group.id}"`,
        'harness-defect',
      );
    } else {
      await judge(
        {
          group,
          args,
          armed,
          pane,
          backstage,
          report,
          logs,
          ops: measurements,
          paneNavigations,
          fileExists,
          options,
          snapshots,
        },
        checks,
      );
    }
  } finally {
    // Unconditional: a stranded 4390 poisons every later group and turns one
    // honest act-red into a cascade of false environment failures.
    await ops.dispose?.().catch((err: unknown) => {
      record(`dispose failed: ${err instanceof Error ? err.message : String(err)}`);
    });
    await pane.close().catch(() => undefined);
  }

  // TD1 — after teardown, every port the group armed is free again.
  const busy: number[] = [];
  for (const port of group.expectedPorts) {
    if ((await probe(port)) !== 'free') busy.push(port);
  }
  if (busy.length === 0) {
    checks.pass('TD1', `ports free after teardown: ${group.expectedPorts.join(', ')}`);
  } else {
    checks.fail('TD1', `still occupied after teardown: ${busy.join(', ')}`, 'act-red');
  }

  const artifacts = report ? reportArtifacts(report) : [];
  const failed = checks.results.some((c) => c.status === 'fail');
  const skippedDefect = checks.findings.some((f) => f.failureClass === 'harness-defect');

  return {
    groupId: group.id,
    status: failed || skippedDefect ? 'failed' : 'pass',
    opIds: [...group.opIds],
    expectedPorts: [...group.expectedPorts],
    armedPorts: armedPortsOf(armed, group),
    armMs,
    ops: measurements,
    artifacts,
    checks: checks.results,
    findings: checks.findings,
    portsFreeAfter: busy.length === 0,
    log: logs,
  };
}

function armedPortsOf(armed: ArmedEnvironment | undefined, group: ActGroup): number[] {
  if (!armed) return [];
  const ports: number[] = [group.expectedPorts[0]];
  for (const url of [armed.aoBaseUrl, armed.eoBaseUrl, armed.stamperBaseUrl, armed.musterBaseUrl]) {
    if (!url) continue;
    const port = Number(new URL(url).port);
    if (Number.isFinite(port) && port > 0) ports.push(port);
  }
  return ports;
}

async function defaultOpenPane(headless: boolean): Promise<AppPane> {
  return openAppPane({ geometry: BACKSTAGE_GEOMETRY, headless });
}

/* ------------------------------------------------- the entry the CLI imports */

export async function runActGroups(
  groupIds: readonly string[],
  args: ActRunArgs,
  log: (line: string) => void,
  deps: ActRunDeps = {},
): Promise<readonly ActGroupReport[]> {
  const groups = groupIds.map((id) => {
    const found = actGroup(id);
    if (!found) {
      throw new Error(
        `unknown act group "${id}" — this roster carries ${ACT_GROUPS.map((g) => g.id).join(', ')}`,
      );
    }
    return found;
  });

  // The operator prerequisite, probed BEFORE arming anything. Absent, the
  // muster op self-gates to "evaluation unavailable" and MR1 fails for an
  // environmental reason — so this exits 2 (could not run) naming the remedy,
  // rather than reporting a working act as broken.
  const exists = deps.fileExists ?? ((p: string) => fs.existsSync(p));
  if (groups.some((g) => g.opIds.includes('muster-readiness') || g.opIds.includes('muster-auto-analysis'))) {
    const cli = path.join(args.musterRoot, MUSTER_CLI_RELATIVE);
    if (!exists(cli)) {
      throw new Error(
        `the muster CLI is not built: ${cli} does not exist. Run \`npm run build\` in ces-muster — ces-tester never builds a sibling.`,
      );
    }
  }
  // Same operator prerequisite for the Muster GUI acts: the Vite preview serves a
  // prebuilt `dist/`. Absent, arming would fail mid-prep; exit 2 naming the remedy.
  if (groups.some((g) => g.opIds.includes('muster-connect-tenant'))) {
    const dist = musterDistIndex(args.musterRoot);
    if (!exists(dist)) {
      throw new Error(
        `the ces-muster SPA is not built: ${dist} does not exist. Run \`npm run build\` in ces-muster — ces-tester never builds a sibling.`,
      );
    }
  }

  const reports: ActGroupReport[] = [];
  for (const group of groups) {
    log(`  act group ${group.id} (${group.dossierEntries.join(', ')})`);
    const report = await runActGroup(group, args, log, deps);
    reports.push(report);
    await writeGroupReport(
      report,
      path.join(args.testerRoot, 'runs', 'acts-test', args.runId, `${group.id}.json`),
    );
    log(`  act group ${group.id}: ${report.status}`);
  }
  return reports;
}
