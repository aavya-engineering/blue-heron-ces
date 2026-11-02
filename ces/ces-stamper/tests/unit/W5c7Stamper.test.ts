// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// synthetic-customer W5 cycle 7 (Stamper slice), from proven run 56b (S2).
// (1) AC.L1-3.1.1.ca-mfa-compliant-device: the enabled CA policy EvidenceOps' AC.L1-3.1.1 rule asks for
//     (MFA AND a compliant device), created or verified by its full effect. (2) AU.L2-3.3.7.time-sync: a
//     settings-catalog NTP policy, the server bound to the organisation's answered $.timeServer (a string
//     org-value binding). (3) The admin naming convention (TM admin_naming_convention) as a Stamper variable
//     the admin-account lookup accepts. All tenant data here is fictional (the simulator's S1 / S2 seed shapes).
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { CommandRegistry } from '../../src/registry/CommandRegistry';
import { selectLookupMatch, lookupGetCommand, verifyEquivalent } from '../../src/registry/lookup';
import { applyOrganisationValues, existingStateCriteria, checkExistingOrgValues, ORG_VALUE_UNSAFE_NOTE } from '../../src/translators/orgValues';
import { ManifestReader, adminNamingPattern } from '../../src/translators/ManifestReader';
import { PlanTranslator } from '../../src/translators/PlanTranslator';
import { OutputVerificationEngine } from '../../src/core/OutputVerificationEngine';
import { PowerShellAdapter } from '../../src/adapters/PowerShellAdapter';
import { StamperConfig } from '../../src/config/StamperConfig';
import { ExecutionContext } from '../../src/core/ExecutionContext';
import { evidenceDirForTenant, evidenceFileForEntry, taskEvidencePath } from '../../src/core/EvidenceReadinessAnalyzer';
import { VARIABLE_DEFAULTS } from '../../src/shared/variable-map';
import type { CommandEntry } from '../../src/registry/command-registry.types';
import type { ExeTask, SubCommand, VerificationCriteria } from '../../src/types/schema.types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, '../fixtures');
const registry = CommandRegistry.load(path.resolve(__dirname, '../../src/registry/cmmc-l2-commands.registry.json'));
const byId = (id: string) => registry.allEntries.find(e => e.entry_id === id)!;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const READS = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'w3-state-reads.json'), 'utf-8')).reads as Record<string, string>;
const read = (id: string) => JSON.parse(READS[id]);
const VARS: Record<string, string> = { cuiGroupId: 'group-1', adminUserName: 'cesadmin', adminNamingPattern: '(?!)' };
const resolve = (s: string) => s.replace(/\{(\w+)\}/g, (m, k) => VARS[k] ?? m);
const resolveCriteria = (v: unknown): VerificationCriteria => JSON.parse(JSON.stringify(v).replace(/\{(\w+)\}/g, (m, k) => VARS[k] ?? m));
const verifies = (criteria: unknown, stdout: string) =>
  new OutputVerificationEngine().verify({ stdout: '', stderr: '', exitCode: 0 }, { stdout, exitCode: 0 }, resolveCriteria(criteria), { stateChanged: true }).passed;

const CA_ID = 'AC.L1-3.1.1.ca-mfa-compliant-device';
const TS_ID = 'AU.L2-3.3.7.time-sync';
const ADMIN_ID = 'AC.L2-3.1.6.admin-account';

