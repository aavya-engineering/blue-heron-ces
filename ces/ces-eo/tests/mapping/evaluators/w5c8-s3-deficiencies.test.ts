// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Synthetic-customer W5 cycle 8: the six deficiencies of the deliberately deficient customer S3 (s3-def)
 * that run 60 credited as met. Each evaluator now decides not_met (Tier 2, which outranks the Stamper
 * records that credited them) on S3's reads, and does not move on the S1 (s1-mach) / S2 (s2-eng) shapes:
 *   S3-D12 IA.L1-3.5.1 shared shop-floor login; S3-D06 IA.L2-3.5.3 accounts without MFA registration;
 *   S3-D04 AC.L2-3.1.7 standing privileged role on a normal account; S3-D11 AC.L1-3.1.22 anonymous links;
 *   S3-D13 RA.L2-3.11.3 critical vulnerabilities untracked; S3-D14 IR.L2-3.6.1 alerts unhandled for 20 days.
 * Plus SC-1 row 1: no role token renders empty ("managed by ."). Fixtures are the run-60 (S3) store shapes
 * and the S1 / S2 seed-builder shapes, copied inline: simulator-style ids and fictional names only.
 */
import { describe, test, expect, afterAll } from '@jest/globals';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { SignalResult } from 'ces-shared/types/signal';
import { evaluatorRegistry } from '../../../src/eo/mapping/evaluators/index.js';
import { SHARED_LOGIN_REVIEW } from '../../../src/eo/mapping/evaluators/ia-evaluators.js';
import { SignalToControlMapper } from '../../../src/eo/mapping/SignalToControlMapper.js';
import { SHARED_ACCOUNT_RE, REQUIREMENT_DEFAULTS } from '../../../src/eo/mapping/evaluators/conditions.js';
import { COLLECTED, OBSERVED_FIELD } from '../../../src/eo/collect/Collector.js';
import { ComplianceSignalFetcher } from '../../../src/eo/ingestion/ComplianceSignalFetcher.js';
import { replayRun20Snapshot, controlsRefPath, sprsWeightsPath } from '../../ssp/run20-replay.js';

const SRC_REGISTRY = path.resolve(__dirname, '../../../../ces-shared/src/data/control-signal-registry.json');
const TS = '2026-10-29T03:06:24.000Z';
const DAY = 86_400_000;
const ago = (days: number, minutes = 0) => new Date(Date.parse(TS) - days * DAY - minutes * 60_000).toISOString();
const sig = (signalId: string, endpoint: string, rows: unknown[], source: 'graph' | 'powershell' = 'graph'): SignalResult =>
  ({ signalId, source, endpoint, timestamp: TS, rawData: { value: rows }, status: 'success' } as SignalResult);
const fn = (name: string) => evaluatorRegistry[name];
const GA = '62e90394-69f5-4237-9190-012177145e10';
const SEC_ADMIN = '194ae4cb-b126-40b2-bd5b-6091b380977d';
const LIC = [{ disabledPlans: [], skuId: 'sim-sku-g3-gcchigh' }];

