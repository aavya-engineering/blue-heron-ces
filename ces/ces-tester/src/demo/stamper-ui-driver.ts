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
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
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
  UiWaitTimeoutError,
  waitForCondition,
  waitForText,
  wrapPlaywrightPage,
  type UiPage,
  type UiSession,
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

/**
 * W8-UIT1 selectors, from `public/index.html`. Kept OUT of `STAMPER_SELECTORS` on
 * purpose: that block is mirrored verbatim by the SPA's parity
 * `ui/e2e/parity/selectors.ts` (the contract test diffs the two), and adding keys
 * here first would break the mirror. The SPA adopts these when its execute,
 * ledger and evidence screens land.
 *
 * - `pendingApprove`: the Approve button of a pending gate in Incremental mode
 *   (`execModeSelect` value `manual`): a step-level row `#approval-<task>` or a
 *   sub-command row `.sub-approval-btns`. Batch-mode layer rows
 *   (`#layer-approval-<n>`) are excluded. A row is removed once its approval posts.
 */
export const STAMPER_UIT_SELECTORS = {
  infraManifestPath: '#configInfraManifestPath',
  /** W8-UIT3: legacy `button.btn-success`, or the SPA kit ApprovalCard's `button.ck-approval-approve`, in the same rows. */
  pendingApprove:
    '.approval-btns[id^="approval-"] button.btn-success, .sub-approval-btns button.btn-success, ' +
    '.approval-btns[id^="approval-"] button.ck-approval-approve, .sub-approval-btns button.ck-approval-approve',
  resourcesButton: '#resourcesFloatBtn',
  resourceLedgerPanel: '#resourceLedgerPanel',
  ledgerCount: '#ledgerCount',
  /** W8-UIT3: legacy `.ledger-close-btn`, or the SPA kit ResourceLedger's `.ck-ledger-close`. */
  ledgerClose: '#resourceLedgerPanel .ledger-close-btn, #resourceLedgerPanel .ck-ledger-close',
  evidenceScan: '#btnEvidenceScan',
  cardStatus5: '#cardStatus5',
} as const;

/**
 * W8-UIT3. Which console the drive is on. Legacy (`/`) is one page whose cards
 * expand in place; the SPA (`/app/`) renders one screen per card, reached
 * through the rail node `#railNode<n>` (n = card 0-5), never by a reload (a
 * reload drops the run state). As the SPA parity flow `openCard`
 * (ces-stamper/ui/e2e/parity/spa2-flow.ts).
 */
export type StamperConsoleVariant = 'legacy' | 'spa';
export const stamperRailNode = (n: number): string => `#railNode${n}`;
const SPA_CARD_TIMEOUT_MS = 30_000;

/** Bring card `n` on screen: legacy expands it by guard; the SPA opens its screen from the rail first. */
export async function openStamperCard(page: UiPage, n: number, variant: StamperConsoleVariant = 'legacy'): Promise<void> {
  if (variant === 'spa') {
    await page.click(stamperRailNode(n));
    await page.waitForSelector(STAMPER_SELECTORS.card(n), SPA_CARD_TIMEOUT_MS);
  }
  await expandCard(page, STAMPER_SELECTORS.card(n));
}

/** The legacy console's execute-mode option values: Incremental is `manual`. */
export const STAMPER_EXEC_MODE_VALUE = { auto: 'auto', incremental: 'manual' } as const;
export type StamperExecMode = keyof typeof STAMPER_EXEC_MODE_VALUE;

