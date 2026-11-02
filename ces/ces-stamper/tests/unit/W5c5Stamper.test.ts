// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// synthetic-customer W5 cycle 5, Stamper slice.
// (1) Exchange policy / rule pairs: the policy entry finds a tenant's own equivalent (never a built-in
//     default) and captures its name; the rule entry targets that captured name. No equivalent: both
//     are created as before. (2) admin-account and AZ-MON-001 lookups. (3) SC.L2-3.13.10.key-vault.
// (4) Infrastructure registry attribution trims.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { CommandRegistry } from '../../src/registry/CommandRegistry';
import { CommandRegistrySchema } from '../../src/registry/command-registry.types';
import { selectLookupMatch, lookupGetCommand } from '../../src/registry/lookup';
import { ManifestReader } from '../../src/translators/ManifestReader';
import { PlanTranslator } from '../../src/translators/PlanTranslator';
import { PowerShellAdapter } from '../../src/adapters/PowerShellAdapter';
import { StamperConfig } from '../../src/config/StamperConfig';
import { ExecutionContext } from '../../src/core/ExecutionContext';
import { evidenceDirForTenant, evidenceFileForEntry, taskEvidencePath } from '../../src/core/EvidenceReadinessAnalyzer';
import type { ExeTask, LookupBlock, SubCommand } from '../../src/types/schema.types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, '../fixtures');
const REG = path.resolve(__dirname, '../../src/registry/cmmc-l2-commands.registry.json');
const INFRA = path.resolve(__dirname, '../../src/registry/infra-cmmc-l2-commands.registry.json');
const registry = CommandRegistry.load(REG);
const infra = CommandRegistry.load(INFRA);
const byId = (id: string) => registry.allEntries.find(e => e.entry_id === id)!;
const infraById = (id: string) => infra.allEntries.find(e => e.entry_id === id)!;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const DOMAIN = 's1-mach.simtenant.onmicrosoft.us';

const PIPELINE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'stamper-w5c5-'));
const savedRoot = process.env.CES_PIPELINE_ROOT;
beforeAll(() => { process.env.CES_PIPELINE_ROOT = PIPELINE_ROOT; });
afterAll(() => {
  if (savedRoot === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = savedRoot;
  fs.rmSync(PIPELINE_ROOT, { recursive: true, force: true });
});

const PAIRS = [
  { policy: 'SI.L2-3.14.2.anti-malware', rule: 'SI.L2-3.14.2.malware-rule', name: 'CMMC-Malware', variable: 'malwarePolicyName', field: 'MalwareFilterPolicy', getP: 'Get-MalwareFilterPolicy', getR: 'Get-MalwareFilterRule' },
  { policy: 'SI.L2-3.14.3.safe-links', rule: 'SI.L2-3.14.3.safe-links-rule', name: 'CMMC-SafeLinks', variable: 'safeLinksPolicyName', field: 'SafeLinksPolicy', getP: 'Get-SafeLinksPolicy', getR: 'Get-SafeLinksRule' },
  { policy: 'SC.L2-3.13.13.safe-attach', rule: 'SC.L2-3.13.13.safe-attach-rule', name: 'CMMC-SafeAttach', variable: 'safeAttachPolicyName', field: 'SafeAttachmentPolicy', getP: 'Get-SafeAttachmentPolicy', getR: 'Get-SafeAttachmentRule' },
  { policy: 'SC.L2-3.13.15.anti-phish', rule: 'SC.L2-3.13.15.anti-phish-rule', name: 'CMMC-AntiPhish', variable: 'antiPhishPolicyName', field: 'AntiPhishPolicy', getP: 'Get-AntiPhishPolicy', getR: 'Get-AntiPhishRule' },
  { policy: 'SC.L2-3.13.15.anti-spam', rule: 'SC.L2-3.13.15.anti-spam-rule', name: 'CMMC-AntiSpam', variable: 'antiSpamPolicyName', field: 'HostedContentFilterPolicy', getP: 'Get-HostedContentFilterPolicy', getR: 'Get-HostedContentFilterRule' },
  { policy: 'SC.L2-3.13.15.outbound-spam', rule: 'SC.L2-3.13.15.outbound-spam-rule', name: 'CMMC-OutboundSpam', variable: 'outboundSpamPolicyName', field: 'HostedOutboundSpamFilterPolicy', getP: 'Get-HostedOutboundSpamFilterPolicy', getR: 'Get-HostedOutboundSpamFilterRule' },
];
const READS = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'w3-state-reads.json'), 'utf-8')).reads as Record<string, string>;
const read = (id: string) => JSON.parse(READS[id]);

