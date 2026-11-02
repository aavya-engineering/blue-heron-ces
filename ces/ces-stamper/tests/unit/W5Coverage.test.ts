// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// synthetic-customer W5 cycle 2 (coverage slice): two EvidenceOps (EO) coverage gaps from run 45.
// (1) IA.L2-3.5.10: a SET-path entry creates an enabled CA policy that blocks legacy authentication
//     for all users; its GET also finds an existing policy with the same effect (no duplicate).
// (2) AC.L2-3.1.3: the CUI label and its publishing policy are created by the MP.L2-3.8.1 entries,
//     now also mapped to AC.L2-3.1.3; the label SET adds content marking.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { CommandRegistry } from '../../src/registry/CommandRegistry';
import { CommandRegistrySchema } from '../../src/registry/command-registry.types';
import { ManifestReader } from '../../src/translators/ManifestReader';
import { PlanTranslator } from '../../src/translators/PlanTranslator';
import { OutputVerificationEngine } from '../../src/core/OutputVerificationEngine';
import { PostcheckRunner } from '../../src/core/PostcheckRunner';
import { PowerShellAdapter } from '../../src/adapters/PowerShellAdapter';
import { StamperConfig } from '../../src/config/StamperConfig';
import { ExecutionContext } from '../../src/core/ExecutionContext';
import { evidenceDirForTenant, evidenceFileForEntry, taskEvidencePath } from '../../src/core/EvidenceReadinessAnalyzer';
import type { Check, ExeTask, SubCommand } from '../../src/types/schema.types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = path.resolve(__dirname, '../../src/registry/cmmc-l2-commands.registry.json');
const FIXTURES = path.resolve(__dirname, '../fixtures');
const registry = CommandRegistry.load(REGISTRY_PATH);
const byId = (id: string) => registry.allEntries.find(e => e.entry_id === id)!;
const LEGACY = 'IA.L2-3.5.10.block-legacy-auth';
const CUI_LABEL = 'MP.L2-3.8.1.cui-label';
const LABEL_POLICY = 'MP.L2-3.8.1.label-policy';

// ---- EO's conditions, copied (read-only reference: ces-eo src/eo/mapping/evaluators/conditions.ts,
// ia-evaluators.ts certBasedAuthEvaluator, ac-evaluators.ts CUI_LABEL_RE). A test here cannot import ces-eo.
const eoLegacyBlock = (p: any): boolean => p.state === 'enabled'
  && (p.grantControls?.builtInControls ?? []).includes('block')
  && (p.conditions?.users?.includeUsers ?? []).some((u: string) => String(u).toLowerCase() === 'all')
  && (p.conditions?.clientAppTypes ?? []).some((t: string) => t === 'exchangeActiveSync' || t === 'other');
const EO_CUI_LABEL_RE = /\bCUI\b|controlled unclassified/i;

/** S1's seeded policy (simulated tenant s1-mach, caPolicy-3). */
const S1_SEED = {
  id: 'caPolicy-3', displayName: 'S1-CA03 Block legacy authentication', state: 'enabled',
  conditions: { users: { includeUsers: ['All'], excludeUsers: ['user-50', 'user-51'], excludeGroups: ['group-12'] }, applications: { includeApplications: ['All'] }, clientAppTypes: ['exchangeActiveSync', 'other'] },
  grantControls: { operator: 'OR', builtInControls: ['block'] },
};
/** What a Graph read of the policy the SET creates returns (break-glass id resolved). */
const CREATED = {
  id: 'CMMC-Block-Legacy-Auth', displayName: 'CMMC-Block-Legacy-Auth', state: 'enabled',
  conditions: { users: { includeUsers: ['All'], excludeUsers: ['user-5'] }, applications: { includeApplications: ['All'] }, clientAppTypes: ['exchangeActiveSync', 'other'] },
  grantControls: { operator: 'OR', builtInControls: ['block'] },
};
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const engine = new OutputVerificationEngine();
const passes = (entryId: string, read: unknown) =>
  engine.verify({ stdout: '', stderr: '', exitCode: 0 }, { stdout: JSON.stringify(read, null, 4), exitCode: 0 }, byId(entryId).verification).details.evidence_check === true;

