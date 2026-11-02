// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

// Synthetic-customer W2: E5 registry resources, the E7A AdminOps call sequencing (T2 dry run + apply; T3 request,
// approve by a harness-minted second principal, apply), the AO env, the E6X / E7A / E7B steps in the dry-run plan,
// the window-list ledger rule and the new scenario fields. A fake AO CLI stands in for ces-ao; nothing starts.
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as tls from 'node:tls';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AO_SECRET_ENV,
  AO_TOKEN_ENV,
  DISCOVERERS,
  EO_ADMINOPS_SINCE_ENV,
  SIM_PFX_OUT_ENV,
  SIM_PFX_PASSWORD_ENV,
  SIM_PFX_SCRIPT,
  buildAoEnv,
  eoAdminOpsWindowEnv,
  makeSimPfx,
  simCertPath,
  windowsPowerShellRunner,
  writeRecordCertPath,
  execArgs,
  mintPrincipalToken,
  parseAoJson,
  resolveCheck,
  resourceKeysNamed,
  resourcesFromTm,
  runAoOps,
  summarizeExec,
  twoPersonApprovalOn,
  TWO_PERSON_APPROVAL_ENV,
  writeRecordResources,
  type AdminOpsOpSpec,
  type AoCliResult,
} from '../src/flow/ao-step.js';
import { compareLedger } from '../src/flow/muster-e2e-compare.js';
import { runMusterE2e, MUSTER_E2E_STEP_IDS, REQUIRED_STEPS } from '../src/flow/muster-e2e-run.js';
import { loadMusterE2eFile, validateMusterE2e } from '../src/scenarios/musterE2eFile.js';

const S1 = path.resolve('scenarios', 'muster', 's1-mach-e2e.json');
const MP = path.resolve('scenarios', 'muster', 'muster-partial-e2e.json');
const SECRET = 'w2-test-principal-secret-0123456789';
const OPERATOR = 'adm.operator@s1.simtenant.onmicrosoft.us';
const APPROVER = 'adm.approver@s1.simtenant.onmicrosoft.us';

const record = (extra: Record<string, string> = {}): Record<string, unknown> => ({
  kind: 'sim',
  tenant: { tenant_id: 'sim-tenant-s1-mach' },
  resources: { operator_upn: OPERATOR, approver_upn: APPROVER, breakglass_upn: 'bg@s1', offboard_upn: 'leaver@s1', ...extra },
});

const decode = (tok: string): Record<string, unknown> => JSON.parse(Buffer.from(tok.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));

/** A fake AO CLI: answers by call shape; records argv and the env it saw. */
function fakeAo(opts: { verdict?: string; failOn?: string } = {}) {
  const calls: Array<{ args: string[]; env: NodeJS.ProcessEnv; label: string }> = [];
  let n = 0;
  const ok = (o: unknown): AoCliResult => ({ rc: 0, stdout: `[aoTenants] a log line\n${JSON.stringify(o, null, 2)}\n`, stderr: '' });
  const run = async (args: string[], env: NodeJS.ProcessEnv, label: string): Promise<AoCliResult> => {
    calls.push({ args, env, label });
    n++;
    if (opts.failOn && label === opts.failOn) return { rc: 1, stdout: '', stderr: 'error: boom' };
    if (args[0] === 'approve') return { rc: 0, stdout: `✓ APPROVED ${args[1]} — command X by ${APPROVER}\n`, stderr: '' };
    const op = args[1]!;
    const apply = args.includes('--apply');
    const t3 = op === 'A-19';
    const tp = twoPersonApprovalOn(env) ? 'on' : 'off';
    if (t3 && tp === 'on' && !args.includes('--approval')) {
      return ok({ success: false, status: 'pending_approval', approvalId: 'appr-1', requestorUPN: OPERATOR, evidencePersisted: true, evidencePath: `adminops_evidence/${op}:p${n}` });
    }
    return ok({
      success: true,
      evidence: { outcome: apply ? 'automated_success' : 'dry_run', complianceVerdict: apply ? opts.verdict ?? 'SAT' : 'NOT_APPLICABLE', metadata: { mode: apply ? 'live' : 'dry_run', dryRun: !apply, sha256Hash: `h${n}`, ...(apply ? { stateChanged: true } : {}), twoPersonApproval: { mode: tp, tierRequired: t3 } } },
      evidencePersisted: true,
      evidencePath: `adminops_evidence/${op}:e${n}`,
    });
  };
  return { calls, run };
}

const env = buildAoEnv({ PSModulePath: 'x\\psmodules', Path: 'p', CES_AO_ALLOW_LIVE: '1', [AO_TOKEN_ENV]: 'stale' }, { pipelineRoot: 'WS/pl', tenantRoot: 'WS/tenants', simUrl: 'http://127.0.0.1:4390', secret: SECRET });

