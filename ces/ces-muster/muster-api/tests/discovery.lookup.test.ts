// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// W5c4: discovery verdicts from the Stamper registry's equivalence lookup
// blocks, judged over each block's source list. The blocks are the real
// registry's (sibling ces-stamper checkout, read only); the tenant shapes are
// the S1 simulator's (LOG-W5c2-sim.md §14-§16; fictional ids and names).
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MockGraphClient } from '../src/lib/graphClient.js';
import {
  loadVerdictPredicates,
  runDiscovery,
  toGetEntries,
  type DiscoverySession,
  type RegistryGetEntry,
} from '../src/services/discoveryService.js';
import {
  boundLookupEffect,
  evaluateLookupCondition,
  lookupCandidates,
  lookupSourceCommand,
  lookupVerdict,
  type LookupBlock,
} from '../src/services/discoveryLookup.js';
import {
  AUTH_STRENGTH_READ,
  BUILTIN_PHISHING_RESISTANT_STRENGTH_ID,
  WORKSPACE_READ,
  answerBoundsFromFacts,
  cuiGroupIdFromGroups,
  phishingResistantStrengthFromRead,
  resolveDiscoveryVariables,
  variablesFromAnswers,
} from '../src/services/discoveryVariables.js';
import { ROLE_TEMPLATE, TENANT_READS, tenantFactsFromReads } from '../src/services/harvestService.js';

const REGISTRY = path.resolve(__dirname, '..', '..', '..', 'ces-stamper', 'src', 'registry', 'cmmc-l2-commands.registry.json');
const INFRA_REGISTRY = path.resolve(path.dirname(REGISTRY), 'infra-cmmc-l2-commands.registry.json');
const HAVE_REGISTRY = fs.existsSync(REGISTRY) && fs.existsSync(INFRA_REGISTRY);
// W5c6: both registries, as the walk loads them (AZ-MON-001 is an infrastructure entry).
const ENTRIES: RegistryGetEntry[] = HAVE_REGISTRY
  ? [REGISTRY, INFRA_REGISTRY].flatMap((f) => toGetEntries((JSON.parse(fs.readFileSync(f, 'utf8')) as { entries: unknown[] }).entries))
  : [];
const LOOKUP_IDS = [
  'AC.L2-3.1.10.screen-lock',
  'AC.L2-3.1.11.session-timeout',
  'AC.L2-3.1.14.block-untrusted',
  'AC.L2-3.1.15.admin-mfa',
  'AC.L2-3.1.16.wifi-profile',
  'AC.L2-3.1.21.block-storage',
  'CM.L2-3.4.7.wdac',
  'CM.L2-3.4.9.install-control',
  'IA.L2-3.5.4.auth-strength',
  'MA.L2-3.7.1.update-ring',
  'MA.L2-3.7.5.remote-mfa',
  'MP.L2-3.8.6.bitlocker',
  'RA.L2-3.11.3.vuln-remediation',
  'SC.L2-3.13.12.camera-block',
  'SI.L1-3.14.5.scan-schedule-evidence',
  // W5c5: the Windows compliance entry (Stamper "Run 50 fixes" R3).
  'CM.L2-3.4.1.compliance-policy-windows',
  // W5c6 (LOG-W5c5-stamper.md): the Exchange policy / rule pairs, the admin account, the key vault, the action group.
  'SI.L2-3.14.2.anti-malware',
  'SI.L2-3.14.2.malware-rule',
  'SI.L2-3.14.3.safe-links',
  'SI.L2-3.14.3.safe-links-rule',
  'SC.L2-3.13.13.safe-attach',
  'SC.L2-3.13.13.safe-attach-rule',
  'SC.L2-3.13.15.anti-phish',
  'SC.L2-3.13.15.anti-phish-rule',
  'SC.L2-3.13.15.anti-spam',
  'SC.L2-3.13.15.anti-spam-rule',
  'SC.L2-3.13.15.outbound-spam',
  'SC.L2-3.13.15.outbound-spam-rule',
  'AC.L2-3.1.6.admin-account',
  'SC.L2-3.13.10.key-vault',
  'AZ-MON-001',
  // W5c7 (LOG-W5c7-stamper.md): MFA AND compliant device; the NTP time-sync policy.
  'AC.L1-3.1.1.ca-mfa-compliant-device',
  'AU.L2-3.3.7.time-sync',
  // W7-MX1 part 2 (LOG-W7-ST.md): the verify-only leaver lifecycle workflow inventory.
  'PS.L2-3.9.2.leaver-workflow',
];
const entry = (id: string): RegistryGetEntry => {
  const e = ENTRIES.find((x) => x.entry_id === id);
  if (!e) throw new Error(`registry entry ${id} not found`);
  return e;
};
const block = (id: string): LookupBlock => entry(id).lookup!;

// ── S1 shapes (simulator seeds; fictional) ──────────────────────────────────
const GA = ROLE_TEMPLATE.globalAdministrator;
const BG_EXCL = { excludeUsers: ['user-50', 'user-51'], excludeGroups: ['group-12'] };
const S1_CA = [
  { displayName: 'S1-CA01 Require MFA - all users', state: 'enabled', conditions: { users: { includeUsers: ['All'], ...BG_EXCL }, applications: { includeApplications: ['All'] } }, grantControls: { operator: 'OR', builtInControls: ['mfa'] } },
  { displayName: 'S1-CA02 Phishing-resistant MFA - admin roles', state: 'enabled', conditions: { users: { includeUsers: [], includeRoles: [GA, '194ae4cb-b126-40b2-bd5b-6091b380977d'], ...BG_EXCL }, applications: { includeApplications: ['All'] } }, grantControls: { operator: 'OR', builtInControls: [], authenticationStrength: { id: '00000000-0000-0000-0000-000000000004', displayName: 'Phishing-resistant MFA' } } },
  { displayName: 'S1-CA03 Block legacy authentication', state: 'enabled', conditions: { users: { includeUsers: ['All'], ...BG_EXCL }, applications: { includeApplications: ['All'] }, clientAppTypes: ['exchangeActiveSync', 'other'] }, grantControls: { operator: 'OR', builtInControls: ['block'] } },
  { displayName: 'S1-CA06 Block sign-in from outside US', state: 'enabled', conditions: { users: { includeUsers: ['All'], ...BG_EXCL }, applications: { includeApplications: ['All'] }, locations: { includeLocations: ['All'], excludeLocations: ['51510000-00b1-4000-8000-000000000001'] } }, grantControls: { operator: 'OR', builtInControls: ['block'] } },
  { displayName: 'S1-CA09 Session lifetime 12h - browser', state: 'enabled', conditions: { users: { includeUsers: ['All'], ...BG_EXCL }, applications: { includeApplications: ['All'] }, clientAppTypes: ['browser'] }, sessionControls: { signInFrequency: { value: 12, type: 'hours', isEnabled: true }, persistentBrowser: { mode: 'never', isEnabled: true } } },
];
const assigned = (id: string) => [{ id: `${id}_group-1`, target: { '@odata.type': '#microsoft.graph.groupAssignmentTarget', groupId: 'group-1' } }];
const WIFI = { id: '51510000-00b4-4000-8000-000000000001', '@odata.type': '#microsoft.graph.windowsWifiConfiguration', displayName: 'S1-MACH-CORP Wi-Fi', ssid: 'S1-MACH-CORP', networkName: 'S1-MACH-CORP', wifiSecurityType: 'wpa2Enterprise', connectAutomatically: true, assignments: assigned('w') };
const AV = { id: '51510000-00b4-4000-8000-000000000002', '@odata.type': '#microsoft.graph.windows10GeneralConfiguration', displayName: 'S1-Defender-AV', defenderRequireRealTimeMonitoring: true, defenderScanType: 'full', defenderSystemScanSchedule: 'saturday', defenderScheduledScanTime: '02:00:00.0000000', defenderSignatureUpdateIntervalInHours: 4, assignments: assigned('a') }; // PH-13 (P13-REG lookup, P13-INT): the S1 seed's signature interval (customerHistory.ts S1-Defender-AV)
const STORAGE = { id: '51510000-00b4-4000-8000-000000000003', '@odata.type': '#microsoft.graph.windows10GeneralConfiguration', displayName: 'S1-Block-Removable-Storage', storageBlockRemovableStorage: true, usbBlocked: true, assignments: assigned('s') };
const S1_DEVICE_CONFIGS = [WIFI, AV, STORAGE];
const STRENGTHS = [
  { Id: '00000000-0000-0000-0000-000000000004', DisplayName: 'Phishing-resistant MFA', PolicyType: 'builtIn', AllowedCombinations: ['windowsHelloForBusiness', 'fido2', 'x509CertificateMultiFactor'] },
  { Id: 'authenticationStrengthPolicy-1', DisplayName: 'Sim Phishing-Resistant MFA Strength', PolicyType: 'custom' },
];
const VARS = { cuiGroupId: 'group-1', wifiSsid: 'S1-MACH-CORP', phishingResistantStrengthId: '00000000-0000-0000-0000-000000000004' };
const json = (v: unknown) => JSON.stringify(v, null, 4);

