// FIN-29 (finishing plan PH-2 harness): src/flow/ao-sweep-run.ts (E7S, V77) with a fake AO CLI and a fake sim reader.
// Temp folders only; nothing in the workspace is touched, no simulator and no AO process is started.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  AO_SWEEP_SCENARIO_REL,
  applySkipReason,
  discoverSweepResources,
  e7sStep,
  errorClassOf,
  loadAoRegistry,
  loadAoSweepScenario,
  matchesRow,
  pickFrom,
  resolveSweepInputs,
  rowsOfAny,
  runAoSweep,
  type SweepCommand,
} from '../src/flow/ao-sweep-run.js';
import { FIN29_FILES, type Fin29StepCtx } from '../src/flow/fin29-common.js';
import type { AoCliResult } from '../src/flow/ao-step.js';

const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p));
const SCENARIO = path.resolve(AO_SWEEP_SCENARIO_REL);
const AO_ROOT = path.resolve('..', 'ces-ao');
const REG = loadAoRegistry(AO_ROOT);
const sc = loadAoSweepScenario(SCENARIO);

/** A fake `exec --json` answer in AO's shape. */
const aoJson = (o: { op: string; dry: boolean; success?: boolean; error?: string; outcome?: string; status?: string; approvalId?: string; mode?: 'on' | 'off' }): AoCliResult => ({
  rc: 0,
  stderr: '',
  stdout: JSON.stringify({
    success: o.success ?? true,
    ...(o.error ? { error: o.error } : {}),
    ...(o.status ? { status: o.status, approvalId: o.approvalId } : {}),
    evidencePersisted: true,
    evidencePath: `adminops_evidence/${o.op}:${o.dry ? 'd' : 'a'}-${Math.random().toString(16).slice(2)}`,
    evidence: { outcome: o.outcome ?? (o.dry ? 'dry_run' : 'automated_success'), complianceVerdict: o.dry ? 'NOT_APPLICABLE' : 'SAT', metadata: { mode: o.dry ? 'dry_run' : 'live', dryRun: o.dry, sha256Hash: 'ab', twoPersonApproval: { mode: o.mode ?? 'off', tierRequired: false } } },
  }, null, 2),
});

/** Every resource key the scenario names, with a value (as if the sim answered every read). */
const allResources = (): Record<string, string> => ({
  operator_upn: 'adm.op@s1-mach.simtenant.onmicrosoft.us', approver_upn: 'adm.ap@s1-mach.simtenant.onmicrosoft.us', breakglass_upn: 'bg@s1-mach.simtenant.onmicrosoft.us', offboard_upn: 'leaver@s1-mach.simtenant.onmicrosoft.us', leaver_workflow_id: 'wf-1',
  ...Object.fromEntries(Object.keys(sc.resources).map((k) => [k, `v-${k}`])),
  audit_log_retention_days: '90',
});

