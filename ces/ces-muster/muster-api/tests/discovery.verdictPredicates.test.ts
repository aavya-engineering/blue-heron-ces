// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// MG-02: discovery verdict predicates. Every pruning entry (an entry whose read
// returns output on the simulator, plus the Conditional Access state reads) has
// a predicate with a positive and a negative case against sim-shaped output.
// The sim outputs below are the muster-partial tenant's captured get_command
// output (the MX run's captures), inlined; the variants flip one value.
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  evaluateVerdict,
  loadVerdictPredicates,
  parseFormatTable,
  runDiscovery,
  type DiscoverySession,
  type RegistryGetEntry,
} from '../src/services/discoveryService.js';

const PREDICATES = loadVerdictPredicates();

const table = (header: string[], rows: string[][]): string => {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join(' ');
  return ['', line(header), line(widths.map((w) => '-'.repeat(w))), ...rows.map(line), '', ''].join('\n');
};
const json = (v: unknown) => JSON.stringify(v, null, 4);

/** Sim-shaped CA policy (the muster-mfa-disabled / report-only / configured scenarios' PATCH body). */
const caPolicy = (state: string, name = 'Sim CA Policy 1') => ({
  id: 'caPolicy-1',
  displayName: name,
  state,
  grantControls: { operator: 'OR', builtInControls: ['mfa'] },
});

/**
 * W5c3: the run-48 S1 capture shape of IA.L2-3.5.8.password-policy-evidence
 * (GET /groupSettings | ConvertTo-Json -Depth 10: PowerShell's 4-space style,
 * `":  "` separators, CRLF), with the Password Rule Settings name/value list.
 */
const groupSettings = (values: Array<[string, string]>): string => {
  const pad = (n: number) => ' '.repeat(n);
  const items = values
    .map(([n, v]) => `${pad(37)}{\r\n${pad(41)}"name":  "${n}",\r\n${pad(41)}"value":  "${v}"\r\n${pad(37)}}`)
    .join(',\r\n');
  return [
    '{',
    `${pad(4)}"value":  [`,
    `${pad(18)}{`,
    `${pad(22)}"id":  "51510000-005e-4000-8000-000000000001",`,
    `${pad(22)}"displayName":  "Password Rule Settings",`,
    `${pad(22)}"templateId":  "5cf42378-d67d-4f36-ba46-e8b86229381d",`,
    `${pad(22)}"values":  [`,
    items,
    `${pad(33)}]`,
    `${pad(18)}}`,
    `${pad(14)}]`,
    '}',
    '',
  ].join('\r\n');
};
const S1_PASSWORD_RULES: Array<[string, string]> = [
  ['BannedPasswordCheckOnPremisesMode', 'Audit'],
  ['EnableBannedPasswordCheckOnPremises', 'False'],
  ['EnableBannedPasswordCheck', 'True'],
  ['LockoutDurationInSeconds', '300'],
  ['LockoutThreshold', '5'],
  ['BannedPasswordList', 'fennick\\tspindlework'],
];
const withRule = (name: string, value: string) => S1_PASSWORD_RULES.map(([n, v]): [string, string] => [n, n === name ? value : v]);
/** W5c3: the run-48 S1 alerts_v2 capture shape (Select-Object id,title,severity,status | ConvertTo-Json). */
const alerts = (statuses: string[]) =>
  json(statuses.map((status, i) => ({ id: `alert-s1-${i + 1}`, title: `Sim alert ${i + 1}`, severity: 'medium', status })));

/** W5c3: predicates with no not_met outcome by design (the contrary value is undecidable, not a failure). */
const MET_ONLY = new Set(['IA.L2-3.5.7.password-protection', 'IA.L2-3.5.11.branding']);

