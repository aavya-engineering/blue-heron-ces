// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// DEPTH-10.1 (AU) and DEPTH-10.2 (IA), PH-12 agent P12-R1. Each configuring entry this batch adds or
// re-aims names its objectives, carries a literal top-level jsonpath + equals that repeats one of its
// own checks (so the translator gives the objective's postcheck an expected value, V94), is SAT on the
// simulator read after its SET and NOT_SAT when the configured value is absent, and gives its
// objectives `configure` coverage once planned. The reads are tenant-stacksim's answers to each GET
// after its SET (tenant-stacksim tests/integration/depth10-r1-pwsh.test.ts), trimmed to the fields that matter.
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { CommandRegistry } from '../../src/registry/CommandRegistry';
import { OutputVerificationEngine } from '../../src/core/OutputVerificationEngine';
import { evaluateExpectedValue } from '../../src/core/PostcheckRunner';
import { applyRegistryExpectedValues, buildObjectiveCoverage } from '../../src/translators/objectiveCredit';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REGISTRY_PATH = path.resolve(__dirname, '../../src/registry/cmmc-l2-commands.registry.json');

/** entry id -> [objectives it configures, simulator read after the SET] */
const GOLDEN: Record<string, [string[], unknown]> = {
  'AU.L2-3.3.2.mailbox-audit-default': [['AU.L2-3.3.2[b]'], { AuditDisabled: false }],
  'AU.L2-3.3.4.audit-config-alert': [['AU.L2-3.3.4[a]', 'AU.L2-3.3.4[b]', 'AU.L2-3.3.4[c]'], { Name: 'CMMC-Audit-Logging-Changed', Disabled: false, Severity: 'High', Operation: ['Set-AdminAuditLogConfig'], NotifyUser: ['isso@s3-def.simtenant.onmicrosoft.us'] }],
  'AU.L2-3.3.8.compliance-admin-pim-expiry': [['AU.L2-3.3.8[a]', 'AU.L2-3.3.8[d]', 'AU.L2-3.3.8[e]', 'AU.L2-3.3.8[f]', 'AU.L2-3.3.9[b]'], { '@odata.type': '#microsoft.graph.unifiedRoleManagementPolicyExpirationRule', id: 'Expiration_Admin_Assignment', isExpirationRequired: true, maximumDuration: 'P180D' }],
  'IA.L2-3.5.3.ca-mfa-all-users': [['IA.L2-3.5.3[c]', 'IA.L2-3.5.3[d]', 'IA.L1-3.5.2[a]'], { id: 'CMMC-Require-MFA-All-Users', displayName: 'CMMC-Require-MFA-All-Users', state: 'enabled', grantControls: { builtInControls: ['mfa'], operator: 'OR' }, conditions: { clientAppTypes: ['all'], users: { includeUsers: ['All'], excludeUsers: ['user-5'] }, applications: { includeApplications: ['All'] } } }],
  'IA.L2-3.5.3.whfb-tenant': [['IA.L2-3.5.3[b]'], { id: 'sim-tenant-muster-partial_DefaultWindowsHelloForBusiness', state: 'enabled', pinMinimumLength: 6, securityDeviceRequired: true }],
  'IA.L1-3.5.1.app-consent-restrict': [['IA.L1-3.5.1[b]'], { id: 'authorizationPolicy', allowedToCreateApps: false, userConsentPolicies: 0 }],
  'IA.L1-3.5.1.ca-compliant-device': [['IA.L1-3.5.1[c]', 'IA.L1-3.5.2[c]'], { id: 'CMMC-Require-Compliant-Device-All-Users', displayName: 'CMMC-Require-Compliant-Device-All-Users', state: 'enabled', grantControls: { builtInControls: ['compliantDevice', 'domainJoinedDevice'], operator: 'OR' }, conditions: { clientAppTypes: ['all'], users: { includeUsers: ['All'], excludeUsers: ['user-5'] }, applications: { includeApplications: ['All'] } } }],
  'IA.L2-3.5.10.credential-guard': [['IA.L2-3.5.10[a]'], { id: 'deviceManagementConfigurationPolicy-1', name: 'CMMC-Credential-Guard', platforms: 'windows10', vbs: '1', lsaCfgFlags: '1', wdigest: '0', assignments: [{ id: 'deviceManagementConfigurationPolicy-1_allDevicesAssignmentTarget' }] }],
  'IA.L2-3.5.7.password-protection': [['IA.L2-3.5.7[c]'], { id: '53530000-005e-4000-8000-000000000001', displayName: 'Password Rule Settings', enableBannedPasswordCheck: 'True', hasBannedPasswordList: true }],
};


/** Existing entries this batch only tags (objective_ids added; commands and verification unchanged). */
const TAGGED: Record<string, string[]> = {
  'AU.L2-3.3.1.org-customization': ['AU.L2-3.3.1[c]'],
  'AU.L2-3.3.3.sentinel-connector': ['AU.L2-3.3.3[c]'],
  'IA.L2-3.5.3.mfa-authenticator': ['IA.L2-3.5.3[c]', 'IA.L2-3.5.3[d]'],
  'IA.L2-3.5.3.fido2-enable': ['IA.L2-3.5.3[c]', 'IA.L2-3.5.3[d]'],
  'IA.L2-3.5.8.password-reuse': ['IA.L2-3.5.8[b]'],
  'IA.L2-3.5.8.password-policy-evidence': ['IA.L2-3.5.8[b]'],
  'IA.L2-3.5.10.cert-auth': ['IA.L2-3.5.4[a]'],
  'IA.L2-3.5.11.branding': ['IA.L2-3.5.11[a]'],
};

