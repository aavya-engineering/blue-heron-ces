// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// synthetic-customer W5 cycle 2: a registry SET that hard-codes a value the Tenant Manifest (TM)
// carries as a verification row's expected_value configures the organisation's value (never weaker
// than the registry default), and the entry's evidence rule asserts the configured value.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { CommandRegistry } from '../../src/registry/CommandRegistry';
import type { CommandEntry } from '../../src/registry/command-registry.types';
import { ManifestReader } from '../../src/translators/ManifestReader';
import { PlanTranslator } from '../../src/translators/PlanTranslator';
import { applyOrganisationValues, ORG_VALUE_WEAKER_NOTE } from '../../src/translators/orgValues';
import { OutputVerificationEngine } from '../../src/core/OutputVerificationEngine';
import { evaluateExpectedValue } from '../../src/core/PostcheckRunner';
import { buildStructuredEvidence } from '../../src/utils/structuredEvidence';
import { checkExistingOrgValues, existingStateCriteria } from '../../src/translators/orgValues';
import { PowerShellAdapter } from '../../src/adapters/PowerShellAdapter';
import { StamperConfig } from '../../src/config/StamperConfig';
import { ExecutionContext } from '../../src/core/ExecutionContext';
import { evidenceDirForTenant, evidenceFileForEntry, taskEvidencePath } from '../../src/core/EvidenceReadinessAnalyzer';
import type { ExeTask, OrgValueDecision, SubCommand } from '../../src/types/schema.types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = path.resolve(__dirname, '../../src/registry/cmmc-l2-commands.registry.json');
const FIXTURES = path.resolve(__dirname, '../fixtures');
const registry = CommandRegistry.load(REGISTRY_PATH);
const SCREEN_LOCK = 'AC.L2-3.1.10.screen-lock';
const PATH = '$.passwordMinutesOfInactivityBeforeScreenTimeout';
const screenLock = registry.allEntries.find(e => e.entry_id === SCREEN_LOCK)!;

type Row = { control_id: string; op: string; value: unknown; path?: string; source?: string };
const fakeManifest = (rows: Row[]) => ({
  getControl: (cid: string) => {
    const mine = rows.filter(r => r.control_id === cid);
    if (mine.length === 0) return undefined;
    return {
      control_id: cid,
      verification: mine.map((r, i) => ({
        id: `CHK-${cid}-${i}`, description: 'd', method: 'config_export', expected: 'e', on_fail: 'f',
        expected_value: { path: r.path ?? PATH, op: r.op, value: r.value, source: r.source ?? 'answered' },
      })),
    } as any;
  },
});

const engine = new OutputVerificationEngine();
// W5c3 part 2: the GET expands assignments and the rule asserts at least one (the SET assigns the CUI group).
const ASSIGNED_CHECK = { jsonpath: '$.assignments', min_items: 1 };
const readOf = (minutes: number) => JSON.stringify({
  id: 'deviceConfiguration-3', displayName: 'CMMC-ScreenLock-Policy', passwordRequired: true,
  passwordMinimumLength: 14, passwordMinutesOfInactivityBeforeScreenTimeout: minutes,
  assignments: [{ id: 'assignment-1', target: { '@odata.type': '#microsoft.graph.groupAssignmentTarget', groupId: 'group-1' } }],
});
const evidencePasses = (entry: CommandEntry, minutes: number) =>
  engine.verify({ stdout: '', stderr: '', exitCode: 0 }, { stdout: readOf(minutes), exitCode: 0 }, entry.verification).details.evidence_check;

describe('W5c2 registry org-value bindings', () => {
  it('the screen-lock entry declares its timeout binding and the registry loader keeps it', () => {
    expect(screenLock.org_value_bindings).toEqual([{ path: PATH, token: 'passwordMinutesOfInactivityBeforeScreenTimeout', op: 'lte', default: 15 }]);
  });

  it('every binding names a literal its SET carries (token=default)', () => {
    const bound = registry.allEntries.filter(e => (e.org_value_bindings ?? []).length > 0);
    // run 50: the compliance policy binds three values; W5c7: the time-sync NTP server (a string, `$timeServer='...'`)
    // DEPTH-10.3 (P12-R2): smart lockout binds the lockout threshold (path $.LockoutThreshold, tm_path the TM filter path)
    expect(bound.map(e => e.entry_id).sort()).toEqual(['AU.L2-3.3.7.time-sync', SCREEN_LOCK, 'CM.L2-3.4.1.compliance-policy-windows', 'AC.L2-3.1.8.smart-lockout'].sort());
    for (const e of bound) {
      for (const b of e.org_value_bindings!) {
        if (b.op === 'equals') { expect(e.set_command).toContain(`$${b.token}='${b.default}'`); continue; }
        expect(e.set_command).toMatch(new RegExp(`\\b${b.token}\\s*=\\s*${b.default}(?![\\w.])`));
        expect(e.idempotency).not.toBe('evidence-only');
      }
    }
  });
});