// ------------------------------------------------------------------ S3 (run 60 store shapes)
const s3Domain = 's3-def.simtenant.onmicrosoft.us';
const s3User = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `user-${n}`, userPrincipalName: `staff${n}@${s3Domain}`, displayName: `Staff Member ${n}`, accountEnabled: true,
  assignedLicenses: LIC, userType: 'Member', ...extra,
});
// 60 accounts: user-1..user-26 office staff (registered), user-27..user-56 assemblers (unregistered),
// user-57 the shared shop-floor login, user-58 / user-59 admin accounts, user-60 the emergency account.
// Disabled at E6 / E7A: the three idle staff (user-16, user-33, user-40) and the stale admin (user-59).
const S3_DISABLED = new Set(['user-16', 'user-33', 'user-40', 'user-59']);
const s3Users = Array.from({ length: 60 }, (_, i) => {
  const n = i + 1;
  const base = s3User(n, { accountEnabled: !S3_DISABLED.has(`user-${n}`) });
  if (n === 1) return { ...base, userPrincipalName: `derwyn.arrowbrook@${s3Domain}`, displayName: 'Derwyn Arrowbrook' };
  if (n === 57) return { ...base, userPrincipalName: `shopfloor@${s3Domain}`, displayName: 'Shop Floor Terminal (shared login)' };
  if (n === 58) return { ...base, userPrincipalName: `adm-belmira.pennanmore@${s3Domain}`, displayName: 'Belmira Pennanmore (Admin)', assignedLicenses: [] };
  if (n === 59) return { ...base, userPrincipalName: `adm-caddow.heskhurst@${s3Domain}`, displayName: 'Caddow Heskhurst (Admin)', assignedLicenses: [] };
  if (n === 60) return { ...base, userPrincipalName: `emergency.access@${s3Domain}`, displayName: 'Emergency Access', assignedLicenses: [] };
  return base;
});
const s3Registered = (n: number) => n <= 26 || n === 58;
const s3Registration = s3Users.map((u, i) => ({
  id: u.id, userPrincipalName: u.userPrincipalName, isMfaRegistered: s3Registered(i + 1), isMfaCapable: s3Registered(i + 1),
  methodsRegistered: s3Registered(i + 1) ? ['mobilePhone'] : [], defaultMfaMethod: s3Registered(i + 1) ? 'mobilePhone' : 'none',
}));
const s3RoleAssignments = [
  { directoryScopeId: '/', id: 'roleAssignment-1', principalId: 'user-1', roleDefinitionId: GA },
  { directoryScopeId: '/', id: 'roleAssignment-2', principalId: 'user-58', roleDefinitionId: GA },
  { directoryScopeId: '/', id: 'roleAssignment-3', principalId: 'user-60', roleDefinitionId: GA },
  { directoryScopeId: '/', id: 'roleAssignment-4', principalId: 'user-59', roleDefinitionId: SEC_ADMIN },
];
const s3AuthMethods = { id: 'authenticationMethodsPolicy', authenticationMethodConfigurations: [
  { id: 'Fido2', state: 'enabled' }, { id: 'MicrosoftAuthenticator', state: 'enabled' }, { id: 'Sms', state: 'enabled' }, { id: 'SoftwareOath', state: 'disabled' },
] };
const site = 'https://s3-def.sharepoint.us/sites/program-drawings';
const s3Ual = [
  { AuditData: JSON.stringify({ CreationTime: '2026-10-26T07:54:00', Id: '53530000-00a1-4000-8000-000000000008', Operation: 'AnonymousLinkCreated', RecordType: 14, UserKey: 'user-36', Workload: 'SharePoint', UserId: `staff36@${s3Domain}`, ObjectId: site, SharingLinkScope: 'Anyone', EventData: '<Type>Edit</Type>' }),
    CreationDate: '2026-10-26T07:54:00.000Z', Identity: '53530000-00a1-4000-8000-000000000008', Operations: 'AnonymousLinkCreated', RecordType: 'SharePointSharingOperation', UserIds: `staff36@${s3Domain}` },
  { AuditData: JSON.stringify({ Operation: 'FileAccessed', Workload: 'SharePoint', ObjectId: `${site}/Shared Documents/harness-rev-c.pdf` }),
    CreationDate: '2026-10-25T09:00:00.000Z', Identity: '53530000-00a1-4000-8000-000000000003', Operations: 'FileAccessed', RecordType: 'SharePointFileOperation', UserIds: `staff2@${s3Domain}` },
];
const CRITICAL_DEVICES = ['S3-WS-003', 'S3-WS-007', 'S3-WS-011', 'S3-WS-015', 'S3-WS-019', 'S3-WS-022', 'S3-WS-027', 'S3-SF-01', 'S3-SF-03'];
const tvmRow = (cve: string, device: string, sev: string, done: boolean) => ({
  CveId: cve, CveMitigationStatus: done ? 'applied' : '', DeviceId: `managedDevice-${device}`, DeviceName: device, OSPlatform: 'Windows11',
  RecommendedSecurityUpdate: done ? '' : 'Update windows_11 to the current release', RecommendedSecurityUpdateId: done ? '' : `S3KB${cve.slice(-5)}`,
  SoftwareName: 'windows_11', SoftwareVendor: 'microsoft', SoftwareVersion: '10.0.22631.4037', VulnerabilitySeverityLevel: sev, [OBSERVED_FIELD]: TS,
});
const s3Tvm = [
  ...CRITICAL_DEVICES.map((d, i) => tvmRow(`CVE-2026-8000${i + 1}`, d, 'Critical', false)),
  tvmRow('CVE-2026-80010', 'S3-WS-001', 'High', true),
  tvmRow('CVE-2026-80011', 'S3-WS-002', 'High', false),
  tvmRow('CVE-2026-80022', 'S3-WS-004', 'Medium', true),
];
const s3Alerts = [
  { id: 'alert-s3-1', title: 'Suspicious PowerShell command line', severity: 'high', status: 'new', assignedTo: null, classification: null, incidentId: 'incident-s3-1', createdDateTime: ago(20, 130), lastUpdateDateTime: ago(20, 130) },
  { id: 'alert-s3-2', title: 'Unfamiliar sign-in properties', severity: 'medium', status: 'new', assignedTo: null, classification: null, incidentId: 'incident-s3-2', createdDateTime: ago(20, 410), lastUpdateDateTime: ago(20, 410) },
];
const s3Incidents = s3Alerts.map((a, i) => ({ id: a.incidentId, displayName: `Incident ${i + 1}`, severity: a.severity, status: 'active', classification: 'unknown', determination: 'unknown', assignedTo: null, createdDateTime: a.createdDateTime, lastUpdateDateTime: a.lastUpdateDateTime }));

