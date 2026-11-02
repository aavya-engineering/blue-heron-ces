// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// DEPTH-10.0 (PH-11, P11-REG): ten configuring entries carry a literal top-level jsonpath + equals, so the
// translator gives their objectives' postchecks an expected value (applyRegistryExpectedValues, V94). Each
// literal repeats one of the entry's own checks, so the entry's SAT / NOT_SAT is unchanged. The reads below are
// the tenant-stacksim answers to each GET after its SET in round R-F7 (S1), trimmed to the fields that matter.
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { CommandRegistry } from '../../src/registry/CommandRegistry';
import { OutputVerificationEngine } from '../../src/core/OutputVerificationEngine';
import { evaluateExpectedValue } from '../../src/core/PostcheckRunner';
import { applyRegistryExpectedValues } from '../../src/translators/objectiveCredit';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REGISTRY_PATH = path.resolve(__dirname, '../../src/registry/cmmc-l2-commands.registry.json');

/** entry id -> [objective it configures, simulator read after the SET] */
const GOLDEN: Record<string, [string, unknown]> = {
  'AC.L2-3.1.4.pim-approval': ['AC.L2-3.1.4[c]', { id: 'Approval_EndUser_Assignment', setting: { isApprovalRequired: true } }],
  'AC.L2-3.1.11.session-timeout': ['AC.L2-3.1.11[b]', { id: 'CMMC-SessionTimeout', sessionControls: { signInFrequency: { isEnabled: true, type: 'hours', value: 8 }, persistentBrowser: { isEnabled: true, mode: 'never' } } }],
  'SC.L2-3.13.8.tls-enforce': ['SC.L2-3.13.8[c]', { AllowLegacyTLSClients: false }],
  'AC.L2-3.1.21.block-storage': ['AC.L2-3.1.21[c]', { displayName: 'S1-Block-Removable-Storage', storageBlockRemovableStorage: true, assignments: [{ id: 'a1' }] }],
  'CM.L2-3.4.6.least-functionality': ['CM.L2-3.4.6[b]', { displayName: 'CMMC-LeastFunctionality', cortanaBlocked: true, microsoftAccountSignInAssistantSettings: 'disabled', assignments: [{ id: 'a1' }] }],
  'IA.L2-3.5.5.disable-inactive': ['IA.L2-3.5.6[b]', { enabledCount: 52, staleNonExcludedEnabledCount: 0, exclusionsEnabled: true }],
  'IR.L2-3.6.1.atp-enable': ['IR.L2-3.6.1[c]', { EnableATPForSPOTeamsODB: true }],
  'IR.L2-3.6.1.malware-filter': ['IR.L2-3.6.1[c]', { EnableFileFilter: true }],
  'SC.L2-3.13.12.camera-block': ['SC.L2-3.13.12[c]', { displayName: 'CMMC-CollaborativeDeviceBlock', cameraBlocked: true, assignments: [{ id: 'a1' }] }],
  'SC.L2-3.13.14.teams-external': ['SC.L2-3.13.14[a]', { EnableFederationAccess: false, EnableTeamsConsumerAccess: false, EnableTeamsConsumerInbound: false }],
};

const registry = CommandRegistry.load(REGISTRY_PATH);
const engine = new OutputVerificationEngine();
const entry = (id: string) => registry.allEntries.find(e => e.entry_id === id)!;
const verify = (stdout: string, id: string) =>
  engine.verify({ stdout: '', stderr: '', exitCode: 0 }, { stdout, exitCode: 0 }, { evidence: entry(id).verification!.evidence }).passed;

describe('DEPTH-10.0 registry expected values (V94) against the simulator reads', () => {
  for (const [id, [objective, read]] of Object.entries(GOLDEN)) {
    describe(id, () => {
      const ev = () => entry(id).verification!.evidence! as { jsonpath?: string; equals?: string; checks?: Array<{ jsonpath: string; equals?: string }> };

      it('names the objective and carries a literal jsonpath + equals that repeats one of its checks', () => {
        expect(entry(id).objective_ids).toContain(objective);
        const { jsonpath, equals, checks } = ev();
        expect(typeof jsonpath).toBe('string');
        expect(equals).toBeDefined();
        expect(String(equals)).not.toMatch(/\{[A-Za-z_]\w*\}/);
        expect((checks ?? []).some(c => c.jsonpath === jsonpath && c.equals === equals)).toBe(true);
      });

      it('the entry is SAT on the simulator read and NOT_SAT when the configured value is absent', () => {
        expect(verify(JSON.stringify(read), id)).toBe(true);
        const { jsonpath } = ev();
        const flipped = JSON.parse(JSON.stringify(read));
        let node: Record<string, unknown> = flipped;
        const keys = String(jsonpath).replace(/^\$\./, '').split('.');
        for (const k of keys.slice(0, -1)) node = node[k] as Record<string, unknown>;
        node[keys[keys.length - 1]] = 'not-configured';
        expect(verify(JSON.stringify(flipped), id)).toBe(false);
      });

      it('the translator writes the expected value on the objective postcheck, and it holds on the read', () => {
        const pcs = [{ id: `post-${objective}`, description: '', method: 'config_export', expected: '', on_fail: 'warn', control_id: objective.slice(0, objective.indexOf('[')), objective_id: objective }];
        const n = applyRegistryExpectedValues(pcs as never, [{ objective_id: objective, type: 'configure', entry_ids: [id] }] as never, new Map([[id, entry(id)]]));
        expect(n).toBe(1);
        const expected = (pcs[0] as { expected_value?: { path: string; op: 'equals'; value: unknown } }).expected_value!;
        expect(expected).toMatchObject({ path: ev().jsonpath, op: 'equals', value: ev().equals, source: 'registry' });
        expect(evaluateExpectedValue(JSON.stringify(read), expected)).toMatchObject({ found: true, passed: true });
      });
    });
  }
});