describe('W5c2 applyOrganisationValues (screen lock)', () => {
  it('TM row lte 10: the SET configures 10 and the evidence rule asserts 10', () => {
    const { entry, decisions } = applyOrganisationValues(screenLock, fakeManifest([
      { control_id: 'AC.L2-3.1.10', op: 'lte', value: 10 },
      { control_id: 'SC.L2-3.13.9', op: 'lte', value: 10 },
    ]));
    expect(entry.set_command).toContain('passwordMinutesOfInactivityBeforeScreenTimeout=10;');
    expect(entry.set_command).not.toContain('passwordMinutesOfInactivityBeforeScreenTimeout=15');
    expect(entry.set_command).toContain('passwordMinimumLength=14'); // other literals untouched
    expect(entry.verification?.evidence).toEqual({ jsonpath: PATH, equals: '10', checks: [ASSIGNED_CHECK] });
    expect(entry.verification?.postcheck_mode).toBe('state');
    expect(decisions).toEqual([{
      path: PATH, token: 'passwordMinutesOfInactivityBeforeScreenTimeout', op: 'lte',
      control_ids: ['AC.L2-3.1.10', 'SC.L2-3.13.9'], source: 'answered',
      organisation_value: 10, registry_value: 15, configured_value: 10, basis: 'organisation',
    }]);
    expect(evidencePasses(entry, 10)).toBe(true);
    expect(evidencePasses(entry, 11)).toBe(false);
    expect(evidencePasses(entry, 15)).toBe(false);
    // the TM postcheck (config_export, expected_value lte 10) passes on the configured read
    expect(evaluateExpectedValue(readOf(10), { path: PATH, op: 'lte', value: 10, source: 'answered' }).passed).toBe(true);
    // the registry is not mutated
    expect(screenLock.set_command).toContain('passwordMinutesOfInactivityBeforeScreenTimeout=15;');
    // PH-13 (LOG-PH13-REG STOP-2): the registry carries a range (min 1, max 15), not the regex.
    expect(screenLock.verification?.evidence).toMatchObject({ min: 1, max: 15 });
  });

  it('no TM row: the entry is unchanged (15, registry regex)', () => {
    const { entry, decisions } = applyOrganisationValues(screenLock, fakeManifest([]));
    expect(entry).toBe(screenLock);
    expect(decisions).toEqual([]);
    expect(entry.set_command).toContain('passwordMinutesOfInactivityBeforeScreenTimeout=15;');
    expect(evidencePasses(entry, 15)).toBe(true);
    expect(evidencePasses(entry, 16)).toBe(false);
  });

  it('weaker TM row (lte 30): keeps 15, asserts 15, and carries the note', () => {
    const { entry, decisions } = applyOrganisationValues(screenLock, fakeManifest([{ control_id: 'AC.L2-3.1.10', op: 'lte', value: 30 }]));
    expect(entry.set_command).toContain('passwordMinutesOfInactivityBeforeScreenTimeout=15;');
    expect(entry.verification?.evidence).toEqual({ jsonpath: PATH, equals: '15', checks: [ASSIGNED_CHECK] });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ organisation_value: 30, registry_value: 15, configured_value: 15, basis: 'registry', note: ORG_VALUE_WEAKER_NOTE });
    expect(ORG_VALUE_WEAKER_NOTE).toBe('organisation value weaker than CES baseline');
    expect(evidencePasses(entry, 15)).toBe(true);
    expect(evidencePasses(entry, 30)).toBe(false);
  });

  it('bank row (lte 15, the muster-partial bank value): not answered by the organisation, so nothing changes', () => {
    const { entry, decisions } = applyOrganisationValues(screenLock, fakeManifest([{ control_id: 'SC.L2-3.13.9', op: 'lte', value: 15, source: 'bank' }]));
    expect(entry).toBe(screenLock);
    expect(decisions).toEqual([]);
  });

  it('equal answered row (lte 15): configures 15 with basis organisation', () => {
    const { entry, decisions } = applyOrganisationValues(screenLock, fakeManifest([{ control_id: 'SC.L2-3.13.9', op: 'lte', value: 15, source: 'answered' }]));
    expect(entry.set_command).toContain('passwordMinutesOfInactivityBeforeScreenTimeout=15;');
    expect(decisions[0]).toMatchObject({ configured_value: 15, basis: 'organisation', source: 'answered' });
    expect(decisions[0].note).toBeUndefined();
    expect(evidencePasses(entry, 15)).toBe(true);
  });

  it('several rows: the strictest wins; a numeric string counts', () => {
    const { decisions } = applyOrganisationValues(screenLock, fakeManifest([
      { control_id: 'AC.L2-3.1.10', op: 'lte', value: '12' },
      { control_id: 'SC.L2-3.13.9', op: 'lte', value: 5 },
    ]));
    expect(decisions[0]).toMatchObject({ organisation_value: 5, configured_value: 5 });
  });

  it('rows that do not bind are ignored: other op, other path, other control, non-numeric value', () => {
    const { entry, decisions } = applyOrganisationValues(screenLock, fakeManifest([
      { control_id: 'AC.L2-3.1.10', op: 'gte', value: 10 },
      { control_id: 'AC.L2-3.1.10', op: 'lte', value: 10, path: '$.passwordMinimumLength' },
      { control_id: 'IA.L2-3.5.7', op: 'lte', value: 10 },
      { control_id: 'SC.L2-3.13.9', op: 'lte', value: 'ten' },
    ]));
    expect(entry).toBe(screenLock);
    expect(decisions).toEqual([]);
  });
});