describe('W5c4: lookup conditions (same semantics as Stamper lookup.ts)', () => {
  it('ops over one object, with case-insensitive paths', () => {
    const o = { State: 'Enabled', n: 12, list: ['All', 'x'], empty: [], combos: ['fido2'] };
    expect(evaluateLookupCondition(o, { path: '$.state', op: 'equals', value: 'enabled' })).toBe(true);
    expect(evaluateLookupCondition(o, { path: '$.state', op: 'not_equals', value: 'disabled' })).toBe(true);
    expect(evaluateLookupCondition(o, { path: '$.state', op: 'in', value: ['disabled', 'enabled'] })).toBe(true);
    expect(evaluateLookupCondition(o, { path: '$.list', op: 'contains', value: 'all' })).toBe(true);
    expect(evaluateLookupCondition(o, { path: '$.combos', op: 'all_in', value: ['fido2', 'x'] })).toBe(true);
    expect(evaluateLookupCondition(o, { path: '$.empty', op: 'all_in', value: ['fido2'] })).toBe(false);
    expect(evaluateLookupCondition(o, { path: '$.n', op: 'lte', value: 8 })).toBe(false);
    expect(evaluateLookupCondition(o, { path: '$.n', op: 'gte', value: 1 })).toBe(true);
    expect(evaluateLookupCondition(o, { path: '$.missing', op: 'lte', value: 8 })).toBe(false);
    expect(evaluateLookupCondition(o, { path: '$.empty', op: 'not_empty' })).toBe(false);
  });
  it('a value that is still a {variable} is undecidable, never false; a resolved one decides', () => {
    const c = { path: '$.ssid', op: 'equals' as const, value: '{wifiSsid}' };
    expect(evaluateLookupCondition(WIFI, c)).toBeNull();
    expect(evaluateLookupCondition(WIFI, c, { wifiSsid: 'S1-MACH-CORP' })).toBe(true);
    expect(evaluateLookupCondition(WIFI, c, { wifiSsid: 'OTHER' })).toBe(false);
    // `in`: a resolved member that matches decides even with an unresolved one beside it.
    const inC = { path: '$.id', op: 'in' as const, value: ['a', '{x}'] };
    expect(evaluateLookupCondition({ id: 'a' }, inC)).toBe(true);
    expect(evaluateLookupCondition({ id: 'b' }, inC)).toBeNull();
  });
  it('the source read: one object, an array, empty, or not JSON', () => {
    expect(lookupCandidates(json(WIFI))).toHaveLength(1);
    expect(lookupCandidates(json(S1_DEVICE_CONFIGS))).toHaveLength(3);
    expect(lookupCandidates('')).toEqual([]);
    expect(lookupCandidates('Name : x')).toBeNull();
  });
});