const PIPELINE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'stamper-w5c7-'));
const savedRoot = process.env.CES_PIPELINE_ROOT;
beforeAll(() => { process.env.CES_PIPELINE_ROOT = PIPELINE_ROOT; });
afterAll(() => {
  if (savedRoot === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = savedRoot;
  fs.rmSync(PIPELINE_ROOT, { recursive: true, force: true });
});

// ---- EvidenceOps' caEnforcementEvaluator (ces-eo ac-evaluators.ts), replicated for the parity test ----
const eoMet = (p: any): boolean => p.state === 'enabled'
  && ['mfa', 'compliantDevice'].every(c => (p.grantControls?.builtInControls ?? []).includes(c))
  && p.grantControls?.operator === 'AND';

// ---- the simulator's S1 and S2 CA seeds (scenarios/s1-mach.json, s2-eng.json), fictional ----
const S1_USERS = { includeUsers: ['All'], excludeUsers: ['user-50', 'user-51'], excludeGroups: ['group-12'] };
const S1_CA = [
  { displayName: 'S1-CA01 Require MFA - all users', state: 'enabled', conditions: { users: S1_USERS, applications: { includeApplications: ['All'] } }, grantControls: { operator: 'OR', builtInControls: ['mfa'] } },
  { displayName: 'S1-CA02 Phishing-resistant MFA - admin roles', state: 'enabled', conditions: { users: { includeUsers: [], includeRoles: ['62e90394-69f5-4237-9190-012177145e10'], excludeUsers: ['user-50', 'user-51'] }, applications: { includeApplications: ['All'] } }, grantControls: { operator: 'OR', builtInControls: [], authenticationStrength: { id: '00000000-0000-0000-0000-000000000004' } } },
  { displayName: 'S1-CA03 Block legacy authentication', state: 'enabled', conditions: { users: S1_USERS, applications: { includeApplications: ['All'] }, clientAppTypes: ['exchangeActiveSync', 'other'] }, grantControls: { operator: 'OR', builtInControls: ['block'] } },
  { displayName: 'S1-CA04 Require compliant device - CUI enclave', state: 'enabled', conditions: { users: { includeUsers: [], includeGroups: ['group-1'], excludeUsers: ['user-50', 'user-51'] }, applications: { includeApplications: ['Office365'] } }, grantControls: { operator: 'OR', builtInControls: ['compliantDevice'] } },
  { displayName: 'S1-CA05 Require compliant device - all apps', state: 'enabled', conditions: { users: S1_USERS, applications: { includeApplications: ['All'] }, platforms: { includePlatforms: ['windows', 'iOS'] } }, grantControls: { operator: 'OR', builtInControls: ['compliantDevice'] } },
  { displayName: 'S1-CA06 Block sign-in from outside US', state: 'enabled', conditions: { users: S1_USERS, applications: { includeApplications: ['All'] }, locations: { includeLocations: ['All'], excludeLocations: ['51510000-00b1-4000-8000-000000000001'] } }, grantControls: { operator: 'OR', builtInControls: ['block'] } },
  { displayName: 'S1-CA07 Sign-in risk high - block', state: 'enabled', conditions: { users: S1_USERS, applications: { includeApplications: ['All'] }, signInRiskLevels: ['high'] }, grantControls: { operator: 'OR', builtInControls: ['block'] } },
  { displayName: 'S1-CA08 Admin portals - compliant device and MFA', state: 'enabled', conditions: { users: S1_USERS, applications: { includeApplications: ['MicrosoftAdminPortals'] } }, grantControls: { operator: 'AND', builtInControls: ['mfa', 'compliantDevice'] } },
  { displayName: 'S1-CA09 Session lifetime 12h - browser', state: 'enabled', conditions: { users: S1_USERS, applications: { includeApplications: ['All'] }, clientAppTypes: ['browser'] }, sessionControls: { signInFrequency: { value: 12, type: 'hours', isEnabled: true }, persistentBrowser: { mode: 'never', isEnabled: true } } },
];
const S2_USERS = { includeUsers: ['All'], excludeUsers: ['user-33', 'user-34'], excludeGroups: ['group-12'] };
const S2_CA = [
  { displayName: 'S2-CA01 Require MFA - all users', state: 'enabled', conditions: { users: S2_USERS, applications: { includeApplications: ['All'] } }, grantControls: { operator: 'OR', builtInControls: ['mfa'] } },
  { displayName: 'S2-CA02 Block legacy authentication', state: 'enabled', conditions: { users: S2_USERS, applications: { includeApplications: ['All'] }, clientAppTypes: ['exchangeActiveSync', 'other'] }, grantControls: { operator: 'OR', builtInControls: ['block'] } },
  { displayName: 'S2-CA03 Require MFA - admin roles', state: 'enabled', conditions: { users: { includeUsers: [], includeRoles: ['62e90394-69f5-4237-9190-012177145e10'], excludeUsers: ['user-33', 'user-34'] }, applications: { includeApplications: ['All'] } }, grantControls: { operator: 'OR', builtInControls: ['mfa'] } },
];
/** A customer's own policy with CES's scope and grant (fictional). */
const CUSTOMER_EQ = {
  displayName: 'Customer - MFA and compliant device (CUI)', state: 'enabled',
  conditions: { users: { includeGroups: ['group-1'], excludeUsers: ['user-33'] }, applications: { includeApplications: ['All'] }, clientAppTypes: ['browser', 'mobileAppsAndDesktopClients'] },
  grantControls: { operator: 'AND', builtInControls: ['mfa', 'compliantDevice'] },
};

describe('W5c7 (1): AC.L1-3.1.1.ca-mfa-compliant-device', () => {
  const e = byId(CA_ID);
  const found = (list: unknown[]) => (selectLookupMatch(list, e.lookup!, resolve) as any)?.displayName;

  it('the entry: SET creates the enabled MFA AND compliant-device policy for the CUI group, break-glass excluded, all apps, browser + modern clients', () => {
    expect(e.control_ids).toEqual(['AC.L1-3.1.1']);
    expect(e.idempotency).toBe('get-then-set');
    for (const s of ["displayName='CMMC-MFA-CompliantDevice'", "state='enabled'", "includeGroups=@('{cuiGroupId}')", "excludeUsers=@('{breakGlassUserId}')",
      "includeApplications=@('All')", "clientAppTypes=@('browser','mobileAppsAndDesktopClients')", "grantControls=@{operator='AND';builtInControls=@('mfa','compliantDevice')}"]) {
      expect([s, e.set_command.includes(s)]).toEqual([s, true]);
    }
    expect(e.variables_runtime).toEqual(['cuiGroupId', 'breakGlassUserId']);
    expect(e.on_failure).toBe('warn_continue');
    expect(e.verification!.postcheck_mode).toBe('state');
    expect(e.get_command).toBe(lookupGetCommand(e.lookup!));
  });

  it('the evidence-only entry is kept beside it', () => {
    expect(byId('AC.L1-3.1.1.ca-policy-evidence').idempotency).toBe('evidence-only');
    expect(registry.allEntries.filter(x => x.control_ids.includes('AC.L1-3.1.1')).map(x => x.entry_id)).toEqual(expect.arrayContaining(['AC.L1-3.1.1.ca-policy-evidence', CA_ID]));
  });

  it('lookup positive: CES\'s own policy by name; a customer policy with the same scope and grant; all users with no client condition', () => {
    expect(found([read(CA_ID)])).toBe('CMMC-MFA-CompliantDevice');
    expect(found([CUSTOMER_EQ])).toBe(CUSTOMER_EQ.displayName);
    const allUsers = { ...clone(CUSTOMER_EQ), displayName: 'All users MFA+device', conditions: { users: { includeUsers: ['All'] }, applications: { includeApplications: ['All'] } } };
    expect(found([allUsers])).toBe('All users MFA+device');
    const allClients = clone(CUSTOMER_EQ); allClients.conditions.clientAppTypes = ['all'];
    expect(found([allClients])).toBe(CUSTOMER_EQ.displayName);
  });

  it('lookup negative: S2-CA01 (MFA only) and the rest of S2 never match', () => {
    expect(found([S2_CA[0]])).toBeUndefined();
    expect(found(S2_CA)).toBeUndefined();
  });

  it("lookup negative on S1: S1-CA05 (compliant device alone, platforms windows + iOS) and S1-CA08 (MFA AND device, admin portals only) are not equivalents", () => {
    expect(found([S1_CA[4]])).toBeUndefined();
    expect(found([S1_CA[7]])).toBeUndefined();
    expect(found(S1_CA)).toBeUndefined();
    // S1-CA05 would match only with grant mfa AND compliantDevice and no platform narrowing
    const ca05 = clone(S1_CA[4]) as any;
    ca05.grantControls = { operator: 'AND', builtInControls: ['mfa', 'compliantDevice'] };
    expect(found([ca05])).toBeUndefined(); // still narrowed to windows + iOS
    delete ca05.conditions.platforms;
    expect(found([ca05])).toBe('S1-CA05 Require compliant device - all apps');
  });

  it('lookup negative: OR grant, report-only, browser only, one platform, a location, a risk condition, other apps', () => {
    const v = (f: (p: any) => void) => { const p = clone(CUSTOMER_EQ) as any; f(p); return found([p]); };
    expect(v(p => { p.grantControls.operator = 'OR'; })).toBeUndefined();
    expect(v(p => { p.grantControls.builtInControls = ['mfa']; p.grantControls.operator = 'AND'; })).toBeUndefined();
    expect(v(p => { p.state = 'enabledForReportingButNotEnforced'; })).toBeUndefined();
    expect(v(p => { p.conditions.clientAppTypes = ['browser']; })).toBeUndefined();
    expect(v(p => { p.conditions.platforms = { includePlatforms: ['windows'] }; })).toBeUndefined();
    expect(v(p => { p.conditions.locations = { includeLocations: ['51510000-00b1-4000-8000-000000000001'] }; })).toBeUndefined();
    expect(v(p => { p.conditions.signInRiskLevels = ['high']; })).toBeUndefined();
    expect(v(p => { p.conditions.applications = { includeApplications: ['Office365'] }; })).toBeUndefined();
    expect(v(p => { p.conditions.users = { includeGroups: ['group-9'] }; })).toBeUndefined();
  });

  it('parity: every policy the lookup accepts meets EvidenceOps\' AC.L1-3.1.1 rule (enabled, mfa + compliantDevice, AND)', () => {
    for (const p of [read(CA_ID), CUSTOMER_EQ]) expect([p.displayName, eoMet(p)]).toEqual([p.displayName, true]);
    for (const p of [...S1_CA, ...S2_CA]) if (found([p]) !== undefined) expect(eoMet(p)).toBe(true);
  });

  it('the remote-maintenance MFA lookup does not take CMMC-MFA-CompliantDevice (CUI-group scope, browser + modern clients)', () => {
    expect(selectLookupMatch([read(CA_ID)], byId('MA.L2-3.7.5.remote-mfa').lookup!, resolve)).toBeUndefined();
    expect(selectLookupMatch([read(CA_ID)], byId('AC.L2-3.1.11.session-timeout').lookup!, resolve)).toBeUndefined();
  });

  it('postcheck (state): passes on CES\'s policy; fails on an MFA-only, an OR or a disabled read', () => {
    const own = read(CA_ID);
    expect(verifies(e.verification, JSON.stringify(own))).toBe(true);
    const mfaOnly = clone(own); mfaOnly.grantControls.builtInControls = ['mfa'];
    expect(verifies(e.verification, JSON.stringify(mfaOnly))).toBe(false);
    const or = clone(own); or.grantControls.operator = 'OR';
    expect(verifies(e.verification, JSON.stringify(or))).toBe(false);
    const off = clone(own); off.state = 'disabled';
    expect(verifies(e.verification, JSON.stringify(off))).toBe(false);
  });

  it('exists path: a customer equivalent read is verified by effect', () => {
    const v = verifyEquivalent(JSON.stringify(CUSTOMER_EQ), e.lookup!, undefined, resolve)!;
    expect(v.verification.passed).toBe(true);
    expect(v.match).toMatchObject({ basis: 'effect', object: CUSTOMER_EQ.displayName });
  });
});

// ---- (2) time synchronisation ----
const W = 'device_vendor_msft_policy_config_admx_w32time_w32time_policy';
const sv = (def: string, value: unknown, kind = 'String') => ({ '@odata.type': '#microsoft.graph.deviceManagementConfigurationSimpleSettingInstance', settingDefinitionId: def, simpleSettingValue: { '@odata.type': `#microsoft.graph.deviceManagementConfiguration${kind}SettingValue`, value } });
/** S1's seeded policy (tenant-stacksim customerHistory.ts, "S1 Windows time synchronisation (NTP)"), as Graph returns it with $expand=settings,assignments. */
const S1_TIME = {
  id: 'c5000000-0002', name: 'S1 Windows time synchronisation (NTP)', platforms: 'windows10', technologies: 'mdm', isAssigned: true,
  settings: [
    { id: '0', settingInstance: { '@odata.type': '#microsoft.graph.deviceManagementConfigurationChoiceSettingInstance', settingDefinitionId: `${W}_enable_ntpclient`, choiceSettingValue: { value: `${W}_enable_ntpclient_1`, children: [] } } },
    { id: '1', settingInstance: { '@odata.type': '#microsoft.graph.deviceManagementConfigurationChoiceSettingInstance', settingDefinitionId: `${W}_configure_ntpclient`, choiceSettingValue: { value: `${W}_configure_ntpclient_1`, children: [
      sv(`${W}_configure_ntpclient_w32time_ntpclient_ntpserver`, 'time.windows.com,0x9'),
      { '@odata.type': '#microsoft.graph.deviceManagementConfigurationChoiceSettingInstance', settingDefinitionId: `${W}_configure_ntpclient_w32time_ntpclient_type`, choiceSettingValue: { value: `${W}_configure_ntpclient_w32time_ntpclient_type_ntp`, children: [] } },
      sv(`${W}_configure_ntpclient_w32time_ntpclient_specialpollinterval`, 3600, 'Integer'),
    ] } } },
  ],
  assignments: [{ id: 'c5000000-0002_group-1', target: { '@odata.type': '#microsoft.graph.groupAssignmentTarget', groupId: 'group-1' } }],
};
/** The GET's PowerShell projection, in JS (same fields, same matching: -eq exact, -like suffix, first child). */
function project(p: any) {
  const si = (p.settings ?? []).map((s: any) => s.settingInstance);
  const cfg = si.find((s: any) => s?.settingDefinitionId === `${W}_configure_ntpclient`);
  const kids: any[] = cfg?.choiceSettingValue?.children ?? [];
  const kid = (suffix: string) => kids.find(k => String(k.settingDefinitionId).endsWith(suffix));
  return {
    id: p.id, name: p.name, platforms: p.platforms,
    ntpClientEnabled: si.some((s: any) => s?.settingDefinitionId === `${W}_enable_ntpclient` && s?.choiceSettingValue?.value === `${W}_enable_ntpclient_1`),
    ntpConfigured: cfg?.choiceSettingValue?.value === `${W}_configure_ntpclient_1`,
    timeServer: kid('_ntpserver')?.simpleSettingValue?.value ?? null,
    ntpType: String(kid('_type')?.choiceSettingValue?.value ?? '').replace(/^.*_type_/, ''),
    pollInterval: kid('_specialpollinterval')?.simpleSettingValue?.value ?? null,
    assignments: p.assignments ?? [],
  };
}

describe('W5c7 (2): AU.L2-3.3.7.time-sync', () => {
  const e = byId(TS_ID);
  const found = (list: unknown[]) => (selectLookupMatch(list.map(project), e.lookup!, resolve) as any)?.name;

  it('the entry: SET posts the CMMC-Time-Sync settings-catalog policy (ADMX_W32Time NTP client, server, type NTP, hourly poll) and assigns it to the CUI group', () => {
    expect(e.control_ids).toEqual(['AU.L2-3.3.7']);
    expect(e.set_command.startsWith("$timeServer='time.windows.com,0x9'; $created = Invoke-MgGraphRequest -Method POST -Uri 'https://graph.microsoft.us/beta/deviceManagement/configurationPolicies'")).toBe(true);
    for (const s of ["name='CMMC-Time-Sync'", "platforms='windows10'", `settingDefinitionId='${W}_enable_ntpclient';`, `value='${W}_enable_ntpclient_1'`,
      `settingDefinitionId='${W}_configure_ntpclient';`, `value='${W}_configure_ntpclient_1'`, `settingDefinitionId='${W}_configure_ntpclient_w32time_ntpclient_ntpserver'`,
      'value=$timeServer', `value='${W}_configure_ntpclient_w32time_ntpclient_type_ntp'`, `settingDefinitionId='${W}_configure_ntpclient_w32time_ntpclient_specialpollinterval'`, 'value=3600',
      "Invoke-MgGraphRequest -Method POST -Uri \"https://graph.microsoft.us/beta/deviceManagement/configurationPolicies/$($created.id)/assign\"",
      "assignments=@(@{target=@{'@odata.type'='#microsoft.graph.groupAssignmentTarget';groupId='{cuiGroupId}'}})"]) {
      expect([s, e.set_command.includes(s)]).toEqual([s, true]);
    }
    expect(e.variables_runtime).toEqual(['cuiGroupId']);
    expect(e.get_command).toBe(lookupGetCommand(e.lookup!));
    expect(e.get_command).toContain("configurationPolicies?$expand=settings,assignments'");
    expect(e.verification!.postcheck_mode).toBe('state');
    expect(e.verification!.evidence!.checks).toEqual(expect.arrayContaining([{ jsonpath: '$.assignments', min_items: 1 }]));
    expect(byId('AU.L2-3.3.7.time-source').idempotency).toBe('evidence-only'); // kept
  });

  it("lookup positive: S1's seeded \"S1 Windows time synchronisation (NTP)\" (projected) is an equivalent; CES's own policy by name", () => {
    expect(found([S1_TIME])).toBe('S1 Windows time synchronisation (NTP)');
    expect((selectLookupMatch([read(TS_ID)], e.lookup!, resolve) as any).name).toBe('CMMC-Time-Sync');
    const p = project(S1_TIME);
    expect(p).toMatchObject({ ntpClientEnabled: true, ntpConfigured: true, timeServer: 'time.windows.com,0x9', ntpType: 'ntp', pollInterval: 3600 });
  });

  it('lookup negative: unassigned, a daily poll, the NTP client disabled, type NT5DS, another platform, the generic simulator policy (S2 / muster-partial)', () => {
    const v = (f: (p: any) => void) => { const p = clone(S1_TIME) as any; f(p); return found([p]); };
    expect(v(p => { p.assignments = []; })).toBeUndefined();
    expect(v(p => { p.settings[1].settingInstance.choiceSettingValue.children[2].simpleSettingValue.value = 86400; })).toBeUndefined();
    expect(v(p => { p.settings[0].settingInstance.choiceSettingValue.value = `${W}_enable_ntpclient_0`; })).toBeUndefined();
    expect(v(p => { p.settings[1].settingInstance.choiceSettingValue.value = `${W}_configure_ntpclient_0`; })).toBeUndefined();
    expect(v(p => { p.settings[1].settingInstance.choiceSettingValue.children[1].choiceSettingValue.value = `${W}_configure_ntpclient_w32time_ntpclient_type_nt5ds`; })).toBeUndefined();
    expect(v(p => { p.platforms = 'macOS'; })).toBeUndefined();
    expect(found([{ id: 'deviceManagementConfigurationPolicy-1', name: 'Sim Configuration Policy 1', platforms: 'windows10' }])).toBeUndefined();
  });

  it('the other CES settings-catalog policies (ASR, firewall) are never a time-sync equivalent', () => {
    const fw = JSON.parse(READS['SC.L1-3.13.1.endpoint-firewall']);
    expect(found([{ ...fw, assignments: [{ id: 'a' }] }])).toBeUndefined();
  });

  it('postcheck (state): passes on CES\'s projected policy; fails with another server, no assignment or a daily poll', () => {
    const own = read(TS_ID);
    expect(verifies(e.verification, JSON.stringify(own))).toBe(true);
    expect(verifies(e.verification, JSON.stringify({ ...own, timeServer: 'pool.example.test,0x9' }))).toBe(false);
    expect(verifies(e.verification, JSON.stringify({ ...own, assignments: [] }))).toBe(false);
    expect(verifies(e.verification, JSON.stringify({ ...own, pollInterval: 86400 }))).toBe(false);
  });

  // ---- the string org-value binding ----
  type Row = { control_id: string; path: string; op: string; value: unknown; source?: string };
  const manifest = (rows: Row[]) => ({
    getControl: (cid: string) => {
      const mine = rows.filter(r => r.control_id === cid);
      return mine.length === 0 ? undefined : { control_id: cid, verification: mine.map((r, i) => ({ id: `CHK-${i}`, description: 'd', method: 'config_export', expected: 'e', on_fail: 'f', expected_value: { path: r.path, op: r.op, value: r.value, source: r.source ?? 'answered' } })) } as any;
    },
  });

  it('an answered $.timeServer configures that server: the SET and the state rule carry it; the decision says so', () => {
    const { entry, decisions } = applyOrganisationValues(e, manifest([{ control_id: 'AU.L2-3.3.7', path: '$.timeServer', op: 'equals', value: 'ntp1.example.test,0x9 ntp2.example.test,0x9' }]));
    expect(entry.set_command.startsWith("$timeServer='ntp1.example.test,0x9 ntp2.example.test,0x9'; ")).toBe(true);
    expect(entry.set_command).not.toContain('time.windows.com');
    expect(entry.verification!.evidence!.jsonpath).toBe('$.timeServer');
    expect(entry.verification!.evidence!.equals).toBe('ntp1.example.test,0x9 ntp2.example.test,0x9');
    expect(decisions).toEqual([{ path: '$.timeServer', token: 'timeServer', op: 'equals', control_ids: ['AU.L2-3.3.7'], source: 'answered',
      organisation_value: 'ntp1.example.test,0x9 ntp2.example.test,0x9', registry_value: 'time.windows.com,0x9', configured_value: 'ntp1.example.test,0x9 ntp2.example.test,0x9', basis: 'organisation' }]);
  });

  it('no row, a bank default (not answered) or another op: the registry server is configured', () => {
    for (const rows of [[], [{ control_id: 'AU.L2-3.3.7', path: '$.timeServer', op: 'equals', value: 'ntp.example.test', source: 'bank' }], [{ control_id: 'AU.L2-3.3.7', path: '$.timeServer', op: 'contains', value: 'ntp.example.test' }]] as Row[][]) {
      const { entry, decisions } = applyOrganisationValues(e, manifest(rows));
      expect(entry.set_command).toBe(e.set_command);
      expect(decisions).toEqual([]);
    }
  });

  it('an answered value that is not a plain server list (a quote, a metacharacter) keeps the registry server, with a note', () => {
    for (const bad of ["x'; Remove-Item C:\\ -Recurse; '", 'ntp.example.test|whoami', 'ntp.example.test $(evil)']) {
      const { entry, decisions } = applyOrganisationValues(e, manifest([{ control_id: 'AU.L2-3.3.7', path: '$.timeServer', op: 'equals', value: bad }]));
      expect(entry.set_command).toBe(e.set_command);
      expect(decisions[0]).toMatchObject({ basis: 'registry', configured_value: 'time.windows.com,0x9', note: ORG_VALUE_UNSAFE_NOTE });
    }
  });

  it('exists path: the string decision keeps the exact server on CES\'s own policy and adds no numeric bound check', () => {
    const { entry, decisions } = applyOrganisationValues(e, manifest([{ control_id: 'AU.L2-3.3.7', path: '$.timeServer', op: 'equals', value: 'ntp.example.test,0x9' }]));
    expect(existingStateCriteria(entry.verification, decisions)!.evidence).toMatchObject({ jsonpath: '$.timeServer', equals: 'ntp.example.test,0x9' });
    expect(checkExistingOrgValues(JSON.stringify(read(TS_ID)), decisions)).toEqual([]);
    // a customer equivalent is checked by its effect (any server): S1's time.windows.com policy still verifies
    expect(verifyEquivalent(JSON.stringify(project(S1_TIME)), e.lookup!, decisions, resolve)!.verification.passed).toBe(true);
  });
});

// ---- (3) the admin naming convention ----
describe('W5c7 (3): the admin naming convention reaches the admin-account lookup', () => {
  const e = byId(ADMIN_ID);
  const user = (upn: string, over: object) => ({ id: upn, displayName: upn, userPrincipalName: upn, accountEnabled: true, assignedLicenses: [{ skuId: 'g5' }], privileged: true, breakGlass: false, ...over });
  /** The users read's followsConvention, as the PowerShell projection computes it (-match, case-insensitive). */
  const follows = (pattern: string, upn: string) => new RegExp(pattern, 'i').test(upn);

  it('the pattern is EvidenceOps\' conventionPattern for the three scenario conventions', () => {
    // EvidenceOps writes the apostrophe as ' and Stamper as \x27: the same character class, and no quote in the PowerShell string
    expect(adminNamingPattern('adm.{firstname}.{lastname}@{domain}')).toBe("^adm\\.([a-z0-9\\x27-]+)\\.([a-z0-9\\x27-]+)@[^@\\s]+$");
    expect(adminNamingPattern('adm-{firstname}.{lastname}@{domain}')).toBe("^adm-([a-z0-9\\x27-]+)\\.([a-z0-9\\x27-]+)@[^@\\s]+$");
    expect(adminNamingPattern('adm-{lastname}.{firstname}@muster-partial.simtenant.onmicrosoft.us')).toBe("^adm-([a-z0-9\\x27-]+)\\.([a-z0-9\\x27-]+)@muster-partial\\.simtenant\\.onmicrosoft\\.us$");
    expect(adminNamingPattern('adm.{firstname}.{lastname}@{domain}')).not.toContain("'");
    expect(new RegExp(adminNamingPattern('adm.{firstname}.{lastname}@{domain}'), 'i').test("adm.o'neill.vantor@example.test")).toBe(true); // an apostrophe in a name part, as EvidenceOps
  });

  it("S1 / S2 admin UPNs follow their convention; CES's admin-<stem> account and staff UPNs do not", () => {
    const s1 = adminNamingPattern('adm.{firstname}.{lastname}@{domain}');
    const s2 = adminNamingPattern('adm-{firstname}.{lastname}@{domain}');
    expect(follows(s1, 'adm.dorrel.nettlecombe@s1-mach.simtenant.onmicrosoft.us')).toBe(true);
    expect(follows(s2, 'adm-arlow.junipbank@s2-eng.simtenant.onmicrosoft.us')).toBe(true);
    expect(follows(s2, 'admin-cesbuild@s2-eng.simtenant.onmicrosoft.us')).toBe(false);
    expect(follows(s2, 'aubrel.ashbyfield@s2-eng.simtenant.onmicrosoft.us')).toBe(false);
    expect(follows(s1, 'adm-arlow.junipbank@s2-eng.simtenant.onmicrosoft.us')).toBe(false);
    expect(follows('(?!)', 'adm.dorrel.nettlecombe@s1-mach.simtenant.onmicrosoft.us')).toBe(false); // none stated
  });

  it('ManifestReader emits adminNamingPattern from the TM convention, the never-matching (?!) without one; VARIABLE_DEFAULTS carries (?!)', () => {
    const tm = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'synthetic-tenant-manifest.json'), 'utf-8'));
    const body = clone(tm.tenant_manifest ?? tm);
    expect(new ManifestReader(body).generateVariables().adminNamingPattern).toBe('(?!)');
    body.config_intents.push({ id: 'ci-idp', title: 'Identity provider', control_ids: ['IA.L2-3.5.1'], desired_config: { identity_provider: 'entra_native', admin_naming_convention: 'adm-{firstname}.{lastname}@{domain}' }, source_of_truth: 'platform_setting', query_method: 'api' });
    const vars = new ManifestReader(body).generateVariables();
    expect(vars.admin_naming_convention).toBe('adm-{firstname}.{lastname}@{domain}');
    expect(vars.adminNamingPattern).toBe(adminNamingPattern('adm-{firstname}.{lastname}@{domain}'));
    body.config_intents[body.config_intents.length - 1].desired_config.admin_naming_convention = 'adm|{firstname}@{domain}';
    expect(new ManifestReader(body).generateVariables().adminNamingPattern).toBe('(?!)'); // the injection guard would reject '|'
    expect(VARIABLE_DEFAULTS.adminNamingPattern).toBe('(?!)');
  });

  it('the GET projects followsConvention from {adminNamingPattern}; the effect accepts no licence OR the convention', () => {
    expect(e.get_command).toBe(lookupGetCommand(e.lookup!));
    expect(e.lookup!.source).toContain("followsConvention = ([string]$_.userPrincipalName -match '{adminNamingPattern}')");
    expect(e.lookup!.by_effect).toContainEqual({ any_of: [{ path: '$.assignedLicenses', op: 'empty' }, { path: '$.followsConvention', op: 'equals', value: true }] });
  });

  it('a licensed privileged account that follows the convention is an equivalent; a licensed one that does not is not (EvidenceOps: dedicated = no licence or follows)', () => {
    const r = (s: string) => s.replace('{adminUserName}', 'cesbuild');
    const s2 = adminNamingPattern('adm-{firstname}.{lastname}@{domain}');
    const admin = user('adm-arlow.junipbank@s2-eng.simtenant.onmicrosoft.us', {});
    const shared = user('galwyn.rowanfield@s2-eng.simtenant.onmicrosoft.us', {});
    const withFollows = (u: any) => ({ ...u, followsConvention: follows(s2, u.userPrincipalName) });
    expect(selectLookupMatch([withFollows(shared), withFollows(admin)], e.lookup!, r)).toEqual(withFollows(admin));
    expect(selectLookupMatch([withFollows(shared)], e.lookup!, r)).toBeUndefined();
    // break-glass and disabled accounts stay out even when they follow the convention
    expect(selectLookupMatch([withFollows({ ...admin, breakGlass: true })], e.lookup!, r)).toBeUndefined();
    expect(selectLookupMatch([withFollows({ ...admin, accountEnabled: false })], e.lookup!, r)).toBeUndefined();
    // no convention stated: the licence test alone (as W5c5)
    expect(selectLookupMatch([{ ...admin, followsConvention: follows('(?!)', admin.userPrincipalName) }], e.lookup!, r)).toBeUndefined();
  });
});

