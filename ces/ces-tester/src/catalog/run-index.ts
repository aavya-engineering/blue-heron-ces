// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * CC-2 — unified run history.
 *
 * `runs/index.jsonl` is append-only. Each line is one JSON RunRecord.
 * Crash-safe: a truncated last line is skipped on read, not fatal.
 */

import * as fs from 'node:fs/promises';
import * as fss from 'node:fs';
import * as path from 'node:path';
import type { RunRecord, RunMode } from './types.js';

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function readRunIndex(runsRoot: string): Promise<RunRecord[]> {
  const indexPath = path.join(runsRoot, 'index.jsonl');
  let raw: string;
  try {
    raw = await fs.readFile(indexPath, 'utf8');
  } catch {
    return [];
  }

  const records: RunRecord[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed) as RunRecord);
    } catch {
      // Truncated last line — skip, don't crash (CC-2 spec).
    }
  }
  return records;
}

// ---------------------------------------------------------------------------
// Write (append)
// ---------------------------------------------------------------------------

export async function appendRunRecord(
  runsRoot: string,
  record: RunRecord,
): Promise<void> {
  const indexPath = path.join(runsRoot, 'index.jsonl');
  await fs.mkdir(runsRoot, { recursive: true });
  await fs.appendFile(indexPath, JSON.stringify(record) + '\n', 'utf8');
}

// ---------------------------------------------------------------------------
// Update (rewrite the record with matching runId)
// ---------------------------------------------------------------------------

export async function updateRunRecord(
  runsRoot: string,
  runId: string,
  updates: Partial<RunRecord>,
): Promise<void> {
  const records = await readRunIndex(runsRoot);
  const idx = records.findIndex((r) => r.runId === runId);
  if (idx === -1) return;

  records[idx] = { ...records[idx], ...updates };
  const indexPath = path.join(runsRoot, 'index.jsonl');
  await fs.writeFile(
    indexPath,
    records.map((r) => JSON.stringify(r)).join('\n') + '\n',
    'utf8',
  );
}

// ---------------------------------------------------------------------------
// CLI recording wrapper
// ---------------------------------------------------------------------------

/**
 * Environment variables the recording wrapper reads. When a run is launched
 * from the Command Center, these are set on the child so the CLI wrapper
 * knows it's already being tracked and should reuse the id.
 */
export const RUN_ID_ENV = 'CES_RUN_ID';
export const LAUNCHED_BY_ENV = 'CES_LAUNCHED_BY';

/** Status from exit code. Command-specific overrides are in the caller. */
export function statusFromExit(exitCode: number | null | undefined): RunRecord['status'] {
  if (exitCode === 0) return 'pass';
  if (exitCode === 1) return 'fail';
  return 'unknown';
}

/**
 * Record a CLI-launched run. Called from the thin wrapper in cli/index.ts.
 * If the run was launched from the Center (env vars set), skip — the Center
 * already recorded it.
 */
export async function recordCliRun(opts: {
  command: string;
  argv: string[];
  runsRoot: string;
  exitCode: number;
  startedAt: Date;
  endedAt: Date;
  runnableId?: string;
  mode?: RunMode;
  outputDir?: string;
}): Promise<void> {
  // Don't double-record Center-launched runs
  if (process.env[LAUNCHED_BY_ENV] === 'center') return;

  const runId = process.env[RUN_ID_ENV] ?? `cli-${Date.now()}`;
  const record: RunRecord = {
    runId,
    runnableId: opts.runnableId ?? `pipeline:${opts.command}`,
    mode: opts.mode ?? 'test',
    argv: [opts.command, ...opts.argv],
    startedAt: opts.startedAt.toISOString(),
    endedAt: opts.endedAt.toISOString(),
    exitCode: opts.exitCode,
    status: statusFromExit(opts.exitCode),
    outputDir: opts.outputDir,
    launchedBy: 'cli',
    pid: process.pid,
  };
  await appendRunRecord(opts.runsRoot, record);
}

// ---------------------------------------------------------------------------
// Backfill — import existing runs/* directories
// ---------------------------------------------------------------------------