/** W9-C1 (2P-H): the same env with two-person approval turned back on. */
const envOn: NodeJS.ProcessEnv = { ...env, [TWO_PERSON_APPROVAL_ENV]: '1' };

describe('E5: registry record resources', () => {
  it('copies the TM keys AO reads into snake_case resources with their provenance', () => {
    const r = resourcesFromTm({
      operatorUPN: OPERATOR,
      breakGlassUPN: 'bg@s1',
      approverUPN: APPROVER,
      roleDefId: '62e90394-69f5-4237-9190-012177145e10',
      wifiSsid: 'ignored',
      adminUserName: '{adminUserName}',
      operator_value_provenance: { values: { operatorUPN: 'discovered', approverUPN: 'asked', roleDefId: 'derived' } },
    });
    expect(r.resources).toEqual({ operator_upn: OPERATOR, breakglass_upn: 'bg@s1', approver_upn: APPROVER, global_admin_role_def_id: '62e90394-69f5-4237-9190-012177145e10' });
    expect(r.provenance.operator_upn).toBe('tm:operatorUPN (discovered)');
    expect(r.provenance.approver_upn).toBe('tm:approverUPN (answered)');
    expect(r.provenance.breakglass_upn).toBe('tm:breakGlassUPN (unknown)');
    expect(resourcesFromTm(null)).toEqual({ resources: {}, provenance: {} });
  });

  it('names the keys an op list reads (params and confirm templates)', () => {
    const ops: AdminOpsOpSpec[] = [
      { op: 'A-02', tier: 'T2', kind: 'write', params: { upn: 'resources.offboard_upn' }, confirm: { request: { kind: 'uri', method: 'GET', uri: '/v1.0/users' }, select: { field: 'userPrincipalName', equals: '{resources.other_key}' }, path: 'accountEnabled', assert: 'equals', value: false } },
      { op: 'A-11', tier: 'T2', kind: 'read' },
    ];
    expect(resourceKeysNamed(ops)).toEqual(['offboard_upn', 'other_key']);
  });

  it('discovers the enabled leaver whose leave date has passed (never a disabled one, never a future one)', () => {
    const now = Date.parse('2026-10-28T00:00:00Z');
    const rows = [
      { userPrincipalName: 'stayer@s1', accountEnabled: true },
      { userPrincipalName: 'gone@s1', accountEnabled: false, employeeLeaveDateTime: '2026-09-01T00:00:00Z' },
      { userPrincipalName: 'future@s1', accountEnabled: true, employeeLeaveDateTime: '2026-11-30T00:00:00Z' },
      { userPrincipalName: 'leaver@s1', accountEnabled: true, employeeLeaveDateTime: '2026-10-19T00:00:00Z' },
    ];
    expect(DISCOVERERS.offboard_upn!.pick(rows, now)).toBe('leaver@s1');
    expect(DISCOVERERS.offboard_upn!.pick(rows.slice(0, 3), now)).toBeUndefined();
    expect(DISCOVERERS.offboard_upn!.request).toEqual({ kind: 'uri', method: 'GET', uri: '/v1.0/users' });
  });

  it('merges resources into the registry record and keeps its other fields', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'w2-rec-'));
    const f = path.join(dir, 's1-mach.json');
    fs.writeFileSync(f, JSON.stringify({ kind: 'sim', tenant: { tenant_id: 't' }, resources: { kept: 'k' } }));
    writeRecordResources(f, { operator_upn: OPERATOR });
    const back = JSON.parse(fs.readFileSync(f, 'utf8'));
    expect(back).toEqual({ kind: 'sim', tenant: { tenant_id: 't' }, resources: { kept: 'k', operator_upn: OPERATOR } });
    await fsp.rm(dir, { recursive: true, force: true });
  });
});

