// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// synthetic-customer W5 cycle 3, ST-C3 (from the EO rules-2 log): a record credits only the controls its
// own registry entry evidences. (1) control_ids trimmed on the entries that listed controls they neither
// configure nor read; (2) a record's metadata.controlIds is its entry's control_ids, not the union of
// every entry in its task (which the translate enrichment builds).
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { CommandRegistry } from '../../src/registry/CommandRegistry';
import { ManifestReader } from '../../src/translators/ManifestReader';
import { PlanTranslator } from '../../src/translators/PlanTranslator';
import { PowerShellAdapter } from '../../src/adapters/PowerShellAdapter';
import { StamperConfig } from '../../src/config/StamperConfig';
import { ExecutionContext } from '../../src/core/ExecutionContext';
import { evidenceDirForTenant, evidenceFileForEntry, taskEvidencePath } from '../../src/core/EvidenceReadinessAnalyzer';
import type { ExeTask, SubCommand } from '../../src/types/schema.types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, '../fixtures');
const registry = CommandRegistry.load(path.resolve(__dirname, '../../src/registry/cmmc-l2-commands.registry.json'));
const byId = (id: string) => registry.allEntries.find(e => e.entry_id === id)!;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

const PIPELINE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'stamper-stc3-'));
const savedRoot = process.env.CES_PIPELINE_ROOT;
beforeAll(() => { process.env.CES_PIPELINE_ROOT = PIPELINE_ROOT; });
afterAll(() => {
  if (savedRoot === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = savedRoot;
  fs.rmSync(PIPELINE_ROOT, { recursive: true, force: true });
});

const EXPECTED: Record<string, string[]> = {
  'SC.L1-3.13.1.nsg-boundary-rules': ['SC.L1-3.13.1', 'SC.L2-3.13.6', 'SC.L1-3.13.5'], // W5c5: SC.L2-3.13.10 moved to its key-vault entry
  'SC.L1-3.13.1.endpoint-firewall': ['SC.L1-3.13.1', 'SC.L2-3.13.6'],
  'AC.L2-3.1.1.operator-discover': ['AC.L1-3.1.1'],
  'AC.L2-3.1.1.breakglass-discover': ['AC.L1-3.1.1'],
  'AC.L2-3.1.3.byod-dlp-policies': ['AC.L1-3.1.22'],
  'AC.L2-3.1.3.byod-dlp-matches': ['AC.L1-3.1.22'],
  'MP.L2-3.8.5.media-access': ['MP.L2-3.8.5'],
};

describe('ST-C3: trimmed control_ids', () => {
  for (const [id, ids] of Object.entries(EXPECTED)) {
    it(`${id} lists only ${ids.join(', ')}`, () => expect(byId(id).control_ids).toEqual(ids));
  }
  it('every trimmed control keeps at least one registry entry (no task falls back to the legacy single-command path)', () => {
    for (const c of ['CM.L2-3.4.1', 'SI.L1-3.14.1', 'SI.L2-3.14.6', 'AU.L2-3.3.1', 'AU.L2-3.3.2', 'AU.L2-3.3.3', 'AC.L1-3.1.1', 'SC.L1-3.13.5', 'AC.L1-3.1.2', 'AC.L2-3.1.7', 'MP.L2-3.8.8', 'MP.L2-3.8.9', 'SC.L2-3.13.4', 'SC.L2-3.13.10']) {
      expect([c, registry.allEntries.some(e => e.control_ids.includes(c))]).toEqual([c, true]);
    }
  });
});

describe('ST-C3: translate', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stamper-stc3-tr-'));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const CONTROLS = ['AC.L1-3.1.1', 'SC.L1-3.13.1', 'AU.L2-3.3.1'];
  const plan = () => {
    const mp = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'synthetic-mission-plan.json'), 'utf-8'));
    const tm = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'synthetic-tenant-manifest.json'), 'utf-8'));
    const hp = mp.outputs.human_readable_mission_plan;
    const base = hp.steps.find((s: any) => s.task_type === 'configuration') ?? hp.steps[0];
    hp.steps = CONTROLS.map(c => ({ ...clone(base), id: `step_task_${c}_stc3`, title: c, task_type: 'configuration', control_coverage: [{ control_id: c, support_type: 'Configurable', gap_rationale: 'gap' }], depends_on: [] }));
    hp.control_directives = CONTROLS.map(c => ({ control_id: c, directive: 'implement', step_ids: [`task_${c}_stc3`] }));
    const body = tm.tenant_manifest ?? tm;
    for (const c of CONTROLS) {
      if (!body.normative_controls.some((n: any) => n.control_id === c)) body.normative_controls.push({ control_id: c, required_state: c, verification: [{ id: `chk_0_${c}`, description: 'x', method: 'config_export', expected: `${c} verification passes`, on_fail: 'flag', presence_only: true }], evidence_artifacts: [] });
    }
    const tmPath = path.join(tmp, 'tm.json');
    fs.writeFileSync(tmPath, JSON.stringify(tm));
    return new PlanTranslator(registry).translate(mp, ManifestReader.fromFile(tmPath)).plan;
  };
  const subsOf = (t: ExeTask) => (t.action.args._sub_commands ?? []) as SubCommand[];

  it('the NSG read no longer joins the access-control and audit tasks, so their controls stay their own', () => {
    const p = plan();
    const ac = p.execution_graph.find(t => subsOf(t).some(s => s.id === 'AC.L2-3.1.1.group-create'))!;
    const au = p.execution_graph.find(t => subsOf(t).some(s => s.id === 'AU.L2-3.3.1.audit-enable'))!;
    for (const t of [ac, au]) {
      expect(subsOf(t).map(s => s.id)).not.toContain('SC.L1-3.13.1.nsg-boundary-rules');
      for (const c of ['SC.L1-3.13.1', 'SC.L1-3.13.5', 'SC.L2-3.13.6', 'CM.L2-3.4.1']) expect([t.id, c, t.controls.includes(c)]).toEqual([t.id, c, false]);
    }
  });

  it('every registry sub-command carries its entry control_ids', () => {
    const p = plan();
    for (const t of p.execution_graph) for (const s of subsOf(t)) {
      const e = registry.allEntries.find(x => x.entry_id === s.id);
      if (e) expect([s.id, s.control_ids]).toEqual([s.id, e.control_ids]);
    }
  });
});

