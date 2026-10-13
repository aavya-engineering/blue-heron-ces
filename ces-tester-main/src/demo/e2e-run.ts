// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-3 M5 — `demo:e2e`: the single end-to-end entry point, Beats 0-5.
 *
 * The founder's mandate is that Playwright drives all four legs from the user's
 * perspective: the Muster wizard (ces-planner SPA), the Stamper GUI, the EO SPA
 * and the AdminOps GUI. CLI/API surfaces remain permitted only for INVISIBLE
 * setup outside the demo frame (seeding the sim, spawning a server, arming an
 * env) — never as the demo surface for a beat.
 *
 * ## Beat order is load-bearing (FD-3)
 *
 * The AO beat runs LAST, after the discovery gate AND after the EO "after"
 * assess, because A-18 mutates `authorizationPolicy` — the very object discovery
 * probe P8 reads. Running it earlier would contaminate both the ground-truth
 * diff and the before/after comparison. Do not reorder.
 *
 * ## What this module may and may not claim
 *
 * - The AO beat's honest claim is **"evidence of the change was auto-collected"**.
 *   It must NEVER narrate pre/post-state capture: AO's own pre/post reads
 *   hardcode `dryRun=true`, so those fields are stub strings even on a live,
 *   state-changing apply (finding #6b, REQ-AO-GETTHENSET-PRESTATE-IS-STUB).
 * - Discovery is **presence-based**. It does not "find the MFA gap" — on
 *   demo-dib-small `IA.L2-3.5.3` reads `met` before any remediation, because the
 *   MFA CA policy exists but is report-only and DISCOVERY-1 is presence-blind
 *   (`REQ-MUSTER-DISCOVERY-STATE-BLINDNESS`). Gap DEPTH is EO's story, not
 *   discovery's. The beat labels here say so.
 * - Never render a partial as clean (GP-DEMO-1 house rule). Every predicate
 *   clause is printed with its own status and reason; a failing or unverified
 *   clause makes the exit code non-zero.
 *
 * ## Predicate 5 is CALIBRATION-PENDING by design
 *
 * `PLAN-E2E-AO-DEMO.md` predicate 5 carries an M0 FLAG: the GUI leg's live
 * execute failed 30/110 where the CLI leg failed 10/110 on the byte-identical
 * plan, and M2 proved the CLI-derived `KNOWN_FALSE_FAILS` registry is
 * DRIVE-MODE-DEPENDENT (4 CLI known-fails PASSED on the GUI leg). So the GUI leg
 * needs its OWN known set, calibrated from the first post-seed live execute.
 * Until `guiKnownFalseFails` is supplied, this run RECORDS the post-seed failure
 * taxonomy to `runs/e2e/<runId>/stamper-failure-taxonomy.json` and reports
 * clause 5 as `calibrating` — which still exits non-zero unless `--calibrate`
 * is passed, and `--calibrate` accepts the recording for THAT CLAUSE ONLY.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import { runPreflight, type ModuleBuild, type PortSpec } from './preflight.js';
import {
  resolveExpectedDiscovery,
  resolveAfterTruth,
  afterTruthProvenance,
  type E2eConfigEntry,
  type DiscoveryPosture,
  type GroundTruthProvenance,
} from './e2e-configs.js';
import { diffPostures, loadEvalConfigFile, type PostureMismatch } from './eval-run.js';
import { resetDemoDibSmallTenant, DEMO_MFA_CONTROL_ID } from './needle-run.js';
import { runScenario } from '../stacksim-client/cli.js';
import { startServe, type ServeHandle } from '../stacksim-client/serve-lifecycle.js';
import { waitUntilReady } from '../stacksim-client/ready-check.js';
import { queryLedger, DEFAULT_STACKSIM_SERVER_URL } from '../stacksim-client/http.js';
import type { TenantStance } from '../stacksim-client/types.js';
import { startDevServer, waitForDevServerReady, devServerBaseUrl, type DevServerHandle } from '../muster-driver/dev-server.js';
import { driveMuster } from '../muster-driver/drive-muster.js';
import { CLEAN_TENANT_MFA_BASELINE_ANSWER_MAP } from '../muster-driver/answer-map.js';
import { createTenantRegistry, createEphemeralSimTenant, getSimLaunchEnv } from '../tenant-registry/index.js';
import { authorSimTenantRecord, simRecordPath } from './sim-tenant-record.js';
import { ensureSimCert, type SimCertResult } from './stamper-prereqs.js';
import {
  buildGuiChildEnv,
  startStamperGui,
  STAMPER_GUI_PORT,
  AO_GUI_PORT,
  type GuiServerHandle,
} from './gui-servers.js';
import { driveStamperUi, type ExecutionReportSummary, type StamperUiDriveResult } from './stamper-ui-driver.js';
import { driveEoUi, type EoUiDriveResult } from './eo-ui-driver.js';
import { createAoUiDriver } from './ao-ui-driver.js';
import { runAoLeg, AO_DEMO_COMMAND_ID, type AoLegResult } from './ao-leg.js';
import { buildEoChildEnv, mapControlDetail, type EoAssessSummary, type EoControlDetail } from './eo-leg.js';
import { eoTenantUrl } from './eo-tenant-url.js';
import { partitionFailures } from './known-false-fails.js';
import { HEADLESS_MODE, type WatchMode } from './watch-mode.js';
import { writeUnifiedDashboard, type UnifiedDemoResult } from '../results/unified-dashboard.js';

/* ------------------------------------------------------------------ *
 * Beat plan
 * ------------------------------------------------------------------ */

export interface E2eBeat {
  readonly id: number;
  readonly label: string;
}

/**
 * The six narrative beats, in execution order. Beat 5 (AO) is the new one;
 * Beats 0-4 restate the proven `demo:run` spine with the discovery gate folded
 * into Beat 1. FD-3's ordering constraint is encoded here and nowhere else.
 */
export const E2E_BEATS: readonly E2eBeat[] = [
  { id: 0, label: 'pre-flight + gates -> reset/seed the tenant -> stacksim serve :4390' },
  { id: 1, label: 'posture discovery read (presence-based) vs pinned ground truth, read-only -> EO live assess (before)' },
  { id: 2, label: 'Muster wizard (Playwright) -> Mission Plan + Tenant Manifest' },
  { id: 3, label: 'Stamper GUI (Playwright): Connect -> Assess -> Translate -> live Execute' },
  { id: 4, label: 'EO SPA (Playwright) re-assess (after) -> unified before->after dashboard' },
  { id: 5, label: 'AdminOps GUI (Playwright): A-18 live -> evidence of the change was auto-collected' },
];

/**
 * The whole beat plan with a position marker per line. Restated at the start of
 * a run and at every beat transition (founder requirement: minimal screen noise,
 * but always knowable where in the plan the run is). Pure.
 */
export function renderBeatPlan(currentBeatId?: number): string[] {
  return E2E_BEATS.map((b) => {
    const marker =
      currentBeatId === undefined ? '[ ]' : b.id < currentBeatId ? '[x]' : b.id === currentBeatId ? '[>]' : '[ ]';
    return `  ${marker} Beat ${b.id}  ${b.label}`;
  });
}

/* ------------------------------------------------------------------ *
 * Success predicate — pure, and the only thing that decides the exit code
 * ------------------------------------------------------------------ */

/**
 * `n/a` is a first-class outcome (FD-4: a config with no proven remediation path
 * reports the Stamper beat `n/a`, never silently skipped). `calibrating` means
 * the clause could not be judged because its ground truth does not exist yet —
 * it is recorded, printed, and still non-zero unless explicitly accepted.
 */
export type PredicateStatus = 'pass' | 'fail' | 'n/a' | 'calibrating';

export interface PredicateClause {
  readonly id: number;
  readonly name: string;
  readonly status: PredicateStatus;
  /** Always populated — a clause never passes or fails without a stated reason. */
  readonly detail: string;
}

export interface E2ePreflightFacts {
  readonly ok: boolean;
  readonly issues: readonly string[];
}

export interface E2eSeedFacts {
  readonly seeded: boolean;
  readonly serveReady: boolean;
  readonly error?: string;
}

export interface E2eDiscoveryFacts {
  readonly ran: boolean;
  /** Zero stacksim `create` + `mutate` ledger entries during the walk. */
  readonly readOnly: boolean;
  readonly ledgerWriteDelta: number;
  readonly mismatches: readonly PostureMismatch[];
  readonly observationCount: number;
  readonly resultPath?: string;
  readonly error?: string;
}

/**
 * The post-remediation discovery re-read (clause 10): the SAME presence-based
 * walk clause 3 runs, re-executed after the Stamper leg, diffed against the
 * config's `afterTruth`.
 *
 * `applicable` is knowable synchronously (`fullChain && afterTruth !== undefined`)
 * and is set at INITIALIZATION — so a run that aborts before the re-read still
 * fails clause 10 loudly for an after-truth-carrying config, instead of decaying
 * into a clean-looking `n/a`. Only a genuinely after-truth-less config reports
 * `n/a` (`applicable:false`), the honest "not judged", never a fabricated pass.
 */
export interface E2ePostRemediationFacts {
  readonly applicable: boolean;
  readonly ran: boolean;
  /** Zero stacksim `create` + `mutate` ledger entries during the re-read walk. */
  readonly readOnly: boolean;
  readonly ledgerWriteDelta: number;
  readonly mismatches: readonly PostureMismatch[];
  readonly observationCount: number;
  readonly resultPath?: string;
  /**
   * Provenance of the after-truth this re-read is judged against
   * (`afterTruthProvenance`). `'authored-contract'` ⇒ the map has not been
   * reproduced on this config's own seed path, so clause 10 reports `calibrating`
   * (a clean pass is never staked on an unverified contract); `'live-adjudicated'`
   * or `undefined` ⇒ clause 10 is judged `pass`/`fail` normally. */
  readonly provenance?: GroundTruthProvenance;
  readonly error?: string;
}

export interface E2eMusterFacts {
  readonly missionPlanPath?: string;
  readonly manifestPath?: string;
  readonly error?: string;
}

export interface E2eStamperFacts {
  readonly ran: boolean;
  /** NARRATIVE ONLY — M0 measured `Complete` on a `partial` report. */
  readonly executeBadge?: string;
  readonly report?: ExecutionReportSummary;
  readonly ledgerSnapshotPath?: string;
  /**
   * The GUI leg's calibrated known-false-FAIL set. `undefined` ⇒ no such set
   * exists yet, so clause 5 CALIBRATES instead of judging. `[]` ⇒ calibrated
   * and expected clean.
   */
  readonly knownFalseFails?: readonly string[];
  readonly taxonomyPath?: string;
  readonly error?: string;
}

export interface E2eEoBeatFacts {
  /** `liveAssessmentCount > 0` — 0 means the live signal leg crashed. */
  readonly live: boolean;
  readonly liveAssessmentCount?: number;
  readonly controlsMet?: number;
  readonly controlsTotal?: number;
  readonly sprsScore?: number;
  readonly snapshotId?: string;
  readonly mfaControl?: EoControlDetail;
  readonly error?: string;
}

export interface E2eEoFacts {
  readonly before: E2eEoBeatFacts;
  readonly after: E2eEoBeatFacts;
}

export interface E2eDashboardFacts {
  readonly path?: string;
  readonly beatIds: readonly number[];
  readonly error?: string;
}

export type GateStatus = 'pass' | 'fail' | 'skipped';

export interface E2eGateFacts {
  readonly typecheck: GateStatus;
  readonly tests: GateStatus;
  readonly detail?: string;
}

export interface E2ePredicateFacts {
  readonly configId: string;
  /** FD-4: false ⇒ the Muster/Stamper beats have no proven path for this config. */
  readonly fullChain: boolean;
  /** `--calibrate`: accept a RECORDED clause-5 taxonomy as success — clause 5 only. */
  readonly calibrateAccepted: boolean;
  readonly preflight: E2ePreflightFacts;
  readonly seed: E2eSeedFacts;
  readonly discovery: E2eDiscoveryFacts;
  /** clause 10 — the post-remediation Muster re-read (afterTruth diff). */
  readonly postRemediation: E2ePostRemediationFacts;
  readonly muster: E2eMusterFacts;
  readonly stamper: E2eStamperFacts;
  readonly eo: E2eEoFacts;
  readonly ao: AoLegResult;
  readonly dashboard: E2eDashboardFacts;
  readonly gates: E2eGateFacts;
}

export interface E2ePredicateVerdict {
  readonly clauses: readonly PredicateClause[];
  /** Exit 0 iff true. */
  readonly satisfied: boolean;
  /** Clause ids reported `calibrating` — recorded, never rendered as clean. */
  readonly calibrating: readonly number[];
  readonly failures: readonly string[];
}

function clause(id: number, name: string, status: PredicateStatus, detail: string): PredicateClause {
  return { id, name, status, detail };
}

function gateWord(s: GateStatus): string {
  return s === 'pass' ? 'clean' : s === 'fail' ? 'FAILED' : 'not run';
}

/**
 * The AMENDED success predicate of `docs/demo/PLAN-E2E-AO-DEMO.md` — the nine
 * original clauses plus GP-DEMO-3's clause 10 (post-remediation Muster re-read),
 * with the M0 corrections applied (clause 7's judges live in `ao-evidence.ts`'s
 * `evaluateAoEvidence`; clause 5 carries the M0 FLAG).
 *
 * Pure: the run assembles facts, this decides. Exit 0 iff every clause is
 * `pass`, `n/a`, or an ACCEPTED `calibrating`.
 */
export function evaluateE2ePredicate(facts: E2ePredicateFacts): E2ePredicateVerdict {
  const clauses: PredicateClause[] = [];

  // 1 — Pre-flight: all builds fresh, all ports free.
  clauses.push(
    facts.preflight.ok
      ? clause(1, 'pre-flight', 'pass', 'all builds fresh, all ports free')
      : clause(1, 'pre-flight', 'fail', facts.preflight.issues.join('; ') || 'pre-flight not ready'),
  );

  // 2 — Seed: tenant materialized, serve ready.
  clauses.push(
    facts.seed.seeded && facts.seed.serveReady
      ? clause(2, 'seed + serve', 'pass', 'tenant materialized, stacksim serve ready')
      : clause(
          2,
          'seed + serve',
          'fail',
          facts.seed.error ?? `seeded=${facts.seed.seeded} serveReady=${facts.seed.serveReady}`,
        ),
  );

  // 3 — Ground truth: every probe matches, and the walk wrote nothing.
  if (!facts.discovery.ran) {
    clauses.push(clause(3, 'discovery ground truth', 'fail', facts.discovery.error ?? 'discovery read did not run'));
  } else {
    const problems: string[] = [];
    if (!facts.discovery.readOnly) {
      problems.push(`discovery walk was not read-only (ledger create+mutate delta ${facts.discovery.ledgerWriteDelta})`);
    }
    for (const m of facts.discovery.mismatches) {
      problems.push(`${m.control}: expected ${m.expected}, got ${m.actual}`);
    }
    clauses.push(
      problems.length === 0
        ? clause(
            3,
            'discovery ground truth',
            'pass',
            `every probe matched (${facts.discovery.observationCount} observations), read-only proved`,
          )
        : clause(3, 'discovery ground truth', 'fail', problems.join('; ')),
    );
  }

  // 4 — Muster wizard artifacts (n/a for configs with no proven chain).
  if (!facts.fullChain) {
    clauses.push(clause(4, 'Muster wizard artifacts', 'n/a', `config '${facts.configId}' has no proven wizard answer map (FD-4)`));
  } else if (facts.muster.missionPlanPath && facts.muster.manifestPath) {
    clauses.push(clause(4, 'Muster wizard artifacts', 'pass', `mission plan + tenant manifest produced (${facts.muster.missionPlanPath})`));
  } else {
    clauses.push(clause(4, 'Muster wizard artifacts', 'fail', facts.muster.error ?? 'mission plan / tenant manifest not produced'));
  }

  // 5 — Stamper execute. [M0 FLAG] Judged against the GUI leg's OWN known set;
  //     until that set exists the clause CALIBRATES rather than pretending.
  if (!facts.fullChain) {
    clauses.push(clause(5, 'Stamper execute', 'n/a', `config '${facts.configId}' has no proven remediation path (FD-4) — beat reported n/a, not skipped`));
  } else if (!facts.stamper.ran || !facts.stamper.report) {
    clauses.push(clause(5, 'Stamper execute', 'fail', facts.stamper.error ?? 'Stamper GUI execute did not produce an execution report'));
  } else if (!facts.stamper.ledgerSnapshotPath) {
    clauses.push(clause(5, 'Stamper execute', 'fail', 'no ledger snapshot written — the run cannot evidence what was applied'));
  } else if (facts.stamper.knownFalseFails === undefined) {
    const n = facts.stamper.report.failureIds.length;
    clauses.push(
      clause(
        5,
        'Stamper execute',
        'calibrating',
        `no calibrated GUI-leg known-false-FAIL set exists yet (KNOWN_FALSE_FAILS is drive-mode-dependent — M2-ENTRY-FINDINGS); ` +
          `recorded ${n} failure id(s) of ${facts.stamper.report.totalTasks ?? '?'} task(s) to ${facts.stamper.taxonomyPath ?? '(taxonomy not written)'}`,
      ),
    );
  } else {
    const known = new Set(facts.stamper.knownFalseFails);
    const unexpected = facts.stamper.report.failureIds.filter((id) => !known.has(id)).sort();
    clauses.push(
      unexpected.length === 0
        ? clause(
            5,
            'Stamper execute',
            'pass',
            `${facts.stamper.report.completedTasks ?? '?'}/${facts.stamper.report.totalTasks ?? '?'} tasks completed; ` +
              `${facts.stamper.report.failureIds.length} failure(s), all inside the calibrated GUI-leg known set; ledger snapshot written`,
          )
        : clause(5, 'Stamper execute', 'fail', `${unexpected.length} unexpected failure(s): ${unexpected.slice(0, 6).join(', ')}${unexpected.length > 6 ? ', …' : ''}`),
    );
  }

  // 6 — EO before AND after live, and no regression.
  const b = facts.eo.before;
  const a = facts.eo.after;
  if (!b.live || !a.live) {
    clauses.push(
      clause(
        6,
        'EO before/after live',
        'fail',
        !b.live
          ? `EO before not live (${b.error ?? `liveAssessmentCount=${b.liveAssessmentCount ?? 0}`})`
          : `EO after not live (${a.error ?? `liveAssessmentCount=${a.liveAssessmentCount ?? 0}`})`,
      ),
    );
  } else if ((a.controlsMet ?? 0) < (b.controlsMet ?? 0)) {
    clauses.push(clause(6, 'EO before/after live', 'fail', `REGRESSION: ${a.controlsMet} met after vs ${b.controlsMet} before — never shown`));
  } else {
    clauses.push(
      clause(
        6,
        'EO before/after live',
        'pass',
        `before ${b.controlsMet}/${b.controlsTotal ?? '?'} met (${b.liveAssessmentCount} live), after ${a.controlsMet}/${a.controlsTotal ?? '?'} met (${a.liveAssessmentCount} live)`,
      ),
    );
  }

  // 7 — AO evidence. `evaluateAoEvidence` IS this clause (amended by M0):
  //     row-count delta + stateChanged + commandExecuted + sha256Hash + a
  //     `type === 'mutate'` ledger entry. Never pre/post-state (stubs).
  if (!facts.ao.available) {
    clauses.push(clause(7, 'AO evidence auto-collected', 'fail', facts.ao.error ?? 'AO leg unavailable'));
  } else if (facts.ao.verdict?.satisfied) {
    const v = facts.ao.verdict;
    clauses.push(
      clause(
        7,
        'AO evidence auto-collected',
        'pass',
        `+${v.rowCountDelta} adminops_evidence row(s) for ${facts.ao.tenantId}, stateChanged=true, commandExecuted + sha256Hash present, +${v.ledgerMutationDelta} ledger mutate entr(y/ies)`,
      ),
    );
  } else {
    clauses.push(
      clause(7, 'AO evidence auto-collected', 'fail', facts.ao.verdict ? facts.ao.verdict.failures.join('; ') : (facts.ao.error ?? 'no AO evidence verdict')),
    );
  }

  // 8 — Unified dashboard rendered WITH Beat 5 present.
  if (!facts.dashboard.path) {
    clauses.push(clause(8, 'unified dashboard', 'fail', facts.dashboard.error ?? 'dashboard not rendered'));
  } else if (!facts.dashboard.beatIds.includes(5)) {
    clauses.push(clause(8, 'unified dashboard', 'fail', `dashboard rendered without Beat 5 (beats: ${facts.dashboard.beatIds.join(', ')})`));
  } else {
    clauses.push(clause(8, 'unified dashboard', 'pass', `${facts.dashboard.path} (Beat 5 present)`));
  }

  // 9 — Gates. `--skip-gates` does NOT excuse the clause (only --calibrate
  //     changes exit semantics, and only for clause 5).
  const gateDetail = `tsc --noEmit ${gateWord(facts.gates.typecheck)}; npm test ${gateWord(facts.gates.tests)}${facts.gates.detail ? ` — ${facts.gates.detail}` : ''}`;
  clauses.push(
    facts.gates.typecheck === 'pass' && facts.gates.tests === 'pass'
      ? clause(9, 'gates', 'pass', gateDetail)
      : clause(9, 'gates', 'fail', gateDetail),
  );

  // 10 — Post-remediation Muster re-read: the SAME presence-based discovery walk
  //     as clause 3, re-run AFTER the Stamper leg, must now match the config's
  //     after-truth. This is the ONLY clause that confirms the gap closed in
  //     Muster's own eyes (clauses 3/5/6 judge before-discovery, Stamper and EO,
  //     never a second discovery read). A config with no after-truth reports
  //     `n/a` — never a fabricated pass (`applicable` is set synchronously, so an
  //     aborted after-truth run FAILS here rather than decaying to n/a).
  //     Provenance-gated: an `authored-contract` after-truth (not yet reproduced
  //     on this config's own seed path) can NEVER stake a clean pass — it reports
  //     `calibrating`, which only --calibrate (the serial live phase) accepts. A
  //     `live-adjudicated` map is judged pass/fail. An aborted or ledger-writing
  //     (contaminated) re-read FAILS regardless of provenance.
  const pr = facts.postRemediation;
  if (!facts.fullChain || !pr.applicable) {
    clauses.push(
      clause(
        10,
        'post-remediation Muster re-read',
        'n/a',
        !facts.fullChain
          ? `config '${facts.configId}' has no proven remediation path (FD-4) — nothing to re-read`
          : `config '${facts.configId}' carries no after-truth — the post-remediation re-read is not judged (never fabricated pass)`,
      ),
    );
  } else if (!pr.ran) {
    // An aborted re-read is a loud FAIL, never `calibrating` — --calibrate must
    // not accept a measurement that never happened.
    clauses.push(clause(10, 'post-remediation Muster re-read', 'fail', pr.error ?? 'post-remediation discovery re-read did not run'));
  } else if (!pr.readOnly) {
    // A walk that wrote to the ledger produced CONTAMINATED observations. This is
    // a broken measurement invariant, not a task failure — it FAILS regardless of
    // provenance (calibrating on a contaminated read would be worthless).
    clauses.push(
      clause(
        10,
        'post-remediation Muster re-read',
        'fail',
        `re-read walk was not read-only (ledger create+mutate delta ${pr.ledgerWriteDelta})`,
      ),
    );
  } else if (pr.provenance === 'authored-contract') {
    // The after-truth is an AUTHORED CONTRACT, not yet reproduced on this config's
    // own seed path (`CalibratedDiscoveryGroundTruth.provenance`). A normal run
    // CANNOT stake a clean clause-10 pass on it — it reports `calibrating`
    // (recorded, never rendered clean), which only an explicit --calibrate run
    // (the serial live phase) accepts. The recorded match/mismatch is surfaced so
    // the live phase can confirm the contract before re-stamping it live.
    const detail =
      pr.mismatches.length === 0
        ? `judged against the AUTHORED CONTRACT after-truth (not yet live-calibrated): the recorded re-read matched every probe (${pr.observationCount} observations, read-only) — --calibrate accepts and re-stamps it live`
        : `judged against the AUTHORED CONTRACT after-truth (not yet live-calibrated): the recorded re-read diverges from the contract [${pr.mismatches
            .map((m) => `${m.control}: expected ${m.expected}, got ${m.actual}`)
            .join('; ')}] — the config is re-examined, not the number quietly changed (SPEC §4)`;
    clauses.push(clause(10, 'post-remediation Muster re-read', 'calibrating', detail));
  } else {
    // provenance 'live-adjudicated' (or undefined for a synthetic map): the map is
    // stakeable, so a mismatch is a real FAIL and a clean read is a real PASS.
    const problems = pr.mismatches.map((m) => `${m.control}: expected ${m.expected}, got ${m.actual}`);
    clauses.push(
      problems.length === 0
        ? clause(
            10,
            'post-remediation Muster re-read',
            'pass',
            `every probe matched the after-truth (${pr.observationCount} observations), read-only proved — the gap closed in Muster's own re-read`,
          )
        : clause(10, 'post-remediation Muster re-read', 'fail', problems.join('; ')),
    );
  }

  const calibrating = clauses.filter((c) => c.status === 'calibrating').map((c) => c.id);
  const failures = clauses
    .filter((c) => c.status === 'fail' || (c.status === 'calibrating' && !facts.calibrateAccepted))
    .map((c) => `clause ${c.id} (${c.name}): ${c.detail}`);
  const satisfied = clauses.every(
    (c) => c.status === 'pass' || c.status === 'n/a' || (c.status === 'calibrating' && facts.calibrateAccepted),
  );
  return { clauses, satisfied, calibrating, failures };
}

/* ------------------------------------------------------------------ *
 * Unified dashboard mapping (pure)
 * ------------------------------------------------------------------ */

export interface E2eBeatOutcome {
  readonly id: number;
  readonly label: string;
  readonly status: 'pass' | 'fail' | 'staged';
  readonly artifactRef?: string;
}

const SPRS_LABEL =
  "SPRS shown here is EO's control-detail score (a per-control signal rollup) — not the certified Muster headline SPRS (one-SPRS rule: Muster owns the headline).";

/**
 * Map an e2e run onto the unified before->after dashboard model. Pure, and
 * deliberately conservative: `after` numbers only appear when the after assess
 * genuinely ran live. Beat 5 (AO) is always present — clause 8 checks for it —
 * and its label carries the only claim the evidence supports.
 */
export function buildUnifiedFromE2e(
  facts: E2ePredicateFacts,
  beats: readonly E2eBeatOutcome[],
  generatedAt: string,
  tenant: string,
): UnifiedDemoResult {
  const b = facts.eo.before;
  const a = facts.eo.after;
  const metBefore = b.controlsMet ?? 0;
  const metAfter = a.live ? (a.controlsMet ?? metBefore) : metBefore;
  const total = a.controlsTotal ?? b.controlsTotal ?? 110;

  const findings: UnifiedDemoResult['findings'] = [];
  if (b.mfaControl || a.mfaControl) {
    findings.push({
      control: (a.mfaControl ?? b.mfaControl)!.controlId,
      title: 'Multifactor Authentication (report-only CA policy -> Stamper-enforced)',
      statusBefore: b.mfaControl?.status ?? 'not_assessed',
      statusAfter: a.mfaControl?.status ?? b.mfaControl?.status ?? 'not_assessed',
    });
  }

  const evidence: UnifiedDemoResult['evidence'] = [];
  if (b.snapshotId) evidence.push({ name: `eo-snapshot-before-${b.snapshotId}.json`, kind: 'EO assessment snapshot (before)' });
  if (a.snapshotId) evidence.push({ name: `eo-snapshot-after-${a.snapshotId}.json`, kind: 'EO assessment snapshot (after)' });
  if (facts.discovery.resultPath) {
    evidence.push({ name: facts.discovery.resultPath, kind: 'discovery readiness-result (read-only walk)' });
  }
  if (facts.postRemediation.applicable && facts.postRemediation.resultPath) {
    evidence.push({ name: facts.postRemediation.resultPath, kind: 'post-remediation discovery re-read (clause 10, read-only walk)' });
  }
  if (facts.stamper.ledgerSnapshotPath) {
    evidence.push({ name: facts.stamper.ledgerSnapshotPath, kind: 'stacksim ledger snapshot (real, Stamper-recorded)' });
  }
  if (facts.stamper.taxonomyPath) {
    evidence.push({ name: facts.stamper.taxonomyPath, kind: 'Stamper GUI-leg failure taxonomy (clause-5 calibration input)' });
  }
  // AO evidence entries — the row is the proof the change was auto-collected.
  for (const row of facts.ao.addedRows ?? []) {
    evidence.push({
      name: `adminops_evidence/${row.id}`,
      kind: `AO evidence row (${row.outcome ?? 'outcome unknown'}) — auto-collected on the live ${facts.ao.commandId} apply`,
      sha256: row.metadata.sha256Hash,
    });
  }

  return {
    tenant,
    generatedAt,
    sprsLabel: SPRS_LABEL,
    sprs: { before: b.sprsScore ?? 0, after: a.live ? (a.sprsScore ?? b.sprsScore ?? 0) : (b.sprsScore ?? 0), max: 110 },
    controls: { total, metBefore, metAfter },
    findings,
    evidence,
    beats: beats.map((x) => ({ id: x.id, label: x.label, status: x.status, artifactRef: x.artifactRef })),
  };
}

/* ------------------------------------------------------------------ *
 * Live helpers (spawns, HTTP) — invisible setup, never a demo surface
 * ------------------------------------------------------------------ */

/** `create` + `mutate` ledger entries — the read-only proof's counter. */
async function ledgerWriteCount(simUrl: string): Promise<number> {
  const [creates, mutates] = await Promise.all([
    queryLedger(simUrl, { type: 'create' }),
    queryLedger(simUrl, { type: 'mutate' }),
  ]);
  return creates.length + mutates.length;
}

interface SpawnCapture {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function spawnCapture(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, shell = false): Promise<SpawnCapture> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, shell });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (c: Buffer) => (stdout += c.toString('utf8')));
    child.stderr?.on('data', (c: Buffer) => (stderr += c.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }));
  });
}