describe.skipIf(!HAVE_REGISTRY)('W5c4: the 15 registry lookup blocks on S1 shapes', () => {
  it('the lookup entries Muster judges carry a block and a lookup_effect predicate; every such row names a block', () => {
    // W5c5: the registry may carry further blocks Muster has no row for yet (14 Exchange / admin-account /
    // key-vault blocks appeared while this slice ran); those stay judged by their own predicate or unknown.
    const withBlock = new Set(ENTRIES.filter((e) => e.lookup).map((e) => e.entry_id));
    for (const id of LOOKUP_IDS) expect(withBlock.has(id), id).toBe(true);
    const preds = loadVerdictPredicates();
    const lookupRows = Object.entries(preds).filter(([, p]) => p.expect && 'lookup_effect' in p.expect).map(([id]) => id);
    expect(lookupRows.filter((id) => !preds[id].from_entry).sort()).toEqual([...LOOKUP_IDS].sort());
    for (const [id, p] of Object.entries(preds)) {
      if (p.expect && 'lookup_effect' in p.expect) expect(withBlock.has(p.from_entry ?? id), id).toBe(true);
    }
  });
  it('the walk reads the source list, not the one-object GET', () => {
    expect(lookupSourceCommand(block('AC.L2-3.1.15.admin-mfa'))).toBe(
      "(Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/identity/conditionalAccess/policies').value | ConvertTo-Json -Depth 10"
    );
  });

  const v = (id: string, list: unknown, vars: Record<string, string> = VARS, bounds?: Record<string, number>) =>
    lookupVerdict(block(id), json(list), { variables: vars, bindings: entry(id).org_value_bindings, bounds });

  it('CA: S1-CA02 meets admin MFA, S1-CA06 untrusted locations, S1-CA01 remote MFA', () => {
    expect(v('AC.L2-3.1.15.admin-mfa', S1_CA)).toBe('met');
    expect(v('AC.L2-3.1.14.block-untrusted', S1_CA)).toBe('met');
    expect(v('MA.L2-3.7.5.remote-mfa', S1_CA)).toBe('met');
  });
  it('CA: session timeout is not met on S1 (S1-CA09 signs in every 12 h; the bound is 8 h)', () => {
    expect(v('AC.L2-3.1.11.session-timeout', S1_CA)).toBe('not_met');
    // W5c5 (Stamper "Run 50 fixes"): the block now also needs all client apps, so a 4 h copy of the
    // browser-only CA09 is still not met; the same copy for every client app is.
    const fourHours = { ...S1_CA[4], sessionControls: { ...S1_CA[4].sessionControls, signInFrequency: { value: 4, type: 'hours', isEnabled: true } } };
    expect(v('AC.L2-3.1.11.session-timeout', [fourHours])).toBe('not_met');
    const allClients = { ...fourHours, conditions: { ...fourHours.conditions, clientAppTypes: [] as string[] } };
    expect(v('AC.L2-3.1.11.session-timeout', [allClients])).toBe('met');
  });
  it('CA: a disabled copy of S1-CA02 is not met; an unresolved strength variable still meets on the built-in id', () => {
    expect(v('AC.L2-3.1.15.admin-mfa', [{ ...S1_CA[1], state: 'disabled' }])).toBe('not_met');
    expect(v('AC.L2-3.1.15.admin-mfa', S1_CA, {})).toBe('met');
  });
  it('CA: the muster-mfa-disabled / report-only shapes (an MFA policy disabled or report-only) are not met', () => {
    const caPolicy = (state: string) => ({ id: 'caPolicy-1', displayName: 'Sim CA Policy 1', state, grantControls: { operator: 'OR', builtInControls: ['mfa'] } });
    for (const state of ['disabled', 'enabledForReportingButNotEnforced']) {
      for (const id of ['AC.L2-3.1.14.block-untrusted', 'AC.L2-3.1.15.admin-mfa', 'AC.L2-3.1.11.session-timeout']) {
        expect(v(id, [caPolicy(state)]), `${id} ${state}`).toBe('not_met');
      }
    }
    // Remote-maintenance MFA accepts report-only by design (CES's own policy is report-only), so scope decides:
    // this generic policy names no users or apps, so it is not met.
    expect(v('MA.L2-3.7.5.remote-mfa', [caPolicy('enabledForReportingButNotEnforced')])).toBe('not_met');
  });
  it('Intune: Wi-Fi, removable storage and the scan schedule are met on the assigned S1 seeds', () => {
    expect(v('AC.L2-3.1.16.wifi-profile', S1_DEVICE_CONFIGS)).toBe('met');
    expect(v('AC.L2-3.1.21.block-storage', S1_DEVICE_CONFIGS)).toBe('met');
    expect(v('SI.L1-3.14.5.scan-schedule-evidence', S1_DEVICE_CONFIGS)).toBe('met');
    // PH-13 (P13-REG): a policy that never checks for signature updates (interval 0) is not an equivalent.
    expect(v('SI.L1-3.14.5.scan-schedule-evidence', [{ ...AV, defenderSignatureUpdateIntervalInHours: 0 }])).toBe('not_met');
  });
  it('Intune: without the answered SSID the Wi-Fi verdict is unknown, not not_met; another SSID is not met', () => {
    expect(v('AC.L2-3.1.16.wifi-profile', S1_DEVICE_CONFIGS, { cuiGroupId: 'group-1' })).toBe('unknown');
    expect(v('AC.L2-3.1.16.wifi-profile', S1_DEVICE_CONFIGS, { ...VARS, wifiSsid: 'GUEST' })).toBe('not_met');
  });
  it('Intune: an unassigned equivalent is not met (it maintains no device)', () => {
    expect(v('AC.L2-3.1.21.block-storage', [{ ...STORAGE, assignments: [] }])).toBe('not_met');
  });
  it('Intune: S1 seeds no screen lock, app control, install control, camera, BitLocker or update ring: not met', () => {
    for (const id of [
      'AC.L2-3.1.10.screen-lock',
      'CM.L2-3.4.7.wdac',
      'CM.L2-3.4.9.install-control',
      'SC.L2-3.13.12.camera-block',
      'MP.L2-3.8.6.bitlocker',
      'MA.L2-3.7.1.update-ring',
      'RA.L2-3.11.3.vuln-remediation',
    ])
      expect(v(id, S1_DEVICE_CONFIGS), id).toBe('not_met');
  });
  it('the built-in phishing-resistant strength meets IA.L2-3.5.4; a custom strength without combinations alone does not', () => {
    expect(v('IA.L2-3.5.4.auth-strength', STRENGTHS)).toBe('met');
    expect(v('IA.L2-3.5.4.auth-strength', [STRENGTHS[1]])).toBe('not_met');
  });
  it('W5c5 odata_type: the same settings on another object type are not an equivalent (exact @odata.type, as Stamper)', () => {
    expect(v('AC.L2-3.1.21.block-storage', [{ ...STORAGE, '@odata.type': '#microsoft.graph.windows10EndpointProtectionConfiguration' }])).toBe('not_met');
    expect(v('AC.L2-3.1.21.block-storage', [{ ...STORAGE, '@odata.type': undefined }])).toBe('not_met');
    // The scan schedule accepts either listed type.
    expect(v('SI.L1-3.14.5.scan-schedule-evidence', [{ ...AV, '@odata.type': '#microsoft.graph.windows10EndpointProtectionConfiguration' }])).toBe('met');
  });
  it('W5c5 empty: a CA policy narrowed by platform, client app or sign-in risk is not an equivalent', () => {
    const ca02 = S1_CA[1];
    expect(v('AC.L2-3.1.15.admin-mfa', [{ ...ca02, conditions: { ...ca02.conditions, platforms: { includePlatforms: ['iOS'] } } }])).toBe('not_met');
    expect(v('AC.L2-3.1.15.admin-mfa', [{ ...ca02, conditions: { ...ca02.conditions, clientAppTypes: ['browser'] } }])).toBe('not_met');
    expect(v('AC.L2-3.1.15.admin-mfa', [{ ...ca02, conditions: { ...ca02.conditions, signInRiskLevels: ['high'] } }])).toBe('not_met');
    // "all" platforms or client apps is no narrowing.
    expect(v('AC.L2-3.1.15.admin-mfa', [{ ...ca02, conditions: { ...ca02.conditions, clientAppTypes: ['all'] } }])).toBe('met');
  });
  it('W5c5: remote-maintenance MFA no longer takes an admin phishing-resistant policy (the run-50 defect)', () => {
    const adminOnly = { ...S1_CA[1], displayName: 'CMMC-AdminMFA-PhishingResistant' };
    expect(v('MA.L2-3.7.5.remote-mfa', [adminOnly])).toBe('not_met');
    expect(v('MA.L2-3.7.5.remote-mfa', S1_CA)).toBe('met'); // S1-CA01
  });
  it('W5c5: the Windows compliance entry on the S1 policy; length / history tightened by the answers, the lock held to 15', () => {
    const policy = {
      id: 'deviceCompliancePolicy-1',
      '@odata.type': '#microsoft.graph.windows10CompliancePolicy',
      displayName: 'S1 Windows 11 staff and kiosk compliance',
      passwordRequired: true,
      passwordMinimumLength: 14,
      passwordPreviousPasswordBlockCount: 24,
      passwordMinutesOfInactivityBeforeLock: 15,
      bitLockerEnabled: true,
      secureBootEnabled: true,
      codeIntegrityEnabled: true,
      defenderEnabled: true,
      rtpEnabled: true,
      osMinimumVersion: '10.0.22621',
      assignments: assigned('cp'),
    };
    const ios = { id: 'ios-1', '@odata.type': '#microsoft.graph.iosCompliancePolicy', displayName: 'S1 iOS compliance', passcodeRequired: true, assignments: assigned('i') };
    const answered = answerBoundsFromFacts([
      { question_id: 'PI.ODP.003', answer: '10' },
      { question_id: 'PI.ODP.004', answer: '14' },
      { question_id: 'PI.ODP.005', answer: '24' },
    ]);
    const id = 'CM.L2-3.4.1.compliance-policy-windows';
    expect(v(id, [policy, ios], VARS, answered)).toBe('met'); // lock 15 passes: exists_bound registry, not the answered 10
    expect(v(id, [ios], VARS, answered)).toBe('not_met');
    expect(v(id, [{ ...policy, passwordPreviousPasswordBlockCount: 12 }], VARS, answered)).toBe('not_met');
    const stricter = answerBoundsFromFacts([{ question_id: 'PI.ODP.004', answer: '16' }]);
    expect(v(id, [policy], VARS, stricter)).toBe('not_met'); // 14 < the answered 16
  });
  it('W5c5 from_entry lookup: MP.L2-3.8.7 / MP.L2-3.8.8 take the block-storage verdict; their own defective read stays empty', async () => {
    const exec = vi.fn(async (_e: string, cmd: string) => ({
      stdout: cmd.includes('deviceConfigurations?$expand=assignments') ? json(S1_DEVICE_CONFIGS) : '',
      stderr: '',
      exitCode: 0,
      durationMs: 1,
    }));
    const pick = ['AC.L2-3.1.21.block-storage', 'MP.L2-3.8.7.removable-media-intune', 'MP.L2-3.8.8.unowned-storage-intune'].map(entry);
    const r = await runDiscovery(pick, { execute: exec }, { write: () => 'cap' }, { variables: VARS });
    // PH-12 (LOG-PH12-R2.md, cross-credit): block-storage also lists MP.L2-3.8.5, 3.8.7 and 3.8.8, so
    // those controls carry block-storage's own observation beside their companion entry's.
    const BS = 'AC.L2-3.1.21.block-storage';
    expect(entry(BS).control_ids).toEqual(['AC.L2-3.1.21', 'MP.L2-3.8.5', 'MP.L2-3.8.7', 'MP.L2-3.8.8']);
    const posture = (c: string, by?: string) =>
      r.observations.filter((o) => o.control_id === c && (!by || o.ran_entry_ids[0] === by)).map((o) => o.derived_posture);
    expect(posture('AC.L2-3.1.21')).toEqual(['met']);
    expect(posture('MP.L2-3.8.5')).toEqual(['met']);
    expect(posture('MP.L2-3.8.7', BS)).toEqual(['met']);
    expect(posture('MP.L2-3.8.7', 'MP.L2-3.8.7.removable-media-intune')).toEqual(['met']);
    expect(posture('MP.L2-3.8.8', BS)).toEqual(['met']);
    expect(posture('MP.L2-3.8.8', 'MP.L2-3.8.8.unowned-storage-intune')).toEqual(['met']);
    expect(posture('MP.L2-3.8.7')).toHaveLength(2);
    expect(posture('MP.L2-3.8.8')).toHaveLength(2);
    const unassigned = S1_DEVICE_CONFIGS.map((c) => ({ ...c, assignments: [] }));
    const r2 = await runDiscovery(pick, { execute: async (_e, cmd) => ({ stdout: cmd.includes('$expand=assignments') ? json(unassigned) : '', stderr: '', exitCode: 0, durationMs: 1 }) }, { write: () => 'cap' }, { variables: VARS });
    const posture2 = (c: string, by: string) =>
      r2.observations.filter((o) => o.control_id === c && o.ran_entry_ids[0] === by).map((o) => o.derived_posture);
    expect(posture2('MP.L2-3.8.7', 'MP.L2-3.8.7.removable-media-intune')).toEqual(['not_met']);
    expect(posture2('MP.L2-3.8.7', BS)).toEqual(['not_met']);
    expect(r2.observations.filter((o) => o.control_id === 'MP.L2-3.8.7')).toHaveLength(2);
  });
  it('an empty source list is unknown (nothing to judge)', () => {
    for (const id of LOOKUP_IDS) expect(lookupVerdict(block(id), '', { variables: VARS }), id).toBe('unknown');
  });
  it('the answered bound tightens screen lock (PI.ODP.003 = 10 minutes), never weakens it', () => {
    const at = (m: number) => [{ id: 'c1', '@odata.type': '#microsoft.graph.windows10GeneralConfiguration', displayName: 'Org screen lock', passwordRequired: true, passwordMinutesOfInactivityBeforeScreenTimeout: m, assignments: assigned('c1') }];
    const bounds = answerBoundsFromFacts([{ question_id: 'PI.ODP.003', answer: '10' }]);
    expect(v('AC.L2-3.1.10.screen-lock', at(12))).toBe('met'); // registry bound 15
    expect(v('AC.L2-3.1.10.screen-lock', at(12), VARS, bounds)).toBe('not_met');
    expect(v('AC.L2-3.1.10.screen-lock', at(5), VARS, bounds)).toBe('met');
    const weaker = answerBoundsFromFacts([{ question_id: 'PI.ODP.003', answer: '30' }]);
    expect(v('AC.L2-3.1.10.screen-lock', at(20), VARS, weaker)).toBe('not_met');
    // A bound applies only on a path the entry binds: the Wi-Fi block is untouched.
    expect(boundLookupEffect(block('AC.L2-3.1.16.wifi-profile'), entry('AC.L2-3.1.16.wifi-profile').org_value_bindings, bounds)).toBe(
      block('AC.L2-3.1.16.wifi-profile').by_effect
    );
  });

  it('runDiscovery: a lookup entry runs its source read and posts the verdict per control', async () => {
    const exec = vi.fn(async (_e: string, cmd: string) => ({
      stdout: cmd.includes('conditionalAccess/policies') ? json(S1_CA) : cmd.includes('deviceConfigurations') ? json(S1_DEVICE_CONFIGS) : '',
      stderr: '',
      exitCode: 0,
      durationMs: 1,
    }));
    const session: DiscoverySession = { execute: exec };
    const pick = ['AC.L2-3.1.14.block-untrusted', 'AC.L2-3.1.11.session-timeout', 'AC.L2-3.1.16.wifi-profile', 'AC.L2-3.1.10.screen-lock'].map(entry);
    const r = await runDiscovery(pick, session, { write: () => 'cap' }, { variables: VARS, bounds: { '$.passwordminutesofinactivitybeforescreentimeout': 10 } });
    expect(exec.mock.calls.every(([, cmd]) => cmd.endsWith('| ConvertTo-Json -Depth 10') && !cmd.includes('Where-Object'))).toBe(true);
    const posture = (c: string) => r.observations.filter((o) => o.control_id === c).map((o) => o.derived_posture);
    expect(posture('AC.L2-3.1.14')).toEqual(['met']);
    expect(posture('SC.L2-3.13.7')).toEqual(['met']);
    expect(posture('AC.L2-3.1.11')).toEqual(['not_met']);
    expect(posture('AC.L2-3.1.16')).toEqual(['met']);
    expect(posture('AC.L2-3.1.10')).toEqual(['not_met']);
    expect(posture('SC.L2-3.13.9')).toEqual(['not_met']);
    expect(r.observations.every((o) => o.confidence === 'high')).toBe(true);
  });
  it('runDiscovery: an empty or failed source read stays unknown', async () => {
    const empty: DiscoverySession = { execute: async () => ({ stdout: '', stderr: '', exitCode: 0, durationMs: 1 }) };
    const failed: DiscoverySession = { execute: async () => ({ stdout: '', stderr: 'boom', exitCode: 1, durationMs: 1 }) };
    for (const s of [empty, failed]) {
      const r = await runDiscovery([entry('AC.L2-3.1.15.admin-mfa')], s, { write: () => 'cap' }, { variables: VARS });
      expect(r.observations.map((o) => o.derived_posture)).toEqual(['unknown']);
    }
  });
});

