/**
 * Synthetic-customer W5 cycle 2, part 2.
 * Item 2 (EO-2): the settings-catalog read (`configurationPolicies`, `$expand=settings`) reaches the
 * evaluators of the controls a Stamper settings-catalog entry configures, and each tests the settings
 * that entry deploys (definition ids and choice values):
 *   CM.L2-3.4.2.asr-rules           -> CM.L2-3.4.2 (asrRulesEvaluator; legacy deviceConfigurations kept, either decides)
 *   SC.L1-3.13.1.endpoint-firewall  -> SC.L1-3.13.1, SC.L1-3.13.5, SC.L2-3.13.6
 * Item 3 (EO-6): the deleted-users read reaches IA.L2-3.5.5 (inactiveAccountsEvaluator, signal `deletedUsers`).
 * Routes are read from the ces-shared SOURCE registry (the dist copy updates on the ces-shared build).
 * Fixture ids are simulator-style; the policy bodies are the ones Stamper POSTs.
 */
import { describe, it, expect } from '@jest/globals';
import * as path from 'node:path';
import type { SignalResult } from 'ces-shared/types/signal';
import { SignalToControlMapper } from '../../../src/eo/mapping/SignalToControlMapper';
import { evaluatorRegistry, PRESENCE_ONLY_EVALUATORS } from '../../../src/eo/mapping/evaluators/index';
import { ASR_RULES_GROUP, ASR_RULES_SETTINGS } from '../../../src/eo/mapping/evaluators/cm-evaluators';
import { FIREWALL_SETTINGS } from '../../../src/eo/mapping/evaluators/sc-evaluators';
import { ComplianceSignalFetcher, DELETED_USERS_URI, DELETED_USERS_ENDPOINT } from '../../../src/eo/ingestion/ComplianceSignalFetcher';
import { NarrativeNegationGuard } from '../../../src/eo/ssp/NarrativeNegationGuard';

const SRC_REGISTRY = path.resolve(__dirname, '../../../../ces-shared/src/data/control-signal-registry.json');
const TS = '2026-10-28T12:00:00.000Z';

const sig = (signalId: string, endpoint: string, rawData: unknown, status: SignalResult['status'] = 'success'): SignalResult =>
  ({ signalId, source: 'graph', endpoint, timestamp: TS, rawData, status } as SignalResult);
const catalog = (rows: unknown[]) => sig('configurationPolicies', '/deviceManagement/configurationPolicies', { value: rows });
const catalogError = () => sig('configurationPolicies', '/deviceManagement/configurationPolicies', null, 'error');
const legacy = (rows: unknown[]) => sig('deviceConfigurations', '/deviceManagement/deviceConfigurations', rows);
const ca = () => sig('conditionalAccess', '/identity/conditionalAccess/policies', { value: [{ id: 'ca-1', displayName: 'CMMC-Require-MFA', state: 'enabled' }] });

const choice = (def: string, value: string) => ({
  '@odata.type': '#microsoft.graph.deviceManagementConfigurationSetting',
  settingInstance: { '@odata.type': '#microsoft.graph.deviceManagementConfigurationChoiceSettingInstance', settingDefinitionId: def, choiceSettingValue: { value } },
});
const firewallPolicy = (override: Record<string, string> = {}, drop: string[] = []) => ({
  id: 'deviceManagementConfigurationPolicy-2', name: 'CMMC-Firewall-Policy', platforms: 'windows10', technologies: 'mdm,microsoftSense',
  settings: FIREWALL_SETTINGS.filter(([d]) => !drop.includes(d)).map(([d, v]) => choice(d, override[d] ?? v)),
});
const asrPolicy = (children: unknown = ASR_RULES_SETTINGS.map(([d, v]) => ({
  '@odata.type': '#microsoft.graph.deviceManagementConfigurationChoiceSettingInstance', settingDefinitionId: d, choiceSettingValue: { value: v, children: [] },
}))) => ({
  id: 'deviceManagementConfigurationPolicy-3', name: 'CMMC-ASR-Rules', platforms: 'windows10', technologies: 'mdm',
  settings: [{ settingInstance: { '@odata.type': '#microsoft.graph.deviceManagementConfigurationGroupSettingCollectionInstance', settingDefinitionId: ASR_RULES_GROUP, groupSettingCollectionValue: [{ children }] } }],
});
const credentialUi = {
  id: 'deviceManagementConfigurationPolicy-1', name: 'S1 Windows 11 credential UI', platforms: 'windows10', technologies: 'mdm',
  settings: [choice('device_vendor_msft_policy_config_credentialsui_disablepasswordreveal', 'device_vendor_msft_policy_config_credentialsui_disablepasswordreveal_1')],
};

