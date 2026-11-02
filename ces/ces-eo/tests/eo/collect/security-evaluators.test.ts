// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * EO-collection W2 part 2: the evaluators the security-monitoring collectors feed, each testing its
 * condition on collected rows (fixture rows in the collectors' view-signal shape), driven through
 * the real SignalToControlMapper and registry wherever the registry routes the view:
 *  AU.L2-3.3.5 correlation, IR.L2-3.6.1 alert and incident states, SI.L2-3.14.3 advisories (Secure
 *  Score and its control profiles; routed since the W2 part 3 B15 extension), SI.L2-3.14.6 feeds, SI.L2-3.14.7
 *  dispositions, RA.L2-3.11.2 scan recency, RA.L2-3.11.3 remediation tracking.
 * Unread, failed or empty → not_assessed with the read printed; none is declared presence only.
 */
import type { SignalResult } from 'ces-shared/types/signal';
import type { ControlAssessment } from 'ces-shared/types/controls';
import { SignalToControlMapper } from '../../../src/eo/mapping/SignalToControlMapper';
import { evaluatorRegistry, PRESENCE_ONLY_EVALUATORS } from '../../../src/eo/mapping/evaluators/index';
import { COLLECTED, OBSERVED_FIELD } from '../../../src/eo/collect/index';
import { fixture, FIXTURE_NOW } from './scriptedTenant';

const view = (signalId: string, endpoint: string, rows: unknown[] | null, status: SignalResult['status'] = 'success', error?: string): SignalResult => ({
  signalId, source: 'graph', endpoint, timestamp: new Date(FIXTURE_NOW).toISOString(),
  rawData: status === 'success' ? { value: rows ?? [] } : null, status, ...(error ? { error, findings: [error] } : {}),
});
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const incidents = (rows: unknown[] = fixture('incidents.json').value) => view(COLLECTED.SECURITY_INCIDENTS, '/security/incidents', rows);
const alerts = (rows: unknown[] = fixture('alerts-v2.json').value) => view(COLLECTED.SECURITY_ALERTS, '/security/alerts_v2', rows);
const risk = (rows: unknown[] = fixture('risk-detections.json').value) => view(COLLECTED.RISK_DETECTIONS, '/identityProtection/riskDetections', rows);
const scores = (rows: unknown[] = fixture('secure-scores.json').value) => view(COLLECTED.SECURE_SCORES, '/security/secureScores', rows);
const profiles = (rows: unknown[] = fixture('secure-score-control-profiles.json').value.map((r: any) => ({ ...r, [OBSERVED_FIELD]: '2026-10-27T12:00:00.000Z' }))) =>
  view(COLLECTED.SECURE_SCORE_PROFILES, '/security/secureScores', rows);
const recency = (rows: unknown[] = fixture('hunting-tvm-recency.json').results) => view(COLLECTED.TVM_RECENCY, '/security/runHuntingQuery', rows);
const vulns = (rows: unknown[] = fixture('hunting-tvm-vulnerabilities.json').results.map((r: any) => ({ ...r, [OBSERVED_FIELD]: '2026-10-27T12:00:00.000Z' }))) =>
  view(COLLECTED.TVM_VULNERABILITIES, '/security/runHuntingQuery', rows);

function assess(signals: SignalResult[], controlId: string): ControlAssessment {
  const a = new SignalToControlMapper().mapSignalsToControls(signals, evaluatorRegistry).find((x) => x.control_id === controlId);
  if (!a) throw new Error(`${controlId} not in the registry`);
  return a;
}

beforeAll(() => {
  jest.useFakeTimers({ now: FIXTURE_NOW, doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'queueMicrotask'] });
});
afterAll(() => jest.useRealTimers());