describe('ST-C3: a record names its own entry controls, not the task union', () => {
  it('endpoint-firewall in a task that also lists SC.L1-3.13.5 / SC.L2-3.13.10 (through the NSG read): the record names SC.L1-3.13.1 and SC.L2-3.13.6 only', async () => {
    const e = byId('SC.L1-3.13.1.endpoint-firewall');
    const sub: SubCommand = {
      id: e.entry_id, label: e.label, set_command: e.set_command, get_command: e.get_command, engine: e.engine,
      sequence_hint: e.sequence_hint, idempotency: e.idempotency, variables_required: e.variables_required,
      variables_runtime: e.variables_runtime, captures: e.captures, on_failure: e.on_failure,
      evidence_commands: e.evidence_commands, verification: e.verification, control_ids: e.control_ids,
    } as SubCommand;
    const read = JSON.parse(JSON.parse(fs.readFileSync(path.join(FIXTURES, 'w3-state-reads.json'), 'utf-8')).reads['SC.L1-3.13.1.endpoint-firewall']);
    const manager = { execute: async (_t: string, c: string) => (c.includes('configurationPolicies?$expand=settings,assignments') ? { stdout: JSON.stringify(read), stderr: '', exitCode: 0 } : { stdout: '', stderr: '', exitCode: 0 }) };
    const ctx = new ExecutionContext(false);
    ctx.registerCaptures({ cuiGroupId: 'group-1' });
    const task = {
      id: 't-fw', type: 'configuration', priority: 'p1', depends_on: [],
      action: { engine: 'mgraph', command: 'x', args: { _sub_commands: [sub] } },
      inputs: [], outputs: [], controls: ['SC.L1-3.13.1', 'SC.L1-3.13.5', 'SC.L2-3.13.6', 'SC.L2-3.13.10'], idempotency: 'safe', rollback: { strategy: 'none' },
    } as ExeTask;
    const config = StamperConfig.fromTenantConfig({ tenantId: 't', appId: 'a', certThumbprint: 'c', certPath: '/p', targetTenantDomain: 'test.onmicrosoft.us', clientName: 'Test' });
    const r = await new PowerShellAdapter(config, manager as any, ctx, undefined, 'stc3-fw').execute(task, {}, false);
    expect(r.success).toBe(true);
    const rec = JSON.parse(fs.readFileSync(taskEvidencePath(evidenceDirForTenant('stc3-fw'), 't-fw', evidenceFileForEntry(sub.id, sub.label).replace(/\.txt$/, '.json')), 'utf-8'));
    expect(rec.complianceVerdict).toBe('SAT');
    expect(rec.metadata.controlIds).toEqual(['SC.L1-3.13.1', 'SC.L2-3.13.6']);
  });
});