describe('W5c4: the lookup variables', () => {
  const GROUPS = {
    value: [
      { id: 'group-4', displayName: 'S1-All-Staff', securityEnabled: true },
      { id: 'group-1', displayName: 'CUI-Authorized-Users', securityEnabled: true },
      { id: 'group-9', displayName: 'S1-CUI-Program-Team', securityEnabled: true },
      { id: 'dl-1', displayName: 'CUI newsletter', securityEnabled: false },
    ],
  };
  it('cuiGroupId <- the first security group naming CUI (the cuiGroupName rule)', () => {
    expect(cuiGroupIdFromGroups(GROUPS)).toBe('group-1');
    expect(cuiGroupIdFromGroups({ value: [{ id: 'x', displayName: 'S1-All-Staff', securityEnabled: true }] })).toBe('');
  });
  it('phishingResistantStrengthId <- the built-in strength in the read; else the platform constant', async () => {
    const read = { value: [{ id: '00000000-0000-0000-0000-000000000004', displayName: 'Phishing-resistant MFA', policyType: 'builtIn', allowedCombinations: ['windowsHelloForBusiness', 'fido2', 'x509CertificateMultiFactor'] }, { id: 'p-2', policyType: 'builtIn', allowedCombinations: ['password,sms'] }] };
    expect(phishingResistantStrengthFromRead(read)).toBe('00000000-0000-0000-0000-000000000004');
    expect(phishingResistantStrengthFromRead({ value: [{ id: 'c', policyType: 'custom', allowedCombinations: ['fido2'] }] })).toBe('');
    const noop: DiscoverySession = { execute: async () => ({ stdout: '', stderr: '', exitCode: 0, durationMs: 1 }) };
    const served = await resolveDiscoveryVariables(new MockGraphClient({ [TENANT_READS.groups]: GROUPS, [AUTH_STRENGTH_READ]: read }), noop);
    expect(served.cuiGroupId).toBe('group-1');
    expect(served.phishingResistantStrengthId).toBe('00000000-0000-0000-0000-000000000004');
    const unserved = await resolveDiscoveryVariables(new MockGraphClient({}), noop);
    expect(unserved.phishingResistantStrengthId).toBe(BUILTIN_PHISHING_RESISTANT_STRENGTH_ID);
    expect(unserved.cuiGroupId).toBeUndefined();
    void WORKSPACE_READ;
  });
  it('wifiSsid <- the answer TCP.MU.006 (last decisive answer); the answers reach resolveDiscoveryVariables', async () => {
    const answers = [
      { question_id: 'TCP.MU.006', answer: 'OLD' },
      { question_id: 'TCP.MU.006', answer: 'S1-MACH-CORP' },
      { question_id: 'TCP.MU.006', answer: "I'm not sure", confidence: 'unknown' },
    ];
    expect(variablesFromAnswers(answers)).toEqual({ wifiSsid: 'S1-MACH-CORP' });
    expect(variablesFromAnswers([])).toEqual({});
    // W5c6: the answered security mailbox is Stamper's cisoEmail too (AZ-MON-001).
    expect(variablesFromAnswers([{ question_id: 'TCP.MU.007', answer: 'security@s1-mach.simtenant.onmicrosoft.us' }])).toEqual({
      cisoEmail: 'security@s1-mach.simtenant.onmicrosoft.us',
    });
    const noop: DiscoverySession = { execute: async () => ({ stdout: '', stderr: '', exitCode: 0, durationMs: 1 }) };
    expect((await resolveDiscoveryVariables(null, noop, undefined, answers)).wifiSsid).toBe('S1-MACH-CORP');
  });
  it('answered bounds: PI.ODP.003 minutes on the screen-lock path; non-numbers ignored', () => {
    expect(answerBoundsFromFacts([{ question_id: 'PI.ODP.003', answer: '10' }])).toEqual({ '$.passwordminutesofinactivitybeforescreentimeout': 10 });
    expect(answerBoundsFromFacts([{ question_id: 'PI.ODP.003', answer: 'ten' }])).toEqual({});
  });
});