/** Console URL: the server origin plus the variant's base path (`/` legacy, `/app/` SPA); no path = the origin as given. Pure. */
export function stamperConsoleUrl(baseUrl: string, basePath?: string): string {
  if (basePath === undefined) return baseUrl;
  return `${baseUrl.replace(/\/+$/, '')}${basePath.startsWith('/') ? basePath : `/${basePath}`}`;
}

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
  /**
   * W8-UIT1. The console's base path on the server (`/` legacy, `/app/` SPA).
   * Only `driveStamperUi` reads it (the page it opens); API calls stay on
   * `baseUrl`. Undefined = open `baseUrl` as given (unchanged behaviour).
   */
  readonly basePath?: string;
  /**
   * W8-UIT3. The console the page shows: `spa` opens each card's screen from the
   * rail before using it. Undefined = `legacy` (unchanged behaviour).
   */
  readonly consoleVariant?: StamperConsoleVariant;
  /**
   * W8-UIT1. Execute mode. Undefined = `auto` exactly as before (no approval
   * gates, no execute window recorded). `incremental` selects the console's
   * Incremental mode and approves every pending gate in the console until a
   * terminal state; both explicit values record `executeWindow`.
   */
  readonly execMode?: StamperExecMode;
  /** W8-UIT1. After the execute: open the resource ledger and run the evidence scan in the console. */
  readonly readLedgerAndEvidence?: boolean;
  /** W8-UIT1. Step caption for watched runs (headed only); called before each step. */
  readonly caption?: (text: string) => Promise<void>;
  /** W8-UIT1. Poll interval of the approval loop (default 500 ms). */
  readonly approvalPollMs?: number;
  /** W8-UIT1. Record a Playwright video and trace into this folder (`driveStamperUi` only). */
  readonly recordDir?: string;
  /**
   * W8-UIT1. The Infrastructure Manifest path, filled into the Config card's
   * optional IM field with the other two (the twin's translate used the pushed
   * IM). Undefined = the field is left as the console set it (unchanged behaviour).
   */
  readonly infraManifestPath?: string;
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
  /** W8-UIT1: approvals clicked in Incremental mode. */
  readonly approvals?: number;
  /** PH-5 (V110): the id of each approval row clicked, in order (`approval-<escId(task)>`, `sub-approval-<task>-<sub>`). */
  readonly approvedRows?: readonly string[];
  /** W8-UIT1: from just before the Execute click to the terminal badge (ISO); set when `execMode` was given. */
  readonly executeWindow?: { readonly started: string; readonly ended: string };
  /** W8-UIT1: the console's resource ledger (`#ledgerCount` text), narrative only. */
  readonly resourceLedger?: { readonly countText?: string; readonly error?: string };
  /** W8-UIT1: the console's evidence scan (`GET /api/evidence-scan` body `summary`, from the browser's own traffic). */
  readonly evidenceScan?: { readonly summary?: unknown; readonly badge?: string; readonly error?: string };
  /** W8-UIT1: the Playwright video and trace of this drive. */
  readonly recording?: { readonly videoPath?: string; readonly tracePath?: string };
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
  const variant: StamperConsoleVariant = ctx.consoleVariant ?? 'legacy';
  let variableSeed: PlanVariableSeedResult | undefined;
  let translateResponse: unknown;
  // W8-UIT1: a step caption for watched runs; never fails a step.
  const say = async (text: string): Promise<void> => {
    if (!ctx.caption) return;
    try {
      await ctx.caption(text);
    } catch {
      /* narrative only */
    }
  };

  if (phase !== 'execute-only') {
    // 1. Tenant. The select is rebuilt from /api/tenants, so wait for OUR option.
    await say(`Tenant: select ${ctx.slug} and connect`);
    await page.waitForSelector(STAMPER_SELECTORS.tenantOption(ctx.slug), ctx.connectTimeoutMs ?? DEFAULTS.connectTimeoutMs);
    await openStamperCard(page, 0, variant);
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
    await say('Translate: mission plan and tenant manifest paths, then Assess');
    await openStamperCard(page, 1, variant);
    await page.fill(STAMPER_SELECTORS.missionPlanPath, ctx.missionPlanPath);
    await page.fill(STAMPER_SELECTORS.manifestPath, ctx.manifestPath);
    if (ctx.infraManifestPath !== undefined) await page.fill(STAMPER_UIT_SELECTORS.infraManifestPath, ctx.infraManifestPath);

    // 4. Assess — the step that unlocks Translate.
    await openStamperCard(page, 2, variant);
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
    await say('Translate: build the executable plan');
    await openStamperCard(page, 3, variant);
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
  const incremental = ctx.execMode === 'incremental';
  await say(incremental ? 'Approve and execute: Incremental mode, target Tenant' : 'Execute: target Tenant');
  await openStamperCard(page, 4, variant);
  await page.selectOption(STAMPER_SELECTORS.execMode, STAMPER_EXEC_MODE_VALUE[ctx.execMode ?? 'auto']);
  await page.selectOption(STAMPER_SELECTORS.execTarget, 'tenant');
  const target = await page.inputValue(STAMPER_SELECTORS.execTarget);
  if (target !== 'tenant') {
    throw new Error(
      `#execTargetSelect did not stick on "tenant" (read "${target}") — the GUI force-set Dry Run ` +
        '(REQ-STAMPER-GUI-EXEC-TARGET-STICKY-DRYRUN); refusing to run a beat that would mutate nothing',
    );
  }
  await shot('03-armed-live.png');

  const executeStarted = ctx.execMode !== undefined ? new Date().toISOString() : undefined;
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
  // W8-UIT1 Incremental: the same terminal wait, approving each pending gate as it appears.
  let approvals: number | undefined;
  let approvedRows: string[] | undefined;
  let executeBadge: string;
  if (incremental) {
    const r = await approveUntilTerminal(page, {
      timeoutMs: ctx.executeTimeoutMs ?? DEFAULTS.executeTimeoutMs,
      pollMs: ctx.approvalPollMs ?? 500,
    });
    approvals = r.approvals;
    approvedRows = r.rows;
    executeBadge = r.badge;
  } else {
    executeBadge = await waitForText(page, STAMPER_SELECTORS.cardStatus4, /complete|failed|error|halted/i, {
      timeoutMs: ctx.executeTimeoutMs ?? DEFAULTS.executeTimeoutMs,
      pollMs: 2000,
      what: 'Stamper Execute (#cardStatus4)',
    });
  }
  const executeWindow = executeStarted ? { started: executeStarted, ended: new Date().toISOString() } : undefined;
  await shot('04-execute-terminal.png');

  // 8. Judge the artifact, never the badge. The GUI surfaces the report path in
  //    the results panel; the run-scoped plans dir is the fallback.
  const reportLinks = await page.texts(STAMPER_SELECTORS.reportLinks).catch(() => [] as string[]);
  const linkedJson = reportLinks.find((t) => t.toLowerCase().endsWith('.json') && t.includes('execution-report-'));
  const reportPath =
    linkedJson && fs.existsSync(linkedJson) ? linkedJson : findLatestExecutionReport(stamperPlansDir(ctx.pipelineRoot, ctx.slug));

  // 9. W8-UIT1: the ledger and evidence reads, in the console (narrative; the
  //    judged ledger is the sim's, read by the caller). A failed read is
  //    recorded with its error, never reported as observed.
  let resourceLedger: StamperUiDriveResult['resourceLedger'];
  let evidenceScan: StamperUiDriveResult['evidenceScan'];
  if (ctx.readLedgerAndEvidence) {
    await say('Ledger: the resource ledger of this run');
    resourceLedger = await readResourceLedger(page);
    await shot('05-resource-ledger.png');
    await say('Evidence: scan the evidence store');
    evidenceScan = await readEvidenceScan(page, variant);
    await shot('06-evidence.png');
  }

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
    ...(approvals !== undefined ? { approvals } : {}),
    ...(approvedRows !== undefined ? { approvedRows } : {}),
    ...(executeWindow ? { executeWindow } : {}),
    ...(resourceLedger ? { resourceLedger } : {}),
    ...(evidenceScan ? { evidenceScan } : {}),
  };
}

