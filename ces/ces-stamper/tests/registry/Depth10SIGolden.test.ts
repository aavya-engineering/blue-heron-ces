// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// DEPTH-10.5 (PH-12 P12-R4, SI batch): the new configuring entries, checked against the reads the simulator
// returns after their SETs (tenant-stacksim src/resolvers/depth10SIGolden.test.ts proves SET then GET).
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { CommandRegistry } from '../../src/registry/CommandRegistry';
import { OutputVerificationEngine } from '../../src/core/OutputVerificationEngine';
import { evaluateExpectedValue } from '../../src/core/PostcheckRunner';
import { applyRegistryExpectedValues } from '../../src/translators/objectiveCredit';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REGISTRY_PATH = path.resolve(__dirname, '../../src/registry/cmmc-l2-commands.registry.json');

const assigned = [{ id: 'p_group-cui-1', target: { '@odata.type': '#microsoft.graph.groupAssignmentTarget', groupId: 'group-cui-1' } }];
const everyTime = { signInFrequency: { isEnabled: true, frequencyInterval: 'everyTime', authenticationType: 'primaryAndSecondaryAuthentication' } };

/** entry id -> [objectives it configures, simulator read after the SET] */
const GOLDEN: Record<string, [string[], Record<string, unknown>]> = {
  'SI.L1-3.14.1.mde-onboarding': [['SI.L1-3.14.1[b]', 'SI.L2-3.14.6[a]', 'IR.L2-3.6.1[d]', 'RA.L2-3.11.2[b]', 'RA.L2-3.11.2[c]', 'RA.L2-3.11.2[d]', 'RA.L2-3.11.3[a]', 'CM.L2-3.4.1[d]', 'CM.L2-3.4.9[c]'], { // DEPTH-10.8 adds IR.L2-3.6.1[d]; PH-12 merge (LOG-PH12-R5 diff C) adds the RA objectives; PH13-REG adds CM.L2-3.4.1[d], CM.L2-3.4.9[c]
    '@odata.type': '#microsoft.graph.windowsDefenderAdvancedThreatProtectionConfiguration', displayName: 'CMMC-MDE-Onboarding',
    allowSampleSharing: true, enableExpeditedTelemetryReporting: true, assignments: assigned,
  }],
  'SI.L2-3.14.6.defender-traffic-monitoring': [['SI.L2-3.14.6[b]', 'SI.L2-3.14.6[c]'], {
    '@odata.type': '#microsoft.graph.windows10GeneralConfiguration', displayName: 'CMMC-Defender-TrafficMonitoring',
    defenderRequireNetworkInspectionSystem: true, defenderRequireRealTimeMonitoring: true, defenderScanIncomingMail: true,
    defenderScanDownloads: true, defenderMonitorFileActivity: 'monitorAllFiles', assignments: assigned,
  }],
  'SI.L2-3.14.7.signin-risk-policy': [['SI.L2-3.14.7[b]'], {
    displayName: 'CMMC-SignInRisk-MFA', state: 'enabled',
    conditions: { users: { includeUsers: ['All'], excludeUsers: ['user-breakglass-1'] }, applications: { includeApplications: ['All'] }, clientAppTypes: ['all'], signInRiskLevels: ['high', 'medium'] },
    grantControls: { operator: 'OR', builtInControls: ['mfa'] }, sessionControls: everyTime,
  }],
  'SI.L2-3.14.7.user-risk-policy': [['SI.L2-3.14.7[b]', 'IR.L2-3.6.1[e]'], { // DEPTH-10.8 adds IR.L2-3.6.1[e]
    displayName: 'CMMC-UserRisk-Remediate', state: 'enabled',
    conditions: { users: { includeUsers: ['All'], excludeUsers: ['user-breakglass-1'] }, applications: { includeApplications: ['All'] }, clientAppTypes: ['all'], userRiskLevels: ['high'] },
    grantControls: { operator: 'AND', builtInControls: ['mfa', 'passwordChange'] }, sessionControls: everyTime,
  }],
};

