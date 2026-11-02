// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 — `muster-readiness`: ces-muster on stage as **"Readiness
 * Evaluation (RE)"** (THREAD_HANDOFF stage naming, binding).
 *
 * Four facts force this design. None of them is negotiable, and each has been
 * "improved" away by a well-meaning refactor before, so they are stated here
 * rather than left to be rediscovered:
 *
 * **1. It runs the real evaluation AND streams the Muster SPA operating on it
 * (GP-DEMO-5 streamgui).** THREAD_HANDOFF originally barred a live RE product
 * demo; **decision 9 (2026-09-06) lifted that for RE**, and GP-DEMO-5 gives this
 * op the SPA drive. On the SUCCESS path it now: spawns the real CLI evaluation
 * (below), navigates the visible pane to the armed Muster SPA (:4173), and
 * IMPORTS this run's `readiness-result` through the SPA's honest file-input seam
 * (`driveMusterImportDiscovery`), ending on the boundary confirm panel — the SPA
 * left operating on stage. It NEVER clicks the SPA's own "Run Discovery" button,
 * which loads a zero-network fixture; the real CLI artifact is what feeds the UI.
 *
 * The **outcome readout card** renders into the pane ONLY on the degraded path —
 * the CLI is not built, the artifact is unreadable, or the SPA is not armed. On
 * the success path the SPA itself is the on-stage surface, so the op does NOT
 * navigate the pane to the card (that would wipe the SPA off the streamed pane).
 *
 * It keeps its distinct RE identity — the four-value posture tally,
 * `NO_SCORE_LINE`, the read-only ledger proof — in the log and the artifact,
 * shared with `muster-auto-analysis` only through the `driveMusterImportDiscovery`
 * seam (not aliased to it: this op is standalone, with no `muster-connect-tenant`
 * precondition, so it navigates the SPA itself).
 *
 * **2. ces-planner is not ces-muster.** `src/muster-driver/*` (Playwright, Vite
 * on :5173) drives **ces-planner's** wizard. The real ces-muster readiness
 * EVALUATOR is a headless CLI — `muster-api/dist/cli/bin.js discovery --sim` —
 * so the evaluation half spawns a process, not a GUI. The SPA it imports the
 * result INTO is ces-muster's React preview on :4173, armed by `arm-muster.ts`
 * and driven through `muster-ui-driver.ts`'s `data-testid` selectors (the same
 * seam the Muster GUI acts use). So this op arms the SPA (:4173) beyond the
 * stacksim serve, and drives it — it just never runs the EVALUATION through a UI.
 *
 * **3. No readiness SCORE exists here.** `mu discovery` yields
 * `observations[].derived_posture` and nothing else. Muster's SPRS machinery
 * (`muster-api/src/services/sprsCalc.ts`, `mu sprs`) is never invoked by
 * ces-tester, and every `sprsScore` in `src/` is **EO's** detail score. The REQ
 * asks to "surface score availability", and the honest answer is that **no
 * readiness score is available from DISCOVERY-1** — the readout says exactly
 * that. Do not narrate a score here, and do not borrow EO's.
 *
 * **4. DISCOVERY-1 is presence-based.** `IA.L2-3.5.3` reads `met` on
 * `demo-dib-small` BEFORE any remediation, because the policy exists but is
 * report-only (`REQ-MUSTER-DISCOVERY-STATE-BLINDNESS`). This op must never
 * narrate "and here it finds the MFA gap". Gap depth belongs to EO.
 *
 * **5. The posture domain has FOUR values, not two.**
 * `../ces-muster/public/schemas/readiness-result.schema.json` permits `met`,
 * `not_met`, `partial` and `unknown`. ces-tester's two-value expectation
 * (`e2e-configs.ts`, enforced in `eval-run.ts`) is a *pinned expectation* for
 * one retained run, not the wire contract. The readout tallies all four plus an
 * `other` bucket for anything the schema gains later — an on-stage tally that
 * silently drops postures is precisely the dishonesty these guards exist to
 * prevent.
 *
 * Two operational rules round it out:
 *
 * - **Judge the artifact, not the exit code.** `mu discovery` can exit
 *   `3221226505` (`0xC0000409`, the known Windows libuv teardown assertion)
 *   AFTER writing a complete, valid artifact.
 * - **Self-gate, never throw mid-demo.** A missing `dist/cli/bin.js` renders an
 *   "evaluation unavailable" readout and says why. ces-tester never builds a
 *   sibling, so `../ces-muster/muster-api/dist/` is an operator prerequisite.
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { queryLedger } from '../../../stacksim-client/http.js';
import { WINDOWS_LIBUV_TEARDOWN_EXIT } from '../../e2e-run.js';
import { escapeHtml } from '../slide-render.js';
import { htmlDataUrl, hudSurfaceOf } from '../app-pane.js';
import { driveMusterFillManifest, driveMusterImportDiscovery } from '../../muster-ui-driver.js';
import { formatElapsed, hudTicker, paneHud } from '../theatrical-page.js';
import { CAPTIONS } from '../captions.js';
import { MUSTER_DEMO_OPERATOR_NAME, MUSTER_DEMO_OPERATOR_ROLE } from './muster-connect-tenant-op.js';
import type { OpDriveContext, OpImplementation } from '../op-registry.js';