// ---- translate and the adapter ----
function translate(control: string, title: string, verification?: Record<string, unknown>) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stamper-w5c7-tr-'));
  try {
    const mp = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'synthetic-mission-plan.json'), 'utf-8'));
    const tm = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'synthetic-tenant-manifest.json'), 'utf-8'));
    const hp = mp.outputs.human_readable_mission_plan;
    const base = hp.steps.find((s: any) => s.task_type === 'configuration') ?? hp.steps[0];
    hp.steps = [{ ...clone(base), id: `step_task_${control}_w5c7`, title, task_type: 'configuration', control_coverage: [{ control_id: control, support_type: 'Configurable', gap_rationale: 'gap' }], depends_on: [] }];
    hp.control_directives = [{ control_id: control, directive: 'implement', step_ids: [`task_${control}_w5c7`] }];
    const body = tm.tenant_manifest ?? tm;
    body.normative_controls = body.normative_controls.filter((n: any) => n.control_id !== control);
    body.normative_controls.push({ control_id: control, required_state: 'x', verification: [verification ?? { id: 'c0', description: 'x', method: 'config_export', expected: 'x', on_fail: 'f', presence_only: true }], evidence_artifacts: [] });
    const tmPath = path.join(tmp, 'tm.json');
    fs.writeFileSync(tmPath, JSON.stringify(tm));
    return new PlanTranslator(registry).translate(mp, ManifestReader.fromFile(tmPath)).plan;
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
const subsOf = (plan: any) => plan.execution_graph.flatMap((t: any) => (t.action.args._sub_commands ?? []) as SubCommand[]) as SubCommand[];

