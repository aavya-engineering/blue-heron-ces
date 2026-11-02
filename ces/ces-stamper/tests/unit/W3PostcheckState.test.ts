// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// synthetic-customer W3 (Stamper slice): postchecks assert state.
// - every SET-path registry entry declares a postcheck mode; each state entry passes on the expected
//   state (a simulator read) and fails when any asserted value is wrong (one negative per assertion);
// - the two false "exists" detections (F-3 empty envelope, F-4 startsWith user lookup);
// - creation entries are verified on the exists path; records carry metadata.postcheckMode;
// - manual gates are never SAT without an action; renderables rest on a policy reference;
// - config_export compares the TM row's expected_value (pass / fail / not assessed).
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { PowerShellAdapter, isEmptyReadResult } from '../../src/adapters/PowerShellAdapter';
import { ManualGateAdapter } from '../../src/adapters/ManualGateAdapter';
import { StamperConfig } from '../../src/config/StamperConfig';
import { ExecutionContext } from '../../src/core/ExecutionContext';
import { OutputVerificationEngine } from '../../src/core/OutputVerificationEngine';
import { PostcheckRunner, evaluateExpectedValue, selectPath } from '../../src/core/PostcheckRunner';
import { TaskRunner } from '../../src/core/TaskRunner';
import { ExecutionResultsCollector } from '../../src/core/ExecutionResultsCollector';
import { recordTaskStatuses } from '../../src/core/ExecutionResultsPublisher';
import { resolvePolicyRef, MANUAL_GATE_FILE, POLICY_REFERENCE_FILE } from '../../src/core/GateEvidence';
import { evidenceDirForTenant, evidenceFileForEntry, taskEvidencePath, tenantPlansDir } from '../../src/core/EvidenceReadinessAnalyzer';
import { CommandRegistry } from '../../src/registry/CommandRegistry';
import { ManifestReader } from '../../src/translators/ManifestReader';
import { postcheckModeOf } from '../../src/utils/structuredEvidence';
import type { Check, ExeTask, SubCommand, VerificationCriteria } from '../../src/types/schema.types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = path.resolve(__dirname, '../../src/registry/cmmc-l2-commands.registry.json');
const FIXTURE = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../fixtures/w3-state-reads.json'), 'utf-8')) as { vars: Record<string, string>; reads: Record<string, string> };
const registry = CommandRegistry.load(REGISTRY_PATH);
const setPath = registry.allEntries.filter(e => e.idempotency !== 'evidence-only' && (e.set_command ?? '').trim() !== '');
// PH9-SIM: group-create asserts SecurityEnabled (every simulator seed group carries it since W5 cycle 1).
const PRESENCE = ['AU.L2-3.3.6.audit-reduction'];

// Evidence and plan files go to a temporary pipeline root, never a live one.
const PIPELINE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'stamper-w3-'));
const savedRoot = process.env.CES_PIPELINE_ROOT;
beforeAll(() => { process.env.CES_PIPELINE_ROOT = PIPELINE_ROOT; });
afterAll(() => {
  if (savedRoot === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = savedRoot;
  fs.rmSync(PIPELINE_ROOT, { recursive: true, force: true });
});

const resolveVars = (v: unknown, vars: Record<string, string>): any =>
  JSON.parse(JSON.stringify(v).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)));

function verify(criteria: VerificationCriteria | undefined, read: string): boolean {
  return new OutputVerificationEngine().verify({ stdout: '', stderr: '', exitCode: 0 }, { stdout: read, exitCode: 0 }, resolveVars(criteria, FIXTURE.vars), { stateChanged: true }).passed;
}

/** Replace the value a dot path reaches (case-insensitive keys, one-element arrays unwrapped) with a wrong one. */
function mutateAt(read: string, jsonpath: string, toEmpty = false): string {
  const doc = JSON.parse(read);
  const parts = jsonpath.replace(/^\$\./, '').split('.');
  let node: any = doc;
  for (let i = 0; i < parts.length; i++) {
    if (Array.isArray(node)) node = node[0];
    const key = Object.keys(node).find(k => k.toLowerCase() === parts[i].toLowerCase())!;
    if (i === parts.length - 1) {
      const v = node[key];
      node[key] = typeof v === 'boolean' ? !v : typeof v === 'number' ? v + 1000 : Array.isArray(v) ? ['wrong-value'] : v === '' ? 'wrong-value' : '';
      if (typeof v === 'string' && v !== '') node[key] = toEmpty ? '' : 'wrong-value';
    } else node = node[key];
  }
  return JSON.stringify(doc, null, 4);
}

