// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-5 Slice 3.1 — `muster-auto-analysis` (D.5): run the REAL read-only
 * discovery walk and show its results inside Muster's UI — the honesty
 * centerpiece.
 *
 * ## The honest composition (A.5 #1, load-bearing)
 *
 * The SPA's own "Run Discovery" button loads a zero-network fixture. This act
 * NEVER touches it. Instead it runs the REAL CLI walk
 * (`muster-api/dist/cli/bin.js discovery --sim`), which emits a
 * `readiness-result/1.0.0` artifact, then IMPORTS that artifact through the SPA's
 * file-input seam (`discovery-import-input`, read via FileReader). The CLI output
 * validates against the same schema the SPA import validates against, so the
 * import is guaranteed valid — and what the audience sees is this tenant's real
 * walk, in this run, not canned data.
 *
 * ## The import lands on the boundary panel, not the fixture branch
 *
 * A valid readiness-result import flows to `boundary-confirm-panel`. The
 * fixture-run branch's `discovery-summary` is never rendered — the tell that the
 * honest path, not the fixture, produced what is on screen.
 *
 * ## Read-only
 *
 * The walk mutates nothing: the stacksim ledger create+mutate delta is 0 across
 * the spawn (the CLI's own GATE-5, re-verified here).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { queryLedger } from '../../../stacksim-client/http.js';
import { captureScreenshot } from '../../ui-page.js';
import {
  driveMusterImportDiscovery,
  MUSTER_DISCOVERY_FIXTURE_COUNT,
} from '../../muster-ui-driver.js';
import {
  musterCliPath,
  tallyPostures,
  type SpawnResult,
  type PostureTally,
} from './muster-readiness-op.js';
import { hudSurfaceOf } from '../app-pane.js';
import { formatElapsed, hudTicker, paneHud } from '../theatrical-page.js';
import { CAPTIONS } from '../captions.js';
import type { OpDriveContext } from '../op-registry.js';

const CAP = CAPTIONS['muster-auto-analysis'].steps;

/** The HUD title for this beat — the stage name, then the evaluator's own name. */
export const AUTO_ANALYSIS_HUD_TITLE = 'Auto-analysis · DISCOVERY-1';

export const MUSTER_AUTO_ANALYSIS_FACTS = 'muster-auto-analysis.json';
export const READINESS_RESULT_ARTIFACT = 'readiness-result.json';
export const READINESS_RESULT_SCHEMA_VERSION = 'readiness-result/1.0.0';

/** Every side effect this op has, injectable so the tests need no ces-muster. */
export interface MusterAutoAnalysisDeps {
  readonly spawnCli?: (
    command: string,
    args: readonly string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
  ) => Promise<SpawnResult>;
  readonly fileExists?: (absPath: string) => boolean;
  readonly readArtifact?: (absPath: string) => string;
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

async function defaultLedgerWrites(simUrl: string): Promise<number> {
  const [creates, mutates] = await Promise.all([
    queryLedger(simUrl, { type: 'create' }),
    queryLedger(simUrl, { type: 'mutate' }),
  ]);
  return creates.length + mutates.length;
}

/** The facts the judge reads. Written after the import, while the DOM is fresh. */
export interface MusterAutoAnalysisFacts {
  readonly cliArtifact: string;
  readonly schemaVersion: string;
  readonly observationCount: number;
  readonly postureTally: PostureTally;
  readonly ledgerDelta: number | null;
  readonly boundaryPanelVisible: boolean;
  readonly discoverySummaryVisible: boolean;
  readonly fixtureObservationCount: number;
}

export function makeMusterAutoAnalysisOp(deps: MusterAutoAnalysisDeps = {}): (ctx: OpDriveContext) => Promise<void> {
  const spawnCli = deps.spawnCli ?? defaultSpawn;
  const fileExists = deps.fileExists ?? ((p: string) => fs.existsSync(p));
  const readArtifact = deps.readArtifact ?? ((p: string) => fs.readFileSync(p, 'utf8'));
  const ledgerWrites = deps.ledgerWrites ?? defaultLedgerWrites;

  return async (ctx: OpDriveContext): Promise<void> => {
    const baseUrl = ctx.armed.musterBaseUrl;
    if (!baseUrl) {
      throw new Error(
        'the ces-muster preview is not armed — prep did not start it (see arm-muster.ts / arm-sim.ts)',
      );
    }
    const musterRoot = ctx.armed.musterRoot;
    const slug = ctx.armed.slug;
    const cliPath = musterCliPath(musterRoot);
    if (!fileExists(cliPath)) {
      throw new Error(
        `ces-muster's discovery CLI is not built: ${cliPath}. Run \`npm run build\` in ces-muster — ces-tester never builds a sibling.`,
      );
    }

    const outPath = path.join(ctx.armed.runDir, READINESS_RESULT_ARTIFACT);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      STAMPER_REGISTRY_ROOT: path.resolve(ctx.armed.stamperRoot, 'src', 'registry'),
    };

    // The read-only proof brackets the CLI walk.
    const simUrl = ctx.armed.simUrl;
    let baseline: number | undefined;
    if (simUrl) baseline = await ledgerWrites(simUrl).catch(() => undefined);

    ctx.log(`  op muster-auto-analysis: running the REAL discovery walk (CLI) for '${slug}' — never the fixture button`);
    // GP-DEMO-6 theatre: the walk has no UI of its own, so the HUD says what is
    // running and for how long while the pane holds the manifest view the
    // connect beat left behind. The pane is never silently blank.
    const hud = hudSurfaceOf(ctx.pane);
    // The manifest view is already on the pane (connect left it there); no goto,
    // so the caption is emitted before the walk verb and stands over the ~80 s
    // CLI walk the ticker HUD counts. Never the fixture "Run Discovery" button.
    await ctx.caption?.(CAP[0]);
    await ctx.caption?.(CAP[1]);
    const ticker = hudTicker(
      hud,
      AUTO_ANALYSIS_HUD_TITLE,
      (ms) => `read-only discovery walk of '${slug}' via ces-muster's CLI … ${formatElapsed(ms)}`,
    );
    let cli;
    try {
      cli = await spawnCli('node', [cliPath, 'discovery', '--sim', '--slug', slug, '--out', outPath], musterRoot, env);
    } finally {
      ticker.stop();
    }

    let ledgerDelta: number | null = null;
    if (simUrl && baseline !== undefined) {
      const after = await ledgerWrites(simUrl).catch(() => undefined);
      if (after !== undefined) ledgerDelta = after - baseline;
    }

    // Read the CLI artifact (the CLI Ajv-validates strict:true before writing).
    const parsed = JSON.parse(readArtifact(outPath)) as {
      schema_version?: string;
      observations?: unknown[];
    };
    const observations = Array.isArray(parsed.observations) ? parsed.observations : [];
    const tally = tallyPostures(observations);
    if (!Array.isArray(parsed.observations)) {
      throw new Error(`mu discovery (exit ${cli.exitCode}) produced no observations array at ${outPath}`);
    }
    ctx.artifact?.(outPath);

    const tallyLine =
      `${observations.length} observations · ${tally.met} met / ${tally.not_met} not met / ` +
      `${tally.partial} partial / ${tally.unknown} unknown`;
    if (hud) {
      await paneHud.show(
        hud,
        AUTO_ANALYSIS_HUD_TITLE,
        `walk complete in ${formatElapsed(Date.now() - ticker.startedAt)} — ${tallyLine} · importing this run's result`,
      );
    }

    // Import the artifact through the honest file-input seam and land on the
    // boundary panel. Read the DOM state NOW, while it is fresh.
    await ctx.caption?.(CAP[2]);
    const importResult = await driveMusterImportDiscovery(ctx.pane.page, outPath);
    await ctx.caption?.(CAP[3]);
    if (hud) {
      await paneHud.show(
        hud,
        AUTO_ANALYSIS_HUD_TITLE,
        `imported — ${tallyLine} · ledger delta ${ledgerDelta ?? 'n/a'} (read-only) · confirm the CUI boundary`,
      );
    }
    const shot = await captureScreenshot(ctx.pane.page, ctx.armed.runDir, 'muster-auto-02-boundary.png');
    if (shot) ctx.artifact?.(shot);

    const facts: MusterAutoAnalysisFacts = {
      cliArtifact: READINESS_RESULT_ARTIFACT,
      schemaVersion: parsed.schema_version ?? '(none)',
      observationCount: observations.length,
      postureTally: tally,
      ledgerDelta,
      boundaryPanelVisible: importResult.boundaryPanelVisible,
      discoverySummaryVisible: importResult.discoverySummaryVisible,
      fixtureObservationCount: MUSTER_DISCOVERY_FIXTURE_COUNT,
    };
    const factsPath = path.join(ctx.armed.runDir, MUSTER_AUTO_ANALYSIS_FACTS);
    fs.writeFileSync(factsPath, JSON.stringify(facts, null, 2));
    ctx.artifact?.(factsPath);

    ctx.log(
      `  op muster-auto-analysis: walked '${slug}' — ${observations.length} observation(s) ` +
        `(${tally.met} met / ${tally.not_met} not met / ${tally.partial} partial / ${tally.unknown} unknown); ` +
        `schema ${facts.schemaVersion}; ledger delta ${ledgerDelta ?? 'NOT MEASURED'}; ` +
        `imported → boundary panel ${importResult.boundaryPanelVisible ? 'visible' : 'NOT visible'}, ` +
        `fixture discovery-summary ${importResult.discoverySummaryVisible ? 'VISIBLE (fixture path!)' : 'absent'}`,
    );
  };
}

/** The real op — default seams. */
export const runMusterAutoAnalysisOp = makeMusterAutoAnalysisOp();