const CAP = CAPTIONS['muster-readiness'];

/** The posture domain, verbatim from ces-muster's readiness-result schema. */
export const READINESS_POSTURES = ['met', 'not_met', 'partial', 'unknown'] as const;

export type ReadinessPosture = (typeof READINESS_POSTURES)[number];

export interface PostureTally {
  readonly met: number;
  readonly not_met: number;
  readonly partial: number;
  readonly unknown: number;
  /** Anything the schema gains later. Counted and NAMED, never silently dropped. */
  readonly other: number;
  readonly otherValues: readonly string[];
  readonly total: number;
}

/** One observation, as much of it as this op reads. */
interface Observation {
  readonly control_id?: unknown;
  readonly derived_posture?: unknown;
}

/**
 * Tally every posture in the artifact. Pure, and exported so the four-value
 * guarantee is directly assertable against a fixture rather than inferred from
 * a screenshot.
 */
export function tallyPostures(observations: readonly unknown[]): PostureTally {
  const counts: Record<string, number> = { met: 0, not_met: 0, partial: 0, unknown: 0 };
  let other = 0;
  const otherValues: string[] = [];
  for (const raw of observations) {
    const posture = (raw as Observation | null)?.derived_posture;
    const key = typeof posture === 'string' ? posture : '(missing)';
    if (key in counts) {
      counts[key] += 1;
    } else {
      other += 1;
      if (!otherValues.includes(key)) otherValues.push(key);
    }
  }
  return {
    met: counts.met,
    not_met: counts.not_met,
    partial: counts.partial,
    unknown: counts.unknown,
    other,
    otherValues,
    total: observations.length,
  };
}

/** The line the REQ's "surface score availability" resolves to. Stated, not implied. */
export const NO_SCORE_LINE =
  'Readiness score: not produced by DISCOVERY-1 (presence-based evaluation; per-control posture only).';

export interface SpawnResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Every side effect this op has, injectable so the tests need no ces-muster. */
export interface MusterReadinessDeps {
  readonly spawnCli?: (
    command: string,
    args: readonly string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
  ) => Promise<SpawnResult>;
  readonly fileExists?: (absPath: string) => boolean;
  readonly readArtifact?: (absPath: string) => Promise<string>;
  /** stacksim create+mutate count — the read-only proof. */
  readonly ledgerWrites?: (simUrl: string) => Promise<number>;
}

function defaultSpawn(
  command: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { cwd, env });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (c: Buffer) => (stdout += c.toString('utf8')));
    child.stderr?.on('data', (c: Buffer) => (stderr += c.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }));
  });
}

/**
 * The two-query create+mutate count. `ledgerWriteCount` in `eval-run.ts` is
 * private; the pattern is restated rather than copied into a third place by
 * exporting from a module this one has no other reason to import.
 */
async function defaultLedgerWrites(simUrl: string): Promise<number> {
  const [creates, mutates] = await Promise.all([
    queryLedger(simUrl, { type: 'create' }),
    queryLedger(simUrl, { type: 'mutate' }),
  ]);
  return creates.length + mutates.length;
}

