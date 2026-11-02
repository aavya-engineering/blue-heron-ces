// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// PH-13 FX (2026-11-01). Round R-F10 S1: IA.L1-3.5.1.app-consent-restrict's SET threw
//   Exception setting "permissionGrantPoliciesAssigned": "The property 'permissionGrantPoliciesAssigned' cannot be found"
// because it modified a read (a PSCustomObject on the simulator) that lacked the member. The SET now sends the
// literal partial body of Learn's Update authorizationPolicy examples 3 and 5
// (https://learn.microsoft.com/graph/api/authorizationpolicy-update?view=graph-rest-1.0). AC.L1-3.1.2's consent
// part now uses the v1.0 property defaultUserRolePermissions.permissionGrantPoliciesAssigned
// (https://learn.microsoft.com/graph/api/resources/defaultuserrolepermissions?view=graph-rest-1.0); the top-level
// permissionGrantPolicyIdsAssignedToDefaultUserRole is not a v1.0 authorizationPolicy property.
// The PowerShell reproduction is tenant-stacksim src/resolvers/ph13FxConsent.pwsh.test.ts.
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { CommandRegistry } from '../../src/registry/CommandRegistry';
import { OutputVerificationEngine } from '../../src/core/OutputVerificationEngine';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MAIN = path.resolve(__dirname, '../../src/registry/cmmc-l2-commands.registry.json');
const INFRA = path.resolve(__dirname, '../../src/registry/infra-cmmc-l2-commands.registry.json');

const registry = CommandRegistry.load(MAIN);
const infra = CommandRegistry.load(INFRA);
const engine = new OutputVerificationEngine();
const entry = (id: string) => registry.allEntries.find(e => e.entry_id === id)!;
const verify = (id: string, read: unknown) =>
  engine.verify({ stdout: '', stderr: '', exitCode: 0 }, { stdout: JSON.stringify(read), exitCode: 0 }, { evidence: entry(id).verification!.evidence }).passed;
const commands = (e: { set_command: string; get_command: string; evidence_commands?: string[] }) => [e.set_command, e.get_command, ...(e.evidence_commands ?? [])].join('\n');

describe('PH-13 FX: the authorizationPolicy consent entries use the Graph v1.0 shape', () => {
  it('no entry command of either registry uses the non-v1.0 top-level permissionGrantPolicyIdsAssignedToDefaultUserRole', () => {
    const hits = [...registry.allEntries, ...infra.allEntries].filter(e => /permissionGrantPolicyIdsAssignedToDefaultUserRole/i.test(commands(e))).map(e => e.entry_id);
    expect(hits).toEqual([]);
  });

  it('IA.L1-3.5.1.app-consent-restrict: the SET sends a literal partial body and modifies no read (the R-F10 failure)', () => {
    const set = entry('IA.L1-3.5.1.app-consent-restrict').set_command;
    expect(set).not.toMatch(/\$\w+\.permissionGrantPoliciesAssigned\s*=/);
    expect(set).not.toMatch(/\$\w+\.allowedToCreateApps\s*=/);
    expect(set).toContain("-Method PATCH -Uri 'https://graph.microsoft.us/v1.0/policies/authorizationPolicy'");
    expect(set).toContain('@{defaultUserRolePermissions=@{allowedToCreateApps=$false;permissionGrantPoliciesAssigned=@()}}');
  });

  it('IA.L1-3.5.1.app-consent-restrict: SAT on the post-SET read, NOT_SAT while a ManagePermissionGrantsForSelf policy is assigned', () => {
    expect(verify('IA.L1-3.5.1.app-consent-restrict', { id: 'authorizationPolicy', allowedToCreateApps: false, userConsentPolicies: 0 })).toBe(true);
    expect(verify('IA.L1-3.5.1.app-consent-restrict', { id: 'authorizationPolicy', allowedToCreateApps: false, userConsentPolicies: 1 })).toBe(false);
    expect(verify('IA.L1-3.5.1.app-consent-restrict', { id: 'authorizationPolicy', allowedToCreateApps: true, userConsentPolicies: 0 })).toBe(false);
  });

  it('AC.L1-3.1.2.default-user-permissions: consent is cleared and read through defaultUserRolePermissions.permissionGrantPoliciesAssigned', () => {
    const e = entry('AC.L1-3.1.2.default-user-permissions');
    expect(e.set_command).toContain('@{defaultUserRolePermissions=@{allowedToCreateApps=$false;allowedToCreateSecurityGroups=$false;allowedToCreateTenants=$false;permissionGrantPoliciesAssigned=@()}}');
    expect(e.get_command).toContain('$_.DefaultUserRolePermissions.PermissionGrantPoliciesAssigned');
    const read = { id: 'authorizationPolicy', allowedToCreateApps: false, allowedToCreateSecurityGroups: false, allowedToCreateTenants: false, userConsentAllowed: false };
    expect(verify('AC.L1-3.1.2.default-user-permissions', read)).toBe(true);
    expect(verify('AC.L1-3.1.2.default-user-permissions', { ...read, userConsentAllowed: true })).toBe(false);
  });
});

// PH-13 FX: AU.L2-3.3.4's R-F10 S1 credit is the seeded, enabled 'S1 Audit logging turned off or changed' policy
// (gc-rf10-s1-mach ...\audit_accountability\au.l2-3.3.4.audit-config-alert.json). On a scenario with no answered
// security contact, Muster plans the visible placeholder unset-security-email@example.invalid (operatorValues.ts
// OPERATOR_PLACEHOLDER) as {cisoEmail}; a policy that alerts that address names nobody, so it must not verify.
describe('PH-13 FX: AU.L2-3.3.4.audit-config-alert credits a real recipient only', () => {
  const s1 = { Name: 'S1 Audit logging turned off or changed', Disabled: false, Severity: 'High', Operation: ['Set-AdminAuditLogConfig'], NotifyUser: ['security@s1-mach.simtenant.onmicrosoft.us'] };
  it('SAT on the R-F10 S1 read', () => {
    expect(verify('AU.L2-3.3.4.audit-config-alert', s1)).toBe(true);
  });
  it('NOT_SAT when the only recipient is the Muster placeholder, when disabled, or with no recipient', () => {
    expect(verify('AU.L2-3.3.4.audit-config-alert', { ...s1, NotifyUser: ['unset-security-email@example.invalid'] })).toBe(false);
    expect(verify('AU.L2-3.3.4.audit-config-alert', { ...s1, NotifyUser: ['security@s1-mach.simtenant.onmicrosoft.us', 'unset-security-email@example.invalid'] })).toBe(false);
    expect(verify('AU.L2-3.3.4.audit-config-alert', { ...s1, Disabled: true })).toBe(false);
    expect(verify('AU.L2-3.3.4.audit-config-alert', { ...s1, NotifyUser: [] })).toBe(false);
  });
});