describe('AU.L2-3.3.5 incidentCorrelationEvaluator on collected incidents (C6b)', () => {
  it('met: inc-0001 correlates two alert sources; read printed', () => {
    const a = assess([incidents()], 'AU.L2-3.3.5');
    expect(a.status).toBe('met');
    expect(a.implementation_narrative).toContain('1/2 incident(s) in the last 90 days correlate alerts across ≥2 sources');
    expect(a.implementation_narrative).toContain("'collect.securityIncidents' returned 2 records");
  });
  it('two versions of one incident count once (newest kept)', () => {
    const rows = fixture('incidents.json').value;
    const older = { ...clone(rows[0]), lastUpdateDateTime: '2026-10-24T10:00:00.000Z', alerts: [rows[0].alerts[0]] };
    const a = assess([incidents([older, ...rows])], 'AU.L2-3.3.5');
    expect(a.status).toBe('met');
    expect(a.implementation_narrative).toContain('1/2 incident(s)');
  });
  it('single-source incidents only → partial; incidents older than 90 days → not_met', () => {
    const rows = fixture('incidents.json').value;
    expect(assess([incidents([rows[1]])], 'AU.L2-3.3.5').status).toBe('partial');
    expect(assess([incidents(rows.map((i: any) => ({ ...i, createdDateTime: '2026-06-01T00:00:00.000Z' })))], 'AU.L2-3.3.5').status).toBe('not_met');
  });
  it('empty or failed view → not_assessed with the read printed; the point-in-time read is used only without a view', () => {
    const empty = assess([incidents([])], 'AU.L2-3.3.5');
    expect(empty.status).toBe('not_assessed');
    expect(empty.implementation_narrative).toContain("'collect.securityIncidents' returned 0 records");
    const failed = assess([view(COLLECTED.SECURITY_INCIDENTS, '/security/incidents', null, 'error', 'HTTP 500'),
      view('securityIncidents', '/security/incidents', fixture('incidents.json').value)], 'AU.L2-3.3.5');
    expect(failed.status).toBe('not_assessed');
    expect(failed.implementation_narrative).toContain("read of 'collect.securityIncidents' failed (HTTP 500)");
    expect(assess([view('securityIncidents', '/security/incidents', fixture('incidents.json').value)], 'AU.L2-3.3.5').status).toBe('met');
  });
});

describe('IR.L2-3.6.1 incidentResponseEvaluator on collected alerts (C6a)', () => {
  it('met: alert-0002 moved to inProgress after it was created', () => {
    const a = assess([alerts()], 'IR.L2-3.6.1');
    expect(a.status).toBe('met');
    expect(a.implementation_narrative).toMatch(/alert-0002 inProgress at 2026-10-26T12:00:00.000Z \(created 2026-10-24T12:00:00.000Z\)/);
  });
  it('the newest version decides: alert-0001 new, then resolved', () => {
    const [first] = fixture('alerts-v2.json').value;
    const resolved = { ...first, status: 'resolved', lastUpdateDateTime: '2026-10-27T11:00:00.000Z' };
    expect(assess([alerts([first])], 'IR.L2-3.6.1').status).toBe('not_assessed');
    expect(assess([alerts([first, resolved])], 'IR.L2-3.6.1').status).toBe('met');
  });
  it('alerts all still new and no incident read → not_assessed, naming why', () => {
    const rows = fixture('alerts-v2.json').value.map((a: any) => ({ ...a, status: 'newAlert' }));
    const a = assess([alerts(rows)], 'IR.L2-3.6.1');
    expect(a.status).toBe('not_assessed');
    expect(a.implementation_narrative).toContain('3 alert(s) and 0 incident(s) read, none has left the new state');
    expect(a.implementation_narrative).toContain("'collect.securityIncidents' was not collected and 'securityIncidents' was not read");
  });
  it('an alert with no status → not_met; empty or failed → not_assessed', () => {
    const rows = fixture('alerts-v2.json').value;
    delete rows[0].status;
    expect(assess([alerts(rows)], 'IR.L2-3.6.1').status).toBe('not_met');
    expect(assess([alerts([])], 'IR.L2-3.6.1').status).toBe('not_assessed');
    const failed = assess([view(COLLECTED.SECURITY_ALERTS, '/security/alerts_v2', null, 'error', 'HTTP 500')], 'IR.L2-3.6.1');
    expect(failed.status).toBe('not_assessed');
    expect(failed.implementation_narrative).toContain("read of 'collect.securityAlerts' failed (HTTP 500)");
  });
});