// W7-EO: S3's managed devices (customer.json inventory): the four shop-floor terminals' primary user is the shared login.
const s3Devices = [
  ...[1, 2, 3].map(n => ({ id: `managedDevice-${n}`, deviceName: `S3-WS-00${n}`, userPrincipalName: `staff${n + 1}@${s3Domain}` })),
  ...[1, 2, 3, 4].map(n => ({ id: `managedDevice-${30 + n}`, deviceName: `S3-SF-0${n}`, userPrincipalName: `shopfloor@${s3Domain}` })),
];
const s3Signals = (): SignalResult[] => [
  sig('directoryUsers', '/users', s3Users),
  sig('managedDevices', '/deviceManagement/managedDevices', s3Devices),
  sig('userRegistrationDetails', '/reports/authenticationMethods/userRegistrationDetails', s3Registration),
  sig('authMethods', '/policies/authenticationMethodsPolicy', [s3AuthMethods]),
  sig('roleAssignmentsAll', '/roleManagement/directory/roleAssignments', s3RoleAssignments),
  sig(COLLECTED.PIM_ACTIVATIONS, '/roleManagement/directory/roleAssignmentScheduleRequests', []),
  sig(COLLECTED.UNIFIED_AUDIT_LOG, 'Search-UnifiedAuditLog', s3Ual, 'powershell'),
  sig(COLLECTED.TVM_VULNERABILITIES, '/security/runHuntingQuery', s3Tvm),
  sig(COLLECTED.SECURITY_ALERTS, '/security/alerts_v2', s3Alerts),
  sig(COLLECTED.SECURITY_INCIDENTS, '/security/incidents', s3Incidents),
];