const EXECUTE_TERMINAL = /complete|failed|error|halted/i;

/**
 * W8-UIT1 Incremental mode: until `#cardStatus4` reads a terminal state, click
 * the Approve button of whichever gate is pending (step-level or sub-command
 * level). The console removes a row once its approval posts; a second click on
 * a row that is just being removed posts an approval the server answers 404
 * ("No pending approval"), which changes nothing. Throws on timeout.
 */
/**
 * PH-5 (V110): the pending approval rows `pendingApprove` clicks into (legacy and SPA kit rows share these ids:
 * `approval-<escId(task)>`, `sub-approval-<escId(task)>-<escId(sub)>`). Kept out of the mirrored selector blocks.
 */
export const PENDING_APPROVAL_ROW = '.approval-btns[id^="approval-"], .sub-approval-btns';

export async function approveUntilTerminal(
  page: UiPage,
  opts: { readonly timeoutMs: number; readonly pollMs: number },
): Promise<{ approvals: number; badge: string; rows: string[] }> {
  const deadline = Date.now() + opts.timeoutMs;
  let approvals = 0;
  const rows: string[] = [];
  let last = '';
  for (;;) {
    last = (await page.textContent(STAMPER_SELECTORS.cardStatus4))?.trim() ?? '';
    if (EXECUTE_TERMINAL.test(last)) return { approvals, badge: last, rows };
    if ((await page.count(STAMPER_UIT_SELECTORS.pendingApprove)) > 0) {
      // PH-5 (V110): the row the click lands on (the first pending row, as the click's first button), for the EU probe.
      const row = await page.getAttribute(PENDING_APPROVAL_ROW, 'id').catch(() => null);
      if (row && rows[rows.length - 1] !== row) rows.push(row);
      await page.click(STAMPER_UIT_SELECTORS.pendingApprove);
      approvals++;
    }
    if (Date.now() >= deadline) {
      throw new UiWaitTimeoutError(`Stamper Incremental execute (#cardStatus4) after ${approvals} approval(s)`, opts.timeoutMs, last);
    }
    await sleep(opts.pollMs);
  }
}