/** entry id -> [met output, not_met output] (MET_ONLY: [met output, undecidable output]). */
const CASES: Record<string, [string, string]> = {
  // W5c3: from_entry IA.L2-3.5.8.password-policy-evidence (evaluateVerdict applies expect to that read's output).
  'AC.L2-3.1.8.smart-lockout': [groupSettings(S1_PASSWORD_RULES), groupSettings(withRule('LockoutThreshold', '50'))],
  'IA.L2-3.5.7.password-protection': [groupSettings(S1_PASSWORD_RULES), groupSettings(withRule('EnableBannedPasswordCheck', 'False'))],
  'SI.L2-3.14.7.security-alerts-evidence': [
    alerts(['resolved', 'resolved', 'resolved', 'resolved', 'inProgress', 'new']),
    alerts(['new', 'new']),
  ],
  'AC.L1-3.1.1.ca-policy-evidence': [
    table(['displayName', 'state'], [['Sim CA Policy 1', 'enabled'], ['Sim CA Policy 2', 'enabled']]),
    table(['displayName', 'state'], [['Sim CA Policy 1', 'disabled']]),
  ],
  'AC.L1-3.1.20.cross-tenant-evidence': [
    table(['B2BCollaborationInbound', 'B2BCollaborationOutbound'], [['@{usersAndGroups=}', '@{usersAndGroups=}']]),
    table(['B2BCollaborationInbound', 'B2BCollaborationOutbound'], [['', '@{usersAndGroups=}']]),
  ],
  'AC.L2-3.1.19.ios-mam': [
    json({ value: [{ id: 'mam-1', displayName: 'CMMC-iOS-MAM' }] }),
    json({ value: [] }),
  ],
  'AC.L2-3.1.2.role-assign': [
    json([{ id: 'roleAssignment-1', principalId: 'user-1', roleDefinitionId: 'role-1' }]),
    json([{ id: 'roleAssignment-1', principalId: '', roleDefinitionId: 'role-1' }]),
  ],
  'AC.L2-3.1.20.guest-restrict': [json({ allowInvitesFrom: 'adminsAndGuestInviters' }), json({ allowInvitesFrom: 'everyone' })],
  'AC.L2-3.1.3.byod-dlp-policies': [
    json({ Name: 'CMMC-CUI-Block', Mode: 'Enable', Enabled: true }),
    json({ Name: 'CMMC-CUI-Block', Mode: 'Disable', Enabled: false }),
  ],
  'AC.L2-3.1.3.dlp-policy': [
    table(['Name', 'Mode', 'Enabled'], [['CMMC-CUI-Block', 'Enable', 'True']]),
    table(['Name', 'Mode', 'Enabled'], [['CMMC-CUI-Block', 'Disable', 'False']]),
  ],
  // W5c6: AC.L2-3.1.6.admin-account is judged by its lookup block (discovery.lookup.test.ts).
  'AC.L2-3.1.9.terms-of-use': [
    json({ id: 'touAgreement-1', displayName: 'CUI System Access Notice' }),
    json({ id: 'touAgreement-1', displayName: 'Other notice' }),
  ],
  'AU.L2-3.3.1.audit-enable': [json({ UnifiedAuditLogIngestionEnabled: true }), json({ UnifiedAuditLogIngestionEnabled: false })],
  'AU.L2-3.3.1.org-customization': ['false\n', 'true\n'],
  'AU.L2-3.3.2.signin-logs': [
    table(['UserDisplayName', 'userPrincipalName', 'status'], [['', 'sim.user1@simtenant.onmicrosoft.us', '@{errorCode=0}']]),
    table(['UserDisplayName', 'userPrincipalName', 'status'], [['Sim User 1', '', '@{errorCode=0}']]),
  ],
  'AZ-AUTO-003': [
    JSON.stringify({ hasLawScope: true, hasKvScope: true, hasStorageScope: true, hasSubScope: true }),
    JSON.stringify({ hasLawScope: false, hasKvScope: false, hasStorageScope: false, hasSubScope: false }),
  ],
  'AZ-BOUNDARY-001': [json([{ name: 'sim-nsg-1', Rules: { value: [] } }]), json([{ name: '', Rules: { value: [] } }])],
  'AZ-KV-003': [json({ Name: null, id: 'keyVaultKey-1' }), json({ Name: null, id: null })],
  'AZ-SUBNET-001': [table(['name', 'Subnets'], [['sim-vnet-1', '{}']]), table(['name', 'Subnets'], [['', '{}']])],
  'CA.L2-3.12.1.compliance-assess': [
    table(['currentScore', 'maxScore'], [['62', '100']]),
    table(['currentScore', 'maxScore'], [['', '100']]),
  ],
  // CM.L2-3.4.8.detected-apps: expect null since DEPTH-1a (the read is an app inventory); covered by the null-predicate test.
  'IA.L1-3.5.1.identity-evidence': [table(['id', 'displayName'], [['user-1', 'Sim User 1']]), table(['id', 'displayName'], [['', 'Sim User 1']])],
  'IA.L2-3.5.1.user-identify': [
    table(['displayName', 'userPrincipalName'], [['Sim User 1', 'sim.user1@simtenant.onmicrosoft.us']]),
    table(['displayName', 'userPrincipalName'], [['Sim User 1', '']]),
  ],
  'IA.L2-3.5.10.cert-auth': [json({ id: 'x509Certificate', state: 'enabled' }), json({ id: 'x509Certificate', state: 'disabled' })],
  'IA.L2-3.5.3.fido2-enable': [json({ id: 'Fido2', state: 'enabled' }), json({ id: 'Fido2', state: 'disabled' })],
  'IA.L2-3.5.3.mfa-authenticator': [
    json({ id: 'MicrosoftAuthenticator', state: 'enabled' }),
    json({ id: 'MicrosoftAuthenticator', state: 'disabled' }),
  ],
  'IA.L2-3.5.5.disable-inactive': [
    json({ enabledCount: 5, staleNonExcludedEnabledCount: 0, exclusionsEnabled: true }),
    json({ enabledCount: 5, staleNonExcludedEnabledCount: 2, exclusionsEnabled: false }),
  ],
  'IA.L2-3.5.9.tap-config': [
    json({ id: 'TemporaryAccessPass', state: 'enabled', isUsableOnce: true }),
    json({ id: 'TemporaryAccessPass', state: 'enabled', isUsableOnce: false }),
  ],
  'IR.L2-3.6.1.malware-filter': [json({ EnableFileFilter: true }), json({ EnableFileFilter: false })],
  'IR.L2-3.6.3.attack-sim': [
    table(['title', 'severity', 'status'], [['Sim Security Alert 1', 'medium', 'newAlert']]),
    table(['title', 'severity', 'status'], [['', 'medium', 'newAlert']]),
  ],
  'MP.L2-3.8.9.dlp-policy': [
    json({ Name: 'CMMC-CUI-Block', Enabled: true, DistributionStatus: 'Success' }),
    json({ Name: 'CMMC-CUI-Block', Enabled: true, DistributionStatus: 'Pending' }),
  ],
  'RA.L2-3.11.1.secure-score': [table(['currentScore', 'maxScore'], [['62', '100']]), table(['currentScore', 'maxScore'], [['', '100']])],
  'RA.L2-3.11.2.vuln-scan': [
    table(['activeUserCount', 'currentScore', 'maxScore'], [['5', '62', '100']]),
    table(['activeUserCount', 'currentScore', 'maxScore'], [['5', '', '100']]),
  ],
  'SC.L1-3.13.1.conditional-access-boundary': [
    table(['displayName', 'id'], [['Sim CA Policy 1', 'caPolicy-1']]),
    table(['displayName', 'id'], [['', 'caPolicy-1']]),
  ],
  'SC.L1-3.13.1.nsg-boundary-rules': [
    json([{ NSGName: 'sim-nsg-1', SecurityRules: [{ Name: 'DenyAllInbound', Access: 'Deny' }] }]),
    json([{ NSGName: 'sim-nsg-1', SecurityRules: [] }]),
  ],
  'SC.L2-3.13.14.teams-external': [
    json({ EnableFederationAccess: false, EnableTeamsConsumerAccess: false }),
    json({ EnableFederationAccess: true, EnableTeamsConsumerAccess: true }),
  ],
  'SC.L2-3.13.16.data-at-rest': [
    table(['deviceName', 'isEncrypted', 'complianceState'], [['Sim Managed Device 1', 'True', 'compliant'], ['Sim Managed Device 2', 'True', 'compliant']]),
    table(['deviceName', 'isEncrypted', 'complianceState'], [['Sim Managed Device 1', 'True', 'compliant'], ['Sim Managed Device 2', 'False', 'noncompliant']]),
  ],
  'SC.L2-3.13.2.session-lock': [json({ value: [{ id: 'cfg-1', displayName: 'CMMC-Screen-Lock-Policy' }] }), json({ value: [] })],
  'SI.L1-3.14.1.flaw-remediation-evidence': [
    json({ secureScoreAvailable: true, currentScore: 62 }),
    json({ secureScoreAvailable: false, currentScore: null }),
  ],
  'SI.L1-3.14.4.av-signatures': [
    json({ displayName: 'CMMC-Defender-AntivirusPolicy', id: 'a9c3' }),
    json([{ displayName: 'Sim Device Configuration 1', id: 'deviceConfiguration-1' }]),
  ],
  'SI.L2-3.14.1.flaw-id': [json({ currentScore: 62, maxScore: 100 }), json({ currentScore: null, maxScore: 100 })],
  'SI.L2-3.14.6.email-protection-evidence': [
    json({ Name: 'Office365 AntiPhish Default', Enabled: true }),
    json({ Name: 'Office365 AntiPhish Default', Enabled: false }),
  ],
  'SI.L2-3.14.6.security-alerts': [
    json({ secureScoreAvailable: true, recentAlertCount: 2, alerts: [] }),
    json({ secureScoreAvailable: false, recentAlertCount: 0, alerts: [] }),
  ],
  // W5c4: AC.L2-3.1.11 session-timeout, AC.L2-3.1.14 block-untrusted, AC.L2-3.1.15 admin-mfa and
  // MA.L2-3.7.5 remote-mfa are judged by their registry lookup block (lookup_effect); their cases
  // are in discovery.lookup.test.ts.
  'AC.L2-3.1.18.mobile-ca': [json(caPolicy('enabled', 'CMMC-MobileDeviceAccess')), json(caPolicy('disabled', 'CMMC-MobileDeviceAccess'))],
  'AC.L2-3.1.18.byod-nonbrowser-block': [
    json({ displayName: 'CMMC-BYOD', state: 'enabled', grantControls: { builtInControls: ['compliantDevice'] } }),
    json({ displayName: 'CMMC-BYOD', state: 'enabled', grantControls: { builtInControls: ['mfa'] } }),
  ],
  'SC.L2-3.13.4.remote-access': [
    json([{ DisplayName: 'Remote-Access-MFA', State: 'enabled' }]),
    json([{ DisplayName: 'Remote-Access-MFA', State: 'disabled' }]),
  ],
  // W5: S1's captured shapes (run 43 captures), one value flipped for the negative.
  // W5c5: run-51 S1 shapes (fictional), one value flipped for the negative.
  // from_entry AC.L2-3.1.16.wifi-profile: the device-configuration list.
  'AC.L2-3.1.17.wireless-profile-evidence': [
    json([
      { '@odata.type': '#microsoft.graph.windowsWifiConfiguration', displayName: 'S1-MACH-CORP Wi-Fi', wifiSecurityType: 'wpa2Enterprise' },
      { '@odata.type': '#microsoft.graph.windows10GeneralConfiguration', displayName: 'S1-Defender-AV' },
    ]),
    json([{ '@odata.type': '#microsoft.graph.windowsWifiConfiguration', displayName: 'Guest Wi-Fi', wifiSecurityType: 'open' }]),
  ],
  // from_entry SI.L1-3.14.5.scan-schedule-evidence: the device-configuration list.
  'MA.L2-3.7.4.media-check': [
    json([
      { displayName: 'S1-MACH-CORP Wi-Fi', wifiSecurityType: 'wpa2Enterprise' },
      { displayName: 'S1-Defender-AV', defenderScanType: 'full', defenderScanRemovableDrivesDuringFullScan: true },
    ]),
    json([{ displayName: 'S1-Defender-AV', defenderScanType: 'full', defenderScanRemovableDrivesDuringFullScan: false }]),
  ],
  // The run-51 capture shape (Select-Object Domain,Enabled,Status | ConvertTo-Json).
  'SC.L2-3.13.15.dkim': [
    json({ Domain: 's1-mach.simtenant.onmicrosoft.us', Enabled: true, Status: 'Valid' }),
    json([
      { Domain: 's1-mach.simtenant.onmicrosoft.us', Enabled: true, Status: 'Valid' },
      { Domain: 'mail.example.invalid', Enabled: false, Status: 'CnameMissing' },
    ]),
  ],
  // The run-51 capture shape (Select-Object Title,Severity,Status,CreatedTimeUtc: Format-Table).
  'IR.L2-3.6.2.incident-track': [
    table(['Title', 'Severity', 'Status', 'CreatedTimeUtc'], [
      ['Initial access involving one user', 'Medium', 'Closed', '2026-10-15T22:00:00.000Z'],
      ['Suspicious execution on one device', 'High', 'Active', '2026-10-25T00:00:00.000Z'],
    ]),
    table(['Title', 'Severity', 'Status', 'CreatedTimeUtc'], [['Suspicious execution on one device', 'High', 'New', '2026-10-25T00:00:00.000Z']]),
  ],
  'AZ-ID-005': [
    table(['principalId', 'roleDefinitionId', 'status'], [['user-46', '62e90394-69f5-4237-9190-012177145e10', 'Provisioned']]),
    table(['principalId', 'roleDefinitionId', 'status'], [['user-46', '62e90394-69f5-4237-9190-012177145e10', 'Revoked']]),
  ],
  // from_entry AZ-ID-005: evaluateVerdict applies the expect to the referenced read's output.
  'AC.L2-3.1.4.pim-policy-get': [
    table(['principalId', 'roleDefinitionId', 'status'], [['user-48', '194ae4cb-b126-40b2-bd5b-6091b380977d', 'Provisioned']]),
    table(['principalId', 'roleDefinitionId', 'status'], [['user-48', '194ae4cb-b126-40b2-bd5b-6091b380977d', 'Revoked']]),
  ],
  'MP.L2-3.8.1.cui-label': [
    json({ id: 'label-cui', Name: 'CUI', DisplayName: 'CUI', EncryptionEnabled: true }),
    json({ id: 'label-cui', Name: 'CUI', DisplayName: 'CUI', EncryptionEnabled: false }),
  ],
  'SC.L2-3.13.16.byod-sensitivity-labels': [
    json({ Name: 'CUI', DisplayName: 'CUI', Priority: 1, EncryptionEnabled: true }),
    json({ Name: 'General', DisplayName: 'General', Priority: 0, EncryptionEnabled: false }),
  ],
  // W7-MX1: the S1/S2 operator's Global Administrator eligibility (W7-SIM roleEligibilitySchedule-7).
  'AC.L2-3.1.5.pim-eligible': [
    json({ PrincipalId: 'user-12', RoleDefinitionId: '62e90394-69f5-4237-9190-012177145e10', Status: 'Provisioned', DirectoryScopeId: '/' }),
    json([{ PrincipalId: 'user-12', RoleDefinitionId: '62e90394-69f5-4237-9190-012177145e10', Status: 'Revoked', DirectoryScopeId: '/' }]),
  ],
  // W7-MX1: the S1 Office 365 Sentinel connector (az rest JSON); the negative disables Teams.
  'AU.L2-3.3.3.sentinel-connector': [
    json({ id: 'office365', name: 'office365', kind: 'Office365', properties: { dataTypes: { exchange: { state: 'enabled' }, sharePoint: { state: 'enabled' }, teams: { state: 'enabled' } } } }),
    json({ id: 'office365', name: 'office365', kind: 'Office365', properties: { dataTypes: { exchange: { state: 'enabled' }, sharePoint: { state: 'enabled' }, teams: { state: 'disabled' } } } }),
  ],
  // W7-MX1: the S1 monthly audit review search; the negative is one still running.
  'AU.L2-3.3.6.audit-reduction': [
    json({ Name: 'S1 Monthly audit review - admin and CUI site activity', Status: 'Completed', Items: 412, CreatedTime: '2026-09-19T00:00:00Z' }),
    json({ Name: 'S1 Monthly audit review - admin and CUI site activity', Status: 'InProgress', Items: 0, CreatedTime: '2026-09-19T00:00:00Z' }),
  ],
  // W7-MX1 (MET_ONLY): Get-MgOrganizationBranding in list format, the S1 banner included; the negative has no id.
  'IA.L2-3.5.11.branding': [
    [
      '',
      'Id                     : 0',
      'BackgroundColor        : #1F2A36',
      'SignInPageText         : Authorized use only. Unauthorized use may result in disciplinary action.',
      'UsernameHintText       : user@s1-mach.simtenant.onmicrosoft.us',
      '',
    ].join('\r\n'),
    'BackgroundColor        : #1F2A36\r\n',
  ],
};