describe('EO-2 routes (ces-shared source registry, flagged contract change)', () => {
  const mapper = new SignalToControlMapper(SRC_REGISTRY);
  // W5 cycle 3: through the mapper an Intune object credits only when assigned, so these carry one assignment.
  const assigned = <T extends object>(o: T) => ({ ...o, assignments: [{ id: 'a-1', target: { '@odata.type': '#microsoft.graph.groupAssignmentTarget', groupId: 'group-cui' } }] });
  const all = [catalog([credentialUi, firewallPolicy(), asrPolicy()].map(assigned)), legacy([assigned({ id: 'dc-1', displayName: 'Legacy' })]), ca(),
    sig('directoryUsers', '/users', { value: [] }), sig('deletedUsers', DELETED_USERS_ENDPOINT, { value: [] })];
  const byId = new Map(mapper.mapSignalsToControls(all, evaluatorRegistry).map(a => [a.control_id, a]));

  it.each([
    ['CM.L2-3.4.2', ['deviceConfigurations', 'configurationPolicies']],
    ['SC.L1-3.13.1', ['configurationPolicies', 'deviceConfigurations', 'conditionalAccess']], // W5 cycle 3: + legacy firewall route
    ['SC.L1-3.13.5', ['configurationPolicies', 'deviceConfigurations', 'conditionalAccess']], // W5 cycle 3: + legacy firewall route
    ['SC.L2-3.13.6', ['configurationPolicies', 'deviceConfigurations', 'conditionalAccess']], // W5 cycle 3: + legacy firewall route
    ['IA.L2-3.5.5', ['deletedUsers', 'directoryUsers']],
  ])('%s receives %j', (cid, ids) => {
    expect(byId.get(cid)!.signals.map(s => s.signalId)).toEqual(ids);
  });

  it('the four rewritten evaluators are no longer declared presence only (16 remain since W5 cycle 7)', () => {
    for (const n of ['asrRulesEvaluator', 'boundaryProtectionL1Evaluator', 'publicNetworkL1Evaluator', 'networkDenyByDefaultEvaluator']) {
      expect(PRESENCE_ONLY_EVALUATORS.has(n)).toBe(false);
      expect(evaluatorRegistry[n].presenceOnly).toBeUndefined();
    }
    expect(PRESENCE_ONLY_EVALUATORS.size).toBe(16);
  });

  it('S1-shaped catalog (credential UI + Stamper firewall + Stamper ASR): all four met by condition, Tier 2 source exists', () => {
    for (const cid of ['CM.L2-3.4.2', 'SC.L1-3.13.1', 'SC.L1-3.13.5', 'SC.L2-3.13.6']) {
      expect([cid, byId.get(cid)!.status]).toEqual([cid, 'met']);
      expect(byId.get(cid)!.sources[0].detail).not.toContain('presence only');
    }
    // The met sentences become the SSP narrative (Tier 2 deciders): no negation-lexicon hit (V30 / SC-1 row 1).
    for (const cid of ['CM.L2-3.4.2', 'SC.L1-3.13.1', 'SC.L1-3.13.5', 'SC.L2-3.13.6']) {
      expect(NarrativeNegationGuard.check('met', byId.get(cid)!.implementation_narrative!)).toEqual([]);
    }
    expect(byId.get('SC.L1-3.13.1')!.implementation_narrative).toBe("Boundary protection (host firewall): settings-catalog policy 'CMMC-Firewall-Policy' sets firewall on (domain profile), inbound blocked by default (domain profile), firewall on (private profile), inbound blocked by default (private profile), firewall on (public profile), inbound blocked by default (public profile) (the 6 setting(s) Stamper entry SC.L1-3.13.1.endpoint-firewall deploys, at their deployed values)");
  });
});