/** What the readout paints. Assembled by `evaluate`, rendered by `readoutHtml`. */
export interface ReadinessOutcome {
  readonly available: boolean;
  /** Present when `available` is false — why the beat degraded. */
  readonly unavailableReason?: string;
  readonly tally?: PostureTally;
  readonly artifactPath?: string;
  readonly ledgerDelta?: number;
  readonly exitCode?: number;
  readonly slug: string;
  /** Per-control postures, for the `detail=controls` readout. */
  readonly controls?: readonly { readonly controlId: string; readonly posture: string }[];
}

/** The readout is a slide, not a report — the artifact carries the full list. */
const MAX_LISTED_CONTROLS = 24;

/** `<musterRoot>/muster-api/dist/cli/bin.js` — the operator prerequisite. */
export function musterCliPath(musterRoot: string): string {
  return path.join(musterRoot, 'muster-api', 'dist', 'cli', 'bin.js');
}

/**
 * Run the evaluation for real and judge the ARTIFACT. Never throws for a
 * missing sibling build or a bad exit code — those become an honest
 * "unavailable" readout. It still throws if the CLI ran, exited cleanly and
 * produced something that is not a readiness result: that is a real breakage,
 * not a degraded environment, and hiding it would be the dishonesty.
 */
async function evaluate(ctx: OpDriveContext, deps: MusterReadinessDeps): Promise<ReadinessOutcome> {
  const fileExists = deps.fileExists ?? ((p: string) => fs.existsSync(p));
  const spawnCli = deps.spawnCli ?? defaultSpawn;
  const readArtifact = deps.readArtifact ?? ((p: string) => fsp.readFile(p, 'utf8'));
  const ledgerWrites = deps.ledgerWrites ?? defaultLedgerWrites;

  const musterRoot = ctx.armed.musterRoot;
  const slug = ctx.armed.slug;

  const cliPath = musterCliPath(musterRoot);
  if (!fileExists(cliPath)) {
    const reason =
      `ces-muster's discovery CLI is not built: ${cliPath}. ` +
      'Run `npm run build` in ces-muster — ces-tester never builds a sibling.';
    ctx.log(`  op muster-readiness: UNAVAILABLE — ${reason}`);
    return { available: false, unavailableReason: reason, slug };
  }

  const outPath = path.join(ctx.armed.runDir, 'muster-readiness.json');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    STAMPER_REGISTRY_ROOT: path.resolve(ctx.armed.stamperRoot, 'src', 'registry'),
  };

  // The read-only proof brackets the spawn. `simUrl` is absent only if arming
  // was told to skip the serve, which this op's preconditions forbid.
  const simUrl = ctx.armed.simUrl;
  let baseline: number | undefined;
  if (simUrl) {
    baseline = await ledgerWrites(simUrl).catch(() => undefined);
  }

  const started = Date.now();
  const cli = await spawnCli(
    'node',
    [cliPath, 'discovery', '--sim', '--slug', slug, '--out', outPath],
    musterRoot,
    env,
  );
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  // Artifact-first: the CLI writes and validates its result, then Node's
  // Windows teardown can abort AFTER the artifact is complete.
  let observations: unknown[];
  try {
    const parsed = JSON.parse(await readArtifact(outPath)) as { observations?: unknown };
    if (!Array.isArray(parsed.observations)) {
      throw new Error('the artifact has no `observations` array');
    }
    observations = parsed.observations;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    if (cli.exitCode === 0 || cli.exitCode === WINDOWS_LIBUV_TEARDOWN_EXIT) {
      // The CLI claimed success and produced nothing usable. That is a real
      // breakage in a sibling, not a degraded environment — say so loudly.
      throw new Error(
        `mu discovery exited ${cli.exitCode} but produced no readable readiness artifact at ${outPath}: ${detail}`,
      );
    }
    const reason = `mu discovery exited ${cli.exitCode} and wrote no readable artifact (${detail})`;
    ctx.log(`  op muster-readiness: UNAVAILABLE — ${reason}`);
    ctx.log(`  op muster-readiness: stderr — ${cli.stderr.trim().slice(0, 300) || '(empty)'}`);
    return { available: false, unavailableReason: reason, exitCode: cli.exitCode, slug };
  }

  if (cli.exitCode !== 0) {
    ctx.log(
      cli.exitCode === WINDOWS_LIBUV_TEARDOWN_EXIT
        ? `  op muster-readiness: NOTE — exit ${cli.exitCode} is the known Windows libuv teardown; the artifact is complete, so it is judged, not the exit code`
        : `  op muster-readiness: NOTE — mu discovery exited ${cli.exitCode} but the artifact is complete — ${cli.stderr.trim().slice(0, 200)}`,
    );
  }

  let ledgerDelta: number | undefined;
  if (simUrl && baseline !== undefined) {
    const after = await ledgerWrites(simUrl).catch(() => undefined);
    if (after !== undefined) ledgerDelta = after - baseline;
  }

  const tally = tallyPostures(observations);
  ctx.log(
    `  op muster-readiness: evaluated '${slug}' in ${seconds}s — ${tally.total} control observation(s): ` +
      `${tally.met} met / ${tally.not_met} not met / ${tally.partial} partial / ${tally.unknown} unknown` +
      (tally.other > 0 ? ` / ${tally.other} other (${tally.otherValues.join(', ')})` : ''),
  );
  ctx.log(
    `  op muster-readiness: read-only proof — ledger create+mutate delta ` +
      (ledgerDelta === undefined ? 'NOT MEASURED (no sim url)' : `${ledgerDelta}${ledgerDelta === 0 ? '' : ' — NOT READ-ONLY'}`),
  );
  ctx.log(`  op muster-readiness: ${NO_SCORE_LINE}`);
  ctx.artifact?.(outPath);

  const controls = observations.map((raw) => {
    const o = (raw ?? {}) as Observation;
    return {
      controlId: typeof o.control_id === 'string' ? o.control_id : '(unnamed)',
      posture: typeof o.derived_posture === 'string' ? o.derived_posture : '(missing)',
    };
  });

  return { available: true, tally, artifactPath: outPath, ledgerDelta, exitCode: cli.exitCode, slug, controls };
}

