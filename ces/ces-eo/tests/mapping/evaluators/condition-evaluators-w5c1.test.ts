// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Synthetic-customer W5 cycle 1: the 44 formerly presence-only evaluators test a condition.
 * Each gets a fixture that satisfies (met), one that violates (not_met) and an empty or unread
 * read (not_assessed, the read printed). The TM expected-value cases prove the optional `ctx`
 * overrides the requirement default. Fixtures use simulator-style ids only.
 */
import type { SignalResult } from 'ces-shared/types/signal';
import { SignalToControlMapper } from '../../../src/eo/mapping/SignalToControlMapper';
import { evaluatorRegistry, PRESENCE_ONLY_EVALUATORS, type EvaluatorContext } from '../../../src/eo/mapping/evaluators/index';
import { resolvePath, applyCheck } from '../../../src/eo/mapping/evaluators/conditions';

const AT = '2026-10-28T16:00:00.000Z';
const sig = (signalId: string, endpoint: string, rawData: unknown, status: SignalResult['status'] = 'success'): SignalResult => ({
  signalId, source: endpoint.startsWith('/') ? 'graph' : 'powershell', endpoint, timestamp: AT, rawData, status,
});
const GA = '62e90394-69f5-4237-9190-012177145e10';
const SEC_ADMIN = '194ae4cb-b126-40b2-bd5b-6091b380977d';

// --- reads
const CA_EP = '/identity/conditionalAccess/policies';
const ca = (...p: unknown[]) => sig('conditionalAccess', CA_EP, p);
const cfg = (...c: unknown[]) => sig('deviceConfigurations', '/deviceManagement/deviceConfigurations', c);
/** W5 cycle 3: one group assignment, as `$expand=assignments` returns it. */
const GROUP_ASSIGNMENT = { id: 'a-1', target: { '@odata.type': '#microsoft.graph.groupAssignmentTarget', groupId: 'group-cui' } };
const auth = (configs?: unknown[]) => sig('authMethods', '/policies/authenticationMethodsPolicy',
  configs ? { id: 'authenticationMethodsPolicy', authenticationMethodConfigurations: configs } : { id: 'authenticationMethodsPolicy', displayName: 'Authentication Methods Policy' });
const users = (...u: unknown[]) => sig('directoryUsers', '/users', { value: u });
const roles = (...r: unknown[]) => sig('roleAssignments', '/roleManagement/directory/roleAssignments', r);
const elig = (...r: unknown[]) => sig('roleEligibility', '/roleManagement/directory/roleEligibilitySchedules', r);
const one = (id: string, ep: string, v: unknown) => sig(id, ep, v);
const deleted = (...u: unknown[]) => sig('deletedUsers', '/directory/deletedItems/microsoft.graph.user', u);

// --- CA policies
const enabled = { state: 'enabled' };
const mfaAll = { ...enabled, id: 'caPolicy-1', displayName: 'MFA all users', conditions: { users: { includeUsers: ['All'], excludeUsers: ['user-50', 'user-51'] } }, grantControls: { builtInControls: ['mfa'], operator: 'OR' } };
const noGrant = { ...enabled, id: 'caPolicy-2', displayName: 'Sim CA Policy 2', conditions: { users: { includeUsers: ['All'], excludeUsers: [] } } };
const legacyBlock = { ...enabled, id: 'caPolicy-3', displayName: 'Block legacy', conditions: { users: { includeUsers: ['All'] }, clientAppTypes: ['exchangeActiveSync', 'other'] }, grantControls: { builtInControls: ['block'] } };
const locBlock = { ...enabled, id: 'caPolicy-6', displayName: 'Block outside approved', conditions: { users: { includeUsers: ['All'], excludeUsers: ['user-50'] }, locations: { includeLocations: ['All'], excludeLocations: ['namedLocation-1'] } }, grantControls: { builtInControls: ['block'] } };
const adminStrength = { ...enabled, id: 'caPolicy-7', displayName: 'Admin strength', conditions: { users: { includeRoles: [GA], excludeUsers: ['user-50'] } }, grantControls: { authenticationStrength: { id: 'strength-1' }, operator: 'AND' } };
const mobile = { ...enabled, id: 'caPolicy-8', displayName: 'Mobile', conditions: { users: { includeGroups: ['group-1'] }, platforms: { includePlatforms: ['iOS', 'android'] } }, grantControls: { builtInControls: ['compliantDevice'] } };
const session8h = { ...enabled, id: 'caPolicy-9', displayName: 'Session 8h', conditions: { users: { includeUsers: ['All'], excludeUsers: ['user-50'] } }, sessionControls: { signInFrequency: { isEnabled: true, type: 'hours', value: 8 } } };
const session30d = { ...session8h, displayName: 'Session 30d', sessionControls: { signInFrequency: { isEnabled: true, type: 'days', value: 30 } } };
const reportOnly = { ...adminStrength, displayName: 'Remote MFA (report only)', state: 'enabledForReportingButNotEnforced' };

