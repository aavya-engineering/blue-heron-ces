// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W4-ST1 (MS-R6) — route test for a dry-run GET /api/execute against stacksim.
//
// The production execute router (createExecuteRouter, the one GuiServer mounts) is
// driven over real HTTP/SSE with a really-translated Muster plan (ces-muster's committed
// plan fixture, translated by the production PlanTranslator) for the stacksim sim tenant
// slug. A tenant-stacksim server runs in-process and the adapter's PowerShell is shadowed
// onto it (PSModulePath / STACKSIM_SERVER_URL, passed to the child explicitly). The test
// asserts the dry-run property: no tenant session is opened, no executable task fails,
// the results manifest is written but NOT delivered, and the sim ledger records no
// traffic at all (not even a read).
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import http from 'http';
import express from 'express';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

// CES_PIPELINE_ROOT must be set before any ces-shared path helper resolves its default.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'w4-st1-'));
process.env.CES_PIPELINE_ROOT = tmpRoot;
delete process.env.CES_MUSTER_API_URL;
delete process.env.CES_MUSTER_API_TOKEN;

import { createExecuteRouter } from '../../src/server/routes/execute.routes';
import { PlanTranslator } from '../../src/translators/PlanTranslator';
import { ManifestReader } from '../../src/translators/ManifestReader';
import { DEFAULT_SIM_TENANT_SLUG } from '../../src/tenant/stamperTenants';
import { startStacksim, applyEnv, type StacksimHarness } from '../helpers/stacksimHarness';

const MUSTER_FIXTURES = path.resolve(ROOT, '..', 'ces-muster', 'src', 'features', 'plan', '__fixtures__');
const REGISTRY = path.join(ROOT, 'src', 'registry', 'cmmc-l2-commands.registry.json');

interface SseEvent { type: string; [k: string]: any }

function translateMusterFixture(outPath: string) {
  const mp = JSON.parse(fs.readFileSync(path.join(MUSTER_FIXTURES, 'manual-mission-plan.json'), 'utf-8'));
  const controls = mp?.outputs?.human_readable_mission_plan?.controls;
  const translator = new PlanTranslator(undefined, undefined, Array.isArray(controls) && controls.length ? controls : undefined, undefined);
  translator.loadRegistry(REGISTRY);
  const { plan } = translator.translate(structuredClone(mp), ManifestReader.fromFile(path.join(MUSTER_FIXTURES, 'tenant-manifest.json')));
  fs.writeFileSync(outPath, JSON.stringify(plan, null, 2));
  return plan;
}

/** GET an SSE endpoint and collect events until the server ends the stream. */
function getSse(url: string, timeoutMs = 120_000): Promise<SseEvent[]> {
  return new Promise((resolve, reject) => {
    const events: SseEvent[] = [];
    const timer = setTimeout(() => { req.destroy(); reject(new Error(`SSE timeout; last events: ${JSON.stringify(events.slice(-3))}`)); }, timeoutMs);
    const req = http.get(url, (res) => {
      let buf = '';
      res.setEncoding('utf-8');
      res.on('data', (chunk: string) => {
        buf += chunk;
        let idx: number;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          for (const line of frame.split('\n')) {
            if (line.startsWith('data: ')) events.push(JSON.parse(line.slice(6)));
          }
        }
      });
      res.on('end', () => { clearTimeout(timer); resolve(events); });
    });
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

describe('GET /api/execute — dry-run route test against stacksim (W4-ST1 / MS-R6)', () => {
  let sim: StacksimHarness;
  let restoreEnv: () => void;
  let server: http.Server;
  let baseUrl: string;
  let planPath: string;
  let plan: any;

  beforeAll(async () => {
    sim = await startStacksim(DEFAULT_SIM_TENANT_SLUG);
    restoreEnv = applyEnv(sim.shadowEnv);
    planPath = path.join(tmpRoot, 'executable-plan.json');
    plan = translateMusterFixture(planPath);

    const app = express();
    app.use(express.json());
    app.use(createExecuteRouter(new Map(), () => false, () => undefined));
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
        resolve();
      });
    });
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((r) => server?.close(() => r()));
    restoreEnv?.();
    await sim?.stop();
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ces.db handle still open on Windows */ }
  });

  it('runs the translated Muster plan end to end as a dry run without touching the sim tenant', async () => {
    const ledgerBefore = (await sim.ledgerEntries()).length;

    const qs = new URLSearchParams({
      plan: planPath,
      tenant: DEFAULT_SIM_TENANT_SLUG,
      dryRun: 'true',
      mode: 'auto',
      uploadToBlob: 'false',
    });
    const events = await getSse(`${baseUrl}/api/execute?${qs}`);
    const types = events.map((e) => e.type);

    // Stream completed normally, no error frame.
    expect(events.filter((e) => e.type === 'error')).toEqual([]);
    expect(types[types.length - 1]).toBe('done');

    // Dry run: no tenant session was opened (the live path emits connection_log frames).
    expect(types).not.toContain('connection_log');

    // Scope + summary cover the whole translated graph.
    const scope = events.find((e) => e.type === 'execution_scope')!;
    expect(scope.stepsTotal).toBe(plan.execution_graph.length);
    expect(scope.totalControls).toBe(110);
    const summary = events.find((e) => e.type === 'summary')!;
    expect(summary.total).toBe(plan.execution_graph.length);
    // No executable task fails in a dry run. The only permitted failures are the
    // document-renderable adequacy checks (renderable-*), which read real signals
    // (prior results manifest, password-policy GET) that a fresh sim tenant does not have.
    const results = events.filter((e) => e.type === 'task_result');
    const failed = results.filter((e) => e.status === 'fail');
    for (const f of failed) {
      expect(f.taskId).toMatch(/^renderable-/);
      expect(f.message).toMatch(/^Signal not adequate for /);
    }
    expect(summary.fail).toBe(failed.length);
    const executable = plan.execution_graph.filter((t: any) => !String(t.id).startsWith('renderable-'));
    expect(executable.length).toBeGreaterThan(0);
    expect(summary.pass + summary.skip + summary.accomplished + summary.fail).toBe(plan.execution_graph.length);
    expect(summary.pass).toBeGreaterThan(0);

    // Results manifest written for the sim tenant, dry runs never delivered to Muster.
    const manifest = events.find((e) => e.type === 'execution_results_manifest')!;
    expect(manifest.data.tenantSlug).toBe(DEFAULT_SIM_TENANT_SLUG);
    expect(manifest.data.results.length).toBeGreaterThan(0);
    const delivery = events.find((e) => e.type === 'execution_results_delivery')!;
    expect(delivery.data.status).toBe('skipped');
    expect(fs.existsSync(delivery.data.manifestPath)).toBe(true);
    expect(delivery.data.manifestPath.startsWith(tmpRoot)).toBe(true);

    // The sim tenant saw no traffic at all — no create, mutate or even read-serve entry.
    expect((await sim.ledgerEntries()).length).toBe(ledgerBefore);
  }, 180_000);

  it('rejects a request without a plan with an SSE error frame', async () => {
    const events = await getSse(`${baseUrl}/api/execute?dryRun=true&tenant=${DEFAULT_SIM_TENANT_SLUG}`);
    expect(events).toEqual([{ type: 'error', message: 'plan query parameter is required' }]);
  });
});