describe('EO-2 firewall condition (SC.L1-3.13.1 / 3.13.5, SC.L2-3.13.6)', () => {
  const evals = ['boundaryProtectionL1Evaluator', 'publicNetworkL1Evaluator', 'networkDenyByDefaultEvaluator'] as const;
  const PUBLIC_IN = 'vendor_msft_firewall_mdmstore_publicprofile_defaultinboundaction';

  it('a deployed value differs -> not met, the value read and the deployed value printed', () => {
    const s = [catalog([firewallPolicy({ [PUBLIC_IN]: `${PUBLIC_IN}_allow` })])];
    for (const e of evals) {
      const v = evaluatorRegistry[e](s);
      expect(v.status).toBe('not_met');
      expect(v.evidence).toContain(`inbound blocked by default (public profile): ${PUBLIC_IN} = ${PUBLIC_IN}_allow (deployed value ${PUBLIC_IN}_block)`);
      expect(v.evidence).toContain("settings-catalog policy 'CMMC-Firewall-Policy'");
    }
  });

  it('a deployed setting missing -> not met, printed as not set', () => {
    const v = evaluatorRegistry.boundaryProtectionL1Evaluator([catalog([firewallPolicy({}, [PUBLIC_IN])])]);
    expect(v.status).toBe('not_met');
    expect(v.evidence).toContain(`${PUBLIC_IN} = not set (deployed value ${PUBLIC_IN}_block)`);
  });

  it('policies read, none configures the firewall -> not met', () => {
    // W5 cycle 3: the legacy template is read too (it decides when no catalog policy carries the firewall).
    const v = evaluatorRegistry.networkDenyByDefaultEvaluator([catalog([credentialUi]), legacy([{ id: 'dc-1', displayName: 'Legacy', cameraBlocked: true }]), ca()]);
    expect(v.status).toBe('not_met');
    expect(v.evidence).toContain("1 settings-catalog policy(ies) read ('S1 Windows 11 credential UI') and 1 device configuration(s); none configures firewall on (domain profile)");
  });

  it('read errored, empty, or without settings -> not assessed, reads printed (the CA read does not decide)', () => {
    for (const s of [[catalogError(), ca()], [catalog([]), ca()], [catalog([{ id: 'p', name: 'Sim Configuration Policy 1' }]), ca()], [ca()]]) {
      const v = evaluatorRegistry.publicNetworkL1Evaluator(s);
      expect(v.status).toBe('not_assessed');
      expect(v.evidence).toContain('— not assessed. Read:');
      expect(v.evidence).toContain("'configurationPolicies'");
    }
  });
});

describe('EO-2 ASR condition (CM.L2-3.4.2), settings catalog or legacy template', () => {
  const asr = evaluatorRegistry.asrRulesEvaluator;
  const CRED = `${ASR_RULES_GROUP}_blockcredentialstealing`;
  const LEGACY_OK = { id: 'dc-1', displayName: 'Legacy EP', defenderEmailContentExecutionType: 'block', defenderOfficeAppsLaunchChildProcessType: 'block', defenderPreventCredentialStealingType: 'enable', defenderUntrustedUSBProcessType: 'block' };

  it('the four rules at block -> met', () => {
    const v = asr([catalog([asrPolicy()]), legacy([{ id: 'dc-1', displayName: 'Legacy' }])]);
    expect(v.status).toBe('met');
    expect(v.evidence).toContain("settings-catalog policy 'CMMC-ASR-Rules' sets blocks executable content from email and webmail");
  });

  it('one rule in audit mode -> not met with values; a policy carrying only the group -> each rule not set', () => {
    const children = ASR_RULES_SETTINGS.map(([d, v]) => ({ settingDefinitionId: d, choiceSettingValue: { value: d === CRED ? `${CRED}_audit` : v } }));
    const v = asr([catalog([asrPolicy(children)]), legacy([])]);
    expect(v.status).toBe('not_met');
    expect(v.evidence).toContain(`blocks credential stealing from LSASS: ${CRED} = ${CRED}_audit (deployed value ${CRED}_block)`);
    const g = asr([catalog([asrPolicy([])]), legacy([])]);
    expect(g.status).toBe('not_met');
    expect(g.evidence).toContain(`${CRED} = not set`);
  });

  it('rule settings serialized as text on the read (depth loss, as Stamper\'s own ASR record shows) -> not assessed', () => {
    const v = asr([catalog([asrPolicy('   ')]), legacy([{ id: 'dc-1' }])]);
    expect(v.status).toBe('not_assessed');
    expect(v.evidence).toContain("'CMMC-ASR-Rules' was read with its nested settings as text (read depth)");
  });

  it('the legacy endpoint-protection template decides met when the catalog has no ASR policy', () => {
    const v = asr([catalog([credentialUi]), legacy([LEGACY_OK])]);
    expect(v.status).toBe('met');
    expect(v.evidence).toContain("device configuration 'Legacy EP' sets blocks executable content from email and webmail (defenderEmailContentExecutionType block)");
    expect(NarrativeNegationGuard.check('met', v.evidence)).toEqual([]);
  });

  it('legacy fields at another value -> not met with values; neither source configures ASR -> not met; catalog unread -> not assessed', () => {
    const l = asr([catalog([credentialUi]), legacy([{ ...LEGACY_OK, defenderUntrustedUSBProcessType: 'auditMode' }])]);
    expect(l.status).toBe('not_met');
    expect(l.evidence).toContain("'Legacy EP' defenderEmailContentExecutionType block (configured value block)");
    expect(l.evidence).toContain('defenderUntrustedUSBProcessType auditMode (configured value block)');
    const none = asr([catalog([credentialUi]), legacy([{ id: 'dc-2', displayName: 'Wi-Fi' }])]);
    expect(none.status).toBe('not_met');
    expect(none.evidence).toContain('and 1 device configuration(s); none configures');
    expect(asr([catalogError(), legacy([{ id: 'dc-2', displayName: 'Wi-Fi' }])]).status).toBe('not_assessed');
  });
});

