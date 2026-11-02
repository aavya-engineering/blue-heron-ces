// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

// W7-TST (PLAN.md section 3): the break-glass user id mapping, the new E5 discoverers (A-21 leaver workflow, A-10
// standing admin, A-19 CA policies, B-09 app-protection ids), the S1/S2/S3 op lists and expectations, two A-19 T3 runs
// in one list, and E2 receiving the answers file. Fixtures mirror the simulator seeds; every name is fictional.
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AO_SECRET_ENV,
  DISCOVERERS,
  buildAoEnv,
  resolveCheck,
  resourceKeysNamed,
  resourcesFromTm,
  runAoOps,
  type AoCliResult,
  type DiscoverContext,
} from '../src/flow/ao-step.js';
import { runMusterE2e } from '../src/flow/muster-e2e-run.js';
import { loadMusterE2eFile } from '../src/scenarios/musterE2eFile.js';

const DIR = path.resolve('scenarios', 'muster');
const S1 = path.join(DIR, 's1-mach-e2e.json');
const S2 = path.join(DIR, 's2-eng-e2e.json');
const S3 = path.join(DIR, 's3-def-e2e.json');
const GA = '62e90394-69f5-4237-9190-012177145e10';
const SEC_ADMIN = '194ae4cb-b126-40b2-bd5b-6091b380977d';
const DISABLE_TASK = '1dfdfcc7-52fa-4c2e-bf3a-e3919cc12950';
const NOW = Date.parse('2026-10-29T00:00:00Z');

const ctx = (resources: Record<string, string>, joined: DiscoverContext['joined'] = []): DiscoverContext => ({ resources, joined });

/** S1-shaped lifecycle workflows (W7-SIM table): joiner and mover scheduled, the leaver on demand. */
const workflows = (prefix: string) => [
  { id: `${prefix}-001f-4000-8000-000000000001`, category: 'joiner', displayName: 'Joiner - prepare new staff account', isEnabled: true, isSchedulingEnabled: true, tasks: [{ displayName: 'Add user to groups', taskDefinitionId: '22085229-5809-45e8-97fd-270d28d66910', isEnabled: true }] },
  { id: `${prefix}-001f-4000-8000-000000000002`, category: 'mover', displayName: 'Mover - review group access', isEnabled: true, isSchedulingEnabled: true, tasks: [{ displayName: 'Remove user from selected groups', taskDefinitionId: '1953a66c-751c-45e5-8bfe-01462c70da3c', isEnabled: true }] },
  { id: `${prefix}-001f-4000-8000-000000000003`, category: 'leaver', displayName: 'Leaver - disable account and remove access', isEnabled: true, isSchedulingEnabled: false, tasks: [{ displayName: 'Disable user account', taskDefinitionId: DISABLE_TASK, isEnabled: true }, { displayName: 'Remove user from all groups', taskDefinitionId: 'b3a31406-2a15-4c9a-b25b-a658fa5f07fc', isEnabled: true }] },
];

/** S3-shaped roles: the owner (licensed), the operator's admin account, the emergency account (GA), the stale admin (Security Administrator). */
const s3Roles = [
  { id: 'roleAssignment-1', principalId: 'user-1', roleDefinitionId: GA, directoryScopeId: '/' },
  { id: 'roleAssignment-2', principalId: 'user-58', roleDefinitionId: GA, directoryScopeId: '/' },
  { id: 'roleAssignment-3', principalId: 'user-60', roleDefinitionId: GA, directoryScopeId: '/' },
  { id: 'roleAssignment-4', principalId: 'user-59', roleDefinitionId: SEC_ADMIN, directoryScopeId: '/' },
];
const s3Users = [
  { id: 'user-1', userPrincipalName: 'owner.fenwick@s3.simtenant.onmicrosoft.us', accountEnabled: true, assignedLicenses: [{ skuId: 'sim-sku-g3' }] },
  { id: 'user-58', userPrincipalName: 'adm-operator.hollin@s3.simtenant.onmicrosoft.us', accountEnabled: true, assignedLicenses: [] },
  { id: 'user-59', userPrincipalName: 'adm-stale.morrow@s3.simtenant.onmicrosoft.us', accountEnabled: true, assignedLicenses: [] },
  { id: 'user-60', userPrincipalName: 'emergency.access@s3.simtenant.onmicrosoft.us', accountEnabled: true, assignedLicenses: [{ skuId: 'sim-sku-g3' }] },
];
const s3Resources = {
  operator_upn: 'adm-operator.hollin@s3.simtenant.onmicrosoft.us',
  breakglass_upn: 'emergency.access@s3.simtenant.onmicrosoft.us',
  breakglass_user_id: 'user-60',
  approver_upn: 'owner.fenwick@s3.simtenant.onmicrosoft.us',
  global_admin_role_def_id: GA,
};
const s3Policies = [
  { id: 'caPolicy-2', displayName: 'S3-CA02 Require MFA - administrators', state: 'enabledForReportingButNotEnforced', conditions: { users: { includeRoles: [GA], excludeUsers: [] } } },
  { id: 'caPolicy-1', displayName: 'S3-CA01 Require MFA - all users', state: 'enabledForReportingButNotEnforced', conditions: { users: { includeUsers: ['All'], excludeUsers: [] } } },
];

