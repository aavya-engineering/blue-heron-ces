// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// DEPTH-10.4 (PH-12 P12-R3): the SC batch. Each new or changed configuring entry carries a literal top-level
// jsonpath + equals that repeats one of its checks, so its objectives' postchecks get an expected value (V94).
// The reads are what tenant-stacksim answers to each GET after its SET (golden:
// tenant-stacksim/src/resolvers/depth10SCResolvers.test.ts; AZ-NSG-006 from round R-F9 S1 evidence plus the new field).
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'node:url';
import { CommandRegistry } from '../../src/registry/CommandRegistry';
import { OutputVerificationEngine } from '../../src/core/OutputVerificationEngine';
import { evaluateExpectedValue } from '../../src/core/PostcheckRunner';
import { applyRegistryExpectedValues } from '../../src/translators/objectiveCredit';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIR = path.resolve(__dirname, '../../src/registry');
const registry = CommandRegistry.merge(
  CommandRegistry.load(path.join(DIR, 'cmmc-l2-commands.registry.json')),
  CommandRegistry.load(path.join(DIR, 'infra-cmmc-l2-commands.registry.json')),
);
const raw = (f: string) => (JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf-8')) as { entries: Array<Record<string, any>> }).entries;
const engine = new OutputVerificationEngine();
const entry = (id: string) => registry.allEntries.find(e => e.entry_id === id)!;
const verify = (stdout: string, id: string) =>
  engine.verify({ stdout: '', stderr: '', exitCode: 0 }, { stdout, exitCode: 0 }, { evidence: entry(id).verification!.evidence }).passed;

const NP = 'device_vendor_msft_policy_config_defender_enablenetworkprotection';
const PF = 'device_vendor_msft_policy_config_localpoliciessecurityoptions_shutdown_clearvirtualmemorypagefile';
const FIPS = 'device_vendor_msft_policy_config_cryptography_allowfipsalgorithmpolicy';
const ALL = [{ id: 'p_allDevicesAssignmentTarget', target: { '@odata.type': '#microsoft.graph.allDevicesAssignmentTarget' } }];
const TAGS = 'AzureActiveDirectory,AzureFrontDoor.FirstParty,AzureKeyVault,AzureResourceManager,AzureUpdateDelivery,GuestAndHybridManagement,Storage';
const rule = (tag: string, p: number) => ({ Name: `CES-Out-443-${tag.replace(/\./g, '-')}`, Priority: p, Access: 'Allow', Direction: 'Outbound', DestinationAddressPrefix: tag, DestinationPortRange: '443' });

/** entry id -> [objectives it configures, simulator read after the SET] */
const GOLDEN: Record<string, [string[], unknown]> = {
  'SC.L1-3.13.1.network-protection': [['SC.L1-3.13.1[g]'], { name: 'CMMC-NetworkProtection', networkProtection: `${NP}_1`, assignments: ALL }],
  'SC.L2-3.13.4.pagefile-clear': [['SC.L2-3.13.4[a]'], { name: 'CMMC-SharedResource-PagefileClear', clearPagefileAtShutdown: `${PF}_1`, assignments: ALL }],
  'SC.L2-3.13.11.fips-mode': [['SC.L2-3.13.11[a]'], { name: 'CMMC-FIPS-Mode', fipsAlgorithmPolicy: `${FIPS}_1`, assignments: ALL }],
  'SC.L2-3.13.9.idle-session-timeout': [['SC.L2-3.13.9[c]', 'AC.L2-3.1.11[b]'], { displayName: 'CMMC-IdleSessionTimeout', isOrganizationDefault: true, webSessionIdleTimeout: '01:00:00', idleTimeoutWithinOneHour: true }],
  'AZ-NSG-006': [['SC.L2-3.13.6[b]'], { Rules: TAGS.split(',').map((t, i) => rule(t, 200 + i)), AllowedServiceTags: TAGS }],
};

describe('DEPTH-10.4 SC batch: expected values (V94) against the simulator reads', () => {
  for (const [id, [objectives, read]] of Object.entries(GOLDEN)) {
    describe(id, () => {
      const ev = () => entry(id).verification!.evidence! as { jsonpath?: string; equals?: string; checks?: Array<{ jsonpath: string; equals?: string }> };

      it('names its objectives and carries a literal jsonpath + equals that repeats one of its checks', () => {
        for (const o of objectives) expect(entry(id).objective_ids).toContain(o);
        const { jsonpath, equals, checks } = ev();
        expect(typeof jsonpath).toBe('string');
        expect(equals).toBeDefined();
        expect(String(equals)).not.toMatch(/\{[A-Za-z_]\w*\}/);
        expect((checks ?? []).some(c => c.jsonpath === jsonpath && c.equals === equals)).toBe(true);
      });

      it('is SAT on the simulator read and NOT_SAT when the configured value is absent', () => {
        expect(verify(JSON.stringify(read), id)).toBe(true);
        const flipped = JSON.parse(JSON.stringify(read));
        flipped[String(ev().jsonpath).replace(/^\$\./, '')] = 'not-configured';
        expect(verify(JSON.stringify(flipped), id)).toBe(false);
        expect(verify('', id)).toBe(false);
      });

      it('the translator writes the expected value on each objective postcheck, and it holds on the read', () => {
        for (const objective of objectives) {
          const pcs = [{ id: `post-${objective}`, description: '', method: 'config_export', expected: '', on_fail: 'warn', control_id: objective.slice(0, objective.indexOf('[')), objective_id: objective }];
          const n = applyRegistryExpectedValues(pcs as never, [{ objective_id: objective, type: 'configure', entry_ids: [id] }] as never, new Map([[id, entry(id)]]));
          expect(n).toBe(1);
          const expected = (pcs[0] as { expected_value?: { path: string; op: 'equals'; value: unknown } }).expected_value!;
          expect(expected).toMatchObject({ path: ev().jsonpath, op: 'equals', value: ev().equals, source: 'registry' });
          expect(evaluateExpectedValue(JSON.stringify(read), expected)).toMatchObject({ found: true, passed: true });
        }
      });
    });
  }

  it('idle session timeout: a default longer than one hour reads NOT_SAT', () => {
    const long = { displayName: 'Admin center idle timeout', isOrganizationDefault: true, webSessionIdleTimeout: '1.00:00:00', idleTimeoutWithinOneHour: false };
    expect(verify(JSON.stringify(long), 'SC.L2-3.13.9.idle-session-timeout')).toBe(false);
  });

  it('the new entries take no variables (tenant-wide, no new SEC-5 placeholders) and need no cost gate (no Azure meter)', () => {
    const main = raw('cmmc-l2-commands.registry.json');
    for (const id of ['SC.L1-3.13.1.network-protection', 'SC.L2-3.13.4.pagefile-clear', 'SC.L2-3.13.11.fips-mode', 'SC.L2-3.13.9.idle-session-timeout']) {
      const e = main.find(x => x.entry_id === id)!;
      expect({ id, vars: [...e.variables_required, ...e.variables_runtime] }).toEqual({ id, vars: [] });
      for (const c of [e.set_command, e.get_command, ...e.evidence_commands]) expect(c).not.toMatch(/\{[A-Za-z_]\w*\}/);
      expect(e.cost_gate).toBeUndefined();
      expect(e.set_command).not.toMatch(/New-Az|Invoke-AzRestMethod|\baz /);
    }
  });

  it('SC.L2-3.13.2.session-lock is retired with a reason; the SC entries V98 listed are tagged', () => {
    const main = raw('cmmc-l2-commands.registry.json');
    const sl = main.find(x => x.entry_id === 'SC.L2-3.13.2.session-lock')!;
    expect(sl.retired).toBe(true);
    expect(sl.retired_reason).toMatch(/no SC\.L2-3\.13\.2 objective/);
    for (const id of ['SC.L2-3.13.4.remote-access', 'SC.L2-3.13.15.anti-spam', 'SC.L2-3.13.15.anti-spam-rule', 'SC.L2-3.13.15.outbound-spam-rule']) {
      expect({ id, n: main.find(x => x.entry_id === id)!.objective_ids.length }).toEqual({ id, n: 1 });
    }
    // PH-12 merge (LOG-PH12-R4 D1): outbound-spam also credits SI.L2-3.14.6[c] (outbound mail-flow monitoring).
    expect(main.find(x => x.entry_id === 'SC.L2-3.13.15.outbound-spam')!.objective_ids).toEqual(['SC.L2-3.13.15[a]', 'SI.L2-3.14.6[c]']);
  });

  it('the recurring boundary entries stay cost-gated (off by default): Azure Firewall, Bastion, private endpoints', () => {
    const infra = raw('infra-cmmc-l2-commands.registry.json');
    for (const id of ['AZ-FW-001', 'AZ-FW-002', 'AZ-FW-004', 'AZ-BAS-001', 'AZ-BAS-002', 'AZ-PE-001', 'AZ-PE-002']) {
      expect({ id, recurring: infra.find(x => x.entry_id === id)!.cost_gate?.recurring }).toEqual({ id, recurring: true });
    }
  });
});
