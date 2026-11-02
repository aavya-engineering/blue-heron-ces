// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * W0.4 (EO-collection plan; REVIEW P0 #4): the six existence-only evaluators no longer claim a
 * configuration from the mere presence of alert data. 3.3.3, 3.3.4, 3.6.1, 3.14.3 and 3.14.7 are
 * record-based -> not_assessed with the read printed; 3.14.6 is met only when the alerts and
 * risk-detection reads succeed and Secure Score is non-empty. A quiet tenant and an alerts-only
 * tenant are never met. Driven through the real SignalToControlMapper and evaluator registry.
 * EO-collection W2 part 2: 3.6.1, 3.14.3 and 3.14.7 now test conditions on collected records (their
 * own tests: tests/eo/collect/security-evaluators.test.ts); here they are proven never met from alert presence.
 */
import type { SignalResult } from 'ces-shared/types/signal';
import type { ControlAssessment } from 'ces-shared/types/controls';
import { SignalToControlMapper } from '../../../src/eo/mapping/SignalToControlMapper';
import { evaluatorRegistry } from '../../../src/eo/mapping/evaluators/index';

const sig = (signalId: string, endpoint: string, rawData: unknown, status: SignalResult['status'] = 'success', error?: string): SignalResult => ({
  signalId, source: 'graph', endpoint, timestamp: '2026-10-27T13:00:00.000Z', rawData, status, ...(error ? { error } : {}),
});
const alerts = (n: number) => sig('securityAlerts', '/security/alerts_v2', Array.from({ length: n }, (_, i) => ({ id: `alert-${i + 1}`, severity: 'medium' })));
const risk = (n: number) => sig('riskDetections', '/identityProtection/riskDetections', { value: Array.from({ length: n }, (_, i) => ({ id: `rd-${i + 1}` })) });
const score = sig('secureScores', '/security/secureScores', [{ id: 's1', currentScore: 40, maxScore: 100 }]);

function assess(signals: SignalResult[], controlId: string): ControlAssessment {
  const a = new SignalToControlMapper().mapSignalsToControls(signals, evaluatorRegistry).find(x => x.control_id === controlId);
  if (!a) throw new Error(`${controlId} not in the control-signal registry`);
  return a;
}

// EO-collection W2 part 2: IR.L2-3.6.1, SI.L2-3.14.3 and SI.L2-3.14.7 now test conditions on collected
// records (alert states, Secure Score recommendations, detection dispositions), so they leave the
// record-based list; the block after this one proves they are still never met from alert presence.
const RECORD_BASED = ['AU.L2-3.3.3', 'AU.L2-3.3.4'];
const W2_REWRITTEN = ['IR.L2-3.6.1', 'SI.L2-3.14.3', 'SI.L2-3.14.7'];
/** Alerts as alerts_v2 returns them, still new and with no unauthorized-use category. */
const newAlerts = (n: number) => sig('securityAlerts', '/security/alerts_v2', Array.from({ length: n }, (_, i) => ({ id: `alert-${i + 1}`, severity: 'medium', status: 'new' })));

describe('W0.4 record-based controls: never met from alert presence', () => {
  it.each(RECORD_BASED)('%s, alerts-only tenant (2 alerts) -> not_assessed, read printed', (controlId) => {
    const a = assess([alerts(2), score], controlId);
    expect(a.status).toBe('not_assessed');
    expect(a.sources[0].result).toBe('no_query');
    expect(a.implementation_narrative).toMatch(/^Record-based; examine record needed/);
    expect(a.implementation_narrative).toContain("'securityAlerts' was read (/security/alerts_v2) and returned 2 objects");
  });

  it.each(RECORD_BASED)('%s, quiet tenant (0 alerts) -> not_assessed (not not_met: a quiet tenant is not a failure)', (controlId) => {
    const a = assess([alerts(0)], controlId);
    expect(a.status).toBe('not_assessed');
    expect(a.implementation_narrative).toContain('returned 0 objects');
  });

  it.each(RECORD_BASED)('%s, alerts read failed -> not_assessed with the error printed', (controlId) => {
    const a = assess([sig('securityAlerts', '/security/alerts_v2', null, 'error', 'HTTP 500')], controlId);
    expect(a.status).toBe('not_assessed');
    expect(a.implementation_narrative).toContain("read of 'securityAlerts' failed (HTTP 500)");
  });
});

