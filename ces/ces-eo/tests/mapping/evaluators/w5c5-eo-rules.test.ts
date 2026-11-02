/**
 * W5 cycle 5: two rule changes.
 * - IA.L2-3.5.4: the phishing-resistant strength counts only when an enabled conditional access policy
 *   requires it (grant `authenticationStrength` referencing it) of the privileged roles or of all users.
 * - AC.L2-3.1.10 / SC.L2-3.13.9: screen lock is also judged on a compliance policy
 *   (`passwordMinutesOfInactivityBeforeLock`) and a settings-catalog policy (device-lock maximum inactivity),
 *   within the bound and assigned (the mapper's assignment gate).
 * Fixture: tests/fixtures/w5c5-examine-reads/sim-shapes.json (simulator shapes). The mapper cases load the
 * ces-shared source registry, which carries the routes this slice adds (CONTRACT CHANGE; dist is rebuilt later).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SignalResult } from 'ces-shared/types/signal';
import { SignalToControlMapper } from '../../../src/eo/mapping/SignalToControlMapper';
import { evaluatorRegistry, type EvaluatorContext } from '../../../src/eo/mapping/evaluators/index';
import { catalogSimpleValues, DEVICE_LOCK_MAX_INACTIVITY } from '../../../src/eo/mapping/evaluators/conditions';

const FX = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../fixtures/w5c5-examine-reads/sim-shapes.json'), 'utf8'));
const SRC_REGISTRY = path.resolve(__dirname, '../../../../ces-shared/src/data/control-signal-registry.json');
const AT = '2026-10-28T16:00:00.000Z';
const sig = (signalId: string, endpoint: string, rawData: unknown, status: SignalResult['status'] = 'success'): SignalResult => ({ signalId, source: 'graph', endpoint, timestamp: AT, rawData, status });
const strength = (rows = FX.authStrength) => sig('authStrength', '/policies/authenticationStrengthPolicies', rows);
const ca = (rows: unknown[]) => sig('conditionalAccess', '/identity/conditionalAccess/policies', rows);
const cfg = (rows: unknown[]) => sig('deviceConfigurations', '/deviceManagement/deviceConfigurations', { value: rows });
const comp = (rows: unknown[]) => sig('compliancePolicies', '/deviceManagement/deviceCompliancePolicies', { value: rows });
const cat = (rows: unknown[]) => sig('configurationPolicies', '/deviceManagement/configurationPolicies', { value: rows });
const run = (name: string, signals: SignalResult[], ctx?: EvaluatorContext) => evaluatorRegistry[name](signals, ctx);
const ANSWERED_10: EvaluatorContext = { expected: [{ path: '$.passwordMinutesOfInactivityBeforeScreenTimeout', op: 'lte', value: 10, source: 'answered' }] };
const mapper = () => new SignalToControlMapper(SRC_REGISTRY);
const statusOf = (signals: SignalResult[], id: string) => mapper().mapSignalsToControls(signals, evaluatorRegistry).find(a => a.control_id === id)!;
const unassigned = (o: Record<string, unknown>) => ({ ...o, assignments: [] });

describe('W5c5 IA.L2-3.5.4: the phishing-resistant strength must be required by an enabled CA policy', () => {
  it('S1: S1-CA02 requires the built-in strength of the admin roles -> met, naming the policy and the roles', () => {
    const v = run('authStrengthEvaluator', [strength(), ca(FX.conditionalAccess)]);
    expect(v.status).toBe('met');
    expect(v.evidence).toContain("'Phishing-resistant MFA' allow only phishing-resistant methods");
    expect(v.evidence).toContain("'S1-CA02 Phishing-resistant MFA - admin roles' requires it of privileged roles (Global Administrator, Privileged Role Administrator, Security Administrator, Intune Administrator, Exchange Administrator)");
  });

  it('muster-partial before Stamper: no policy requires it -> not_met, naming the strength and the policies read', () => {
    const v = run('authStrengthEvaluator', [strength(), ca(FX.musterPartialConditionalAccess)]);
    expect(v.status).toBe('not_met');
    expect(v.evidence).toBe("Replay-resistant authentication: 'Phishing-resistant MFA' allow only phishing-resistant methods (windowsHelloForBusiness, fido2, x509CertificateMultiFactor), but no enabled conditional access policy requires it of the privileged roles or of all users; 3 policy(ies) read: 'Sim CA Policy 1', 'Sim CA Policy 2', 'Sim CA Policy 3'");
  });

  it("muster-partial after Stamper: CMMC-AdminMFA-PhishingResistant (by id) -> met", () => {
    const v = run('authStrengthEvaluator', [strength(), ca([...FX.musterPartialConditionalAccess, FX.musterPartialAfterStamper])]);
    expect(v.status).toBe('met');
    expect(v.evidence).toContain("'CMMC-AdminMFA-PhishingResistant' requires it of privileged roles (Global Administrator, SharePoint Administrator)");
  });

  it('a reference by name only (the cmdlet read carries no id) counts; a different strength id does not', () => {
    const byName = { ...FX.conditionalAccess[1], grantControls: { operator: 'OR', authenticationStrength: { displayName: 'Phishing-resistant MFA' } } };
    expect(run('authStrengthEvaluator', [strength(), ca([byName])]).status).toBe('met');
    const other = { ...FX.conditionalAccess[1], grantControls: { operator: 'OR', authenticationStrength: { id: '00000000-0000-0000-0000-000000000002', displayName: 'Multifactor authentication' } } };
    expect(run('authStrengthEvaluator', [strength(), ca([other])]).status).toBe('not_met');
  });

  it('all users counts; a disabled or report-only policy, or one scoped to a group only, does not', () => {
    const base = FX.conditionalAccess[1];
    const allUsers = { ...base, conditions: { users: { includeUsers: ['All'] } } };
    expect(run('authStrengthEvaluator', [strength(), ca([allUsers])]).evidence).toContain('requires it of all users');
    for (const p of [{ ...base, state: 'disabled' }, { ...base, state: 'enabledForReportingButNotEnforced' }, { ...base, conditions: { users: { includeGroups: ['group-1'] } } }]) {
      expect(run('authStrengthEvaluator', [strength(), ca([p])]).status).toBe('not_met');
    }
  });

  it('no CA read -> not_assessed with the strength and the reads printed; no phishing-resistant strength -> not_met as before', () => {
    const v = run('authStrengthEvaluator', [strength()]);
    expect(v.status).toBe('not_assessed');
    expect(v.evidence).toContain("'Phishing-resistant MFA' allow only phishing-resistant methods");
    expect(v.evidence).toContain("'conditionalAccess' was not read");
    expect(run('authStrengthEvaluator', [strength([{ id: 's3', displayName: 'Any MFA', allowedCombinations: ['password,sms'] }]), ca(FX.conditionalAccess)]).status).toBe('not_met');
  });

  it('through the mapper (source registry): the CA read now reaches IA.L2-3.5.4', () => {
    const a = statusOf([strength(), ca(FX.conditionalAccess)], 'IA.L2-3.5.4');
    expect(a.status).toBe('met');
    expect(a.signals.map(s => s.signalId).sort()).toEqual(['authStrength', 'conditionalAccess']);
    expect(statusOf([strength(), ca(FX.musterPartialConditionalAccess)], 'IA.L2-3.5.4').status).toBe('not_met');
  });
});

describe('W5c5 screen lock: device configuration, compliance policy or settings catalog (AC.L2-3.1.10, SC.L2-3.13.9)', () => {
  const both = ['sessionLockEvaluator', 'sessionTerminationNetworkEvaluator'];

  it('the settings-catalog device-lock maximum inactivity is read as an integer, children included', () => {
    expect(catalogSimpleValues(FX.deviceLockCatalogPolicy, DEVICE_LOCK_MAX_INACTIVITY)).toEqual([10]);
    expect(catalogSimpleValues(FX.reads.configurationPolicies.value[0], DEVICE_LOCK_MAX_INACTIVITY)).toEqual([]);
  });

  it('a compliance policy within the bound is met; above the answered bound not met', () => {
    for (const name of both) {
      const v = run(name, [comp(FX.compliancePolicies)]);
      expect(v.status).toBe('met');
      expect(v.evidence).toContain("compliance policy 'S1 Windows 11 staff and kiosk compliance' 15 min");
      expect(run(name, [comp(FX.compliancePolicies)], ANSWERED_10).status).toBe('not_met');
    }
  });

  it('a settings-catalog policy within the answered bound is met; with the device password disabled it is not', () => {
    for (const name of both) {
      const v = run(name, [cat([FX.deviceLockCatalogPolicy])], ANSWERED_10);
      expect(v.status).toBe('met');
      expect(v.evidence).toContain("settings-catalog policy 'Device lock (settings catalog)' 10 min; locks within 10 min (organisation value: TM expected value (answered))");
      const off = JSON.parse(JSON.stringify(FX.deviceLockCatalogPolicy).replace('devicepasswordenabled_0', 'devicepasswordenabled_1'));
      expect(run(name, [cat([off])], ANSWERED_10).status).toBe('not_met');
    }
  });

  it("S1 after Stamper: CMMC-ScreenLock-Policy 10 min decides met under the answered 10, beside S1's 15-minute compliance policies", () => {
    for (const name of both) {
      const v = run(name, [cfg([FX.stamperScreenLock]), comp(FX.compliancePolicies), cat(FX.reads.configurationPolicies.value)], ANSWERED_10);
      expect(v.status).toBe('met');
      expect(v.evidence).toContain("'CMMC-ScreenLock-Policy' 10 min, compliance policy 'S1 Windows 11 staff and kiosk compliance' 15 min");
    }
  });

  it('no read carries a screen-lock setting -> not_assessed with the three reads printed; no read at all -> not_assessed', () => {
    for (const name of both) {
      const v = run(name, [cat(FX.reads.configurationPolicies.value), comp([{ id: 'deviceCompliancePolicy-9', displayName: 'No lock', passwordRequired: true }])]);
      expect(v.status).toBe('not_assessed');
      expect(v.evidence).toContain('no compliance policy sets passwordMinutesOfInactivityBeforeLock');
      expect(v.evidence).toContain("'deviceConfigurations' was not read");
      expect(run(name, []).status).toBe('not_assessed');
    }
  });

  it('through the mapper (source registry): the new reads reach both controls; an unassigned policy credits nothing', () => {
    for (const id of ['AC.L2-3.1.10', 'SC.L2-3.13.9']) {
      const a = statusOf([comp(FX.compliancePolicies)], id);
      expect(a.status).toBe('met');
      expect(a.signals.map(s => s.signalId)).toContain('compliancePolicies');
      expect(statusOf([cat([FX.deviceLockCatalogPolicy])], id).status).toBe('met');
      const mp = statusOf([comp(FX.compliancePolicies.map(unassigned))], id);
      expect(mp.status).toBe('not_met');
      expect(mp.implementation_narrative).toContain('created but assigned to no group');
    }
    // AC.L2-3.1.10 now also reads the device configurations (it read conditional access only).
    expect(statusOf([cfg([FX.stamperScreenLock])], 'AC.L2-3.1.10').status).toBe('met');
  });
});
