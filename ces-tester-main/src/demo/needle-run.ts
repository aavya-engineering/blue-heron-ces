// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-1 iteration 5 — the REAL before->after needle on demo-dib-small.
 *
 * Recommended path (GP-DEMO-1 SOLE-ORCHESTRATOR authorization, iter5):
 *   1. reset+seed demo-dib-small to pristine (report-only MFA gap, the
 *      headline per docs/demo/DEMO-PROFILE-STORY.md) -> serve :4390.
 *   2. EO live connect+assess -> BEFORE baseline (real per-control
 *      determinations, reusing the already-proven `runEoLeg`).
 *   3. Register demo-dib-small as an ephemeral sim tenant in ces-tenant's
 *      registry (Stamper's `--tenant` resolution needs a registry record;
 *      independent of stacksim's own store, which step 1 already seeded).
 *   4. Drive Muster's real wizard (Playwright) with the already-proven
 *      `clean-tenant-mfa-baseline` answer map to produce a REAL Mission Plan
 *      + Tenant Manifest carrying the IA.L2-3.5.3 (MFA) implement directive
 *      (GP-STAMPER-1 fixed the injection-guard bug that used to block this;
 *      GP-TESTER-1 M4 confirmed it green live).
 *   5. Stamper translate+execute against the SAME served, still-running
 *      demo-dib-small tenant — a real, ledger-recorded PATCH through the sim
 *      resolver (no re-seed between BEFORE and AFTER: only this remediation
 *      changes state).
 *   6. EO live connect+assess again -> AFTER (same tenant, now remediated).
 *
 * Honesty contract (HARD RULE, GP-DEMO-1 iter5): every phase after BEFORE is
 * wrapped so a genuine failure degrades to a real partial (`before` only,
 * `after` omitted, `remediationError` set) — never fabricate an "after".
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { startServe, type ServeHandle } from '../stacksim-client/serve-lifecycle.js';
import { waitUntilReady } from '../stacksim-client/ready-check.js';
import { queryLedger, DEFAULT_STACKSIM_SERVER_URL } from '../stacksim-client/http.js';
import { startDevServer, waitForDevServerReady, devServerBaseUrl, type DevServerHandle } from '../muster-driver/dev-server.js';
import { driveMuster } from '../muster-driver/drive-muster.js';
import { CLEAN_TENANT_MFA_BASELINE_ANSWER_MAP } from '../muster-driver/answer-map.js';
import { launchStamperTranslateAndExecute } from '../stamper-launcher/launch.js';
import { mergeSimLaunchEnv } from '../stamper-launcher/env.js';
import { writeSyntheticStamperEnv } from '../stamper-launcher/synthetic-env.js';
import { partitionFailures } from './known-false-fails.js';
import { HEADLESS_MODE, type WatchMode } from './watch-mode.js';
import {
  createTenantRegistry,
  createEphemeralSimTenant,
  teardownEphemeralSimTenant,
  getSimLaunchEnv,
} from '../tenant-registry/index.js';
import { runEoLeg, type EoLegResult, type EoAssessSummary } from './eo-leg.js';
import { countSetSubs } from '../cli/run-scenario-command.js';
import type { UnifiedDemoResult } from '../results/unified-dashboard.js';

/** The one control this pipeline deliberately remediates (the demo's headline gap). */
export const DEMO_MFA_CONTROL_ID = 'IA.L2-3.5.3';

export interface NeedleRunOptions {
  readonly testerRoot: string;
  readonly stacksimRoot: string;
  readonly plannerRoot: string;
  readonly stamperRoot: string;
  readonly eoRoot: string;
  readonly slug: string;
  readonly simTenantJson: unknown;
  readonly runId: string;
  /** GP-DEMO-3 M1: browser visibility for every Playwright leg in this run.
   * Omitted = headless (the default); `--watch` supplies the headed mode. */
  readonly watch?: WatchMode;
  readonly plannerPort?: number;
}

export interface NeedleRunResult {
  readonly tenant: string;
  readonly before: EoLegResult;
  readonly after?: EoLegResult;
  readonly missionPlanPath?: string;
  readonly manifestPath?: string;
  readonly ledgerSnapshotPath?: string;
  readonly setSubCount?: number;
  /** Stamper execute status ('complete' | 'partial' | ...). */
  readonly executeStatus?: string;
  /** Failed task entry-ids from the execution report. With the known-false-FAIL
   * registry, these decide presentability: failures confined to the KNOWN
   * stable set are nameable on stage; any unexpected failure stages the after. */
  readonly failedTaskIds?: readonly string[];
  readonly remediationError?: string;
}

async function ensureDir(p: string): Promise<string> {
  await fs.mkdir(p, { recursive: true });
  return p;
}

function spawnNode(cwd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', args, { cwd });
    let err = '';
    child.stderr?.on('data', (c: Buffer) => (err += c.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`node ${args.join(' ')} exited ${code}\n${err.trim()}`)),
    );
  });
}