describe('W5c2 evidence record', () => {
  const task = { id: 'step_task_AC.L2-3.1.10', controls: ['AC.L2-3.1.10'], action: { args: {} } } as unknown as ExeTask;
  const toSub = (entry: CommandEntry, decisions: any[]): SubCommand => ({
    id: entry.entry_id, label: entry.label, set_command: entry.set_command, get_command: entry.get_command,
    engine: entry.engine, sequence_hint: entry.sequence_hint, idempotency: entry.idempotency,
    variables_required: entry.variables_required, variables_runtime: entry.variables_runtime,
    on_failure: entry.on_failure, evidence_commands: entry.evidence_commands, verification: entry.verification,
    ...(decisions.length > 0 ? { org_values: decisions } : {}),
  });
  const record = (sub: SubCommand, minutes: number) => {
    const vr = engine.verify({ stdout: readOf(minutes), stderr: '', exitCode: 0 }, { stdout: readOf(minutes), exitCode: 0 }, sub.verification);
    return buildStructuredEvidence(readOf(minutes), 0, '', null, sub, task, {}, undefined, undefined,
      { postStateOutput: readOf(minutes), stateChanged: true, verificationResult: vr });
  };

  it('weaker: the record carries orgValues with the note, and the rationale says so', () => {
    const { entry, decisions } = applyOrganisationValues(screenLock, fakeManifest([{ control_id: 'AC.L2-3.1.10', op: 'lte', value: 30 }]));
    const ev = record(toSub(entry, decisions), 15);
    expect(ev.complianceVerdict).toBe('SAT');
    expect(ev.metadata.orgValues).toEqual(decisions);
    expect(ev.metadata.orgValues![0].note).toBe(ORG_VALUE_WEAKER_NOTE);
    expect(ev.verdictRationale).toContain(`${ORG_VALUE_WEAKER_NOTE}: passwordMinutesOfInactivityBeforeScreenTimeout organisation 30, configured 15`);
    expect(ev.metadata.commandExecuted).toContain('passwordMinutesOfInactivityBeforeScreenTimeout=15;');
  });

  it('organisation value applied: the record shows 10 executed; a 15 read is NOT_SAT', () => {
    const { entry, decisions } = applyOrganisationValues(screenLock, fakeManifest([{ control_id: 'AC.L2-3.1.10', op: 'lte', value: 10 }]));
    const sub = toSub(entry, decisions);
    const ok = record(sub, 10);
    expect(ok.complianceVerdict).toBe('SAT');
    expect(ok.metadata.commandExecuted).toContain('passwordMinutesOfInactivityBeforeScreenTimeout=10;');
    expect(ok.metadata.orgValues![0]).toMatchObject({ configured_value: 10, basis: 'organisation' });
    expect(ok.verdictRationale).not.toContain(ORG_VALUE_WEAKER_NOTE);
    expect(record(sub, 15).complianceVerdict).toBe('NOT_SAT');
  });

  it('no row: no orgValues on the record', () => {
    const ev = record(toSub(screenLock, []), 15);
    expect(ev.metadata.orgValues).toBeUndefined();
  });
});

