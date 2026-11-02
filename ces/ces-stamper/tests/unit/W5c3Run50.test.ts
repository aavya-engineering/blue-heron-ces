// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// synthetic-customer W5 cycle 3, run 50 fixes.
// (1) The lookup blocks carry each entry's full effect (scope, grant, state, session, object type), so
//     CES's own object from another entry is never an "equivalent" (run 50: remote-mfa took
//     CMMC-AdminMFA-PhishingResistant). (2) CM.L2-3.4.1.compliance-policy-windows creates and assigns
//     the Windows compliance policy, or verifies a tenant's own assigned policy with the same settings.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { CommandRegistry } from '../../src/registry/CommandRegistry';
import { selectLookupMatch, verifyEquivalent, lookupGetCommand } from '../../src/registry/lookup';
import { applyOrganisationValues, existingStateCriteria } from '../../src/translators/orgValues';
import { OutputVerificationEngine } from '../../src/core/OutputVerificationEngine';
import { PowerShellAdapter } from '../../src/adapters/PowerShellAdapter';
import { StamperConfig } from '../../src/config/StamperConfig';
import { ExecutionContext } from '../../src/core/ExecutionContext';
import { evidenceDirForTenant, evidenceFileForEntry, taskEvidencePath } from '../../src/core/EvidenceReadinessAnalyzer';
import type { ExeTask, LookupBlock, SubCommand } from '../../src/types/schema.types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const registry = CommandRegistry.load(path.resolve(__dirname, '../../src/registry/cmmc-l2-commands.registry.json'));
const byId = (id: string) => registry.allEntries.find(e => e.entry_id === id)!;
const READS = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../fixtures/w3-state-reads.json'), 'utf-8')).reads as Record<string, string>;
const read = (id: string) => JSON.parse(READS[id]);
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const VARS: Record<string, string> = {
  cuiGroupId: 'group-1', wifiSsid: 'S1-MACH-CORP', phishingResistantStrengthId: 'authenticationStrengthPolicy-2',
  // W5c5: the policy names the Exchange policy entries capture (CES's own here), the domain, the operator, the vault
  primaryDomain: 's1-mach.simtenant.onmicrosoft.us', adminUserName: 'sim.admin', keyVaultName: 's1mach-kv-prod', resourceGroup: 'rg-s1-mach-prod',
  malwarePolicyName: 'CMMC-Malware', safeLinksPolicyName: 'CMMC-SafeLinks', safeAttachPolicyName: 'CMMC-SafeAttach',
  antiPhishPolicyName: 'CMMC-AntiPhish', antiSpamPolicyName: 'CMMC-AntiSpam', outboundSpamPolicyName: 'CMMC-OutboundSpam',
};
const resolve = (s: string) => s.replace(/\{(\w+)\}/g, (m, k) => VARS[k] ?? m);
const COMPLIANCE = 'CM.L2-3.4.1.compliance-policy-windows';

