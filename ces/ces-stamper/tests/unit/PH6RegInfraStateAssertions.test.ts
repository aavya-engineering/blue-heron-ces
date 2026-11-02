// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// PH6-REG (V55): the infra registry's AZ entries assert state, not presence, where the simulator can
// answer (ces-strategy docs/context/finish/LOG-PH6-REG.md). Golden: each new assertion passes on the
// s1-mach proof-round GET outputs (fixture: verbatim where the GET is unchanged; rebuilt as the JSON the
// new GET emits where the old GET printed a table) and fails on the wrong state. Also MA.L2-3.7.5
// remote-maintenance MFA is created enabled and only an enabled policy is an equivalent.
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { CommandRegistrySchema } from '../../src/registry/command-registry.types';
import type { CommandEntry } from '../../src/registry/command-registry.types';
import { OutputVerificationEngine } from '../../src/core/OutputVerificationEngine';
import { postcheckModeOf } from '../../src/utils/structuredEvidence';
import { selectLookupMatch } from '../../src/registry/lookup';
import type { LookupBlock, SubCommand, VerificationCriteria } from '../../src/types/schema.types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REG = path.resolve(__dirname, '..', '..', 'src', 'registry');
const infraRaw = JSON.parse(fs.readFileSync(path.join(REG, 'infra-cmmc-l2-commands.registry.json'), 'utf-8'));
const mainRaw = JSON.parse(fs.readFileSync(path.join(REG, 'cmmc-l2-commands.registry.json'), 'utf-8'));
const FIX = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'fixtures', 'ph6-reg-s1-az-get-outputs.json'), 'utf-8'));
const infra = (id: string): CommandEntry => infraRaw.entries.find((e: CommandEntry) => e.entry_id === id);
const main = (id: string): CommandEntry => mainRaw.entries.find((e: CommandEntry) => e.entry_id === id);

// s1-mach plan variables (gc-rf3-s1-mach executable-plan.json).
const VARS: Record<string, string> = {
  subscriptionId: '51510000-00a2-4000-8000-000000000001', resourceGroup: 'rg-s1-mach-prod', location: 'usgovvirginia',
  vnetName: 's1mach-vnet-eo', vnetCidr: '10.0.0.0/16', mgmtSubnetCidr: '10.0.2.0/27', workloadSubnetCidr: '10.0.6.0/27', bastionSubnetCidr: '10.0.7.0/26',
};
const fill = (v: string) => v.replace(/\{(\w+)\}/g, (m, n) => VARS[n] ?? m);
/** The adapter's resolveVerification: placeholders resolve in `equals` values only. */
function resolved(c: VerificationCriteria): VerificationCriteria {
  const ev = c.evidence!;
  return { ...c, evidence: { ...ev, ...(ev.equals !== undefined ? { equals: fill(ev.equals) } : {}), ...(ev.checks ? { checks: ev.checks.map(k => (k.equals !== undefined ? { ...k, equals: fill(k.equals) } : k)) } : {}) } };
}
function evidencePasses(id: string, stdout: string): boolean | null {
  const r = new OutputVerificationEngine().verify({ stdout: '', stderr: '', exitCode: 0 }, { stdout, exitCode: 0 }, resolved(infra(id).verification!), { stateChanged: false });
  return r.details.evidence_check;
}
const asSub = (e: CommandEntry): SubCommand => ({ ...(e as unknown as SubCommand) });

// PH9-SIM (DEPTH-9b): the four that stayed presence until the simulator answered them are state too.
const PH9_STATE_IDS = ['AZ-PREFLIGHT-001', 'AZ-NET-001', 'AZ-NSG-001', 'AZ-FOUND-003'];
const STATE_IDS = ['AZ-CTX-001', 'AZ-FOUND-001', 'AZ-FOUND-002', 'AZ-NET-002', 'AZ-NET-003', 'AZ-NET-004', 'AZ-NSG-002', 'AZ-NSG-003', 'AZ-NSG-005', 'AZ-NSG-006', 'AZ-NW-001', 'AZ-POL-001', ...PH9_STATE_IDS];