/**
 * The outcome readout — what the pane shows. Same navy palette as the staged
 * replay, so the pane never jumps between two visual languages mid-deck.
 */
export function readoutHtml(outcome: ReadinessOutcome, detail: 'counts' | 'controls' = 'counts'): string {
  const controlList =
    detail !== 'controls' || outcome.controls === undefined || outcome.controls.length === 0
      ? ''
      : `<ul class="controls">${outcome.controls
          .slice(0, MAX_LISTED_CONTROLS)
          .map((c) => `<li><span>${escapeHtml(c.controlId)}</span><em>${escapeHtml(c.posture)}</em></li>`)
          .join('')}</ul>` +
        (outcome.controls.length > MAX_LISTED_CONTROLS
          ? `<p class="meta">+${outcome.controls.length - MAX_LISTED_CONTROLS} more in the artifact</p>`
          : '');

  const rows =
    outcome.tally === undefined
      ? ''
      : [
          ['met', outcome.tally.met],
          ['not met', outcome.tally.not_met],
          ['partial', outcome.tally.partial],
          ['unknown', outcome.tally.unknown],
          ...(outcome.tally.other > 0
            ? ([[`other (${outcome.tally.otherValues.join(', ')})`, outcome.tally.other]] as [string, number][])
            : []),
        ]
          .map(
            ([label, n]) =>
              `<tr><th>${escapeHtml(String(label))}</th><td>${escapeHtml(String(n))}</td></tr>`,
          )
          .join('');

  const body = outcome.available
    ? `<div class="n">${escapeHtml(String(outcome.tally?.total ?? 0))}</div>
<p class="cap">control observations for <code>${escapeHtml(outcome.slug)}</code></p>
<table>${rows}</table>
${controlList}
<p class="note">${escapeHtml(NO_SCORE_LINE)}</p>
<p class="meta">read-only proof — ledger create+mutate delta ${escapeHtml(
        outcome.ledgerDelta === undefined ? 'not measured' : String(outcome.ledgerDelta),
      )}</p>
<p class="meta">${escapeHtml(outcome.artifactPath ?? '')}</p>`
    : `<div class="n">—</div>
<p class="cap">readiness evaluation unavailable</p>
<p class="note">${escapeHtml(outcome.unavailableReason ?? 'unknown reason')}</p>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Readiness Evaluation — ${escapeHtml(outcome.slug)}</title>
<style>
html,body{margin:0;height:100%;background:#0a1930;color:#dce8f7;font-family:"Segoe UI",Segoe,Tahoma,Arial,sans-serif;}
.wrap{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;text-align:center;}
.badge{border:1px solid ${outcome.available ? '#4ade80' : '#ffb454'};color:${outcome.available ? '#4ade80' : '#ffb454'};border-radius:20px;padding:2px 14px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;}
h1{font-size:22px;margin:0;font-weight:600;}
.n{font-size:56px;font-weight:700;line-height:1;}
.cap{color:#9db2cc;font-size:14px;margin:0;}
table{border-collapse:collapse;margin:4px 0;font-size:14px;}
th,td{border-top:1px solid #1e3a5c;padding:4px 14px;text-align:left;}
th{color:#9db2cc;font-weight:500;}
td{text-align:right;font-variant-numeric:tabular-nums;}
.note{color:#ffb454;font-size:13px;margin:6px 0 0;max-width:52ch;line-height:1.5;}
.meta{color:#6f87a6;font-size:11px;margin:0;max-width:70ch;word-break:break-all;}
code{background:#142a4a;border-radius:4px;padding:1px 6px;}
.controls{list-style:none;margin:6px 0 0;padding:0;max-width:52ch;font-size:12px;
  columns:2;column-gap:20px;text-align:left;}
.controls li{display:flex;justify-content:space-between;gap:10px;padding:1px 0;
  border-top:1px solid #14263f;break-inside:avoid;}
.controls em{color:#9db2cc;font-style:normal;}
</style></head><body><div class="wrap">
<span class="badge">Readiness Evaluation</span>
<h1>ces-muster · DISCOVERY-1 (presence-based)</h1>
${body}
</div></body></html>`;
}

