// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// PH7-ST (LOG-PH7-ST.md):
// - V95: the executable plan records the infrastructure model (variables.infrastructure_model);
// - manual gates run their runnable registry entries; every record those entries write carries
//   metadata.gateContext 'manual_gate' (EO never credits it) and feeds no config_export postcheck.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { PowerShellAdapter } from '../../src/adapters/PowerShellAdapter';
import { StamperConfig } from '../../src/config/StamperConfig';
import { ExecutionContext } from '../../src/core/ExecutionContext';
import { TaskRunner } from '../../src/core/TaskRunner';
import { MANUAL_GATE_FILE } from '../../src/core/GateEvidence';
import { evidenceDirForTenant, evidenceFileForEntry, taskEvidencePath } from '../../src/core/EvidenceReadinessAnalyzer';
import { CommandRegistry } from '../../src/registry/CommandRegistry';
import { translateForTenant, projectExecutablePlan } from '../../src/translators/translateForTenant';
import type { ExeTask, SubCommand } from '../../src/types/schema.types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const registry = CommandRegistry.load(path.join(ROOT, 'src', 'registry', 'cmmc-l2-commands.registry.json'));
const MUSTER = path.resolve(ROOT, '..', 'ces-muster', 'src', 'features', 'plan', '__fixtures__');
const HAVE_MUSTER = fs.existsSync(path.join(MUSTER, 'manual-mission-plan.json'));