describe('EO-6: the deleted-users read (fetcher) reaches IA.L2-3.5.5', () => {
  const PAGING = "$u = $r.'@odata.nextLink'";
  const fetcherWith = (reply: (cmd: string) => string) => {
    const cmds: string[] = [];
    const session = { execute: async (_e: string, cmd: string) => { cmds.push(cmd); return { stdout: reply(cmd), stderr: '', exitCode: 0, durationMs: 0 }; } };
    const ps = { runExchangeCommands: async (): Promise<SignalResult[]> => [], runPurviewCommands: async (): Promise<SignalResult[]> => [] };
    return { cmds, f: new ComplianceSignalFetcher(session as any, ps as any) };
  };

  it('query built fetcher-side, paged, store query truthful', async () => {
    const { cmds, f } = fetcherWith(() => JSON.stringify({ value: [] }));
    const [s] = await f.fetchDeletedUsers();
    expect(DELETED_USERS_URI).toBe('/v1.0/directory/deletedItems/microsoft.graph.user?$select=id,userPrincipalName,deletedDateTime');
    expect(s.signalId).toBe('deletedUsers');
    expect(s.endpoint).toBe('/directory/deletedItems/microsoft.graph.user');
    expect(cmds[0]).toContain(DELETED_USERS_URI);
    expect(cmds[0]).toContain(PAGING);
    expect(f.describeRead(s).query).toBe(`GET ${DELETED_USERS_URI}`);
  });

  it('fetchAllSignals reads it once, right after the PIM policies', async () => {
    const { f } = fetcherWith(() => JSON.stringify({ value: [] }));
    const ids = (await f.fetchAllSignals()).map(s => s.signalId);
    expect(ids.filter(i => i === 'deletedUsers')).toHaveLength(1);
    expect(ids[ids.indexOf('deletedUsers') - 1]).toBe('pimPolicies');
  });

  it('through the fetcher into the evaluator: reassigned UPN -> not met; none -> met; read failed -> not assessed', async () => {
    const users = { value: [
      { id: 'user-7', userPrincipalName: 'sim.user7@s1mach.sim', accountEnabled: true, createdDateTime: '2026-06-01T00:00:00Z' },
      { id: 'user-8', userPrincipalName: 'sim.user8@s1mach.sim', accountEnabled: true, createdDateTime: '2025-01-01T00:00:00Z' },
    ] };
    const deleted = (rows: unknown[]) => async () => {
      const { f } = fetcherWith(() => JSON.stringify({ value: rows }));
      return (await f.fetchDeletedUsers())[0];
    };
    const evaluate = (d: SignalResult) => evaluatorRegistry.inactiveAccountsEvaluator([sig('directoryUsers', '/users', users), d]);

    const reused = evaluate(await deleted([{ id: 'user-90', userPrincipalName: '0f1e2d3c4b5a69788796a5b4c3d2e1f0sim.user7@s1mach.sim', deletedDateTime: '2026-05-01T00:00:00Z' }])());
    expect(reused.status).toBe('not_met');
    expect(reused.evidence).toContain('sim.user7@s1mach.sim (deleted 2026-05-01T00:00:00Z, reassigned to user-7)');

    const clean = evaluate(await deleted([{ id: 'user-91', userPrincipalName: 'a1b2c3d4e5f60718293a4b5c6d7e8f90sim.user91@s1mach.sim', deletedDateTime: '2026-04-01T00:00:00Z' }])());
    expect(clean.status).toBe('met');
    expect(clean.evidence).toContain('none of 1 deleted account UPN(s) was reassigned');

    const { f } = fetcherWith(() => { throw Object.assign(new Error('Request_ResourceNotFound (404)'), { statusCode: 404 }); });
    const failed = (await f.fetchDeletedUsers())[0];
    expect(failed.status).toBe('error');
    expect(evaluate(failed).status).toBe('not_assessed');
  });
});