// ---- (1) Exchange pairs ----
describe('W5c5 (1): Exchange policy / rule pairs', () => {
  it('both registries still validate; 154 + infrastructure entries', () => {
    for (const p of [REG, INFRA]) expect(CommandRegistrySchema.safeParse(JSON.parse(fs.readFileSync(p, 'utf-8'))).success).toBe(true);
    expect(registry.allEntries).toHaveLength(184); // PH-12 merge: 153 + 30 = + 8 (P12-R1), + 5 (P12-R2), + 4 (P12-R3), + 5 (P12-R4), + 8 (P12-R5); CG: + SC.L2-3.13.10.key-escrow; DEPTH-1a: - 5 duplicates; W5c7: + 2; W7-ST: + PS.L2-3.9.2.leaver-workflow; PH-13 (P13-LV, P13-INT): + PS.L2-3.9.2.leaver-access-terminated
  });

  for (const p of PAIRS) {
    describe(p.policy, () => {
      const pol = byId(p.policy);
      const rule = byId(p.rule);
      it('the policy lookup: CES name or effect, never a built-in default; GET generated; the name is captured', () => {
        expect(pol.lookup!.source).toBe(p.getP);
        expect(pol.lookup!.by_name).toEqual({ path: '$.Name', equals: p.name });
        expect(pol.lookup!.by_effect[0]).toEqual({ path: '$.IsDefault', op: 'not_equals', value: true });
        expect(pol.get_command).toBe(lookupGetCommand(pol.lookup!));
        expect(pol.captures).toEqual([{ variable: p.variable, from: 'json_field', json_path: '$.Name' }]);
        expect(pol.set_command.endsWith(`; ${p.getP} -Identity '${p.name}' | Select-Object Name | ConvertTo-Json`)).toBe(true);
        expect(pol.set_command).toContain('| Out-Null');
      });
      it("CES's own policy meets its own effect; a built-in default with the same settings never matches", () => {
        const own = read(p.policy);
        expect(selectLookupMatch([own], pol.lookup!)).toBe(own);
        const imitation = { ...clone(own), Name: 'Default', Identity: 'Default', IsDefault: true };
        expect(selectLookupMatch([imitation], pol.lookup!)).toBeUndefined();
        expect(selectLookupMatch([{ ...imitation, Name: 'Customer policy', IsDefault: false }], pol.lookup!)?.Name).toBe('Customer policy');
      });
      it('the rule targets the captured policy name in its SET, its lookup and its state rule', () => {
        expect(rule.set_command).toContain(`'{${p.variable}}'`);
        expect(rule.set_command).not.toContain(`'${p.name}'`);
        expect(rule.variables_runtime).toContain(p.variable);
        expect(rule.lookup!.by_effect).toEqual(expect.arrayContaining([{ path: `$.${p.field}`, op: 'equals', value: `{${p.variable}}` }, { path: '$.State', op: 'equals', value: 'Enabled' }]));
        expect(rule.verification!.evidence!.checks).toEqual(expect.arrayContaining([{ jsonpath: `$.${p.field}`, equals: `{${p.variable}}` }]));
        expect(rule.get_command).toBe(lookupGetCommand(rule.lookup!));
        expect(rule.sequence_hint).toBeGreaterThan(pol.sequence_hint);
      });
      it("a customer rule on CES's policy is not the customer's rule for its own policy, and the other way round", () => {
        const own = read(p.rule);
        expect(selectLookupMatch([{ ...own, Name: 'X' }], rule.lookup!, s => s.replace(`{${p.variable}}`, 'Customer policy').replace('{primaryDomain}', DOMAIN))).toBeUndefined();
        expect(selectLookupMatch([{ ...own, Name: 'X', [p.field]: 'Customer policy' }], rule.lookup!, s => s.replace(`{${p.variable}}`, 'Customer policy').replace('{primaryDomain}', DOMAIN))?.Name).toBe('X');
      });
    });
  }

  // a fake Exchange tenant: lists per cmdlet; a GET is answered with the lookup semantics, variables as the adapter resolved them
  const S1_SL_POLICY = { id: 'S1 Safe Links - all users', Identity: 'S1 Safe Links - all users', Name: 'S1 Safe Links - all users', IsDefault: false, EnableSafeLinksForEmail: true, EnableSafeLinksForTeams: true, EnableSafeLinksForOffice: true, ScanUrls: true, EnableForInternalSenders: true, DeliverMessageAfterScan: true, TrackClicks: true, AllowClickThrough: false, DisableUrlRewrite: false, IsValid: true };
  const S1_SL_RULE = { id: 'S1 Safe Links rule', Identity: 'S1 Safe Links rule', Name: 'S1 Safe Links rule', SafeLinksPolicy: 'S1 Safe Links - all users', RecipientDomainIs: [DOMAIN], State: 'Enabled', Priority: 0 };
  const sub = (id: string): SubCommand => {
    const e = byId(id);
    return { id: e.entry_id, label: e.label, set_command: e.set_command, get_command: e.get_command, engine: e.engine, sequence_hint: e.sequence_hint, idempotency: e.idempotency, variables_required: e.variables_required, variables_runtime: e.variables_runtime, captures: e.captures, on_failure: e.on_failure, evidence_commands: [], verification: e.verification, lookup: e.lookup, control_ids: e.control_ids } as SubCommand;
  };
  const runPair = async (tenant: string, policies: any[], rules: any[]) => {
    const sent: string[] = [];
    const lists: Record<string, any[]> = { 'Get-SafeLinksPolicy': clone(policies), 'Get-SafeLinksRule': clone(rules) };
    const subs = [sub('SI.L2-3.14.3.safe-links'), sub('SI.L2-3.14.3.safe-links-rule')];
    const manager = {
      execute: async (_t: string, c: string) => {
        sent.push(c);
        if (c.startsWith('New-SafeLinksPolicy')) { lists['Get-SafeLinksPolicy'].push(read('SI.L2-3.14.3.safe-links')); return { stdout: '{"Name":"CMMC-SafeLinks"}', stderr: '', exitCode: 0 }; }
        if (c.startsWith('New-SafeLinksRule')) { const r = { ...read('SI.L2-3.14.3.safe-links-rule'), SafeLinksPolicy: c.match(/-SafeLinksPolicy '([^']+)'/)![1] }; lists['Get-SafeLinksRule'].push(r); return { stdout: JSON.stringify(r), stderr: '', exitCode: 0 }; }
        for (const s of subs) {
          const src = s.lookup!.source;
          if (c.startsWith(`${src} | Where-Object`)) {
            // the adapter resolved every {variable}; read the values back out of the command text
            const policyName = c.match(/\$_\.SafeLinksPolicy -eq '([^']+)'/)?.[1];
            const hit = selectLookupMatch(lists[src], s.lookup!, v => v.replace('{safeLinksPolicyName}', policyName ?? '').replace('{primaryDomain}', DOMAIN));
            return { stdout: hit ? JSON.stringify(hit, null, 2) : '', stderr: '', exitCode: 0 };
          }
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    };
    const ctx = new ExecutionContext(false);
    ctx.loadManifestVariables({ primaryDomain: DOMAIN });
    const task = { id: `t-${tenant}`, type: 'configuration', priority: 'p1', depends_on: [], action: { engine: 'exchange', command: 'x', args: { _sub_commands: subs } }, inputs: [], outputs: [], controls: ['SI.L2-3.14.3'], idempotency: 'safe', rollback: { strategy: 'none' } } as ExeTask;
    const config = StamperConfig.fromTenantConfig({ tenantId: 't', appId: 'a', certThumbprint: 'c', certPath: '/p', targetTenantDomain: 'test.onmicrosoft.us', clientName: 'Test' });
    const result = await new PowerShellAdapter(config, manager as any, ctx, undefined, tenant).execute(task, { primaryDomain: DOMAIN }, false);
    const rec = (s: SubCommand) => JSON.parse(fs.readFileSync(taskEvidencePath(evidenceDirForTenant(tenant), task.id, evidenceFileForEntry(s.id, s.label).replace(/\.txt$/, '.json')), 'utf-8'));
    return { result, sent, lists, policy: rec(subs[0]), rule: rec(subs[1]) };
  };

  const realSetTimeout = global.setTimeout;
  beforeEach(() => {
    (global as any).setTimeout = (fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) =>
      realSetTimeout(fn, ms !== undefined && ms >= 5000 ? 0 : ms, ...args);
  });
  afterEach(() => { (global as any).setTimeout = realSetTimeout; });

  it("S1: its own Safe Links policy and rule are verified; the rule lookup targets the captured S1 policy name; nothing is created", async () => {
    const { result, sent, lists, policy, rule } = await runPair('w5c5-sl-s1', [S1_SL_POLICY], [S1_SL_RULE]);
    expect(result.success).toBe(true);
    expect(sent.some(c => c.startsWith('New-'))).toBe(false);
    expect(policy.complianceVerdict).toBe('SAT');
    expect(policy.metadata.lookupMatch).toMatchObject({ basis: 'effect', object: 'S1 Safe Links - all users' });
    expect(rule.complianceVerdict).toBe('SAT');
    expect(rule.metadata.lookupMatch).toMatchObject({ basis: 'effect', object: 'S1 Safe Links rule' });
    expect(sent.find(c => c.startsWith('Get-SafeLinksRule'))).toContain("$_.SafeLinksPolicy -eq 'S1 Safe Links - all users'");
    expect(lists['Get-SafeLinksPolicy']).toHaveLength(1);
    expect(lists['Get-SafeLinksRule']).toHaveLength(1);
  });

  it('no equivalent (a built-in default only): CMMC-SafeLinks and its rule are created, the rule on CMMC-SafeLinks', async () => {
    const builtIn = { id: 'Built-In Protection Policy', Name: 'Built-In Protection Policy', IsDefault: true, EnableSafeLinksForEmail: true, ScanUrls: true, EnableForInternalSenders: true };
    const { result, sent, lists, policy, rule } = await runPair('w5c5-sl-none', [builtIn], []);
    expect(sent.some(c => c.startsWith('New-SafeLinksPolicy'))).toBe(true);
    expect(sent.find(c => c.startsWith('New-SafeLinksRule'))).toContain("-SafeLinksPolicy 'CMMC-SafeLinks'");
    expect(result.success).toBe(true);
    expect(policy.complianceVerdict).toBe('SAT');
    expect(rule.complianceVerdict).toBe('SAT');
    expect(lists['Get-SafeLinksRule'][0].SafeLinksPolicy).toBe('CMMC-SafeLinks');
  });

  it('a customer policy without a matching rule: the policy is verified and CES creates its rule on the customer policy', async () => {
    const { sent, rule } = await runPair('w5c5-sl-norule', [S1_SL_POLICY], [{ ...S1_SL_RULE, State: 'Disabled' }]);
    expect(sent.some(c => c.startsWith('New-SafeLinksPolicy'))).toBe(false);
    expect(sent.find(c => c.startsWith('New-SafeLinksRule'))).toContain("-SafeLinksPolicy 'S1 Safe Links - all users'");
    expect(rule.complianceVerdict).toBe('SAT');
  });
});

// ---- (2) admin-account, AZ-MON-001 ----
describe('W5c5 (2): admin-account and AZ-MON-001 lookups', () => {
  const e = byId('AC.L2-3.1.6.admin-account');
  const user = (id: string, over: object) => ({ id, displayName: id, userPrincipalName: `${id}@${DOMAIN}`, accountEnabled: true, assignedLicenses: [], privileged: false, breakGlass: false, ...over });
  const r = (s: string) => s.replace('{adminUserName}', 'cesadmin');
  it('the GET joins standing and PIM-eligible privileged roles, the all-users CA exclusions and the users read', () => {
    expect(e.get_command).toBe(lookupGetCommand(e.lookup!));
    for (const s of ['/roleManagement/directory/roleAssignments', '/roleManagement/directory/roleEligibilitySchedules', '/identity/conditionalAccess/policies', 'users?$select=id,displayName,userPrincipalName,accountEnabled,assignedLicenses', "'62e90394-69f5-4237-9190-012177145e10'"]) expect([s, e.get_command.includes(s)]).toEqual([s, true]);
    expect(e.lookup!.by_name).toEqual({ path: '$.displayName', equals: 'Admin-{adminUserName}' });
  });
  it('a privileged, unlicensed, enabled account that is not break-glass is an equivalent; the others are not', () => {
    const admin = user('adm.lawrence.thatch', { privileged: true });
    expect(selectLookupMatch([user('staff', {}), admin], e.lookup!, r)).toBe(admin);
    expect(selectLookupMatch([user('bg', { privileged: true, breakGlass: true })], e.lookup!, r)).toBeUndefined();
    expect(selectLookupMatch([user('licensed', { privileged: true, assignedLicenses: [{ skuId: 'g5' }] })], e.lookup!, r)).toBeUndefined();
    expect(selectLookupMatch([user('off', { privileged: true, accountEnabled: false })], e.lookup!, r)).toBeUndefined();
    const own = user('Admin-cesadmin', {});
    expect(selectLookupMatch([admin, own], e.lookup!, r)).toBe(own); // CES's own account first, by name
  });
  it('AZ-MON-001: an enabled action group anywhere in the subscription that mails the CISO is an equivalent', () => {
    const m = infraById('AZ-MON-001');
    expect(m.get_command).toBe(lookupGetCommand(m.lookup!));
    expect(m.get_command.startsWith('Get-AzActionGroup | ForEach-Object')).toBe(true);
    const ciso = (s: string) => s.replace('{cisoEmail}', 'ciso@example.test');
    const g = { Name: 'SOC alerts', ResourceGroupName: 'rg-ops', Enabled: true, EmailAddresses: ['soc@example.test', 'ciso@example.test'] };
    expect(selectLookupMatch([g], m.lookup!, ciso)).toBe(g);
    expect(selectLookupMatch([{ ...g, EmailAddresses: ['soc@example.test'] }], m.lookup!, ciso)).toBeUndefined();
    expect(selectLookupMatch([{ ...g, Enabled: false }], m.lookup!, ciso)).toBeUndefined();
  });
  it('audit-reduction keeps no lookup (reason in the log)', () => {
    expect(byId('AU.L2-3.3.6.audit-reduction').lookup).toBeUndefined();
  });
});

// ---- (3) key management ----
describe('W5c5 (3): SC.L2-3.13.10.key-vault', () => {
  const e = byId('SC.L2-3.13.10.key-vault');
  const vault = (over: object) => ({ VaultName: 'kv-s1-mach-prod', ResourceId: '/subscriptions/x/resourceGroups/rg-s1-mach-prod/providers/Microsoft.KeyVault/vaults/kv-s1-mach-prod', VaultUri: 'https://kv-s1-mach-prod.vault.usgovcloudapi.net/', EnablePurgeProtection: true, EnableSoftDelete: true, SoftDeleteRetentionInDays: 90, EnableRbacAuthorization: true, EnclaveIdentities: [], UnassignedIdentities: [], ...over });
  const r = (s: string) => s.replace('{keyVaultName}', 's1mach-kv-prod');
  it('the entry: SC.L2-3.13.10 only; SET creates the vault with purge protection and soft delete and assigns the enclave identities; state rule', () => {
    expect(e.control_ids).toEqual(['SC.L2-3.13.10']);
    expect(e.engine).toBe('az');
    for (const s of ['New-AzKeyVault', '-EnablePurgeProtection', '-SoftDeleteRetentionInDays 90', '-EnableRbacAuthorization', "-Sku 'Standard'", 'Get-AzVM', 'Get-AzUserAssignedIdentity', "New-AzRoleAssignment -ObjectId $mi -RoleDefinitionName 'Key Vault Crypto Service Encryption User' -Scope $kv.ResourceId"]) expect([s, e.set_command.includes(s)]).toEqual([s, true]);
    expect(e.captures!.map(c => c.variable)).toEqual(['kvResourceId', 'kvUri']);
    expect(e.verification!.postcheck_mode).toBe('state');
    expect(e.get_command).toBe(lookupGetCommand(e.lookup!));
    expect(byId('SC.L1-3.13.1.nsg-boundary-rules').control_ids).not.toContain('SC.L2-3.13.10');
    expect(registry.allEntries.filter(x => x.control_ids.includes('SC.L2-3.13.10')).map(x => x.entry_id)).toEqual(['SC.L2-3.13.10.key-escrow', 'SC.L2-3.13.10.key-vault']); // CG: the free escrow read is the standard entry
  });
  it("S1's own vault (purge protection, soft delete, no unassigned enclave identity) is an equivalent; not without purge protection or with an unassigned identity", () => {
    const s1 = vault({});
    expect(selectLookupMatch([s1], e.lookup!, r)).toBe(s1);
    expect(selectLookupMatch([vault({ EnablePurgeProtection: false })], e.lookup!, r)).toBeUndefined();
    expect(selectLookupMatch([vault({ EnclaveIdentities: ['mi-1'], UnassignedIdentities: ['mi-1'] })], e.lookup!, r)).toBeUndefined();
    expect(selectLookupMatch([vault({ SoftDeleteRetentionInDays: undefined })], e.lookup!, r)).toBeUndefined();
  });
  it('translate (CG, founder ruling 2026-10-31): the SC.L2-3.13.10 step runs the free key-escrow read; the key vault is left out as cost_gated_off', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stamper-w5c5-tr-'));
    try {
      const mp = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'synthetic-mission-plan.json'), 'utf-8'));
      const tm = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'synthetic-tenant-manifest.json'), 'utf-8'));
      const hp = mp.outputs.human_readable_mission_plan;
      const base = hp.steps.find((s: any) => s.task_type === 'configuration') ?? hp.steps[0];
      hp.steps = [{ ...clone(base), id: 'step_task_SC.L2-3.13.10_w5c5', title: 'SC.L2-3.13.10', task_type: 'configuration', control_coverage: [{ control_id: 'SC.L2-3.13.10', support_type: 'Configurable', gap_rationale: 'gap' }], depends_on: [] }];
      hp.control_directives = [{ control_id: 'SC.L2-3.13.10', directive: 'implement', step_ids: ['task_SC.L2-3.13.10_w5c5'] }];
      const body = tm.tenant_manifest ?? tm;
      if (!body.normative_controls.some((n: any) => n.control_id === 'SC.L2-3.13.10')) body.normative_controls.push({ control_id: 'SC.L2-3.13.10', required_state: 'x', verification: [{ id: 'c0', description: 'x', method: 'config_export', expected: 'x', on_fail: 'f', presence_only: true }], evidence_artifacts: [] });
      const tmPath = path.join(tmp, 'tm.json');
      fs.writeFileSync(tmPath, JSON.stringify(tm));
      const plan = new PlanTranslator(registry).translate(mp, ManifestReader.fromFile(tmPath)).plan;
      const subs = plan.execution_graph.flatMap(t => (t.action.args._sub_commands ?? []) as SubCommand[]);
      expect(subs.map(s => s.id)).toContain('SC.L2-3.13.10.key-escrow');
      expect(subs.map(s => s.id)).not.toContain('SC.L2-3.13.10.key-vault');
      expect((plan.variables._cost_gate as any).gated_off.map((d: any) => d.entry_id)).toEqual(['SC.L2-3.13.10.key-vault']);
      expect(subs.map(s => s.id)).not.toContain('SC.L1-3.13.1.nsg-boundary-rules');
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });
});