/**
 * The known Windows libuv teardown assertion (`STATUS_STACK_BUFFER_OVERRUN`)
 * that fires AFTER a CLI has written and validated its artifact. GP-DEMO-2 ruled
 * it non-fatal and M2 reproduced it on both calibration cycles — judged
 * artifact-first here so M5 does not re-litigate it.
 */
export const WINDOWS_LIBUV_TEARDOWN_EXIT = 3221226505;

/** `$PSHOME\Modules` — mirrors `eo-leg.ts`'s private helper (see Deviations). */
function psHomeModules(): Promise<string> {
  return new Promise((resolve) => {
    const c = spawn('powershell.exe', ['-NoProfile', '-Command', 'Write-Output (Join-Path $PSHOME Modules)']);
    let o = '';
    c.stdout.on('data', (d: Buffer) => (o += d.toString('utf8')));
    c.on('close', () => resolve(o.trim()));
    c.on('error', () => resolve(''));
  });
}

interface EoServerHandle {
  readonly baseUrl: string;
  stop: () => void;
}

interface StartEoServerOptions {
  readonly eoRoot: string;
  readonly simRoot: string;
  readonly stamperRegistry: string;
  readonly tenantRoot: string;
  readonly storageRoot: string;
  /**
   * M7 (live): EO's `AssessmentStore` no longer persists under `STORAGE_ROOT` —
   * it writes to the unified repository at `{CES_PIPELINE_ROOT}/ces.db` (ces-eo
   * ADR-002). `loadLatest()` filters out only its OWN `eo_assessments:scope:<root>`
   * pointer record, so every pointer written by a DIFFERENT storage root (one per
   * prior EO run) reaches the `generatedAt.localeCompare` sort and throws — making
   * `GET /api/assessment` and `/api/sprs` a permanent 500 on the shared global DB
   * (REQ-EO-ASSESSMENT-SCOPE-POINTER-CRASH; the global `C:\CES_Pipeline\ces.db`
   * already holds dozens of such pointers). A run-scoped, PER-BEAT pipeline root
   * is therefore mandatory, not tidiness: one pointer per database. Sharing one
   * root across the two EO beats reintroduces the crash on the `after` beat.
   */
  readonly pipelineRoot: string;
  /** Server stdout+stderr; without it a sibling stack trace is unrecoverable. */
  readonly logPath: string;
  readonly slug: string;
  readonly simUrl: string;
  readonly port: number;
}