/** The 49 entries whose get_command returned output on the muster-partial sim tenant (the pruning set before MG-02). */
const SIM_OUTPUT_ENTRIES = [
  'AC.L1-3.1.1.ca-policy-evidence', 'AC.L1-3.1.20.cross-tenant-evidence', 'AC.L2-3.1.18.byod-nonbrowser-signins',
  'AC.L2-3.1.19.ios-mam', 'AC.L2-3.1.2.role-assign', 'AC.L2-3.1.20.guest-restrict', 'AC.L2-3.1.3.byod-dlp-policies',
  'AC.L2-3.1.3.dlp-policy', 'AC.L2-3.1.4.pim-policy-get', 'AC.L2-3.1.6.admin-account', 'AC.L2-3.1.8.smart-lockout',
  'AC.L2-3.1.9.terms-of-use', 'AU.L2-3.3.1.audit-enable', 'AU.L2-3.3.1.org-customization', 'AU.L2-3.3.2.signin-logs',
  'AZ-AUTO-003', 'AZ-BOUNDARY-001', 'AZ-KV-003', 'AZ-LOG-004', 'AZ-SUBNET-001', 'CA.L2-3.12.1.compliance-assess',
  'CM.L2-3.4.8.detected-apps', 'IA.L1-3.5.1.identity-evidence', 'IA.L1-3.5.2.auth-methods-evidence',
  'IA.L2-3.5.1.user-identify', 'IA.L2-3.5.10.cert-auth', 'IA.L2-3.5.3.fido2-enable', 'IA.L2-3.5.3.mfa-authenticator',
  'IA.L2-3.5.5.disable-inactive', 'IA.L2-3.5.7.password-protection', 'IA.L2-3.5.8.password-reuse',
  'IA.L2-3.5.9.tap-config', 'IR.L2-3.6.1.malware-filter', 'IR.L2-3.6.3.attack-sim', 'MP.L2-3.8.9.dlp-policy',
  'RA.L2-3.11.1.secure-score', 'RA.L2-3.11.2.vuln-scan', 'SC.L1-3.13.1.conditional-access-boundary',
  'SC.L1-3.13.1.nsg-boundary-rules', 'SC.L2-3.13.14.teams-external', 'SC.L2-3.13.16.data-at-rest',
  'SC.L2-3.13.2.session-lock', 'SI.L1-3.14.1.flaw-remediation-evidence', 'SI.L1-3.14.4.av-signatures',
  'SI.L2-3.14.1.flaw-id', 'SI.L2-3.14.6.email-protection-evidence', 'SI.L2-3.14.6.security-alerts',
  'SI.L2-3.14.6.spam-protection', 'SI.L2-3.14.7.security-alerts-evidence',
];