describe('W7-TST: E5 resources', () => {
  it('maps the TM breakGlassUserId to resources.breakglass_user_id with its provenance', () => {
    const r = resourcesFromTm({ breakGlassUserId: 'user-60', breakGlassUPN: 'emergency.access@s3', operator_value_provenance: { values: { breakGlassUserId: 'asked' } } });
    expect(r.resources.breakglass_user_id).toBe('user-60');
    expect(r.provenance.breakglass_user_id).toBe('tm:breakGlassUserId (answered)');
  });

  it('leaver_workflow_id: the enabled leaver with the disable-user-account task, never the mover or joiner', () => {
    const d = DISCOVERERS.leaver_workflow_id!;
    expect(d.request).toEqual({ kind: 'uri', method: 'GET', uri: '/v1.0/identityGovernance/lifecycleWorkflows/workflows' });
    expect(d.pick(workflows('51510000'), NOW)).toBe('51510000-001f-4000-8000-000000000003');
    expect(d.pick(workflows('52520000'), NOW)).toBe('52520000-001f-4000-8000-000000000003');
    // by task name when the id is not the built-in one; a delete task also qualifies (AO's and EO's rule)
    const byName = [{ id: 'wf-b', category: 'leaver', isEnabled: true, tasks: [{ displayName: 'Delete User Account', taskDefinitionId: 'x', isEnabled: true }] }];
    expect(d.pick(byName, NOW)).toBe('wf-b');
  });

  it('leaver_workflow_id fails loudly when no qualifying leaver exists (S3: no workflows; disabled leaver; no removal task)', () => {
    const d = DISCOVERERS.leaver_workflow_id!;
    expect(() => d.pick([], NOW)).toThrow(/leaver_workflow_id: .*A-21 cannot be bound/);
    const wf = workflows('51510000');
    expect(() => d.pick([{ ...wf[2]!, isEnabled: false }], NOW)).toThrow(/leaver_workflow_id/);
    expect(() => d.pick([{ ...wf[2]!, tasks: [{ displayName: 'Remove user from all groups', taskDefinitionId: 'b3a31406-2a15-4c9a-b25b-a658fa5f07fc', isEnabled: true }] }], NOW)).toThrow(/leaver_workflow_id/);
    expect(() => d.pick([{ ...wf[2]!, tasks: [{ displayName: 'Disable user account', taskDefinitionId: DISABLE_TASK, isEnabled: false }] }], NOW)).toThrow(/leaver_workflow_id/);
  });

  it('standing_admin_id / _upn: the enabled, licensed standing GA that is neither break-glass nor the operator (S3: the owner)', () => {
    for (const k of ['standing_admin_id', 'standing_admin_upn']) {
      expect(DISCOVERERS[k]!.request).toEqual({ kind: 'uri', method: 'GET', uri: '/v1.0/roleManagement/directory/roleAssignments' });
      expect(DISCOVERERS[k]!.joins).toEqual([{ kind: 'uri', method: 'GET', uri: '/v1.0/users' }]);
    }
    const c = ctx(s3Resources, [s3Users]);
    expect(DISCOVERERS.standing_admin_id!.pick(s3Roles, NOW, c)).toBe('user-1');
    expect(DISCOVERERS.standing_admin_upn!.pick(s3Roles, NOW, c)).toBe('owner.fenwick@s3.simtenant.onmicrosoft.us');
    // a disabled or unlicensed owner is not chosen; neither is anyone when only the operator and break-glass hold GA
    const off = ctx(s3Resources, [s3Users.map((u) => (u.id === 'user-1' ? { ...u, accountEnabled: false } : u))]);
    expect(DISCOVERERS.standing_admin_id!.pick(s3Roles, NOW, off)).toBeUndefined();
    const unlicensed = ctx(s3Resources, [s3Users.map((u) => (u.id === 'user-1' ? { ...u, assignedLicenses: [] } : u))]);
    expect(DISCOVERERS.standing_admin_upn!.pick(s3Roles, NOW, unlicensed)).toBeUndefined();
    // the break-glass account is excluded by UPN too, when the TM gives no id
    const { breakglass_user_id: _drop, ...noBgId } = s3Resources;
    expect(DISCOVERERS.standing_admin_id!.pick(s3Roles, NOW, ctx(noBgId, [s3Users]))).toBe('user-1');
    // without the users read nothing qualifies
    expect(DISCOVERERS.standing_admin_id!.pick(s3Roles, NOW, ctx(s3Resources))).toBeUndefined();
  });

  it('breakglass_ca_policy_1 / _2: the two customer CA policies lacking the break-glass exclusion, by displayName', () => {
    const c = ctx(s3Resources);
    expect(DISCOVERERS.breakglass_ca_policy_1!.pick(s3Policies, NOW, c)).toBe('S3-CA01 Require MFA - all users');
    expect(DISCOVERERS.breakglass_ca_policy_2!.pick(s3Policies, NOW, c)).toBe('S3-CA02 Require MFA - administrators');
    // a CMMC- policy and an already-excluding policy are skipped
    const rows = [
      { id: 'CMMC-SessionTimeout', displayName: 'CMMC-SessionTimeout', conditions: { users: { excludeUsers: [] } } },
      { ...s3Policies[1]!, conditions: { users: { includeUsers: ['All'], excludeUsers: ['user-60'] } } },
      s3Policies[0]!,
    ];
    expect(DISCOVERERS.breakglass_ca_policy_1!.pick(rows, NOW, c)).toBe('S3-CA02 Require MFA - administrators');
    expect(DISCOVERERS.breakglass_ca_policy_2!.pick(rows, NOW, c)).toBeUndefined();
    // no break-glass id on the record: undecidable, so nothing is bound
    expect(DISCOVERERS.breakglass_ca_policy_1!.pick(s3Policies, NOW, ctx({}))).toBeUndefined();
  });

  it('android_ / ios_app_protection_policy_id: the customer policy id of each list (S2), never a CMMC- one', () => {
    expect(DISCOVERERS.android_app_protection_policy_id!.request).toEqual({ kind: 'uri', method: 'GET', uri: '/v1.0/deviceAppManagement/androidManagedAppProtections' });
    expect(DISCOVERERS.ios_app_protection_policy_id!.request).toEqual({ kind: 'uri', method: 'GET', uri: '/v1.0/deviceAppManagement/iosManagedAppProtections' });
    expect(DISCOVERERS.android_app_protection_policy_id!.pick([{ id: 'androidManagedAppProtection-1', displayName: 'S2 Android work apps' }], NOW)).toBe('androidManagedAppProtection-1');
    expect(DISCOVERERS.ios_app_protection_policy_id!.pick([{ id: 'a-cmmc', displayName: 'CMMC-iOS-MAM' }, { id: 'iosManagedAppProtection-1', displayName: 'S2 iPhone work apps' }], NOW)).toBe('iosManagedAppProtection-1');
    expect(DISCOVERERS.ios_app_protection_policy_id!.pick([], NOW)).toBeUndefined();
  });
});