const user = (id: string, extra: Record<string, unknown> = {}) => ({ id, userPrincipalName: `${id}@s1-mach.simtenant.onmicrosoft.us`, accountEnabled: true, assignedLicenses: [], ...extra });
const recent = { signInActivity: { lastSignInDateTime: '2026-10-20T10:00:00.000Z' } };
const old = { signInActivity: { lastSignInDateTime: '2026-06-01T10:00:00.000Z' }, createdDateTime: '2025-01-01T00:00:00.000Z' };
const pwRules = (threshold: number, duration: number) => one('passwordRuleSettings', '/groupSettings', [{ id: 'gs-1', displayName: 'Password Rule Settings',
  values: [{ name: 'LockoutThreshold', value: String(threshold) }, { name: 'LockoutDurationInSeconds', value: String(duration) }] }]);
const approval = (required: boolean) => one('pimPolicies', '/policies/roleManagementPolicies', [{ id: 'roleManagementPolicy-1', rules: [{
  '@odata.type': '#microsoft.graph.unifiedRoleManagementPolicyApprovalRule', id: 'Approval_EndUser_Assignment',
  setting: { isApprovalRequired: required, approvalStages: [{ primaryApprovers: [{ '@odata.type': '#microsoft.graph.singleUser', userId: 'user-46' }] }] } }] }]);
const wifi = (type: string, ssid = 'S1-MACH-CORP') => ({ id: 'deviceConfiguration-6', displayName: 'WiFi', '@odata.type': '#microsoft.graph.windowsWifiConfiguration', ssid, wifiSecurityType: type });