// PH9-SIM: the GET outputs the simulator now returns, from the stacksim DEPTH-9a Windows PowerShell 5.1
// run (tests/integration/depth9a-infra-pwsh.test.ts, s1-mach, post-SET GET): the JSON verbatim, the
// tables rebuilt in the same column layout (trailing padding trimmed).
const PROVIDERS = ['Microsoft.OperationalInsights', 'Microsoft.SecurityInsights', 'Microsoft.Security', 'Microsoft.Automation', 'Microsoft.KeyVault', 'Microsoft.Storage', 'Microsoft.Network', 'Microsoft.Compute', 'microsoft.insights', 'Microsoft.AlertsManagement', 'Microsoft.OperationsManagement'];
const providerTable = (state: (ns: string) => string) => 'ProviderNamespace              RegistrationState\r\n-----------------              -----------------\r\n' + PROVIDERS.map(ns => `${ns.padEnd(30)} ${state(ns).padEnd(17)}`.trimEnd()).join('\r\n');
const pricingTable = (rows: Array<[string, string]>) => 'Name            PricingTier\r\n----            -----------\r\n' + rows.map(([n, t]) => `${n.padEnd(15)} ${t.padEnd(11)}`.trimEnd()).join('\r\n');
const PH9_SIM: Record<string, string> = {
  'AZ-PREFLIGHT-001': providerTable(() => 'Registered'),
  'AZ-FOUND-003': pricingTable([['VirtualMachines', 'Free'], ['StorageAccounts', 'Free'], ['CloudPosture', 'Free'], ['Arm', 'Free']]),
  'AZ-NET-001': '{\r\n    "Id":  "/subscriptions/sim-sub/resourceGroups/rg-s1-mach-prod/providers/Microsoft.Network/virtualNetworks/s1mach-vnet-eo",\r\n    "ResourceGroupName":  "rg-s1-mach-prod",\r\n    "Name":  "s1mach-vnet-eo",\r\n    "Location":  "usgovvirginia",\r\n    "AddressPrefix":  "10.0.0.0/16",\r\n    "ProvisioningState":  "Succeeded",\r\n    "AddressSpace":  {\r\n                         "AddressPrefixes":  [\r\n                                                 "10.0.0.0/16"\r\n                                             ]\r\n                     }\r\n}',
  'AZ-NSG-001': '{\r\n    "Id":  "/subscriptions/sim-sub/resourceGroups/rg-s1-mach-prod/providers/Microsoft.Network/networkSecurityGroups/nsg-workload-cmmc",\r\n    "ResourceGroupName":  "rg-s1-mach-prod",\r\n    "Name":  "nsg-workload-cmmc",\r\n    "Location":  "usgovvirginia",\r\n    "ProvisioningState":  "Succeeded"\r\n}',
};

// The JSON each changed GET emits for the state the s1-mach table outputs show.
const rule = (name: string, dir: string) => JSON.stringify({ Name: name, Access: 'Deny', Direction: dir, Priority: 4096, SourceAddressPrefix: '*', DestinationPortRange: '*' });
const nsgTags = (rules: Array<{ DestinationAddressPrefix: string }>) =>
  [...new Set(rules.map(x => x.DestinationAddressPrefix))].sort((x, y) => x.localeCompare(y, 'en', { sensitivity: 'base' })).join(',');
const S1_REBUILT: Record<string, string> = {
  'AZ-CTX-001': JSON.stringify({ Id: '51510000-00a2-4000-8000-000000000001', Name: 's1-mach-gov-prod' }),
  'AZ-NET-002': JSON.stringify({ Name: 'snet-mgmt', AddressPrefix: '10.0.2.0/27' }),
  'AZ-NET-003': JSON.stringify({ Name: 'snet-workload', AddressPrefix: '10.0.6.0/27' }),
  'AZ-NET-004': JSON.stringify({ Name: 'AzureBastionSubnet', AddressPrefix: '10.0.7.0/26' }),
  'AZ-NSG-002': rule('DenyAllInbound', 'Inbound'),
  'AZ-NSG-003': rule('DenyAllOutbound', 'Outbound'),
  // DEPTH-10.4 (P12-R3): the GET also emits AllowedServiceTags, the sorted unique destination tags of the rules
  // (PowerShell Sort-Object -Unique, case-insensitive), joined with commas.
  'AZ-NSG-006': JSON.stringify({ Rules: JSON.parse(FIX._tables['AZ-NSG-006']), AllowedServiceTags: nsgTags(JSON.parse(FIX._tables['AZ-NSG-006'])) }),
};