describe('W2 rewrites (3.6.1, 3.14.3, 3.14.7): still never met from alert presence', () => {
  // W2 part 3 (B15 extension): the registry now routes /security/secureScores to 3.14.3, so the
  // undated Secure Score row in this fixture reaches its advisory rule ("a score without a date →
  // not_met"); it is still never met from alert presence.
  it.each(W2_REWRITTEN)('%s, alerts-only tenant (2 new alerts) -> not met from alert presence, read printed', (controlId) => {
    const a = assess([newAlerts(2), score], controlId);
    expect(a.status).toBe(controlId === 'SI.L2-3.14.3' ? 'not_met' : 'not_assessed');
    if (controlId === 'SI.L2-3.14.3') expect(a.implementation_narrative).toContain('carry no date');
    expect(a.sources[0].result).toBe(controlId === 'SI.L2-3.14.3' ? 'missing' : 'no_query');
    expect(a.implementation_narrative).toMatch(/Read: |Reads: /);
  });

  it.each(W2_REWRITTEN)('%s, quiet tenant (0 alerts) -> not_assessed (not not_met: a quiet tenant is not a failure)', (controlId) => {
    expect(assess([alerts(0)], controlId).status).toBe('not_assessed');
  });

  it.each(W2_REWRITTEN)('%s, alerts read failed -> not_assessed with the reads printed', (controlId) => {
    const a = assess([sig('securityAlerts', '/security/alerts_v2', null, 'error', 'HTTP 500')], controlId);
    expect(a.status).toBe('not_assessed');
    // 3.14.3 tests Secure Score, which this case does not read, so its narrative names that read instead.
    expect(a.implementation_narrative).toContain(controlId === 'SI.L2-3.14.3' ? "'secureScores' was not read" : "read of 'securityAlerts' failed (HTTP 500)");
  });
});

describe('W0.4 SI.L2-3.14.6: met only when all three monitoring feeds operate', () => {
  it('alerts read + risk-detection read succeed + Secure Score non-empty -> met', () => {
    const a = assess([alerts(2), risk(1), score], 'SI.L2-3.14.6');
    expect(a.status).toBe('met');
    expect(a.sources[0].result).toBe('exists');
  });

  it('a quiet tenant whose three feeds operate (0 alerts, 0 detections) is still met: the feeds are what is tested', () => {
    expect(assess([alerts(0), risk(0), score], 'SI.L2-3.14.6').status).toBe('met');
  });

  it('alerts-only tenant (risk detections not read) -> not_assessed, reads printed', () => {
    const a = assess([alerts(2), score], 'SI.L2-3.14.6');
    expect(a.status).toBe('not_assessed');
    expect(a.implementation_narrative).toContain("'riskDetections' was not read");
  });

  it('risk-detection read failed -> not_assessed', () => {
    const a = assess([alerts(2), sig('riskDetections', '/identityProtection/riskDetections', null, 'error', 'no resolver'), score], 'SI.L2-3.14.6');
    expect(a.status).toBe('not_assessed');
    expect(a.implementation_narrative).toContain("read of 'riskDetections' failed (no resolver)");
  });

  it('Secure Score empty -> not_assessed (was partial)', () => {
    const a = assess([alerts(2), risk(1), sig('secureScores', '/security/secureScores', [])], 'SI.L2-3.14.6');
    expect(a.status).toBe('not_assessed');
  });

  it('nothing read -> not_assessed (was not_met)', () => {
    expect(assess([], 'SI.L2-3.14.6').status).toBe('not_assessed');
  });
});