export async function backfillRunIndex(runsRoot: string): Promise<{
  imported: number;
  skipped: number;
}> {
  const existing = await readRunIndex(runsRoot);
  const existingIds = new Set(existing.map((r) => r.runId));

  let imported = 0;
  let skipped = 0;

  let entries: string[];
  try {
    entries = await fs.readdir(runsRoot, { withFileTypes: true })
      .then((ds) => ds.filter((d) => d.isDirectory()).map((d) => d.name));
  } catch {
    return { imported: 0, skipped: 0 };
  }

  for (const dir of entries.sort()) {
    // Skip special dirs
    if (dir === '.trash' || dir === 'show' || dir === 'acts-test') {
      // Handle show/ and acts-test/ subdirs
      await backfillSubdir(runsRoot, dir, existingIds, (c) => { imported += c; });
      continue;
    }

    if (existingIds.has(dir)) {
      skipped++;
      continue;
    }

    const summaryPath = path.join(runsRoot, dir, 'summary.json');
    let status: RunRecord['status'] = 'unknown';
    let startedAt: string | undefined;
    let endedAt: string | undefined;

    try {
      const raw = JSON.parse(await fs.readFile(summaryPath, 'utf8'));
      startedAt = raw.started_at;
      endedAt = raw.completed_at;
      if (raw.totals) {
        status = raw.totals.fail > 0 || raw.totals.crash > 0 ? 'fail' : 'pass';
      }
    } catch {
      // No summary — try result.json
      try {
        const resultFiles = (await fs.readdir(path.join(runsRoot, dir))).filter(
          (f) => f.endsWith('result.json'),
        );
        for (const rf of resultFiles) {
          const raw = JSON.parse(
            await fs.readFile(path.join(runsRoot, dir, rf), 'utf8'),
          );
          if (raw.status === 'pass') status = 'pass';
          else if (raw.status === 'fail') status = 'fail';
          if (raw.started_at) startedAt = raw.started_at;
        }
      } catch { /* truly unknown */ }
    }

    const record: RunRecord = {
      runId: dir,
      runnableId: 'pipeline:unknown',
      mode: 'test',
      argv: [],
      startedAt: startedAt ?? new Date(0).toISOString(),
      endedAt,
      status,
      outputDir: path.join(runsRoot, dir),
      launchedBy: 'cli',
    };
    await appendRunRecord(runsRoot, record);
    existingIds.add(dir);
    imported++;
  }

  return { imported, skipped };
}

async function backfillSubdir(
  runsRoot: string,
  subdir: string,
  existingIds: Set<string>,
  onImport: (count: number) => void,
): Promise<void> {
  const subdirPath = path.join(runsRoot, subdir);
  let entries: string[];
  try {
    entries = await fs.readdir(subdirPath, { withFileTypes: true })
      .then((ds) => ds.filter((d) => d.isDirectory()).map((d) => d.name));
  } catch {
    return;
  }

  let count = 0;
  for (const dir of entries.sort()) {
    const runId = `${subdir}/${dir}`;
    if (existingIds.has(runId)) continue;

    let status: RunRecord['status'] = 'unknown';
    const outputDir = path.join(subdirPath, dir);

    // Try to parse show or acts-test reports
    if (subdir === 'acts-test') {
      try {
        const report = JSON.parse(
          await fs.readFile(path.join(outputDir, 'acts-report.json'), 'utf8'),
        );
        if (report.verdict === 'pass') status = 'pass';
        else if (report.verdict === 'fail') status = 'fail';
      } catch { /* unknown */ }
    }

    const record: RunRecord = {
      runId,
      runnableId: subdir === 'show' ? 'pipeline:demo-show' : 'pipeline:demo-acts-test',
      mode: subdir === 'show' ? 'demo' : 'test',
      argv: subdir === 'show' ? ['demo:show'] : ['demo:acts-test'],
      startedAt: new Date(0).toISOString(),
      status,
      outputDir,
      launchedBy: 'cli',
    };
    await appendRunRecord(runsRoot, record);
    existingIds.add(runId);
    count++;
  }
  onImport(count);
}
