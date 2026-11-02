// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 Slice 1A — the `eo-verify-evidence` judge (D.15) against injected seams.
 *
 * The chain this act proves is cross-tool, so the test wires the three surfaces
 * the judge reads independently: the finished report (EV1's landing screenshot),
 * a throwaway EO server answering `/api/evidence-explorer/index` (EV2), and a
 * real run-scoped `ces.db` carrying an `adminops_evidence` row (EV3).
 *
 * The load-bearing assertion is EV2's NON-VACUITY, keyed on correlationId
 * (FX-TE4; ces-ao FX-AO7 `e53e708` closed REQ-AO-GUI-NO-CORRELATION-ID): the
 * Explorer's static signal catalog always returns items, so EV2 must find THIS
 * click's AO row by the `ao-ui-<uuid>` correlationId the UI put on it
 * (`data.metadata.correlationId`, the contract row). EO's executions list maps
 * the id to a row, the Explorer lists that row, and opening it returns the same
 * correlationId and command. A row without a correlationId, a non-UI id,
 * another click's id, or an item that opens to another id or command, fails.
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'acts-ev-'));
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

/**
 * A throwaway EO server answering `/api/evidence-explorer/index` (the given
 * items), `/api/evidence-explorer/item` (the given content per item path) and
 * `/api/adminops/executions` (the given execution views).
 */
async function fakeEoServer(
  items: unknown[],
  itemContent: Record<string, unknown> = {},
  executions: unknown[] = [],
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const http = await import('node:http');
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/api/adminops/executions') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ tenant: url.searchParams.get('tenant'), executions }));
      return;
    }
    if (url.pathname === '/api/evidence-explorer/item') {
      const content = itemContent[url.searchParams.get('path') ?? ''];
      res.writeHead(content ? 200 : 404, { 'content-type': 'application/json' });
      res.end(JSON.stringify(content ? { content } : { error: 'not found' }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ items, connectionState: 'disconnected' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** The ces.db row id the aoOp stand-in writes, and its Explorer item/path (FX-EO2 shape). */
const RUN_ROW_ID = `${AO_DEMO_COMMAND_ID}:${AO_DEMO_COMMAND_ID}-1`;
const RUN_AO_ITEM = {
  id: `adminops:${RUN_ROW_ID}`,
  source: 'adminops',
  title: `${AO_DEMO_COMMAND_ID} — executed`,
  path: `adminops/${RUN_ROW_ID}`,
};
/** The `ao-ui-<uuid>` the AO web UI sent for this click (FX-AO7 shape). */
const UI_CORRELATION_ID = 'ao-ui-0f1e2d3c-4b5a-4968-8776-a5b4c3d2e1f0';
const RUN_CONTENT = { rowId: RUN_ROW_ID, commandId: AO_DEMO_COMMAND_ID, correlationId: UI_CORRELATION_ID, outcome: 'executed' };
const RUN_AO_CONTENT = { [RUN_AO_ITEM.path]: RUN_CONTENT };
/** `/api/adminops/executions` view of this run's row (ces-eo `toExecutionView`). */
const RUN_EXECUTION = { rowId: RUN_ROW_ID, commandId: AO_DEMO_COMMAND_ID, correlationId: UI_CORRELATION_ID, outcome: 'executed' };

/** The static signal catalog is what makes an item-count check vacuous. */
const SIGNAL_ITEMS = [
  { id: 'signal:identitySignals', source: 'signal', title: 'Identity Signals', controlIds: ['IA.L2-3.5.3'] },
  { id: 'signal:deviceSignals', source: 'signal', title: 'Device Signals', controlIds: ['CM.L2-3.4.1'] },
];

/** An `assessment:` item is the honest tell — only this run's warm leg produces it. */
const ASSESSMENT_ITEM = {
  id: 'assessment:IA.L2-3.5.3',
  source: 'local',
  title: 'IA.L2-3.5.3 — not_met',
  controlIds: ['IA.L2-3.5.3'],
};

/** Write a real run-scoped `ces.db` with one `adminops_evidence` row for the command. */
function writeAoEvidenceDb(runDir: string, tenantId: string, commandId: string, correlationId?: string): void {
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
        metadata: { stateChanged: true, commandExecuted: 'Invoke-MgGraphRequest ...', sha256Hash: 'deadbeef' },
      },
      // The contract row (A4): where AO persists the correlationId.
      metadata: { contractVersion: '1.3.0', commandId, ...(correlationId ? { correlationId } : {}) },
    }),
  );
  db.close();
}

/** ao-registry stand-in: writes the evidence DB row the way the real GUI drive does. */
function aoOp(runDir: string, opts: { writeDb?: boolean; correlationId?: string | null } = {}): OpImplementation {
  return async (ctx) => {
    if (opts.writeDb !== false) {
      const corr = opts.correlationId === null ? undefined : (opts.correlationId ?? UI_CORRELATION_ID);
      writeAoEvidenceDb(runDir, simTenantId(ctx.armed.slug), AO_DEMO_COMMAND_ID, corr);
    }
    const shot = path.join(runDir, 'ao-registry-01.png');
    fs.writeFileSync(shot, 'png');
    ctx.artifact?.(shot);
  };
}