describe('W7-TST: scenario ops and expectations', () => {
  it('S1: + A-21 (T2 write, confirm isSchedulingEnabled true); PS.L2-3.9.2 expected; the leaver workflow in mutated; coverage 96', async () => {
    const s = await loadMusterE2eFile(S1);
    const a21 = s.adminops_ops!.find((o) => o.op === 'A-21')!;
    expect(a21).toMatchObject({ tier: 'T2', kind: 'write', params: { leaverWorkflowId: 'resources.leaver_workflow_id' } });
    expect(a21.confirm).toMatchObject({ request: { kind: 'uri', method: 'GET', uri: '/v1.0/identityGovernance/lifecycleWorkflows/workflows/{resources.leaver_workflow_id}' }, path: 'isSchedulingEnabled', assert: 'equals', value: true });
    // honest drop: records outrank A-21 (founder 2026-10-31); PH-13 (P13-INT): still so after EL's A-22, because EO's
    // personnel store decides PS.L2-3.9.2 from the customer's lifecycle records, which no tenant write changes.
    expect(s.expected_improvements).toEqual([]);
    expect(s.expected_ledger.mutated).toContainEqual({ objectType: 'lifecycleWorkflows', objectId: '51510000-001f-4000-8000-000000000003' });
    expect(s.ao_coverage).toEqual({ enabled: true, expected_total: 96 });
    expect(resourceKeysNamed(s.adminops_ops!)).toEqual(['leaver_workflow_id', 'offboard_upn']);
  });

  it('S2: + A-21 and B-09 (both policy ids named, Android confirm); PS.L2-3.9.2 expected; three new mutated rows; coverage 96', async () => {
    const s = await loadMusterE2eFile(S2);
    expect(s.adminops_ops!.map((o) => `${o.op}:${o.tier}:${o.kind}`)).toEqual(['A-11:T2:read', 'A-02:T2:write', 'A-09:T2:read', 'A-21:T2:write', 'B-09:T2:write']);
    const b09 = s.adminops_ops!.find((o) => o.op === 'B-09')!;
    expect(b09.params).toEqual({ appProtectionPolicyId: 'resources.android_app_protection_policy_id', iosAppProtectionPolicyId: 'resources.ios_app_protection_policy_id' });
    expect(b09.confirm).toMatchObject({ select: { field: 'id', equals: '{resources.android_app_protection_policy_id}' }, path: 'dataBackupBlocked', value: true });
    expect(s.expected_improvements!.map((i) => `${i.controlId}:${i.op}`)).toEqual([]); // honest drop (PH-13: unchanged by EL, as S1)
    expect(s.expected_ledger.mutated).toEqual(expect.arrayContaining([
      { objectType: 'lifecycleWorkflows', objectId: '52520000-001f-4000-8000-000000000003' },
      { objectType: 'androidManagedAppProtections' },
      { objectType: 'iosManagedAppProtections' },
    ]));
    expect(s.ao_coverage!.expected_total).toBe(96);
    expect(resourceKeysNamed(s.adminops_ops!)).toEqual(['android_app_protection_policy_id', 'ios_app_protection_policy_id', 'leaver_workflow_id', 'offboard_upn']);
  });

  it('S3: + A-10 (T2) and A-19 twice (T3); unsourced params bound from resources.*; IA.L2-3.5.6 and AC.L2-3.1.7 (observed at W7 R1) expected; mutated rows; coverage 96', async () => {
    const s = await loadMusterE2eFile(S3);
    expect(s.adminops_ops!.map((o) => `${o.op}:${o.tier}:${o.kind}`)).toEqual(['A-11:T2:read', 'A-02:T2:write', 'B-03:T2:read', 'A-10:T2:write', 'A-19:T3:write', 'A-19:T3:write']);
    const [a10, a19a, a19b] = s.adminops_ops!.slice(3);
    expect(a10!.params).toEqual({ targetUPN: 'resources.standing_admin_upn' });
    expect(a10!.confirm).toMatchObject({ request: { uri: '/v1.0/roleManagement/directory/roleEligibilitySchedules' }, select: { field: 'principalId', equals: '{resources.standing_admin_id}' }, path: 'status', value: 'Provisioned' });
    expect(a19a!.params).toEqual({ policyDisplayName: 'resources.breakglass_ca_policy_1' });
    expect(a19b!.params).toEqual({ policyDisplayName: 'resources.breakglass_ca_policy_2' });
    for (const [o, n] of [[a19a!, 1], [a19b!, 2]] as const) {
      expect(o.confirm).toMatchObject({ select: { field: 'displayName', equals: `{resources.breakglass_ca_policy_${n}}` }, path: 'conditions.users.excludeUsers', assert: 'includes', value: '{resources.breakglass_user_id}' });
    }
    expect(s.expected_improvements!.map((i) => i.controlId)).toEqual(['IA.L2-3.5.6', 'AC.L2-3.1.7']);
    expect(s.expected_ledger.mutated).toEqual(expect.arrayContaining([
      { objectType: 'roleEligibilityScheduleRequests' },
      { objectType: 'roleAssignments' },
      { objectType: 'caPolicies', objectId: 'caPolicy-1' },
      { objectType: 'caPolicies', objectId: 'caPolicy-2' },
    ]));
    expect(s.ao_coverage!.expected_total).toBe(96);
    expect(resourceKeysNamed(s.adminops_ops!)).toEqual(['breakglass_ca_policy_1', 'breakglass_ca_policy_2', 'breakglass_user_id', 'offboard_upn', 'standing_admin_id', 'standing_admin_upn']);
    // the confirm value substitutes from the record (includes against the excludeUsers array)
    const rec = { resources: { ...s3Resources, breakglass_ca_policy_1: 'S3-CA01 Require MFA - all users' } };
    expect(resolveCheck(a19a!.confirm!, rec)).toMatchObject({ select: { equals: 'S3-CA01 Require MFA - all users' }, value: 'user-60' });
  });
});