/** Open the console's resource ledger, read its count line, close it. Best-effort. */
export async function readResourceLedger(page: UiPage): Promise<NonNullable<StamperUiDriveResult['resourceLedger']>> {
  try {
    if (!(await page.isVisible(STAMPER_UIT_SELECTORS.resourcesButton))) {
      return { error: 'resource ledger button not shown (no resources recorded by the console)' };
    }
    await page.click(STAMPER_UIT_SELECTORS.resourcesButton);
    const countText = (await page.textContent(STAMPER_UIT_SELECTORS.ledgerCount))?.trim() ?? undefined;
    await page.click(STAMPER_UIT_SELECTORS.ledgerClose).catch(() => undefined);
    return { countText };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** Expand the Evidence card and run its scan; the body comes from the browser's own `/api/evidence-scan`. Best-effort. */
export async function readEvidenceScan(
  page: UiPage,
  variant: StamperConsoleVariant = 'legacy',
): Promise<NonNullable<StamperUiDriveResult['evidenceScan']>> {
  try {
    await openStamperCard(page, 5, variant);
    const body = (await page.waitForResponse('/api/evidence-scan', () => page.click(STAMPER_UIT_SELECTORS.evidenceScan), 120_000)) as
      | { summary?: unknown; error?: unknown }
      | undefined;
    const badge = (await page.textContent(STAMPER_UIT_SELECTORS.cardStatus5))?.trim() ?? undefined;
    if (!body || body.summary === undefined) {
      return { badge, error: `evidence scan returned no summary${body?.error ? `: ${String(body.error)}` : ''}` };
    }
    return { summary: body.summary, badge };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** Drive the Stamper GUI in a real browser. Headless unless `--watch`. */
export const driveStamperUi: StamperUiDriver = async (ctx) => {
  const watch = ctx.watch ?? HEADLESS_MODE;
  const url = stamperConsoleUrl(ctx.baseUrl, ctx.basePath);
  if (!ctx.recordDir) {
    const session = await openUiPage(url, watch);
    try {
      return await runStamperUiFlow(session.page, ctx);
    } finally {
      await session.close();
    }
  }
  // W8-UIT1 (Watchable): video + trace always; a step caption when headed.
  const session = await openRecordedUiPage(url, watch, ctx.recordDir);
  const caption = ctx.caption ?? (watch.headless ? undefined : (text: string) => showCaption(session.raw, text));
  let result: StamperUiDriveResult | undefined;
  try {
    result = await runStamperUiFlow(session.page, { ...ctx, caption });
    return result;
  } finally {
    const recording = await session.closeRecording();
    if (result) Object.assign(result, { recording });
  }
};

/** The caption element id (as the SPA parity harness's `caption()`). */
export const WATCH_CAPTION_ID = 'ces-watch-caption';

/**
 * Browser-side source of the step caption: a fixed, click-through banner at the
 * bottom of the page. A string (not a function) so this Node-side module needs
 * no DOM types; it is evaluated in the page.
 */
export function captionScript(text: string): string {
  return (
    `(() => { const t = ${JSON.stringify(text)}; let el = document.getElementById(${JSON.stringify(WATCH_CAPTION_ID)});` +
    ` if (!el) { el = document.createElement('div'); el.id = ${JSON.stringify(WATCH_CAPTION_ID)};` +
    ` el.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483647;pointer-events:none;` +
    `background:rgba(13,17,23,0.88);color:#f0f6fc;font:600 16px/1.3 system-ui,sans-serif;padding:8px 16px;border-radius:6px;` +
    `box-shadow:0 2px 10px rgba(0,0,0,0.4);max-width:80vw;text-align:center;';` +
    ` document.body.appendChild(el); } el.textContent = t; })()`
  );
}

async function showCaption(raw: Page, text: string): Promise<void> {
  await raw.evaluate(captionScript(text));
}

export interface RecordedUiSession extends UiSession {
  /** Stops the trace into `<dir>/trace.zip`, closes the context (which writes the video), closes the browser. */
  closeRecording(): Promise<{ videoPath?: string; tracePath?: string }>;
}

/**
 * W8-UIT1: a launch site that records. A video (`recordVideo`) and a Playwright
 * trace (screenshots and DOM snapshots) for every drive, under `dir`, so a
 * watched run can be replayed (`npx playwright show-trace <dir>/trace.zip`).
 * Same `WatchMode` spread as `openUiPage`: headed and paced unless headless.
 */
export async function openRecordedUiPage(url: string, watch: WatchMode, dir: string): Promise<RecordedUiSession> {
  fs.mkdirSync(dir, { recursive: true });
  const browser: Browser = await chromium.launch({ headless: watch.headless, slowMo: watch.slowMo });
  let context: BrowserContext;
  let page: Page;
  try {
    context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      recordVideo: { dir, size: { width: 1440, height: 900 } },
      acceptDownloads: true,
    });
    await context.tracing.start({ screenshots: true, snapshots: true });
    page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  } catch (err) {
    await browser.close().catch(() => undefined);
    throw err;
  }
  const tracePath = path.join(dir, 'trace.zip');
  let closed = false;
  const closeRecording = async (): Promise<{ videoPath?: string; tracePath?: string }> => {
    if (closed) return {};
    closed = true;
    let videoPath: string | undefined;
    let traced: string | undefined;
    try {
      await context.tracing.stop({ path: tracePath });
      traced = tracePath;
    } catch {
      traced = undefined;
    }
    try {
      videoPath = await page.video()?.path();
    } catch {
      videoPath = undefined;
    }
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
    return { videoPath, tracePath: traced };
  };
  return {
    page: wrapPlaywrightPage(page),
    raw: page,
    close: async () => {
      await closeRecording();
    },
    closeRecording,
  };
}