/**
 * Boot ces-eo out-of-process on a FIXED port so Playwright can drive its SPA —
 * the demo surface for Beats 1 and 4. `buildEoChildEnv` is reused VERBATIM from
 * `eo-leg.ts` (the plan's own risk-table instruction: do not re-derive the env
 * scrub — every casing of PSModulePath/Path must be stripped before the sim
 * shims are set, or assessment silently crashes to 0/110).
 */
async function startEoServer(opts: StartEoServerOptions): Promise<EoServerHandle> {
  fs.mkdirSync(opts.storageRoot, { recursive: true });
  const env = buildEoChildEnv(process.env, {
    simRoot: opts.simRoot,
    psModules: path.join(opts.simRoot, 'psmodules'),
    psHomeModules: await psHomeModules(),
    tenantRoot: opts.tenantRoot,
    stamperRegistry: opts.stamperRegistry,
    storageRoot: opts.storageRoot,
    slug: opts.slug,
    simUrl: opts.simUrl,
    port: opts.port,
  });
  env.CES_PIPELINE_ROOT = opts.pipelineRoot;
  fs.mkdirSync(opts.pipelineRoot, { recursive: true });
  fs.mkdirSync(path.dirname(opts.logPath), { recursive: true });
  const logFd = fs.openSync(opts.logPath, 'a');
  const child: ChildProcess = spawn('npx tsx src/eo/index.ts', {
    cwd: opts.eoRoot,
    env,
    shell: true,
    stdio: ['ignore', logFd, logFd],
  });
  const baseUrl = `http://127.0.0.1:${opts.port}`;
  const stop = (): void => {
    if (child.pid) {
      try {
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
      } catch {
        /* already gone */
      }
    }
    try {
      fs.closeSync(logFd);
    } catch {
      /* already closed */
    }
  };
  const healthy = async (): Promise<boolean> => {
    try {
      const r = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(2000) });
      return r.ok;
    } catch {
      return false;
    }
  };
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline && !(await healthy())) await new Promise((r) => setTimeout(r, 1000));
  if (!(await healthy())) {
    stop();
    throw new Error(`EO server did not become healthy on ${baseUrl} within 90s`);
  }
  return { baseUrl, stop };
}

