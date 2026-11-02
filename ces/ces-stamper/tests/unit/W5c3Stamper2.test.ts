// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// synthetic-customer W5 cycle 3, Stamper part 2.
// (1) Every entry that creates an Intune object assigns it to the CUI group ({cuiGroupId}) in the same
//     SET, its GET expands the assignments, and its state rule asserts at least one.
// (2) The N-class entries (reads that only matched Stamper's own CMMC-* names) carry a `lookup` block;
//     their GET is generated from it and finds the tenant's own equivalent by effect. An equivalent is
//     verified on the exists path (no create); without one, the CMMC-* object is created as before.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { CommandRegistry } from '../../src/registry/CommandRegistry';
import { CommandRegistrySchema } from '../../src/registry/command-registry.types';
import type { CommandEntry } from '../../src/registry/command-registry.types';
import { lookupGetCommand, psPath, evaluateEffect, selectLookupMatch, verifyEquivalent, boundEffect } from '../../src/registry/lookup';
import { ManifestReader } from '../../src/translators/ManifestReader';
import { PlanTranslator } from '../../src/translators/PlanTranslator';
import { PowerShellAdapter } from '../../src/adapters/PowerShellAdapter';
import { StamperConfig } from '../../src/config/StamperConfig';
import { ExecutionContext } from '../../src/core/ExecutionContext';
import { OutputVerificationEngine } from '../../src/core/OutputVerificationEngine';
import { evidenceDirForTenant, evidenceFileForEntry, taskEvidencePath } from '../../src/core/EvidenceReadinessAnalyzer';
import type { ExeTask, LookupBlock, OrgValueDecision, SubCommand } from '../../src/types/schema.types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = path.resolve(__dirname, '../../src/registry/cmmc-l2-commands.registry.json');
const FIXTURES = path.resolve(__dirname, '../fixtures');
const registry = CommandRegistry.load(REGISTRY_PATH);
const byId = (id: string) => registry.allEntries.find(e => e.entry_id === id)!;
const W3 = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'w3-state-reads.json'), 'utf-8')) as { reads: Record<string, string> };
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