// ------------------------------------------------------------------ S1 / S2 (seed-builder shapes)
const shape = (slug: string, admins: string[], breakGlass: string[], service: string[]) => {
  const domain = `${slug}.simtenant.onmicrosoft.us`;
  const staff = Array.from({ length: 6 }, (_, i) => ({ id: `user-${i + 1}`, userPrincipalName: `person${i + 1}.surname@${domain}`, displayName: `Person ${i + 1} Surname`, accountEnabled: true, assignedLicenses: LIC }));
  let n = staff.length;
  const other = (local: string, displayName: string) => ({ id: `user-${++n}`, userPrincipalName: `${local}@${domain}`, displayName, accountEnabled: true, assignedLicenses: [] });
  const adminRows = admins.map(a => other(a, `${a} (Admin)`));
  const bgRows = breakGlass.map(b => other(b, 'Break Glass'));
  const svcRows = service.map(s => other(s, `Service ${s}`));
  const users = [...staff, ...adminRows, ...bgRows, ...svcRows];
  const site1 = `https://${slug}.sharepoint.us/sites/cui-enclave`;
  const signals: SignalResult[] = [
    sig('directoryUsers', '/users', users),
    // S1 / S2: every non-service account is registered (Authenticator for staff, FIDO2 for admins and break-glass).
    sig('userRegistrationDetails', '/reports/authenticationMethods/userRegistrationDetails', users.filter(u => !svcRows.includes(u)).map(u => ({ id: u.id, userPrincipalName: u.userPrincipalName, isMfaRegistered: true }))),
    sig('authMethods', '/policies/authenticationMethodsPolicy', [{ authenticationMethodConfigurations: [{ id: 'Fido2', state: 'enabled' }, { id: 'MicrosoftAuthenticator', state: 'enabled' }] }]),
    // Standing Global Administrator on the break-glass accounts only; the admins are PIM-eligible.
    sig('roleAssignmentsAll', '/roleManagement/directory/roleAssignments', bgRows.map((b, i) => ({ id: `roleAssignment-${i + 1}`, principalId: b.id, roleDefinitionId: GA, directoryScopeId: '/' }))),
    sig(COLLECTED.PIM_ACTIVATIONS, '/roleManagement/directory/roleAssignmentScheduleRequests', [{ id: 'request-1', principalId: adminRows[0].id, roleDefinitionId: GA, action: 'selfActivate', createdDateTime: ago(4) }]),
    sig(COLLECTED.UNIFIED_AUDIT_LOG, 'Search-UnifiedAuditLog', [{ AuditData: JSON.stringify({ Operation: 'SharingSet', Workload: 'SharePoint', ObjectId: site1, TargetUserOrGroupName: 'CUI-Authorized-Users' }), CreationDate: ago(3), Identity: `${slug}-ual-1`, Operations: 'SharingSet', RecordType: 'SharePointSharingOperation', UserIds: staff[0].userPrincipalName }], 'powershell'),
    // c = 1..4 Critical, remediated; c = 29, 30 High and 31 Medium open with Defender's recommendation.
    sig(COLLECTED.TVM_VULNERABILITIES, '/security/runHuntingQuery', [
      ...[1, 2, 3, 4].map(c => ({ ...tvmRow(`CVE-2026-9000${c}`, `${slug.toUpperCase()}-WS-00${c}`, 'Critical', true) })),
      ...[29, 30].map(c => ({ ...tvmRow(`CVE-2026-900${c}`, `${slug.toUpperCase()}-WS-0${c}`, 'High', false) })),
      tvmRow('CVE-2026-90031', `${slug.toUpperCase()}-WS-031`, 'Medium', false),
    ]),
    sig(COLLECTED.SECURITY_ALERTS, '/security/alerts_v2', [
      { id: `alert-${slug}-1`, status: 'resolved', assignedTo: adminRows[0].userPrincipalName, classification: 'truePositive', createdDateTime: ago(12, 120), lastUpdateDateTime: ago(10) },
      { id: `alert-${slug}-5`, status: 'inProgress', assignedTo: adminRows[0].userPrincipalName, classification: null, createdDateTime: ago(3), lastUpdateDateTime: ago(1) },
      { id: `alert-${slug}-6`, status: 'new', assignedTo: null, classification: null, createdDateTime: ago(1, 300), lastUpdateDateTime: ago(1, 300) },
    ]),
    sig(COLLECTED.SECURITY_INCIDENTS, '/security/incidents', [
      { id: `incident-${slug}-1`, status: 'resolved', assignedTo: adminRows[0].userPrincipalName, classification: 'truePositive', createdDateTime: ago(12, 120), lastUpdateDateTime: ago(10) },
      { id: `incident-${slug}-2`, status: 'active', assignedTo: adminRows[0].userPrincipalName, classification: 'unknown', createdDateTime: ago(3), lastUpdateDateTime: ago(1) },
    ]),
  ];
  return { users, signals, breakGlassIds: bgRows.map(b => b.id) };
};
const S1 = shape('s1-mach', ['adm.tamsel.kettlevane', 'adm.corvane.marrowholt', 'adm.dorrel.nettlecombe', 'adm.kestin.oakenwick'], ['bg.access01', 'bg.access02'], ['svc.backup', 'svc.camsync']);
const S2 = shape('s2-eng', ['adm-arlow.junipbank', 'adm-galwyn.rowanfield', 'adm-roswen.dunnridge'], ['eaa.01', 'eaa.02'], ['svc.entraconnect']);

