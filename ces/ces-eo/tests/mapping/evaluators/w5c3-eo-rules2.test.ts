// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Synthetic-customer W5 cycle 3, EO rules part 2: (1) assignment-aware credit, (2) policy vs tenant
 * reconciliation, (3) AC.L2-3.1.6 separate accounts from the role reads, (4) firewall legacy-template fallback,
 * (5) the lockout reconciliation row first and the IA.L2-3.5.5 window-limited wording. Fixtures are the run-48
 * (S1) store shapes, copied inline: simulator-style ids and fictional names only.
 */
import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import type { SignalResult } from 'ces-shared/types/signal';
import type { ControlAssessment } from 'ces-shared/types/controls';
import { evaluatorRegistry } from '../../../src/eo/mapping/evaluators/index.js';
import { SignalToControlMapper } from '../../../src/eo/mapping/SignalToControlMapper.js';
import { assignmentStateOf, assignmentGated, stamperRecordAssignmentState, isAssignableIntuneSignal, UNASSIGNED_SENTENCE } from '../../../src/eo/mapping/evaluators/assignments.js';
import { evaluatorContextsFromTm } from '../../../src/eo/mapping/evaluators/tmContext.js';
import { REUSE_WINDOW_NOTE } from '../../../src/eo/mapping/evaluators/ia-evaluators.js';
import { FIREWALL_SETTINGS } from '../../../src/eo/mapping/evaluators/sc-evaluators.js';
import { ControlAssessor, type EoControlAssessment } from '../../../src/eo/assessment/ControlAssessor.js';
import { buildDeterminationLedger } from '../../../src/eo/assessment/DeterminationLedger.js';
import { StamperEvidenceLoader, INTUNE_ASSIGNMENT_UNREAD, INTUNE_UNASSIGNED, isUnassignedObjectSource, isStamperNotSatSource } from '../../../src/eo/evidence/StamperEvidenceLoader.js';
import {
  ComplianceSignalFetcher, CONFIGURATION_POLICIES_URI, DEVICE_CONFIGURATIONS_URI, COMPLIANCE_POLICIES_URI, IOS_APP_PROTECTIONS_URI,
  ROLE_ELIGIBILITY_URI, DIRECTORY_SETTINGS_URI, DOMAINS_URI, DIRECTORY_USER_SELECT,
} from '../../../src/eo/ingestion/ComplianceSignalFetcher.js';
import { recordFetchedSignals } from '../../../src/eo/evidence/store/recordFetchedSignals.js';
import { buildPolicyReconciliation, applyPolicyReconciliation, latestTenantReads, POLICY_LEAD, type TenantRead } from '../../../src/eo/ssp/PolicyReconciliation.js';
import { NarrativeNegationGuard } from '../../../src/eo/ssp/NarrativeNegationGuard';
import { stamperVerdictText } from '../../../src/eo/ssp/SspGenerator.js';

const _require = createRequire(__filename);
const controlsRefPath = _require.resolve('ces-shared/data/cmmc-l2-controls');
const SRC_REGISTRY = path.resolve(__dirname, '../../../../ces-shared/src/data/control-signal-registry.json');
const TS = '2026-10-28T19:27:49.179Z';
const sig = (signalId: string, endpoint: string, rawData: unknown, status: SignalResult['status'] = 'success'): SignalResult =>
  ({ signalId, source: 'graph', endpoint, timestamp: TS, rawData, status } as SignalResult);
const GROUP = { id: 'a-1', target: { '@odata.type': '#microsoft.graph.groupAssignmentTarget', groupId: 'group-cui' } };

// Run 48 (S1) store shapes: deviceConfigurations / appProtections (the Stamper-created objects carry no assignments).
const blockStorage = { '@odata.type': '#microsoft.graph.windows10GeneralConfiguration', displayName: 'CMMC-BlockRemovableStorage', id: 'deviceConfiguration-7', storageBlockRemovableStorage: true };
const screenLock = { '@odata.type': '#microsoft.graph.windows10GeneralConfiguration', displayName: 'CMMC-ScreenLock-Policy', id: 'deviceConfiguration-3', passwordMinimumLength: 14, passwordMinutesOfInactivityBeforeScreenTimeout: 10, passwordRequired: true };
const simCfg = { displayName: 'Sim Device Configuration 1', id: 'deviceConfiguration-1' };
const cfg = (...rows: unknown[]) => sig('deviceConfigurations', '/deviceManagement/deviceConfigurations', { value: rows });
const s1Mam = { '@odata.type': '#microsoft.graph.iosManagedAppProtection', displayName: 'S1 iOS CUI app protection', id: '51510000-00c6-4000-8000-000000000001', isAssigned: true, appDataEncryptionType: 'whenDeviceLocked', deviceComplianceRequired: true, dataBackupBlocked: true };
const stamperMam = { '@odata.type': '#microsoft.graph.iosManagedAppProtection', displayName: 'CMMC-iOS-MAM', id: 'iosManagedAppProtection-2', dataBackupBlocked: true, deviceComplianceRequired: true, periodOfflineBeforeWipeIsEnforced: 'P30D' };
const mam = (...rows: unknown[]) => sig('appProtections', '/deviceAppManagement/iosManagedAppProtectionPolicies', { value: rows });