/**
 * Map EO's `GET /api/assessment` snapshot onto the same summary shape the SSE
 * path produces. The snapshot is the API — the numbers never come from the DOM.
 * Pure.
 */
export function summarizeEoSnapshot(json: unknown): EoAssessSummary {
  const s = (json ?? {}) as Record<string, unknown>;
  const n = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
  return {
    snapshotId: typeof s.snapshotId === 'string' ? s.snapshotId : undefined,
    sprsScore: n(s.sprs_score),
    controlsMet: n(s.controls_met),
    controlsNotMet: n(s.controls_not_met),
    controlsPartial: n(s.controls_partial),
    controlsNotAssessed: n(s.controls_not_assessed),
    liveAssessmentCount: n(s.liveAssessmentCount),
  };
}

async function getJson(url: string, timeoutMs = 20_000): Promise<unknown> {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status}`);
  return r.json();
}

/* ------------------------------------------------------------------ *
 * Run options / result
 * ------------------------------------------------------------------ */

/**
 * The GUI leg's calibrated known-false-FAIL set — PINNED by GP-DEMO-3 M7 from
 * the first post-seed live execute (`runs/e2e/m7-run1b/stamper-failure-taxonomy.json`,
 * 91/110 completed, 19 failures).
 *
 * **Classified, never transcribed.** The taxonomy's 19 entries decomposed into
 * four classes and only two of them are pinned here:
 *
 * - **FIXED on our side, so NOT pinned (10 tasks).** Four variable names the
 *   plan needs and no producer supplies on this leg — `keyVaultName`,
 *   `mgmtSubnetCidr`, `operatorUserId`, `cuiGroupId` — are now seeded
 *   (`stamper-plan-variables.ts`). A missing seed is ces-tester's bug, not a
 *   known-false FAIL.
 * - **Verification class, PINNED (6).** Every one of these commands is recorded
 *   `set: PASS` with a confirmed store mutation + ledger entry in
 *   tenant-stacksim's OWN coverage report, yet fails Stamper's in-execute
 *   verification live. That is exactly the documented cause of
 *   REQ-STAMPER-ROTATING-VERIFY-FAIL (live-vs-isolated discrepancy, owned by
 *   GP-STAMPER-1) — the same cause the CLI registry's ten entries carry.
 * - **Capture-cascade class, PINNED (3).** `namedLocationId` (producer
 *   `AC.L2-3.1.12.named-location`) and `phishingResistantStrengthId` (producer
 *   `IA.L2-3.5.4.auth-strength`) never reach their consumers although both
 *   producer tasks COMPLETED — REQ-STAMPER-SUBCOMMAND-CAPTURES-NOT-RUN. These
 *   two are deliberately NOT seeded: the objects are created at runtime, so a
 *   seeded id could point at an object that does not exist.
 * - **Unclassifiable: none.** Anything without a demonstrated, sibling-owned
 *   cause stays out of this list and fails clause 5 loudly.
 *
 * Every id is entry-id or control-id shaped, i.e. survives re-translation; a raw
 * `step_task_*` id must never be pinned (its suffix is regenerated per run).
 * `[]` would mean "calibrated and expected clean".
 */
export const GUI_LEG_KNOWN_FALSE_FAILS: readonly string[] | undefined = [
  // --- verification class (REQ-STAMPER-ROTATING-VERIFY-FAIL; sim coverage says set:PASS) ---
  'IA.L2-3.5.9.tap-config', // "Evidence validation failed" — also in the CLI registry, identical error both legs
  'AZ-LOG-001', // Log Analytics workspace create — "Evidence validation failed"
  'AZ-LOG-002a', // storage-account managed identity — "Evidence validation failed"
  'AZ-SEN-001', // Sentinel onboarding (az rest PUT) — "Command exited with non-zero code"
  'AZ-SEN-010', // Sentinel analytics rule (Invoke-AzRestMethod PUT) — "Command exited with non-zero code"
  'AU.L2-3.3.3.sentinel-connector', // Office365 data connector PUT — "Command exited with non-zero code"
  // added from run m7-run2, which reached them for the first time; same cause,
  // same evidence (sim coverage: AZ-NET-002 ledger 98->100, AZ-NSG-003 109->111)
  'AZ-NET-002', // `snet-mgmt` subnet add — "Command exited with non-zero code"
  'AZ-NSG-003', // NSG rule — same error, reported in the same compound message
  // added from run m7-run4, reached for the first time once workloadSubnetCidr
  // resolved; sim coverage records all three as set:PASS
  'AZ-NET-003', // `snet-workload` subnet add
  'AZ-NET-004', // subnet/NSG association — same compound message as AZ-NET-003
  'AZ-NSG-002', // NSG rule — same compound message as AZ-NET-002
  // --- capture-cascade class (REQ-STAMPER-SUBCOMMAND-CAPTURES-NOT-RUN) ---
  'AC.L2-3.1.14', // consumes namedLocationId (+ cuiGroupId): producer completed, capture not propagated
  'SC.L2-3.13.7', // consumes namedLocationId (+ cuiGroupId)
  'AC.L2-3.1.15', // consumes phishingResistantStrengthId
  // from run m7-run2: `AZ-KV-002` needs `eoSpObjectId`, captured by `AZ-ID-003`
  // — an entry with an EMPTY `set_command`, so its capture never runs at all.
  // The object is created/owned at runtime, so seeding an id is not honest here.
  'AC.L1-3.1.1',
  // from run m7-run3: needs `lawWorkspaceId`, whose producer is `AZ-LOG-001` —
  // itself a pinned failure two rows above. A cascade of a pinned failure, and
  // the workspace is created at runtime, so again: pin, never seed.
  'CM.L2-3.4.1',
];

/** `runs/e2e/sim-cert.json` — the thumbprint carried between runs so the sim
 * cert is installed once, not regenerated every run. */
export const SIM_CERT_STATE_FILE = 'sim-cert.json';

export interface E2eRunOptions {
  readonly testerRoot: string;
  readonly stacksimRoot: string;
  /** ces-planner — the Muster wizard SPA (:5173). */
  readonly plannerRoot: string;
  readonly stamperRoot: string;
  readonly eoRoot: string;
  readonly aoRoot: string;
  /** ces-muster — the DISCOVERY-1 executor used by the Beat 1 read gate. */
  readonly musterRoot: string;
  readonly config: E2eConfigEntry;
  readonly runId: string;
  readonly watch?: WatchMode;
  /** `--calibrate` — accept a RECORDED clause-5 taxonomy as success (clause 5 only). */
  readonly calibrate?: boolean;
  /** `--skip-gates` — clause 9 then reports `not run`, which still FAILS. */
  readonly skipGates?: boolean;
  readonly preflightModules: readonly ModuleBuild[];
  readonly preflightPorts: readonly PortSpec[];
  /** Defaults to `GUI_LEG_KNOWN_FALSE_FAILS` (i.e. calibrate). */
  readonly guiKnownFalseFails?: readonly string[];
  readonly plannerPort?: number;
  readonly eoPort?: number;
  readonly stamperGuiPort?: number;
  readonly aoGuiPort?: number;
  readonly simUrl?: string;
  readonly log?: (line: string) => void;
}

export interface E2eRunResult {
  readonly runId: string;
  readonly configId: string;
  readonly slug: string;
  readonly fullChain: boolean;
  readonly runDir: string;
  readonly beats: readonly E2eBeatOutcome[];
  readonly facts: E2ePredicateFacts;
  readonly verdict: E2ePredicateVerdict;
  readonly exitCode: number;
}

const EMPTY_EO_BEAT: E2eEoBeatFacts = { live: false, error: 'beat did not run' };

/* ------------------------------------------------------------------ *
 * The run
 * ------------------------------------------------------------------ */

/**
 * Beats 0-5 end to end. Never throws: a genuine failure becomes an honest
 * partial with the reason on screen and a non-zero exit code.
 */
export async function runE2eDemo(opts: E2eRunOptions): Promise<E2eRunResult> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const watch = opts.watch ?? HEADLESS_MODE;
  const slug = opts.config.slug;
  const simUrl = opts.simUrl ?? DEFAULT_STACKSIM_SERVER_URL;
  const runDir = path.join(opts.testerRoot, 'runs', 'e2e', opts.runId);
  const screenshotDir = path.join(runDir, 'screenshots');
  const pipelineRoot = path.join(runDir, 'pipeline');
  const tenantRoot = path.join(runDir, 'tenant-root');
  const shimRoot = path.join(opts.testerRoot, 'assets', 'psmodules-shim');
  const stamperRegistry = path.resolve(opts.stamperRoot, 'src', 'registry', 'cmmc-l2-commands.registry.json');
  const generatedAt = new Date().toISOString();

  await fsp.mkdir(runDir, { recursive: true });
  await fsp.mkdir(screenshotDir, { recursive: true });
  await fsp.mkdir(pipelineRoot, { recursive: true });

  const beatStatus = new Map<number, E2eBeatOutcome>(
    E2E_BEATS.map((b) => [b.id, { id: b.id, label: b.label, status: 'staged' as const }]),
  );
  const setBeat = (id: number, status: E2eBeatOutcome['status'], suffix?: string, artifactRef?: string): void => {
    const base = E2E_BEATS.find((b) => b.id === id)!;
    beatStatus.set(id, { id, label: suffix ? `${base.label} — ${suffix}` : base.label, status, artifactRef });
  };

  const enterBeat = (id: number): void => {
    log('');
    log(`=== demo:e2e — Beat ${id} ===`);
    for (const line of renderBeatPlan(id)) log(line);
  };

  let preflight: E2ePreflightFacts = { ok: false, issues: ['pre-flight did not run'] };
  let gates: E2eGateFacts = { typecheck: 'skipped', tests: 'skipped', detail: 'gates not run' };
  let seed: E2eSeedFacts = { seeded: false, serveReady: false, error: 'seed did not run' };
  let discovery: E2eDiscoveryFacts = { ran: false, readOnly: false, ledgerWriteDelta: 0, mismatches: [], observationCount: 0, error: 'discovery did not run' };
  // Applicability is knowable synchronously — set it now so a run that aborts
  // before the re-read still FAILS clause 10 for an after-truth-carrying config
  // (never decays to a clean-looking n/a). Only an after-truth-less config gets
  // applicable:false (the honest "not judged").
  let postRemediation: E2ePostRemediationFacts = {
    applicable: opts.config.fullChain && opts.config.afterTruth !== undefined,
    ran: false,
    readOnly: false,
    ledgerWriteDelta: 0,
    mismatches: [],
    observationCount: 0,
    provenance: afterTruthProvenance(opts.config),
    error: 'post-remediation re-read did not run',
  };
  let muster: E2eMusterFacts = {};
  let stamper: E2eStamperFacts = { ran: false, knownFalseFails: opts.guiKnownFalseFails ?? GUI_LEG_KNOWN_FALSE_FAILS };
  let eoBefore: E2eEoBeatFacts = EMPTY_EO_BEAT;
  let eoAfter: E2eEoBeatFacts = EMPTY_EO_BEAT;
  let ao: AoLegResult = { available: false, executed: false, tenantId: `sim-tenant-${slug}`, commandId: opts.config.aoCommand, error: 'AO beat did not run' };
  let dashboard: E2eDashboardFacts = { beatIds: [], error: 'dashboard not rendered' };

  let serveHandle: ServeHandle | undefined;
  let devServer: DevServerHandle | undefined;
  let stamperGui: GuiServerHandle | undefined;
  let cert: SimCertResult | undefined;
  let simLaunchEnv: Awaited<ReturnType<typeof getSimLaunchEnv>> | undefined;

  log(`demo:e2e — config '${opts.config.id}' (slug ${slug}, fullChain=${opts.config.fullChain}), run ${opts.runId}`);
  log(`  ${opts.config.description}`);
  log(`  browser: ${watch.headless ? 'headless (default)' : 'HEADED (--watch)'} | evidence: ${runDir}`);
  log('');
  log('demo:e2e beat plan:');
  for (const line of renderBeatPlan()) log(line);

  const registry = createTenantRegistry({ registryRoot: tenantRoot, stacksimRoot: opts.stacksimRoot });
  const certStatePath = path.join(opts.testerRoot, 'runs', 'e2e', SIM_CERT_STATE_FILE);

  /**
   * Install the sim cert once per run and repair the registry record's two auth
   * fields. Attempted with a Stamper GUI base URL when one is already up, so the
   * founder-ruled FD-5(b) GUI-native import keeps being exercised (and keeps
   * evidencing REQ-STAMPER-PREREQ-ROUTES-KILL-OWN-CHILD) until the sibling bug
   * is fixed, at which point the ruled path resumes with no code change.
   */
  const ensureCertOnce = async (guiBaseUrl?: string): Promise<SimCertResult> => {
    if (cert) return cert;
    let knownThumbprint: string | undefined;
    try {
      knownThumbprint = (JSON.parse(await fsp.readFile(certStatePath, 'utf8')) as { thumbprint?: string }).thumbprint;
    } catch {
      knownThumbprint = undefined;
    }
    cert = await ensureSimCert({ outDir: runDir, knownThumbprint, guiBaseUrl });
    await authorSimTenantRecord({
      registry,
      registryRoot: tenantRoot,
      slug,
      auth: { certThumbprint: cert.thumbprint, certPath: cert.pfxPath },
    });
    await fsp.writeFile(certStatePath, JSON.stringify({ thumbprint: cert.thumbprint }, null, 2), 'utf8');
    log(`  sim cert ${cert.thumbprint} in Cert:\\CurrentUser\\My via '${cert.route}'${cert.guiImportError ? ` (ruled GUI import attempted and failed: ${cert.guiImportError.slice(0, 120)})` : ''}`);
    return cert;
  };

  try {
    /* ---------------- Beat 0 — pre-flight, gates, seed, serve ---------------- */
    enterBeat(0);

    const report = await runPreflight({ modules: opts.preflightModules, ports: opts.preflightPorts });
    preflight = { ok: report.ok, issues: report.issues };
    log(`  pre-flight: ${report.ok ? 'OK — builds fresh, ports free' : `NOT READY — ${report.issues.join('; ')}`}`);

    if (opts.skipGates) {
      gates = { typecheck: 'skipped', tests: 'skipped', detail: '--skip-gates: clause 9 cannot pass' };
      log('  gates: SKIPPED (--skip-gates) — clause 9 will fail; this run cannot be a clean pass');
    } else {
      gates = await runGateChecks(opts.testerRoot, runDir, log);
    }

    if (!preflight.ok) {
      throw new Error(`pre-flight not ready: ${report.issues.join('; ')}`);
    }

    // Seeding path is implied by the ground-truth source (M2): a calibrated
    // entry is demo-dib-small, materialized by stacksim's own demo-scenario
    // build; an eval-config entry is materialized from its `stacksim_seed`.
    let stance: TenantStance = 'm365_azure';
    if (opts.config.expectedDiscovery.source === 'calibrated') {
      await resetDemoDibSmallTenant(opts.stacksimRoot, slug);
    } else {
      const evalFile = await loadEvalConfigFile(path.resolve(opts.testerRoot, opts.config.expectedDiscovery.configFile));
      stance = evalFile.stacksim_seed.stance;
      await runScenario(
        { stacksimRoot: opts.stacksimRoot },
        path.join(runDir, 'scenarios'),
        evalFile.config_id,
        evalFile.stacksim_seed,
        evalFile.description,
      );
    }
    serveHandle = await startServe({
      stacksimRoot: opts.stacksimRoot,
      stance,
      slug,
      logPath: path.join(runDir, 'stacksim-serve.log'),
    });
    await waitUntilReady({ serverUrl: simUrl, method: 'GET', uri: '/v1.0/policies/authorizationPolicy' });
    seed = { seeded: true, serveReady: true };
    log(`  tenant '${slug}' materialized pristine; stacksim serve ready on ${simUrl}`);

    // Registry record (run-scoped root). Authored once here; the cert step
    // re-authors + patches it, and nothing else in this run re-registers the
    // slug — so the M3 "later re-registration resets the auth fields" collision
    // cannot occur.
    await createEphemeralSimTenant(registry, slug, { stance });
    simLaunchEnv = await getSimLaunchEnv(registry, slug, { stacksimRoot: opts.stacksimRoot });
    setBeat(0, 'pass', `seed + serve on ${simUrl}`);

    /* ---------------- Beat 1 — discovery read gate + EO before ---------------- */
    enterBeat(1);
    discovery = await runDiscoveryGate({
      testerRoot: opts.testerRoot,
      musterRoot: opts.musterRoot,
      stamperRoot: opts.stamperRoot,
      config: opts.config,
      slug,
      simUrl,
      outPath: path.join(runDir, 'discovery-result.json'),
      log,
    });

    eoBefore = await runEoBeat({
      label: 'before',
      eoRoot: opts.eoRoot,
      simRoot: opts.stacksimRoot,
      stamperRegistry,
      tenantRoot,
      storageRoot: path.join(runDir, 'eo-storage-before'),
      pipelineRoot: path.join(runDir, 'eo-pipeline-before'),
      logPath: path.join(runDir, 'eo-before.log'),
      slug,
      simUrl,
      port: opts.eoPort ?? 4002,
      watch,
      screenshotDir,
      log,
    });
    setBeat(
      1,
      discovery.ran && discovery.readOnly && discovery.mismatches.length === 0 && eoBefore.live ? 'pass' : 'fail',
      `${discovery.observationCount} observations, ${discovery.mismatches.length} mismatch(es), read-only=${discovery.readOnly}; EO before ${eoBefore.controlsMet ?? '?'}/${eoBefore.controlsTotal ?? '?'} met`,
      discovery.resultPath,
    );

    /* ---------------- Beat 2 — Muster wizard ---------------- */
    enterBeat(2);
    if (!opts.config.fullChain) {
      muster = { error: `n/a — config '${opts.config.id}' has no proven wizard answer map (FD-4)` };
      log(`  n/a — ${muster.error}`);
      setBeat(2, 'staged', 'n/a for this config (FD-4)');
    } else {
      const plannerPort = opts.plannerPort ?? 5173;
      const artifactsDir = path.join(runDir, 'artifacts');
      await fsp.mkdir(artifactsDir, { recursive: true });
      try {
        devServer = startDevServer({ plannerRoot: opts.plannerRoot, port: plannerPort, graphBaseUrl: `${simUrl}/v1.0` });
        await waitForDevServerReady(devServerBaseUrl(plannerPort));
        const produced = await driveMuster({
          baseUrl: devServerBaseUrl(plannerPort),
          customerName: `ces-tester-e2e-${opts.runId}`,
          answerMap: CLEAN_TENANT_MFA_BASELINE_ANSWER_MAP,
          stamperTargetDir: artifactsDir,
          headless: watch.headless,
          slowMo: watch.slowMo,
        });
        muster = { missionPlanPath: produced.missionPlanPath, manifestPath: produced.manifestPath };
        log(`  mission plan: ${produced.missionPlanPath}`);
        log(`  tenant manifest: ${produced.manifestPath}`);
        setBeat(2, 'pass', 'mission plan + tenant manifest produced', produced.missionPlanPath);
      } catch (err) {
        muster = { error: err instanceof Error ? err.message : String(err) };
        log(`  Muster wizard FAILED: ${muster.error}`);
        setBeat(2, 'fail', muster.error);
      } finally {
        if (devServer) {
          await devServer.stop();
          devServer = undefined;
        }
      }
    }

    /* ---------------- Beat 3 — Stamper GUI remediation ---------------- */
    enterBeat(3);
    if (!opts.config.fullChain) {
      stamper = { ...stamper, ran: false, error: `n/a — config '${opts.config.id}' has no proven remediation path (FD-4)` };
      log(`  n/a — ${stamper.error}`);
      setBeat(3, 'staged', 'n/a for this config (FD-4)');
      await ensureCertOnce();
    } else if (!muster.missionPlanPath || !muster.manifestPath) {
      stamper = { ...stamper, ran: false, error: 'skipped — Beat 2 produced no artifacts to remediate from' };
      log(`  ${stamper.error}`);
      setBeat(3, 'fail', stamper.error);
      await ensureCertOnce();
    } else {
      try {
        if (!simLaunchEnv) throw new Error('sim launch env unavailable — the tenant was never registered (Beat 0 did not complete)');
        const env = buildGuiChildEnv({
          simLaunchEnv,
          shimRoot,
          tenantRoot,
          pipelineRoot,
          storageRoot: path.join(runDir, 'stamper-storage'),
        });
        stamperGui = await startStamperGui({
          stamperRoot: opts.stamperRoot,
          env,
          port: opts.stamperGuiPort ?? STAMPER_GUI_PORT,
          logPath: path.join(runDir, 'stamper-gui.log'),
        });
        log(`  Stamper GUI up on ${stamperGui.baseUrl}`);
        await ensureCertOnce(stamperGui.baseUrl);

        const drive: StamperUiDriveResult = await driveStamperUi({
          baseUrl: stamperGui.baseUrl,
          slug,
          missionPlanPath: muster.missionPlanPath,
          manifestPath: muster.manifestPath,
          pipelineRoot,
          watch,
          screenshotDir,
        });
        const ledgerSnapshotPath = await snapshotLedgerTo(simUrl, path.join(runDir, 'ledger-snapshot.json'));
        const taxonomyPath = await writeFailureTaxonomy(runDir, slug, drive);
        stamper = {
          ran: true,
          executeBadge: drive.executeBadge,
          report: drive.report,
          ledgerSnapshotPath,
          knownFalseFails: opts.guiKnownFalseFails ?? GUI_LEG_KNOWN_FALSE_FAILS,
          taxonomyPath,
        };
        const cliPartition = partitionFailures(drive.report?.failureIds ?? []);
        log(
          `  execute badge "${drive.executeBadge ?? '?'}" (narrative only) — report ${drive.report?.status ?? '?'}: ` +
            `${drive.report?.completedTasks ?? '?'}/${drive.report?.totalTasks ?? '?'} completed, ${drive.report?.failureIds.length ?? 0} failure(s)`,
        );
        log(`  (CLI-registry context only, NOT the GUI-leg judge: ${cliPartition.explained.length} known / ${cliPartition.unexpected.length} unexpected)`);
        log(`  failure taxonomy: ${taxonomyPath}`);
        setBeat(3, drive.report ? 'pass' : 'fail', `execute report ${drive.report?.status ?? 'missing'}`, ledgerSnapshotPath);
      } catch (err) {
        stamper = { ...stamper, ran: false, error: err instanceof Error ? err.message : String(err) };
        log(`  Stamper GUI leg FAILED: ${stamper.error}`);
        setBeat(3, 'fail', stamper.error);
      } finally {
        if (stamperGui) {
          await stamperGui.stop().catch(() => undefined);
          stamperGui = undefined;
        }
      }
    }

    /* --- clause 10 — post-remediation Muster re-read (after Stamper, before AO) ---
     * The same presence-based discovery walk as Beat 1's gate, re-run against the
     * now-remediated tenant and diffed vs the config's after-truth. MUST precede
     * Beat 5 (AO A-18 mutates authorizationPolicy = probes P8/P9), so it lives
     * here and not below AO. Read-only, self-baselining; n/a when the config
     * carries no after-truth. */
    postRemediation = await runPostRemediationReRead({
      testerRoot: opts.testerRoot,
      musterRoot: opts.musterRoot,
      stamperRoot: opts.stamperRoot,
      config: opts.config,
      slug,
      simUrl,
      outPath: path.join(runDir, 'discovery-after-result.json'),
      log,
    });
    if (!postRemediation.applicable) {
      log(`  post-remediation re-read: n/a — config '${opts.config.id}' carries no after-truth (clause 10 not judged)`);
    } else {
      const against =
        postRemediation.provenance === 'authored-contract'
          ? 'AUTHORED-CONTRACT after-truth (not yet live-calibrated → clause 10 reports calibrating, --calibrate accepts)'
          : 'after-truth';
      log(
        `  post-remediation re-read (presence-based): ${postRemediation.observationCount} observations, ` +
          `${postRemediation.mismatches.length} mismatch(es) vs ${against}, read-only=${postRemediation.readOnly}`,
      );
    }

    /* ---------------- Beat 4 — EO after ---------------- */
    enterBeat(4);
    eoAfter = await runEoBeat({
      label: 'after',
      eoRoot: opts.eoRoot,
      simRoot: opts.stacksimRoot,
      stamperRegistry,
      tenantRoot,
      storageRoot: path.join(runDir, 'eo-storage-after'),
      pipelineRoot: path.join(runDir, 'eo-pipeline-after'),
      logPath: path.join(runDir, 'eo-after.log'),
      slug,
      simUrl,
      port: opts.eoPort ?? 4002,
      watch,
      screenshotDir,
      log,
    });
    setBeat(
      4,
      eoAfter.live ? 'pass' : 'fail',
      `EO after ${eoAfter.controlsMet ?? '?'}/${eoAfter.controlsTotal ?? '?'} met (${eoAfter.liveAssessmentCount ?? 0} live)`,
    );

    /* ---------------- Beat 5 — AO (LAST, per FD-3) ---------------- */
    enterBeat(5);
    await ensureCertOnce();
    if (!simLaunchEnv) throw new Error('sim launch env unavailable — the tenant was never registered (Beat 0 did not complete)');
    ao = await runAoLeg({
      aoRoot: opts.aoRoot,
      slug,
      simLaunchEnv,
      shimRoot,
      pipelineRoot,
      tenantRoot,
      commandId: opts.config.aoCommand || AO_DEMO_COMMAND_ID,
      port: opts.aoGuiPort ?? AO_GUI_PORT,
      simUrl,
      logPath: path.join(runDir, 'ao-gui.log'),
      watch,
      drive: createAoUiDriver({ screenshotDir }),
    });
    if (ao.verdict?.satisfied) {
      log(`  ${ao.commandId} applied live; evidence of the change was auto-collected (+${ao.verdict.rowCountDelta} row, +${ao.verdict.ledgerMutationDelta} ledger mutate).`);
    } else {
      log(`  AO beat NOT proven: ${ao.error ?? ao.verdict?.failures.join('; ') ?? 'unknown'}`);
    }
    setBeat(5, ao.verdict?.satisfied ? 'pass' : 'fail', ao.verdict?.satisfied ? 'evidence of the change was auto-collected' : (ao.error ?? 'evidence not proven'));
  } catch (err) {
    log(`\ndemo:e2e — run aborted: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (devServer) await devServer.stop().catch(() => undefined);
    if (stamperGui) await stamperGui.stop().catch(() => undefined);
    if (serveHandle) await serveHandle.stop().catch(() => undefined);
  }

  /* ---------------- Dashboard + verdict ---------------- */
  const beats = E2E_BEATS.map((b) => beatStatus.get(b.id)!);
  const factsForDashboard: E2ePredicateFacts = {
    configId: opts.config.id,
    fullChain: opts.config.fullChain,
    calibrateAccepted: opts.calibrate === true,
    preflight,
    seed,
    discovery,
    postRemediation,
    muster,
    stamper,
    eo: { before: eoBefore, after: eoAfter },
    ao,
    dashboard,
    gates,
  };

  // Rendered AFTER Beat 5 so clause 8's "Beat 5 present" judges the real
  // artifact, not a staged placeholder.
  const dashboardPath = path.join(runDir, 'unified-dashboard.html');
  try {
    const unified = buildUnifiedFromE2e(factsForDashboard, beats, generatedAt, slug);
    await writeUnifiedDashboard(unified, dashboardPath);
    dashboard = { path: dashboardPath, beatIds: unified.beats.map((x) => x.id) };
    log(`\nunified dashboard: ${dashboardPath}`);
  } catch (err) {
    dashboard = { beatIds: [], error: err instanceof Error ? err.message : String(err) };
    log(`\nunified dashboard FAILED: ${dashboard.error}`);
  }

  const facts: E2ePredicateFacts = { ...factsForDashboard, dashboard };
  const verdict = evaluateE2ePredicate(facts);

  log('');
  log('=== demo:e2e success predicate ===');
  for (const c of verdict.clauses) {
    log(`  ${c.status.toUpperCase().padEnd(11)} ${c.id}. ${c.name} — ${c.detail}`);
  }
  log(`  => ${verdict.satisfied ? 'PASS' : 'PARTIAL / FAIL'}${verdict.calibrating.length > 0 ? ` (clause(s) ${verdict.calibrating.join(', ')} CALIBRATING${opts.calibrate ? ', accepted by --calibrate' : ''})` : ''}`);

  const result: E2eRunResult = {
    runId: opts.runId,
    configId: opts.config.id,
    slug,
    fullChain: opts.config.fullChain,
    runDir,
    beats,
    facts,
    verdict,
    exitCode: verdict.satisfied ? 0 : 1,
  };
  try {
    await fsp.writeFile(path.join(runDir, 'e2e-result.json'), JSON.stringify(result, null, 2), 'utf8');
  } catch (err) {
    log(`  e2e-result.json write failed (non-fatal): ${err instanceof Error ? err.message : err}`);
  }
  return result;
}