const PIPELINE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'stamper-w5c3-2-'));
const savedRoot = process.env.CES_PIPELINE_ROOT;
beforeAll(() => { process.env.CES_PIPELINE_ROOT = PIPELINE_ROOT; });
afterAll(() => {
  if (savedRoot === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = savedRoot;
  fs.rmSync(PIPELINE_ROOT, { recursive: true, force: true });
});

// ---- the entries this slice changed ----
const INTUNE_CREATORS = [
  'AC.L2-3.1.10.screen-lock', 'AC.L2-3.1.16.wifi-profile', 'AC.L2-3.1.19.ios-mam', 'AC.L2-3.1.21.block-storage',
  'CM.L2-3.4.2.asr-rules', 'CM.L2-3.4.6.least-functionality', 'CM.L2-3.4.7.wdac', 'CM.L2-3.4.9.install-control',
  'MA.L2-3.7.1.update-ring', 'MP.L2-3.8.6.bitlocker', 'SC.L1-3.13.1.endpoint-firewall',
  'SC.L2-3.13.12.camera-block', 'SI.L1-3.14.5.scan-schedule-evidence',
  'CM.L2-3.4.1.compliance-policy-windows', // run 50 fixes
  'SI.L1-3.14.1.mde-onboarding', 'SI.L2-3.14.6.defender-traffic-monitoring', // PH-12 DEPTH-10.5
  'AC.L2-3.1.18.ios-compliance', 'AC.L2-3.1.19.android-compliance', // PH-12 DEPTH-10.3 (P12-R2)
  'CM.L2-3.4.7.firewall-ports', 'CM.L2-3.4.7.nonessential-functions', 'CM.L2-3.4.7.nonessential-services', 'CM.L2-3.4.8.app-control', // PH-12 DEPTH-10.6 (P12-R5); each passes the per-entry {cuiGroupId} test below
];
// follow-up: the security ring is merged into the standard ring; this entry only verifies it
const RING = 'MA.L2-3.7.1.update-ring';
const RING_VERIFIER = 'RA.L2-3.11.3.vuln-remediation';
const LOOKUP_ENTRIES = [
  'AC.L2-3.1.10.screen-lock', 'AC.L2-3.1.11.session-timeout', 'AC.L2-3.1.14.block-untrusted', 'AC.L2-3.1.15.admin-mfa',
  'AC.L2-3.1.16.wifi-profile', 'AC.L2-3.1.21.block-storage', 'CM.L2-3.4.7.wdac', 'CM.L2-3.4.9.install-control',
  'IA.L2-3.5.4.auth-strength', 'MA.L2-3.7.1.update-ring', 'MA.L2-3.7.5.remote-mfa', 'MP.L2-3.8.6.bitlocker',
  'RA.L2-3.11.3.vuln-remediation', 'SC.L2-3.13.12.camera-block', 'SI.L1-3.14.5.scan-schedule-evidence',
  'CM.L2-3.4.1.compliance-policy-windows', // run 50 fixes
];
const VARS: Record<string, string> = { cuiGroupId: 'group-1', wifiSsid: 'S1-MACH-CORP', phishingResistantStrengthId: 'authenticationStrengthPolicy-2' };
const resolve = (s: string) => s.replace(/\{(\w+)\}/g, (m, k) => VARS[k] ?? m);

// ---- S1-style tenant objects (fictional, the shapes of the simulator's s1-mach seed) ----
const ASSIGNED = [{ id: 'a-1', target: { '@odata.type': '#microsoft.graph.groupAssignmentTarget', groupId: 'group-4' } }];
const S1_USERS = { includeUsers: ['All'], excludeUsers: ['user-50', 'user-51'], excludeGroups: ['group-12'] };
const S1_CA = {
  ca01: { id: 'caPolicy-1', displayName: 'S1-CA01 Require MFA - all users', state: 'enabled', conditions: { users: S1_USERS, applications: { includeApplications: ['All'] } }, grantControls: { operator: 'OR', builtInControls: ['mfa'] } },
  ca02: { id: 'caPolicy-2', displayName: 'S1-CA02 Phishing-resistant MFA - admin roles', state: 'enabled', conditions: { users: { includeUsers: [], includeRoles: ['62e90394-69f5-4237-9190-012177145e10', '194ae4cb-b126-40b2-bd5b-6091b380977d'], excludeUsers: ['user-50', 'user-51'], excludeGroups: ['group-12'] }, applications: { includeApplications: ['All'] } }, grantControls: { operator: 'OR', builtInControls: [], authenticationStrength: { id: '00000000-0000-0000-0000-000000000004', displayName: 'Phishing-resistant MFA' } } },
  ca03: { id: 'caPolicy-3', displayName: 'S1-CA03 Block legacy authentication', state: 'enabled', conditions: { users: S1_USERS, applications: { includeApplications: ['All'] }, clientAppTypes: ['exchangeActiveSync', 'other'] }, grantControls: { operator: 'OR', builtInControls: ['block'] } },
  ca06: { id: 'caPolicy-6', displayName: 'S1-CA06 Block sign-in from outside US', state: 'enabled', conditions: { users: S1_USERS, applications: { includeApplications: ['All'] }, locations: { includeLocations: ['All'], excludeLocations: ['51510000-00b1-4000-8000-000000000001'] } }, grantControls: { operator: 'OR', builtInControls: ['block'] } },
  ca09: { id: 'caPolicy-9', displayName: 'S1-CA09 Session lifetime 12h - browser', state: 'enabled', conditions: { users: S1_USERS, applications: { includeApplications: ['All'] }, clientAppTypes: ['browser'] }, sessionControls: { signInFrequency: { value: 12, type: 'hours', isEnabled: true }, persistentBrowser: { mode: 'never', isEnabled: true } } },
};
const S1_CA_LIST = [S1_CA.ca01, S1_CA.ca02, S1_CA.ca03, S1_CA.ca06, S1_CA.ca09];
const S1_DC = {
  wifi: { id: 'b4-1', '@odata.type': '#microsoft.graph.windowsWifiConfiguration', displayName: 'S1-MACH-CORP Wi-Fi', ssid: 'S1-MACH-CORP', networkName: 'S1-MACH-CORP', wifiSecurityType: 'wpa2Enterprise', assignments: ASSIGNED },
  av: { id: 'b4-2', '@odata.type': '#microsoft.graph.windows10GeneralConfiguration', displayName: 'S1-Defender-AV', defenderScanType: 'full', defenderSystemScanSchedule: 'saturday', defenderScheduledScanTime: '02:00:00.0000000', defenderCloudBlockLevel: 'high', defenderSignatureUpdateIntervalInHours: 4, assignments: ASSIGNED },
  usb: { id: 'b4-3', '@odata.type': '#microsoft.graph.windows10GeneralConfiguration', displayName: 'S1-Block-Removable-Storage', storageBlockRemovableStorage: true, usbBlocked: true, assignments: ASSIGNED },
};
const S1_DC_LIST = [S1_DC.wifi, S1_DC.av, S1_DC.usb];
const unassigned = <T extends { assignments?: unknown }>(o: T): T => { const c = clone(o); delete c.assignments; return c; };
const lookupOf = (id: string) => byId(id).lookup as LookupBlock;
const found = (id: string, list: object[]) => selectLookupMatch(list, lookupOf(id), resolve) as { displayName?: string } | undefined;

/** The object Stamper's own SET creates, read back (W3 fixture reads; remote-mfa's fixture is the old Select-Object shape, so it is built from its SET; PH6-REG: the SET creates it enabled). */
function ownRead(id: string): object {
  if (id === 'MA.L2-3.7.5.remote-mfa') {
    return { displayName: 'CMMC-RemoteMaintenance-MFA', state: 'enabled', conditions: { applications: { includeApplications: ['All'] }, users: { includeRoles: ['62e90394-69f5-4237-9190-012177145e10', '194ae4cb-b126-40b2-bd5b-6091b380977d'], excludeUsers: ['user-50'] } }, grantControls: { operator: 'OR', builtInControls: ['mfa'] } };
  }
  return JSON.parse(W3.reads[id === RING_VERIFIER ? RING : id]);
}

describe('W5c3 part 2: registry (assignments)', () => {
  it('the registry still validates; 153 unique entries (run 50: + the Windows compliance policy)', () => {
    const raw = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
    expect(CommandRegistrySchema.safeParse(raw).success).toBe(true);
    const ids = raw.entries.map((e: any) => e.entry_id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(184); // PH-12 merge: 153 + 30 = + 8 AU/IA (P12-R1), + 5 AC (P12-R2), + 4 SC (P12-R3), + 4 SI and 1 IR (P12-R4), + 6 CM, 1 MA, 1 PS (P12-R5); CG: + SC.L2-3.13.10.key-escrow; DEPTH-1a: - PE.L2-3.10.1/3/4/5 + MP.L2-3.8.3.sanitize duplicates; W5c5: + SC.L2-3.13.10.key-vault; W5c7: + AC.L1-3.1.1.ca-mfa-compliant-device, AU.L2-3.3.7.time-sync; W7-ST: + PS.L2-3.9.2.leaver-workflow; PH-13 (P13-LV, P13-INT): + PS.L2-3.9.2.leaver-access-terminated
  });

  it('the Intune creators are exactly the 13 changed entries, the run-50 compliance policy, plus the security baseline (assigned inline before this slice)', () => {
    const creates = (e: CommandEntry) => e.set_command.trim() !== '' && (
      /-Method POST -Uri '[^']*\/(deviceManagement\/(deviceConfigurations|configurationPolicies|deviceCompliancePolicies|templates\/[^']*\/createInstance)|deviceAppManagement\/\w+ManagedAppProtections)'/.test(e.set_command)
      || /New-MgDeviceManagement(DeviceConfiguration|DeviceCompliancePolicy|ConfigurationPolicy)\b/.test(e.set_command));
    const ids = registry.allEntries.filter(creates).map(e => e.entry_id).sort();
    // W5c7: + the time-sync settings-catalog policy (its assignment is tested in W5c7Stamper.test.ts)
    expect(ids).toEqual([...INTUNE_CREATORS, 'CM.L2-3.4.1.security-baseline', 'AU.L2-3.3.7.time-sync',
      // PH-12: settings-catalog policies assigned to all devices, not to {cuiGroupId} (DEPTH-10.2 P12-R1; DEPTH-10.4 P12-R3)
      'IA.L2-3.5.10.credential-guard', 'SC.L1-3.13.1.network-protection', 'SC.L2-3.13.4.pagefile-clear', 'SC.L2-3.13.11.fips-mode'].sort());
  });

  for (const id of INTUNE_CREATORS) {
    it(`${id}: the SET assigns the created object to {cuiGroupId}; the GET expands assignments; the rule asserts one`, () => {
      const e = byId(id);
      expect(e.set_command).toMatch(/\$created = (Invoke-MgGraphRequest -Method POST|New-MgDeviceManagementDeviceConfiguration)/);
      expect(e.set_command).toMatch(/Invoke-MgGraphRequest -Method POST -Uri "https:\/\/graph\.microsoft\.us\/(v1\.0|beta)\/device(Management|AppManagement)\/\w+\/\$\(\$created\.(id|Id)\)\/assign"/);
      expect(e.set_command).toContain("assignments=@(@{target=@{'@odata.type'='#microsoft.graph.groupAssignmentTarget';groupId='{cuiGroupId}'}})");
      expect(e.variables_runtime).toContain('cuiGroupId');
      expect(e.get_command).toMatch(/\?\$expand=(settings,)?assignments'/);
      expect(e.verification?.evidence?.checks).toEqual(expect.arrayContaining([{ jsonpath: '$.assignments', min_items: 1 }]));
      expect(e.verification?.postcheck_mode).toBe('state');
    });
  }

  it('the security baseline keeps its inline CUI-group assignment (unchanged)', () => {
    expect(byId('CM.L2-3.4.1.security-baseline').set_command).toContain("assignments=@(@{target=@{'@odata.type'='#microsoft.graph.groupAssignmentTarget';groupId='{cuiGroupId}'}})");
  });

  it('min_items: an empty or missing assignments array fails, one assignment passes', () => {
    const engine = new OutputVerificationEngine();
    const v = byId('AC.L2-3.1.21.block-storage').verification;
    const read = (a: unknown) => JSON.stringify({ displayName: 'CMMC-BlockRemovableStorage', storageBlockRemovableStorage: true, ...(a === undefined ? {} : { assignments: a }) });
    const ok = (a: unknown) => engine.verify({ stdout: '', stderr: '', exitCode: 0 }, { stdout: read(a), exitCode: 0 }, v).passed;
    expect(ok(ASSIGNED)).toBe(true);
    expect(ok([])).toBe(false);
    expect(ok(undefined)).toBe(false);
    expect(ok('group-1')).toBe(false);
  });
});

describe('W5c3 part 2: registry (lookup blocks)', () => {
  it('the lookup entries are the N-class get-then-set entries listed in the log', () => {
    // W5c5 adds the Exchange pairs, admin-account and the key vault (tested in W5c5Stamper.test.ts)
    const W5C5 = ['SI.L2-3.14.2.anti-malware', 'SI.L2-3.14.2.malware-rule', 'SI.L2-3.14.3.safe-links', 'SI.L2-3.14.3.safe-links-rule', 'SC.L2-3.13.13.safe-attach', 'SC.L2-3.13.13.safe-attach-rule', 'SC.L2-3.13.15.anti-phish', 'SC.L2-3.13.15.anti-phish-rule', 'SC.L2-3.13.15.anti-spam', 'SC.L2-3.13.15.anti-spam-rule', 'SC.L2-3.13.15.outbound-spam', 'SC.L2-3.13.15.outbound-spam-rule', 'AC.L2-3.1.6.admin-account', 'SC.L2-3.13.10.key-vault'];
    const W5C7 = ['AC.L1-3.1.1.ca-mfa-compliant-device', 'AU.L2-3.3.7.time-sync']; // W5c7 (W5c7Stamper.test.ts)
    const W7ST = ['PS.L2-3.9.2.leaver-workflow']; // W7-ST (W7StLeaverWorkflow.test.ts)
    const PH13 = ['PS.L2-3.9.2.leaver-access-terminated']; // PH-13 (P13-LV, P13-INT): the verify-only leaver read
    expect(registry.allEntries.filter(e => e.lookup).map(e => e.entry_id).sort()).toEqual([...LOOKUP_ENTRIES, ...W5C5, ...W5C7, ...W7ST, ...PH13].sort());
    for (const id of LOOKUP_ENTRIES) expect([id, byId(id).idempotency]).toEqual([id, id === RING_VERIFIER ? 'safe' : 'get-then-set']);
  });

  for (const id of LOOKUP_ENTRIES) {
    describe(id, () => {
      const e = byId(id);
      it('get_command is the GET generated from the lookup block', () => {
        expect(e.get_command).toBe(lookupGetCommand(e.lookup!));
        expect(e.get_command.startsWith(e.lookup!.source + ' | Where-Object')).toBe(true);
        expect(e.get_command).toMatch(/\| Select-Object -First 1 \| ConvertTo-Json -Depth 10$/);
      });
      it('by_name is the name its own SET creates', () => {
        expect((e.verify_only ? byId(RING) : e).set_command).toContain(e.lookup!.by_name.equals);
      });
      it('every {variable} in the block is declared by the entry', () => {
        const names = [...JSON.stringify(e.lookup).matchAll(/\{(\w+)\}/g)].map(m => m[1]);
        for (const n of names) expect([...e.variables_required, ...e.variables_runtime]).toContain(n);
      });
      it("CES's own object (read back after its SET) also meets the effect", () => {
        const conds = evaluateEffect(ownRead(id), e.lookup!, resolve);
        expect(conds.filter(c => !c.pass)).toEqual([]);
      });
    });
  }

  it('psPath quotes a segment that is not an identifier', () => {
    expect(psPath('$.conditions.users.includeUsers')).toBe('$_.conditions.users.includeUsers');
    expect(psPath("$.a-b.c")).toBe("$_.'a-b'.c");
  });

  it('the generated clauses, one per op', () => {
    const l: LookupBlock = {
      source: 'SRC', by_name: { path: '$.displayName', equals: "CMMC-O'Brien" },
      by_effect: [
        { path: '$.s', op: 'equals', value: 'enabled' }, { path: '$.d', op: 'not_equals', value: true },
        { path: '$.m', op: 'in', value: ['a', 'b'] }, { path: '$.u', op: 'contains', value: 'All' },
        { path: '$.c', op: 'all_in', value: ['x', 'y'] }, { path: '$.n', op: 'lte', value: 8 }, { path: '$.n', op: 'gte', value: 1 },
        { path: '$.e', op: 'not_empty' },
        { any_of: [{ path: '$.p', op: 'equals', value: 1 }, { path: '$.q', op: 'equals', value: false }] },
      ],
    };
    expect(lookupGetCommand(l)).toBe(
      "SRC | Where-Object { ($_.displayName -eq 'CMMC-O''Brien') -or (($_.s -eq 'enabled') -and ($_.d -ne $true) -and (@('a','b') -contains $_.m) -and (@($_.u) -contains 'All')"
      + " -and (@($_.c | Where-Object { $_ }).Count -gt 0 -and @($_.c | Where-Object { @('x','y') -notcontains $_ }).Count -eq 0)"
      + " -and ($null -ne $_.n -and [double]$_.n -le 8) -and ($null -ne $_.n -and [double]$_.n -ge 1) -and (@($_.e | Where-Object { $_ }).Count -gt 0)"
      + " -and (($_.p -eq 1) -or ($_.q -eq $false))) } | Sort-Object { $_.displayName -ne 'CMMC-O''Brien' } | Select-Object -First 1 | ConvertTo-Json -Depth 10");
  });
});

describe('W5c3 part 2: the lookup on S1-style tenants (the GET semantics)', () => {
  it('admin MFA: S1-CA02 (phishing-resistant strength, Global Administrator role) is the equivalent', () => {
    expect(found('AC.L2-3.1.15.admin-mfa', S1_CA_LIST)?.displayName).toBe('S1-CA02 Phishing-resistant MFA - admin roles');
  });
  it('untrusted locations: S1-CA06 (block, all locations except a named one) is the equivalent', () => {
    expect(found('AC.L2-3.1.14.block-untrusted', S1_CA_LIST)?.displayName).toBe('S1-CA06 Block sign-in from outside US');
  });
  it('remote maintenance MFA: S1-CA01 (MFA, all users, all apps) is the equivalent', () => {
    expect(found('MA.L2-3.7.5.remote-mfa', S1_CA_LIST)?.displayName).toBe('S1-CA01 Require MFA - all users');
  });
  it('session timeout: S1-CA09 (12 h, browser only) is not an equivalent; a 4 h copy for all client apps is, a 4 h browser-only copy is not (run 50)', () => {
    expect(found('AC.L2-3.1.11.session-timeout', S1_CA_LIST)).toBeUndefined();
    const four = clone(S1_CA.ca09); four.sessionControls.signInFrequency.value = 4;
    expect(found('AC.L2-3.1.11.session-timeout', [four])).toBeUndefined();
    (four.conditions as any).clientAppTypes = ['all'];
    expect(found('AC.L2-3.1.11.session-timeout', [S1_CA.ca01, four])?.displayName).toBe('S1-CA09 Session lifetime 12h - browser');
    const days = clone(four); (days.sessionControls.signInFrequency as any).type = 'days';
    expect(found('AC.L2-3.1.11.session-timeout', [days])).toBeUndefined();
  });
  it('Wi-Fi: the S1 WPA2-Enterprise profile for the answered SSID is the equivalent; not when unassigned, personal, or another SSID', () => {
    expect(found('AC.L2-3.1.16.wifi-profile', S1_DC_LIST)?.displayName).toBe('S1-MACH-CORP Wi-Fi');
    expect(found('AC.L2-3.1.16.wifi-profile', [unassigned(S1_DC.wifi)])).toBeUndefined();
    expect(found('AC.L2-3.1.16.wifi-profile', [{ ...S1_DC.wifi, wifiSecurityType: 'wpa2Personal' }])).toBeUndefined();
    expect(found('AC.L2-3.1.16.wifi-profile', [{ ...S1_DC.wifi, ssid: 'S1-GUEST' }])).toBeUndefined();
  });
  it('removable storage: S1-Block-Removable-Storage is the equivalent (only when assigned)', () => {
    expect(found('AC.L2-3.1.21.block-storage', S1_DC_LIST)?.displayName).toBe('S1-Block-Removable-Storage');
    expect(found('AC.L2-3.1.21.block-storage', [unassigned(S1_DC.usb)])).toBeUndefined();
  });
  it('scan schedule: S1-Defender-AV (scheduled full scan) is the equivalent', () => {
    expect(found('SI.L1-3.14.5.scan-schedule-evidence', S1_DC_LIST)?.displayName).toBe('S1-Defender-AV');
  });
  it('no S1 equivalent: screen lock, BitLocker, update rings, app control, install control, camera, auth strength', () => {
    for (const id of ['AC.L2-3.1.10.screen-lock', 'MP.L2-3.8.6.bitlocker', 'MA.L2-3.7.1.update-ring', 'CM.L2-3.4.7.wdac', 'CM.L2-3.4.9.install-control', 'SC.L2-3.13.12.camera-block']) {
      expect([id, found(id, S1_DC_LIST)]).toEqual([id, undefined]);
    }
    expect(found('IA.L2-3.5.4.auth-strength', [{ Id: 'authenticationStrengthPolicy', DisplayName: 'Sim Phishing-Resistant MFA Strength', PolicyType: 'custom' }])).toBeUndefined();
  });
  it('auth strength: the built-in phishing-resistant strength is an equivalent; one allowing a password combination is not', () => {
    const builtIn = { Id: '00000000-0000-0000-0000-000000000004', DisplayName: 'Phishing-resistant MFA', PolicyType: 'builtIn', AllowedCombinations: ['windowsHelloForBusiness', 'fido2', 'x509CertificateMultiFactor'] };
    expect(found('IA.L2-3.5.4.auth-strength', [builtIn])).toBe(builtIn);
    expect(found('IA.L2-3.5.4.auth-strength', [{ ...builtIn, AllowedCombinations: ['password,microsoftAuthenticatorPush', 'fido2'] }])).toBeUndefined();
  });
  it("CES's own object (by name) sorts first even when an equivalent comes earlier", () => {
    const own = JSON.parse(W3.reads['AC.L2-3.1.21.block-storage']);
    expect(found('AC.L2-3.1.21.block-storage', [S1_DC.usb, own])?.displayName).toBe('CMMC-BlockRemovableStorage');
  });
  it('the merged ring: a tenant ring at 0 / 14 days is an equivalent for both entries; 3-day quality or a user-defined mode is not', () => {
    const ring = { id: 'r', '@odata.type': '#microsoft.graph.windowsUpdateForBusinessConfiguration', displayName: 'Customer Ring', qualityUpdatesDeferralPeriodInDays: 0, featureUpdatesDeferralPeriodInDays: 14, automaticUpdateMode: 'autoInstallAtMaintenanceTime', assignments: ASSIGNED };
    expect(found(RING, [ring])).toBe(ring);
    expect(found(RING_VERIFIER, [ring])).toBe(ring);
    expect(found(RING, [{ ...ring, qualityUpdatesDeferralPeriodInDays: 3 }])).toBeUndefined();
    expect(found(RING, [{ ...ring, automaticUpdateMode: 'userDefined' }])).toBeUndefined();
  });
});

describe('W5c3 part 2: verifyEquivalent (the exists-path check of an equivalent)', () => {
  const decision10: OrgValueDecision = { path: '$.passwordMinutesOfInactivityBeforeScreenTimeout', token: 'passwordMinutesOfInactivityBeforeScreenTimeout', op: 'lte', control_ids: ['AC.L2-3.1.10'], source: 'answered', organisation_value: 10, registry_value: 15, configured_value: 10, basis: 'organisation' };
  const lock = (m: number) => JSON.stringify({ id: 'c-1', '@odata.type': '#microsoft.graph.windows10GeneralConfiguration', displayName: 'Customer Screen Lock', passwordRequired: true, passwordMinutesOfInactivityBeforeScreenTimeout: m, assignments: ASSIGNED });
  it("returns undefined for CES's own object (the entry's own rule applies)", () => {
    expect(verifyEquivalent(W3.reads['AC.L2-3.1.10.screen-lock'], lookupOf('AC.L2-3.1.10.screen-lock'), undefined)).toBeUndefined();
  });
  it('an org-value bound tightens the effect condition on its path: 5 passes [1, 10], 12 fails', () => {
    expect(boundEffect(lookupOf('AC.L2-3.1.10.screen-lock'), [decision10]).by_effect).toEqual(expect.arrayContaining([{ path: '$.passwordMinutesOfInactivityBeforeScreenTimeout', op: 'lte', value: 10 }]));
    expect(verifyEquivalent(lock(5), lookupOf('AC.L2-3.1.10.screen-lock'), [decision10])!.verification.passed).toBe(true);
    const twelve = verifyEquivalent(lock(12), lookupOf('AC.L2-3.1.10.screen-lock'), [decision10])!;
    expect(twelve.verification.passed).toBe(false);
    expect(twelve.verification.reason).toContain("existing equivalent 'Customer Screen Lock' does not meet $.passwordMinutesOfInactivityBeforeScreenTimeout lte 10 (observed 12)");
    expect(verifyEquivalent(lock(12), lookupOf('AC.L2-3.1.10.screen-lock'), undefined)!.verification.passed).toBe(true);
  });
});

// ---- adapter: the exists path on an equivalent, and the create path with the assignment ----

const config = () => StamperConfig.fromTenantConfig({
  tenantId: 'test-tenant', appId: 'test-app', certThumbprint: 'test-thumbprint',
  certPath: '/path/to/cert', targetTenantDomain: 'test.onmicrosoft.us', clientName: 'Test Client',
});
const asSub = (id: string, extra: Partial<SubCommand> = {}): SubCommand => {
  const e = byId(id);
  return {
    id: e.entry_id, label: e.label, set_command: e.set_command, get_command: e.get_command, engine: e.engine,
    sequence_hint: e.sequence_hint, idempotency: e.idempotency, variables_required: e.variables_required,
    variables_runtime: e.variables_runtime, captures: e.captures, on_failure: e.on_failure,
    evidence_commands: e.evidence_commands, verification: e.verification, ...(e.lookup ? { lookup: e.lookup } : {}), ...extra,
  } as SubCommand;
};
const taskOf = (id: string, s: SubCommand, controls: string[]): ExeTask => ({
  id, type: 'configuration', priority: 'p1', depends_on: [],
  action: { engine: s.engine, command: 'placeholder', args: { _sub_commands: [s] } },
  inputs: [], outputs: [], controls, idempotency: 'safe', rollback: { strategy: 'none' },
} as ExeTask);
const ctx = () => {
  const c = new ExecutionContext(false);
  c.loadManifestVariables({ wifiSsid: 'S1-MACH-CORP' });
  c.registerCaptures({ cuiGroupId: 'group-1', breakGlassUserId: 'user-50', phishingResistantStrengthId: 'authenticationStrengthPolicy-2' });
  return c;
};

/**
 * A fake tenant: a GET of the entry is answered the way the generated PowerShell would (the lookup
 * applied to `objects`); a SET adds `created` to the objects, and an /assign call adds the assignment.
 */
function fakeTenant(sub: SubCommand, objects: any[], created?: any, opts: { assign?: boolean } = {}) {
  const assign = opts.assign !== false;
  const sent: string[] = [];
  const list = clone(objects);
  return {
    sent, list,
    manager: {
      execute: async (_t: string, command: string) => {
        sent.push(command);
        if (/\/assign"/.test(command) || /^\$created = |New-MgIdentityConditionalAccessPolicy/.test(command)) {
          if (created) {
            const obj = clone(created);
            const g = command.match(/groupId='([^']+)'/)?.[1];
            if (assign && /\/assign"/.test(command) && g) obj.assignments = [{ id: `${obj.id}_${g}`, target: { '@odata.type': '#microsoft.graph.groupAssignmentTarget', groupId: g } }];
            list.push(obj);
          }
          return { stdout: '{"id":"created"}', stderr: '', exitCode: 0 };
        }
        if (command.includes(resolveCmd(sub.get_command))) {
          const hit = selectLookupMatch(list, sub.lookup!, resolve);
          return { stdout: hit ? JSON.stringify(hit, null, 4) : '', stderr: '', exitCode: 0 };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    },
  };
}
const resolveCmd = (c: string) => resolve(c);
const run = async (tenant: string, taskId: string, sub: SubCommand, controls: string[], fake: ReturnType<typeof fakeTenant>) => {
  const adapter = new PowerShellAdapter(config(), fake.manager as any, ctx(), undefined, tenant);
  const result = await adapter.execute(taskOf(taskId, sub, controls), {}, false);
  const evidFile = evidenceFileForEntry(sub.id, sub.label).replace(/\.txt$/, '.json');
  const record = JSON.parse(fs.readFileSync(taskEvidencePath(evidenceDirForTenant(tenant), taskId, evidFile), 'utf-8'));
  const setSent = fake.sent.some(c => /\$created = |^\$existing = |^New-Mg/.test(c));
  return { result, record, setSent };
};

describe('W5c3 part 2: adapter (fake tenant)', () => {
  const realSetTimeout = global.setTimeout;
  beforeEach(() => {
    (global as any).setTimeout = (fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) =>
      realSetTimeout(fn, ms !== undefined && ms >= 5000 ? 0 : ms, ...args);
  });
  afterEach(() => { (global as any).setTimeout = realSetTimeout; });

  it('admin MFA on S1: the GET finds S1-CA02; verified by effect, SAT, no SET; the record names it', async () => {
    const sub = asSub('AC.L2-3.1.15.admin-mfa');
    const fake = fakeTenant(sub, S1_CA_LIST);
    const { result, record, setSent } = await run('w5c3-2-mfa', 't-mfa', sub, ['AC.L2-3.1.15'], fake);
    expect(result.success).toBe(true);
    expect(setSent).toBe(false);
    expect(record.complianceVerdict).toBe('SAT');
    expect(record.metadata.postcheckMode).toBe('state');
    expect(record.metadata.lookupMatch).toMatchObject({ basis: 'effect', object: 'S1-CA02 Phishing-resistant MFA - admin roles' });
    expect(record.verdictRationale).toContain("existing equivalent 'S1-CA02 Phishing-resistant MFA - admin roles' matched by effect");
    expect(record.verificationResult.passed).toBe(true);
    expect(fake.list).toHaveLength(S1_CA_LIST.length); // no duplicate
  });

  it('Wi-Fi on S1: the assigned S1 profile is verified, no CMMC-WiFi-Secure is created', async () => {
    const sub = asSub('AC.L2-3.1.16.wifi-profile');
    const fake = fakeTenant(sub, S1_DC_LIST);
    const { result, record, setSent } = await run('w5c3-2-wifi', 't-wifi', sub, ['AC.L2-3.1.16'], fake);
    expect(result.success).toBe(true);
    expect(setSent).toBe(false);
    expect(record.metadata.lookupMatch).toMatchObject({ basis: 'effect', object: 'S1-MACH-CORP Wi-Fi' });
  });

  it('Wi-Fi with no equivalent (the S1 profile unassigned): CMMC-WiFi-Secure is created and assigned to the CUI group, then verified with its assignment', async () => {
    const sub = asSub('AC.L2-3.1.16.wifi-profile');
    const own = { ...JSON.parse(W3.reads['AC.L2-3.1.16.wifi-profile']) };
    delete own.assignments;
    const fake = fakeTenant(sub, [unassigned(S1_DC.wifi)], own);
    const { result, record, setSent } = await run('w5c3-2-wifi-create', 't-wifi-c', sub, ['AC.L2-3.1.16'], fake);
    expect(setSent).toBe(true);
    const set = fake.sent.find(c => c.includes('$created = '))!;
    expect(set).toContain('/deviceConfigurations/$($created.id)/assign"');
    expect(set).toContain("groupId='group-1'");
    expect(result.success).toBe(true);
    expect(record.complianceVerdict).toBe('SAT');
    expect(record.metadata.lookupMatch).toBeUndefined(); // create path
  });

  it('create path without the assignment in the read-back (the /assign call did not take): NOT_SAT', async () => {
    const sub = asSub('AC.L2-3.1.21.block-storage');
    const own = JSON.parse(W3.reads['AC.L2-3.1.21.block-storage']);
    delete own.assignments;
    const fake = fakeTenant(sub, [], own, { assign: false }); // the POST stores the object; the assignment does not take
    const { result, record, setSent } = await run('w5c3-2-usb-noassign', 't-usb-n', sub, ['AC.L2-3.1.21'], fake);
    expect(setSent).toBe(true);
    expect(result.success).toBe(false);
    expect(record.complianceVerdict).toBe('NOT_SAT');
  });

  it('screen lock, organisation value 10: a customer policy at 12 is found (registry bound 15) but fails the 10-minute bound; NOT_SAT, no SET', async () => {
    const decision: OrgValueDecision = { path: '$.passwordMinutesOfInactivityBeforeScreenTimeout', token: 'passwordMinutesOfInactivityBeforeScreenTimeout', op: 'lte', control_ids: ['AC.L2-3.1.10'], source: 'answered', organisation_value: 10, registry_value: 15, configured_value: 10, basis: 'organisation' };
    const sub = asSub('AC.L2-3.1.10.screen-lock', { org_values: [decision] });
    const customer = { id: 'c-1', '@odata.type': '#microsoft.graph.windows10GeneralConfiguration', displayName: 'Customer Screen Lock', passwordRequired: true, passwordMinutesOfInactivityBeforeScreenTimeout: 12, assignments: ASSIGNED };
    const fake = fakeTenant(sub, [customer]);
    const { result, record, setSent } = await run('w5c3-2-lock', 't-lock', sub, ['AC.L2-3.1.10'], fake);
    expect(setSent).toBe(false);
    expect(result.success).toBe(false);
    expect(record.complianceVerdict).toBe('NOT_SAT');
    expect(record.metadata.commandExecuted).toBe('[already exists: SET not sent]');
    expect(record.metadata.lookupMatch).toMatchObject({ basis: 'effect', object: 'Customer Screen Lock' });
    expect(record.outcomeRationale).toContain('$.passwordMinutesOfInactivityBeforeScreenTimeout lte 10 (observed 12)');
    // at 5 minutes the same customer policy is verified
    const ok = fakeTenant(sub, [{ ...customer, passwordMinutesOfInactivityBeforeScreenTimeout: 5 }]);
    const r5 = await run('w5c3-2-lock5', 't-lock5', sub, ['AC.L2-3.1.10'], ok);
    expect(r5.result.success).toBe(true);
    expect(r5.record.complianceVerdict).toBe('SAT');
  });

  it("CES's own object found by name keeps the entry's own rule (an own policy that lost its assignment fails)", async () => {
    const sub = asSub('MP.L2-3.8.6.bitlocker');
    const own = JSON.parse(W3.reads['MP.L2-3.8.6.bitlocker']);
    const ok = await run('w5c3-2-bl', 't-bl', sub, ['MP.L2-3.8.6'], fakeTenant(sub, [own]));
    expect(ok.result.success).toBe(true);
    expect(ok.record.metadata.lookupMatch).toEqual({ basis: 'name', object: 'CMMC-BitLocker-Policy' });
    const lost = await run('w5c3-2-bl-lost', 't-bl-l', sub, ['MP.L2-3.8.6'], fakeTenant(sub, [{ ...own, assignments: [] }]));
    expect(lost.result.success).toBe(false);
    expect(lost.setSent).toBe(false);
  });
});

// ---- translate: the sub-commands carry the lookup block and the assigning SET ----

describe('W5c3 part 2: translate (PlanTranslator with the real registry)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stamper-w5c3-2-tr-'));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const CONTROLS = ['AC.L2-3.1.15', 'AC.L2-3.1.16', 'MA.L2-3.7.1'];
  const translate = () => {
    const mp = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'synthetic-mission-plan.json'), 'utf-8'));
    const tm = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'synthetic-tenant-manifest.json'), 'utf-8'));
    const hp = mp.outputs.human_readable_mission_plan;
    const base = hp.steps.find((s: any) => s.task_type === 'configuration') ?? hp.steps[0];
    hp.steps = CONTROLS.map(c => ({ ...clone(base), id: `step_task_${c}_w5c3`, title: c, task_type: 'configuration', control_coverage: [{ control_id: c, support_type: 'Configurable', gap_rationale: 'gap' }], depends_on: [] }));
    hp.control_directives = CONTROLS.map(c => ({ control_id: c, directive: 'implement', step_ids: [`task_${c}_w5c3`] }));
    const body = tm.tenant_manifest ?? tm;
    for (const c of CONTROLS) {
      if (!body.normative_controls.some((n: any) => n.control_id === c)) {
        body.normative_controls.push({ control_id: c, required_state: c, verification: [{ id: `chk_0_${c}`, description: 'Examine configuration exports', method: 'config_export', expected: `${c} verification passes`, on_fail: 'flag', presence_only: true }], evidence_artifacts: [] });
      }
    }
    const tmPath = path.join(tmp, 'tm-w5c3-2.json');
    fs.writeFileSync(tmPath, JSON.stringify(tm));
    return new PlanTranslator(registry).translate(mp, ManifestReader.fromFile(tmPath));
  };
  const subsOf = (t: ExeTask) => (t.action.args._sub_commands ?? []) as SubCommand[];

  it('each lookup entry becomes a sub-command carrying the block, the generated GET and the assigning SET', () => {
    const plan = translate().plan;
    const subs = plan.execution_graph.flatMap(subsOf);
    for (const id of ['AC.L2-3.1.15.admin-mfa', 'AC.L2-3.1.16.wifi-profile', 'MA.L2-3.7.1.update-ring']) {
      const s = subs.find(x => x.id === id)!;
      expect([id, s !== undefined]).toEqual([id, true]);
      expect(s.lookup).toEqual(byId(id).lookup);
      expect(s.get_command).toBe(lookupGetCommand(s.lookup!));
      expect(s.idempotency).toBe('get-then-set');
    }
    const ring = subs.find(x => x.id === 'MA.L2-3.7.1.update-ring')!;
    expect(ring.set_command).toContain('/assign"');
    expect(ring.variables_runtime).toContain('cuiGroupId');
  });
});