// W2 part 3 (B15 extension): the registry routes /security/incidents to IR.L2-3.6.1.
describe('IR.L2-3.6.1 incidentResponseEvaluator on collected incidents (C6b)', () => {
  const newAlerts = () => alerts(fixture('alerts-v2.json').value.map((a: any) => ({ ...a, status: 'newAlert' })));
  it('met through the mapper: an incident assigned and updated after it was created (the B20 shape: active, assigned)', () => {
    const active = fixture('incidents.json').value[0];
    const a = assess([newAlerts(), incidents([active])], 'IR.L2-3.6.1');
    expect(a.status).toBe('met');
    expect(a.implementation_narrative).toContain('1 of 1 incident(s) and 0 of 3 alert(s) moved through handling states');
    expect(a.implementation_narrative).toContain('incident inc-0001 active, assigned, classification unknown at 2026-10-26T12:00:00.000Z (created 2026-10-24T10:00:00.000Z)');
    expect(a.implementation_narrative).not.toContain('example.test');
  });
  it('a resolved or classified incident counts; an active, unassigned, unclassified one does not', () => {
    const [active, resolved] = fixture('incidents.json').value;
    const untouched = { ...active, assignedTo: null, classification: 'unknown' };
    expect(assess([newAlerts(), incidents([untouched])], 'IR.L2-3.6.1').status).toBe('not_assessed');
    expect(assess([newAlerts(), incidents([resolved])], 'IR.L2-3.6.1').status).toBe('met');
    expect(assess([newAlerts(), incidents([{ ...untouched, classification: 'truePositive' }])], 'IR.L2-3.6.1').status).toBe('met');
  });
  it('an assigned incident never updated after creation does not count; the newest version decides', () => {
    const [active] = fixture('incidents.json').value;
    const unmoved = { ...active, lastUpdateDateTime: active.createdDateTime };
    expect(assess([newAlerts(), incidents([unmoved])], 'IR.L2-3.6.1').status).toBe('not_assessed');
    const reopened = { ...active, assignedTo: null, lastUpdateDateTime: '2026-10-27T11:00:00.000Z' };
    expect(assess([newAlerts(), incidents([active, reopened])], 'IR.L2-3.6.1').status).toBe('not_assessed');
  });
  it('an incident with no status → not_met; incidents alone (alerts unread) are assessed; the point-in-time read stands in only without a view', () => {
    const rows = fixture('incidents.json').value;
    delete rows[0].status;
    expect(assess([incidents(rows)], 'IR.L2-3.6.1').status).toBe('not_met');
    expect(assess([incidents()], 'IR.L2-3.6.1').status).toBe('met');
    expect(assess([view('securityIncidents', '/security/incidents', fixture('incidents.json').value)], 'IR.L2-3.6.1').status).toBe('met');
    const failed = assess([view(COLLECTED.SECURITY_INCIDENTS, '/security/incidents', null, 'error', 'HTTP 500'),
      view('securityIncidents', '/security/incidents', fixture('incidents.json').value)], 'IR.L2-3.6.1');
    expect(failed.status).toBe('not_assessed');
    expect(failed.implementation_narrative).toContain("read of 'collect.securityIncidents' failed (HTTP 500)");
  });
});