type Case = [evaluator: string, ok: SignalResult[], bad: SignalResult[], empty: SignalResult[]];
const CASES: Case[] = [
  // AC
  ['rbacEvidenceEvaluator',
    [one('directoryRoles', '/directoryRoles', [{ id: 'r1', roleTemplateId: GA, members: [{ id: 'user-50' }, { id: 'user-51' }] }])],
    [one('directoryRoles', '/directoryRoles', [{ id: 'r1', roleTemplateId: GA, members: [1, 2, 3, 4, 5].map(i => ({ id: `user-${i}` })) }])],
    [one('directoryRoles', '/directoryRoles', [])]],
  ['crossTenantEvaluator',
    [one('crossTenantPolicy', '/policies/crossTenantAccessPolicy/default', { id: 'p', b2bCollaborationInbound: { usersAndGroups: { accessType: 'blocked', targets: [{ target: 'AllUsers' }] } } })],
    [one('crossTenantPolicy', '/policies/crossTenantAccessPolicy/default', { id: 'p', b2bCollaborationInbound: { usersAndGroups: { accessType: 'allowed', targets: [{ target: 'AllUsers' }] } } })],
    [one('crossTenantPolicy', '/policies/crossTenantAccessPolicy/default', { id: 'crossTenantAccessPolicy', displayName: 'Default' })]],
  ['publicSharingEvaluator',
    [one('sharepointSettings', '/admin/sharepoint/settings', { sharingCapability: 'existingExternalUserSharingOnly' })],
    [one('sharepointSettings', '/admin/sharepoint/settings', { sharingCapability: 'externalUserAndGuestSharing' })],
    []],
  ['informationBarrierEvaluator',
    [one('dlpLabels', '/informationProtection/policy/labels', [{ id: 'label-1', name: 'CUI', isActive: true }])],
    [one('dlpLabels', '/informationProtection/policy/labels', [{ id: 'policyLabel-1', name: 'Sim Policy Label 1', isActive: true }])],
    [one('dlpLabels', '/informationProtection/policy/labels', [])]],
  ['pimApprovalEvaluator', [approval(true)], [approval(false)],
    [one('pimPolicies', '/policies/roleManagementPolicies', [{ id: 'roleManagementPolicy-1', displayName: 'Sim Role Management Policy 1' }])]],
  ['leastPrivilegeEvaluator',
    [roles({ principalId: 'user-50', roleDefinitionId: GA }), ca(mfaAll), elig({ principalId: 'user-46', roleDefinitionId: GA })],
    [roles({ principalId: 'user-7', roleDefinitionId: GA }), ca(mfaAll), elig({ principalId: 'user-46', roleDefinitionId: GA })],
    [roles({ principalId: 'user-50', roleDefinitionId: GA }), ca(mfaAll)]],
  ['dedicatedAdminEvaluator',
    [users(user('user-46'), user('user-1', { assignedLicenses: [{ skuId: 'g5' }] })), roles({ principalId: 'user-46', roleDefinitionId: SEC_ADMIN })],
    [users(user('user-46'), user('user-1', { assignedLicenses: [{ skuId: 'g5' }] })), roles({ principalId: 'user-1', roleDefinitionId: SEC_ADMIN })],
    [users(user('user-46'))]],
  ['smartLockoutEvaluator', [auth(), pwRules(5, 120)], [auth(), pwRules(20, 120)], [auth()]],
  ['termsOfUseEvaluator',
    [one('agreements', '/agreements', { id: 'touAgreement-1', displayName: 'CUI System Access Notice', isViewingBeforeAcceptanceRequired: true })],
    [one('agreements', '/agreements', { id: 'touAgreement-1', displayName: 'CUI System Access Notice', isViewingBeforeAcceptanceRequired: false })],
    [one('agreements', '/agreements', [])]],
  ['sessionLockEvaluator',
    [cfg({ id: 'c1', displayName: 'Screen lock', passwordMinutesOfInactivityBeforeScreenTimeout: 10, passwordRequired: true })],
    [cfg({ id: 'c1', displayName: 'Screen lock', passwordMinutesOfInactivityBeforeScreenTimeout: 30, passwordRequired: true })],
    [ca(mfaAll)]],
  ['sessionTimeoutEvaluator', [ca(session8h)], [ca(session30d)], [ca()]],
  ['namedLocationEvaluator',
    [one('namedLocations', '/identity/conditionalAccess/namedLocations', [{ id: 'namedLocation-1', displayName: 'Approved-CUI-Networks', isTrusted: true, ipRanges: [{ cidrAddress: '198.51.100.0/24' }] }]),
      one('signInLogs', '/auditLogs/signIns', [{ id: 's-1', ipAddress: '198.51.100.20' }])],
    [one('namedLocations', '/identity/conditionalAccess/namedLocations', [{ id: 'namedLocation-2', displayName: 'Sim Named Location 2', isTrusted: false, ipRanges: [{ cidrAddress: '203.0.113.0/24' }] }])],
    [one('namedLocations', '/identity/conditionalAccess/namedLocations', [])]],
  ['tlsEnforcementEvaluator',
    [one('transportConfig', '/admin/exchangeOnline/transportConfig', { AllowLegacyTLSClients: false, SmtpClientAuthenticationDisabled: true })],
    [one('transportConfig', '/admin/exchangeOnline/transportConfig', { AllowLegacyTLSClients: true, SmtpClientAuthenticationDisabled: true })],
    []],
  ['blockUntrustedEvaluator', [ca(locBlock)], [ca(noGrant)], [ca()]],
  ['adminMfaEvaluator', [ca(adminStrength)], [ca(noGrant)], [ca()]],
  ['wifiProfileEvaluator', [cfg(wifi('wpa2Enterprise'))], [cfg(wifi('wpa2Personal'))], [cfg()]],
  ['wirelessProtectionEvaluator', [cfg(wifi('wpa2Personal'))], [cfg(wifi('open'))], [cfg()]],
  ['mobileDeviceAccessEvaluator', [ca(mobile)], [ca(noGrant)], [ca()]],
  ['appProtectionEvaluator',
    [one('appProtections', '/deviceAppManagement/iosManagedAppProtectionPolicies', [{ id: 'm1', displayName: 'iOS MAM', appDataEncryptionType: 'whenDeviceLocked' }])],
    [one('appProtections', '/deviceAppManagement/iosManagedAppProtectionPolicies', [{ id: 'm1', displayName: 'iOS MAM', deviceComplianceRequired: false, dataBackupBlocked: false }])],
    [one('appProtections', '/deviceAppManagement/iosManagedAppProtectionPolicies', [])]],
  ['removableStorageEvaluator', [cfg({ id: 'c7', displayName: 'Block USB', storageBlockRemovableStorage: true })], [cfg({ id: 'c7', displayName: 'USB', storageBlockRemovableStorage: false })], [cfg()]],
  // IA
  ['userDeviceIdentifyEvaluator',
    [users(user('user-1'), user('user-2')), one('devices', '/devices', [{ id: 'device-1', deviceId: 'd-guid-1' }])],
    [users(user('user-1'), { ...user('user-2'), userPrincipalName: 'user-1@s1-mach.simtenant.onmicrosoft.us' }), one('devices', '/devices', [{ id: 'device-1' }])],
    [users()]],
  ['authTransactionEvaluator', [auth([{ id: 'Fido2', state: 'enabled' }])], [auth([{ id: 'Fido2', state: 'disabled' }, { id: 'Sms', state: 'disabled' }])], [auth()]],
  ['mfaMethodsEvaluator',
    [auth([{ id: 'MicrosoftAuthenticator', state: 'enabled' }]), ca(mfaAll)],
    [auth([{ id: 'MicrosoftAuthenticator', state: 'enabled' }]), ca(noGrant)],
    [auth()]],
  ['authStrengthEvaluator',
    // W5 cycle 5: the strength counts only when an enabled CA policy requires it of privileged roles or all users.
    [one('authStrength', '/policies/authenticationStrengthPolicies', [{ id: 's2', displayName: 'Phishing resistant', allowedCombinations: ['fido2', 'windowsHelloForBusiness', 'x509CertificateMultiFactor'] }]),
      ca({ ...adminStrength, grantControls: { authenticationStrength: { id: 's2' }, operator: 'AND' } })],
    [one('authStrength', '/policies/authenticationStrengthPolicies', [{ id: 's3', displayName: 'Any MFA', allowedCombinations: ['password,microsoftAuthenticatorPush', 'fido2'] }]), ca(adminStrength)],
    [one('authStrength', '/policies/authenticationStrengthPolicies', [{ id: 's1', displayName: 'No combinations', policyType: 'custom' }])]],
  ['inactiveAccountsEvaluator',
    [users(user('user-1'), user('user-60', { createdDateTime: '2026-10-01T00:00:00.000Z' })), deleted({ id: 'user-40', userPrincipalName: '51510000000040004000800000000040user-40@s1-mach.simtenant.onmicrosoft.us', deletedDateTime: '2026-09-01T00:00:00.000Z' })],
    [users(user('user-1'), { ...user('user-61', { createdDateTime: '2026-10-01T00:00:00.000Z' }), userPrincipalName: 'user-40@s1-mach.simtenant.onmicrosoft.us' }), deleted({ id: 'user-40', userPrincipalName: '51510000000040004000800000000040user-40@s1-mach.simtenant.onmicrosoft.us', deletedDateTime: '2026-09-01T00:00:00.000Z' })],
    [users(user('user-1'), user('user-40', { accountEnabled: false }))]],
  ['accountDisableEvaluator', [users(user('user-1', recent), user('user-2', { ...old, accountEnabled: false }))], [users(user('user-2', old))], [users(user('user-1'))]],
  ['passwordComplexityEvaluator', [auth(), cfg({ id: 'c3', displayName: 'Password', passwordMinimumLength: 14 })], [auth(), cfg({ id: 'c3', displayName: 'Password', passwordMinimumLength: 8 })], [auth()]],
  ['passwordReuseEvaluator', [auth(), cfg({ id: 'c3', displayName: 'Password', passwordPreviousPasswordBlockCount: 24 })], [auth(), cfg({ id: 'c3', displayName: 'Password', passwordPreviousPasswordBlockCount: 5 })], [auth()]],
  ['temporaryPasswordEvaluator',
    [auth([{ id: 'TemporaryAccessPass', state: 'enabled', isUsableOnce: true, maximumLifetimeInMinutes: 60 }])],
    [auth([{ id: 'TemporaryAccessPass', state: 'enabled', isUsableOnce: false, maximumLifetimeInMinutes: 60 }])],
    [auth()]],
  ['certBasedAuthEvaluator', [auth(), ca(legacyBlock)], [auth(), ca(noGrant)], [auth()]],
  // CM / SC / SI / MA / MP
  ['changeTrackingEvaluator',
    [one('directoryAudits', '/auditLogs/directoryAudits', [{ id: 'a1', category: 'Policy', activityDisplayName: 'Update policy', activityDateTime: AT, initiatedBy: { user: { id: 'user-46' } } }])],
    [one('directoryAudits', '/auditLogs/directoryAudits', [{ id: 'a1', category: 'Policy', activityDisplayName: 'Update policy', activityDateTime: AT, initiatedBy: {} }])],
    [one('directoryAudits', '/auditLogs/directoryAudits', [])]],
  ['leastFunctionalityEvaluator', [cfg({ id: 'c8', displayName: 'LF', cortanaBlocked: true })], [cfg({ id: 'c8', displayName: 'LF', cortanaBlocked: false })], [cfg({ id: 'deviceConfiguration-1', displayName: 'Sim Device Configuration 1' })]],
  ['applicationControlEvaluator', [cfg({ id: 'c9', displayName: 'AppCtl', appsAllowTrustedAppsSideloading: 'blocked' })], [cfg({ id: 'c9', displayName: 'AppCtl', appsAllowTrustedAppsSideloading: 'allowed' })], [cfg()]],
  ['installControlEvaluator', [cfg({ id: 'c10', displayName: 'Install', developerUnlockSetting: 'blocked' })], [cfg({ id: 'c10', displayName: 'Install', developerUnlockSetting: 'allowed' })], [cfg()]],
  ['sessionTerminationNetworkEvaluator', [cfg({ id: 'c1', displayName: 'Lock', passwordMinutesOfInactivityBeforeScreenTimeout: 10 })], [cfg({ id: 'c1', displayName: 'Lock', passwordMinutesOfInactivityBeforeScreenTimeout: 60 })], [cfg()]],
  ['collaborativeDeviceEvaluator', [cfg({ id: 'c5', displayName: 'Camera', cameraBlocked: true })], [cfg({ id: 'c5', displayName: 'Camera', cameraBlocked: false })], [cfg()]],
  ['malwareProtectionL1Evaluator', [cfg({ id: 'c4', displayName: 'AV', defenderRequireRealTimeMonitoring: true })], [cfg({ id: 'c4', displayName: 'AV', defenderRequireRealTimeMonitoring: false })], [cfg()]],
  ['avUpdateEvaluator', [cfg({ id: 'c4', displayName: 'AV', defenderSignatureUpdateIntervalInHours: 4 })], [cfg({ id: 'c4', displayName: 'AV', defenderSignatureUpdateIntervalInHours: 48 })], [cfg()]],
  ['scanScheduleEvaluator',
    [cfg({ id: 'c4', displayName: 'AV', defenderSystemScanSchedule: 'sunday', defenderScanType: 'full', defenderMonitorFileActivity: 'monitorAllFiles' })],
    [cfg({ id: 'c4', displayName: 'AV', defenderScanType: 'disabled', defenderMonitorFileActivity: 'disable' })],
    [cfg()]],
  ['mediaCheckEvaluator', [cfg({ id: 'c4', displayName: 'AV', defenderScanRemovableDrivesDuringFullScan: true })], [cfg({ id: 'c4', displayName: 'AV', defenderScanRemovableDrivesDuringFullScan: false })], [cfg()]],
  ['remoteMfaEvaluator', [ca(adminStrength)], [ca(reportOnly)], [ca()]],
  ['removableMediaEvaluator', [cfg({ id: 'c7', displayName: 'Block USB', storageBlockRemovableStorage: true })], [cfg({ id: 'c7', displayName: 'USB', storageBlockRemovableStorage: false })], [cfg()]],
  ['unownedStorageEvaluator', [cfg({ id: 'c7', displayName: 'Block USB', storageBlockRemovableStorage: true })], [cfg({ id: 'c7', displayName: 'USB', storageBlockRemovableStorage: false })], [cfg()]],
];