describe('W5c2 translate (PlanTranslator with the real registry)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stamper-w5c2-'));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const translateWith = (rows: Row[]) => {
    const mp = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'synthetic-mission-plan.json'), 'utf-8'));
    const tm = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'synthetic-tenant-manifest.json'), 'utf-8'));
    const steps = mp.outputs.human_readable_mission_plan.steps;
    const base = steps.find((s: any) => s.task_type !== 'policy') ?? steps[0];
    steps.push({ ...JSON.parse(JSON.stringify(base)), id: 'STEP-W5C2-SCREENLOCK', title: 'Screen lock', control_coverage: [{ control_id: 'AC.L2-3.1.10', support_type: 'None', gap_rationale: 'no lock' }], depends_on: [] });
    const body = tm.tenant_manifest ?? tm;
    const ctl = fakeManifest(rows).getControl('AC.L2-3.1.10');
    if (ctl) body.normative_controls.push({ ...ctl, required_state: 'Session lock after inactivity', evidence_artifacts: [] });
    const tmPath = path.join(tmp, `tm-${rows.length}-${String(rows[0]?.value ?? 'none')}.json`);
    fs.writeFileSync(tmPath, JSON.stringify(tm));
    const result = new PlanTranslator(registry).translate(mp, ManifestReader.fromFile(tmPath));
    const task = result.plan.execution_graph.find(t => (t.action.args._sub_commands ?? []).some((s: SubCommand) => s.id === SCREEN_LOCK))!;
    expect(task).toBeDefined();
    const sub = (task.action.args._sub_commands as SubCommand[]).find(s => s.id === SCREEN_LOCK)!;
    return { task, sub };
  };

  it('10-minute row: the plan sub-command and task command carry 10; the rule asserts 10', () => {
    const { task, sub } = translateWith([{ control_id: 'AC.L2-3.1.10', op: 'lte', value: 10 }]);
    expect(sub.set_command).toContain('passwordMinutesOfInactivityBeforeScreenTimeout=10;');
    expect(sub.verification?.evidence).toEqual({ jsonpath: PATH, equals: '10', checks: [ASSIGNED_CHECK] });
    expect(sub.org_values).toEqual([expect.objectContaining({ configured_value: 10, basis: 'organisation', control_ids: ['AC.L2-3.1.10'] })]);
    expect(task.action.command).toContain('passwordMinutesOfInactivityBeforeScreenTimeout=10;');
  });

  it('no row: 15 and the registry range (PH-13, LOG-PH13-REG STOP-2: min 1, max 15; was the regex)', () => {
    const { sub } = translateWith([]);
    expect(sub.set_command).toContain('passwordMinutesOfInactivityBeforeScreenTimeout=15;');
    expect(sub.verification?.evidence).toMatchObject({ min: 1, max: 15 });
    expect(sub.verification?.evidence?.regex).toBeUndefined();
    expect(sub.org_values).toBeUndefined();
  });

  it('weaker row (30): 15 with the note', () => {
    const { sub } = translateWith([{ control_id: 'AC.L2-3.1.10', op: 'lte', value: 30 }]);
    expect(sub.set_command).toContain('passwordMinutesOfInactivityBeforeScreenTimeout=15;');
    expect(sub.verification?.evidence).toEqual({ jsonpath: PATH, equals: '15', checks: [ASSIGNED_CHECK] });
    expect(sub.org_values?.[0]).toMatchObject({ basis: 'registry', note: ORG_VALUE_WEAKER_NOTE, organisation_value: 30 });
  });
});