/** The HUD title for this beat — the stage name, then the evaluator's own name. */
export const READINESS_HUD_TITLE = 'Readiness Evaluation · DISCOVERY-1';

/**
 * Build the op with its side effects injected. `live` evaluates now and streams
 * the SPA import (~80 s CLI + import, held on-slide); `staged` never reaches this
 * function. `warm` was DROPPED (GP-DEMO-5 streamgui): a warm SPA drive would show
 * a stale panel, and honesty wants the import visibly happening — matching
 * `muster-auto-analysis`.
 *
 * SUCCESS path (GP-DEMO-6 — the pane is never silently blank while the klaxon is
 * red): navigate the pane to the armed Muster SPA FIRST, pin the HUD, and start
 * the real CLI evaluation. While it runs, perform the manifest beat on stage —
 * Situation → Profile, the readiness session manifest typed in at a human
 * cadence — so the audience watches the tool being operated during the walk
 * the CLI has no UI for; the HUD ticks the elapsed time. When the artifact
 * lands, the HUD reports the tally and the op visibly imports this run's
 * result through the file-input seam, ENDING ON THE SPA (boundary panel) with
 * the tally still pinned. DEGRADED path (CLI/SPA unavailable, bad artifact):
 * render the outcome readout card on the pane — the only honest surface when
 * the SPA cannot be driven.
 */
