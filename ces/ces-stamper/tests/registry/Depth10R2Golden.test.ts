// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// DEPTH-10.3 (AC) and DEPTH-10.7 (MP), PH-12 agent P12-R2. For every new or changed configuring entry: the
// read the simulator gives after the SET (tenant-stacksim src/resolvers/depth10ACResolvers.test.ts proves the
// SET -> GET round trip; the reads below are those objects after each GET's PowerShell projection) is SAT, the
// read with the configured value absent is NOT_SAT, and the translator puts the entry's literal on the
// objective's postcheck (V94). Entries whose verification was only restructured keep their SAT / NOT_SAT on
// every read (old rule vs new rule). V98: every AC / MP entry names its objectives.
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { CommandRegistry } from '../../src/registry/CommandRegistry';
import { OutputVerificationEngine } from '../../src/core/OutputVerificationEngine';
import { evaluateExpectedValue } from '../../src/core/PostcheckRunner';
import { applyRegistryExpectedValues } from '../../src/translators/objectiveCredit';
import { applyOrganisationValues } from '../../src/translators/orgValues';
import type { CommandEntry } from '../../src/registry/command-registry.types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REGISTRY_PATH = path.resolve(__dirname, '../../src/registry/cmmc-l2-commands.registry.json');
const TPL = '5cf42378-d67d-4f36-ba46-e8b86229381d';
/** Run-time variables the reads carry (S1 values). */
const VARS: Record<string, string> = { cuiGroupId: 'group-1', breakGlassUserId: 'user-50', cuiGroupName: 'CUI-Authorized-Users', operatorUserId: 'user-1', adminUserName: 'cesadmin' };

const registry = CommandRegistry.load(REGISTRY_PATH);
const engine = new OutputVerificationEngine();
const entry = (id: string): CommandEntry => {
  const e = registry.allEntries.find(x => x.entry_id === id);
  if (!e) throw new Error(`no entry ${id}`);
  return e;
};
const withVars = <T>(v: T): T => JSON.parse(JSON.stringify(v).replace(/\{([A-Za-z_]\w*)\}/g, (m, k: string) => VARS[k] ?? m));
const verifyWith = (verification: CommandEntry['verification'], read: unknown): boolean =>
  engine.verify({ stdout: '', stderr: '', exitCode: 0 }, { stdout: JSON.stringify(read), exitCode: 0 }, { evidence: withVars(verification!.evidence) }).passed;
const verify = (id: string, read: unknown) => verifyWith(entry(id).verification, read);
const setAt = (read: unknown, jsonpath: string, value: unknown) => {
  const out = JSON.parse(JSON.stringify(read));
  let node: Record<string, unknown> = out;
  const keys = jsonpath.replace(/^\$\./, '').split('.');
  for (const k of keys.slice(0, -1)) node = node[k] as Record<string, unknown>;
  node[keys[keys.length - 1]] = value;
  return out;
};

const passwordRuleRead = (threshold: string, duration: string) => ({
  id: 'ds-1', templateId: TPL, LockoutThreshold: threshold, LockoutDurationInSeconds: duration,
  values: [{ name: 'EnableBannedPasswordCheck', value: 'True' }, { name: 'LockoutThreshold', value: threshold }, { name: 'LockoutDurationInSeconds', value: duration }],
});
const assigned = [{ id: 'p_group-1', target: { '@odata.type': '#microsoft.graph.groupAssignmentTarget', groupId: 'group-1' } }];