describe('W5c7: translate', () => {
  it('the AC.L1-3.1.1 step runs the new CA entry beside the evidence-only one', () => {
    const ids = subsOf(translate('AC.L1-3.1.1', 'AC.L1-3.1.1')).map(s => s.id);
    expect(ids).toEqual(expect.arrayContaining([CA_ID, 'AC.L1-3.1.1.ca-policy-evidence']));
  });
  it('the AU.L2-3.3.7 step runs time-sync beside time-source; an answered $.timeServer reaches the SET and the record decision', () => {
    const plain = subsOf(translate('AU.L2-3.3.7', 'AU.L2-3.3.7'));
    expect(plain.map(s => s.id)).toEqual(expect.arrayContaining([TS_ID, 'AU.L2-3.3.7.time-source']));
    expect(plain.find(s => s.id === TS_ID)!.set_command).toContain("$timeServer='time.windows.com,0x9'");
    const answered = subsOf(translate('AU.L2-3.3.7', 'AU.L2-3.3.7', { id: 'c1', description: 'NTP server', method: 'config_export', expected: 'x', on_fail: 'f', expected_value: { path: '$.timeServer', op: 'equals', value: 'ntp.example.test,0x9', source: 'answered' } }));
    const sub = answered.find(s => s.id === TS_ID)!;
    expect(sub.set_command).toContain("$timeServer='ntp.example.test,0x9'");
    expect((sub as any).org_values).toEqual([expect.objectContaining({ op: 'equals', configured_value: 'ntp.example.test,0x9', basis: 'organisation' })]);
    expect(sub.lookup).toBeDefined();
  });
  it('plan variables carry adminNamingPattern', () => {
    const plan = translate('AC.L2-3.1.6', 'AC.L2-3.1.6');
    expect(plan.variables.adminNamingPattern).toBe('(?!)'); // the fixture TM states no convention
  });
});