const registry = CommandRegistry.load(REGISTRY_PATH);
const engine = new OutputVerificationEngine();
const entry = (id: string) => registry.allEntries.find(e => e.entry_id === id)!;
const verify = (stdout: string, id: string) =>
  engine.verify({ stdout: '', stderr: '', exitCode: 0 }, { stdout, exitCode: 0 }, { evidence: entry(id).verification!.evidence }).passed;
type Ev = { jsonpath?: string; equals?: string; checks?: Array<{ jsonpath: string; equals?: string; regex?: string; min_items?: number }> };

describe('DEPTH-10.5 SI entries against the simulator reads', () => {
  for (const [id, [objectives, read]] of Object.entries(GOLDEN)) {
    describe(id, () => {
      const ev = () => entry(id).verification!.evidence! as Ev;

      it('exists once, names its objectives, a Learn source, and a literal jsonpath + equals repeated in its checks', () => {
        expect(registry.allEntries.filter(e => e.entry_id === id)).toHaveLength(1);
        expect(entry(id).objective_ids).toEqual(objectives);
        expect(entry(id).source).toMatch(/^https:\/\/learn\.microsoft\.com\//);
        expect(entry(id).set_command.trim()).not.toBe('');
        expect(entry(id).idempotency).toBe('get-then-set');
        expect(entry(id).set_command).not.toMatch(/enabledForReportingButNotEnforced/);
        const { jsonpath, equals, checks } = ev();
        expect(typeof jsonpath).toBe('string');
        expect(String(equals)).not.toMatch(/\{[A-Za-z_]\w*\}/);
        expect((checks ?? []).some(c => c.jsonpath === jsonpath && c.equals === equals)).toBe(true);
      });

      it('is SAT on the simulator read and NOT_SAT when the configured value is absent', () => {
        expect(verify(JSON.stringify(read), id)).toBe(true);
        const flipped = JSON.parse(JSON.stringify(read));
        let node: Record<string, unknown> = flipped;
        const keys = String(ev().jsonpath).replace(/^\$\./, '').split('.');
        for (const k of keys.slice(0, -1)) node = node[k] as Record<string, unknown>;
        node[keys[keys.length - 1]] = 'not-configured';
        expect(verify(JSON.stringify(flipped), id)).toBe(false);
      });

      it('is NOT_SAT on an empty read (an empty successful read is not evidence)', () => {
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

  it('the risk policies exclude the break-glass account and target all users (DD-e)', () => {
    for (const id of ['SI.L2-3.14.7.signin-risk-policy', 'SI.L2-3.14.7.user-risk-policy']) {
      expect(entry(id).set_command).toContain("includeUsers=@('All');excludeUsers=@('{breakGlassUserId}')");
      expect(entry(id).set_command).toContain("state='enabled'");
      expect(entry(id).variables_runtime).toEqual(['breakGlassUserId']);
    }
  });

  it('a sign-in risk read with only high risk, or a user-risk read without passwordChange, is NOT_SAT', () => {
    const [, signIn] = GOLDEN['SI.L2-3.14.7.signin-risk-policy'];
    const onlyHigh = JSON.parse(JSON.stringify(signIn));
    onlyHigh.conditions.signInRiskLevels = ['high'];
    expect(verify(JSON.stringify(onlyHigh), 'SI.L2-3.14.7.signin-risk-policy')).toBe(false);
    const [, user] = GOLDEN['SI.L2-3.14.7.user-risk-policy'];
    const mfaOnly = JSON.parse(JSON.stringify(user));
    mfaOnly.grantControls = { operator: 'OR', builtInControls: ['mfa'] };
    expect(verify(JSON.stringify(mfaOnly), 'SI.L2-3.14.7.user-risk-policy')).toBe(false);
  });

  it('Safe Links (policy and rule) keep SI.L2-3.14.3 first and credit SI.L2-3.14.6[b] (inbound mail URLs)', () => {
    for (const id of ['SI.L2-3.14.3.safe-links', 'SI.L2-3.14.3.safe-links-rule']) {
      expect(entry(id).control_ids).toEqual(['SI.L2-3.14.3', 'SI.L2-3.14.6']);
      expect(entry(id).objective_ids).toEqual(['SI.L2-3.14.6[b]']);
    }
  });
});