describe('PH6-REG: infra registry state assertions (V55)', () => {
  it('both registries still validate', () => {
    expect(CommandRegistrySchema.safeParse(infraRaw).success).toBe(true);
    expect(CommandRegistrySchema.safeParse(mainRaw).success).toBe(true);
  });

  it('all 16 AZ entries are state mode, none left presence (PH9-SIM: the simulator answers the last 4)', () => {
    for (const id of STATE_IDS) {
      expect({ id, mode: infra(id).verification?.postcheck_mode }).toEqual({ id, mode: 'state' });
      expect({ id, reason: infra(id).verification?.presence_reason }).toEqual({ id, reason: undefined });
    }
  });

  it('the record mode follows: state when the assertion was evaluated, presence (with the reason) otherwise', () => {
    const evaluated = { passed: true, confidence: 'HIGH', score: 100, details: { exit_code_check: true, set_output_check: null, evidence_check: true } } as any;
    const notEvaluated = { ...evaluated, details: { ...evaluated.details, evidence_check: null } };
    for (const id of STATE_IDS) expect(postcheckModeOf(asSub(infra(id)), evaluated)).toEqual({ postcheckMode: 'state' });
    expect(postcheckModeOf(asSub(infra('AZ-PREFLIGHT-001')), notEvaluated)?.postcheckMode).toBe('presence');
  });

  it('PH9-SIM golden: the 4 new state assertions pass on the simulator GET outputs', () => {
    for (const id of PH9_STATE_IDS) expect({ id, pass: evidencePasses(id, PH9_SIM[id]) }).toEqual({ id, pass: true });
  });

  it('PH9-SIM: the wrong state fails (a provider not Registered or missing, a plan without a tier, the CIDR, provisioning)', () => {
    const pf = 'AZ-PREFLIGHT-001';
    expect(evidencePasses(pf, providerTable(ns => (ns === 'Microsoft.Security' ? 'NotRegistered' : 'Registered')))).toBe(false);
    expect(evidencePasses(pf, providerTable(ns => (ns === 'Microsoft.KeyVault' ? 'Registering' : 'Registered')))).toBe(false);
    expect(evidencePasses(pf, providerTable(ns => (ns === 'microsoft.insights' ? 'Unregistered' : 'Registered')))).toBe(false);
    expect(evidencePasses(pf, providerTable(() => ''))).toBe(false); // the old simulator: no RegistrationState
    expect(evidencePasses(pf, PH9_SIM[pf].split('\r\n').filter(l => !/^Microsoft\.Security\s/.test(l)).join('\r\n'))).toBe(false);
    const fd = 'AZ-FOUND-003';
    expect(evidencePasses(fd, pricingTable([['Arm', 'Free']]))).toBe(false); // the old simulator: only Arm
    expect(evidencePasses(fd, pricingTable([['VirtualMachines', 'Standard'], ['StorageAccounts', 'Free'], ['CloudPosture', ''], ['Arm', 'Free']]))).toBe(false);
    expect(evidencePasses(fd, pricingTable([['VirtualMachines', 'Standard'], ['StorageAccounts', 'Free'], ['CloudPosture', 'Free'], ['Arm', 'Standard']]))).toBe(true);
    const net = 'AZ-NET-001';
    expect(evidencePasses(net, PH9_SIM[net].replace(/("AddressPrefixes":\s*\[\s*)"10\.0\.0\.0\/16"/, '$1"10.9.0.0/16"'))).toBe(false);
    expect(evidencePasses(net, PH9_SIM[net].replace('"Succeeded"', '"Failed"'))).toBe(false);
    expect(evidencePasses(net, JSON.stringify({ Id: '/x/virtualNetworks/s1mach-vnet-eo', AddressPrefix: '10.0.0.0/16' }))).toBe(false); // the old flat shape
    expect(evidencePasses('AZ-NSG-001', PH9_SIM['AZ-NSG-001'].replace('"Succeeded"', '"Deleting"'))).toBe(false);
    expect(evidencePasses('AZ-NSG-001', JSON.stringify({ Id: '/x/networkSecurityGroups/nsg-workload-cmmc' }))).toBe(false);
  });

  it('golden: every state assertion passes on the s1-mach GET outputs (verbatim or rebuilt)', () => {
    for (const id of ['AZ-FOUND-001', 'AZ-FOUND-002', 'AZ-POL-001', 'AZ-NW-001', 'AZ-NSG-005']) expect({ id, pass: evidencePasses(id, FIX[id]) }).toEqual({ id, pass: true });
    for (const [id, out] of Object.entries(S1_REBUILT)) expect({ id, pass: evidencePasses(id, out) }).toEqual({ id, pass: true });
  });

  it('the real Az shapes pass too: a subnet AddressPrefix list, a rule prefix list', () => {
    expect(evidencePasses('AZ-NET-002', JSON.stringify({ Name: 'snet-mgmt', AddressPrefix: ['10.0.2.0/27'] }))).toBe(true);
    expect(evidencePasses('AZ-NSG-002', JSON.stringify({ ...JSON.parse(rule('DenyAllInbound', 'Inbound')), SourceAddressPrefix: ['*'], DestinationPortRange: ['*'] }))).toBe(true);
  });

  it('the wrong state fails: subnet CIDR, rule access/direction, enforcement mode, rule count, subscription, provisioning', () => {
    expect(evidencePasses('AZ-NET-002', JSON.stringify({ Name: 'snet-mgmt', AddressPrefix: '10.9.9.0/27' }))).toBe(false);
    expect(evidencePasses('AZ-NSG-002', rule('DenyAllInbound', 'Inbound').replace('"Deny"', '"Allow"'))).toBe(false);
    expect(evidencePasses('AZ-NSG-003', rule('DenyAllOutbound', 'Inbound'))).toBe(false);
    expect(evidencePasses('AZ-POL-001', FIX['AZ-POL-001'].replace('"Default"', '"DoNotEnforce"'))).toBe(false);
    expect(evidencePasses('AZ-FOUND-002', FIX['AZ-FOUND-002'].replace('"Default"', '"DoNotEnforce"'))).toBe(false);
    expect(evidencePasses('AZ-NSG-006', JSON.stringify({ Rules: JSON.parse(FIX._tables['AZ-NSG-006']).slice(0, 6) }))).toBe(false);
    expect(evidencePasses('AZ-CTX-001', JSON.stringify({ Id: '00000000-0000-0000-0000-000000000000', Name: 'other' }))).toBe(false);
    expect(evidencePasses('AZ-NW-001', FIX['AZ-NW-001'].replace('"Succeeded"', '"Failed"'))).toBe(false);
    expect(evidencePasses('AZ-FOUND-001', FIX['AZ-FOUND-001'].replace(/"ProvisioningState":\s*"Succeeded"/, '"ProvisioningState": "Deleting"'))).toBe(false);
    expect(evidencePasses('AZ-NSG-005', FIX['AZ-NSG-005'].replace(/nsg-workload-cmmc"/, 'nsg-other"'))).toBe(false);
  });

  it('the old table-format GETs would have failed a JSON assertion (why the GETs now end in ConvertTo-Json)', () => {
    expect(evidencePasses('AZ-NET-002', FIX._tables['AZ-NET-002'])).toBe(false);
    expect(evidencePasses('AZ-NSG-002', FIX._tables['AZ-NSG-002'])).toBe(false);
    for (const id of ['AZ-CTX-001', 'AZ-NET-002', 'AZ-NET-003', 'AZ-NET-004', 'AZ-NSG-002', 'AZ-NSG-003', 'AZ-NSG-006']) expect(infra(id).get_command).toMatch(/ConvertTo-Json/);
    // the s1-mach NSG holds DenyAllInbound twice (open item: the SET is not idempotent); the GET reads one
    for (const id of ['AZ-NSG-002', 'AZ-NSG-003']) expect(infra(id).get_command).toContain('Select-Object -First 1');
  });
});

describe('PH6-REG: MA.L2-3.7.5 remote-maintenance MFA is enforced (LOG-DEPTH-3456 open item 4)', () => {
  const e = main('MA.L2-3.7.5.remote-mfa');
  const resolve = (v: string) => v;
  const policy = (state: string) => ({
    displayName: 'tenant MFA', state, conditions: { applications: { includeApplications: ['All'] }, users: { includeUsers: ['All'] } },
    grantControls: { operator: 'OR', builtInControls: ['mfa'] },
  });

  it('the SET creates the policy enabled, with the same break-glass exclusion as AC.L2-3.1.15 admin MFA', () => {
    expect(e.set_command).toContain("-State 'enabled'");
    expect(e.set_command).not.toContain('enabledForReportingButNotEnforced');
    expect(e.set_command).toContain("excludeUsers=@('{breakGlassUserId}')");
    expect(main('AC.L2-3.1.15.admin-mfa').set_command).toContain("excludeUsers=@('{breakGlassUserId}')");
    expect(e.variables_runtime).toContain('breakGlassUserId');
  });

  it('the read-back asserts State enabled', () => {
    expect(e.verification?.evidence?.checks).toEqual([{ jsonpath: '$.State', equals: 'enabled' }]);
    expect(e.verification?.postcheck_mode).toBe('state');
  });

  it('only an enabled tenant policy is an equivalent (the lookup and its GET mirror agree)', () => {
    expect(selectLookupMatch([policy('enabled')], e.lookup as LookupBlock, resolve)).toBeDefined();
    expect(selectLookupMatch([policy('enabledForReportingButNotEnforced')], e.lookup as LookupBlock, resolve)).toBeUndefined();
    expect(e.get_command).toContain("($_.state -eq 'enabled')");
    expect(e.get_command).not.toContain('enabledForReportingButNotEnforced');
  });
});