/** W5c3 part 2: the same read with the array at a dot path emptied (a min_items rule's negative). */
function emptyArrayAt(read: string, jsonpath: string): string {
  const doc = JSON.parse(read);
  const parts = jsonpath.replace(/^\$\./, '').split('.');
  let node: any = doc;
  for (let i = 0; i < parts.length - 1; i++) node = node[Object.keys(node).find(k => k.toLowerCase() === parts[i].toLowerCase())!];
  node[Object.keys(node).find(k => k.toLowerCase() === parts[parts.length - 1].toLowerCase())!] = [];
  return JSON.stringify(doc, null, 4);
}

/** Negatives for rules that read the raw text (no jsonpath). */
const RAW_NEGATIVES: Record<string, Array<[RegExp, string]>> = {
  'AC.L2-3.1.20.spo-sharing': [[/disabled/, 'externalUserSharingOnly']],
  'AU.L2-3.3.1.org-customization': [[/false/i, 'true']],
  'CM.L2-3.4.2.asr-rules': [[/blockcontent_block"/, 'blockcontent_audit"'], [/blockofficechildprocess_block"/, 'blockofficechildprocess_audit"'], [/blockcredentialstealing_block"/, 'blockcredentialstealing_off"'], [/blockuntrustedusb_block"/, 'blockuntrustedusb_audit"']],
  'SC.L1-3.13.1.endpoint-firewall': [[/domainprofile_enablefirewall_true"/, 'domainprofile_enablefirewall_false"'], [/publicprofile_defaultinboundaction_block"/, 'publicprofile_defaultinboundaction_allow"'], [/privateprofile_enablefirewall_true"/, 'privateprofile_enablefirewall_false"']],
  'SC.L2-3.13.15.dkim': [[/"Enabled":\s*true/, '"Enabled": false']],
  'SI.L1-3.14.5.scan-schedule-evidence': [[/"defenderScanType":\s*"full"/, '"defenderScanType": "quick"'], [/"defenderCloudBlockLevel":\s*"high"/, '"defenderCloudBlockLevel": "notConfigured"'], [/"defenderSignatureUpdateIntervalInHours":\s*4/, '"defenderSignatureUpdateIntervalInHours": 24']],
};

describe('W3 registry: every SET-path entry declares its postcheck mode', () => {
  it('98 SET-path entries: 97 state, 1 presence with a reason (PH-12 merge + 32: P12-R1 + 9 (8 new + IA.L2-3.5.7.password-protection re-aimed to a SET), P12-R2 + 6 (5 new + AC.L2-3.1.8.smart-lockout re-aimed), P12-R3 + 4, P12-R4 + 5, P12-R5 + 8; PH9-SIM: group-create is state; W5c2: + IA.L2-3.5.10.block-legacy-auth; W5c3 follow-up: RA.L2-3.11.3.vuln-remediation is verify-only; run 50: + CM.L2-3.4.1.compliance-policy-windows; W5c5: + SC.L2-3.13.10.key-vault; W5c7: + AC.L1-3.1.1.ca-mfa-compliant-device, AU.L2-3.3.7.time-sync)', () => {
    expect(setPath).toHaveLength(98);
    expect(setPath.filter(e => !e.verification?.postcheck_mode)).toEqual([]);
    expect(setPath.filter(e => e.verification?.postcheck_mode === 'presence').map(e => e.entry_id).sort()).toEqual(PRESENCE);
    for (const e of setPath.filter(x => x.verification?.postcheck_mode === 'presence')) expect(e.verification?.presence_reason).toBeTruthy();
  });

  it('a state entry asserts more than its object name', () => {
    const NAME = /^\$\.(displayname|name|id)$/i;
    for (const e of setPath.filter(x => x.verification?.postcheck_mode === 'state')) {
      const ev = e.verification?.evidence ?? {};
      const nonName = (ev.checks ?? []).some(c => !NAME.test(c.jsonpath))
        || (ev.jsonpath !== undefined && !NAME.test(ev.jsonpath))
        || (ev.jsonpath === undefined && (ev.regex !== undefined || ev.equals !== undefined))
        || (e.entry_id === 'AC.L2-3.1.1.member-add'); // membership: the member id IS the state
      expect([e.entry_id, nonName]).toEqual([e.entry_id, true]);
    }
  });

  it('F-4: the admin-account lookup filters the exact display name, never startsWith', () => {
    const e = registry.allEntries.find(x => x.entry_id === 'AC.L2-3.1.6.admin-account')!;
    for (const cmd of [e.get_command, ...e.evidence_commands]) expect(cmd).not.toMatch(/startsWith/);
    for (const cmd of e.evidence_commands) {
      expect(cmd).toContain("displayName eq ''Admin-{adminUserName}''");
      expect(cmd).toContain("$_.DisplayName -eq 'Admin-{adminUserName}'");
    }
    // W5c5: the GET is the lookup (CES's account by exact name, or a dedicated privileged account)
    expect(e.get_command).toContain("($_.displayName -eq 'Admin-{adminUserName}')");
  });

  it('false-exists GETs read the object itself (ios-mam by name; bitlocker the policy, not the devices; update rings by name)', () => {
    const get = (id: string) => registry.allEntries.find(x => x.entry_id === id)!.get_command;
    expect(get('AC.L2-3.1.19.ios-mam')).toContain(".value | Where-Object displayName -eq 'CMMC-iOS-MAM'");
    // W5c3 part 2: the lookup GETs keep the name clause (CES's own object) beside the effect clause
    expect(get('MP.L2-3.8.6.bitlocker')).toContain("$_.displayName -eq 'CMMC-BitLocker-Policy'");
    expect(get('MP.L2-3.8.6.bitlocker')).not.toContain('managedDevices');
    expect(get('MA.L2-3.7.1.update-ring')).toContain("$_.displayName -eq 'CMMC-UpdateRing-Standard'");
    expect(get('RA.L2-3.11.3.vuln-remediation')).toContain("$_.displayName -eq 'CMMC-UpdateRing-Standard'"); // W5c3 follow-up: one merged ring
  });
});

describe('W3 registry: positive and negative per converted SET-path entry', () => {
  const stateEntries = setPath.filter(e => e.verification?.postcheck_mode === 'state');
  it('every state entry has a fixture read', () => {
    expect(stateEntries.filter(e => !FIXTURE.reads[e.entry_id]).map(e => e.entry_id)).toEqual([]);
  });

  for (const e of stateEntries) {
    describe(e.entry_id, () => {
      const read = FIXTURE.reads[e.entry_id];
      it('passes on the expected state', () => {
        expect(verify(e.verification, read)).toBe(true);
      });
      const ev = e.verification?.evidence ?? {};
      const paths = [...(ev.checks ?? []).map(c => c.jsonpath), ...(ev.jsonpath ? [ev.jsonpath] : [])];
      // a not-empty assertion (regex S) is broken by an empty value
      const notEmpty = new Set((ev.checks ?? []).filter(c => c.regex === '\\S').map(c => c.jsonpath));
      // W5c3 part 2: a min_items rule (the assignments) is broken by an empty array
      const minItems = new Set((ev.checks ?? []).filter(c => c.min_items !== undefined).map(c => c.jsonpath));
      for (const p of paths) {
        it(`fails when ${p} is wrong`, () => {
          expect(verify(e.verification, minItems.has(p) ? emptyArrayAt(read, p) : mutateAt(read, p, notEmpty.has(p)))).toBe(false);
        });
      }
      for (const [re, wrong] of RAW_NEGATIVES[e.entry_id] ?? []) {
        it(`fails when the read has ${wrong}`, () => {
          const bad = read.replace(re, wrong);
          expect(bad).not.toBe(read);
          expect(verify(e.verification, bad)).toBe(false);
        });
      }
      it('has at least one negative', () => {
        expect(paths.length + (RAW_NEGATIVES[e.entry_id] ?? []).length).toBeGreaterThan(0);
      });
    });
  }
});

// ---- adapter paths (fake session) ----

/** live = a config whose dryRun is false (the TaskRunner reads it); the cert check is skipped by building it dry. */
function makeConfig(live = false): StamperConfig {
  const cfg = StamperConfig.fromTenantConfig({
    tenantId: 'test-tenant', appId: 'test-app', certThumbprint: 'test-thumbprint',
    certPath: '/path/to/cert', targetTenantDomain: 'test.onmicrosoft.us', clientName: 'Test Client',
  });
  if (live) Object.defineProperty(cfg, 'dryRun', { get: () => false });
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

function task(id: string, subs: SubCommand[], controls: string[], engine = 'mgraph', args: Record<string, unknown> = {}): ExeTask {
  return {
    id, type: 'configuration', priority: 'p1', depends_on: [],
    action: { engine, command: 'placeholder', args: { _sub_commands: subs, ...args } },
    inputs: [], outputs: [], controls, idempotency: 'safe', rollback: { strategy: 'none' },
  } as ExeTask;
}

/** A session answering GETs that match `getMatch` with `before` until a SET matching `setMatch` runs, then `after`. */
function fakeSession(getMatch: RegExp, setMatch: RegExp, before: string, after: string) {
  const received: string[] = [];
  let set = false;
  return {
    received,
    manager: {
      execute: async (_t: string, command: string) => {
        received.push(command);
        if (setMatch.test(command)) { set = true; return { stdout: '{"id":"created"}', stderr: '', exitCode: 0 }; }
        if (getMatch.test(command)) return { stdout: set ? after : before, stderr: '', exitCode: 0 };
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    },
  };
}

/** W5c3 part 2: Intune SETs assign the CUI group, captured in a run by AC.L2-3.1.1.group-create. */
function cuiCtx(): ExecutionContext {
  const ctx = new ExecutionContext(false);
  ctx.registerCaptures({ cuiGroupId: 'group-1' });
  return ctx;
}

function adminCtx(): ExecutionContext {
  const ctx = new ExecutionContext(false);
  // W5c7: the admin-account users read tests the stated naming convention ('(?!)' = none stated)
  ctx.loadManifestVariables({ adminUserName: 'sim.admin', tenantName: 's1-mach.simtenant.onmicrosoft.us', initialPassword: 'Synthetic-Only-1!', adminNamingPattern: '(?!)' });
  return ctx;
}

function record(tenant: string, taskId: string, sub: SubCommand): any {
  const evidFile = evidenceFileForEntry(sub.id, sub.label).replace(/\.txt$/, '.json');
  return JSON.parse(fs.readFileSync(taskEvidencePath(evidenceDirForTenant(tenant), taskId, evidFile), 'utf-8'));
}

describe('W3 adapter: false exists detections and the exists-path verification', () => {
  const realSetTimeout = global.setTimeout;
  beforeEach(() => {
    (global as any).setTimeout = (fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) =>
      realSetTimeout(fn, ms !== undefined && ms >= 5000 ? 0 : ms, ...args);
  });
  afterEach(() => { (global as any).setTimeout = realSetTimeout; });

  it('F-3: an empty read or an empty collection envelope is absent', () => {
    for (const s of ['', '  ', 'null', '""', '[]', '{}', '{"value": []}', '{\r\n  "value": [ ]\r\n}', '{"@odata.context":"x","value":[]}']) expect([s, isEmptyReadResult(s)]).toEqual([s, true]);
    for (const s of ['{"value":[{"id":"1"}]}', '{"id":"1"}', 'false', '"disabled"', '[{"a":1}]', 'some text']) expect([s, isEmptyReadResult(s)]).toEqual([s, false]);
  });

  it('F-3: ios-mam whose GET answers {"value": []} is created, not skipped as existing', async () => {
    const sub = asSub('AC.L2-3.1.19.ios-mam');
    const t = fakeSession(/iosManagedAppProtections(\?\$expand=assignments)?'\)?\.value|iosManagedAppProtections' \|/, /-Method POST/, '{"value": []}', FIXTURE.reads['AC.L2-3.1.19.ios-mam']);
    const adapter = new PowerShellAdapter(makeConfig(), t.manager as any, cuiCtx(), undefined, 'w3-ios');
    const r = await adapter.execute(task('t-ios', [sub], ['AC.L2-3.1.19']), {}, false);
    expect(t.received.some(c => /-Method POST/.test(c))).toBe(true);
    expect(r.success).toBe(true);
    const rec = record('w3-ios', 't-ios', sub);
    expect(rec.complianceVerdict).toBe('SAT');
    expect(rec.metadata.postcheckMode).toBe('state');
  });

  it('F-4: with the exact lookup, a tenant whose only users are not Admin-* gets the account created and verified', async () => {
    const sub = asSub('AC.L2-3.1.6.admin-account');
    const admin = FIXTURE.reads['AC.L2-3.1.6.admin-account'];
    const t = fakeSession(/^\$roles = @\(/, /^New-MgUser/, '', admin);
    const adapter = new PowerShellAdapter(makeConfig(), t.manager as any, adminCtx(), undefined, 'w3-admin');
    // SP-1 (R1): a secret-class variable is only taken by reference; the overlay supplies it at the spawn boundary.
    adapter.setSecretOverlay({ initialPassword: 'Synthetic-Only-1!' });
    const r = await adapter.execute(task('t-admin', [sub], ['AC.L2-3.1.6']), { adminUserName: 'sim.admin', tenantName: 'x', initialPassword: 'p' }, false);
    expect(t.received.some(c => c.startsWith('New-MgUser'))).toBe(true);
    expect(r.success).toBe(true);
    expect(record('w3-admin', 't-admin', sub).metadata.postcheckMode).toBe('state');
  });

  it('F-4 negative: a re-read that returns some other user (the old startsWith behaviour) is NOT_SAT', async () => {
    const sub = asSub('AC.L2-3.1.6.admin-account');
    const other = JSON.stringify({ id: 'user-1', displayName: 'Sim User 1', accountEnabled: true });
    const t = fakeSession(/^\$roles = @\(/, /^New-MgUser/, '', other);
    const adapter = new PowerShellAdapter(makeConfig(), t.manager as any, adminCtx(), undefined, 'w3-admin-neg');
    const r = await adapter.execute(task('t-admin-neg', [sub], ['AC.L2-3.1.6']), { adminUserName: 'sim.admin', tenantName: 'x', initialPassword: 'p' }, false);
    expect(r.success).toBe(false);
  });

  it('exists path: a creation entry found with the expected state is a verified SAT (state), SET not sent', async () => {
    const sub = asSub('AC.L2-3.1.10.screen-lock');
    const good = FIXTURE.reads['AC.L2-3.1.10.screen-lock'];
    const t = fakeSession(/deviceConfigurations\?\$expand=assignments'\)\.value/, /-Method POST/, good, good);
    const adapter = new PowerShellAdapter(makeConfig(), t.manager as any, cuiCtx(), undefined, 'w3-exists');
    const r = await adapter.execute(task('t-exists', [sub], ['AC.L2-3.1.10']), {}, false);
    expect(r.success).toBe(true);
    expect(t.received.some(c => /-Method POST/.test(c))).toBe(false);
    const rec = record('w3-exists', 't-exists', sub);
    expect(rec.complianceVerdict).toBe('SAT');
    expect(rec.metadata.postcheckMode).toBe('state');
    expect(rec.verificationResult.details.evidence_check).toBe(true);
  });

  it('exists path: a creation entry found in the wrong state fails (no unverified skip)', async () => {
    const sub = asSub('AC.L2-3.1.10.screen-lock');
    const wrong = mutateAt(FIXTURE.reads['AC.L2-3.1.10.screen-lock'], '$.passwordMinutesOfInactivityBeforeScreenTimeout');
    const t = fakeSession(/deviceConfigurations\?\$expand=assignments'\)\.value/, /-Method POST/, wrong, wrong);
    const adapter = new PowerShellAdapter(makeConfig(), t.manager as any, cuiCtx(), undefined, 'w3-exists-neg');
    const r = await adapter.execute(task('t-exists-neg', [sub], ['AC.L2-3.1.10']), {}, false);
    expect(r.success).toBe(false);
    const rec = record('w3-exists-neg', 't-exists-neg', sub);
    expect(rec.complianceVerdict).toBe('NOT_SAT');
    expect(rec.metadata.postcheckMode).toBe('state');
    expect(rec.metadata.commandExecuted).toBe('[already exists: SET not sent]');
  });

  it('postcheckModeOf: state only when a state assertion was evaluated', () => {
    const stateSub = asSub('AC.L2-3.1.10.screen-lock');
    const evaluated = { passed: true, confidence: 'HIGH', score: 100, reason: '', details: { exit_code_check: true, set_output_check: null, evidence_check: true } } as any;
    const notEvaluated = { ...evaluated, details: { ...evaluated.details, evidence_check: null } };
    expect(postcheckModeOf(stateSub, evaluated)).toEqual({ postcheckMode: 'state' });
    expect(postcheckModeOf(stateSub, notEvaluated)?.postcheckMode).toBe('presence');
    expect(postcheckModeOf(stateSub, undefined)?.postcheckMode).toBe('presence');
    expect(postcheckModeOf(asSub('AU.L2-3.3.6.audit-reduction'), evaluated)?.postcheckMode).toBe('presence');
    expect(postcheckModeOf(asSub('AC.L2-3.1.1.operator-discover'), evaluated)).toBeUndefined(); // evidence-only: no mode
  });
});

describe('W3 gates and renderables', () => {
  const stubCollector = { collectTaskEvidence: async () => [], getPlanEvidence: () => [] } as any;
  const manualTask = (id: string, control: string, args: Record<string, unknown> = {}) =>
    task(id, [{ id, label: 'Manual gate', set_command: '', get_command: '', engine: 'manual_gate', sequence_hint: 0, idempotency: 'safe', variables_required: [], variables_runtime: [], on_failure: 'warn_continue', evidence_commands: [] } as SubCommand], [control], 'manual_gate', { _directive: 'manual', ...args });

  it('a headless manual gate records no action and its owner role; never approved', async () => {
    const r = await new ManualGateAdapter().execute(manualTask('manual-PE.L1-3.10.1', 'PE.L1-3.10.1', { _owner_role: 'compliance_engineer' }), {}, false);
    expect(r.success).toBe(true);
    expect(r.output).toMatchObject({ gate: 'manual', ownerRole: 'compliance_engineer', gateAction: 'none', approved: false });
  });

  it('TaskRunner writes the manual-gate record: PROVISIONAL, gate manual, owner role, action none', async () => {
    const runner = new TaskRunner(makeConfig(true), stubCollector, undefined, undefined, undefined, undefined, 'w3-gates');
    const t = manualTask('manual-AT.L2-3.2.1', 'AT.L2-3.2.1', { _owner_role: 'compliance_engineer' });
    const { result } = await runner.executeTask(t, 'plan-w3', {});
    expect(result.success).toBe(true);
    const rec = JSON.parse(fs.readFileSync(taskEvidencePath(evidenceDirForTenant('w3-gates'), t.id, MANUAL_GATE_FILE), 'utf-8'));
    expect(rec.complianceVerdict).toBe('PROVISIONAL');
    expect(rec.metadata).toMatchObject({ gate: 'manual', ownerRole: 'compliance_engineer', gateAction: 'none' });
    // not in the evidence directory EO reads
    expect(fs.existsSync(path.join(evidenceDirForTenant('w3-gates'), MANUAL_GATE_FILE))).toBe(false);
  });

  it('a gate without an owner role in the plan records "unassigned"', async () => {
    const runner = new TaskRunner(makeConfig(true), stubCollector, undefined, undefined, undefined, undefined, 'w3-gates');
    const t = manualTask('manual-MA.L2-3.7.2', 'MA.L2-3.7.2');
    await runner.executeTask(t, 'plan-w3', {});
    const rec = JSON.parse(fs.readFileSync(taskEvidencePath(evidenceDirForTenant('w3-gates'), t.id, MANUAL_GATE_FILE), 'utf-8'));
    expect(rec.metadata.ownerRole).toBe('unassigned');
  });

  it('results manifest: a pending gate is PROVISIONAL, an approved one SAT, a failure NOT_SAT', () => {
    const collector = new ExecutionResultsCollector();
    const tasks = [{ id: 'g1', controls: ['AT.L2-3.2.1'] }, { id: 'g2', controls: ['PS.L2-3.9.1'] }, { id: 'a1', controls: ['AC.L1-3.1.1'] }, { id: 'f1', controls: ['AC.L2-3.1.5'] }];
    const status: Record<string, any> = { g1: 'completed', g2: 'completed', a1: 'completed', f1: 'failed' };
    recordTaskStatuses(collector, tasks, id => status[id], { 'AT.L2-3.2.1': 'manual', 'PS.L2-3.9.1': 'manual' }, id => id === 'g1');
    const m = collector.buildManifest('run', 'w3', 'plan');
    const by = Object.fromEntries(m.results.map(r => [r.controlId, `${r.verdict}/${r.outcome}`]));
    expect(by).toEqual({ 'AT.L2-3.2.1': 'provisional/manual_gate_pending', 'PS.L2-3.9.1': 'sat/completed', 'AC.L1-3.1.1': 'sat/completed', 'AC.L2-3.1.5': 'not_sat/failed' });
  });

  const writeManifest = (slug: string, docs: Array<{ name: string; sha256?: string }>) => {
    const dir = tenantPlansDir(slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `policy-set-manifest-${slug}-2026-10-28T00-00-00-000Z.json`), JSON.stringify({
      artifact_id: 'policy-set-manifest-x', hash_sha256: 'a'.repeat(64), artifact: { documents: docs },
    }));
  };
  const H = (c: string) => c.repeat(64);

  it('resolvePolicyRef: control override, family map, missing document, missing manifest', () => {
    writeManifest('w3-pol', [{ name: 'policies/system-security-plan.md', sha256: H('1') }, { name: 'policies/audit-accountability-policy.md', sha256: H('2') }]);
    const plans = tenantPlansDir('w3-pol');
    expect(resolvePolicyRef('CA.L2-3.12.4', plans).ref).toMatchObject({ document: 'policies/system-security-plan.md', sha256: H('1'), manifestSha256: 'a'.repeat(64) });
    expect(resolvePolicyRef('AU.L2-3.3.6', plans).ref?.document).toBe('policies/audit-accountability-policy.md');
    expect(resolvePolicyRef('RA.L2-3.11.2', plans).reason).toContain('lists no policies/risk-assessment-policy.md');
    expect(resolvePolicyRef('AU.L2-3.3.6', tenantPlansDir('w3-no-manifest')).reason).toContain('no policy-set manifest');
  });

  it('a manual_gate renderable is a policy reference: SAT with metadata.policyRef, no gate', async () => {
    writeManifest('w3-rend', [{ name: 'policies/system-security-plan.md', sha256: H('3') }]);
    const runner = new TaskRunner(makeConfig(true), stubCollector, undefined, undefined, undefined, undefined, 'w3-rend');
    const t = manualTask('renderable-CA.L2-3.12.4', 'CA.L2-3.12.4');
    t.action.args._directive = 'document-renderable';
    const { result } = await runner.executeTask(t, 'plan-w3', {});
    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({ policyRef: { document: 'policies/system-security-plan.md', sha256: H('3') } });
    const rec = JSON.parse(fs.readFileSync(taskEvidencePath(evidenceDirForTenant('w3-rend'), t.id, POLICY_REFERENCE_FILE), 'utf-8'));
    expect(rec.complianceVerdict).toBe('SAT');
    expect(rec.metadata.policyRef.sha256).toBe(H('3'));
    expect(fs.existsSync(taskEvidencePath(evidenceDirForTenant('w3-rend'), t.id, MANUAL_GATE_FILE))).toBe(false);
  });

  it('a renderable without its rendered document fails: NOT_SAT, never a pass with no action', async () => {
    writeManifest('w3-rend-neg', [{ name: 'policies/access-control-policy.md', sha256: H('4') }]);
    const runner = new TaskRunner(makeConfig(true), stubCollector, undefined, undefined, undefined, undefined, 'w3-rend-neg');
    const t = manualTask('renderable-CM.L2-3.4.4', 'CM.L2-3.4.4');
    t.action.args._directive = 'document-renderable';
    const { result } = await runner.executeTask(t, 'plan-w3', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('configuration-management-policy.md');
    const rec = JSON.parse(fs.readFileSync(taskEvidencePath(evidenceDirForTenant('w3-rend-neg'), t.id, POLICY_REFERENCE_FILE), 'utf-8'));
    expect(rec.complianceVerdict).toBe('NOT_SAT');
    expect(rec.metadata.policyRef).toBeUndefined();
  });
});

describe('W3 config_export postchecks compare the TM expected_value', () => {
  const ssid = JSON.stringify({ displayName: 'CMMC-WiFi-Secure', ssid: 'S1-MACH-CORP', wifiSecurityType: 'wpa2Enterprise' });
  const records = [
    { entryId: 'AC.L2-3.1.16.wifi-profile', controlIds: ['AC.L2-3.1.16'], postcheckMode: 'state' as const, verdict: 'SAT', statePassed: true, stateOutput: ssid },
    { entryId: 'AC.L2-3.1.10.screen-lock', controlIds: ['AC.L2-3.1.10'], postcheckMode: 'state' as const, verdict: 'SAT', statePassed: true, stateOutput: JSON.stringify({ passwordMinutesOfInactivityBeforeScreenTimeout: 15 }) },
    { entryId: 'AC.L2-3.1.5.pim-eligible', controlIds: ['AC.L2-3.1.5'], postcheckMode: 'state' as const, verdict: 'NOT_SAT', statePassed: false, stateOutput: '{}' },
  ];
  const runner = () => new PostcheckRunner({} as any, { getPlanEvidence: () => [{}] } as any, undefined, () => records);
  const chk = (control: string, ev?: Check['expected_value']): Check => ({ id: `post-${control}`, description: 'd', method: 'config_export', expected: 'x passes', on_fail: 'flag', control_id: control, ...(ev ? { expected_value: ev } : {}) });

  it('pass: the read holds the expected value', async () => {
    const r = await runner().runCheck(chk('AC.L2-3.1.16', { path: '$.ssid', op: 'equals', value: 'S1-MACH-CORP', source: 'answered' }), 'p', false);
    expect(r).toMatchObject({ passed: true, mode: 'state', basis: 'tm', outcome: 'pass', entry_id: 'AC.L2-3.1.16.wifi-profile' });
  });

  it('fail: the path is present with another value (screen lock 15 > the answered 10)', async () => {
    const r = await runner().runCheck(chk('AC.L2-3.1.10', { path: '$.passwordMinutesOfInactivityBeforeScreenTimeout', op: 'lte', value: 10 }), 'p', false);
    expect(r).toMatchObject({ passed: false, mode: 'state', outcome: 'fail' });
  });

  it('not assessed: the path is not in the read; the missing path is recorded; never a pass', async () => {
    const r = await runner().runCheck(chk('AC.L2-3.1.16', { path: '$.passwordExpirationDays', op: 'lte', value: 60 }), 'p', false);
    expect(r).toMatchObject({ passed: false, mode: 'state', outcome: 'not_assessed', missing_path: '$.passwordExpirationDays' });
  });

  it('not assessed: no read for the control in this run', async () => {
    const r = await runner().runCheck(chk('IA.L2-3.5.7', { path: '$.passwordMinimumLength', op: 'gte', value: 14 }), 'p', false);
    expect(r).toMatchObject({ passed: false, outcome: 'not_assessed' });
  });

  it('no expected_value: the registry state assertions decide (basis registry), else presence-only', async () => {
    expect(await runner().runCheck(chk('AC.L2-3.1.16'), 'p', false)).toMatchObject({ passed: true, mode: 'state', basis: 'registry' });
    expect(await runner().runCheck(chk('AC.L2-3.1.5'), 'p', false)).toMatchObject({ passed: false, mode: 'state', basis: 'registry', outcome: 'fail' });
    // DEPTH-8: presence counts only this control's evidence; the plan's one untagged artifact is not PE's.
    const p = await runner().runCheck(chk('PE.L1-3.10.1'), 'p', false);
    expect(p).toMatchObject({ passed: false, mode: 'presence', outcome: 'fail', evidence_control_ids: ['PE.L1-3.10.1'] });
    expect(p.actual).toContain('presence-only');
  });

  it('results are kept for the postcheck record', async () => {
    const r = runner();
    await r.runCheck(chk('AC.L2-3.1.16'), 'p', false);
    await r.runCheck({ ...chk('AC.L1-3.1.1'), method: 'manual' }, 'p', false);
    expect(r.getResults().map(x => x.mode)).toEqual(['state', 'manual']);
  });

  it('evaluateExpectedValue: filter paths, [*], contains, gte / lte on string numbers, exists, count-gte', () => {
    const lockout = JSON.stringify({ values: [{ name: 'LockoutThreshold', value: '5' }, { name: 'LockoutDurationInSeconds', value: '900' }] });
    expect(evaluateExpectedValue(lockout, { path: "$.values[?(@.name=='LockoutThreshold')].value", op: 'lte', value: 5 })).toMatchObject({ found: true, passed: true });
    expect(evaluateExpectedValue(lockout, { path: "$.values[?(@.name=='LockoutDurationInSeconds')].value", op: 'gte', value: 1800 })).toMatchObject({ found: true, passed: false });
    const ca = JSON.stringify({ conditions: { users: { excludeUsers: ['user-50', 'user-9'] } }, ipRanges: [{ cidrAddress: '198.51.100.0/24' }] });
    expect(evaluateExpectedValue(ca, { path: '$.conditions.users.excludeUsers', op: 'contains', value: 'user-50' }).passed).toBe(true);
    expect(evaluateExpectedValue(ca, { path: '$.conditions.users.excludeUsers', op: 'contains', value: 'user-51' }).passed).toBe(false);
    expect(evaluateExpectedValue(ca, { path: '$.ipRanges[*].cidrAddress', op: 'contains', value: '198.51.100.0/24' }).passed).toBe(true);
    expect(evaluateExpectedValue(ca, { path: '$.conditions.users.excludeUsers', op: 'count-gte', value: 2 }).passed).toBe(true);
    expect(evaluateExpectedValue(ca, { path: '$.conditions.users.excludeUsers', op: 'exists' }).passed).toBe(true);
    expect(evaluateExpectedValue(ca, { path: '$.conditions.users.includeUsers', op: 'exists' })).toMatchObject({ found: false, passed: false });
    expect(evaluateExpectedValue(JSON.stringify({ storageBlockRemovableStorage: true }), { path: '$.storageBlockRemovableStorage', op: 'equals', value: true }).passed).toBe(true);
    expect(selectPath([{ A: 1 }, { a: 2 }], '$.a')).toEqual([1, 2]);
  });

  it('ManifestReader carries the row control, expected_value and presence_only into the postcheck', () => {
    const reader = new ManifestReader({
      manifest_id: 'm', tech_stack_id: 1, config_intents: [], evidence_monitors: [], drift_policies: [],
      normative_controls: [{
        control_id: 'AC.L2-3.1.16', required_state: 'r', evidence_artifacts: [],
        verification: [
          { id: 'c1', description: 'd', method: 'config_export', expected: 'AC.L2-3.1.16 verification passes', on_fail: 'f', expected_value: { path: '$.ssid', op: 'equals', value: 'S1-MACH-CORP', source: 'answered' } },
          { id: 'c2', description: 'd', method: 'config_export', expected: 'AC.L2-3.1.16 verification passes', on_fail: 'f', presence_only: true },
          { id: 'c3', description: 'd', method: 'config_export', expected: 'AC.L2-3.1.16 verification passes', on_fail: 'f', expected_value: { path: '$.ssid', op: 'like' } },
        ],
      }],
    } as any);
    const [a, b, c] = reader.generatePostchecks();
    expect(a).toMatchObject({ control_id: 'AC.L2-3.1.16', expected: 'AC.L2-3.1.16 verification passes', expected_value: { path: '$.ssid', op: 'equals', value: 'S1-MACH-CORP', source: 'answered' } });
    expect(b).toMatchObject({ control_id: 'AC.L2-3.1.16', presence_only: true });
    expect(b.expected_value).toBeUndefined();
    expect(c.expected_value).toBeUndefined(); // an unknown op is not compared
  });
});