const SIX = ['IA.L1-3.5.1', 'IA.L2-3.5.3', 'AC.L2-3.1.7', 'AC.L1-3.1.22', 'RA.L2-3.11.3', 'IR.L2-3.6.1'];
// W7-EO: the ces-shared source registry plus the contract-note-40 row (IA.L1-3.5.1 reads the managed devices),
// written to a temporary file until the orchestrator applies the row in ces-shared.
const NOTE40_ROW = { type: 'graph', endpoint: '/deviceManagement/managedDevices' };
const W7_REGISTRY = (() => {
  const reg = JSON.parse(fs.readFileSync(SRC_REGISTRY, 'utf-8'));
  const ia = reg['IA.L1-3.5.1'];
  if (!ia.signals.some((s: { endpoint: string }) => s.endpoint === NOTE40_ROW.endpoint)) ia.signals.push(NOTE40_ROW);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'w7-eo-registry-')), 'control-signal-registry.json');
  fs.writeFileSync(file, JSON.stringify(reg));
  return file;
})();
afterAll(() => fs.rmSync(path.dirname(W7_REGISTRY), { recursive: true, force: true }));
const mapped = (signals: SignalResult[]) => {
  const out = new SignalToControlMapper(W7_REGISTRY).mapSignalsToControls(signals, evaluatorRegistry);
  return Object.fromEntries(SIX.map(id => [id, out.find(a => a.control_id === id)!]));
};

describe('S3-D12 IA.L1-3.5.1: a shared or generic login', () => {
  test('S3: the shared shop-floor login, primary user of four terminals, decides not_met, printed with its UPN and devices', () => {
    const v = fn('userDeviceIdentifyEvaluator')([sig('directoryUsers', '/users', s3Users), sig('managedDevices', '/deviceManagement/managedDevices', s3Devices)]);
    expect(v.status).toBe('not_met');
    expect(v.evidence).toContain(`1 enabled account(s) named as a shared or generic login and primary user of more than one managed device`);
    expect(v.evidence).toContain(`user-57 (shopfloor@${s3Domain}, 'Shop Floor Terminal (shared login)') on 4 devices (S3-SF-01, S3-SF-02, S3-SF-03, S3-SF-04)`);
  });
  test('W7-EO: the name alone is a review finding, never not_met (no device read, or one device)', () => {
    const none = fn('userDeviceIdentifyEvaluator')([sig('directoryUsers', '/users', s3Users)]);
    expect(none.status).toBe('not_assessed');
    expect(none.evidence).toContain(`${SHARED_LOGIN_REVIEW}: user-57 (shopfloor@${s3Domain}, 'Shop Floor Terminal (shared login)') (managed devices with this primary user: 0)`);
    const one = fn('userDeviceIdentifyEvaluator')([sig('directoryUsers', '/users', s3Users), sig('managedDevices', '/deviceManagement/managedDevices', s3Devices.slice(0, 4))]);
    expect(one.status).toBe('not_assessed');
    expect(one.evidence).toContain('(managed devices with this primary user: 1)');
  });
  test('W7-EO: PowerShell SDK (PascalCase) device rows and a userId match corroborate the same; duplicates across reads count once', () => {
    const pascal = s3Devices.map(d => ({ Id: d.id, DeviceName: d.deviceName, UserPrincipalName: d.userPrincipalName }));
    const byId = s3Devices.map(d => ({ id: d.id, deviceName: d.deviceName, userId: d.userPrincipalName.startsWith('shopfloor') ? 'user-57' : 'user-2' }));
    const v = fn('userDeviceIdentifyEvaluator')([sig('directoryUsers', '/users', s3Users), sig('managedDevices', '/deviceManagement/managedDevices', pascal), sig('managedDevicesAll', '/deviceManagement/managedDevices', byId)]);
    expect(v.status).toBe('not_met');
    expect(v.evidence).toContain('on 4 devices');
  });
  test('a disabled shared login does not count', () => {
    const users = s3Users.map(u => (u.id === 'user-57' ? { ...u, accountEnabled: false } : u));
    const v = fn('userDeviceIdentifyEvaluator')([sig('directoryUsers', '/users', users), sig('managedDevices', '/deviceManagement/managedDevices', s3Devices)]);
    expect(v.status).toBe('not_assessed');
    expect(v.evidence).not.toContain(SHARED_LOGIN_REVIEW);
  });
  test.each([['S1', S1], ['S2', S2]])('%s: admin, break-glass and service names do not match; the verdict stays not_assessed (no device read)', (_n, c) => {
    for (const u of c.users) {
      expect(SHARED_ACCOUNT_RE.test(String(u.userPrincipalName).split('@')[0])).toBe(false);
      expect(SHARED_ACCOUNT_RE.test(String(u.displayName))).toBe(false);
    }
    expect(fn('userDeviceIdentifyEvaluator')([sig('directoryUsers', '/users', c.users)]).status).toBe('not_assessed');
  });
});