const run = (name: string, signals: SignalResult[], ctx?: EvaluatorContext) => evaluatorRegistry[name](signals, ctx);

describe('W5 cycle 1: the rewritten evaluators test a condition', () => {
  // Addendum: IA.L2-3.5.11 is platform-inherited (not tested), so 43 condition cases plus its own test.
  test('43 cases, none declared presence only', () => {
    expect(CASES).toHaveLength(43);
    for (const [name] of CASES) {
      expect(evaluatorRegistry[name]).toBeDefined();
      expect(PRESENCE_ONLY_EVALUATORS.has(name)).toBe(false);
      expect(evaluatorRegistry[name].presenceOnly).toBeUndefined();
    }
  });

  test.each(CASES)('%s: a satisfying read is met', (name, ok) => {
    const v = run(name, ok);
    expect({ name, ...v }).toMatchObject({ status: 'met' });
  });

  test.each(CASES)('%s: a violating read is not_met', (name, _ok, bad) => {
    const v = run(name, bad);
    expect({ name, ...v }).toMatchObject({ status: 'not_met' });
  });

  test.each(CASES)('%s: an empty, unread or unshaped read is not_assessed with the read printed', (name, _ok, _bad, empty) => {
    const v = run(name, empty);
    expect(v.status).toBe('not_assessed');
    expect(v.evidence).toMatch(/not assessed/);
    expect(v.evidence).toMatch(/was not read|was read \(|returned 0 objects|read of '/);
  });

  test.each(CASES.map(c => c[0]))('%s: no read at all is not_assessed, never not_met', (name) => {
    expect(run(name, []).status).toBe('not_assessed');
  });
});

describe('W5 cycle 1: TM expected values override the requirement defaults', () => {
  test('screen lock: 15 min passes the 15 min default and fails the answered 10 (AC.L2-3.1.10 / SC.L2-3.13.9)', () => {
    const r = [cfg({ id: 'deviceConfiguration-3', displayName: 'CMMC-ScreenLock-Policy', passwordMinutesOfInactivityBeforeScreenTimeout: 15, passwordRequired: true })];
    const ctx: EvaluatorContext = { expected: [{ path: '$.passwordMinutesOfInactivityBeforeScreenTimeout', op: 'lte', value: 10, source: 'answered' }] };
    for (const name of ['sessionLockEvaluator', 'sessionTerminationNetworkEvaluator']) {
      expect(run(name, r).status).toBe('met');
      const v = run(name, r, ctx);
      expect(v.status).toBe('not_met');
      expect(v.evidence).toContain('organisation value: TM expected value (answered)');
      expect(run(name, r).evidence).toContain('requirement default, no organisation value');
    }
  });

  test('lockout: threshold 5 passes the default 10 and fails the answered 3', () => {
    const ctx: EvaluatorContext = { expected: [
      { path: "$.values[?(@.name=='LockoutThreshold')].value", op: 'lte', value: 3, source: 'answered' },
      { path: "$.values[?(@.name=='LockoutDurationInSeconds')].value", op: 'gte', value: 900, source: 'answered' }] };
    expect(run('smartLockoutEvaluator', [pwRules(5, 120)]).status).toBe('met');
    expect(run('smartLockoutEvaluator', [pwRules(5, 120)], ctx).status).toBe('not_met');
    expect(run('smartLockoutEvaluator', [pwRules(3, 900)], ctx).status).toBe('met');
  });

  test('password length: 12 passes the default and fails the answered 14', () => {
    const r = [cfg({ id: 'c3', displayName: 'Password', passwordMinimumLength: 12 })];
    expect(run('passwordComplexityEvaluator', r).status).toBe('met');
    expect(run('passwordComplexityEvaluator', r, { expected: [{ path: '$.passwordMinimumLength', op: 'gte', value: 14, source: 'answered' }] }).status).toBe('not_met');
  });

  test('Wi-Fi SSID and named-location range must equal the answered values', () => {
    expect(run('wifiProfileEvaluator', [cfg(wifi('wpa2Enterprise', 'OTHER'))], { expected: [{ path: '$.ssid', op: 'equals', value: 'S1-MACH-CORP' }] }).status).toBe('not_met');
    expect(run('wifiProfileEvaluator', [cfg(wifi('wpa2Enterprise'))], { expected: [{ path: '$.ssid', op: 'equals', value: 'S1-MACH-CORP' }] }).status).toBe('met');
    const loc = [one('namedLocations', '/identity/conditionalAccess/namedLocations', [{ id: 'namedLocation-1', displayName: 'Office', isTrusted: true, ipRanges: [{ cidrAddress: '203.0.113.0/24' }] }]),
      one('signInLogs', '/auditLogs/signIns', [{ id: 's-1', ipAddress: '203.0.113.9' }])];
    expect(run('namedLocationEvaluator', loc, { expected: [{ path: '$.ipRanges[*].cidrAddress', op: 'contains', value: '198.51.100.0/24' }] }).status).toBe('not_met');
  });

  test('CA break-glass exclusion: a policy that does not exclude the TM break-glass account fails', () => {
    const ctx: EvaluatorContext = { expected: [{ path: '$.conditions.users.excludeUsers', op: 'contains', value: 'user-50', source: 'tcp' }] };
    expect(run('blockUntrustedEvaluator', [ca(locBlock)], ctx).status).toBe('met');
    const noExclusion = { ...locBlock, conditions: { ...locBlock.conditions, users: { includeUsers: ['All'], excludeUsers: [] } } };
    expect(run('blockUntrustedEvaluator', [ca(noExclusion)], ctx).status).toBe('not_met');
  });

  test('break-glass: more than two MFA exclusions are not all break-glass, so standing GA among them is not excused', () => {
    const wide = { ...mfaAll, conditions: { users: { includeUsers: ['All'], excludeUsers: ['user-50', 'user-51', 'user-7'] } } };
    const v = run('leastPrivilegeEvaluator', [roles({ principalId: 'user-7', roleDefinitionId: GA }), ca(wide), elig({ principalId: 'user-46', roleDefinitionId: GA })]);
    expect(v.status).toBe('not_met');
    expect(run('mfaMethodsEvaluator', [auth([{ id: 'Fido2', state: 'enabled' }]), ca(wide)]).status).toBe('not_met');
    expect(run('leastPrivilegeEvaluator', [roles({ principalId: 'user-7', roleDefinitionId: GA }), elig({ principalId: 'user-46', roleDefinitionId: GA })], { breakGlassIds: ['user-7'] }).status).toBe('met');
  });

  test('unshaped rows are not a negative: sign-ins without any source address, devices without identifiers', () => {
    const loc = one('namedLocations', '/identity/conditionalAccess/namedLocations', [{ id: 'namedLocation-1', displayName: 'Office', isTrusted: true, ipRanges: [{ cidrAddress: '198.51.100.0/24' }] }]);
    expect(run('namedLocationEvaluator', [loc, one('signInLogs', '/auditLogs/signIns', [{ id: 's-1' }, { id: 's-2' }])]).status).toBe('not_assessed');
    expect(run('userDeviceIdentifyEvaluator', [users(user('user-1')), one('devices', '/devices', [{ displayName: 'PC' }])]).status).toBe('not_assessed');
    expect(run('userDeviceIdentifyEvaluator', [users(user('user-1')), one('devices', '/devices', [{ id: 'device-1' }, { displayName: 'PC' }])]).status).toBe('not_met');
  });

  test('separate admin accounts from a supplied admin list, no naming convention', () => {
    expect(run('dedicatedAdminEvaluator', [users(user('user-48'))], { adminAccountIds: ['user-48'] }).status).toBe('met');
    expect(run('dedicatedAdminEvaluator', [users(user('user-48', { assignedLicenses: [{ skuId: 'g5' }] }))], { adminAccountIds: ['user-48'] }).status).toBe('not_met');
  });
});

describe('W5 cycle 1: routed through the real mapper (registry endpoints)', () => {
  const mapped = (signals: SignalResult[], id: string) => new SignalToControlMapper().mapSignalsToControls(signals, evaluatorRegistry).find(a => a.control_id === id)!;

  test('S1-shaped reads: the registry delivers the data and the source carries no presence-only label', () => {
    // W5 cycle 3: through the mapper an Intune object credits only when assigned, so the S1 objects carry one.
    const s1 = [ca(mfaAll, locBlock, adminStrength, mobile, session8h), cfg({ ...wifi('wpa2Enterprise'), assignments: [GROUP_ASSIGNMENT] }, { id: 'c7', displayName: 'Block USB', storageBlockRemovableStorage: true, assignments: [GROUP_ASSIGNMENT] })];
    for (const id of ['AC.L2-3.1.11', 'AC.L2-3.1.14', 'AC.L2-3.1.15', 'AC.L2-3.1.16', 'AC.L2-3.1.18', 'AC.L2-3.1.21', 'MA.L2-3.7.5', 'MP.L2-3.8.7']) {
      const a = mapped(s1, id);
      expect({ id, status: a.status }).toEqual({ id, status: 'met' });
      expect(a.sources[0].detail).not.toContain('presence only');
    }
  });

  test('S1-shaped authentication methods policy (no method configurations): not_assessed, no negative source', () => {
    for (const id of ['IA.L1-3.5.2', 'IA.L2-3.5.3', 'IA.L2-3.5.7', 'IA.L2-3.5.8', 'IA.L2-3.5.9', 'IA.L2-3.5.10', 'AC.L2-3.1.8']) {
      const a = mapped([auth()], id);
      expect({ id, result: a.sources[0].result }).toEqual({ id, result: 'no_query' });
    }
  });
});

describe('W5 cycle 1: the TM path subset', () => {
  const obj = { values: [{ name: 'LockoutThreshold', value: '3' }], ipRanges: [{ cidrAddress: 'a' }, { cidrAddress: 'b' }], conditions: { users: { excludeUsers: ['user-50'] } } };
  test('resolvePath', () => {
    expect(resolvePath(obj, "$.values[?(@.name=='LockoutThreshold')].value")).toEqual(['3']);
    expect(resolvePath(obj, '$.ipRanges[*].cidrAddress')).toEqual(['a', 'b']);
    expect(resolvePath(obj, '$.conditions.users.excludeUsers')).toEqual([['user-50']]);
    expect(resolvePath(obj, '$.missing.path')).toEqual([]);
  });
  test('applyCheck', () => {
    expect(applyCheck(obj, { path: "$.values[?(@.name=='LockoutThreshold')].value", op: 'lte', value: 3 })).toBe('pass');
    expect(applyCheck(obj, { path: '$.ipRanges[*].cidrAddress', op: 'contains', value: 'b' })).toBe('pass');
    expect(applyCheck(obj, { path: '$.conditions.users.excludeUsers', op: 'contains', value: 'user-51' })).toBe('fail');
    expect(applyCheck(obj, { path: '$.ipRanges[*].cidrAddress', op: 'count-gte', value: 2 })).toBe('pass');
    expect(applyCheck(obj, { path: '$.nope', op: 'equals', value: 1 })).toBe('absent');
    expect(applyCheck(obj, { path: '$.nope', op: 'exists' })).toBe('fail');
  });
});

describe('W5 cycle 1 addendum: founder decisions', () => {
  test('IA.L2-3.5.11 is inherited from the platform (CRM): never tested, always not_assessed with the read', () => {
    for (const r of [[ca(mfaAll)], [], [cfg({ id: 'c', displayName: 'x', anything: true })]]) {
      const v = run('sessionTerminationEvaluator', r);
      expect(v.status).toBe('not_assessed');
      expect(v.evidence).toContain('inherited from the platform (CRM)');
    }
    expect(PRESENCE_ONLY_EVALUATORS.has('sessionTerminationEvaluator')).toBe(false);
  });

  test('IA.L2-3.5.5 tests identifier reuse; the stale-account test is IA.L2-3.5.6 only', () => {
    const stale = [users(user('user-1', recent), user('user-2', old))];
    expect(run('accountDisableEvaluator', stale).status).toBe('not_met');
    expect(run('inactiveAccountsEvaluator', stale).status).toBe('not_assessed');
    expect(run('inactiveAccountsEvaluator', stale).evidence).toContain('no deleted-users read');
    // an organisation period: reassignment after it is allowed
    const del = deleted({ id: 'user-40', userPrincipalName: '51510000000040004000800000000040user-40@s1-mach.simtenant.onmicrosoft.us', deletedDateTime: '2026-01-01T00:00:00.000Z' });
    const reuser = users({ ...user('user-61', { createdDateTime: '2026-10-01T00:00:00.000Z' }), userPrincipalName: 'user-40@s1-mach.simtenant.onmicrosoft.us' });
    expect(run('inactiveAccountsEvaluator', [reuser, del]).status).toBe('not_met');
    expect(run('inactiveAccountsEvaluator', [reuser, del], { expected: [{ path: '$.identifierReusePeriodDays', op: 'gte', value: 180, source: 'answered' }] }).status).toBe('met');
  });

  test('every default bound prints its provenance', () => {
    const r = [cfg({ id: 'c4', displayName: 'AV', defenderSignatureUpdateIntervalInHours: 4 })];
    expect(run('avUpdateEvaluator', r).evidence).toContain('requirement default, no organisation value');
    expect(run('accountDisableEvaluator', [users(user('user-1', recent))]).evidence).toContain('requirement default, no organisation value');
  });
});

describe('W5 cycle 1 addendum: the mapper passes the TM to the evaluators', () => {
  const TM = { ces: { artifact: 'tenant-manifest' }, tenant_manifest: {
    tenant_identity: { tenant_id: 'sim-tenant-s1-mach' },
    assets: [
      { asset_type: 'break_glass_account', owner: 'bg.access01@s1-mach.simtenant.onmicrosoft.us' },
      { asset_type: 'admin_account', owner: 'adm.ops@s1-mach.simtenant.onmicrosoft.us' },
      { asset_type: 'admin_account', owner: 'nobody@s1-mach.simtenant.onmicrosoft.us' },
    ],
    normative_controls: [
      { control_id: 'SC.L2-3.13.9', verification: [{ expected_value: { path: '$.passwordMinutesOfInactivityBeforeScreenTimeout', op: 'lte', value: 10, source: 'answered' } }] },
      { control_id: 'AC.L2-3.1.14', verification: [{ expected_value: { path: '$.conditions.users.excludeUsers', op: 'contains', value: 'user-50', source: 'tcp' } }, { description: 'interview' }] },
      { control_id: 'SI.L2-3.14.4', verification: [{ expected_value: { path: '$.defenderSignatureUpdateIntervalInHours', op: 'lte', value: 2, source: 'answered' } }] },
    ],
  } };
  // W5 cycle 3: assigned (through the mapper an unassigned Intune object credits nothing).
  const lock = cfg({ id: 'deviceConfiguration-3', displayName: 'CMMC-ScreenLock-Policy', passwordMinutesOfInactivityBeforeScreenTimeout: 15, passwordRequired: true, defenderSignatureUpdateIntervalInHours: 4, assignments: [GROUP_ASSIGNMENT] });
  const dir = users(user('user-50', { userPrincipalName: 'bg.access01@s1-mach.simtenant.onmicrosoft.us' }), user('user-48', { userPrincipalName: 'adm.ops@s1-mach.simtenant.onmicrosoft.us' }));
  const map = (signals: SignalResult[], opts?: Parameters<SignalToControlMapper['mapSignalsToControls']>[2]) => new SignalToControlMapper().mapSignalsToControls(signals, evaluatorRegistry, opts);
  const status = (a: ReturnType<typeof map>, id: string) => a.find(x => x.control_id === id)!;

  test('SC.L2-3.13.9: 15 min is met on the default and not met on the answered 10 min', () => {
    expect(status(map([lock]), 'SC.L2-3.13.9').status).toBe('met');
    const a = status(map([lock], { tenantManifest: TM, tenantId: 'sim-tenant-s1-mach' }), 'SC.L2-3.13.9');
    expect(a.status).toBe('not_met');
    expect(a.implementation_narrative).toContain('organisation value: TM expected value (answered)');
  });

  test('the NIST-number fallback matches a TM control id written at another level (SI.L2-3.14.4 -> SI.L1-3.14.4)', () => {
    expect(status(map([lock], { tenantManifest: TM }), 'SI.L1-3.14.4').status).toBe('not_met');
  });

  test('CA checks: the break-glass exclusion expected by the TM is applied', () => {
    const noExcl = { ...locBlock, conditions: { ...locBlock.conditions, users: { includeUsers: ['All'], excludeUsers: [] } } };
    expect(status(map([ca(noExcl)]), 'AC.L2-3.1.14').status).toBe('met');
    expect(status(map([ca(noExcl)], { tenantManifest: TM }), 'AC.L2-3.1.14').status).toBe('not_met');
  });

  test('accounts: break-glass and admin owners resolve to object ids through the users read; unresolved owners are dropped', () => {
    const { evaluatorContextsFromTm } = require('../../../src/eo/mapping/evaluators/tmContext');
    const c = evaluatorContextsFromTm(TM, [dir], { tenantId: 'sim-tenant-s1-mach' });
    expect(c.forControl('AC.L2-3.1.6')).toEqual({ breakGlassIds: ['user-50'], adminAccountIds: ['user-48'] });
    expect(c.summary).toContain('admin accounts 1 of 2 resolved');
    expect(status(map([dir], { tenantManifest: TM }), 'AC.L2-3.1.6').status).toBe('met');
  });

  test('a TM for another tenant is not used', () => {
    const a = status(map([lock], { tenantManifest: TM, tenantId: 'sim-tenant-other' }), 'SC.L2-3.13.9');
    expect(a.status).toBe('met');
    expect(a.implementation_narrative).toContain('requirement default, no organisation value');
  });
});