/** Re-materializes demo-dib-small to pristine (regenerate scenario from
 * config, then `scenario <slug>`). Server MUST be down (S1 exclusive-lock). */
export async function resetDemoDibSmallTenant(stacksimRoot: string, slug: string): Promise<void> {
  await spawnNode(stacksimRoot, [path.join('scripts', 'build-demo-scenario.mjs')]);
  await spawnNode(stacksimRoot, [path.join('bin', 'stacksim.mjs'), 'scenario', slug]);
}

export interface ExecuteReportInfo {
  readonly status?: string; // 'complete' | 'partial' | ...
  /** Registry entry-ids of failed tasks (e.g. 'MP.L2-3.8.1.cui-label'), parsed
   * from the report's failed_tasks[].error prefix ("<entry-id>: verification
   * failed — ..."). */
  readonly failedEntryIds: readonly string[];
}

/** Read the Stamper execution-report (status + failed task entry-ids) from the
 * run's stamper-storage. Founder direction (2026-07-28): the demo bar is ONE
 * clean run — a `partial` execute whose failures are confined to the KNOWN
 * stable set is presentable (nameable on stage); failures OUTSIDE that set are
 * the load-induced extras that make the after non-deterministic (it can even
 * regress) and must stay off the screen. Returns {failedEntryIds: []} with an
 * undefined status if no report is found. */
async function readExecuteReport(stamperStorageRoot: string): Promise<ExecuteReportInfo> {
  const stateDir = path.join(stamperStorageRoot, 'state');
  let status: string | undefined;
  let failedEntryIds: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.name.startsWith('execution-report-') && e.name.endsWith('.json')) {
        try {
          const rep = JSON.parse(await fs.readFile(full, 'utf8')) as {
            status?: unknown;
            failed_tasks?: Array<{ error?: unknown }>;
          };
          if (typeof rep.status === 'string') status = rep.status;
          if (Array.isArray(rep.failed_tasks)) {
            failedEntryIds = rep.failed_tasks
              .map((t) => (typeof t.error === 'string' ? t.error.split(':')[0].trim() : ''))
              .filter((id) => id.length > 0);
          }
        } catch {
          /* ignore */
        }
      }
    }
  };
  await walk(stateDir);
  return { status, failedEntryIds };
}

async function snapshotLedger(testerRoot: string, runId: string, serverUrl: string): Promise<string | undefined> {
  try {
    const entries = await queryLedger(serverUrl, {});
    const relPath = path.join('runs', 'demo', runId, 'ledger-snapshot.json');
    const absPath = path.join(testerRoot, relPath);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, JSON.stringify(entries, null, 2), 'utf8');
    return relPath.split(path.sep).join('/');
  } catch {
    return undefined;
  }
}

