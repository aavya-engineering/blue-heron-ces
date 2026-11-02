// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { MusterPlanCase, MusterPlanOutput } from './muster-plan-generator.js';

/**
 * Flow-through X2 (MS-R10): the scenario-runner seam that sources the Mission
 * Plan from ces-muster's REAL generator instead of legacy ces-planner.
 * Spawns vite-node (this repo's vitest.config.ts mirrors Muster's `@/` alias)
 * on src/flow/muster-plan-gen.cli.ts and parses its one `FT_RESULT` line.
 * Offline and local: no server, no network.
 */
export interface MusterPlanSourceOptions {
  /** ces-tester checkout root (holds node_modules/vite-node and vitest.config.ts). */
  testerRoot: string;
  planCase: MusterPlanCase;
  outDir: string;
  slug: string;
  logPath?: string;
}

export interface MusterPlanSourceResult {
  missionPlanPath: string;
  manifestPath: string;
  provenance: MusterPlanOutput['provenance'];
}

export function parseGeneratorStdout(stdout: string): MusterPlanSourceResult {
  const line = stdout.split(/\r?\n/).find((l) => l.startsWith('FT_RESULT '));
  if (!line) throw new Error(`muster-plan-gen produced no FT_RESULT line; stdout tail: ${stdout.slice(-400)}`);
  const r = JSON.parse(line.slice('FT_RESULT '.length)) as MusterPlanSourceResult;
  if (!r.missionPlanPath || !r.manifestPath || r.provenance?.generatorFn !== 'buildPlanArtifacts') {
    throw new Error(`muster-plan-gen FT_RESULT malformed: ${line}`);
  }
  return r;
}

export async function generatePlanFromMuster(opts: MusterPlanSourceOptions): Promise<MusterPlanSourceResult> {
  await fs.mkdir(opts.outDir, { recursive: true });
  const casePath = path.join(opts.outDir, 'muster-plan-case.json');
  await fs.writeFile(casePath, JSON.stringify(opts.planCase, null, 2), 'utf8');
  const viteNode = path.join(opts.testerRoot, 'node_modules', 'vite-node', 'vite-node.mjs');
  const args = [
    viteNode,
    '--config',
    path.join(opts.testerRoot, 'vitest.config.ts'),
    path.join(opts.testerRoot, 'src', 'flow', 'muster-plan-gen.cli.ts'),
  ];
  const { code, stdout, stderr } = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(process.execPath, args, {
        cwd: opts.testerRoot,
        env: { ...process.env, FT_PLAN_CASE: casePath, FT_OUT_DIR: opts.outDir, FT_SLUG: opts.slug },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let so = '';
      let se = '';
      child.stdout.on('data', (d) => (so += d));
      child.stderr.on('data', (d) => (se += d));
      child.on('error', reject);
      child.on('close', (c) => resolve({ code: c, stdout: so, stderr: se }));
    },
  );
  if (opts.logPath) {
    await fs.writeFile(opts.logPath, `$ node ${args.join(' ')}\n--- stdout\n${stdout}\n--- stderr\n${stderr}`, 'utf8');
  }
  if (code !== 0) throw new Error(`muster-plan-gen exited ${code}: ${stderr.slice(-800)}`);
  return parseGeneratorStdout(stdout);
}