describe('MG-02 verdict predicates — data', () => {
  it('every predicate names a real Stamper registry entry', () => {
    const root = path.resolve('..', '..', 'ces-stamper', 'src', 'registry');
    const ids = new Set<string>();
    for (const f of ['cmmc-l2-commands.registry.json', 'infra-cmmc-l2-commands.registry.json']) {
      const p = path.join(root, f);
      if (!fs.existsSync(p)) return; // sibling repo absent: nothing to cross-check
      for (const e of JSON.parse(fs.readFileSync(p, 'utf8')).entries) ids.add(e.entry_id);
    }
    expect(Object.keys(PREDICATES).filter((id) => !ids.has(id))).toEqual([]);
  });

  it('every entry that returns output on the sim has a predicate row (null = explicitly no verdict)', () => {
    expect(SIM_OUTPUT_ENTRIES.filter((id) => !(id in PREDICATES))).toEqual([]);
  });

  it('every non-null predicate has a positive and a negative sim-shaped case, and every row a basis', () => {
    for (const [id, p] of Object.entries(PREDICATES)) {
      expect(p.basis.length, id).toBeGreaterThan(10);
      if (p.live_validation) expect(p.live_reason, id).toBeTruthy();
      // W5c4: lookup_effect rows are judged by runDiscovery over the registry block (discovery.lookup.test.ts).
      if (p.expect && !('lookup_effect' in p.expect)) expect(CASES[id], `missing cases for ${id}`).toBeDefined();
    }
  });
});