// Evidence and plan files go to a temporary pipeline root, never a live one.
const PIPELINE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'stamper-ph7st-'));
const savedRoot = process.env.CES_PIPELINE_ROOT;
beforeAll(() => { process.env.CES_PIPELINE_ROOT = PIPELINE_ROOT; });
afterAll(() => {
  if (savedRoot === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = savedRoot;
  fs.rmSync(PIPELINE_ROOT, { recursive: true, force: true });
});

// ---- V95 ----

function stage(name: string, model: 'm365_only' | 'm365_sentinel' | 'm365_azure') {
  const dir = path.join(PIPELINE_ROOT, 'v95', name);
  fs.mkdirSync(dir, { recursive: true });
  const mp = path.join(dir, 'manual-mission-plan_x.json');
  const tm = path.join(dir, 'tenant-manifest_x.json');
  fs.copyFileSync(path.join(MUSTER, 'manual-mission-plan.json'), mp);
  fs.copyFileSync(path.join(MUSTER, 'tenant-manifest.json'), tm);
  const im = JSON.parse(fs.readFileSync(path.join(MUSTER, 'infrastructure-manifest.json'), 'utf-8'));
  im.infrastructure.infrastructure_model = model;
  const imPath = path.join(dir, 'infrastructure-manifest_x.json');
  fs.writeFileSync(imPath, JSON.stringify(im, null, 2));
  return { mp, tm, im: imPath, dir };
}

const readPlan = (f: string) => JSON.parse(fs.readFileSync(f, 'utf-8'));

(HAVE_MUSTER ? describe : describe.skip)('V95: the executable plan records the Infrastructure Manifest model', () => {
  it.each(['m365_only', 'm365_sentinel', 'm365_azure'] as const)('%s: plan.variables.infrastructure_model is the IM model', async (model) => {
    const s = stage(model, model);
    const out = path.join(s.dir, 'executable-plan.json');
    await translateForTenant({ mode: 'cli', missionPlanPath: s.mp, manifestPath: s.tm, outputPath: out });
    expect(readPlan(out).variables.infrastructure_model).toBe(model);
  });

  it('the CLI and GUI plans record the same model (V72 projection equal)', async () => {
    const s = stage('cli-gui', 'm365_azure');
    const cli = path.join(s.dir, 'cli.json');
    const gui = path.join(s.dir, 'gui.json');
    await translateForTenant({ mode: 'cli', missionPlanPath: s.mp, manifestPath: s.tm, outputPath: cli });
    await translateForTenant({ mode: 'gui', missionPlanPath: s.mp, manifestPath: s.tm, outputPath: gui, infraManifestPath: s.im });
    expect(readPlan(gui).variables.infrastructure_model).toBe('m365_azure');
    expect(projectExecutablePlan(readPlan(cli))).toEqual(projectExecutablePlan(readPlan(gui)));
  });

  it('no Infrastructure Manifest and no tenant model: no infrastructure_model is invented', async () => {
    const dir = path.join(PIPELINE_ROOT, 'v95', 'no-im');
    fs.mkdirSync(dir, { recursive: true });
    const mp = path.join(dir, 'manual-mission-plan_x.json');
    const tm = path.join(dir, 'tenant-manifest_x.json');
    fs.copyFileSync(path.join(MUSTER, 'manual-mission-plan.json'), mp);
    fs.copyFileSync(path.join(MUSTER, 'tenant-manifest.json'), tm);
    const out = path.join(dir, 'executable-plan.json');
    await translateForTenant({ mode: 'cli', missionPlanPath: mp, manifestPath: tm, outputPath: out });
    expect(readPlan(out).variables.infrastructure_model).toBeUndefined();
  });
});

// ---- manual gates run their runnable entries ----

function liveConfig(): StamperConfig {
  const cfg = StamperConfig.fromTenantConfig({
    tenantId: 'test-tenant', appId: 'test-app', certThumbprint: 'test-thumbprint',
    certPath: '/path/to/cert', targetTenantDomain: 'test.onmicrosoft.us', clientName: 'Test Client',
  });
  Object.defineProperty(cfg, 'dryRun', { get: () => false });
  return cfg;
}

function asSub(entryId: string): SubCommand {
  const e = registry.allEntries.find(x => x.entry_id === entryId)!;
  return {
    id: e.entry_id, label: e.label, set_command: e.set_command, get_command: e.get_command, engine: e.engine,
    sequence_hint: e.sequence_hint, idempotency: e.idempotency as SubCommand['idempotency'],
    variables_required: e.variables_required, variables_runtime: e.variables_runtime, captures: e.captures,
    on_failure: e.on_failure, evidence_commands: e.evidence_commands, verification: e.verification,
  } as SubCommand;
}

const gateSub = (id: string): SubCommand => ({
  id, label: 'Manual gate', set_command: '', get_command: '', engine: 'manual_gate', sequence_hint: 0, idempotency: 'safe',
  variables_required: [], variables_runtime: [], on_failure: 'warn_continue', evidence_commands: [],
} as SubCommand);

function task(id: string, subs: SubCommand[], controls: string[], engine = 'mgraph', args: Record<string, unknown> = {}): ExeTask {
  return {
    id, type: 'configuration', priority: 'p1', depends_on: [],
    action: { engine, command: 'placeholder', args: { _sub_commands: subs, ...args } },
    inputs: [], outputs: [], controls, idempotency: 'safe', rollback: { strategy: 'none' },
  } as ExeTask;
}

/** A session that answers every command with one JSON object and records what it received. */
function fakeSession(stdout = '{"Id":"obj-1","displayName":"CMMC Removable Storage","currentScore":42}') {
  const received: string[] = [];
  return { received, manager: { execute: async (_t: string, command: string) => { received.push(command); return { stdout, stderr: '', exitCode: 0 }; } } };
}

const stubCollector = { collectTaskEvidence: async () => [], getPlanEvidence: () => [] } as any;
const perTask = (tenant: string, taskId: string, sub: SubCommand) =>
  JSON.parse(fs.readFileSync(taskEvidencePath(evidenceDirForTenant(tenant), taskId, evidenceFileForEntry(sub.id, sub.label).replace(/\.txt$/, '.json')), 'utf-8'));
const latest = (tenant: string, sub: SubCommand) =>
  JSON.parse(fs.readFileSync(path.join(evidenceDirForTenant(tenant), evidenceFileForEntry(sub.id, sub.label).replace(/\.txt$/, '.json')), 'utf-8'));

describe('PH7-ST: a manual gate runs its runnable entries, and their records are gate-context', () => {
  const realSetTimeout = global.setTimeout;
  beforeEach(() => {
    (global as any).setTimeout = (fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) =>
      realSetTimeout(fn, ms !== undefined && ms >= 5000 ? 0 : ms, ...args);
  });
  afterEach(() => { (global as any).setTimeout = realSetTimeout; });

  it('the gate runs its reads; both record copies carry metadata.gateContext manual_gate; the gate stays PROVISIONAL', async () => {
    const s = fakeSession();
    const ctx = new ExecutionContext(false);
    ctx.loadManifestVariables({ tenantId: 'test-tenant' });
    const runner = new TaskRunner(liveConfig(), stubCollector, undefined, undefined, s.manager as any, ctx, 'ph7st-gate');
    const subs = [asSub('MP.L2-3.8.7.removable-media-intune'), asSub('IA.L2-3.5.11.branding')];
    const t = task('manual-MP.L2-3.8.7', [gateSub('manual-MP.L2-3.8.7'), ...subs], ['MP.L2-3.8.7'], 'manual_gate', { _directive: 'manual' });
    const { result } = await runner.executeTask(t, 'plan-ph7st', { tenantId: 'test-tenant' });
    expect(result.success).toBe(true);
    // The reads were sent; nothing was sent for the gate pseudo-entry.
    // PH-13 (P13-ST): the removable-media read was re-aimed to the REST device-configuration list (by effect).
    expect(s.received.some(c => c.includes('/deviceManagement/deviceConfigurations'))).toBe(true);
    // branding is evidence-only with no SET: only its evidence command (/organization) runs.
    expect(s.received.some(c => c.includes('/v1.0/organization'))).toBe(true);
    for (const sub of subs) {
      expect(perTask('ph7st-gate', t.id, sub).metadata.gateContext).toBe('manual_gate');
      expect(latest('ph7st-gate', sub).metadata.gateContext).toBe('manual_gate');
    }
    // The gate record is written as before: PROVISIONAL, gate manual, no action.
    const gate = JSON.parse(fs.readFileSync(taskEvidencePath(evidenceDirForTenant('ph7st-gate'), t.id, MANUAL_GATE_FILE), 'utf-8'));
    expect(gate.complianceVerdict).toBe('PROVISIONAL');
    expect(gate.metadata.gate).toBe('manual');
    expect(gate.metadata.gateAction).toBe('none');
    // Display only: no gate read reaches a config_export postcheck.
    expect(runner.getEntryStateRecords()).toEqual([]);
  });

  it('a manual-gate sub-command and an empty entry are not run', async () => {
    const s = fakeSession();
    const runner = new TaskRunner(liveConfig(), stubCollector, undefined, undefined, s.manager as any, new ExecutionContext(false), 'ph7st-empty');
    const empty = { ...asSub('MP.L2-3.8.7.removable-media-intune'), id: 'X.empty', get_command: '  ', set_command: '' } as SubCommand;
    const otherGate = { ...gateSub('X.manual-only'), get_command: 'Get-Anything' } as SubCommand;
    const t = task('manual-PE.L1-3.10.1', [gateSub('manual-PE.L1-3.10.1'), empty, otherGate], ['PE.L1-3.10.1'], 'manual_gate', { _directive: 'manual' });
    const { result } = await runner.executeTask(t, 'plan-ph7st', {});
    expect(result.success).toBe(true);
    expect(s.received).toEqual([]);
  });

  it('a dry run sends nothing', async () => {
    const s = fakeSession();
    const cfg = StamperConfig.fromTenantConfig({ tenantId: 't', appId: 'a', certThumbprint: 'c', certPath: '/p', targetTenantDomain: 'd.onmicrosoft.us', clientName: 'C' });
    const runner = new TaskRunner(cfg, stubCollector, undefined, undefined, s.manager as any, new ExecutionContext(true), 'ph7st-dry');
    const t = task('manual-MP.L2-3.8.7', [gateSub('manual-MP.L2-3.8.7'), asSub('MP.L2-3.8.7.removable-media-intune')], ['MP.L2-3.8.7'], 'manual_gate', { _directive: 'manual' });
    await runner.executeTask(t, 'plan-ph7st', {});
    expect(s.received).toEqual([]);
  });

  it('an ordinary task is unchanged: no gateContext, and its read feeds postchecks', async () => {
    const s = fakeSession();
    const adapter = new PowerShellAdapter(liveConfig(), s.manager as any, new ExecutionContext(false), undefined, 'ph7st-plain');
    const sub = asSub('MP.L2-3.8.7.removable-media-intune');
    const t = task('t-plain', [sub], ['MP.L2-3.8.7']);
    const r = await adapter.execute(t, {}, false);
    expect(r.success).toBe(true);
    expect(perTask('ph7st-plain', t.id, sub).metadata.gateContext).toBeUndefined();
    expect(adapter.getEntryStateRecords().map(e => e.entryId)).toEqual([sub.id]);
  });
});
