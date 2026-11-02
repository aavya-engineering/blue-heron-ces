// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FX-ST6 — REQ-STAMPER-CLI-NO-RESULTS-MANIFEST.
//
// 1. The real CLI `execute` (spawned via tsx against the synthetic dev fixture —
//    the mocked, dry-run adapter path) writes the shared execution-results
//    manifest to <CES_PIPELINE_ROOT>/Stamper/plan-data/<slug>/state/ and it
//    passes ces-shared's ExecutionResultsManifestSchema.
// 2. ROLE-2: Muster receives no execution results — publishing writes only the
//    local manifest (EO reads it); no Muster call, no `.delivery.json` sidecar.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'node:url';
import { ExecutionResultsManifestSchema as SharedManifestSchema } from 'ces-shared/types/execution-results';
import { ExecutionResultsCollector, ResultVerdict } from '../../src/core/ExecutionResultsCollector';
import * as Publisher from '../../src/core/ExecutionResultsPublisher';
import {
  publishExecutionResults,
  recordTaskStatuses,
  resolveResultsTenantSlug,
} from '../../src/core/ExecutionResultsPublisher';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const DEV_PLAN_ID = 'translated-synthetic-gcch-l2-001';

function sampleManifest() {
  const c = new ExecutionResultsCollector();
  c.recordControlResult('AC.L2-3.1.1', 'implement', ResultVerdict.SAT, 'completed');
  c.recordControlResult('AC.L2-3.1.2', 'automated', ResultVerdict.NOT_SAT, 'failed');
  return { collector: c, plan: { plan_id: 'translated-mp-1', variables: { _source_plan_id: 'mp-1' } } };
}

const tmpRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fx-st6-'));

function runCli(args: string[], env: Record<string, string>) {
  return spawnSync(`npx tsx src/cli/index.ts ${args.join(' ')}`, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    input: '',
    encoding: 'utf-8',
    shell: true,
    timeout: 120_000,
  });
}

describe('FX-ST6: CLI execute writes the shared results manifest', () => {
  it('stamper execute --dev writes a schema-valid manifest to the canonical state dir', () => {
    const root = tmpRoot();
    const r = runCli(['execute', '--dev', '--mode', 'auto', '--tenant', 'sim-m365-azure'], {
      CES_PIPELINE_ROOT: root, STATE_DIR: path.join(root, 'state'),
    });
    expect(r.status).toBe(0);
    const manifestPath = path.join(root, 'Stamper', 'plan-data', 'sim-m365-azure', 'state', `execution-results-${DEV_PLAN_ID}.json`);
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const parsed = SharedManifestSchema.safeParse(manifest);
    expect(parsed.success).toBe(true);
    expect(manifest.planId).toBe('synthetic-gcch-l2-001');
    expect(manifest.executablePlanId).toBe(DEV_PLAN_ID);
    expect(manifest.tenantSlug).toBe('sim-m365-azure');
    expect(manifest.totalControls).toBeGreaterThan(0);
    expect(r.stdout).toContain(manifestPath);
    // the saved report records the manifest; no delivery sidecar is written
    const reportDir = path.join(root, 'state', DEV_PLAN_ID);
    const reportJson = fs.readdirSync(reportDir).find(f => f.startsWith('execution-report-') && f.endsWith('.json'))!;
    const report = JSON.parse(fs.readFileSync(path.join(reportDir, reportJson), 'utf-8'));
    expect(report.resultsManifest.path).toBe(manifestPath);
    expect(report.resultsManifest.delivery).toBeUndefined();
    expect(fs.existsSync(manifestPath.replace(/\.json$/, '.delivery.json'))).toBe(false);
  }, 150_000);
});

describe('FX-ST6: recordTaskStatuses', () => {
  it('maps task states with the server words; a failure wins over a pass', () => {
    const c = new ExecutionResultsCollector();
    const status: Record<string, any> = { t1: 'completed', t2: 'failed', t3: 'accomplished', t4: 'skipped' };
    recordTaskStatuses(c, [
      { id: 't1', controls: ['A', 'B'] },
      { id: 't2', controls: ['B'] },
      { id: 't3', controls: ['C'] },
      { id: 't4', controls: ['D'] },
    ], id => status[id], { A: 'implement' });
    const m = c.buildManifestForPlan('run', 'sim', { plan_id: 'translated-p' });
    const by = Object.fromEntries(m.results.map(r => [r.controlId, r]));
    expect(by.A).toMatchObject({ verdict: 'sat', directive: 'automated', outcome: 'completed' });
    expect(by.B).toMatchObject({ verdict: 'not_sat', outcome: 'failed' });
    expect(by.C).toMatchObject({ verdict: 'sat', outcome: 'accomplished' });
    expect(by.D).toBeUndefined();
    expect(SharedManifestSchema.safeParse(m).success).toBe(true);
  });

  it('tenant slug: --tenant > plan.ces > variables > env > dev', () => {
    expect(resolveResultsTenantSlug({ plan_id: 'p', ces: { tenantSlug: 'a' } } as any, 'x', {})).toBe('x');
    expect(resolveResultsTenantSlug({ plan_id: 'p', ces: { tenantSlug: 'a' } } as any, undefined, {})).toBe('a');
    expect(resolveResultsTenantSlug({ plan_id: 'p', variables: { tenant_slug: 'b' } }, undefined, {})).toBe('b');
    expect(resolveResultsTenantSlug({ plan_id: 'p' }, undefined, { TENANT_SLUG: 'c' })).toBe('c');
    expect(resolveResultsTenantSlug({ plan_id: 'p' }, undefined, {})).toBe('dev');
  });
});

describe('ROLE-2: no Muster delivery', () => {
  it('publish writes only the local manifest — no Muster call, no .delivery.json sidecar', async () => {
    const prev = process.env.CES_PIPELINE_ROOT;
    const root = tmpRoot();
    process.env.CES_PIPELINE_ROOT = root;
    try {
      const { collector, plan } = sampleManifest();
      const res = await publishExecutionResults(collector, plan, 'sim-m365-azure');
      expect(Object.keys(res).sort()).toEqual(['manifest', 'manifestPath']);
      expect(res.manifestPath.startsWith(root)).toBe(true);
      expect(path.basename(res.manifestPath)).toBe('execution-results-translated-mp-1.json');
      expect(SharedManifestSchema.safeParse(JSON.parse(fs.readFileSync(res.manifestPath, 'utf-8'))).success).toBe(true);
      expect(fs.readdirSync(path.dirname(res.manifestPath)).filter(f => f.endsWith('.delivery.json'))).toEqual([]);
    } finally {
      if (prev === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = prev;
    }
  });

  it('exports no Muster delivery surface', () => {
    for (const name of ['deliverExecutionResults', 'resolveMusterEndpoint', 'MUSTER_SLUG_RE']) {
      expect((Publisher as Record<string, unknown>)[name]).toBeUndefined();
    }
  });
});