/** eo-review stand-in: warm hydrates (no-op here); live writes the evidence landing shot. */
function eoOp(runDir: string, opts: { writeShot?: boolean } = {}): OpImplementation {
  return async (ctx) => {
    if (ctx.slide.op.mode === 'warm') return;
    if (opts.writeShot !== false) {
      const shot = path.join(runDir, 'eo-review-03-evidence.png');
      fs.writeFileSync(shot, 'png');
      ctx.artifact?.(shot);
    }
  };
}

function depsFor(
  runDir: string,
  eoBaseUrl: string,
  implementations: ActRunDeps['implementations'],
): ActRunDeps {
  return {
    openPane: async () => fakePane(),
    arm: fakeArm(runDir, { aoBaseUrl: 'http://127.0.0.1:3001', eoBaseUrl }),
    implementations,
    probe: async () => 'free',
    fileExists: (p) => fs.existsSync(p),
  };
}

describe('runActGroup — eo-verify-evidence (D.15)', () => {
  it("passes EV1/EV2/EV3 when the landing lands, the Explorer lists and opens this run's AO row, and AO wrote the record", async () => {
    const runDir = tempDir();
    const eo = await fakeEoServer([...SIGNAL_ITEMS, ASSESSMENT_ITEM, RUN_AO_ITEM], RUN_AO_CONTENT, [RUN_EXECUTION]);
    const report = await runActGroup(actGroup('eo-verify-evidence')!, argsFor(runDir), () => undefined, {
      ...depsFor(runDir, eo.baseUrl, { 'ao-registry': aoOp(runDir), 'eo-review': eoOp(runDir) }),
    });
    await eo.close();

    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    for (const id of ['EV1', 'EV2', 'EV3', 'ARM1', 'TD1']) {
      expect(byId[id]?.status, `${id}: ${byId[id]?.detail}`).toBe('pass');
    }
    expect(byId.EV1.evidence?.screenshot).toContain('eo-review-03-evidence.png');
    // The match key is the UI's correlationId, read from this run's own row.
    expect(byId.EV2.evidence).toMatchObject({
      correlationId: UI_CORRELATION_ID,
      itemId: RUN_AO_ITEM.id,
      rowId: RUN_ROW_ID,
      commandId: AO_DEMO_COMMAND_ID,
    });
    expect(byId.EV3.evidence).toMatchObject({ matching: 1, recordId: 'A-18:A-18-1' });
    expect(report.status).toBe('pass');
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it('EV2 is NON-VACUOUS: a live Explorer with the signal catalog and the assessment but no AO row fails', async () => {
    const runDir = tempDir();
    const eo = await fakeEoServer([...SIGNAL_ITEMS, ASSESSMENT_ITEM]);
    const report = await runActGroup(actGroup('eo-verify-evidence')!, argsFor(runDir), () => undefined, {
      ...depsFor(runDir, eo.baseUrl, { 'ao-registry': aoOp(runDir), 'eo-review': eoOp(runDir) }),
    });
    await eo.close();
    const ev2 = report.checks.find((c) => c.id === 'EV2')!;
    expect(ev2.status).toBe('fail');
    expect(report.findings.find((f) => f.rule === 'EV2')?.failureClass).toBe('act-red');
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it('EV1 reds when the evidence-landing screenshot never reaches the report', async () => {
    const runDir = tempDir();
    const eo = await fakeEoServer([RUN_AO_ITEM], RUN_AO_CONTENT);
    const report = await runActGroup(actGroup('eo-verify-evidence')!, argsFor(runDir), () => undefined, {
      ...depsFor(runDir, eo.baseUrl, {
        'ao-registry': aoOp(runDir),
        'eo-review': eoOp(runDir, { writeShot: false }),
      }),
    });
    await eo.close();
    expect(report.checks.find((c) => c.id === 'EV1')?.status).toBe('fail');
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it('EV3 reds when no AO evidence row names the command — the write side is the command-id proof', async () => {
    const runDir = tempDir();
    const eo = await fakeEoServer([RUN_AO_ITEM], RUN_AO_CONTENT);
    const report = await runActGroup(actGroup('eo-verify-evidence')!, argsFor(runDir), () => undefined, {
      ...depsFor(runDir, eo.baseUrl, {
        'ao-registry': aoOp(runDir, { writeDb: false }),
        'eo-review': eoOp(runDir),
      }),
    });
    await eo.close();
    expect(report.checks.find((c) => c.id === 'EV3')?.status).toBe('fail');
    // No row in this run's DB -> nothing for the Explorer to surface either.
    expect(report.checks.find((c) => c.id === 'EV2')?.status).toBe('fail');
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("EV2 reds when EO only has ANOTHER click's row for the same command (the correlationId is the key)", async () => {
    const runDir = tempDir();
    const otherRow = `${AO_DEMO_COMMAND_ID}:${AO_DEMO_COMMAND_ID}-OTHER`;
    const otherId = 'ao-ui-99999999-9999-4999-8999-999999999999';
    const other = { ...RUN_AO_ITEM, id: `adminops:${otherRow}`, path: `adminops/${otherRow}` };
    const eo = await fakeEoServer(
      [other],
      { [other.path]: { rowId: otherRow, commandId: AO_DEMO_COMMAND_ID, correlationId: otherId } },
      [{ rowId: otherRow, commandId: AO_DEMO_COMMAND_ID, correlationId: otherId }],
    );
    const report = await runActGroup(actGroup('eo-verify-evidence')!, argsFor(runDir), () => undefined, {
      ...depsFor(runDir, eo.baseUrl, { 'ao-registry': aoOp(runDir), 'eo-review': eoOp(runDir) }),
    });
    await eo.close();
    const ev2 = report.checks.find((c) => c.id === 'EV2')!;
    expect(ev2.status).toBe('fail');
    expect(ev2.detail).toContain(UI_CORRELATION_ID);
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("EV2 reds when EO's row for the SAME row id carries a different correlationId", async () => {
    const runDir = tempDir();
    const otherId = 'ao-ui-99999999-9999-4999-8999-999999999999';
    const eo = await fakeEoServer(
      [RUN_AO_ITEM],
      { [RUN_AO_ITEM.path]: { ...RUN_CONTENT, correlationId: otherId } },
      [{ ...RUN_EXECUTION, correlationId: otherId }],
    );
    const report = await runActGroup(actGroup('eo-verify-evidence')!, argsFor(runDir), () => undefined, {
      ...depsFor(runDir, eo.baseUrl, { 'ao-registry': aoOp(runDir), 'eo-review': eoOp(runDir) }),
    });
    await eo.close();
    expect(report.checks.find((c) => c.id === 'EV2')?.status).toBe('fail');
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it('EV2 reds when the Explorer item opens to a different correlationId than the executions list', async () => {
    const runDir = tempDir();
    const eo = await fakeEoServer(
      [RUN_AO_ITEM],
      { [RUN_AO_ITEM.path]: { ...RUN_CONTENT, correlationId: 'ao-ui-other' } },
      [RUN_EXECUTION],
    );
    const report = await runActGroup(actGroup('eo-verify-evidence')!, argsFor(runDir), () => undefined, {
      ...depsFor(runDir, eo.baseUrl, { 'ao-registry': aoOp(runDir), 'eo-review': eoOp(runDir) }),
    });
    await eo.close();
    expect(report.checks.find((c) => c.id === 'EV2')?.status).toBe('fail');
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("EV2 reds when this run's AO row carries no correlationId (a pre-FX-AO7 UI)", async () => {
    const runDir = tempDir();
    const eo = await fakeEoServer([RUN_AO_ITEM], RUN_AO_CONTENT, [RUN_EXECUTION]);
    const report = await runActGroup(actGroup('eo-verify-evidence')!, argsFor(runDir), () => undefined, {
      ...depsFor(runDir, eo.baseUrl, { 'ao-registry': aoOp(runDir, { correlationId: null }), 'eo-review': eoOp(runDir) }),
    });
    await eo.close();
    const ev2 = report.checks.find((c) => c.id === 'EV2')!;
    expect(ev2.status).toBe('fail');
    expect(ev2.detail).toMatch(/no correlationId/);
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("EV2 reds on a correlationId that is not the AO web UI's (an API caller's id)", async () => {
    const runDir = tempDir();
    const apiId = 'ft-te1-live-A-18';
    const eo = await fakeEoServer(
      [RUN_AO_ITEM],
      { [RUN_AO_ITEM.path]: { ...RUN_CONTENT, correlationId: apiId } },
      [{ ...RUN_EXECUTION, correlationId: apiId }],
    );
    const report = await runActGroup(actGroup('eo-verify-evidence')!, argsFor(runDir), () => undefined, {
      ...depsFor(runDir, eo.baseUrl, { 'ao-registry': aoOp(runDir, { correlationId: apiId }), 'eo-review': eoOp(runDir) }),
    });
    await eo.close();
    const ev2 = report.checks.find((c) => c.id === 'EV2')!;
    expect(ev2.status).toBe('fail');
    expect(ev2.detail).toMatch(/not an AO web UI id/);
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it('EV2 reds when the listed item opens to a different command', async () => {
    const runDir = tempDir();
    const eo = await fakeEoServer([RUN_AO_ITEM], { [RUN_AO_ITEM.path]: { ...RUN_CONTENT, commandId: 'B-02' } }, [RUN_EXECUTION]);
    const report = await runActGroup(actGroup('eo-verify-evidence')!, argsFor(runDir), () => undefined, {
      ...depsFor(runDir, eo.baseUrl, { 'ao-registry': aoOp(runDir), 'eo-review': eoOp(runDir) }),
    });
    await eo.close();
    expect(report.checks.find((c) => c.id === 'EV2')?.status).toBe('fail');
    fs.rmSync(runDir, { recursive: true, force: true });
  });
});