describe('ao-sweep scenario file', () => {
  it('loads, applies to S1 only, expects the registry\'s 96 commands, floor 0', () => {
    expect(sc.applies_to).toEqual(['s1-mach']);
    expect(sc.expected_commands).toBe(REG.length);
    expect(REG.length).toBe(98); // 96 + F-15 (FIN-40) + A-22 (PH-13 P13-LV)
    expect(sc.apply_floor).toBe(0);
  });
  it('binds every required request input of every registry command when the resources are present', () => {
    const res = allResources();
    const unbound = REG.flatMap((c) => resolveSweepInputs(c, sc, res, 's1-mach.simtenant.onmicrosoft.us').missing.map((m) => `${c.id}: ${m}`));
    expect(unbound).toEqual([]);
  });
  it('names a resource for every tenant-sourced registry key AO cannot answer from a platform constant', () => {
    const platform = new Set(['globalAdminRoleDefId', 'privilegedRoleAdminDefId', 'securityAdminRoleDefId', 'tenantId']);
    // AO SourceBindings keys (resources.<key>) for each source; E5 keys are on the run record already.
    const e5 = new Set(['operator_upn', 'breakglass_upn', 'leaver_workflow_id', 'approver_upn', 'offboard_upn', 'breakglass_user_id', 'global_admin_role_def_id']);
    const bindings: Record<string, string> = {
      m365LicenseSkuId: 'm365_license_sku_id', baseGroupId: 'base_group_id', loaGroupId: 'loa_group_id', adminGroupId: 'admin_group_id', cuiGroupId: 'cui_group_id',
      trainingEnforcementGroupId: 'training_enforcement_group_id', namedLocationId: 'named_location_id', deviceComplianceCaPolicyId: 'device_compliance_ca_policy_id',
      adminPortalCaPolicyId: 'admin_portal_ca_policy_id', androidAppProtectionPolicyId: 'android_app_protection_policy_id', iosAppProtectionPolicyId: 'ios_app_protection_policy_id',
      cuiSiteId: 'cui_site_id', auditLogRetentionDays: 'audit_log_retention_days', itHelpDeskPhone: 'it_helpdesk_phone', backupVaultName: 'backup_vault_name', trainingRosterPath: 'training_roster_path',
      keyVaultName: 'kv_name', sentinelWorkspaceName: 'law_name', 'resources.law_name': 'law_name', resourceGroupName: 'resource_group', 'resources.resourceGroup': 'resource_group', 'subscription.resource_group': 'resource_group',
      'resources.vnetName': 'vnet_name', 'resources.vnet_name': 'vnet_name', 'resources.storage_account_name': 'storage_account_name', 'resources.firewallName': 'firewall_name', 'resources.publicIpName': 'public_ip_name',
      operatorUPN: 'operator_upn', breakGlassUPN: 'breakglass_upn', 'resources.breakglass_upn': 'breakglass_upn', 'resources.leaver_workflow_id': 'leaver_workflow_id',
    };
    const sources = [...new Set(REG.flatMap((c) => c.parameters.filter((p) => p.source).map((p) => p.source!)))];
    const uncovered = sources.filter((s) => !platform.has(s)).filter((s) => { const k = bindings[s]; return !k || !(k in sc.resources || e5.has(k)); });
    expect(uncovered).toEqual([]);
  });
  it('keeps every recurring-cost op dry except E-01 on its free path (90 days)', () => {
    const res = allResources();
    const dry = REG.filter((c) => applySkipReason(c, sc, res)).map((c) => c.id).sort();
    expect(dry).toEqual(['C-03', 'F-12', 'F-14']);
    expect(applySkipReason(REG.find((c) => c.id === 'E-01')!, sc, { ...res, audit_log_retention_days: '365' })).toMatch(/recurring cost/);
  });
  it('carries the fictional marker and no real-tenant domain', () => {
    const text = fs.readFileSync(SCENARIO, 'utf8');
    expect(text).toMatch(/FICTIONAL/);
    expect(text).not.toMatch(/\.mil\b|graph\.microsoft\.us/);
  });
});