export async function runNeedleRemediation(opts: NeedleRunOptions): Promise<NeedleRunResult> {
  const watch: WatchMode = opts.watch ?? HEADLESS_MODE;
  const eoOpts = {
    eoRoot: opts.eoRoot,
    simRoot: opts.stacksimRoot,
    stamperRegistry: path.resolve(opts.stamperRoot, 'src', 'registry', 'cmmc-l2-commands.registry.json'),
    slug: opts.slug,
    simTenantJson: opts.simTenantJson,
    controlIds: [DEMO_MFA_CONTROL_ID],
  };

  // Phase 0: pristine reset — server must be DOWN for this (S1 lock).
  await resetDemoDibSmallTenant(opts.stacksimRoot, opts.slug);

  const registry = createTenantRegistry({ stacksimRoot: opts.stacksimRoot });
  let serveHandle: ServeHandle | undefined;
  let devServer: DevServerHandle | undefined;
  let registered = false;

  try {
    serveHandle = await startServe({
      stacksimRoot: opts.stacksimRoot,
      stance: 'm365_azure',
      slug: opts.slug,
      logPath: path.join(await ensureDir(path.join(opts.testerRoot, 'runs', 'demo')), 'stacksim-serve.log'),
    });
    await waitUntilReady({
      serverUrl: DEFAULT_STACKSIM_SERVER_URL,
      method: 'GET',
      uri: '/v1.0/identity/conditionalAccess/policies',
    });

    // Phase 1: BEFORE — real, live, pre-remediation.
    const before = await runEoLeg(eoOpts);
    const beforeLive = before.available && before.connected && (before.summary?.liveAssessmentCount ?? 0) > 0;
    if (!beforeLive) {
      // No real baseline — don't spend a live Muster+Stamper cycle chasing an
      // "after" that would have nothing honest to compare against.
      return { tenant: opts.slug, before, remediationError: `no live BEFORE baseline (${before.error ?? 'unavailable'})` };
    }

    // Phases 2-3: remediation + AFTER. Any genuine failure degrades to an
    // honest before-only result (HARD RULE — never fabricate "after").
    try {
      await createEphemeralSimTenant(registry, opts.slug, { stance: 'm365_azure' });
      registered = true;

      const plannerPort = opts.plannerPort ?? 5173;
      devServer = startDevServer({
        plannerRoot: opts.plannerRoot,
        port: plannerPort,
        graphBaseUrl: `${DEFAULT_STACKSIM_SERVER_URL}/v1.0`,
      });
      await waitForDevServerReady(devServerBaseUrl(plannerPort));

      const workspaceDir = path.join(opts.testerRoot, 'runs', 'demo', opts.runId);
      const artifactsDir = await ensureDir(path.join(workspaceDir, 'artifacts'));
      const { missionPlanPath, manifestPath } = await driveMuster({
        baseUrl: devServerBaseUrl(plannerPort),
        customerName: `ces-tester-needle-${opts.runId}`,
        answerMap: CLEAN_TENANT_MFA_BASELINE_ANSWER_MAP,
        stamperTargetDir: artifactsDir,
        headless: watch.headless,
        slowMo: watch.slowMo,
      });

      await devServer.stop();
      devServer = undefined;

      const stamperStorageRoot = await ensureDir(path.join(workspaceDir, 'stamper-storage'));
      const envFilePath = await writeSyntheticStamperEnv(workspaceDir, { storageRoot: stamperStorageRoot });
      const simLaunchEnv = await getSimLaunchEnv(registry, opts.slug, { stacksimRoot: opts.stacksimRoot });
      const stamperChildEnv = mergeSimLaunchEnv({ simLaunchEnv });
      const outputPath = path.join(artifactsDir, 'executable-plan.json');

      await launchStamperTranslateAndExecute({
        stamperRoot: opts.stamperRoot,
        env: stamperChildEnv,
        missionPlanPath,
        manifestPath,
        tenantSlug: opts.slug,
        outputPath,
        envFilePath,
      });
      const setSubCount = countSetSubs(JSON.parse(await fs.readFile(outputPath, 'utf8')));
      const executeReport = await readExecuteReport(stamperStorageRoot);
      const ledgerSnapshotPath = await snapshotLedger(opts.testerRoot, opts.runId, DEFAULT_STACKSIM_SERVER_URL);

      // Phase 3: AFTER — same served, now-remediated tenant.
      const after = await runEoLeg(eoOpts);

      return {
        tenant: opts.slug,
        before,
        after,
        missionPlanPath,
        manifestPath,
        ledgerSnapshotPath,
        setSubCount,
        executeStatus: executeReport.status,
        failedTaskIds: executeReport.failedEntryIds,
      };
    } catch (err) {
      return { tenant: opts.slug, before, remediationError: err instanceof Error ? err.message : String(err) };
    }
  } finally {
    if (devServer) await (devServer as DevServerHandle).stop();
    if (serveHandle) await serveHandle.stop();
    if (registered) await teardownEphemeralSimTenant(registry, opts.slug);
  }
}