describe('MG-02 verdict predicates — positive and negative per entry', () => {
  for (const [id, [pos, neg]] of Object.entries(CASES)) {
    it(`${id}: expected value -> met, contrary value -> ${MET_ONLY.has(id) ? 'unknown' : 'not_met'}`, () => {
      expect(evaluateVerdict(PREDICATES[id], pos)).toBe('met');
      expect(evaluateVerdict(PREDICATES[id], neg)).toBe(MET_ONLY.has(id) ? 'unknown' : 'not_met');
    });
  }

  it('W5c4: a lookup_effect row judged outside runDiscovery (no block) is unknown, never met', () => {
    for (const [id, p] of Object.entries(PREDICATES)) {
      if (p.expect && 'lookup_effect' in p.expect) expect(evaluateVerdict(p, json([{ displayName: 'anything', state: 'enabled' }])), id).toBe('unknown');
    }
  });

  it('explicit null predicates and absent predicates are unknown, never met', () => {
    for (const [id, p] of Object.entries(PREDICATES)) {
      if (!p.expect) expect(evaluateVerdict(p, '{"id":"anything"}'), id).toBe('unknown');
    }
    expect(evaluateVerdict(undefined, '[{"id":"x"}]')).toBe('unknown');
  });

  it('undecidable output (JSON expected, text returned; field absent) is unknown', () => {
    expect(evaluateVerdict(PREDICATES['IA.L2-3.5.3.mfa-authenticator'], 'not json at all')).toBe('unknown');
    // W5: an enabled TAP without the isUsableOnce field stays undecidable.
    expect(evaluateVerdict(PREDICATES['IA.L2-3.5.9.tap-config'], json({ id: 'TemporaryAccessPass', state: 'enabled' }))).toBe('unknown');
  });

  it('W5c5: a Format-Table header wrapped onto two lines (run-51 S1 sign-in logs) is joined per column', () => {
    const wrapped = [
      '',
      'userDisplayName  userPrincipalName                         appDisplayName   stat',
      '                                                                            us  ',
      '---------------  -----------------                         --------------   ----',
      'Sim User One     sim.user1@s1-mach.simtenant.onmicrosoft.us Microsoft Teams  @...',
      '',
    ].join('\r\n');
    const rows = parseFormatTable(wrapped)!;
    expect(Object.keys(rows[0])).toEqual(['userDisplayName', 'userPrincipalName', 'appDisplayName', 'status']);
    expect(evaluateVerdict(PREDICATES['AU.L2-3.3.2.signin-logs'], wrapped)).toBe('met');
  });

  it('parses PowerShell Format-Table output by the dash line', () => {
    const rows = parseFormatTable(table(['displayName', 'state'], [['Sim CA Policy 1', 'enabled']]));
    expect(rows).toEqual([{ displayName: 'Sim CA Policy 1', state: 'enabled' }]);
    expect(parseFormatTable('{"a":1}')).toBeNull();
  });
});