describe('discovery helpers', () => {
  it('matches exact (case-insensitive) or /regex/, picks the first present field', () => {
    expect(matchesRow({ displayName: 's1-all-staff' }, { displayName: 'S1-All-Staff' })).toBe(true);
    expect(matchesRow({ Url: 'https://x/sites/cui-enclave' }, { Url: '/cui/i' })).toBe(true);
    expect(matchesRow({ displayName: 1 }, { displayName: '1' })).toBe(false);
    expect(pickFrom([{ a: '' , b: 'B' }], undefined, ['a', 'b'])).toBe('B');
    expect(rowsOfAny({ value: [{ id: 1 }] })).toHaveLength(1);
    expect(rowsOfAny({ Name: 'kv' })).toEqual([{ Name: 'kv' }]);
  });
  it('fills only missing keys; literals and fixtures get their provenance; a failed read is recorded, not thrown', async () => {
    const simRoot = tmp('fin29-sim-');
    fs.mkdirSync(path.join(simRoot, 'fixtures'), { recursive: true });
    fs.writeFileSync(path.join(simRoot, 'fixtures', 'training-roster.csv'), 'upn\n');
    const read = async (req: any) => {
      if (req.uri === '/v1.0/groups') return { value: [{ id: 'group-4', displayName: 'S1-All-Staff', mail: 'x' }] };
      throw new Error('nope');
    };
    const d = await discoverSweepResources(
      { base_group_id: sc.resources.base_group_id, kv_name: sc.resources.kv_name, audit_log_retention_days: sc.resources.audit_log_retention_days, training_roster_path: sc.resources.training_roster_path, operator_upn: { literal: 'never', describe: 'x' } },
      { operator_upn: 'op@x' }, read, { stacksimRoot: simRoot });
    expect(d.resources.base_group_id).toBe('group-4');
    expect(d.resources.operator_upn).toBe('op@x');
    expect(d.provenance.operator_upn).toBe('tenant record (E5)');
    expect(d.resources.audit_log_retention_days).toBe('90');
    expect(d.resources.training_roster_path).toBe(path.join(simRoot, 'fixtures', 'training-roster.csv'));
    expect(d.missing.kv_name).toMatch(/read failed/);
  });
});

describe('errorClassOf', () => {
  it('names binding, guard and denial errors', () => {
    expect(errorClassOf(aoJson({ op: 'A-01', dry: true, success: false, error: 'Parameter binding failed (required tenant value missing): x' })).cls).toBe('binding');
    expect(errorClassOf(aoJson({ op: 'A-01', dry: true, success: false, error: 'PowerShell injection guard: bad' })).cls).toBe('guard');
    expect(errorClassOf(aoJson({ op: 'A-01', dry: true, success: false, outcome: 'denied_cmmc', error: 'CMMC' })).cls).toBe('denied');
    expect(errorClassOf({ rc: 1, stdout: '', stderr: 'error: Missing required parameter(s): upn' }).cls).toBe('binding');
    expect(errorClassOf(aoJson({ op: 'A-01', dry: true })).cls).toBeNull();
  });
});