const registry = CommandRegistry.load(REGISTRY_PATH);
const engine = new OutputVerificationEngine();
const entry = (id: string) => registry.allEntries.find(e => e.entry_id === id)!;
const verify = (stdout: string, id: string) =>
  engine.verify({ stdout: '', stderr: '', exitCode: 0 }, { stdout, exitCode: 0 }, { evidence: entry(id).verification!.evidence }).passed;

describe('DEPTH-10.1/10.2 (P12-R1) configuring entries against the simulator reads', () => {
  for (const [id, [objectives, read]] of Object.entries(GOLDEN)) {
    describe(id, () => {
      const ev = () => entry(id).verification!.evidence! as { jsonpath?: string; equals?: string; checks?: Array<{ jsonpath: string; equals?: string }> };

      it('is a configuring entry that names its objectives, with a literal jsonpath + equals repeated in its checks', () => {
        expect(entry(id).set_command.trim()).not.toBe('');
        expect(entry(id).manual_only).toBe(false);
        expect(entry(id).source).toMatch(/^https:\/\/learn\.microsoft\.com\//);
        expect(entry(id).objective_ids).toEqual(objectives);
        const { jsonpath, equals, checks } = ev();
        expect(typeof jsonpath).toBe('string');
        expect(equals).toBeDefined();
        expect(String(equals)).not.toMatch(/\{[A-Za-z_]\w*\}/);
        expect((checks ?? []).some(c => c.jsonpath === jsonpath && c.equals === equals)).toBe(true);
        expect(entry(id).set_command).not.toMatch(/enabledForReportingButNotEnforced/);
        expect(entry(id).cost_gate).toBeUndefined();
      });

      it('is SAT on the simulator read and NOT_SAT when the configured value is absent', () => {
        expect(verify(JSON.stringify(read), id)).toBe(true);
        const flipped = JSON.parse(JSON.stringify(read));
        const keys = String(ev().jsonpath).replace(/^\$\./, '').split('.');
        let node: Record<string, unknown> = flipped;
        for (const k of keys.slice(0, -1)) node = node[k] as Record<string, unknown>;
        node[keys[keys.length - 1]] = 'not-configured';
        expect(verify(JSON.stringify(flipped), id)).toBe(false);
      });

      it('once planned, its objectives are `configure` and each postcheck carries the expected value, which holds on the read', () => {
        const e = entry(id);
        const task = {
          id: `step_task_${e.control_ids[0]}`, type: 'policy', priority: 'p2', depends_on: [], inputs: [], outputs: [], idempotency: 'safe', rollback: { strategy: 'none' },
          controls: [e.control_ids[0]],
          action: { engine: e.engine, command: '', args: { _directive: 'implement', _sub_commands: [{ id: e.entry_id, set_command: e.set_command, get_command: e.get_command }] } },
        };
        const coverage = buildObjectiveCoverage([task] as never, new Map([[id, e]]));
        for (const o of objectives) expect(coverage.find(r => r.objective_id === o)).toMatchObject({ type: 'configure', entry_ids: [id] });
        const pcs = objectives.map(o => ({ id: `post-${o}`, description: '', method: 'config_export', expected: '', on_fail: 'warn', control_id: o.slice(0, o.indexOf('[')), objective_id: o }));
        expect(applyRegistryExpectedValues(pcs as never, coverage, new Map([[id, e]]))).toBe(objectives.length);
        for (const pc of pcs as Array<{ expected_value?: { path: string; op: 'equals'; value: unknown } }>) {
          expect(pc.expected_value).toMatchObject({ path: ev().jsonpath, op: 'equals', value: ev().equals, source: 'registry' });
          expect(evaluateExpectedValue(JSON.stringify(read), pc.expected_value!)).toMatchObject({ found: true, passed: true });
        }
      });
    });
  }

  it('cert-auth now also names IA.L2-3.5.4 (replay-resistant), its primary control stays IA.L2-3.5.10', () => {
    expect(entry('IA.L2-3.5.10.cert-auth').control_ids).toEqual(['IA.L2-3.5.10', 'IA.L2-3.5.4']);
  });

  it('tagged entries carry exactly the objectives this batch gives them', () => {
    for (const [id, objectives] of Object.entries(TAGGED)) expect({ id, objective_ids: entry(id).objective_ids }).toEqual({ id, objective_ids: objectives });
  });

  it('every AU and IA entry of the main registry carries at least one objective id (V98), except the ones listed as cannot-tie', () => {
    const untagged = registry.allEntries
      .filter(e => e.control_ids.some(c => /^(AU|IA)\./.test(c)))
      .filter(e => (e.objective_ids ?? []).length === 0)
      .map(e => e.entry_id);
    expect(untagged).toEqual([]);
  });

  it('the re-aimed password-protection entry configures (a SET that always runs, not taken as a creation)', () => {
    const e = entry('IA.L2-3.5.7.password-protection');
    expect(e.idempotency).toBe('get-then-set');
    expect(e.set_command).toContain("-Method PATCH");
    expect(/Invoke-MgGraphRequest\s[^|]*-Method\s+POST/i.test(e.set_command)).toBe(false);
    expect(/^New-|^New[A-Z]|^try\s*\{\s*New-|^\$\w+\s*=.*New-/.test(e.set_command.trim())).toBe(false);
  });
});