/** entry id -> [objectives it configures, simulator read after its SET] */
const NEW_CONFIGURING: Record<string, [string[], unknown]> = {
  'AC.L2-3.1.8.password-rule-settings': [['AC.L2-3.1.8[b]'], { id: 'ds-1', displayName: 'Password Rule Settings', templateId: TPL, values: [{ name: 'LockoutThreshold', value: '3' }] }],
  'AC.L2-3.1.8.smart-lockout': [['AC.L2-3.1.8[a]', 'AC.L2-3.1.8[b]'], passwordRuleRead('3', '900')],
  'AC.L1-3.1.2.default-user-permissions': [['AC.L1-3.1.2[b]', 'AC.L1-3.1.1[e]'], { id: 'authorizationPolicy', allowedToCreateApps: false, allowedToCreateSecurityGroups: false, allowedToCreateTenants: false, userConsentAllowed: false }],
  'AC.L2-3.1.12.session-monitor': [['AC.L2-3.1.12[d]'], {
    id: 'ca-9', displayName: 'CMMC-RemoteSession-Monitor', state: 'enabled',
    conditions: { users: { includeGroups: ['group-1'], excludeUsers: ['user-50'] }, applications: { includeApplications: ['Office365'] }, clientAppTypes: ['browser'] },
    sessionControls: { cloudAppSecurity: { isEnabled: true, cloudAppSecurityType: 'monitorOnly' } },
  }],
  'AC.L2-3.1.18.ios-compliance': [['AC.L2-3.1.18[b]', 'AC.L2-3.1.19[b]'], {
    id: 'cp-ios', '@odata.type': '#microsoft.graph.iosCompliancePolicy', displayName: 'CMMC-Compliance-iOS', passcodeRequired: true, passcodeBlockSimple: true,
    passcodeMinimumLength: 6, passcodeMinutesOfInactivityBeforeScreenTimeout: 15, securityBlockJailbrokenDevices: true, assignments: assigned,
  }],
  'AC.L2-3.1.19.android-compliance': [['AC.L2-3.1.19[b]', 'AC.L2-3.1.18[b]'], {
    id: 'cp-and', '@odata.type': '#microsoft.graph.androidWorkProfileCompliancePolicy', displayName: 'CMMC-Compliance-Android', passwordRequired: true, passwordRequiredType: 'numericComplex',
    passwordMinimumLength: 6, passwordMinutesOfInactivityBeforeLock: 15, storageRequireEncryption: true, securityBlockJailbrokenDevices: true, assignments: assigned,
  }],
};