describe('item 1: assignment-aware credit', () => {
  test('assignment state of one Intune object', () => {
    expect(assignmentStateOf({ assignments: [GROUP] })).toBe('assigned');
    expect(assignmentStateOf({ groupAssignments: [{ targetGroupId: 'g' }] })).toBe('assigned');
    expect(assignmentStateOf({ assignments: [] })).toBe('unassigned');
    expect(assignmentStateOf({ isAssigned: true })).toBe('assigned');
    expect(assignmentStateOf({ isAssigned: false })).toBe('unassigned');
    expect(assignmentStateOf({ displayName: 'x' })).toBe('unknown');
    expect(assignmentStateOf({ assignments: '   ' })).toBe('unknown'); // read-depth loss, not tenant state
    expect(isAssignableIntuneSignal(cfg())).toBe(true);
    expect(isAssignableIntuneSignal(mam())).toBe(true);
    expect(isAssignableIntuneSignal(sig('managedDevices', '/deviceManagement/managedDevices', []))).toBe(false);
  });

  const mapper = new SignalToControlMapper(SRC_REGISTRY);
  const map = (signals: SignalResult[]) => new Map(mapper.mapSignalsToControls(signals, evaluatorRegistry).map(a => [a.control_id, a]));

  test('run 48 shape (no assignment information) -> not assessed with the read printed, never presence-met', () => {
    const byId = map([cfg(simCfg, screenLock, blockStorage)]);
    const a = byId.get('AC.L2-3.1.21')!;
    expect(a.status).toBe('not_assessed');
    expect(a.implementation_narrative).toContain("carries no assignment information for 'CMMC-BlockRemovableStorage'");
    expect(a.implementation_narrative).toContain("Read: 'deviceConfigurations' was read (/deviceManagement/deviceConfigurations) and returned 3 objects");
    expect(a.implementation_narrative).toContain("without the assignment test the read gives: Portable storage: 'CMMC-BlockRemovableStorage' blocks removable storage");
    // the presence-only BitLocker evaluator (MP.L2-3.8.6) is gated too
    const b = byId.get('MP.L2-3.8.6')!;
    expect(b.status).toBe('not_assessed');
    expect(b.sources[0].detail).not.toContain('presence only');
  });

  test(`explicitly unassigned -> not met, "${UNASSIGNED_SENTENCE}"`, () => {
    const a = map([cfg({ ...simCfg, assignments: [] }, { ...blockStorage, assignments: [] })]).get('AC.L2-3.1.21')!;
    expect(a.status).toBe('not_met');
    expect(a.implementation_narrative).toBe(`Portable storage: 'CMMC-BlockRemovableStorage' ${UNASSIGNED_SENTENCE}, so it applies to no device or user (without the assignment test the read gives: Portable storage: 'CMMC-BlockRemovableStorage' blocks removable storage (storageBlockRemovableStorage true))`);
    expect(a.sources[0].result).toBe('missing');
  });

  test('assigned -> the evaluator verdict stands, unchanged', () => {
    const a = map([cfg(simCfg, { ...blockStorage, assignments: [GROUP] })]).get('AC.L2-3.1.21')!;
    expect(a.status).toBe('met');
    expect(a.implementation_narrative).toBe("Portable storage: 'CMMC-BlockRemovableStorage' blocks removable storage (storageBlockRemovableStorage true)");
  });

  test('isAssigned (Graph) counts; the credit then rests on the assigned object only (AC.L2-3.1.19)', () => {
    const a = map([mam(s1Mam, stamperMam)]).get('AC.L2-3.1.19')!;
    expect(a.status).toBe('met');
    expect(a.implementation_narrative).toContain("'S1 iOS CUI app protection'");
    expect(a.implementation_narrative).not.toContain('CMMC-iOS-MAM');
  });

  test('never upgrades: a verdict that does not credit is returned as it is', () => {
    const bad = { ...blockStorage, storageBlockRemovableStorage: false, assignments: [] };
    const v = assignmentGated(s => evaluatorRegistry.removableStorageEvaluator(s), [cfg(bad)]);
    expect(v.status).toBe('not_met');
    expect(v.evidence).not.toContain(UNASSIGNED_SENTENCE);
  });

  // Stamper records: the update ring Muster's cycle-3 directive flip makes Stamper create (MA.L2-3.7.1 / 3.7.2), unassigned.
  const ringBody = { '@odata.type': '#microsoft.graph.windowsUpdateForBusinessConfiguration', displayName: 'CMMC-UpdateRing-Standard', id: 'deviceConfiguration-11', qualityUpdatesDeferralPeriodInDays: 7, featureUpdatesDeferralPeriodInDays: 30 };
  const POST_RING = "Invoke-MgGraphRequest -Method POST -Uri 'https://graph.microsoft.us/v1.0/deviceManagement/deviceConfigurations' -Body (@{'@odata.type'='#microsoft.graph.windowsUpdateForBusinessConfiguration';displayName='CMMC-UpdateRing-Standard'} | ConvertTo-Json)";
  const rec = (entry: string, controlIds: string[], raw: unknown, command: string) => ({
    rawResponse: typeof raw === 'string' ? raw : JSON.stringify(raw, null, 4), outcome: 'automated_success', outcomeRationale: 'Exit code 0, output validated', complianceVerdict: 'SAT',
    registryEntry: { entry_id: entry, label: entry, control_ids: controlIds },
    metadata: { controlIds, timestamp: TS, commandExecuted: command, sha256Hash: 'x' },
  });

  test('Stamper record assignment state: by Intune path, cmdlet or @odata.type; other records undefined', () => {
    expect(stamperRecordAssignmentState(POST_RING, JSON.stringify(ringBody))).toBe('unknown');
    expect(stamperRecordAssignmentState(POST_RING, JSON.stringify({ ...ringBody, assignments: [] }))).toBe('unassigned');
    expect(stamperRecordAssignmentState('Get-MgDeviceManagementDeviceConfiguration | Select-Object DisplayName,Id', '[{"DisplayName":"x","Id":"1"}]')).toBe('unknown');
    expect(stamperRecordAssignmentState('[manual/evidence-only] read', JSON.stringify(ringBody))).toBe('unknown');
    expect(stamperRecordAssignmentState("Invoke-MgGraphRequest -Uri '/beta/deviceManagement/templates/t-1/createInstance'", '{"displayName":"CMMC-Win11-Baseline","isAssigned":true}')).toBe('assigned');
    expect(stamperRecordAssignmentState('New-MgIdentityConditionalAccessPolicy -BodyParameter $p', '{"displayName":"CMMC-Require-MFA","state":"enabled"}')).toBeUndefined();
    // run 48 replay: an authentication-method configuration is not an Intune object (IA.L2-3.5.3 keeps its Tier 3 credit)
    expect(stamperRecordAssignmentState('Update-MgPolicyAuthenticationMethodPolicyAuthenticationMethodConfiguration -AuthenticationMethodConfigurationId Fido2', '{"@odata.type":"#microsoft.graph.fido2AuthenticationMethodConfiguration","id":"Fido2","state":"enabled"}')).toBeUndefined();
    expect(stamperRecordAssignmentState('read', '{"@odata.type":"#microsoft.graph.windowsWifiConfiguration","displayName":"CMMC-WiFi-Secure"}')).toBe('unknown');
    expect(stamperRecordAssignmentState('read', '{"@odata.type":"#microsoft.graph.iosManagedAppProtection","displayName":"CMMC-iOS-MAM"}')).toBe('unknown');
  });

  describe('Stamper records through the loader and the assessor', () => {
    let tmp: string;
    const prev = process.env.CES_PIPELINE_ROOT;
    const slug = 'w5c3-assign';
    let loader: StamperEvidenceLoader;
    beforeAll(() => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'w5c3-assign-'));
      process.env.CES_PIPELINE_ROOT = tmp;
      const dir = path.join(tmp, 'Stamper', 'plan-data', slug, 'evidence', 'maintenance');
      fs.mkdirSync(dir, { recursive: true });
      const files: Record<string, unknown> = {
        'ma.l2-3.7.1.update-ring.json': rec('MA.L2-3.7.1.update-ring', ['MA.L2-3.7.1', 'MA.L2-3.7.2'], ringBody, POST_RING),
        'ra.l2-3.11.3.vuln-remediation.json': rec('RA.L2-3.11.3.vuln-remediation', ['RA.L2-3.11.3'], { ...ringBody, displayName: 'CMMC-SecurityUpdateRing', assignments: [] }, POST_RING),
        'mp.l2-3.8.6.bitlocker.json': rec('MP.L2-3.8.6.bitlocker', ['MP.L2-3.8.6'], { '@odata.type': '#microsoft.graph.windows10EndpointProtectionConfiguration', displayName: 'CMMC-BitLocker-Policy', bitLockerEncryptDevice: true, assignments: [GROUP] }, POST_RING),
        'ac.l1-3.1.1.ca.json': rec('AC.L1-3.1.1.ca-policy', ['AC.L1-3.1.1'], { displayName: 'CMMC-Require-MFA', state: 'enabled' }, 'Get-MgIdentityConditionalAccessPolicy'),
        // Run 48 shape of an evidence-only Intune read: commandExecuted is only the label; the embedded
        // registry entry's get_command names the read; the payload is Select-Object-projected (no @odata.type).
        'ma.l2-3.7.4.media-check.json': { ...rec('MA.L2-3.7.4.media-check', ['MA.L2-3.7.4'], [{ displayName: 'CMMC-Defender-AntivirusPolicy', createdDateTime: '/Date(1793215488611)/' }], '[manual/evidence-only] Media Check for Malicious Code Evidence'),
          registryEntry: { entry_id: 'MA.L2-3.7.4.media-check', label: 'Media Check for Malicious Code Evidence', control_ids: ['MA.L2-3.7.4'], set_command: '',
            get_command: "(Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/deviceManagement/deviceCompliancePolicies').value | Where-Object displayName -like '*Defender*' | Select-Object displayName,createdDateTime" } },
      };
      for (const [n, b] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), JSON.stringify(b));
      loader = new StamperEvidenceLoader(slug);
    });
    afterAll(() => {
      fs.rmSync(tmp, { recursive: true, force: true });
      if (prev === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = prev;
    });
    const sources = () => loader.toAssessmentSources(loader.loadEvidenceForTenant());

    test('no assignment information -> no_query (uncounted, reason named); explicit unassigned -> a Tier 3 negative; assigned -> counted', () => {
      const m = sources();
      expect(m.get('MA.L2-3.7.1')!.map(s => s.result)).toEqual(['no_query']);
      expect(m.get('MA.L2-3.7.1')![0].detail).toBe(`MA.L2-3.7.1.update-ring (${INTUNE_ASSIGNMENT_UNREAD})`);
      expect(m.get('MA.L2-3.7.2')!.map(s => s.result)).toEqual(['no_query']);
      const ra = m.get('RA.L2-3.11.3')![0];
      expect([ra.result, ra.detail]).toEqual(['missing', `RA.L2-3.11.3.vuln-remediation (${INTUNE_UNASSIGNED})`]);
      expect(isUnassignedObjectSource(ra)).toBe(true);
      expect(isStamperNotSatSource(ra)).toBe(false); // not a failed task: no "resolve the failure" POA&M action
      expect(m.get('MP.L2-3.8.6')!.map(s => s.result)).toEqual(['imported']);
      expect(m.get('AC.L1-3.1.1')!.map(s => s.result)).toEqual(['imported']);
      // evidence-only: detected through the registry entry's get_command
      expect(m.get('MA.L2-3.7.4')!.map(s => [s.result, s.detail])).toEqual([['no_query', `Media Check for Malicious Code Evidence (${INTUNE_ASSIGNMENT_UNREAD})`]]);
    });

    test('the SSP evidence line says why an Intune SAT is not counted (matches the ledger)', () => {
      const ev = loader.loadEvidenceForTenant();
      const ring = ev.find(e => e.entryId === 'MA.L2-3.7.1.update-ring')!;
      const sec = ev.find(e => e.entryId === 'RA.L2-3.11.3.vuln-remediation')!;
      const bit = ev.find(e => e.entryId === 'MP.L2-3.8.6.bitlocker')!;
      expect([ring.assignment, sec.assignment, bit.assignment]).toEqual(['unknown', 'unassigned', 'assigned']);
      const detail = (assignment?: 'unknown' | 'unassigned') => ({ kind: 'stamper' as const, path: 'x.json', sha256: 'x', timestamp: TS, entryId: 'e', verdict: 'SAT', mode: 'state-verified' as const, modeLabel: 'state verified' as const, method: 'examine' as any, ...(assignment ? { assignment } : {}) });
      expect(stamperVerdictText(detail('unknown'))).toBe('SAT (Intune object read without assignment information; not counted)');
      expect(stamperVerdictText(detail('unassigned'))).toBe('SAT (Intune object created but assigned to no group; a negative, not a credit)');
      expect(stamperVerdictText(detail())).toBe('SAT');
    });

    test('merged: MA.L2-3.7.1 / 3.7.2 not assessed (ledger names why); RA.L2-3.11.3 not met at Tier 3; MP.L2-3.8.6 met at Tier 3', () => {
      const snap = new ControlAssessor(controlsRefPath).merge(slug, [], [], [], [], sources(), new Map<string, ControlAssessment>(), undefined, []);
      const c = (id: string) => snap.controls.find(x => x.control_id === id) as EoControlAssessment;
      expect(c('MA.L2-3.7.1').status).toBe('not_assessed');
      expect(c('MA.L2-3.7.2').status).toBe('not_assessed');
      expect(c('RA.L2-3.11.3').status).toBe('not_met');
      expect(c('RA.L2-3.11.3').statusRationale).toMatch(/^Tier 3 \(state-verified execution verdict\) decides: evidence_import\/missing: RA\.L2-3\.11\.3\.vuln-remediation \(SAT, but the Intune object was created but assigned to no group\)/);
      expect(c('MP.L2-3.8.6').status).toBe('met');
      const ledger = buildDeterminationLedger({ tenantId: slug, generatedAt: TS, snapshot: snap });
      const o = ledger.objectives.find(x => x.objectiveId.startsWith('MA.L2-3.7.1'))!;
      expect(o.rationale).toContain(`"MA.L2-3.7.1.update-ring" (${INTUNE_ASSIGNMENT_UNREAD})`);
    });
  });

  test('fetcher: the four Intune reads expand assignments; endpoints the registry routes are kept; store query truthful', async () => {
    const cmds: string[] = [];
    const session = { execute: async (_e: string, cmd: string) => { cmds.push(cmd); return { stdout: '{"value":[]}\nEO_EXECUTION_SUCCESS', stderr: '', exitCode: 0 }; } };
    const f = new ComplianceSignalFetcher(session as any, { runExchangeCommands: async () => [], runPurviewCommands: async () => [] } as any);
    const all = await f.fetchAllSignals();
    const byId = new Map(all.map(s => [s.signalId, s]));
    for (const [id, endpoint, uri] of [
      ['deviceConfigurations', '/deviceManagement/deviceConfigurations', DEVICE_CONFIGURATIONS_URI],
      ['compliancePolicies', '/deviceManagement/deviceCompliancePolicies', COMPLIANCE_POLICIES_URI],
      ['appProtections', '/deviceAppManagement/iosManagedAppProtectionPolicies', IOS_APP_PROTECTIONS_URI],
      ['configurationPolicies', '/deviceManagement/configurationPolicies', CONFIGURATION_POLICIES_URI],
      ['roleEligibilitySchedules', '/roleManagement/directory/roleEligibilitySchedules', ROLE_ELIGIBILITY_URI],
      ['directorySettings', '/groupSettings', DIRECTORY_SETTINGS_URI],
      ['domains', '/domains', DOMAINS_URI],
    ] as const) {
      expect([id, byId.get(id)?.endpoint]).toEqual([id, endpoint]);
      expect(f.describeRead(byId.get(id)!).query).toBe(`GET ${uri}`);
      expect(cmds.some(c => c.includes(uri))).toBe(true);
    }
    expect(DEVICE_CONFIGURATIONS_URI).toContain('$expand=assignments');
    expect(COMPLIANCE_POLICIES_URI).toContain('$expand=assignments');
    expect(IOS_APP_PROTECTIONS_URI).toContain('$expand=assignments');
    expect(CONFIGURATION_POLICIES_URI).toBe('/beta/deviceManagement/configurationPolicies?$expand=settings,assignments');
    expect(cmds.some(c => /Get-MgDeviceManagementDeviceConfiguration|Get-MgDeviceManagementDeviceCompliancePolicy|Get-MgDeviceAppManagementIosManagedAppProtection/.test(c))).toBe(false);
    expect(all.filter(s => s.signalId === 'compliancePolicies')).toHaveLength(1);
    expect(DIRECTORY_USER_SELECT.split(',')).toContain('employeeId');
  });
});