describe('W5c2 coverage: registry', () => {
  it('the registry validates against the schema and keeps unique ids (153 entries: 151 + legacy-auth + the run-50 compliance policy)', () => {
    const raw = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
    expect(CommandRegistrySchema.safeParse(raw).success).toBe(true);
    const ids = raw.entries.map((e: any) => e.entry_id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(184); // PH-12 merge: 153 + 30 = + 8 AU/IA (P12-R1), + 5 AC (P12-R2), + 4 SC (P12-R3), + 4 SI and 1 IR (P12-R4), + 6 CM, 1 MA, 1 PS (P12-R5); CG: + SC.L2-3.13.10.key-escrow; DEPTH-1a: - PE.L2-3.10.1/3/4/5 + MP.L2-3.8.3.sanitize duplicates; W5c5: + SC.L2-3.13.10.key-vault; W5c7: + AC.L1-3.1.1.ca-mfa-compliant-device, AU.L2-3.3.7.time-sync; W7-ST: + PS.L2-3.9.2.leaver-workflow; PH-13 (P13-LV, P13-INT): + PS.L2-3.9.2.leaver-access-terminated
  });

  it('block-legacy-auth: get-then-set, IA.L2-3.5.10 + AC.L2-3.1.12, the SET carries every required field', () => {
    const e = byId(LEGACY);
    expect(e.idempotency).toBe('get-then-set');
    expect(e.engine).toBe('mgraph');
    expect(e.control_ids).toEqual(['IA.L2-3.5.10', 'AC.L2-3.1.12']);
    expect(e.variables_runtime).toEqual(['breakGlassUserId']);
    expect(e.set_command.startsWith('New-MgIdentityConditionalAccessPolicy -BodyParameter')).toBe(true);
    for (const part of ["displayName='CMMC-Block-Legacy-Auth'", "state='enabled'", "includeUsers=@('All')", "excludeUsers=@('{breakGlassUserId}')",
      "includeApplications=@('All')", "clientAppTypes=@('exchangeActiveSync','other')", "builtInControls=@('block')"]) expect(e.set_command).toContain(part);
  });

  it('block-legacy-auth GET: by name or by effect, one object, JSON', () => {
    const e = byId(LEGACY);
    for (const cmd of [e.get_command, e.evidence_commands[0]]) {
      expect(cmd).toContain("/identity/conditionalAccess/policies').value | Where-Object");
      expect(cmd).toContain("$_.displayName -eq 'CMMC-Block-Legacy-Auth'");
      for (const c of ["$_.state -eq 'enabled'", "includeUsers -contains 'All'", "builtInControls -contains 'block'", "clientAppTypes -contains 'exchangeActiveSync'", "clientAppTypes -contains 'other'"]) expect(cmd).toContain(c);
      expect(cmd).toContain('Select-Object -First 1 | ConvertTo-Json -Depth 10');
    }
    expect(e.verification?.postcheck_mode).toBe('state');
  });

  it('the label entries now also carry AC.L2-3.1.3; their earlier controls and entry ids are unchanged', () => {
    expect(byId(CUI_LABEL).control_ids).toEqual(['MP.L2-3.8.1', 'MP.L2-3.8.2', 'MP.L2-3.8.4', 'AC.L2-3.1.3']);
    expect(byId(LABEL_POLICY).control_ids).toEqual(['MP.L2-3.8.1', 'AC.L2-3.1.3']);
    const s = byId('AC.L2-3.1.3.sensitivity-label');
    expect(s.idempotency).toBe('evidence-only');
    expect(s.control_ids).toEqual(['AC.L2-3.1.3']);
  });

  it('the CUI label SET: encryption with rights for the domain and header/footer marking; the name matches EO', () => {
    const e = byId(CUI_LABEL);
    expect(e.set_command.startsWith("New-Label -Name 'CUI'")).toBe(true);
    for (const part of ['-EncryptionEnabled $true', '-EncryptionProtectionType Template', "-EncryptionRightsDefinitions '{primaryDomain}:VIEW,",
      '-ApplyContentMarkingHeaderEnabled $true', "-ApplyContentMarkingHeaderText 'CUI'", '-ApplyContentMarkingFooterEnabled $true', "-ApplyContentMarkingFooterText 'CUI'"]) expect(e.set_command).toContain(part);
    expect(e.variables_required).toEqual(['primaryDomain']);
    expect(EO_CUI_LABEL_RE.test('CUI')).toBe(true);
    expect(EO_CUI_LABEL_RE.test('CUI - Controlled Unclassified Information')).toBe(true);
    // the state check is unchanged: name and encryption
    expect(e.verification?.evidence).toEqual({ jsonpath: '$.Name', equals: 'CUI', checks: [{ jsonpath: '$.EncryptionEnabled', equals: 'True' }] });
  });
});

describe('W5c2 coverage: verification and EO agree', () => {
  it('passes on the policy the SET creates and on S1\'s seeded policy; EO\'s condition holds for both', () => {
    for (const read of [CREATED, S1_SEED]) {
      expect(passes(LEGACY, read)).toBe(true);
      expect(eoLegacyBlock(read)).toBe(true);
    }
  });

  const wrong: Array<[string, (p: any) => void]> = [
    ['disabled', p => { p.state = 'disabled'; }],
    ['report-only', p => { p.state = 'enabledForReportingButNotEnforced'; }],
    ['a group instead of all users', p => { p.conditions.users.includeUsers = []; p.conditions.users.includeGroups = ['group-1']; }],
    ['only Exchange ActiveSync', p => { p.conditions.clientAppTypes = ['exchangeActiveSync']; }],
    ['only other clients', p => { p.conditions.clientAppTypes = ['other']; }],
    ['all client apps', p => { p.conditions.clientAppTypes = ['all']; }],
    ['MFA instead of block', p => { p.grantControls.builtInControls = ['mfa']; }],
  ];
  for (const [what, mutate] of wrong) {
    it(`fails when the policy is ${what}`, () => {
      const p = clone(CREATED);
      mutate(p);
      expect(passes(LEGACY, p)).toBe(false);
    });
  }

  it('Stamper is never looser than EO: every read EO rejects, Stamper rejects', () => {
    for (const [, mutate] of wrong) {
      const p = clone(CREATED);
      mutate(p);
      if (!eoLegacyBlock(p)) expect(passes(LEGACY, p)).toBe(false);
    }
  });

  it('the CUI label: the label the new SET creates and the earlier label without marking both pass (no exists-path regression)', () => {
    const created = { id: 'CUI', Identity: 'CUI', Name: 'CUI', DisplayName: 'CUI - Controlled Unclassified Information', Tooltip: 'Contains CUI', EncryptionEnabled: true,
      EncryptionProtectionType: 'Template', EncryptionEncryptOnly: false, ApplyContentMarkingHeaderEnabled: true, ApplyContentMarkingHeaderText: 'CUI', ApplyContentMarkingFooterEnabled: true, ApplyContentMarkingFooterText: 'CUI' };
    const earlier = { id: 'CUI', Identity: 'CUI', Name: 'CUI', DisplayName: 'CUI - Controlled Unclassified Information', Tooltip: 'Contains CUI', EncryptionEnabled: true, EncryptionProtectionType: 'Template', EncryptionEncryptOnly: false };
    expect(passes(CUI_LABEL, created)).toBe(true);
    expect(passes(CUI_LABEL, earlier)).toBe(true);
    expect(passes(CUI_LABEL, { ...created, EncryptionEnabled: false })).toBe(false);
    expect(passes(LABEL_POLICY, { id: 'CMMC-CUI-Policy', Identity: 'CMMC-CUI-Policy', Name: 'CMMC-CUI-Policy', Labels: 'CUI', ExchangeLocation: 'All' })).toBe(true);
  });
});

// ---- adapter: get-then-set on the two tenants' shapes (fake session) ----

function makeConfig(): StamperConfig {
  return StamperConfig.fromTenantConfig({
    tenantId: 'test-tenant', appId: 'test-app', certThumbprint: 'test-thumbprint',
    certPath: '/path/to/cert', targetTenantDomain: 'test.onmicrosoft.us', clientName: 'Test Client',
  });
}
function asSub(entryId: string): SubCommand {
  const e = byId(entryId);
  return {
    id: e.entry_id, label: e.label, set_command: e.set_command, get_command: e.get_command, engine: e.engine,
    sequence_hint: e.sequence_hint, idempotency: e.idempotency as SubCommand['idempotency'],
    variables_required: e.variables_required, variables_runtime: e.variables_runtime, captures: e.captures,
    on_failure: e.on_failure, evidence_commands: e.evidence_commands, verification: e.verification,
  } as SubCommand;
}
function task(id: string, subs: SubCommand[], controls: string[]): ExeTask {
  return {
    id, type: 'configuration', priority: 'p1', depends_on: [],
    action: { engine: 'mgraph', command: 'placeholder', args: { _sub_commands: subs } },
    inputs: [], outputs: [], controls, idempotency: 'safe', rollback: { strategy: 'none' },
  } as ExeTask;
}
function fakeSession(before: string, after: string) {
  const received: string[] = [];
  let set = false;
  return {
    received,
    manager: {
      execute: async (_t: string, command: string) => {
        received.push(command);
        if (/^New-MgIdentityConditionalAccessPolicy/.test(command)) { set = true; return { stdout: '{"id":"CMMC-Block-Legacy-Auth"}', stderr: '', exitCode: 0 }; }
        if (/conditionalAccess\/policies'\)\.value/.test(command)) return { stdout: set ? after : before, stderr: '', exitCode: 0 };
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    },
  };
}
const record = (tenant: string, taskId: string, sub: SubCommand): any => {
  const evidFile = evidenceFileForEntry(sub.id, sub.label).replace(/\.txt$/, '.json');
  return JSON.parse(fs.readFileSync(taskEvidencePath(evidenceDirForTenant(tenant), taskId, evidFile), 'utf-8'));
};

describe('W5c2 coverage: get-then-set (S1 exists, muster-partial creates)', () => {
  const PIPELINE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'stamper-w5c2-cov-'));
  const savedRoot = process.env.CES_PIPELINE_ROOT;
  const realSetTimeout = global.setTimeout;
  beforeAll(() => { process.env.CES_PIPELINE_ROOT = PIPELINE_ROOT; });
  afterAll(() => {
    if (savedRoot === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = savedRoot;
    fs.rmSync(PIPELINE_ROOT, { recursive: true, force: true });
  });
  beforeEach(() => {
    (global as any).setTimeout = (fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) =>
      realSetTimeout(fn, ms !== undefined && ms >= 5000 ? 0 : ms, ...args);
  });
  afterEach(() => { (global as any).setTimeout = realSetTimeout; });

  const ctx = () => {
    const c = new ExecutionContext(false);
    c.loadManifestVariables({ breakGlassUserId: 'user-5' });
    return c;
  };

  it('S1: the GET finds the seeded legacy-auth block policy; verified SAT, no SET (no duplicate)', async () => {
    const sub = asSub(LEGACY);
    const t = fakeSession(JSON.stringify(S1_SEED, null, 4), JSON.stringify(S1_SEED, null, 4));
    const adapter = new PowerShellAdapter(makeConfig(), t.manager as any, ctx(), undefined, 'w5c2-s1');
    const r = await adapter.execute(task('t-legacy-s1', [sub], ['AC.L2-3.1.12', 'IA.L2-3.5.10']), { breakGlassUserId: 'user-5' }, false);
    expect(r.success).toBe(true);
    expect(t.received.some(c => c.startsWith('New-MgIdentityConditionalAccessPolicy'))).toBe(false);
    const rec = record('w5c2-s1', 't-legacy-s1', sub);
    expect(rec.complianceVerdict).toBe('SAT');
    expect(rec.metadata.postcheckMode).toBe('state');
    expect(rec.verificationResult.details.evidence_check).toBe(true);
  });

  it('muster-partial: no matching policy (empty read); the SET creates it with the break-glass id and the re-read is verified', async () => {
    const sub = asSub(LEGACY);
    const t = fakeSession('', JSON.stringify(CREATED, null, 4));
    const adapter = new PowerShellAdapter(makeConfig(), t.manager as any, ctx(), undefined, 'w5c2-mp');
    const r = await adapter.execute(task('t-legacy-mp', [sub], ['AC.L2-3.1.12', 'IA.L2-3.5.10']), { breakGlassUserId: 'user-5' }, false);
    expect(r.success).toBe(true);
    const sent = t.received.find(c => c.startsWith('New-MgIdentityConditionalAccessPolicy'))!;
    expect(sent).toContain("excludeUsers=@('user-5')");
    const rec = record('w5c2-mp', 't-legacy-mp', sub);
    expect(rec.complianceVerdict).toBe('SAT');
    expect(rec.metadata.postcheckMode).toBe('state');
  });

  it('our policy exists but was disabled: found by name, exists-path NOT_SAT, never a second policy', async () => {
    const sub = asSub(LEGACY);
    const off = JSON.stringify({ ...clone(CREATED), state: 'disabled' }, null, 4);
    const t = fakeSession(off, off);
    const adapter = new PowerShellAdapter(makeConfig(), t.manager as any, ctx(), undefined, 'w5c2-off');
    const r = await adapter.execute(task('t-legacy-off', [sub], ['AC.L2-3.1.12', 'IA.L2-3.5.10']), { breakGlassUserId: 'user-5' }, false);
    expect(r.success).toBe(false);
    expect(t.received.some(c => c.startsWith('New-MgIdentityConditionalAccessPolicy'))).toBe(false);
    expect(record('w5c2-off', 't-legacy-off', sub).metadata.commandExecuted).toBe('[already exists: SET not sent]');
  });
});

// ---- translate: a synthetic Mission Plan with the run-45 directives, and the TM postchecks ----

describe('W5c2 coverage: translate (PlanTranslator with the real registry)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stamper-w5c2-cov-tr-'));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const translate = () => {
    const mp = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'synthetic-mission-plan.json'), 'utf-8'));
    const tm = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'synthetic-tenant-manifest.json'), 'utf-8'));
    const hp = mp.outputs.human_readable_mission_plan;
    const base = hp.steps.find((s: any) => s.task_type === 'configuration') ?? hp.steps[0];
    const step = (id: string, control: string, taskType: string) => ({ ...clone(base), id, title: control, task_type: taskType, control_coverage: [{ control_id: control, support_type: 'Configurable', gap_rationale: 'gap' }], depends_on: [] });
    hp.steps = [step('step_task_AC.L2-3.1.12_w5c2', 'AC.L2-3.1.12', 'configuration'), step('step_task_IA.L2-3.5.10_w5c2', 'IA.L2-3.5.10', 'assessment'), step('step_task_AC.L2-3.1.3_w5c2', 'AC.L2-3.1.3', 'policy')];
    // the run-45 directives (both S1 and muster-partial): 3.1.12 and 3.1.3 implement, 3.5.10 manual
    hp.control_directives = [
      { control_id: 'AC.L2-3.1.12', directive: 'implement', step_ids: ['task_AC.L2-3.1.12_w5c2'] },
      { control_id: 'IA.L2-3.5.10', directive: 'manual', step_ids: ['task_IA.L2-3.5.10_w5c2'] },
      { control_id: 'AC.L2-3.1.3', directive: 'implement', step_ids: ['task_AC.L2-3.1.3_w5c2'] },
    ];
    const body = tm.tenant_manifest ?? tm;
    const row = (cid: string, i: number) => ({ id: `chk_${i}_${cid}`, description: 'Examine configuration exports', method: 'config_export', expected: `${cid} verification passes`, on_fail: 'flag', presence_only: true });
    body.normative_controls.push(
      { control_id: 'IA.L2-3.5.10', required_state: 'Cryptographic Password Storage', verification: [row('IA.L2-3.5.10', 0)], evidence_artifacts: [] },
      { control_id: 'AC.L2-3.1.3', required_state: 'CUI Flow Control', verification: [row('AC.L2-3.1.3', 0)], evidence_artifacts: [] },
    );
    const tmPath = path.join(tmp, 'tm-w5c2-cov.json');
    fs.writeFileSync(tmPath, JSON.stringify(tm));
    return new PlanTranslator(registry).translate(mp, ManifestReader.fromFile(tmPath));
  };
  const subsOf = (t: ExeTask) => (t.action.args._sub_commands ?? []) as SubCommand[];

  it('the AC.L2-3.1.12 task runs named-location, then block-legacy-auth with the registry SET and state rule; it credits IA.L2-3.5.10 by objective', () => {
    const plan = translate().plan;
    const t = plan.execution_graph.find(x => subsOf(x).some(s => s.id === LEGACY))!;
    expect(t).toBeDefined();
    // DEPTH-3: controls[] = the step's own control; IA.L2-3.5.10 is credited by objective, not as a control.
    expect(t.controls).toEqual(['AC.L2-3.1.12']);
    expect(t.credits).toEqual(expect.arrayContaining([{ objective_id: 'IA.L2-3.5.10[b]', entry_id: LEGACY }]));
    const ids = subsOf(t).map(s => s.id);
    expect(ids).toEqual(['AC.L2-3.1.12.named-location', 'AC.L2-3.1.12.session-monitor', LEGACY]); // DEPTH-10.3 (P12-R2): + the monitor-only session control
    const sub = subsOf(t).find(s => s.id === LEGACY)!;
    expect(sub.set_command).toBe(byId(LEGACY).set_command);
    expect(sub.get_command).toBe(byId(LEGACY).get_command);
    expect(sub.verification).toEqual(byId(LEGACY).verification);
    expect(sub.idempotency).toBe('get-then-set');
    // DEPTH-5: the task's command is a summary of its sub-commands, the named location's SET first
    expect(t.action.command.startsWith(`AC.L2-3.1.12.named-location: ${byId('AC.L2-3.1.12.named-location').set_command}`)).toBe(true);
    expect(t.action.command).toContain(`${LEGACY}: `);
  });

  it('IA.L2-3.5.10 as a manual directive is still a manual gate; it keeps only its own entry no running task holds', () => {
    const plan = translate().plan;
    const gate = plan.execution_graph.find(x => x.id === 'manual-IA.L2-3.5.10')!;
    expect(gate.action.engine).toBe('manual_gate');
    // DEPTH-4: the gate keeps its non-manual-only entries; block-legacy-auth runs once, in the AC.L2-3.1.12 task (DEPTH-3).
    expect(subsOf(gate).map(s => s.id)).toEqual(['manual-IA.L2-3.5.10', 'IA.L2-3.5.10.cert-auth', 'IA.L2-3.5.10.credential-guard']); // DEPTH-10.2 (P12-R1): + Credential Guard
    expect(plan.execution_graph.filter(x => subsOf(x).some(s => s.id === LEGACY))).toHaveLength(1);
  });

  it('the AC.L2-3.1.3 task runs the label and label-policy SETs after its evidence entries; its command is unchanged', () => {
    const plan = translate().plan;
    const t = plan.execution_graph.find(x => subsOf(x).some(s => s.id === 'AC.L2-3.1.3.sensitivity-label'))!;
    const ids = subsOf(t).map(s => s.id);
    expect(ids).toEqual(expect.arrayContaining(['AC.L2-3.1.3.sensitivity-label', 'AC.L2-3.1.3.dlp-policy', CUI_LABEL, LABEL_POLICY]));
    const label = subsOf(t).find(s => s.id === CUI_LABEL)!;
    expect(label.set_command).toContain('-ApplyContentMarkingHeaderEnabled $true');
    expect(label.idempotency).toBe('get-then-set');
    expect(subsOf(t).find(s => s.id === LABEL_POLICY)!.set_command).toBe("New-LabelPolicy -Name 'CMMC-CUI-Policy' -Labels 'CUI' -ExchangeLocation All");
    expect(ids.indexOf('AC.L2-3.1.3.sensitivity-label')).toBeLessThan(ids.indexOf(CUI_LABEL));
    expect(t.action.engine).toBe('ipps');
  });

  it('postchecks: the TM rows for both controls are config_export checks carrying their control', () => {
    const plan = translate().plan as any;
    const checks = (plan.postchecks ?? []) as Check[];
    for (const cid of ['IA.L2-3.5.10', 'AC.L2-3.1.3']) {
      expect(checks.filter(c => c.control_id === cid && c.method === 'config_export').length).toBeGreaterThan(0);
    }
  });

  it('postcheck run: with the legacy-auth record in the run, the IA.L2-3.5.10 row is decided by state (basis registry), not presence', async () => {
    const records = [{ entryId: LEGACY, controlIds: ['IA.L2-3.5.10', 'AC.L2-3.1.12'], postcheckMode: 'state' as const, verdict: 'SAT', statePassed: true, stateOutput: JSON.stringify(S1_SEED) }];
    const runner = new PostcheckRunner({} as any, { getPlanEvidence: () => [{}] } as any, undefined, () => records);
    const chk: Check = { id: 'post-IA.L2-3.5.10', description: 'd', method: 'config_export', expected: 'x passes', on_fail: 'flag', control_id: 'IA.L2-3.5.10' };
    expect(await runner.runCheck(chk, 'p', false)).toMatchObject({ passed: true, mode: 'state', basis: 'registry' });
    const none = new PostcheckRunner({} as any, { getPlanEvidence: () => [{}] } as any, undefined, () => []);
    expect(await none.runCheck(chk, 'p', false)).toMatchObject({ mode: 'presence' });
  });
});