function makeConfig(): StamperConfig {
  return StamperConfig.fromTenantConfig({
    tenantId: 'test-tenant', appId: 'test-app', certThumbprint: 'test-thumbprint',
    certPath: '/path/to/cert', targetTenantDomain: 'test.onmicrosoft.us', clientName: 'Test Client',
  });
}
const asSub = (e: CommandEntry): SubCommand => ({
  id: e.entry_id, label: e.label, set_command: e.set_command, get_command: e.get_command, engine: e.engine,
  sequence_hint: e.sequence_hint, idempotency: e.idempotency, variables_required: e.variables_required, variables_runtime: e.variables_runtime,
  captures: e.captures, on_failure: e.on_failure, evidence_commands: e.evidence_commands, verification: e.verification,
  ...(e.lookup ? { lookup: e.lookup } : {}), control_ids: e.control_ids,
} as SubCommand);
const task = (id: string, subs: SubCommand[], controls: string[]): ExeTask => ({
  id, type: 'configuration', priority: 'p1', depends_on: [],
  action: { engine: 'mgraph', command: 'placeholder', args: { _sub_commands: subs } },
  inputs: [], outputs: [], controls, idempotency: 'safe', rollback: { strategy: 'none' },
} as ExeTask);
function session(getMatch: RegExp, setMatch: RegExp, before: string, after: string) {
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
const record = (tenant: string, taskId: string, sub: SubCommand): any =>
  JSON.parse(fs.readFileSync(taskEvidencePath(evidenceDirForTenant(tenant), taskId, evidenceFileForEntry(sub.id, sub.label).replace(/\.txt$/, '.json')), 'utf-8'));
const cuiCtx = () => { const c = new ExecutionContext(false); c.registerCaptures({ cuiGroupId: 'group-1', breakGlassUserId: 'user-33' }); return c; };

describe('W5c7: adapter (fake session)', () => {
  const realSetTimeout = global.setTimeout;
  beforeEach(() => {
    (global as any).setTimeout = (fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => realSetTimeout(fn, ms !== undefined && ms >= 5000 ? 0 : ms, ...args);
  });
  afterEach(() => { (global as any).setTimeout = realSetTimeout; });

  it("S1: the time-sync GET finds S1's policy: verified by effect, no POST", async () => {
    const sub = asSub(byId(TS_ID));
    const s1 = JSON.stringify(project(S1_TIME));
    const t = session(/configurationPolicies\?\$expand=settings,assignments'\)\.value \| ForEach-Object/, /-Method POST/, s1, s1);
    const r = await new PowerShellAdapter(makeConfig(), t.manager as any, cuiCtx(), undefined, 'w5c7-s1').execute(task('t-ts-s1', [sub], ['AU.L2-3.3.7']), {}, false);
    expect(r.success).toBe(true);
    expect(t.received.some(c => /-Method POST/.test(c))).toBe(false);
    const rec = record('w5c7-s1', 't-ts-s1', sub);
    expect(rec.complianceVerdict).toBe('SAT');
    expect(rec.metadata.lookupMatch).toMatchObject({ basis: 'effect', object: 'S1 Windows time synchronisation (NTP)' });
  });

  it('S2 / muster-partial: no time-sync policy: CMMC-Time-Sync is created and the state rule passes on the re-read', async () => {
    const sub = asSub(byId(TS_ID));
    const t = session(/configurationPolicies\?\$expand=settings,assignments'\)\.value \| ForEach-Object/, /-Method POST/, '', READS[TS_ID]);
    const r = await new PowerShellAdapter(makeConfig(), t.manager as any, cuiCtx(), undefined, 'w5c7-s2').execute(task('t-ts-s2', [sub], ['AU.L2-3.3.7']), {}, false);
    expect(t.received.some(c => c.startsWith("$timeServer='time.windows.com,0x9'; $created = Invoke-MgGraphRequest -Method POST"))).toBe(true);
    expect(r.success).toBe(true);
    expect(record('w5c7-s2', 't-ts-s2', sub).metadata.postcheckMode).toBe('state');
  });

  it('S2: the CA GET finds no equivalent (S2-CA01 is MFA only): CMMC-MFA-CompliantDevice is created and verified', async () => {
    const sub = asSub(byId(CA_ID));
    const t = session(/conditionalAccess\/policies'\)\.value \| Where-Object/, /^New-MgIdentityConditionalAccessPolicy/, '', READS[CA_ID]);
    const r = await new PowerShellAdapter(makeConfig(), t.manager as any, cuiCtx(), undefined, 'w5c7-ca').execute(task('t-ca', [sub], ['AC.L1-3.1.1']), {}, false);
    const posted = t.received.find(c => c.startsWith('New-MgIdentityConditionalAccessPolicy'))!;
    expect(posted).toContain("includeGroups=@('group-1');excludeUsers=@('user-33')");
    expect(r.success).toBe(true);
    expect(record('w5c7-ca', 't-ca', sub).complianceVerdict).toBe('SAT');
  });

  it('the admin GET is sent with the pattern substituted (no unfilled token)', async () => {
    const sub = asSub(byId(ADMIN_ID));
    const own = READS[ADMIN_ID];
    const ctx = new ExecutionContext(false);
    const pattern = adminNamingPattern('adm-{firstname}.{lastname}@{domain}');
    ctx.loadManifestVariables({ adminUserName: 'sim.admin', tenantName: 's2-eng.simtenant.onmicrosoft.us', initialPassword: 'Synthetic-Only-1!', adminNamingPattern: pattern });
    const t = session(/^\$roles = @\(/, /^New-MgUser/, own, own);
    await new PowerShellAdapter(makeConfig(), t.manager as any, ctx, undefined, 'w5c7-adm').execute(task('t-adm', [sub], ['AC.L2-3.1.6']), { adminUserName: 'sim.admin', tenantName: 'x', initialPassword: 'p', adminNamingPattern: pattern }, false);
    const get = t.received.find(c => c.startsWith('$roles = @('))!;
    expect(get).toContain("-match '^adm-([a-z0-9\\x27-]+)\\.([a-z0-9\\x27-]+)@[^@\\s]+$')"); // one single-quoted PowerShell string
    expect(get).not.toMatch(/\{adminNamingPattern\}/);
  });
});