const PIPELINE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'stamper-run50-'));
const savedRoot = process.env.CES_PIPELINE_ROOT;
beforeAll(() => { process.env.CES_PIPELINE_ROOT = PIPELINE_ROOT; });
afterAll(() => {
  if (savedRoot === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = savedRoot;
  fs.rmSync(PIPELINE_ROOT, { recursive: true, force: true });
});

// ---- every CMMC-* object a run creates, by source collection (read back as the SET writes it) ----
const REMOTE_MFA = {
  id: 'CMMC-RemoteMaintenance-MFA', displayName: 'CMMC-RemoteMaintenance-MFA', state: 'enabledForReportingButNotEnforced',
  conditions: { applications: { includeApplications: ['All'] }, users: { includeRoles: ['62e90394-69f5-4237-9190-012177145e10', '194ae4cb-b126-40b2-bd5b-6091b380977d'], excludeUsers: ['user-5'] }, locations: { includeLocations: ['All'], excludeLocations: ['AllTrusted'] } },
  grantControls: { operator: 'OR', builtInControls: ['mfa'] },
};
const CES_CA = [read('AC.L2-3.1.11.session-timeout'), read('AC.L2-3.1.14.block-untrusted'), read('AC.L2-3.1.15.admin-mfa'), REMOTE_MFA, read('AC.L2-3.1.18.mobile-ca'), read('IA.L2-3.5.10.block-legacy-auth'), read('AC.L1-3.1.1.ca-mfa-compliant-device')]; // W5c7: + MFA AND compliant device
const CES_DC = ['AC.L2-3.1.10.screen-lock', 'AC.L2-3.1.16.wifi-profile', 'AC.L2-3.1.21.block-storage', 'CM.L2-3.4.6.least-functionality', 'CM.L2-3.4.7.wdac', 'CM.L2-3.4.9.install-control', 'MA.L2-3.7.1.update-ring', 'MP.L2-3.8.6.bitlocker', 'SC.L2-3.13.12.camera-block', 'SI.L1-3.14.5.scan-schedule-evidence'].map(read);
const CES_CP = [read(COMPLIANCE)];
const CES_STRENGTH = [read('IA.L2-3.5.4.auth-strength')];
// W5c5: Exchange policy / rule lookups (one collection per cmdlet), the admin-account users read, the key vault read.
const EXO = registry.allEntries.filter(e => e.lookup && /^Get-(MalwareFilter|SafeLinks|SafeAttachment|AntiPhish|HostedContentFilter|HostedOutboundSpamFilter)/.test(e.lookup.source));
const CES_EXO: Record<string, any[]> = {};
for (const e of EXO) (CES_EXO[e.lookup!.source] ??= []).push(read(e.entry_id));
const CES_USERS = [read('AC.L2-3.1.6.admin-account')];
const CES_KV = [read('SC.L2-3.13.10.key-vault')];
// W5c7: the settings-catalog policies as the time-sync GET projects them (CES's time-sync policy; the firewall policy projected: no NTP settings)
const CES_SC = [read('AU.L2-3.3.7.time-sync'), { id: 'configurationPolicy-1', name: 'CMMC-Firewall-Policy', platforms: 'windows10', ntpClientEnabled: false, ntpConfigured: false, timeServer: null, ntpType: '', pollInterval: null, assignments: [{ id: 'a', target: { groupId: 'group-1' } }] }];
// W7-ST: the lifecycle-workflow GET emits one inventory object (the name the lookup selects)
const CES_LCW = [{ displayName: 'CES lifecycle workflow inventory', workflowCount: 0, qualifyingLeaverWorkflowCount: 0, qualifyingLeaverWorkflowIds: [], workflows: [] }];
// PH-13 (P13-LV, P13-INT): the past-leaver GET emits one inventory object (the name the lookup selects)
const CES_LEAVER = [{ displayName: 'CES leaver access inventory', pastLeaverCount: 2, enabledPastLeaverCount: 0, licensedPastLeaverCount: 0, enabledPastLeavers: [], licensedPastLeavers: [] }];
const collectionOf = (l: LookupBlock) =>
  CES_EXO[l.source] ? CES_EXO[l.source]
    : /lifecycleWorkflows/.test(l.source) ? CES_LCW
    : /employeeLeaveDateTime/.test(l.source) ? CES_LEAVER
    : /roleEligibilitySchedules/.test(l.source) ? CES_USERS
    : /Get-AzKeyVault/.test(l.source) ? CES_KV
    : /configurationPolicies/.test(l.source) ? CES_SC
    : /conditionalAccess/.test(l.source) ? CES_CA : /deviceConfigurations/.test(l.source) ? CES_DC : /deviceCompliancePolicies/.test(l.source) ? CES_CP : CES_STRENGTH;
const LOOKUPS = registry.allEntries.filter(e => e.lookup);
const nameOf = (o: any) => o?.displayName ?? o?.DisplayName ?? o?.Name ?? o?.VaultName ?? o?.name; // W5c7: settings catalog = name

describe('run 50 (1): CES objects from other entries never match', () => {
  it('34 lookup blocks (15 of part 2, the compliance policy, W5c5: 12 Exchange, admin-account, key vault; W5c7: MFA AND compliant device, time sync; W7-ST: leaver workflow; PH-13: leaver access inventory)', () => {
    expect(LOOKUPS).toHaveLength(34);
  });

  for (const e of LOOKUPS) {
    it(`${e.entry_id}: on a tenant holding every CMMC-* object it finds only its own; without its own, nothing`, () => {
      const list = collectionOf(e.lookup!);
      const own = resolve(e.lookup!.by_name.equals); // W5c5: names may carry a variable
      expect(list.some(o => nameOf(o) === own)).toBe(true);
      expect(nameOf(selectLookupMatch(list, e.lookup!, resolve))).toBe(own);
      const others = list.filter(o => nameOf(o) !== own);
      expect([e.entry_id, nameOf(selectLookupMatch(others, e.lookup!, resolve))]).toEqual([e.entry_id, undefined]);
    });
    it(`${e.entry_id}: get_command is generated from the tightened block`, () => {
      expect(e.get_command).toBe(lookupGetCommand(e.lookup!));
    });
  }

  it('the run-50 defect: remote-maintenance MFA does not take the admin phishing-resistant policy', () => {
    expect(selectLookupMatch([read('AC.L2-3.1.15.admin-mfa')], byId('MA.L2-3.7.5.remote-mfa').lookup!, resolve)).toBeUndefined();
  });

  it('the Intune lookups pin the object type', () => {
    for (const id of ['AC.L2-3.1.10.screen-lock', 'AC.L2-3.1.16.wifi-profile', 'AC.L2-3.1.21.block-storage', 'CM.L2-3.4.7.wdac', 'CM.L2-3.4.9.install-control', 'MA.L2-3.7.1.update-ring', 'RA.L2-3.11.3.vuln-remediation', 'MP.L2-3.8.6.bitlocker', 'SC.L2-3.13.12.camera-block', 'SI.L1-3.14.5.scan-schedule-evidence', COMPLIANCE]) {
      expect([id, byId(id).lookup!.odata_type !== undefined]).toEqual([id, true]);
      expect(byId(id).get_command).toContain("-contains $_.'@odata.type'");
    }
    const usb = read('AC.L2-3.1.21.block-storage');
    expect(selectLookupMatch([{ ...usb, displayName: 'X', '@odata.type': '#microsoft.graph.windows10EndpointProtectionConfiguration' }], byId('AC.L2-3.1.21.block-storage').lookup!, resolve)).toBeUndefined();
  });
});

// ---- S1's own objects (fictional, the simulator's s1-mach seed shapes) ----
const S1_USERS = { includeUsers: ['All'], excludeUsers: ['user-50', 'user-51'], excludeGroups: ['group-12'] };
const S1_CA = [
  { id: 'caPolicy-1', displayName: 'S1-CA01 Require MFA - all users', state: 'enabled', conditions: { users: S1_USERS, applications: { includeApplications: ['All'] } }, grantControls: { operator: 'OR', builtInControls: ['mfa'] } },
  { id: 'caPolicy-2', displayName: 'S1-CA02 Phishing-resistant MFA - admin roles', state: 'enabled', conditions: { users: { includeUsers: [], includeRoles: ['62e90394-69f5-4237-9190-012177145e10'], excludeUsers: ['user-50', 'user-51'], excludeGroups: ['group-12'] }, applications: { includeApplications: ['All'] } }, grantControls: { operator: 'OR', builtInControls: [], authenticationStrength: { id: '00000000-0000-0000-0000-000000000004' } } },
  { id: 'caPolicy-3', displayName: 'S1-CA03 Block legacy authentication', state: 'enabled', conditions: { users: S1_USERS, applications: { includeApplications: ['All'] }, clientAppTypes: ['exchangeActiveSync', 'other'] }, grantControls: { operator: 'OR', builtInControls: ['block'] } },
  { id: 'caPolicy-4', displayName: 'S1-CA04 Require compliant device - CUI enclave', state: 'enabled', conditions: { users: { includeUsers: [], includeGroups: ['group-1'] }, applications: { includeApplications: ['Office365'] } }, grantControls: { operator: 'OR', builtInControls: ['compliantDevice'] } },
  { id: 'caPolicy-5', displayName: 'S1-CA05 Require compliant device - all apps', state: 'enabled', conditions: { users: S1_USERS, applications: { includeApplications: ['All'] }, platforms: { includePlatforms: ['windows', 'iOS'] } }, grantControls: { operator: 'OR', builtInControls: ['compliantDevice'] } },
  { id: 'caPolicy-6', displayName: 'S1-CA06 Block sign-in from outside US', state: 'enabled', conditions: { users: S1_USERS, applications: { includeApplications: ['All'] }, locations: { includeLocations: ['All'], excludeLocations: ['51510000-00b1-4000-8000-000000000001'] } }, grantControls: { operator: 'OR', builtInControls: ['block'] } },
  { id: 'caPolicy-7', displayName: 'S1-CA07 Sign-in risk high - block', state: 'enabled', conditions: { users: S1_USERS, applications: { includeApplications: ['All'] }, signInRiskLevels: ['high'] }, grantControls: { operator: 'OR', builtInControls: ['block'] } },
  { id: 'caPolicy-8', displayName: 'S1-CA08 Admin portals - compliant device and MFA', state: 'enabled', conditions: { users: S1_USERS, applications: { includeApplications: ['MicrosoftAdminPortals'] } }, grantControls: { operator: 'AND', builtInControls: ['mfa', 'compliantDevice'] } },
  { id: 'caPolicy-9', displayName: 'S1-CA09 Session lifetime 12h - browser', state: 'enabled', conditions: { users: S1_USERS, applications: { includeApplications: ['All'] }, clientAppTypes: ['browser'] }, sessionControls: { signInFrequency: { value: 12, type: 'hours', isEnabled: true }, persistentBrowser: { mode: 'never', isEnabled: true } } },
];
const ASSIGNED = [{ id: 'a', target: { '@odata.type': '#microsoft.graph.groupAssignmentTarget', groupId: 'group-1' } }];
const s1Compliance = (name: string, n: number) => ({
  id: `deviceCompliancePolicy-${n}`, '@odata.type': '#microsoft.graph.windows10CompliancePolicy', displayName: name, platformType: 'windows10',
  passwordRequired: true, passwordBlockSimple: true, passwordMinimumLength: 14, passwordRequiredType: 'alphanumeric', passwordMinutesOfInactivityBeforeLock: 15,
  passwordPreviousPasswordBlockCount: 24, osMinimumVersion: '10.0.22631', bitLockerEnabled: true, secureBootEnabled: true, codeIntegrityEnabled: true,
  storageRequireEncryption: true, tpmRequired: true, defenderEnabled: true, rtpEnabled: true, antivirusRequired: true, antiSpywareRequired: true, assignments: ASSIGNED,
});
const S1_CP = [
  s1Compliance('S1 Windows 11 staff and kiosk compliance', 1),
  s1Compliance('S1 Windows 11 programming workstation compliance', 2),
  { id: 'deviceCompliancePolicy-s1-ios', '@odata.type': '#microsoft.graph.iosCompliancePolicy', displayName: 'S1 iOS compliance', passcodeRequired: true, assignments: ASSIGNED },
];
const found = (id: string, list: object[]) => nameOf(selectLookupMatch(list, byId(id).lookup!, resolve));

describe('run 50 (1): S1 equivalents after tightening', () => {
  it('still match: S1-CA02 (admin MFA), S1-CA06 (untrusted locations), S1-CA01 (remote-maintenance MFA)', () => {
    expect(found('AC.L2-3.1.15.admin-mfa', S1_CA)).toBe('S1-CA02 Phishing-resistant MFA - admin roles');
    expect(found('AC.L2-3.1.14.block-untrusted', S1_CA)).toBe('S1-CA06 Block sign-in from outside US');
    expect(found('MA.L2-3.7.5.remote-mfa', S1_CA)).toBe('S1-CA01 Require MFA - all users');
  });
  it('remote-maintenance MFA: S1-CA08 (admin portals only) and S1-CA05 (compliant device) are not equivalents', () => {
    expect(found('MA.L2-3.7.5.remote-mfa', S1_CA.filter(p => p.id !== 'caPolicy-1'))).toBeUndefined();
  });
  it('session timeout: nothing on S1 (S1-CA09 is 12 h and browser only)', () => {
    expect(found('AC.L2-3.1.11.session-timeout', S1_CA)).toBeUndefined();
  });
  it('a risk-scoped or OR-mixed MFA policy is not a remote-maintenance equivalent', () => {
    const risky = { ...clone(S1_CA[0]), displayName: 'risk MFA' }; (risky.conditions as any).signInRiskLevels = ['medium'];
    const either = { ...clone(S1_CA[0]), displayName: 'mfa or compliant' }; (either.grantControls as any).builtInControls = ['mfa', 'compliantDevice'];
    expect(found('MA.L2-3.7.5.remote-mfa', [risky, either])).toBeUndefined();
    (either.grantControls as any).operator = 'AND';
    expect(found('MA.L2-3.7.5.remote-mfa', [either])).toBe('mfa or compliant');
  });
  it('Windows compliance: the first S1 Windows policy is the equivalent; the iOS policy never is; unassigned is not', () => {
    expect(found(COMPLIANCE, S1_CP)).toBe('S1 Windows 11 staff and kiosk compliance');
    expect(found(COMPLIANCE, [S1_CP[2]])).toBeUndefined();
    expect(found(COMPLIANCE, [{ ...S1_CP[0], assignments: [] }])).toBeUndefined();
    expect(found(COMPLIANCE, [{ ...S1_CP[0], bitLockerEnabled: false }])).toBeUndefined();
  });
});

// ---- (2) the Windows compliance policy entry ----

type Row = { control_id: string; path: string; op: string; value: number; source?: string };
const manifest = (rows: Row[]) => ({
  getControl: (cid: string) => {
    const mine = rows.filter(r => r.control_id === cid);
    return mine.length === 0 ? undefined : { control_id: cid, verification: mine.map((r, i) => ({ id: `c${i}`, description: 'd', method: 'config_export', expected: 'e', on_fail: 'f', expected_value: { path: r.path, op: r.op, value: r.value, source: r.source ?? 'answered' } })) } as any;
  },
});
const S1_ROWS: Row[] = [
  { control_id: 'IA.L2-3.5.7', path: '$.passwordMinimumLength', op: 'gte', value: 14 },
  { control_id: 'IA.L2-3.5.8', path: '$.passwordPreviousPasswordBlockCount', op: 'gte', value: 24 },
  { control_id: 'AC.L2-3.1.10', path: '$.passwordMinutesOfInactivityBeforeScreenTimeout', op: 'lte', value: 10 },
];

describe('run 50 (2): CM.L2-3.4.1.compliance-policy-windows', () => {
  const e = byId(COMPLIANCE);
  it('the entry: controls, SET with the baseline and the assignment, state rule, bindings', () => {
    expect(e.control_ids).toEqual(['CM.L2-3.4.1', 'CM.L2-3.4.2', 'IA.L2-3.5.7', 'IA.L2-3.5.8', 'AC.L2-3.1.10', 'SC.L2-3.13.16', 'SI.L1-3.14.1', 'SI.L1-3.14.2']);
    expect(e.idempotency).toBe('get-then-set');
    for (const s of ["'@odata.type'='#microsoft.graph.windows10CompliancePolicy'", 'passwordRequired=$true', 'passwordMinimumLength=14', 'passwordPreviousPasswordBlockCount=24', 'passwordMinutesOfInactivityBeforeLock=15', 'bitLockerEnabled=$true', 'secureBootEnabled=$true', 'codeIntegrityEnabled=$true', 'rtpEnabled=$true', 'defenderEnabled=$true', "osMinimumVersion='10.0.19045'", 'scheduledActionsForRule', '/deviceCompliancePolicies/$($created.id)/assign"', "groupId='{cuiGroupId}'"]) {
      expect([s, e.set_command.includes(s)]).toEqual([s, true]);
    }
    expect(e.variables_runtime).toEqual(['cuiGroupId']);
    expect(e.verification?.postcheck_mode).toBe('state');
    expect(e.verification?.evidence?.checks).toEqual(expect.arrayContaining([{ jsonpath: '$.assignments', min_items: 1 }, { jsonpath: '$.bitLockerEnabled', equals: 'true' }]));
    expect(e.org_value_bindings!.map(b => b.token)).toEqual(['passwordMinimumLength', 'passwordPreviousPasswordBlockCount', 'passwordMinutesOfInactivityBeforeLock']);
  });

  it('S1 answers: 14 / 24 configured; the lock takes the screen-lock answer (10) on create and is held to the registry 15 on an existing policy', () => {
    const { entry, decisions } = applyOrganisationValues(e, manifest(S1_ROWS));
    expect(entry.set_command).toContain('passwordMinutesOfInactivityBeforeLock=10;');
    expect(entry.verification!.evidence!.checks).toEqual(expect.arrayContaining([{ jsonpath: '$.passwordMinutesOfInactivityBeforeLock', equals: '10' }]));
    const lock = decisions.find(d => d.token === 'passwordMinutesOfInactivityBeforeLock')!;
    expect(lock).toMatchObject({ configured_value: 10, registry_value: 15, exists_bound: 'registry', control_ids: ['AC.L2-3.1.10'] });
    const crit = existingStateCriteria(entry.verification, decisions)!;
    expect(crit.evidence!.checks).toEqual(expect.arrayContaining([{ jsonpath: '$.passwordMinutesOfInactivityBeforeLock', min: 1, max: 15 }, { jsonpath: '$.passwordMinimumLength', min: 14 }]));
    // S1's own policy (lock 15) is verified by effect under those bounds
    const v = verifyEquivalent(JSON.stringify(S1_CP[0]), e.lookup!, decisions, resolve)!;
    expect(v.verification.passed).toBe(true);
  });

  it('an organisation minimum length of 16: the SET writes 16 and S1-style 14 fails the existing-policy bound', () => {
    const { entry, decisions } = applyOrganisationValues(e, manifest([{ control_id: 'IA.L2-3.5.7', path: '$.passwordMinimumLength', op: 'gte', value: 16 }]));
    expect(entry.set_command).toContain('passwordMinimumLength=16;');
    const v = verifyEquivalent(JSON.stringify(S1_CP[0]), e.lookup!, decisions, resolve)!;
    expect(v.verification.passed).toBe(false);
    expect(v.verification.reason).toContain('$.passwordMinimumLength gte 16 (observed 14)');
  });

  it('the own read-back passes the state rule; a missing assignment or BitLocker off fails', () => {
    const engine = new OutputVerificationEngine();
    const ok = (o: object) => engine.verify({ stdout: '', stderr: '', exitCode: 0 }, { stdout: JSON.stringify(o), exitCode: 0 }, e.verification).passed;
    const own = read(COMPLIANCE);
    expect(ok(own)).toBe(true);
    expect(ok({ ...own, assignments: [] })).toBe(false);
    expect(ok({ ...own, bitLockerEnabled: false })).toBe(false);
  });

  const run = async (tenant: string, objects: any[]) => {
    const sent: string[] = [];
    const list = clone(objects);
    const sub = {
      id: e.entry_id, label: e.label, set_command: e.set_command, get_command: e.get_command, engine: e.engine, sequence_hint: e.sequence_hint,
      idempotency: e.idempotency, variables_required: e.variables_required, variables_runtime: e.variables_runtime, captures: e.captures,
      on_failure: e.on_failure, evidence_commands: [], verification: e.verification, lookup: e.lookup, control_ids: e.control_ids,
    } as SubCommand;
    const manager = {
      execute: async (_t: string, c: string) => {
        sent.push(c);
        if (c.includes('$created = ')) { const o = read(COMPLIANCE); list.push(o); return { stdout: JSON.stringify(o), stderr: '', exitCode: 0 }; }
        if (c.includes(resolve(e.get_command))) { const hit = selectLookupMatch(list, e.lookup!, resolve); return { stdout: hit ? JSON.stringify(hit) : '', stderr: '', exitCode: 0 }; }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    };
    const ctx = new ExecutionContext(false);
    ctx.registerCaptures({ cuiGroupId: 'group-1' });
    const task = { id: `t-${tenant}`, type: 'configuration', priority: 'p1', depends_on: [], action: { engine: 'mgraph', command: 'x', args: { _sub_commands: [sub] } }, inputs: [], outputs: [], controls: e.control_ids, idempotency: 'safe', rollback: { strategy: 'none' } } as ExeTask;
    const config = StamperConfig.fromTenantConfig({ tenantId: 't', appId: 'a', certThumbprint: 'c', certPath: '/p', targetTenantDomain: 'test.onmicrosoft.us', clientName: 'Test' });
    const result = await new PowerShellAdapter(config, manager as any, ctx, undefined, tenant).execute(task, {}, false);
    const record = JSON.parse(fs.readFileSync(taskEvidencePath(evidenceDirForTenant(tenant), task.id, evidenceFileForEntry(sub.id, sub.label).replace(/\.txt$/, '.json')), 'utf-8'));
    return { result, record, created: sent.some(c => c.includes('$created = ')), list };
  };

  it('S1-style tenant: the assigned S1 policy is verified, nothing is created', async () => {
    const { result, record, created } = await run('run50-cp-s1', S1_CP);
    expect(result.success).toBe(true);
    expect(created).toBe(false);
    expect(record.metadata.lookupMatch).toMatchObject({ basis: 'effect', object: 'S1 Windows 11 staff and kiosk compliance' });
    expect(record.metadata.controlIds).toEqual(e.control_ids);
  });

  it('muster-partial-style tenant (its compliance policies unassigned): CMMC-Compliance-Windows is created and assigned', async () => {
    const unassigned = S1_CP.map(p => ({ ...p, displayName: p.displayName.replace('S1', 'Sim'), assignments: [] }));
    const { result, record, created, list } = await run('run50-cp-mp', unassigned);
    expect(created).toBe(true);
    expect(result.success).toBe(true);
    expect(record.complianceVerdict).toBe('SAT');
    expect(list.filter(o => o.displayName === 'CMMC-Compliance-Windows')).toHaveLength(1);
  });
});
