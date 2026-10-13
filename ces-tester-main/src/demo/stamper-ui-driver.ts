// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-3 M4 — Beat 2 (Stamper) driven through its own GUI, as a user.
 *
 * The founder's mandate is that Playwright drives all four legs; the Stamper
 * GUI expresses the whole remediation run: tenant -> Connect -> config paths ->
 * Assess (which is what UNLOCKS Translate, so it is a real visible beat, not a
 * workaround) -> Translate -> Execute -> SSE to completion.
 *
 * Everything below that looks like paranoia was measured in the M0 spike
 * (docs/context/IMPLEMENTATION_LOG.md, "GP-DEMO-3 — M0 Drivability Spike"):
 *
 * - **Every workflow card ships `card-collapsed`** and `toggleCard()` is a
 *   plain toggle that no-ops on `card-locked` — expand by guard, and only after
 *   the unlock that owns that card (Assess unlocks card 3, Translate card 4).
 * - **`tenantConnectionState` is a top-level lexical `let`**, not a `window`
 *   property, so it is unreadable from the page context. Anchor on the DOM
 *   class `#workflowCard0.tenant-connected` (which is also the visible signal),
 *   and require ZERO `.log-icon.error` rows.
 * - **The Translate button has no id** — `button[onclick="doTranslate()"]`.
 * - **[M0 CORRECTION to the plan's FD-2]** Execute defaults do NOT mean a live
 *   run. The GUI force-sets `#execTargetSelect` to `dryrun` on the initial
 *   `dev` selection and never restores it, so a first attempt reports
 *   "Complete" in 0.7 s with zero mutations. This driver sets the target to
 *   `tenant` and ASSERTS it stuck (REQ-STAMPER-GUI-EXEC-TARGET-STICKY-DRYRUN).
 * - **`/api/execute` is single-flight** — never reload the page mid-run.
 * - **`#cardStatus4` read `Complete` while the report on disk read `partial`
 *   (80/110)**. The badge reflects only the terminal SSE event, so it is
 *   NARRATIVE ONLY here: this driver judges the ARTIFACT — the execution report
 *   on disk — and hands it up structured.
 *
 * Before Translate the driver seeds the tenant variable store
 * (`stamper-plan-variables.ts`): `PlanTranslator` makes that store the
 * highest-priority base of the translate-time merge, and without it the strict
 * `ExecutionContext` fails ~23 tasks on variables the manifest cannot supply
 * (docs/context/M2-ENTRY-FINDINGS.md).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { HEADLESS_MODE, type WatchMode } from './watch-mode.js';
import {
  buildPlanVariableSeed,
  seedPlanVariables,
  tenantVariablesPath,
  type PlanVariableSeedResult,
} from './stamper-plan-variables.js';
import {
  captureScreenshot,
  expandCard,
  hasClass,
  openUiPage,
  sleep,
  waitForCondition,
  waitForText,
  type UiPage,
} from './ui-page.js';

/** Selector inventory — every entry verified in the M0 spike or from `public/index.html`. */
export const STAMPER_SELECTORS = {
  tenantSelect: '#tenantSelect',
  tenantOption: (slug: string) => `#tenantSelect option[value="${slug}"]`,
  connectionGate: '#connectionGateWrap',
  gateAllow: '#gateAllowBtn',
  card: (n: number) => `#workflowCard${n}`,
  connectErrorRows: '#taskList .connection-log-row .log-icon.error',
  missionPlanPath: '#configMissionPlanPath',
  manifestPath: '#configManifestPath',
  assess: '#btnAssess',
  cardStatus2: '#cardStatus2',
  translate: 'button[onclick="doTranslate()"]',
  cardStatus3: '#cardStatus3',
  execMode: '#execModeSelect',
  execTarget: '#execTargetSelect',
  execute: '#btnExecuteMatrix',
  /** The operator Halt button (shown while an execute is running) — closes the
   *  SSE (server-side `closed` flag) and POSTs /api/abort. Used by demo peek to
   *  STOP the run after cutting away, so it does not churn on backstage and
   *  starve/crash later live acts (the muster discovery CLI). */
  executeHalt: '#btnHalt',
  cardStatus4: '#cardStatus4',
  reportLinks: '#resultsContent .report-links a',
} as const;

export interface StamperUiDriveContext {
  readonly baseUrl: string;
  readonly slug: string;
  /** Filesystem paths the GUI reads server-side — Muster's artifacts, as produced. */
  readonly missionPlanPath: string;
  readonly manifestPath: string;
  /** Run-scoped `CES_PIPELINE_ROOT` — where the variable store and reports live. */
  readonly pipelineRoot: string;
  readonly watch?: WatchMode;
  /** Defaults to `buildPlanVariableSeed({ slug })`; `false` disables seeding. */
  readonly planVariables?: Readonly<Record<string, string>> | false;
  /** Injection seam for the store write (default `seedPlanVariables`). */
  readonly seedVariables?: typeof seedPlanVariables;
  readonly screenshotDir?: string;
  readonly connectTimeoutMs?: number;
  readonly assessTimeoutMs?: number;
  readonly translateTimeoutMs?: number;
  readonly executeTimeoutMs?: number;
  /**
   * How much of the flow to run. Defaults to `'full'`, which is byte-identical
   * to the flow before this field existed — `demo:e2e` is untouched.
   *
   * - `'through-translate'` returns after step 6, leaving the page connected,
   *   configured, assessed, seeded and translated.
   * - `'execute-only'` skips steps 1-6 and starts at step 7. It is legal ONLY
   *   on a page that performed the translate itself: `doExecute` reads
   *   `#outputPath`, which only a translate response populates, and it bails
   *   unless the in-page connection state is `connected`. The CALLER must check
   *   both preconditions; this flow trusts the phase it is given.
   */
  readonly phase?: StamperUiPhase;
  /**
   * DEMO PEEK (GP-DEMO-6). When > 0, the Execute step clicks Execute, CONFIRMS
   * the GUI actually started (`#cardStatus4` reads "Executing…"), holds this many
   * ms so the run is visibly streaming, then RETURNS without awaiting a terminal
   * state — leaving the execution running on the session. The result carries
   * `executeLeftRunning: true` and NO `report`/`reportPath` (nothing was awaited
   * to judge). Default (undefined / 0) is the full await, byte-identical to
   * before this field existed — `demo:e2e` is untouched.
   */
  readonly executePeekMs?: number;
}

/** Which part of the GUI flow to run. See `StamperUiDriveContext.phase`. */
export type StamperUiPhase = 'full' | 'through-translate' | 'execute-only';

/** One failed task, keyed the way both report shapes actually key them. */
export interface ExecuteTaskFailure {
  /** `failed_tasks[].task_id` — always present, always the plan's task id. */
  readonly taskId: string;
  /** Registry entry-id parsed off a verification error prefix, when there is one. */
  readonly entryId?: string;
  /** Control id carried by the task id — the stable identity when there is no entry-id. */
  readonly controlId?: string;
  readonly error: string;
}

export interface ExecutionReportSummary {
  readonly status?: string;
  readonly totalTasks?: number;
  readonly completedTasks?: number;
  readonly failures: readonly ExecuteTaskFailure[];
  /** `entryId ?? taskId` per failure, de-duplicated — what a partitioner should see. */
  readonly failureIds: readonly string[];
}

export interface StamperUiDriveResult {
  /** Which part of the flow actually ran. */
  readonly phase: StamperUiPhase;
  /**
   * OBSERVED IN THIS CALL, not "true at some point". `execute-only` returns all
   * three `false` because it performed none of them — it inherited a page that
   * had. A caller may not report a beat it did not observe, and hardcoding
   * `true` here would have three beats asserting themselves into a run report
   * that never ran them.
   */
  readonly connected: boolean;
  readonly assessed: boolean;
  readonly translated: boolean;
  /** `#cardStatus4` text. NARRATIVE ONLY — M0 measured `Complete` on a `partial` run. */
  readonly executeBadge?: string;
  readonly reportLinks: readonly string[];
  readonly reportPath?: string;
  /** The judge: the execution report on disk, parsed. */
  readonly report?: ExecutionReportSummary;
  /**
   * True when the run was started, verified running, watched for `executePeekMs`,
   * then the halt click did NOT land, so it is still running (demo peek fallback).
   * Absent on a full run. See `executeHalted` for the normal peek outcome.
   */
  readonly executeLeftRunning?: boolean;
  /**
   * True when the demo peek halted the run after cutting away (the normal peek
   * outcome). The flow awaited no terminal state, so there is deliberately no
   * `report` to judge. Absent on a full run.
   */
  readonly executeHalted?: boolean;
  readonly variableSeed?: PlanVariableSeedResult;
  /** Body of `POST /api/translate`, captured from the browser's own traffic. */
  readonly translateResponse?: unknown;
  readonly screenshots: readonly string[];
}

export type StamperUiDriver = (ctx: StamperUiDriveContext) => Promise<StamperUiDriveResult>;

const DEFAULTS = {
  connectTimeoutMs: 180_000, // M0: ~3 s, but prereq checks spawn PowerShell
  assessTimeoutMs: 900_000, // M0: ~5 min
  translateTimeoutMs: 120_000, // M0: ~0.1 s for 110 tasks
  executeTimeoutMs: 1_500_000, // M0: ~7 min
} as const;

/**
 * A registry entry-id as it appears in a verification error prefix
 * (`MP.L2-3.8.1.cui-label: verification failed — ...`). Deliberately strict:
 * `error.split(':')[0]` on the GUI leg's unresolved-variable class yields the
 * literal string `"Unresolved manifest variables"`, which no partitioner can
 * map to anything (M0 open risk / M2 secondary hardening). Pure.
 */
export function extractRegistryEntryId(error: string): string | undefined {
  const head = error.split(':')[0]?.trim() ?? '';
  // `<DOMAIN>.L<level>-<nist>.<slug>` — the slug tail must start with a letter,
  // or a bare control id (`MP.L2-3.8.1`) would masquerade as an entry-id.
  if (/^[A-Z]{2}\.L\d-\d+(?:\.\d+)*\.[A-Za-z][A-Za-z0-9._-]*$/.test(head)) return head;
  // GP-DEMO-3 M7: the infra registry uses a SECOND entry-id space —
  // `AZ-<AREA>-<NNN>[a]` (`AZ-LOG-001`, `AZ-LOG-002a`, `AZ-SEN-010`). Live
  // failures prefix their error with it exactly as the CMMC entries do, and it
  // is translation-stable, so it is a legitimate (and pinnable) identity.
  return /^[A-Z]{2,}-[A-Z]{2,}-\d+[a-z]?$/.test(head) ? head : undefined;
}

/**
 * The control id embedded in a plan task id
 * (`step_task_AC.L2-3.1.14_mtf0c5v5_w5rf449` -> `AC.L2-3.1.14`). Pure.
 *
 * GP-DEMO-3 M7 added this because a failure class exists that carries NO
 * registry entry-id at all — the strict resolver's
 * `Unresolved manifest/runtime variables: ...` throw names variables, not
 * entries. Falling through to the raw `task_id` made those failures
 * **unpinnable**: the `_<planid>_<rand>` suffix is regenerated by every
 * translation, so an id recorded in one run can never match the next. The
 * control id is the narrowest identity that survives a re-translation.
 */
export function extractControlIdFromTaskId(taskId: string): string | undefined {
  const m = /^step_task_([A-Z]{2}\.L\d-\d+(?:\.\d+)*)_/.exec(taskId);
  return m ? m[1] : undefined;
}

/**
 * Parse a Stamper execution report. Pure.
 *
 * Identity keys off `failed_tasks[].task_id` — present and correct on BOTH
 * legs' reports — never off the error prefix. The prefix is still mined, but
 * only as an optional registry entry-id, because that is the id space
 * `KNOWN_FALSE_FAILS` uses and the two id spaces are genuinely different
 * (`step_task_MP.L2-3.8.1_ms5bolq1_4hykc9t` vs `MP.L2-3.8.1.cui-label`).
 */
export function parseExecutionReport(json: unknown): ExecutionReportSummary {
  const report = json as
    | {
        status?: unknown;
        summary?: { total_tasks?: unknown; completed?: unknown; completed_tasks?: unknown; failed?: unknown };
        total_tasks?: unknown;
        completed_tasks?: unknown;
        failed_tasks?: unknown;
      }
    | null
    | undefined;
  const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

  const failures: ExecuteTaskFailure[] = [];
  const rawFailures = Array.isArray(report?.failed_tasks) ? (report.failed_tasks as unknown[]) : [];
  for (const entry of rawFailures) {
    const row = entry as { task_id?: unknown; error?: unknown };
    const taskId = typeof row.task_id === 'string' ? row.task_id : '';
    if (!taskId) continue;
    const error = typeof row.error === 'string' ? row.error : '';
    const entryId = error ? extractRegistryEntryId(error) : undefined;
    const controlId = extractControlIdFromTaskId(taskId);
    failures.push({ taskId, ...(entryId ? { entryId } : {}), ...(controlId ? { controlId } : {}), error });
  }

  // Identity priority: registry entry-id (narrowest and stable) -> control id
  // (stable across re-translation) -> the raw task id (last resort; carries a
  // per-translation suffix, so it can only ever be reported, never pinned).
  const failureIds = [...new Set(failures.map((f) => f.entryId ?? f.controlId ?? f.taskId))];
  return {
    status: typeof report?.status === 'string' ? report.status : undefined,
    totalTasks: num(report?.summary?.total_tasks) ?? num(report?.total_tasks),
    completedTasks: num(report?.summary?.completed) ?? num(report?.summary?.completed_tasks) ?? num(report?.completed_tasks),
    failures,
    failureIds,
  };
}

/** `{CES_PIPELINE_ROOT}/Stamper/plan-data/<slug>/plans` — where the GUI writes reports. */
export function stamperPlansDir(pipelineRoot: string, slug: string): string {
  return path.join(pipelineRoot, 'Stamper', 'plan-data', slug, 'plans');
}

/**
 * Newest `execution-report-*.json` in `plansDir`, by filename (the timestamp is
 * in the name and lexically sortable). Returns undefined when there is none —
 * a missing report is a real, reportable outcome, not an exception.
 */
export function findLatestExecutionReport(plansDir: string): string | undefined {
  let entries: string[];
  try {
    entries = fs.readdirSync(plansDir);
  } catch {
    return undefined;
  }
  const reports = entries.filter((f) => f.startsWith('execution-report-') && f.endsWith('.json')).sort();
  const newest = reports[reports.length - 1];
  return newest ? path.join(plansDir, newest) : undefined;
}

function readExecutionReport(reportPath: string): ExecutionReportSummary | undefined {
  try {
    return parseExecutionReport(JSON.parse(fs.readFileSync(reportPath, 'utf8')));
  } catch {
    return undefined;
  }
}

/**
 * The GUI flow, against the narrow `UiPage` seam so its ordering rules are
 * unit-testable without a browser. Throws on any step that genuinely did not
 * happen — a caller may not report a beat it did not observe.
 */
export async function runStamperUiFlow(page: UiPage, ctx: StamperUiDriveContext): Promise<StamperUiDriveResult> {
  const shots: string[] = [];
  const shot = async (name: string): Promise<void> => {
    const file = await captureScreenshot(page, ctx.screenshotDir, name);
    if (file) shots.push(file);
  };

  const phase: StamperUiPhase = ctx.phase ?? 'full';
  let variableSeed: PlanVariableSeedResult | undefined;
  let translateResponse: unknown;

  if (phase !== 'execute-only') {
    // 1. Tenant. The select is rebuilt from /api/tenants, so wait for OUR option.
    await page.waitForSelector(STAMPER_SELECTORS.tenantOption(ctx.slug), ctx.connectTimeoutMs ?? DEFAULTS.connectTimeoutMs);
    await expandCard(page, STAMPER_SELECTORS.card(0));
    await page.selectOption(STAMPER_SELECTORS.tenantSelect, ctx.slug);

    // 2. Connect. The gate only appears for a real (non-dev) tenant.
    await waitForCondition(
      'the connection gate to appear for a real tenant',
      () => page.isVisible(STAMPER_SELECTORS.connectionGate),
      30_000,
    );
    await page.click(STAMPER_SELECTORS.gateAllow);
    await waitForCondition(
      '#workflowCard0 to reach .tenant-connected',
      () => hasClass(page, STAMPER_SELECTORS.card(0), 'tenant-connected'),
      ctx.connectTimeoutMs ?? DEFAULTS.connectTimeoutMs,
    );
    const connectErrors = await page.count(STAMPER_SELECTORS.connectErrorRows);
    if (connectErrors > 0) {
      throw new Error(`Stamper Connect completed with ${connectErrors} error row(s) — the prerequisite/session chain did not come up clean`);
    }
    await shot('01-connected.png');

    // 3. Config paths. No save button: `oninput` persists them and doTranslate
    //    reads the live values. The card body must be expanded to be fillable.
    await expandCard(page, STAMPER_SELECTORS.card(1));
    await page.fill(STAMPER_SELECTORS.missionPlanPath, ctx.missionPlanPath);
    await page.fill(STAMPER_SELECTORS.manifestPath, ctx.manifestPath);

    // 4. Assess — the step that unlocks Translate.
    await expandCard(page, STAMPER_SELECTORS.card(2));
    await page.click(STAMPER_SELECTORS.assess);
    await waitForText(page, STAMPER_SELECTORS.cardStatus2, /assessed/i, {
      timeoutMs: ctx.assessTimeoutMs ?? DEFAULTS.assessTimeoutMs,
      failOn: /error/i,
      what: 'Stamper Assess (#cardStatus2)',
    });
    await shot('02-assessed.png');

    // 5. Seed the variable store BEFORE Translate — PlanTranslator merges it in
    //    as the highest-priority base, so the plan comes out self-contained.
    //    Consumed AT TRANSLATE TIME: it cannot be compensated for afterwards,
    //    which is why `execute-only` is only ever legal on a page that already
    //    translated with this seed in place.
    if (ctx.planVariables !== false) {
      variableSeed = await (ctx.seedVariables ?? seedPlanVariables)({
        slug: ctx.slug,
        seed: ctx.planVariables ?? buildPlanVariableSeed({ slug: ctx.slug }),
        baseUrl: ctx.baseUrl,
        variablesPath: tenantVariablesPath(ctx.pipelineRoot, ctx.slug),
      });
    }

    // 6. Translate (no id on the button).
    await expandCard(page, STAMPER_SELECTORS.card(3));
    translateResponse = await page.waitForResponse(
      '/api/translate',
      () => page.click(STAMPER_SELECTORS.translate),
      ctx.translateTimeoutMs ?? DEFAULTS.translateTimeoutMs,
    );
    await waitForText(page, STAMPER_SELECTORS.cardStatus3, /translated/i, {
      timeoutMs: ctx.translateTimeoutMs ?? DEFAULTS.translateTimeoutMs,
      failOn: /error/i,
      what: 'Stamper Translate (#cardStatus3)',
    });

    if (phase === 'through-translate') {
      return {
        phase,
        connected: true,
        assessed: true,
        translated: true,
        reportLinks: [],
        variableSeed,
        translateResponse,
        screenshots: shots,
      };
    }
  }

  // 7. Execute. [M0 CORRECTION] The target sticks on Dry Run after the initial
  //    `dev` selection — set it explicitly and prove it stuck, or the beat
  //    silently mutates nothing. `auto` raises no approval gates.
  await expandCard(page, STAMPER_SELECTORS.card(4));
  await page.selectOption(STAMPER_SELECTORS.execMode, 'auto');
  await page.selectOption(STAMPER_SELECTORS.execTarget, 'tenant');
  const target = await page.inputValue(STAMPER_SELECTORS.execTarget);
  if (target !== 'tenant') {
    throw new Error(
      `#execTargetSelect did not stick on "tenant" (read "${target}") — the GUI force-set Dry Run ` +
        '(REQ-STAMPER-GUI-EXEC-TARGET-STICKY-DRYRUN); refusing to run a beat that would mutate nothing',
    );
  }
  await shot('03-armed-live.png');

  await page.click(STAMPER_SELECTORS.execute);

  // DEMO PEEK: kick it off, PROVE it is running, watch it for a beat, then HALT
  // it and cut away. We do NOT leave it running: a ~7-13 min execute churning on
  // the backstage session crashes the muster discovery CLI on later slides
  // (measured — exit 3221226505, no artifact). Halting frees the tenant/session
  // so every later live act runs. Nothing here judges a report — none is awaited.
  // `/executing/i` matches only the "Executing…" running badge, never a terminal
  // `complete|failed|error|halted` (note `halted` contains "execut").
  const peekMs = ctx.executePeekMs ?? 0;
  if (peekMs > 0) {
    const runningBadge = await waitForText(page, STAMPER_SELECTORS.cardStatus4, /executing/i, {
      timeoutMs: 30_000,
      pollMs: 1000,
      failOn: /failed|error|halted/i,
      what: 'Stamper Execute to start (#cardStatus4)',
    });
    await shot('03b-execute-running.png');
    await sleep(peekMs);
    // Halt the run (best-effort — the button is present only while executing).
    let executeHalted = false;
    try {
      await page.click(STAMPER_SELECTORS.executeHalt);
      executeHalted = true;
    } catch {
      executeHalted = false;
    }
    const observedPeek = phase !== 'execute-only';
    return {
      phase,
      connected: observedPeek,
      assessed: observedPeek,
      translated: observedPeek,
      executeBadge: runningBadge,
      executeLeftRunning: !executeHalted,
      executeHalted,
      reportLinks: [],
      variableSeed,
      translateResponse,
      screenshots: shots,
    };
  }

  // Terminal states are `done`, `execution_halted`, `error` and the
  // EventSource error path — waiting on "Complete" alone hangs on the others.
  const executeBadge = await waitForText(page, STAMPER_SELECTORS.cardStatus4, /complete|failed|error|halted/i, {
    timeoutMs: ctx.executeTimeoutMs ?? DEFAULTS.executeTimeoutMs,
    pollMs: 2000,
    what: 'Stamper Execute (#cardStatus4)',
  });
  await shot('04-execute-terminal.png');

  // 8. Judge the artifact, never the badge. The GUI surfaces the report path in
  //    the results panel; the run-scoped plans dir is the fallback.
  const reportLinks = await page.texts(STAMPER_SELECTORS.reportLinks).catch(() => [] as string[]);
  const linkedJson = reportLinks.find((t) => t.toLowerCase().endsWith('.json') && t.includes('execution-report-'));
  const reportPath =
    linkedJson && fs.existsSync(linkedJson) ? linkedJson : findLatestExecutionReport(stamperPlansDir(ctx.pipelineRoot, ctx.slug));

  const observedInThisCall = phase !== 'execute-only';
  return {
    phase,
    // Observed-in-this-call, never asserted. `execute-only` inherited a page
    // that connected, assessed and translated; it did not do those things.
    connected: observedInThisCall,
    assessed: observedInThisCall,
    translated: observedInThisCall,
    executeBadge,
    reportLinks,
    reportPath,
    report: reportPath ? readExecutionReport(reportPath) : undefined,
    variableSeed,
    translateResponse,
    screenshots: shots,
  };
}

/** Drive the Stamper GUI in a real browser. Headless unless `--watch`. */
export const driveStamperUi: StamperUiDriver = async (ctx) => {
  const session = await openUiPage(ctx.baseUrl, ctx.watch ?? HEADLESS_MODE);
  try {
    return await runStamperUiFlow(session.page, ctx);
  } finally {
    await session.close();
  }
};
