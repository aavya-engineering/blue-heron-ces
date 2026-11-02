// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// PH-13 (P13-LV design, P13-INT integration), founder decision 2026-11-01 for PS.L2-3.9.2[b] on G5 (approve first,
// then act): AdminOps A-22 ends a confirmed leaver's access; Stamper's verify-only read
// PS.L2-3.9.2.leaver-access-terminated judges the result (every past leaver disabled and unlicensed). The Lifecycle
// Workflows route PS.L2-3.9.2.leaver-workflow is licence-gated (Entra ID Governance, not in G5): the translator leaves it
// out unless the tenant record opts in, and says so in a LICENCE_GATED_OFF warning.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { CommandRegistry } from '../../src/registry/CommandRegistry';
import { CommandRegistrySchema } from '../../src/registry/command-registry.types';
import { lookupGetCommand } from '../../src/registry/lookup';
import { PowerShellAdapter } from '../../src/adapters/PowerShellAdapter';
import { StamperConfig } from '../../src/config/StamperConfig';
import { ExecutionContext } from '../../src/core/ExecutionContext';
import { evidenceDirForTenant, evidenceFileForEntry, taskEvidencePath } from '../../src/core/EvidenceReadinessAnalyzer';
import { ManifestReader } from '../../src/translators/ManifestReader';
import { PlanTranslator } from '../../src/translators/PlanTranslator';
import type { ExeTask, SubCommand } from '../../src/types/schema.types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, '../fixtures');
const REGISTRY_PATH = path.resolve(__dirname, '../../src/registry/cmmc-l2-commands.registry.json');
const registry = CommandRegistry.load(REGISTRY_PATH);
const ID = 'PS.L2-3.9.2.leaver-access-terminated';
const LCW = 'PS.L2-3.9.2.leaver-workflow';
const byId = (id: string) => registry.allEntries.find(e => e.entry_id === id)!;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