describe('W5c4: TCP.PA.003 reads the PIM eligibility schedules too', () => {
  const D = 's1-mach.simtenant.onmicrosoft.us';
  const ISSM = `adm.issm@${D}`;
  const base = {
    users: { value: [{ id: 'user-46', userPrincipalName: ISSM }, { id: 'user-50', userPrincipalName: `bg.access01@${D}` }] },
    roleAssignments: { value: [{ principalId: 'user-50', roleDefinitionId: ROLE_TEMPLATE.globalAdministrator }] },
  };
  const pa003 = (reads: Record<string, unknown>) => tenantFactsFromReads(reads, 'now').find((f) => f.question_id === 'TCP.PA.003');
  it('an eligible Compliance Administrator (no standing assignment) is a holder, sourced from roleEligibility', () => {
    const f = pa003({ ...base, roleEligibility: { value: [{ principalId: 'user-46', roleDefinitionId: ROLE_TEMPLATE.complianceAdministrator, memberType: 'Direct', status: 'Provisioned' }] } });
    expect(f?.answer).toBe(ISSM);
    expect(f?.source).toBe('graph:roleEligibility');
  });
  it('active and eligible holders are listed once each; active-only keeps the roleAssignments source', () => {
    const active = { value: [...base.roleAssignments.value, { principalId: 'user-46', roleDefinitionId: ROLE_TEMPLATE.complianceAdministrator }] };
    const both = pa003({ ...base, roleAssignments: active, roleEligibility: { value: [{ principalId: 'user-46', roleDefinitionId: ROLE_TEMPLATE.complianceAdministrator }] } });
    expect(both?.answer).toBe(ISSM);
    expect(both?.source).toBe('graph:roleAssignments');
  });
  it('no holder either way: no fact; another role eligibility does not count', () => {
    expect(pa003({ ...base, roleEligibility: { value: [{ principalId: 'user-46', roleDefinitionId: ROLE_TEMPLATE.securityAdministrator }] } })).toBeUndefined();
    expect(pa003(base)).toBeUndefined();
  });
});