describe('E7A: AO environment and principals', () => {
  it('sets the pipeline and tenant roots, the sim URL, the sim-only rail and the secret; drops the live opt-in and any token', () => {
    expect(env.CES_PIPELINE_ROOT).toBe('WS/pl');
    expect(env.CES_TENANT_ROOT).toBe('WS/tenants');
    expect(env.STACKSIM_SERVER_URL).toBe('http://127.0.0.1:4390');
    expect(env.PSModulePath).toBe('x\\psmodules');
    expect(env.CES_AO_SIM_ONLY).toBe('1');
    expect(env[AO_SECRET_ENV]).toBe(SECRET);
    expect(env.CES_AO_ALLOW_LIVE).toBeUndefined();
    expect(env[AO_TOKEN_ENV]).toBeUndefined();
  });

  it('mints an HS256 ao-approver token bound to the tenant (and ces-shared verifies it when the workspace is present)', async () => {
    const tok = mintPrincipalToken({ upn: APPROVER, tid: 'sim-tenant-s1-mach' }, SECRET, Date.parse('2026-10-28T00:00:00Z'));
    const c = decode(tok);
    expect(c).toMatchObject({ upn: APPROVER, tid: 'sim-tenant-s1-mach', roles: ['ao-approver'] });
    expect(typeof c.sub).toBe('string');
    expect((c.exp as number) - (c.iat as number)).toBe(3600);
    expect(() => mintPrincipalToken({ upn: APPROVER, tid: 't' }, 'short')).toThrow(/16/);
    const shared = path.resolve('..', 'ces-shared', 'dist', 'http', 'requestPrincipal.js');
    if (fs.existsSync(shared)) {
      const m = (await import(pathToFileURL(shared).href)) as { createHs256PrincipalVerifier: (o: { secret: string }) => { verify: (t: string) => { ok: boolean; principal?: { upn: string; tenantId?: string; roles: string[] } } } };
      const live = mintPrincipalToken({ upn: APPROVER, tid: 'sim-tenant-s1-mach' }, SECRET);
      const v = m.createHs256PrincipalVerifier({ secret: SECRET }).verify(live);
      expect(v.ok).toBe(true);
      expect(v.principal).toMatchObject({ upn: APPROVER, tenantId: 'sim-tenant-s1-mach', roles: ['ao-approver'] });
      expect(m.createHs256PrincipalVerifier({ secret: 'another-secret-0123456789' }).verify(live).ok).toBe(false);
    }
  });
});