describe('items 2 and 5: policy vs tenant reconciliation (findings only)', () => {
  // The S1 pushed profile's odps (run 48) and the S1 simulator's tenant values.
  const ODPS = { account_lockout_threshold: 3, account_lockout_duration_minutes: 15, session_timeout_minutes: 10, min_password_length: 14, password_history_count: 24, max_password_age_days: 60, audit_log_retention_days: 730 };
  const read = (sourceId: string, payload: unknown, query: string, recordId = `rec-${sourceId}`): TenantRead =>
    ({ sourceId, recordId, query, collectedAt: TS, payloadSha256: 'a'.repeat(64), payload });
  const reads = new Map<string, TenantRead>([
    ['directorySettings', read('directorySettings', { value: [{ id: 's-1', displayName: 'Password Rule Settings', values: [
      { name: 'LockoutDurationInSeconds', value: '300' }, { name: 'LockoutThreshold', value: '5' }, { name: 'EnableBannedPasswordCheck', value: 'True' }] }] }, `GET ${DIRECTORY_SETTINGS_URI}`)],
    ['domains', read('domains', { value: [{ id: 's1-mach.simtenant.onmicrosoft.us', passwordValidityPeriodInDays: 2147483647 }, { id: 'simtenant.onmicrosoft.us', passwordValidityPeriodInDays: 2147483647 }] }, `GET ${DOMAINS_URI}`)],
    ['deviceConfigurations', read('deviceConfigurations', { value: [screenLock, blockStorage] }, `GET ${DEVICE_CONFIGURATIONS_URI}`)],
    ['compliancePolicies', read('compliancePolicies', { value: [
      { displayName: 'S1 Windows 11 staff and kiosk compliance', passwordMinimumLength: 14, passwordMinutesOfInactivityBeforeLock: 15, passwordPreviousPasswordBlockCount: 24, passwordExpirationDays: null },
      { displayName: 'S1 Windows 11 programming workstation compliance', passwordMinimumLength: 14, passwordMinutesOfInactivityBeforeLock: 15, passwordPreviousPasswordBlockCount: 24, passwordExpirationDays: null },
      { displayName: 'S1 iOS compliance', passcodeMinimumLength: 6, passcodeMinutesOfInactivityBeforeLock: 5 }] }, `GET ${COMPLIANCE_POLICIES_URI}`)],
  ]);
  const controlIdOf = (n: string) => ({ '3.1.8': 'AC.L2-3.1.8', '3.1.10': 'AC.L2-3.1.10', '3.5.7': 'IA.L2-3.5.7', '3.5.8': 'IA.L2-3.5.8' } as Record<string, string>)[n];

  test('S1: lockout threshold first, then lockout duration, session timeout and password age; consistent values give no row', () => {
    const rows = buildPolicyReconciliation(ODPS, reads, controlIdOf);
    expect(rows.map(r => [r.controlId, r.odpId, r.policyValue, r.tenantValue])).toEqual([
      ['AC.L2-3.1.8', 'PI.ODP.001', 'at most 3 failed attempts (account_lockout_threshold)', '5 failed attempts'],
      ['AC.L2-3.1.8', 'PI.ODP.002', 'at least 15 minutes (account_lockout_duration_minutes)', '300 seconds (5 minutes)'],
      ['AC.L2-3.1.10', 'PI.ODP.003', 'at most 10 minutes (session_timeout_minutes)', '15 minutes'],
      ['IA.L2-3.5.7', 'PI.ODP.006', 'at most 60 days (max_password_age_days)', 'passwords never expire'],
    ]);
    expect(rows[0].statement).toBe(`AC.L2-3.1.8 PI.ODP.001: Policy states at most 3 failed attempts (account_lockout_threshold); tenant configured 5 failed attempts; source rows: directory setting 'Password Rule Settings' LockoutThreshold = 5 (directorySettings store record rec-directorySettings (GET /v1.0/groupSettings; collected ${TS}; payload sha256 aaaaaaaaaaaa)). A finding for the organisation to reconcile its policy and its tenant; no control status changes.`);
    expect(rows[2].sourceRows).toEqual([
      "compliance policy 'S1 Windows 11 staff and kiosk compliance' passwordMinutesOfInactivityBeforeLock = 15",
      "compliance policy 'S1 Windows 11 programming workstation compliance' passwordMinutesOfInactivityBeforeLock = 15",
    ]);
    expect(rows[3].sourceRows).toHaveLength(2);
    expect(rows[3].readReference).toContain('domains store record rec-domains (GET /v1.0/domains;');
  });

  test('no profile, or no tenant read for an ODP -> no row is invented', () => {
    expect(buildPolicyReconciliation(undefined, reads, controlIdOf)).toEqual([]);
    expect(buildPolicyReconciliation(ODPS, new Map(), controlIdOf)).toEqual([]);
    expect(buildPolicyReconciliation({ account_lockout_threshold: 10 }, reads, controlIdOf)).toEqual([]);
  });

  test('applied to an SSP: top-level policyReconciliation[] and the posture block; no status changes; idempotent', () => {
    const ssp = {
      controlImplementations: [
        { control_id: 'AC.L2-3.1.8', nist_ref: '3.1.8', status: 'met' }, { control_id: 'AC.L2-3.1.10', nist_ref: '3.1.10', status: 'met' },
        { control_id: 'IA.L2-3.5.7', nist_ref: '3.5.7', status: 'met' },
      ],
      postureReconciliation: { heading: '1.1 Posture Reconciliation', intro: '', rows: [], assessedSprs: 53, notMetDeduction: { controls: 0, points: 0 }, notAssessedDeduction: { controls: 0, points: 0 }, partialDeduction: { controls: 0, points: 0 }, ledgerDifferences: [], statements: ['Only EvidenceOps\' SPRS is an assessed value.'] },
    } as any;
    const before = JSON.stringify(ssp.controlImplementations);
    applyPolicyReconciliation(ssp, ODPS, reads);
    applyPolicyReconciliation(ssp, ODPS, reads);
    expect(JSON.stringify(ssp.controlImplementations)).toBe(before);
    expect(ssp.postureReconciliation.assessedSprs).toBe(53);
    expect(ssp.policyReconciliation).toHaveLength(4);
    expect(ssp.policyReconciliation[0]).toEqual(expect.objectContaining({ controlId: 'AC.L2-3.1.8', odpId: 'PI.ODP.001', policyValue: expect.any(String), tenantValue: '5 failed attempts', readReference: expect.stringContaining('directorySettings store record') }));
    expect(ssp.postureReconciliation.policyReconciliation).toEqual(ssp.policyReconciliation);
    const st: string[] = ssp.postureReconciliation.statements;
    expect(st.filter(s => s.startsWith(POLICY_LEAD))).toHaveLength(1);
    expect(st).toHaveLength(1 + 1 + 4);
    expect(st[1]).toContain('4 organisation-defined parameter value(s) differ between the policy and the tenant');
  });

  test('the tenant reads come from the latest evidence-store records (unrouted reads are stored with no control)', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'w5c3-recon-'));
    try {
      const payloadFor = (cmd: string) => cmd.includes(DIRECTORY_SETTINGS_URI) ? reads.get('directorySettings')!.payload : reads.get('domains')!.payload;
      const f = new ComplianceSignalFetcher({ execute: async (_e: string, cmd: string) => ({ stdout: `${JSON.stringify(payloadFor(cmd))}
EO_EXECUTION_SUCCESS`, stderr: '', exitCode: 0 }) } as any, {} as any);
      const signals = await f.fetchReconciliationReads();
      const out = recordFetchedSignals(signals, [], { storageRoot: root, tenantId: 'sim-tenant-s1-mach', tenantSlug: 's1-mach', collector: { name: 'ces-eo/ComplianceSignalFetcher', version: 't', identity: 'ces-eo/t@sim' }, describe: s => f.describeRead(s) });
      expect(out.errors).toEqual([]);
      const got = latestTenantReads(root, 'sim-tenant-s1-mach');
      expect([...got.keys()].sort()).toEqual(['directorySettings', 'domains']);
      const rows = buildPolicyReconciliation(ODPS, got, controlIdOf);
      expect(rows.map(r => r.odpId)).toEqual(['PI.ODP.001', 'PI.ODP.002', 'PI.ODP.006']);
      expect(rows[0].readReference).toMatch(/^directorySettings store record [0-9a-f-]{36} \(GET \/v1\.0\/groupSettings; collected /);
      expect(latestTenantReads(path.join(root, 'nothing-here'), 'sim-tenant-s1-mach').size).toBe(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('item 3: AC.L2-3.1.6 separate accounts for privileged functions', () => {
  // Run 48 (S1) users read: normal accounts licensed, admin accounts (Admin) unlicensed, two break-glass accounts.
  const u = (id: string, displayName: string, upn: string, licensed: boolean) => ({ id, displayName, userPrincipalName: `${upn}@s1-mach.simtenant.onmicrosoft.us`, accountEnabled: true, assignedLicenses: licensed ? [{ disabledPlans: [], skuId: 'sim-sku-g5-gcchigh' }] : [] });
  const users = [
    u('user-8', 'Tamsel Kettlevane', 'tamsel.kettlevane', true), u('user-9', 'Corvane Marrowholt', 'corvane.marrowholt', true),
    u('user-10', 'Dorrel Nettlecombe', 'dorrel.nettlecombe', true), u('user-11', 'Kestin Oakenwick', 'kestin.oakenwick', true),
    u('user-46', 'Tamsel Kettlevane (Admin)', 'adm.tamsel.kettlevane', false), u('user-47', 'Corvane Marrowholt (Admin)', 'adm.corvane.marrowholt', false),
    u('user-48', 'Dorrel Nettlecombe (Admin)', 'adm.dorrel.nettlecombe', false), u('user-49', 'Kestin Oakenwick (Admin)', 'adm.kestin.oakenwick', false),
    u('user-50', 'Emergency Access 01', 'bg.access01', false), u('user-51', 'Emergency Access 02', 'bg.access02', false),
  ];
  const GA = '62e90394-69f5-4237-9190-012177145e10';
  const SEC = '194ae4cb-b126-40b2-bd5b-6091b380977d';
  const EXO = '29232cdf-9323-42fd-ade2-1d097af3e4de';
  const usersRead = (rows = users) => sig('directoryUsers', '/users', { value: rows });
  const standing = sig('roleAssignmentsAll', '/roleManagement/directory/roleAssignments', { value: [{ id: 'roleAssignment-1', principalId: 'user-50', roleDefinitionId: GA, directoryScopeId: '/' }, { id: 'roleAssignment-2', principalId: 'user-51', roleDefinitionId: GA, directoryScopeId: '/' }] });
  const eligible = sig('roleEligibilitySchedules', '/roleManagement/directory/roleEligibilitySchedules', { value: [
    { id: 'roleEligibilitySchedule-1', principalId: 'user-46', roleDefinitionId: GA, directoryScopeId: '/', status: 'Provisioned' },
    { id: 'roleEligibilitySchedule-2', principalId: 'user-47', roleDefinitionId: EXO, directoryScopeId: '/', status: 'Provisioned' },
    { id: 'roleEligibilitySchedule-3', principalId: 'user-48', roleDefinitionId: SEC, directoryScopeId: '/', status: 'Provisioned' },
    { id: 'roleEligibilitySchedule-4', principalId: 'user-49', roleDefinitionId: SEC, directoryScopeId: '/', status: 'Provisioned' },
  ] });
  const ctx = { breakGlassIds: ['user-50', 'user-51'], adminAccountIds: ['user-46', 'user-48'] };

  test('the registry routes the users, the standing assignments and the PIM eligibility to AC.L2-3.1.6 (source registry)', () => {
    const a = new SignalToControlMapper(SRC_REGISTRY).mapSignalsToControls([usersRead(), standing, eligible], evaluatorRegistry).find(x => x.control_id === 'AC.L2-3.1.6')!;
    expect(a.signals.map(s => s.signalId)).toEqual(['directoryUsers', 'roleAssignmentsAll', 'roleEligibilitySchedules']);
  });

  test('S1: four privileged principals (break-glass excluded), each dedicated and paired with the same person\'s normal account', () => {
    const v = evaluatorRegistry.dedicatedAdminEvaluator([usersRead(), standing, eligible], ctx);
    expect(v.status).toBe('met');
    expect(v.evidence).toBe("Separate accounts for privileged functions: 4 privileged principal(s) (standing role assignments, PIM-eligible roles, TM admin accounts), each a dedicated account: "
      + "'Tamsel Kettlevane (Admin)' (user-46; Global Administrator (eligible)) with normal account 'Tamsel Kettlevane' (user-8, matched by display name) [no productivity licence]; "
      + "'Corvane Marrowholt (Admin)' (user-47; Exchange Administrator (eligible)) with normal account 'Corvane Marrowholt' (user-9, matched by display name) [no productivity licence]; "
      + "'Dorrel Nettlecombe (Admin)' (user-48; Security Administrator (eligible)) with normal account 'Dorrel Nettlecombe' (user-10, matched by display name) [no productivity licence]; "
      + "'Kestin Oakenwick (Admin)' (user-49; Security Administrator (eligible)) with normal account 'Kestin Oakenwick' (user-11, matched by display name) [no productivity licence]");
    expect(v.evidence).not.toContain('user-50');
    expect(NarrativeNegationGuard.check('met', v.evidence)).toEqual([]);
  });

  test('a licensed privileged principal is someone\'s normal account -> not met, printed', () => {
    const shared = users.map(x => x.id === 'user-47' ? { ...x, assignedLicenses: [{ skuId: 'sim-sku-g5-gcchigh' }] } : x);
    const v = evaluatorRegistry.dedicatedAdminEvaluator([usersRead(shared), standing, eligible], ctx);
    expect(v.status).toBe('not_met');
    expect(v.evidence).toContain("1 of 4 privileged principal(s) (standing role assignments, PIM-eligible roles, TM admin accounts) hold a productivity licence, so they are someone's normal account: 'Corvane Marrowholt (Admin)' (user-47; Exchange Administrator (eligible))");
  });

  test('the stated naming convention (TM) is an alternative to the licence test and pairs by name parts', () => {
    const TM = { tenant_manifest: { tenant_identity: { tenant_id: 'sim-tenant-s1-mach' }, config_intents: [{ id: 'ci-1', desired_config: { admin_naming_convention: 'adm.{firstname}.{lastname}@{domain}' } }] } };
    const c = evaluatorContextsFromTm(TM, [], { tenantId: 'sim-tenant-s1-mach' }).forControl('AC.L2-3.1.6');
    expect(c?.adminNamingConvention).toBe('adm.{firstname}.{lastname}@{domain}');
    const lic = users.map(x => x.id === 'user-47' ? { ...x, displayName: 'C. Marrowholt - privileged', assignedLicenses: [{ skuId: 'sim-sku' }] } : x);
    const v = evaluatorRegistry.dedicatedAdminEvaluator([usersRead(lic), standing, eligible], { ...ctx, adminNamingConvention: c!.adminNamingConvention });
    expect(v.status).toBe('met');
    expect(v.evidence).toContain("'C. Marrowholt - privileged' (user-47; Exchange Administrator (eligible)) with normal account 'Corvane Marrowholt' (user-9, matched by naming convention) [follows the stated naming convention]");
  });

  test('a dedicated account with no counterpart found is printed, not failed', () => {
    const v = evaluatorRegistry.dedicatedAdminEvaluator([usersRead(users.filter(x => x.id !== 'user-11')), standing, eligible], ctx);
    expect(v.status).toBe('met');
    expect(v.evidence).toContain("'Kestin Oakenwick (Admin)' (user-49; Security Administrator (eligible)); no normal account of the same person found in the users read [no productivity licence]");
  });

  test('no role read -> the earlier licence-only sentence is the fallback', () => {
    const v = evaluatorRegistry.dedicatedAdminEvaluator([usersRead()], ctx);
    expect(v).toEqual({ status: 'met', evidence: "Separate admin accounts: 2 privileged account(s) hold no productivity licence, so each is separate from its owner's primary account" });
  });

  test('role reads naming only the break-glass accounts -> not assessed', () => {
    expect(evaluatorRegistry.dedicatedAdminEvaluator([usersRead(), standing], { breakGlassIds: ['user-50', 'user-51'] }).status).toBe('not_assessed');
  });
});

describe('item 4: firewall on the legacy endpoint-protection template', () => {
  const catalog = (rows: unknown[]) => sig('configurationPolicies', '/deviceManagement/configurationPolicies', { value: rows });
  const credentialUi = { id: 'p-1', name: 'S1 Windows 11 credential UI', settings: [{ settingInstance: { settingDefinitionId: 'device_vendor_msft_policy_config_credentialsui_disablepasswordreveal', choiceSettingValue: { value: 'device_vendor_msft_policy_config_credentialsui_disablepasswordreveal_1' } } }] };
  const profile = (enabled = 'allowed', blocked = true) => ({ firewallEnabled: enabled, inboundConnectionsBlocked: blocked });
  const legacyFw = (o: Record<string, unknown> = {}) => ({ '@odata.type': '#microsoft.graph.windows10EndpointProtectionConfiguration', id: 'dc-fw', displayName: 'Legacy Firewall', firewallProfileDomain: profile(), firewallProfilePrivate: profile(), firewallProfilePublic: profile(), ...o });
  const fwCatalog = (value: string) => ({ id: 'p-2', name: 'CMMC-Firewall-Policy', settings: FIREWALL_SETTINGS.map(([d, v]) => ({ settingInstance: { settingDefinitionId: d, choiceSettingValue: { value: d.endsWith('enablefirewall') ? `${d}_${value}` : v } } })) });

  test('no catalog policy carries the firewall; the legacy template does -> met', () => {
    const v = evaluatorRegistry.boundaryProtectionL1Evaluator([catalog([credentialUi]), cfg(legacyFw())]);
    expect(v.status).toBe('met');
    expect(v.evidence).toContain("device configuration 'Legacy Firewall' sets firewall on (domain profile) (firewallProfileDomain.firewallEnabled allowed)");
    expect(NarrativeNegationGuard.check('met', v.evidence)).toEqual([]);
  });

  test('legacy template with the public profile off -> not met, values printed', () => {
    const v = evaluatorRegistry.publicNetworkL1Evaluator([catalog([credentialUi]), cfg(legacyFw({ firewallProfilePublic: profile('blocked', false) }))]);
    expect(v.status).toBe('not_met');
    expect(v.evidence).toContain('firewallProfilePublic.firewallEnabled blocked (configured value allowed)');
  });

  test('the settings catalog decides first: a catalog carrier with a wrong value is not met even with a correct legacy template', () => {
    expect(evaluatorRegistry.networkDenyByDefaultEvaluator([catalog([fwCatalog('false')]), cfg(legacyFw())]).status).toBe('not_met');
    expect(evaluatorRegistry.networkDenyByDefaultEvaluator([catalog([fwCatalog('true')]), cfg(legacyFw({ firewallProfileDomain: profile('blocked', false) }))]).status).toBe('met');
  });

  test('through the mapper the legacy template is routed (source registry) and gated on assignment', () => {
    const mapper = new SignalToControlMapper(SRC_REGISTRY);
    const run = (fw: unknown) => mapper.mapSignalsToControls([catalog([{ ...credentialUi, isAssigned: true }]), cfg(fw)], evaluatorRegistry).find(a => a.control_id === 'SC.L1-3.13.1')!;
    expect(run({ ...legacyFw(), assignments: [GROUP] }).status).toBe('met');
    expect(run({ ...legacyFw(), assignments: [] }).status).toBe('not_met');
    expect(run(legacyFw()).status).toBe('not_assessed');
  });
});

describe('item 5: IA.L2-3.5.5 keeps the window-limited wording', () => {
  test('the non-empty met sentence is window-limited ("any period" is gone) and has no lexicon hit', () => {
    const users = sig('directoryUsers', '/users', { value: [{ id: 'user-1', userPrincipalName: 'a.b@s1-mach.simtenant.onmicrosoft.us', accountEnabled: true, createdDateTime: '2025-01-01T00:00:00Z' }] });
    const deleted = sig('deletedUsers', '/directory/deletedItems/microsoft.graph.user', { value: [
      { id: 'user-60', userPrincipalName: '0123456789abcdef0123456789abcdefold.one@s1-mach.simtenant.onmicrosoft.us', deletedDateTime: '2026-10-10T00:00:00Z' },
      { id: 'user-61', userPrincipalName: '0123456789abcdef0123456789abcdefold.two@s1-mach.simtenant.onmicrosoft.us', deletedDateTime: '2026-10-12T00:00:00Z' }] });
    const v = evaluatorRegistry.inactiveAccountsEvaluator([users, deleted]);
    expect(v.status).toBe('met');
    expect(v.evidence).toBe(`Identifier reuse: none of 2 deleted account UPN(s) was reassigned within the 30-day recycle-bin window (requirement default, no organisation value: any reassignment counts) (${REUSE_WINDOW_NOTE}); no disabled account's UPN is held by an enabled account`);
    expect(v.evidence).not.toContain('any period');
    expect(NarrativeNegationGuard.check('met', v.evidence)).toEqual([]);
  });
});