describe('DEPTH-10.3 new and re-aimed configuring entries against the simulator reads', () => {
  for (const [id, [objectives, read]] of Object.entries(NEW_CONFIGURING)) {
    describe(id, () => {
      it('names its objectives, has a SET and a literal top-level jsonpath + equals that repeats one of its checks', () => {
        const e = entry(id);
        expect(e.objective_ids).toEqual(objectives);
        expect(e.set_command.trim()).not.toBe('');
        expect(e.source).toMatch(/^https:\/\/learn\.microsoft\.com\//);
        const ev = e.verification!.evidence! as { jsonpath?: string; equals?: string; checks?: Array<{ jsonpath: string; equals?: string }> };
        expect(typeof ev.jsonpath).toBe('string');
        expect(String(ev.equals)).not.toMatch(/\{[A-Za-z_]\w*\}/);
        expect((ev.checks ?? []).some(c => c.jsonpath === ev.jsonpath && c.equals === ev.equals) || (ev.checks ?? []).length === 0).toBe(true);
        expect(e.cost_gate).toBeUndefined(); // no recurring Azure cost (licensed M365 / Entra / Intune features)
      });

      it('is SAT on the read after its SET, and NOT_SAT when each checked value is absent', () => {
        expect(verify(id, read)).toBe(true);
        const ev = entry(id).verification!.evidence!;
        const paths = [ev.jsonpath, ...(ev.checks ?? []).map(c => c.jsonpath)].filter((p): p is string => typeof p === 'string' && !/assignments$/.test(p));
        for (const p of new Set(paths)) expect(verify(id, setAt(read, p, 'not-configured'))).toBe(false);
        if ((ev.checks ?? []).some(c => c.jsonpath === '$.assignments')) expect(verify(id, setAt(read, '$.assignments', []))).toBe(false);
      });

      it('the translator writes the literal on each objective postcheck that has none, and it holds on the read', () => {
        for (const objective of objectives) {
          const pcs = [{ id: `post-${objective}`, description: '', method: 'manual', expected: '', on_fail: 'warn', control_id: objective.slice(0, objective.indexOf('[')), objective_id: objective }];
          const n = applyRegistryExpectedValues(pcs as never, [{ objective_id: objective, type: 'configure', entry_ids: [id] }] as never, new Map([[id, entry(id)]]));
          expect(n).toBe(1);
          const expected = (pcs[0] as { expected_value?: { path: string; op: 'equals'; value: unknown }; method: string });
          expect(expected.method).toBe('config_export');
          expect(evaluateExpectedValue(JSON.stringify(read), expected.expected_value!)).toMatchObject({ found: true, passed: true });
        }
      });
    });
  }
});

describe('AC.L2-3.1.8 smart lockout: the TM answered values configure the SET and hold on the new read', () => {
  const lockout = entry('AC.L2-3.1.8.smart-lockout');
  const tm = (rows: Array<{ path: string; op: string; value: number; source: string }>) => ({
    getControl: (cid: string) => (cid === 'AC.L2-3.1.8' ? { verification: rows.map(r => ({ expected_value: r })) } : undefined),
  });
  const THRESHOLD = "$.values[?(@.name=='LockoutThreshold')].value";
  const DURATION = "$.values[?(@.name=='LockoutDurationInSeconds')].value";

  it('S2 (answered 3 attempts, 1800 s): the SET writes 1800 and the rule asserts it; the TM rows pass on the read', () => {
    const { entry: out, decisions } = applyOrganisationValues(lockout, tm([
      { path: THRESHOLD, op: 'lte', value: 3, source: 'answered' },
      { path: DURATION, op: 'gte', value: 1800, source: 'answered' },
    ]) as never);
    expect(out.set_command).toContain('$LockoutDurationInSeconds=1800;');
    expect(out.set_command).toContain('$LockoutThreshold=3;');
    expect(decisions.map(d => d.configured_value).sort()).toEqual([1800, 3].sort());
    const read = passwordRuleRead('3', '1800');
    expect(verifyWith(out.verification, read)).toBe(true);
    expect(verifyWith(out.verification, passwordRuleRead('3', '900'))).toBe(false);
    expect(evaluateExpectedValue(JSON.stringify(read), { path: DURATION, op: 'gte', value: 1800 })).toMatchObject({ found: true, passed: true });
    expect(evaluateExpectedValue(JSON.stringify(read), { path: THRESHOLD, op: 'lte', value: 3 })).toMatchObject({ found: true, passed: true });
  });

  it('S3 / mp (bank values only): the SET keeps the registry 3 / 900; a weaker answer (10 attempts) keeps 3', () => {
    expect(applyOrganisationValues(lockout, tm([{ path: DURATION, op: 'gte', value: 900, source: 'bank' }]) as never).entry.set_command).toBe(lockout.set_command);
    const weaker = applyOrganisationValues(lockout, tm([{ path: THRESHOLD, op: 'lte', value: 10, source: 'answered' }]) as never);
    expect(weaker.entry.set_command).toContain('$LockoutThreshold=3;');
  });

  it('the SET is an update, not a creation (so a seeded setting with other values is updated, not verified as found)', () => {
    expect(lockout.set_command).not.toMatch(/New-|-Method\s+POST/);
    expect(lockout.set_command).toContain('Update-MgDirectorySetting -DirectorySettingId $s.id -Values $vals');
    expect(entry('AC.L2-3.1.8.password-rule-settings').sequence_hint).toBeLessThan(lockout.sequence_hint);
  });
});

// Entries whose rule was only restructured (top-level literal for V94): the old rule, verbatim, and the new
// rule agree on every read (the replay check).
const RESTRUCTURED: Record<string, { old: unknown; reads: unknown[]; objective: string }> = {
  'AC.L2-3.1.1.group-create': {
    objective: 'AC.L1-3.1.1[a]',
    old: { jsonpath: '$.DisplayName', equals: '{cuiGroupName}', checks: [{ jsonpath: '$.SecurityEnabled', equals: 'true' }] },
    reads: [{ DisplayName: 'CUI-Authorized-Users', SecurityEnabled: true }, { DisplayName: 'CUI-Authorized-Users', SecurityEnabled: false }, { DisplayName: 'Other', SecurityEnabled: true }, {}],
  },
  'AC.L2-3.1.5.pim-eligible': {
    objective: 'AC.L2-3.1.5[b]',
    old: { jsonpath: '$.PrincipalId', equals: '{operatorUserId}', checks: [{ jsonpath: '$.Status', equals: 'Provisioned' }] },
    reads: [{ PrincipalId: 'user-1', Status: 'Provisioned' }, { PrincipalId: 'user-1', Status: 'PendingApproval' }, { PrincipalId: 'user-2', Status: 'Provisioned' }, {}],
  },
  'AC.L2-3.1.6.admin-account': {
    objective: 'AC.L2-3.1.6[b]',
    old: { jsonpath: '$.DisplayName', regex: '^Admin-', checks: [{ jsonpath: '$.DisplayName', equals: 'Admin-{adminUserName}' }, { jsonpath: '$.AccountEnabled', equals: 'true' }] },
    reads: [{ id: 'u', displayName: 'Admin-cesadmin', accountEnabled: true }, { displayName: 'Admin-cesadmin', accountEnabled: false }, { displayName: 'adm.x.y', accountEnabled: true }, {}],
  },
  'AC.L2-3.1.16.wifi-profile': {
    objective: 'AC.L2-3.1.17[b]',
    old: { jsonpath: '$.displayName', equals: 'CMMC-WiFi-Secure', checks: [{ jsonpath: '$.wifiSecurityType', equals: 'wpa2Enterprise' }, { jsonpath: '$.assignments', min_items: 1 }] },
    reads: [
      { displayName: 'CMMC-WiFi-Secure', wifiSecurityType: 'wpa2Enterprise', assignments: assigned },
      { displayName: 'CMMC-WiFi-Secure', wifiSecurityType: 'wpa2Personal', assignments: assigned },
      { displayName: 'CMMC-WiFi-Secure', wifiSecurityType: 'wpa2Enterprise', assignments: [] },
      { displayName: 'Other', wifiSecurityType: 'wpa2Enterprise', assignments: assigned },
    ],
  },
};

describe('DEPTH-10.3 restructured rules: SAT / NOT_SAT unchanged, and the objective postcheck gets the literal', () => {
  for (const [id, { old, reads, objective }] of Object.entries(RESTRUCTURED)) {
    it(`${id}: old and new rule agree on ${reads.length} reads; ${objective} gets the expected value`, () => {
      for (const r of reads) expect(verify(id, r)).toBe(verifyWith({ evidence: old as never }, r));
      expect(verify(id, reads[0])).toBe(true);
      const pcs = [{ id: 'p', description: '', method: 'config_export', expected: '', on_fail: 'warn', control_id: objective.slice(0, objective.indexOf('[')), objective_id: objective }];
      expect(applyRegistryExpectedValues(pcs as never, [{ objective_id: objective, type: 'configure', entry_ids: [id] }] as never, new Map([[id, entry(id)]]))).toBe(1);
      expect(evaluateExpectedValue(JSON.stringify(reads[0]), (pcs[0] as { expected_value?: never }).expected_value!)).toMatchObject({ passed: true });
    });
  }

  it('AC.L2-3.1.20.spo-sharing: the read is now an object; the same value passes and fails as before', () => {
    const oldRule = { regex: '^\\s*"disabled"\\s*$' };
    for (const v of ['disabled', 'externalUserSharingOnly', 'existingExternalUserSharingOnly']) {
      expect(verify('AC.L2-3.1.20.spo-sharing', { sharingCapability: v })).toBe(engine.verify({ stdout: '', stderr: '', exitCode: 0 }, { stdout: JSON.stringify(v), exitCode: 0 }, { evidence: oldRule as never }).passed);
    }
    expect(entry('AC.L2-3.1.20.spo-sharing').get_command).toMatch(/^\[pscustomobject\]@\{ sharingCapability = .*\| ConvertTo-Json -Depth 10$/);
  });
});

// DEPTH-10.7 (MP): the removable-storage block credits MP.L2-3.8.5[a] / 3.8.7[a] / 3.8.8[a] by objective; the
// media-access read selects that policy by effect (as JSON), so a read-only prohibition task can show it.
const BLOCK_READ = {
  id: '51510000-00b4-4000-8000-000000000003', '@odata.type': '#microsoft.graph.windows10GeneralConfiguration', displayName: 'S1-Block-Removable-Storage',
  storageBlockRemovableStorage: true, usbBlocked: true, assignments: [{ id: 'x_group-1', target: { '@odata.type': '#microsoft.graph.groupAssignmentTarget', groupId: 'group-1' } }],
};

describe('DEPTH-10.7 MP entries', () => {
  it('AC.L2-3.1.21.block-storage names the MP objectives it configures; each gets its literal, which holds on the R-F9 S1 read', () => {
    const id = 'AC.L2-3.1.21.block-storage';
    expect(entry(id).control_ids).toEqual(['AC.L2-3.1.21', 'MP.L2-3.8.5', 'MP.L2-3.8.7', 'MP.L2-3.8.8']);
    expect(entry(id).objective_ids).toEqual(['AC.L2-3.1.21[c]', 'MP.L2-3.8.5[a]', 'MP.L2-3.8.7[a]', 'MP.L2-3.8.8[a]']);
    expect(verify(id, BLOCK_READ)).toBe(true);
    for (const objective of ['MP.L2-3.8.5[a]', 'MP.L2-3.8.7[a]', 'MP.L2-3.8.8[a]']) {
      const pcs = [{ id: 'p', description: '', method: 'config_export', expected: '', on_fail: 'warn', control_id: objective.slice(0, objective.indexOf('[')), objective_id: objective }];
      expect(applyRegistryExpectedValues(pcs as never, [{ objective_id: objective, type: 'configure', entry_ids: [id] }] as never, new Map([[id, entry(id)]]))).toBe(1);
      expect((pcs[0] as { expected_value?: unknown }).expected_value).toMatchObject({ path: '$.storageBlockRemovableStorage', op: 'equals', value: 'true' });
      expect(evaluateExpectedValue(JSON.stringify(BLOCK_READ), (pcs[0] as { expected_value?: never }).expected_value!)).toMatchObject({ passed: true });
    }
  });

  it('MP.L2-3.8.5.media-access: JSON read by effect; SAT on the assigned block, NOT_SAT when not blocked or not assigned', () => {
    const id = 'MP.L2-3.8.5.media-access';
    const e = entry(id);
    expect(e.set_command).toBe('');
    expect(e.get_command).toContain('$_.storageBlockRemovableStorage -eq $true');
    expect(e.get_command).not.toMatch(/displayName -like/);
    expect(e.get_command).toMatch(/\| ConvertTo-Json -Depth 10$/);
    expect(e.evidence_commands![0]).not.toContain('CMMC-Removable-Media-Policy');
    expect(verify(id, BLOCK_READ)).toBe(true);
    expect(verify(id, { ...BLOCK_READ, storageBlockRemovableStorage: false })).toBe(false);
    expect(verify(id, { ...BLOCK_READ, assignments: [] })).toBe(false);
    expect(verify(id, '')).toBe(false);
  });

  it('the three MP reads that were untagged now name their objective', () => {
    expect(entry('MP.L2-3.8.9.dlp-policy').objective_ids).toEqual(['AC.L1-3.1.22[e]']);
    expect(entry('MP.L2-3.8.9.dlp-policy').control_ids).toEqual(['MP.L2-3.8.9', 'AC.L1-3.1.22']);
    expect(entry('MP.L2-3.8.7.removable-media-intune').objective_ids).toEqual(['MP.L2-3.8.7[a]']);
    expect(entry('MP.L2-3.8.8.unowned-storage-intune').objective_ids).toEqual(['MP.L2-3.8.8[a]']);
  });
});

describe('V98: every AC and MP entry names its objectives (the held role-assign entry excepted)', () => {
  it('no untagged AC / MP entry', () => {
    const untagged = registry.allEntries
      .filter(e => /^(AC|MP)\./.test(e.entry_id) && e.entry_id !== 'AC.L2-3.1.2.role-assign')
      .filter(e => !(e.objective_ids ?? []).length)
      .map(e => e.entry_id);
    expect(untagged).toEqual([]);
  });
});
