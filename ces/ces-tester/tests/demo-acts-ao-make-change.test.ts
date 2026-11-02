// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 Slice 1B — the `ao-make-change` judge (D.12) against injected seams.
 *
 * `ao-make-change` is `ao-registry`'s flow under a distinct id, so its judge
 * (AM1-AM4) mirrors the AO family plus the state-change clause D.12 carries and
 * D.11 does not: AM3 asserts the AO evidence row NAMES the command AND records
 * `stateChanged=true`. The test wires a real run-scoped `ces.db` for that read
 * and exercises AM4's injected unarmed-negative against the real op.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runActGroup, type ActRunArgs, type ActRunDeps } from '../src/demo/acts/act-run.js';
import { actGroup } from '../src/demo/acts/act-roster.js';
import type { AppPane } from '../src/demo/show/app-pane.js';
import type { ArmedSim } from '../src/demo/show/arm-sim.js';
import type { OpImplementation } from '../src/demo/show/op-registry.js';
import type { UiPage, UiSession } from '../src/demo/ui-page.js';
import { simTenantId } from '../src/demo/ao-evidence.js';
import { AO_DEMO_COMMAND_ID } from '../src/demo/ao-leg.js';

const testerRoot = path.resolve(__dirname, '..');
const _require = createRequire(import.meta.url);

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'acts-amc-'));
}

function fakePane(): AppPane {
  const page = new Proxy({} as UiPage, { get: () => async () => undefined });
  const session = new Proxy({} as UiSession, { get: () => async () => undefined });
  return { page, session, goto: async () => undefined, close: async () => undefined };
}

function argsFor(runDir: string): ActRunArgs {
  return {
    testerRoot,
    stacksimRoot: path.join(testerRoot, '..', 'tenant-stacksim'),
    aoRoot: path.join(testerRoot, '..', 'ces-ao'),
    eoRoot: path.join(testerRoot, '..', 'ces-eo'),
    stamperRoot: path.join(testerRoot, '..', 'ces-stamper'),
    musterRoot: path.join(testerRoot, '..', 'ces-muster'),
    runId: path.basename(runDir),
  };
}

function fakeArm(runDir: string, extra: Partial<ArmedSim>): ActRunDeps['arm'] {
  return async () => ({
    slug: 'demo-dib-small',
    simUrl: 'http://127.0.0.1:4390',
    runDir,
    stop: async () => undefined,
    ...extra,
  });
}

function writeAoEvidenceDb(
  runDir: string,
  tenantId: string,
  commandId: string,
  stateChanged: boolean,
): void {
  const Database = _require('better-sqlite3') as new (p: string) => {
    exec(sql: string): void;
    prepare(sql: string): { run(...args: unknown[]): void };
    close(): void;
  };
  const pipelineRoot = path.join(runDir, 'pipeline');
  fs.mkdirSync(pipelineRoot, { recursive: true });
  const db = new Database(path.join(pipelineRoot, 'ces.db'));
  db.exec(
    'CREATE TABLE IF NOT EXISTS ces_records (collection TEXT, id TEXT, tenant_id TEXT, tenant_slug TEXT, created_at TEXT, data TEXT)',
  );
  db.prepare(
    'INSERT INTO ces_records (collection, id, tenant_id, tenant_slug, created_at, data) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(
    'adminops_evidence',
    `${commandId}:${commandId}-1`,
    tenantId,
    null,
    new Date().toISOString(),
    JSON.stringify({
      evidence: {
        outcome: 'automated_success',
        complianceVerdict: 'SAT',
        metadata: { stateChanged, commandExecuted: 'Invoke-MgGraphRequest ...', sha256Hash: 'deadbeef' },
      },
    }),
  );
  db.close();
}

/** ao-make-change stand-in: writes the evidence row + a screenshot + the status log. */
function amcOp(runDir: string, opts: { writeDb?: boolean; stateChanged?: boolean } = {}): OpImplementation {
  return async (ctx) => {
    if (opts.writeDb !== false) {
      writeAoEvidenceDb(runDir, simTenantId(ctx.armed.slug), AO_DEMO_COMMAND_ID, opts.stateChanged ?? true);
    }
    const shot = path.join(runDir, 'ao-make-change-01.png');
    fs.writeFileSync(shot, 'png');
    ctx.artifact?.(shot);
    ctx.log('  op ao-make-change: status "SUCCESS", evidence "automated_success" (1 screenshot(s))');
  };
}

function depsFor(runDir: string, implementations: ActRunDeps['implementations']): ActRunDeps {
  return {
    openPane: async () => fakePane(),
    arm: fakeArm(runDir, { aoBaseUrl: 'http://127.0.0.1:3001' }),
    implementations,
    probe: async () => 'free',
    fileExists: (p) => fs.existsSync(p),
  };
}

describe('runActGroup — ao-make-change (D.12)', () => {
  it('passes AM1/AM2/AM3/AM4 when the command runs, the row names it, and the state changed', async () => {
    const runDir = tempDir();
    const report = await runActGroup(actGroup('ao-make-change')!, argsFor(runDir), () => undefined, {
      ...depsFor(runDir, { 'ao-make-change': amcOp(runDir) }),
    });
    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    for (const id of ['AM1', 'AM2', 'AM3', 'AM4', 'ARM1', 'TD1']) {
      expect(byId[id]?.status, `${id}: ${byId[id]?.detail}`).toBe('pass');
    }
    expect(byId.AM3.evidence).toMatchObject({ matching: 1, stateChanged: true, recordId: 'A-18:A-18-1' });
    // AM4 ran the REAL op against an unarmed environment, off the pane.
    expect(String(byId.AM4.evidence?.error)).toContain('arm-sim.ts');
    expect(report.status).toBe('pass');
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it('AM3 reds when the evidence row names the command but stateChanged is not true', async () => {
    const runDir = tempDir();
    const report = await runActGroup(actGroup('ao-make-change')!, argsFor(runDir), () => undefined, {
      ...depsFor(runDir, { 'ao-make-change': amcOp(runDir, { stateChanged: false }) }),
    });
    const am3 = report.checks.find((c) => c.id === 'AM3')!;
    expect(am3.status).toBe('fail');
    expect(report.findings.find((f) => f.rule === 'AM3')?.failureClass).toBe('act-red');
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it('AM3 reds when no AO evidence row names the command', async () => {
    const runDir = tempDir();
    const report = await runActGroup(actGroup('ao-make-change')!, argsFor(runDir), () => undefined, {
      ...depsFor(runDir, { 'ao-make-change': amcOp(runDir, { writeDb: false }) }),
    });
    expect(report.checks.find((c) => c.id === 'AM3')?.status).toBe('fail');
    fs.rmSync(runDir, { recursive: true, force: true });
  });
});