describe('E7A: call sequencing', () => {
  const confirmPass = async () => ({ pass: true, actual: 'false' });

  it('runs the ops in order: T2 = dry run then apply, every exec with --requestor and --json, params from the record', async () => {
    const ao = fakeAo();
    const ops: AdminOpsOpSpec[] = [
      { op: 'A-11', tier: 'T2', kind: 'read' },
      { op: 'A-02', tier: 'T2', kind: 'write', params: { upn: 'resources.offboard_upn' }, confirm: { request: { kind: 'uri', method: 'GET', uri: '/v1.0/users' }, select: { field: 'userPrincipalName', equals: '{resources.offboard_upn}' }, path: 'accountEnabled', assert: 'equals', value: false } },
      { op: 'A-09', tier: 'T2', kind: 'read' },
    ];
    const seen: unknown[] = [];
    const r = await runAoOps({ ops, slug: 's1-mach', record: record(), provenance: { offboard_upn: 'discovered (x)' }, env, runCli: ao.run, confirm: async (c) => { seen.push(c); return confirmPass(); } });
    expect(r.ok).toBe(true);
    expect(ao.calls.map((c) => c.label)).toEqual(['A-11-dry_run', 'A-11-apply', 'A-02-dry_run', 'A-02-apply', 'A-09-dry_run', 'A-09-apply']);
    for (const c of ao.calls) {
      expect(c.args.slice(0, 6)).toEqual(['exec', c.args[1], '--tenant', 's1-mach', '--requestor', OPERATOR]);
      expect(c.args[c.args.length - 1]).toBe('--json');
      expect(c.env).toBe(env);
    }
    expect(ao.calls[2]!.args).not.toContain('--apply');
    expect(ao.calls[3]!.args).toEqual(['exec', 'A-02', '--tenant', 's1-mach', '--requestor', OPERATOR, '--apply', '--param', 'upn=leaver@s1', '--json']);
    expect(r.ops[1]!.params).toEqual([{ name: 'upn', from: 'resources.offboard_upn', value: 'leaver@s1', provenance: 'discovered (x)' }]);
    expect(seen).toEqual([{ request: { kind: 'uri', method: 'GET', uri: '/v1.0/users' }, select: { field: 'userPrincipalName', equals: 'leaver@s1' }, path: 'accountEnabled', assert: 'equals', value: false }]);
    expect(r.ops[1]!.calls.map((c) => [c.call, c.mode, c.evidence_row_id])).toEqual([['dry_run', 'dry_run', 'A-02:e3'], ['apply', 'live', 'A-02:e4']]);
    expect(r.ops[0]!.confirm).toBeUndefined();
    expect(r).toMatchObject({ requestor_upn: OPERATOR, tenant_id: 'sim-tenant-s1-mach' });
  });

  it('T3 with two-person ON takes three calls: exec (pending, approval id), approve by the minted second principal, exec --approval --apply', async () => {
    const ao = fakeAo();
    const ops: AdminOpsOpSpec[] = [{ op: 'A-19', tier: 'T3', kind: 'write', params: { policyDisplayName: 'resources.policy_name' }, confirm: { request: { kind: 'uri', method: 'GET', uri: '/v1.0/identity/conditionalAccess/policies' }, path: 'x', assert: 'exists' } }];
    const r = await runAoOps({ ops, slug: 's3-def', record: record({ policy_name: 'Customer MFA' }), provenance: {}, env: envOn, runCli: ao.run, confirm: confirmPass, now: () => Date.parse('2026-10-28T00:00:00Z') });
    expect(r.ok).toBe(true);
    expect(ao.calls.map((c) => c.args[0] + (c.args.includes('--apply') ? ' --apply' : ''))).toEqual(['exec', 'approve', 'exec --apply']);
    expect(ao.calls[0]!.args).toEqual(['exec', 'A-19', '--tenant', 's3-def', '--requestor', OPERATOR, '--param', 'policyDisplayName=Customer MFA', '--json']);
    expect(ao.calls[1]!.args).toEqual(['approve', 'appr-1']);
    expect(ao.calls[2]!.args).toEqual(['exec', 'A-19', '--tenant', 's3-def', '--requestor', OPERATOR, '--approval', 'appr-1', '--apply', '--param', 'policyDisplayName=Customer MFA', '--json']);
    // The token travels in the approve call's env only; never in any argv, never in the exec env.
    const tok = ao.calls[1]!.env[AO_TOKEN_ENV]!;
    expect(decode(tok)).toMatchObject({ upn: APPROVER, tid: 'sim-tenant-s1-mach', roles: ['ao-approver'] });
    expect(ao.calls[0]!.env[AO_TOKEN_ENV]).toBeUndefined();
    expect(ao.calls[2]!.env[AO_TOKEN_ENV]).toBeUndefined();
    expect(JSON.stringify(ao.calls.map((c) => c.args))).not.toContain(SECRET);
    expect(JSON.stringify(r)).not.toContain(tok);
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(r.ops[0]!.calls.map((c) => c.call)).toEqual(['request', 'approve', 'apply']);
    expect(r.ops[0]!.calls[0]).toMatchObject({ status: 'pending_approval', approval_id: 'appr-1', ok: true });
    expect(r.ops[0]!.calls[2]).toMatchObject({ two_person_mode: 'on' });
    expect(r).toMatchObject({ two_person_approval: 'on', approver_upn: APPROVER });
  });

  it('W9-C1: T3 with two-person OFF (the default) runs dry run then apply, with no approval and no approver', async () => {
    expect(twoPersonApprovalOn(env)).toBe(false);
    expect(twoPersonApprovalOn({ [TWO_PERSON_APPROVAL_ENV]: ' TRUE ' })).toBe(true);
    expect(twoPersonApprovalOn({ [TWO_PERSON_APPROVAL_ENV]: '0' })).toBe(false);
    const ao = fakeAo();
    const ops: AdminOpsOpSpec[] = [{ op: 'A-19', tier: 'T3', kind: 'write', params: { policyDisplayName: 'resources.policy_name' }, confirm: { request: { kind: 'uri', method: 'GET', uri: '/v1.0/identity/conditionalAccess/policies' }, path: 'x', assert: 'exists' } }];
    const r = await runAoOps({ ops, slug: 's3-def', record: record({ policy_name: 'Customer MFA', approver_upn: OPERATOR }), provenance: {}, env, runCli: ao.run, confirm: confirmPass });
    expect(r.ok).toBe(true);
    expect(ao.calls.map((c) => c.label)).toEqual(['A-19-dry_run', 'A-19-apply']);
    expect(ao.calls[1]!.args).toEqual(['exec', 'A-19', '--tenant', 's3-def', '--requestor', OPERATOR, '--apply', '--param', 'policyDisplayName=Customer MFA', '--json']);
    for (const c of ao.calls) expect(c.env[AO_TOKEN_ENV]).toBeUndefined();
    expect(r.ops[0]!.calls.map((c) => [c.call, c.two_person_mode])).toEqual([['dry_run', 'off'], ['apply', 'off']]);
    expect(r).toMatchObject({ two_person_approval: 'off', approver_upn: null });
  });

  it('two-person ON: refuses a T3 op whose approver is the requestor, or a record without an approver (no AO call)', async () => {
    const ao = fakeAo();
    const ops: AdminOpsOpSpec[] = [{ op: 'A-19', tier: 'T3', kind: 'read' }];
    const same = await runAoOps({ ops, slug: 's', record: record({ approver_upn: OPERATOR }), provenance: {}, env: envOn, runCli: ao.run, confirm: confirmPass });
    expect(same.ok).toBe(false);
    expect(same.ops[0]!.detail).toMatch(/equals the requestor/);
    expect(ao.calls).toHaveLength(0);
  });

  it('an unbound parameter or a missing operator fails the op without calling AO; nothing is typed in its place', async () => {
    const ao = fakeAo();
    const ops: AdminOpsOpSpec[] = [{ op: 'A-02', tier: 'T2', kind: 'write', params: { upn: 'resources.not_there' }, confirm: { request: { kind: 'uri', method: 'GET', uri: '/v1.0/users' }, path: 'a', assert: 'exists' } }];
    const r = await runAoOps({ ops, slug: 's', record: record(), provenance: {}, env, runCli: ao.run, confirm: confirmPass });
    expect(r.ops[0]!.detail).toMatch(/lacks upn <- resources.not_there/);
    const noOp = await runAoOps({ ops: [{ op: 'A-11', tier: 'T2', kind: 'read' }], slug: 's', record: { tenant: { tenant_id: 't' }, resources: {} }, provenance: {}, env, runCli: ao.run, confirm: confirmPass });
    expect(noOp.ops[0]!.detail).toMatch(/operator_upn/);
    expect(ao.calls).toHaveLength(0);
  });

  it('a failed dry run stops the op before its apply; a NOT_SAT apply or a failed confirming read is not ok', async () => {
    const a = fakeAo({ failOn: 'A-11-dry_run' });
    const r1 = await runAoOps({ ops: [{ op: 'A-11', tier: 'T2', kind: 'read' }], slug: 's', record: record(), provenance: {}, env, runCli: a.run, confirm: confirmPass });
    expect(a.calls.map((c) => c.label)).toEqual(['A-11-dry_run']);
    expect(r1.ops[0]!.detail).toMatch(/rc 1/);
    const b = fakeAo({ verdict: 'NOT_SAT' });
    const r2 = await runAoOps({ ops: [{ op: 'A-11', tier: 'T2', kind: 'read' }], slug: 's', record: record(), provenance: {}, env, runCli: b.run, confirm: confirmPass });
    expect(r2.ok).toBe(false);
    expect(r2.ops[0]!.detail).toMatch(/verdict NOT_SAT/);
    const c = fakeAo();
    const w: AdminOpsOpSpec = { op: 'A-02', tier: 'T2', kind: 'write', params: { upn: 'resources.offboard_upn' }, confirm: { request: { kind: 'uri', method: 'GET', uri: '/v1.0/users' }, path: 'a', assert: 'exists' } };
    const r3 = await runAoOps({ ops: [w], slug: 's', record: record(), provenance: {}, env, runCli: c.run, confirm: async () => ({ pass: false, actual: 'true' }) });
    expect(r3.ops[0]).toMatchObject({ ok: false, confirm: { pass: false, actual: 'true' } });
    const r4 = await runAoOps({ ops: [{ ...w, confirm: undefined }], slug: 's', record: record(), provenance: {}, env, runCli: c.run, confirm: confirmPass });
    expect(r4.ops[0]!.detail).toMatch(/needs a confirm check/);
  });

  it('parses the JSON result after log lines; summarizes an unpersisted row as not ok', () => {
    expect(parseAoJson('noise\n{\n  "a": 1\n}\n')).toEqual({ a: 1 });
    expect(parseAoJson('{"b":2}')).toEqual({ b: 2 });
    expect(parseAoJson('no json')).toBeNull();
    const s = summarizeExec('apply', ['exec'], { rc: 0, stdout: JSON.stringify({ success: true, evidence: { complianceVerdict: 'SAT', metadata: { mode: 'live' } }, evidencePersisted: false }), stderr: '' });
    expect(s).toMatchObject({ ok: false, detail: 'evidence row not persisted' });
    expect(execArgs({ op: 'A-11', slug: 's', requestor: 'r', params: [] })).toEqual(['exec', 'A-11', '--tenant', 's', '--requestor', 'r', '--json']);
    expect(() => resolveCheck({ request: { kind: 'uri', method: 'GET', uri: '/x/{resources.nope}' }, path: 'a', assert: 'exists' }, record())).toThrow(/resources.nope/);
  });
});

