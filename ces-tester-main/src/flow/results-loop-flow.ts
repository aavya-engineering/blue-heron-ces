// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * Flow-through FX-TE3 (MS-R9 loop): Stamper's real results manifest back into Muster.
 *
 * Helpers for tests/flow/results-loop.flow.test.ts:
 *  - `translateWithStamperCli`: `stamper translate` from ces-stamper/dist (the
 *    same command the X2 scenario runs), offline;
 *  - `startStamperServer` + `executeViaStamperServer`: ces-stamper's GUI server
 *    (dist) and its production `GET /api/execute` SSE route, which builds and
 *    writes the execution-results manifest
 *    (`<CES_PIPELINE_ROOT>/Stamper/plan-data/<slug>/state/execution-results-<planId>.json`);
 *  - `executeWithStamperCli` (FX-TE4): the CLI `execute --tenant <slug>` path.
 *    Since ces-stamper FX-ST6 (`9a482aa`) it writes the same manifest through
 *    `ExecutionResultsPublisher` and delivers it to Muster when
 *    `CES_MUSTER_API_URL` is set (REQ-STAMPER-CLI-NO-RESULTS-MANIFEST, closed).
 *
 * The Stamper server runs with cwd = a run-scoped directory (not ces-stamper):
 * X2 found that Muster plans carry relative `Export-Csv` evidence writes, which
 * would otherwise land inside the sibling repo. Only the API is used here, so
 * the SPA's static 404s outside ces-stamper do not matter.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { waitForHttpOk } from '../demo/gui-servers.js';
import { runPowershellCommand, type StamperSpawnResult } from '../stamper-launcher/spawn.js';

export interface StamperCliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runNode(args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<StamperCliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/** `stamper translate <mp> -m <tm> --tenant <slug> -o <out>` from ces-stamper/dist. */
export async function translateWithStamperCli(opts: {
  stamperRoot: string;
  missionPlanPath: string;
  manifestPath: string;
  tenantSlug: string;
  outputPath: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}): Promise<StamperCliResult> {
  const cli = path.join(opts.stamperRoot, 'dist', 'cli', 'index.js');
  const r = await runNode(
    [cli, 'translate', opts.missionPlanPath, '-m', opts.manifestPath, '--tenant', opts.tenantSlug, '-o', opts.outputPath],
    opts.cwd,
    opts.env,
  );
  if (r.code !== 0) throw new Error(`stamper translate exited ${r.code}:\n${r.stdout}\n${r.stderr}`);
  return r;
}

export interface StamperServerHandle {
  baseUrl: string;
  process: ChildProcess;
  stop: () => Promise<void>;
}

/** `node ces-stamper/dist/cli/index.js gui --port <n>` with a run-scoped cwd; resolves once `/api/tenants` answers. */
export async function startStamperServer(opts: {
  stamperRoot: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  port: number;
  logPath: string;
}): Promise<StamperServerHandle> {
  const cli = path.join(opts.stamperRoot, 'dist', 'cli', 'index.js');
  fs.mkdirSync(opts.cwd, { recursive: true });
  const child = spawn(process.execPath, [cli, 'gui', '--port', String(opts.port)], {
    cwd: opts.cwd,
    env: opts.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = fs.createWriteStream(opts.logPath, { flags: 'a' });
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);
  const kill = () => {
    if (!child.pid) return;
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    else child.kill('SIGTERM');
  };
  const baseUrl = `http://127.0.0.1:${opts.port}`;
  try {
    await waitForHttpOk(`${baseUrl}/api/tenants`, 120_000);
  } catch (err) {
    kill();
    throw err;
  }
  let stopped = false;
  return {
    baseUrl,
    process: child,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      kill();
      await new Promise((r) => setTimeout(r, 250));
    },
  };
}

/** Parse an SSE body (`data: <json>` blocks) into events. Pure. */
export function parseSseEvents(text: string): any[] {
  const out: any[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((l) => l.startsWith('data: '))
      .map((l) => l.slice(6))
      .join('\n');
    if (!data) continue;
    try {
      out.push(JSON.parse(data));
    } catch {
      /* non-JSON keepalive */
    }
  }
  return out;
}

/**
 * Run an Executable Plan through Stamper's production SSE execute route
 * (live against the sim: dryRun=false, tenant=<sim slug>, no blob upload) and
 * return every event once the stream ends.
 */
export async function executeViaStamperServer(opts: {
  baseUrl: string;
  planPath: string;
  tenantSlug: string;
  timeoutMs?: number;
}): Promise<any[]> {
  const q = new URLSearchParams({
    plan: opts.planPath,
    tenant: opts.tenantSlug,
    mode: 'auto',
    dryRun: 'false',
    uploadToBlob: 'false',
    evidencePopout: 'false',
  });
  const res = await fetch(`${opts.baseUrl}/api/execute?${q}`, { signal: AbortSignal.timeout(opts.timeoutMs ?? 1_200_000) });
  if (!res.ok) throw new Error(`stamper /api/execute -> HTTP ${res.status}`);
  return parseSseEvents(await res.text());
}

/**
 * FX-TE4: `stamper execute <plan> --mode auto --tenant <slug> -e <envFile> [--dry-run]`
 * from ces-stamper/dist, through powershell.exe exactly as the scenario launcher
 * does (`src/stamper-launcher/launch.ts`; a newline answers the preflight
 * confirm). The caller owns `env` (sim-only guarded) and the run-scoped `cwd`.
 */
export async function executeWithStamperCli(opts: {
  stamperRoot: string;
  planPath: string;
  tenantSlug: string;
  envFilePath: string;
  dryRun?: boolean;
  cwd: string;
  env: NodeJS.ProcessEnv;
}): Promise<StamperSpawnResult> {
  const cli = path.join(opts.stamperRoot, 'dist', 'cli', 'index.js');
  const command =
    `node "${cli}" execute "${opts.planPath}" --mode auto --tenant "${opts.tenantSlug}" -e "${opts.envFilePath}"` +
    (opts.dryRun ? ' --dry-run' : '');
  fs.mkdirSync(opts.cwd, { recursive: true });
  return runPowershellCommand({ command, cwd: opts.cwd, env: opts.env, confirmYes: true });
}

/** The `JSON: <path>` line Stamper's CLI prints after saving its execution report. Pure. */
export function parseCliReportPath(stdout: string): string | undefined {
  const m = /^\s*JSON:\s*(.+?)\s*$/m.exec(stdout);
  return m ? m[1] : undefined;
}