describe('SI.L2-3.14.3 safeLinksEvaluator: advisories (Secure Score recommendations) read with dates', () => {
  const fn = evaluatorRegistry.safeLinksEvaluator;
  it('met: the newest dated score lists recommendations', () => {
    const r = fn([scores()]);
    expect(r.status).toBe('met');
    expect(r.evidence).toContain('Secure Score of 2026-10-27T00:00:00.000Z lists 2 recommendation(s) (MFARegistrationV2, mdo_safelinksforemail)');
  });
  it('a score without a date → not_met; no recommendations → not_assessed; empty or unread → not_assessed', () => {
    const rows = fixture('secure-scores.json').value;
    expect(fn([scores([{ ...rows[0], createdDateTime: undefined }])]).status).toBe('not_met');
    expect(fn([scores(rows.map((s: any) => ({ ...s, controlScores: [] })))]).status).toBe('not_assessed');
    expect(fn([scores([])]).status).toBe('not_assessed');
    expect(fn([]).evidence).toContain("'collect.secureScores' was not collected and 'secureScores' was not read");
  });
  // W2 part 3 (B15 extension): the registry now routes /security/secureScores to 3.14.3.
  it('through the mapper the Secure Score view reaches the control: met', () => {
    const a = assess([alerts(), scores()], 'SI.L2-3.14.3');
    expect(a.status).toBe('met');
    expect(a.implementation_narrative).toContain('lists 2 recommendation(s)');
  });
  it('control profiles (C8b) are advisories too: met from current profiles when the score lists none; deprecated profiles do not count', () => {
    const bare = fixture('secure-scores.json').value.map((s: any) => ({ ...s, controlScores: [] }));
    const a = assess([scores(bare), profiles()], 'SI.L2-3.14.3');
    expect(a.status).toBe('met');
    expect(a.implementation_narrative).toContain('2 current control profile(s) observed 2026-10-27T12:00:00.000Z');
    expect(a.implementation_narrative).toContain('Create Safe Links policies for email messages [Not implemented]');
    expect(a.implementation_narrative).not.toContain('A retired recommendation');
    const onlyDeprecated = profiles([{ ...fixture('secure-score-control-profiles.json').value[2], [OBSERVED_FIELD]: '2026-10-27T12:00:00.000Z' }]);
    expect(assess([scores(bare), onlyDeprecated], 'SI.L2-3.14.3').status).toBe('not_assessed');
  });
  it('the B20 shape (one score without controlScores, profiles read empty) → not_assessed, reads printed', () => {
    const b20 = [{ id: 'secureScore-1', activeUserCount: 5, currentScore: 62, maxScore: 100, createdDateTime: '2026-10-27T00:00:00.000Z' }];
    const a = assess([alerts(), scores(b20), profiles([])], 'SI.L2-3.14.3');
    expect(a.status).toBe('not_assessed');
    expect(a.implementation_narrative).toContain('lists no recommendations and no current control profile was read');
    expect(a.implementation_narrative).toContain("'collect.secureScoreControlProfiles' returned 0 records");
  });
});

describe('SI.L2-3.14.6 monitoringEvaluator: three feeds collected in the window and healthy', () => {
  it('met with the alerts, risk-detection and Secure Score views', () => {
    const a = assess([alerts(), risk(), scores()], 'SI.L2-3.14.6');
    expect(a.status).toBe('met');
    expect(a.implementation_narrative).toContain("'collect.secureScores' returned 2 records");
  });
  it('a quiet tenant (no alerts, no detections) whose feeds operate is met', () => {
    expect(assess([alerts([]), risk([]), scores()], 'SI.L2-3.14.6').status).toBe('met');
  });
  it('no score in the window → not_assessed; a failed collector is unhealthy even beside an older point-in-time read', () => {
    expect(assess([alerts(), risk(), scores([])], 'SI.L2-3.14.6').status).toBe('not_assessed');
    const a = assess([view(COLLECTED.SECURITY_ALERTS, '/security/alerts_v2', null, 'error', 'timeout'),
      view('securityAlerts', '/security/alerts_v2', fixture('alerts-v2.json').value), risk(), scores()], 'SI.L2-3.14.6');
    expect(a.status).toBe('not_assessed');
    expect(a.implementation_narrative).toContain("read of 'collect.securityAlerts' failed (timeout)");
  });
});