describe('MG-02 — non-compliant sim tenant shapes yield not_met', () => {
  // W5c4: block-untrusted and admin-mfa moved to their lookup blocks (discovery.lookup.test.ts covers the same shapes).
  const CA_STATE_ENTRIES = ['AC.L2-3.1.18.mobile-ca'];

  it('muster-mfa-disabled: an MFA-granting CA policy in state disabled is not_met', () => {
    for (const id of CA_STATE_ENTRIES) expect(evaluateVerdict(PREDICATES[id], json(caPolicy('disabled'))), id).toBe('not_met');
  });

  it('muster-mfa-report-only: report-only (enabledForReportingButNotEnforced) is not_met', () => {
    for (const id of CA_STATE_ENTRIES) {
      expect(evaluateVerdict(PREDICATES[id], json(caPolicy('enabledForReportingButNotEnforced'))), id).toBe('not_met');
    }
  });

  it('muster-partial (captured): the authentication methods are disabled -> not_met, not met', () => {
    expect(evaluateVerdict(PREDICATES['IA.L2-3.5.3.mfa-authenticator'], json({ id: 'MicrosoftAuthenticator', state: 'disabled' }))).toBe('not_met');
    expect(evaluateVerdict(PREDICATES['IA.L2-3.5.3.fido2-enable'], json({ id: 'Fido2', state: 'disabled' }))).toBe('not_met');
  });

  it('runDiscovery: a disabled-state read is observed not_met (confidence high); a read with no predicate is unknown (the read itself stays confidence high)', async () => {
    const entries: RegistryGetEntry[] = [
      { entry_id: 'IA.L2-3.5.3.mfa-authenticator', control_ids: ['IA.L2-3.5.3'], engine: 'mgraph', get_command: 'Get-A' },
      { entry_id: 'AC.L2-3.1.8.smart-lockout', control_ids: ['AC.L2-3.1.8'], engine: 'mgraph', get_command: 'Get-B' },
    ];
    const session: DiscoverySession = {
      execute: vi.fn(async (_e: string, cmd: string) => ({
        stdout: cmd === 'Get-A' ? json({ id: 'MicrosoftAuthenticator', state: 'disabled' }) : json({ id: 'authenticationMethodsPolicy' }),
        stderr: '',
        exitCode: 0,
        durationMs: 1,
      })),
    };
    const { observations } = await runDiscovery(entries, session, { write: (id) => `captures/${id}.txt` });
    const mfa = observations.find((o) => o.control_id === 'IA.L2-3.5.3')!;
    expect(mfa).toMatchObject({ derived_posture: 'not_met', confidence: 'high', raw_capture_ref: 'captures/IA.L2-3.5.3.mfa-authenticator.txt' });
    const lockout = observations.find((o) => o.control_id === 'AC.L2-3.1.8')!;
    expect(lockout).toMatchObject({ derived_posture: 'unknown', confidence: 'high' });
  });
});