const RUN51 = path.resolve(__dirname, '..', '..', '..', '..', 'out', 'captures');
// W5c6: <WS>\out holds whichever scenario ran last; replay only while it is S1's.
const OUT_IS_S1 = (() => {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(RUN51, '..', 'discovery-result.json'), 'utf8')) as { manifest?: { tenant?: { slug?: string } } };
    return d.manifest?.tenant?.slug === 's1-mach';
  } catch {
    return false;
  }
})();
describe.skipIf(!HAVE_REGISTRY || !OUT_IS_S1 || !fs.existsSync(path.join(RUN51, 'AC.L2-3.1.15.admin-mfa.txt')))('W5c5: the run-51 S1 source-read captures through the evaluator', () => {
  it('the CA, Intune and strength lists decide as predicted (wifi with the answered SSID)', () => {
    const cap = (id: string) => fs.readFileSync(path.join(RUN51, id + '.txt'), 'utf8');
    // PH-13 (LOG-PH13-UNIT.md): W5c6, W5c7 and W7 grew LOOKUP_IDS without extending this replay; it
    // stayed hidden while <WS>\out held another scenario. On S1 these five rule reads return nothing
    // (only built-in policies, no rule), and the walk writes a capture only for non-empty output
    // (discoveryService.ts `capture.write`), so these five rule captures do not exist.
    const ABSENT_ON_S1 = [
      'SI.L2-3.14.2.malware-rule',
      'SC.L2-3.13.13.safe-attach-rule',
      'SC.L2-3.13.15.anti-phish-rule',
      'SC.L2-3.13.15.anti-spam-rule',
      'SC.L2-3.13.15.outbound-spam-rule',
    ];
    for (const id of ABSENT_ON_S1) expect(fs.existsSync(path.join(RUN51, id + '.txt')), id).toBe(false);
    const verdicts = Object.fromEntries(
      LOOKUP_IDS.filter((id) => id !== 'CM.L2-3.4.1.compliance-policy-windows' && !ABSENT_ON_S1.includes(id)).map((id) => [
        id,
        lookupVerdict(block(id), cap(id), { variables: VARS, bindings: entry(id).org_value_bindings, bounds: { '$.passwordminutesofinactivitybeforescreentimeout': 10 } }),
      ])
    );
    expect(verdicts).toEqual({
      'AC.L2-3.1.10.screen-lock': 'not_met',
      'AC.L2-3.1.11.session-timeout': 'not_met',
      'AC.L2-3.1.14.block-untrusted': 'met',
      'AC.L2-3.1.15.admin-mfa': 'met',
      'AC.L2-3.1.16.wifi-profile': 'met',
      'AC.L2-3.1.21.block-storage': 'met',
      'CM.L2-3.4.7.wdac': 'not_met',
      'CM.L2-3.4.9.install-control': 'not_met',
      'IA.L2-3.5.4.auth-strength': 'met',
      'MA.L2-3.7.1.update-ring': 'not_met',
      'MA.L2-3.7.5.remote-mfa': 'met',
      'MP.L2-3.8.6.bitlocker': 'not_met',
      'RA.L2-3.11.3.vuln-remediation': 'not_met',
      'SC.L2-3.13.12.camera-block': 'not_met',
      'SI.L1-3.14.5.scan-schedule-evidence': 'met',
      // PH-13: the W5c6/W5c7/W7 ids, as the R-F10 S1 discovery captures decide (2026-11-01, before Stamper).
      'SI.L2-3.14.2.anti-malware': 'not_met', // built-in policies only
      'SI.L2-3.14.3.safe-links': 'met', // the S1 custom policy meets by effect
      // Judged alone, the rule cannot decide: {safeLinksPolicyName} is captured in the walk and
      // {primaryDomain} is not in VARS. The walk tests in the W5c6 block judge it.
      'SI.L2-3.14.3.safe-links-rule': 'unknown',
      'SC.L2-3.13.13.safe-attach': 'not_met',
      'SC.L2-3.13.15.anti-phish': 'not_met',
      'SC.L2-3.13.15.anti-spam': 'not_met',
      'SC.L2-3.13.15.outbound-spam': 'not_met',
      'AC.L2-3.1.6.admin-account': 'met',
      'SC.L2-3.13.10.key-vault': 'met',
      'AZ-MON-001': 'unknown', // {cisoEmail} is not in VARS: undecidable, never false
      'AC.L1-3.1.1.ca-mfa-compliant-device': 'not_met',
      'AU.L2-3.3.7.time-sync': 'met',
      'PS.L2-3.9.2.leaver-workflow': 'not_met',
    });
  });
});

