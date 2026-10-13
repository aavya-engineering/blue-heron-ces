// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * Flow-through FX-TE1 — X3 / AE-R6: AdminOps -> real ces.db -> EvidenceOps.
 *
 * Opt-in integration (needs Windows PowerShell + tenant-stacksim; not part of
 * the default `npm test`): set CES_TESTER_FLOW_LIVE=1.
 *
 * Every hop is production code; no row is hand-built:
 *   1. src/flow/ao-eo-flow.ts materializes + serves tenant-stacksim, registers
 *      two `kind:'sim'` tenants in a temp ces-tenant registry, and boots
 *      ces-ao's real server (`ao gui`, ces-ao/dist) with CES_AO_SIM_ONLY=1 and
 *      no CES_AO_ALLOW_LIVE. Each case is one `POST /api/execute/:commandId`
 *      with its own correlationId; AO's executor runs the command's PowerShell
 *      against stacksim and persists its contract row into the temp
 *      `CES_PIPELINE_ROOT/ces.db`.
 *   2. That same ces.db is read back through ces-eo's PRODUCTION surfaces,
 *      imported read-only from ces-eo/src: AdminOpsEvidenceReader, the real
 *      evidence router over HTTP (`/api/evidence-explorer/index|item`,
 *      `/api/adminops/executions`, tenant-scoped per FX-EO1), and the
 *      assessment path /api/assess uses (ControlAssessor.merge with the AO
 *      sources + SprsCalculator).
 *
 * Assertions (instruction FX-TE1): one live op per admin domain A-H visible
 * with non-blank commandId + requestorUPN and credited; a CMMC deny and a
 * Tier-3 pending visible and not credited; a dry run visible as a preview with
 * SPRS unchanged; tenant scoping (tenant B's row invisible to A and vice versa).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { findCesRoot } from '../../src/flow/ces-root.js';
import { queryLedger } from '../../src/stacksim-client/http.js';
import { aoExecute, setRecordCmmcPosture, startAoFlowEnv, type AoExecuteResponse, type AoFlowEnv } from '../../src/flow/ao-eo-flow.js';

const LIVE = process.env.CES_TESTER_FLOW_LIVE === '1' && process.platform === 'win32';
if (!LIVE) console.log('[FX-TE1] skipped: set CES_TESTER_FLOW_LIVE=1 on Windows (needs PowerShell + tenant-stacksim)');
const CES_ROOT = LIVE ? findCesRoot() : '';
const TESTER_ROOT = path.resolve(__dirname, '..', '..');
const imp = (rel: string): Promise<any> => import(pathToFileURL(path.join(CES_ROOT, rel)).href);

const SLUG_A = 'ft-te1-tenant-a';
const SLUG_B = 'ft-te1-tenant-b';
const REQUESTOR = 'operator@ft-te1.sim';
const RUN = `te1-${Date.now().toString(36)}`;
const corr = (k: string) => `${RUN}-${k}`;

/**
 * One live, zero-input Tier-2 op per admin domain (A-H). Chosen from the AO
 * registry and confirmed on stacksim (spike 2026-09-27: all SAT).
 */
const DOMAIN_OPS: Record<string, string> = {
  A: 'A-18', B: 'B-02', C: 'C-07', D: 'D-04', E: 'E-02', F: 'F-01', G: 'G-08', H: 'H-08',
};
/** L2 practice (SC.L2-3.13.8) run while tenant A's posture is L1 -> CMMC deny. */
const DENY_CMD = 'C-05';
/** Tier 3, no approvalId -> blocked_pending_approval (IR.L2-3.6.1). */
const PENDING_CMD = 'D-03';
/** Dry run of an op whose control (MP.L2-3.8.2) no live op credits. */
const DRY_CMD = 'D-01';
/** Tenant B's one live op. */
const B_CMD = 'A-13';

function head(repo: string): string {
  try {
    return execFileSync('git', ['-C', repo, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return '(unknown)';
  }
}

describe.skipIf(!LIVE)('FX-TE1 AE-R6: AO -> real ces.db -> EO (stacksim only) [opt-in CES_TESTER_FLOW_LIVE=1]', () => {
  let workDir: string;
  let env: AoFlowEnv;
  const res: Record<string, AoExecuteResponse> = {};
  let Reader: any;
  let views: any;
  let ControlAssessor: any;
  let SprsCalculator: any;
  let closeEoRepos: () => void;
  let controlsRefPath: string;
  let server: Server | undefined;
  let base: string;
  let sprsBeforeDry: number;
  let statusBeforeDry: Map<string, string>;
  let ledgerBefore = 0;
  let ledgerAfter = 0;
  const prev = { pipeline: process.env.CES_PIPELINE_ROOT, tenantRoot: process.env.CES_TENANT_ROOT };

  const run = async (key: string, tenant: string, commandId: string, dryRun: boolean, inputs: Record<string, unknown> = {}) => {
    res[key] = await aoExecute(env.aoBaseUrl, { tenant, commandId, dryRun, correlationId: corr(key), requestorUPN: REQUESTOR, inputs });
  };

  const readA = () => new Reader(env.tenantIdA, env.dbPath).read();

  /** Production assessment path (/api/assess Phase 1.6 + score): AO sources -> ControlAssessor.merge -> SprsCalculator. */
  const assess = (sources: Map<string, any[]>) => {
    const controls = new ControlAssessor(controlsRefPath, []).merge(env.tenantIdA, [], [], [], [], sources).controls;
    return { controls, score: new SprsCalculator().calculate(controls).score as number };
  };

  beforeAll(async () => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-te1-'));
    console.log(
      `[FX-TE1] upstream: ces monorepo@${head(CES_ROOT)} (ces-ao dist, ces-eo src, ces-shared dist, tenant-stacksim) ` +
        `run=${RUN} work=${workDir}`,
    );
    env = await startAoFlowEnv({
      cesRoot: CES_ROOT,
      testerRoot: TESTER_ROOT,
      workDir,
      slugA: SLUG_A,
      slugB: SLUG_B,
      aoPort: 3917,
      log: (l) => console.log(`[FX-TE1] ${l}`),
    });

    // EO's production modules, read-only from the sibling tree.
    ({ AdminOpsEvidenceReader: Reader } = await imp('ces-eo/src/eo/adminops/AdminOpsEvidenceReader.ts'));
    views = await imp('ces-eo/src/eo/adminops/adminopsViews.ts');
    ({ ControlAssessor } = await imp('ces-eo/src/eo/assessment/ControlAssessor.ts'));
    ({ SprsCalculator } = await imp('ces-eo/src/eo/sprs/SprsCalculator.ts'));
    const eoRequire = createRequire(path.join(CES_ROOT, 'ces-eo', 'package.json'));
    controlsRefPath = eoRequire.resolve('ces-shared/data/cmmc-l2-controls');

    // 8 live domain ops on tenant A (stacksim ledger counted around them: the ops really ran on the sim).
    ledgerBefore = (await queryLedger(env.simUrl, {})).length;
    for (const [d, id] of Object.entries(DOMAIN_OPS)) await run(`live-${d}`, SLUG_A, id, false);
    ledgerAfter = (await queryLedger(env.simUrl, {})).length;

    // CMMC deny: tenant A's posture set to L1 (its own temp record), an L2 practice requested, posture restored.
    setRecordCmmcPosture(env.recordPathA, 'L1');
    await run('deny', SLUG_A, DENY_CMD, false);
    setRecordCmmcPosture(env.recordPathA, undefined);

    // Tier-3 pending (no approvalId).
    await run('pending', SLUG_A, PENDING_CMD, false, { targetUPN: 'departing.user@ft-te1.sim', incidentId: 'INC-TE1-1' });

    // Tenant B's live op.
    await run('tenant-b', SLUG_B, B_CMD, false);

    // SPRS before the dry run, then the dry run.
    const before = assess(readA().sources);
    sprsBeforeDry = before.score;
    statusBeforeDry = new Map(before.controls.map((c: any) => [c.control_id, c.status]));
    await run('dry', SLUG_A, DRY_CMD, true);

    // EO's real evidence router over HTTP, scoped by ?tenant= (FX-EO1). Tenant
    // resolution is registry-first: CES_TENANT_ROOT is the run's temp registry.
    process.env.CES_PIPELINE_ROOT = env.pipelineRoot;
    process.env.CES_TENANT_ROOT = env.registryRoot;
    const { createEvidenceRouter } = await imp('ces-eo/src/eo/server/routers/evidence-router.ts');
    const { AssessmentStore } = await imp('ces-eo/src/eo/assessment/AssessmentStore.ts');
    ({ closeAllCesRepositories: closeEoRepos } = await import(
      pathToFileURL(eoRequire.resolve('ces-shared/persistence/node')).href
    ));
    const express = eoRequire('express');
    const storageRoot = path.join(workDir, 'eo-storage');
    fs.mkdirSync(storageRoot, { recursive: true });
    const emptyStore = { load: () => [], loadRegister: () => ({ entries: [] }), loadLatest: () => null };
    const app = express();
    app.use(express.json());
    app.use(
      createEvidenceRouter({
        // Server default tenant is B: a request for A must never fall back to it.
        config: { storageRoot, tenantSlug: SLUG_B, tenantConfigPath: path.join(env.registryRoot, 'sim', `${SLUG_B}.json`) },
        stamperRoot: path.join(workDir, 'no-stamper'),
        assessmentStore: new AssessmentStore(storageRoot),
        personnelStore: emptyStore,
        riskAssessmentStore: emptyStore,
        policyStore: emptyStore,
        poamStore: emptyStore,
        getSessionManager: () => null,
        captureSignals: async () => ({ capturedCount: 0, errors: [] }),
        getLastCaptureRun: () => null,
      }),
    );
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  }, 600_000);

  afterAll(async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((r) => server!.close(() => r()));
    }
    if (env) await env.stop();
    try {
      closeEoRepos?.();
    } catch {
      /* already closed */
    }
    if (prev.pipeline === undefined) delete process.env.CES_PIPELINE_ROOT;
    else process.env.CES_PIPELINE_ROOT = prev.pipeline;
    if (prev.tenantRoot === undefined) delete process.env.CES_TENANT_ROOT;
    else process.env.CES_TENANT_ROOT = prev.tenantRoot;
    if (workDir && process.env.CES_TESTER_KEEP_FLOW !== '1') fs.rmSync(workDir, { recursive: true, force: true });
  }, 120_000);

  const entryByCorr = (r: any, key: string) => r.entries.find((e: any) => e.evidence.correlationId === corr(key));

  test('AO answered every request through its production route (status per case)', () => {
    for (const d of Object.keys(DOMAIN_OPS)) expect(res[`live-${d}`].status, `live-${d}: ${JSON.stringify(res[`live-${d}`].body).slice(0, 300)}`).toBe(200);
    expect(res['tenant-b'].status).toBe(200);
    expect(res.pending.status).toBe(202);
    expect(res.pending.body.status).toBe('pending_approval');
    expect(res.dry.status).toBe(200);
    // Every case reports its row persisted (FX-AO3) — a lost row would fail here, not later.
    for (const [k, r] of Object.entries(res)) expect(r.body?.evidencePersisted, k).toBe(true);
  });

  test('one live op per admin domain A-H: visible with commandId + requestorUPN, and credited', () => {
    const r = readA();
    const liveSat = views.liveSatAdminOpsControls(r.parsed);
    const { controls } = assess(r.sources);
    const status = new Map(controls.map((c: any) => [c.control_id, c.status]));
    for (const [d, id] of Object.entries(DOMAIN_OPS)) {
      const e = entryByCorr(r, `live-${d}`);
      expect(e, `domain ${d} (${id}) row not visible to EO`).toBeDefined();
      const ev = e.evidence;
      expect(ev.commandId).toBe(id);
      expect(ev.commandId.startsWith(d)).toBe(true);
      expect(typeof ev.requestorUPN === 'string' && ev.requestorUPN.trim() !== '').toBe(true);
      expect(ev.requestorUPN).toBe(REQUESTOR);
      expect(ev.tenantId).toBe(env.tenantIdA);
      expect(ev.mode).toBe('live');
      expect(ev.outcome).toBe('executed');
      expect(ev.verdict).toBe('SAT');
      // Credited: every control is an 'imported' AO source, in the CRM-credit set, and assessed met.
      for (const cid of ev.controlIds) {
        const srcs = r.sources.get(cid) ?? [];
        expect(srcs.some((s: any) => s.type === 'adminops_execution' && s.result === 'imported' && s.detail.includes(corr(`live-${d}`))), `${id} ${cid} not credited`).toBe(true);
        expect(liveSat.has(cid)).toBe(true);
        expect(status.get(cid), `${id} ${cid} status`).toBe('met');
      }
    }
    expect(r.stats.live).toBe(8);
    // The ops executed their PowerShell against stacksim (loopback), not a stub.
    expect(ledgerAfter).toBeGreaterThan(ledgerBefore);
    expect(r.stats.unparsed).toBe(0);
  });

  test('CMMC deny and Tier-3 pending: visible, not credited', () => {
    const r = readA();
    const deny = entryByCorr(r, 'deny')?.evidence;
    const pend = entryByCorr(r, 'pending')?.evidence;
    expect(deny, 'deny row not visible').toBeDefined();
    expect(pend, 'pending row not visible').toBeDefined();
    expect(deny.commandId).toBe(DENY_CMD);
    expect(deny.outcome).toBe('denied_cmmc');
    expect(pend.commandId).toBe(PENDING_CMD);
    expect(pend.outcome).toBe('blocked_pending_approval');
    expect(pend.targetUPN).toBe('departing.user@ft-te1.sim'); // contract 1.3.0 target identity
    expect(r.stats.denied).toBe(1);
    expect(r.stats.blocked).toBe(1);
    const liveSat = views.liveSatAdminOpsControls(r.parsed);
    const { controls } = assess(r.sources);
    for (const ev of [deny, pend]) {
      expect(typeof ev.requestorUPN === 'string' && ev.requestorUPN !== '').toBe(true);
      for (const cid of ev.controlIds) {
        expect((r.sources.get(cid) ?? []).some((s: any) => s.detail.includes(ev.correlationId))).toBe(false);
        expect(liveSat.has(cid)).toBe(false);
        expect(controls.find((c: any) => c.control_id === cid)?.status).not.toBe('met');
      }
    }
  });

  test('dry run: visible as a preview, SPRS unchanged', () => {
    const r = readA();
    const e = entryByCorr(r, 'dry');
    expect(e, 'dry-run row not visible').toBeDefined();
    expect(e.evidence.commandId).toBe(DRY_CMD);
    expect(e.evidence.mode).toBe('dry_run');
    expect(views.isPreview(e.evidence)).toBe(true);
    expect(views.toExecutionView(e).label).toBe('preview');
    expect(views.toExplorerItem(e).title).toContain('(preview)');
    expect(r.stats.dryRun).toBe(1);
    const after = assess(r.sources);
    expect(after.score).toBe(sprsBeforeDry);
    for (const c of after.controls) expect(c.status, c.control_id).toBe(statusBeforeDry.get(c.control_id));
    for (const cid of e.evidence.controlIds) expect(after.controls.find((c: any) => c.control_id === cid)?.status).not.toBe('met');
  });

  test('EO routes (real router over HTTP): tenant A sees its 11 rows by correlationId, items open, B\'s row absent', async () => {
    const idx = await fetch(`${base}/api/evidence-explorer/index?tenant=${SLUG_A}`);
    expect(idx.status).toBe(200);
    const ao = (((await idx.json()) as any).items as any[]).filter((i) => i.source === 'adminops');
    const exe = await fetch(`${base}/api/adminops/executions?tenant=${SLUG_A}`);
    expect(exe.status).toBe(200);
    const exeBody = (await exe.json()) as any;
    const corrs = new Set((exeBody.executions as any[]).map((x) => x.correlationId));
    const expectKeys = [...Object.keys(DOMAIN_OPS).map((d) => `live-${d}`), 'deny', 'pending', 'dry'];
    for (const k of expectKeys) expect(corrs.has(corr(k)), `executions missing ${k}`).toBe(true);
    expect(corrs.has(corr('tenant-b'))).toBe(false);
    expect(ao.length).toBe(expectKeys.length);
    expect((exeBody.executions as any[]).find((x) => x.correlationId === corr('dry')).label).toBe('preview');
    // Open each item by the path the index returned (FX-EO2).
    for (const item of ao) {
      const r = await fetch(`${base}/api/evidence-explorer/item?tenant=${SLUG_A}&source=adminops&path=${encodeURIComponent(item.path)}`);
      expect(r.status, item.path).toBe(200);
      const { content } = (await r.json()) as any;
      expect(content.commandId).toBeTruthy();
      expect(corrs.has(content.correlationId)).toBe(true);
    }
  });

  test('tenant scoping: B sees only its own row; A never sees B\'s (reader and routes)', async () => {
    expect(entryByCorr(readA(), 'tenant-b')).toBeUndefined();
    const rb = new Reader(env.tenantIdB, env.dbPath).read();
    expect(rb.entries.map((e: any) => e.evidence.correlationId)).toEqual([corr('tenant-b')]);
    expect(rb.entries[0].evidence.commandId).toBe(B_CMD);
    const exe = await fetch(`${base}/api/adminops/executions?tenant=${SLUG_B}`);
    expect(exe.status).toBe(200);
    expect((((await exe.json()) as any).executions as any[]).map((x) => x.correlationId)).toEqual([corr('tenant-b')]);
    const idx = await fetch(`${base}/api/evidence-explorer/index?tenant=${SLUG_B}`);
    const ao = (((await idx.json()) as any).items as any[]).filter((i) => i.source === 'adminops');
    expect(ao).toHaveLength(1);
    expect((await fetch(`${base}/api/adminops/executions`)).status).toBe(400);
  });
});