describe('S3-D06 IA.L2-3.5.3: accounts without MFA registration', () => {
  const reads = (users: unknown[], reg: unknown[]) => [
    sig('authMethods', '/policies/authenticationMethodsPolicy', [s3AuthMethods]),
    sig('directoryUsers', '/users', users),
    sig('userRegistrationDetails', '/reports/authenticationMethods/userRegistrationDetails', reg),
  ];
  test('S3: enabled methods do not credit; the unregistered enabled accounts are counted and named by id', () => {
    const v = fn('mfaMethodsEvaluator')(reads(s3Users, s3Registration));
    expect(v.status).toBe('not_met');
    // 60 rows less the 4 disabled = 56 enabled; unregistered: 30 assemblers + shared + stale admin + emergency = 33, less 2 disabled assemblers and the stale admin.
    expect(v.evidence).toContain('30 of 56 enabled account(s) in the registration report have no MFA method registered');
    expect(v.evidence).toContain(`user-57 (shopfloor@${s3Domain})`);
    expect(v.evidence).toContain(`user-60 (emergency.access@${s3Domain})`);
    expect(v.evidence).not.toContain('user-33 ');
  });
  test('PowerShell SDK (PascalCase) rows read the same; without a users read every row counts', () => {
    const pascal = s3Registration.map(r => ({ Id: r.id, UserPrincipalName: r.userPrincipalName, IsMfaRegistered: r.isMfaRegistered }));
    const v = fn('mfaMethodsEvaluator')([reads([], [])[0], sig('userRegistrationDetails', '/reports/authenticationMethods/userRegistrationDetails', pascal)]);
    expect(v.status).toBe('not_met');
    expect(v.evidence).toContain('33 of 60 enabled account(s)');
  });
  test.each([['S1', S1], ['S2', S2]])('%s: everyone registered -> unchanged (no conditional access read: not_assessed)', (_n, c) => {
    const v = fn('mfaMethodsEvaluator')(c.signals);
    expect(v.status).toBe('not_assessed');
    expect(v.evidence).toContain('no conditional access read reached this control');
  });
});

describe('S3-D04 AC.L2-3.1.7: a standing privileged role on a normal account', () => {
  test('S3: the licensed owner account holding standing Global Administrator decides not_met; dedicated and disabled admins are not named', () => {
    const v = fn('privilegedFunctionEvaluator')(s3Signals());
    expect(v.status).toBe('not_met');
    expect(v.evidence).toContain('1 standing privileged assignment(s) on accounts that are not dedicated admin accounts');
    expect(v.evidence).toContain(`user-1 (derwyn.arrowbrook@${s3Domain}, 'Derwyn Arrowbrook') holds standing Global Administrator as a licensed normal user account`);
    for (const id of ['user-58', 'user-59', 'user-60']) expect(v.evidence).not.toContain(`${id} (`);
  });
  test('a shared login with a privileged role is named as such; a supplied break-glass id and a stated naming convention excuse', () => {
    const roles = [...s3RoleAssignments, { id: 'roleAssignment-5', principalId: 'user-57', roleDefinitionId: SEC_ADMIN, directoryScopeId: '/' }];
    const signals = [sig('directoryUsers', '/users', s3Users), sig('roleAssignmentsAll', '/roleManagement/directory/roleAssignments', roles)];
    expect(fn('privilegedFunctionEvaluator')(signals).evidence).toContain('holds standing Security Administrator as a shared or generic login');
    const excused = fn('privilegedFunctionEvaluator')([sig('directoryUsers', '/users', s3Users), sig('roleAssignmentsAll', '/roleManagement/directory/roleAssignments', s3RoleAssignments)], { breakGlassIds: ['user-1'] });
    expect(excused.status).toBe('not_assessed'); // falls through to the activation records (not read here)
    const convention = fn('privilegedFunctionEvaluator')([sig('directoryUsers', '/users', s3Users), sig('roleAssignmentsAll', '/roleManagement/directory/roleAssignments', s3RoleAssignments)], { adminNamingConvention: '{firstname}.{lastname}@{domain}' });
    expect(convention.status).toBe('not_assessed');
  });
  test.each([['S1', S1], ['S2', S2]])('%s: standing roles on unlicensed break-glass accounts only -> the activation-logging rule decides met, as before', (_n, c) => {
    const v = fn('privilegedFunctionEvaluator')(c.signals);
    expect(v.status).toBe('met');
    expect(v.evidence).toContain('1 privileged-role activation request(s) in the last 30 days are each logged');
  });
});