/* ------------------------------------------------------------------ *
 * Beat helpers
 * ------------------------------------------------------------------ */

async function snapshotLedgerTo(simUrl: string, absPath: string): Promise<string | undefined> {
  try {
    const entries = await queryLedger(simUrl, {});
    await fsp.mkdir(path.dirname(absPath), { recursive: true });
    await fsp.writeFile(absPath, JSON.stringify(entries, null, 2), 'utf8');
    return absPath;
  } catch {
    return undefined;
  }
}

/**
 * Record the post-seed Stamper failure taxonomy. Written on EVERY run that got a
 * report — it is cheap evidence, and it is the input M7 pins the GUI leg's
 * known-false-FAIL set from without having to re-run a seven-minute execute.
 */
async function writeFailureTaxonomy(runDir: string, slug: string, drive: StamperUiDriveResult): Promise<string | undefined> {
  if (!drive.report) return undefined;
  const p = path.join(runDir, 'stamper-failure-taxonomy.json');
  const body = {
    slug,
    recordedAt: new Date().toISOString(),
    note:
      'GUI-leg failure taxonomy. KNOWN_FALSE_FAILS is DRIVE-MODE-DEPENDENT (docs/context/M2-ENTRY-FINDINGS.md) — ' +
      'the CLI-derived registry must not be reused here. Pin GUI_LEG_KNOWN_FALSE_FAILS from this file.',
    executeBadge: drive.executeBadge,
    reportPath: drive.reportPath,
    status: drive.report.status,
    totalTasks: drive.report.totalTasks,
    completedTasks: drive.report.completedTasks,
    failureIds: drive.report.failureIds,
    failures: drive.report.failures,
    variableSeed: drive.variableSeed,
  };
  await fsp.writeFile(p, JSON.stringify(body, null, 2), 'utf8');
  return p;
}