describe('W2 scenario fields and steps', () => {
  it('both tester scenarios validate; S1 carries four T2 ops (W7-TST: + A-21), muster-partial none; params must be record paths', async () => {
    const s1 = await loadMusterE2eFile(S1);
    expect((s1.adminops_ops ?? []).map((o) => `${o.op}:${o.tier}:${o.kind}`)).toEqual(['A-11:T2:read', 'A-02:T2:write', 'A-09:T2:read', 'A-21:T2:write']);
    expect(s1.adminops_ops![1]!.params).toEqual({ upn: 'resources.offboard_upn' });
    // Honest drop (founder 2026-10-31): the records store outranks A-21's lift of PS.L2-3.9.2. PH-13 (P13-INT): it still
    // does after step EL's A-22. EO's personnel store decides [a]-[c] from the customer's uploaded lifecycle records
    // (personnel-lifecycle.json: the leaver's account-disable step not done; ces-eo ledgerAssembly.ts storeControlStatus,
    // applyStoreControlStatus), which no tenant write changes (R-F10 S1 ssp.json PS.L2-3.9.2 objectives, source personnel).
    expect(s1.expected_improvements!.map((i) => `${i.controlId}:${i.op}`)).toEqual([]);
    expect(s1.allowed_reverts).toEqual([]);
    expect(s1.drift_injection).toEqual([]);
    expect(s1.expected_ledger.allowed_write_windows).toEqual(['EL', 'E6', 'E7A']); // PH-13: + EL (A-22 after the confirm)
    expect(s1.expected_ledger.min_writes_during).toMatchObject({ EL: 1, E6: 1, E7A: 1 });
    const mp = await loadMusterE2eFile(MP);
    expect(mp.adminops_ops).toEqual([]);
    expect(mp.expected_ledger.no_writes_during).toEqual(['E2', 'E6X', 'E7A']);
    const raw = JSON.parse(fs.readFileSync(S1, 'utf8'));
    expect(() => validateMusterE2e({ ...raw, adminops_ops: [{ op: 'A-02', tier: 'T2', kind: 'write', params: { upn: 'leaver@s1' } }] })).toThrow(/schema/);
    expect(() => validateMusterE2e({ ...raw, adminops_ops: [{ op: 'A-02', tier: 'T4', kind: 'write' }] })).toThrow(/schema/);
    expect(() => validateMusterE2e({ ...raw, drift_injection: [{ request: { kind: 'uri', method: 'GET', uri: '/v1.0/users' } }] })).toThrow(/schema/);
    expect(() => validateMusterE2e({ ...raw, allowed_reverts: [{ objectType: 'users' }] })).toThrow(/schema/);
    validateMusterE2e({ ...raw, drift_injection: [{ description: 'S3 shape', request: { kind: 'uri', method: 'PATCH', uri: '/v1.0/users/user-30', body: { accountEnabled: true } } }], allowed_reverts: [{ objectType: 'caPolicies', objectId: 'x', controls: ['AC.L2-3.1.7'], reason: 'r' }] });
  });

  it('the dry-run plan has E6X, E7A and E7B in the PLAN order, AO commands with --requestor and no secret, and writes nothing', async () => {
    // FIN-19: E8.5b / E8.6b (V112) run inside E7 after E8.6; E7C (V113) after E8F. None is REQUIRED.
    // PH-13 (P13-INT): EL (the AdminOps leaver flow) after E5, before E6; not REQUIRED (V131 judges it).
    expect([...MUSTER_E2E_STEP_IDS]).toEqual(['E0', 'E1', 'E2', 'E3', 'E4', 'E5', 'EL', 'E6', 'E6X', 'E8.5', 'E8.6', 'E8.5b', 'E8.6b', 'E7', 'E7A', 'E7B', 'E8', 'EX', 'E8B', 'E8F', 'E7C', 'E8R', 'E8T', 'E8G', 'E9A', 'E9E', 'E9M', 'E7S', 'AO']);
    expect(REQUIRED_STEPS.some((x) => ['E8.5b', 'E8.6b', 'E7C'].includes(x))).toBe(false);
    expect(REQUIRED_STEPS).toEqual(expect.arrayContaining(['E6X', 'E7A', 'E7B']));
    const ws = await fsp.mkdtemp(path.join(os.tmpdir(), 'mx-w2-dry-'));
    const lines: string[] = [];
    const rec = await runMusterE2e({ scenario: await loadMusterE2eFile(S1), scenarioPath: S1, wsRoot: ws, packageRoot: path.join(ws, 'pkg'), dryRun: true, log: (l) => lines.push(l) });
    const e7a = rec.steps.find((s) => s.id === 'E7A')!;
    const text = e7a.commands.join('\n');
    expect(e7a.title).toContain('A-11 T2 read, A-02 T2 write, A-09 T2 read');
    expect(text).toContain('CES_AO_SIM_ONLY=1');
    expect(text).toContain('CES_AO_PRINCIPAL_SECRET=<run-only>');
    expect(text).toContain('CES_PIPELINE_ROOT=pl CES_TENANT_ROOT=tenants');
    expect(text).toContain('exec A-02 --tenant s1-mach --requestor <resources.operator_upn> --param upn=<resources.offboard_upn>');
    expect(text).toContain('--apply --json; confirming sim read');
    expect(rec.steps.find((s) => s.id === 'E7B')!.commands[0]).toContain('/api/assess?tenant=s1-mach');
    expect(rec.steps.find((s) => s.id === 'E7B')!.commands[0]).not.toContain('forced=1');
    expect(rec.steps.find((s) => s.id === 'E6X')!.commands[0]).toContain('none (scenario drift_injection is empty)');
    expect(rec.steps.find((s) => s.id === 'E8')!.commands[0]).toContain('E7B snapshot');
    // W2 follow-up: EO's AdminOps run window, and the throwaway sim PFX before the AO calls.
    expect(rec.steps.find((s) => s.id === 'E7')!.commands[0]).toContain('CES_EO_ADMINOPS_SINCE=<E1 start>');
    expect(e7a.commands[0]).toMatch(/^throwaway self-signed PFX .* -> out[\\/]ao[\\/]sim[\\/]s1-mach\.pfx; registry record auth\.cert_path -> it$/);
    expect(lines.some((l) => l.startsWith('[E7A]'))).toBe(true);
    expect(JSON.stringify(rec)).not.toContain(ws);
    expect(await fsp.readdir(ws)).toEqual([]);
    await fsp.rm(ws, { recursive: true, force: true });
  });
});