const PIPELINE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'stamper-ph13-leaver-'));
const savedRoot = process.env.CES_PIPELINE_ROOT;
beforeAll(() => { process.env.CES_PIPELINE_ROOT = PIPELINE_ROOT; });
afterAll(() => {
  if (savedRoot === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = savedRoot;
  fs.rmSync(PIPELINE_ROOT, { recursive: true, force: true });
});

/** The inventory object the GET's PowerShell emits (mirrored for the fixtures). */
const inventory = (past: number, enabled: string[], licensed: string[]) => ({
  displayName: 'CES leaver access inventory', pastLeaverCount: past, enabledPastLeaverCount: enabled.length,
  licensedPastLeaverCount: licensed.length, enabledPastLeavers: enabled, licensedPastLeavers: licensed,
});
// Fictional simulator shapes (tenant-stacksim ph13LeaverRead.pwsh.test.ts reads these values on each seed).
const S1_BEFORE = inventory(2, ['merrin.hollinmere@s1-mach.simtenant.onmicrosoft.us'], ['merrin.hollinmere@s1-mach.simtenant.onmicrosoft.us']);
const S1_AFTER = inventory(2, [], []);
const S3 = inventory(2, ['a@s3-def.simtenant.onmicrosoft.us', 'b@s3-def.simtenant.onmicrosoft.us'], []);
const MP = inventory(0, [], []);

describe('PH-13 leaver: registry entries', () => {
  it('the registry validates; the new entry is verify-only, PS.L2-3.9.2[b] only, never writes', () => {
    expect(CommandRegistrySchema.safeParse(JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'))).success).toBe(true);
    const e = byId(ID);
    expect(e.control_ids).toEqual(['PS.L2-3.9.2']);
    expect(e.objective_ids).toEqual(['PS.L2-3.9.2[b]']);
    expect(e.verify_only).toBe(true);
    expect(e.idempotency).toBe('safe');
    expect(e.set_command).toBe('');
    expect(e.variables_required).toEqual([]);
    expect(e.variables_runtime).toEqual([]);
    expect(e.source).toMatch(/^https:\/\/learn\.microsoft\.com\//);
    expect(e.verification?.postcheck_mode).toBe('state');
    // V94: a top-level literal; the three checks decide.
    expect(e.verification?.evidence).toMatchObject({ jsonpath: '$.enabledPastLeaverCount', equals: '0' });
    expect(e.verification?.evidence?.checks).toEqual([
      { jsonpath: '$.pastLeaverCount', min: 1 },
      { jsonpath: '$.enabledPastLeaverCount', equals: '0' },
      { jsonpath: '$.licensedPastLeaverCount', equals: '0' },
    ]);
  });

  it('get_command is the GET generated from the lookup block; it reads past leavers by employeeLeaveDateTime (GCC High Graph)', () => {
    const e = byId(ID);
    expect(e.get_command).toBe(lookupGetCommand(e.lookup!));
    expect(e.lookup!.by_name).toEqual({ path: '$.displayName', equals: 'CES leaver access inventory' });
    expect(e.lookup!.source).toContain('https://graph.microsoft.us/v1.0/users?`$filter=employeeLeaveDateTime le $now');
    expect(e.lookup!.source).toContain("displayName='CES leaver access inventory'");
    expect(e.lookup!.source).not.toMatch(/ConvertTo-Json/); // the generated GET converts once, after the selection
    expect(e.get_command).not.toMatch(/\{\w+\}/);
  });

  it('the Lifecycle Workflows route is licence-gated (Entra ID Governance, opt-in entra_id_governance)', () => {
    expect((byId(LCW) as unknown as { licence_gate?: unknown }).licence_gate).toMatchObject({ licence: 'Microsoft Entra ID Governance', opt_in: 'entra_id_governance' });
    expect(registry.allEntries.filter(x => (x as unknown as { licence_gate?: unknown }).licence_gate).map(x => x.entry_id)).toEqual([LCW]);
  });
});

// ---- the adapter's verify-only path ----
const config = () => StamperConfig.fromTenantConfig({
  tenantId: 'test-tenant', appId: 'test-app', certThumbprint: 'test-thumbprint',
  certPath: '/path/to/cert', targetTenantDomain: 'test.onmicrosoft.us', clientName: 'Test Client',
});
const asSub = (): SubCommand => {
  const e = byId(ID);
  return {
    id: e.entry_id, label: e.label, set_command: e.set_command, get_command: e.get_command, engine: e.engine,
    sequence_hint: e.sequence_hint, idempotency: e.idempotency, variables_required: e.variables_required,
    variables_runtime: e.variables_runtime, captures: e.captures, on_failure: e.on_failure,
    evidence_commands: e.evidence_commands, verification: e.verification, lookup: e.lookup, verify_only: true,
  } as SubCommand;
};
const taskOf = (id: string, s: SubCommand): ExeTask => ({
  id, type: 'configuration', priority: 'p1', depends_on: [],
  action: { engine: s.engine, command: 'placeholder', args: { _sub_commands: [s], _directive: 'implement' } },
  inputs: [], outputs: [], controls: ['PS.L2-3.9.2'], idempotency: 'safe', rollback: { strategy: 'none' },
} as ExeTask);
function fakeTenant(sub: SubCommand, read: unknown) {
  const sent: string[] = [];
  return {
    sent,
    manager: {
      execute: async (_t: string, command: string) => {
        sent.push(command);
        if (command.includes(sub.get_command)) return { stdout: JSON.stringify(read, null, 4), stderr: '', exitCode: 0 };
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    },
  };
}
const recordOf = (tenant: string, taskId: string, sub: SubCommand) =>
  JSON.parse(fs.readFileSync(taskEvidencePath(evidenceDirForTenant(tenant), taskId, evidenceFileForEntry(sub.id, sub.label).replace(/\.txt$/, '.json')), 'utf-8'));

async function run(tenant: string, taskId: string, read: unknown) {
  const sub = asSub();
  const fake = fakeTenant(sub, read);
  const adapter = new PowerShellAdapter(config(), fake.manager as any, new ExecutionContext(false), undefined, tenant);
  const r = await adapter.execute(taskOf(taskId, sub), {}, false);
  return { r, sent: fake.sent, rec: recordOf(tenant, taskId, sub) };
}

describe('PH-13 leaver: execute (verify-only); the read runs and its checks decide', () => {
  it('S1 before the leaver flow (a past leaver still enabled and licensed): NOT_SAT, no SET', async () => {
    const { r, sent, rec } = await run('ph13-lv-s1-before', 't-lv-1', S1_BEFORE);
    expect(r.success).toBe(false);
    expect(sent.some(x => x.includes('employeeLeaveDateTime'))).toBe(true);
    expect(sent.every(x => !/-Method (PATCH|POST|DELETE)/.test(x))).toBe(true);
    expect(rec.complianceVerdict).toBe('NOT_SAT');
    expect(rec.metadata.commandExecuted).toBe('[verify-only: SET not sent]');
    expect(rec.metadata.preStateOutput).toContain('merrin.hollinmere');
  });

  it('S1 / S2 after A-22 (every past leaver disabled and unlicensed): SAT, state mode, matched by name', async () => {
    const { r, rec } = await run('ph13-lv-s1-after', 't-lv-2', S1_AFTER);
    expect(r.success).toBe(true);
    expect(rec.complianceVerdict).toBe('SAT');
    expect(rec.metadata.postcheckMode).toBe('state');
    expect(rec.metadata.lookupMatch).toEqual({ basis: 'name', object: 'CES leaver access inventory' });
  });

  it('S3 (unconfirmed: two past leavers still enabled): NOT_SAT', async () => {
    const { r, rec } = await run('ph13-lv-s3', 't-lv-3', S3);
    expect(r.success).toBe(false);
    expect(rec.complianceVerdict).toBe('NOT_SAT');
  });

  it('muster-partial (no past leaver): NOT_SAT, the inventory shows nothing about terminations', async () => {
    const { r, rec } = await run('ph13-lv-mp', 't-lv-4', MP);
    expect(r.success).toBe(false);
    expect(rec.complianceVerdict).toBe('NOT_SAT');
  });

  it('a licensed but disabled past leaver: NOT_SAT (licences must go too)', async () => {
    const { r } = await run('ph13-lv-lic', 't-lv-5', inventory(1, [], ['x@s1-mach.simtenant.onmicrosoft.us']));
    expect(r.success).toBe(false);
  });
});

// ---- the translator's licence gate ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stamper-ph13-leaver-tr-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
function inputs() {
  const mp = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'synthetic-mission-plan.json'), 'utf-8'));
  const hp = mp.outputs.human_readable_mission_plan;
  const base = hp.steps.find((s: any) => s.task_type === 'configuration') ?? hp.steps[0];
  hp.steps = [{
    ...clone(base), id: 'step_task_PS.L2-3.9.2_lv', title: 'Step (PS.L2-3.9.2)', task_type: 'configuration',
    control_coverage: [{ control_id: 'PS.L2-3.9.2', support_type: 'Configurable', gap_rationale: 'gap' }], depends_on: [], dependencies: [],
  }];
  hp.control_directives = [{ control_id: 'PS.L2-3.9.2', directive: 'implement', step_ids: ['task_PS.L2-3.9.2_lv'] }];
  const tmPath = path.join(tmp, 'tm.json');
  fs.writeFileSync(tmPath, fs.readFileSync(path.join(FIXTURES, 'synthetic-tenant-manifest.json'), 'utf-8'));
  return { mp, tm: ManifestReader.fromFile(tmPath) };
}
function translate(clientConfig?: Record<string, unknown>, translator?: PlanTranslator) {
  const { mp, tm } = inputs();
  return (translator ?? new PlanTranslator(registry, clientConfig as never)).translate(mp, tm);
}
const subIds = (res: ReturnType<typeof translate>) =>
  res.plan.execution_graph.flatMap(t => ((t.action.args._sub_commands ?? []) as SubCommand[]).map(s => s.id));

describe('PH-13 leaver: the translator\'s licence gate (DD-h: recorded, never silent)', () => {
  it('no opt-in (G5): the LCW route is left out with a LICENCE_GATED_OFF warning; the leaver read is planned', () => {
    const res = translate();
    const ids = subIds(res);
    expect(ids).toContain(ID);
    expect(ids).not.toContain(LCW);
    expect(res.warnings.filter(w => w.startsWith('LICENCE_GATED_OFF:'))).toEqual([
      `LICENCE_GATED_OFF: ${LCW} needs Microsoft Entra ID Governance (opt in with licence_opt_ins: ["entra_id_governance"])`,
    ]);
  });

  it('opted in (the tenant record lists entra_id_governance): the LCW route is planned too, no warning', () => {
    const res = translate({ tenantSlug: 'lv-optin', licence_opt_ins: ['Entra_ID_Governance'] });
    const ids = subIds(res);
    expect(ids).toEqual(expect.arrayContaining([ID, LCW]));
    expect(res.warnings.some(w => w.startsWith('LICENCE_GATED_OFF:'))).toBe(false);
  });

  it('the warning is reset per translate (one per gated entry, not accumulated on a reused translator)', () => {
    const t = new PlanTranslator(registry);
    const a = translate(undefined, t);
    const b = translate(undefined, t);
    expect(a.warnings.filter(w => w.startsWith('LICENCE_GATED_OFF:'))).toHaveLength(1);
    expect(b.warnings.filter(w => w.startsWith('LICENCE_GATED_OFF:'))).toHaveLength(1);
  });
});