describe('runAoSweep', () => {
  const record = (res: Record<string, string>) => ({ tenant: { tenant_id: 'sim-tenant-s1-mach', domain: 's1-mach.simtenant.onmicrosoft.us' }, resources: res });
  it('two-person OFF: every op dry-run then applied (recurring ones kept dry); no token minted; argv never carries a secret', async () => {
    const calls: string[][] = [];
    const run = async (args: string[]) => {
      calls.push(args);
      return aoJson({ op: args[1], dry: !args.includes('--apply') });
    };
    const out = await runAoSweep({ commands: REG, scenario: sc, slug: 's1-mach', record: record(allResources()), env: { CES_AO_PRINCIPAL_SECRET: 'x'.repeat(32) }, runCli: run });
    expect(out.two_person_approval).toBe('off');
    expect(out.totals).toMatchObject({ commands: 98, dry_run_ok: 98, applied: 95, apply_skipped: 3, not_run: 0, binding_errors: 0, guard_errors: 0 });
    expect(out.ok).toBe(true);
    expect(calls.some((a) => a[0] === 'approve')).toBe(false);
    expect(calls.flat().join(' ')).not.toMatch(/x{32}/);
  });
  it('two-person ON: a Tier 3 op is requested, approved with the approver\'s token in the env, then applied', async () => {
    const seen: Array<{ args: string[]; token?: string }> = [];
    const t3 = REG.filter((c) => c.id === 'A-03');
    const run = async (args: string[], env: NodeJS.ProcessEnv) => {
      seen.push({ args, token: env.CES_AO_PRINCIPAL_TOKEN });
      if (args[0] === 'approve') return { rc: 0, stdout: 'APPROVED a-1', stderr: '' };
      if (!args.includes('--apply')) return aoJson({ op: 'A-03', dry: true, success: false, status: 'pending_approval', approvalId: 'a-1', outcome: 'blocked_pending_approval', mode: 'on' });
      return aoJson({ op: 'A-03', dry: !args.includes('--apply'), mode: 'on' });
    };
    const secrets: string[] = [];
    const out = await runAoSweep({ commands: t3, scenario: sc, slug: 's1-mach', record: record(allResources()), env: { CES_AO_PRINCIPAL_SECRET: 's'.repeat(32), CES_TWO_PERSON_APPROVAL: '1' }, runCli: run, registerSecret: (_n, v) => secrets.push(v) });
    expect(out.two_person_approval).toBe('on');
    expect(out.ops[0].calls.map((c) => c.call)).toEqual(['request', 'approve', 'apply']);
    expect(out.ops[0].dry_run_ok).toBe(true);
    expect(out.ops[0].applied).toBe(true);
    const approve = seen.find((s) => s.args[0] === 'approve')!;
    expect(approve.token).toBeTruthy();
    expect(secrets).toEqual([approve.token]);
    expect(seen.flatMap((s) => s.args).join(' ')).not.toContain(approve.token!);
  });
  it('an op whose input is not discovered is not run, and names the key', async () => {
    const res = allResources();
    delete res.standing_admin_upn;
    const out = await runAoSweep({ commands: REG.filter((c) => c.id === 'A-10'), scenario: sc, slug: 's1-mach', record: record(res), env: {}, runCli: async (a) => aoJson({ op: a[1], dry: true }) });
    expect(out.ops[0].not_run).toMatch(/standing_admin_upn/);
    expect(out.ok).toBe(false);
  });
  it('a binding error on the dry run is classed and stops the op', async () => {
    const out = await runAoSweep({ commands: REG.filter((c) => c.id === 'A-08'), scenario: sc, slug: 's1-mach', record: record(allResources()), env: {}, runCli: async (a) => aoJson({ op: a[1], dry: true, success: false, error: 'Parameter binding failed (required tenant value missing): y' }) });
    expect(out.totals.binding_errors).toBe(1);
    expect(out.ops[0].calls).toHaveLength(1);
  });
});