describe('W2 ledger attribution (window list)', () => {
  const windows = {
    E1: { started: '2026-10-28T10:00:00.000Z', ended: '2026-10-28T10:00:09.000Z' },
    E2: { started: '2026-10-28T10:00:10.000Z', ended: '2026-10-28T10:01:00.000Z' },
    E6: { started: '2026-10-28T10:02:00.000Z', ended: '2026-10-28T10:05:00.000Z' },
    E6X: { started: '2026-10-28T10:05:01.000Z', ended: '2026-10-28T10:05:02.000Z' },
    E7A: { started: '2026-10-28T10:09:00.000Z', ended: '2026-10-28T10:10:00.000Z' },
  };
  const w = (ts: string, objectType = 'users', objectId = 'user-7') => ({ ts, type: 'mutate', objectType, objectId, sessionType: 'graph' });
  const base = { build_window: { from: 'E1', before: 'E2' }, no_writes_during: ['E2', 'E6X'], allowed_write_windows: ['E6', 'E7A'], min_writes_during: { E6: 1, E7A: 1 } };

  it('AO writes are allowed in E7A only; a write between E6 and E7A, or in E6X, fails', () => {
    const ok = compareLedger(base, [w('2026-10-28T10:03:00.000Z', 'caPolicies', 'X'), w('2026-10-28T10:09:30.000Z')], windows, 0);
    expect(ok.pass).toBe(true);
    const stray = compareLedger(base, [w('2026-10-28T10:03:00.000Z'), w('2026-10-28T10:07:00.000Z')], windows, 0);
    expect(stray.rows.find((r) => r.check.includes('inside E6 or E7A'))).toMatchObject({ actual: '1 outside', pass: false });
    expect(stray.rows.find((r) => r.check.includes('during E7A'))?.pass).toBe(false);
    const inX = compareLedger(base, [w('2026-10-28T10:03:00.000Z'), w('2026-10-28T10:05:01.500Z'), w('2026-10-28T10:09:30.000Z')], windows, 0);
    expect(inX.rows.find((r) => r.check === 'no non-seed writes during E6X')?.pass).toBe(false);
  });

  it('a listed window that did not run fails; writes_only_during still works as the one-window form', () => {
    const { E7A: _e, ...noE7a } = windows;
    const r = compareLedger(base, [w('2026-10-28T10:03:00.000Z')], noE7a, 0);
    expect(r.rows.find((x) => x.check.includes('inside E6 or E7A'))).toMatchObject({ actual: 'no E7A window', pass: false });
    const one = compareLedger({ writes_only_during: 'E6' }, [w('2026-10-28T10:03:00.000Z')], windows);
    expect(one.rows).toEqual([{ check: 'every non-seed write falls inside E6', expected: '0 outside', actual: '0 outside', pass: true }]);
  });
});