interface DiscoveryGateOptions {
  readonly testerRoot: string;
  readonly musterRoot: string;
  readonly stamperRoot: string;
  readonly config: E2eConfigEntry;
  readonly slug: string;
  readonly simUrl: string;
  readonly outPath: string;
  /**
   * When supplied, the walk is diffed against THIS posture map instead of the
   * config's before-truth (`resolveExpectedDiscovery`). The clause-10 re-read
   * passes the resolved `afterTruth` here, so both reads share ONE discovery
   * implementation, one artifact-first judge and one read-only ledger proof.
   */
  readonly expectedOverride?: Readonly<Record<string, DiscoveryPosture>>;
  readonly log: (line: string) => void;
}

/**
 * The Beat 1 read gate: DISCOVERY-1 walks the served tenant and every probe's
 * `derived_posture` must match the pinned ground truth, with a zero-write ledger
 * delta proving the walk was read-only.
 *
 * Presence-based, and honest about it: this does NOT "find the MFA gap".
 * `IA.L2-3.5.3` reads `met` on demo-dib-small before any remediation because the
 * policy exists but is report-only (REQ-MUSTER-DISCOVERY-STATE-BLINDNESS). Gap
 * depth belongs to EO.
 */
async function runDiscoveryGate(opts: DiscoveryGateOptions): Promise<E2eDiscoveryFacts> {
  const cliPath = path.join(opts.musterRoot, 'muster-api', 'dist', 'cli', 'bin.js');
  if (!fs.existsSync(cliPath)) {
    return { ran: false, readOnly: false, ledgerWriteDelta: 0, mismatches: [], observationCount: 0, error: `muster discovery CLI not built: ${cliPath}` };
  }
  try {
    const expected = opts.expectedOverride ?? (await resolveExpectedDiscovery(opts.config, opts.testerRoot));
    const baseline = await ledgerWriteCount(opts.simUrl);
    const env: NodeJS.ProcessEnv = { ...process.env, STAMPER_REGISTRY_ROOT: path.resolve(opts.stamperRoot, 'src', 'registry') };
    const cli = await spawnCapture('node', [cliPath, 'discovery', '--sim', '--slug', opts.slug, '--out', opts.outPath], opts.musterRoot, env);

    // Artifact-first: the mu CLI writes its result and can then abort in Node's
    // Windows teardown (M2 pinned exit 3221226505 as non-fatal).
    let observations: Array<{ control_id: string; derived_posture: string }> = [];
    try {
      const raw = JSON.parse(await fsp.readFile(opts.outPath, 'utf8')) as { observations?: Array<{ control_id: string; derived_posture: string }> };
      observations = raw.observations ?? [];
    } catch (err) {
      return {
        ran: false,
        readOnly: false,
        ledgerWriteDelta: 0,
        mismatches: [],
        observationCount: 0,
        error: `discovery produced no readable artifact (exit ${cli.exitCode}): ${err instanceof Error ? err.message : err}`,
      };
    }
    if (cli.exitCode !== 0 && cli.exitCode !== WINDOWS_LIBUV_TEARDOWN_EXIT) {
      opts.log(`  NOTE: mu discovery exited ${cli.exitCode} (artifact was still complete) — ${cli.stderr.trim().slice(0, 200)}`);
    }

    const ledgerWriteDelta = (await ledgerWriteCount(opts.simUrl)) - baseline;
    const diff = diffPostures({ ...expected }, observations);
    opts.log(
      `  discovery (presence-based read): ${observations.length} observations, ${diff.matches.length}/${Object.keys(expected).length} probes matched, ledger create+mutate delta ${ledgerWriteDelta}`,
    );
    for (const m of diff.mismatches) opts.log(`    MISMATCH ${m.control}: expected ${m.expected}, got ${m.actual}`);
    return {
      ran: true,
      readOnly: ledgerWriteDelta === 0,
      ledgerWriteDelta,
      mismatches: diff.mismatches,
      observationCount: observations.length,
      resultPath: opts.outPath,
    };
  } catch (err) {
    return { ran: false, readOnly: false, ledgerWriteDelta: 0, mismatches: [], observationCount: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

interface PostRemediationOptions {
  readonly testerRoot: string;
  readonly musterRoot: string;
  readonly stamperRoot: string;
  readonly config: E2eConfigEntry;
  readonly slug: string;
  readonly simUrl: string;
  readonly outPath: string;
  readonly log: (line: string) => void;
}

/**
 * clause 10 — the post-remediation Muster re-read. Reuses `runDiscoveryGate`
 * VERBATIM (no second discovery impl, no DOM-scrape) with the config's resolved
 * `afterTruth` as the expected map, writing to a SEPARATE artifact so clause 3's
 * evidence survives alongside it.
 *
 * Runs whenever applicable and the sim is up — it is NOT gated on Stamper
 * success, so a failed remediation produces honest mismatches, not a skip. It
 * MUST run before the AO beat (Beat 5): A-18 mutates `authorizationPolicy`, the
 * very object probes P8/P9 (`AC.L1-3.1.20`) read (FD-3) — moving this read below
 * AO would contaminate it. A config with no after-truth is a synchronous `n/a`:
 * discovery is never re-run, and clause 10 is not fabricated.
 */
async function runPostRemediationReRead(opts: PostRemediationOptions): Promise<E2ePostRemediationFacts> {
  const applicable = opts.config.fullChain && opts.config.afterTruth !== undefined;
  if (!applicable) {
    return { applicable: false, ran: false, readOnly: false, ledgerWriteDelta: 0, mismatches: [], observationCount: 0 };
  }
  const afterExpected = await resolveAfterTruth(opts.config, opts.testerRoot);
  if (!afterExpected) {
    // Defensive: `applicable` already required afterTruth !== undefined, so this
    // is unreachable in practice — but never let a resolution gap read as a pass.
    return { applicable: true, ran: false, readOnly: false, ledgerWriteDelta: 0, mismatches: [], observationCount: 0, error: 'after-truth declared but did not resolve' };
  }
  const gate = await runDiscoveryGate({
    testerRoot: opts.testerRoot,
    musterRoot: opts.musterRoot,
    stamperRoot: opts.stamperRoot,
    config: opts.config,
    slug: opts.slug,
    simUrl: opts.simUrl,
    outPath: opts.outPath,
    expectedOverride: afterExpected,
    log: opts.log,
  });
  return {
    applicable: true,
    ran: gate.ran,
    readOnly: gate.readOnly,
    ledgerWriteDelta: gate.ledgerWriteDelta,
    mismatches: gate.mismatches,
    observationCount: gate.observationCount,
    resultPath: gate.resultPath,
    provenance: afterTruthProvenance(opts.config),
    error: gate.error,
  };
}

interface EoBeatOptions extends StartEoServerOptions {
  readonly label: 'before' | 'after';
  readonly watch: WatchMode;
  readonly screenshotDir: string;
  readonly log: (line: string) => void;
}

/**
 * The EO beat's API reads — assessment snapshot, SPRS, and the MFA control —
 * each scoped to `slug`, the tenant the beat just drove (FX-TE5; ces-eo FX-EO8
 * 400s a tenantless read). The assessment read throws; SPRS and the control are
 * best-effort. Exported so the tenant contract is unit-testable.
 */
export async function readEoBeatApi(
  baseUrl: string,
  slug: string,
): Promise<{ summary: EoAssessSummary; sprsScore: number | undefined; mfaControl: EoControlDetail | undefined }> {
  const summary = summarizeEoSnapshot(await getJson(eoTenantUrl(baseUrl, '/api/assessment', slug)));
  let sprsScore = summary.sprsScore;
  try {
    const sprs = (await getJson(eoTenantUrl(baseUrl, '/api/sprs', slug))) as Record<string, unknown>;
    const n = [sprs.score, sprs.sprs_score, sprs.sprsScore].find((v) => typeof v === 'number');
    if (typeof n === 'number') sprsScore = n;
  } catch {
    /* SPRS is presentation detail, not a predicate input */
  }
  let mfaControl: EoControlDetail | undefined;
  try {
    mfaControl = mapControlDetail(
      await getJson(eoTenantUrl(baseUrl, `/api/controls/${encodeURIComponent(DEMO_MFA_CONTROL_ID)}`, slug)),
    );
  } catch {
    mfaControl = undefined;
  }
  return { summary, sprsScore, mfaControl };
}

/**
 * One EO beat: boot the server, drive its SPA with Playwright (the demo
 * surface), then take the STRUCTURED NUMBERS from that same server's
 * `GET /api/assessment` snapshot — the API, never the DOM. Never throws; an
 * honest `live:false` with a reason is what a failed beat looks like.
 */
async function runEoBeat(opts: EoBeatOptions): Promise<E2eEoBeatFacts> {
  let server: EoServerHandle | undefined;
  try {
    server = await startEoServer(opts);
    const drive: EoUiDriveResult = await driveEoUi({
      baseUrl: server.baseUrl,
      slug: opts.slug,
      watch: opts.watch,
      screenshotDir: opts.screenshotDir,
      label: `eo-${opts.label}`,
    });
    const { summary, sprsScore, mfaControl } = await readEoBeatApi(server.baseUrl, opts.slug);
    const total =
      (summary.controlsMet ?? 0) + (summary.controlsNotMet ?? 0) + (summary.controlsPartial ?? 0) + (summary.controlsNotAssessed ?? 0) || undefined;
    const live = (summary.liveAssessmentCount ?? 0) > 0;
    opts.log(
      `  EO ${opts.label} (SPA-driven${drive.connected ? '' : ', connect optional and not confirmed'}): ` +
        `${summary.liveAssessmentCount ?? 0} live assessment(s), ${summary.controlsMet ?? '?'}/${total ?? '?'} met` +
        (live ? '' : ' — LIVE SIGNAL LEG DID NOT RUN; numbers not trustworthy'),
    );
    return {
      live,
      liveAssessmentCount: summary.liveAssessmentCount,
      controlsMet: summary.controlsMet,
      controlsTotal: total,
      sprsScore,
      snapshotId: summary.snapshotId,
      mfaControl,
      error: live ? undefined : 'liveAssessmentCount=0 (live signal leg crashed)',
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    opts.log(`  EO ${opts.label} FAILED: ${error}`);
    return { live: false, error };
  } finally {
    server?.stop();
  }
}

/**
 * Predicate clause 9. Run BEFORE any server is spawned so nothing is disturbed,
 * output captured to the run directory, one line each on screen. `--skip-gates`
 * does not make the clause pass — an unverified gate is not a clean gate.
 */
async function runGateChecks(testerRoot: string, runDir: string, log: (line: string) => void): Promise<E2eGateFacts> {
  const run = async (name: string, args: string[]): Promise<GateStatus> => {
    try {
      const r = await spawnCapture(args[0], args.slice(1), testerRoot, process.env, true);
      await fsp.writeFile(path.join(runDir, `gate-${name}.log`), `${r.stdout}\n${r.stderr}`, 'utf8');
      log(`  gate ${name}: ${r.exitCode === 0 ? 'clean' : `FAILED (exit ${r.exitCode}) — see runs/e2e/${path.basename(runDir)}/gate-${name}.log`}`);
      return r.exitCode === 0 ? 'pass' : 'fail';
    } catch (err) {
      log(`  gate ${name}: FAILED to run — ${err instanceof Error ? err.message : err}`);
      return 'fail';
    }
  };
  const typecheck = await run('typecheck', ['npx', 'tsc', '--noEmit']);
  const tests = await run('tests', ['npm', 'test', '--silent']);
  return { typecheck, tests };
}