describe('e7sStep', () => {
  const ctxFor = (ws: string, over: Partial<Fin29StepCtx> = {}): Fin29StepCtx => {
    const out = path.join(ws, 'out');
    fs.mkdirSync(path.join(out, 'logs'), { recursive: true });
    const rec = path.join(ws, 'tenants', 'sim', 's1-mach.json');
    fs.mkdirSync(path.dirname(rec), { recursive: true });
    const pfx = path.join(out, 'ao', 'sim', 's1-mach.pfx');
    fs.mkdirSync(path.dirname(pfx), { recursive: true });
    fs.writeFileSync(pfx, 'x');
    fs.writeFileSync(rec, JSON.stringify({ kind: 'sim', client: { slug: 's1-mach' }, tenant: { tenant_id: 'sim-tenant-s1-mach', domain: 's1-mach.simtenant.onmicrosoft.us' }, auth: { cert_path: pfx }, resources: { operator_upn: 'op@s1-mach.simtenant.onmicrosoft.us', offboard_upn: 'l@x', breakglass_upn: 'bg@x' } }));
    const P = { ws, pkg: ws, ces: path.resolve('..'), out, logs: path.join(out, 'logs'), pl: path.join(ws, 'pl'), tenants: path.join(ws, 'tenants'), sim: ws, musterApi: ws, muster: ws, stamper: ws, stamperRegistry: ws, tsx: ws, exe: ws, st: ws, stCwd: ws, forced: ws, plansPushed: ws, planDir: ws, aoRoot: AO_ROOT, aoCli: path.join(AO_ROOT, 'dist', 'cli', 'index.js'), eoRoot: ws, registryRecord: rec, mintToken: ws };
    return {
      slug: 's1-mach', scenario: {}, P, urls: { sim: 'http://127.0.0.1:1', api: '', ec: '', eo: '' }, node: process.execPath, log: () => undefined,
      rel: (p) => path.relative(ws, p).split(path.sep).join('/'), nowIso: () => new Date().toISOString(),
      runCapture: async () => ({ rc: 0, stdout: '', stderr: '' }), runAoCli: async (a) => aoJson({ op: a[1], dry: !a.includes('--apply') }),
      startBg: () => { throw new Error('no'); }, stopTree: () => undefined, waitHttp: async () => false, portHeld: async () => false, eoAuthHeaders: () => ({}),
      simEnv: () => ({}), stamperEnv: () => ({}), aoEnv: () => ({ CES_TENANT_ROOT: path.join(ws, 'tenants'), CES_AO_PRINCIPAL_SECRET: 'q'.repeat(32) }),
      simUp: () => true, eoUp: () => true, musterApiUp: () => true, musterToken: () => undefined, musterJwt: () => undefined, registerSecret: () => undefined,
      ...over,
    };
  };
  it('is skipped off S1', () => {
    const ws = tmp('fin29-e7s-');
    expect(e7sStep({ ...ctxFor(ws), slug: 's2-eng' }).skip).toMatch(/s1-mach only/);
  });
  it('writes the record, uses a private tenant root, and leaves the run\'s record unchanged', async () => {
    const ws = tmp('fin29-e7s-');
    const envs: string[] = [];
    const ctx = ctxFor(ws, { runAoCli: async (a, e) => { envs.push(String(e.CES_TENANT_ROOT)); return aoJson({ op: a[1], dry: !a.includes('--apply') }); } });
    const before = fs.readFileSync(ctx.P.registryRecord, 'utf8');
    const read = async (req: any) => (req.kind === 'uri' ? { value: [] } : []);
    const step = e7sStep(ctx, { read });
    expect(step.fatal).toBe(false);
    const r = await step.run();
    const rec = JSON.parse(fs.readFileSync(path.join(ctx.P.out, FIN29_FILES.aoSweep), 'utf8'));
    expect(rec.schema).toBe('ces-tester/ao-sweep@1');
    expect(rec.ops).toHaveLength(REG.length);
    // nothing discovered (empty sim): the ops needing a discovered key are recorded "not run", the step is red
    expect(rec.totals.not_run).toBeGreaterThan(0);
    expect(Object.keys(rec.resources_missing)).toContain('base_group_id');
    expect(r.rc).toBe(1);
    expect(new Set(envs)).toEqual(new Set([path.join(ctx.P.out, 'ao-sweep', 'tenants')]));
    expect(fs.readFileSync(ctx.P.registryRecord, 'utf8')).toBe(before);
    expect(fs.existsSync(path.join(ctx.P.out, 'ao-sweep', 'tenants', 'sim', 's1-mach.json'))).toBe(true);
  });
  it('makes and removes its own PFX when E7A\'s is gone', async () => {
    const ws = tmp('fin29-e7s-');
    const ctx = ctxFor(ws);
    fs.rmSync(path.join(ctx.P.out, 'ao', 'sim', 's1-mach.pfx'));
    let made = '';
    const step = e7sStep(ctx, { read: async () => [], makePfx: (p) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, 'pfx'); made = p; return { path: p, thumbprint: 'T' }; } });
    await step.run();
    expect(made).toMatch(/ao-sweep/);
    expect(fs.existsSync(made)).toBe(false);
  });
  it('refuses without the sim or the AO env', async () => {
    const ws = tmp('fin29-e7s-');
    const r = await e7sStep(ctxFor(ws, { aoEnv: () => undefined })).run();
    expect(r.rc).toBe(1);
    expect(r.detail).toMatch(/needs the sim/);
  });
});

// Typed import kept for the SweepCommand shape (no runtime use).
export type _S = SweepCommand;