// synthetic-customer W5 cycle 3: on a live tenant an existing policy may already be stricter than the
// organisation's value (5 minutes when the organisation answered 10). The GET-then-SET path leaves it
// in place, so the "already exists" check accepts any value within the bound (lte: [1, configured];
// gte: >= configured) and the record states the observed value and the bound. After Stamper's own SET
// (no existing policy) the exact assertion stays, so a SET that did not take still fails.
describe('W5c3 postcheck on a stricter existing value', () => {
  const lte10 = () => applyOrganisationValues(screenLock, fakeManifest([{ control_id: 'AC.L2-3.1.10', op: 'lte', value: 10 }]));
  const verifyWith = (criteria: CommandEntry['verification'], minutes: number) =>
    engine.verify({ stdout: '', stderr: '', exitCode: 0 }, { stdout: readOf(minutes), exitCode: 0 }, criteria).details.evidence_check;

  it('existingStateCriteria (lte 10): the exact rule becomes [1, 10]; translate still emits the exact rule', () => {
    const { entry, decisions } = lte10();
    expect(entry.verification?.evidence).toEqual({ jsonpath: PATH, equals: '10', checks: [ASSIGNED_CHECK] });
    const existing = existingStateCriteria(entry.verification, decisions)!;
    expect(existing.evidence).toEqual({ jsonpath: PATH, min: 1, max: 10, checks: [ASSIGNED_CHECK] });
    expect(existing.postcheck_mode).toBe('state');
    expect(verifyWith(existing, 5)).toBe(true);
    expect(verifyWith(existing, 1)).toBe(true);
    expect(verifyWith(existing, 10)).toBe(true);
    expect(verifyWith(existing, 11)).toBe(false);
    expect(verifyWith(existing, 0)).toBe(false);
    // the exact rule itself is unchanged: 5 does not equal 10
    expect(verifyWith(entry.verification, 5)).toBe(false);
  });

  it('existingStateCriteria (gte): any value >= configured; checks[] rules are bounded too', () => {
    const d: OrgValueDecision = { path: '$.passwordMinimumLength', token: 'passwordMinimumLength', op: 'gte', control_ids: ['IA.L2-3.5.7'], organisation_value: 16, registry_value: 14, configured_value: 16, basis: 'organisation' };
    const criteria = { evidence: { checks: [{ jsonpath: '$.passwordMinimumLength', equals: '16' }, { jsonpath: '$.passwordRequired', equals: 'true' }] } };
    const existing = existingStateCriteria(criteria, [d])!;
    expect(existing.evidence?.checks).toEqual([{ jsonpath: '$.passwordMinimumLength', min: 16 }, { jsonpath: '$.passwordRequired', equals: 'true' }]);
    const read = (n: number) => JSON.stringify({ passwordMinimumLength: n, passwordRequired: true });
    const ok = (n: number) => engine.verify({ stdout: '', stderr: '', exitCode: 0 }, { stdout: read(n), exitCode: 0 }, existing).details.evidence_check;
    expect(ok(16)).toBe(true);
    expect(ok(20)).toBe(true);
    expect(ok(15)).toBe(false);
  });

  it('no decisions: the criteria are returned unchanged', () => {
    expect(existingStateCriteria(screenLock.verification, undefined)).toBe(screenLock.verification);
    expect(existingStateCriteria(screenLock.verification, [])).toBe(screenLock.verification);
  });

  it('checkExistingOrgValues states the observed value and the bound', () => {
    const { decisions } = lte10();
    expect(checkExistingOrgValues(readOf(5), decisions)).toEqual([{
      path: PATH, token: 'passwordMinutesOfInactivityBeforeScreenTimeout', op: 'lte', configured_value: 10,
      bound: { min: 1, max: 10 }, observed_value: 5, within_bound: true, basis: 'existing',
    }]);
    expect(checkExistingOrgValues(readOf(15), decisions)[0]).toMatchObject({ observed_value: 15, within_bound: false });
    // a one-element array (the GET's ConvertTo-Json of one policy) reads the same
    expect(checkExistingOrgValues(`[${readOf(5)}]`, decisions)[0]).toMatchObject({ observed_value: 5, within_bound: true });
  });

  describe('through the adapter (fake runner, screen-lock entry with the organisation value 10)', () => {
    const TENANT = 'fx-unit-w5c3-orgvalues';
    const config = () => StamperConfig.fromTenantConfig({
      tenantId: 'test-tenant', appId: 'test-app', certThumbprint: 'test-thumbprint',
      certPath: '/path/to/cert', targetTenantDomain: 'test.onmicrosoft.us', clientName: 'Test Client',
    });
    const taskOf = (id: string, s: SubCommand): ExeTask => ({
      id, type: 'configuration', priority: 'p1', depends_on: [],
      action: { engine: 'mgraph', command: 'placeholder', args: { _sub_commands: [s] } },
      inputs: [], outputs: [], controls: ['AC.L2-3.1.10', 'SC.L2-3.13.9'], idempotency: 'safe', rollback: { strategy: 'none' },
    } as ExeTask);
    const subOf = (): SubCommand => {
      const { entry, decisions } = lte10();
      return {
        id: entry.entry_id, label: entry.label, set_command: entry.set_command, get_command: entry.get_command,
        engine: entry.engine, sequence_hint: entry.sequence_hint, idempotency: entry.idempotency,
        variables_required: entry.variables_required, variables_runtime: entry.variables_runtime, captures: [],
        on_failure: 'warn_continue', evidence_commands: entry.evidence_commands, verification: entry.verification, org_values: decisions,
      };
    };
    // reads: the answers the GET returns, in order (the last repeats); '' = no existing policy
    const run = async (taskId: string, reads: string[]) => {
      const sent: string[] = [];
      let n = 0;
      const manager = {
        execute: async (_t: string, command: string) => {
          sent.push(command);
          if (command.includes('-Method POST')) return { stdout: readOf(10), stderr: '', exitCode: 0 };
          const out = reads[Math.min(n, reads.length - 1)];
          n += 1;
          return { stdout: out, stderr: '', exitCode: 0 };
        },
      };
      const s = subOf();
      // W5c3 part 2: the SET assigns the CUI group, captured earlier in a run by AC.L2-3.1.1.group-create.
      const ctx = new ExecutionContext(false);
      ctx.registerCaptures({ cuiGroupId: 'group-1' });
      const adapter = new PowerShellAdapter(config(), manager as any, ctx, undefined, TENANT);
      const result = await adapter.execute(taskOf(taskId, s), {}, false);
      const evidFile = evidenceFileForEntry(s.id, s.label).replace(/\.txt$/, '.json');
      const record = JSON.parse(fs.readFileSync(taskEvidencePath(evidenceDirForTenant(TENANT), taskId, evidFile), 'utf-8'));
      return { result, record, setSent: sent.some(c => c.includes('-Method POST')) };
    };

    it('stricter existing policy (5 when the organisation answered 10): SAT, no SET, the record states 5 and [1, 10]', async () => {
      const { result, record, setSent } = await run('task-w5c3-ov-strict', [readOf(5)]);
      expect(result.success).toBe(true);
      expect(setSent).toBe(false);
      expect(record.complianceVerdict).toBe('SAT');
      expect(record.metadata.orgValueChecks).toEqual([expect.objectContaining({ observed_value: 5, bound: { min: 1, max: 10 }, configured_value: 10, within_bound: true, basis: 'existing' })]);
      expect(record.verdictRationale).toContain('existing passwordMinutesOfInactivityBeforeScreenTimeout observed 5, bound [1, 10] (organisation configured 10)');
      expect(record.metadata.orgValues[0]).toMatchObject({ configured_value: 10 });
    });

    it('weaker existing policy (15): NOT_SAT, no SET, the record states 15 outside [1, 10]', async () => {
      const { result, record, setSent } = await run('task-w5c3-ov-weak', [readOf(15)]);
      expect(result.success).toBe(false);
      expect(setSent).toBe(false);
      expect(record.complianceVerdict).toBe('NOT_SAT');
      expect(record.metadata.orgValueChecks).toEqual([expect.objectContaining({ observed_value: 15, within_bound: false })]);
      expect(record.verdictRationale).toContain('observed 15, bound [1, 10]');
      expect(record.outcomeRationale).toContain('observed 15, bound [1, 10]');
    });

    it('no existing policy, Stamper sets 10 and reads 10 back: SAT on the exact assertion', async () => {
      const { result, record, setSent } = await run('task-w5c3-ov-set-ok', ['', readOf(10)]);
      expect(setSent).toBe(true);
      expect(result.success).toBe(true);
      expect(record.complianceVerdict).toBe('SAT');
      expect(record.metadata.orgValueChecks).toBeUndefined();
    });

    it('no existing policy, Stamper sets 10 but reads 5 back: the exact assertion still fails (NOT_SAT)', async () => {
      const { result, record, setSent } = await run('task-w5c3-ov-set-bad', ['', readOf(5)]);
      expect(setSent).toBe(true);
      expect(result.success).toBe(false);
      expect(record.complianceVerdict).toBe('NOT_SAT');
      expect(record.outcome).toBe('failed_no_remediation');
    });
  });
});