// ── W5c6: the Exchange pairs (captured policy names), admin account, key vault, action group ──
describe.skipIf(!HAVE_REGISTRY)('W5c6: the new lookup blocks on S1 / muster-partial shapes', () => {
  const D = 's1-mach.simtenant.onmicrosoft.us';
  const BUILTIN_SL = { Name: 'Built-In Protection Policy', IsDefault: true, IsBuiltInProtection: true, EnableSafeLinksForEmail: true, ScanUrls: true, EnableForInternalSenders: true };
  const S1_SL = { Name: 'S1 Safe Links - all users', IsDefault: false, EnableSafeLinksForEmail: true, EnableSafeLinksForTeams: true, ScanUrls: true, EnableForInternalSenders: true, DeliverMessageAfterScan: true, TrackClicks: true };
  const S1_SL_RULE = { Name: 'S1 Safe Links rule', SafeLinksPolicy: 'S1 Safe Links - all users', RecipientDomainIs: [D], State: 'Enabled', Priority: 0 };
  const walkVars = { ...VARS, primaryDomain: D };
  const v = (id: string, list: unknown, vars: Record<string, string> = VARS) =>
    lookupVerdict(block(id), json(list), { variables: vars, bindings: entry(id).org_value_bindings });
  const session = (lists: Record<string, unknown>): DiscoverySession => ({
    execute: vi.fn(async (_e: string, cmd: string) => {
      const key = Object.keys(lists).find((k) => cmd.startsWith(k + ' ') || cmd.startsWith(k + ' |'));
      return { stdout: key ? json(lists[key]) : '', stderr: '', exitCode: 0, durationMs: 1 };
    }),
  });
  const pair = ['SI.L2-3.14.3.safe-links', 'SI.L2-3.14.3.safe-links-rule'];
  // The walk emits one observation per control an entry lists (discoveryService.ts pushForEntry).
  // PH-12 (DEPTH-10) tags several of these entries with a second control (for example SI.L2-3.14.6), so
  // the assertions read each entry's own rows: one per control, every row with the same posture.
  type Walk = Awaited<ReturnType<typeof runDiscovery>>;
  const postures = (r: Walk, id: string): string[] => {
    const rows = r.observations.filter((o) => o.ran_entry_ids[0] === id);
    expect(rows.map((o) => o.control_id), id).toEqual(entry(id).control_ids);
    return [...new Set(rows.map((o) => o.derived_posture))];
  };

  it('S1: the Safe Links policy meets by effect (the built-in never counts); its name is captured and the rule meets on it', async () => {
    const r = await runDiscovery(pair.map(entry), session({ 'Get-SafeLinksPolicy': [BUILTIN_SL, S1_SL], 'Get-SafeLinksRule': [S1_SL_RULE] }), { write: () => 'cap' }, { variables: walkVars });
    expect(r.observations.map((o) => [o.ran_entry_ids[0], o.control_id, o.derived_posture])).toEqual([
      ['SI.L2-3.14.3.safe-links', 'SI.L2-3.14.3', 'met'],
      ['SI.L2-3.14.3.safe-links', 'SI.L2-3.14.6', 'met'],
      ['SI.L2-3.14.3.safe-links-rule', 'SI.L2-3.14.3', 'met'],
      ['SI.L2-3.14.3.safe-links-rule', 'SI.L2-3.14.6', 'met'],
    ]);
    expect(r.stats.awaiting_create).toBe(0);
  });
  it('the rule order in the walk does not matter (the rule is judged after its policy)', async () => {
    const r = await runDiscovery([...pair].reverse().map(entry), session({ 'Get-SafeLinksPolicy': [S1_SL], 'Get-SafeLinksRule': [S1_SL_RULE] }), { write: () => 'cap' }, { variables: walkVars });
    expect(r.observations.find((o) => o.ran_entry_ids[0] === 'SI.L2-3.14.3.safe-links-rule')?.derived_posture).toBe('met');
  });
  it('a rule on another policy, a disabled rule, or a rule outside the primary domain is not met', async () => {
    for (const bad of [{ ...S1_SL_RULE, SafeLinksPolicy: 'Other' }, { ...S1_SL_RULE, State: 'Disabled' }, { ...S1_SL_RULE, RecipientDomainIs: ['other.example'] }]) {
      const r = await runDiscovery(pair.map(entry), session({ 'Get-SafeLinksPolicy': [S1_SL], 'Get-SafeLinksRule': [bad] }), { write: () => 'cap' }, { variables: walkVars });
      expect(postures(r, pair[0])).toEqual(['met']);
      expect(postures(r, pair[1])).toEqual(['not_met']);
    }
  });
  it('muster-partial (built-ins only): the policy is not met; the rule is recorded awaiting_create, posture unknown', async () => {
    const r = await runDiscovery(pair.map(entry), session({ 'Get-SafeLinksPolicy': [BUILTIN_SL], 'Get-SafeLinksRule': [] }), { write: () => 'cap' }, { variables: walkVars });
    expect(postures(r, pair[0])).toEqual(['not_met']);
    expect(postures(r, pair[1])).toEqual(['unknown']);
    expect(r.statuses.find((x) => x.entry_id === 'SI.L2-3.14.3.safe-links-rule')).toEqual({
      entry_id: 'SI.L2-3.14.3.safe-links-rule',
      status: 'awaiting_create',
      awaits: 'SI.L2-3.14.3.safe-links',
    });
    expect(r.stats.awaiting_create).toBe(1);
  });
  it('the policy read empty or failed: the rule is plain unknown (nothing is known to await)', async () => {
    const r = await runDiscovery(pair.map(entry), session({}), { write: () => 'cap' }, { variables: walkVars });
    expect(postures(r, pair[0])).toEqual(['unknown']);
    expect(postures(r, pair[1])).toEqual(['unknown']);
    expect(r.statuses.map((x) => x.status)).toEqual(['empty', 'empty']);
  });
  it('after Stamper created the pair: CMMC-SafeLinks is selected by name and its rule is judged on that name', async () => {
    const ces = { ...S1_SL, Name: 'CMMC-SafeLinks' };
    const cesRule = { ...S1_SL_RULE, Name: 'CMMC-SafeLinks-Rule', SafeLinksPolicy: 'CMMC-SafeLinks' };
    const r = await runDiscovery(pair.map(entry), session({ 'Get-SafeLinksPolicy': [BUILTIN_SL, S1_SL, ces], 'Get-SafeLinksRule': [cesRule] }), { write: () => 'cap' }, { variables: walkVars });
    expect(postures(r, pair[0])).toEqual(['met']);
    expect(postures(r, pair[1])).toEqual(['met']);
  });
  it('the other five pairs on S1 / muster-partial (built-ins only): every policy not met, every rule awaiting_create', async () => {
    const pairs: Array<[string, string, string, Record<string, unknown>]> = [
      ['SI.L2-3.14.2.anti-malware', 'SI.L2-3.14.2.malware-rule', 'Get-MalwareFilterPolicy', { Name: 'Default', IsDefault: true, EnableFileFilter: true, FileTypeAction: 'Reject' }],
      ['SC.L2-3.13.13.safe-attach', 'SC.L2-3.13.13.safe-attach-rule', 'Get-SafeAttachmentPolicy', { Name: 'Built-In Protection Policy', IsDefault: true, Enable: true, Action: 'Block' }],
      ['SC.L2-3.13.15.anti-phish', 'SC.L2-3.13.15.anti-phish-rule', 'Get-AntiPhishPolicy', { Name: 'Office365 AntiPhish Default', IsDefault: true, Enabled: true }],
      ['SC.L2-3.13.15.anti-spam', 'SC.L2-3.13.15.anti-spam-rule', 'Get-HostedContentFilterPolicy', { Name: 'Default', IsDefault: true, SpamAction: 'MoveToJmf' }],
      ['SC.L2-3.13.15.outbound-spam', 'SC.L2-3.13.15.outbound-spam-rule', 'Get-HostedOutboundSpamFilterPolicy', { Name: 'Default', IsDefault: true, ActionWhenThresholdReached: 'BlockUser' }],
    ];
    for (const [pol, rul, cmd, builtin] of pairs) {
      const r = await runDiscovery([entry(pol), entry(rul)], session({ [cmd]: [builtin] }), { write: () => 'cap' }, { variables: walkVars });
      expect(postures(r, pol), pol).toEqual(['not_met']);
      expect(postures(r, rul), rul).toEqual(['unknown']);
      expect(r.statuses[1], rul).toMatchObject({ status: 'awaiting_create', awaits: pol });
    }
  });

  const users = (rows: Array<Record<string, unknown>>) => rows;
  it('admin account: S1 (PIM-eligible, unlicensed adm.* account) is met; muster-partial (licensed GA and break-glass) is not', () => {
    const s1 = users([
      { id: 'user-46', displayName: 'adm ISSM', userPrincipalName: 'adm.issm@' + D, accountEnabled: true, assignedLicenses: [], privileged: true, breakGlass: false },
      { id: 'user-50', displayName: 'Break glass 1', userPrincipalName: 'bg.access01@' + D, accountEnabled: true, assignedLicenses: [], privileged: true, breakGlass: true },
      { id: 'user-5', displayName: 'Staff', userPrincipalName: 'staff@' + D, accountEnabled: true, assignedLicenses: [{ skuId: 'g5' }], privileged: false, breakGlass: false },
    ]);
    expect(v('AC.L2-3.1.6.admin-account', s1)).toBe('met');
    const mp = users([
      { id: 'user-1', displayName: 'Operator', accountEnabled: true, assignedLicenses: [{ skuId: 'g5' }], privileged: true, breakGlass: false },
      { id: 'user-2', displayName: 'Break glass', accountEnabled: true, assignedLicenses: [{ skuId: 'g5' }], privileged: true, breakGlass: true },
    ]);
    expect(v('AC.L2-3.1.6.admin-account', mp)).toBe('not_met');
    expect(v('AC.L2-3.1.6.admin-account', [{ ...s1[0], accountEnabled: false }])).toBe('not_met');
  });
  it('key vault: S1 kv-s1-mach-prod (purge, soft delete, 90 days, every VM identity assigned) is met; an unassigned identity or no purge protection is not', () => {
    const kv = { VaultName: 'kv-s1-mach-prod', ResourceId: '/subscriptions/x/resourceGroups/rg-s1-mach-prod/providers/Microsoft.KeyVault/vaults/kv-s1-mach-prod', EnablePurgeProtection: true, EnableSoftDelete: true, SoftDeleteRetentionInDays: 90, EnableRbacAuthorization: true, EnclaveIdentities: ['mi-1', 'mi-2', 'mi-3'], UnassignedIdentities: [] };
    expect(v('SC.L2-3.13.10.key-vault', [kv])).toBe('met');
    expect(v('SC.L2-3.13.10.key-vault', [{ ...kv, UnassignedIdentities: ['mi-3'] }])).toBe('not_met');
    expect(v('SC.L2-3.13.10.key-vault', [{ ...kv, EnablePurgeProtection: false }])).toBe('not_met');
    expect(lookupVerdict(block('SC.L2-3.13.10.key-vault'), '', { variables: VARS })).toBe('unknown'); // muster-partial: no vault in its group
  });
  it('action group (AZ-MON-001): an enabled group is unknown without the CISO address (Muster holds none); disabled only is not met; with the address, met', () => {
    const g = { Name: 'ag-s1-secops', ResourceGroupName: 'rg-s1-mach-prod', Enabled: true, EmailAddresses: ['ciso@' + D] };
    expect(v('AZ-MON-001', [g])).toBe('unknown');
    expect(v('AZ-MON-001', [{ ...g, Enabled: false }])).toBe('not_met');
    expect(v('AZ-MON-001', [g], { ...VARS, cisoEmail: 'ciso@' + D })).toBe('met');
  });
  it('primaryDomain <- TCP.TI.002', async () => {
    const { variablesFromTenantFacts } = await import('../src/services/discoveryVariables.js');
    expect(variablesFromTenantFacts([{ question_id: 'TCP.TI.002', answer: D, provenance: 'auto_detected', confidence: 'high', captured_at: 'now', source: 'graph:organization' }]).primaryDomain).toBe(D);
  });
});