describe('S3-D11 AC.L1-3.1.22: anonymous sharing links in the unified audit log', () => {
  test('S3: the AnonymousLinkCreated event decides not_met, naming the site', () => {
    const v = fn('publicSharingEvaluator')([sig(COLLECTED.UNIFIED_AUDIT_LOG, 'Search-UnifiedAuditLog', s3Ual, 'powershell')]);
    expect(v.status).toBe('not_met');
    expect(v.evidence).toContain("1 anonymous ('Anyone') sharing-link event(s) in the unified audit log (AnonymousLinkCreated)");
    expect(v.evidence).toContain(site);
  });
  test('a SharingLinkScope Anyone row under another operation name counts', () => {
    const row = { ...s3Ual[0], Operations: 'SharingInvitationCreated' };
    expect(fn('publicSharingEvaluator')([sig(COLLECTED.UNIFIED_AUDIT_LOG, 'Search-UnifiedAuditLog', [row], 'powershell')]).status).toBe('not_met');
  });
  test.each([['S1', S1], ['S2', S2]])('%s: a SharingSet to a named group is not anonymous; the settings read still decides (unread: not_assessed)', (_n, c) => {
    const v = fn('publicSharingEvaluator')(c.signals);
    expect(v.status).toBe('not_assessed');
    expect(v.evidence).toContain('SharePoint sharing settings');
  });
});

describe('S3-D13 RA.L2-3.11.3: critical vulnerabilities with no mitigation status', () => {
  test('S3: the 9 open Critical vulnerabilities are untracked although Defender recommends an update', () => {
    const v = fn('vulnRemediationEvaluator')([sig(COLLECTED.TVM_VULNERABILITIES, '/security/runHuntingQuery', s3Tvm)]);
    expect(v.status).toBe('not_met');
    expect(v.evidence).toContain('9 of 12 vulnerability(ies) are neither remediated nor tracked');
    expect(v.evidence).toContain('9 Critical with no mitigation or remediation status');
    for (const d of CRITICAL_DEVICES) expect(v.evidence).toContain(`(Critical) on ${d}`);
    expect(v.evidence).not.toContain('S3-WS-002'); // the open High keeps its recommendation as tracking
  });
  test('a Critical with a mitigation status is tracked', () => {
    const rows = s3Tvm.map(r => (r.VulnerabilitySeverityLevel === 'Critical' ? { ...r, CveMitigationStatus: 'Mitigation in progress (ticket S3-CHG-1)' } : r));
    expect(fn('vulnRemediationEvaluator')([sig(COLLECTED.TVM_VULNERABILITIES, '/security/runHuntingQuery', rows)]).status).toBe('met');
  });
  test.each([['S1', S1], ['S2', S2]])('%s: Criticals remediated, open High / Medium tracked by recommendation -> met, as before', (_n, c) => {
    const v = fn('vulnRemediationEvaluator')(c.signals);
    expect(v.status).toBe('met');
    expect(v.evidence).toContain('4 remediated, 3 tracked by a remediation recommendation or status');
  });
});

describe('S3-D14 IR.L2-3.6.1: alerts and incidents unhandled beyond the triage period', () => {
  test(`S3: both alerts new and both incidents active and unassigned for 20 days -> not_met (default ${REQUIREMENT_DEFAULTS.ALERT_TRIAGE_MAX_DAYS} days)`, () => {
    const v = fn('incidentResponseEvaluator')(s3Signals());
    expect(v.status).toBe('not_met');
    expect(v.evidence).toContain(`4 alert(s) or incident(s) left unhandled beyond the ${REQUIREMENT_DEFAULTS.ALERT_TRIAGE_MAX_DAYS}-day triage period`);
    expect(v.evidence).toContain("alert alert-s3-1 'Suspicious PowerShell command line' new for 20 days");
    expect(v.evidence).toContain('incident incident-s3-2 active, unassigned, for 20 days');
  });
  test('the same records inside the triage period stay not_assessed; an organisation value overrides the default', () => {
    const fresh = [sig(COLLECTED.SECURITY_ALERTS, '/security/alerts_v2', s3Alerts.map(a => ({ ...a, createdDateTime: ago(2), lastUpdateDateTime: ago(2) })))];
    expect(fn('incidentResponseEvaluator')(fresh).status).toBe('not_assessed');
    const ctx = { expected: [{ path: '$.triageDays', op: 'lte' as const, value: 30, source: 'odp' }] };
    expect(fn('incidentResponseEvaluator')(s3Signals(), ctx).status).toBe('not_assessed');
  });
  test.each([['S1', S1], ['S2', S2]])('%s: handled records and a 1-day-old new alert -> met, as before', (_n, c) => {
    expect(fn('incidentResponseEvaluator')(c.signals).status).toBe('met');
  });
});