// ---- follow-up: one update ring at the stricter values, created once, verified by both entries ----

describe('W5c3 part 2 follow-up: the merged update ring', () => {
  const realSetTimeout = global.setTimeout;
  beforeEach(() => {
    (global as any).setTimeout = (fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) =>
      realSetTimeout(fn, ms !== undefined && ms >= 5000 ? 0 : ms, ...args);
  });
  afterEach(() => { (global as any).setTimeout = realSetTimeout; });

  it('the creator writes the stricter values (0 / 14), assigns the ring, captures its id; its rule asserts the stricter values', () => {
    const e = byId(RING);
    expect(e.control_ids).toEqual(['MA.L2-3.7.1', 'MA.L2-3.7.2']);
    expect(e.set_command).toContain("qualityUpdatesDeferralPeriodInDays=0;featureUpdatesDeferralPeriodInDays=14;automaticUpdateMode='autoInstallAndRebootAtScheduledTime';businessReadyUpdatesOnly='all'");
    expect(e.set_command).toContain('/assign"');
    expect(e.set_command).toContain("-ContentType 'application/json' | Out-Null; $created | ConvertTo-Json -Depth 10");
    expect(e.captures).toEqual([{ variable: 'updateRingId', from: 'json_field', json_path: '$.id' }]);
    expect(e.verification?.evidence?.checks).toEqual([
      { jsonpath: '$.qualityUpdatesDeferralPeriodInDays', equals: '0' },
      { jsonpath: '$.featureUpdatesDeferralPeriodInDays', equals: '14' },
      { jsonpath: '$.automaticUpdateMode', equals: 'autoInstallAndRebootAtScheduledTime' },
      { jsonpath: '$.assignments', min_items: 1 },
    ]);
  });

  it('the verifier keeps RA.L2-3.11.3, never creates, and reads and asserts the same ring', () => {
    const v = byId(RING_VERIFIER);
    expect(v.control_ids).toEqual(['RA.L2-3.11.3']);
    expect(v.verify_only).toBe(true);
    expect(v.idempotency).toBe('safe');
    expect(v.set_command).toBe('');
    expect(v.lookup).toEqual(byId(RING).lookup);
    expect(v.get_command).toBe(byId(RING).get_command);
    expect(v.verification).toEqual(byId(RING).verification);
    expect(v.variables_runtime).toEqual(['updateRingId']);
    // no other entry creates a WUfB ring
    expect(registry.allEntries.filter(e => /windowsUpdateForBusinessConfiguration/.test(e.set_command)).map(e => e.entry_id)).toEqual([RING]);
  });

  it('every assignment call discards its response, so the SET prints only the created object', () => {
    for (const id of INTUNE_CREATORS) expect([id, /\/assign" -Body \(@\{assignments=.*?\} \| ConvertTo-Json -Depth 10\) -ContentType 'application\/json' \| Out-Null;/.test(byId(id).set_command)]).toEqual([id, true]);
  });

  const ringRead = () => JSON.parse(W3.reads[RING]);
  const recordOf = (tenant: string, taskId: string, sub: SubCommand) =>
    JSON.parse(fs.readFileSync(taskEvidencePath(evidenceDirForTenant(tenant), taskId, evidenceFileForEntry(sub.id, sub.label).replace(/\.txt$/, '.json')), 'utf-8'));

  it('verify-only, ring present (created earlier by the creator): SAT, no SET, state mode, basis name', async () => {
    const sub = asSub(RING_VERIFIER, { verify_only: true });
    const c = ctx(); c.registerCaptures({ updateRingId: 'deviceConfiguration-9' });
    const fake = fakeTenant(sub, [ringRead()]);
    const adapter = new PowerShellAdapter(config(), fake.manager as any, c, undefined, 'w5c3-2-ra');
    const r = await adapter.execute(taskOf('t-ra', sub, ['RA.L2-3.11.3']), {}, false);
    expect(r.success).toBe(true);
    expect(fake.sent.every(x => !/-Method POST|New-Mg/.test(x))).toBe(true);
    const rec = recordOf('w5c3-2-ra', 't-ra', sub);
    expect(rec.complianceVerdict).toBe('SAT');
    expect(rec.metadata.postcheckMode).toBe('state');
    expect(rec.metadata.commandExecuted).toBe('[verify-only: SET not sent]');
    expect(rec.metadata.lookupMatch).toEqual({ basis: 'name', object: 'CMMC-UpdateRing-Standard' });
  });

  it('verify-only, no ring: a failed record that says it never creates; no SET', async () => {
    const sub = asSub(RING_VERIFIER, { verify_only: true });
    const c = ctx(); c.registerCaptures({ updateRingId: 'x' });
    const fake = fakeTenant(sub, []);
    const adapter = new PowerShellAdapter(config(), fake.manager as any, c, undefined, 'w5c3-2-ra-none');
    const r = await adapter.execute(taskOf('t-ra-n', sub, ['RA.L2-3.11.3']), {}, false);
    expect(r.success).toBe(false);
    expect(fake.list).toHaveLength(0);
    const rec = recordOf('w5c3-2-ra-none', 't-ra-n', sub);
    expect(rec.complianceVerdict).toBe('NOT_SAT');
    expect(rec.outcomeRationale).toContain("verify-only: no 'CMMC-UpdateRing-Standard' or equivalent found");
  });

  it('verify-only, an old 7 / 30 ring by name: NOT_SAT on the stricter values', async () => {
    const sub = asSub(RING_VERIFIER, { verify_only: true });
    const c = ctx(); c.registerCaptures({ updateRingId: 'x' });
    const old = { ...ringRead(), qualityUpdatesDeferralPeriodInDays: 7, featureUpdatesDeferralPeriodInDays: 30 };
    const adapter = new PowerShellAdapter(config(), fakeTenant(sub, [old]).manager as any, c, undefined, 'w5c3-2-ra-old');
    expect((await adapter.execute(taskOf('t-ra-o', sub, ['RA.L2-3.11.3']), {}, false)).success).toBe(false);
  });

  it('a fresh tenant, creator then verifier in one context: exactly one ring is created, both entries SAT', async () => {
    const creator = asSub(RING);
    const verifier = asSub(RING_VERIFIER, { verify_only: true });
    const created = { ...ringRead() };
    delete (created as any).assignments;
    const fake = fakeTenant(creator, [], created);
    const adapter = new PowerShellAdapter(config(), fake.manager as any, ctx(), undefined, 'w5c3-2-merge');
    const r1 = await adapter.execute(taskOf('t-ma', creator, ['MA.L2-3.7.1', 'MA.L2-3.7.2']), {}, false);
    expect(r1.success).toBe(true);
    // the verifier's GET is the creator's GET text, which the fake answers from the same list
    const r2 = await adapter.execute(taskOf('t-ra2', verifier, ['RA.L2-3.11.3']), {}, false);
    expect(r2.success).toBe(true);
    expect(fake.list).toHaveLength(1);
    expect(fake.sent.filter(x => x.includes('$created = ')).length).toBe(1);
  });

  it('translate: the RA.L2-3.11.3 task runs after the MA.L2-3.7.1 task (updateRingId) and carries verify_only', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stamper-w5c3-2-ring-'));
    try {
      const mp = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'synthetic-mission-plan.json'), 'utf-8'));
      const tm = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'synthetic-tenant-manifest.json'), 'utf-8'));
      const hp = mp.outputs.human_readable_mission_plan;
      const base = hp.steps.find((s: any) => s.task_type === 'configuration') ?? hp.steps[0];
      const controls = ['RA.L2-3.11.3', 'MA.L2-3.7.1'];
      hp.steps = controls.map(c => ({ ...clone(base), id: `step_task_${c}_ring`, title: c, task_type: 'configuration', control_coverage: [{ control_id: c, support_type: 'Configurable', gap_rationale: 'gap' }], depends_on: [] }));
      hp.control_directives = controls.map(c => ({ control_id: c, directive: 'implement', step_ids: [`task_${c}_ring`] }));
      const body = tm.tenant_manifest ?? tm;
      for (const c of controls) {
        if (!body.normative_controls.some((n: any) => n.control_id === c)) body.normative_controls.push({ control_id: c, required_state: c, verification: [{ id: `chk_0_${c}`, description: 'x', method: 'config_export', expected: `${c} verification passes`, on_fail: 'flag', presence_only: true }], evidence_artifacts: [] });
      }
      const tmPath = path.join(tmp, 'tm.json');
      fs.writeFileSync(tmPath, JSON.stringify(tm));
      const plan = new PlanTranslator(registry).translate(mp, ManifestReader.fromFile(tmPath)).plan;
      const subsOf = (t: ExeTask) => (t.action.args._sub_commands ?? []) as SubCommand[];
      const ma = plan.execution_graph.find(t => subsOf(t).some(s => s.id === RING))!;
      const ra = plan.execution_graph.find(t => subsOf(t).some(s => s.id === RING_VERIFIER))!;
      expect(ma).toBeDefined();
      expect(ra).toBeDefined();
      expect(ra.id).not.toBe(ma.id);
      expect(ra.depends_on).toContain(ma.id);
      expect(plan.execution_graph.indexOf(ma)).toBeLessThan(plan.execution_graph.indexOf(ra));
      expect(subsOf(ra).find(s => s.id === RING_VERIFIER)!.verify_only).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