// ── W5c7: the admin naming pattern, MFA AND compliant device, the NTP time-sync policy ──
describe.skipIf(!HAVE_REGISTRY)('W5c7: adminNamingPattern, AC.L1-3.1.1 and AU.L2-3.3.7 lookups', () => {
  const v = (id: string, list: unknown, vars: Record<string, string> = VARS, bounds?: Record<string, number | string>) =>
    lookupVerdict(block(id), json(list), { variables: vars, bindings: entry(id).org_value_bindings, bounds });

  it('adminNamingPattern: the answered TCP.IA.002 convention as Stamper builds it (S1 / S2 pinned); none or unsafe gives (?!)', async () => {
    const { adminNamingPattern, adminNamingPatternFromAnswers } = await import('../src/services/discoveryVariables.js');
    expect(adminNamingPattern('adm.{firstname}.{lastname}@{domain}')).toBe('^adm\\.([a-z0-9\\x27-]+)\\.([a-z0-9\\x27-]+)@[^@\\s]+$');
    expect(adminNamingPattern('adm-{firstname}.{lastname}@{domain}')).toBe('^adm-([a-z0-9\\x27-]+)\\.([a-z0-9\\x27-]+)@[^@\\s]+$');
    expect(adminNamingPatternFromAnswers([{ question_id: 'TCP.IA.002', answer: 'adm.{firstname}.{lastname}@{domain}' }])).toBe(
      adminNamingPattern('adm.{firstname}.{lastname}@{domain}')
    );
    expect(adminNamingPatternFromAnswers([])).toBe('(?!)');
    expect(adminNamingPatternFromAnswers([{ question_id: 'TCP.IA.002', answer: "o'brien.{firstname}" }])).toBe('(?!)');
    const re = new RegExp(adminNamingPattern('adm.{firstname}.{lastname}@{domain}'), 'i');
    expect(re.test('adm.sim.user@s1-mach.simtenant.onmicrosoft.us')).toBe(true);
    expect(re.test('sim.user@s1-mach.simtenant.onmicrosoft.us')).toBe(false);
  });
  it('the walk always holds adminNamingPattern, and the admin-account read runs with it substituted (no placeholder left)', async () => {
    const noop: DiscoverySession = { execute: async () => ({ stdout: '', stderr: '', exitCode: 0, durationMs: 1 }) };
    expect((await resolveDiscoveryVariables(null, noop)).adminNamingPattern).toBe('(?!)');
    const answers = [{ question_id: 'TCP.IA.002', answer: 'adm.{firstname}.{lastname}@{domain}' }];
    const vars = (await resolveDiscoveryVariables(null, noop, undefined, answers)) as Record<string, string>;
    const exec = vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0, durationMs: 1 }));
    await runDiscovery([entry('AC.L2-3.1.6.admin-account')], { execute: exec }, { write: () => 'cap' }, { variables: vars });
    const cmd = exec.mock.calls[0][1] as string;
    expect(cmd).not.toContain('{adminNamingPattern}');
    expect(cmd).toContain(vars.adminNamingPattern);
  });
  it('admin account: a licensed account that follows the convention is dedicated; a licensed one that does not is not', () => {
    const base = { id: 'user-46', displayName: 'adm ISSM', accountEnabled: true, privileged: true, breakGlass: false };
    expect(v('AC.L2-3.1.6.admin-account', [{ ...base, assignedLicenses: [{ skuId: 'g5' }], followsConvention: true }])).toBe('met');
    expect(v('AC.L2-3.1.6.admin-account', [{ ...base, assignedLicenses: [{ skuId: 'g5' }], followsConvention: false }])).toBe('not_met');
  });

  const ca = (over: Record<string, unknown>) => ({
    displayName: 'Org MFA + compliant device',
    state: 'enabled',
    conditions: { users: { includeUsers: [], includeGroups: ['group-1'], excludeUsers: ['user-50'] }, applications: { includeApplications: ['All'] }, clientAppTypes: ['browser', 'mobileAppsAndDesktopClients'] },
    grantControls: { operator: 'AND', builtInControls: ['mfa', 'compliantDevice'] },
    ...over,
  });
  it('AC.L1-3.1.1: S1-CA05 (compliant device alone, two platforms) and S1-CA08 (admin portals only) are not met; the full effect is', () => {
    const ca05 = ca({ displayName: 'S1-CA05', conditions: { users: { includeUsers: ['All'] }, applications: { includeApplications: ['All'] }, platforms: { includePlatforms: ['windows', 'iOS'] } }, grantControls: { operator: 'OR', builtInControls: ['compliantDevice'] } });
    const ca08 = ca({ displayName: 'S1-CA08', conditions: { users: { includeUsers: ['All'] }, applications: { includeApplications: ['MicrosoftAdminPortals'] } } });
    expect(v('AC.L1-3.1.1.ca-mfa-compliant-device', [ca05, ca08])).toBe('not_met');
    expect(v('AC.L1-3.1.1.ca-mfa-compliant-device', [ca05, ca08, ca({})])).toBe('met');
    expect(v('AC.L1-3.1.1.ca-mfa-compliant-device', [ca({ grantControls: { operator: 'OR', builtInControls: ['mfa', 'compliantDevice'] } })])).toBe('not_met');
    expect(v('AC.L1-3.1.1.ca-mfa-compliant-device', [ca({ state: 'enabledForReportingButNotEnforced' })])).toBe('not_met');
  });

  const ntp = (over: Record<string, unknown> = {}) => ({
    id: 'cp-ntp', name: 'S1 Windows time synchronisation (NTP)', platforms: 'windows10', ntpClientEnabled: true, ntpConfigured: true,
    timeServer: 'time.windows.com,0x9', ntpType: 'ntp', pollInterval: 3600, assignments: assigned('ntp'), ...over,
  });
  it('AU.L2-3.3.7: the S1 NTP policy is met; with PI.ODP.016 answered, its servers must be the answered ones (flags ignored)', async () => {
    const { answerBoundsFromFacts } = await import('../src/services/discoveryVariables.js');
    const id = 'AU.L2-3.3.7.time-sync';
    expect(v(id, [ntp()])).toBe('met'); // no answer: any server
    const answered = answerBoundsFromFacts([{ question_id: 'PI.ODP.016', answer: 'time.windows.com' }]);
    expect(answered).toMatchObject({ '$.timeserver': 'time.windows.com' });
    expect(v(id, [ntp()], VARS, answered)).toBe('met');
    expect(v(id, [ntp({ timeServer: 'TIME.windows.com' })], VARS, answered)).toBe('met');
    expect(v(id, [ntp({ timeServer: 'time.nist.gov,0x9' })], VARS, answered)).toBe('not_met');
    expect(v(id, [ntp()], VARS, answerBoundsFromFacts([{ question_id: 'PI.ODP.016', answer: 'time.windows.com time.nist.gov' }]))).toBe('not_met');
    // An answer that is not a plain server list adds no condition (Stamper's guard).
    expect(v(id, [ntp({ timeServer: 'time.nist.gov' })], VARS, answerBoundsFromFacts([{ question_id: 'PI.ODP.016', answer: "x'; Remove-Item" }]))).toBe('met');
  });
  it('AU.L2-3.3.7: unassigned, a daily poll, NT5DS, or the generic simulator policy (S2 / muster-partial) is not met', () => {
    const id = 'AU.L2-3.3.7.time-sync';
    for (const bad of [ntp({ assignments: [] }), ntp({ pollInterval: 86400 }), ntp({ ntpType: 'nt5ds' }), { id: 'cp-1', name: 'Sim Configuration Policy 1', platforms: 'windows10', assignments: [] }]) {
      expect(v(id, [bad])).toBe('not_met');
    }
  });
});
