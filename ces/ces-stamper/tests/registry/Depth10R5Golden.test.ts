// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// DEPTH-10.6..10.11 (PH-12, P12-R5): the new and re-aimed configuring entries of the CM, MA, PS and RA+CA batches.
// Each carries a literal top-level jsonpath + equals that repeats one of its checks, so the translator gives its
// objectives' postchecks an expected value (applyRegistryExpectedValues, V94). The reads below are the
// tenant-stacksim answers to each GET after its SET (tenant-stacksim src/resolvers/depth10R5Resolvers.test.ts,
// s1-mach and muster-partial), trimmed to the fields that matter. ces-strategy docs/context/finish/LOG-PH12-R5.md.
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { CommandRegistry } from '../../src/registry/CommandRegistry';
import { OutputVerificationEngine } from '../../src/core/OutputVerificationEngine';
import { evaluateExpectedValue } from '../../src/core/PostcheckRunner';
import { applyRegistryExpectedValues } from '../../src/translators/objectiveCredit';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REGISTRY_PATH = path.resolve(__dirname, '../../src/registry/cmmc-l2-commands.registry.json');

const assigned = { assignments: [{ id: 'cfg_group-1', target: { '@odata.type': '#microsoft.graph.groupAssignmentTarget', groupId: 'group-1' } }] };
const fw = { firewallEnabled: 'allowed', inboundConnectionsBlocked: true };

/** entry id -> [objectives it configures, simulator read after the SET] */
const GOLDEN: Record<string, [string[], unknown]> = {
  // DEPTH-10.6 CM
  'CM.L2-3.4.1.device-cleanup': [['CM.L2-3.4.1[f]'], { id: 'managedDeviceCleanupRule-1', displayName: 'CMMC-Device-Cleanup-90d', deviceCleanupRulePlatformType: 'all', deviceInactivityBeforeRetirementInDays: 90 }],
  'CM.L2-3.4.7.firewall-ports': [['CM.L2-3.4.7[i]'], { id: 'cfg', '@odata.type': '#microsoft.graph.windows10EndpointProtectionConfiguration', displayName: 'CMMC-Firewall-PortPolicy', firewallBlockStatefulFTP: true, firewallProfileDomain: fw, firewallProfilePrivate: fw, firewallProfilePublic: fw, ...assigned }],
  'CM.L2-3.4.7.legacy-protocols': [['CM.L2-3.4.7[l]'], { SmtpClientAuthenticationDisabled: true }],
  'CM.L2-3.4.7.nonessential-functions': [['CM.L2-3.4.7[f]'], { id: 'cfg', displayName: 'CMMC-NonEssential-Functions', windowsSpotlightBlockConsumerSpecificFeatures: true, gameDvrBlocked: true, ...assigned }],
  'CM.L2-3.4.7.nonessential-services': [['CM.L2-3.4.7[o]'], { id: 'cfg', displayName: 'CMMC-NonEssential-Services', connectedDevicesServiceBlocked: true, internetSharingBlocked: true, ...assigned }],
  'CM.L2-3.4.8.app-control': [['CM.L2-3.4.8[b]', 'CM.L2-3.4.8[c]'], { id: 'cfg', displayName: 'CMMC-AppControl-AppLocker', appLockerApplicationControl: 'enforceComponentsAndStoreApps', ...assigned }],
  // DEPTH-10.9 MA
  'MA.L2-3.7.5.session-terminate': [['MA.L2-3.7.5[b]'], { id: 'caPolicy-9', displayName: 'CMMC-AdminSession-Terminate', state: 'enabled', sessionControls: { signInFrequency: { value: 4, type: 'hours', isEnabled: true }, persistentBrowser: { mode: 'never', isEnabled: true } } }],
  // DEPTH-10.10 PS
  'PS.L2-3.9.2.access-review': [['PS.L2-3.9.2[c]'], { id: 'accessReviewDefinition-1', displayName: 'CMMC-CUI-Group-Access-Review', scope: { query: '/groups/group-1/transitiveMembers', queryType: 'MicrosoftGraph' }, settings: { defaultDecisionEnabled: true, defaultDecision: 'Deny', autoApplyDecisionsEnabled: true, recurrence: { pattern: { type: 'absoluteMonthly', interval: 3 } } } }],
  // V94 fixes (existing entries; the read is the R-F9 S1 one, so SAT is unchanged)
  'CM.L2-3.4.7.wdac': [['CM.L2-3.4.7[c]'], { id: 'cfg', displayName: 'CMMC-AppControl-Policy', smartScreenBlockPromptOverride: true, smartScreenBlockPromptOverrideForFiles: true, appsAllowTrustedAppsSideloading: 'blocked', ...assigned }],
  'MA.L2-3.7.1.update-ring': [['MA.L2-3.7.1[a]'], { id: 'cfg', '@odata.type': '#microsoft.graph.windowsUpdateForBusinessConfiguration', displayName: 'CMMC-UpdateRing-Standard', qualityUpdatesDeferralPeriodInDays: 0, featureUpdatesDeferralPeriodInDays: 14, automaticUpdateMode: 'autoInstallAndRebootAtScheduledTime', ...assigned }],
  'CM.L2-3.4.9.install-control': [['CM.L2-3.4.9[b]'], { id: 'cfg', displayName: 'CMMC-InstallControl-Policy', appsAllowTrustedAppsSideloading: 'blocked', developerUnlockSetting: 'blocked', ...assigned }],
};