describe('SI.L2-3.14.7 alertsEvaluator: unauthorized-use detections exist with a disposition', () => {
  it('met: 2 risk detections and 2 InitialAccess alerts, each with a state and a time (the Discovery alert is not counted)', () => {
    const a = assess([risk(), alerts()], 'SI.L2-3.14.7');
    expect(a.status).toBe('met');
    expect(a.implementation_narrative).toContain('2 risk detection(s) and 2 unauthorized-use alert(s) identified, each with a disposition');
    expect(a.implementation_narrative).toContain('unfamiliarFeatures: atRisk');
  });
  it('a detection with no riskState → not_met, named', () => {
    const rows = fixture('risk-detections.json').value;
    delete rows[0].riskState;
    const a = assess([risk(rows), alerts()], 'SI.L2-3.14.7');
    expect(a.status).toBe('not_met');
    expect(a.implementation_narrative).toContain('risk detection rd-0001');
  });
  it('no relevant record (only a Discovery alert) → not_assessed; nothing read → not_assessed', () => {
    const discovery = fixture('alerts-v2.json').value.filter((a: any) => a.category === 'Discovery');
    expect(assess([risk([]), alerts(discovery)], 'SI.L2-3.14.7').status).toBe('not_assessed');
    expect(assess([], 'SI.L2-3.14.7').status).toBe('not_assessed');
  });
});

describe('RA.L2-3.11.2 vulnScanRecencyEvaluator on collected assessment recency (C7a)', () => {
  it('met: both devices assessed within 7 days; the newest assessment per device decides', () => {
    const rows = fixture('hunting-tvm-recency.json').results;
    const a = assess([recency([{ ...rows[0], LastAssessed: '2026-09-01T00:00:00.000Z' }, ...rows])], 'RA.L2-3.11.2');
    expect(a.status).toBe('met');
    expect(a.implementation_narrative).toContain('2/2 device(s) assessed in the last 7 days');
  });
  it('a stale device → partial; empty → not_assessed with the read printed', () => {
    const rows = fixture('hunting-tvm-recency.json').results;
    expect(assess([recency([rows[0], { ...rows[1], LastAssessed: '2026-09-01T00:00:00.000Z' }])], 'RA.L2-3.11.2').status).toBe('partial');
    const empty = assess([recency([])], 'RA.L2-3.11.2');
    expect(empty.status).toBe('not_assessed');
    expect(empty.implementation_narrative).toContain("'collect.tvmAssessmentRecency' returned 0 records");
  });
});

describe('RA.L2-3.11.3 vulnRemediationEvaluator on collected vulnerabilities (C7b)', () => {
  it('met: each vulnerability is remediated (mitigation applied) or tracked (recommended update)', () => {
    const a = assess([vulns()], 'RA.L2-3.11.3');
    expect(a.status).toBe('met');
    expect(a.implementation_narrative).toContain('3 vulnerability(ies) on 2 device(s): 1 remediated, 2 tracked');
    expect(a.sources[0].detail).not.toContain('presence only');
  });
  it('a vulnerability with neither a recommendation nor a status → not_met, named', () => {
    const rows = fixture('hunting-tvm-vulnerabilities.json').results;
    rows[0].RecommendedSecurityUpdate = '';
    const a = assess([vulns(rows)], 'RA.L2-3.11.3');
    expect(a.status).toBe('not_met');
    expect(a.implementation_narrative).toContain('CVE-2026-00001 on wks-001');
  });
  it('rows without a CveId (what the sim answers) → not_assessed; unread → not_assessed; a Windows Update ring alone no longer meets it', () => {
    expect(assess([vulns(fixture('hunting-tvm-recency.json').results)], 'RA.L2-3.11.3').status).toBe('not_assessed');
    const unread = assess([view('updateRings', '/deviceManagement/windowsUpdateForBusinessUpdateRings', [{ id: 'ring-1' }])], 'RA.L2-3.11.3');
    expect(unread.status).toBe('not_assessed');
    expect(unread.implementation_narrative).toContain("'collect.tvmVulnerabilities' was not read");
  });
});

describe('presence-only declaration', () => {
  it('none of the seven evaluators is declared presence only', () => {
    for (const name of ['incidentCorrelationEvaluator', 'incidentResponseEvaluator', 'safeLinksEvaluator', 'monitoringEvaluator',
      'alertsEvaluator', 'vulnScanRecencyEvaluator', 'vulnRemediationEvaluator']) {
      expect(PRESENCE_ONLY_EVALUATORS.has(name)).toBe(false);
      expect(evaluatorRegistry[name].presenceOnly).toBeUndefined();
    }
  });
});