describe('W2 follow-up: per-run isolation of AdminOps evidence (EO run window)', () => {
  it('passes the run start (E1 start) to EO as CES_EO_ADMINOPS_SINCE; refuses a missing or non-ISO start', () => {
    expect(EO_ADMINOPS_SINCE_ENV).toBe('CES_EO_ADMINOPS_SINCE');
    expect(eoAdminOpsWindowEnv('2026-10-28T09:00:00.000Z')).toEqual({ CES_EO_ADMINOPS_SINCE: '2026-10-28T09:00:00.000Z' });
    expect(() => eoAdminOpsWindowEnv(undefined)).toThrow(/E1 has not run/);
    expect(() => eoAdminOpsWindowEnv('not a time')).toThrow(/no run start/);
  });
});

describe('W2 follow-up (run 36): the sim tenant certificate AO checks for', () => {
  it('the PFX lives under <out>/ao/sim/<slug>.pfx', () => {
    expect(simCertPath(path.join('W', 'out'), 's1-mach')).toBe(path.join('W', 'out', 'ao', 'sim', 's1-mach.pfx'));
  });

  it('points the registry record auth.cert_path at the PFX and keeps every other field (the thumbprint too)', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mx-w2-cert-'));
    const f = path.join(dir, 's1-mach.json');
    await fsp.writeFile(f, JSON.stringify({ kind: 'sim', tenant: { tenant_id: 'sim-tenant-s1-mach' }, auth: { app_id: 'sim-app-s1-mach', cert_path: 'sim/s1-mach.pfx', cert_thumbprint: 'SIMTHUMB' }, resources: { operator_upn: OPERATOR } }));
    writeRecordCertPath(f, path.join(dir, 'ao', 'sim', 's1-mach.pfx'));
    const got = JSON.parse(await fsp.readFile(f, 'utf8'));
    expect(got).toEqual({ kind: 'sim', tenant: { tenant_id: 'sim-tenant-s1-mach' }, auth: { app_id: 'sim-app-s1-mach', cert_path: path.join(dir, 'ao', 'sim', 's1-mach.pfx'), cert_thumbprint: 'SIMTHUMB' }, resources: { operator_upn: OPERATOR } });
    await fsp.rm(dir, { recursive: true, force: true });
  });

  it('makes the PFX through one PowerShell call: script encoded, output path and a random password in the child env only, never returned', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mx-w2-pfx-'));
    const pfx = path.join(dir, 'ao', 'sim', 's1-mach.pfx');
    const seen: Array<{ script: string; env: NodeJS.ProcessEnv }> = [];
    const fake = (encoded: string, env: NodeJS.ProcessEnv) => {
      seen.push({ script: Buffer.from(encoded, 'base64').toString('utf16le'), env });
      fs.writeFileSync(env[SIM_PFX_OUT_ENV]!, 'x');
      return { rc: 0, stdout: 'WARNING: a line\r\nABCDEF0123\r\n', stderr: '' };
    };
    const a = makeSimPfx(pfx, fake);
    const b = makeSimPfx(pfx, fake);
    expect(a).toEqual({ path: pfx, thumbprint: 'ABCDEF0123' });
    expect(seen[0]!.script).toBe(SIM_PFX_SCRIPT);
    expect(SIM_PFX_SCRIPT).not.toMatch(/Cert:\\|Import-|New-SelfSignedCertificate/); // no certificate store
    expect(seen[0]!.env[SIM_PFX_OUT_ENV]).toBe(pfx);
    const pw = seen[0]!.env[SIM_PFX_PASSWORD_ENV]!;
    expect(pw).toMatch(/^[0-9a-f]{48}$/);
    expect(seen[1]!.env[SIM_PFX_PASSWORD_ENV]).not.toBe(pw);
    expect(JSON.stringify([a, b])).not.toContain(pw);
    expect(() => makeSimPfx(pfx, () => ({ rc: 1, stdout: '', stderr: 'boom\nmore' }))).toThrow(/sim PFX not made \(rc 1\): boom/);
    expect(() => makeSimPfx(pfx, () => ({ rc: 0, stdout: 'T', stderr: '' }))).toThrow(/sim PFX not made/); // rc 0 but no file
    await fsp.rm(dir, { recursive: true, force: true });
  });

  it.runIf(process.platform === 'win32')('on Windows PowerShell the PFX is a real PKCS#12 that opens with the child\'s password', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mx-w2-pfx-real-'));
    const pfx = path.join(dir, 'ao', 'sim', 's1-mach.pfx');
    let pw = '';
    const r = makeSimPfx(pfx, (encoded, env) => { pw = env[SIM_PFX_PASSWORD_ENV]!; return windowsPowerShellRunner(encoded, env); });
    expect(r.thumbprint).toMatch(/^[0-9A-F]{40}$/);
    expect(() => tls.createSecureContext({ pfx: fs.readFileSync(pfx), passphrase: pw })).not.toThrow();
    expect(() => tls.createSecureContext({ pfx: fs.readFileSync(pfx), passphrase: 'wrong' })).toThrow();
    await fsp.rm(dir, { recursive: true, force: true });
  }, 60_000);
});