export function makeMusterReadinessOp(deps: MusterReadinessDeps = {}): OpImplementation {
  return async (ctx: OpDriveContext): Promise<void> => {
    const mode = ctx.slide.op.mode;
    const baseUrl = ctx.armed.musterBaseUrl;
    const slug = ctx.armed.slug;
    ctx.log(
      `  op muster-readiness (${mode}): evaluating readiness for '${slug}' via ces-muster's discovery CLI, ` +
        'then importing the result into the Muster SPA (never the fixture "Run Discovery" button)',
    );
    // Declared in the deck's `params` cell; the catalog supplies the default.
    const detail = ctx.slide.op.params?.detail === 'controls' ? 'controls' : 'counts';

    // P2 guard — the SPA is not armed: evaluate, then the readout card is the
    // only honest surface. Nothing is driven.
    if (!baseUrl) {
      const outcome = await evaluate(ctx, deps);
      if (outcome.available) {
        ctx.log(
          '  op muster-readiness: the Muster SPA is not armed — rendering the readout card instead of the live import',
        );
      }
      await ctx.pane.goto(htmlDataUrl(readoutHtml(outcome, detail)));
      // DEGRADED (SPA not armed): the card is the honest surface, and the
      // caption says the beat steps aside rather than showing a figure it never
      // computed. Emitted AFTER the card goto (a load wipes the band).
      await ctx.caption?.(CAP.degraded[0]);
      return;
    }

    // SUCCESS path — the SPA goes on stage BEFORE the walk starts (this op is
    // standalone, so nothing navigated it earlier; the drivers below do no
    // navigation of their own).
    const page = ctx.pane.page;
    const hud = hudSurfaceOf(ctx.pane);
    await page.goto(baseUrl);
    // After the SPA goto (a load wipes the band); before the manifest verb.
    await ctx.caption?.(CAP.success[0]);
    const walking = `running ces-muster's discovery CLI against '${slug}'`;
    const ticker = hudTicker(hud, READINESS_HUD_TITLE, (ms) => `${walking} … ${formatElapsed(ms)}`);
    const started = ticker.startedAt;

    let outcome: ReadinessOutcome;
    try {
      const evaluation = evaluate(ctx, deps);
      // Stands over the read-only CLI walk (the ticker HUD counts it); the "prove
      // it" claim is honest — the read-only ledger delta is measured below.
      await ctx.caption?.(CAP.success[1]);
      // The manifest beat, performed on stage while the CLI walks. Best-effort:
      // it is the visible half of the beat, never the judged half, so a SPA
      // that has moved its Profile view degrades to a logged line, not a
      // failed op.
      try {
        await driveMusterFillManifest(
          page,
          {
            mode: 'independent',
            authTier: 'cert-app-only',
            slug,
            tenantKind: 'sim',
            operatorName: MUSTER_DEMO_OPERATOR_NAME,
            operatorRole: MUSTER_DEMO_OPERATOR_ROLE,
          },
          `${slug} (demo)`,
        );
        ctx.log(`  op muster-readiness: manifest beat performed on stage (tenant '${slug}', operator '${MUSTER_DEMO_OPERATOR_NAME}') while the CLI walks`);
      } catch (err) {
        ctx.log(`  op muster-readiness: manifest beat skipped — ${err instanceof Error ? err.message : String(err)}`);
      }
      // The manifest beat is the "filling in how it was done" the CLI has no UI
      // for; this stands while the walk finishes.
      await ctx.caption?.(CAP.success[2]);
      outcome = await evaluation;
    } finally {
      ticker.stop();
    }

    // DEGRADED — evaluation unavailable or no artifact: the readout card.
    if (!outcome.available || outcome.artifactPath === undefined) {
      if (hud) await paneHud.hide(hud);
      await ctx.pane.goto(htmlDataUrl(readoutHtml(outcome, detail)));
      await ctx.caption?.(CAP.degraded[0]);
      return;
    }

    const t = outcome.tally;
    const tallyLine = t
      ? `${t.total} observations · ${t.met} met / ${t.not_met} not met / ${t.partial} partial / ${t.unknown} unknown` +
        (t.other > 0 ? ` / ${t.other} other` : '')
      : 'artifact written';
    if (hud) {
      await paneHud.show(hud, READINESS_HUD_TITLE, `walk complete in ${formatElapsed(Date.now() - started)} — ${tallyLine} · importing this run's result`);
    }

    // No score claimed — the caption says so, and the log's NO_SCORE_LINE proves
    // it. Stands over the import that ends on the boundary panel.
    await ctx.caption?.(CAP.success[3]);
    // Import this run's real readiness-result and END ON THE SPA (boundary
    // panel). Do NOT navigate to the readout card — that would wipe the SPA off
    // the streamed pane and fail decision 11(b).
    const importResult = await driveMusterImportDiscovery(page, outcome.artifactPath);
    ctx.log(
      `  op muster-readiness: imported this run's result into the SPA — boundary panel ` +
        `${importResult.boundaryPanelVisible ? 'visible' : 'NOT visible'}, ` +
        `fixture discovery-summary ${importResult.discoverySummaryVisible ? 'VISIBLE (fixture path!)' : 'absent'}`,
    );
    if (hud) {
      await paneHud.show(hud, READINESS_HUD_TITLE, `imported — ${tallyLine} · no readiness score (presence-based) · confirm the CUI boundary`);
    }
  };
}

/** The registered implementation. */
export const runMusterReadinessOp: OpImplementation = makeMusterReadinessOp();