const registry = CommandRegistry.load(REGISTRY_PATH);
const engine = new OutputVerificationEngine();
const entry = (id: string) => registry.allEntries.find(e => e.entry_id === id)!;
const verify = (stdout: string, id: string) =>
  engine.verify({ stdout: '', stderr: '', exitCode: 0 }, { stdout, exitCode: 0 }, { evidence: entry(id).verification!.evidence }).passed;

describe('DEPTH-10.6..10.11 (P12-R5) registry expected values against the simulator reads', () => {
  for (const [id, [objectives, read]] of Object.entries(GOLDEN)) {
    describe(id, () => {
      const ev = () => entry(id).verification!.evidence! as { jsonpath?: string; equals?: string; checks?: Array<{ jsonpath: string; equals?: string }> };

      it('is a configuring entry naming its objectives, with a source, and a literal jsonpath + equals that repeats one of its checks', () => {
        expect(entry(id)).toBeDefined();
        expect(entry(id).set_command.trim()).not.toBe('');
        expect(entry(id).manual_only).toBe(false);
        expect(entry(id).source).toMatch(/^https:\/\/learn\.microsoft\.com\//);
        for (const o of objectives) expect(entry(id).objective_ids).toContain(o);
        const { jsonpath, equals, checks } = ev();
        expect(typeof jsonpath).toBe('string');
        expect(equals).toBeDefined();
        expect(String(equals)).not.toMatch(/\{[A-Za-z_]\w*\}/);
        expect((checks ?? []).some(c => c.jsonpath === jsonpath && c.equals === equals)).toBe(true);
      });

      it('is SAT on the simulator read and NOT_SAT when the configured value is absent', () => {
        expect(verify(JSON.stringify(read), id)).toBe(true);
        const { jsonpath } = ev();
        const flipped = JSON.parse(JSON.stringify(read));
        let node: Record<string, unknown> = flipped;
        const keys = String(jsonpath).replace(/^\$\./, '').split('.');
        for (const k of keys.slice(0, -1)) node = node[k] as Record<string, unknown>;
        node[keys[keys.length - 1]] = 'not-configured';
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

  it('CM.L2-3.4.8.app-protection-evidence no longer reads the operator machine (Get-MpPreference) and names CM.L2-3.4.8[c]', () => {
    const e = entry('CM.L2-3.4.8.app-protection-evidence');
    expect([e.get_command, ...e.evidence_commands].join('\n')).not.toMatch(/Get-MpPreference/);
    expect(e.objective_ids).toEqual(['CM.L2-3.4.8[c]']);
  });

  it('CM.L2-3.4.8.detected-apps keeps CM.L2-3.4.8 as its primary control (its task does not move)', () => {
    expect(entry('CM.L2-3.4.8.detected-apps').control_ids[0]).toBe('CM.L2-3.4.8');
  });
});