describe('W7-TST: two A-19 T3 runs in one list', () => {
  it('two-person ON: each run is requested, approved by the second principal and applied with its own policyDisplayName', async () => {
    const calls: Array<{ args: string[]; label: string }> = [];
    let n = 0;
    const ok = (o: unknown): AoCliResult => ({ rc: 0, stdout: `${JSON.stringify(o, null, 2)}\n`, stderr: '' });
    const run = async (args: string[], _env: NodeJS.ProcessEnv, label: string): Promise<AoCliResult> => {
      calls.push({ args, label });
      n++;
      if (args[0] === 'approve') return { rc: 0, stdout: `APPROVED ${args[1]}\n`, stderr: '' };
      if (!args.includes('--approval')) return ok({ success: false, status: 'pending_approval', approvalId: `appr-${n}`, evidencePersisted: true, evidencePath: `adminops_evidence/A-19:p${n}` });
      return ok({ success: true, evidence: { outcome: 'automated_success', complianceVerdict: 'SAT', metadata: { mode: 'live' } }, evidencePersisted: true, evidencePath: `adminops_evidence/A-19:e${n}` });
    };
    const s = await loadMusterE2eFile(S3);
    const ops = s.adminops_ops!.filter((o) => o.op === 'A-19');
    const record = { tenant: { tenant_id: 'sim-tenant-s3-def' }, resources: { ...s3Resources, breakglass_ca_policy_1: 'S3-CA01 Require MFA - all users', breakglass_ca_policy_2: 'S3-CA02 Require MFA - administrators' } };
    const env = buildAoEnv({ CES_TWO_PERSON_APPROVAL: '1' }, { pipelineRoot: 'pl', tenantRoot: 'tenants', simUrl: 'http://127.0.0.1:4390', secret: 'w7-tst-principal-secret-0123456789' });
    expect(env[AO_SECRET_ENV]).toBeDefined();
    const seen: string[] = [];
    const r = await runAoOps({ ops, slug: 's3-def', record, provenance: { breakglass_ca_policy_1: 'discovered (x)', breakglass_ca_policy_2: 'discovered (x)' }, env, runCli: run, confirm: async (c) => { seen.push(c.select!.equals); return { pass: true }; } });
    expect(r.ok).toBe(true);
    expect(r.approver_upn).not.toBe(r.requestor_upn);
    expect(calls.map((c) => c.label)).toEqual(['A-19-request', 'A-19-approve', 'A-19-apply', 'A-19-request', 'A-19-approve', 'A-19-apply']);
    expect(calls[0]!.args).toContain('policyDisplayName=S3-CA01 Require MFA - all users');
    expect(calls[3]!.args).toContain('policyDisplayName=S3-CA02 Require MFA - administrators');
    expect(calls[2]!.args).toEqual(expect.arrayContaining(['--approval', 'appr-1', '--apply']));
    expect(calls[5]!.args).toEqual(expect.arrayContaining(['--approval', 'appr-4', '--apply']));
    expect(seen).toEqual(['S3-CA01 Require MFA - all users', 'S3-CA02 Require MFA - administrators']);
  });

  it('W9-C1: two-person OFF (the default): each run is a dry run then an apply, with no approval and no approver', async () => {
    const calls: Array<{ args: string[]; label: string }> = [];
    let n = 0;
    const ok = (o: unknown): AoCliResult => ({ rc: 0, stdout: `${JSON.stringify(o, null, 2)}\n`, stderr: '' });
    const run = async (args: string[], _env: NodeJS.ProcessEnv, label: string): Promise<AoCliResult> => {
      calls.push({ args, label });
      n++;
      const apply = args.includes('--apply');
      return ok({ success: true, evidence: { outcome: apply ? 'automated_success' : 'dry_run', complianceVerdict: apply ? 'SAT' : 'NOT_APPLICABLE', metadata: { mode: apply ? 'live' : 'dry_run', twoPersonApproval: { mode: 'off', tierRequired: true } } }, evidencePersisted: true, evidencePath: `adminops_evidence/A-19:e${n}` });
    };
    const s = await loadMusterE2eFile(S3);
    const ops = s.adminops_ops!.filter((o) => o.op === 'A-19');
    const record = { tenant: { tenant_id: 'sim-tenant-s3-def' }, resources: { ...s3Resources, breakglass_ca_policy_1: 'S3-CA01 Require MFA - all users', breakglass_ca_policy_2: 'S3-CA02 Require MFA - administrators' } };
    const env = buildAoEnv({}, { pipelineRoot: 'pl', tenantRoot: 'tenants', simUrl: 'http://127.0.0.1:4390', secret: 'w7-tst-principal-secret-0123456789' });
    const r = await runAoOps({ ops, slug: 's3-def', record, provenance: { breakglass_ca_policy_1: 'discovered (x)', breakglass_ca_policy_2: 'discovered (x)' }, env, runCli: run, confirm: async () => ({ pass: true }) });
    expect(r.ok).toBe(true);
    expect(r).toMatchObject({ two_person_approval: 'off', approver_upn: null });
    expect(calls.map((c) => c.label)).toEqual(['A-19-dry_run', 'A-19-apply', 'A-19-dry_run', 'A-19-apply']);
    expect(calls.some((c) => c.args.includes('--approval') || c.args[0] === 'approve')).toBe(false);
    expect(r.ops.map((o) => o.calls.map((c) => `${c.call}:${c.two_person_mode}`))).toEqual([['dry_run:off', 'apply:off'], ['dry_run:off', 'apply:off']]);
  });

  it('W9-C1: the S3 dry-run E7A text follows the switch (OFF: dry run then apply; ON: approve <id>)', async () => {
    const prev = process.env.CES_TWO_PERSON_APPROVAL;
    const a19Line = async (): Promise<string> => {
      const ws = await fsp.mkdtemp(path.join(os.tmpdir(), 'mx-2ph-dry-'));
      const rec = await runMusterE2e({ scenario: await loadMusterE2eFile(S3), scenarioPath: S3, wsRoot: ws, packageRoot: path.join(ws, 'pkg'), dryRun: true, log: () => undefined });
      await fsp.rm(ws, { recursive: true, force: true });
      return rec.steps.find((s) => s.id === 'E7A')!.commands.find((c) => c.includes('exec A-19'))!;
    };
    try {
      delete process.env.CES_TWO_PERSON_APPROVAL;
      const off = await a19Line();
      expect(off).toContain('--apply --json; confirming sim read (two-person approval OFF; CES_TWO_PERSON_APPROVAL=1 turns it on)');
      expect(off).not.toContain('approve <id>');
      process.env.CES_TWO_PERSON_APPROVAL = '1';
      const on = await a19Line();
      expect(on).toContain('approve <id>');
      expect(on).toContain('--approval <id> --apply --json');
    } finally {
      if (prev === undefined) delete process.env.CES_TWO_PERSON_APPROVAL;
      else process.env.CES_TWO_PERSON_APPROVAL = prev;
    }
  });
});

describe('W7-TST: E2 receives the answers file', () => {
  it('the dry-run E2 command names --answers (when present) and the E3 MX_ANSWERS rule is unchanged', async () => {
    const ws = await fsp.mkdtemp(path.join(os.tmpdir(), 'mx-w7tst-dry-'));
    const rec = await runMusterE2e({ scenario: await loadMusterE2eFile(S1), scenarioPath: S1, wsRoot: ws, packageRoot: path.join(ws, 'pkg'), dryRun: true, log: () => undefined });
    const e2 = rec.steps.find((s) => s.id === 'E2')!.commands[0]!;
    expect(e2).toContain('discovery --sim --slug s1-mach');
    expect(e2).toMatch(/\[--answers pkg[\\/]customers[\\/]s1-mach[\\/]interview-answers\.json when present\]$/);
    expect(JSON.stringify(rec)).not.toContain(ws);
    expect(await fsp.readdir(ws)).toEqual([]);
    await fsp.rm(ws, { recursive: true, force: true });
  });
});