/**
 * GP-DEMO-1 iter5 — pure mapping from a `NeedleRunResult` (real EO
 * before/after + remediation metadata) to the unified dashboard model. Pure,
 * unit-tested. Never fabricates: `after` numbers only appear when a live
 * post-remediation EO assess genuinely ran; otherwise the dashboard stays
 * honestly STAGED with `before` real and `after` omitted (a real partial
 * beats a fake full needle — HARD RULE).
 */
const SPRS_LABEL =
  "SPRS shown here is EO's control-detail score (a per-control signal rollup) — not the certified Muster headline SPRS (one-SPRS rule: Muster owns the headline).";

function totalControls(s: EoAssessSummary | undefined): number {
  if (!s) return 110;
  return (
    (s.controlsMet ?? 0) + (s.controlsNotMet ?? 0) + (s.controlsPartial ?? 0) + (s.controlsNotAssessed ?? 0) || 110
  );
}

function isLive(eo: EoLegResult | undefined): boolean {
  return !!eo && eo.available && eo.connected && (eo.summary?.liveAssessmentCount ?? 0) > 0;
}

export function buildUnifiedFromNeedleRun(run: NeedleRunResult, generatedAt: string): UnifiedDemoResult {
  const beforeS = run.before.summary ?? {};
  const metBefore = beforeS.controlsMet ?? 0;
  const totalBefore = totalControls(run.before.summary);
  const mfaBefore = run.before.controls?.find((c) => c.controlId === DEMO_MFA_CONTROL_ID);

  if (!isLive(run.before)) {
    return {
      tenant: run.tenant,
      generatedAt,
      sprs: { before: 0, after: 0, max: 110 },
      controls: { total: 110, metBefore: 0, metAfter: 0 },
      findings: [],
      evidence: [],
      beats: [
        { id: 0, label: 'seed demo-dib-small (pristine, report-only MFA gap) -> serve :4390', status: 'pass' },
        { id: 1, label: `EO baseline unavailable (${run.before.error ?? 'unavailable'})`, status: 'staged' },
        { id: 2, label: 'Muster wizard -> Stamper MFA remediation', status: 'staged' },
        { id: 3, label: 'EO re-assess (after)', status: 'staged' },
        { id: 4, label: 'unified before->after SPRS needle', status: 'staged' },
      ],
    };
  }

  const evidenceBefore = beforeS.snapshotId
    ? [{ name: `eo-snapshot-before-${beforeS.snapshotId}.json`, kind: 'EO assessment snapshot (before)' }]
    : [];

  // Reliability rule (founder-calibrated 2026-07-28 — the demo bar is ONE clean
  // run, shown truthfully): the REAL needle renders whenever the AFTER is live
  // and did not regress, with the execute's failure split printed transparently
  // on the beat label ("97/110 applied; N known + M under diagnosis" — the
  // known-false-FAIL registry names the stable core; the drifters are called
  // out, never hidden). Validated across quiet-box runs (+8, +18); the only
  // observed regression came from an orchestration-loaded box, and a regression
  // (or a missing execute report) still STAGES the after. Never fabricate;
  // never show a regression (HARD RULES unchanged).
  const metAfterRaw = run.after?.summary?.controlsMet;
  const partition = partitionFailures(run.failedTaskIds ?? []);
  const unexpectedFails = partition.unexpected;
  const executeUnknown = run.executeStatus === undefined && run.failedTaskIds === undefined;
  const regressed = isLive(run.after) && typeof metAfterRaw === 'number' && metAfterRaw < metBefore;
  const afterReliable = isLive(run.after) && !regressed && !executeUnknown;

  if (!afterReliable) {
    const reason = !isLive(run.after)
      ? `after did not run (${run.remediationError ?? 'remediation did not complete'})`
      : regressed
        ? `after regressed (${metAfterRaw} < ${metBefore} met) — Stamper execute '${run.executeStatus}' partially applied under load and broke controls`
        : 'execute report unavailable — cannot confirm what applied, after not shown as a reliable needle';
    return {
      tenant: run.tenant,
      generatedAt,
      sprsLabel: SPRS_LABEL,
      sprs: { before: beforeS.sprsScore ?? 0, after: beforeS.sprsScore ?? 0, max: 110 },
      controls: { total: totalBefore, metBefore, metAfter: metBefore },
      findings: mfaBefore
        ? [
            {
              control: mfaBefore.controlId,
              title: 'Multifactor Authentication (report-only CA policy)',
              statusBefore: mfaBefore.status,
              statusAfter: mfaBefore.status,
            },
          ]
        : [],
      evidence: evidenceBefore,
      beats: [
        { id: 0, label: 'seed demo-dib-small (pristine, report-only MFA gap) -> serve :4390', status: 'pass' },
        {
          id: 1,
          label: `EO live assess (before): ${beforeS.liveAssessmentCount} assessments, ${metBefore}/${totalBefore} met (EO detail SPRS ${beforeS.sprsScore})`,
          status: 'pass',
        },
        { id: 2, label: `Stamper remediation: ${run.setSubCount ?? 0} set-command(s) attempted`, status: 'pass' },
        { id: 3, label: `EO re-assess (after) STAGED — ${reason}`, status: 'staged' },
        { id: 4, label: 'unified before->after SPRS needle STAGED — needs a deterministic (complete) Stamper execute', status: 'staged' },
      ],
    };
  }

  const after = run.after!;
  const afterS = after.summary ?? {};
  const metAfter = afterS.controlsMet ?? metBefore;
  const totalAfter = totalControls(after.summary) || totalBefore;
  const mfaAfter = after.controls?.find((c) => c.controlId === DEMO_MFA_CONTROL_ID);

  const findings: UnifiedDemoResult['findings'] = [];
  if (mfaBefore || mfaAfter) {
    findings.push({
      control: (mfaAfter ?? mfaBefore)!.controlId,
      title: 'Multifactor Authentication (report-only CA policy -> Stamper-enforced)',
      statusBefore: mfaBefore?.status ?? 'not_assessed',
      statusAfter: mfaAfter?.status ?? mfaBefore?.status ?? 'not_assessed',
    });
  }

  const evidence = [...evidenceBefore];
  if (afterS.snapshotId) {
    evidence.push({ name: `eo-snapshot-after-${afterS.snapshotId}.json`, kind: 'EO assessment snapshot (after)' });
  }
  if (run.ledgerSnapshotPath) {
    evidence.push({ name: run.ledgerSnapshotPath, kind: 'stacksim ledger snapshot (real, Stamper-recorded)' });
  }

  return {
    tenant: run.tenant,
    generatedAt,
    sprsLabel: SPRS_LABEL,
    sprs: { before: beforeS.sprsScore ?? 0, after: afterS.sprsScore ?? 0, max: 110 },
    controls: { total: totalAfter, metBefore, metAfter },
    findings,
    evidence,
    beats: [
      { id: 0, label: 'seed demo-dib-small (pristine, report-only MFA gap) -> serve :4390', status: 'pass' },
      {
        id: 1,
        label: `EO live assess (before): ${beforeS.liveAssessmentCount} assessments, ${metBefore}/${totalBefore} met (EO detail SPRS ${beforeS.sprsScore})`,
        status: 'pass',
      },
      {
        id: 2,
        // Transparency over suppression: name the failure split out loud —
        // "N known (stable set under Stamper-side diagnosis) + M additional".
        label: `Stamper apply+verify remediation (${run.setSubCount ?? 0} set-command(s), ledger-recorded)${
          (run.failedTaskIds?.length ?? 0) > 0
            ? ` — ${run.failedTaskIds!.length} task(s) not verified: ${partition.explained.length} known-set + ${unexpectedFails.length} under diagnosis${
                unexpectedFails.length > 0 ? ` (${unexpectedFails.slice(0, 4).join(', ')}${unexpectedFails.length > 4 ? ', …' : ''})` : ''
              }`
            : ' — all tasks verified'
        }`,
        status: 'pass',
        artifactRef: run.ledgerSnapshotPath,
      },
      {
        id: 3,
        label: `EO live assess (after): ${afterS.liveAssessmentCount} assessments, ${metAfter}/${totalAfter} met (EO detail SPRS ${afterS.sprsScore})`,
        status: 'pass',
      },
      { id: 4, label: 'unified before->after SPRS needle', status: 'pass' },
    ],
  };
}