describe('through the mapper with the W5 cycle 8 registry (ces-shared source, plus the W7-EO note-40 row)', () => {
  test('S3: all six controls decide not_met at Tier 2', () => {
    const m = mapped(s3Signals());
    for (const id of SIX) {
      expect([id, m[id].status]).toEqual([id, 'not_met']);
      expect(m[id].sources[0].result).toBe('missing');
    }
  });
  test.each([['S1', S1], ['S2', S2]])('%s: none of the six decides not_met (unchanged)', (_n, c) => {
    const m = mapped(c.signals);
    expect(Object.fromEntries(SIX.map(id => [id, m[id].status]))).toEqual({
      'IA.L1-3.5.1': 'not_assessed', 'IA.L2-3.5.3': 'not_assessed', 'AC.L2-3.1.7': 'met',
      'AC.L1-3.1.22': 'not_assessed', 'RA.L2-3.11.3': 'met', 'IR.L2-3.6.1': 'met',
    });
  });
});

describe('the registration report read', () => {
  test('fetchRegistrationDetails reads the report through its cmdlet with -All (W7-EO); fetchAllSignals reads it once', async () => {
    const cmds: string[] = [];
    const session = { execute: async (_e: string, cmd: string) => { cmds.push(cmd); return { stdout: JSON.stringify({ value: [] }), stderr: '', exitCode: 0, durationMs: 0 }; } };
    const ps = { runExchangeCommands: async (): Promise<SignalResult[]> => [], runPurviewCommands: async (): Promise<SignalResult[]> => [] };
    const f = new ComplianceSignalFetcher(session as any, ps as any);
    const [s] = await f.fetchRegistrationDetails();
    expect(s.signalId).toBe('userRegistrationDetails');
    expect(s.endpoint).toBe('/reports/authenticationMethods/userRegistrationDetails');
    expect(cmds[0]).toBe('Get-MgReportAuthenticationMethodUserRegistrationDetail -All | ConvertTo-Json -Depth 10');
    expect(f.describeRead(s).query).toBe('Get-MgReportAuthenticationMethodUserRegistrationDetail -All');
    const ids = (await f.fetchAllSignals()).map(x => x.signalId);
    expect(ids.filter(i => i === 'userRegistrationDetails')).toHaveLength(1);
  });
});

describe('SC-1 row 1: a role token never renders empty', () => {
  test('no met narrative reads "managed by ." when a control has no Mission Plan owner role', async () => {
    const { SspGenerator } = await import('../../../src/eo/ssp/SspGenerator.js');
    const ssp = new SspGenerator(controlsRefPath, sprsWeightsPath).generate({ assessment: replayRun20Snapshot(), variables: {} });
    const hits = ssp.controlImplementations.filter(c => (c.implementationNarrative ?? '').includes('managed by .') || /\*\*Responsible Party:\*\* *\n/.test(c.implementationNarrative ?? ''));
    expect(hits.map(c => c.control_id)).toEqual([]);
    // Without the default, 29 narratives of this replay (MA.L2-3.7.4 among them) read "managed by .".
    const ma = ssp.controlImplementations.find(c => c.control_id === 'MA.L2-3.7.4')!;
    expect(ma.implementationNarrative).toContain('device compliance policies managed by the System Administrator role.');
    expect(ma.implementationNarrative).toContain('**Responsible Party:** the System Administrator role');
  });
  test('the owner role still wins; a supplied value is never overridden', async () => {
    const { SspGenerator } = await import('../../../src/eo/ssp/SspGenerator.js');
    const g = new SspGenerator(controlsRefPath, sprsWeightsPath) as any;
    expect(g.withRoleDefaults(undefined, undefined)).toEqual({ systemAdministrator: 'the System Administrator role', accessControlAdministrator: 'the Access Control Administrator role' });
    expect(g.withRoleDefaults({}, 'compliance_engineer').systemAdministrator).toBe('the Compliance Engineer role');
    expect(g.withRoleDefaults({ systemAdministrator: 'Named Person (Systems Administrator)' }, undefined).systemAdministrator).toBe('Named Person (Systems Administrator)');
  });
});
