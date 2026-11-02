/**
 * Synthetic-customer W5 cycle 7: AU.L2-3.3.7 (internal system clocks synchronised to an authoritative
 * source) is a condition test on the Intune NTP client policy, no longer presence only on `/organization`.
 * The S1 policy body is the simulator's "S1 Windows time synchronisation (NTP)" (W5c2 sim follow-up 10).
 * The TM row is the one Muster writes on AU.L2-3.3.7: `{ path: '$.timeServer', op: 'equals', value:
 * <answered authoritative_time_source>, source: 'answered' }`.
 * Routes are read from the ces-shared SOURCE registry (the dist copy updates on the ces-shared build).
 */
import { describe, it, expect } from '@jest/globals';
import * as path from 'node:path';
import type { SignalResult } from 'ces-shared/types/signal';
import { SignalToControlMapper } from '../../../src/eo/mapping/SignalToControlMapper';
import { evaluatorRegistry, PRESENCE_ONLY_EVALUATORS, type EvaluatorContext } from '../../../src/eo/mapping/evaluators/index';

const SRC_REGISTRY = path.resolve(__dirname, '../../../../ces-shared/src/data/control-signal-registry.json');
const TS = '2026-10-28T12:00:00.000Z';
const CATALOG_ENDPOINT = '/beta/deviceManagement/configurationPolicies';
const LEGACY_ENDPOINT = '/v1.0/deviceManagement/deviceConfigurations';

const sig = (signalId: string, endpoint: string, rawData: unknown, status: SignalResult['status'] = 'success'): SignalResult =>
  ({ signalId, source: 'graph', endpoint, timestamp: TS, rawData, status } as SignalResult);
const catalog = (rows: unknown[]) => sig('configurationPolicies', CATALOG_ENDPOINT, { value: rows });
const legacy = (rows: unknown[]) => sig('deviceConfigurations', LEGACY_ENDPOINT, { value: rows });

const W32 = 'device_vendor_msft_policy_config_admx_w32time_w32time_policy';
const groupAssignments = (id: string) => [{ id: `${id}_group-1`, target: { '@odata.type': '#microsoft.graph.groupAssignmentTarget', groupId: 'group-1' } }];

/** The simulator's S1 settings-catalog NTP policy (customerHistory.ts, SIM-W4c5). */
const s1NtpPolicy = (server = 'time.windows.com,0x9', assigned = true) => ({
  id: 'sim-c5-0002', name: 'S1 Windows time synchronisation (NTP)', platforms: 'windows10', technologies: 'mdm',
  isAssigned: assigned, settingCount: 2,
  settings: [
    { id: '0', settingInstance: { '@odata.type': '#microsoft.graph.deviceManagementConfigurationChoiceSettingInstance', settingDefinitionId: `${W32}_enable_ntpclient`, choiceSettingValue: { value: `${W32}_enable_ntpclient_1`, children: [] } } },
    {
      id: '1',
      settingInstance: {
        '@odata.type': '#microsoft.graph.deviceManagementConfigurationChoiceSettingInstance',
        settingDefinitionId: `${W32}_configure_ntpclient`,
        choiceSettingValue: {
          value: `${W32}_configure_ntpclient_1`,
          children: [
            { '@odata.type': '#microsoft.graph.deviceManagementConfigurationSimpleSettingInstance', settingDefinitionId: `${W32}_configure_ntpclient_w32time_ntpclient_ntpserver`, simpleSettingValue: { '@odata.type': '#microsoft.graph.deviceManagementConfigurationStringSettingValue', value: server } },
            { '@odata.type': '#microsoft.graph.deviceManagementConfigurationChoiceSettingInstance', settingDefinitionId: `${W32}_configure_ntpclient_w32time_ntpclient_type`, choiceSettingValue: { value: `${W32}_configure_ntpclient_w32time_ntpclient_type_ntp`, children: [] } },
            { '@odata.type': '#microsoft.graph.deviceManagementConfigurationSimpleSettingInstance', settingDefinitionId: `${W32}_configure_ntpclient_w32time_ntpclient_specialpollinterval`, simpleSettingValue: { '@odata.type': '#microsoft.graph.deviceManagementConfigurationIntegerSettingValue', value: 3600 } },
          ],
        },
      },
    },
  ],
  assignments: assigned ? groupAssignments('sim-c5-0002') : [],
});
/** S1's other settings-catalog policy (no time setting). */
const s1CredentialsPolicy = {
  id: 'sim-c5-0001', name: 'S1 Credential UI hardening', platforms: 'windows10', technologies: 'mdm', isAssigned: true,
  settings: [{ id: '0', settingInstance: { '@odata.type': '#microsoft.graph.deviceManagementConfigurationChoiceSettingInstance', settingDefinitionId: 'device_vendor_msft_policy_config_credentialsui_disablepasswordreveal', choiceSettingValue: { value: 'device_vendor_msft_policy_config_credentialsui_disablepasswordreveal_1', children: [] } } }],
  assignments: groupAssignments('sim-c5-0001'),
};