describe('W5 predicates: on_empty, from_entry, the TAP state and the honest nulls', () => {
  const ok = (stdout: string) => ({ stdout, stderr: '', exitCode: 0, durationMs: 1 });
  const sessionOf = (out: Record<string, string | Error>): DiscoverySession => ({
    execute: vi.fn(async (_e: string, cmd: string) => {
      const o = out[cmd];
      if (o instanceof Error) return { stdout: '', stderr: 'Get-X : is not recognized as the name of a cmdlet', exitCode: 1, durationMs: 1 };
      return ok(o ?? '');
    }),
  });
  const sink = { write: (id: string) => `captures/${id}.txt` };

  it('the captured S1 TAP output (state disabled) is a decisive not_met', () => {
    expect(evaluateVerdict(PREDICATES['IA.L2-3.5.9.tap-config'], json({ id: 'TemporaryAccessPass', state: 'disabled' }))).toBe('not_met');
  });

  it('empty DLP: an empty enabled-DLP-policy list is a decisive not_met; a predicate without on_empty stays unknown', async () => {
    expect(PREDICATES['AC.L2-3.1.3.byod-dlp-policies'].on_empty).toBe('not_met');
    const entries: RegistryGetEntry[] = [
      { entry_id: 'AC.L2-3.1.3.byod-dlp-policies', control_ids: ['AC.L1-3.1.22', 'MP.L2-3.8.8', 'MP.L2-3.8.9'], engine: 'ipps', get_command: 'Get-Dlp' },
      { entry_id: 'AC.L2-3.1.3.dlp-policy', control_ids: ['AC.L2-3.1.3'], engine: 'ipps', get_command: 'Get-DlpNamed' },
    ];
    const { observations } = await runDiscovery(entries, sessionOf({ 'Get-Dlp': '', 'Get-DlpNamed': '' }), sink);
    for (const c of ['AC.L1-3.1.22', 'MP.L2-3.8.8', 'MP.L2-3.8.9']) {
      expect(observations.find((o) => o.control_id === c), c).toMatchObject({ derived_posture: 'not_met', confidence: 'low' });
    }
    // The name-filtered read (*CUI* / *CMMC*) empty pre-Stamper is not evidence of absence.
    expect(observations.find((o) => o.control_id === 'AC.L2-3.1.3')).toMatchObject({ derived_posture: 'unknown', confidence: 'low' });
    // A non-empty list is still judged by expect.
    const listed = await runDiscovery(entries.slice(0, 1), sessionOf({ 'Get-Dlp': json([{ Name: 'S1-DLP', Enabled: true }]) }), sink);
    expect(listed.observations.every((o) => o.derived_posture === 'met')).toBe(true);
  });

  it('PIM policy present: pim-policy-get is judged on the eligibility read (met / empty -> not_met / failed -> unknown)', async () => {
    const entries: RegistryGetEntry[] = [
      { entry_id: 'AC.L2-3.1.4.pim-policy-get', control_ids: ['AC.L2-3.1.4'], engine: 'mgraph', get_command: 'Get-Policy' },
      { entry_id: 'AZ-ID-005', control_ids: ['AC.L2-3.1.5', 'AC.L2-3.1.7'], engine: 'mgraph', get_command: 'Get-Elig' },
    ];
    const policy = json({ id: 'roleManagementPolicy-1', displayName: 'Sim Role Management Policy 1' });
    const elig = table(['principalId', 'roleDefinitionId', 'status'], [['user-46', '62e90394-69f5-4237-9190-012177145e10', 'Provisioned']]);
    const met = await runDiscovery(entries, sessionOf({ 'Get-Policy': policy, 'Get-Elig': elig }), sink);
    expect(met.observations.find((o) => o.control_id === 'AC.L2-3.1.4')).toMatchObject({ derived_posture: 'met', confidence: 'high' });
    expect(met.observations.filter((o) => o.ran_entry_ids[0] === 'AZ-ID-005').map((o) => o.derived_posture)).toEqual(['met', 'met']);
    const none = await runDiscovery(entries, sessionOf({ 'Get-Policy': policy, 'Get-Elig': '' }), sink);
    expect(none.observations.find((o) => o.control_id === 'AC.L2-3.1.4')).toMatchObject({ derived_posture: 'not_met', confidence: 'high' });
    const failed = await runDiscovery(entries, sessionOf({ 'Get-Policy': policy, 'Get-Elig': new Error('x') }), sink);
    expect(failed.observations.find((o) => o.control_id === 'AC.L2-3.1.4')).toMatchObject({ derived_posture: 'unknown' });
    // The referenced entry absent from the walk: unknown. The entry's own failed read: unknown.
    const alone = await runDiscovery(entries.slice(0, 1), sessionOf({ 'Get-Policy': policy }), sink);
    expect(alone.observations[0].derived_posture).toBe('unknown');
    const ownFailed = await runDiscovery(entries, sessionOf({ 'Get-Policy': new Error('x'), 'Get-Elig': elig }), sink);
    expect(ownFailed.observations.find((o) => o.control_id === 'AC.L2-3.1.4')).toMatchObject({ derived_posture: 'unknown', confidence: 'unknown' });
  });

  it('an evaluator without from_entry judges the pim-policy-get expect over its own JSON output: undecidable, never met', () => {
    expect(evaluateVerdict(PREDICATES['AC.L2-3.1.4.pim-policy-get'], json({ id: 'roleManagementPolicy-1' }))).toBe('unknown');
  });

  it('the W5 honest nulls stay unknown on their captured S1 output', () => {
    const outputs: Record<string, string> = {
      'PS.L2-3.9.2.termination': table(['displayName', 'userPrincipalName'], [['Leaver One', 'leaver.one@s1-mach.simtenant.onmicrosoft.us']]),
      'PS.L2-3.9.2.account-disable-evidence': json({ activityDisplayName: 'Disable account', activityDateTime: '2026-09-18T01:00:00.000Z' }),
      'CA.L2-3.12.2.poam': 'id : AdminMFAV2\nimplementationStatus : implemented\n',
      'AU.L2-3.3.5.audit-search': table(['CreationDate', 'Operations', 'Status'], [['2026-10-24T04:33:00.000Z', 'Set-Mailbox', '']]),
      'AU.L2-3.3.6.audit-report-evidence': json({ CreationDate: '2026-10-24T04:33:00.000Z', Operations: 'Set-Mailbox' }),
      'AU.L2-3.3.7.time-source': table(['displayName', 'createdDateTime'], [['Sim Org (FICTIONAL)', '']]),
      'SC.L2-3.13.11.fips': table(['displayName', 'tenantType'], [['Sim Org (FICTIONAL)', 'AAD']]),
    };
    for (const [id, out] of Object.entries(outputs)) {
      expect(PREDICATES[id], id).toBeDefined();
      expect(PREDICATES[id].expect, id).toBeNull();
      expect(evaluateVerdict(PREDICATES[id], out), id).toBe('unknown');
    }
  });
});