// ---- (4) infrastructure trims ----
describe('W5c5 (4): infrastructure registry attribution (ST-C3 rule)', () => {
  const EXPECTED: Record<string, string[]> = {
    'AZ-FOUND-002': ['CM.L2-3.4.1'],
    'AZ-FOUND-003': ['SI.L1-3.14.1', 'SI.L2-3.14.6'],
    'AZ-LOG-001': ['AU.L2-3.3.1'],
    'AZ-LOG-002': ['AU.L2-3.3.1'],
    'AZ-LOG-002a': ['SC.L2-3.13.10'],
    'AZ-LOG-002b': ['SC.L2-3.13.10'],
    'AZ-LOG-002c': ['SC.L2-3.13.10'],
    'AZ-KV-001': ['SC.L2-3.13.10'],
    'AZ-NSG-005': ['SC.L1-3.13.1'],
    'AZ-NW-001': ['SC.L1-3.13.1'],
    'AZ-NW-002': ['AU.L2-3.3.1'],
    'AZ-AUTO-001': ['AU.L2-3.3.1'],
    'AZ-AUTO-002': ['AU.L2-3.3.1'],
    'AZ-AUTO-003': ['AC.L1-3.1.1'],
    'AZ-SEN-001': ['AU.L2-3.3.1', 'AU.L2-3.3.3'],
    'AZ-SEN-002': ['AU.L2-3.3.1'],
    'AZ-SEN-004': ['AU.L2-3.3.1'],
    'AZ-SEN-005': ['SI.L2-3.14.6'],
    'AZ-SEN-006': ['SI.L2-3.14.6'],
    'AZ-SEN-007': ['AU.L2-3.3.2', 'AU.L2-3.3.3'],
    'AZ-SEN-008': ['AU.L2-3.3.1'],
    'AZ-SEN-009': ['AU.L2-3.3.1'],
    'AZ-VM-001': ['SC.L1-3.13.1'],
    'AZ-VM-004': ['SI.L1-3.14.1'],
    'AZ-ID-003': ['AC.L1-3.1.1'],
    'AZ-FOUND-004': ['CM.L2-3.4.2'],
  };
  for (const [id, ids] of Object.entries(EXPECTED)) {
    it(`${id} lists only ${ids.join(', ')}`, () => expect(infraById(id).control_ids).toEqual(ids));
  }
  it('every infrastructure entry keeps at least one control', () => {
    for (const e of infra.allEntries) expect([e.entry_id, e.control_ids.length > 0]).toEqual([e.entry_id, true]);
  });
});