const tmRow = (value: string): EvaluatorContext => ({ expected: [{ path: '$.timeServer', op: 'equals', value, source: 'answered' }] });
const evaluate = (signals: SignalResult[], ctx?: EvaluatorContext) => evaluatorRegistry.timeSourceEvaluator(signals, ctx);

describe('W5c7 AU.L2-3.3.7 time synchronisation (timeSourceEvaluator)', () => {
  it('is no longer declared presence only (16 remain)', () => {
    expect(PRESENCE_ONLY_EVALUATORS.has('timeSourceEvaluator')).toBe(false);
    expect(evaluatorRegistry.timeSourceEvaluator.presenceOnly).toBeUndefined();
    expect(PRESENCE_ONLY_EVALUATORS.size).toBe(16);
  });

  it('the source registry routes the settings catalog and the device configurations to AU.L2-3.3.7', () => {
    const entry = new SignalToControlMapper(SRC_REGISTRY).entryFor('AU.L2-3.3.7')!;
    expect(entry.evaluator).toBe('timeSourceEvaluator');
    expect(entry.signals.map((s: { endpoint: string }) => s.endpoint)).toEqual(['/deviceManagement/configurationPolicies', '/deviceManagement/deviceConfigurations']);
  });

  it('S1 shape, no TM row: met, any non-empty server, labelled with the requirement default', () => {
    const v = evaluate([catalog([s1CredentialsPolicy, s1NtpPolicy()]), legacy([])]);
    expect(v.status).toBe('met');
    expect(v.evidence).toMatch(/^Time synchronisation: /);
    expect(v.evidence).toContain("settings-catalog policy 'S1 Windows time synchronisation (NTP)' sets NTP server 'time.windows.com,0x9'");
    expect(v.evidence).toContain('assigned to a group');
    expect(v.evidence).toContain('requirement default, no organisation value');
  });

  it('S1 shape with the TM row (answered time.windows.com): met, naming the organisation value', () => {
    const v = evaluate([catalog([s1CredentialsPolicy, s1NtpPolicy()])], tmRow('time.windows.com'));
    expect(v.status).toBe('met');
    expect(v.evidence).toContain("equals the organisation's authoritative time source 'time.windows.com' (organisation value: TM expected value (answered))");
  });

  it('S1 shape through the mapper (source registry, TM row on the control): met', () => {
    const tm = { tenant_manifest: { normative_controls: [{ control_id: 'AU.L2-3.3.7', verification: [{ expected_value: { path: '$.timeServer', op: 'equals', value: 'time.windows.com', source: 'answered' } }] }] } };
    const signals = [catalog([s1CredentialsPolicy, s1NtpPolicy()]), legacy([]), sig('organization', '/organization', { value: [{ id: 'org-1' }] })];
    const a = new SignalToControlMapper(SRC_REGISTRY).mapSignalsToControls(signals, evaluatorRegistry, { tenantManifest: tm })
      .find(x => x.control_id === 'AU.L2-3.3.7')!;
    expect(a.status).toBe('met');
    expect(a.signals.map(s => s.signalId).sort()).toEqual(['configurationPolicies', 'deviceConfigurations']);
    expect(a.implementation_narrative).toContain('organisation value: TM expected value (answered)');
  });

  it('S2 shape before Stamper (no settings-catalog policy, no device configuration): not met', () => {
    const v = evaluate([catalog([]), legacy([])]);
    expect(v.status).toBe('not_met');
    expect(v.evidence).toBe('Time synchronisation: 0 settings-catalog policy(ies) and 0 device configuration(s) read; none sets the Windows NTP client server (no time-synchronisation policy)');
  });

  it('a policy setting a different server than the answer: not met, naming both', () => {
    const v = evaluate([catalog([s1NtpPolicy('pool.ntp.example,0x8')])], tmRow('time.windows.com'));
    expect(v.status).toBe('not_met');
    expect(v.evidence).toContain("sets NTP server 'pool.ntp.example,0x8'");
    expect(v.evidence).toContain("none equals the organisation's authoritative time source 'time.windows.com'");
  });

  it('the NTP policy assigned to no group: not met, "assigned to no group"', () => {
    const v = evaluate([catalog([s1NtpPolicy(undefined, false)])]);
    expect(v.status).toBe('not_met');
    expect(v.evidence).toContain("settings-catalog policy 'S1 Windows time synchronisation (NTP)' sets NTP server 'time.windows.com,0x9'");
    expect(v.evidence).toContain('assigned to no group');
  });

  it('no read reached the control: not assessed, the reads printed', () => {
    const v = evaluate([sig('configurationPolicies', CATALOG_ENDPOINT, null, 'error')]);
    expect(v.status).toBe('not_assessed');
    expect(v.evidence).toContain("read of 'configurationPolicies' failed");
    expect(v.evidence).toContain("'deviceConfigurations' was not read");
  });

  it('device configurations read but the settings catalog not read (run 20 shape): not assessed, not a negative', () => {
    const v = evaluate([legacy([{ id: 'dc-2', displayName: 'Windows 10 restrictions', passwordRequired: true, assignments: groupAssignments('dc-2') }])]);
    expect(v.status).toBe('not_assessed');
    expect(v.evidence).toContain('the settings-catalog policies (where the Windows NTP client policy is configured) were not read');
    expect(v.evidence).toContain("'configurationPolicies' was not read");
  });

  it('settings-catalog policies read without their settings: not assessed', () => {
    const { settings: _drop, ...bare } = s1NtpPolicy();
    const v = evaluate([catalog([bare])]);
    expect(v.status).toBe('not_assessed');
    expect(v.evidence).toContain('$expand=settings');
    const withLegacy = evaluate([catalog([bare]), legacy([{ id: 'dc-2', displayName: 'Windows 10 restrictions', passwordRequired: true, assignments: groupAssignments('dc-2') }])]);
    expect(withLegacy.status).toBe('not_assessed');
    expect(withLegacy.evidence).toContain('$expand=settings');
  });

  it('legacy custom (OMA-URI) configuration of the W32Time NTP client: met when assigned', () => {
    const custom = {
      id: 'dc-1', displayName: 'Legacy NTP (OMA-URI)', '@odata.type': '#microsoft.graph.windows10CustomConfiguration',
      omaSettings: [{ '@odata.type': '#microsoft.graph.omaSettingString', omaUri: './Device/Vendor/MSFT/Policy/Config/ADMX_W32Time/W32Time_Policy_Configure_NTPClient', value: '<enabled/><data id="W32TIME_NtpServer" value="time.windows.com,0x9"/><data id="W32TIME_Type" value="NTP"/>' }],
      assignments: groupAssignments('dc-1'),
    };
    const v = evaluate([catalog([]), legacy([custom])], tmRow('time.windows.com'));
    expect(v.status).toBe('met');
    expect(v.evidence).toContain("device configuration 'Legacy NTP (OMA-URI)' sets NTP server 'time.windows.com,0x9'");
  });
});