describe('W5c3 predicates: the run-48 S1 reads that returned data', () => {
  const ok = (stdout: string) => ({ stdout, stderr: '', exitCode: 0, durationMs: 1 });
  const sessionOf = (out: Record<string, string | Error>): DiscoverySession => ({
    execute: vi.fn(async (_e: string, cmd: string) => {
      const o = out[cmd];
      if (o instanceof Error) return { stdout: '', stderr: 'Get-X : is not recognized as the name of a cmdlet', exitCode: 1, durationMs: 1 };
      return ok(o ?? '');
    }),
  });
  const sink = { write: (id: string) => `captures/${id}.txt` };
  // The authentication methods policy the 3.1.8 / 3.5.7 entries read themselves (run-48 shape, trimmed).
  const authMethods = json({ id: 'authenticationMethodsPolicy', policyMigrationState: 'migrationComplete', reconfirmationInDays: 180 });
  const entries: RegistryGetEntry[] = [
    { entry_id: 'AC.L2-3.1.8.smart-lockout', control_ids: ['AC.L2-3.1.8'], engine: 'mgraph', get_command: 'Get-AuthMethods' },
    { entry_id: 'IA.L2-3.5.7.password-protection', control_ids: ['IA.L2-3.5.7'], engine: 'mgraph', get_command: 'Get-AuthMethods' },
    { entry_id: 'IA.L2-3.5.8.password-policy-evidence', control_ids: ['IA.L2-3.5.8'], engine: 'mgraph', get_command: 'Get-GroupSettings' },
  ];
  const postureOf = (obs: Array<{ control_id: string; derived_posture: string }>, c: string) =>
    obs.find((o) => o.control_id === c)?.derived_posture;

  it('S1 (LockoutThreshold 5, banned-password check True): 3.1.8 and 3.5.7 met over the groupSettings read; 3.5.8 stays unknown', async () => {
    const { observations } = await runDiscovery(entries, sessionOf({ 'Get-AuthMethods': authMethods, 'Get-GroupSettings': groupSettings(S1_PASSWORD_RULES) }), sink);
    expect(postureOf(observations, 'AC.L2-3.1.8')).toBe('met');
    expect(postureOf(observations, 'IA.L2-3.5.7')).toBe('met');
    expect(postureOf(observations, 'IA.L2-3.5.8')).toBe('unknown');
  });

  it('muster-partial default rules (threshold 10, check True) are met; a threshold of 50 is not_met; the check False is unknown', async () => {
    const mp = await runDiscovery(entries, sessionOf({ 'Get-AuthMethods': authMethods, 'Get-GroupSettings': groupSettings(withRule('LockoutThreshold', '10')) }), sink);
    expect(postureOf(mp.observations, 'AC.L2-3.1.8')).toBe('met');
    const weak = await runDiscovery(entries, sessionOf({ 'Get-AuthMethods': authMethods, 'Get-GroupSettings': groupSettings(withRule('LockoutThreshold', '50')) }), sink);
    expect(postureOf(weak.observations, 'AC.L2-3.1.8')).toBe('not_met');
    const off = await runDiscovery(entries, sessionOf({ 'Get-AuthMethods': authMethods, 'Get-GroupSettings': groupSettings(withRule('EnableBannedPasswordCheck', 'False')) }), sink);
    expect(postureOf(off.observations, 'IA.L2-3.5.7')).toBe('unknown');
  });

  it('the settings absent, the groupSettings read empty, failed or not in the walk: unknown, never met', async () => {
    const noRules = groupSettings([['BannedPasswordList', 'x']]);
    for (const out of [noRules, '', new Error('x')]) {
      const { observations } = await runDiscovery(entries, sessionOf({ 'Get-AuthMethods': authMethods, 'Get-GroupSettings': out }), sink);
      expect(postureOf(observations, 'AC.L2-3.1.8')).toBe('unknown');
      expect(postureOf(observations, 'IA.L2-3.5.7')).toBe('unknown');
    }
    const alone = await runDiscovery(entries.slice(0, 2), sessionOf({ 'Get-AuthMethods': authMethods }), sink);
    expect(alone.observations.every((o) => o.derived_posture === 'unknown')).toBe(true);
    // Over the entries' own output (an evaluator without from_entry): the setting is not there, undecidable.
    expect(evaluateVerdict(PREDICATES['AC.L2-3.1.8.smart-lockout'], authMethods)).toBe('unknown');
    expect(evaluateVerdict(PREDICATES['IA.L2-3.5.7.password-protection'], authMethods)).toBe('unknown');
  });

  it('the on-premises banned-password setting is not mistaken for the cloud one', () => {
    const onPremOnly = groupSettings([['EnableBannedPasswordCheckOnPremises', 'True']]);
    expect(evaluateVerdict(PREDICATES['IA.L2-3.5.7.password-protection'], onPremOnly)).toBe('unknown');
  });

  it('SI.L2-3.14.7: the run-48 S1 alerts (4 resolved, 1 inProgress, 1 new) are met; one alert (an object, not a list) is judged too; an empty read stays unknown', async () => {
    const p = PREDICATES['SI.L2-3.14.7.security-alerts-evidence'];
    expect(evaluateVerdict(p, alerts(['resolved', 'resolved', 'resolved', 'resolved', 'inProgress', 'new']))).toBe('met');
    expect(evaluateVerdict(p, json({ id: 'alert-1', title: 'Sim alert', severity: 'low', status: 'resolved' }))).toBe('met');
    expect(evaluateVerdict(p, json({ id: 'alert-1', title: 'Sim alert', severity: 'low', status: 'newAlert' }))).toBe('not_met');
    const e: RegistryGetEntry[] = [{ entry_id: 'SI.L2-3.14.7.security-alerts-evidence', control_ids: ['SI.L2-3.14.7'], engine: 'mgraph', get_command: 'Get-Alerts' }];
    const { observations } = await runDiscovery(e, sessionOf({ 'Get-Alerts': '' }), sink);
    expect(observations[0]).toMatchObject({ derived_posture: 'unknown', confidence: 'low' });
  });
});
